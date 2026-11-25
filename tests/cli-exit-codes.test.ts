// tests/cli-exit-codes.test.ts — refusals must reach the shell as non-zero exits.
//
// Exit codes: 0 ok, 1 unexpected error, 2 blocked or refused (verifier, gate,
// unknown command, invalid input), 3 an answer is needed. verify "failed",
// compile REFUSED and done BLOCKED all used to exit 0, so
// `pensmith verify 1 && pensmith compile && pensmith done` carried on after a
// refusal and Claude, CI and scripts read success. These cases drive the real CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { pensmithGlobalLibraryIndexPath } from '../bin/lib/paths.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

interface RunResult { status: number | null; stdout: string; stderr: string }

function runCli(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-exit-home-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA']) env[k] = home;
  delete env['ANTHROPIC_API_KEY'];
  delete env['OPENAI_API_KEY'];
  delete env['GPTZERO_API_KEY'];
  // Deterministic and offline: no model calls, no registry calls.
  env['PENSMITH_NO_LLM'] = '1';
  env['PENSMITH_OFFLINE'] = '1';
  Object.assign(env, extraEnv);
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

interface SectionSpec {
  n: number;
  slug: string;
  draft: string;
  verification: string;
  status?: string;
}

const OUTLINE_HEAD = [
  '# Exit Code Fixture',
  '',
  '| # | slug | title | depends_on | word target | assigned_sources |',
  '| --- | --- | --- | --- | --- | --- |',
];

/** A paper whose sections are verified against their current drafts (fresh hashes). */
function seedPaper(sections: SectionSpec[], opts: { bib?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-exit-'));
  const pdir = join(root, '.paper');
  mkdirSync(pdir, { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 2,
      paperId: 'exit-codes',
      createdAt: new Date().toISOString(),
      sections: sections.map((s) => ({ n: s.n, slug: s.slug })),
    }),
  );
  writeFileSync(join(pdir, 'LIBRARY.json'), '{"$schemaVersion":1,"entries":[]}\n');
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    [...OUTLINE_HEAD, ...sections.map((s) => `| ${s.n} | ${s.slug} | ${s.slug} | | 300 | |`), ''].join('\n'),
  );
  writeFileSync(join(pdir, 'CITATIONS.bib'), opts.bib ?? '');
  for (const s of sections) {
    const dir = join(pdir, 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), s.draft);
    const hash = computeDraftHash(Buffer.from(s.draft, 'utf8'), []);
    writeFileSync(
      join(dir, 'PLAN.md'),
      `---\nsection: ${s.n}\nslug: ${s.slug}\nstatus: ${s.status ?? 'verified'}\nassigned_sources: []\nverified_against_draft_hash: ${hash}\n---\n# ${s.slug}\n`,
    );
    writeFileSync(join(dir, 'VERIFICATION.md'), s.verification);
  }
  return root;
}

const CLEAN = 'Status: verified\n\n## Pass-1\n\n## Pass-3\n';
const FABRICATED = 'Status: failed\n\n## Pass-1\n\n- ghost2020: **FABRICATED** — titleJW=0.00, authorJW=0.00 — not in CITATIONS.bib\n';

test('exit codes: verify exits 2 when the section fails verification', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'An invented claim [@ghost2020].\n', verification: CLEAN, status: 'written' }], {
    bib: '@article{real2020, title={Real}, author={Doe, Jane}, year={2020}}\n',
  });
  const r = runCli(['verify', '1'], root);
  assert.match(r.stdout, /wrote failed VERIFICATION\.md/, r.stdout + r.stderr);
  assert.equal(r.status, 2, 'a failed verification must exit 2');
});

test('exit codes: verify exits 2 when there is no draft to verify', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'x\n', verification: CLEAN }]);
  const r = runCli(['verify', '2', '--slug', 'missing'], root);
  assert.match(r.stdout, /DRAFT\.md missing/, r.stdout + r.stderr);
  assert.equal(r.status, 2);
});

