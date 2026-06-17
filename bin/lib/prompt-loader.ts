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
// D-12 LOCKED slugs — the 8 Phase-3 keys below were the original prompt slug
// set. Phase 4 04-CONTEXT.md D-05 (revise-swap) and D-12 (smoother) EXPLICITLY
// authorize two NEW hash-pinned prompt slugs, superseding the "8 LOCKED slugs"
// wording. The canonical set is now whatever EXPECTED_PROMPT_HASHES enumerates;
// adding/removing/renaming a slug still requires re-locking D-12 in CONTEXT.md.
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
 * D-12 LOCKED — the keys here are the canonical prompt slug set. Phase 4
 * 04-CONTEXT.md D-05/D-12 add `revise-swap` (and later `smoother`) to this set.
 * D-13 LOCKED — pass1-fuzzy-judge + pass3-quote-checker DORMANT in Phase 3.
 *
 * WN-3 — values are `__PENDING_HASH_<slug>__` until Plan 03-09's single
 * re-pin commit replaces them with real SHA-256s. Set
 * PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 to bypass the drift check while
 * sentinels are in place (CI sets this during Waves 1-7).
 */
export const EXPECTED_PROMPT_HASHES: Record<string, string> = {
  // WN-3 sentinel-replacement (Plan 03-09 Task 9.3.5) — these 8 SHA-256
  // values replace the per-slug __PENDING_HASH_<slug>__ sentinels in a single
  // atomic commit (sentinel-replacement). The same commit updates the matching
  // pins in tests/repo-files.test.ts PENDING_HASH_PINS — drift between the two
  // surfaces is structurally impossible because both files re-pin together.
  'intake-clarifier':    'bc93c546f5853196379c8958b1d8895b3cc3d0c2aabef94858e48638e181ba94',  // D-12 LOCKED
  'topic-disambiguator': '165e533fa1119ffca44a4876212679207d65501d7b71d0b9ed9de123df84b96e',  // D-12 LOCKED (research split #1)
  'source-evaluator':    '45488935a0bd44f08b4077978c66767f369b7fb4e72696ef5d17b5c6c453c762',  // D-12 LOCKED (research split #2)
  'outline-author':      'f5124245f29c71de31ed2c330097d2141bba80c04d8a2d2cef955e0669068f42',  // D-12 LOCKED
  'section-planner':     'e2991033be0f7e0b28a20ffc0bfa03355e999daf445070b709077c310d5ee5b5',  // D-12 LOCKED
  'section-drafter':     'baf0172b4e2e96a2d2a1a6c35b5cf548faafd9436f1405e863060c619caa1d34',  // D-12 LOCKED
  'pass1-fuzzy-judge':   'da4956f0bbc24197739f8bfa75dcf4c29c6dac905dd33ba7c5ea94c48902149e',  // D-12 LOCKED + D-13 DORMANT in Phase 3
  'pass3-quote-checker': '8eb5d17d27add7afebeab77f960656229411710baf8ef243a0f9952282e5bfd9',  // D-12 LOCKED + D-13 DORMANT in Phase 3
  // Phase 4 04-CONTEXT.md D-05 — new hash-pinned revise-swap prompt. Lands as a
  // __PENDING_HASH_revise-swap__ sentinel in Task 1 (prompt body not yet
  // byte-stable); Task 3 re-pins the real SHA-256 in the SAME commit that
  // updates tests/repo-files.test.ts PENDING_HASH_PINS (WN-3 lockstep).
  'revise-swap':         '__PENDING_HASH_revise-swap__',  // Phase 4 D-05 (re-pinned in Task 3)
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
