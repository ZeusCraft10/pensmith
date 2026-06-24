# Phase 16: CI/DX parity + docs & packaging — Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 12 (new/modified files across 6 requirements)
**Analogs found:** 12 / 12

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `package.json` (scripts.check + scripts rename + deps move) | config | transform | `package.json` itself (current state) | self-edit |
| `.github/workflows/ci.yml` (new steps) | config | request-response | `ci.yml` existing steps 40-56 | exact |
| `.c8rc.json` (new file) | config | transform | `package.json` scripts.coverage line | role-match |
| `tests/repo-files.test.ts` (assertion updates + new assertions) | test | request-response | `tests/repo-files.test.ts` existing tests (lines 45-65, 174-180) | exact |
| `README.md` (full rewrite) | documentation | — | `workflows/new.md` (§3 disclaimer prose) + existing README `## Style Match` section | role-match |
| `bin/cli/intake.ts` (add disclaimer print) | controller | request-response | `bin/cli/intake.ts` existing `process.stdout.write` calls (lines 253-258, 262-263) | exact |
| `workflows/new.md` (§3 disclaimer in Body) | documentation | — | `workflows/compile.md` Body section | role-match |
| `workflows/doctor.md` (fill stub body) | documentation | — | `workflows/compile.md` full body shape | exact |
| `workflows/status.md` (fill stub body) | documentation | — | `workflows/research.md` + `bin/cli/status.ts` | role-match |
| `workflows/next.md` (fill stub body) | documentation | — | `workflows/compile.md` body shape + `bin/lib/router.ts` | role-match |
| `workflows/resume.md` (fill stub body) | documentation | — | `workflows/compile.md` body shape + `bin/cli/resume.ts` | role-match |
| `bin/lib/doctor/probes/http-crossref-ping.ts` (stale copy refresh) | utility | request-response | same file (current state lines 26-36) | self-edit |
| `references/doctor-output.md` (http-crossref-ping section update + re-pin) | documentation | — | `references/doctor-output.md` lines 57-59 (http-crossref-ping section) | self-edit |
| `PRIVACY.md` (stale sentence replace) | documentation | — | `PRIVACY.md` itself (lines 1-3 — preserve) | self-edit |
| `bin/lib/http-mock.ts` (lazy nock import in loadCassettes + recordCassettes) | utility | file-I/O | `bin/lib/prompts.ts` lines 74-83 (dynamic await import pattern) + `bin/lib/pdf-text.ts` lines 179-181 | exact |

---

## Pattern Assignments

### `package.json` — CI-01 + CI-03 + DOCS-03 (config, transform)

**Analog:** `package.json` current state (self-edit)

**Current scripts block** (`package.json` lines 15-27):
```json
"scripts": {
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "node scripts/run-tests.mjs",
  "prebuild": "node scripts/prebuild.mjs",
  "build": "tsc",
  "dev": "tsx",
  "pensmith": "tsx bin/pensmith.ts",
  "validate:manifests": "node scripts/validate-plugin-manifest.cjs",
  "test:tier-contract": "node --import tsx --test tests/tier-contract/preflight.test.ts tests/tier-contract.test.ts",
  "test:cassettes": "node --import tsx --test tests/tier-contract.test.ts",
  "check": "npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests",
  "coverage": "c8 node scripts/run-tests.mjs"
}
```

**CI-01 fix — prepend `npm run prebuild &&` to `check`:**
```json
"check": "npm run prebuild && npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests"
```

**CI-03 rename — rename `coverage` to `test:coverage`:**
```json
"test:coverage": "c8 node scripts/run-tests.mjs"
```
(Delete the `"coverage"` key; add `"test:coverage"`.)

**DOCS-03 dep move — nock from `dependencies` to `devDependencies`:**
```json
// dependencies (line 51): remove "nock": "^14"
// devDependencies (line 62+): add "nock": "^14"
```

---

### `.github/workflows/ci.yml` — CI-02 + CI-03 (config, request-response)

**Analog:** `ci.yml` existing step style (lines 40-56)

**Existing step shape to mirror** (`ci.yml` lines 40-56):
```yaml
      - name: Generate derived sources (prebuild — version.generated.ts + verbs.json)
        run: npm run prebuild

      - run: npm run lint

      - run: npx tsc --noEmit

      - name: Build (produces dist/mcp/server.js for manifest validation)
        run: npm run build

      - name: Tier contract (Tier 1 ↔ Tier 2 equivalence — D-23 layer 1)
        run: npm run test:tier-contract

      - run: npm test

      - name: Validate plugin manifests
        run: node scripts/validate-plugin-manifest.cjs
```

**CI-02 — append after "Validate plugin manifests" step:**
```yaml
      - name: Assert working tree is clean after build (stale-derived-file guard — CI-02)
        shell: bash
        run: |
          status=$(git status --porcelain)
          if [ -n "$status" ]; then
            echo "FAIL: build/prebuild produced untracked or modified files:"
            echo "$status"
            exit 1
          fi
          echo "OK: working tree is clean."
```

