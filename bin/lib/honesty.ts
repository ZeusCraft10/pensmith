// bin/lib/honesty.ts — the detection-aware honesty score (DONE-04/05; Phase 21
// EXP-16, EXP-17, EXP-18; D-21-20, D-21-21).
//
// done shows how an AI detector reads the paper, before and after the
// humanizer, for TRANSPARENCY ONLY: a score is real (a detector answered, with
// its backend and an ISO timestamp) or clearly absent with one exact reason —
// never a replayed or invented number. The framing and every backend's
// disclosure are read VERBATIM from the hash-pinned references/honesty-framing.md;
// nothing here ever claims output is undetectable (PRD §14).
//
// The checks, in order (the first that applies is the reason):
//   --no-score                         → skipped (--no-score)
//   [humanizer] honesty_score = false  → skipped (config: honesty_score = false)
//   --dry-run                          → unavailable (dry-run)
//   no key for the backend             → skipped (no <KEY> set)
//   sources offline                    → unavailable (offline)
//   consent (EXP-17, S-14)             → config.toml's `[humanizer]
//     honesty_consent = false` is an opt-out a paper may carry: skipped
//     (consent declined in config.toml). Consent itself is the USER's, never
//     a paper file's (config.toml travels with a shared paper; review round
//     1): the answer recorded in the pensmith data dir for this paper and
//     this detector (detector-consent.ts) — no → skipped (consent declined),
//     yes → sent; none → asked once in a terminal through the backend-neutral
//     `detector-consent` gate and recorded there; without a terminal →
//     skipped (no consent recorded — …). `honesty_consent = true` in
//     config.toml grants nothing. --yolo never answers it.
//   an invalid config.toml            → skipped (the config error): nothing is
//     sent on a config this build cannot read (done refuses it first).
//   the request                        → a 401/403 is `unavailable (<Backend>
//     rejected the API key)`, a 429 `unavailable (rate limited)`, a transport
//     error `unavailable (network: …)`, an answer that does not parse
//     `unavailable (<Backend> returned an unexpected response)`.
// Every scoring run prints the backend's disclosure line before anything is sent.
//
// Backends (EXP-18), each behind the same consent gate, budget gate and its
// own size cap, all through the http.ts egress gate (no environment variable
// or config key can point a detector at another host):
//   - GPTZero: POST https://api.gptzero.me/v2/predict/text, header `x-api-key`,
//     body `{document}`; score `documents[0].class_probabilities.ai`.
//   - Originality.ai (docs.originality.ai/scan.md, API v3, fetched
//     2026-10-01): POST https://api.originality.ai/api/v3/scan, header
//     `X-OAI-API-KEY`, body `{title, check_ai: true, check_plagiarism: false,
//     check_facts: false, check_readability: false, check_grammar: false,
//     check_contentQuality: false, storeScan: false, aiModelVersion: "lite",
//     content}`; score `results.ai.confidence.AI`.
//   - Sapling (sapling.ai/docs/api/detector, fetched 2026-10-01): POST
//     https://api.sapling.ai/api/v1/aidetect, header `Authorization: Bearer
//     <key>` (the API accepts the key in the body or as a bearer token; the
//     header keeps it out of every body the --show-prompts mirror prints),
//     body `{text, sent_scores: false}`; score `score` (0–1).
// A key reaches ONLY its request header: never a log, the cost ledger, the
// mirror (http.ts never prints headers), a cassette (the cache-header allowlist
// drops it) or a return value.

import { readFileSync } from 'node:fs';
import { pluginReferencePath } from './paths.js';
import { fetch as httpFetch, RateLimitExhaustedError } from './http.js';
import { networkMode } from './http-mock.js';
import { out } from './output-sink.js';
import { assertBudget, appendCost } from './budget.js';
import { runGate, canPrompt } from './gates.js';
import { readPaperConfigSync, type PaperConfig } from './config.js';
import { HONESTY_BACKENDS } from './schemas/config.js';
import { recordDetectorConsent, recordedDetectorConsent } from './detector-consent.js';

// ============================================================
//   Public types
// ============================================================

export type HonestyClassification = 'HUMAN_ONLY' | 'MIXED' | 'AI_ONLY';

