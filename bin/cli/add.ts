// bin/cli/add.ts — `pensmith add <doi|pdf|url>` verb (ERGO-06 + RSCH-05b).
//
// THIN ORCHESTRATOR (compile.ts shape): ingest ONE new source mid-paper and
// optionally remap it onto sections. No business logic lives here beyond
// input-type detection + composing the existing chokepoints:
//   - DOI  → crossrefFetchById(normalizeDoi(source))   (offline cassette-backed)
//   - PDF  → readFile → extractPdfText (pdf-parse → pymupdf fallback, 08-03) →
//            title heuristic → crossrefSearch(title, {limit:1})
//   - URL  → httpFetch (D-06 chokepoint, NEVER raw fetch) → sniff Content-Type:
//            PDF bytes → PDF path; HTML → scrape a <meta> DOI → retry as DOI.
//
// Writes via writeBibtex (D-19 citation-js chokepoint) — never a hand-rolled
// serializer. The remap gate (approval-gates-default-on, --yolo skips) touches
// ONLY assigned_sources[] in each section PLAN.md — NEVER status or
// verified_against_draft_hash (Pitfall 3 / A6: a verified section STAYS
// verified; the user runs `plan <N> --revise` to rebuild the claim mapping).
//
// stdout-only (no console.* — Pitfall-7 stance shared with the other verbs).
//
// SECURITY (08-04 threat register):
//   - T-08-04-02 SSRF: every network hop goes through httpFetch (http.ts owns
//     per-source rate limits); a DOI is normalized via normalizeDoi first.
//   - T-08-04-03 path traversal: PDFs are read via fs.readFile(path.resolve(..))
//     and only a Buffer is handed to the bytes-only extractPdfText chokepoint.
//   - T-08-04-04 verifier bypass: verifyDoi runs at add-time; a FABRICATED
//     verdict at compile (Pass 1) still blocks — add cannot smuggle a verified
//     source past the verifier.

import { defineCommand } from 'citty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractPdfText } from '../lib/pdf-text.js';
import { search as crossrefSearch, fetchById as crossrefFetchById } from '../lib/sources/crossref.js';
import { writeBibtex } from '../lib/bibtex-write.js';
import { parseBibtex } from '../lib/citations.js';
import { normalizeDoi, isDoi, verifyDoi } from '../lib/doi.js';
import { updateFrontmatter } from '../lib/frontmatter.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { withLock } from '../lib/lock.js';
import { runGate } from '../lib/gates.js';
import { migrateFrontmatterText } from '../lib/frontmatter.js';
import { paperDir, sectionPlan, projectRoot } from '../lib/paths.js';
import { resolveSectionSlug } from '../lib/section-slug.js';
import { loadState } from '../lib/state.js';
import { fetch as httpFetch } from '../lib/http.js';
import { isOfflineMode } from '../lib/http-mock.js';

/** True for an http(s) URL — used to route URL ingestion away from the local-PDF
 *  branch (audit #12: a URL ending in .pdf must NOT be read as a local file). */
function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}
import type { SourceCandidate } from '../lib/schemas/source-candidate.js';
import { EXIT_USAGE } from '../lib/exit-codes.js';

/**
 * Heuristic title extractor for a BYO PDF: the first non-empty line with a
 * reasonable length. Deliberately conservative — the title only seeds a
 * crossrefSearch; a miss simply yields no candidate (handled by the caller).
 */
function extractTitleHeuristic(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length >= 8 && line.length <= 300) return line;
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length >= 8 ? flat.slice(0, 200) : undefined;
}

