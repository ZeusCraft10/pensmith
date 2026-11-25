// tests/pass3-oa-pdf.test.ts — Pass 3 reads a real open-access PDF, so a
// misquotation of it is NOT_FOUND.
//
// Pass 3 used to look the PDF up through Unpaywall alone, which answers 422
// without a contact email, and built the PDF from the UTF-8-decoded response
// text, which destroys the compressed streams of every real PDF. pdf.js then
// extracted nothing, every quotation read TEXT_UNAVAILABLE or PDF_UNAVAILABLE,
// and no misquotation could ever block a section.
//
// The recordings are real (tests/fixtures/cassettes/oa-pdf/README.md): the
// Crossref and OpenAlex records of "A Note on Visible Islands", and the
// CC BY 4.0 arXiv PDF OpenAlex lists as its open-access copy. Synthetic
// recordings under the 10.0000 prefix cover a work with no open-access PDF and
// a link that serves a login page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { isolatedCliEnv } from './lib/cli-env.js';

const DOI = '10.1556/012.2022.01524';
const KEY = 'leuchtner2022';

/** One quotation per sentence, each attributed to `key`. */
function draftQuoting(quotes: readonly string[], key = KEY): string {
  return `# Results\n\n${quotes.map((q, i) => `As the authors write, "${q}" [@${key}, p. ${i + 1}].`).join('\n\n')}\n`;
}

// Word for word, as the paper has it. pdf.js runs some of these words
// together ("isto findholesin", "ofthis question", "membersand"); the
// quotation still matches.
const FAITHFUL = 'A natural approach to the Big-line Big-clique Conjecture is to find holes in planar point sets';
const ELIDED = 'In this paper, we study a relaxed version of this question ... with visible islands';
const BRACKETED = 'However, a famous construction due to [Joseph] Horton shows that this is false';
const SIZE_13 = 'there are arbitrarily large finite point sets in the plane with no 4 collinear members and no visible island of size 13';
// Each changes the paper's meaning by one word or number, or never appears in it.
const ONE_WORD = 'In this paper, we study a stronger version of this question by replacing holes with visible islands';
const NUMBER = 'there are arbitrarily large finite point sets in the plane with no 4 collinear members and no visible island of size 12';
const NEGATED = 'In this paper, we show that this conjecture is not false for visible islands';
const FABRICATED = 'We prove that every sufficiently large point set in general position contains a visible island of size 13';

async function withContactEmail<T>(email: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env['PENSMITH_CONTACT_EMAIL'];
  if (email === undefined) delete process.env['PENSMITH_CONTACT_EMAIL'];
  else process.env['PENSMITH_CONTACT_EMAIL'] = email;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_CONTACT_EMAIL'];
    else process.env['PENSMITH_CONTACT_EMAIL'] = saved;
  }
}

