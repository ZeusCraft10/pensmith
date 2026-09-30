// tests/chokepoints.test.ts — the chokepoint harness (RUN-29 / D-17-44).
//
// Every chokepoint row in scripts/chokepoints/*.json is:
//   1. valid (id = file name, a REQ-ID, scope/allow globs, known match kinds, a
//      fixture path) and written down in the CLAUDE.md chokepoint table;
//   2. PROVEN to fire: its failing fixture (tests/fixtures/chokepoints/<id>.
//      violation.ts.txt) is linted through ESLint.lintText under a virtual
//      in-scope path and must produce a `pensmith/chokepoint` error for that row
//      (one per matcher) — fixtures are linted here, never by `npm run lint`;
//   3. enforced on the real tree: ESLint runs the rule in `npm run lint`, and
//      this harness re-checks the kinds ESLint cannot fully own — file-regex
//      rows (every in-scope file, whatever its extension, and immune to an
//      inline disable) against their `baseline`, and import-graph rows (the
//      transitive import closure of every in-scope module).
// It also pins the wiring (the rule is on for bin/, mcp/, hooks/, tests/ and
// scripts/) and the matcher semantics the rows rely on (type-only SDK imports,
// the call-argument initializer lookup, globs, the import-graph walk).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import {
  REPO_ROOT,
  MATCH_KINDS,
  loadChokepointRows,
  validateRow,
  matchersOf,
  matchesAny,
  globToRegExp,
  fileRegexMatches,
  importGraphViolations,
  relativeImports,
  toRepoRelative,
  fromRepoRelative,
  type ChokepointRow,
  type ChokepointMatcher,
} from '../scripts/eslint-rules/chokepoint.mjs';

const ROWS = loadChokepointRows();
const eslint = new ESLint({ cwd: REPO_ROOT });
const SOURCE_EXT = /\.(?:[cm]?[jt]s)$/;
const WALK_ROOTS = ['bin', 'mcp', 'hooks', 'tests', 'scripts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && SOURCE_EXT.test(e.name)) out.push(toRepoRelative(full));
  }
  return out;
}
const TREE = WALK_ROOTS.flatMap((d) => (fs.existsSync(path.join(REPO_ROOT, d)) ? walk(path.join(REPO_ROOT, d)) : []));

/**
 * Where the harness reads a row's fixture: the row's `fixturePath`, else a
 * virtual TypeScript path inside the row's scope and outside its allow list.
 */
function virtualPathFor(row: ChokepointRow): string {
  if (row.fixturePath !== undefined) return row.fixturePath;
  for (const glob of row.scope) {
    const rel = glob
      .replace(/\{([^,}]+)[^}]*\}/g, '$1')
      .replace(/\*\*\//g, '__chokepoint_fixture__/')
      .replace(/\*\*/g, '__chokepoint_fixture__')
      .replace(/\*/g, row.id);
    if (!rel.endsWith('.ts')) continue;
    if (globToRegExp(glob).test(rel) && !matchesAny(rel, row.allow)) return rel;
  }
  throw new Error(`row ${row.id}: no .ts scope glob to lint its fixture under`);
}

async function lintAs(text: string, rel: string): Promise<ESLint.LintResult> {
  const [result] = await eslint.lintText(text, { filePath: path.join(REPO_ROOT, rel) });
  assert.ok(result, 'ESLint returned a result');
  const fatal = result.messages.filter((m) => m.fatal);
  assert.deepEqual(fatal.map((m) => m.message), [], `${rel} must parse`);
  return result;
}

function chokepointMessages(result: ESLint.LintResult, id: string): string[] {
  return result.messages.filter((m) => m.ruleId === 'pensmith/chokepoint' && m.message.includes(`"${id}"`)).map((m) => m.message);
}

// ---------------------------------------------------------------------------
// 1. Rows are valid and documented.
// ---------------------------------------------------------------------------

test('RUN-29: every chokepoint row is valid, uniquely named, and has its failing fixture', () => {
  assert.ok(ROWS.length >= 5, `expected the Phase 17 rows, got ${ROWS.map((r) => r.id).join(', ')}`);
  const ids = ROWS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'row ids are unique');
  for (const row of ROWS) {
    assert.deepEqual(validateRow(row, `${row.id}.json`), [], `row ${row.id} is valid`);
    assert.equal(row.fixture, `tests/fixtures/chokepoints/${row.id}.violation.ts.txt`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, row.fixture)), `fixture for ${row.id} exists`);
    for (const m of matchersOf(row)) assert.ok(MATCH_KINDS.includes(m.kind));
  }
  for (const own of ['main-guard', 'no-new-eslint-disable', 'library-writer', 'prompt-loader', 'llm-sdk-types-only']) {
    assert.ok(ids.includes(own), `the ${own} row ships`);
  }
});

test('RUN-29: every row is written down in the CLAUDE.md chokepoint table', () => {
  const claude = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  for (const row of ROWS) {
    assert.ok(claude.includes(`\`${row.id}\``), `CLAUDE.md must list the chokepoint row \`${row.id}\``);
  }
});

