// bin/lib/verify/pass2.ts — Pass 2 (claim support), advisory (VRFY-03, VRFY-21, VRFY-22, D-20-28).
//
// Modeled structurally on bin/lib/verify/freshness.ts: an advisory pass that
// runs AFTER the blocking verdict (Pass 1 + Pass 3) is frozen and NEVER feeds
// back into `hasFail` / `status`. This module returns Pass2Result[] ONLY — the
// verify orchestrator renders it below the locked status line. There is NO
// hasFail / status reference anywhere in this file by design (VRFY-07;
// tests/verify-advisory-isolation.test.ts is the structural gate).
//
// Every (citing sentence, citekey) pair of the draft is judged once:
//   1. the sentences come from the shared splitter (verify/draft-text.ts
//      claimPairs over draftSentences — never split inside a citation), and
//      the keys of each sentence from the one citation grammar
//      (citation-token.ts citationItems), so
//      `[@smith2020, p. 5]`, `[@a; @b]`, `[-@k]`, `@{k}` and a narrative `@k`
//      all yield their keys;
//   2. the SOURCE TEXT the judge reads is the LIBRARY.json abstract (clipped by
//      source-context.ts claimSupportAbstract), else the bib `abstract`; when
//      `[verification] fetch_full_text` is not false and the caller passes a
//      `fullText(citekey, claim)` provider (verify: the open-access text's
//      passage nearest the claim — never the user's own PDF), that passage is
//      added; a bring-your-own PDF's passages are added only with
//      `[verification] send_byo_passages = true` (PRD §9: the contents of a
//      bring-your-own PDF stay local by default; byo-text.ts re-hashes the PDF);
//   3. a pair with no source text at all is UNCLEAR "no source text (no
//      abstract or full text)" and makes NO model call — never a judgment on
//      the title alone;
//   4. otherwise the hash-pinned `claim-support` prompt is asked (at most
//      PASS2_CONCURRENCY requests in flight, budget.ts Semaphore) for a verdict
//      in {SUPPORTED, PARTIAL, UNSUPPORTED, UNCLEAR} with evidence, and the
//      evidence is kept only when it is a verbatim substring of the text sent.
//
// UNCLEAR-bias is the load-bearing correctness property (VRFY-03): the
// offline placeholder, the no-text rule and the prompt all default to UNCLEAR
// rather than manufacturing a confident SUPPORTED on thin evidence.
//
// Offline guard: under PENSMITH_NO_LLM=1 every pair with source text is a
// conservative UNCLEAR placeholder and NO model call, full-text fetch or BYO
// read is made.
//
// Cost: every live claim-support call goes through complete(), which checks the
// SESSION cost cap before sending (RUN-18) and records the actual cost after.
// claim-support is a judgment slug (claude-haiku-4-5 by default, RUN-26) with a
// structured contract (RUN-25): complete() returns the validated
// {verdict, rationale, evidence} object. The api key is resolved ONLY inside the
// transport; the value never reaches a log or the cost ledger (T-05-02-02).

import { complete, isFatalLlmError, MissingApiKeyError } from '../anthropic.js';
import { Semaphore } from '../budget.js';
import { byoText, byoPassages, BYO_PASSAGE_CHARS, type ByoTextResult } from '../byo-text.js';
import { tryReadPaperConfigSync } from '../config.js';
import { tryLoadLibrary } from '../library.js';
import type { ClaimSupport } from '../llm-contracts.js';
import { buildPromptRequest, requestHints, type PromptRequest } from '../prompt-request.js';
import type { LibraryEntry } from '../schemas/library.js';
import { claimSupportAbstract, clip } from '../source-context.js';
import { reportAdvisoryFailure } from './pass4.js';
import { claimPairs, type ClaimPair as DraftClaimPair } from './draft-text.js';
import { PASS2_TABLE_HEADER } from './verdicts.js';

export { reportAdvisoryFailure } from './pass4.js';

