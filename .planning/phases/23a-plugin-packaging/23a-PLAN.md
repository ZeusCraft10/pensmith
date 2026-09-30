# Phase 23a: Plugin Packaging (PLUGIN-PACKAGING) — Plan

**Branch:** `v1/p23a` · **Checkout:** `/home/user/pensmith-p23a` · **Base:** `c8f28e3` · **Decisions:** [23a-CONTEXT.md](23a-CONTEXT.md) (D-23a-01..20)
**Requirements (8):** PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-13, PLUG-14, CI-05
**Out of scope (Phase 23b):** PLUG-06..12, PLUG-15. Do not implement them, and do not block them. The one exception is the read-only `pensmith_status` tool (D-23a-12), which PLUG-03's acceptance requires.

## 1. Goal

From a fresh clone, with no `npm ci` and no build, the pensmith plugin installs from the git marketplace and passes `claude plugin validate --strict`.

In a real Claude Code session:
- It loads `/pensmith`, the seven `/pensmith:*` plumbing skills, 4 working hooks and a connected MCP server.
- It answers `/pensmith status`.
- It keeps the MCP stdio channel clean.

It installs from one canonical `plugin/` directory. Both tiers read that directory, and its only generated files are committed, drift-checked single-file bundles. A developer who opens the repo in Claude Code gets the same server exactly once. A CI job proves all of this on every change with no API key.

## 2. Success criteria (the Phase 23 criteria this half owns)

1. `claude plugin validate --strict` passes on `plugin/`, `plugin/.claude-plugin/plugin.json` and the repo-root marketplace. From a fresh clone with no build:
   - `claude plugin marketplace add` and `claude plugin install pensmith@pensmith` succeed.
   - `/pensmith` exists.
   - The 4 hooks and the MCP server load.
   - A CI job repeats this on every change.
   - No workflow, prompt, preset, reference, skill or agent file exists outside `plugin/`.

   (Phase 23 criterion 1)
2. The hooks run:
   - PreCompact writes a schema-valid HANDOFF.json (phase, section, position).
   - SessionStart gives Claude the resume context.
   - PostToolUse checkpoints at most once a minute, outside `.claude/`.
   - Stop releases only its own session's locks.

   (Phase 23 criterion 4, hooks half)
3. stdout stays valid JSON-RPC while verb tools run. (Phase 23 criterion 5, stdio half)
4. The plumbing namespace is available and documented outside the quick start, and the repo-root `.mcp.json` works for developers. (Phase 23 criterion 6, those halves)
5. `claude -p --plugin-dir plugin "/pensmith status"` replies with the status output. (PLUG-03)

## 3. Design summary

See 23a-CONTEXT.md for the reasons. In one paragraph:

- **The move.** A pure `git mv` commit moves `workflows/`, `templates/`, `references/`, `skills/*.md` (to `skills/<name>/SKILL.md`), `agents/`, `hooks/hooks.json` and `.claude-plugin/plugin.json` into `plugin/` (D-23a-01, -02).
- **Assets.** `paths.ts` `pluginRoot()` is the one asset resolver, guarded by a new `plugin-assets` chokepoint row (D-23a-03).
- **Bundles.** esbuild writes self-contained `.mjs` bundles for the MCP server, the pdf worker and the 4 hooks into `plugin/dist/`. They are committed and drift-checked (D-23a-04).
- **Manifests.** `plugin.json` holds only metadata and the MCP server. `hooks.json` uses the spec's exec form. The marketplace source is `./plugin`. The developer `.mcp.json` is `node ${PWD:-.}/plugin/dist/mcp/server.mjs` (D-23a-05..07).
- **Validator.** The homemade validator enforces the spec and rejects the old shapes (D-23a-08).
- **Skills.** There are eight skills. `pensmith` is the only natural-language router, and the seven plumbing skills are user-invoked only and forward to it (D-23a-09..11).
- **MCP stdio.** An output sink keeps MCP stdio clean, enforced by the `stdout-sink` lint row and the `mcp-stdout-graph` import-graph row. `pensmith_status` returns the status text (D-23a-12..14).
- **Hooks.** Hook entries are guarded and stdin-driven, exit fast outside a paper, and write HANDOFF.json v2 with a migration. Checkpoints go to the data dir (D-23a-15, -16).
- **CI and live checks.** `scripts/plugin-smoke.mjs` is CI-05's sequence, run by a new `plugin` CI job. Real headless sessions are local evidence (D-23a-17..19).
- **Docs.** The PRD §13/§14 amendments and the CLAUDE.md, CONTRIBUTING and README updates land with the layout (D-23a-20).

## 4. Streams

There are three streams, run in parallel in separate worktrees, all forked from the plan commit. Their owned paths are disjoint except for the shared hot files listed in §5. Stream `layout` makes the pure `git mv` commit first (D-23a-01).

### Rules that bind every stream

- **Never touch the other checkout.** Never modify `/home/user/pensmith`, including the `node_modules` this checkout reaches through a symlink.
  - Before generating committed bundles, or whenever dependencies change, remove the symlink in your own worktree (`rm node_modules`) and run `npm ci` there.
  - Never run `npm install` or `npm ci` through the symlink.
- **Run the CLI only from scratch dirs.** Run CLI and Claude Code experiments only from scratch dirs under `/tmp/claude-0/-home-user-pensmith/424821c3-06dc-5dce-b0e5-b1cac8e53a7e/scratchpad/p23a/<stream>/`, with `XDG_DATA_HOME` set inside them and an isolated `CLAUDE_CONFIG_DIR`. Never use a repo checkout as the cwd.
- **Headless `claude -p` runs** follow D-23a-19: scratch copies, `< /dev/null`, `--max-turns` ≤ 3, explicit `--allowedTools`, and `--disallowedTools SendUserFile,…`. Never pass a permission-bypass flag against a repo.
- **Commit early and often.** Use conventional commits (`feat(23a-<stream>): …`, `fix(23a): …`, `test(23a-<stream>): …`, `docs(23a): …`), each ending with the two trailer lines. Commit in small steps; a `wip` commit is fine for unfinished work.
- **No shortcuts.** Add no `eslint-disable`, no `test.skip` or `todo`, no loosened assertions and no placeholders.
  - When a test encoded a now-wrong behaviour (an invalid plugin shape), rewrite it to assert the right one, and list it in your stream summary.
  - Keep bundles out of other streams' paths. Only stream `bundle-hooks` commits files under `plugin/dist/`.
- **Pre-move paths.** Streams `bundle-hooks` and `stdio-sink` run before the move. If they must change a workflow body, they edit it at its pre-move path (`workflows/<verb>.md`); rename detection carries the edit onto `plugin/workflows/<verb>.md` at merge.
  - The only pre-move body edits planned are `workflows/resume.md` (stream `bundle-hooks`) and `workflows/status.md` (stream `stdio-sink`).
  - Stream `layout` does not edit those two files.

### Stream `layout` — the move, the asset resolver, manifests, skills and docs (PLUG-01, PLUG-02 layout, PLUG-04, PLUG-05)

