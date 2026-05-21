---
phase: 3
reviewers: [gemini, codex, opencode]
reviewed_at: 2026-05-21T06:21:46Z
plans_reviewed:
  - 03-00-PLAN.md
  - 03-01-PLAN.md
  - 03-02-PLAN.md
  - 03-03-PLAN.md
  - 03-04-PLAN.md
  - 03-05-PLAN.md
  - 03-06-PLAN.md
  - 03-07-PLAN.md
  - 03-08-PLAN.md
  - 03-09-PLAN.md
runtime_skipped: "claude (running inside Claude Code — skipped for independence)"
unavailable_clis: [claude, cursor, qwen, coderabbit]
note: |
  Stricter-than-default convergence run. MEDIUM/LOW concerns that reveal real plan gaps
  are surfaced verbatim — orchestrator decides which to fold in.
  cursor-agent CLI not installed on this host; the Windows `cursor` binary is the IDE GUI.
---

# Cross-AI Plan Review — Phase 3 (Vertical Slice Through One Section)

## Gemini Review

# Phase 3 Plan Review: Vertical Slice Through One Section

Phase 3 is the architectural keystone for `pensmith`. It proves the "section-as-phase" directory isolation model and the "deterministic-first" verification mandate. The 10-plan sequence (03-00 through 03-09) is exceptionally well-structured, prioritizing test-bootstrap (Wave 0) and foundational primitives (Waves 1-2) before wiring the workflow surface.

## Summary
The implementation plan is high-quality, technically rigorous, and deeply aligned with the project's core mandates. It solves the "two-homes drift" (state duplication between `STATE.json` and `PLAN.md`) early via a versioned migration and enforces security chokepoints (S2 key no-leak, drafter input-contract) with both runtime and static checks. The dependency layout is realistic, and the success criteria are mapped to byte-exact assertions.

## Strengths
- **Nyquist Compliance:** Wave 0 (Plan 03-00) creates all 14 new test files and 5 extensions *before* production code lands. This prevents "blind" implementation and ensures a consistent feedback loop.
- **Structural Invariants:** The v1→v2 migration in Plan 03-03 is the most critical design win. It moves the source of truth for section state into the section directory, enabling the mtime-based isolation test (`TEST-09`) to be meaningful rather than tautological.
- **Deterministic Rigor:** Plans 03-01 and 03-02 hand-roll critical primitives (Jaro-Winkler, Levenshtein-substring) to avoid version-skew and sprawl, while wrapping brittle 3rd-party parsers (`pdf-parse`, `citation-js`) in strictly-enforced chokepoints.
- **Tier Equivalence:** The use of a shared prompt loader with runtime hash-validation (Plan 03-07) and equivalent verb entrypoints for both CLI and MCP ensure the "portable CLI" remains first-class alongside the plugin.
- **Safety Nets:** The weekly cassette-refresh cron (Plan 03-09) and the 5KB `HANDOFF.json` cap (Plan 03-08) address long-term maintenance and context-window constraints proactively.

## Concerns

### HIGH
- **Citekey Collision Risk:**
  - **Reason:** `citation-js` auto-generates citekeys during serialization. If multiple adapters return the same paper or different papers that result in the same key (e.g., `smith2024`), `CITATIONS.bib` may contain duplicates or clobbered entries.
  - **Location:** `bin/lib/bibtex-write.ts` (Plan 03-04) and `workflows/research.md` (Plan 03-06).
  - **Fix:** Ensure `writeBibtex` uses the unique `doi` or `arxivId` as a secondary keying mechanism, or explicitly handle key collisions in the library deduplication step (RSCH-07) before serialization.

### MEDIUM
- **Levenshtein Substring Performance:**
  - **Reason:** A sliding-window Levenshtein across a full extracted PDF text (potentially 50k+ chars) for every quote in a section could be $O(N \cdot M)$ where $N$ is PDF length and $M$ is quote length. Without banding or early exit, this could cause significant latency in Tier 2 or hook timeouts in Tier 1.
  - **Location:** `bin/lib/fuzzy.ts::levenshteinSubstring` (Plan 03-01).
  - **Fix:** Implement Ukkonen’s banded distance or a search-first heuristic (find exact/fuzzy anchor indices via `indexOf` before calculating distance) to prune the search space.

- **Hook Timeout Enforcement:**
  - **Reason:** `pre-compact.ts` must finish in 10s. It reads `STATE.md`, multiple `PLAN.md` files, and the `SESSION.log`. On Windows with OneDrive sync active, disk I/O latency can be high.
  - **Location:** `hooks/pre-compact.ts` (Plan 03-08).
  - **Fix:** Ensure the gather logic is strictly limited to the current section and a small tail of the log. The 5-breadcrumb limit is good; ensure the `statSync` calls are parallelized if the section count grows.

### LOW
- **Image-Only / Scanned PDFs:**
  - **Reason:** `pdf-parse` will return empty text for image-only PDFs. Pass 3 will fail (`NOT_FOUND`).
  - **Location:** `bin/lib/pdf-text.ts` (Plan 03-02).
  - **Fix:** Document this limitation in `VERIFICATION.md` output so users know a `NOT_FOUND` on a scanned PDF means "extraction failed," not necessarily "quote fabricated."

- **Dormant Prompt Drift:**
  - **Reason:** `pass1-fuzzy-judge.md` and `pass3-quote-checker.md` are hash-pinned but not used. They may become obsolete as the deterministic gates evolve in Phase 3.
  - **Location:** `templates/prompts/` (Plan 03-05).
  - **Fix:** Add a comment in `bin/cli/verify.ts` explicitly linking to these dormant prompts so that any developer changing the deterministic logic is reminded to update the future LLM-arbitration contract.

## Suggestions
1. **BibTeX Serialization Sorting:** In `bin/lib/bibtex-write.ts`, sort by `doi` or `id` before generating citekeys to ensure the generated keys are stable even if input ordering from adapters shifts.
2. **Migration Idempotence Test:** Add a test case specifically for a "partially migrated" state (e.g., 2 sections migrated, 1 not) to ensure `loadState` handles interrupted migrations or mixed-state directories.
3. **Discipline Fallback:** In `workflows/intake.md`, explicitly define the fallback behavior for the "Other" discipline (e.g., default to APA-7 and "academic-formal" tone).
4. **S2 Key Scrubbing:** In the cassette-refresh cron, add a `sed` or `grep -v` step to ensure no accidental `Authorization` headers survive in the committed cassettes if the secrets are leaked into the recording.

## Risk Assessment: LOW
The phase is well-derisked. The most complex logic (fuzzy matching and state migration) is covered by property tests (`fast-check`). The use of offline cassettes as the default for CI ensures high determinism. The biggest remaining risk is the performance of the sliding-window Levenshtein on large PDFs, but this is an optimization issue rather than a structural one.

---
**Review Status:** **PROCEED TO EXECUTION** (incorporate Citekey Collision and Levenshtein Optimization fixes during the respective plans).

---

## Codex Review

## Summary

