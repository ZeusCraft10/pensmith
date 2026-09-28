// tests/add-remap-relevance.test.ts — SRC-14 (D-19-20): after `add`, the
// remap question is a multi-select over the paper's sections with ONLY the
// relevant ones preselected (their title / purpose / plan share words with the
// source); `--remap <key> --section N` changes only §N; `--remap <key>` alone
// remaps the relevant sections it lists; `--yolo` and runs without a terminal
// skip the remap and print the command. Spawns the BUILT CLI (run
// `npm run build` first) in scripted numbered-prompt mode (the Tier-2
// stand-in for a terminal answer).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initState, initSection } from '../bin/lib/state.js';
import { sectionPlan } from '../bin/lib/paths.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(REPO, 'dist', 'bin', 'pensmith.js');

const SECTIONS = [
  { n: 1, slug: 'intro', title: 'Introduction', purpose: 'Frame why adolescent wellbeing research matters.' },
  { n: 2, slug: 'attention-models', title: 'Attention-based sequence models', purpose: 'Explain how the Transformer replaced recurrent networks.' },
  { n: 3, slug: 'survey-method', title: 'Survey method', purpose: 'Describe the questionnaire and sample.' },
];

async function paper(): Promise<{ root: string; plans: string[] }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-remaprel-'));
  await initState(root);
  const plans: string[] = [];
  for (const s of SECTIONS) {
    await initSection(root, s.n, s.slug);
    const p = sectionPlan(s.n, s.slug, root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      ['---', `section: ${s.n}`, `slug: ${s.slug}`, `title: ${s.title}`, `purpose: ${s.purpose}`, 'status: planned', 'assigned_sources: []', '---', '', `# ${s.title}`, ''].join('\n'),
    );
    plans.push(p);
  }
  fs.writeFileSync(
    path.join(root, '.paper', 'OUTLINE.md'),
    ['# Paper', '', '| # | slug | title | depends_on | word target | assigned_sources |', '|---|---|---|---|---|---|', ...SECTIONS.map((s) => `| ${s.n} | ${s.slug} | ${s.title} | | 300 | |`), ''].join('\n'),
  );
  // An old mtime makes any rewrite visible.
  const old = new Date('2020-01-01T00:00:00Z');
  for (const p of plans) fs.utimesSync(p, old, old);
  return { root, plans };
}

function cli(root: string, args: string[], opts: { input?: string; numbered?: boolean } = {}): { status: number | null; stdout: string; stderr: string } {
  assert.ok(fs.existsSync(CLI), 'dist/ is missing — run `npm run build` first');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['PENSMITH_TEST'] = '1';
  env['PENSMITH_NO_LLM'] = '1';
  delete env['PENSMITH_NETWORK_TESTS'];
  if (opts.numbered) env['PENSMITH_PROMPT_MODE'] = 'numbered';
  else delete env['PENSMITH_PROMPT_MODE'];
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, input: opts.input ?? '', encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function assigned(p: string): unknown {
  return parseFrontmatter(fs.readFileSync(p, 'utf8')).frontmatter['assigned_sources'];
}

function mtime(p: string): number {
  return fs.statSync(p).mtimeMs;
}

test('SRC-14: the remap multi-select preselects only the relevant section; accepting it maps only §2', async () => {
  const { root, plans } = await paper();
  const [m1, m3] = [mtime(plans[0]!), mtime(plans[2]!)];
  const r = cli(root, ['add', 'arXiv:1706.03762'], { numbered: true, input: '\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Map vaswani2017 to which sections\? \(relevant ones are preselected\) \(multiselect\)/);
  assert.match(r.stderr, /1\) 1 {2}— §1 Introduction\n\s+no shared topic words/);
  assert.match(r.stderr, /2\) 2 {2}— §2 Attention-based sequence models\n\s+shares: attention/);
  assert.match(r.stderr, /\[default: §2 Attention-based sequence models\]/);
  assert.match(r.stdout, /vaswani2017 mapped to §2 Attention-based sequence models \(assigned_sources only\)/);
  assert.deepEqual(assigned(plans[1]!), ['vaswani2017']);
  assert.deepEqual(assigned(plans[0]!), []);
  assert.equal(mtime(plans[0]!), m1, '§1 untouched');
  assert.equal(mtime(plans[2]!), m3, '§3 untouched');
});

test('SRC-14: `add --remap <key> --section 3` changes only §3; `--remap <key>` maps the relevant sections it lists', async () => {
  const { root, plans } = await paper();
  assert.equal(cli(root, ['add', 'arXiv:1706.03762', '--yolo']).status, 0);
  const [m1, m2] = [mtime(plans[0]!), mtime(plans[1]!)];
  const one = cli(root, ['add', '--remap', 'vaswani2017', '--section', '3']);
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /vaswani2017 mapped to §3/);
  assert.deepEqual(assigned(plans[2]!), ['vaswani2017']);
  assert.equal(mtime(plans[0]!), m1);
  assert.equal(mtime(plans[1]!), m2);
  const rel = cli(root, ['add', '--remap', 'vaswani2017']);
  assert.equal(rel.status, 0, rel.stderr);
  assert.match(rel.stdout, /vaswani2017 mapped to §2 Attention-based sequence models/);
  assert.deepEqual(assigned(plans[1]!), ['vaswani2017']);
  assert.deepEqual(assigned(plans[0]!), [], 'the unrelated section is never proposed');
});

test('SRC-14: --yolo and a run without a terminal skip the remap and print the command with the real key', async () => {
  const { root, plans } = await paper();
  const y = cli(root, ['add', 'arXiv:1706.03762', '--yolo']);
  assert.equal(y.status, 0, y.stderr);
  assert.match(y.stdout, /^pensmith add: remap skipped \(--yolo\); run pensmith add --remap vaswani2017 --section N$/m);
  assert.match(
    y.stdout,
    /^pensmith add: vaswani2017: relevant sections: §2 Attention-based sequence models \(shared: [^)]+\) — pensmith add --remap vaswani2017 maps it to these\.$/m,
  );
  assert.doesNotMatch(y.stdout, /§1/, 'the unrelated section is not listed');
  const other = await paper();
  const n = cli(other.root, ['add', '10.1038/nphys1170']);
  assert.equal(n.status, 0, n.stderr);
  assert.match(n.stdout, /^pensmith add: remap skipped \(non-interactive\); run pensmith add --remap aspelmeyer2009 --section N$/m);
  assert.match(n.stdout, /^pensmith add: aspelmeyer2009: no section of the outline shares its topic\.$/m);
  for (const p of [...plans, ...other.plans]) assert.deepEqual(assigned(p), []);
});
