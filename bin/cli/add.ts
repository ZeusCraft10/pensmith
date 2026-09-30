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
//   bring-your-own copy (.paper/sources/<citekey>.pdf, hashed) — once the PDF
//   is checked to BE that work (byo-ingest.ts checkPdfForRecord: its own
//   identifiers, or its title and first author). One that is not needs the
//   user's confirmation at the `pdf-attach-unmatched` gate (never --yolo;
//   without a terminal, exit 3 and nothing changes) and is recorded
//   `byo.asserted` (its text is never evidence). A work that already has its
//   own PDF keeps it unless `--replace-pdf`.
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
// verified_against_draft_hash (Pitfall 3 / A6). A source the citation verifier
// could never pass (retracted, or no identifier it resolves — D-18-37) is
// never mapped: the question is not asked, and an explicit --remap /
// --section is refused (exit 1; the source stays in the library).
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
import { runGate, declineGate } from '../lib/gates.js';
import { sectionPlan, projectRoot } from '../lib/paths.js';
import { resolveSectionArg, resolveSectionSlug } from '../lib/section-slug.js';
import { formatSectionId, parseSectionId, sameSectionId, sectionIdOf } from '../lib/section-id.js';
import { fetch as httpFetch, isOfflineEgressError, offlineLabel, SsrfBlockedError } from '../lib/http.js';
import { networkMode } from '../lib/http-mock.js';
import { EXIT_ERROR, EXIT_USAGE, PensmithError } from '../lib/exit-codes.js';
import { MAX_PDF_BYTES, extractPdf } from '../lib/pdf-text.js';
import { checkPdfResponse, hasPdfMagic } from '../lib/pdf-response.js';
import { identifyPdf } from '../lib/pdf-identify.js';
import { enrichOpenAccess } from '../lib/open-access.js';
import {
  classifySourceInput,
  identifierFromHtml,
  htmlBodyText,
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
  checkPdfForRecord,
} from '../lib/byo-ingest.js';
import { loadSectionInfos, rankSections, type SectionInfo, type SectionRelevance } from '../lib/section-relevance.js';
import type { SourceCandidate } from '../lib/schemas/source-candidate.js';
import { excludedRemedy, verifierBlindSpot } from '../lib/source-context.js';

const P = 'pensmith add';

