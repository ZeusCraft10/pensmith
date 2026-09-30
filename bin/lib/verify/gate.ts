// bin/lib/verify/gate.ts — the ONE gate core (D-20-05, D-V1-03, S-17).
//
// Every blocking verdict about one text is computed here, from the text
// itself: verify runs it per section and writes VERIFICATION.md; compile runs
// it per section over the exact draft bytes it concatenates; done runs it over
// the exact bytes it exports (.paper/DRAFT.md, then FINAL.md after the
// humanizer). Nothing else decides whether a citation passes, and no local
// file turns a recomputed blocking verdict into a pass (D-20-04): the only
// local record that can lift a verdict is QUOTE-ACCEPTANCES.json, and only for
// a quote this recomputation finds UNVERIFIABLE-QUOTE in a draft whose hash
// still matches the acceptance (VRFY-20, D-20-22).
//
// Rows, in the order VERIFICATION.md lists them:
//   Pass 1  runPass1 over the text with the bibliography's parsed entries
//           (citations.ts parseBibEntries, VRFY-16): a cited key whose bib
//           entry does not parse is UNPARSEABLE naming the key and the entry's
//           line; a key missing from a missing or empty bibliography is
//           FABRICATED (never a stack). Each cited key outside `allowedKeys`
//           gets its own UNASSIGNED row right after its registrar row (VRFY-17).
//           Text findings (UNPARSEABLE / UNSUPPORTED-FORM scanners, key slot
//           `L<line>`) follow.
//   Pass 3  runPass3 over the same text; an UNVERIFIABLE-QUOTE row a valid
//           acceptance covers is marked accepted (it then passes).
//   Draft   PLACEHOLDER — the stub-draft marker outside --dry-run (VRFY-24);
//           NO-CITATIONS — nothing cited although sources are assigned.
// `checkedAt` collects when each passing Pass-1 answer was obtained, for
// LIBRARY.json `last_verified` (VRFY-28; verify and done record it).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPass1 as defaultRunPass1, type Pass1Options, type Pass1Result } from './pass1.js';
import { runPass3 as defaultRunPass3, type Pass3Options, type Pass3Result } from './pass3.js';
import { parseBibEntries, type BibEntryProblem } from '../citations.js';
import { extractCitedKeysForVerification } from '../citation-token.js';
import { paperDir } from '../paths.js';
import { tryLoadLibrary } from '../library.js';
import { tryReadPaperConfigSync } from '../config.js';
import { needsRecheck, verificationNow, DEFAULT_RECHECK_AFTER_DAYS } from './clock.js';
import {
  ACCEPTABLE_QUOTE_VERDICT,
  PASSING_VERDICTS,
  RETRY_ONLINE_VERDICTS,
  UNATTRIBUTED_CITEKEY,
  blocksCompile,
  sectionOutcome,
  type SectionOutcome,
  type TextFinding,
} from './verdicts.js';
import type { QuoteAcceptance } from '../schemas/quote-acceptances.js';

/**
 * The one-line marker `write` puts first in a draft produced with no model
 * (PENSMITH_NO_LLM=1 or --dry-run, VRFY-24, D-20-21). Outside --dry-run a
 * draft carrying it is PLACEHOLDER (unverifiable, blocking); a dry-run compile
 * removes it, so no export ever carries it.
 */
export const STUB_DRAFT_MARKER = '<!-- stub draft (no model configured) — not real prose -->';

/** True when `text` carries the stub-draft marker on a line of its own. */
export function hasStubMarker(text: string): boolean {
  return text.split(/\r?\n/).some((l) => l.trim() === STUB_DRAFT_MARKER);
}

/** `text` without its stub-draft marker lines (the dry-run compile). */
export function stripStubMarker(text: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() !== STUB_DRAFT_MARKER) {
      kept.push(lines[i] ?? '');
      continue;
    }
    // Drop the blank line the marker was set off with, so no stray gap remains.
    if (i + 1 < lines.length && (lines[i + 1] ?? '').trim() === '') i++;
  }
  return kept.join(eol);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface Pass1GateRow {
  readonly kind: 'pass1';
  readonly key: string;
  readonly verdict: string;
  readonly titleJW: number;
  readonly authorJW: number;
  readonly reason: string;
  readonly retraction?: boolean;
  readonly checkedAt?: string;
}

export interface TextGateRow {
  readonly kind: 'text';
  /** `L<line>`. */
  readonly key: string;
  readonly line: number;
  readonly verdict: TextFinding['verdict'];
  readonly form: string;
  readonly text: string;
  readonly reason: string;
}

