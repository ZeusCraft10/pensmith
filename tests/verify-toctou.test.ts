// tests/verify-toctou.test.ts — verify records the draft it checked, not the
// draft on disk when it finishes.
//
// verify read DRAFT.md for Pass 1 and Pass 3, then read it again for the hash
// it stores, after the slow passes (registry lookups, open-access PDFs, the
// advisory model calls). A draft edited in that window was stored with a
// fresh hash beside verdicts for the old text, so compile's staleness check
// took the new text as verified. Here the edit lands while Pass 3 asks
// OpenAlex for the quotation's source, on the live request path against an
// undici MockAgent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSON_HEADERS, useMockRegistries } from './lib/mock-registries.js';
import { verifyCommand } from '../bin/cli/verify.js';
import { runCompile, type ReVerifyInput } from '../bin/lib/compile.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';

const agent = useMockRegistries('pensmith-verify-toctou-');

const DOI = '10.5555/tidal.1';
const BIB =
  `@article{roe2019,\n  title = {Tidal Heating in Icy Moons},\n  author = {Roe, Jane},\n  journal = {Icarus},\n  year = {2019},\n  doi = {${DOI}}\n}\n` +
  '@article{bad2020,\n  title = {A Work Nobody Published},\n  author = {Nobody, Ann},\n  journal = {Icarus},\n  year = {2020},\n  doi = {10.5555/no-such-work}\n}\n';

const ORIGINAL =
  'Roe argues that "tidal heating keeps a liquid ocean beneath the ice shell of every large icy moon we know" [@roe2019, p. 3].\n';
const EDITED = `${ORIGINAL}A second finding is reported too [@bad2020].\n`;

function seedPaper(): { root: string; draftPath: string; planPath: string; sec: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-verify-toctou-root-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Tides', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | roe2019 |', ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  const planPath = join(sec, 'PLAN.md');
  writeFileSync(planPath, '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: [roe2019]\n---\n# Intro\n');
  const draftPath = join(sec, 'DRAFT.md');
  writeFileSync(draftPath, ORIGINAL);
  return { root, draftPath, planPath, sec };
}

/** The registries: Crossref holds roe2019; OpenAlex's open-access lookup is where the draft gets edited. */
function registries(draftPath: string): void {
  agent().get('https://api.crossref.org')
    .intercept({ path: (p) => p.toLowerCase().startsWith(`/works/${encodeURIComponent(DOI).toLowerCase()}`), method: 'GET' })
    .reply(200, JSON.stringify({
      status: 'ok',
      message: {
        DOI, type: 'journal-article', title: ['Tidal Heating in Icy Moons'], author: [{ family: 'Roe', given: 'Jane' }],
        'container-title': ['Icarus'], issued: { 'date-parts': [[2019]] },
      },
    }), { headers: JSON_HEADERS })
    .persist();
  agent().get('https://api.openalex.org')
    .intercept({ path: (p) => p.startsWith('/works/doi:'), method: 'GET' })
    .reply((opts) => {
      const path = String(opts.path);
      if (path.includes('best_oa_location')) {
        // Someone edits the draft while verify waits on the network.
        writeFileSync(draftPath, EDITED);
        return { statusCode: 200, data: JSON.stringify({ id: 'https://openalex.org/W1', doi: DOI, best_oa_location: null, locations: [] }), responseOptions: { headers: JSON_HEADERS } };
      }
      return { statusCode: 200, data: JSON.stringify({ id: 'https://openalex.org/W1', title: 'Tidal Heating in Icy Moons', is_retracted: false }), responseOptions: { headers: JSON_HEADERS } };
    })
    .persist();
}

async function inDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  const prevNoLlm = process.env['PENSMITH_NO_LLM'];
  const prevExit = process.exitCode;
  process.chdir(dir);
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    return await fn();
  } finally {
    process.chdir(prev);
    if (prevNoLlm === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = prevNoLlm;
    process.exitCode = prevExit;
  }
}

test('a draft edited while verify runs is recorded with the hash of the text verify checked, so compile re-verifies it', async () => {
  const { root, draftPath, planPath } = seedPaper();
  registries(draftPath);

  await inDir(root, async () => {
    const run = verifyCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    await run({ args: { n: 1, slug: 'intro', yolo: false } });
  });
  assert.equal(readFileSync(draftPath, 'utf8'), EDITED, 'precondition: the draft changed during the run');

  const stored = parseFrontmatter(readFileSync(planPath, 'utf8')).frontmatter['verified_against_draft_hash'];
  assert.equal(stored, computeDraftHash(Buffer.from(ORIGINAL), ['roe2019']), 'the stored hash is that of the text the verdicts are about');
  assert.notEqual(stored, computeDraftHash(Buffer.from(EDITED), ['roe2019']));

  // compile sees the edited draft as unverified and re-verifies it.
  const asked: ReVerifyInput[] = [];
  const result = await runCompile({
    paperRoot: root,
    onWarn: () => {},
    reVerify: async (input) => {
      asked.push(input);
      return { passed: false, failingCitekeys: ['bad2020'] };
    },
  });
  assert.deepEqual(asked.map((a) => a.n), [1], 'compile re-verifies the edited section');
  assert.equal(result.refused, true);
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'the unverified text is not compiled');
});

test('the verdict file records the hash of the draft its verdicts are about', async () => {
  const { root, draftPath, sec } = seedPaper();
  registries(draftPath);
  await inDir(root, async () => {
    const run = verifyCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    await run({ args: { n: 1, slug: 'intro', yolo: false } });
  });
  const record = JSON.parse(readFileSync(join(sec, 'VERIFICATION.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(record['draft_sha256'], createHash('sha256').update(ORIGINAL).digest('hex'));
  const citations = record['citations'] as Array<{ citekey: string }>;
  assert.deepEqual(citations.map((c) => c.citekey), ['roe2019'], 'the verdicts are for the text that was read, without the edit');
});