test('RUN-29: a malformed row is rejected by the loader validation', () => {
  assert.notDeepEqual(validateRow({ id: 'x', requirement: 'nope', scope: [], match: { kind: 'magic', pattern: '(' } }), []);
  assert.deepEqual(validateRow(ROWS[0], `${ROWS[0]!.id}.json`), []);
  const base = {
    id: 'x',
    requirement: 'PLUG-13',
    module: 'bin/lib/x.ts',
    description: 'a synthetic row for the validation self-test',
    scope: ['mcp/**/*.ts'],
    fixture: 'tests/fixtures/chokepoints/x.violation.ts.txt',
  };
  assert.deepEqual(validateRow({ ...base, match: { kind: 'import-graph', pattern: '.', content: 'console\\.log\\(' } }), []);
  assert.deepEqual(validateRow({ ...base, fixturePath: 'bin/cli/plan.ts', match: { kind: 'member', pattern: '.' } }), []);
  const problems = (row: Record<string, unknown>): string => validateRow({ ...base, ...row }).join('; ');
  assert.match(problems({ match: { kind: 'member', pattern: '.', content: 'x' } }), /content .*import-graph matchers only/);
  assert.match(problems({ match: { kind: 'import-graph', pattern: '.', content: '' } }), /content .*non-empty/);
  assert.match(problems({ match: { kind: 'import-graph', pattern: '.', content: '(' } }), /bad pattern/);
  for (const fixturePath of ['../bin/x.ts', '/abs/x.ts', 'bin/./x.ts', 'bin/x.js', 'bin\\x.ts', 7]) {
    assert.match(problems({ fixturePath, match: { kind: 'member', pattern: '.' } }), /fixturePath/, JSON.stringify(fixturePath));
  }
});

// ---------------------------------------------------------------------------
// 2. Every row's fixture fails.
// ---------------------------------------------------------------------------

for (const row of ROWS) {
  test(`RUN-29: the ${row.id} fixture violates its row (${row.requirement})`, async () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, row.fixture), 'utf8');
    const rel = virtualPathFor(row);
    const kinds = matchersOf(row).map((m) => m.kind);
    if (kinds.every((k) => k === 'import-graph')) {
      // The fixture is read from memory at its path; its relative imports
      // resolve against the real tree around that path. A fixture in scope is
      // itself the entry; one outside it stands in for a real module, and the
      // walk starts from the row's real in-scope modules — so the real graph
      // must reach it.
      const virtualAbs = path.join(REPO_ROOT, rel);
      const inScope = matchesAny(rel, row.scope) && !matchesAny(rel, row.allow);
      const entries = inScope ? [rel] : TREE.filter((f) => matchesAny(f, row.scope) && !matchesAny(f, row.allow));
      assert.ok(entries.length > 0, `row ${row.id} has modules to walk`);
      const v = importGraphViolations(row, entries, {
        read: (f) => (f === virtualAbs ? text : fs.readFileSync(f, 'utf8')),
        exists: (f) => f === virtualAbs || fs.existsSync(f),
      });
      assert.ok(v.length > 0, `the ${row.id} fixture must reach a forbidden module`);
      if (!inScope) {
        assert.ok(v.some((x) => x.reached === rel), `the ${row.id} fixture is reached at ${rel}: ${JSON.stringify(v)}`);
        // …and only because of the fixture: the real module at that path is clean.
        const real = importGraphViolations(row, entries, { read: (f) => fs.readFileSync(f, 'utf8'), exists: (f) => fs.existsSync(f) });
        assert.deepEqual(real.filter((x) => x.reached === rel), [], `the real ${rel} does not violate ${row.id}`);
      }
      return;
    }
    const result = await lintAs(text, rel);
    const msgs = chokepointMessages(result, row.id);
    const eslintMatchers = matchersOf(row).filter((m) => m.kind !== 'import-graph');
    assert.ok(
      msgs.length >= eslintMatchers.length,
      `${row.fixture} linted as ${rel} must raise pensmith/chokepoint for "${row.id}" (once per matcher, ${eslintMatchers.length}); got:\n${result.messages.map((m) => `${m.ruleId}: ${m.message}`).join('\n')}`,
    );
    for (const m of matchersOf(row).filter((x) => x.kind === 'file-regex')) {
      const hits = fileRegexMatches(m, text).length;
      assert.ok(hits > Number(row.baseline?.[rel] ?? 0), `the harness also finds the ${row.id} violation`);
    }
  });
}

