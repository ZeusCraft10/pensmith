// tests/repo-files.test.ts
// Smoke test: every required Phase 0 root file exists and contains the
// locked stub strings from D-19, D-20, and the architecture decisions.
// Extended in Phase 2 (02-00): doctor-output.md hash-pin, citty dep.
// Extended in Phase 2 (02-06): hooks/*.ts + hooks.json (TIER-03) replace the
// previous hooks/.gitkeep placeholder from 02-00.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), 'utf-8');
}

test('root config files exist', () => {
  for (const f of [
    'package.json',
    'tsconfig.json',
    '.gitignore',
    '.gitattributes',
    'LICENSE',
    'README.md',
    'PRIVACY.md',
    'README-DEV.md',
    'CONTRIBUTING.md',
    'eslint.config.js',
    'mcp/server.ts',
    'scripts/run-tests.mjs',
    'references/doctor-output.md',
    // 02-06: hooks/.gitkeep replaced by real TIER-03 hook modules.
    'hooks/hooks.json',
    'hooks/session-start.ts',
    'hooks/pre-compact.ts',
    'hooks/post-tool-use.ts',
    'hooks/stop.ts',
  ]) {
    assert.ok(fs.existsSync(path.resolve(f)), `missing required file: ${f}`);
  }
});

test('package.json contract', () => {
  const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
  assert.equal(pkg['name'], 'pensmith');
  assert.equal(pkg['type'], 'module');
  assert.equal(pkg['license'], 'MIT');
  const engines = pkg['engines'] as Record<string, string> | undefined;
  assert.equal(engines?.['node'], '>=20.10.0');
  assert.equal(pkg['packageManager'], 'npm@10.9.0');
  const scripts = pkg['scripts'] as Record<string, string> | undefined;
  for (const s of ['lint', 'typecheck', 'test', 'build', 'dev', 'validate:manifests', 'check']) {
    assert.ok(scripts && scripts[s], `package.json missing script: ${s}`);
  }
  assert.equal(scripts?.['test'], 'node scripts/run-tests.mjs',
    'scripts.test must invoke the portable runner (not a shell glob)');
  const dev = pkg['devDependencies'] as Record<string, string> | undefined;
  assert.ok(dev && !dev['eslint-plugin-import'],
    'eslint-plugin-import must NOT be a Phase 0 devDependency (D-06 covered by no-restricted-imports alone)');
  const deps = pkg['dependencies'] as Record<string, string> | undefined;
  assert.ok(deps && deps['citty'], 'package.json must declare citty dependency (D-14)');
  assert.match(deps?.['citty'] ?? '', /\^0\.2/, 'citty pin must satisfy ^0.2.2 (D-14)');
});

test('tsconfig contract (D-03)', () => {
  const ts = JSON.parse(read('tsconfig.json')) as {
    compilerOptions: Record<string, unknown>;
    exclude?: string[];
  };
  const co = ts.compilerOptions;
  assert.equal(co['target'], 'ES2022');
  assert.equal(co['module'], 'NodeNext');
  assert.equal(co['moduleResolution'], 'NodeNext');
  assert.equal(co['strict'], true);
  assert.equal(co['noUncheckedIndexedAccess'], true);
  assert.equal(co['exactOptionalPropertyTypes'], true);
  assert.equal(co['verbatimModuleSyntax'], true);
  assert.ok(Array.isArray(ts.exclude) && ts.exclude.includes('tests/fixtures/**/*'),
    'tsconfig.exclude must contain tests/fixtures/**/* so the @ts-nocheck red-team fixture is not type-checked');
});

test('LICENSE is MIT 2026 Akhil Achanta', () => {
  const lic = read('LICENSE');
  assert.match(lic, /MIT License/);
  assert.match(lic, /Copyright \(c\) 2026 Akhil Achanta/);
});

test('README, PRIVACY, README-DEV, CONTRIBUTING stubs are correct', () => {
  assert.match(read('README.md'), /v0\.1\.0 in development/);
  assert.match(read('README.md'), /Phase 6/);
  assert.match(read('PRIVACY.md'), /local-only/i);
  assert.match(read('PRIVACY.md'), /No telemetry/i);
  assert.match(read('README-DEV.md'), /npm run build/);
  assert.match(read('README-DEV.md'), /dist\/mcp\/server\.js/);
  const c = read('CONTRIBUTING.md');
  assert.match(c, /bin\/lib\/http\.ts/);
  assert.match(c, /bin\/lib\/doi\.ts/);
});

