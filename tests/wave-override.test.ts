/**
 * tests/wave-override.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaveGraph } from '../bin/lib/scheduler.js';

test('buildWaveGraph: honors valid wave override (PLAN-02)', () => {
  const outline = {
    paper_title: 'Test',
    sections: [
      { n: 1, slug: 'intro', title: 'Intro', depends_on: [], assigned_sources: [] },
      { n: 2, slug: 'methods', title: 'Methods', depends_on: ['intro'], assigned_sources: [] },
    ]
  };
  const plans = new Map([
    ['methods', { wave: 3 }]
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph = buildWaveGraph(outline as any, plans);
  assert.equal(graph.nodes.get('methods')!.computed_wave, 3);
});

test('buildWaveGraph: reject invalid wave override (PLAN-03)', () => {
  const outline = {
    paper_title: 'Test',
    sections: [
      { n: 1, slug: 'intro', title: 'Intro', depends_on: [], assigned_sources: [] },
      { n: 2, slug: 'methods', title: 'Methods', depends_on: ['intro'], assigned_sources: [] },
    ]
  };
  const plans = new Map([
    ['methods', { wave: 1 }]
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.throws(() => buildWaveGraph(outline as any, plans), /invalid wave override/);
});

test('buildWaveGraph: missing/failed dependency marks blocked (REVIEW HIGH)', () => {
  const outline = {
    paper_title: 'Test',
    sections: [
      { n: 1, slug: 'intro', title: 'Intro', depends_on: [], assigned_sources: [] },
      { n: 2, slug: 'methods', title: 'Methods', depends_on: ['intro'], assigned_sources: [] },
    ]
  };
  // Case A: intro is failed
  const plansA = new Map([
    ['intro', { status: 'failed' }]
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphA = buildWaveGraph(outline as any, plansA);
  assert.equal(graphA.nodes.get('methods')!.status, 'blocked');

  // Case B: intro is missing from plans
  const plansB = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphB = buildWaveGraph(outline as any, plansB);
  assert.equal(graphB.nodes.get('methods')!.status, 'blocked');
});
