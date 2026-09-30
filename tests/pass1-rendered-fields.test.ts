// tests/pass1-rendered-fields.test.ts — VRFY-13: Pass 1 compares what the
// export prints. Pandoc's biblatex reader renders `date` (over `year`),
// `subtitle` and `titleaddon`, which citation-js drops; Pass 1 reads them the
// same way (renderedClaim), refuses the biblatex fields no registrar can
// confirm (`maintitle`, `origdate`, …), and a hand-edited entry that changes
// the printed year or title is MIS-CITED against the recorded Crossref answer.
//
// The differential half asks pandoc (`-f biblatex -t csljson`) for the title
// and year of each entry and checks Pass 1's reading equals it; it needs
// pandoc on PATH (CI installs it; locally it is skipped with one loud line).

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseBibEntries } from '../bin/lib/citations.js';
import { renderedClaim, runPass1, type BibEntry } from '../bin/lib/verify/pass1.js';

const LECUN = (fields: string): string => `@article{k,\n  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},\n  title = {Deep learning},\n  doi = {10.1038/nature14539},\n  ${fields}\n}\n`;

async function verdict(bib: string): Promise<[string, string]> {
  const { entries, problems } = parseBibEntries(bib);
  assert.deepEqual(problems, []);
  const rows = await runPass1('Deep learning changed vision [@k].', '/no/such/CITATIONS.bib', { bibEntries: entries });
  const r = rows.find((x) => x.citekey === 'k');
  assert.ok(r);
  return [r.verdict, r.reason];
}

test('VRFY-13: a `date` the export prints is the year Pass 1 compares — date 1999 (alone or over year 2015) is MIS-CITED, date 2015-05-28 is OK', async () => {
  assert.deepEqual((await verdict(LECUN('date = {1999}')))[0], 'MIS-CITED');
  assert.match((await verdict(LECUN('date = {1999}')))[1], /year \(claimed 1999, record 2015\)/);
  assert.match((await verdict(LECUN('year = {2015},\n  date = {1999}')))[1], /year \(claimed 1999, record 2015\)/);
  assert.deepEqual((await verdict(LECUN('date = {2015-05-28}')))[0], 'OK');
  assert.deepEqual((await verdict(LECUN('year = {1999},\n  date = {2015}')))[0], 'OK', 'the date wins, as Pandoc prints it');
  assert.match((await verdict(LECUN('date = {spring}')))[1], /`date = \{spring\}` is not a date Pass 1 can read/);
});

test('VRFY-13: a `subtitle` or `titleaddon` the export appends must be the record\'s — an invented one is MIS-CITED', async () => {
  const [v, reason] = await verdict(LECUN('year = {2015},\n  subtitle = {Why convolutional nets were a mistake}'));
  assert.equal(v, 'MIS-CITED');
  assert.match(reason, /title \(0\.\d\d < 0\.92\)/);
  assert.equal((await verdict(LECUN('year = {2015},\n  titleaddon = {A fabricated addon}')))[0], 'MIS-CITED');
  assert.equal((await verdict(LECUN('year = {2015}')))[0], 'OK');
});

test('VRFY-13: biblatex fields no registrar confirms (maintitle, shorttitle, origdate, …) are refused, naming the field', async () => {
  for (const f of ['maintitle = {Fake}', 'shorttitle = {Fake}', 'origdate = {1990}', 'origyear = {1990}', 'pubstate = {inpress}']) {
    const [v, reason] = await verdict(LECUN(`year = {2015},\n  ${f}`));
    assert.equal(v, 'MIS-CITED', f);
    assert.match(reason, new RegExp(`the entry sets \`${f.split(' ')[0]}\`, which the export prints`), f);
  }
});

function pandocVersion(): string | null {
  try {
    return /^pandoc\S*\s+(\S+)/m.exec(execFileSync('pandoc', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))?.[1] ?? null;
  } catch {
    return null;
  }
}

test('VRFY-13 (pandoc differential): Pass 1 reads each entry\'s title and year exactly as pandoc\'s biblatex reader renders them', (t) => {
  if (pandocVersion() === null) {
    if (process.env['CI'] === 'true') assert.fail('pandoc is not on PATH, and CI=true requires it');
    process.stderr.write('\n*** VRFY-13 pandoc differential SKIPPED: pandoc is not on PATH (CI runs it) ***\n\n');
    t.skip('pandoc is not on PATH');
    return;
  }
  const cases = [
    'year = {2015}',
    'date = {1999}',
    'year = {2015},\n  date = {1999-03}',
    'year = {2015},\n  subtitle = {Why convolutional nets were a mistake}',
    'year = {2015},\n  titleaddon = {A fabricated addon}',
    'year = {2015},\n  subtitle = {A review},\n  titleaddon = {Second edition}',
    'date = {2015-05-28/2015-06-01}',
  ];
  for (const fields of cases) {
    const bib = LECUN(fields);
    const csl = JSON.parse(execFileSync('pandoc', ['-f', 'biblatex', '-t', 'csljson'], { input: bib, encoding: 'utf8' })) as Array<{ title?: string; issued?: { 'date-parts'?: number[][] } }>;
    const want = { title: csl[0]?.title ?? '', year: csl[0]?.issued?.['date-parts']?.[0]?.[0] ?? null };
    const entry = parseBibEntries(bib).entries[0] as unknown as BibEntry;
    const got = renderedClaim(entry);
    assert.ok(!('refused' in got), fields);
    if ('refused' in got) continue;
    assert.deepEqual({ title: got.title, year: got.year }, want, fields);
  }
});
