# Phase 2: Tier shells + doctor + tier-contract gate - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Bring up BOTH tier shells (Tier 1 Claude Code plugin + Tier 2 portable Node CLI) against the Phase 1 foundation libs. Ship `/pensmith doctor` end-to-end in both tiers as the first concrete consumer of `bin/lib/*` and the first contract case for `tests/tier-contract.test.js`, which becomes a hard merge gate from this phase forward.

**Concretely in scope:**
- MCP server skeleton at `mcp/server.ts` exposing the 5 `paper://*` resources and 6 idempotent state-mutation tools (tool handlers ≤30 lines, lint-checked)
- Tier 2 CLI dispatcher at `bin/pensmith-cli.ts` (citty-based) with the full 17-verb registry; only `doctor` has a real handler in this phase
- Hooks scaffolding (`hooks/hooks.json`) wiring SessionStart / Stop / PreCompact / PostToolUse
- `bin/lib/doctor.ts` exporting `runAllProbes()` — pure deterministic code, called by both tiers
- `tests/tier-contract.test.js` harness + first case (doctor) wired into existing 3-OS CI matrix as a required check
- Doctor probes: plugin presence, MCP reachable, hooks wired, Node version, disk paths, ecosystem (Zotero MCP / Pandoc / humanizer), PENSMITH_CONTACT_EMAIL, OneDrive/iCloud/Dropbox/Google Drive detection on `.paper/`
- `02-00-review-cleanup` plan addressing 4 deferred Phase 1 FLAGs (02, 04, 05, 06)
- Retry-After / X-Rate-Limit parser added to `bin/lib/retry.ts` (5-line carry-forward from Phase 1)

**Explicitly OUT of scope (hard fence for plan-phase):**
- No real intake / outline / verify / write code (Phase 3+)
- No `.paper/` directory creation by Phase 2 code (first creation is Phase 3 intake)
- No section directory I/O (Phase 3)
- No verifier passes 1–4 (Phase 7)
- No wave scheduler (Phase 4); no compile pipeline (Phase 6); no citation styles (Phase 9)
- No bare `/pensmith` state-aware routing (Phase 5)
- No real LLM calls; no cassettes for LLM (no caller exists yet)
- No SSE/HTTP MCP transport — stdio only (locked by lint test)

</domain>

<decisions>
## Implementation Decisions

### A. Carry-forwards triage from Phase 1

- **D-01:** **Retry-After / X-Rate-Limit parser split** — `parseRetryAfter(headerValue, now): number` lives in `bin/lib/retry.ts` as a pure helper (single-purpose, easy to unit-test). `bin/lib/http.ts` imports and uses it inline on the 429 / 503 path; no callback indirection (`retry.ts` stays a generic scheduler). Resolves the documented Phase 1 SC-5 carry-forward.
- **D-02:** **REVIEW.md deferred-items disposition** — first Phase 2 plan is `02-00-review-cleanup`. Fixes FLAG-02 (session-log module-global `chain`), FLAG-04 (`spilled_to` Windows path separator), FLAG-05 (module-singleton logger captures env at first call — doctor will be the first new caller), FLAG-06 (http cache writes auth-bearing responses unredacted — symmetric leak that becomes live in Phase 3). Explicitly closes FLAG-07 / FLAG-08 / FLAG-09 + NIT-01 / NIT-03 / NIT-05 as won't-fix-in-Phase-2 with one-line rationales appended to REVIEW.md. NIT-02 / NIT-04 / NIT-06 already closed by REVIEW (documented tradeoffs).

### B. Phase 2 exit criteria / definition-of-done

- **D-03:** **DOCT-05 depth = wiring smoke only.** Doctor verifies (a) MCP server starts and answers `paper://capabilities`, (b) verb dispatcher resolves, (c) a fixture `.paper/` loads, (d) `http.ts` reaches a cassette-served Crossref ping. NO not-yet-shipped phase code runs.
- **D-04:** **Phase 3 plan-phase MUST register DOCT-05.v3 as a first-class plan item** ("add real intake/outline/verify exercise once vertical-slice lands") — captured here so wiring-smoke doesn't calcify as the permanent definition.
- **D-05:** **Full verb dispatcher with `doctor`-only real handler.** Both Tier 1 slash-command and Tier 2 citty dispatcher register all 17 verbs (`new` / `next` / `status` / `research` / `outline` / `plan` / `write` / `verify` / `compile` / `done` / `resume` / `list` / `open` / `sketch` / `add` / `doctor`); 16 of them return `NotYetImplemented(verb, phase: N)`. Phase 5 wires bare `/pensmith` state-aware routing — explicit conscious rejection here, not accidental omission.

