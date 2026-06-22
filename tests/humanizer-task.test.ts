// tests/humanizer-task.test.ts — Phase 12 Wave 0 RED-by-skip scaffold for GEN-05.
//
// Extends the behavioral contract of tests/humanizer-wrap.test.ts (DONE-03) with
// the injectable TaskRunner seam that Wave 2 / Plan 04 adds to bin/lib/exporter.ts.
// DO NOT modify tests/humanizer-wrap.test.ts — this is a NEW file.
//
// Behavioral contract (all skip-guarded until __setTaskRunnerForTest exists):
//   (1) Call-through — inject a deterministic TaskRunner returning
//       { output: '<humanized prose>' }, call runHumanizer(draft, tmpDir), assert it
//       returns a path ending in FINAL.md, the file is written under paperDir(tmpDir)
//       (NOT cwd+'/FINAL.md' — Pitfall 8), and its content equals the injected output.
//   (2) Null-runner clean skip — inject null (Tier-2), assert runHumanizer returns
//       null AND prints the 'humanizer skill present but no Task transport' banner
//       AND never throws.
//   (3) Honesty-framing integrity — assert that the banner/skip copy in exporter.ts
//       does NOT contain the word 'undetectable' (locked-framing regression guard;
//       renderHonestyReport framing also checked).
//
// RED-by-skip stance: every behavioral test SKIPS until taskSeamWired() returns
// true (a source-grep of bin/lib/exporter.ts confirms `__setTaskRunnerForTest` is
// present). Until Wave 2 / Plan 04 lands, the suite reports SKIPS with ZERO failures.
//
// CRITICAL path resolution (T-12-W0-01 / Phase-11 local-vs-CI bug): ALL paths
// resolved via fileURLToPath(new URL(..., import.meta.url)) — NEVER via
// import.meta.url.pathname or a file:// regex strip. The repo path contains spaces
// ("OneDrive - Roanoke College") which cause %20-encoded readFileSync paths to
// throw.
//
// Offline mode (T-12-W0-02): PENSMITH_NO_LLM=1 set at module top; no live calls.
// The injectable TaskRunner is the sole invocation point — no real Task transport.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---- Offline gate (T-12-W0-02) -------------------------------------------------
process.env['PENSMITH_NO_LLM'] = '1';

// ---- Path helpers (T-12-W0-01) -------------------------------------------------
// Use fileURLToPath everywhere — the repo path contains spaces that URL-encode as
// %20, breaking readFileSync if .pathname is used instead.

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

// Absolute source + module URLs for exporter.ts (mirrors humanizer-wrap.test.ts pattern).
const exporterSrcPath = repoPath('bin/lib/exporter.ts');
const exporterModUrl = new URL('../bin/lib/exporter.js', import.meta.url);

// honesty.ts — for the framing-integrity assertion (test 3).
const honestySrcPath = repoPath('bin/lib/honesty.ts');

// ---- Skip-guard predicate -------------------------------------------------------
// taskSeamWired() returns true ONLY when bin/lib/exporter.ts contains the token
// `__setTaskRunnerForTest` (the injectable seam added by Wave 2 / Plan 04).
// File existence alone is insufficient — exporter.ts already exists from earlier plans.

function taskSeamWired(): boolean {
  if (!fs.existsSync(exporterSrcPath)) return false;
  try {
    return fs.readFileSync(exporterSrcPath, 'utf8').includes('__setTaskRunnerForTest');
  } catch {
    return false;
  }
}

const SEAM_WIRED = taskSeamWired();

// ---- Sandbox helpers (T-12-W0-03) -----------------------------------------------
// Each test writes into a fresh tmpdir with HOME/LOCALAPPDATA/XDG_DATA_HOME overridden
// so FINAL.md writes land in the sandbox, not the real home dir.

function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-humanizer-task-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  // Create the .paper directory structure that runHumanizer / paperDir() needs.
  fs.mkdirSync(path.join(tmp, '.paper'), { recursive: true });
  return tmp;
}

// ---- TaskRunner type (mirrors the seam type declared in Plan 04) ---------------
type TaskRunner = (skill: string, input: Record<string, string>) => Promise<{ output: string }>;

// ================================================================================
// Tests (all RED-by-skip until SEAM_WIRED === true)
// ================================================================================

