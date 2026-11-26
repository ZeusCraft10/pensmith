// bin/lib/revise.ts — the one revise path, shared by the plugin and the CLI.
//
// `pensmith revise` and `pensmith plan <n> --revise` both call runRevise, so
// the two tiers cannot diverge. The flow:
//
//   1. Read sections/<N>/VERIFICATION.md (with the parser compile uses) for the
//      FIRST failing citation (FABRICATED / MIS-CITED / NOT_FOUND / RETRACTED),
//      in order of appearance. Other blocking verdicts are named, not repaired.
//   2. Load the PLAN.md frontmatter: assigned_sources and the section's voice
//      hint, which go into the prompt with the works LIBRARY.json holds for
//      those sources (title, authors, year, venue, abstract), as fenced data.
//   3. Ask the model (the hash-pinned revise-swap prompt) for a swap or a
//      remove, as structured JSON. The answer is parsed with a strict zod
//      schema and rejected unless the action is swap or remove and any
//      replacement key is in assigned_sources, so no new citekey ever enters
//      DRAFT.md.
//   4. Approval gate (default-on, PRD §19): show the change, with the
//      replacement's abstract, and ask. Skipped under --yolo. Without a
//      terminal the checked proposal is kept (.paper/gates/revise-<N>.json,
//      bound to the DRAFT.md and VERIFICATION.md it was made from) and
//      returned as pending; `pensmith gate answer <ref> approve` applies
//      exactly that change, with no new model call.
//   5. On accept: `swap` replaces the flagged key inside each citation that
//      cites it (prefix and locator kept). `remove` is mechanical too (no
//      model rewrite). For a misquotation (a Pass-3 NOT_FOUND row) it deletes
//      the quotation, with the sentence or block quote that holds it, and
//      leaves the work's other citations alone; a quotation that also cites a
//      work Pass 3 found it in stays, cited to that work. For a failed
//      citation it deletes the key from its clusters, or the whole bracketed
//      citation when it is the only key, and every quotation attributed to
//      that key alone: removing only the key would leave the quotation in
//      quote marks with nothing to check it against. A patch that changes
//      nothing is not applied. DRAFT.md is written through atomicWriteFile,
//      and PLAN.md's verified_against_draft_hash is reset to null under a
//      lock, so verify must run again.
//   6. --yolo retries the same path up to 2 more times; when every proposal
//      is invalid it writes a RETRY_EXHAUSTED verdict to VERIFICATION.md.
//
// --research merges the query's findings into the library (.paper/LIBRARY.json,
// which writes CITATIONS.bib; each records the section as its provenance),
// appends them to the project-level .paper/RESEARCH.md, and appends a provenance row
// to sections/<N>/RESEARCH-LOG.md (query, adapter, hit count, citekeys added,
// ISO timestamp). RESEARCH-LOG.md is the only section-level file --research
// creates; no other section's files are touched.
//
// Every write goes through atomicWriteFile, never raw fs.

import { z } from 'zod/v4';
import { readFileSync, existsSync } from 'node:fs';
import { atomicWriteFile } from './atomic-write.js';
import { updateFrontmatter, parseFrontmatter } from './frontmatter.js';
import { withLock } from './lock.js';
import {
  citationsOf,
  clusterWithoutKey,
  dropCitedKey,
  findCitations,
  findQuotes,
  paragraphBreaks,
  renameCitedKey,
  sentenceSpan,
  type Citation,
  type Quote,
} from './citation-grammar.js';
import { oneLine, parseVerdictRowDetails, type VerdictRow } from './verify/verdict-rows.js';
import { addToLibrary, loadLibrary, type Library } from './library.js';
import { renderSourceContext, sourceContext, type SourceContextEntry } from './source-context.js';
import { stripFenceMarkers } from './untrusted-fence.js';
import { sectionDraft, sectionPlan, sectionVerification, sectionResearch, paperDir } from './paths.js';
import { assignedSourcesFrom } from './plan-status.js';
import type { SourceCandidate } from './schemas/source-candidate.js';
import { closeGate, gateStillApplies, openGate, readGate, type GateRecord } from './gates.js';
import { sha256 } from './verify/verification-record.js';

// --yolo retry cap: 2 retries → 3 total attempts, then RETRY_EXHAUSTED.
const YOLO_RETRY_CAP = 2;

/** The verifier verdicts that --revise repairs. */
const FAILING_VERDICTS: ReadonlySet<string> = new Set(['FABRICATED', 'MIS-CITED', 'NOT_FOUND', 'RETRACTED']);
/** FAILING_VERDICTS as message text: `FABRICATED/MIS-CITED/...`. */
const FAILING_VERDICT_LIST = [...FAILING_VERDICTS].join('/');