### C. MCP server surface

- **D-06:** **MCP SDK choice deferred to gsd-phase-researcher.** Researcher evaluates `@modelcontextprotocol/sdk` current surface, dep weight, ergonomics under the ≤30-line shim constraint. Decision lands at plan-phase.
- **D-07:** **URI grammar: path-style, singular noun.** `paper://state`, `paper://outline`, `paper://section/{N}`, `paper://library`, `paper://capabilities`. Future sub-resources (e.g., `paper://section/3/draft`) reserved without grammar change.
- **D-08:** **Idempotency = natural-key from args + state-version check.** Each state-mutation tool reads `paper://state` (version-stamped), computes desired end state, writes via `state.updateState()` (already lock-and-version-checked, optimistic concurrency). Replay with same args yields same end state; stale version returns a typed conflict response. No client-side `idempotency_key` parameter.
- **D-09:** **Thin-shim enforcement via AST-walk test** (matches Phase 0 chokepoint pattern). `tests/lint-mcp-thin-shim.test.ts` parses `mcp/server.ts` via `@typescript-eslint/parser`, finds `server.tool(...)` / `server.resource(...)` `CallExpressions`, asserts the handler argument is `ArrowFunction` / `FunctionExpression` with ≤30 logical statements (excluding comments / whitespace). No new dev dep.

### D. MCP auth / trust boundary

- **D-10:** **Stdio-only transport, locked by lint.** `mcp/server.ts` declares stdio transport only. `tests/lint-mcp-no-network.test.ts` AST-walks `mcp/` for any `net.createServer` / `http.createServer` / `tls.createServer` / `new Server()` call and fails the build. Belt-and-suspenders against accidental network exposure. Future SSE/HTTP is a separate phase decision with its own auth design.
- **D-11:** **Tier 2 production never touches MCP** — `bin/lib/*` is the single source of truth. BUT the tier-contract test in CI spawns `mcp/server.js` via the SDK's stdio client AND runs the CLI, comparing the resource/tool surface against the CLI's `runAllProbes()` output. Rationale: Claude Code's view of pensmith IS the MCP surface; URI/tool-schema/error-shape drift is the bug class that most needs CI coverage and that `bin/lib` unit tests structurally cannot catch.
- **D-12:** **`paper://capabilities` = presence-flags only, lint-enforced.** Shape: `{ mcp_self: true, pandoc: boolean, zotero_mcp: boolean, humanizer: boolean, contact_email_set: boolean, providers: [{ name, api_key_env, present: boolean }], onedrive_detected: boolean, sync_folder_match?: string }`. All booleans / enum / env-var-NAME values; zero key-value leaks. `tests/lint-mcp-capabilities-noleak.test.ts` AST-walks the capabilities handler; no `process.env[...]` expression may flow into the returned object except via the `typeof process.env[x] === 'string' && process.env[x].length > 0` presence-check pattern. Symmetric to Phase 1's T-01-07 no-leak property.

### E. Tier-2 CLI dispatch model

