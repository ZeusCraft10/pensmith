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
  const PINNED = '509f90add8664e559a3ab817684381777e1b624b63ebe0dfc77054267997eec0';
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
test('references/doctor-output.md retains all probe section anchors (Phase 2 + Phase 3)', () => {
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
  // Phase 2 probes added in 02-05:
  assert.match(copy, /build-artifact-resolves/);
  assert.match(copy, /http-crossref-ping/);
  // Phase 3 Plan 03-09 Task 9.1: real DOCT-05 wiring-smoke anchor.
  // The original "anti-drift block" that asserted DOCT-05 absence has been
  // intentionally REMOVED — the probe is live now (intake-outline-verify-wiring).
  assert.match(copy, /intake-outline-verify-wiring \(DOCT-05\)/);
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

// === WN-3 LOCKED hash-pins — Plan 03-09 Task 9.3.5 sentinel-replacement ===
//
// The 9 PINNED entries below were per-slug `__PENDING_HASH_<slug>__` sentinels
// during Waves 1-7. Plan 09 Task 9.3.5 replaces them ATOMICALLY with the real
// SHA-256 of the matching file (sentinel-replacement). The same atomic commit
// updates bin/lib/prompt-loader.ts EXPECTED_PROMPT_HASHES — drift between
// the two surfaces is structurally impossible because both files re-pin in
// the same commit (D-12 LOCKED).
//
// Regeneration: if a prompt body is INTENTIONALLY edited, recompute the
// hash with
//   node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('<path>')).digest('hex'))"
// and update BOTH this file AND bin/lib/prompt-loader.ts in the same commit.
//
// Env gate: PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 was the Waves-1-7 bypass;
// it has no effect now that real hashes are pinned. The test suite still
// honors the env to keep historical CI commits replayable.
export const PENDING_HASH_PINS: ReadonlyArray<{ slug: string; path: string; decision: string; hash: string }> = [
  // CYCLE-4 M-1 REVIEWS CONVERGENCE — `export` keyword present so Plan 09 Task 9.3.5
  // dynamic-imports this array (not undefined); single source of truth for the 9 hash-pin slugs.
  { slug: 'intake-clarifier',    path: 'templates/prompts/intake-clarifier.md',    decision: 'D-12', hash: 'bc93c546f5853196379c8958b1d8895b3cc3d0c2aabef94858e48638e181ba94' },
  { slug: 'topic-disambiguator', path: 'templates/prompts/topic-disambiguator.md', decision: 'D-12', hash: '165e533fa1119ffca44a4876212679207d65501d7b71d0b9ed9de123df84b96e' },
  { slug: 'source-evaluator',    path: 'templates/prompts/source-evaluator.md',    decision: 'D-12', hash: '45488935a0bd44f08b4077978c66767f369b7fb4e72696ef5d17b5c6c453c762' },
  { slug: 'outline-author',      path: 'templates/prompts/outline-author.md',      decision: 'D-12', hash: 'f5124245f29c71de31ed2c330097d2141bba80c04d8a2d2cef955e0669068f42' },
  { slug: 'section-planner',     path: 'templates/prompts/section-planner.md',     decision: 'D-12', hash: 'e2991033be0f7e0b28a20ffc0bfa03355e999daf445070b709077c310d5ee5b5' },
  { slug: 'section-drafter',     path: 'templates/prompts/section-drafter.md',     decision: 'D-12', hash: 'baf0172b4e2e96a2d2a1a6c35b5cf548faafd9436f1405e863060c619caa1d34' },
  { slug: 'pass1-fuzzy-judge',   path: 'templates/prompts/pass1-fuzzy-judge.md',   decision: 'D-12 + D-13 DORMANT in Phase 3', hash: 'da4956f0bbc24197739f8bfa75dcf4c29c6dac905dd33ba7c5ea94c48902149e' },
  { slug: 'pass3-quote-checker', path: 'templates/prompts/pass3-quote-checker.md', decision: 'D-12 + D-13 DORMANT in Phase 3', hash: '8eb5d17d27add7afebeab77f960656229411710baf8ef243a0f9952282e5bfd9' },
  { slug: 'apa-csl',             path: 'templates/citation-styles/apa.csl',        decision: 'D-22 (different chokepoint)',    hash: '249341f13df5cff992efdc71e12b9888678f8e4ad69e17fe12bd2c5245681094' },
  // Phase 4 04-CONTEXT.md D-05 — new revise-swap prompt. The byte-pin below is
  // GREEN from Task 1 (the file is byte-stable). bin/lib/prompt-loader.ts holds
  // a __PENDING_HASH_revise-swap__ sentinel until Plan 04-04 Task 3 re-pins the
  // SAME real SHA-256 there (WN-3 lockstep — both surfaces then agree).
  { slug: 'revise-swap',         path: 'templates/prompts/revise-swap.md',         decision: 'Phase 4 D-05',                   hash: '835876ccd55b713b5ebb41dde741fce88fccdc67f208fe2fe20720dc9dc2c3ef' },
  // Phase 4 04-CONTEXT.md D-12 — new smoother prompt (Plan 04-05). The byte-pin
  // below is GREEN from Task 1a (the file is byte-stable). bin/lib/prompt-loader.ts
  // holds a __PENDING_HASH_smoother__ sentinel until Plan 04-05 Task 4 re-pins the
  // SAME real SHA-256 there (WN-3 lockstep — both surfaces then agree).
  { slug: 'smoother',            path: 'templates/prompts/smoother.md',            decision: 'Phase 4 D-12',                   hash: 'ee934f8eee89bf239a95bd8b3eebf04f7802eeb39b0cadb8510c5cddc49097f5' },
  // Phase 5 05-CONTEXT.md D-12 — new claim-support + orphan-label prompts (Plans
  // 05-02/05-03 advisory Pass 2/4). The byte-pins below are the REAL SHA-256 and are
  // GREEN from Wave 0 (Plan 05-01) the moment the prompt files are byte-stable.
  // bin/lib/prompt-loader.ts holds __PENDING_HASH_<slug>__ sentinels until Plan 05-05
  // re-pins the SAME real SHA-256 there (WN-3 lockstep — both surfaces then agree).
  { slug: 'claim-support',       path: 'templates/prompts/claim-support.md',       decision: 'Phase 5 D-12',                   hash: 'ceec7601dfeaf30117091aa788d9463c01b6ca9d3a9da4b47fb0f91983c82217' },
  { slug: 'orphan-label',        path: 'templates/prompts/orphan-label.md',        decision: 'Phase 5 D-12',                   hash: 'f8b385f3869691f4a419f35987d8b9a93018f28714519b36713fd7c2c0b829fc' },
];
for (const pin of PENDING_HASH_PINS) {
  test(`hash-pin: ${pin.path} (${pin.decision})`, () => {
    const bytes = readFileSync(pin.path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
      hash,
      pin.hash,
      `${pin.path} drifted from locked SHA-256. If the edit was intentional, update PENDING_HASH_PINS hash to ${hash} AND the matching entry in bin/lib/prompt-loader.ts EXPECTED_PROMPT_HASHES in the same commit (D-12 single-source rule).`,
    );
  });
}

// Guard: each pinned file MUST exist after Plan 09 sentinel-replacement.
for (const pin of PENDING_HASH_PINS) {
  test(`hash-pin file exists: ${pin.path}`, () => {
    assert.ok(fs.existsSync(pin.path), `MISSING: ${pin.path} — file removed after Plan 09 re-pin`);
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
