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
  - workflows/doctor.md
  - workflows/intake.md
  - workflows/research.md
  - workflows/outline.md
  - workflows/plan.md
  - workflows/write.md
  - workflows/verify.md
  - workflows/compile.md
  - workflows/export.md
  - workflows/library.md
  - workflows/citations.md
  - workflows/humanize.md
  - workflows/gpt-zero.md
  - workflows/plagiarism.md
  - workflows/status.md
  - workflows/resume.md
  - workflows/help-paper.md
  - scripts/validate-plugin-manifest.cjs
  - tests/workflows-keyequal.test.ts
  - tests/hooks-noop.test.ts
autonomous: true
requirements: [TIER-07, ARCH-01, ARCH-03]
must_haves:
  truths:
    - "17 workflow markdown files exist under `workflows/`, one per dispatcher verb"
    - "Each workflow body contains a `<capability_check>` block (ARCH-03)"
    - "3 Claude Code lifecycle hooks exist as no-op stubs that exit 0"
    - "scripts/validate-plugin-manifest.cjs asserts presence of hooks/ + workflows/ (TIER-07)"
    - "workflow filenames ↔ dispatcher subCommand keys are bijective (preflight from 02-05 passes)"
  artifacts:
    - path: "workflows/"
      provides: "17 markdown bodies — shared source-of-truth between Tier 1 (plugin) and Tier 2 (CLI)"
    - path: "hooks/session-start.ts"
      provides: "SessionStart hook stub (exit 0, no side effects)"
    - path: "hooks/pre-compact.ts"
      provides: "PreCompact hook stub"
    - path: "hooks/post-tool-use.ts"
      provides: "PostToolUse hook stub"
    - path: "scripts/validate-plugin-manifest.cjs"
      provides: "Manifest validator EXTENDED to assert hooks/ + workflows/ presence"
  key_links:
    - from: "workflows/<verb>.md"
      to: "bin/cli/pensmith.ts subCommands.<verb>"
      via: "filename equality (workflow-key-equal preflight in tests/cli-verbs.test.ts from 02-05)"
      pattern: "workflows/[a-z-]+\\.md"
    - from: "scripts/validate-plugin-manifest.cjs"
      to: "hooks/ + workflows/ directories"
      via: "fs.existsSync presence assertion"
      pattern: "hooks|workflows"
---

<objective>
Land the plugin shell — 3 lifecycle hooks (no-ops) + 17 workflow markdown bodies + an
extension to `scripts/validate-plugin-manifest.cjs` that asserts the new scaffolding.

Per ARCH-01: workflows are markdown shared by BOTH tiers. The plugin Tier (Tier 1) reads
them as agent prompts; the CLI Tier (Tier 2) prints them via `pensmith help <verb>` and
uses the `<capability_check>` block to degrade behavior when running outside Claude Code.

Per ARCH-03: every workflow body MUST contain a `<capability_check>` block declaring
which tools (Task / MCP / AskUserQuestion) it needs and how to degrade if absent.

Per TIER-07: plugin shell + hooks scaffolding is present and the manifest validator
asserts it. `npm run validate:manifests` fails if any required file is missing.

Per CLAUDE.md / PRD §14: workflows are the load-bearing two-tier source-of-truth. If
they diverge, the tier contract test (02-07) fails.

Output: 17 workflow stubs + 3 hook stubs + an extended manifest validator. After this
plan + 02-05, the workflow-key-equal preflight in `tests/cli-verbs.test.ts` flips
from "skipped" to "asserted".
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

```markdown
<capability_check>
required:
  - Task            # spawn subagents (Tier 1 only)
  - AskUserQuestion # Claude Code UI prompt (Tier 1 only)
  - mcp__pensmith__state.read

degrade_if_missing:
  - if no Task: run sequentially (slower)
  - if no AskUserQuestion: read response from stdin (Tier 2 fallback)
  - if no mcp tools: read .paper/STATE.json directly (Tier 2 fallback)
</capability_check>
```

<!-- 17 workflow files, matched 1:1 with dispatcher verbs from 02-05 / D-14: -->

```
workflows/
  doctor.md
  intake.md       research.md     outline.md
  plan.md         write.md        verify.md
  compile.md      export.md       library.md
  citations.md    humanize.md     gpt-zero.md
  plagiarism.md   status.md       resume.md
  help-paper.md
```

