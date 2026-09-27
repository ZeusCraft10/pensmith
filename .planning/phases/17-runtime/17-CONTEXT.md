# Phase 17: Tier-2 Runtime Foundations (RUNTIME) — Context and decisions

**Milestone:** v1.0.0 Open Source Release
**Base commit:** 8dc75b4eaa06dc110ad2239b872d53bdcb42d602 (branch `akhil/pensive-faraday-qx3o58`)
**Plan:** [17-PLAN.md](17-PLAN.md). **Seam files:** [seams/](seams/).
**Binding inputs:** `.planning/REQUIREMENTS.md` (locked decisions D-V1-01..08, synthesis decisions S-01..S-23, the Phase 17 requirements), `.planning/ROADMAP.md` (Phase 17 success criteria), `.planning/research/V1-GAP-REGISTER.md` (evidence), `PRD.md`, `CLAUDE.md` (chokepoints, hash pins, non-negotiables).

## Scope

In scope: RUN-01..RUN-29, CONF-01, CONF-04, BRDTH-01, SEC-01, SEC-03, CI-06, CI-07, CI-09 (37 requirements).

Out of scope: **SWEEP-01**. A separate concurrent workflow runs it on branch `v1/sweep-01` and merges it later. It stays Pending here. No stream in this phase plans, implements, reviews or closes it. SWEEP-01 needs "the RUN-21 mock where an LLM is needed", so the mock ships with a standalone runner (`npm run mock-llm`, D-17-28) that the sweep can use once this phase merges.

## Current behaviour (what the code does at the base commit)

These are the facts the decisions below respond to. Each was read in the code at the base commit.

- `isOfflineMode()` (`bin/lib/http-mock.ts:138`) returns `PENSMITH_NETWORK_TESTS !== '1'`, so real users replay test cassettes. Adapters short-circuit offline inside their own code, `crossref.fetchById` falls back to the first search item, and search returns the attention-paper fixture for any query. `http.ts` has no egress gate. `doi.ts verifyDoi` and the Pass-3 OA-PDF fetch escape `--dry-run`. `--dry-run` sets `PENSMITH_NETWORK_TESTS=''`, `PENSMITH_NO_LLM=1` and `PENSMITH_DRY_RUN=1` (`bin/pensmith.ts:293-297`).
- `checkSsrf()` returns void, and undici `request()` resolves DNS again. The body is buffered without a limit (`http.ts:704`). Trusted sources skip the SSRF check entirely.
- `anthropic.ts` has the default model `claude-haiku-4` (invalid), reads only `content[0]`, never branches on `stop_reason`, uses a per-scope $0.50 cap, and supports only `anthropic` and `openai` (hard-coded URLs). `pricing.ts` knows only `claude-opus-4`, `claude-sonnet-4` and `claude-haiku-4`, and throws `UnknownModelError` for every valid id. `runtime.ts` reads a global `runtime.json` plus a paper overlay at `<paperRoot>/runtime.json`. The estimator hard-codes `claude-sonnet-4`.
- STATE.json and config.toml are written at the project root (`intake.ts:69/111/148/510`, `goal.ts:41`). Every other artifact is under `.paper/`. The MCP server passes `paperDir()` (the `.paper` directory) as its root, so `paper://state` reads `.paper/STATE.json`, which the CLI never writes. `open` writes `active.json`, and nothing reads it.
- `firstVerb()` lets an unknown first token fall into the bare router. Refusals exit 0. Approval prompts are hand-rolled in outline, research, add, done, revise and honesty, each with its own TTY test and its own `ApprovalUnavailableError` copy. GPTZero consent is skipped by `--yolo`.
- `withLock` wraps proper-lockfile with node-retry backoff (ELOCKED escapes at about 20 contenders). No session-level lock exists. The Stop hook force-removes any `.paper` lock.
- `research.ts` writes LIBRARY.json entries without the `addedAt` that `LibrarySchema` requires. `add` writes only CITATIONS.bib. compile rewrites CITATIONS.bib.
- The main guard `import.meta.url === pathToFileURL(process.argv[1]).href` fails under symlinks (`bin/pensmith.ts:410`, `mcp/server.ts:77`).
- The CI matrix is Node 20.18 only. `engines` is `>=20.10.0`. Tests can touch the real data dir. The cassette recorder has no callers.

## Decisions

Each decision is numbered D-17-NN. Later phases cite them like any other decision ID.

### Parallel execution protocol