test('directory contract from D-21', () => {
  for (const d of [
    'bin', 'bin/lib', 'bin/lib/migrations', 'mcp', 'hooks', 'skills', 'agents',
    'workflows', 'templates', 'templates/citation-styles', 'references',
    'schema', 'tests', 'tests/fixtures', 'scripts',
  ]) {
    assert.ok(fs.statSync(path.resolve(d)).isDirectory(), `missing dir: ${d}`);
  }
});

test('eslint.config.js declares both chokepoints and does NOT use eslint-plugin-import', () => {
  const cfg = read('eslint.config.js');
  assert.match(cfg, /no-restricted-imports/);
  assert.match(cfg, /no-restricted-syntax/);
  assert.match(cfg, /undici/);
  assert.match(cfg, /node:http/);
  assert.match(cfg, /node:https/);
  assert.match(cfg, /bin\/lib\/http\.ts/);
  assert.match(cfg, /bin\/lib\/doi\.ts/);
  assert.match(cfg, /lint-chokepoint-fixture\.ts/);
  assert.ok(!/eslint-plugin-import/.test(cfg),
    'eslint.config.js must not reference eslint-plugin-import at Phase 0');
  assert.ok(!/no-restricted-paths/.test(cfg),
    'eslint.config.js must not use no-restricted-paths at Phase 0 (D-06 satisfied by no-restricted-imports alone)');
});

test('scripts/run-tests.mjs is the test runner (not a shell glob)', () => {
  const runner = read('scripts/run-tests.mjs');
  assert.match(runner, /readdir/);
  assert.match(runner, /\.test\.ts/);
  assert.match(runner, /--import.*tsx/);
  assert.match(runner, /--test/);
  assert.match(runner, /discovered/);
  assert.match(runner, /process\.exit\(1\)/, 'must exit 1 on zero matches');
});

// D-18: references/doctor-output.md is a single source of truth for DOCT copy.
// We pin the file's exact bytes via SHA-256. ANY substantive change to the
// locked copy MUST be paired with a hash-pin update in this test — making the
// drift visible at PR-review time. Substring matching was rejected as too weak
// (it would silently allow inserted lines, reordered probes, or rewritten copy
// outside the matched fragments).
test('references/doctor-output.md hash-pin (D-18)', () => {
  const bytes = readFileSync('references/doctor-output.md');  // raw bytes, no BOM strip
  const hash = createHash('sha256').update(bytes).digest('hex');
  // PINNED-HASH below: regenerate by running `node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/doctor-output.md')).digest('hex'))"`
  // after every intentional edit. The PR diff makes the change visible.
  const PINNED = 'e1a00959050c56b18cc97804ab226577cbb26af9582b22717b21cb9a48386060';
  assert.equal(hash, PINNED, `references/doctor-output.md drifted from locked copy. Update PINNED to ${hash} if the edit was intentional.`);
});

// IN-03 / D-24: references/http-warnings.md is the SINGLE source of truth
// for the HTTP-client WARN-once banner string. bin/lib/http.ts reads it at
// module load; tests/http.test.ts asserts the runtime banner matches the
// "no-contact User-Agent" phrasing from this file. A hash-pin here means any
// edit to the canonical copy shows up in PR diff alongside the WARN-once
// test changes — preventing accidental drift that the substring matcher in
// http.test.ts would not catch (e.g., subtle URL or punctuation changes).
test('references/http-warnings.md hash-pin (IN-03 / D-24)', () => {
  const bytes = readFileSync('references/http-warnings.md');  // raw bytes, no BOM strip
  const hash = createHash('sha256').update(bytes).digest('hex');
  // PINNED-HASH below: regenerate by running `node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/http-warnings.md')).digest('hex'))"`
  // after every intentional edit. The PR diff makes the change visible.
  const PINNED = '2ff637adb29ce2a34442ddb7472e6ad6485200717275415f022e427f00dc72e9';
  assert.equal(hash, PINNED, `references/http-warnings.md drifted from locked copy. Update PINNED to ${hash} if the edit was intentional.`);
});