**Goal.** `plugin/` is the one canonical, spec-valid plugin directory. Tier 2 reads every asset from it: from source, from `dist/`, and from an `npm pack` install. The manifests, skills, plumbing namespace, validator and docs describe it truthfully.

**Tasks**

1. **Pure move commit** (`refactor(23a-layout): move plugin assets into plugin/ (pure git mv)`). This is the first commit and has no content change. Use `git mv` for each move:
   - `workflows` → `plugin/workflows`
   - `templates` → `plugin/templates`
   - `references` → `plugin/references`
   - `agents/.gitkeep` → `plugin/agents/.gitkeep`
   - `hooks/hooks.json` → `plugin/hooks/hooks.json`
   - `.claude-plugin/plugin.json` → `plugin/.claude-plugin/plugin.json`
   - `skills/pensmith.md` → `plugin/skills/pensmith/SKILL.md`, and the same for `plan-section`, `write-section` and `verify-section`

   Check the commit with `git show -M --stat --format= HEAD`: every entry must be a 100% rename. The tree is expected to be red until task 2.
2. **Asset resolver** (D-23a-03).
   - Add `pluginRoot()` and `pluginPath(...segments)` to `bin/lib/paths.ts`: lazy, cached, walking up from the module URL, and throwing one `PensmithError` line.
   - Switch every asset consumer to it and delete their private `findPkgRoot` copies:
     - `bin/lib/prompt-loader.ts`
     - `citations.ts`, `exporter.ts` (only the `PKG_ROOT`/`cslPath` hunk), `disciplines.ts`, `llm-text-stubs.ts`
     - `honesty.ts` (only the `FRAMING_FILE` hunk), `http.ts` (only the `WARN_FILE` hunk), `sources/dry-run.ts`
     - the doctor probes `intake-outline-verify-wiring.ts`, `build-artifact-resolves.ts` and `mcp-sdk-presence.ts`
   - Point the probes at the plugin bundle `plugin/dist/mcp/server.mjs` where they check the Tier-1 server. Keep `dist/bin/pensmith.js` as the CLI artifact. Update the `plugin/workflows/doctor.md` probe lines to match.
     - If a probe's message string changes, re-pin `plugin/references/doctor-output.md` in `tests/repo-files.test.ts`. Prefer leaving the pinned strings unchanged.
   - Add chokepoint row `scripts/chokepoints/plugin-assets.json` (PLUG-02) and its fixture `tests/fixtures/chokepoints/plugin-assets.violation.ts.txt`.
   - Unit test `tests/plugin-assets.test.ts` covers four cases: source, a bundle-like layout (a temp dir with `.claude-plugin/plugin.json`), an npm-like layout (`<pkg>/plugin/…`), and not-found gives the one-line error.
3. **Manifests.** Stream `bundle-hooks` generates the bundle paths named here; they are the contract.
   - **`plugin/.claude-plugin/plugin.json`** (D-23a-05):
     - Drop the `skills` array.
     - Set `mcpServers.pensmith` to `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.mjs` with `type: stdio`.
     - Keep the metadata, with `version` equal to `package.json`.
   - **`plugin/hooks/hooks.json`** (D-23a-06): exec form with these exact commands.
     - Each hook is `{"type":"command","command":"node","args":["${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.mjs"],"timeout":10}` for `<name>` in `session-start`, `pre-compact`, `post-tool-use` and `stop`.
     - Matchers:
       - SessionStart `startup|resume|compact`
       - PostToolUse `mcp__plugin_pensmith_pensmith__.*`
       - PreCompact and Stop have none.
   - **`.claude-plugin/marketplace.json`**: plugin `source: "./plugin"`. Its entry `version` is dropped, or kept equal to `package.json`.
   - **`.mcp.json`** (D-23a-07): `{"mcpServers":{"pensmith":{"type":"stdio","command":"node","args":["${PWD:-.}/plugin/dist/mcp/server.mjs"]}}}`.
4. **Validator** (D-23a-08). Rewrite `scripts/validate-plugin-manifest.cjs` with a `--root <dir>` option; it enforces everything D-23a-08 lists. Then:
   - Create `tests/fixtures/plugin-legacy/`, a small but complete old-shape plugin dir for the negative control. It contains `.claude-plugin/plugin.json` with the old `skills: [{name,file}]`, the old `hooks/hooks.json`, a flat `skills/pensmith.md`, and no personal data.
   - Add `tests/validate-plugin-manifest.test.ts`. It checks that the old fixture fails with named reasons for the skills array, the hooks.json shape, the `.ts` target and the flat skill. It also covers:
     - a workflow body without `<capability_check>` fails;
     - a hooks.json command pointing at a missing bundle fails;
     - a copy of the real tree passes.
   - Rewrite `tests/manifest.test.ts` so it asserts the spec shapes of `plugin.json`, `hooks.json`, the marketplace and `.mcp.json`. This replaces the `dist/mcp/server.js` regex and the old hooks shape.
5. **Skills** (D-23a-09, -10; read the `anthropic-skills:skill-creator` skill for SKILL.md structure).
   - `plugin/skills/pensmith/SKILL.md` is the only NL router. Its `description` + `when_to_use` total ≤ 1,536 characters and carry all 11 PRD §5.4 phrases plus the §5.6 corrections now in the section skills. It has `argument-hint` and `allowed-tools: mcp__plugin_pensmith_pensmith__pensmith_status`, and its body gives:
     - the verb→execution table from D-23a-10;
     - the bare `/pensmith` behaviour: call `pensmith_status` first, then act on its next step;
     - the Node ≥ 22 "MCP server not connected" guidance;
     - the honest-framing line for "make it sound less AI".
   - Seven plumbing skills: `plan-section`, `write-section`, `verify-section` (moved) and `research`, `outline`, `compile`, `done` (new).
     - Each has `name` equal to its directory, `disable-model-invocation: true` and an `argument-hint`.
     - Each body forwards `<verb> $ARGUMENTS` to the `pensmith` skill (through the Skill tool) and holds no routing logic.
6. **Docs** (D-23a-11, -20).
   - Add `docs/PLUMBING.md` (PLUG-05).
   - README: the install section needs no build step, requires Node ≥ 22 on PATH and gives the `/plugin marketplace add` path; add a docs-list link to PLUMBING.md; keep the quick start `/pensmith` only; correct the "Tier 1 generates through your Claude session" claims to state the post-23a truth.
   - PRD §13 tree and §14 "Two-tier source-of-truth" amendment.
   - CLAUDE.md: the layout paragraph, the Tier-1 plugin bullet, the hash-pinned paths and the chokepoint table (`plugin-assets` row; bundle row reads `plugin/dist/`). This stream makes the main CLAUDE.md edit.
   - CONTRIBUTING (the `.mcp.json` note: open at repo root, and the Windows Git Bash caveat; the prompt-hash command path; the layer-3 preflight text) and README-DEV.
