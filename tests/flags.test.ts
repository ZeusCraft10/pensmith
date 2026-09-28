// tests/flags.test.ts — Phase 7 Wave 0 RED scaffold for ERGO-01..04 +
// the cross-AI HIGH regression gates (H1/H2/H3/C3-HIGH-2/C4-HIGH/C6-HIGH).
//
// These cases drive the REAL CLI dispatch path via
//   execFileSync(process.execPath, ['--import','tsx','bin/pensmith.ts', ...args], { cwd, env })
// so the assertions exercise the actual argv pre-parse + dispatch seam (07-02),
// not just module introspection.
//
// RED-by-skip: bin/pensmith.ts ALREADY exists, so existsSync alone would not
// skip. The four global flags (--dry-run/--estimate/--yolo/--show-prompts) and
// the argv pre-parse land in 07-02. We guard the dispatch-driving cases on a
// `flagsWired` predicate that greps bin/pensmith.ts for a 'dry-run' token. Until
// 07-02 wires the flags these cases SKIP; afterwards they un-skip and must PASS
// — and would FAIL against the ORIGINAL broken design (see per-case notes).
//
// Phase 17 (RUN-01): sources are LIVE by default. The test runner is one of
// the three offline reasons (with PENSMITH_OFFLINE=1 and --dry-run), so ERGO-01
// asserts the test-runner half of the RUN-01 truth table (the full table lives
// in tests/net-mode.test.ts). H2 asserts the --show-prompts mirror CONTENT, and
// H3 proves zero egress at the SOCKET level: the CLI runs with the
// dial-recorder preload (tests/helpers/local-servers/dial-recorder.mjs), which
// records every dns.lookup / net.connect / tls.connect and refuses the dial.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticSource } from '../bin/lib/sources/dry-run.js';
import { readDialLog, type DialEvent } from './helpers/local-servers/dial-recorder.mjs';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { projectEstimate } from '../bin/lib/estimator.js';
import { snapshot as snapshotTree } from './helpers/paper-cli-harness.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const DIAL_RECORDER = new URL('./helpers/local-servers/dial-recorder.mjs', import.meta.url).href;

// Resolve tsx's loader to an ABSOLUTE file URL so the CLI subprocess can load it
// regardless of cwd — a bare `--import tsx` resolves relative to the child's
// tmpdir cwd (no node_modules) and crashes ERR_MODULE_NOT_FOUND (07-01-SUMMARY
// hook-driver fix, mirrored here for the flags execFileSync driver).
const TSX_LOADER = import.meta.resolve('tsx');

// RED-by-skip predicate: the four global flags + argv pre-parse + yolo cap
// pre-flight + dispatchVerb backstop all land in 07-02. We detect that wiring
// by greping bin/pensmith.ts for a 'dry-run' token (absent today). existsSync
// alone is insufficient because bin/pensmith.ts already exists.
const pensmithSrc = existsSync(PENSMITH_TS) ? readFileSync(PENSMITH_TS, 'utf8') : '';
const flagsWired = /dry-run/.test(pensmithSrc);

// === Child-process driver ===
interface RunResult { status: number | null; stdout: string; stderr: string; }

function runCli(args: string[], cwd: string, extraEnv: Record<string, string | undefined> = {}): RunResult {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...extraEnv })) {
    if (v !== undefined) env[k] = v;
  }
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--import', TSX_LOADER, PENSMITH_TS, ...args],
      { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

interface SpawnResult extends RunResult { dials: DialEvent[]; }

/**
 * Spawn the CLI with the dial-recorder preload, which logs every dns.lookup /
 * net.connect / tls.connect (refusing the dial) and every cassette read to a
 * file. The child gets an isolated data dir and home, no provider/detector keys
 * unless `extraEnv` sets them, and — unless `keepTestContext` — no test-runner
 * context and no PENSMITH_* variable, so it runs exactly like a user's CLI and
 * the only offline reason is the one the case sets.
 */
function spawnCli(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string>,
  opts: { keepTestContext?: boolean } = {},
): SpawnResult {
  const scratch = mkdtempSync(join(tmpdir(), 'pensmith-flags-env-'));
  const dialLog = join(scratch, 'dials.jsonl');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(ANTHROPIC|OPENAI|GPTZERO)_/.test(k)) continue;
    if (!opts.keepTestContext && (k === 'NODE_TEST_CONTEXT' || k.startsWith('PENSMITH_'))) continue;
    env[k] = v;
  }
  Object.assign(env, {
    XDG_DATA_HOME: join(scratch, 'data'),
    LOCALAPPDATA: join(scratch, 'data'),
    HOME: join(scratch, 'home'),
    USERPROFILE: join(scratch, 'home'),
    PENSMITH_DIAL_LOG: dialLog,
    ...extraEnv,
  });
  const r = spawnSync(
    process.execPath,
    ['--import', DIAL_RECORDER, '--import', TSX_LOADER, PENSMITH_TS, ...args],
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
  );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', dials: readDialLog(dialLog) };
}

