// tests/cli-exit-codes.test.ts — RUN-09 / RUN-12 (D-17-34): the documented
// exit codes, applied by the verbs and propagated by the dispatcher, observed
// through the BUILT CLI (run `npm run build` first).
//
//   0 OK · 1 EXIT_ERROR · 2 EXIT_USAGE · 3 EXIT_APPROVAL · 4 EXIT_BLOCKED · 5 EXIT_COST_CAP
//
// Every refusal prints ONE line (`pensmith: …`), never a stack trace, and a
// blocked verb writes nothing it would not have written anyway (no
// .paper/DRAFT.md from a refused compile, no .paper/export/ from a blocked done).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXIT_CODES,
  EXIT_OK,
  EXIT_ERROR,
  EXIT_USAGE,
  EXIT_APPROVAL,
  EXIT_BLOCKED,
  EXIT_COST_CAP,
  PensmithError,
} from '../bin/lib/exit-codes.js';
import { exitCodeForResult, finalExitCode, classifyFailure, failureLine } from '../bin/lib/verb-outcome.js';
import { PromptAbortedError } from '../bin/lib/prompts.js';
import {
  CLI_BIN,
  STACK_LINE,
  sandbox,
  runCli,
  seedFabricatedSection,
  seedCompiledPaper,
  writeState,
  writeOutline,
  writePlan,
  sectionDirOf,
  snapshot,
  changedPaths,
} from './helpers/paper-cli-harness.js';

const IGNORE_LOGS = /^\.paper[\\/](SESSION\.log|sessions)/;

test('RUN-09: build artifact exists', () => {
  assert.ok(existsSync(CLI_BIN), `expected ${CLI_BIN} — run npm run build first`);
});

// ---------------------------------------------------------------------------
// The table itself
// ---------------------------------------------------------------------------

test('RUN-09: EXIT_CODES documents exactly 0..5 with the S-01 names', () => {
  assert.deepEqual(
    EXIT_CODES.map((c) => [c.code, c.name]),
    [
      [0, 'EXIT_OK'],
      [1, 'EXIT_ERROR'],
      [2, 'EXIT_USAGE'],
      [3, 'EXIT_APPROVAL'],
      [4, 'EXIT_BLOCKED'],
      [5, 'EXIT_COST_CAP'],
    ],
  );
  assert.deepEqual([EXIT_OK, EXIT_ERROR, EXIT_USAGE, EXIT_APPROVAL, EXIT_BLOCKED, EXIT_COST_CAP], [0, 1, 2, 3, 4, 5]);
  for (const c of EXIT_CODES) assert.ok(c.meaning.length > 3, `${c.name} has a meaning`);
});

