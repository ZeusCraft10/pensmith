# Phase 16: CI/DX parity + docs & packaging - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area defaults auto-accepted, grounded in the 2026-06-22 review's CI-parity + docs findings + the v0.1.0 retrospective's "local==CI" lesson

<domain>
## Phase Boundary

The final v0.2.0 phase — make local==CI, harden the CI gate against the stale-artifact class that caused 3 of 5 v0.1.0 ship breaks, and ship the real user-facing docs.

- **CI-01:** `npm run check` mirrors CI exactly (prebuild-first) so a green local run implies a green CI run.
- **CI-02:** a fresh-clone CI job asserts `git status --porcelain` is clean after build (catches stale derived-file drift).
- **CI-03:** CI runs the suite under non-TTY / detached stdin + a coverage gate (c8 thresholds).
- **DOCS-01:** README ships real install + `/pensmith` quick start + the PRD §3 dual-use disclaimer; the §3 disclaimer also surfaces at intake.
- **DOCS-02:** the four stub workflow bodies (doctor/status/next/resume) are filled; stale "Phase 3+/ships in Phase 6" copy in the doctor probes, PRIVACY.md, CONTRIBUTING.md is refreshed.
- **DOCS-03:** test-only deps (`nock`) move out of `dependencies`; `http-mock.ts` is excluded from the shipped `dist/` tree (IF it is test-only — confirm at research).

This closes v0.2.0. No new product features.
</domain>

<decisions>
## Implementation Decisions

### CI-01 — prebuild-first npm run check (package.json)
- `check` is currently `lint && typecheck && build && test:tier-contract && test && validate:manifests`. lint+typecheck run BEFORE build, but the gitignored generated sources (`bin/lib/version.generated.ts`, `verbs.json`) are produced by build's `prebuild` hook — so on a fresh checkout `npm run check` could lint/typecheck against absent generated files (exactly the v0.1.0 CI break). Fix: make `check` run `npm run prebuild` FIRST: `prebuild && lint && typecheck && build && test:tier-contract && test && validate:manifests`. After this, the local `check` order matches `ci.yml` (prebuild→lint→tsc→build→tier-contract→test→validate). Optionally a tiny test/CI assertion that the two orderings agree.

### CI-02 — fresh-clone porcelain-clean CI job (ci.yml)
- Add a CI job (or step) that, after `npm ci` + `npm run check`, asserts `git status --porcelain` is EMPTY — i.e. the build/prebuild produced no untracked or modified tracked files. This catches the stale-derived-file class. PREREQUISITE: the generated files (`version.generated.ts`, `verbs.json`) MUST be gitignored (they are) so prebuild output never dirties the tree. If the assertion fails, CI fails with the offending paths printed. Keep it in the existing 3-OS matrix (or at least one OS) — a fresh checkout is what every CI run already is, so this is a `git status --porcelain` step at the end.

