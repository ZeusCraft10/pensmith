---
phase: 23a-plugin-packaging
verified: 2026-09-30
verified_at_branch: v1/p23a (closer: gate, plugin smoke, live sessions and user-path checks at 03d1654 — §8; review round 3 fixer at 339a2de — §7; round 2 at 0f2c2c3 — §6; round 1 at 90f8c7d / df1e767 — §1-§3)
status: closed — 6 of 8 requirements met; PLUG-04 and CI-05 pending maintainer items (§8)
requirements_in_scope: [PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-13, PLUG-14, CI-05]
requirements_met: [PLUG-01, PLUG-02, PLUG-03, PLUG-05, PLUG-13, PLUG-14]
requirements_not_met: [PLUG-04, CI-05]
open_items:
  - "CI-05 (NOT complete): the `plugin` job (ubuntu, macOS, Windows) and `bundle:check` in `check` have not run on a GitHub runner (v1/p23a has no upstream) — maintainer, after the push; record the run URLs in 23a-SUMMARY, then tick CI-05"
  - "CI-05: make the `plugin` and `check` jobs required checks on main — maintainer (§5)"
  - "PLUG-14: the spawned-bundle hook tests' macOS and Windows legs (23a-PLAN §6: 'pass on all 3 OSes in CI') — pending the same first green `check` matrix"
  - "PLUG-04 (NOT ticked, review round 3): criterion 1 fails under a stale PWD or Git Bash's MSYS PWD and criterion 2 where PWD is unset (PowerShell, cmd), with the documented workaround; no committed .mcp.json form meets both on every shell (Claude Code dedupes only on an exact command-line match). Pending the maintainer's amendment of the acceptance text — proposed wording in 23a-PLAN §7.6"
review_rounds: [round 1 (fixer, 2026-09-30): §4, round 2 (fixer, 2026-09-30): §6, round 3 (fixer, 2026-09-30): §7]
closer: §8 (2026-09-30)
---

# Phase 23a: Plugin Packaging (PLUGIN-PACKAGING): Verification

This file records the evidence 23a-PLAN §7.4 and D-23a-19 ask for:
- the full gate;
- the CI-05 plugin smoke against the real Claude Code;
- the live headless sessions, which are the only proof of the real-session parts of PLUG-03, PLUG-04, PLUG-05 and PLUG-14.

§1–§7 are the executor's and fixers' records. §8 is the closer's re-run and the verdict for each requirement and success criterion.

Environment: Linux, Node 22, as root, Claude Code 2.1.285 (`/opt/node22/bin/claude`, the version the CI job pins). Claude Code reached the model through the host's `ANTHROPIC_BASE_URL` gateway, so no credentials file was copied into the isolated config in these runs.

## 1. Gate (v1/p23a at 90f8c7d, 2026-09-30)

