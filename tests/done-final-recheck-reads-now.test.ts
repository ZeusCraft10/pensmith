// tests/done-final-recheck-reads-now.test.ts — done checks a humanized
// FINAL.md against its sources and sections as they are when it checks it.
//
// done checks the compiled draft again before any audit work, runs Pass 4,
// the plagiarism check, the honesty score and the humanizer, and then checks
// the FINAL.md it is about to export. That last check reads what it checks
// against itself, rather than reusing what the earlier check read: Pass 3
// downloads each open-access PDF again, and the citation re-check reads each
// section's DRAFT.md again to see which acknowledgements apply to the paper.
// So a source that no longer holds a quotation, or a section edited while
// done ran so that it cites a retracted work it never acknowledged, blocks
// the export. done runs in this process, with the humanizer injected through
// the exporter's test seam, on the live request path against an undici
// MockAgent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doneCommand } from '../bin/cli/done.js';
import { __setTaskRunnerForTest } from '../bin/lib/exporter.js';
import { answerGate, readGate } from '../bin/lib/gates.js';
import { sha256 } from '../bin/lib/verify/verification-record.js';
import { compiledPaper } from './lib/export-fixture.js';
import { JSON_HEADERS, useMockRegistries } from './lib/mock-registries.js';
import { textPdf } from './lib/pdf-fixture.js';

const agent = useMockRegistries('pensmith-done-final-recheck-');

// A public address written as an IP literal, so the SSRF guard needs no DNS.
const OA = 'https://93.184.215.14';
const PDF_URL = `${OA}/paper.pdf`;
const PDF_A = readFileSync(fileURLToPath(new URL('./fixtures/cassettes/oa-pdf/arxiv-2109.00022.pdf', import.meta.url)));

/** The PDF at the link once it was replaced by a file that no longer holds the quotation. */
const REPLACED_PDF = textPdf(
  'Withdrawn version. This file replaces the earlier preprint, and the result quoted from it is no longer stated.',
);

interface CrossrefWork {
  doi: string;
  title: string;
  family: string;
  given: string;
  year: number;
  updatedBy?: Array<Record<string, unknown>>;
}

/** Crossref holds `works`, OpenAlex lists none of them as retracted, and the plagiarism search finds nothing. */
function registries(works: CrossrefWork[], oaPdf?: string): void {
  agent().get('https://api.crossref.org').intercept({ path: () => true, method: 'GET' }).reply((opts) => {
    const path = decodeURIComponent(String(opts.path)).toLowerCase();
    const w = works.find((x) => path.startsWith(`/works/${x.doi.toLowerCase()}`));
    if (!w) return { statusCode: 404, data: 'Resource not found.', responseOptions: { headers: { 'content-type': 'text/plain' } } };
    return {
      statusCode: 200,
      data: JSON.stringify({
        status: 'ok',
        message: {
          DOI: w.doi, type: 'journal-article', title: [w.title], author: [{ family: w.family, given: w.given }],
          'container-title': ['Journal of Fixtures'], issued: { 'date-parts': [[w.year]] },
          ...(w.updatedBy ? { 'updated-by': w.updatedBy } : {}),
        },
      }),
      responseOptions: { headers: JSON_HEADERS },
    };
  }).persist();
  agent().get('https://api.openalex.org').intercept({ path: (p) => p.startsWith('/works/doi:'), method: 'GET' }).reply((opts) => {
    const body = String(opts.path).includes('best_oa_location')
      ? { id: 'https://openalex.org/W1', best_oa_location: oaPdf ? { is_oa: true, pdf_url: oaPdf } : null, locations: [] }
      : { id: 'https://openalex.org/W1', is_retracted: false };
    return { statusCode: 200, data: JSON.stringify(body), responseOptions: { headers: JSON_HEADERS } };
  }).persist();
  agent().get('https://html.duckduckgo.com').intercept({ path: () => true, method: () => true })
    .reply(200, '<html><body></body></html>', { headers: { 'content-type': 'text/html' } }).persist();
}

interface DoneRun { exitCode: number | undefined; out: string }

/**
 * Run `done --yolo --format md` (or `args`) in `root`. The humanizer runs
 * `during`, then returns `humanize(draft)`.
 */
