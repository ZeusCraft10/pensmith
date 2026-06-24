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

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch as httpFetch } from './http.js';
import { isOfflineMode, loadCassetteFile } from './http-mock.js';
import { assertBudget, appendCost } from './budget.js';
import { ask } from './prompts.js';

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
//   Locked honest-framing copy (read VERBATIM — never inlined)
// ============================================================
// This module ships at two depths: bin/lib/honesty.ts under tsx, and
// dist/bin/lib/honesty.js after build. Fixed-depth `..` × N would land in the
// wrong dir post-build (IN-03 defect class). Walk up from HERE until we find
// the directory that owns package.json, then resolve references/ relative to
// that. EXACT shape copied from bin/lib/http.ts findPkgRoot + loadWarnString.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      if (statSync(path.join(cur, 'package.json')).isFile()) return cur;
    } catch {
      // continue
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return start;
}
const PKG_ROOT = findPkgRoot(__dirname);
const FRAMING_FILE = path.join(PKG_ROOT, 'references', 'honesty-framing.md');

let framingNote: string | null = null;

/**
 * Read the '## Note' blockquote text VERBATIM from references/honesty-framing.md
 * (the locked, hash-pinned copy). Mirrors http.ts loadWarnString: scan for the
 * '## Note' heading, return the following `> ` blockquote line with the markdown
 * marker stripped. Memoized. The copy is NEVER inlined in this module — drift
 * between code and the locked file is a CI failure (repo-files.test.ts pin).
 *
 * Defensive fallback only if the references file is unreadable (should never
 * happen — references/ ships in package.json files[]). The fallback is still
 * transparency-only and carries no detection-avoidance wording.
 */
function loadFramingNote(): string {
  if (framingNote !== null) return framingNote;
  let md: string;
  try {
    md = readFileSync(FRAMING_FILE, 'utf8');
  } catch {
    framingNote =
      'Note: this score reflects prose patterns. The humanizer improves readability; it does not promise to make output undetectable.';
    return framingNote;
  }
  const lines = md.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith('## Note')) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith('> ')) {
      framingNote = line.slice(2).trim();
      return framingNote;
    }
  }
  framingNote =
    'Note: this score reflects prose patterns. The humanizer improves readability; it does not promise to make output undetectable.';
  return framingNote;
}

// ============================================================
//   GPTZero size cap (HARD-05)
// ============================================================

/**
 * Maximum bytes of paper text sent to GPTZero per call (HARD-05). Inputs
 * exceeding this cap are truncated before the POST body is constructed.
 * ~50 KB is a practical upper bound for a single API call; the truncation
 * is announced on stdout with a note (never silently discards data).
 * Exported for tests/honesty.test.ts HARD-05 seam probing.
 */
export const GPTZERO_MAX_BYTES = 50_000;

/**
 * Truncate `text` so its UTF-8 byte length does not exceed GPTZERO_MAX_BYTES.
 * Exported as `__truncateForGptzeroTest` for the HARD-05 test seam.
 */
export function __truncateForGptzeroTest(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= GPTZERO_MAX_BYTES) return text;
  // Slice by character count until the byte length fits. We over-slice slightly
  // via byte-length and then trim — safe because UTF-8 chars are at most 4 bytes.
  const buf = Buffer.from(text, 'utf8');
  return buf.slice(0, GPTZERO_MAX_BYTES).toString('utf8');
}

// ============================================================
//   GPTZero disclosure copy (HARD-05)
// ============================================================

let disclosureNote: string | null = null;

/**
 * Read the GPTZero full-text-transmission disclosure line from the
 * "## GPTZero Data Transmission Disclosure" section in references/honesty-framing.md.
 * Same verbatim-read pattern as loadFramingNote. Memoized.
 * Transparency-only — NEVER implies detection avoidance.
 */
function loadDisclosureNote(): string {
  if (disclosureNote !== null) return disclosureNote;
  let md: string;
  try {
    md = readFileSync(FRAMING_FILE, 'utf8');
  } catch {
    disclosureNote =
      'Disclosure: the honesty check sends your full paper text to GPTZero (api.gptzero.me), an external service, for AI-detection scoring. This is for your transparency only — it does NOT make your output undetectable. No data is sent without your consent.';
    return disclosureNote;
  }
  const lines = md.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith('## GPTZero Data Transmission Disclosure')) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith('> ')) {
      disclosureNote = line.slice(2).trim();
      return disclosureNote;
    }
    // Stop scanning at next top-level heading (not the paragraph text below the blockquote)
    if (inSection && line.startsWith('## ')) break;
  }
  disclosureNote =
    'Disclosure: the honesty check sends your full paper text to GPTZero (api.gptzero.me), an external service, for AI-detection scoring. This is for your transparency only — it does NOT make your output undetectable. No data is sent without your consent.';
  return disclosureNote;
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