The Phase 3 plan is ambitious and much more concrete than a typical implementation plan: it has decision traceability, wave ordering, fixtures, deterministic verifier gates, tier-contract intent, and explicit threat modeling. The strongest architectural direction is correct: canonical `.paper/CITATIONS.bib`, section-local state in `PLAN.md` frontmatter, deterministic Pass 1/Pass 3, and offline cassette-backed tests. However, several plans currently mix incompatible contracts, contain test/implementation contradictions, and overclaim end-to-end readiness before the underlying CLI behavior is realistically implementable. The biggest risks are schema drift between D-17 and Plan 03, prompt hash-pin workflow contradictions, incorrect usage of `citation-js`, lock/atomic-write flaws, weak Pass 3 quote test design, and tier-contract cases that are described as green before the app can produce real equivalent outputs.

## Strengths

- Clear Phase 3 boundary: one section only, APA only, deterministic Pass 1 + Pass 3 only.
- Good section-as-phase emphasis: moving section state out of project `STATE.json` is the right invariant.
- Good split between canonical citation metadata (`.paper/CITATIONS.bib`) and draft tokens (`[@citekey]`).
- Offline-first adapter testing with scheduled live cassette refresh is the right CI posture.
- D-13 dormant verifier prompts are called out repeatedly, reducing accidental LLM verdict influence.
- Wave 0 validation-first design is directionally strong and catches missing surfaces early.
- Retraction Watch as side-channel filter, not search adapter, is correct.
- Drafter input strict schema is a good safeguard against source-pool leakage.

## Concerns

- **HIGH — Handoff schema contradicts locked D-17.**  
  Location: D-17 vs Plan 03 Task 3.1 / Plan 08.  
  D-17 defines `.paper/HANDOFF.json` with `schema_version`, `last_updated`, `current_section`, `phase`, `next_action`, `breadcrumbs`, and `section_pointers`. Plan 03 replaces that with `schemaVersion`, `wave`, `resumePrompt`, and generic `pointers`. This drops section state snapshots, breadcrumbs, current section, and next action.  
  Suggested fix: restore the D-17 schema exactly, or explicitly revise the locked decision. Tests should assert D-17 fields and pointer-only behavior.

- **HIGH — State migration does not actually move section state into `PLAN.md`.**  
  Location: D-09 vs Plan 03 Task 3.2.  
  D-09 says v1 state migration reads embedded section state and writes it into each section’s `PLAN.md` frontmatter atomically, then slims `STATE.json`. The plan only drops fields and synthesizes `slug`. That loses section state and violates the stated migration purpose.  
  Suggested fix: migration must accept project root / paths, read or create target `PLAN.md`, merge frontmatter fields, atomic-write each plan, then write slim `STATE.json`. Add crash-mid-migration tests.

- **HIGH — `proper-lockfile.lock(HANDOFF_PATH)` before file exists is likely wrong.**  
  Location: Plan 08 Task 8.1.  
  `proper-lockfile` generally locks an existing path; `realpath: false` helps symlinks but does not guarantee locking a missing file. Also locking the final file while writing a `.tmp` file can fail on first run.  
  Suggested fix: lock the `.paper/` directory or a dedicated `.paper/HANDOFF.lock` file that is created first. Use existing `withLock` helper if available.

- **HIGH — Atomic write descriptions omit fsync despite claiming it.**  
  Location: Plans 03, 08, 04.  
  Plans repeatedly say “fsync + rename,” but snippets use `writeFile` then `rename` only. On crash/power loss, that is not the promised durability.  
  Suggested fix: route all writes through existing `bin/lib/atomic-write.ts`; do not reimplement in `handoff.ts` or state migration. Add a grep test banning raw `writeFile` for state/HANDOFF/section files outside the chokepoint.

- **HIGH — Pass 3 quote fixture logic can create false positives/negatives and does not enforce the 10-word fuzzy minimum.**  
  Location: D-06, Plan 00 known-bad-quotes, Plan 01 `levenshteinSubstring`, Plan 09 tests.  
  The planned Pass 3 simply slides a character window and compares ratios. It does not mention the required ≥10-word minimum in implementation. Some fixtures use short artifact words like `ﬁnal`, `naïve`, `end—to—end`; these may be below the minimum and should not fuzzy-match.  
  Suggested fix: implement `quoteHasMinimumWords()` and gate fuzzy matching. Known-bad fixtures should include full fabricated quoted passages ≥10 words, with artifact noise embedded.

- **HIGH — `citation-js` chokepoint/export contract is inconsistent.**  
  Location: Plan 02 says `citations.ts` exports `parseBibtex`, `renderApa` only; Plan 04 imports `{ Cite }` from `./citations.js`; Plan 07 expects hash pins via prompt-loader.  
  This will not compile unless `citations.ts` exports `Cite`, but doing so broadens the chokepoint API.  
  Suggested fix: add explicit wrapper functions: `cslJsonToBibtex(entries)` and `parseBibtexToCslJson(bibtex)`. Do not export `Cite` to consumers.

- **HIGH — Prompt hash-pin plan is contradictory and likely red for multiple waves.**  
  Location: Plan 00, Plan 05, Plan 07, Plan 09.  
  Plan 00 adds skipped `__PENDING__` sentinels. Plan 05 says it does not edit repo-files. Plan 07 says prompt-loader has real `<sha>` placeholders and tests import them, but Plan 09 finalizes hashes. If Plan 07 tests run before Plan 09, either runtime `loadPrompt` fails or repo-files fail.  
  Suggested fix: either pin hashes in Plan 05 immediately after writing prompts, or allow an explicit `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1` only in tests until Plan 09. Prefer immediate pinning in Plan 05.

- **HIGH — Tier-contract cases are declared green too early.**  
  Location: Plan 06 acceptance, Plan 07 acceptance, Plan 09.  
  Workflow markdown bodies alone cannot make tier-contract pass. The CLI implementations are only sketch-level in Plan 07 and likely cannot produce stable end-to-end outputs without real runtime orchestration.  
  Suggested fix: Plan 06 should only verify workflow body static invariants. Tier-contract should become green only in Plan 09 after real fixtures and CLI/MCP handlers exist.

- **HIGH — CLI implementation scope is underspecified relative to success criterion 1.**  
  Location: Plan 07 Task 7.2.  
  The task describes comments and high-level steps, not concrete deterministic behavior. Research/outline/write still require model calls or prompt execution, but the portable Node CLI against OpenAI-compatible endpoints needs runtime chat integration, cost cap, prompt calls, and yolo behavior.  
  Suggested fix: specify exact implementation path for `runtime.chat()`, prompt inputs/outputs, JSON parsing, fallback deterministic fixture mode for tests, and cost accounting.

- **HIGH — `new` is used instead of `intake`, but workflow/CLI naming is inconsistent.**  
  Location: workflows/intake.md, `bin/cli/new.ts`, tier-contract case names.  
  The plan uses `pensmith intake` in workflow body shell fallback but registers `new`. Tier-contract uses `new`. This creates command drift.  
  Suggested fix: choose one public verb. If public is `new`, workflow shell fallback must be `pensmith new`. If hidden/intake exists, document aliasing.

