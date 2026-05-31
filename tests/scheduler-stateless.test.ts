/**
 * tests/scheduler-stateless.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Semaphore } from '../bin/lib/budget.js';
import { buildWaveGraph, runWave } from '../bin/lib/scheduler.js';

test('scheduler: STATE.json mtime unchanged (ARCH-20)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pensmith-test-'));
  const paperDir = join(tmp, '.paper');
  mkdirSync(paperDir);
  const statePath = join(paperDir, 'STATE.json');
  writeFileSync(statePath, JSON.stringify({ paperId: 'test' }));

  const before = statSync(statePath).mtimeMs;

  const outline = { paper_title: 'T', sections: [] };
  const plans = new Map();
  buildWaveGraph(outline, plans);
  const sem = new Semaphore(1);
  await runWave([], sem, async () => {});

  const after = statSync(statePath).mtimeMs;
  assert.equal(after, before, 'STATE.json mtime must be unchanged');
});
