# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pensmith is a tool for writing academic papers. It ships as a Claude Code plugin (Tier 1) and a portable Node CLI (Tier 2), and both tiers run the same workflow files. The workflow is intake → research → outline → for each section { plan → write → verify } → compile → done. The architecture follows the [Get Shit Done](https://github.com/gsd-build/get-shit-done) plugin and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging.

- `PRD.md` is the spec and the source of truth. Check it before answering design questions, and cite the section (e.g. "per §7.6").
- `.planning/` is managed by GSD. It holds `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` and `milestones/<ver>-phases/<NN>-*/` with each phase's CONTEXT, RESEARCH, PLAN and SUMMARY docs.
- Status: v0.1.0 (phases 0–10) and v0.2.0 have shipped. Milestone **v0.3.0 "Truly End-to-End"** (phases 17–19) is in progress. Check `.planning/STATE.md` for the current phase.
- Feature work goes through GSD (`/gsd:plan-phase <N>` and related commands). Don't build features outside that flow.
- Bug fixes come from `AUDIT-FINDINGS.md`, whose findings are numbered. Fixes go on branches named `fix/<N>-<slug>`, with commits like `fix(scope): … (#N)`. **`#N` is the audit finding number, not a PR number.**
- Code comments cite decision and threat IDs such as `D-12`, `T-3-10`, `WR-03`, `Pitfall 7` and `C4-HIGH`. These are defined in the phase CONTEXT/RESEARCH docs under `.planning/`. Grep there to find out why an odd-looking constraint exists before you "simplify" it.

## Commands

Requires Node ≥ 20.10. ESM with strict TypeScript (`NodeNext`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).

```bash
npm ci
npm run build              # prebuild (generates gitignored bin/lib/version.generated.ts + bin/lib/verbs.json), then tsc → dist/
npm run lint               # eslint . (enforces the architectural chokepoints below)
npm run typecheck          # tsc --noEmit
npm test                   # scripts/run-tests.mjs: discovers tests/**/*.test.ts, runs `node --import tsx --test`
npm run test:tier-contract # Tier 1 ↔ Tier 2 equivalence gate
npm run test:coverage      # c8; CI gate is 80% lines/statements, 66% functions/branches
npm run check              # full local gate: prebuild, lint, typecheck, build, tier-contract, test, manifest validation

# Single test file / single test
node --import tsx --test tests/doi.test.ts
node --import tsx --test --test-name-pattern="idempot" tests/doi.test.ts

# Run the CLI from source
npm run pensmith -- doctor
PENSMITH_NO_LLM=1 npx tsx bin/pensmith.ts status
```

Gotchas:
- On a fresh clone, run `npm run prebuild` (or `build`) before `lint` or `typecheck`. Both import `version.generated.js`, which doesn't exist until prebuild runs.
- Some tests spawn the **built** `dist/bin/pensmith.js` or `dist/mcp/server.js`: tier-contract, section-isolation, cli-stubs, doctor-exit-code, llm-transport and doctor-probes-cwd-independence. Run `npm run build` after changing source, or those tests exercise stale code.
- Tests run offline. HTTP replays the cassettes in `tests/fixtures/cassettes/` unless `PENSMITH_NETWORK_TESTS=1` is set. `PENSMITH_NO_LLM=1` makes LLM calls return a `[PENSMITH_NO_LLM placeholder — …]` string.
- As root, as in cloud containers, the `tests/atomic-write.test.ts` case "preserves OLD content on rename/write failure" fails because `chmod 0o500` doesn't block root. It passes in CI.
- CI runs on Ubuntu, macOS arm64 and Windows. It fails if the build leaves the working tree dirty. Use `path.join`, not shell globs or hardcoded `/`. Line endings are LF.

## Architecture

### Two tiers, one set of workflow files

