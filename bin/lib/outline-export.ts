// bin/lib/outline-export.ts — outline-only mode's done (GRND-11, D-21-25,
// amending D-18-45's stop).
//
// An outline-only paper (`[project] mode = "outline"`) ends in a re-verified,
// zero-trace sourced outline and an annotated bibliography — never a draft.
// The router routes its approved outline to `done` until DONE-RECORD.json's
// outline record is current (done-record.ts outlineDoneState); done.ts hands
// such a paper to runOutlineDone, which:
//
//   1. reads the approved outline (OUTLINE.md, registered in STATE.json) and
//      lists its sources — the citekeys the outline assigns, in section order,
//      each once, with the sections it supports;
//   2. builds the outline document (title, thesis, each section's heading with
//      its role, word target, purpose and its sources as one citation) and runs
//      the ONE gate core (verify/gate.ts recomputeGate) over exactly that text,
//      with the listed keys as the allowed keys: every listed source is Pass-1
//      re-verified at its registrar (an old last_verified skips the cache,
//      VRFY-28), every `unknown` retraction status is re-checked live (as
//      done does, VRFY-15), and any attribution typed into a title, the thesis
//      or a purpose is read by the text scanners too. Any blocking row refuses
//      (EXIT_BLOCKED) and nothing is written;
//   3. asks `export-confirm` (--yolo skips it; without a terminal it refuses,
//      EXIT_APPROVAL);
//   4. writes the annotated bibliography — per source: the reference in the
//      paper's style (the same citeproc engine as the export, D-21-03), its
//      tier, a summary that is the leading sentences (up to 60 words) of the
//      abstract its REGISTRAR records — asked where Pass 1 asks it, never
//      LIBRARY.json's value (review round 3) — cut from the text and labelled
//      as an excerpt naming the registrar (no model call: D-12 adds no prompt
//      slug for it),
//      why it is relevant (LIBRARY.json `why_relevant`) and the sections it
//      supports — every free-text value escaped, so the file holds no citation
//      and no markup the exporter would read as such;
//   5. exports ANNOTATED-BIBLIOGRAPHY.<ext> (its references are written in it:
//      `bibliography: 'none'`) and OUTLINE.<ext> (its citations rendered in the
//      style, a References list and export/CITATIONS.bib/.ris of the listed
//      sources) through exporter.ts exportDraft — the writers, the scrub and
//      the zero-trace scan of every written file — as Markdown always, in the
//      requested format (default docx: `done --yolo` writes the .md and .docx
//      pairs, GRND-11) and in every format exported before (rebuilt, so no
//      export of older inputs stays beside these; review round 2);
//   6. records the registrar answers as last_verified and the re-checked
//      retraction statuses (the library writer), then writes the DONE-RECORD
//      outline record (the sha256 of OUTLINE.md, CITATIONS.bib — as it stands
//      after those library writes — and the annotated bibliography, with the
//      export files: this run's, and an earlier run's of the same inputs that
//      are still there) and only then `.paper/ANNOTATED-BIBLIOGRAPHY.md` — the
//      record names the text it replaces (`previous_annotated_sha256`), so a
//      done stopped between the two writes leaves a stale paper, never an
//      "edited" one (review round 1).
//
// The annotated bibliography is not prose the gate reads, and nothing in it
// may carry an attribution no section verified (carry-over 4): the
// references are the verified entries rendered by the export's engine, the
// titles are the outline's (gated in step 2), the abstract excerpt is the
// registrar's own text (review round 3), and each free-text value — the
// excerpt and LIBRARY.json's `why_relevant` (the source evaluator's model
// output; a shared paper's library may carry any text; a stubbed evaluator's
// "no relevance judgment was made" reason is never printed) — is
// read by the gate's text scanners, the quote reader and the identifier
// reader first: a value holding an author-date or numbered attribution, a
// direct quote or an identifier is omitted, and done says so.
//
// No humanizer, detector score or plagiarism check runs: there is no prose.
// An annotated bibliography done did not write is never replaced (refused,
// naming the remedy), and a DONE-RECORD a newer pensmith wrote is never
// overwritten. runOutlineDone takes the style; it never resolves it (done's
// style resolution does, D-21-24).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { extractCitedKeysForVerification } from './citation-token.js';
import { renderDocumentCitations } from './citations.js';
import { fileSha256 } from './compile-inputs.js';
import { readPaperModeSync } from './config.js';
import {
  annotatedBibliographyPath,
  editedAnnotatedReason,
  newerDoneRecordReason,
  outlineDoneState,
  writeOutlineDoneRecord,
} from './done-record.js';
import { EXIT_BLOCKED, EXIT_ERROR, PensmithError } from './exit-codes.js';
import { bibEntryMarkdown, escapeMarkdownText } from './export/md-writer.js';
import { exportDraft, exportPathFor, ExportFormatError, type ExportFormat } from './exporter.js';
import { canPrompt, declineGate, runGate } from './gates.js';
import { networkMode } from './http-mock.js';
import { LibraryNotFoundError, recordLastVerified, recordRetractionStatuses, tryLoadLibrary, type LibraryEntry } from './library.js';
import { plainText } from './markup.js';
import { outlinePath, readOutlineChecked } from './outline.js';
import { hasStubOutlineMarker, orderedOutlineSections, outlineSectionId, stubOutlineReason, type OutlineDocument } from './outline-parse.js';
import { out } from './output-sink.js';
import { paperDir } from './paths.js';
import { registeredSectionsSync, sectionRegistryProblem } from './section-registry.js';
import { gateRefusals, loadBibliography, recheckKeys, recomputeGate, TEXT_SCANNERS } from './verify/gate.js';
import { extractQuotes } from './quote-extractor.js';
import { findBareIdentifiers } from './doi.js';
import { recheckUnknownRetractions } from './done-gate.js';
import { registrarLookup } from './source-input.js';
import { sources as sourceAdapters } from './sources/index.js';
import type { LookupResult } from './sources/lookup.js';

