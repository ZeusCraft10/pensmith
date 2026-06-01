/**
 * tests/wave-scheduler.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from '../bin/lib/budget.js';
import { buildWaveGraph, runWave } from '../bin/lib/scheduler.js';

test('buildWaveGraph: assigns computed_wave by topological depth (COMP-06)', () => {
  const outline = {
    paper_title: 'Test',
    sections: [
      { n: 1, slug: 'intro', title: 'Intro', depends_on: [], assigned_sources: [] },
      { n: 2, slug: 'methods', title: 'Methods', depends_on: ['intro'], assigned_sources: [] },
      { n: 3, slug: 'results', title: 'Results', depends_on: ['methods'], assigned_sources: [] },
      { n: 4, slug: 'extra', title: 'Extra', depends_on: ['intro'], assigned_sources: [] },
    ]
  };
  const plans = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph = buildWaveGraph(outline as any, plans);

  assert.equal(graph.nodes.get('intro')!.computed_wave, 1);
  assert.equal(graph.nodes.get('methods')!.computed_wave, 2);
  assert.equal(graph.nodes.get('results')!.computed_wave, 3);
  assert.equal(graph.nodes.get('extra')!.computed_wave, 2);
});

test('runWave: honors bounded concurrency', async () => {
  const sem = new Semaphore(2);
  let active = 0;
  let maxActive = 0;

  const nodes = [
    { slug: '1', computed_wave: 1 },
    { slug: '2', computed_wave: 1 },
    { slug: '3', computed_wave: 1 },
  ];

  const run = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve(); // yield
    active--;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await runWave(nodes as any, sem, run);
  assert.equal(maxActive, 2);
});

test('runWave: failure in one sibling does not cancel others', async () => {
  const sem = new Semaphore(5);
  const nodes = [
    { slug: 'fail', computed_wave: 1 },
    { slug: 'success', computed_wave: 1 },
  ];

  const run = async (node: { slug: string }) => {
    if (node.slug === 'fail') throw new Error('boom');
    return 'ok';
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = await runWave(nodes as any, sem, run);
  assert.equal(results.length, 2);
  const fail = results.find(r => r.status === 'rejected');
  const success = results.find(r => r.status === 'fulfilled');
  assert.ok(fail);
  assert.ok(success);
});
