---
phase: 07-single-command-ux-layer-hooks-flags
plan: 04
subsystem: cli-ux
tags: [skills, nl-routing, plumbing-namespace, plugin-manifest, tier-contract, no-17th-verb, porcelain-plumbing]

# Dependency graph
requires:
  - phase: 07-single-command-ux-layer-hooks-flags
    provides: "07-01 RED-by-skip skill/NL-trigger contracts (UX02_VERBS.length===16 + skill-targets⊆verbs); 07-02 real next/status/resume verbs + resolveNextAction router; 07-03 SessionStart resume frame"
  - phase: 04-vertical-slice
    provides: "04-04 revise ships via plan --revise (NOT a 17th verb) through bin/lib/revise.ts::runRevise"
  - phase: 00-scaffolding
    provides: "validate-plugin-manifest.cjs structural validator; .claude-plugin/plugin.json mcpServers shape; skills/ directory (.gitkeep placeholder)"
provides:
  - "skills/pensmith.md — primary NL-routing porcelain skill (PRD §5.4 phrases route to status/resume/next/done/compile; bare /pensmith delegates to resolveNextAction)"
  - "skills/plan-section.md, write-section.md, verify-section.md — colon-prefix plumbing namespace shims onto the existing plan/write/verify verbs (redo/revise/swap-source/length ride plan --revise)"
  - ".claude-plugin/plugin.json skills array registering the 4 skill names (porcelain pensmith + 3 plumbing)"
  - "tier-contract verb-shortcut + plumbing-namespace parity cases (next/status/resume in both tiers; pensmith:<verb>-section aliases the locked-16 verb; no-17th-verb re-pin)"