export interface Pass3GateRow {
  readonly kind: 'pass3';
  readonly key: string;
  readonly id: string;
  readonly quoteSha256: string;
  readonly snippet: string;
  readonly verdict: string;
  readonly levRatio: number;
  readonly reason: string;
  readonly localFile?: string;
  /** Set when a valid acceptance covers this UNVERIFIABLE-QUOTE row (it then passes). */
  readonly accepted?: { readonly at: string; readonly via: QuoteAcceptance['via'] };
}

export interface DraftGateRow {
  readonly kind: 'draft';
  readonly verdict: 'PLACEHOLDER' | 'NO-CITATIONS';
  readonly reason: string;
}

export type GateRow = Pass1GateRow | TextGateRow | Pass3GateRow | DraftGateRow;

/** An acceptance the gate honoured, for the reports. */
export interface AcceptedQuote {
  readonly id: string;
  readonly citekey: string;
  readonly excerpt: string;
  readonly acceptedAt: string;
  readonly via: QuoteAcceptance['via'];
  /** The section whose acceptance record it came from (paper scope), when known. */
  readonly section?: string;
}

/** A quote verified against the user's own PDF, for the reports (VRFY-19, VRFY-26). */
export interface ByoQuote {
  readonly id: string;
  readonly citekey: string;
  readonly snippet: string;
  readonly localFile: string;
}

/** A scanner for citation-shaped text the verifier cannot check (UNPARSEABLE, UNSUPPORTED-FORM). */
export type TextScanner = (md: string) => readonly TextFinding[];

/**
 * The text scanners every gate run applies (VRFY-09, VRFY-10): each returns
 * the findings of one family of forms. Their rows are keyed `L<line>`.
 */
export const TEXT_SCANNERS: readonly TextScanner[] = Object.freeze([]);

/** The paper's CITATIONS.bib as the gate reads it. */
export interface LoadedBibliography {
  readonly path: string;
  readonly exists: boolean;
  /** CSL-JSON entries that parse (parseBibEntries). */
  readonly entries: Array<Record<string, unknown>>;
  readonly problems: BibEntryProblem[];
  /** Why a CITATIONS.bib that exists could not be read (e.g. `EACCES`); absent when it was read or is missing. */
  readonly unreadable?: string;
}

/** Read `<root>/.paper/CITATIONS.bib` entry by entry. Never throws (an unreadable file reads as missing, saying why). */
export function loadBibliography(root: string): LoadedBibliography {
  const path = join(paperDir(root), 'CITATIONS.bib');
  if (!existsSync(path)) return { path, exists: false, entries: [], problems: [] };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { path, exists: false, entries: [], problems: [], unreadable: (e as NodeJS.ErrnoException).code ?? (e as Error).message };
  }
  const { entries, problems } = parseBibEntries(text);
  return { path, exists: true, entries, problems };
}

/** Who the text belongs to — it words the remedies. */
export type GateScope = { readonly kind: 'section'; readonly id: string } | { readonly kind: 'paper' };

/** The acceptances of one section, with that section's CURRENT draft hash. */
export interface AcceptanceSet {
  /** computeDraftHash of the section's DRAFT.md and assigned_sources as they are now. */
  readonly currentDraftHash: string;
  readonly acceptances: readonly QuoteAcceptance[];
  /** The section id (`1`, `1a`), for the reports. */
  readonly section?: string;
}

export interface GateInput {
  /** The project root. */
  readonly root: string;
  /** The exact text to check (a section draft, the compiled DRAFT.md, FINAL.md). */
  readonly text: string;
  /** The keys the text may cite: the section's assigned_sources (at done: every compiled section's). */
  readonly allowedKeys: ReadonlySet<string>;
  readonly scope: GateScope;
  /** --dry-run: the stub marker is expected and does not block. */
  readonly dryRun: boolean;
  /** Citekeys whose registrar lookups skip the HTTP cache (VRFY-28). */
  readonly refresh?: ReadonlySet<string>;
  /** Quote acceptances to honour (D-20-22). */
  readonly acceptanceSets?: readonly AcceptanceSet[];
  /** The bibliography (default: read from the paper). */
  readonly bib?: LoadedBibliography;
  /** Default: TEXT_SCANNERS. */
  readonly scanners?: readonly TextScanner[];
  /** Test seams for the two passes (default: the production runPass1 / runPass3). */
  readonly deps?: {
    readonly runPass1?: (text: string, bibPath: string, opts: Pass1Options) => Promise<Pass1Result[]>;
    readonly runPass3?: (text: string, bib: Map<string, Record<string, unknown>>, opts: Pass3Options) => Promise<Pass3Result[]>;
  };
}