7. **Tests.** Update every test that names a moved path:
   - `bibtex-roundtrip`, `citation-render`, `cli-verbs`, `doctor-zotero`, `dry-run-sources`, `honesty`, `humanizer-wrap`
   - `installed-offline`, `installed-bin`, `intake-clarifier`, `lint-tutorial-no-branch`, `llm-text-stubs`, `nl-triggers`
   - `outline-contract`, `plan-contract`, `prompt-layout`, `prompt-research-contracts`, `repo-files` (pin paths → `plugin/templates/prompts`, `plugin/references`; the hash values are unchanged)
   - `skill-descriptions` (rewrite for the `<name>/SKILL.md` layout, frontmatter rules, the description cap, and the Node ≥ 22 guidance assertion for CI-05)
   - `wave-write-plan-errors`, `workflow-bodies`, `workflow-shell-fallbacks`, `workflows-keyequal`, `zero-trace-export`
   - the `tests/tier-contract.test.ts` plumbing-namespace section only (~l.1654–1730): assert the 7 plumbing skill directories map onto existing verbs, with still 16 verbs

   Add:
   - `tests/plugin-layout.test.ts` (PLUG-02): walks `git ls-files` and fails on any workflow, prompt, preset, reference, skill or agent file outside `plugin/` (exempting `tests/fixtures/plugin-legacy/`); `plugin/` must have no `bin/`, `CLAUDE.md` or `node_modules`.
   - A README quick-start test (only `/pensmith`) if `cli-verbs` does not already cover it.

   Extend `installed-bin` and `installed-offline` so the `npm pack` install reads prompts through the pins (for example, `doctor` wiring plus a `loadPrompt` of every slug from the installed `dist/`), and so `package.json` `files` ships `plugin/`.
8. **`package.json` `files`.** Replace `skills/`, `agents/`, `workflows/`, `templates/`, `references/`, `hooks/`, `.claude-plugin/` and `.mcp.json` with `plugin/`. Keep `dist/`, README, PRIVACY and LICENSE.

**Owned paths.** The table lists paths this stream alone owns. §5 covers the shared hot files.

| Group | Paths |
|---|---|
| Moved and new plugin files | `plugin/.claude-plugin/`, `plugin/skills/`, `plugin/agents/`, `plugin/hooks/hooks.json`, `plugin/workflows/` (except `resume.md` and `status.md` content), `plugin/templates/`, `plugin/references/` |
| Pre-move paths (removed by the move) | `workflows/`, `templates/`, `references/`, `skills/`, `agents/`, `.claude-plugin/plugin.json`, `hooks/hooks.json` |
| Root manifests | `.claude-plugin/marketplace.json`, `.mcp.json` |
| Asset consumers in `bin/lib` | `bin/lib/prompt-loader.ts`, `bin/lib/citations.ts`, `bin/lib/disciplines.ts`, `bin/lib/llm-text-stubs.ts`, `bin/lib/sources/dry-run.ts`, `bin/lib/doctor/probes/` |
| Validator, row and fixtures | `scripts/validate-plugin-manifest.cjs`, `scripts/chokepoints/plugin-assets.json`, `tests/fixtures/chokepoints/plugin-assets.violation.ts.txt`, `tests/fixtures/plugin-legacy/` |
| New tests | `tests/plugin-assets.test.ts`, `tests/plugin-layout.test.ts`, `tests/validate-plugin-manifest.test.ts` |
| Rewritten tests | `tests/manifest.test.ts`, `tests/skill-descriptions.test.ts`, `tests/nl-triggers.test.ts` |
| Path-only test updates | the test files listed in task 7 |
| Docs | `docs/PLUMBING.md`, `PRD.md`, `README-DEV.md` |