/** The formats an outline export can be written in (exporter.ts ExportFormat). */
const OUTLINE_FORMATS: readonly ExportFormat[] = ['md', 'docx', 'pdf', 'latex'];

/** True when the paper at `paperRoot` is an outline-only paper (`[project] mode = "outline"`). Never throws. */
export function isOutlinePaper(paperRoot: string): boolean {
  try {
    return readPaperModeSync(paperRoot) === 'outline';
  } catch {
    return false;
  }
}

/** What runOutlineDone needs: done passes its flags and the resolved style. */
export interface OutlineDoneOptions {
  readonly paperRoot: string;
  /** The export format (`md`, `docx`, `pdf`, `latex`). */
  readonly format: string;
  /** The citation style: a bundled CSL key or an absolute `.csl` path (done resolves it, D-21-24). */
  readonly style: string;
  /** --yolo: skip the export confirmation. */
  readonly yolo: boolean;
}

/** What runOutlineDone did. */
export interface OutlineDoneResult {
  readonly ok: boolean;
  /** Set on a refusal (EXIT_BLOCKED, EXIT_ERROR); absent on success. */
  readonly exitCode?: number;
  readonly blocked?: boolean;
  /** The files written: the annotated bibliography and the exports (absolute paths). */
  readonly outputs: string[];
}

/** One source the outline assigns, with the sections it supports. */
export interface ListedSource {
  readonly key: string;
  /** The sections that list it: `{ id: '1', title: 'Introduction' }`, in section order. */
  readonly sections: ReadonlyArray<{ readonly id: string; readonly title: string }>;
}

/** The outline's sources: every assigned citekey, in section order, each once. */
export function listedSources(outline: OutlineDocument): ListedSource[] {
  const byKey = new Map<string, Array<{ id: string; title: string }>>();
  for (const s of orderedOutlineSections(outline)) {
    for (const key of s.assigned_sources) {
      const list = byKey.get(key) ?? [];
      if (!list.some((x) => x.id === outlineSectionId(s))) list.push({ id: outlineSectionId(s), title: s.title });
      byKey.set(key, list);
    }
  }
  return [...byKey].map(([key, sections]) => ({ key, sections }));
}

/**
 * The outline document an outline-only paper exports (and the gate judges):
 * `# title`, the thesis, then per section `## <id>. <title>`, its role and
 * word target, its purpose and its sources as one citation.
 */
