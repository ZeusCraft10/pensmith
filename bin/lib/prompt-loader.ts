// bin/lib/prompt-loader.ts — hash-validated prompt loader (T-3-09).
//
// SOLE call site for `readFileSync('templates/prompts/<slug>.md')` in the
// runtime path. Every verb that invokes an LLM prompt (intake, research,
// outline, plan, write) calls `loadPrompt(slug)` then `interpolate(body, vars)`.
//
// Defense-in-depth:
//   - PR-time: tests/repo-files.test.ts asserts each prompt SHA-256 matches
//     a pinned hash. Drift surfaces in PR review.
//   - Runtime: this loader re-validates the SHA-256 against EXPECTED_PROMPT_HASHES
//     at every call site. So a post-PR mutation (e.g. a misbehaving build
//     step that rewrites a prompt) is also caught — there is no race window
//     between PR review and execution.
//
// D-12 LOCKED slugs — the 8 keys below ARE the prompt slug set. Any drift
// (adding/removing/renaming a slug) requires re-locking D-12 in CONTEXT.md.
//
// D-13 LOCKED: pass1-fuzzy-judge + pass3-quote-checker are DORMANT in Phase 3.
// The files exist and are hash-pinned (so the calibration artifact does not
// drift before Phase 8), but workflows/verify.md MUST NOT invoke
// loadPrompt('pass1-fuzzy-judge') or loadPrompt('pass3-quote-checker') at
// runtime. The Phase-3 verify path is 100% deterministic; these pins are
// safety nets for the Phase-8 tie-break path.
//
// WN-3 + REVIEWS CONVERGENCE — sentinel-then-real workflow:
//   Plan 03-05 lands the prompt files with `__PENDING_HASH_<slug>__`
//   sentinel strings in the hash map. Plan 03-09 replaces them atomically
//   with real SHA-256 values once all 8 prompt files are byte-stable.
//   While sentinels are in place, set PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1
//   to bypass the runtime drift error (CI sets this during Waves 1-7).
//
// `tests/repo-files.test.ts` imports `EXPECTED_PROMPT_HASHES` from this
// module so the test pins and the runtime pins are GUARANTEED in lockstep
// (single source of truth — WN-3).

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Locate the repo's templates/ dir relative to THIS module.
// Same shape as bin/lib/citations.ts findPkgRoot — walk up from here until
// we find package.json. This makes the loader robust under both `tsx` (where
// the source lives at bin/lib/prompt-loader.ts) and the compiled dist build
// (where it lives at dist/bin/lib/prompt-loader.js).
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      // statSync via require/readFileSync indirection avoids importing
      // node:fs/promises here; we only need the sync presence check.
      const probe = path.join(cur, 'package.json');
      readFileSync(probe);
      return cur;
    } catch {
      // continue upward
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return start;
}

const PKG_ROOT = findPkgRoot(__dirname);

/**
 * SHA-256 hashes for each `templates/prompts/<slug>.md` file.
 *
 * MUST match the pins in `tests/repo-files.test.ts` — that test imports
 * this map (single source of truth — WN-3) so drift between the runtime
 * pins and the PR-time pins is STRUCTURALLY impossible.
 *
 * D-12 LOCKED — the 8 keys here are the canonical prompt slug set.
 * D-13 LOCKED — pass1-fuzzy-judge + pass3-quote-checker DORMANT in Phase 3.
 *
 * WN-3 — values are `__PENDING_HASH_<slug>__` until Plan 03-09's single
 * re-pin commit replaces them with real SHA-256s. Set
 * PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 to bypass the drift check while
 * sentinels are in place (CI sets this during Waves 1-7).
 */
export const EXPECTED_PROMPT_HASHES: Record<string, string> = {
  'intake-clarifier':    '__PENDING_HASH_intake-clarifier__',     // D-12 LOCKED
  'topic-disambiguator': '__PENDING_HASH_topic-disambiguator__',  // D-12 LOCKED (research split #1)
  'source-evaluator':    '__PENDING_HASH_source-evaluator__',     // D-12 LOCKED (research split #2)
  'outline-author':      '__PENDING_HASH_outline-author__',       // D-12 LOCKED
  'section-planner':     '__PENDING_HASH_section-planner__',      // D-12 LOCKED
  'section-drafter':     '__PENDING_HASH_section-drafter__',      // D-12 LOCKED
  'pass1-fuzzy-judge':   '__PENDING_HASH_pass1-fuzzy-judge__',    // D-12 LOCKED + D-13 DORMANT in Phase 3
  'pass3-quote-checker': '__PENDING_HASH_pass3-quote-checker__',  // D-12 LOCKED + D-13 DORMANT in Phase 3
};

