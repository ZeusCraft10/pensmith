// tests/compile-citation-forms.test.ts — compile reads citations the way the
// verifier and the exporter do.
//
// compile rebuilt CITATIONS.bib from the keys a bare-lowercase `[@key]` regex
// found, so a verified `[@k, p. 5]`, `[@a; @b]`, `[@Key]`, `[-@k]` or `@k`
// lost its entry and the export showed the raw token with no reference. The
// smoother masked only bare `[@key]` tokens, so the model saw (and could edit)
// every other citation, and could add one of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCompile, type SmoothBoundaryInput } from '../bin/lib/compile.js';
import { parseBib } from '../bin/lib/citations.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { isolatedCliEnv } from './lib/cli-env.js';

const entry = (key: string, family: string, year: number): string =>
  `@article{${key},\n  title = {Work by ${family}},\n  author = {${family}, A.},\n  year = {${year}},\n  doi = {10.1000/${key.toLowerCase()}}\n}\n`;

const BIB = [
  entry('smith2020', 'Smith', 2020),
  entry('Jones2019', 'Jones', 2019),
  entry('doe2021', 'Doe', 2021),
  entry('lee2018', 'Lee', 2018),
  entry('kim2017', 'Kim', 2017),
  entry('unused2016', 'Nobody', 2016),
].join('\n');

/** A verified two-section paper. `fresh: false` leaves the stored hashes stale. */
function seedPaper(intro: string, body: string, bib = BIB, fresh = true): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-forms-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    [
      '# Citation Forms',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | smith2020 |',
      '| 2 | body | Body | | 300 | lee2018 |',
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  const seed = (n: number, slug: string, draft: string): void => {
    const dir = join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), draft);
    const hash = fresh ? computeDraftHash(Buffer.from(draft, 'utf8'), []) : 'stale';
    writeFileSync(
      join(dir, 'PLAN.md'),
      ['---', `section: ${n}`, `slug: ${slug}`, `title: ${slug}`, 'depends_on: []', 'assigned_sources: []', `verified_against_draft_hash: '${hash}'`, 'status: verified', '---', '', `# ${slug}`, ''].join('\n'),
    );
    writeFileSync(join(dir, 'VERIFICATION.md'), `# VERIFICATION (Section ${n}, ${slug})\n\nStatus: verified\n`);
  };
  seed(1, 'intro', intro);
  seed(2, 'body', body);
  return root;
}

const INTRO = 'Coherence lasts [@smith2020, p. 5], as others agree [@Jones2019; see @doe2021].\n';
const BODY = 'As @lee2018 argued, the effect is robust [-@kim2017].\n';

