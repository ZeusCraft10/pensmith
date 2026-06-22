# Phase 4: Breadth — N sections + compile + wave scheduling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-29
**Phase:** 4-breadth-n-sections-compile-wave-scheduling
**Areas discussed:** Wave scheduler & --max-parallel, Section mutation + staleness, Narrow compile contract, Letter-suffix path reservation

---

## Initial Gray-Area Selection

The discuss-phase analysis surfaced six candidate gray areas. The AskUserQuestion tool capped multi-select at four, so I consolidated:

| Area | Description | Selected |
|------|-------------|----------|
| Wave scheduler & --max-parallel | How dependencies become waves; concurrency cap; failure semantics within a wave | ✓ |
| Compile pipeline shape | Smoothing strategy; refuse-logic; COMPILE-REPORT schema | ✓ |
| Letter-suffix insertion (ARCH-20) | Path scheme reservation only; insertion mechanics defer to Phase 8 | ✓ (narrowed to one decision) |
| Section mutation + staleness | --revise semantics; intra-section auto-loop; staleness hash inputs | ✓ |

**User added during selection:**
- Pushed hardest on verifier subagent prompt wording — I noted Phase 3 D-12/D-13 already hash-pinned all 8 prompt files dormant. **No re-discussion needed.** User acknowledged: "I inverted the PRD pass numbering and forgot D-12/D-13 hash-pinned the prompts dormant."
- Proposed locking an intra-section HANDOFF.json schema — I pushed back citing PRD §7.6: PLAN.md frontmatter + DRAFT.md + VERIFICATION.md **are** the intra-section contract; there is no plan→write→verify HANDOFF inside a section. User acknowledged: "The frontmatter-as-contract is cleaner than what I proposed. I was overengineering."
- Initially wanted to defer compile to Phase 5 — I pushed back: ROADMAP Phase 4 title literally reads "+ compile". User acknowledged: "Compile — fair catch."

---

## Area A: Wave Scheduler & --max-parallel

### A.1 Wave assignment strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Pure Kahn topological sort | Compute `wave = max(deps.wave) + 1`; no overrides | |
| OUTLINE.md-only declaration | Author writes `wave: N` per section; scheduler validates DAG | |
| Hybrid: Kahn default + OUTLINE override | Kahn computes default; per-section `wave: N` can override (with validation) | ✓ |

**User's choice:** Hybrid Kahn-with-depth default + per-section OUTLINE override (Recommended).
**Notes:** Validation rule: explicit override is rejected at outline-write time if `N < max(deps.wave) + 1`. Scheduler refuses to start until the outline is fixed; it does not silently bump.

### A.2 `--max-parallel` semantics

**User's choice:** "You decide" — locked to per-wave concurrency cap with full drain; default `--max-parallel 5`; Tier 2 forces 1 with WARN-once.
**Notes:** Each wave drains fully before the next begins. No cross-wave pipelining.

### A.3 Within-wave failure policy

| Option | Description | Selected |
|--------|-------------|----------|
| Abort whole wave on first failure | Stop siblings immediately | |
| Continue siblings; rollup at wave end | Failing section's siblings keep running; report at wave end | ✓ |
| Continue everything to completion | Even downstream waves run regardless of dep failure | |

**User's choice:** Continue siblings; report rollup at wave end (Recommended).
**Notes:** Downstream waves block **only on transitive dep failure**. Sections whose deps all passed proceed normally.

### A.4 Wave-state persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Separate `wave-progress.json` checkpoint | Scheduler writes its own state file | |
| Read-only from PLAN.md frontmatter | Section state lives only on PLAN.md; scheduler holds in-memory progress | ✓ |
| Hybrid: frontmatter + checkpoint | Both | |

**User's choice:** Read-only from PLAN.md frontmatter; in-memory wave progress (Recommended).
**Notes:** Crash recovery via re-read of frontmatter. No wave-checkpoint file. Source of truth is `state:` field per Phase 3 D-08.

---

## Area B: Section Mutation + Staleness