export interface GateResult {
  readonly rows: GateRow[];
  readonly outcome: SectionOutcome;
  /** Acceptances that lifted an UNVERIFIABLE-QUOTE row. */
  readonly accepted: AcceptedQuote[];
  /** Quotes verified against the user's own PDF. */
  readonly byoQuotes: ByoQuote[];
  /** citekey → when its passing registrar answer was obtained (ISO-8601). */
  readonly checkedAt: Record<string, string>;
  /** Every key the text cites (the one grammar), in first-appearance order. */
  readonly citedKeys: string[];
  readonly bib: LoadedBibliography;
}

function unassignedReason(scope: GateScope, key: string): string {
  return scope.kind === 'section'
    ? `not in section ${scope.id}'s assigned_sources — re-plan the section's sources with \`pensmith plan ${scope.id} --revise\`, ` +
        `or assign it to the section with \`pensmith add --remap ${key} --section ${scope.id}\``
    : 'not in the assigned_sources of any section of the paper — cite only a section\'s assigned sources ' +
        `(\`pensmith plan <N> --revise\`, or \`pensmith add --remap ${key} --section <N>\`), then re-verify and recompile`;
}

function bibProblemLine(p: BibEntryProblem): string {
  return `line ${p.line}${p.key !== null ? ` (${p.key})` : ''}: ${p.detail}`;
}

/** Rewrite the Pass-1 rows the bibliography's state decides: an unparseable entry, a missing or empty file. */
function bibAwareRow(r: Pass1Result, bib: LoadedBibliography, parsedKeys: ReadonlySet<string>): Pass1GateRow {
  const base: Pass1GateRow = {
    kind: 'pass1',
    key: r.citekey,
    verdict: r.verdict,
    titleJW: r.titleJW,
    authorJW: r.authorJW,
    reason: r.reason,
    ...(r.retraction === true ? { retraction: true } : {}),
    ...(r.checkedAt !== undefined ? { checkedAt: r.checkedAt } : {}),
  };
  if (parsedKeys.has(r.citekey)) return base;
  const bad = bib.problems.find((p) => p.key === r.citekey);
  if (bad !== undefined) {
    return {
      kind: 'pass1',
      key: r.citekey,
      verdict: 'UNPARSEABLE',
      titleJW: Number.NaN,
      authorJW: Number.NaN,
      reason:
        `its .paper/CITATIONS.bib entry (line ${bad.line}) does not parse: ${bad.detail} — fix that entry by hand, ` +
        'or re-render the file from LIBRARY.json (`pensmith verify` does it when the paper has a LIBRARY.json)',
    };
  }
  if (r.verdict !== 'FABRICATED') return base;
  if (!bib.exists) {
    if (bib.unreadable !== undefined) {
      return { ...base, reason: `.paper/CITATIONS.bib could not be read (${bib.unreadable}), so this citation cannot be checked — make the file readable (or rebuild it with \`pensmith research\` / \`pensmith add <id>\`), then re-verify` };
    }
    return { ...base, reason: '.paper/CITATIONS.bib is missing, so this citation cannot be checked — rebuild it with `pensmith research` (or `pensmith add <id>`), then re-verify' };
  }
  if (bib.entries.length === 0 && bib.problems.length === 0) {
    return { ...base, reason: '.paper/CITATIONS.bib has no entries, so this key is in no bibliography — add the source (`pensmith add <id>`) or cite one the paper has' };
  }
  const unkeyed = bib.problems.filter((p) => p.key === null);
  return unkeyed.length > 0
    ? { ...base, reason: `${r.reason} (CITATIONS.bib also has entries that do not parse: ${unkeyed.map(bibProblemLine).join('; ')})` }
    : base;
}

/** The citekey → bib-entry map Pass 3 reads (id → entry). */
function bibMap(entries: ReadonlyArray<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  return new Map(entries.map((e) => [String(e['id'] ?? ''), e]));
}

/** The valid acceptance covering a recomputed UNVERIFIABLE-QUOTE row, or null. */
function acceptanceFor(
  row: { key: string; quoteSha256: string; verdict: string },
  sets: readonly AcceptanceSet[],
): { a: QuoteAcceptance; section?: string } | null {
  if (row.verdict !== ACCEPTABLE_QUOTE_VERDICT) return null;
  for (const set of sets) {
    for (const a of set.acceptances) {
      if (a.citekey === row.key && a.quote_sha256 === row.quoteSha256 && a.draft_sha256 === set.currentDraftHash) {
        return set.section !== undefined ? { a, section: set.section } : { a };
      }
    }
  }
  return null;
}

