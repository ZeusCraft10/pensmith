---
phase: 04
phase_name: "breadth-n-sections-compile-wave-scheduling"
project: "pensmith"
generated: "2026-05-31"
counts:
  decisions: 12
  lessons: 7
  patterns: 8
  surprises: 5
missing_artifacts:
  - "04-VERIFICATION.md"
  - "04-UAT.md"
---

# Phase 04 Learnings: breadth-n-sections-compile-wave-scheduling

## Decisions

### Read-only, stateless wave scheduler (ARCH-20)
The scheduler persists nothing to disk. PLAN.md frontmatter is the single source of truth for wave progress; `buildWaveGraph` + `runWave` read state but never write STATE.json or any wave-progress file. Crash recovery works by re-reading frontmatter.

**Rationale:** A volatile STATE.json can corrupt or drift; frontmatter-as-truth makes resume seamless and gives statelessness a falsifiable test (STATE.json mtime byte-unchanged across a run). Both external reviewers independently praised this.
**Source:** 04-01-PLAN.md, 04-01-SUMMARY.md

### Kahn topological sort is the canonical home of COMP-06
`buildWaveGraph` IS `computeWaves()`: roots get `computed_wave = 1`, each node `= max(deps.computed_wave) + 1`. A valid PLAN.md `wave:` override promotes the wave; an invalid one (`< max(deps)+1`) throws at graph-build time (PLAN-03). Cycles are detected explicitly after Kahn and throw with the residual slug list.

**Rationale:** REQUIREMENTS.md + 04-CONTEXT.md (canonical/locked) outrank 04-RESEARCH.md's drifted COMP-04..07 labels; COMP-06 is defined as topological sort by `depends_on`.
**Source:** 04-01-PLAN.md

### Missing/failed dependency → `blocked`, never silently skipped (Gemini HIGH)
A section whose declared `depends_on` parent is absent/unplanned/failed is marked `status: 'blocked'` (along with its transitive descendants) rather than scheduled. An independent missing section that nobody depends on stays INFO-skip. `runWave` only executes nodes whose parents are all `completed`/`done`.

**Rationale:** Treating "missing" as non-blocking could violate topological order or produce a compiled draft with unauthorized "holes" — a direct threat to the project's core citation-integrity value.
**Source:** 04-01-PLAN.md, 04-REVIEWS.md (Gemini HIGH)

### ALWAYS-ON COMP-01 refuse gate reads VERIFICATION.md regardless of hash (OpenCode H-01)
Compile reads `sections/<N>/VERIFICATION.md` for EVERY section and refuses on any FABRICATED/MIS-CITED/NOT_FOUND verdict before any `.paper/DRAFT.md` write — independent of whether `verified_against_draft_hash` matches.

**Rationale:** Trusting a hash match as a proxy for "no blocking verdicts" would let a bad Phase-3 `state: verified` slip through. Defense-in-depth over trusting the upstream state machine; "verifier blocks compile" is the single most load-bearing non-negotiable.
**Source:** 04-05-SUMMARY.md (T-04-19), 04-REVIEWS.md (OpenCode H-01)

### Ordered token-SEQUENCE equality for smoother, not a Set (OpenCode M-01)
The smoother citation-protection post-check compares an ordered token sequence / index-tracked list, not a `Set`. A swapped pair `{{cite_1_2}} {{cite_1_1}}` must be rejected.

**Rationale:** Sets don't track order, so D-13's "set equality" wording would silently pass a reordering — a real bug on a safety-critical invariant.
**Source:** 04-05-SUMMARY.md (REVIEW M-01), 04-REVIEWS.md (OpenCode M-01)

### Global base-26 citekey collision resolution BEFORE smoothing (Gemini MEDIUM)
Bib-collision resolution (`vaswani2017a`/`vaswani2017b`) runs globally across the concatenated draft and before the smoothing pass, so `.paper/DRAFT.md` `[@key]` tokens stay synchronized with the regenerated `.paper/CITATIONS.bib`.

**Rationale:** Resolving after concat would leave the draft referencing keys that don't exist in the final bib.
**Source:** 04-05-SUMMARY.md (REVIEW M-02), 04-REVIEWS.md (Gemini MEDIUM)

### Compile lock via `withLock('pensmith:compile:<paperRoot>')`, not raw proper-lockfile
Compile concurrency uses `withLock` from `lock.ts` with a per-paperRoot resource key and `staleMs: 30_000`, instead of calling `proper-lockfile.lock()` on an in-tree stub.

