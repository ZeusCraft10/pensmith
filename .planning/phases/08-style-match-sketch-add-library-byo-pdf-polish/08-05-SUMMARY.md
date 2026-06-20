---
phase: 08-style-match-sketch-add-library-byo-pdf-polish
plan: 05
subsystem: cli-style-match-library
tags: [style-match, global-library, drafter-input, voice-hint, dual-use-disclosure, lib-04, styl-03, styl-04, consumer-producer]

# Dependency graph
requires:
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    provides: "08-01 registerPaperInGlobalLibrary + deriveLibraryStatus (DERIVE-AT-DISPLAY); 08-02 buildStyleProfile/checkAndRegisterFingerprint/writeStyleProfile/styleMatchToVoiceHint + flat StyleProfileSchema; 08-00 RED-by-skip suites (write-style-integration, intake-style-producer) + the STYL-04 README content guard in repo-files.test.ts"
  - phase: 03-tier-2-cli
    provides: "DrafterInputSchema .strict() chokepoint (WRTE-04/T-3-10); writeOneSection; intake Tier-2 placeholder path; paths.ts paperDir/sectionPlan; frontmatter.ts"
provides:
  - "STYL-03 CONSUMER: write.ts resolveVoiceHint (PLAN voice direction > style-match render > default) + additive DrafterInputSchema.styleProfilePath"
  - "STYL-01/02 PRODUCER: intake --style-samples builds .paper/STYLE.json + surfaces cross-paper reuse UNCONDITIONALLY (the live caller the cross-AI review found missing)"
  - "LIB-04: intake registers the paper in the global PAPER registry (id/name/folderPath/class, status seeded 'intake') as a non-fatal side effect"
  - "STYL-04: README ## Style Match dual-use disclosure (honest framing; reconciled with its own content guard)"
affects: [08-06, phase-08-verifier]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Style-match loop closed END-TO-END: intake (--style-samples) PRODUCES .paper/STYLE.json; write.ts CONSUMES it via resolveVoiceHint with a strict precedence where an explicit per-section voice direction always wins (Pitfall 7)"
    - "Non-fatal side effects at the END of intake: registration + opt-in producer each wrapped in try/catch -> WARN (never fail the verb); graceful-degrade to a folder-derived synthetic identity when STATE.json/paperId is absent"
    - "Producer order is load-bearing: build -> check -> PRINT unconditional reuse notice -> write, so a writeStyleProfile failure can never swallow an already-printed transparency notice (T-08-05-06)"

key-files:
  created:
    - .planning/phases/08-style-match-sketch-add-library-byo-pdf-polish/deferred-items.md
  modified:
    - bin/lib/drafter-input.ts
    - bin/cli/write.ts
    - bin/cli/intake.ts
    - README.md

key-decisions:
  - "[08-05] resolveVoiceHint reads the per-section voice direction from BOTH frontmatter `voice_hint:` AND a body `Voice:` line — the locked RED test (write-style-integration.test.ts) pins a ## Brief body `Voice:` line, while the plan's <interfaces> named frontmatter.voice_hint; honoring BOTH satisfies the RED contract and the plan artifact `contains: voice_hint` check (RED test wins over plan wording, per the 08-02 StyleProfileSchema precedent)"
  - "[08-05] resolveVoiceHint imports styleMatchToVoiceHint STATICALLY (it is PURE, no I/O) so the render is byte-identical to the test's expectation; the 'dynamic import when STYLE.json exists' guidance applies to the file-existence CONSUMER path in writeOneSection (loadStyleProfile/existsSync), not to the pure renderer"
  - "[08-05] malformed STYLE.json is parsed via StyleProfileSchema INSIDE a try/catch in loadStyleProfile -> falls back to the default tone, never throws inside the write verb (T-08-05-05)"
  - "[08-05] intake registration uses a folder-derived synthetic fingerprint identity (`unregistered:<abspath>`) ONLY for the style-fingerprint registry when STATE.json has no paperId yet — the per-paper STYLE.json is still built and reuse detection still works; global-library registration WARN-skips without a real paperId (graceful-degrade, T-08-05-04)"
  - "[08-05] status:'intake' is seeded at registration and NEVER chased on later verbs — list DERIVES the live lifecycle status from STATE.json (08-01 DERIVE-AT-DISPLAY); documented inline so a future maintainer does not add per-verb status writers (T-08-05-07)"
  - "[08-05] config.toml [project] class/title read best-effort via smol-toml (already a dependency); absent/malformed config defaults class to 'Unfiled' and name to the folder basename"
  - "[08-05] The STYL-04 README content guard was ALREADY present in repo-files.test.ts (added RED-by-skip in 08-00); Task 3 authored the README section only — the substring guard (no impersonate/evade detection/undetectable; positive `match your.*voice` phrase) opened and passed. No new guard or hash-pin was added (README is not a locked-copy file)"

