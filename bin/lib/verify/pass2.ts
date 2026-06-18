// bin/lib/verify/pass2.ts — Pass 2 (claim support) advisory side-channel (VRFY-03).
//
// Modeled structurally on bin/lib/verify/freshness.ts: an advisory pass that
// runs AFTER the blocking verdict (Pass 1 + Pass 3) is frozen and NEVER feeds
// back into `hasFail` / `status`. This module returns Pass2Result[] ONLY — the
// orchestrator wiring (Plan 05-04) reads the results below the locked status
// line. There is NO hasFail / status reference anywhere in this file by design
// (VRFY-07; tests/verify-advisory-isolation.test.ts is the structural gate).
//
// For each in-text [@citekey] occurrence Pass 2:
//   1. extracts the citing sentence deterministically (pure regex, no LLM), and
//   2. (live branch only) asks the hash-pinned `claim-support` prompt for a
//      verdict in {SUPPORTED, PARTIAL, UNSUPPORTED, UNCLEAR}.
//
// UNCLEAR-bias is the load-bearing correctness property (VRFY-03): both the
// offline placeholder AND the prompt default to UNCLEAR rather than manufacturing
// a confident SUPPORTED on thin evidence.
//
// Offline guard (Pattern 4 — analog: bin/cli/revise.ts): under PENSMITH_NO_LLM=1
// (or when ANTHROPIC_API_KEY is absent) Pass 2 returns a conservative UNCLEAR
// placeholder for every citation and issues NO network call. This is the CI path.
//
// Budget gate (ARCH-09/10 — analog: bin/lib/budget.ts): the live branch calls
// assertBudget BEFORE every model call and appendCost AFTER it, scoped to a
// per-section cap (PASS2_SECTION_CAP). The api key is resolved ONLY through the
// no-leak runtime chokepoint (getProviderApiKey); the value never reaches a log
// or the cost ledger (T-05-02-02).

import Anthropic from '@anthropic-ai/sdk';
import { assertBudget, appendCost } from '../budget.js';
import { estimateCost } from '../pricing.js';
import { loadPrompt, interpolate } from '../prompt-loader.js';
import { getProviderApiKey, loadRuntimeConfig } from '../runtime.js';

export type Pass2Verdict = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNCLEAR';

export interface Pass2Result {
  citekey: string;
  /** The sentence in the draft that carries the [@citekey] token. */
  claimSentence: string;
  verdict: Pass2Verdict;
  /** <=200 chars, table-cell-safe (no markdown/HTML/newlines). */
  rationale: string;
  /** Verbatim substring of the source abstract, or '' (anti-fabrication). */
  evidence: string;
}

/** The bib metadata shape the caller (Plan 05-04) supplies — widened to carry
 *  title / author / abstract so the live claim-support prompt has source text. */
export type Pass2BibEntry = {
  DOI?: string;
  title?: string | string[];
  author?: Array<{ family?: string; given?: string }> | string[];
  abstract?: string;
};

interface ClaimPair {
  citekey: string;
  claimSentence: string;
}

const CITEKEY_RE = /\[@([a-z][a-z0-9_-]*)\]/g;

/**
 * Deterministic claim-sentence extraction. Splits `draftMd` into sentences on a
 * pure-regex boundary (terminal . / ! / ? followed by whitespace) and returns
 * the sentence(s) that contain the literal `[@<citekey>]` token. No NLP, no LLM
 * — identical input always yields identical output (PRD §14 determinism).
 */
function extractClaimSentences(draftMd: string, citekey: string): string[] {
  const token = `[@${citekey}]`;
  // Split on a sentence boundary: terminal punctuation followed by whitespace.
  // The lookbehind keeps the punctuation attached to the preceding sentence.
  const sentences = draftMd.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence.length > 0 && sentence.includes(token)) {
      out.push(sentence);
    }
  }
  return out;
}

/**
 * Conservative offline placeholder (UNCLEAR-bias). Mirrors the revise.ts
 * Tier-2-placeholder stance: deterministic, reproducible, never confident.
 */
function pass2Placeholder(claimSentence: string, citekey: string): Pass2Result {
  return {
    citekey,
    claimSentence,
    verdict: 'UNCLEAR',
    rationale: 'Tier-2 placeholder: no LLM transport wired.',
    evidence: '',
  };
}

