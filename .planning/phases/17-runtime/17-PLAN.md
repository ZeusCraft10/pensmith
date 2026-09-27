# Phase 17: Tier-2 Runtime Foundations (RUNTIME) — Plan

**Milestone:** v1.0.0 Open Source Release · **Base commit:** `8dc75b4eaa06dc110ad2239b872d53bdcb42d602` · **Branch:** `akhil/pensive-faraday-qx3o58`
**Decisions:** [17-CONTEXT.md](17-CONTEXT.md) (D-17-01..D-17-45) · **Verbatim seam files:** [seams/](seams/)

## 1. Goal

The Tier-2 CLI talks to real services with a model that works. It tells the truth about what it did: exit codes, the offline banner, the session log and `--show-prompts`. It keeps all paper state under `.paper/`. It also gives every later phase the foundations it consumes: a deterministic mock LLM, structured-output contracts, the gate registry, versioned config and frontmatter loaders, the single library writer, the hardened http.ts transport, a synthetic dry-run provider, and CI on supported Node versions (ROADMAP Phase 17 success criteria 1–9).

**SWEEP-01 is excluded.** A separate workflow runs it on `v1/sweep-01`, and it stays Pending here. Criterion 10 belongs to that workflow.

## 2. Requirements and owning streams

| Stream | Requirements |
|---|---|
| **egress** | RUN-01, RUN-02, RUN-03, RUN-04, RUN-05, RUN-16, RUN-27, SEC-01, SEC-03, CI-07 (plus the `http.ts` half of RUN-08 and RUN-15) |
| **llm** | RUN-06, RUN-07, RUN-08, RUN-15, RUN-17, RUN-18, RUN-19, RUN-20, RUN-21, RUN-24, RUN-25, RUN-26, CONF-01 |
| **paper-cli** | RUN-09, RUN-11, RUN-12, RUN-13, RUN-14, RUN-23, RUN-28, CONF-04 |
| **foundations** | CI-06, CI-09, RUN-10, RUN-22, RUN-29, BRDTH-01 |

37 requirements. Every one has exactly one owning stream, which closes it. Where a requirement needs a small edit in a file another stream owns, §4.3 names the region.

## 3. Design summary

The decisions live in 17-CONTEXT.md. The load-bearing ones:

1. **Three orthogonal modes, one gate (D-17-04/05/06).**
   - The mode is decided only in `http-mock.ts`, the documented test-lane seam.
   - Every request passes one gate in `http.ts` `callOnce`, in this order: mode, exact-fixture replay or refusal, DNS resolve and validate, IP pin, mirror, capped body stream, http record.
   - Adapters lose their offline branches and fallbacks.
   - A fixture miss is `OfflineEgressError`, which Pass 1 records as a blocking `UNVERIFIABLE`.
2. **Models that work (D-17-17..24).**
   - One model and per-slug table. Claude responses are parsed block-wise, and every stop reason is handled.
   - Structured slugs use native structured output generated from one zod schema.
   - Judgment slugs run on Haiku 4.5, the session cap is enforced per call, and the estimator projects from per-slug p90s.
   - All providers, OpenAI-compatible and Ollama included, stay in `anthropic.ts`. The LLM endpoint is allowlisted only in `http.ts`.
3. **One paper root (D-17-32/33).** STATE.json moves to `.paper/`, with a one-time legacy move. `projectRoot()` returns the resolved active paper. The `open` pointer is honored for read-only verbs, and never for `--yolo`, the MCP server or hooks.
4. **Honest CLI contract (D-17-34/35/36/37).** Documented exit codes. One-line failures. Unknown verbs and flags are rejected. One gate registry decides what `--yolo` may skip. A real session lock.
5. **Foundations (D-17-38..44).** Versioned config and frontmatter, one library writer, Node 22/24, isolated test data dirs, a symlink-safe main guard, lock contention fixed, and a data-driven chokepoint rule and harness.

## 4. Parallel execution protocol

### 4.1 Streams and the ownership rule

- The four streams run in parallel in separate worktrees created from the base commit.
- A stream may edit only its **owned paths** (§5), the **hot-file regions** assigned to it (§4.3), and the **seam files** (§4.2), and only by applying the seams verbatim.
- A stream may call only APIs that exist at the base commit, APIs it creates itself, and seam APIs. It never calls a new API that another stream creates. That rule is what lets each worktree typecheck and test on its own.
- Each stream must end with `npm run prebuild && npm run lint && npm run typecheck && npm run build && npm test` green in its own worktree. The known root-only `atomic-write` chmod case is the only exception (CLAUDE.md gotcha).
- Each stream commits with `feat(17-<stream>): …` / `fix(17-<stream>): …` / `test(17-<stream>): …` plus the two trailer lines. Nothing is pushed.

### 4.2 Verbatim seam files (D-17-02)

These were typechecked and linted against the base commit. Apply them **unchanged**. Do not edit a seam file, or any line within 3 lines of a seam hunk, during Phase 17.

| Seam | Target | Source in this directory | sha256 of the file after applying | Needed by |
|---|---|---|---|---|
| V1 | `bin/lib/exit-codes.ts` (new) | `seams/V1-exit-codes.ts.txt` (copy) | `83d2a6638ea3214d7ed17445730905ddc1fe1b3c0c7e62c0e093f038e88a2442` | all four (owner: paper-cli) |
| V2 | `bin/lib/gates.ts` (new) | `seams/V2-gates.ts.txt` (copy) | `abb182c5583ac5a193f8746e86065c86d1a18b5c8c4d1d75bafce6f6ad534fa4` | paper-cli (owner), llm (cost-cap, estimate-proceed), egress (detector-consent) |
| V3 | `FetchOptions.llm` + `FetchOptions.maxBytes` in `bin/lib/http.ts` | `seams/V3-http-fetch-options.patch` (`git apply`) | — | egress (owner), llm |
| V4 | `'llm' \| 'http'` kinds, `llm()`/`http()` methods, `isMirrorPromptsEnabled()` in `bin/lib/session-log.ts` | `seams/V4-session-log.patch` | — | llm (owner), egress |
| V5 | `tests/helpers/local-servers/mock-agent.ts` (new) | `seams/V5-mock-agent.ts.txt` (copy) | `0a5253f49a07ecd6d6039d87934f7a244c198f7d59ee90642b0120647dd303f7` | egress (owner), llm |
| V6 | local-servers exemption block in `eslint.config.js` | `seams/V6-eslint-local-servers.patch` | — | egress, llm (owner of the file: foundations) |

Apply with `cp .planning/phases/17-runtime/seams/V1-exit-codes.ts.txt bin/lib/exit-codes.ts` (and likewise for V2 and V5), and `git apply .planning/phases/17-runtime/seams/V3-http-fetch-options.patch` (and likewise for V4 and V6). Apply the patches before any other edit to the target file. Two branches that add identical content, or change a hunk identically, merge cleanly.

Seam semantics every stream relies on:
- **V1.** `EXIT_*` constants, `EXIT_CODES` doc table, `PensmithError(message, exitCode)`. Expected failures throw a `PensmithError` subclass, and the dispatcher prints one line and exits with its code.
- **V2.** `runGate(id, {yolo, question?, detail?})` returns `{kind:'answered'|'yolo'|'skipped'}` or throws `GateRefusedError` with the gate's exit code. `declineGate(id, msg)` throws the decline code. `canPrompt()` is true when stdin is a TTY, or when `PENSMITH_PROMPT_MODE=numbered`.
- **V3.** Only `anthropic.ts` sets `llm: {endpoint}`. `maxBytes` caps a response.
- **V4.** Kind-specific logic goes in `buildRecord`/`emit`, never in the method table.
- **V5.** Under the test runner, MockAgent interception of a non-loopback host needs `PENSMITH_NETWORK_TESTS=1` for that test.

### 4.3 Hot files and region ownership

| File | Main owner | Other streams' localized regions |
|---|---|---|
| `bin/pensmith.ts` | paper-cli: renames `dispatch` to `dispatchInner` (signature line only) and inserts its pre-flight block **between** that line and the `// (a)` comment; owns block `(e)` and everything after it inside `dispatchInner`, `firstVerb`/`hasFlag`/`READ_ONLY_VERBS`/`SECTION_SCOPED_VERBS`, `REAL_VERB_LOADERS`, `dispatchVerb`, `command.meta`, all existing `command.args` descriptions and a new first `paper` arg, and a new exported `dispatch()` wrapper placed **immediately above** the `// CLI-style invocation` comment | **egress:** blocks `(a)` and `(b)` only (dry-run env lines, `announceModes` call right after the `(b)` closing brace; keep the one blank line before `// (c)`). **llm:** a new `(b2)` block inserted directly above the `// (c)` comment, plus blocks `(c)` and `(d)`; appends `runtime` and `model` after the `'show-prompts'` arg entry. **foundations:** the last lines only (`import { pathToFileURL } …` / `if (import.meta.url === …)`, replaced by the `isMainModule` guard; the body stays `void dispatch();`) |
| `bin/cli/research.ts` | paper-cli (gates Steps 4 and 6, exit codes, `projectRoot()`) | **llm:** the GEN-06 key-probe block (becomes one `assertLlmConfigured('research')` line) and Steps 2–3 (disambiguator call and parse). **foundations:** Step 7 (the LIBRARY/bib/ris writes become `upsertSources`) |
| `bin/cli/add.ts` | paper-cli (remap gate, exit codes, `projectRoot()`) | **egress:** the DOI verification and offline/dry-run/reserved-id refusals. **foundations:** the CITATIONS.bib write block (becomes `upsertSources`, and `already in library as <key>`) |
| `bin/cli/verify.ts` | paper-cli (exit codes, frontmatter loader) | **egress:** the first line of the VERIFICATION.md `lines` array (the marker) and the status computation for `UNVERIFIABLE` |
| `bin/cli/done.ts` | paper-cli (export gate, exit codes) | **egress:** the marker in `.paper/VERIFICATION.md` and the UNVERIFIABLE block in the re-check |
| `bin/lib/compile.ts` | paper-cli (paper-root calls, frontmatter loader) | **egress:** the refuse-gate verdict set (adds `UNVERIFIABLE`, "re-run online"). **foundations:** `regenerateBib` stops writing `.paper/CITATIONS.bib` |
| `bin/cli/write.ts` | paper-cli (exit codes, `projectRoot()`, frontmatter loader) | **llm:** the `complete({...})` call literal (adds `slug`) |
| `bin/cli/intake.ts`, `bin/cli/outline.ts`, `bin/cli/plan.ts`, `bin/cli/resume.ts` | llm | **paper-cli:** `process.cwd()`→`projectRoot()`, exit codes (intake: no assignment in a non-TTY run → EXIT_USAGE; outline: 0 sections → EXIT_ERROR), the outline approval gate function, resume exit propagation |
| `bin/cli/revise.ts` | paper-cli | **llm:** the GEN-06 probe block |
| `bin/lib/research-orchestrator.ts` | egress | **llm:** the source-evaluator function (its `complete()` call and the response parse) |
| `bin/lib/paths.ts` | paper-cli | **foundations:** the bodies of `localDataDir`/`pensmithDataDir` (CI-09) |
| `mcp/server.ts` | paper-cli | **foundations:** the last lines (main guard) |
| `mcp/resources.ts` | paper-cli | **llm:** the `paper://state` handler body (returns the RUN-19 status view) |
| `bin/lib/doctor/probes.ts` | — | **egress:** import and list entry for `networkModeProbe`, placed directly after `contactEmailPresenceProbe` |
| `eslint.config.js` | foundations (plugin rule, fixture ignores) | **egress/llm:** V6 (verbatim); remove only their own test files from the existing per-test exemption lists |
| `package.json` | foundations (engines, `@types/node`, `test:tier-contract`, `check`, the lockfile) | **egress:** one `scripts` line `cassettes:refresh`, inserted after `test:cassettes`. **llm:** one `scripts` line `mock-llm`, inserted after `pensmith`. No other stream changes dependencies or the lockfile |
| `PRD.md` | — | section-local: egress §14 "Cassette-based source tests" bullet; llm §10 and §7.19; paper-cli §6, §7.20, §13 and §14 "Schema versioning" bullet |
| `tests/tier-contract.test.ts` | paper-cli | **egress/llm:** edit only the cases their change breaks. New parity cases go in new files under `tests/tier-contract/` |
| `tests/flags.test.ts` | egress | **llm:** only the H1/estimate cases. **paper-cli:** only the dispatch/C3/C6 cases |
| `tests/migrations.test.ts` | paper-cli (frontmatter cases, inserted after the imports) | **llm:** a `config.toml migrations` block appended at the end of the file |
| `tests/doctor-probes.test.ts` | egress (probe count) | — |

