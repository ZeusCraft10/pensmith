# Contributing to Pensmith

Pensmith is in development toward v1.0.0 (see `.planning/ROADMAP.md`). Feature work goes through the GSD phase flow; `CLAUDE.md` is the architecture guide for humans and agents alike.

## Setup

Requires **Node ≥ 22.12** (CI runs the Node 22 and 24 LTS lines on Ubuntu, macOS arm64 and Windows).

```bash
npm ci
npm run build        # prebuild (version + verb table) then tsc → dist/
npm run bundle       # prebuild, then the committed plugin bundles → plugin/dist/ (esbuild), then the plugin version stamp
npm run plugin:version  # re-stamp plugin/.claude-plugin/plugin.json's version after any change under plugin/
npm run check        # the full local gate: prebuild · lint · typecheck · build · tier-contract · tests · manifests · bundle:check
```

### The plugin directory and the developer `.mcp.json`

The Claude Code plugin is the `plugin/` directory (PLUG-02): its manifest, skills, hooks config, workflow bodies, templates, references and agents, plus the committed bundles in `plugin/dist/` built from `mcp/server.ts` and `hooks/*.ts`. It is also where the Tier-2 CLI reads its prompts, presets and references (`bin/lib/paths.ts` `pluginRoot()`), so there is exactly one copy of each. Never add a workflow, prompt, preset, reference, skill or agent outside `plugin/` (`tests/plugin-layout.test.ts` fails), and never put a `bin/`, a CLAUDE.md or `node_modules/` inside it (`npm run validate:manifests` fails).

The repo-root `.mcp.json` gives a developer session the same MCP server with no build: `node ${PWD:-.}/plugin/dist/mcp/server.mjs`.

- Open Claude Code **at the repository root**. The path is relative to it, so a session started in a subfolder cannot find the bundle.
- `${PWD}` is the `PWD` environment variable Claude Code inherits, not the folder it runs in, so it must name the repository root too. A shell that `cd`s into the root sets it; a launcher that starts Claude Code with the root as its working directory but passes on another `PWD` (an IDE extension started from another folder, the Agent SDK's `query({ cwd })`, `spawn('claude', { cwd })`) makes the server fail with `CONNECTION_CLOSED`. Such a launcher should set `PWD` to the same folder, or unset it. **Claude Code on the web is one**: it runs Claude Code in the repository but passes `PWD=/home/user` (observed in the main-branch merge review, round 1: the Claude Code process's working directory was the checkout, its `PWD` the home folder), so the project server fails with `CONNECTION_CLOSED` in every web session, and a web session cannot change the `PWD` Claude Code starts with. There, drive pensmith through the CLI (`npm run pensmith -- <verb>`), or install the plugin (`/plugin marketplace add ./` then `/plugin install pensmith@pensmith`), whose server path is `${CLAUDE_PLUGIN_ROOT}` and does not depend on `PWD`. Claude Code does not expand `${CLAUDE_PROJECT_DIR}` in `.mcp.json` (it reports "Missing environment variables: CLAUDE_PROJECT_DIR"), so there is no variable that names the project folder itself. `node scripts/plugin-session-check.mjs` records all three cases (`PWD` equal to the root, unset, and another folder), and the `--plugin-dir` dedupe with `PWD` equal to the root and with it unset (below).
- `${PWD:-.}` falls back to a relative path where `PWD` is unset (PowerShell, cmd). Under **Git Bash on Windows**, `PWD` is an MSYS path (`/c/Users/…`) that `node` cannot open; start Claude Code from PowerShell or cmd instead.
- With `claude --plugin-dir ./plugin` at the root **and `PWD` equal to the root** (a POSIX shell that `cd`s there), Claude Code registers the server once, because `${PWD}` makes the two expanded command lines identical. The server it keeps is the **project** one, named `pensmith`, and it drops the plugin's `plugin:pensmith:pensmith`, so the tools are `mcp__pensmith__*` rather than `mcp__plugin_pensmith_pensmith__*`. The plugin's PostToolUse matcher (`^mcp__(?:plugin_pensmith_)?pensmith__.*`) and the `pensmith` skill's `allowed-tools` (both `pensmith_status` names) cover both spellings, so checkpoints and the status pre-approval work in this setup too.
- **Where `PWD` is unset (PowerShell, cmd) the dedupe does not happen.** The project server then runs `node ./plugin/…` and the plugin's runs an absolute path, so Claude Code keeps **both** — `pensmith` and `plugin:pensmith:pensmith`, each connected, with the same tools — and two calls that land on different servers contend for the paper's session lock. (On Windows, Claude Code also writes `${CLAUDE_PLUGIN_ROOT}` with forward slashes, so setting `PWD` by hand is not known to make the lines match.) There, do not combine the two: to try the plugin from the checkout, turn the project server off, for example with `"disabledMcpjsonServers": ["pensmith"]` in `.claude/settings.local.json` (gitignored here) — the session then has only `plugin:pensmith:pensmith`. Remove the entry to get the project server back. Without `--plugin-dir`, the project server alone works in every shell (`${PWD:-.}`). `node scripts/plugin-session-check.mjs` records the PWD-unset case and checks the workaround.
- The server is the committed bundle, so it reflects your source edits only after the bundle is regenerated from them.
- This server and the plugin's carry the same `"timeout": 1800000` (30 minutes, per tool call). It overrides `MCP_TOOL_TIMEOUT`, which Claude Code on the web sets to 60 seconds — shorter than a section write with its chained verify. `npm run validate:manifests` requires it in both files; `node scripts/plugin-session-check.mjs --only slow-call` checks a call longer than 60 seconds live.

