# Phase 16: CI/DX parity + docs & packaging — Research

**Researched:** 2026-06-24
**Domain:** CI configuration, coverage tooling, workflow documentation, packaging cleanup
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CI-01 — prebuild-first `npm run check`:**
`check` currently runs `lint && typecheck && build && test:tier-contract && test && validate:manifests`. Fix: prepend `npm run prebuild`. Final: `prebuild && lint && typecheck && build && test:tier-contract && test && validate:manifests`. This aligns local order with ci.yml's step sequence.

**CI-02 — porcelain-clean assertion in ci.yml:**
After `npm run check`, assert `git status --porcelain` is empty. Generated files (`version.generated.ts`, `verbs.json`) are already gitignored — prerequisite confirmed. Keep in the 3-OS matrix (or at minimum one OS).

**CI-03 — c8 coverage gate + non-TTY stdin:**
Add `c8 --check-coverage` with regression-ratchet thresholds (current measured coverage minus small margin). Add `test:coverage` script. Run suite under non-TTY/detached stdin (`< /dev/null` or equivalent) in CI. At minimum a CI step asserting the prompts short-circuit when `!isTTY`.

**DOCS-01 — real README + intake disclaimer:**
README ships: what-it-is paragraph, install (plugin + CLI), `/pensmith` quick-start (only command in quick-start), 16-verb power-user reference, GSD credit (PRD §18), PRD §3 disclaimer verbatim. §3 disclaimer also surfaces at intake (intake.ts / workflows/new.md). Keep honest framing ("improves readability" — never "undetectable").

**DOCS-02 — fill stub workflow bodies + refresh stale copy:**
Fill `workflows/{doctor,status,next,resume}.md` with real bodies (capability_check + tier degradation + real behavior). Refresh stale copy in doctor probes, PRIVACY.md, CONTRIBUTING.md. Re-pin any hash-pinned file touched in the same commit.

**DOCS-03 — packaging cleanup:**
Move `nock` from `dependencies` → `devDependencies`. `http-mock.ts`: if test-only, exclude from dist; if production-imported, keep in dist (just nock move + note). CONFIRM at research.

### Claude's Discretion
None stated beyond the locked decisions above.

### Deferred Ideas (OUT OF SCOPE)
- Live-path smoke CI (LIVE-01) — v2/Future
- Verb/flag reference CARD as separate doc (REF-01) — v2/Future
- Replacing pdf-parse / worker-thread PDF abort (WR-05 residual) — v2/Future
- DNS-rebinding socket-pinning (WR-03 residual) — v2/Future
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CI-01 | `npm run check` mirrors CI exactly (prebuild-first), so a green local run implies a green CI run | Confirmed: `check` script (package.json:26) is missing `prebuild` prefix; ci.yml:40-41 already runs prebuild as a named step before lint |
| CI-02 | Fresh-clone CI job asserts `git status --porcelain` is clean after build, catching stale derived-file drift | Confirmed: `.gitignore` covers both generated files; `git status --porcelain` returns empty on clean tree; no other build artifacts left unignored |
| CI-03 | CI runs the suite under non-TTY / detached stdin and adds a coverage gate (c8 thresholds) | Confirmed: c8@11.0.0 already in devDependencies; existing `coverage` script uses wrong name; measured baseline is lines:90.3 / functions:77.26 / branches:87.28 |
| DOCS-01 | README ships real install + `/pensmith` quick-start + PRD §3 disclaimer; §3 disclaimer also surfaces at intake | Confirmed: README is a 19-line stub with stale assertions; §3 and §18 text extracted verbatim from PRD; no disclaimer currently printed at intake |
| DOCS-02 | Four stub workflow bodies filled; stale Phase-X copy refreshed | Confirmed: doctor/status/next/resume.md are 23-line stubs; real impls in doctor.ts, status.ts, router.ts, resume.ts fully documented; stale copy locations identified precisely |
| DOCS-03 | Test-only deps out of `dependencies`; `http-mock.ts` excluded from dist if test-only | VERDICT: `http-mock.ts` IS imported by 7+ production modules in `bin/lib/sources/`, `bin/lib/honesty.ts`, `bin/lib/plagiarism.ts`, `bin/lib/verify/freshness.ts` — it MUST stay in dist. DOCS-03 = nock move only |
</phase_requirements>

---

## Summary

Phase 16 closes v0.2.0 with three clusters: CI hardening (CI-01/02/03), documentation (DOCS-01/02), and packaging (DOCS-03). All six requirements are mechanical changes with zero new product features. The research surfaces precise file:line evidence for every change and identifies two non-obvious constraints that would cause plan failures if missed.

**The most important finding is DOCS-03:** `bin/lib/http-mock.ts` is imported by seven production modules across `bin/lib/sources/` (all source adapters: arxiv, crossref, openalex, pubmed, retraction-watch, semanticscholar, unpaywall), `bin/lib/honesty.ts`, `bin/lib/plagiarism.ts`, and `bin/lib/verify/freshness.ts`. This is the cassette-based offline/online mode switching mechanism that ALL adapters use in CI. Excluding it from dist would break the shipped CLI entirely. DOCS-03 is therefore nock → devDependencies only; no dist exclusion is possible without a major architecture change (deferred).