- **Tier 2 CLI**: `bin/pensmith.ts` (citty). The 16 verbs are **locked** in `bin/lib/verbs.ts` (`UX02_VERBS`), with no 17th verb. Each verb maps to exactly one `workflows/<verb>.md`, and every body needs a `<capability_check>` block (`scripts/validate-plugin-manifest.cjs` enforces this). Verbs get implementations through `REAL_VERB_LOADERS`, which points at `bin/cli/<verb>.ts` (`new` loads `bin/cli/intake.ts`). The global flags `--dry-run`, `--estimate`, `--yolo` and `--show-prompts` are pre-parsed before citty dispatches. New sub-features live under existing verbs, e.g. export and humanize are part of `done`.
- **Tier 1 plugin**: `.claude-plugin/plugin.json` registers `skills/*.md` and the stdio MCP server `dist/mcp/server.js`. `mcp/` exposes `paper://` resources (state, outline, section/{n}, library, capabilities) and granular `paper_*` tools. It is a **thin shim** over `bin/lib/*`: handlers have at most 30 statements and use no fs or network. Never `console.log` in `mcp/`, because it corrupts the stdio frame. `hooks/` holds the SessionStart, PreCompact, PostToolUse and Stop hooks.
- **Routing**: a bare `/pensmith`, `next` and `resume` all go through `bin/lib/router.ts` `resolveNextAction`. It is a pure, total function over STATE.json and each section's PLAN.md frontmatter. It never throws and deliberately ignores HANDOFF.json. `skills/pensmith.md` only maps natural language to verbs, and it must not duplicate router logic.
- **Parity**: `tests/tier-contract.test.ts` spawns both tiers and asserts they behave the same. If they diverge, fix the shipped code in one tier. Don't add a normalizer, loosen the assertion or skip the test (see CONTRIBUTING.md "Tier contract — do not skip").

### Paper workspace

A paper lives in `.paper/` under the project root (`paths.ts` `paperDir()`; `PENSMITH_PAPER_ROOT` overrides it for the MCP server and tests). It contains `STATE.json`, `INTAKE.md`, `config.toml`, `LIBRARY.json`, `RESEARCH.md`, `OUTLINE.md`, `CITATIONS.bib`, `sections/<NN>-<slug>/{PLAN,DRAFT,VERIFICATION}.md`, the compiled `DRAFT.md`, `COMPILE-REPORT.md` and `export/`. `OUTLINE.md` is a markdown table whose columns include `depends_on` and `assigned_sources`. App state lives **outside** the repo in `pensmithDataDir()` (`%LOCALAPPDATA%`, `~/Library/Application Support` or `$XDG_DATA_HOME`), because `.paper/` may sit in a sync folder. That state includes locks, the HTTP cache, the global library registry, the cost ledger and session logs.

Section lifecycle is the PLAN.md frontmatter `status`: `planned → writing → written → verifying → verified | failed | unverifiable`. `verify` owns `verified_against_draft_hash`, and compile uses it to flag drafts edited after verification.

### Pipeline modules (bin/lib)

- **State**: `state.ts` composes `withLock` (`lock.ts`), `atomicWriteFile` and `loadAndMigrate`. Every persisted JSON carries a `$schemaVersion`. Adding a field to a persisted schema requires a new `bin/lib/migrations/state/vN_to_vN+1.ts` and a bump of `CURRENT_STATE_VERSION`. The zod schemas live in `bin/lib/schemas/`.
- **Research**: `research-orchestrator.ts` fans out over the `sources/*` adapters: OpenAlex, Crossref, arXiv, PubMed, Semantic Scholar, Unpaywall, Zotero MCP and Retraction Watch.
- **Write**: the drafter only sees the section's `assigned_sources` (PRD §7.6), enforced by `drafter-input.ts` `assertDrafterInput`, which throws on any extra or missing field. Wave mode (`write` with no section) runs `scheduler.ts` `buildWaveGraph` (from `depends_on` plus `wave:` overrides) and `write-orchestrator.ts`. It is stateless and every node goes through the single-section drafter.
- **Verify**: `verify/pass1.ts` handles DOI/arXiv/PMID re-fetch plus the author/title fuzzy match → FABRICATED or MIS-CITED. `verify/pass3.ts` checks quotes → NOT_FOUND. Passes 1 and 3 are deterministic and **blocking**. `pass2.ts` (claim support) and `pass4.ts` (orphans) are advisory only. `citation-token.ts` extracts `[@citekey]` tokens and `verify/verdict-rows.ts` parses VERIFICATION.md.
- **Compile / done**: `compile.ts` holds the refuse-gate. `bin/cli/done.ts` and `exporter.ts` handle the humanizer wrap, Pandoc export and zero-trace output. `honesty.ts` covers GPTZero and `plagiarism.ts` covers DuckDuckGo phrase checks. CSL styles live in `templates/citation-styles/`.
- **LLM**: `anthropic.ts` is the only place that calls a completion API. The Anthropic and OpenAI SDKs are imported for **types only**, and all I/O goes through `http.ts`. `assertBudget` runs before every call.
- **Educator/tutorial mode**: `tutorial.ts` is the **only** module that knows about `goal`. `tests/lint-tutorial-no-branch.test.ts` fails if `goal` or learning-mode vocabulary appears in any other `bin/lib` file or workflow body.

