// tests/placeholder-artifacts.test.ts — PENSMITH_NO_LLM output is marked and can never ship.
//
// With PENSMITH_NO_LLM=1 every generation returns "[PENSMITH_NO_LLM placeholder
// — …]". Nothing recognised that text, so verify passed a placeholder section,
// compile assembled it and done exported a "paper" made of placeholders (which
// also carry the word PENSMITH). Now each placeholder artifact carries a
// `placeholder: true` frontmatter flag, and verify, compile and done refuse
// placeholder text with exit 2 — flagged or not (older runs left unflagged files).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { complete } from '../bin/lib/anthropic.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

interface RunResult { status: number | null; stdout: string; stderr: string }

function runCli(args: string[], cwd: string): RunResult {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-placeholder-home-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA']) env[k] = home;
  delete env['ANTHROPIC_API_KEY'];
  delete env['GPTZERO_API_KEY'];
  env['PENSMITH_NO_LLM'] = '1';
  env['PENSMITH_OFFLINE'] = '1';
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const OUTLINE = [
  '# Placeholder Fixture',
  '',
  '| # | slug | title | depends_on | word target | assigned_sources |',
  '| --- | --- | --- | --- | --- | --- |',
  '| 1 | intro | Intro | | 300 | |',
  '',
].join('\n');

const LEGACY_PLACEHOLDER = '[PENSMITH_NO_LLM placeholder — Write section 1 (intro).]';

/** One-section paper; `draft` is the section DRAFT.md, recorded as verified against itself. */
function paper(draft: string | null, planStatus = 'verified'): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-placeholder-'));
  const pdir = join(root, '.paper');
  const sdir = join(pdir, 'sections', '01-intro');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'placeholder', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }),
  );
  writeFileSync(join(pdir, 'LIBRARY.json'), '{"$schemaVersion":1,"entries":[]}\n');
  writeFileSync(join(pdir, 'OUTLINE.md'), OUTLINE);
  writeFileSync(join(pdir, 'CITATIONS.bib'), '@article{real2020, title={Real}, author={Doe, Jane}, year={2020}}\n');
  const hash = draft === null ? 'null' : computeDraftHash(Buffer.from(draft), []);
  writeFileSync(
    join(sdir, 'PLAN.md'),
    `---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: ${planStatus}\nassigned_sources: []\nverified_against_draft_hash: ${hash}\n---\n## Brief\n\nOpen the topic.\n`,
  );
  if (draft !== null) {
    writeFileSync(join(sdir, 'DRAFT.md'), draft);
    writeFileSync(join(sdir, 'VERIFICATION.md'), 'Status: verified\n\n## Pass-1\n\n## Pass-3\n');
  }
  return root;
}

const sectionFile = (root: string, name: string): string => join(root, '.paper', 'sections', '01-intro', name);

test('placeholder: complete() under PENSMITH_NO_LLM says its text is a placeholder', async () => {
  const prev = process.env['PENSMITH_NO_LLM'];
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    const r = await complete({ system: 's', messages: [{ role: 'user', content: 'Write section 1.' }] });
    assert.equal(r.placeholder, true);
    assert.match(r.text, /PENSMITH_NO_LLM placeholder/);
  } finally {
    if (prev === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = prev;
  }
});

test('placeholder: write, plan, new and outline flag their placeholder output in frontmatter', () => {
  const root = paper(null, 'planned');
  const w = runCli(['write', '1'], root);
  assert.equal(w.status, 0, w.stdout + w.stderr);
  assert.equal(parseFrontmatter(readFileSync(sectionFile(root, 'DRAFT.md'), 'utf8')).frontmatter['placeholder'], true, 'DRAFT.md');

  const p = runCli(['plan', '1'], root);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.equal(parseFrontmatter(readFileSync(sectionFile(root, 'PLAN.md'), 'utf8')).frontmatter['placeholder'], true, 'PLAN.md');

  const fresh = mkdtempSync(join(tmpdir(), 'pensmith-placeholder-new-'));
  writeFileSync(join(fresh, 'assignment.txt'), 'Write about tidal energy.\n');
  const n = runCli(['new', '--from', 'assignment.txt'], fresh);
  assert.equal(n.status, 0, n.stdout + n.stderr);
  assert.equal(parseFrontmatter(readFileSync(join(fresh, '.paper', 'INTAKE.md'), 'utf8')).frontmatter['placeholder'], true, 'INTAKE.md');

  const o = runCli(['outline', '--yolo'], fresh);
  assert.equal(o.status, 0, o.stdout + o.stderr);
  assert.equal(parseFrontmatter(readFileSync(join(fresh, '.paper', 'OUTLINE.md'), 'utf8')).frontmatter['placeholder'], true, 'OUTLINE.md');
});

test('placeholder: verify refuses a placeholder draft with exit 2 and never marks it verified', () => {
  const root = paper(null, 'planned');
  assert.equal(runCli(['write', '1'], root).status, 0);
  const v = runCli(['verify', '1'], root);
  assert.equal(v.status, 2, v.stdout + v.stderr);
  assert.match(v.stdout + v.stderr, /placeholder/);
  const verification = readFileSync(sectionFile(root, 'VERIFICATION.md'), 'utf8');
  assert.match(verification, /^Status: failed/m);
  assert.match(verification, /placeholder/);
  const plan = parseFrontmatter(readFileSync(sectionFile(root, 'PLAN.md'), 'utf8')).frontmatter;
  assert.notEqual(plan['status'], 'verified');
});

test('placeholder: compile refuses a placeholder section even when an old VERIFICATION.md says verified', () => {
  // An unflagged placeholder, as an older --dry-run left it, recorded as verified.
  const root = paper(`${LEGACY_PLACEHOLDER}\n`);
  const c = runCli(['compile'], root);
  assert.equal(c.status, 2, c.stdout + c.stderr);
  assert.match(c.stdout, /section 1 \(intro\): DRAFT\.md is placeholder text/);
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), 'compile must not assemble placeholder text');
});

test('placeholder: done refuses to export a placeholder draft, even with --yolo', () => {
  const root = paper('A real opening paragraph about tidal energy.\n');
  writeFileSync(join(root, '.paper', 'DRAFT.md'), `# Paper\n\n${LEGACY_PLACEHOLDER}\n`);
  const d = runCli(['done', '--yolo', '--format', 'md'], root);
  assert.equal(d.status, 2, d.stdout + d.stderr);
  assert.match(d.stdout, /placeholder/);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing may be exported');
});

test('placeholder: done refuses when a section draft is a placeholder', () => {
  const root = paper('---\nplaceholder: true\n---\nSection text.\n');
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nSection text.\n');
  const d = runCli(['done', '--yolo', '--format', 'md'], root);
  assert.equal(d.status, 2, d.stdout + d.stderr);
  assert.match(d.stdout, /section 01-intro: DRAFT\.md is placeholder text/);
  assert.ok(!existsSync(join(root, '.paper', 'export')));
});

test('placeholder: a real draft still verifies and compiles', () => {
  const root = paper('A real opening paragraph about tidal energy.\n', 'written');
  const v = runCli(['verify', '1'], root);
  assert.equal(v.status, 0, v.stdout + v.stderr);
  const c = runCli(['compile'], root);
  assert.equal(c.status, 0, c.stdout + c.stderr);
});
