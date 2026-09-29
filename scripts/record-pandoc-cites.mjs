// scripts/record-pandoc-cites.mjs — re-record the Pandoc citation corpus.
//
// tests/fixtures/citation-grammar/pandoc-cites.json pairs each markdown case
// with the citation keys Pandoc renders for it (the Cite nodes of
// `pandoc --from markdown --to json`, first-appearance order, deduplicated).
// tests/citation-grammar-pandoc.test.ts checks bin/lib/citation-token.ts
// against it on every run, and against a live pandoc whenever one is on PATH;
// this script rewrites the recorded keys (and the pandoc version) from the
// pandoc on PATH. Add a case by appending `{ "name", "md" }` and re-running.
//
// Run via: node scripts/record-pandoc-cites.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/citation-grammar/pandoc-cites.json', import.meta.url));

/** The citation keys pandoc renders for `md`, deduplicated in first-appearance order. */
export function pandocCiteKeys(md) {
  const ast = JSON.parse(execFileSync('pandoc', ['--from', 'markdown', '--to', 'json'], { input: md, encoding: 'utf8' }));
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

const version = /^pandoc\S*\s+(\S+)/m.exec(execFileSync('pandoc', ['--version'], { encoding: 'utf8' }))?.[1] ?? 'unknown';
const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
doc.pandoc = version;
for (const c of doc.cases) c.pandoc = pandocCiteKeys(c.md);
writeFileSync(FIXTURE, `${JSON.stringify(doc, null, 1)}\n`);
process.stdout.write(`re-recorded ${doc.cases.length} case(s) with pandoc ${version}\n`);
