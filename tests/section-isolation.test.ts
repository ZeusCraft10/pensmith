// tests/section-isolation.test.ts — re-doing one section never touches another.
//
// Section-as-phase is the load-bearing design choice: each section has its own
// folder, and re-doing section 3 (plan --revise, write, verify) must leave
// every file of sections 1, 2, 4 and 5, and every paper-wide file but the
// paper's own logs, exactly as they were. This used to be checked by running
// `plan 3` in a folder with no outline, where the CLI wrote a new
// 03-placeholder folder, so the other sections stayed untouched trivially.
// Now a real five-section paper is planned, drafted and verified by the CLI,
// the middle section is re-done through the real verbs, and every file is
// hashed before and after each step. A section verb whose section is not in
// the outline is refused instead of inventing a folder.
//
// The strict section path helpers also reject a slug that is not kebab-case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberOutline, writeOutline } from '../bin/lib/outline-store.js';
import { importBibliography, updateLibrary } from '../bin/lib/library.js';
import { scriptedCli } from './lib/cli-env.js';
import type { CliOutput } from './lib/export-fixture.js';
import { fileHashes } from './lib/files.js';
import { bibEntry, KNOWN_BAD_CITATIONS, VISIBLE_ISLANDS_BIB } from './lib/verify-cli.js';

test('section-isolation: slug regex ^[a-z0-9-]+$ is enforced by strict path helpers (T-3-12, ARCH-02)',
  async () => {
    // The strict section/* helpers (sectionPlan / sectionDraft /
    // sectionVerification / sectionResearch) feed into strictSectionDir,
    // which calls validateSlug — this is the T-3-12 chokepoint for
    // post-plan callers that hold a kebab-case slug from PlanFrontmatter.
    const { sectionPlan, sectionDraft, sectionVerification, sectionResearch } =
      await import('../bin/lib/paths.js');
    const strict = [sectionPlan, sectionDraft, sectionVerification, sectionResearch];
    for (const fn of strict) {
      assert.throws(
        () => fn(1, '../etc/passwd'),
        /invalid.*slug|T-3-12/i,
        `${fn.name} must throw on path-traversal slug`,
      );
      assert.throws(
        () => fn(1, 'UPPERCASE'),
        /invalid.*slug|T-3-12/i,
        `${fn.name} must throw on uppercase slug`,
      );
      assert.throws(
        () => fn(1, 'has spaces'),
        /invalid.*slug|T-3-12/i,
        `${fn.name} must throw on whitespace-containing slug`,
      );
      // Valid bare slug must not throw:
      assert.doesNotThrow(
        () => fn(1, 'introduction'),
        `${fn.name} must accept valid kebab-case slug`,
      );
    }
  },
);

const GENERATOR = fileURLToPath(new URL('./lib/redo-generator.ts', import.meta.url));

/**
 * The real CLI, on the recorded registry answers, with the scripted model
 * (tests/lib/redo-generator.ts); every run of one test shares a home.
 */
function redoCli(): (root: string, ...args: string[]) => CliOutput {
  const run = scriptedCli(GENERATOR);
  return (root, ...args) => {
    const r = run(root, args);
    return { status: r.status, out: r.stdout + r.stderr };
  };
}

test('a section verb names a section of the outline, or is refused; it never makes up a folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-no-outline-'));
  const cli = redoCli();
  mkdirSync(join(root, '.paper', 'sections', '03-methods'), { recursive: true });
  writeFileSync(join(root, '.paper', 'sections', '03-methods', 'PLAN.md'), '# Methods\n');
  for (const args of [['plan', '3', '--yolo'], ['write', '3'], ['verify', '3'], ['plan', '3', '--revise', '--yolo'], ['ack', '3', 'smith2020', '--reason', 'discussed']]) {
    const r = cli(root, ...args);
    assert.equal(r.status, 2, `${args.join(' ')} with no outline is refused\n${r.out}`);
    assert.match(r.out, /section 3 is not in the outline/, r.out);
    assert.deepEqual(readdirSync(join(root, '.paper', 'sections')), ['03-methods'], `${args.join(' ')} made no folder`);
  }
});

