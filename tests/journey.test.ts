// tests/journey.test.ts — the whole pipeline, from an empty folder holding
// assignment.txt to an exported paper, through bare `pensmith` only.
//
// Every other test seeds the state of one step. This one starts from nothing
// and runs bare `pensmith` again and again, as a user (or the plugin skill)
// does, answering each question it stops for (exit 3) the way a user would
// accept its suggestion, until the router says the paper is done. The model is
// scripted (tests/lib/journey-generator.ts, loaded into the real CLI process),
// and every registry answer is a recording of the real registry: the searches
// research makes, the Crossref and OpenAlex records verify reads, and the
// open-access PDF a quotation is checked against.
//
// Along the way it checks that:
//   - the router takes exactly the expected steps, and every decision says why;
//   - the assignment is kept word for word;
//   - the sections the outline proposes are the paper's sections;
//   - each section's drafter is shown, and its draft cites, only the works its
//     plan assigns;
//   - `pensmith --dry-run` before each step changes nothing in .paper/ and calls
//     no model;
//   - and, after the export, that a hand edit of the compiled draft or a swapped
//     bibliography entry makes the export refuse with exit 2.
//
// The main CI matrix has no Pandoc, so there the paper is exported as Markdown
// (Pandoc is taken off PATH). The export lane (.github/workflows/export.yml)
// installs Pandoc and sets PENSMITH_REQUIRE_EXPORT_TOOLS=1, which runs the
// same journey to a .docx and fails if Pandoc is missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { citedKeys, findCitations } from '../bin/lib/citation-grammar.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { sectionDirName } from '../bin/lib/paths.js';
import { assignedSourcesFrom } from '../bin/lib/plan-status.js';
import { scriptedCli, type CliStreams } from './lib/cli-env.js';
import { docxParts } from './lib/docx-fixture.js';
import { hasTool, pathWithoutPandoc } from './lib/export-fixture.js';
import { fileHashes } from './lib/files.js';
import { DRAFTS, QUOTE, SECTIONS, VISIBLE } from './lib/journey-generator.js';

const GENERATOR = fileURLToPath(new URL('./lib/journey-generator.ts', import.meta.url));

const ASSIGNMENT = [
  'MATH 340: Discrete Geometry, term paper',
  '',
  'Write a 1,500-word review of what is known about visible islands in planar point',
  "sets: what a visible island is, how Horton's construction bears on the question,",
  'and which cases remain open. Use peer-reviewed sources and cite them in APA style.',
  '',
].join('\n');

/** docx in the export lane, which installs Pandoc; Markdown everywhere else. */
const FORMAT: 'docx' | 'md' = process.env['PENSMITH_REQUIRE_EXPORT_TOOLS'] === '1' ? 'docx' : 'md';

interface Journey {
  root: string;
  log: string;
  /** The CLI with `args`, in the journey's folder or in `cwd`. */
  run(args: string[], cwd?: string): CliStreams;
}

function journey(): Journey {
  const root = mkdtempSync(path.join(tmpdir(), 'pensmith-journey-'));
  const log = path.join(mkdtempSync(path.join(tmpdir(), 'pensmith-journey-log-')), 'model-calls.jsonl');
  writeFileSync(path.join(root, 'assignment.txt'), ASSIGNMENT);
  const cli = scriptedCli(GENERATOR, { PENSMITH_JOURNEY_LOG: log, ...(FORMAT === 'md' ? { PATH: pathWithoutPandoc() } : {}) });
  return { root, log, run: (args, cwd = root) => cli(cwd, args) };
}

/** Every file under `dir` → its SHA-256, or null when there is no `dir`. */
const snapshot = (dir: string): Map<string, string> | null => (existsSync(dir) ? fileHashes(dir) : null);

/** The text of a .docx's body, a line per paragraph. */
async function docxText(file: string): Promise<string> {
  const xml = (await docxParts(file)).get('word/document.xml') ?? '';
  return xml.split(/<w:p[ >]/).map((p) => p.replace(/<[^>]+>/g, '')).join('\n')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

const modelCalls = (log: string): Array<{ step: string; shown: string[]; user: string }> =>
  existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { step: string; shown: string[]; user: string }) : [];

/** The router's choice, from the line bare `pensmith` prints on stderr: `pensmith: → <step> — <why>`. */
function decision(stderr: string): { step: string; why: string } | null {
  const m = /^pensmith: → (?:pensmith )?(.+?) — (.+)$/m.exec(stderr);
  return m ? { step: m[1]!.trim(), why: m[2]!.trim() } : null;
}

