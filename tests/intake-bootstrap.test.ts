// tests/intake-bootstrap.test.ts — Phase 12 Wave 0 RED-by-skip scaffold for GEN-04.
//
// Behavioral contract for the intake STATE.json bootstrap:
//   (1) Running intake writes .paper/STATE.json conforming to the v2 schema with a
//       non-null paperId ($schemaVersion === 2, paperId.length >= 1, createdAt is
//       parseable as ISO-8601).
//   (2) Idempotency — running intake twice on the same paper does NOT regenerate
//       paperId (load STATE.json after run 1, run intake again, assert paperId
//       unchanged and StateAlreadyExistsError was caught, not thrown out of run()).
//   (3) WARN-skip-guard FLIP — after intake writes STATE.json, resolvePaperId
//       returns non-null so the global-library registration proceeds (assert the
//       registry entry exists / no `skipping global-library registration` WARN on
//       the second observable path).
//
// RED-by-skip stance: every behavioral test SKIPS until intakeBootstrapWired()
// returns true (a source-grep of bin/cli/intake.ts confirms `initState(` is
// present). existsSync alone is insufficient — intake.ts already exists; only the
// initState() wiring (Plan 03 / Wave 1) activates these tests.
//
// CRITICAL path resolution (T-12-W0-01 / Phase-11 local-vs-CI bug): ALL paths
// resolved via fileURLToPath(new URL(..., import.meta.url)) — NEVER via
// import.meta.url.pathname or a file:// regex strip. The repo path contains spaces
// ("OneDrive - Roanoke College") which cause %20-encoded readFileSync paths to
// throw.
//
// Offline mode (T-12-W0-02): PENSMITH_NO_LLM=1 set at module top BEFORE any
// dynamic import. HOME/LOCALAPPDATA/XDG_DATA_HOME are overridden per test
// (T-12-W0-03) so all writes land in tmpdir, not the real home dir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- Offline gate (T-12-W0-02) -------------------------------------------------
// Set BEFORE any dynamic import. PENSMITH_NETWORK_TESTS is deliberately NOT set
// → isOfflineMode() returns true → adapter cassettes fire; zero live calls.
process.env['PENSMITH_NO_LLM'] = '1';

// ---- Path helpers (T-12-W0-01) -------------------------------------------------
// Use fileURLToPath everywhere — the repo path contains spaces that URL-encode as
// %20, breaking readFileSync if .pathname is used instead.

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

const intakeSrcPath = repoPath('bin/cli/intake.ts');

// ---- Skip-guard predicate -------------------------------------------------------
// intakeBootstrapWired() returns true ONLY when bin/cli/intake.ts contains the
// token `initState(` — the exact wiring that GEN-04 (Plan 03) adds.
// existsSync alone is NOT sufficient because intake.ts already exists before Plan 03.

function intakeBootstrapWired(): boolean {
  try {
    const src = fs.readFileSync(intakeSrcPath, 'utf8');
    return src.includes('initState(');
  } catch {
    return false;
  }
}

const BOOTSTRAP_WIRED = intakeBootstrapWired();

// ---- Sandbox helpers (T-12-W0-03) -----------------------------------------------
// Each test writes into a fresh tmpdir with HOME/LOCALAPPDATA/XDG_DATA_HOME
// overridden so STATE.json + LIBRARY.json writes land in the sandbox, not the
// real home dir. Pattern mirrors tests/state.test.ts mkPaperRoot().

function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-intake-bootstrap-'));
  // Force pensmithDataDir() to resolve into tmp regardless of platform.
  // paths.ts inspects: LOCALAPPDATA (win32), HOME (darwin), XDG_DATA_HOME / HOME (POSIX).
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  // Create the .paper directory structure.
  fs.mkdirSync(path.join(tmp, '.paper'), { recursive: true });
  return tmp;
}

// ---- Fixture assignment file (avoids requiring a real file to exist) -----------
function writeFixtureAssignment(root: string): string {
  const assignPath = path.join(root, 'assignment.txt');
  fs.writeFileSync(
    assignPath,
    'Write a paper on attention mechanisms in transformer neural networks.\n',
  );
  return assignPath;
}

// ---- Module URLs (resolved after env overrides) --------------------------------
const intakeModUrl = new URL('../bin/cli/intake.js', import.meta.url);
const globalLibModUrl = new URL('../bin/lib/global-library.js', import.meta.url);

