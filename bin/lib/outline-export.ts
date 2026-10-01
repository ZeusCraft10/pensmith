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
//      tier, a summary that is the abstract's leading sentences up to 60 words,
//      labelled as an excerpt (no model call: D-12 adds no prompt slug for it),
//      why it is relevant (LIBRARY.json `why_relevant`) and the sections it
//      supports — every free-text value escaped, so the file holds no citation
//      and no markup the exporter would read as such;
//   5. exports ANNOTATED-BIBLIOGRAPHY.<ext> (its references are written in it:
//      `bibliography: 'none'`) and OUTLINE.<ext> (its citations rendered in the
//      style, a References list and export/CITATIONS.bib/.ris of the listed
//      sources) through exporter.ts exportDraft — the writers, the scrub and
//      the zero-trace scan of every written file;
//   6. records the registrar answers as last_verified and the re-checked
//      retraction statuses (the library writer), then writes
//      `.paper/ANNOTATED-BIBLIOGRAPHY.md` and the DONE-RECORD v2 outline record
//      (the sha256 of OUTLINE.md, CITATIONS.bib — as it stands after those
//      library writes — and the annotated bibliography, with the export files).
//
// No humanizer, detector score or plagiarism check runs: there is no prose.
// An annotated bibliography done did not write is never replaced (refused,
// naming the remedy), and a DONE-RECORD a newer pensmith wrote is never
// overwritten. runOutlineDone takes the style; it never resolves it (done's
// style resolution does, D-21-24).

import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
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
import { EXIT_BLOCKED, EXIT_ERROR } from './exit-codes.js';
import { bibEntryMarkdown, escapeMarkdownText } from './export/md-writer.js';
import { exportDraft, ExportFormatError, type ExportFormat } from './exporter.js';
import { canPrompt, declineGate, runGate } from './gates.js';
import { networkMode } from './http-mock.js';
import { LibraryNotFoundError, recordLastVerified, recordRetractionStatuses, tryLoadLibrary, type LibraryEntry } from './library.js';
import { plainText } from './markup.js';
import { outlinePath, readOutlineChecked } from './outline.js';
import { orderedOutlineSections, outlineSectionId, type OutlineDocument } from './outline-parse.js';
import { out } from './output-sink.js';
import { paperDir } from './paths.js';
import { registeredSectionsSync, sectionRegistryProblem } from './section-registry.js';
import { gateRefusals, loadBibliography, recheckKeys, recomputeGate, type LoadedBibliography } from './verify/gate.js';
import { decidedRetractions, type DecidedRetraction } from './verify/freshness.js';
import { runFreshnessForDraft } from './verify/pass1.js';

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
 */
export function abstractExcerpt(abstract: string | null | undefined, maxWords = 60): string | null {
  if (abstract === null || abstract === undefined) return null;
  const text = plainText(abstract).replace(/\s+/gu, ' ').trim();
  if (text === '') return null;
  const sentences = text.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/gu) ?? [text];
  const kept: string[] = [];
  let words = 0;
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence === '') continue;
    const count = sentence.split(' ').length;
    if (kept.length === 0 && count > maxWords) return `${sentence.split(' ').slice(0, maxWords).join(' ')} …`;
    if (words + count > maxWords) break;
    kept.push(sentence);
    words += count;
  }
  return kept.join(' ');
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
  /** LIBRARY.json's entries by citekey (tier, abstract, why_relevant). */
  readonly library: ReadonlyMap<string, LibraryEntry>;
  readonly style: string;
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
    const abstract = abstractExcerpt(lib?.abstract ?? (typeof bibEntry?.['abstract'] === 'string' ? bibEntry['abstract'] : null));
    const why = lib?.why_relevant ?? null;
    lines.push(
      `- **Type:** ${tierLabel(lib?.tier)}`,
      `- **Summary (abstract excerpt):** ${abstract !== null ? `“${escapeMarkdownText(abstract)}”` : 'no abstract available'}`,
      `- **Why it is relevant:** ${why !== null ? escapedLine(why) : 'not recorded'}`,
      `- **Supports:** ${s.sections.map((x) => `§${x.id} ${escapedLine(x.title)}`).join('; ')}`,
      '',
    );
  }
  return lines.join('\n');
}