test('exit codes: verify exits 2 for a section number that is not a positive integer', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'x\n', verification: CLEAN }]);
  const r = runCli(['verify', '0'], root);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /positive integer/);
});

test('exit codes: verify exits 2 when there is no CITATIONS.bib to check against', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'A claim [@real2020].\n', verification: CLEAN, status: 'written' }]);
  rmSync(join(root, '.paper', 'CITATIONS.bib'));
  const r = runCli(['verify', '1'], root);
  assert.match(r.stdout, /CITATIONS\.bib missing/, r.stdout + r.stderr);
  assert.equal(r.status, 2, 'verify with nothing to check against is a refusal');
});

test('exit codes: a quote nobody could check exits 0 but warns loudly on stderr', () => {
  // The source resolves (Pass 1 OK from the recorded Crossref response), but
  // there is no open-access text for it, so Pass 3 cannot check the quote.
  const root = seedPaper(
    [{
      n: 1,
      slug: 'intro',
      draft: 'Engel and Calhoun report that "long-lived quantum coherence was observed in the photosynthetic complex at low temperature" [@engel2009].\n',
      verification: CLEAN,
      status: 'written',
    }],
    {
      bib:
        '@article{engel2009, title={Quantum coherence in photosynthetic complexes}, ' +
        'author={Engel, Gregory and Calhoun, Tessa}, year={2009}, journal={Nature Physics}, doi={10.1038/nphys1170}}\n',
    },
  );
  const r = runCli(['verify', '1'], root, { PENSMITH_OFFLINE: '0', PENSMITH_TEST_CASSETTES: '1' });
  assert.match(r.stdout, /wrote unverifiable VERIFICATION\.md/, r.stdout + r.stderr);
  assert.equal(r.status, 0, 'an unchecked quote does not block yet');
  assert.match(r.stderr, /WARN — section 1 has quote\(s\) that could not be checked/, 'it must not look clean');
});

test('exit codes: compile exits 2 when it refuses, and moves an earlier compiled draft aside', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'An invented claim [@ghost2020].\n', verification: FABRICATED }]);
  // A compiled draft left over from an earlier, clean compile.
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Old compiled paper\n');
  const r = runCli(['compile'], root);
  assert.match(r.stdout, /REFUSED/, r.stdout + r.stderr);
  assert.equal(r.status, 2, 'a compile refusal must exit 2');
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), 'a stale compiled DRAFT.md must not stay where done and the router read it');
  assert.equal(readFileSync(join(root, '.paper', 'DRAFT.stale.md'), 'utf8'), '# Old compiled paper\n', 'the old draft is kept, renamed');
  assert.match(r.stdout, /DRAFT\.stale\.md/, 'the refusal must say where the old draft went');
});

