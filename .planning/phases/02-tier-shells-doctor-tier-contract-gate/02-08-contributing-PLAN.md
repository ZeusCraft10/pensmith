---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 08
type: execute
wave: 4
depends_on: ["02-00", "02-07"]
files_modified:
  - CONTRIBUTING.md
  - tests/repo-files.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "CONTRIBUTING.md has a 'Tier contract — do not skip' section (D-24) with the locked headings"
    - "Locked headings list all three Wave 1 lint chokepoints + the tier-contract test + branch protection"
    - "tests/repo-files.test.ts asserts the section exists and matches the locked structure"
  artifacts:
    - path: "CONTRIBUTING.md"
      provides: "Documented tier contract — do-not-skip prose (layer 4 of D-23 hard merge gate)"
    - path: "tests/repo-files.test.ts"
      provides: "Extended to assert the Tier contract section"
  key_links:
    - from: "CONTRIBUTING.md § Tier contract"
      to: ".github/workflows/ci.yml (the 4 gate-enforcing steps)"
      via: "section names the steps that block merge"
      pattern: "test:tier-contract|validate-plugin-manifest|D-23"
    - from: "tests/repo-files.test.ts"
      to: "CONTRIBUTING.md content"
      via: "regex match on locked headings"
      pattern: "Tier contract — do not skip"
---

<objective>
Land the fourth and final layer of D-23's hard merge gate: the prose that tells future
contributors (human + AI agents) why the tier-contract test exists, what gates exist,
and which specific footguns the lint chokepoints from Wave 1 catch.

Per D-24 (locked): `CONTRIBUTING.md` MUST have a "Tier contract — do not skip" section
whose CONTENT is locked — the headings and the four gate layers are not subject to
"clean-up edits". The test in Task 2 ensures drift gets caught at PR-review time.

This plan is intentionally tiny — it's prose, not code, and it ships in Wave 4 after the
tier-contract gate is live so the section can reference real-and-running mechanisms,
not aspirational ones.

Output: a documented contract that any future contributor (or AI agent in execute-plan)
reads BEFORE writing code that touches `mcp/`, `bin/cli/`, or the workflow/hook
scaffolding. Plus a repo-files test that prevents the section from being deleted or
weakened.
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
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-07-tier-contract-PLAN.md
@CONTRIBUTING.md

<interfaces>
<!-- The four layers of D-23's hard merge gate (each must be named in the section): -->

1. **CI step** (`.github/workflows/ci.yml` runs `npm run test:tier-contract` on 3 OSes) — landed in 02-07.
2. **Branch protection** (configured in the GitHub repo settings — instructions in this section).
3. **Preflight** (`scripts/validate-plugin-manifest.cjs` asserts hooks/, workflows/, mcp/, dist/mcp/server.js) — landed in 02-06.
4. **Prose** (this section in CONTRIBUTING.md) — landed by this plan.

<!-- The four Wave 1 lint chokepoints to enumerate (each must be named): -->

- D-09 thin-shim (`tests/lint-thin-shim.test.ts`) — mcp/ tool handlers ≤30 stmts, no fs.
- D-10 mcp-no-network (`tests/lint-mcp-no-network.test.ts`) — mcp/ runs over stdio only.
- D-12 capabilities-no-leak (`tests/lint-capabilities-noleak.test.ts`) — capabilities flags only.

<!-- The "do not skip" discipline rule (D-21) — must be named in plain English: -->