**Rationale:** D-40 forbids locks living in the project tree; the per-paperRoot key (hashed into `pensmithLockDir()`) also stops concurrent test fixtures from contending on a shared stub.
**Source:** 04-05-SUMMARY.md (D-40 auto-fix)

### Tier-2 forced-serial WARN guarded to fire exactly once per run (M-04)
A `warnedOnce` guard placed at `runAllSections` entry (not per-wave) makes the Tier-2 "max-parallel ignored, running serial" WARN fire exactly once per invocation regardless of wave count.

**Rationale:** Constructing/draining multiple waves would otherwise emit duplicate WARNs, violating the "exactly one" acceptance criterion.
**Source:** 04-03-SUMMARY.md (REVIEW M-04), 04-REVIEWS.md (OpenCode M-04)

### `runRevise` is a single chokepoint shared by both tiers (D-06)
One function (`bin/lib/revise.ts::runRevise`) handles parse → load PLAN.md → LLM call → zod+membership validation → approval gate → atomic patch → hash reset. `bin/cli/revise.ts` is a thin citty orchestrator with zero business logic. `--yolo` retry cap = 2, then RETRY_EXHAUSTED.

**Rationale:** A single chokepoint guarantees Tier 1 and Tier 2 cannot diverge in citation-swap behavior (tier-contract parity).
**Source:** 04-04-SUMMARY.md

### Pass1RunResult aggregate wrapper instead of mutating Pass1Result
`runPass1` now returns `Pass1RunResult { results, freshness }` rather than adding fields to the per-citekey `Pass1Result`.

**Rationale:** Attaches RSCH-10 freshness data while preserving the CYCLE-2 H-4 parameter signature and per-verdict semantics unchanged.
**Source:** 04-02-SUMMARY.md

### `z.strictObject` for the COMPILE-REPORT schema (ARCH-07)
`CompileReportSchema` uses `z.strictObject` + `z.literal(1)` so RESEARCH.md drift keys (`outline_hash`, `pandoc_target`) are rejected rather than silently passed through.

**Rationale:** A plain `z.object` would forward extra keys, defeating ARCH-07 refuse-forward-incompat.
**Source:** 04-02-SUMMARY.md

### `parseSectionDirName` returns null (not throws) on invalid input
The `NN[letter]-slug` parser returns null on traversal/absolute/null-byte/backslash inputs instead of throwing.

**Rationale:** Directory walkers can skip non-section entries gracefully; throwing would force every caller into try/catch. (Path-traversal mitigation T-04-06, V12 ASVS.)
**Source:** 04-02-SUMMARY.md

---

## Lessons

### The plan's "locked 16 verbs" claim was wrong — `revise` was absent
04-04 stated `revise` was already in the locked UX02_VERBS list, but `bin/lib/verbs.ts` only had 16 verbs without it. Discovered as a TypeScript build error at Task 3 (`revise` not in `Ux02Verb` type).

**Context:** Required adding `revise` (→17 verbs) and updating every derivative assertion: cli-verbs count, workflows-keyequal, and the hardcoded count + fallback list in `validate-plugin-manifest.cjs`. Plan claims about "locked" state should be verified against the actual array, not trusted.
**Source:** 04-04-SUMMARY.md (Deviation 1, Rule 1)

### `proper-lockfile` leaks its `.lock` into the tree next to the stub
Using `.paper/.compile-stub` as the lockfile target caused `proper-lockfile` to create `.paper/.compile-stub.lock` inside the project tree, violating D-40. Caught only by `lock.test.ts`'s D-40 assertion during Task 4.

**Context:** The fix was to route through `withLock` (which places lock stubs in `pensmithLockDir()`). The lesson: proper-lockfile creates its lock adjacent to the named resource, so the named resource must itself live outside the tree.
**Source:** 04-05-SUMMARY.md (Deviation 1, Rule 1)

### LLM-produced excerpts use `...` ellipsis convention that breaks literal matching
The revise-swap cassette excerpts (`...supporting evidence [@jones2020] in the context...`) didn't match literal draft content, failing the swap-accept test.

**Context:** Required a `normalizeExcerpt()` helper to strip leading/trailing `...` before matching in both `applySwapAction` and `applyRemoveAction`. Any feature that matches LLM-emitted text against source must normalize the ellipsis convention.
**Source:** 04-04-SUMMARY.md (Deviation 2, Rule 1)

