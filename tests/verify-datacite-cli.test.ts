// tests/verify-datacite-cli.test.ts — Pass 1 at the registrar that holds a DOI
// (Phase 20, VRFY-11, D-20-10), through the BUILT CLI on recorded answers.
//
// Crossref has no record of a DOI another agency registered. `verify 1` then
// asks doi.org which agency holds the prefix and asks that agency:
//   - a Zenodo DOI (10.5281/zenodo.1212303) is re-fetched from DataCite, the
//     title / first author / year match, the row is OK and says the retraction
//     status is unknown (DataCite carries no retraction data, VRFY-15);
//   - an mEDRA DOI (10.1400/19806) and a JaLC DOI (10.11501/3140078) are read
//     through doi.org content negotiation (their CSL records) — OK too;
//   - a Zenodo DOI neither Crossref nor DataCite knows (both recorded 404s) is
//     FABRICATED, never UNVERIFIABLE: the registrar that holds the prefix said
//     it does not exist.
// The recordings are the live answers (npm run cassettes:refresh; the offline
// lane under the test runner replays them exactly).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, runCli, writeState, writeOutline, writePlan, sectionDirOf, STACK_LINE } from './helpers/paper-cli-harness.js';

function seed(root: string, keys: string[], bib: string): string {
  writeState(root, [{ n: 1, slug: 'background' }], 'verify-datacite');
  writeOutline(root, [{ n: 1, slug: 'background', sources: keys }]);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: `[${keys.join(', ')}]` });
  const dir = sectionDirOf(root, 1, 'background');
  writeFileSync(join(dir, 'DRAFT.md'), `# Background\n\n${keys.map((k) => `A claim [@${k}].`).join(' ')}\n`);
  return dir;
}

function rowOf(md: string, key: string): string {
  return md.split('\n').find((l) => l.startsWith(`- ${key}:`)) ?? '';
}

test('VRFY-11 (built CLI): a Zenodo DOI verifies at DataCite, an mEDRA and a JaLC DOI through doi.org content negotiation — the section is verified', () => {
  const sb = sandbox('verify-datacite');
  const root = sb.project('p');
  const dir = seed(root, ['montani2023', 'navajas2005', 'kitamoto1997'], [
    '@misc{montani2023,',
    '  author = {Montani, Ines and Honnibal, Matthew},',
    '  title = {explosion/spaCy: v3.7.2: Fixes for APIs and requirements},',
    '  publisher = {Zenodo},',
    '  year = {2023},',
    '  doi = {10.5281/zenodo.1212303},',
    '}',
    '',
    '@article{navajas2005,',
    '  author = {Navajas, Gonzalo},',
    '  title = {La historia y la literatura española postnacional},',
    '  journal = {Studi ispanici},',
    '  year = {2005},',
    '  doi = {10.1400/19806},',
    '}',
    '',
    '@phdthesis{kitamoto1997,',
    '  author = {北本, 朝展},',
    '  title = {領域・空間情報を表現するグラフ構造を用いた類似画像検索},',
    '  school = {東京大学},',
    '  year = {1997},',
    '  doi = {10.11501/3140078},',
    '}',
    '',
  ].join('\n'));
  const v = runCli(sb, root, ['verify', '1', '--yolo'], { timeoutMs: 120_000 });
  assert.doesNotMatch(v.stderr, STACK_LINE, 'no stack trace');
  const md = readFileSync(join(dir, 'VERIFICATION.md'), 'utf8');
  assert.equal(v.status, 0, `${v.stdout}\n${v.stderr}\n${md}`);
  assert.match(md, /^Status: verified$/m);
  assert.match(rowOf(md, 'montani2023'), /\*\*OK\*\* — .*DOI 10\.5281\/zenodo\.1212303 is registered with DataCite, not Crossref; re-fetched from DataCite; D-11 AND-gate passed \(year 2023\); retraction status unknown \(no retraction data for DataCite DOIs\)/);
  assert.match(rowOf(md, 'navajas2005'), /\*\*OK\*\* — .*registered with mEDRA, not Crossref; re-fetched through doi\.org content negotiation; .*no retraction data for mEDRA DOIs/);
  assert.match(rowOf(md, 'kitamoto1997'), /\*\*OK\*\* — .*registered with JaLC, not Crossref; re-fetched through doi\.org content negotiation/);
});

test('VRFY-11 (built CLI): a Zenodo DOI neither Crossref nor DataCite knows is FABRICATED (recorded 404s) — never UNVERIFIABLE; the section fails', () => {
  const sb = sandbox('verify-datacite-fake');
  const root = sb.project('p');
  const dir = seed(root, ['ghost2099'], [
    '@misc{ghost2099,',
    '  author = {Ghost, Casper},',
    '  title = {A Data Set Nobody Deposited},',
    '  year = {2099},',
    '  doi = {10.5281/zenodo.pensmith-fake-2099},',
    '}',
    '',
  ].join('\n'));
  const v = runCli(sb, root, ['verify', '1', '--yolo'], { timeoutMs: 120_000 });
  assert.doesNotMatch(v.stderr, STACK_LINE, 'no stack trace');
  assert.equal(v.status, 4, `${v.stdout}\n${v.stderr}`);
  const md = readFileSync(join(dir, 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: failed$/m);
  assert.match(rowOf(md, 'ghost2099'), /\*\*FABRICATED\*\* — .*DataCite/);
});
