---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 06
type: execute
wave: 2
depends_on: ["02-00"]
files_modified:
  - hooks/session-start.ts
  - hooks/pre-compact.ts
  - hooks/post-tool-use.ts
  - hooks/stop.ts
  - hooks/hooks.json
  - workflows/doctor.md
  - workflows/new.md
  - workflows/next.md
  - workflows/status.md
  - workflows/research.md
  - workflows/outline.md
  - workflows/plan.md
  - workflows/write.md
  - workflows/verify.md
  - workflows/compile.md
  - workflows/done.md
  - workflows/resume.md
  - workflows/list.md
  - workflows/open.md
  - workflows/sketch.md
  - workflows/add.md
  - scripts/validate-plugin-manifest.cjs
  - tests/workflows-keyequal.test.ts
  - tests/hooks-noop.test.ts
autonomous: true
requirements: [TIER-03, ARCH-01, ARCH-03]
must_haves:
  truths:
    - "16 workflow markdown files exist under `workflows/`, one per dispatcher verb (canonical UX-02 verb list)"
    - "Each workflow body contains a `<capability_check>` block (ARCH-03) enumerating the full Phase 2 capability vocabulary (Task, MCP, AskUserQuestion, Pandoc, Zotero MCP, humanizer skill)"
    - "4 Claude Code lifecycle hooks exist as no-op stubs that exit 0 (TIER-03)"
    - "hooks/hooks.json declares all 4 hooks with their event names — manifest validator reads this (TIER-03)"
    - "scripts/validate-plugin-manifest.cjs asserts presence of hooks/ + hooks.json + workflows/ (TIER-07)"
    - "workflow filenames ↔ dispatcher subCommand keys are bijective (preflight from 02-05 passes)"
  artifacts:
    - path: "workflows/"
      provides: "16 markdown bodies (UX-02 canonical verb list) — shared source-of-truth between Tier 1 (plugin) and Tier 2 (CLI)"
    - path: "hooks/session-start.ts"
      provides: "SessionStart hook stub (exit 0, no side effects)"
    - path: "hooks/pre-compact.ts"
      provides: "PreCompact hook stub"
    - path: "hooks/post-tool-use.ts"
      provides: "PostToolUse hook stub"
    - path: "hooks/stop.ts"
      provides: "Stop hook stub (TIER-03 — 4th hook, fires when the agent halts)"
    - path: "hooks/hooks.json"
      provides: "Hook manifest — declares event→script mapping (TIER-03)"
    - path: "scripts/validate-plugin-manifest.cjs"
      provides: "Manifest validator EXTENDED to assert hooks/ (4 .ts + hooks.json) + workflows/ presence"
  key_links:
    - from: "workflows/<verb>.md"
      to: "bin/cli/pensmith.ts subCommands.<verb>"
      via: "filename equality (workflow-key-equal preflight in tests/cli-verbs.test.ts from 02-05)"
      pattern: "workflows/[a-z-]+\\.md"
    - from: "scripts/validate-plugin-manifest.cjs"
      to: "hooks/ + workflows/ directories"
      via: "fs.existsSync presence assertion + hooks.json parse"
      pattern: "hooks|workflows"
    - from: "hooks/hooks.json"
      to: "hooks/{session-start,pre-compact,post-tool-use,stop}.ts"
      via: "manifest declares event-name → script-path mapping"
      pattern: "session-start|pre-compact|post-tool-use|stop"
---

<objective>
Land the plugin shell — **4 lifecycle hooks** (no-ops) + a `hooks/hooks.json` manifest +
16 workflow markdown bodies (UX-02 canonical verb list) + an extension to
`scripts/validate-plugin-manifest.cjs` that asserts the new scaffolding.

Per ARCH-01: workflows are markdown shared by BOTH tiers. The plugin Tier (Tier 1) reads
them as agent prompts; the CLI Tier (Tier 2) prints them via `pensmith help <verb>` and
uses the `<capability_check>` block to degrade behavior when running outside Claude Code.

Per ARCH-03 (extended in iter 1/3 per W4): every workflow body MUST contain a
`<capability_check>` block declaring which tools it needs and how to degrade if absent.
**The capability vocabulary is the full Phase 2 set**: `Task`, `MCP <tool-name>`,
`AskUserQuestion`, `Pandoc`, `Zotero MCP`, `humanizer skill`. Workflows that need none
of these still emit `(none required)` so the block shape is uniform.

Per TIER-03 (NEW in iter 1/3): the hook scaffold ships with **4 hooks**, not 3 —
SessionStart, PreCompact, PostToolUse, **Stop** — and a `hooks/hooks.json` manifest
file that declares the event→script mapping. `npm run validate:manifests` parses the
JSON and verifies every declared script exists.