### The committed plugin bundles (`plugin/dist/`)

A git-marketplace install runs no build and Claude Code's plugin cache holds only `plugin/`, so the plugin's MCP server, its PDF worker and the four hooks ship as committed, self-contained ESM bundles (`scripts/bundle.mjs`: `plugin/dist/mcp/server.mjs`, `plugin/dist/mcp/pdf-worker.mjs`, `plugin/dist/hooks/<name>.mjs`; PLUG-02). They are generated files:

- **After changing anything under `bin/` (`bin/lib/` or `bin/cli/`), `mcp/` or `hooks/`, the `package.json` version, or a dependency in `package-lock.json`, run `npm run bundle` and commit `plugin/dist/` with the change.** The bundles inline `bin/lib/`, the `bin/cli/` verbs the MCP tools and hooks run (plan, write, verify, status, route-options, goal), `bin/lib/version.generated.ts` (generated from the version) and the locked dependencies. `npm run bundle:check` (in `npm run check` and every CI matrix entry) re-bundles and fails on any modified, deleted or new file under `plugin/dist/`.
- **After any change under `plugin/` — a workflow body, a template or prompt, a reference, a skill, a bundle — run `npm run plugin:version` (`npm run bundle` does it too) and commit `plugin/.claude-plugin/plugin.json` with the change.** Its `version` is `<package.json version>+<the digest of plugin/'s files>` (`scripts/plugin-version.cjs`; in a git checkout the files git tracks under `plugin/`, so an untracked or ignored local file — an editor swap file, `.claude/settings.local.json` — never changes it, and a new file counts once you `git add` it): Claude Code keeps an installed plugin on its cached copy until that string changes, so a change that was not re-stamped would never reach anyone who installed from the git marketplace. `npm run validate:manifests` and `bundle:check` fail on a stale stamp; never edit the digest by hand, and after a merge that conflicts on that line, re-stamp instead of picking a side.
- Never edit a bundle by hand; ESLint ignores them and lint runs on their sources. `tests/plugin-bundle.test.ts` checks the 20 MB budget, that no bundle loads a module other than a Node builtin at runtime, and that the server boots from a copy of `plugin/` with no `node_modules`.
- Bundles must be generated from dependencies that match `package-lock.json`: run `npm ci` in the checkout you bundle from. If your `node_modules` is a symlink into another checkout, remove the symlink (`rm node_modules`) and run `npm ci` in your own checkout first — never `npm install` or `npm ci` through the symlink, which rewrites the other checkout's `node_modules`.

### The real plugin with Claude Code

- `npm run plugin:smoke` (`scripts/plugin-smoke.mjs`, CI-05) runs the CI `plugin` job locally with the Claude Code on `PATH` (or `CLAUDE_BIN=/path/to/claude`) and no API key: `claude plugin validate --strict` on `plugin/`, its `plugin.json` and the marketplace, the `tests/fixtures/plugin-legacy` negative control, then — from a fresh `git clone --local` of your **committed** tree in a temp folder, with an isolated `CLAUDE_CONFIG_DIR` — marketplace add, install, `plugin list --json`, `plugin details`, `mcp list`, the installed server's `initialize` / `tools/list`, and "not connected" with no `node` on `PATH`; then it serves that clone over git's smart HTTP on `127.0.0.1` (`git http-backend`, `scripts/git-http-host.mjs`), installs from that URL, pushes a re-stamped change under `plugin/` and checks that `claude plugin update` installs it. `--repo <dir>` checks another repository or a scratch assembly.
- `node scripts/plugin-session-check.mjs` (`D-23a-19`, local only) runs short real headless sessions with the plugin against a fresh clone (isolated config, allow-listed environment, `--max-turns` ≤ 3, no permission bypass) and prints evidence lines for PLUG-03/04/05/14. It needs your Claude login (a credentials file in your Claude config dir is copied into the temp config; if yours lives in the macOS keychain, set `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`) and costs a few cents; pensmith itself needs no key. Run `npm run build` first — it makes its paper with `dist/bin/pensmith.js`.

## Architectural chokepoints (Phase 0+)

Some concerns may live in exactly one module. Violating a chokepoint fails CI, and the fix is always to restructure the code — never to silence the rule.

