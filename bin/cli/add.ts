// bin/cli/add.ts — `pensmith add <doi|arXiv ID|pdf|url|file.bib|file.json>`.
//
// Ingests a source mid-paper into the library (.paper/LIBRARY.json, which
// writes CITATIONS.bib and CITATIONS.ris from it) and optionally remaps it
// onto sections:
//   - DOI       the registry record for exactly that DOI (arXiv's own DOIs
//               from arXiv); a record for another DOI is refused;
//   - arXiv ID  the arXiv record;
//   - PDF       a local file or a URL serving one: identified by a DOI or
//               arXiv ID printed in its opening whose work's title (word
//               for word) and byline head the PDF, else by a Crossref title
//               search whose hit's title heads it and whose author the
//               opening names, never the reference list or a work a notice
//               is about (bin/lib/source-hydrate.ts);
//               one it cannot identify is refused.
//               Its text is kept under .paper/sources/ for the quotation check;
//   - URL       an HTML page with a DOI in its citation <meta> tags;
//   - .bib      every entry, written back as it is in the file;
//   - .json     CSL-JSON items.
// A work the library already holds (by DOI, arXiv ID, PMID or ISBN) is not
// added again: add reports its key and remaps with it. A new work whose key is
// taken gets the next free one, and that key is the one remapped and printed.
//
// The remap (approval gate default-on, --yolo skips) touches only
// assigned_sources[] in a section PLAN.md, never status or
// verified_against_draft_hash: a verified section stays verified, and Pass 1
// still checks the new source when the section is verified again.
//
// Every network request goes through bin/lib/http.ts (SSRF guard, rate
// limits); a local file is read by path and handed to the PDF chokepoint as
// bytes.

import { defineCommand } from 'citty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractPdfText, MAX_PDF_BYTES } from '../lib/pdf-text.js';
import { bareArxivId, isDoi, normalizeDoi } from '../lib/doi.js';
import { updateFrontmatter } from '../lib/frontmatter.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { withLock } from '../lib/lock.js';
import { canAskInTerminal, confirmOrNo } from '../lib/prompts.js';
import { paperDir, sectionPlan } from '../lib/paths.js';
import { resolveSectionSlug } from '../lib/section-slug.js';
import { readOutline } from '../lib/outline-read.js';
import { fetch as httpFetch } from '../lib/http.js';
import { isOfflineMode } from '../lib/network-mode.js';
import { importBibliography, importCslJson, mergeCandidates, updateLibrary, type ImportResult } from '../lib/library.js';
import { hydrateArxiv, hydrateDoi, hydrateFromText, type Hydration } from '../lib/source-hydrate.js';
import { crossCheckRetractions } from '../lib/sources/retraction-cross-check.js';

/** True for an http(s) URL — a URL ending in .pdf must not be read as a local file. */
function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/**
 * Every refusal exits 2, so `pensmith add <doi> && pensmith verify` stops when
 * the source was not added.
 */
function refuse(): { ok: false } {
  process.exitCode = 2;
  return { ok: false };
}

/** The command's result: the key a source is filed under, or each key of an imported file. */
function addedResult(keys: string[]): { ok: true; citekey: string } | { ok: true; citekeys: string[] } {
  return keys.length === 1 ? { ok: true, citekey: keys[0]! } : { ok: true, citekeys: keys };
}

/** Refusal for a source that needs the network while offline / --dry-run. */
function reportOffline(what: string): { ok: false } {
  process.stderr.write(
    `pensmith add: ${what} requires network access and is disabled in ` +
    `offline / --dry-run mode. Source NOT added.\n`,
  );
  return refuse();
}

