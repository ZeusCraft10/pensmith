// bin/lib/honesty.ts — DONE-04 detection-aware honesty score + DONE-05 pluggable backend.
//
// All HTTP through bin/lib/http.ts — ESLint chokepoint enforced. Honest-framing
// copy read VERBATIM from references/honesty-framing.md (locked, hash-pinned) —
// NEVER inlined in code. GPTZERO_API_KEY value never logged (T-01-07 presence-
// check only). The detection-aware honesty score (DONE-04) is transparency-only
// — it is NEVER an undetectability claim (PROJECT.md non-negotiable).
//
// The paper text goes to GPTZero only with GPTZERO_API_KEY set and the user's
// consent, decided once per run (decideGptzeroConsent) and kept for the paper
// in .paper/config.toml; the question defaults to no, and --yolo never
// consents. The report names why there is no score (renderHonestySkipped).
//
// The module mirrors bin/lib/plagiarism.ts + bin/lib/verify/pass2.ts:
//   - key-absence / offline guard → clean null skip, NEVER a crash (advisory);
//     offline prints "skipped (offline)" and never shows a number;
//   - http.ts as the SOLE network chokepoint (source 'generic', noCache true);
//   - assertBudget BEFORE the live scored API call (ARCH-10 financial boundary);
//   - defensive response parse (unexpected shape / non-200 / parse error → null,
//     never a fabricated score);
//   - the resolved key value reaches ONLY the x-api-key request header — never a
//     log payload, the cost ledger, stdout, or a return value (presence-check
//     only at the call boundary).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot, paperConfigFile } from './paths.js';
import { fetch as httpFetch } from './http.js';
import { isOfflineMode, OFFLINE_SKIP_NOTE } from './network-mode.js';
import { assertBudget, assertWithinCostCap, appendCost } from './budget.js';
import { confirmOrNo } from './prompts.js';
import { readPaperConfig } from './project-config.js';
import { setConfigValues } from './config-edit.js';

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
// references/ resolves against the install root (paths.ts packageRoot).
const PKG_ROOT = packageRoot();
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

/** Options for scoreWithGptzero: the consent decision, and whether the disclosure was shown. */
export interface GptzeroScoringOptions {
  /**
   * The user's consent, decided once per run (decideGptzeroConsent). Only
   * true sends anything; false or undefined sends nothing. Nothing in here
   * asks: done decides consent before either score.
   */
  consentGranted?: boolean;
  /**
   * True once the disclosure was shown this run: before the consent
   * question, or before an earlier score. The score sets it after showing
   * it, so the scores before and after humanizing show it once between them.
   */
  disclosed?: boolean;
}

/** Why no score was produced: every reason the report can name. */
export const HONESTY_SKIPS = ['no-key', 'no-score', 'offline', 'no-consent', 'declined', 'backend-error'] as const;
export type HonestySkip = (typeof HONESTY_SKIPS)[number];

/** The consent decision for one run of done. */
export interface GptzeroConsent {
  consent: boolean;
  /** Why the paper is not sent, when it is not. */
  skip?: HonestySkip;
  /** True when the disclosure was shown with the consent question. */
  disclosed?: boolean;
}

/** The [honesty] table of .paper/config.toml, where the one-time answer is kept. */
const CONSENT_TABLE = 'honesty';
const CONSENT_KEY = 'gptzero_consent';

/** The answer kept for this paper: true, false, or undefined when never given. */
export function readGptzeroConsent(paperRoot: string): boolean | undefined {
  const value = readPaperConfig(paperRoot, CONSENT_TABLE)[CONSENT_KEY];
  return typeof value === 'boolean' ? value : undefined;
}

async function keepGptzeroConsent(paperRoot: string, consent: boolean): Promise<void> {
  const why = await setConfigValues(paperConfigFile(paperRoot), CONSENT_TABLE, { [CONSENT_KEY]: consent });
  if (why) process.stderr.write(`pensmith: WARN — your GPTZero answer could not be kept in .paper/config.toml (${why}); it applies to this run only.\n`);
}

/**
 * Decide, once per run, whether the paper text may go to GPTZero. It goes
 * only with GPTZERO_API_KEY set and the user's consent, which is asked once
 * per paper and kept (.paper/config.toml [honesty] gptzero_consent):
 *   - `--no-score` skips the score this run; offline nothing can be sent;
 *   - `--score` is the user's consent, kept for the paper;
 *   - a kept answer is used as it is;
 *   - otherwise, at a terminal the disclosure is shown and the question asked
 *     with "no" as the default, and the answer kept; with no terminal nothing
 *     is sent and the user is told how to consent.
 * --yolo never consents: it skips approval gates, and this is the user's
 * data going to a third party.
 */
export async function decideGptzeroConsent(
  paperRoot: string,
  opts: { score?: boolean; terminal: boolean },
): Promise<GptzeroConsent> {
  if (!process.env['GPTZERO_API_KEY']) return { consent: false, skip: 'no-key' };
  if (opts.score === false) return { consent: false, skip: 'no-score' };
  if (isOfflineMode()) return { consent: false, skip: 'offline' };
  if (opts.score === true) {
    await keepGptzeroConsent(paperRoot, true);
    return { consent: true };
  }
  const kept = readGptzeroConsent(paperRoot);
  if (kept !== undefined) return kept ? { consent: true } : { consent: false, skip: 'declined' };
  if (!opts.terminal) {
    process.stdout.write(
      'pensmith: GPTZero honesty score skipped: it needs your consent to send the paper text to GPTZero, and nothing was sent. ' +
        'To allow it for this paper, run `pensmith done --score`.\n',
    );
    return { consent: false, skip: 'no-consent' };
  }
  process.stdout.write(`pensmith: ${loadDisclosureNote()}\n`);
  const consent = await confirmOrNo({
    id: 'honesty-gptzero-consent',
    kind: 'confirm',
    label: 'Send paper text to GPTZero for honesty scoring?',
    default: false,
  });
  await keepGptzeroConsent(paperRoot, consent);
  if (!consent) process.stdout.write('pensmith: GPTZero honesty scoring declined — nothing was sent, and you will not be asked again for this paper.\n');
  return consent ? { consent: true, disclosed: true } : { consent: false, skip: 'declined', disclosed: true };
}

