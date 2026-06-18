// bin/lib/honesty.ts — DONE-04 detection-aware honesty score + DONE-05 pluggable backend.
//
// All HTTP through bin/lib/http.ts — ESLint chokepoint enforced. Honest-framing
// copy read VERBATIM from references/honesty-framing.md (locked, hash-pinned) —
// NEVER inlined in code. GPTZERO_API_KEY value never logged (T-01-07 presence-
// check only). The detection-aware honesty score (DONE-04) is transparency-only
// — it is NEVER an undetectability claim (PROJECT.md non-negotiable).
//
// The module mirrors bin/lib/plagiarism.ts + bin/lib/verify/pass2.ts:
//   - key-absence / offline guard → clean null skip, NEVER a crash (advisory);
//   - http.ts as the SOLE network chokepoint (source 'generic', noCache true);
//   - assertBudget BEFORE the live scored API call (ARCH-10 financial boundary);
//   - defensive response parse (unexpected shape / non-200 / parse error → null,
//     never a fabricated score);
//   - the resolved key value reaches ONLY the x-api-key request header — never a
//     log payload, the cost ledger, stdout, or a return value (presence-check
//     only at the call boundary).

import { fetch as httpFetch } from './http.js';
import { isOfflineMode, loadCassetteFile } from './http-mock.js';
import { assertBudget, appendCost } from './budget.js';

// ============================================================
//   Public types
// ============================================================

export type HonestyClassification = 'HUMAN_ONLY' | 'MIXED' | 'AI_ONLY';

/** The parsed detection-aware score. `aiProbability` is 0..1; `backend` names
 *  the strategy that produced it (DONE-05). Shown as-is with no trust claim. */
export interface HonestyScore {
  aiProbability: number;
  classification: HonestyClassification;
  backend: string;
}

/** Pluggable backend strategy (DONE-05). `score` is advisory: it resolves to a
 *  HonestyScore or null (skip-clean) and MUST NOT throw. */
export interface HonestyBackend {
  name: string;
  score(text: string): Promise<HonestyScore | null>;
}

// ============================================================
//   GPTZero backend (DONE-04)
// ============================================================

const GPTZERO_URL = 'https://api.gptzero.me/v2/predict/text';
const GPTZERO_SCOPE = 'https://api.gptzero.me';
const GPTZERO_PATH = '/v2/predict/text';

// Paper-level honesty budget gate (ARCH-10). GPTZero is not a token-metered LLM;
// the score runs at most twice per paper (before/after humanize). We model a
// small fixed per-call estimate and gate it under a paper-scoped cap so a
// runaway loop cannot rack up scoring cost. The value never depends on the key.
const HONESTY_PAPER_CAP_DEFAULT = 1.0;
const HONESTY_CALL_EST_USD = 0.02;
const HONESTY_BUDGET_SCOPE_ID = 'honesty-gptzero';

/**
 * Defensive parse of a GPTZero `/v2/predict/text` response object into a
 * HonestyScore. UNTRUSTED remote JSON — any unexpected shape (missing
 * documents, non-numeric ai probability) yields null (skip), NEVER a
 * fabricated score (T-06-03-03). The api key never enters this function.
 */
function parseGptzeroResponse(raw: unknown): HonestyScore | null {
  try {
    if (!raw || typeof raw !== 'object') return null;
    const docs = (raw as { documents?: unknown }).documents;
    if (!Array.isArray(docs) || docs.length === 0) return null;
    const first = docs[0] as {
      class_probabilities?: { ai?: unknown };
      document_classification?: unknown;
    };
    const ai = first?.class_probabilities?.ai;
    if (typeof ai !== 'number' || !Number.isFinite(ai)) return null;
    const rawClass = first?.document_classification;
    const classification: HonestyClassification =
      rawClass === 'HUMAN_ONLY' || rawClass === 'AI_ONLY' || rawClass === 'MIXED'
        ? rawClass
        : 'MIXED';
    return { aiProbability: ai, classification, backend: 'gptzero' };
  } catch {
    // Any unexpected access error → conservative skip (advisory-never-throws).
    return null;
  }
}