/** The refusal line for a PDF that was not confidently identified (SRC-13). */
export const UNIDENTIFIED_PDF_MESSAGE = 'could not confidently identify this PDF — pass its DOI: pensmith add <doi> --pdf <file>';

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Where the identification steps print (the `add` verb's own lines by
 * default; research's prune question passes its own prefix and sinks).
 */
export interface AddIo {
  readonly prefix: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const ADD_IO: AddIo = { prefix: P, out, err };

type AddResult = Record<string, unknown> & { ok: boolean };

/** A failed add: the message is already printed; exit 1 (D-19-27). */
function failed(extra: Record<string, unknown> = {}): AddResult {
  return { ok: false, exitCode: EXIT_ERROR, added: false, ...extra };
}

/**
 * The dry-run / offline outcome of a lookup that needs the network (RUN-03 /
 * RUN-04): offline is a refusal (exit 1), --dry-run a preview (exit 0).
 */
function unavailable(e: unknown, message: (label: string) => string, io: AddIo = ADD_IO): AddResult {
  const label = isOfflineEgressError(e) ? offlineLabel(e) : 'offline';
  io.err(`${io.prefix}: ${message(label)}`);
  return label === 'dry-run' ? { ok: true, added: false, mode: label } : failed({ refused: true, mode: label });
}

/** A request for `what` (a URL fetch, a PDF's identification) that needs the network. */
function networkUnavailable(e: unknown, what: string, io: AddIo = ADD_IO): AddResult {
  return unavailable(e, (label) => `${what} unavailable (${label}) — nothing added${label === 'offline' ? '; re-run online to add it' : ''}.`, io);
}

/** An identifier lookup that needs the network — the Phase 17 wording (RUN-03). */
function verificationUnavailable(e: unknown, input: IdentifierInput, io: AddIo = ADD_IO): AddResult {
  const [kind, id] =
    input.kind === 'doi'
      ? ['DOI', input.doi]
      : input.kind === 'arxiv'
        ? ['arXiv', `arXiv:${input.arxiv}`]
        : input.kind === 'pmid'
          ? ['PMID', `PMID:${input.pmid}`]
          : ['ISBN', `isbn:${input.isbn}`];
  return unavailable(
    e,
    (label) => `${kind} verification unavailable (${label}) — ${id} NOT added${label === 'offline' ? '; re-run online to verify and add it' : ''}.`,
    io,
  );
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
async function remapSections(
  paperRoot: string,
  citekey: string,
  targets: ReadonlyArray<{ n: number; suffix?: string | undefined; slug: string }>,
): Promise<string[]> {
  const done: string[] = [];
  for (const { n, suffix, slug } of targets) {
    // The folder is found by its slug, so §1a is never §1's folder (GRND-09).
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
    done.push(formatSectionId(sectionIdOf(n, suffix)));
  }
  return done;
}

/** The section's id as the user types it (`2`, `1a`). */
function sectionIdText(s: { n: number; suffix?: string | undefined }): string {
  return formatSectionId(sectionIdOf(s.n, s.suffix));
}

function sectionLabel(s: SectionInfo): string {
  return `§${sectionIdText(s)} ${s.title}`;
}

function describeRelevant(ranked: readonly SectionRelevance[]): string {
  const rel = ranked.filter((r) => r.relevant);
  if (rel.length === 0) return 'no section of the outline shares its topic';
  return rel.map((r) => `${sectionLabel(r.section)} (shared: ${r.shared.slice(0, 4).join(', ') || 'title'})`).join('; ');
}

/**
 * Resolve `--section N` (and `--slug`) to one section. A number that matches
 * no section is a usage error — never a fallback to "every section" (audit
 * #25). The section's identity is then checked exactly as plan / write /
 * verify check it (section-slug.ts resolveSectionArg, D-18-38): a `--slug`
 * that is not section N's slug, or a STATE.json / OUTLINE.md disagreement, is
 * refused — a folder is found by its slug (GRND-09), so an unchecked slug
 * would write another section's PLAN.md while reporting §N.
 */
function resolveOne(
  paperRoot: string,
  sections: readonly SectionInfo[],
  secRaw: unknown,
  slugRaw: unknown,
): { n: number; suffix?: string | undefined; slug: string } {
  // GRND-09: `--section 1a` names the lettered section, as `plan 1a` does.
  const id = parseSectionId(secRaw);
  if (id === null) throw new PensmithError(`${P}: --section ${String(secRaw)} is not a section number (e.g. 2, or 1a for an inserted section)`, EXIT_USAGE);
  const explicit = typeof slugRaw === 'string' && slugRaw.length > 0;
  const known = sections.some((s) => sameSectionId(s, id)) || resolveSectionSlug(paperRoot, id.n, undefined, id.suffix) !== 'placeholder';
  if (!known && !explicit) {
    throw new PensmithError(
      `${P}: --section ${String(secRaw)} is not one of this paper's sections (pass --slug, or run \`pensmith outline\` first) — no section remapped`,
      EXIT_USAGE,
    );
  }
  const r = resolveSectionArg('add', paperRoot, secRaw, slugRaw);
  return { n: r.n, suffix: r.suffix, slug: r.slug };
}

/**
 * The remap step after a source is in the library. `explicitRemap`: the
 * `--remap` flag (remap without asking); `section`/`slug`: `--section N`.
 */
async function remapStep(
  paperRoot: string,
  entry: Pick<LibraryEntry, 'citekey' | 'title' | 'abstract'> &
    Partial<Pick<LibraryEntry, 'doi' | 'arxiv' | 'pmid' | 'isbn' | 'retracted' | 'synthetic' | 'byo' | 'authors' | 'editors'>>,
  args: { remap: boolean; one: { n: number; suffix?: string | undefined; slug: string } | null; yolo: boolean },
): Promise<{ remapped: string[]; refused?: boolean }> {
  const key = entry.citekey;
  // D-18-37: a section is only ever given a source the citation verifier can
  // check (source-context.ts verifierBlindSpot — the outline and planner's
  // rule): a retracted work always fails Pass 1, so mapping it would only
  // strand the section. It stays in the library, unmapped. (The user's own PDF
  // no registrar knows is checkable: Pass 1 passes it as OK-BYO.)
  // (Only a library entry is judged: the bare-key fallback carries no identifiers.)
  const blind = 'doi' in entry ? verifierBlindSpot(entry, networkMode().dryRun) : null;
  if (blind !== null) {
    const excluded = [{ citekey: key, reason: blind }];
    const explicit = args.one !== null || args.remap;
    (explicit ? err : out)(
      `${P}: ${key} is not mapped to any section — the citation verifier would not pass a citation of it (${blind}); ${excludedRemedy(excluded)}.`,
    );
    return { remapped: [], refused: explicit };
  }
  const sections = await loadSectionInfos(paperRoot);
  if (args.one !== null) {
    const one = args.one;
    const done = await remapSections(paperRoot, key, [one]);
    out(`${P}: ${key} mapped to §${sectionIdText(one)} (assigned_sources only)${done.length === 0 ? ' — its PLAN.md does not exist yet, nothing changed' : ''}.`);
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
        value: sectionIdText(r.section),
        label: sectionLabel(r.section),
        hint: r.shared.length > 0 ? `shares: ${r.shared.slice(0, 4).join(', ')}` : 'no shared topic words',
      })),
      default: relevant.map(sectionIdText),
    },
  });
  if (outcome.kind !== 'answered') {
    const why = outcome.kind === 'yolo' ? '--yolo' : 'non-interactive';
    // RUN-28 acceptance wording (REQUIREMENTS.md): the command to run later.
    out(`${P}: remap skipped (${why}); run pensmith add --remap ${key} --section N`);
    out(
      relevant.length === 0
        ? `${P}: ${key}: ${describeRelevant(ranked)}.`
        : `${P}: ${key}: relevant sections: ${describeRelevant(ranked)} — pensmith add --remap ${key} maps it to these.`,
    );
    return { remapped: [] };
  }
  const values = outcome.answer.kind === 'multiselect' ? outcome.answer.value : [];
  const chosen = sections.filter((s) => values.includes(sectionIdText(s)));
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