Per TIER-07: plugin shell + hooks scaffolding is present and the manifest validator
asserts it. `npm run validate:manifests` fails if any required file is missing.

Per CLAUDE.md / PRD §14: workflows are the load-bearing two-tier source-of-truth. If
they diverge, the tier contract test (02-07) fails.

Output: 16 workflow stubs (UX-02 verb list) + 4 hook stubs + hooks.json + an extended manifest validator.
After this plan + 02-05, the workflow-key-equal preflight in `tests/cli-verbs.test.ts`
flips from "skipped" to "asserted".
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md
@scripts/validate-plugin-manifest.cjs

<interfaces>
<!-- ARCH-03 capability-check block shape — every workflow markdown body has one. -->
<!-- Pattern source: gsd-plugin workflows/*.md (cloned ref) + PRD §14. -->
<!-- Iter 1/3 W4: the capability vocabulary is the full Phase 2 set. -->

```markdown
<capability_check>
required:
  - Task                 # spawn subagents (Tier 1 only)
  - AskUserQuestion      # Claude Code UI prompt (Tier 1 only)
  - MCP <tool-name>      # MCP tool — see 02-04 for the snake_case list
  - Pandoc               # `pandoc` on PATH (DOCT-02c probe)
  - Zotero MCP           # Zotero MCP server (DOCT-02b probe)
  - humanizer skill      # ~/.claude/skills/humanizer/ (DOCT-02d probe)

degrade_if_missing:
  - if no Task: run sequentially (slower)
  - if no AskUserQuestion: read response from stdin (Tier 2 fallback)
  - if no MCP tools: read .paper/STATE.json directly (Tier 2 fallback)
  - if no Pandoc: skip export, suggest manual conversion
  - if no Zotero MCP: read .paper/library.json directly (Phase 3+ ships this)
  - if no humanizer skill: skip humanize verb with WARN
</capability_check>
```

**The vocabulary is closed** — any token not in `{Task, AskUserQuestion, MCP <name>,
Pandoc, Zotero MCP, humanizer skill, (none required)}` will be rejected by the
`tests/workflows-keyequal.test.ts` ARCH-03 vocabulary check.

<!-- 16 workflow files, matched 1:1 with dispatcher verbs from 02-05 / UX-02: -->

```
workflows/
  doctor.md
  new.md          next.md         status.md
  research.md     outline.md      plan.md
  write.md        verify.md       compile.md
  done.md         resume.md       list.md
  open.md         sketch.md       add.md
```

<!-- Hook lifecycle (gsd-plugin pattern, cloned ref; iter 1/3 adds Stop): -->

- **SessionStart**: fires when Claude Code opens a session in this repo.
- **PreCompact**: fires before context compaction.
- **PostToolUse**: fires after every tool call.
- **Stop** (TIER-03 NEW): fires when the agent halts — Phase 3+ uses this to write a
  final HANDOFF.json snapshot. Phase 2 ships as a no-op.

All four ship as no-op stubs in Phase 2; Phase 3+ wires real behavior.

<!-- hooks/hooks.json manifest shape (TIER-03 NEW): -->

```json
{
  "schemaVersion": 1,
  "hooks": [
    { "event": "SessionStart", "script": "session-start.ts" },
    { "event": "PreCompact",   "script": "pre-compact.ts"  },
    { "event": "PostToolUse",  "script": "post-tool-use.ts" },
    { "event": "Stop",         "script": "stop.ts"          }
  ]
}
```

Manifest validator reads this file, asserts every declared script exists under `hooks/`,
and asserts the set is exactly the 4 required events.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create 4 hook stubs + hooks.json manifest under hooks/ (TIER-03)</name>
  <files>hooks/session-start.ts, hooks/pre-compact.ts, hooks/post-tool-use.ts, hooks/stop.ts, hooks/hooks.json, tests/hooks-noop.test.ts</files>
  <read_first>
    - `.claude-plugin/plugin.json` (existing — declares which hooks it registers; verify hook names match)
    - `/tmp/refs/gsd-plugin/hooks/*` if available (the reference hook scaffold style — minimal, exits 0, prints nothing on stdout)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` (TIER-03, TIER-07 locks)
  </read_first>
  <action>
    Create four TypeScript files under `hooks/` plus `hooks/hooks.json`. Each `.ts`
    file is a single-purpose entrypoint that Claude Code spawns; exits 0 on completion;
    emits NOTHING on stdout (would corrupt the hook-protocol frame, same family of bug
    as Pitfall 7).

    **`hooks/session-start.ts`:**

    ```typescript
    #!/usr/bin/env node
    // hooks/session-start.ts
    //
    // Claude Code SessionStart hook. Phase 2 ships as a no-op exit-0 stub.
    // Phase 3+ wires session-load behavior (read .paper/STATE.json, emit a
    // summary to the agent's first turn via stderr).
    //
    // CRITICAL: stdout is the hook-protocol channel (in Claude Code's hook
    // contract). NEVER console.log here. Diagnostics go to stderr.

    process.exit(0);
    ```

    **`hooks/pre-compact.ts`:**

    ```typescript
    #!/usr/bin/env node
    // hooks/pre-compact.ts
    //
    // Claude Code PreCompact hook. Phase 2 ships as a no-op exit-0 stub.
    // Phase 3+ wires "save handoff state to .paper/HANDOFF.json before
    // context compaction" behavior.

    process.exit(0);
    ```

    **`hooks/post-tool-use.ts`:**

    ```typescript
    #!/usr/bin/env node
    // hooks/post-tool-use.ts
    //
    // Claude Code PostToolUse hook. Phase 2 ships as a no-op exit-0 stub.
    // Phase 3+ wires "log MCP tool invocations to .paper/SESSION-LOG.jsonl"
    // behavior.

    process.exit(0);
    ```

    **`hooks/stop.ts` (TIER-03 NEW):**

    ```typescript
    #!/usr/bin/env node
    // hooks/stop.ts
    //
    // Claude Code Stop hook. Fires when the agent halts. Phase 2 ships as
    // a no-op exit-0 stub. Phase 3+ writes a final HANDOFF.json snapshot
    // so the user can resume cleanly with `pensmith resume`.

    process.exit(0);
    ```

    **`hooks/hooks.json` (TIER-03 NEW):**

    ```json
    {
      "schemaVersion": 1,
      "hooks": [
        { "event": "SessionStart", "script": "session-start.ts" },
        { "event": "PreCompact",   "script": "pre-compact.ts"  },
        { "event": "PostToolUse",  "script": "post-tool-use.ts" },
        { "event": "Stop",         "script": "stop.ts"          }
      ]
    }
    ```

    **`tests/hooks-noop.test.ts`:**

    ```typescript
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { existsSync, readFileSync } from 'node:fs';

    const HOOKS = [
      'hooks/session-start.ts',
      'hooks/pre-compact.ts',
      'hooks/post-tool-use.ts',
      'hooks/stop.ts',
    ];

    for (const hook of HOOKS) {
      test(`TIER-03/07: ${hook} exists and exits 0`, () => {
        assert.ok(existsSync(hook), `${hook} missing`);
        // Hooks run under Node via tsx. Execute via tsx to avoid build coupling.
        const out = execFileSync(process.execPath, [
          '--import', 'tsx', hook,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        // Must produce no stdout (would corrupt hook-protocol frame).
        assert.equal(out, '', `${hook} stdout MUST be empty, got: ${out}`);
      });
    }

    test('TIER-03: hooks/hooks.json declares all 4 hooks', () => {
      assert.ok(existsSync('hooks/hooks.json'), 'hooks/hooks.json missing');
      const raw = readFileSync('hooks/hooks.json', 'utf8');
      const parsed = JSON.parse(raw) as { schemaVersion: number; hooks: Array<{ event: string; script: string }> };
      assert.equal(parsed.schemaVersion, 1);
      const events = parsed.hooks.map((h) => h.event).sort();
      assert.deepEqual(events, ['PostToolUse', 'PreCompact', 'SessionStart', 'Stop'].sort());
      // Every declared script must exist under hooks/.
      for (const h of parsed.hooks) {
        assert.ok(existsSync(`hooks/${h.script}`), `hooks/${h.script} declared in hooks.json but missing on disk`);
      }
    });
    ```

    NOTE on `--import tsx`: This is the Node 20+ flag. If it fails on the dev
    box, fall back to spawning `npx tsx <hook>`. Match whichever idiom Phase 0
    `tests/repo-files.test.ts` already uses for invoking TS files — DO NOT
    introduce a new pattern.

    Self-check:
    - `ls hooks/` shows the 4 .ts files + hooks.json.
    - `grep -v '^[[:space:]]*//' hooks/*.ts | grep -c "console\."` returns 0.
    - `grep -c "process.exit(0)" hooks/*.ts` returns 4.
    - `node -e "JSON.parse(require('node:fs').readFileSync('hooks/hooks.json','utf8'))"` exits 0.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/hooks-noop.test.ts &amp;&amp; node -e "const fs=require('node:fs'); for(const h of ['hooks/session-start.ts','hooks/pre-compact.ts','hooks/post-tool-use.ts','hooks/stop.ts']){if(!fs.existsSync(h)){console.error('missing',h);process.exit(1)} const c=fs.readFileSync(h,'utf8'); if(/^[^/]*console\./m.test(c)){console.error('console.* in',h);process.exit(1)} if(!/process\.exit\(0\)/.test(c)){console.error('missing exit 0 in',h);process.exit(1)}} const m=JSON.parse(fs.readFileSync('hooks/hooks.json','utf8')); if(m.hooks.length!==4){console.error('hooks.json must declare 4 hooks');process.exit(1)} console.log('OK')"</automated>
  </verify>
  <acceptance_criteria>
    - `hooks/session-start.ts`, `hooks/pre-compact.ts`, `hooks/post-tool-use.ts`, `hooks/stop.ts` all exist (TIER-03 — 4 hooks).
    - `hooks/hooks.json` exists with `schemaVersion: 1` and 4 hook entries.
    - Each `.ts` file calls `process.exit(0)` and contains no `console.*` references (excluding comments).
    - Each hook executes without printing to stdout.
    - `tests/hooks-noop.test.ts` exists and all 5 hook-related tests pass (4 hooks + 1 manifest).
  </acceptance_criteria>
  <done>
    Hooks scaffold landed (4 stubs + manifest). TIER-03 satisfied. Task 3 wires the
    manifest validator to assert hooks/hooks.json + each declared script.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create 16 workflow markdown stubs under workflows/ (UX-02 verb list, ARCH-03 full vocabulary)</name>
  <files>workflows/doctor.md, workflows/new.md, workflows/next.md, workflows/status.md, workflows/research.md, workflows/outline.md, workflows/plan.md, workflows/write.md, workflows/verify.md, workflows/compile.md, workflows/done.md, workflows/resume.md, workflows/list.md, workflows/open.md, workflows/sketch.md, workflows/add.md, tests/workflows-keyequal.test.ts</files>
  <read_first>
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` UX-02 (the canonical 16-verb list) + ARCH-01 / ARCH-03
    - `/tmp/refs/gsd-plugin/workflows/*.md` if available (capability_check block style)
    - `bin/pensmith.ts` once 02-05 lands (subCommand keys MUST equal these filenames)
    - PRD §14 (workflow markdown two-tier shape)
  </read_first>
  <action>
    Create one markdown file per dispatcher verb. Each file follows the same
    skeleton (ARCH-03 + ARCH-01 — full Phase 2 capability vocabulary per W4).
    The body sections (Overview, Steps, Outputs) can be one-liners — Phase 2
    ships stubs, Phase 3+ fills them.

    **Common skeleton** (used as the template — substitute `{verb}`, `{description}`,
    `{required_tools}`, `{degrade_steps}` per verb):

    ```markdown
    # pensmith {verb}

    > {description}

    <capability_check>
    required:
    {required_tools}

    degrade_if_missing:
    {degrade_steps}
    </capability_check>

    ## Overview

    (Phase 2 stub — Phase 3+ fills this in.)

    ## Steps

    1. (stub)

    ## Outputs

    - (stub)
    ```

    **Per-verb body — required tools + degradation** (every entry MUST use the
    closed vocabulary `{Task, AskUserQuestion, MCP <name>, Pandoc, Zotero MCP,
    humanizer skill, (none required)}`):

    | verb | description | required (W4 vocabulary) | degrade |
    |------|-------------|--------------------------|---------|
    | doctor | Run ecosystem self-check. | (none required) | (no degradation needed) |
    | new | Start a new paper project (capture initial requirements). | AskUserQuestion | if no AskUserQuestion: read response from stdin in Tier 2 |
    | next | Advance to the next workflow step based on current paper state. | MCP state.read | if no MCP tools: direct read of .paper/STATE.json |
    | status | Report current paper state + per-section progress. | MCP state.read | if no MCP tools: direct read of .paper/STATE.json |
    | research | Survey existing literature for the paper topic. | Task; MCP library.read; Zotero MCP | if no Task: run sequentially; if no MCP library / Zotero MCP: read .paper/library.json directly (Phase 3+) |
    | outline | Generate / refine the paper outline. | AskUserQuestion | if no AskUserQuestion: read response from stdin |
    | plan | Plan one section's content + sources. | MCP state.read; MCP library.read | if no MCP tools: direct file reads from .paper/ |
    | write | Draft one section. | MCP state.update | if no MCP tools: direct file writes via atomicWriteFile |
    | verify | Verify citations + claims in one section (DOI, fuzzy-match, quote-check, plagiarism, GPTZero transparency). | Task; MCP library.read | if no Task: run sequentially (slower); if no MCP library: direct read of .paper/library.json |
    | compile | Assemble all section drafts into a single document. | MCP state.read | if no MCP tools: direct file reads from .paper/ |
    | done | Finalize the paper — humanize + export (DOCX/PDF/MD, no metadata trace). | Pandoc; humanizer skill | if no Pandoc: skip export, suggest manual conversion; if no humanizer skill: skip humanize step with WARN |
    | resume | Resume an interrupted workflow. | MCP state.read | if no MCP tools: direct read of .paper/HANDOFF.json |
    | list | List papers and sections in this repository. | MCP state.read | if no MCP tools: direct read of .paper/STATE.json |
    | open | Open a specific paper or section by id. | MCP state.read | if no MCP tools: direct read of .paper/STATE.json |
    | sketch | Quick free-form sketch of a section before plan. | AskUserQuestion | if no AskUserQuestion: read response from stdin |
    | add | Add a section or citation library entry. | AskUserQuestion; MCP library.read; MCP state.update; Zotero MCP | if no AskUserQuestion: read response from stdin; if no MCP / Zotero MCP: direct file ops on .paper/ |

    For each verb, render the skeleton with the row's values. Format
    `required_tools` as bullet list (each item on its own line prefixed with
    `  - `; split semicolons into separate bullets); `(none required)` is a
    legitimate single bullet. Format `degrade_steps` likewise; if "(no
    degradation needed)" use a single bullet.

    Example — `workflows/doctor.md`:

    ```markdown
    # pensmith doctor

    > Run ecosystem self-check.

    <capability_check>
    required:
      - (none required)

    degrade_if_missing:
      - (no degradation needed)
    </capability_check>

    ## Overview

    (Phase 2 stub — Phase 3+ fills this in.)

    ## Steps

    1. (stub)

    ## Outputs

    - (stub)
    ```

    Example — `workflows/done.md` (multi-capability — humanize + export):

    ```markdown
    # pensmith done

    > Finalize the paper — humanize + export (DOCX/PDF/MD, no metadata trace).

    <capability_check>
    required:
      - Pandoc
      - humanizer skill

    degrade_if_missing:
      - if no Pandoc: skip export, suggest manual conversion
      - if no humanizer skill: skip humanize step with WARN
    </capability_check>

    ## Overview

    (Phase 2 stub — Phase 3+ fills this in.)

    ## Steps

    1. (stub)

    ## Outputs

    - (stub)
    ```

    Example — `workflows/research.md` (multi-capability):

    ```markdown
    # pensmith research

    > Survey existing literature for the paper topic.

    <capability_check>
    required:
      - Task
      - MCP library.read
      - Zotero MCP

    degrade_if_missing:
      - if no Task: run sequentially (slower)
      - if no MCP library / Zotero MCP: read .paper/library.json directly (Phase 3+)
    </capability_check>

    ## Overview

    (Phase 2 stub — Phase 3+ fills this in.)

    ## Steps

    1. (stub)

    ## Outputs

    - (stub)
    ```

    **`tests/workflows-keyequal.test.ts`** (ARCH-01 + ARCH-03 vocabulary + workflow-key-equal):

    ```typescript
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readdirSync, readFileSync, existsSync } from 'node:fs';

    const EXPECTED_16 = [
      'doctor', 'new', 'next', 'status', 'research', 'outline', 'plan', 'write',
      'verify', 'compile', 'done', 'resume', 'list', 'open', 'sketch', 'add',
    ].sort();

    // W4: closed vocabulary for ARCH-03 `required:` tokens.
    // Workflows that need nothing emit `(none required)`.
    const ALLOWED_REQUIRED_TOKENS = [
      'Task',
      'AskUserQuestion',
      'Pandoc',
      'Zotero MCP',
      'humanizer skill',
      '(none required)',
      // MCP tools are matched by the prefix `MCP ` — see vocabulary check below.
    ];

    test('ARCH-01 / UX-02: workflows/ contains exactly 16 markdown bodies', () => {
      assert.ok(existsSync('workflows'), 'workflows/ directory missing');
      const files = readdirSync('workflows').filter((f) => f.endsWith('.md')).sort();
      assert.deepEqual(
        files.map((f) => f.replace(/\.md$/, '')),
        EXPECTED_16,
        `workflows/ files must equal UX-02 canonical 16-verb list`,
      );
    });

    test('ARCH-03: every workflow body has a <capability_check> block with required + degrade lists', () => {
      for (const verb of EXPECTED_16) {
        const src = readFileSync(`workflows/${verb}.md`, 'utf8');
        assert.match(src, /<capability_check>[\s\S]+?<\/capability_check>/, `${verb}.md: missing <capability_check>`);
        assert.match(src, /required:\s*\n/, `${verb}.md: <capability_check> must have a required: list`);
        assert.match(src, /degrade_if_missing:\s*\n/, `${verb}.md: <capability_check> must have a degrade_if_missing: list`);
      }
    });

    test('ARCH-03 W4: every required: token is in the closed Phase 2 vocabulary', () => {
      for (const verb of EXPECTED_16) {
        const src = readFileSync(`workflows/${verb}.md`, 'utf8');
        const block = src.match(/<capability_check>([\s\S]+?)<\/capability_check>/);
        assert.ok(block, `${verb}.md: <capability_check> not found`);
        const required = block![1].match(/required:\s*\n([\s\S]*?)\n\s*degrade_if_missing:/);
        assert.ok(required, `${verb}.md: required: section not parseable`);
        const tokens = required![1]
          .split('\n')
          .map((l) => l.replace(/^\s*-\s*/, '').trim())
          .filter((l) => l.length > 0);
        for (const tok of tokens) {
          const ok = ALLOWED_REQUIRED_TOKENS.includes(tok) || /^MCP\s+\S+/.test(tok);
          assert.ok(ok, `${verb}.md: required: token '${tok}' is not in the W4 closed vocabulary {Task, AskUserQuestion, MCP <name>, Pandoc, Zotero MCP, humanizer skill, (none required)}`);
        }
      }
    });

    test('ARCH-01: workflow filenames are bijective with dispatcher verbs', () => {
      const dispatcherSrc = readFileSync('bin/pensmith.ts', 'utf8');
      const fileVerbs = readdirSync('workflows').filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
      for (const v of fileVerbs) {
        const re = new RegExp(`['"]?${v.replace('-', '\\-')}['"]?:\\s*\\(\\)\\s*=>`);
        assert.ok(re.test(dispatcherSrc), `workflow ${v}.md has no matching subCommand`);
      }
    });
    ```

    Self-check:
    - `ls workflows/*.md | wc -l` returns 16.
    - `grep -L "<capability_check>" workflows/*.md` returns nothing (all files have the block).
    - At least one workflow uses each of: `Task`, `AskUserQuestion`, `Pandoc`, `Zotero MCP`, `humanizer skill`.
    - `npm run lint` continues to pass (markdown is not linted by eslint).
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/workflows-keyequal.test.ts &amp;&amp; node -e "const fs=require('node:fs'); const expected=['doctor','new','next','status','research','outline','plan','write','verify','compile','done','resume','list','open','sketch','add'].sort(); const got=fs.readdirSync('workflows').filter(f=>f.endsWith('.md')).map(f=>f.replace(/\\.md$/,'')).sort(); if(JSON.stringify(got)!==JSON.stringify(expected)){console.error('mismatch:',got);process.exit(1)} for(const v of expected){const s=fs.readFileSync('workflows/'+v+'.md','utf8'); if(!/<capability_check>/.test(s)){console.error(v+'.md missing capability_check');process.exit(1)}} const allCap=fs.readdirSync('workflows').filter(f=>f.endsWith('.md')).map(f=>fs.readFileSync('workflows/'+f,'utf8')).join('\\n'); for(const tok of ['Task','AskUserQuestion','Pandoc','Zotero MCP','humanizer skill']){if(!allCap.includes(tok)){console.error('W4 vocabulary token never used:',tok);process.exit(1)}} console.log('OK 16 workflows + capability_check + W4 vocabulary')"</automated>
  </verify>
  <acceptance_criteria>
    - `workflows/` contains exactly 16 `.md` files matching the UX-02 canonical verb list.
    - Each file contains a `<capability_check>` block with both `required:` and `degrade_if_missing:` sub-lists (ARCH-03).
    - **W4: every `required:` token belongs to the closed Phase 2 vocabulary** — `{Task, AskUserQuestion, MCP <name>, Pandoc, Zotero MCP, humanizer skill, (none required)}`. Asserted by `tests/workflows-keyequal.test.ts` ARCH-03 vocabulary test.
    - At least one workflow uses each non-trivial vocabulary token (Task, AskUserQuestion, Pandoc, Zotero MCP, humanizer skill) — verified by the self-check `node -e` script in `<verify>`.
    - `tests/workflows-keyequal.test.ts` all 4 tests pass.
    - The workflow-key-equal preflight in `tests/cli-verbs.test.ts` (from 02-05) now actually fires and passes.
  </acceptance_criteria>
  <done>
    16 workflow bodies (UX-02 canonical) committed. Tier 1 (plugin) and Tier 2 (CLI) now share the same
    source-of-truth markdown set. W4 vocabulary closed and enforced by test.
  </done>
</task>

<task type="auto">
  <name>Task 3: Extend scripts/validate-plugin-manifest.cjs to assert hooks/ (4 stubs + hooks.json) + workflows/</name>
  <files>scripts/validate-plugin-manifest.cjs</files>
  <read_first>
    - `scripts/validate-plugin-manifest.cjs` in full (current 80-line shape)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md` TIER-03, TIER-07 rows
    - The 4 hooks + hooks.json created in Task 1 and 16 workflow files (UX-02 canonical) created in Task 2
  </read_first>
  <action>
    Add a section to `scripts/validate-plugin-manifest.cjs` AFTER the existing
    `mcp` block and BEFORE the final `if (process.exitCode === 1)` check.
    The new section asserts:
    - `hooks/` directory exists.
    - **`hooks/hooks.json` exists, parses as JSON, declares exactly the 4 required events.**
    - Each `.ts` file declared in `hooks.json` exists under `hooks/`.
    - `workflows/` directory exists.
    - Exactly 16 `.md` files live under `workflows/` (UX-02 canonical verb list).
    - Each `.md` file's body contains a `<capability_check>` substring.

    Required addition (insert after line 73, before the final `if`):

    ```javascript
    // TIER-03 (Phase 2): 4 hooks + hooks.json manifest declares them.
    // TIER-07 (Phase 2): plugin shell + hooks + workflows scaffolding present.
    // ARCH-01: workflows are markdown shared by both tiers.
    // ARCH-03: every workflow body contains a <capability_check> block.

    const REQUIRED_HOOK_EVENTS = ['SessionStart', 'PreCompact', 'PostToolUse', 'Stop'];
    const EXPECTED_WORKFLOWS = [
      'doctor', 'new', 'next', 'status', 'research', 'outline', 'plan', 'write',
      'verify', 'compile', 'done', 'resume', 'list', 'open', 'sketch', 'add',
    ];

    const hooksDir = path.join(root, 'hooks');
    if (!fs.existsSync(hooksDir)) {
      fail('hooks/ directory missing (TIER-07)');
    } else {
      const manifestPath = path.join(hooksDir, 'hooks.json');
      if (!fs.existsSync(manifestPath)) {
        fail('hooks/hooks.json missing (TIER-03)');
      } else {
        let manifest;
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (e) {
          fail(`hooks/hooks.json: invalid JSON (${e.message}) (TIER-03)`);
        }
        if (manifest) {
          if (manifest.schemaVersion !== 1) {
            fail(`hooks/hooks.json: schemaVersion must be 1 (TIER-03)`);
          }
          const declaredEvents = (manifest.hooks ?? []).map((h) => h.event).sort();
          const wantedEvents = [...REQUIRED_HOOK_EVENTS].sort();
          if (JSON.stringify(declaredEvents) !== JSON.stringify(wantedEvents)) {
            fail(`hooks/hooks.json: events must equal ${JSON.stringify(wantedEvents)}, got ${JSON.stringify(declaredEvents)} (TIER-03)`);
          }
          for (const h of manifest.hooks ?? []) {
            const sp = path.join(hooksDir, h.script);
            if (!fs.existsSync(sp)) fail(`hooks.json declares ${h.event} → ${h.script} but hooks/${h.script} is missing (TIER-03)`);
          }
        }
      }
    }

    const workflowsDir = path.join(root, 'workflows');
    if (!fs.existsSync(workflowsDir)) {
      fail('workflows/ directory missing (ARCH-01)');
    } else {
      const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.md')).sort();
      const expected = [...EXPECTED_WORKFLOWS].map((v) => `${v}.md`).sort();
      if (JSON.stringify(files) !== JSON.stringify(expected)) {
        fail(`workflows/ mismatch — expected ${JSON.stringify(expected)}, got ${JSON.stringify(files)}`);
      }
      for (const f of files) {
        const body = fs.readFileSync(path.join(workflowsDir, f), 'utf8');
        if (!/<capability_check>[\s\S]+?<\/capability_check>/.test(body)) {
          fail(`workflows/${f} missing <capability_check> block (ARCH-03)`);
        }
      }
    }
    ```

    Self-check:
    - `node scripts/validate-plugin-manifest.cjs` exits 0 after Tasks 1 + 2 land.
    - Delete one hook stub temporarily → re-run → expects exit 1 and error mentioning the missing hook. (Run this verification mentally; do NOT actually delete files.)
    - Corrupt hooks.json temporarily → re-run → expects exit 1 and error mentioning JSON parse. (Mental verification only.)
    - `grep -c "TIER-03" scripts/validate-plugin-manifest.cjs` returns at least 2 (new in iter 1/3).
    - `grep -c "TIER-07" scripts/validate-plugin-manifest.cjs` returns at least 1.
    - `grep -c "ARCH-01\|ARCH-03" scripts/validate-plugin-manifest.cjs` returns at least 1.
  </action>
  <verify>
    <automated>node scripts/validate-plugin-manifest.cjs</automated>
  </verify>
  <acceptance_criteria>
    - `scripts/validate-plugin-manifest.cjs` includes assertions for hooks/ + hooks.json + workflows/ presence.
    - **The validator parses hooks.json and verifies each declared script exists** (TIER-03).
    - `node scripts/validate-plugin-manifest.cjs` exits 0 with Tasks 1 + 2 landed.
    - The validator references TIER-03, TIER-07, ARCH-01, ARCH-03 in its error messages.
    - `npm run validate:manifests` (the package script) continues to pass.
  </acceptance_criteria>
  <done>
    Manifest validator now enforces the plugin-shell contract — 4 hooks + manifest +
    16 workflows (UX-02 canonical) + capability_check blocks. TIER-03 + TIER-07 satisfied.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Claude Code lifecycle → hooks/*.ts | Hooks spawn under Node and inherit cwd; stdout is the hook-protocol channel (do NOT pollute) |
| Claude Code → hooks/hooks.json | Manifest parsed by the validator; malformed JSON → validator fails fast (no silent skip) |
| workflow markdown body → agent prompt (Tier 1) | Markdown is read as instruction; future-phase content should treat user-supplied paperRoot as input data, not as an instruction |
| workflow markdown body → CLI help output (Tier 2) | Body is printed verbatim; no exec / interpolation |
| manifest validator → repo filesystem | Read-only — only `fs.existsSync` / `fs.readFileSync`; no writes |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-06-01 | Tampering | A hook stub is replaced with a malicious one that exfiltrates `.paper/` content via SessionStart | accept | Hooks live in the repo and are reviewed at PR time. Phase 3+ may add a hook-signature check; not in scope now. |
| T-02-06-02 | Denial of Service | A hook prints to stdout, corrupting Claude Code's hook-protocol frame | mitigate | All 4 hook stubs contain `process.exit(0)` and no `console.*` calls. Test asserts stdout is empty for each. |
| T-02-06-03 | Information Disclosure | A workflow body accidentally embeds a literal API key example | mitigate | Workflow stubs in this plan contain no secrets. Code review + CONTRIBUTING.md "Tier contract" section (02-08) reminds authors not to add them. ARCH-03 vocabulary check rejects unknown tokens. |
| T-02-06-04 | Spoofing | A workflow filename is added that doesn't have a matching dispatcher verb, allowing a "ghost" verb in Tier 1 only | mitigate | `tests/workflows-keyequal.test.ts` (this plan) + `tests/cli-verbs.test.ts` preflight (02-05) both assert bijection. Either failing blocks merge. |
| T-02-06-05 | Repudiation | The manifest validator passes silently with empty workflows/ or missing hooks.json | mitigate | The validator explicitly asserts presence + count + per-file `<capability_check>` + hooks.json parses with exactly 4 events. The unit test `tests/workflows-keyequal.test.ts` covers the workflow assertions independently; `tests/hooks-noop.test.ts` covers hooks.json. |
| T-02-06-06 | Tampering | A hook is removed from `hooks.json` but its `.ts` file remains, hiding behavior from the validator | mitigate | The manifest asserts the exact 4-event set; deletion of an event from `hooks.json` causes the events-equality check to fail. |
| T-02-06-07 | Information Disclosure | A workflow uses an undeclared capability token, hiding a runtime dependency from the doctor + tier-contract surface | mitigate | ARCH-03 W4 vocabulary test rejects any token outside the closed set. Adding a new capability requires explicit vocabulary update. |

Security domain: V4 Access Control (D-19 read-only applies to manifest validator too; it reads but never writes), V5 Input Validation (workflow markdown is data, not exec — no interpolation in CLI help output; hooks.json parsed defensively).
</threat_model>

<verification>
After all three tasks:

1. `ls workflows/*.md | wc -l` returns 16.
2. `ls hooks/*.ts | wc -l` returns 4.
3. `test -f hooks/hooks.json` succeeds.
4. `node scripts/validate-plugin-manifest.cjs` exits 0.
5. `node scripts/run-tests.mjs tests/hooks-noop.test.ts tests/workflows-keyequal.test.ts` — all green.
6. `npm run validate:manifests` passes.
7. `npm run lint` + `npm run typecheck` pass.
8. The workflow-key-equal preflight in `tests/cli-verbs.test.ts` (from 02-05) now actually fires (not skipped) and passes.
9. **W4 vocabulary check** in `tests/workflows-keyequal.test.ts` passes — no workflow uses a token outside `{Task, AskUserQuestion, MCP <name>, Pandoc, Zotero MCP, humanizer skill, (none required)}`.
</verification>

<success_criteria>
- TIER-03: 4 hooks (session-start, pre-compact, post-tool-use, stop) + hooks/hooks.json manifest declares them; validator parses + asserts.
- TIER-07: hooks/ + workflows/ scaffolding present, manifest validator asserts it.
- ARCH-01 / UX-02: 16 workflow markdown bodies (canonical UX-02 verb list) shared between both tiers (Tier 1 reads as prompt, Tier 2 prints as help).
- ARCH-03: every workflow body has a `<capability_check>` block; every `required:` token belongs to the closed W4 vocabulary.
- Workflow filenames ↔ dispatcher subCommand keys are bijective (preflight passes).
- 4 lifecycle hooks ship as no-op exit-0 stubs with empty stdout.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-06-SUMMARY.md`.
</output>