/** Scrape a DOI out of an HTML body's citation <meta> tags (best-effort). */
function scrapeDoiFromHtml(html: string): string | null {
  const meta = /<meta[^>]+(?:name|property)=["'](?:citation_doi|dc\.identifier|doi)["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (meta?.[1]) return normalizeDoi(meta[1]);
  const inline = /\b10\.\d{4,9}\/[^\s"'<>]+/.exec(html);
  return inline ? normalizeDoi(inline[0]) : null;
}

/** Reconstruct a minimal SourceCandidate from a parsed CSL-JSON bib entry. */
function cslToCandidate(e: Record<string, unknown>): SourceCandidate | null {
  const doi = typeof e.DOI === 'string' ? e.DOI : undefined;
  const title = typeof e.title === 'string' ? e.title : '';
  if (!doi || !title) return null; // writeBibtex drops id-less entries anyway
  const authorArr = Array.isArray(e.author) ? (e.author as Array<Record<string, unknown>>) : [];
  const authors = authorArr
    .map((a) => {
      const family = String(a.family ?? '').trim();
      const given = String(a.given ?? '').trim();
      if (!family) return '';
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean);
  if (authors.length === 0) authors.push('Anonymous');
  let year: number | undefined;
  const issued = e.issued as { 'date-parts'?: number[][] } | undefined;
  const y = issued?.['date-parts']?.[0]?.[0];
  if (typeof y === 'number') year = y;
  const citekey = typeof e.id === 'string' && /^[a-z][a-z0-9_-]*$/.test(e.id) ? e.id : undefined;
  return {
    source: 'crossref',
    id: doi,
    doi,
    title,
    authors,
    year,
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey: citekey ?? 'anon',
    raw: e,
  };
}

/** Load the existing CITATIONS.bib (if any) as reconstructed candidates. */
async function loadExistingCandidates(bibPath: string): Promise<SourceCandidate[]> {
  let text: string;
  try {
    text = await fs.promises.readFile(bibPath, 'utf8');
  } catch {
    return []; // no bib yet
  }
  if (!text.trim()) return [];
  try {
    const entries = await parseBibtex(text);
    return entries
      .map((e) => cslToCandidate(e as Record<string, unknown>))
      .filter((c): c is SourceCandidate => c !== null);
  } catch {
    // A malformed pre-existing bib must not abort the add; preserve it raw is
    // impossible through the chokepoint, so fall back to a fresh write of the
    // new candidate alone (the user keeps the new source; the corrupt file is
    // surfaced by the verifier on the next compile).
    return [];
  }
}

/**
 * Remap a citekey onto sections by appending to assigned_sources[] ONLY.
 * NEVER mutates status or verified_against_draft_hash (Pitfall 3 / A6). When
 * `only` is provided, remaps exactly that one section; otherwise iterates every
 * section in STATE.json. Idempotent — a citekey already present is skipped.
 */
async function remapSections(
  paperRoot: string,
  citekey: string,
  only?: { n: number; slug: string },
): Promise<number> {
  let targets: Array<{ n: number; slug: string }>;
  if (only) {
    targets = [only];
  } else {
    try {
      const state = await loadState(paperRoot);
      targets = (state.sections ?? []).map((s) => ({ n: s.n, slug: s.slug }));
    } catch {
      targets = [];
    }
  }

  let updatedCount = 0;
  for (const { n, slug } of targets) {
    const planPath = sectionPlan(n, slug, paperRoot);
    if (!fs.existsSync(planPath)) continue;
    await withLock(planPath, async () => {
      // CONF-04: migrate a v0 PLAN.md (stamp schema_version) before mutating it.
      const text = migrateFrontmatterText('plan', await fs.promises.readFile(planPath, 'utf8'), planPath).text;
      const updated = updateFrontmatter(text, (fm) => {
        const existing = Array.isArray(fm.assigned_sources)
          ? (fm.assigned_sources as unknown[])
          : [];
        if (!existing.includes(citekey)) {
          fm.assigned_sources = [...existing, citekey];
        }
      });
      await atomicWriteFile(planPath, updated);
    });
    updatedCount++;
  }
  return updatedCount;
}

/**
 * Remap `citekey` onto one section (--section/--slug) or every section.
 * Audit #25: when --section is given, remap ONLY that section, resolving its
 * slug from --slug, else from OUTLINE.md. A --section we cannot resolve to a
 * real slug must NOT fall through to "remap every section" — it is a usage
 * error instead. Omitting --section remaps all sections, by design.
 */
async function remapCommand(
  paperRoot: string,
  citekey: string,
  secRaw: unknown,
  slugRaw: unknown,
): Promise<{ ok: boolean; citekey: string; remapped: number; exitCode?: typeof EXIT_USAGE }> {
  let only: { n: number; slug: string } | undefined;
  if (secRaw !== undefined) {
    const n = Number(secRaw);
    const explicit = typeof slugRaw === 'string' && slugRaw.length > 0 ? slugRaw : undefined;
    const slug = Number.isInteger(n) && n >= 1 ? resolveSectionSlug(paperRoot, n, explicit) : 'placeholder';
    if (!Number.isInteger(n) || n < 1 || (slug === 'placeholder' && explicit === undefined)) {
      process.stdout.write(
        `pensmith add: ${citekey} is in CITATIONS.bib; --section ${String(secRaw)} could not be ` +
        `resolved to a section slug (pass --slug, or run \`pensmith outline\` first) — ` +
        `no sections remapped.\n`,
      );
      return { ok: false, citekey, remapped: 0, exitCode: EXIT_USAGE };
    }
    only = { n, slug };
  }
  const count = await remapSections(paperRoot, citekey, only);
  process.stdout.write(
    `pensmith add: added ${citekey}; remapped ${count} section(s) (assigned_sources only).\n`,
  );
  return { ok: true, citekey, remapped: count };
}

export const addCommand = defineCommand({
  meta: {
    name: 'add',
    description: 'Ingest a source mid-paper (DOI, local PDF, or URL) and optionally remap sections.',
  },
  args: {
    source: { type: 'positional', description: 'DOI, local PDF path, or URL.', required: true },
    section: { type: 'string', description: 'Section number to remap onto (optional).' },
    slug: { type: 'string', description: 'Section slug paired with --section (optional).' },
    remap: { type: 'boolean', description: 'Remap onto sections without asking; `add --remap <citekey> --section N` remaps a source already in the bib.', default: false },
    yolo: { type: 'boolean', description: 'Skip the remap question (the source is added, no section is remapped).', default: false },
  },
  async run({ args }) {
    const paperRoot = projectRoot();
    const source = String(args.source);

    // (0) `pensmith add --remap <citekey> [--section N]` — remap a source that is
    //     already in CITATIONS.bib (the command a non-interactive add prints,
    //     RUN-12). Nothing is fetched or re-added.
    if (args.remap === true) {
      const known = await loadExistingCandidates(path.join(paperDir(paperRoot), 'CITATIONS.bib'));
      if (known.some((c) => c.citekey === source)) {
        return remapCommand(paperRoot, source, args.section, args.slug);
      }
    }

    // (1) Detect type + hydrate into a SourceCandidate.
    let candidate: SourceCandidate | null = null;

    if (isDoi(source)) {
      const norm = normalizeDoi(source);
      candidate = norm ? await crossrefFetchById(norm) : null;
    } else if (isHttpUrl(source)) {
      // URL path — checked BEFORE the local-PDF branch (audit #12: a URL ending
      // in .pdf used to fall into the local branch and crash fs.readFile with an
      // unhandled ENOENT). D-06 chokepoint routes through http.ts checkSsrf
      // (T-08-04-02): the hostname is DNS-resolved and RFC1918/loopback/link-local
      // addresses are blocked before the socket connects (source:'generic').
      if (isOfflineMode()) {
        // audit #11: --dry-run / offline mode must make ZERO external calls. URL
        // ingestion is the one add path with no cassette, so refuse it here.
        process.stderr.write(
          `pensmith add: URL ingestion requires network access and is disabled in ` +
          `offline / --dry-run mode. Source NOT added.\n`,
        );
        candidate = null;
      } else {
        try {
          // noCache:true guarantees a live fetch so res.bodyBytes is populated
          // (audit #29) — a PDF must be read byte-faithfully, never via the
          // UTF-8-decoded body string.
          const res = await httpFetch(source, { source: 'generic', noCache: true });
          const ct = (res.headers['content-type'] ?? '').toLowerCase();
          if (ct.includes('application/pdf') || source.toLowerCase().endsWith('.pdf')) {
            const buf = res.bodyBytes ?? Buffer.from(res.body, 'binary');
            const text = await extractPdfText(buf);
            const title = extractTitleHeuristic(text);
            if (title) {
              const hits = await crossrefSearch(title, { limit: 1 });
              candidate = hits[0] ?? null;
            }
          } else {
            const doi = scrapeDoiFromHtml(res.body);
            if (doi) candidate = await crossrefFetchById(doi);
          }
        } catch {
          candidate = null;
        }
      }
    } else if (source.toLowerCase().endsWith('.pdf') || fs.existsSync(path.resolve(source))) {
      // BYO LOCAL PDF — bytes-only chokepoint (T-08-04-03 path-traversal mitigation).
      // audit #30: guard the read so a missing/unreadable file yields a friendly
      // diagnostic, not a raw unhandled ENOENT stack trace.
      try {
        const buf = await fs.promises.readFile(path.resolve(source));
        const text = await extractPdfText(buf); // pdf-parse → pymupdf fallback (08-03)
        const title = extractTitleHeuristic(text);
        if (title) {
          const hits = await crossrefSearch(title, { limit: 1 });
          candidate = hits[0] ?? null;
        }
      } catch (e) {
        process.stderr.write(
          `pensmith add: could not read local PDF "${source}": ${(e as Error).message}\n`,
        );
        candidate = null;
      }
    } else {
      // Not a DOI, an http(s) URL, or a readable local .pdf — nothing to hydrate.
      candidate = null;
    }

    if (!candidate) {
      process.stdout.write(`pensmith add: could not hydrate "${source}". Source NOT added.\n`);
      return { ok: false };
    }

    // (2) verifyDoi when a DOI is present — a 404 flags the source unverified but
    //     it is STILL added with a warning (the Pass-1 verifier blocks compile on
    //     FABRICATED at verify time — T-08-04-04: add cannot smuggle a verified
    //     source past the verifier). Never let a transport throw abort the add.
    if (candidate.doi) {
      try {
        const v = await verifyDoi(candidate.doi);
        if (!v.valid) {
          process.stdout.write(
            `pensmith add: WARNING — DOI ${candidate.doi} did not verify (added as unverified; compile will re-check).\n`,
          );
        }
      } catch {
        // verification transport error — add proceeds, verifier re-checks later.
      }
    }

    // (3) + (4) Write CITATIONS.bib via the writeBibtex chokepoint. Load existing
    //     candidates, dedup the citekey, append, and re-serialize the whole file.
    const bibPath = path.join(paperDir(paperRoot), 'CITATIONS.bib');
    const existing = await loadExistingCandidates(bibPath);
    if (existing.some((c) => c.citekey === candidate.citekey)) {
      process.stdout.write(
        `pensmith add: WARNING — citekey "${candidate.citekey}" already in CITATIONS.bib (writeBibtex will collision-suffix).\n`,
      );
    }
    await writeBibtex([...existing, candidate], bibPath);

    // (5) Remap gate — `add-remap` in the gate registry (RUN-28, SRC-14).
    //     --remap remaps without asking; --yolo skips the remap; a run that
    //     cannot prompt skips it and prints the command to remap later (RUN-12)
    //     — the source is already in CITATIONS.bib, so the bib and library stay
    //     consistent either way. When --section/--slug are supplied, remap that
    //     one section; otherwise remap every section in STATE.json.
    let doRemap = args.remap === true;
    if (!doRemap) {
      const outcome = await runGate('add-remap', {
        yolo: args.yolo === true,
        question: {
          id: 'add-remap',
          kind: 'confirm',
          label: 'Source added. Remap sections to reference it?',
          default: false,
        },
      });
      if (outcome.kind === 'skipped') {
        process.stdout.write(
          `pensmith add: added ${candidate.citekey}; remap skipped (non-interactive); run ` +
            `pensmith add --remap ${candidate.citekey} --section N\n`,
        );
        return { ok: true, citekey: candidate.citekey, remapped: 0 };
      }
      doRemap = outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true;
    }

    if (!doRemap) {
      process.stdout.write(`pensmith add: added ${candidate.citekey}.\n`);
      return { ok: true, citekey: candidate.citekey, remapped: 0 };
    }
    const remap = await remapCommand(paperRoot, candidate.citekey, args.section, args.slug);
    return { ...remap, citekey: candidate.citekey };
  },
});

export default addCommand;