- **D-13:** **Doctor is deterministic code; workflow body is a thin handler shell.** `bin/lib/doctor.ts` exports `runAllProbes(): Promise<ProbeReport>`. `workflows/doctor.md` is a thin pointer ("invoke the doctor probes; render report"). Tier 1: slash command → `paper_capability_probe` MCP tool → `runAllProbes()`. Tier 2: citty verb → `runAllProbes()` direct. No LLM in doctor's hot path; DOCT-06 tier-equivalence becomes structural rather than statistical. Establishes "deterministic workflow body" as a first-class shape alongside "LLM-driven workflow body" used in later phases.
- **D-14:** **`<capability_check>` block format.** Workflow bodies use `<capability_check>` blocks with `<requires>` / `<if_present>` / `<if_absent>` child tags. Tier-2 dispatcher parses with a tag-regex/walker (no markdown AST dep). Capability resolution = known-keys lookup against runtime probe results. Phase 2 doctor.md does NOT actually contain branching blocks (it's deterministic — always probes everything); the parser ships in Phase 2 but is load-bearing starting in Phase 3.

### F. Doctor output + severity model

- **D-15:** **Severity = PASS / WARN / FAIL / SKIP. Exit 0 unless any FAIL.** WARN and SKIP are non-blocking. Concrete mapping: missing PENSMITH_CONTACT_EMAIL = WARN (per ARCH-12 free-basics framing). Missing Pandoc = WARN (export-only impact). OneDrive `.paper/` = WARN. MCP server unreachable = FAIL. Missing humanizer skill at `~/.claude/skills/humanizer/` = WARN. SKIP for probes that don't apply (e.g., `intake fixture: SKIPPED (Phase 3+)` per D-03 wiring-smoke DoD).
- **D-16:** **Output format: human-first; `--json` for machine.** Default invocation emits prose suitable for terminal reading. `--json` flag emits the underlying `ProbeReport` structure (one source of truth, two renderers). The tier-contract test always passes `--json`.
- **D-17:** **OneDrive / iCloud / Dropbox / Google Drive detection = path-substring match.** Resolve `.paper/` to absolute path; walk parents; match against case-insensitive substrings: `OneDrive`, `OneDrive - `, `iCloud Drive`, `CloudStorage` (macOS Files-app sync root), `Dropbox`, `Google Drive`, `GoogleDrive`, `pCloud`, `Box`. WARN with the matched folder name in `sync_folder_match`. Portable, ~30 LOC, false-positive risk low.
- **D-18:** **DOCT-03 implementation.** Doctor reads `process.env.PENSMITH_CONTACT_EMAIL`; emits WARN with the same copy as `http.ts`'s WARN-once banner (consistency between runtime and diagnostic surfaces).

### G. Tier-contract test scaffolding

- **D-19:** **Comparison strictness by `kind`.** Every contract-test case declares `kind: 'deterministic' | 'prose'`. Deterministic cases (Phase 2 doctor is first; future capability_probe results, state-mutation tool replies) must be byte-equal after normalization. Prose cases (Phase 4+ verifier verdicts, write-section drafts) use the TIER-07 ±20% length-tolerance + semantic-equivalence check; case declares `lengthTolerance` (default 0.20).
- **D-20:** **Single shared normalizer at `tests/lib/normalize-probe-report.ts`.** Replacements: `HOME → {{HOME}}`, `CWD → {{CWD}}`, `.paper/ absolute → {{PAPER}}`, `LOCALAPPDATA / XDG_DATA_HOME / Library → {{LOCAL_DATA}}`, ISO timestamps → `{{TS}}`, `probe_ms` durations → `{{DURATION}}` (kept in schema; debugging value outweighs marginal cleanliness of dropping them). Hostname / PID dropped entirely. Path separators normalized `\\` → `/` AFTER placeholder substitutions so cross-OS comparison works against a single canonical form. Object keys recursively sorted before stringify. **Probes structured as a Record keyed by `probe.id`** (kills array-order question at source — Tier 1 may probe in parallel, Tier 2 sequentially). Each normalizer rule carries a one-line `// why intrinsically variable` comment.
- **D-21:** **CONTRIBUTING.md `<!-- LOCKED -->` discipline rule.** "When a contract test fails because a field differs between tiers, the default fix is to make the tiers agree, NOT to add a normalizer rule. Only add a normalizer rule when the field is intrinsically variable across runs (wall-clock timestamps, durations, hostnames, environment-derived paths). Each rule in `normalize-probe-report.ts` carries a one-line comment explaining WHY that field is intrinsically variable. If you can't write that comment, you shouldn't add the rule." Without this rule, Option 2 (per-test rules) creeps back in by default — every new failing case gets papered over and the gate stops meaning anything.
- **D-22:** **CI wiring = step in existing matrix, not separate job.** `.github/workflows/ci.yml` gains `npm run test:tier-contract` as a step after `npm run lint` / `tsc --noEmit` / `npm test` in the existing linux-x64 / macos-arm64 / windows-x64 matrix. No new workflow file; no second cold-start. Failed step appears as `tier-contract` in GitHub check log.
- **D-23:** **Branch-protection toggle is an explicit Phase 2 checklist item** (one-time GitHub UI / `gh api` setup, not in code). Phase 2 plan MUST include: "In GitHub branch protection for `main`, add `test (linux-x64)`, `test (macos-arm64)`, `test (windows-x64)` as required status checks. Document the exact check names in CONTRIBUTING.md so they survive workflow renames." Without this, the gate exists in code but not in policy.
- **D-24:** **Self-enforcing pre-flight assertion** at `tests/tier-contract/preflight.test.ts`. Globs workflow bodies and contract-test cases; asserts every workflow has a corresponding case. Prevents drift mechanically — the CONTRIBUTING.md rule then just documents what's already enforced. 4-layer gate: (1) CI step runs the test, (2) branch protection requires the check, (3) preflight asserts every workflow has a case, (4) locked CONTRIBUTING.md prose.

### Claude's Discretion

The following are implementation details that fall to the planner / researcher, not the user:
- citty verb-handler signature and where workflow-body loading code physically lives
- Pre-flight preflight workflow-id derivation (filename slug vs. front-matter field)
- Exact `--json` schema for ProbeReport (the planner derives a zod schema; user vision is "presence-flags + per-probe severity")
- Hooks.json field-level wiring (PreCompact timeout, PostToolUse mtime gate) — locked by TIER-03 already

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level specs
- `PRD.md` §3 (disclaimer / no metadata trace), §7.21 (doctor scope), §12 (ARCH-12 free-basics framing for missing email), §14 (locked-copy pattern), §17 (open questions deferred to per-phase discuss), §19 (non-negotiables)
- `.planning/PROJECT.md` — Key Decisions table; "tier-contract.test.js is Phase 2 hard merge gate" entry; section-as-phase non-negotiable
- `.planning/REQUIREMENTS.md` ARCH-01, ARCH-03, ARCH-18 (two-tier source-of-truth + capability_check + MCP thin shim), TIER-01..07, DOCT-01..06
- `.planning/ROADMAP.md` Phase 2 success criteria (lines 88–99)
- `CLAUDE.md` — pensmith project memory; non-negotiables (verifier blocks compile/export, no exported-document trace, honest framing on detection, approval gates default-on)

### Phase 1 foundation (consumed by Phase 2)
- `bin/lib/paths.ts` — `pensmithDataDir()`, `pensmithHttpCacheDir()`, OneDrive-safe path routing
- `bin/lib/atomic-write.ts` — tmp+fsync+rename+fsync(dir) chokepoint
- `bin/lib/lock.ts` — `withLock`, load-INSIDE-the-lock idiom
- `bin/lib/http.ts` — undici client, WARN-once missing-email banner (DOCT-03 surfaces this)
- `bin/lib/retry.ts` — full-jitter exponential backoff; gains `parseRetryAfter()` in Phase 2 (D-01)
- `bin/lib/state.ts`, `bin/lib/library.ts`, `bin/lib/checkpoint.ts`, `bin/lib/runtime.ts` — state-mutation entry points reached by MCP tools
- `bin/lib/schemas/runtime-config.ts` — `RuntimeConfigSchema` (provider list with `apiKeyEnv` env-var NAME, never value)
- `bin/lib/pii.ts` — sensitive-header redaction (relevant to FLAG-06 cache fix)

### Phase 1 review artifacts (informs `02-00-review-cleanup`)
- `.planning/phases/01-foundation-nfrs/REVIEW.md` — 7 deferred FLAGs + 5 NITs (FLAG-02 / 04 / 05 / 06 fix; FLAG-07 / 08 / 09 + NIT-01 / 03 / 05 explicitly close)
- `.planning/phases/01-foundation-nfrs/REVIEW-FIXES.md` — fix-audit trail
- `.planning/phases/01-foundation-nfrs/VERIFICATION.md` — documented Phase 1 → Phase 2 carry-forward (Retry-After parser, SC-5)

### Phase 0 scaffolding (referenced)
- `.claude-plugin/plugin.json` — plugin manifest; `mcpServers.pensmith.args` already points at `dist/mcp/server.js`
- `.mcp.json` — top-level MCP declaration (dual-declaration per D-18 from Phase 0)
- `.github/workflows/ci.yml` — existing 3-OS matrix (linux-x64 / macos-arm64 / windows-x64) gains the `npm run test:tier-contract` step in D-22
- `scripts/validate-plugin-manifest.cjs` — manifest structural-assertion validator (Phase 0)
- `scripts/run-tests.mjs` — test runner entry (Windows cmd.exe glob-expansion landmine avoided)

### Phase 0 / Phase 1 context for already-decided architecture
- `.planning/phases/00-repo-skeleton-plugin-manifest/00-CONTEXT.md` D-01..D-22
- `.planning/phases/01-foundation-nfrs/01-CONTEXT.md` D-01..D-68

### External / forward
- `@modelcontextprotocol/sdk` (npm) — to be evaluated by phase-researcher (D-06)
- `citty` (npm) — locked as Tier 2 verb dispatcher per TIER-04
- `@clack/prompts` (npm) — locked as Tier 2 AskUserQuestion fallback per TIER-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`bin/lib/paths.ts`** — Doctor consumes `pensmithDataDir()` to report writability; OneDrive detection algorithm (D-17) walks `path.dirname(process.cwd())` parents AND `path.dirname(pensmithDataDir())` parents to check both `.paper/` AND local-data locations.
- **`bin/lib/runtime.ts`** — `paper://capabilities` reads `loadRuntimeConfig()` to populate provider presence-flags WITHOUT exposing api-key values. Schema persists `apiKeyEnv` names only (T-01-07 invariant).
- **`bin/lib/state.ts` / `bin/lib/library.ts` / `bin/lib/checkpoint.ts`** — MCP state-mutation tools route through these. `updateState()` already takes `withLock`, version-checks, and writes atomically (D-08 idempotency strategy works because these primitives already enforce optimistic concurrency).
- **`bin/lib/http.ts`** — `paper_doi_verify` MCP tool's thin shim wraps the existing http GET + DOI normalization pipeline; no new HTTP code needed.
- **`tests/lint-chokepoint.test.ts` / `tests/lint-paths-chokepoint.test.ts` / `tests/lint-atomic-write-chokepoint.test.ts`** — Pattern model for the three new AST-walk lint tests (D-09 thin-shim, D-10 no-network, D-12 capabilities-noleak).
- **`scripts/run-tests.mjs`** — Reuse for `npm run test:tier-contract` step; pattern-glob to `tests/tier-contract/**/*.test.ts`.

### Established Patterns

- **Chokepoint enforcement via AST-walk tests** (Phase 0 D-07, paths/atomic-write). Phase 2 adds three more (thin-shim, no-network, capabilities-noleak) using the same `@typescript-eslint/parser` approach. No ESLint custom-rule plumbing.
- **Load-INSIDE-the-lock idiom** (Phase 1 BLOCKER-01/02 fixes). State-mutation MCP tools delegate to `bin/lib/*` entry points that already follow this idiom — no need to reimplement in `mcp/server.ts`.
- **Refuse-forward-incompat schema versioning** (D-39 from Phase 1). Doctor's ProbeReport zod schema declares a `version: 1` field; tier-contract harness asserts the schemas match major-version across tiers.
- **Single-source-of-truth rendering** (Phase 1 cost-fixture: data shape generated once, formatted to JSON or human). ProbeReport follows the same pattern (D-16): one schema, two renderers.

### Integration Points

- **`.claude-plugin/plugin.json`** — Already references `dist/mcp/server.js`. Build script (TBD in plan) compiles `mcp/server.ts` to `dist/mcp/server.js`. Manifest validator (`scripts/validate-plugin-manifest.cjs`) already structurally asserts this.
- **`.mcp.json`** — Top-level MCP declaration; same `dist/mcp/server.js` target (D-18 from Phase 0 — redundant dual-declaration per Anthropic spec).
- **`.github/workflows/ci.yml`** — Gain `npm run test:tier-contract` as a step in the existing 3-OS matrix (D-22). No second job.
- **`package.json`** — Gain `scripts.test:tier-contract`, `build`, `start:mcp` (or equivalent) entries. No new dependencies beyond `@modelcontextprotocol/sdk` (pending researcher confirmation per D-06), `citty`, `@clack/prompts`.
- **`hooks/hooks.json`** — New file. SessionStart (auto-resume) / Stop (release lock + flush session log) / PreCompact (HANDOFF.json, 10s timeout) / PostToolUse (≤1/min throttled checkpoint via mtime gate). Per TIER-03.
- **`CONTRIBUTING.md`** — New file. Contains the `<!-- LOCKED -->` block (D-21) with the tier-contract discipline rule + the required-check name list (D-23).

</code_context>

<specifics>
## Specific Ideas

- **No-leak invariant symmetric to T-01-07** — Phase 1's no-leak property protected api-key VALUES from reaching disk via runtime config. Phase 2 extends the discipline to the MCP surface: `paper://capabilities` exposes env-var NAMES and presence-booleans only, enforced by `tests/lint-mcp-capabilities-noleak.test.ts`. Same shape of defense (AST-walk over a chokepoint).
- **Doctor as debugging tool, not just gate** — User explicitly chose to keep `probe_ms` durations in the ProbeReport schema and normalize them in the harness, rather than dropping them to simplify the contract. Rationale: doctor's user-facing output is half debugging-tool; slow-probe timings and "checked at" stamps are what users paste into bug reports.
- **MCP surface drift is the bug class that matters most** — User's specific rationale for D-11: Claude Code's view of pensmith IS the MCP surface. URI shapes, tool schemas, and error message structures can drift silently while `bin/lib` unit tests stay green. The tier-contract test spawning the MCP server alongside the CLI catches this class of bug. This is also why the AST-walk lint tests (D-09, D-10, D-12) live AT the MCP surface, not in `bin/lib`.
- **Discipline rule prevents Option 1 → Option 2 drift** — User's articulation of the principle that keeps the normalizer small over time: "default fix is to make the tiers agree, not to add a normalizer rule." Without it, each new failing case quietly papers over with a normalizer rule and the gate stops meaning anything.

</specifics>

<deferred>
## Deferred Ideas

- **Failure-mode contract beyond `<capability_check>`** — what happens when a capability is present-but-broken (MCP server returns malformed response, doctor probe panics mid-run, Tier 2 dispatch hits a parse error in a workflow .md). User chose "ruthless about discussion-phase size" — this surfaces naturally during plan-phase when each component's degradation path gets designed. NOT a discuss-phase decision.
- **DOCT-05.v3** (Phase 3) — Add real intake / outline / verify exercise to DOCT-05 once vertical-slice lands. Must be a first-class plan item in Phase 3, not opportunistic side-effect. Captured here (D-04) so it doesn't get dropped.
- **Bare `/pensmith` state-aware routing** (Phase 5) — Phase 2 explicitly excludes this. The 17-verb dispatcher ships with all verbs registered; `/pensmith` without a verb is `NotYetImplemented(verb: null, phase: 5)`.
- **MCP transport beyond stdio** — Future SSE / HTTP / WebSocket transport is a separate phase decision. Phase 2 locks stdio-only by lint test (D-10).
- **Per-process RuntimeConfig cache** (FLAG-07 follow-up) — REVIEW.md noted that caching `loadRuntimeConfig` per-process with invalidation on save would reduce read pressure. Not pulled into Phase 2; revisit if Phase 3+ load profile shows it matters.
- **CI matrix observation** — Phase 1's commits were pushed to origin/main; verify the matrix run is green on linux-x64 / macos-arm64 / windows-x64 before plan-phase. (Not gating discuss → plan; surface if red.)

</deferred>

---

*Phase: 2 - Tier shells + doctor + tier-contract gate*
*Context gathered: 2026-05-14*