**CI-03 — replace existing `- run: npm test` step:**
```yaml
      - name: Test suite + coverage gate (non-TTY stdin — CI-03)
        shell: bash
        run: npm run test:coverage < /dev/null
```

Note: The `shell: bash` on the CI-03 step is required on all 3 OSes for the `< /dev/null` redirect to work. The existing "Verify macos runner is arm64" step (`ci.yml` lines 25-30) provides the precedent for `shell: bash` in matrix steps.

---

### `.c8rc.json` — CI-03 (config, transform) — NEW FILE

**Analog:** The existing `"coverage": "c8 node scripts/run-tests.mjs"` script (package.json line 27) shows c8 is already installed and invoked. The `.c8rc.json` externalizes the CLI flags into a config file for auditability.

**Full file content (new file in repo root):**
```json
{
  "reporter": ["text", "lcov"],
  "include": ["bin/**", "hooks/**", "mcp/**"],
  "exclude": ["tests/**", "scripts/**", "**/*.d.ts", "dist/**"],
  "all": true,
  "check-coverage": true,
  "lines": 85,
  "functions": 72,
  "branches": 82,
  "statements": 85
}
```

**Thresholds rationale:** Measured baseline 2026-06-24: lines 90.3 / functions 77.26 / branches 87.28 / statements 90.3. These thresholds are baseline minus 5 pp — a ratchet gate, not aspirational.

---

### `tests/repo-files.test.ts` — CI-01 + DOCS-01 + DOCS-03 (test, request-response)

**Analog:** Existing assertions in `tests/repo-files.test.ts`

**Existing pattern for structural script assertions** (lines 53-65):
```typescript
test('package.json contract', () => {
  const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
  // ...
  const scripts = pkg['scripts'] as Record<string, string> | undefined;
  for (const s of ['lint', 'typecheck', 'test', 'build', 'dev', 'validate:manifests', 'check']) {
    assert.ok(scripts && scripts[s], `package.json missing script: ${s}`);
  }
  assert.equal(scripts?.['test'], 'node scripts/run-tests.mjs',
    'scripts.test must invoke the portable runner (not a shell glob)');
  const dev = pkg['devDependencies'] as Record<string, string> | undefined;
  assert.ok(dev && !dev['eslint-plugin-import'],
    'eslint-plugin-import must NOT be a Phase 0 devDependency');
  const deps = pkg['dependencies'] as Record<string, string> | undefined;
  assert.ok(deps && deps['citty'], 'package.json must declare citty dependency');
});
```

**CI-01 assertion — add inside `'package.json contract'` test or new test:**
```typescript
// CI-01: check script must start with prebuild
assert.ok(
  scripts?.['check']?.startsWith('npm run prebuild'),
  'CI-01: scripts.check must start with "npm run prebuild" (local==CI ordering)'
);
```

**DOCS-01 assertions — add to `'README, PRIVACY, README-DEV, CONTRIBUTING stubs are correct'` test** (current lines 90-100):

REMOVE lines 91-92 entirely:
```typescript
// DELETE these two lines:
assert.match(read('README.md'), /v0\.1\.0 in development/);
assert.match(read('README.md'), /Phase 6/);
```

ADD new assertions for the real README content and rename the test:
```typescript
test('PRIVACY and README-DEV structure checks (README stubs removed — Phase 16 DOCS-01)', () => {
  // README DOCS-01 — real content assertions (replaces stale stub assertions)
  assert.match(read('README.md'), /pensmith is a structured research/i,
    'README must contain the PRD §3 disclaimer opening sentence');
  assert.match(read('README.md'), /not a guarantee against AI detectors/i,
    'README must contain the PRD §3 honest-framing sentence');
  assert.match(read('README.md'), /Get Shit Done/,
    'README must contain the PRD §18 GSD credit');
  // PRIVACY — substring assertions unchanged (lines 93-94)
  assert.match(read('PRIVACY.md'), /local-only/i);
  assert.match(read('PRIVACY.md'), /No telemetry/i);
  // README-DEV — unchanged (lines 95-96)
  assert.match(read('README-DEV.md'), /npm run build/);
  assert.match(read('README-DEV.md'), /dist\/mcp\/server\.js/);
  // CONTRIBUTING — unchanged (lines 97-99)
  const c = read('CONTRIBUTING.md');
  assert.match(c, /bin\/lib\/http\.ts/);
  assert.match(c, /bin\/lib\/doi\.ts/);
});
```

**DOCS-03 assertion — add inside `'package.json contract'` test:**
```typescript
// DOCS-03: nock must be in devDependencies, not dependencies
const deps = pkg['dependencies'] as Record<string, string> | undefined;
const dev = pkg['devDependencies'] as Record<string, string> | undefined;
assert.ok(!deps?.['nock'], 'DOCS-03: nock must NOT be in dependencies (it is test/dev-only)');
assert.ok(dev?.['nock'], 'DOCS-03: nock must be in devDependencies');
```

