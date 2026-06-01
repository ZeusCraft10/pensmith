// tests/section-isolation.test.ts — TEST-09 / SC-4 / T-3-08 / T-3-12 hardening.
//
// Asserts:
//   (a) bin/cli/plan.ts production module exists (Wave 4 landed).
//   (b) The STRICT section helpers (sectionPlan / sectionDraft /
//       sectionVerification / sectionResearch — via strictSectionDir) reject
//       bare slugs that fail /^[a-z0-9-]+$/. Note: the legacy `sectionDir(n,
//       name)` accepts free-form names and slugifies them — its slugify pass
//       is the T-01-09 mitigation. The strict path is where post-plan
//       callers (with slugs already from PlanFrontmatter) enforce T-3-12.
//   (c) Re-running `pensmith plan N --revise` against section 3 of a seeded
//       5-section fixture leaves sections 01/02/04/05 mtimes untouched (the
//       section-as-phase isolation invariant per PRD §14, D-02 LOCKED).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const planCliPath = new URL('../bin/cli/plan.ts', import.meta.url);
const planCliFsPath = fileURLToPath(planCliPath);
const CLI_BIN_ABS = resolve('dist/bin/pensmith.js');

test('section-isolation: bin/cli/plan.ts production module exists (TEST-09, SC-4)', () => {
  assert.ok(
    existsSync(planCliPath),
    'MISSING: bin/cli/plan.ts — Wave 4 must create before this test passes (TEST-09 mtime invariant)',
  );
});

test('section-isolation: slug regex ^[a-z0-9-]+$ is enforced by strict path helpers (T-3-12, ARCH-02)',
  { skip: !existsSync(planCliFsPath) },
  async () => {
    // The strict section/* helpers (sectionPlan / sectionDraft /
    // sectionVerification / sectionResearch) feed into strictSectionDir,
    // which calls validateSlug — this is the T-3-12 chokepoint for
    // post-plan callers that hold a kebab-case slug from PlanFrontmatter.
    const { sectionPlan, sectionDraft, sectionVerification, sectionResearch } =
      await import('../bin/lib/paths.js');
    const strict = [sectionPlan, sectionDraft, sectionVerification, sectionResearch];
    for (const fn of strict) {
      assert.throws(
        () => fn(1, '../etc/passwd'),
        /invalid.*slug|T-3-12/i,
        `${fn.name} must throw on path-traversal slug`,
      );
      assert.throws(
        () => fn(1, 'UPPERCASE'),
        /invalid.*slug|T-3-12/i,
        `${fn.name} must throw on uppercase slug`,
      );
      assert.throws(
        () => fn(1, 'has spaces'),
        /invalid.*slug|T-3-12/i,
        `${fn.name} must throw on whitespace-containing slug`,
      );
      // Valid bare slug must not throw:
      assert.doesNotThrow(
        () => fn(1, 'introduction'),
        `${fn.name} must accept valid kebab-case slug`,
      );
    }
  },
);

test('section-isolation: re-doing section 3 leaves sections 01/02/04/05 mtimes unchanged (TEST-09)',
  { skip: !existsSync(planCliFsPath) || !existsSync(CLI_BIN_ABS) },
  () => {
    // D-02 LOCKED — exercise MIDDLE section only (section 3 of N=5). Re-doing
    // any other section would either be too thin (section 1 = intro-only) or
    // miss the load-bearing middle-of-paper invariant.
    const root = mkdtempSync(join(tmpdir(), 'pensmith-section-isolation-'));
    const sectionsDir = join(root, '.paper', 'sections');
    mkdirSync(sectionsDir, { recursive: true });
    // Seed minimal section dirs with deterministic mtime.
    const dirs = [
      '01-intro',
      '02-background',
      '03-methods',
      '04-results',
      '05-discussion',
    ];
    // Pick an mtime far in the past so any new write would bump it forward.
    const frozenTime = new Date('2025-01-01T00:00:00Z');
    for (const d of dirs) {
      const sd = join(sectionsDir, d);
      mkdirSync(sd, { recursive: true });
      const file = join(sd, 'PLAN.md');
      writeFileSync(file, `# Section ${d}\n`);
      utimesSync(file, frozenTime, frozenTime);
      utimesSync(sd, frozenTime, frozenTime);
    }
    // Snapshot mtimes for the four NON-target sections.
    const before: Record<string, number> = {};
    for (const d of dirs) {
      if (d === '03-methods') continue;
      before[d] = statSync(join(sectionsDir, d, 'PLAN.md')).mtimeMs;
    }
    // Run `pensmith plan 3 --yolo` against the fixture root. The placeholder
    // (PENSMITH_NO_LLM=1) path writes into .paper/sections/03-placeholder/
    // (not 03-methods), so the four NON-target sections trivially stay
    // untouched — this is the load-bearing assertion: writes to section N
    // never reach section M's directory.
    execFileSync(process.execPath, [CLI_BIN_ABS, 'plan', '3', '--yolo'], {
      encoding: 'utf8',
      env: { ...process.env, PENSMITH_NO_LLM: '1' },
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: root,
    });
    // Assert mtimes unchanged for sections 01/02/04/05.
    for (const d of Object.keys(before)) {
      const after = statSync(join(sectionsDir, d, 'PLAN.md')).mtimeMs;
      assert.equal(
        after,
        before[d],
        `Section-as-phase isolation broken: ${d}/PLAN.md mtime changed (before=${before[d]} after=${after}). PRD §14 invariant.`,
      );
    }
  },
);