test('exit codes: compile still refuses with exit 2 when the earlier draft cannot be moved aside', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'An invented claim [@ghost2020].\n', verification: FABRICATED }]);
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Old compiled paper\n');
  // A non-empty folder where the old draft would go makes the move fail, as a
  // file held open by another program can on Windows.
  mkdirSync(join(root, '.paper', 'DRAFT.stale.md', 'in-the-way'), { recursive: true });
  const r = runCli(['compile'], root);
  assert.equal(r.status, 2, `a failed move must not turn the refusal into an error; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout, /REFUSED/);
  assert.match(r.stdout, /ghost2020/, 'the blocking issues must still be listed');
  assert.match(r.stdout, /could not move the earlier compiled \.paper\/DRAFT\.md aside/, 'the user must be told the old draft is still there');
  assert.equal(readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8'), '# Old compiled paper\n');
});

test('exit codes: compile exits 0 when every section is clean', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'A plain opening paragraph.\n', verification: CLEAN }]);
  const r = runCli(['compile'], root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(root, '.paper', 'DRAFT.md')));
});

test('exit codes: done exits 2 when there is no compiled draft', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'x\n', verification: CLEAN }]);
  const r = runCli(['done', '--format', 'md'], root);
  assert.match(r.stdout, /no compiled draft/, r.stdout + r.stderr);
  assert.equal(r.status, 2);
});

test('exit codes: done exits 2 when the export gate blocks, even with --yolo', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'An invented claim [@ghost2020].\n', verification: FABRICATED }]);
  writeFileSync(join(root, '.paper', 'DRAFT.md'), 'An invented claim [@ghost2020].\n');
  const r = runCli(['done', '--yolo', '--format', 'md'], root);
  assert.match(r.stdout, /BLOCKED/, r.stdout + r.stderr);
  assert.equal(r.status, 2, 'a blocked export must exit 2');
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing may be exported');
});

test('exit codes: `write` exits 2 when there is no outline to write from', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'x\n', verification: CLEAN, status: 'planned' }]);
  rmSync(join(root, '.paper', 'OUTLINE.md'));
  const r = runCli(['write'], root);
  assert.match(r.stderr, /no usable outline/, r.stdout + r.stderr);
  assert.equal(r.status, 2, 'a missing outline is a refusal, not an unexpected error');
});

test('exit codes: `write` exits 2 for a section number that is not a positive integer', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'x\n', verification: CLEAN }]);
  const r = runCli(['write', '0'], root);
  assert.match(r.stderr, /positive integer/, r.stdout + r.stderr);
  assert.equal(r.status, 2);
});

test('exit codes: `plan` with no number exits 2 when no section is ready to plan', () => {
  const root = seedPaper([{ n: 1, slug: 'intro', draft: 'x\n', verification: CLEAN }]);
  const r = runCli(['plan'], root);
  assert.match(r.stderr, /no section is ready to plan/, r.stdout + r.stderr);
  assert.equal(r.status, 2);
});

test('exit codes: status exits 2 with no paper and 1 for an unreadable STATE.json', () => {
  const empty = mkdtempSync(join(tmpdir(), 'pensmith-exit-empty-'));
  const a = runCli(['status'], empty);
  assert.match(a.stdout, /no active paper/);
  assert.equal(a.status, 2);
  const corrupt = mkdtempSync(join(tmpdir(), 'pensmith-exit-corrupt-'));
  writeFileSync(join(corrupt, 'STATE.json'), '{ not json');
  const b = runCli(['status'], corrupt);
  assert.match(b.stdout, /unreadable\/corrupt/);
  assert.equal(b.status, 1);
});

test('exit codes: open exits 2 for a paper name that does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-exit-open-'));
  const r = runCli(['open', 'no-such-paper'], dir);
  assert.match(r.stdout, /no paper named/);
  assert.equal(r.status, 2);
});

test('exit codes: open exits 2 when the paper folder no longer exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-exit-open-'));
  const home = mkdtempSync(join(tmpdir(), 'pensmith-exit-open-home-'));
  const homeEnv = { HOME: home, XDG_DATA_HOME: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, LOCALAPPDATA: home };
  const indexPath = pensmithGlobalLibraryIndexPath(process.platform, homeEnv);
  mkdirSync(join(indexPath, '..'), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    indexPath,
    JSON.stringify({
      $schemaVersion: 1,
      entries: [{ id: 'gone', name: 'moved-paper', folderPath: join(dir, 'deleted'), status: 'outline', createdAt: now, updatedAt: now }],
    }),
  );
  const r = runCli(['open', 'moved-paper'], dir, homeEnv);
  assert.match(r.stdout, /folder not found for "moved-paper"/, r.stdout + r.stderr);
  assert.equal(r.status, 2);
});

test('exit codes: the --yolo cost-cap refusal exits 2', () => {
  const root = seedPaper(
    Array.from({ length: 40 }, (_, i) => ({ n: i + 1, slug: `s${i + 1}`, draft: 'x\n', verification: CLEAN, status: 'planned' })),
  );
  const r = runCli(['write', '--yolo'], root, { PENSMITH_COST_CAP_USD: '0.0001' });
  assert.match(r.stderr, /REFUSED/, r.stdout + r.stderr);
  assert.equal(r.status, 2);
});