**WN-3 re-pin pattern** (lines 174-180) — the pattern to follow for doctor-output.md re-pin:
```typescript
test('references/doctor-output.md hash-pin (D-18)', () => {
  const bytes = readFileSync('references/doctor-output.md');  // raw bytes, no BOM strip
  const hash = createHash('sha256').update(bytes).digest('hex');
  // PINNED-HASH below: regenerate by running `node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/doctor-output.md')).digest('hex'))"`
  // after every intentional edit. The PR diff makes the change visible.
  const PINNED = '509f90add8664e559a3ab817684381777e1b624b63ebe0dfc77054267997eec0';
  assert.equal(hash, PINNED, `references/doctor-output.md drifted from locked copy. Update PINNED to ${hash} if the edit was intentional.`);
});
```
After editing `references/doctor-output.md`, recompute the hash and replace the `PINNED` string at line 179.

---

### `README.md` — DOCS-01 (documentation)

**Analog:** Existing `README.md` `## Style Match` section (lines 9-19, must be preserved verbatim); `workflows/new.md` for §3 disclaimer source; PRD §3 and §18 for verbatim text.

**Structure to follow (non-negotiable order per CONTEXT.md):**
1. Title + one-paragraph what-it-is
2. Install (plugin + CLI)
3. Quick start — `/pensmith` ONLY (non-negotiable per CLAUDE.md)
4. 16-verb power-user reference table
5. GSD credit (PRD §18 verbatim)
6. `## Style Match` section (EXISTING — MUST be preserved intact for STYL-04 test at line 112)
7. Disclaimer (PRD §3 verbatim)

**Existing `## Style Match` section** (lines 9-19 — preserve byte-for-byte):
```markdown
## Style Match

Style Match is an **opt-in** feature. When you point Pensmith at a folder of your own past writing (`--style-samples <dir>`), it builds a private, per-paper statistical profile of how you write — typical sentence length, vocabulary density, paragraph shape, common sentence openers — and uses it to help new sections **match your own established voice**.

It is dual-use, and we are direct about that. Here is what it does and does not do:

- It **improves prose so it reads like your own past writing**. The profile is built from plain statistics — no external model, no network call — and it stays inside your paper as `.paper/STYLE.json`.
- It **does not claim to make AI authorship invisible to detectors.** A separate honesty check reports an AI-likelihood score as transparency; Style Match does not change what that score means or promise any particular result.
- It is intended for **matching your own voice** — not for passing off someone else's work as your own. The samples you provide should be your own writing.

To keep this honest at the tool level, Pensmith surfaces a transparency notice whenever the same writing samples were already used to style a different paper. That notice always prints; it is not something a flag can silence.
```

**PRD §3 disclaimer verbatim (from RESEARCH.md):**
```
pensmith is a structured research-and-drafting assistant for academic writing. It helps you turn an assignment prompt into a sourced outline or, optionally, a full draft, using only verifiable peer-reviewed and configurable academic sources. It includes a citation verifier that re-fetches every cited DOI and flags unsupported claims for human review, and a humanizer pass that improves readability.

This tool is for your own writing, research, and learning. It is not a guarantee against AI detectors and it is not a substitute for doing the reading. Submitting fully tool-generated work as your own is, in many institutions, a violation of academic integrity policy. You are responsible for the work you submit.
```

**PRD §18 GSD credit verbatim (from RESEARCH.md):**
```
pensmith is heavily inspired by [Get Shit Done](https://github.com/gsd-build/get-shit-done) by TÂCHES (Lex Christopherson) and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging by Jasper Nuyens. The skill / agent / MCP / workflow-body / HANDOFF.json patterns are theirs, and the section-as-phase mental model is a direct application of GSD's structured-workflow philosophy to academic writing. Domain (academic writing instead of code), command UX (single-command vs. per-stage), and implementation are independent.
```

---

### `bin/cli/intake.ts` — DOCS-01 intake disclaimer (controller, request-response)

**Analog:** `bin/cli/intake.ts` existing `process.stdout.write` calls

**Existing stdout pattern** (lines 253-258, 262-263):
```typescript
process.stdout.write(
  `pensmith new: NOTICE — these writing samples were already used to style a prior paper: ${names}. ` +
    `Style Match mirrors your own voice; reuse across papers is surfaced here for transparency.\n`,
);
// ...
process.stdout.write(
  `pensmith new: wrote style profile to ${path.join(paperDir(cwd), 'STYLE.json')}\n`,
);
```

