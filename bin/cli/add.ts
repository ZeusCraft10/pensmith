// bin/cli/add.ts — `pensmith add <source>` verb (ERGO-06, RSCH-05b; SRC-13,
// SRC-14, SRC-15, D-19-20).
//
// Adds ONE work (or a folder of PDFs) mid-paper, identified correctly or not
// at all, then offers to map it onto the sections it is relevant to.
//
//   <source> is classified first (bin/lib/source-input.ts):
//     DOI / arXiv id / PMID / ISBN   → the registrar lookup (three outcomes:
//                                      found, not-found, failed — D-19-05);
//                                      arXiv abs/pdf URLs and doi.org links are
//                                      identifiers (nothing is downloaded)
//     http(s) URL                    → fetched through the one transport
//                                      (http.ts: SSRF guard, redirects, size
//                                      cap; offline = the exact recorded
//                                      answer or a named refusal); a PDF is
//                                      checked (checkPdfResponse) and
//                                      identified, an HTML page must declare
//                                      its DOI in its <meta> tags
//     local PDF                      → extracted in the SEC-02 worker and
//                                      identified (pdf-identify.ts); an
//                                      unidentified PDF is REFUSED — nothing
//                                      changes (a wrong work is never added)
//     folder                         → bring-your-own ingest of every PDF
//                                      (byo-ingest.ts; unidentified PDFs kept
//                                      unhydrated with a warning)
//   `--pdf <file>` with an identifier attaches that PDF as the work's
//   bring-your-own copy (.paper/sources/<citekey>.pdf, hashed).
//   Anything else is a usage error (exit 2) before any request.
//
// Writes go through bin/lib/library.ts (BRDTH-01: the one writer of
// LIBRARY.json / CITATIONS.bib / CITATIONS.ris), then RESEARCH.md's sources
// block is refreshed (research-md.ts). Every message uses the REAL citekey —
// the existing key for a known work, or the collision-suffixed one.
//
// Remap (SRC-14): the `add-remap` gate (bin/lib/gates.ts) offers a
// multi-select of the paper's sections with ONLY the relevant ones
// (section-relevance.ts: shared words with the section's title, purpose and
// plan) preselected; `--yolo` and runs without a terminal skip it and print
// the command. `add --remap <key> --section N` changes only §N;
// `add --remap <key>` alone remaps the relevant sections it lists. A remap
// appends to PLAN.md `assigned_sources` ONLY — never status or
// verified_against_draft_hash (Pitfall 3 / A6).
//
// Exit codes (D-19-27): a refusal, a failed or empty lookup, an SSRF refusal
// → 1; an unclassifiable argument → 2.

import { defineCommand } from 'citty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { upsertSources, tryLoadLibrary, assertLibraryReadable, type LibraryCandidate, type LibraryEntry } from '../lib/library.js';
import { refreshResearchSources } from '../lib/research-md.js';
import { isReservedDryRunId } from '../lib/doi.js';
import { updateFrontmatter, migrateFrontmatterText } from '../lib/frontmatter.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { withLock } from '../lib/lock.js';
import { runGate } from '../lib/gates.js';
import { sectionPlan, projectRoot } from '../lib/paths.js';
import { resolveSectionSlug } from '../lib/section-slug.js';
import { fetch as httpFetch, isOfflineEgressError, offlineLabel, SsrfBlockedError } from '../lib/http.js';
import { networkMode } from '../lib/http-mock.js';
import { EXIT_ERROR, EXIT_USAGE, PensmithError } from '../lib/exit-codes.js';
import { MAX_PDF_BYTES, extractPdf } from '../lib/pdf-text.js';
import { checkPdfResponse, hasPdfMagic } from '../lib/pdf-response.js';
import { identifyPdf } from '../lib/pdf-identify.js';
import {
  classifySourceInput,
  identifierFromHtml,
  identifierLabel,
  isIdentifierInput,
  lookupIdentifier,
  type IdentifierInput,
} from '../lib/source-input.js';
import {
  ingestByoPdf,
  ingestByoPdfs,
  listPdfsInDir,
  describeByoOutcome,
  upsertWithPdf,
} from '../lib/byo-ingest.js';
import { loadSectionInfos, rankSections, type SectionInfo, type SectionRelevance } from '../lib/section-relevance.js';
import type { SourceCandidate } from '../lib/schemas/source-candidate.js';

const P = 'pensmith add';

/** The refusal line for a PDF that was not confidently identified (SRC-13). */
export const UNIDENTIFIED_PDF_MESSAGE = 'could not confidently identify this PDF — pass its DOI: pensmith add <doi> --pdf <file>';

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