**The second non-obvious finding is the DOCS-01/DOCS-02 re-pin cascade.** `tests/repo-files.test.ts` has three inline `assert.match` assertions that would fail if README is updated naively: it asserts `README.md` contains `/v0\.1\.0 in development/` (line 91) and `/Phase 6/` (line 92). These MUST be updated when the real README lands. Additionally, `references/doctor-output.md` is byte-pinned at SHA-256 `509f90ad...` (line 179) — touching it requires re-pinning in the same commit. README/PRIVACY/CONTRIBUTING are NOT byte-pinned (only substring-matched), so they can be replaced without SHA re-pin, but the specific substrings that currently match must be cleaned up.

**Primary recommendation:** Execute the six requirements as six focused tasks in wave order: CI-01 (one-line package.json change), CI-02 (one ci.yml step), CI-03 (script rename + .c8rc.json + two ci.yml steps), DOCS-03 (one-line deps move), DOCS-01 (README + intake), DOCS-02 (four workflow bodies + stale copy refresh + doctor-output.md re-pin).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CI order fix (CI-01) | Build tooling | — | package.json script change only; no code or CI YAML needed beyond the one-word prepend |
| Porcelain gate (CI-02) | CI (GitHub Actions) | — | Shell assertion in ci.yml; no source code change |
| Coverage measurement (CI-03) | CI + Build tooling | — | c8 in devDeps, script rename, .c8rc.json, ci.yml step |
| Non-TTY stdin gate (CI-03) | CI + Tests | — | `< /dev/null` in CI step; optional isTTY assertion test |
| README content (DOCS-01) | Documentation | — | Static file; the §3 disclaimer must appear verbatim |
| Intake §3 disclaimer (DOCS-01) | CLI (Tier 2) | Workflow body (Tier 1) | intake.ts prints disclaimer at run start; workflows/new.md documents it for Tier 1 |
| Workflow body fill (DOCS-02) | Documentation | — | Static workflow `.md` files; no code changes |
| Stale copy refresh (DOCS-02) | Documentation | — | doctor probes, PRIVACY.md, CONTRIBUTING.md; doctor-output.md needs re-pin |
| nock dep move (DOCS-03) | Build tooling | — | One-line package.json change |
| http-mock.ts dist decision (DOCS-03) | Production code (confirmed) | — | Must stay in dist; nock move only |

---

## Standard Stack

### Core (this phase — all already installed)

| Library | Version in devDeps | Purpose | Why Standard |
|---------|------|---------|--------------|
| `c8` | `^11.0.0` [VERIFIED: npm registry] | V8-native coverage — no instrumentation overhead | Already in devDependencies; used by existing `coverage` script |
| Node.js `--test` | built-in (Node 20.10) | Test runner already in use | `scripts/run-tests.mjs` already invokes it |

### No new packages needed

All tooling is already installed. The only package movement is `nock ^14` from `dependencies` → `devDependencies`.

### Installation

```bash
# No new installs — just the dep move:
npm pkg delete dependencies.nock
npm pkg set devDependencies.nock='^14'
```

---

## Package Legitimacy Audit

No new packages are installed in this phase. The only change is moving `nock ^14` from `dependencies` to `devDependencies` — it is already installed and already in use. No slopcheck run needed (no new package names).

| Package | Action | Disposition |
|---------|--------|-------------|
| `nock ^14` | Move from `dependencies` → `devDependencies` | Approved — already installed, well-established package |
| `c8 ^11.0.0` | Already in `devDependencies` — add `test:coverage` script only | Approved — already installed |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### CI-01: Fix `check` Script Order

**Current state** (`package.json:26`):
```json
"check": "npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests"
```

**Problem:** `lint` and `typecheck` run before `build`, which runs `prebuild` as its npm lifecycle hook. On a clean checkout (no prior build), `bin/lib/version.generated.ts` and `bin/lib/verbs.json` do not exist yet. `tsc --noEmit` fails with `TS2307 Cannot find module './version.generated.js'`. This is exactly the v0.1.0 CI break class.

**CI order** (`ci.yml:40-53`):
1. `npm run prebuild` (step 40-41) — explicit named step
2. `npm run lint` (step 43)
3. `npx tsc --noEmit` (step 45)
4. `npm run build` (step 47-48)
5. `npm run test:tier-contract` (step 50-51)
6. `npm test` (step 53)
7. `node scripts/validate-plugin-manifest.cjs` (step 55-56)

**Fix** (one character change to `package.json`):
```json
"check": "npm run prebuild && npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests"
```

Note: `npm run build` already runs `prebuild` via its npm lifecycle hook (the `prebuild` script name is the npm pre-hook for `build`). Running `prebuild` explicitly as the first `check` step is safe — it is idempotent and fast (writes two small files). The redundant second invocation via `npm run build`'s lifecycle hook is harmless.

### CI-02: Porcelain-Clean Gate

**How:** Add a step after `npm run validate:manifests` in the existing `check` job.

```yaml
- name: Assert no uncommitted artifacts after build (stale-derived-file guard)
  shell: bash
  run: |
    status=$(git status --porcelain)
    if [ -n "$status" ]; then
      echo "FAIL: build/prebuild produced untracked or modified files:"
      echo "$status"
      exit 1
    fi
    echo "OK: working tree is clean after build."
```

