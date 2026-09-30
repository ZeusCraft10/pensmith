# Phase 23a: Plugin Packaging (PLUGIN-PACKAGING) — Context and decisions

**Milestone:** v1.0.0 Open Source Release · **Branch:** `v1/p23a` (checkout `/home/user/pensmith-p23a`), branched from `c8f28e3`
**Requirements (8):** PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-13, PLUG-14, CI-05 · **Plan:** [23a-PLAN.md](23a-PLAN.md)

## Why this phase exists

Phase 23a is the first half of ROADMAP Phase 23 (PLUGIN), pulled forward so the `plugin/` layout move lands before later phases edit templates, workflows and skills. It covers the packaging half only. Phase 23b does the rest later: PLUG-06..12 and PLUG-15 (deterministic MCP tools for every stage, context and submit tools, the verify-only `verified` status, skills and agents that drive real sessions, Tier-1 gates and humanize, NL triggers, resources, and the tier contract over the real plugin).

The 2026-09-25 audit (gap register T1-1/2/3/6/10/12/13/15/16, QR-8, QR-13, SC-T1, UX-2, UX-7, UX-18, NFR-27, NFR-30, SWP-1/2/4/6/19/24/25/27/29/36/37/100..103/131) found the following problems with the Tier-1 plugin:

- The plugin did not install. `plugin.json` has `skills: [{name,file}]`, which fails with "skills: Invalid input".
- `hooks/hooks.json` uses a homemade `{schemaVersion, hooks:[{event, script:'*.ts'}]}` shape. On its own, that stops the whole plugin from loading.
- The skills are flat `skills/*.md` files, so 0 skills load and `/pensmith` does not exist.
- `dist/` is gitignored, so a git-marketplace install has no MCP server.
- The marketplace source `./` ships `bin/` and `CLAUDE.md`. claude.ai and Cowork refuse a plugin with `bin/`, and `claude plugin validate` warns about `CLAUDE.md`.
- The repo-root `.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}`, which is undefined outside a plugin, so every developer session gets CONNECTION_CLOSED.
- The hook entry points never run. `pre-compact.ts` and `post-tool-use.ts` only export functions.
- `session-start` emits `systemMessage`, which is shown to the user and never reaches Claude.
- `post-tool-use` reads `input.tool` and writes into the user's `.claude/`.
- MCP verb tools write `pensmith plan: …` lines to stdout and corrupt the JSON-RPC stream.
- CI ran only the homemade validator, and that validator enforced the invalid shapes.

The planner reproduced the fix empirically with Claude Code 2.1.285 (`/opt/node22/bin/claude`) in scratch copies (`scratchpad/p23a/planner/exp1`):

- A `plugin/` directory with `.claude-plugin/plugin.json` (no `skills` key; inline `mcpServers`), `skills/<name>/SKILL.md`, and `hooks/hooks.json` in the spec's exec form passes `claude plugin validate --strict`, whether it is given the directory, the manifest or the repo-root marketplace (`source: "./plugin"`).
- The `workflows/*.md` and `templates/`, `references/` directories do not disturb loading.
- It installs from an isolated `CLAUDE_CONFIG_DIR`. `claude plugin details` shows the skills, 4 hooks and 1 MCP server.
- The cache copy holds only `plugin/`. The bundles therefore have to be self-contained, and assets have to resolve from the plugin root, not from `package.json`.
- A headless `claude -p --plugin-dir plugin` run lists `pensmith:pensmith` and a connected `plugin:pensmith:pensmith` MCP server.
- A skill with `disable-model-invocation: true` is still listed by `claude plugin details`.
- `claude mcp list` deduplicates a project-scope server against the plugin's server only when the expanded command lines are identical (see D-23a-07).

## Concurrency with Phase 20 (binding)

Phase 20 (VERIFY) is being implemented at the same time in the main checkout `/home/user/pensmith` on branch `akhil/pensive-faraday-qx3o58`. Phase 20 may edit `templates/prompts/*.md`, `workflows/*.md` and `skills/*.md` at their current paths. Phase 23a works only in `/home/user/pensmith-p23a` and never modifies `/home/user/pensmith`, including its `node_modules`, which this checkout reaches through a symlink (see D-23a-04). Phase 23a merges after Phase 20 closes, using git rename detection:

- **D-23a-01 — The move is one pure `git mv` commit, made first.** It is stream `layout`'s first commit and contains renames only, with no content change (`git show -M --stat` shows only `R100` entries). It moves every file listed in D-23a-02. All content edits follow in later commits.
  - A Phase 20 edit to a moved file then applies onto the renamed path at merge.
  - Streams `bundle-hooks` and `stdio-sink` fork from the plan commit, before the move. If one of them must edit a workflow body, it edits the pre-move path (`workflows/<verb>.md`). Stream `layout` never edits those specific files, so the same rename detection carries the edit across (23a-PLAN §4).
  - The closer records the rename map and the conflict list in 23a-SUMMARY.md under "Merge notes for Phase 20" (23a-PLAN §8).

## Decisions

### Layout (PLUG-02, S-19, D-V1-05)

- **D-23a-02 — `plugin/` is the plugin root and the single home of every shipped asset.** After the move:

  ```
  plugin/
  ├── .claude-plugin/plugin.json      (was .claude-plugin/plugin.json)
  ├── skills/<name>/SKILL.md          (was skills/<name>.md; 4 moved + 4 new plumbing skills)
  ├── agents/.gitkeep                 (was agents/.gitkeep; Phase 23b adds the thin agents)
  ├── hooks/hooks.json                (was hooks/hooks.json)
  ├── workflows/<verb>.md             (was workflows/, the 16 bodies)
  ├── templates/                      (was templates/: prompts, citation-styles, presets, dry-run, stubs)
  ├── references/                     (was references/)
  └── dist/                           (generated, committed, drift-checked bundles; D-23a-04)
      ├── mcp/server.mjs, mcp/pdf-worker.mjs
      └── hooks/{session-start,pre-compact,post-tool-use,stop}.mjs
  ```

  - **What stays at the repo root.** The TypeScript sources stay at the root: `bin/`, `mcp/*.ts` and the hook entry sources `hooks/*.ts`. Lint, typecheck, coverage and the chokepoint rows keep running there, and `plugin/dist/` holds only their bundles. The repo root also keeps `.claude-plugin/marketplace.json` (its plugin entry's `source` becomes `"./plugin"`) and the developer `.mcp.json` (D-23a-07). `tsc` still builds `dist/` (gitignored) for the npm CLI and for the tests that spawn `dist/bin/pensmith.js` or `dist/mcp/server.js`.
  - **What `plugin/` must never contain:** a `bin/` directory, a `CLAUDE.md`, or `node_modules/`.
  - **Test guard.** A test fails if any workflow, prompt, preset, reference, skill or agent file exists outside `plugin/`. The one exemption is the negative-control fixture `tests/fixtures/plugin-legacy/`.
  - **Workflow bodies keep plugin-relative paths.** Paths inside workflow bodies such as `templates/prompts/<slug>.md` stay correct because they are relative to the plugin root. They are not rewritten.

- **D-23a-03 — One asset resolver, in `paths.ts`, with a new chokepoint row.** `bin/lib/paths.ts` gains `pluginRoot()` and `pluginPath(...segments)`.
  - **Resolution walk.** Resolution is lazy and cached. It walks up from the module's own `import.meta.url`:
    - A directory that contains `.claude-plugin/plugin.json` is the plugin root. This covers the bundle in `plugin/dist/…` and a Claude Code plugin-cache copy.
    - Otherwise, a directory that contains `plugin/.claude-plugin/plugin.json` yields `<dir>/plugin`. This covers the source tree under tsx, `dist/` and an `npm pack` install.
    - If neither is found, it throws one `PensmithError` line that names where it looked.
  - **No environment override.** `CLAUDE_PLUGIN_ROOT` is not consulted. The module's own location is authoritative, and an environment variable could point anywhere.
  - **Consumers.** Every former `findPkgRoot` asset lookup uses the resolver: `prompt-loader.ts`, `citations.ts`, `exporter.ts`, `disciplines.ts`, `llm-text-stubs.ts`, `honesty.ts`, `http.ts` (warnings file), `sources/dry-run.ts` and the doctor probes. Their private `findPkgRoot` copies are deleted.
  - **Exception.** `http-mock.ts` keeps its package-root walk to `tests/fixtures/cassettes`, which is the `tests-path-at-runtime` row.
  - **Chokepoint row.** The new row `plugin-assets` (PLUG-02) lets only `paths.ts` name the shipped asset directories as path segments. Its matchers are tuned by the stream and proven by `tests/fixtures/chokepoints/plugin-assets.violation.ts.txt`.
  - **Why `paths.ts`.** PLUG-02 says "`paths.ts` and `prompt-loader.ts` resolve `plugin/`", and `paths.ts` is already the cross-platform path chokepoint.

### Bundles (PLUG-02, D-V1-05)

- **D-23a-04 — esbuild, one self-contained ESM file per entry, committed and drift-checked.**
  - **Build script.** `scripts/bundle.mjs` uses esbuild 0.27.7. That version is already locked transitively through tsx, and it is added as a direct devDependency with a lockfile-only update.
  - **Entries.**
    - `mcp/server.ts` → `plugin/dist/mcp/server.mjs`
    - `bin/lib/pdf-worker.ts` → `plugin/dist/mcp/pdf-worker.mjs`
    - `hooks/<name>.ts` → `plugin/dist/hooks/<name>.mjs`
  - **Build options.**
    - Output format: `format: 'esm'`, `platform: 'node'`, `target: 'node22'`.
    - Bundling: `bundle: true`, no code splitting (PLUG-02 says "single-file"), not minified (readable, reviewable diffs), `keepNames`, and `legalComments: 'inline'` (REL-10).
    - A `createRequire` banner handles CommonJS dependencies. `__dirname` and `__filename` are shimmed only if a bundled dependency needs them.
    - The `.mjs` extension is required because `plugin/` has no `package.json`.
    - Dependencies that esbuild cannot resolve statically, such as pdf-parse's versioned pdf.js `require`, are rewritten to static imports by a small esbuild plugin in `scripts/bundle.mjs`, never by patching `node_modules`.
    - The output is byte-deterministic, uses LF line endings and has no absolute paths.
  - **Commands.**
    - `npm run bundle` runs prebuild and then the bundler.
    - `npm run bundle:check` rebuilds and runs `git diff --exit-code -- plugin/dist`.
    - CI runs `bundle:check`, and `npm run check` includes it.
  - **Tests.** A test asserts a total size budget of ≤ 20 MB for `plugin/dist`. `.gitattributes` marks `plugin/dist/** linguist-generated=true`.
  - **pdf worker.** `pdf-text.ts` `pdfWorkerEntry()` maps `.mjs` to the `pdf-worker.mjs` next to the bundle (SEC-02 keeps working inside the bundle).
  - **Freshness.** Any change to `bin/lib`, `mcp/` or `hooks/` must re-run `npm run bundle`, and CI fails otherwise. Streams do not reconcile each other's bundles. After the three streams merge, the merger regenerates the bundles once (23a-PLAN §7).
  - **Shared `node_modules` (environment rule).**
    - This checkout's `node_modules` is a symlink into the main checkout. Committed bundles must be generated from dependencies that match `package-lock.json`. Before committing bundles, a stream removes the symlink in its own worktree and runs `npm ci` there.
    - Nobody ever runs `npm install` or `npm ci` through the symlink, because that would mutate `/home/user/pensmith/node_modules`.
    - Adding esbuild uses `npm install --save-dev --save-exact esbuild@0.27.7 --package-lock-only --ignore-scripts`.

### Manifests and hooks.json (PLUG-01, D-V1-05)

- **D-23a-05 — `plugin.json` declares only metadata and the MCP server.**
  - It has no `skills` key, because the default `skills/` scan loads `<name>/SKILL.md`. It has no `hooks` key, because the default `hooks/hooks.json` loads, and declaring it again would merge it twice.
  - `mcpServers.pensmith = {"type":"stdio","command":"node","args":["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.mjs"]}`. There is no `plugin/.mcp.json`, which would be a second declaration.
  - `version` equals `package.json` `version`, and the validator enforces it. The marketplace entry either drops `version` or must equal it.
  - The existing author, license, repository and homepage metadata are kept.

- **D-23a-06 — `hooks.json` uses the spec's exec form, with explicit timeouts and narrow matchers.** Each hook is `{"type":"command","command":"node","args":["${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.mjs"],"timeout":10}`. Exec form spawns `node` directly: no shell, no quoting, and it is safe on Windows, where `node.exe` is a real executable. The planner validated this form with `--strict`.

  | Hook | Matcher and timeout |
  |---|---|
  | SessionStart | matcher `startup|resume|compact`, timeout 10 |
  | PreCompact | timeout 10 (PLUG-14) |
  | PostToolUse | matcher `mcp__plugin_pensmith_pensmith__.*`, timeout 10 |
  | Stop | timeout 10 |

  - **PostToolUse matcher.** The PostToolUse matcher covers only the plugin's own MCP tools. A checkpoint marks pensmith progress, and in Tier 1 that progress flows through the pensmith tools (Phase 23b's submit tools as well). The narrow matcher also means other projects never pay a node spawn per Write or Edit.
  - **Fallback.** If the CI-pinned Claude Code rejects exec form, the stream falls back to the shell form `node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.mjs"` and records the reason. The planner did not observe such a rejection on 2.1.285.