- **MEDIUM — SourceCandidate schema diverges from D-14.**  
  Location: D-14 vs Plan 03.  
  D-14 fields are `source`, `id`, `title`, `authors: string[]`, `year?`, `doi?`, `abstract?`, `oa_pdf_url?`, `retracted`, `last_verified`, `raw`. Plan 03 uses `authors: {family,given}[]`, `doi: nullable`, `oaPdfUrl`, no `id`, no `last_verified`, no `raw`, no `retracted`.  
  Suggested fix: either update D-14 or align schema. For adapters and BibTeX, `id`, `last_verified`, and `retracted` matter.

- **MEDIUM — D-17 says HANDOFF under `.paper/HANDOFF.json`, but section-isolation claims only target section mtimes change.**  
  Location: D-18, TEST-09, Plan 08.  
  If hooks run during tests, HANDOFF will change. If they do not, the invariant is incomplete.  
  Suggested fix: define TEST-09 scope precisely: command execution without hooks, or allow `.paper/HANDOFF.json` as an explicit non-section exception. Current wording conflicts.

- **MEDIUM — Frontmatter helper does not actually preserve removed keys/comments reliably.**  
  Location: Plan 08 `updateFrontmatter`.  
  It parses to JSON, mutates plain object, then `doc.set` keys. This preserves some comments but cannot delete keys and may not preserve complex YAML nodes.  
  Suggested fix: mutator should receive the `Document` or a helper API for set/delete. Add tests for comments, arrays, deletion, and order.

- **MEDIUM — Slug regex rejects planned Phase 4 `03b-` examples only if slug includes numeric prefix handling inconsistently.**  
  Location: D-03, paths helpers.  
  `sectionDir(n, slug)` returns `03-${slug}`. But D-03 examples use `depends_on: [01-introduction]`, meaning `slug` may include numeric prefix. PlanFrontmatter `slug` might be `introduction` or `01-introduction`; both appear.  
  Suggested fix: define canonical slug field: directory basename `03-foo` vs logical slug `foo`. `depends_on` should reference one, consistently. Tests must cover it.

- **MEDIUM — No citekey generation/collision policy.**  
  Location: Plan 04 BibTeX writer, Plan 06/07 drafter.  
  DRAFT requires `[@citekey]`, but SourceCandidate has no citekey. Relying on citation-js auto-generated citekeys is unstable and collision-prone.  
  Suggested fix: add deterministic citekey function, collision suffixing, and persist citekey in `LIBRARY.json` and BibTeX. Test same author/year/title collisions.

- **MEDIUM — Multi-author and surname matching are under-specified.**  
  Location: D-11, Plan 01/verify.  
  Author threshold compares first surname only, but adapters return author forms inconsistently. `Vaswani, A.` vs `Ashish Vaswani` works only accidentally with full strings.  
  Suggested fix: implement `firstAuthorSurname()` normalization, particles (`van`, `de`), initials, comma forms, and empty-author handling. Test Crossref/OpenAlex/S2 variants.

- **MEDIUM — DOI fabricated fixtures may hit network behavior not represented by cassettes.**  
  Location: Plan 00/09 known-bad-citations.  
  10.99999 and fake 10.1145 suffixes depend on Crossref response shapes. Offline tests need exact cassettes for those lookup failures, not generic `works-attention`.  
  Suggested fix: add Pass 1 cassettes for every known-bad DOI, or make `runPass1` accept injected fetch results.

- **MEDIUM — OA PDF unavailable, paywalled, image-only, and PDF parse failure are not specified.**  
  Location: verify workflow and Plan 07.  
  Core value depends on blocking when quote verification cannot run. The plan does not state verdict for no OA PDF, fetch failure, image-only PDF, or parse empty text.  
  Suggested fix: define verdicts: `PDF_UNAVAILABLE` / `TEXT_UNAVAILABLE` as blocking failures, distinct from `NOT_FOUND`. Add tests.

- **MEDIUM — Retraction warnings surfaced twice is described but not wired.**  
  Location: D-15, Plan 06 research/outline.  
  Research flags `retracted`, but outline approval gate warning is not concrete. Verify says retracted work becomes MIS-CITED, but schema lacks `retracted`.  
  Suggested fix: persist `retracted` and `retraction_details`; outline must render a warning section before approval; verify blocks cited retracted sources.

- **MEDIUM — PII redaction ordering is weak.**  
  Location: Plan 06 intake.  
  It says run redactor before persisting answers, but the clarifying prompt itself may send assignment text/answers to LLM before redaction. Context requires opt-in redaction before any LLM call.  
  Suggested fix: redact assignment and user answers before prompt interpolation/chat when opt-in is enabled. Add a test around `runtime.chat` input.

- **MEDIUM — S2 key leak via cassette recorder is only mentioned late.**  
  Location: Plan 09 threat model.  
  The scrubber must be in `http-mock.ts`/recording path, not a late “add if not already” note.  
  Suggested fix: Plan 04 must implement request/response header scrubbing for `Authorization`, `x-api-key`, cookies, and query secrets. Test cassette files do not contain env secret.

- **MEDIUM — Cassette refresh auto-PR lacks permissions and bot safety details.**  
  Location: Plan 09 workflow.  
  `peter-evans/create-pull-request` needs `contents: write` and `pull-requests: write`. Branch protection behavior and fork safety are not addressed.  
  Suggested fix: add explicit permissions, no secrets on PR events, scrub cassettes, labels, reviewers, and a dry-run/manual dispatch path.

- **MEDIUM — `http-mock.ts` in production tree imports `nock`, a dev/test dependency.**  
  Location: Plan 04.  
  Portable Node CLI may install production deps only. Importing `nock` from production code can break runtime packaging.  
  Suggested fix: either make `nock` a runtime dependency intentionally, or keep `http-mock.ts` dynamically imported only in tests/doctor with guarded error. Document packaging impact.

- **LOW — Wave 0 intentionally red tests may break normal CI unless explicitly gated.**  
  Location: Plan 00.  
  Existence assertions are “expected red,” but if merged by wave, CI fails.  
  Suggested fix: use `todo`/skip with a clear phase gate, or branch-only convergence runner. Do not make mainline tests intentionally fail.

- **LOW — `citation-render` depends on fetching upstream APA CSL during Plan 05.**  
  Location: Plan 05.  
  Network is restricted in many environments and upstream `master` is unstable.  
  Suggested fix: vendor a known APA CSL commit in the plan context or pin a commit SHA before implementation.

- **LOW — `Other` discipline inconsistency.**  
  Location: Context says presets include Other; Plan 05 omits Other from JSON.  
  Suggested fix: include `"other"` preset or update INTK-03 mapping and tests to expect fallback explicitly.

- **LOW — `jaroWinkler` property says symmetric, but classic Winkler prefix boost is symmetric only because common prefix is symmetric. Good, but floating tests need tolerance.**  
  Location: Plan 01.  
  Suggested fix: assert `Math.abs(a-b) < 1e-12`, not strict equality.

- **LOW — `levenshteinSubstring` character-window matching is weak for whitespace/punctuation differences.**  
  Location: Plan 01.  
  Suggested fix: compare token-normalized strings or word windows for quotes, not raw characters only.

## Suggestions