/**
 * Build the ordered, de-duplicated list of (citekey, claimSentence) pairs to
 * judge. Each UNIQUE citekey contributes one pair using its first extracted
 * claim sentence; a citekey with no resolvable sentence still produces a pair
 * with an empty sentence so the offline placeholder path is total over the
 * draft's citations.
 */
function collectClaimPairs(draftMd: string): ClaimPair[] {
  const citekeys = [...draftMd.matchAll(CITEKEY_RE)]
    .map((m) => m[1])
    .filter((s): s is string => Boolean(s));
  const unique = [...new Set(citekeys)];
  return unique.map((citekey) => {
    const sentences = extractClaimSentences(draftMd, citekey);
    return { citekey, claimSentence: sentences[0] ?? '' };
  });
}

// Per-section Pass 2 cap (ARCH-10 per-step cap). A config knob (05-RESEARCH Open
// Question 1) — no CONTEXT.md locks it, so default at Claude's discretion to
// $0.50/section, which leaves ample headroom under the $5 session cap even for
// many-citation sections using claude-haiku-4 (~$0.007/call).
const PASS2_SECTION_CAP_DEFAULT = 0.5;

// Conservative fixed token estimates for the pre-call budget gate. The real
// usage is recorded by appendCost AFTER the call from the SDK's usage report;
// these only need to be a safe upper-ish bound for the gate (DoS mitigation,
// T-05-02-04). claude-haiku-4 at 1500/300 tok ≈ $0.0024 — well under the cap.
const EST_INPUT_TOKENS = 1500;
const EST_OUTPUT_TOKENS = 300;
const DEFAULT_MODEL = 'claude-haiku-4';

/** Normalize a CSL-style title (string | string[]) to a single string. */
function normalizeTitle(title: Pass2BibEntry['title']): string {
  if (Array.isArray(title)) return title.filter(Boolean).join(' ');
  return title ?? '';
}

/** Normalize a CSL-style author list to a comma-joined display string. */
function normalizeAuthors(author: Pass2BibEntry['author']): string {
  if (!author) return '';
  return author
    .map((a) => {
      if (typeof a === 'string') return a;
      const family = a.family ?? '';
      const given = a.given ?? '';
      return [given, family].filter(Boolean).join(' ').trim();
    })
    .filter(Boolean)
    .join(', ');
}

/** Clamp a free-text field to a table-cell-safe single line of <=max chars. */
function clampText(text: string, max: number): string {
  return text.replace(/[\r\n|]+/g, ' ').trim().slice(0, max);
}

/**
 * Parse the model's JSON response into a validated Pass2Result. Defensive:
 *   - verdict must be one of the four enum values, else UNCLEAR (UNCLEAR-bias)
 *   - rationale clamped to <=200 chars, newline/pipe-stripped
 *   - evidence must be a verbatim substring of the abstract, else '' (anti-fab)
 */
function parsePass2Response(
  raw: string,
  citekey: string,
  claimSentence: string,
  abstract: string,
): Pass2Result {
  let verdict: Pass2Verdict = 'UNCLEAR';
  let rationale = '';
  let evidence = '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = parsed['verdict'];
    if (v === 'SUPPORTED' || v === 'PARTIAL' || v === 'UNSUPPORTED' || v === 'UNCLEAR') {
      verdict = v;
    }
    if (typeof parsed['rationale'] === 'string') {
      rationale = clampText(parsed['rationale'], 200);
    }
    if (typeof parsed['evidence'] === 'string' && parsed['evidence'].length > 0) {
      // Anti-fabrication (T-05-02-01): evidence MUST be a substring of the abstract.
      evidence = abstract.includes(parsed['evidence']) ? parsed['evidence'] : '';
    }
  } catch {
    // Unparseable response → conservative UNCLEAR (UNCLEAR-bias).
    verdict = 'UNCLEAR';
    rationale = 'LLM response was not valid JSON; defaulting to UNCLEAR.';
  }
  return { citekey, claimSentence, verdict, rationale, evidence };
}

/** Resolve the anthropic model id from runtime config's defaultModel, falling
 *  back to the cheapest priced model. Never reads the api key here. */
