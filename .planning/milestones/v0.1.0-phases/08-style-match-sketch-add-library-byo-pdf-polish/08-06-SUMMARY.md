---
phase: 08-style-match-sketch-add-library-byo-pdf-polish
plan: 06
subsystem: workflows-tier-contract
tags: [workflow-bodies, capability-check, tier-contract, two-tier, bijection, arch-03, d-24, phase-capstone]

# Dependency graph
requires:
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 01
    provides: "list/open verbs (bin/cli/list.ts + open.ts) + global PAPER registry + deriveLibraryStatus (DERIVE-AT-DISPLAY) + pensmithGlobalLibraryIndexPath/pensmithActivePointerPath"
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 04
    provides: "sketch verb (no-advance-until-confirm) + add verb (DOI/PDF/URL ingest + assigned_sources-only remap)"
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 05
    provides: "intake style-match producer + global-library registration (LIB-04); the deferred-items.md noting the cli-stubs TIER-04 retirement the orchestrator completed pre-plan (commit d4eca79)"
  - phase: 02-mcp-server-tier-contract
    provides: "tier-contract.test.ts structure (Cases A-D + the Phase-3 per-verb loop + assertEquivalent ±20% helper); workflows-keyequal.test.ts W4 closed-vocabulary gate; cli-verbs.test.ts TIER-04 16-verb guard"
provides:
  - "Four FILLED workflow bodies (workflows/{list,open,sketch,add}.md) with real ## Body content + accurate <capability_check> blocks (ARCH-03 Tier-1/Tier-2 degradation, W4 closed vocabulary)"
  - "tier-contract parity for all four promoted verbs (list/open ±20% length parity over the shared bin/cli path; sketch/add presence/shape + documented CLI-only interactive/network asymmetry)"
  - "16-verb / 16-workflow bijection re-asserted (T-08-06-01): UX02_VERBS length 16, four verbs present, no colon-prefix or -section alias leak"
  - "Phase-8 merge gate FULLY GREEN: npm run check passes with ZERO skipped/todo — no RED-by-skip remaining for the phase"