- **D-23a-07 — The developer `.mcp.json` is `node ${PWD:-.}/plugin/dist/mcp/server.mjs`.** It uses no `${CLAUDE_PLUGIN_ROOT}` and needs no build step.
  - **Why this form.** Claude Code deduplicates a plugin server against a project server only when the expanded command lines match. With `${PWD}`, a checkout opened at the repo root with `--plugin-dir ./plugin` registers the server exactly once (observed). A plain relative path registers it twice (observed). `:-.` falls back to a relative path where `PWD` is unset (PowerShell, cmd).
  - **Limitations, documented in CONTRIBUTING.** Claude Code must be opened at the repo root, because a subdirectory launch fails for any relative form. Under Git Bash on Windows, `PWD` holds an MSYS path, so developers there launch from PowerShell or cmd.
  - **Verification.** The stream re-checks this in a fresh clone and may adopt a strictly better form it finds, recording the evidence.

- **D-23a-08 — The homemade validator enforces the spec and rejects the old shapes.**
  - **Invocation.** `scripts/validate-plugin-manifest.cjs [--root <dir>]` validates the following:
    - **`plugin.json`:** the D-23a-05 shape. Any `skills` value that is not a path string or array of path strings is rejected, as are a CLAUDE.md or `bin/` in `plugin/`.
    - **`hooks.json`:** `{hooks:{<Event>:[{matcher?, hooks:[{type:'command', command, args?, timeout?}]}]}}` with exactly the 4 events. It rejects `schemaVersion`, a top-level array, `script`, and any `.ts` target. Every referenced `${CLAUDE_PLUGIN_ROOT}/…` file must exist.
    - **Skills:** every required `plugin/skills/<name>/SKILL.md` exists with frontmatter `name` equal to its directory, and there are no flat `skills/*.md` files.
    - **Marketplace:** `source: "./plugin"`.
    - **`.mcp.json`:** no `${CLAUDE_PLUGIN_ROOT}`, and it targets the committed bundle.
    - **Workflow bodies:** the 16 bodies in `plugin/workflows/`, each with its `<capability_check>`.
  - **Regression test.** A test feeds it `tests/fixtures/plugin-legacy/` (the old `plugin.json` skills array plus the old `hooks.json` and flat skills) and expects failure with the named reasons.
  - **Negative control.** CI-05 runs `claude plugin validate --strict` on the same fixture as its negative control.
  - **Privacy.** Fixtures carry no personal data: the author is "Pensmith Maintainers" and emails use example.org.