test('RUN-09: `pensmith --help` and `<verb> --help` print the exit-code table, global flags and environment', () => {
  const sb = sandbox('exit-help');
  const cwd = sb.project('p');
  for (const args of [['--help'], ['done', '--help']]) {
    const r = runCli(sb, cwd, args);
    assert.equal(r.status, 0, r.stderr);
    for (const c of EXIT_CODES) {
      assert.match(r.stdout, new RegExp(`^\\s+${c.code}\\s+${c.name}\\s+${c.meaning.slice(0, 20).replace(/[()]/g, '.')}`, 'm'), `${args.join(' ')}: ${c.name}`);
    }
    for (const flag of ['--paper <name|path>', '--yolo', '--dry-run', '--estimate', '--show-prompts', '--runtime <provider>', '--model <id>']) {
      assert.ok(r.stdout.includes(flag), `${args.join(' ')}: global flag ${flag}`);
    }
    assert.match(r.stdout, /PENSMITH_NO_LLM\s+replaces every LLM call with a deterministic stub \(testing and dry-run\)/);
    assert.match(r.stdout, /PENSMITH_OFFLINE\s+/);
    assert.ok(!/\u001b\[/.test(r.stdout), 'no ANSI colour codes when stdout is not a terminal');
    // RUN-12 / CI-06: clean output — no dependency deprecation (DEP0040 punycode from citation-js) on stderr.
    assert.equal(r.stderr, '', `${args.join(' ')}: stderr is empty`);
  }
  assert.ok(!existsSync(join(cwd, '.paper')), '--help creates nothing');
});

// ---------------------------------------------------------------------------
// Result / failure classification (the one mapping CLI and MCP share)
// ---------------------------------------------------------------------------

test('RUN-09: verb results map to exit codes (explicit exitCode > blocked|refused > ok:false)', () => {
  assert.equal(exitCodeForResult(undefined), EXIT_OK);
  assert.equal(exitCodeForResult({ ok: true }), EXIT_OK);
  assert.equal(exitCodeForResult({ ok: false }), EXIT_ERROR);
  assert.equal(exitCodeForResult({ ok: false, blocked: true }), EXIT_BLOCKED);
  assert.equal(exitCodeForResult({ ok: false, refused: true }), EXIT_BLOCKED);
  assert.equal(exitCodeForResult({ ok: false, exitCode: EXIT_APPROVAL }), EXIT_APPROVAL);
  assert.equal(finalExitCode({ ok: true }, EXIT_BLOCKED), EXIT_BLOCKED, 'an explicit process.exitCode wins');
  assert.equal(finalExitCode({ ok: false, blocked: true }, undefined), EXIT_BLOCKED);
  assert.deepEqual(classifyFailure(new PensmithError('nope', EXIT_COST_CAP)), { code: EXIT_COST_CAP, message: 'nope', unexpected: false });
  assert.equal(classifyFailure(new PromptAbortedError('q')).code, EXIT_APPROVAL);
  const odd = classifyFailure(new Error('boom\n  at somewhere'));
  assert.equal(odd.code, EXIT_ERROR);
  assert.equal(odd.unexpected, true);
  assert.ok(!odd.message.includes('\n'), 'one line');
});

// ---------------------------------------------------------------------------
// EXIT_BLOCKED (4): verify failed, compile REFUSED, done BLOCKED — nothing emitted
// ---------------------------------------------------------------------------

test('RUN-09: a fabricated citation — verify 1, compile --yolo and done --yolo each exit 4 and write no DRAFT.md or export/', () => {
  const sb = sandbox('exit-blocked');
  const root = sb.project('p');
  seedFabricatedSection(root);

  const v = runCli(sb, root, ['verify', '1']);
  assert.equal(v.status, EXIT_BLOCKED, `verify: ${v.stdout}\n${v.stderr}`);
  assert.match(readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8'), /^Status: failed$/m);
  assert.doesNotMatch(v.stderr, STACK_LINE);

  const c = runCli(sb, root, ['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `compile: ${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /REFUSED/);
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), 'a refused compile writes no DRAFT.md');

  // The real path: compile refused, so there is no DRAFT.md — done refuses
  // with the blocking citation (EXIT_BLOCKED), never "run compile first".
  const noDraft = runCli(sb, root, ['done', '--yolo', '--format', 'md']);
  assert.equal(noDraft.status, EXIT_BLOCKED, `done (no DRAFT.md): ${noDraft.stdout}\n${noDraft.stderr}`);
  assert.match(noDraft.stdout, /BLOCKED — there is no compiled draft because compile refuses these sections/);
  assert.match(noDraft.stdout, /section 01-intro: .*ghost2099|section 01-intro: VERIFICATION\.md Status is 'failed'/);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'a blocked done writes no export/');

  // done's own gate: a DRAFT.md placed by hand still cannot be exported.
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nA claim [@ghost2099].\n');
  const d = runCli(sb, root, ['done', '--yolo', '--format', 'md']);
  assert.equal(d.status, EXIT_BLOCKED, `done: ${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /BLOCKED/);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'a blocked done writes no export/');
  assert.ok(!existsSync(join(root, '.paper', 'FINAL.md')), 'a blocked done writes no FINAL.md');
});

test('RUN-09: bare `pensmith --yolo`, `pensmith next` and `pensmith resume` exit with the dispatched verb\'s code', () => {
  const sb = sandbox('exit-propagate');
  const root = sb.project('p');
  seedFabricatedSection(root);
  // The router picks `verify §1` (status written): the dispatched verify fails.
  const bare = runCli(sb, root, ['--yolo'], { env: { PENSMITH_COST_CAP_USD: '1000000' } });
  assert.equal(bare.status, EXIT_BLOCKED, `bare: ${bare.stdout}\n${bare.stderr}`);
  const next = runCli(sb, root, ['next']);
  assert.equal(next.status, EXIT_BLOCKED, `next: ${next.stdout}\n${next.stderr}`);
  assert.match(next.stderr, /pensmith next: → verify/);
  const fresh = sb.project('p-resume');
  seedFabricatedSection(fresh);
  const resume = runCli(sb, fresh, ['resume']);
  assert.equal(resume.status, EXIT_BLOCKED, `resume: ${resume.stdout}\n${resume.stderr}`);
  assert.match(resume.stderr, /pensmith resume: → verify/);
});

// ---------------------------------------------------------------------------
// EXIT_APPROVAL (3): no terminal and no --yolo; an explicit decline
// ---------------------------------------------------------------------------

test('RUN-09: `done < /dev/null` exits 3 with the approval message and exports nothing', () => {
  const sb = sandbox('exit-done-approval');
  const root = sb.project('p');
  seedCompiledPaper(root);
  const before = snapshot(root);
  const r = runCli(sb, root, ['done', '--format', 'md']);
  assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: Export the paper now\? \(nothing was exported\) needs an answer: re-run in a terminal, or pass --yolo to export\.$/m);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'nothing was written');
});

test('RUN-09: answering "n" at the export confirmation prints "export cancelled by user" and exits 3', () => {
  const sb = sandbox('exit-done-decline');
  const root = sb.project('p');
  seedCompiledPaper(root);
  const r = runCli(sb, root, ['done', '--format', 'md'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: 'n\n' });
  assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: export cancelled by user$/m);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing exported after a decline');

  const yes = runCli(sb, root, ['done', '--format', 'md'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: 'y\n' });
  assert.equal(yes.status, EXIT_OK, `${yes.stdout}\n${yes.stderr}`);
  assert.ok(existsSync(join(root, '.paper', 'export', 'DRAFT.md')), '"y" exports');
});

test('RUN-12: numbered prompts with no answer left (input ended) exit 3 in one line — PromptAbortedError', () => {
  const sb = sandbox('exit-abort');
  const root = sb.project('p');
  seedCompiledPaper(root);
  const r = runCli(sb, root, ['done', '--format', 'md'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: '' });
  assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: no answer for "export-confirm" \(input ended\) — nothing was changed$/m);
  assert.doesNotMatch(r.stderr, STACK_LINE);
});

// ---------------------------------------------------------------------------
// EXIT_ERROR (1) and EXIT_USAGE (2) in the verbs
// ---------------------------------------------------------------------------

test('RUN-09: `outline --yolo` that registers 0 sections exits 1 with the WARN', () => {
  const sb = sandbox('exit-outline');
  const root = sb.project('p');
  writeState(root, []);
  writeFileSync(join(root, '.paper', 'INTAKE.md'), '# Intake\n\nTopic: tidal power\n');
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  const r = runCli(sb, root, ['outline', '--yolo']);
  const st = JSON.parse(readFileSync(join(root, '.paper', 'STATE.json'), 'utf8')) as { sections?: unknown[] };
  const registered = (st.sections ?? []).length;
  if (registered === 0) {
    assert.equal(r.status, EXIT_ERROR, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /no parseable section table/);
  } else {
    // A schema-valid outline reply (RUN-25 contract stub) registers sections.
    assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  }
});

test('RUN-09: `new` with no assignment in a non-interactive run exits 2 before writing anything', () => {
  const sb = sandbox('exit-intake');
  const root = sb.project('p');
  const r = runCli(sb, root, ['new', '--yolo']);
  assert.equal(r.status, EXIT_USAGE, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: no assignment found: pass --from <file> or @<file> \(\.txt, \.md, \.pdf\), pipe it on stdin, put assignment\.txt \/ assignment\.md \/ assignment\.pdf in /m);
  assert.ok(!existsSync(join(root, '.paper')), 'no .paper/ was created');
  const missing = runCli(sb, root, ['new', '--from', 'nope.txt', '--yolo']);
  assert.equal(missing.status, EXIT_USAGE);
  assert.match(missing.stderr, /^pensmith: --from nope\.txt: no such file$/m);
});

test('RUN-09: `add` with something that is not an identifier exits 2 before any lookup; an identifier that cannot be resolved exits 1', () => {
  const sb = sandbox('exit-add');
  const root = sb.project('p');
  writeState(root, []);
  const before = snapshot(root);
  const usageCases: Array<[string, RegExp]> = [
    ['not a doi at all', /^pensmith add: "not a doi at all" is not a DOI \(10\.…\), an http\(s\) URL or a local PDF/m],
    ['./missing.pdf', /^pensmith add: \.\/missing\.pdf: no such file$/m],
  ];
  for (const [arg, message] of usageCases) {
    const r = runCli(sb, root, ['add', arg]);
    assert.equal(r.status, EXIT_USAGE, `${arg}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stderr, /PENSMITH_DEBUG/);
  }
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'nothing was written');
  const logPath = join(root, '.paper', 'SESSION.log');
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  assert.doesNotMatch(log, /"kind":"http"/, 'no request was made');
  // A well-formed DOI with no verification available (sources offline under the
  // test runner, no recorded fixture) is a refusal, not a usage error.
  const offline = runCli(sb, root, ['add', '10.9999/pensmith-no-such-work'], { env: { PENSMITH_OFFLINE: '1' } });
  assert.equal(offline.status, EXIT_ERROR, `${offline.stdout}\n${offline.stderr}`);
  assert.match(offline.stderr, /DOI verification unavailable \(offline\)/);
  // An existing file that is not a readable PDF cannot be hydrated.
  writeFileSync(join(root, 'notes.txt'), 'plain text, not a PDF\n');
  const notPdf = runCli(sb, root, ['add', 'notes.txt'], { env: { PENSMITH_OFFLINE: '1' } });
  assert.equal(notPdf.status, EXIT_ERROR, `${notPdf.stdout}\n${notPdf.stderr}`);
  assert.match(notPdf.stdout, /could not hydrate/);
});