test('pass 3: quotations of a real open-access PDF found through OpenAlex, with no contact email', async () => {
  assert.equal(process.env['PENSMITH_TEST_CASSETTES'], '1', 'the test runner replays recordings');
  const quotes = [FAITHFUL, ELIDED, BRACKETED, SIZE_13, ONE_WORD, NUMBER, NEGATED, FABRICATED];
  const results = await withContactEmail(undefined, () => runPass3(draftQuoting(quotes), new Map([[KEY, { DOI }]])));
  const verdicts = results.map((r) => r.verdict);
  assert.deepEqual(
    verdicts,
    ['OK', 'OK', 'OK', 'OK', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND'],
    results.map((r) => `${r.verdict}: ${r.reason}`).join('\n'),
  );
});

test('pass 3: no open-access PDF in OpenAlex and no contact email: unverifiable, and the reason says to set one', async () => {
  const results = await withContactEmail(undefined, () =>
    runPass3(draftQuoting([FAITHFUL]), new Map([[KEY, { DOI: '10.0000/pensmith-no-oa-pdf' }]])));
  assert.equal(results[0]?.verdict, 'PDF_UNAVAILABLE', results[0]?.reason);
  assert.match(results[0]!.reason, /No OA PDF available for DOI 10\.0000\/pensmith-no-oa-pdf/);
  assert.match(results[0]!.reason, /PENSMITH_CONTACT_EMAIL/);
});

test('pass 3: with a contact email, Unpaywall is asked when OpenAlex lists no PDF', async () => {
  const results = await withContactEmail('test@example.org', () =>
    runPass3(draftQuoting([FAITHFUL, ONE_WORD]), new Map([[KEY, { DOI: '10.0000/pensmith-no-oa-pdf' }]])));
  assert.deepEqual(results.map((r) => r.verdict), ['OK', 'NOT_FOUND'], results.map((r) => r.reason).join('\n'));
});

test('pass 3: an open-access link that serves a login page is not read as the source; the next link is', async () => {
  const results = await withContactEmail(undefined, () =>
    runPass3(draftQuoting([FAITHFUL, ONE_WORD]), new Map([[KEY, { DOI: '10.0000/pensmith-oa-landing-page' }]])));
  assert.deepEqual(results.map((r) => r.verdict), ['OK', 'NOT_FOUND'], results.map((r) => r.reason).join('\n'));
});

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

const BIB =
  `@article{${KEY},\n  title = {A Note on Visible Islands},\n` +
  '  author = {Leuchtner, Sophie and Nicolás, Carlos M. and Suk, Andrew},\n' +
  '  journal = {Studia Scientiarum Mathematicarum Hungarica},\n  year = {2022},\n' +
  `  volume = {59},\n  pages = {160--163},\n  doi = {${DOI}}\n}\n`;

test('verify: misquotations of a real open-access paper are NOT_FOUND in every citation form, and the section fails (exit 2)', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-pass3-oa-'));
  const sec = join(root, '.paper', 'sections', '01-results');
  mkdirSync(sec, { recursive: true });
  // The same work under a lowercase and an uppercase key.
  const upper = 'Leuchtner2022';
  writeFileSync(join(sec, 'PLAN.md'), `---\nsection: 1\nslug: results\ntitle: Results\nstatus: written\nassigned_sources: [${KEY}, ${upper}]\n---\n# Results\n`);
  writeFileSync(join(sec, 'DRAFT.md'), [
    '# Results',
    '',
    `As the authors write, "${FAITHFUL}" [@${KEY}, p. 1].`,
    '',
    `They also write that "${ONE_WORD}" [@${KEY}, p. 1].`,
    '',
    `[@${upper}, p. 2] says "${FABRICATED}".`,
    '',
    `It is claimed that "${NEGATED}" [see @${KEY}; @${upper}, pp. 1-2].`,
    '',
  ].join('\n'));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB + BIB.replace(`@article{${KEY},`, `@article{${upper},`));
  const env = isolatedCliEnv(
    { PENSMITH_TEST_CASSETTES: '1', PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: undefined, PENSMITH_CONTACT_EMAIL: undefined },
    'pensmith-pass3-oa-home-',
  );
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, 'verify', '1', '--slug', 'results'], { cwd: root, env, encoding: 'utf8' });
  const verification = readFileSync(join(sec, 'VERIFICATION.md'), 'utf8');
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}\n${verification}`);
  assert.match(verification, /^Status: failed$/m, verification);
  assert.match(verification, new RegExp(`^- ${KEY}: \\*\\*OK\\*\\*`, 'm'), 'Pass 1 confirms the entry');
  const pass3 = verification.split('\n').filter((l) => / \("/.test(l) && /\*\*[A-Z_]+\*\*/.test(l))
    .map((l) => `${l.slice(2, l.indexOf(' ("'))} ${/\*\*([A-Z_]+)\*\*/.exec(l)![1]}`);
  assert.deepEqual(pass3, [
    `${KEY} OK`,
    `${KEY} NOT_FOUND`,
    `${upper} NOT_FOUND`,
    `${KEY} NOT_FOUND`,
    `${upper} NOT_FOUND`,
  ], verification);
});
