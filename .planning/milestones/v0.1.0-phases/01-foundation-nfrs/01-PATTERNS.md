# Phase 1: Foundation NFRs - Pattern Map

**Mapped:** 2026-05-08
**Files analyzed:** 38 (19 source/config + 15 test + 4 fixture/reference)
**Analogs found:** 38 / 38 (all from Phase 0 codebase; 0 require external lookup)

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `bin/lib/paths.ts` | utility | transform (pure) | `eslint.config.js` chokepoint pattern + `package.json` engines field | partial — no role analog exists yet; pattern is "pure-function module with chokepoint exemption" |
| `bin/lib/atomic-write.ts` | utility | file-I/O | `scripts/run-tests.mjs` (fs.readdir, spawn pattern) | partial — same `node:fs/promises` idiom |
| `bin/lib/lock.ts` | utility | file-I/O | `scripts/run-tests.mjs` (spawn) + `tests/lock.test.ts` (child_process pattern) | partial |
| `bin/lib/doi.ts` | utility | transform (pure) | `eslint.config.js` D-07 exemption block | exact role match (chokepoint-exempted pure module) |
| `bin/lib/http.ts` | utility | request-response | `eslint.config.js` D-06 exemption block | exact role match (chokepoint-exempted I/O module) |
| `bin/lib/budget.ts` | utility | CRUD + transform | `tests/repo-files.test.ts` (fs.appendFile pattern) | partial |
| `bin/lib/migrations/loader.ts` | utility | transform | `bin/lib/migrations/README.md` (contract doc) | partial — README is the only existing analog in that dir |
| `bin/lib/pii.ts` | utility | transform (pure) | `bin/lib/doi.ts` analog (pure-function chokepoint module) | role-match |
| `bin/lib/session-log.ts` | utility | file-I/O + event-driven | `scripts/run-tests.mjs` (spawn + stdio inherit) | partial |
| `bin/lib/state.ts` | utility | CRUD | `tests/repo-files.test.ts` (JSON read/write pattern) | partial |
| `bin/lib/library.ts` | utility | CRUD | `tests/manifest.test.ts` (JSON read + structural assertion) | partial |
| `bin/lib/checkpoint.ts` | utility | CRUD + file-I/O | `tests/repo-files.test.ts` (JSON read/write pattern) | partial |
| `bin/lib/runtime.ts` | utility | request-response | `mcp/server.ts` (ESM module stub) | partial |
| `bin/lib/runtime/pricing.ts` | utility | transform (pure lookup) | none — first lookup table in codebase | no analog |
| `bin/lib/schemas/state.ts` | config / schema | transform | `package.json` (structured data with version field) | partial |
| `bin/lib/schemas/library.ts` | config / schema | transform | same | partial |
| `bin/lib/schemas/checkpoint.ts` | config / schema | transform | same | partial |
| `bin/lib/schemas/session-log.ts` | config / schema | transform | same | partial |
| `bin/lib/schemas/runtime-config.ts` | config / schema | transform | same | partial |
| `tests/paths.test.ts` | test | transform | `tests/repo-files.test.ts` | exact |
| `tests/atomic-write.test.ts` | test | file-I/O | `tests/repo-files.test.ts` | exact |
| `tests/lock.test.ts` | test | file-I/O + spawn | `tests/manifest.test.ts` (execFileSync) | role-match |
| `tests/doi.test.ts` | test | transform + property | `tests/lint-chokepoint.test.ts` (programmatic assert pattern) | role-match |
| `tests/http.test.ts` | test | request-response + cassette | `tests/lint-chokepoint.test.ts` (ESLint programmatic) | partial |
| `tests/budget.test.ts` | test | CRUD | `tests/repo-files.test.ts` | exact |
| `tests/migrations.test.ts` | test | transform | `tests/repo-files.test.ts` | exact |
| `tests/pii.test.ts` | test | transform | `tests/repo-files.test.ts` | exact |
| `tests/session-log.test.ts` | test | file-I/O | `tests/repo-files.test.ts` | exact |
| `tests/state.test.ts` | test | CRUD | `tests/repo-files.test.ts` | exact |
| `tests/library.test.ts` | test | CRUD | `tests/repo-files.test.ts` | exact |
| `tests/checkpoint.test.ts` | test | CRUD | `tests/repo-files.test.ts` | exact |
| `tests/runtime.test.ts` | test | request-response | `tests/manifest.test.ts` (structural assertion) | role-match |
| `tests/lint-atomic-write-chokepoint.test.ts` | test | lint/red-team | `tests/lint-chokepoint.test.ts` | **exact** |
| `tests/lint-paths-chokepoint.test.ts` | test | lint/red-team | `tests/lint-chokepoint.test.ts` | **exact** |
| `tests/fixtures/doi-corpus.ts` | fixture | transform | `tests/fixtures/lint-chokepoint-fixture.ts` | role-match |
| `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts` | fixture | lint/red-team | `tests/fixtures/lint-chokepoint-fixture.ts` | **exact** |
| `tests/fixtures/lint-paths-chokepoint-fixture.ts` | fixture | lint/red-team | `tests/fixtures/lint-chokepoint-fixture.ts` | **exact** |
| `references/http-warnings.md` | reference | — | `bin/lib/migrations/README.md` (locked prose artifact) | role-match |
| `eslint.config.js` (MODIFY) | config | lint | `eslint.config.js` (itself) | **exact** |
| `package.json` (MODIFY) | config | — | `package.json` (itself) | **exact** |
| `.github/workflows/ci.yml` (MODIFY) | config | CI | `.github/workflows/ci.yml` (itself) | **exact** |

