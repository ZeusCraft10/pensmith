// tests/unknown-verb.test.ts — RUN-11 (D-17-35): an unknown verb or flag is a
// usage error (EXIT_USAGE = 2) with a Levenshtein ≤ 2 suggestion, and it
// creates NOTHING: no .paper/, no STATE.json, no SESSION.log, no registry
// entry, no data dir, no network or LLM call — the typo never reaches the bare
// router (which could start a paper). The alias table dispatches like its
// verb, and the locked 16-verb set is unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UX02_VERBS, VERB_ALIASES, canonicalVerb, nearest, editDistance } from '../bin/lib/verbs.js';
import { EXIT_USAGE } from '../bin/lib/exit-codes.js';
import { validateArgv, dispatchInner } from '../bin/pensmith.js';
import { setActivePaperRoot } from '../bin/lib/paths.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import * as fs from 'node:fs';
import {
  STACK_LINE,
  sandbox,
  runCli,
  seedCompiledPaper,
  snapshot,
  changedPaths,
} from './helpers/paper-cli-harness.js';

test('RUN-11: `pensmith stauts` exits 2 with the suggestion and creates nothing', () => {
  const sb = sandbox('unknown-verb');
  const cwd = sb.project('empty');
  const r = runCli(sb, cwd, ['stauts'], { env: { ANTHROPIC_API_KEY: 'sk-test-SENTINEL' } });
  assert.equal(r.status, EXIT_USAGE, r.stderr);
  assert.equal(
    r.stderr.trim(),
    "pensmith: unknown command 'stauts'; did you mean 'status'? (run pensmith --help for the verb list)",
  );
  assert.equal(r.stdout, '');
  assert.ok(!existsSync(join(cwd, '.paper')), 'no .paper/');
  assert.ok(!existsSync(join(cwd, 'STATE.json')), 'no STATE.json');
  assert.ok(!existsSync(join(cwd, 'SESSION.log')), 'no SESSION.log');
  assert.ok(!existsSync(join(sb.data, 'pensmith')), 'no data dir (no registry entry, no lock, no log)');
});

test('RUN-11: a typo is rejected even where the bare router WOULD start a paper (assignment.txt present)', () => {
  const sb = sandbox('unknown-verb-assign');
  const cwd = sb.project('p');
  writeFileSync(join(cwd, 'assignment.txt'), 'Write an essay.\n');
  for (const typo of ['nwe', 'reserch', 'outlien', 'hello']) {
    const r = runCli(sb, cwd, [typo, '--yolo']);
    assert.equal(r.status, EXIT_USAGE, `${typo}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^pensmith: unknown command '${typo}'`));
    assert.doesNotMatch(r.stderr, STACK_LINE);
    assert.ok(!existsSync(join(cwd, '.paper')), `${typo}: no paper was started`);
  }
  const far = runCli(sb, cwd, ['hello']);
  assert.ok(!/did you mean/.test(far.stderr), 'no suggestion beyond edit distance 2');
});

test('RUN-11: unknown flags on a verb are rejected — `done --no-scor` exits 2 and writes nothing', () => {
  const sb = sandbox('unknown-flag');
  const root = sb.project('p');
  seedCompiledPaper(root);
  const before = snapshot(root);
  const r = runCli(sb, root, ['done', '--no-scor']);
  assert.equal(r.status, EXIT_USAGE, r.stderr);
  assert.match(r.stderr, /^pensmith: unknown option '--no-scor' for 'pensmith done'/m);
  assert.deepEqual(changedPaths(before, snapshot(root)), [], 'the finished paper is untouched');

  const near = runCli(sb, root, ['done', '--fromat', 'md']);
  assert.equal(near.status, EXIT_USAGE);
  assert.match(near.stderr, /did you mean '--format'\?/);

  const root2 = runCli(sb, root, ['--yoloo']);
  assert.equal(root2.status, EXIT_USAGE);
  assert.match(root2.stderr, /did you mean '--yolo'\?/);
});