### B.1 `/pensmith --revise <N>` behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Manual citekey replacement | User edits PLAN.md sources[] by hand; pensmith re-runs writer+verifier | |
| LLM-driven citation swap with user approval gate | LLM proposes diff from VERIFICATION.md verdicts + research adapters; user approves | ✓ |
| Full section rewrite | Treat --revise as "redo section N from scratch" | |

**User's choice:** LLM-driven citation swap with user approval gate (Recommended).
**Notes:** Input includes existing sources[] and live research-adapter access (RSCH-10). Approval gate fires per PRD §19; `--yolo` skips approval but not the diff audit write.

### B.2 Intra-section auto-loop on verification failure

| Option | Description | Selected |
|--------|-------------|----------|
| Always auto-loop (silent retry) | Pensmith retries automatically up to N times | |
| Never auto-loop | Always surface to user | |
| Surface to user; auto-loop only with `--yolo` | Default surfaces; `--yolo` enables auto-retry | ✓ |

**User's choice:** Surface to user; auto-loop only with `--yolo` (Recommended).
**Notes:** Retry cap default = 2. Uses the same `--revise` code path, not a divergent loop. RETRY_EXHAUSTED verdict on cap-hit.

### B.3 `verified_against_draft_hash` input

| Option | Description | Selected |
|--------|-------------|----------|
| SHA-256 of DRAFT.md content only | Hash only the prose | |
| SHA-256 of DRAFT.md content + sorted sources[] | Hash prose + source set | ✓ |
| SHA-256 of DRAFT.md + sources + PLAN.md whole frontmatter | Hash everything | |

**User's choice:** SHA-256 of DRAFT.md content + sorted sources[] list (Recommended).
**Notes:** Concatenation: DRAFT.md bytes + `\n` + `JSON.stringify(sources.slice().sort())`.

### B.4 Compile-staleness policy

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse compile entirely on any stale section | Force user to manually re-verify | |
| Warn + auto-re-verify affected sections only | Compile re-runs Pass 1+3 (deterministic) on stale sections | ✓ |
| Silently re-verify without warning | No user-visible notice | |

**User's choice:** Warn + auto-re-verify affected sections only.
**Notes:** User chose differently from my recommendation. I had recommended refuse-and-prompt; user correctly noted Phase 4 verify is deterministic Pass 1+3 = HTTP+CPU bound, so auto-re-verify is cheap. Locked. Re-verify failure routes through standard refuse-logic.

### B.5 `--research` output destination

**User's choice:** "You decide" — locked to project-level append + per-section provenance log.
**Notes:** Project: append to `.paper/RESEARCH.md` + merge into `.paper/CITATIONS.bib` with `from_section:<N>` annotation. Per-section: `sections/<N>/RESEARCH-LOG.md` provenance entries.

---

## Area C: Narrow Compile Contract

### C.1 COMP-01 refuse-logic scope

**User explicit anchor (from initial response):** "'bad citation' in Phase 4 means Pass 1 OR Pass 3 deterministic fail only. Pass 2/4 ship advisory in Phase 5 and explicitly do not block compile."
**Locked.** Captured as D-10.

### C.2 COMP-03 smoothing read-only invariant

**User explicit anchor:** "smoothing is forbidden from adding, removing, reordering, or rewriting citation markers; it operates only on prose between markers and at section boundaries. Anything that changes citation identity/count/order is mutation and routes through --revise, not compile."
**Locked.** Captured as D-12 and D-13.

### C.3 Smoothing granularity

**User's choice:** "You decide" — locked to N-1 per-boundary LLM calls with section-role metadata.
**Notes:** Each call sees only last-para(K) + first-para(K+1) + `{role_K, role_K+1}` from OUTLINE.md. No cross-boundary state sharing. Isolates failures and keeps token cost predictable.

### C.4 Citation-marker guard mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Trust prompt instruction only | Tell LLM not to touch markers; hope | |
| Placeholder substitution + deterministic post-validation | Replace tokens with opaque placeholders; verify token-set equality | ✓ |
| Whole-prose diff approval gate | User reviews every boundary diff | |