// ---- Helper: run intake.run() with a given args / cwd --------------------------
// Mirrors the runIntake helper pattern from tests/intake-pii-egress.test.ts.
// Env must be set BEFORE calling this; uses dynamic import for proper isolation.
async function runIntake(
  cwd: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; path?: string; mode?: string } | unknown> {
  const intake = await import(intakeModUrl.href) as {
    intakeCommand: {
      run: (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    };
  };

  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    const run = intake.intakeCommand.run;
    return await run({ args });
  } finally {
    process.chdir(prevCwd);
  }
}

// ================================================================================
// Tests (all RED-by-skip until BOOTSTRAP_WIRED === true)
// ================================================================================

test(
  'intake-bootstrap: intake writes .paper/STATE.json with v2 schema + non-null paperId (GEN-04)',
  { skip: !BOOTSTRAP_WIRED },
  async () => {
    // This test activates only when intake.ts has been wired with initState() (Plan 03).
    // Expected: running intake creates a .paper/STATE.json that conforms to the v2
    // schema: { $schemaVersion: 2, paperId: string (min 1), createdAt: ISO-8601 }.
    const root = mkPaperRoot();
    const assignPath = writeFixtureAssignment(root);

    // Run intake with --from (no interactive questions), --yolo (no approval gate).
    await runIntake(root, { from: assignPath, yolo: true });

    // STATE.json must exist at the paper root (stateFile(paperDir) = root/STATE.json
    // per stateFile() contract in bin/lib/state.ts).
    const statePath = path.join(root, 'STATE.json');
    assert.ok(
      fs.existsSync(statePath),
      `intake must write STATE.json at ${statePath}`,
    );

    const stateRaw = fs.readFileSync(statePath, 'utf8');
    const state = JSON.parse(stateRaw) as {
      $schemaVersion?: unknown;
      paperId?: unknown;
      createdAt?: unknown;
    };

    // v2 schema assertions.
    assert.equal(
      state.$schemaVersion,
      2,
      `STATE.json must have $schemaVersion: 2 (got ${String(state.$schemaVersion)})`,
    );
    assert.ok(
      typeof state.paperId === 'string' && state.paperId.length >= 1,
      `STATE.json paperId must be a non-empty string (got ${JSON.stringify(state.paperId)})`,
    );
    assert.ok(
      typeof state.createdAt === 'string' && !Number.isNaN(Date.parse(state.createdAt)),
      `STATE.json createdAt must be a parseable ISO-8601 string (got ${JSON.stringify(state.createdAt)})`,
    );
  },
);

test(
  'intake-bootstrap: running intake twice does NOT regenerate paperId (idempotency, GEN-04)',
  { skip: !BOOTSTRAP_WIRED },
  async () => {
    // GEN-04 idempotency contract: if intake is run twice on the same paper,
    //   a) The second run must NOT overwrite STATE.json with a new paperId.
    //   b) StateAlreadyExistsError must be caught internally (not thrown out of run()).
    //   c) run() must still return successfully (ok: true or at least not throw).
    const root = mkPaperRoot();
    const assignPath = writeFixtureAssignment(root);

    // First run: seeds STATE.json.
    await runIntake(root, { from: assignPath, yolo: true });

    const statePath = path.join(root, 'STATE.json');
    assert.ok(fs.existsSync(statePath), 'STATE.json must exist after first intake run');

    const stateAfterRun1 = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      paperId?: string;
      $schemaVersion?: number;
    };
    const paperIdRun1 = stateAfterRun1.paperId;
    assert.ok(
      typeof paperIdRun1 === 'string' && paperIdRun1.length >= 1,
      `paperId after run 1 must be a non-empty string (got ${JSON.stringify(paperIdRun1)})`,
    );

    // Second run: must NOT throw; paperId must be unchanged.
    let secondRunThrew = false;
    try {
      await runIntake(root, { from: assignPath, yolo: true });
    } catch {
      secondRunThrew = true;
    }

    assert.equal(
      secondRunThrew,
      false,
      'intake run() must not throw on second call (StateAlreadyExistsError must be caught internally)',
    );

    const stateAfterRun2 = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      paperId?: string;
    };
    assert.equal(
      stateAfterRun2.paperId,
      paperIdRun1,
      `paperId must be unchanged after second intake run: run1=${String(paperIdRun1)}, run2=${String(stateAfterRun2.paperId)}`,
    );
  },
);

