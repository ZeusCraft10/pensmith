// tests/known-bad-citations.test.ts — the known-bad citation corpus, through
// the real `pensmith verify`.
//
// This used to call a test-only twin of Pass 1 with the registry lookup
// hard-coded to "not found", so it proved only that "not found" maps to
// FABRICATED; the corpus's DOIs, titles and authors played no part. Now a
// section cites every entry of tests/fixtures/known-bad-citations.json and the
// real CLI verifies it against recorded registry answers: Crossref, DataCite
// and doi.org each answered 404 for the ten fabricated DOIs (recorded live,
// tests/fixtures/cassettes/{crossref,datacite,doi-org}/known-bad-fabricated*),
// and the MIS-CITED and RETRACTED entries cite real works whose records are
// recorded. Each entry must get exactly the verdict the corpus names, and the
// section must block.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bibEntry, citationVerdicts, verifySection } from './lib/verify-cli.js';

interface Entry { citekey: string; title: string; authors: string[]; year: number; journal?: string; doi: string; expected_verdict: string; why: string }

const CORPUS = JSON.parse(readFileSync(new URL('./fixtures/known-bad-citations.json', import.meta.url), 'utf8')) as Entry[];

test('the corpus holds ten fabricated DOIs, each a different one', () => {
  const fabricated = CORPUS.filter((e) => e.expected_verdict === 'FABRICATED');
  assert.equal(fabricated.length, 10);
  assert.equal(new Set(fabricated.map((e) => e.doi.toLowerCase())).size, 10);
});

test('pensmith verify gives every known-bad citation the verdict the corpus names, and blocks', () => {
  const draft = `# Introduction\n\n${CORPUS.map((e) => `One claim of this review rests on this work [@${e.citekey}].`).join('\n')}\n`;
  const v = verifySection(draft, CORPUS.map(bibEntry).join('\n'));
  assert.equal(v.status, 2, `a section citing fabricated, mis-cited and retracted works is refused\n${v.out}`);
  assert.equal(v.record.status, 'failed');
  const got = citationVerdicts(v.record);
  for (const e of CORPUS) assert.equal(got[e.citekey], e.expected_verdict, `${e.citekey} (${e.why}): ${v.record.citations.find((c) => c.citekey === e.citekey)?.reason}`);

  // FABRICATED only because every registry said so, never on silence.
  const fabricated = v.record.citations.filter((c) => c.verdict === 'FABRICATED');
  assert.equal(fabricated.length, 10, '10/10 fabricated DOIs are FABRICATED');
  for (const c of fabricated) assert.match(c.reason, /Crossref, DataCite and doi\.org/, c.reason);
  // A work a registry holds was compared, and the OpenAlex retraction check was answered.
  for (const c of v.record.citations.filter((x) => x.verdict !== 'FABRICATED')) {
    assert.doesNotMatch(c.reason, /OpenAlex could not be asked|CASSETTE_MISS/, `${c.citekey}: ${c.reason}`);
  }
});