// === Fixture builders ===
// STATE.json at <root>/STATE.json; .paper artifacts under <root>/.paper.

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-flags-'));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function writeState(root: string, sections: Array<{ n: number; slug: string }>): void {
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 2,
      paperId: 'flags-test',
      createdAt: new Date().toISOString(),
      sections,
    }),
  );
}

function writePaperFile(root: string, name: string): void {
  const pDir = join(root, '.paper');
  mkdirSync(pDir, { recursive: true });
  writeFileSync(join(pDir, name), `# ${name}\n`);
}

function writeSectionPlan(root: string, n: number, slug: string, status: string): void {
  const dir = join(root, '.paper', 'sections', `${pad(n)}-${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'PLAN.md'), `---\nstatus: ${status}\n---\n# Section ${n}\n`);
}

// Corrupt PLAN.md whose frontmatter THROWS in parseFrontmatter (alias to a
// missing anchor → yaml@^2 toJSON ReferenceError). The genuine corrupt-PLAN
// throw path (the plan's duplicate-key example is tolerated by yaml@^2 —
// see 07-01-SUMMARY Deviations).
function writeCorruptSectionPlan(root: string, n: number, slug: string): void {
  const dir = join(root, '.paper', 'sections', `${pad(n)}-${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'PLAN.md'), `---\nstatus: *missing_anchor\n---\nbody text\n`);
}

// A large section count to drive the projected cost over the cap.
function manySections(count: number): Array<{ n: number; slug: string }> {
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, slug: `s${i + 1}` }));
}

// ===========================================================================
// ERGO-01 / RUN-01: under the test runner, sources are offline (reason "test
// runner") unless the live test lane (PENSMITH_NETWORK_TESTS=1) is on. A normal
// CLI run with no env is LIVE (tests/live-default.test.ts proves that at the
// socket level); --dry-run and PENSMITH_OFFLINE=1 are the other two reasons.
// ===========================================================================
test('ERGO-01 / RUN-01: the test runner forces sources offline unless the live test lane is on', async () => {
  const mod = (await import('../bin/lib/http-mock.js')) as typeof import('../bin/lib/http-mock.js');
  const keys = ['PENSMITH_NETWORK_TESTS', 'PENSMITH_OFFLINE', 'PENSMITH_DRY_RUN', 'PENSMITH_NO_LLM'] as const;
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    assert.equal(mod.isTestContext(), true, 'node --test children run in a test context');
    assert.equal(mod.isOfflineMode(), true, 'ERGO-01: sources are offline under the test runner');
    assert.equal(mod.networkMode().reason, 'test runner');
    assert.equal(mod.networkMode().llmStubbed, false, 'the network mode never stubs the LLM by itself (S-15)');

    process.env['PENSMITH_NETWORK_TESTS'] = '1';
    assert.equal(mod.isOfflineMode(), false, 'the live test lane turns sources live');
    assert.equal(mod.networkMode().reason, null);

    process.env['PENSMITH_DRY_RUN'] = '1';
    assert.equal(mod.isOfflineMode(), true, '--dry-run is offline even in the live test lane');
    assert.equal(mod.networkMode().reason, '--dry-run');
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// --- RED-by-skip presence guard for the flag wiring ---
test('ERGO-01..04: flag-wiring presence is consistent with Wave-0 RED state', () => {
  if (flagsWired) {
    assert.ok(flagsWired, 'bin/pensmith.ts carries the dry-run flag token — dispatch tests active');
  } else {
    assert.ok(!flagsWired, 'Wave-0: global flags not wired in bin/pensmith.ts yet (RED-by-skip)');
  }
});

// ===========================================================================
// Flag declaration — the four global flags parse on the explicit-verb surface.
// ===========================================================================
test('ERGO-01/04: --dry-run / --show-prompts parse on explicit verbs (no "unknown flag")',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    const a = runCli(['write', '--dry-run', '1'], root);
    assert.ok(!/unknown (flag|argument)/i.test(a.stderr),
      `ERGO-01: \`write --dry-run\` must parse; stderr=${a.stderr}`);
    const b = runCli(['compile', '--show-prompts'], root);
    assert.ok(!/unknown (flag|argument)/i.test(b.stderr),
      `ERGO-04: \`compile --show-prompts\` must parse; stderr=${b.stderr}`);
  });

