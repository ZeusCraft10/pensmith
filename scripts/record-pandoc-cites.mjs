// scripts/record-pandoc-cites.mjs — re-record the Pandoc citation corpora.
//
// tests/fixtures/citation-grammar/pandoc-cites.json pairs each markdown case
// with the citation keys Pandoc renders for it (the Cite nodes of
// `pandoc --from markdown --to json`, first-appearance order, deduplicated).
// tests/fixtures/citation-grammar/unparseable.json (VRFY-09, D-20-07) pairs
// each case of the UNPARSEABLE rules with Pandoc's reading of it: every Cite
// cluster (its keys and citation modes) and the literal text Pandoc prints
// outside citations. tests/citation-grammar-pandoc.test.ts checks
// bin/lib/citation-token.ts against both on every run, and against a live
// pandoc whenever one is on PATH; this script rewrites the recorded readings
// (and the pandoc version) from the pandoc on PATH. Add a case by appending
// `{ "name", "md", … }` and re-running.
//
// Run via: node scripts/record-pandoc-cites.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/citation-grammar/pandoc-cites.json', import.meta.url));
const UNPARSEABLE = fileURLToPath(new URL('../tests/fixtures/citation-grammar/unparseable.json', import.meta.url));

function pandocAst(md) {
  return JSON.parse(execFileSync('pandoc', ['--from', 'markdown', '--to', 'json'], { input: md, encoding: 'utf8' }));
}

/** The citation keys pandoc renders for `md`, deduplicated in first-appearance order. */
export function pandocCiteKeys(md) {
  const ast = pandocAst(md);
  const keys = [];
  const walk = (x) => {
    if (Array.isArray(x)) {
      for (const v of x) walk(v);
    } else if (x !== null && typeof x === 'object') {
      if (x.t === 'Cite') for (const c of x.c[0]) if (!keys.includes(c.citationId)) keys.push(c.citationId);
      for (const v of Object.values(x)) walk(v);
    }
  };
  walk(ast.blocks);
  walk(ast.meta);
  return keys;
}

/**
 * Pandoc's reading of `md`: each Cite cluster as its items `{id, mode}` in
 * document order, and the literal text it prints outside citations (Str
 * contents, a space for every Space / SoftBreak / LineBreak; code and raw
 * blocks left out).
 */
export function pandocReading(md) {
  const ast = pandocAst(md);
  const cites = [];
  const walkCites = (x) => {
    if (Array.isArray(x)) {
      for (const v of x) walkCites(v);
    } else if (x !== null && typeof x === 'object') {
      if (x.t === 'Cite') cites.push(x.c[0].map((c) => ({ id: c.citationId, mode: c.citationMode.t })));
      for (const v of Object.values(x)) walkCites(v);
    }
  };
  walkCites(ast.blocks);
  const literal = (x) => {
    if (Array.isArray(x)) return x.map(literal).join('');
    if (x === null || typeof x !== 'object' || typeof x.t !== 'string') return '';
    if (x.t === 'Str') return x.c;
    if (x.t === 'Space' || x.t === 'SoftBreak' || x.t === 'LineBreak') return ' ';
    if (x.t === 'Cite' || x.t === 'Code' || x.t === 'CodeBlock' || x.t === 'RawInline' || x.t === 'RawBlock') return '';
    return literal(x.c);
  };
  return { cites, literal: literal(ast.blocks) };
}

const version = /^pandoc\S*\s+(\S+)/m.exec(execFileSync('pandoc', ['--version'], { encoding: 'utf8' }))?.[1] ?? 'unknown';
const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
doc.pandoc = version;
for (const c of doc.cases) c.pandoc = pandocCiteKeys(c.md);
writeFileSync(FIXTURE, `${JSON.stringify(doc, null, 1)}\n`);
const unparseable = JSON.parse(readFileSync(UNPARSEABLE, 'utf8'));
unparseable.pandoc = version;
for (const c of unparseable.cases) c.reading = pandocReading(c.md);
writeFileSync(UNPARSEABLE, `${JSON.stringify(unparseable, null, 1)}\n`);
process.stdout.write(`re-recorded ${doc.cases.length} + ${unparseable.cases.length} case(s) with pandoc ${version}\n`);