1. **HTTP imports**: `fetch`, `http`, `https`, `node:http`, `node:https`, `undici` may only be imported from `bin/lib/http.ts`, the one egress gate. Every other module routes through that file.
2. **DOI regex**: The literal regex `/^10\./` may only appear in `bin/lib/doi.ts`. DOI normalization is a single chokepoint per `.planning/research/PITFALLS.md` Pitfall 2.

The full list — with the module each concern belongs to and what enforces it — is the chokepoint table in `CLAUDE.md`. The older chokepoints are `no-restricted-imports` / `no-restricted-syntax` rules in `eslint.config.js` with `tests/lint-*.test.ts` regression gates. Every chokepoint added from Phase 17 on is a **row**: a JSON file in `scripts/chokepoints/<id>.json` read by the local ESLint rule `pensmith/chokepoint` (`scripts/eslint-rules/chokepoint.mjs`). A row names its requirement, the one allowed module, the files it covers (`scope` / `allow` globs) and a matcher (`string-literal`, `import`, `call`, `member`, `file-regex` or `import-graph`). An `import-graph` matcher can also take `content` (a regex the reached module's text must match too, as the `mcp-stdout-graph` row uses to find a stdout write anywhere the MCP server can reach) and `typeImports: "allow"` (type-only imports, erased at runtime, are not followed); a row whose fixture must sit at a particular path to be reached names it in `fixturePath`. The header of `scripts/eslint-rules/chokepoint.mjs` documents every field. To add a chokepoint, add the row, a failing fixture `tests/fixtures/chokepoints/<id>.violation.ts.txt`, and a line in the CLAUDE.md table in the same change; `tests/chokepoints.test.ts` lints every fixture, re-checks the file-regex and import-graph rows across the tree, and fails if a row is missing from CLAUDE.md. The `no-new-eslint-disable` row forbids new inline disable directives: the 12 that predate it are its baseline.

## Locked copy files (SHA-256 byte-pinned)

Some `plugin/references/*.md` files are the SINGLE source of truth for user-facing prose
that production code renders verbatim. Each is byte-pinned by SHA-256 in
`tests/repo-files.test.ts`. Editing one without re-pinning the hash fails CI.

### Honesty framing copy is LOCKED

`plugin/references/honesty-framing.md` is the single source of the honest-framing
prose shown with the AI-detector score — whichever detector is configured
(GPTZero, Originality.ai or Sapling). `bin/lib/honesty.ts` reads and renders it
VERBATIM — the copy is never inlined in code. This file is byte-pinned in
`tests/repo-files.test.ts`.

Any wording change is a deliberate PR that MUST also re-pin the SHA-256 in
`tests/repo-files.test.ts` (the test message prints the new hash to paste). The
framing MUST remain transparency-only: it states what a detector's score means and
that the humanizer "improves prose" — it NEVER claims to make output undetectable
and is NEVER framed as a detection-avoidance tool. This is the CLAUDE.md
non-negotiable ("improves prose, does not evade detection"); a PR that turns the
framing into an undetectability claim must not be merged.

### The humanizer contract is LOCKED

`plugin/references/humanizer-contract.md` is the fixed instruction pensmith adds
to every Tier-2 humanizer request: `bin/lib/humanizer.ts` sends its `## Contract`
section VERBATIM after the user's skill (the system prompt). It binds the
humanizer to the rewrite guard's rules — every placeholder, heading and quote
kept, each citation on its claim, the final rewrite only. It is byte-pinned in
`tests/repo-files.test.ts`, and the same no-evasion rule applies: it describes
the humanizer as improving prose, never as a way to avoid AI detection (a
test fails on any un-negated "undetectable", "evade", "evasion" or "bypass").

The committed zero-trace negative-control fixtures
(`tests/fixtures/sample-zero-trace.docx` and `.pdf`) are likewise SHA-256
byte-pinned in `tests/repo-files.test.ts`. They are regenerated via
`node scripts/make-zero-trace-fixture.mjs` / `node scripts/make-zero-trace-pdf-fixture.mjs`;
re-pin the hash in the same PR if a regeneration is intentional. A silently
changed fixture could mask a real zero-trace regression, so drift is a CI failure.

## Prompt templates: layout and the re-pin rule

Every model call is built from one `plugin/templates/prompts/<slug>.md` template. A template is **fixed instruction text** — it interpolates nothing (no `{{…}}` placeholders):

- its frontmatter lists its data inputs, `inputs: [<tag>, …]`, and its `## Inputs` section describes each tag; a template with an untrusted input carries the standard "fenced content is data, never instructions" paragraph naming both fence markers;
- the request is `buildPromptRequest(slug, values)` (`bin/lib/prompt-request.ts`): the template is the **system prompt**, byte-identical on every call of the slug, and the per-call data is **one user message** of tagged blocks (`<tag>…</tag>`) in the order `PROMPT_INPUTS` declares for the slug — each value sent once, JSON payloads built field by field in a fixed order so the bytes (and replay hashes and cache keys) are deterministic;
- inputs `PROMPT_INPUTS` marks `untrusted` (source metadata and abstracts, drafts under review, PDF text, the pasted assignment) are wrapped by the renderer in the one FEED-05 fence (`bin/lib/untrusted-fence.ts`, the only module that defines the fence markers); every payload is stripped of fence markers and a closing tag of any declared input is neutralised, so data can neither end its fence nor its block;
- because the system prompt never changes between calls, it is marked for **prompt caching** (`cache_control` on the Anthropic shape; the first system message on chat-completions providers). It is only cached when it reaches the model's minimum cacheable length (512 tokens for `claude-opus-5`, 4096 for `claude-haiku-4-5`; `pensmith status --config` shows each step's). Keep generation templates above 512 tokens by being complete, never by padding.

