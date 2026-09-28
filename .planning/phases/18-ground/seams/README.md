# Phase 18 seam S-A

`18-seam-S-A.patch` holds the contracts several Phase 18 streams consume before any of them merges (D-18-02). It was built and verified on a scratch worktree of the base commit `c011f410a8d61cc53165bdc8dc2d3b61540b06e8`:

- `git apply --check` passes on the base commit;
- with it applied, `npm run prebuild`, `npm run lint`, `npm run typecheck` and `npm run build` pass, and the full `npm test` passes 1515 of 1516 tests — the one failure is the documented root-only `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure" case (CLAUDE.md gotcha; it passes in CI).

Patch sha256: `0bfce1f99e2cc6763527dcff50c07b9f9d6f7cdee196ff249b3870d6499d2e80`.

## How every stream applies it

As the stream's first commit, before any other change:

```bash
sha256sum .planning/phases/18-ground/seams/18-seam-S-A.patch   # must print the hash above
git apply .planning/phases/18-ground/seams/18-seam-S-A.patch
git add -A
git commit -m "chore(18): apply seam S-A" -m "<the two trailer lines>"
```

Then do not edit any file, or any line of a file, the patch adds or changes until Phase 18 closes, except where 18-PLAN.md §6 names a region of a hot file outside the seam hunks. Identical changes on every branch merge cleanly; a second copy of a seam API is a merge conflict and a review finding.

## What it contains

| Status | File | sha256 (first 16) after applying |
|---|---|---|
| M | `PRD.md` (§7.20 gate rows only) | `fc3a0d28c53cb548` |
| M | `bin/lib/config.ts` (`presetDefaults` through disciplines.ts) | `87b7a6665ae78916` |
| A | `bin/lib/disciplines.ts` | `2cc670cc19ef4634` |
| M | `bin/lib/frontmatter.ts` (`FRONTMATTER_KINDS`: plan v2, intake v1) | `ec5b371a68c29b6e` |
| M | `bin/lib/gates.ts` (`assignment-pickup`, `intake-defaults`, `reoutline`) | `8a93a8dc245aa885` |
| A | `bin/lib/intake-brief.ts` | `49c22aad6f2e947c` |
| A | `bin/lib/migrations/intake/v0_to_v1.ts` | `6a7ea2169239f37a` |
| A | `bin/lib/migrations/plan/v1_to_v2.ts` | `aeb1c88b5bae2af6` |
| A | `bin/lib/prompt-request.ts` | `eecde78d793989f9` |
| M | `bin/lib/schemas/plan-frontmatter.ts` (v2) | `a8afa3998327195b` |
| A | `bin/lib/untrusted-fence.ts` | `8ef21228d072b0e8` |
| M | `templates/presets/disciplines.json` (PRD §8) | `8c457bc178b73b4f` |
| M | `tests/config.test.ts` (history preset style) | `8a3ac8187d3db284` |
| M | `tests/disciplines-schema.test.ts` (rewritten: every PRD §8 value) | `073077c3ed2e7a08` |
| M | `tests/frontmatter-roundtrip.test.ts` | `f0dc6264330d9642` |
| M | `tests/frontmatter-versioning.test.ts` | `418e46c3da3ccbf0` |
| M | `tests/gates-registry.test.ts` (planned-gate list, remap stamp) | `35ec375b389d3c24` |
| A | `tests/intake-brief.test.ts` | `9cd87d0b517eef7f` |
| M | `tests/migrations.test.ts` | `e723ec45147fac7d` |
| A | `tests/prompt-request.test.ts` | `ee46431e3516f906` |
| M | `tests/scheduler-stateless.test.ts` (fixture literal) | `415d149a90e017f5` |
| M | `tests/wave-override.test.ts` (fixture literal) | `c5ddde8bbb84a65a` |
| M | `tests/wave-scheduler.test.ts` (fixture literal) | `8441cd6346cd7add` |

## API summary

- `untrusted-fence.ts`: `FENCE_UUID`, `FENCE_OPEN`, `FENCE_CLOSE`, `FENCE_MARKER_REPLACEMENT`, `stripFenceMarkers(text)`, `fenceUntrusted(text)`, `unfence(block)`.
- `prompt-request.ts`: `PROMPT_INPUTS` (slug → ordered `{tag, required, untrusted}`), `promptInputs(slug)`, `renderPromptBlocks(slug, values)`, `buildPromptRequest(slug, values) → {slug, system, messages}`, `parsePromptBlocks(content)`, `promptBlockJson(blocks, tag)`, `promptHints(content)`, `requestHints(req)`, `PromptInputError`. Payload shapes: 18-PLAN.md §3.3.
- `disciplines.ts`: `SOURCE_PREFERENCE_IDS`, `CSL_STYLE_KEYS`, `COUNTERARGUMENT_DEFAULTS`, `FALLBACK_DISCIPLINE`, `PresetsFileSchema`, `DISCIPLINES_PATH`, `loadDisciplinePresets()`, `disciplineSlugs()`, `isDisciplineSlug()`, `presetFor()`, `normalizeDisciplineSlug()`, `resolveLayered()`, `resolveDiscipline()`, `defaultCitationStyleFor()`, `densityBandFor()`.
- `intake-brief.ts`: `CURRENT_INTAKE_FRONTMATTER_VERSION`, `PAPER_TYPES`, `ARGUMENTATIVE_PAPER_TYPES`, `NON_ARGUMENTATIVE_PAPER_TYPES`, `PAPER_MODES`, `COUNTERARGUMENT_ANSWERS`, `ASSIGNMENT_SOURCE_KINDS`, `IntakeBriefSchema`, `FollowUpSchema`, `IntakeBrief`, `IntakeDocument`, `IntakeBriefError`, `intakePath()`, `renderIntakeDocument(brief, assignment, qa)`, `renderIntakeBody()`, `assignmentFromBody()`, `parseIntakeFrontmatter()`, `readIntakeBrief(root)`, `defaultIntakeBrief()`.
- `schemas/plan-frontmatter.ts` v2: `CURRENT_PLAN_FRONTMATTER_VERSION = 2`, `SECTION_ROLES`, new optional fields `suffix`, `purpose`, `role`, `word_target`, `voice`, `stub`, `failure_reason`.
- `frontmatter.ts`: `INTAKE_FRONTMATTER_VERSION = 1`; `FRONTMATTER_KINDS.plan.migrations = {0, 1}`, `FRONTMATTER_KINDS.intake = {current: 1, migrations: {0}}`.
- `gates.ts`: `assignment-pickup` (skip: use the file / non-TTY skip), `intake-defaults` (skip: accept the defaults / non-TTY refuse 3), `reoutline` (skip: re-outline (only with --force) / non-TTY refuse 3).