affects: [phase-08-verifier, milestone-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Filled workflow body = a ## Body whose Tier-1 surface (AskUserQuestion / MCP state.read) and Tier-2 degrade (CLI bin/cli/<verb>.ts) BOTH delegate to the SAME bin/cli path — the documented compile/done CLI-only asymmetry (no per-verb MCP tool), keeping the locked 16 verbs bijective with the 16 workflow bodies"
    - "tier-contract parity for a pure-local deterministic verb = run the SAME bin/cli path twice against the same fixture and assert ±20% length equivalence (compile precedent); for an interactive/network verb = a presence/shape contract (member of UX02_VERBS + verb file + workflow body + the documented CLI-only asymmetry)"
    - "Data-dir-scoped CLI spawn helper: set LOCALAPPDATA + XDG_DATA_HOME + HOME to a temp dir so the GLOBAL registry / active pointer land in the fixture, not the host machine (tests/library.test.ts env-override precedent)"

key-files:
  created:
    - .planning/phases/08-style-match-sketch-add-library-byo-pdf-polish/08-06-SUMMARY.md
  modified:
    - workflows/list.md
    - workflows/open.md
    - workflows/sketch.md
    - workflows/add.md
    - tests/tier-contract.test.ts

key-decisions:
  - "[08-06] add.md <capability_check> required: token corrected from the Phase-2 stub's {AskUserQuestion, MCP library.read, MCP state.update, Zotero MCP} to just {AskUserQuestion} — the real bin/cli/add.ts ingests via Crossref/PDF/URL (http.ts D-06 chokepoint) and NEVER touches Zotero MCP; the only Tier-1 interactive surface is the remap approval gate (AskUserQuestion). The body documents the @clack/stdin Tier-2 degrade + the --remap/--yolo bypass. Accurate-to-implementation over the stub's speculative token set; all tokens stay W4-valid"
  - "[08-06] list/open are CLI-only at the tier-contract layer (no pensmith_list/pensmith_open MCP tool) — the Tier-1 surface is the workflow body delegating to the SAME bin/cli path. Parity is exercised as two CLI runs (the single path both tiers share) with ±20% length equivalence — the EXACT compile precedent (04-05). Documented CLI-only asymmetry in the body + the test comment"
  - "[08-06] sketch/add parity is a PRESENCE/SHAPE contract, not an artifact ±20% case — both have non-offline-deterministic parts (sketch: interactive Socratic loop + confirm gate; add: Crossref/PDF/URL network ingest + interactive remap gate). The compile/done CLI-only precedent: assert the verb is a member of UX02_VERBS, ships a verb file + a workflow body whose Tier-1 surface names AskUserQuestion and the @clack/stdin degrade, and the load-bearing invariant is observable (sketch no-advance / add assigned_sources-only)"
  - "[08-06] sketch no-advance observable uses a STDIN-CLOSED spawn (not an undeclared --confirm flag): citty does NOT bind the test-seam args (thesis/confirm/__dispatch are not in the sketch command's args:{} block), so a spawned `pensmith sketch` with stdin closed aborts the Socratic prompt and exits non-zero — and CRITICALLY creates NO .paper/ / STATE.json. The load-bearing assertion is the absence of state mutation (no-advance-until-confirm, Pitfall 6), not the exit code"
  - "[08-06] seedGlobalRegistry STATE.json fixture uses $schemaVersion: 2 (CURRENT_STATE_VERSION) NOT 1 — deriveLibraryStatus does a RAW StateSchema.parse via loadStateSync (no migration), so a v1 envelope would fail z.literal(2) parse and classify as 'unknown' (corrupt) instead of the live 'intake'. The MCP-side freshPaperRoot helper seeds v1 because it goes through loadAndMigrate (v1→v2); the deriveLibraryStatus sync path needs the current version directly"
  - "[08-06] cli-stubs.test.ts STUBS=[] retirement was done by the orchestrator pre-plan (commit d4eca79) — this plan does NOT re-add or touch stub assertions (per the convergence NOTE). All 16 UX-02 verbs are real; zero stubs remain"

requirements-completed: [LIB-02, LIB-03, ERGO-05, ERGO-06]

# Metrics
duration: ~18min
completed: 2026-06-20
---

# Phase 8 Plan 06: Workflow bodies (list/open/sketch/add) + tier-contract parity + 16-verb bijection re-assertion Summary

**Filled the four Phase-2 workflow stubs (list/open/sketch/add) with real `## Body` content and accurate `<capability_check>` blocks (ARCH-03 Tier-1/Tier-2 degradation, W4 closed vocabulary), then extended tier-contract with parity cases for all four promoted verbs and re-asserted the 16-verb / 16-workflow bijection — closing the Phase-8 merge gate FULLY GREEN with zero RED-by-skip remaining.**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-06-20
- **Tasks:** 2 (both `type=auto`)
- **Files created/modified:** 6 (1 SUMMARY created + 5 modified)

## Accomplishments

- **Four filled workflow bodies (ARCH-03):** Replaced the `(stub)` placeholders in `workflows/{list,open,sketch,add}.md` with real Overview + Outputs + numbered `## Body` content. Each documents its dual-tier path: Tier-1 surface (AskUserQuestion / MCP state.read) and Tier-2 degrade (the `bin/cli/<verb>.ts` CLI path), with the documented CLI-only asymmetry (no per-verb MCP tool — the compile/done precedent). The W4 closed-vocabulary gate (`workflows-keyequal.test.ts`) and the manifest validator both pass; the 16-workflow bijection is intact (NO 17th file).
  - `list.md` — DERIVE-AT-DISPLAY library overview (LIB-02/05): load the global registry, group by class, derive each paper's live status; `MCP state.read` required, direct-disk degrade.
  - `open.md` — active-paper pointer switch (LIB-03): exact-name lookup, folder-present guard, atomic-write pointer; `MCP state.read` required, direct-disk degrade.
  - `sketch.md` — the novel Socratic thinking-partner body (ERGO-05): 4-5 question loop → synthesize thesis → confirm gate → dispatch `new` with the seed; the LOCKED no-advance-until-confirm invariant (Pitfall 6) is stated in the body; `AskUserQuestion` required, `@clack/stdin` degrade.
  - `add.md` — mid-paper DOI/PDF/URL ingest (ERGO-06): detect → hydrate via Crossref → writeBibtex → assigned_sources-only remap gate; `AskUserQuestion` required (remap gate), `@clack/stdin` degrade + `--remap`/`--yolo` bypass. The verifier-preserving remap (Pitfall 3) is stated in the body.
- **tier-contract parity for the four promoted verbs (D-24):** `list`/`open` get ±20% length-equivalence parity over the shared `bin/cli` path (the compile precedent — two CLI runs exercise the single path both tiers share); `sketch`/`add` get a presence/shape contract with a documented CLI-only interactive/network asymmetry. The sketch no-advance invariant is observable (a stdin-closed run creates no `.paper/`); the open active-pointer echoes the paperId; the list status is DERIVED at display time.
- **16-verb / 16-workflow bijection re-asserted (T-08-06-01):** A new tier-contract case re-pins `UX02_VERBS.length === 16`, the four promoted verbs present, no colon-prefix and no `-section` alias leaked into the Tier-2 locked-16, and 16 DISTINCT verbs (no duplicate/17th leak). The plumbing namespace stays a Tier-1-only alias onto the locked 16 ([07-04] three-guard pattern). `cli-verbs.test.ts` TIER-04 still asserts exactly 16 dispatchable verbs.
- **Phase-8 merge gate FULLY GREEN:** `npm run check` passes — lint + typecheck + build + tier-contract (46) + 785 tests (0 fail, **0 skipped, 0 todo**) + manifests. Zero RED-by-skip remaining for the phase.

## Task Commits

Each task was committed atomically:

1. **Task 1: fill list/open/sketch/add workflow bodies with capability_check** — `0084fca` (feat)
2. **Task 2: tier-contract parity for list/open/sketch/add + 16-verb bijection re-assertion** — `b9ad159` (test)

## Files Created/Modified

- `workflows/list.md` (modified) — real DERIVE-AT-DISPLAY body; `MCP state.read` required + direct-disk degrade.
- `workflows/open.md` (modified) — real active-pointer-switch body; `MCP state.read` required + direct-disk degrade.
- `workflows/sketch.md` (modified) — the Socratic no-advance-until-confirm body; `AskUserQuestion` required + `@clack/stdin` degrade.
- `workflows/add.md` (modified) — DOI/PDF/URL ingest + assigned_sources-only remap body; `AskUserQuestion` required + `@clack/stdin` degrade. `<capability_check>` corrected to the real Tier-1 surface (Zotero MCP / MCP library.read / state.update tokens from the stub removed — `add` never touches Zotero MCP).
- `tests/tier-contract.test.ts` (modified) — Plan 08-06 section: data-dir-scoped CLI spawn helper, `seedGlobalRegistry` fixture (v2 STATE.json), existence assertions for all four verbs, list/open ±20% parity, sketch/add presence/shape parity, and the bijection re-assertion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] seedGlobalRegistry STATE.json fixture used the wrong schema version**
- **Found during:** Task 2 (first tier-contract run — `list parity` failed: status derived as `unknown` not `intake`).
- **Issue:** The fixture seeded `$schemaVersion: 1`. `deriveLibraryStatus` does a RAW `StateSchema.parse` via its synchronous `loadStateSync` shim (no migration), and `CURRENT_STATE_VERSION` is `2` — so the v1 envelope failed `z.literal(2)` parse and classified as corrupt → `unknown`, not the live `intake`. (The MCP-side `freshPaperRoot` helper uses v1 because it goes through `loadAndMigrate`, which migrates v1→v2; the deriveLibraryStatus sync path has no such migration.)
- **Fix:** Seeded `$schemaVersion: 2` with an inline comment documenting why the raw-parse path needs the current version. `list parity` then derived `intake` correctly.
- **Files modified:** tests/tier-contract.test.ts
- **Commit:** b9ad159

