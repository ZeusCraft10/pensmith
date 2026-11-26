// tests/retraction.test.ts — a retracted work is RETRACTED, through the real CLI.
//
// Retraction detection used to ask a Crossref Labs route that answers every
// DOI with an error envelope, so it never found anything and Wakefield 1998
// verified OK. Pass 1 now reads the retraction from the record the registry
// already returned: Crossref's `updated-by` (and a notice the publisher put on
// the work itself, `update-to` its own DOI), PubMed's "Retracted Publication"
// type, and a "RETRACTED:" / "WITHDRAWN:" title, with OpenAlex `is_retracted`
// as a cross-check. RETRACTED blocks compile and export until the author
// acknowledges that one citation with `pensmith ack`; an expression of concern
// only warns.
//
// Every registry answer here is a real recording (tests/fixtures/cassettes):
// Crossref, PubMed and OpenAlex for Wakefield 1998, a PLOS ONE article under an
// expression of concern, and an article its publisher withdrew in place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './lib/export-fixture.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';

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

/** The real CLI in `root`, live mode on the recorded registry answers. */
function cli(root: string, ...args: string[]): Run {
  const r = runCli(args, root, { PENSMITH_OFFLINE: '0', PENSMITH_TEST_CASSETTES: '1' });
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

const ackFile = (root: string, n = 1, slug = 'intro'): string => join(secDir(root, n, slug), 'ACKNOWLEDGEMENTS.json');
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

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
  // The way out names this section and key, and never --yolo.
  assert.match(r, /pensmith ack 1 wakefield1998 --reason/);
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

/** A DataCite DOI with no OpenAlex answer recorded: OpenAlex cannot be asked about it. */
const VASWANI =
  '@misc{vaswani2017,\n  title = {Attention Is All You Need},\n' +
  '  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia},\n' +
  '  year = {2017},\n  doi = {10.48550/arXiv.1706.03762}\n}\n';

test('verify says how many citations had their retraction status read from the record alone', () => {
  // When OpenAlex cannot be asked, a citation is OK on what its registry
  // record says. That gap used to show only in VERIFICATION.md.
  const root = seedPaper(VASWANI + CONCERN);
  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 0, v.out);
  assert.match(row(root, 'vaswani2017'), /OpenAlex could not be asked/);
  assert.match(
    v.out,
    /WARN — section 1: the retraction status of 1 citation was read from its registry record alone, since OpenAlex could not be asked/,
  );

  // Every citation checked against OpenAlex too: nothing to say.
  const checked = seedPaper(CONCERN);
  const c = cli(checked, 'verify', '1', '--slug', 'intro');
  assert.doesNotMatch(c.out, /registry record alone/);
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

// ---------------------------------------------------------------------------
//   Acknowledgement
// ---------------------------------------------------------------------------

const REASON = 'This section is about the retraction itself.';

test('pensmith ack records the acknowledgement in the section folder, bound to the key and the DOI hash; verify then passes with a warning', () => {
  const root = seedPaper(WAKEFIELD);
  assert.equal(cli(root, 'verify', '1', '--slug', 'intro').status, 2);

  const a = cli(root, 'ack', '1', 'wakefield1998', '--slug', 'intro', '--reason', REASON);
  assert.equal(a.status, 0, a.out);
  assert.match(a.out, /pensmith verify 1/);
  const recorded = JSON.parse(readFileSync(ackFile(root), 'utf8')) as {
    acknowledgements: Array<Record<string, unknown>>;
  };
  assert.equal(recorded.acknowledgements.length, 1);
  const ack = recorded.acknowledgements[0]!;
  assert.equal(ack['kind'], 'retracted');
  assert.equal(ack['citekey'], 'wakefield1998');
  assert.equal(ack['reason'], REASON);
  assert.equal(ack['work_sha256'], sha256('doi:10.1016/s0140-6736(97)11096-0'));

  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 0, v.out);
  const r = row(root, 'wakefield1998');
  assert.match(r, /\*\*RETRACTED_ACKNOWLEDGED\*\*/);
  assert.ok(r.includes(REASON), r);
  assert.match(verification(root), /^Status: verified$/m);
  assert.equal(planStatus(root), 'verified');
  assert.match(v.out, /WARN.*retracted/i);

  // compile accepts it and says so.
  const c = cli(root, 'compile');
  assert.equal(c.status, 0, c.out);
  assert.match(c.out, /WARN.*wakefield1998.*retracted/i);
});

test('an acknowledgement does not carry over to another work cited under the same key', () => {
  const root = seedPaper(WAKEFIELD);
  cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(cli(root, 'ack', '1', 'wakefield1998', '--slug', 'intro', '--reason', REASON).status, 0);
  // The key now names a different retracted work.
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), withdrawn('wakefield1998'));
  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 2, v.out);
  assert.match(row(root, 'wakefield1998'), /\*\*RETRACTED\*\*/);
});

test('an acknowledgement covers its own section only', () => {
  const root = seedPaper(WAKEFIELD, 2);
  cli(root, 'verify', '1', '--slug', 'intro');
  cli(root, 'verify', '2', '--slug', 'body');
  assert.equal(cli(root, 'ack', '1', 'wakefield1998', '--slug', 'intro', '--reason', REASON).status, 0);
  assert.equal(cli(root, 'verify', '1', '--slug', 'intro').status, 0);
  const v2 = cli(root, 'verify', '2', '--slug', 'body');
  assert.equal(v2.status, 2, v2.out);
  assert.match(row(root, 'wakefield1998', 2, 'body'), /\*\*RETRACTED\*\*/);
  assert.equal(existsSync(ackFile(root, 2, 'body')), false);
});