### CI-03 — coverage gate + non-TTY stdin (ci.yml + package.json + .c8rc or equivalent)
- Add c8 coverage (`c8 --check-coverage` with sane thresholds — start modest, e.g. lines/functions/branches at a level the current suite already meets, so it's a ratchet not a wall) as a CI step + a `test:coverage` script. Pick thresholds from the current measured coverage minus a small margin (a regression gate), not an aspirational number.
- Run the suite under NON-TTY / detached stdin in CI (the prompts read `process.stdin.isTTY`; CI's stdin is already non-TTY, but add an explicit `< /dev/null` or detached-stdin run so the prompt short-circuit path is exercised — the v0.1.0 unref'd-timer hang was a non-TTY-stdin bug). At minimum a CI step / test asserting the prompts short-circuit when `!isTTY`.

### DOCS-01 — real README + intake disclaimer (README.md, intake)
- README (currently a 19-line stub with stale "v0.1.0 in development"/"Phase 6" copy) ships: a one-paragraph what-it-is, install (Claude Code plugin + portable CLI), the SINGLE-COMMAND `/pensmith` quick start (per the non-negotiable — `/pensmith` is the only command in the quick start), a brief 16-verb power-user reference, the GSD credit (PRD §18), and the PRD §3 dual-use disclaimer VERBATIM (the README disclaimer is the ONLY disclosure mechanism — non-negotiable). Keep "honest framing" (never "undetectable").
- The §3 disclaimer also surfaces at intake (intake.ts / workflows/new.md) — print it so a CLI-only user who never reads the README still sees it.

### DOCS-02 — fill stub workflow bodies + refresh stale copy
- Fill `workflows/{doctor,status,next,resume}.md` (the 23-line stubs that bare `/pensmith` routes to) with real bodies matching the established workflow-body shape (capability_check blocks, the verb's actual behavior, tier degradation). doctor → run the doctor probes; status → render STATE; next → the router's next-action; resume → HANDOFF restore. Keep the 16-verb/16-body bijection + tier-contract parity intact.
- Refresh stale copy: the doctor probes' "Phase 3+/will be unavailable" lines (those verbs shipped), PRIVACY.md's "ships with v0.1.0/Phase 2" placeholders, CONTRIBUTING.md's stale "ships in Phase X" lines — replace with shipped reality. NOTE: doctor-output.md / honesty-framing.md / CONTRIBUTING.md Tier-contract section may be HASH-PINNED locked copies — if a refresh touches a pinned file, re-pin per WN-3 (update the pin site in the same commit). Confirm which docs are pinned at research.

### DOCS-03 — packaging cleanup (package.json, tsconfig/dist)
- Move `nock` from `dependencies` → `devDependencies` (it's test-only).
- `bin/lib/http-mock.ts`: if it is TEST-ONLY (only imported by tests), exclude it from the shipped `dist/` (tsconfig exclude, or relocate to tests/). If it is imported by PRODUCTION adapter code (the cassette/offline path), it must stay in dist — in that case DOCS-03 is just the nock move + a note. CONFIRM at research which it is before excluding (Phase-2/3 notes called it a "production-tree chokepoint").

### Invariants
- 16-verb/16-body bijection + tier-contract parity unchanged (DOCS-02 fills bodies, doesn't add verbs). Zero-trace / verifier gate / honest framing not regressed. The new CI must stay GREEN on the 3-OS matrix (these changes are config + docs — confirm the porcelain + coverage gates pass before relying on them). Any pinned-doc edit re-pins in the same commit.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json` scripts (`check` line 26, `prebuild` 19, `build` 20) — CI-01 + DOCS-03 (deps).
- `.github/workflows/ci.yml` (prebuild step 40-41, the 3-OS matrix) — CI-02 + CI-03.
- `scripts/prebuild.mjs` (generates version.generated.ts + verbs.json, both gitignored) — the prebuild-first source.
- `workflows/{doctor,status,next,resume}.md` (23-line stubs) + the existing FULL workflow bodies (intake/research/etc.) as the shape model — DOCS-02.
- `bin/cli/doctor*` / the doctor probes (stale "Phase 3+" copy) — DOCS-02 refresh.
- `README.md` (19-line stub), `PRIVACY.md`, `CONTRIBUTING.md` — DOCS-01/02. PRD §3 (disclaimer) + §18 (GSD credit) are the source copy.
- `bin/cli/intake.ts` / `workflows/new.md` — DOCS-01 intake disclaimer.
- `bin/lib/http-mock.ts` + its importers — DOCS-03 (determine test-only vs production).
- WN-3 hash-pin mechanism (repo-files.test.ts + prompt-loader.ts) — if a refreshed doc is pinned.

### Established Patterns
- The v0.1.0 CI work already made CI prebuild-first (ci.yml:40); CI-01 aligns the LOCAL `check` to it.
- Generated files gitignored (.gitignore) — prerequisite for the porcelain gate.
- Workflow-body shape: capability_check + tier degradation + the verb's behavior (16 bodies bijective with UX02_VERBS).

### Integration Points
- package.json (check + deps), ci.yml (porcelain + coverage + non-TTY), README/PRIVACY/CONTRIBUTING, workflows/{doctor,status,next,resume}.md, doctor probes, intake.
</code_context>

<specifics>
## Specific Ideas

- CI-01: `npm run check` runs prebuild first; green local ⇒ green CI (ordering matches ci.yml).
- CI-02: fresh-clone CI step asserts `git status --porcelain` empty after build.
- CI-03: c8 coverage gate (regression thresholds) + non-TTY stdin suite run.
- DOCS-01: real README (install + /pensmith quickstart + §3 disclaimer verbatim + GSD credit); §3 disclaimer at intake.
- DOCS-02: doctor/status/next/resume bodies filled (bijection intact); stale Phase-X copy refreshed (re-pin if pinned).
- DOCS-03: nock → devDependencies; http-mock.ts out of dist IF test-only.
</specifics>

<deferred>
## Deferred Ideas

- Live-path smoke CI (real Pandoc/pymupdf/adapter round-trip) — LIVE-01 → v2/Future.
- Verb/flag reference CARD as a separate doc — REF-01 → v2/Future (the README's 16-verb reference covers the basics).
- Replacing pdf-parse / worker-thread PDF abort (WR-05 residual) — v2/Future.
- DNS-rebinding socket-pinning (WR-03 residual) — v2/Future.
</deferred>