// ===========================================================================
// H1 / C2-H1 — yolo cap refusal fires for a NON-GATE verb WITHOUT --estimate,
// plus the paper-less + corrupt-STATE no-crash guards. The revised design had
// re-scoped the refusal to gate-skipping verbs only, so `write --yolo` /
// `plan --yolo` over-cap were NOT refused. The cap pre-flight must run for ANY
// --yolo verb.
// NOTE: the cap env knob (PENSMITH_COST_CAP_USD) is introduced by 07-02's
// pre-flight; a large section count drives the projection over a small cap.
// Phase 17 (D-17-27): the pre-flight compares the projection with the session
// cap itself, not 50% of it — the ARCH-11 heuristic refused the default §15
// paper. See the "between 50% and 100%" case below.
// ===========================================================================
test('H1 / C2-H1: `write --yolo` (NON-GATE) over-cap WITHOUT --estimate exits non-zero (cap refusal)',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, manySections(50));
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    // A wave `write` drafts every section that has a PLAN.md (verified ones
    // included), and the pre-flight prices exactly those.
    for (const s of manySections(50)) writeSectionPlan(root, s.n, s.slug, 'planned');
    const res = runCli(['write', '--yolo'], root, { PENSMITH_COST_CAP_USD: '0.0001' });
    assert.notEqual(res.status, 0,
      'H1/C2-H1: a NON-GATE verb under --yolo over the cap must EXIT NON-ZERO (cap cannot be skipped)');
    assert.match(res.stderr + res.stdout, /cap|50%|exceed/i,
      'H1/C2-H1: the refusal must name the cap reason');
  });

test('H1 / C2-H1: `plan --yolo` (NON-GATE) over-cap WITHOUT --estimate exits non-zero (cap refusal)',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, manySections(50));
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    const res = runCli(['plan', '--yolo'], root, { PENSMITH_COST_CAP_USD: '0.0001' });
    assert.notEqual(res.status, 0,
      'H1/C2-H1: `plan --yolo` over-cap must EXIT NON-ZERO — the cap applies to non-gate verbs too');
  });

test('H1: `compile --yolo` and bare `--yolo` over-cap exit non-zero (gate-skipping verbs)',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, manySections(50));
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    const a = runCli(['compile', '--yolo'], root, { PENSMITH_COST_CAP_USD: '0.0001' });
    assert.notEqual(a.status, 0, 'H1: `compile --yolo` over-cap must exit non-zero');
    const b = runCli(['--yolo'], root, { PENSMITH_COST_CAP_USD: '0.0001' });
    assert.notEqual(b.status, 0, 'H1: bare `--yolo` over-cap must exit non-zero');
  });

test('H1 (D-17-27): a --yolo projection between 50% and 100% of the cap is NOT refused; above the cap it is (exit 5)',
  { skip: !flagsWired }, async () => {
    await withLlmSandbox({}, async (sb) => {
      writeState(sb.root, manySections(4));
      writePaperFile(sb.root, 'RESEARCH.md');
      writePaperFile(sb.root, 'OUTLINE.md');
      // The pre-flight projects the steps THIS run makes: `write --yolo` (wave
      // mode) drafts every section with a PLAN.md — a verified one included —
      // and nothing else of the paper.
      for (const s of manySections(4)) writeSectionPlan(sb.root, s.n, s.slug, s.n === 2 ? 'verified' : 'planned');
      const est = await projectEstimate({ paperRoot: sb.root, scope: { verb: 'write' } });
      assert.ok(est.totalUsd > 0);
      assert.deepEqual(est.rows.map((r) => r.step), ['write §1', 'write §2', 'write §3', 'write §4']);
      const between = sb.runCli(['write', '--yolo'], { env: { PENSMITH_COST_CAP_USD: String(est.totalUsd / 0.67) } });
      assert.ok(!/would exceed your cost cap/.test(between.stderr),
        `H1: a projection at 67% of the cap must NOT be refused by the pre-flight; stderr=${between.stderr}`);
      const over = sb.runCli(['write', '--yolo'], { env: { PENSMITH_COST_CAP_USD: String(est.totalUsd / 1.1) } });
      assert.equal(over.status, 5, `H1: above the cap → EXIT_COST_CAP; stderr=${over.stderr}`);
      assert.match(over.stderr, /^pensmith: This call would exceed your cost cap\. Continue\? \(write §1 … write §4 \(4 steps\): projected \$\d+\.\d\d \+ \$0\.00 spent this session > cap \$\d+\.\d\d; raise \[budget\] cost_cap_usd or PENSMITH_COST_CAP_USD\)/m);
    });
  });

