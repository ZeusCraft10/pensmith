# Phase 19 — stream `research` SUMMARY

Branch `v1/p19-research` (from the plan commit `2e584b7`). Commits, in order:

1. `chore(18): apply seam S-A` — byte-identical to Phase 18's seam.
2. `chore(19): apply seam S-B`.
3. `feat(19-research): …` — the research pass on the prompt layout, with the adapter plan, tiers, the `[sources]` policy and the evaluator.
4. `test(19-research): …` — tests, docs and the PRD.
5. `fix(19-research): …` — the LIBRARY.json count line (see "Found during verification"), and this summary.

## Requirements closed (stream scope)

| Req | What shipped | Evidence |
|---|---|---|
| SRC-07 | Every adapter's outcome is reported per adapter and per query, on stdout (the §3.5 table) and in RESEARCH.md (`## Adapters`, `## Per query`). The reasons are `failed (<reason with hint>)`, `offline: no recorded fixture`, `skipped (not configured)`, `skipped (not in allowed_databases)` and `skipped (no adapter)`. A failed adapter never reads as "no results". The keep-all fallback is gone: when the evaluator rejects every candidate, the run ends with `no relevant sources` plus guidance and exit 1, LIBRARY.json is left byte-identical, and the log is still written. When nothing usable is left (none found, all excluded by policy, none kept), the run exits 1 and says why. | `tests/research-verb.test.ts`, `tests/research-discovery.test.ts`, `tests/research-prune-gate.test.ts`; user path (e) below |
| SRC-08 | The run is seeded from `readIntakeBrief` (S-A). The disambiguator is called through `buildPromptRequest`. `{ambiguous, scopes[1..3]}` feeds the `research-scope` gate: a TTY select, `--scope <n\|text>` (a bad value is EXIT_USAGE and lists the scopes), and `--yolo`, which takes scope 1 and says so. Queries are clamped to 5–10, a short scope is padded from `query-expansion.ts`, and `--queries <n>` caps the count (5–10, else EXIT_USAGE). A run that cannot answer the gates is refused up front with exit 3, before any model request or write. `PENSMITH_NO_LLM` / `--dry-run` use the deterministic expansion and disclose it on stdout and in RESEARCH.md. | `tests/research-verb.test.ts`, `tests/research-scope-cli.test.ts`, `tests/query-expansion.test.ts` (fast-check); user path (a)–(d), (f) |
| SRC-09 | Tiers are deterministic where the metadata decides them (`source-tier.ts`); otherwise the evaluator's tier is used. The two-phase `[sources]` policy (`source-policy.ts`) lists each exclusion with its rule. The evaluator payload follows D-19-16: every candidate is sent once, at most 150 per call. `applySourceEvaluations` is exported and pure. When the evaluator fails or omits a candidate, that candidate is marked "not evaluated" and kept, with a disclosure. The prune gate preselects the kept sources and lists the rejected ones unselected, each with its reason, tier, year and an abstract excerpt. `upsertSources` persists type, tier, relevance, why_relevant (the evaluator's reason) and retraction_status. RESEARCH.md follows the §3.4 layout, built around `renderSourcesBlock`. | `tests/research-verb.test.ts`, `tests/source-tier.test.ts`, `tests/source-policy.test.ts`, `tests/research-prune-gate.test.ts`, `tests/prompt-research-contracts.test.ts` |
| SRC-10 | `adapter-plan.ts` orders the adapters: the preset's preference first (mapped: `nber` = Crossref with `doiPrefix` 10.3386; JSTOR → OpenAlex + Crossref; PsycNET → PubMed + OpenAlex; PhilPapers → OpenAlex; `books`), then the rest of the default five. `allowed_databases` means exactly the databases listed. `zotero` is added when configured. `fromYear` comes from `min_year`. Results rank by relevance, and ties go to the preference rank. `SOURCE_DATABASES` gains `books` and `nber`. | `tests/adapter-plan.test.ts` (unit + MockAgent: computer-science order arXiv → S2 → OpenAlex; `["openalex"]` → OpenAlex requests only), `tests/research-verb.test.ts` (policy + NBER prefix) |
| GRND-17 | `section-research.ts` is shared by `plan N --research` and `revise N --research`. It has an up-front `plan-research` refusal (exit 3, nothing touched) and PII redaction, and it runs the same pass: plan, tiers, policy and evaluator. Works the library already holds are marked "already in library as <key>". The retraction check runs before `upsertSources` (`plan-research:§N`). Only section N's PLAN.md `assigned_sources` changes, under its lock. The run appends to `sections/<NN>-<slug>/RESEARCH-LOG.md` and calls `refreshResearchSources`. Zero hits → the per-adapter reasons and exit 1. `applyResearch` and the `researchAdapter` default are deleted. | `tests/section-research.test.ts` (§1/§3 sha256 + mtime unchanged, RESEARCH.md prior content kept), `tests/gates-plan-research.test.ts`, `tests/plan-research-verb.test.ts` (built CLI on recorded cassettes, and `revise --research`) |

