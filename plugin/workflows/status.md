# pensmith status

> Report current paper state: per-section progress table + resolved next action.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct readFileSync('.paper/STATE.json') + direct readFileSync of each section PLAN.md
</capability_check>

## Overview

`pensmith status` is a read-only verb. The paper root is the project folder that
contains `.paper/` (RUN-13): `--paper <name|path>` or `PENSMITH_PAPER_ROOT`, else the
current folder when it holds `.paper/`, else the `pensmith open` pointer — a read-only
verb may use the pointer, and then prints `(active paper "<name>" at <path>)` on stderr
first (RUN-14). A pre-v1 paper with a root-level `STATE.json`/`config.toml` has them
moved into `.paper/` once, with a one-line notice.

It loads `.paper/STATE.json` via `loadState()`
(C4-HIGH: `StateNotFoundError` → prints "no active paper"; any other error → prints
"STATE.json unreadable/corrupt"). Then it walks each section via `readSectionInfo()`
(C6-HIGH guarded path — the versioned PLAN.md reader, read without write-back; never a raw
`parseFrontmatter(readFileSync(planPath))`). Finally
it calls `resolveNextAction()` (never throws — C3-HIGH-1 totality invariant) and prints
the "next:" line. stdout-only; it never writes paper state, and it never takes the
session lock, so it works while another session is running (RUN-23).

## Outputs

- stdout: per-section status table + `  next: <verb>` line (+ an `  attention: …` line when the router stopped on a problem, or a `  note: …` line when it finished with a detail — an outline-only paper whose outline is approved)
- exit code 0 when a paper was reported; 1 (EXIT_ERROR) when there is no paper
  here or `.paper/STATE.json` is unreadable (RUN-09)

## Body

1. **Load STATE.json** via `loadState(paperRoot)` (`bin/lib/state.ts`, which resolves `<paperRoot>/.paper/STATE.json`). On `StateNotFoundError`: print "no active paper" and return. On any other error: print "STATE.json unreadable/corrupt" and return.

2. **Walk sections** (from `state.sections ?? []`, ordered by section id — `(n, suffix)`, so `§1`, `§1a`, `§1b`, `§2`). Each section's folder is found by its slug. For each section, call `readSectionInfo(sectionPlan(n, slug, paperRoot))` (`bin/lib/router.ts` — C6-HIGH: the SINGLE guarded per-section read path). Render the row as `§<id>` (`§3`, `§1a`) with:
   - `absent` → "not planned"
   - `corrupt` → "corrupt/unreadable PLAN.md — needs attention"
   - the outline's stub PLAN.md (`stub: true`) → "outlined (not planned)"
   - `failed` with a `failure_reason` → "failed — <reason>" (e.g. `failed — citekey X not assigned to section 2`)
   - else → `r.status`

3. **Resolve next action** via `resolveNextAction(paperRoot, routeOptionsFor(paperRoot))` — `stopAfterResearch` derived via `readGoalFromConfig(paperRoot)`, `stopAfterOutline` from `[project] mode = "outline"`. Never throws. Print `  next: <verb>` (or `<verb> §<id>` for per-section verbs — a stub routes to `plan`, a planned section to `write`). When the router stops on something that needs the user, print `  attention: <detail>` naming the problem and the command that fixes it — e.g. a rejected outline (`the last outline was rejected (the replies are in .paper/OUTLINE.rejected.md) — fix the problem it names, then run \`pensmith outline\``) or a section whose draft containment failed (`section N failed: <reason> — adjust its plan or sources if needed, then run \`pensmith write N\``). The router never re-runs a rejected outline by itself.

4. Shell fallback (TIER-06): `pensmith status`.
