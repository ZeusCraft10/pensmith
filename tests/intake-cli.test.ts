// tests/intake-cli.test.ts — GRND-01..05 through the BUILT CLI (the user path):
// `pensmith new` in a temp folder with an isolated data dir, a stdin that is
// never a terminal, and the model stubbed (PENSMITH_NO_LLM) unless a test
// starts the RUN-21 mock.
//
//   GRND-01  folder pickup, piped stdin, @file.pdf (text only, no %PDF- in
//            .paper/), @missing / @.docx refusals, no assignment → exit 2
//            with nothing written;
//   GRND-02  the non-TTY refusal names the questions before any model call;
//            --answers answers everything; numbered-mode scripted answers
//            walk the battery and the follow-up; --class reaches `list`;
//   GRND-03  INTAKE.md is a valid brief (topic, APA, 1500) and config.toml
//            [project]/[style] mirror the answers;
//   GRND-04  --citation-style Chicago → chicago-notes-bib, an unknown style
//            lists the 8, "Use MLA for this paper" in a Biology assignment,
//            a sectioning note reaches the brief.

import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSIGNMENT_FIXTURE, REPO, STACK_LINE, runCli, sandbox } from './helpers/paper-cli-harness.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { readIntakeBrief } from '../bin/lib/intake-brief.js';
import { parsePaperConfigText } from '../bin/lib/config.js';
import { TUTORIAL_INTAKE_QUESTION } from '../bin/lib/tutorial.js';
import { EXIT_APPROVAL, EXIT_OK, EXIT_USAGE } from '../bin/lib/exit-codes.js';

const PDF_FIXTURE = join(REPO, 'tests', 'fixtures', 'assignment.pdf');
const A1 = readFileSync(ASSIGNMENT_FIXTURE, 'utf8');

function config(root: string): Record<string, Record<string, unknown>> {
  return parsePaperConfigText(readFileSync(join(root, '.paper', 'config.toml'), 'utf8')).config as unknown as Record<string, Record<string, unknown>>;
}

function allFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...allFiles(p));
    else out.push(p);
  }
  return out;
}

test('GRND-01/03: `new --yolo` beside the PRD §15 assignment writes a valid brief and mirrors it into config.toml', () => {
  const sb = sandbox('intake-a1');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), A1);
  const r = runCli(sb, root, ['new', '--yolo', '--counterargument', 'yes']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^pensmith new: using the assignment file in this folder: assignment\.txt$/m);
  assert.match(r.stdout, /^pensmith new: --yolo accepted the suggested intake defaults:$/m);
  const doc = readIntakeBrief(root);
  assert.ok(doc, 'INTAKE.md validates as the brief');
  assert.match(doc.brief.topic, /attention/i);
  assert.match(doc.brief.topic, /transformer/i);
  assert.equal(doc.brief.citation_style, 'apa');
  assert.equal(doc.brief.length_target_words, 1500);
  assert.equal(doc.brief.paper_type, 'literature-review');
  assert.equal(doc.brief.counterargument, 'yes');
  assert.equal(doc.assignment, A1.trim(), 'the assignment, verbatim');
  assert.deepEqual(doc.brief.assignment_source, { kind: 'cwd', name: 'assignment.txt' });
  const project = config(root)['project'] ?? {};
  assert.equal(project['mode'], 'draft');
  assert.equal(project[TUTORIAL_INTAKE_QUESTION.key], TUTORIAL_INTAKE_QUESTION.defaultValue);
  assert.equal(project['class'], 'Unfiled');
  assert.equal(project['discipline_preset'], doc.brief.discipline);
  assert.equal(project['citation_style'], 'apa');
  assert.equal(project['length_target_words'], 1500);
  assert.equal(project['counterargument_required'], true, 'a yes/no answer is mirrored');
  assert.equal(project['pii_redaction'], false);
  assert.equal(config(root)['style']?.['match_past_writing'], false);
  assert.doesNotMatch(r.stderr, STACK_LINE);
});

test('GRND-01: an assignment piped on stdin is captured (and a bare run with a piped assignment starts a paper here)', () => {
  const sb = sandbox('intake-stdin');
  const root = sb.project('p');
  const r = runCli(sb, root, ['new', '--yolo'], { input: 'Argue whether social media harms adolescents\n' });
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  const doc = readIntakeBrief(root)!;
  assert.equal(doc.assignment, 'Argue whether social media harms adolescents');
  assert.deepEqual(doc.brief.assignment_source, { kind: 'stdin', name: '' });
  assert.equal(doc.brief.paper_type, 'argumentative');
  const bare = sb.project('bare');
  const b = runCli(sb, bare, ['--yolo'], { input: A1 });
  assert.equal(b.status, EXIT_OK, `${b.stdout}\n${b.stderr}`);
  assert.equal(readIntakeBrief(bare)?.brief.assignment_source.kind, 'stdin', 'bare `pensmith --yolo < assignment` routes to new');
});