- Add a “contract consistency pass” before implementation: reconcile D-14 SourceCandidate, D-17 HANDOFF, D-08 PlanFrontmatter, command names, and prompt hash-pin workflow.
- Split Plan 07 into two plans: one for CLI plumbing/static commands, one for actual deterministic fixture-backed pipeline behavior.
- Add a verifier result schema with explicit blocking verdicts: `OK`, `FABRICATED`, `MIS-CITED`, `NOT_FOUND`, `PDF_UNAVAILABLE`, `TEXT_UNAVAILABLE`, `RETRACTED`.
- Define deterministic citekey generation early and make it part of `SourceCandidate`.
- Make `verify.ts` export pure `runPass1`/`runPass3` from `bin/lib/verify/` instead of CLI files.
- Add static tests that fail if `workflows/verify.md` or `bin/cli/verify.ts` references dormant prompt slugs.
- Add fixture-level `.paper/` golden directory for SC-1 instead of trying to synthesize all prerequisites in tier-contract tests.
- Add crash-safety tests for migration: crash after PLAN write before STATE write, rerun migration, assert idempotent repair.

## Risk Assessment

**Overall risk: HIGH.** The direction is sound, but the current plans contain several contract mismatches and implementation gaps that could produce a green-looking surface without proving the core value. The highest-risk areas are migration correctness, citation/citekey determinism, Pass 3 failure semantics, prompt hash-pin sequencing, and tier-contract realism. Addressing those gaps before implementation would likely reduce Phase 3 to **MEDIUM** risk; without fixes, the convergence loop will probably stall on contradictory tests and incomplete end-to-end behavior.

---

## OpenCode Review

# Cross-AI Plan Review — Phase 3 (Vertical Slice)

## Summary

Phase 3's 10 plans are well-structured, the section-as-phase invariant is properly enforced by directory structure, and the deterministic verifier design is sound. However, I found **1 HIGH, 6 MEDIUM, and 4 LOW** concerns that need addressing before execution. The highest-risk issue is the v1→v2 migration dropping section state without writing it to PLAN.md frontmatter (D-09 implementation gap).

---

## Strengths

- **Section-as-phase directory isolation** — re-doing section N genuinely cannot touch other sections. The path helpers validate slug regex, the workflow bodies reference only their sectionDir, and the test asserts mtime invariance. Clean.

- **D-13 deterministic verify architecture** — separating the deterministic verdict computation (Pass 1/3 via JW/Levenshtein) from the dormant LLM prompts, and encoding DORMANT status in both frontmatter and grep gates. The and-gate algebra (DOI necessary, fuzzy sufficient, AND both thresholds) is correctly spec'd.

- **Offline CI via cassettes + weekly cron** — PR gate is deterministic; API drift caught on bounded cadence. Forward-port of TEST-V2-02 preserves the Phase 1 offline-default discipline.

- **WN-3 single-source-of-truth for hash-pins** — `EXPECTED_PROMPT_HASHES` in prompt-loader.ts, imported by `tests/repo-files.test.ts`. Structural impossibility of drift between the two.

- **Wave 0 test-bootstrap pattern** — 20 test files scaffolded red before any production code, with skip-guard pattern that prevents import-time failures while producing clear MISSING messages. Nyquist-compliant.

---

## Concerns

### HIGH

**1. v1→v2 migration drops section state without writing to PLAN.md frontmatter (migration data loss)**

**Plan 03-03, Task 3.2 — `bin/lib/migrations/state/v1_to_v2.ts`**

D-09 explicitly requires: "the loader reads the embedded section state, writes it into the corresponding sections/<NN-slug>/PLAN.md frontmatter (atomic-write-protected)." But the migration implementation only drops `state`, `status`, `lastVerification` from the STATE.json; it never writes these into per-section PLAN.md files. If a v1 user had section state (planned/writing/written/verified status per section) and the section directories already exist, that state is permanently lost after migration.

**When this triggers:** Any v1 state.json where `sections[]` entries have non-null `state`/`status`/`lastVerification` AND the corresponding `.paper/sections/<NN>/PLAN.md` files already exist.

**Suggested fix:** The migration must:
1. For each section entry with existing `state`/`status`/`lastVerification` values
2. Check if `.paper/sections/<NN>-<slug>/PLAN.md` exists
3. If it does, read it, update its frontmatter with those values (using `bin/lib/frontmatter.ts` `updateFrontmatter`), and atomic-write it back
4. Then write the slimmed STATE.json v2

Guard with: if the section directory doesn't exist (outline not yet run), it's safe to drop the state since there's no PLAN.md to write to. Add a test that migrates a v1 state with verified-status sections and asserts PLAN.md frontmatter after migration.

**2. Pass 3 OA PDF unavailability not handled — verifier cannot produce complete verdict**

**Plans 03-06 (workflows/verify.md), 03-07 (bin/cli/verify.ts)**

The verify workflow body says "fetch OA PDF via sources.unpaywall.fetchById(doi)" but doesn't specify what happens when:
- Unpaywall returns `null` (no OA version exists for this DOI)
- The OA PDF URL returns 403/404
- The PDF is image-only (pdf-parse returns empty string)
- The HTTP fetch times out

Currently the verifier would either crash (null dereference on URL), return an empty normalized string (match succeeds trivially on empty === empty → false positive "OK" for every quote), or stall. None are acceptable for a blocking deterministic verifier.

**Suggested fix:** Define three verdict levels: OK / NOT_FOUND / UNVERIFIABLE. When OA PDF is unavailable, emit UNVERIFIABLE with the reason. The overall verdict is PASS only if every verdict is OK; FAIL if any is NOT_FOUND; UNKNOWN if any is UNVERIFIABLE and none are NOT_FOUND. Wire this into the D-08 status enum (add 'unverifiable'?) and the PASS/FAIL/UNKNOWN computation. Tests must include an Unpaywall-null-returning cassette.

---

### MEDIUM

**3. Pass 3 quote extraction heuristic is underspecified and brittle**

**Plan 03-06, workflows/verify.md — Pass-3 step**

The plan says: "Extract every quoted passage from DRAFT.md (heuristic: text in '...' or > 25 words on a single line)." This is not a deterministic algorithm. Academic DRAFT.md will have:
- Block quotes (indented, no surrounding quotes)
- Scare-quoted terms ("attention" — 1 word, missed by the heuristic)
- Multi-paragraph quotes (opening `"` on one line, closing `"` lines later)
- Quotes with citation tokens inside quotes (`"As [@smith2020] notes..."`)
- Block quotes using `> ` syntax

The heuristic as specified would pass multi-paragraph quotes entirely unverified (false OK) and flag long sentences as quotes (false NOT_FOUND).

**Suggested fix:** Implement a deterministic quote extractor in `bin/lib/quote-extractor.ts` with:
- Regex for `"..."` spans (handling nested quotes and multi-line)
- Block-quote detection (lines starting with `>` — extract text after `>`)
- Minimum 5-word threshold (filters scare quotes, catchphrases)
- Strips citation tokens `[@citekey]` from the extracted text before comparison
- Exported as a pure function so the known-bad-quotes test can unit test it separately
- Include fixtures for each quote type (block, multi-paragraph, nested, citation-embedded)

