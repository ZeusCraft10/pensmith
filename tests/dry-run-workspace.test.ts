// tests/dry-run-workspace.test.ts — GRND-19 (D-18-29, D-18-30): --dry-run
// works in `./.paper-dry-run/`, seeded from `.paper/`, and never writes `.paper/`.
//
//   - seed: a dry run over a real paper copies its paper files into the
//     workspace (through atomicWriteFile) and records the fingerprint of
//     `.paper/` in SEED.json; SESSION.log, COSTS.jsonl, INTAKE.raw.local and
//     export/ are not copied;
//   - keep: the next dry run keeps the workspace while `.paper/` is unchanged;
//   - re-seed: after `.paper/` changes, the next dry run starts over from it;
//   - `.paper/` sha256 AND mtime are unchanged by every dry run;
//   - exports of a seeded compiled paper go to `.paper-dry-run/export/` as
//     `DRAFT.dry-run.<ext>`, and done prints that path;
//   - a dry-run paper is never registered in the global library;
//   - the OFFLINE MODE banner names the workspace;
//   - without --yolo the dry-run loop stops at the first gate it cannot answer
//     (no terminal: exit 3), with nothing registered;
//   - a pre-v1 root-level STATE.json is never moved or read by a dry run;
//   - paths.ts folds `.paper-dry-run/` like `.paper/` (asProjectRoot, hasPaper).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ASSIGNMENT_FIXTURE,
  sandbox,
  runCli,
  seedCompiledPaper,
  type Sandbox,
} from './helpers/paper-cli-harness.js';
import {
  asProjectRoot,
  hasPaper,
  paperDir,
  pensmithGlobalLibraryIndexPath,
  setDryRunWorkspace,
  dryRunWorkspaceActive,
} from '../bin/lib/paths.js';
import { SEED_FILE } from '../bin/lib/dry-run-paper.js';
import { EXIT_APPROVAL, EXIT_USAGE } from '../bin/lib/exit-codes.js';

/** relative path → `sha256 mtimeMs` for every file under `dir` (dirs: 'dir'). */
function fingerprint(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = statSync(p);
      const rel = relative(dir, p);
      if (st.isDirectory()) {
        out.set(rel, 'dir');
        walk(p);
      } else {
        out.set(rel, `${createHash('sha256').update(readFileSync(p)).digest('hex')} ${st.mtimeMs}`);
      }
    }
  };
  walk(dir);
  return out;
}

/** A real paper with research done: STATE.json, INTAKE.md, LIBRARY.json, plus bookkeeping a seed skips. */
function seedRealPaper(sb: Sandbox, root: string): void {
  const r = runCli(sb, root, ['new', '--from', ASSIGNMENT_FIXTURE, '--yolo']);
  assert.equal(r.status, 0, `real new: ${r.stdout}\n${r.stderr}`);
  const p = join(root, '.paper');
  writeFileSync(join(p, 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 2, entries: [] }, null, 2) + '\n');
  writeFileSync(join(p, 'COSTS.jsonl'), '{"usd":0.01}\n');
  writeFileSync(join(p, 'INTAKE.raw.local'), 'the raw assignment\n');
  mkdirSync(join(p, 'export'), { recursive: true });
  writeFileSync(join(p, 'export', 'DRAFT.md'), '# a real deliverable\n');
}

function registryEntries(sb: Sandbox): Array<{ folderPath: string }> {
  const file = pensmithGlobalLibraryIndexPath(process.platform, sb.env());
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { entries: Array<{ folderPath: string }> }).entries;
}