async function hydrateIdentifier(input: IdentifierInput, io: AddIo = ADD_IO): Promise<Hydrated> {
  const label = identifierLabel(input);
  // RUN-27: a reserved dry-run identifier is never a real source.
  const id = input.kind === 'doi' ? input.doi : input.kind === 'arxiv' ? input.arxiv : input.kind === 'isbn' ? input.isbn : null;
  if (id !== null && isReservedDryRunId(id) && !networkMode().dryRun) {
    io.err(`${io.prefix}: ${id} is a reserved dry-run identifier (synthetic --dry-run sources are never real citations). Source NOT added.`);
    return { result: failed({ refused: true }) };
  }
  let r;
  try {
    r = await lookupIdentifier(input);
  } catch (e) {
    if (isOfflineEgressError(e)) return { result: verificationUnavailable(e, input, io) };
    throw e;
  }
  if (r.kind === 'failed') {
    // A definitive but unusable record is not a transient failure: never imply a retry helps.
    io.err(
      r.permanent === true
        ? `${io.prefix}: ${label}: ${r.reason} — nothing added.`
        : `${io.prefix}: ${label}: lookup failed (${r.reason}) — nothing added.`,
    );
    return { result: failed() };
  }
  if (r.kind === 'not-found') {
    io.err(`${io.prefix}: ${label}: not found (${r.reason}) — nothing added; check the identifier.`);
    return { result: failed() };
  }
  return { candidate: r.candidate };
}