**4. Cassette refresh cron has no recording mechanism — won't work**

**Plan 09, Task 9.2 — `.github/workflows/cassette-refresh.yml`**

The cron workflow runs `PENSMITH_NETWORK_TESTS=1 npm test -- --test-name-pattern="sources/"` but the adapter tests (Plan 04 Task 4.2/4.3) use cassettes via `http-mock.ts` `loadCassettes()` which calls `nock.disableNetConnect()`. With PENSMITH_NETWORK_TESTS=1, `isOfflineMode()` returns `false`, but the tests don't know how to switch to live-API mode — they still try to match against cassettes.

The `http-mock.ts` from Plan 04 only implements read/load. There's no record-mode implementation (`nockBack` or equivalent). The cron will either:
(a) Die because nock lockdown prevents live connections, or
(b) Run against live APIs but not capture the responses to update cassette files.

Research pitfall #6 ("nockBack mode confusion") explicitly flags this risk.

**Suggested fix:** Implement a record-mode in `http-mock.ts`:
```typescript
export async function recordCassettes(adapter: string, recordFn: () => Promise<void>): Promise<void> {
  // Use nockBack to replay existing cassettes + record missing ones
  // On cron: use nockBack with `{ recording: true }` to overwrite
}
```
The cron workflow should:
1. Clear old cassettes
2. Run in recording mode (nockBack record)
3. Write updated cassettes
4. The create-pull-request action picks up the diff
5. Strip `x-api-key` headers from all recorded cassettes before writing

Add T-3-EXFIL-01 mitigation: the recorder MUST strip Authorization/x-api-key headers. Add a test `tests/cassette-no-leak.test.ts` that godeeperate through all cassettes and asserts no `x-api-key` or `Authorization` headers.

**5. AND-gate algebra underspecified for metadata field absence**

**Plan 03-06, workflows/verify.md — Pass 1 step**

The D-11 AND-gate: DOI resolves correctly AND titleJW ≥ 0.92 AND authorJW ≥ 0.85. But what if:
- DOI resolves 200 but the response has no `title` field (404 page, bare landing page)?
- DOI resolves but `author` array is empty or missing surname?
- The Crossref response has a `title` that is itself a fabricated metadata string?
- Two DOIs for the same paper (errata, versioning — Crossref returns the updated version, BibTeX cites the original)?

The plan says "DOI integrity (Pass 1 fetch returning 200 + correct metadata field-presence)" but never defines "field-presence." Is it: response has `message.type === 'journal-article'`? Has `message.title` as non-empty array? Has `message.author[0].family` non-empty?

**Suggested fix:** Define explicit field-presence criteria in the verify workflow:
- Title must be a non-empty string after NFKC normalize (title missing → FABRICATED)
- Author must have at least one entry with non-empty `family` (author missing → FABRICATED)
- If DOI resolves to a redirect/403/non-200 → FABRICATED
- If DOI resolves but has `message.retracted === true` → MIS-CITED with reason "retracted"
- Multiple-DOI matching: if the resolved DOI differs from the claimed DOI but the fuzzy match passes → log a note but still pass (Crossref handles DOI redirects transparently via their API)

**6. Pass 3 OA PDF URL from Unpaywall may be paywalled or behind CAPTCHA**

**Plan 03-04, unpaywall.ts + verify.md Pass-3 step**

Unpaywall's `best_oa_location.url_for_pdf` can return:
- A publisher landing page (not a direct PDF) that requires a subscription
- A link to a PDF that's behind a CAPTCHA
- A link to a PDF that requires a click-through license agreement
- A link that has since expired (broken)

The plan assumes `.url_for_pdf` is always directly downloadable. When it's not, `http.get` will either get an HTML page (not PDF) or a 403. In either case, `pdf-parse` will fail or return garbage text, and the quote won't be found.

**Suggested fix:** Add a `bin/lib/pdf-fetch.ts` chokepoint that:
1. Fetches the URL with a browser-like User-Agent
2. Checks `content-type` for `application/pdf` (if HTML, returns UNVERIFIABLE with reason)
3. Returns the Buffer for pdf-parse
4. Includes a timeout (10s default, matching the Phase 2 retry pattern)
5. Logs a debug message for failed PDF fetches but does NOT fail the overall verify (marks those entries as UNVERIFIABLE)

**7. Known-bad-quotes test doesn't exercise real pdf-parse pipeline**

**Plan 09, Task 9.2 — known-bad-quotes.test.ts**

The test feeds `claimed_quote` + `actual_pdf_snippet` directly to `runPass3()`, bypassing pdf-parse entirely. This means the pdf-parse pipeline (network → bytes → extract → normalize → match) is only exercised by the tier-contract verify case and the DOCT-05 wiring probe.

If pdf-parse@1.1.1 has a regression in a future install (npm ci on a new machine), only the tier-contract test catches it. A single point of failure.

**Suggested fix:** Add a `tests/pdf-extract-smoke.test.ts` that:
- Uses `SYNTHETIC_VASWANI_FRAGMENT` from Plan 02's fixture
- Converts it to a minimal valid PDF via a tiny PDF generator (or commits a tiny 2KB known-good PDF fixture)
- Runs `extractPdfText` on it
- Asserts output matches the original fragment (allowing for pdf-parse whitespace normalization)

Alternatively, adds one more entry to `known-bad-quotes.json` that runs through the full pipeline (fake bytes → pdf-parse → normalize → match) to prove the chain doesn't crash.

---

### LOW

**8. BL-2 grep gate for D-13 enforceability is fragile**

**Plan 06, verify.md acceptance criteria**

```bash
grep -cE "invoke .*prompt|delegate to Task|invoke verify-pass|invoke pass1|invoke pass3" workflows/verify.md
```

The regex `invoke .*prompt` matches any line with "invoke" followed eventually by "prompt" anywhere on the same line — including a comment like `// do NOT invoke any prompt here`. The regex is not robust against defensive coding. A future editor could accidentally match or bypass the gate through minor phrasing changes.

**Suggested fix:** Use a structured frontmatter field instead: add `llm_invocations: []` to the verify.md frontmatter, and write a test that parses this field and asserts it's an empty array. The test uses YAML parsing, not grep, so comments can't false-positive.

**9. Plan 09 verify.ts helper export should be in Plan 07, not retrofitted in Plan 09**

**Plan 09, Task 9.2 vs Plan 07, Task 7.2**

