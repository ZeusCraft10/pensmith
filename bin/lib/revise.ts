// bin/lib/revise.ts — the one revise path, shared by the plugin and the CLI.
//
// `pensmith revise` and `pensmith plan <n> --revise` both call runRevise, so
// the two tiers cannot diverge. The flow:
//
//   1. Read sections/<N>/VERIFICATION.md (with the parser compile uses) for the
//      FIRST failing citation (FABRICATED / MIS-CITED / NOT_FOUND / RETRACTED),
//      in order of appearance. Other blocking verdicts are named, not repaired.
//   2. Load the PLAN.md frontmatter: assigned_sources and the section's voice
//      hint, which go into the prompt.
//   3. Ask the model (the hash-pinned revise-swap prompt) for a swap or a
//      remove. The answer is parsed with a strict zod schema and rejected
//      unless the action is swap or remove and any replacement key is in
//      assigned_sources, so no new citekey ever enters DRAFT.md.
//   4. Approval gate (default-on, PRD §19): show the change and ask. Skipped
//      under --yolo. A non-TTY without --yolo exits 3.
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
// --research appends the query's findings to the project-level
// .paper/RESEARCH.md, merges new entries into .paper/CITATIONS.bib (with a
// non-standard `from_section: <N>` annotation), and appends a provenance row
// to sections/<N>/RESEARCH-LOG.md (query, adapter, hit count, citekeys added,
// ISO timestamp). RESEARCH-LOG.md is the only section-level file --research
// creates; no other section's files are touched.
//
// Every write goes through atomicWriteFile, never raw fs.

import { z } from 'zod';
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
import { parseBibtex } from './citations.js';
import { writeBibtex } from './bibtex-write.js';
import { sectionDraft, sectionPlan, sectionVerification, sectionResearch, paperDir } from './paths.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

// --yolo retry cap: 2 retries → 3 total attempts, then RETRY_EXHAUSTED.
const YOLO_RETRY_CAP = 2;

/** The verifier verdicts that --revise repairs. */
const FAILING_VERDICTS: ReadonlySet<string> = new Set(['FABRICATED', 'MIS-CITED', 'NOT_FOUND', 'RETRACTED']);
/** FAILING_VERDICTS as message text: `FABRICATED/MIS-CITED/...`. */
const FAILING_VERDICT_LIST = [...FAILING_VERDICTS].join('/');

// Strict-JSON contract for the revise-swap model response.
const ReviseSwapSchema = z.object({
  action: z.enum(['swap', 'remove']),
  flagged_citekey: z.string(),
  replacement_citekey: z.string().nullable(),
  rationale: z.string(),
  patch: z.object({
    before_excerpt: z.string(),
    after_excerpt: z.string(),
  }),
});
export type ReviseSwapProposal = z.infer<typeof ReviseSwapSchema>;

/** Variables handed to the LLM proposeSwap seam (mirror the prompt's {{vars}}). */
export interface ReviseSwapVars {
  flagged_citekey: string;
  verifier_reason: string;
  claim_context: string;
  available_sources: string;
  voice_hint: string;
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
  approve?: (proposal: ReviseSwapProposal) => Promise<boolean>;
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
}

