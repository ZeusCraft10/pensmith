// tests/verify-citekey-extraction.test.ts — audit #2/#20 regression.
//
// The verifier must SEE every citation-shaped reference so an unrecognized one
// produces a BLOCKING verdict instead of silently vanishing. Before the fix, the
// Pass-1 extraction regex matched only lowercase-first BARE `[@key]` tokens, so
// uppercase keys, Pandoc locator forms, and multi-citation clusters produced NO
// verdict at all and passed every gate. This covers both the broad detector and
// the end-to-end runPass1 fail-closed behavior.
//
// Offline only (cassettes + PENSMITH_NETWORK_TESTS unset). FABRICATED verdicts
// for keys absent from the bib are returned BEFORE any network call.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractCitedKeysForVerification } from '../bin/lib/citation-token.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';

test('extractCitedKeysForVerification: catches uppercase, locator, and multi-cite forms', () => {
  const md = [
    'Bare lowercase [@smith2020].',
    'Uppercase [@Vaswani2017].',
    'Locator [@jones2019, p. 5] and [@doe2021, pp. 10-15].',
    'Multi-cite [@a; @b] and [see @c; also @d].',
    'Email-like [contact me at name@host.com] must NOT match.',
  ].join('\n');

  const keys = extractCitedKeysForVerification(md);
  // Every citation key, case + locator-stripped, deduped in order.
  assert.deepEqual(keys, [
    'smith2020', 'Vaswani2017', 'jones2019', 'doe2021', 'a', 'b', 'c', 'd',
  ]);
  // The email-style @host inside brackets is NOT a citation key.
  assert.ok(!keys.includes('host'), 'email-style name@host must not be extracted');
});

test('extractCitedKeysForVerification: bare lowercase output is unchanged (no regression)', () => {
  assert.deepEqual(
    extractCitedKeysForVerification('text [@smith2020] and [@jones-2019], [@smith2020] again'),
    ['smith2020', 'jones-2019'],
  );
});

test('runPass1 (audit #2): an uppercase citekey absent from the bib is FABRICATED, not invisible', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-extract-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  // Bib contains ONLY a lowercase entry; the draft cites an uppercase key plus a
  // locator-form fabricated key — both previously produced zero verdicts.
  const bib = [
    '@article{smith2020,',
    '  title = {A Real Source},',
    '  author = {Smith, Alice},',
    '  doi = {10.0000/real-source},',
    '  year = {2020},',
    '}',
    '',
  ].join('\n');
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, bib);
  const draftMd =
    '# Section\n\nEstablished work [@Vaswani2017] and [@madeupghost2099, pp. 10-15].\n';

  const results = await runPass1(draftMd, bibPath);
  const byKey = new Map(results.map((r) => [r.citekey, r]));
  assert.equal(byKey.get('Vaswani2017')?.verdict, 'FABRICATED', 'uppercase key not in bib must be FABRICATED');
  assert.equal(byKey.get('madeupghost2099')?.verdict, 'FABRICATED', 'locator-form key not in bib must be FABRICATED');
});