// Coarse-grained content sentinel — catches gross removals even before the
// hash pin gets a chance to re-fire (e.g., file wiped to empty).
test('references/doctor-output.md retains the 7 Phase-2 probe section anchors', () => {
  const copy = read('references/doctor-output.md');
  assert.match(copy, /# Doctor Output Strings \(locked — D-18\)/);
  assert.match(copy, /node-version \(DOCT-01\)/);
  assert.match(copy, /mcp-sdk-presence \(DOCT-01 wiring\)/);
  assert.match(copy, /contact-email-presence \(DOCT-03\)/);
  assert.match(copy, /sync-folder-detection \(DOCT-04\)/);
  assert.match(copy, /runtime-config-presence \(DOCT-07\)/);
  assert.match(copy, /zotero-mcp-presence \(DOCT-02 ecosystem\)/);
  assert.match(copy, /pandoc-presence \(DOCT-02 ecosystem\)/);
  assert.match(copy, /humanizer-skill-presence \(DOCT-02 ecosystem\)/);
  // NOTE: Anti-drift assertion for DOCT-05 REMOVED in Phase 3 Plan 00 Task 0.3.
  // DOCT-05 wiring-smoke is a Phase 3 carry-forward per D-04 — it WILL appear in Phase 3.
  // DO NOT re-add: assert.equal(/wiring-smoke|DOCT-05/.test(copy), false, ...)
});

// === Phase 3 Plan 00 Task 0.3: Active fixture hash-pins (D-01, SC-2, SC-3) ===
// These 3 files are created in Wave 0 and their content is LOCKED.
// ANY change to these files MUST be paired with a hash-pin update here.

test('tests/fixtures/assignment.txt hash-pin (D-01)', () => {
  const bytes = readFileSync('tests/fixtures/assignment.txt');
  const hash = createHash('sha256').update(bytes).digest('hex');
  // Regenerate: node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('tests/fixtures/assignment.txt')).digest('hex'))"
  const PINNED = '2a4043c907e52cc6151879504d9b1e7980747861705b483fc59b7bddf248cac7';
  assert.equal(hash, PINNED, `tests/fixtures/assignment.txt drifted from locked copy (D-01). Update PINNED to ${hash} if the edit was intentional.`);
});

test('tests/fixtures/known-bad-citations.json hash-pin (SC-2)', () => {
  const bytes = readFileSync('tests/fixtures/known-bad-citations.json');
  const hash = createHash('sha256').update(bytes).digest('hex');
  // Regenerate: node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('tests/fixtures/known-bad-citations.json')).digest('hex'))"
  const PINNED = '1463e10c57dec4bebfa7a85b8a383250c77d46120c5c3371832d47d9b7907d1e';
  assert.equal(hash, PINNED, `tests/fixtures/known-bad-citations.json drifted from locked copy (SC-2). Update PINNED to ${hash} if the edit was intentional.`);
});

test('tests/fixtures/known-bad-quotes.json hash-pin (SC-3)', () => {
  const bytes = readFileSync('tests/fixtures/known-bad-quotes.json');
  const hash = createHash('sha256').update(bytes).digest('hex');
  // Regenerate: node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('tests/fixtures/known-bad-quotes.json')).digest('hex'))"
  const PINNED = '46dba633e41b381dc1bc5fb5534020d57ed48668210812e6bdf99a74850b1fa6';
  assert.equal(hash, PINNED, `tests/fixtures/known-bad-quotes.json drifted from locked copy (SC-3). Update PINNED to ${hash} if the edit was intentional.`);
});

// === WN-3 LOCKED hash-pin sentinels (REVIEWS CONVERGENCE: per-slug literals) ===
// These 9 PINNED values are per-slug `__PENDING_HASH_<slug>__` literals
// (NOT a single global '__PENDING__') until Plan 09 Task 9.X replaces them
// with real SHA-256 in ONE atomic commit. Per-slug literals let
// prompt-loader.ts pattern-match the exact slug needing replacement and
// emit a precise "Plan 09 must repin prompt: section-drafter" error
// (rather than the ambiguous "some __PENDING__ remains").
//
// Plans 05 and 07 MUST NOT touch this block. Single source of truth for
// the prompt slugs is bin/lib/prompt-loader.ts EXPECTED_PROMPT_HASHES
// (Plan 07) — the keys here MUST match that map. Drift between this file
// and prompt-loader.ts is structurally impossible because Plan 07
// refactors this block to import EXPECTED_PROMPT_HASHES and loop over it
// (D-12 LOCKED).
//
// Env gate: PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 lets prompt-loader.ts
// run with sentinels in place during Plans 05-08 (gated CI). Plan 09's
// pre-pin step asserts this env is UNSET so the hash mismatch surfaces.
export const PENDING_HASH_PINS: ReadonlyArray<{ slug: string; path: string; decision: string }> = [
  // CYCLE-4 M-1 REVIEWS CONVERGENCE — `export` keyword present so Plan 09 Task 9.X
  // dynamic-imports this array (not undefined); single source of truth for the 9 hash-pin slugs.
  { slug: 'intake-clarifier',    path: 'templates/prompts/intake-clarifier.md',    decision: 'D-12' },
  { slug: 'topic-disambiguator', path: 'templates/prompts/topic-disambiguator.md', decision: 'D-12' },
  { slug: 'source-evaluator',    path: 'templates/prompts/source-evaluator.md',    decision: 'D-12' },
  { slug: 'outline-author',      path: 'templates/prompts/outline-author.md',      decision: 'D-12' },
  { slug: 'section-planner',     path: 'templates/prompts/section-planner.md',     decision: 'D-12' },
  { slug: 'section-drafter',     path: 'templates/prompts/section-drafter.md',     decision: 'D-12' },
  { slug: 'pass1-fuzzy-judge',   path: 'templates/prompts/pass1-fuzzy-judge.md',   decision: 'D-12 + D-13 DORMANT in Phase 3' },
  { slug: 'pass3-quote-checker', path: 'templates/prompts/pass3-quote-checker.md', decision: 'D-12 + D-13 DORMANT in Phase 3' },
  { slug: 'apa-csl',             path: 'templates/citation-styles/apa.csl',        decision: 'D-22 (different chokepoint)' },
];
for (const pin of PENDING_HASH_PINS) {
  const PINNED = `__PENDING_HASH_${pin.slug}__`;  // Plan 09 single re-pin task replaces atomically
  const isSentinel = PINNED.startsWith('__PENDING_HASH_') && PINNED.endsWith('__');
  test(`hash-pin sentinel: ${pin.path} (${pin.decision})`, { skip: isSentinel }, () => {
    const bytes = readFileSync(pin.path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, PINNED, `${pin.path} drifted. Plan 09 re-pin task must update.`);
  });
}

// Guard: each sentinel pin file MUST exist by the time Plan 09 runs.
// At Wave 0, the files don't exist yet — so this assertion is skip-guarded on file existence.
// When Plan 05 lands them, these tests become real assertions.
// Plan 09 re-pin task replaces the __PENDING_HASH_<slug>__ sentinels with real SHA-256.
for (const pin of PENDING_HASH_PINS) {
  test(`hash-pin file exists: ${pin.path}`, { skip: !fs.existsSync(pin.path) }, () => {
    assert.ok(fs.existsSync(pin.path), `MISSING: ${pin.path} — Plan 05 must create before Plan 09 re-pin`);
  });
}

// CF-D24: Guard the D-24-locked "Tier contract — do not skip" section in CONTRIBUTING.md.
// If a future contributor (human or AI) deletes or rewords the section, this test catches
// it before merge. The Phase 2 D-24 lock makes this section non-negotiable.
test('CF-D24: CONTRIBUTING.md has Tier contract — do not skip section with locked headings', () => {
  const src = readFileSync('CONTRIBUTING.md', 'utf8');
  const required = [
    '## Tier contract — do not skip',
    '### What the tier contract guarantees',
    '### The four merge-gate layers',
    '### Wave 1 lint chokepoints',
    '### Discipline rule',
  ];
  for (const heading of required) {
    assert.ok(
      src.includes(heading),
      `CONTRIBUTING.md missing locked heading: "${heading}". This section is D-24-locked; do not delete.`,
    );
  }
  // Each Wave 1 chokepoint must be named:
  assert.match(src, /D-09.*thin-shim/s, 'D-09 thin-shim must be named');
  assert.match(src, /D-10.*mcp-no-network|mcp-no-network.*D-10/s, 'D-10 mcp-no-network must be named');
  assert.match(src, /D-12.*capabilities-no-leak|capabilities-no-leak.*D-12/s, 'D-12 capabilities-no-leak must be named');
  // The four merge-gate layers must be named:
  assert.match(src, /CI step/, 'merge-gate layer 1 (CI step) must be named');
  assert.match(src, /branch protection/i, 'merge-gate layer 2 (branch protection) must be named');
  assert.match(src, /preflight|validate-plugin-manifest/i, 'merge-gate layer 3 (preflight) must be named');
  assert.match(src, /prose|this section/i, 'merge-gate layer 4 (prose) must be named');
  // Phase 0 chokepoints section preserved:
  assert.match(src, /Architectural chokepoints \(Phase 0\+\)/, 'Phase 0 chokepoints section must be preserved');
});