/** Identify fetched or local PDF bytes (strict: refuse unless confident). */
async function hydratePdfBytes(bytes: Buffer, what: string, io: AddIo = ADD_IO): Promise<Hydrated> {
  let ex;
  try {
    ex = await extractPdf(bytes);
  } catch (e) {
    io.err(`${io.prefix}: ${what}: could not be read (${(e as Error).message.split('\n')[0]}) — nothing added.`);
    return { result: failed() };
  }
  if (ex.imageOnly) {
    io.err(`${io.prefix}: ${what}: no extractable text (an image-only or scanned PDF) — pass its DOI: pensmith add <doi> --pdf <file>`);
    return { result: failed({ refused: true }) };
  }
  let id;
  try {
    id = await identifyPdf(ex, undefined, { pdf: bytes });
  } catch (e) {
    if (isOfflineEgressError(e)) return { result: networkUnavailable(e, `identifying ${what}`, io) };
    throw e;
  }
  if (id.kind !== 'identified') {
    io.err(`${io.prefix}: ${UNIDENTIFIED_PDF_MESSAGE}`);
    io.err(`${io.prefix}: ${what}: ${id.reason}`);
    return { result: failed({ refused: true }) };
  }
  io.out(`${io.prefix}: ${what} identified by ${id.via === 'title-search' ? `its title "${id.query}" and first author` : id.query}.`);
  return { candidate: id.candidate };
}