test('a section verified with an acknowledged retraction that goes stale is re-verified by compile with the acknowledgement', () => {
  const root = seedPaper(WAKEFIELD);
  cli(root, 'verify', '1', '--slug', 'intro');
  cli(root, 'ack', '1', 'wakefield1998', '--slug', 'intro', '--reason', REASON);
  assert.equal(cli(root, 'verify', '1', '--slug', 'intro').status, 0);
  appendFileSync(join(secDir(root), 'DRAFT.md'), '\nA closing sentence added after verification.\n');
  const c = cli(root, 'compile');
  assert.equal(c.status, 0, c.out);
  assert.match(c.out, /stale/);
});

test('a stale section citing a work under an expression of concern still compiles', () => {
  const root = seedPaper(CONCERN);
  assert.equal(cli(root, 'verify', '1', '--slug', 'intro').status, 0);
  appendFileSync(join(secDir(root), 'DRAFT.md'), '\nA closing sentence added after verification.\n');
  const c = cli(root, 'compile');
  assert.equal(c.status, 0, c.out);
});

test('a work the bibliography records as retracted, with no identifier, is not offered an ack that would refuse', () => {
  // Research writes `note = {RETRACTED}` for a "RETRACTED:" title, which a
  // Semantic Scholar or Zotero record may carry with no DOI. ack binds an
  // acknowledgement to an identifier, so it refuses such an entry.
  const root = seedPaper(
    '@article{anon2019,\n  title = {RETRACTED: Sleep and memory in adolescents},\n  author = {Doe, Jane},\n' +
    '  journal = {Journal of Sleep Studies},\n  year = {2019},\n  note = {RETRACTED}\n}\n',
  );
  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 2, v.out);
  const r = row(root, 'anon2019');
  assert.match(r, /\*\*RETRACTED\*\*/);
  assert.doesNotMatch(r + v.out, /pensmith ack/, 'the advice must not name a command that refuses this entry');
  assert.match(r, /remove the citation/);
  assert.match(r, /DOI, PMID or arXiv ID/);
  const a = cli(root, 'ack', '1', 'anon2019', '--slug', 'intro', '--reason', REASON);
  assert.equal(a.status, 2, a.out);
  assert.equal(existsSync(ackFile(root)), false);
});

test('ack refuses without a reason, for a key verify did not find RETRACTED, and for a key not in the bibliography', () => {
  const root = seedPaper(WAKEFIELD + CONCERN);
  cli(root, 'verify', '1', '--slug', 'intro');
  for (const [args, why] of [
    [['ack', '1', 'wakefield1998', '--slug', 'intro'], /reason/i],
    [['ack', '1', 'wakefield1998', '--slug', 'intro', '--reason', '   '], /reason/i],
    [['ack', '1', 'feng2013', '--slug', 'intro', '--reason', REASON], /not RETRACTED|no RETRACTED/],
    [['ack', '1', 'ghost2099', '--slug', 'intro', '--reason', REASON], /CITATIONS\.bib/],
  ] as Array<[string[], RegExp]>) {
    const r = cli(root, ...args);
    assert.equal(r.status, 2, `${args.join(' ')}\n${r.out}`);
    assert.match(r.out, why);
    assert.equal(existsSync(ackFile(root)), false, `${args.join(' ')} must write nothing`);
  }
});

test('ack before verify has nothing to acknowledge', () => {
  const root = seedPaper(WAKEFIELD);
  const r = cli(root, 'ack', '1', 'wakefield1998', '--slug', 'intro', '--reason', REASON);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /pensmith verify 1/);
  assert.equal(existsSync(ackFile(root)), false);
});

test('ack --dry-run writes nothing', () => {
  const root = seedPaper(WAKEFIELD);
  cli(root, 'verify', '1', '--slug', 'intro');
  const r = cli(root, 'ack', '1', 'wakefield1998', '--slug', 'intro', '--reason', REASON, '--dry-run');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ACKNOWLEDGEMENTS\.json/);
  assert.equal(existsSync(ackFile(root)), false);
});

test('an unreadable ACKNOWLEDGEMENTS.json lifts nothing: verify still blocks and says why, and ack will not overwrite it', () => {
  const root = seedPaper(WAKEFIELD);
  cli(root, 'verify', '1', '--slug', 'intro');
  writeFileSync(ackFile(root), '{ "acknowledgements": [ { "citekey": "wakefield1998"');
  const v = cli(root, 'verify', '1', '--slug', 'intro');
  assert.equal(v.status, 2, v.out);
  assert.match(row(root, 'wakefield1998'), /\*\*RETRACTED\*\*/);
  assert.match(v.out, /WARN.*ACKNOWLEDGEMENTS\.json could not be read/);
  const a = cli(root, 'ack', '1', 'wakefield1998', '--slug', 'intro', '--reason', REASON);
  assert.equal(a.status, 2, a.out);
  assert.match(a.out, /could not be read/);
  assert.equal(readFileSync(ackFile(root), 'utf8'), '{ "acknowledgements": [ { "citekey": "wakefield1998"');
});
