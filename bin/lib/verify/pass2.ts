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
  void bibByCitekey;
  void opts;
  const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
  const pairs = collectClaimPairs(draftMd);
  if (pairs.length === 0) return [];

  if (noLlm) {
    return pairs.map((p) => pass2Placeholder(p.claimSentence, p.citekey));
  }

  // Live branch (Task 2) — wired below. Until then the offline path is the only
  // reachable branch in CI (noLlm short-circuit above).
  return pairs.map((p) => pass2Placeholder(p.claimSentence, p.citekey));
}