---

## Pattern Assignments

### `eslint.config.js` (MODIFY — add two chokepoint rules)

**Analog:** `eslint.config.js` (itself — copy the existing D-06 and D-07 blocks exactly)

**Current file:** `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\eslint.config.js`

**Existing HTTP chokepoint block to copy as template** (lines 38–66):
```javascript
// === D-06: HTTP chokepoint — applies EVERYWHERE by default ===
'no-restricted-imports': ['error', {
  paths: [
    { name: 'undici',     message: 'Import HTTP only via bin/lib/http.ts' },
    { name: 'http',       message: 'Import HTTP only via bin/lib/http.ts' },
    { name: 'node:http',  message: 'Import HTTP only via bin/lib/http.ts' },
    { name: 'https',      message: 'Import HTTP only via bin/lib/http.ts' },
    { name: 'node:https', message: 'Import HTTP only via bin/lib/http.ts' },
  ],
}],

// === D-07: DOI regex chokepoint ===
'no-restricted-syntax': ['error', {
  selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]',
  message: 'DOI regex /^10\\./ is a chokepoint — use bin/lib/doi.ts only',
}],
```

**Existing exemption block to copy as template** (lines 62–72):
```javascript
// === HTTP chokepoint EXEMPTION for bin/lib/http.ts (lands Phase 1) ===
{
  files: ['bin/lib/http.ts'],
  rules: { 'no-restricted-imports': 'off' },
},
// === DOI chokepoint EXEMPTION for bin/lib/doi.ts (lands Phase 1) ===
{
  files: ['bin/lib/doi.ts'],
  rules: { 'no-restricted-syntax': 'off' },
},
```

**Existing global-ignores block to copy as template** (lines 74–80):
```javascript
// === Red-team fixture exemption (D-08) ===
{
  ignores: ['tests/fixtures/lint-chokepoint-fixture.ts', 'dist/**', 'node_modules/**'],
},
```

**New rules to ADD (D-07 atomic-write chokepoint, D-41 paths chokepoint):**

D-07 atomic-write chokepoint — add to the main `rules` object alongside existing `no-restricted-syntax`:
```javascript
// === D-07 (Phase 1): atomic-write chokepoint ===
// Bans direct fs.writeFile / fs.promises.writeFile outside bin/lib/atomic-write.ts.
// The selector matches any CallExpression whose callee property name is 'writeFile'.
// bin/lib/atomic-write.ts is exempted by a per-file override below.
'no-restricted-syntax': ['error',
  {
    selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]',
    message: 'DOI regex /^10\\./ is a chokepoint — use bin/lib/doi.ts only',
  },
  {
    selector: "CallExpression[callee.property.name='writeFile']",
    message: 'Direct fs.writeFile is forbidden (ARCH-05 / D-07) — use bin/lib/atomic-write.ts',
  },
],
```

NOTE: `no-restricted-syntax` takes an array; both selectors live in the SAME rule entry. The existing single-object form must be expanded to an array. The existing DOI selector is kept verbatim.

D-07 exemption for `bin/lib/atomic-write.ts` (add after DOI exemption block):
```javascript
{
  files: ['bin/lib/atomic-write.ts'],
  rules: { 'no-restricted-syntax': 'off' },
},
```

D-41 paths chokepoint — add the MemberExpression selectors below to the EXISTING `no-restricted-syntax` array (alongside the D-07 atomic-write selector and the existing DOI selector). Do NOT add a `no-restricted-globals` rule for `process` — `no-restricted-globals` cannot ban member access like `process.env.X`, so it is the wrong tool; `no-restricted-syntax` with MemberExpression selectors is the correct mechanism. Use these four selectors verbatim:
```javascript
{
  selector: "MemberExpression[object.name='os'][property.name='homedir']",
  message: 'os.homedir() is a chokepoint — use bin/lib/paths.ts',
},
{
  selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='APPDATA']",
  message: 'process.env.APPDATA is a chokepoint — use bin/lib/paths.ts',
},
{
  selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='LOCALAPPDATA']",
  message: 'process.env.LOCALAPPDATA is a chokepoint — use bin/lib/paths.ts',
},
{
  selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='XDG_DATA_HOME']",
  message: 'process.env.XDG_DATA_HOME is a chokepoint — use bin/lib/paths.ts',
},
```

D-41 exemption for `bin/lib/paths.ts` (add after D-07 exemption):
```javascript
{
  files: ['bin/lib/paths.ts'],
  rules: { 'no-restricted-syntax': 'off' },
},
```