The estimator's research row now reflects the real call pattern: one disambiguator call plus ⌈candidates / 150⌉ evaluator calls, where candidates = ⌈queries × adapters × 10 / 2⌉. Covered by `tests/estimator.test.ts`.

## Files

New: `bin/lib/query-expansion.ts`, `bin/lib/source-tier.ts`, `bin/lib/source-policy.ts`, `bin/lib/adapter-plan.ts`, `bin/lib/section-research.ts`.

Rewritten: `bin/cli/research.ts`, `bin/lib/research-orchestrator.ts`, `templates/prompts/topic-disambiguator.md`, `templates/prompts/source-evaluator.md`. Both templates were re-pinned in `EXPECTED_PROMPT_HASHES` and in `PENDING_HASH_PINS`: `34587e4f…1378` and `b10cd384…eed4`.

Edited (owned regions only):
- `bin/cli/plan.ts`: the `--research` branch, which now runs before `assertLlmConfigured`; with `--revise` as well, research runs first.
- `bin/cli/revise.ts`: the `--research` branch.
- `bin/lib/revise.ts`: the research branch is deleted.
- `bin/lib/llm-contracts.ts`: the two schemas and their coercers.
- `bin/lib/llm-stubs.ts`: the two stubs.
- `bin/lib/llm-models.ts`: the two slug rows.
- `bin/lib/estimator.ts`: the research row.
- `bin/lib/schemas/config.ts`: `SOURCE_DATABASES`.
- `workflows/research.md`: everything except net's Zotero lines, which are kept verbatim.
- `workflows/plan.md`: the `--research` paragraph, plus a new "Research body" section.
- `PRD.md`: §7.2, the §7.5 `--research` sentence, and §10 `[sources]` (with its intro line: "except where a comment marks the value as an example").

## Tests

Added:
- `tests/query-expansion.test.ts`: property tests (deterministic, 5–10 queries, ≤ 8 words, non-empty, no duplicates, idempotent normalization) and fixed cases.
- `tests/source-tier.test.ts`
- `tests/source-policy.test.ts`
- `tests/adapter-plan.test.ts`: unit tests, plus MockAgent tests for SRC-10.
- `tests/prompt-research-contracts.test.ts`: each template's example parses through its schema; layout rules; both hash maps.
- `tests/research-verb.test.ts`: 16 cases. The real verb runs in-process against the mock LLM and the registry seam.
- `tests/research-prune-gate.test.ts`: numbered-answer mode.
- `tests/research-scope-cli.test.ts`: the real CLI through tsx against the mock.
- `tests/section-research.test.ts`
- `tests/gates-plan-research.test.ts`
- `tests/plan-research-verb.test.ts`: the built CLI on recorded cassettes, and a `revise` driver.

Updated because they encoded superseded behaviour (D-19-29):
- `tests/research-discovery.test.ts`: rewritten for the new orchestrator API and log format (§3.4). The keep-all fallback cases are gone; `no relevant sources` is covered in `research-verb`.
- `tests/revise-swap.test.ts`: the `researchAdapter` injection test is replaced by an assertion that `--research` routes to `section-research` (`applyResearch` is deleted per D-19-18). Unused imports were removed.
- `tests/llm-contracts.test.ts`: a bare-array evaluator reply must now carry `relevance` and `tier` (the extended contract). A reply without them is a schema miss.
- `tests/gates-registry.test.ts` (outside the owned test globs):
  - The research-prune test seeds a brief whose topic is the recorded one and asserts the kept count.
  - The scope test's `--yolo` half now expects the D-19-27 exit 1 `no sources found`, the `--yolo: using scope 1` announcement and an unchanged LIBRARY.
- `tests/llm-transport.test.ts` T-11-06 (outside the owned globs): the research case seeds `RESEARCH_BRIEF`. Research now refuses without an INTAKE.md (D-19-03: it is seeded from the brief).
- `tests/tier-contract.test.ts` (outside the owned globs): the research cases seed the brief (`seedResearchBrief`), for the same reason. No normalizer was added and no assertion was loosened.
- `tests/estimator.test.ts`: a new case for the research row.

## Deviations (with D-ids)

