---
phase: 17-runtime
milestone: v1.0.0
plan: 17-PLAN.md (four parallel streams: egress, llm, paper-cli, foundations)
base_commit: 4f73336 (docs(17): plan phase 17 RUNTIME)
closed_at_commit: 9d0c23d + this close commit
status: in-progress (35 of 37 in-scope requirements Complete; RUN-26 and CI-06 open)
requirements_complete: [RUN-01, RUN-02, RUN-03, RUN-04, RUN-05, RUN-06, RUN-07, RUN-08, RUN-09, RUN-10, RUN-11, RUN-12, RUN-13, RUN-14, RUN-15, RUN-16, RUN-17, RUN-18, RUN-19, RUN-20, RUN-21, RUN-22, RUN-23, RUN-24, RUN-25, RUN-27, RUN-28, RUN-29, CONF-01, CONF-04, BRDTH-01, SEC-01, SEC-03, CI-07, CI-09]
requirements_open: [RUN-26, CI-06]
out_of_scope: [SWEEP-01]
closed: 2026-09-28
---

# Phase 17: Tier-2 Runtime Foundations (RUNTIME): Summary

## What shipped

Phase 17 turned the Tier-2 CLI from a replay-by-default prototype into a runtime that goes to the live services and reports what it did. It also landed the foundations every later v1.0.0 phase uses. Four streams built it in parallel around six verbatim seam files (D-17-01, D-17-02). After they merged, it went through an integration pass and three adversarial review rounds: round 1 fixed 29 of 30 findings, round 2 fixed all 30 and round 3 fixed 20 of 22. Every rejected review item is recorded below with its reason.

### Network modes and the egress gate (egress stream)
- **Live by default (RUN-01, D-V1-01).** `http-mock.ts networkMode()` returns `{sourcesOffline, llmStubbed, dryRun, reason, fixturesAvailable}`. A user with no environment variables is live. Offline replay happens only under `PENSMITH_OFFLINE=1`, `--dry-run` or the test runner. `PENSMITH_NETWORK_TESTS` is read in exactly one seam.
- **One egress gate in `http.ts callOnce` (RUN-04, D-17-05).** It applies the network mode, then the exact-match fixture store (D-17-06), SSRF validation with IP pinning (SEC-01), the streamed size cap (SEC-03, `ResponseTooLargeError`), the `--show-prompts` mirror (RUN-16, D-17-12) and a `kind:"http"` SESSION.log record (D-17-13). While sources are offline, the only socket it may open is the configured loopback LLM endpoint. `--dry-run` opens zero sockets.
- **Fail-closed fixtures (RUN-03).** Every first-item or first-cassette fallback is gone. A miss is `OfflineEgressError`. Pass 1 records the blocking `UNVERIFIABLE` verdict (D-17-07), research returns 0 candidates, `add` refuses, plagiarism is "skipped (offline)" and honesty is "score unavailable (offline)".
- **Disclosure (RUN-02, D-17-08).** One `OFFLINE MODE` banner and one `LLM STUBBED` banner per process. Offline markers go into RESEARCH.md, VERIFICATION.md and COMPILE-REPORT.md, never into exports. The new doctor `network-mode` probe reports the mode.
- **Installed package (RUN-05, D-17-15).** Nothing under `bin/`, `mcp/` or `hooks/` resolves a `tests/` path except the http-mock seam (chokepoint row). With `PENSMITH_OFFLINE=1` an installed package refuses with the not-shipped message.
- **Synthetic dry-run provider (RUN-27, D-17-11, D-17-46).** `templates/dry-run/corpus.json` supplies `10.0000/pensmith-dryrun.*` sources, and they are accepted only under `--dry-run`. Dry-run papers carry the `.paper/DRY-RUN.md` marker, a `--dry-run` over a real paper is refused, and the library writer drops leftover synthetic entries.
- **Cassette recorder (CI-07, D-17-14).** `scripts/refresh-cassettes.mjs` plus an `http.ts` record hook. It scrubs secrets and `mailto`, refuses to record an error document served with HTTP 200, and enforces the 51200-byte cap. All seven source adapters now have real recordings, including a keyless OpenAlex recording. Retraction lookups go through Crossref REST `works?filter=updates:<doi>` (D-17-47).

