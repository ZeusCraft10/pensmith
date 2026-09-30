// tests/add-remap-section.test.ts — audit #25 regression.
//
// `add <doi> --remap --section N` without --slug used to build no `only` target
// (it required BOTH --section and --slug), so it fell through to "remap every
// section" — silently editing sections the user never named. Now the slug of
// section N is resolved from the paper's sections (STATE.json — the identity
// authority, D-18-38 — then OUTLINE.md, SRC-14); a number that names no section
// is a usage error (exit 2) and nothing is remapped — never "every section".
//
// Updated for SRC-14 (19-PLAN §8): the second case used to expect the remap to
// be SKIPPED when OUTLINE.md was absent, although STATE.json lists section 2.
// STATE.json is the paper's section list, so §2 resolves from it and ONLY §2
// is remapped; the "unresolvable section" case is now a number no section
// has.
//
// Offline: PENSMITH_NETWORK_TESTS unset → crossref serves the committed
// add-doi.json cassette (DOI 10.1038/nphys1170).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ADD_MOD = new URL('../bin/cli/add.js', import.meta.url);
const CASSETTE_DOI = '10.1038/nphys1170';

interface AddMod {
  addCommand: { run: (ctx: { args: Record<string, unknown> }) => Promise<unknown> };
}

async function mkTwoSectionProject(withOutline: boolean): Promise<{ root: string; intro: string; methods: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-remap25-'));
  process.env['PENSMITH_NO_LLM'] = '1';
  delete process.env['PENSMITH_NETWORK_TESTS'];

  const { initState, initSection } = await import('../bin/lib/state.js');
  const { sectionPlan, paperDir } = await import('../bin/lib/paths.js');
  const { atomicWriteFile } = await import('../bin/lib/atomic-write.js');

  await initState(root);
  await initSection(root, 1, 'intro');
  await initSection(root, 2, 'methods');

  const planFor = async (n: number, slug: string): Promise<string> => {
    const p = sectionPlan(n, slug, root);
    await atomicWriteFile(
      p,
      `---\nsection: ${n}\nslug: ${slug}\ntitle: ${slug}\nstatus: written\nassigned_sources: []\n---\n# ${slug}\n`,
    );
    return p;
  };
  const intro = await planFor(1, 'intro');
  const methods = await planFor(2, 'methods');

  if (withOutline) {
    await atomicWriteFile(
      path.join(paperDir(root), 'OUTLINE.md'),
      [
        '# Paper',
        '',
        '| # | slug | title | depends_on | word target | assigned_sources |',
        '|---|------|-------|------------|-------------|------------------|',
        '| 1 | intro | Introduction | | 300 | |',
        '| 2 | methods | Methods | | 500 | |',
        '',
      ].join('\n'),
    );
  }
  return { root, intro, methods };
}

async function runAdd(cwd: string, args: Record<string, unknown>): Promise<void> {
  const prev = process.cwd();
  process.chdir(cwd);
  const prevExit = process.exitCode;
  try {
    const { addCommand } = (await import(ADD_MOD.href)) as AddMod;
    await addCommand.run({ args });
  } finally {
    process.exitCode = prevExit;
    process.chdir(prev);
  }
}

test('audit #25: `add --remap --section 2` (no --slug) remaps ONLY section 2', async () => {
  const { root, intro, methods } = await mkTwoSectionProject(true);
  await runAdd(root, { source: CASSETTE_DOI, remap: true, section: '2', yolo: true });

  const introTxt = fs.readFileSync(intro, 'utf8');
  const methodsTxt = fs.readFileSync(methods, 'utf8');
  assert.ok(
    !methodsTxt.includes('assigned_sources: []'),
    `section 2 must receive the source; got:\n${methodsTxt}`,
  );
  assert.ok(
    introTxt.includes('assigned_sources: []'),
    `section 1 must be UNTOUCHED (the bug remapped ALL sections); got:\n${introTxt}`,
  );
});

test('audit #25 / SRC-14 / D-18-38: without OUTLINE.md, §2 resolves from its STATE.json registration and ONLY §2 is remapped', async () => {
  const { root, intro, methods } = await mkTwoSectionProject(false);
  await runAdd(root, { source: CASSETTE_DOI, remap: true, section: '2', yolo: true });

  assert.ok(fs.readFileSync(intro, 'utf8').includes('assigned_sources: []'), 'section 1 must be untouched');
  assert.match(fs.readFileSync(methods, 'utf8'), /assigned_sources:\n\s+- aspelmeyer2009/, 'section 2 receives the source');
});

