// tests/compile-reverify-reads-now.test.ts — compile re-verifies a stale
// section against the bibliography as it is when the re-verify runs.
//
// A stale section is re-verified (Pass 1 + Pass 3) on the draft compile read,
// and the re-verify reads the section's PLAN.md, CITATIONS.bib and
// ACKNOWLEDGEMENTS.json itself, when it runs. Re-verifying a section waits on
// the registries, so an edit can land while compile runs; a later section's
// re-verify then sees it, and a work that is no longer in CITATIONS.bib
// refuses the compile. compile runs in this process with its production
// re-verify, on the live request path against an undici MockAgent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileCommand } from '../bin/cli/compile.js';
import { writeVerificationFixture } from './lib/verification-fixture.js';
import { JSON_HEADERS, useMockRegistries } from './lib/mock-registries.js';

const agent = useMockRegistries('pensmith-compile-reverify-');

const X = { key: 'roe2019', doi: '10.5555/tidal.1', title: 'Tidal Heating in Icy Moons', family: 'Roe', given: 'Jane', year: 2019 };
const Y = { key: 'doe2020', doi: '10.5555/sediment.1', title: 'Sediment Transport in Estuaries', family: 'Doe', given: 'John', year: 2020 };
const entry = (w: typeof X): string =>
  `@article{${w.key},\n  title = {${w.title}},\n  author = {${w.family}, ${w.given}},\n  journal = {Icarus},\n  year = {${w.year}},\n  doi = {${w.doi}}\n}\n`;

/** Two sections, each verified for an earlier draft than the one on disk, so both are stale. */
function seedPaper(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-reverify-root-'));
  const pdir = join(root, '.paper');
  mkdirSync(pdir, { recursive: true });
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    ['# Tides', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      `| 1 | intro | Intro | | 300 | ${X.key} |`, `| 2 | body | Body | | 300 | ${Y.key} |`, ''].join('\n'),
  );
  writeFileSync(join(pdir, 'CITATIONS.bib'), entry(X) + entry(Y));
  for (const [n, slug, w] of [[1, 'intro', X], [2, 'body', Y]] as const) {
    const dir = join(pdir, 'sections', `0${n}-${slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'PLAN.md'), `---\nsection: ${n}\nslug: ${slug}\ntitle: ${slug}\nstatus: verified\nassigned_sources: [${w.key}]\n---\n# ${slug}\n`);
    writeFileSync(join(dir, 'DRAFT.md'), `A finding, revised since verify [@${w.key}].\n`);
    writeVerificationFixture(dir, { n, slug, draft: `A finding [@${w.key}].\n`, assignedSources: [w.key] });
  }
  return root;
}

/** Crossref holds both works; `onAsked(doi)` runs when it is asked for one. OpenAlex lists neither as retracted. */
function registries(onAsked: (doi: string) => void): void {
  agent().get('https://api.crossref.org').intercept({ path: () => true, method: 'GET' }).reply((opts) => {
    const path = decodeURIComponent(String(opts.path)).toLowerCase();
    const w = [X, Y].find((x) => path.startsWith(`/works/${x.doi}`));
    if (!w) return { statusCode: 404, data: 'Resource not found.', responseOptions: { headers: { 'content-type': 'text/plain' } } };
    onAsked(w.doi);
    return {
      statusCode: 200,
      data: JSON.stringify({
        status: 'ok',
        message: {
          DOI: w.doi, type: 'journal-article', title: [w.title], author: [{ family: w.family, given: w.given }],
          'container-title': ['Icarus'], issued: { 'date-parts': [[w.year]] },
        },
      }),
      responseOptions: { headers: JSON_HEADERS },
    };
  }).persist();
  agent().get('https://api.openalex.org').intercept({ path: (p) => p.startsWith('/works/doi:'), method: 'GET' })
    .reply(200, JSON.stringify({ id: 'https://openalex.org/W1', is_retracted: false }), { headers: JSON_HEADERS }).persist();
}

/** `pensmith compile` in `root`: its exit code and what it printed. */
async function compile(root: string): Promise<{ exitCode: number | undefined; out: string }> {
  const prevCwd = process.cwd();
  const prevExit = process.exitCode;
  const realOut = process.stdout.write.bind(process.stdout);
  let out = '';
  process.chdir(root);
  process.exitCode = undefined;
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return (realOut as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    const run = compileCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    await run({ args: { yolo: false, lintHeadings: false } });
    return { exitCode: process.exitCode as number | undefined, out };
  } finally {
    process.stdout.write = realOut;
    process.exitCode = prevExit;
    process.chdir(prevCwd);
  }
}

test('compile: a work removed from CITATIONS.bib while compile re-verifies an earlier section refuses the later section that cites it', async () => {
  const root = seedPaper();
  // While section 1 is re-verified, the bibliography loses the work section 2 cites.
  registries((doi) => {
    if (doi === X.doi) writeFileSync(join(root, '.paper', 'CITATIONS.bib'), entry(X));
  });
  const r = await compile(root);
  assert.equal(r.exitCode, 2, r.out);
  assert.match(r.out, /section 2 \(body\), re-verified since it changed: citation \[@doe2020\] is FABRICATED/);
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no DRAFT.md is written');
});

test('compile: with no edit while it runs, both stale sections re-verify and compile', async () => {
  // The guard for the refusal above: the fixture and registries compile.
  const root = seedPaper();
  registries(() => {});
  const r = await compile(root);
  assert.equal(r.exitCode, undefined, r.out);
  assert.match(r.out, /pensmith compile: wrote .*\(2 sections, 2 stale resolved\)/);
});