**Disclaimer print pattern — add near top of `run()` function, before first `ask()` or `complete()` call** (after line 326, inside `async run({ args }) {`):
```typescript
// DOCS-01: PRD §3 disclaimer — print at intake start so CLI-only users see it.
// Static copy — sourced verbatim from PRD §3 (non-negotiable per CLAUDE.md).
const DISCLAIMER = [
  'pensmith is a structured research-and-drafting assistant for academic writing.',
  'It helps you turn an assignment prompt into a sourced outline or, optionally, a full draft,',
  'using only verifiable peer-reviewed and configurable academic sources. It includes a citation',
  'verifier that re-fetches every cited DOI and flags unsupported claims for human review,',
  'and a humanizer pass that improves readability.',
  '',
  'This tool is for your own writing, research, and learning. It is not a guarantee against AI',
  'detectors and it is not a substitute for doing the reading. Submitting fully tool-generated',
  'work as your own is, in many institutions, a violation of academic integrity policy.',
  'You are responsible for the work you submit.',
].join('\n');
process.stdout.write(DISCLAIMER + '\n\n');
```

**Placement constraint:** BEFORE the first `ask()` call and before the `getProviderApiKey` probe block (which starts around line 407). The disclaimer is static — no await, no try/catch.

---

### `workflows/new.md` — DOCS-01 Body update (documentation)

**Analog:** `workflows/new.md` existing Body (lines 43-70 — add disclaimer as step 0)

**Pattern:** Insert as a new numbered step 1 before the existing "Read inputs" step (which becomes step 2):
```markdown
1. **Print §3 disclaimer** (DOCS-01): at the top of the run, before any prompts or model calls, print the PRD §3 dual-use disclaimer verbatim to stdout. This ensures CLI-only users who never read the README still see the disclosure. Static copy — no user input needed.
```

---

### `workflows/doctor.md` — DOCS-02 (documentation, fill stub)

**Analog:** `workflows/compile.md` for full body shape; `bin/cli/doctor.ts` for real behavior

**Full body shape from compile.md** (the template for all four stubs):
```markdown
# pensmith <verb>

> One-line description

<capability_check>
required:
  - <MCP tool or "(none required)">

degrade_if_missing:
  - if no <tool>: <Tier 2 fallback>
</capability_check>

## Overview

Short prose description.

## Outputs

Bullet list of files/state written.

## Body

Numbered steps.
```

**Real `doctor.ts` behavior** (lines 12-24):
```typescript
export const doctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Ecosystem self-check.' },
  args: {
    json: { type: 'boolean', description: 'Emit JSON instead of TTY output.' },
  },
  async run({ args }) {
    const results = await runDoctor();
    const output = args.json ? renderJson(results) : renderTty(results);
    process.stdout.write(output + '\n');
    const failed = Object.values(results).some((r) => r.severity === 'FAIL');
    if (failed) process.exit(1);
  },
});
```

**Real `probes.ts` probe list** (lines 40-53): nodeVersionProbe, mcpSdkPresenceProbe, zoteroMcpPresenceProbe, pandocPresenceProbe, humanizerSkillPresenceProbe, contactEmailPresenceProbe, syncFolderDetectionProbe, runtimeConfigPresenceProbe, buildArtifactResolvesProbe, httpCrossrefPingProbe, intakeOutlineVerifyWiringProbe.

**Filled `workflows/doctor.md` content to produce:**
```markdown
# pensmith doctor

> Run ecosystem self-check — 11 probes across runtime, MCP wiring, and ecosystem presence. Exits 1 on FAIL.

<capability_check>
required:
  - (none required)

degrade_if_missing:
  - (no degradation needed — doctor is read-only and requires no MCP tools)
</capability_check>

## Overview

`pensmith doctor` calls `runDoctor()` (`bin/lib/doctor/probes.ts`) which runs 11 probes
in parallel via `Promise.allSettled`. Results are rendered via `renderTty()` (human-first
prose, grouped by severity) or `renderJson()` (the `--json` flag, schema v1 per D-18).
Exits 0 if all probes are PASS/WARN/SKIP; exits 1 if any probe is FAIL (D-15).

Probe strings are sourced from `references/doctor-output.md` (locked — D-18). Any
wording change to that file must re-pin the SHA-256 hash in `tests/repo-files.test.ts:179`.
Probe is READ-ONLY (D-19): no `.paper/` writes, no locks, no atomicWriteFile.

## Outputs

- stdout: TTY prose table (default) or JSON `{ schemaVersion:1, probes:{...}, summary:{...} }` (--json)
- exit code 0 (all probes PASS/WARN/SKIP) or 1 (any probe FAIL)

## Body

1. **Run all 11 probes in parallel** via `runDoctor()` (`bin/lib/doctor/probes.ts`):
   - **DOCT-01 — runtime:** `node-version` (requires >=20.10.0), `mcp-sdk-presence` (dist/mcp/server.js non-empty)
   - **DOCT-02 — ecosystem:** `zotero-mcp-presence` (WARN if not in ~/.claude/.mcp.json), `pandoc-presence` (WARN if not on PATH), `humanizer-skill-presence` (WARN if missing at ~/.claude/skills/humanizer/)
   - **DOCT-03 — config:** `contact-email-presence` (WARN if PENSMITH_CONTACT_EMAIL unset)
   - **DOCT-04 — env:** `sync-folder-detection` (WARN if .paper/ inside OneDrive/iCloud/Dropbox/Google Drive)
   - **DOCT-05 — wiring:** `intake-outline-verify-wiring` (FAIL if any of the 6 Phase-3 verbs are unwired)
   - **DOCT-07 — runtime config:** `runtime-config-presence` (WARN if no provider API key set)
   - **D-03(d) — cassette:** `build-artifact-resolves` (dist/bin/pensmith.js + dist/mcp/server.js non-empty), `http-crossref-ping` (cassette-wiring smoke)

2. **Render output** based on the `--json` flag:
   - Default (TTY): `renderTty(results)` — human-first prose, severity emoji, probe summary + fix strings sourced from `references/doctor-output.md`.
   - `--json`: `renderJson(results)` — schema v1 JSON (D-18 shape: `{ schemaVersion:1, probes:{}, summary:{} }`). Tier-contract test (02-07 Case A) compares this output to the Tier-1 `paper://capabilities` resource.

