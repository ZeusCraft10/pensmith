// tests/add-remap-section.test.ts — audit #25 regression.
//
// `add <doi> --remap --section N` without --slug used to build no `only` target
// (it required BOTH --section and --slug), so it fell through to "remap every
// section" — silently editing sections the user never named. Now the slug is
// resolved from OUTLINE.md for section N; if it can't be resolved, the remap is
// skipped rather than applied to all.
//
// Cassette mode: http.ts answers from the committed add-doi.json cassette
// (DOI 10.1038/nphys1170).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { numberOutline, writeOutline } from '../bin/lib/outline-store.js';
import { isolatedCliEnv } from './lib/cli-env.js';

const ADD_MOD = new URL('../bin/cli/add.js', import.meta.url);
const CASSETTE_DOI = '10.1038/nphys1170';
const READY = fs.existsSync(fileURLToPath(new URL('../bin/cli/add.ts', import.meta.url)));

interface AddMod {
  addCommand: { run: (ctx: { args: Record<string, unknown> }) => Promise<unknown> };
}

async function mkTwoSectionProject(withOutline: boolean): Promise<{ root: string; intro: string; methods: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-remap25-'));
  process.env['PENSMITH_NO_LLM'] = '1';
  process.env['PENSMITH_TEST_CASSETTES'] = '1';

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
  try {
    const { addCommand } = (await import(ADD_MOD.href)) as AddMod;
    await addCommand.run({ args });
  } finally {
    process.chdir(prev);
  }
}

test('audit #25: `add --remap --section 2` (no --slug) remaps ONLY section 2', { skip: !READY }, async () => {
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

test('audit #25: `add --remap --section 2` with no resolvable slug skips the remap (does NOT remap all)', { skip: !READY }, async () => {
  // No OUTLINE.md → section 2's slug cannot be resolved → remap is skipped.
  const { root, intro, methods } = await mkTwoSectionProject(false);
  await runAdd(root, { source: CASSETTE_DOI, remap: true, section: '2', yolo: true });

  assert.ok(fs.readFileSync(intro, 'utf8').includes('assigned_sources: []'), 'section 1 must be untouched');
  assert.ok(fs.readFileSync(methods, 'utf8').includes('assigned_sources: []'), 'section 2 must be untouched (skip, not remap-all)');
});

// The notice for a --section that names no section says why, through the real
// CLI. It used to be one fixed line, "pass --slug, or run `pensmith outline`
// first", which with an outline cannot help: --slug never names a folder the
// outline lacks, and a --slug the outline does not name is the problem itself.
function addRemap(root: string, ...flags: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = isolatedCliEnv({ PENSMITH_TEST_CASSETTES: '1', PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: undefined }, 'pensmith-remap-notice-home-');
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url)),
    'add', CASSETTE_DOI, '--remap', ...flags], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('add --remap --section: a section that cannot be resolved gets the reason, and nothing is remapped', async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-remap-notice-'));
  const outlined = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-remap-notice-'));
  await writeOutline(outlined, numberOutline({
    title: 'Two Sections',
    thesis: 'A section is a phase of the outline.',
    sections: ['intro', 'methods'].map((slug, i) => ({
      slug, title: slug, purpose: `Section ${i + 1}.`, depends_on: [], word_target: 300,
      assigned_sources: [], counterargument: false,
    })),
  }));
  const cases: Array<[string, string[], string]> = [
    [bare, ['--section', '2'],
      'pensmith add: --section 2: section 2 is not in the outline, so there is no such section — run `pensmith outline` first ' +
      '(or `pensmith status` to see the sections), or name the section\'s folder with --slug. No sections remapped.'],
    [bare, ['--section', 'abc'], 'pensmith add: --section abc: a section number is a positive integer. No sections remapped.'],
    [bare, ['--section', '0'], 'pensmith add: --section 0: a section number is a positive integer. No sections remapped.'],
    [outlined, ['--section', '2', '--slug', 'foo'],
      'pensmith add: --section 2: --slug foo is not section 2\'s folder: the outline names it \'methods\' — ' +
      'drop --slug, or change the outline with `pensmith outline`. No sections remapped.'],
    [outlined, ['--section', '7'],
      'pensmith add: --section 7: section 7 is not in the outline (its sections are 1, 2) — ' +
      'run `pensmith status` to see them, or `pensmith outline` to change the outline. No sections remapped.'],
  ];
  for (const [root, flags, notice] of cases) {
    const r = addRemap(root, ...flags);
    assert.equal(r.status, 0, `the source is still added\n${r.stdout}${r.stderr}`);
    const lines = r.stdout.split('\n');
    assert.ok(lines.includes(notice), `${flags.join(' ')}: expected the line\n${notice}\ngot:\n${r.stdout}`);
    assert.doesNotMatch(r.stdout, /pass --slug|remapped .* onto/, r.stdout);
  }
});
