# pensmith list

> Show every paper in the cross-project global registry, grouped by class, with
> each paper's lifecycle status DERIVED at display time from its authoritative
> STATE.json (never a stale stored flag). The read-only library overview verb.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct read of the global registry index + each paper's STATE.json from disk (the bin/cli/list.ts CLI path)
</capability_check>

## Overview

`pensmith list` is one of the four library/ergonomics verbs (list / open / sketch
/ add) promoted from Phase-2 stubs. It reads the GLOBAL paper registry at
`pensmithDataDir()/library/index.json` (LIB-01 — distinct from the per-paper
`.paper/LIBRARY.json` source store, D-59) and prints every registered paper
grouped by its `class`, with a live lifecycle status per paper.

The implementation lives in `bin/cli/list.ts` (`listCommand`) delegating to
`bin/lib/global-library.ts` (`loadGlobalLibrary` + `deriveLibraryStatus`). Both
Tier 1 (plugin) and Tier 2 (CLI) run the SAME code — Tier 1 may surface the
registry via the MCP state resource; Tier 2 reads the index + each paper's
STATE.json directly. There is no `pensmith_list` MCP tool (the Tier-1 surface is
THIS workflow body delegating to the same `bin/cli/list.ts` path — the documented
compile/done precedent that keeps the locked 16 verbs bijective with the 16
workflow bodies).

**DERIVE-AT-DISPLAY (Open-Q4 / LIB-05).** list NEVER prints the stored
`entry.status`. It computes each paper's live stage from that paper's
authoritative STATE.json + section PLAN.md frontmatter. The stored status feeds
`deriveLibraryStatus` ONLY so the terminal `archived` flag (the one stage with no
on-disk marker) is honored. A paper that advanced out-of-band shows its REAL
stage; the status can never drift stale (T-08-01-06).

## Outputs

- stdout only — a grouped, human-readable listing:
  `  [<class>]` then one `    <name> (<status>)  <folderPath>` line per paper.
- The status cell renders `sectioning X/Y` when a paper is mid-sectioning
  (X = sections past `planned`, Y = total sections), else the bare 7-state
  lifecycle value (`intake` / `research` / `outline` / `sectioning` / `compile`
  / `done` / `archived`).
- NO files written — `list` is strictly read-only.

## Body

1. **Load the global registry** (LIB-02): call `loadGlobalLibrary()`. It
   auto-inits on ENOENT (first use → empty index, never an error). An empty or
   absent registry prints the friendly `no papers yet — run \`pensmith new\` to
   start.` line and returns.

2. **Group by class** (LIB-02): bucket `lib.entries` by `entry.class`
   (defaulting to `Unfiled`). A `Map` preserves on-disk order so the output is
   deterministic for a given registry.

3. **DERIVE each paper's status** (LIB-05): for EACH entry call
   `deriveLibraryStatus(entry.folderPath, entry.status)`, which mirrors
   `router.resolveNextAction`'s on-disk stage machine onto the 7-state
   vocabulary and computes the real `sectioning {done, total}`. The stored
   status is consulted ONLY for the terminal `archived` flag.

4. **Never crash** (T-08-01-05): `deriveLibraryStatus` is already never-throw,
   and `list` ALSO wraps each per-entry derivation in a belt-and-suspenders
   try/catch → `unknown` (the Phase-7 `readSectionState` discipline). Reading N
   papers' STATE.json must NEVER abort the whole list — one bad paper renders as
   `unknown` and the listing continues.

5. **Shell fallback** (TIER-06 equivalence path): `pensmith list`. No flags,
   no mutation, deterministic output for a given registry state.