3. **Exit**: 0 if no FAIL; `process.exit(1)` if any probe severity is FAIL (D-15). WARN and SKIP do not block exit 0.

4. **Shell fallback** (TIER-06): `pensmith doctor [--json]`.
```

---

### `workflows/status.md` — DOCS-02 (documentation, fill stub)

**Analog:** `workflows/compile.md` for shape; `bin/cli/status.ts` for real behavior

**Real `status.ts` behavior** (lines 24-86): loads STATE.json via `loadState()`, walks sections via `readSectionState()` (C6-HIGH guarded path — never raw parseFrontmatter), calls `resolveNextAction()`, prints per-section table + "next:" line. Read-only, stdout-only.

**Current stub to replace** (`workflows/status.md` lines 1-23):
```markdown
# pensmith status

> Report current paper state + per-section progress.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct read of .paper/STATE.json
</capability_check>

## Overview

(Phase 2 stub — Phase 3+ fills this in.)
...
```

**Filled `workflows/status.md` body pattern:**
```markdown
# pensmith status

> Report current paper state: per-section progress table + resolved next action.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct readFileSync('.paper/STATE.json') + direct readFileSync of each section PLAN.md
</capability_check>

## Overview

`pensmith status` is a read-only verb. It loads `.paper/STATE.json` via `loadState()`
(C4-HIGH: `StateNotFoundError` → prints "no active paper"; any other error → prints
"STATE.json unreadable/corrupt"). Then it walks each section via `readSectionState()`
(C6-HIGH guarded path — NEVER raw `parseFrontmatter(readFileSync(planPath))`). Finally
it calls `resolveNextAction()` (never throws — C3-HIGH-1 totality invariant) and prints
the "next:" line. stdout-only, no `.paper/` writes.

## Outputs

- stdout: per-section status table + `  next: <verb>` line
- exit code always 0 (status is diagnostic-only)

## Body

1. **Load STATE.json** via `loadState(paperRoot)` (`bin/lib/state.ts`). On `StateNotFoundError`: print "no active paper" and return. On any other error: print "STATE.json unreadable/corrupt" and return.

2. **Walk sections** (from `state.sections ?? []`, sorted by `n` ascending). For each section, call `readSectionState(sectionPlan(n, slug, paperRoot))` (`bin/lib/router.ts` — C6-HIGH: the SINGLE guarded per-section read path). Render:
   - `absent` → "not planned"
   - `corrupt` → "corrupt/unreadable PLAN.md — needs attention"
   - else → `r.status`

3. **Resolve next action** via `resolveNextAction(paperRoot, { stopAfterResearch })` where `stopAfterResearch` is mapped from the goal read via `readGoalFromConfig(paperRoot)`. Never throws. Print `  next: <verb>` (or `<verb> §<n>` for per-section verbs).

4. **Shell fallback** (TIER-06): `pensmith status`.
```

---

### `workflows/next.md` — DOCS-02 (documentation, fill stub)

**Analog:** `workflows/compile.md` shape; `bin/lib/router.ts` for resolver; bare `/pensmith` dispatcher

**Real next behavior:** `resolveNextAction()` reads STATE.json + per-section PLAN.md, returns the concrete next work verb. The bare `/pensmith` (no subcommand) routes here. The state machine: `new → research → outline → (plan → write → verify)* → compile → done`.

**Filled `workflows/next.md` body pattern:**
```markdown
# pensmith next

> Advance to the next workflow step based on current paper state — the bare `/pensmith` flow.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct readFileSync('.paper/STATE.json') + direct per-section PLAN.md reads
</capability_check>

## Overview

