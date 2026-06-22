---
phase: 10-discipline-citation-style-breadth-zotero-mcp
plan: 03
subsystem: research-sources + doctor + discipline-presets
tags: [RSCH-06, CITE-02, zotero-mcp, source-provider, doctor-probe, disciplines]
requires:
  - "10-00 (RED tests + bundled CSL files + injected-client leg-c contract + disciplines RED)"
  - "bin/lib/schemas/source-candidate.ts (D-14 discriminated union)"
  - "bin/lib/ecosystem-presence.ts isZoteroMcpPresent()"
  - "bin/lib/citekey.ts generateCitekey"
  - "bin/lib/citation-density.ts DISCIPLINE_TARGETS (mirrored, not modified)"
provides:
  - "bin/lib/sources/zotero-mcp.ts — presence(-or-injected-client)+key-auth-gated Zotero source adapter (search, isZoteroAuthenticated, setZoteroClientForTest)"
  - "'zotero-mcp' SourceCandidate union variant (D-14)"
  - "'zotero-mcp' entry in the sources registry (AdapterName auto-expands)"
  - "tri-state zotero-mcp-presence doctor probe (ABSENT/CONFIGURED_NO_AUTH/PASS)"
  - "disciplines.json complete to the 6-field PRD §8 schema (CS→ieee)"
affects:
  - "10-04 (workflow capability_check wiring + tier-contract parity owns the research.md Zotero client injection)"
  - "downstream research orchestrator (zotero-mcp now flows through generic 'search' in adapter iterators)"
tech-stack:
  added: []
  patterns:
    - "Injectable transport seam (ZoteroClient interface + module-level _client + setZoteroClientForTest) — MCP transport lives in Tier-1, not the Tier-2 adapter"
    - "Canonical 4-gate predicate (presence/auth/no-client/pull+normalize) as single source of truth quoted verbatim by the 10-00 leg-c test"
    - "Doctor probe composes its OWN presence+key check (decoupled from the adapter's key-only auth helper) to report real FS+key state"
key-files:
  created:
    - "bin/lib/sources/zotero-mcp.ts"
  modified:
    - "bin/lib/schemas/source-candidate.ts"
    - "bin/lib/sources/index.ts"
    - "bin/lib/doctor/probes/zotero-mcp-presence.ts"
    - "tests/doctor-probes.test.ts"
    - "templates/presets/disciplines.json"
decisions:
  - "Adapter's isZoteroAuthenticated() is KEY-ONLY (decoupled from FS-presence per H3) so the injected-client CI path is authorizable with just ZOTERO_API_KEY; the doctor probe deliberately does NOT reuse it — it composes isZoteroMcpPresent() && key inline to distinguish ABSENT from CONFIGURED_NO_AUTH"
  - "D-12 chokepoint forces DOT-ACCESS env reads in doctor probes (process.env.ZOTERO_API_KEY), not computed process.env['ZOTERO_API_KEY'] — both literal and variable subscripts trip the no-restricted-syntax selector; matched contact-email-presence.ts pattern"
  - "An injected _client is a valid presence signal (canonical gate 1) so the offline test drives the present+auth branch without writing a real mcp_servers.json"
  - "densityTarget.center mirrors citation-density.ts DISCIPLINE_TARGETS centers; citation-density.ts keeps its own map (RESEARCH Option B, module untouched)"
metrics:
  duration: "~6 min"
  completed: "2026-06-22"
  tasks: 3
  files: 6
---

# Phase 10 Plan 03: Zotero MCP source provider + tri-state doctor probe + disciplines depth Summary

Shipped RSCH-06 as an EXECUTABLE used-as-source path — a presence(-or-injected-client)+key-authenticated Zotero adapter that actually pulls items via an injectable `ZoteroClient` and normalizes each to a `source:'zotero-mcp'` `SourceCandidate`, returning `[]` (never throwing) on every absence path — plus the tri-state `zotero-mcp-presence` doctor probe and the 6-field PRD §8 `disciplines.json` (CS corrected apa→ieee).

## What was built

