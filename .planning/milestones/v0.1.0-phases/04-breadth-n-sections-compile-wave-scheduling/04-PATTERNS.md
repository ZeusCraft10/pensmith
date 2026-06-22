# Phase 4: Breadth — N Sections + Compile + Wave Scheduling — Pattern Map

**Mapped:** 2026-05-29
**Phase:** 04-breadth-n-sections-compile-wave-scheduling
**Files analyzed:** 36 (new + patched, per research §4)
**Analogs found:** 36 / 36 — every new file has at least a role-match analog already in repo

---

## Verified prerequisites (from §6 Open Questions)

- **Q6 — `Semaphore` export:** CONFIRMED exported in `bin/lib/budget.ts:166`. No first-task hoist needed.
- **Q1 — outline format:** `templates/prompts/outline-author.md` is hash-pinned (D-12 LOCKED slug). Parser regex MUST be derived from reading that prompt's emitted structure at Wave-0 of Plan 1.
- **Atomic-write chokepoint:** `bin/lib/atomic-write.ts::atomicWriteFile` (lines 87–153) is the SOLE allowed writer. ESLint chokepoint enforces. Every new file emitter MUST import from this module.
- **Citekey regex:** `bin/lib/verify/pass1.ts:187` uses `/\[@([a-z][a-z0-9_-]*)\]/g`. `bin/lib/citekey.ts:25` exports `CITEKEY_RE = /^[a-z][a-z0-9_-]*$/`. Both reused verbatim in new `citation-token.ts`.

---

## File Classification + Pattern Assignments

### Plan 1 — Wave Scheduler

| File | Role | Closest Analog | Pattern to Copy (1-line signature) | Anti-pattern to Avoid |
|------|------|----------------|------------------------------------|------------------------|
| `bin/lib/outline-parse.ts` (NEW) | parser / pure helper | `bin/lib/outline.ts` (raw loader) + `bin/lib/citekey.ts` (regex-based pure parser w/ exported RE constant) | Export `ParsedOutline` interface + `parseOutline(raw: string): ParsedOutline`; strict parser throwing "couldn't parse line X" with clear error (mirror `generateCitekey` invariant-throw pattern at `citekey.ts:56-60`) | Do NOT add fs I/O — parser is pure string-in/object-out. Do NOT silently accept malformed entries (Research §C Risk: "too lenient parser surfaces edge cases at compile"). |
| `bin/lib/scheduler.ts` (NEW) | orchestrator / pure logic | `bin/lib/handoff.ts::assembleHandoff` (lines 43-54) — input-shape → validated output | `buildWaveGraph(outline, plans): WaveGraph` returns `{ nodes: Map<slug, SectionNode>, waves: SectionNode[][] }` + `runWave(sections, sem)` uses `Promise.allSettled` per D-03 (Research §A code block) | Do NOT persist to disk (D-04: read-only). Do NOT use `parseInt(dirname)` to discover sections (Research §K). Do NOT skip cycle-detect post-Kahn (Research §P pitfall 1). |
| `bin/lib/schemas/wave-graph.ts` (NEW) | zod schema | `bin/lib/schemas/plan-frontmatter.ts` (lines 31-56) — z.object with `.refine` invariant | `WaveGraphSchema = z.object({...}).refine((g) => no_cycles(g))`; `SectionNodeSchema` matches Research §B shape with `status: z.enum([...])`; NEVER serialized | Do NOT add `$schemaVersion` envelope (in-memory only, per D-04). Do NOT use `z.passthrough()` — use explicit `.optional()` (mirror `plan-frontmatter.ts:47` `last_verification: z.unknown().optional()`). |
| `bin/lib/citation-token.ts` (NEW) | shared utility / refactor extract | `bin/lib/citekey.ts:25` (`CITEKEY_RE`) + `bin/lib/verify/pass1.ts:187` (extraction matchAll loop) | Export `CITATION_TOKEN_RE = /\[@([a-z][a-z0-9_-]*)\]/g` + `extractCitekeys(md: string): string[]` (dedup via `new Set`) + `replaceCitekeys(md, fn)` for smoother substitution (D-13) | Do NOT extend regex to support locator syntax `[@key, p. 23]` (Research §D — Phase 10). Do NOT lose case sensitivity or allow `{{...}}` collision (placeholder family is disjoint by construction). |
| `tests/wave-scheduler.test.ts` (NEW) | unit test | `tests/budget.test.ts` (Semaphore unit-test pattern — uses node:test, no nock) | `node:test` + `import assert from 'node:assert/strict'`; bare unit tests of `runWave(sem)` with synthetic section list; include a `topo`-named case asserting Kahn topological order by `depends_on` (COMP-06) | Do NOT use real timeouts/sleeps — use `Promise.resolve()` ticks. Do NOT couple to disk (Research §A — scheduler is pure). |
| `tests/wave-override.test.ts` (NEW) | unit test | `tests/schemas.test.ts` (zod parse + refine assertions pattern) | Two suites: "honors override" (PLAN-02) and "rejects override < max(deps.wave)+1" (PLAN-03); test name suffix `-t reject` (Research §3 test map) | Do NOT test Kahn algorithm by re-implementing it in the test — use fixture graphs with known answers. |
| `tests/scheduler-stateless.test.ts` (NEW) | integration test | `tests/handoff.test.ts` (lines 1-60) — fixture .paper/ dir + after-run mtime check | Seed `.paper/STATE.json`, run scheduler, assert STATE.json mtime unchanged (ARCH-20 / D-04) | Do NOT use temp-dir cleanup hooks that race — `mkdtempSync(tmpdir(), ...)` once per test (mirror `tier-contract.test.ts:62`). |
| Patch `bin/lib/schemas/plan-frontmatter.ts` | schema extension | Self (lines 31-56 — existing schema shape) | Add `wave: z.number().int().positive().optional()` between `assigned_sources` and `verified_against_draft_hash`; keep `.refine` no-self-ref invariant | Do NOT make `wave` required (D-01 — optional override). Do NOT add a default value (`undefined` means "compute via Kahn"). |
| Patch `bin/lib/budget.ts` | re-verify export visibility | Self (line 166 — `export class Semaphore`) | No-op (already exported). If repo-internal-only, re-export from `bin/lib/scheduler.ts` so plans/test imports stay 1-deep | Do NOT add `p-limit` / `p-map` / any new dep (D-15 Phase 1 zero-runtime-deps). |