<!-- Hook lifecycle (gsd-plugin pattern, cloned ref): -->

- SessionStart: fires when Claude Code opens a session in this repo.
- PreCompact: fires before context compaction.
- PostToolUse: fires after every tool call.

All three ship as no-op stubs in Phase 2; Phase 3+ wires real behavior.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create 3 hook stubs under hooks/ (no-op exit 0)</name>
  <files>hooks/session-start.ts, hooks/pre-compact.ts, hooks/post-tool-use.ts, tests/hooks-noop.test.ts</files>
  <read_first>
    - `.claude-plugin/plugin.json` (existing — declares which hooks it registers; verify hook names match)
    - `/tmp/refs/gsd-plugin/hooks/*` if available (the reference hook scaffold style — minimal, exits 0, prints nothing on stdout)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` (TIER-07 lock)
  </read_first>
  <action>
    Create three TypeScript files under `hooks/`. Each is a single-purpose entrypoint
    that Claude Code spawns; exits 0 on completion; emits NOTHING on stdout (would
    corrupt the hook-protocol frame, same family of bug as Pitfall 7).

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

    **`tests/hooks-noop.test.ts`:**

    ```typescript
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { existsSync } from 'node:fs';

    const HOOKS = ['hooks/session-start.ts', 'hooks/pre-compact.ts', 'hooks/post-tool-use.ts'];

    for (const hook of HOOKS) {
      test(`TIER-07: ${hook} exists and exits 0`, () => {
        assert.ok(existsSync(hook), `${hook} missing`);
        // Hooks run under Node via tsx. Execute via tsx to avoid build coupling.
        const out = execFileSync(process.execPath, [
          '--import', 'tsx', hook,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        // Must produce no stdout (would corrupt hook-protocol frame).
        assert.equal(out, '', `${hook} stdout MUST be empty, got: ${out}`);
      });
    }
    ```

    NOTE on `--import tsx`: This is the Node 20+ flag. If it fails on the dev
    box, fall back to spawning `npx tsx <hook>`. Match whichever idiom Phase 0
    `tests/repo-files.test.ts` already uses for invoking TS files — DO NOT
    introduce a new pattern.

    Self-check:
    - `ls hooks/` shows the three files.
    - `grep -c "console\." hooks/` returns 0.
    - `grep -c "process.exit(0)" hooks/` returns 3.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/hooks-noop.test.ts &amp;&amp; node -e "const fs=require('node:fs'); for(const h of ['hooks/session-start.ts','hooks/pre-compact.ts','hooks/post-tool-use.ts']){if(!fs.existsSync(h)){console.error('missing',h);process.exit(1)} const c=fs.readFileSync(h,'utf8'); if(/console\./.test(c)){console.error('console.* in',h);process.exit(1)} if(!/process\.exit\(0\)/.test(c)){console.error('missing exit 0 in',h);process.exit(1)}} console.log('OK')"</automated>
  </verify>
  <acceptance_criteria>
    - `hooks/session-start.ts`, `hooks/pre-compact.ts`, `hooks/post-tool-use.ts` all exist.
    - Each file calls `process.exit(0)` and contains no `console.*` references.
    - Each hook executes without printing to stdout.
    - `tests/hooks-noop.test.ts` exists and all 3 hook tests pass.
  </acceptance_criteria>
  <done>
    Hooks scaffold landed. Task 3 wires the manifest validator to assert hooks/ exists.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create 17 workflow markdown stubs under workflows/</name>
  <files>workflows/doctor.md, workflows/intake.md, workflows/research.md, workflows/outline.md, workflows/plan.md, workflows/write.md, workflows/verify.md, workflows/compile.md, workflows/export.md, workflows/library.md, workflows/citations.md, workflows/humanize.md, workflows/gpt-zero.md, workflows/plagiarism.md, workflows/status.md, workflows/resume.md, workflows/help-paper.md, tests/workflows-keyequal.test.ts</files>
  <read_first>
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-14 (the verb list) + ARCH-01 / ARCH-03
    - `/tmp/refs/gsd-plugin/workflows/*.md` if available (capability_check block style)
    - `bin/cli/pensmith.ts` once 02-05 lands (subCommand keys MUST equal these filenames)
    - PRD §14 (workflow markdown two-tier shape)
  </read_first>
  <action>
    Create one markdown file per dispatcher verb. Each file follows the same
    skeleton (ARCH-03 + ARCH-01). The body sections (Overview, Steps, Outputs)
    can be one-liners — Phase 2 ships stubs, Phase 3+ fills them.

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

    **Per-verb body** (use these EXACT `{description}` strings — they are the
    user-facing one-liners and become the citty `description` field if a later
    phase syncs them):

    | verb | description | required_tools | degrade |
    |------|-------------|----------------|---------|
    | doctor | Run ecosystem self-check. | none | none — works in both tiers |
    | intake | Capture initial paper requirements from the user. | AskUserQuestion | read from stdin in Tier 2 |
    | research | Survey existing literature for the paper topic. | Task, MCP library tools | sequential, single-process |
    | outline | Generate / refine the paper outline. | AskUserQuestion | read from stdin |
    | plan | Plan one section's content + sources. | MCP state.read, MCP library.read | direct file reads |
    | write | Draft one section. | MCP state.update | direct file writes |
    | verify | Verify citations + claims in one section. | Task, MCP tools | sequential, slower |
    | compile | Assemble all section drafts into a single document. | MCP state.read | direct file reads |
    | export | Export the compiled paper (DOCX/PDF/MD, no metadata trace). | none | works in both tiers |
    | library | Manage citation library (add / remove / verify). | MCP library.read, MCP state.update | direct file ops |
    | citations | Audit citation integrity (DOI, fuzzy-match, quote-check). | MCP library.read | direct file reads |
    | humanize | Pass section drafts through the humanizer skill. | none | works in both tiers |
    | gpt-zero | Run GPTZero on a section / compiled paper (transparency only). | none | works in both tiers |
    | plagiarism | Free distinctive-phrase plagiarism check. | none | works in both tiers |
    | status | Report current paper state + per-section progress. | MCP state.read | direct file reads |
    | resume | Resume an interrupted workflow. | MCP state.read | direct file reads |
    | help-paper | Print pensmith help (verb list + brief usage). | none | works in both tiers |

    For each verb, render the skeleton with the row's values. Format
    `required_tools` as bullet list (each item on its own line prefixed with
    `  - `); if "none", write `  - (none required)`. Format `degrade_steps`
    likewise; if "works in both tiers", write `  - (no degradation needed)`.

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

    Example — `workflows/plan.md`:

    ```markdown
    # pensmith plan

    > Plan one section's content + sources.

    <capability_check>
    required:
      - MCP state.read
      - MCP library.read

    degrade_if_missing:
      - direct file reads
    </capability_check>

    ## Overview

    (Phase 2 stub — Phase 3+ fills this in.)

    ## Steps

    1. (stub)

    ## Outputs

    - (stub)
    ```

    **`tests/workflows-keyequal.test.ts`** (ARCH-01 + workflow-key-equal):

    ```typescript
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readdirSync, readFileSync, existsSync } from 'node:fs';

    const EXPECTED_17 = [
      'doctor', 'intake', 'research', 'outline', 'plan', 'write', 'verify',
      'compile', 'export', 'library', 'citations', 'humanize', 'gpt-zero',
      'plagiarism', 'status', 'resume', 'help-paper',
    ].sort();

    test('ARCH-01: workflows/ contains exactly 17 markdown bodies', () => {
      assert.ok(existsSync('workflows'), 'workflows/ directory missing');
      const files = readdirSync('workflows').filter((f) => f.endsWith('.md')).sort();
      assert.deepEqual(
        files.map((f) => f.replace(/\.md$/, '')),
        EXPECTED_17,
        `workflows/ files must equal D-14 verb list`,
      );
    });

    test('ARCH-03: every workflow body has a <capability_check> block', () => {
      for (const verb of EXPECTED_17) {
        const src = readFileSync(`workflows/${verb}.md`, 'utf8');
        assert.match(src, /<capability_check>[\s\S]+?<\/capability_check>/, `${verb}.md: missing <capability_check>`);
        assert.match(src, /required:\s*\n/, `${verb}.md: <capability_check> must have a required: list`);
        assert.match(src, /degrade_if_missing:\s*\n/, `${verb}.md: <capability_check> must have a degrade_if_missing: list`);
      }
    });

    test('ARCH-01: workflow filenames are bijective with dispatcher verbs', () => {
      const dispatcherSrc = readFileSync('bin/cli/pensmith.ts', 'utf8');
      const fileVerbs = readdirSync('workflows').filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
      for (const v of fileVerbs) {
        const re = new RegExp(`['"]?${v.replace('-', '\\-')}['"]?:\\s*\\(\\)\\s*=>`);
        assert.ok(re.test(dispatcherSrc), `workflow ${v}.md has no matching subCommand`);
      }
    });
    ```

    Self-check:
    - `ls workflows/*.md | wc -l` returns 17.
    - `grep -L "<capability_check>" workflows/*.md` returns nothing (all files have the block).
    - `npm run lint` continues to pass (markdown is not linted by eslint).
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/workflows-keyequal.test.ts &amp;&amp; node -e "const fs=require('node:fs'); const expected=['doctor','intake','research','outline','plan','write','verify','compile','export','library','citations','humanize','gpt-zero','plagiarism','status','resume','help-paper'].sort(); const got=fs.readdirSync('workflows').filter(f=>f.endsWith('.md')).map(f=>f.replace(/\\.md$/,'')).sort(); if(JSON.stringify(got)!==JSON.stringify(expected)){console.error('mismatch:',got);process.exit(1)} for(const v of expected){const s=fs.readFileSync('workflows/'+v+'.md','utf8'); if(!/<capability_check>/.test(s)){console.error(v+'.md missing capability_check');process.exit(1)}} console.log('OK 17 workflows + capability_check')"</automated>
  </verify>
  <acceptance_criteria>
    - `workflows/` contains exactly 17 `.md` files matching the D-14 verb list.
    - Each file contains a `<capability_check>` block with both `required:` and `degrade_if_missing:` sub-lists (ARCH-03).
    - `tests/workflows-keyequal.test.ts` all 3 tests pass.
    - The workflow-key-equal preflight in `tests/cli-verbs.test.ts` (from 02-05) now actually fires and passes.
  </acceptance_criteria>
  <done>
    17 workflow bodies committed. Tier 1 (plugin) and Tier 2 (CLI) now share the same
    source-of-truth markdown set.
  </done>
</task>

<task type="auto">
  <name>Task 3: Extend scripts/validate-plugin-manifest.cjs to assert hooks/ + workflows/</name>
  <files>scripts/validate-plugin-manifest.cjs</files>
  <read_first>
    - `scripts/validate-plugin-manifest.cjs` in full (current 80-line shape)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md` TIER-07 row
    - The 3 hooks created in Task 1 and 17 workflow files created in Task 2
  </read_first>
  <action>
    Add a section to `scripts/validate-plugin-manifest.cjs` AFTER the existing
    `mcp` block and BEFORE the final `if (process.exitCode === 1)` check.
    The new section asserts:
    - `hooks/` directory exists.
    - Each of the 3 hook files exists.
    - `workflows/` directory exists.
    - Exactly 17 `.md` files live under `workflows/`.
    - Each `.md` file's body contains a `<capability_check>` substring.

    Required addition (insert after line 73, before the final `if`):

    ```javascript
    // TIER-07 (Phase 2): plugin shell + hooks + workflows scaffolding present.
    // ARCH-01: workflows are markdown shared by both tiers.
    // ARCH-03: every workflow body contains a <capability_check> block.

    const REQUIRED_HOOKS = ['session-start.ts', 'pre-compact.ts', 'post-tool-use.ts'];
    const EXPECTED_WORKFLOWS = [
      'doctor', 'intake', 'research', 'outline', 'plan', 'write', 'verify',
      'compile', 'export', 'library', 'citations', 'humanize', 'gpt-zero',
      'plagiarism', 'status', 'resume', 'help-paper',
    ];

    const hooksDir = path.join(root, 'hooks');
    if (!fs.existsSync(hooksDir)) {
      fail('hooks/ directory missing (TIER-07)');
    } else {
      for (const h of REQUIRED_HOOKS) {
        const hp = path.join(hooksDir, h);
        if (!fs.existsSync(hp)) fail(`hooks/${h} missing (TIER-07)`);
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
    - `grep -c "TIER-07" scripts/validate-plugin-manifest.cjs` returns at least 1.
    - `grep -c "ARCH-01\|ARCH-03" scripts/validate-plugin-manifest.cjs` returns at least 1.
  </action>
  <verify>
    <automated>node scripts/validate-plugin-manifest.cjs</automated>
  </verify>
  <acceptance_criteria>
    - `scripts/validate-plugin-manifest.cjs` includes assertions for hooks/ + workflows/ presence.
    - `node scripts/validate-plugin-manifest.cjs` exits 0 with Tasks 1 + 2 landed.
    - The validator references TIER-07, ARCH-01, ARCH-03 in its error messages.
    - `npm run validate:manifests` (the package script) continues to pass.
  </acceptance_criteria>
  <done>
    Manifest validator now enforces the plugin-shell contract. TIER-07 satisfied.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Claude Code lifecycle → hooks/*.ts | Hooks spawn under Node and inherit cwd; stdout is the hook-protocol channel (do NOT pollute) |
| workflow markdown body → agent prompt (Tier 1) | Markdown is read as instruction; future-phase content should treat user-supplied paperRoot as input data, not as an instruction |
| workflow markdown body → CLI help output (Tier 2) | Body is printed verbatim; no exec / interpolation |
| manifest validator → repo filesystem | Read-only — only `fs.existsSync` / `fs.readFileSync`; no writes |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-06-01 | Tampering | A hook stub is replaced with a malicious one that exfiltrates `.paper/` content via SessionStart | accept | Hooks live in the repo and are reviewed at PR time. Phase 3+ may add a hook-signature check; not in scope now. |
| T-02-06-02 | Denial of Service | A hook prints to stdout, corrupting Claude Code's hook-protocol frame | mitigate | All 3 hook stubs contain `process.exit(0)` and no `console.*` calls. Test asserts stdout is empty. |
| T-02-06-03 | Information Disclosure | A workflow body accidentally embeds a literal API key example | mitigate | Workflow stubs in this plan contain no secrets. Code review + CONTRIBUTING.md "Tier contract" section (02-08) reminds authors not to add them. |
| T-02-06-04 | Spoofing | A workflow filename is added that doesn't have a matching dispatcher verb, allowing a "ghost" verb in Tier 1 only | mitigate | `tests/workflows-keyequal.test.ts` (this plan) + `tests/cli-verbs.test.ts` preflight (02-05) both assert bijection. Either failing blocks merge. |
| T-02-06-05 | Repudiation | The manifest validator passes silently with empty workflows/ | mitigate | The validator explicitly asserts presence + count + per-file `<capability_check>`. The unit test `tests/workflows-keyequal.test.ts` covers the same assertions independently. |

Security domain: V4 Access Control (D-19 read-only applies to manifest validator too; it reads but never writes), V5 Input Validation (workflow markdown is data, not exec — no interpolation in CLI help output).
</threat_model>

<verification>
After all three tasks:

1. `ls workflows/*.md | wc -l` returns 17.
2. `ls hooks/*.ts | wc -l` returns 3.
3. `node scripts/validate-plugin-manifest.cjs` exits 0.
4. `node scripts/run-tests.mjs tests/hooks-noop.test.ts tests/workflows-keyequal.test.ts` — all green.
5. `npm run validate:manifests` passes.
6. `npm run lint` + `npm run typecheck` pass.
7. The workflow-key-equal preflight in `tests/cli-verbs.test.ts` (from 02-05) now actually fires (not skipped) and passes.
</verification>

<success_criteria>
- TIER-07: hooks/ + workflows/ scaffolding present, manifest validator asserts it.
- ARCH-01: 17 workflow markdown bodies shared between both tiers (Tier 1 reads as prompt, Tier 2 prints as help).
- ARCH-03: every workflow body has a `<capability_check>` block.
- Workflow filenames ↔ dispatcher subCommand keys are bijective (preflight passes).
- 3 lifecycle hooks ship as no-op exit-0 stubs with empty stdout.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-06-SUMMARY.md`.
</output>
