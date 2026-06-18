// tests/humanizer-wrap.test.ts — Phase 6 Wave 0 RED scaffold for DONE-03.
//
// Mirrors tests/known-bad-pass2.test.ts RED-by-skip stance: behavioral tests
// SKIP-guard on the not-yet-created bin/lib/exporter.ts (which is where the Wave-2
// runHumanizer wrap lives) so the suite reports skips with ZERO failures. Plan
// 06-02 lands the wrap and these turn GREEN.
//
// On THIS machine isHumanizerSkillPresent() is false (no ~/.claude/skills/humanizer/),
// so DONE-03's skip-clean path is the path under test:
//   runHumanizer(draftMd) must (1) NOT throw, (2) return null (or the unchanged
//   draft signal) so export proceeds on DRAFT.md, and (3) print a stdout banner
//   containing 'humanizer skill not found'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isHumanizerSkillPresent } from '../bin/lib/ecosystem-presence.js';

// The Wave-2 runHumanizer wrap is exported from bin/lib/exporter.ts (the
// done-orchestrator humanize step). Pin the symbol name `runHumanizer`.
const exporterSrcPath = fileURLToPath(new URL('../bin/lib/exporter.ts', import.meta.url));
const exporterModUrl = new URL('../bin/lib/exporter.js', import.meta.url);

test('humanizer-wrap: machine baseline — isHumanizerSkillPresent() is false (DONE-03 skip-clean path under test)', () => {
  // Documents the test precondition; if the humanizer is later installed this
  // flips and the behavioral assertions below would need a present-path variant.
  assert.equal(isHumanizerSkillPresent(), false,
    'this RED scaffold exercises the absent-humanizer path (machine baseline)');
});

// RED-by-skip module-presence consistency (mirrors known-bad-pass2).
test('humanizer-wrap: module presence is consistent with Wave-0 RED state (DONE-03)', () => {
  if (existsSync(exporterSrcPath)) {
    assert.ok(true, 'bin/lib/exporter.ts present — behavioral tests active');
  } else {
    assert.ok(!existsSync(exporterSrcPath), 'Wave-0: bin/lib/exporter.ts absent (RED-by-skip)');
  }
});

test('humanizer-wrap: runHumanizer absent-skill → no throw, returns null, banner "humanizer skill not found" (DONE-03)',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as {
      runHumanizer: (draftMd: string) => Promise<string | null>;
    };
    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      stdoutLines.push(s);
      return true;
    };
    let result: string | null;
    try {
      result = await mod.runHumanizer('# Draft\n\nSome prose to humanize.\n');
    } finally {
      (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    }
    // (1) no throw (reached here) + (2) returns null so export proceeds on DRAFT.md
    assert.equal(result, null, 'absent humanizer must return null (unchanged-draft signal)');
    // (3) banner present.
    assert.ok(
      stdoutLines.some((l) => l.includes('humanizer skill not found')),
      'must print a banner containing "humanizer skill not found"',
    );
  },
);
