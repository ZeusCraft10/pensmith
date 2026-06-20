// tests/lint-tutorial-no-branch.test.ts — Phase 9 ZERO-BRANCH INVARIANT (H1).
//
// THE load-bearing structural gate for educator/tutorial mode: NO component in
// Foundation may become goal-aware. The TutorialSubscriber (bin/lib/tutorial.ts)
// is the SOLE goal-aware seam; every other bin/lib/**/*.ts file — router.ts
// INCLUDED, NO exclusion — and every workflows/**/*.md file must contain ZERO
// references to the educator-mode vocabulary.
//
// This test is NOT skip-guarded. It PASSES NOW on the clean tree (router.ts has
// zero `goal` tokens) and must KEEP passing through Waves 1-2 — a planner who
// adds `if (goal === 'learning')` ANYWHERE outside tutorial.ts fails it.
//
// AUTHORITATIVE PATTERN — matches the BARE token, not just the `=== 'learning'`
// literal, so it defeats: `goal === 'x'`, `goal !== 'draft'`, `switch (goal)`,
// `isLearningGoal(...)`, a `const g = goal` hoist, helper-extraction, and an
// `educator_mode` config read. Because it matches the bare word, a clever
// rename can't slip past it.
//
// COMMENT-STRIP (mirrors lint-chokepoint's intent): a `// goal-aware` doc
// comment or markdown prose mentioning "the learning goal" must NOT self-
// invalidate the gate. We strip line comments (`//…`), block-comment body lines
// (`*…`), and — for markdown — fenced-code is KEPT (code is exactly where a
// forbidden token would hide) while prose lines are scanned too BUT the pattern
// is deliberately CODE-shaped enough that ordinary docs rarely trip it; to be
// safe we strip HTML/markdown comments and leading-`>` blockquote prose. The
// forbidden tokens must be matched in CODE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

const BIN_LIB = repoPath('bin/lib');
const WORKFLOWS = repoPath('workflows');

// Only this ONE file is allowed to be goal-aware.
const TUTORIAL_FILE = join(BIN_LIB, 'tutorial.ts');

// ONE canonical pattern, CASE-INSENSITIVE. The `i` flag is what defeats
// helper-extraction / camelCase dodges: `isLearningGoal`, `LEARNING_MODE`, a
// `Goal` type — the bare lowercase-bounded token alone would miss those. We
// list `educator_mode` explicitly (no \b at the underscore) alongside the
// bounded tokens. Comment-stripping (below) prevents doc false positives, so
// case-insensitivity only ever fires on real code.
const FORBIDDEN =
  /(educator_mode|TutorialSubscriber|\bgoal|learning|educator)/i;

/** Recursively collect files under `dir` whose name ends with `ext`. */
function walk(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comment lines so a doc comment cannot self-invalidate the gate. For .ts:
 * drop `//…` lines and block-comment body lines (`*…`). For .md: drop HTML
 * comments (`<!-- … -->`) and leading-`>` blockquote prose lines. What remains
 * is the CODE (or, for markdown, the directive/template body) that a forbidden
 * token would actually live in.
 */
function stripComments(src: string, ext: string): string {
  const lines = src.split(/\r?\n/);
  const kept: string[] = [];
  let inBlockComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (ext === '.ts') {
      if (inBlockComment) {
        if (trimmed.includes('*/')) inBlockComment = false;
        continue;
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlockComment = true;
        continue;
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      // strip trailing line comments
      kept.push(line.replace(/\/\/.*$/, ''));
    } else {
      // markdown: drop full-line HTML comments and blockquote prose lines
      if (trimmed.startsWith('<!--') || trimmed.startsWith('>')) continue;
      kept.push(line);
    }
  }
  return kept.join('\n');
}

test('zero-branch invariant: NO bin/lib/**/*.ts (router.ts INCLUDED) references educator-mode vocabulary outside tutorial.ts', () => {
  const files = walk(BIN_LIB, '.ts').filter((f) => f !== TUTORIAL_FILE);
  assert.ok(files.length > 0, 'expected to scan ≥1 bin/lib/**/*.ts file');
  // Sanity: router.ts MUST be in scope (no exclusion) — the H1 fix keeps it
  // goal-unaware and this gate proves it stays that way.
  const routerPath = join(BIN_LIB, 'router.ts');
  assert.ok(files.includes(routerPath), 'router.ts must be scanned (no router exclusion)');

  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'), '.ts');
    const m = FORBIDDEN.exec(code);
    assert.equal(
      m,
      null,
      `${file} references educator-mode vocabulary "${m?.[0]}" in CODE — only bin/lib/tutorial.ts may be goal-aware (H1 zero-branch invariant).`,
    );
  }
});

test('zero-branch invariant: NO workflows/**/*.md references educator-mode vocabulary', () => {
  const files = walk(WORKFLOWS, '.md');
  assert.ok(files.length > 0, 'expected to scan ≥1 workflows/**/*.md file');
  for (const file of files) {
    const body = stripComments(readFileSync(file, 'utf8'), '.md');
    const m = FORBIDDEN.exec(body);
    assert.equal(
      m,
      null,
      `${file} references educator-mode vocabulary "${m?.[0]}" — workflows must stay goal-unaware (H1 zero-branch invariant).`,
    );
  }
});

// Self-test: the FORBIDDEN pattern actually fires on a representative goal-aware
// snippet (so the gate can't silently rot to a no-op).
test('zero-branch invariant: pattern fires on representative goal-aware code (anti-rot)', () => {
  for (const probe of [
    "if (goal === 'learning') render();",
    "if (goal !== 'draft') {}",
    'switch (goal) { default: }',
    'const x = config.educator_mode;',
    'new TutorialSubscriber({})',
    'function isLearningGoal() {}',
  ]) {
    assert.ok(FORBIDDEN.test(probe), `pattern must match goal-aware snippet: ${probe}`);
  }
});