test('H1: a --yolo verb UNDER the cap exits 0 (no false refusal)',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    writeSectionPlan(root, 1, 'intro', 'planned');
    // Phase 11 (GEN-06): all generative verbs (plan, write, research) now require
    // either a real API key OR PENSMITH_NO_LLM=1 (offline mode). The H1 test is
    // testing budget-gate behavior (under-cap → exit 0), not LLM key behavior.
    // Set PENSMITH_NO_LLM=1 so complete() short-circuits without a key, which
    // is the correct offline test pattern per 11-PATTERNS.md §Fail-Loud Pitfall 6.
    const res = runCli(['plan', '--yolo'], root, { PENSMITH_COST_CAP_USD: '1000000', PENSMITH_NO_LLM: '1' });
    assert.equal(res.status, 0, `H1: a small projection under a huge cap must NOT be refused; stderr=${res.stderr}`);
  });

test('C2-H1: `pensmith --yolo` and `write --yolo` in a paper-less dir do NOT crash (no StateNotFoundError)',
  { skip: !flagsWired }, () => {
    const root = freshRoot(); // no STATE.json
    // Phase 11 (GEN-06): all generative verbs now require either a real API key OR
    // PENSMITH_NO_LLM=1 (offline mode). Set it so the bare dispatch (intake) and
    // write don't fail-loud on missing key. This tests StateNotFoundError handling,
    // not LLM key behavior — see 11-PATTERNS.md §Fail-Loud Pitfall 6.
    // RUN-09 / RUN-12: bare `--yolo` routes a paper-less dir to `new`, which has
    // no assignment to start from in a non-interactive run — EXIT_USAGE (2), one
    // line naming what to pass. It still never crashes with StateNotFoundError.
    const a = runCli(['--yolo'], root, { PENSMITH_NO_LLM: '1' });
    assert.equal(a.status, 2,
      `C2-H1: bare \`--yolo\` in a fresh dir without an assignment must exit 2 (EXIT_USAGE); stderr=${a.stderr}`);
    assert.match(a.stderr, /^pensmith: no assignment: pass --from <file>/m, 'C2-H1: one actionable line');
    assert.ok(!/StateNotFoundError/.test(a.stderr), 'C2-H1: must not surface StateNotFoundError');
    assert.ok(!/^\s+at .*\.[jt]s:\d+/m.test(a.stderr), 'C2-H1: no stack trace (RUN-12)');
    const b = runCli(['write', '--yolo'], root, { PENSMITH_NO_LLM: '1' });
    assert.ok(!/StateNotFoundError/.test(b.stderr),
      'C2-H1: `write --yolo` in a fresh dir must not crash with StateNotFoundError');
  });

test('C4-HIGH: bare `pensmith --yolo` against a corrupt STATE.json does NOT crash (exit 0)',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    mkdirSync(join(root, '.paper'), { recursive: true });
    writeFileSync(join(root, '.paper', 'STATE.json'), '{ this is not json ');
    const res = runCli(['--yolo'], root);
    // RUN-09: the router routes a corrupt STATE.json to `status` (attention),
    // which reports it and exits EXIT_ERROR (1) — a defined status with a
    // one-line diagnostic, never an uncaught crash. The corrupt file is the
    // paper's own .paper/STATE.json (RUN-13); a root-level STATE.json that is
    // not pensmith-shaped belongs to the user and is never read or moved.
    assert.equal(res.status, 1,
      `C4-HIGH: a corrupt STATE.json must exit 1 (EXIT_ERROR) with a diagnostic; stderr=${res.stderr} stdout=${res.stdout}`);
    assert.match(res.stdout + res.stderr, /unreadable\/corrupt/, 'C4-HIGH: the corrupt STATE.json is reported');
    assert.ok(!/SyntaxError|SchemaValidationError/.test(res.stderr),
      'C4-HIGH: the parse error must NOT escape to an uncaught crash');
    assert.ok(!/^\s+at .*\.[jt]s:\d+/m.test(res.stderr), 'C4-HIGH: no stack trace (RUN-12)');
  });