When a tier-contract assertion fails, the default fix is to BUILD the tier that's lying
(make tiers agree). It is NOT to: (a) add a runtime normalizer that papers over the
divergence, (b) loosen the assertion, or (c) skip the test.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend CONTRIBUTING.md with "Tier contract — do not skip" section</name>
  <files>CONTRIBUTING.md</files>
  <read_first>
    - `CONTRIBUTING.md` in full (current 18 lines)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-23 (four layers) + D-24 (locked content) + D-21 (discipline rule)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md` § CF-D24 (test row)
    - `.github/workflows/ci.yml` after 02-07 (so the section can quote real step names)
  </read_first>
  <action>
    Append a new section to `CONTRIBUTING.md` AFTER the "Quick checklist" section.
    Do NOT modify the existing Phase 0 chokepoints section (the HTTP / DOI rules
    landed earlier and are still in force).

    The section MUST have this exact top-level heading text — the test in Task 2
    will grep for it:

    `## Tier contract — do not skip`

    And it MUST contain these locked sub-headings (the test will assert each):

    - `### What the tier contract guarantees`
    - `### The four merge-gate layers`
    - `### Wave 1 lint chokepoints (the file you're not allowed to write)`
    - `### Discipline rule: fix the tiers, don't write a normalizer`

    Required body (insert verbatim — D-24 locks the content):

    ```markdown

    ## Tier contract — do not skip

    Pensmith ships as a Claude Code plugin (Tier 1: MCP server `dist/mcp/server.js`) AND
    as a portable Node CLI (Tier 2: `dist/bin/pensmith.js`). The two tiers MUST expose
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
    - `state.update` is idempotent: applying the same patch twice produces byte-identical
      state. Asserted by `tests/tier-contract.test.ts` Case C.

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

    3. **Preflight (layer 3):** `node scripts/validate-plugin-manifest.cjs` asserts
       presence of `hooks/`, `workflows/` (exactly 17 .md files with `<capability_check>`
       blocks per ARCH-03), `dist/mcp/server.js`, and the `.claude-plugin/*.json` shapes.
       Runs in CI after `npm test`.

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
      computed `process.env[<expr>]` reads and no inline calls to
      `getProviderApiKey()` / `getOpenAlexApiKey()` / `loadRuntimeConfig()` inside
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
    ```

    Notes for executor:
    - The section's content above is LOCKED by D-24. Re-read D-24 in
      `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md`
      before editing. If D-24 specifies different headings, those win — copy
      D-24's headings verbatim.
    - After insertion, ensure the file ends with a single trailing newline.
    - `npm run lint` does not lint `.md` files, so no lint regression to watch for.

    Self-check:
    - `grep -c "## Tier contract — do not skip" CONTRIBUTING.md` returns 1.
    - `grep -c "### What the tier contract guarantees" CONTRIBUTING.md` returns 1.
    - `grep -c "### The four merge-gate layers" CONTRIBUTING.md` returns 1.
    - `grep -c "### Wave 1 lint chokepoints" CONTRIBUTING.md` returns 1.
    - `grep -c "### Discipline rule" CONTRIBUTING.md` returns 1.
    - `grep -c "D-09\|D-10\|D-12\|D-21\|D-22\|D-23\|D-24" CONTRIBUTING.md` returns at least 5.
    - `grep -c "test:tier-contract" CONTRIBUTING.md` returns at least 1.
    - The Phase 0 chokepoints section (lines 5-12 of the original file) is preserved
      verbatim.
  </action>
  <verify>
    <automated>node -e "const c=require('node:fs').readFileSync('CONTRIBUTING.md','utf8'); const required=['## Tier contract — do not skip','### What the tier contract guarantees','### The four merge-gate layers','### Wave 1 lint chokepoints','### Discipline rule','test:tier-contract','D-09','D-10','D-12','StdioServerTransport','paper://capabilities']; const missing=required.filter(h=>!c.includes(h)); if(missing.length){console.error('missing required headings/keywords:',missing);process.exit(1)} if(!/Architectural chokepoints \(Phase 0\+\)/.test(c)){console.error('Phase 0 section deleted');process.exit(1)} console.log('OK')"</automated>
    <!-- Note: a typo in </automated> would break this; the executor MUST use </automated> -->
  </verify>
  <acceptance_criteria>
    - `CONTRIBUTING.md` contains the locked H2 `## Tier contract — do not skip`.
    - All four locked H3 headings exist verbatim.
    - The Phase 0 chokepoints section (HTTP imports, DOI regex) is preserved unchanged.
    - The section names all four merge-gate layers and all three Wave 1 lint chokepoints.
    - The section names the discipline rule (D-21) and lists acceptable vs. unacceptable fixes.
    - `grep -c "D-09\|D-10\|D-12" CONTRIBUTING.md` returns at least 3.
  </acceptance_criteria>
  <done>
    D-23 layer 4 (prose) shipped. The full hard-merge gate is now in place.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend tests/repo-files.test.ts to assert the Tier contract section</name>
  <files>tests/repo-files.test.ts</files>
  <read_first>
    - `tests/repo-files.test.ts` in full (current shape — what the file already asserts, what helpers exist)
    - `CONTRIBUTING.md` after Task 1 (the locked section that the new assertion grabs)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md` § Carry-forward CF-D24
  </read_first>
  <behavior>
    Append a single test to `tests/repo-files.test.ts`:

    `CF-D24: CONTRIBUTING.md has Tier contract — do not skip section with locked headings`

    Asserts the same set of substrings the self-check in Task 1 looked for —
    just in a test that runs in CI. If a future contributor accidentally deletes
    the section (cleanup PR, doc reformatting, AI assistant "tidying up"),
    this test catches it before merge.

    Note: 02-00 already added a related assertion (`references/doctor-output.md`
    present + `hooks/` directory exists). This task is an ADDITIVE extension
    — don't replace the 02-00 assertions, just add the new one alongside them.
  </behavior>
  <action>
    Append the following test to `tests/repo-files.test.ts` (after the 02-00
    additions, before any closing block). Match the style of existing tests in
    the file:

    ```typescript
    test('CF-D24: CONTRIBUTING.md has Tier contract — do not skip section with locked headings', () => {
      const src = readFileSync('CONTRIBUTING.md', 'utf8');
      const required = [
        '## Tier contract — do not skip',
        '### What the tier contract guarantees',
        '### The four merge-gate layers',
        '### Wave 1 lint chokepoints',
        '### Discipline rule',
      ];
      for (const heading of required) {
        assert.ok(
          src.includes(heading),
          `CONTRIBUTING.md missing locked heading: "${heading}". This section is D-24-locked; do not delete.`,
        );
      }
      // Each Wave 1 chokepoint must be named:
      assert.match(src, /D-09.*thin-shim/s, 'D-09 thin-shim must be named');
      assert.match(src, /D-10.*mcp-no-network|mcp-no-network.*D-10/s, 'D-10 mcp-no-network must be named');
      assert.match(src, /D-12.*capabilities-no-leak|capabilities-no-leak.*D-12/s, 'D-12 capabilities-no-leak must be named');
      // The four merge-gate layers must be named:
      assert.match(src, /CI step/, 'merge-gate layer 1 (CI step) must be named');
      assert.match(src, /branch protection/i, 'merge-gate layer 2 (branch protection) must be named');
      assert.match(src, /preflight|validate-plugin-manifest/i, 'merge-gate layer 3 (preflight) must be named');
      assert.match(src, /prose|this section/i, 'merge-gate layer 4 (prose) must be named');
      // Phase 0 chokepoints section preserved:
      assert.match(src, /Architectural chokepoints \(Phase 0\+\)/, 'Phase 0 chokepoints section must be preserved');
    });
    ```

    Notes:
    - If `readFileSync` / `assert` / `test` are already imported at the top of
      `tests/repo-files.test.ts`, reuse those imports — do NOT add duplicate
      import statements.
    - If the file already runs all tests via a single `describe(...)` block,
      add this test inside that block.

    Self-check:
    - `grep -c "CF-D24\|Tier contract — do not skip" tests/repo-files.test.ts` returns at least 1.
    - `node scripts/run-tests.mjs tests/repo-files.test.ts` exits 0 with Task 1 landed.
    - Temporarily strip the section header from CONTRIBUTING.md → re-run → test fails with the heading name in the error message (mental check; do NOT actually strip).
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/repo-files.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/repo-files.test.ts` contains a `CF-D24` test asserting the Tier contract section.
    - All 5 locked headings + the 3 Wave 1 chokepoint references + the 4 merge-gate layer references + the Phase 0 section preservation are all asserted.
    - The test passes after Task 1.
    - 02-00's existing assertions (references/doctor-output.md present, hooks/ directory exists) are still in the file and still pass.
  </acceptance_criteria>
  <done>
    The locked CONTRIBUTING.md section is now protected by a test. Phase 2 is closed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Future contributor (human or AI) → CONTRIBUTING.md | Markdown is data, not exec; only risk is content drift (section deleted, headings reworded) |
| tests/repo-files.test.ts → CONTRIBUTING.md content | Read-only assertion via `readFileSync` + `includes` / regex match |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-08-01 | Tampering | A "tidy-up" PR rewords the Tier contract section, weakening the discipline rule | mitigate | The CF-D24 test in this plan asserts the locked heading text verbatim. PR review + the test together catch reformatting drift. |
| T-02-08-02 | Repudiation | A contributor argues the section is "outdated" and asks to remove it without updating D-24 | accept | This is a process concern, not a code concern. The decision-lock D-24 + the CF-D24 test together make the section's status explicit; a deliberate removal requires a corresponding D-decision update in CONTEXT.md. |
| T-02-08-03 | Information Disclosure | CONTRIBUTING.md leaks security-sensitive details about the threat model | accept | The section names ASVS categories and chokepoint IDs but does not include any secrets, host paths, or exploitable details. Standard open-source security practice. |

Security domain: V14 Configuration (D-12 documentation symmetry — the prose tells contributors WHY the chokepoints exist, reducing the temptation to disable them).
</threat_model>

<verification>
After both tasks:

1. `grep -c "Tier contract — do not skip" CONTRIBUTING.md` returns 1.
2. `grep -c "D-09\|D-10\|D-12" CONTRIBUTING.md` returns at least 3.
3. `node scripts/run-tests.mjs tests/repo-files.test.ts` exits 0.
4. `npm run check` exits 0 (full chain: lint + typecheck + build + tier-contract + test + validate-manifests).
5. The Phase 0 "Architectural chokepoints" section (HTTP + DOI) is preserved unchanged.
</verification>

<success_criteria>
- D-24: CONTRIBUTING.md has the locked "Tier contract — do not skip" section.
- D-23 layer 4 (prose): live and named.
- CF-D24 test guards the section against drift / accidental deletion.
- Phase 2 closed — all 16 requirement IDs (ARCH-01, ARCH-03, ARCH-18, TIER-01..07, DOCT-01..06) addressed across the 9-plan set; all 24 D-decisions honored.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-08-SUMMARY.md`.
Phase 2 closes here — next phase (Phase 3) opens with `/gsd-discuss-phase 3`.
</output>