/**
 * Score `text` against GPTZero. Behavior:
 *   - GPTZERO_API_KEY absent → null (key never logged).
 *   - consent not granted (opts.consentGranted !== true) → null, no request:
 *     the caller decides consent once per run (decideGptzeroConsent), and
 *     nothing here asks or treats silence as a yes.
 *   - offline (--offline / --dry-run) → "skipped (offline)" and null; no
 *     request, never a canned score.
 *   - the disclosure is shown before the first POST of the run, unless the
 *     consent question already showed it;
 *   - input over GPTZERO_MAX_BYTES is truncated, with a note.
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
  if (!apiKey) return null;

  // Only the user's consent sends anything.
  if (opts?.consentGranted !== true) return null;

  // Offline: nothing is sent, so there is nothing to disclose, and no score to show.
  if (isOfflineMode()) {
    process.stdout.write(`pensmith: GPTZero honesty score ${OFFLINE_SKIP_NOTE}.\n`);
    return null;
  }

  // The disclosure, before the first POST of the run (unless the consent
  // question showed it). The copy is read verbatim from the pinned
  // references/honesty-framing.md, never inlined.
  if (opts.disclosed !== true) {
    process.stdout.write(`pensmith: ${loadDisclosureNote()}\n`);
    opts.disclosed = true;
  }

  // Size cap: over-cap input is truncated before the POST.
  let postText = text;
  if (Buffer.byteLength(text, 'utf8') > GPTZERO_MAX_BYTES) {
    postText = __truncateForGptzeroTest(text);
    process.stdout.write(
      `pensmith: paper text truncated to ${GPTZERO_MAX_BYTES} bytes for GPTZero scoring.\n`,
    );
  }

  try {
    // ARCH-10 pre-call gate: assertBudget BEFORE the scored API call. A
    // BudgetExceededError here aborts the call (financial-safety boundary) and
    // is swallowed to a clean null skip below (advisory must never crash export).
    await assertBudget(
      { scope: 'paper', scopeId: HONESTY_BUDGET_SCOPE_ID, cap: HONESTY_PAPER_CAP_DEFAULT },
      HONESTY_CALL_EST_USD,
    );
    // The score is paid like a model call, so it counts against the paper's
    // cost cap too.
    await assertWithinCostCap(HONESTY_CALL_EST_USD);

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

/** The shipped GPTZero backend; it sends nothing without consent. */
function gptzeroBackend(opts?: GptzeroScoringOptions): HonestyBackend {
  return { name: 'gptzero', score: (text: string) => scoreWithGptzero(text, opts) };
}

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
export function selectBackend(config?: { honestyBackend?: string }, opts?: GptzeroScoringOptions): HonestyBackend {
  switch (config?.honestyBackend) {
    case 'originality':
      return notImplementedBackend('originality');
    case 'sapling':
      return notImplementedBackend('sapling');
    case 'gptzero':
    case undefined:
    default:
      return gptzeroBackend(opts);
  }
}

// ============================================================
//   Public: scoreHonesty
// ============================================================

/**
 * Compute the detection-aware honesty score for `text`. Resolves the backend
 * via selectBackend and delegates to it. Absent key / no consent /
 * offline / unexpected response → null (clean skip). Advisory by
 * construction — never throws, never blocks export.
 */
export async function scoreHonesty(
  text: string,
  config?: { honestyBackend?: string },
  opts?: GptzeroScoringOptions,
): Promise<HonestyScore | null> {
  return selectBackend(config, opts).score(text);
}

/**
 * Score `text` with GPTZero directly, given the consent decision (test seam).
 * GPTZero is the only backend that sends anything; the others are advisory
 * stubs with no egress.
 */
export async function scoreHonestyWithOptions(
  text: string,
  opts?: GptzeroScoringOptions,
): Promise<HonestyScore | null> {
  return scoreWithGptzero(text, opts);
}

const SKIP_TEXT: Readonly<Record<HonestySkip, string>> = {
  'no-key': 'skipped (no GPTZERO_API_KEY set).',
  'no-score': 'skipped (--no-score).',
  offline: `${OFFLINE_SKIP_NOTE}.`,
  'no-consent': 'skipped: sending the paper to GPTZero needs your consent, and nothing was sent (`pensmith done --score` gives it for this paper).',
  declined: 'skipped: you declined sending the paper to GPTZero, so nothing was sent (`pensmith done --score` allows it).',
  'backend-error': 'skipped: GPTZero gave no usable answer (an error, a limit, or a response pensmith could not read). No score is shown.',
};

/** The report line when no score was produced, naming why. */
export function renderHonestySkipped(reason: HonestySkip = isOfflineMode() ? 'offline' : 'backend-error'): string {
  return `Pensmith honesty check: ${SKIP_TEXT[reason]}`;
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