### Skills and the plumbing namespace (PLUG-01, PLUG-05)

- **D-23a-09 — Eight skills. `pensmith` is the only natural-language router, and the plumbing skills are user-invoked only.**
  - **The skill set.** `plugin/skills/` holds eight skills. `pensmith` is model-invocable. The seven plumbing skills `plan-section`, `write-section`, `verify-section`, `research`, `outline`, `compile` and `done` carry `disable-model-invocation: true`. They are available as `/pensmith:<name>` for users and scripts, add no always-on context, and do not compete with `pensmith` for natural-language triggers.
  - **Where the NL phrases go.** The §5.4 and §5.6 phrases now carried by the section skills' descriptions move into `pensmith`'s `description` and `when_to_use` (≤ 1,536 characters combined). PRD §14 says "Never duplicate logic in SKILL.md", and CLAUDE.md says skills/pensmith only maps natural language to verbs.
  - **Plumbing bodies forward.** Each plumbing body forwards to `pensmith` with its verb and `$ARGUMENTS`, so it holds no routing logic of its own. Frontmatter `name` equals the directory name (`plan-section`, never `pensmith:plan-section`). There is still no 17th verb.
- **D-23a-10 — The Tier-1 `pensmith` skill describes what exists at the end of 23a, truthfully.** For the verbs that have an MCP tool, it calls the tool:

  | Verb | MCP tool |
  |---|---|
  | status | `pensmith_status` (D-23a-12) |
  | plan N | `pensmith_plan` |
  | write N | `pensmith_write` |
  | verify N | `pensmith_verify` |

  - **Verbs without a tool yet.** For every other verb, the skill says it runs in the Tier-2 CLI in this release. Claude may run `pensmith <verb>` through Bash when it is on PATH; otherwise Claude tells the user how to install the CLI. The skill never pretends those verbs run key-free, and it never writes paper files itself.
  - **Allowed tools.** `allowed-tools` pre-approves only the read-only `mcp__plugin_pensmith_pensmith__pensmith_status`.
  - **Server not connected.** If the pensmith MCP tools are missing, the skill tells the user to install Node.js ≥ 22, put `node` on PATH, and restart Claude Code (CI-05 has a static test for this).
  - **What Phase 23b changes.** Phase 23b (PLUG-09) replaces the CLI fallback with the key-free MCP flow. Only this skill, and no plumbing skill, needs rewriting then.