test('audit #25: `add --remap --section 5` (no such section) is a usage error and remaps nothing (never "all")', async () => {
  const { root, intro, methods } = await mkTwoSectionProject(false);
  await assert.rejects(
    runAdd(root, { source: CASSETTE_DOI, remap: true, section: '5', yolo: true }),
    (e: Error & { exitCode?: number }) => e.exitCode === 2 && /--section 5 is not one of this paper's sections/.test(e.message),
  );
  assert.ok(fs.readFileSync(intro, 'utf8').includes('assigned_sources: []'), 'section 1 must be untouched');
  assert.ok(fs.readFileSync(methods, 'utf8').includes('assigned_sources: []'), 'section 2 must be untouched');
  assert.equal(fs.existsSync(path.join(root, '.paper', 'LIBRARY.json')), false, 'checked before any lookup or write');
});

test('SRC-14 (review round 1): a remap APPENDS to a non-empty block-style assigned_sources, and a repeated remap is a no-op', async () => {
  const { root, intro, methods } = await mkTwoSectionProject(true);
  const { atomicWriteFile } = await import('../bin/lib/atomic-write.js');
  // A stub as `outline` writes it: a block sequence (a YAMLSeq node, not a JS array, inside updateFrontmatter).
  await atomicWriteFile(
    methods,
    '---\nsection: 2\nslug: methods\ntitle: methods\nstatus: planned\nassigned_sources:\n  - zhu2020\n  - lecun2015\n---\n# methods\n',
  );
  const introBefore = fs.readFileSync(intro, 'utf8');
  await runAdd(root, { source: CASSETTE_DOI, remap: true, section: '2', yolo: true });
  const once = fs.readFileSync(methods, 'utf8');
  assert.match(once, /assigned_sources:\n\s+- zhu2020\n\s+- lecun2015\n\s+- aspelmeyer2009\n/, `the existing keys are kept, the new one appended:\n${once}`);
  // The same key again (by citekey): nothing changes, nothing is dropped.
  await runAdd(root, { source: 'aspelmeyer2009', remap: true, section: '2', yolo: true });
  assert.equal(fs.readFileSync(methods, 'utf8'), once, 'a repeated remap is a no-op');
  // A key the section already holds: still no change.
  await runAdd(root, { source: CASSETTE_DOI, remap: true, section: '2', yolo: true });
  assert.equal(fs.readFileSync(methods, 'utf8'), once, 'remapping a key the section holds keeps the others');
  assert.equal(fs.readFileSync(intro, 'utf8'), introBefore, 'section 1 is untouched');
});

test('D-18-38 (review round 1): `add --section 1 --slug methods` is refused like plan/write/verify — never §2\'s PLAN.md reported as §1', async () => {
  const { root, intro, methods } = await mkTwoSectionProject(true);
  await assert.rejects(
    runAdd(root, { source: CASSETTE_DOI, section: '1', slug: 'methods', yolo: true }),
    (e: Error & { exitCode?: number }) =>
      e.exitCode === 2 && /pensmith add: section 1 is "intro" in the outline, not "methods" — drop --slug or pass --slug intro/.test(e.message),
  );
  assert.ok(fs.readFileSync(intro, 'utf8').includes('assigned_sources: []'), 'section 1 is untouched');
  assert.ok(fs.readFileSync(methods, 'utf8').includes('assigned_sources: []'), 'section 2 is untouched');
  assert.equal(fs.existsSync(path.join(root, '.paper', 'LIBRARY.json')), false, 'refused before any lookup or write');
  // The matching slug is accepted and maps §1 only.
  await runAdd(root, { source: CASSETTE_DOI, section: '1', slug: 'intro', remap: true, yolo: true });
  assert.match(fs.readFileSync(intro, 'utf8'), /assigned_sources:\n\s+- aspelmeyer2009/);
  assert.ok(fs.readFileSync(methods, 'utf8').includes('assigned_sources: []'), 'section 2 is still untouched');
});

test('D-18-38 (review round 1): a STATE.json / OUTLINE.md disagreement is refused by add as by plan (exit 1, the reconcile hint)', async () => {
  const { root, intro, methods } = await mkTwoSectionProject(true);
  const { paperDir } = await import('../bin/lib/paths.js');
  // The user renamed §2's slug in OUTLINE.md only.
  const outlinePath = path.join(paperDir(root), 'OUTLINE.md');
  fs.writeFileSync(outlinePath, fs.readFileSync(outlinePath, 'utf8').replace('| 2 | methods |', '| 2 | approach |'));
  await assert.rejects(
    runAdd(root, { source: CASSETTE_DOI, section: '2', remap: true, yolo: true }),
    (e: Error & { exitCode?: number }) => e.exitCode === 1 && /section 2 is "methods" in STATE\.json, but OUTLINE\.md/.test(e.message),
  );
  assert.ok(fs.readFileSync(intro, 'utf8').includes('assigned_sources: []'));
  assert.ok(fs.readFileSync(methods, 'utf8').includes('assigned_sources: []'));
});