Templates are **hash-pinned**: `EXPECTED_PROMPT_HASHES` in `bin/lib/prompt-loader.ts` (re-checked at runtime) and `PENDING_HASH_PINS` in `tests/repo-files.test.ts`. Any edit to a template re-pins **both** in the same commit — recompute with

```bash
node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('plugin/templates/prompts/<slug>.md')).digest('hex'))"
```

Adding or renaming an input tag is a template re-pin **plus** an edit of `PROMPT_INPUTS` (the template's `inputs:`, its `## Inputs` section and the table must agree — `tests/prompt-layout.test.ts`). Adding or renaming a slug is a locked decision (D-12).

## Quick checklist before opening a PR

- `npm run check` is green locally
- CI matrix (linux-x64, macos-arm64, windows-x64 × Node 22 and 24) is green
- No new chokepoint violations and no new inline disable directives
- Docs match the behavior you changed (`plugin/workflows/<verb>.md`, the skills in `plugin/skills/`, README, `docs/`, CLAUDE.md, `plugin/references/`)

## Test lanes

| Lane | Command | Network | Notes |
|------|---------|---------|-------|
| Unit + integration | `npm test` | sources **offline** (exact recorded fixtures) | `scripts/run-tests.mjs` discovers `tests/**/*.test.ts` (no shell glob, so Windows runs them too) and refuses a zero-file run. |
| Tier contract | `npm run test:tier-contract` | offline | `tests/tier-contract.test.ts` + `tests/tier-contract/`, through the same runner. |
| Coverage | `npm run test:coverage` | offline | c8 gate: 80% lines/statements, 66% functions/branches. |
| Live lane | `PENSMITH_NETWORK_TESTS=1 npm test` | **live** | Maintainers only; reaches the real APIs (and, with keys, providers). |

- Tests never make an external connection: under the test runner sources are offline unless `PENSMITH_NETWORK_TESTS=1`, a model call goes to the local mock LLM (`tests/helpers/local-servers/`, also runnable as `npm run mock-llm`), and the installed-package tests install from a loopback npm registry built from `package-lock.json` and your npm cache (run `npm ci` once so the cache holds the tarballs).
- Several tests spawn the **built** CLI or MCP server (`dist/`). Run `npm run build` after changing source.
- Whole-workflow tests use `tests/helpers/e2e-chain.ts`: one project folder, an isolated data dir, the mock LLM configured through that data dir's `runtime.json`, per-slug call counts, and the recorded e2e corpus (below) for sources.
- Run one file with `node --import tsx --test tests/<file>.test.ts`, or through the runner with `node scripts/run-tests.mjs tests/<file-or-dir>`.
- A draft written under `PENSMITH_NO_LLM=1` carries the stub marker and is `PLACEHOLDER` to the verifier outside `--dry-run` (VRFY-24): a test that needs a draft to verify, compile or export uses the mock LLM (its default replies are the same contract stubs, unmarked), `--dry-run`, `write --no-verify` followed by a seeded draft, or a hand-written DRAFT.md — never a way around the verdict.
- compile and done recompute every verdict over the text they process (D-20-23..25): a fixture's VERIFICATION.md and PLAN.md must agree with its draft and bibliography, and a compiled paper handed to `done` needs the compile record `done` checks (`tests/helpers/paper-cli-harness.ts` `writeCompileRecord`).
- Every local test server (mock LLM, TLS/SNI and streaming servers, MockAgent helper, npm registry) lives in `tests/helpers/local-servers/` — the only place under `tests/` allowed to import `node:http` / `undici`.
- **The export suites use pandoc as their oracle too** (Phase 21). `tests/citation-goldens.test.ts` compares the built-in renderer with pandoc 3.9's citeproc for all 8 styles (body, notes, bibliography text and link targets) against committed goldens in `tests/fixtures/citation-goldens/` — after a change to `fixture.md`, `fixture.bib` or a style, regenerate them with pandoc 3.9 on `PATH`: `node scripts/make-citation-goldens.mjs`, and commit the goldens. `tests/locator-oracle.test.ts`, `tests/markdown-subset.property.test.ts` (the subset reader against `pandoc -t json`), `tests/docx-writer.test.ts`, `tests/export-unicode.test.ts`, `tests/zero-trace-export.test.ts` and the pandoc paths of the exporter run against the live binary through `tests/helpers/pandoc-oracle.ts` `requirePandoc`: skipped with one line without pandoc, FAILED when `CI=true`. `tests/latex-standalone.test.ts` compiles both LaTeX paths when a TeX engine is found (`pdflatex`, `xelatex`, `tectonic` or `lualatex` on `PATH`, or `PENSMITH_TEX_ENGINE=<name or path>`); with `PENSMITH_REQUIRE_TEX=1` a missing engine fails it instead of skipping. The product never needs a TeX engine.
- **The citation-integrity property test needs pandoc** (HARDEN-03, D-20-09). `tests/citation-integrity.property.test.ts` generates at least 1000 drafts with fast-check and asks pandoc (3.x, the oracle) which citations each one holds: every key pandoc sees must be one Pass 1 checks, or the draft must carry a blocking UNPARSEABLE / UNSUPPORTED-FORM row, and the gate core never passes a draft with a form it cannot check. CI installs pandoc on every runner; locally, without pandoc on `PATH`, the test is skipped with one loud line (with `CI=true` it fails). A failure prints its seed — re-run it with `PENSMITH_PROPERTY_SEED=<seed>` (and more drafts with `PENSMITH_PROPERTY_RUNS=<n>`). `tests/citation-grammar-pandoc.test.ts` checks the grammar against recorded pandoc 3.9 readings (`tests/fixtures/citation-grammar/`, re-recorded by `node scripts/record-pandoc-cites.mjs`) and, when pandoc is on `PATH`, against the live binary.

### Data-dir isolation

Tests never touch your real Pensmith data dir (the global paper registry, `runtime.json`, locks, the HTTP cache). `scripts/run-tests.mjs` creates one temp dir per run, points `XDG_DATA_HOME`, `LOCALAPPDATA` and `PENSMITH_TEST_DATA_DIR` at its `data/` and `TMPDIR` / `TEMP` / `TMP` at the dir itself (so every temp dir a test or a spawned CLI makes goes with it), sets `PENSMITH_TEST=1`, and deletes it afterwards (`PENSMITH_KEEP_TEST_DATA=1` keeps it and prints the path). Under a test context `bin/lib/paths.ts` honours a platform data-dir variable only when it lies inside the OS temp dir, so a single file run with `node --test` — and every CLI it spawns — gets a private per-process temp dir even on macOS, where the data dir derives from `HOME`. CI records a fingerprint of the real data dir before the tests and fails if it changed afterwards (`scripts/data-dir-fingerprint.mjs`; the check runs even when the test step failed), and `scripts/run-tests.mjs` does the same around every local run once `dist/` is built, so a leak shows up on your machine too. A test that must spawn the CLI **without** a test context (to prove live-by-default behaviour) sets `XDG_DATA_HOME`, `LOCALAPPDATA` and, on macOS, `HOME` to a temp dir itself.

## Tier contract — do not skip

Pensmith ships as a Claude Code plugin (Tier 1: the `plugin/` directory, whose MCP
server is the bundle `plugin/dist/mcp/server.mjs`; the tier-contract tests spawn the
tsc build of the same source, `dist/mcp/server.js`) AND as a portable Node CLI
(Tier 2: `dist/bin/pensmith.js`). The two tiers MUST expose
the same observable behavior for the operations declared in `tests/tier-contract.test.ts`.
This is the load-bearing property of the project.

### What the tier contract guarantees

For the operations covered in Phase 2:
- `paper://capabilities` (MCP resource, Tier 1) and `pensmith doctor --json` (CLI, Tier 2)
  report the same boolean facts about the host environment (same env vars present,
  same sync-folder warnings).
- `paper://capabilities` content is presence-flag booleans only — NEVER a resolved
  key value. D-12 lint enforces this at build time; `tests/tier-contract.test.ts`
  Case B enforces it at runtime.
- `paper_advance_section` is idempotent: applying the same `{paperRoot, n, toState}`
  twice produces byte-identical tool output and the resulting `paper://state` is
  unchanged on the second call. Asserted by `tests/tier-contract.test.ts` Case C.
  (Per TIER-02 / D-13 the snake_case tool name is `paper_advance_section`; the
  Phase-2 tool surface ships 6 such granular tools — there is no generic
  `state.update`.)

### The four merge-gate layers

All four MUST be green on every PR. If any one is red, do not merge — fix the
underlying issue.

1. **CI step (layer 1):** `.github/workflows/ci.yml` runs `npm run test:tier-contract`
   on linux-x64, macos-arm64, windows-x64 (per D-22 — 3-OS matrix). Failure blocks
   merge.

2. **Branch protection (layer 2):** Configured in GitHub repo settings →
   Settings → Branches → main → "Require status checks to pass before merging".
   The required checks include the matrix's tier-contract step on all 3 OSes.
   This is a one-time setup; if you're forking pensmith, ask the maintainer
   to add the same protection on your fork.

3. **Preflight (layer 3):** `node scripts/validate-plugin-manifest.cjs`
   (`npm run validate:manifests`) checks the plugin against the Claude Code spec and
   pensmith's contract: `plugin/.claude-plugin/plugin.json` (no `skills` object array,
   no `hooks` key, the inline MCP server on the committed bundle, `version` =
   `<package.json version>+<content digest of plugin/>` — `scripts/plugin-version.cjs`;
   `npm run plugin:version` stamps it),
   `plugin/hooks/hooks.json` (the 4 events in exec form, their bundles present), the
   8 `plugin/skills/<name>/SKILL.md` skills, `plugin/workflows/` (exactly 16 .md
   files with `<capability_check>` blocks — one per UX-02 canonical verb per
   CONTEXT D-05), the marketplace source `./plugin` and the developer `.mcp.json`;
   it rejects the pre-v1 shapes (`tests/fixtures/plugin-legacy/`). Runs in CI after
   `npm test`, next to `claude plugin validate --strict` on the real plugin (CI-05).

