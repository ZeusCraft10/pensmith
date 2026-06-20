// tests/goal-learning-endstate.test.ts — Phase 9 (cycle-2 MEDIUM) EXECUTION-level
// test for the RESEARCH.md → research.done payload PARSE GLUE + the H2 learning
// END-STATE render.
//
// The structural tests (tutorial-provenance) feed the subscriber a payload built
// by the TEST. This suite proves the PRODUCTION glue (bin/cli/goal.ts) parses a
// REAL RESEARCH.md `supports:` block + LIBRARY.json into the per-claim provenance
// payload AND that renderLearningEndState writes TUTORIAL.md with ≥1 per-claim
// line — at the research hard-stop, with NO section ever written.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

const GOAL_MOD = new URL('../bin/cli/goal.js', import.meta.url);
interface GoalMod {
  parseResearchClaims: (md: string) => Map<string, string>;
  buildResearchDonePayload: (paperRoot: string) => {
    sources: Array<{ citekey: string; title?: string; year?: number }>;
    claims: Array<{ citekey: string; claim: string }>;
  };
  renderLearningEndState: (paperRoot: string) => Promise<void>;
  readGoalFromConfig: (paperRoot: string) => 'draft' | 'learning' | 'both';
  stopAfterResearchFor: (g: 'draft' | 'learning' | 'both') => boolean;
}

const FIXTURE = repoPath('tests/fixtures/tutorial-paper');

/** Seed a tmp paper root whose .paper/ carries the committed RESEARCH/LIBRARY. */
function seedLearningPaper(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-learning-end-'));
  process.env.LOCALAPPDATA = root;
  process.env.XDG_DATA_HOME = root;
  process.env.HOME = root;
  const paper = path.join(root, '.paper');
  fs.mkdirSync(paper, { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, 'RESEARCH.md'), path.join(paper, 'RESEARCH.md'));
  fs.copyFileSync(path.join(FIXTURE, 'LIBRARY.json'), path.join(paper, 'LIBRARY.json'));
  return root;
}

test('parseResearchClaims: parses a REAL RESEARCH.md supports: block into citekey→claim', async () => {
  const { parseResearchClaims } = (await import(GOAL_MOD.href)) as GoalMod;
  const md = fs.readFileSync(path.join(FIXTURE, 'RESEARCH.md'), 'utf8');
  const claims = parseResearchClaims(md);
  assert.ok(claims.has('smith2021'), 'expected smith2021 parsed from RESEARCH.md');
  assert.ok(claims.has('jones2019'), 'expected jones2019 parsed from RESEARCH.md');
  assert.match(claims.get('smith2021') ?? '', /sub-quadratically/i, 'smith2021 claim text parsed');
  assert.match(claims.get('jones2019') ?? '', /benchmark/i, 'jones2019 claim text parsed');
});

test('buildResearchDonePayload: merges LIBRARY.json sources + RESEARCH.md claims', async () => {
  const { buildResearchDonePayload } = (await import(GOAL_MOD.href)) as GoalMod;
  const root = seedLearningPaper();
  const payload = buildResearchDonePayload(root);
  const keys = payload.sources.map((s) => s.citekey).sort();
  assert.deepEqual(keys, ['jones2019', 'smith2021'], 'sources from LIBRARY.json');
  const claimKeys = payload.claims.map((c) => c.citekey).sort();
  assert.deepEqual(claimKeys, ['jones2019', 'smith2021'], 'claims from RESEARCH.md');
});

test('renderLearningEndState (H2): writes TUTORIAL.md with ≥1 per-claim line, no section written', async () => {
  const { renderLearningEndState } = (await import(GOAL_MOD.href)) as GoalMod;
  const root = seedLearningPaper();
  await renderLearningEndState(root);

  const tutorialPath = path.join(root, '.paper', 'TUTORIAL.md');
  assert.ok(fs.existsSync(tutorialPath), 'renderLearningEndState must write TUTORIAL.md');
  const md = fs.readFileSync(tutorialPath, 'utf8');

  // ≥1 per-claim provenance line naming a citekey AND a fragment of its claim.
  const lines = md.split(/\r?\n/);
  const provLine = lines.find(
    (l) =>
      (/smith2021/.test(l) && /sub-quadratic/i.test(l)) ||
      (/jones2019/.test(l) && /benchmark/i.test(l)),
  );
  assert.ok(provLine, `expected ≥1 per-claim provenance line; got:\n${md}`);

  // No section was written at the learning hard-stop.
  assert.ok(!fs.existsSync(path.join(root, '.paper', 'sections')), 'no section dir at learning hard-stop');
  assert.ok(!/\.paper[\\/]sections[\\/]/.test(md), 'TUTORIAL.md must not name a section path');
});

test('readGoalFromConfig + stopAfterResearchFor: learning ⇒ stop, draft/both ⇒ no stop', async () => {
  const { readGoalFromConfig, stopAfterResearchFor } = (await import(GOAL_MOD.href)) as GoalMod;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-goal-cfg-'));
  // No config.toml → default draft → no stop.
  assert.equal(readGoalFromConfig(root), 'draft');
  assert.equal(stopAfterResearchFor('draft'), false);
  assert.equal(stopAfterResearchFor('both'), false);
  assert.equal(stopAfterResearchFor('learning'), true);

  // config.toml [project] goal = 'learning' → learning → stop.
  fs.writeFileSync(path.join(root, 'config.toml'), '[project]\ngoal = "learning"\n');
  assert.equal(readGoalFromConfig(root), 'learning');
  assert.equal(stopAfterResearchFor(readGoalFromConfig(root)), true);
});