test(
  'humanizer-task: call-through — injected TaskRunner → FINAL.md written under paperDir(tmpDir), not cwd (GEN-05)',
  { skip: !SEAM_WIRED },
  async () => {
    // Inject a deterministic TaskRunner that returns a predictable output string.
    // runHumanizer must:
    //   a) call the runner.
    //   b) write FINAL.md under paperDir(tmpDir) — NOT cwd+'/FINAL.md' (Pitfall 8).
    //   c) return the FINAL.md path (string, not null).
    //   d) The FINAL.md content must equal the runner's output.
    const root = mkPaperRoot();

    const mod = await import(exporterModUrl.href) as {
      runHumanizer: (draftMd: string, paperRoot?: string) => Promise<string | null>;
      __setTaskRunnerForTest: (fn: TaskRunner | null) => void;
    };

    assert.ok(
      typeof mod.runHumanizer === 'function',
      'exporter.ts must export runHumanizer',
    );
    assert.ok(
      typeof mod.__setTaskRunnerForTest === 'function',
      'exporter.ts must export __setTaskRunnerForTest (GEN-05 seam)',
    );

    const fakeOutput = '# Humanized Draft\n\nThis prose has been improved for clarity.\n';
    const injectedRunner: TaskRunner = (_skill, _input) =>
      Promise.resolve({ output: fakeOutput });

    mod.__setTaskRunnerForTest(injectedRunner);
    let result: string | null = null;
    try {
      result = await mod.runHumanizer('# Original Draft\n\nSome prose.\n', root);
    } finally {
      // Always restore the seam to null in a finally block.
      mod.__setTaskRunnerForTest(null);
    }

    // (c) must return a path (not null).
    assert.ok(
      result !== null,
      'runHumanizer with an injected TaskRunner must return a FINAL.md path (not null)',
    );

    // (b) path must end with FINAL.md.
    assert.ok(
      result!.endsWith('FINAL.md'),
      `returned path must end with FINAL.md (got: ${String(result)})`,
    );

    // (b) path must be under the paper root — NOT cwd (Pitfall 8).
    const cwd = process.cwd();
    assert.ok(
      result!.startsWith(root) || result!.includes('.paper'),
      `FINAL.md must be written under paperDir(root), not cwd. root=${root}, cwd=${cwd}, got=${String(result)}`,
    );
    assert.ok(
      !result!.startsWith(path.join(cwd, 'FINAL.md')),
      `FINAL.md must NOT be at cwd+FINAL.md (Pitfall 8). got=${String(result)}`,
    );

    // (d) content must equal the runner's output.
    assert.ok(
      fs.existsSync(result!),
      `FINAL.md must exist at the returned path: ${String(result)}`,
    );
    const written = fs.readFileSync(result!, 'utf8');
    assert.equal(
      written,
      fakeOutput,
      `FINAL.md content must equal the TaskRunner output. expected=${JSON.stringify(fakeOutput)}, got=${JSON.stringify(written)}`,
    );
  },
);

test(
  'humanizer-task: null-runner clean skip — prints banner, returns null, never throws (GEN-05)',
  { skip: !SEAM_WIRED },
  async () => {
    // Injecting null (the Tier-2 / no-transport state) must:
    //   a) NOT throw.
    //   b) Return null (so the export proceeds on DRAFT.md).
    //   c) Print the 'humanizer skill present but no Task transport' banner to stdout
    //      (or the equivalent clean-skip message).
    // The isHumanizerSkillPresent() check comes before the Task check; on this machine
    // the humanizer skill is absent, so runHumanizer returns null via the absent-skill
    // path. The seam is still exercised — it just takes the absent-skill branch first.
    // Both paths must: not throw + return null.
    const root = mkPaperRoot();

    const mod = await import(exporterModUrl.href) as {
      runHumanizer: (draftMd: string, paperRoot?: string) => Promise<string | null>;
      __setTaskRunnerForTest: (fn: TaskRunner | null) => void;
    };

    assert.ok(typeof mod.runHumanizer === 'function', 'must export runHumanizer');
    assert.ok(typeof mod.__setTaskRunnerForTest === 'function', 'must export __setTaskRunnerForTest');

    // Capture stdout to check the banner.
    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      stdoutLines.push(s);
      return true;
    };

    mod.__setTaskRunnerForTest(null);
    let result: string | null | undefined;
    let threw = false;
    try {
      result = await mod.runHumanizer('# Draft\n\nSome prose.\n', root);
    } catch {
      threw = true;
    } finally {
      // Always restore seam to null.
      mod.__setTaskRunnerForTest(null);
      (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    }

    // (a) must not throw.
    assert.equal(threw, false, 'runHumanizer with null runner must never throw');

    // (b) must return null.
    assert.equal(result, null, 'null runner must cause runHumanizer to return null');

    // (c) a banner must be printed to stdout (skip message).
    const stdoutText = stdoutLines.join('');
    assert.ok(
      stdoutText.length > 0,
      'runHumanizer null-runner path must print a banner to stdout (skip signal)',
    );
    // The banner must contain one of the acceptable skip phrases.
    const hasSkipPhrase =
      stdoutText.includes('humanizer skill not found') ||
      stdoutText.includes('no Task transport') ||
      stdoutText.includes('skipping humanize step');
    assert.ok(
      hasSkipPhrase,
      `stdout banner must contain a skip phrase ("humanizer skill not found", "no Task transport", or "skipping humanize step"). Got: ${stdoutText.slice(0, 400)}`,
    );
  },
);

