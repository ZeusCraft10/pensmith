// tests/revise-remove-quote.test.ts — `revise` removing a misquotation removes
// the quotation, not only its citation.
//
// For a Pass-3 NOT_FOUND row, `remove` deleted only the `[@key]` token. The
// quotation stayed in quote marks, usually with a narrative attribution
// ("Smith reports that ..."), and the next verify found a quotation with no
// citation: a short one was not checked at all, a long one only warned. A
// fabricated quotation was laundered into an unchecked one. Offline mode always
// proposes `remove`, and --yolo accepts it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRevise } from '../bin/lib/revise.js';
import { extractQuotes } from '../bin/lib/quote-extractor.js';
import { renderPass1VerdictRow, renderPass3VerdictRow } from '../bin/lib/verify/verdict-rows.js';

const PLAN = [
  '---', 'section: 1', 'slug: intro', 'title: Intro', 'depends_on: []',
  'assigned_sources:', '  - smith2020', '  - jones2019',
  "verified_against_draft_hash: 'deadbeefcafe'", 'status: failed', '---', '', '## Brief', '',
].join('\n');

const FABRICATED_QUOTE = 'the treatment cured every patient in the trial within a single week';
const REAL_QUOTE = 'the effect was small but consistent across cohorts';

const DRAFT = [
  '# Intro',
  '',
  `The literature is broad [@jones2019]. Smith reports that "${FABRICATED_QUOTE}" [@smith2020, p. 4]. Other work disagrees [@jones2019].`,
  '',
  `Smith also found that "${REAL_QUOTE}" [@smith2020, p. 9], and noted the cost [@smith2020].`,
  '',
].join('\n');

function seed(draft: string, rows: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-revise-quote-'));
  const dir = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DRAFT.md'), draft);
  writeFileSync(join(dir, 'PLAN.md'), PLAN);
  writeFileSync(join(dir, 'VERIFICATION.md'), ['# VERIFICATION (Section 1, intro)', '', 'Status: failed', '', ...rows, ''].join('\n'));
  return root;
}

const draftOf = (root: string): string => readFileSync(join(root, '.paper', 'sections', '01-intro', 'DRAFT.md'), 'utf8');
const planOf = (root: string): string => readFileSync(join(root, '.paper', 'sections', '01-intro', 'PLAN.md'), 'utf8');

const REMOVE = (key: string): string => JSON.stringify({
  action: 'remove', flagged_citekey: key, replacement_citekey: null, rationale: 'the quotation is not in the source',
  patch: { before_excerpt: `[@${key}]`, after_excerpt: '' },
});

async function revise(root: string, raw: string): Promise<{ res: Awaited<ReturnType<typeof runRevise>>; shown: string[] }> {
  const shown: string[] = [];
  const res = await runRevise({
    paperRoot: root, n: 1, slug: 'intro', yolo: false,
    proposeSwap: () => Promise.resolve(raw),
    approve: (p) => { shown.push(p.patch.before_excerpt); return Promise.resolve(true); },
  });
  return { res, shown };
}

const NOT_FOUND_ROW = renderPass3VerdictRow('smith2020', FABRICATED_QUOTE.slice(0, 40), 'NOT_FOUND', 0, 'quote not found word for word in the OA PDF');

test('revise remove on a NOT_FOUND quotation deletes the quotation, and the key stays where it is checked', async () => {
  const root = seed(DRAFT, ['## Pass-3', '', NOT_FOUND_ROW]);
  const { res, shown } = await revise(root, REMOVE('smith2020'));
  assert.equal(res.accepted, true, res.message);
  const after = draftOf(root);
  assert.ok(!after.includes('cured every patient'), `the quotation is gone:\n${after}`);
  assert.ok(!after.includes('Smith reports that'), 'with the sentence that introduced it');
  // Every other sentence is untouched, including the other quotation of the same work.
  assert.equal(after, [
    '# Intro',
    '',
    'The literature is broad [@jones2019]. Other work disagrees [@jones2019].',
    '',
    `Smith also found that "${REAL_QUOTE}" [@smith2020, p. 9], and noted the cost [@smith2020].`,
    '',
  ].join('\n'));
  // Nothing is left quoted without its citation.
  assert.deepEqual(extractQuotes(after).map((q) => [q.text, q.citekey]), [[REAL_QUOTE, 'smith2020']]);
  // The approval gate showed what is deleted, and verify must run again.
  assert.match(shown[0] ?? '', /cured every patient/);
  assert.match(planOf(root), /verified_against_draft_hash:\s*(null|~)\s*$/m);
  assert.match(res.message, /re-run verify|verify again/i);
});

