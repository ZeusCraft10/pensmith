// tests/research-sentinel.test.ts — audit M1 regression.
//
// The research verb writes LIBRARY.json (+ CITATIONS.bib), its canonical output
// per workflows/research.md §Outputs — NOT RESEARCH.md. But the router and the
// list/status deriver gated "research done" on RESEARCH.md, so bare `pensmith`/
// next/resume looped on `research` after a real research run, and `pensmith list`
// mislabelled every post-research paper as 'intake'. The sentinel now accepts
// LIBRARY.json OR the legacy RESEARCH.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initState } from '../bin/lib/state.js';
import { resolveNextAction } from '../bin/lib/router.js';
import { deriveLibraryStatus } from '../bin/lib/global-library.js';

async function seed(files: Record<string, string>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-sentinel-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  await initState(root);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, '.paper', name), body);
  }
  return root;
}

test('router (M1): LIBRARY.json present (no RESEARCH.md) advances PAST research', async () => {
  const root = await seed({ 'LIBRARY.json': '{"$schemaVersion":1,"entries":[]}\n' });
  const decision = await resolveNextAction(root);
  assert.notEqual(decision.verb, 'research', 'LIBRARY.json must satisfy the research-done sentinel');
  assert.equal(decision.verb, 'outline', `expected outline next; got ${JSON.stringify(decision)}`);
});

test('router (M1): with neither LIBRARY.json nor RESEARCH.md, next is research', async () => {
  const root = await seed({});
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'research');
});

test('router (M1): legacy RESEARCH.md still satisfies the sentinel', async () => {
  const root = await seed({ 'RESEARCH.md': '# Research\n' });
  const decision = await resolveNextAction(root);
  assert.notEqual(decision.verb, 'research');
});

test('deriveLibraryStatus (M1): LIBRARY.json (no OUTLINE.md) derives "research", not "intake"', async () => {
  const root = await seed({ 'LIBRARY.json': '{"$schemaVersion":1,"entries":[]}\n' });
  assert.equal(deriveLibraryStatus(root).status, 'research');
});
