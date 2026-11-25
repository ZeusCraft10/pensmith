// tests/retraction.test.ts — a retracted work is RETRACTED, through the real CLI.
//
// Retraction detection used to ask a Crossref Labs route that answers every
// DOI with an error envelope, so it never found anything and Wakefield 1998
// verified OK. Pass 1 now reads the retraction from the record the registry
// already returned: Crossref's `updated-by` (and a notice the publisher put on
// the work itself, `update-to` its own DOI), PubMed's "Retracted Publication"
// type, and a "RETRACTED:" / "WITHDRAWN:" title, with OpenAlex `is_retracted`
// as a cross-check. RETRACTED blocks compile and export; an expression of
// concern only warns.
//
// Every registry answer here is a real recording (tests/fixtures/cassettes):
// Crossref, PubMed and OpenAlex for Wakefield 1998, a PLOS ONE article under an
// expression of concern, and an article its publisher withdrew in place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './lib/cli-env.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

const WAKEFIELD_DOI = '10.1016/S0140-6736(97)11096-0';
const WAKEFIELD_AUTHORS =
  'Wakefield, A. J. and Murch, S. H. and Anthony, A. and Linnell, J. and Casson, D. M. and Malik, M. and ' +
  'Berelowitz, M. and Dhillon, A. P. and Thomson, M. A. and Harvey, P. and Valentine, A. and Davies, S. E. and ' +
  'Walker-Smith, J. A.';
/** Wakefield 1998 as a reference list gives it: the title without Crossref's "RETRACTED:" label. */
const wakefield = (id: string, key = 'wakefield1998'): string =>
  `@article{${key},\n  title = {Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children},\n` +
  `  author = {${WAKEFIELD_AUTHORS}},\n  journal = {The Lancet},\n  volume = {351},\n  pages = {637--641},\n  year = {1998},\n  ${id}\n}\n`;
const WAKEFIELD = wakefield(`doi = {${WAKEFIELD_DOI}}`);

/** An article its publisher withdrew in place: Crossref titles it "WITHDRAWN: …" and its update-to names itself. */
const withdrawn = (key = 'cuenca2021'): string =>
  `@article{${key},\n  title = {RF - Should Striae be Considered a Predisposing Factor for Koebner Phenomenon in Psoriasis?},\n` +
  '  author = {Cuenca-Barrales, C. and Ruiz-Carrascosa, J. C. and Ruiz-Villaverde, R.},\n' +
  '  journal = {Actas Dermo-Sifiliográficas (English Edition)},\n  year = {2021},\n  doi = {10.1016/j.adengl.2021.11.027}\n}\n';

/** A PLOS ONE article under an expression of concern (2023), not retracted. */
const CONCERN =
  '@article{feng2013,\n  title = {Impairment of FOS mRNA Stabilization Following Translation Arrest in Granulocytes from Myelodysplastic Syndrome Patients},\n' +
  '  author = {Feng, Xiaomin and Shikama, Yayoi and Shichishima, Tsutomu and Noji, Hideyoshi and Ikeda, Kazuhiko and Ogawa, Kazuei and Kimura, Hideo and Takeishi, Yasuchika and Kimura, Junko},\n' +
  '  journal = {PLoS ONE},\n  volume = {8},\n  year = {2013},\n  doi = {10.1371/journal.pone.0061107}\n}\n';

interface Run { status: number | null; out: string }

function cli(root: string, ...args: string[]): Run {
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: isolatedCliEnv({ PENSMITH_TEST_CASSETTES: '1', PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: undefined }, 'pensmith-retraction-home-'),
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const secDir = (root: string, n = 1, slug = 'intro'): string => join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);

/** A paper whose sections (1 'intro', 2 'body', ...) each cite every key of `bib` once. */
function seedPaper(bib: string, sections = 1): string {
  const keys = [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!);
  const root = mkdtempSync(join(tmpdir(), 'pensmith-retraction-'));
  const slugs = ['intro', 'body', 'end'].slice(0, sections);
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Retracted Sources', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      ...slugs.map((s, i) => `| ${i + 1} | ${s} | ${s} | | 300 | ${keys.join(', ')} |`), ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  slugs.forEach((slug, i) => {
    const sec = secDir(root, i + 1, slug);
    mkdirSync(sec, { recursive: true });
    writeFileSync(join(sec, 'PLAN.md'), `---\nsection: ${i + 1}\nslug: ${slug}\ntitle: ${slug}\nstatus: written\nassigned_sources: [${keys.join(', ')}]\n---\n# ${slug}\n`);
    writeFileSync(join(sec, 'DRAFT.md'), `# ${slug}\n\n${keys.map((k) => `One claim in this section rests on this work [@${k}].`).join(' ')}\n`);
  });
  return root;
}

