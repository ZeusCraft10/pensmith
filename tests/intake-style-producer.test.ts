// tests/intake-style-producer.test.ts — Phase 8 Wave 0 RED-by-skip scaffold for
// the intake style-match opt-in PRODUCER (STYL-01/02 wiring — the wiring the
// cross-AI review found MISSING).
//
// This is the PRODUCER-path test: it asserts that the `intake` verb, when run
// with the style-match opt-in, actually BUILDS .paper/STYLE.json AND surfaces
// the cross-paper-reuse notice. A passing style-match library (08-02) is not
// enough — the opt-in must be WIRED into intake (08-05) for the feature to ship.
//
// RED-by-skip via SOURCE-GREP (mirrors the [07-01] flagsWired/emissionWired
// precedent — a bare existsSync can't detect "module exists but the opt-in is
// not yet wired"): READY = bin/cli/intake.ts references BOTH buildStyleProfile
// AND styleSamples/style-samples. Until 08-05 wires the flag, every test SKIPS
// so `npm test` stays GREEN.
//
// Contracts pinned (so 08-05 satisfies them):
//   (1) `intake --style-samples <dir>` WRITES .paper/STYLE.json.
//   (2) when a PRIOR paper already registered the SAME fingerprint under a
//       different paperId, the run SURFACES a cross-paper-reuse notice on stdout
//       UNCONDITIONALLY — fires even WITHOUT --yolo and is not suppressible.
//   (3) WITHOUT the opt-in flag, NO .paper/STYLE.json is produced (opt-in only).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

// SOURCE-GREP skip-predicate: intake.ts must import/reference the style-match
// producer AND name the style-samples opt-in. existsSync alone is insufficient —
// intake.ts already exists as a stub.
function intakeStyleWired(): boolean {
  const intakePath = repoPath('bin/cli/intake.ts');
  if (!fs.existsSync(intakePath)) return false;
  const src = fs.readFileSync(intakePath, 'utf8');
  return /buildStyleProfile/.test(src) && /style[-_]?[sS]amples/.test(src);
}

const READY = intakeStyleWired();

const PAPER_A = repoPath('tests/fixtures/style-samples/paperA');

// Runtime URL.href specifier for the not-yet-built style-match module so
// `tsc --noEmit` stays clean while 08-02 is pending.
const SM_MOD = new URL('../bin/lib/style-match.js', import.meta.url);
interface StyleMatchProducerMod {
  buildStyleProfile: (samplesDir: string) => Promise<{ fingerprint: string }>;
  checkAndRegisterFingerprint: (
    fingerprint: string,
    paperId: string,
    paperName: string,
  ) => Promise<{ priorPapers: Array<{ paperId: string; paperName: string; addedAt: string }> }>;
}

function mkProjectRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-intake-style-'));
  // Env-override isolation: pensmithDataDir() (where the fingerprint registry
  // lives) AND the project cwd both resolve into tmp.
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  // Tier-2 deterministic mode (no LLM) so intake runs offline.
  process.env.PENSMITH_NO_LLM = '1';
  return tmp;
}

/** Capture process.stdout.write for the duration of `fn`. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  const patched = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = patched;
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join('');
}

/** Run the intake verb inside `cwd` with the given args, returning stdout. */
async function runIntake(cwd: string, args: Record<string, unknown>): Promise<string> {
  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    const { intakeCommand } = await import('../bin/cli/intake.js');
    const run = (intakeCommand as { run: (ctx: { args: Record<string, unknown> }) => Promise<unknown> }).run;
    return await captureStdout(async () => {
      await run({ args });
    });
  } finally {
    process.chdir(prevCwd);
  }
}

test('PRODUCER (1): `intake --style-samples <dir>` writes .paper/STYLE.json', { skip: !READY }, async () => {
  const root = mkProjectRoot();
  await runIntake(root, { styleSamples: PAPER_A, yolo: true });

  const stylePath = path.join(root, '.paper', 'STYLE.json');
  assert.ok(fs.existsSync(stylePath), 'opt-in run must produce .paper/STYLE.json');
  const parsed = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
  assert.match(parsed.fingerprint, /^[0-9a-f]{64}$/, 'STYLE.json must carry a 64-hex fingerprint');
});

test('PRODUCER (2): cross-paper-reuse notice fires UNCONDITIONALLY when a prior paper shares the fingerprint (even without --yolo)', { skip: !READY }, async () => {
  const root = mkProjectRoot();

  // Seed a PRIOR paper that registered the SAME paperA fingerprint under a
  // different paperId.
  const { buildStyleProfile, checkAndRegisterFingerprint } =
    (await import(SM_MOD.href)) as StyleMatchProducerMod;
  const prior = await buildStyleProfile(PAPER_A);
  await checkAndRegisterFingerprint(prior.fingerprint, 'prior-paper', 'A Prior Paper');

  // Now run intake with the opt-in but WITHOUT --yolo. The reuse notice must
  // still surface (it is a transparency signal, NOT a gate that --yolo skips).
  const out = await runIntake(root, { styleSamples: PAPER_A, yolo: false });

  assert.match(
    out,
    /reuse|already used|prior paper|A Prior Paper/i,
    `reuse notice must surface on stdout (unconditional), got:\n${out}`,
  );
});

test('PRODUCER (3): WITHOUT the opt-in flag, NO .paper/STYLE.json is produced (opt-in is explicit)', { skip: !READY }, async () => {
  const root = mkProjectRoot();
  await runIntake(root, { yolo: true });

  const stylePath = path.join(root, '.paper', 'STYLE.json');
  assert.ok(!fs.existsSync(stylePath), 'no opt-in flag → no STYLE.json (style-match is opt-in only)');
});