test('GRND-19: a dry run over a real paper seeds .paper-dry-run/ from it, keeps it, and re-seeds after .paper/ changes — .paper/ sha256 and mtime unchanged', () => {
  const sb = sandbox('ws-seed');
  const root = sb.project('p');
  seedRealPaper(sb, root);
  const real = join(root, '.paper');
  const ws = join(root, '.paper-dry-run');
  const before = fingerprint(real);

  // 1. Seed.
  const first = runCli(sb, root, ['--dry-run', 'research', '--yolo']);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.match(first.stderr, /^pensmith: seeded the dry-run workspace .+\.paper-dry-run from .+\.paper \(\d+ files?\); the dry run never writes \.paper\/$/m);
  const banner = first.stderr.indexOf('OFFLINE MODE');
  assert.ok(banner >= 0 && banner < first.stderr.indexOf('seeded the dry-run workspace'), 'the RUN-02 banners come first');
  assert.equal(readFileSync(join(ws, 'INTAKE.md'), 'utf8'), readFileSync(join(real, 'INTAKE.md'), 'utf8'), 'INTAKE.md was copied');
  assert.equal(readFileSync(join(ws, 'config.toml'), 'utf8'), readFileSync(join(real, 'config.toml'), 'utf8'), 'config.toml was copied');
  // Review round 2: a copy keeps its source's mtime, so anything that reads file
  // times sees the paper's order, not the copy order.
  for (const f of ['INTAKE.md', 'config.toml']) {
    assert.ok(Math.abs(statSync(join(ws, f)).mtimeMs - statSync(join(real, f)).mtimeMs) < 2, `${f} keeps its mtime`);
  }
  for (const skipped of ['COSTS.jsonl', 'INTAKE.raw.local', join('export', 'DRAFT.md')]) {
    assert.ok(!existsSync(join(ws, skipped)), `${skipped} is not seeded`);
  }
  assert.ok(existsSync(join(ws, 'DRY-RUN.md')), 'the workspace is marked');
  const seed = JSON.parse(readFileSync(join(ws, SEED_FILE), 'utf8')) as { digest: string; files: Array<{ path: string; sha256: string }>; seededAt: string };
  assert.match(seed.digest, /^[0-9a-f]{64}$/);
  assert.ok(seed.files.some((f) => f.path === 'INTAKE.md'));
  assert.ok(!seed.files.some((f) => f.path === 'COSTS.jsonl' || f.path.startsWith('export/')), 'excluded files are not fingerprinted');
  assert.match(readFileSync(join(ws, 'LIBRARY.json'), 'utf8'), /10\.0000\/pensmith-dryrun\./, 'the dry run researched in its workspace');
  assert.deepEqual(fingerprint(real), before, '.paper/ is byte- and mtime-identical');

  // 2. Keep: .paper/ unchanged → the workspace (and what the dry run did in it) stays.
  writeFileSync(join(ws, 'SENTINEL'), 'kept\n');
  const second = runCli(sb, root, ['--dry-run', 'research', '--yolo']);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.doesNotMatch(second.stderr, /seeded the dry-run workspace/);
  assert.ok(existsSync(join(ws, 'SENTINEL')), 'the workspace was kept');
  assert.equal((JSON.parse(readFileSync(join(ws, SEED_FILE), 'utf8')) as { seededAt: string }).seededAt, seed.seededAt);
  assert.deepEqual(fingerprint(real), before, '.paper/ is byte- and mtime-identical');

  // 3. A read-only real run (status) does not discard the dry run's progress.
  assert.equal(runCli(sb, root, ['status']).status, 0);
  const third = runCli(sb, root, ['--dry-run', 'research', '--yolo']);
  assert.equal(third.status, 0);
  assert.ok(existsSync(join(ws, 'SENTINEL')), 'still kept after a read-only real run');

  // 4. Re-seed: the real paper changed → the workspace starts over from it.
  writeFileSync(join(real, 'NOTES.md'), '# my notes\n');
  const changed = fingerprint(real);
  const fourth = runCli(sb, root, ['--dry-run', 'research', '--yolo']);
  assert.equal(fourth.status, 0, `${fourth.stdout}\n${fourth.stderr}`);
  assert.match(fourth.stderr, /^pensmith: re-seeded the dry-run workspace /m);
  assert.ok(!existsSync(join(ws, 'SENTINEL')), 'the stale workspace was discarded');
  assert.equal(readFileSync(join(ws, 'NOTES.md'), 'utf8'), '# my notes\n', 'the change was copied');
  assert.notEqual((JSON.parse(readFileSync(join(ws, SEED_FILE), 'utf8')) as { digest: string }).digest, seed.digest);
  assert.deepEqual(fingerprint(real), changed, '.paper/ is byte- and mtime-identical');
});

test('GRND-19: done on a seeded compiled paper exports .paper-dry-run/export/DRAFT.dry-run.md and prints that path; .paper/ untouched', () => {
  const sb = sandbox('ws-export');
  const root = sb.project('p');
  seedCompiledPaper(root);
  const before = fingerprint(join(root, '.paper'));
  const r = runCli(sb, root, ['--dry-run', 'done', '--yolo', '--format', 'md']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const exported = join(root, '.paper-dry-run', 'export', 'DRAFT.dry-run.md');
  assert.ok(existsSync(exported), 'the dry-run export is named DRAFT.dry-run.md');
  assert.ok(r.stdout.includes(`pensmith done: exported ${exported}`), `done prints the path: ${r.stdout}`);
  assert.match(r.stdout, /this is a dry-run export \(synthetic sources, stub text\) in .+; the real paper was not touched/);
  assert.equal(readFileSync(exported, 'utf8').includes('OFFLINE MODE'), false, 'the export carries no marker (zero trace)');
  assert.ok(existsSync(join(root, '.paper-dry-run', 'FINAL.md')), 'FINAL.md is written in the workspace');
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'no export in .paper/');
  assert.ok(!existsSync(join(root, '.paper', 'FINAL.md')), 'no FINAL.md in .paper/');
  assert.deepEqual(fingerprint(join(root, '.paper')), before, '.paper/ is byte- and mtime-identical');
});