export function outlineExportText(outline: OutlineDocument): string {
  const lines: string[] = [`# ${outline.paper_title.trim() || 'Outline'}`, ''];
  if (outline.thesis.trim() !== '') lines.push(`**Thesis:** ${outline.thesis.trim()}`, '');
  for (const s of orderedOutlineSections(outline)) {
    lines.push(`## ${outlineSectionId(s)}. ${s.title}`, '');
    const meta = [
      s.role !== undefined ? `*Role:* ${s.role}` : null,
      s.estimated_word_count !== undefined ? `*Word target:* ${s.estimated_word_count} words` : null,
    ].filter((m): m is string => m !== null);
    if (meta.length > 0) lines.push(meta.join(' · '), '');
    if (s.purpose !== undefined && s.purpose.trim() !== '') lines.push(s.purpose.trim(), '');
    lines.push(s.assigned_sources.length > 0 ? `*Sources:* [${s.assigned_sources.map((k) => `@${k}`).join('; ')}]` : '*Sources:* none assigned', '');
  }
  return lines.join('\n');
}

/**
 * The abstract's leading sentences, up to `maxWords` words (a first sentence
 * longer than that is cut at a word and marked `…`), markup removed and white
 * space collapsed; null when there is no abstract. No model call.
 *
 * The excerpt is a quotation, so it is CUT from the text, never rebuilt
 * (review round 3: rejoining pieces split at every period turned `3.5%` into
 * `3. 5%`): a sentence ends only at `.`, `!` or `?` (and any closing quote or
 * bracket) followed by white space or the end, so a decimal, an abbreviation
 * inside a word (`e.g.`), an e-mail address or a URL never ends one.
 */