- **D-23a-11 — Documentation.** The plumbing namespace is documented in a new `docs/PLUMBING.md`: each `/pensmith:<name>`, the verb it maps to, and scripting with `claude -p "/pensmith:verify-section 3"`. The README links it from its documentation list, never from the quick start, which stays `/pensmith` only. The README Tier-1 install section needs no build step, requires Node ≥ 22 on PATH, and describes the Tier-1 state truthfully; key-free Tier-1 generation is Phase 23b.

### MCP stdio channel (PLUG-13) and the status tool (PLUG-03)

- **D-23a-12 — `pensmith_status` is the one slice of PLUG-06 pulled forward.** PLUG-03's acceptance requires `claude -p --plugin-dir plugin "/pensmith status"` to reply with the status output, and no MCP path to the status text exists today.
  - **What it is.** `mcp/tools.ts` gains a read-only `pensmith_status` tool, a thin shim of ≤ 30 statements with no session lock. It renders exactly the text `pensmith status` prints, through the same `bin/lib` view builder or the status verb under a capturing output sink, and returns it as text content.
  - **Knock-on changes.** The tool count assertions go from 10 to 11. The tier-contract status case compares the tool's text with the CLI's stdout for the same paper.
  - **Naming and scope.** The name follows the existing verb-tool naming (`pensmith_plan/write/verify`). Phase 23b keeps it and adds the remaining stage tools.
- **D-23a-13 — An injected output sink.**
  - **The module.** `bin/lib/output-sink.ts` exports `out(text)`, `setOutputSink(sink)` and `withCapturedOutput(fn)`. The capture is scoped per call with `AsyncLocalStorage`, so concurrent MCP calls never mix their output.
  - **Where output goes.**
    - The CLI default is `process.stdout`, so CLI output stays byte-identical.
    - `mcp/server.ts` sets the process-wide sink to `process.stderr` before it connects. That is PLUG-13's "stderr" option; MCP logging notifications are not used.
    - `pensmith_status` captures.
  - **Refactor scope.** Every `process.stdout.write` and `console.log` in `bin/lib` and `bin/cli` goes through `out()`, and so do the dispatcher's own prints in `bin/pensmith.ts`.
  - **Exceptions.** The hook entry sources in `hooks/` are out of the row's scope, because their stdout is the hook protocol. `bin/lib/pdf-worker.ts` is allow-listed, with a reason: it is a worker thread whose console output goes to the worker's own captured stream, never to the process's stdout.
- **D-23a-14 — Two chokepoint rows for the sink.**
  - **Row `stdout-sink` (PLUG-13, ESLint):** `process.stdout.write` and `console.log/info/debug/dir/table` are forbidden in `bin/**/*.ts` except `bin/lib/output-sink.ts` (and `bin/lib/pdf-worker.ts`).
  - **Row `mcp-stdout-graph` (PLUG-13, import-graph):** no module reachable from `mcp/**` may contain a stdout write outside the sink. This extends the `import-graph` matcher kind with an optional `content` pattern, in the rule engine, the harness and its self-test.
  - **Fixtures and table.** Each row has its fixture, and the lint fixture is a `bin/lib` file. The import-graph fixture is a `bin/cli` module reachable from `mcp/`. Each row gets a CLAUDE.md chokepoint-table line.
  - **No disables.** No `eslint-disable` is added anywhere.