**Prerequisite confirmed:** `.gitignore` already covers:
- `bin/lib/version.generated.ts` (line 6) — confirmed [VERIFIED: file read]
- `bin/lib/verbs.json` (line 6) — confirmed [VERIFIED: file read]
- `dist/` (line 2) — confirmed [VERIFIED: file read]
- `coverage/` (line 19) — confirmed [VERIFIED: file read]
- `/config.toml` (line 47) — confirmed [VERIFIED: file read]
- `mcp/__fixtures__/` (line 26) — confirmed [VERIFIED: file read]

**Files prebuild/build emit that must be gitignored to avoid false failures:**
All files emitted by `prebuild` (`version.generated.ts`, `verbs.json`) and `tsc` (`dist/`) are already covered. No additional `.gitignore` entries are needed.

**OS scope:** Run in the existing 3-OS matrix (`ubuntu-latest`, `macos-latest`, `windows-latest`). On Windows, `git status --porcelain` works correctly with `shell: bash` (Git Bash is available via `actions/setup-node`).

**Shell syntax note:** The `[ -n "$status" ]` pattern is POSIX sh portable. Using `shell: bash` in the step declaration ensures Bash semantics on all three OSes in GitHub Actions.

### CI-03: Coverage Gate + Non-TTY Stdin

**Existing script in package.json:27:**
```json
"coverage": "c8 node scripts/run-tests.mjs"
```
This already exists but is named `coverage` not `test:coverage`. The plan should rename it to `test:coverage` for consistency with the requirement, OR add a `test:coverage` alias.

**Measured baseline** (run 2026-06-24, `npx --no c8 --reporter=text node scripts/run-tests.mjs`):
```
All files   | 90.3 | 77.26 | 87.28 | 90.3
             Lines  Funcs  Branches Stmts
```

**Recommended thresholds** (5 percentage-point margin from measured):
- Lines: 85
- Functions: 72
- Branches: 82
- Statements: 85

These are ratchet values — the current suite already exceeds them. If coverage drops (a new file without tests), CI fails. Not aspirational.

**`.c8rc.json`** (preferred over CLI flags for auditability):
```json
{
  "reporter": ["text", "lcov"],
  "include": ["bin/**", "hooks/**", "mcp/**"],
  "exclude": ["tests/**", "scripts/**", "**/*.d.ts", "dist/**"],
  "all": true,
  "check-coverage": true,
  "lines": 85,
  "functions": 72,
  "branches": 82,
  "statements": 85
}
```

**`test:coverage` script:**
```json
"test:coverage": "c8 node scripts/run-tests.mjs"
```
(rename or alias from `coverage`)

**ci.yml step for coverage:**
```yaml
- name: Test suite with coverage gate (c8 — CI-03)
  run: npm run test:coverage < /dev/null
```

The `< /dev/null` detaches stdin, making `process.stdin.isTTY` false inside the test process. This exercises the isTTY short-circuit code paths in `bin/lib/prompts.ts:68`, `bin/cli/outline.ts:54`, `bin/cli/research.ts:198,251`, `bin/lib/honesty.ts:305`, and `bin/lib/revise.ts:223`. The existing test run (`npm test` step) can also get `< /dev/null` for defense-in-depth, but the coverage step covers it.

**Non-TTY test:** The suite already passes with `< /dev/null` on the local machine (verified 2026-06-24 — all tests passed). The prompts non-TTY short-circuit is exercised because `process.stdin.isTTY` is undefined/false when stdin is redirected from `/dev/null`.

### DOCS-01: Real README Structure

**Source of truth quotes from PRD (verbatim):**

**PRD §3 disclaimer** (must appear verbatim in README and at intake):
> `pensmith` is a structured research-and-drafting assistant for academic writing. It helps you turn an assignment prompt into a sourced outline or, optionally, a full draft, using only verifiable peer-reviewed and configurable academic sources. It includes a citation verifier that re-fetches every cited DOI and flags unsupported claims for human review, and a humanizer pass that improves readability.
>
> This tool is for your own writing, research, and learning. It is not a guarantee against AI detectors and it is not a substitute for doing the reading. Submitting fully tool-generated work as your own is, in many institutions, a violation of academic integrity policy. You are responsible for the work you submit.