- **D-17-01 — Four parallel streams with disjoint ownership.** The work splits into `egress` (network modes, the http.ts transport, fixtures, the dry-run provider, the recorder), `llm` (model runtime, providers, parsing, structured output, per-slug defaults, config loader, budget, estimator, status, session records, replay, mock LLM), `paper-cli` (paper root and state location, active-paper resolver, exit codes, unknown verbs, non-interactive prompts, the gate registry, the session lock, frontmatter versioning) and `foundations` (Node LTS CI, test data-dir isolation, the main guard, lock contention, the library writer, the chokepoint harness, docs). Each stream compiles and tests on its own worktree. It depends only on the base commit, its own files, and the verbatim seam files (D-17-02). Cross-stream *textual* edits are allowed in the named hot files and regions (17-PLAN.md §4.3). Cross-stream *semantic* dependencies (one stream calling another stream's new API) are not allowed.
- **D-17-02 — Verbatim seam files.** A few contracts are needed by several streams before merge. They are fixed now as byte-exact artifacts in `.planning/phases/17-runtime/seams/`: V1 `bin/lib/exit-codes.ts`, V2 `bin/lib/gates.ts`, V3 the `FetchOptions.llm`/`maxBytes` members in `http.ts`, V4 the `llm`/`http` session-log kinds and `isMirrorPromptsEnabled()`, V5 `tests/helpers/local-servers/mock-agent.ts`, and V6 the eslint local-servers exemption block. Any stream that needs one copies or applies it unchanged. Identical adds and identical hunks merge cleanly in git. No stream edits a seam file or the lines next to a seam hunk during Phase 17. They were typechecked and linted against the base commit when the plan was written.
- **D-17-03 — `tests/helpers/local-servers/` is a directory module.** RUN-29 names `tests/helpers/local-servers.ts`. The servers instead live under `tests/helpers/local-servers/` (one module per server family: `mock-agent.ts` V5, `mock-llm.ts` llm, `transport.ts` egress), with the one narrowly scoped eslint exemption V6 covering the directory. Reason: two streams add servers in parallel. The intent (one place, one narrow exemption, no other http/undici import under `tests/`) is unchanged.

### Network modes and the egress gate (egress)

- **D-17-04 — Network mode lives in `bin/lib/http-mock.ts`, the documented test-lane seam.** `networkMode()` returns `{sourcesOffline, llmStubbed, dryRun, reason, fixturesAvailable}`, and `isOfflineMode()` keeps its signature (it returns `sourcesOffline`).
  - `dryRun` is set by `PENSMITH_DRY_RUN=1`, which the `--dry-run` pre-parse sets. It is the channel into child processes.
  - `sourcesOffline` is `PENSMITH_OFFLINE=1`, or dry-run, or a test context (`NODE_TEST_CONTEXT` set, or `PENSMITH_TEST=1`) without `PENSMITH_NETWORK_TESTS=1`.
  - `llmStubbed` is `PENSMITH_NO_LLM=1` or dry-run.
  - `reason` is `'--dry-run' | 'PENSMITH_OFFLINE=1' | 'test runner' | null`.
  - `fixturesAvailable` means `<pkgRoot>/tests/fixtures/cassettes` exists (a source checkout).
  - This is the only `bin/`, `mcp/` or `hooks/` code that reads `PENSMITH_NETWORK_TESTS` (a chokepoint row).
- **D-17-05 — One egress gate in `http.ts` `callOnce`, in this order:**
  1. Mode:
     - Dry-run refuses every request, LLM included, with `OfflineEgressError`.
     - LLM-stubbed refuses any `opts.llm` request.
     - Sources-offline allows only an `opts.llm` request whose configured endpoint resolves to loopback. Every other request is answered from the exact fixture store (D-17-06) or refused.
  2. DNS resolve and validate for every request, trusted source hosts included. Private, loopback, link-local and CGNAT ranges are refused, except the LLM endpoint rules in D-17-09.
  3. Pin: a per-request undici dispatcher whose `connect` dials exactly the validated address, keeping the hostname for SNI and the Host header. `maxRedirections` stays 0 (asserted). SRC-01 (Phase 19) adds the redirect loop, and it re-pins every hop.
  4. `--show-prompts` mirror (D-17-12), before any byte is sent.
  5. Stream the body under `maxBytes`. `ResponseTooLargeError` is thrown before full buffering. Defaults: 8 MiB for JSON and text APIs, `MAX_PDF_BYTES` (50 MiB) for PDFs, 16 MiB for LLM calls.
  6. The `kind:"http"` session record (D-17-13).
  `OfflineEgressError` and `ResponseTooLargeError` are exported from `http.ts`. Adapters stop swallowing `OfflineEgressError` in their catch-alls; callers map it to "unavailable (offline)" or "unavailable (dry-run)".
- **D-17-06 — Exact-match fixture store, inside the gate.** Adapters lose their per-adapter offline branches and all first-item fallbacks (`crossref.fetchById`, `unpaywall.fetchById`, the plagiarism `cassettes[0]`, the canned GPTZero response, search misses). A fixture matches on method, origin, pathname and canonical query. The query is sorted, and `mailto`, `email`, `api_key`, `key`, `tool` and `_` are removed. POST bodies are compared by sha256. Fixtures are searched in `tests/fixtures/cassettes/<adapter>/` and `tests/fixtures/cassettes/synthetic/<adapter>/`. A miss throws `OfflineEgressError`, and it never falls back to another record.
- **D-17-07 — Pass 1 gains a blocking `UNVERIFIABLE` verdict.** A DOI or re-fetch that is unavailable because of the network mode records `UNVERIFIABLE` with the reason `offline: no recorded fixture — re-run online` or `dry-run`. It is never OK, MIS-CITED or FABRICATED. verify marks the section `unverifiable` and exits EXIT_BLOCKED. compile and done refuse on any UNVERIFIABLE verdict row with the "re-run online" message. A `Status: unverifiable` section with zero citation rows keeps passing compile (Pitfall 3) until VRFY-24. VRFY-12 (Phase 20) generalises this to network failures.
- **D-17-08 — Offline disclosure strings are fixed now.**
  - Banner (stderr, once per invocation, before any other output): `OFFLINE MODE (reason: <reason>): sources, verification, detector and plagiarism results are recorded fixtures, not live`. Under `--dry-run` it reads `OFFLINE MODE (reason: --dry-run): sources are labelled synthetic dry-run sources; no network or model call is made`. GRND-19 appends the scratch-workspace path when it lands.
  - `LLM STUBBED (PENSMITH_NO_LLM=1): every model call returns a deterministic stub; no provider is contacted` prints independently of the network mode.
  - The marker line is `> OFFLINE MODE (<reason>) — recorded fixtures, not live results.` (or the dry-run equivalent) as the first line of `.paper/RESEARCH.md` (now written by research, D-17-10), each section VERIFICATION.md, the COMPILE-REPORT.md body and `.paper/VERIFICATION.md`. Llm and http session records carry `offline: true|false`.
  - Exports never contain the marker, because exporters read DRAFT.md or FINAL.md, which never carry it (zero-trace test).
  - doctor gains a `network-mode` probe: `network: live`, or `network: OFFLINE (<reason>)`.
- **D-17-09 — The LLM egress policy is enforced in `http.ts` for `opts.llm` requests.**
  - The request origin must equal the configured endpoint origin (scheme, host, port).
  - `http://` is allowed only when every resolved address is loopback.
  - 169.254.0.0/16, fe80::/10 and fd00:ec2::254 are never allowed, even when configured.
  - Other private ranges are allowed only for the configured endpoint over https, and are pinned.
  - Non-LLM requests to loopback or private addresses are always refused.
  - Config-time validation (a paper config may not set `endpoint` or `api_key_env`, the key-name rule, URL syntax) belongs to llm (D-17-19). The network policy belongs only to `http.ts`.
- **D-17-10 — research writes `.paper/RESEARCH.md`.** `research-orchestrator.ts` writes a human-readable research log: the marker, the scope, the queries, per-adapter counts and failures, and the candidates discovered. Offline misses print `offline: no recorded results for this query` and yield 0 candidates. The router already treats RESEARCH.md as research-done.
- **D-17-11 — Synthetic dry-run provider.**
  - `bin/lib/sources/dry-run.ts` reads the packaged corpus `templates/dry-run/corpus.json`, which ships through `templates/` in `package.json` `files`. PLUG-02 later moves it under `plugin/templates/`.
  - It returns at least 5 deterministic sources per query, seeded by sha256 of the query, with DOIs `10.0000/pensmith-dryrun.<8 hex>` plus synthetic arXiv-style (`pensmith-dryrun.<8 hex>`) and ISBN-style (`978-0-00-<7 digits>`) ids, all flagged `synthetic: true`.
  - `doi.ts` gains `isReservedDryRunId()`. Pass 1 and Pass 3 accept reserved ids only in dry-run. Outside dry-run, research filters them, `add` refuses them, and verify gives FABRICATED (reason: `reserved dry-run identifier`).
  - The provider is never used for cassette replay.
- **D-17-12 — `--show-prompts` mirrors in `http.ts`.** Before sending, it writes to stderr `[show-prompts] <METHOD> <url>`. The URL has secret params (`api_key`, `key`, `token`) stripped. Headers are never printed. An `opts.llm` request adds the full JSON request body. Any other POST adds `body: <n> bytes: <first 200 chars>`. The session-log `prompt`-kind stderr mirror is removed (llm), so a payload prints exactly once.
- **D-17-13 — `kind:"http"` session records.** Each record holds `{source, method, url (secrets stripped), status, cache: 'hit'|'miss'|'fixture'|'refused', offline, bytes, ms}` and no bodies. Records are appended to `.paper/SESSION.log` through the V4 `http()` method.
- **D-17-14 — The cassette recorder is an `http.ts` record hook.**
  - The hook is active only when live, outside a test context, and with `PENSMITH_RECORD_CASSETTES=1`. It buffers one exact-match entry per request (canonical key, status, body, allowlisted response headers).
  - `scripts/refresh-cassettes.mjs` (`npm run cassettes:refresh [-- --only <adapter>]`) drives each adapter's recorded query set through tsx. It fails fast without `PENSMITH_CONTACT_EMAIL`, scrubs Authorization, Cookie, Set-Cookie, X-Api-Key and the `api_key`/`mailto` params, and enforces 51200 bytes by lowering result counts, never by truncating JSON.
  - Synthetic cassettes move to `tests/fixtures/cassettes/synthetic/`, and a provenance test forbids `10.0000/` and `10.1234/example` elsewhere. The nock-based `loadCassettes`/`recordCassettes`/`finalizeRecording` code (and its `eslint-disable`) is deleted. The `nock` devDependency stays, to avoid lockfile churn across streams.
- **D-17-15 — Installed-package offline refusal.** Sources-offline without dry-run and without fixtures makes every verb except `status`, `list`, `doctor` and `open` print `offline fixtures are not shipped in the installed package; offline replay needs a source checkout` and exit EXIT_ERROR before doing any work.
- **D-17-16 — Detector consent is never granted by `--yolo`.** `honesty.ts` goes through the `detector-consent` gate (V2). In a terminal it asks. A run that cannot prompt skips the score with `score unavailable (no consent)`. This replaces HARD-05's yolo skip, per S-14 and RUN-28. EXP-17 adds consent persisted in config.toml.

### Model runtime (llm)

- **D-17-17 — One model table in `bin/lib/llm-models.ts`.**
  - It holds the ids, aliases (`claude-haiku-4`→`claude-haiku-4-5`, `claude-sonnet-4`→`claude-sonnet-5`, `claude-opus-4`→`claude-opus-5`, each with a one-time warning) and per-model capabilities: effort support (none on `claude-haiku-4-5`), thinking default, sampling rejection, native structured output (Opus 5, Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5/5.1; other models use the tolerant parser), max output, and refusal-fallback support.
  - Default models: anthropic `claude-opus-5`; openai `gpt-5` (generation) and `gpt-5-mini` (judgment). The implementer must verify both ids and prices against openai.com/api/pricing (WebFetch) and record the page and date in `pricing.ts`. If the page lists successors, the current flagship and small models replace them in the same change. Local providers (`ollama`, `vllm`, `openai-compatible`) have no default model: a missing model is EXIT_ERROR `set [runtime] model or pass --model`.
- **D-17-18 — Pricing.**
  - `pricing.ts` prices per MTok input/output, with the source (the claude-api model table, cached 2026-06-24) and date in a comment: claude-fable-5-1 and claude-fable-5 $10/$50; claude-opus-5-5 $4/$20 (priced, never a default); claude-opus-5, claude-opus-4-8, claude-opus-4-7 and claude-opus-4-6 $5/$25; claude-sonnet-5 $2/$10; claude-sonnet-4-6 $3/$15; claude-haiku-4-5 $1/$5; plus the verified OpenAI models.
  - Cache writes cost 1.25× input and cache reads 0.1× input.
  - An unknown model uses the price from `[runtime] price_in_per_mtok`/`price_out_per_mtok`, or else the most expensive known price for its provider, with exactly one warning.
  - Local providers price at $0 unless configured.
  - `UnknownModelError` never reaches a user path.
- **D-17-19 — Runtime resolution.**
  - Precedence: the `--runtime`/`--model` flags, then `.paper/config.toml` `[runtime]`, then the global `runtime.json`, then the provider detected from env (only `OPENAI_API_KEY` means openai; otherwise anthropic), then the default.
  - The global `runtime.json` moves to schema v2: `{provider, model, endpoint, api_key_env, price_in_per_mtok, price_out_per_mtok, refusal_fallbacks, slugs, openalexApiKeyEnv, openalexApiKeyOptional, contactEmailEnv}`. The v1→v2 migration maps the first provider entry.
  - The paper-level `<root>/runtime.json` overlay is retired. If one is found, a one-time warning names the config.toml section to use.
  - A paper `[runtime]` may set only `provider`, `model`, `effort`, `price_*` and `slugs`. `endpoint` or `api_key_env` there is a validation error that names the global file.
  - `api_key_env` must be `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or match `^[A-Z][A-Z0-9_]*_API_KEY$`. The key is optional for local providers.
  - `resolveProviderId()` and `getProviderApiKey()` keep their signatures. A new `assertLlmConfigured(verb)` replaces the five per-verb probe blocks with one line each, and its message is `Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local endpoint)`.
- **D-17-20 — Providers (all transports stay in `anthropic.ts`).**
  - anthropic: Messages API (`anthropic-version: 2023-06-01`).
  - openai: chat completions with `max_completion_tokens`, `reasoning_effort` where supported, and `response_format` `json_schema` strict.
  - ollama, vllm and openai-compatible: chat completions at the configured base URL (defaults `http://127.0.0.1:11434/v1` and `http://127.0.0.1:8000/v1`) with `max_tokens`, `response_format` `json_schema` (non-strict; Ollama ≥ 0.5 and vLLM honour it, which is how "Ollama `format`" is delivered through its OpenAI-compatible endpoint), and an Authorization header only when a key variable is configured and set.
  - Every call sets `llm: {endpoint}` and `maxBytes` (V3). doctor probes `GET <endpoint>/models` through a function in `anthropic.ts`.