// FEED-05 (D-18-04): the claim sentence (draft text), the source text and the
// source metadata (from the registrars, an open-access copy or the user's
// PDF) are untrusted. They reach the model only as data blocks the ONE
// renderer fences (prompt-request.ts → untrusted-fence.ts), after every
// spelling of a fence marker and every closing block tag in them has been
// neutralised — a crafted abstract can neither end its fence nor its block.
// The fence constants live in bin/lib/untrusted-fence.ts alone
// (tests/pass2-injection.test.ts greps).

export type Pass2Verdict = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNCLEAR';

export interface Pass2Result {
  citekey: string;
  /** The sentence in the draft that carries the citation. */
  claimSentence: string;
  verdict: Pass2Verdict;
  /** <=200 chars, table-cell-safe (no markdown/HTML/newlines). */
  rationale: string;
  /** A verbatim substring of the source text the judge read, or '' (anti-fabrication). */
  evidence: string;
}

/** The bib metadata shape the caller supplies: title / author / abstract for the request. */
export type Pass2BibEntry = {
  DOI?: string;
  title?: string | string[];
  author?: Array<{ family?: string; given?: string }> | string[];
  abstract?: string;
};

/** Returns the passage of a source's open-access full text nearest `claim`, or null (never the user's own PDF). */
export type FullTextProvider = (citekey: string, claim: string) => Promise<string | null>;

/** At most this many claim-support requests are in flight at once (VRFY-21). */
export const PASS2_CONCURRENCY = 5;

/** The longest full-text passage one request carries. */
export const PASS2_FULL_TEXT_CHARS = BYO_PASSAGE_CHARS;

/** The rationale of a pair whose source has no text at all (no request is made). */
export const NO_SOURCE_TEXT_RATIONALE = 'no source text (no abstract or full text)';

/** Why an advisory pass made no model call when no provider key is configured. */
export const NO_LLM_SKIP_REASON = 'skipped (no LLM configured)';

/** The longest claim sentence and evidence shown in the Pass-2 table. */
export const PASS2_SENTENCE_CHARS = 120;
export const PASS2_EVIDENCE_CHARS = 160;

type ClaimPair = DraftClaimPair;

/** Every (citing sentence, citekey) pair of `draftMd` (verify/draft-text.ts claimPairs). */
function collectClaimPairs(draftMd: string): ClaimPair[] {
  return claimPairs(draftMd).map((p) => ({ ...p }));
}

/** Conservative placeholder under PENSMITH_NO_LLM (UNCLEAR-bias, deterministic). */
function pass2Placeholder(p: ClaimPair): Pass2Result {
  return { ...p, verdict: 'UNCLEAR', rationale: 'LLM stubbed (PENSMITH_NO_LLM): no claim-support judgment was made.', evidence: '' };
}

/** A conservative UNCLEAR row for a pair that was not judged (`why` says why). */
function pass2Skipped(p: ClaimPair, why: string): Pass2Result {
  return { ...p, verdict: 'UNCLEAR', rationale: `${why}: no claim-support judgment was made.`, evidence: '' };
}

/** The row of a pair whose source has no text: never judged on its title alone. */
function noSourceText(p: ClaimPair): Pass2Result {
  return { ...p, verdict: 'UNCLEAR', rationale: NO_SOURCE_TEXT_RATIONALE, evidence: '' };
}

/**
 * The Pass-2 rows for a verify whose advisory passes were stopped (the session
 * cost cap, an invalid runtime config): one UNCLEAR row per (sentence, key)
 * pair with `not run: <reason>`, in the pinned table shape `done` parses.
 */
export function pass2NotRun(draftMd: string, reason: string): Pass2Result[] {
  return collectClaimPairs(draftMd).map((p) => pass2Skipped(p, `not run (${reason})`));
}

/** Normalize a CSL-style title (string | string[]) to a single string. */
function normalizeTitle(title: Pass2BibEntry['title']): string {
  if (Array.isArray(title)) return title.filter(Boolean).join(' ');
  return title ?? '';
}

