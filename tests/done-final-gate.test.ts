// tests/done-final-gate.test.ts — VRFY-26 (D-20-24): done gates a humanized
// FINAL.md on its OWN exact bytes through the ONE gate core. The humanizer
// (the Tier-1 Task transport; here the exporter's test seam) returns the
// compiled draft plus one citation form it must never introduce — an
// unassigned or fabricated key in any Pandoc form, author-date prose, a
// footnote or a typed reference list — and done refuses: exit 4, nothing
// exported, nothing under sections/ touched. A humanized FINAL.md that keeps
// the citations exports. Sources offline (recorded fixtures), in process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { writeState, writeOutline, writePlan, sectionDirOf } from './helpers/paper-cli-harness.js';
import { mtimes } from './helpers/gate-paper.js';
import { LECUN_BIB } from './helpers/gate-paper.js';
import { __setTaskRunnerForTest } from '../bin/lib/exporter.js';
import { EXIT_BLOCKED } from '../bin/lib/exit-codes.js';

/** Run `fn` with the verb's own stdout lines captured (the TAP stream passes through). */
async function quiet<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const s = String(chunk);
    if (/^pensmith|^\s+- /.test(s)) {
      lines.push(s);
      return true;
    }
    return orig(chunk);
  }) as typeof process.stdout.write;
  try {
    return { result: await fn(), out: lines.join('') };
  } finally {
    process.stdout.write = orig;
  }
}

/** What a humanizer must never add to the text it improves (VRFY-10, VRFY-26). */
const ADDED: ReadonlyArray<readonly [string, string]> = [
  ['a fabricated key', 'A later survey agrees [@Fake2021].'],
  ['a fabricated key with a locator', 'A later survey agrees [@fake2021, p. 4].'],
  ['a narrative key', 'As @fake2019 argues, the effect is large.'],
  ['an author-suppressed key', 'The effect is large [-@fake2019].'],
  ['author-date prose', 'The effect is large (Nguyen & Patel, 2019).'],
  ['a footnote', 'The effect is large.[^1]\n\n[^1]: Nguyen, T. (2019). Shade and heat. Urban Climate.'],
  ['a typed reference list', 'The effect is large.\n\n### References\n\n- Nguyen, T. (2019). Shade and heat. Urban Climate.'],
];

test('VRFY-26 (in process): a humanized FINAL.md is gated on its own bytes — every added citation form is refused (exit 4, nothing exported, sections/ untouched); one that keeps the citations exports', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1', PENSMITH_CONTACT_EMAIL: undefined } }, async (sb) => {
    writeState(sb.root, [{ n: 1, slug: 'intro' }]);
    writeOutline(sb.root, [{ n: 1, slug: 'intro', sources: ['lecun2015'] }]);
    writeFileSync(join(sb.paper, 'CITATIONS.bib'), LECUN_BIB);
    writePlan(sb.root, 1, 'intro', { status: 'written', assigned_sources: '[lecun2015]' });
    writeFileSync(join(sectionDirOf(sb.root, 1, 'intro'), 'DRAFT.md'), '# Intro\n\nDeep learning reshaped computer vision and speech recognition [@lecun2015].\n');
    const { verifySection } = await import('../bin/cli/verify.js');
    const { compileCommand } = await import('../bin/cli/compile.js');
    const { doneCommand } = await import('../bin/cli/done.js');
    const v = await quiet(() => verifySection(1, 'intro', null));
    assert.equal(v.result.status, 'verified', v.out);
    const c = await quiet(() => compileCommand.run!({ args: { yolo: true } } as never));
    assert.notEqual((c.result as { refused?: boolean }).refused, true, c.out);
    const compiled = readFileSync(join(sb.paper, 'DRAFT.md'), 'utf8');
    const sections = mtimes(join(sb.paper, 'sections'));

    try {
      for (const [what, added] of ADDED) {
        __setTaskRunnerForTest(async () => ({ output: `${compiled.trimEnd()}\n\n${added}\n` }));
        const r = await quiet(() => doneCommand.run!({ args: { yolo: true, raw: false, format: 'md' } } as never));
        const res = r.result as { ok?: boolean; exitCode?: number };
        assert.equal(res.ok, false, `${what}: ${r.out}`);
        assert.equal(res.exitCode, EXIT_BLOCKED, `${what}: ${r.out}`);
        assert.match(r.out, /GATE-04 BLOCKED — FINAL\.md failed re-verification/, what);
        assert.ok(!existsSync(join(sb.paper, 'export')), `${what}: nothing exported`);
        assert.deepEqual(mtimes(join(sb.paper, 'sections')), sections, `${what}: nothing under sections/ changed`);
      }
      // A humanizer that only improves the prose: the citation is kept, the export happens.
      __setTaskRunnerForTest(async () => ({ output: compiled.replace('reshaped', 'transformed') }));
      const ok = await quiet(() => doneCommand.run!({ args: { yolo: true, raw: false, format: 'md' } } as never));
      assert.equal((ok.result as { ok?: boolean }).ok, true, ok.out);
      assert.ok(existsSync(join(sb.paper, 'export', 'FINAL.md')) || existsSync(join(sb.paper, 'export', 'DRAFT.md')), ok.out);
      assert.match(readFileSync(join(sb.paper, 'VERIFICATION.md'), 'utf8'), /\.paper\/FINAL\.md/, 'the paper-level record names the bytes it judged');
    } finally {
      __setTaskRunnerForTest(null);
    }
  });
});