/** The re-check of `unknown` retraction statuses (done.ts recheckUnknownRetractions, VRFY-15): refusal lines and the decided statuses. */
async function recheckUnknownRetractions(
  paperRoot: string,
  text: string,
  bib: LoadedBibliography,
): Promise<{ retracted: string[]; decided: Record<string, DecidedRetraction> }> {
  const none = { retracted: [] as string[], decided: {} as Record<string, DecidedRetraction> };
  if (networkMode().dryRun || !bib.exists || bib.problems.length > 0) return none;
  let results;
  try {
    results = await runFreshnessForDraft(text, bib.path, { bibEntries: bib.entries, root: paperRoot, onlyRecheck: true, record: false });
  } catch {
    return none;
  }
  const retracted = results
    .filter((r) => r.recheck?.status === 'retracted')
    .map(
      (r) =>
        `citation [@${r.citekey}] is RETRACTED — ${r.recheck?.details ?? 'it appears in Retraction Watch'} (re-checked now: LIBRARY.json had its retraction status unknown) — replace the source`,
    );
  return { retracted, decided: decidedRetractions(results) };
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
  const annotated = await annotatedBibliographyMarkdown({ title: outline.paper_title, sources, entries, library: libraryByKey, style: opts.style });
  if (extractCitedKeysForVerification(annotated).length > 0) {
    throw new ExportFormatError('the annotated bibliography would hold a citation the gate did not read — nothing was exported');
  }

  // 5. The exports: the annotated bibliography (its references are in it), then the outline.
  const annotatedPath = annotatedBibliographyPath(paperRoot);
  const annotatedExport = await exportDraft({ inputPath: annotatedPath, text: annotated, format, paperRoot, style: opts.style, bibliography: 'none' });
  let outlineExport;
  try {
    outlineExport = await exportDraft({
      inputPath: outlinePath(paperRoot),
      text,
      ...(gate.bib.text !== undefined ? { bibText: gate.bib.text } : {}),
      format,
      paperRoot,
      style: opts.style,
    });
  } catch (e) {
    rmSync(annotatedExport.outputPath, { force: true });
    throw e;
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
  await atomicWriteFile(annotatedPath, annotated);
  const exportDir = join(dir, 'export');
  const made = [annotatedExport.outputPath, outlineExport.outputPath].map((p) => `export/${basename(p)}`);
  const outlineSha = createHash('sha256').update(outlineBytes).digest('hex');
  const bibSha = fileSha256(join(dir, 'CITATIONS.bib'));
  const annotatedSha = sha256(annotated);
  // The same inputs exported before in another format: keep those files listed too.
  const prior = state.record;
  const same = prior !== null && prior.outline_sha256 === outlineSha && prior.bib_sha256 === bibSha && prior.annotated_sha256 === annotatedSha;
  const exports = [...new Set([...(same ? prior.outline_exports : []), ...made])];
  await writeOutlineDoneRecord(paperRoot, { doneAt: new Date().toISOString(), outlineSha256: outlineSha, bibSha256: bibSha, annotatedSha256: annotatedSha, exports });

  out(`pensmith done: outline only — wrote ${folder}/ANNOTATED-BIBLIOGRAPHY.md and exported ${listed(made.map((m) => `${folder}/${m}`))}\n`);
  if (networkMode().dryRun) {
    out(`pensmith done: this is a dry-run export (synthetic sources) in ${exportDir}; the real paper was not touched\n`);
  }
  return { ok: true, outputs: [annotatedPath, annotatedExport.outputPath, outlineExport.outputPath] };
}
