---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: "04"
subsystem: mcp
tags: [mcp, stdio, zod, mcpserver, capabilities, resources, tools, tier-contract]

requires:
  - phase: 02-tier-shells-doctor-tier-contract-gate
    provides: "Wave 1 chokepoints (D-09 thin-shim, D-10 no-network, D-12 capabilities-noleak AST-walk lint tests)"
  - phase: 01-foundation-nfrs
    provides: "bin/lib/state.ts, bin/lib/library.ts, bin/lib/runtime.ts, bin/lib/paths.ts, bin/lib/doi.ts, bin/lib/http.ts"

provides:
  - "mcp/server.ts: McpServer + StdioServerTransport boot (TIER-01, TIER-02, D-02)"
  - "mcp/resources.ts: 5 paper:// resources (state, outline, section/{N}, library, capabilities)"
  - "mcp/tools.ts: 6 snake_case tools (paper_init_section, paper_advance_section, paper_record_verification, paper_set_status, paper_doi_verify, paper_capability_probe)"
  - "bin/lib/capabilities.ts: loadCapabilityFacts() — single authorised capability composition site (D-12)"
  - "bin/lib/outline.ts: loadOutline() chokepoint"
  - "bin/lib/section.ts: loadSection() chokepoint"
  - "bin/lib/state.ts extensions: initSection, advanceSection, setSectionStatus, recordVerification"
  - "bin/lib/schemas/state.ts extensions: SectionStateSchema, SectionStatusSchema, VerificationVerdictSchema, StatePatchSchema"
  - "bin/lib/doi.ts extension: verifyDoi() — DOI re-fetch via Crossref"
  - "tests/mcp-server-thin-shim.test.ts: D-08 positive case — all 11 handlers ≤30 stmts"
  - "tests/mcp-tool-handlers.test.ts: TIER-06 zod input validation for all 6 tools"
  - "tests/capabilities.test.ts: D-12 sentinel-leak + shape invariant"

affects:
  - "02-05 (doctor probes) — loadCapabilityFacts() is the shared capability source"
  - "02-06 (CLI dispatcher) — bin/lib/state.ts mutation helpers are the CLI's write path"
  - "02-07 (tier-contract test) — mcp/server.ts buildServer() is the subject under test"

tech-stack:
  added:
    - "@modelcontextprotocol/sdk@^1.29 (McpServer, StdioServerTransport, ResourceTemplate, Client, InMemoryTransport)"
  patterns:
    - "D-12 architectural pattern: capability composition lives entirely in bin/lib/capabilities.ts; mcp/ handlers are zero-composition thin shims"
    - "D-08 handler statement budget: every resource + tool handler ≤30 stmts, AST-walk asserted in tests/mcp-server-thin-shim.test.ts"
    - "SDK v1.29 error surface: validation failures return {isError:true, content:[...]} not thrown McpError — tests assert res.isError===true"
    - "buildServer(paperRoot) factory pattern: paperRoot resolved once at boot, closed over resource handlers (cross-AI HIGH #4 fix)"

key-files:
  created:
    - "mcp/server.ts"
    - "mcp/resources.ts"
    - "mcp/tools.ts"
    - "bin/lib/capabilities.ts"
    - "bin/lib/outline.ts"
    - "bin/lib/section.ts"
    - "tests/mcp-server-thin-shim.test.ts"
    - "tests/mcp-tool-handlers.test.ts"
    - "tests/capabilities.test.ts"
  modified:
    - "bin/lib/state.ts (added 4 mutation helpers)"
    - "bin/lib/schemas/state.ts (added section enums + SectionEntrySchema + StatePatchSchema)"
    - "bin/lib/doi.ts (added verifyDoi())"

key-decisions:
  - "SDK v1.29 wraps all handler errors in {isError:true} body (not JSON-RPC error) — TIER-06 tests assert res.isError===true instead of assert.rejects"
  - "verifyDoi() added to bin/lib/doi.ts (Rule 3 auto-fix: plan required it but Phase 1 doi.ts only had normalization)"
  - "sections field added as optional to StateSchema to allow Phase 2 mutation helpers without schema version bump (sections[] is additive)"
  - "loadCapabilityFacts uses Object.values(cfg.providers) because runtime-config providers is a z.record (not z.array)"