Import-block conflicts in these files are expected and trivial. The merger keeps the union of the imports.

### 4.4 Test rules

- Prefer new test files. Edit an existing test only where your change breaks it, and only the affected case.
- An existing assertion that encodes superseded behaviour (see 17-CONTEXT "Tests that encode superseded behaviour") is rewritten to assert the new behaviour and named in the stream summary. Never skip it, never todo it, never loosen it.
- No test may reach the real data dir. Use temp dirs and `XDG_DATA_HOME`/`LOCALAPPDATA`/`HOME` under `os.tmpdir()`. Those three test-only env writes keep using the existing narrowly scoped eslint exemption groups. Add your new test file to a group rather than using `eslint-disable`.
- Tests that spawn `dist/` need `npm run build` first (CLAUDE.md).
- Every local server lives in `tests/helpers/local-servers/` (D-17-03). Every MockAgent use goes through V5.

### 4.5 Merge order and post-merge integration

- Suggested merge order: **foundations → paper-cli → egress → llm**. The later streams touch the most hot regions and resolve against the settled dispatcher. Any order works if the conflict rule holds: take both sides' region edits, and the union of the imports.
- After all four merges, run §6 in full, then `npm run check`.
- **Integration checklist.** Each item verifies a seam that no single worktree could test end to end:
  1. The mock LLM (llm) under the test runner, through the `http.ts` gate (egress): the loopback LLM is allowed while sources are offline, refused under `--dry-run`, and dials are pinned to 127.0.0.1.
  2. `complete()` sets `llm`/`maxBytes` (V3), and `http.ts` enforces them (§6 RUN-08, SEC-01, SEC-03 checks).
  3. `--show-prompts` prints the LLM body before the mock receives the request (RUN-16 check).
  4. `kind:"llm"` and `kind:"http"` records both land in `.paper/SESSION.log` of the resolved paper (RUN-15).
  5. The cost-cap and estimate-proceed gates (llm) and the detector-consent gate (egress) come from V2, and the registry enumeration test (paper-cli) covers them.
  6. `upsertSources` (foundations) is the only writer after research and add.
  7. The chokepoint rows written by every stream are enforced by the foundations rule. `npm run lint` is clean, with no `eslint-disable`.
  8. The tier-contract suite passes with `.paper/STATE.json` and with MCP `isError` parity.
  9. The offline research tier-contract and research-discovery cases use exact recorded queries.

## 5. Streams

### 5.1 Stream `egress` — network modes, the hardened transport, fixtures, dry-run sources, recorder

**Goal:** A real user is live by default. Offline and dry-run are explicit, disclosed and fail closed. Every byte leaves through one pinned, size-capped, mirrored, logged gate in `http.ts`.

**Requirements:** RUN-01, RUN-02, RUN-03, RUN-04, RUN-05, RUN-16, RUN-27, SEC-01, SEC-03, CI-07.

**Owned paths:**
- Transport and mode: `bin/lib/http.ts`, `bin/lib/http-mock.ts`
- Sources and verification: `bin/lib/sources/`, `bin/lib/doi.ts`, `bin/lib/plagiarism.ts`, `bin/lib/honesty.ts`, `bin/lib/verify/pass1.ts`, `bin/lib/verify/pass3.ts`, `bin/lib/verify/freshness.ts`, `bin/lib/verify/verdict-rows.ts`, `bin/lib/research-orchestrator.ts`, `bin/lib/compile-report.ts`, `bin/lib/pdf-text.ts`, `bin/lib/retry.ts`
- Doctor probes: `bin/lib/doctor/probes/network-mode.ts` (new), `bin/lib/doctor/probes/http-crossref-ping.ts`
- Assets, fixtures and scripts: `templates/dry-run/` (new), `tests/fixtures/cassettes/`, `tests/fixtures/http-cassettes/`, `tests/fixtures/tls/` (new), `scripts/refresh-cassettes.mjs` (new)
- Test helpers: `tests/helpers/local-servers/mock-agent.ts` (V5 owner), `tests/helpers/local-servers/transport.ts` (new), `tests/helpers/local-servers/dial-recorder.mjs` (new)
- Chokepoint rows: `scripts/chokepoints/network-tests-seam.json`, `scripts/chokepoints/tests-path-at-runtime.json`, `scripts/chokepoints/tests-network-imports.json`, and their `tests/fixtures/chokepoints/<id>.violation.ts.txt` fixtures
- Security rows: `.planning/SECURITY.md`
- Existing tests: `tests/http.test.ts`, `tests/http-cache.test.ts`, `tests/http-cache-no-header-leak.test.ts`, `tests/http-binary-body.test.ts`, `tests/http-mock.test.ts`, `tests/retry.test.ts`, `tests/retry-after-cap.test.ts`, `tests/token-bucket-fairness.test.ts`, `tests/ssrf-guard.test.ts`, `tests/sources/`, `tests/cassette-no-leak.test.ts`, `tests/cassette-size.test.ts`, `tests/plagiarism.test.ts`, `tests/honesty.test.ts`, `tests/freshness-probe.test.ts`, `tests/gate-retraction.test.ts`, `tests/known-bad-citations.test.ts`, `tests/known-bad-quotes.test.ts`, `tests/research-discovery.test.ts`, `tests/research-sentinel.test.ts`, `tests/add-source.test.ts`, `tests/add-url-pdf.test.ts`, `tests/verify-citekey-extraction.test.ts`, `tests/verdict-rows.test.ts`, `tests/doi.test.ts`, `tests/doi.property.test.ts`, `tests/pdf-text-bounds.test.ts`, `tests/zero-trace-export.test.ts`, `tests/flags.test.ts` (main), `tests/doctor-probes.test.ts`
- New tests: `tests/net-mode.test.ts`, `tests/egress-gate.test.ts`, `tests/ssrf-pinning.test.ts`, `tests/response-size-cap.test.ts`, `tests/offline-fail-closed.test.ts`, `tests/dry-run-sources.test.ts`, `tests/live-default.test.ts`, `tests/installed-offline.test.ts`, `tests/show-prompts.test.ts`, `tests/cassette-provenance.test.ts`, `tests/http-session-records.test.ts`
- Hot regions: see §4.3

**Tasks:**
1. **Seams.** Apply V3 (owner), V4, V5 (owner) and V6.
2. **Mode module (RUN-01, D-17-04).** In `http-mock.ts`:
   - Add `networkMode()`, and keep `isOfflineMode()` as a wrapper around it.
   - Detect the test context from `NODE_TEST_CONTEXT` or `PENSMITH_TEST=1`. `PENSMITH_NETWORK_TESTS=1` turns sources live only inside a test context. This is the only read of that variable in `bin/`.
   - Add `offlineMarkerLine()`, `llmStubbedBanner()` and `announceModes({verb})`. `announceModes` prints the RUN-02 banners once, before any other output, and applies the installed-package refusal (D-17-15; read-only verbs are exempt).
   - Delete the nock `loadCassettes`/`clearCassettes`/`recordCassettes`/`finalizeRecording` code and its `eslint-disable`.
   - Unit-test the RUN-01 truth table.
3. **Dispatcher (a)/(b) (RUN-01, RUN-02).** `--dry-run` sets `PENSMITH_DRY_RUN=1` and `PENSMITH_NO_LLM=1` only. Remove the `PENSMITH_NETWORK_TESTS` write. Call `announceModes({ verb: firstVerb(argv) })` right after block (b).
4. **One gate in `callOnce` (RUN-04, SEC-01, SEC-03, RUN-08 transport half, D-17-05/09).**
   - `checkSsrf` returns the validated addresses, and runs for every request.
   - The pinned per-request dispatcher's `connect` dials the validated IP, with `servername` set to the hostname. Assert `maxRedirections` is 0. Delete `void Agent`.
   - Stream the body with a `maxBytes` abort, throwing `ResponseTooLargeError`. Pass per-call caps from every adapter: JSON 8 MiB, PDF `MAX_PDF_BYTES`, LLM 16 MiB.
   - Enforce the LLM policy for `opts.llm`.
   - In sources-offline and dry-run modes the HTTP cache is neither read nor written. Offline never serves the live cache.
   - Test seams, active only under a test context: an injectable resolver, TLS trust for the local SNI server, and use of an installed global MockAgent (V5). The gate still runs first.
   - Export `OfflineEgressError` and `ResponseTooLargeError`.
