# Roadmap: pensmith

## Milestones

- ✅ **v0.1.0 Foundation** — Phases 0–10 (shipped 2026-06-22) — full two-tier architecture, Foundation NFRs, the deterministic verifier gate, compile/export pipeline, single-command UX, and the citation/style libraries. Archive: [milestones/v0.1.0-ROADMAP.md](milestones/v0.1.0-ROADMAP.md).
- ✅ **v0.2.0 End-to-End** — Phases 11–16 (shipped 2026-06-24) — connected the generative seams: Tier-2 LLM transport, live research discovery, citation rendering at export, fail-closed verifier gate, foundation/security hardening, CI/DX + docs parity. 25/25 requirements; 3-OS CI green. Archive: [milestones/v0.2.0-ROADMAP.md](milestones/v0.2.0-ROADMAP.md).
- 📋 **v0.3.0** — *(planned)* — make the pipeline truly end-to-end: feed discovered LIBRARY.json sources into the plan/outline/write prompts (the v0.2.0 carried-forward tech-debt headline), plus the v2/Future backlog (figure/table handling, partial-draft resume, reference dedup, live-path smoke CI) and the documented security residuals (DNS-rebind socket-pinning, worker-thread PDF abort).

## Phases

<details>
<summary>✅ v0.1.0 Foundation (Phases 0–10) — SHIPPED 2026-06-22</summary>

- [x] Phase 0: Repo skeleton & plugin manifest (4/4) — 2026-05-07
- [x] Phase 1: Foundation NFRs (14/14) — 2026-05-14
- [x] Phase 2: Tier shells + doctor + tier-contract gate (10/10) — 2026-05-16
- [x] Phase 3: Vertical slice through one section (10/10) — 2026-05-28
- [x] Phase 4: Breadth — N sections + compile + wave scheduling (5/5) — 2026-06-17
- [x] Phase 5: Verifier completeness (Pass 2 + Pass 4) (5/5) — 2026-06-18
- [x] Phase 6: Done / export pipeline + zero-trace gate (5/5) — 2026-06-18
- [x] Phase 7: Single-command UX layer + hooks + flags (4/4) — 2026-06-19
- [x] Phase 8: Style match + sketch + add + library + BYO PDF polish (7/7) — 2026-06-20
- [x] Phase 9: Educator/tutorial mode + PII polish (4/4) — 2026-06-20
- [x] Phase 10: Discipline + citation-style breadth + Zotero MCP (5/5) — 2026-06-22

Full detail: [milestones/v0.1.0-ROADMAP.md](milestones/v0.1.0-ROADMAP.md) · [-REQUIREMENTS.md](milestones/v0.1.0-REQUIREMENTS.md) · [-MILESTONE-AUDIT.md](milestones/v0.1.0-MILESTONE-AUDIT.md). Phase dirs: `milestones/v0.1.0-phases/`.

</details>

<details>
<summary>✅ v0.2.0 End-to-End (Phases 11–16) — SHIPPED 2026-06-24</summary>

- [x] Phase 11: Tier-2 LLM transport (4/4) — GEN-01/02/06 — 2026-06-22
- [x] Phase 12: Live research + intake bootstrap + humanizer Task (4/4) — GEN-03/04/05 — 2026-06-22
- [x] Phase 13: Citation rendering at export (2/2) — REND-01/02/03 — 2026-06-24
- [x] Phase 14: Fail-closed verifier gate (4/4) — GATE-01/02/03/04 — 2026-06-24
- [x] Phase 15: Foundation & security hardening (8/8) — HARD-01..06 — 2026-06-24
- [x] Phase 16: CI/DX parity + docs & packaging (4/4) — CI-01/02/03 + DOCS-01/02/03 — 2026-06-24

25/25 requirements satisfied; 3-OS CI green (run 28093018921). Audit: `tech_debt` (accepted — the LIBRARY.json→plan/outline/write context feed carried to v0.3.0). Full detail: [milestones/v0.2.0-ROADMAP.md](milestones/v0.2.0-ROADMAP.md) · [-REQUIREMENTS.md](milestones/v0.2.0-REQUIREMENTS.md) · [-MILESTONE-AUDIT.md](milestones/v0.2.0-MILESTONE-AUDIT.md). Phase dirs: `milestones/v0.2.0-phases/`.

</details>

### 📋 v0.3.0 (planned)

Next milestone — scope via `/gsd:new-milestone`. Carried-forward headline: wire discovered LIBRARY.json sources into the plan/outline/write prompts so a full-pipeline paper's planner/writer actually use the sourced research (the v0.2.0 tech-debt #1). Plus the v2/Future backlog and the two documented security residuals.

## Progress

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v0.1.0 Foundation | 0–10 (11) | 73 | ✅ Complete | 2026-06-22 |
| v0.2.0 End-to-End | 11–16 (6) | 26 | ✅ Complete | 2026-06-24 |

---
*Roadmap initialized: 2026-05-06 from PRD.md*
*v0.1.0 archived 2026-06-22 · v0.2.0 archived 2026-06-24*