Red-team fixture additions to global-ignores (extend the existing ignores array):
```javascript
{
  ignores: [
    'tests/fixtures/lint-chokepoint-fixture.ts',
    'tests/fixtures/lint-atomic-write-chokepoint-fixture.ts',  // D-07
    'tests/fixtures/lint-paths-chokepoint-fixture.ts',         // D-41
    'dist/**',
    'node_modules/**',
  ],
},
```

---

### `package.json` (MODIFY — add deps + `coverage` script)

**Analog:** `package.json` (itself — copy existing dep format exactly)

**Current scripts block** (lines 11–18):
```json
"scripts": {
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "node scripts/run-tests.mjs",
  "build": "tsc",
  "dev": "tsx",
  "validate:manifests": "node scripts/validate-plugin-manifest.cjs",
  "check": "npm run lint && npm run typecheck && npm run test && npm run validate:manifests"
},
```

**Add `coverage` script** (D-67):
```json
"coverage": "c8 node scripts/run-tests.mjs",
```

**Current engines field** (line 8):
```json
"engines": { "node": ">=20.10.0" },
```
This stays as-is (documents minimum runtime, not CI). CI node version is the `.github/workflows/ci.yml` change.

**New runtime deps to add** (use caret pins per Phase 0 Claude's Discretion):
```json
"dependencies": {
  "undici": "^7",
  "p-retry": "^6",
  "proper-lockfile": "^4",
  "zod": "^3.23",
  "smol-toml": "^1.6.1",
  "doi-regex": "^0.1.17",
  "@anthropic-ai/sdk": "^0.93",
  "openai": "^4",
  "@modelcontextprotocol/sdk": "^1.29",
  "@clack/prompts": "^0.7"
}
```

**New dev deps to add** (merge into existing `devDependencies`):
```json
"devDependencies": {
  "@types/node": "^20.10.0",
  "@types/proper-lockfile": "^4",
  "c8": "^11.0.0",
  "eslint": "^9.0.0",
  "fast-check": "^3",
  "nock": "^14",
  "tsx": "^4.0.0",
  "typescript": "^5.6.0",
  "typescript-eslint": "^8.0.0"
}
```

---

### `.github/workflows/ci.yml` (MODIFY — bump Node version)

**Analog:** `.github/workflows/ci.yml` (itself)

**Current matrix block** (lines 12–16):
```yaml
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: ['20.10']
```

**Change exactly one value** — line 16, `'20.10'` → `'20.18'`:
```yaml
        node: ['20.18']
```

No other CI changes in Phase 1. The step order (`npm ci` → `lint` → `typecheck` → `build` → `test` → validate) is correct as-is and carries forward per Phase 0 D-11.

---

### `tests/lint-chokepoint.test.ts` (READ-ONLY ANALOG — do not modify)

This file is the **master pattern** for all three chokepoint test files. Path:
`C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\tests\lint-chokepoint.test.ts`

**Import block pattern** (lines 1–11):
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import path from 'node:path';
```

**Core programmatic ESLint test pattern** (lines 13–49):
```typescript
test('lint chokepoints flag both fixture violations', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: {
        // ... inline rule copy ...
      },
    }],
  });

  const fixture = path.resolve('tests/fixtures/lint-chokepoint-fixture.ts');
  const results = await eslint.lintFiles([fixture]);
  assert.equal(results.length, 1, `expected 1 fixture result, got ${results.length}`);
  const ruleIds = (results[0]?.messages ?? []).map(m => m.ruleId);
  assert.ok(
    ruleIds.includes('no-restricted-syntax'),
    `expected no-restricted-syntax to fire on fixture; got: ${JSON.stringify(ruleIds)}`,
  );
});
```

**Project-config integration test pattern** (lines 83–120):
```typescript
test('PROJECT eslint.config.js (loaded from disk) flags both fixture violations', async () => {
  const projectConfigUrl = new URL('../eslint.config.js', import.meta.url);
  const projectConfigModule = await import(projectConfigUrl.href) as { default: Record<string, unknown>[] };
  const projectConfig = projectConfigModule.default;
  const fixturePath = path.resolve('tests/fixtures/lint-chokepoint-fixture.ts');
  // Filter out global-ignores-only entries so the fixture is not hidden:
  const configWithoutGlobalIgnores = projectConfig.filter((entry) => {
    const keys = Object.keys(entry);
    return !(keys.length === 1 && keys[0] === 'ignores');
  });
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: configWithoutGlobalIgnores as never,
  });
  const results = await eslint.lintFiles([fixturePath]);
  // ... assert ruleIds includes the rule ...
});
```

---

### `tests/lint-atomic-write-chokepoint.test.ts` (NEW — copy from lint-chokepoint.test.ts)

**Analog:** `tests/lint-chokepoint.test.ts` (exact copy, modified for D-07 rule)

**Rule to test:**
```javascript
// Rule under test — matches any fs.writeFile / fs.promises.writeFile call
{
  selector: "CallExpression[callee.property.name='writeFile']",
  message: 'Direct fs.writeFile is forbidden (ARCH-05 / D-07) — use bin/lib/atomic-write.ts',
}
```

**Fixture path to test against:** `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts`

Copy the three-test structure from `lint-chokepoint.test.ts`:
1. Inline rule fires on fixture
2. Benign code does NOT fire
3. PROJECT `eslint.config.js` fires on fixture (filter global-ignores pattern, lines 94–110, is identical)

---

### `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts` (NEW — copy from lint-chokepoint-fixture.ts)

**Analog:** `tests/fixtures/lint-chokepoint-fixture.ts` (exact structure)

**Current fixture** (`C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\tests\fixtures\lint-chokepoint-fixture.ts`, lines 1–21):
```typescript
// @ts-nocheck — this file is never type-checked or executed.