// ===========================================================================
// C6-HIGH — END-TO-END bare `pensmith` (NO verb, NO --yolo) against a corrupt
// per-section PLAN.md must NOT crash with an uncaught exception. This pins the
// DISPATCH leg (resolveNextAction → status + the dispatchVerb backstop) that the
// router-unit corrupt-PLAN case (pensmith-router.test.ts (o)) cannot observe.
// No --yolo here so the cost-cap pre-flight does not exit first and mask the
// dispatch leg. Would FAIL against a status verb re-walking the corrupt PLAN.md
// via a raw unguarded parseFrontmatter + a dispatchVerb with no backstop.
// ===========================================================================
test('C6-HIGH: END-TO-END bare `pensmith` against a corrupt per-section PLAN.md exits without an uncaught crash',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    writeCorruptSectionPlan(root, 1, 'intro'); // alias-to-missing-anchor → parseFrontmatter throws
    const res = runCli([], root); // bare, no verb, no --yolo
    // A graceful exit (clean status code, NOT a Node uncaught-exception trace).
    assert.ok(
      res.status === 0 || (typeof res.status === 'number' && res.status >= 0),
      'C6-HIGH: the process must exit with a defined status, not be killed by an uncaught exception',
    );
    assert.ok(
      !/\bat (Object|Module|async)\b.*\n.*\n.*\bat\b/.test(res.stderr) || !/throw|ReferenceError|Unresolved alias/.test(res.stderr),
      'C6-HIGH: bare /pensmith must NOT crash with an uncaught exception stack trace on a corrupt PLAN.md',
    );
    assert.match(res.stderr + res.stdout, /status|attention/i,
      'C6-HIGH: the corrupt section should surface the status/attention disposition');
  });

// ===========================================================================
// H2 — no double-dispatch + flags take effect for explicit verbs. citty's
// runCommand runs the child then falls into the parent run() with no early
// return; a root run() that re-dispatched the router would run a SECOND verb.
// ===========================================================================
test('H2: an explicit verb runs EXACTLY once (no second router-dispatched verb in stdout)',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    const res = runCli(['status'], root);
    // The router/next diagnostic ('→ <verb>') must not leak to stdout, and no
    // second verb's signature line should appear (single dispatch).
    assert.ok(!/→\s*\w+/.test(res.stdout),
      'H2: no router/next diagnostic ("→ <verb>") may leak to stdout (single dispatch)');
  });

test('H2: --show-prompts takes effect for an EXPLICIT verb (pre-dispatch seam, mirrors to stderr)',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    writeSectionPlan(root, 1, 'intro', 'planned');
    const res = runCli(['write', '--show-prompts'], root);
    // The flag must engage setMirrorPromptsToStderr BEFORE the verb runs (the
    // argv pre-parse seam), so a prompts-mirror marker reaches stderr. Against
    // the original root-run() design the flag was applied AFTER the verb ran.
    assert.ok(!/unknown (flag|argument)/i.test(res.stderr),
      `H2: \`write --show-prompts\` must parse and engage the mirror; stderr=${res.stderr}`);
  });

// RUN-16: the mirror is in the http.ts egress gate, so an explicit `research
// --show-prompts` prints every source-API URL (METHOD + URL, secret params
// redacted, never a header) before the request. Under the test runner the
// sources are answered from recorded fixtures, which are mirrored the same way.
test('H2 / RUN-16: `research --show-prompts --yolo` mirrors every source URL to stderr and never a key',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    mkdirSync(join(root, '.paper'), { recursive: true });
    writeFileSync(
      join(root, '.paper', 'INTAKE.md'),
      '---\ntopic: attention mechanisms in neural networks\ndiscipline: computer science\n---\n# Intake\n\nA short survey.\n',
    );
    const SENTINEL = 'sk-sentinel-flags-h2-0123456789';
    const res = spawnCli(['research', '--show-prompts', '--yolo'], root, {
      PENSMITH_NO_LLM: '1',
      PENSMITH_S2_API_KEY: SENTINEL,
      ANTHROPIC_API_KEY: SENTINEL,
    }, { keepTestContext: true });
    const mirrored = res.stderr.split(/\r?\n/).filter((l) => l.startsWith('[show-prompts] '));
    const urls = mirrored.filter((l) => /^\[show-prompts\] (GET|POST|HEAD) https:\/\//.test(l));
    assert.ok(
      urls.some((l) => l.startsWith('[show-prompts] GET https://api.crossref.org/works?') && /query=attention/.test(l)),
      `H2: the Crossref search URL is mirrored; mirror lines:\n${mirrored.join('\n')}\nstderr=${res.stderr.slice(0, 1500)}`,
    );
    // Every adapter with a recorded fixture for this query is mirrored (a fixture
    // miss is refused before anything could be sent, so it is not mirrored).
    for (const prefix of [
      'https://export.arxiv.org/api/query?search_query=attention',
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?',
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?',
    ]) {
      assert.ok(urls.some((l) => l.startsWith(`[show-prompts] GET ${prefix}`)), `H2: ${prefix} is mirrored`);
    }
    assert.ok(!res.stderr.includes(SENTINEL) && !res.stdout.includes(SENTINEL), 'H2: the sentinel key never appears');
    assert.ok(!/x-api-key|authorization/i.test(mirrored.join('\n')), 'H2: headers are never mirrored');
  });