test('RUN-29: each library-writer matcher fires on its own (renderer import, direct write via a const path)', async () => {
  const row = ROWS.find((r) => r.id === 'library-writer')!;
  const rel = virtualPathFor(row);
  const importOnly = await lintAs(`import { renderBibtex } from '../lib/bibtex-write.js';\nexport const r = renderBibtex;\n`, rel);
  assert.equal(chokepointMessages(importOnly, 'library-writer').length, 1);
  const helperImport = await lintAs(`import { assignUniqueCitekeys } from '../lib/bibtex-write.js';\nexport const r = assignUniqueCitekeys;\n`, rel);
  assert.equal(chokepointMessages(helperImport, 'library-writer').length, 0, 'the citekey helpers stay importable');
  const write = await lintAs(
    `import { atomicWriteFile } from '../lib/atomic-write.js';\nimport path from 'node:path';\nexport async function f(d: string): Promise<void> {\n  const bibPath = path.join(d, 'CITATIONS.bib');\n  await atomicWriteFile(bibPath, '');\n}\n`,
    rel,
  );
  assert.equal(chokepointMessages(write, 'library-writer').length, 1, 'the identifier is resolved to its initializer');
  const other = await lintAs(
    `import { atomicWriteFile } from '../lib/atomic-write.js';\nexport async function f(p: string): Promise<void> { await atomicWriteFile(p + '/DRAFT.md', ''); }\n`,
    rel,
  );
  assert.equal(chokepointMessages(other, 'library-writer').length, 0, 'other writes are untouched');
});

test('RUN-29: llm-sdk-types-only allows `import type` and flags value imports', async () => {
  const row = ROWS.find((r) => r.id === 'llm-sdk-types-only')!;
  const rel = virtualPathFor(row);
  const typeOnly = await lintAs(`import type Anthropic from '@anthropic-ai/sdk';\nexport type M = Anthropic.Message;\n`, rel);
  assert.equal(chokepointMessages(typeOnly, 'llm-sdk-types-only').length, 0);
  const inline = await lintAs(`import { type ClientOptions } from 'openai';\nexport type O = ClientOptions;\n`, rel);
  assert.equal(chokepointMessages(inline, 'llm-sdk-types-only').length, 0, 'inline type-only specifiers are allowed');
  const value = await lintAs(`import OpenAI from 'openai';\nexport const c = new OpenAI();\n`, rel);
  assert.equal(chokepointMessages(value, 'llm-sdk-types-only').length, 1);
  const dynamic = await lintAs(`export async function f(): Promise<unknown> { return import('@anthropic-ai/sdk'); }\n`, rel);
  assert.equal(chokepointMessages(dynamic, 'llm-sdk-types-only').length, 1, 'a dynamic import is a value import');
});

test('PLUG-02: plugin-assets flags the asset directories as path segments, never the bare words (a references heading)', async () => {
  const row = ROWS.find((r) => r.id === 'plugin-assets')!;
  const rel = virtualPathFor(row);
  const head = `import { readFileSync, readdirSync } from 'node:fs';\nimport path from 'node:path';\n`;
  const count = async (body: string): Promise<number> => chokepointMessages(await lintAs(`${head}${body}\n`, rel), 'plugin-assets').length;
  // Clean: the words as ordinary vocabulary (Phase 20's reference-list headings, prose, a plain argument).
  for (const clean of [
    `export const REFERENCE_LIST_NAMES: ReadonlySet<string> = new Set(['references', 'reference list', 'bibliography', 'templates', 'workflows']);`,
    `export const heading = 'references';`,
    `export const note = 'The references section lists every cited work.';`,
    `export function h(x: string): string { return x; }\nexport const y = h('references');`,
    `export const both = ['templates', 'workflows'].includes('references');`,
    `export const p = (root: string): string => path.join(root, '.paper', 'sections');`,
  ]) {
    assert.equal(await count(clean), 0, `must not fire: ${clean}`);
  }
  // Violations: every way to name an asset directory as a path segment.
  for (const bad of [
    `export const a = (root: string): string => path.join(root, 'references', 'x.md');`,
    `export const b = (root: string): string => path.resolve(root, 'plugin', "templates");`,
    `const dir = 'workflows';\nexport const c = (root: string): string => path.join(root, dir, 'new.md');`,
    `export const d = (root: string): string => readFileSync(\`\${root}/plugin/references/honesty-framing.md\`, 'utf8');`,
    `export const e = (root: string): string => readFileSync(root + '/plugin/templates/presets/disciplines.json', 'utf8');`,
    `export const f = (root: string): string => \`\${root}/templates/prompts/x.md\`;`,
    `export const g = (): string[] => readdirSync('templates');`,
    `export const i = (): string => String(new URL('../workflows/new.md', import.meta.url));`,
    `export const j = (root: string): string => path.join(root, '.claude-plugin', 'plugin.json');`,
  ]) {
    assert.ok((await count(bad)) >= 1, `must fire: ${bad}`);
  }
});