affects: [milestone-close, README-power-user-docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Skill frontmatter authored name-LAST + single-line quoted description so (a) readDescription's /(?:^|\\n)description:\\s*(.+)/ captures the full phrase line and (b) the nl-triggers token scan /pensmith[:\\s]+([a-z][a-z-]*)/ never matches `pensmith` adjacent to a non-verb frontmatter key"
    - "Porcelain/plumbing split: skills/pensmith.md is porcelain (NL routing); skills/<verb>-section.md are scriptable plumbing aliases — both route onto the locked-16 verbs, never a 17th"
    - "Plumbing namespace is a Tier-1-only alias (plugin.json colon-prefix skill names); Tier-2 CLI has no colon-prefix concept — parity is observable-verb agreement, not identical surface syntax"

key-files:
  created:
    - skills/pensmith.md
    - skills/plan-section.md
    - skills/write-section.md
    - skills/verify-section.md
  modified:
    - .claude-plugin/plugin.json
    - tests/tier-contract.test.ts

key-decisions:
  - "[07-04] Skill description authored as a single-line quoted YAML string with `name:` LAST in the frontmatter — the 07-01 readDescription helper extracts only the first line after `description:` (so a `|` block scalar would yield just `|`), and the nl-triggers token scan /pensmith[:\\s]+([a-z][a-z-]*)/ treats `\\n` as whitespace so `name: pensmith\\ndescription:` would extract a bogus `description` verb token. Name-last + single-line description makes both 07-01 RED tests pass without weakening them."
  - "[07-04] plugin.json skills array shipped (NOT the CONTRIBUTING.md fallback) — Assumption A1 / Open Question 2 resolved: validate-plugin-manifest.cjs validates only name/version/author/mcpServers and structurally TOLERATES an additional `skills` array of {name,file} entries with colon-prefix names; the validator passed clean, so the colon-prefix namespace ships in the manifest."
  - "[07-04] Plumbing skill bodies delegate via literal `pensmith plan` / `pensmith write` / `pensmith verify` tokens — the tier-contract plumbing-parity case greps `pensmith <verb>\\b` in each skill body to prove the namespace resolves to the SAME locked-16 verb (D-06 single path), so the body wording is load-bearing, not decorative."
  - "[07-04] No 17th verb: redo/revise/swap-source/length-change corrections all map to `plan --revise` (04-04 precedent); the new tier-contract case asserts no colon-prefix and no `-section` alias leaked into UX02_VERBS, and UX02_VERBS.length===16 is re-pinned a third time (07-01 nl-triggers + 07-01 standing guard + this case)."

patterns-established:
  - "Name-last single-line-description skill frontmatter is the canonical pensmith skill shape (satisfies both 07-01 RED scanners)"
  - "Tier-1 plumbing namespace registered in plugin.json skills array; Tier-2 parity asserted as verb-alias agreement (no colon-prefix in Tier 2)"

requirements-completed: [UX-02, UX-03, UX-04, UX-05]

# Metrics
duration: 12min
completed: 2026-06-19
---

# Phase 7 Plan 04: NL-Routing Skills + Plumbing Namespace + Tier Parity Summary

**The natural-language routing layer — skills/pensmith.md (PRD §5.4 porcelain) plus three colon-prefix plumbing shims, registered in plugin.json's skills array, with tier-contract parity proving next/status/resume and the pensmith:<verb>-section namespace resolve to the SAME locked-16 verbs in both tiers — turning the last 6 RED-by-skip UX-03/04/05 cases GREEN with the 16-workflow bijection fully intact (no 17th verb).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-19T05:16:08Z
- **Completed:** 2026-06-19T05:28Z (approx)
- **Tasks:** 2 deterministic (Task 3 is a live-routing human-verify checkpoint — documented manual-only, see below)
- **Files created:** 4 — **Files modified:** 2

## Accomplishments

- **NL-routing skills (UX-03/04/05) — Task 1.** Created `skills/pensmith.md` (primary porcelain skill: description carries the verbatim PRD §5.4 phrases — "start my paper", "what's next?", "where am I?", "continue where I left off", "resume", "make it sound less AI" — and routes them to status/resume/next/done/compile; bare `/pensmith` delegates to `bin/lib/router.ts::resolveNextAction`, no duplicated logic) plus three plumbing shims: `plan-section.md` ("plan section N" / "redo section N" → `pensmith plan` + `plan --revise`, with swap-source/length-change explicitly mapped onto `--revise`), `write-section.md` (→ `pensmith write`), `verify-section.md` (→ `pensmith verify`). Inline corrections ride the EXISTING plan/revise paths — no 17th verb.
- **Plumbing namespace + tier parity (UX-02/03) — Task 2.** Added a `skills` array to `.claude-plugin/plugin.json` registering the 4 skill names (`pensmith`, `pensmith:plan-section`, `pensmith:write-section`, `pensmith:verify-section`); the manifest validator passes clean (A1 resolved). Extended `tests/tier-contract.test.ts` with 3 cases: (1) next/status/resume present in BOTH tier surfaces (UX02_VERBS + the skill description routes), (2) `pensmith:<verb>-section` resolves to the SAME locked-16 verb in Tier 1 (plugin.json + skill body grep) and Tier 2 (UX02_VERBS membership), (3) no-17th-verb re-pin (length===16, no colon/`-section` leaked into Tier 2).
- **Full suite zero-skip.** `npm run check` → 750 tests, 750 pass, 0 fail, **0 skip** (the prior 6 UX-03/04/05 RED-by-skip cases are now GREEN); lint + typecheck + build + tier-contract (37/37) + manifests all pass. The phase's entire RED-by-skip backlog is cleared.

## Task Commits

Each task was committed atomically:

1. **Task 1: NL-routing skills + plumbing namespace** - `b79c2fb` (feat) — skill files + nl-trigger tests 9/9 pass, 1 skip (plugin.json case, lands Task 2)
2. **Task 2: plugin.json skills array + tier-contract parity** - `a451a22` (feat) — skill-descriptions 6/6, tier-contract 37/37, manifest valid

**Plan metadata:** (this commit) — `docs(07-04): complete NL-routing skills + plumbing namespace plan`

## Files Created/Modified

- `skills/pensmith.md` - Primary NL-routing porcelain skill; PRD §5.4 phrases in description; bare /pensmith → resolveNextAction
- `skills/plan-section.md` - Plumbing: plan/redo/revise/swap-source/length → `pensmith plan` + `plan --revise` (no 17th verb)
- `skills/write-section.md` - Plumbing: write/draft/rewrite section N → `pensmith write`
- `skills/verify-section.md` - Plumbing: verify/check-citations section N → `pensmith verify`
- `.claude-plugin/plugin.json` - Added `skills` array registering the 4 colon-prefix skill names alongside `mcpServers`
- `tests/tier-contract.test.ts` - +3 parity cases (verb-shortcut both-tier presence, plumbing-namespace verb-alias agreement, no-17th-verb re-pin) + UX02_VERBS import

## Decisions Made

- **Name-last, single-line description frontmatter.** The 07-01 `readDescription` helper grabs only the first line after `description:`, and the nl-triggers token scanner treats newlines as whitespace — so a `description: |` block scalar would (a) yield just `|` for the phrase-match assertions and (b) extract a bogus `description` verb token from `name: pensmith\ndescription:`. Authoring the description as a single quoted line with `name:` placed LAST satisfies both 07-01 RED scanners without weakening either.
- **Shipped the plugin.json skills array (A1 resolved).** `validate-plugin-manifest.cjs` validates only name/version/author/mcpServers and tolerates an additional `skills` array; it passed clean, so the colon-prefix plumbing namespace ships in the manifest rather than the documented CONTRIBUTING.md fallback.
- **Plumbing skill bodies carry load-bearing `pensmith <verb>` tokens.** The tier-contract plumbing-parity case greps `pensmith <verb>\b` in each skill body to prove the namespace resolves to the same locked-16 verb (D-06 single path).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Block-scalar / name-first frontmatter would have failed both 07-01 RED scanners**
- **Found during:** Task 1 (skill file authoring + verification)
- **Issue:** The PATTERNS.md skill structure example uses a `description: |` block scalar with `name:` first. Against the LOCKED 07-01 tests this fails twice: `readDescription` (`/(?:^|\n)description:\s*(.+)/`) captures only `|` so the §5.4 phrase-match assertions fail; and the nl-triggers token scan (`/pensmith[:\s]+([a-z][a-z-]*)/`, where `[\s]` includes `\n`) extracts a bogus `description` verb token from `name: pensmith` immediately followed by the `description:` line. A later prose token (`/pensmith with no verb/` → `with`) had the same failure mode.
- **Fix:** Authored each skill's `description` as a single-line quoted YAML string carrying all §5.4 phrases, placed `name:` LAST in the frontmatter, and reworded the one prose occurrence (`bare /pensmith with no verb` → `bare /pensmith (no verb)`) so no `pensmith` token is adjacent to a non-verb lowercase word. Verified via a token-audit script that every extracted token across all 4 files is a locked-16 verb, a `-section` suffix, or the allowed `revise` alias.
- **Files modified:** skills/pensmith.md, skills/plan-section.md, skills/write-section.md, skills/verify-section.md
- **Verification:** `node --import tsx --test tests/skill-descriptions.test.ts tests/nl-triggers.test.ts` → all pass, 0 fail.
- **Committed in:** `b79c2fb` (Task 1 commit)

**2. [Rule 1 - Cleanup] Removed redundant skills/.gitkeep**
- **Found during:** Task 1 (staging)
- **Issue:** `skills/.gitkeep` was the Phase-0 placeholder to keep the empty directory tracked; the directory now holds 4 real tracked skill files, so the placeholder is redundant.
- **Fix:** `git rm skills/.gitkeep`. The repo-files directory-contract test only asserts `skills/` is a directory (still true with real files), so nothing breaks.
- **Files modified:** skills/.gitkeep (deleted)
- **Verification:** `npm run check` → 750 pass / 0 fail (repo-files directory contract GREEN).
- **Committed in:** `b79c2fb` (Task 1 commit; intentional deletion)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 cleanup)
**Impact on plan:** The frontmatter-shape fix is correctness-essential — the LOCKED 07-01 RED tests cannot pass with the PATTERNS.md block-scalar example; the single-line/name-last shape satisfies both scanners without weakening any assertion. The `.gitkeep` removal is housekeeping. No scope creep; all artifacts match the plan's contract.