/** Scrape a DOI out of an HTML body's citation <meta> tags (best-effort). */
function scrapeDoiFromHtml(html: string): string | null {
  const meta = /<meta[^>]+(?:name|property)=["'](?:citation_doi|dc\.identifier|doi)["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (meta?.[1]) return normalizeDoi(meta[1]);
  // Only the first DOI-shaped text: a later one may be a cited work's.
  const inline = /\b10\.\d{4,9}\/[^\s"'<>]+/.exec(html);
  return inline ? normalizeDoi(inline[0]) : null;
}

/** What a source turned out to be. */
type Ingested =
  | { kind: 'work'; hydration: Hydration; pdfText?: string; file?: string }
  | { kind: 'bibtex'; text: string; file: string }
  | { kind: 'csl'; items: unknown[]; file: string }
  | { kind: 'refused'; result: { ok: false } };

/** The record a local PDF or PDF bytes name, keeping the text. */
async function fromPdf(bytes: Buffer, file: string): Promise<Ingested> {
  const text = await extractPdfText(bytes);
  if (isOfflineMode()) return { kind: 'refused', result: reportOffline('looking up the PDF') };
  return { kind: 'work', hydration: await hydrateFromText(text), pdfText: text, file };
}

async function ingest(source: string): Promise<Ingested> {
  if (isDoi(source)) {
    if (isOfflineMode()) return { kind: 'refused', result: reportOffline('DOI lookup') };
    return { kind: 'work', hydration: await hydrateDoi(source) };
  }

  if (isHttpUrl(source)) {
    if (isOfflineMode()) return { kind: 'refused', result: reportOffline('URL ingestion') };
    const abs = /arxiv\.org\/abs\/([^\s?#]+)/i.exec(source)?.[1];
    if (abs && bareArxivId(abs)) return { kind: 'work', hydration: await hydrateArxiv(abs) };
    try {
      // noCache: a PDF must be read as the bytes served, never as cached text.
      // A response past the PDF size limit is refused while it downloads.
      const res = await httpFetch(source, { source: 'generic', noCache: true, maxBodyBytes: MAX_PDF_BYTES });
      const ct = (res.headers['content-type'] ?? '').toLowerCase();
      if (ct.includes('application/pdf') || source.toLowerCase().endsWith('.pdf')) {
        return await fromPdf(res.bodyBytes ?? Buffer.from(res.body, 'binary'), source);
      }
      const doi = scrapeDoiFromHtml(res.body);
      if (doi) return { kind: 'work', hydration: await hydrateDoi(doi) };
      return { kind: 'work', hydration: { kind: 'none', reason: 'the page names no DOI' } };
    } catch (e) {
      return { kind: 'work', hydration: { kind: 'none', reason: `the page could not be read (${(e as Error).message})` } };
    }
  }

  const local = path.resolve(source);
  const ext = path.extname(source).toLowerCase();
  if (fs.existsSync(local) || ext === '.pdf' || ext === '.bib' || ext === '.json') {
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(local);
    } catch (e) {
      process.stderr.write(`pensmith add: could not read local ${ext === '.pdf' ? 'PDF' : 'file'} "${source}": ${(e as Error).message}\n`);
      return { kind: 'refused', result: refuse() };
    }
    if (ext === '.bib') return { kind: 'bibtex', text: bytes.toString('utf8'), file: source };
    if (ext === '.json') {
      try {
        const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
        const items = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown })?.items;
        if (Array.isArray(items)) return { kind: 'csl', items, file: source };
      } catch {
        // reported below
      }
      process.stderr.write(`pensmith add: "${source}" is not a CSL-JSON list of items. Source NOT added.\n`);
      return { kind: 'refused', result: refuse() };
    }
    try {
      return await fromPdf(bytes, source);
    } catch (e) {
      process.stderr.write(`pensmith add: could not read local PDF "${source}": ${(e as Error).message}\n`);
      return { kind: 'refused', result: refuse() };
    }
  }

  if (bareArxivId(source)) {
    if (isOfflineMode()) return { kind: 'refused', result: reportOffline('arXiv lookup') };
    return { kind: 'work', hydration: await hydrateArxiv(source) };
  }
  return { kind: 'work', hydration: { kind: 'none', reason: 'it is not a DOI, an arXiv ID, a URL or a readable file' } };
}

/** Store one hydrated work, keeping a PDF's text beside it; the library's result. */
async function storeWork(root: string, ing: Extract<Ingested, { kind: 'work' }> & { hydration: { kind: 'found' } }): Promise<ImportResult> {
  const { candidate } = ing.hydration;
  // Its own record says whether it is retracted; the library keeps the flag.
  crossCheckRetractions([candidate]);
  return updateLibrary(root, async (lib, at) => {
    const r = mergeCandidates(lib, [candidate], at, ing.file ? { via: { source: 'pdf', file: ing.file } } : {});
    const work = r.works[0];
    if (work && ing.pdfText) {
      const item = lib.entries.find((e) => e.id === work.citekey);
      if (item && !item.custom.local_text) {
        const rel = `sources/${work.citekey}.txt`;
        await atomicWriteFile(path.join(paperDir(root), rel), ing.pdfText);
        item.custom.local_text = rel;
      }
    }
    return { works: r.works, unidentified: [] };
  });
}

/**
 * Remap a citekey onto sections by appending to assigned_sources[] ONLY.
 * NEVER mutates status or verified_against_draft_hash. When `only` is
 * provided, remaps exactly that one section; otherwise iterates every section
 * in STATE.json. Idempotent — a citekey already present is skipped.
 */
async function remapSections(
  paperRoot: string,
  citekeys: readonly string[],
  only?: { n: number; slug: string },
): Promise<number> {
  let targets: Array<{ n: number; slug: string }>;
  if (only) {
    targets = [only];
  } else {
    const outline = readOutline(paperRoot);
    targets = outline.ok ? outline.outline.sections.map((s) => ({ n: s.n, slug: s.slug })) : [];
  }

  let updatedCount = 0;
  for (const { n, slug } of targets) {
    const planPath = sectionPlan(n, slug, paperRoot);
    if (!fs.existsSync(planPath)) continue;
    await withLock(planPath, async () => {
      const text = await fs.promises.readFile(planPath, 'utf8');
      const updated = updateFrontmatter(text, (fm) => {
        const existing = Array.isArray(fm.assigned_sources)
          ? (fm.assigned_sources as unknown[])
          : [];
        fm.assigned_sources = [...existing, ...citekeys.filter((k) => !existing.includes(k))];
      });
      await atomicWriteFile(planPath, updated);
    });
    updatedCount++;
  }
  return updatedCount;
}

export const addCommand = defineCommand({
  meta: {
    name: 'add',
    description: 'Ingest a source mid-paper (DOI, arXiv ID, local PDF, URL, .bib or CSL-JSON file) and optionally remap sections.',
  },
  args: {
    source: { type: 'positional', description: 'DOI, arXiv ID, local PDF path, URL, .bib or CSL-JSON file.', required: true },
    section: { type: 'string', description: 'Section number to remap onto (optional).' },
    slug: { type: 'string', description: 'Section slug paired with --section (optional).' },
    remap: { type: 'boolean', description: 'Remap the new source onto sections (skips the prompt).', default: false },
    yolo: { type: 'boolean', description: 'Skip the remap approval gate.', default: false },
  },
  async run({ args }) {
    const paperRoot = process.cwd();
    const source = String(args.source);

    // (1) Find the work, or read the file.
    const ing = await ingest(source);
    let result: ImportResult;
    if (ing.kind === 'refused') return ing.result;
    if (ing.kind === 'work') {
      const h = ing.hydration;
      if (h.kind === 'mismatch') {
        process.stdout.write(
          `pensmith add: the registry answered ${h.requested} with a different work (${h.returned}). ` +
          `Source NOT added. If ${h.returned} is the work you meant, add that DOI directly.\n`,
        );
        return refuse();
      }
      if (h.kind === 'none') {
        process.stdout.write(`pensmith add: could not hydrate "${source}": ${h.reason}. Source NOT added.\n`);
        return refuse();
      }
      result = await storeWork(paperRoot, { ...ing, hydration: h });
      if (result.works[0]?.status === 'added') {
        process.stdout.write(`pensmith add: found ${h.candidate.title} through ${h.via}.\n`);
      }
    } else {
      try {
        result = await updateLibrary(paperRoot, (lib, at) =>
          ing.kind === 'bibtex' ? importBibliography(lib, ing.text, at, ing.file) : importCslJson(lib, ing.items, at, ing.file));
      } catch (e) {
        process.stdout.write(`pensmith add: could not read "${source}": ${(e as Error).message}. Nothing added.\n`);
        return refuse();
      }
      if (result.works.length === 0) {
        process.stdout.write(`pensmith add: "${source}" has no entries. Nothing added.\n`);
        return refuse();
      }
    }

    // (2) Say what happened to each work, by the key it is filed under.
    for (const w of result.works) {
      process.stdout.write(
        w.status === 'added'
          ? `pensmith add: added ${w.citekey}.\n`
          : `pensmith add: "${w.title}" is already in the library as ${w.citekey}; nothing added.\n`,
      );
    }
    for (const key of result.unidentified) {
      process.stderr.write(
        `pensmith add: WARN — ${key} has no DOI, arXiv ID, PubMed ID or ISBN; verify cannot confirm it and will block it as UNRESOLVED.\n`,
      );
    }
    const keys = [...new Set(result.works.map((w) => w.citekey))];

    // (3) Remap gate. Remap when --remap is set OR (not --yolo AND the user
    //     confirms). When --section/--slug are supplied, remap that one section;
    //     otherwise remap every section in STATE.json.
    //     Without a terminal nothing is asked (stdin is not the user): the
    //     answer defaults to no, and add says how to remap.
    let doRemap = args.remap === true;
    if (!doRemap && args.yolo !== true) {
      if (canAskInTerminal(process.stderr)) {
        doRemap = await confirmOrNo({
          id: 'add-remap',
          kind: 'confirm',
          label: 'Source added. Remap sections to reference it?',
          default: false,
        });
      } else {
        // A path with spaces or shell characters is quoted, so the command runs as printed.
        const source = String(args.source);
        const shown = /^[\w@%+=:,./-]+$/.test(source) ? source : JSON.stringify(source);
        process.stdout.write(
          `pensmith add: not remapped onto any section. To have sections cite it, run ` +
          `\`pensmith add ${shown} --remap\` (add \`--section <N>\` for one section); the source is not added twice.\n`,
        );
      }
    }

    if (doRemap) {
      let only: { n: number; slug: string } | undefined;
      const secRaw = args.section;
      const slugRaw = args.slug;
      // With --section, remap only that section, its slug from --slug or
      // OUTLINE.md. One that cannot be resolved remaps nothing (never every
      // section); no --section remaps every section, by design.
      if (secRaw !== undefined) {
        const n = Number(secRaw);
        const explicit = typeof slugRaw === 'string' && slugRaw.length > 0 ? slugRaw : undefined;
        const slug =
          Number.isInteger(n) && n >= 1 ? resolveSectionSlug(paperRoot, n, explicit) : 'placeholder';
        if (!Number.isInteger(n) || n < 1 || (slug === 'placeholder' && explicit === undefined)) {
          process.stdout.write(
            `pensmith add: --section ${String(secRaw)} could not be resolved to a section slug ` +
            `(pass --slug, or run \`pensmith outline\` first) — no sections remapped.\n`,
          );
          return addedResult(keys);
        }
        only = { n, slug };
      }
      const count = await remapSections(paperRoot, keys, only);
      process.stdout.write(`pensmith add: remapped ${keys.join(', ')} onto ${count} section(s) (assigned_sources only).\n`);
    }

    return addedResult(keys);
  },
});

export default addCommand;
