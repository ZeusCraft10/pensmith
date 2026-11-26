// bin/lib/export-gate.ts — what done checks before anything is exported.
//
// The export is bound to the bytes a gated compile produced and to the
// verdicts behind them, and the citations of the exact text being exported
// are checked again:
//
//   1. runExportBlockingGate — the compiled .paper/DRAFT.md, each section's
//      DRAFT.md and VERIFICATION.json, and each cited CITATIONS.bib entry must
//      match .paper/COMPILE-MANIFEST.json, the outline must hold the sections
//      compile used, and each section's recorded verdicts must pass the same
//      gate compile applies. Placeholder text never passes.
//   2. recheckExportText — Pass 1, and Pass 3 unless the caller just ran it,
//      on the text being exported, against CITATIONS.bib as it is now. A work
//      retracted since verify, an acknowledgement withdrawn, or a registry
//      that cannot be reached (offline: UNRESOLVED) blocks the export; a
//      warning no section's record gave (a new expression of concern, a
//      quotation whose source text can no longer be read) is reported.
//
// Neither --raw nor --yolo skips either step.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir, sectionAcknowledgements, sectionDraft, sectionVerificationRecord } from './paths.js';
import { readOutline } from './outline-read.js';
import { readCompileManifest, type ManifestSection } from './compile-manifest.js';
import { isPlaceholderText } from './placeholder.js';
import { isOfflineMode } from './network-mode.js';
import { parseBibForPass1, pass1CitedKeys, readBibText, type Bib } from './verify/pass1.js';
import { readAcknowledgements, type Acknowledgement } from './verify/acknowledgements.js';
import { checkCitationsAndQuotes } from './verify/check-text.js';
import { blockingReasons, citationWarnings, uncheckedQuoteWarning } from './verify/verdict-rows.js';
import {
  bibEntryHashes,
  readVerificationRecord,
  sha256,
  UNCHECKED_QUOTE,
  verificationGate,
  type ReadVerification,
  type VerificationRecord,
} from './verify/verification-record.js';

export interface ExportBlock {
  blocked: boolean;
  reasons: string[];
  /** What passes but must not look clean (quotations with no citation or no source text, acknowledged retractions, expressions of concern). */
  warnings: string[];
}

/** A section the manifest lists: its DRAFT.md bytes and recorded verdicts, or why they could not be read. */
interface SectionInputs {
  section: ManifestSection;
  draft: { bytes: Buffer } | { error: string };
  record: ReadVerification;
}

type SectionRef = Pick<ManifestSection, 'n' | 'slug'>;

const RECOMPILE = "run 'pensmith compile' again";

/** The bytes at `path`, or why they could not be read. */
function readBytes(path: string): { bytes: Buffer } | { error: string } {
  try {
    return { bytes: readFileSync(path) };
  } catch (err) {
    return { error: (err as NodeJS.ErrnoException).code ?? String(err) };
  }
}

function readSection(paperRoot: string, s: ManifestSection): SectionInputs {
  return {
    section: s,
    draft: readBytes(sectionDraft(s.n, s.slug, paperRoot)),
    record: readVerificationRecord(sectionVerificationRecord(s.n, s.slug, paperRoot)),
  };
}

/** The bibliography (`bibText`, else .paper/CITATIONS.bib; none is an empty library), or why it could not be read. */
async function readBib(paperRoot: string, bibText?: string): Promise<Bib | { error: string }> {
  try {
    return await parseBibForPass1(bibText ?? readBibText(paperRoot) ?? '');
  } catch (err) {
    return { error: `.paper/CITATIONS.bib could not be read (${err instanceof Error ? err.message : String(err)})` };
  }
}

/**
 * Whether the compiled draft (`compiled`: its bytes, else read from
 * .paper/DRAFT.md) may be exported: it is the one the last gated compile
 * wrote, from sections and a bibliography (`bibText`, else read from
 * .paper/CITATIONS.bib) that have not changed since, and every section's
 * recorded verdicts pass. Deterministic and offline; never throws.
 */