### `exactOptionalPropertyTypes` rejects `number | undefined` assigned to `{ wave?: number }`
`plans.set(slug, { wave, status })` where `wave: number | undefined` failed typecheck under `exactOptionalPropertyTypes: true`.

**Context:** Fixed by conditionally building a typed `planEntry` object that only sets `wave`/`status` when defined. Optional-property assignment must omit the key entirely, not set it to `undefined`.
**Source:** 04-03-SUMMARY.md (Deviation 1, Rule 2)

### retraction-watch's offline fallback masks per-DOI assertions
The retraction-watch adapter in offline mode falls back to the first cassette entry for any DOI without an exact filter match, so a "clean DOI" case unexpectedly produced `warnRetraction=true`.

**Context:** The freshness DOI-200 test had to assert only `warnDoi=false` (not `warnRetraction=false`) with an explanatory comment. Offline-cassette adapters with fallback behavior can't be asserted on negative warnings unless the cassette has an exact match.
**Source:** 04-02-SUMMARY.md (Deviation 1)

### Review terminology can encode a latent bug ("set" vs "sequence")
D-13 specified "output token-SET equals input token-SET" while also listing "reordered" as a mismatch — contradictory, because sets don't track order. The inconsistency was caught in cross-AI review before implementation, not after.

**Context:** Worth scanning spec/decision wording for data-structure terms whose semantics contradict the stated acceptance behavior. Here it would have been a real safety-gate bug on citation integrity.
**Source:** 04-REVIEWS.md (OpenCode M-01)

### The cross-AI peer-review mechanism is unreliable in Windows / Git-Bash
In cycle 2, every external reviewer CLI failed: Gemini hit `E2BIG` on the ~150KB argv prompt then errored on `run_shell_command: Tool not found` via stdin; OpenCode returned only a file-attachment stub; Codex returned 401 (expired refresh token); Cursor emitted no body non-interactively; Qwen/CodeRabbit not installed.

**Context:** Large prompts (~150KB) exceed argv limits, and stdin paths trigger agentic loops or empty completions. Don't assume a second independent review pass is obtainable; the cycle-1 review remained the review of record. Honest "no new review obtained" beats fabricated content.
**Source:** 04-REVIEWS.md (Re-run Addendum, cycle 2)

---

## Patterns

### D-13 citation-token placeholder protection
Replace every `[@citekey]` with a unique placeholder (`{{cite_K_M}}`) before the smoother LLM call, then enforce ordered token-sequence equality after; on drift, fall back to raw concat + WARN (never block compile, never mutate `[@citekey]`).

**When to use:** Any LLM pass over prose that must not add, drop, or reorder protected tokens. A code-enforceable invariant beats prompt-engineering hope; both reviewers called this the strongest part of the design.
**Source:** 04-05-SUMMARY.md, 04-REVIEWS.md (consensus strength)

### Offline cassette short-circuit for undici-backed probes
Network probes (`probeFreshness`, retraction-watch) check `loadCassetteFile(...)` first in offline mode and short-circuit before any HEAD/GET.

**When to use:** Any HTTP adapter that needs deterministic, CI-safe tests without nock@14/undici version friction. Validate inputs (e.g. DOI via `normalizeDoi`) before the request to also cover the SSRF mitigation path.
**Source:** 04-02-SUMMARY.md

### WARN-only advisory pattern with structured carry-forward
A probe returns `{ advisory: true, retraction_warnings[] }` and never sets a blocking verdict; downstream (compile) aggregates the structured warnings into COMPILE-REPORT.md.

**When to use:** Findings that should inform but never block (freshness, retraction, citation density, consistency). Keeps blocking verdicts (FABRICATED/MIS-CITED/NOT_FOUND) cleanly separated from advisories.
**Source:** 04-02-SUMMARY.md, 04-05-SUMMARY.md (Advisory Findings aggregation)

### Sentinel-then-real prompt-hash lockstep (WN-3)
New hash-pinned prompts are registered with a `__PENDING_HASH_<slug>__` sentinel in Task 1 (tests skip hash comparison for sentinels), then re-pinned with the real SHA-256 in the final task, updated in `prompt-loader.ts` and `tests/repo-files.test.ts` together.

**When to use:** TDD where a prompt file's content (and therefore its hash) isn't finalized until a later task, but the pin test must pass throughout. Keeps RED tests loadable without a chicken-and-egg hash dependency.
**Source:** 04-04-SUMMARY.md, 04-05-SUMMARY.md