test('RUN-11: arity and value checks — extra positionals, missing values', () => {
  const sb = sandbox('arity');
  const cwd = sb.project('p');
  const extra = runCli(sb, cwd, ['write', '1', '2']);
  assert.equal(extra.status, EXIT_USAGE);
  assert.match(extra.stderr, /unexpected argument '2' for 'pensmith write'/);
  const noValue = runCli(sb, cwd, ['status', '--paper']);
  assert.equal(noValue.status, EXIT_USAGE);
  assert.match(noValue.stderr, /option '--paper' needs a value/);
  const verbValue = runCli(sb, cwd, ['done', '--format']);
  assert.equal(verbValue.status, EXIT_USAGE);
  assert.match(verbValue.stderr, /option '--format' needs a value/);
  assert.ok(!existsSync(join(cwd, '.paper')));
});

test('RUN-11: global flags are accepted on every verb, before or after it; --no-<bool> is accepted', async () => {
  for (const argv of [
    ['--yolo', 'status'],
    ['status', '--yolo'],
    ['status', '--dry-run', '--show-prompts', '--estimate'],
    ['--paper', 'x', 'status'],
    ['status', '--paper=x'],
    ['--runtime', 'anthropic', '--model', 'claude-opus-5', 'status'],
    ['compile', '--lint-headings', '--no-yolo'],
    ['write', '--max-parallel', '2'],
    ['--help'],
    ['--version'],
  ]) {
    const v = await validateArgv(argv);
    assert.ok(v, argv.join(' '));
  }
  assert.equal((await validateArgv(['--paper', 'p2', 'write', '1'])).paperFlag, 'p2');
  assert.equal((await validateArgv(['write', '1', '--paper=p3'])).paperFlag, 'p3');
});

test('RUN-11: global booleans are normalized — `--x=true|1` is on, `--x=false|0` / `--no-x` is off, other values are EXIT_USAGE', async () => {
  const cases: Array<[string[], string[]]> = [
    [['plan', '2', '--dry-run=true', '--yolo'], ['plan', '2', '--dry-run', '--yolo']],
    [['plan', '3', '--estimate=1'], ['plan', '3', '--estimate']],
    [['--show-prompts=TRUE', 'status'], ['--show-prompts', 'status']],
    [['write', '1', '--yolo=false'], ['write', '1']],
    [['write', '1', '--yolo', '--no-yolo'], ['write', '1']],
    [['--no-dry-run', 'write', '1', '--dry-run'], ['write', '1', '--dry-run']],
    [['write', '1', '--yolo=0', '--', '--yolo'], ['write', '1', '--', '--yolo']],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual((await validateArgv(input)).argv, expected, input.join(' '));
  }
  await assert.rejects(validateArgv(['write', '1', '--dry-run=maybe']), (e: unknown) =>
    (e as { exitCode?: number }).exitCode === EXIT_USAGE && /option '--dry-run' is a switch: use --dry-run or --no-dry-run/.test((e as Error).message));
});

test('RUN-11: `--dry-run=true` is a dry run and `--estimate=true` only estimates — neither reaches the model', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-inline-bool-0001', PENSMITH_NO_LLM: undefined } }, async (sb) => {
    fs.writeFileSync(join(sb.paper, 'INTAKE.md'), '---\ntopic: medieval Icelandic sagas\ndiscipline: history\n---\n# Intake\n\nWrite a 1500-word essay on medieval Icelandic sagas.\n');
    // A paper a dry run made (RUN-27: --dry-run never runs over a real paper).
    fs.writeFileSync(join(sb.paper, 'DRY-RUN.md'), '# made by pensmith --dry-run\n');
    const dry = await sb.runTsx(null, ['research', '--dry-run=true', '--yolo']);
    assert.equal(dry.status, 0, `${dry.stdout}\n${dry.stderr}`);
    assert.match(dry.stderr, /OFFLINE MODE \(reason: --dry-run\)/);
    assert.equal(sb.mock!.callCount(), 0, '--dry-run=true made no model call');

    const est = await sb.runTsx(null, ['outline', '--estimate=true']);
    assert.equal(est.status, 0, `${est.stdout}\n${est.stderr}`);
    assert.match(est.stdout, /outline/i, 'the projection is printed');
    assert.ok(!fs.existsSync(join(sb.paper, 'OUTLINE.md')), '--estimate=true wrote no outline');
    assert.equal(sb.mock!.callCount(), 0, '--estimate=true made no model call');
  });
});