// === D-06 violation: HTTP import outside bin/lib/http.ts ===
import { fetch } from 'undici';

// === D-07 violation: /^10\./ regex outside bin/lib/doi.ts ===
const doiPrefixRegex = /^10\./;

export const _redTeam = { fetch, doiPrefixRegex };
```

**New fixture for D-07 atomic-write chokepoint:**
```typescript
// @ts-nocheck — this file is never type-checked or executed.
// INTENTIONALLY violates atomic-write chokepoint (D-07).
// Ignored by project eslint.config.js; tested programmatically only.

import fs from 'node:fs';
import fsp from 'node:fs/promises';

// === D-07 violation: direct fs.writeFile outside bin/lib/atomic-write.ts ===
fs.writeFile('/tmp/test.json', '{}', () => {});

// === D-07 violation: direct fs.promises.writeFile outside bin/lib/atomic-write.ts ===
await fsp.writeFile('/tmp/test2.json', '{}');

export const _redTeam = { fs, fsp };
```

---

### `tests/lint-paths-chokepoint.test.ts` (NEW — copy from lint-chokepoint.test.ts)

**Analog:** `tests/lint-chokepoint.test.ts` (exact copy, modified for D-41 rule)

**Rules to test:**
```javascript
[
  {
    selector: "MemberExpression[object.name='os'][property.name='homedir']",
    message: 'os.homedir() is a chokepoint — use bin/lib/paths.ts',
  },
  {
    selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='LOCALAPPDATA']",
    message: 'process.env.LOCALAPPDATA is a chokepoint — use bin/lib/paths.ts',
  },
]
```

**Fixture path:** `tests/fixtures/lint-paths-chokepoint-fixture.ts`

---

### `tests/fixtures/lint-paths-chokepoint-fixture.ts` (NEW — copy from lint-chokepoint-fixture.ts)

**Analog:** `tests/fixtures/lint-chokepoint-fixture.ts`

**New fixture for D-41 paths chokepoint:**
```typescript
// @ts-nocheck — this file is never type-checked or executed.
// INTENTIONALLY violates paths chokepoint (D-41).

import os from 'node:os';

// === D-41 violation: direct os.homedir() outside bin/lib/paths.ts ===
const home = os.homedir();

// === D-41 violation: direct process.env.LOCALAPPDATA outside bin/lib/paths.ts ===
const localAppData = process.env.LOCALAPPDATA;

// === D-41 violation: direct process.env.XDG_DATA_HOME outside bin/lib/paths.ts ===
const xdgData = process.env.XDG_DATA_HOME;