5. **Exact-fixture store (RUN-03, D-17-06).** Replay by canonical key from `tests/fixtures/cassettes/<adapter>/` and `…/synthetic/<adapter>/`, and throw `OfflineEgressError` on a miss.
   - Remove every adapter offline branch and first-item fallback.
   - Adapters rethrow `OfflineEgressError` instead of swallowing it.
   - plagiarism: offline gives `skipped (offline)` with 0 matches.
   - honesty: offline gives `score unavailable (offline)`, never a number. It goes through the V2 `detector-consent` gate (D-17-16).
   - freshness HEAD probe: `skipped (offline)`.
6. **Pass 1 and Pass 3 (RUN-03, RUN-04, D-17-07).**
   - Add the `UNVERIFIABLE` verdict to pass1, verdict-rows render and parse, and the VERIFICATION.md reason `offline: no recorded fixture — re-run online` (or `dry-run`).
   - Pass 3 reports the text as unavailable (offline or dry-run).
   - verify status becomes `unverifiable` (verify.ts region).
   - The compile refuse-gate and done re-check block on UNVERIFIABLE (their regions). A section with `Status: unverifiable` and zero rows still passes (Pitfall 3).
7. **add (RUN-03, RUN-04, RUN-27; add.ts region).** Offline or dry-run `add <doi>` verifies nothing and adds nothing. Offline exits non-zero (`EXIT_ERROR`, V1) with `DOI verification unavailable (offline)`; `--dry-run` reports `unavailable (dry-run)`. A reserved dry-run id outside dry-run is refused.
8. **Synthetic dry-run provider (RUN-27, D-17-11).**
   - `bin/lib/sources/dry-run.ts` plus `templates/dry-run/corpus.json`.
   - `doi.ts` `isReservedDryRunId()`.
   - The orchestrator uses only this provider in dry-run, and filters reserved ids outside it.
   - Pass 1 and Pass 3 accept reserved ids only in dry-run. Outside it they are FABRICATED with the reason `reserved dry-run identifier`.
   - Every synthetic source carries `synthetic: true` and the dry-run marker in RESEARCH.md.
9. **RESEARCH.md and markers (RUN-02, D-17-08, D-17-10).**
   - The orchestrator writes `.paper/RESEARCH.md`, and prints `offline: no recorded results for this query` on a miss.
   - The marker goes into the section VERIFICATION.md (verify.ts region), `.paper/VERIFICATION.md` (done.ts region) and the COMPILE-REPORT.md body (`compile-report.ts`).
   - `tests/zero-trace-export.test.ts` gains an offline-export case that asserts no marker.
10. **`--show-prompts` (RUN-16, D-17-12).** The mirror in `callOnce` runs before dispatch and uses V4 `isMirrorPromptsEnabled()`. Test source URLs (research), the GPTZero body preview and DDG queries (done), that a sentinel key never appears, and that the mirror line precedes the request (use a local server from `transport.ts`). Upgrade `flags.test.ts` H2 to assert the mirrored content.
11. **http records (RUN-15 half, D-17-13).** `openSessionLog({scope:'auto'}).http({...})` for every request, including refused and fixture-served ones.
12. **Socket-level dry-run/offline proof (RUN-04).** `flags.test.ts` H3 uses a `net.connect`/`tls.connect`/`dns.lookup` spy preload (`dial-recorder.mjs`) across research, add, verify (including Pass 3), compile and done, under both `--dry-run` and `PENSMITH_OFFLINE=1`: 0 dials. Also a grep test for no env-var bypass in `http.ts`.
13. **Live default proof (RUN-01).** `tests/live-default.test.ts` spawns the built CLI with `NODE_TEST_CONTEXT`, `PENSMITH_TEST` and every `PENSMITH_*` removed, except `PENSMITH_NO_LLM=1`. NO_LLM is orthogonal to the network mode (S-15); the §6 acceptance check repeats this with the mock LLM. It uses an isolated `XDG_DATA_HOME` and the dial-recorder preload, which records the SNI host and refuses the connect. Assert that `research --yolo` on "medieval Icelandic sagas" attempted api.crossref.org and/or api.openalex.org, read no file under `tests/fixtures/cassettes/`, and wrote no fixture entry to LIBRARY.json.
14. **Installed package (RUN-05, RUN-27).** `tests/installed-offline.test.ts` packs the built package (`npm pack`) and installs it with `npm install -g --offline --prefix <tmp>` (from the npm cache).
    - `--dry-run research --yolo` in a temp dir gives at least 5 synthetic sources and no ENOENT.
    - `PENSMITH_OFFLINE=1 … verify 1` exits non-zero with the not-shipped message and writes no verdicts.
    - A static check forbids resolving a `tests/` path at runtime outside `http-mock.ts`, as a chokepoint row.
15. **Recorder (CI-07, D-17-14).**
    - Add the record hook in `http.ts` and `scripts/refresh-cassettes.mjs` with `--only <adapter>`, plus the `package.json` script `cassettes:refresh`.
    - Re-record the Crossref, OpenAlex, arXiv (https), PubMed, Semantic Scholar, Unpaywall (current shape, with email) and Retraction Watch cassettes live, through the proxy, using `PENSMITH_CONTACT_EMAIL`.
    - Move synthetic cassettes to `synthetic/`, and add `tests/cassette-provenance.test.ts`.
    - Existing offline tests are re-pointed at recorded queries and DOIs.
16. **Doctor.** The `network-mode` probe prints `network: live` or `network: OFFLINE (<reason>)`, and is registered in `probes.ts`. Update the probe-count test. foundations writes the copy in `references/doctor-output.md`.
17. **Docs and security.**
    - Amend PRD §14 "Cassette-based source tests": cassettes are a test and dry-run mechanism only. Reason: the core value is re-fetching the live DOI.
    - `.planning/SECURITY.md`: row 2a becomes PROVEN (pinning), with a new SEC-03 size-cap row and an LLM-endpoint allowlist row.
    - Chokepoint rows: `network-tests-seam`, `tests-path-at-runtime`, `tests-network-imports`.
    - Remove the egress-owned test files from the per-test undici exemption lists in `eslint.config.js`, once they import V5.

**Verification (in the egress worktree):**
- `npm run prebuild && npm run lint && npm run typecheck && npm run build && npm test`. Everything passes except the documented root-only atomic-write case.
- `node --import tsx --test tests/net-mode.test.ts tests/egress-gate.test.ts tests/ssrf-pinning.test.ts tests/response-size-cap.test.ts tests/offline-fail-closed.test.ts tests/dry-run-sources.test.ts tests/show-prompts.test.ts tests/http-session-records.test.ts tests/cassette-provenance.test.ts`
- `npm run build && node --import tsx --test tests/live-default.test.ts tests/installed-offline.test.ts tests/flags.test.ts`
- `git grep -n PENSMITH_NETWORK_TESTS -- bin mcp hooks` matches only `bin/lib/http-mock.ts`.
- `git grep -n "void Agent\|maxRedirections" bin/lib/http.ts` shows no `void Agent`, and `maxRedirections: 0` only.
- The `arxiv.ts:123` TODO is gone.
- `PENSMITH_CONTACT_EMAIL=<maintainer email> npm run cassettes:refresh -- --only crossref` re-records cleanly, and `node --import tsx --test tests/cassette-no-leak.test.ts tests/cassette-size.test.ts` passes on the output.
- Scratch CLI runs from `…/scratchpad/p17/egress/` with `XDG_DATA_HOME` set inside: `PENSMITH_OFFLINE=1 node dist/bin/pensmith.js status` prints exactly one banner line; `node dist/bin/pensmith.js doctor` shows `network: live`; `--dry-run research --yolo` returns synthetic `10.0000/pensmith-dryrun.*` sources.

### 5.2 Stream `llm` — model runtime, providers, structured output, cost, status, session log, replay, mock

**Goal:** With only `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`, or a local endpoint), every model call:
- uses a valid current model and the right parameters;
- parses today's response shape and handles every stop reason;
- returns schema-validated objects for structured slugs;
- is priced, capped per session, logged, replayable, and projectable in advance.
All of it is testable against one mock in the real response shape.

**Requirements:** RUN-06, RUN-07, RUN-08, RUN-15, RUN-17, RUN-18, RUN-19, RUN-20, RUN-21, RUN-24, RUN-25, RUN-26, CONF-01.

**Owned paths:**
- Model runtime and cost: `bin/lib/anthropic.ts`, `bin/lib/pricing.ts`, `bin/lib/runtime.ts`, `bin/lib/schemas/runtime-config.ts`, `bin/lib/migrations/runtime-config/` (new), `bin/lib/budget.ts`, `bin/lib/estimator.ts`, `bin/lib/cost-fixture.ts`
- Session log and replay: `bin/lib/session-log.ts` (V4 owner), `bin/lib/replay.ts` (new)
- Config: `bin/lib/config.ts` (new), `bin/lib/schemas/config.ts` (new), `bin/lib/migrations/config/` (new)
- Models, contracts and stubs: `bin/lib/llm-models.ts` (new), `bin/lib/llm-contracts.ts` (new), `bin/lib/llm-stubs.ts` (new)
- Status: `bin/lib/status-view.ts` (new)
- Other LLM call sites: `bin/lib/verify/pass2.ts`, `bin/lib/verify/pass4.ts`, `bin/lib/revise-swap.ts`, `bin/lib/tutorial.ts`, `bin/lib/outline-parse.ts`
- Doctor probe: `bin/lib/doctor/probes/runtime-config-presence.ts`
- CLI verbs: `bin/cli/status.ts`, `bin/cli/intake.ts`, `bin/cli/goal.ts`, `bin/cli/outline.ts`, `bin/cli/plan.ts`, `bin/cli/resume.ts`
- Scripts and mock: `scripts/extract-fixture.mjs` (new), `scripts/mock-llm.mjs` (new), `tests/helpers/local-servers/mock-llm.ts` (new)
- Chokepoint rows: `scripts/chokepoints/config-toml.json`, `scripts/chokepoints/llm-transport-single-module.json`, and their fixtures
- Existing tests: `tests/llm-transport.test.ts`, `tests/llm-ssrf-bypass.test.ts`, `tests/pricing.test.ts`, `tests/runtime.test.ts`, `tests/budget.test.ts`, `tests/estimator.test.ts`, `tests/session-log.test.ts`, `tests/cost-fixture.test.ts`, `tests/known-bad-pass2.test.ts`, `tests/known-bad-pass4.test.ts`, `tests/pass2-injection.test.ts`, `tests/revise-swap.test.ts`, `tests/intake-bootstrap.test.ts`, `tests/intake-gitignore.test.ts`, `tests/intake-parse-security.test.ts`, `tests/intake-pii-egress.test.ts`, `tests/intake-pii-ordering.test.ts`, `tests/intake-style-producer.test.ts`, `tests/goal-routing.test.ts`, `tests/goal-learning-endstate.test.ts`, `tests/tutorial-provenance.test.ts`, `tests/tutorial-observer.test.ts`, `tests/outline-parse.test.ts`, `tests/outline-sections.test.ts`, `tests/no-outline-graceful.test.ts`, `tests/yolo-cap-readonly.test.ts`
- New tests: `tests/tier-contract/status-fields.test.ts`, `tests/llm-*.test.ts`, `tests/config*.test.ts`, `tests/mock-llm.test.ts`, `tests/replay.test.ts`, `tests/status.test.ts`, `tests/cost-cap.test.ts`, `tests/estimate-proceed.test.ts`
- Hot regions: see §4.3