async function resolveModelId(): Promise<string> {
  try {
    const cfg = await loadRuntimeConfig({ scope: 'auto' });
    return cfg.providers?.['anthropic']?.defaultModel ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/**
 * Pass 2 advisory claim-support run. Returns one Pass2Result per UNIQUE
 * [@citekey] in `draftMd`. Under PENSMITH_NO_LLM=1 (or no ANTHROPIC_API_KEY)
 * every result is the conservative UNCLEAR placeholder and no network call is
 * made. A draft with zero citations returns []. Advisory by construction — this
 * function NEVER mutates any shared blocking state.
 */
export async function runPass2(
  draftMd: string,
  bibByCitekey: Map<string, Pass2BibEntry>,
  opts: { n: number; scopeCapUsd?: number },
): Promise<Pass2Result[]> {
  const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
  const pairs = collectClaimPairs(draftMd);
  if (pairs.length === 0) return [];

  if (noLlm) {
    return pairs.map((p) => pass2Placeholder(p.claimSentence, p.citekey));
  }

  // ---- Live claim-support branch (only reached with a real key + LLM enabled).
  // Never reached in CI: the noLlm short-circuit above is the test path.
  const cap = opts.scopeCapUsd ?? PASS2_SECTION_CAP_DEFAULT;
  const scopeId = `${opts.n}-pass2`;
  const promptTemplate = loadPrompt('claim-support');
  const modelId = await resolveModelId();
  const apiKey = await getProviderApiKey('anthropic');
  const client = new Anthropic({ apiKey });

  const results: Pass2Result[] = [];
  for (const pair of pairs) {
    const bibEntry = bibByCitekey.get(pair.citekey);
    const abstract = bibEntry?.abstract ?? '';
    try {
      const prompt = interpolate(promptTemplate, {
        citekey: pair.citekey,
        claim_sentence: pair.claimSentence,
        source_abstract: abstract,
        source_title: normalizeTitle(bibEntry?.title),
        source_authors: normalizeAuthors(bibEntry?.author),
      });

      // ARCH-10 pre-call gate: assertBudget BEFORE the model call. A
      // BudgetExceededError here aborts the call (financial-safety boundary).
      const estimatedCallCost = estimateCost({
        providerId: 'anthropic',
        modelId,
        inputTokens: EST_INPUT_TOKENS,
        outputTokens: EST_OUTPUT_TOKENS,
      });
      await assertBudget({ scope: 'section', scopeId, cap }, estimatedCallCost);

      const res = await client.messages.create({
        model: modelId,
        max_tokens: EST_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      });

      const inputTokens = res.usage?.input_tokens ?? EST_INPUT_TOKENS;
      const outputTokens = res.usage?.output_tokens ?? EST_OUTPUT_TOKENS;
      await appendCost({
        ts: new Date().toISOString(),
        scope: 'section',
        scopeId,
        provider: 'anthropic',
        model: modelId,
        inputTokens,
        outputTokens,
        costUsd: estimateCost({ providerId: 'anthropic', modelId, inputTokens, outputTokens }),
      });

      const textBlock = res.content.find((b) => b.type === 'text');
      const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : '';
      results.push(parsePass2Response(rawText, pair.citekey, pair.claimSentence, abstract));
    } catch (err) {
      // Any failure (budget, transport, parse) surfaces as a conservative
      // UNCLEAR — never thrown out of runPass2 (advisory must not crash verify).
      results.push({
        citekey: pair.citekey,
        claimSentence: pair.claimSentence,
        verdict: 'UNCLEAR',
        rationale: clampText(`LLM error: ${String(err)}`, 200),
        evidence: '',
      });
    }
  }
  return results;
}

/**
 * Render the `## Pass-2` advisory section for VERIFICATION.md. Deterministic,
 * no LLM. Mirrors renderFreshnessTable. Emits table-cell-safe text only (no
 * HTML; claim sentence truncated to ~60 chars) — LLM-output-injection
 * mitigation (T-05-02-03). Empty results → a "no citations" section.
 */
export function renderPass2Section(results: ReadonlyArray<Pass2Result>): string {
  if (results.length === 0) {
    return '## Pass-2 (claim support, advisory)\n\n_(no citations to judge)_\n';
  }
  const lines = [
    '## Pass-2 (claim support, advisory — LLM-judged)',
    '',
    '| Citekey | Claim Sentence | Verdict | Rationale |',
    '|---------|---------------|---------|-----------|',
  ];
  for (const r of results) {
    const sentence = clampText(r.claimSentence, 60);
    const rationale = clampText(r.rationale, 200);
    lines.push(`| ${r.citekey} | ${sentence} | **${r.verdict}** | ${rationale} |`);
  }
  lines.push('');
  return lines.join('\n');
}
