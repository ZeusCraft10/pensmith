// tests/known-mis-cited.test.ts — real DOIs cited with the wrong metadata are
// MIS-CITED on the production path (Phase 20, VRFY-29, VRFY-13).
//
// Every row of tests/fixtures/known-mis-cited.json cites a REAL DOI whose
// Crossref record is recorded (tests/fixtures/cassettes/crossref/works-*.json)
// with a wrong title (one well below the threshold, one just below it), a
// wrong first author (the author order changed, a non-author), a wrong year,
// or another paper's title and author. Each is driven through `runPass1` as a
// bib entry cited in a draft — the real match (verify/name-match.ts) against
// the real record — and must be MIS-CITED, with its reason naming exactly the
// failing fields. A DOI's existence is necessary but not sufficient (PRD §14).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPass1 } from '../bin/lib/verify/pass1.js';

interface MisCited {
  citekey: string;
  doi: string;
  title: string;
  authors: string[];
  year: number;
  expected_verdict: string;
  failing: string[];
  why: string;
}

const rows = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/known-mis-cited.json', import.meta.url)), 'utf8')) as MisCited[];

test('known-mis-cited: the fixture covers a wrong title (one just below the threshold), a wrong first author and a wrong year', () => {
  assert.ok(rows.length >= 6);
  const fields = new Set(rows.flatMap((r) => r.failing));
  for (const f of ['title', 'first author', 'year']) assert.ok(fields.has(f), `a row whose ${f} is wrong`);
  assert.ok(rows.every((r) => r.expected_verdict === 'MIS-CITED'));
});

test('VRFY-29: every known-mis-cited row is MIS-CITED through runPass1, naming the failing fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-known-mis-cited-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(
    bibPath,
    rows
      .map((r) => `@article{${r.citekey},\n  author = {${r.authors.join(' and ')}},\n  title = {${r.title}},\n  year = {${r.year}},\n  doi = {${r.doi}},\n}\n`)
      .join('\n'),
  );
  const draft = `# Section\n\n${rows.map((r) => `A claim [@${r.citekey}].`).join('\n')}\n`;
  const results = await runPass1(draft, bibPath, { root });
  for (const want of rows) {
    const r = results.find((x) => x.citekey === want.citekey);
    assert.ok(r, want.citekey);
    assert.equal(r.verdict, 'MIS-CITED', `${want.citekey} (${want.why}): ${r.reason}`);
    const named = /^mismatch: (.*)$/.exec(r.reason)?.[1] ?? '';
    for (const f of ['title', 'first author', 'year']) {
      assert.equal(new RegExp(`(?:^|, )${f} \\(`).test(named), want.failing.includes(f), `${want.citekey}: the reason names exactly ${want.failing.join(' + ')} — ${r.reason}`);
    }
    assert.ok(typeof r.checkedAt === 'string', `${want.citekey}: the registrar answered`);
  }
  // The title just below the threshold scored close, and still failed.
  const near = results.find((x) => x.citekey === 'miscite2009near')!;
  assert.ok(near.titleJW > 0.9 && near.titleJW < 0.92, String(near.titleJW));
});