/** Options for scoreWithGptzero (HARD-05 consent seam). */
export interface GptzeroScoringOptions {
  /** When true, skip the consent gate (approval-gates design: --yolo skips). */
  yolo?: boolean;
  /**
   * Injected consent decision (for tests). When provided, the ask() gate is
   * bypassed and this value is used directly. undefined → run the gate normally.
   */
  consentGranted?: boolean;
}

/**
 * Score `text` against GPTZero. Behavior:
 *   - GPTZERO_API_KEY absent → null (skip-clean banner; key never logged).
 *   - Disclosure (HARD-05) — always shown before any POST attempt.
 *   - Consent gate (HARD-05) — ask() before POST; declined → null, no POST.
 *     --yolo (opts.yolo) skips the gate (disclosure still shown).
 *     non-TTY and not-yolo → SILENT decline (null) — honesty is advisory,
 *     NEVER exit-3/block (Pitfall 6 / RESEARCH A4).
 *     opts.consentGranted bypasses ask() for test injection.
 *   - Size cap (HARD-05) — input truncated to GPTZERO_MAX_BYTES with a note.
 *   - offline (PENSMITH_NETWORK_TESTS !== '1') → read the gptzero cassette and
 *     parse it defensively; no network call is made.
 *   - live → assertBudget BEFORE the call (paper-scoped cap), then httpFetch
 *     POST with the x-api-key header through the http.ts chokepoint; status
 *     !== 200 → null; parse defensively; appendCost AFTER a successful call.
 *
 * NEVER throws and NEVER logs the resolved key value (presence-check only).
 */
async function scoreWithGptzero(
  text: string,
  opts?: GptzeroScoringOptions,
): Promise<HonestyScore | null> {
  // Key-absence guard FIRST. Presence-check only — the value is never printed.
  const apiKey = process.env['GPTZERO_API_KEY'];
  if (!apiKey) {
    process.stdout.write('pensmith: GPTZero API key not set — honesty score skipped.\n');
    return null;
  }

  // HARD-05 Step 2a: Explicit test-injection decline. When consentGranted is
  // explicitly false (injected by tests), return null immediately — no offline
  // branch, no POST, no disclosure printed (decline takes priority over display).
  if (opts?.consentGranted === false) {
    return null;
  }

  // Offline branch MUST NOT touch the network (no disclosure/consent needed —
  // cassette replay involves zero data egress to any external service).
  if (isOfflineMode()) {
    return parseGptzeroResponse(offlineGptzeroResponse());
  }

  // Live branch only beyond this point (PENSMITH_NETWORK_TESTS=1).

  // HARD-05 Step 1: Disclosure — always shown before a live POST attempt,
  // even if the user later declines. Copy is read VERBATIM from the locked
  // references/honesty-framing.md (never inlined — loadDisclosureNote).
  process.stdout.write(`pensmith: ${loadDisclosureNote()}\n`);

  // HARD-05 Step 2: Consent gate — before any live POST.
  const isYolo = opts?.yolo === true;
  if (!isYolo) {
    let consented: boolean;
    if (opts?.consentGranted === true) {
      // Explicit test injection of consent=true: bypass ask().
      consented = true;
    } else if (!process.stdout.isTTY) {
      // Non-TTY (CI/piped): silently decline — honesty is advisory and must
      // NEVER break automated export (Pitfall 6 / RESEARCH A4 / open-Q2).
      return null;
    } else {
      // TTY: show the interactive consent gate (approval-gates default-on).
      const answer = await ask({
        id: 'honesty-gptzero-consent',
        kind: 'confirm',
        label: 'Send paper text to GPTZero for honesty scoring?',
        default: true,
      });
      consented = answer.kind === 'confirm' ? answer.value : false;
    }
    if (!consented) {
      process.stdout.write('pensmith: GPTZero honesty scoring declined — skipped.\n');
      return null;
    }
  }

  // HARD-05 Step 3: Size cap — truncate over-cap input before POST body.
  let postText = text;
  if (Buffer.byteLength(text, 'utf8') > GPTZERO_MAX_BYTES) {
    postText = __truncateForGptzeroTest(text);
    process.stdout.write(
      `pensmith: paper text truncated to ${GPTZERO_MAX_BYTES} bytes for GPTZero scoring.\n`,
    );
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
      // IN-02: GPTZERO_URL is a hardcoded constant — not user-supplied — so the
      // SSRF DNS pre-flight is unnecessary and adds latency + a false-block risk
      // if api.gptzero.me ever resolves through a CDN with a CGNAT address.
      // untrusted:false overrides the source==='generic' default in http.ts.
      untrusted: false,
      noCache: true,
      headers: {
        // The resolved key reaches ONLY this header. http.ts's cache-header
        // allowlist drops x-api-key from any persisted envelope (T-06-03-01).
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ document: postText }),
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
  score: (text: string) => scoreWithGptzero(text),
};

