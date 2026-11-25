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
//      that cannot be reached (offline: UNRESOLVED) blocks the export.
//
// Neither --raw nor --yolo skips either step.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir } from './paths.js';
import { parseOutline } from './outline-parse.js';
import { readCompileManifest, type ManifestSection } from './compile-manifest.js';
import { isPlaceholderText } from './placeholder.js';
import { isOfflineMode } from './network-mode.js';
import { citedKeys, findCitations } from './citation-grammar.js';
import { parseBibForPass1, type Bib } from './verify/pass1.js';
import { readAcknowledgements, type Acknowledgement } from './verify/acknowledgements.js';
import { checkCitationsAndQuotes } from './verify/check-text.js';
import { describeVerdictRow, isBlockingVerdict } from './verify/verdict-rows.js';
import { bibEntryHashes, readVerificationRecord, sha256, verificationGate } from './verify/verification-record.js';

export interface ExportBlock {
  blocked: boolean;
  reasons: string[];
  /** What passes but must not look clean (quotations with no citation, acknowledged retractions). */
  warnings: string[];
}

const RECOMPILE = "run 'pensmith compile' again";

function sectionDir(paperRoot: string, s: Pick<ManifestSection, 'n' | 'slug'>): string {
  return join(paperDir(paperRoot), 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
}

function fileSha(path: string): string | null {
  try {
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

/** The text of .paper/CITATIONS.bib; '' when there is none. */
export function readBibText(paperRoot: string): string {
  const bibPath = join(paperDir(paperRoot), 'CITATIONS.bib');
  return existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : '';
}

async function readBib(paperRoot: string, bibText?: string): Promise<{ bib: Bib; bibPath: string } | { error: string }> {
  const bibPath = join(paperDir(paperRoot), 'CITATIONS.bib');
  try {
    return { bib: await parseBibForPass1(bibText ?? readBibText(paperRoot)), bibPath };
  } catch (err) {
    return { error: `.paper/CITATIONS.bib could not be read (${err instanceof Error ? err.message : String(err)})` };
  }
}

/**
 * Whether the compiled draft (`compiled`: its bytes, or the text read from
 * .paper/DRAFT.md) may be exported: it is the one the last gated compile
 * wrote, from sections and a bibliography (`bibText`, else read from
 * .paper/CITATIONS.bib) that have not changed since, and every section's
 * recorded verdicts pass. Deterministic and offline; never throws.
 */
export async function runExportBlockingGate(paperRoot: string, compiled?: Buffer | string, bibText?: string): Promise<ExportBlock> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const blocked = (): ExportBlock => ({ blocked: reasons.length > 0, reasons, warnings });

  const draftPath = join(paperDir(paperRoot), 'DRAFT.md');
  let bytes: Buffer;
  try {
    bytes = compiled === undefined ? readFileSync(draftPath) : Buffer.isBuffer(compiled) ? compiled : Buffer.from(compiled, 'utf8');
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
  try {
    outlineSections = parseOutline(readFileSync(join(paperDir(paperRoot), 'OUTLINE.md'), 'utf8')).sections;
  } catch {
    reasons.push(`.paper/OUTLINE.md has no section table to check the compile against — ${RECOMPILE}`);
  }
  const listed = (xs: ReadonlyArray<{ n: number; slug: string }>): string =>
    xs.slice().sort((a, b) => a.n - b.n).map((s) => `${s.n}-${s.slug}`).join(', ');
  if (outlineSections.length > 0 && listed(outlineSections) !== listed(manifest.sections)) {
    reasons.push(`the outline's sections (${listed(outlineSections)}) are not the ones compiled (${listed(manifest.sections)}) — ${RECOMPILE}`);
  }

  for (const s of manifest.sections) {
    const where = `section ${s.n} (${s.slug})`;
    const dir = sectionDir(paperRoot, s);
    const draftFile = join(dir, 'DRAFT.md');
    if (existsSync(draftFile) && isPlaceholderText(readFileSync(draftFile, 'utf8'))) {
      reasons.push(`${where}: DRAFT.md is placeholder text (PENSMITH_NO_LLM), not a draft`);
    }
    if (fileSha(draftFile) !== s.draft_sha256) {
      reasons.push(`${where}: DRAFT.md changed after compile — verify it ('pensmith verify ${s.n}') and ${RECOMPILE}`);
    }
    const record = readVerificationRecord(join(dir, 'VERIFICATION.json'));
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
  } else {
    const now = bibEntryHashes(Object.keys(manifest.bib_entries), bib.bib);
    for (const [key, hash] of Object.entries(manifest.bib_entries)) {
      if (now[key] !== hash) reasons.push(`the CITATIONS.bib entry for [@${key}] changed after compile — verify the sections that cite it and ${RECOMPILE}`);
    }
  }
  return blocked();
}

/**
 * The acknowledgements that apply to `text` as a whole: a retracted work's
 * acknowledgement counts only when every section citing it acknowledged it,
 * since each acknowledgement covers its own section.
 */
function paperAcknowledgements(paperRoot: string, sections: ReadonlyArray<Pick<ManifestSection, 'n' | 'slug'>>): Acknowledgement[] {
  const perSection = sections.map((s) => {
    const dir = sectionDir(paperRoot, s);
    let draft = '';
    try {
      draft = readFileSync(join(dir, 'DRAFT.md'), 'utf8');
    } catch {
      // A missing draft cites nothing; the manifest check refuses it anyway.
    }
    return { cites: new Set(citedKeys(findCitations(draft))), acks: readAcknowledgements(join(dir, 'ACKNOWLEDGEMENTS.json')).acknowledgements };
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

/**
 * Pass 1, and Pass 3 unless `pass3` is false (the caller already ran it on
 * these bytes), on the exact text being exported, against CITATIONS.bib as it
 * is now (`bibText`, else read). A blocking verdict is a reason to refuse the
 * export.
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
  const acknowledgements = manifest.ok ? paperAcknowledgements(paperRoot, manifest.manifest.sections) : [];
  let checked;
  try {
    checked = await checkCitationsAndQuotes(text, { bib: bib.bib, bibPath: bib.bibPath, acknowledgements, pass3: opts.pass3 !== false });
  } catch (err) {
    // An unexpected failure is not a clean check.
    return { blocked: true, reasons: [`the citations of ${label} could not be checked (${err instanceof Error ? err.message : String(err)})`], warnings: [] };
  }
  const reasons = [...checked.pass1, ...checked.pass3]
    .filter((r) => isBlockingVerdict(r.verdict))
    .map((r) => `${label}: ${describeVerdictRow(r)} is ${r.verdict} — ${r.reason}`);
  if (reasons.length > 0 && isOfflineMode() && checked.pass1.some((r) => r.verdict === 'UNRESOLVED')) {
    reasons.push('done checks every citation against the registries before it exports, and the network is off (offline / --dry-run) — run it with network access');
  }
  // What passes with a warning was already reported from the sections' records.
  return { blocked: reasons.length > 0, reasons, warnings: [] };
}