**Tasks:**
1. **Seams.** Apply V1, V2, V3, V4 (owner), V5 and V6.
2. **Model table and pricing (RUN-06, D-17-17/18).**
   - `llm-models.ts` holds the ids, aliases (one-time warning), capabilities and the per-slug table (D-17-24).
   - `pricing.ts` gets the table with cache pricing, the config price override, the provider-max fallback with one warning, and $0 for local providers. `estimateCost` never throws `UnknownModelError` on a user path.
   - WebFetch openai.com/api/pricing to confirm the default OpenAI ids and prices, and cite the page and date.
   - Remove every `claude-(haiku|sonnet|opus)-4` literal from `bin/`, `templates/`, `tests/` and README. README belongs to foundations, so hand it the wording through the plan; foundations writes it.
3. **Runtime resolution (RUN-07, RUN-08, D-17-19/20).**
   - runtime.json v2 with a v1→v2 migration.
   - Precedence resolver, env auto-detection, the `api_key_env` name rule, and the retired paper overlay warning.
   - The `(b2)` dispatcher block pre-parses `--runtime`/`--model` into `setRuntimeOverride()`. Add the `runtime` and `model` args.
   - `assertLlmConfigured(verb)` replaces the probe blocks in the research, intake, outline, plan and revise CLI files.
   - An unknown provider is a friendly EXIT_ERROR listing the valid values, with no zod dump.
4. **Config loader (CONF-01, D-17-31).**
   - Add `config.ts`, `schemas/config.ts` (with the tutorial fragment from `tutorial.ts`) and `migrations/config/v0_to_v1.ts`.
   - intake writes `schema_version = 1` and moves all its config reads and writes to `config.ts`, as does `goal.ts`.
   - Load `[runtime]`, `[runtime.slugs.*]`, `[budget]` and `[logging]`.
   - `status --config`.
   - Amend PRD §10, and add a drift test on the §10 TOML block.
   - Append the config migration tests at the end of `tests/migrations.test.ts`.
5. **Providers and request policy (RUN-08, RUN-24, D-17-20/21).** Anthropic, OpenAI and OpenAI-compatible (ollama, vllm, openai-compatible) transports, all in `anthropic.ts`, and every call sets V3 `llm`/`maxBytes`.
   - Thinking and effort follow the model capabilities.
   - No sampling parameters, `budget_tokens` or prefill are ever sent. No effort is sent to Haiku 4.5.
   - Structured output goes through `output_config.format` or `response_format`.
   - Opt-in refusal fallbacks. doctor's endpoint probe function.
6. **Response handling (RUN-24, RUN-12 provider errors, D-17-22).**
   - Block-wise parse, and thinking tokens priced as output.
   - Refusal, `max_tokens` retry (streaming above 16k, SSE parsed from the buffered body), truncation that fails with nothing persisted, and OpenAI `length`/`content_filter`.
   - `ProviderHttpError`, `ProviderRefusalError` and `ProviderTruncatedError` extend V1 `PensmithError`, with one-line messages naming the provider, model and config key.
7. **Structured output (RUN-25, D-17-23).**
   - `llm-contracts.ts`: the registry, the zod→JSON-Schema converter (with an OpenAI strict variant), the tolerant parser, and the corrective retry.
   - Call sites pass `slug`, and structured slugs consume `data`:
     - research disambiguator (research.ts region)
     - evaluator (orchestrator region)
     - intake clarifier (INTAKE.md rendered from the object)
     - outline (canonical OUTLINE.md table rendered from OutlineSchema through a renderer in `outline-parse.ts`, readable by the existing `parseOutline`)
     - planner (PLAN.md rendered from `{frontmatter, body}`)
     - Pass 2 and Pass 4
   - Text slugs (drafter in write.ts, revise-swap, tutorial, smoother if called) pass `slug` too.
   - No `templates/prompts` edits.
8. **Per-slug defaults (RUN-26, D-17-24).** Default models and effort per slug, `[runtime.slugs.<slug>]` overrides, `--model` affecting generation slugs only, `cacheSystem` sending `cache_control`, and `status --config` listing each slug's model and source.
9. **LLM-stubbed mode (RUN-04 half, D-17-25).** `llm-stubs.ts` returns schema-valid stubs for structured slugs under `PENSMITH_NO_LLM` (including via `--dry-run`), taking an optional `stubHint`. Text slugs keep the placeholder.
10. **Session cost cap (RUN-18, D-17-26/27).**
    - Session id, the new COSTS fields, and cap resolution from config and `PENSMITH_COST_CAP_USD`.
    - The projection from p90 bounded by `max_tokens`, the V2 `cost-cap` gate, and the `warn_at_usd` warning.
    - Remove `DEFAULT_CAP_USD`, the scope caps and the Pass 2/Pass 4 section caps.
    - Rewrite the `(c)` yolo pre-flight to compare against the cap.
11. **Estimator (RUN-20, D-17-25).**
    - Resolved models and prices, flagged `(fallback price)` where used.
    - Per-slug p90s from SESSION.log (at least 5 samples, else the shipped defaults).
    - The no-STATE derivation from `assignment.*`, `--from` or INTAKE.md, with length and section count.
    - Completed-step exclusion and the `nothing left to run ($0.00)` line.
    - The `(d)` block prints the table, runs the V2 `estimate-proceed` gate, and on yes strips `--estimate` and continues to routing. No network or LLM call.
12. **SESSION.log llm records (RUN-15, D-17-29).**
    - The record shape, cost equal to COSTS, the `offline` flag, the spill above 256 KiB with sha256, and `[logging] session_bodies`.
    - Log the argv once per session. Remove the prompt-kind stderr mirror.
    - `openSessionLog` resolves the paper through base `projectRoot()`.
    - A sentinel test that no API key ever appears.
13. **Replay (RUN-17, D-17-30).** `resume --replay <entryId>`, logged-response serving under sources-offline, and `scripts/extract-fixture.mjs`, with a unit test that replays by slug.
14. **Mock LLM (RUN-21, D-17-28).** `tests/helpers/local-servers/mock-llm.ts` and `scripts/mock-llm.mjs` (`npm run mock-llm`). Self-tests cover both shapes through the real transport, every failure injection, and that no socket is left open. Migrate `tests/llm-transport.test.ts` to the mock; MockAgent stays only for real-host cases, through V5 with `PENSMITH_NETWORK_TESTS=1`. Remove its per-test eslint exemption.
15. **Status (RUN-19).** `status-view.ts`:
    - title and name, class, `current: §N (step)`
    - glyphs ✓ ⌛ ⌽, with an ASCII fallback when `LANG`/`LC_ALL` is not UTF-8
    - `cost: $X.XX this session / $Y.YY total (cap $5.00)`, and `n/a (Claude session)` in Tier 1
    - `next: …`
    `status.ts` renders it, and `paper://state` returns `{...state, status: view}` (resources.ts region). Add `tests/tier-contract/status-fields.test.ts`.
16. **Doctor (RUN-07, RUN-08).** Extend `runtime-config-presence`:
    - the provider, model and key variable in use;
    - presence booleans for `OPENALEX_API_KEY`, `PENSMITH_S2_API_KEY`, `GPTZERO_API_KEY`, `PENSMITH_CONTACT_EMAIL` and `ZOTERO_API_KEY`;
    - the `Set one of` line;
    - endpoint `GET /models` PASS or WARN, and a bogus-provider FAIL listing the valid values;
    - the fallbacks disclosure, and the `PENSMITH_NO_LLM` description ("replaces every LLM call with a deterministic stub (testing and dry-run)").
    No value is ever printed; keep the sentinel test.
17. **Docs and rows.** Amend PRD §7.19 (the session definition, the estimate confirmation, labelled synthetic sources in dry-run). Add the `config-toml` and `llm-transport-single-module` chokepoint rows. Update the superseded tests: the haiku-4 ids, UnknownModelError, the 50% pre-flight, and the per-scope caps.

**Verification (in the llm worktree):**
- `npm run prebuild && npm run lint && npm run typecheck && npm run build && npm test` green.
- `node --import tsx --test tests/llm-*.test.ts tests/mock-llm.test.ts tests/config*.test.ts tests/cost-cap.test.ts tests/estimate-proceed.test.ts tests/replay.test.ts tests/status.test.ts tests/tier-contract/status-fields.test.ts tests/pricing.test.ts tests/runtime.test.ts tests/session-log.test.ts`
- `git grep -nE "claude-(haiku|sonnet|opus)-4['\"]" -- bin templates tests` is empty, and `git grep -n "0\.50\|DEFAULT_CAP_USD" -- bin` shows no cap reader.
- Scratch runs from `…/scratchpad/p17/llm/`:
  - `npm run mock-llm -- --port 18080 --shape anthropic &` plus a global runtime.json pointing at `http://127.0.0.1:18080` in an isolated data dir.
  - `ANTHROPIC_API_KEY=sk-test-SENTINEL node dist/bin/pensmith.js new --from assignment.txt --yolo`, then `outline --yolo`. The captured request uses `claude-opus-5`, `thinking` adaptive, no `temperature`, and `output_config.format` for outline. SESSION.log has llm records with non-zero tokens and cost equal to COSTS. `grep -c SENTINEL .paper/SESSION.log` is 0.
  - `node dist/bin/pensmith.js --estimate` in a dir holding only the §15 assignment prints a total under $3.50.

