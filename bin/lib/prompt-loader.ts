// bin/lib/prompt-loader.ts — hash-validated prompt loader (T-3-09).
//
// SOLE call site for `readFileSync('plugin/templates/prompts/<slug>.md')` in
// the runtime path. A model request is built by bin/lib/prompt-request.ts
// `buildPromptRequest(slug, values)` (D-18-03): `loadPrompt(slug)` — the fixed
// template, byte-identical for every call and so the cacheable prefix (RUN-26)
// — is the system prompt, and the per-call data follows as tagged blocks in the
// user message. Templates interpolate nothing: no data is ever substituted
// into the instruction text, so user or source text can never become a
// template placeholder (the Phase 17 `interpolate()` helper is gone).
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
import { pluginTemplatePath } from './paths.js';

// The prompts live in the plugin's templates/prompts/ (PLUG-02). paths.ts
// pluginRoot() finds the plugin from this module's own location — the source
// tree under tsx, the tsc build in dist/, an npm install, or the plugin bundle
// — so the loader reads the same bytes in every layout (D-23a-03).

/**
 * SHA-256 hashes for each `plugin/templates/prompts/<slug>.md` file.
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
  'intake-clarifier':    '7700947abfc9a94d2785996fd7b26e8f812a5b01c77ab24ee1563314b7eb9a53',  // D-12 LOCKED (re-pinned Phase 18 GRND-02/RUN-26 — suggestions-only contract v2, fixed instructions first, data last in fenced blocks; WN-3 lockstep with repo-files pin)
  'topic-disambiguator': '34587e4f81be0e16848f7aa19bd176f050da2381cba31a1ea6b36c54816b1378',  // D-12 LOCKED (research split #1; re-pinned Phase 19 SRC-08: ambiguous flag, scope descriptions, 5-10 queries)
  'source-evaluator':    'b10cd38425ab01dd5572592dc01f11b646006dbd86b13be311f8b0eb9ca0eed4',  // D-12 LOCKED (research split #2; re-pinned Phase 19 SRC-09: relevance, tier, reasons)
  'outline-author':      '914bdd23f6182ac47b5679b45144a10ada702ab8e6eb3415db879063f7419c2a',  // D-12 LOCKED (re-pinned Phase 18 GRND-07/RUN-26: fixed instructions, data blocks brief/existing_sections/sources)
  'section-planner':     'd10b4513bec7bbce182e6fb8fe31b64bc5f5f1352dda498ee0b2414ad3f5f28c',  // D-12 LOCKED (re-pinned Phase 18 GRND-13/RUN-26: fixed instructions, data blocks brief/section/upstream/sources)
  'section-drafter':     '0600aed58e85b9182a5c3ea0e7e45a691d41a8e21797ed00559e7b56b08999cc',  // D-12 LOCKED (re-pinned Phase 18 FEED-02/RUN-26: fixed instructions, data blocks brief/section/voice/style_profile/plan/sources)
  'pass1-fuzzy-judge':   '80011728b81766a6bad092a6fae2868cd7e75515344c5e8ecb38b3cfac14498d',  // D-12 LOCKED + D-13 DORMANT in Phase 3
  'pass3-quote-checker': '19ef3929f85b0f20c4b0f12cea535cbb7c2e28a342c883f9af6737fd7e896421',  // D-12 LOCKED + D-13 DORMANT in Phase 3
  // Phase 4 04-CONTEXT.md D-05 — hash-pinned revise-swap prompt. Re-pinned to
  // the real SHA-256 in Plan 04-04 Task 3 (the prompt body is byte-stable). The
  // matching pin in tests/repo-files.test.ts PENDING_HASH_PINS carries the same
  // value (WN-3 lockstep — both surfaces agree). loadPrompt('revise-swap') now
  // succeeds WITHOUT PENSMITH_ALLOW_PENDING_PROMPT_HASHES.
  'revise-swap':         '2c604b215eaafcb49f4bd138ad64772b0e2f74e7255a5e2ea22e65719e54ff8d',  // Phase 4 D-05
  // Phase 4 04-CONTEXT.md D-12 — hash-pinned smoother prompt (Plan 04-05). Lands
  // here as a __PENDING_HASH_smoother__ sentinel at Task 1a (WN-3); Plan 04-05
  // Task 4 re-pins it to the SAME real SHA-256 the tests/repo-files.test.ts pin
  // already carries (the prompt body is byte-stable on creation — both surfaces
  // then agree and loadPrompt('smoother') succeeds WITHOUT the pending bypass).
  'smoother':            '37aa691f174c5fa75f9569c3c08bdc1a33eb64f503d04834e94d27d5938d9330',  // Phase 4 D-12 (re-pinned real at Plan 04-05 Task 4 — WN-3 lockstep with repo-files pin)
  // Phase 5 05-CONTEXT.md D-12 — hash-pinned claim-support + orphan-label prompts
  // (Plans 05-02/05-03). These are the ACTIVE Phase-5 advisory prompts: claim-support
  // is invoked from bin/lib/verify/pass2.ts (Pass 2 claim-support) and orphan-label
  // from bin/lib/verify/pass4.ts (Pass 4 Step-3 edge-case label) — NOT from
  // bin/cli/verify.ts (the D-13 chokepoint file is unaffected; verify.ts never loads
  // a prompt). pass1-fuzzy-judge + pass3-quote-checker remain D-13 DORMANT.
  // WN-3: they landed here as __PENDING_HASH_<slug>__ sentinels in Wave 0 (Plan 05-01)
  // BEFORE the pass modules existed, so the loader could resolve the slugs the moment
  // Plans 05-02/05-03 wired the LLM seams. Plan 05-05 Task 1 now re-pins them
  // ATOMICALLY to the SAME real SHA-256 the tests/repo-files.test.ts byte-pins have
  // carried since creation (single source of truth — both surfaces now agree and
  // loadPrompt('claim-support') / loadPrompt('orphan-label') succeed WITHOUT
  // PENSMITH_ALLOW_PENDING_PROMPT_HASHES; runtime drift detection is restored).
  // Mirrors the Phase-4 smoother re-pin precedent exactly (Plan 04-05 Task 4).
  'claim-support':       '44727c65d9ffec142d9d0a8419c4caad551ea0a243efd655b9bc48c069275bf4',   // Phase 5 D-12 (re-pinned Phase 20 D-20-30: judged against the source text — abstract + full-text passages, input <source_text>; WN-3 lockstep with repo-files pin; ACTIVE Pass 2 via pass2.ts)
  'orphan-label':        'c1d45a9f9c7d74889a5f476a2f1b2e847e4edfae96ddf6604479da5334979dc0',   // Phase 5 D-12 (re-pinned Phase 20 D-20-29/30: the per-paragraph orphan audit, input <paragraph>, output {claims}; WN-3 lockstep with repo-files pin; ACTIVE Pass 4 via pass4.ts)
  // Phase 9 D-12 — tutorial/educator teaching-wrapper prompts (Plan 09-02 wires the
  // TutorialSubscriber render seam). RE-PINNED to the real SHA-256 in Plan 09-03 Task 3
  // (the prompt bodies are byte-stable since 09-00 — see the byte-identical guard in
  // tests/repo-files.test.ts PENDING_HASH_PINS, which re-pins the SAME hashes in this
  // SAME commit; WN-3 lockstep — drift between the two surfaces is structurally
  // impossible). After this re-pin loadPrompt('tutorial-section-provenance') /
  // loadPrompt('tutorial-research-rationale') resolve WITHOUT
  // PENSMITH_ALLOW_PENDING_PROMPT_HASHES — runtime drift detection is restored.
  // Mirrors the Phase-4 smoother + Phase-5 claim-support/orphan-label re-pin precedent.
  'tutorial-section-provenance': 'ce1d8c4876e1096d02239e55283e55decd2df8b0358b0d697d14d5005baab380', // Phase 9 D-12 (re-pinned real at Plan 09-03 Task 3 — WN-3 lockstep)
  'tutorial-research-rationale': 'd4d305f2a1e8bebe87849b358f9e4fb9199b78a493bc867a306a63b6e51523e7', // Phase 9 D-12 (re-pinned real at Plan 09-03 Task 3 — WN-3 lockstep)
  // Phase 21 21-CONTEXT.md D-21-15 — the D-12 amendment (REQUIREMENTS.md S-06):
  // the cross-section contradiction judge, invoked from bin/lib/claim-consistency.ts
  // at compile (EXP-11). Pinned here and in tests/repo-files.test.ts PENDING_HASH_PINS
  // in the same commit (WN-3 lockstep).
  'claim-consistency':   '0b62ae208e9d0cddc4f6cdaae1a37f5ac47982c6b2a2f6f960eddf8929374231',   // Phase 21 D-21-15 (D-12 amendment; input <pairs>, output {pairs:[{id,verdict,rationale}]}; ACTIVE at compile via claim-consistency.ts)
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

  const promptPath = pluginTemplatePath('prompts', `${name}.md`);
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