- **D-17-21 — Anthropic request policy (RUN-24).**
  - Thinking is `{type:"adaptive"}`, explicit, for Opus 5, Sonnet 5, Opus 4.x and Fable. It is omitted for Haiku 4.5.
  - `output_config.effort` is sent only where supported (never to Haiku 4.5).
  - Never sent: `temperature`, `top_p`, `top_k`, `budget_tokens`, or an assistant prefill.
  - Structured slugs send `output_config.format = {type:"json_schema", schema}` on supporting models.
  - Refusal fallbacks are opt-in: `[runtime] refusal_fallbacks = "default"` sends `fallbacks:"default"` with `anthropic-beta: server-side-fallback-2026-07-01` (Opus 5 and Fable only). Cost is then priced per `usage.iterations` entry at each model's price, and the setting is disclosed in doctor and SESSION.log. It is off by default because silent re-routing changes the served model, cost and replay semantics.
- **D-17-22 — Response handling.**
  - Parse every content block, concatenate the `text` blocks, and ignore `thinking`, `redacted_thinking` and `fallback` blocks. Usage prices input, output (thinking included), cache write and cache read.
  - `stop_reason: "refusal"` becomes `ProviderRefusalError`, exit 1: `provider refused (category: <c>)`, plus `stop_details.recommended_model` as a hint when present.
  - `max_tokens` gets one retry at double `max_tokens`, capped at the model maximum. A retry above 16k uses `stream: true`: the SSE body is buffered by `http.ts` under `maxBytes` and parsed in `anthropic.ts`. If the retry is still truncated, the step fails with `ProviderTruncatedError` and nothing is persisted or parsed.
  - OpenAI-compatible: `finish_reason: "length"` retries the same way; `content_filter` or `message.refusal` becomes `ProviderRefusalError`.
  - HTTP 401, 404 `model_not_found`, 429 and 5xx, and timeouts become `ProviderHttpError`, one line naming the provider, the model and the config key to change.
  - All of these errors extend `PensmithError` (V1).