export const _redTeam = { home, localAppData, xdgData };
```

---

### Test file standard pattern (all `tests/*.test.ts`)

**Primary analog:** `tests/repo-files.test.ts`
`C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\tests\repo-files.test.ts`

**Import block** (lines 1–9):
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
```

**Test structure** (use `test()` with async callback, `node:assert/strict`, absolute paths via `path.resolve()`):
```typescript
test('description of what is asserted', async () => {
  // arrange
  // act
  // assert using assert.equal / assert.ok / assert.match / assert.throws
});
```

**Negative test pattern** (from `tests/manifest.test.ts` lines 76–103):
```typescript
test('validator FAILS when X is malformed (negative test)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-test-'));
  // ... set up malformed state ...
  let exitCode = 0;
  try {
    execFileSync(process.execPath, ['...'], { cwd: tmp, stdio: 'pipe' });
  } catch (e: unknown) {
    const err = e as { status?: number };
    exitCode = err.status ?? -1;
  }
  assert.equal(exitCode, 1, 'must exit non-zero on ...');
});
```

**Child-process spawn pattern** (for `tests/lock.test.ts` TEST-07, from `scripts/run-tests.mjs` lines 62–68):
```typescript
import { spawn } from 'node:child_process';

// For lock conflict test: spawn a child that tries to acquire the same lock
const child = spawn(process.execPath, ['dist/some-test-helper.js', lockPath], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: repoRoot,
});
child.on('exit', (code, signal) => {
  assert.notEqual(code, 0, 'child must exit non-zero when lock is held');
  // optionally assert stderr contains pid/hostname of lock holder
});
```

**Network-gate pattern** (D-66, for `tests/http.test.ts`):
```typescript
test('live HTTP call (gated)', async (t) => {
  if (process.env.PENSMITH_NETWORK_TESTS !== '1') {
    t.skip('PENSMITH_NETWORK_TESTS=1 required');
    return;
  }
  // ... live test ...
});
```

---

### `tests/doi.test.ts` — fast-check property test pattern

**Analog:** `tests/lint-chokepoint.test.ts` (same import style); fixture from RESEARCH.md RQ-3

**Import block:**
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { normalize } from '../bin/lib/doi.ts';
import { doiWithTrailingPunct, doiWithPrefix, garbage } from './fixtures/doi-corpus.ts';
```

**Property test pattern** (from RESEARCH.md RQ-3, lines 266–279):
```typescript
test('DOI normalize is idempotent', () => {
  fc.assert(
    fc.property(
      fc.oneof(doiWithTrailingPunct, doiWithPrefix, garbage),
      (input) => {
        const once = normalize(input);
        const twice = once !== null ? normalize(once) : null;
        assert.strictEqual(once, twice,
          `normalize(normalize(x)) !== normalize(x) for input: ${input}`);
      }
    ),
    { numRuns: 1000 }
  );
});
```

---

### `tests/http.test.ts` — nock cassette pattern

**Analog:** `tests/lint-chokepoint.test.ts` (same import / test shape); cassette pattern from RESEARCH.md RQ-4

**Import block + setup:**
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
const nockBack = nock.back;

// Set fixture dir (absolute path, ESM-compatible):
nockBack.fixtures = new URL('../fixtures/http-cassettes', import.meta.url).pathname;
// Lockdown in CI (all cassettes must exist); record when PENSMITH_NETWORK_TESTS=1:
nockBack.setMode(
  process.env.PENSMITH_NETWORK_TESTS === '1' ? 'record' : 'lockdown'
);
```

**Individual cassette test:**
```typescript
test('429 with Retry-After header: retry honors timing', async () => {
  const { nockDone } = await nockBack('429-retry-after-seconds.json');
  // call http.ts request() which should retry after honoring Retry-After
  nockDone();
});
```

**8 cassette files required** (under `tests/fixtures/http-cassettes/`):
```
429-retry-after-seconds.json
503-no-header.json
429-retry-after-http-date.json
429-x-rate-limit-reset.json
missing-email-warn-proceeds.json
cache-hit.json
cache-ttl-expiry.json
bypass-cache.json
```

---

### `bin/lib/paths.ts` (NEW implementation)

**Analog:** `eslint.config.js` D-08 exemption block (same "per-file exemption" architecture pattern)

**Module header doc-comment pattern** (copy the eslint.config.js header doc-comment style, lines 1–26):
```typescript
// bin/lib/paths.ts
// Cross-platform local-only data directory resolution (ARCH-08, D-40..D-43).
//
// Chokepoint: this is the ONLY file allowed to call os.homedir(),
// process.env.LOCALAPPDATA, process.env.APPDATA, process.env.XDG_DATA_HOME.
// A Phase-1 lint rule (D-41) bans those references everywhere else.
// The red-team fixture at tests/fixtures/lint-paths-chokepoint-fixture.ts
// keeps the lint rule honest.
//
// Why LOCALAPPDATA not APPDATA (Windows): APPDATA is the *roaming* folder —
// OneDrive or domain roaming profiles will sync it. LOCALAPPDATA is
// machine-local. Since the dev folder is inside OneDrive - Roanoke College,
// using LOCALAPPDATA is load-bearing, not just hygiene (Pitfall 4).
```

**Exports pattern** (per D-40):
```typescript
export function localDataDir(): string { ... }
export function pensmithDataDir(): string { ... }
export function pensmithLockDir(): string { ... }
export function pensmithHttpCacheDir(): string { ... }
export function projectRoot(cwd?: string): string | null { ... }
export function projectHash(root: string): string { ... }
export function paperDir(root: string): string { ... }
export function sectionDir(root: string, num: string, slug: string): string { ... }
export function isInsideSyncFolder(p: string): { inside: boolean; vendor?: 'onedrive'|'icloud'|'dropbox'|'gdrive' } { ... }
export function slugify(s: string): string { ... }
```

---

### `bin/lib/atomic-write.ts` (NEW implementation)

**Analog:** `scripts/run-tests.mjs` (same `node:fs/promises` open/close idiom)

**Module header pattern** (D-03 requires 1-2 paragraph header doc-comment):
```typescript
// bin/lib/atomic-write.ts
// Atomic file write: open tmp → write → fsync(tmp) → rename → fsync(dir) (ARCH-05, D-04..D-07).
//
// Chokepoint: all state-file writes MUST go through writeAtomic(). Direct
// fs.writeFile / fs.promises.writeFile calls outside this file are banned by
// an ESLint rule (D-07) backed by a red-team fixture at
// tests/fixtures/lint-atomic-write-chokepoint-fixture.ts.
//
// Windows note: fsync(dirfd) fails with EPERM on Windows NTFS (journaled FS).
// The dirfd fsync step is guarded by process.platform !== 'win32' (RQ-8).
// Temp path: ${target}.tmp.${pid}.${random8hex} (D-05).
```

**Core implementation pattern** (from RESEARCH.md RQ-8, lines 507–536):
```typescript
export async function writeAtomic(
  targetPath: string,
  data: string | Buffer,
  opts?: { mode?: number; encoding?: BufferEncoding }
): Promise<void> {
  const dir = path.dirname(targetPath);
  const tmpPath = `${targetPath}.tmp.${process.pid}.${_randomHex(8)}`;

  const fd = await fs.promises.open(tmpPath, 'w', opts?.mode ?? 0o644);
  try {
    await fd.write(typeof data === 'string'
      ? Buffer.from(data, opts?.encoding ?? 'utf8')
      : data
    );
    await fd.sync();       // fsync(tmpfd)
    await fd.close();
    await fs.promises.rename(tmpPath, targetPath);

    if (process.platform !== 'win32') {
      const dirFd = await fs.promises.open(dir, 'r');
      try { await dirFd.sync(); } catch { /* best-effort */ }
      await dirFd.close();
    }
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
```

---

### `bin/lib/lock.ts` (NEW implementation)

**Analog:** `tests/manifest.test.ts` (createRequire / CJS interop pattern, lines 8–9 `import { execFileSync } from 'node:child_process'`)

**CJS interop pattern for `proper-lockfile`** (from RESEARCH.md RQ-2, lines 178–188):
```typescript
import { createRequire } from 'node:module';
const lockfile = createRequire(import.meta.url)('proper-lockfile') as typeof import('proper-lockfile');