test('RUN-11: a verb option is accepted in its declared (camelCase, as --help prints it) and kebab-case spellings', async () => {
  for (const argv of [
    ['compile', '--lintHeadings'],
    ['compile', '--lint-headings'],
    ['compile', '--no-lintHeadings'],
    ['new', '--styleSamples=/x'],
    ['new', '--style-samples', '/x'],
  ]) {
    const v = await validateArgv(argv);
    assert.ok(v.verb, argv.join(' '));
  }
});

test('RUN-11: nearest-verb suggestion is Levenshtein ≤ 2', () => {
  assert.equal(editDistance('stauts', 'status'), 2);
  assert.equal(nearest('stauts', UX02_VERBS), 'status');
  assert.equal(nearest('comple', UX02_VERBS), 'compile');
  assert.equal(nearest('xyzzy', UX02_VERBS), null);
});

test('RUN-11: the 16-verb set is unchanged and the alias table is empty in Phase 17', () => {
  assert.equal(UX02_VERBS.length, 16);
  assert.deepEqual(Object.keys(VERB_ALIASES), [], 'EXP-21 fills VERB_ALIASES');
});

test('RUN-11: an alias registered in VERB_ALIASES dispatches exactly like its verb', async () => {
  const sb = sandbox('alias');
  const root = sb.project('p');
  seedCompiledPaper(root);
  VERB_ALIASES['st'] = 'status';
  const prevCwd = process.cwd();
  process.chdir(root);
  const captured: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  // Tee (never swallow): the test runner reports on this same stream.
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return (write as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    assert.equal(canonicalVerb('st'), 'status');
    assert.equal((await validateArgv(['st'])).verb, 'status');
    const result = await dispatchInner(['st']) as { ok?: boolean };
    assert.equal(result?.ok, true, 'the aliased status ran');
  } finally {
    process.stdout.write = write;
    process.chdir(prevCwd);
    setActivePaperRoot(null);
    delete VERB_ALIASES['st'];
  }
  assert.match(captured.join(''), /pensmith status:/, 'status output was produced');
  assert.equal(canonicalVerb('st'), null, 'the alias is gone again');
});

test('RUN-11: bare `pensmith --yolo` still routes through resolveNextAction (a folder with an assignment starts a paper)', () => {
  const sb = sandbox('bare');
  const cwd = sb.project('p');
  writeFileSync(join(cwd, 'assignment.txt'), 'Write a 1500-word essay on tidal power.\n');
  const r = runCli(sb, cwd, ['--yolo']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(join(cwd, '.paper', 'STATE.json')), 'the router dispatched `new`');
  assert.ok(existsSync(join(cwd, '.paper', 'INTAKE.md')));
  // RUN-27: a --dry-run never runs over this (real) paper — refused, nothing written.
  const refused = runCli(sb, cwd, ['--dry-run', '--yolo']);
  assert.equal(refused.status, EXIT_USAGE, `${refused.stdout}\n${refused.stderr}`);
  assert.match(refused.stderr, /--dry-run would overwrite the paper at .* this paper was not touched/);
  assert.ok(!existsSync(join(cwd, '.paper', 'LIBRARY.json')), 'nothing was researched');
  // In a fresh folder, bare `--dry-run --yolo` routes the same way: new, then research.
  const fresh = sb.project('dry');
  writeFileSync(join(fresh, 'assignment.txt'), 'Write a 1500-word essay on tidal power.\n');
  const dryNew = runCli(sb, fresh, ['--dry-run', '--yolo']);
  assert.equal(dryNew.status, 0, `${dryNew.stdout}\n${dryNew.stderr}`);
  assert.ok(existsSync(join(fresh, '.paper', 'STATE.json')), 'the router dispatched `new`');
  const dry = runCli(sb, fresh, ['--dry-run', '--yolo']);
  assert.equal(dry.status, 0, `${dry.stdout}\n${dry.stderr}`);
  assert.ok(existsSync(join(fresh, '.paper', 'LIBRARY.json')), 'the router dispatched `research`');
});
