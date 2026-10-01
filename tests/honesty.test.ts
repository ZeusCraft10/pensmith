// tests/honesty.test.ts — the AI-detector score (DONE-04/05; Phase 21 EXP-16,
// EXP-17, EXP-18; D-21-20, D-21-21).
//
// A score is real (a detector answered: its backend and an ISO timestamp) or
// clearly absent with one exact reason — never a replayed or invented number.
// The detectors are answered in process by the V5 MockAgent in the test lane
// (PENSMITH_NETWORK_TESTS=1 for each test's duration); no request ever leaves
// the machine and nothing reads the synthetic GPTZero cassette with a key in
// live mode (the score path sends `noCache` and never replays a fixture).
//
// Covers: before/after lines with timestamps and the verbatim framing note
// (61 % then 37 %); every absent-score reason (no key, offline, --no-score,
// honesty_score = false, a rejected key, rate limited, consent declined, no
// consent recorded); consent from config.toml (one request) and never from
// --yolo (zero requests); the Originality.ai and Sapling request shapes and
// score mappings; the GPTZero size cap; the disclosure line before anything
// is sent and the key never printed. The Phase-6 skip guards and the
// `notImplementedBackend` assertions are gone: every configured backend is a
// real adapter. The terminal consent (asked once, recorded in config.toml) is
// covered by tests/honesty-consent.test.ts (a child process with numbered prompts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCassetteFile } from '../bin/lib/http-mock.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import {
  GPTZERO_MAX_BYTES,
  NO_CONSENT_REASON,
  __truncateForGptzeroTest,
  disclosureLine,
  honestyFramingNote,
  honestyLine,
  measureHonesty,
  renderHonestySection,
  selectBackend,
  type HonestyOutcome,
} from '../bin/lib/honesty.js';
import { _resetBucketsForTest } from '../bin/lib/http.js';

const framingPath = fileURLToPath(new URL('../plugin/references/honesty-framing.md', import.meta.url));
const honestySrc = fileURLToPath(new URL('../bin/lib/honesty.ts', import.meta.url));

const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/;

/** The `## Note` blockquote of the locked framing file (what honesty.ts must render verbatim). */
function framingNote(): string {
  const md = readFileSync(framingPath, 'utf8');
  const m = /## Note\s*\n+> (.+)/.exec(md);
  assert.ok(m?.[1], 'honesty-framing.md must have a ## Note blockquote');
  return m[1].trim();
}

/** Capture process.stdout writes during `fn` (tee: the runner reports on the same stream). */
async function captureStdout<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    chunks.push(String(s));
    return orig(s);
  };
  try {
    const value = await fn();
    return { value, out: chunks.join('') };
  } finally {
    (process.stdout as unknown as { write: typeof orig }).write = orig;
  }
}

interface Captured {
  readonly host: string;
  readonly path: string;
  readonly body: string;
  readonly headers: Record<string, string>;
}

type Reply = { status: number; body: unknown };

/** A temp paper with `.paper/config.toml` holding `toml`. */
function paper(toml = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-honesty-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'config.toml'), `schema_version = 4\n${toml}`);
  return root;
}

const DETECTORS = {
  gptzero: { origin: 'https://api.gptzero.me', path: '/v2/predict/text' },
  originality: { origin: 'https://api.originality.ai', path: '/api/v3/scan' },
  sapling: { origin: 'https://api.sapling.ai', path: '/api/v1/aidetect' },
} as const;

/**
 * The live test lane with the V5 MockAgent answering every detector host:
 * `replies[backend]` gives the answers in order (the last repeats). Keys are
 * set for the test's duration (`keys`), the lane flag restored after.
 */