/** The revise-swap answer (its JSON Schema is sent as the structured output format). */
export const ReviseSwapSchema = z.object({
  action: z.enum(['swap', 'remove']),
  flagged_citekey: z.string(),
  replacement_citekey: z.string().nullable(),
  rationale: z.string(),
  patch: z.object({
    before_excerpt: z.string(),
    after_excerpt: z.string(),
  }).strict(),
}).strict();
export type ReviseSwapProposal = z.infer<typeof ReviseSwapSchema>;

/** Variables handed to the LLM proposeSwap seam (mirror the prompt's {{vars}}). */
export interface ReviseSwapVars {
  flagged_citekey: string;
  verifier_reason: string;
  claim_context: string;
  /** The section's assigned works, rendered as fenced JSON (source-context.ts). */
  available_sources: string;
  voice_hint: string;
}

/** What the approval gate is shown besides the proposal. */
export interface ReviseGateContext {
  /** The work a swap would cite instead, as LIBRARY.json holds it (absent when it holds no record of it). */
  replacement?: SourceContextEntry;
}

/** A research hit the --research adapter returns (loose superset of SourceCandidate). */
export interface ResearchHit {
  citekey: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  source?: SourceCandidate['source'];
}

export interface ReviseOptions {
  paperRoot: string;
  n: number;
  slug: string;
  yolo: boolean;
  /** Section-scoped additional research query. */
  research?: string;
  /**
   * LLM call seam. Returns the raw strict-JSON string the revise-swap prompt
   * asks for. Default (production) loads the hash-pinned prompt + invokes the
   * model; tests/CI inject a cassette-backed function (no live LLM).
   */
  proposeSwap?: (vars: ReviseSwapVars) => Promise<string>;
  /**
   * Approval-gate seam (default-on, PRD §19). Default uses @clack/prompts in a
   * TTY (exit code 3 in a non-TTY without --yolo). Tests inject a boolean.
   */
  approve?: (proposal: ReviseSwapProposal, context: ReviseGateContext) => Promise<boolean>;
  /** --research adapter seam. Default uses bin/lib/sources/*. */
  researchAdapter?: (query: string) => Promise<ResearchHit[]>;
}

export interface ReviseResult {
  /** The action the LLM proposed for the accepted/last proposal. */
  action: 'swap' | 'remove' | null;
  /** True iff a patch was applied to DRAFT.md (and the hash reset). */
  accepted: boolean;
  flagged_citekey: string | null;
  replacement_citekey: string | null;
  /** True iff --yolo exhausted its retry budget. */
  retryExhausted: boolean;
  /** Why a proposal was rejected (membership guard / invalid shape), if any. */
  rejectedReason?: string;
  /** True iff a --research query was applied. */
  researchApplied: boolean;
  /** Human-readable summary for the CLI / workflow narration. */
  message: string;
  /** The change kept for the user's approval, when there was no terminal to ask in. */
  pending?: GateRecord;
  /** What the pending decision shows: the change and the replacement work. */
  pendingChange?: string;
  /** True when the user rejected the change at the approval gate. */
  rejected?: boolean;
}


// ---------------------------------------------------------------------------
// VERIFICATION.md parsing — first failing citation, in appearance order.
// ---------------------------------------------------------------------------

interface FailingCitation {
  citekey: string;
  reason: string;
  /**
   * For a misquotation (a Pass-3 row): the start of the quotation, and the
   * other cited works Pass 3 found it in.
   */
  misquoted?: { start: string; foundIn: string[] };
}

/**
 * Find the FIRST failing citation in VERIFICATION.md (one at a time, in order
 * of appearance), read with the parser compile and done use, so every key
 * compile blocks on is found here too. Returns null when the
 * section has no FABRICATED / MIS-CITED / NOT_FOUND / RETRACTED citation.
 */
export function firstFailingCitation(verificationMd: string): FailingCitation | null {
  const rows = parseVerdictRowDetails(verificationMd);
  const row = rows.find((r) => FAILING_VERDICTS.has(r.verdict));
  if (!row) return null;
  const failing: FailingCitation = { citekey: row.citekey, reason: `${row.verdict}: ${row.detail}` };
  if (row.quote !== undefined) {
    const foundIn = rows.filter((r) => r.verdict === 'OK' && r.quote === row.quote && r.citekey !== row.citekey).map((r) => r.citekey);
    failing.misquoted = { start: row.quote, foundIn };
  }
  return failing;
}