test('with an outline, --slug cannot name a folder the outline does not register', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-slug-outline-'));
  const cli = redoCli();
  await writeOutline(root, numberOutline({
    title: 'Three Sections',
    thesis: 'A section is a phase of the outline.',
    sections: ['intro', 'background', 'methods'].map((slug, i) => ({
      slug, title: slug, purpose: `Section ${i + 1}.`, depends_on: [], word_target: 300,
      assigned_sources: [], counterargument: false,
    })),
  }));
  const sections = join(root, '.paper', 'sections');
  const before = existsSync(sections) ? readdirSync(sections).sort() : [];
  const cases: Array<[string[], RegExp]> = [
    [['plan', '3', '--slug', 'foo', '--yolo'], /--slug foo is not section 3's folder: the outline names it 'methods'/],
    [['write', '3', '--slug', 'foo'], /--slug foo is not section 3's folder/],
    [['verify', '3', '--slug', 'foo'], /--slug foo is not section 3's folder/],
    [['ack', '3', 'smith2020', '--slug', 'foo', '--reason', 'discussed'], /--slug foo is not section 3's folder/],
    // A section the outline does not have is refused even with --slug.
    [['plan', '7', '--slug', 'appendix', '--yolo'], /section 7 is not in the outline \(its sections are 1, 2, 3\)/],
  ];
  for (const [args, reason] of cases) {
    const r = cli(root, ...args);
    assert.equal(r.status, 2, `${args.join(' ')} is refused\n${r.out}`);
    assert.match(r.out, reason, r.out);
    const after = existsSync(sections) ? readdirSync(sections).sort() : [];
    assert.deepEqual(after, before, `${args.join(' ')} made no section folder`);
  }
});

// Five sections, each drawing on one recorded work; the middle one also on a
// DOI no registry holds.
const SECTIONS = [
  { slug: 'arrays', title: 'Array Computing', keys: ['numpy-braced'] },
  { slug: 'encyclopedia', title: 'The DNA Encyclopedia', keys: ['encode-doi'] },
  { slug: 'genomes', title: 'Comparing Genomes', keys: ['salmonella', 'smith2024attention'] },
  { slug: 'mass', title: 'The Higgs Boson Mass', keys: ['higgs-mass'] },
  { slug: 'islands', title: 'Visible Islands', keys: ['leuchtner2022'] },
];

/** The known-good corpus's entries for `keys`, as they are written there. */
function corpusEntries(keys: string[]): string {
  const corpus = readFileSync(new URL('./fixtures/pass1-known-good.bib', import.meta.url), 'utf8');
  return keys.map((k) => {
    const at = corpus.indexOf(`{${k},`);
    assert.ok(at > 0, k);
    const start = corpus.lastIndexOf('@', at);
    return corpus.slice(start, corpus.indexOf('\n}\n', at) + 3);
  }).join('\n');
}

/** A work under a DOI no registry holds, from the known-bad corpus. */
const FABRICATED = bibEntry(KNOWN_BAD_CITATIONS.find((e) => e.citekey === 'smith2024attention')!);

test('re-doing section 3 of 5 (verify, plan --revise, write --force, verify) changes nothing outside section 3', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-section-isolation-'));
  const cli = redoCli();
  const paper = join(root, '.paper');
  // The outline and the library, written by the stores the outline and add verbs use.
  await writeOutline(root, numberOutline({
    title: 'Five Recorded Works',
    thesis: 'Each section draws on its own sources.',
    sections: SECTIONS.map((s, i) => ({
      slug: s.slug, title: s.title, purpose: `Section ${i + 1}.`, depends_on: [], word_target: 300,
      assigned_sources: s.keys, counterargument: false,
    })),
  }));
  const bib = corpusEntries(['numpy-braced', 'encode-doi', 'salmonella', 'higgs-mass']) + '\n' + VISIBLE_ISLANDS_BIB('leuchtner2022') + '\n' + FABRICATED;
  await updateLibrary(root, (lib, at) => importBibliography(lib, bib, at, 'refs.bib'));

  // Every section planned, drafted (one wave: none depends on another) and
  // verified by the real CLI.
  const ns = SECTIONS.map((_, i) => String(i + 1));
  for (const args of [...ns.map((n) => ['plan', n, '--yolo']), ['write'], ...ns.map((n) => ['verify', n])]) {
    const r = cli(root, ...args);
    assert.equal(r.status, 0, `${args.join(' ')}\n${r.out}`);
  }

  // The author cites the fabricated work in section 3 by hand.
  const draft3 = join(paper, 'sections', '03-genomes', 'DRAFT.md');
  writeFileSync(draft3, `${readFileSync(draft3, 'utf8').trimEnd()} A later study agrees [@smith2024attention].\n`);

  // The paper's own logs grow with every step; nothing else outside section 3 may change.
  const LOGS = new Set(['COSTS.jsonl', 'SESSION.log']);
  const outside = (): Map<string, string> =>
    new Map([...fileHashes(paper)].filter(([p]) => !p.startsWith(join('sections', '03-genomes')) && !LOGS.has(p)));
  const before = outside();
  assert.ok([...before.keys()].some((p) => p.startsWith(join('sections', '04-mass'))), 'the other sections are part of the snapshot');

  const redo: Array<[string[], number]> = [
    [['verify', '3'], 2],                    // FABRICATED: the section is refused
    [['plan', '3', '--revise', '--yolo'], 0], // the citation is removed
    [['write', '3', '--force'], 0],           // the section is drafted again
    [['verify', '3'], 0],                    // and verified
  ];
  for (const [args, status] of redo) {
    const r = cli(root, ...args);
    assert.equal(r.status, status, `${args.join(' ')}\n${r.out}`);
    const after = outside();
    for (const [p, h] of before) assert.equal(after.get(p), h, `${args.join(' ')} changed ${p}`);
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `${args.join(' ')} added or removed a file outside section 3`);
  }
  const record = JSON.parse(readFileSync(join(paper, 'sections', '03-genomes', 'VERIFICATION.json'), 'utf8')) as { status: string };
  assert.equal(record.status, 'verified');
  assert.ok(existsSync(join(paper, 'sections', '03-genomes', 'DRAFT.md.bak')), 'write --force kept the earlier draft');
});