requirements-completed: [STYL-03, STYL-04, LIB-04]

# Metrics
duration: ~30min
completed: 2026-06-20
---

# Phase 8 Plan 05: Style-match wiring (drafter consumer + intake producer) + global-library registration + README disclosure Summary

**Closed the style-match loop end-to-end — an opt-in `intake --style-samples` PRODUCER builds `.paper/STYLE.json` and surfaces cross-paper reuse unconditionally, while `write.ts` CONSUMES it via a strict voice-hint precedence (PLAN voice direction > style-match > default) behind an additive `styleProfilePath` on the .strict() drafter contract — plus LIB-04 intake registration in the global PAPER registry and the honest STYL-04 README dual-use disclosure.**

## Performance
- **Duration:** ~30 min
- **Completed:** 2026-06-20
- **Tasks:** 3 (each committed atomically)
- **Files modified:** 4 (drafter-input.ts, write.ts, intake.ts, README.md) + 1 created (deferred-items.md)

## Accomplishments
- **STYL-03 CONSUMER (Task 1):** Added the additive optional `styleProfilePath` inside the `.strict()` DrafterInputSchema (no existing field touched; the WRTE-04/T-3-10 chokepoint still throws on unknown fields — T-08-05-01). Implemented `resolveVoiceHint({planMd, styleProfile?})` in write.ts with strict priority: an explicit PLAN.md voice direction (frontmatter `voice_hint:` OR a body `Voice:` line) ALWAYS wins over the style-match render, which wins over a non-empty default (Pitfall 7 / T-08-05-02). `writeOneSection` now reads the section PLAN.md + STYLE.json (via `paperDir()`, not a hardcoded `.paper` literal), and a malformed STYLE.json falls back to the default tone without throwing (T-08-05-05).
- **STYL-01/02 PRODUCER (Task 2):** Added the opt-in `--style-samples` flag to the existing `intake` verb (NO 17th verb). When provided, intake runs `buildStyleProfile -> checkAndRegisterFingerprint -> writeStyleProfile(.paper/STYLE.json)` as a non-fatal side effect. The cross-paper-reuse notice surfaces UNCONDITIONALLY on stdout when a prior paper shares the fingerprint — not `--yolo`-gated, not suppressible (STYL-02). Order is build->check->print->write so a write failure can never swallow the notice (T-08-05-06).
- **LIB-04 (Task 2):** Intake registers the paper in the global PAPER registry (`registerPaperInGlobalLibrary`) with id (paperId from STATE.json), name (folder basename or config.toml title), absolute folderPath (load-bearing — `open` switches to it, `list` derives status from its STATE.json), class (config.toml `[project] class`, default 'Unfiled'), and a seeded `status:'intake'`. Live status is DERIVED by `list` (08-01); intake does NOT chase status (T-08-05-07). Verified end-to-end with a smoke test against the real modules.
- **STYL-04 (Task 3):** Authored the README `## Style Match` dual-use disclosure with honest, transparency-only framing mirroring honesty-framing.md. The copy is reconciled with its own content guard — none of the forbidden substrings (`impersonate` / `evade detection` / `undetectable`) appear even in negation, and the positive `match your … established voice` phrase is on a single line (T-08-05-03).
- **No 17th verb:** prebuild confirms 16 verbs intact.

## Task Commits
1. **Task 1: additive styleProfilePath + write.ts voiceHint priority (STYL-03 CONSUMER)** — `9d6ff6a` (feat)
2. **Task 2: intake global-library registration (LIB-04) + style-match opt-in PRODUCER** — `5b631c6` (feat)
3. **Task 3: README Style Match dual-use disclosure (STYL-04)** — `2c16229` (docs)