/** Blocking rows revise cannot repair with a swap or a remove (raw citations, broken keys, offline). */
function unrepairableRows(verificationMd: string): VerdictRow[] {
  return parseVerdictRowDetails(verificationMd)
    .filter((r) => r.blocking && !FAILING_VERDICTS.has(r.verdict));
}

// ---------------------------------------------------------------------------
// Claim-context extraction — the sentence that cites the flagged key.
// ---------------------------------------------------------------------------

function claimContext(draftMd: string, failing: FailingCitation): string {
  const cites = findCitations(draftMd);
  // For a misquotation, the sentence with that quotation in it.
  const q = failing.misquoted && quotationsOf(draftMd, failing.citekey, failing.misquoted.start, cites)[0];
  if (q?.citation) {
    const [s, e] = sentenceSpan(draftMd, Math.min(q.start, q.citation.start), Math.max(q.end, q.citation.end), cites);
    return draftMd.slice(s, e).trim();
  }
  const c = citationsOf(draftMd, failing.citekey, cites)[0];
  if (!c) return '(citation not found in DRAFT.md)';
  const [s, e] = sentenceSpan(draftMd, c.start, c.end, cites);
  return draftMd.slice(s, e).trim();
}

// ---------------------------------------------------------------------------
// Taking quotations out
// ---------------------------------------------------------------------------

/**
 * The quotations attributed to a citation of `key`; with `start`, only those
 * whose text begins with it (the snippet a Pass-3 row shows).
 */
function quotationsOf(md: string, key: string, start: string | undefined, cites: readonly Citation[]): Quote[] {
  return findQuotes(md, cites).filter((q) =>
    q.citation?.items.some((i) => i.key === key) && (start === undefined || q.text.startsWith(start)));
}

/** `md` without [s, e), leaving no space dangling and no empty paragraph behind. */
function cut(md: string, s: number, e: number): string {
  let before = md.slice(0, s);
  let after = md.slice(e);
  if (/(^|\n)[ \t]*$/.test(before) || /^[ \t]*(\r?\n|$)/.test(after)) {
    before = before.replace(/[ \t]+$/, '');
    after = after.replace(/^[ \t]+/, '');
  } else if (/[ \t]$/.test(before)) {
    after = after.replace(/^[ \t]+/, '');
  }
  if ((before === '' || before.endsWith('\n')) && (after === '' || /^\r?\n/.test(after))) {
    // A paragraph emptied: one blank line between what is left around it.
    before = before.replace(/(\r?\n[ \t]*)+$/, '');
    after = after.replace(/^(\r?\n[ \t]*)+/, '');
    if (before === '') return after;
    return after === '' ? `${before}\n` : `${before}\n\n${after}`;
  }
  return before + after;
}

/**
 * `md` with quotations attributed to `key` taken out, and the text taken out.
 *
 * With `misquoted` (a Pass-3 row), the quotation that begins with its `start`.
 * When its citation also cites a work Pass 3 found it in (`foundIn`), only
 * `key` leaves that citation and the quotation stays. Otherwise it goes: the
 * verifier showed it is not in one of its cited works, and keeping it on the
 * others' word, unchecked, would discard that. Without `misquoted` (the key
 * itself failed), every quotation attributed to `key` alone; one that cites
 * other works too stays with them, to be checked against them.
 *
 * An inline quotation goes with its sentence. A block quotation goes with its
 * block, the sentence that introduces it with a colon, and its citation.
 */