const release = await lockfile.lock('/path/to/target-file', {
  stale: 90_000,
  update: 30_000,
  retries: 0,
  lockfilePath: '/path/to/custom.lock',
  onCompromised: (err) => { throw err; },
});
```

**Lock payload file pattern** (separate `.lock.info` JSON, NOT stored by proper-lockfile):
```typescript
// The .lock directory is proper-lockfile's marker; payload lives separately
const infoPath = `${lockPath}.info`;
await writeAtomic(infoPath, JSON.stringify({
  schema_version: 1,
  pid: process.pid,
  hostname: os.hostname(),
  started_at: new Date().toISOString(),
  heartbeat_at: new Date().toISOString(),
  pensmith_version: VERSION,
}));
```

---

### `bin/lib/doi.ts` (NEW implementation)

**Analog:** `eslint.config.js` D-07 exemption block — confirms this file gets the `no-restricted-syntax: 'off'` exemption.

**Module header pattern** (D-03):
```typescript
// bin/lib/doi.ts
// DOI / arXiv / PMID normalization chokepoint (ARCH-15, D-14..D-20).
//
// Chokepoint: ALL DOI regex usage is concentrated here. The AST selector
// Literal[regex.pattern=/^\^10\\\\\\./] is banned everywhere else by the
// D-07 lint rule in eslint.config.js.
//
// Normalization spec (D-15): strip prefix → strip trailing punct → ASCII-fold
// → validate /^10\.\d{4,9}\/[^\s]+$/. Store BOTH doi_canonical AND doi_as_cited.
```

**Exported API** (per D-15, D-16, D-17, D-18):
```typescript
export function normalize(input: string): string | null
export function normalizeArxiv(input: string): string | null
export function normalizePmid(input: string): { pmid: string | null; pmcid: string | null }
export function doiMatches(a: string, b: string): boolean  // exact-or-base-match per D-17
```

---

### `bin/lib/http.ts` (NEW implementation)

**Analog:** `eslint.config.js` D-06 exemption block — confirms this file gets the `no-restricted-imports: 'off'` exemption.

**Module header pattern** (D-03):
```typescript
// bin/lib/http.ts
// Undici-backed HTTP client with per-source TTL cache, jittered retry,
// polite UA, and rate-limit floors (ARCH-12, ARCH-13, ARCH-14, D-21..D-30).
//
// Chokepoint: ALL outgoing HTTP calls MUST go through request() here.
// Direct undici/fetch/http/https imports elsewhere are banned by the D-06
// lint rule in eslint.config.js.
//
// WARN-once banner: when PENSMITH_CONTACT_EMAIL is unset, a one-time WARN
// is emitted and the no-contact UA is used. Banner copy is locked in
// references/http-warnings.md (D-24).
```

**Public API signature** (per D-23):
```typescript
export async function request<T>(opts: {
  source: 'crossref'|'openalex'|'arxiv'|'pubmed'|'unpaywall'
       |'semanticscholar'|'retraction-watch'|'duckduckgo'|'gptzero'|'generic';
  method?: 'GET'|'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  cacheKey?: string;
  cacheTtlMs?: number;
  bypassCache?: boolean;
}): Promise<{ status: number; headers: Record<string, string>; body: T; cached: boolean }>
```

**Full-jitter retry pattern** (from RESEARCH.md RQ-9, lines 574–616):
```typescript
function _fullJitter(base: number, attempt: number, maxMs: number): number {
  return Math.random() * Math.min(maxMs, base * Math.pow(2, attempt));
}
// Use p-retry with randomize: false + custom onFailedAttempt that reads
// Retry-After / X-Rate-Limit-Reset headers and falls back to fullJitter.
```

---

### `bin/lib/budget.ts` (NEW implementation)

**Analog:** `tests/repo-files.test.ts` (append pattern, `fs.appendFile` idiom)

**Public API** (per D-31, D-32, D-34, D-35):
```typescript
export class BudgetExceededError extends Error { ... }