---

### Plan 2 — Write Orchestration (multi-section)

| File | Role | Closest Analog | Pattern to Copy (1-line signature) | Anti-pattern to Avoid |
|------|------|----------------|------------------------------------|------------------------|
| Patch `bin/cli/write.ts` | citty CommandDef extension | Self (lines 29-75 — citty `defineCommand` w/ positional + boolean args + `assertDrafterInput` chokepoint) | Add wave-mode branch when `args.n` absent: load outline → buildWaveGraph → `runWave(sem)` calling existing single-section path per node; keep `--yolo` boolean arg | Do NOT add `--section` aliasing — the positional `<n>` is the canonical single-section entry. Do NOT skip `assertDrafterInput` per node (line 63 chokepoint enforced). |
| Patch `workflows/write.md` | workflow body w/ capability_check | Self (lines 1-58 — existing `<capability_check>` + Body delegation pattern) | Add `<capability_check>` line for `MCP scheduler.run` with `degrade_if_missing: if no MCP scheduler: invoke bin/lib/scheduler.ts in-process`; add wave-mode status streaming JSON-line format (Research §L) | Do NOT add per-section approval prompts in the body — wave runs are batched; approval gates live in `--revise`, not `write`. Do NOT collapse the per-section narration into wave-summary (preserve Phase 3 per-section logging contract). |
| `bin/lib/write-orchestrator.ts` (NEW) | orchestrator / chokepoint | `bin/lib/handoff.ts::writeHandoff` (lines 56-84) — withLock + atomicWriteFile composition; Research §A code (`Promise.allSettled` + Semaphore.withLock per wave) | `runAllSections(outline, opts: { maxParallel: number }): Promise<WaveResult[]>` — drain waves serially, sections within wave via `sem.withLock(() => writePerSection(node))`; normalize rejections per Research §P pitfall 5 | Do NOT nest `Semaphore.withLock` calls (Research §P pitfall 4 deadlock). Do NOT cancel sibling sections on single failure (D-03 within-wave failure policy). |
| `tests/write-orchestrator.test.ts` (NEW) | integration test | `tests/section-isolation.test.ts` (lines 1-50 — multi-section fixture + per-section mtime assertions) | Seed 3-section fixture (slugs a, b, c; deps b→a, c→a); run with `maxParallel=2`; assert all 3 reach terminal state regardless of order | Do NOT assert on event ORDER (Research §O — assert on final settled state). Do NOT use real LLM calls — stub the per-section writer with a synthetic delay. |