test('GRND-19: a dry-run paper is never registered in the global library (a real one is)', () => {
  const sb = sandbox('ws-registry');
  const dry = sb.project('dry');
  const made = runCli(sb, dry, ['--dry-run', 'new', '--from', ASSIGNMENT_FIXTURE, '--yolo']);
  assert.equal(made.status, 0, `${made.stdout}\n${made.stderr}`);
  assert.ok(existsSync(join(dry, '.paper-dry-run', 'STATE.json')));
  assert.ok(!registryEntries(sb).some((e) => e.folderPath === dry), 'the dry-run paper is not registered');
  const listed = runCli(sb, sb.project('elsewhere'), ['list']);
  assert.equal(listed.status, 0);
  assert.doesNotMatch(listed.stdout, /\bdry\b/, '`list` does not show it');

  const real = sb.project('real');
  assert.equal(runCli(sb, real, ['new', '--from', ASSIGNMENT_FIXTURE, '--yolo']).status, 0);
  assert.ok(registryEntries(sb).some((e) => e.folderPath === real), 'a real paper is registered (the check is live)');
});

test('GRND-19: the OFFLINE MODE banner names the workspace', () => {
  const sb = sandbox('ws-banner');
  const root = sb.project('p');
  const r = runCli(sb, root, ['--dry-run', 'new', '--from', ASSIGNMENT_FIXTURE, '--yolo']);
  assert.equal(r.status, 0, r.stderr);
  const line = r.stderr.split('\n').find((l) => l.startsWith('OFFLINE MODE (reason: --dry-run)')) ?? '';
  assert.ok(line.includes(`working in ${join(root, '.paper-dry-run')} (the real .paper/ is never written)`), line);
});

test('GRND-19 / D-18-30: without --yolo the dry-run loop stops at the first gate it cannot answer (exit 3), with nothing registered', () => {
  const sb = sandbox('ws-gate');
  // A fresh folder: the loop stops at the first gate (no terminal).
  const fresh = sb.project('fresh');
  writeFileSync(join(fresh, 'assignment.txt'), readFileSync(ASSIGNMENT_FIXTURE, 'utf8'));
  const r = runCli(sb, fresh, ['--dry-run'], { timeoutMs: 120_000 });
  assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: ran .*\(exit 3\); next: /m, 'the step that met the gate is named with exit 3');
  assert.ok(!existsSync(join(fresh, '.paper')), 'no .paper/');
  assert.ok(!existsSync(join(fresh, '.paper-dry-run', 'OUTLINE.md')), 'the loop stopped before the outline');
  assert.deepEqual(registryEntries(sb), [], 'nothing registered');

  // A paper whose research is done: the loop stops at the outline approval.
  const researched = sb.project('researched');
  seedRealPaper(sb, researched);
  const before = fingerprint(join(researched, '.paper'));
  const g = runCli(sb, researched, ['--dry-run'], { timeoutMs: 120_000 });
  assert.equal(g.status, EXIT_APPROVAL, `${g.stdout}\n${g.stderr}`);
  assert.match(g.stderr, /^pensmith: ran outline \(exit 3\); next: outline$/m);
  assert.ok(!existsSync(join(researched, '.paper-dry-run', 'OUTLINE.md')), 'no outline was approved');
  assert.deepEqual(fingerprint(join(researched, '.paper')), before, '.paper/ is byte- and mtime-identical');
});

test('GRND-19: a dry run never moves or reads a pre-v1 root-level STATE.json', () => {
  const sb = sandbox('ws-legacy');
  const root = sb.project('p');
  const legacy = JSON.stringify({ $schemaVersion: 2, paperId: 'legacy-paper', createdAt: '2026-01-01T00:00:00.000Z', sections: [] }) + '\n';
  writeFileSync(join(root, 'STATE.json'), legacy);
  const r = runCli(sb, root, ['--dry-run', 'research', '--yolo']);
  assert.equal(r.status, EXIT_USAGE, `a dry run sees no paper here: ${r.stdout}\n${r.stderr}`);
  assert.equal(readFileSync(join(root, 'STATE.json'), 'utf8'), legacy, 'the legacy file is untouched');
  assert.ok(!existsSync(join(root, '.paper')) && !existsSync(join(root, '.paper-dry-run', 'STATE.json')), 'nothing was moved');
});