- **D-17-23 — Structured output from one zod schema (RUN-25).**
  - `bin/lib/llm-contracts.ts` maps each structured slug to one zod schema with an object root:
    - `topic-disambiguator` → `{scopes:[{label, queries[]}]}`
    - `source-evaluator` → `{verdicts:[…]}`
    - `intake-clarifier` → `{topic, discipline, questions:[{id, question, suggested_answer}]}`
    - `outline-author` → OutlineSchema with the GRND-07 fields `{thesis, sections:[{n, slug, title, purpose, depends_on, estimated_word_count, assigned_sources, role, voice?}]}`
    - `section-planner` → `{frontmatter: PlanFrontmatterSchema.pick(section, slug, title, depends_on, assigned_sources), body}`
    - `claim-support` (Pass 2) and `orphan-label` (Pass 4) → their existing JSON shapes
  - EXP-11 (claim-consistency) and REV-10 (sketch thesis) register in the same map.
  - An in-repo zod-v3 → JSON-Schema converter covers the subset used. It sets `additionalProperties:false` and moves unsupported constraints into zod-only validation, with an OpenAI strict variant (optional becomes nullable and required). No new dependency, so the lockfile has one owner.
  - `complete({slug, …})` sends the native constraint, validates with the same schema, and returns `data`. A tolerant parser accepts bare, fenced or prose-wrapped JSON and YAML, and runs when there is no native support. One corrective retry follows a structural failure.
  - OUTLINE.md (the canonical GFM table) and PLAN.md (frontmatter plus body) are rendered from the validated objects.
  - No `templates/prompts/*.md` edit happens in Phase 17. GRND-07 and GRND-13 re-pin those prompts.