export async function runExportBlockingGate(paperRoot: string, compiled?: Buffer, bibText?: string): Promise<ExportBlock> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const blocked = (): ExportBlock => ({ blocked: reasons.length > 0, reasons, warnings });

  const draftPath = join(paperDir(paperRoot), 'DRAFT.md');
  let bytes: Buffer;
  try {
    bytes = compiled ?? readFileSync(draftPath);
  } catch {
    reasons.push("no compiled draft at .paper/DRAFT.md — run 'pensmith compile' first");
    return blocked();
  }
  // Placeholder text (PENSMITH_NO_LLM) is not a paper, whatever the verdicts say.
  if (isPlaceholderText(bytes.toString('utf8'))) {
    reasons.push('.paper/DRAFT.md is placeholder text (PENSMITH_NO_LLM), not a draft');
  }

  const read = readCompileManifest(paperRoot);
  if (!read.ok) {
    reasons.push(`.paper/DRAFT.md was not produced by a gated compile (${read.why}) — ${RECOMPILE}`);
    return blocked();
  }
  const manifest = read.manifest;
  if (sha256(bytes) !== manifest.draft_sha256) {
    reasons.push(`.paper/DRAFT.md changed after compile, and an edit to the compiled draft is never verified — make the change in its section, then verify that section and ${RECOMPILE}`);
  }

  // The outline must still hold exactly the sections compile used.
  let outlineSections: Array<{ n: number; slug: string }> = [];
  const outline = readOutline(paperRoot);
  if (outline.ok) outlineSections = outline.outline.sections;
  else reasons.push(`the outline cannot be checked against the compile (${outline.detail}) — ${RECOMPILE}`);
  const listed = (xs: ReadonlyArray<{ n: number; slug: string }>): string =>
    xs.slice().sort((a, b) => a.n - b.n).map((s) => `${s.n}-${s.slug}`).join(', ');
  if (outlineSections.length > 0 && listed(outlineSections) !== listed(manifest.sections)) {
    reasons.push(`the outline's sections (${listed(outlineSections)}) are not the ones compiled (${listed(manifest.sections)}) — ${RECOMPILE}`);
  }

  const sections = manifest.sections.map((s) => readSection(paperRoot, s));
  for (const { section: s, draft, record } of sections) {
    const where = `section ${s.n} (${s.slug})`;
    if ('error' in draft) {
      reasons.push(`${where}: DRAFT.md could not be read (${draft.error}) — ${RECOMPILE}`);
    } else {
      if (isPlaceholderText(draft.bytes.toString('utf8'))) {
        reasons.push(`${where}: DRAFT.md is placeholder text (PENSMITH_NO_LLM), not a draft`);
      }
      if (sha256(draft.bytes) !== s.draft_sha256) {
        reasons.push(`${where}: DRAFT.md changed after compile — verify it ('pensmith verify ${s.n}') and ${RECOMPILE}`);
      }
    }
    if (!record.ok) {
      reasons.push(`${where}: its recorded verdicts are ${record.problem === 'missing' ? 'missing' : `unreadable (${record.detail})`} — run 'pensmith verify ${s.n}' and ${RECOMPILE}`);
      continue;
    }
    if (record.sha256 !== s.verification_sha256) {
      reasons.push(`${where}: VERIFICATION.json changed after compile — ${RECOMPILE}`);
    }
    // The same gate compile applies, on the record compile accepted.
    const gate = verificationGate(record.record, where);
    reasons.push(...gate.reasons);
    warnings.push(...gate.warnings);
  }

  const bib = await readBib(paperRoot, bibText);
  if ('error' in bib) {
    reasons.push(bib.error);
    return blocked();
  }
  const now = bibEntryHashes(Object.keys(manifest.bib_entries), bib);
  for (const [key, hash] of Object.entries(manifest.bib_entries)) {
    if (now[key] !== hash) reasons.push(`the CITATIONS.bib entry for [@${key}] changed after compile — verify the sections that cite it and ${RECOMPILE}`);
  }
  return blocked();
}

/**
 * The acknowledgements that apply to `text` as a whole: a retracted work's
 * acknowledgement counts only when every section citing it acknowledged it,
 * since each acknowledgement covers its own section.
 */
