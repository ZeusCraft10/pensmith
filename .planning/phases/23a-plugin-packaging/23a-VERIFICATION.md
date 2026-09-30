---
phase: 23a-plugin-packaging
verified: 2026-09-30
verified_at_branch: v1/p23a (review round 1 fixer; gate at 90f8c7d, live sessions at df1e767 — the same code, 90f8c7d adds docs only)
status: in_review
requirements_in_scope: [PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-13, PLUG-14, CI-05]
open_items:
  - "CI-05: the `plugin` job (ubuntu, macOS, Windows) and `bundle:check` in `check` have not run on a GitHub runner (v1/p23a has no upstream) — maintainer, after the push"
  - "CI-05: make the `plugin` and `check` jobs required checks on main — maintainer (§5)"
review_rounds: [round 1 (fixer, 2026-09-30): §4]
---

# Phase 23a: Plugin Packaging (PLUGIN-PACKAGING): Verification

This file records the evidence 23a-PLAN §7.4 and D-23a-19 ask for: the full gate, the CI-05 plugin smoke against the real Claude Code, and the live headless sessions that are the only proof of the real-session parts of PLUG-03, PLUG-04, PLUG-05 and PLUG-14. The closer re-runs these and adds the requirement verdicts and `23a-SUMMARY.md`.

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

CI-05 is complete in this branch only with that caveat stated.