**User's choice:** Placeholder substitution + deterministic post-validation.
**Notes:** Smoother sees `{{cite_K_M}}` placeholders, never citekeys. Post-call equality check on token-set. Mismatch → reject smoothing, keep original, flag in COMPILE-REPORT (does not refuse compile).

### C.5 COMP-07 COMPILE-REPORT.md schema

**User explicit anchor:** "lock a stable slot for Phase 5's advisory Pass 2/4 findings (even if Phase 4 writes it empty) and a stable slot Phase 6 export reads from."
**User's choice:** "You decide" — locked to Recommended schema + Pandoc front-matter reserved.
**Notes:** Frontmatter has 5 reserved keys + 3 Pandoc-reserved (`title`, `author`, `abstract` for Phase 6). Body has 5 fixed-order sections including reserved "Advisory Findings" slot for Phase 5. Additive-forward — no version bumps for Phase 5/6 population.

---

## Area D: Letter-Suffix Path Reservation (ARCH-20)

| Option | Description | Selected |
|--------|-------------|----------|
| Ship full insertion mechanics in Phase 4 | `/pensmith add` + outline mutation + renumbering policy | |
| Reserve path scheme only; defer mechanics to Phase 8 | `NNl-slug` paths work; no insertion entry points | ✓ |
| Skip entirely | Phase 4 doesn't touch ARCH-20 | |

**User's choice:** Reserve path scheme only; defer mechanics to Phase 8.
**Notes:** Phase 4 obligation: path-walking code (OUTLINE reader, compile section discovery, scheduler dep-resolver) must tolerate letter-suffix names. Lexicographic sort gives `'03' < '03b' < '04'` for free. Phase 4 non-obligation: no `/pensmith add`, no renumber-vs-stable choice.

---

## Claude's Discretion

User explicitly delegated to me during discussion:
- **`--max-parallel` exact default** → 5 (matches typical N for academic papers).
- **`--research` output shape** → project-level append + per-section provenance.
- **Smoothing strategy granularity** → N-1 per-boundary calls (not whole-paper).
- **COMPILE-REPORT schema** → 5-section body + Pandoc-reserved frontmatter keys.

Remaining discretion for plan-phase:
- Smoother prompt wording (must enforce placeholder-token invariant).
- `--revise` swap prompt wording (must produce parseable diff).
- Cross-section consistency scan rules.
- Wave-state in-memory data structure.
- Concurrency primitive (Promise.all + p-limit / async queue / etc.).

---

## Deferred Ideas

- **Pass 2/4 wiring** → Phase 5 (advisory passes; prompts hash-pinned dormant in Phase 3).
- **`/pensmith add` insertion command** → Phase 8.
- **Renumber-vs-stable section numbering policy** → Phase 8.
- **Export to .docx/.pdf** → Phase 6.
- **Style-match featurization, GPTZero, humanizer** → Phase 6/7.
- **RSCH-10 auto-recheck timing detail** → plan-phase (which adapters does `--revise` re-poll?).
- **Cross-section consistency scan exact rules** → plan-phase.
- **Wave-progress streaming mechanism** → plan-phase (hook vs MCP notification vs stdout).

---

## Push-back Audit (User-Acknowledged Corrections)

For the record, three user proposals were pushed back on and revised during discussion:

1. **Verifier subagent prompt wording** — user wanted to lock prompts in Phase 4. I noted Phase 3 D-12/D-13 already hash-pinned all 8 prompts dormant. **No re-discussion.**
2. **Intra-section HANDOFF.json schema** — user proposed locking it. I pushed back: PRD §7.6 makes PLAN.md frontmatter + DRAFT.md + VERIFICATION.md the intra-section contract; there is no HANDOFF inside a section. **User accepted.**
3. **Pass 2/3 numbering inversion** — user initially wrote "Pass 2 (quote presence), Pass 3 (claim support)". PRD §7.7 has Pass 2 = LLM claim support, Pass 3 = deterministic quote. **User accepted PRD ordering.**
4. **Compile scope** — user initially wanted to defer compile to Phase 5. ROADMAP Phase 4 title is "+ compile". **User accepted.**
