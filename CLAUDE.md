# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pensmith is a tool for writing academic papers. It ships as a Claude Code plugin (Tier 1) and a portable Node CLI (Tier 2), and both tiers run the same workflow files. The workflow is intake → research → outline → for each section { plan → write → verify } → compile → done. The architecture follows the [Get Shit Done](https://github.com/gsd-build/get-shit-done) plugin and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging.

- `PRD.md` is the spec and the source of truth. Check it before answering design questions, and cite the section (e.g. "per §7.6").
- `.planning/` is managed by GSD. It holds `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `phases/<NN>-*/` (the current milestone's CONTEXT and PLAN docs) and `milestones/<ver>-phases/<NN>-*/` for shipped milestones.
- Status: v0.1.0 (phases 0–10) and v0.2.0 have shipped. v0.3.0 never started and was absorbed into milestone **v1.0.0 "Open Source Release"** (phases 17–27), which is in progress. Its locked decisions are D-V1-01..08 in `.planning/REQUIREMENTS.md`; Phase 17's are D-17-01..49 in `.planning/phases/17-runtime/17-CONTEXT.md` (D-17-46..49 are the review-round-2 additions). Check `.planning/STATE.md` for the current phase.
- Feature work goes through GSD (`/gsd:plan-phase <N>` and related commands). Don't build features outside that flow.
- Bug fixes come from `AUDIT-FINDINGS.md`, whose findings are numbered. Fixes go on branches named `fix/<N>-<slug>`, with commits like `fix(scope): … (#N)`. **`#N` is the audit finding number, not a PR number.**
- Code comments cite decision and threat IDs such as `D-12`, `D-17-43`, `T-3-10`, `WR-03`, `Pitfall 7` and `C4-HIGH`. These are defined in the phase CONTEXT/RESEARCH docs under `.planning/`. Grep there to find out why an odd-looking constraint exists before you "simplify" it.

## Commands

Requires Node ≥ 22.12 (the supported LTS lines are 22 and 24; CI runs both on Ubuntu, macOS arm64 and Windows). ESM with strict TypeScript (`NodeNext`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).

```bash
npm ci
npm run build              # prebuild (generates gitignored bin/lib/version.generated.ts + bin/lib/verbs.json), then tsc → dist/
npm run lint               # eslint . (enforces the architectural chokepoints below)
npm run typecheck          # tsc --noEmit
npm test                   # scripts/run-tests.mjs: discovers tests/**/*.test.ts, isolates the data dir, runs `node --import tsx --test`
npm run test:tier-contract # Tier 1 ↔ Tier 2 equivalence gate (tests/tier-contract.test.ts + tests/tier-contract/)
npm run test:coverage      # c8; CI gate is 80% lines/statements, 66% functions/branches
npm run check              # full local gate: prebuild, lint, typecheck, build, tier-contract, test, manifest validation

# Single test file / single test (the data dir is isolated here too — see below)
node --import tsx --test tests/doi.test.ts
node --import tsx --test --test-name-pattern="idempot" tests/doi.test.ts
node scripts/run-tests.mjs tests/tier-contract/        # a file or directory through the runner

# Run the CLI from source
npm run pensmith -- doctor
PENSMITH_NO_LLM=1 npx tsx bin/pensmith.ts status
```

Gotchas:
- On a fresh clone, run `npm run prebuild` (or `build`) before `lint` or `typecheck`. Both import `version.generated.js`, which doesn't exist until prebuild runs.
- Some tests spawn the **built** `dist/bin/pensmith.js` or `dist/mcp/server.js`: tier-contract, section-isolation, cli-stubs, doctor-exit-code, llm-transport, doctor-probes-cwd-independence, library-writer (the research → `paper://library` path) and installed-bin (which `npm pack`s the package and `npm install -g`s it from a loopback registry built from `package-lock.json` and the npm cache). Run `npm run build` after changing source, or those tests exercise stale code.
- **Three orthogonal modes (D-V1-01, S-15).** A real user is **live by default**: research, `add`, Pass 1/Pass 3 re-fetch, retraction and freshness checks, plagiarism and GPTZero talk to the real services with no env var set. *Sources offline* — `PENSMITH_OFFLINE=1`, or the test runner (`NODE_TEST_CONTEXT` / `PENSMITH_TEST=1`) unless `PENSMITH_NETWORK_TESTS=1` — replays exact recorded fixtures from `tests/fixtures/cassettes/` or fails closed (`OfflineEgressError`; Pass 1 records UNVERIFIABLE, which blocks compile and done); only an explicitly configured loopback LLM endpoint stays reachable. *LLM stubbed* — `PENSMITH_NO_LLM=1` — replaces every model call with a deterministic stub (schema-valid objects for structured slugs, a `[PENSMITH_NO_LLM placeholder — …]` string for prose) and leaves the network mode alone. *`--dry-run`* does both, opens zero sockets and uses the labelled synthetic source provider (`10.0000/pensmith-dryrun.*`). Offline and stubbed runs print one stderr banner each; offline artifacts carry a marker line that never reaches an export.
- **Tests never touch the real data dir (CI-09, D-17-40).** `scripts/run-tests.mjs` points `XDG_DATA_HOME`, `LOCALAPPDATA` and `PENSMITH_TEST_DATA_DIR` at a per-run temp dir and sets `PENSMITH_TEST=1`. Under a test context `paths.ts` honours a platform data-dir variable only when it lies inside `os.tmpdir()`, else `PENSMITH_TEST_DATA_DIR`, else a per-process temp dir — so single-file runs and spawned CLI children are isolated too, and macOS (whose data dir derives from `HOME`) is covered. CI fingerprints the real data dir before and after the tests (`scripts/data-dir-fingerprint.mjs`). A test that spawns the CLI *without* a test context must set the data-dir variables itself (and `HOME` on macOS).
- As root, as in cloud containers, the `tests/atomic-write.test.ts` case "preserves OLD content on rename/write failure" fails because `chmod 0o500` doesn't block root. It passes in CI.
- CI runs on Ubuntu, macOS arm64 and Windows. It fails if the build leaves the working tree dirty. Use `path.join`, not shell globs or hardcoded `/`. Line endings are LF. Symlinks become junctions on Windows (the installed-bin test does this).

## Architecture

### Two tiers, one set of workflow files

- **Tier 2 CLI**: `bin/pensmith.ts` (citty). The 16 verbs are **locked** in `bin/lib/verbs.ts` (`UX02_VERBS`), with no 17th verb; `VERB_ALIASES` rewrites aliases before dispatch, and an unknown verb or flag is a usage error (exit 2) with a did-you-mean. Each verb maps to exactly one `workflows/<verb>.md`, and every body needs a `<capability_check>` block (`scripts/validate-plugin-manifest.cjs` enforces this). Verbs get implementations through `REAL_VERB_LOADERS`, which points at `bin/cli/<verb>.ts` (`new` loads `bin/cli/intake.ts`). The global flags `--dry-run`, `--estimate`, `--yolo`, `--show-prompts`, `--runtime <provider>`, `--model <id>` and `--paper <name|path>` are pre-parsed before citty dispatches. New sub-features live under existing verbs, e.g. export and humanize are part of `done`. The entry guard is `bin/lib/main-guard.ts` `isMainModule(import.meta.url)` (realpath comparison), so `npm i -g`, `npm link` and symlinked roots run.
- **Exit codes and one-line failures (RUN-09, RUN-12).** `bin/lib/exit-codes.ts`: `0` OK, `1` EXIT_ERROR, `2` EXIT_USAGE, `3` EXIT_APPROVAL, `4` EXIT_BLOCKED, `5` EXIT_COST_CAP. An expected failure throws a `PensmithError` subclass (e.g. `LockTimeoutError`, the provider errors) and the dispatcher prints `pensmith: <message>` with its code — never a stack trace (`PENSMITH_DEBUG=1` shows one for unexpected errors).
- **Gates (RUN-28).** `bin/lib/gates.ts` is the one registry of interactive decision points, each with whether `--yolo` skips it and its non-TTY exit code. `--yolo` never skips the cost cap, `--estimate` proceed, detector consent or the active-paper pointer.
- **Tier 1 plugin**: `.claude-plugin/plugin.json` registers `skills/*.md` and the stdio MCP server `dist/mcp/server.js`. `mcp/` exposes `paper://` resources (state, outline, section/{n}, library, capabilities) and granular `paper_*` tools. It is a **thin shim** over `bin/lib/*`: handlers have at most 30 statements and use no fs or network. Never `console.log` in `mcp/`, because it corrupts the stdio frame. `hooks/` holds the SessionStart, PreCompact, PostToolUse and Stop hooks.
- **Routing**: a bare `/pensmith`, `next` and `resume` all go through `bin/lib/router.ts` `resolveNextAction`. It is a pure, total function over STATE.json and each section's PLAN.md frontmatter. It never throws and deliberately ignores HANDOFF.json. `skills/pensmith.md` only maps natural language to verbs, and it must not duplicate router logic.
- **Parity**: `tests/tier-contract.test.ts` (and the cases under `tests/tier-contract/`) spawns both tiers and asserts they behave the same. If they diverge, fix the shipped code in one tier. Don't add a normalizer, loosen the assertion or skip the test (see CONTRIBUTING.md "Tier contract — do not skip").

### Paper workspace

A paper lives in `.paper/` under the **project root** — the folder that contains `.paper/` (D-17-32). Every loader (`loadState`, `loadOutline`, `loadSection`, `loadLibrary`, `config.ts`, COSTS, SESSION.log) takes the project root and resolves `.paper/` itself. The active paper is resolved once per invocation (`paths.ts` `resolvePaperRoot`, S-21): `--paper` or `PENSMITH_PAPER_ROOT` (the project root), then a cwd containing `.paper/`, then a new paper for `new` or a bare run with an assignment, then the `pensmith open` pointer (read-only verbs follow it with a banner; mutating verbs ask, or refuse with exit 2; `--yolo`, the MCP server and the hooks never follow it). `.paper/` contains `STATE.json`, `INTAKE.md`, `config.toml` (read and written only by `bin/lib/config.ts`, `schema_version` + migrations), `LIBRARY.json`, `RESEARCH.md`, `OUTLINE.md`, `CITATIONS.bib`, `CITATIONS.ris`, `SESSION.log` (the per-paper session log), `COSTS.jsonl` (the per-paper cost ledger), `sections/<NN>-<slug>/{PLAN,DRAFT,VERIFICATION}.md`, the compiled `DRAFT.md`, `COMPILE-REPORT.md` and `export/` (whose `CITATIONS.bib`/`.ris` hold only the cited sources). A run from inside `.paper/` (or deeper) addresses the paper in the folder that holds it (`asProjectRoot`). A legacy root-level STATE.json or config.toml is moved into `.paper/` once, under lock. `OUTLINE.md` is a markdown table whose columns include `depends_on` and `assigned_sources`. App state lives **outside** the repo in `pensmithDataDir()` (`%LOCALAPPDATA%`, `~/Library/Application Support` or `$XDG_DATA_HOME`), because `.paper/` may sit in a sync folder. That state includes locks, the HTTP cache, the global library registry, the global `runtime.json` (the only place an LLM `endpoint` / `api_key_env` may be set), the active-paper pointer, and the global `session.log` that records a run with no paper (a paper's own SESSION.log and COSTS.jsonl live in its `.paper/`).

Section lifecycle is the PLAN.md frontmatter `status`: `planned → writing → written → verifying → verified | failed | unverifiable`. PLAN.md frontmatter carries `schema_version` and is read through `frontmatter.ts` `loadFrontmatterDoc`. `verify` owns `verified_against_draft_hash`, and compile uses it to flag drafts edited after verification.

### Pipeline modules (bin/lib)

- **State**: `state.ts` composes `withLock` (`lock.ts`), `atomicWriteFile` and `loadAndMigrate`. Every persisted JSON carries a `$schemaVersion`. Adding a field to a persisted schema requires a new `bin/lib/migrations/<kind>/vN_to_vN+1.ts` and a version bump in the same change (S-20). The zod schemas live in `bin/lib/schemas/`.
- **Locks**: `lock.ts` `withLock` is an in-process FIFO per canonical resource, then one proper-lockfile attempt, then jittered 5→250 ms backoff until `timeoutMs`; the holder records `owner.json` (PID, host, times) in the lock directory, a dead holder on the same host is cleared at once, and a timeout throws `LockTimeoutError(resource, holderPid)` (RUN-22). It is not re-entrant. `session-lock.ts` is the separate per-paper session lock for mutating verbs (RUN-23).
- **Research**: `research-orchestrator.ts` fans out over the `sources/*` adapters: OpenAlex, Crossref, arXiv, PubMed, Semantic Scholar, Unpaywall, Zotero MCP and Retraction Watch (and the synthetic dry-run provider under `--dry-run`), then writes `.paper/RESEARCH.md`.
- **Library (BRDTH-01)**: `library.ts` `upsertSources` is the one writer of `LIBRARY.json` (schema v2) and renders `CITATIONS.bib` and `CITATIONS.ris` from it. Every ingest path (research, `add`, `plan --research`, later BYO and Zotero) calls it. It dedups by normalized DOI, then arXiv id / PMID / PMCID / ISBN, then the preprint ↔ version-of-record rule, merges the richer metadata and provenance, and never changes an existing citekey. Alternate DOIs are candidates only (VRFY-14). `compile` never rewrites the bib.
- **Write**: the drafter only sees the section's `assigned_sources` (PRD §7.6), enforced by `drafter-input.ts` `assertDrafterInput`, which throws on any extra or missing field. Wave mode (`write` with no section) runs `scheduler.ts` `buildWaveGraph` (from `depends_on` plus `wave:` overrides) and `write-orchestrator.ts`. It is stateless and every node goes through the single-section drafter.
- **Verify**: `verify/pass1.ts` handles DOI/arXiv/PMID re-fetch plus the author/title fuzzy match → FABRICATED, MIS-CITED or (offline, no fixture) UNVERIFIABLE. `verify/pass3.ts` checks quotes → NOT_FOUND. Passes 1 and 3 are deterministic and **blocking**. `pass2.ts` (claim support) and `pass4.ts` (orphans) are advisory only. `citation-token.ts` extracts `[@citekey]` tokens and `verify/verdict-rows.ts` parses VERIFICATION.md.
- **Compile / done**: `compile.ts` holds the refuse-gate. `bin/cli/done.ts` and `exporter.ts` handle the humanizer wrap, Pandoc export and zero-trace output. `honesty.ts` covers GPTZero (explicit consent; `--yolo` never grants it) and `plagiarism.ts` covers DuckDuckGo phrase checks. CSL styles live in `templates/citation-styles/`.
- **HTTP**: `http.ts` `callOnce` is the one egress gate: network mode (`http-mock.ts` `networkMode()`), exact-fixture replay or refusal, DNS resolve + validate for every host, a per-request dispatcher pinned to the validated IP, the `--show-prompts` mirror, a streamed body under `maxBytes`, and a `kind:"http"` SESSION.log record.
- **LLM**: `anthropic.ts` is the only module that calls a completion API — Anthropic Messages, OpenAI chat completions, and the OpenAI-compatible Ollama / vLLM / `openai-compatible` runtimes — and all I/O goes through `http.ts` with `llm: {endpoint}`. The SDKs are imported for **types only**. `llm-models.ts` holds the model table (default `claude-opus-5`; judgment slugs on `claude-haiku-4-5`) and the per-slug table; `llm-contracts.ts` maps each structured slug to one zod schema (native structured output where supported); `pricing.ts` never throws on an unknown model. The per-session cost cap (`[budget] cost_cap_usd`, default $5, `PENSMITH_COST_CAP_USD`) is checked before every call; every call is a `kind:"llm"` record in `.paper/SESSION.log` (keys never logged) and can be replayed with `resume --replay <id>`.
- **Educator/tutorial mode**: `tutorial.ts` is the **only** module that knows about `goal`. `tests/lint-tutorial-no-branch.test.ts` fails if `goal` or learning-mode vocabulary appears in any other `bin/lib` file or workflow body.

### Chokepoints

Each concern below may live only in the named module. Rows marked `row:` are enforced by the data-driven ESLint rule `pensmith/chokepoint` (`scripts/eslint-rules/chokepoint.mjs`) from `scripts/chokepoints/<id>.json`, with a failing fixture in `tests/fixtures/chokepoints/` that `tests/chokepoints.test.ts` lints; that harness also re-checks the file-regex and import-graph rows on the whole tree.

| Concern | Only allowed in | Enforced by |
|---|---|---|
| `undici` / `http` / `https` imports — the http.ts egress gate (mode, fixtures, SSRF validate + IP pin, size cap, mirror, http record) | `bin/lib/http.ts` | `no-restricted-imports`; `tests/egress-gate.test.ts` |
| Reading `PENSMITH_NETWORK_TESTS` (the one test-lane live seam) | `bin/lib/http-mock.ts` | row: `network-tests-seam` (RUN-01) |
| Network imports under `tests/` (`node:http`/`https`/`http2`/`net`/`tls`, `undici`) | `tests/helpers/local-servers/` (the V6 block) | row: `tests-network-imports` (RUN-29) |
| Resolving a `tests/` path at runtime (the package ships no tests/) | `bin/lib/http-mock.ts` | row: `tests-path-at-runtime` (RUN-05) |
| LLM provider transports (API paths, provider headers) | `bin/lib/anthropic.ts` | row: `llm-transport-single-module` (RUN-29) |
| Value imports of `@anthropic-ai/sdk` / `openai` (type-only imports are fine) | nowhere | row: `llm-sdk-types-only` (audit #7) |
| `.paper/config.toml` reads and writes, `smol-toml` | `bin/lib/config.ts` (paths.ts / state.ts may name it for the legacy move) | row: `config-toml` (CONF-01) |
| STATE.json path construction | `bin/lib/paths.ts`, `bin/lib/state.ts` | row: `state-json` (RUN-13) |
| `process.cwd()` as a paper root | `bin/lib/paths.ts` (`projectRoot()` / `resolvePaperRoot`) | row: `process-cwd-paper-root` (RUN-14) |
| `ask()` (interactive prompts) | `bin/lib/gates.ts`, content-question verbs (`sketch`) | row: `gate-registry` (RUN-28) |
| Writing `LIBRARY.json` / `CITATIONS.bib` / `CITATIONS.ris`, importing the BibTeX/RIS writers | `bin/lib/library.ts` | row: `library-writer` (BRDTH-01) |
| Comparing a module with `process.argv[1]` (the main guard) | `bin/lib/main-guard.ts` | row: `main-guard` (RUN-10) |
| A new inline `eslint-disable` / `eslint-enable` / rule-config comment | nowhere (the 12 pre-existing directives are the baseline; each entry must equal its file's count) | row: `no-new-eslint-disable` (RUN-29) |
| Reading `templates/prompts/*.md` | `bin/lib/prompt-loader.ts` | row: `prompt-loader` (D-12) |
| DOI regex `/^10\./` | `bin/lib/doi.ts` | `no-restricted-syntax`; `tests/lint-chokepoint.test.ts` |
| `fs.writeFile` | `bin/lib/atomic-write.ts` | `no-restricted-syntax`; `tests/lint-atomic-write-chokepoint.test.ts` |
| `os.homedir()`, `process.env.{LOCALAPPDATA,APPDATA,XDG_DATA_HOME}` | `bin/lib/paths.ts` | `no-restricted-syntax`; `tests/lint-paths-chokepoint.test.ts` |
| `pdf-parse` | `bin/lib/pdf-text.ts` (PyMuPDF fallback in `pymupdf-shellout.ts`) | `no-restricted-imports` |
| `citation-js` | `bin/lib/citations.ts` | `no-restricted-imports` |
| `mcp/**`: no fs imports, no `*.createServer`/`new Server`, no computed `process.env[…]`, no secret helpers; `paper://capabilities` emits presence booleans only | — | `no-restricted-imports` / `no-restricted-syntax`; `tests/lint-thin-shim.test.ts`, `tests/lint-mcp-no-network.test.ts`, `tests/lint-capabilities-noleak.test.ts` |
| Citation regexes (`\[@`, `@\{`) — one Pandoc citation grammar | `bin/lib/citation-token.ts` | enforced from VRFY-09 |
| Discipline literals | `bin/lib/disciplines.ts` | enforced from GRND-06 |
| `process.stdout.write` / `console.log` in `bin/lib` and in `bin/cli` code reachable from `mcp/` (the output sink) | the injected output sink | enforced from PLUG-13 (lint rule + import-graph row) |
| `mcp/` reaching `bin/lib/anthropic.ts` through its import graph | nowhere | enforced from PLUG-06 (import-graph row) |
| The committed plugin bundles (`plugin/`) | ESLint `ignores` + every grep test's exclusions; lint runs on the bundles' sources | enforced from PLUG-02 |

When a chokepoint fires, restructure the code, usually by adding a `bin/lib` helper. Never add `eslint-disable` (the `no-new-eslint-disable` row fails the build). A test that has to redirect data dirs through env vars gets a narrowly scoped exemption block in `eslint.config.js`, following the existing groups there; every local test server (the mock LLM, the TLS/SNI and streaming servers, the MockAgent helper, the loopback npm registry) lives in `tests/helpers/local-servers/` under the one V6 exemption. Some ESLint overrides re-list the project-wide selectors because flat config lets the last match win; keep those lists in sync. New chokepoints are new rows: add `scripts/chokepoints/<id>.json` (kinds `string-literal`, `import`, `call`, `member`, `file-regex`, `import-graph`), its `tests/fixtures/chokepoints/<id>.violation.ts.txt`, and a line in this table, in the same change.

### Phase 17 seams (D-17-02)

Phase 17 was built by four parallel streams (egress, llm, paper-cli, foundations) around six byte-exact seam files in `.planning/phases/17-runtime/seams/`: V1 `bin/lib/exit-codes.ts`, V2 `bin/lib/gates.ts`, V3 `FetchOptions.llm` / `maxBytes` in `http.ts`, V4 the `llm` / `http` session-log kinds and `isMirrorPromptsEnabled()`, V5 `tests/helpers/local-servers/mock-agent.ts`, and V6 the local-servers exemption block in `eslint.config.js`. Until Phase 17 is merged, edit neither a seam file nor the lines around a seam hunk; afterwards they are ordinary code.

### Hash-pinned files (edit = re-pin in the same change)

- `templates/prompts/*.md`: pinned both in `EXPECTED_PROMPT_HASHES` (`bin/lib/prompt-loader.ts`, checked again at runtime) and in `tests/repo-files.test.ts`. Update both together. Adding or renaming a prompt slug is a locked decision (D-12).
- `references/*.md` (`honesty-framing.md`, `doctor-output.md`, `http-warnings.md`), the zero-trace fixtures, `tests/fixtures/assignment.txt` and `known-bad-citations.json`: pinned in `tests/repo-files.test.ts`. The comments there give the `node -e` command to recompute each hash.
- `honesty-framing.md` is rendered verbatim and must stay transparency-only. It must never claim output is undetectable.
- Cassettes must stay ≤ 51200 bytes and must contain no `Authorization`, `Cookie`, `Set-Cookie` or `X-Api-Key` headers. Re-record them with `npm run cassettes:refresh`; the workflow is in CONTRIBUTING.md.

## Non-negotiables (PRD §14, §19)

- **Section-as-phase.** A paper is a project, a section is a phase, the outline is the roadmap, and compile is milestone completion. Each section's state is isolated by its `.paper/sections/<NN>-<slug>/` directory. Re-doing section 3 never touches the other sections (`tests/section-isolation*.test.ts` checks mtimes), and the verifier runs bounded per section. **This is the load-bearing design choice. Push back on anything that weakens it.**
- **Two-tier architecture.** Both tiers work from the same workflow files. Workflow bodies use `<capability_check>` blocks to degrade gracefully when Task, MCP or AskUserQuestion are unavailable.
- **Single-command UX.** `/pensmith` is the only command in the README quick start. Everything else is a power-user fallback.
- **The verifier blocks compile and export.** No FABRICATED, MIS-CITED, UNVERIFIABLE or quote-NOT_FOUND citation ever leaves a section. Pass 1 includes the author/title fuzzy match, because DOI integrity is necessary but not sufficient. Any path that makes an unparseable citation look "absent" instead of failing closed is a gate bypass (see AUDIT-FINDINGS #2, #3).
- **No trace in exported documents.** No metadata stamp, footer, offline marker or pensmith fingerprint (`tests/zero-trace-export.test.ts`). The README disclaimer (PRD §3) is the only disclosure.
- **Honest framing on detection.** The GPTZero score is shown for transparency, never as "we make it undetectable". The humanizer "improves prose"; it does not "evade detection".
- **Approval gates are on by default.** Outline approval and export confirmation are skipped only with `--yolo`; `--yolo` never skips the cost cap, the estimate confirmation or detector consent.

## Deliberate user choices (don't second-guess)

- No metadata in exports. The user chose zero trace against Claude's recommendation, and we honor it.
- Style-match to past writing ships as an opt-in, built from plain statistics into a per-paper `.paper/STYLE.json`, with an honest dual-use disclosure in the README.
- The plagiarism check uses only free services (distinctive phrases via DuckDuckGo). Paid services were rejected.
- `--yolo` exists but is off by default.
- The user's installed `humanizer` skill (`~/.claude/skills/humanizer/`) is the humanize backend, and pensmith wraps it. If it's missing, `done` skips the humanize step.

## Answering during development

- Be direct. "No, that conflicts with X" is better than diplomatic hedging.
- Cite the PRD section behind a decision.
- If a question exposes a real ambiguity in the PRD, say so and propose an edit.
- Don't drift the architecture in conversation. If a request would change it, say so explicitly and ask.
- Most PRD §17 open questions are answered in the shipped code: MCP SDK `@modelcontextprotocol/sdk` v1, `pdf-parse` plus a PyMuPDF fallback, JSON `LIBRARY.json`, statistical style-match, and `depends_on` plus `wave:` overrides for scheduling. Check the code and `.planning/` before treating any of them as open.
- To look up GSD mechanics, clone the reference repos. Pensmith adapts their patterns but doesn't copy their code.
  ```bash
  git clone --depth 1 https://github.com/gsd-build/get-shit-done /tmp/refs/gsd-original
  git clone --depth 1 https://github.com/jnuyens/gsd-plugin     /tmp/refs/gsd-plugin
  ```
