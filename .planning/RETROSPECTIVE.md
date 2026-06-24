# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v0.1.0 — Foundation

**Shipped:** 2026-06-22
**Phases:** 11 (0–10) | **Plans:** 73 | **Tasks:** 126 | **Commits:** 453 | **Timeline:** 47 days (2026-05-06 → 2026-06-22)

### What Was Built
- The full two-tier architecture (Tier 1 Claude Code plugin + MCP server; Tier 2 portable Node CLI) from one shared source of truth, drift-gated by `tests/tier-contract.test.ts`.
- All Foundation NFR libraries green and unit-tested behind enforced chokepoints (HTTP via `http.ts`/D-06, atomic writes via `atomic-write.ts`/D-07, DOI regex/D-07, paths/D-41), with cross-platform paths, cost cap, locks, migrations, PII, and session log.
- The deterministic verifier gate: Pass 1 (DOI/author/title integrity → FABRICATED/MIS-CITED) + Pass 3 (quote verification → NOT_FOUND) blocking; Pass 2/4 advisory. Compile refuse-gate + zero-trace export (verified by test across `.docx/.pdf/.tex/.md`).
- Single-command UX (bare `/pensmith` router, 16 verbs bijective with 16 workflow bodies, NL triggers, `--dry-run/--estimate/--yolo/--show-prompts`, doctor), plus breadth: library mode, per-paper style-match, educator mode, 8-style CSL rendering, RIS, Zotero MCP adapter, BYO PDF.
- 856 tests, 3-OS CI matrix (ubuntu/macos/windows × Node 20.18) green on `origin/main`.

### What Worked
- **Section-as-phase isolation held under load.** Re-doing a section never disturbed siblings (mtime-proven), exactly as the load-bearing model predicted across all 11 phases.
- **Enforced chokepoints beat discipline.** Making `http.ts`/`atomic-write.ts`/`doi.ts` the *only* legal call sites (ESLint AST rules + red-team fixtures) meant cross-cutting invariants couldn't silently regress.
- **RED-by-skip TDD convention** (skip-guarded behavioral tests on `existsSync`/symbol feature-detect) kept the full suite green throughout while still encoding the contract before the module existed.
- **Cross-AI plan convergence** (codex + claude + opencode quorum) drove every phase to 0 HIGH concerns before execution; per-phase `gsd-verifier` caught real gaps.