function paperAcknowledgements(paperRoot: string, sections: readonly SectionRef[]): Acknowledgement[] {
  const perSection = sections.map((s) => {
    const draft = readBytes(sectionDraft(s.n, s.slug, paperRoot));
    // A missing draft cites nothing; the manifest check refuses it anyway.
    const text = 'bytes' in draft ? draft.bytes.toString('utf8') : '';
    return {
      cites: new Set(pass1CitedKeys(text)),
      acks: readAcknowledgements(sectionAcknowledgements(s.n, s.slug, paperRoot)).acknowledgements,
    };
  });
  const out: Acknowledgement[] = [];
  const keys = new Set(perSection.flatMap((s) => [...s.cites]));
  for (const key of keys) {
    const citing = perSection.filter((s) => s.cites.has(key));
    const acked = citing.map((s) => s.acks.filter((a) => a.citekey === key));
    if (acked.every((a) => a.length > 0)) out.push(...acked.flat());
  }
  return out;
}

/** The warnings the sections' records already gave: each work's verdict, and each quotation that had no source text. */
function reportedBySections(paperRoot: string, sections: readonly SectionRef[]): { verdicts: Set<string>; uncheckedQuotes: Set<string> } {
  const verdicts = new Set<string>();
  const uncheckedQuotes = new Set<string>();
  for (const s of sections) {
    const read = readVerificationRecord(sectionVerificationRecord(s.n, s.slug, paperRoot));
    const record: VerificationRecord | null = read.ok ? read.record : null;
    for (const c of record?.citations ?? []) verdicts.add(`${c.citekey}\u0000${c.verdict}`);
    for (const q of record?.quotes ?? []) if (UNCHECKED_QUOTE.has(q.verdict)) uncheckedQuotes.add(q.quote_id);
  }
  return { verdicts, uncheckedQuotes };
}

/**
 * Pass 1, and Pass 3 unless `pass3` is false (the caller already ran it on
 * these bytes), on the exact text being exported, against CITATIONS.bib as it
 * is now (`bibText`, else read). The manifest's sections, their drafts and
 * their records are read here, at the time of the check, not taken from an
 * earlier read: a section edited since then is checked as it is now. A
 * blocking verdict is a reason to refuse the export. What passes but must not
 * look clean, and that no section's record reported (a work under an
 * expression of concern since verify, a quotation whose source text can no
 * longer be read), is a warning. An unexpected failure of the check throws:
 * nothing is exported, and it is not a verdict.
 */
export async function recheckExportText(
  paperRoot: string,
  text: string,
  opts: { pass3?: boolean; label?: string; bibText?: string } = {},
): Promise<ExportBlock> {
  const label = opts.label ?? 'the exported text';
  const bib = await readBib(paperRoot, opts.bibText);
  if ('error' in bib) return { blocked: true, reasons: [bib.error], warnings: [] };
  const manifest = readCompileManifest(paperRoot);
  const sections = manifest.ok ? manifest.manifest.sections : [];
  const acknowledgements = paperAcknowledgements(paperRoot, sections);
  const checked = await checkCitationsAndQuotes(text, { bib, acknowledgements, pass3: opts.pass3 !== false });
  const reasons = blockingReasons([...checked.pass1, ...checked.pass3], label);
  if (reasons.length > 0 && isOfflineMode() && checked.pass1.some((r) => r.verdict === 'UNRESOLVED')) {
    reasons.push('done checks every citation against the registries before it exports, and the network is off (offline / --dry-run) — run it with network access');
  }
  const reported = reportedBySections(paperRoot, sections);
  const warnings = citationWarnings(checked.pass1.filter((r) => !reported.verdicts.has(`${r.citekey}\u0000${r.verdict}`)), label);
  const unchecked = checked.pass3.filter((r) => UNCHECKED_QUOTE.has(r.verdict) && !reported.uncheckedQuotes.has(r.quoteId));
  if (unchecked.length > 0) {
    warnings.push(`${uncheckedQuoteWarning(label, unchecked.length)}: ${unchecked.map((r) => `[@${r.citekey}] "${r.quoteSnippet}"`).join('; ')}`);
  }
  return { blocked: reasons.length > 0, reasons, warnings };
}