### 5.3 Stream `paper-cli` — paper root, resolver, exit codes, CLI contract, gates, session lock, frontmatter versioning

**Goal:** All state is under `.paper/`, resolved one way by the CLI, MCP and hooks. The `open` pointer works without hijacking fresh folders. Every refusal has a documented exit code and a one-line message. Typos never start papers. One gate registry drives every prompt. Concurrent sessions are refused safely. Frontmatter is versioned.

**Requirements:** RUN-09, RUN-11, RUN-12, RUN-13, RUN-14, RUN-23, RUN-28, CONF-04.

**Owned paths:**
- Dispatcher and seams: `bin/pensmith.ts` (main), `bin/lib/verbs.ts`, `bin/lib/exit-codes.ts` (V1 owner), `bin/lib/gates.ts` (V2 owner)
- Paper state and paths: `bin/lib/paths.ts` (main), `bin/lib/state.ts`, `bin/lib/session-lock.ts` (new), `bin/lib/outline.ts`, `bin/lib/section.ts`, `bin/lib/section-slug.ts`, `bin/lib/write-orchestrator.ts`, `bin/lib/global-library.ts`, `bin/lib/router.ts`, `bin/lib/compile.ts` (main), `bin/lib/ecosystem-presence.ts`, `bin/lib/handoff.ts`
- Prompts: `bin/lib/prompts.ts`, `bin/lib/prompts/`
- Frontmatter: `bin/lib/revise.ts`, `bin/lib/frontmatter.ts`, `bin/lib/plan-status.ts`, `bin/lib/schemas/plan-frontmatter.ts`, `bin/lib/migrations/loader.ts`, `bin/lib/migrations/plan/`, `bin/lib/migrations/intake/`, `bin/lib/migrations/draft/`, `bin/lib/migrations/verification/` (all new except the loader)
- CLI verbs: `bin/cli/add.ts`, `bin/cli/research.ts`, `bin/cli/compile.ts`, `bin/cli/done.ts`, `bin/cli/verify.ts`, `bin/cli/write.ts`, `bin/cli/next.ts`, `bin/cli/open.ts`, `bin/cli/list.ts`, `bin/cli/sketch.ts`, `bin/cli/revise.ts`, `bin/cli/doctor.ts`, `bin/cli/stubs.ts`
- MCP, hooks and workflows: `mcp/` (main), `hooks/`, `workflows/status.md`, `workflows/sketch.md`, `workflows/next.md`
- Chokepoint rows: `scripts/chokepoints/state-json.json`, `scripts/chokepoints/process-cwd-paper-root.json`, `scripts/chokepoints/gate-registry.json`, and their fixtures
- Existing tests: `tests/tier-contract.test.ts` (main), `tests/tier-contract/` (except status-fields), `tests/cli-*.test.ts`, `tests/pensmith-router.test.ts`, `tests/state*.test.ts`, `tests/paths.test.ts`, `tests/section-*.test.ts`, `tests/mcp-*.test.ts`, `tests/lint-thin-shim.test.ts`, `tests/hooks/`, `tests/hooks-noop.test.ts`, `tests/add-remap-section.test.ts`, `tests/compile-*.test.ts`, `tests/done-*.test.ts`, `tests/export-*.test.ts`, `tests/write-*.test.ts`, `tests/wave-*.test.ts`, `tests/scheduler-stateless.test.ts`, `tests/sketch.test.ts`, `tests/prompts-*.test.ts`, `tests/handoff*.test.ts`, `tests/letter-suffix-paths.test.ts`, `tests/checkpoint.test.ts`, `tests/global-library.test.ts`, `tests/migrations.test.ts` (main), `tests/migration*.test.ts`, `tests/frontmatter-roundtrip.test.ts`
- New tests: `tests/cli-exit-codes.test.ts`, `tests/unknown-verb.test.ts`, `tests/noninteractive-prompts.test.ts`, `tests/gates-registry.test.ts`, `tests/paper-root-resolver.test.ts`, `tests/legacy-layout-migration.test.ts`, `tests/session-lock.test.ts`, `tests/frontmatter-versioning.test.ts`, `tests/tier-contract/exit-parity.test.ts`
- Hot regions: see §4.3

**Tasks:**
1. **Seams.** Create V1 and V2 (owner).
2. **`.paper/` state (RUN-13, D-17-32).**
   - `stateFile(root)` becomes `.paper/STATE.json`, and `migrateLegacyLayout(root)` runs under the per-file lock with a one-time notice.
   - `loadOutline`, `loadSection` and `loadLibrary` take the project root. Fix the callers: write-orchestrator, compile, section, `mcp/resources.ts`.
   - `global-library.ts` builds the STATE path through the `paths.ts`/`state.ts` helpers.
   - `mcp/server.ts` roots at `PENSMITH_PAPER_ROOT` or the cwd (the project root), and the hooks resolve the same way.
   - Update `workflows/status.md`, `sketch.md` and `next.md`, and amend PRD §13 (STATE.json).
   - Chokepoint row `state-json`.
   - Update the MCP and tier-contract fixtures, and every test that set `PENSMITH_PAPER_ROOT` to a `.paper`-style directory.
3. **Resolver (RUN-14, D-17-33).**
   - `resolvePaperRoot`, `setActivePaperRoot`, and `projectRoot()` defaulting to the active root.
   - `--paper <name|path>`.
   - The pointer rules, banner, stale clearing and `paper-pointer` gate.
   - Replace every `process.cwd()` used as a paper root in `bin/cli/*` and in `hooks/stop.ts`. In the llm-owned intake, outline, plan and resume, change only that token. `status.ts` is rewritten by llm, which uses `projectRoot()` itself, so leave it alone.
   - Chokepoint row `process-cwd-paper-root`. Amend PRD §6 `open`.
4. **Dispatcher (RUN-09, RUN-11, RUN-12, D-17-34/35).**
   - `dispatchInner` plus the exported `dispatch()` wrapper that prints one line and sets the exit code.
   - The pre-flight block runs in this order: argv validation (unknown verb or flag, aliases, stripping value-taking globals), then resolve the root, then run the legacy migration, then print the pointer banner, then take the session lock for mutating verbs.
   - Block (e) runs verbs through citty `runCommand` inside the wrapper.
   - Result→code mapping, and bare/next/resume propagation.
   - The `--help` footer: the exit-code table from V1 `EXIT_CODES`, the global flags (`--dry-run`, `--estimate`, `--yolo`, `--show-prompts`, `--runtime`, `--model`, `--paper`), and the environment variables. The `PENSMITH_NO_LLM` wording is "replaces every LLM call with a deterministic stub (testing and dry-run)", and `PENSMITH_OFFLINE` is described too.
   - `VERB_ALIASES` in `verbs.ts` (empty). A test alias injected in a test dispatches correctly. `tests/cli-verbs.test.ts` still asserts 16 verbs.
5. **Exit codes in the verbs (RUN-09).**
   - verify: failed or blocking-unverifiable exits 4.
   - compile: REFUSED exits 4.
   - done: BLOCKED or stale exits 4. `done < /dev/null` without `--yolo` exits 3. `n` exits 3 with `export cancelled by user`.
   - outline: 0 sections exits 1.
   - intake: no assignment in a non-TTY run exits 2.
   - add: refusals exit 1.
   - wave write: failures exit 1.
   - MCP tools return `isError` with the classification. Add `tests/cli-exit-codes.test.ts` (spawns `dist`) and `tests/tier-contract/exit-parity.test.ts`. A test enumerates `EXIT_CODES` against the documented table.
6. **Gates (RUN-28, D-17-36).**
   - Convert these to `runGate`/`declineGate`: outline approval (outline.ts region), export confirmation, research scope and pruning, add remap (a run that cannot prompt prints `remap skipped (non-interactive); run pensmith add --remap <key> --section N`), and revise swap (`revise.ts`).
   - Delete the three `ApprovalUnavailableError` copies.
   - Chokepoint row `gate-registry`: `ask` imported only by `gates.ts` and `sketch.ts`.
   - Amend PRD §7.20 with the full table, including the future gates and their requirement ids. Add a drift test between the PRD table and `GATES`.
   - `tests/gates-registry.test.ts` drives every wired gate without a terminal, with and without `--yolo`, and asserts the exit code and that no file changed.
7. **Non-interactive input (RUN-12, D-17-34).**
   - The numbered prompts read one line per question from a shared line reader, so piped multi-answer input works across questions. `resolveMode` picks clack only when stdin, stdout and stderr are all terminals, so a pipe into a terminal session uses numbered prompts.
   - `PromptAbortedError` exits EXIT_APPROVAL.
   - A matrix test runs new, outline approval, the done confirmation, add remap and sketch with stdin that is not a TTY, and asserts that no stderr line matches `/^\s+at .*\.js:\d+/`.
   - Test that `printf '…5 answers…' | pensmith sketch` works.
8. **Session lock (RUN-23, D-17-37).**
   - `session-lock.ts`, acquired in the dispatcher pre-flight for mutating verbs.
   - MCP mutating tools go through a `bin/lib` helper `withPaperSession(root, {section?}, fn)`: per-call, re-entrant, with section sub-locks. Handlers stay at 30 statements or fewer.
   - Stop hook policy. Delete `forceRelease('.paper')`.
   - Tests:
     - A child process that holds the lock makes `write 1` refuse with the holder PID.
     - `kill -9` of the holder is followed by `cleared stale lock`.
     - The MCP-style harness finishes 3 parallel sections and serializes 2 writes to the same section.
     - `status` succeeds while the lock is held.
     - A mutating MCP tool refuses during a CLI session, as a structured refusal with no file change.
9. **Frontmatter versioning (CONF-04, D-17-38).**
   - `loadFrontmatterDoc(kind, file, {writeBack})`, migrations under `bin/lib/migrations/<kind>/`, and `schema_version: 1` in PLAN.md through the schema and `updatePlanFrontmatter`.
   - The readers in write, verify, write-orchestrator, revise, compile and router switch to it; the router reads without write-back.
   - A newer version is refused with `upgrade pensmith`.
   - Frontmatter cases go at the top of `tests/migrations.test.ts`. `tests/frontmatter-roundtrip.test.ts` preserves `schema_version`.
   - Amend the PRD §14 schema bullet.