/** Read the matching GPTZero cassette response object (offline branch). */
function offlineGptzeroResponse(): unknown {
  const cassettes = loadCassetteFile('gptzero', 'predict-text');
  if (!cassettes || cassettes.length === 0) return null;
  const match =
    cassettes.find(
      (c) => c.scope === GPTZERO_SCOPE && c.path === GPTZERO_PATH && c.method === 'POST',
    ) ?? cassettes[0];
  return match?.response ?? null;
}

/**
 * Score `text` against GPTZero. Behavior:
 *   - GPTZERO_API_KEY absent → null (skip-clean banner; key never logged).
 *   - offline (PENSMITH_NETWORK_TESTS !== '1') → read the gptzero cassette and
 *     parse it defensively; no network call is made.
 *   - live → assertBudget BEFORE the call (paper-scoped cap), then httpFetch
 *     POST with the x-api-key header through the http.ts chokepoint; status
 *     !== 200 → null; parse defensively; appendCost AFTER a successful call.
 *
 * NEVER throws and NEVER logs the resolved key value (presence-check only).
 */
async function scoreWithGptzero(text: string): Promise<HonestyScore | null> {
  // Key-absence guard FIRST. Presence-check only — the value is never printed.
  const apiKey = process.env['GPTZERO_API_KEY'];
  if (!apiKey) {
    process.stdout.write('pensmith: GPTZero API key not set — honesty score skipped.\n');
    return null;
  }

  // Offline branch MUST NOT touch the network.
  if (isOfflineMode()) {
    return parseGptzeroResponse(offlineGptzeroResponse());
  }

  // Live branch — only reached with PENSMITH_NETWORK_TESTS=1 (never in CI).
  try {
    // ARCH-10 pre-call gate: assertBudget BEFORE the scored API call. A
    // BudgetExceededError here aborts the call (financial-safety boundary) and
    // is swallowed to a clean null skip below (advisory must never crash export).
    await assertBudget(
      { scope: 'paper', scopeId: HONESTY_BUDGET_SCOPE_ID, cap: HONESTY_PAPER_CAP_DEFAULT },
      HONESTY_CALL_EST_USD,
    );

    const resp = await httpFetch(GPTZERO_URL, {
      method: 'POST',
      source: 'generic',
      noCache: true,
      headers: {
        // The resolved key reaches ONLY this header. http.ts's cache-header
        // allowlist drops x-api-key from any persisted envelope (T-06-03-01).
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ document: text }),
    });

    if (resp.status !== 200) return null; // non-200 (incl. 429) → skip, no fabrication.

    await appendCost({
      ts: new Date().toISOString(),
      scope: 'paper',
      scopeId: HONESTY_BUDGET_SCOPE_ID,
      provider: 'other',
      costUsd: HONESTY_CALL_EST_USD,
    });

    return parseGptzeroResponse(JSON.parse(resp.body));
  } catch {
    // Transport / budget / parse error → clean null skip (advisory-never-throws,
    // Pitfall 4 429 handling). The key value never enters this catch path.
    return null;
  }
}

/** The shipped GPTZero backend (DONE-04). */
const gptzeroBackend: HonestyBackend = {
  name: 'gptzero',
  score: scoreWithGptzero,
};

// ============================================================
//   Public: scoreHonesty (backend selection lands in Task 2)
// ============================================================

/**
 * Compute the detection-aware honesty score for `text`. Delegates to the
 * selected backend (DONE-05). Absent key / offline-no-cassette / unexpected
 * response → null (clean skip). Advisory by construction — never throws.
 *
 * NOTE: backend selection (selectBackend) is wired in Task 2; for now this
 * delegates to the GPTZero backend directly.
 */
export async function scoreHonesty(text: string): Promise<HonestyScore | null> {
  return gptzeroBackend.score(text);
}