4. **Prose (layer 4 — this section):** The "Tier contract — do not skip" section
   in `CONTRIBUTING.md`. The Phase 2 D-24 lock keeps this section intact.
   `tests/repo-files.test.ts` asserts its presence.

### Wave 1 lint chokepoints (the file you're not allowed to write)

Three AST-walk ESLint rules scoped to `mcp/**/*.ts` catch the most common
"leaked-secret" / "broke-the-tier-contract" mistakes at build time. **A failing
chokepoint is the SIGNAL you tried to do something the architecture forbids.**
The fix is never to disable the rule. The fix is to write the code differently.

- **D-09 thin-shim** (`tests/lint-thin-shim.test.ts`): every MCP tool handler is
  ≤30 statements and cannot import `node:fs` / `node:http` / `node:https` /
  `node:net` / `node:tls` / `node:child_process`. All real work goes through
  `bin/lib/*` chokepoints. If you find yourself wanting fs in `mcp/`, you want
  a new `bin/lib/<thing>.ts` helper that the handler calls.

- **D-10 mcp-no-network** (`tests/lint-mcp-no-network.test.ts`): no
  `net.createServer`, `http.createServer`, `https.createServer`,
  `tls.createServer`, or raw `new Server({...})`. MCP runs over stdio only.
  Adding a network listener inside mcp/** is a category error — your code
  will never be reached because the only transport pensmith wires is
  `StdioServerTransport`.

- **D-12 capabilities-no-leak** (`tests/lint-capabilities-noleak.test.ts`): no
  computed `process.env[<expr>]` reads and no inline calls to the helpers that
  return a secret or personal value — `getProviderApiKey()`, `openAlexKey()`,
  `s2ApiKeyValue()`, `loadRuntimeConfig()` and `contactEmail()` — inside
  `mcp/**`. The `paper://capabilities` resource emits only boolean presence
  flags. If you need to know whether a key is set in an MCP handler, expose
  the boolean through `paper://state` (which is loaded from
  non-mcp code that does have access to runtime.ts).

### Discipline rule: fix the tiers, don't write a normalizer

When a tier-contract test fails (or a lint chokepoint fires), **the default fix
is to make the two tiers agree by changing the shipped code in one of them**.

The fixes that are NOT acceptable:
- Adding a runtime "capabilitiesNormalizer" / "responseShaper" that strips
  offending fields before emit. This buries the bug in transformation
  layers and makes future divergence invisible.
- Loosening the assertion (e.g. changing `assert.deepEqual` to `assert.ok(... !== undefined)`).
- Skipping the test (`test.skip(...)`) or marking it `test.todo(...)`.
- Adding an `// eslint-disable-next-line` directive to silence a chokepoint.

The fixes that ARE acceptable, in order of preference:
1. Fix the SHIPPED code so the two tiers actually do the same thing.
2. Update the tier-contract test to reflect a deliberate, documented architectural
   change — this requires updating the corresponding D-decision in `.planning/phases/<N>/<N>-CONTEXT.md`
   and getting the change reviewed.
3. Mark the test as known-failing with a tracking issue and a deadline.
   Acceptable only with maintainer sign-off; not the right path 95% of the time.

## Cassette Refresh Workflow

`npm test` replays recorded HTTP fixtures under `tests/fixtures/cassettes/<adapter>/` for every source adapter (Crossref, OpenAlex, arXiv, PubMed, Semantic Scholar, Unpaywall, Retraction Watch, Open Library `books`, plain URL fetches under `generic/`, and the detector / plagiarism services). Replay is **exact-match**: a fixture answers only the method, origin, path and canonical query it was recorded for, and a miss fails closed (`OfflineEgressError`) instead of returning some other record. Hand-written negative-test fixtures live in `tests/fixtures/cassettes/synthetic/`; `tests/cassette-provenance.test.ts` rejects fabricated identifiers (`10.0000/`, `10.1234/example`) anywhere else. Real users never see cassettes: the CLI is live by default, and fixtures are a test and `PENSMITH_OFFLINE=1` mechanism only.

A separate workflow (`.github/workflows/cassette-refresh.yml`) re-records the cassettes against the live APIs on a weekly schedule and opens a PR with the refreshed fixtures.

### When cassettes need a manual refresh

- An API shipped a schema change (new field, renamed field, format change) and the offline tests fail locally with a parse error.
- A test needs a recording for a new query or identifier.
- The weekly cron PR has been sitting for > 14 days without merge.

### How to trigger a refresh

**Option A — manual workflow dispatch (preferred):**

1. Go to **Actions → Cassette Refresh → Run workflow** in the GitHub UI.
2. Pick the `main` branch.
3. The workflow re-records all cassettes and opens a PR. Review the diff,
   confirm no PII / API tokens leaked into recorded headers, then merge.

**Option B — local re-record:**

```bash
export PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org   # required: the project's polite-pool contact — never a personal address
npm run cassettes:refresh                        # every adapter
npm run cassettes:refresh -- --only crossref     # one adapter
npm run cassettes:refresh -- --only crossref --files search-title-attention   # named files only
node --import tsx --test tests/cassette-no-leak.test.ts tests/cassette-size.test.ts tests/cassette-provenance.test.ts
```

The recorder (`scripts/refresh-cassettes.mjs`) drives each adapter's recorded query set through the real adapter code, live and outside any test context, so each stored request is exactly what the adapter sends. It keeps only the `content-type` response header, strips `mailto` / `email` / `api_key` / `key` / `tool` query parameters, redacts the contact email and every other email address a response carries (`tests/cassette-no-leak.test.ts` fails on one), and never records a response the adapter rejected (a 429 or 5xx, an exhausted host, a body the adapter's shape check refuses: that FILE keeps its committed copy and is reported as not recorded — record it on a later run) or an error document inside an HTTP 200 (e.g. `{"statusCode":"403","message-type":"not-polite"}`: fix the adapter's request instead; `tests/cassette-provenance.test.ts` fails on a committed one). Files no longer in an adapter's query set are removed (with `--files`, only the named files are recorded and every other file is left as it is). A request another file of the same directory already answers is left to that file, so the exact-match store stays unambiguous.

The Phase 20 groups: `datacite/` (DataCite's `/dois/<doi>` answers, found and 404), `generic/` also holds doi.org content-negotiation answers (`cn-*.json`, CSL JSON for an mEDRA or JaLC DOI) next to the registration-agency lookups, `pubmed/efetch-*.json` the abstracts, `europepmc/` the JATS full text Pass 3 reads for a PMCID, `unpaywall/` the answers that list open-access PDFs, and `oa-pdf/` a small real PDF behind its redirect (base64). Pass 3's quote checks against larger PDFs run on MockAgent or on PDFs the tests generate (`tests/helpers/text-pdf.ts`).

Redirects and binary bodies (D-19-07): the transport follows redirects itself, so a call answered through redirects is recorded as one entry per hop — each 3xx under its own URL with its `location` header — and offline replay follows the recorded hops through the same store (the `generic` group records plain URL fetches, e.g. the W3C `dummy.pdf` behind its http → https 301). A non-text body (a PDF) is stored base64 with `"bodyEncoding": "base64"`, and replay returns the exact bytes. A binary answer still has to fit the 51200-byte cap, so only small real PDFs can be recorded; larger ones are covered with MockAgent tests or the generated fixtures in `tests/fixtures/byo/` (`scripts/gen-byo-pdf.mjs`). A request that reads only a prefix of its answer (`FetchOptions.prefixBytes` — `open-access.ts` checks an open-access link's first 1029 bytes for `%PDF-`) records that prefix, so a real publisher PDF's check fits (the `generic` group's `confirmOpenAccessPdf` calls, e.g. `generic/oa-pdf-prefix-plos-one.json`); doi.org's registration-agency answers are recorded there too (`generic/doi-ra-prefixes.json`).

Scenario recordings: the research fixture lane (`tests/research-cli-lane.test.ts`, `tests/plan-research-cli.test.ts`, `tests/byo-new-cli.test.ts`) replays searches recorded exactly as research asks them (10 results per query, `fromYear` for `min_year`); the recorder refuses to lower their result count, since a lowered count would never replay. An adapter whose answer cannot fit the cap at that size (OpenAlex with abstracts) is reported by those runs as `offline: no recorded fixture`, and the live lane covers it. Never hand-write a response the real API does not return.

`npm run live:sources` (`scripts/live-sources.mjs`, with `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`) runs the adapter-level assertions against the live services — arXiv, Crossref (ENCODE, `nature14539`, Wakefield retracted, the bibliographic search), DataCite, doi.org content negotiation, Unpaywall, PubMed (with `efetch` abstracts), OpenAlex, Semantic Scholar and the books adapter — and exits non-zero on a failed check. A check whose key is absent (`OPENALEX_API_KEY`, `PENSMITH_S2_API_KEY`) prints a visible `SKIP` line. The default `npm test` never calls these services.

`npm run live:verify` (after `npm run build`, with the same contact email) runs the verifier itself against the live services: `scripts/live-verify.mjs` runs `pensmith verify 1` through the built CLI on seeded sections — every identifier of the VRFY-11 list OK and `10.99999/fake.001` FABRICATED, an identifier-less real work found by the metadata search and an unknown one UNRESOLVABLE, the known-bad citations FABRICATED and the known mis-citations MIS-CITED, the Wakefield paper RETRACTED, and a computer-science and a medicine topic researched live and cited in full with zero false blocks — then `scripts/live-verify-quotes.mjs` runs Pass 3 on real open-access text (a genuine NumPy sentence PASS and a fabricated one NOT_FOUND, the PLOS ONE PDF, arXiv's `.pdf` redirect, and a second run served from the extracted-text cache). Both use a fresh data dir and never a personal address; the keyless OpenAlex budget allows about one run a day (set `OPENALEX_API_KEY` for more). A row whose lookup got no answer fails closed (UNVERIFIABLE-NETWORK) and is not counted; when it was expected to be FABRICATED or UNRESOLVABLE, the lane prints `INCONCLUSIVE` for that verdict and its `PASS` line does not claim it — evidence for VRFY-11 / VRFY-12 comes from a run with none (`PENSMITH_LIVE_STRICT=1` makes an inconclusive check fail the run).

### The recorded e2e corpus (`--corpus e2e`)

The chain tests (`tests/helpers/e2e-chain.ts`: the built CLI, an isolated data dir and the mock LLM) run the whole workflow — from `tests/fixtures/assignment.txt` through research, outline, every section's plan → write → verify, compile and done — **offline**, against a recorded corpus:

- `tests/fixtures/cassettes/e2e/<adapter>/` — real recordings of every source request the chain makes: the research searches for the corpus queries, the Retraction Watch cross-check of each kept source and each kept source's Pass-1 lookups. It is a separate root, so a per-adapter refresh never wipes it;
- `tests/fixtures/e2e-corpus/mock-script.json` — the scripted model replies that lead the chain to those requests (intake-clarifier, topic-disambiguator with the five corpus queries — research sends 5–10 per scope, so fewer would be padded with unrecorded ones — and the source-evaluator's verdict for every candidate of its one batch: the keep-list kept, every other candidate rejected, since a candidate with no verdict is kept as "not evaluated"); every other step uses the contract stubs;
- `tests/fixtures/e2e-corpus/MANIFEST.json` — what was recorded and when, the (adapter, query) searches that miss offline and why (a response over the 51200-byte cap, a rate-limited endpoint), the kept sources (at most 6, each verified live), the expected section count and the run bound (5 + N bare runs).

Re-record it when an adapter's request URL changes (the offline chain then misses) or the corpus queries change:

```bash
export PENSMITH_CONTACT_EMAIL=you@example.org
npm run cassettes:refresh -- --corpus e2e
node scripts/run-tests.mjs tests/e2e-corpus-manifest.test.ts tests/cassette-provenance.test.ts tests/cassette-size.test.ts tests/cassette-no-leak.test.ts
```

The recorder records the searches live (research's own discovery over the computer-science adapter plan), replays research's pass offline to pick the candidates exactly as the chain will (dedup, citekeys, tiers, the `[sources]` policy; it refuses a batch over the evaluator's 150, which would make the chain call the evaluator twice), records the kept sources' lookups live (keeping only sources whose live Pass 1 is OK), writes the manifest and the scripted replies, and replays research and Pass 1 once more before it finishes; any failure restores the previous corpus. The same scrubbing and cap rules as above apply, and a key a per-adapter cassette already answers is not recorded twice. `tests/e2e-corpus-manifest.test.ts` checks the manifest against the files and replays the corpus offline. The weekly refresh workflow re-records the per-adapter cassettes only.

### Permissions reminder

The cassette-refresh workflow declares **job-level** permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
```

This is REQUIRED — the repo-default `contents: read` would silently fail to
push the refresh branch and the `peter-evans/create-pull-request@v6` action
would 403 on PR open. If you fork this repo, replicate the same job-level
permissions block; do NOT promote them to repo-wide `contents: write`.

### Cassette byte-size cap (D-25)

Every recorded cassette file MUST be ≤ 51200 bytes. The `cassette-size`
test enforces this on every PR. The recorder meets the cap by re-recording a
search with a lower result count (and reports the new count so the test that
replays it can be updated), or — for a single record that only fits without
indentation, such as Crossref's `/works/{doi}` (no `select` on that route) — by
writing that one response on a single line; never by truncating JSON, and
never by raising the cap.

### Sensitive-header scan (T-3-02 / T-01-07)

The `cassette-no-leak` test scans every committed cassette for
`Authorization`, `Cookie`, `Set-Cookie`, and `X-Api-Key` headers. The
refresh workflow must NEVER commit a cassette that carries one. If the
refresh PR diff shows any such header, abort the merge and fix the
recorder before re-running.
