---
phase: 23a-plugin-packaging
milestone: v1.0.0
branch: v1/p23a
base: c8f28e3
closed_at: 2026-09-30
closed_at_commit: 03d1654 (the closer's gate, smoke and live checks ran here; this SUMMARY lands in the closing docs commit on top)
status: closed — 6 of 8 requirements Complete, 2 Pending on maintainer items
requirements_complete: [PLUG-01, PLUG-02, PLUG-03, PLUG-05, PLUG-13, PLUG-14]
requirements_pending: [PLUG-04, CI-05]
decisions: D-23a-01..20 (23a-CONTEXT.md, amended in review rounds 1-3)
verification: 23a-VERIFICATION.md
---

# Phase 23a: Plugin Packaging (PLUGIN-PACKAGING): Summary

Phase 23a is the first half of ROADMAP Phase 23 (PLUGIN), pulled forward so the `plugin/` layout move lands before later phases edit templates. From a fresh clone, with no `npm ci` and no build, the pensmith plugin now:

- passes `claude plugin validate --strict` on `plugin/`, its `plugin.json` and the repo-root marketplace;
- installs from a local or git-hosted marketplace, and updates when a new commit changes it;
- loads `/pensmith`, the seven `/pensmith:*` plumbing skills, 4 working hooks and a connected MCP server in a real Claude Code session;
- answers `/pensmith status` with the CLI's own status text;
- keeps the MCP stdio channel valid JSON-RPC while the verb tools run.

It installs from one canonical `plugin/` directory that both tiers read. The only generated files there are six committed, drift-checked single-file ESM bundles in `plugin/dist/`.

Phase 23 itself stays open: Phase 23b (PLUG-06..12, PLUG-15) is still to come, and so are the two pending items below.

## 1. Requirement status

| Requirement | Status | Evidence (23a-VERIFICATION.md) |
|---|---|---|
| PLUG-01 manifest, skills layout, hooks.json per spec | **Complete** | §8.1 |
| PLUG-02 one canonical `plugin/`, committed bundles | **Complete** | §8.2 |
| PLUG-03 installs from the git marketplace, loads skills, hooks, MCP | **Complete** | §8.3 |
| PLUG-04 repo-root `.mcp.json` works for developers | **Pending**: the acceptance text needs a maintainer amendment | §8.4 |
| PLUG-05 plumbing namespace registered and documented | **Complete** | §8.5 |
| PLUG-13 MCP stdio channel stays clean | **Complete** | §8.6 |
| PLUG-14 hooks run under Claude Code and do their jobs | **Complete** (caveat: the macOS and Windows legs of the spawned-bundle hook tests wait for the first green `check` matrix) | §8.7 |
| CI-05 CI validates and installs the real plugin | **Pending**: the job has never run on a GitHub runner and is not yet a required check | §8.8 |

**Why PLUG-04 is pending.** Its two criteria cannot both hold on every shell with any committed `.mcp.json`. Claude Code 2.1.285 drops a plugin MCP server only when its expanded command line exactly matches a project server's. The plugin's line carries the absolute plugin root, and no variable Claude Code expands in `.mcp.json` names the project folder on every shell. The shipped `${PWD:-.}` form behaves like this:

- It connects where `PWD` is the repo root or unset.
- It registers the server once where `PWD` is the root.
- It fails with `CONNECTION_CLOSED` under a stale `PWD` or Git Bash's MSYS `PWD`.
- It registers two servers where `PWD` is unset (PowerShell, cmd). CONTRIBUTING documents a tested workaround for that case.

23a-PLAN §7.6 proposes amended acceptance text. The maintainer either accepts it through a recorded decision, and PLUG-04 is then ticked against it, or keeps PLUG-04 open (D-23a-07, round 3).

**Why CI-05 is pending.** Its acceptance is "the job is a required check and passes". `v1/p23a` has no upstream, and this automation never pushes, so none of these has run on a GitHub runner:

- the `plugin` job (ubuntu, macOS, Windows);
- the `bundle:check` step in the `check` matrix.

Nothing here can set branch protection either. Everything the job runs passes locally on Linux: `npm run plugin:smoke` here, and on a pull-request-shaped detached checkout in review round 3. The negative control and the static Node ≥ 22 test are in place.

## 2. What shipped

**The layout (PLUG-02, D-23a-01..03).**
- `eb7b5ec` is a pure `git mv` commit: 56 renames, all `R100`. It moves these into `plugin/`:
  - `workflows/`;
  - `templates/` (prompts, citation-styles, presets, the RUN-27 dry-run corpus, stubs);
  - `references/`;
  - `agents/`;
  - the four skills (to `skills/<name>/SKILL.md`);
  - `hooks/hooks.json` and `.claude-plugin/plugin.json`.
- The TypeScript sources stay at the root (`bin/`, `mcp/`, `hooks/*.ts`).
- `paths.ts` `pluginRoot()` / `pluginPath()` and its helpers are the one asset resolver. They walk up from the module's own URL and never read `CLAUDE_PLUGIN_ROOT`. They serve every layout: source under tsx, `dist/`, the `npm pack` install, the bundle and a Claude Code plugin-cache copy. Every private `findPkgRoot` asset lookup is gone.
- The new `plugin-assets` chokepoint row lets only `paths.ts` name an asset folder as a path segment. It matches path-builder calls, fs readers, and separator-bearing string or template literals, never the bare words.
- `package.json` `files` ships `plugin/`.
- `tests/plugin-layout.test.ts` fails on any workflow, prompt, preset, reference, skill or agent file outside `plugin/`. It also fails on a `plugin/bin`, `plugin/CLAUDE.md` or `plugin/node_modules`.

**The bundles (PLUG-02, D-23a-04).**
- `scripts/bundle.mjs` (esbuild 0.27.7, now a direct devDependency) writes six self-contained ESM bundles:
  - `plugin/dist/mcp/server.mjs` and `plugin/dist/mcp/pdf-worker.mjs`;
  - `plugin/dist/hooks/{session-start,pre-compact,post-tool-use,stop}.mjs`.
- The bundles inline every npm dependency and keep legal comments. They are deterministic, LF-only and hold no absolute paths. Together they are 12 MB (budget ≤ 20 MB, tested).
- `npm run bundle` regenerates them. `npm run bundle:check` fails on drift, and `check` and the CI `check` matrix run it.
- The SEC-02 pdf-parse worker resolves inside the bundle (`pdf-text.ts` `pdfWorkerEntry()`, tested with a real PDF).

**The manifests and the validator (PLUG-01, D-23a-05..08).**
- `plugin.json` holds only metadata and the MCP server `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.mjs`. It has no `skills` and no `hooks` key.
- Its `version` is `<package.json version>+<12-hex digest of the files git tracks under plugin/>` (`scripts/plugin-version.cjs`; review rounds 2 and 3). A git-marketplace install updates only when that string changes, and `--strict` refuses a missing version.
- `plugin/hooks/hooks.json` uses the spec's exec form (`command: "node"`, `args: ["${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.mjs"]`, `timeout: 10`) for all four events. The matchers are:
  - SessionStart: `startup|resume|clear|compact|fork`;
  - PostToolUse: `^mcp__(?:plugin_pensmith_)?pensmith__.*`.
- The marketplace entry's `source` is `"./plugin"`, with no entry `version`.
- The developer `.mcp.json` is `node ${PWD:-.}/plugin/dist/mcp/server.mjs`.
- `scripts/validate-plugin-manifest.cjs [--root <dir>]` enforces all of that, plus the skill layout, the 16 workflow bodies' `<capability_check>` blocks and the version stamp. It rejects the old shapes, and `tests/fixtures/plugin-legacy/` is the negative control.

**The skills (PLUG-01, PLUG-05, D-23a-09..11).**
- There are eight `plugin/skills/<name>/SKILL.md` files.
- `pensmith` is the only natural-language router. It holds the §5.4/§5.6 phrases and calls the MCP tools for the verbs that have one (`pensmith_status`, `pensmith_plan`, `pensmith_write`, `pensmith_verify`). It says truthfully that every other verb runs through the Tier-2 CLI in this release.
- It runs exactly the verb on the router's `next:` line, and treats the fenced status text as data.
- It routes corrections truthfully (review round 2; `tests/correction-routes.test.ts` runs each route through the built CLI).
- If the MCP server is missing, it gives the Node ≥ 22 guidance.
- The seven plumbing skills (`plan-section`, `write-section`, `verify-section`, `research`, `outline`, `compile`, `done`) are `disable-model-invocation: true` forwarders with no routing logic. The verb count stays at 16.
- `docs/PLUMBING.md` documents them. The README quick start is still `/pensmith` only.

**The MCP stdio channel (PLUG-13, D-23a-12..14).**
- `bin/lib/output-sink.ts` (`out`, `setOutputSink`, `withCapturedOutput` through `AsyncLocalStorage`) carries every stdout line in `bin/lib`, `bin/cli` and the dispatcher. `mcp/server.ts` points the sink at stderr before it connects.
- Two new chokepoint rows enforce it:
  - `stdout-sink` (ESLint) catches `process.stdout.write`, every console method but warn/error/trace/assert, `import { stdout } from 'node:process'`, destructuring, `globalThis.` forms, and `process` or `console` taken as a value.
  - `mcp-stdout-graph` (import-graph with a new `content` pattern) catches the same forms in any module reachable from `mcp/`.
- `pensmith_status` is a read-only tool, and the one slice of PLUG-06 pulled forward for PLUG-03. It returns `STATUS_DATA_NOTE` plus the CLI's status text inside the FEED-05 untrusted-data fence, byte-identical to the CLI inside the fence (review round 3).
- The section tools refuse a folder with no paper with the CLI's EXIT_USAGE line, and the CLI now does the same for a paper-less `PENSMITH_PAPER_ROOT` (review round 2).

**The hooks (PLUG-14, D-23a-15..16).**
- Each `hooks/<name>.ts` is a thin entry around `bin/lib/hooks/*.ts`. It is guarded by `isMainModule`, reads its stdin JSON (bounded), and resolves the paper through `resolvePaperRoot({mode:'hook'})`, never following the `open` pointer. It always exits 0, writes only protocol JSON to stdout, and exits at once outside a current-layout paper without moving a legacy layout.
- **SessionStart** emits `hookSpecificOutput.additionalContext` with only validated or router-derived values. That is the router's step without the attention detail, plus the resume instruction; the HANDOFF position is added only after a compaction.
- **PreCompact** writes a schema-valid `.paper/HANDOFF.json` v2 (`phase`, `section`, `position`). There is a v1→v2 migration, and a newer file is never downgraded.
- **PostToolUse** writes at most one checkpoint a minute to `pensmithDataDir()/checkpoints/<projectHash>.jsonl`, never under `.claude/`. The throttle is trailing-edge.
- **Stop** releases only a session lock whose owner is the MCP server with the hook's stdin `session_id` and whose process is gone (review round 3). It never releases a CLI lock or a call still in flight.
- `HANDOFF.json` is no longer seeded into `.paper-dry-run/`.

**CI and the live checks (CI-05, PLUG-03, D-23a-17..19).**
- `scripts/plugin-smoke.mjs` (`npm run plugin:smoke`, no API key) is the CI-05 sequence:
  - validate ×3 plus the negative control;
  - a fresh `git clone --local` with no `npm ci` or build, then marketplace add, install, list and details in an isolated `CLAUDE_CONFIG_DIR`;
  - `mcp list` connected;
  - `initialize` and `tools/list` from the installed cache;
  - "not connected" with no `node` on PATH;
  - an install from a loopback `git http-backend` marketplace that `claude plugin update` moves to a newly pushed commit.
- The new `plugin` CI job runs it on ubuntu, macOS and Windows with Claude Code 2.1.285 pinned.
- `scripts/plugin-session-check.mjs` records the live headless-session evidence locally. It runs against scratch clones with an isolated config, an allow-listed environment, `--max-turns` ≤ 3 and no permission bypass.

**Docs (D-23a-20).**
- PRD §13 and §14 describe the `plugin/` layout (Tier 2 implements each verb in `bin/cli` from the same `plugin/` files), and PRD §7.14 describes the new hooks and HANDOFF v2.
- CLAUDE.md (architecture, gotchas, chokepoint rows, hash-pinned paths), CONTRIBUTING, README, README-DEV, `docs/PLUMBING.md` and the `status`, `resume` and `doctor` workflow bodies are updated to match.

## 3. Decisions

D-23a-01..20 are in 23a-CONTEXT.md. The review rounds amended these:

| Decision | Amendment |
|---|---|
| D-23a-05 | The version is content-stamped so git-marketplace installs update (round 2), and the digest covers only files git tracks (round 3) |
| D-23a-06 | Matchers: PostToolUse anchored and covering the dev server (round 1); SessionStart covers `clear` and `fork` (round 3) |
| D-23a-07 | The dedupe keeps the project server (round 1); it holds only with `PWD` = the root, with a documented workaround (round 2); PLUG-04 left Pending (round 3) |
| D-23a-12 | The status text is fenced as untrusted data (round 3) |
| D-23a-15 | SessionStart holds only validated values and adds HANDOFF only on `compact` (rounds 1–2); hooks never move a legacy layout (round 1); trailing-edge checkpoints (round 3); Stop releases only a left-behind lock (round 3) |
| D-23a-16 | Breadcrumbs dropped, assembly made total, the writer never downgrades (round 1); HANDOFF.json not seeded into dry runs (round 3) |
| D-23a-17 | The git-marketplace update step (round 2), served from a named branch so a detached PR checkout works (round 3) |

Round 3 rejected no finding, and one finding was accepted without a fix (CI-05 not met, above).

## 4. Files

- **New:**
  - code: `bin/lib/output-sink.ts`, `bin/lib/hooks/{entry,stdin,session-start,pre-compact,post-tool-use,stop}.ts`, `bin/lib/migrations/handoff/v1_to_v2.ts`;
  - scripts: `scripts/bundle.mjs`, `scripts/plugin-version.cjs`, `scripts/plugin-smoke.mjs`, `scripts/plugin-smoke-lib.mjs` (+ `.d.mts`), `scripts/git-http-host.mjs`, `scripts/plugin-session-check.mjs`, `scripts/chokepoints/{plugin-assets,stdout-sink,mcp-stdout-graph}.json`;
  - plugin: `plugin/dist/**` (generated), `plugin/hooks/hooks.json`, `plugin/skills/*/SKILL.md` (8);
  - docs: `docs/PLUMBING.md`.
- **Rewritten:** `scripts/validate-plugin-manifest.cjs`, `hooks/*.ts`, `.mcp.json`, `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`, `bin/lib/handoff.ts`, `bin/lib/schemas/handoff.ts`.
- **Changed:**
  - `bin/lib/paths.ts` (asset resolver, `hasCurrentLayoutPaper`, `assertPaperHere`);
  - every former asset lookup (`prompt-loader.ts`, `citations.ts`, `exporter.ts`, `disciplines.ts`, `llm-text-stubs.ts`, `honesty.ts`, `http.ts`, `sources/dry-run.ts`, `plagiarism.ts`, the doctor probes);
  - every `bin/cli/*.ts` stdout write, now through `out()`;
  - `mcp/server.ts`, `mcp/tools.ts` (`pensmith_status`, the paper-less refusal);
  - `bin/lib/session-lock.ts` (the Stop release rule), `bin/lib/dry-run-paper.ts` (`SEED_EXCLUDED`), `bin/lib/status-view.ts` (the cost meter);
  - `scripts/eslint-rules/chokepoint.mjs` (`arg.index: "any"`, the import-graph `content` pattern), `eslint.config.js`;
  - `.github/workflows/ci.yml` (the `plugin` job; `bundle:check` in `check`);
  - `package.json` / `package-lock.json` (esbuild, the scripts, `files`);
  - `CLAUDE.md`, `PRD.md`, `CONTRIBUTING.md`, `README.md`, `README-DEV.md`, `.gitattributes`, `.gitignore`.

## 5. Tests

- **New:**
  - `tests/plugin-layout.test.ts`, `plugin-assets.test.ts`, `plugin-bundle.test.ts`;
  - `validate-plugin-manifest.test.ts`, `plugin-smoke-helpers.test.ts`, `plumbing-args.test.ts`, `correction-routes.test.ts`;
  - `output-sink.test.ts`, `mcp-stdout-clean.test.ts`, `mcp-status-untrusted.test.ts`, `mcp-tool-refusals.test.ts`;
  - `tests/hooks/hook-logic.test.ts` and `tests/hooks/hook-runner.ts`.
- **Extended:** the three chokepoint fixtures and their per-form cases in `tests/chokepoints.test.ts`.
- **Rewritten because they encoded the invalid plugin shapes** (CONTEXT "Carried constraints"):
  - `tests/manifest.test.ts`: the `skills` array and the old hooks shape become the spec shapes of plugin.json, hooks.json, the marketplace and `.mcp.json`.
  - `tests/hooks-noop.test.ts`: it now spawns the bundles, checks the < 500 ms outside-a-paper budget, and checks that a legacy folder is left byte-identical.
  - `tests/skill-descriptions.test.ts`: `skills/*.md` becomes `plugin/skills/<name>/SKILL.md` with the frontmatter rules, and it asserts the Node ≥ 22 guidance.
  - The tier-contract plumbing case in `tests/tier-contract.test.ts`: the plugin.json `skills` array becomes the `plugin/skills/` directories mapped to the locked 16.
  - `scripts/validate-plugin-manifest.cjs`, which now rejects the old shapes.
- **Rewritten to spawn the bundled scripts instead of importing the handlers** (PLUG-14): `tests/hooks/{session-start,pre-compact,post-tool-use,stop}.test.ts`.
- **Updated for new behaviour, each asserting the correct behaviour rather than a loosened one:**
  - `tests/handoff.test.ts`, `handoff-size.test.ts` (v2 and the migration);
  - `tests/tier-contract/status-fields.test.ts` (the fenced status tool, the real cost meter);
  - `tests/tier-contract/exit-parity.test.ts` (the paper-less `PENSMITH_PAPER_ROOT` refusal in both tiers);
  - `tests/mcp-tool-handlers.test.ts` (11 tools);
  - `tests/dry-run-workspace.test.ts` (HANDOFF not seeded);
  - `tests/nl-triggers.test.ts` (the truthful correction routes);
  - `tests/installed-bin.test.ts` / `installed-offline.test.ts` (the `plugin/` package layout);
  - `tests/pdf-worker.test.ts` (the bundle layout);
  - `tests/repo-files.test.ts` and the prompt/reference path tests (the moved pinned paths; the hash values are unchanged by the move, and the doctor-output copy was re-pinned once).
- No test was skipped, marked todo or loosened, and no `eslint-disable` was added.

## 6. Gate at closure (v1/p23a at 03d1654)

The details are in 23a-VERIFICATION §8.0.

- `prebuild`, `lint`, `typecheck`, `build`: exit 0.
- `test:tier-contract`: 60/60 pass.
- `npm run test:coverage < /dev/null`: 2561 tests, 2560 pass, 1 fail, no skips, no todos. The failure is the known root-only `tests/atomic-write.test.ts` case, which passes in CI. Coverage: 93.14 % statements, 84.44 % branches, 89.53 % functions, 93.14 % lines.
- The runner's CI-09 fingerprint reported a change to the real data dir during that run. It came from a Phase 20 reviewer's scratch scripts that ran at the same moment, not from this suite (23a-VERIFICATION §8.0.1). A re-run with a private `HOME` outside `TMPDIR`, which arms the guard, passed CI-09: 2560/2561, with only the root-only case failing.
- `validate:manifests` and `bundle:check`: pass (`plugin version 0.1.0-dev+08ba1a3f51e3`).
- `node scripts/e2e-smoke.mjs`: PASS=16, FINDING=0, FAIL=0.
- The tree was clean after the build.
- `CLAUDE_BIN=/opt/node22/bin/claude npm run plugin:smoke`: all checks passed, including the git-marketplace install and update (§8.9).
- The live headless sessions (`scripts/plugin-session-check.mjs`, all checks, $0.50): all evidence passed (§8.11).
- The PLUG-13 mutation check fails lint, the import-graph harness and both spawned-server stdout tests, as it should (§8.12).

## 7. Deviations from the plan

- **PLUG-04 is not ticked** (the plan's first draft ticked it "with its caveat"). The review round 3 reasoning is in §1.
- **CI-05 is not ticked** (the plan's first draft ticked it with a caveat). Its acceptance needs a green, required run on GitHub.
- **Additions beyond the plan's first draft**, all from review findings, each tested and recorded in 23a-VERIFICATION §4, §6 and §7:
  - the content-stamped plugin version and the git-marketplace update step;
  - the fenced `pensmith_status`;
  - the paper-less refusal of the section tools, which also fixed the CLI's paper-less `PENSMITH_PAPER_ROOT`;
  - the real Tier-1 cost meter;
  - the truthful correction routes in the pensmith skill;
  - the Stop hook's left-behind-only release;
  - HANDOFF.json out of the dry-run seed.
- **Live `/compact` was driven headless** (`claude -p --resume <id> "/compact"`), not in an interactive session. It fired PreCompact and wrote HANDOFF.json.

## 8. Open items and follow-ups

**Maintainer (this phase):**
1. **CI-05.** After the push:
   - confirm green `plugin (ubuntu-latest|macos-latest|windows-latest)` runs and a green `check` matrix run that includes `bundle:check` on every OS;
   - make them required checks on `main` with the `gh api` command in 23a-VERIFICATION §5;
   - record the run URLs here, then tick CI-05.

   The first runner run is also the first proof of these macOS/Windows-only paths:
   - `claude.cmd` → `claude.exe`;
   - `Path`/PATHEXT;
   - the no-node PATH filter;
   - byte-identical esbuild output on Windows;
   - the < 500 ms outside-a-paper hook budget there.
2. **PLUG-04.** Accept or reject the amended acceptance text in 23a-PLAN §7.6 through a recorded decision, then tick PLUG-04 or keep it open.
3. **PLUG-14 caveat.** Clear it with the same first green `check` matrix (the spawned-bundle hook tests on macOS and Windows).

**Later phases:**
- **Phase 23b.** PLUG-06..12 and PLUG-15:
  - replace the pensmith skill's CLI fallback with the key-free MCP flow (only `plugin/skills/pensmith/SKILL.md` needs rewriting; the plumbing skills forward);
  - add the thin agents under `plugin/agents/` (today only `.gitkeep`);
  - extend the tier contract to spawn `plugin/dist/mcp/server.mjs` for every workflow.

  `pensmith_status` keeps its name and fenced output.
- **Phase 25 (BRDTH-03).** Mid-section resume builds on HANDOFF v2 and the PostToolUse checkpoints.
- **Phase 26 (CI-15).** Fold `bundle:check`, `validate:manifests` and `claude plugin validate` into the one script `npm run check` and ci.yml share.
- **Phase 26 (test hardening).** `tests/http-rate-limit.test.ts`'s SRC-17 "Crossref declaring 3 / 1s" case (Phase 19) is sensitive to load. It failed once at a load average of about 8 and passed 3/3 when re-run on its own (23a-VERIFICATION §8.0.1). Give it a fake clock or a tolerance before it flakes in CI.
- **Environment note for the Phase 20 closer.** The Phase 20 acceptance reviewer's scratch scripts (`scratchpad/p20/review-acceptance/repo/nm*.mts`) ran pensmith against the machine's real data dir (`/root/.local/share/pensmith`): they added `session.log` lines and two lock files at 14:31–14:32. That is not a product bug, but it trips any local CI-09 fingerprint taken at the same time.
- **Phase 27:**
  - REL-04: pin the marketplace entry to a release ref. The content-stamped version already makes `claude plugin update` see each release.
  - REL-10: THIRD_PARTY_NOTICES for the inlined bundle dependencies. Legal comments are already kept.
  - Replace the `0.1.0-dev` base of the version with the release version.

## 9. Merge notes for Phase 20

Phase 20 (VERIFY) is being built on `akhil/pensive-faraday-qx3o58` in `/home/user/pensmith` at the same time. This branch merges after Phase 20 closes, with rename detection. 23a-PLAN §8 holds the full procedure, and the closer re-ran the trial against the current Phase 20 head.

**Rename map.** Phase 20 edits at the old paths land on the new ones through rename detection:

| Old path | New path |
|---|---|
| `workflows/<verb>.md` | `plugin/workflows/<verb>.md` |
| `templates/**` | `plugin/templates/**` |
| `references/*.md` | `plugin/references/*.md` |
| `skills/<name>.md` | `plugin/skills/<name>/SKILL.md` (rewritten past git's rename threshold: see below) |
| `hooks/hooks.json` | `plugin/hooks/hooks.json` |
| `.claude-plugin/plugin.json` | `plugin/.claude-plugin/plugin.json` |
| `agents/.gitkeep` | `plugin/agents/.gitkeep` |

**Trial merge at closure.** Phase 20 was at `8c16008`, 3 commits after the round-3 trial's `893e0c1`: `d3b7751` (unsupported-forms), `1d21a58` (router VRFY-27) and `8c16008` (20-SUMMARY). The trial ran in a scratch clone of `v1/p23a` at `03d1654`:

```bash
git clone --no-hardlinks /home/user/pensmith-p23a merge && cd merge
git fetch /home/user/pensmith akhil/pensive-faraday-qx3o58:p20   # read-only fetch
git merge --no-edit p20
```

The merge moved these Phase 20 edits onto their `plugin/` paths by rename detection:

- `templates/prompts/claim-support.md`, `orphan-label.md`;
- `workflows/{add,compile,done,next,outline,plan,verify,write}.md`, including `8c16008`'s VRFY-27 paragraph in `next.md`.

Phase 20 adds no new file under `templates/`, `workflows/`, `references/`, `skills/` or `agents/`. None of its new source files builds an asset path; the only asset-folder word is the `'references'` entry of `REFERENCE_LIST_NAMES` in `bin/lib/verify/unsupported-forms.ts`, which the `plugin-assets` row leaves alone. The trial stops with the same 12 files as round 3:

| File | What conflicts |
|---|---|
| `skills/verify-section.md` | **modify/delete**. 23a moved the skill and rewrote it past the 50 % rename threshold. Phase 20 added the `accept quote qK` row (048f55d) and widened the blocking list (d7418ae) |
| `skills/plan-section.md` | **modify/delete**. Phase 20 (0899e32) dropped the DataCite qualifier from a sentence the 23a forwarder never carried, so nothing needs porting |
| `CLAUDE.md` | 3 hunks (the Gates / Tier 1 plugin / Routing bullets; the Library / Write / Verify / Compile-done bullets; the chokepoint rows) |
| `bin/cli/compile.ts` | 1 hunk (imports) |
| `bin/cli/done.ts` | 4 hunks (imports; the export BLOCKED block; the unsupported-claims / GATE-04 re-verification block; the FINAL.md GATE-04 block) |
| `bin/cli/verify.ts` | 4 hunks (imports; the DRAFT.md-missing branch; the draft read Phase 20 moved into the gate core; the final `wrote … VERIFICATION.md` line) |
| `bin/lib/llm-text-stubs.ts`, `bin/lib/plagiarism.ts` | 1 import hunk each |
| `package.json` | the `scripts` block |
| `scripts/eslint-rules/chokepoint.mjs` | the header comment (the matcher kinds) |
| `tests/repo-files.test.ts` | the two re-pinned prompt hashes |
| `tests/tier-contract/exit-parity.test.ts` | the `node:fs` import |

Also expect the planning files that both branches close with: `.planning/STATE.md` (Current Position), and possibly `.planning/ROADMAP.md` (the Progress table) and `.planning/REQUIREMENTS.md` (the traceability rows). Keep both sides' rows and text.

**Resolving the skills (step by step).**
1. `git rm skills/verify-section.md skills/plan-section.md`. The plugin reads only `plugin/skills/<name>/SKILL.md`.
2. Port verify-section's new row into the routing table of `plugin/skills/pensmith/SKILL.md`: "accept quote qK in section N" → `verify N --accept-quote qK`.
   - Use the CLI form, because the `pensmith_verify` tool takes only `n`, `slug` and `yolo`.
   - Accept only after asking the user with AskUserQuestion, one id at a time. There is no blanket acceptance.
   - Keep the "a section whose last write failed is not verified" note.
3. Port Phase 20's widened blocking list:
   - In `plugin/skills/verify-section/SKILL.md`, the list becomes "FABRICATED, MIS-CITED, RETRACTED, UNVERIFIABLE(-NETWORK), an unparseable or unsupported citation form, or a quote NOT_FOUND".
   - In `plugin/skills/pensmith/SKILL.md` and in the `--revise` sentence of `plugin/skills/plan-section/SKILL.md`, name the verdicts `plan N --revise` repairs on the merged tree. Check `bin/lib/revise.ts` first; today they are FABRICATED, MIS-CITED and NOT_FOUND. Send every other blocking verdict to `plan N` + `write N`.
   - Update the plan-section wording pinned in `tests/skill-descriptions.test.ts`.
4. Add `[--accept-quote <qK>]` to verify-section's `argument-hint` and to the `/pensmith:verify-section` row of `docs/PLUMBING.md`. `tests/plumbing-args.test.ts` fails until both name it.

**Resolving the code.**
- **`bin/cli/compile.ts`, `done.ts`, `verify.ts`.** Keep 23a's `out()` form (`bin/lib/output-sink.ts`, PLUG-13) and re-apply Phase 20's changes through `out()`. Phase 20 adds 19 new `process.stdout.write` calls. The trial at `8c16008` found the same lines as round 3:
  - `done.ts`, 7 merged in cleanly: 140–141, 729, 731, 732, 736, 739.
  - `done.ts`, 8 inside conflict hunks: 799, 802, 803, 842, 845, 846, 916, 917.
  - `verify.ts`, 2 merged in cleanly: 201, 392.
  - `verify.ts`, 2 inside conflict hunks: 323, 523.

  The cleanly merged ones are easy to miss. After resolving, `grep -n 'process.stdout.write\|console.log' bin/cli/*.ts bin/lib/*.ts bin/lib/**/*.ts` must list only `bin/lib/output-sink.ts`, the allow-listed `bin/lib/pdf-worker.ts` and comments. Otherwise `stdout-sink` fails, and `mcp-stdout-graph` fails too for `verify.ts`, which the MCP server reaches.
- **`bin/lib/llm-text-stubs.ts`, `bin/lib/plagiarism.ts`** (and any conflict region in `exporter.ts`, `prompt-loader.ts`, `citations.ts`, `http.ts`). Keep 23a's `pluginTemplatePath` / `pluginReferencePath` lookups and `out()` calls, then re-apply the grammar changes. Otherwise `plugin-assets` fails.
- **`scripts/eslint-rules/chokepoint.mjs`.** Keep both changes: Phase 20's `regex-literal` kind (in `MATCH_KINDS` and `ChokepointKind` in `chokepoint.d.mts`) and 23a's `arg.index: "any"`.
- **`package.json`.** Keep 23a's `bundle`, `bundle:check`, `plugin:version`, `plugin:smoke`, the `check` script ending in `bundle:check`, `files: plugin/` and `esbuild`. Add Phase 20's `live:verify`.
- **`tests/repo-files.test.ts`.** Pin Phase 20's new prompt hashes at their `plugin/templates/prompts/…` paths, and re-pin `EXPECTED_PROMPT_HASHES` in `bin/lib/prompt-loader.ts` to the same values.
- **`tests/tier-contract/exit-parity.test.ts`.** Import `existsSync, readFileSync, readdirSync, writeFileSync`.
- **`CLAUDE.md`.** Keep 23a's layout text and rows (`plugin-assets`, `stdout-sink`, `mcp-stdout-graph`), and add Phase 20's text and rows (`citation-grammar`).

**Then rebundle and re-stamp.**
- The bundles inline these, which Phase 20 changes:
  - `bin/lib/` (including `router.ts` and `verify/unsupported-forms.ts` since `1d21a58` / `d3b7751`);
  - the `bin/cli` verbs the MCP tools and hooks run;
  - the package.json version;
  - the lockfile.
- Steps:
  1. `git add` every file under `plugin/` (the digest covers tracked files).
  2. Run `npm ci` if the lockfile changed.
  3. Run `npm run bundle`.
  4. Commit `plugin/dist/` and `plugin/.claude-plugin/plugin.json`.
- Never hand-resolve the `version` line. Re-stamp it, or `validate:manifests` and `bundle:check` fail.
- Then run `npm run check`, `node scripts/e2e-smoke.mjs` and `CLAUDE_BIN=… npm run plugin:smoke`.

**Behaviour Phase 20 code meets after the merge.**
- A `PENSMITH_PAPER_ROOT` at a folder with no paper is refused with EXIT_USAGE. The MCP section tools refuse such a folder too, so a test that expects a placeholder section there must seed a paper.
- `pensmith_status` returns `STATUS_DATA_NOTE` and then the fenced status text, so read the status with `unfence(content[1].text)`. `paper://state`'s cost line is the real COSTS.jsonl meter.
- SessionStart adds the HANDOFF summary only for `source: "compact"`.
- The Stop hook releases an MCP-owned lock only when its process is gone.
- `.paper/HANDOFF.json` is not seeded into `.paper-dry-run/`.
- The missing-key error ends "`pensmith doctor` checks the setup (README: Model runtimes)."

**Phase 20 is still moving.** Re-run the trial against the Phase 20 head of the day before merging, and refresh this section.

## 10. Merge record (integration branch `v1/int-23a`, 2026-09-30)

Phase 20 was still in its review rounds, so `v1/p23a` merged onto the Phase 20 head of the day (`7eb0cbf`, one commit past the §9 trial's `8c16008`) in a separate integration worktree (`/home/user/pensmith-int`, branch `v1/int-23a`), followed by the CI run 68 fixes (`v1/ci-fix-68`). `v1/int-23a` merges into the main branch once Phase 20 closes.

**Commits (first parent, on top of `7eb0cbf`):**

| Commit | What |
|---|---|
| `d565233` | `merge(23a)`: `git merge --no-ff v1/p23a`, default rename detection |
| `b322dd7` | the six bundles rebuilt from an `npm ci` of the merged lockfile in this checkout, and re-stamped |
| `1865e57` | `merge(ci)`: `git merge --no-ff v1/ci-fix-68` (no conflicts) |
| `05949d8` | `plugin/dist/mcp/server.mjs` rebuilt: it inlines the doctor's `ecosystem-presence.ts` |
| `d67c624` | the three test failures the merge exposed (below), and a re-stamp |

**The merge stopped on the 12 files §9 predicted** and no others. The planning files merged cleanly (Phase 20 has not yet written its closure edits). Every Phase 20 edit under `workflows/` and `templates/` landed at its `plugin/` path by rename detection; the moved files' bytes equal Phase 20's (checked file by file), so the prompt hashes needed no new values, only the `plugin/templates/prompts/…` paths in `tests/repo-files.test.ts`. The resolutions followed §9: the two old skill files removed and Phase 20's rows ported to `plugin/skills/{pensmith,verify-section,plan-section}/SKILL.md` (the `--revise` verdicts are named from `bin/lib/revise.ts` `REVISABLE_VERDICTS`: FABRICATED, MIS-CITED, RETRACTED, UNASSIGNED, UNRESOLVABLE, UNPARSEABLE and a quote NOT_FOUND); `--accept-quote <qK>` in verify-section's `argument-hint` and in `docs/PLUMBING.md`; Phase 20's 20 new `process.stdout.write` calls (16 in `done.ts`, 4 in `verify.ts`, clean hunks included) routed through `out()`; both sides of the imports, `chokepoint.mjs`, `package.json` and CLAUDE.md kept.

**Failures the merge exposed, each fixed on the side it describes (`d67c624`):**
- The pensmith skill's "redo section 3" row sent a flagged section to `plan 3 --revise` **then `write 3`**. Revise repairs DRAFT.md in place and resets the verified hash, and the router then names `verify 3` (its own attention line says so); a `write 3` would redraft from a plan that still assigns the flagged source and discard the repair. The row now names `verify 3`, `plan-section` says revise repairs one a run and verify re-checks, and `tests/nl-triggers.test.ts` pins the corrected route.
- `tests/correction-routes.test.ts` matched revise's pre-Phase-20 "nothing to revise" line; it now matches the merged message, which names the widened verdict list.
- `tests/handoff-size.test.ts` seeded verified sections with no DRAFT.md. Since VRFY-16 the router re-drafts such a section, so the PreCompact hook named §1 instead of §30; the fixture now writes each verified section's draft.

**Gate at `d67c624`** (as root in the cloud container; `CI=true`, pandoc 3.9 on PATH):
- Node 22.22.2 and Node 24.21.0: `prebuild`, `lint`, `typecheck`, `build`, `validate:manifests` and `bundle:check` exit 0, and the tree is clean after the build.
- `npm run test:tier-contract`: 61/61 on both.
- `npm test`: 2815 tests, 2814 pass on Node 22 and on Node 24 — the one failure is the root-only `tests/atomic-write.test.ts` case (the Node 22 run at `05949d8`, before the fixes, failed that case and the three tests above). HARDEN-03 ran 1000 drafts against pandoc on both. The runner's CI-09 fingerprint reported no change to the real data dir.
- `node scripts/e2e-smoke.mjs`: PASS=17, FINDING=0, FAIL=0 on both.
- `CLAUDE_BIN=/opt/node22/bin/claude npm run plugin:smoke` (Claude Code 2.1.285, isolated config and HOME, scratch temp dir): all checks passed, including the git-marketplace install and update.
- The recorded e2e corpus was not re-recorded: neither merged branch changes an adapter's request URLs, and `tests/e2e-corpus-manifest.test.ts` passes.

**Still open:** PLUG-04 and CI-05 (§1, §8), unchanged by the merge. Phase 20 commits made after `7eb0cbf` meet the same rules when `v1/int-23a` merges into the main branch: an edit under `workflows/`, `templates/`, `references/` or `skills/` lands at its `plugin/` path (a skill edit is ported by hand, as above), a new stdout line goes through `out()`, a changed prompt is re-pinned at its `plugin/templates/prompts/` path, and the bundles are rebuilt and re-stamped (`npm run bundle`, then `bundle:check`).

**Already known for that merge** (Phase 20 at `a0f1701`, 10 commits past `7eb0cbf`, read only): `436eeb9` gives `pensmith_verify` an `accept_quote` option and edits `skills/verify-section.md` again (a second modify/delete: port it to `plugin/skills/verify-section/SKILL.md`). The pensmith skill's "accept quote qK" row then routes to `pensmith_verify` with `accept_quote: [qK]` (still only after asking the user), and its "flag the tool does not take" sentence drops `verify N --accept-quote qK`; `docs/PLUMBING.md`'s CLI-only list changes the same way. `mcp/tools.ts`, `bin/cli/verify.ts` and the verifier modules change, so the bundles are rebuilt; `workflows/verify.md` lands at `plugin/workflows/verify.md`; `tests/repo-files.test.ts` and `tests/tier-contract/exit-parity.test.ts` may conflict again.