/** Raised when the approval gate cannot run (non-TTY without --yolo). Exit 3. */
export class ApprovalUnavailableError extends Error {
  exitCode = 3 as const;
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// VERIFICATION.md parsing — first failing citation, in appearance order.
// ---------------------------------------------------------------------------

interface FailingCitation {
  citekey: string;
  reason: string;
  /** For a misquotation (a Pass-3 row), the start of the quotation. */
  quote?: string;
  /** For a misquotation, the other cited works Pass 3 found it in. */
  foundIn?: string[];
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
    failing.quote = row.quote;
    failing.foundIn = rows.filter((r) => r.verdict === 'OK' && r.quote === row.quote && r.citekey !== row.citekey).map((r) => r.citekey);
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
  const q = failing.quote === undefined ? undefined : quotationsOf(draftMd, failing.citekey, failing.quote, cites)[0];
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
  // The prompt body is loaded + interpolated by the CLI/MCP caller which owns
  // the actual model transport (no model client exists in bin/lib yet). When a
  // caller does not inject proposeSwap, there is nothing to call.
  void vars;
  await Promise.resolve();
  throw new Error(
    'runRevise: no proposeSwap transport injected. The CLI/MCP caller must ' +
    'supply an LLM seam (loadPrompt(\'revise-swap\') + interpolate + model call).',
  );
}

// ---------------------------------------------------------------------------
// Default approval gate — @clack/prompts confirm in a TTY; exit 3 otherwise.
// ---------------------------------------------------------------------------

async function defaultApprove(proposal: ReviseSwapProposal): Promise<boolean> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new ApprovalUnavailableError(
      'revise: approval gate requires an interactive terminal. ' +
      'Use --yolo to auto-accept (PRD §19 default-on approval).',
    );
  }
  const clack = await import('@clack/prompts');
  const before = proposal.patch.before_excerpt;
  const after = proposal.patch.after_excerpt;
  clack.note(`- ${before}\n+ ${after}`, `Proposed ${proposal.action} — ${proposal.rationale}`);
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
  // A misquotation: the quotation goes, and the work stays cited where Pass 1 confirmed it.
  if (failing.quote !== undefined) {
    const { text, removed } = withoutQuotations(draftMd, flagged, { start: failing.quote, foundIn: failing.foundIn ?? [] });
    if (text === draftMd) {
      return { refused: `the draft no longer holds the quotation "${failing.quote}…" cited to ${flagged} — re-run verify` };
    }
    return { patched: text, removed };
  }
  // A failed citation: the quotations it alone supports go, then the key.
  const { text, removed } = withoutQuotations(draftMd, flagged);
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
// --research: project RESEARCH.md + bib merge + section RESEARCH-LOG.md.
// ---------------------------------------------------------------------------