**2. [Rule 1 - Bug / contract reconciliation] sketch no-advance observable could not use an undeclared --confirm flag**
- **Found during:** Task 2 (manual CLI smoke test of `pensmith sketch --thesis ... --confirm false`).
- **Issue:** The plan/PATTERNS sketch test-seams (`thesis` / `confirm` / `__dispatch`) are NOT declared in the sketch command's `args:{}` block — citty does not bind undeclared CLI flags, so a spawned `pensmith sketch --confirm false` ignores `--confirm`, runs the Socratic loop, and (with stdin closed) aborts the prompt. My initial parity test wrongly expected exit 0 with those flags bound.
- **Fix:** Switched the observable to a STDIN-CLOSED spawn of bare `pensmith sketch`: the prompt aborts (non-zero exit is expected and not asserted), and the load-bearing assertion is that NO `.paper/` / STATE.json is created — the no-advance-until-confirm invariant (Pitfall 6). The seam-based path remains covered by the existing `tests/sketch.test.ts` unit suite (which calls `sketchCommand.run({ args })` directly with real JS booleans).
- **Files modified:** tests/tier-contract.test.ts
- **Commit:** b9ad159

### Scope Note (not a deviation)

**add.md `<capability_check>` correction.** The Phase-2 stub declared `required: { AskUserQuestion, MCP library.read, MCP state.update, Zotero MCP }`. The real `bin/cli/add.ts` ingests via Crossref/PDF/URL (the http.ts D-06 chokepoint) and never touches Zotero MCP; the only Tier-1 interactive surface is the remap approval gate. The body now requires `AskUserQuestion` only, with the `@clack/stdin` degrade + `--remap`/`--yolo` bypass documented. All stub tokens were W4-valid; this is an accuracy correction, not a vocabulary fix.