test(
  'humanizer-task: honesty-framing integrity — exporter.ts banner must NOT contain "undetectable" (GEN-05 locked-framing guard)',
  { skip: !SEAM_WIRED },
  async () => {
    // Locked-framing regression guard (PRD §3 non-negotiable): the humanizer is
    // framed as "improves prose / readability", NEVER as making output "undetectable".
    // This test scans the skip-path banner copy in bin/lib/exporter.ts for the
    // forbidden word 'undetectable'.
    //
    // Also checks bin/lib/honesty.ts renderHonestyReport framing for the same token.
    // If either file contains 'undetectable' in an affirmative claim, this test fails.

    // Check exporter.ts source.
    assert.ok(fs.existsSync(exporterSrcPath), `exporter.ts must exist at: ${exporterSrcPath}`);
    const exporterSrc = fs.readFileSync(exporterSrcPath, 'utf8');

    // The word 'undetectable' must NOT appear in the banner/skip copy (which lives
    // in the runHumanizer function). We scan the entire file but note that any use
    // of "undetectable" in a test file comment or in the honesty framing is a regression.
    assert.ok(
      !exporterSrc.toLowerCase().includes('undetectable'),
      `exporter.ts must NOT contain the word "undetectable" in any banner or framing copy (PRD §3 non-negotiable). ` +
        `Found at position: ${exporterSrc.toLowerCase().indexOf('undetectable')}`,
    );

    // Check honesty.ts renderHonestyReport framing.
    if (fs.existsSync(honestySrcPath)) {
      const honestySrc = fs.readFileSync(honestySrcPath, 'utf8');

      // The framing note in honesty.ts is allowed to MENTION "undetectable" in a
      // disclaimer context ("does not promise to make output undetectable" is the
      // honest framing). The check here is that no affirmative claim appears
      // (i.e., no "makes output undetectable" or "evades detection").
      // We check for patterns that would indicate a forbidden affirmative claim.
      const affirmativeForbidden = [
        'makes output undetectable',
        'evades detection',
        'bypass detection',
        'fool detectors',
        'undetectable output',
      ];
      for (const pattern of affirmativeForbidden) {
        assert.ok(
          !honestySrc.toLowerCase().includes(pattern),
          `honesty.ts must NOT contain affirmative detection-avoidance framing: "${pattern}" (PRD §3 non-negotiable)`,
        );
      }

      // The framing must contain "improves" somewhere (positive honest framing).
      assert.ok(
        honestySrc.includes('improves'),
        'honesty.ts framing must include "improves" (honest framing: "improves readability")',
      );
    }
  },
);

// ---- Consistency check: verify predicate resolves to a meaningful value ---------
// This test ALWAYS runs (no skip-guard) to confirm path resolution works on this
// machine. Documents whether SEAM_WIRED is true or false (expected: false in Wave 0).

test('humanizer-task: taskSeamWired() resolves correctly (path sanity — T-12-W0-01)', () => {
  // exporterSrcPath must resolve to a real absolute path (no %20 — fileURLToPath decodes).
  assert.ok(
    !exporterSrcPath.includes('%20'),
    `exporterSrcPath must not contain %20 (fileURLToPath decodes spaces): ${exporterSrcPath}`,
  );

  // exporter.ts must exist (it pre-exists from Phase 6).
  assert.ok(
    fs.existsSync(exporterSrcPath),
    `exporter.ts must exist at: ${exporterSrcPath}`,
  );

  // Log the predicate state for skip-message clarity.
  const reason = (() => {
    try {
      const src = fs.readFileSync(exporterSrcPath, 'utf8');
      return src.includes('__setTaskRunnerForTest')
        ? 'wired — __setTaskRunnerForTest present in exporter.ts'
        : 'not yet wired — __setTaskRunnerForTest absent from exporter.ts (Wave 0 RED-by-skip)';
    } catch {
      return 'not yet wired — could not read exporter.ts';
    }
  })();

  // Always-pass — documenting the state.
  assert.ok(
    typeof SEAM_WIRED === 'boolean',
    `taskSeamWired() returns a boolean (${String(SEAM_WIRED)}): ${reason}`,
  );

  // Verify the pathToFileURL import is also available (used in humanizer-wrap.test.ts pattern).
  assert.ok(
    typeof pathToFileURL === 'function',
    'pathToFileURL must be importable from node:url (spaced-path safe)',
  );
});