requirements-completed: [ARCH-18, TIER-01, TIER-02]

duration: 35min
completed: 2026-05-16
---

# Phase 2 Plan 04: MCP Server Summary

**McpServer over StdioServerTransport with 5 paper:// resources + 6 snake_case zod-validated tools, capability facts isolated in bin/lib/capabilities.ts per D-12 architectural fix**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-16T10:12:38Z
- **Completed:** 2026-05-16T10:47:00Z
- **Tasks:** 4 (+ 1 Rule-1 auto-fix, 1 Rule-3 auto-fix)
- **Files modified:** 12

## Accomplishments

- Shipped the complete TIER-01 (5 paper:// resources) + TIER-02 (6 snake_case tools) MCP surface that 02-07's tier-contract test will black-box against
- D-12 architectural fix: `loadCapabilityFacts()` in `bin/lib/capabilities.ts` is the single authorised composition site for runtime config + env presence flags; both `mcp/resources.ts` and `mcp/tools.ts` are zero-composition thin shims
- All three Wave 1 chokepoints (D-09 thin-shim, D-10 no-network, D-12 capabilities-noleak) pass on the shipped code — lint is silent because the handlers are structurally compliant
- 17 new tests (2 thin-shim AST walk + 13 tool handler validation + 3 capabilities sentinel/shape) all green; 265 total tests pass

## Task Commits

1. **Task 1: Pin SDK + chokepoints + mcp/resources.ts** - `f219474` (feat)
2. **Task 2: mcp/tools.ts + mcp/server.ts boot** - `658d5da` (feat)
3. **Task 3: AST walk + TIER-06 zod validation tests** - `faad8c0` (test)
4. **Task 4: capabilities.test.ts sentinel-leak + shape** - `9137a53` (test)
5. **Fix: TS2352 cast in capabilities.test.ts** - `f796fd5` (fix)

## Files Created/Modified

- `mcp/server.ts` - McpServer + StdioServerTransport boot; buildServer(paperRoot) factory; import.meta.url boot guard
- `mcp/resources.ts` - registerPaperResources(server, paperRoot) with 5 paper:// resources; paper://capabilities delegates to loadCapabilityFacts
- `mcp/tools.ts` - registerPaperTools(server) with 6 snake_case tools; all delegate to bin/lib/* chokepoints; flat inputSchema per Pitfall 2
- `bin/lib/capabilities.ts` - loadCapabilityFacts() — SINGLE authorised site for runtime config + env presence flags composition (D-12)
- `bin/lib/outline.ts` - loadOutline() chokepoint for mcp/resources.ts paper://outline
- `bin/lib/section.ts` - loadSection() chokepoint for mcp/resources.ts paper://section/{N}
- `bin/lib/state.ts` - Added initSection, advanceSection, setSectionStatus, recordVerification helpers
- `bin/lib/schemas/state.ts` - Added SectionStateSchema, SectionStatusSchema, VerificationVerdictSchema, SectionEntrySchema, StatePatchSchema; sections field added as optional to Schema
- `bin/lib/doi.ts` - Added verifyDoi() (DOI normalize + Crossref re-fetch via http.ts)
- `tests/mcp-server-thin-shim.test.ts` - D-08 positive: 5 resource handlers + 6 tool handlers each ≤30 stmts
- `tests/mcp-tool-handlers.test.ts` - TIER-06: 1+ positive + 1+ negative per tool across all 6 tools
- `tests/capabilities.test.ts` - D-12 sentinel, shape, missing-env tests

## Decisions Made

- **SDK v1.29 error surface (deviation from plan's assert.rejects pattern):** The SDK wraps all handler errors (including zod validation failures from McpError(InvalidParams)) in `{isError:true, content:[...]}` rather than propagating as JSON-RPC errors. TIER-06 tests assert `res.isError === true` instead of `assert.rejects`. This is the correct behavior per SDK source (mcp.js catch block, lines 138-144).
- **providers is z.record not z.array:** RuntimeConfigSchema uses `z.record(string, ProviderSchema)` — `loadCapabilityFacts` uses `Object.values(cfg.providers)` not `.map()` directly.
- **sections field added as optional (not via migration):** Adding `sections?: SectionEntry[]` directly to StateSchema avoids a v1→v2 migration for an optional field. The mutation helpers (initSection etc.) work against existing STATE.json files that lack sections by defaulting to `prev.sections ?? []`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] verifyDoi() missing from bin/lib/doi.ts**
- **Found during:** Task 2 (mcp/tools.ts paper_doi_verify tool)
- **Issue:** Plan's mcp/tools.ts paper_doi_verify tool imports `verifyDoi` from `bin/lib/doi.ts`, but Phase 1 doi.ts only exported normalization functions (normalizeDoi, isDoi, normalizeArxiv, etc.). No verifyDoi existed.
- **Fix:** Added `verifyDoi(doi: string): Promise<DoiVerifyResult>` to doi.ts — normalizes DOI then re-fetches from Crossref via bin/lib/http.ts; returns `{valid, canonical, metadata}`. doi.ts already had `no-restricted-syntax: off` exemption so the http import is allowed.
- **Files modified:** `bin/lib/doi.ts`
- **Verification:** `npm run typecheck` passes; `npm run lint` passes (doi.ts exemption covers http import)
- **Committed in:** `658d5da` (Task 2 commit)

**2. [Rule 1 - Bug] TS2352 cast error in capabilities.test.ts**
- **Found during:** Post-Task-4 build verification
- **Issue:** `(facts as Record<string, unknown>)` cast failed with TS2352 because `CapabilityFacts` interface lacks an index signature and doesn't sufficiently overlap with `Record<string, unknown>` under exactOptionalPropertyTypes
- **Fix:** Changed cast to `(facts as unknown as Record<string, unknown>)` — double-cast via unknown is the correct pattern when types don't sufficiently overlap
- **Files modified:** `tests/capabilities.test.ts`
- **Committed in:** `f796fd5`

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 1 bug)
**Impact on plan:** Both essential. verifyDoi was structurally required by the plan's tool definition; TS cast is a strictness compliance fix. No scope creep.

## Known Stubs

- `bin/lib/capabilities.ts` fields `pandoc`, `zotero_mcp`, `humanizer`, `onedrive_detected`, `sync_folder_match` are intentionally `undefined` in Phase 2. These are documented placeholders (not broken data) — 02-05 doctor probes will populate them. The shape is stable so 02-05 can extend without drift. `tests/capabilities.test.ts` explicitly asserts they ARE undefined in Phase 2.

## Threat Flags

No new threat surface beyond the plan's registered mitigations (T-02-04-01 through T-02-04-08 all implemented: zod enum gates, D-12 lint + sentinel test, D-07 lint, D-10 lint, TIER-06 test, paper://section/{N} bounds-check).

## Issues Encountered

- SDK v1.29 error propagation behavior was different from plan's expected `assert.rejects` pattern. Diagnosed from SDK source (mcp.js catch block). Test pattern adapted to `res.isError === true` assertion which is correct for this SDK version.

## Next Phase Readiness

- 02-05 (doctor probes): `bin/lib/capabilities.ts::loadCapabilityFacts()` is the shared capability source; doctor probes populate the `pandoc/zotero_mcp/humanizer/onedrive_detected/sync_folder_match` fields
- 02-07 (tier-contract): `mcp/server.ts::buildServer(paperRoot)` is exported and ready for in-process testing via InMemoryTransport; stdio path confirmed working with the same `buildServer` + `StdioServerTransport`
- All Wave 1 chokepoints (D-09/D-10/D-12) are silent on shipped code — handlers are structurally compliant

---
*Phase: 02-tier-shells-doctor-tier-contract-gate*
*Completed: 2026-05-16*