test('revise remove on a NOT_FOUND block quotation deletes the block quote', async () => {
  const draft = [
    '# Intro',
    '',
    'As Smith wrote:',
    '',
    `> ${FABRICATED_QUOTE}, as every reviewer agreed [@smith2020, p. 4].`,
    '',
    'Other work disagrees [@jones2019].',
    '',
  ].join('\n');
  const root = seed(draft, ['## Pass-3', '', NOT_FOUND_ROW]);
  const { res } = await revise(root, REMOVE('smith2020'));
  assert.equal(res.accepted, true, res.message);
  const after = draftOf(root);
  assert.ok(!after.includes('cured every patient'), after);
  assert.ok(!after.includes('As Smith wrote'), `the line introducing the block goes with it:\n${after}`);
  assert.deepEqual(extractQuotes(after), []);
  assert.match(after, /Other work disagrees \[@jones2019\]\./);
});

test('revise remove of a FABRICATED key also deletes a quotation attributed only to it', async () => {
  const draft = `# Intro\n\nGhost argues that "rates fell by half in a single year" [@ghost2099, p. 2]. Others agree [@jones2019; @ghost2099].\n`;
  const row = renderPass1VerdictRow('ghost2099', 'FABRICATED', 0, 0, 'no registry holds DOI 10.1038/x');
  const root = seed(draft, ['## Pass-1', '', row]);
  const { res } = await revise(root, REMOVE('ghost2099'));
  assert.equal(res.accepted, true, res.message);
  const after = draftOf(root);
  assert.equal(after, '# Intro\n\nOthers agree [@jones2019].\n');
  assert.deepEqual(extractQuotes(after), []);
});

test('revise remove keeps a quotation another cited work still answers for', async () => {
  // The quotation stays attributed to jones2019 and is checked against it on the next verify.
  const draft = `# Intro\n\nIt is said that "rates fell by half in a single year" [@jones2019; @ghost2099, p. 2].\n`;
  const row = renderPass1VerdictRow('ghost2099', 'FABRICATED', 0, 0, 'no registry holds DOI 10.1038/x');
  const root = seed(draft, ['## Pass-1', '', row]);
  const { res } = await revise(root, REMOVE('ghost2099'));
  assert.equal(res.accepted, true, res.message);
  assert.equal(draftOf(root), '# Intro\n\nIt is said that "rates fell by half in a single year" [@jones2019].\n');
});

test('pensmith plan --revise --yolo offline (which always proposes remove) deletes the misquotation, not only its key', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { isolatedCliEnv } = await import('./lib/cli-env.js');
  const root = seed(DRAFT, ['## Pass-3', '', NOT_FOUND_ROW]);
  const r = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url)), 'plan', '1', '--slug', 'intro', '--revise', '--yolo'],
    { cwd: root, env: isolatedCliEnv({ PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: '1' }), encoding: 'utf8' },
  );
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const after = draftOf(root);
  assert.ok(!after.includes('cured every patient'), after);
  assert.deepEqual(extractQuotes(after).map((q) => q.citekey), ['smith2020'], 'only the quotation that was found is left');
  assert.match(r.stdout, /re-run verify/);
});

test('revise remove on a NOT_FOUND block quotation introduced by a narrative citation deletes both', async () => {
  const draft = `# Intro\n\nAs @smith2020 [p. 4] wrote:\n\n> ${FABRICATED_QUOTE}, as every reviewer agreed.\n\nOther work disagrees [@jones2019].\n`;
  const root = seed(draft, ['## Pass-3', '', NOT_FOUND_ROW]);
  const { res } = await revise(root, REMOVE('smith2020'));
  assert.equal(res.accepted, true, res.message);
  assert.equal(draftOf(root), '# Intro\n\nOther work disagrees [@jones2019].\n');
});