function withoutQuotations(
  md: string,
  key: string,
  misquoted?: { start: string; foundIn: readonly string[] },
): { text: string; removed: string[] } {
  const cites = findCitations(md);
  const breaks = paragraphBreaks(md);
  const spans: Array<[number, number]> = [];
  const rewrites: Array<{ s: number; e: number; text: string }> = [];
  for (const q of quotationsOf(md, key, misquoted?.start, cites)) {
    const c = q.citation!;
    if (!misquoted && c.items.some((i) => i.key !== key)) continue;
    if (misquoted && c.items.some((i) => i.key !== key && misquoted.foundIn.includes(i.key))) {
      if (!c.narrative) rewrites.push({ s: c.start, e: c.end, text: clusterWithoutKey(c, key) });
      continue;
    }
    if (q.kind === 'inline') {
      spans.push(sentenceSpan(md, Math.min(q.start, c.start), Math.max(q.end, c.end), cites, breaks));
    } else {
      spans.push([q.start, q.end]);
      const intro = md.slice(0, q.start).replace(/\s+$/, '');
      if (intro.endsWith(':')) spans.push(sentenceSpan(md, intro.length - 1, intro.length, cites, breaks));
      if (c.start >= q.end || c.end <= q.start) spans.push([c.start, c.end]);
    }
  }
  // Overlapping deletions become one; a rewrite inside a deletion goes with it.
  const deletions: Array<[number, number]> = [];
  for (const [s, e] of spans.sort((a, b) => a[0] - b[0])) {
    const last = deletions[deletions.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else deletions.push([s, e]);
  }
  const edits = [
    ...deletions.map(([s, e]) => ({ s, e, text: '' })),
    ...rewrites.filter((r) => !deletions.some(([s, e]) => r.s < e && r.e > s)),
  ].sort((a, b) => b.s - a.s);
  let text = md;
  for (const ed of edits) text = ed.text === '' ? cut(text, ed.s, ed.e) : text.slice(0, ed.s) + ed.text + text.slice(ed.e);
  return { text, removed: deletions.map(([s, e]) => md.slice(s, e).trim()) };
}

// ---------------------------------------------------------------------------
// The assigned works the swap is proposed from.
// ---------------------------------------------------------------------------

/**
 * The paper's library, or null when LIBRARY.json cannot be read: the sources
 * are then named without records, and the author is told why.
 */
async function libraryOrNull(root: string): Promise<Library | null> {
  try {
    return await loadLibrary(root);
  } catch (e) {
    process.stderr.write(
      `pensmith revise: WARN — .paper/LIBRARY.json cannot be read (${(e as Error).message.split('\n')[0]}), so the ` +
        'replacement is proposed, and shown to you, without the works\' titles and abstracts.\n',
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Voice-hint extraction.
// The section-planner prompt writes a one-line `Voice: ...` in the ## Brief.
// ---------------------------------------------------------------------------

function voiceHint(planMd: string): string {
  const m = /(^|\n)\s*Voice:\s*([^\n]+)/i.exec(planMd);
  return m && m[2] ? `Voice: ${m[2].trim()}` : 'Voice: formal academic tone.';
}

// ---------------------------------------------------------------------------
// Default LLM proposeSwap — loads the hash-pinned prompt + (would) call the
// model. Production callers inject a real transport; this default throws so a
// caller that forgot to wire the transport fails loudly instead of silently.
// ---------------------------------------------------------------------------

async function defaultProposeSwap(vars: ReviseSwapVars): Promise<string> {
  // The prompt body is loaded + interpolated by the CLI caller, which owns
  // the actual model transport (no model client exists in bin/lib yet). When a
  // caller does not inject proposeSwap, there is nothing to call.
  void vars;
  await Promise.resolve();
  throw new Error(
    'runRevise: no proposeSwap transport injected. The CLI caller must ' +
    'supply an LLM seam (loadPrompt(\'revise-swap\') + interpolate + model call).',
  );
}

// ---------------------------------------------------------------------------
// Default approval gate — @clack/prompts confirm in a TTY; exit 3 otherwise.
// ---------------------------------------------------------------------------

/** The replacement work as the gate shows it: key, title, authors, year, and the abstract to judge support by. */
function describeReplacement(r: SourceContextEntry): string {
  const by = [r.authors.slice(0, 3).join('; '), r.year].filter(Boolean).join(', ');
  return [
    `Replacement: [@${r.citekey}] ${r.title}${by ? ` (${by})` : ''}${r.retracted ? ' — RETRACTED' : ''}`,
    r.abstract ? `Abstract: ${r.abstract}` : 'Abstract: none in LIBRARY.json — check that this work supports the sentence before you accept.',
  ].join('\n');
}

/** What the approval gate shows: the change, then the replacement work, or that LIBRARY.json has no record of it. */
export function gateNote(proposal: ReviseSwapProposal, context: ReviseGateContext): string {
  const change = `- ${proposal.patch.before_excerpt}\n+ ${proposal.patch.after_excerpt}`;
  if (context.replacement) return `${change}\n\n${describeReplacement(context.replacement)}`;
  if (proposal.replacement_citekey) {
    return `${change}\n\nReplacement: [@${proposal.replacement_citekey}] — no record in LIBRARY.json, so its title and ` +
      'abstract cannot be shown; check that this work exists and supports the sentence before you accept.';
  }
  return change;
}

/** True when a person at a terminal can see the change and answer. */
function canAskInTerminal(): boolean {
  return Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
}

async function defaultApprove(proposal: ReviseSwapProposal, context: ReviseGateContext): Promise<boolean> {
  const clack = await import('@clack/prompts');
  clack.note(gateNote(proposal, context), `Proposed ${proposal.action} — ${proposal.rationale}`);
  const ok = await clack.confirm({ message: `Apply this ${proposal.action}?` });
  return ok === true && !clack.isCancel(ok);
}

// ---------------------------------------------------------------------------
// Validate + parse one LLM proposal against the strict schema + membership.
// ---------------------------------------------------------------------------

function validateProposal(
  raw: string,
  flagged: string,
  assignedSources: readonly string[],
): { ok: true; proposal: ReviseSwapProposal } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'LLM response was not valid JSON' };
  }
  const parsed = ReviseSwapSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `LLM response failed strict schema: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
  }
  const p = parsed.data;
  if (p.flagged_citekey !== flagged) {
    return { ok: false, reason: `LLM flagged_citekey "${p.flagged_citekey}" does not match the verifier-flagged "${flagged}"` };
  }
  if (p.action === 'swap') {
    if (!p.replacement_citekey) {
      return { ok: false, reason: 'swap action requires a non-null replacement_citekey' };
    }
    if (p.replacement_citekey === flagged) {
      return { ok: false, reason: `swap replaces "${flagged}" with itself, which repairs nothing` };
    }
    // The replacement must be one of assigned_sources: no new citekeys.
    if (!assignedSources.includes(p.replacement_citekey)) {
      return { ok: false, reason: `replacement_citekey "${p.replacement_citekey}" is not in assigned_sources (no new citekeys allowed)` };
    }
  } else {
    // remove
    if (p.replacement_citekey !== null) {
      return { ok: false, reason: 'remove action requires replacement_citekey: null' };
    }
  }
  return { ok: true, proposal: p };
}

// ---------------------------------------------------------------------------
// Apply an accepted proposal: patch DRAFT.md + reset the hash under withLock.
// ---------------------------------------------------------------------------

/**
 * The patched draft for an accepted proposal and the text it deletes, or why
 * it cannot be applied: the citation or quotation is no longer in the draft,
 * or removing a narrative citation would leave a sentence without its subject.
 */
function patchFor(
  proposal: ReviseSwapProposal,
  draftMd: string,
  failing: FailingCitation,
): { patched: string; removed: string[] } | { refused: string } {
  const flagged = proposal.flagged_citekey;
  const cites = citationsOf(draftMd, flagged);
  if (cites.length === 0) {
    return { refused: `the draft no longer cites ${flagged}, so the ${proposal.action} changed nothing — re-run verify` };
  }
  if (proposal.action === 'swap') {
    // The prefix and locator of a swapped key stay.
    const patched = renameCitedKey(draftMd, flagged, proposal.replacement_citekey as string);
    return patched === draftMd ? { refused: 'the swap changed nothing in DRAFT.md' } : { patched, removed: [] };
  }
  // A misquotation: the quotation goes, and the work stays cited where Pass 1
  // confirmed it. A failed citation: the quotations it alone supports go, then the key.
  const { text, removed } = withoutQuotations(draftMd, flagged, failing.misquoted);
  if (failing.misquoted) {
    return text === draftMd
      ? { refused: `the draft no longer holds the quotation "${failing.misquoted.start}…" cited to ${flagged} — re-run verify` }
      : { patched: text, removed };
  }
  if (citationsOf(text, flagged).some((c) => c.narrative)) {
    return { refused: `@${flagged} is a narrative citation in running text; removing it would break the sentence — edit DRAFT.md by hand or swap it` };
  }
  const patched = dropCitedKey(text, flagged);
  return patched === draftMd ? { refused: 'the remove changed nothing in DRAFT.md' } : { patched, removed };
}

/** How much deleted text the message shows. */
const DELETED_SHOWN = 60;

/** `text` on one line, cut to DELETED_SHOWN characters, with an ellipsis only when cut. */
function excerpt(text: string): string {
  const one = oneLine(text).trim();
  return one.length > DELETED_SHOWN ? `${one.slice(0, DELETED_SHOWN).trimEnd()}…` : one;
}

async function applyProposal(draftPath: string, planPath: string, patched: string): Promise<void> {
  await atomicWriteFile(draftPath, patched);

  // Reset verified_against_draft_hash → null under a per-PLAN.md lock.
  await withLock(planPath, async () => {
    const cur = readFileSync(planPath, 'utf8');
    const next = updateFrontmatter(cur, (fm) => {
      fm['verified_against_draft_hash'] = null;
    });
    await atomicWriteFile(planPath, next);
  });
}

// ---------------------------------------------------------------------------
// --research: library merge + project RESEARCH.md + section RESEARCH-LOG.md.
// ---------------------------------------------------------------------------

/** Merge `hits` into the library and the research notes; the hits not added because no identifier names them. */
async function applyResearch(opts: ReviseOptions, hits: ResearchHit[]): Promise<ResearchHit[]> {
  const query = opts.research ?? '';
  const root = opts.paperRoot;
  const now = new Date().toISOString();

  // 1. Merge the hits into the library, which writes CITATIONS.bib from it.
  //    A work it already holds keeps its key; a new one may get a suffixed
  //    key, so RESEARCH.md and the log below name the keys the library gave.
  const candidates: SourceCandidate[] = hits.map((h) => ({
    source: h.source ?? 'openalex',
    id: h.doi ?? h.citekey,
    title: h.title,
    authors: h.authors.length > 0 ? h.authors : ['Unknown'],
    ...(h.year !== undefined ? { year: h.year } : {}),
    ...(h.doi !== undefined ? { doi: h.doi } : {}),
    retracted: false,
    last_verified: now,
    citekey: h.citekey,
    raw: {},
  } as SourceCandidate));
  const merged = await addToLibrary(root, candidates, { via: { source: 'revise --research', section: opts.n } });
  const keyOf = new Map<SourceCandidate, string>();
  for (const w of merged.works) for (const c of w.candidates) keyOf.set(c, w.citekey);
  const keys = candidates.map((c) => keyOf.get(c));
  const listed = hits.flatMap((h, i) => {
    const key = keys[i];
    return key === undefined ? [] : [{ h, key }];
  });
  const citekeysAdded = [...new Set(listed.map((x) => x.key))];
  // Research leaves out a work no DOI, arXiv ID, PMID or ISBN names, since
  // nothing could verify it; say which, rather than drop them unseen.
  const skipped = hits.filter((_, i) => keys[i] === undefined);
  if (skipped.length > 0) {
    process.stderr.write(
      `pensmith revise: WARN — ${skipped.length} hit(s) had no DOI, arXiv ID, PubMed ID or ISBN and were not added: ` +
      `${skipped.map((h) => `"${h.title}"`).join(', ')}.\n`,
    );
  }

  // 2. Append to project-level .paper/RESEARCH.md (append, never overwrite).
  const researchPath = `${paperDir(root)}/RESEARCH.md`;
  const prior = existsSync(researchPath) ? readFileSync(researchPath, 'utf8') : '';
  const block = [
    prior.endsWith('\n') || prior.length === 0 ? '' : '\n',
    `\n## Section ${opts.n} additional research — ${now}`,
    '',
    `Query: ${query}`,
    '',
    ...listed.map(({ h, key }) => `- [@${key}] ${h.title} (${(h.authors ?? []).join('; ')}${h.year ? `, ${h.year}` : ''})`),
    '',
  ].join('\n');
  await atomicWriteFile(researchPath, prior + block);

  // 3. Append a provenance row to sections/<N>/RESEARCH-LOG.md (the ONLY
  //    section-level file --research writes).
  const logPath = sectionResearch(opts.n, opts.slug, root).replace(/RESEARCH\.md$/, 'RESEARCH-LOG.md');
  const priorLog = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '# RESEARCH-LOG (section provenance)\n\n| timestamp | query | adapter | hits | citekeys-added |\n| --- | --- | --- | --- | --- |\n';
  const row = `| ${now} | ${query} | revise --research | ${hits.length} | ${citekeysAdded.join(', ')} |\n`;
  await atomicWriteFile(logPath, priorLog + row);
  return skipped;
}