/** The pending decision a step stopped for (exit 3): the last JSON line on stdout. */
function pending(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split('\n').reverse().find((l) => l.startsWith('{'));
  assert.ok(line, `exit 3 prints the pending decision as JSON:\n${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

/** The answer a user gives who accepts what each question suggests (and approves the outline and the export). */
function answer(j: Journey, p: Record<string, unknown>): CliStreams {
  switch (p['pending']) {
    case 'intake-questions': {
      const answers = Object.fromEntries((p['questions'] as Array<{ id: string; suggested: string }>).map((q) => [q.id, q.suggested]));
      return j.run(['new', '--answers', JSON.stringify(answers)]);
    }
    case 'research-candidates':
      return j.run(['gate', 'answer', String(p['ref']), (p['default'] as string[]).join(',')]);
    case 'outline-approval':
      return j.run(['gate', 'answer', String(p['ref']), 'approve']);
    case 'export-confirmation':
      return j.run(['gate', 'answer', String(p['ref']), 'export']);
    default:
      throw new Error(`the journey does not expect to stop for ${JSON.stringify(p)}`);
  }
}

const EXPECTED_STEPS = [
  'new',
  'research',
  'outline',
  ...SECTIONS.flatMap((_, i) => [`plan ${i + 1}`, `write ${i + 1}`, `verify ${i + 1}`]),
  'compile',
  'done',
  'status (done)',
];

test(`journey: bare pensmith takes an assignment to an exported ${FORMAT}, and a later edit or bibliography swap stops the export`, async () => {
  if (FORMAT === 'docx') assert.ok(hasTool('pandoc'), 'the export lane needs Pandoc on PATH (PENSMITH_REQUIRE_EXPORT_TOOLS=1)');
  const j = journey();
  const paper = path.join(j.root, '.paper');
  const steps: string[] = [];
  const stops: string[] = [];

  for (let i = 0; i < 40 && steps.at(-1) !== 'status (done)'; i++) {
    // A dry run first: it names the same step, writes nothing and calls no model.
    const before = snapshot(paper);
    const callsBefore = modelCalls(j.log).length;
    const dry = j.run(['--dry-run']);
    assert.equal(dry.status, 0, `--dry-run exits 0\n${dry.stdout}${dry.stderr}`);
    assert.deepEqual(snapshot(paper), before, `--dry-run before step ${i + 1} changed .paper/`);
    assert.equal(modelCalls(j.log).length, callsBefore, '--dry-run made a model call');

    const r = j.run([]);
    const d = decision(r.stderr);
    assert.ok(d, `bare pensmith names its step\n${r.stderr}`);
    assert.ok(d.why.length > 0, `every decision says why: ${d.step}`);
    steps.push(d.step);
    if (d.step === 'status (done)') {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      break;
    }
    if (r.status === 3) {
      const p = pending(r.stdout);
      stops.push(String(p['pending']));
      const a = answer(j, p);
      assert.equal(a.status, 0, `answering ${String(p['pending'])}\n${a.stdout}${a.stderr}`);
      continue;
    }
    assert.equal(r.status, 0, `step ${d.step} (${d.why})\n${r.stdout}${r.stderr}`);
  }

  // ---- the router's transitions ----
  assert.deepEqual(steps, EXPECTED_STEPS);
  assert.deepEqual(stops, ['intake-questions', 'research-candidates', 'outline-approval', 'export-confirmation'],
    'each approval gate stopped for the user (none was skipped)');

  // ---- the assignment is kept, and it is what the model was given ----
  const project = readFileSync(path.join(paper, 'PROJECT.md'), 'utf8');
  assert.ok(project.includes(ASSIGNMENT.trim()), `PROJECT.md keeps the assignment word for word:\n${project}`);
  const calls = modelCalls(j.log);
  const intake = calls.find((c) => c.step === 'intake');
  assert.ok(intake?.user.includes(ASSIGNMENT.trim()), 'the intake clarifier read the assignment');

  // ---- the outline's sections are the paper's sections ----
  const outline = JSON.parse(readFileSync(path.join(paper, 'OUTLINE.json'), 'utf8')) as { sections: Array<{ n: number; slug: string; assigned_sources: string[] }> };
  assert.deepEqual(outline.sections.map((s) => s.slug), SECTIONS.map((s) => s.slug));
  const state = JSON.parse(readFileSync(path.join(paper, 'STATE.json'), 'utf8')) as { sections: Array<{ n: number; slug: string }> };
  assert.deepEqual(state.sections.map((s) => [s.n, s.slug]), SECTIONS.map((s, i) => [i + 1, s.slug]));
  const dirs = readdirSync(path.join(paper, 'sections')).sort();
  assert.deepEqual(dirs, SECTIONS.map((s, i) => sectionDirName(i + 1, s.slug)));

  // ---- each section saw, and cites, only its own works ----
  const writes = calls.filter((c) => c.step === 'write');
  assert.equal(writes.length, SECTIONS.length, 'one draft per section, none repeated');
  for (const [i, dir] of dirs.entries()) {
    const sec = path.join(paper, 'sections', dir);
    const assigned = assignedSourcesFrom(parseFrontmatter(readFileSync(path.join(sec, 'PLAN.md'), 'utf8')).frontmatter);
    assert.deepEqual(assigned, outline.sections[i]!.assigned_sources, `${dir}: the plan assigns the outline's sources`);
    const draft = readFileSync(path.join(sec, 'DRAFT.md'), 'utf8');
    assert.ok(draft.includes(DRAFTS[SECTIONS[i]!.slug](assigned[0]!).trim()), `${dir}: DRAFT.md is the drafter's text`);
    assert.deepEqual(citedKeys(findCitations(draft)), assigned, `${dir} cites only its assigned works`);
    const write = writes.find((w) => w.user.includes(`"${SECTIONS[i]!.title}"`));
    assert.deepEqual(write?.shown, assigned, `${dir}: the drafter was shown only its assigned works`);
    const record = JSON.parse(readFileSync(path.join(sec, 'VERIFICATION.json'), 'utf8')) as {
      status: string; citations: Array<{ citekey: string; verdict: string }>; quotes: Array<{ verdict: string; reason: string }>;
    };
    assert.equal(record.status, 'verified', dir);
    assert.deepEqual(record.citations.map((c) => [c.citekey, c.verdict]), assigned.map((k) => [k, 'OK']));
    if (i === 0) {
      // The quotation was checked against the paper's real open-access text.
      assert.deepEqual(record.quotes.map((q) => q.verdict), ['OK']);
      assert.match(record.quotes[0]!.reason, /arxiv\.org\/pdf\/2109\.00022/);
    }
  }

  // ---- the export ----
  const exported = path.join(paper, 'export', FORMAT === 'docx' ? 'DRAFT.docx' : 'DRAFT.md');
  assert.ok(existsSync(exported), `the paper was exported to ${exported}`);
  const text = FORMAT === 'docx' ? await docxText(exported) : readFileSync(exported, 'utf8');
  assert.match(text, /Visible Islands in Planar Point Sets/, 'the paper title');
  for (const s of SECTIONS) assert.ok(text.includes(s.title), `the heading ${s.title}`);
  assert.ok(text.includes(QUOTE), 'the verified quotation');
  assert.match(text, /Leuchtner et al\.,? 2022/, 'citations are rendered in APA');
  assert.doesNotMatch(text, /\[@/, 'no citation markup is left');
  for (const [part, body] of FORMAT === 'docx' ? await docxParts(exported) : new Map([['DRAFT.md', text]])) {
    assert.doesNotMatch(body, /pensmith|\.paper|journey/i, `${part} carries no trace of the tool or the paper's folder`);
  }
  const record = JSON.parse(readFileSync(path.join(paper, 'EXPORT.json'), 'utf8')) as { format: string };
  assert.equal(record.format, FORMAT);
  const ledger = readFileSync(path.join(paper, 'COSTS.jsonl'), 'utf8').trim().split('\n');
  assert.equal(ledger.length, calls.length, 'every model call is on the cost ledger');

  // ---- after the export: a hand edit, or a bibliography swap, makes export refuse ----
  const edited = mkdtempSync(path.join(tmpdir(), 'pensmith-journey-edit-'));
  cpSync(j.root, edited, { recursive: true });
  const draftFile = path.join(edited, '.paper', 'DRAFT.md');
  writeFileSync(draftFile, readFileSync(draftFile, 'utf8').replace('the question is still open', 'the question was settled long ago [@fabilamonroy2012]'));
  const editedRun = j.run(['done', '--yolo'], edited);
  assert.equal(editedRun.status, 2, `export after a hand edit of the compiled draft exits 2\n${editedRun.stdout}${editedRun.stderr}`);
  assert.match(editedRun.stdout + editedRun.stderr, /DRAFT\.md changed after compile/);

  const swapped = mkdtempSync(path.join(tmpdir(), 'pensmith-journey-swap-'));
  cpSync(j.root, swapped, { recursive: true });
  const bibFile = path.join(swapped, '.paper', 'CITATIONS.bib');
  writeFileSync(bibFile, readFileSync(bibFile, 'utf8').replace(`doi = {${VISIBLE.doi}}`, 'doi = {10.99999/fake.001}'));
  const swappedRun = j.run(['done', '--yolo'], swapped);
  assert.equal(swappedRun.status, 2, `export after a bibliography swap exits 2\n${swappedRun.stdout}${swappedRun.stderr}`);
  assert.match(swappedRun.stdout + swappedRun.stderr, /CITATIONS\.bib entry for \[@leuchtner2022\] changed after compile/);
  for (const dir of [edited, swapped]) {
    assert.equal(readFileSync(path.join(dir, '.paper', 'EXPORT.json'), 'utf8'), readFileSync(path.join(paper, 'EXPORT.json'), 'utf8'), 'the refused export recorded nothing new');
  }
});