`pensmith next` is the bare `/pensmith` invocation: the state-aware next-step resolver.
It calls `resolveNextAction()` (`bin/lib/router.ts`) — a pure function over STATE.json
+ per-section PLAN.md frontmatter. The resolver IGNORES HANDOFF.json (H4) and NEVER
returns `{ verb:'resume' }`. It dispatches the resolved verb via `dispatchVerb()`.

State machine: `new → research → outline → (plan → write → verify per section) → compile → done`.
Goal-aware: `stopAfterResearch` maps `goal:'learning'` → hard-stop after research verb.

## Outputs

- Delegates entirely to the dispatched verb. No direct file writes.

## Body

1. **Resolve goal** via `readGoalFromConfig(paperRoot)` + `stopAfterResearchFor(goal)`.

2. **Call `resolveNextAction(paperRoot, { stopAfterResearch })`** (`bin/lib/router.ts`). NEVER throws (C3-HIGH-1 + C4-HIGH + C5-HIGH totality invariant — every fs/parse op is guarded with catch-all backstop).

3. **Map the decision:**
   - `{ verb:'new' }` → run intake
   - `{ verb:'research' }` → run research
   - `{ verb:'outline' }` → run outline
   - `{ verb:'plan', n, slug }` → run plan for section N
   - `{ verb:'write', n, slug }` → run write for section N
   - `{ verb:'verify', n, slug }` → run verify for section N
   - `{ verb:'compile' }` → run compile
   - `{ verb:'done' }` → print "paper complete; run `pensmith compile` to export"
   - `{ verb:'status', reason:'done' }` → learning hard-stop (render TUTORIAL.md end-state if goal='learning')
   - `{ verb:'status', reason:'attention' }` → print the attention terminus (STATE.json or section corrupt)

4. **Dispatch** via `dispatchVerb(decision.verb, verbArgs)` forwarding `yolo` + other global flags (C3-HIGH-2).

5. **Shell fallback** (TIER-06): `pensmith next` (or bare `pensmith`).
```

---

### `workflows/resume.md` — DOCS-02 (documentation, fill stub)

**Analog:** `workflows/compile.md` shape; `bin/cli/resume.ts` for real behavior

**Real `resume.ts` behavior** (lines 1-96): reads HANDOFF.json for summary only (H4 — never routes from it), calls `resolveNextAction()` (HANDOFF-blind), dispatches via `dispatchVerb()`, then clears HANDOFF.json (best-effort rmSync).

**Filled `workflows/resume.md` body pattern:**
```markdown
# pensmith resume

> Resume an interrupted workflow: summarize the last handoff, compute the next work verb, and dispatch it.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct readFileSync('.paper/HANDOFF.json') + direct readFileSync('.paper/STATE.json')
</capability_check>

## Overview

`pensmith resume` follows the H4 lifecycle: it reads HANDOFF.json for the SUMMARY only
(never routes from it — no resume→resume loop), then calls `resolveNextAction()` to
compute the next WORK verb (HANDOFF-blind), dispatches via `dispatchVerb()`, then
clears HANDOFF.json (best-effort `rmSync` — stale pointer must not re-trigger resume).

The resume verb MUST NEVER dispatch to itself (H4). `resolveNextAction()` is
structurally incapable of returning `{ verb:'resume' }`.

## Outputs

- Delegates entirely to the dispatched verb. HANDOFF.json cleared after dispatch.

## Body

1. **Read HANDOFF.json** (summary only, via `safeReadHandoff()` — `existsSync` + `JSON.parse` + `HandoffSchema.safeParse`, never throws). Print to stderr: `pensmith resume: last at phase='X', section='Y'. Next: Z`. If HANDOFF absent or done, skip the summary print.

2. **Resolve goal** via `readGoalFromConfig(paperRoot)` + `stopAfterResearchFor(goal)`.

3. **Call `resolveNextAction(paperRoot, { stopAfterResearch })`** (HANDOFF-blind resolver — C3-HIGH-1 totality guaranteed). Returns the concrete next WORK verb.

4. **Learning hard-stop check**: if `stopAfterResearch && decision.verb === 'status' && decision.reason === 'done'`, call `renderLearningEndState(paperRoot)` → writes `TUTORIAL.md`. Then consume HANDOFF.json (best-effort rmSync) and return.

5. **Dispatch** via `dispatchVerb(decision.verb, verbArgs)` forwarding `--dry-run`, `--estimate`, `--yolo`, `--show-prompts` flags (C3-HIGH-2).

6. **Consume HANDOFF.json** (best-effort `rmSync` in finally — stale pointer must not re-trigger a resume loop).