export function abstractExcerpt(abstract: string | null | undefined, maxWords = 60): string | null {
  if (abstract === null || abstract === undefined) return null;
  const text = plainText(abstract).replace(/\s+/gu, ' ').trim();
  if (text === '') return null;
  const wordsIn = (t: string): number => t.split(' ').filter((w) => w !== '').length;
  let cut = 0;
  for (const m of text.matchAll(/[.!?]+["'”’)\]]*(?= |$)/gu)) {
    const end = m.index + m[0].length;
    if (wordsIn(text.slice(0, end)) > maxWords) break;
    cut = end;
  }
  if (cut > 0) return text.slice(0, cut);
  // No sentence end within the budget: the first maxWords words, marked.
  const words = text.split(' ');
  return words.length <= maxWords ? text : `${words.slice(0, maxWords).join(' ')} …`;
}

/**
 * A listed source's abstract as its registrar records it (review round 3: the
 * annotated bibliography quotes only that — never LIBRARY.json's `abstract`,
 * a local value a shared paper may carry with any text, which a merge may
 * also have taken from a preprint or an aggregator), or why there is none.
 */
export type RegistrarAbstract =
  | { readonly kind: 'found'; readonly text: string; readonly from: string }
  | { readonly kind: 'none'; readonly why: string };

const REGISTRAR_NAMES: Readonly<Record<string, string>> = { crossref: 'Crossref', datacite: 'DataCite', 'doi.org': 'doi.org', arxiv: 'arXiv', pubmed: 'PubMed' };

/**
 * The abstract the registrar of a listed source records — asked where Pass 1
 * asks it (a DOI at Crossref, else the agency doi.org names; else an arXiv id
 * at arXiv; else a PMID at PubMed) through the HTTP cache the gate's Pass-1
 * re-verification just filled — or why there is none. Never throws.
 */
export async function registrarAbstract(lib: LibraryEntry | undefined, entry: Record<string, unknown> | undefined): Promise<RegistrarAbstract> {
  if (networkMode().dryRun) return { kind: 'none', why: 'a dry run asks no registrar' };
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const doi = str(lib?.doi) || str(entry?.['DOI']);
  const arxiv = str(lib?.arxiv);
  const pmid = str(lib?.pmid) || str(entry?.['PMID']);
  let r: LookupResult;
  try {
    if (doi !== '') r = await registrarLookup(doi);
    else if (arxiv !== '') r = await sourceAdapters.arxiv.lookupById(arxiv);
    else if (pmid !== '') r = await sourceAdapters.pubmed.lookupById(pmid);
    else return { kind: 'none', why: 'it has no identifier a registrar answers for' };
  } catch {
    return { kind: 'none', why: 'the registrar did not answer' };
  }
  if (r.kind !== 'found') return { kind: 'none', why: r.kind === 'not-found' ? 'the registrar has no record of it' : 'the registrar did not answer' };
  const text = str(r.candidate.abstract);
  if (text === '') return { kind: 'none', why: "the registrar's record has no abstract" };
  return { kind: 'found', text, from: REGISTRAR_NAMES[r.candidate.source] ?? r.candidate.source };
}

/** A source's tier as the annotated bibliography names it. */
function tierLabel(tier: string | null | undefined): string {
  switch (tier) {
    case 'peer-reviewed':
      return 'peer-reviewed';
    case 'preprint':
      return 'preprint';
    case 'book':
      return 'book';
    case 'gov-report':
      return 'government report';
    case 'other':
      return 'other';
    default:
      return 'not evaluated';
  }
}

/** Plain text on one line, Markdown-escaped (never a citation, a link or markup). */
function escapedLine(s: string): string {
  return escapeMarkdownText(plainText(s).replace(/\s+/gu, ' ').trim());
}

/** What the annotated bibliography is built from. */
export interface AnnotatedBibliographyInput {
  readonly title: string;
  readonly sources: readonly ListedSource[];
  /** The parsed bibliography entries (CSL-JSON) of the listed keys. */
  readonly entries: ReadonlyArray<Record<string, unknown>>;
  /** LIBRARY.json's entries by citekey (tier, why_relevant — never its abstract). */
  readonly library: ReadonlyMap<string, LibraryEntry>;
  /** Each source's abstract as its registrar records it (registrarAbstract); a key absent here has none. */
  readonly abstracts: ReadonlyMap<string, RegistrarAbstract>;
  readonly style: string;
  /** Called once per free-text value left out (uncheckedAttribution), with the line done prints. */
  readonly onOmitted?: (line: string) => void;
}

/**
 * What a free-text value of the annotated bibliography carries that no
 * section verified — the gate's text findings (an author-date, numbered or
 * other unsupported attribution, an unparseable citation), a direct quote, a
 * bare identifier — as a short phrase, or null when it carries none.
 */
export function uncheckedAttribution(value: string): string | null {
  const finding = TEXT_SCANNERS.flatMap((scan) => scan(value))[0];
  if (finding !== undefined) return `${finding.verdict} \`${finding.text}\``;
  const quote = extractQuotes(value)[0];
  if (quote !== undefined) return `a direct quote ("${quote.text.slice(0, 40)}${quote.text.length > 40 ? '…' : ''}")`;
  const id = findBareIdentifiers(value)[0];
  if (id !== undefined) return `an identifier (${id.text})`;
  return null;
}

/**
 * `.paper/ANNOTATED-BIBLIOGRAPHY.md` (D-21-25): `# <title> — Annotated
 * Bibliography`, then per source, in outline order: its reference in the
 * style, then its type (tier), the abstract excerpt, why it is relevant and
 * the sections it supports. Every value read from the library or the outline
 * is escaped, so the text holds no citation (asserted by runOutlineDone).
 */
export async function annotatedBibliographyMarkdown(input: AnnotatedBibliographyInput): Promise<string> {
  const known = new Set(input.entries.map((e) => String(e['id'])));
  const cited = input.sources.filter((s) => known.has(s.key));
  const rendered = await renderDocumentCitations(input.entries, input.style, cited.map((s) => ({ items: [{ id: s.key }] })));
  const refs = new Map(rendered.bibliography.map((b) => [b.id, b] as const));
  const lines: string[] = [`# ${escapedLine(input.title) || 'Outline'} — Annotated Bibliography`, ''];
  for (const s of input.sources) {
    const ref = refs.get(s.key);
    const lib = input.library.get(s.key);
    const bibEntry = input.entries.find((e) => String(e['id']) === s.key);
    lines.push(ref !== undefined ? bibEntryMarkdown(ref) : escapedLine(s.key), '');
    // The excerpt is a quotation of the source: only the registrar's abstract
    // (review round 3), never LIBRARY.json's or the bib's, which nothing checks.
    const registrar = input.abstracts.get(s.key) ?? { kind: 'none', why: 'the registrar was not asked' };
    const abstract = registrar.kind === 'found' ? abstractExcerpt(registrar.text) : null;
    // A stubbed evaluator's reason (no relevance judgment was made) is no note.
    const stubbedWhy = typeof lib?.why_relevant === 'string' && /^LLM stubbed: /.test(lib.why_relevant);
    const why = stubbedWhy ? null : (lib?.why_relevant ?? null);
    // Carry-over 4: a free-text value that carries an attribution, a quote or
    // an identifier no section verified is left out, and done says so.
    const checked = (label: string, value: string | null): { value: string | null; omitted: string | null } => {
      if (value === null) return { value, omitted: null };
      const hit = uncheckedAttribution(plainText(value).replace(/\s+/gu, ' '));
      if (hit === null) return { value, omitted: null };
      input.onOmitted?.(`the annotated bibliography leaves out ${s.key}'s ${label}: it holds ${hit}, which no section verified`);
      // The file never repeats what was left out (done's note names it).
      return { value: null, omitted: 'left out — it holds an attribution, a quotation or an identifier no section verified' };
    };
    const a = checked('abstract excerpt', abstract);
    const w = checked('"why it is relevant" note', why);
    const summary =
      a.value !== null && registrar.kind === 'found'
        ? `- **Summary (abstract excerpt, from the ${registrar.from} record):** “${escapeMarkdownText(a.value)}”`
        : `- **Summary (abstract excerpt):** ${a.omitted ?? `no abstract available (${registrar.kind === 'none' ? registrar.why : "the registrar's record has no abstract"})`}`;
    lines.push(
      `- **Type:** ${tierLabel(lib?.tier)}`,
      summary,
      `- **Why it is relevant:** ${w.value !== null ? escapedLine(w.value) : (w.omitted ?? (stubbedWhy ? 'not recorded (no model judged it)' : 'not recorded'))}`,
      `- **Supports:** ${s.sections.map((x) => `§${x.id} ${escapedLine(x.title)}`).join('; ')}`,
      '',
    );
  }
  return lines.join('\n');
}

/** A refusal: the lines on stdout, the exit code returned. */
function refuse(head: string, reasons: readonly string[], exitCode: number, tail?: string): OutlineDoneResult {
  out(`pensmith done: ${head}\n`);
  for (const r of reasons) out(`  - ${r}\n`);
  if (tail !== undefined) out(`${tail}\n`);
  return { ok: false, exitCode, ...(exitCode === EXIT_BLOCKED ? { blocked: true } : {}), outputs: [] };
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`;
}

/**
 * done for an outline-only paper (see the module header). Returns
 * `{ ok: true, outputs }` once the annotated bibliography is written, both
 * exports are made and the outline record is written; a refusal returns
 * `{ ok: false, exitCode }` having written nothing. Throws ExportFormatError
 * for a format it cannot write, GateRefusedError from the confirmation, and
 * the exporter's errors (ZeroTraceError, …) after deleting what it wrote.
 */
export async function runOutlineDone(opts: OutlineDoneOptions): Promise<OutlineDoneResult> {
  const { paperRoot } = opts;
  const format = opts.format as ExportFormat;
  if (!OUTLINE_FORMATS.includes(format)) {
    throw new ExportFormatError(`cannot export "${opts.format}": the export formats are md, docx, pdf and latex`);
  }
  const dir = paperDir(paperRoot);
  const folder = basename(dir);

  // 1. The approved, registered outline and its sources.
  const read = readOutlineChecked(paperRoot);
  if (read.kind !== 'ok') {
    const why = read.kind === 'invalid' ? `${folder}/OUTLINE.md cannot be read (${read.error})` : `there is no approved outline in ${folder}/OUTLINE.md`;
    return refuse('outline only — nothing to export:', [`${why} — run \`pensmith outline\``], EXIT_ERROR);
  }
  const registered = registeredSectionsSync(paperRoot);
  if (registered === null || registered.length === 0) {
    return refuse('outline only — nothing to export:', [`the outline in ${folder}/OUTLINE.md is not approved yet — run \`pensmith outline\``], EXIT_ERROR);
  }
  const registry = sectionRegistryProblem(paperRoot);
  if (registry !== null) return refuse('BLOCKED — the outline export refused:', [registry], EXIT_BLOCKED);
  const outlineBytes = readFileSync(outlinePath(paperRoot));
  // VRFY-24 for outline mode (review round 3): an outline the stubbed model
  // wrote is placeholders — exported only as a --dry-run's labelled trial.
  if (!networkMode().dryRun && hasStubOutlineMarker(outlineBytes.toString('utf8'))) {
    return refuse('BLOCKED — the outline export refused:', [stubOutlineReason(folder)], EXIT_BLOCKED);
  }
  const outline = read.doc;
  const sources = listedSources(outline);
  if (sources.length === 0) {
    return refuse('BLOCKED — the outline export refused:', [`the outline assigns no sources — give its sections sources (\`pensmith research\`, \`pensmith add\`), then \`pensmith outline --force\``], EXIT_BLOCKED);
  }
  const state = outlineDoneState(paperRoot);
  if (state.state === 'edited') return refuse('BLOCKED — the outline export refused:', [editedAnnotatedReason(paperRoot)], EXIT_BLOCKED);
  if (state.state === 'newer') return refuse('the outline export refused:', [newerDoneRecordReason(paperRoot, state.newerVersion ?? 0)], EXIT_ERROR);

  // 2. The gate core over the exact outline text exported, the listed keys allowed.
  const keys = sources.map((s) => s.key);
  const text = outlineExportText(outline);
  const bib = loadBibliography(paperRoot);
  const rechecked = await recheckUnknownRetractions(paperRoot, text, bib);
  const refresh = await recheckKeys(paperRoot, keys);
  const gate = await recomputeGate({
    root: paperRoot,
    text,
    allowedKeys: new Set(keys),
    scope: { kind: 'paper' },
    dryRun: networkMode().dryRun,
    refresh,
    bib,
  });
  const reasons = [...rechecked.retracted, ...gateRefusals(gate, { kind: 'paper' })];
  if (reasons.length > 0) {
    return refuse(
      'BLOCKED — the outline export refused (every source the outline lists must pass verification):',
      reasons,
      EXIT_BLOCKED,
      'Replace or fix the flagged sources (`pensmith add`, then `pensmith outline --force` to re-allocate), and try again.',
    );
  }

  // 3. The export confirmation (--yolo skips it; without a terminal it refuses, EXIT_APPROVAL).
  const outcome = await runGate('export-confirm', {
    yolo: opts.yolo,
    detail: 'nothing was exported',
    ...(canPrompt()
      ? { question: { id: 'export-confirm' as const, kind: 'confirm' as const, label: 'Export the outline and its annotated bibliography?', default: true } }
      : {}),
  });
  if (outcome.kind === 'answered' && !(outcome.answer.kind === 'confirm' && outcome.answer.value === true)) {
    declineGate('export-confirm', 'export cancelled by user');
  }

  // 4. The annotated bibliography (no citation in it, by construction — asserted).
  const library = await tryLoadLibrary(paperRoot);
  const libraryByKey = new Map((library?.entries ?? []).map((e) => [e.citekey, e] as const));
  const wanted = new Set(keys);
  const entries = gate.bib.entries.filter((e) => wanted.has(String(e['id'])));
  const omitted: string[] = [];
  const abstracts = new Map<string, RegistrarAbstract>();
  for (const k of keys) abstracts.set(k, await registrarAbstract(libraryByKey.get(k), entries.find((e) => String(e['id']) === k)));
  const annotated = await annotatedBibliographyMarkdown({ title: outline.paper_title, sources, entries, library: libraryByKey, abstracts, style: opts.style, onOmitted: (l) => omitted.push(l) });
  for (const l of omitted) out(`pensmith done: note — ${l}\n`);
  if (extractCitedKeysForVerification(annotated).length > 0) {
    throw new ExportFormatError('the annotated bibliography would hold a citation the gate did not read — nothing was exported');
  }

  // 5. The exports, each format a pair — the annotated bibliography (its
  // references are in it), then the outline: the Markdown pair always, the
  // requested format's pair (GRND-11: `done --yolo` writes .md and .docx), and
  // again any format exported earlier, so no export of older inputs stays
  // beside these (review round 2; one that cannot be rebuilt is removed and
  // named). A failure of a required format removes what this run exported.
  const annotatedPath = annotatedBibliographyPath(paperRoot);
  const exportDirPath = join(dir, 'export');
  const required: ExportFormat[] = format === 'md' ? ['md'] : ['md', format];
  const extra = OUTLINE_FORMATS.filter((f) => !required.includes(f) && (existsSync(exportPathFor(exportDirPath, outlinePath(paperRoot), f)) || existsSync(exportPathFor(exportDirPath, annotatedPath, f))));
  const exportPair = async (f: ExportFormat): Promise<string[]> => {
    const annotatedExport = await exportDraft({ inputPath: annotatedPath, text: annotated, format: f, paperRoot, style: opts.style, bibliography: 'none' });
    try {
      const outlineExport = await exportDraft({
        inputPath: outlinePath(paperRoot),
        text,
        ...(gate.bib.text !== undefined ? { bibText: gate.bib.text } : {}),
        format: f,
        paperRoot,
        style: opts.style,
      });
      return [outlineExport.outputPath, annotatedExport.outputPath];
    } catch (e) {
      rmSync(annotatedExport.outputPath, { force: true });
      throw e;
    }
  };
  const madePaths: string[] = [];
  try {
    for (const f of required) madePaths.push(...(await exportPair(f)));
  } catch (e) {
    for (const m of madePaths) rmSync(m, { force: true });
    throw e;
  }
  for (const f of extra) {
    try {
      madePaths.push(...(await exportPair(f)));
    } catch (e) {
      if (!(e instanceof PensmithError)) throw e;
      for (const stale of [exportPathFor(exportDirPath, outlinePath(paperRoot), f), exportPathFor(exportDirPath, annotatedPath, f)]) rmSync(stale, { force: true });
      out(`pensmith done: note — the ${f} outline export held older inputs and could not be rebuilt (${(e.message.split('\n')[0] ?? '').replace(/^pensmith:\s*/, '')}); it was removed\n`);
    }
  }

  // 6. The library's stamps and statuses, the annotated bibliography, the record.
  if (Object.keys(gate.checkedAt).length > 0) {
    try {
      await recordLastVerified(paperRoot, gate.checkedAt);
    } catch (e) {
      if (!(e instanceof LibraryNotFoundError)) throw e;
    }
  }
  if (Object.keys(rechecked.decided).length > 0) {
    try {
      await recordRetractionStatuses(paperRoot, rechecked.decided);
    } catch (e) {
      if (!(e instanceof LibraryNotFoundError)) throw e;
    }
  }
  const exportDir = exportDirPath;
  const made = madePaths.map((p) => `export/${basename(p)}`);
  const outlineSha = createHash('sha256').update(outlineBytes).digest('hex');
  const bibSha = fileSha256(join(dir, 'CITATIONS.bib'));
  const annotatedSha = sha256(annotated);
  // The same inputs exported before in another format: keep those files
  // listed too. "Same" is the bibliography this run's gate judged (the one the
  // last done left) — this run's own last_verified stamps never make the
  // earlier exports stale.
  const prior = state.record;
  const judgedBibSha = gate.bib.text !== undefined ? sha256(gate.bib.text) : '';
  const same = prior !== null && prior.outline_sha256 === outlineSha && prior.bib_sha256 === judgedBibSha && prior.annotated_sha256 === annotatedSha;
  // An earlier export that is gone (cleaned, deleted) is not listed: the
  // record would never be current again (review round 1).
  const kept = same ? prior.outline_exports.filter((p) => existsSync(join(dir, p))) : [];
  const exports = [...new Set([...kept, ...made])];
  // The record first, naming the text it replaces; then the file (see the header).
  const previous = existsSync(annotatedPath) ? fileSha256(annotatedPath) : '';
  await writeOutlineDoneRecord(paperRoot, {
    doneAt: new Date().toISOString(),
    outlineSha256: outlineSha,
    bibSha256: bibSha,
    annotatedSha256: annotatedSha,
    ...(previous !== '' ? { previousAnnotatedSha256: previous } : {}),
    exports,
  });
  await atomicWriteFile(annotatedPath, annotated);

  out(`pensmith done: outline only — wrote ${folder}/ANNOTATED-BIBLIOGRAPHY.md and exported ${listed(made.map((m) => `${folder}/${m}`))}\n`);
  if (networkMode().dryRun) {
    out(`pensmith done: this is a dry-run export (synthetic sources) in ${exportDir}; the real paper was not touched\n`);
  }
  return { ok: true, outputs: [annotatedPath, ...madePaths] };
}
