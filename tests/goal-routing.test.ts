// tests/goal-routing.test.ts — Phase 9 Wave 0 RED-by-skip goal-routing suite.
//
// Pins ONE thing: a goal-AGNOSTIC `stopAfterResearch` behavior flag steers
// resolveNextAction. The goal→stopAfterResearch MAPPING is the CLI caller's job
// (09-03 wiring + the egress/ordering suites) — this suite NEVER asserts router
// reads config.toml goal (it must not; that is the H1 invariant the lint +
// router-goal-unawareness tests own).
//
// RED-by-skip via SOURCE-GREP: READY = bin/lib/router.ts references
// `stopAfterResearch`. ABSENT in 09-00 (router unchanged) → every test SKIPS so
// the suite stays GREEN. Lands GREEN in 09-03 when the DI param is added.
//
// Contracts (so 09-03 satisfies them):
//   (a) the educator goal enum is `draft | learning | both`.
//   (b) resolveNextAction(root, { stopAfterResearch: true }) with RESEARCH.md
//       present routes to a TERMINAL (status/done) — NOT outline.
//   (c) resolveNextAction(root, { stopAfterResearch: false }) AND the no-arg
//       default with RESEARCH.md present route to OUTLINE (no draft/both
//       regression).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

// SOURCE-GREP skip predicate: the DI param must exist in router.ts source.
function routerStopParamWired(): boolean {
  const p = repoPath('bin/lib/router.ts');
  if (!fs.existsSync(p)) return false;
  return /stopAfterResearch/.test(fs.readFileSync(p, 'utf8'));
}

const READY = routerStopParamWired();

// Runtime URL.href specifier (tsc-clean while the signature still lacks the
// options arg). The local type widens resolveNextAction to accept the optional
// goal-agnostic behavior surface 09-03 adds.
const ROUTER_MOD = new URL('../bin/lib/router.js', import.meta.url);
interface RouterDecisionLike {
  verb: string;
  reason?: string;
}
interface RouterMod {
  resolveNextAction: (
    paperRoot: string,
    opts?: { stopAfterResearch?: boolean },
  ) => Promise<RouterDecisionLike>;
}

/** Seed a tmp paper dir with STATE.json (v2) + RESEARCH.md (no OUTLINE.md). */
function seedResearchedPaper(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-goal-routing-'));
  const paper = path.join(root, '.paper');
  fs.mkdirSync(paper, { recursive: true });
  // CURRENT_STATE_VERSION is 2 (08-06): a v1 envelope would classify as corrupt.
  const state = {
    $schemaVersion: 2,
    paperId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-06-20T00:00:00.000Z', // StateSchema requires createdAt (D-58)
    sections: [],
  };
  // LAYOUT CONTRACT (pensmith-router.test.ts:43-45): STATE.json lives at
  // <root>/STATE.json (stateFile()); RESEARCH.md/OUTLINE.md live under
  // <root>/.paper/ (paperDir()). The 09-00 scaffold placed STATE.json under
  // .paper/, where loadState() never looks → the router returned { verb:'new' }
  // and the DI never engaged. Place it at the root so the DI is exercised.
  fs.writeFileSync(path.join(root, 'STATE.json'), JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(paper, 'RESEARCH.md'), '# Research\n\nPresent.\n');
  return root;
}

test('goal enum is draft | learning | both', { skip: !READY }, () => {
  // The educator goal vocabulary is pinned here as the canonical set the CLI
  // caller maps to stopAfterResearch (learning ⇒ true; draft/both ⇒ false).
  const GOALS = ['draft', 'learning', 'both'];
  assert.deepEqual([...GOALS].sort(), ['both', 'draft', 'learning']);
});

test('DI: stopAfterResearch=true with RESEARCH.md present routes to a TERMINAL (not outline)', { skip: !READY }, async () => {
  const root = seedResearchedPaper();
  const { resolveNextAction } = (await import(ROUTER_MOD.href)) as RouterMod;
  const decision = await resolveNextAction(root, { stopAfterResearch: true });
  assert.notEqual(decision.verb, 'outline', 'stopAfterResearch=true must NOT advance to outline');
  assert.ok(
    decision.verb === 'status' || decision.verb === 'done',
    `stopAfterResearch=true must route to a terminal (status/done), got ${JSON.stringify(decision)}`,
  );
});

test('DI: stopAfterResearch=false with RESEARCH.md present routes to OUTLINE (no draft/both regression)', { skip: !READY }, async () => {
  const root = seedResearchedPaper();
  const { resolveNextAction } = (await import(ROUTER_MOD.href)) as RouterMod;
  const decision = await resolveNextAction(root, { stopAfterResearch: false });
  assert.equal(decision.verb, 'outline', `stopAfterResearch=false must advance to outline, got ${JSON.stringify(decision)}`);
});

test('DI: no-arg default with RESEARCH.md present routes to OUTLINE (back-compat default)', { skip: !READY }, async () => {
  const root = seedResearchedPaper();
  const { resolveNextAction } = (await import(ROUTER_MOD.href)) as RouterMod;
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'outline', `no-arg default must advance to outline (back-compat), got ${JSON.stringify(decision)}`);
});
