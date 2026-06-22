# Phase 0: Repo skeleton & plugin manifest — Discussion Log

**Mode:** `--auto` (autonomous; no interactive prompts)
**Date:** 2026-05-06

This phase ran under `--auto`. No interactive AskUserQuestion calls were made. Every gray area was resolved with the recommended default and logged in `00-CONTEXT.md` under the "Auto-mode audit log" section.

## Areas auto-resolved

| Area | Question | Selected (recommended default) |
|------|----------|--------------------------------|
| TS build pipeline | Compile to `dist/` vs tsx-only vs Node 22 native strip? | `tsc` → `dist/` with `tsx` for dev |
| Lint chokepoints | How to enforce no-fetch-outside-`http.ts` and no-`/^10\./`-outside-`doi.ts`? | `no-restricted-imports` + `no-restricted-syntax` + red-team fixture |
| CI matrix | Which OS × Node combinations? | linux-x64 + macos-arm64 + windows-x64 × Node 20.10 only |
| Package manager | npm vs pnpm vs bun? | npm |
| ESLint config | Flat vs legacy `.eslintrc`? | Flat (`eslint.config.js`) |
| README scope | Stub or full v0.1.0 README at Phase 0? | Stub; full README in Phase 6 |
| Plugin manifest values | Name, version, author, license? | Mechanical pull from PROJECT.md / CLAUDE.md |
| MCP entry | Where does `.mcp.json` point? | `dist/mcp/server.js` (stub server in Phase 0; resources Phase 2) |
| Source-tree skeleton | What dirs exist on day 0? | All architectural directories with `.gitkeep` |

## Deferred ideas captured
- Node 22 native TS strip in CI (v0.2)
- Codecov / coverage thresholds (Phase 1)
- Bundling for plugin distribution (re-evaluate later)
- Pre-commit hooks (Phase 1)
- Full v0.1.0 README with disclaimer (Phase 6)
- GitHub repo settings (branch protection, CODEOWNERS) (Phase 6 launch prep)

## Scope creep redirected
None — Phase 0's scope was tight. No suggestions surfaced that belonged in other phases.

## Notes for future phases
- The lint chokepoint red-team fixture (D-08) is a precedent: every architectural invariant in pensmith ships with a test that *fails when the invariant breaks*. Tier-contract test (Phase 2), section-isolation mtime test (Phase 3), zero-trace export test (Phase 6) all follow this pattern.
- D-19's "stub README only at Phase 0" decision means the planner must NOT write disclaimer text or feature claims into the Phase 0 README. The disclaimer is load-bearing per CLAUDE.md and belongs where the export pipeline that requires it lives.

---

*Phase: 0-repo-skeleton-plugin-manifest*
*Logged: 2026-05-06*