**Verification (in this stream's worktree)**

- `git show -M --stat --format= <move-sha>` lists only `R100` renames.
- The build and lint gates pass: `npm run prebuild && npm run lint && npm run typecheck && npm run build`.
- `npm test` is green.
  - The committed validator and manifest tests reference `plugin/dist/*` bundles that this stream does not own. Verify them here against a scratch copy of the tree with placeholder bundle files (never committed). The real tree is verified after the merge (§7).
  - One more case is red here until the merge: the hooks.json case in `tests/hooks-noop.test.ts`, which reads the pre-move `hooks/hooks.json`. Stream `bundle-hooks` owns that file and deletes the case. This stream's manifest test covers the new `hooks.json`.
  - List any test that is red only for these reasons in the stream summary.
- `claude plugin validate --strict` (`/opt/node22/bin/claude`) on `plugin`, on `plugin/.claude-plugin/plugin.json` and on `.` exits 0, run on the same scratch copy with placeholder bundles if the validator checks existence.
- Tier 2 reads `plugin/` from source, from `dist/` and from an `npm pack` install. This is proven by `plugin-assets.test.ts`, `installed-bin` / `installed-offline` and a scratch-dir run of `node dist/bin/pensmith.js doctor` plus `PENSMITH_NO_LLM=1 npx tsx bin/pensmith.ts new …` → `outline` in a temp dir (prompts load, the pins verify).
- `rg -n "findPkgRoot" bin mcp hooks` leaves only `http-mock.ts`.

### Stream `bundle-hooks` — committed bundles, hooks that work, the CI plugin job (PLUG-02 bundles, PLUG-14, CI-05, PLUG-03 scripts)

**Goal.** `plugin/dist/` holds deterministic, self-contained bundles that run with no `node_modules`. The four hooks do their jobs under Claude Code. CI validates, installs and launches the real plugin with no API key.

**Tasks**

1. **Bundler** (D-23a-04).
   - **Dependency.** Add esbuild 0.27.7 as an exact devDependency with a lockfile-only update: `npm install --save-dev --save-exact esbuild@0.27.7 --package-lock-only --ignore-scripts`. It must not touch `node_modules`.
   - **Build script.** Write `scripts/bundle.mjs` with the entries, options, `createRequire` banner, the static-require plugin for pdf-parse's pdf.js, and any `__dirname` shim a dependency needs.
   - **npm scripts.**
     - `"bundle": "npm run prebuild && node scripts/bundle.mjs"`
     - `"bundle:check": "npm run bundle && git diff --exit-code -- plugin/dist"`
     - add `bundle:check` to `check`
   - **Generated-file handling.**
     - Add `.gitattributes` `plugin/dist/** linguist-generated=true`.
     - Add `plugin/dist/**` to the ESLint `ignores`.
     - Add `plugin/dist/` to every grep-style test's exclusions: the lint chokepoint, atomic-write, paths, no-sdk-value-import, capabilities-noleak and any other test that scans the tree. Find them by running the suite with bundles present.
   - **Commit the bundles** (`build(23a-bundle-hooks): commit plugin bundles`), generated from a worktree-local `npm ci` (see the rules above).
2. **pdf worker inside the bundle.**
   - `bin/lib/pdf-text.ts` `pdfWorkerEntry()` maps `.mjs` to `pdf-worker.mjs` in the same directory.
   - The SEC-02 worker test gains a bundle leg. It starts a `Worker` on `plugin/dist/mcp/pdf-worker.mjs` with a fixture PDF and gets its text, and a timeout still terminates the worker.
3. **Bundle tests** (`tests/plugin-bundle.test.ts`).
   - The total size of `plugin/dist` is ≤ 20 MB.
   - The server bundle, launched through a symlinked `CLAUDE_PLUGIN_ROOT` (a junction on Windows) from a temp copy of `plugin/` with no `node_modules`, answers `initialize` and `tools/list` through the SDK client.
   - Every bundle has only `node:` / builtin imports: none resolves a bare package specifier at runtime.
   - Legal comments are present.
4. **Hooks** (D-23a-15).
   - **Logic.** Put the hook logic in `bin/lib/hooks/{session-start,pre-compact,post-tool-use,stop,stdin}.ts`: pure, unit-testable functions. They return protocol objects and never write stdout themselves: stream `stdio-sink`'s `stdout-sink` row forbids stdout writes anywhere in `bin/**` after the merge. Only the `hooks/*.ts` entries print the protocol JSON.
   - **Entries.** Rewrite `hooks/{session-start,pre-compact,post-tool-use,stop}.ts` as thin entries with an `isMainModule` guard, stdin read, `resolvePaperRoot({mode:'hook', cwd})`, a cheap `hasPaper` check before the dynamic `import()` of heavy modules, protocol-only stdout and exit 0.
   - **Behaviour.**
     - **SessionStart:** `hookSpecificOutput.additionalContext` built from the router's next step, the HANDOFF summary and the `/pensmith` instruction.
     - **PreCompact:** HANDOFF v2 within 10 s.
     - **PostToolUse:** `tool_name`, and a checkpoint at most once a minute in `pensmithDataDir()/checkpoints/<projectHash>.jsonl`. It never writes `.claude/` or `.paper/`.
     - **Stop:** the D-17-37 policy with stdin `session_id`, plus the session-log flush.
   - **Session id check.** In a real session, check that the plugin's MCP server sees `CLAUDE_CODE_SESSION_ID`, so its lock owner record matches the Stop hook's `session_id`. Fix `claudeSessionIdFromEnv` if Claude Code exposes it differently, and record the evidence.
5. **HANDOFF v2** (D-23a-16).
   - Update `bin/lib/schemas/handoff.ts` to `schema_version` 2 with the new fields.
   - Add `bin/lib/migrations/handoff/v1_to_v2.ts` and a reader, `loadHandoff`, that migrates in memory and ignores a newer file.
   - Update `bin/lib/handoff.ts` `assembleHandoff` to take the router decision.
   - Update `bin/cli/resume.ts` to read through `loadHandoff` and print `phase` / `section` / `position`. Update `bin/lib/router.ts` for the `Handoff` type only.
   - Update `workflows/resume.md` (pre-move path) to describe the v2 fields.
   - Add migration and size tests.
6. **Hook tests.** These spawn the bundled scripts `node plugin/dist/hooks/<name>.mjs` with Claude Code's documented stdin JSON (`session_id`, `cwd`, `hook_event_name`, plus `source` / `trigger` / `tool_name`). They never import `onPreCompact` or `onPostToolUse`.
   - **PreCompact:** in a paper with §2 `writing`, it writes a HANDOFF.json that validates as v2 with `{phase:'sectioning', section:'2', position:'write'}`.
   - **PostToolUse:** five invocations within 60 s write exactly one checkpoint line, and nothing is written under `.claude/`.
   - **Stop and the session lock.**
     - While a CLI `pensmith write` holds the paper lock (a real CLI process, or a real owner record of kind `cli`), a Stop run leaves the lock in place.
     - A Stop run with the `session_id` of an MCP-owned lock releases that lock.
   - **SessionStart:** in a paper, stdout is exactly one JSON line with `hookSpecificOutput.hookEventName === 'SessionStart'` and a non-empty `additionalContext` that names the next step. It never emits `systemMessage`.
   - **Outside a paper:** each of the 4 hooks exits 0 within 500 ms (measured), with empty stdout and no new files in the cwd or the data dir.

   Rewrite `tests/hooks/*.test.ts` and `tests/hooks-noop.test.ts` accordingly. The hooks.json shape assertion moves to stream `layout`'s manifest test, so delete it here. Keep `tests/handoff*.test.ts` green (update them for v2).
7. **CI-05 smoke** (D-23a-17). Write `scripts/plugin-smoke.mjs` and add the npm script `"plugin:smoke": "node scripts/plugin-smoke.mjs"`.
   - **Inputs.** It uses `CLAUDE_BIN`, else `claude` on PATH. It reads the negative fixture `tests/fixtures/plugin-legacy` (stream `layout`) and the expected skill, hook and server counts.
   - **Output.** It prints one line per check and exits non-zero on the first failure, with the command's output.
   - **Unit tests.** Pure helpers get unit tests in `tests/plugin-smoke-helpers.test.ts`: the PATH-without-node filter (win32 and posix), and the parsers for `plugin details` and `mcp list`.
8. **CI job** (D-23a-18).
   - **`plugin` job.** Add a `plugin` job to `.github/workflows/ci.yml`: a matrix of ubuntu, macos and windows on Node 22. It runs `npm ci`, installs pinned Claude Code 2.1.285 by the method that works on each OS, and then runs `npm run plugin:smoke`. Drop any OS that cannot run it, with a written reason.
   - **`check` job.** Add `npm run bundle:check` after build.
   - **Required check.** This stream makes the main `ci.yml` edit. Making the job a required check is a maintainer item for the summary.
9. **Live-session script** (D-23a-19). Write `scripts/plugin-session-check.mjs` for local use only (never CI). It covers PLUG-03, PLUG-04 and PLUG-14 as listed in §6, runs against a fresh clone in scratch, and prints evidence lines for 23a-VERIFICATION.md.
10. **Contributor notes.** CONTRIBUTING and CLAUDE.md get small localized edits: the `npm run bundle` gotcha and the `node_modules` rule under Commands/Gotchas, and the `npm run plugin:smoke` / `plugin-session-check` commands.

**Owned paths.** The table lists paths this stream alone owns. §5 covers the shared hot files.

| Group | Paths |
|---|---|
| Bundles and build | `plugin/dist/`, `scripts/bundle.mjs`, `.gitattributes` |
| Plugin CI and live checks | `scripts/plugin-smoke.mjs`, `scripts/plugin-session-check.mjs`, `.github/workflows/ci.yml`, `package-lock.json` |
| Hook entries and logic | `hooks/session-start.ts`, `hooks/pre-compact.ts`, `hooks/post-tool-use.ts`, `hooks/stop.ts`, `bin/lib/hooks/` |
| HANDOFF | `bin/lib/handoff.ts`, `bin/lib/schemas/handoff.ts`, `bin/lib/migrations/handoff/`, `bin/cli/resume.ts`, `workflows/resume.md` (pre-move path) |
| Other `bin/lib` changes | `bin/lib/pdf-text.ts` (only the `pdfWorkerEntry` hunk), `bin/lib/session-lock.ts` (only `claudeSessionIdFromEnv`, if it needs a fix), `bin/lib/router.ts` (only the `Handoff` type import) |
| Tests | `tests/hooks/`, `tests/hooks-noop.test.ts`, `tests/handoff.test.ts`, `tests/handoff-size.test.ts`, `tests/plugin-bundle.test.ts`, `tests/plugin-smoke-helpers.test.ts`, `tests/pdf-worker.test.ts` |

**Verification (in this stream's worktree)**

- `npm run bundle` twice in a row leaves `git status` clean, and `npm run bundle:check` exits 0.
- The build and lint gates pass: `npm run prebuild && npm run lint && npm run typecheck && npm run build && npm test`.
- In a temp copy of `plugin/` with no `node_modules`, `node plugin/dist/mcp/server.mjs` answers `initialize` / `tools/list`.
- Each hook bundle behaves per task 6 when spawned by hand in scratch paper dirs made with the CLI (`PENSMITH_NO_LLM=1 node dist/bin/pensmith.js new …`).
- **Live check against an interim plugin.** Before the merge, assemble a scratch plugin dir from this stream's bundles plus the D-23a-05/06 `plugin.json` and `hooks.json` and a minimal SKILL.md, and run the following against it:
  - `CLAUDE_BIN=/opt/node22/bin/claude npm run plugin:smoke`, pointed at that dir by a flag the script accepts for exactly this use;
  - one headless session that shows SessionStart exit 0 in `--debug-file`, with the model quoting the resume context.

  The final run on the merged tree is §7.

### Stream `stdio-sink` — the output sink, its chokepoint rows, and `pensmith_status` (PLUG-13, PLUG-03 tool slice)

**Goal.** No verb or `bin/lib` code writes to `process.stdout` except through an injected sink. The MCP server routes that sink to stderr, lint and the import-graph harness enforce it, and `pensmith_status` returns the status text over MCP.

**Tasks**

1. **Sink module** (D-23a-13). Add `bin/lib/output-sink.ts` with `out(text)`, `setOutputSink(sink)`, `withCapturedOutput(fn)` (`AsyncLocalStorage`) and `resetOutputSink()` for tests. Unit tests cover:
   - the default stdout path;
   - a replaced sink;
   - nested and concurrent captures that never mix.
2. **Refactor.** Route every `process.stdout.write` / `console.log` through `out()`:
   - `bin/lib/honesty.ts` and `bin/lib/exporter.ts` (stdout hunks only), `bin/lib/plagiarism.ts`;
   - the `bin/cli` files `add`, `intake`, `list`, `outline`, `revise`, `doctor`, `write`, `research`, `open`, `done`, `status`, `compile`, `stubs`, `verify`, `plan`, `goal` and `sketch`;
   - `bin/pensmith.ts`.

   CLI stdout must stay byte-identical, so the existing CLI output tests (tier-contract, e2e-chain, bare-chain, dry-run) stay green unchanged.
3. **Chokepoint rows** (D-23a-14).
   - Add row `scripts/chokepoints/stdout-sink.json`, with its fixture `tests/fixtures/chokepoints/stdout-sink.violation.ts.txt` (linted as a `bin/lib` path).
   - Add row `scripts/chokepoints/mcp-stdout-graph.json`: an import-graph row over `mcp/**` with a new `content` option.
   - Extend `scripts/eslint-rules/chokepoint.mjs` (header docs plus a `content` validation in `MATCH_KINDS` handling), `tests/helpers/chokepoint-row.ts` and `tests/chokepoints.test.ts`: the harness walk honours `content`, and a self-test runs a synthetic tree where `mcp` reaches a `bin/cli` module with a stdout write. Add the fixture `tests/fixtures/chokepoints/mcp-stdout-graph.violation.ts.txt`: a `bin/cli` module reachable from `mcp/` that writes stdout.
   - Add the matching CLAUDE.md chokepoint-table lines. The existing "enforced from PLUG-13" text becomes `row: stdout-sink` / `row: mcp-stdout-graph`.
4. **MCP server** (D-23a-12, -13).
   - `mcp/server.ts` sets the process-wide sink to `process.stderr` before `connect`.
   - `mcp/tools.ts` adds `pensmith_status`: read-only, no session lock, ≤ 30 statements. It returns the exact text `pensmith status` prints, for the server's resolved paper (never the `open` pointer).
   - Update the tool-count assertions from 10 to 11: `tests/mcp-server-thin-shim.test.ts` and `tests/tier-contract/preflight.test.ts`.
   - Update the tier-contract status case (`tests/tier-contract.test.ts`, status case only). Its Tier-1 leg calls `pensmith_status` on the same fixture paper and asserts the text equals the CLI's stdout.
   - `workflows/status.md` (pre-move path) names the Tier-1 tool in its capability or Tier-1 step.
5. **`tests/mcp-stdout-clean.test.ts`** (PLUG-13 acceptance). Spawn the server over raw stdio, check each stdout line as it arrives, and also drive it with the SDK client. Then:
   - Seed a paper with the CLI (`PENSMITH_NO_LLM=1`, offline, isolated data dir) and call every tool with valid arguments:
     - the paper_* state tools, `paper_doi_verify` (offline: its fixture or a clean error), `paper_capability_probe` and `paper_ingest_zotero_items` (a valid item);
     - `pensmith_plan`, `pensmith_write`, `pensmith_verify` and `pensmith_status`.
   - Assert that the client's `onerror` never fires and that every stdout line parses as a JSON-RPC 2.0 message.
   - Run the sweep over both `dist/mcp/server.js` (tsc) and the bundled `plugin/dist/mcp/server.mjs`.
   - Mutation check, recorded in the stream summary: temporarily revert one `out()` to `process.stdout.write` in `bin/cli/plan.ts`, then confirm that the test fails and lint fails.

**Owned paths.** The table lists paths this stream alone owns. §5 covers the shared hot files.

| Group | Paths |
|---|---|
| Sink module | `bin/lib/output-sink.ts` |
| Sink refactor | `bin/lib/plagiarism.ts`; the stdout hunks of `bin/lib/honesty.ts` and `bin/lib/exporter.ts`; `bin/cli/{add,intake,list,outline,revise,doctor,write,research,open,done,status,compile,stubs,verify,plan,goal,sketch}.ts`; `bin/pensmith.ts` |
| MCP server | `mcp/server.ts`, `mcp/tools.ts` |
| Chokepoint rows and harness | `scripts/chokepoints/stdout-sink.json`, `scripts/chokepoints/mcp-stdout-graph.json`, `scripts/eslint-rules/chokepoint.mjs`, `scripts/eslint-rules/chokepoint.d.mts`, `tests/helpers/chokepoint-row.ts`, `tests/chokepoints.test.ts`, `tests/fixtures/chokepoints/stdout-sink.violation.ts.txt`, `tests/fixtures/chokepoints/mcp-stdout-graph.violation.ts.txt` |
| Tests | `tests/output-sink.test.ts`, `tests/mcp-stdout-clean.test.ts`, `tests/mcp-server-thin-shim.test.ts`, `tests/tier-contract/preflight.test.ts`, `tests/mcp-tool-handlers.test.ts` |
| Workflow body | `workflows/status.md` (pre-move path) |

**Verification (in this stream's worktree)**

- `npm run lint` is clean with no new `eslint-disable`. The `stdout-sink` row fires on its fixture and the `mcp-stdout-graph` row fires on its fixture (`tests/chokepoints.test.ts`).
- The build and test gates pass: `npm run prebuild && npm run typecheck && npm run build && npm run test:tier-contract && npm test`. This includes CLI output byte-identity through the existing suites.
- The `tests/mcp-stdout-clean.test.ts` `dist/mcp/server.js` leg passes.
  - The bundled leg needs `plugin/dist/mcp/server.mjs`, which this stream does not own. Verify it locally against a throwaway `npx esbuild mcp/server.ts --bundle --platform=node --format=esm --outfile=plugin/dist/mcp/server.mjs` plus the `createRequire` banner, then delete that file. Never commit it.
  - The committed leg passes after the merge (§7).
- In a scratch paper, `PENSMITH_NO_LLM=1 node dist/bin/pensmith.js status` stdout equals the `pensmith_status` tool text.

## 5. Shared hot files (small, localized edits; named main owner)

| File | Main owner | Other edits |
|---|---|---|
| `CLAUDE.md` | layout (layout, Tier-1 bullet, hash-pinned paths, chokepoint rows `plugin-assets` and the `plugin/dist/` bundle row) | bundle-hooks: `npm run bundle` gotcha, `node_modules` rule, smoke commands; stdio-sink: the two PLUG-13 table rows |
| `CONTRIBUTING.md` | layout (dev `.mcp.json`, prompt-hash path, preflight text) | bundle-hooks: bundle, smoke and session-check commands |
| `README.md` | layout | none |
| `package.json` | bundle-hooks (`scripts`: bundle, bundle:check, plugin:smoke, check; devDependency esbuild) | layout: the `files` array only |
| `package-lock.json` | bundle-hooks | none |
| `eslint.config.js` | bundle-hooks (`ignores`: `plugin/dist/**`) | none expected (the new rows are data-driven) |
| `tests/tier-contract.test.ts` | layout (plumbing-namespace section, ~l.1654–1730) | stdio-sink: the status case only |
| `tests/repo-files.test.ts` | layout (pin paths) | none |
| `bin/lib/honesty.ts`, `bin/lib/exporter.ts` | stdio-sink (stdout hunks) | layout: the path-resolution hunk only |
| `bin/lib/paths.ts` | layout (`pluginRoot` / `pluginPath`) | none (bundle-hooks builds the checkpoint path from `pensmithDataDir()` + `projectHash()` in `bin/lib/hooks/`) |
| `.github/workflows/ci.yml` | bundle-hooks | none |

Where two streams touch one file, they touch different hunks, so the merge resolves mechanically. The contract values that cross streams are fixed here and must not drift:

- **Bundle paths:** `plugin/dist/mcp/server.mjs`, `plugin/dist/mcp/pdf-worker.mjs`, `plugin/dist/hooks/{session-start,pre-compact,post-tool-use,stop}.mjs`
- **Tool name:** `pensmith_status`
- **Negative fixture:** `tests/fixtures/plugin-legacy/`
- **Skill set:** `pensmith`, `plan-section`, `write-section`, `verify-section`, `research`, `outline`, `compile`, `done`
- **Hook matchers and timeouts:** as in D-23a-06

## 6. Acceptance checks (user-path commands per requirement)

Run these on the merged tree (§7). `S` is a scratch dir under `…/scratchpad/p23a/accept/`, and `CLAUDE=/opt/node22/bin/claude`.

**PLUG-01**
- `$CLAUDE plugin validate --strict plugin`, `… plugin/.claude-plugin/plugin.json` and `… .` each exit 0 with no warnings.
- `node scripts/validate-plugin-manifest.cjs --root tests/fixtures/plugin-legacy` exits 1 and names the skills array, the hooks.json shape and the flat skill (`tests/validate-plugin-manifest.test.ts`).
- `$CLAUDE plugin validate --strict tests/fixtures/plugin-legacy` exits non-zero.
- Every `plugin/workflows/*.md` has `<capability_check>`, and the validator rejects a body without it.

**PLUG-02**
- `git show -M --stat --format= <move-sha>` shows only `R100`.
- `tests/plugin-layout.test.ts` passes: no asset outside `plugin/`, and no `plugin/bin`, `plugin/CLAUDE.md` or `plugin/node_modules`.
- `npm run bundle:check` exits 0, and the size budget test passes.
- The symlinked `CLAUDE_PLUGIN_ROOT` server answers `initialize`.
- The bundled pdf worker extracts a fixture PDF.
- Tier 2 reads prompts, presets and workflows from `plugin/` with the pins verifying:
  - from source: `PENSMITH_NO_LLM=1 npx tsx bin/pensmith.ts new … && … outline` in `$S`;
  - from `dist/`: `node dist/bin/pensmith.js doctor` in `$S`, with the workflow-wiring probe PASS;
  - from the `npm pack` install: `tests/installed-bin.test.ts`.
- PRD §13/§14 and CLAUDE.md describe `plugin/`.

**PLUG-03**
- `npm run plugin:smoke` passes, with `CLAUDE_BIN=$CLAUDE`. It covers:
  - marketplace add and install from a fresh `git clone` with no `npm ci`;
  - `plugin list --json`: enabled, no errors;
  - `plugin details`: skills 8 including `pensmith`, hooks 4, MCP 1.
- `node scripts/plugin-session-check.mjs` (live, local) records:
  - the init frame of `$CLAUDE -p --plugin-dir <clone>/plugin --output-format stream-json --verbose` lists `pensmith:pensmith` and the 7 plumbing skills, and `plugin:pensmith:pensmith` with status `connected` and its tools;
  - the `--debug-file` log shows `Loaded 8 skills`;
  - in a CLI-made paper, `$CLAUDE -p --plugin-dir <clone>/plugin "/pensmith status"` replies with the status output (the same next step and section lines as `pensmith status`).

**PLUG-04**
- Checks run in a fresh clone opened at its root, with project MCP servers approved and an isolated config:
  - `$CLAUDE mcp list` shows `pensmith: node ${PWD}/plugin/dist/mcp/server.mjs - ✓ Connected`, with no "Missing environment variables" warning and no build;
  - `$CLAUDE --plugin-dir ./plugin mcp list` shows exactly one pensmith server line.
- `plugin-session-check` records both.

**PLUG-05**
- `plugin details` lists `plan-section`, `write-section`, `verify-section`, `research`, `outline`, `compile` and `done`.
- In a live session, `/pensmith:verify-section 1` reaches `pensmith_verify` (recorded).
- `tests/cli-verbs.test.ts` asserts 16 verbs, and the README quick start contains only `/pensmith`.
- `docs/PLUMBING.md` documents each skill.

**PLUG-13**
- `tests/mcp-stdout-clean.test.ts`: every tool is called on both servers, with no `onerror` and every stdout line valid JSON-RPC.
- The `stdout-sink` row fires on its `bin/lib` fixture, and the `mcp-stdout-graph` row fires on its `bin/cli` fixture reachable from `mcp/`.
- The mutation check fails as expected.

**PLUG-14**
- The spawned-bundle hook tests of stream `bundle-hooks` task 6 pass on all 3 OSes in CI.
- Live: `plugin-session-check` runs `$CLAUDE -p --plugin-dir <clone>/plugin --debug-file d.log "<question about the paper>"` in a paper dir with HANDOFF.json. `d.log` shows the SessionStart hook ran with exit 0, and the reply reflects the injected resume context.
- If a headless `/compact` can be driven, it produces HANDOFF.json. Otherwise that item is recorded as a live-lane item.

**CI-05**
- The `plugin` job in `ci.yml` installs pinned Claude Code 2.1.285 and runs `npm run plugin:smoke`. The smoke covers:
  - validate ×3 plus the negative control;
  - isolated install, list and details;
  - `mcp list` connected;
  - launching from the installed cache: `initialize` + `tools/list` including `pensmith_status`;
  - no node on PATH → not connected.
- It passes locally, and passes in CI once pushed by the maintainer.
- `tests/skill-descriptions.test.ts` asserts the Node ≥ 22 guidance in `plugin/skills/pensmith/SKILL.md`.
- The required-check setting is a maintainer item.

## 7. Integration after the three streams merge (merger / closer)

1. **Merge.** Merge `layout`, `bundle-hooks` and `stdio-sink` (with rename detection; `git merge -X find-renames`, the default). Resolve the §5 hunks by owner. Confirm the pre-move edits to `workflows/resume.md` and `workflows/status.md` landed in `plugin/workflows/`.
2. **Dependencies and bundles.** Run a worktree-local `npm ci` (no symlinked `node_modules`), then `npm run bundle`. Commit `chore(23a): regenerate plugin bundles after merging the streams`. The bundles must include all three streams' source changes.
3. **Full gate.** `npm run check` passes: prebuild, lint, typecheck, build, tier-contract, test, validate:manifests and bundle:check. The tests red only in a stream worktree (§4 notes) are now green.
4. **Smoke and live checks.** Run `CLAUDE_BIN=/opt/node22/bin/claude npm run plugin:smoke`, then `node scripts/plugin-session-check.mjs`. Record the outputs in `23a-VERIFICATION.md`.
5. **Write `23a-SUMMARY.md`** with:
   - the requirement status;
   - the tests rewritten because they encoded invalid shapes;
   - the maintainer items, stated as open (review round 1). CI-05 is complete only with this caveat: `v1/p23a` has no upstream, so neither the `plugin` job nor `bundle:check` in `check` has run on a GitHub runner, and the macOS/Windows-only paths (`claude.cmd` → `claude.exe`, `Path`/PATHEXT, the no-node PATH filter, byte-identical esbuild output on Windows, the < 500 ms outside-a-paper hook budget) have run only in unit tests with fake file systems. After the push the maintainer (a) confirms a green `plugin (ubuntu-latest)`, `plugin (macos-latest)`, `plugin (windows-latest)` run and a green `check` matrix run that includes `bundle:check`, and (b) makes the jobs required checks on `main` (today `protected=false`, no required checks):
     ```bash
     gh api -X PUT repos/ZeusCraft10/pensmith/branches/main/protection \
       -H "Accept: application/vnd.github+json" --input - <<'JSON'
     {
       "required_status_checks": {
         "strict": true,
         "contexts": [
           "check (ubuntu-latest, 22)", "check (ubuntu-latest, 24)",
           "check (macos-latest, 22)", "check (macos-latest, 24)",
           "check (windows-latest, 22)", "check (windows-latest, 24)",
           "plugin (ubuntu-latest)", "plugin (macos-latest)", "plugin (windows-latest)"
         ]
       },
       "enforce_admins": false,
       "required_pull_request_reviews": null,
       "restrictions": null
     }
     JSON
     gh api repos/ZeusCraft10/pensmith/branches/main/protection/required_status_checks --jq '.contexts'
     ```
   - "Merge notes for Phase 20" (§8).
6. **Mark requirements.** Tick only PLUG-01..05, PLUG-13, PLUG-14 and CI-05 in REQUIREMENTS.md (traceability "Complete (23a)"). Leave Phase 23 unticked in ROADMAP.md, and add the 23a plan and status to its Plans line.

## 8. Merge notes for Phase 20 (to be copied into 23a-SUMMARY.md)

**Rename map.** Phase 20 edits at these paths land on the new ones through rename detection:

| Old path | New path |
|---|---|
| `workflows/<verb>.md` | `plugin/workflows/<verb>.md` |
| `templates/**` | `plugin/templates/**` |
| `references/*.md` | `plugin/references/*.md` |
| `skills/<name>.md` | `plugin/skills/<name>/SKILL.md` |
| `hooks/hooks.json` | `plugin/hooks/hooks.json` |
| `.claude-plugin/plugin.json` | `plugin/.claude-plugin/plugin.json` |

**Trial merge (review round 1).** Each Phase 20 stream was merged into `v1/p23a` (after round 1's fixes) in a scratch clone with `git merge --no-edit` (rename detection on). The prompt edits of `v1/p20-grammar` land on `plugin/templates/prompts/claim-support.md` and `orphan-label.md` by rename detection. The Phase 20 main branch (`akhil/pensive-faraday-qx3o58` at `1e43b9e`, the phase plan) merges cleanly. The streams conflict here:

| Stream (commit tried) | Conflicting files |
|---|---|
| `v1/p20-grammar` (`857d26c`) | `CLAUDE.md`, `bin/cli/compile.ts`, `bin/cli/done.ts`, `bin/lib/llm-text-stubs.ts`, `bin/lib/plagiarism.ts`, `scripts/eslint-rules/chokepoint.mjs`, `tests/repo-files.test.ts` |
| `v1/p20-gate` (`67498b5`) | `bin/cli/compile.ts`, `bin/cli/done.ts`, `bin/cli/verify.ts` |
| `v1/p20-quotes` (`52a03bd`) | `bin/cli/compile.ts`, `bin/cli/done.ts` |
| `v1/p20-registrar` (`2bab275`) | `CLAUDE.md`, `bin/cli/compile.ts`, `bin/cli/done.ts`, `package.json` |

**How to resolve them.**
- `bin/cli/compile.ts`, `bin/cli/done.ts` (every stream) and `bin/cli/verify.ts` (`p20-gate`): 23a routed every stdout line through `out()` (`bin/lib/output-sink.ts`, PLUG-13). Keep 23a's `out()` form of the existing lines and re-apply Phase 20's changes through `out()`. **`p20-gate` adds new `process.stdout.write` calls: 8 in `bin/cli/done.ts` (the VRFY-22 unsupported-claims block, the accepted-quote and local-file lines, the GATE-04 re-verification lines) and 3 in `bin/cli/verify.ts` (the verdict summary, the DRAFT.md-missing line, the quote-acceptance line).** Each must become `out(…)`, or the `stdout-sink` lint row fails — and `bin/cli/verify.ts` is reached by the MCP server (`pensmith_verify`), so the `mcp-stdout-graph` row fails too.
- `bin/lib/llm-text-stubs.ts` and `bin/lib/plagiarism.ts` (`p20-grammar`): 23a replaced their asset lookups with the `paths.ts` plugin resolver and their stdout writes with `out()`; keep those and re-apply the grammar changes. Phase 20's versions of `exporter.ts`, `llm-text-stubs.ts`, `prompt-loader.ts`, `citations.ts` and `http.ts` still carry the pre-23a `path.join(root, 'templates', …)` / `'references'` lookups: wherever a conflict region includes one, keep 23a's `pluginTemplatePath` / `pluginReferencePath` call (the `plugin-assets` row fails otherwise).
- `scripts/eslint-rules/chokepoint.mjs` (`p20-grammar`): keep both changes — Phase 20's `regex-literal` matcher kind (add it to `MATCH_KINDS` and to `ChokepointKind` in `chokepoint.d.mts`) and 23a round 1's `arg.index: "any"` for `call` matchers (the `plugin-assets` row uses it). Phase 20's new `citation-grammar` row needs its CLAUDE.md table line.
- `package.json` (`p20-registrar`): keep 23a's `bundle`, `bundle:check`, `plugin:smoke` scripts, the `check` script ending in `bundle:check`, the `files` list (`plugin/`) and `esbuild`; add Phase 20's `live:verify` script.
- `tests/repo-files.test.ts` (`p20-grammar`): the new prompt hashes go in with their `plugin/templates/prompts/…` paths; re-pin `EXPECTED_PROMPT_HASHES` (`bin/lib/prompt-loader.ts`) to the same values.
- `CLAUDE.md`: keep 23a's layout text and chokepoint rows (`plugin-assets`, `stdout-sink`, `mcp-stdout-graph`) and add Phase 20's rows and text.

**The `plugin-assets` row no longer collides with Phase 20's vocabulary.** Before round 1 the row flagged any string literal that was exactly `references`, `templates` or `workflows`, which made `REFERENCE_LIST_NAMES` in Phase 20's new `bin/lib/verify/unsupported-forms.ts` fail lint (`112:3 … Matched \`references\``). Round 1 narrowed the row to path segments (a `path.join` / `path.resolve` / `new URL` / fs-reader argument that is exactly one of the names, or a string holding one after a leading separator or `plugin/`); that file now lints clean against the row, and `tests/chokepoints.test.ts` pins the clean case.

**Also after the merge (whatever the conflicts):**
- `skills/{plan,write,verify}-section.md`: Phase 23a rewrote their bodies (forwarding plumbing skills; NL phrases moved into `pensmith`). Re-apply any Phase 20 wording to `plugin/skills/pensmith/SKILL.md` or the verify-section body.
- `workflows/doctor.md` (the probe lines), `workflows/resume.md` and `workflows/status.md`: merge by hand if Phase 20 touched them.
- Any test Phase 20 added or changed that names a `templates/`, `workflows/`, `references/` or `skills/` path: `tests/plugin-layout.test.ts` and the path failures point to them.

**New Phase 20 files at old locations.** A new prompt, reference, workflow or skill file must be moved under `plugin/`, because `tests/plugin-layout.test.ts` fails otherwise. A new prompt slug is also added to `EXPECTED_PROMPT_HASHES` with its `plugin/` path pin.

**Bundles.** The committed bundles inline `bin/lib/`, the `bin/cli/` verbs the MCP tools and hooks run (`plan`, `write`, `verify`, `status`, `route-options`, `goal`), `bin/lib/version.generated.ts` (the package.json version) and the locked dependencies. Phase 20 edits `bin/lib/` and `bin/cli/verify.ts` (and `compile.ts` / `done.ts`), so after the merge re-run `npm ci` (if the lockfile changed) and `npm run bundle`, and commit `plugin/dist/`, or `bundle:check` fails.

**stdout writes.** Any stdout write that Phase 20 adds in `bin/lib` or `bin/cli` must go through `out()` (`bin/lib/output-sink.ts`), or the `stdout-sink` lint row fails. Since round 1 that row (and `mcp-stdout-graph`) also catches `import { stdout } from 'node:process'`, a destructured `const { stdout } = process` and `globalThis.console.log`.

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Some dependency fails to bundle: pdf-parse's versioned pdf.js `require`, citation-js / sync-fetch file-relative workers, `__dirname` in CommonJS dependencies. | Use an esbuild plugin and banner shims in `scripts/bundle.mjs`, never `node_modules` patches. Exercise the server bundle through every tool (`mcp-stdout-clean`) and the worker bundle with a real PDF. |
| R2 | Bundle drift from the shared `node_modules` symlink (a Phase 20 reinstall), or non-determinism across OSes. | Generate bundles only from a worktree-local `npm ci`. `bundle:check` runs in every CI matrix entry. Emit no absolute paths, LF only. |
| R3 | A hook exceeds 500 ms outside a paper on Windows CI. | Run the `hasPaper` check before the dynamic `import()` of heavy modules. Measure in tests on all 3 OSes, and keep the hook bundles small. |
| R4 | Claude Code does not expose the session id to MCP servers as `CLAUDE_CODE_SESSION_ID`, so the Stop policy never matches. | Verify in a real session (bundle-hooks task 4). Fix `claudeSessionIdFromEnv` to what Claude Code provides, and record the evidence. |
| R5 | `${PWD:-.}` in `.mcp.json`: a subdirectory launch fails, and Git Bash on Windows gives an MSYS `PWD`. | Document it in CONTRIBUTING. It is a developer-only surface. The fresh-clone check proves the root-launch case. |
| R6 | Claude Code CLI installation on macOS or Windows CI (npm shim vs native binary), and the no-node PATH check needing an absolute `claude` path. | The smoke script resolves the real `claude` executable first. It drops an OS only with a written reason. |
| R7 | Cross-stream integration is only testable after the merge (manifests plus bundles plus sink). | The contract values are fixed in §5. Each stream verifies against scratch assemblies. §7 is a mandatory integration step. |
| R8 | Merge conflicts with Phase 20 on skills, workflow bodies, pins and CLAUDE.md. | The move is pure, workflow content edits are minimal, and the conflict list is in §8. |
| R9 | Live-session side effects in this remote environment (a child session calling `SendUserFile`) and spend. | D-23a-19 flags; `--max-turns` ≤ 3; scratch copies only; no permission bypass against repos. |
| R10 | Claude Code's default `workflows/` component directory (`.js` workflows) meets pensmith's `.md` bodies. | The planner observed no load error or validate warning on 2.1.285. `plugin:smoke` asserts `plugin list --json` shows no errors. If a later pinned version objects, record it and decide then. |