---

### Plan 3 — Compile Pipeline

| File | Role | Closest Analog | Pattern to Copy (1-line signature) | Anti-pattern to Avoid |
|------|------|----------------|------------------------------------|------------------------|
| `bin/lib/compile.ts` (NEW) | pipeline orchestrator | `bin/lib/handoff.ts::writeHandoff` (lines 56-84) — lock + atomic-write composition; `bin/cli/verify.ts:62-138` (sequential pipeline w/ aggregator + emit) | 4-step pipeline per Research §F: (1) outline-order load + staleness check, (2) N-1 smoothing, (3) regen CITATIONS.bib + atomicWriteFile DRAFT.md, (4) emit COMPILE-REPORT.md; wrap whole pipeline in `withLock('.paper/.compile.lock')` (Research §P pitfall 6) | Do NOT concat in wave order (D-11 / Research §6 mistake #2 — outline order is the reader's experience). Do NOT skip the per-section per-staleness Pass 1+3 re-verify before concat (D-08). Do NOT invoke Pass 2/4 (Phase 5 scope, PRD §14). |
| `bin/lib/draft-hash.ts` (NEW) | pure crypto helper | `bin/lib/citekey.ts` (pure-helper module shape) + D-07 LOCKED input recipe | `computeDraftHash(draftBytes: Buffer, assignedSources: string[]): string` — `SHA-256(bytes + '\n' + JSON.stringify(sources.slice().sort()))`; pure, no I/O | Do NOT normalize draft bytes (D-07 — bytes-as-stored, no BOM strip, no CRLF→LF). Do NOT use `Set` then JSON.stringify (D-07 — `slice().sort()` produces a deterministic JS array). |
| `bin/lib/consistency-scan.ts` (NEW) | deterministic heuristic | `bin/lib/verify/pass1.ts:88-163` (per-citekey verdict producer; pure, deterministic, returns structured result) | `runConsistencyScan(compiledMd, sectionBoundaries): ConsistencyWarning[]` — 3 heuristics from Research §G (proper-noun divergence, abbrev collision, optional tense drift); warn-only | Do NOT escalate any heuristic to a hard block (COMP-07 explicit non-blocking). Do NOT enable heading-tense heuristic by default (Research §G — feature-flag `--lint-headings` off by default). |
| `bin/cli/compile.ts` (NEW from Phase 2 stub) | citty CommandDef | `bin/cli/verify.ts` (lines 40-139 — defineCommand + thin delegation to bin/lib/, atomicWriteFile of report, structured return) | `defineCommand({ args: { yolo, lintHeadings } })`; delegate 100% to `bin/lib/compile.ts::runCompile`; emit COMPILE-REPORT path + outcome to stdout | Do NOT inline compile pipeline logic in the verb (bin/cli is THIN orchestrator pattern). Do NOT call `console.*` (corrupts stdio MCP frame if wired into MCP later — same Pitfall-7 spirit as `mcp/server.ts:7`). |
| Patch `workflows/compile.md` | workflow body | `workflows/verify.md` (lines 1-136 — full Body + capability_check + Outputs + numbered steps + D-XX LOCKED INVARIANT footnotes) | Replace Phase 2 stub (lines 13-22) with full Body per Research §F 8-step pipeline; add `<capability_check>` for `Task` (parallel smoothing) + `MCP outline.read` w/ degrade rules | Do NOT exceed the existing Phase-3 workflow body length per file (`workflows/verify.md` ≈136 lines is the high-water mark). Do NOT reference Pass 2/4 prompts in the body (D-13 LOCKED INVARIANT — would trip the audit grep). |
| `templates/prompts/smoother.md` (NEW) | hash-pinned LLM prompt | `templates/prompts/section-drafter.md` (D-12 LOCKED slug — same file family) | Author per Research §H skeleton: 5 hard constraints (token-protection, no heading change, no claim invention, term preservation, output-only) + Input/Output section headers | Do NOT let the prompt see raw `[@citekey]` tokens (D-13 — substitution `{{cite_K_M}}` happens at the bin/lib/compile.ts boundary). Do NOT permit "explanation" output (output-only constraint or smoother token-set equality check WILL trip). |
| Patch `bin/lib/prompt-loader.ts` | EXPECTED_PROMPT_HASHES map | Self (lines 87-101 — 8-slug map w/ commented LOCK markers) | Add `'smoother': '<sha256>'` line w/ comment `// D-12 LOCKED + Phase 4 D-12` (or `__PENDING_HASH_smoother__` sentinel pattern from line 88-91 if hash deferred to post-author commit) | Do NOT add the slug without re-pinning `tests/repo-files.test.ts` in the same commit (lines 91-92 — single source of truth WN-3). Do NOT skip the sentinel-bypass env-var pattern (line 150-158) if hash is genuinely deferred. |
| `tests/compile-order.test.ts` (NEW) | unit test | `tests/section-isolation.test.ts` (fixture seed + assert pattern) | Seed 3 sections with computed wave-order ≠ outline-order; assert compile output's section heading order matches outline | Do NOT assert byte-equality on smoother output (LLM stochastic — assert structure only). |
| `tests/compile-staleness.test.ts` (NEW) | integration test | `tests/known-bad-citations.test.ts:48-50` (fixture + skip-if-missing + behavioral assertion) | Seed section with `verified_against_draft_hash` ≠ `computeDraftHash(currentDraft)`; assert compile emits WARN + auto-invokes Pass 1+3 | Do NOT block on PDF availability — use cassettes from Phase 3 Pass-1 fixtures (Research §N — reuse, don't re-record). |
| `tests/compile-smoother.test.ts` (NEW) | integration test (cassette) | `tests/known-bad-citations.test.ts` shape + `tests/cassette-size.test.ts` ≤50KB ceiling | Cassette-backed smoother LLM call across 3 boundary scenarios (clean / token-recovery / multi-paragraph); fixtures ≤5KB each | Do NOT exceed 5KB per cassette (Research §N risk — use ≤200-word paragraphs). Do NOT call live LLM in CI. |
| `tests/smoother-token-protect.test.ts` (NEW) | unit test | `tests/budget.test.ts` (pure-unit pattern, no fixtures) | Stub smoother to return token-set-drifted output → assert raw-concat fallback + WARN in COMPILE-REPORT (D-13) | Do NOT rely on regex equality on whole output — compare token-SETS only (added/removed/reordered all trip). |
| `tests/compile-bib-regen.test.ts` (NEW) | integration test | `tests/bibtex-write.test.ts` (citation-js chokepoint test pattern) | After compile, assert `.paper/CITATIONS.bib` re-rendered via `bin/lib/bibtex-write.ts` from union of all compiled sections' citekeys; collisions resolved via base-26 suffix per `bibtex-write.ts:14-20` | Do NOT bypass `bin/lib/citations.ts` chokepoint (D-19 — single citation-js import site). |
| `tests/compile-report-schema.test.ts` (NEW) | schema test | `tests/schemas.test.ts` (zod schema parse + validate pattern) | Assert frontmatter parses against `CompileReportSchema` from `bin/lib/schemas/compile-report.ts`; assert body has exactly 5 `## ` headers in D-14 order | Do NOT loosen `schema_version: z.literal(1)` (D-14 contract). |
| `tests/consistency-scan.test.ts` (NEW) | unit test | `tests/fuzzy.test.ts` (pure deterministic heuristic test pattern) | Synthetic 2-section markdown w/ "Bayesian Network" / "Bayesian network" variant → assert exactly one warning | Do NOT let FP rate exceed Research §G acceptance (≤30%); add positive-only cases to prevent test-suite regression. |
| `tests/cassettes/smoother-*.json` (NEW × 3) | test fixture | `tests/fixtures/cassettes/` existing adapter cassettes (`http-mock.ts:32-40` schema) | Match nock-compat shape: `{ scope, method, path, status, response, responseHeaders? }`; gitignore-tolerant naming | Do NOT include reqheaders/Authorization (sensitive-header scrub per `http-mock.ts:43-51`). |

---

### Plan 4 — Revise-Swap

| File | Role | Closest Analog | Pattern to Copy (1-line signature) | Anti-pattern to Avoid |
|------|------|----------------|------------------------------------|------------------------|
| `bin/lib/revise.ts` (NEW) | single chokepoint for Tier 1 + Tier 2 (D-06) | `bin/lib/verify/pass1.ts:177-197` (single-export pipeline that both CLI verify + future MCP path call) | `runRevise({ paperRoot, n, slug, yolo }): Promise<ReviseResult>` — parse VERIFICATION.md → first failing citation → load PLAN.md → call LLM via revise-swap prompt → parse strict JSON → approval gate (skip if `yolo`) → patch DRAFT.md via `atomicWriteFile` → reset `verified_against_draft_hash: null` via `updateFrontmatter` (Research §I 6-step flow) | Do NOT divergent code path between Tier 1 + Tier 2 (D-06 — single chokepoint). Do NOT auto-rewrite prose for `action: "remove"` (Research §I — mechanical bracket-clause delete; user re-runs `pensmith write` for substantive rewrite). |
| `bin/cli/revise.ts` (NEW) | citty CommandDef | `bin/cli/verify.ts` (lines 40-139 — thin orchestrator delegating to bin/lib/ + structured return) | `defineCommand({ args: { n: positional, section: alias, yolo: boolean } })` → delegate to `bin/lib/revise.ts::runRevise` | Do NOT inline revise logic in the verb. Do NOT auto-promote `--yolo` retry beyond 2 (D-06 — retry cap = 2). |
| `workflows/revise.md` (NEW) | workflow body | `workflows/verify.md` (full pattern incl. `<capability_check>` + Body + Outputs) | `<capability_check>` for `Task` (LLM call) + `AskUserQuestion` (approval gate w/ degrade to clack TTY); Body steps mirror Research §I flow | Do NOT skip the approval-gate (PRD §19 non-negotiable — default-on). Do NOT reference dormant Pass 2/4 prompts. |
| `templates/prompts/revise-swap.md` (NEW) | hash-pinned LLM prompt | `templates/prompts/section-planner.md` (D-12 LOCKED — structured output prompt with constraints + Input/Output sections) | Author per Research §I skeleton: 4 hard constraints (replacement from assigned_sources only, support-check, no-new-citekeys, strict-JSON output) + JSON schema in prompt body | Do NOT permit free-form output — strict JSON or zod parse rejects (Research §security/threat: LLM-response-injection mitigation). |
| Patch `bin/lib/prompt-loader.ts` | EXPECTED_PROMPT_HASHES map | Self (line 87-101) | Add `'revise-swap': '<sha256>'` alongside `smoother` (same commit as Plan 3 patch — recommend single batched edit) | Same as Plan 3: do NOT add slug without re-pinning `tests/repo-files.test.ts` PENDING_HASH_PINS. |
| `tests/revise-swap.test.ts` (NEW) | integration test | `tests/section-isolation.test.ts` (multi-step fixture w/ mtime assertions) | Seed section w/ VERIFICATION.md flagging citation → run revise w/ `--yolo` → assert DRAFT.md patched + frontmatter `verified_against_draft_hash: null` | Do NOT exercise the approval-gate UI in CI (use `--yolo` path or stub `@clack/prompts`). |
| `tests/cassettes/revise-swap-*.json` (NEW × 3) | test fixture | `tests/fixtures/cassettes/` adapter cassettes | Same nock-compat shape; 3 scenarios: swap-accepted, swap-rejected, remove-recommendation; each ≤3KB | Do NOT record cassettes w/ live API keys present (`http-mock.ts:43-51` scrub MUST run). |

---

### Plan 5 — RSCH-10 + COMPILE-REPORT + Path-Tolerance

| File | Role | Closest Analog | Pattern to Copy (1-line signature) | Anti-pattern to Avoid |
|------|------|----------------|------------------------------------|------------------------|
| `bin/lib/verify/freshness.ts` (NEW) | side-channel probe | `bin/lib/sources/retraction-watch.ts` (lines 1-127 — DOI-keyed cross-check, cassette-backed, returns structured result, warn-on-failure semantics) | `probeFreshness(citekey, doi): Promise<FreshnessResult>` — HTTP HEAD via `bin/lib/http.ts`, retraction-watch via existing `retraction-watch.ts::fetchById`; `Semaphore(5)` for HEAD fan-out (Research §J — same primitive as wave scheduler) | Do NOT block on network errors (D-10 — WARN-only; ECONNREFUSED/ETIMEDOUT = silent DEBUG per Research §J risk). Do NOT bypass DOI-regex validation pre-fetch (Research §security — SSRF mitigation). |
| Patch `bin/lib/verify/pass1.ts` | extension to existing pipeline | Self (lines 177-197 — `runPass1` aggregator pattern) | After main verdict loop, invoke `probeFreshness` per resolved citekey; append `freshness: FreshnessResult` field to `Pass1Result`; surface as `## Source Freshness` section in VERIFICATION.md (Research §J table) | Do NOT escalate freshness verdicts to FABRICATED/MIS-CITED (D-10 — WARN-only; PRD §14 hard-block reserved for fabrication/mis-cite). |
| `bin/lib/compile-report.ts` (NEW) | markdown renderer | `bin/cli/verify.ts:121-134` (template-literal narration pattern — D-13 LOCKED no-LLM rendering) | `renderCompileReport(input: CompileReportInput): string` — emits frontmatter (zod-validated via CompileReportSchema) + 5 body sections per D-14 schema v1 | Do NOT invoke LLM (D-13 spirit — deterministic narration only). Do NOT bump `schema_version` for additive Phase 5/6 fields (D-14 — additive-forward, only shape-break bumps version). |
| `bin/lib/schemas/compile-report.ts` (NEW) | zod schema | `bin/lib/schemas/handoff.ts:23-49` (literal schema_version + `.refine` size invariant + nested arrays) | `CompileReportSchema = z.object({ schema_version: z.literal(1), compiled_at: z.string().datetime(), sections_count: z.number().int(), stale_resolved_count: z.number().int(), refuse_reasons: z.array(z.string()) ... })`; Pandoc-reserved keys (`title`, `author`, `abstract`) reserved as `z.string().default('')` per D-14 | Do NOT use `.passthrough()` or `.catchall(z.unknown())` (ARCH-07 strict-by-default). Do NOT add `outline_hash` / `pandoc_target` (D-14 DRIFT — those were RESEARCH.md's mislabeled keys; the locked reserved-key set is `schema_version`, `compiled_at`, `sections_count`, `stale_resolved_count`, `refuse_reasons`, `title`, `author`, `abstract`). Pandoc keys MUST be present (even empty) so Phase 6 export reads them directly. |
| Patch `bin/lib/paths.ts` | helper extension | Self (lines 172-183 — `sectionDir`) | Add optional 4th arg `opts?: { letterSuffix?: string }`; emit `${pad2(n)}${letterSuffix}-${slug}` when provided (Research §K signature); add `parseSectionDirName(basename): { n, letterSuffix, slug } | null` defensive parser even though no Phase 4 caller (Research §K — cheap insurance) | Do NOT change existing 3-arg callsites (D-15 — Phase 4 must NOT emit suffixed paths). Do NOT skip null-byte / `..` / absolute-path validation in `parseSectionDirName` (Research §security — V12 ASVS). |
| `tests/freshness-probe.test.ts` (NEW) | unit test (cassette) | `tests/doi.test.ts` (DOI-keyed probe test pattern) | 3 cassette scenarios: DOI HEAD 200, DOI HEAD 404, retraction-watch hit; assert WARN emission + no hard-fail | Do NOT assert on stderr ordering (network-async). |
| `tests/letter-suffix-paths.test.ts` (NEW) | unit test | `tests/paths.test.ts` (existing `sectionDir` test pattern) | Assert `parseSectionDirName("02b-foo")` → `{n:2, letterSuffix:'b', slug:'foo'}`; assert `sectionDir(2, 'foo', root, { letterSuffix: 'b' })` → `<root>/.paper/sections/02b-foo`; assert reject on `..`, absolute, null-byte | Do NOT skip lex-sort invariant (`'02' < '02b' < '03'`) — explicit test per CONTEXT §specifics. |
| `tests/cassettes/doi-head-*.json` (NEW × 3) + `retraction-watch-hit.json` | test fixture | `tests/fixtures/cassettes/retraction-watch/` existing | nock-compat shape; ≤2KB each | Sensitive-header scrub per `http-mock.ts:43-51`. |

---

### Cross-Cutting

| File | Role | Closest Analog | Pattern to Copy (1-line signature) | Anti-pattern to Avoid |
|------|------|----------------|------------------------------------|------------------------|
| Extend `tests/tier-contract.test.ts` | tier-contract case extension | Self (lines 1-120 — Cases A/B/C/D pattern w/ `Client` + `StdioClientTransport` + `freshPaperRoot()` fixture helper + `assertEquivalent` for prose tolerance) | Add 3 new cases per Research §O: compile parity (Tier 1 MCP vs Tier 2 CLI produce same DRAFT.md ±20%), revise parity (identical patch), write-wave parity (Tier 1 parallel vs Tier 2 forced-sequential produce same final state) | Do NOT assert on event-ORDER (Research §O risk — assert settled state only). Do NOT skip the Tier 2 `--max-parallel 1` WARN-emission assertion (D-02). |
| Update `bin/lib/cli-aliases.ts` if exists | alias registry | NOT FOUND (no `bin/lib/cli-aliases.ts` — `tests/cli-aliases.test.ts` covers UX02_VERBS in `bin/lib/verbs.ts`) | Register `compile` + `revise` in `bin/lib/verbs.ts::UX02_VERBS` per pattern at `bin/pensmith.ts:37-50` (REAL_VERB_LOADERS map); both verbs already in UX-02 16-verb list (per `pensmith.ts:5` comment) | Do NOT add a new top-level verb outside UX-02 (D-05 — 16 verbs locked). `compile` + `revise` are already declared, just need real loaders registered. |

---

## Shared Patterns

### Atomic-Write Chokepoint (D-07 Phase 3 — ALL state-bearing writes)
**Source:** `bin/lib/atomic-write.ts:87-153` (`atomicWriteFile`)
**Apply to:** every new file emitter — `compile.ts` (DRAFT.md, COMPILE-REPORT.md, CITATIONS.bib), `revise.ts` (DRAFT.md patch + PLAN.md frontmatter), `write-orchestrator.ts` (per-section delegation), `freshness.ts` (VERIFICATION.md append)
**Signature:** `await atomicWriteFile(targetPath, content)` — never `fs.writeFile`, never `fs.promises.writeFile`, never `FileHandle#writeFile` (ESLint chokepoint catches all three)
**Anti-pattern:** any `cat << EOF > file`, any raw fs write — Phase 4 lint will block.

### withLock for Mutually-Exclusive State Writes (D-26 / ARCH-06)
**Source:** `bin/lib/state.ts:169-182, 222-238, 261-263, 293-305` (`withLock` wraps load-mutate-save in single critical section); `bin/lib/handoff.ts:74-83` (`lock` from `proper-lockfile` with `.lock` sentinel file pattern)
**Apply to:** `compile.ts` (whole-pipeline lock on `.paper/.compile.lock` per Research §P pitfall 6); `revise.ts` (per-section PLAN.md lock when resetting `verified_against_draft_hash`); `write-orchestrator.ts` (each section's PLAN.md mutation already locked via existing `updateFrontmatter` call)
**Anti-pattern:** lock on the target file itself — use a `.lock` sentinel (Research §P + `handoff.ts:32` `HANDOFF_LOCK_FILENAME = 'HANDOFF.json.lock'`). NEVER lock inside `.paper/` if cross-process — use `pensmithLockDir()` for cross-process; in-`.paper/` only acceptable for whole-pipeline single-process gate.

### Zod Schema Strictness (ARCH-07)
**Source:** `bin/lib/schemas/plan-frontmatter.ts:31-56` (strict by default + explicit `.optional()` + `.refine()` cross-field invariants); `bin/lib/schemas/handoff.ts:23-49` (literal `schema_version` + `.refine` size invariant)
**Apply to:** `wave-graph.ts` (in-memory only, but still strict to catch dev typos), `compile-report.ts` (frontmatter shape per D-14), `plan-frontmatter.ts wave?:` patch
**Anti-pattern:** `.passthrough()` / `.catchall(z.unknown())` — Phase 4 schemas refuse forward-incompat additions; let Phase 5/6 add fields via additive shape updates.

### Hash-Pinned Prompt Registration (D-12 Phase 3)
**Source:** `bin/lib/prompt-loader.ts:87-101` (`EXPECTED_PROMPT_HASHES` const) + `tests/repo-files.test.ts` import-binding (line 91-92 comment — single source of truth WN-3)
**Apply to:** Plan 3 (`smoother`) + Plan 4 (`revise-swap`) — both NEW slugs go in the same map, both need matching pins in `tests/repo-files.test.ts`
**Anti-pattern:** adding a slug to one file without the other (CI will block). Skipping the `__PENDING_HASH_<slug>__` sentinel pattern (line 88-101) when the prompt body is not yet byte-stable — sentinel + env-var bypass (line 150-158) lets in-flight prompt authoring proceed.

### Cassette Playback (Phase 3 D-23/D-24/D-25)
**Source:** `bin/lib/http-mock.ts:32-100` (nock-compat schema + `loadCassetteFile` sync API used by every adapter's `isOfflineMode()` short-circuit); `bin/lib/sources/retraction-watch.ts:94-114` (canonical adapter cassette-fallback pattern)
**Apply to:** `freshness.ts` (DOI HEAD + retraction-watch cassettes); compile + revise LLM cassettes via OpenRouter chokepoint (existing Phase 1 cassette path)
**Anti-pattern:** committing cassettes >50KB (`tests/cassette-size.test.ts` blocks merge). Committing cassettes w/ Authorization/x-api-key headers (`tests/cassette-no-leak.test.ts` blocks). Re-recording cassettes outside the cron-refresh tsx entry (D-24 — weekly recorder owns the bytes, dev-side `nock.recorder` is forbidden).

### MCP Tool Handler Thin Shim (D-08 Phase 2 — ≤30 stmts AST-counted)
**Source:** `mcp/tools.ts:69-251` (every handler delegates 100% to `bin/lib/*` and JSON.stringify-wraps the result — see `paper_capability_probe:164-174` for the canonical 5-line body)
**Apply to:** any new MCP tool added for Plan 1-5 — recommended NONE for Phase 4 (per Research §L: stdout streaming preferred over new MCP resource for wave progress; if added, must be a thin shim to `bin/lib/scheduler.ts`)
**Anti-pattern:** business logic in `mcp/tools.ts` handler bodies (`tests/mcp-server-thin-shim.test.ts` AST-counts and blocks). `console.*` calls (`mcp/server.ts:7` — corrupts stdio frame).

### Capability Composition (Phase 2 D-12)
**Source:** `bin/lib/capabilities.ts:67-106` (`loadCapabilityFacts` — SINGLE composition site for env + ecosystem probes; mcp/ never calls runtime-config loader directly)
**Apply to:** any Phase 4 surface that needs to introspect "is X tool available" (e.g., scheduler asking "is Task tool present for parallel wave?") — extend `loadCapabilityFacts`, do NOT add env-reads or runtime-config calls elsewhere
**Anti-pattern:** `process.env[...]` reads outside `bin/lib/paths.ts` or `bin/lib/capabilities.ts` (D-12 lint blocks). Returning resolved env values from a capability handler (`tests/capabilities.test.ts` sentinel-string leak detection blocks).

### Workflow Body Capability Check + Tier-2 Fallback (Phase 2 TIER-06)
**Source:** `workflows/verify.md:9-17` (`<capability_check>` block w/ `required:` + `degrade_if_missing:` rules); `workflows/write.md:7-13` (Tier 2 fallback line at body step 9)
**Apply to:** `workflows/compile.md` (patch — D-08 staleness re-verify is `Task`-parallelizable; degrades to sequential in Tier 2), `workflows/revise.md` (new — `AskUserQuestion` capability w/ degrade to `@clack/prompts` TTY)
**Anti-pattern:** workflow body invoking dormant prompts (Phase 3 audit grep on `workflows/verify.md` enforces; Phase 4's `workflows/compile.md` patch MUST not load Pass 2/4 prompts per D-13 LOCKED).

---

## No-Analog Cases

None. Every new file in Research §4 has at least a role-match analog in repo. The closest-to-novel files are:

- `bin/lib/consistency-scan.ts` — closest precedent is `bin/lib/verify/pass1.ts` (deterministic structured-result producer), but the SCANNING heuristics themselves are net-new (Research §G). Planner should treat the 3 heuristics from Research §G as the design spec and adopt the "pure function returning `Warning[]`" shape from `pass1.ts:88-163`.
- `bin/lib/outline-parse.ts` — closest precedent is `bin/lib/outline.ts` (raw loader, no parse) + `bin/lib/citekey.ts` (regex-based pure parser shape). Parser design depends on reading `templates/prompts/outline-author.md` first (Research §6 Q1).

Both have strong shape analogs even if the body logic is new.

---

## Metadata

**Analog search scope:**
- `bin/lib/**/*.ts` (chokepoints + helpers)
- `bin/cli/*.ts` (citty verb pattern)
- `mcp/*.ts` (tool/resource shim pattern)
- `workflows/*.md` (capability_check + Body delegation)
- `templates/prompts/*.md` (hash-pinned prompt convention)
- `tests/*.test.ts` (node:test + tsx + nock pattern)
- `bin/lib/schemas/*.ts` (zod strict-by-default pattern)
- `bin/lib/sources/*.ts` (cassette-backed adapter pattern)

**Files read (full or targeted):** 18
**Re-reads:** 0 (each file read once, targeted offset/limit where >2000 lines)

**Pattern extraction date:** 2026-05-29
**Phase planning ready:** YES