/** Normalize a CSL-style author list to display names ("Given Family"), at most five. */
function normalizeAuthors(author: Pass2BibEntry['author']): string[] {
  if (!author) return [];
  return author
    .map((a) => {
      if (typeof a === 'string') return a;
      return [a.given ?? '', a.family ?? ''].filter(Boolean).join(' ').trim();
    })
    .filter(Boolean)
    .slice(0, 5);
}

/**
 * The claim-support request for one (claim sentence, citation) pair: the fixed
 * template as the system prompt — byte-identical for every pair, so from the
 * second call on it is read from the prompt cache where the model's minimum
 * allows (RUN-26) — and one data message with the `citation`, `claim` and
 * `source_text` blocks, each fenced (18-PLAN.md §3.3). `sourceText` defaults
 * to the bib entry's clipped abstract.
 */
export function claimSupportRequest(
  citekey: string,
  claimSentence: string,
  bibEntry: Pass2BibEntry | undefined,
  sourceText: string = claimSupportAbstract(bibEntry) ?? '',
): PromptRequest {
  return buildPromptRequest('claim-support', {
    citation: { citekey, title: normalizeTitle(bibEntry?.title), authors: normalizeAuthors(bibEntry?.author) },
    claim: claimSentence,
    source_text: sourceText,
  });
}