/** The parsed detection-aware score. `aiProbability` is 0..1; `backend` names the detector. Shown as-is with no trust claim. */
export interface HonestyScore {
  aiProbability: number;
  classification: HonestyClassification;
  backend: string;
}

export type HonestyBackendName = (typeof HONESTY_BACKENDS)[number];

/** A score with when it was taken, or why there is none (EXP-16). */
export type HonestyOutcome =
  | { readonly kind: 'score'; readonly score: HonestyScore; readonly at: string }
  | { readonly kind: 'skipped' | 'unavailable'; readonly reason: string; readonly backend: HonestyBackendName };

/** The after-humanize line when no second score is taken: `N/A (<why>)`. */
export interface HonestyNotApplicable {
  readonly kind: 'na';
  readonly reason: string;
}

export interface HonestyOptions {
  /** The paper root (config.toml: backend, honesty_score, the honesty_consent opt-out; the key of the consent recorded in the data dir). */
  readonly paperRoot?: string;
  /** Override the configured backend. */
  readonly backend?: HonestyBackendName;
  /** --yolo for this invocation (forwarded to the gate, which --yolo never skips). */
  readonly yolo?: boolean;
  /** done --no-score. */
  readonly noScore?: boolean;
  /**
   * An explicit consent decision for this call (a test seam; the Tier-1 tool
   * after AskUserQuestion, which records the answer with
   * detector-consent.ts recordDetectorConsent): true sends, false declines;
   * undefined → the answer recorded in the data dir, else the gate. A paper's
   * `honesty_consent = false` opt-out still applies.
   */
  readonly consentGranted?: boolean;
}

// ============================================================
//   Backends
// ============================================================

interface BackendSpec {
  readonly name: HonestyBackendName;
  /** How the terminal names it. */
  readonly label: string;
  readonly keyEnv: string;
  readonly url: string;
  /** The `## <heading>` of its disclosure in references/honesty-framing.md. */
  readonly disclosureHeading: string;
  /** The most text one request sends (UTF-8 bytes). */
  readonly maxBytes: number;
  readonly estimateUsd: number;
  request(text: string, key: string): { headers: Record<string, string>; body: string };
  parse(raw: unknown): { ai: number; classification?: HonestyClassification } | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function probability(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

/** Maximum bytes of paper text sent to GPTZero per call (HARD-05). */
export const GPTZERO_MAX_BYTES = 50_000;

const BACKENDS: Readonly<Record<HonestyBackendName, BackendSpec>> = Object.freeze({
  gptzero: {
    name: 'gptzero',
    label: 'GPTZero',
    keyEnv: 'GPTZERO_API_KEY',
    url: 'https://api.gptzero.me/v2/predict/text',
    disclosureHeading: '## GPTZero Data Transmission Disclosure',
    maxBytes: GPTZERO_MAX_BYTES,
    estimateUsd: 0.02,
    request: (text, key) => ({ headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ document: text }) }),
    parse: (raw) => {
      if (!isRecord(raw) || !Array.isArray(raw['documents']) || raw['documents'].length === 0) return null;
      const first = raw['documents'][0];
      if (!isRecord(first) || !isRecord(first['class_probabilities'])) return null;
      const ai = probability(first['class_probabilities']['ai']);
      if (ai === null) return null;
      const c = first['document_classification'];
      return { ai, ...(c === 'HUMAN_ONLY' || c === 'MIXED' || c === 'AI_ONLY' ? { classification: c } : {}) };
    },
  },
  originality: {
    name: 'originality',
    label: 'Originality.ai',
    keyEnv: 'ORIGINALITY_API_KEY',
    url: 'https://api.originality.ai/api/v3/scan',
    disclosureHeading: '## Originality.ai Data Transmission Disclosure',
    maxBytes: 50_000,
    estimateUsd: 0.02,
    request: (text, key) => ({
      headers: { 'X-OAI-API-KEY': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Paper',
        check_ai: true,
        check_plagiarism: false,
        check_facts: false,
        check_readability: false,
        check_grammar: false,
        check_contentQuality: false,
        storeScan: false,
        aiModelVersion: 'lite',
        content: text,
      }),
    }),
    parse: (raw) => {
      if (!isRecord(raw) || !isRecord(raw['results']) || !isRecord(raw['results']['ai']) || !isRecord(raw['results']['ai']['confidence'])) return null;
      const ai = probability(raw['results']['ai']['confidence']['AI']);
      return ai === null ? null : { ai };
    },
  },
  sapling: {
    name: 'sapling',
    label: 'Sapling',
    keyEnv: 'SAPLING_API_KEY',
    url: 'https://api.sapling.ai/api/v1/aidetect',
    disclosureHeading: '## Sapling Data Transmission Disclosure',
    // Sapling accepts up to 200,000 characters a request (its documented limit).
    maxBytes: 200_000,
    estimateUsd: 0.02,
    request: (text, key) => ({ headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ text, sent_scores: false }) }),
    parse: (raw) => {
      if (!isRecord(raw)) return null;
      const ai = probability(raw['score']);
      return ai === null ? null : { ai };
    },
  },
});