7. **Shell fallback** (TIER-06): `pensmith resume [--dry-run] [--estimate] [--yolo] [--show-prompts]`.
```

---

### `bin/lib/doctor/probes/http-crossref-ping.ts` — DOCS-02 stale copy refresh (utility)

**Analog:** Same file (self-edit of lines 26-36)

**Current stale strings** (lines 31-33):
```typescript
severity: 'SKIP',
summary: 'D-03(d) cassette wiring smoke deferred to Phase 3 (production-tree http-mock chokepoint not yet shipped). Phase 2 ships this probe with a stable id so tier-fact extraction in 02-07 can rely on its presence.',
fix: 'No action required in Phase 2. Phase 3 will land bin/lib/http-mock.ts and re-enable this probe with a real PASS/FAIL discrimination.',
```

**Replacement copy (shipped reality — http-mock.ts landed in Phase 3):**
```typescript
severity: 'PASS',  // or FAIL if cassette not found — actual logic TBD; see run() body
summary: 'D-03(d) Crossref-adapter cassette-wiring probe — exercises the recorded fixture cassette to confirm the offline HTTP path is reachable. PR-time CI runs OFFLINE; this probe is the canary for cassette parse / schema drift. PASS in CI; SKIP outside the repo where cassettes are not shipped.',
fix: 'If FAIL: check that tests/fixtures/cassettes/crossref/ exists and contains valid JSON cassette files. bin/lib/http-mock.ts shipped in Phase 3 — the probe is now active.',
```

Note: After updating the probe summary, `references/doctor-output.md`'s `### http-crossref-ping (D-03(d) cassette wiring)` section (lines 57-59) must be updated to match, and then the SHA-256 pin at `tests/repo-files.test.ts:179` must be recomputed and updated.

---

### `references/doctor-output.md` — DOCS-02 WN-3 re-pin (documentation)

**Analog:** Same file; the re-pin procedure from `tests/repo-files.test.ts:174-180`

**Current pinned section** (lines 57-59):
```markdown
### http-crossref-ping (D-03(d) cassette wiring)

> Crossref-adapter cassette-wiring probe — exercises the recorded fixture cassette to confirm the offline HTTP path is reachable. PR-time CI runs OFFLINE; this probe is the canary for cassette parse / schema drift. PASS in CI; SKIP outside the repo where cassettes aren't shipped.
```

The summary text at line 59 must match the probe's new `summary` string verbatim (the doctor render reads from this file). After editing, run:
```bash
node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/doctor-output.md')).digest('hex'))"
```
Paste the output into `tests/repo-files.test.ts:179` as the new `PINNED` value. Both edits in the same commit (WN-3 protocol).

---

### `PRIVACY.md` — DOCS-02 stale sentence replace (documentation)

**Analog:** Same file (self-edit, preserve lines 1-3)

**Preserve these substring-matched phrases** (tested at `repo-files.test.ts:93-94`):
```markdown
Pensmith is local-only. No telemetry, no cloud state, no remote logging.
```

**Stale final sentence to replace** (line 5):
```
The full privacy document — covering external API calls (OpenAlex, Crossref, arXiv, PubMed, Unpaywall, GPTZero, DuckDuckGo), the `PENSMITH_CONTACT_EMAIL` polite-pool requirement, PII redaction at intake, and humanizer/honesty-score data flows — ships with v0.1.0.
```

Replace with the real shipped privacy content covering all external data flows. The two substring-matched strings (`local-only`, `No telemetry`) must remain present at lines 1-3.

---

### `bin/lib/http-mock.ts` — DOCS-03 lazy nock import (utility, file-I/O)

**Analog:** `bin/lib/prompts.ts` lines 74-83 (lazy dynamic import pattern); `bin/lib/pdf-text.ts` lines 179-181

**Best analog — `bin/lib/prompts.ts` lazy import** (lines 74-83):
```typescript
export async function ask(question: PromptQuestion, opts: AskOptions = {}): Promise<PromptAnswer> {
  const mode = resolveMode(opts);
  if (mode === 'clack') {
    // Dynamic import so the numbered path never pays the clack startup cost
    // on non-TTY pipelines. This is the key Pitfall 11 mitigation.
    const { askClack } = await import('./prompts/clack.js');
    return askClack(question, opts);
  }
  return askNumbered(question, opts);
}
```

**Second analog — `bin/lib/pdf-text.ts` conditional lazy import** (lines 179-181):
```typescript
// The module is imported LAZILY so the child_process surface isn't loaded on
// the common (healthy-PDF) path.
const { pymupdfShellout } = await import('./pymupdf-shellout.js');
```

**Transform to apply to `bin/lib/http-mock.ts`:**

Step 1 — Remove the top-level `import nock from 'nock'` at line 53.

Step 2 — In `loadCassettes()` (lines 205-223), replace direct nock references with a lazy import:
```typescript
// Before (uses top-level nock):
export function loadCassettes(adapter: string): void {
  // ...
  for (const f of files) {
    const cassettes = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Cassette[];
    for (const c of cassettes) {
      nock(c.scope)
        .intercept(c.path, c.method)
        .reply(c.status, c.response as nock.Body, c.responseHeaders ?? {});
    }
  }
  nock.disableNetConnect();
}

// After (lazy import — nock only loaded when loadCassettes is called):
export async function loadCassettes(adapter: string): Promise<void> {
  if (!isOfflineMode()) return;
  const { default: nock } = await import('nock');
  // ... rest of function unchanged ...
  nock.disableNetConnect();
}
```

