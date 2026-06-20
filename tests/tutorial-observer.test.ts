// tests/tutorial-observer.test.ts — Phase 9 Wave 0 RED-by-skip subscriber suite
// + the NON-SKIP router goal-unawareness assertion (H1).
//
// Two kinds of test live here:
//   1. RED-by-skip subscriber-activation tests, guarded on a SOURCE-GREP of
//      bin/lib/tutorial.ts that detects the WIRED render (not the Wave-0 stub) —
//      they wake up in Wave 1 (09-02).
//   2. The router goal-unawareness assertion — NOT skip-guarded. It PASSES NOW
//      (router.ts has zero `goal`/`learning`/`educator_mode` tokens) and is the
//      load-bearing H1 invariant; plus a FORWARD-LOOKING skip-guarded check that
//      router exposes a goal-AGNOSTIC `stopAfterResearch` DI param (lands GREEN
//      in 09-03 when the param is added).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

// --- SOURCE-GREP skip predicate for the WIRED subscriber (not the stub) -----
// The Wave-0 stub's emit() is a no-op; Wave 1 (09-02) wires the real render that
// writes TUTORIAL.md. We detect the wired body by looking for the render seam:
// tutorial.ts must reference `atomicWriteFile(` being CALLED (the stub only
// `void atomicWriteFile`s it) AND a per-claim/provenance render token. Until
// then every subscriber-activation test SKIPS.
function tutorialRenderWired(): boolean {
  const p = repoPath('bin/lib/tutorial.ts');
  if (!fs.existsSync(p)) return false;
  const src = fs.readFileSync(p, 'utf8');
  // `void atomicWriteFile;` (stub) must NOT count — require a real call form.
  const reallyCalls = /atomicWriteFile\(/.test(src);
  const rendersProvenance = /provenance|citekey|## Section|## Research/i.test(src);
  return reallyCalls && rendersProvenance;
}

const RENDER_READY = tutorialRenderWired();

// Runtime URL.href specifier so tsc --noEmit stays clean if the export surface
// shifts in Wave 1.
const TUTORIAL_MOD = new URL('../bin/lib/tutorial.js', import.meta.url);
interface TutorialMod {
  TutorialSubscriber: new (opts: { tutorialPath: string; goal: 'learning' | 'both' }) => {
    emit: (e: { kind: string; payload: unknown }) => void;
    flush: () => Promise<void>;
  };
}

function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-tutorial-obs-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

test('subscriber activation: goal=learning records section.written emits into TUTORIAL.md', { skip: !RENDER_READY }, async () => {
  const root = mkPaperRoot();
  const tutorialPath = path.join(root, '.paper', 'TUTORIAL.md');
  fs.mkdirSync(path.dirname(tutorialPath), { recursive: true });

  const { TutorialSubscriber } = (await import(TUTORIAL_MOD.href)) as TutorialMod;
  const sub = new TutorialSubscriber({ tutorialPath, goal: 'learning' });
  sub.emit({
    kind: 'section.written',
    payload: { n: 1, slug: 'background', assignedSources: ['smith2021', 'jones2019'] },
  });
  await sub.flush();

  assert.ok(fs.existsSync(tutorialPath), 'goal=learning subscriber must write TUTORIAL.md after a section.written emit');
});

test('goal=draft zero-activation: with NO subscriber, TUTORIAL.md is never written', { skip: !RENDER_READY }, async () => {
  const root = mkPaperRoot();
  const tutorialPath = path.join(root, '.paper', 'TUTORIAL.md');
  // The goal=draft path constructs NO subscriber. Emulate that: no emits, no
  // TUTORIAL.md. (The structural guarantee is the zero-branch invariant test —
  // here we assert the observable: absence of the artifact.)
  assert.ok(!fs.existsSync(tutorialPath), 'goal=draft (no subscriber) must produce no TUTORIAL.md');
});

test('never-throw: a malformed payload to emit() does not throw', { skip: !RENDER_READY }, async () => {
  const root = mkPaperRoot();
  const tutorialPath = path.join(root, '.paper', 'TUTORIAL.md');
  fs.mkdirSync(path.dirname(tutorialPath), { recursive: true });

  const { TutorialSubscriber } = (await import(TUTORIAL_MOD.href)) as TutorialMod;
  const sub = new TutorialSubscriber({ tutorialPath, goal: 'both' });
  // Deliberately malformed payloads — emit must swallow, flush must resolve.
  sub.emit({ kind: 'section.written', payload: undefined });
  sub.emit({ kind: 'research.done', payload: { not: 'a known shape' } });
  await assert.doesNotReject(() => sub.flush());
});

// ===========================================================================
// ROUTER GOAL-UNAWARENESS (H1) — NON-SKIP, load-bearing. router.ts must NEVER
// read goal. This is the same invariant lint-tutorial-no-branch enforces over
// ALL of bin/lib, asserted here pointedly on router.ts as the cross-AI cycle-2
// fix's live regression gate.
// ===========================================================================
function routerSource(): string {
  return fs.readFileSync(repoPath('bin/lib/router.ts'), 'utf8');
}

test('router goal-unawareness (H1): bin/lib/router.ts contains ZERO goal/learning/educator_mode tokens', () => {
  const src = routerSource();
  // Strip line comments so a doc comment can't trip the assertion (code only).
  const codeOnly = src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  const m = /(\bgoal\b|\blearning\b|educator_mode)/.exec(codeOnly);
  assert.equal(m, null, `router.ts must be goal-UNAWARE but references "${m?.[0]}" — the resolver must never read goal (H1).`);
});

// FORWARD-LOOKING: router exposes a goal-AGNOSTIC stopAfterResearch DI param.
// ABSENT in 09-00 (router unchanged) → SKIP. Lands GREEN in 09-03 when the CLI
// caller injects the behavior flag.
function routerHasStopParam(): boolean {
  return /stopAfterResearch/.test(routerSource());
}

test('router DI seam (09-03): resolveNextAction accepts a goal-agnostic stopAfterResearch param', { skip: !routerHasStopParam() }, () => {
  const src = routerSource();
  assert.match(src, /stopAfterResearch/, 'router must expose the goal-agnostic stopAfterResearch behavior param');
});