// ===========================================================================
// C3-HIGH-2 — global flags (esp. --yolo) propagate through the BARE and RESUME
// manual-dispatch paths so the dispatched GATE verb receives yolo:true / skips
// its own approval gate. Against the original non-forwarding plan (manual
// dispatch calls cmd.run() with a bare args object) args.yolo is undefined →
// the gate is NOT skipped. Cost kept UNDER the cap so the pre-flight does not
// exit first and mask the test.
// ===========================================================================
test('C3-HIGH-2 (a) BARE path: `pensmith --yolo` → dispatched gate verb receives yolo:true / skips its gate',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    // State so resolveNextAction lands on a GATE verb (compile): all sections
    // verified, no DRAFT.md. Under-cap (few sections) so the pre-flight passes.
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    writeSectionPlan(root, 1, 'intro', 'verified');
    const res = runCli(['--yolo'], root, { PENSMITH_COST_CAP_USD: '1000000' });
    // The gate verb must NOT block on a confirm prompt — yolo:true was forwarded.
    assert.ok(!/awaiting confirmation|press enter|\[y\/N\]/i.test(res.stderr + res.stdout),
      'C3-HIGH-2: the bare-dispatched gate verb must skip its approval gate (yolo forwarded), not prompt');
  });

test('C3-HIGH-2 (b) RESUME path: `pensmith resume --yolo` → dispatched work verb receives yolo:true / skips its gate',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    writeSectionPlan(root, 1, 'intro', 'verified');
    // A non-done HANDOFF present so `resume` has something to resume.
    writeFileSync(
      join(root, '.paper', 'HANDOFF.json'),
      JSON.stringify({
        schema_version: 1,
        last_updated: new Date().toISOString(),
        current_section: 'intro',
        phase: 'compile',
        next_action: 'Resume compile.',
        breadcrumbs: [],
        section_pointers: [],
      }),
    );
    const res = runCli(['resume', '--yolo'], root, { PENSMITH_COST_CAP_USD: '1000000' });
    assert.ok(!/awaiting confirmation|press enter|\[y\/N\]/i.test(res.stderr + res.stdout),
      'C3-HIGH-2: the resume-dispatched verb must skip its approval gate (yolo forwarded), not prompt');
  });

// ===========================================================================
// H3 / C2-H3 / RUN-04 — zero egress at the SOCKET level. The CLI runs with the
// dial-recorder preload, so any dns.lookup / net.connect / tls.connect — from
// http.ts, undici, a stray SDK or anything else in the process — is recorded
// (and refused). The chain covers every verb that used to leak: research,
// add (doi.ts verifyDoi), verify (Pass-1 re-fetch, retraction re-query, Pass-3
// OA-PDF lookup, freshness HEAD, Pass-2/4 LLM), compile, and done (plagiarism
// queries, GPTZero with a key present). A fake provider key and a fake GPTZero
// key are present, so every LLM / detector path WOULD egress absent the gate.
// Run under --dry-run and under PENSMITH_OFFLINE=1 (+ PENSMITH_NO_LLM=1), with
// no test-runner context: 0 dials, 0 DNS lookups, and no COSTS.jsonl.
// ===========================================================================

const QUOTE = 'The act of measurement in quantum physics shapes the outcome that every careful observer records in the laboratory.';

interface ChainFixture {
  researchRoot: string;
  paperRoot: string;
}

/**
 * Two roots: one with only INTAKE.md for `research` (it rewrites the library
 * and CITATIONS.bib), and one seeded paper whose single section cites `citekey`
 * (inline and under a block quote Pass 3 extracts) for add → verify → compile
 * → done.
 */