- **D-17-24 — Per-slug table (RUN-26).**
  - `llm-models.ts` holds, per slug: `tier` (generation or judgment), `effort`, `maxTokens` (the hard per-call ceiling), `retryMaxTokens`, the shipped `p90Output`, `inputEstimate` and `cacheSystem`.
  - Generation slugs (intake-clarifier, outline-author, section-planner, section-drafter, smoother, revise-swap, tutorial-*) use the configured model (default `claude-opus-5`) at effort `medium` (the drafter is `high`).
  - Judgment slugs (topic-disambiguator/query generation, source-evaluator, claim-support, orphan-label; claim-consistency later) use `claude-haiku-4-5` on anthropic, the small model on openai, and the configured model on local providers.
  - Overrides: `[runtime.slugs.<slug>] model`/`effort`. `--model` changes generation slugs only. `status --config` shows each slug's model and where it came from.
  - `cacheSystem` slugs send `cache_control:{type:"ephemeral"}` on a stable system block.
- **D-17-25 — Contract stubs for structured slugs (RUN-04 LLM-stubbed mode, RUN-21 mock defaults).** `bin/lib/llm-stubs.ts` produces deterministic, schema-valid objects for every structured slug: a minimal valid instance derived from the zod schema, plus slug overrides where a minimum is useless. For example, an outline has at least 2 sections, and the disambiguator's queries come from an optional `stubHint` that call sites pass. Text slugs keep the `[PENSMITH_NO_LLM placeholder — …]` string in Phase 17. GRND-19 (Phase 18) extends this module with contract-valid prose stubs, moves stub text into a data file under the asset root, and makes the dry-run outline assign the synthetic citekeys.
- **D-17-26 — Session cost cap (RUN-18).**
  - A session is one top-level process invocation, including a bare-router chain, and has a module-level session id. The MCP server process is one session.
  - COSTS.jsonl records gain optional `session`, `slug`, `section`, `provider`, `model` and `served_model` fields. The ledger is append-only JSONL with no version envelope: readers treat missing fields as legacy, so no migration is needed.
  - The cap is `[budget] cost_cap_usd` (default 5.00), overridden by `PENSMITH_COST_CAP_USD`.
  - Before each call, spend-this-session plus the projected cost is compared to the cap. The projection is the input estimate plus min(recorded p90, `max_tokens`) output, at the model price.
  - Over the cap, the `cost-cap` gate asks once per session in a terminal. A run that cannot prompt, `--yolo` included, sends nothing and exits EXIT_COST_CAP with one line.
  - Crossing `warn_at_usd` prints one warning with the running total.
  - The per-scope $0.50 cap and the Pass 2/Pass 4 section caps are removed. The session cap is the only cap (PRD §14 "Hard cost cap").