### Model runtime (llm stream)
- **Model table and pricing (RUN-06, D-17-17, D-17-18).** `bin/lib/llm-models.ts` covers the current IDs: claude-opus-5 (the default), claude-sonnet-5, claude-haiku-4-5, claude-opus-4-8, claude-fable-5-1, and gpt-6-astra and gpt-6-luna for OpenAI. Retired IDs alias to their successors with one warning. An unknown model uses a config price or the provider's maximum price, with one warning. `UnknownModelError` never reaches a user path.
- **Runtime resolution and providers (RUN-07, RUN-08, D-17-19, D-17-20).** Precedence is flag > paper `[runtime]` > global runtime.json (v2 migration) > environment detection > default. A paper cannot set `endpoint` or `api_key_env`. Providers are anthropic, openai, ollama, vllm and openai-compatible, and every transport lives in `anthropic.ts`. `--runtime` and `--model` are global pre-parsed flags. The LLM endpoint allowlist refuses link-local and metadata ranges and allows `http://` only for loopback (D-17-09).
- **Anthropic request and response policy (RUN-24, D-17-21, D-17-22).** Adaptive thinking and explicit per-slug effort are sent, with no effort on Haiku 4.5. No sampling parameters, `budget_tokens` or prefill are sent. The parser reads every content block and ignores thinking. It branches on `stop_reason`: `refusal` raises `ProviderRefusalError` and `max_tokens` gets one larger retry. A missing stop reason is an incomplete reply and nothing is persisted. OpenAI `length` and `content_filter` stops are handled the same way.
- **Structured output (RUN-25, D-17-23).** `bin/lib/llm-contracts.ts` defines one zod schema per structured slug. From it, an in-repo JSON-Schema converter builds Anthropic `output_config.format`, OpenAI strict `response_format` and the Ollama form. The tolerant parser plus one corrective retry covers providers with no native support. OUTLINE.md and PLAN.md are rendered from the validated objects.
- **Per-slug table (RUN-26, D-17-24).** Generation slugs use the configured model (claude-opus-5). Judgment slugs use claude-haiku-4-5, or the provider's small model on OpenAI. `[runtime.slugs.<slug>]` accepts step aliases (pass2, pass4, evaluator, queries). Projections use the p90 of output tokens. Contract stubs for `PENSMITH_NO_LLM` live in `llm-stubs.ts` (D-17-25).
- **Session cost cap (RUN-18, D-17-26, D-17-27).** `[budget] cost_cap_usd` defaults to $5. `PENSMITH_COST_CAP_USD` is validated. Each call's cost is projected and reserved under an in-process mutex. Crossing the cap goes through the `cost-cap` gate, which `--yolo` never skips (exit 5). `warn_at_usd` triggers one warning. The `--yolo` pre-flight projects only the steps this invocation will run.
- **Estimator, status, session log, replay (RUN-19, RUN-20, RUN-15, RUN-17).** `--estimate` produces per-step rows, marks completed steps as done at $0, and asks a TTY user whether to proceed. `status` shows the paper, position, glyphs with an ASCII fallback, and a cost meter for the running or last session (D-17-49). `status --config` shows every value with its source. SESSION.log records `kind:"llm"` entries (full or redacted bodies) and `kind:"http"` entries. `resume --replay <id>` reproduces a logged step offline, and `scripts/extract-fixture.mjs` produces mock fixtures.
- **Mock LLM (RUN-21, D-17-28).** `tests/helpers/local-servers/mock-llm.ts` speaks both API shapes, with a leading empty thinking block for Opus 5 and Sonnet 5, schema-valid structured replies, scripted replies, fixtures, SSE, failure injection and request capture. It runs standalone via `npm run mock-llm`.
- **config.toml loader (CONF-01, D-17-31, D-17-48).** `bin/lib/config.ts` (smol-toml plus zod) enforces `schema_version = 1` and migrates v0→v1. Write-back is line-level and keeps comments. Unknown keys are warned about and kept. `verify_quotes` is rejected with the §14 reason. The PRD §10 drift test covers the schema.

### Paper state, CLI contract and frontmatter (paper-cli stream)
- **One paper root (RUN-13, D-17-32).** STATE.json and config.toml live in `.paper/` and are built through `paths.ts`/`state.ts` (chokepoint rows). A legacy root-level layout is moved once under the lock, and only when it is a pensmith STATE.json envelope. A path given at or inside `.paper/` folds to the project folder.
- **Active-paper resolver (RUN-14, D-17-33).** The order is `--paper`/`PENSMITH_PAPER_ROOT`, then the cwd paper, then a new paper, then the `open` pointer. Read-only verbs print a banner. Mutating verbs ask in a TTY and exit 2 otherwise. `--yolo`, the MCP server and the hooks never follow the pointer.
- **Exit codes and one-line failures (RUN-09, RUN-12, D-17-34).** `bin/lib/exit-codes.ts` defines codes 0–5, documented in `--help` and the README. `verb-outcome.ts` maps each verb's results to a code. Bare `pensmith`, `next` and `resume` propagate the dispatched verb's code. MCP returns `isError` with the same classification. Expected failures print one line and no stack trace.
- **Unknown verbs and flags (RUN-11, D-17-35).** An unknown verb or flag exits 2 with a did-you-mean suggestion and creates nothing. Global booleans are normalized. The alias table is empty (EXP-21 fills it).
- **Gate registry (RUN-28, D-17-36).** `bin/lib/gates.ts` holds every gate: its id, prompt, `--yolo` behaviour and non-TTY exit code. The PRD §7.20 table is drift-tested against it. Prompts read stdin only from a terminal or in `PENSMITH_PROMPT_MODE=numbered`. Detector consent is never granted by `--yolo` (D-17-16).
- **Session lock (RUN-23, D-17-37).** `bin/lib/session-lock.ts` keeps a per-paper owner record (host, PID, session, start). It is re-entrant within a PID, takes per-section sub-locks for MCP, and clears stale locks with a notice. The Stop hook releases only its own MCP lock.
- **Frontmatter versioning (CONF-04, D-17-38).** PLAN.md is at `schema_version: 1` with a v0→v1 migration. The loader registers the intake, draft and verification kinds, which stay at version 0 until they gain frontmatter (amended acceptance).