| Step | Result |
|---|---|
| `npm run prebuild`, `npm run lint`, `npm run typecheck`, `npm run build` | exit 0 |
| `npm run validate:manifests` | exit 0: `plugin/ (plugin.json, hooks.json, 8 skills, 16 workflow bodies) + marketplace.json + .mcp.json valid` |
| `npm run bundle:check` | exit 0: `plugin/dist matches the committed bundles` (from a `node_modules` that `npm ci` made in this checkout) |
| `npm run test:tier-contract` | exit 0: 59/59 pass |
| `npm run test:coverage < /dev/null` | 2528 tests: 2527 pass, 1 fail. The failure is `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure", which fails only as root (`chmod 0o500` does not stop root; CLAUDE.md, passes in CI). No skips, no todos. Coverage: 93.34 % lines and statements, 84.37 % branches, 89.31 % functions (gates 80/66/66/80). |
| `node scripts/e2e-smoke.mjs` | exit 0: PASS=16, FINDING=0, FAIL=0 |
| `git status --porcelain` after the build and `npm run bundle` | clean |

## 2. CI-05 plugin smoke (`CLAUDE_BIN=/opt/node22/bin/claude npm run plugin:smoke`)

Exit 0. No API key. The installs run from a fresh `git clone --local` of the committed tree with an isolated `CLAUDE_CONFIG_DIR`.

```
ok    claude 2.1.285 (Claude Code) at /opt/claude-code/bin/claude
ok    validate --strict plugin
ok    validate --strict plugin/.claude-plugin/plugin.json
ok    validate --strict . (marketplace)
ok    negative control plugin-legacy is refused (skills: Invalid input)
ok    fresh clone with no npm ci and no build: /tmp/pensmith-plugin-smoke-ts4WB4/clone
ok    plugin marketplace add <clone>
ok    plugin install pensmith@pensmith
ok    plugin list --json: pensmith@pensmith enabled, no errors (/tmp/pensmith-plugin-smoke-ts4WB4/claude-config/plugins/cache/pensmith/pensmith/0.1.0-dev)
ok    plugin details: 8 skills (compile, done, outline, pensmith, plan-section, research, verify-section, write-section), 4 hooks, 1 MCP server
ok    mcp list: plugin:pensmith:pensmith — √ Connected
ok    installed cache server: initialize pensmith 0.1.0-dev; tools/list 11 tools incl. pensmith_plan, pensmith_status, pensmith_verify, pensmith_write
ok    no node on PATH: plugin:pensmith:pensmith — × Failed to connect — ENOENT: Executable not found in $PATH: "stdio"
plugin smoke: all checks passed
```

## 3. Live headless sessions (`LANG=C.UTF-8 node scripts/plugin-session-check.mjs --keep`, at df1e767)

Exit 0, model usage $0.3139. `LANG=C.UTF-8` makes the CLI and the MCP server print the UTF-8 status glyphs (`⌽ §1 introduction:`, `next: plan §1`), which the round-1 parser reads (the ASCII form is unit-tested too). Every session ran in a fresh clone in a temp folder with an isolated config, an allow-listed environment, `--max-turns` ≤ 3 and no permission bypass.

```
evidence PASS [PLUG-03] init frame skills: pensmith:compile, pensmith:done, pensmith:outline, pensmith:pensmith, pensmith:plan-section, pensmith:research, pensmith:verify-section, pensmith:write-section
evidence PASS [PLUG-03] init frame MCP server plugin:pensmith:pensmith: connected (source plugin)
evidence PASS [PLUG-03] init frame tools of the server: paper_advance_section, paper_capability_probe, paper_doi_verify, paper_ingest_zotero_items, paper_init_section, paper_record_verification, paper_set_status, pensmith_plan, pensmith_status, pensmith_verify, pensmith_write
evidence PASS [PLUG-03] debug log: Loaded 8 skills from plugin pensmith
evidence PASS [PLUG-03] /pensmith status → tool calls: mcp__plugin_pensmith_pensmith__pensmith_status
evidence PASS [PLUG-03] pensmith_status text equals `pensmith status` stdout (10 lines; next: plan §1; sections: #1 introduction, #2 mechanisms, #3 conclusion)
evidence PASS [PLUG-03] reply names the next step "plan §1": Here is where the paper stands: **Paper:** attention mechanisms in transformers (class Unfiled) **Current step:** §1 (plan) | Section | State | …
evidence PASS [PLUG-03] reply lists the status section lines (introduction, mechanisms, conclusion)
evidence PASS [PLUG-04] fresh clone, no build, PWD = the root: claude mcp list → pensmith: node ${PWD}/plugin/dist/mcp/server.mjs - √ Connected
evidence PASS [PLUG-04] PWD unset (${PWD:-.} falls back to .): claude mcp list → pensmith: node ${PWD}/plugin/dist/mcp/server.mjs - √ Connected
note     PLUG-04 documented limitation (CONTRIBUTING): Claude Code started in the root with PWD=/tmp (a launcher that passes on another PWD): claude mcp list → pensmith: node ${PWD}/plugin/dist/mcp/server.mjs - × Failed to connect — CONNECTION_CLOSED: Connection closed
evidence PASS [PLUG-04] --plugin-dir ./plugin at the repo root: pensmith servers [{"name":"pensmith","status":"connected","source":"project"}]
note     PLUG-04 dedupe: Claude Code kept the project .mcp.json server ("pensmith"); its tools are mcp__pensmith__*
evidence PASS [PLUG-04] developer setup, /pensmith status with no --allowedTools → mcp__pensmith__pensmith_status; no permission denial (the skill's allowed-tools)
evidence PASS [PLUG-14] developer setup: the PostToolUse hook checkpointed mcp__pensmith__pensmith_status: {"ts":"2026-09-30T09:54:05.448Z","session_id":"dc06edcf-…","tool_name":"mcp__pensmith__pensmith_status","next":"plan 1"}
evidence PASS [PLUG-05] /pensmith:verify-section 1 → Skill({"skill":"pensmith:pensmith","args":"verify 1"}) → mcp__plugin_pensmith_pensmith__pensmith_verify
evidence PASS [PLUG-14] pre-compact.mjs wrote HANDOFF v2: phase sectioning, section 1, position plan (router: plan §1)
evidence PASS [PLUG-14] SessionStart hook: exit 0, success; debug log: Hook SessionStart (node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.mjs) provided additionalContext (402 chars)
evidence PASS [PLUG-14] the model quotes the resume context: Next step (the pensmith router): Plan section §1 (introduction): run /pensmith (or `pensmith plan 1`).
evidence PASS [PLUG-14] headless `claude -p --resume <id> "/compact"`: PreCompact:manual [node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/pre-compact.mjs] completed with status 0; HANDOFF.json written
note     session-id probe: init session_id=7ef41b16-…; MCP server env CLAUDE_CODE_SESSION_ID=7ef41b16-… (session-ish names: CLAUDE_CODE_SESSION_ID); Stop stdin session_id=7ef41b16-…; probed server connected
evidence PASS [session-id] the MCP server sees CLAUDE_CODE_SESSION_ID equal to the Stop hook's stdin session_id (the lock owner match, D-17-37)
session check: all evidence passed
```

Environment limits of this evidence: `/compact` was driven headless (`claude -p --resume <id> "/compact"`), not in an interactive session; everything ran on Linux only; the credentials-file path of the login was not exercised live (the gateway needs none) — its cleanup was checked with a fake credentials file and a run that fails on purpose (`CLAUDE_BIN=/bin/false … --only plug04`: the kept temp folder held `settings.json` and no `.credentials.json`).

## 4. Review round 1 (fixer, 2026-09-30)

| Finding | Severity | Outcome |
|---|---|---|
| SessionStart injects unfenced text from `.paper/` files into the model's context | major | Fixed. The context holds only validated or router-derived values: `nextActionOf(decision, { quoteDetail: false })` (never the router's attention detail, which can quote a PLAN.md `failure_reason`, VERIFICATION.md rows or an OUTLINE.md problem; the router's own OUTLINE_ONLY_DONE constant is still quoted) and HANDOFF's `last_updated`, `phase`, `section` and `position` only (`describeHandoffPosition(h, { slugFallback: false })`). Spawned-bundle test with a malicious HANDOFF.json and PLAN.md `failure_reason` (`tests/hooks/session-start.test.ts`). |
| plugin-assets bans the bare words, colliding with Phase 20's `REFERENCE_LIST_NAMES` | major | Fixed. The bare-word alternative is replaced by a `call` matcher on `path.join` / `path.resolve` / `new URL` / fs readers whose argument (any position — the rule gained `arg.index: "any"`) is exactly an asset folder name; Phase 20's file lints clean; clean and violating cases pinned in `tests/chokepoints.test.ts`. |
| plugin-assets misses concatenation and template literals | minor | Fixed: a separator-led `plugin/<asset>/` alternative and a leading-separator `/<asset>/` chunk; both forms in the fixture. |
| stdout-sink / mcp-stdout-graph miss `import { stdout } from 'node:process'`, a destructured `process.stdout`, `globalThis.console.log` | minor | Fixed: an `import` matcher (named `stdout` from `process`), a destructure file-regex, `globalThis.` on the member matchers, the graph's content regex extended; each form tested on its own, clean forms too. |
| PreCompact writes nothing for a slug > 120 chars | minor | Fixed: assembly is total (a long current slug is null, a pointer the schema refuses is dropped); unit and spawned-bundle tests. |
| Hooks move a legacy-layout paper and write SESSION.log | minor | Fixed: hooks address only `paths.ts` `hasCurrentLayoutPaper` (a `.paper/` directory, no pre-v1 root STATE.json awaiting the move); every bundle leaves a legacy folder byte-identical (`tests/hooks-noop.test.ts`). |
| PreCompact overwrites a newer HANDOFF.json | minor | Fixed: `writeHandoff` re-reads under its lock and leaves a newer file byte-identical; unit and spawned-bundle tests. |
| HANDOFF v2 breadcrumbs are never written | minor | Fixed by removal: nothing wrote `.paper/BREADCRUMBS.jsonl` and nothing read breadcrumbs, so v2 drops the field (the v1 schema keeps it for parsing; the migration drops it). D-23a-16 amended in 23a-CONTEXT. |
| plugin-session-check reads only ASCII glyphs | minor | Fixed: `statusSummary` / `sectionStepOf` moved to `scripts/plugin-smoke-lib.mjs`, read both glyph sets, unit-tested; the live run above used a UTF-8 locale. |
| plugin-session-check leaves the copied login in temp | minor | Fixed: removed in `finally`, in `main().catch`, on exit and on SIGINT/SIGTERM/SIGHUP. |
| `.mcp.json` `${PWD:-.}` breaks with a stale PWD | minor | Kept D-23a-07 (no variable names the project folder: `${CLAUDE_PROJECT_DIR}` is not expanded in `.mcp.json` — observed "Missing environment variables: CLAUDE_PROJECT_DIR"; the reviewer's `${CLAUDE_PROJECT_DIR:-.}` success was its `.` fallback). CONTRIBUTING documents the stale-PWD case; the session check records all three PWD cases (§3). |
| Dev setup: allowed-tools and the PostToolUse matcher miss the kept project server; CONTRIBUTING says the reverse (two findings) | minor | Fixed: matcher `^mcp__(?:plugin_pensmith_)?pensmith__.*` (anchored — Claude Code tests regex matchers unanchored), `allowed-tools` names both `pensmith_status` spellings, CONTRIBUTING corrected; proven live (§3: no permission denial, checkpoint written). |
| The pensmith skill hard-codes the section chain | minor | Fixed: "Run exactly the verb in the `next:` line", never plan when next says write or verify, re-check status before continuing after `plan N`; the `next:` line, not "the last line"; asserted in `tests/skill-descriptions.test.ts`. |
| Docs name the wrong rebundle trigger | minor | Fixed in CLAUDE.md, CONTRIBUTING, `scripts/bundle.mjs`, `ci.yml` and 23a-PLAN §8: anything under `bin/` (lib or cli), `mcp/`, `hooks/`, the package.json version or `package-lock.json`. |
| Phase 20 merge notes miss real conflicts | minor | Fixed: 23a-PLAN §8 now has the trial-merge table per stream, how to resolve each file, `p20-gate`'s new stdout writes (8 in `done.ts`, 3 in `verify.ts`), the chokepoint.mjs, package.json and prompt-pin merges, and the resolved plugin-assets collision. |
| PRD §7.14 describes the old hooks | minor | Fixed: amended (Phase 23a, PLUG-14). |
| CI-05 "passes / required check" unverified | minor | Recorded as open maintainer items (§5 and 23a-PLAN §7.5); not claimed. |
| Live plugin evidence not recorded | minor | Fixed: this file (§1–§3). |

## 5. Open maintainer items (CI-05)

`v1/p23a` has no upstream, so the `plugin` job and the `bundle:check` step in `check` have never run on a GitHub runner. The macOS- and Windows-only paths — resolving `claude.cmd` to `claude.exe`, the `Path`/PATHEXT handling, the no-node PATH filter, byte-identical esbuild output on Windows, the < 500 ms outside-a-paper hook budget — have run only in unit tests with fake file systems here. After the push the maintainer:

1. confirms green `plugin (ubuntu-latest)`, `plugin (macos-latest)` and `plugin (windows-latest)` runs and a green `check` matrix run that includes `bundle:check`;
2. makes them required checks on `main` (today `protected=false`, no required checks):

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

CI-05 is **not** complete until then (review round 2): its acceptance is "the job is a required check and passes", and neither has happened on a runner. The closer leaves it unticked (23a-PLAN §7.6) and records these items as pending the maintainer.

## 6. Review round 2 (fixer, 2026-09-30)

| Finding | Severity | Outcome |
|---|---|---|
| plugin.json pins `0.1.0-dev`, so git-marketplace installs never update | major | Fixed. Confirmed against the docs (the manifest `version` wins; `plugin update` compares for equality) and live: a pushed commit stayed uninstalled. Dropping `version` is not possible — `claude plugin validate --strict` fails on "No version specified" (Phase 23 criterion 1). So `version` is `<package.json version>+<12-hex sha256 of plugin/'s files>` (`scripts/plugin-version.cjs`; plugin.json hashed without its version; LF-normalised text; OS litter skipped). `npm run bundle` / `npm run plugin:version` stamp it; `validate:manifests` fails on a stale stamp or an entry `version`; `bundle:check` compares the stamp too. `plugin:smoke` step 7 serves the clone over a loopback `git http-backend` (`scripts/git-http-host.mjs`, a child process — the smoke's synchronous `claude` calls would starve an in-process server), installs from the URL, pushes a re-stamped `plugin/` change and asserts `claude plugin update` installs it. D-23a-05 amended. |
| SessionStart repeats a stale HANDOFF position | minor | Fixed: the hook entry passes stdin `source`; the HANDOFF summary is added only for `compact` (the SessionStart after the PreCompact write). Spawned-bundle test: startup / resume / clear / no source give the router line only. |
| stdout rows miss console.count/group/timeLog/dirxml and `process` under another name | minor | Fixed: every console member but warn/error/trace/assert; `process`/`console` as a value (`= process`, `f(console)`, `{ io: process }`, `return process`, `const { log } = console`, a rest destructure of process) in both the lint row and the graph content regex (`node:process` specifiers and `const { stderr } = process` stay clean). `bin/lib/node-warnings.ts` takes its receiver from the listener's `this`. Fixtures and per-form tests extended. |
| plan/write/verify tools create a placeholder paper in a folder with no paper | major | Fixed: `mcp/tools.ts` `mutate(…, { needsPaper: true })` calls `paths.ts` `assertPaperHere` before the lock or the verb, returning the CLI's EXIT_USAGE line; the CLI now refuses a paper-less `PENSMITH_PAPER_ROOT` the same way (it also built a placeholder). Tier-contract case (both tiers, cwd and env, same code and line, empty folders), spawned-bundle test (`tests/mcp-tool-refusals.test.ts`), resolver unit cases; live: `pensmith_verify {n:1}` through `--plugin-dir` in an empty folder returned `exit_code 2`, `no paper in … — run pensmith new …`, and created nothing. |
| PLUG-04: PWD unset registers the server twice; CONTRIBUTING says once | major | Fixed (docs and evidence). Confirmed live: PWD unset + `--plugin-dir ./plugin` → `plugin:pensmith:pensmith` and `pensmith`, both connected. No `.mcp.json` form matches on every shell. CONTRIBUTING now scopes the dedupe to PWD = root, documents the two-server case and the tested workaround (`"disabledMcpjsonServers": ["pensmith"]` in `.claude/settings.local.json`); the session check records the note and proves the workaround. D-23a-07 amended; PLUG-04 criterion 2 is not claimed for PowerShell/cmd. |
| CI-05 not met; the plugin job never ran | minor | Accepted as stated: CI-05 left unticked, PLUG-14's 3-OS leg recorded as pending (frontmatter, §5, 23a-PLAN §7.6). |
| Plan/write tools tell a Tier-1 user to "Run inside Claude Code (Tier 1) for key-free operation" | minor | Fixed in both tiers (the promise was false for the CLI too — README: key-free generation is not in this release): the missing-key error ends "`pensmith doctor` checks the setup (README: Model runtimes)." Spawned-bundle test: no tool response contains "key-free". |
| The skill sends length and source corrections to `plan N --revise` | major | Fixed. Confirmed: `plan 2 --revise` on a clean section prints "No FABRICATED/MIS-CITED/NOT_FOUND citation" and changes nothing. The skill now routes length through the OUTLINE.md word target → `outline` → `plan N` → `write N`; a source through `add <id> --section N` / `add --remap <citekey> --section N` / `plan N --research`, then `plan N`, `write N`, saying there is no single-claim swap; redo through `--revise` only for a flagged section; a new section with a lettered id. It may edit only the OUTLINE.md table the user asked to change. `tests/correction-routes.test.ts` runs every route through the built CLI (the redraft follows the new target; other sections untouched; the renumbering row refused); `tests/nl-triggers.test.ts` asserts the truthful routes. |
| Phase 20 merge notes out of date (skills/verify-section.md modify/delete) | minor | Fixed: 23a-PLAN §8 records the trial merge of the integrated Phase 20 branch (`f2cc81d`): its conflicts, the step-by-step for `skills/verify-section.md` (git rm; port `--accept-quote qK` as a CLI-form row with AskUserQuestion; extend the argument-hint and PLUMBING.md, which `tests/plumbing-args.test.ts` then enforces), the stdout writes that merge in cleanly, the re-stamp, and the round-2 behaviour Phase 20 code meets. |
| Tier 1 says `cost: n/a (Claude session)` while plan/write bill the provider | minor | Fixed: `paper://state` shows the same COSTS.jsonl meter as the CLI; the tier contract compares the lines; status.md's fallback note, resume.md's replay note, the PRD cost-meter line and RUN-19 are amended. |
| Plumbing docs omit `done --format` and compile's flags | minor | Fixed: the argument-hints and docs/PLUMBING.md list every option each verb takes (`--format docx\|pdf\|latex\|md`, `--discipline`, `--lintHeadings`, `--slug`); `tests/plumbing-args.test.ts` derives them from each verb's citty `args` (both directions). |

**Gate (v1/p23a at 0f2c2c3).** `npm run prebuild`, `lint`, `typecheck`, `build`: exit 0. `validate:manifests`: valid. `bundle:check`: "plugin/dist and the plugin version match what is committed". `test:tier-contract`: 60/60. `npm test < /dev/null`: 2549 tests, 2548 pass, 1 fail — `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure" (root only; CLAUDE.md); no skips, no todos. `node scripts/e2e-smoke.mjs`: PASS=16, FINDING=0, FAIL=0. `git status --porcelain`: clean.

**Plugin smoke** (`CLAUDE_BIN=/opt/node22/bin/claude npm run plugin:smoke`, Linux, Claude Code 2.1.285): all checks passed, including
```
ok    git marketplace (http://127.0.0.1:45309/pensmith.git): installed 0.1.0-dev+b0fc2d409174 as a cached copy (…/git-marketplace/claude-config/plugins/cache/pensmith/pensmith/0.1.0-dev-b0fc2d409174)
ok    git marketplace update: 0.1.0-dev+b0fc2d409174 → 0.1.0-dev+d5155c7496c7; the installed copy holds the new commit
```

**Live sessions** (`LANG=C.UTF-8 node scripts/plugin-session-check.mjs`, all checks): all evidence passed, model usage $0.49. New lines:
```
note     PLUG-04 documented limitation (CONTRIBUTING): PWD unset, --plugin-dir ./plugin at the root → 2 pensmith servers [{"name":"plugin:pensmith:pensmith","status":"connected","source":"plugin"},{"name":"pensmith","status":"connected","source":"project"}]
evidence PASS [PLUG-04] PWD unset, --plugin-dir ./plugin with --settings '{"disabledMcpjsonServers":["pensmith"]}' (the CONTRIBUTING workaround): pensmith servers [{"name":"plugin:pensmith:pensmith","status":"connected","source":"plugin"}]
evidence PASS [PLUG-14] SessionStart hook: exit 0, success; debug log: Hook SessionStart (node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.mjs) provided additionalContext (294 chars)
```
(294 characters: a startup SessionStart no longer carries the HANDOFF line.)

## 7. Review round 3 (fixer, 2026-09-30)

| Finding | Severity | Outcome |
|---|---|---|
| plugin:smoke step 7 cannot push from a pull request's detached checkout | major | Fixed. Confirmed: the round-2 script, run against a PR-shaped checkout (`git init`; `git fetch --depth=1 <repo> +HEAD:refs/remotes/pull/1/merge`; `git checkout --force refs/remotes/pull/1/merge` — detached and shallow, as `actions/checkout` makes it), fails at step 7 with `git push --quiet origin HEAD` → "The destination you provided is not a full refname". `scripts/plugin-smoke-lib.mjs` `bareRepoOnBranch` now serves the clone's commit on `pensmith-plugin-smoke`, a branch the bare repository's HEAD points at; the work clone checks it out and pushes `HEAD:refs/heads/pensmith-plugin-smoke`. The full smoke passes against that PR-shaped checkout (below); `tests/plugin-smoke-helpers.test.ts` replays the shape in every `check` leg (the old push fails, the new branch moves, a fresh clone follows it). D-23a-17 amended. |
| PostToolUse keeps the first call of each minute; the mutating call is dropped | minor | Fixed: trailing-edge throttle — within the minute, a call whose router step differs from the last line's `next` replaces that line; an unchanged step writes nothing; lines stay ≥ 60 s apart (five unchanged calls still write one line). Unit test with an injected clock and a spawned-bundle test (`pensmith_status`, then a change, then the write's hook: one line naming the new step). D-23a-15 amended. |
| The plugin version digest hashes untracked and ignored files (two findings) | minor | Fixed: in a git checkout the digest covers `git ls-files --cached` under `plugin/` (staged additions count; deleted files do not), read from the working tree; outside a work tree it walks the folder as before. Reproduced and tested: a checkout with an ignored `plugin/.claude/settings.local.json`, a `.swp` and a `.paper-dry-run/` keeps its stamp and validates; an edit or a staged new file changes it. CONTRIBUTING and CLAUDE.md say so. D-23a-05 amended. |
| SessionStart matcher leaves out `clear` | minor | Fixed, and `fork` added: since Claude Code 2.1.214 a forked session reports `fork` (docs: hooks, SessionStart matchers), which the old matcher missed too. `startup\|resume\|clear\|compact\|fork` in hooks.json, the validator's table, `tests/manifest.test.ts` and D-23a-06; the spawned test runs all five sources; the HANDOFF summary stays `compact`-only. |
| CONTRIBUTING says plugin.json's version equals package.json's (two findings) | minor | Fixed: the preflight paragraph names `<package.json version>+<content digest of plugin/>` and `npm run plugin:version`. |
| CI-05 not met: the plugin job never ran on a runner; not a required check | major | Not fixable here (no push): stays an open maintainer item (§5), CI-05 unticked and PLUG-14's 3-OS leg pending (23a-PLAN §7.6). The one certain CI failure this finding exposed on pull requests (the detached HEAD above) is fixed and replayed in tests. |
| PLUG-04 over-claimed "with its caveat" | major | Accepted: PLUG-04 is **not** ticked. Claude Code 2.1.285 suppresses a plugin MCP server only on an exact match of `stdio:` + the JSON of the expanded `[command, ...args]` (its signature function; `Suppressing plugin MCP server "…": duplicates manually-configured "…"`), and the plugin's line holds the absolute plugin root, so no committed `.mcp.json` meets both criteria on every shell. 23a-PLAN §7.6 now leaves PLUG-04 Pending and proposes an amended acceptance text for the maintainer (or the plain relative form, trading dedupe for stale-PWD robustness); the shipped form and CONTRIBUTING's caveats are unchanged. D-23a-07 amended. |
| Phase 20 merge notes stale (two findings) | minor | Fixed: the trial merge was re-run against Phase 20 at `893e0c1` (the branch moved again after the reviewers' `22afc6c` / `54833d1`). 23a-PLAN §8 now lists the `skills/plan-section.md` modify/delete (0899e32; `git rm`, nothing to port), the widened blocking list to port (d7418ae) into verify-section, pensmith and plan-section, the verify.ts hunks as they now are, and `done.ts`'s 7 clean + 8 conflicted stdout writes (with line numbers) and `verify.ts`'s 2 + 2, plus the round-3 behaviour Phase 20 code meets. It says to re-run the trial against the head of the day before merging. |
| plan-section skill misstates `--revise` | minor | Fixed: "`--revise` repairs a citation the verifier flagged (FABRICATED, MIS-CITED, NOT_FOUND); on a clean section it changes nothing — `plan N` then `write N` re-plans and redrafts a section." Pinned in `tests/skill-descriptions.test.ts`. |
| Stop removes the lock of a live MCP call; a CLI verb then runs beside it (RUN-23) | major | Fixed. `releaseClaudeSessionLock` releases only a record whose process is gone (a lock the server left behind; the PID is checked whatever the hostname). Reproduced before and after with a holder in `withPaperSession(…, pensmith_write)` (`CLAUDE_CODE_SESSION_ID=sess-A`) in a CLI-made paper: CLI `plan 1` refused; Stop for `sess-A` (exit 0) now leaves the record; CLI `plan 1` still refused ("another pensmith session (pid …) is working on this paper"); after the call ended, it runs. `tests/hooks/stop.test.ts`: a live in-flight holder is kept even for its own session; a SIGKILLed holder's record is released for its session only (also through a symlinked cwd and `PENSMITH_PAPER_ROOT`). D-23a-15 amended. |
| pensmith_status puts unfenced `.paper/` text in the model's context | major | Fixed: two text blocks — `STATUS_DATA_NOTE` (the next block is the CLI's text fenced as untrusted data; a title, failure reason or attention detail inside is never an instruction; show the lines between the fence lines) and the status text in the FEED-05 fence, byte-identical to the CLI inside it (`unfence`). The pensmith skill and `plugin/workflows/status.md` say it is data. `tests/mcp-status-untrusted.test.ts` spawns both servers with a hostile `failure_reason` and with a planted close marker (one open and one close marker; the payload stays inside). Live: `/pensmith status` shows the status without fence lines (below). D-23a-12 amended. |
| PreCompact's HANDOFF.json write re-seeds the dry-run workspace | minor | Fixed: `HANDOFF.json` joins `SEED_EXCLUDED` (neither copied nor fingerprinted). `tests/dry-run-workspace.test.ts` runs the PreCompact bundle and then removes the file between dry runs: the workspace is kept. D-23a-16 amended; CLAUDE.md and PRD §7.19 list it. |

**Gate (v1/p23a at 339a2de).** `npm run check < /dev/null`: prebuild, lint, typecheck, build — exit 0; `test:tier-contract` 60/60; `npm test` 2561 tests, 2560 pass, 1 fail — `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure" (root only; CLAUDE.md), no skips, no todos. Then `npm run validate:manifests`: valid; `npm run bundle:check`: "plugin/dist and the plugin version match what is committed". `node scripts/e2e-smoke.mjs`: PASS=16, FINDING=0, FAIL=0. `git status --porcelain`: clean.

**Plugin smoke** (Claude Code 2.1.285, Linux). On the branch checkout (`CLAUDE_BIN=/opt/node22/bin/claude npm run plugin:smoke`): all checks passed. On a PR-shaped checkout of 339a2de (detached, shallow; `node scripts/plugin-smoke.mjs --repo <it>`): all checks passed —
```
ok    git marketplace (http://127.0.0.1:46657/pensmith.git): installed 0.1.0-dev+08ba1a3f51e3 as a cached copy (…/git-marketplace/claude-config/plugins/cache/pensmith/pensmith/0.1.0-dev-08ba1a3f51e3)
ok    git marketplace update: 0.1.0-dev+08ba1a3f51e3 → 0.1.0-dev+8a7738469d88; the installed copy holds the new commit
plugin smoke: all checks passed
```
The round-2 script on the same checkout: `FAIL  Error: Command failed: git … push --quiet origin HEAD` / `error: The destination you provided is not a full refname`.

**Live sessions** (`LANG=C.UTF-8 node scripts/plugin-session-check.mjs --only plug03,plug04,plug14`, then `--only plug03` after the transcript reader joined content blocks with a line break — it had glued the note to the fence line): all evidence passed, model usage $0.50 + $0.04. New or changed lines:
```
evidence PASS [PLUG-03] pensmith_status text (inside its untrusted-data fence) equals `pensmith status` stdout (10 lines; next: plan §1; sections: #1 introduction, #2 mechanisms, #3 conclusion)
evidence PASS [PLUG-03] reply names the next step "plan §1": pensmith status: paper: attention mechanisms in transformers (paper-status) — class Unfiled … ⌽ §1 introduction: outlined (not planned) …
evidence PASS [PLUG-14] SessionStart hook: exit 0, success; debug log: Hook SessionStart (node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.mjs) provided additionalContext (383 chars)
evidence PASS [PLUG-14] headless `claude -p --resume <id> "/compact"`: PreCompact:manual [node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/pre-compact.mjs] completed with status 0; HANDOFF.json written
```
The model showed the status lines without the fence lines, as the note asks. The PLUG-04 lines are as in §6 (PWD = root and unset connected; another PWD `CONNECTION_CLOSED`; one server with PWD = root; two with PWD unset; the workaround leaves one).

## 8. Closer verification (2026-09-30, v1/p23a at 03d1654)

The closer re-ran everything below on the branch head, the same code the round-3 evidence ran on (`03d1654` changed only the session-check script and this file since `339a2de`). Environment: Linux, Node 22.22.2, as root, Claude Code 2.1.285.

### 8.0 Gate

| Step | Result |
|---|---|
| `npm run prebuild`, `npm run lint`, `npm run typecheck`, `npm run build` | exit 0 (11 s, 13 s, 18 s) |
| `npm run test:tier-contract` | exit 0: 60/60 pass |
| `npm run test:coverage < /dev/null` (the CI step) | 2561 tests: 2560 pass, 1 fail, 0 skipped, 0 todo, 0 cancelled. The failure is `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure", the known root-only case (CLAUDE.md; it passes in CI). Coverage: 93.14 % statements, 84.44 % branches, 89.53 % functions, 93.14 % lines (gates 80/66/66/80). The runner's CI-09 fingerprint check also reported a change to the real data dir. §8.0.1 traces it to another process. |
| `npm run validate:manifests` | exit 0: `plugin/ (plugin.json, hooks.json, 8 skills, 16 workflow bodies) + marketplace.json + .mcp.json valid` |
| `npm run bundle:check` | exit 0: `plugin version 0.1.0-dev+08ba1a3f51e3`; `plugin/dist and the plugin version match what is committed` |
| `node scripts/e2e-smoke.mjs` | exit 0: PASS=16, FINDING=0, FAIL=0 |
| `git status --porcelain` after the gate | clean, apart from the closer's own untracked `23a-SUMMARY.md` |

#### 8.0.1 The CI-09 fingerprint change came from another process

`scripts/run-tests.mjs` fingerprints the real data dir (`/root/.local/share/pensmith`) before and after a local run with a built `dist/`. After the coverage run it reported these changes:
- `session.log` changed;
- two empty lock files appeared, `locks/75c929ad2381` (14:31:47.713) and `locks/4e6663e926b5` (14:32:07.769).

The new `session.log` lines are two runs (`ebedb398…` at 14:31:47, 27 records; `40de00db…` at 14:32:07, 10 records). Both are offline-fixture lookups of `10.1038/nature14539`.

They match two scripts that the Phase 20 acceptance reviewer ran from its own scratch folder at those times: `scratchpad/p20/review-acceptance/repo/nm.mts` (modified 14:31:45) and `nm2.mts` (14:32:05). Those scripts created `nm-hPyp7w/.paper/CITATIONS.bib` at 14:31:47.685 and `nm-cKnMXv/.paper/CITATIONS.bib` at 14:32:07.741, each about 30 ms before the matching lock file. A Phase 20 reviewer was still running `…/p20/review-acceptance/repo/dist/bin/pensmith.js verify 2` at 14:41.

The round-2 and round-3 gates of the same suite recorded no CI-09 failure.

To confirm, the closer re-ran the suite twice with a private `HOME` that nothing else on the machine writes to (npm cache left at `/root/.npm`).

**First re-run: `HOME=<scratch>/fakehome`.**
- Result: 2561 tests, 2559 pass, 2 fail.
- One failure is the root-only atomic-write case.
- The other is `tests/http-rate-limit.test.ts` "SRC-17 (review round 3): Crossref declaring 3 / 1s …" ("the bucket never lets a fourth request into a second", 1 !== 0). This is a Phase 19 timing test that 23a does not touch; its `http.ts` changes are only the asset path and the version constant. It failed at a load average of about 8, with the Phase 20 reviewers running alongside, and passed 3/3 when re-run on its own right after (16/16 each time).
- A `HOME` inside `os.tmpdir()` disarms the runner's own fingerprint (`insideTmp`), so this run is evidence only in that `<scratch>/fakehome` stayed empty: no `.local/share/pensmith` appeared.

**Second re-run, the armed CI-09 check: `TMPDIR=<scratch>/tmpdir HOME=<scratch>/home2 npm test < /dev/null`.** The fingerprinted dir `<scratch>/home2/.local/share/pensmith` then lies outside `os.tmpdir()`, so the guard applies. It read `absent` before and after.
- Result: 2561 tests, 2560 pass, 1 fail (the root-only atomic-write case), 0 skipped, 0 todo.
- **No `FAIL (CI-09)`.**

The suite leaves the real data dir untouched.

### 8.1 PLUG-01: Manifest, skills layout and hooks.json follow the current spec. **Met.**

| Acceptance criterion | Evidence |
|---|---|
| `claude plugin validate` on `plugin/`, `plugin/.claude-plugin/plugin.json` and the marketplace exits 0 with no errors or warnings | §8.9: `validate --strict` ×3 ok (Claude Code 2.1.285; `--strict` turns any warning into a failure) |
| A regression test feeds the validator the old plugin.json and hooks.json and expects failure | `tests/validate-plugin-manifest.test.ts` "the pre-v1 fixture fails with every old shape named" (and `claude plugin validate --strict tests/fixtures/plugin-legacy` is refused, "skills: Invalid input", §8.9) |
| Every workflow body keeps `<capability_check>` and the validator enforces it | `validate:manifests` checks 16 bodies (§8.0); "a workflow body without its <capability_check> block fails" |
| The skills array is removed, skills are at `plugin/skills/<name>/SKILL.md`, hooks.json is in the spec's form with PreCompact timeout 10, and targets are the committed `.mjs` bundles | `plugin/.claude-plugin/plugin.json` has no `skills` / `hooks` key; 8 skill directories; hooks.json uses the exec form for all 4 events with `timeout: 10`, pointing at `${CLAUDE_PLUGIN_ROOT}/dist/hooks/*.mjs`; `tests/manifest.test.ts`, `tests/skill-descriptions.test.ts`, `tests/hooks-noop.test.ts` and the tier-contract plumbing case were rewritten to the spec (23a-SUMMARY §5). 20 PLUG-01 tests pass. |

### 8.2 PLUG-02: One canonical `plugin/` with committed bundles. **Met.**

| Acceptance criterion | Evidence |
|---|---|
| CI runs `npm run bundle` then `git diff --exit-code`; a test fails on any asset outside `plugin/` | `ci.yml` `check` job step "Plugin bundles and version match their sources (bundle:check)"; `bundle:check` exit 0 here (§8.0); `tests/plugin-layout.test.ts` "git holds no workflow, prompt, preset, reference, skill or agent file outside plugin/" plus the non-vacuity case |
| `plugin/` has no `bin/` and no CLAUDE.md; `claude plugin validate plugin` warns about nothing | `tests/plugin-layout.test.ts` "plugin/ holds only plugin components"; `validate --strict plugin` ok (§8.9) |
| Tier 2 from source, `dist/` and `npm pack` reads prompts and workflows from `plugin/` with the pins verifying; the worker test covers the bundle layout; a symlinked `CLAUDE_PLUGIN_ROOT` server answers `initialize`; a size budget is asserted | Source: a bare `tsx bin/pensmith.ts --dry-run --yolo` in a scratch folder reached the export (§8.10). `dist/`: `node dist/bin/pensmith.js doctor` → `intake-outline-verify-wiring` PASS (§8.10). `npm pack`: `tests/installed-bin.test.ts` "the installed package ships plugin/ and none of the pre-move asset folders". Worker: "SEC-02 / PLUG-02: the bundled worker … extracts a fixture PDF". Symlink: `tests/plugin-bundle.test.ts` "answers initialize and tools/list … through a symlinked CLAUDE_PLUGIN_ROOT" (junction on Windows). Budget: "within the 20 MB budget" (12 MB today). The prompt pins read `plugin/templates/prompts/…` (`tests/repo-files.test.ts`, `EXPECTED_PROMPT_HASHES`). |
| PRD §13/§14 and CLAUDE.md describe the layout | PRD §13 tree (`plugin/  # THE plugin, and the one home of every shipped asset`); CLAUDE.md architecture, chokepoint rows and hash-pinned paths |
| The PRD §14 "Two-tier source-of-truth" amendment | PRD §14: "Tier 2 … implements each verb in `bin/cli` from the same `plugin/` prompts, presets and references rather than interpreting workflow bodies at runtime; the bodies … kept in step with the code by the tier contract and the workflow-body tests (PLUG-09, PLUG-15)" |
| The move is a pure `git mv` (D-23a-01) | `git show -M --summary eb7b5ec`: 56 renames, all `rename (100%)`, no other change |

This criterion's CI leg (`bundle:check` on macOS and Windows runners) runs with the first `check` matrix after the push (§5).

### 8.3 PLUG-03: Installs from the git marketplace and loads skills, hooks and the MCP server. **Met.**

| Acceptance criterion | Evidence |
|---|---|
| Isolated `CLAUDE_CONFIG_DIR`: marketplace add and install succeed; `plugin list --json` shows it enabled with no errors; `plugin details` shows ≥ 4 skills including pensmith, 4 hooks and 1 MCP server | §8.9 (fresh `git clone --local`, no `npm ci`, no build): add ok, install ok, enabled with no errors, 8 skills, 4 hooks, 1 MCP server. The same from a loopback **git** marketplace URL, with `claude plugin update` picking up a new commit. |
| The init frame lists `pensmith:pensmith`, the other skills and a connected server with its tools; the debug log shows `Loaded N skills` for N skill directories | §8.11: 8 skills, `plugin:pensmith:pensmith: connected (source plugin)`, 11 tools, `Loaded 8 skills from plugin pensmith` |
| `claude -p --plugin-dir <repo>/plugin "/pensmith status"` replies with the status output | §8.11: the call goes to `mcp__plugin_pensmith_pensmith__pensmith_status`; its text inside the fence equals `pensmith status` stdout; the reply names `plan §1` and lists the three sections |

### 8.4 PLUG-04: The repo-root `.mcp.json` works for developers. **Not met (Pending).**

| Acceptance criterion | Evidence | Verdict |
|---|---|---|
| In a fresh clone opened with project servers approved, `claude mcp list` shows pensmith connected, with no missing-variable warning and no build | §8.11: connected with `PWD` = the root and with `PWD` unset; `CONNECTION_CLOSED` when Claude Code starts in the root with `PWD` naming another folder (a stale-PWD launcher), and by construction under Git Bash's MSYS `PWD` | Met for a shell started at the root; fails for a stale or MSYS `PWD` |
| When the checkout is also loaded as a plugin, the server is registered exactly once | §8.11: once with `PWD` = the root (the project server is kept; the skill's `allowed-tools` and the PostToolUse matcher cover it, proven live). **Twice** with `PWD` unset (PowerShell, cmd); the documented workaround `disabledMcpjsonServers: ["pensmith"]` leaves one | Not met where `PWD` is unset |

The fix the requirement asks for has shipped and works in the common case: the bare `${CLAUDE_PLUGIN_ROOT}` is gone, the file points at the committed bundle, and no build is needed. The criteria as written cannot all hold on every shell (D-23a-07, round 3):
- Claude Code dedupes only on an exact match of the expanded command line.
- No `.mcp.json` variable names the project folder everywhere.

So PLUG-04 stays **Pending** until the maintainer decides on the amended acceptance text in 23a-PLAN §7.6, or on the alternative plain relative form, through a recorded decision. Either way, `tests/manifest.test.ts` and the validator keep `${CLAUDE_PLUGIN_ROOT}` out of `.mcp.json` (2 PLUG-04 tests pass).

### 8.5 PLUG-05: The plumbing namespace is registered and documented outside the quick start. **Met.**

| Acceptance criterion | Evidence |
|---|---|
| Each plumbing skill is listed by the loaded plugin (`claude plugin details`) | §8.9: `compile, done, outline, pensmith, plan-section, research, verify-section, write-section` |
| `tests/cli-verbs.test.ts` still asserts 16 verbs; the README quick start contains only `/pensmith` | "dispatcher registers exactly 16 verbs"; "PLUG-05: the README quick start teaches /pensmith only; the plumbing namespace is documented elsewhere" (both pass) |
| Documented in docs/, mapped onto the locked 16 verbs | `docs/PLUMBING.md` (each command, its verb, its arguments checked against the verb's citty args by `tests/plumbing-args.test.ts`); the tier-contract plumbing parity case maps each `/pensmith:<name>` to its verb |
| It reaches the tool in a real session | §8.11: `/pensmith:verify-section 1` → `Skill(pensmith:pensmith, "verify 1")` → `mcp__plugin_pensmith_pensmith__pensmith_verify` |

### 8.6 PLUG-13: The MCP stdio channel stays clean. **Met.**

| Acceptance criterion | Evidence |
|---|---|
| `tests/mcp-stdout-clean.test.ts` spawns the bundled server and calls every tool; the SDK client's `onerror` never fires and every stdout line parses as JSON-RPC | Passes for both servers (`dist/mcp/server.js` and `plugin/dist/mcp/server.mjs`), with every tool called, including parallel plans and the verb tools' stderr lines |
| The lint rule fires on a `bin/lib` fixture that writes to stdout, and the import-graph test fires on a reachable `bin/cli` fixture | `tests/chokepoints.test.ts`: the `stdout-sink` fixture (a `bin/lib` file) and the `mcp-stdout-graph` fixture (a `bin/cli` module reachable from `mcp/`) each violate their row; each stdout form and each harmless form is tested on its own |
| The mutation check (23a-PLAN §6) | §8.12: reverting one `out()` in `bin/cli/plan.ts` to `process.stdout.write` fails lint (`stdout-sink`), fails the import-graph harness (`mcp-stdout-graph`, reached from `mcp/`), and, once rebuilt and rebundled, fails `mcp-stdout-clean` for both servers with the `pensmith plan: wrote PLAN.md …` line on stdout |

### 8.7 PLUG-14: Hooks run under Claude Code and do their jobs. **Met** (caveat: the macOS and Windows legs are pending).

| Acceptance criterion | Evidence |
|---|---|
| Each hooks.json command runs as a subprocess with the documented stdin: `pre-compact.mjs` in a paper with §2 writing writes HANDOFF `{sectioning, 2, write}`; five PostToolUse runs within 60 s produce exactly one checkpoint | `tests/hooks/pre-compact.test.ts` "PreCompact in a paper with §2 writing writes a valid v2 HANDOFF {sectioning, 2, write} within 10 s"; `tests/hooks/post-tool-use.test.ts` "five PostToolUse runs within 60 s write exactly one checkpoint, in the data dir, never under .claude/ or .paper/" |
| Stop leaves a CLI session's lock and releases the lock this session's MCP server left behind | `tests/hooks/stop.test.ts` "leaves a lock held by a running CLI session in place"; "releases the lock this Claude session's MCP server left behind, and only that one"; round 3's "keeps the lock … while its call is in flight" |
| Outside a paper each hook exits 0 in < 500 ms with no output and no files; tests spawn the bundles | `tests/hooks-noop.test.ts` (500 ms budget, spawned bundles, and a legacy layout left byte-identical); by hand here: 106 / 97 / 116 / 84 ms, empty stdout, no files (§8.10) |
| Real session: `d.log` shows SessionStart ran with exit 0 and the model received the resume context; live lane: `/compact` produces HANDOFF.json | §8.11: `Hook SessionStart … provided additionalContext`, exit 0; the model quotes the router step from it; headless `claude -p --resume <id> "/compact"` fires `PreCompact:manual`, which completes with status 0 and writes HANDOFF.json |
| Hook stdout carries only protocol JSON; `resolvePaperRoot`; main-entry guard | Every hook test asserts stdout (empty, or the one SessionStart JSON line); the entries run under `isMainModule` and resolve with `resolvePaperRoot({mode:'hook'})` (`bin/lib/hooks/entry.ts`) |

31 PLUG-14 tests pass on Linux.

**Caveat, recorded in the traceability row.** 23a-PLAN §6 also asks for the spawned-bundle hook tests to pass on all 3 OSes in CI. Their macOS and Windows legs, including the < 500 ms budget there, have not run on a runner yet (§5). They clear with the first green `check` matrix.

### 8.8 CI-05: CI validates and installs the real plugin with Claude Code. **Not met (Pending).**

| Acceptance criterion | Evidence | Verdict |
|---|---|---|
| A required job with pinned Claude Code runs validate ×3, isolated install / list / details, the server launched from the installed cache (`initialize`, `tools/list`), and no node on PATH → not connected, with no API key | The `plugin` job in `ci.yml` (ubuntu, macOS, Windows; Claude Code 2.1.285) runs `npm run plugin:smoke`; locally all of it passes with no key (§8.9) | Built and passing locally |
| **The job is a required check and passes** | It has **never run on a GitHub runner** (`v1/p23a` has no upstream, and this automation never pushes) and is **not a required check** (today `main` has `protected=false`) | **Not met**: maintainer item (§5) |
| A negative-control fixture makes validation fail | §8.9: `negative control plugin-legacy is refused (skills: Invalid input)` | Met |
| A static test asserts `skills/pensmith/SKILL.md` carries the Node ≥ 22 guidance | `tests/skill-descriptions.test.ts` "the pensmith skill tells the user to put Node.js ≥ 22 on PATH and restart when the server is not connected" | Met |

To tick CI-05, the maintainer pushes and confirms green `plugin (ubuntu-latest|macos-latest|windows-latest)` runs and a green `check` matrix run. Then they apply the `gh api` branch-protection command in §5, record the run URLs in 23a-SUMMARY §8, and tick CI-05.

### 8.9 Plugin smoke (`CLAUDE_BIN=/opt/node22/bin/claude npm run plugin:smoke`, 17 s, exit 0)

```
ok    claude 2.1.285 (Claude Code) at /opt/claude-code/bin/claude
ok    validate --strict plugin
ok    validate --strict plugin/.claude-plugin/plugin.json
ok    validate --strict . (marketplace)
ok    negative control plugin-legacy is refused (skills: Invalid input)
ok    fresh clone with no npm ci and no build: /tmp/pensmith-plugin-smoke-V7HSox/clone
ok    plugin marketplace add <clone>
ok    plugin install pensmith@pensmith
ok    plugin list --json: pensmith@pensmith enabled, no errors (/tmp/pensmith-plugin-smoke-V7HSox/claude-config/plugins/cache/pensmith/pensmith/0.1.0-dev-08ba1a3f51e3)
ok    plugin details: 8 skills (compile, done, outline, pensmith, plan-section, research, verify-section, write-section), 4 hooks, 1 MCP server
ok    mcp list: plugin:pensmith:pensmith — √ Connected
ok    installed cache server: initialize pensmith 0.1.0-dev; tools/list 11 tools incl. pensmith_plan, pensmith_status, pensmith_verify, pensmith_write
ok    no node on PATH: plugin:pensmith:pensmith — × Failed to connect — ENOENT: Executable not found in $PATH: "stdio"
ok    git marketplace (http://127.0.0.1:34867/pensmith.git): installed 0.1.0-dev+08ba1a3f51e3 as a cached copy (/tmp/pensmith-plugin-smoke-V7HSox/git-marketplace/claude-config/plugins/cache/pensmith/pensmith/0.1.0-dev-08ba1a3f51e3)
ok    git marketplace update: 0.1.0-dev+08ba1a3f51e3 → 0.1.0-dev+39e0a92067f0; the installed copy holds the new commit
plugin smoke: all checks passed
```

### 8.10 CLI and hook user paths (scratch folders, `XDG_DATA_HOME` inside them, `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`)

- **Tier 2 from `dist/`:** `node dist/bin/pensmith.js doctor` in a folder with `assignment.txt` gave `Doctor: 7 PASS, 4 WARN, 0 FAIL, 1 SKIP`, exit 0. It includes `mcp-sdk-presence: plugin/dist/mcp/server.mjs present (6958553B)` and `intake-outline-verify-wiring: All 6 verbs … wired in dispatcher + workflows + drafter contract`. The four WARNs are environment gaps, not plugin issues: Zotero is not detected, pandoc is not on PATH, the humanizer skill is not installed, and no LLM key is set.
- **Tier 2 from source:** `tsx bin/pensmith.ts --dry-run --yolo` in the same folder exited 0. It ended `pensmith: ran compile; next: done` / `pensmith: ran done; next: status (done)` and wrote `.paper-dry-run/export/{DRAFT.dry-run.md, CITATIONS.dry-run.bib, CITATIONS.dry-run.ris}`. It created no `.paper/`. The prompts, presets and the dry-run corpus came from `plugin/` through the hash-verified loader.
- **Hooks outside a paper:** each bundle was spawned with Claude Code's stdin JSON in an empty folder:

  | Bundle | Exit | Time | Stdout | Files created |
  |---|---|---|---|---|
  | session-start | 0 | 106 ms | empty | none |
  | pre-compact | 0 | 97 ms | empty | none |
  | post-tool-use | 0 | 116 ms | empty | none |
  | stop | 0 | 84 ms | empty | none |

  No files were created in the folder or in the data dir.
- **Hooks in a CLI-made paper** (`PENSMITH_NO_LLM=1 pensmith new --yolo`; `pensmith status` → `next: research`):
  - `pre-compact.mjs` (trigger `manual`) exited 0 and wrote a v2 `HANDOFF.json`: `schema_version 2`, `phase research`, `section null`, `position null`, `next_action "Find and evaluate sources: run /pensmith (or \`pensmith research\`)."`.
  - `session-start.mjs` with `source: "compact"` exited 0. It printed one line, `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"This folder holds a pensmith paper (…/.paper).\nNext step (the pensmith router): Find and evaluate sources: …\nBefore the last context compaction (…) it was at phase research.\nTo continue the paper, run /pensmith …"}}`.

### 8.11 Live headless sessions (`LANG=C.UTF-8 CLAUDE_BIN=/opt/node22/bin/claude node scripts/plugin-session-check.mjs`, all checks, exit 0, model usage $0.50)

```
note     claude 2.1.285 (Claude Code) at /opt/claude-code/bin/claude; auth: ANTHROPIC_BASE_URL (a host-managed gateway)
note     fresh clone (no npm ci, no build): /tmp/pensmith-session-check-QcTdP5/clone
evidence PASS [PLUG-03] init frame skills: pensmith:compile, pensmith:done, pensmith:outline, pensmith:pensmith, pensmith:plan-section, pensmith:research, pensmith:verify-section, pensmith:write-section
evidence PASS [PLUG-03] init frame MCP server plugin:pensmith:pensmith: connected (source plugin)
evidence PASS [PLUG-03] init frame tools of the server: paper_advance_section, paper_capability_probe, paper_doi_verify, paper_ingest_zotero_items, paper_init_section, paper_record_verification, paper_set_status, pensmith_plan, pensmith_status, pensmith_verify, pensmith_write
evidence PASS [PLUG-03] debug log: Loaded 8 skills from plugin pensmith
evidence PASS [PLUG-03] /pensmith status → tool calls: mcp__plugin_pensmith_pensmith__pensmith_status
evidence PASS [PLUG-03] pensmith_status text (inside its untrusted-data fence) equals `pensmith status` stdout (10 lines; next: plan §1; sections: #1 introduction, #2 mechanisms, #3 conclusion)
evidence PASS [PLUG-03] reply names the next step "plan §1": pensmith status: paper: attention mechanisms in transformers (paper-status), class Unfiled … current: §1 (plan) sections: - §1 introduction: outlined (not planned) - §2 mechanisms: outlined (not planne…
evidence PASS [PLUG-03] reply lists the status section lines (introduction, mechanisms, conclusion)
evidence PASS [PLUG-04] fresh clone, no build, PWD = the root: claude mcp list → pensmith: node ${PWD}/plugin/dist/mcp/server.mjs - √ Connected
evidence PASS [PLUG-04] PWD unset (${PWD:-.} falls back to .): claude mcp list → pensmith: node ${PWD}/plugin/dist/mcp/server.mjs - √ Connected
note     PLUG-04 documented limitation (CONTRIBUTING): Claude Code started in the root with PWD=/tmp (a launcher that passes on another PWD): claude mcp list → pensmith: node ${PWD}/plugin/dist/mcp/server.mjs - × Failed to connect — CONNECTION_CLOSED: Connection closed
evidence PASS [PLUG-04] --plugin-dir ./plugin at the repo root: pensmith servers [{"name":"pensmith","status":"connected","source":"project"}]
note     PLUG-04 dedupe: Claude Code kept the project .mcp.json server ("pensmith"); its tools are mcp__pensmith__*
note     PLUG-04 documented limitation (CONTRIBUTING): PWD unset, --plugin-dir ./plugin at the root → 2 pensmith servers [{"name":"plugin:pensmith:pensmith","status":"connected","source":"plugin"},{"name":"pensmith","status":"connected","source":"project"}]
evidence PASS [PLUG-04] PWD unset, --plugin-dir ./plugin with --settings '{"disabledMcpjsonServers":["pensmith"]}' (the CONTRIBUTING workaround): pensmith servers [{"name":"plugin:pensmith:pensmith","status":"connected","source":"plugin"}]
evidence PASS [PLUG-04] developer setup, /pensmith status with no --allowedTools → mcp__pensmith__pensmith_status; no permission denial (the skill's allowed-tools)
evidence PASS [PLUG-14] developer setup: the PostToolUse hook checkpointed mcp__pensmith__pensmith_status: {"ts":"2026-09-30T14:38:45.220Z","session_id":"02ebbda1-…","tool_name":"mcp__pensmith__pensmith_status","next":"plan 1"}
evidence PASS [PLUG-05] /pensmith:verify-section 1 → Skill({"skill":"pensmith:pensmith","args":"verify 1"}) → mcp__plugin_pensmith_pensmith__pensmith_verify
evidence PASS [PLUG-14] pre-compact.mjs wrote HANDOFF v2: phase sectioning, section 1, position plan (router: plan §1)
evidence PASS [PLUG-14] SessionStart hook: exit 0, success; debug log: Hook SessionStart (node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.mjs) provided additionalContext (294 chars)
evidence PASS [PLUG-14] the model quotes the resume context: Next step (the pensmith router): Plan section §1 (introduction): run /pensmith (or `pensmith plan 1`).
evidence PASS [PLUG-14] headless `claude -p --resume <id> "/compact"`: PreCompact:manual [node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/pre-compact.mjs] completed with status 0; HANDOFF.json written
evidence PASS [session-id] the MCP server sees CLAUDE_CODE_SESSION_ID equal to the Stop hook's stdin session_id (the lock owner match, D-17-37)
session check: all evidence passed
```

The limits of this evidence are unchanged from §3:
- `/compact` was driven headless, not interactively.
- Everything ran on Linux only.
- The session's messaging variables were not passed to the child sessions; the script's allow-listed environment keeps them out.

### 8.12 PLUG-13 mutation check (scratch clone of 03d1654)

1. In `bin/cli/plan.ts`, `out(\`pensmith plan --revise: …\`)` was replaced by `process.stdout.write(…)`. Results:
   - `eslint bin/cli/plan.ts` failed: `165:7 error chokepoint "stdout-sink" (PLUG-13): Print through out() … Matched \`process.stdout.write\``.
   - The `mcp-stdout-graph` harness in `tests/chokepoints.test.ts` failed: "the real bin/cli/plan.ts does not violate mcp-stdout-graph", with the violation reached from `mcp/`.
2. That change was reverted, and the `out(` of `pensmith plan: wrote PLAN.md …` (line 299) was replaced by `process.stdout.write(`. After `npm run build` and `node scripts/bundle.mjs`, `tests/mcp-stdout-clean.test.ts` failed 3/3:
   - the `dist/mcp/server.js` leg;
   - the `plugin/dist/mcp/server.mjs` leg;
   - the graph case.

   In both server legs the invalid stdout line was `pensmith plan: wrote PLAN.md to …/01-introduction/PLAN.md (3 claim(s), 3 source(s))`.

The clone's `node_modules` was a symlink to this checkout's, so its regenerated bundles named the resolved `node_modules` path. The committed bundles are generated from a real `npm ci` (D-23a-04), and `bundle:check` passes on them (§8.0).

### 8.13 ROADMAP Phase 23 success criteria (the parts 23a owns)

| Criterion | Verdict | Evidence |
|---|---|---|
| 1. `claude plugin validate plugin` passes | Met | §8.9 (`--strict` ×3) |
| 1. From a fresh clone with no build, marketplace add + install succeed, `/pensmith` exists, and the 4 hooks and MCP server load | Met | §8.9, §8.11 |
| 1. A required CI job repeats this on every change | **Not met** | The job exists and passes locally, but it has never run on a runner and is not required (CI-05, §8.8) |
| 1. No workflow, prompt, preset, reference, skill or agent file exists outside `plugin/` | Met | `tests/plugin-layout.test.ts` |
| 4. (hooks half) PreCompact writes HANDOFF.json; SessionStart gives the resume context; PostToolUse checkpoints at most once a minute; Stop releases only its own session's locks | Met (Linux; 3-OS pending) | §8.7, §8.10, §8.11 |
| 4. Concurrent draft submissions for different sections | Out of scope (23b, PLUG-07) | — |
| 5. (stdio half) stdout stays valid JSON-RPC while verb tools run | Met | §8.6, §8.12 |
| 5. MCP resources, `/pensmith doctor`, the missing-`node` fix | Out of scope (23b: PLUG-12, PLUG-06), apart from the missing-node guidance CI-05 asks for (met) | — |
| 6. The plumbing namespace is available | Met | §8.5 |
| 6. The repo-root `.mcp.json` works for developers | **Partly met** | §8.4 (PLUG-04 Pending) |
| 6. The 11 §5.4 phrases and the RUN-28 gates in the Tier-1 bodies | Out of scope (23b: PLUG-11, PLUG-10) | — |

### 8.14 23a-PLAN §2 success criteria

| # | Criterion | Verdict |
|---|---|---|
| 1 | Validate `--strict` ×3; fresh-clone marketplace add + install; `/pensmith`; 4 hooks + MCP load; CI job on every change; no asset outside `plugin/` | Met apart from "a CI job repeats this on every change", which is configured but not yet run (CI-05) |
| 2 | The hooks run (HANDOFF, resume context, one checkpoint a minute outside `.claude/`, Stop's own-session locks only) | Met |
| 3 | stdout stays valid JSON-RPC while verb tools run | Met |
| 4 | The plumbing namespace is available and documented; the repo-root `.mcp.json` works for developers | Plumbing met; `.mcp.json` partly met (PLUG-04) |
| 5 | `claude -p --plugin-dir plugin "/pensmith status"` replies with the status output | Met (§8.11) |

### 8.15 Verdict

| Requirement | Verdict | REQUIREMENTS.md |
|---|---|---|
| PLUG-01 | Met | `[x]`, Complete (23a) |
| PLUG-02 | Met | `[x]`, Complete (23a) |
| PLUG-03 | Met | `[x]`, Complete (23a) |
| PLUG-04 | Not met: the acceptance text needs a maintainer amendment (23a-PLAN §7.6) | `[ ]`, Pending |
| PLUG-05 | Met | `[x]`, Complete (23a) |
| PLUG-13 | Met | `[x]`, Complete (23a) |
| PLUG-14 | Met on Linux, with the 3-OS CI leg pending the first green `check` matrix | `[x]`, Complete (23a) with that caveat |
| CI-05 | Not met: never run on a runner; not a required check | `[ ]`, Pending (maintainer) |

ROADMAP: Phase 23 stays unticked. 23b is still to come, and 23a itself leaves PLUG-04 and CI-05 open.
