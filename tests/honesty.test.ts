// tests/honesty.test.ts — the GPTZero honesty score and its framing.
//
// Covers:
//   - the score comes only from the consented POST through http.ts, answered
//     here from the committed cassette; no key, or no consent, gives null and
//     sends nothing;
//   - the paid score is a row on the ledger of the paper scored;
//   - the honest-framing note is rendered verbatim from the locked
//     references/honesty-framing.md, never inlined;
//   - the backend is pluggable: an unknown or unimplemented one scores nothing
//     and does not throw;
//   - text over GPTZERO_MAX_BYTES is cut to it before the POST.
//
// These used to skip whenever bin/lib/honesty.ts or one of its exports was
// missing, and their "consistency" checks passed whichever way the file was;
// the module is imported statically now, so a missing export fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCassetteFile } from '../bin/lib/http-mock.js';
import {
  __truncateForGptzeroTest,
  GPTZERO_MAX_BYTES,
  renderHonestyReport,
  scoreHonesty,
  scoreHonestyWithOptions,
  selectBackend,
} from '../bin/lib/honesty.js';

const framingPath = fileURLToPath(new URL('../references/honesty-framing.md', import.meta.url));

/** The note paragraph below "## Note" in the locked framing file, as honesty.ts extracts it. */
function framingNote(): string {
  const md = readFileSync(framingPath, 'utf8');
  const m = /## Note\s*\n+([\s\S]+?)(?:\n##|\n\(|$)/.exec(md);
  assert.ok(m && m[1], 'honesty-framing.md must have a ## Note section');
  // Strip the markdown blockquote markers ("> ") the same way the code does.
  return m[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/^>\s?/, ''))
    .join('\n')
    .trim();
}

/** Run `fn` with GPTZERO_API_KEY set to `key` (deleted when undefined) and cassette replay on. */
async function withKey<T>(key: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env['GPTZERO_API_KEY'];
  const savedMode = process.env['PENSMITH_TEST_CASSETTES'];
  if (key === undefined) delete process.env['GPTZERO_API_KEY'];
  else process.env['GPTZERO_API_KEY'] = key;
  // Cassette replay, so even a regression could not POST to the real service.
  process.env['PENSMITH_TEST_CASSETTES'] = '1';
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env['GPTZERO_API_KEY'];
    else process.env['GPTZERO_API_KEY'] = saved;
    if (savedMode === undefined) delete process.env['PENSMITH_TEST_CASSETTES'];
    else process.env['PENSMITH_TEST_CASSETTES'] = savedMode;
  }
}

test('honesty: GPTZero cassette exists in Cassette[] schema with ai=0.82 / AI_ONLY (DONE-04)', () => {
  const cs = loadCassetteFile('gptzero', 'predict-text');
  assert.ok(Array.isArray(cs) && cs.length >= 1, 'gptzero/predict-text.json must be a non-empty Cassette[]');
  assert.equal(cs[0]?.method, 'POST');
  const resp = cs[0]?.response as { documents: Array<{ class_probabilities: { ai: number }; document_classification: string }> };
  assert.equal(resp.documents[0]?.class_probabilities.ai, 0.82);
  assert.equal(resp.documents[0]?.document_classification, 'AI_ONLY');
});

test('honesty: absent GPTZERO_API_KEY → scoreHonesty returns null (DONE-04)', async () => {
  assert.equal(await withKey(undefined, () => scoreHonesty('some text')), null);
  assert.equal(await withKey(undefined, () => scoreHonestyWithOptions('some text', { consentGranted: true })), null, 'consent without a key sends nothing');
});