// ============================================================
//   Pluggable backend selection (DONE-05)
// ============================================================

/**
 * Build a not-implemented stub backend for a configured-but-unshipped provider
 * (Originality / Sapling — 06-RESEARCH Open Question 3). score() returns null
 * with a one-line stdout banner rather than fabricating a score or throwing
 * (advisory-never-crash consistency). No network call, no key read.
 */
function notImplementedBackend(name: string): HonestyBackend {
  return {
    name,
    score: async (): Promise<HonestyScore | null> => {
      process.stdout.write(
        `pensmith: ${name} honesty backend not implemented — score skipped.\n`,
      );
      return null;
    },
  };
}

/**
 * Resolve the honesty backend from config (DONE-05). GPTZero is the default and
 * the only shipped backend; 'originality' / 'sapling' return not-implemented
 * stubs that skip cleanly; any unknown / undefined value falls back to GPTZero.
 * This is a pure selector — it reads no key and issues no network call.
 */
export function selectBackend(config?: { honestyBackend?: string }): HonestyBackend {
  switch (config?.honestyBackend) {
    case 'originality':
      return notImplementedBackend('originality');
    case 'sapling':
      return notImplementedBackend('sapling');
    case 'gptzero':
    case undefined:
    default:
      return gptzeroBackend;
  }
}

// ============================================================
//   Public: scoreHonesty
// ============================================================

/**
 * Compute the detection-aware honesty score for `text`. Resolves the backend
 * via selectBackend (DONE-05) and delegates to it. Absent key / offline-no-
 * cassette / unexpected response → null (clean skip). Advisory by construction
 * — never throws, never blocks export.
 */
export async function scoreHonesty(
  text: string,
  config?: { honestyBackend?: string },
): Promise<HonestyScore | null> {
  return selectBackend(config).score(text);
}

/**
 * Score `text` with explicit HARD-05 consent/yolo options (test seam + caller
 * override). Delegates to scoreWithGptzero directly (GPTZero is the only
 * backend with a consent gate; other backends are advisory stubs with no egress).
 * opts.consentGranted bypasses ask() for test injection; opts.yolo skips the
 * consent gate entirely (disclosure still shown). Non-TTY + not-yolo → null.
 */
export async function scoreHonestyWithOptions(
  text: string,
  opts?: GptzeroScoringOptions,
): Promise<HonestyScore | null> {
  return scoreWithGptzero(text, opts);
}

// ============================================================
//   Public: renderHonestyReport (before/after; verbatim framing note)
// ============================================================

/**
 * Render the before/after honesty report. The before/after percentages come
 * from two scoreHonesty calls (done.ts calls scoreHonesty twice per paper —
 * pre- and post-humanize). `after === null` renders the 'N/A (humanizer not
 * installed)' variant. The trailing note is read VERBATIM from the locked
 * references/honesty-framing.md — it is NEVER an inlined literal, so any drift
 * in the locked copy is caught by the repo-files.test.ts hash pin and the
 * verbatim-render assertion in tests/honesty.test.ts.
 *
 * Transparency-only by construction: the rendered prose states what the score
 * means and that the humanizer improves readability; it carries zero
 * detection-avoidance wording (PROJECT.md non-negotiable).
 */
export function renderHonestyReport(
  before: number,
  after: number | null,
  backend: string,
): string {
  const beforePct = Math.round(before * 100);
  const afterLine =
    after === null
      ? `Pensmith honesty check (after humanize):  N/A (humanizer not installed).`
      : `Pensmith honesty check (after humanize):  reads as ${Math.round(after * 100)}% AI-generated (${backend}).`;
  const lines = [
    `Pensmith honesty check (before humanize): reads as ${beforePct}% AI-generated (${backend}).`,
    afterLine,
    '',
    loadFramingNote(),
  ];
  return lines.join('\n');
}