- **D-19-16, prune-gate "add":** the option to add a DOI, arXiv id or URL at the `research-prune` question is not wired here. The plan (§7, research ← library) assigns it to the integration pass, because it goes through `add`'s identification. The gate currently offers keep/prune over the found candidates.
- **D-19-16, `peer_reviewed_only`:** the rule runs in two phases. Before the evaluator it excludes a candidate whose deterministic tier is known and not peer-reviewed. After the evaluator it excludes anything whose final tier is not peer-reviewed, including an unknown tier. This way a candidate whose tier only the evaluator can decide is not dropped unseen.
- **D-19-15, scope matching:** `--scope <text>` accepts an index, an exact label, or a substring unique across labels and descriptions. An ambiguous substring is a usage error that lists the scopes, like a value that matches nothing.
- **D-19-18, the query:** with PII redaction on, the query is redacted with the existing `redactPii` before any search or model request. The RESEARCH-LOG.md entry records the redacted queries and marks them `(PII-redacted)`.
- **§3.5, the LIBRARY count line:** the line now separates works new to the library, works it already had, and within-run duplicates (see below). The plan's sample shows only `N new, K already in library`.

## Found during verification

- **The LIBRARY count line claimed sources were "already in library" on a fresh library.** `research.ts` (inherited from the base) and `section-research.ts` counted every non-`added` upsert outcome as already in the library. That included a candidate that merged into a sibling candidate of the same run (a preprint and its version of record, or two records of one work). The fix is `upsertCounts()` in the orchestrator: new = the `added` keys; already in library = the distinct non-added keys this write did not add; the rest are duplicates merged within the run. It is covered in `research-verb` by a unit case and an end-to-end case (a prior entry, plus a preprint/VOR pair).
- **Router sentinel (integration hand-off, not fixed: `router.ts` / `global-library.ts` are not stream-owned).** `resolveNextAction` and `deriveLibraryStatus` treat research as done when `.paper/LIBRARY.json` **or** `.paper/RESEARCH.md` exists (audit M1). D-19-16 has a failed research run (`no relevant sources`, all excluded, none kept) write the RESEARCH.md log while leaving LIBRARY.json untouched. On a paper with no library, a bare `pensmith` / `next` after such a run therefore routes to `outline`, which then runs with zero candidates. The base reached the same degenerate state by another path: it always wrote an empty LIBRARY.json. Suggested fix: count research as done when LIBRARY.json exists, or when RESEARCH.md exists without a failed `Result:` line (`no relevant sources` / `no usable sources` / `no sources found` / `no sources kept`). An equivalent fix is to treat an empty LIBRARY.json as not done. `tests/research-sentinel.test.ts` would gain the case.

## Integration hand-offs (19-PLAN §7)

- **research ← library:**
  - BYO ingest before discovery.
  - LIBRARY BYO entries without an evaluation join the tier/evaluator pass.
  - The prune gate's "add a source (DOI, arXiv id or URL)" input goes through `add`'s identification and `upsertSources` before the list is written.
- **research ← net:**
  - The adapter plan names the Zotero registry key `zotero` (net renames it from `zotero-mcp`) and passes no collection. The `zotero` entry must reach net's client with `[sources] zotero_collection`.
  - Until net merges, a configured Zotero reads `skipped (no adapter)` on this branch.
  - net's Zotero bullet in `workflows/research.md` still says "Retraction-Watch cross-check (Step 5)". That step is now step 10, so fix the reference when merging.
- **research ← adapters:**
  - The `books` registry key comes from the adapters stream. Until then the plan reports `books: skipped (no adapter)` for History, Literature and Philosophy.
  - `crossCheckRetractions` statuses (`retracted` / `unknown`) come from the adapters stream's retraction work. On this branch it does one Crossref lookup per DOI, which is slow on a live 300-candidate run.
  - The last test in `tests/research-discovery.test.ts` exercises the base OpenAlex adapter's `onFailure` reasons. The adapters stream may change the reason text.
- **`status --config` (CONF-02):** `config.ts` DEFAULTS lacks the other `[sources]` defaults that `source-policy.ts` `DEFAULT_SOURCE_POLICY` applies. `status --config` shows only what config.ts knows.
- **RUN-21 mock LLM artifact:** `scripts/mock-llm.mjs` `hintsFrom` extracts citekeys from the system prompt's JSON example (`vaswani2017`, `smith1998`, `tay2020`). Its default evaluator reply therefore carries verdicts for unknown citekeys, which research reports as `unknown citekeys`. Phase 18 rewrites the mock on the new layout (`parsePromptBlocks` of the last user message). Fixture-lane tests should script the evaluator reply.
- **Phase 23 (PLUG-07):** `TopicDisambiguatorSchema`, `SourceEvaluatorSchema` and the pure `applySourceEvaluations(candidates, verdicts, tierHints)` are exported.