**cli-stubs.test.ts STUBS=[] was already retired by the orchestrator (commit d4eca79).** Per the convergence NOTE, this plan does not re-add or touch stub assertions. All 16 UX-02 verbs are real; zero stubs remain.

## Known Stubs

None. All four workflow bodies are real (no `(stub)` placeholders remain); the four CLI verbs they drive (`bin/cli/{list,open,sketch,add}.ts`) were shipped real in 08-01/08-04. Zero RED-by-skip tests remain for the phase.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern, or schema-at-trust-boundary surface was introduced — this plan fills documentation bodies and adds test parity cases. The threat register's two `mitigate` dispositions are both honored: T-08-06-01 (no 17th verb / alias leak) by the re-asserted three-guard bijection; T-08-06-02 (tier drift) by the four parity cases + the W4 vocabulary gate on the bodies; T-08-06-03 (workflow body without a contract entry) by the four new tier-contract cases (D-24 obligation).

## Verification

- `node --import tsx --test tests/workflows-keyequal.test.ts` → 4/4 GREEN (16 bodies, every body has a `<capability_check>` with required + degrade lists, W4 closed vocabulary satisfied, filenames bijective with dispatcher verbs).
- `node scripts/validate-plugin-manifest.cjs` → valid (16-workflow bijection intact, no new workflow file).
- `npm run test:tier-contract` → 46/46 GREEN (preflight 5 + tier-contract 41, incl. the 9 new 08-06 cases).
- `node --import tsx --test tests/cli-verbs.test.ts` → 2/2 GREEN (TIER-04 asserts exactly 16 dispatchable verbs).
- `npx eslint tests/tier-contract.test.ts` → 0 errors. `npx tsc --noEmit` → 0 errors.
- **Full suite:** `npm run check` → lint + typecheck + build + tier-contract + **785 tests (785 pass, 0 fail, 0 skipped, 0 todo)** + manifests, all GREEN. `prebuild` reports **16 verbs**. Zero RED-by-skip remaining for the phase.

## Self-Check: PASSED

- FOUND: workflows/list.md (contains "capability_check" + filled Body)
- FOUND: workflows/open.md (contains "capability_check" + filled Body)
- FOUND: workflows/sketch.md (contains "capability_check" + Socratic no-advance Body)
- FOUND: workflows/add.md (contains "capability_check" + ingest/remap Body)
- FOUND: tests/tier-contract.test.ts (08-06 parity + bijection cases)
- FOUND: commit 0084fca (Task 1)
- FOUND: commit b9ad159 (Task 2)

---
*Phase: 08-style-match-sketch-add-library-byo-pdf-polish*
*Completed: 2026-06-20*