type AddResult = Record<string, unknown> & { ok: boolean };

/** A failed add: the message is already printed; exit 1 (D-19-27). */
function failed(extra: Record<string, unknown> = {}): AddResult {
  return { ok: false, exitCode: EXIT_ERROR, added: false, ...extra };
}

/** The dry-run / offline outcome of a lookup that needs the network (RUN-03 / RUN-04). */
function unavailable(e: unknown, what: string): AddResult {
  const label = isOfflineEgressError(e) ? offlineLabel(e) : 'offline';
  err(`${P}: ${what} unavailable (${label}) — nothing added${label === 'offline' ? '; re-run online to add it' : ''}.`);
  return label === 'dry-run' ? { ok: true, added: false, mode: label } : failed({ refused: true, mode: label });
}

// ---------------------------------------------------------------------------
// Remap (SRC-14).
// ---------------------------------------------------------------------------

/**
 * Append `citekey` to the assigned_sources[] of exactly `targets`. NEVER
 * touches status or verified_against_draft_hash (Pitfall 3 / A6). Idempotent.
 * Returns the sections whose PLAN.md exists (and so were updated or already
 * held the key).
 */
async function remapSections(paperRoot: string, citekey: string, targets: ReadonlyArray<{ n: number; slug: string }>): Promise<number[]> {
  const done: number[] = [];
  for (const { n, slug } of targets) {
    const planPath = sectionPlan(n, slug, paperRoot);
    if (!fs.existsSync(planPath)) continue;
    await withLock(planPath, async () => {
      // CONF-04: migrate a v0 PLAN.md (stamp schema_version) before mutating it.
      const text = migrateFrontmatterText('plan', await fs.promises.readFile(planPath, 'utf8'), planPath).text;
      let changed = false;
      const updated = updateFrontmatter(text, (fm) => {
        const existing = Array.isArray(fm.assigned_sources) ? (fm.assigned_sources as unknown[]) : [];
        if (!existing.includes(citekey)) {
          fm.assigned_sources = [...existing, citekey];
          changed = true;
        }
      });
      if (changed) await atomicWriteFile(planPath, updated);
    });
    done.push(n);
  }
  return done;
}

function sectionLabel(s: SectionInfo): string {
  return `§${s.n} ${s.title}`;
}

function describeRelevant(ranked: readonly SectionRelevance[]): string {
  const rel = ranked.filter((r) => r.relevant);
  if (rel.length === 0) return 'no section of the outline shares its topic';
  return rel.map((r) => `${sectionLabel(r.section)} (shared: ${r.shared.slice(0, 4).join(', ') || 'title'})`).join('; ');
}

/**
 * Resolve `--section N` to one section: --slug if given, else the paper's
 * sections (STATE.json + OUTLINE.md), else OUTLINE.md alone. A number that
 * matches no section is a usage error — never a fallback to "every section"
 * (audit #25).
 */
function resolveOne(paperRoot: string, sections: readonly SectionInfo[], secRaw: unknown, slugRaw: unknown): { n: number; slug: string } {
  const n = Number(secRaw);
  const explicit = typeof slugRaw === 'string' && slugRaw.length > 0 ? slugRaw : undefined;
  if (!Number.isInteger(n) || n < 1) throw new PensmithError(`${P}: --section ${String(secRaw)} is not a section number`, EXIT_USAGE);
  if (explicit) return { n, slug: explicit };
  const known = sections.find((s) => s.n === n);
  if (known) return { n, slug: known.slug };
  const slug = resolveSectionSlug(paperRoot, n, undefined);
  if (slug === 'placeholder') {
    throw new PensmithError(
      `${P}: --section ${String(secRaw)} is not one of this paper's sections (pass --slug, or run \`pensmith outline\` first) — no section remapped`,
      EXIT_USAGE,
    );
  }
  return { n, slug };
}

/**
 * The remap step after a source is in the library. `explicitRemap`: the
 * `--remap` flag (remap without asking); `section`/`slug`: `--section N`.
 */
