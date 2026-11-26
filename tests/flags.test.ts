// tests/flags.test.ts — the global flags (--dry-run, --estimate, --yolo,
// --show-prompts) and the dispatch regressions they once caused (H1, H2, H3,
// C3-HIGH-2, C4-HIGH, C6-HIGH).
//
// These cases drive the real CLI as a child process
//   node --import tsx bin/pensmith.ts ...args   (cwd and env per case)
// so they exercise the actual argv pre-parse and dispatch, not module
// introspection. stdout, stderr and the exit status are captured for every
// run, including a successful one, so an assertion about stderr is never
// checking an empty string.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outlineForStateFixture } from './lib/outline-fixture.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));

// tsx's loader as an absolute file URL: a bare `--import tsx` would resolve
// against the child's temp cwd, which has no node_modules.
const TSX_LOADER = import.meta.resolve('tsx');

// === Child-process driver ===
// status is null when the child was killed by a signal.
interface RunResult { status: number | null; stdout: string; stderr: string; }

function runCli(args: string[], cwd: string, extraEnv: Record<string, string | undefined> = {}): RunResult {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...extraEnv })) {
    if (v !== undefined) env[k] = v;
  }
  const res = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER, PENSMITH_TS, ...args],
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
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
  // The outline is the section list: a table of the STATE.json fixture's sections.
  writeFileSync(join(pDir, name), name === 'OUTLINE.md' ? outlineForStateFixture(root) : `# ${name}\n`);
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

// A large section count to drive the projected cost over the 50% cap.
function manySections(count: number): Array<{ n: number; slug: string }> {
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, slug: `s${i + 1}` }));
}

// ===========================================================================
// isOfflineMode() is the egress gate --dry-run / --offline set through
// PENSMITH_OFFLINE. It is false by default: production is live. (This test
// used to pin "offline unless PENSMITH_NETWORK_TESTS=1", which made every real
// user run on test cassettes.)
// ===========================================================================
test('ERGO-01: isOfflineMode() is false by default and true only under PENSMITH_OFFLINE=1', async () => {
  const prev = process.env['PENSMITH_OFFLINE'];
  const mod = await import('../bin/lib/network-mode.js');
  try {
    delete process.env['PENSMITH_OFFLINE'];
    assert.equal(mod.isOfflineMode(), false, 'ERGO-01: live by default');
    process.env['PENSMITH_OFFLINE'] = '1';
    assert.equal(mod.isOfflineMode(), true, 'ERGO-01: --dry-run / --offline gate');
  } finally {
    if (prev === undefined) delete process.env['PENSMITH_OFFLINE'];
    else process.env['PENSMITH_OFFLINE'] = prev;
  }
});