test('PLUG-13: stdout-sink flags each way to reach the process stdout on its own, and none of the harmless ones', async () => {
  const row = ROWS.find((r) => r.id === 'stdout-sink')!;
  const rel = virtualPathFor(row);
  const count = async (body: string): Promise<number> => chokepointMessages(await lintAs(`${body}\n`, rel), 'stdout-sink').length;
  for (const bad of [
    `export const a = (): boolean => process.stdout.write('x');`,
    `export const b = (): void => console.log('x');`,
    `export const c = (): void => globalThis.console.info('x');`,
    `export const d = (): boolean => globalThis.process.stdout.write('x');`,
    `import { stdout } from 'node:process';\nexport const e = (): boolean => stdout.write('x');`,
    `import { stdout as out } from 'process';\nexport const f = (): boolean => out.write('x');`,
    `export function g(): void { const { stdout: s } = process; s.write('x'); }`,
    `export function h(): void { const { stdout } = globalThis.process; stdout.write('x'); }`,
    `export const i = (ok: boolean): boolean => (ok ? process.stdout : process.stderr).write('x');`,
    // Review round 2: every console method that prints to stdout, and process
    // or console itself under another name.
    `export const j = (): number => { console.count('x'); return 0; };`,
    `export const k = (): void => console.countReset('x');`,
    `export const l = (): void => console.group('x');`,
    `export const m = (): void => console.groupCollapsed('x');`,
    `export const n = (): void => console.timeLog('t', 'x');`,
    `export const o = (): void => console.timeEnd('t');`,
    `export const p = (): void => console.dirxml('x');`,
    `export const q = (): void => console['count']('x');`,
    `export const r = (): void => globalThis.console.group('x');`,
    `export function s(): void { const p = process; p.stdout.write('x'); }`,
    `export function t(): void { const p = globalThis.process; p.stdout.write('x'); }`,
    `export function u(): void { const c = console; c.log('x'); }`,
    `export const v = (w: (io: NodeJS.Process) => void): void => w(process);`,
    `export const x = { io: process };`,
    `export const y = (): NodeJS.Process => process;`,
    `export function z(): Console { return console; }`,
    `export function aa(): void { const { log } = console; log('x'); }`,
    `export function ab(): void { const { ...all } = process; all.stdout.write('x'); }`,
  ]) {
    assert.ok((await count(bad)) >= 1, `must fire: ${bad}`);
  }
  for (const clean of [
    `export const tty = process.stdout.isTTY === true;`,
    `export const cols = process.stdout.columns;`,
    `import { env } from 'node:process';\nexport const home = env['HOME'];`,
    `export function e(): void { const { stderr } = process; stderr.write('x'); }`,
    `export function f(): void { const { stdout } = { stdout: 'text' }; void stdout; }`,
    `export const g = (): void => console.error('x');`,
    `export const h = (): void => { console.warn('x'); console.trace('x'); console.assert(true, 'x'); };`,
    `export const i = process.env['HOME'];`,
    `export const j = typeof process === 'undefined';`,
    `export const k = (): void => process.on('exit', () => undefined);`,
    `export const l = globalThis.process?.platform;`,
    `export const subprocess = 1; export const processed = subprocess;`,
    `// a comment about the process (and console) is not code`,
  ]) {
    assert.equal(await count(clean), 0, `must not fire: ${clean}`);
  }
});

test('PLUG-13: the mcp-stdout-graph content regex finds each stdout form in a reached module, and none of the harmless ones', () => {
  const row = ROWS.find((r) => r.id === 'mcp-stdout-graph')!;
  const re = new RegExp(matchersOf(row)[0]!.content!);
  for (const bad of [
    `process.stdout.write('x')`,
    `(ok ? process.stdout : process.stderr).write('x')`,
    `console.log('x')`,
    `globalThis.console.log('x')`,
    `import { stdout } from 'node:process';`,
    `import { env, stdout as out } from "process";`,
    `const { stdout: s } = process;`,
    `const { stdout } = globalThis.process;`,
    `console.count('x')`,
    `console.group('x')`,
    `console.groupCollapsed('x')`,
    `console.timeLog('t', 'x')`,
    `console.timeEnd('t')`,
    `console.dirxml('x')`,
    `console['count']('x')`,
    `const p = process;`,
    `const p = globalThis.process;`,
    `const c = console;`,
    `f(process)`,
    `f(a, console)`,
    `({ io: process })`,
    `return process;`,
    `const { log } = console;`,
    `const { env, ...rest } = process;`,
  ]) {
    assert.ok(re.test(bad), `must match: ${bad}`);
  }
  for (const clean of [
    `process.stdout.isTTY`,
    `import { env } from 'node:process';`,
    `const { stderr } = process;`,
    `const { stdout } = process.env;`,
    `console.error('x')`,
    `console.warn('x'); console.trace('x'); console.assert(true);`,
    `const home = process.env['HOME'];`,
    `process.on('exit', f)`,
    `typeof process === 'undefined'`,
    `globalThis.process?.platform`,
  ]) {
    assert.equal(re.test(clean), false, `must not match: ${clean}`);
  }
});

