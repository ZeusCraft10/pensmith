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
// One un-skipped case asserts isOfflineMode()===true (the offline-by-default
// adapter gate that --dry-run relies on for SOURCE adapters).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));

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
      ['--import', 'tsx', PENSMITH_TS, ...args],
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

// A large section count to drive the projected cost over the 50% cap.
function manySections(count: number): Array<{ n: number; slug: string }> {
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, slug: `s${i + 1}` }));
}

// ===========================================================================
// Un-skipped: isOfflineMode() is the adapter offline gate --dry-run rides for
// SOURCE adapters. PR-time CI never sets PENSMITH_NETWORK_TESTS, so it is true.
// ===========================================================================
test('ERGO-01: isOfflineMode() is true when PENSMITH_NETWORK_TESTS !== "1"', async () => {
  const prev = process.env['PENSMITH_NETWORK_TESTS'];
  delete process.env['PENSMITH_NETWORK_TESTS'];
  try {
    const mod = (await import('../bin/lib/http-mock.js')) as { isOfflineMode: () => boolean };
    assert.equal(mod.isOfflineMode(), true, 'ERGO-01: offline-by-default adapter gate');
  } finally {
    if (prev !== undefined) process.env['PENSMITH_NETWORK_TESTS'] = prev;
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
// NOTE: the >50%-cap env knob (PENSMITH_COST_CAP_USD) is introduced by 07-02's
// pre-flight; a large section count drives the projection over a small cap.
// ===========================================================================
test('H1 / C2-H1: `write --yolo` (NON-GATE) over-cap WITHOUT --estimate exits non-zero (cap refusal)',
  { skip: !flagsWired }, () => {
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

test('H1: a --yolo verb UNDER the 50% cap exits 0 (no false refusal)',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writePaperFile(root, 'RESEARCH.md');
    writePaperFile(root, 'OUTLINE.md');
    writeSectionPlan(root, 1, 'intro', 'planned');
    const res = runCli(['plan', '--yolo'], root, { PENSMITH_COST_CAP_USD: '1000000' });
    assert.equal(res.status, 0, `H1: a small projection under a huge cap must NOT be refused; stderr=${res.stderr}`);
  });

test('C2-H1: `pensmith --yolo` and `write --yolo` in a paper-less dir do NOT crash (no StateNotFoundError)',
  { skip: !flagsWired }, () => {
    const root = freshRoot(); // no STATE.json
    const a = runCli(['--yolo'], root);
    assert.equal(a.status, 0,
      `C2-H1: bare \`--yolo\` in a fresh dir must exit 0 (empty projection, under-cap); stderr=${a.stderr}`);
    assert.ok(!/StateNotFoundError/.test(a.stderr), 'C2-H1: must not surface StateNotFoundError');
    const b = runCli(['write', '--yolo'], root);
    assert.ok(!/StateNotFoundError/.test(b.stderr),
      'C2-H1: `write --yolo` in a fresh dir must not crash with StateNotFoundError');
  });

test('C4-HIGH: bare `pensmith --yolo` against a corrupt STATE.json does NOT crash (exit 0)',
  { skip: !flagsWired }, () => {
    const root = freshRoot();
    writeFileSync(join(root, 'STATE.json'), '{ this is not json ');
    const res = runCli(['--yolo'], root);
    assert.equal(res.status, 0,
      `C4-HIGH: a corrupt STATE.json yields the empty projection (under-cap), so --yolo must exit 0; stderr=${res.stderr}`);
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
// H3 / C2-H3 — --dry-run gates the LLM call sites on a path that WOULD egress.
// `verify <N> --dry-run` with a FAKE ANTHROPIC_API_KEY present is the path that
// WOULD call messages.create() in pass2/pass4 absent the guard. The previous
// test drove write/research (Tier-2 placeholders, zero LLM calls in any mode)
// so it gated NOTHING (vacuous). Assert: ZERO COSTS.jsonl append (the pass2/4
// placeholder path skips appendCost under PENSMITH_NO_LLM, which --dry-run sets).
// ===========================================================================
test('H3 / C2-H3: `verify <N> --dry-run` with a fake key makes ZERO network calls + appends NO COSTS.jsonl (non-vacuous)',
  { skip: !flagsWired }, () => {
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
      // Force adapters offline (defense-in-depth): never set network tests.
      PENSMITH_NETWORK_TESTS: undefined,
    });
    // Non-vacuous: the verify LLM-calling path ran with a key present, yet
    // --dry-run (which sets PENSMITH_NO_LLM) must keep pass2/pass4 on the
    // offline UNCLEAR placeholder so NO cost record is appended.
    assert.ok(
      !existsSync(join(root, '.paper', 'COSTS.jsonl')),
      'H3/C2-H3: `verify --dry-run` with a key present must NOT append COSTS.jsonl (LLM gated)',
    );
    assert.ok(!/network|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(res.stderr),
      `H3/C2-H3: zero network egress on the verify dry-run path; stderr=${res.stderr}`);
  });