function seedChain(
  entry: { citekey: string; doi: string; title: string; author: string; year: number },
): ChainFixture {
  const researchRoot = freshRoot();
  mkdirSync(join(researchRoot, '.paper'), { recursive: true });
  writeFileSync(
    join(researchRoot, '.paper', 'INTAKE.md'),
    '---\ntopic: attention mechanisms in neural networks\ndiscipline: computer science\n---\n# Intake\n\nA short survey.\n',
  );

  const paperRoot = freshRoot();
  writeState(paperRoot, [{ n: 1, slug: 'intro' }]);
  const pDir = join(paperRoot, '.paper');
  mkdirSync(join(pDir, 'sections', '01-intro'), { recursive: true });
  writeFileSync(
    join(pDir, 'INTAKE.md'),
    '---\ntopic: quantum measurement\ndiscipline: physics\n---\n# Intake\n\nA short essay.\n',
  );
  writeFileSync(
    join(pDir, 'OUTLINE.md'),
    [
      '# Outline',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      `| 1 | intro | Introduction | | 300 | ${entry.citekey} |`,
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(pDir, 'CITATIONS.bib'),
    `@article{${entry.citekey},\n  title = {${entry.title}},\n  author = {${entry.author}},\n  doi = {${entry.doi}},\n  year = {${entry.year}}\n}\n`,
  );
  writeFileSync(
    join(pDir, 'sections', '01-intro', 'PLAN.md'),
    ['---', 'section: 1', 'slug: intro', 'title: Introduction', 'depends_on: []', `assigned_sources: [${entry.citekey}]`, 'status: written', '---', '', '# Introduction', ''].join('\n'),
  );
  writeFileSync(
    join(pDir, 'sections', '01-intro', 'DRAFT.md'),
    [
      '# Introduction',
      '',
      `Measurement remains a central question in the physics literature [@${entry.citekey}].`,
      '',
      `> ${QUOTE}`,
      '',
      `[@${entry.citekey}]`,
      '',
    ].join('\n'),
  );
  return { researchRoot, paperRoot };
}

interface VerbRun { verb: string; res: SpawnResult; }

function runChain(fx: ChainFixture, modeArgs: string[], modeEnv: Record<string, string>, addDoi: string): VerbRun[] {
  const keys = { ANTHROPIC_API_KEY: 'sk-fake-flags-h3', GPTZERO_API_KEY: 'gz-fake-flags-h3' };
  const env = { ...keys, ...modeEnv };
  const out: VerbRun[] = [];
  const run = (verb: string, args: string[], cwd: string): void => {
    out.push({ verb, res: spawnCli([...modeArgs, ...args], cwd, env) });
  };
  run('research', ['research', '--yolo'], fx.researchRoot);
  run('add', ['add', addDoi, '--yolo'], fx.paperRoot);
  run('verify', ['verify', '1', '--slug', 'intro', '--yolo'], fx.paperRoot);
  run('compile', ['compile', '--yolo'], fx.paperRoot);
  run('done', ['done', '--yolo', '--format', 'md'], fx.paperRoot);
  return out;
}

function assertZeroEgress(runs: VerbRun[], label: string): void {
  for (const { verb, res } of runs) {
    const where = `${label} ${verb} (exit ${res.status}); stderr=${res.stderr.slice(0, 1200)}`;
    assert.ok(!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(res.stderr), `the preload + CLI must load: ${where}`);
    const dials = res.dials.filter((e) => e.kind === 'connect');
    const lookups = res.dials.filter((e) => e.kind === 'dns');
    assert.deepEqual(dials, [], `H3: ${label} ${verb} must open ZERO sockets: ${where}`);
    assert.deepEqual(lookups, [], `H3: ${label} ${verb} must make ZERO DNS lookups: ${where}`);
    assert.ok(!/ECONNREFUSED|ENOTFOUND|fetch failed|dial-recorder/.test(res.stderr), `H3: no refused dial surfaced: ${where}`);
  }
}

test('H3 / RUN-04: --dry-run research, add, verify (incl. Pass 3), compile and done open ZERO sockets (dial recorder)',
  { skip: !flagsWired }, () => {
    // An article-kind synthetic source (kindOf('00…') === 'article'): its
    // reserved DOI, title and author pass the Pass-1 AND-gate under --dry-run.
    const synthetic = syntheticSource('00c0ffee');
    const fx = seedChain({
      citekey: 'dryrunsrc2020',
      doi: synthetic.doi ?? '',
      title: synthetic.title,
      author: synthetic.authors[0] ?? '',
      year: synthetic.year ?? 2020,
    });
    // GRND-19: a dry run over these papers works in their .paper-dry-run/
    // workspaces (seeded from .paper/) and never writes .paper/.
    const fingerprint = (root: string): string => JSON.stringify([...snapshotTree(join(root, '.paper'))]);
    const before = [fx.researchRoot, fx.paperRoot].map(fingerprint);
    const runs = runChain(fx, ['--dry-run'], {}, '10.1038/nphys1170');
    assertZeroEgress(runs, '--dry-run');
    assert.deepEqual([fx.researchRoot, fx.paperRoot].map(fingerprint), before, 'no dry run wrote .paper/');

    const byVerb = new Map(runs.map((r) => [r.verb, r.res]));
    // The runs are real, not vacuous refusals.
    for (const { verb, res } of runs) {
      assert.match(res.stderr, /OFFLINE MODE \(reason: --dry-run\)/, `--dry-run ${verb} discloses the mode`);
      assert.ok(!res.dials.some((e) => e.kind === 'read'), `--dry-run ${verb} never reads a cassette (RUN-27)`);
    }
    assert.equal(byVerb.get('research')?.status, 0, `research: ${byVerb.get('research')?.stderr}`);
    const library = readFileSync(join(fx.researchRoot, '.paper-dry-run', 'LIBRARY.json'), 'utf8');
    assert.ok(/10\.0000\/pensmith-dryrun\./.test(library), 'dry-run research writes synthetic sources (in the workspace)');
    assert.match(byVerb.get('add')?.stderr ?? '', /unavailable \(dry-run\)/, 'add reports unavailable (dry-run)');
    const verification = readFileSync(join(fx.paperRoot, '.paper-dry-run', 'sections', '01-intro', 'VERIFICATION.md'), 'utf8');
    assert.match(verification, /text unavailable \(dry-run\)/, 'Pass 3 ran on the quote without a request');
    assert.match(verification, /- dryrunsrc2020: \*\*OK\*\* .*dry-run synthetic source/, 'Pass 1 accepted the synthetic source under --dry-run');
    assert.equal(byVerb.get('compile')?.status, 0, `compile: ${byVerb.get('compile')?.stderr}`);
    assert.equal(byVerb.get('done')?.status, 0, `done: ${byVerb.get('done')?.stderr}`);
    assert.ok(existsSync(join(fx.paperRoot, '.paper-dry-run', 'export', 'DRAFT.dry-run.md')), 'the dry-run export is named DRAFT.dry-run.*');
    assert.ok(!existsSync(join(fx.paperRoot, '.paper-dry-run', 'COSTS.jsonl')), 'no LLM cost was recorded');
    assert.ok(!existsSync(join(fx.paperRoot, '.paper', 'COSTS.jsonl')), 'no LLM cost was recorded');
  });

test('H3 / RUN-04: PENSMITH_OFFLINE=1 research, add, verify (incl. Pass 3), compile and done open ZERO sockets (dial recorder)',
  { skip: !flagsWired }, () => {
    // The recorded Crossref work (tests/fixtures/cassettes/crossref/works-nphys1170.json).
    const fx = seedChain({
      citekey: 'aspelmeyer2009',
      doi: '10.1038/nphys1170',
      title: 'Measured measurement',
      author: 'Aspelmeyer, Markus',
      year: 2009,
    });
    // add: an unrecorded DOI (RUN-03 acceptance) — refused, nothing added.
    const runs = runChain(fx, [], { PENSMITH_OFFLINE: '1', PENSMITH_NO_LLM: '1' }, '10.1093/nar/gkab1112');
    assertZeroEgress(runs, 'PENSMITH_OFFLINE=1');

    const byVerb = new Map(runs.map((r) => [r.verb, r.res]));
    for (const { verb, res } of runs) {
      assert.match(res.stderr, /OFFLINE MODE \(reason: PENSMITH_OFFLINE=1\)/, `offline ${verb} discloses the mode`);
    }
    assert.ok(byVerb.get('research')?.dials.some((e) => e.kind === 'read'), 'offline research replays recorded fixtures');
    assert.notEqual(byVerb.get('add')?.status, 0, 'offline add refuses with a non-zero exit');
    assert.match(byVerb.get('add')?.stderr ?? '', /DOI verification unavailable \(offline\)/);
    const verification = readFileSync(join(fx.paperRoot, '.paper', 'sections', '01-intro', 'VERIFICATION.md'), 'utf8');
    assert.match(verification, /- aspelmeyer2009: \*\*OK\*\* .*D-11 AND-gate passed/, 'Pass 1 re-fetched the recorded Crossref work');
    assert.ok(!readFileSync(join(fx.paperRoot, '.paper', 'CITATIONS.bib'), 'utf8').includes('gkab1112'), 'the refused DOI was not added');
    assert.match(verification, /text unavailable \(offline\)/, 'Pass 3 ran on the quote without a request');
    assert.equal(byVerb.get('compile')?.status, 0, `compile: ${byVerb.get('compile')?.stderr}`);
    const done = byVerb.get('done');
    assert.equal(done?.status, 0, `done: ${done?.stderr}`);
    assert.match(`${done?.stdout ?? ''}${done?.stderr ?? ''}`, /score unavailable \(offline\)/, 'GPTZero (key present) sends nothing offline');
    assert.match(`${done?.stdout ?? ''}${done?.stderr ?? ''}`, /plagiarism check skipped \(offline\)/, 'no DDG query offline');
    assert.ok(!existsSync(join(fx.paperRoot, '.paper', 'COSTS.jsonl')), 'no LLM cost was recorded');
  });