/** The backend's display name (`GPTZero`, `Originality.ai`, `Sapling`). */
export function backendLabel(name: HonestyBackendName): string {
  return BACKENDS[name].label;
}

/** The key variable each backend reads (doctor reports their presence only). */
export const DETECTOR_KEY_VARS: Readonly<Record<HonestyBackendName, string>> = Object.freeze({
  gptzero: BACKENDS.gptzero.keyEnv,
  originality: BACKENDS.originality.keyEnv,
  sapling: BACKENDS.sapling.keyEnv,
});

function classify(ai: number): HonestyClassification {
  if (ai >= 0.8) return 'AI_ONLY';
  if (ai <= 0.2) return 'HUMAN_ONLY';
  return 'MIXED';
}

// ============================================================
//   Locked framing copy (read VERBATIM — never inlined)
// ============================================================

const framingFile = (): string => pluginReferencePath('honesty-framing.md');

const FRAMING_FALLBACK =
  'Note: this score reflects prose patterns. The humanizer improves readability; it does not promise to make output undetectable.';

/** The first `> ` line under `heading` in references/honesty-framing.md, or null. */
function framingLine(heading: string): string | null {
  let md: string;
  try {
    md = readFileSync(framingFile(), 'utf8');
  } catch {
    return null;
  }
  let inSection = false;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      if (inSection) return null;
      inSection = line.trim() === heading;
      continue;
    }
    if (inSection && line.startsWith('> ')) return line.slice(2).trim();
  }
  return null;
}

/** The locked `## Note` line (transparency-only). */
export function honestyFramingNote(): string {
  return framingLine('## Note') ?? FRAMING_FALLBACK;
}

/** The backend's locked data-transmission disclosure line (printed before anything is sent). */
export function disclosureLine(name: HonestyBackendName): string {
  const spec = BACKENDS[name];
  return (
    framingLine(spec.disclosureHeading) ??
    `Disclosure: the honesty check sends your full paper text to ${spec.label} (${new URL(spec.url).host}), an external service, for AI-detection scoring. This is for your transparency only. No data is sent without your consent.`
  );
}

// ============================================================
//   Size cap
// ============================================================

/** Truncate `text` to at most `maxBytes` UTF-8 bytes (never splitting a character). */
function truncateBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const s = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  return s.replace(/�$/, '');
}

/** HARD-05 test seam: the GPTZero truncation. */
export function __truncateForGptzeroTest(text: string): string {
  return truncateBytes(text, GPTZERO_MAX_BYTES);
}

// ============================================================
//   Consent (EXP-17)
// ============================================================

/** The reason a run without a terminal and without a recorded answer sends nothing. */
export const NO_CONSENT_REASON = 'no consent recorded — run pensmith score (or pensmith done) once in a terminal and answer the detector question';

/** The same, when the paper's config.toml claims consent (a paper file cannot give it). */
export const CONFIG_CONSENT_REASON =
  "no consent recorded — config.toml's honesty_consent = true is not your consent (a paper file cannot give it); run pensmith score (or pensmith done) once in a terminal and answer the detector question";

/**
 * Whether the paper may be sent to the detector now (see the header): the
 * paper's opt-out, then the user's answer recorded in the data dir for this
 * paper and detector, else the `detector-consent` gate in a terminal (the
 * answer recorded there), else no. Returns null when it may, or the skip
 * reason. --yolo never answers.
 */
