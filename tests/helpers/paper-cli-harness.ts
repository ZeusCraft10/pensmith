// tests/helpers/paper-cli-harness.ts — shared fixtures for the Phase 17
// paper-cli suites (RUN-09/11/12/13/14/23/28, CONF-04): spawn the BUILT CLI in
// a temp project with an isolated data dir, seed papers, and snapshot a folder
// so a test can prove a refusal changed nothing.
//
// Every spawn gets its own XDG_DATA_HOME / LOCALAPPDATA / HOME under the temp
// root (never the user's real data dir) and a stdin that is NOT a terminal.

import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDraftHash } from '../../bin/lib/draft-hash.js';
import { pensmithDataDir } from '../../bin/lib/paths.js';
import { CURRENT_STATE_VERSION } from '../../bin/lib/schemas/state.js';
import { currentHeadings, headingsSha256 } from '../../bin/lib/compile-inputs.js';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const CLI_BIN = join(REPO, 'dist', 'bin', 'pensmith.js');
export const MCP_BIN = join(REPO, 'dist', 'mcp', 'server.js');
export const ASSIGNMENT_FIXTURE = join(REPO, 'tests', 'fixtures', 'assignment.txt');

/** A realpath'd temp dir (macOS /var → /private/var, so paths compare equal). */
export function tmp(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), `pensmith-${prefix}-`)));
}

export interface Sandbox {
  /** Parent temp dir holding `data/` and any project folders. */
  readonly base: string;
  /** The isolated data dir (XDG_DATA_HOME / LOCALAPPDATA / HOME). */
  readonly data: string;
  /** A project folder inside base (created). */
  project(name: string): string;
  /** Env for a spawned CLI / MCP server: isolated data dir + extras. */
  env(extra?: Record<string, string | undefined>): Record<string, string>;
}

export function sandbox(prefix: string): Sandbox {
  const base = tmp(prefix);
  const data = join(base, 'data');
  mkdirSync(data, { recursive: true });
  return {
    base,
    data,
    project(name: string): string {
      const p = join(base, name);
      mkdirSync(p, { recursive: true });
      return p;
    },
    env(extra: Record<string, string | undefined> = {}): Record<string, string> {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v === undefined) continue;
        // A test's own paper root / prompt mode never leaks into the child.
        if (k === 'PENSMITH_PAPER_ROOT' || k === 'PENSMITH_PROMPT_MODE' || k === 'PENSMITH_DEBUG') continue;
        env[k] = v;
      }
      env['XDG_DATA_HOME'] = data;
      env['LOCALAPPDATA'] = data;
      env['HOME'] = data;
      env['PENSMITH_NO_LLM'] = '1';
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
      return env;
    },
  };
}

/**
 * A path inside the pensmith app-data dir that a child spawned with this
 * sandbox's env resolves: `<data>/pensmith` on Linux (XDG_DATA_HOME) and
 * Windows (LOCALAPPDATA), `<data>/Library/Application Support/pensmith` on
 * macOS (derived from HOME). Never spell `join(sb.data, 'pensmith', …)`: that
 * is the wrong folder on macOS, where a test then fails (or passes vacuously).
 */
export function sandboxDataPath(sb: Sandbox, ...parts: string[]): string {
  return join(pensmithDataDir(process.platform, sb.env()), ...parts);
}

export interface CliRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the built CLI (stdin: `input` when given, else /dev/null — never a TTY). */
export function runCli(
  sb: Sandbox,
  cwd: string,
  args: readonly string[],
  opts: { env?: Record<string, string | undefined>; input?: string; timeoutMs?: number } = {},
): CliRun {
  const spawnOpts: SpawnSyncOptions = {
    cwd,
    env: sb.env(opts.env),
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 60_000,
    stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  };
  if (opts.input !== undefined) spawnOpts.input = opts.input;
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], spawnOpts);
  return { status: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
}

const TSX_LOADER = import.meta.resolve('tsx');

/**
 * Run a TypeScript script from tests/fixtures/paper-cli/ in a child process
 * with the sandbox env (so bin/lib locks and logs land in the sandbox data
 * dir, never the user's). The script prints one JSON line on stdout.
 */