The `runPass1` and `runPass3` helpers should be designed and exported from the beginning in Plan 07, not discovered as a need in Plan 09 and retrofitted. Retrofitting means either:
- Plan 07's verify.ts won't be cleanly testable (you can't unit-test Pass 1/3 until Plan 09)
- The retrofitted export API may not match what the known-bad-* tests need, causing last-minute churn

**Suggested fix:** In Plan 07 Task 7.2, have verify.ts export `{ default, runPass1, runPass3 }` from the start. The test stubs from Plan 00 already import from this path with skip-guards, so the API contract is locked from Wave 0.

**10. `npx tsx bin/pensmith.ts` calls across plans assume a specific working directory**

**Plan 09, Task 9.2 and 9.4**

The section-isolation test and the smoke test use `{ cwd: tmpDir }` but invoke `npx tsx bin/pensmith.ts`. This assumes the pensmith project root is the current dir when spawned. If `tmpDir` is `/tmp/pensmith-smoke` but the CLI entrypoint resolves paths relative to cwd (for `.paper/` resolution), this should work. But if the CLI entrypoint resolves paths relative to `__dirname` (which is the pensmith repo root), it won't find the `.paper/` in the tmpDir.

The plan doesn't specify how `.paper/` is resolved relative to cwd vs the binary's location. If it's relative to cwd (as the path helpers suggest: `.paper/` is a relative path), then the cwd option is correct. This should be made explicit in the design to prevent confusion.

**Suggested fix:** Add a note to the section-isolation test and smoke test instructions: "The `.paper/` resolution is relative to cwd, so `cwd: tmpDir` correctly isolates each test run." Or, if path resolution is relative to the binary, add a `--paper-dir` flag to override.

---

## Suggestions

1. **Add 'unverifiable' to D-08 status enum** for Pass 3 cases where OA PDF is unavailable (part of concern #2 fix).

2. **Pre-commit hook for prompt hash-pin updates** — when `templates/prompts/*.md` changes in staging, the commit should fail unless `EXPECTED_PROMPT_HASHES` in prompt-loader.ts also changes. Simple pre-commit grep or lint rule. Reduces risk of T-3-09 (silent drift) at the commit level, not just PR-review level.

3. **Split verify.ts into lib/verify/pass1.ts + lib/verify/pass3.ts** — the verify verb is going to be the most complex module in pensmith. Having two library modules for the deterministic passes (plus a narration module) keeps each file under 150 LOC. The bin/cli/verify.ts entrypoint becomes a thin orchestrator (~30 LOC under ARCH-18). This also naturally resolves concern #9 (helper exports for testability) since the lib modules would export `runPass1` and `runPass3` directly.

4. **Fix the `bibtex-write.ts` sorting approach** — rather than splitting on `\n(?=@)`, which breaks on BibTeX URL fields containing `@`, use a citekey-based ordering: emit entries in sorted order by maintaining a sorted map of citekey → CSL-JSON, then constructing one Cite instance per ordered entry and concatenating. More robust, though slightly slower.

5. **Add a `pensmith doctor --no-network` mode** that skips DOCT probes requiring live APIs (to match the offline CI invariant). The existing DOCT-05 only checks wiring, but future DOCT probes may hit external APIs.

---

## Risk Assessment: MEDIUM

**Justification:**
- **High risk:** The v1→v2 migration data loss (concern #1) is a real data-loss bug in the current plan. If deployed as-is, any upgrade from v1 to v2 with active sections loses per-section state. Must be fixed before implementation.
- **Medium risks:** OA PDF unavailability (concern #2) and cassette refresh recording (concern #4) are architectural gaps that will surface immediately during smoke testing. Quote extraction (concern #3) and AND-gate underspecification (concern #5) are design holes that will produce wrong verdicts for real papers.
- **Low risks:** The remaining concerns are organizational, documentation, or testing-depth issues that can be fixed during execution without architectural change.
- **Dependency ordering is sound:** Waves 0→5 are correctly sequenced. Wave 1 (normalize/fuzzy) must precede Wave 3 (adapters) and Wave 4 (workflows/verbs). No blocking latent serialization.
- **Phase 3 success criteria are achievable** once the HIGH and MEDIUM concerns are resolved. SC-2 (10/10 FABRICATED) and SC-3 (10/10 NOT_FOUND) will work with synthetic data. SC-4 (mtime invariance) is structurally enforced. SC-5 (tier-contract) is a test, not a behavioral gap.

**Recommendation:** Fix concerns #1, #2, #4, and #6 (highest impact) in the plan documents before executing. The remaining concerns can be tracked as execution tasks.

---

## Consensus Summary

Three independent reviewers (Gemini, Codex, OpenCode) examined the Phase 3 plan corpus (10 plans, CONTEXT, RESEARCH, VALIDATION, DISCUSSION-LOG, PATTERNS) end-to-end. The reviewers diverge on overall risk rating — Gemini says LOW ("PROCEED TO EXECUTION"), OpenCode says MEDIUM, Codex says HIGH — but they converge tightly on the specific gaps that explain the spread. The single most agreed-on issue is **the v1→v2 state migration silently drops embedded section state instead of writing it into PLAN.md frontmatter as D-09 requires.** Both Codex (HIGH) and OpenCode (HIGH) call this out as a data-loss bug; Gemini surfaces a related concern (partial-migration test coverage). Beyond migration, the cluster of concerns falls into five themes: (1) verifier failure-mode semantics (OA PDF unavailable / image-only / paywalled / fetch error all undefined as verdicts); (2) contract drift between locked decisions and plan-level schemas (D-14 SourceCandidate ↔ Plan 03; D-17 HANDOFF schema ↔ Plan 03/08; D-08 PlanFrontmatter slug vs directory basename); (3) deterministic-citekey + multi-author surname handling; (4) cassette-refresh cron workflow correctness (no actual record-mode implementation, no header-scrubbing, no auth permissions); (5) Pass-3 quote extraction underspecification (block quotes, multi-paragraph, scare quotes, citation tokens inside quotes, the unstated ≥10-word minimum). All three reviewers explicitly endorse the section-as-phase directory-isolation invariant, the deterministic-first Pass 1/3 architecture, the offline-cassette CI posture, and the Wave 0 test-bootstrap discipline.

### Agreed Strengths

- **Section-as-phase directory isolation is structurally enforced**, not policed by careful prompting — re-doing section N cannot touch other sections by construction (Gemini, OpenCode, Codex all endorse).
- **Deterministic-first Pass 1 + Pass 3 architecture with dormant LLM prompts for Phase 5** — D-13 split (deterministic verdicts; LLM prompts ship as locked interaction contract) is praised by all three reviewers. The AND-gate algebra (DOI integrity necessary, JW title ≥ 0.92 AND author ≥ 0.85 sufficient) is correctly spec'd at the decision level.
- **Offline-cassette CI + weekly cron-refresh** forward-ports TEST-V2-02 cleanly; PR-gate stays deterministic, drift gets caught on a bounded cadence (Gemini, Codex, OpenCode).
- **Wave 0 test-bootstrap discipline (Nyquist)** — 14 new test files + 5 extensions scaffolded RED before production code lands, with skip-guards so import-time doesn't fail (Gemini, OpenCode, Codex).
- **Chokepoint discipline carried over from Phase 0/1/2** — `pdf-parse` wrapped by `bin/lib/pdf-text.ts`, source adapters route HTTP through `bin/lib/http.ts`, citation-js wrapped by `bin/lib/citations.ts`. AST/ESLint enforcement matches Phase 2 D-09/D-10/D-12 pattern (Gemini, Codex).
- **APA-7 CSL bundling + Pandoc-token DRAFT.md** — deferring write-time render to compile/export gives token-level tier-equivalence and zero-touch multi-style support in Phase 9 (Codex, Gemini, OpenCode).

### Agreed Concerns (raised by 2+ reviewers — highest priority)

1. **HIGH — v1→v2 state migration does NOT write section state into per-section PLAN.md frontmatter (D-09 implementation gap, data loss bug).** Codex + OpenCode both flag this as the most critical issue. The plan slims STATE.json but never writes the embedded `state`/`status`/`lastVerification` into the corresponding `sections/<NN-slug>/PLAN.md` files as D-09 explicitly requires. Any v1 user with active sections loses per-section state on upgrade. Gemini's "partial-migration test" suggestion is the same risk surface seen from the testing angle. Fix: migration must read embedded section state, locate the corresponding PLAN.md, merge frontmatter atomically, and only then write the slimmed STATE.json. Add a crash-mid-migration test that asserts idempotent repair.

2. **HIGH/MEDIUM — Pass 3 verifier has no defined verdict for OA PDF unavailable / paywalled / image-only / fetch-error / parse-empty.** Codex (HIGH) + OpenCode (HIGH on PDF unavailable, MEDIUM on Unpaywall paywalled URLs). The Core Value claim ("every citation supports its claim, verified by re-fetch") collapses if there is no defined verdict when the verifier cannot actually fetch text. Suggested fix from both: add explicit blocking verdicts `PDF_UNAVAILABLE` / `TEXT_UNAVAILABLE` (or `UNVERIFIABLE`) distinct from `NOT_FOUND`. Wire them into the D-08 status enum and the PASS/FAIL computation. Add cassettes for null-Unpaywall, HTML-instead-of-PDF, and parse-empty cases.

3. **HIGH — Tier-contract cases declared green too early.** Codex calls this out explicitly: workflow markdown alone cannot make tier-contract pass; the CLI implementations in Plan 07 are sketch-level. Gemini's tier-contract claim is implicit but rests on the same plumbing. Suggested fix (Codex): split into Plan 06 = workflow body static invariants only, Plan 09 = tier-contract green after real CLI/MCP handlers and fixture-backed runs exist.

4. **HIGH — Pass 3 quote extraction heuristic is brittle and underspecified.** OpenCode (MEDIUM) + Codex (HIGH). The plan says "text in quotes or > 25 words on a single line" — this misses block quotes (`> ` syntax), multi-paragraph quotes (open quote on one line, close quote later), nested quotes, scare-quotes, and quotes containing `[@citekey]` tokens. The plan also does not enforce the ≥10-word fuzzy minimum required by VRFY-05. Suggested fix: dedicated `bin/lib/quote-extractor.ts` with proper regex, block-quote detection, citation-token stripping, and unit tests with fixtures for each quote type.

5. **HIGH/MEDIUM — Citekey generation is non-deterministic and collision-unsafe.** Gemini (HIGH) + Codex (MEDIUM). DRAFT.md emits `[@citekey]` tokens; `SourceCandidate` schema has no `citekey` field; `citation-js` auto-generates them at serialization, and the result depends on input ordering, encoding, and per-source quirks. Same-author/same-year/different-paper or duplicate-DOI inputs would clobber entries. Suggested fix: deterministic citekey function (e.g., surname+year+titleslug), collision suffixing, persist citekey in `LIBRARY.json` and BibTeX from the start.

6. **MEDIUM — D-17 HANDOFF schema diverges between CONTEXT and Plan 03/08.** Codex flags this explicitly. CONTEXT D-17 specifies fields `schema_version`, `last_updated`, `current_section`, `phase`, `next_action`, `breadcrumbs`, `section_pointers`. Plan 03 / Plan 08 substitute `schemaVersion`, `wave`, `resumePrompt`, generic `pointers`. This means HANDOFF would not carry the section state snapshot, breadcrumbs, or next action that the locked decision requires. Either restore D-17 exactly OR explicitly revise the locked decision. Tier-contract tests must assert D-17 fields.

7. **MEDIUM — `SourceCandidate` schema diverges between D-14 and Plan 03.** Codex notes D-14 fields `source/id/title/authors:string[]/year?/doi?/abstract?/oa_pdf_url?/retracted/last_verified/raw` vs Plan 03's `authors:{family,given}[]/doi:nullable/oaPdfUrl` with no `id`, `last_verified`, `raw`, or `retracted`. Retraction-Watch warning surfacing twice (D-15) cannot be wired without a `retracted` field. Either update D-14 or align the plan schema.

8. **MEDIUM — Multi-author + surname matching underspecified.** Codex specifically calls out: author threshold uses "first surname only" but adapters return author forms inconsistently (`Vaswani, A.` vs `Ashish Vaswani`, particles like `van`/`de`, comma forms, initials). Add `firstAuthorSurname()` normalization with explicit handling for particles, initials, commas, and empty-author cases. Test with Crossref/OpenAlex/S2 variants.

9. **MEDIUM — Cassette refresh cron workflow will not actually record.** OpenCode + Codex both flag this. The cron runs `PENSMITH_NETWORK_TESTS=1 npm test` but `http-mock.ts` has no record-mode (`nockBack` recording) implementation. The cron will either die from nock lockdown or hit live APIs without capturing. Suggested fixes: implement `recordCassettes()` in `http-mock.ts`; strip `Authorization` / `x-api-key` / `Cookie` headers from recorded cassettes before writing; add `tests/cassette-no-leak.test.ts` enforcing zero auth-header bleed; set explicit GH Actions `permissions: contents:write, pull-requests:write`; pin branch protection bypass policy.

10. **MEDIUM — Pass 1 AND-gate underspecified for metadata field-presence corner cases.** OpenCode raises this; Codex's "MIS-CITED logging" implies the same gap. What if Crossref returns 200 with empty `title` array? Empty `author[0].family`? Type other than journal-article? Retracted-flag in response? Multi-DOI redirect (errata)? Define explicit field-presence criteria in the verify workflow body so Pass 1 verdicts are reproducible byte-exactly across tiers and OSes.

11. **MEDIUM — Slug/depends_on identifier conventions are inconsistent.** Codex notes `sectionDir(n, slug)` returns `03-foo` while D-03 examples cite `depends_on: [01-introduction]`. PlanFrontmatter `slug` could be either `introduction` (logical) or `01-introduction` (directory basename). Pick one canonical form and lock it; add tests covering both write and read paths.

12. **MEDIUM — Prompt hash-pin sequencing across waves is contradictory.** Codex flags: Plan 00 adds `__PENDING__` sentinels; Plan 05 says it does not edit repo-files; Plan 07 has real `<sha>` placeholders; Plan 09 finalizes. If Plan 07 tests run before Plan 09, either runtime `loadPrompt` fails or repo-files fail. Either pin in Plan 05 immediately after the prompts are written, or gate with an explicit `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1` test-only env var until Plan 09.

13. **MEDIUM — `http-mock.ts` ships in production tree but depends on `nock` (dev dep).** Codex: the Phase 2 codex-iter-1 review concern ("production probes must not import from tests/") is addressed by moving the mock to production, but this just shifts the dep-graph violation. Either move `nock` to a runtime dep (with packaging-impact note), or use a dynamic import guarded by an env check / file-existence test.

14. **MEDIUM — Retraction Watch warnings are described as "surfaced twice" but the outline-approval-gate surface is not actually wired.** Codex flags: research flags `retracted` but outline approval gate warning is described, not implemented; verify says retracted → MIS-CITED but schema lacks a `retracted` field on the candidate. Wire both surfaces concretely; persist `retracted` + `retraction_details` through to verify.

15. **MEDIUM — Levenshtein sliding-window performance + token-vs-character.** Gemini (MEDIUM) + Codex (LOW). For full-extracted PDF (~50k+ chars) × N quotes × M-character window, naive O(N·M) is borderline. Codex additionally notes raw-character matching is weak for whitespace/punctuation. Suggested fixes: Ukkonen banding or anchor-then-distance heuristic; OR compare token-normalized strings/word windows for the quote tier.

16. **LOW — Dormant prompts (`pass1-fuzzy-judge.md`, `pass3-quote-checker.md`) risk silent drift.** Gemini calls this out; Codex's "static tests that fail if workflows/verify.md references dormant prompt slugs" is the symmetric concern. Suggested fix: comment in `bin/cli/verify.ts` linking to the dormant prompts; a static test asserting verify.md / verify.ts contain ZERO references to dormant prompt filenames; OPTIONAL Phase 5 hash-pin diff CI alert.

17. **LOW — Image-only / scanned PDFs not addressed in user-facing copy.** Gemini: `pdf-parse` returns empty for image-only PDFs; Pass 3 will produce `NOT_FOUND` without explanation. Document in `VERIFICATION.md` output the difference between "extraction failed" and "quote not in text".

18. **LOW — Wave 0 intentionally-red tests can break mainline CI unless gated.** Codex: existence assertions are "expected red" but if merged by wave, CI fails. Suggested fix: use `it.todo()` / `it.skip()` with a clear phase gate or branch-only convergence runner.

19. **LOW — `Other` discipline preset omission.** Codex: CONTEXT lists `Other` in INTK-03 disciplines but Plan 05 disciplines.json omits it. Either include `"other"` with explicit defaults or update INTK-03 to document the fallback.

### Divergent Views (worth investigating)

- **Overall risk rating spread (LOW vs MEDIUM vs HIGH):** Gemini says proceed-to-execution / LOW; OpenCode says MEDIUM (1 HIGH, 6 MEDIUM, 4 LOW); Codex says HIGH ("convergence loop will probably stall on contradictory tests and incomplete end-to-end behavior"). The disagreement is not on the existence of gaps — all three list overlapping concrete issues — but on whether the gaps are stop-ship or fix-during-execution. Codex's stricter posture is the more useful one for this convergence run, which is explicitly stricter-than-default.
- **Citekey collision severity:** Gemini ranks HIGH; Codex ranks MEDIUM. The disagreement reflects whether `citation-js` auto-generation is "stable enough most of the time" (Codex's framing) or "stable until the first same-author/year collision" (Gemini's framing). Both agree the fix is deterministic citekey generation; the dispute is about implementation urgency.
- **Tier-contract green semantics:** Codex says Plan 06's claim of green tier-contract is overclaimed because the CLI does not actually run end-to-end yet; Gemini accepts the Plan 06 framing. OpenCode is silent on this. Worth a planner clarification: is "tier-contract green" in Plan 06 meant to be (a) workflow body static invariants only, (b) cassette-backed mock-end-to-end, or (c) genuine CLI execution? The plans should pick exactly one and lock it.
- **`http-mock.ts` in production tree:** Codex says this is a dep-graph violation (nock is dev); the plans treat it as the resolution to Phase 2's codex-iter-1 concern. Both are correct; resolution is to pick "move nock to runtime + accept packaging cost" OR "dynamic-import-with-guard" — not leave the contradiction unresolved.
- **Levenshtein optimization urgency:** Gemini ranks MEDIUM (performance issue, optimize later); Codex ranks LOW (token-vs-char correctness, with performance as a side-effect). They are complaining about adjacent issues, not the same issue. Both should be addressed.

### Synthesized Action Items for Plan Convergence

Folding the agreed concerns into actionable plan-level edits:

1. **Fix D-09 migration** — rewrite Plan 03 Task 3.2 to read embedded section state, write it to PLAN.md frontmatter atomically before slimming STATE.json. Add crash-mid-migration tests.
2. **Add `PDF_UNAVAILABLE` / `TEXT_UNAVAILABLE` / `UNVERIFIABLE` verdicts** to the verify pipeline (Plan 06 + Plan 07 + Plan 09); update D-08 status enum if needed; add cassettes for each failure mode.
3. **Reconcile D-17 HANDOFF schema** with Plan 03/08; restore the locked schema or revise D-17 explicitly.
4. **Reconcile D-14 SourceCandidate schema** with Plan 03; add `id`, `last_verified`, `retracted`, `raw` fields; wire `retracted` through evaluator → outline approval gate → verify.
5. **Add deterministic citekey generation** to `bin/lib/citekey.ts` with collision suffixing; persist in `SourceCandidate`, LIBRARY.json, BibTeX, DRAFT.md tokens.
6. **Add explicit Pass 1 field-presence criteria** to workflows/verify.md (title non-empty, author[0].family non-empty, type=journal-article OR equivalent, retracted-flag handling, multi-DOI redirect handling).
7. **Implement quote-extractor + ≥10-word minimum gate** in `bin/lib/quote-extractor.ts`; cover block quotes, multi-paragraph, nested, scare-quote-filter, citation-token strip.
8. **Reconcile prompt hash-pin sequencing** across Plans 00/05/07/09 — pick "pin in Plan 05" OR "PENDING gate with env var until Plan 09" and lock.
9. **Split Plan 07 OR redefine "tier-contract green"** in Plans 06/09 to draw a clear line between workflow-body static invariants and real end-to-end behavior.
10. **Fix cassette-refresh cron**: implement `recordCassettes()` in `http-mock.ts`; add header scrubbing; add `tests/cassette-no-leak.test.ts`; set explicit `permissions:` block; document branch-protection bypass.
11. **Add `firstAuthorSurname()` normalization** with particle/initial/comma handling; test across Crossref/OpenAlex/S2/arXiv author forms.
12. **Lock slug vs directory-basename convention** in PlanFrontmatter and `depends_on`; add tests.
13. **Resolve `http-mock.ts` + `nock` dep-graph violation** — move `nock` to runtime deps OR dynamic-import-with-guard.
14. **Optimize `levenshteinSubstring`** with Ukkonen banding or anchor-then-distance; OR switch quote-pass to token-normalized comparison with word windows.
15. **Add static tests** that fail if `workflows/verify.md` or `bin/cli/verify.ts` reference dormant prompt slugs (`pass1-fuzzy-judge`, `pass3-quote-checker`).
16. **Document image-only PDF + paywalled URL** behavior in VERIFICATION.md output and README known-issues.
17. **Add Wave-0 red-test gate** — explicit `it.todo()`/`it.skip()` with phase guards so mainline CI does not fail on the wave.
18. **Add `Other` discipline preset** to `templates/disciplines.json` with explicit defaults; OR explicitly document the fallback path in INTK-03 tests.

---

## Next Steps

- To incorporate into planning: `/gsd-plan-phase 3 --reviews`
- To re-review after convergence: `/gsd-review --phase 3 --all`