- **D-17-27 — The `--yolo` pre-flight compares against the cap, not 50% of it.** The ARCH-11 50% heuristic would refuse the default §15 paper (about $2.6 of $5). The pre-flight now refuses, with EXIT_COST_CAP, only when the projected remaining cost exceeds the session cap. The per-call cap (D-17-26), which `--yolo` cannot skip, is the hard enforcement. *Amended in review round 1:* "remaining cost" is the cost of the steps THIS invocation runs (the named verb and section; `write` with no section is every section still to write; bare/next/resume is the step the router picks), never the rest of the paper — a per-step `--yolo` run under the cap is no longer refused because later steps it will not run are over it. Over the cap it goes through the same `cost-cap` gate, with the same one-line message, as the per-call check.
- **D-17-28 — Mock LLM (RUN-21).**
  - `tests/helpers/local-servers/mock-llm.ts` serves the Anthropic Messages and OpenAI chat-completions shapes (plus `GET /v1/models`) on 127.0.0.1:0.
  - Default replies use the current shape: for Opus 5 and Sonnet 5, a leading `thinking` block with empty text, then text, with usage counting thinking as output. Structured requests get schema-valid JSON from `llm-stubs`.
  - It supports scripted replies per slug (a slug marker is read from the request), fixtures from `extract-fixture.mjs`, request capture, call counts, SSE streaming (optionally slow), and failure injection: 401, 404 `model_not_found`, 429, 5xx, timeout, `stop_reason:"refusal"` with `stop_details`, and `max_tokens`.
  - It closes every socket on `close()`.
  - `scripts/mock-llm.mjs` (`npm run mock-llm -- --port N`) runs it standalone for acceptance checks and SWEEP-01.
- **D-17-29 — SESSION.log llm records (RUN-15).**
  - Each record holds `{id: "<run_id>:<seq>", verb, section, slug, provider, model, served_model, request (the rendered prompt body as sent), response (text and parsed data), input_tokens, output_tokens, cache_*_tokens, cost_usd (equal to the COSTS entry), stop_reason, offline, fallbacks}`.
  - Bodies are stored as sent, not PII-rewritten, because the prompt is already intake-redacted when the user opted in. Keys are always redacted, and a sentinel test checks it.
  - An llm record above 256 KiB spills to `.paper/sessions/<run_id>/<seq>.json`. The log line keeps sha256 hashes and 200-character previews.
  - `[logging] session_bodies = "redacted"` keeps only hashes, counts, cost and previews.
  - The argv of the invocation is logged once per session, for replay.
  - Kind-specific behaviour lives inside `buildRecord` and `emit`, never in the V4 method table.
- **D-17-30 — Replay (RUN-17).** `resume --replay <entryId>` finds the llm record and re-dispatches its verb and section with the logged argv. Under sources-offline, `complete()` serves the logged responses matched by (slug, sha256 of the request body) and never dials. `session_bodies = "redacted"` reports `not replayable`. `scripts/extract-fixture.mjs` turns a SESSION.log into a mock fixture keyed by slug.
- **D-17-31 — config.toml loader (CONF-01).**
  - `bin/lib/config.ts` is the only reader and writer of `.paper/config.toml`. It uses smol-toml and zod, and `schema_version = 1` is written by intake.
  - An older file is migrated through `bin/lib/migrations/config/vN_to_vN+1.ts` and written back. A newer one is refused with an upgrade message. Unknown keys get one warning each.
  - The tutorial `[project]` keys come from an opaque zod fragment exported by `tutorial.ts`, so the lint-tutorial-no-branch allowlist is not widened.
  - `verify_quotes` is an error citing PRD §14.
  - `status --config` prints each effective value with its source: default, preset, intake, config, env or flag.
  - PRD §10 is amended by the llm stream: default model `claude-opus-5`, the 8 styles, price overrides, `[runtime.slugs.*]`, `[logging] session_bodies`, `endpoint`/`api_key_env` moved to the global runtime.json, and `verify_quotes` dropped. A drift test parses the §10 TOML block against the schema.

### Paper state, CLI contract and frontmatter (paper-cli)

- **D-17-32 — "Paper root" means the project folder that contains `.paper/`, everywhere.**
  - `loadState`, `loadOutline`, `loadSection`, `loadLibrary`, `config.ts`, COSTS and SESSION.log all take the project root and resolve `.paper/` themselves.
  - STATE.json is `.paper/STATE.json`.
  - `PENSMITH_PAPER_ROOT` names the project root for the CLI, the MCP server and the hooks.
  - A legacy root-level STATE.json or config.toml is moved into `.paper/` atomically under the per-file lock by `migrateLegacyLayout(root)` (paths.ts or state.ts), with a one-time notice. It runs when a root is resolved and inside `loadState`, and never leaves two copies.
  - Existing tests that seed a root STATE.json keep working through this migration. Assertions about where `new` writes are updated.
- **D-17-33 — Active-paper resolver.**
  - `resolvePaperRoot({verb, paperFlag, mode: 'cli'|'mcp'|'hook'})` in `paths.ts` follows S-21 and records the result with `setActivePaperRoot()`. `projectRoot()` with no argument then returns the active root, and every `process.cwd()` used as a paper root is replaced by `projectRoot()` (a chokepoint row).
  - `--paper <name|path>` takes a name from `pensmith list` or a folder containing `.paper/`.
  - The pointer serves read-only verbs (status, list, doctor, `--estimate`) with the banner `(active paper "<name>" at <path>)`. Mutating verbs and bare/next/resume ask through the `paper-pointer` gate (continue or start new) in a terminal, and refuse with EXIT_USAGE naming `--paper <name>` and `pensmith new` otherwise. `--yolo` never follows the pointer.
  - The MCP server and the hooks never follow the pointer. A stale pointer is cleared with a warning.
  - PRD §6 `open` is amended.