## Authentication Gates

None — no external service auth required.

## Known Stubs

None introduced. The skills are routing shims by design (they delegate to existing verbs); this is the intended Tier-1 model-routing architecture (07-RESEARCH "skill descriptions ARE the implementation"), not a stub.

## Manual-Only Verification (Task 3 checkpoint — autonomous-run deferral)

Task 3 is a `checkpoint:human-verify` for LIVE in-chat natural-language routing, which requires a real Claude Code model-routing session and CANNOT run in CI (it is the 07-VALIDATION "Manual-Only: UX-04 live NL routing" item). This plan ran in an autonomous pipeline with no human available. Following the established precedent for live-Pandoc (Phase 6), live-hook (Phase 7-03), and live-NL items, the checkpoint is recorded here as a documented manual-only verification and is **satisfied-for-autonomous-run** via this deferral — it is NOT a blocker.

**All deterministic, machine-observable parts of Task 3's contract ARE fully verified by automated tests:**
- The 4 skill description files exist with the exact §5.4 trigger phrases (`tests/skill-descriptions.test.ts`).
- The plugin.json colon-prefix plumbing namespace is registered and validates (`tests/skill-descriptions.test.ts` + `validate-plugin-manifest.cjs`).
- The skill-mapped target verbs are a subset of UX02_VERBS and UX02_VERBS.length===16 (`tests/nl-triggers.test.ts`).
- Verb-shortcut + plumbing-namespace tier parity (`tests/tier-contract.test.ts` — 3 new cases).