// A misquotation that cites two works was kept, attributed to the other one,
// whatever the verifier said about it there. When the other work had no
// open-access text, the next verify read PDF_UNAVAILABLE, which does not
// block: the evidence that the quotation is not in one of its cited works was
// thrown away. It is kept only where another cited work was found to hold it.
const COCITED = `# Intro\n\nThe literature is broad [@jones2019]. It is reported that "${FABRICATED_QUOTE}" [@smith2020; @jones2019, p. 2]. Other work disagrees [@jones2019].\n`;
const pass3Row = (key: string, verdict: string): string =>
  renderPass3VerdictRow(key, FABRICATED_QUOTE.slice(0, 40), verdict, verdict === 'OK' ? 1 : 0, verdict === 'OK' ? 'quote found word for word' : 'no OA PDF');

test('revise remove deletes a co-cited misquotation that no other cited work was found to hold', async () => {
  for (const other of ['PDF_UNAVAILABLE', 'TEXT_UNAVAILABLE', 'NOT_FOUND']) {
    const root = seed(COCITED, ['## Pass-3', '', NOT_FOUND_ROW, pass3Row('jones2019', other)]);
    const { res, shown } = await revise(root, REMOVE('smith2020'));
    assert.equal(res.accepted, true, res.message);
    assert.equal(draftOf(root), '# Intro\n\nThe literature is broad [@jones2019]. Other work disagrees [@jones2019].\n', other);
    assert.match(shown[0] ?? '', /cured every patient/, 'the gate showed the deleted quotation');
  }
});

test('revise remove --yolo deletes a co-cited misquotation whose other work had no open-access text', async () => {
  const root = seed(COCITED, ['## Pass-3', '', NOT_FOUND_ROW, pass3Row('jones2019', 'PDF_UNAVAILABLE')]);
  const res = await runRevise({ paperRoot: root, n: 1, slug: 'intro', yolo: true, proposeSwap: () => Promise.resolve(REMOVE('smith2020')) });
  assert.equal(res.accepted, true, res.message);
  assert.deepEqual(extractQuotes(draftOf(root)), []);
});

test('revise remove keeps a co-cited misquotation another cited work was found to hold, and drops the flagged key', async () => {
  const root = seed(COCITED, ['## Pass-3', '', NOT_FOUND_ROW, pass3Row('jones2019', 'OK')]);
  const { res } = await revise(root, REMOVE('smith2020'));
  assert.equal(res.accepted, true, res.message);
  assert.equal(draftOf(root),
    `# Intro\n\nThe literature is broad [@jones2019]. It is reported that "${FABRICATED_QUOTE}" [@jones2019, p. 2]. Other work disagrees [@jones2019].\n`);
});

test('revise remove says what it deleted on one line, with an ellipsis only when it cut the text short', async () => {
  const short = '# Intro\n\nSmith said "the trial\nwas stopped early" [@smith2020, p. 4]. Other work disagrees [@jones2019].\n';
  const row = renderPass3VerdictRow('smith2020', 'the trial was stopped early', 'NOT_FOUND', 0, 'quote not found word for word');
  const root = seed(short, ['## Pass-3', '', row]);
  const { res } = await revise(root, REMOVE('smith2020'));
  assert.equal(res.accepted, true, res.message);
  assert.match(res.message, /Deleted the misquotation: "Smith said "the trial was stopped early" \[@smith2020, p\. 4\]\."\./);
  assert.doesNotMatch(res.message, /\n/);

  const long = seed(DRAFT, ['## Pass-3', '', NOT_FOUND_ROW]);
  const { res: res2 } = await revise(long, REMOVE('smith2020'));
  assert.match(res2.message, /Deleted the misquotation: "Smith reports that "the treatment cured every patient in the…"\./);
});
