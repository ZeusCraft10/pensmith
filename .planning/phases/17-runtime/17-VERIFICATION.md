---
phase: 17-runtime
verified: 2026-09-28
verified_at_commit: 9d0c23d (+ PRD §14 atomic-write wording fix in the close commit)
status: gaps_found
score: 35/37 in-scope requirements met; 8/10 success criteria met (criterion 9 not met: CI-06 run not observed; criterion 10 out of scope)
gaps: [RUN-26 (prompt caching is a no-op), CI-06 (Node 22/24 × 3-OS CI run not observed)]
out_of_scope: [SWEEP-01]
---

# Phase 17: Tier-2 Runtime Foundations (RUNTIME): Verification

**Goal (ROADMAP):** the Tier-2 CLI talks to real services with a working model and reports honestly what it did (exit codes, offline banner, session log, `--show-prompts`). It keeps all paper state under `.paper/`. It gives later phases their foundations: a mock LLM, structured-output contracts, the gate registry, versioned config and frontmatter loaders, one library writer, a hardened http.ts, a synthetic dry-run provider and CI on supported Node versions.

**Result:** the goal is met on the real user path, with two gaps. 35 of the 37 in-scope requirements are met with test and user-path evidence. RUN-26 is not met because the system prompts carry per-call data, so prompt caching never hits. CI-06 is not met because no CI run exists for the Phase 17 code: the branch is 43 commits ahead of origin, and this workflow may not push. The Phase 17 roadmap box is therefore not ticked.

## 1. Gate (re-run at close, 2026-09-28, Node 22.22.2, Linux, as root)