Step 3 — In `clearCassettes()` (lines 229-232), add lazy import:
```typescript
export async function clearCassettes(): Promise<void> {
  const { default: nock } = await import('nock');
  nock.cleanAll();
  nock.enableNetConnect();
}
```

Step 4 — In `recordCassettes()` (lines 255-276), add lazy import:
```typescript
export async function recordCassettes(adapter: string): Promise<void> {
  // ... guard checks unchanged ...
  const { default: nock } = await import('nock');
  nock.recorder.rec({ ... });
}
```

Step 5 — In `finalizeRecording()` (lines 288-338), add lazy import:
```typescript
export function finalizeRecording(adapter: string): void {
  // nock.recorder.play() — needs nock. Make finalizeRecording async or use createRequire.
  // Preferred: make async (consistent with recordCassettes):
  // (adjust callers accordingly)
}
```

Note: `loadCassetteFile()`, `loadCassetteDir()`, and `isOfflineMode()` do NOT use nock and require no changes — they remain synchronous and work without nock at runtime. This is the key safety property: the 7 production adapters only call these three functions.

**Nonce typing note:** nock's type `nock.Body` is also a top-level import. Replace with `unknown` or import only the type lazily: `type NockBody = Parameters<ReturnType<typeof nock>['reply']>[1]`.

---

## Shared Patterns

### Hash-Pin (WN-3 Protocol)
**Source:** `tests/repo-files.test.ts` lines 174-180
**Apply to:** Any pinned doc edited in DOCS-02 (specifically `references/doctor-output.md`)
```typescript
// Template for any hash-pin test:
const bytes = readFileSync('references/doctor-output.md');
const hash = createHash('sha256').update(bytes).digest('hex');
const PINNED = '<computed-hash>';
assert.equal(hash, PINNED, `... drifted from locked copy. Update PINNED to ${hash} if the edit was intentional.`);
// Recompute after edit:
// node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/doctor-output.md')).digest('hex'))"
```

### Lazy Dynamic Import
**Source:** `bin/lib/prompts.ts` lines 76-80; `bin/lib/pdf-text.ts` line 180
**Apply to:** `bin/lib/http-mock.ts` nock import inside `loadCassettes`, `clearCassettes`, `recordCassettes`, `finalizeRecording`
```typescript
// Named export: const { askClack } = await import('./prompts/clack.js');
// Default export: const { default: nock } = await import('nock');
```

### Workflow Body Shape
**Source:** `workflows/compile.md` (full file — the canonical well-formed body shape)
**Apply to:** `workflows/{doctor,status,next,resume}.md`

Required sections in order:
1. `# pensmith <verb>` heading + `> one-line description`
2. `<capability_check>` block with `required:` and `degrade_if_missing:` sub-keys
3. `## Overview` prose section
4. `## Outputs` bullet list
5. `## Body` numbered steps ending with "Shell fallback (TIER-06)"

### process.stdout.write Pattern
**Source:** `bin/cli/intake.ts` lines 253-258, 262-263; `bin/cli/status.ts` line 81
**Apply to:** `bin/cli/intake.ts` DOCS-01 disclaimer print; `bin/cli/doctor.ts` output (already correct)
```typescript
// Always use process.stdout.write (never console.log) — keeps stdio/MCP frame clean:
process.stdout.write(output + '\n');
```

### CI YAML Step Shape
**Source:** `.github/workflows/ci.yml` lines 40-56
**Apply to:** CI-02 porcelain step, CI-03 coverage step

Named steps use:
```yaml
      - name: <Descriptive name with ref id>
        shell: bash       # required on multi-OS matrix for /dev/null redirect
        run: |
          <multi-line shell script>
```
Unnamed steps (single command) use:
```yaml
      - run: npm run <script>
```

---

## No Analog Found

All files have close matches in the codebase.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.c8rc.json` | config | transform | No existing `.c8rc.json` or c8 config file — c8 was only used via CLI flags in the `coverage` script. Content is fully specified in RESEARCH.md. |

---

## Metadata

**Analog search scope:** `bin/`, `tests/`, `workflows/`, `.github/workflows/`, `references/`, `scripts/`, `package.json`, `PRIVACY.md`, `README.md`
**Files scanned:** 25+
**Pattern extraction date:** 2026-06-24
**Key constraint:** `bin/lib/http-mock.ts` is a production module (confirmed via grep of 10 production importers) — nock must be lazy-imported, not moved to devDeps without the refactor.
**Key constraint:** `tests/repo-files.test.ts:91-92` must be deleted/updated in the same commit as the real README lands.
**Key constraint:** `references/doctor-output.md` SHA-256 pin at `tests/repo-files.test.ts:179` must be recomputed in the same commit as the doctor probe copy refresh.