/** Clamp a free-text field to a table-cell-safe single line of <=max chars. */
function clampText(text: string, max: number): string {
  return text.replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Turn the validated claim-support object into a Pass2Result. The schema
 * pins the verdict enum; this step keeps the table-cell and anti-fabrication
 * guarantees: the rationale clamped to <=200 chars, and the evidence kept
 * only when it is a verbatim substring of the source text sent (T-05-02-01).
 */
function toPass2Result(data: ClaimSupport, p: ClaimPair, sourceText: string): Pass2Result {
  const evidence = data.evidence.length > 0 && sourceText.includes(data.evidence) ? data.evidence : '';
  return { ...p, verdict: data.verdict, rationale: clampText(data.rationale, 200), evidence };
}

export interface Pass2Options {
  /** The section as logged (`1`, or `1a` for an inserted section). */
  n: number | string;
  /**
   * The project root: the LIBRARY.json abstracts, `[verification]
   * fetch_full_text` and, with `shareByoPassages`, the passages of a source's
   * hash-verified bring-your-own PDF (read only through byo-text.ts).
   */
  root?: string;
  /** `[verification] send_byo_passages` (default false: BYO text never leaves the machine, PRD §9). */
  shareByoPassages?: boolean;
  /** The open-access full-text passage nearest a claim (quotes' source-text module, passed in by verify). */
  fullText?: FullTextProvider;
  /** `[verification] fetch_full_text`; read from the paper's config.toml when omitted (default true). */
  fetchFullText?: boolean;
}

/** The source text of one pair, assembled lazily per source and claim. */
class SourceTexts {
  private library: Promise<Map<string, LibraryEntry>> | null = null;
  private readonly byo = new Map<string, Promise<ByoTextResult>>();

  constructor(
    private readonly bib: ReadonlyMap<string, Pass2BibEntry>,
    private readonly opts: Pass2Options,
    private readonly useFullText: boolean,
  ) {}

  private entries(): Promise<Map<string, LibraryEntry>> {
    const root = this.opts.root;
    this.library ??= root === undefined
      ? Promise.resolve(new Map())
      : tryLoadLibrary(root).then(
          (lib) => new Map((lib?.entries ?? []).map((e) => [e.citekey, e] as const)),
          () => new Map<string, LibraryEntry>(),
        );
    return this.library;
  }

  /** The LIBRARY.json abstract, else the bib abstract (clipped), or null. */
  async abstract(citekey: string): Promise<string | null> {
    const entry = (await this.entries()).get(citekey);
    return claimSupportAbstract(entry) ?? claimSupportAbstract(this.bib.get(citekey));
  }

  /** Whether any text could exist for `citekey` without reading or fetching it (the LLM-stubbed path). */
  async mayHaveText(citekey: string): Promise<boolean> {
    if ((await this.abstract(citekey)) !== null) return true;
    if (this.useFullText) return true;
    return this.opts.shareByoPassages === true && (await this.entries()).get(citekey)?.byo != null;
  }

  /** The labelled source text sent for `claim`, or '' when there is none. */
  async text(citekey: string, claim: string): Promise<string> {
    const parts: string[] = [];
    const abstract = await this.abstract(citekey);
    if (abstract !== null) parts.push(`Abstract:\n${abstract}`);
    const fullText = this.opts.fullText;
    if (this.useFullText && fullText !== undefined) {
      let passage: string | null = null;
      try {
        passage = await fullText(citekey, claim);
      } catch {
        passage = null; // advisory: an unavailable full text leaves the abstract
      }
      const t = passage?.replace(/\s+/g, ' ').trim() ?? '';
      if (t.length > 0) parts.push(`Passage from the open-access full text nearest the claim:\n${clip(t, PASS2_FULL_TEXT_CHARS)}`);
    }
    const byo = await this.byoPassage(citekey, claim);
    if (byo !== null) parts.push(byo);
    return parts.join('\n\n');
  }

  /** A hash-verified bring-your-own PDF's passages nearest `claim`, only with send_byo_passages. */
  private async byoPassage(citekey: string, claim: string): Promise<string | null> {
    const root = this.opts.root;
    if (root === undefined || this.opts.shareByoPassages !== true) return null;
    const entry = (await this.entries()).get(citekey);
    if (entry === undefined || entry.byo === null) return null;
    let t = this.byo.get(citekey);
    if (t === undefined) {
      t = byoText(root, entry);
      this.byo.set(citekey, t);
    }
    const r = await t;
    if (!r.available) return null;
    return `Passages from the full text of the user's own copy (${entry.byo.file}):\n${byoPassages(r.text, claim)}`;
  }
}

/** `[verification] fetch_full_text` of the paper at `root` (default true). */
function fetchFullTextSetting(root: string | undefined): boolean {
  if (root === undefined) return true;
  try {
    return tryReadPaperConfigSync(root)?.verification?.fetch_full_text !== false;
  } catch {
    return true;
  }
}

/**
 * Pass 2 advisory claim-support run: one Pass2Result per (citing sentence,
 * citekey) pair of `draftMd`, in document order (a draft with no citation
 * returns []). Under PENSMITH_NO_LLM=1, and when no provider key is
 * configured, no judgment is made (UNCLEAR rows). The session cost cap and an
 * invalid runtime configuration are rethrown after the requests in flight
 * settle (verify writes its deterministic verdict first). Advisory by
 * construction — this function NEVER touches blocking state.
 */
export async function runPass2(
  draftMd: string,
  bibByCitekey: ReadonlyMap<string, Pass2BibEntry>,
  opts: Pass2Options,
): Promise<Pass2Result[]> {
  const pairs = collectClaimPairs(draftMd);
  if (pairs.length === 0) return [];
  const useFullText = opts.fullText !== undefined && (opts.fetchFullText ?? fetchFullTextSetting(opts.root));
  const texts = new SourceTexts(bibByCitekey, opts, useFullText);

  // Provider-agnostic offline gate: only PENSMITH_NO_LLM short-circuits to the
  // placeholder. complete() owns provider + key resolution.
  if (process.env['PENSMITH_NO_LLM'] === '1') {
    const out: Pass2Result[] = [];
    for (const p of pairs) out.push((await texts.mayHaveText(p.citekey)) ? pass2Placeholder(p) : noSourceText(p));
    return out;
  }

  const results: Pass2Result[] = new Array<Pass2Result>(pairs.length);
  const semaphore = new Semaphore(PASS2_CONCURRENCY);
  // Set once no provider key is configured: the remaining pairs are skipped
  // (every call would fail the same way). Verify still writes its frozen
  // Pass-1/Pass-3 verdict — the advisory passes never need a key (D-V1-04).
  let noKey: string | null = null;
  let fatal: unknown = undefined;
  let failed = 0;
  let firstError: unknown;
  await Promise.all(
    pairs.map((pair, i) =>
      semaphore.withLock(async () => {
        if (fatal !== undefined) {
          results[i] = pass2Skipped(pair, 'not run (stopped)');
          return;
        }
        if (noKey !== null) {
          results[i] = pass2Skipped(pair, noKey);
          return;
        }
        const sourceText = await texts.text(pair.citekey, pair.claimSentence);
        if (sourceText === '') {
          results[i] = noSourceText(pair);
          return;
        }
        try {
          // WR-04 / FEED-05: the renderer fences the untrusted blocks.
          const request = claimSupportRequest(pair.citekey, pair.claimSentence, bibByCitekey.get(pair.citekey), sourceText);
          // The transport chokepoint (complete() → http.ts, D-06): the session
          // cost-cap check before sending, retry/backoff, the cost record after.
          const res = await complete<ClaimSupport>({
            slug: 'claim-support',
            section: opts.n,
            system: request.system,
            messages: request.messages,
            stubHint: requestHints(request),
          });
          results[i] = toPass2Result(res.data as ClaimSupport, pair, sourceText);
        } catch (err) {
          if (err instanceof MissingApiKeyError) {
            noKey = NO_LLM_SKIP_REASON;
            results[i] = pass2Skipped(pair, noKey);
            return;
          }
          // The session cost cap and invalid configuration are never advisory
          // — they stop verify. Any other failure (provider error, refusal,
          // truncation, a reply that never matched the schema) is a
          // conservative UNCLEAR: advisory must not crash verify.
          if (isFatalLlmError(err)) {
            fatal ??= err;
            results[i] = pass2Skipped(pair, 'not run (stopped)');
            return;
          }
          failed += 1;
          firstError ??= err;
          results[i] = { ...pair, verdict: 'UNCLEAR', rationale: clampText(`LLM error: ${String(err)}`, 200), evidence: '' };
        }
      }),
    ),
  );
  if (fatal !== undefined) throw fatal;
  if (failed > 0) reportAdvisoryFailure('Pass 2 (claim support)', failed, firstError);
  return results;
}

/** A value as a table cell: one line, no pipes, no HTML tag, at most `max` characters. */
function cell(text: string, max: number): string {
  return clampText(text.replace(/</g, '‹').replace(/>/g, '›'), max);
}

/**
 * Render the `## Pass-2` advisory section for VERIFICATION.md: one row per
 * (sentence, citekey) pair under PASS2_TABLE_HEADER (verdicts.ts), with the
 * Evidence column (VRFY-22) — every cell one line, pipe-free, HTML-free and
 * clamped (sentence 120, rationale 200, evidence 160 characters; T-05-02-03).
 * Deterministic, no LLM. Empty results → a "no citations" section.
 */
export function renderPass2Section(results: ReadonlyArray<Pass2Result>): string {
  if (results.length === 0) {
    return '## Pass-2 (claim support, advisory)\n\n_(no citations to judge)_\n';
  }
  const lines = [
    '## Pass-2 (claim support, advisory — LLM-judged)',
    '',
    PASS2_TABLE_HEADER,
    '|---------|----------------|---------|-----------|----------|',
  ];
  for (const r of results) {
    lines.push(
      `| ${cell(r.citekey, 120)} | ${cell(r.claimSentence, PASS2_SENTENCE_CHARS)} | **${r.verdict}** | ${cell(r.rationale, 200)} | ${cell(r.evidence, PASS2_EVIDENCE_CHARS)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