async function consentReason(spec: BackendSpec, opts: HonestyOptions, configConsent: boolean | undefined): Promise<string | null> {
  if (configConsent === false) return 'consent declined in config.toml';
  if (opts.consentGranted === true) return null;
  if (opts.consentGranted === false) return 'consent declined';
  const recorded = opts.paperRoot !== undefined ? recordedDetectorConsent(opts.paperRoot, spec.name) : undefined;
  if (recorded === true) return null;
  if (recorded === false) return 'consent declined — your recorded answer';
  const none = configConsent === true ? CONFIG_CONSENT_REASON : NO_CONSENT_REASON;
  if (!canPrompt()) return none;
  let yes: boolean;
  try {
    const outcome = await runGate('detector-consent', {
      yolo: opts.yolo === true,
      question: {
        id: 'detector-consent',
        kind: 'confirm',
        label: `Send the full paper text to ${spec.label} for an AI-detection score? (your answer is saved for this paper on this computer)`,
        default: false,
      },
    });
    if (outcome.kind !== 'answered') return none;
    yes = outcome.answer.kind === 'confirm' && outcome.answer.value === true;
  } catch {
    return none;
  }
  if (opts.paperRoot !== undefined) {
    try {
      await recordDetectorConsent(opts.paperRoot, spec.name, yes);
      out(`pensmith: recorded your answer for this paper and ${spec.label} (${yes ? 'yes' : 'no'}) in pensmith's data folder, not in the paper.\n`);
    } catch (e) {
      process.stderr.write(`pensmith: WARN — your detector-consent answer could not be recorded (${(e as Error).message.split('\n')[0] ?? ''}); it applies to this run only\n`);
    }
  }
  return yes ? null : 'consent declined';
}

// ============================================================
//   Scoring
// ============================================================

/**
 * The paper's config.toml, read strictly: the config (absent → null), or the
 * one-line error of a file this build cannot read. Never throws.
 */
function paperConfigOrError(paperRoot: string | undefined): { config: PaperConfig | null; error: string | null } {
  if (paperRoot === undefined) return { config: null, error: null };
  try {
    const r = readPaperConfigSync(paperRoot);
    return { config: r.exists ? r.config : null, error: null };
  } catch (e) {
    return { config: null, error: ((e as Error).message.split('\n')[0] ?? 'config.toml cannot be read').replace(/^pensmith:\s*/, '') };
  }
}

/**
 * The backend this paper uses: the option, else `[humanizer] honesty_backend`,
 * else GPTZero. A config.toml this build cannot read is never "GPTZero by
 * default" for sending: measureHonesty refuses it (review round 1).
 */
export function configuredBackend(opts: HonestyOptions = {}): HonestyBackendName {
  if (opts.backend !== undefined) return opts.backend;
  return paperConfigOrError(opts.paperRoot).config?.humanizer?.honesty_backend ?? 'gptzero';
}

/**
 * Score `text` with the paper's detector (see the header): a score with its
 * ISO timestamp, or the exact reason there is none. Never throws (except a
 * budget or cost-cap refusal is reported as unavailable, never thrown — the
 * score is advisory); never invents or replays a score.
 */