**Verification (in the paper-cli worktree):**
- `npm run prebuild && npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test` green.
- `node --import tsx --test tests/cli-exit-codes.test.ts tests/unknown-verb.test.ts tests/noninteractive-prompts.test.ts tests/gates-registry.test.ts tests/paper-root-resolver.test.ts tests/legacy-layout-migration.test.ts tests/session-lock.test.ts tests/frontmatter-versioning.test.ts tests/tier-contract/exit-parity.test.ts tests/migrations.test.ts`
- Scratch runs from `…/scratchpad/p17/paper-cli/` with an isolated data dir and `PENSMITH_NO_LLM=1`:
  - `pensmith stauts` exits 2 with the suggestion and creates nothing.
  - `pensmith new --yolo --from assignment.txt` writes `.paper/STATE.json` and nothing at the root.
  - `pensmith open <name>` followed by `status` from an empty dir prints the active-paper banner.
  - `pensmith done --no-scor` exits 2.

### 5.4 Stream `foundations` — Node LTS, test isolation, main guard, locks, library writer, chokepoint harness, docs

**Goal:** Supported Node in CI. Tests that never touch the user's data. An installed or linked binary that runs. Locks that survive contention. One validated library writer. Every chokepoint written down and enforced. Truthful docs.

**Requirements:** CI-06, CI-09, RUN-10, RUN-22, RUN-29, BRDTH-01.

**Owned paths:**
- Packaging and CI: `package.json` (main), `package-lock.json`, `.github/workflows/`, `scripts/run-tests.mjs`
- Chokepoint rule: `scripts/eslint-rules/` (new), `scripts/chokepoints/main-guard.json`, `scripts/chokepoints/no-new-eslint-disable.json`, `scripts/chokepoints/library-writer.json`, and their fixtures
- Runtime: `bin/lib/main-guard.ts` (new), `bin/lib/lock.ts`, `bin/lib/doctor/probes/node-version.ts`
- Library: `bin/lib/library.ts`, `bin/lib/schemas/library.ts`, `bin/lib/migrations/library/` (new), `bin/lib/bibtex-write.ts`, `bin/lib/ris-write.ts`, `bin/lib/citekey.ts`
- Lint config and docs: `eslint.config.js` (main), `CLAUDE.md`, `README.md`, `README-DEV.md`, `CONTRIBUTING.md`, `references/doctor-output.md`, `tests/repo-files.test.ts`
- Existing tests: `tests/lint-*.test.ts`, `tests/lock*.test.ts`, `tests/lock-conflict.cjs`, `tests/library.test.ts`, `tests/bibtex-write.test.ts`, `tests/ris-write.test.ts`, `tests/citekey*.test.ts`, `tests/compile-bib-regen.test.ts`, `tests/registry-gc.test.ts`
- New tests: `tests/chokepoints.test.ts`, `tests/lock-contention.test.ts`, `tests/installed-bin.test.ts`, `tests/data-dir-isolation.test.ts`, `tests/run-tests-offline.test.ts`, `tests/library-writer.test.ts`
- Hot regions: see §4.3

**Tasks:**
1. **Node LTS (CI-06, D-17-39).**
   - `engines.node` `>=22.12.0`, `@types/node` `^22` (regenerate the lockfile).
   - `ci.yml` matrix `node: ['22', '24']` × ubuntu/macOS/Windows. `cassette-refresh.yml` uses Node 24.
   - The node-version probe floor and its copy. Fix `scripts/run-tests.mjs` comments that cite Node 20.10.
   - `grep -rn "node-version: .*20" .github/` is empty.
2. **Test isolation (CI-09, D-17-40).**
   - `run-tests.mjs` creates a per-run temp dir, sets `XDG_DATA_HOME`, `LOCALAPPDATA` and `PENSMITH_TEST_DATA_DIR` to it, and sets `PENSMITH_TEST=1`.
   - The test-context branch in `paths.ts` `localDataDir`/`pensmithDataDir` (paths.ts region).
   - A `ci.yml` step records the sha256 (or absence) of the real `library/index.json` before and after `npm test`, on every OS.
   - Tests:
     - A single-file run of `tests/intake-gitignore.test.ts` adds no `/tmp/pensmith-*` entries to the real registry. Simulate the real dir with a sandboxed HOME outside `os.tmpdir()`.
     - `run-tests.mjs` sets `PENSMITH_TEST=1`, and with it `isOfflineMode()` is true unless `PENSMITH_NETWORK_TESTS=1`. This holds against base semantics too.
     - `tests/registry-gc.test.ts` still passes.
3. **Main guard (RUN-10, D-17-41).**
   - `main-guard.ts`, used in the last lines of `bin/pensmith.ts` and `mcp/server.ts`.
   - Chokepoint row `main-guard`.
   - `tests/installed-bin.test.ts` packs, then installs with `npm install -g --offline --prefix <tmp>`:
     - `<prefix>/bin/pensmith` (`.cmd` on Windows) `--version` prints the package version, `--help` lists all 16 verbs, and `doctor` prints the probe table.
     - `node <symlink or junction to the package root>/dist/bin/pensmith.js --version` works (a directory junction on Windows).
     - A JSON-RPC `initialize` over stdio to `node <linked root>/dist/mcp/server.js` returns `serverInfo.name` `pensmith`.
     - It runs on all three OS legs.
4. **Lock contention (RUN-22, D-17-42).**
   - In-process FIFO, try-once plus jittered backoff, `owner.json`, and `LockTimeoutError(resource, pid)`.
   - `tests/lock-contention.test.ts`: 40 contenders holding the lock about 5 ms each all succeed within 10 s, and a never-releasing holder times out at `timeoutMs` ±20% with the path and PID in the message.
   - `tests/lock.test.ts` and `tests/lock-timeout.test.ts` still pass.
5. **Library writer (BRDTH-01, D-17-43).**
   - Library schema v2, `migrations/library/v1_to_v2.ts`, and `upsertSources` covering dedup, merge, version-of-record collapse, alternate DOIs, provenance and `last_verified`.
   - CITATIONS.bib and CITATIONS.ris are rendered from LIBRARY.json.
   - research Step 7 and the add bib block switch to `upsertSources` (their regions). `add` of a known DOI prints `already in library as <key>`.
   - `compile` stops rewriting `.paper/CITATIONS.bib`; update `tests/compile-bib-regen.test.ts` to the new contract.
   - `paper://library` returns entries after a real research run.
   - Chokepoint row `library-writer`.
   - Tests: a migration test, 5 concurrent upserts losing no update, and preprint plus version-of-record collapse.
6. **Chokepoint harness (RUN-29, D-17-44).**
   - The `scripts/eslint-rules/chokepoint.mjs` rule loads every `scripts/chokepoints/*.json`. Wire it into `eslint.config.js` as the `pensmith/chokepoint` rule for `bin/`, `mcp/`, `hooks/`, `tests/` and `scripts/`. Ignore `tests/fixtures/chokepoints/**`.
   - `tests/chokepoints.test.ts` covers the file-regex and import-graph kinds, runs every row's fixture through `ESLint.lintText` or the harness and asserts it fails, and holds the `no-new-eslint-disable` baseline (the existing occurrences only).
   - Write the CLAUDE.md chokepoint table: every Phase 17 row (the `http.ts` egress gate, the `PENSMITH_NETWORK_TESTS` seam, the network imports under `tests/`, `tests/` paths at runtime, the LLM transports in one module, config.toml, STATE.json, `process.cwd()` as paper root, the gate registry, the library writer, the main guard, and no new `eslint-disable`) plus future rows marked "enforced from <REQ>".
7. **Docs.** Write the following from 17-CONTEXT, since no other stream edits these files:
   - README:
     - live network by default, and the `PENSMITH_OFFLINE`/`--dry-run`/test-runner modes;
     - the env table: `OPENAI_API_KEY` auto-detection, `PENSMITH_NO_LLM` "replaces every LLM call with a deterministic stub (testing and dry-run)", `PENSMITH_OFFLINE`, `PENSMITH_COST_CAP_USD`, `OPENALEX_API_KEY`, `PENSMITH_S2_API_KEY`;
     - runtimes (`--runtime`/`--model`, Ollama, vLLM, OpenAI-compatible, `endpoint` in the global runtime.json only), `--paper` and the `open` pointer;
     - exit codes, the per-session cost cap, `status --config`, SESSION.log and `--show-prompts`, and the Node floor.
   - CONTRIBUTING: `npm run cassettes:refresh`, the test lanes, data-dir isolation. Keep the D-24 "Tier contract — do not skip" block intact.
   - CLAUDE.md: Node, `.paper/STATE.json`, the modes gotcha, the chokepoint table, and the seams note.
   - README-DEV.
   - `references/doctor-output.md`: a `network-mode` section, updated `runtime-config-presence` and `node-version` copy, and a re-pin in `tests/repo-files.test.ts`.

**Verification (in the foundations worktree):**
- `npm ci && npm run prebuild && npm run lint && npm run typecheck && npm run build && npm test` green on Node 22 (and Node 24 if available).
- `node --import tsx --test tests/chokepoints.test.ts tests/lock-contention.test.ts tests/data-dir-isolation.test.ts tests/run-tests-offline.test.ts tests/library-writer.test.ts tests/repo-files.test.ts`, and `npm run build && node --import tsx --test tests/installed-bin.test.ts`
- `grep -rn "node-version: .*20" .github/` is empty, and `git grep -n "pathToFileURL(process.argv\[1\]" -- bin mcp hooks` matches only `bin/lib/main-guard.ts`.
- A scratch `npm link` of a copy of the repo under `…/scratchpad/p17/foundations/` gives `pensmith --version` output.

## 6. Acceptance checks (post-merge, real user paths)

**Common setup.** Build first: `cd /home/user/pensmith && npm run build`.

```
S=/tmp/claude-0/-home-user-pensmith/424821c3-06dc-5dce-b0e5-b1cac8e53a7e/scratchpad/p17/accept
P="node /home/user/pensmith/dist/bin/pensmith.js"
```

**Isolation, per check.**
- Make a fresh dir `d=$(mktemp -d $S/XXXX)`.
- Set `XDG_DATA_HOME=$d/data`.
- Run with `env -u NODE_TEST_CONTEXT -u PENSMITH_TEST`, and with no other `PENSMITH_*` variables unless a check names them.

**Mock LLM.**
- Start it with `npm run mock-llm -- --port 18080 --shape anthropic &`.
- Write `$d/data/pensmith/runtime.json` = `{"$schemaVersion":2,"provider":"anthropic","endpoint":"http://127.0.0.1:18080","api_key_env":"ANTHROPIC_API_KEY"}`.
- Set `ANTHROPIC_API_KEY=sk-test-SENTINEL`.