function verification(root: string, n = 1, slug = 'intro'): string {
  return readFileSync(join(secDir(root, n, slug), 'VERIFICATION.md'), 'utf8');
}

function row(root: string, key: string, n = 1, slug = 'intro'): string {
  const v = verification(root, n, slug);
  const line = v.split('\n').find((l) => l.startsWith(`- ${key}: `));
  assert.ok(line, `no Pass-1 row for ${key}\n${v}`);
  return line;
}

const planStatus = (root: string, n = 1, slug = 'intro'): unknown =>
  parseFrontmatter(readFileSync(join(secDir(root, n, slug), 'PLAN.md'), 'utf8')).frontmatter['status'];


// ---------------------------------------------------------------------------
//   Detection
// ---------------------------------------------------------------------------

test('Wakefield 1998, cited by its DOI, is RETRACTED through the real verify, and the section fails', () => {
  const root = seedPaper(WAKEFIELD);
  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 2, v.out);
  const r = row(root, 'wakefield1998');
  assert.match(r, /\*\*RETRACTED\*\*/);
  // The notice Crossref lists (Retraction Watch record), with its date.
  assert.match(r, /10\.1016\/s0140-6736\(10\)60175-4/i);
  assert.match(r, /2010/);
  assert.match(r, /Crossref/);
  // The way out is another source, never --yolo.
  assert.doesNotMatch(v.out + verification(root), /--yolo/);
  assert.match(verification(root), /^Status: failed$/m);
  assert.equal(planStatus(root), 'failed');
});

test('Wakefield 1998 with the title Crossref gives it ("RETRACTED: …") is RETRACTED, not OK', () => {
  const root = seedPaper(WAKEFIELD.replace('title = {Ileal', 'title = {RETRACTED: Ileal'));
  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 2, v.out);
  assert.match(row(root, 'wakefield1998'), /\*\*RETRACTED\*\*/);
});

test('Wakefield 1998, cited by its PubMed ID alone, is RETRACTED: PubMed types it a Retracted Publication', () => {
  const root = seedPaper(wakefield('pmid = {9500320}'));
  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 2, v.out);
  const r = row(root, 'wakefield1998');
  assert.match(r, /\*\*RETRACTED\*\*/);
  assert.match(r, /PubMed/);
  assert.match(r, /Retracted Publication/);
});

test('a work its publisher withdrew in place (WITHDRAWN: title, update-to itself) is RETRACTED', () => {
  const root = seedPaper(withdrawn());
  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 2, v.out);
  const r = row(root, 'cuenca2021');
  assert.match(r, /\*\*RETRACTED\*\*/);
  assert.match(r, /withdraw/i);
});

test('an expression of concern warns but does not block; OpenAlex confirms the work is not retracted', () => {
  const root = seedPaper(CONCERN);
  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 0, v.out);
  const r = row(root, 'feng2013');
  assert.match(r, /\*\*EXPRESSION_OF_CONCERN\*\*/);
  assert.match(r, /10\.1371\/journal\.pone\.0278805/);
  assert.doesNotMatch(r, /OpenAlex could not/);
  assert.match(verification(root), /^Status: verified$/m);
  assert.match(v.out, /WARN.*expression of concern/i);
});

test('--yolo never waives RETRACTED', () => {
  const root = seedPaper(WAKEFIELD);
  const v = cli(root, 'verify', '1', '--slug', 'intro', '--yolo');
  assert.equal(v.status, 2, v.out);
  assert.match(row(root, 'wakefield1998'), /\*\*RETRACTED\*\*/);
  const c = cli(root, 'compile', '--yolo');
  assert.equal(c.status, 2, c.out);
  assert.match(c.out, /\[@wakefield1998\]/);
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false);
});

test('a stale section citing a work under an expression of concern still compiles', () => {
  const root = seedPaper(CONCERN);
  assert.equal(cli(root, 'verify', '1', '--slug', 'intro').status, 0);
  appendFileSync(join(secDir(root), 'DRAFT.md'), '\nA closing sentence added after verification.\n');
  const c = cli(root, 'compile');
  assert.equal(c.status, 0, c.out);
});