**Outstanding live check (for a human, in a real session with the plugin loaded):**
1. "where am I?" → pensmith status/routing skill invoked.
2. "redo section 3" → routes to plan / `plan --revise` for section 3 (not a rewrite-from-scratch, not a new verb).
3. "make it sound less AI" → routes to the humanize-under-done path.
4. "continue where I left off" → SessionStart/resume picks up HANDOFF.json state.
5. `/pensmith:plan-section` scriptable invocation maps to the plan verb.

## Issues Encountered

- The two deviations above; no others. The frontmatter-shape mismatch was diagnosed by running the 07-01 RED tests against a first draft and reading the exact extraction regexes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Phase 7 is functionally complete.** All UX/ERGO/HOOK requirements (UX-01..05, ERGO-01..04, HOOK-01..04) are implemented and GREEN; the full suite is zero-skip (750 pass / 0 fail / 0 skip). The single remaining item is the documented manual-only live-NL routing check above.
- **No blockers.** The 16-workflow bijection is intact (no 17th verb across three independent guards); the plugin.json plumbing namespace validates; tier-contract parity covers the full new verb surface.

---
*Phase: 07-single-command-ux-layer-hooks-flags*
*Completed: 2026-06-19*

## Self-Check: PASSED

- All 4 created skill files + 2 modified files + SUMMARY.md verified on disk (FOUND).
- Both task commits verified in git log: b79c2fb, a451a22.
- Targeted suites: skill-descriptions 6/6 (0 skip), nl-triggers 9 pass (0 fail), tier-contract 37/37 (0 skip).
- Full `npm run check`: 750 tests, 750 pass, 0 fail, 0 skip; lint + typecheck + build + tier-contract + manifests GREEN.
- 16-workflow bijection intact; no 17th verb; plugin.json plumbing namespace registered + validated.