/**
 * Apply the acceptances to Pass-3 rows (the one place an acceptance lifts a
 * verdict). Returns the rows (an accepted row keeps its UNVERIFIABLE-QUOTE
 * label and carries `accepted`) and what was honoured.
 */
export function applyAcceptances(
  rows: readonly GateRow[],
  sets: readonly AcceptanceSet[],
): { rows: GateRow[]; accepted: AcceptedQuote[] } {
  const accepted: AcceptedQuote[] = [];
  const out = rows.map((r): GateRow => {
    if (r.kind !== 'pass3') return r;
    const hit = acceptanceFor(r, sets);
    if (hit === null) {
      if (r.accepted === undefined) return r;
      const { accepted: _drop, ...rest } = r;
      void _drop;
      return rest;
    }
    accepted.push({
      id: r.id,
      citekey: r.key,
      excerpt: hit.a.excerpt,
      acceptedAt: hit.a.accepted_at,
      via: hit.a.via,
      ...(hit.section !== undefined ? { section: hit.section } : {}),
    });
    return { ...r, accepted: { at: hit.a.accepted_at, via: hit.a.via } };
  });
  return { rows: out, accepted };
}

/** The section outcome of gate rows (an accepted UNVERIFIABLE-QUOTE passes). */
export function gateOutcome(rows: readonly GateRow[]): SectionOutcome {
  return sectionOutcome(rows.map((r) => ({ verdict: r.verdict, accepted: r.kind === 'pass3' && r.accepted !== undefined })));
}

/** True when the row blocks compile and done. */
export function rowBlocks(row: GateRow): boolean {
  return blocksCompile(row.verdict, row.kind === 'pass3' && row.accepted !== undefined);
}

/**
 * Recompute every blocking verdict for one text (D-20-05). Never writes a
 * file. Pass 1 and Pass 3 reach the registrars and open-access hosts through
 * http.ts (the HTTP cache, offline fixture replay or fail-closed), so a failed
 * lookup is a blocking UNVERIFIABLE row, never a pass.
 */
export async function recomputeGate(input: GateInput): Promise<GateResult> {
  const bib = input.bib ?? loadBibliography(input.root);
  const runPass1 = input.deps?.runPass1 ?? defaultRunPass1;
  const runPass3 = input.deps?.runPass3 ?? defaultRunPass3;
  const citedKeys = extractCitedKeysForVerification(input.text);
  const parsedKeys = new Set(bib.entries.map((e) => String(e['id'] ?? '')));

  const pass1 = await runPass1(input.text, bib.path, {
    root: input.root,
    bibEntries: bib.entries,
    ...(input.refresh !== undefined ? { refresh: input.refresh } : {}),
  });
  const rows: GateRow[] = [];
  for (const r of pass1) {
    rows.push(bibAwareRow(r, bib, parsedKeys));
    // VRFY-17: a cited key outside the allowed set — its own row next to its registrar row.
    if (citedKeys.includes(r.citekey) && !input.allowedKeys.has(r.citekey)) {
      rows.push({ kind: 'pass1', key: r.citekey, verdict: 'UNASSIGNED', titleJW: Number.NaN, authorJW: Number.NaN, reason: unassignedReason(input.scope, r.citekey) });
    }
  }
  for (const scan of input.scanners ?? TEXT_SCANNERS) {
    for (const f of scan(input.text)) {
      rows.push({ kind: 'text', key: `L${f.line}`, line: f.line, verdict: f.verdict, form: f.form, text: f.text, reason: f.reason });
    }
  }

  const pass3 = await runPass3(input.text, bibMap(bib.entries), { root: input.root });
  for (const r of pass3) {
    rows.push({
      kind: 'pass3',
      key: r.citekey,
      id: r.id,
      quoteSha256: r.quoteSha256,
      snippet: r.quoteSnippet,
      verdict: r.verdict,
      levRatio: r.levRatio,
      reason: r.reason,
      ...(r.localFile !== undefined ? { localFile: r.localFile } : {}),
    });
  }

  if (!input.dryRun && hasStubMarker(input.text)) {
    rows.push({
      kind: 'draft',
      verdict: 'PLACEHOLDER',
      reason:
        'this is stub text written with no model configured (PENSMITH_NO_LLM=1 or --dry-run), not real prose — ' +
        `re-draft it with a model configured: \`pensmith write ${input.scope.kind === 'section' ? input.scope.id : '<N>'}\``,
    });
  }
  if (citedKeys.length === 0 && input.allowedKeys.size > 0) {
    rows.push({ kind: 'draft', verdict: 'NO-CITATIONS', reason: `no citations; ${input.allowedKeys.size} source${input.allowedKeys.size === 1 ? '' : 's'} assigned` });
  }

  const lifted = applyAcceptances(rows, input.acceptanceSets ?? []);
  const checkedAt: Record<string, string> = {};
  for (const r of lifted.rows) {
    if (r.kind === 'pass1' && PASSING_VERDICTS.has(r.verdict) && r.checkedAt !== undefined) checkedAt[r.key] = r.checkedAt;
  }
  const byoQuotes: ByoQuote[] = [];
  for (const r of lifted.rows) {
    if (r.kind === 'pass3' && r.localFile !== undefined && PASSING_VERDICTS.has(r.verdict)) {
      byoQuotes.push({ id: r.id, citekey: r.key, snippet: r.snippet, localFile: r.localFile });
    }
  }
  return { rows: lifted.rows, outcome: gateOutcome(lifted.rows), accepted: lifted.accepted, byoQuotes, checkedAt, citedKeys, bib };
}