**Assignment fixtures.**
- A1 = "Write a 1500-word literature review on attention mechanisms in transformers, APA style."
- A2 = "Write a 1500-word essay on medieval Icelandic sagas."

**Per-requirement checks.**

| Req | Check (commands → expected) |
|---|---|
| RUN-01 | (a) `$P research --yolo` in `d` holding A2 plus the mock, run with `node --import tests/helpers/local-servers/dial-recorder.mjs dist/bin/pensmith.js …`: the recorder lists api.crossref.org and/or api.openalex.org; no file under `tests/fixtures/cassettes/` is opened; LIBRARY.json has none of vaswani2017, engel2009, `10.1234/example.*` or `10.0000/*`. (b) `npm test` records 0 external connections, and `tests/run-tests-offline.test.ts` passes. (c) `git grep -n PENSMITH_NETWORK_TESTS -- bin mcp hooks` matches only `bin/lib/http-mock.ts`. (d) PRD §14 carries the cassette amendment. |
| RUN-02 | `PENSMITH_OFFLINE=1 $P status` (and research, verify, compile, done, doctor): exactly one `OFFLINE MODE (reason: PENSMITH_OFFLINE=1)` stderr line; a clean env prints none. Offline research, verify, compile and done write the marker into RESEARCH.md, VERIFICATION.md and COMPILE-REPORT.md. `$P doctor` shows `network: live`, or `network: OFFLINE (PENSMITH_OFFLINE=1)` when set. `PENSMITH_NO_LLM=1 $P status` prints `LLM STUBBED …`. `tests/zero-trace-export.test.ts` offline case is green. |
| RUN-03 | `node --import tsx --test tests/offline-fail-closed.test.ts`: `crossref.fetchById('10.9999/not-recorded')` and `unpaywall.fetchById(…)` are a no-fixture miss, and no adapter, plagiarism or honesty call returns a record for a different identifier. An offline verify of a section citing `10.1038/s41586-021-03819-2` gives **UNVERIFIABLE** (offline), never MIS-CITED against nphys1170. `PENSMITH_OFFLINE=1 $P add 10.1093/nar/gkab1112` exits non-zero and adds nothing. Offline research on A2 prints `offline: no recorded results for this query` with 0 candidates. Offline plagiarism on nonsense text gives 0 matches. Offline honesty with `GPTZERO_API_KEY` set prints `score unavailable (offline)`. |
| RUN-04 | `tests/egress-gate.test.ts`: an offline `httpFetch(crossref)` throws `OfflineEgressError` with 0 dials; the loopback mock `complete()` succeeds; a non-loopback LLM endpoint is refused while offline; `--dry-run` refuses loopback with 0 dials; `PENSMITH_NO_LLM` alone leaves sources live (MockAgent). `$P add 10.1038/nphys1170 --dry-run --yolo` and `$P verify 1 --dry-run --yolo` (a section quoting a DOI-cited source) make 0 dials under the dial recorder and report `unavailable (dry-run)`. The `flags.test.ts` H3 socket-level case is green. |
| RUN-05 | `npm pack` the build, then `npm install -g --offline --prefix $d/pfx <tgz>`. `$d/pfx/bin/pensmith --dry-run research --yolo` in a temp dir with A1 completes with no ENOENT on tests/fixtures. `PENSMITH_OFFLINE=1 $d/pfx/bin/pensmith verify 1` exits non-zero with `offline fixtures are not shipped in the installed package; offline replay needs a source checkout` and writes no VERIFICATION.md. The `tests-path-at-runtime` chokepoint row passes. The live-lane verify of a real Crossref DOI is the maintainer's `PENSMITH_NETWORK_TESTS=1` run. |
| RUN-06 | With the mock and no runtime model configured, the captured request has `"model":"claude-opus-5"`. `node --import tsx --test tests/pricing.test.ts`: every current id and the default OpenAI model price finitely; `my-local-finetune` gets the fallback price and one warning; no path throws `UnknownModelError`. A runtime.json naming `claude-haiku-4` loads with an alias warning, as `claude-haiku-4-5`. `git grep -nE "claude-(haiku\|sonnet\|opus)-4['\"]" -- bin templates tests README.md` is empty. |
| RUN-07 | A paper `[runtime] model = "claude-sonnet-5"` plus a global model: the captured request uses `claude-sonnet-5`, and two temp papers stay independent. A paper `endpoint = "http://169.254.169.254/latest"` or `api_key_env = "GITHUB_TOKEN"` fails naming the global runtime file, sends nothing and never reads the variable; a global `api_key_env = "GITHUB_TOKEN"` is rejected (`tests/llm-ssrf-bypass.test.ts`). With only `OPENAI_API_KEY`, `new --from a.txt --yolo` POSTs to api.openai.com with Bearer and the default OpenAI model (MockAgent through V5 with `PENSMITH_NETWORK_TESTS=1`); with only `ANTHROPIC_API_KEY`, it goes to api.anthropic.com with `claude-opus-5`. doctor lists the provider and presence booleans (no values), and prints `Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local endpoint)` when neither key is set. |
| RUN-08 | Run the mock in openai shape on 127.0.0.1:11434 and seed a paper. `$P write 1 --runtime ollama --model qwen2.5`: a POST to `/v1/chat/completions` with the model and no Authorization, exit 0, and DRAFT.md holds the stub reply. A global `openai-compatible` with endpoint `http://localhost:8000/v1` routes the same way. With no endpoint configured, the loopback URL is refused, and a source fetch to `http://127.0.0.1/` in the same process is refused (`tests/ssrf-guard.test.ts`). Endpoints `http://169.254.169.254/v1` and `http://[fd00:ec2::254]/v1` are refused, `http://10.0.0.5:8000/v1` is refused, and `https://10.0.0.5:8000/v1` is allowed and pinned. Provider `bogus`: doctor FAIL lists the valid providers, and `write 1` exits 1 with the same line and no zod dump. `$P --runtime ollama doctor` shows the endpoint PASS against the mock and WARN when it is down. `--help` documents `--runtime` and `--model`. |
| RUN-09 | `tests/cli-exit-codes.test.ts` on `dist` with a fabricated DOI: `verify 1`, `compile --yolo` and `done --yolo` each exit 4 and write no `.paper/DRAFT.md` or `.paper/export/`. `$P done < /dev/null` exits 3 with the approval message; answering `n` (`PENSMITH_PROMPT_MODE=numbered`, `printf 'n\n'`) prints `export cancelled by user` and exits 3. Bare `$P --yolo` and `$P next` exit with the dispatched verb's code; `outline --yolo` with 0 sections exits 1. The `EXIT_CODES` table test and the tier-contract `isError` parity are green. |
| RUN-10 | `tests/installed-bin.test.ts` green: the installed `pensmith --version`, `--help` (16 verbs) and `doctor`; `node <symlink or junction>/dist/bin/pensmith.js --version`; and MCP `initialize` over the linked root returns `serverInfo.name` `pensmith`. The grep for `pathToFileURL(process.argv[1]` matches only `main-guard.ts`. |
| RUN-11 | In an empty `d`, `$P stauts` exits 2 with `unknown command 'stauts'` and `did you mean 'status'`, and afterwards there is no `.paper/`, no STATE.json, no SESSION.log and the registry is unchanged. In a finished paper, `$P done --no-scor` exits 2 and writes nothing. The alias-table test dispatches the test alias. `tests/cli-verbs.test.ts` still has 16 verbs. Bare `$P` and `$P --dry-run` still route through `resolveNextAction`. |
| RUN-12 | `printf 'LLMs in education\nThat they replace teachers\nUndergrad instructors\nTutors help most with feedback\ny\n' \| $P sketch` answers every question. `$P add 10.1145/3442188.3445922 < /dev/null` adds the source and prints `remap skipped (non-interactive); run pensmith add --remap <key> --section N`. A mock 404 `model_not_found` makes `$P plan 1` exit 1 with one line naming the model and the config key. The matrix test finds no stack-trace lines. |
| RUN-13 | `$P new --yolo --from a.txt` in an empty `d` creates `.paper/STATE.json` and `.paper/config.toml`, and nothing at the root. A legacy fixture with a root STATE.json and config.toml: `$P status` moves both, prints the notice once, and keeps the router decision; a second run prints nothing. The `state-json` and `config-toml` chokepoint rows pass. `workflows/status.md`, `sketch.md` and `next.md` name `.paper/STATE.json`. In the tier contract, `paper://state` and `status` read the same file, and `paper://section/3` on a CLI-created 5-section paper returns the plan, draft and verification. |
| RUN-14 | `$P open p2`, then `$P status` from an empty dir prints p2's status with `(active paper "p2" at <path>)`. With the pointer on p2, a fresh dir holding `assignment.txt` plus `$P --yolo` creates `./.paper/`, and every file of p2 keeps its sha256 and mtime. With no assignment, bare `$P --yolo` and a non-TTY `$P write 1` exit 2 naming `--paper p2` and `pensmith new`. Under a pty (`script -qec`), bare `$P` asks, and `continue` proceeds on p2. `$P --paper p2 write 1` works non-interactively. A cwd with its own `.paper/` wins over the pointer, and a stale pointer is cleared with a warning. |
| RUN-15 | `$P outline --yolo` against the mock writes `kind:"llm"` records for slug `outline-author` with non-zero tokens and cost. A multi-call research run: the sum of `cost_usd` equals the COSTS.jsonl delta. `kind:"http"` records exist for each source call. `grep -c sk-test-SENTINEL .paper/SESSION.log` is 0. With `session_bodies = "redacted"`, only hashes, counts and previews appear. |
| RUN-16 | `$P --show-prompts new --from a.txt --yolo`: the stderr mirror of the intake-clarifier body appears before the mock logs the request (`tests/show-prompts.test.ts` orders the two). `--show-prompts research` lists each adapter URL; `--show-prompts done` shows the GPTZero body preview and the DDG queries; the sentinel key never appears. `flags.test.ts` H2 asserts the mirrored content. |
| RUN-17 | Run `$P new --from a.txt --yolo` against the mock, and take the intake-clarifier record id from SESSION.log. `PENSMITH_OFFLINE=1 $P resume --replay <id>` reproduces INTAKE.md byte for byte, and the mock call count does not change. `node scripts/extract-fixture.mjs .paper/SESSION.log > fx.json`, then the mock with `--fixture fx.json` serves each slug's response (unit test). |
| RUN-18 | `[budget] cost_cap_usd = 0.01` with the priced mock. Under a pty, the run shows `would exceed your $0.01 cost cap … Continue? [y/N]`, and `n` exits 5 with 0 mock requests. In a non-TTY run with `--yolo`, it exits 5 with the same one line and no request. `warn_at_usd = 0.001` prints exactly one warning. `git grep -n "0\.50\|DEFAULT_CAP_USD" -- bin` finds no cap reader. |
| RUN-19 | A paper with §1 verified, §2 writing and §3 planned: `$P status` prints the title, `current: §2 (write)`, rows with ✓, ⌛ and ⌽, `cost: $X.XX this session / $Y.YY total (cap $5.00)` and `next: write §2`. `LANG=C LC_ALL=C $P status` prints the ASCII glyphs. `tests/tier-contract/status-fields.test.ts` is green. |
| RUN-20 | A fresh `d` holding only A1 as `assignment.txt`: `$P --estimate` prints rows for new, research, outline, plan/write/verify × N (N ≥ 2), compile and done, a non-zero total, the model name, and 0 dials. Configuring `claude-haiku-4-5` lowers the total in proportion to prices; an unknown model shows `(fallback price)`. A fully exported paper prints `nothing left to run ($0.00)`; with §1 verified, there are no §1 rows. Under a pty, `n` exits 0 with 0 mock requests, and `y` dispatches exactly the next router action. |
| RUN-21 | `node --import tsx --test tests/mock-llm.test.ts`: both shapes through the real transport (captured body, text with thinking ignored, call count); each injected failure maps to its RUN-12 or RUN-24 outcome; no listening socket after `close()`. |
| RUN-22 | `node --import tsx --test tests/lock-contention.test.ts` green on the three CI legs. A wave write over 10 independent seeded sections with `maxParallel = 10` against the mock completes with no ELOCKED. |
| RUN-23 | Two concurrent `$P write 1` against a slow mock (`--delay-ms 3000`): the second exits non-zero with `another pensmith session (pid N, started T) is working on this paper`, and section 1 is written once. After `kill -9` of the holder, the next run prints `cleared stale lock`. The MCP-style harness finishes 3 parallel sections and serializes 2 writes to the same section. `$P status` succeeds during a write. A mutating MCP tool during a CLI session gives a structured refusal and changes no file. |
| RUN-24 | A mock with a leading empty thinking block parses to the text, and thinking usage is priced as output. `stop_reason:"refusal"` exits 1 with `provider refused (category: cyber)` and writes nothing. `max_tokens` is retried once with a larger budget, and a second truncation fails with nothing persisted. Captured requests for claude-opus-5, claude-sonnet-5 and claude-haiku-4-5 carry no `temperature`, `top_p`, `top_k` or `budget_tokens` and no trailing assistant message; the haiku request has no `output_config.effort`. |
| RUN-25 | `tests/llm-contracts.test.ts`: for every structured slug, the schema in the captured Anthropic, OpenAI and Ollama bodies is generated from that slug's zod schema, and a changed schema changes all three. With structured output off, prose-wrapped, fenced and trailing-commentary JSON parses, and an invalid reply triggers exactly one corrective retry. OUTLINE.md and PLAN.md are rendered from the validated objects. |
| RUN-26 | With no runtime config, the captured requests show `claude-opus-5` for outline, plan, write and smoother, and `claude-haiku-4-5` for evaluator, query generation, Pass 2 and Pass 4. `[runtime.slugs.claim-support] model = "claude-sonnet-5"` changes only Pass 2. `--model X` changes only generation slugs. `$P status --config` shows each slug's model and source. A unit test shows the projection uses the p90, not `max_tokens`. `$P --estimate` on A1 at default settings projects under $3.50. The live §15 run and the published cost table belong to HARDEN-02. |
| RUN-27 | `$P --dry-run research --yolo` on A2 returns at least 5 `10.0000/pensmith-dryrun.*` sources with 0 dials. `PENSMITH_OFFLINE=1 $P research --yolo` on A2 returns 0 candidates. A section citing a dry-run DOI verifies OK only under `--dry-run`; without it, verify gives FABRICATED, and `compile --yolo` and `done --yolo` exit 4. The installed package resolves the provider (the RUN-05 run). |
| RUN-28 | `tests/gates-registry.test.ts` enumerates `GATES` and drives each wired gate without a terminal, with and without `--yolo`: the documented code or skip, and no mutation. `--yolo` never skips cost-cap, estimate-proceed, detector-consent or paper-pointer. PRD §7.20 carries the table, and the drift test is green. |
| RUN-29 | The CLAUDE.md table lists every Phase 17 chokepoint, and each has a failing fixture (`tests/chokepoints.test.ts`). `grep -rn "eslint-disable" bin mcp hooks tests scripts` shows no new occurrence. The only undici/http/https exemption under `tests/` is the local-servers block. `npm run lint` passes. |
| CONF-01 | The drift test parses the PRD §10 TOML block against the schema. `verify_quotes = false` fails with the §14 explanation. A config without `schema_version` is migrated and written back with `schema_version = 1`, and `schema_version = 99` is refused with an upgrade message. `$P status --config` shows each value and its source. The `config-toml` row passes. |
| CONF-04 | A legacy PLAN.md without `schema_version` is migrated and written back with `schema_version: 1`, otherwise byte-identical. A newer `schema_version` gives an `upgrade pensmith` error. `tests/migrations.test.ts` covers section frontmatter, INTAKE frontmatter and config.toml. `tests/frontmatter-roundtrip.test.ts` preserves `schema_version`. |
| BRDTH-01 | After an offline fixture research run (and, in the live lane, a live run), `LibrarySchema.parse(.paper/LIBRARY.json)` succeeds and `paper://library` returns the entries. With engel2009 present, `$P add 10.1038/nphys1170` prints `already in library as engel2009` and the count is unchanged. A preprint and its version of record collapse to one entry with both DOIs and provenance tags. 5 concurrent upserts lose nothing. The `library-writer` row passes. |
| SEC-01 | `tests/ssrf-pinning.test.ts`: a resolver giving a public IP then 127.0.0.1 leads to a dial of the validated IP. The local SNI server fetch succeeds, and the live-lane Crossref fetch is the maintainer run. The configured local LLM endpoint is allowlisted and pinned. There is no `void Agent`, and `maxRedirections` is 0 (asserted). `.planning/SECURITY.md` row 2a is PROVEN. |
| SEC-03 | `tests/response-size-cap.test.ts`: a local server streaming 60 MB is aborted at the cap, with bounded memory growth asserted. The `arxiv.ts:123` TODO is gone. SECURITY.md has a PROVEN size-cap row. |
| CI-06 | `ci.yml` has matrix `node: ['22','24']` × ubuntu/macOS/Windows, and `grep -rn "node-version: .*20" .github/` is empty. `engines.node` is `>=22.12.0`. doctor FAILs `node-version` under Node < 22.12 (unit test with an injected version). The CI run itself is observed when the maintainer pushes (this workflow never pushes). |
| CI-07 | `PENSMITH_CONTACT_EMAIL=<email> npm run cassettes:refresh -- --only crossref` re-records the Crossref cassettes, and the cassette-no-leak, 51200-byte and offline suites pass on the output. `tests/cassette-provenance.test.ts` fails on any `10.0000/` or `10.1234/example` outside `synthetic/`. |
| CI-09 | `npm test` leaves the sha256 (or absence) of the real `library/index.json` unchanged (the CI step). `node --import tsx --test tests/intake-gitignore.test.ts`, run directly, adds no registry entries to the real data dir. `tests/registry-gc.test.ts` passes. |