async function hydrateUrl(url: string, io: AddIo = ADD_IO): Promise<Hydrated> {
  let res;
  try {
    // noCache: a live fetch keeps the byte-faithful bodyBytes (audit #29).
    res = await httpFetch(url, { source: 'generic', noCache: true, maxBytes: MAX_PDF_BYTES });
  } catch (e) {
    if (isOfflineEgressError(e)) return { result: networkUnavailable(e, `fetching ${url}`, io) };
    if (e instanceof SsrfBlockedError) {
      io.err(`${io.prefix}: ${url}: refused — ${e.message}`);
      return { result: failed({ refused: true }) };
    }
    io.err(`${io.prefix}: ${url}: could not fetch it (${(e as Error).message.split('\n')[0]}) — nothing added.`);
    return { result: failed() };
  }
  const type = (res.headers['content-type'] ?? '').toLowerCase();
  const bytes = res.bodyBytes;
  const pdfish = /pdf/.test(type) || /\.pdf(?:$|[?#])/i.test(new URL(url).pathname) || (bytes !== undefined && hasPdfMagic(bytes));
  if (pdfish) {
    const check = checkPdfResponse(res);
    if (!check.ok) {
      io.err(`${io.prefix}: ${url}: ${check.reason} — nothing added.`);
      return { result: failed() };
    }
    return hydratePdfBytes(check.bytes, url, io);
  }
  if (res.status !== 200) {
    io.err(`${io.prefix}: ${url}: HTTP ${res.status} — nothing added.`);
    return { result: failed() };
  }
  const declared = identifierFromHtml(htmlBodyText(res));
  if (declared === null) {
    io.err(`${io.prefix}: ${url}: the page declares no DOI, arXiv id or PMID in its metadata — pass the identifier: pensmith add <doi>`);
    return { result: failed() };
  }
  io.out(`${io.prefix}: ${url} declares ${identifierLabel(declared)}.`);
  return hydrateIdentifier(declared, io);
}

/**
 * Identify one source the user names — a DOI, arXiv id, PMID, ISBN or URL —
 * exactly as `add` does (the registrar lookup with its three outcomes; a URL
 * through the one transport, a PDF answer checked and identified or refused),
 * WITHOUT writing anything. Every failure is printed through `io`; null is
 * returned. A local PDF or a folder is refused here (use `pensmith add`).
 * Used by research's prune question ("add a source you know", SRC-09).
 */
export async function identifySource(raw: string, io: AddIo): Promise<SourceCandidate | null> {
  const input = classifySourceInput(raw);
  if (input.kind === 'unknown') {
    io.err(`${io.prefix}: ${input.reason}`);
    return null;
  }
  if (input.kind === 'pdf' || input.kind === 'dir') {
    io.err(`${io.prefix}: ${raw}: a local ${input.kind === 'pdf' ? 'PDF' : 'folder'} is added with pensmith add ${raw} — nothing added here.`);
    return null;
  }
  const h = input.kind === 'url' ? await hydrateUrl(input.url, io) : await hydrateIdentifier(input, io);
  return 'candidate' in h ? h.candidate : null;
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
    pdf: { type: 'string', description: 'With an identifier: attach this PDF as the work\'s bring-your-own copy (checked to be that work).' },
    'replace-pdf': {
      type: 'boolean',
      description: 'With --pdf: replace the PDF the work already has.',
      default: false,
    },
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
        const { remapped, refused } = await remapStep(paperRoot, entry, remapArgs);
        if (refused === true) return failed({ citekey: entry.citekey, remapped: 0, refused: true });
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

    // A dry run reads none of the user's PDFs (GRND-19, D-18-29 — as `new
    // --pdfs` and research's own-source step): identifying one needs the
    // network, and its text would land in the data dir's cache. A preview
    // (RUN-03/04): exit 0, nothing added.
    if ((input.kind === 'dir' || input.kind === 'pdf') && networkMode().dryRun) {
      out(`${P}: ${input.raw}: skipped (--dry-run) — no PDF was read; nothing added.`);
      return { ok: true, added: false, mode: 'dry-run' };
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
        if (isOfflineEgressError(e)) return networkUnavailable(e, `identifying ${input.raw}`);
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
      // GRND-14: record the open-access PDF Pass 3 would check (an enrichment:
      // a failed or skipped lookup adds the work all the same).
      await enrichOpenAccess([candidate]);
      if (pdfArg !== null) {
        // SRC-13: the PDF must be this work, or the user says so.
        const checked = await checkPdfForRecord(pdfArg, candidate);
        if (!checked.matches) {
          const what = `${path.basename(pdfArg)} → ${candidate.title ?? source}`;
          err(`${P}: WARN — ${path.basename(pdfArg)}: ${checked.why}`);
          const outcome = await runGate('pdf-attach-unmatched', {
            yolo: args.yolo === true,
            detail: `${what}; nothing was changed`,
          });
          const yes = outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true;
          if (!yes) declineGate('pdf-attach-unmatched', `${P}: ${path.basename(pdfArg)} was not attached; nothing was changed`);
        }
        const r = await upsertWithPdf(paperRoot, candidate, checked, 'add', {
          replace: args['replace-pdf'] === true,
          asserted: !checked.matches,
        });
        for (const w of r.warnings) err(`${P}: WARN — ${w}`);
        key = r.citekey;
        status = r.status;
        if (!r.stored) {
          await refreshResearchSources(paperRoot);
          err(`${P}: ${path.basename(pdfArg)} was not attached to ${key}.`);
          return failed();
        }
        out(
          `${P}: attached ${path.basename(pdfArg)} to ${key} as its bring-your-own copy (.paper/sources/)` +
            `${checked.matches ? '' : ' — at your word: its text is not used to verify quotes'}.`,
        );
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
    if (status === 'added') out(`${P}: added ${key}.`);
    else out(`${P}: already in library as ${key}${status === 'merged' ? ' (its record was updated)' : ''}.`);
    if (title) out(`${P}: ${key}${title}`);
    // SRC-04 (review round 2): a retracted work is added, and said so — as research does.
    if (entry?.retracted === true || entry?.retraction_status === 'retracted') {
      err(`${P}: WARN — ${key} is RETRACTED${entry.retraction_details ? ` (${entry.retraction_details})` : ''}: it fails Pass 1 (blocking) if cited.`);
    }

    const { remapped, refused } = await remapStep(paperRoot, entry ?? { citekey: key, title: null, abstract: null }, remapArgs);
    const result = { citekey: key, added: status === 'added', alreadyInLibrary: status !== 'added', remapped: remapped.length };
    // The source is in the library; the mapping the user asked for was refused (exit 1).
    if (refused === true) return failed({ ...result, refused: true });
    return { ok: true, ...result };
  },
});

export default addCommand;