async function runDone(
  root: string,
  humanize: (draft: string) => string,
  during: () => void = () => {},
  args: Record<string, unknown> = { yolo: true, raw: false, format: 'md' },
): Promise<DoneRun> {
  const prevCwd = process.cwd();
  const prevNoLlm = process.env['PENSMITH_NO_LLM'];
  const prevExit = process.exitCode;
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = '';
  const capture = (real: typeof realOut) => ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return (real as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.chdir(root);
  process.env['PENSMITH_NO_LLM'] = '1';
  process.exitCode = undefined;
  __setTaskRunnerForTest((_skill, input) => {
    during();
    return Promise.resolve({ output: humanize(input['draft'] ?? '') });
  });
  process.stdout.write = capture(realOut);
  process.stderr.write = capture(realErr);
  try {
    const run = doneCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    await run({ args });
    return { exitCode: process.exitCode as number | undefined, out };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    __setTaskRunnerForTest(null);
    process.exitCode = prevExit;
    process.chdir(prevCwd);
    if (prevNoLlm === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = prevNoLlm;
  }
}

// ---- the quotation's source, read again for FINAL.md ----

const QUOTE = 'In this paper, we study a relaxed version of this question by replacing holes with visible islands';
const K: CrossrefWork = { doi: '10.1234/abc', title: 'Visible Islands in Point Sets', family: 'Smith', given: 'Ann', year: 2021 };
const K_BIB = `@article{k,\n  title = {${K.title}},\n  author = {Smith, Ann},\n  journal = {Journal of Fixtures},\n  year = {2021},\n  doi = {${K.doi}}\n}\n`;

/** A paper quoting k, whose open-access PDF answers `pdf(n)` to the n-th download. */
async function quotingPaper(pdf: (n: number) => Buffer): Promise<{ root: string; downloads: () => number }> {
  const root = await compiledPaper({
    sections: [{ slug: 'results', title: 'Results', draft: `As the authors write, "${QUOTE}" [@k, p. 1].\n`, sources: ['k'] }],
    bib: K_BIB,
  });
  registries([K], PDF_URL);
  let n = 0;
  agent().get(OA).intercept({ path: '/paper.pdf', method: 'GET' }).reply(() => {
    n += 1;
    return { statusCode: 200, data: pdf(n), responseOptions: { headers: { 'content-type': 'application/pdf' } } };
  }).persist();
  return { root, downloads: () => n };
}

// FINAL.md keeps the quotation word for word; only the sentence around it changes.
const keepQuotation = (draft: string): string => draft.replace('As the authors write,', 'The authors put it this way:');

test('done: the quotations in FINAL.md are checked against the source as it is served then, so a source that no longer holds one blocks the export', async () => {
  const { root, downloads } = await quotingPaper((n) => (n === 1 ? PDF_A : REPLACED_PDF));
  const r = await runDone(root, keepQuotation);
  assert.equal(downloads(), 2, `the source is downloaded for each check:\n${r.out}`);
  assert.equal(r.exitCode, 2, r.out);
  assert.match(r.out, /GATE-04 BLOCKED — FINAL\.md failed re-verification: Pass-3 quote NOT_FOUND in humanized FINAL\.md: \[@k\]/);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing may be exported');
});

test('done: a FINAL.md whose quotations its source still holds exports', async () => {
  // The guard for the refusal above: the seam and fixture can export, and
  // the source is still read once for each check.
  const { root, downloads } = await quotingPaper(() => PDF_A);
  const r = await runDone(root, keepQuotation);
  assert.equal(r.exitCode, undefined, r.out);
  assert.match(r.out, /pensmith done: exported /);
  assert.equal(downloads(), 2, r.out);
  assert.ok(existsSync(join(root, '.paper', 'export', 'FINAL.md')));
});

// ---- the export confirmation, kept for the FINAL.md text done checked ----

// No terminal and no --yolo: done keeps the audit for the user's answer.
const NO_TERMINAL = { yolo: false, raw: false, format: 'md' };

test('done without a terminal: the export confirmation is kept for the FINAL.md text done checked, so a text changed while it was checked is audited again', async () => {
  const seen: { staged?: string; checked?: Buffer } = {};
  const { root } = await quotingPaper((n) => {
    // The second download is the check of the humanized text, which done has read already.
    if (n === 2 && seen.staged) {
      seen.checked = readFileSync(seen.staged);
      writeFileSync(seen.staged, `${seen.checked.toString('utf8')}\nA sentence added to the staged text while done was checking it.\n`);
    }
    return PDF_A;
  });
  seen.staged = join(root, '.paper', 'FINAL.staged.md');
  const first = await runDone(root, keepQuotation, () => {}, NO_TERMINAL);
  assert.equal(first.exitCode, 3, first.out);
  const gate = readGate(root, 'export');
  assert.ok(gate && seen.checked, first.out);
  assert.equal(gate.binding['staged_sha256'], sha256(seen.checked), 'the confirmation is bound to the text that was checked');
  assert.notEqual(gate.binding['staged_sha256'], sha256(readFileSync(seen.staged)));

  // The user says "export": the answer is not applied to the text nobody checked or was shown.
  await answerGate(root, gate, ['export']);
  const second = await runDone(root, keepQuotation, () => {}, NO_TERMINAL);
  assert.match(second.out, /the export confirmation kept earlier was for another draft, bibliography or format; the audit runs again/);
  assert.equal(second.exitCode, 3, second.out);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing is exported on the earlier answer');
});

test('done without a terminal: a staged text removed while it was checked still stops for the answer, bound to the text checked', async () => {
  const seen: { staged?: string; checked?: Buffer } = {};
  const { root } = await quotingPaper((n) => {
    if (n === 2 && seen.staged) {
      seen.checked = readFileSync(seen.staged);
      rmSync(seen.staged);
    }
    return PDF_A;
  });
  seen.staged = join(root, '.paper', 'FINAL.staged.md');
  const r = await runDone(root, keepQuotation, () => {}, NO_TERMINAL);
  assert.equal(r.exitCode, 3, r.out);
  const gate = readGate(root, 'export');
  assert.ok(gate && seen.checked, r.out);
  assert.equal(gate.binding['staged_sha256'], sha256(seen.checked));
});

// ---- the sections, read again for FINAL.md ----

const W: CrossrefWork = {
  doi: '10.5555/retracted.1', title: 'Tidal Heating in Icy Moons', family: 'Roe', given: 'Jane', year: 2019,
  updatedBy: [{
    DOI: '10.5555/retracted.notice', type: 'retraction', label: 'Retraction', source: 'retraction-watch',
    updated: { 'date-parts': [[2021, 3, 4]], 'date-time': '2021-03-04T00:00:00Z', timestamp: 1614816000000 },
  }],
};
const V: CrossrefWork = { doi: '10.5555/sound.1', title: 'Sediment Transport in Estuaries', family: 'Doe', given: 'John', year: 2020 };
const WV_BIB =
  `@article{w2019,\n  title = {${W.title}},\n  author = {Roe, Jane},\n  journal = {Journal of Fixtures},\n  year = {2019},\n  doi = {${W.doi}}\n}\n` +
  `@article{v2020,\n  title = {${V.title}},\n  author = {Doe, John},\n  journal = {Journal of Fixtures},\n  year = {2020},\n  doi = {${V.doi}}\n}\n`;

/** Section 1 cites the retracted w2019 knowingly (acknowledged); section 2 cites only v2020. */
async function retractionPaper(): Promise<{ root: string; bodyDraft: string }> {
  const root = await compiledPaper({
    sections: [
      { slug: 'intro', title: 'Intro', draft: 'The retracted study claimed a warm ocean [@w2019].\n', sources: ['w2019'], acknowledge: ['w2019'] },
      { slug: 'body', title: 'Body', draft: 'Sediment moves with the tide [@v2020].\n', sources: ['v2020'] },
    ],
    bib: WV_BIB,
  });
  registries([W, V]);
  return { root, bodyDraft: join(root, '.paper', 'sections', '02-body', 'DRAFT.md') };
}

const reword = (draft: string): string => draft.replace('claimed a warm ocean', 'asserted a warm ocean');

test('done: a section edited while done runs to cite a retracted work it never acknowledged blocks the FINAL.md export', async () => {
  const { root, bodyDraft } = await retractionPaper();
  const r = await runDone(root, reword, () => {
    writeFileSync(bodyDraft, 'Sediment moves with the tide [@v2020], unlike the warm ocean of [@w2019].\n');
  });
  assert.equal(r.exitCode, 2, r.out);
  assert.match(r.out, /BLOCKED — export refused \(a citation in the humanized FINAL\.md does not pass when checked again\)/);
  assert.match(r.out, /\.paper\/FINAL\.md: citation \[@w2019\] is RETRACTED/);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing may be exported');
});

test('done: a retracted work every citing section acknowledged exports from FINAL.md', async () => {
  // The guard for the refusal above: with no edit, the same paper exports.
  const { root } = await retractionPaper();
  const r = await runDone(root, reword);
  assert.equal(r.exitCode, undefined, r.out);
  assert.match(r.out, /pensmith done: exported /);
  assert.ok(existsSync(join(root, '.paper', 'export', 'FINAL.md')));
});