// ---------------------------------------------------------------------------
// RETRY_EXHAUSTED verdict → VERIFICATION.md.
// ---------------------------------------------------------------------------

async function writeRetryExhausted(verifPath: string, flagged: string): Promise<void> {
  const cur = existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : '';
  const note = [
    '',
    '## Revise (RETRY_EXHAUSTED — D-06)',
    '',
    `- ${flagged}: **RETRY_EXHAUSTED** — --yolo auto-revise reached the ${YOLO_RETRY_CAP}-retry cap without a valid swap. Human review required.`,
    '',
  ].join('\n');
  await atomicWriteFile(verifPath, cur + note);
}

// ===========================================================================
// runRevise — the single Tier-1/Tier-2 chokepoint.
// ===========================================================================

export async function runRevise(opts: ReviseOptions): Promise<ReviseResult> {
  const draftPath = sectionDraft(opts.n, opts.slug, opts.paperRoot);
  const planPath = sectionPlan(opts.n, opts.slug, opts.paperRoot);
  const verifPath = sectionVerification(opts.n, opts.slug, opts.paperRoot);

  const base: ReviseResult = {
    action: null,
    accepted: false,
    flagged_citekey: null,
    replacement_citekey: null,
    retryExhausted: false,
    researchApplied: false,
    message: '',
  };

  // --research is orthogonal to the swap loop and may run alongside it.
  if (opts.research && opts.research.trim().length > 0) {
    const adapter = opts.researchAdapter ?? (() => Promise.resolve([] as ResearchHit[]));
    const hits = await adapter(opts.research);
    const skipped = await applyResearch(opts, hits);
    base.researchApplied = true;
    base.message = `--research applied: ${hits.length} hit(s) for "${opts.research}"` +
      (skipped.length > 0 ? `; ${skipped.length} not added (no DOI, arXiv ID, PubMed ID or ISBN).` : '.');
  }

  // --research is orthogonal to the swap loop: a `revise --research <query>`
  // invocation with no proposeSwap transport injected is a valid "research
  // only" call. When research ran and no swap transport is wired, return the
  // research result without attempting (and throwing on) the swap loop.
  if (base.researchApplied && !opts.proposeSwap) {
    return base;
  }

  if (!existsSync(verifPath)) {
    return { ...base, message: `${base.message} No VERIFICATION.md at section ${opts.n} — nothing to revise.`.trim() };
  }
  const verificationMd = readFileSync(verifPath, 'utf8');
  const failing = firstFailingCitation(verificationMd);
  if (!failing) {
    const other = unrepairableRows(verificationMd);
    if (other.length > 0) {
      const named = other.map((r) => `${r.citekey} (${r.verdict})`).join('; ');
      const why =
        `Section ${opts.n} has blocking verdict(s) revise cannot repair by swapping or removing a citekey: ${named}. ` +
        'Rewrite a raw or broken citation as [@key]; for UNRESOLVED, re-run verify once the registry ' +
        'answers, or give the entry a DOI, arXiv ID, PMID or ISBN if it has none; then verify again.';
      return { ...base, message: `${base.message} ${why}`.trim() };
    }
    return { ...base, message: `${base.message} No ${FAILING_VERDICT_LIST} citation in section ${opts.n}.`.trim() };
  }
  base.flagged_citekey = failing.citekey;

  if (!existsSync(planPath) || !existsSync(draftPath)) {
    return { ...base, message: `${base.message} Section ${opts.n} is missing PLAN.md or DRAFT.md.`.trim() };
  }
  const planMd = readFileSync(planPath, 'utf8');
  const assignedSources = assignedSourcesFrom(parseFrontmatter(planMd).frontmatter);

  const proposeSwap = opts.proposeSwap ?? defaultProposeSwap;
  const approve = opts.approve ?? defaultApprove;
  const draftMd = readFileSync(draftPath, 'utf8');

  const { sources, missing } = sourceContext(await libraryOrNull(opts.paperRoot), assignedSources);
  const vars: ReviseSwapVars = {
    flagged_citekey: failing.citekey,
    verifier_reason: failing.reason,
    claim_context: claimContext(draftMd, failing),
    available_sources: renderSourceContext(sources) + (missing.length > 0
      ? `\n\nAssigned, but with no record in the library to judge them by: ${stripFenceMarkers(missing.join(', '))}.`
      : ''),
    voice_hint: voiceHint(planMd),
  };

  // The change waits for the person's approval: an injected approver (tests)
  // or a terminal asks now; otherwise it is kept for `pensmith gate answer`.
  const interactive = opts.approve !== undefined || canAskInTerminal();
  const binding = { draft_sha256: sha256(draftMd), verification_sha256: sha256(verificationMd) };

  /** The patch for `proposal`, and what the approval gate shows for it. */
  const prepare = (proposal: ReviseSwapProposal): { patched: string; removed: string[]; shown: ReviseSwapProposal; context: ReviseGateContext } | { refused: string } => {
    const patch = patchFor(proposal, draftMd, failing);
    if ('refused' in patch) return patch;
    // When the patch deletes text, the gate shows that text, not the model's excerpt.
    const shown: ReviseSwapProposal = patch.removed.length === 0 ? proposal
      : { ...proposal, patch: { before_excerpt: patch.removed.join('\n'), after_excerpt: '(deleted)' } };
    const replacement = sources.find((src) => src.citekey === proposal.replacement_citekey);
    return { ...patch, shown, context: replacement ? { replacement } : {} };
  };

  /** Apply `proposal` once approved; a rejection leaves DRAFT.md as it is. */
  const settle = async (proposal: ReviseSwapProposal, patch: { patched: string; removed: string[] }, accepted: boolean): Promise<ReviseResult> => {
    if (!accepted) {
      return { ...base, accepted: false, rejected: true, message: `${base.message} Proposal rejected at the approval gate — DRAFT.md unchanged.`.trim() };
    }
    await applyProposal(draftPath, planPath, patch.patched);
    const what = failing.misquoted ? 'the misquotation'
      : patch.removed.length === 1 ? 'the quotation it alone supported' : `${patch.removed.length} passages with quotations it alone supported`;
    const deleted = patch.removed.length === 0 ? '' : ` Deleted ${what}: "${excerpt(patch.removed[0]!)}".`;
    return {
      ...base,
      accepted: true,
      message: `${base.message} Applied ${proposal.action} for [@${failing.citekey}]${proposal.replacement_citekey ? ` → [@${proposal.replacement_citekey}]` : ''}.${deleted} Verification hash reset — re-run verify.`.trim(),
    };
  };

  // A change kept for approval: apply the person's answer, ask at a terminal,
  // or show it again, with no new model call. One proposed for another
  // DRAFT.md or VERIFICATION.md is never applied.
  const kept = readGate(opts.paperRoot, 'revise', opts.n);
  if (kept && !opts.yolo) {
    const parsed = ReviseSwapSchema.safeParse((kept.payload as { proposal?: unknown } | null)?.proposal);
    const checked = parsed.success ? validateProposal(JSON.stringify(parsed.data), failing.citekey, assignedSources) : null;
    const prepared = checked?.ok ? prepare(checked.proposal) : null;
    if (checked?.ok && prepared && !('refused' in prepared) && gateStillApplies(kept, binding)) {
      base.action = checked.proposal.action;
      base.replacement_citekey = checked.proposal.replacement_citekey;
      if (!kept.answer && !interactive) return { ...base, pending: kept, pendingChange: gateNote(prepared.shown, prepared.context), message: `${base.message} The proposed ${checked.proposal.action} for [@${failing.citekey}] waits for the user's approval.`.trim() };
      const accepted = kept.answer ? kept.answer.options[0] === 'approve' : await approve(prepared.shown, prepared.context);
      await closeGate(opts.paperRoot, 'revise', opts.n);
      return settle(checked.proposal, prepared, accepted);
    }
    await closeGate(opts.paperRoot, 'revise', opts.n);
    if (kept.answer) {
      return {
        ...base, accepted: false, rejected: true,
        message: `${base.message} The change answered was proposed for an earlier DRAFT.md or VERIFICATION.md of section ${opts.n}, so it was not applied; DRAFT.md unchanged. Run \`pensmith verify ${opts.n}\`, then revise again.`.trim(),
      };
    }
  } else if (kept) {
    await closeGate(opts.paperRoot, 'revise', opts.n);
  }

  const maxAttempts = opts.yolo ? YOLO_RETRY_CAP + 1 : 1;
  let lastRejection = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await proposeSwap(vars);
    const validated = validateProposal(raw, failing.citekey, assignedSources);
    if (!validated.ok) {
      lastRejection = validated.reason;
      continue; // --yolo retries; single-attempt mode falls through to reject
    }
    const proposal = validated.proposal;
    base.action = proposal.action;
    base.replacement_citekey = proposal.replacement_citekey;

    const prepared = prepare(proposal);
    if ('refused' in prepared) {
      return { ...base, accepted: false, rejectedReason: prepared.refused, message: `${base.message} Not applied: ${prepared.refused}; DRAFT.md unchanged.`.trim() };
    }

    // Approval gate (default-on, PRD §19). --yolo skips.
    if (opts.yolo) return settle(proposal, prepared, true);
    if (interactive) return settle(proposal, prepared, await approve(prepared.shown, prepared.context));
    const record = await openGate(opts.paperRoot, {
      gate: 'revise',
      n: opts.n,
      args: { n: opts.n, slug: opts.slug, revise: true },
      summary: `Apply this ${proposal.action} of [@${failing.citekey}] in section ${opts.n}?`,
      options: ['approve', 'reject'],
      default: ['reject'],
      binding,
      payload: { proposal },
    });
    return { ...base, pending: record, pendingChange: gateNote(prepared.shown, prepared.context), message: `${base.message} The proposed ${proposal.action} for [@${failing.citekey}] waits for the user's approval.`.trim() };
  }

  // Exhausted (only reachable under --yolo with all proposals invalid, or a
  // single-attempt invalid proposal). Write RETRY_EXHAUSTED only under --yolo.
  if (opts.yolo) {
    await writeRetryExhausted(verifPath, failing.citekey);
    return { ...base, retryExhausted: true, rejectedReason: lastRejection, message: `${base.message} --yolo retries exhausted (${lastRejection}); RETRY_EXHAUSTED written.`.trim() };
  }
  return { ...base, accepted: false, rejectedReason: lastRejection, message: `${base.message} Proposal rejected (${lastRejection}); DRAFT.md unchanged.`.trim() };
}

export default runRevise;