## Files Created/Modified
- `bin/lib/drafter-input.ts` — additive optional `styleProfilePath: z.string().optional()` inside `.strict()`; schema doc updated.
- `bin/cli/write.ts` — `resolveVoiceHint` (exported, PURE), `planVoiceDirection` helper (frontmatter + body `Voice:` line), `loadStyleProfile` (existsSync + StyleProfileSchema-in-try/catch), `writeOneSection` wired to resolve voiceHint + pass styleProfilePath when present.
- `bin/cli/intake.ts` — `--style-samples` opt-in arg; `resolvePaperMeta`/`resolvePaperId`/`registerPaperNonFatal`/`runStyleProducerNonFatal` helpers; both Tier-2 + Tier-1 return branches run the non-fatal side effects before returning.
- `README.md` — `## Style Match` dual-use disclosure section (existing `v0.1.0 in development` + `Phase 6` stub assertions preserved).
- `.planning/phases/08-.../deferred-items.md` — logs the pre-existing cli-stubs TIER-04 failures (out of scope).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / contract reconciliation] resolveVoiceHint signature + source-of-voice differ from the plan wording**
- **Found during:** Task 1.
- **Issue:** The plan's `<action>` described reading `frontmatter.voice_hint` and passing the resolved hint inline; the LOCKED Wave-0 RED test (`tests/write-style-integration.test.ts`) instead imports `export function resolveVoiceHint({ planMd, styleProfile? }): string` and pins a per-section `Voice:` line in the PLAN.md `## Brief` BODY.
- **Fix:** Implemented `resolveVoiceHint` with the exact test signature and made `planVoiceDirection` honor BOTH a frontmatter `voice_hint:` key AND a body `Voice:` line (so the plan artifact `contains: voice_hint` check and the RED test both hold). RED test wins over plan wording (same precedent as 08-02 flat StyleProfileSchema).
- **Files modified:** bin/cli/write.ts
- **Commit:** 9d6ff6a

**2. [Rule 3 - Blocking] exactOptionalPropertyTypes rejected passing a possibly-undefined styleProfile**
- **Found during:** Task 1 (tsc).
- **Issue:** `resolveVoiceHint({ planMd, styleProfile: profile })` with `profile: StyleProfile | undefined` fails under `exactOptionalPropertyTypes: true`.
- **Fix:** Conditional spread `...(profile ? { styleProfile: profile } : {})` at both call sites (resolveVoiceHint input and the assertDrafterInput styleProfilePath spread).
- **Files modified:** bin/cli/write.ts
- **Commit:** 9d6ff6a

### Scope Note (not a deviation)

**README content guard already existed.** The plan's Task 3 + `files_modified` listed adding a guard to `tests/repo-files.test.ts`. That guard was already authored in 08-00 as RED-by-skip (guarded on `## Style Match` presence). Task 3 therefore authored ONLY the README section; the guard opened and passed unchanged. No hash-pin was added (README is not a locked-copy file, unlike honesty-framing.md). `tests/repo-files.test.ts` was NOT modified.

## Deferred Issues (out of scope — pre-existing)

**tests/cli-stubs.test.ts TIER-04 stub assertions fail for list/open/sketch/add.** These verbs were implemented in earlier Phase-8 plans (08-01 list/open, 08-03 add, 08-04 sketch) but the TIER-04 stub test still expects them to print "not implemented yet". Proven pre-existing: all 4 fail at commit `2af3871` (before this plan). Plan 08-05 touches none of the files these assertions exercise. Logged to `deferred-items.md`; the Phase-8 verifier / a cleanup plan should retire these stub cases. NOT fixed here per the SCOPE BOUNDARY rule.

## Known Stubs

None introduced. write.ts remains the Tier-2 placeholder DRAFT writer by design (the Tier-1 workflow body does real drafting); the style-match wiring (voiceHint + styleProfilePath) is real and flows into the strict drafter contract.

## Threat Flags

None. The producer reads an untrusted `--style-samples` dir, but path-traversal is mitigated in `buildStyleProfile` (path.resolve before any read, 08-02) and the producer is wrapped non-fatally. No new network endpoint, auth path, or schema-at-trust-boundary surface introduced beyond the plan's threat register.

## Verification
- `node --import tsx --test tests/write-style-integration.test.ts tests/drafter-input.test.ts tests/style-match.test.ts tests/intake-style-producer.test.ts tests/repo-files.test.ts` -> 59 pass, 0 fail, 0 skip.
- Full suite (`node scripts/run-tests.mjs`): 780 tests, 776 pass, 0 skip, **4 fail (all pre-existing cli-stubs TIER-04, out of scope)**.
- `tsc --noEmit` -> 0 errors. `npm run build` -> clean, prebuild reports **16 verbs** (no 17th verb).
- `eslint bin/cli/intake.ts bin/cli/write.ts bin/lib/drafter-input.ts` -> 0 errors.
- LIB-04 smoke test (real modules, real paperId): paper registers with name/class='Unfiled'/status='intake'/folderPath retained.
- README content contract: `## Style Match` present, positive phrase present, none of impersonate/evade detection/undetectable.
- PRODUCER(2) reuse-notice test passes reliably in isolation (3/3 runs); it is dropped from multi-test counts due to a pre-existing test-isolation flaw in the locked RED file (concurrent `process.stdout.write` patching across sibling tests) — not an implementation defect.

## Self-Check: PASSED
- Files: bin/lib/drafter-input.ts, bin/cli/write.ts, bin/cli/intake.ts, README.md, 08-05-SUMMARY.md, deferred-items.md — all FOUND.
- Commits: 9d6ff6a, 5b631c6, 2c16229 — all FOUND.
