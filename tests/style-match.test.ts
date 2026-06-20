// tests/style-match.test.ts — Phase 8 Wave 0 RED-by-skip scaffold for
// STYL-01/02 (pure-stats style profiling + cross-paper-reuse fingerprinting).
//
// RED-by-skip: every test is `{ skip: !READY }` where READY =
// existsSync('bin/lib/style-match.ts') (built in 08-02). Until then the suite
// reports SKIP so `npm test` stays GREEN.
//
// Contracts pinned (so 08-02 satisfies them without renegotiation):
//   - buildStyleProfile(samplesDir): pure-stats (NO LLM) — deterministic numeric
//     features (median/p25/p75 sentence length, typeTokenRatio∈[0,1],
//     passiveVoiceRate∈[0,1]) + a 64-hex fingerprint.
//   - writeStyleProfile(paperDir, profile): writes paperDir/STYLE.json ONLY.
//   - PITFALL-1 (T-08-00-02): the FINGERPRINT registry at
//     pensmithDataDir()/style-fingerprints.json contains hashes + paper identity
//     ONLY — NO "features" key AND NO "folderPath"/path key. (The PAPER registry,
//     asserted in global-library.test.ts, DELIBERATELY retains folderPath.)
//   - STYL-02: checkAndRegisterFingerprint returns priorPapers=[] on the first
//     registration of a fingerprint, then a NON-EMPTY priorPapers when the SAME
//     fingerprint is registered for a second paperId (reuse detection).
//
// TYPECHECK NOTE: the not-yet-built module is imported via a runtime URL.href
// specifier so `tsc --noEmit` stays clean while the module is absent.
//
// Isolation: tests/library.test.ts env-override tmpdir pattern.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SM_MOD = new URL('../bin/lib/style-match.js', import.meta.url);
const SM_SRC = fileURLToPath(new URL('../bin/lib/style-match.ts', import.meta.url));

// Type contracts 08-02 must satisfy.
interface StyleProfile {
  medianSentenceLength: number;
  p25SentenceLength: number;
  p75SentenceLength: number;
  typeTokenRatio: number;
  passiveVoiceRate: number;
  fingerprint: string;
}
interface PriorPaper {
  paperId: string;
  paperName: string;
  addedAt: string;
}
interface StyleMatchMod {
  buildStyleProfile: (samplesDir: string) => Promise<StyleProfile>;
  writeStyleProfile: (paperDir: string, profile: StyleProfile) => Promise<void>;
  checkAndRegisterFingerprint: (
    fingerprint: string,
    paperId: string,
    paperName: string,
  ) => Promise<{ priorPapers: PriorPaper[] }>;
  styleMatchToVoiceHint: (profile: StyleProfile) => string;
}

async function sm(): Promise<StyleMatchMod> {
  return (await import(SM_MOD.href)) as StyleMatchMod;
}

const READY = fs.existsSync(SM_SRC);

// The committed reuse-positive sample set (Task 1 fixture).
const PAPER_A = fileURLToPath(new URL('../tests/fixtures/style-samples/paperA', import.meta.url));

function mkDataRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-style-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

function mkPaperDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-style-paper-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  return root;
}

// ---------------------------------------------------------------------------
// STYL-01 — pure-stats profile from the committed paperA sample set.
// ---------------------------------------------------------------------------

test('STYL-01: buildStyleProfile returns deterministic, non-degenerate numeric features + a 64-hex fingerprint', { skip: !READY }, async () => {
  mkDataRoot();
  const { buildStyleProfile } = await sm();

  const a = await buildStyleProfile(PAPER_A);
  const b = await buildStyleProfile(PAPER_A);

  // Determinism: same samples → identical profile (pure-stats, no LLM jitter).
  assert.deepEqual(a, b, 'buildStyleProfile must be deterministic for identical samples');

  // Sentence-length quantiles present + ordered.
  assert.equal(typeof a.medianSentenceLength, 'number');
  assert.ok(a.medianSentenceLength > 0, 'median sentence length must be positive (non-degenerate samples)');
  assert.ok(a.p25SentenceLength <= a.medianSentenceLength, 'p25 ≤ median');
  assert.ok(a.medianSentenceLength <= a.p75SentenceLength, 'median ≤ p75');

  // Ratios bounded.
  assert.ok(a.typeTokenRatio >= 0 && a.typeTokenRatio <= 1, 'typeTokenRatio ∈ [0,1]');
  assert.ok(a.passiveVoiceRate >= 0 && a.passiveVoiceRate <= 1, 'passiveVoiceRate ∈ [0,1]');
  // paperA is intentionally passive-heavy ("was studied"/"were asked"…) — the
  // rate must be strictly above zero so the feature is exercised, not dead.
  assert.ok(a.passiveVoiceRate > 0, 'paperA must register a non-zero passive-voice rate');

  // 64-hex fingerprint (SHA-256).
  assert.match(a.fingerprint, /^[0-9a-f]{64}$/, 'fingerprint must be 64 lowercase hex chars');
});