test('RUN-09: an unknown --runtime provider is EXIT_USAGE for every verb, before any work', () => {
  const sb = sandbox('exit-runtime');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'alpha' }]);
  writeOutline(root, [{ n: 1, slug: 'alpha' }]);
  writePlan(root, 1, 'alpha');
  const before = snapshot(root);
  for (const args of [['write', '1', '--runtime', 'bogus', '--yolo'], ['--runtime=bogus', 'status'], ['--runtime', 'bogus', 'doctor']]) {
    const r = runCli(sb, root, args);
    assert.equal(r.status, EXIT_USAGE, `${args.join(' ')}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: unknown provider 'bogus' for --runtime; valid values: anthropic, openai, ollama, vllm, openai-compatible$/m);
  }
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'nothing was written');
});

test('RUN-09: a wave write with a failed section exits 1', () => {
  const sb = sandbox('exit-wave');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'alpha' }, { n: 2, slug: 'beta' }]);
  writeOutline(root, [{ n: 1, slug: 'alpha' }, { n: 2, slug: 'beta' }]);
  writePlan(root, 1, 'alpha');
  writePlan(root, 2, 'beta');
  // beta's DRAFT.md path is a directory → its atomic write fails → section failed.
  mkdirSync(join(sectionDirOf(root, 2, 'beta'), 'DRAFT.md'), { recursive: true });
  const r = runCli(sb, root, ['write', '--max-parallel', '1', '--yolo']);
  assert.equal(r.status, EXIT_ERROR, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /"wave_complete"/);
  // RUN-12: the failure is named on stderr (one line), never a silent exit 1.
  assert.match(r.stderr, /^pensmith write: section 2 \(beta\) failed: /m);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.ok(existsSync(join(sectionDirOf(root, 1, 'alpha'), 'DRAFT.md')), 'the healthy section is still written');
});

test('RUN-09: an invalid section argument is EXIT_USAGE before any model call — no placeholder folder, no debug hint', () => {
  const sb = sandbox('exit-section-arg');
  const root = sb.project('p');
  const three = [{ n: 1, slug: 'introduction' }, { n: 2, slug: 'discussion' }, { n: 3, slug: 'conclusion' }];
  writeState(root, three);
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  writeOutline(root, three);
  for (const t of three) writePlan(root, t.n, t.slug, { status: 'written' });
  writeFileSync(join(sectionDirOf(root, 3, 'conclusion'), 'DRAFT.md'), '# Conclusion\n\nNo citations.\n');
  const before = snapshot(root);
  const cases: Array<[string[], RegExp]> = [
    [['plan', '0'], /^pensmith plan: <n> must be a section number from 1 to 99; got "0"$/m],
    [['plan', '100'], /^pensmith plan: <n> must be a section number from 1 to 99; got "100"$/m],
    [['plan', '99'], /^pensmith plan: this paper has no section 99 — its outline has section\(s\) 1-3$/m],
    [['write', '7'], /^pensmith write: this paper has no section 7 — its outline has section\(s\) 1-3$/m],
    [['verify', '99'], /^pensmith verify: this paper has no section 99 — its outline has section\(s\) 1-3$/m],
    [['plan', 'abc'], /^pensmith plan: <n> must be a section number from 1 to 99; got 'abc'$/m],
    [['verify', 'abc'], /^pensmith verify: <n> must be a section number from 1 to 99; got 'abc'$/m],
    [['write', '1', '--slug', '../../etc'], /^pensmith write: --slug must be lowercase letters, digits and hyphens; got "\.\.\/\.\.\/etc"$/m],
    [['write', '1', '--slug', 'conclusion'], /^pensmith write: section 1 is "introduction" in the outline, not "conclusion"/m],
  ];
  for (const [args, message] of cases) {
    const r = runCli(sb, root, args);
    assert.equal(r.status, EXIT_USAGE, `${args.join(' ')}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, message, args.join(' '));
    assert.doesNotMatch(r.stderr, /PENSMITH_DEBUG/, `${args.join(' ')}: an invalid argument is not an internal error`);
    assert.doesNotMatch(r.stderr, STACK_LINE);
  }
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'no placeholder section folder, no file written');
});