/**
 * Strip a leading YAML frontmatter block from a prompt body.
 *
 * Frontmatter convention: opening `---` on the first line, closing `---`
 * on its own line. The body returned is the substring AFTER the closing
 * fence (with leading whitespace trimmed). If no frontmatter is present
 * the original text is returned unchanged.
 */
function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const parts = text.split(/^---\s*$/m);
  // parts[0] === '' (before the opening ---), parts[1] === yaml block,
  // parts.slice(2).join('---') reconstructs the body in case the prompt
  // contains a literal '---' separator (a common Markdown idiom).
  if (parts.length < 3) return text;
  return parts.slice(2).join('---').trimStart();
}

/**
 * Load a prompt by slug, hash-validate, and return the body (frontmatter stripped).
 *
 * @param name canonical prompt slug — must be a key of EXPECTED_PROMPT_HASHES
 * @throws Error if the slug is unknown (no pin registered) or the on-disk
 *   bytes do not match the pinned hash. The error message names the file
 *   AND the EXPECTED_PROMPT_HASHES map so the fix path is unambiguous.
 *
 * Phase-3 special case: when the pinned value is a `__PENDING_HASH_<slug>__`
 * sentinel, the loader bypasses hash validation only if
 * `PENSMITH_ALLOW_PENDING_PROMPT_HASHES === '1'`. CI sets this env during
 * Waves 1-7; Plan 03-09 unsets it after re-pinning, restoring runtime drift
 * detection.
 */
export function loadPrompt(name: string): string {
  const expected = EXPECTED_PROMPT_HASHES[name];
  if (!expected) {
    throw new Error(
      `loadPrompt: unknown prompt "${name}" — no entry in EXPECTED_PROMPT_HASHES. ` +
      `If this is a new slug, add it to bin/lib/prompt-loader.ts (D-12 LOCKED).`,
    );
  }

  const promptPath = path.join(PKG_ROOT, 'templates', 'prompts', `${name}.md`);
  const bytes = readFileSync(promptPath);
  const actual = createHash('sha256').update(bytes).digest('hex');
  const text = bytes.toString('utf8');

  // WN-3 sentinel-bypass — Plan 03-09 replaces these atomically.
  if (expected.startsWith('__PENDING_HASH_')) {
    if (process.env['PENSMITH_ALLOW_PENDING_PROMPT_HASHES'] !== '1') {
      throw new Error(
        `loadPrompt: prompt "${name}" hash is a __PENDING_HASH_${name}__ sentinel. ` +
        `Set PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 to bypass (Wave 1-7 only); ` +
        `Plan 03-09 will replace all sentinels with real SHA-256 values.`,
      );
    }
    return stripFrontmatter(text);
  }

  if (actual !== expected) {
    throw new Error(
      `loadPrompt: prompt "${name}" drifted at runtime. ` +
      `Expected SHA-256 ${expected}, got ${actual}. ` +
      `Update EXPECTED_PROMPT_HASHES in bin/lib/prompt-loader.ts (single source of ` +
      `truth — tests/repo-files.test.ts imports this map per WN-3) together (D-12). ` +
      `Note: pass1-fuzzy-judge + pass3-quote-checker are D-13 DORMANT in Phase 3 — ` +
      `if you are seeing this error for one of those slugs at runtime in Phase 3, ` +
      `the workflow body is incorrectly invoking a dormant prompt.`,
    );
  }

  return stripFrontmatter(text);
}

/**
 * Interpolate `{{varname}}` placeholders in a template.
 *
 * THROWS if any `{{ }}` placeholder lacks a corresponding key in `vars` —
 * catches typos at runtime (a missed substitution would otherwise reach the
 * model verbatim and confuse it).
 *
 * @example
 * interpolate("Hello {{name}}!", { name: "world" }) // → "Hello world!"
 * interpolate("Hello {{name}}!", {})                 // → throws
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`interpolate: missing var "${key}" — template references {{${key}}} but vars has keys [${Object.keys(vars).join(', ')}]`);
    }
    return vars[key] ?? '';
  });
}