test('RUN-29: a call matcher\'s arg.index is a position or "any"', () => {
  const base = {
    id: 'x',
    requirement: 'PLUG-02',
    module: 'bin/lib/x.ts',
    description: 'a synthetic row for the validation self-test',
    scope: ['bin/**/*.ts'],
    fixture: 'tests/fixtures/chokepoints/x.violation.ts.txt',
  };
  assert.deepEqual(validateRow({ ...base, match: { kind: 'call', pattern: '^join$', arg: { index: 'any', pattern: 'x' } } }), []);
  assert.deepEqual(validateRow({ ...base, match: { kind: 'call', pattern: '^join$', arg: { index: 2, pattern: 'x' } } }), []);
  assert.deepEqual(validateRow({ ...base, match: { kind: 'call', pattern: '^join$', arg: { pattern: 'x' } } }), []);
  for (const index of [-1, 1.5, 'all', null]) {
    assert.match(validateRow({ ...base, match: { kind: 'call', pattern: '^join$', arg: { index, pattern: 'x' } } }).join('; '), /arg\.index/, JSON.stringify(index));
  }
  assert.match(validateRow({ ...base, match: { kind: 'member', pattern: '.', arg: { pattern: 'x' } } }).join('; '), /call matchers only/);
});

test('RUN-29: allow globs exempt the owning module', async () => {
  const mainGuard = await lintAs(
    `export function isMainModule(u: string): boolean { return u === process.argv[1]; }\n`,
    'bin/lib/main-guard.ts',
  );
  assert.equal(chokepointMessages(mainGuard, 'main-guard').length, 0);
  const elsewhere = await lintAs(`export const entry = process.argv[1];\n`, 'hooks/some-hook.ts');
  assert.equal(chokepointMessages(elsewhere, 'main-guard').length, 1);
});

// ---------------------------------------------------------------------------
// 3. The real tree.
// ---------------------------------------------------------------------------

test('RUN-29: the rule is wired for bin/, mcp/, hooks/, tests/ and scripts/', async () => {
  for (const rel of ['bin/lib/library.ts', 'mcp/server.ts', 'hooks/stop.ts', 'tests/lock.test.ts', 'scripts/run-tests.mjs']) {
    const cfg = (await eslint.calculateConfigForFile(path.join(REPO_ROOT, rel))) as { rules?: Record<string, unknown> };
    const setting = cfg.rules?.['pensmith/chokepoint'];
    const level = Array.isArray(setting) ? setting[0] : setting;
    assert.ok(level === 2 || level === 'error', `pensmith/chokepoint must be an error for ${rel} (got ${JSON.stringify(setting)})`);
  }
  assert.ok(await eslint.isPathIgnored(path.join(REPO_ROOT, 'tests', 'fixtures', 'chokepoints', 'x.ts')), 'fixtures are ignored by project lint');
});