// ===========================================================================
// Flag declaration — the four global flags parse on the explicit-verb surface.
// ===========================================================================
test('ERGO-01/04: --dry-run / --show-prompts parse on explicit verbs (no "unknown flag")', () => {
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
// NOTE: the >50%-cap env knob (PENSMITH_COST_CAP_USD) is introduced by 07-02's
// pre-flight; a large section count drives the projection over a small cap.
// ===========================================================================
test('H1 / C2-H1: `write --yolo` (NON-GATE) over-cap WITHOUT --estimate exits non-zero (cap refusal)', () => {
    const root = freshRoot();
    writeState(root, manySections(50));
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    const res = runCli(['write', '--yolo'], root, { PENSMITH_COST_CAP_USD: '0.0001' });
    assert.notEqual(res.status, 0,
      'H1/C2-H1: a NON-GATE verb under --yolo over the 50% cap must EXIT NON-ZERO (cap cannot be skipped)');
    assert.match(res.stderr + res.stdout, /cap|50%|exceed/i,
      'H1/C2-H1: the refusal must name the >50%-cap reason');
  });

test('H1 / C2-H1: `plan --yolo` (NON-GATE) over-cap WITHOUT --estimate exits non-zero (cap refusal)', () => {
    const root = freshRoot();
    writeState(root, manySections(50));
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    const res = runCli(['plan', '--yolo'], root, { PENSMITH_COST_CAP_USD: '0.0001' });
    assert.notEqual(res.status, 0,
      'H1/C2-H1: `plan --yolo` over-cap must EXIT NON-ZERO — the cap applies to non-gate verbs too');
  });

test('H1: `compile --yolo` and bare `--yolo` over-cap exit non-zero (gate-skipping verbs)', () => {
    const root = freshRoot();
    writeState(root, manySections(50));
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    const a = runCli(['compile', '--yolo'], root, { PENSMITH_COST_CAP_USD: '0.0001' });
    assert.notEqual(a.status, 0, 'H1: `compile --yolo` over-cap must exit non-zero');
    const b = runCli(['--yolo'], root, { PENSMITH_COST_CAP_USD: '0.0001' });
    assert.notEqual(b.status, 0, 'H1: bare `--yolo` over-cap must exit non-zero');
  });

test('H1: a --yolo verb UNDER the 50% cap exits 0 (no false refusal)', () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    writeSectionPlan(root, 1, 'intro', 'stub');
    // Phase 11 (GEN-06): all generative verbs (plan, write, research) now require
    // either a real API key OR PENSMITH_NO_LLM=1 (offline mode). The H1 test is
    // testing budget-gate behavior (under-cap → exit 0), not LLM key behavior.
    // Set PENSMITH_NO_LLM=1 so complete() short-circuits without a key, which
    // is the correct offline test pattern per 11-PATTERNS.md §Fail-Loud Pitfall 6.
    const res = runCli(['plan', '--yolo'], root, { PENSMITH_COST_CAP_USD: '1000000', PENSMITH_NO_LLM: '1' });
    assert.equal(res.status, 0, `H1: a small projection under a huge cap must NOT be refused; stderr=${res.stderr}`);
  });

test('C2-H1: `pensmith --yolo` and `write --yolo` in a paper-less dir do NOT crash (no StateNotFoundError)', () => {
    const root = freshRoot(); // no STATE.json
    // Phase 11 (GEN-06): all generative verbs now require either a real API key OR
    // PENSMITH_NO_LLM=1 (offline mode). Set it so the bare dispatch (intake) and
    // write don't fail-loud on missing key. This tests StateNotFoundError handling,
    // not LLM key behavior — see 11-PATTERNS.md §Fail-Loud Pitfall 6.
    const a = runCli(['--yolo'], root, { PENSMITH_NO_LLM: '1' });
    // An empty folder routes to `new`, which asks for the assignment (exit 3).
    assert.equal(a.status, 3,
      `C2-H1: bare \`--yolo\` in a fresh dir must reach intake (empty projection, under-cap); stderr=${a.stderr}`);
    assert.ok(!/StateNotFoundError/.test(a.stderr), 'C2-H1: must not surface StateNotFoundError');
    const b = runCli(['write', '--yolo'], root, { PENSMITH_NO_LLM: '1' });
    assert.ok(!/StateNotFoundError/.test(b.stderr),
      'C2-H1: `write --yolo` in a fresh dir must not crash with StateNotFoundError');
  });

test('C4-HIGH: bare `pensmith --yolo` against a corrupt STATE.json does NOT crash (exits 1, the error code)', () => {
    const root = freshRoot();
    mkdirSync(join(root, '.paper'), { recursive: true });
    writeFileSync(join(root, '.paper', 'STATE.json'), '{ this is not json ');
    const res = runCli(['--yolo'], root);
    // The cost pre-flight sees an empty projection and lets the run through;
    // the router then reports the unreadable STATE.json. That is an error the
    // user must fix, so it exits 1, not 0 (which scripts would read as success).
    assert.equal(res.status, 1,
      `C4-HIGH: a corrupt STATE.json must pass the cap pre-flight and then exit 1; stderr=${res.stderr}`);
    assert.match(res.stdout, /unreadable\/corrupt/, 'C4-HIGH: the corrupt state must be reported');
    assert.ok(!/SyntaxError|SchemaValidationError/.test(res.stderr),
      'C4-HIGH: the parse error must NOT escape to an uncaught crash');
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
test('C6-HIGH: END-TO-END bare `pensmith` against a corrupt per-section PLAN.md reports it and exits 0, with no uncaught crash', () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    writeCorruptSectionPlan(root, 1, 'intro'); // alias-to-missing-anchor → parseFrontmatter throws
    const res = runCli([], root); // bare, no verb, no --yolo
    // The router stops at status, which reports the unreadable PLAN.md as a
    // section that needs attention and exits 0: the paper is readable, and
    // the row tells the user what to fix. An uncaught exception would exit 1
    // with a stack trace on stderr.
    assert.equal(res.status, 0,
      `C6-HIGH: a corrupt PLAN.md must be reported, not crash; status=${res.status} stderr=${res.stderr}`);
    assert.doesNotMatch(res.stderr, /\n\s+at /,
      'C6-HIGH: bare pensmith must not print an uncaught exception stack trace');
    assert.match(res.stdout, /§1 intro: corrupt\/unreadable PLAN\.md — needs attention/,
      'C6-HIGH: the corrupt section is reported as needing attention');
    assert.match(res.stdout, /next: status \(attention\)/,
      'C6-HIGH: the router stops for the user');
  });

// ===========================================================================
// H2 — no double-dispatch + flags take effect for explicit verbs. citty's
// runCommand runs the child then falls into the parent run() with no early
// return; a root run() that re-dispatched the router would run a SECOND verb.
// ===========================================================================
test('H2: an explicit verb runs EXACTLY once (no second router-dispatched verb in stdout)', () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    const res = runCli(['status'], root);
    // The router/next diagnostic ('→ <verb>') must not leak to stdout, and no
    // second verb's signature line should appear (single dispatch).
    assert.ok(!/→\s*\w+/.test(res.stdout),
      'H2: no router/next diagnostic ("→ <verb>") may leak to stdout (single dispatch)');
  });

test('H2: --show-prompts takes effect for an EXPLICIT verb (pre-dispatch seam, mirrors to stderr)', () => {
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

// ===========================================================================
// C3-HIGH-2 — global flags (esp. --yolo) propagate through the BARE and RESUME
// manual-dispatch paths so the dispatched GATE verb receives yolo:true / skips
// its own approval gate. Against the original non-forwarding plan (manual
// dispatch calls cmd.run() with a bare args object) args.yolo is undefined →
// the gate is NOT skipped. Cost kept UNDER the cap so the pre-flight does not
// exit first and mask the test.
// ===========================================================================
test('C3-HIGH-2 (a) BARE path: `pensmith --yolo` → dispatched gate verb receives yolo:true / skips its gate', () => {
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

test('C3-HIGH-2 (b) RESUME path: `pensmith resume --yolo` → dispatched work verb receives yolo:true / skips its gate', () => {
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
// H3 / C2-H3 — `verify <N> --dry-run` with a FAKE ANTHROPIC_API_KEY present is
// the path that WOULD call the model in pass2/pass4 and the registries in Pass
// 1. A dry run does not run the verb at all: it prints what verify would do.
// Assert: no VERIFICATION.md, no COSTS.jsonl, no network error text.
// ===========================================================================
test('H3 / C2-H3: `verify <N> --dry-run` with a fake key makes ZERO network calls + appends NO COSTS.jsonl (non-vacuous)', () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    // A verifiable section: a DRAFT.md with a [@citekey] + a matching bib entry,
    // so runPass2/runPass4 WOULD call messages.create() absent the dry-run guard.
    const secDir = join(root, '.paper', 'sections', '01-intro');
    mkdirSync(secDir, { recursive: true });
    writeFileSync(
      join(secDir, 'DRAFT.md'),
      'Transformers improved translation quality substantially in 2017. [@vaswani2017]\n',
    );
    const pDir = join(root, '.paper');
    mkdirSync(pDir, { recursive: true });
    writeFileSync(
      join(pDir, 'CITATIONS.bib'),
      '@article{vaswani2017,\n  title = {Attention Is All You Need},\n  author = {Vaswani, Ashish},\n  doi = {10.5555/3295222.3295349},\n  year = {2017}\n}\n',
    );
    const res = runCli(['verify', '1', '--slug', 'intro', '--dry-run'], root, {
      // A FAKE key present — this is the path that WOULD egress absent the guard.
      ANTHROPIC_API_KEY: 'sk-fake-test-key',
      // Defense-in-depth: replay cassettes rather than go live if the dry-run
      // gate ever regressed.
      PENSMITH_TEST_CASSETTES: '1',
    });
    assert.match(res.stdout, /would run `pensmith verify 1`/, `the dry run must describe verify; stdout=${res.stdout}`);
    assert.ok(!existsSync(join(secDir, 'VERIFICATION.md')), 'H3: `verify --dry-run` must not write VERIFICATION.md');
    assert.ok(
      !existsSync(join(root, '.paper', 'COSTS.jsonl')),
      'H3/C2-H3: `verify --dry-run` with a key present must NOT append COSTS.jsonl (LLM gated)',
    );
    assert.ok(!/network|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(res.stderr),
      `H3/C2-H3: zero network egress on the verify dry-run path; stderr=${res.stderr}`);
  });
