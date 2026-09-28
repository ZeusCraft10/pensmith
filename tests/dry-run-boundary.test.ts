// tests/dry-run-boundary.test.ts — RUN-27 / GRND-19: a --dry-run never writes
// into a real paper, and no synthetic source ever reaches a real run.
//
// GRND-19 (D-18-29) superseded the Phase 17 boundary: instead of refusing a
// --dry-run over a real paper, a dry run now works in its own workspace
// `.paper-dry-run/` (seeded from `.paper/`, bin/lib/dry-run-paper.ts) and never
// writes `.paper/`. What stays from RUN-27: a normal run refuses to continue a
// paper a Phase 17 dry run made INSIDE `.paper/` (marked `.paper/DRY-RUN.md`),
// and the one library writer drops synthetic sources outside --dry-run.
// tests/dry-run-workspace.test.ts covers the workspace lifecycle (seed, keep,
// re-seed, mtimes, exports, registry).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_BLOCKED, EXIT_ERROR, EXIT_USAGE } from '../bin/lib/exit-codes.js';
import { extractCitedKeysForVerification } from '../bin/lib/citation-token.js';
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

test('GRND-19: --dry-run over a REAL paper works in .paper-dry-run/ and leaves every .paper/ file byte-identical', () => {
  const sb = sandbox('dryrun-real');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'intro' }, { n: 2, slug: 'discussion' }]);
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeFileSync(join(root, '.paper', 'INTAKE.md'), 'Topic: medieval Icelandic sagas\n');
  writeOutline(root, [{ n: 1, slug: 'intro' }, { n: 2, slug: 'discussion' }]);
  writePlan(root, 2, 'discussion', { status: 'written' });
  writeFileSync(join(sectionDirOf(root, 2, 'discussion'), 'DRAFT.md'), MY_DRAFT);
  const before = snapshot(join(root, '.paper'));
  const ws = join(root, '.paper-dry-run');

  const research = runCli(sb, root, ['--dry-run', 'research', '--yolo']);
  assert.equal(research.status, 0, `research: ${research.stdout}\n${research.stderr}`);
  assert.doesNotMatch(research.stderr, /would overwrite the paper/);
  assert.match(readFileSync(join(ws, 'LIBRARY.json'), 'utf8'), /10\.0000\/pensmith-dryrun\./, 'synthetic sources land in the workspace');

  const plan = runCli(sb, root, ['plan', '1', '--dry-run', '--yolo']);
  assert.equal(plan.status, 0, `plan 1: ${plan.stdout}\n${plan.stderr}`);
  assert.ok(existsSync(join(ws, 'sections', '01-intro', 'PLAN.md')), 'the plan was written in the workspace');

  // The loop drafts and verifies §1, then reaches §2, whose hand-written draft
  // cites a source that is not in the library: FABRICATED, exit 4 — a dry run
  // reports real verdicts, it never fakes one. The next step names the fix
  // (the draft is unchanged, so re-verifying it would change nothing).
  const loop = runCli(sb, root, ['--dry-run', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(loop.status, EXIT_BLOCKED, `bare --dry-run: ${loop.stdout}\n${loop.stderr}`);
  assert.match(loop.stderr, /^pensmith: ran verify §2 \(exit 4\); next: status \(attention: section 2 failed verification .*`pensmith write 2`/m, 'the loop stopped at the failing step');
  assert.doesNotMatch(loop.stderr, STACK_LINE);

  const write = runCli(sb, root, ['--dry-run', 'write', '2']);
  assert.equal(write.status, 0, `write 2: ${write.stdout}\n${write.stderr}`);
  assert.notEqual(readFileSync(join(ws, 'sections', '02-discussion', 'DRAFT.md'), 'utf8'), MY_DRAFT, 'the workspace copy was re-drafted');

  assert.deepEqual(changedPaths(before, snapshot(join(root, '.paper'))), [], 'no dry run changed any file of .paper/');
  assert.equal(readFileSync(join(sectionDirOf(root, 2, 'discussion'), 'DRAFT.md'), 'utf8'), MY_DRAFT);
  assert.ok(!existsSync(join(root, '.paper', 'DRY-RUN.md')), 'the real paper carries no dry-run marker');
});

test('RUN-27: a paper a Phase 17 dry run made in .paper/ stays refused by normal runs (no synthetic source reaches a real run)', () => {
  const sb = sandbox('dryrun-made');
  // As a Phase 17 dry run left it: its paper INSIDE .paper/, marked, with
  // synthetic sources — rebuilt here from a real dry run's workspace.
  const made = sb.project('made');
  assert.equal(runCli(sb, made, ['--dry-run', 'new', '--from', ASSIGNMENT_FIXTURE, '--yolo']).status, 0);
  assert.equal(runCli(sb, made, ['--dry-run', 'research', '--yolo']).status, 0);
  const root = sb.project('p');
  cpSync(join(made, '.paper-dry-run'), join(root, '.paper'), { recursive: true });
  rmSync(join(root, '.paper', 'SEED.json'));
  writeFileSync(join(root, '.paper', 'DRY-RUN.md'), '# made by pensmith --dry-run\n');
  assert.match(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8'), /10\.0000\/pensmith-dryrun\./);
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

test('GRND-19: a dry run in a fresh folder never creates .paper/, and a normal run there starts a clean real paper', () => {
  const sb = sandbox('dryrun-fresh');
  const root = sb.project('p');
  const made = runCli(sb, root, ['--dry-run', 'new', '--from', ASSIGNMENT_FIXTURE, '--yolo']);
  assert.equal(made.status, 0, `${made.stdout}\n${made.stderr}`);
  const research = runCli(sb, root, ['--dry-run', 'research', '--yolo']);
  assert.equal(research.status, 0, `${research.stdout}\n${research.stderr}`);
  assert.ok(existsSync(join(root, '.paper-dry-run', 'DRY-RUN.md')), 'the workspace is marked');
  assert.match(readFileSync(join(root, '.paper-dry-run', 'LIBRARY.json'), 'utf8'), /10\.0000\/pensmith-dryrun\./);
  assert.ok(!existsSync(join(root, '.paper')), 'no .paper/ was created');

  // A normal run does not see the workspace: there is no paper here yet.
  const noPaper = runCli(sb, root, ['research', '--yolo']);
  assert.equal(noPaper.status, EXIT_USAGE, `${noPaper.stdout}\n${noPaper.stderr}`);
  assert.match(noPaper.stderr, /no paper in /);
  assert.ok(!existsSync(join(root, '.paper')), 'the refused run created nothing');

  const real = runCli(sb, root, ['new', '--from', ASSIGNMENT_FIXTURE, '--yolo']);
  assert.equal(real.status, 0, `${real.stdout}\n${real.stderr}`);
  assert.ok(existsSync(join(root, '.paper', 'STATE.json')));
  assert.ok(!existsSync(join(root, '.paper', 'LIBRARY.json')), 'no synthetic library reached the real paper');
  assert.ok(!existsSync(join(root, '.paper', 'DRY-RUN.md')));
});

test('RUN-27: a dry run that stopped before creating a paper leaves nothing that blocks a real `new`', () => {
  const sb = sandbox('dryrun-stopped');
  const root = sb.project('p');
  // No assignment and no terminal: the dry run prepares its workspace, then stops at intake.
  const stopped = runCli(sb, root, ['--dry-run', 'new']);
  assert.notEqual(stopped.status, 0);
  const real = runCli(sb, root, ['new', '--from', ASSIGNMENT_FIXTURE, '--yolo']);
  assert.equal(real.status, 0, `${real.stdout}\n${real.stderr}`);
  assert.ok(existsSync(join(root, '.paper', 'STATE.json')));
  assert.ok(!existsSync(join(root, '.paper', 'DRY-RUN.md')), 'no dry-run marker in the real paper');
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

test('RUN-27 / BRDTH-01 / GRND-19: one --dry-run --yolo reaches a .dry-run export that carries only the cited (synthetic) sources and no dry-run marker', () => {
  const sb = sandbox('dryrun-export');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), readFileSync(ASSIGNMENT_FIXTURE, 'utf8'));
  const r = runCli(sb, root, ['--dry-run', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const ws = join(root, '.paper-dry-run');
  const exportDir = join(ws, 'export');
  assert.ok(existsSync(join(exportDir, 'DRAFT.dry-run.md')), 'the dry run reached done in one invocation');
  assert.match(r.stdout, new RegExp(`pensmith done: exported .*${'DRAFT\\.dry-run\\.md'}`));
  const library = readFileSync(join(ws, 'CITATIONS.bib'), 'utf8');
  const libraryKeys = [...library.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!);
  assert.ok(libraryKeys.length > 0, 'research left synthetic sources in the library');
  // GRND-19 (D-18-06): a dry-run draft cites its sections' synthetic sources.
  const cited = new Set(extractCitedKeysForVerification(readFileSync(join(ws, 'DRAFT.md'), 'utf8')));
  assert.ok(cited.size > 0, 'the dry-run draft cites synthetic sources');
  // GRND-19: every exported file of a dry run is named `.dry-run` (the references too).
  const exportedBib = join(exportDir, 'CITATIONS.dry-run.bib');
  assert.ok(existsSync(exportedBib), 'the export carries its references');
  assert.ok(!existsSync(join(exportDir, 'CITATIONS.bib')) && !existsSync(join(exportDir, 'CITATIONS.ris')), 'no un-suffixed export file');
  const exportedText = readFileSync(exportedBib, 'utf8');
  const exportedKeys = [...exportedText.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!);
  assert.deepEqual(exportedKeys.sort(), [...cited].sort(), 'the exported key set is exactly the cited key set');
  // Only what the draft cites leaves the workspace: an uncited library record never
  // reaches the export, and every exported record is one of the library's own.
  for (const key of libraryKeys.filter((k) => !cited.has(k))) {
    assert.ok(!exportedText.includes(`{${key},`), `${key} is not cited, so it is not exported`);
  }
  for (const key of exportedKeys) assert.ok(libraryKeys.includes(key), `${key} comes from the dry-run library`);
  // The synthetic sources are labelled as such by their DOIs (10.0000/pensmith-dryrun.*):
  // each exported record is one, and the draft export itself is named `.dry-run`
  // (D-18-29). Exports stay zero-trace otherwise — no offline/dry-run marker line.
  assert.equal((exportedText.match(/10\.0000\/pensmith-dryrun\./g) ?? []).length, exportedKeys.length, 'each exported record is a labelled synthetic source');
  for (const f of readdirSync(exportDir)) {
    const text = readFileSync(join(exportDir, f), 'utf8');
    assert.doesNotMatch(text, /OFFLINE MODE|DRY RUN|made by pensmith/i, `${f} carries no dry-run marker`);
    assert.match(f, /^(?:DRAFT|CITATIONS)\.dry-run\./, `${f} is named as a dry-run export`);
  }
  assert.ok(!existsSync(join(root, '.paper')), 'the dry run never created .paper/');
});

test('RUN-07 / GRND-19: a `pensmith new` with no key writes nothing, so a --dry-run beside the assignment still runs', () => {
  const sb = sandbox('dryrun-after-failed-new');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), readFileSync(ASSIGNMENT_FIXTURE, 'utf8'));
  const noKey = { PENSMITH_NO_LLM: undefined, ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined };
  for (const args of [['new', '--yolo', '--from', 'assignment.txt'], ['--yolo']]) {
    const failed = runCli(sb, root, args, { env: noKey });
    assert.equal(failed.status, EXIT_ERROR, `${args.join(' ')}: ${failed.stdout}\n${failed.stderr}`);
    assert.match(failed.stderr, /no LLM key configured/);
    assert.ok(!existsSync(join(root, '.paper')), `${args.join(' ')} left no partial .paper/`);
  }
  const dry = runCli(sb, root, ['--dry-run', '--yolo'], { env: noKey, timeoutMs: 120_000 });
  assert.equal(dry.status, 0, `${dry.stdout}\n${dry.stderr}`);
  assert.ok(existsSync(join(root, '.paper-dry-run', 'INTAKE.md')), 'the dry run started its paper in the workspace');
  assert.ok(!existsSync(join(root, '.paper')), 'and created no .paper/');
});

test('GRND-19: a .paper/ holding only settings (config.toml, .gitignore) seeds the workspace and is never written', () => {
  const sb = sandbox('dryrun-settings-only');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), readFileSync(ASSIGNMENT_FIXTURE, 'utf8'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'config.toml'), 'schema_version = 1\n[project]\ngoal = "draft"\n');
  writeFileSync(join(root, '.paper', '.gitignore'), 'INTAKE.raw.local\n');
  const before = snapshot(join(root, '.paper'));
  const dry = runCli(sb, root, ['--dry-run', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(dry.status, 0, `${dry.stdout}\n${dry.stderr}`);
  assert.ok(existsSync(join(root, '.paper-dry-run', 'DRY-RUN.md')), 'the workspace is marked');
  assert.equal(readFileSync(join(root, '.paper-dry-run', '.gitignore'), 'utf8'), 'INTAKE.raw.local\n', 'seeded from .paper/');
  assert.deepEqual(changedPaths(before, snapshot(join(root, '.paper'))), [], '.paper/ is unchanged');
});