### Hooks (PLUG-14)

- **D-23a-15 — Hook entries: guarded, stdin-driven, quick outside a paper.**
  - **Common behaviour of every `hooks/<name>.ts` entry.**
    - It runs `main()` only under `isMainModule(import.meta.url)` (RUN-10).
    - It reads Claude Code's stdin JSON, bounded at 2 s.
    - It resolves the paper with `resolvePaperRoot({mode:'hook', cwd: input.cwd ?? workingDirectory()})`. It never follows the `open` pointer.
    - It always exits 0, sends diagnostics only to stderr, and writes only protocol JSON to stdout.
  - **Outside a paper.** When `hasPaper(root)` is false, each hook exits 0 in < 500 ms with no output and creates no files. Heavy modules are loaded through dynamic `import()` after the paper check. esbuild inlines those modules but defers their initialisation.
  - **What each hook does.** Hook logic lives in unit-testable `bin/lib` modules (`bin/lib/hooks/*.ts`); the `hooks/*.ts` files are thin entries.

    | Hook | Behaviour |
    |---|---|
    | SessionStart | Emits one line, `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`. The context carries the router's next step (`resolveNextAction`, read-only), a summary of any not-done `HANDOFF.json`, and the instruction to run `/pensmith` to continue. It never emits `systemMessage`. |
    | PreCompact | Writes `.paper/HANDOFF.json` v2 (D-23a-16) within its 10 s deadline. |
    | PostToolUse | Reads `tool_name` and `session_id`. It appends at most one checkpoint per minute to `pensmithDataDir()/checkpoints/<projectHash(root)>.jsonl`, under a sentinel lock. The checkpoint holds `{ts, session_id, tool_name, next}`. Checkpoints never go under `.claude/` or `.paper/`, because `.paper/` may sit in a sync folder and is seeded into dry runs. |
    | Stop | Keeps the D-17-37 policy. It releases the session lock only when the owner is kind `mcp` and its `claudeSessionId` equals stdin `session_id`. It flushes the session log. |

  - **Open verification.** The stream verifies in a real session that the plugin's MCP server sees `CLAUDE_CODE_SESSION_ID`. If Claude Code does not export it, the stream finds the id the server can see, fixes `claudeSessionIdFromEnv`, and records the evidence.
- **D-23a-16 — HANDOFF.json v2.** PLUG-14 needs "phase, section, plan/write/verify position", but v1's `phase` enum mixes paper stages with section stages, and the hook defaulted it to `intake`.
  - **Fields.**
    - `schema_version: 2`.
    - `phase ∈ {intake, research, outline, sectioning, compile, export, done, attention}`.
    - `section`: the section id as status shows it (`"2"`, `"1a"`), or null.
    - `position ∈ {plan, write, verify}`, or null.
    - `current_section`: the slug, as in v1.
    - `next_action`, `breadcrumbs` and `section_pointers`, as in v1.
  - **Source of the values.** They derive from the router's decision, not from a STATE.json field that no longer exists.
  - **Migration.** `bin/lib/migrations/handoff/v1_to_v2.ts` maps v1 phases `plan`, `write` and `verify` to `sectioning` with the matching `position`. `resume` and `session-start` read v1 and v2 through it (S-20). A file newer than v2 is ignored, never downgraded; HANDOFF is a disposable pointer file, and a newer one never blocks.
  - **Size bound.** The ≤ 5,120-byte bound stays.

### CI (CI-05, PLUG-03)

- **D-23a-17 — `scripts/plugin-smoke.mjs` is the one CI-05 sequence, runnable locally.** Run it as `npm run plugin:smoke`, with `CLAUDE_BIN` overriding `claude` on PATH. It needs no API key. The sequence:
  1. **Validate.** Run `claude plugin validate --strict` on `plugin/`, on `plugin/.claude-plugin/plugin.json` and on the repo root (the marketplace). Each must exit 0.
  2. **Negative control.** The same command on `tests/fixtures/plugin-legacy` must fail.
  3. **Install from a fresh clone.** `git clone --local` the working tree into a temp dir, with no `npm ci` and no build. Then, in an isolated `CLAUDE_CONFIG_DIR` and `HOME`, run:
     - `claude plugin marketplace add <clone>`
     - `claude plugin install pensmith@pensmith`
     - `claude plugin list --json`: pensmith is enabled with no errors.
     - `claude plugin details pensmith`: 8 skills including `pensmith`, 4 hooks, 1 MCP server.
  4. **Server health.** `claude mcp list` shows the plugin server `✓ Connected`.
  5. **Direct launch.** Launch the MCP server command from the installed cache with `CLAUDE_PLUGIN_ROOT` set. `initialize` and `tools/list` must succeed with the expected tools, including `pensmith_status`.
  6. **No node on PATH.** Re-run `claude mcp list` through the absolute `claude` path, with every PATH directory that holds a `node` executable removed. The plugin server must be reported as not connected.
