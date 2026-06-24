---
gsd_state_version: 1.0
milestone: v0.2.0
milestone_name: End-to-End
status: planning
stopped_at: Completed 15-08-PLAN.md (SECURITY.md audit + Semaphore bare-caller doc, Phase 15 Wave 4 complete)
last_updated: "2026-06-24T00:00:00.000Z"
last_activity: 2026-06-22 — v0.2.0 roadmap created (Phases 11–16, 25 requirements)
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 22
  completed_plans: 22
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22 after v0.1.0 Foundation milestone)

**Core value:** Every citation in every exported paper is real and supports the claim it's attached to — verified by re-fetching the live DOI/quote. The verifier blocks compile and export; no FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes.
**Current focus:** Planning v0.2.0 — make pensmith end-to-end usable (Tier-2 LLM transport, live research discovery, citation-at-export, fail-closed gate/security hardening; from the 2026-06-22 improvement review)

## Current Position

Phase: Not started (roadmap created, planning Phase 11)
Plan: —
Status: Planning
Last activity: 2026-06-22 — v0.2.0 roadmap created (Phases 11–16, 25 requirements)

## Performance Metrics

**Velocity:**

- Total plans completed: 10
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 0 (00-01) | 1 | ~12 min | ~12 min |
| Phase 0 (00-02) | 1 | ~4 min | ~4 min |
| Phase 0 (00-03) | 1 | ~3 min | ~3 min |
| Phase 0 (00-04) | 1 | ~2 min | ~2 min |
| 3 | 10 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 04 P01 | 10min | 3 tasks | 10 files |
| Phase 04 P02 | 38min | 3 tasks | 12 files |
| Phase 04 P03 | 22min | 3 tasks | 6 files |
| Phase 04 P04 | 13min | 3 tasks | 12 files |
| Phase 04 P05 | 21min | 4 tasks | 24 files |
| Phase 05 P01 | 8min | 2 tasks | 9 files |
| Phase 05 P02 | 4min | 2 tasks tasks | 1 file files |
| Phase 05 P03 | 5min | 2 tasks | 1 file |
| Phase 05 P04 | 4min | 2 tasks | 2 files |
| Phase 05 P05 | 3min | 2 tasks | 1 files |
| Phase 06 P01 | 11min | 3 tasks | 18 files |
| Phase 06 P02 | 4min | 2 tasks | 1 files |
| Phase 06 P03 | 4min | 2 tasks | 1 files |
| Phase 06 P04 | 8min | 2 tasks | 2 files |
| Phase 06 P05 | 20min | 3 tasks | 7 files |
| Phase 07 P01 | 28min | 3 tasks | 9 files |
| Phase 07 P02 | 35min | 4 tasks | 8 files |
| Phase 07 P03 | 10min | 3 tasks | 6 files |
| Phase 07 P04 | 12min | 2 tasks | 6 files |
| Phase 08 P00 | 35min | 3 tasks | 9 files |
| Phase 08 P01 | 22min | 2 tasks | 7 files |
| Phase 08 P03 | 12min | 2 tasks | 3 files |
| Phase 08 P02 | 4min | 2 tasks | 2 files |
| Phase 08 P04 | 55 | 2 tasks | 7 files |
| Phase 08 P05 | 30min | 3 tasks | 4 files |
| Phase 08 P06 | 18 | 2 tasks | 5 files |
| Phase 09 P00 | 11min | 3 tasks | 18 files |
| Phase 09 P01 | 14 | 2 tasks | 2 files |
| Phase 09 P02 | 18 | 2 tasks | 4 files |
| Phase 09 P03 | 42min | 3 tasks | 16 files |
| Phase 10 P00 | 9min | 3 tasks | 11 files |
| Phase 10 P01 | 6min | 2 tasks | 2 files |
| Phase 10 P02 | 3 | 2 tasks | 4 files |
| Phase 10 P03 | 6min | 3 tasks | 6 files |
| Phase 10 P04 | 5min | 3 tasks | 5 files |
| Phase 11-tier-2-llm-transport P04 | 90min | 2 tasks | 5 files |
| Phase 12-live-research-intake-bootstrap-humanizer-task P01 | 18min | 3 tasks | 3 files |
| Phase 12-live-research-intake-bootstrap-humanizer-task P03 | 5min | 1 task | 1 file |
| Phase 12 P04 | 10m | 1 tasks | 1 files |
| Phase 13-citation-rendering-at-export P01 | 8m | 3 tasks | 1 files |
| Phase 13-citation-rendering-at-export P02 | 18m | 3 tasks | 4 files |
| Phase 14-fail-closed-verifier-gate P01 | 25min | 2 tasks | 5 files |
| Phase 15-foundation-security-hardening P08 | 15min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- Section-as-phase as load-bearing model — directory contract (`.paper/sections/<NN-slug>/`) enforces state isolation
- Two-tier source-of-truth — workflow bodies + templates shared between Tier 1 plugin and Tier 2 CLI
- `tier-contract.test.js` is a Phase 2 hard merge gate (not a wrap-up task)
- Verifier Pass 1 (DOI integrity + author/title fuzzy match) and Pass 3 (OA quote verification) are deterministic and blocking; Pass 2 + Pass 4 are LLM-judged and advisory
- Zero pensmith trace in exports — verified by zero-trace test in Phase 6
- OneDrive/iCloud/Dropbox/Google Drive detection ships in Phase 2 doctor (dev folder is in OneDrive)
- CSL via citeproc-js + bundled CSL files resolves PRD §17 citation-style open question
- [00-01] scripts.test = node scripts/run-tests.mjs (not shell glob) — Windows cmd.exe glob-expansion landmine avoided per D-10
- [00-01] No eslint-plugin-import at Phase 0 — D-06 satisfied by built-in no-restricted-imports + per-file override
- [00-01] tsconfig.exclude includes tests/fixtures/**/* — Plan 02 red-team fixture excluded from typecheck from day one
- [00-02] ESLint flat-config global ignores cannot be overridden by later files entries — integration tests that re-lint ignored files must filter out global-ignores entries from loaded project config
- [00-02] AST selector for D-07 DOI chokepoint: Literal[regex.pattern=/^\^10\\\\\\./] — 4-level escape depth (Pitfall B verified by negative test)
- [00-03] MCP server declared in BOTH plugin.json.mcpServers AND .mcp.json (Assumption A3 — redundant dual-declaration per D-18 + RESEARCH A3)
- [00-03] Structural assertions used for manifest validation (no JSON-Schema) — Anthropic publishes no stable JSON-Schema artifact; structural approach matches gsd-plugin's bin/validate-plugin.cjs (D-17 revised cycle 2)
- [00-03] eslint.config.js requires scripts/**/*.cjs override for @typescript-eslint/no-require-imports — .cjs files in ESM packages intentionally use require(); tseslint.configs.recommended flags this without the override
- [00-04] npm run build placed BEFORE npm test in CI step order — Pitfall D: manifest validator checks dist/mcp/server.js exists when dist/ exists; building first ensures clean path resolution
- [00-04] Pitfall C arm64 assertion step added to macos-latest — test "$RUNNER_ARCH" = "ARM64" explicitly fails CI if GitHub demotes runner to Intel without notice
- [00-04] fail-fast: false locked in — all 3 OSes report independently; macOS failure does not hide Windows failures
- [01-12] D-60 carve-out from D-39 — append-only audit log (CHECKPOINTS.jsonl) reads via CheckpointSchema.safeParse and SKIPS bad/forward-versioned lines with one WARN per call; this is the SOLE Phase-1 exception to refuse-forward-incompat, justified by the append-only semantic (skipping never causes data loss)
- [01-12] Plan vs Schema reconciliation (user ruling) — Plan said `refs: Record<string, unknown>`; W7 schema (locked) is `z.record(z.string(), z.string())`. Public API honors the schema (refs?: Record<string, string>); test 4 adapted to use string values; foundation-slice carry-forward note softened to allow future broadening via versioned migration
- [01-12] Concurrency budget — W3 default exponential-backoff retry schedule (factor=1.5, retries=16) cannot accommodate 20+ concurrent contenders on Windows + OneDrive within the default 60s timeoutMs; checkpoint test 6 lowered to N=10 to match W11 sibling and stay within retry budget
- [01-13] pricing.ts is a separate file from runtime.ts — pure constant table + pure function with NO imports/IO; runtime.ts is the W2+W3+W7+W9 config-loader chokepoint. Different semantic surfaces → different files; W6 budget.ts imports estimateCost from pricing.ts without pulling in the chokepoint stack
- [01-13] T-01-07 no-leak property — resolved api-key VALUES never reach disk (W7 schema persists env-var NAMES only) AND never reach the session log (`present:boolean` pre-computed before log call so the resolved string never enters the payload object). Test 8 in tests/runtime.test.ts is the load-bearing assertion
- [01-13] ENOENT → defaults() (NOT NotFoundError) — runtime config is OPTIONAL; missing runtime.json operates with schema defaults. First W10/W11 sibling that does NOT translate ENOENT to a typed error class (state/library/checkpoint all throw NotFoundError on ENOENT; runtime returns defaults)
- [01-13] defaults() seeds an anthropic provider entry — W7 RuntimeConfigSchema's providers has a .refine requiring ≥1 provider, so `RuntimeConfigSchema.parse({})` would fail without seed. anthropic with apiKeyEnv='ANTHROPIC_API_KEY' is the production-typical first provider; callers overwrite via saveRuntimeConfig
- [01-13] Test fixtures adapted per Plan-vs-Schema reconciliation — W7 ProviderSchema requires `name: z.enum(['anthropic','openai'])` in addition to `apiKeyEnv`; test fixtures here include the `name` field. Same reconciliation pattern as 01-12 (refs typing)
- [01-13] gpt-5 set equal to gpt-4o per RESEARCH §pricing-pending — placeholder so budget assertions don't accidentally rely on a divergent value while the official rate is still unannounced. When OpenAI publishes the rate, bump the entry and reference the vendor page in the commit message
- [02-00] parseRetryAfter is a pure export in retry.ts (not inlined in http.ts) — matches fullJitterDelayMs shape; independently unit-testable per D-01
- [02-00] serverRetryDelay closure inside wrapped fn — cleanest Retry-After pattern given retry() fixed-base signature; maxAttempts/baseMs/capMs unchanged (T-02-00-02 preserved)
- [02-00] SHA-256 hash-pin (not substring match) for doctor-output.md — substring match silently allows inserted lines or rewritten copy outside matched fragments (D-18)
- [02-00] DOCT-05/wiring-smoke absent from doctor-output.md — Phase 3 deferral enforced by anti-drift assertion in repo-files.test.ts (D-04)
- [02-01] tseslint.configs.recommended required in inline ESLint test config when fixture uses TypeScript-specific syntax (declare const) — precedent for future chokepoint test inline configs
- [02-01] tests/lint-thin-shim.test.ts exempted from no-restricted-syntax (D-07 writeFile selector) — test-only fsp.writeFile to create mcp/-pathed tmp file; deliberate and documented
- [02-01] D-09 handler statement-count budget enforced by AST walk in Test 3, not by ESLint selector — no-restricted-syntax cannot count statement-body length in a single selector
- [02-02] D-10 mcp/** file-scoped block re-lists all D-07/D-41 project-wide selectors — ESLint 9 flat-config file-scoped blocks OVERRIDE (not merge) project-wide rule; without re-listing, DOI regex in mcp/server.ts would escape the chokepoint
- [02-02] https selector included in D-10 alongside net/http/tls — plan listed 5 selectors including https.createServer; all 5 covered in fixture and eslint.config.js
- [02-03] D-12 mcp/** block re-lists D-07/D-41/D-10 selectors — ESLint 9 flat-config last-match semantics: the D-12 block (third mcp/** no-restricted-syntax block) REPLACES D-10 block without re-listing; same override-merge safety pattern as 02-02
- [02-03] D-12 doctor-probe scope uses files+ignores combination — ESLint flat-config ignores inside a config object excludes specific files from matching; allows computed-env selector on all probes except the authorized runtime-config-presence.ts
- [02-03] TypeScript as const on rules array incompatible with ESLint RuleConfig mutable type — inline rules in overrideConfig instead (matches 02-01/02-02 sibling pattern)
- [02-04] SDK v1.29 wraps all handler errors (including zod McpError(InvalidParams)) in {isError:true, content:[...]} body — TIER-06 tests assert res.isError===true instead of assert.rejects; this is correct per SDK mcp.js catch block behavior
- [02-04] loadCapabilityFacts() in bin/lib/capabilities.ts is the single authorised composition site for runtime config + env presence flags; both mcp/resources.ts and mcp/tools.ts are zero-composition thin shims (D-12 architectural fix from cross-AI review)
- [02-04] sections[] added as optional field to StateSchema v1 (not via migration) — additive-only change; mutation helpers default to prev.sections ?? [] so existing STATE.json files are backward-compatible
- [02-04] verifyDoi() added to bin/lib/doi.ts (Rule 3 auto-fix) — Phase 1 doi.ts only had normalization; Phase 2 paper_doi_verify tool requires Crossref re-fetch; doi.ts exemption covers http import
- [02-05] bin.pensmith locked to dist/bin/pensmith.js (D-24 LOCKED path) in package.json — exact path required by 02-07 preflight and CONTRIBUTING.md
- [02-05] http-crossref-ping probe is SKIP-only in Phase 2 (cross-AI review HIGH fix from Codex iter 1) — production code must not import from tests/; Phase 3 ships bin/lib/http-mock.ts production-tree chokepoint to re-enable PASS/FAIL
- [02-05] DOCT-07 runtime-config-presence delegates entirely to loadCapabilityFacts() (cross-AI cycle-2 HIGH #2) — single composition site shared with mcp/; probe only re-keys snake_case to camelCase for the doctor's historical detail shape
- [02-05] TIER-03 exit-code test uses [FAIL] pattern (not /FAIL/) to avoid matching the footer 'N FAIL' count in the TTY renderer
- [02-06] hooks/.gitkeep removed and replaced by 4 real hook stubs — Phase 0 placeholder retired; tests/repo-files.test.ts updated to assert hook files instead of .gitkeep
- [02-06] noUncheckedIndexedAccess requires blockMatch[1] ?? '' pattern in workflows-keyequal test — non-null assertion alone insufficient under exactOptionalPropertyTypes + noUncheckedIndexedAccess
- [02-06] All 4 hooks emit no stdout — hook-protocol stdout is the Claude Code hook channel; diagnostics go to stderr (T-02-06-02 mitigation)
- [02-06] W4 closed vocabulary enforced in both test (workflows-keyequal.test.ts) and validator (validate-plugin-manifest.cjs) — two independent gates at test + CI-script layers
- [02-07] test:tier-contract uses node --import tsx --test with explicit file args — run-tests.mjs always discovers all tests; explicit paths are Windows cmd.exe safe (D-10)
- [02-07] Case B Phase 2 key-set: undefined ecosystem fields are omitted by JSON.stringify so paper://capabilities only has 3 keys in Phase 2 (not 8); optional keys validated when present
- [02-07] Case D length comparison uses serialized fact-set JSON not raw full texts — doctor JSON (~3KB) vs capabilities JSON (~180B) is apples-to-oranges; fact-set text comparison enforces TIER-07 meaningfully
- [02-07] MCP server main-guard uses pathToFileURL for Windows compatibility — naive file://${argv[1]} never matches absolute import.meta.url when argv[1] is relative
- [02-07] Preflight resource count: listResources() (4 static) + listResourceTemplates() (1 section template) = 5 total per TIER-01
- [Phase ?]: [04-01] OUTLINE.md parse contract locked to workflows/outline.md GFM table; the .paper/OUTLINE.md self-build file is a Tier-2 placeholder, not canonical
- [Phase ?]: [04-01] buildWaveGraph (canonical computeWaves/COMP-06) stays pure by taking Map<slug,PlanFrontmatter> — caller owns PLAN.md reads; satisfies D-04/ARCH-20 read-only by construction
- [Phase ?]: [04-01] Wave-override floor = node Kahn computed_wave (=max(deps.computed_wave)+1); valid override promotes (PLAN-02), below-floor throws naming slug+floor (PLAN-03)
- [Phase ?]: [04-01] depends_on edge to a not-yet-planned section is treated as already-satisfied for the run — partial planning never deadlocks the scheduler
- [Phase ?]: [04-02] D-14 (CONTEXT.md) is the LOCKED COMPILE-REPORT schema source of truth; RESEARCH §F drifted — CompileReportSchema is .strict() and rejects outline_hash/pandoc_target (ARCH-07 refuse-forward-incompat)
- [Phase ?]: [04-02] RSCH-10 freshness wired as a SEPARATE pass1.ts function (runFreshnessForDraft), never mutating runPass1's blocking verdict path — WARN-only by construction (D-10 / PRD §14)
- [Phase ?]: [04-02] retraction-watch.ts confirmed a REAL cassette-backed adapter (fetchById), not a Phase-3 stub — freshness probe issues a genuine offline lookup (RESEARCH §J risk A3 resolved live)
- [Phase ?]: [04-02] freshness cassettes live under tests/fixtures/cassettes/<adapter>/ (not flat tests/cassettes/) so loadCassetteFile + cassette-size/no-leak gates cover them (Rule 3 blocking-issue fix)
- [Phase ?]: [04-02] freshness DOI HEAD SSRF mitigation (T-04-05) — normalizeDoi before any request, HEAD target hard-coded to https://doi.org/<normalized>; sectionDir 3rd arg overloaded for ARCH-20 letter-suffix tolerance with zero break to legacy 3-arg callers
- [Phase ?]: [04-03] runAllSections takes an injectable writeSection callback so the orchestrator stays pure/stateless (ARCH-20); the CLI supplies the real single-section path that runs assertDrafterInput per node (WRTE-04 not bypassed)
- [Phase ?]: [04-03] Re-run isolation via graph-scoping: an optional only[] allow-list keeps untouched sections out of the wave graph entirely (writer never invoked for them) — strongest form of section-as-phase isolation
- [Phase ?]: [04-03] write-wave tier-contract case is CLI-only (mcpTool: null) — MCP pensmith_write accepts only single-section n; both tiers exercised via CLI. D-24 obligation satisfied where workflows/write.md changed
- [Phase ?]: [04-04] revise is NOT a locked UX-02 verb — shipped via plan --revise + bin/cli/revise.ts both delegating to the single runRevise chokepoint (D-06); locked-16 and workflow-bijection invariants preserved
- [Phase ?]: [04-04] runRevise rejects any LLM replacement_citekey not in assigned_sources (strict zod + membership guard before mutation) — verifier-blocks-escape preserved through revise (T-04-14)
- [Phase ?]: [04-04] revise-swap.md hash-pinned (real SHA-256); WN-3 lockstep landed byte-pin in repo-files at Task 1, prompt-loader sentinel re-pinned at Task 3
- [Phase ?]: [04-05] runCompile refuse-gate collects ALL blocking verdicts across ALL sections before any write, then refuses without writing DRAFT.md — verifier-blocks-compile is structurally unbypassable (COMP-01)
- [Phase ?]: [04-05] compile tier-contract parity is CLI-only (no pensmith_compile MCP tool; Tier-1 surface is the workflow body delegating to the same runCompile) — documented asymmetry, locked UX-02 16 verbs preserved
- [Phase ?]: [04-05] smoother citation protection by construction (D-13): pre-call [@key]->{{cite_K_M}} mask + post-call placeholder-set equality; drift rejects the boundary keeping original prose (raw-concat fallback); compile never refuses on smoothing rejection (COMP-03)
- [Phase ?]: [05-01] Wave-0 RED behavioral tests are RED-by-skip (skip-guarded on existsSync of pass2.ts/pass4.ts) so the suite reports skips with ZERO failures — diverges from the known-bad-citations analog which hard-fails on a missing module
- [Phase ?]: [05-01] pass4-orphan.json orphan counts derived by mechanically walking pinned rule R1-R8 (R5 >=8-word floor applied BEFORE R6 marker counting); canonical Climate-change example = 1 (S2 lone HIGH orphan); cited-vs-uncited isolated via paired single-sentence entries to remove R2 proximity ambiguity
- [Phase ?]: [05-01] claim-support + orphan-label registered as __PENDING_HASH_ sentinels in EXPECTED_PROMPT_HASHES (WN-3) BEFORE pass modules exist so loadPrompt resolves the slugs; real SHA-256 byte-pins in repo-files from creation; verify.ts byte-unchanged and its whole-file loadPrompt==0 D-13 chokepoint pinned by a committed regression test
- [Phase ?]: [05-02] Pass 2 claim-support advisory module — runPass2 returns Pass2Result[] only, never touches hasFail/status (VRFY-07); assertBudget pre-call gate + getProviderApiKey no-leak resolution; UNCLEAR-bias preserved offline and on unparseable LLM responses
- [Phase ?]: [05-02] PASS2_SECTION_CAP_DEFAULT=0.50 USD/section (ARCH-10 per-step cap, config knob via opts.scopeCapUsd); model id from runtime config defaultModel falling back to claude-haiku-4
- [Phase ?]: [05-03] Pass 4 deterministic core implements PINNED rule R1-R8 verbatim (R5 8-word floor enforced BEFORE R6 marker counting); orphanCount is HIGH-only (R8) and byte-identical with or without the LLM — every pass4-orphan.json fixture incl. canonical Climate-change =1 passed on first run, no R1-R8 re-walk needed
- [Phase ?]: [05-03] Pass 4 Step-3 orphan-label LLM (AMBIGUOUS sentences only) gated behind assertBudget pre-call + PENSMITH_NO_LLM guard + getProviderApiKey no-leak; PASS4_SECTION_CAP_DEFAULT=0.50 (matches Pass-2); renderPass4Section is an integer-only orphan-count table (no LLM text in cells — injection surface removed); advisory by construction (no hasFail/status), VRFY-06 GREEN, full suite 649 pass / 0 skip
- [Phase ?]: [05-04] verify.ts wires runPass2/runPass4 strictly below the frozen hasFail/status block (freshness call-site mirror); advisory-only by construction (VRFY-07). D-13 held by import-and-call — the new imports carry no loadPrompt literal and Pass 2/4 load their prompts in their own modules, so the verify.ts whole-file loadPrompt count stays 0 (comments included), re-asserted by Guard B. Tier parity scoped to PENSMITH_NO_LLM=1: both tiers assert ## Pass-2 + ## Pass-4 + an UNCLEAR row; live verdict parity out of CI scope.
- [Phase ?]: [05-05] WN-3 atomic re-pin: claim-support + orphan-label sentinels replaced with real SHA-256 in prompt-loader.ts (matching repo-files pins from creation); loadPrompt succeeds without the pending bypass — Phase 5 advisory passes production-real
- [Phase ?]: [06-01] PDF zero-trace fixture hand-authored as raw bytes (not via pdf-lib) so it is a genuine negative control; 'Trace Sentinel' sentinel in BOTH /Info AND XMP forces structural XMP-object removal, defeating a literal-pensmith byte-sweep
- [Phase ?]: [06-01] Wave-0 RED behavioral tests are RED-by-skip (skip-guarded on existsSync of the unbuilt module), mirroring known-bad-pass2 — full suite stays GREEN (681 tests, 0 fail, 19 skip) until Waves 1-2 land exporter/plagiarism/honesty/done
- [Phase ?]: [06-01] honesty-framing.md is the LOCKED single-source transparency-only copy (improves prose, does not promise undetectable); byte-pinned GREEN-from-creation in repo-files.test.ts + CONTRIBUTING.md drift rule
- [Phase ?]: [06-02] PlagiarismResult.matches typed as string[] (URLs) to honor the LOCKED Wave-0 RED contract + DONE-09 gate input; PlagiarismMatch { url; title? } still exported (parseDdgHtml return) for Wave-2 done.ts richness; runPlagiarism maps .url into the string array
- [Phase ?]: [06-04] zeroTracePdf removes XMP STRUCTURALLY (context.delete(metaRef) before save) because pdf-lib serializes ALL indirect objects regardless of reachability; NO length-altering byte edits, residual-pensmith check is READ-ONLY
- [Phase ?]: [06-04] docx literal-pensmith sweep is binary-aware (skips media/embeddings/fonts + NUL sniff) so the LIVE Pandoc docx path's binary parts are never corrupted (MEDIUM-1); exports write to a DISTINCT .paper/export/ dir so outputs never collide with source artifacts
- [Phase ?]: [06-04] exporter.ts created in 06-04 but runHumanizer (DONE-03) added in 06-05; tightened humanizer-wrap.test.ts skip guard to require the runHumanizer export in source (not just file existence) so it stays RED-by-skip until 06-05
- [Phase ?]: [06-05] runDoneGate accepts the FLAT input shape { pass2Results, pass4Results, plagiarismResults, yolo, approve } (locked Wave-0 export-gate test) with collectGateIssues internal; runHumanizer lives in bin/lib/exporter.ts (locked humanizer-wrap test imports + greps it there). Rule-1 reconciliations honoring locked contracts (PlagiarismResult precedent)
- [Phase ?]: [06-05] readSectionUnsupported FAILS SAFE — present-but-unparseable ## Pass-2 table → synthetic <unparseable> UNSUPPORTED sentinel (NEVER a silent clean); absent heading / missing file = clean; I/O errors skipped. Pinned to renderPass2Section via module-level constants (PASS2_HEADING/PASS2_TABLE_HEADER/PASS2_EMPTY_MARKER/VALID_VERDICTS) so a future writer desync is caught
- [Phase ?]: [06-05] done.ts leaves exportDraft outputDir UNSET → exports land in the distinct .paper/export/ dir, source DRAFT.md never overwritten; honesty report null-guards a missing GPTZero key (skip banner, never a fabricated percent). done graduated from cli-stubs to a real REAL_VERB_LOADERS loader (compile precedent); DONE-09 gate always-confirms (generic confirm even when clean), only --yolo skips
- [Phase ?]: [07-01] Corrupt-PLAN.md RED fixture uses an alias to a missing YAML anchor (status: *missing_anchor) — yaml@^2 toJSON() tolerates duplicate keys without throwing, so the plan's duplicate-key example would make the C5/C6 RED gate vacuous; the alias fixture genuinely throws ReferenceError through parseFrontmatter
- [Phase ?]: [07-01] Hook/CLI subprocess tests pin tsx via import.meta.resolve('tsx') absolute file URL — a bare --import tsx resolves relative to the child's tmpdir cwd (no node_modules) and crashes ERR_MODULE_NOT_FOUND
- [Phase ?]: [07-01] Source-grep skip predicates (flagsWired/emissionWired/stopWired/timeoutWired) gate RED-by-skip for files that already exist as stubs — existsSync alone cannot detect not-yet-wired behavior
- [Phase ?]: [07-02] Pre-dispatch argv seam (not a citty root run()) applies global flags + yolo cap + bare routing BEFORE runMain so explicit verbs run exactly once (H2)
- [Phase ?]: [07-02] Shared dispatchVerb forwards global flags (>= yolo) into manually-dispatched verb args (C3-HIGH-2) inside an outer try/catch backstop so bare/next/resume never crash (C6-HIGH)
- [Phase ?]: [07-02] resolveNextAction is TOTAL + never-throws (catch-all loadState, sections nullish guard, guarded readSectionState, exhaustive switch, outer backstop); ignores HANDOFF so bare /pensmith never loops on resume (H4)
- [Phase ?]: [07-02] estimator uses module-constant default provider/model (anthropic/claude-sonnet-4) not runtime.ts — keeps projectEstimate pure/IO-light; catch-all loadState guard returns empty projection for paper-less AND corrupt STATE.json (C2-H1/C4-HIGH)
- [Phase ?]: [07-02] section-scoped router fallback is plan+verify only (write excluded — its n is optional for the write-all wave surface); --version/--help delegate to runMain
- [Phase ?]: [07-03] forceRelease(resource) added to lock.ts for cross-process orphan-lock cleanup; Stop runs allSettled([release, forceRelease, closeSessionLog]) so a rejecting release never abandons the session-log flush (M1/C2-M2); release keeps the rejection path real, forceRelease (unlock-then-rm) guarantees actual cross-process cleanup that proper-lockfile.unlock cannot do
- [Phase ?]: [07-03] Stop resolves .paper to an ABSOLUTE cwd path before release — resource locks are keyed by absolute-path hash (lock.ts stubFor), so release('.paper') literal would target a different stub than callers who lock join(cwd,'.paper')
- [Phase ?]: [07-03] closeSessionLog() awaits the EXISTING module-scope chain directly (no new activeChain ref) — chain is shared by every logger handle; enqueue() installs work as both fulfil+reject handlers so awaiting it never rejects; the plan's activeChain indirection was unnecessary
- [Phase ?]: [07-03] PreCompact 10s Promise.race timeout (PRECOMPACT_TIMEOUT_MS=10_000) with the deadline timer cleared in finally; applied OUTSIDE writeHandoff's lock ownership (writeHandoff stale:10_000 auto-clears a timed-out write); rejection routed to the existing stderr catch, never stdout (HOOK-01)
- [Phase ?]: [07-04] Skill frontmatter authored name-LAST with a single-line quoted description — satisfies BOTH 07-01 RED scanners: readDescription (/(?:^|\n)description:\s*(.+)/) captures the full §5.4 phrase line (a `|` block scalar would yield only `|`), AND the nl-trigger token scan (/pensmith[:\s]+([a-z][a-z-]*)/, where [\s] includes \n) never extracts a bogus `description` verb from a `name: pensmith`→`description:` adjacency. The PATTERNS.md block-scalar/name-first example fails both
- [Phase ?]: [07-04] plugin.json skills array shipped (A1/Open-Q2 resolved) — validate-plugin-manifest.cjs validates only name/version/author/mcpServers and structurally TOLERATES an extra skills[] of {name,file} colon-prefix entries; it passed clean, so the colon-prefix plumbing namespace ships in the manifest, not the CONTRIBUTING.md fallback
- [Phase ?]: [07-04] No 17th verb across THREE independent guards — 07-01 nl-triggers (length===16 + skill-targets⊆verbs), the 07-01 standing guard, and the new tier-contract case (no colon-prefix and no -section alias leaked into UX02_VERBS). The /pensmith:*-section plumbing namespace is a Tier-1-only alias onto the locked 16; redo/revise/swap-source/length-change corrections all ride plan --revise (04-04). 16-workflow bijection intact
- [Phase ?]: [08-00] RED-by-skip imports the unbuilt module via a runtime URL.href specifier (await import(MOD.href)) with a local type interface — keeps tsc --noEmit clean while the target module is absent (known-bad-pass2 precedent applied to all 7 Phase-8 suites)
- [Phase ?]: [08-00] deriveLibraryStatus test asserts the DERIVED on-disk value (sectioning {done:2,total:3}) NOT the stored entry.status — cycle-2 HIGH 'status stuck at intake' fix as a live Wave-0 assertion; archived from stored flag, intake/unknown from absent/corrupt STATE.json (never-throw)
- [Phase ?]: [08-00] STYL-04 README dual-use disclosure is a Wave-7 (08-07) deliverable; Wave 0 encodes only its CONTENT CONTRACT as a RED-by-skip assertion in repo-files.test.ts (guarded on '## Style Match' presence) — README.md NOT modified in Wave 0
- [Phase ?]: [08-01] GlobalLibraryEntry.id is z.string().min(1) not uuid() — the registry decouples from the id generator; the global-library.test.ts contract registers bare ids
- [Phase ?]: [08-01] deriveLibraryStatus is SYNCHRONOUS (test calls without await) — a guarded synchronous loadStateSync shim mirrors the async loadState absent-vs-corrupt classification (ENOENT→intake, any other failure→unknown)
- [Phase ?]: [08-01] DERIVE-AT-DISPLAY: list computes each paper's lifecycle status from its authoritative STATE.json at display time, never from the stored entry.status (consulted only for the terminal archived flag) — resolves Open-Q4
- [Phase ?]: [08-01] 'global-library' added to loadAndMigrate schemaName union (Rule 3 blocking) — the typed literal union would otherwise reject the new schemaName and break tsc
- [Phase 08]: [08-03] pymupdfShellout honors PENSMITH_PYTHON env override (default python3) — the locked 08-00 Wave-0 RED test forces the ENOENT/null path via a nonexistent PENSMITH_PYTHON; the override is the resolved interpreter source (load-bearing test contract over the literal hardcoded-python3 action)
- [Phase 08]: [08-03] pymupdf tmpfile bytes written via atomicWriteFile (D-07 chokepoint) not direct fs.writeFile — chose routing through the sanctioned chokepoint over a new per-file ESLint exemption so D-07 stays intact
- [Phase 08]: [08-03] pdf-parse pin guard asserts BOTH the declared package.json pin (literal 1.1.1, no range) AND the installed require(pdf-parse/package.json).version (T-08-03-04 dual-surface drift guard)
- [Phase 08]: [08-03] extractPdfText pymupdf fallback gates on fallbackText non-null AND >=50 non-whitespace chars — a partially-failing fitz falls through to the same WARN+degrade path as null, never returning garbage that masks the image-only signal (RSCH-05b)
- [Phase ?]: [08-02] StyleProfileSchema is FLAT per the authoritative test, not nested features (RED test wins over PLAN/PATTERNS)
- [Phase ?]: [08-02] Fingerprint registry is path-free (hash to paperId/paperName/addedAt only, no features, no folderPath); detection-only, returns priorPapers for the caller's unconditional reuse notice
- [Phase ?]: [08-02] generatedAt derived from the fingerprint (not Date.now) so identical samples yield byte-identical profiles for the determinism test
- [Phase 08]: add <doi|pdf|url> ingests mid-paper; remap touches ONLY assigned_sources[] (verified sections stay verified)
- [Phase 08]: sketch enforces no-advance-until-confirm; dispatches new with thesis seed (intake --thesis, not a 17th verb)
- [Phase 08]: loadCassetteDir merges all adapter cassettes; parseWithRetry stabilizes pdf-parse transient PDF.js lexer faults
- [Phase ?]: [08-05] resolveVoiceHint priority: explicit PLAN voice direction > style-match render > default (Pitfall 7); RED test signature/source-of-voice wins over plan wording
- [Phase ?]: [08-05] intake --style-samples is the live style-match PRODUCER (build->check->print unconditional reuse notice->write); registration + producer non-fatal, graceful-degrade on absent STATE.json; status:'intake' seeded once, live status DERIVED by list
- [Phase ?]: [08-05] LIB-04 intake registration retains absolute folderPath; STYL-04 README guard pre-existed (08-00), Task 3 authored README only, no hash-pin (not locked-copy)
- [Phase ?]: [08-06] list/open are CLI-only at the tier-contract layer (no MCP tool); parity = two CLI runs with ±20% length equivalence (compile precedent). sketch/add parity is a presence/shape contract (UX02_VERBS member + verb file + workflow body + documented CLI-only interactive/network asymmetry)
- [Phase ?]: [08-06] sketch no-advance observable uses a STDIN-CLOSED spawn (not undeclared --confirm): citty does not bind test-seam args; a spawned sketch with stdin closed aborts the prompt and creates NO .paper/ — load-bearing assertion is absence of state mutation (Pitfall 6), not exit code
- [Phase ?]: [08-06] seedGlobalRegistry STATE.json fixture uses schemaVersion 2 (CURRENT_STATE_VERSION) not 1 — deriveLibraryStatus does a RAW StateSchema.parse via loadStateSync (no migration), so a v1 envelope fails z.literal(2) and classifies as unknown(corrupt) instead of live intake
- [Phase ?]: [08-06] add.md capability_check corrected to required AskUserQuestion only — the real bin/cli/add.ts ingests via Crossref/PDF/URL (http.ts D-06), never Zotero MCP; the stub Zotero/library/state tokens removed (accuracy correction, all stayed W4-valid)
- [Phase ?]: 09-01: NAME suppression uses two-stage DROP-if-all-suppressed + TRIM-leading-while->=2-remain (Author Jane Smith->Jane Smith, In Smith kept, Results Section dropped)
- [Phase ?]: 09-01: diffPii derives spans from classifyPii(original) only; optional unused _redacted param for API symmetry; no char-by-char diff (determinism)
- [Phase ?]: 09-02: research.done render merges sources[].supportedClaim + sibling claims[] keyed by citekey (H2 fixture shape)
- [Phase ?]: 09-02: TUTORIAL.md render is idempotent overwrite (ordered block Map + full-doc atomicWriteFile), never blind append
- [Phase ?]: 09-02: onSectionWritten? is a goal-UNAWARE callback seam; all goal logic confined to write.ts CLI tier (zero-branch intact)
- [Phase ?]: [09-03] router stays goal-AGNOSTIC: resolveNextAction gains a plain stopAfterResearch DI param; the goal->stop mapping lives ONLY in bin/cli/goal.ts (CLI tier) so the zero-branch invariant scans router.ts clean (H1)
- [Phase ?]: [09-03] PII egress proven BY CONTENT via an in-module __setInterpolateForTest seam — native ESM module namespaces are sealed under Node 24; redacted egressSeed is the interpolate payload (H3); intake-clarifier template var is {{assignment}} (Rule 1 fix)
- [Phase ?]: [09-03] config.toml [project] goal is the canonical goal store (no STATE.json field); persist best-effort with WARN + in-memory fallback (M1); learning hard-stop reuses status/done; WN-3 tutorial prompts re-pinned to real SHA-256 (no pending bypass)
- [Phase ?]: [10-00] Wave-0 RED gates are RED-by-skip (skip, not assertion-fail) so the full suite stays GREEN with 0 failures — matches locked 05-01/06-01/08-00 convention; diverges from plan-body 'fire RED' wording (Rule 3) because run-tests.mjs has no expected-RED allowlist
- [Phase ?]: [10-00] 7 bundled CSL files fetched from citation-style-language/styles-distribution master (fully-resolved independent styles, HTTP 200, no rel='independent-parent' <link> so no render-time fetch); upstream bytes kept verbatim to preserve CC-BY-SA attribution and diffability
- [Phase ?]: [10-00] RED-by-skip dynamic imports use a runtime URL .href specifier (08-00 pattern) + symbol feature-detect (typeof renderStyle/setZoteroClientForTest === 'function') so tsc stays clean and behavioral tests skip cleanly while target modules/exports are absent
- [Phase ?]: 10-01: renderApa delegates to renderStyle(entries,'apa') — single Map-guarded 'pensmith-apa' registration (H2 fix)
- [Phase ?]: 10-01: all 8 citation styles render offline + deterministically via a registeredStyles Map memoization over bundled CSL files (no render-time fetch)
- [Phase ?]: 10-02: ris-write.ts is a verbatim structural copy of bibtex-write.ts; sole divergence is cite.format('ris', {spec:'new'}); imports {Cite} from ./citations.js (D-19) + atomicWriteFile (D-07) + shared suffixForCollision
- [Phase ?]: 10-02: CITATIONS.ris emitted at research time symmetric with .bib; exporter bundles it (ExportResult.risCopied) via existsSync-guarded copy, never re-serializes
- [Phase ?]: [10-03] zotero-mcp adapter isZoteroAuthenticated is KEY-ONLY (decoupled from FS-presence, H3) so the injected-client CI path is authorizable with just ZOTERO_API_KEY; doctor probe deliberately does NOT reuse it — composes isZoteroMcpPresent() && key inline to distinguish ABSENT from CONFIGURED_NO_AUTH
- [Phase ?]: [10-03] D-12 chokepoint forces DOT-ACCESS env reads in doctor probes (process.env.ZOTERO_API_KEY); both computed-literal and variable subscripts trip no-restricted-syntax — matched contact-email-presence.ts pattern
- [Phase ?]: [10-03] injected _client is a valid presence signal (canonical gate 1) so the offline test drives the present+auth branch without writing a real mcp_servers.json; live MCP transport remains MANUAL-only (no CI), client injection wired in 10-04
- [Phase ?]: [10-04] intake-clarifier re-pinned DIRECTLY to real SHA-256 e2fa74ba (no sentinel) — byte-stable in-place edit follows the Phase-9/Phase-5 re-pin precedent; loadPrompt resolves with no PENSMITH_ALLOW_PENDING_PROMPT_HASHES bypass
- [Phase ?]: [10-04] Zotero used-as-source path + absent/no-auth fallback declared in workflows/research.md (executable seam shipped in 10-03); W4 required: list untouched so no new capability_check top-level key
- [Phase ?]: [10-04] RIS exercised as a library surface through the research verb (not a 17th verb); tier-contract bijection guard forbids zotero/zotero-mcp/ris/style from UX02_VERBS while confirming zotero-mcp lives only in the sources registry
- [Phase ?]: _taskRunner checked before isHumanizerSkillPresent — injected non-null runner bypasses skill-gate, enables call-through test on machines without humanizer installed
- [13-02]: exporter.ts imports only { parseBib, renderStyle, renderInText } from ./citations.js (D-19 chokepoint) — Cite never imported in exporter.ts
- [13-02]: resolveAndRenderCitations calls renderStyle FIRST to prime pensmith-${style} template registration before the per-entry renderInText loop (memoized registration ordering pattern)
- [13-02]: bib-copy (DONE-08) moved BEFORE all pandoc execFileAsync calls (Pitfall-4) so --bibliography bibDst resolves at call time
- [13-02]: done.ts reads discipline from INTAKE.md via parseIntakeMd + resolveStyleName; empty catch leaves style undefined → exportDraft defaults APA (never-throw pattern)
- [13-02]: exactOptionalPropertyTypes:true requires spread conditional ...(style !== undefined ? { style } : {}) when passing optional fields from let-initialized variables
- [14-01]: GATE-01 Wave-0 tests use tolerant 'no verifiable' phrase guards (not RED-by-skip) because compile.ts exists — the specific refuse message is what's unshipped
- [14-01]: GATE-03 source-grep skip predicate on pass1.ts for retraction-watch import — existsSync alone vacuously true for an existing file (07-01 pattern reapplied)
- [14-01]: gate03-blocking-doi.json DOI 10.0000/gate03-retracted — distinct from fetchById-fake (10.0000/test) and freshness-hit (10.0000/retracted) cassettes

### Pending Todos

None yet.

### Blockers/Concerns

- Style-match (Phase 8) is novel-territory dual-use with no industry precedent; flagged for milestone-close review of guardrails before shipping.
- PRD §17 open questions (verifier prompt wording, section-dependency syntax, wave-scheduling algorithm, MCP SDK choice, PDF parsing library, style-match implementation, library index format, section renumbering policy) deferred to per-phase discuss-phase as planned.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none — fresh init)* | | | |

## Session Continuity

Last session: 2026-06-24T00:00:00.000Z
Stopped at: Completed 15-08-PLAN.md (SECURITY.md audit + Semaphore bare-caller doc, Phase 15 Wave 4 complete)
Resume file: None

## Operator Next Steps

- Start Phase 11 planning with /gsd:plan-phase 11