- **D-17-34 — Exit codes and one-line failures (RUN-09, RUN-12).**
  - `dispatch()` becomes a wrapper around `dispatchInner()`, which catches everything:
    - `PensmithError` prints `pensmith: <message>` and exits with its code.
    - `PromptAbortedError` exits EXIT_APPROVAL.
    - citty usage errors exit EXIT_USAGE.
    - Anything else prints one line plus `set PENSMITH_DEBUG=1 for a stack trace` and exits EXIT_ERROR.
  - Explicit verbs run through citty `runCommand` inside that wrapper, never `runMain`, which prints stacks.
  - Verb results `{ok:false, blocked|refused|status}` map to the codes. Bare/next/resume propagate the dispatched verb's code.
  - MCP tools return `isError` with the same classification.
  - `--help` appends the exit-code table (V1 `EXIT_CODES`) and the global flags.
- **D-17-35 — Unknown verbs and flags (RUN-11).**
  - `bin/lib/verbs.ts` gains `VERB_ALIASES` (empty in Phase 17; EXP-21 fills it).
  - A first non-flag token that is neither a verb nor an alias exits EXIT_USAGE with `unknown command '<x>'` and `did you mean '<verb>'` (Levenshtein ≤ 2). It creates nothing and makes no network or LLM call.
  - Flags are validated against the verb's citty args plus the global flags. The value-taking globals (`--paper`, `--runtime`, `--model`) are stripped, with their values, before citty sees argv.
- **D-17-36 — Gates (RUN-28).**
  - The V2 registry is authoritative in Phase 17: outline approval, export confirmation, research scope, research pruning, add remap, revise swap, cost cap, estimate proceed, detector consent, and the paper pointer.
  - Gates can prompt when stdin is a TTY or `PENSMITH_PROMPT_MODE=numbered` (scripted answers).
  - `ask()` may be imported only by `gates.ts` and by content-question verbs (sketch; intake from GRND-02). This is a chokepoint row.
  - PRD §7.20 is amended with the full table, including future gates marked with their landing requirement. A drift test compares the table with `GATES` for the implemented rows.
  - Automatic revision stays with REV-01 (`--auto-revise`). The existing `plan --revise --yolo` swap auto-accept stays yolo-skippable as the `revise-swap` gate.
- **D-17-37 — Session lock (RUN-23).**
  - The owner record is `pensmithLockDir()/session-<projectHash>.json` = `{hostname, pid, sessionId, kind: 'cli'|'mcp', verb, startedAt, claudeSessionId}`.
  - It is acquired with an atomic `open(…,'wx')`:
    - Our own PID re-enters.
    - A dead PID on the same host, or a record older than 6 h (the longest step timeout bound), is cleared with `cleared stale lock (pid N, started T)`.
    - Otherwise it refuses (EXIT_ERROR) with `another pensmith session (pid N, started T) is working on this paper; run pensmith resume once it ends`.
  - The CLI holds the lock for mutating verbs and bare/next/resume and releases it on exit. status, list, doctor, open and `--estimate` without proceeding do not take it.
  - The MCP server acquires it per mutating tool call (re-entrant within its PID) and takes per-section sub-locks with `withLock(sectionDir)`.
  - The Stop hook releases only a lock whose owner is `kind: 'mcp'` with `claudeSessionId` equal to its stdin `session_id`, and never removes any other lock. The unconditional `forceRelease('.paper')` is deleted. PLUG-14 completes the hook.
- **D-17-38 — Frontmatter versioning (CONF-04).**
  - PLAN.md frontmatter carries `schema_version: 1`. `bin/lib/frontmatter.ts` gains `loadFrontmatterDoc(kind, file, {writeBack})`, with migrations under `bin/lib/migrations/<kind>/vN_to_vN+1.ts` for the registered kinds `plan`, `intake`, `draft` and `verification`.
  - Today only PLAN.md has frontmatter. GRND-03 uses `intake`. DRAFT and VERIFICATION gain frontmatter only when a later requirement adds a field, and it goes through the same loader.
  - The router reads without write-back, which keeps it pure.
  - A newer version is refused with `upgrade pensmith`.
  - PRD §14 "Schema versioning" is amended to the shipped naming.

### Foundations, CI, library and docs (foundations)

- **D-17-39 — Node LTS.** `engines.node` is `>=22.12.0` and `@types/node` is `^22`. ci.yml runs Node 22 and 24 on ubuntu, macOS and Windows. Every other workflow uses Node 24. The doctor node probe, README, CONTRIBUTING, CLAUDE.md and the run-tests comments state the same floor.
- **D-17-40 — Test data-dir isolation (CI-09).**
  - `scripts/run-tests.mjs` creates a per-run temp dir, sets `XDG_DATA_HOME`, `LOCALAPPDATA` and `PENSMITH_TEST_DATA_DIR` to it, and sets `PENSMITH_TEST=1`.
  - Under a test context, `pensmithDataDir()` uses the platform variable only when it resolves inside `os.tmpdir()`. Otherwise it uses `PENSMITH_TEST_DATA_DIR`, and failing that a per-process temp dir. The real data dir, which is never under the temp dir, is therefore unreachable from tests, including on macOS where the data dir derives from HOME.
  - A CI step hashes the real `library/index.json` before and after `npm test`.