- **D-23a-18 — The CI `plugin` job.**
  - **Where it runs.** It is a job in `.github/workflows/ci.yml` on ubuntu, macos and windows with Node 22.
  - **What it does.** It runs `npm ci`, installs the pinned Claude Code 2.1.285 (≥ 2.1.282, the version these checks were made with), and then runs `npm run plugin:smoke`. The stream picks the install method that yields a working `claude` on each OS: the npm package or the official installer.
  - **Unavailable OS.** If an OS cannot run it, that OS is dropped from the matrix with a written reason in `ci.yml` and the summary.
  - **Other `check` job changes.** The existing `check` job gains `npm run bundle:check`.
  - **Required check.** Making the `plugin` job a required check is a GitHub branch-protection setting. It is a maintainer item recorded in the summary (D-V1-07 spirit); this automation never pushes.
- **D-23a-19 — Real headless sessions are local evidence, not CI.**
  - **The script.** `scripts/plugin-session-check.mjs` needs the local `claude` login; the CLI needs no API key. It runs the PLUG-03 checks (the init frame, `Loaded N skills` in the debug log, `/pensmith status`), the PLUG-04 dedupe check and the PLUG-14 SessionStart-context check against scratch copies only.
  - **Session safety.** Each run uses an isolated `CLAUDE_CONFIG_DIR`, stdin `< /dev/null`, `--max-turns` ≤ 3, and an explicit `--allowedTools`. `--disallowedTools` includes `SendUserFile` and the other remote-session tools; an earlier assessor run's child session sent a file card into the user's session.
  - **Where results go.** Results are recorded in 23a-VERIFICATION.md.
  - **Out of scope.** The multi-session end-to-end paper runs are PLUG-09 (Phase 23b) and are not in scope.

### Documentation

- **D-23a-20 — Doc amendments ship with the layout.**
  - PRD §13 gets the `plugin/` tree. It is marked as the canonical home of workflows, templates, references, presets, skills and agents for both tiers, with only the JS bundles generated.
  - PRD §14 "Two-tier source-of-truth" is amended. Tier 2 implements each verb in `bin/cli` from the same `plugin/` prompts, presets and references rather than interpreting workflow bodies at runtime. PLUG-09's name test and PLUG-15 keep the bodies and the code in step.
  - CLAUDE.md is updated:
    - architecture, the Tier 1 plugin bullet and the gotchas: `npm run bundle` after changing `bin/lib`, `mcp/` or `hooks/`;
    - the `node_modules` rule;
    - the chokepoint table: new rows `plugin-assets`, `stdout-sink` and `mcp-stdout-graph`, and the bundle row now reads `plugin/dist/`;
    - the hash-pinned paths: `plugin/templates/prompts/*.md` and `plugin/references/*.md`.
  - CONTRIBUTING and README-DEV are updated to match.
  - Hash values do not change, because the move is byte-identical. Only the pinned paths change.

## Carried constraints

- **Unchanged rules.** The locked 16 verbs, section-as-phase isolation, the verifier gate, zero-trace exports, approval gates and the Tier-1/Tier-2 parity test all hold unchanged. Nothing in 23a weakens a test or gate, or adds an `eslint-disable`.
- **Tests that encoded invalid shapes.** Tests that encode the invalid plugin shapes are rewritten to assert the spec, and the summary says so: `tests/manifest.test.ts`, `tests/hooks-noop.test.ts`, `tests/skill-descriptions.test.ts`, the tier-contract plumbing case and `scripts/validate-plugin-manifest.cjs`.
- **Cross-platform.** Code uses `path.join` and `path.resolve`. Symlink tests fall back to junctions on Windows. Everything uses LF line endings, and nothing assumes a POSIX-only path in shipped code.
- **Privacy.** No personal data goes into fixtures or external requests, and the polite-pool contact is `pensmith-dev@example.org`.
