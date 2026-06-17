// tests/scheduler-stateless.test.ts — RED (Wave 0) spec for ARCH-20.
//
// The scheduler is READ-ONLY (D-04): wave assignment is recomputed in memory
// each run from outline + PLAN.md frontmatter; NOTHING is persisted. This test
// seeds a .paper/STATE.json fixture, runs buildWaveGraph + runWave, and asserts
// the STATE.json bytes AND mtime are unchanged across the run.
//
// One mkdtempSync per test; no racing cleanup hooks (cleanup is best-effort in
// a finally with force:true).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Semaphore } from '../bin/lib/budget.js';
import { buildWaveGraph, runWave } from '../bin/lib/scheduler.js';
import type { ParsedOutline } from '../bin/lib/outline-parse.js';
import type { PlanFrontmatter } from '../bin/lib/schemas/plan-frontmatter.js';

function outlineOf(
  sections: Array<{ n: number; slug: string; depends_on?: string[] }>,
): ParsedOutline {
  return {
    paper_title: 'fixture',
    sections: sections.map((s) => ({
      n: s.n,
      slug: s.slug,
      title: s.slug,
      depends_on: s.depends_on ?? [],
    })),
  };
}

function plansFor(outline: ParsedOutline): Map<string, PlanFrontmatter> {
  const m = new Map<string, PlanFrontmatter>();
  for (const s of outline.sections) {
    m.set(s.slug, {
      section: s.n,
      slug: s.slug,
      title: s.slug,
      depends_on: s.depends_on,
      assigned_sources: [],
      verified_against_draft_hash: null,
      status: 'planned',
    } as PlanFrontmatter);
  }
  return m;
}

test('ARCH-20: buildWaveGraph + runWave persist NOTHING — STATE.json untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-scheduler-stateless-'));
  try {
    const paperDir = join(root, '.paper');
    mkdirSync(paperDir, { recursive: true });
    const statePath = join(paperDir, 'STATE.json');
    const stateBytes = JSON.stringify(
      {
        $schemaVersion: 1,
        paperId: 'demo',
        createdAt: '2026-05-08T00:00:00.000Z',
        sections: [
          { n: 1, slug: 'a' },
          { n: 2, slug: 'b' },
        ],
      },
      null,
      2,
    );
    writeFileSync(statePath, stateBytes);

    const before = statSync(statePath);
    const beforeBytes = readFileSync(statePath, 'utf8');

    const outline = outlineOf([
      { n: 1, slug: 'a', depends_on: [] },
      { n: 2, slug: 'b', depends_on: ['a'] },
    ]);
    const graph = buildWaveGraph(outline, plansFor(outline));
    await runWave(graph.waves[0]!, new Semaphore(2), async () => 'ok');
    await runWave(graph.waves[1]!, new Semaphore(2), async () => 'ok');

    const after = statSync(statePath);
    const afterBytes = readFileSync(statePath, 'utf8');

    assert.equal(afterBytes, beforeBytes, 'STATE.json bytes must be byte-for-byte unchanged');
    assert.equal(
      after.mtimeMs,
      before.mtimeMs,
      'STATE.json mtime must be unchanged (scheduler writes nothing)',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ARCH-20: re-running the scheduler twice still touches nothing on disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-scheduler-stateless2-'));
  try {
    const paperDir = join(root, '.paper');
    mkdirSync(paperDir, { recursive: true });
    const statePath = join(paperDir, 'STATE.json');
    writeFileSync(statePath, '{"$schemaVersion":1,"paperId":"x","createdAt":"2026-05-08T00:00:00.000Z"}');
    const before = statSync(statePath).mtimeMs;

    const outline = outlineOf([{ n: 1, slug: 'a', depends_on: [] }]);
    buildWaveGraph(outline, plansFor(outline));
    buildWaveGraph(outline, plansFor(outline));

    assert.equal(statSync(statePath).mtimeMs, before, 'mtime unchanged across two runs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