test('RUN-12: an unexpected error prints one line plus the PENSMITH_DEBUG hint — no stack', () => {
  const sb = sandbox('exit-unexpected');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'alpha' }]);
  writeOutline(root, [{ n: 1, slug: 'alpha' }]);
  // Frontmatter that parses but fails the PLAN schema (section is not a number).
  writePlan(root, 1, 'alpha', { section: 'not-a-number' });
  const r = runCli(sb, root, ['write', '--yolo']);
  assert.equal(r.status, EXIT_ERROR, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: set PENSMITH_DEBUG=1 for a stack trace$/m);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  const dbg = runCli(sb, root, ['write', '--yolo'], { env: { PENSMITH_DEBUG: '1' } });
  assert.equal(dbg.status, EXIT_ERROR);
  assert.match(dbg.stderr, STACK_LINE, 'PENSMITH_DEBUG=1 prints the stack');
});

test('RUN-12: a failure line carries exactly one pensmith prefix', () => {
  assert.equal(failureLine('export cancelled by user'), 'pensmith: export cancelled by user');
  assert.equal(
    failureLine('pensmith research: no LLM key configured (ANTHROPIC_API_KEY is not set for provider anthropic).'),
    'pensmith research: no LLM key configured (ANTHROPIC_API_KEY is not set for provider anthropic).',
  );
  assert.equal(failureLine('pensmith: already prefixed'), 'pensmith: already prefixed');
  assert.equal(failureLine('pensmith.json is missing'), 'pensmith: pensmith.json is missing');
});

test('RUN-12: the built CLI never prints a doubled "pensmith: pensmith" prefix', () => {
  const sb = sandbox('exit-prefix');
  const cwd = sb.project('p');
  writeState(cwd, [{ n: 1, slug: 'intro' }]);
  const r = runCli(sb, cwd, ['plan', '1'], {
    env: { ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, PENSMITH_NO_LLM: undefined },
  });
  assert.equal(r.status, EXIT_ERROR, r.stderr);
  assert.match(r.stderr, /^pensmith plan: no LLM key configured/m);
  assert.doesNotMatch(r.stderr, /pensmith: pensmith/);
});