test('GRND-01: `new @assignment.pdf --yolo` stores the PDF\'s text — no %PDF- byte reaches .paper/', () => {
  const sb = sandbox('intake-pdf');
  const root = sb.project('p');
  copyFileSync(PDF_FIXTURE, join(root, 'brief.pdf'));
  const r = runCli(sb, root, ['new', '@brief.pdf', '--yolo']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  const doc = readIntakeBrief(root)!;
  assert.match(doc.assignment, /The review must compare self-attention with recurrent sequence models\./);
  assert.deepEqual(doc.brief.assignment_source, { kind: 'at-file', name: 'brief.pdf' });
  for (const f of allFiles(join(root, '.paper'))) {
    assert.ok(!readFileSync(f).includes(Buffer.from('%PDF-')), `${f} holds no PDF bytes`);
  }
});

test('GRND-01: missing, unsupported and absent assignments fail with one line and write nothing', () => {
  const sb = sandbox('intake-refusals');
  const root = sb.project('p');
  writeFileSync(join(root, 'file.docx'), 'PK');
  const cases: Array<[string[], RegExp]> = [
    [['new', '@missing.txt', '--yolo'], /^pensmith: @missing\.txt: no such file$/m],
    [['new', '@file.docx', '--yolo'], /^pensmith: @file\.docx: unsupported file type "\.docx" — supported types: \.txt, \.md, \.pdf$/m],
    [['new', '--from', 'nope.md', '--yolo'], /^pensmith: --from nope\.md: no such file$/m],
    [['new', '--yolo'], /^pensmith: no assignment found: /m],
  ];
  for (const [args, line] of cases) {
    const r = runCli(sb, root, args); // stdin is /dev/null: never a terminal, never a pipe
    assert.equal(r.status, EXIT_USAGE, `${args.join(' ')}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, line, args.join(' '));
    assert.doesNotMatch(r.stderr, STACK_LINE);
    assert.ok(!existsSync(join(root, '.paper')), `${args.join(' ')} wrote nothing`);
  }
});

test('GRND-02: without a terminal, --yolo or --answers, `new` exits 3 naming the unanswered questions — before any model request or write', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-intake-refusal-0001' }, paper: false }, async (sb) => {
    writeFileSync(join(sb.root, 'assignment.txt'), A1);
    const r = await sb.runTsx(null, ['new', '--class', 'PHIL 101']);
    assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: Accept the intake defaults\? \(unanswered: pii_redaction \(--pii-redact \/ --no-pii-redact\), discipline \(--discipline\), mode \(--mode\), .*length \(--length\), citation_style \(--citation-style\) — answer them with those flags or --answers <file\.toml>\) needs an answer: re-run in a terminal, or pass --yolo to accept the defaults\.$/m);
    assert.doesNotMatch(r.stderr, /class \(--class\)/, 'the answered question is not named');
    assert.equal(sb.mock!.callCount(), 0, 'no model request');
    assert.ok(!existsSync(sb.paper), 'nothing written');
  });
});

test('GRND-02: --answers <file.toml> answers the battery (no --yolo needed); an unknown key is refused listing the valid keys', () => {
  const sb = sandbox('intake-answers');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), A1);
  writeFileSync(
    join(root, 'answers.toml'),
    [
      'pii_redaction = false',
      'discipline = "Computer Science"',
      'mode = "outline"',
      `${TUTORIAL_INTAKE_QUESTION.key} = "${TUTORIAL_INTAKE_QUESTION.options[2]?.value}"`,
      'class = "CS 480"',
      'counterargument = "no"',
      'style_samples = "no"',
      'length = "6 pages"',
      'citation_style = "IEEE"',
      '',
      '[follow_ups]',
      'audience = "machine-learning students"',
      '',
    ].join('\r\n'),
  );
  const r = runCli(sb, root, ['new', '--answers', 'answers.toml']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stdout, /--yolo accepted/);
  const b = readIntakeBrief(root)!.brief;
  assert.equal(b.discipline, 'computer-science');
  assert.equal(b.mode, 'outline');
  assert.equal((b as Record<string, unknown>)[TUTORIAL_INTAKE_QUESTION.key], TUTORIAL_INTAKE_QUESTION.options[2]?.value);
  assert.equal(b.class, 'CS 480');
  assert.equal(b.counterargument, 'no');
  assert.equal(b.length_target_words, 1800);
  assert.equal(b.citation_style, 'ieee', 'the answer wins over the assignment\'s "APA style"');
  assert.deepEqual(b.follow_ups, [{ id: 'audience', question: 'Who is the intended audience for this paper?', answer: 'machine-learning students' }]);
  assert.equal(config(root)['project']?.['counterargument_required'], false);

  writeFileSync(join(root, 'bad.toml'), 'dicsipline = "history"\n');
  const bad = runCli(sb, sb.project('q'), ['new', '--from', join(root, 'assignment.txt'), '--answers', join(root, 'bad.toml')]);
  assert.equal(bad.status, EXIT_USAGE);
  assert.match(bad.stderr, /unknown key "dicsipline" \(valid keys: pii_redaction, discipline, mode, .*, thesis, follow_ups\)$/m);
});

test('GRND-02: PENSMITH_PROMPT_MODE=numbered — scripted answers walk the battery and the follow-up', () => {
  const sb = sandbox('intake-numbered');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), A1);
  // pii (confirm), discipline (select #), mode, purpose, class, counterargument, style samples, length, style, follow-up
  const answers = ['n', '1', '1', '', 'CS 480', '2', '', '2000', '', 'my classmates', ''].join('\n');
  const r = runCli(sb, root, ['new', '--from', 'assignment.txt'], { input: answers, env: { PENSMITH_PROMPT_MODE: 'numbered' } });
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  const b = readIntakeBrief(root)!.brief;
  assert.equal(b.discipline, 'computer-science', 'option 1');
  assert.equal(b.class, 'CS 480');
  assert.equal(b.counterargument, 'yes', 'option 2');
  assert.equal(b.length_target_words, 2000);
  assert.equal(b.citation_style, 'apa', 'the default offered is the assignment\'s own "APA style", not the CS preset\'s IEEE');
  assert.deepEqual(b.follow_ups.map((f) => f.answer), ['my classmates']);
  const intake = readFileSync(join(root, '.paper', 'INTAKE.md'), 'utf8');
  assert.match(intake, /- \*\*class\*\*: Which class is this paper for\?.*\n {2}- CS 480 — answered/);
});

test('GRND-02: `new --class "PHIL 101" --discipline psychology --yolo` with a piped assignment; `pensmith list` elsewhere shows [PHIL 101]', () => {
  const sb = sandbox('intake-class');
  const root = sb.project('paper');
  const r = runCli(sb, root, ['new', '--class', 'PHIL 101', '--discipline', 'psychology', '--yolo'], { input: A1 });
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.equal(readIntakeBrief(root)?.brief.discipline, 'psychology');
  const list = runCli(sb, sb.project('elsewhere'), ['list']);
  assert.equal(list.status, EXIT_OK, list.stderr);
  assert.match(list.stdout, /^ {2}\[PHIL 101\]$/m);
});

test('GRND-04: --citation-style resolves aliases (Chicago → chicago-notes-bib) and refuses an unknown style listing the 8', () => {
  const sb = sandbox('intake-style');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), A1);
  const ok = runCli(sb, root, ['new', '--yolo', '--citation-style', 'Chicago']);
  assert.equal(ok.status, EXIT_OK, `${ok.stdout}\n${ok.stderr}`);
  assert.equal(config(root)['project']?.['citation_style'], 'chicago-notes-bib');
  assert.equal(readIntakeBrief(root)?.brief.citation_style, 'chicago-notes-bib');
  const other = sb.project('q');
  writeFileSync(join(other, 'assignment.txt'), A1);
  const bad = runCli(sb, other, ['new', '--yolo', '--citation-style', 'nonsense']);
  assert.equal(bad.status, EXIT_USAGE);
  const line = bad.stderr.split('\n').find((l) => l.startsWith('pensmith: '));
  assert.ok(line, bad.stderr);
  for (const s of ['APA', 'MLA', 'Chicago (Notes-Bibliography)', 'Chicago (Author-Date)', 'IEEE', 'AMA', 'Vancouver', 'Harvard']) assert.ok(line.includes(s), `lists ${s}`);
  assert.ok(!existsSync(join(other, '.paper')), 'nothing written');
});

test('GRND-04: a Biology assignment saying "Use MLA for this paper" → discipline_preset biology, citation_style mla; a sectioning note reaches the brief', () => {
  const sb = sandbox('intake-override');
  const root = sb.project('p');
  writeFileSync(
    join(root, 'assignment.md'),
    'For my Biology class: write a 2000-word review of CRISPR gene drives in mosquitoes.\nUse MLA for this paper.\nI need a literature review section before methods.\n',
  );
  const r = runCli(sb, root, ['new', '--yolo']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  const project = config(root)['project'] ?? {};
  assert.equal(project['discipline_preset'], 'biology');
  assert.equal(project['citation_style'], 'mla', 'the plain-English override beats the Biology preset\'s AMA');
  const b = readIntakeBrief(root)!.brief;
  assert.deepEqual(b.sectioning_notes, ['I need a literature review section before methods']);
  assert.equal(b.length_target_words, 2000);
});

test('GRND-02: `new --questions` prints the battery as JSON and touches nothing', () => {
  const sb = sandbox('intake-questions');
  const root = sb.project('p');
  const r = runCli(sb, root, ['new', '--questions']);
  assert.equal(r.status, EXIT_OK, r.stderr);
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as { questions: Array<{ id: string; flag: string; answers_key: string }> };
  assert.equal(out.questions.length, 9);
  assert.deepEqual(out.questions.map((q) => q.answers_key), ['pii_redaction', 'discipline', 'mode', TUTORIAL_INTAKE_QUESTION.key, 'class', 'counterargument', 'style_samples', 'length', 'citation_style']);
  assert.ok(!existsSync(join(root, '.paper')));
});