### Foundations, CI, library and docs (foundations stream)
- **Node LTS (CI-06, D-17-39).** `engines.node >=22.12.0` and `@types/node ^22.12.0`. The ci.yml matrix is Node 22 and 24 × ubuntu/macOS/Windows. The other workflows use Node 24. The doctor floor and the docs match.
- **Test data-dir isolation (CI-09, D-17-40).** `run-tests.mjs` redirects the data dirs. `paths.ts` gives each process under a test context its own temp dir. `scripts/data-dir-fingerprint.mjs` is a CI step run before and after the suite.
- **Main guard (RUN-10, D-17-41).** `bin/lib/main-guard.ts` compares realpaths, case-folded on Windows. It is used by the CLI, the MCP server and the hooks.
- **Lock contention (RUN-22, D-17-42).** proper-lockfile gets a single attempt. `lock.ts` adds an in-process queue, jittered exponential backoff up to a 250 ms ceiling, and `LockTimeoutError` naming the path and holder PID. A killed holder is cleared early.
- **Library v2 and one writer (BRDTH-01, D-17-43).** `bin/lib/library.ts` does a validated upsert under the lock, dedups by normalized DOI, arXiv ID, PMID and ISBN, merges records, collapses same-title versions and keeps provenance tags. It renders CITATIONS.bib and .ris; `bibtex-write.ts` round-trips non-Latin names. Exports carry only the cited entries. The v1→v2 migration and the chokepoint row are included.
- **Chokepoint harness (RUN-29, D-17-44).** The `pensmith/chokepoint` ESLint rule is driven by `scripts/chokepoints/*.json`, with 13 rows, each with a failing fixture that `tests/chokepoints.test.ts` lints. The no-new-eslint-disable baseline is the 12 directives that already existed. The CLAUDE.md table lists every Phase 17 row. Chokepoints owned by later requirements are listed as "enforced from VRFY-09 / GRND-06 / PLUG-13 / PLUG-06 / PLUG-02".
- **Docs.** README, CONTRIBUTING, CLAUDE.md, README-DEV, PRIVACY.md, SECURITY.md (rows 2a, 25–27 PROVEN) and `references/doctor-output.md` (re-pinned) were updated. Every changed verb's `workflows/<verb>.md` body was rewritten. The PRD was amended at §6 (`open`), §7.19, §7.20 (gate table), §10 (`[runtime]`, `[budget]`, `[logging]`), §13 (`.paper/STATE.json` layout) and §14 (cassettes, schema versioning, and, in this close, the atomic-write file name).

## Files (phase diff 4f73336..HEAD)

358 files changed (+37.8k / −7.8k). `bin/`, `mcp/` and `hooks/`: 118 files (+14.5k / −4.4k). `tests/`: 184 files (+20.2k / −2.7k).

New modules: `bin/lib/{assignment,config,config-text,dry-run-paper,exit-codes,gates,llm-contracts,llm-models,llm-stubs,main-guard,node-warnings,replay,session-lock,status-view,verb-outcome}.ts`, `bin/lib/schemas/config.ts`, `bin/lib/sources/{dry-run,search-failure}.ts`, `bin/lib/doctor/probes/network-mode.ts`, and the migrations `config/v0_to_v1`, `library/v1_to_v2` (+ `shape.ts`), `plan/v0_to_v1` and `runtime-config/v1_to_v2`.

Most-changed modules: `anthropic.ts`, `http.ts`, `library.ts`, `bin/pensmith.ts`, `paths.ts`, `runtime.ts`, `http-mock.ts`, `estimator.ts`, `lock.ts`, `research-orchestrator.ts`, `budget.ts`, `bibtex-write.ts`, `session-log.ts` and `pricing.ts`.

Scripts: `refresh-cassettes.mjs`, `mock-llm.mjs`, `extract-fixture.mjs`, `data-dir-fingerprint.mjs`, `scripts/eslint-rules/chokepoint.mjs` and `scripts/chokepoints/*.json` (13 rows).