async function withDetectors<T>(
  replies: Partial<Record<keyof typeof DETECTORS, Reply[]>>,
  keys: Record<string, string | undefined>,
  fn: (captured: Captured[]) => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  const vars = ['PENSMITH_NETWORK_TESTS', 'PENSMITH_OFFLINE', 'GPTZERO_API_KEY', 'ORIGINALITY_API_KEY', 'SAPLING_API_KEY', 'PENSMITH_PROMPT_MODE'];
  for (const k of vars) saved[k] = process.env[k];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  for (const k of ['PENSMITH_OFFLINE', 'GPTZERO_API_KEY', 'ORIGINALITY_API_KEY', 'SAPLING_API_KEY', 'PENSMITH_PROMPT_MODE']) delete process.env[k];
  for (const [k, v] of Object.entries(keys)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetBucketsForTest();
  const { agent, restore } = installMockAgent();
  const captured: Captured[] = [];
  for (const [name, d] of Object.entries(DETECTORS) as Array<[keyof typeof DETECTORS, (typeof DETECTORS)[keyof typeof DETECTORS]]>) {
    const answers = replies[name] ?? [{ status: 500, body: { error: 'no reply scripted' } }];
    let n = 0;
    agent
      .get(d.origin)
      .intercept({ path: d.path, method: 'POST' })
      .reply((req) => {
        const raw = (req.headers ?? {}) as Record<string, string> | string[];
        const headers: Record<string, string> = {};
        if (Array.isArray(raw)) for (let i = 0; i + 1 < raw.length; i += 2) headers[String(raw[i]).toLowerCase()] = String(raw[i + 1]);
        else for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = String(v);
        captured.push({ host: new URL(d.origin).host, path: d.path, body: String(req.body ?? ''), headers });
        const r = answers[Math.min(n, answers.length - 1)] as Reply;
        n += 1;
        return { statusCode: r.status, data: JSON.stringify(r.body), responseOptions: { headers: { 'content-type': 'application/json' } } };
      })
      .persist();
  }
  try {
    return await fn(captured);
  } finally {
    await restore();
    _resetBucketsForTest();
    for (const k of vars) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const gptzero = (ai: number): Reply => ({
  status: 200,
  body: { documents: [{ class_probabilities: { ai, human: 1 - ai, mixed: 0 }, document_classification: ai >= 0.8 ? 'AI_ONLY' : ai <= 0.2 ? 'HUMAN_ONLY' : 'MIXED' }] },
});

test('honesty: the synthetic GPTZero cassette is still the documented response shape (DONE-04)', () => {
  const cs = loadCassetteFile('gptzero', 'predict-text');
  assert.ok(Array.isArray(cs) && cs.length >= 1, 'gptzero/predict-text.json must be a non-empty Cassette[]');
  const resp = cs[0]?.response as { documents: Array<{ class_probabilities: { ai: number } }> };
  assert.equal(typeof resp.documents[0]?.class_probabilities.ai, 'number');
});

test('EXP-16: GPTZero 0.61 before and 0.37 after → "61% … (gptzero, <ISO>)" and "37% …", then the framing note verbatim', async () => {
  const root = paper('[humanizer]\nhonesty_consent = true\n');
  await withDetectors({ gptzero: [gptzero(0.61), gptzero(0.37)] }, { GPTZERO_API_KEY: 'test-key-gptzero-1' }, async (captured) => {
    const { value: before, out } = await captureStdout(() => measureHonesty('The draft as compiled.', { paperRoot: root }));
    const { value: after } = await captureStdout(() => measureHonesty('The draft as improved.', { paperRoot: root, consentGranted: true }));
    assert.equal(before.kind, 'score');
    assert.equal(after.kind, 'score');
    const report = renderHonestySection(before, after);
    assert.match(report, new RegExp(`^Pensmith honesty check \\(before humanize\\): 61% AI-generated \\(gptzero, ${ISO.source}\\)$`, 'm'));
    assert.match(report, new RegExp(`^Pensmith honesty check \\(after humanize\\):  37% AI-generated \\(gptzero, ${ISO.source}\\)$`, 'm'));
    assert.ok(report.endsWith(framingNote()), 'the locked framing note, verbatim, closes the report');
    assert.equal(honestyFramingNote(), framingNote());
    assert.equal(captured.length, 2, 'one request per score');
    assert.deepEqual(JSON.parse(captured[0]!.body), { document: 'The draft as compiled.' });
    assert.equal(captured[0]!.headers['x-api-key'], 'test-key-gptzero-1', 'the key reaches only its header');
    assert.ok(out.includes(disclosureLine('gptzero')), 'the disclosure line is printed before the text is sent');
    assert.ok(!out.includes('test-key-gptzero-1'), 'the key is never printed');
    assert.ok(!captured[0]!.body.includes('test-key-gptzero-1'), 'the key is never in the body');
  });
});

test('EXP-16: no key → skipped (no GPTZERO_API_KEY set); offline → unavailable (offline) — never a bare percentage, nothing sent', async () => {
  const root = paper('[humanizer]\nhonesty_consent = true\n');
  await withDetectors({ gptzero: [gptzero(0.9)] }, {}, async (captured) => {
    const o = await measureHonesty('text', { paperRoot: root });
    assert.equal(honestyLine(o), 'skipped (no GPTZERO_API_KEY set)');
    assert.equal(captured.length, 0);
  });
  await withDetectors({ gptzero: [gptzero(0.9)] }, { GPTZERO_API_KEY: 'test-key-offline', PENSMITH_OFFLINE: '1' }, async (captured) => {
    const { value: o, out } = await captureStdout(() => measureHonesty('text', { paperRoot: root }));
    assert.equal(honestyLine(o), 'unavailable (offline)');
    assert.doesNotMatch(renderHonestySection(o, { kind: 'na', reason: 'humanize skipped with --raw' }), /\d+%/, 'never a bare percentage offline');
    assert.equal(captured.length, 0, 'nothing reached the detector');
    assert.ok(!out.includes('test-key-offline'));
  });
});

test('EXP-16: --no-score and honesty_score = false send nothing and say so', async () => {
  await withDetectors({ gptzero: [gptzero(0.5)] }, { GPTZERO_API_KEY: 'test-key-noscore' }, async (captured) => {
    const consented = paper('[humanizer]\nhonesty_consent = true\n');
    assert.equal(honestyLine(await measureHonesty('text', { paperRoot: consented, noScore: true })), 'skipped (--no-score)');
    const off = paper('[humanizer]\nhonesty_score = false\nhonesty_consent = true\n');
    assert.equal(honestyLine(await measureHonesty('text', { paperRoot: off })), 'skipped (config: honesty_score = false)');
    assert.equal(captured.length, 0, 'zero detector requests');
  });
});

test('EXP-16: a 401 → unavailable (GPTZero rejected the API key); a 429 → unavailable (rate limited)', async () => {
  const root = paper('[humanizer]\nhonesty_consent = true\n');
  await withDetectors({ gptzero: [{ status: 401, body: { error: 'bad key' } }] }, { GPTZERO_API_KEY: 'test-key-rejected' }, async () => {
    assert.equal(honestyLine(await measureHonesty('text', { paperRoot: root })), 'unavailable (GPTZero rejected the API key)');
  });
  await withDetectors({ gptzero: [{ status: 429, body: { error: 'slow down' } }] }, { GPTZERO_API_KEY: 'test-key-429' }, async () => {
    assert.equal(honestyLine(await measureHonesty('text', { paperRoot: root })), 'unavailable (rate limited)');
  });
});

test('EXP-17: without a terminal, recorded consent sends one request; no recorded consent sends none — --yolo never consents', async () => {
  await withDetectors({ gptzero: [gptzero(0.42)] }, { GPTZERO_API_KEY: 'test-key-consent' }, async (captured) => {
    const yes = paper('[humanizer]\nhonesty_consent = true\n');
    const scored = await measureHonesty('text', { paperRoot: yes, yolo: true });
    assert.equal(scored.kind, 'score');
    assert.equal(captured.length, 1, 'one request with honesty_consent = true');

    const unset = paper();
    for (const yolo of [false, true]) {
      const { value, out } = await captureStdout(() => measureHonesty('text', { paperRoot: unset, yolo }));
      assert.equal(honestyLine(value), `skipped (${NO_CONSENT_REASON})`, `yolo=${yolo}`);
      assert.match(out, /Disclosure: /, 'the disclosure is shown before the consent decision');
    }
    assert.equal(readFileSync(join(unset, '.paper', 'config.toml'), 'utf8'), 'schema_version = 4\n', 'nothing is recorded without an answer');

    const no = paper('[humanizer]\nhonesty_consent = false\n');
    assert.equal(honestyLine(await measureHonesty('text', { paperRoot: no })), 'skipped (consent declined in config.toml)');
    assert.equal(captured.length, 1, 'still only the one consented request');
  });
});

test('EXP-18: honesty_backend = "sapling" → POST api.sapling.ai/api/v1/aidetect, Bearer key, {text, sent_scores:false}; score → "25% … (sapling, <ISO>)"', async () => {
  const root = paper('[humanizer]\nhonesty_backend = "sapling"\nhonesty_consent = true\n');
  await withDetectors({ sapling: [{ status: 200, body: { score: 0.25, sentence_scores: [] } }] }, { SAPLING_API_KEY: 'test-key-sapling' }, async (captured) => {
    const { value, out } = await captureStdout(() => measureHonesty('Sapling text.', { paperRoot: root }));
    assert.match(honestyLine(value), new RegExp(`^25% AI-generated \\(sapling, ${ISO.source}\\)$`));
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.host, 'api.sapling.ai');
    assert.deepEqual(JSON.parse(captured[0]!.body), { text: 'Sapling text.', sent_scores: false });
    assert.equal(captured[0]!.headers['authorization'], 'Bearer test-key-sapling');
    assert.ok(!captured[0]!.body.includes('test-key-sapling'), 'the key travels in the header, never the body');
    assert.ok(out.includes(disclosureLine('sapling')) && out.includes('api.sapling.ai'));
    assert.ok(!out.includes('test-key-sapling'));
  });
});

test('EXP-18: honesty_backend = "originality" → POST api.originality.ai/api/v3/scan, X-OAI-API-KEY, AI scan only, not stored; results.ai.confidence.AI → "90% … (originality, <ISO>)"', async () => {
  const root = paper('[humanizer]\nhonesty_backend = "originality"\nhonesty_consent = true\n');
  const reply = { status: 200, body: { results: { ai: { classification: { AI: 1, Original: 0 }, confidence: { AI: 0.9, Original: 0.1 } } } } };
  await withDetectors({ originality: [reply] }, { ORIGINALITY_API_KEY: 'test-key-originality' }, async (captured) => {
    const { value, out } = await captureStdout(() => measureHonesty('Originality text.', { paperRoot: root }));
    assert.match(honestyLine(value), new RegExp(`^90% AI-generated \\(originality, ${ISO.source}\\)$`));
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.host, 'api.originality.ai');
    const body = JSON.parse(captured[0]!.body) as Record<string, unknown>;
    assert.equal(body['content'], 'Originality text.');
    assert.equal(body['check_ai'], true);
    assert.equal(body['check_plagiarism'], false);
    assert.equal(body['storeScan'], false);
    assert.equal(captured[0]!.headers['x-oai-api-key'], 'test-key-originality');
    assert.ok(out.includes(disclosureLine('originality')));
    assert.ok(!out.includes('test-key-originality'));
  });
  // An answer without the documented field is never read as a score.
  await withDetectors({ originality: [{ status: 200, body: { results: {} } }] }, { ORIGINALITY_API_KEY: 'test-key-originality' }, async () => {
    assert.equal(honestyLine(await measureHonesty('x', { paperRoot: root })), 'unavailable (Originality.ai returned an unexpected response)');
  });
});

test('EXP-18: every configured backend is a real adapter (no not-implemented stub)', async () => {
  for (const name of ['gptzero', 'originality', 'sapling']) assert.equal(selectBackend({ honestyBackend: name }).name, name);
  assert.doesNotMatch(readFileSync(honestySrc, 'utf8'), /notImplementedBackend/);
});

test('HARD-05: the GPTZero size cap truncates the sent text to GPTZERO_MAX_BYTES', () => {
  assert.ok(GPTZERO_MAX_BYTES >= 1024 && GPTZERO_MAX_BYTES <= 1_000_000);
  const oversize = 'é'.repeat(GPTZERO_MAX_BYTES);
  const t = __truncateForGptzeroTest(oversize);
  assert.ok(Buffer.byteLength(t, 'utf8') <= GPTZERO_MAX_BYTES);
  assert.ok(!t.endsWith('\uFFFD'), 'never a split character');
});

test('EXP-16: the after line names why there is no second score', () => {
  const before: HonestyOutcome = { kind: 'skipped', reason: '--no-score', backend: 'gptzero' };
  for (const reason of ['humanize skipped with --raw', 'humanizer not installed', 'humanizer failed: HTTP 500', 'humanizer disabled']) {
    assert.match(renderHonestySection(before, { kind: 'na', reason }), new RegExp(`after humanize\\):  N/A \\(${reason.replace(/[()]/g, '\\$&')}\\)`));
  }
});