export async function measureHonesty(text: string, opts: HonestyOptions = {}): Promise<HonestyOutcome> {
  const read = paperConfigOrError(opts.paperRoot);
  const config = read.config;
  const name = opts.backend ?? config?.humanizer?.honesty_backend ?? 'gptzero';
  const spec = BACKENDS[name];
  const none = (kind: 'skipped' | 'unavailable', reason: string): HonestyOutcome => ({ kind, reason, backend: name });
  if (opts.noScore === true) return none('skipped', '--no-score');
  // A config this build cannot read sends nothing (its honesty_backend or
  // honesty_score may be the reason); done refuses such a file before this.
  if (read.error !== null) return none('skipped', read.error);
  if (config?.humanizer?.honesty_score === false) return none('skipped', 'config: honesty_score = false');
  const mode = networkMode();
  if (mode.dryRun) return none('unavailable', 'dry-run');
  const key = process.env[spec.keyEnv];
  if (key === undefined || key.length === 0) return none('skipped', `no ${spec.keyEnv} set`);
  if (mode.sourcesOffline) return none('unavailable', 'offline');

  // Every scoring run says what leaves the machine before anything does.
  out(`pensmith: ${disclosureLine(name)}\n`);
  const consent = await consentReason(spec, opts, config?.humanizer?.honesty_consent);
  if (consent !== null) return none('skipped', consent);

  let body = text;
  if (Buffer.byteLength(text, 'utf8') > spec.maxBytes) {
    body = truncateBytes(text, spec.maxBytes);
    out(`pensmith: paper text truncated to ${spec.maxBytes} bytes for ${spec.label} scoring.\n`);
  }
  const scope = { scope: 'paper' as const, scopeId: `honesty-${name}`, cap: 1.0 };
  try {
    await assertBudget(scope, spec.estimateUsd);
  } catch (e) {
    return none('unavailable', `budget: ${(e as Error).message.split('\n')[0] ?? ''}`);
  }
  const req = spec.request(body, key);
  let resp: { status: number; body: string };
  try {
    resp = await httpFetch(spec.url, { method: 'POST', source: 'generic', noCache: true, headers: req.headers, body: req.body });
  } catch (e) {
    // http.ts retries a 429 / 5xx and then throws with the last status.
    const status = (e as { status?: unknown }).status;
    if (e instanceof RateLimitExhaustedError || status === 429) return none('unavailable', 'rate limited');
    if (typeof status === 'number') return none('unavailable', `${spec.label} answered HTTP ${status}`);
    const msg = ((e as Error).message.split('\n')[0] ?? '').replace(key, '***');
    return none('unavailable', `network: ${msg}`);
  }
  if (resp.status === 401 || resp.status === 403) return none('unavailable', `${spec.label} rejected the API key`);
  if (resp.status === 429) return none('unavailable', 'rate limited');
  if (resp.status !== 200) return none('unavailable', `${spec.label} answered HTTP ${resp.status}`);
  let parsed: ReturnType<BackendSpec['parse']>;
  try {
    parsed = spec.parse(JSON.parse(resp.body) as unknown);
  } catch {
    parsed = null;
  }
  if (parsed === null) return none('unavailable', `${spec.label} returned an unexpected response`);
  const at = new Date().toISOString();
  try {
    await appendCost({ ts: at, scope: 'paper', scopeId: scope.scopeId, provider: 'other', costUsd: spec.estimateUsd }, opts.paperRoot);
  } catch {
    // the ledger is best-effort for this advisory call
  }
  return { kind: 'score', score: { aiProbability: parsed.ai, classification: parsed.classification ?? classify(parsed.ai), backend: name }, at };
}

/** `61% AI-generated (gptzero, 2026-…Z)`, `skipped (--no-score)`, `unavailable (offline)`, `N/A (…)`. */
export function honestyLine(o: HonestyOutcome | HonestyNotApplicable): string {
  if (o.kind === 'score') return `${Math.round(o.score.aiProbability * 100)}% AI-generated (${o.score.backend}, ${o.at})`;
  if (o.kind === 'na') return `N/A (${o.reason})`;
  return `${o.kind} (${o.reason})`;
}

/**
 * The before/after report (terminal and `.paper/VERIFICATION.md`): one line
 * each, then the locked framing note VERBATIM (transparency-only).
 */
export function renderHonestySection(before: HonestyOutcome, after: HonestyOutcome | HonestyNotApplicable): string {
  return [
    `Pensmith honesty check (before humanize): ${honestyLine(before)}`,
    `Pensmith honesty check (after humanize):  ${honestyLine(after)}`,
    '',
    honestyFramingNote(),
  ].join('\n');
}

// ============================================================
//   Compatibility surface (DONE-04/05 callers)
// ============================================================

/** One stdout line for an absent score (the pre-Phase-21 wording, kept for its callers). */
function announceAbsent(o: HonestyOutcome): void {
  if (o.kind === 'score') return;
  const label = BACKENDS[o.backend].label;
  if (o.kind === 'unavailable') out(`pensmith: ${label} honesty score unavailable (${o.reason}) — no text was sent.\n`);
  else out(`pensmith: ${label} honesty score skipped (${o.reason}).\n`);
}

/**
 * Score `text` and return the bare score, or null with one stdout line saying
 * why (the DONE-04 surface; done uses measureHonesty).
 */
export async function scoreHonestyWithOptions(text: string, opts: HonestyOptions = {}): Promise<HonestyScore | null> {
  const o = await measureHonesty(text, opts);
  if (o.kind === 'score') return o.score;
  announceAbsent(o);
  return null;
}