**PRD §18 GSD credit** (must appear in README):
> `pensmith` is heavily inspired by [Get Shit Done](https://github.com/gsd-build/get-shit-done) by TÂCHES (Lex Christopherson) and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging by Jasper Nuyens. The skill / agent / MCP / workflow-body / HANDOFF.json patterns are theirs, and the section-as-phase mental model is a direct application of GSD's structured-workflow philosophy to academic writing. Domain (academic writing instead of code), command UX (single-command vs. per-stage), and implementation are independent.

**README structure (required sections, non-negotiable order):**
1. Title + one-paragraph what-it-is
2. Install — two tiers (Claude Code plugin: `/pensmith` slash command; portable CLI: `npm install -g pensmith` or `npx pensmith`)
3. Quick start — single command `/pensmith` ONLY (non-negotiable per CLAUDE.md)
4. 16-verb power-user reference (brief table)
5. GSD credit (PRD §18, verbatim)
6. Disclaimer (PRD §3, verbatim)

**Style Match section:** The current README already contains `## Style Match` with the dual-use disclosure (Phase 8). The STYL-04 test (`repo-files.test.ts:112`) checks `## Style Match` presence and honest framing. The real README MUST keep this section and the same honest framing to pass STYL-04.

**Test impact:** Updating README will break two existing assertions in `repo-files.test.ts`:
- Line 91: `assert.match(read('README.md'), /v0\.1\.0 in development/)` → WILL FAIL after update
- Line 92: `assert.match(read('README.md'), /Phase 6/)` → WILL FAIL after update

These assertions must be REMOVED or UPDATED in `tests/repo-files.test.ts` in the same commit that updates `README.md`. The test function is `'README, PRIVACY, README-DEV, CONTRIBUTING stubs are correct'` (line 90). The PRIVACY and README-DEV assertions in the same function are still valid and must be preserved.

**Intake disclaimer placement:** The §3 text should print at the top of the `pensmith new` run, before any prompts, so a CLI-only user who never reads the README still sees it. Placement: early in `intake.ts` run function, before the first `ask()` call, writing to `process.stdout`. The disclaimer is static copy — no need for a locked reference file (it does not need a hash pin because the PRD is already the canonical source). Also document the disclaimer in `workflows/new.md`'s `## Body` section.

### DOCS-02: Workflow Body Shape + Content

**Shape model** (from `workflows/compile.md`):
```markdown
# pensmith <verb>

> One-line description

<capability_check>
required:
  - MCP tool/resource needed in Tier 1

degrade_if_missing:
  - if no <tool>: fallback behavior in Tier 2
</capability_check>

## Overview

Short prose description of what the verb does, where the implementation lives, and tier notes.

## Outputs

Bullet list of files/state written.

## Body

Numbered steps the workflow executes. References bin/lib/* chokepoints.
```

**What each of the four stubs should describe:**

**`workflows/doctor.md`** — runs `runDoctor()` (bin/lib/doctor/probes.ts), renders with `renderTty()` or `renderJson()` (--json flag). No capability requirements (read-only, no MCP tools needed). Describes the 11 probes by category (DOCT-01..07 + ecosystem probes). References `references/doctor-output.md` as the locked string source. Exits 1 on FAIL.

**`workflows/status.md`** — reads `STATE.json` via `loadState()`, walks sections via the shared `readSectionState()` guard (imports from router.ts — C6-HIGH: never raw parseFrontmatter), calls `resolveNextAction()` for the next action. Degrade path: direct `readFileSync('.paper/STATE.json')`. Prints per-section status table + "next:" line. Read-only (no writes).

**`workflows/next.md`** — calls `resolveNextAction()` and dispatches the returned verb. Degrade path: direct `.paper/STATE.json` read. This is the bare `/pensmith` flow when called as the next-step resolver. Describes the state machine: new → research → outline → (plan → write → verify)* → compile → done.

**`workflows/resume.md`** — reads HANDOFF.json for summary only (never routes from it — H4), calls `resolveNextAction()` to get the next WORK verb (HANDOFF-blind), dispatches via `dispatchVerb()`, then clears HANDOFF.json (best-effort rmSync). Degrade path: direct `.paper/HANDOFF.json` + `.paper/STATE.json` reads. References the H4 invariant (no resume→resume loop).

**Stale copy in doctor probes:** `bin/lib/doctor/probes/http-crossref-ping.ts:32-33` contains:
```
summary: 'D-03(d) cassette wiring smoke deferred to Phase 3 (production-tree http-mock chokepoint not yet shipped)...'
fix: 'No action required in Phase 2. Phase 3 will land bin/lib/http-mock.ts...'
```
These strings are LOCKED in `references/doctor-output.md` and byte-pinned in `tests/repo-files.test.ts:179` (PINNED hash: `509f90add8664e559a3ab817684381777e1b624b63ebe0dfc77054267997eec0`). The probe's summary copy needs to be updated to reflect shipped reality ("http-mock.ts shipped in Phase 3 — probe is now active and exercises the cassette path"). This requires:
1. Update the copy in the probe source file
2. Update `references/doctor-output.md`
3. Recompute SHA-256 and update the `PINNED` constant in `tests/repo-files.test.ts:179`
All three edits in the same commit (WN-3 protocol).

**Stale copy in PRIVACY.md:** Current content (the entire file, 5 lines):
```
# Privacy
Pensmith is local-only. No telemetry, no cloud state, no remote logging.
The full privacy document — covering external API calls (OpenAlex, Crossref, arXiv, PubMed, Unpaywall, GPTZero, DuckDuckGo), the `PENSMITH_CONTACT_EMAIL` polite-pool requirement, PII redaction at intake, and humanizer/honesty-score data flows — ships with v0.1.0.
```
The last sentence is the stale "ships with v0.1.0" placeholder. PRIVACY.md is NOT byte-pinned (only substring-matched for `/local-only/` and `/No telemetry/`). The update must preserve those two phrases. Replace the stale final sentence with the real privacy content covering all external data flows.

**Stale copy in CONTRIBUTING.md:** The file does NOT contain "ships in Phase X" or "Phase 3+" style placeholders (searched and confirmed). The current CONTRIBUTING.md is 210 lines and is complete. The CF-D24 test asserts presence of specific section headings — these must be preserved in any update. However, the CONTRIBUTING.md does contain two places that reference "Phase 0+" which are historical and correct. No stale-copy refresh is needed for CONTRIBUTING.md beyond ensuring the existing D-24-locked headings remain present.

**CONTRIBUTING.md "Locked copy files" section** (lines 14-18) mentions `references/*.md` and the SHA-256 byte-pin mechanism. The section at line 42 (`## Quick checklist`) says `npm run check is green locally` — this will still be accurate after CI-01 fixes the check script. No content update needed here.

**Hash-pinned files touched by DOCS-02:**

| File | Pinned? | Pin Location | Action |
|------|---------|--------------|--------|
| `references/doctor-output.md` | YES — SHA-256 | `tests/repo-files.test.ts:179` | Must re-pin after updating http-crossref-ping copy |
| `README.md` | NO — substring only | `tests/repo-files.test.ts:91-92` | Must update test assertions in same commit |
| `PRIVACY.md` | NO — substring only | `tests/repo-files.test.ts:93-94` | Preserve `/local-only/` and `/No telemetry/` |
| `CONTRIBUTING.md` | NO — headings checked | `tests/repo-files.test.ts:374-399` | Preserve all D-24-locked headings |
| `references/honesty-framing.md` | YES — SHA-256 | `tests/repo-files.test.ts:207` | NOT touched by this phase |
| Prompt template files (15 entries) | YES — SHA-256 | `PENDING_HASH_PINS` array | NOT touched by this phase |

### DOCS-03: Packaging Cleanup

**Finding:** `bin/lib/http-mock.ts` is imported by PRODUCTION code in:
- `bin/lib/sources/arxiv.ts:16`
- `bin/lib/sources/crossref.ts:20`
- `bin/lib/sources/openalex.ts:15`
- `bin/lib/sources/pubmed.ts:18`
- `bin/lib/sources/retraction-watch.ts:20`
- `bin/lib/sources/semanticscholar.ts:19`
- `bin/lib/sources/unpaywall.ts:15`
- `bin/lib/honesty.ts:23`
- `bin/lib/plagiarism.ts:23`
- `bin/lib/verify/freshness.ts:26`

All 7 source adapters use `isOfflineMode()` and `loadCassetteFile()`/`loadCassetteDir()` from `http-mock.ts` as the offline/live dispatch mechanism. This is not test scaffolding — it is the production cassette chokepoint that makes CI run hermetically. `http-mock.ts` MUST remain in `dist/` and in the production `bin/lib/` tree.

**DOCS-03 scope = nock → devDependencies only.**

The nock package is imported directly only in `bin/lib/http-mock.ts:53` (`import nock from 'nock'`). The production adapters use only `isOfflineMode()`, `loadCassetteFile()`, and `loadCassetteDir()` — which do NOT use nock. Only the `loadCassettes()` and `recordCassettes()`/`finalizeRecording()` functions in `http-mock.ts` use nock, and those functions are invoked only by:
- The cron-refresh tooling (not a user-facing CLI path)
- `nock.disableNetConnect()` (called in `loadCassettes()` as a defense-in-depth lockdown — not nock interception)

However: since `http-mock.ts` is a production module (compiled to `dist/bin/lib/http-mock.js`), and it imports nock at module load, nock itself must be present at runtime for the import not to throw. Moving nock to devDependencies means it will NOT be present in a production `npm install --production` install (or `npm ci --omit=dev`).

**Risk assessment:** The project is distributed as a developer tool (plugin + CLI for individual use). An end-user installs via `npm install -g pensmith`. By default `npm install` installs both `dependencies` and `devDependencies` when there is no `NODE_ENV=production`. The shipped package distribution (`npm publish`) only includes `dependencies` by npm convention — so moving nock to devDependencies WOULD break a globally installed CLI that tries to run offline research.

**Revised DOCS-03 recommendation:** The planner must decide whether to (a) keep nock in `dependencies` and document the issue for v2 cleanup, or (b) refactor `http-mock.ts` to lazy-import nock only when `loadCassettes()`/`recordCassettes()` are called (so the module loads without nock at runtime). Option (b) is a small refactor: wrap the `import nock from 'nock'` as a dynamic `await import('nock')` inside the two nock-using functions. The cassette reader functions (`loadCassetteFile`, `loadCassetteDir`, `isOfflineMode`) do not use nock and would load fine without it. This refactor would then allow nock to safely live in devDependencies.

**Decision needed by planner:** The CONTEXT.md says "confirm at research which it is" — the answer is that `http-mock.ts` IS production. The cleanest DOCS-03 implementation is the lazy-import refactor. If the planner judges that too risky for a "no new features" phase, skip the nock move entirely and document for v2.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coverage measurement | Custom instrumentation | `c8` (already in devDeps) | V8-native, zero instrumentation overhead, already installed |
| Porcelain check | Custom file-diff logic | `git status --porcelain` | Already available in every CI environment |
| Non-TTY detection | Custom stdin check | `< /dev/null` redirect | Standard Unix stdin detach; reliable across all 3 OSes with `shell: bash` |

---

## Common Pitfalls

### Pitfall 1: README update breaks repo-files.test.ts without touching the test
**What goes wrong:** `assert.match(read('README.md'), /v0\.1\.0 in development/)` (line 91) and `/Phase 6/` (line 92) fail, blocking CI.
**Why it happens:** The test was written to assert the stub content; it was never updated when the stub became real.
**How to avoid:** In the same commit that writes the real README, delete lines 91-92 from `tests/repo-files.test.ts`. The test function name is `'README, PRIVACY, README-DEV, CONTRIBUTING stubs are correct'` — rename the test to `'PRIVACY and README-DEV structure checks'` after removing the now-stale README assertions.
**Warning signs:** CI red on `tests/repo-files.test.ts` → "AssertionError: The input did not match the regular expression /v0\.1\.0 in development/".

### Pitfall 2: doctor-output.md edit without re-pinning
**What goes wrong:** SHA-256 pin test fails: "references/doctor-output.md drifted from locked copy. Update PINNED to \<hash\> if the edit was intentional."
**Why it happens:** `references/doctor-output.md` is byte-pinned in `tests/repo-files.test.ts:179`. Any edit to the file changes the SHA-256.
**How to avoid:** After editing `references/doctor-output.md`, run:
```bash
node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/doctor-output.md')).digest('hex'))"
```
Paste the output hash into `tests/repo-files.test.ts:179` as the new `PINNED` value. Do this in the same commit (WN-3 protocol).
**Current pin:** `509f90add8664e559a3ab817684381777e1b624b63ebe0dfc77054267997eec0`

### Pitfall 3: nock moved to devDeps but `http-mock.ts` is a production module
**What goes wrong:** End users who install pensmith via `npm install -g pensmith` or who run `npm ci --omit=dev` in a production container get a crash when `pensmith research` tries to use the cassette path (the module-level `import nock from 'nock'` throws "Cannot find package 'nock'").
**Why it happens:** `http-mock.ts` is compiled into `dist/bin/lib/http-mock.js` and is a direct import of all 7 source adapters. It imports nock at module load, not lazily.
**How to avoid:** Either (a) keep nock in dependencies until a lazy-import refactor is done, or (b) do the lazy-import refactor as part of this phase (small — only `loadCassettes()` and `recordCassettes()` need nock; wrap them in `const { default: nock } = await import('nock')`).
**Warning signs:** "Cannot find package 'nock'" in adapter tests or at runtime.

### Pitfall 4: `< /dev/null` on Windows in ci.yml
**What goes wrong:** The `< /dev/null` redirect causes a syntax error or silently fails on Windows runners.
**Why it happens:** Windows cmd.exe does not support `/dev/null`. However, GitHub Actions' `shell: bash` on Windows uses Git Bash, which DOES support `/dev/null`. The redirect works if `shell: bash` is specified.
**How to avoid:** Always set `shell: bash` on the coverage step. Alternative: Use `PENSMITH_NON_TTY=1` or `CI=true` environment variable in the step and check `process.env.CI` in the isTTY guard — but this requires a code change. The `/dev/null` redirect is simpler.
**Warning signs:** Windows-only CI failure on the coverage step.

### Pitfall 5: Validate-manifests step checks `## Body` section in workflow files
**What goes wrong:** `scripts/validate-plugin-manifest.cjs` checks (line 151-152) that every workflow `.md` contains a `<capability_check>` block. Also, `bin/lib/doctor/probes/intake-outline-verify-wiring.ts:91-92` checks that `workflows/{new,research,outline,plan,write,verify}.md` each has a `## Body` section.
**Why it happens:** The four stub workflow files (doctor/status/next/resume) do NOT have `## Body` sections. When they are filled in DOCS-02, they MUST include `## Body` headings for the DOCT-05 probe (which checks the 6 Phase-3 verbs only — not doctor/status/next/resume). But the validate-plugin-manifest script checks ALL 16 workflow files for `<capability_check>`. The stubs already have `<capability_check>` blocks, so this is fine. When filling the bodies, preserve the `<capability_check>` block.
**How to avoid:** The workflow body template (from compile.md) always has `<capability_check>` as the first block after the title/description. Copy this pattern for the four new bodies.
**Warning signs:** `npm run validate:manifests` fails with "missing \<capability_check\> block".

### Pitfall 6: `check` script double-runs prebuild (harmless but surprising)
**What goes wrong:** With the fix, `npm run check` runs prebuild twice: once explicitly (first step) and once implicitly via `npm run build`'s npm lifecycle hook (the `prebuild` script name is a pre-hook for `build`).
**Why it happens:** npm's lifecycle hook mechanism runs `prebuild` automatically before `build`. Since we also prepend `npm run prebuild`, it runs at start + again when `npm run build` is reached.
**How to avoid:** This is harmless (prebuild is idempotent and writes the same files). Accept the double-run. Alternatively, rename the script from `prebuild` to `generate` to remove the lifecycle hook coupling — but this would require updating ci.yml and is unnecessary complexity.
**Warning signs:** None — double-run just prints the "wrote version.generated.ts + verbs.json" message twice.

---

## Code Examples

### CI-01: Exact package.json scripts change
```json
// package.json scripts (change check: only — add "npm run prebuild &&" prefix)
"check": "npm run prebuild && npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests"
```

### CI-02: Exact ci.yml step to append
```yaml
# Append to ci.yml after step 55-56 (validate plugin manifests)
- name: Assert working tree is clean after build (stale-derived-file guard — CI-02)
  shell: bash
  run: |
    status=$(git status --porcelain)
    if [ -n "$status" ]; then
      echo "FAIL: build produced untracked or modified files:"
      echo "$status"
      exit 1
    fi
    echo "OK: working tree is clean."
```

### CI-03: New scripts + ci.yml step
```json
// package.json: rename "coverage" → "test:coverage" (or add alias)
"test:coverage": "c8 node scripts/run-tests.mjs"
```

```json
// .c8rc.json (new file in repo root)
{
  "reporter": ["text", "lcov"],
  "include": ["bin/**", "hooks/**", "mcp/**"],
  "exclude": ["tests/**", "scripts/**", "**/*.d.ts"],
  "all": true,
  "check-coverage": true,
  "lines": 85,
  "functions": 72,
  "branches": 82,
  "statements": 85
}
```

```yaml
# ci.yml: replace the existing "npm test" step or add coverage as separate step
- name: Test suite + coverage gate (non-TTY stdin — CI-03)
  shell: bash
  run: npm run test:coverage < /dev/null
```

### DOCS-01: Where to print the §3 disclaimer in intake.ts
```typescript
// bin/cli/intake.ts — add near the top of the run() function, before first ask()
const DISCLAIMER = `
pensmith is a structured research-and-drafting assistant for academic writing. \
It helps you turn an assignment prompt into a sourced outline or, optionally, a full draft, \
using only verifiable peer-reviewed and configurable academic sources. It includes a citation \
verifier that re-fetches every cited DOI and flags unsupported claims for human review, \
and a humanizer pass that improves readability.

This tool is for your own writing, research, and learning. It is not a guarantee against AI \
detectors and it is not a substitute for doing the reading. Submitting fully tool-generated \
work as your own is, in many institutions, a violation of academic integrity policy. You are \
responsible for the work you submit.
`.trim();

process.stdout.write(DISCLAIMER + '\n\n');
```

### Re-pinning doctor-output.md after DOCS-02 edit
```bash
# After editing references/doctor-output.md:
node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/doctor-output.md')).digest('hex'))"
# Paste the output into tests/repo-files.test.ts line 179 as the PINNED value
```

---

## State of the Art

| Old Approach | Current Approach | Status | Impact on Phase 16 |
|--------------|------------------|--------|--------------------|
| Shell glob for test files | `scripts/run-tests.mjs` (programmatic) | Already shipped | Run `< /dev/null` through the existing runner |
| Per-build prebuild only | Explicit prebuild as first `check` step | Phase 16 fix | CI-01 |
| No porcelain gate | `git status --porcelain` step in CI | Phase 16 add | CI-02 |
| No coverage threshold | c8 `check-coverage` with ratchet thresholds | Phase 16 add | CI-03 |

**Deprecated/outdated copy to refresh:**
- `README.md`: "v0.1.0 in development" + "Phase 6" stubs → real README
- `PRIVACY.md`: "ships with v0.1.0" → shipped reality
- `bin/lib/doctor/probes/http-crossref-ping.ts:32-33`: "deferred to Phase 3" → shipped
- `references/doctor-output.md` (same http-crossref-ping copy, locked)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Moving nock to devDependencies would break production `npm install` because http-mock.ts imports nock at module load | DOCS-03 | If wrong (e.g., nock is tree-shaken by the runtime), the move is safe. But Node.js is not a bundler — the import will execute at module load in the published dist/. Risk is HIGH: wrong assumption means production CLI crashes. | [VERIFIED: file read of http-mock.ts:53 confirms top-level `import nock from 'nock'`] |
| A2 | `< /dev/null` works with `shell: bash` on GitHub Actions Windows runner | CI-03 | If wrong, Windows CI step fails. Fallback: use `echo "" | npm run test:coverage` or set `STDIN_CLOSED=1` env. [ASSUMED — not verified against GitHub Actions runner docs, only local test confirmed] |

---

## Open Questions

1. **DOCS-03: nock lazy-import refactor vs. leave in dependencies**
   - What we know: http-mock.ts uses nock only in `loadCassettes()` and `recordCassettes()`/`finalizeRecording()`. The cassette reader functions don't use nock.
   - What's unclear: Is the scope risk of the lazy-import refactor acceptable for a "CI/docs-only" phase? The refactor is ~5 lines.
   - Recommendation: Include the lazy-import refactor. It is small, isolated to two functions in one file, and allows the correct nock → devDependencies move. Without it, DOCS-03 is incomplete.

2. **CI-03: Replace `npm test` step with `test:coverage` or run both?**
   - What we know: The existing `npm test` step runs the suite without coverage. Adding a `test:coverage` step runs it again with coverage. Double-run costs ~25 seconds (measured local run time).
   - What's unclear: Whether the CI job should run tests once (with coverage) or twice (sans coverage for speed, then with for the gate).
   - Recommendation: Replace the `npm test` step with `npm run test:coverage < /dev/null`. Single run, all output. Total CI time is not materially affected (~25 seconds vs. 0).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `c8` | CI-03 coverage gate | ✓ (devDeps) | 11.0.0 | — |
| `nock ^14` | DOCS-03 (nock in http-mock.ts) | ✓ (dependencies) | ^14 | N/A — moving to devDeps |
| `git` | CI-02 porcelain gate | ✓ (GitHub Actions) | any | — |
| `bash` | CI-02/CI-03 shell | ✓ (`shell: bash` in GHA) | any | — |

**Missing dependencies with no fallback:** none

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `--test` runner (Node 20.10) |
| Config file | none — invoked via `scripts/run-tests.mjs` |
| Quick run command | `node scripts/run-tests.mjs` |
| Full suite command | `npm run test:coverage` (after CI-03) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CI-01 | `check` script starts with `prebuild` | structural | `node -e "const p=require('./package.json'); if(!p.scripts.check.startsWith('npm run prebuild')) throw new Error('CI-01 fail')"` | ❌ Wave 0 — add assertion to `tests/repo-files.test.ts` |
| CI-02 | `git status --porcelain` empty after build | integration | runs in CI (ci.yml step) | ❌ CI-only |
| CI-03 | c8 thresholds met | coverage | `npm run test:coverage` | ❌ Wave 0 — `.c8rc.json` |
| CI-03 | non-TTY stdin passes suite | integration | `node scripts/run-tests.mjs < /dev/null` | ✅ (verified locally) |
| DOCS-01 | README contains PRD §3 disclaimer | structural | add to `tests/repo-files.test.ts` | ❌ Wave 0 |
| DOCS-01 | README contains §18 GSD credit | structural | add to `tests/repo-files.test.ts` | ❌ Wave 0 |
| DOCS-01 | README contains `## Style Match` (STYL-04) | structural | existing `tests/repo-files.test.ts:112` | ✅ |
| DOCS-02 | doctor/status/next/resume.md have `<capability_check>` | integration | `npm run validate:manifests` | ✅ (stubs already have it) |
| DOCS-02 | doctor-output.md hash-pin current | structural | `tests/repo-files.test.ts:174` | ✅ (but needs re-pin after edit) |
| DOCS-03 | nock in devDependencies | structural | add to `tests/repo-files.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node scripts/run-tests.mjs` (quick, ~25 seconds)
- **Per wave merge:** `npm run check` (full, including prebuild + lint + typecheck + build + all tests)
- **Phase gate:** Full suite green + `npm run test:coverage` green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `.c8rc.json` — coverage thresholds config (CI-03)
- [ ] `tests/repo-files.test.ts` — add assertions for CI-01 check-script order, DOCS-01 README disclaimer presence, DOCS-03 nock in devDeps
- [ ] `test:coverage` script in `package.json` (rename from `coverage`)

---

## Security Domain

The security enforcement config is not set to false; including for completeness.

### Applicable ASVS Categories

| ASVS Category | Applies | Notes |
|---------------|---------|-------|
| V2 Authentication | no | No auth changes in this phase |
| V5 Input Validation | no | No new input surface |
| V6 Cryptography | no | Hash re-pin is SHA-256 integrity (already used) |

**The §3 disclaimer at intake is a disclosure mechanism, not a security control.** No ASVS category applies. The honesty-framing non-negotiable is a product constraint, not a security requirement.

**Honest framing gate:** The STYL-04 test already enforces that README does not claim detection evasion or undetectability. This must be preserved in the real README. The intake disclaimer must be printed verbatim from PRD §3 — it does not claim undetectability ("it is not a guarantee against AI detectors").

---

## Sources

### Primary (HIGH confidence)
- `package.json` — current scripts, deps, devDeps [VERIFIED: file read]
- `.github/workflows/ci.yml` — current step order and 3-OS matrix [VERIFIED: file read]
- `scripts/prebuild.mjs` — what prebuild generates [VERIFIED: file read]
- `scripts/run-tests.mjs` — how tests are invoked [VERIFIED: file read]
- `.gitignore` — generated file coverage [VERIFIED: file read]
- `tests/repo-files.test.ts` — all hash-pin and substring assertions [VERIFIED: file read]
- `PRD.md §3` — exact disclaimer text [VERIFIED: file read at line 36-40]
- `PRD.md §18` — exact GSD credit text [VERIFIED: file read at line 796]
- `bin/lib/http-mock.ts` — nock import, cassette API [VERIFIED: file read]
- `bin/lib/sources/*.ts` (7 files) — production imports of http-mock [VERIFIED: grep]
- `bin/lib/honesty.ts`, `bin/lib/plagiarism.ts`, `bin/lib/verify/freshness.ts` — production imports [VERIFIED: grep]
- `references/doctor-output.md` — http-crossref-ping stale copy; current hash [VERIFIED: file read + hash computed]
- Measured coverage: lines 90.3 / functions 77.26 / branches 87.28 [VERIFIED: c8 run]
- `bin/cli/status.ts`, `bin/cli/resume.ts`, `bin/lib/router.ts` — real behavior for workflow bodies [VERIFIED: file read]

### Secondary (MEDIUM confidence)
- npm lifecycle hook behavior (prebuild runs before build) [ASSUMED — standard npm behavior, not re-verified against npm docs]

---

## Metadata

**Confidence breakdown:**
- CI-01: HIGH — exact line numbers identified, fix is one-word insertion
- CI-02: HIGH — gitignore verified, porcelain command well-known
- CI-03: HIGH — c8 installed and measured, thresholds computed from actual run
- DOCS-01: HIGH — PRD §3 and §18 quoted verbatim, test assertions identified
- DOCS-02: HIGH — all 4 stub files read, all 4 real impls read, hash-pin location identified
- DOCS-03: HIGH — all production importers grep-verified, nock import location confirmed

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable domain — CI YAML and npm scripts don't change frequently)