After all checks: `npm run check` passes, and `git status` is clean after the build.

## 7. Risks and mitigations

- **Merge conflicts in hot files.** Four streams touch `bin/pensmith.ts`, research.ts, add.ts, verify.ts, done.ts and compile.ts. Mitigation: §4.3 assigns regions separated by unchanged lines. Seams are verbatim. The suggested merge order is given in §4.5. Import-block conflicts are expected and trivial.
- **Behaviour that only exists after merge.** Some checks need two streams together: the mock through the gate, show-prompts ordering, records from both kinds, chokepoint rows enforced by the rule. Mitigation: the §4.5 integration checklist and the §6 checks run after the last merge, and each stream verifies its half standalone (grep for rows, base-API tests).
- **Exact-match replay breaks many offline tests.** Research and verify tests assumed "any query returns the attention fixture". Mitigation: egress re-points tests at recorded queries and DOIs, and re-records cassettes through the new recorder so URL encoding matches. Tests owned by other streams that relied on fuzzy replay (tier-contract research, llm-transport research) are fixed in the integration pass. Their failure mode is loud (0 candidates), never silent.
- **IP pinning bypasses the global dispatcher.** MockAgent tests break. Mitigation: V5 and the test-context-only MockAgent seam; the gate still runs first.
- **Live re-recording needs the network and rate limits.** Mitigation: `PENSMITH_CONTACT_EMAIL`, per-adapter `--only` runs, lower result counts, and the proxy. If an adapter is rate-limited, record it on a later run. Never hand-write a response the real API does not return.
- **Structured output changes NO_LLM behaviour.** Schema-valid outline stubs now register sections instead of looping. Mitigation: tests that asserted the loop are updated to the new behaviour (named in summaries). GRND-19 later completes the chain.
- **Cost projection accuracy (RUN-26).** The shipped p90 defaults decide whether `--estimate` fits under $3.50. Mitigation: defaults sized from the per-slug table with headroom. Measured live costs arrive in HARDEN-02 (Phase 26), and if the default paper cannot fit, the default cap changes under a recorded decision, never the default model (S-22).
- **The OpenAI lineup drifts.** Mitigation: the llm stream verifies ids and prices against the live pricing page at implementation time and records the date.
- **Windows.** Symlinks, lock files, CRLF and path case. Mitigation: junctions instead of symlinks, `path.join`, realpath with case-folding in main-guard and lock, CRLF-safe parsers, and every new spawned-CLI test runs on the three CI legs.
- **The SWEEP-01 branch merges later.** It is expected to touch only `.planning/`. If it touches code, it rebases onto this phase.

## Appendix A — seam file contents

The byte-exact sources are in [seams/](seams/): `V1-exit-codes.ts.txt`, `V2-gates.ts.txt`, `V5-mock-agent.ts.txt`, `V3-http-fetch-options.patch`, `V4-session-log.patch` and `V6-eslint-local-servers.patch`. The patches apply cleanly to the base commit (`git apply --check`), and the copied files typecheck and lint with the base toolchain.
