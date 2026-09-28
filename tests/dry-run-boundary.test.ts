// tests/dry-run-boundary.test.ts — RUN-27 (review round 2): a --dry-run never
// writes into a real paper, and a normal run never continues a paper a dry run
// made (bin/lib/dry-run-paper.ts). Until GRND-19 moves --dry-run into its own
// scratch workspace, a dry run works only in a folder with no paper, which it
// marks with .paper/DRY-RUN.md; synthetic sources a dry run left in a library
// are dropped by the one library writer outside --dry-run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_ERROR, EXIT_USAGE } from '../bin/lib/exit-codes.js';
import {
  ASSIGNMENT_FIXTURE,
  sandbox,
  runCli,
  runLibScript,
  lastJson,
  snapshot,
  changedPaths,
  writeState,
  writeOutline,
  writePlan,
  sectionDirOf,
  STACK_LINE,
} from './helpers/paper-cli-harness.js';

const MY_DRAFT = 'My own hand-written paragraph about sagas [@harris2011].\n';

test('RUN-27: --dry-run over a REAL paper is refused and leaves every file byte-identical', () => {
  const sb = sandbox('dryrun-real');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'intro' }, { n: 2, slug: 'discussion' }]);
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeFileSync(join(root, '.paper', 'INTAKE.md'), 'Topic: medieval Icelandic sagas\n');
  writeOutline(root, [{ n: 1, slug: 'intro' }, { n: 2, slug: 'discussion' }]);
  writePlan(root, 2, 'discussion', { status: 'written' });
  writeFileSync(join(sectionDirOf(root, 2, 'discussion'), 'DRAFT.md'), MY_DRAFT);
  const before = snapshot(root);
  for (const args of [['--dry-run', 'write', '2'], ['--dry-run', 'research', '--yolo'], ['--dry-run', '--yolo'], ['plan', '1', '--dry-run', '--yolo']]) {
    const r = runCli(sb, root, args);
    assert.equal(r.status, EXIT_USAGE, `${args.join(' ')}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: --dry-run would overwrite the paper at .+ — run the dry run in an empty folder; this paper was not touched$/m);
    assert.doesNotMatch(r.stderr, STACK_LINE);
    assert.deepEqual(changedPaths(before, snapshot(root)), [], `${args.join(' ')} changed nothing`);
  }
  assert.equal(readFileSync(join(sectionDirOf(root, 2, 'discussion'), 'DRAFT.md'), 'utf8'), MY_DRAFT);
});

test('RUN-27: a paper made by --dry-run is marked, and a normal run refuses to continue it (no synthetic source reaches a real run)', () => {
  const sb = sandbox('dryrun-made');
  const root = sb.project('p');
  const made = runCli(sb, root, ['--dry-run', 'new', '--from', ASSIGNMENT_FIXTURE, '--yolo']);
  assert.equal(made.status, 0, `${made.stdout}\n${made.stderr}`);
  assert.ok(existsSync(join(root, '.paper', 'DRY-RUN.md')), 'the dry run marked the paper it made');
  const research = runCli(sb, root, ['--dry-run', 'research', '--yolo']);
  assert.equal(research.status, 0, `${research.stdout}\n${research.stderr}`);
  const library = readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8');
  assert.match(library, /10\.0000\/pensmith-dryrun\./, 'dry-run research wrote synthetic sources (into the dry-run paper)');

  const before = snapshot(root);
  for (const args of [['research', '--yolo'], ['outline', '--yolo'], ['--yolo'], ['new', '--from', ASSIGNMENT_FIXTURE, '--yolo']]) {
    const r = runCli(sb, root, args);
    assert.equal(r.status, EXIT_ERROR, `${args.join(' ')}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: the paper at .+ was made by --dry-run \(synthetic sources, stub text\) and cannot become a real paper — delete .+ or use another folder, then run pensmith new/m);
    assert.deepEqual(changedPaths(before, snapshot(root)), [], `${args.join(' ')} changed nothing`);
  }
  // Read-only verbs still work on it.
  const status = runCli(sb, root, ['status']);
  assert.equal(status.status, 0, status.stderr);
});

test('RUN-27: a dry run that stopped before creating a paper leaves nothing that blocks a real `new`', () => {
  const sb = sandbox('dryrun-stopped');
  const root = sb.project('p');
  // No assignment and no terminal: the dry run marks the folder, then stops at intake.
  runCli(sb, root, ['--dry-run', 'new']);
  const real = runCli(sb, root, ['new', '--from', ASSIGNMENT_FIXTURE, '--yolo']);
  assert.equal(real.status, 0, `${real.stdout}\n${real.stderr}`);
  assert.ok(existsSync(join(root, '.paper', 'STATE.json')));
  assert.ok(!existsSync(join(root, '.paper', 'DRY-RUN.md')), 'the empty dry-run marker is gone');
});

test('RUN-27: outside --dry-run the library writer drops synthetic sources a dry run left behind (LIBRARY.json and CITATIONS.bib)', () => {
  const sb = sandbox('dryrun-purge');
  const root = sb.project('p');
  const r = lastJson<{ ok: boolean; before: number; after: number; bib: string; library: string; stderr?: string }>(
    runLibScript(sb, 'library-purge.ts', [root]),
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.before, 2, 'one real and one synthetic entry were seeded');
  assert.equal(r.after, 2, 'the synthetic one is gone; the new real one joined');
  assert.doesNotMatch(r.library, /pensmith-dryrun/);
  assert.doesNotMatch(r.bib, /pensmith-dryrun/);
  assert.match(r.bib, /10\.1038\/nphys1170/);
});
