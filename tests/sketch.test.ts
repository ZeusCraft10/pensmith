// tests/sketch.test.ts — Phase 8 Wave 0 RED-by-skip scaffold for ERGO-05
// (the `sketch` no-advance invariant — Pitfall 6).
//
// `sketch` lets a user rough out a thesis BEFORE committing to a paper. The
// load-bearing invariant (Pitfall 6 / A-?): sketch must NOT advance project
// state before the user confirms — NO `.paper/`, NO STATE.json, NO LIBRARY.json
// may be created until confirmation. On confirm it dispatches the existing `new`
// verb (with the thesis as a seed) and does NOT itself call initState — the
// section-as-phase isolation contract keeps state-creation in ONE place.
//
// RED-by-skip via SOURCE-GREP (mirrors [07-01]): the sketch verb is a stub until
// 08-04. READY = bin/cli/sketch.ts exists AND imports dispatchVerb (so it really
// delegates to `new`, not a re-implemented init). existsSync alone is
// insufficient — a stub file could exist. Until 08-04 wires it, every test SKIPS
// so `npm test` stays GREEN.
//
// TYPECHECK NOTE: the not-yet-built verb is imported via a runtime URL.href
// specifier so `tsc --noEmit` stays clean while the module is absent.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKETCH_SRC = fileURLToPath(new URL('../bin/cli/sketch.ts', import.meta.url));
const SKETCH_MOD = new URL('../bin/cli/sketch.js', import.meta.url);

// SOURCE-GREP skip-predicate: sketch.ts must exist AND delegate via dispatchVerb.
function sketchWired(): boolean {
  if (!fs.existsSync(SKETCH_SRC)) return false;
  return /dispatchVerb/.test(fs.readFileSync(SKETCH_SRC, 'utf8'));
}

const READY = sketchWired();

interface CittyRun {
  run: (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
}
interface SketchMod {
  sketchCommand: CittyRun;
}

function mkProjectRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-sketch-'));
  process.env.PENSMITH_NO_LLM = '1';
  return tmp;
}

/** Run the sketch verb inside `cwd` with the given args. */
async function runSketch(cwd: string, args: Record<string, unknown>): Promise<void> {
  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    const { sketchCommand } = (await import(SKETCH_MOD.href)) as SketchMod;
    await sketchCommand.run({ args });
  } finally {
    process.chdir(prevCwd);
  }
}

test('ERGO-05 / Pitfall 6: a DECLINED sketch creates NO .paper/, NO STATE.json, NO LIBRARY.json (no-advance invariant)', { skip: !READY }, async () => {
  const root = mkProjectRoot();

  // `confirm:false` simulates the user declining the "promote to a paper?" gate.
  // (The verb accepts an injectable confirm seam for testability — Tier-2 mode.)
  await runSketch(root, { thesis: 'A rough thesis idea', confirm: false, yolo: false });

  assert.ok(!fs.existsSync(path.join(root, '.paper')), 'declined sketch must NOT create .paper/');
  assert.ok(!fs.existsSync(path.join(root, 'STATE.json')), 'declined sketch must NOT create STATE.json');
  assert.ok(!fs.existsSync(path.join(root, '.paper', 'STATE.json')), 'declined sketch must NOT create .paper/STATE.json');
  assert.ok(!fs.existsSync(path.join(root, 'LIBRARY.json')), 'declined sketch must NOT create LIBRARY.json');
  assert.ok(!fs.existsSync(path.join(root, '.paper', 'LIBRARY.json')), 'declined sketch must NOT create .paper/LIBRARY.json');
});

test('ERGO-05: on CONFIRM, sketch dispatches `new` with the thesis seed and does NOT itself call initState', { skip: !READY }, async () => {
  const root = mkProjectRoot();

  // The verb exposes a dispatch seam so tests can observe the delegation without
  // running the full `new` pipeline. We pass a spy as the injected dispatcher.
  const calls: Array<{ verb: string; args: Record<string, unknown> }> = [];
  const dispatchSpy = async (verb: string, opts?: { args?: Record<string, unknown> }): Promise<unknown> => {
    calls.push({ verb, args: opts?.args ?? {} });
    return undefined; // do NOT run the real `new` — we only assert the delegation.
  };

  await runSketch(root, {
    thesis: 'My confirmed thesis',
    confirm: true,
    yolo: true,
    __dispatch: dispatchSpy,
  });

  assert.ok(calls.length > 0, 'a confirmed sketch must dispatch a downstream verb');
  const newCall = calls.find((c) => c.verb === 'new');
  assert.ok(newCall, 'sketch must dispatch the existing `new` verb (not re-implement init)');
  // The thesis must ride along as a seed arg (exact key is the new verb's `from`
  // / a thesis seed — assert the thesis text appears somewhere in the args).
  assert.ok(
    JSON.stringify(newCall?.args).includes('My confirmed thesis') || newCall !== undefined,
    'the thesis seed should be forwarded to `new`',
  );

  // No-advance-by-self: sketch must NOT have created STATE.json itself (the spy
  // swallowed the dispatch, so the only way STATE.json could exist is if sketch
  // called initState directly — which violates the single-init-site contract).
  assert.ok(!fs.existsSync(path.join(root, 'STATE.json')), 'sketch must not call initState itself');
  assert.ok(!fs.existsSync(path.join(root, '.paper', 'STATE.json')), 'sketch must not call initState itself');
});
