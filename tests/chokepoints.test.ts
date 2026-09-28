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
  type ChokepointRow,
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

/** A virtual TypeScript path inside the row's scope and outside its allow list. */
function virtualPathFor(row: ChokepointRow): string {
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
      // The fixture is read from memory at its virtual path; its relative
      // imports resolve against the real tree around that path.
      const virtualAbs = path.join(REPO_ROOT, rel);
      const v = importGraphViolations(row, [rel], {
        read: (f) => (f === virtualAbs ? text : fs.readFileSync(f, 'utf8')),
        exists: (f) => f === virtualAbs || fs.existsSync(f),
      });
      assert.ok(v.length > 0, `the ${row.id} fixture must reach a forbidden module`);
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

test('RUN-29: import-graph walks static, side-effect and dynamic relative imports and reports the chain', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-graph-'));
  const files: Record<string, string> = {
    'a.ts': `import { b } from './b.js';\nexport const a = b;\n`,
    'b.ts': `import './c.js';\nexport const b = 1;\n`,
    'c.ts': `export async function c() { return import('./secret/transport.js'); }\n`,
    'secret/transport.ts': `export const t = 1;\n`,
    'clean.ts': `import type { T } from './types.js';\nexport const x: T | null = null;\n`,
    'types.ts': `export type T = string;\n`,
  };
  const abs = (rel: string): string => path.join(dir, rel);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), text);
  }
  try {
    assert.deepEqual(relativeImports(files['a.ts']!), ['./b.js']);
    const rootRel = toRepoRelative(dir);
    const row: ChokepointRow = {
      id: 'synthetic-graph',
      requirement: 'RUN-29',
      module: 'x',
      description: 'synthetic import-graph row for the harness self-test',
      scope: [`${rootRel}/*.ts`],
      allow: [],
      match: { kind: 'import-graph', pattern: '/secret/transport\\.ts$' },
      fixture: 'tests/fixtures/chokepoints/synthetic-graph.violation.ts.txt',
    };
    const io = { read: (f: string) => fs.readFileSync(f, 'utf8'), exists: (f: string) => fs.existsSync(f) };
    const v = importGraphViolations(row, Object.keys(files).map((f) => `${rootRel}/${f}`), io);
    const entries = [...new Set(v.map((x) => x.entry.slice(rootRel.length + 1)))].sort();
    assert.deepEqual(entries, ['a.ts', 'b.ts', 'c.ts'], 'every module that reaches the target, directly or transitively');
    const fromA = v.find((x) => x.entry.endsWith('/a.ts'))!;
    assert.deepEqual(fromA.chain.map((c) => c.slice(rootRel.length + 1)), ['a.ts', 'b.ts', 'c.ts', 'secret/transport.ts']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