// ---------------------------------------------------------------------------
// Refusal wording (compile, done)
// ---------------------------------------------------------------------------

/** One line naming why a blocking row refuses and what fixes it. */
export function gateRowReason(row: GateRow, scope: GateScope): string {
  const n = scope.kind === 'section' ? scope.id : '<N>';
  switch (row.kind) {
    case 'pass1':
      if (row.verdict === 'UNVERIFIABLE' || RETRY_ONLINE_VERDICTS.has(row.verdict)) {
        return `citation [@${row.key}] is ${row.verdict} (${row.reason}) — its source could not be checked; re-run online`;
      }
      return `citation [@${row.key}] is ${row.verdict} — ${row.reason}`;
    case 'text':
      return `line ${row.line}: ${row.verdict} \`${row.text.replace(/`/g, "'").slice(0, 80)}\` — ${row.reason}`;
    case 'pass3': {
      const who = row.key === UNATTRIBUTED_CITEKEY ? 'with no citation' : `[@${row.key}]`;
      const head = `quote ${row.id} ("${row.snippet}…") ${who} is ${row.verdict} — ${row.reason}`;
      if (row.verdict === ACCEPTABLE_QUOTE_VERDICT) {
        return (
          `${head} — add the source's PDF (\`pensmith add <pdf>\`), paraphrase the quote (\`pensmith plan ${n} --revise\`), ` +
          `or accept this one quote (\`pensmith verify ${n} --accept-quote ${row.id}\`)`
        );
      }
      if (RETRY_ONLINE_VERDICTS.has(row.verdict)) return `${head}; re-run online`;
      return head;
    }
    case 'draft':
      return `${row.verdict} — ${row.reason}`;
  }
}

/** The refusal lines of a gate result (empty when nothing blocks). */
export function gateRefusals(result: Pick<GateResult, 'rows'>, scope: GateScope): string[] {
  return result.rows.filter(rowBlocks).map((r) => gateRowReason(r, scope));
}

// ---------------------------------------------------------------------------
// VRFY-28 — which citations to re-check past the HTTP cache
// ---------------------------------------------------------------------------

/**
 * The cited keys whose LIBRARY.json `last_verified` is null or older than
 * `[verification] recheck_after_days` (default 30) at verificationNow(): their
 * registrar lookups skip the HTTP-cache read (Pass1Options.refresh). Keys the
 * library does not hold are served from the cache as usual. Never throws (an
 * unreadable library or config re-checks nothing).
 */
export async function recheckKeys(root: string, citedKeys: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (citedKeys.length === 0) return out;
  let days = DEFAULT_RECHECK_AFTER_DAYS;
  try {
    const cfg = tryReadPaperConfigSync(root)?.verification?.recheck_after_days;
    if (typeof cfg === 'number') days = cfg;
  } catch {
    /* default */
  }
  let lib;
  try {
    lib = await tryLoadLibrary(root);
  } catch {
    return out;
  }
  if (lib === null) return out;
  const byKey = new Map(lib.entries.map((e) => [e.citekey, e]));
  const now = verificationNow();
  for (const key of citedKeys) {
    const e = byKey.get(key);
    if (e !== undefined && needsRecheck(e.last_verified ?? null, days, now)) out.add(key);
  }
  return out;
}