## Merge notes for Phase 18

- **`bin/cli/research.ts`, `bin/lib/research-orchestrator.ts`:** take Phase 19's versions. Both already build their requests with S-A `buildPromptRequest`, and both read the brief with `readIntakeBrief`. After merging, confirm that Phase 18's `research --yolo --show-prompts` topic check passes.
- **`templates/prompts/topic-disambiguator.md`, `source-evaluator.md`:**
  - Take Phase 19's text and re-pin `EXPECTED_PROMPT_HASHES` and `PENDING_HASH_PINS`.
  - Phase 18's `tests/prompt-layout.test.ts` must pass on them.
  - `tests/prompt-research-contracts.test.ts` checks the same rules for these two slugs (an `inputs:` frontmatter of `PROMPT_INPUTS` tags, `## Inputs` naming each tag, the verbatim fence paragraph, and a JSON example that parses through the schema). It reads the pins as text.
- **`bin/lib/llm-contracts.ts`, `llm-stubs.ts`:** take Phase 19's two entries (their schemas, coercers and stubs). The stubs read `requestHints(req)` (`topic`, `discipline`, `assignment`, `candidates`). Keep Phase 18's framework and the other slugs.
- **`bin/cli/plan.ts`:**
  - The `--research` branch now runs **before** `assertLlmConfigured` and returns before the normal path. `runSectionResearch` checks the LLM itself, with the verb name.
  - When re-applying onto Phase 18's rewritten `plan.ts`, keep that order: research, then `--revise`, then the normal path.
- **`bin/lib/section-research.ts`:**
  - It finds section N's folder through `paths.ts` `sectionPlan(root, n, slug)`, with the slug taken from OUTLINE.md, and expects `NN-<slug>` folders.
  - Adapt it to Phase 18's section identity: `1a` ids, slug-found folders, and a stub PLAN.md. `assigned_sources` stays the planner's allowed set (D-18-23).
  - It refuses a section without a PLAN.md. If Phase 18 always writes a stub PLAN.md from the outline, that refusal only fires for an out-of-range N.
- **`bin/lib/estimator.ts`:** only the research row changed (`researchCalls`), which is separate from Phase 18's section-ordering region.
- **`workflows/research.md`:** merge by paragraph. Phase 18 describes the template/data split. Phase 19 rewrote the steps, keeping net's Zotero lines.
- **`PRD.md` §7.2, §10:** merge by paragraph. Phase 19 owns the research bullets of §7.2 and `[sources]` of §10. Phase 18 owns the intake bullets of §7.2 and `[project]`.
- **Brief seeding in tests:** research and `plan --research` now require an INTAKE.md. `tier-contract` and `llm-transport` T-11-06 seed one through S-A `renderIntakeDocument`. If Phase 18 changes the brief format, those seeds follow the seam and need no edit.

## Verification

See the final hand-off record for the commands and results. The user-path checks (built CLI, RUN-21 mock as the model, scratch papers under `scratchpad/p19/research/ua/`, with `XDG_DATA_HOME` inside, and `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org` for live runs):

- (a) An ambiguous topic, non-TTY, without `--yolo` or `--scope` → exit 3, 0 captured model requests, nothing written.
- (b) Live `research --scope 2 --yolo --show-prompts` → scope 2's queries mirrored, the live adapter table (keyless Semantic Scholar 429s reported as `ok; failed (HTTP 429 after retries) for 5 of 6 queries`), and LIBRARY.json written.
- (c) A 12-query scope → 10 queries issued.
- (d) A 3-query scope → padded to 5.
- (e) A reject-all evaluator → exit 1 `no relevant sources`; the sha256 of LIBRARY.json and CITATIONS.bib is unchanged; RESEARCH.md is written, listing the rejections.
- (f) Live `PENSMITH_NO_LLM=1 research --yolo` for a psychology brief ("social media use and adolescent depression"):
  - The disclosed 10-query deterministic expansion, printed on stdout and in RESEARCH.md.
  - The live per-adapter table, with keyless Semantic Scholar 429s reported: `ok; failed (HTTP 429 after retries) for 8 of 10 queries`.
  - LIBRARY.json holds 211 entries. 168 of them have a topic term in the title, and none is a fixture paper.
  - Count line: `211 new, 1 duplicate(s) merged`, after the fix above.
  - Tiers read `other` for most entries. The base adapters do not yet fill `type` / `venue`, so the deterministic tier is unknown and the stub evaluator's fallback tier is used. The adapters stream fills those fields.