// This used to read the cassette directly with no consent and no request, which
// is how production showed a canned 82% to every user. The score now comes only
// from the consented POST through http.ts; the test runner answers that POST
// from the committed cassette.
test('honesty: consented GPTZero POST (cassette-answered) → { aiProbability:0.82, classification:AI_ONLY, backend:gptzero } (DONE-04)', async () => {
  // The score is paid, so it is a row on the paper's cost ledger: the
  // ledger of the paper being scored, never one where the cwd happens to be.
  const paperRoot = mkdtempSync(join(tmpdir(), 'pensmith-honesty-paper-'));
  const result = await withKey('test-key-offline', () => scoreHonestyWithOptions('some text', { consentGranted: true, paperRoot }));
  assert.ok(result, 'the cassette-answered POST must yield a score');
  assert.equal(result.aiProbability, 0.82);
  assert.equal(result.classification, 'AI_ONLY');
  assert.equal(result.backend, 'gptzero');
  const ledger = readFileSync(join(paperRoot, '.paper', 'COSTS.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { scopeId: string });
  assert.deepEqual(ledger.map((r) => r.scopeId), ['honesty-gptzero']);
  assert.equal(existsSync(join(process.cwd(), '.paper')), false, 'nothing is written under the cwd');
});

test('honesty: without consent nothing is sent and there is no score (HARD-05)', async () => {
  const paperRoot = mkdtempSync(join(tmpdir(), 'pensmith-honesty-no-consent-'));
  for (const consentGranted of [false, undefined]) {
    const result = await withKey('test-key-hard05-consent', () => scoreHonestyWithOptions('some paper text', { ...(consentGranted === undefined ? {} : { consentGranted }), paperRoot }));
    assert.equal(result, null, `consent ${String(consentGranted)} gives no score`);
  }
  assert.equal(existsSync(join(paperRoot, '.paper', 'COSTS.jsonl')), false, 'no paid call was made');
});

test('honesty: renderHonestyReport shows 82% + 41% AND the VERBATIM note from the locked framing file (DONE-04)', () => {
  const report = renderHonestyReport(0.82, 0.41, 'gptzero');
  assert.match(report, /82%/, 'must show before-humanize 82%');
  assert.match(report, /41%/, 'must show after-humanize 41%');
  // The rendered note MUST equal the locked framing-file note verbatim — proving
  // the copy is rendered from references/honesty-framing.md, not inlined.
  assert.ok(report.includes(framingNote()), 'rendered report must contain the locked framing note VERBATIM');
});

test('honesty: selectBackend honors config; an unimplemented backend scores nothing and does not throw (DONE-05)', async () => {
  assert.equal(selectBackend({ honestyBackend: 'gptzero' }).name, 'gptzero');
  assert.equal(selectBackend({}).name, 'gptzero', 'GPTZero is the default backend');
  for (const name of ['originality', 'sapling']) {
    const backend = selectBackend({ honestyBackend: name });
    assert.equal(backend.name, name);
    assert.equal(await withKey('test-key', () => backend.score('text')), null, `${name} sends nothing and scores nothing`);
  }
});

test('HARD-05: text over GPTZERO_MAX_BYTES is cut to it before the POST', () => {
  assert.ok(GPTZERO_MAX_BYTES >= 1024 && GPTZERO_MAX_BYTES <= 1_000_000, `GPTZERO_MAX_BYTES is ${GPTZERO_MAX_BYTES}`);
  const oversize = 'a'.repeat(GPTZERO_MAX_BYTES + 100);
  const truncated = __truncateForGptzeroTest(oversize);
  assert.equal(Buffer.byteLength(truncated, 'utf8'), GPTZERO_MAX_BYTES);
  assert.equal(__truncateForGptzeroTest('short'), 'short', 'text under the cap is sent as it is');
  // Multi-byte text is cut on a character boundary, never inside one.
  const wide = 'é'.repeat(GPTZERO_MAX_BYTES);
  const cut = __truncateForGptzeroTest(wide);
  assert.ok(Buffer.byteLength(cut, 'utf8') <= GPTZERO_MAX_BYTES);
  assert.doesNotMatch(cut, /�/, 'no broken character at the cut');
});