test('RUN-29: file-regex rows hold on every in-scope file (baselines are maxima)', () => {
  const offenders: string[] = [];
  for (const row of ROWS) {
    for (const m of matchersOf(row).filter((x) => x.kind === 'file-regex')) {
      for (const rel of TREE) {
        if (!matchesAny(rel, row.scope) || matchesAny(rel, row.allow)) continue;
        const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        const hits = fileRegexMatches(m, text);
        const allowed = Number(row.baseline?.[rel] ?? 0);
        if (hits.length > allowed) offenders.push(`${row.id}: ${rel} has ${hits.length} match(es), allowed ${allowed}: ${hits.map((h) => JSON.stringify(h.text)).join(', ')}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('RUN-29: no-new-eslint-disable — the baseline is exactly the tree (each entry equals its file\'s count), and only shrinks', () => {
  const row = ROWS.find((r) => r.id === 'no-new-eslint-disable')!;
  const m = matchersOf(row).find((x) => x.kind === 'file-regex')!;
  let treeTotal = 0;
  for (const rel of TREE) {
    if (!matchesAny(rel, row.scope) || matchesAny(rel, row.allow)) continue;
    treeTotal += fileRegexMatches(m, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')).length;
  }
  for (const [rel, allowed] of Object.entries(row.baseline ?? {})) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `baseline entry ${rel} exists`);
    assert.ok(matchesAny(rel, row.scope), `baseline entry ${rel} is in scope`);
    const actual = fileRegexMatches(m, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')).length;
    // A stale entry would let a NEW directive into that file unnoticed.
    assert.equal(actual, Number(allowed), `baseline entry ${rel} (${String(allowed)}) must equal the file's directive count (${actual})`);
  }
  const total = Object.values(row.baseline ?? {}).reduce((a, b) => a + Number(b), 0);
  assert.equal(total, treeTotal, 'the baseline total equals the directives in the tree');
  assert.ok(total <= 12, 'the baseline may only shrink (12 directives remain from before RUN-29)');
});

test('RUN-29: import-graph rows hold on the real tree', () => {
  const io = { read: (f: string) => fs.readFileSync(f, 'utf8'), exists: (f: string) => fs.existsSync(f) };
  for (const row of ROWS.filter((r) => matchersOf(r).some((m) => m.kind === 'import-graph'))) {
    assert.deepEqual(importGraphViolations(row, TREE, io), [], `row ${row.id}`);
  }
});

test('RUN-10: no module other than bin/lib/main-guard.ts compares with pathToFileURL(process.argv[1])', () => {
  const hits = TREE.filter((rel) => /^(bin|mcp|hooks)\//.test(rel)).filter((rel) =>
    /pathToFileURL\(\s*process\.argv\[1\]/.test(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')),
  );
  assert.deepEqual(hits.filter((h) => h !== 'bin/lib/main-guard.ts'), []);
});

// ---------------------------------------------------------------------------
// 4. Harness semantics.
// ---------------------------------------------------------------------------

test('D-07 / D-41: the doctor-probe no-restricted-syntax overrides keep the project-wide selectors (flat config last-match-wins)', async () => {
  // A doctor probe that writes a file directly, reads the home dir or a data-dir
  // variable and carries a DOI regex: all four project-wide selectors must fire
  // under BOTH doctor-probe override blocks (the generic one and the
  // runtime-config-presence one), exactly as they do elsewhere in bin/lib.
  const violating = [
    "import os from 'node:os';",
    "import * as fs from 'node:fs';",
    'export async function probe(): Promise<unknown> {',
    "  await fs.promises.writeFile('x', '');",
    '  const DOI = /^10\\./;',
    '  return [os.homedir(), process.env.XDG_DATA_HOME, DOI];',
    '}',
    '',
  ].join('\n');
  for (const rel of ['bin/lib/zz-not-a-probe.ts', 'bin/lib/doctor/probes/zz-probe.ts', 'bin/lib/doctor/probes/runtime-config-presence.ts']) {
    const result = await lintAs(violating, rel);
    const hits = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
    assert.equal(hits.length, 4, `${rel}: writeFile, the DOI regex, os.homedir() and XDG_DATA_HOME are all flagged:\n${hits.join('\n')}`);
  }
});

test('RUN-29: globs — ** spans directories, * stays in a segment, {a,b} alternates, a trailing / covers a tree', () => {
  assert.ok(globToRegExp('bin/**/*.ts').test('bin/pensmith.ts'));
  assert.ok(globToRegExp('bin/**/*.ts').test('bin/lib/verify/pass1.ts'));
  assert.ok(!globToRegExp('bin/*.ts').test('bin/lib/x.ts'));
  assert.ok(globToRegExp('tests/**/*.{ts,mjs}').test('tests/helpers/x.mjs'));
  assert.ok(!globToRegExp('tests/**/*.{ts,mjs}').test('tests/helpers/x.cjs'));
  assert.ok(globToRegExp('tests/helpers/local-servers/').test('tests/helpers/local-servers/mock-llm.ts'));
  assert.ok(globToRegExp('tests/helpers/local-servers/**').test('tests/helpers/local-servers/a/b.ts'));
  assert.ok(!globToRegExp('bin/lib/library.ts').test('bin/lib/library.tsx'));
});

/** The synthetic tree the import-graph self-tests walk ('/'-separated, relative to its root). */
const GRAPH_FILES: Readonly<Record<string, string>> = {
  'a.ts': `import { b } from './b.js';\nexport const a = b;\n`,
  'b.ts': `import './c.js';\nexport const b = 1;\n`,
  'c.ts': `export async function c() { return import('./secret/transport.js'); }\n`,
  'secret/transport.ts': `export const t = 1;\n`,
  'clean.ts': `import type { T } from './types.js';\nexport const x: T | null = null;\n`,
  'types.ts': `export type T = string;\n`,
};

/** A synthetic import-graph row whose scope is every top-level module under `rootRel`. */
function graphRow(rootRel: string): ChokepointRow {
  return {
    id: 'synthetic-graph',
    requirement: 'RUN-29',
    module: 'x',
    description: 'synthetic import-graph row for the harness self-test',
    scope: [`${rootRel}/*.ts`],
    allow: [],
    match: { kind: 'import-graph', pattern: '/secret/transport\\.ts$' },
    fixture: 'tests/fixtures/chokepoints/synthetic-graph.violation.ts.txt',
  };
}

/**
 * The walk's findings for the tree whose entries are spelled under `entryRoot`:
 * which entries reach the target, and a's chain. Reached modules and chains are
 * reported in toRepoRelative() form, `reportRoot` (= entryRoot unless the
 * entries are spelled absolute on a platform where the tree has a relative form).
 */
function graphFindings(
  entryRoot: string,
  io: Parameters<typeof importGraphViolations>[2],
  reportRoot: string = entryRoot,
): { entries: string[]; chainFromA: string[] | undefined } {
  const v = importGraphViolations(graphRow(entryRoot), Object.keys(GRAPH_FILES).map((f) => `${entryRoot}/${f}`), io);
  assert.ok(v.every((x) => x.reached === `${reportRoot}/secret/transport.ts`), `every chain ends at the target: ${JSON.stringify(v)}`);
  return {
    entries: [...new Set(v.map((x) => x.entry.slice(entryRoot.length + 1)))].sort(),
    chainFromA: v.find((x) => x.entry === `${entryRoot}/a.ts`)?.chain.map((c) => c.slice(reportRoot.length + 1)),
  };
}

test('RUN-29: import-graph walks static, side-effect and dynamic relative imports and reports the chain', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-graph-'));
  const abs = (rel: string): string => path.join(dir, ...rel.split('/'));
  for (const [rel, text] of Object.entries(GRAPH_FILES)) {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), text);
  }
  try {
    assert.deepEqual(relativeImports(GRAPH_FILES['a.ts']!), ['./b.js']);
    const io = { read: (f: string) => fs.readFileSync(f, 'utf8'), exists: (f: string) => fs.existsSync(f) };
    // The temp dir's repo-relative form: `../../tmp/…` on one drive, but an
    // ABSOLUTE `C:/Users/…/Temp/…` on a Windows runner whose checkout is on D:.
    const rootRel = toRepoRelative(dir);
    const found = graphFindings(rootRel, io);
    assert.deepEqual(found.entries, ['a.ts', 'b.ts', 'c.ts'], 'every module that reaches the target, directly or transitively');
    assert.deepEqual(found.chainFromA, ['a.ts', 'b.ts', 'c.ts', 'secret/transport.ts']);

    // An absolute entry (what toRepoRelative returns for another drive) is
    // walked from that file itself, not from `<repo>/<absolute path>` — the
    // same tree through this platform's absolute spelling.
    const absolute = graphFindings(dir.split(path.sep).join('/'), io, rootRel);
    assert.deepEqual(absolute, found, 'an absolute entry is walked exactly like a repo-relative one');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** The synthetic tree the import-graph `content` self-test walks: an MCP-like server reaching verbs. */
const CONTENT_FILES: Readonly<Record<string, string>> = {
  'mcp/server.ts': `import { tools } from './tools.js';\nexport const s = tools;\n`,
  'mcp/tools.ts': `import { sink } from '../lib/output-sink.js';\nexport async function tools() {\n  await import('../cli/plan.js');\n  return sink;\n}\n`,
  'mcp/noisy.ts': `export function hi() { console.log('hi'); }\n`,
  'mcp/commented.ts': `// never console.log here, and never write to process.stdout.isTTY-less streams\nexport const quiet = process.stdout.isTTY;\n`,
  'lib/output-sink.ts': `export function sink(t: string) { process.stdout.write(t); }\n`,
  'cli/plan.ts': `import { deeper } from './deeper.js';\nexport function plan() { (1 > 0 ? process.stdout : process.stderr).write('pensmith plan: wrote PLAN.md\\n'); return deeper; }\n`,
  'cli/deeper.ts': `export const deeper = () => console.info('deeper');\n`,
  'cli/clean.ts': `import { sink } from '../lib/output-sink.js';\nexport const c = () => sink('ok');\n`,
  'mcp/typed.ts': `import type { W } from '../cli/worker.js';\nexport type { V } from '../cli/worker.js';\nexport const t: W | null = null;\n`,
  'cli/worker.ts': `export type W = number;\nexport type V = string;\nconsole.log('worker thread noise');\n`,
};

test('PLUG-13: import-graph `content` — a reached module violates only when its path AND text match; the walk goes on through it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-graph-content-'));
  const abs = (rel: string): string => path.join(dir, ...rel.split('/'));
  for (const [rel, text] of Object.entries(CONTENT_FILES)) {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), text);
  }
  try {
    const rootRel = toRepoRelative(dir);
    const row = ROWS.find((r) => r.id === 'mcp-stdout-graph')!;
    const matcher = matchersOf(row)[0]!;
    // The real row's matcher, re-rooted on the synthetic tree (its path pattern is repo-relative).
    const synthetic: ChokepointRow = {
      ...row,
      id: 'synthetic-content',
      scope: [`${rootRel}/mcp/*.ts`],
      allow: [],
      match: { ...matcher, pattern: `^(?!${rootRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/lib/output-sink\\.ts$)` },
    };
    const io = { read: (f: string) => fs.readFileSync(f, 'utf8'), exists: (f: string) => fs.existsSync(f) };
    const entries = Object.keys(CONTENT_FILES).map((f) => `${rootRel}/${f}`);
    const v = importGraphViolations(synthetic, entries, io);
    const short = (x: string): string => x.slice(rootRel.length + 1);
    const found = v.map((x) => `${short(x.entry)} -> ${short(x.reached)} via ${x.chain.map(short).join(' > ')}`).sort();
    assert.deepEqual(found, [
      'mcp/noisy.ts -> mcp/noisy.ts via mcp/noisy.ts',
      'mcp/server.ts -> cli/deeper.ts via mcp/server.ts > mcp/tools.ts > cli/plan.ts > cli/deeper.ts',
      'mcp/server.ts -> cli/plan.ts via mcp/server.ts > mcp/tools.ts > cli/plan.ts',
      'mcp/tools.ts -> cli/deeper.ts via mcp/tools.ts > cli/plan.ts > cli/deeper.ts',
      'mcp/tools.ts -> cli/plan.ts via mcp/tools.ts > cli/plan.ts',
    ], 'the entry itself counts; the sink module, comments, isTTY reads, type-only imports and unreached modules do not; the walk continues through a violating module');
    // Without typeImports: "allow", a type-only import is an edge like any other.
    const { pattern, content } = synthetic.match as ChokepointMatcher;
    const strict: ChokepointRow = { ...synthetic, match: { kind: 'import-graph', pattern, ...(content !== undefined ? { content } : {}) } };
    const typed = importGraphViolations(strict, [`${rootRel}/mcp/typed.ts`], io).map((x) => short(x.reached));
    assert.deepEqual(typed, ['cli/worker.ts'], 'a type-only edge is followed unless the matcher allows type imports');
    assert.deepEqual(relativeImports(CONTENT_FILES['mcp/typed.ts']!, { skipTypeOnly: true }), []);
    assert.deepEqual(
      relativeImports(`import type from './default-named-type.js';\nimport { type A } from './inline.js';\nimport type * as N from './ns.js';\n`, { skipTypeOnly: true }),
      ['./default-named-type.js', './inline.js'],
      'a default import named `type` and an inline type specifier still load the module',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PLUG-13: the mcp-stdout-graph walk really reaches the verbs the MCP tools run (the row is not vacuous)', () => {
  const row = ROWS.find((r) => r.id === 'mcp-stdout-graph')!;
  // Same walk, but every module counts as a hit for its path: which modules does mcp/ reach?
  const reach: ChokepointRow = { ...row, match: { kind: 'import-graph', pattern: '^bin/(?:cli/(?:plan|write|verify|status)|lib/output-sink)\\.ts$' } };
  const io = { read: (f: string) => fs.readFileSync(f, 'utf8'), exists: (f: string) => fs.existsSync(f) };
  const reached = new Set(importGraphViolations(reach, TREE, io).map((x) => x.reached));
  assert.deepEqual([...reached].sort(), ['bin/cli/plan.ts', 'bin/cli/status.ts', 'bin/cli/verify.ts', 'bin/cli/write.ts', 'bin/lib/output-sink.ts']);
});

test('RUN-29: import-graph walks a tree on another Windows drive (temp dir on C:, checkout on D:)', () => {
  // The windows-latest CI layout, walked with win32 path semantics on any host:
  // the checkout is D:\a\pensmith\pensmith and os.tmpdir() is the 8.3-named
  // C:\Users\RUNNER~1\AppData\Local\Temp, so every entry is an absolute
  // `C:/…` path. Joining it under the repo root found nothing (CI run 62).
  const W = path.win32;
  const repo = 'D:\\a\\pensmith\\pensmith';
  const dir = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\pensmith-graph-AbC123';
  const disk = new Map(Object.entries(GRAPH_FILES).map(([rel, text]) => [W.join(dir, ...rel.split('/')), text]));
  const io = {
    read: (f: string): string => {
      const text = disk.get(f);
      if (text === undefined) throw Object.assign(new Error(`ENOENT: ${f}`), { code: 'ENOENT' });
      return text;
    },
    exists: (f: string): boolean => disk.has(f),
    root: repo,
    path: W,
  };
  const rootRel = toRepoRelative(dir, repo, W);
  assert.equal(rootRel, 'C:/Users/RUNNER~1/AppData/Local/Temp/pensmith-graph-AbC123', 'another drive has no relative form');
  const found = graphFindings(rootRel, io);
  assert.deepEqual(found.entries, ['a.ts', 'b.ts', 'c.ts'], 'every module that reaches the target, directly or transitively');
  assert.deepEqual(found.chainFromA, ['a.ts', 'b.ts', 'c.ts', 'secret/transport.ts']);
  // …and a tree inside the checkout keeps its repo-relative spelling.
  const inRepo = W.join(repo, 'tests', 'graph');
  const inRepoDisk = new Map([...disk].map(([f, text]) => [W.join(inRepo, W.relative(dir, f)), text]));
  const inRepoFound = graphFindings('tests/graph', { ...io, read: (f) => inRepoDisk.get(f) ?? '', exists: (f) => inRepoDisk.has(f) });
  assert.deepEqual(inRepoFound, found);
});

test('RUN-29: repo-relative paths round-trip on win32, including a file on another drive', () => {
  const repo = 'D:\\a\\pensmith\\pensmith';
  const sameDrive = 'D:\\a\\pensmith\\pensmith\\bin\\lib\\http.ts';
  const otherDrive = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\pensmith-graph-AbC123\\a.ts';
  assert.equal(toRepoRelative(sameDrive, repo, path.win32), 'bin/lib/http.ts');
  assert.equal(toRepoRelative(otherDrive, repo, path.win32), 'C:/Users/RUNNER~1/AppData/Local/Temp/pensmith-graph-AbC123/a.ts');
  for (const file of [sameDrive, otherDrive]) {
    assert.equal(fromRepoRelative(toRepoRelative(file, repo, path.win32), repo, path.win32), file, `${file} round-trips`);
  }
  // And on this platform, for the real repo root.
  const here = path.join(REPO_ROOT, 'bin', 'lib', 'http.ts');
  assert.equal(fromRepoRelative(toRepoRelative(here)), here);
  const outside = path.join(os.tmpdir(), 'pensmith-graph-x', 'a.ts');
  assert.equal(fromRepoRelative(toRepoRelative(outside)), path.resolve(outside));
});