export function assertBudget(opts: {
  scope: 'session' | 'step';
  estimateUsd: number;
  label: string;
}): void  // throws BudgetExceededError synchronously; called BEFORE LLM call

export class Semaphore {
  constructor(slots: number);
  acquire(): Promise<void>;
  release(): void;
  withPermit<T>(fn: () => Promise<T>): Promise<T>;
}

export function wouldYoloRefuse(opts: {
  remaining: number;
  estimate: number;
  cap: number;
}): boolean
```

**COSTS.jsonl append pattern** (D-33 — NOT through atomic-write, uses O_APPEND):
```typescript
// fs.appendFile is atomic for ≤PIPE_BUF; a single JSONL record is well under that
await fs.promises.appendFile(costsPath, JSON.stringify(record) + '\n');
```

---

### `bin/lib/migrations/loader.ts` (NEW implementation)

**Analog:** `bin/lib/migrations/README.md` (contract doc that ships in same directory)

**Public API + error class** (from RESEARCH.md RQ-5, lines 356–391):
```typescript
import { z } from 'zod';

export class ForwardIncompatError extends Error {
  constructor(fileVersion: number, currentVersion: number) {
    super(`State file version ${fileVersion} is newer than pensmith ${currentVersion}. Upgrade pensmith or remove .paper/`);
  }
}

export async function loadAndMigrate<T>(opts: {
  raw: unknown;
  currentVersion: number;
  schema: z.ZodSchema<T>;
}): Promise<T>
```

---

### `bin/lib/schemas/state.ts` (NEW — zod schema)

**Analog:** `tests/repo-files.test.ts` lines 52–67 (JSON shape with version field + tsconfig contract)

**Schema pattern** (from RESEARCH.md RQ-5, lines 341–353):
```typescript
import { z } from 'zod';

export const ProjectStateV1Schema = z.object({
  schema_version: z.literal(1),
  paper_status: z.enum([
    'intake', 'research', 'outline', 'sectioning', 'compile', 'done', 'archived'
  ]),
  current_section: z.string().nullable(),
  last_updated: z.string().datetime(),
});

export type ProjectStateV1 = z.infer<typeof ProjectStateV1Schema>;
```

All four schemas (`state`, `library`, `checkpoint`, `session-log`, `runtime-config`) follow this same pattern. Each file exports one named `*Schema` const and one exported `type *` from `z.infer<>`.

---

### `bin/lib/runtime.ts` + `bin/lib/runtime/pricing.ts` (NEW)

**Analog:** `mcp/server.ts` (ESM stub structure); provider routing from RESEARCH.md RQ-6

**Provider routing pattern** (from RESEARCH.md RQ-6, lines 444–455):
```typescript
export async function chat(opts: ChatOpts): Promise<ChatResult> {
  if (opts.provider === 'anthropic') {
    return _chatViaAnthropic(opts);   // @anthropic-ai/sdk
  } else {
    return _chatViaOpenAI(opts);      // openai SDK with baseURL override
    // covers: 'openai', 'ollama', 'vllm', 'openai-compatible'
  }
}
```

**Pricing table pattern** (`bin/lib/runtime/pricing.ts`, per D-60):
```typescript
// bin/lib/runtime/pricing.ts
// Hand-maintained pricing table keyed on 'provider:model'.
// REVIEW DATE: 2026-Q3. Check Anthropic + OpenAI pricing pages before release.
// Unknown models fall back to conservative overestimate and emit one-time WARN.

const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'anthropic:claude-opus-4-7':   { inputPerM: 15.00, outputPerM: 75.00 },
  'anthropic:claude-sonnet-4-6': { inputPerM:  3.00, outputPerM: 15.00 },
  'openai:gpt-4o':               { inputPerM:  5.00, outputPerM: 15.00 },
  // ...
};

const FALLBACK = { inputPerM: 20.00, outputPerM: 80.00 };

export function lookupPricing(providerModel: string) {
  return PRICING[providerModel] ?? FALLBACK;
}
```

---

### `references/http-warnings.md` (NEW — locked string)

**Analog:** `bin/lib/migrations/README.md` (single-purpose prose artifact in references/)

**Content pattern** — one locked warning string, NOT generated prose:
```markdown
# HTTP Warning Strings (locked — D-24)

## PENSMITH_CONTACT_EMAIL not set