### What Was Inefficient
- **Local-green / CI-red gap.** Five environment-specific failures (gitignored generated files persisting locally, macOS data-dir resolution, an unref'd timer starved on non-TTY stdin, a pdf-parse Linux flake, a /var→/private/var lock-path mismatch) only surfaced *after* the first GitHub push — because `npm run check` didn't mirror CI ordering and was never run from a clean checkout.
- **Scaffold-without-wiring went undetected until milestone review.** Per-phase verification confirmed "tasks complete," but the *generative* seams (Tier-2 LLM transport never built, `research` returns zero candidates, citation style never applied at export) were left as placeholders. No phase had an end-to-end smoke that would have flagged "the CLI can't actually generate a paper."
- **STATE.md accreted noise** (duplicate Performance-Metrics rows, a stale 96% progress bar) because per-plan appends were never reconciled.

### Patterns Established
- Chokepoint + red-team-fixture + regression-test triad for any cross-cutting invariant.
- `verified_against_draft_hash` staleness flagging so post-verification edits can't silently ship.
- WN-3 prompt-hash sentinels (`__PENDING_HASH_` → real SHA-256 atomic re-pin) for hash-pinned prompt files.
- Advisory-vs-blocking split in the verifier: re-fetch-the-source integrity is deterministic + blocking; LLM judgment is advisory and never auto-blocks.

### Key Lessons
1. **Make local == CI before the first push.** Prebuild-first `npm run check` + a fresh-clone CI job with a `git status --porcelain` clean assertion would have caught 3 of the 5 ship-time breaks for free. (→ v0.2.0)
2. **"Tasks complete" ≠ "feature works end-to-end."** Per-phase verification needs at least one non-placeholder e2e smoke per user-facing capability, or scaffolding masquerades as shipped. The milestone audit understated this; the multi-dimension review caught it. (→ v0.2.0 top priority: Tier-2 transport + live research)
3. **Latent hazards found in tests are real production bugs.** The lock-path mismatch fixed for a macOS test is the same `lock.ts` raw-key-hashing hazard that lets two callers acquire "the same" lock in production. Treat test-surfaced environment bugs as code defects, not test quirks. (→ v0.2.0 lock-key canonicalization)

### Cost Observations
- Model mix: Opus-heavy — the autonomous plan→converge→execute→verify pipeline ran largely on Opus 4.8 (1M context); cross-AI review fanned out to external CLIs (codex/gpt-5.5, claude, opencode; gemini dropped on tier ineligibility). Exact opus/sonnet/haiku percentages were not instrumented this milestone.
- Sessions: multiple, spanning the 47-day window; not precisely counted (context was compacted several times mid-build).
- Notable: the final ~5 commits (CI fixes) cost several push→CI round-trips that a clean-checkout local gate would have collapsed into one.

---

## Milestone: v0.2.0 — End-to-End

**Shipped:** 2026-06-24
**Phases:** 6 (11–16) | **Plans:** 26 | **Tasks:** 33 | **Tests:** 856 → 966 | **CI:** 3-OS green (run 28093018921)

### What Was Built
The generative seams the Foundation milestone scaffolded, connected: the Tier-2 LLM transport (`anthropic.ts`, all 6 verbs), live research discovery (`research-orchestrator.ts`), intake STATE.json bootstrap, the Tier-1 humanizer Task seam, citation rendering at export (in-text + bibliography), the fail-closed verifier gate (missing-VERIFICATION refuse, shared verdict-rows, live retraction re-query, post-humanize re-verify), the security hardening pass (SSRF, recursive PII, lock-key canon, prompt fencing, GPTZero consent, FIFO bucket, SECURITY.md), and CI/DX parity (prebuild-first check, porcelain + coverage + non-TTY gates, real README, filled bodies).

### What Worked
- **Per-phase code-review caught what verification missed — every phase.** Verification (often on a single fixture) passed, then the adversarial code-review found real bugs the fixture didn't exercise: the `--yolo` GATE-04 escape (P14), the empty-cassette SSRF bypass (P14), the `[@key p.5]` locator-citation leak (P13), the missing-IP-range SSRF gaps (P15), the CGNAT/hex-IPv6 bypasses (P15). The find→adversarially-verify→fix loop is load-bearing.
- **Wave-parallelism with strict file-ownership** (Phase 15's 5-way + Phase 14's 3-way) executed cleanly — the plan-checker's file-ownership map prevented same-file collisions.
- **The Phase-11 `%20` test-infra fix** (fileURLToPath) immediately surfaced a real outline-approval-gate bug that had been silently skipping.

### What Was Inefficient
- **CI was RED for the entire milestone (Phases 11–15) and I didn't notice until milestone-audit time.** I pushed each phase and verified locally (green) but only checked the real 3-OS matrix at the end — exactly the v0.1.0 lesson #1, re-committed. A single macOS-only test (T-11-08, a hardcoded-data-dir bug — the SAME class as v0.1.0 Fix A) failed for 5 phases. Local `npm run check` can't catch a macOS path divergence on a Windows dev box.
- **Parallel-wave executors each saw the others' in-flight edits** as transient lint/test failures, costing a re-verify pass per wave to confirm the merged state.

### Patterns Established
- Adversarial code-review as a mandatory gate after every phase's verification (not optional) — it has a near-100% hit rate on real bugs here.
- Honest SECURITY.md downgrade: fix the cheap real bypasses, document the harder residuals as `PROVEN-with-residual` rather than overclaim.
- WN-3 dual-pin discipline for any hash-pinned prompt/copy edit (both pin sites, same commit).

### Key Lessons
1. **Check the real CI matrix after EVERY push, not just locally — and especially not just at milestone end.** The v0.1.0 retrospective said "make local==CI"; v0.2.0 proved that's necessary but not sufficient — you must also *watch CI*. A macOS-only path bug is invisible on a Windows dev box no matter how green local is. (→ v0.3.0: live-path/cross-OS smoke + actually gating on CI per-push.)
2. **The hardcoded-data-dir class recurs.** T-11-08 hardcoded `tmpRoot/pensmith` instead of `pensmithDataDir()` — identical to v0.1.0's Fix A. Any test that writes where a chokepoint reads MUST use the chokepoint's own path helper.
3. **"Verified" on one fixture ≠ correct.** Code-review's adversarial inputs (locator citations, empty cassettes, --yolo, exotic IPs) caught what fixture-based verification structurally couldn't.

### Cost Observations
- Model mix: planning on Opus, researcher/pattern-mapper/checker/executor/reviewer/verifier on Sonnet. Each phase ≈ research + pattern-map + plan + plan-check + N execute waves + verify + code-review + code-fix.
- Notable: the per-phase code-review + fix cycle roughly doubled per-phase agent count but caught ~2 real bugs/phase — high ROI.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v0.1.0 Foundation | 11 | 73 | Baseline: GSD plan→converge→execute→verify with cross-AI 0-HIGH convergence and enforced chokepoints |
| v0.2.0 End-to-End | 6 | 26 | Added mandatory per-phase adversarial code-review + fix (caught ~2 real bugs/phase that verification missed); wave-parallel execution with file-ownership maps |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v0.1.0 Foundation | 856 | not gated (add c8 in v0.2.0) | normalize/fuzzy (hand-rolled), PII redaction, claim extraction |
| v0.2.0 End-to-End | 966 | gated (c8: ~85.5/71.5/90 lines/branch/funcs) | research-orchestrator dedup, verdict-rows render/parse, deepRedactPii, SSRF classifier, FIFO TokenBucket |

### Top Lessons (Verified Across Milestones)

1. **CONFIRMED (both milestones): make local == CI AND watch the real CI matrix per-push.** v0.1.0: 5 OS-specific failures only surfaced on the matrix. v0.2.0: a macOS-only test (T-11-08) stayed red for 5 phases because I verified locally but didn't check the matrix until milestone-audit. Local-green is necessary, not sufficient — a cross-OS path bug is invisible on one dev OS.
2. **CONFIRMED (both milestones): the hardcoded-data-dir bug class recurs.** v0.1.0 Fix A (tier-contract) and v0.2.0 T-11-08 were the SAME bug — a test writing to a hardcoded path instead of the chokepoint's `pensmithDataDir()` helper, which only diverges on macOS. Any test that writes where a chokepoint reads MUST use the chokepoint's path helper.
3. **CONFIRMED: adversarial review beats fixture-based verification.** v0.1.0's multi-dimension review and v0.2.0's per-phase code-reviews each caught real bugs (gate bypasses, injection breakouts, missing IP ranges) that "verified-on-a-fixture" passed. Build the adversarial pass in, don't bolt it on.