export function runLibScript(
  sb: Sandbox,
  script: string,
  args: readonly string[],
  opts: { cwd?: string; env?: Record<string, string | undefined>; input?: string } = {},
): CliRun {
  const file = join(REPO, 'tests', 'fixtures', 'paper-cli', script);
  const spawnOpts: SpawnSyncOptions = {
    cwd: opts.cwd ?? sb.base,
    env: sb.env(opts.env),
    encoding: 'utf8',
    timeout: 60_000,
    stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  };
  if (opts.input !== undefined) spawnOpts.input = opts.input;
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, file, ...args], spawnOpts);
  return { status: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
}

/** The last JSON line a runLibScript child printed. */
export function lastJson<T>(run: CliRun): T {
  const lines = run.stdout.trim().split('\n').filter((l) => l.startsWith('{') || l.startsWith('['));
  const last = lines[lines.length - 1];
  if (last === undefined) throw new Error(`no JSON on stdout: ${run.stdout}\n${run.stderr}`);
  return JSON.parse(last) as T;
}

/** A Node stack-trace frame — RUN-12: expected failures never print one. */
export const STACK_LINE = /^\s+at .*\.[cm]?[jt]s:\d+/m;

// ---------------------------------------------------------------------------
// Paper fixtures
// ---------------------------------------------------------------------------

/**
 * A current-version STATE.json (v3 since Phase 18), so reading the fixture never
 * runs a migration write-back — a test's "nothing changed" snapshot stays exact.
 */
export function writeState(root: string, sections: Array<{ n: number; slug: string; suffix?: string }>, paperId = 'paper-cli-test'): void {
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'STATE.json'),
    JSON.stringify({ $schemaVersion: CURRENT_STATE_VERSION, paperId, createdAt: '2026-01-01T00:00:00.000Z', sections }, null, 2) + '\n',
  );
}

export function writeOutline(root: string, sections: Array<{ n: number; slug: string; deps?: string[]; sources?: string[] }>): void {
  const rows = sections.map(
    (s) => `| ${s.n} | ${s.slug} | ${s.slug} | ${(s.deps ?? []).join(', ')} | 300 | ${(s.sources ?? []).join(', ')} |`,
  );
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n'),
  );
}

export function sectionDirOf(root: string, n: number, slug: string): string {
  return join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
}

export function writePlan(root: string, n: number, slug: string, fm: Record<string, string> = {}): string {
  const dir = sectionDirOf(root, n, slug);
  mkdirSync(dir, { recursive: true });
  const lines = ['---'];
  const base: Record<string, string> = {
    section: String(n),
    slug,
    title: slug,
    depends_on: '[]',
    assigned_sources: '[]',
    verified_against_draft_hash: 'null',
    status: 'planned',
    ...fm,
  };
  for (const [k, v] of Object.entries(base)) lines.push(`${k}: ${v}`);
  lines.push('---', '', '## Brief', '', `Section ${n}.`, '');
  const p = join(dir, 'PLAN.md');
  writeFileSync(p, lines.join('\n'));
  return p;
}

/** A section whose draft cites a key that is NOT in CITATIONS.bib → Pass 1 FABRICATED. */
export function seedFabricatedSection(root: string, n = 1, slug = 'intro'): void {
  writeState(root, [{ n, slug }]);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@article{real2020, title={A Real Paper}, author={Real, Rita}, year={2020}}\n');
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  writeOutline(root, [{ n, slug }]);
  writePlan(root, n, slug, { status: 'written' });
  writeFileSync(join(sectionDirOf(root, n, slug), 'DRAFT.md'), `# ${slug}\n\nA claim that cites a source nobody wrote [@ghost2099].\n`);
}

