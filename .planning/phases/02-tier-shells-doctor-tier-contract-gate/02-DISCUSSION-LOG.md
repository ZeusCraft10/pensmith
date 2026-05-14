# Phase 2: Tier shells + doctor + tier-contract gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 2 - Tier shells + doctor + tier-contract gate
**Areas discussed:** Carry-forwards triage; Phase 2 exit criteria / DoD; MCP server surface; MCP auth / trust boundary; Tier-2 CLI dispatch model; Doctor output + severity model; Tier-contract test scaffolding

---

## Gray Area Selection

Initial AskUserQuestion presented 4 areas. User selected all 4 AND added 3 additional ("not on the list") areas, ranking them by "how badly skipping them would hurt." User also flagged a 4th optional addition (failure-mode contract beyond capability_check) and recommended dropping it as ruthless discussion-phase sizing.

**Final list (7 areas, in discussion order):**
1. Carry-forwards triage (user-added, ranked #1: "highest value, not on the list")
2. Phase 2 exit criteria / DoD (user-added, ranked #3: "discuss-phase is the right place to lock in 'done means X'")
3. MCP server surface (original option 1)
4. MCP auth / trust boundary (user-added, ranked #2: "painful to retrofit, isn't covered by URI shape")
5. Tier-2 CLI dispatch model (original option 2)
6. Doctor output + severity model (original option 3)
7. Tier-contract test scaffolding (original option 4)

**Dropped:** Failure-mode contract beyond capability_check — surfaces naturally in plan-phase when each component's degradation path gets designed.

---

## Area 1: Carry-forwards triage

### Sub-question A: Retry-After / X-Rate-Limit parser placement

| Option | Description | Selected |
|--------|-------------|----------|
| bin/lib/retry.ts with onRetry callback | Header-aware delay via callback indirection | |
| bin/lib/http.ts response interceptor | http.ts owns parser; retry stays generic | |
| Both — split it | parseRetryAfter() pure helper in retry.ts; http.ts imports and uses inline on 429/503 | ✓ |

**User's choice:** Both — split it
**Notes:** Pure helper is single-purpose / easy to unit-test; http.ts stitches it in inline without callback indirection. Resolves Phase 1 SC-5 documented carry-forward.

### Sub-question B: Deferred FLAGs + NITs triage

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated cleanup plan early in Phase 2 | First plan = 02-00-review-cleanup. Fixes FLAG-02/04/05/06; explicitly closes FLAG-07/08/09 + NIT-01/03/05 | ✓ |
| Triage-by-touch (status quo) | Each Phase 2 plan responsible for relevant FLAGs of files it touches | |
| Pull only FLAG-05 + FLAG-06 | One plan; latent-becomes-live items only | |
| Defer all to Phase 2.1 polish wave | Cleanup after Phase 2 main plans land | |

**User's choice:** Dedicated cleanup plan early in Phase 2 (Recommended)
**Notes:** FLAG-05 (logger singleton — doctor is first new caller) and FLAG-06 (http cache writes auth-bearing responses unredacted — symmetric leak that goes live in Phase 3) are the "latent-becomes-live" pair. FLAG-02 (session-log module-global chain) + FLAG-04 (spilled_to path separator) are touched by doctor's usage. Single auditable plan; nothing slips silently.

---

## Area 2: Phase 2 exit criteria / DoD

### Sub-question A: DOCT-05 fixture probe depth

| Option | Description | Selected |
|--------|-------------|----------|
| Wiring smoke only | MCP starts, commands resolve, fixture .paper/ loads, cassette Crossref ping | ✓ |
| Wiring smoke + canned Pass 1 verifier | Drags Phase 7 surface forward | |
| Defer DOCT-05 to Phase 3 | Doctor reports "e2e: SKIPPED" in Phase 2 | |

**User's choice:** Wiring smoke only, PLUS explicit Phase 3 extension tracked as a first-class plan item ("DOCT-05.v3: add intake/outline/verify exercise once section vertical-slice lands")
**Notes:** Without a tracked follow-up, "wiring smoke" risks calcifying as the permanent definition. Captured in CONTEXT.md D-04.

### Sub-question B: /pensmith command dispatcher scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full dispatcher with only doctor registered | All 17 verbs in registry; only doctor wired; others return NotYetImplemented(verb, phase) | ✓ |
| Only /pensmith doctor | Minimal; bigger Phase 3 dispatcher rewrite | |
| Full dispatcher + state-aware /pensmith bare | Pulls Phase 5 forward — explicitly rejected | |

**User's choice:** Full dispatcher with only doctor registered (Recommended)
**Notes:** Lets Phase 3+ wire verbs incrementally without dispatcher churn. Phase 5's bare /pensmith state-aware routing is a CONSCIOUS rejection here, not an accidental omission.

---

## Area 3: MCP server surface

### Sub-question A: MCP SDK choice

| Option | Description | Selected |
|--------|-------------|----------|
| @modelcontextprotocol/sdk (official) | Handles JSON-RPC; ~50KB dep; idiomatic | |
| Hand-rolled stdio JSON-RPC | Zero new deps; track protocol manually | |
| Defer to phase-researcher | Researcher evaluates current SDK surface + ergonomics under thin-shim | ✓ |

**User's choice:** Defer to phase-researcher
**Notes:** Decision lands at plan-phase after researcher reports dep weight + composition with ≤30-line shim constraint.

### Sub-question B: URI grammar

| Option | Description | Selected |
|--------|-------------|----------|
| Path with singular noun | paper://section/{N}; matches MCP SDK examples | ✓ |
| Path with plural noun for collections | paper://sections/{N}; REST-like | |
| Query-style for parametric | paper://section?n=3 | |

**User's choice:** Path with singular noun (Recommended)
**Notes:** Future sub-resources (e.g., paper://section/3/draft) reserved without grammar change.

### Sub-question C: Idempotency strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Natural-key from args + state-version check | Reads paper://state version, computes desired end state, writes via state.updateState() optimistic-concurrency | ✓ |
| Explicit idempotency_key parameter | Server caches (key, result_hash) tuples; standard distributed-systems pattern | |
| Per-tool natural-key with per-tool reasoning | Designed per-tool; more precise but more surface | |

**User's choice:** Natural-key from arguments + state-version check (Recommended)
**Notes:** Matches state.ts's existing optimistic-concurrency model; no client-side idempotency_key complexity.

### Sub-question D: Thin-shim enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| AST-walk test | tests/lint-mcp-thin-shim.test.ts; matches Phase 0 chokepoint pattern | ✓ |
| ESLint flat-config rule | max-lines-per-function with scoped override; harder to express handler-arg scope | |
| Both — test as truth, ESLint as advisory | Two surfaces to keep in sync | |

**User's choice:** AST-walk test (matches Phase 0 chokepoint pattern, Recommended)
**Notes:** No new dev dep; reuses @typescript-eslint/parser already in tree.

---

## Area 4: MCP auth / trust boundary

### Sub-question A: Transport scope

| Option | Description | Selected |
|--------|-------------|----------|
| Stdio-only, hard-coded | No SSE/HTTP code at all | |
| Stdio with SSE-ready scaffolding | Transport-agnostic protocol code; design auth now | |
| Stdio with explicit "transport-only" lint | Stdio only + tests/lint-mcp-no-network.test.ts AST-walks for any TCP-bind | ✓ |

**User's choice:** Stdio with explicit "transport-only" lint
**Notes:** Belt-and-suspenders against accidental network exposure. Future SSE/HTTP is a separate phase decision with its own auth design.

### Sub-question B: Tier-2 ↔ MCP-server bridge

| Option | Description | Selected |
|--------|-------------|----------|
| Never — hard wall | Tier 2 talks to bin/lib/* directly only; no MCP in Tier 2 at all | |
| Allowed for tier-contract test only | Tier 2 production never uses MCP; tier-contract test in CI spawns mcp/server.js via SDK stdio client alongside CLI run | ✓ |
| Permitted as future option | Don't ship the bridge; reserve design space; auth-model design deferred | |

**User's choice:** Allowed for tier-contract test only (user's own framing, diverging from default Recommended)
**Notes:** User's specific reasoning, captured verbatim: "The Claude Code plugin is your primary UX. The MCP server is thin, but it's also the only thing that translates between bin/lib's internal API and what Claude Code actually sees — resource URIs, tool schemas, error shapes. Those can drift silently while bin/lib/* tests stay green. Option 1 would miss 'section drafter works in CLI but the MCP tool surface is broken.' For a tool whose primary distribution is the Claude Code plugin, that's the bug class you most want caught in CI." This rationale is the load-bearing argument for D-11.

### Sub-question C: paper://capabilities content

| Option | Description | Selected |
|--------|-------------|----------|
| Presence-flags only + lint enforcement | Booleans + env-var NAMES; tests/lint-mcp-capabilities-noleak.test.ts AST-walks for no process.env value leaks | ✓ |
| Presence-flags only, no lint | Convention + code review; smaller test surface | |
| Presence-flags + redacted-snippet diagnostics | suffix-only API key hints; increases leak surface | |

**User's choice:** Presence-flags only + lint enforcement (Recommended)
**Notes:** Symmetric to Phase 1's T-01-07 no-leak property. Bolt-on test, same shape of defense.

---

## Area 5: Tier-2 CLI dispatch model

### Sub-question A: Doctor's place in the workflow-body model

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic code, thin workflow body | bin/lib/doctor.ts runAllProbes(); both tiers route to same function; no LLM in hot path | ✓ |
| LLM-driven workflow body for doctor too | Uniform with future intake/outline; DOCT-06 tier-equivalence becomes statistical | |
| Defer to researcher | Phase-researcher evaluates patterns | |

**User's choice:** Deterministic code, thin workflow body (Recommended)
**Notes:** DOCT-06 tier-equivalence becomes structural rather than statistical. Establishes "deterministic workflow body" as a first-class shape.

### Sub-question B: capability_check block format

| Option | Description | Selected |
|--------|-------------|----------|
| XML-like block with structured branches | <capability_check><requires><if_present><if_absent>; tag-regex/walker parser | ✓ |
| Inline conditional prose, regex-parsed | [TIER1: ...] [TIER2: ...] markers; ambiguous nested | |
| Front-matter declares capabilities, body uniform | YAML capabilities block; no per-step branching | |

**User's choice:** XML-like block with structured branches (Recommended)
**Notes:** No markdown AST dep; phase 2 doctor.md doesn't actually need branching blocks (deterministic, always probes everything); parser ships in Phase 2 but is load-bearing starting in Phase 3.

---

## Area 6: Doctor output + severity model

### Sub-question A: Severity + exit codes

| Option | Description | Selected |
|--------|-------------|----------|
| PASS / WARN / FAIL / SKIP; exit 0 unless FAIL | Four levels; WARN/SKIP non-blocking | ✓ |
| PASS / WARN / FAIL only | No SKIP; probes that don't apply just don't appear | |
| PASS / WARN / FAIL + --strict mode | --strict promotes WARN→FAIL for CI; two exit-code modes | |

**User's choice:** PASS / WARN / FAIL / SKIP; exit 0 unless any FAIL (Recommended)
**Notes:** SKIP useful for "intake fixture: SKIPPED (Phase 3+)" wiring-smoke DoD.

### Sub-question B: Default output format

| Option | Description | Selected |
|--------|-------------|----------|
| JSON-first, --format=human renders | Default JSON; human renderer over same ProbeReport | |
| Human-first, --json flag for machine | Default prose; --json switches | ✓ |
| Always emit both (TSV-friendly) | Structured prose, no --json mode | |

**User's choice:** Human-first, --json flag for machine output
**Notes:** Friendlier first interaction; tier-contract test always passes --json.

### Sub-question C: Sync-folder detection algorithm

| Option | Description | Selected |
|--------|-------------|----------|
| Path-substring match against known folder names | Walk .paper/ parents; case-insensitive substring match | ✓ |
| Path-substring + Windows reparse-point fallback | Adds Win32 API surface for OneDrive's reparse-point mount | |
| Marker-file lookup | .onedrive / .dropbox / .icloud markers | |

**User's choice:** Path-substring match against known folder names (Recommended)
**Notes:** Portable, ~30 LOC, false-positive risk low. Match list: OneDrive, OneDrive - , iCloud Drive, CloudStorage, Dropbox, Google Drive, GoogleDrive, pCloud, Box.

---

## Area 7: Tier-contract test scaffolding

### Sub-question A: Comparison strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Strict-equal for deterministic; ±20% for prose | Each case declares kind: 'deterministic' or 'prose'; prose has lengthTolerance | ✓ |
| Strict-equal only, defer prose-tolerance to Phase 4 | Cleaner Phase 2 surface; rework when Phase 4 arrives | |
| Semantic-diff via canonical JSON + AST diff lib | Third-party canonical JSON + AST diff; dep weight; overkill | |

**User's choice:** Strict-equal after normalization for deterministic; ±20% for prose (Recommended)
**Notes:** Each contract-test case declares its kind upfront; doctor is the first deterministic case.

### Sub-question B: Normalization rules

| Option | Description | Selected |
|--------|-------------|----------|
| Paths + timestamps + key-order in a single helper | tests/lib/normalize-probe-report.ts; one place to extend | ✓ |
| Per-test normalization rules | Each case declares own config; risks divergence | |
| No normalization — fail on any difference | Forces both tiers to produce identical JSON; constrains design | |

**User's choice:** Option 1 — single shared helper, with specific implementation guidance
**Notes (user verbatim, condensed):** Per-test rules (Option 2) defeats the gate by making "the tiers agree" mean whatever the loudest test allows. Zero-normalization (Option 3) is a real position but wrong for doctor specifically — forcing no timestamps + no durations would gut debugging value (those are what users paste into bug reports). Implementation must: (a) sort keys recursively before stringify, (b) structure probes as a Record keyed by probe.id (kills array-order question at source — Tier 1 may probe in parallel, Tier 2 sequentially), (c) normalize path separators `\\` → `/` AFTER placeholder substitutions, (d) pin Node to major.minor in CI to avoid patch-bump churn, (e) drop hostname + PID. Locked in CONTRIBUTING.md: discipline rule that "default fix is to make tiers agree, not to add a normalizer rule" — without it Option 1 degrades into Option 2 over time. Keep probe_ms in schema and normalize them (debugging value outweighs marginal cleanliness).

### Sub-question C: CI wiring

| Option | Description | Selected |
|--------|-------------|----------|
| Required check on existing 3-OS matrix + CONTRIBUTING.md rule | npm run test:tier-contract step in ci.yml; branch protection toggle | ✓ |
| Separate dedicated CI job | tier-contract.yml workflow; doubles cold-start | |
| Pre-commit hook + CI required check | --no-verify-skippable; contributor friction | |

**User's choice:** Option 1 — required check on existing 3-OS matrix, with implementation details
**Notes (user verbatim, condensed):** Phase 0 already paid for the 3-OS matrix; one new step inherits the coverage for free. Specific implementation calls:
- **Add as STEP not JOB** — same job, separate step (`- run: npm run test:tier-contract` after `- run: npm test`). Failed step appears as "tier-contract" in GitHub check log without paying for a second cold start.
- **Branch protection is a one-time manual step** — explicit Phase 2 checklist item. Phase 2 plan MUST include: "In GitHub branch protection for `main`, add `test (linux-x64)`, `test (macos-arm64)`, `test (windows-x64)` as required status checks. Document the exact check names in CONTRIBUTING.md so they survive workflow renames."
- **Self-enforcing pre-flight assertion at tests/tier-contract/preflight.test.ts** — globs workflow bodies + cases; asserts every workflow has a corresponding case. Mechanically enforced; CONTRIBUTING.md just documents what's already checked.
- **`<!-- LOCKED -->` block in CONTRIBUTING.md** — locks the contract-test discipline rule + the required-check name list. 4-layer gate: CI step + required-status-check + preflight assertion + locked prose.

---

## Claude's Discretion

- citty verb-handler signature and where workflow-body loading code physically lives → planner
- Pre-flight workflow-id derivation (filename slug vs. front-matter field) → planner
- Exact `--json` ProbeReport zod schema details → planner derives, user vision is "presence-flags + per-probe severity"
- Hooks.json field-level wiring (PreCompact 10s timeout already locked; PostToolUse mtime-gate threshold) → planner

## Deferred Ideas

- Failure-mode contract beyond `<capability_check>` (dropped from discuss as ruthless sizing; surfaces in plan-phase when each component's degradation path gets designed)
- DOCT-05.v3 Phase 3 extension — registered in CONTEXT.md D-04
- Bare /pensmith state-aware routing — explicitly Phase 5
- MCP transport beyond stdio — future phase, separate auth design
- Per-process RuntimeConfig cache (FLAG-07 follow-up) — revisit if Phase 3+ load profile shows it matters
- CI matrix observation — push completed 2026-05-14; verify green before plan-phase but not gating