Assets: `templates/dry-run/corpus.json`, and re-recorded cassettes under `tests/fixtures/cassettes/<adapter>/`. Hand-written fixtures now live only under `synthetic/`.

## Tests

The suite went from 166 to 216 test files and now has 1503 tests. The new files are the ones listed in 17-VERIFICATION.md, among them `egress-gate`, `net-mode`, `offline-fail-closed`, `live-default`, `ssrf-pinning`, `response-size-cap`, `llm-*` (models, providers, contracts, stop reasons, session log, doctor probe), `mock-llm`, `cost-cap`, `estimate-proceed`, `replay`, `status`, `cli-exit-codes`, `unknown-verb`, `noninteractive-prompts`, `gates-registry`, `paper-root-resolver`, `legacy-layout-migration`, `session-lock`, `lock-contention`, `frontmatter-versioning`, `config`, `config-drift`, `library-writer`, `chokepoints`, `installed-bin`, `installed-offline`, `data-dir-isolation`, `cassette-provenance`, `dry-run-sources`, `dry-run-boundary`, `wave-write-cli`, `workflow-shell-fallbacks` and `tier-contract/{exit-parity,paper-root,status-fields}`.

These tests encoded behaviour this phase supersedes, so they were updated to assert the new behaviour rather than skipped:
- the offline-by-default assertions (`flags.test.ts` ERGO-01, adapter, plagiarism, honesty and freshness setup)
- first-item and search-miss fixture expectations
- `claude-haiku-4` / `claude-sonnet-4` IDs and `UnknownModelError`
- the ARCH-11 50% `--yolo` refusal
- the HARD-05 `--yolo` GPTZero consent skip
- root-level STATE.json after `new`
- `PENSMITH_PAPER_ROOT` as a `.paper`-style directory
- the 11-probe doctor count
- the per-test undici exemptions, now behind V5
- exit-0 refusals

Round 3 changed `exporter.test.ts`, which now asserts cited-only bibliographies. It also changed `add-url-pdf` and `cli-exit-codes`, where a non-identifier argument now exits 2. `flags.test.ts` H1 now seeds PLAN.md files, and the replay tests no longer inherit `--yolo`.

## Deviations from the plan and the requirement text

- **D-17-03:** the local test servers live in a directory module, `tests/helpers/local-servers/`, not a single file. There is still one V6 exemption block.
- **D-17-27 (amended in round 1):** the `--yolo` pre-flight projects only this invocation's steps.
- **D-17-36 (RUN-12 acceptance amended in round 2):** piped answers need `PENSMITH_PROMPT_MODE=numbered`. Without it, a piped run refuses before asking, so a harness stdin that never closes can never hang a run.
- **D-17-38 (CONF-04 acceptance amended in round 2):** INTAKE.md, DRAFT.md and VERIFICATION.md stay at version 0 until they gain frontmatter (GRND-03 and later).
- **D-17-46:** until GRND-19 adds the `.paper-dry-run/` workspace, `--dry-run` works only in a folder with no paper.
- **D-17-47:** the Crossref-REST retraction endpoint, part of SRC-04, was pulled forward so CI-07 could record a real Retraction Watch answer.
- **D-17-44:** the RUN-29 chokepoints owned by later requirements are listed in CLAUDE.md as "enforced from <REQ>". Those requirements add their rows in the same change.
- **Ollama structured output:** Ollama is called through its OpenAI-compatible `/v1/chat/completions` endpoint (the RUN-08 base URL). The schema therefore goes in the non-strict `response_format.json_schema`, which is Ollama's supported structured-output form on that endpoint, rather than the native `/api/chat` `format` field. It is still generated from the same zod schema, and `tests/llm-contracts.test.ts` asserts this.
- **TTY prompts:** in a terminal, the cost-cap and `--estimate` gates render a Yes/No select widget. The `[y/N]` text belongs to the numbered prompt mode. Both use the same gate text.

## Review items rejected (with reasons)

- **Round 1, OpenAlex cassette:** at the time, keyless OpenAlex returned 429. This was superseded in round 2, when a keyless recording succeeded and CI-07 closed.
- **Round 3, prompt caching (RUN-26):** confirmed but not fixed. The templates interpolate per-call data into the system prompt, so no stable prefix exists. The default judgment model's minimum cacheable prefix (4096 tokens) is also above every template size. The fix is a template restructure that puts data last, with re-pins, and that belongs with the GRND-07 and GRND-13 prompt re-pins in Phase 18. RUN-26 stays Pending.
- **Round 3, CI-06 evidence:** the six-leg CI run needs a push, and this workflow forbids pushing. CI-06 stays Pending.

## Out of scope

SWEEP-01 ran in a separate workflow and was merged into planning at 1d38094, which marked it Complete. This phase did not plan, implement, review or change it.
