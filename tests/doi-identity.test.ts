// tests/doi-identity.test.ts — DOIs are compared through bin/lib/doi.ts, and
// identifiers are normalized before a registry sees them.
//
// DOIs are case-insensitive. Pass 1 compared the bib's DOI with Crossref's as
// raw strings, so `10.1109/MCSE.2011.37` against Crossref's
// `10.1109/mcse.2011.37` took the strict "redirected to a different work"
// branch and a genuine citation became MIS-CITED. This file pins the helper,
// the bib writer's normalization, and an AST guard against raw DOI equality.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { sameDoi, normalizeIsbn } from '../bin/lib/doi.js';
import { writeBibtex } from '../bin/lib/bibtex-write.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import { bibFile } from './lib/bib-fixture.js';
import { filesUnder } from './lib/files.js';

test('sameDoi: case, a doi: prefix and a doi.org link do not make two DOIs different', () => {
  assert.ok(sameDoi('10.1109/MCSE.2011.37', '10.1109/mcse.2011.37'));
  assert.ok(sameDoi('doi:10.48550/arXiv.1706.03762', 'https://doi.org/10.48550/ARXIV.1706.03762'));
  assert.ok(!sameDoi('10.1109/mcse.2011.37', '10.1109/mcse.2011.38'));
  assert.ok(!sameDoi(undefined, undefined), 'two missing DOIs are not the same DOI');
  assert.ok(!sameDoi('not a doi', 'not a doi'));
});

test('Pass 1: an uppercase DOI Crossref reports in lowercase is the same DOI, not a "different work"', async () => {
  // Recorded Crossref record: DOI 10.1128/iai.66.9.4305-4312.1998.
  const bibPath = bibFile(
    '@article{mcclelland1998,\n' +
    '  title = {Comparison of Sample Sequences of the Salmonella typhi Genome to the Sequence of the Complete Escherichia coli K-12 Genome},\n' +
    '  author = {McClelland, Michael and Wilson, Richard K.},\n  year = {1998},\n  journal = {Infection and Immunity},\n' +
    '  doi = {10.1128/IAI.66.9.4305-4312.1998}\n}\n');
  const [r] = await runPass1('# S\n\nSalmonella [@mcclelland1998].\n', bibPath);
  assert.equal(r?.verdict, 'OK', r?.reason);
  assert.doesNotMatch(r!.reason, /different work/);
});

test('normalizeIsbn: separators go, the check digit must be right', () => {
  assert.equal(normalizeIsbn('ISBN 978-0-262-03384-8'), '9780262033848');
  assert.equal(normalizeIsbn('0-262-03384-4'), '0262033844');
  assert.equal(normalizeIsbn('0-8044-2957-x'), '080442957X');
  assert.equal(normalizeIsbn('978-0-262-03384-9'), null);
  assert.equal(normalizeIsbn('12345'), null);
});

test('writeBibtex writes DOIs in their normalized (lowercase) form', async () => {
  const c: SourceCandidate = {
    source: 'semanticscholar', id: 'x', doi: 'https://doi.org/10.1109/MCSE.2011.37', title: 'The NumPy Array',
    authors: ['van der Walt, Stéfan'], year: 2011, retracted: false, last_verified: '2026-11-25T00:00:00.000Z',
    citekey: 'walt2011', raw: {},
  };
  const p = join(mkdtempSync(join(tmpdir(), 'pensmith-doi-write-')), 'CITATIONS.bib');
  await writeBibtex([c], p);
  const bib = readFileSync(p, 'utf8');
  assert.match(bib, /doi = \{10\.1109\/mcse\.2011\.37\}/i);
  assert.doesNotMatch(bib, /MCSE|doi\.org/);
});

// ---------------------------------------------------------------------------
//   No raw DOI equality outside bin/lib/doi.ts
// ---------------------------------------------------------------------------

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['bin', 'hooks', 'scripts'];
const EXTS = new Set(['.ts', '.mts', '.mjs', '.js', '.cjs']);
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
]);

/** Does this expression name a DOI (`doi`, `claimed.DOI`, `actualDoi`, `canonicalDoi`)? */
function namesDoi(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) return namesDoi(e.expression);
  if (ts.isIdentifier(e)) return /doi$/i.test(e.text);
  if (ts.isPropertyAccessExpression(e)) return /doi$/i.test(e.name.text);
  if (ts.isElementAccessExpression(e)) return ts.isStringLiteral(e.argumentExpression) && /doi$/i.test(e.argumentExpression.text);
  return false;
}

/** A side that only checks for absence or type: `undefined`, `null`, `''`, `typeof x`. */
function isPresenceCheck(e: ts.Expression): boolean {
  return e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined')
    || (ts.isStringLiteral(e) && e.text === '') || ts.isTypeOfExpression(e) || ts.isNumericLiteral(e);
}

function rawDoiComparisons(file: string, text: string): string[] {
  const kind = extname(file) === '.ts' || extname(file) === '.mts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && EQUALITY.has(n.operatorToken.kind)
      && (namesDoi(n.left) || namesDoi(n.right)) && !isPresenceCheck(n.left) && !isPresenceCheck(n.right)) {
      out.push(n.getText(sf));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

test('the DOI-equality detector flags raw comparisons and leaves presence checks alone', () => {
  assert.deepEqual(rawDoiComparisons('p.ts', 'if (actualDoi !== claimed.DOI) {}\nif (a.doi === b) {}\nx = r["DOI"] == y;'), [
    'actualDoi !== claimed.DOI', 'a.doi === b', 'r["DOI"] == y',
  ]);
  assert.deepEqual(rawDoiComparisons('p.ts', 'if (c.doi !== undefined) {}\nif (typeof e.DOI === "string") {}\nif (doi === null || doi === "") {}'), []);
});

test('no code outside bin/lib/doi.ts compares DOIs as raw strings (use sameDoi or normalizeDoi)', () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of filesUnder(join(REPO, root), { keep: (n) => EXTS.has(extname(n)), skipDirs: ['node_modules', 'dist'] })) {
      const rel = relative(REPO, file).split('\\').join('/');
      if (rel === 'bin/lib/doi.ts') continue;
      for (const cmp of rawDoiComparisons(file, readFileSync(file, 'utf8'))) offenders.push(`${rel}: ${cmp}`);
    }
  }
  assert.deepEqual(offenders, []);
});