> pensmith: PENSMITH_CONTACT_EMAIL is not set. Using no-contact User-Agent. Some APIs (Crossref polite pool, OpenAlex) may rate-limit more aggressively. Set PENSMITH_CONTACT_EMAIL to your email address in your shell profile. See https://github.com/akhilachanta/pensmith#configuration
```

This string is read at module load by `http.ts` and reused verbatim by Phase 2's doctor warning. Never hard-code the text inside `http.ts` itself.

---

## Shared Patterns

### Pattern 1: Module header doc-comment (D-03)
**Source:** `eslint.config.js` lines 1–26 (multi-line comment with "Why this shape" explanation)
**Apply to:** All 13 `bin/lib/*.ts` implementation files

Every lib file opens with a 2-3 sentence block comment naming:
1. The architectural requirement it satisfies (e.g., `ARCH-05`, `D-04..D-07`)
2. The chokepoint it owns (if any) and the lint rule that enforces it
3. The "key design trap" to avoid (the pitfall reference)

### Pattern 2: Chokepoint exemption in `eslint.config.js`
**Source:** `eslint.config.js` lines 62–71 (HTTP and DOI exemptions)
**Apply to:** `bin/lib/atomic-write.ts` (D-07 exemption), `bin/lib/paths.ts` (D-41 exemption)

Exact shape — per-file override object with `files: ['bin/lib/<name>.ts']` and `rules: { '<rule>': 'off' }`.

### Pattern 3: Red-team fixture (D-08 lesson)
**Source:** `tests/fixtures/lint-chokepoint-fixture.ts`
**Apply to:** `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts`, `tests/fixtures/lint-paths-chokepoint-fixture.ts`

Every fixture file carries: `// @ts-nocheck` header comment, INTENTIONAL violation comment, a binding reference (`export const _redTeam = ...`) to prevent tree-shaking.

### Pattern 4: Programmatic ESLint test with project-config integration check
**Source:** `tests/lint-chokepoint.test.ts` (three-test structure)
**Apply to:** `tests/lint-atomic-write-chokepoint.test.ts`, `tests/lint-paths-chokepoint.test.ts`

Three tests per file:
1. Inline rule fires on fixture (confirms rule works in principle)
2. Benign code does NOT fire (prevents false-positive regression)
3. Project `eslint.config.js` loaded from disk fires on fixture (confirms actual config file is correct, not just the inline copy)

The "filter global-ignores" trick (lines 101–104 of `lint-chokepoint.test.ts`) is **mandatory** — without it, the project config's global `ignores` will block the fixture from being linted, and the third test will always vacuously pass.

### Pattern 5: `node:test` + `node:assert/strict` test style
**Source:** `tests/repo-files.test.ts` (plain unit tests), `tests/manifest.test.ts` (with execFileSync)
**Apply to:** All 13 `tests/*.test.ts` files

- `import test from 'node:test'` — bare default import (not `{ test }`)
- `import assert from 'node:assert/strict'` — strict mode
- `path.resolve('relative/path')` — always resolve from cwd (not `import.meta.url` unless ESM URL is needed)
- Async tests use `async (t) =>` callback (the `t` param gives skip/todo access)

### Pattern 6: `schema_version: 1` on all JSON state files
**Source:** Phase 0 `00-CONTEXT.md` D-22 + `package.json` (version field convention)
**Apply to:** All JSON files written by `state.ts`, `library.ts`, `checkpoint.ts`, `session-log.ts`

Every JSON object written to disk includes `schema_version: 1` as the first field. Every zod schema includes `schema_version: z.literal(1)` as the first key.

### Pattern 7: CJS interop via `createRequire`
**Source:** `eslint.config.js` line 86 (`scripts/**/*.cjs` exemption — the .cjs pattern is already established) + RESEARCH.md RQ-2
**Apply to:** `bin/lib/lock.ts` (for `proper-lockfile`)

```typescript
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lockfile = require('proper-lockfile') as typeof import('proper-lockfile');
```

### Pattern 8: `npm run build` precedes `npm test`
**Source:** `.github/workflows/ci.yml` lines 38–41 (build step before test step)
**Apply to:** `tests/lock.test.ts` specifically (child_process.spawn test runs against compiled `dist/`)

The CI step order is already correct in Phase 0. The planner's lock conflict test MUST spawn against `dist/` (compiled JS), not the raw `.ts` source. The test helper that the child spawns must be an compiled artifact.

---

## No Analog Found

Files with no close match in the existing codebase (planner should use RESEARCH.md code examples as the primary pattern source):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `bin/lib/runtime/pricing.ts` | utility | lookup table | No static data tables exist yet in the codebase |
| `tests/fixtures/doi-corpus.ts` | fixture | fast-check generators | No property-test fixtures exist yet |
| `tests/fixtures/http-cassettes/*.json` | fixture | nock cassette | No HTTP cassette fixtures exist yet |
| `bin/lib/pii.ts` | utility | transform (regex) | No regex-transform modules exist yet |
| `bin/lib/session-log.ts` | utility | append-only I/O | No append-pattern writers exist yet |
| `bin/lib/http.ts` (full implementation) | utility | request-response + cache | The placeholder `.gitkeep` was the only artifact |
| `bin/lib/budget.ts` | utility | ledger + semaphore | No semaphore or ledger primitives exist yet |

For these files, the RESEARCH.md code examples in RQ-1 through RQ-9 are the authoritative implementation guide. The test pattern (Pattern 5 above) still applies to their test files.

---

## Metadata

**Analog search scope:** `eslint.config.js`, `package.json`, `.github/workflows/ci.yml`, `scripts/run-tests.mjs`, `tests/lint-chokepoint.test.ts`, `tests/fixtures/lint-chokepoint-fixture.ts`, `tests/manifest.test.ts`, `tests/repo-files.test.ts`, `bin/lib/migrations/README.md`
**Files scanned:** 9 existing source files (full reads); RESEARCH.md (partial reads across RQ-1..13)
**Pattern extraction date:** 2026-05-08

---

## PATTERN MAPPING COMPLETE