test('STYL-01: writeStyleProfile writes paperDir/.paper/STYLE.json ONLY', { skip: !READY }, async () => {
  mkDataRoot();
  const { buildStyleProfile, writeStyleProfile } = await sm();
  const { paperDir } = await import('../bin/lib/paths.js');

  const root = mkPaperDir();
  const profile = await buildStyleProfile(PAPER_A);
  await writeStyleProfile(paperDir(root), profile);

  const stylePath = path.join(paperDir(root), 'STYLE.json');
  assert.ok(fs.existsSync(stylePath), 'STYLE.json must be written inside the per-paper .paper/');
  const parsed = JSON.parse(fs.readFileSync(stylePath, 'utf8')) as StyleProfile;
  assert.match(parsed.fingerprint, /^[0-9a-f]{64}$/, 'STYLE.json round-trips the fingerprint');
});

// ---------------------------------------------------------------------------
// STYL-02 + PITFALL-1 (T-08-00-02) — fingerprint registry contents + reuse.
// ---------------------------------------------------------------------------

test('PITFALL-1: the FINGERPRINT registry has NO "features" key and NO "folderPath"/path key (hashes + paper identity ONLY)', { skip: !READY }, async () => {
  mkDataRoot();
  const { buildStyleProfile, checkAndRegisterFingerprint } = await sm();
  const { pensmithDataDir } = await import('../bin/lib/paths.js');

  const profile = await buildStyleProfile(PAPER_A);
  await checkAndRegisterFingerprint(profile.fingerprint, 'paper-x', 'Paper X');

  const registryPath = path.join(pensmithDataDir(), 'style-fingerprints.json');
  assert.ok(fs.existsSync(registryPath), 'fingerprint registry must exist under pensmithDataDir()');
  const raw = fs.readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(raw) as unknown;

  // Negative controls — the registry is a privacy-minimal hash→identity map.
  assert.ok(!/\bfeatures\b/.test(raw), 'FINGERPRINT registry must NOT contain a "features" key (no prose features leak)');
  assert.ok(!/folderPath/.test(raw), 'FINGERPRINT registry must NOT contain a "folderPath"/path key (path-leak negative control)');

  // Structural form: the recorded entry carries only {paperId, paperName, addedAt}.
  const flat = JSON.stringify(registry);
  assert.ok(flat.includes('paper-x'), 'registry records the paperId');
  assert.ok(flat.includes('Paper X'), 'registry records the paperName');
  // numeric prose-feature keys must be absent entirely.
  for (const featureKey of ['medianSentenceLength', 'typeTokenRatio', 'passiveVoiceRate', 'p25SentenceLength', 'p75SentenceLength']) {
    assert.ok(!flat.includes(featureKey), `FINGERPRINT registry must not leak the "${featureKey}" feature`);
  }
});

test('STYL-02: checkAndRegisterFingerprint — priorPapers=[] first, then non-empty when the SAME fingerprint is registered for a 2nd paperId (reuse detection)', { skip: !READY }, async () => {
  mkDataRoot();
  const { buildStyleProfile, checkAndRegisterFingerprint } = await sm();

  const profile = await buildStyleProfile(PAPER_A);

  const first = await checkAndRegisterFingerprint(profile.fingerprint, 'paper-1', 'First Paper');
  assert.deepEqual(first.priorPapers, [], 'first registration of a fingerprint sees no prior papers');

  // SAME fingerprint, DIFFERENT paperId → reuse detected.
  const second = await checkAndRegisterFingerprint(profile.fingerprint, 'paper-2', 'Second Paper');
  assert.ok(second.priorPapers.length > 0, 'reuse of a fingerprint under a new paperId must surface priorPapers (STYL-02)');
  assert.ok(
    second.priorPapers.some((p: PriorPaper) => p.paperId === 'paper-1'),
    'priorPapers must name the earlier paper that shared the fingerprint',
  );
});