- **Task 1 (commit 58d652b):** Added the 8th `z.literal('zotero-mcp')` variant to the D-14 `SourceCandidateSchema` discriminated union; created `bin/lib/sources/zotero-mcp.ts` encoding the CANONICAL 4-GATE PREDICATE verbatim — (1) presence `!isZoteroMcpPresent() && _client === null → []`, (2) key-only auth `!isZoteroAuthenticated() → []`, (3) no-client `_client === null → []`, (4) `try { _client.search → map(toCandidate).filter } catch { return [] }` — with a `toCandidate` mirroring `semanticscholar.toCandidate` (require id/title/≥1 author, year bounded 1800–2100, `generateCitekey`, `raw:item`), the `ZoteroClient`/`ZoteroItem` interfaces, `setZoteroClientForTest` injection seam, and key-only `isZoteroAuthenticated`. Registered `'zotero-mcp'` in `sources/index.ts`. No http.ts / citation-js import.
- **Task 2 (commit 798082e):** Upgraded the doctor probe to tri-state — ABSENT (WARN, `Checked:` retained), CONFIGURED_NO_AUTH (WARN, `Checked:` + `ZOTERO_API_KEY not found`), configured+authenticated (PASS) — composing its own `isZoteroMcpPresent() && !!process.env.ZOTERO_API_KEY` check inline; added a SENTINEL no-leak test proving the key value never appears in `JSON.stringify(result)`.
- **Task 3 (commit 8c06a81):** Completed all 9 `disciplines.json` entries to the 6 PRD §8 fields (`defaultTone`, `defaultCitationStyle`, `sourcePreference`, `sectioningConvention`, `counterargDefault`, `densityTarget`); corrected computer-science `apa→ieee`; `densityTarget.center` mirrors `DISCIPLINE_TARGETS`; every `defaultCitationStyle` resolves to a bundled `.csl`.

## Verification results

- `tests/sources/zotero-mcp.test.ts` — 4/4 GREEN (existence, absent→[] no-throw, registry, present+authenticated injected-client → ≥1 normalized `'zotero-mcp'` candidate + inverse null-client+no-key → []).
- `tests/doctor-probes.test.ts` — 14/14 GREEN (existing PASS/WARN + `Checked:` assertion retained; new tri-state + SENTINEL no-leak).
- `tests/disciplines-schema.test.ts` — 4/4 GREEN (6 fields on all 9 entries, CS=ieee, every densityTarget has low/center/high).
- `npm run lint` (full project) clean; `tsc --noEmit` clean; `npm run test:tier-contract` 46/46; full suite 854 pass / 0 fail / 0 skip.
- Adapter imports neither http.ts nor citation-js (only the `citation-js` mention is in the header comment documenting the ban).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] D-12 doctor-probe env-read chokepoint forced dot-access**
- **Found during:** Task 2 (probe verify step).
- **Issue:** The plan action specified `!!process.env[API_KEY_ENV]` for the probe's auth check. The D-12 ESLint `no-restricted-syntax` selector forbids ANY computed `process.env[...]` member read in doctor probes (only `runtime-config-presence.ts` is exempted) — it tripped on both the variable subscript and a literal-string subscript `process.env['ZOTERO_API_KEY']`.
- **Fix:** Switched to dot-access `process.env.ZOTERO_API_KEY` (the same chokepoint-safe pattern `contact-email-presence.ts` uses). `API_KEY_ENV` is retained for the env-var NAME in summary/detail/fix strings (never the value), preserving T-01-07.
- **Files modified:** bin/lib/doctor/probes/zotero-mcp-presence.ts
- **Commit:** 798082e

## Known Stubs

None. The adapter's `[]`-on-absence returns are the documented absence-non-breaking contract (ARCH-03), not stubs — the present+authenticated+client path is the real executable normalization path proven by the injected-client test. The live end-to-end against a real Zotero MCP server remains a documented MANUAL-only item (no CI coverage of the MCP transport; the workflow-body client injection lands in 10-04).

## Self-Check: PASSED

- bin/lib/sources/zotero-mcp.ts — FOUND
- bin/lib/schemas/source-candidate.ts ('zotero-mcp' variant) — FOUND
- bin/lib/sources/index.ts ('zotero-mcp' registered) — FOUND
- bin/lib/doctor/probes/zotero-mcp-presence.ts (tri-state) — FOUND
- templates/presets/disciplines.json (6-field, CS=ieee) — FOUND
- Commit 58d652b — FOUND
- Commit 798082e — FOUND
- Commit 8c06a81 — FOUND