test('GRND-19: paths.ts treats .paper-dry-run/ like .paper/ (paperDir, asProjectRoot, hasPaper)', () => {
  const sb = sandbox('ws-paths');
  const root = sb.project('p');
  const saved = dryRunWorkspaceActive();
  try {
    setDryRunWorkspace(false);
    assert.equal(paperDir(root), join(root, '.paper'));
    mkdirSync(join(root, '.paper-dry-run', 'sections', '01-intro'), { recursive: true });
    assert.equal(hasPaper(root), false, 'a normal run never counts a dry-run workspace as a paper');
    assert.equal(asProjectRoot(join(root, '.paper-dry-run', 'sections', '01-intro')), root, 'a path inside the workspace folds to its project');
    assert.equal(asProjectRoot(join(root, '.paper-dry-run')), root);
    assert.equal(hasPaper(join(root, '.paper-dry-run')), false, 'the workspace folder is never a project root');

    setDryRunWorkspace(true);
    assert.equal(paperDir(root), join(root, '.paper-dry-run'));
    assert.equal(hasPaper(root), true, 'a dry run works in an existing workspace');
    const other = sb.project('q');
    mkdirSync(join(other, '.paper'), { recursive: true });
    assert.equal(hasPaper(other), true, 'a dry run can seed from a real .paper/');
    assert.equal(hasPaper(sb.project('empty')), false);
  } finally {
    setDryRunWorkspace(saved ? true : null);
  }
});

test('GRND-19: the library resolves to the workspace in a dry run — libraryPaths and the Tier-1 paper://library resource', async () => {
  const sb = sandbox('ws-library');
  const root = sb.project('p');
  const saved = dryRunWorkspaceActive();
  const { libraryPaths } = await import('../bin/lib/library.js');
  const { registerPaperResources } = await import('../mcp/resources.js');
  try {
    setDryRunWorkspace(true);
    const want = join(root, '.paper-dry-run', 'LIBRARY.json');
    assert.equal(libraryPaths(paperDir(root)).library, want, 'the workspace folder is a paper folder (never .paper-dry-run/.paper-dry-run/)');
    assert.equal(libraryPaths(root).library, want);
    mkdirSync(join(root, '.paper-dry-run'), { recursive: true });
    const at = '2026-01-01T00:00:00.000Z';
    const entry = { citekey: 'dryrun2024', title: 'A synthetic source', authors: ['Doe, J.'], year: 2024, synthetic: true, provenance: ['research'], addedAt: at, updatedAt: at };
    writeFileSync(want, JSON.stringify({ $schemaVersion: 2, entries: [entry] }, null, 2) + '\n');
    // The MCP server's library resource, driven in-process through a capturing server.
    const handlers = new Map<string, (uri: URL) => Promise<{ contents: Array<{ text: string }> }>>();
    const server = {
      registerResource: (name: string, _uri: unknown, _meta: unknown, handler: (uri: URL) => Promise<{ contents: Array<{ text: string }> }>) => {
        handlers.set(name, handler);
      },
    };
    registerPaperResources(server as unknown as Parameters<typeof registerPaperResources>[0], root);
    const read = handlers.get('library');
    assert.ok(read, 'paper://library is registered');
    const res = await read(new URL('paper://library'));
    const lib = JSON.parse(res.contents[0]!.text) as { entries: Array<{ citekey: string }> };
    assert.deepEqual(lib.entries.map((e) => e.citekey), ['dryrun2024'], 'paper://library serves the workspace library');
  } finally {
    setDryRunWorkspace(saved ? true : null);
  }
});

test('GRND-19: `status --dry-run` on a real paper before any dry run seeds the workspace and reports the paper — never "no active paper"; .paper/ untouched', () => {
  const sb = sandbox('ws-status');
  const root = sb.project('p');
  seedRealPaper(sb, root);
  const before = fingerprint(join(root, '.paper'));
  const r = runCli(sb, root, ['status', '--dry-run']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /no active paper/);
  assert.match(r.stderr, /seeded the dry-run workspace .+\.paper-dry-run from .+\.paper/);
  assert.match(r.stdout, /paper: attention mechanisms in transformers/, 'the paper\'s status');
  assert.match(r.stdout, /next: outline/, 'its research is done (LIBRARY.json)');
  assert.ok(existsSync(join(root, '.paper-dry-run', SEED_FILE)), 'the workspace is seeded');
  assert.deepEqual(fingerprint(join(root, '.paper')), before, '.paper/ is byte- and mtime-identical');
});