test(
  'intake-bootstrap: WARN-skip-guard flip — after intake writes STATE.json, global-library registration proceeds (GEN-04)',
  { skip: !BOOTSTRAP_WIRED },
  async () => {
    // GEN-04 WARN-skip-guard flip: before initState() was wired, resolvePaperId()
    // returned null and registerPaperNonFatal emitted a WARN and skipped. After the
    // wiring: STATE.json has a valid paperId so resolvePaperId() returns non-null
    // and the registration proceeds without the WARN.
    //
    // Observable: after a successful intake run, the global-library entry for the
    // paper must exist (paperId is present and registration was NOT skipped).
    // We assert by loading the global library and checking for the entry.
    const root = mkPaperRoot();
    const assignPath = writeFixtureAssignment(root);

    // Capture stderr to detect the WARN-skip message (must NOT appear after wiring).
    const stderrLines: string[] = [];
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      stderrLines.push(s);
      return true;
    };

    try {
      await runIntake(root, { from: assignPath, yolo: true });
    } finally {
      (process.stderr as unknown as { write: typeof origStderrWrite }).write = origStderrWrite;
    }

    // The WARN-skip message must NOT appear: registration proceeded.
    const stderrText = stderrLines.join('');
    assert.ok(
      !stderrText.includes('skipping global-library registration'),
      `After initState() wiring, the WARN "skipping global-library registration" must NOT appear. ` +
        `Got stderr: ${stderrText.slice(0, 400)}`,
    );

    // The STATE.json must exist and have a valid paperId.
    const statePath = path.join(root, 'STATE.json');
    assert.ok(fs.existsSync(statePath), `STATE.json must exist at ${statePath}`);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { paperId?: string };
    assert.ok(
      typeof state.paperId === 'string' && state.paperId.length >= 1,
      `paperId must be non-empty so registration could proceed (got ${JSON.stringify(state.paperId)})`,
    );

    // Load the global library (loadPaperRegistry or equivalent) and assert
    // the paper's entry exists. Use dynamic import to avoid loading before env is set.
    // The global-library module exposes loadPaperRegistry() which returns the
    // list of registered papers. We check that the paperId appears.
    const globalLibMod = await import(globalLibModUrl.href) as {
      loadPaperRegistry?: () => Promise<Array<{ id: string }>>;
    };

    if (typeof globalLibMod.loadPaperRegistry === 'function') {
      const registry = await globalLibMod.loadPaperRegistry();
      const entry = registry.find((p) => p.id === state.paperId);
      assert.ok(
        entry !== undefined,
        `Global-library registry must contain the paperId "${String(state.paperId)}" after a successful intake run. ` +
          `Registry IDs: ${registry.map((p) => p.id).join(', ')}`,
      );
    }
    // If loadPaperRegistry is not exported, the no-WARN assertion above is the
    // primary guard (the observable fact that registration was NOT skipped).
  },
);

// ---- Consistency check: verify predicate resolves to a meaningful value ---------
// This test ALWAYS runs (no skip-guard) to confirm path resolution works on this
// machine. Documents whether BOOTSTRAP_WIRED is true or false (expected: false in
// Wave 0 since intake.ts does not yet contain initState()).

test('intake-bootstrap: intakeBootstrapWired() resolves correctly (path sanity — T-12-W0-01)', () => {
  // intakeSrcPath must resolve to a real absolute path (no %20 — fileURLToPath decodes).
  assert.ok(
    !intakeSrcPath.includes('%20'),
    `intakeSrcPath must not contain %20 (fileURLToPath decodes spaces): ${intakeSrcPath}`,
  );

  // intake.ts must exist (it pre-exists before Phase 12).
  assert.ok(
    fs.existsSync(intakeSrcPath),
    `intake.ts must exist at: ${intakeSrcPath}`,
  );

  // Log the predicate state for skip-message clarity.
  const reason = (() => {
    try {
      const src = fs.readFileSync(intakeSrcPath, 'utf8');
      return src.includes('initState(')
        ? 'wired — initState( present in intake.ts'
        : 'not yet wired — initState( absent from intake.ts (Wave 0 RED-by-skip)';
    } catch {
      return 'not yet wired — could not read intake.ts';
    }
  })();

  // Always-pass — we're just documenting the state.
  assert.ok(
    typeof BOOTSTRAP_WIRED === 'boolean',
    `intakeBootstrapWired() returns a boolean (${String(BOOTSTRAP_WIRED)}): ${reason}`,
  );
});