### Chokepoints (ESLint + tests enforced)

| Concern | Only allowed in |
|---|---|
| `undici` / `http` / `https` imports (SSRF guard, rate limits, retry, cache) | `bin/lib/http.ts` |
| DOI regex `/^10\./` | `bin/lib/doi.ts` |
| `fs.writeFile` | `bin/lib/atomic-write.ts` |
| `os.homedir()`, `process.env.{LOCALAPPDATA,APPDATA,XDG_DATA_HOME}` | `bin/lib/paths.ts` |
| `pdf-parse` | `bin/lib/pdf-text.ts` (PyMuPDF fallback in `pymupdf-shellout.ts`) |
| `citation-js` | `bin/lib/citations.ts` |
| Reading `templates/prompts/*.md` | `bin/lib/prompt-loader.ts` |
| `mcp/**` | no fs imports, no `*.createServer`/`new Server`, no computed `process.env[…]`, no secret helpers; `paper://capabilities` emits presence booleans only |

When a chokepoint fires, restructure the code, usually by adding a `bin/lib` helper. Never add `eslint-disable`. A test that has to redirect data dirs through env vars gets a narrowly scoped exemption block in `eslint.config.js`, following the existing groups there. Some ESLint overrides re-list the project-wide selectors because flat config lets the last match win. Keep those lists in sync.

### Hash-pinned files (edit = re-pin in the same change)

- `templates/prompts/*.md`: pinned both in `EXPECTED_PROMPT_HASHES` (`bin/lib/prompt-loader.ts`, checked again at runtime) and in `tests/repo-files.test.ts`. Update both together. Adding or renaming a prompt slug is a locked decision (D-12).
- `references/*.md` (`honesty-framing.md`, `doctor-output.md`, `http-warnings.md`), the zero-trace fixtures, `tests/fixtures/assignment.txt` and `known-bad-citations.json`: pinned in `tests/repo-files.test.ts`. The comments there give the `node -e` command to recompute each hash.
- `honesty-framing.md` is rendered verbatim and must stay transparency-only. It must never claim output is undetectable.
- Cassettes must stay ≤ 51200 bytes and must contain no `Authorization`, `Cookie`, `Set-Cookie` or `X-Api-Key` headers. The refresh workflow is in CONTRIBUTING.md.

## Non-negotiables (PRD §14, §19)

- **Section-as-phase.** A paper is a project, a section is a phase, the outline is the roadmap, and compile is milestone completion. Each section's state is isolated by its `.paper/sections/<NN>-<slug>/` directory. Re-doing section 3 never touches the other sections (`tests/section-isolation*.test.ts` checks mtimes), and the verifier runs bounded per section. **This is the load-bearing design choice. Push back on anything that weakens it.**
- **Two-tier architecture.** Both tiers work from the same workflow files. Workflow bodies use `<capability_check>` blocks to degrade gracefully when Task, MCP or AskUserQuestion are unavailable.
- **Single-command UX.** `/pensmith` is the only command in the README quick start. Everything else is a power-user fallback.
- **The verifier blocks compile and export.** No FABRICATED, MIS-CITED or quote-NOT_FOUND citation ever leaves a section. Pass 1 includes the author/title fuzzy match, because DOI integrity is necessary but not sufficient. Any path that makes an unparseable citation look "absent" instead of failing closed is a gate bypass (see AUDIT-FINDINGS #2, #3).
- **No trace in exported documents.** No metadata stamp, footer or pensmith fingerprint (`tests/zero-trace-export.test.ts`). The README disclaimer (PRD §3) is the only disclosure.
- **Honest framing on detection.** The GPTZero score is shown for transparency, never as "we make it undetectable". The humanizer "improves prose"; it does not "evade detection".
- **Approval gates are on by default.** Outline approval and export confirmation are skipped only with `--yolo`.

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