test('compile: CITATIONS.bib keeps every work cited in any Pandoc form and drops the uncited one', async () => {
  const root = seedPaper(INTRO, BODY);
  const result = await runCompile({ paperRoot: root, onWarn: () => {} });
  assert.equal(result.refused, false, JSON.stringify(result.refuseReasons));
  const keys = (await parseBib(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'))).map((e) => String(e['id']));
  assert.deepEqual(keys.sort(), ['Jones2019', 'doe2021', 'kim2017', 'lee2018', 'smith2020']);
});

test('compile: a bracketed citation of a work missing from CITATIONS.bib refuses compile', async () => {
  const root = seedPaper(INTRO, 'The effect is robust [@ghost2099, p. 3].\n');
  const result = await runCompile({ paperRoot: root, onWarn: () => {} });
  assert.equal(result.refused, true);
  assert.ok(result.refuseReasons?.some((r) => /ghost2099/.test(r) && /CITATIONS\.bib/.test(r)), JSON.stringify(result.refuseReasons));
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no DRAFT.md is written');
});

test('compile: the smoother sees no citation, and every citation comes back byte for byte', async () => {
  const intro = 'First claim [@doe2021].\n\nCoherence lasts [@smith2020, p. 5], as others agree [@Jones2019; see @doe2021].\n';
  const body = 'As @lee2018 argued, the effect is robust [-@kim2017].\n\nLast claim [@doe2021].\n';
  const root = seedPaper(intro, body);
  const seen: SmoothBoundaryInput[] = [];
  const result = await runCompile({
    paperRoot: root,
    onWarn: () => {},
    smoothBoundary: async (input) => {
      seen.push(input);
      return `${input.tail} Smoothly,\n\n${input.head}`;
    },
  });
  assert.equal(result.refused, false, JSON.stringify(result.refuseReasons));
  assert.equal(seen.length, 1);
  assert.doesNotMatch(seen[0]!.tail + seen[0]!.head, /@/, 'the model must not see any citation');
  const draft = readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');
  assert.match(draft, /Smoothly,/, 'the smoothed boundary is kept');
  for (const cite of ['[@smith2020, p. 5]', '[@Jones2019; see @doe2021]', '@lee2018', '[-@kim2017]']) {
    assert.ok(draft.includes(cite), `${cite} must survive smoothing unchanged`);
  }
});

test('compile: a smoother that adds a citation of its own is rejected', async () => {
  const root = seedPaper('Coherence lasts [@smith2020, p. 5].\n', 'The effect is robust [@doe2021].\n');
  const result = await runCompile({
    paperRoot: root,
    onWarn: () => {},
    smoothBoundary: async (input) => `${input.tail} As @kim2017 and (Smith, 2020) also show,\n\n${input.head}`,
  });
  assert.equal(result.refused, false);
  const draft = readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');
  assert.doesNotMatch(draft, /@kim2017|\(Smith, 2020\)/, 'a citation the model added must not reach DRAFT.md');
  assert.match(readFileSync(join(root, '.paper', 'COMPILE-REPORT.md'), 'utf8'), /rejected/);
});

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

test('compile CLI: a stale section re-verified against an empty CITATIONS.bib is refused, not a crash', () => {
  const root = seedPaper('Coherence lasts [@ghost2099, p. 5].\n', 'The effect is robust [@ghost2098].\n', '', false);
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, 'compile'], {
    cwd: root,
    encoding: 'utf8',
    env: isolatedCliEnv({ PENSMITH_TEST_CASSETTES: '1', PENSMITH_NO_LLM: '1' }),
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /REFUSED/);
  assert.match(r.stdout, /ghost2099/);
  assert.doesNotMatch(r.stderr, /parseBib|invalid BibTeX/);
});

/** Replace section 1's VERIFICATION.md with `md`. */
function setIntroVerification(root: string, md: string): void {
  writeFileSync(join(root, '.paper', 'sections', '01-intro', 'VERIFICATION.md'), md);
}

test('compile: a FABRICATED row for a key with Pandoc punctuation refuses compile and names the key', async () => {
  const root = seedPaper(INTRO, BODY);
  setIntroVerification(
    root,
    '# VERIFICATION (Section 1, intro)\n\nStatus: failed\n\n' +
      '- ghost.2099:v2: **FABRICATED** — titleJW=0.00, authorJW=0.00 — not in CITATIONS.bib\n' +
      '- a/b+c: **FABRICATED** — titleJW=0.00, authorJW=0.00 — not in CITATIONS.bib\n',
  );
  const result = await runCompile({ paperRoot: root, onWarn: () => {} });
  assert.equal(result.refused, true);
  const reasons = (result.refuseReasons ?? []).join('\n');
  assert.match(reasons, /\[@ghost\.2099:v2\] has a blocking verdict/, reasons);
  assert.match(reasons, /\[@a\/b\+c\] has a blocking verdict/, reasons);
});

test('compile: a section whose VERIFICATION.md says Status: failed is refused even when no verdict row parses', async () => {
  const root = seedPaper(INTRO, BODY);
  setIntroVerification(root, '# VERIFICATION (Section 1, intro)\n\nStatus: failed\n\n* a row in a shape the parser does not read\n');
  const result = await runCompile({ paperRoot: root, onWarn: () => {} });
  assert.equal(result.refused, true);
  assert.ok(result.refuseReasons?.some((r) => /section 1 \(intro\).*Status is 'failed'/.test(r)), JSON.stringify(result.refuseReasons));
  assert.equal(existsSync(join(root, '.paper', 'DRAFT.md')), false, 'no DRAFT.md is written');
});

test('compile: a quotation with no citation does not block compile, but compile warns about it', async () => {
  const root = seedPaper(INTRO, BODY);
  setIntroVerification(
    root,
    '# VERIFICATION (Section 1, intro)\n\nStatus: unverifiable\n\n' +
      '- (no citation) ("I just did not feel like the system cared…"): **UNATTRIBUTED** — lev=0.000 — a direct quotation with no citation\n',
  );
  const warnings: string[] = [];
  const result = await runCompile({ paperRoot: root, onWarn: (m) => warnings.push(m) });
  assert.equal(result.refused, false, JSON.stringify(result.refuseReasons));
  assert.ok(warnings.some((w) => /section 1 \(intro\).*1 quotation with no citation/.test(w)), warnings.join('\n'));
});