async function remapStep(
  paperRoot: string,
  entry: Pick<LibraryEntry, 'citekey' | 'title' | 'abstract'>,
  args: { remap: boolean; one: { n: number; slug: string } | null; yolo: boolean },
): Promise<{ remapped: number[] }> {
  const key = entry.citekey;
  const sections = await loadSectionInfos(paperRoot);
  if (args.one !== null) {
    const one = args.one;
    const done = await remapSections(paperRoot, key, [one]);
    out(`${P}: ${key} mapped to §${one.n} (assigned_sources only)${done.length === 0 ? ' — its PLAN.md does not exist yet, nothing changed' : ''}.`);
    return { remapped: done };
  }
  if (sections.length === 0) {
    out(`${P}: no sections yet — map ${key} after \`pensmith outline\` with pensmith add --remap ${key} --section N`);
    return { remapped: [] };
  }
  const ranked = rankSections({ title: entry.title, abstract: entry.abstract }, sections);
  const relevant = ranked.filter((r) => r.relevant).map((r) => r.section);
  if (args.remap) {
    if (relevant.length === 0) {
      out(`${P}: ${key}: ${describeRelevant(ranked)} — nothing remapped; choose one with pensmith add --remap ${key} --section N`);
      return { remapped: [] };
    }
    const done = await remapSections(paperRoot, key, relevant);
    out(`${P}: ${key} mapped to ${relevant.map(sectionLabel).join(', ')} (assigned_sources only).`);
    return { remapped: done };
  }
  const outcome = await runGate('add-remap', {
    yolo: args.yolo,
    question: {
      id: 'add-remap',
      kind: 'multiselect',
      label: `Map ${key} to which sections? (relevant ones are preselected)`,
      options: ranked.map((r) => ({
        value: String(r.section.n),
        label: sectionLabel(r.section),
        hint: r.shared.length > 0 ? `shares: ${r.shared.slice(0, 4).join(', ')}` : 'no shared topic words',
      })),
      default: relevant.map((s) => String(s.n)),
    },
  });
  if (outcome.kind !== 'answered') {
    const why = outcome.kind === 'yolo' ? '--yolo' : 'non-interactive';
    out(`${P}: ${key}: remap skipped (${why}); relevant: ${describeRelevant(ranked)}.`);
    out(`${P}: to map it: pensmith add --remap ${key}${relevant.length === 0 ? ' --section N' : ''}   (or --section N for one section)`);
    return { remapped: [] };
  }
  const values = outcome.answer.kind === 'multiselect' ? outcome.answer.value : [];
  const chosen = sections.filter((s) => values.includes(String(s.n)));
  if (chosen.length === 0) {
    out(`${P}: ${key} added; no section remapped.`);
    return { remapped: [] };
  }
  const done = await remapSections(paperRoot, key, chosen);
  out(`${P}: ${key} mapped to ${chosen.map(sectionLabel).join(', ')} (assigned_sources only).`);
  return { remapped: done };
}

// ---------------------------------------------------------------------------
// Hydration.
// ---------------------------------------------------------------------------

type Hydrated = { candidate: SourceCandidate } | { result: AddResult };

async function hydrateIdentifier(input: IdentifierInput): Promise<Hydrated> {
  const label = identifierLabel(input);
  // RUN-27: a reserved dry-run identifier is never a real source.
  const id = input.kind === 'doi' ? input.doi : input.kind === 'arxiv' ? input.arxiv : input.kind === 'isbn' ? input.isbn : null;
  if (id !== null && isReservedDryRunId(id) && !networkMode().dryRun) {
    err(`${P}: ${id} is a reserved dry-run identifier (synthetic --dry-run sources are never real citations) — nothing added.`);
    return { result: failed({ refused: true }) };
  }
  let r;
  try {
    r = await lookupIdentifier(input);
  } catch (e) {
    if (isOfflineEgressError(e)) return { result: unavailable(e, `the lookup of ${label}`) };
    throw e;
  }
  if (r.kind === 'failed') {
    err(`${P}: ${label}: lookup failed (${r.reason}) — nothing added.`);
    return { result: failed() };
  }
  if (r.kind === 'not-found') {
    err(`${P}: ${label}: not found (${r.reason}) — nothing added; check the identifier.`);
    return { result: failed() };
  }
  return { candidate: r.candidate };
}

/** Identify fetched or local PDF bytes (strict: refuse unless confident). */
async function hydratePdfBytes(bytes: Buffer, what: string): Promise<Hydrated> {
  let ex;
  try {
    ex = await extractPdf(bytes);
  } catch (e) {
    err(`${P}: ${what}: could not be read (${(e as Error).message.split('\n')[0]}) — nothing added.`);
    return { result: failed() };
  }
  if (ex.imageOnly) {
    err(`${P}: ${what}: no extractable text (an image-only or scanned PDF) — pass its DOI: pensmith add <doi> --pdf <file>`);
    return { result: failed({ refused: true }) };
  }
  let id;
  try {
    id = await identifyPdf(ex);
  } catch (e) {
    if (isOfflineEgressError(e)) return { result: unavailable(e, `identifying ${what}`) };
    throw e;
  }
  if (id.kind !== 'identified') {
    err(`${P}: ${UNIDENTIFIED_PDF_MESSAGE}`);
    err(`${P}: ${what}: ${id.reason}`);
    return { result: failed({ refused: true }) };
  }
  out(`${P}: ${what} identified by ${id.via === 'title-search' ? `its title "${id.query}" and first author` : id.query}.`);
  return { candidate: id.candidate };
}