async function applyResearch(opts: ReviseOptions, hits: ResearchHit[]): Promise<void> {
  const query = opts.research ?? '';
  const root = opts.paperRoot;
  const now = new Date().toISOString();
  const citekeysAdded = hits.map((h) => h.citekey);

  // 1. Append to project-level .paper/RESEARCH.md (append, never overwrite).
  const researchPath = `${paperDir(root)}/RESEARCH.md`;
  const prior = existsSync(researchPath) ? readFileSync(researchPath, 'utf8') : '';
  const block = [
    prior.endsWith('\n') || prior.length === 0 ? '' : '\n',
    `\n## Section ${opts.n} additional research — ${now}`,
    '',
    `Query: ${query}`,
    '',
    ...hits.map((h) => `- [@${h.citekey}] ${h.title} (${(h.authors ?? []).join('; ')}${h.year ? `, ${h.year}` : ''})`),
    '',
  ].join('\n');
  await atomicWriteFile(researchPath, prior + block);

  // 2. Merge new entries into .paper/CITATIONS.bib (from_section annotation).
  const bibPath = `${paperDir(root)}/CITATIONS.bib`;
  const existingBib = existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : '';
  const existingEntries = existingBib.trim().length > 0 ? await parseBibtex(existingBib) : [];
  const existingKeys = new Set(existingEntries.map((e) => String((e as { id?: string }).id ?? '')));

  const newCandidates: SourceCandidate[] = hits
    .filter((h) => !existingKeys.has(h.citekey))
    .map((h) => ({
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

  if (newCandidates.length > 0) {
    // Re-render the union through the citation-js + atomic-write chokepoints.
    // We hand writeBibtex the merged candidate set so collisions resolve and
    // the file stays git-diff-stable. The from_section provenance is recorded
    // as a non-standard trailing comment block (standard parsers ignore `%`).
    const mergedExisting: SourceCandidate[] = existingEntries.map((e) => {
      const x = e as { id?: string; title?: string | string[]; author?: Array<{ family?: string; given?: string }>; DOI?: string };
      const title = Array.isArray(x.title) ? (x.title[0] ?? '') : (x.title ?? '');
      const authors = (x.author ?? []).map((a) => {
        const fam = String(a?.family ?? '').trim();
        const giv = String(a?.given ?? '').trim();
        return giv ? `${fam}, ${giv}` : fam;
      }).filter(Boolean);
      return {
        source: 'crossref',
        id: x.DOI ?? String(x.id ?? ''),
        title: title || String(x.id ?? 'untitled'),
        authors: authors.length > 0 ? authors : ['Unknown'],
        ...(x.DOI !== undefined ? { doi: x.DOI } : {}),
        retracted: false,
        last_verified: now,
        citekey: String(x.id ?? ''),
        raw: {},
      } as SourceCandidate;
    });
    await writeBibtex([...mergedExisting, ...newCandidates], bibPath);
    const rendered = readFileSync(bibPath, 'utf8');
    const provenance = newCandidates.map((c) => `% from_section: ${opts.n}  citekey: ${c.citekey}`).join('\n');
    await atomicWriteFile(bibPath, `${rendered}${rendered.endsWith('\n') ? '' : '\n'}${provenance}\n`);
  }

  // 3. Append a provenance row to sections/<N>/RESEARCH-LOG.md (the ONLY
  //    section-level file --research writes).
  const logPath = sectionResearch(opts.n, opts.slug, root).replace(/RESEARCH\.md$/, 'RESEARCH-LOG.md');
  const priorLog = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '# RESEARCH-LOG (section provenance)\n\n| timestamp | query | adapter | hits | citekeys-added |\n| --- | --- | --- | --- | --- |\n';
  const row = `| ${now} | ${query} | revise --research | ${hits.length} | ${citekeysAdded.join(', ')} |\n`;
  await atomicWriteFile(logPath, priorLog + row);
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
    await applyResearch(opts, hits);
    base.researchApplied = true;
    base.message = `--research applied: ${hits.length} hit(s) for "${opts.research}".`;
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
  const { frontmatter } = parseFrontmatter(planMd);
  const assignedSources = Array.isArray(frontmatter['assigned_sources'])
    ? (frontmatter['assigned_sources'] as unknown[]).map(String)
    : [];

  const proposeSwap = opts.proposeSwap ?? defaultProposeSwap;
  const approve = opts.approve ?? defaultApprove;
  const draftMd = readFileSync(draftPath, 'utf8');

  const vars: ReviseSwapVars = {
    flagged_citekey: failing.citekey,
    verifier_reason: failing.reason,
    claim_context: claimContext(draftMd, failing),
    available_sources: assignedSources.map((k) => `- ${k}`).join('\n'),
    voice_hint: voiceHint(planMd),
  };

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

    const patch = patchFor(proposal, draftMd, failing);
    if ('refused' in patch) {
      return { ...base, accepted: false, rejectedReason: patch.refused, message: `${base.message} Not applied: ${patch.refused}; DRAFT.md unchanged.`.trim() };
    }

    // Approval gate (default-on, PRD §19). --yolo skips. When the patch
    // deletes text, the gate shows that text, not the model's excerpt.
    const shown: ReviseSwapProposal = patch.removed.length === 0 ? proposal
      : { ...proposal, patch: { before_excerpt: patch.removed.join('\n'), after_excerpt: '(deleted)' } };
    const accepted = opts.yolo ? true : await approve(shown);
    if (!accepted) {
      return { ...base, accepted: false, message: `${base.message} Proposal rejected at the approval gate — DRAFT.md unchanged.`.trim() };
    }

    await applyProposal(draftPath, planPath, patch.patched);
    const what = failing.quote !== undefined ? 'the misquotation'
      : patch.removed.length === 1 ? 'the quotation it alone supported' : `${patch.removed.length} passages with quotations it alone supported`;
    const deleted = patch.removed.length === 0 ? '' : ` Deleted ${what}: "${excerpt(patch.removed[0]!)}".`;
    return {
      ...base,
      accepted: true,
      message: `${base.message} Applied ${proposal.action} for [@${failing.citekey}]${proposal.replacement_citekey ? ` → [@${proposal.replacement_citekey}]` : ''}.${deleted} Verification hash reset — re-run verify.`.trim(),
    };
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