### Wave-drain with blocked-subtree pruning
`runAllSections` drains the wave graph wave-by-wave: each wave runs under `new Semaphore(maxParallel)` via `runWave`; after a wave settles, nodes whose deps FAILED/MISSING/UNPLANNED are marked `blocked` and excluded from subsequent runnable sets. Orthogonal subtrees still proceed.

**When to use:** Bounded-parallel execution over a dependency DAG where one failure must prune only its descendants, not cancel siblings (`Promise.allSettled`, never cancel-on-first-failure).
**Source:** 04-03-SUMMARY.md, 04-01-PLAN.md (D-03)

### Test live-counter scoped to the test closure
Concurrency-cap tests track a "currently running" counter declared inside the test closure, never module-level, so parallel test files don't pollute each other's count.

**When to use:** Asserting a Semaphore/bounded-parallel cap without real sleeps (use `Promise.resolve()` ticks). Module-level shared counters race when the runner executes files in parallel.
**Source:** 04-01-PLAN.md (REVIEW LOW), 04-03-SUMMARY.md

### Per-resource lock key to de-contend concurrent test fixtures
`withLock('pensmith:compile:<abs-paperRoot>')` derives the lock-stub filename from `sha256(resource).slice(0,12)`, so each test fixture (distinct paperRoot) gets its own stub and tests never block each other.

**When to use:** Any per-entity lock where the test suite spins up many isolated fixtures concurrently; a shared global lock name would serialize unrelated tests.
**Source:** 04-05-SUMMARY.md (REVIEW M-03)

### Wave-0 RED-first TDD with a requirement-ID → test-file map
Each plan's Wave 0 installs all failing test files for that plan's requirement IDs before any production code, driven by 04-VALIDATION.md's Per-Task Verification Map (one row per REQ-ID → named test file + command).

**When to use:** Multi-plan phases where coverage must be provably complete; the map makes "every requirement has a test" auditable and the RED gate (verify command throws if the suite unexpectedly passes) prevents accidental green.
**Source:** 04-VALIDATION.md, 04-01-PLAN.md (Task 1)

---

## Surprises

### `revise` was missing from the supposedly "locked 16" verb list
The plan asserted `revise` was already among the locked verbs; it wasn't, surfacing only as a TypeScript build error at Task 3.

**Impact:** Verb count went 16→17 and required touching four derivative assertions/validators. A documented "locked" invariant turned out to be stale.
**Source:** 04-04-SUMMARY.md

### D-40 lock-in-tree violation was invisible until a sibling test asserted it
The compile lock leaked `.paper/.compile-stub.lock` into the project tree, and nothing in the compile tests caught it — only `lock.test.ts`'s independent D-40 assertion did, during Task 4.

**Impact:** Reinforces value of cross-cutting invariant tests that run against all code, not just the feature's own suite. A green feature suite did not mean D-40 compliance.
**Source:** 04-05-SUMMARY.md

### retraction-watch returns a fake "retracted" record for ANY unmatched DOI offline
The offline fallback isn't a no-op — it returns the first cassette entry (a retracted fixture) for any DOI lacking an exact cassette filter match.

**Impact:** A "clean DOI" test case produced `warnRetraction=true`, forcing the assertion to be narrowed. Offline adapter fallbacks can produce false-positive advisories that look like real warnings.
**Source:** 04-02-SUMMARY.md

### Every external AI reviewer failed in cycle 2
Gemini (E2BIG then agentic-tool error), OpenCode (empty completion), Codex (401), Cursor (no body), Qwen/CodeRabbit (absent) — zero usable review bytes on the re-run.

**Impact:** No second independent review was obtainable; the cycle-1 Gemini+OpenCode review stayed the record. Large-prompt argv limits and CLI auth fragility make automated cross-AI review unreliable on Windows/Git-Bash.
**Source:** 04-REVIEWS.md (Re-run Addendum)

### Two reviewers hit the same load-bearing surface from opposite ends
Gemini framed the risk as scheduler-side ("missing PLAN.md → dependent must block", 04-01/04-03 HIGH); OpenCode framed it as compile-side ("missing VERIFICATION.md / hash-trust bypass", 04-05 HIGH). They were two faces of one invariant: never let un-verified/un-planned work reach DRAFT.md.

**Impact:** Independent reviewers converging on the same core value from different angles raised confidence that the COMP-01 gate + blocked-dependency semantics were the true must-fix; both were implemented (T-04-19 always-on gate; blocked-subtree pruning).
**Source:** 04-REVIEWS.md (Consensus Summary)
