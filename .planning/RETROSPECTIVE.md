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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v0.1.0 Foundation | 11 | 73 | Baseline: GSD plan→converge→execute→verify with cross-AI 0-HIGH convergence and enforced chokepoints |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v0.1.0 Foundation | 856 | not gated (add c8 in v0.2.0) | normalize/fuzzy (hand-rolled), PII redaction, claim extraction |

### Top Lessons (Verified Across Milestones)

1. *(awaiting v0.2.0 to cross-validate)* — make local == CI before pushing.
2. *(awaiting v0.2.0 to cross-validate)* — verify end-to-end usability, not just task completion.