| Step | Result |
|---|---|
| `npm run prebuild` | exit 0 |
| `npm run build` | exit 0 (8 s) |
| `npm run lint` | exit 0 (6 s) |
| `npm run typecheck` | exit 0 (6 s) |
| `npm run test:tier-contract` | exit 0: 54/54 pass |
| `npm test` | 1503 tests: 1502 pass, 1 fail. The failure is `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure", which is root-only: `chmod 0o500` does not stop root (documented in CLAUDE.md; it passes in CI as a normal user). No skips, no todos. |
| `npm run validate:manifests` | exit 0 (plugin.json, marketplace.json and .mcp.json valid) |
| `node scripts/e2e-smoke.mjs` | exit 0: PASS=10, FINDING=0, FAIL=0 |
| `git status --porcelain` after build | clean |
| `npm test` on a copy with freshly re-recorded Crossref cassettes (CI-07) | 1502/1503, with the same root-only case |
| Real data dir (`~/.local/share/pensmith`) | no file newer than the start of the gate run; `data-dir-fingerprint.mjs` identical before and after a direct `node --import tsx --test tests/intake-gitignore.test.ts` |
| `claude plugin validate .` (informational; not a Phase 17 requirement) | FAIL: `plugins[0] plugin.json → skills: Invalid input`. `plugin.json` is unchanged since before this phase. PLUG-01 and CI-05 (Phase 23) own this. |

## 2. User-path checks run at close

All runs used the built CLI (`dist/bin/pensmith.js`) or the installed tarball, in scratch folders under `scratchpad/p17/closer/acc/`, with an isolated `XDG_DATA_HOME` and `HOME` and no test context. The LLM was the RUN-21 mock (`npm run mock-llm`) configured through the global runtime.json. **Sources were live** over the network.

| # | Check | Observed |
|---|---|---|
| U1 | `pensmith stauts` in an empty folder | exit 2, `unknown command 'stauts'; did you mean 'status'?`, nothing created |
| U2 | `pensmith status --no-scor` | exit 2, unknown-option line |
| U3 | `pensmith new --yolo --from assignment.txt` | exit 0. `.paper/{STATE.json,config.toml,INTAKE.md,SESSION.log,COSTS.jsonl,.gitignore}` created; the project root holds only `.paper/` and assignment.txt. The captured request has `model: claude-opus-5`, `thinking` and `output_config.effort=medium`, `output_config.format` json_schema, and no temperature, top_p or top_k. |
| U4 | SESSION.log after `new` | `kind:"llm"` record: intake-clarifier, claude-opus-5, 1133 in / 276 out tokens, $0.012565, equal to the COSTS.jsonl entry. Sentinel key count: 0. |
| U5 | `PENSMITH_OFFLINE=1 pensmith resume --replay <intake id>` | exit 0. INTAKE.md is byte-identical (sha256 c299fd1b…). The mock request count did not change. |
| U6 | **Live** `pensmith research --yolo` | exit 0 in 8.5 s. 29 real sources: crossref 10, openalex 9, arxiv 10, pubmed 0, semanticscholar `failed (HTTP 429 after retries)` shown in RESEARCH.md and on stderr. `kind:"http"` records for api.crossref.org, api.openalex.org, export.arxiv.org, eutils.ncbi.nlm.nih.gov and api.semanticscholar.org. No fixture entries (vaswani2017, engel2009, `10.1234/example`, `10.0000/`). Judgment slugs ran on claude-haiku-4-5. LLM cost in SESSION.log equals the COSTS.jsonl sum ($0.028816). |
| U7 | `outline --yolo`, `plan 1`, `write 1` | exit 0. 3 sections registered; OUTLINE.md rendered from the validated object. |
| U8 | **Live** `verify 1` on a draft citing real DOIs (lin2022 10.1016/j.aiopen.2022.10.001, stahlberg2020 10.1613/jair.1.12007) | exit 0. Pass 1 **OK** for both (titleJW and authorJW 1.00). Freshness DOI HEAD ok. |
| U9 | Draft citing `[@ghost.2099]`: `verify 1`, then `compile --yolo`, then `done --yolo` | exits 4, 4, 4. FABRICATED row recorded. No `.paper/DRAFT.md` and no `export/`. |
| U10 | `status` with `LANG=en_US.UTF-8`, then `LANG=C` | ✓/⌽ glyphs and §, then the `[x]`/`[ ]` and `#` ASCII fallback. Title, class, `current:` line, `cost: $0.00 last session / $0.08 total (cap $5.00)`, `next:` line. |
| U11 | `status --config` | each value with its source (default/intake/config/global). Per-slug models: opus-5 for generation slugs, haiku-4-5 for judgment slugs, with effort shown as not sent for Haiku. |
| U12 | `--estimate` in a fresh folder with only the A1 assignment | rows for new, research, outline, plan/write/verify ×3, compile and done. Total **$1.55** (cap $5.00), well under $3.50. 0 mock requests, nothing created. |
| U13 | `PENSMITH_COST_CAP_USD=0.01 new --yolo --from assignment.txt </dev/null` | exit 5 with one line; 0 requests; nothing created |
| U14 | The same under a real pty, answering No | the Yes/No prompt says "would exceed your $0.01 cost cap … Continue?". Exit **5**, 0 requests. |
| U15 | `PENSMITH_COST_CAP_USD=0` and `=abc` on `plan 2` | exit 2 with one line; 0 requests. `status` shows `cap invalid`. |
| U16 | `PENSMITH_OFFLINE=1 status`, `PENSMITH_NO_LLM=1 status`, `doctor` | exactly one `OFFLINE MODE (reason: PENSMITH_OFFLINE=1)` line; one `LLM STUBBED` line; doctor shows `network: live`, or `network: OFFLINE (PENSMITH_OFFLINE=1)` when the variable is set |
| U17 | `open proj`, then read-only and mutating verbs from an empty folder | `status` prints the `(active paper "proj" at …)` banner. Bare `--yolo` and non-TTY `write 1` exit 2 naming `--paper "proj"` and `pensmith new`. Under a pty, bare `pensmith` asks `continue "proj" / start a new paper here`, and `continue` planned §2 of proj. |
| U18 | `--estimate` under a pty, answering No | exit 0, 0 requests; §1 (verified) has no rows |
| U19 | `add 10.1145/3442188.3445922 </dev/null` (live), then `add https://doi.org/10.1016/J.AIOPEN.2022.10.001` | `added bender2021; remap skipped (non-interactive); run pensmith add --remap bender2021 --section N`, then `already in library as lin2022.`. LIBRARY.json 30 entries = 30 bib entries; the library schema parses. |
| U20 | `--show-prompts plan 3` | `[show-prompts] POST …/v1/messages` plus the full body on stderr; the sentinel key appears 0 times on stderr and 0 times in SESSION.log |
| U21 | `--runtime ollama --model qwen2.5 plan 2` and `write 2` (global endpoint → mock on 127.0.0.1:18434) | POST `/v1/chat/completions`, model qwen2.5, **no Authorization header**, planner sent with `response_format`. DRAFT.md holds the mock reply. With the endpoint down: one line, `could not reach ollama at … (ECONNREFUSED) — start the server or fix "endpoint" in …/runtime.json`, exit 1. Doctor showed PASS once the endpoint was up. |
| U22 | `--runtime bogus write 2` | exit 2: `unknown provider 'bogus' … valid values: anthropic, openai, ollama, vllm, openai-compatible` |
| U23 | Piped `sketch` with `PENSMITH_PROMPT_MODE=numbered` / without it | answers every question and proceeds into intake, exit 0 / refuses before asking, naming the variable, exit 3, nothing created |
| U24 | `npm pack`, then `npm install -g --prefix <tmp>` of the tarball (0 files under `package/tests/`) | installed `pensmith --version` = `0.1.0-dev`. `--help` lists 16 verbs, the exit-code table and the environment. `doctor` gives 6 PASS, 5 WARN, 0 FAIL, with `Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local endpoint)`. The bin is a symlink, so the main guard works through it. |
| U25 | Installed `pensmith --dry-run --yolo`, looped from a fresh folder with the A2 (Icelandic sagas) assignment | 13 invocations reach `done`: new, then research (6 `10.0000/pensmith-dryrun.*` sources), outline, plan/write/verify ×3, compile, and done exports `export/DRAFT.md`. No ENOENT. The export has no dry-run or offline marker. |
| U26 | Installed `PENSMITH_OFFLINE=1 verify 1` | `offline fixtures are not shipped in the installed package; offline replay needs a source checkout`, exit 1, no VERIFICATION.md |
| U27 | **Installed, live** `verify 1` of real Crossref DOIs (RUN-05 live lane) | exit 0; Pass 1 OK for lin2022 and stahlberg2020 |
| U28 | MCP `initialize` through a symlinked package root | `serverInfo.name: "pensmith"` |
| U29 | A run killed with -9, then a new run (seen while testing U14) | `pensmith: cleared stale lock (pid 16751, started …) — process not running.` |
| U30 | `npm run cassettes:refresh -- --only crossref` in a clean `git archive` copy | 4 Crossref cassettes re-recorded (21.2, 35.0, 8.6 and 0.4 KiB, all under the cap); no contact email or key in any cassette. Cassette no-leak, size, provenance, crossref, add, research and offline-fail-closed: 44/44. Full suite: 1502/1503 (root-only case). |
| U31 | `plan 3` against a mock injecting 404 `model_not_found` | exit 1 with one line: `anthropic does not serve model "claude-opus-5" (HTTP 404 not_found_error) — change .paper/config.toml [runtime] model (or --model)`; no stack trace |