async function hydrateUrl(url: string): Promise<Hydrated> {
  let res;
  try {
    // noCache: a live fetch keeps the byte-faithful bodyBytes (audit #29).
    res = await httpFetch(url, { source: 'generic', noCache: true, maxBytes: MAX_PDF_BYTES });
  } catch (e) {
    if (isOfflineEgressError(e)) return { result: unavailable(e, `fetching ${url}`) };
    if (e instanceof SsrfBlockedError) {
      err(`${P}: ${url}: refused — ${e.message}`);
      return { result: failed({ refused: true }) };
    }
    err(`${P}: ${url}: could not fetch it (${(e as Error).message.split('\n')[0]}) — nothing added.`);
    return { result: failed() };
  }
  const type = (res.headers['content-type'] ?? '').toLowerCase();
  const bytes = res.bodyBytes;
  const pdfish = /pdf/.test(type) || /\.pdf(?:$|[?#])/i.test(new URL(url).pathname) || (bytes !== undefined && hasPdfMagic(bytes));
  if (pdfish) {
    const check = checkPdfResponse(res);
    if (!check.ok) {
      err(`${P}: ${url}: ${check.reason} — nothing added.`);
      return { result: failed() };
    }
    return hydratePdfBytes(check.bytes, url);
  }
  if (res.status !== 200) {
    err(`${P}: ${url}: HTTP ${res.status} — nothing added.`);
    return { result: failed() };
  }
  const declared = identifierFromHtml(res.body);
  if (declared === null) {
    err(`${P}: ${url}: the page declares no DOI, arXiv id or PMID in its metadata — pass the identifier: pensmith add <doi>`);
    return { result: failed() };
  }
  out(`${P}: ${url} declares ${identifierLabel(declared)}.`);
  return hydrateIdentifier(declared);
}

// ---------------------------------------------------------------------------
// The verb.
// ---------------------------------------------------------------------------

export const addCommand = defineCommand({
  meta: {
    name: 'add',
    description: 'Add a source mid-paper (DOI, arXiv id, PMID, isbn:, URL, local PDF, or a folder of PDFs) and map it to sections.',
  },
  args: {
    source: {
      type: 'positional',
      description: 'DOI, arXiv id, PMID:<id>, isbn:<ISBN>, URL, local PDF, or a folder of PDFs.',
      required: true,
    },
    pdf: { type: 'string', description: 'With an identifier: attach this PDF as the work\'s bring-your-own copy.' },
    section: { type: 'string', description: 'Map the source to this section number only.' },
    slug: { type: 'string', description: 'Section slug paired with --section (optional).' },
    remap: {
      type: 'boolean',
      description: 'Map without asking: to --section N, else to the relevant sections. `add --remap <citekey>` maps a source already in the library.',
      default: false,
    },
    yolo: { type: 'boolean', description: 'Skip the remap question (the source is added; no section is mapped).', default: false },
  },
  async run({ args }) {
    const paperRoot = projectRoot();
    const source = String(args.source);
    // RUN-12: a corrupt LIBRARY.json is one actionable line before any lookup,
    // download or write — the same check research runs.
    await assertLibraryReadable(paperRoot);
    // RUN-09: `--section N` must name one of the paper's sections — checked
    // before any lookup or write (exit 2 otherwise; never "every section").
    const one = args.section !== undefined ? resolveOne(paperRoot, await loadSectionInfos(paperRoot), args.section, args.slug) : null;
    const remapArgs = { remap: args.remap === true, one, yolo: args.yolo === true };

    // (0) `add --remap <citekey> [--section N]` — a source already in the library.
    if (args.remap === true) {
      const library = await tryLoadLibrary(paperRoot);
      const entry = library?.entries.find((e) => e.citekey === source);
      if (entry) {
        const { remapped } = await remapStep(paperRoot, entry, remapArgs);
        return { ok: true, citekey: entry.citekey, remapped: remapped.length };
      }
    }

    // (1) Classify before any request (RUN-09: an unusable argument is exit 2).
    const input = classifySourceInput(source);
    if (input.kind === 'unknown') throw new PensmithError(`${P}: ${input.reason}`, EXIT_USAGE);
    const pdfArg = typeof args.pdf === 'string' && args.pdf.trim() ? args.pdf.trim() : null;
    if (pdfArg !== null) {
      if (!isIdentifierInput(input)) {
        throw new PensmithError(`${P}: --pdf goes with an identifier: pensmith add <doi|arXiv id|PMID:…|isbn:…> --pdf <file>`, EXIT_USAGE);
      }
      if (!fs.existsSync(path.resolve(pdfArg))) throw new PensmithError(`${P}: --pdf ${pdfArg}: no such file`, EXIT_USAGE);
    }

    // (2) A folder: bring-your-own ingest of every PDF in it (SRC-15).
    if (input.kind === 'dir') {
      const files = await listPdfsInDir(input.path);
      if (files.length === 0) {
        err(`${P}: ${input.raw}: no PDF files in this folder — nothing added.`);
        return failed();
      }
      const outcomes = await ingestByoPdfs(paperRoot, files, { provenance: 'byo' });
      for (const o of outcomes) {
        const d = describeByoOutcome(o, P);
        (d.stream === 'stdout' ? out : err)(d.line);
      }
      const keys = outcomes.flatMap((o) => ('citekey' in o ? [o.citekey] : []));
      if (keys.length > 0) out(`${P}: map a source to sections with pensmith add --remap <citekey> [--section N]`);
      return keys.length > 0 ? { ok: true, citekeys: keys } : failed();
    }

    // (3) One work.
    let key: string;
    let status: 'added' | 'merged' | 'unchanged' | 'already-ingested';
    if (input.kind === 'pdf') {
      let o;
      try {
        o = await ingestByoPdf(paperRoot, input.path, { provenance: 'add', strict: true });
      } catch (e) {
        if (isOfflineEgressError(e)) return unavailable(e, `identifying ${input.raw}`);
        throw e;
      }
      if ('code' in o) {
        if (o.code === 'image-only') {
          err(`${P}: ${input.raw}: ${o.reason} — pass its DOI: pensmith add <doi> --pdf <file>`);
        } else if (o.code === 'unidentified') {
          err(`${P}: ${UNIDENTIFIED_PDF_MESSAGE}`);
          err(`${P}: ${input.raw}: ${o.reason}`);
        } else {
          err(`${P}: ${input.raw}: ${o.reason} — nothing added.`);
        }
        return failed({ refused: true });
      }
      if (o.via) out(`${P}: ${path.basename(input.path)} identified by ${o.via === 'title-search' ? `its title "${o.query ?? ''}" and first author` : o.query ?? o.via}.`);
      if (o.warning) err(`${P}: WARN — ${o.warning}`);
      key = o.citekey;
      status = o.status;
    } else {
      const h = input.kind === 'url' ? await hydrateUrl(input.url) : await hydrateIdentifier(input);
      if ('result' in h) return h.result;
      const candidate = h.candidate as LibraryCandidate;
      if (pdfArg !== null) {
        const r = await upsertWithPdf(paperRoot, candidate, pdfArg, 'add');
        for (const w of r.warnings) err(`${P}: WARN — ${w}`);
        key = r.citekey;
        status = r.status;
        out(`${P}: attached ${path.basename(pdfArg)} to ${key} as its bring-your-own copy (.paper/sources/).`);
      } else {
        // BRDTH-01: the ONE library writer dedups (DOI, arXiv, PMID, ISBN, the
        // version rule) and re-renders CITATIONS.bib / .ris; a known work keeps
        // its citekey (no engel2009a duplicate, RM-13).
        const upsert = await upsertSources(paperRoot, [candidate], { provenance: 'add' });
        key = upsert.outcomes[0]!.citekey;
        status = upsert.outcomes[0]!.status;
      }
    }

    await refreshResearchSources(paperRoot);
    const entry = (await tryLoadLibrary(paperRoot))?.entries.find((e) => e.citekey === key);
    const title = entry?.title ? ` — ${entry.title}${entry.year ? ` (${entry.year})` : ''}` : '';
    if (status === 'added') out(`${P}: added ${key}${title}.`);
    else out(`${P}: already in library as ${key}${title}${status === 'merged' ? ' (its record was updated)' : ''}.`);

    const { remapped } = await remapStep(paperRoot, entry ?? { citekey: key, title: null, abstract: null }, remapArgs);
    return { ok: true, citekey: key, added: status === 'added', alreadyInLibrary: status !== 'added', remapped: remapped.length };
  },
});

export default addCommand;