- **D-17-41 — Main guard (RUN-10).** `bin/lib/main-guard.ts` `isMainModule(importMetaUrl)` compares `realpathSync(fileURLToPath(importMetaUrl))` with `realpathSync(process.argv[1])` (case-folded on Windows). No other file compares against `pathToFileURL(process.argv[1])` (a chokepoint row).
- **D-17-42 — Lock contention (RUN-22).** Acquisition works in three layers:
  1. An in-process FIFO queue per canonical resource.
  2. One proper-lockfile attempt with `retries: 0`.
  3. On ELOCKED, jittered exponential backoff (5 ms growing to 250 ms) until `timeoutMs`.
  An `owner.json` inside the lock directory records the holder's PID and start time. A timeout throws `LockTimeoutError(resource, holderPid)`.
- **D-17-43 — Library schema v2 and one writer (BRDTH-01).**
  - Entries hold `{citekey, doi, arxiv, pmid, pmcid, isbn, title, authors[], year, venue, abstract, oa_url, alternate_dois[], provenance[], retracted, retraction_details, synthetic, last_verified, byo, addedAt, updatedAt}`, with `$schemaVersion: 2`.
  - The v1→v2 migration accepts both the strict v1 shape and the research-written SourceCandidate shape that was missing `addedAt`.
  - `bin/lib/library.ts` `upsertSources(root, candidates, {provenance})` runs under the lock:
    - It dedups by `doi.ts`-normalised DOI, then arXiv id, PMID and ISBN.
    - It merges by keeping the richer field and the union of provenance tags.
    - It collapses same-title versions (Jaro-Winkler ≥ 0.95, same first-author family name, year within 1), preferring the version of record over SSRN and Research Square DOIs. Alternate DOIs are kept as candidates only.
  - It renders CITATIONS.bib (through `citations.ts`/`bibtex-write.ts`) and CITATIONS.ris from LIBRARY.json. Nothing else writes those three files. compile stops rewriting `.paper/CITATIONS.bib`, since citeproc renders only cited keys.
  - `add` of a known DOI prints `already in library as <key>`.
- **D-17-44 — Chokepoint harness (RUN-29).**
  - A local ESLint plugin rule, `pensmith/chokepoint` (`scripts/eslint-rules/chokepoint.mjs`), is driven by definition files `scripts/chokepoints/<id>.json`: `{id, requirement, module, description, scope globs, allow globs, match: {kind: string-literal|call|import|member|file-regex, pattern}, fixture}`.
  - `tests/chokepoints.test.ts` enforces the `file-regex` and import-graph kinds and runs every row's failing fixture (`tests/fixtures/chokepoints/<id>.violation.ts.txt`, linted through `lintText`, so no fixture pollutes project lint).
  - Being a separate rule name avoids the flat-config last-match-wins problem with `no-restricted-syntax`.
  - Each stream writes the rows for the chokepoints it creates. foundations writes the rule, the harness, its own rows (main guard, no new `eslint-disable`, library writer), the CLAUDE.md table covering every Phase 17 chokepoint, and the consolidation of test exemptions into V6.
  - Rows for chokepoints owned by later requirements (citation grammar VRFY-09, discipline literals GRND-06, stdout sink PLUG-13, bundle ignores PLUG-02) are listed in the CLAUDE.md table as "enforced from <REQ>". Those requirements add their rows in the same change (S-20 pattern).

### Documentation ownership

- **D-17-45 — Each stream amends the PRD sections of its own requirements.** Stream edits are section-local. egress: §14 "Cassette-based source tests". llm: §10 and §7.19. paper-cli: §6, §7.20, §13 and §14 "Schema versioning". foundations owns README.md, CONTRIBUTING.md, CLAUDE.md, README-DEV.md and `references/doctor-output.md` (plus its hash pin in `tests/repo-files.test.ts`). It writes them from this document's decisions, so no other stream edits them. `.planning/SECURITY.md` rows (SEC-01 row 2a PROVEN, a new SEC-03 row, the LLM-endpoint allowlist) belong to egress.

## Tests that encode superseded behaviour (updated, not skipped)

These assertions change because this phase supersedes the behaviour they pin. Each owning stream updates them to assert the new behaviour and names them in its summary:
- The offline-by-default assertions: `tests/flags.test.ts` ERGO-01, and the comments and setup in the adapter, plagiarism, honesty and freshness tests.
- The first-item and search-miss fixture expectations.
- The `claude-haiku-4`/`claude-sonnet-4` ids and `UnknownModelError` expectations.
- The ARCH-11 50% yolo refusal cases.
- The HARD-05 `--yolo` GPTZero consent skip.
- Root-level STATE.json assertions after `new`.
- `PENSMITH_PAPER_ROOT` pointing at a `.paper`-style directory.
- The 11-probe doctor count.
- The per-test undici exemptions (moved behind V5).
- Exit-0 refusals.

## Deferred to later phases (not gaps in this phase)

- GRND-07 and GRND-13 prompt re-pins and outline/planner validation rules (Phase 18).
- GRND-19 prose stubs and the `.paper-dry-run/` scratch workspace (Phase 18).
- SRC-01 redirect following (Phase 19).
- VRFY-12 network-failure UNVERIFIABLE (Phase 20).
- EXP-17 persisted detector consent and EXP-21 aliases (Phase 21).
- REV-01 `--auto-revise` (Phase 22).
- PLUG-02 `plugin/` layout, PLUG-07 `paper_get_gates`, PLUG-13 stdout sink and PLUG-14 hooks (Phase 23).
- BRDTH-05 generated reference card (Phase 25).
- CI-12 cassette-refresh workflow and drift job, CI-13 real-output corpus, and HARDEN-02 live lane (Phase 26).
- REL-11 PRIVACY.md egress table (Phase 27).