## 3. Requirements

| Req | Status | Evidence |
|---|---|---|
| RUN-01 | MET | U6 (live research from a clean env); `tests/live-default.test.ts` (dial recorder: crossref/openalex dialed, no cassette opened, no fixture written); `net-mode.test.ts` truth table; `run-tests-offline.test.ts`; `git grep PENSMITH_NETWORK_TESTS -- bin mcp hooks` → only `bin/lib/http-mock.ts` (chokepoint row `network-tests-seam`); PRD §14 amendment present |
| RUN-02 | MET | U16; `net-mode.test.ts` (banner copy, once per process); `doctor-probes.test.ts` network-mode; `offline-fail-closed.test.ts` markers; `zero-trace-export.test.ts` offline export has no marker; U25 export has no marker |
| RUN-03 | MET | `offline-fail-closed.test.ts` (fetchById miss, no record under another id, 10.1038/s41586-021-03819-2 → UNVERIFIABLE, `add 10.1093/nar/gkab1112` refuses, 0 offline research candidates, plagiarism 0 matches, honesty `score unavailable (offline)`); `egress-gate.test.ts`; `sources/*` tests |
| RUN-04 | MET | `egress-gate.test.ts` (OfflineEgressError with 0 dials; loopback LLM allowed and non-loopback refused while offline; `--dry-run` 0 dials; NO_LLM leaves sources live); `flags.test.ts` H3 dial recorder over research/add/verify with Pass 3/compile/done under both `--dry-run` and `PENSMITH_OFFLINE=1` |
| RUN-05 | MET | U24–U27; `installed-offline.test.ts`; `tests-path-at-runtime` chokepoint row; `dry-run-sources.test.ts` (corpus under templates/) |
| RUN-06 | MET | U3 (default claude-opus-5); `pricing.test.ts`, `llm-models.test.ts` (current prices dated, aliases with one warning, fallback price with one warning, config override); `git grep -nE "claude-(haiku\|sonnet\|opus)-4['\"]" -- bin templates tests README.md` → empty |
| RUN-07 | MET | `llm-providers.test.ts` (only OPENAI key → api.openai.com Bearer + gpt-6-astra; only ANTHROPIC key → claude-opus-5); `llm-ssrf-bypass.test.ts` (paper endpoint/api_key_env rejected naming the global file, global GITHUB_TOKEN rejected); `runtime.test.ts` precedence; `llm-doctor-probe.test.ts`; U24 "Set one of" line; U11 shows the value sources |
| RUN-08 | MET | U21, U22; `llm-providers.test.ts` (ollama/vllm/openai-compatible bodies, no auth when unset); `egress-gate.test.ts` + `ssrf-guard.test.ts` (metadata, fd00:ec2::254 and 10.x http refused; https private allowed and pinned; source fetch to loopback refused); `llm-doctor-probe.test.ts` (PASS/WARN); `--help` lists `--runtime`/`--model` |
| RUN-09 | MET | U9, U13, U22; `cli-exit-codes.test.ts` (fabricated DOI → 4/4/4 with no DRAFT/export; `done </dev/null` → 3; `n` → `export cancelled by user` 3; bare/next/resume propagate; outline 0 sections ≠ 0; EXIT_CODES table); `tier-contract/exit-parity.test.ts` (MCP `isError`) |
| RUN-10 | MET | U24, U28; `installed-bin.test.ts` (npm pack + `-g` install from a loopback registry, `--version`/`--help`/`doctor`, symlink or junction, MCP initialize over the linked root); `main-guard` chokepoint row. The Windows and macOS legs run in CI (see CI-06). |
| RUN-11 | MET | U1, U2; `unknown-verb.test.ts` (suggestion, nothing created, alias table dispatch, 16 verbs kept, bare/`--dry-run` still routed); `workflow-shell-fallbacks.test.ts` |
| RUN-12 | MET | U19, U23 (amended acceptance per D-17-36), U31 (`plan` + 404 → exit 1, one line naming the model and the config key); `noninteractive-prompts.test.ts` matrix (no `^\s+at .*\.js:\d+` lines); `llm-stop-reasons.test.ts` / `mock-llm.test.ts` (404 model_not_found → one line naming the model and `[runtime.slugs.<slug>] model`, exit 1) |
| RUN-13 | MET | U3; `intake-bootstrap.test.ts`, `legacy-layout-migration.test.ts` (move once with notice, router unchanged, second run silent, a non-pensmith STATE.json never touched); `state-json` and `config-toml` rows; workflows status/sketch/next name `.paper/STATE.json`; `tier-contract/paper-root.test.ts` (`paper://state` and `paper://section/3` on a CLI paper); PRD §13 amended |
| RUN-14 | MET | U17; `paper-root-resolver.test.ts` (resolver order, fresh folder with assignment starts a new paper with p2's files byte- and mtime-identical, exit 2 naming `--paper`, `--paper p2 write 1`, cwd wins, stale pointer cleared, run from inside `.paper/`); PRD §6 amended |
| RUN-15 | MET | U4, U6, U20; `llm-session-log.test.ts` (one record per call, cost equal to COSTS, sentinel absent, spill above 256 KiB, `session_bodies = "redacted"`); `http-session-records.test.ts` |
| RUN-16 | MET | U20; `show-prompts.test.ts` (mirror written before the server receives the request, for LLM, source GET, GPTZero preview and DDG queries, key never shown); `flags.test.ts` H2 asserts the mirrored content |
| RUN-17 | MET | U5; `replay.test.ts` (INTAKE.md and DRAFT.md byte-identical, `--model` replays, redacted refused, no inherited `--yolo`); `installed-offline.test.ts` replay; `extract-fixture.mjs` unit test. Whole-chain replay is GRND-18 by the requirement's own text. |
| RUN-18 | MET | U13, U14, U15; `cost-cap.test.ts` (precedence, `--yolo` never skips it, exit 5 with 0 requests, one `warn_at_usd` warning, session-only accounting, parallel reservations); no hard-coded 0.5 cap reader in `bin/` (grep); the config value reaches `assertBudget` (unit) |
| RUN-19 | MET | U10; `status.test.ts` (fixture with §1 verified, §2 writing, §3 planned: title, `current: §2 (write)`, ✓⌛⌽, cost line, `next: write §2`; LANG=C ASCII); `tier-contract/status-fields.test.ts` |
| RUN-20 | MET | U12, U18; `estimate-proceed.test.ts` (A1 total < $3.50, 0 requests; `y` dispatches exactly the next action; finished paper → `nothing left to run ($0.00)`); `estimator.test.ts` (haiku lowers the total in proportion, unknown model flagged `(fallback price)`) |
| RUN-21 | MET | `mock-llm.test.ts` (both shapes over the real transport, thinking ignored and billed as output, structured replies, scripting, fixtures, SSE, every failure kind, no listening socket after close); used standalone in U3–U21 |
| RUN-22 | MET | `lock-contention.test.ts` (40 in-process and 40 across 4 processes within 10 s; LockTimeoutError at timeoutMs ±20% naming path and PID); `wave-write-cli.test.ts` (10 sections at `--max-parallel 10` against the mock, no ELOCKED). Windows and macOS legs: see CI-06. |
| RUN-23 | MET | U29; `session-lock.test.ts` (second `write 1` refused with the holder PID; `cleared stale lock` after kill -9; MCP-style 3 parallel sections and 2 serialized writes to one section; status works while held; mutating MCP tool refused with no file changed); `hooks/stop.test.ts`. PLUG-07 repeats this with `paper_submit_draft` (Phase 23). |
| RUN-24 | MET | U3; `llm-stop-reasons.test.ts` (refusal → `provider refused (category: …)`, exit 1, nothing written; one retry on max_tokens, a second truncation fails with nothing persisted; OpenAI `length` and `content_filter`); `llm-models.test.ts` / `llm-providers.test.ts` (no sampling params, no budget_tokens, no prefill; no effort for Haiku); `mock-llm.test.ts` (thinking block parsed, thinking tokens priced as output) |
| RUN-25 | MET | `llm-contracts.test.ts` (the schema in each structured slug's Anthropic, OpenAI strict and Ollama body comes from its zod schema, and a schema change changes all three; tolerant parser; exactly one corrective retry; OUTLINE.md and PLAN.md rendered from validated objects); U3 and U21 captured bodies. Ollama uses `response_format` on its OpenAI-compatible endpoint (see SUMMARY, deviations). |
| RUN-26 | **NOT MET** | Met: the per-slug table (U6, U11, `llm-models.test.ts`, `llm-providers.test.ts`); `[runtime.slugs.pass2]` changes only Pass 2; `--model` changes only generation slugs; `status --config` shows each slug's source; projection from p90 (`estimator.test.ts`); A1 estimate $1.55 < $3.50 (U12). **Gap:** the criterion "stable system prompts use prompt caching" does not hold in practice. `cache_control` is sent on the system block, but every template interpolates per-call data (planner and drafter embed the sources three times), so no request shares a cacheable prefix. The default judgment model's minimum cacheable prefix (4096 tokens) is also above every template size (about 700–900 tokens). Round 3 confirmed this and deferred it. The live-lane criterion (a §15 paper under $5 with 30% margin, plus a published cost table) is a HARDEN-02 run (Phase 26) by the requirement's own text. |
| RUN-27 | MET | U25; `dry-run-sources.test.ts` (≥5 synthetic sources, 0 sockets; the offline equivalent returns 0; the installed package resolves the corpus); `dry-run-boundary.test.ts` (dry-run DOI OK only under `--dry-run`, FABRICATED otherwise with compile and done exit 4; refusal over a real paper; marker; purge of leftovers) |
| RUN-28 | MET | U13, U14, U17, U23; `gates-registry.test.ts` (enumerates GATES and drives each without a terminal, with and without `--yolo`; cost-cap, estimate-proceed, detector-consent and paper-pointer are never skipped; PRD §7.20 drift test). PLUG-10 and PLUG-15 iterate the registry for Tier 1 in Phase 23. |
| RUN-29 | MET | `chokepoints.test.ts` (13 rows, each with a failing fixture, each listed in CLAUDE.md); no new `eslint-disable` (the only phase-added occurrence is inside the `.violation.ts.txt` fixture; the baseline of 12 is exact); the only network-import exemption under `tests/` is `tests/helpers/local-servers/`; `npm run lint` green. Rows for chokepoints owned by later requirements (VRFY-09, GRND-06, PLUG-13, PLUG-06, PLUG-02) are listed as "enforced from <REQ>" per D-17-44; there are no bundles yet. |
| CONF-01 | MET | U11; `config.test.ts` (v0 → v1 write-back keeps comments; newer version refused; `verify_quotes` rejected with §14; unknown keys warned and kept; read-only runs migrate in memory only); `config-drift.test.ts` (PRD §10 block ↔ schema); `config-toml` row; `migrations.test.ts` |
| CONF-04 | MET | `frontmatter-versioning.test.ts` (legacy PLAN.md → `schema_version: 1` with every other byte kept, LF and CRLF; newer → `upgrade pensmith`; CLI verify writes back); `migrations.test.ts` (plan, config, plus the registered intake/draft/verification kinds); `frontmatter-roundtrip.test.ts`. The intake/draft/verification deferral is amended into the acceptance (D-17-38). |
| BRDTH-01 | MET | U6, U19 (schema parses after live research; `already in library as lin2022` with the count unchanged); `library-writer.test.ts` (DOI/arXiv/PMID/ISBN dedup, preprint and version-of-record collapse keeping both DOIs and provenance, 5 concurrent upserts lose nothing, non-Latin BibTeX round trip); `library.test.ts` migration; `library-writer` row; `paper://library` via the tier contract |
| SEC-01 | MET | `ssrf-pinning.test.ts` (a resolver flipping public → 127.0.0.1 dials the validated IP; SNI server reached with the hostname as SNI/Host; cert verification on; `maxRedirections: 0`; no `void Agent`); the configured LLM endpoint is allowlisted and pinned (`egress-gate.test.ts`); SECURITY.md row 2a PROVEN. Live-lane Crossref calls through the pinned transport succeeded in U6, U8 and U27. |
| SEC-03 | MET | `response-size-cap.test.ts` (60 MB stream aborted at 8 MiB with bounded memory; content-length refused up front; per-call PDF cap; LLM 16 MiB; fixture replay capped; every adapter passes a cap; the arxiv.ts TODO is gone); SECURITY.md row 25 PROVEN |
| CI-06 | **NOT MET** | Met: `engines.node >=22.12.0` and `@types/node ^22.12.0`; ci.yml matrix `node: ['22','24']` × ubuntu/macOS/Windows; `grep -rn "node-version: .*20" .github/` is empty; cassette-refresh.yml uses Node 24; doctor FAILs below 22.12 (`node-version-probe.test.ts`); CLAUDE.md, README and CONTRIBUTING state 22.12. **Gap:** the acceptance "the ci.yml matrix … is green" has no evidence. The Phase 17 commits have never been pushed (43 ahead of origin) and this workflow may not push. |
| CI-07 | MET | U30 (`cassettes:refresh -- --only crossref` works locally with network access and the contact email; no-leak, cap and offline suites pass on the output); `cassette-provenance.test.ts` (real recordings for all 7 adapters; provenance; no error-in-200 documents; synthetic IDs only under `synthetic/`; `OPEN_RECORDINGS` empty). The GRND-18 / HARDEN-01 e2e corpus is recorded by those requirements with this recorder. |
| CI-09 | MET | §1 real data dir unchanged; `data-dir-isolation.test.ts` (test context → per-process temp dir; spawned CLI with `PENSMITH_TEST=1` leaves the real dir untouched; direct run of intake-gitignore adds nothing); `registry-gc.test.ts` passes; the ci.yml fingerprint step runs before and after `npm test` on each OS |
| SWEEP-01 | OUT OF SCOPE | Owned by the separate `v1/sweep-01` workflow. It was merged into planning at 1d38094, which marked it Complete (`.planning/research/V1-STUB-SWEEP.md`, SWP-1..133 in the register). This phase did not touch it. |

## 4. ROADMAP success criteria

| # | Criterion (abridged) | Status | Evidence |
|---|---|---|---|
| 1 | Live by default; offline only under OFFLINE, dry-run or the test runner, announced and marked (never in exports); a miss is UNVERIFIABLE; mock LLM reachable under the test runner; NO_LLM orthogonal; dry-run opens 0 sockets and gives synthetic sources for any topic | MET | RUN-01..05, RUN-27; U6, U16, U25 |
| 2 | Only ANTHROPIC key → claude-opus-5; thinking parses; refusal exits 1; max_tokens never persisted; native structured output from one zod schema; every model prices; judgment slugs cheaper; `--estimate` §15 under $5 with ≥30% margin | MET | RUN-06, RUN-07, RUN-24, RUN-25; U3, U6, U12 ($1.55) |
| 3 | `--runtime ollama` / openai-compatible against a local server; paper config cannot set endpoint or key; metadata endpoints refused; sources cannot reach loopback; IP pinned; oversized responses aborted | MET | RUN-07, RUN-08, SEC-01, SEC-03; U21, U22 |
| 4 | Documented exit codes; no stack traces; typo'd verb suggests and creates nothing; one gate registry matching PRD §7.20 | MET | RUN-09, RUN-11, RUN-12, RUN-28; U1, U9, U13, U14 |
| 5 | `npm i -g` and `npm link` give a working `pensmith` and an MCP server through symlinks; the package never reads tests/ | MET (Linux) | RUN-05, RUN-10; U24–U28. The macOS and Windows legs are pending the CI run (CI-06). |
| 6 | State under `.paper/` (legacy migrates once); config and frontmatter carry `schema_version` and migrate; LIBRARY.json validates with one writer; `open` semantics | MET | RUN-13, RUN-14, CONF-01, CONF-04 (amended deferral), BRDTH-01; U3, U17, U19 |
| 7 | SESSION.log records with no secrets; `--show-prompts` before sending; replay offline; cost cap exit 5 without a TTY; status meter | MET | RUN-15..RUN-19; U4, U5, U10, U13, U20 |
| 8 | 40 contenders; second session refused with the PID while per-section sub-locks run in parallel; mock LLM in the current shapes | MET | RUN-21, RUN-22, RUN-23 |
| 9 | Every new chokepoint in CLAUDE.md, enforced without eslint-disable; **CI runs on Node 22 and 24**; no test touches the real data dir; `cassettes:refresh` re-records locally | **NOT MET** | Everything holds except the CI run itself: the matrix is configured but no run has been observed (CI-06) |
| 10 | Stub-sweep verdicts for the 158 prior requirements, mapped | OUT OF SCOPE | SWEEP-01 (separate workflow; recorded Complete at 1d38094) |

## 5. Gaps and what closes them

1. **RUN-26: effective prompt caching.** Restructure the templates so the stable instruction text comes first and the per-call data comes last, sent once. That also removes the threefold library duplication in section-planner and source-evaluator. Mark the stable prefix with `cache_control`. Re-pin `EXPECTED_PROMPT_HASHES` and `tests/repo-files.test.ts`. Prove it with a mock-captured `cache_read_input_tokens > 0` on a repeated generation call. The natural home is Phase 18, which re-pins the prompts for GRND-07 and GRND-13 anyway. The live-lane cost table remains HARDEN-02's job (Phase 26).
2. **CI-06: observed 6-leg CI.** Push the branch (the maintainer) and record the first green `ci.yml` run on Node 22 and 24 × ubuntu/macOS/Windows. That run also gives the cross-OS evidence for RUN-10, RUN-22, RUN-23 and CI-09 (installed bin, lock contention, session lock, data-dir fingerprint), which pass locally on Linux.

## 6. Observations for later phases (not Phase 17 gaps)

- `claude plugin validate .` fails on the `plugin.json` `skills` shape. This predates the phase and belongs to PLUG-01 and CI-05 (Phase 23).
- The Source Freshness table prints a `DOI HEAD | ok` row for a citekey with no DOI (for example a fabricated key that is not in the bib), because no probe runs and no row is skipped. It is advisory only (Pass 1 still blocks), but misleading. It belongs with the freshness rework in Phase 20 (VRFY).
- Semantic Scholar keyless answered HTTP 429 in the live run. It is correctly reported as `failed (HTTP 429 after retries)`. Rate-limit handling is SRC-17 (Phase 19).
- Test processes launched through tsx still print the Node DEP0040 punycode warning in the TAP log. The shipped CLI and MCP server filter it (`node-warnings.ts`), so this is cosmetic.