/** A verified section with a FRESH hash and no citations (compile + done pass). */
export function seedVerifiedSection(root: string, n: number, slug: string): void {
  const dir = sectionDirOf(root, n, slug);
  mkdirSync(dir, { recursive: true });
  const draft = `# ${slug}\n\nThe verified body of section ${n} with no citations.\n`;
  writeFileSync(join(dir, 'DRAFT.md'), draft);
  const hash = computeDraftHash(Buffer.from(draft, 'utf8'), []);
  writePlan(root, n, slug, { status: 'verified', verified_against_draft_hash: `'${hash}'` });
  writeFileSync(
    join(dir, 'VERIFICATION.md'),
    [`# VERIFICATION (Section ${n}, ${slug})`, '', 'Status: verified', '', '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)', '', ''].join('\n'),
  );
}

/**
 * A clean paper ready for `done`: verified sections + a compiled DRAFT.md with
 * the compile record `done` checks (COMPILE-INPUTS.json v3: the sha256 of the
 * DRAFT.md compile wrote and each section's verified hash — VRFY-27).
 */
export function seedCompiledPaper(root: string): void {
  writeState(root, [{ n: 1, slug: 'one' }, { n: 2, slug: 'two' }]);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeOutline(root, [{ n: 1, slug: 'one' }, { n: 2, slug: 'two' }]);
  seedVerifiedSection(root, 1, 'one');
  seedVerifiedSection(root, 2, 'two');
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nOne.\n\nTwo.\n');
  writeCompileRecord(root, [{ n: 1, slug: 'one' }, { n: 2, slug: 'two' }]);
}

/**
 * The COMPILE-INPUTS.json v3 a compile of `sections` into the current
 * `.paper/DRAFT.md` records (compile-inputs.ts): what `done` checks the
 * compiled draft and each section's verified hash against (VRFY-27).
 */
export function writeCompileRecord(root: string, sections: Array<{ n: number; slug: string }>): void {
  const sha = (p: string): string => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : '');
  const headings = currentHeadings(root);
  const record = {
    $schemaVersion: 3,
    compiled_at: '2026-01-01T00:00:00.000Z',
    compiled_draft_sha256: sha(join(root, '.paper', 'DRAFT.md')),
    // v3 (EXP-05): the title and section titles compile wrote as headings.
    headings_sha256: headingsSha256(headings),
    sections: sections.map((s) => {
      const dir = sectionDirOf(root, s.n, s.slug);
      const hash = /^verified_against_draft_hash:\s*'?([0-9a-f]{64})'?\s*$/m.exec(readFileSync(join(dir, 'PLAN.md'), 'utf8'))?.[1] ?? null;
      return { id: String(s.n), slug: s.slug, draft_sha256: sha(join(dir, 'DRAFT.md')), verification_sha256: sha(join(dir, 'VERIFICATION.md')), verified_against_draft_hash: hash };
    }),
  };
  writeFileSync(join(root, '.paper', 'COMPILE-INPUTS.json'), JSON.stringify(record, null, 2) + '\n');
}

/**
 * The DONE-RECORD.json v1 a done that exported the current `.paper/DRAFT.md`
 * as the current `.paper/FINAL.md` writes (done-record.ts): with it, the
 * router calls the paper complete.
 */
export function writeDoneRecordFile(root: string): void {
  const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
  const record = {
    $schemaVersion: 1,
    done_at: '2026-01-01T00:00:00.000Z',
    compiled_draft_sha256: sha(join(root, '.paper', 'DRAFT.md')),
    final_sha256: sha(join(root, '.paper', 'FINAL.md')),
    humanized: false,
  };
  writeFileSync(join(root, '.paper', 'DONE-RECORD.json'), JSON.stringify(record, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Snapshots — "nothing was changed"
// ---------------------------------------------------------------------------

/** relative path → sha256 for every file under `dir` (dirs recorded as 'dir'). */
export function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const rel = relative(dir, p);
      if (statSync(p).isDirectory()) {
        out.set(rel, 'dir');
        walk(p);
      } else {
        out.set(rel, createHash('sha256').update(readFileSync(p)).digest('hex'));
      }
    }
  };
  walk(dir);
  return out;
}

/** The files that differ between two snapshots (added, removed or changed). */
export function changedPaths(before: Map<string, string>, after: Map<string, string>, ignore: RegExp = /^$/): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => !ignore.test(k) && before.get(k) !== after.get(k)).sort();
}
