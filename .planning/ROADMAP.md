# Roadmap: pensmith

## Overview

Pensmith ships in eleven prescriptive phases derived from the architecture's three-ring dependency model (Foundation NFRs → Domain libraries → Workflow surface) and the 18 documented pitfalls. Phase 0 stands up the repo skeleton and plugin manifest. Phase 1 lands every Foundation NFR — atomic write, lock, DOI normalization, HTTP client, budget, migrations, PII, session log, state, library, checkpoint, runtime — green and unit-tested before a single feature ships, in strict dependency order. Phase 2 brings up both tier shells (Tier 1 plugin + Tier 2 CLI) and `tests/tier-contract.test.js` as a hard merge gate from this phase forward, with `/pensmith doctor` (including OneDrive/iCloud/Dropbox/Google Drive detection) as the first contract case. Phase 3 is the architectural proof: a vertical slice through ONE section end-to-end (intake → research → outline → plan → write → verify) with deterministic Pass 1 + Pass 3 only, APA only, on a single fixture. Phase 4 widens to N sections + compile + wave scheduling. Phase 5 adds advisory verifier passes (Pass 2 + Pass 4). Phase 6 is the export pipeline (plagiarism, honesty, humanizer, Pandoc) gated by the zero-trace test. Phase 7 lands the single-command UX layer + hooks + flags. Phase 8 ships style match + sketch + add + library polish. Phase 9 ships educator/tutorial mode + PII polish. Phase 10 widens citation styles (CSL via citeproc-js), discipline presets, and Zotero MCP. The verifier blocks compile and export from Phase 3 onward; no phase weakens that gate. Pensmith is a CLI / plugin tool — no traditional UI surface in any phase.

## Phases

**Phase Numbering:**
- Integer phases (0, 1, 2, …): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 0: Repo skeleton & plugin manifest** - Repo, plugin manifest, MCP entry, CI on three OSes, ban-list lints — COMPLETE 2026-05-07
- [x] **Phase 1: Foundation NFRs** - paths → atomic-write → lock → doi → http → budget → migrations → pii → session-log → state/library/checkpoint → runtime, in strict order, all unit-tested — COMPLETE 2026-05-14 (VERIFICATION PASS 5/5 SCs)
- [ ] **Phase 2: Tier shells + doctor + tier-contract gate** - MCP server skeleton + Tier 2 CLI dispatcher + ecosystem probe + `/pensmith doctor` (with OneDrive detection) as first contract case
- [ ] **Phase 3: Vertical slice through one section** - Single-fixture intake → research → outline → plan → write → verify, deterministic Pass 1 + Pass 3 only, APA only, both tiers
- [ ] **Phase 4: Breadth — N sections + compile + wave scheduling** - Wave scheduler, compile pipeline, cross-section consistency flags, stable section numbering with letter suffixes
- [ ] **Phase 5: Verifier completeness (Pass 2 + Pass 4)** - LLM-judged claim support and per-paragraph orphan-claim audit, advisory only
- [ ] **Phase 6: Done / export pipeline + zero-trace gate** - Plagiarism, honesty, humanizer wrap, Pandoc exports, zero-trace verification test
- [ ] **Phase 7: Single-command UX layer + hooks + flags** - `/pensmith` umbrella, verb shortcuts, natural-language triggers, resume/PreCompact/PostToolUse/Stop hooks, `--yolo`/`--dry-run`/`--estimate`/`--show-prompts`
- [ ] **Phase 8: Style match + sketch + add + library + BYO PDF polish** - Style-match opt-in (per-paper, dual-use disclosed), sketch, add, library mode, PDF ingestion polish
- [ ] **Phase 9: Educator/tutorial mode + PII polish** - Tutorial-mode end-state, intake `goal=learning`, PII polish
- [ ] **Phase 10: Discipline + citation-style breadth + Zotero MCP** - Full CSL catalog, RIS export, remaining disciplines, Zotero MCP source provider

## Phase Details

### Phase 0: Repo skeleton & plugin manifest
**Goal**: Repository, plugin manifest, MCP entry, and CI discipline are in place before any code that needs them.
**Depends on**: Nothing (first phase)
**Requirements**: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05
**Success Criteria** (what must be TRUE):
  1. `npm run lint`, `tsc --noEmit`, and `npm test` all pass on linux-x64, macos-arm64, and windows-x64 in CI. (`npm test` invokes `scripts/run-tests.mjs` which discovers `tests/**/*.test.ts` and runs them via `node --import tsx --test`.)
  2. `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` validate against the Claude Code plugin schema.
  3. `.mcp.json` declares the pensmith MCP server entry point.
  4. Lint forbids direct `fetch` / `http` / `https` / `undici` imports anywhere outside `bin/lib/http.ts`, and forbids `/^10\./` regex outside `bin/lib/doi.ts`.
  5. README skeleton, `PRIVACY.md` skeleton, MIT `LICENSE`, and `.gitignore` exist.
**Plans**: 4 plans
Plans:
- [x] 00-01-PLAN.md — Root config files + source-tree skeleton + stubs (REPO-01, REPO-03) — COMPLETE 2026-05-07
- [x] 00-02-PLAN.md — ESLint flat config + chokepoint rules + red-team fixture + repo-files smoke test (REPO-05) — COMPLETE 2026-05-07
- [x] 00-03-PLAN.md — plugin.json + marketplace.json + .mcp.json + manifest validator + manifest tests (REPO-02, REPO-03) — COMPLETE 2026-05-07
- [x] 00-04-PLAN.md — GitHub Actions CI matrix on linux-x64/macos-arm64/windows-x64 (REPO-04) — COMPLETE 2026-05-07
**UI hint**: no

### Phase 1: Foundation NFRs
**Goal**: Every Foundation library (paths, atomic-write, lock, DOI, HTTP, budget, migrations, PII, session-log, state, library, checkpoint, runtime) is green, unit-tested, and ready to be depended upon by every later phase.
**Depends on**: Phase 0
**Requirements**: ARCH-05, ARCH-06, ARCH-07, ARCH-08, ARCH-09, ARCH-10, ARCH-11, ARCH-12, ARCH-13, ARCH-14, ARCH-15, ARCH-16, ARCH-17, TEST-05, TEST-06, TEST-07, TEST-08, TEST-11
**Success Criteria** (what must be TRUE):
  1. All thirteen Foundation libs ship with passing unit tests offline; CI matrix is green on linux-x64, macos-arm64, windows-x64.
  2. DOI normalization round-trip property test asserts idempotence; trailing-punctuation, ASCII-only case-fold, arXiv old/new format, and PMID/PMCID separation cases pass.
  3. Lock conflict test passes — a second runner detects an active lock with PID + hostname + heartbeat and waits or aborts cleanly; lock file lives in the platform local-only data dir, never inside `.paper/`.
  4. Budget abort test fires *before* the LLM call (verified with cost-fixture test), not after billing; `--max-parallel` cap enforced; `OPENALEX_API_KEY` config slot exists even if unused.
  5. HTTP client emits a one-time WARN when `PENSMITH_CONTACT_EMAIL` is unset and proceeds with a generic User-Agent (per PRD §12 free-basics framing — no key needed); doctor surfaces the same warning per `DOCT-03`. Client honors `Retry-After` / `X-Rate-Limit`; per-source rate-limit floors (Crossref 50/s, OpenAlex 15K/hr, arXiv 1/3s, PubMed 3/s) are enforced; cassette tests cover 429 / 503 / Retry-After cases AND the missing-email WARN-and-proceed path.
**Plans**: 14 plans

**Wave layout** (depends_on; executor reads `wave` frontmatter, not contiguous numbering):

- Wave 0: 01-00 (prep)
- Wave 1: 01-01 (paths)
- Wave 2: 01-02 (atomic-write)
- Wave 3: 01-03 (lock)
- Wave 4: 01-04 (doi), 01-05 (http), 01-06 (budget), 01-07 (migrations + 5 schemas), 01-08 (pii) — parallel
- Wave 9: 01-09 (session-log)
- Wave 10: 01-10 (state), 01-11 (library), 01-12 (checkpoint) — parallel
- Wave 11: 01-13 (runtime)

Plans:

- [x] 01-00-PLAN.md (wave 0) — CI Node 20.18 bump + 11 runtime + 4 dev deps + D-07/D-41 chokepoint rules + red-team fixtures + http-warnings copy + DOI corpus (REPO-04 carry-over, ARCH-12, TEST-11) — COMPLETE 2026-05-08
- [x] 01-01-PLAN.md (wave 1) — bin/lib/paths.ts (10 exports) + tests (ARCH-08, TEST-05, TEST-11) — COMPLETE 2026-05-08
- [x] 01-02-PLAN.md (wave 2) — bin/lib/atomic-write.ts + Win32 fsync(dirFd) guard + EXDEV fallback + tests (ARCH-05, TEST-05, TEST-11) — COMPLETE 2026-05-08
- [x] 01-03-PLAN.md (wave 3) — bin/lib/lock.ts via proper-lockfile CJS createRequire shim + cross-process serialization test (ARCH-06, TEST-05, TEST-07, TEST-11) — COMPLETE 2026-05-08
- [x] 01-04-PLAN.md (wave 4) — bin/lib/doi.ts (8 exports) + fast-check property test for idempotence (ARCH-15, TEST-05, TEST-06, TEST-11) — COMPLETE 2026-05-08
- [x] 01-05-PLAN.md (wave 4) — bin/lib/http.ts undici@7 + p-retry full-jitter shim + 8 cassettes + per-source TokenBucket (ARCH-12, ARCH-13, TEST-05, TEST-11) — COMPLETE 2026-05-08
- [x] 01-06-PLAN.md (wave 4) — bin/lib/budget.ts assertBudget pre-call gate + appendCost via O_APPEND + Semaphore + cost-fixture (ARCH-09, ARCH-10, ARCH-11, TEST-05, TEST-08, TEST-11) — COMPLETE 2026-05-08
- [x] 01-07-PLAN.md (wave 3) — bin/lib/migrations/loader.ts + ForwardIncompatError + 5 zod schemas (state/library/checkpoint/session-log/runtime-config) (ARCH-07, TEST-05, TEST-11) — COMPLETE 2026-05-08
- [x] 01-08-PLAN.md (wave 4) — bin/lib/pii.ts redactPii/redactKeys/classifyPii hand-rolled regex (ARCH-17, TEST-05, TEST-11) — COMPLETE 2026-05-08
- [x] 01-09-PLAN.md (wave 9) — bin/lib/session-log.ts D-49 kind-discriminated JSONL + 50MB rotation + 16KB oversize spillover + setMirrorPromptsToStderr (ARCH-16, TEST-05, TEST-11) — COMPLETE 2026-05-08
- [x] 01-10-PLAN.md (wave 10) — bin/lib/state.ts load/save/update/init under withLock (TEST-05, TEST-11) — COMPLETE 2026-05-08
- [x] 01-11-PLAN.md (wave 10) — bin/lib/library.ts addEntry duplicate-id-guarded under withLock (TEST-05, TEST-11) — COMPLETE 2026-05-08
- [x] 01-12-PLAN.md (wave 10) — bin/lib/checkpoint.ts atomic write/read primitives + tolerant reader for forward-version skip (TEST-05, TEST-11) — COMPLETE 2026-05-08
- [x] 01-13-PLAN.md (wave 11) — bin/lib/runtime.ts SDK provider chokepoint + OPENALEX_API_KEY slot + bin/lib/pricing.ts MODEL_PRICES (ARCH-14, TEST-05, TEST-11) — COMPLETE 2026-05-09
**UI hint**: no

### Phase 2: Tier shells + doctor + tier-contract gate
**Goal**: Both Tier 1 (Claude Code plugin shell, MCP server, hooks scaffolding) and Tier 2 (portable CLI dispatcher) bring up against Foundation libs; `/pensmith doctor` runs end-to-end in both tiers; `tests/tier-contract.test.js` is wired as a hard merge gate from this phase forward.
**Depends on**: Phase 1
**Requirements**: ARCH-01, ARCH-03, ARCH-18, TIER-01, TIER-02, TIER-03, TIER-04, TIER-05, TIER-06, TIER-07, DOCT-01, DOCT-02, DOCT-03, DOCT-04, DOCT-06, DOCT-07
**Success Criteria** (what must be TRUE):
  1. `/pensmith doctor` returns PASS in Tier 1 and `pensmith doctor` returns PASS in Tier 2; both produce equivalent structured output (modulo prose) verified by `tier-contract.test.js`.
  2. Doctor warns when `.paper/` lives inside a OneDrive / iCloud / Dropbox / Google Drive sync folder, on real fixture paths.
  3. Doctor probes ecosystem (Zotero MCP authenticated, Pandoc on PATH, humanizer skill at `~/.claude/skills/humanizer/`) and warns when `PENSMITH_CONTACT_EMAIL` is unset.
  4. MCP server (`mcp/server.ts`) exposes the read-only resources `paper://state`, `paper://outline`, `paper://section/{N}`, `paper://library`, `paper://capabilities` and idempotent state-mutation tools; tool handlers are ≤30 lines each (lint-checked) with all logic in `bin/lib/*`.
  5. `tests/tier-contract.test.js` exists, is wired into CI as a merge block, and CONTRIBUTING.md states every workflow body added in any later phase MUST add a contract-test entry.
**Plans**: 10 plans

Plans:

- [x] 02-00-PLAN.md (wave 0) -- Carry-forward + Wave 0 prep: parseRetryAfter extracted into bin/lib/retry.ts (D-01), citty^0.2.2 + zod dep, references/doctor-output.md locked copy (sha256-pinned), hooks/.gitkeep, tests/repo-files.test.ts extended — COMPLETE 2026-05-16 (8d5ac8e/deff862/e651435)
- [x] 02-01-PLAN.md (wave 1) -- D-09 thin-shim AST lint chokepoint + red-team fixture (ARCH-18) — COMPLETE 2026-05-16 (f6b7520/6f034cb/4c3cfe4)
- [x] 02-02-PLAN.md (wave 1) -- D-10 mcp-no-network AST lint chokepoint + red-team fixture (ARCH-18) — COMPLETE 2026-05-16 (339b728/a473ee7/9f4fcc2)
- [ ] 02-03-PLAN.md (wave 1) -- D-12 capabilities-no-leak AST lint chokepoint + red-team fixture (ARCH-18)
- [ ] 02-04-PLAN.md (wave 2) -- mcp/server.ts: MCP SDK ^1.29 + 5 paper:// resources (state/outline/section/{N}/library/capabilities) + 6 snake_case state-mutation tools, each handler <=30 stmts (TIER-01, TIER-02, TIER-06, ARCH-18)
- [ ] 02-05-PLAN.md (wave 2) -- bin/cli/pensmith.ts citty dispatcher (17 verbs, 1 real + 16 stubs) + doctor verb with 8 probes incl. Zotero/Pandoc/humanizer ecosystem + runtime-config-presence (TIER-04, DOCT-01..04, DOCT-07)
- [ ] 02-06-PLAN.md (wave 2) -- hooks/ scaffolding (4 lifecycle stubs: session-start/stop/pre-compact/post-tool-use) + hooks.json manifest + workflows/*.md (17 stubs with full capability_check blocks) + manifest validator extension (TIER-03, TIER-07, ARCH-01, ARCH-03)
- [ ] 02-07-PLAN.md (wave 3) -- tests/tier-contract.test.ts (4 cases A-D via official MCP Client + StdioClientTransport) + tier-contract preflight test (D-13/D-24) + assert-tier-equivalent helper (±20%) + CI step (TIER-06, TIER-07, DOCT-06)
- [ ] 02-08-PLAN.md (wave 4) -- CONTRIBUTING.md Tier contract section (D-24, locked) + tolerance-helper documentation + tests/repo-files.test.ts CF-D24 assertion
- [ ] 02-09-PLAN.md (wave 2) -- bin/lib/prompts.ts @clack/prompts numbered-prompt fallback (TIER-05)
**UI hint**: no

### Phase 3: Vertical slice through one section
**Goal**: A single fixture assignment runs end-to-end through intake → research → outline → plan → write → verify on ONE section in both tiers, proving the section-as-phase invariant before scaling to N sections. Deterministic Pass 1 + Pass 3 only; APA only.
**Depends on**: Phase 2
**Requirements**: ARCH-02, ARCH-04, INTK-01, INTK-02, INTK-03, INTK-04, INTK-05, RSCH-01, RSCH-02, RSCH-03, RSCH-04, RSCH-07, RSCH-08, RSCH-09, RSCH-11, OUTL-01, OUTL-02, OUTL-03, OUTL-04, PLAN-01, PLAN-04, WRTE-01, WRTE-03, WRTE-04, VRFY-01, VRFY-02, VRFY-04, VRFY-05, VRFY-07, VRFY-08, CITE-01, CITE-04, TEST-01, TEST-02, TEST-03, TEST-04, TEST-09
**Success Criteria** (what must be TRUE):
  1. The PRD §15 smoke test runs end-to-end through verify-section on one section in both Tier 1 and Tier 2, with equivalent verdicts, citation lists, and structure (modulo prose, ±20% length).
  2. `tests/fixtures/known-bad-citations.json` has 10+ fabricated DOIs and the verifier flags 10/10 as FABRICATED (Pass 1 deterministic).
  3. `tests/fixtures/known-bad-quotes.json` has 10+ NOT_FOUND fixtures of which ≥5 carry real PDF artifacts (ligature, soft hyphen, smart quotes, ellipsis variant, diacritic), and the verifier flags 10/10 (Pass 3 deterministic).
  4. The section-isolation mtime test asserts that re-doing section 3 leaves any other extant sections' mtimes unchanged — section state lives only under `.paper/sections/<NN-slug>/`.
  5. `tier-contract.test.js` is green for every workflow body added in this slice (intake, research, outline, plan-section, write-section, verify-section).
**Plans**: TBD
**UI hint**: no

### Phase 4: Breadth — N sections + compile + wave scheduling
**Goal**: Scale from one section to N. Wave scheduler honors `depends_on`; compile concatenates sections in outline order, runs cross-section smoothing read-only on section files, produces consistency flags (never edits), and refuses on any FABRICATED / MIS-CITED / quote NOT_FOUND. Stable section numbering with letter suffixes is locked.
**Depends on**: Phase 3
**Requirements**: ARCH-19, ARCH-20, PLAN-02, PLAN-03, WRTE-02, RSCH-10, COMP-01, COMP-02, COMP-03, COMP-04, COMP-05, COMP-06, COMP-07
**Success Criteria** (what must be TRUE):
  1. `pensmith compile` refuses on any section with FABRICATED / MIS-CITED / quote NOT_FOUND, citing the offending section + citation.
  2. Cross-section smoothing writes only to `.paper/DRAFT.md` and never modifies `sections/<N>/DRAFT.md` (read-only invariant verified by mtime + content-hash test).
  3. Wave scheduler topologically sorts sections by `depends_on` and respects `--max-parallel` (default 5) in Tier 1; Tier 2 executes the same order sequentially.
  4. Stable section numbering with letter-suffix policy (`03b-validity-threats/`) is enforced — inserts never renumber existing sections; `verified_against_draft_hash` flags compile-staleness when a section's draft changes after verification.
  5. `pensmith plan <N> --revise` and `pensmith plan <N> --research <query>` modify only the target section's PLAN.md and RESEARCH additions (no cross-section disturbance).
**Plans**: TBD
**UI hint**: no

### Phase 5: Verifier completeness (Pass 2 + Pass 4)
**Goal**: Add the LLM-judged advisory verifier passes — claim support (Pass 2) and per-paragraph orphan-claim audit (Pass 4). Advisory only; Pass 1 + Pass 3 remain the blocking gate.
**Depends on**: Phase 4
**Requirements**: VRFY-03, VRFY-06
**Success Criteria** (what must be TRUE):
  1. Pass 2 produces verdicts ∈ {SUPPORTED, PARTIAL, UNSUPPORTED, UNCLEAR} per claim, with prompts calibrated UNCLEAR-bias on adversarial fixtures. Pass 2 does not auto-block compile/export; per PRD §7.9, presence of any UNSUPPORTED, orphan claim, or plagiarism hit triggers a user-confirmation gate at `done` before export proceeds (the gate is implemented in Phase 6 export, not here).
  2. Pass 4 flags orphan claims per paragraph, with verdicts written to `sections/<N>/VERIFICATION.md`. Claim extraction is deterministic (pure-Node) per PRD §14 + VRFY-06; LLM is used only for advisory labeling of edge cases. Pass 4 never auto-blocks compile or export, but any orphan claim feeds the Phase 6 export-confirmation gate (DONE-09 / PRD §7.9).
  3. `tier-contract.test.js` confirms equivalent verdicts (modulo prose) for Pass 2 and Pass 4 across both tiers on the fixture set.
**Plans**: TBD
**UI hint**: no

### Phase 6: Done / export pipeline + zero-trace gate
**Goal**: Compiled drafts go through whole-paper Pass 4 audit, free distinctive-phrase plagiarism check, humanizer wrap (skip cleanly if absent), GPTZero honesty score before AND after humanize (framed honestly), then export to `.docx` / `.pdf` / `.tex` / `.md` with bundled `.bib`. Zero pensmith trace in any export, verified by test.
**Depends on**: Phase 5
**Requirements**: DONE-01, DONE-02, DONE-03, DONE-04, DONE-05, DONE-06, DONE-07, DONE-08, DONE-09, TEST-10
**Success Criteria** (what must be TRUE):
  1. The zero-trace export test scans every export format (`.docx`, `.pdf`, `.tex`, `.md`) for the string "pensmith" and any pensmith metadata field, and the result must be exactly zero occurrences (including `.docx` ZIP entries and PDF metadata).
  2. Humanizer wrap detects `~/.claude/skills/humanizer/`; skips with a clear banner when absent and never fails the export.
  3. GPTZero honesty score is reported before AND after humanize, with the framing "improves prose, not evades detection" rendered verbatim from a locked copy file (CONTRIBUTING.md rule prevents drift); backend pluggable to Originality / Sapling via config.
  4. Free distinctive-phrase plagiarism check via DuckDuckGo HTML produces an n-gram report; never blocks export by itself but warns user.
  5. Export confirmation gate prompts the user before writing exports. Per PRD §7.9 + REQUIREMENTS DONE-09, when any UNSUPPORTED claim, orphan claim (Pass 4), or plagiarism hit (DONE-02) is present, the gate shows a per-issue summary and requires explicit user confirmation before export. Generic confirmation also runs even with no issues. Skipped only with `--yolo`.
**Plans**: TBD
**UI hint**: no

### Phase 7: Single-command UX layer + hooks + flags
**Goal**: `/pensmith` becomes the single state-aware command users learn; verb shortcuts, hidden plumbing namespace, natural-language triggers, inline conversational corrections, resume/PreCompact/PostToolUse/Stop hooks, and the `--yolo` / `--dry-run` / `--estimate` / `--show-prompts` flags all land.
**Depends on**: Phase 6
**Requirements**: UX-01, UX-02, UX-03, UX-04, UX-05, ERGO-01, ERGO-02, ERGO-03, ERGO-04, HOOK-01, HOOK-02, HOOK-03, HOOK-04
**Success Criteria** (what must be TRUE):
  1. `/pensmith` (bare) resolves state-aware behavior — intake / research / outline / next section / compile / done / resume — based on current `.paper/STATE.md` + `paper://state`.
  2. Verb shortcuts (`new`, `next`, `status`, `research`, `outline`, `plan <N>`, `write <N>`, `verify <N>`, `compile`, `done`, `resume`, `list`, `open`, `sketch`, `add`, `doctor`) all work in both tiers, and `/pensmith:plan-section`-style plumbing namespace is available for scripting.
  3. PreCompact hook writes a section-granular HANDOFF.json under 5KB (pointers, not content) within a 10s timeout; SessionStart auto-invokes resume; PostToolUse checkpoints at ≤1/min via mtime gate; Stop releases lock and flushes session log.
  4. Natural-language triggers ("redo section 3", "make it sound less AI", "where am I?") route to the correct skill via skill descriptions; inline conversational corrections (length change, add/drop section, swap source, redo section) work without leaving chat.
  5. `--dry-run` runs against cassette fixtures with zero external calls; `--estimate` projects tokens + USD before executing; `--yolo` skips outline + export approval (default off and refuses when estimate exceeds 50% of session cap); `--show-prompts` echoes every LLM prompt.
**Plans**: TBD
**UI hint**: no

### Phase 8: Style match + sketch + add + library + BYO PDF polish
**Goal**: Differentiated features after core is solid: style-match opt-in (per-paper profile only, no global cache, sample-set fingerprint, cross-paper reuse detected and surfaced, dual-use disclosure in README), `/pensmith sketch` thinking-partner mode, `/pensmith add <doi|pdf|url>`, library mode polish, and BYO PDF ingestion via `pdf-parse` pinned with `pymupdf` fallback.
**Depends on**: Phase 7
**Requirements**: LIB-01, LIB-02, LIB-03, LIB-04, LIB-05, ERGO-05, ERGO-06, RSCH-05, STYL-01, STYL-02, STYL-03, STYL-04
**Success Criteria** (what must be TRUE):
  1. `/pensmith list` shows all papers grouped by class; `/pensmith open <name>` switches active paper; status values cycle through `intake | research | outline | sectioning (X/Y) | compile | done | archived`.
  2. Style-match writes a per-paper `.paper/STYLE.json` profile (no global cache); sample-set fingerprint is stored, cross-paper reuse is detected and surfaced to the user; section drafter consumes profile + voice hint override; README ships dual-use disclosure.
  3. `/pensmith sketch` runs a thinking-partner thesis-discovery mode that does NOT advance state into intake until the user confirms.
  4. `/pensmith add <doi|pdf|url>` ingests a new source mid-paper and prompts "remap sections?"; ingestion accepts BYO PDFs via `pdf-parse` (pinned exact) with `pymupdf` shellout fallback, hydrating metadata via Crossref.
**Plans**: TBD
**UI hint**: no

### Phase 9: Educator/tutorial mode + PII polish
**Goal**: Educator/tutorial-mode end-state for `goal=learning` (annotated provenance, teaching wrappers) without leaking `if (educator_mode)` blocks into Foundation or workflow bodies; PII redaction polished beyond regex-only.
**Depends on**: Phase 8
**Requirements**: ERGO-07
**Success Criteria** (what must be TRUE):
  1. Intake `goal=learning` triggers the tutorial-mode end-state with annotated source provenance per claim; `goal=draft` and `goal=both` continue to work unchanged.
  2. Educator-mode is implemented as an event/wrapper architecture (observer pattern); workflow bodies and Foundation libs contain zero `if (educator_mode)` branches.
  3. PII redaction at intake-time honors the opt-in flag, runs before any LLM call, and produces a deterministic diff the user can review.
**Plans**: TBD
**UI hint**: no

### Phase 10: Discipline + citation-style breadth + Zotero MCP
**Goal**: Widen citation-style support via CSL + citeproc-js, add RIS export, ship remaining discipline-preset depth, and complete Zotero MCP source provider integration. Breadth that doesn't gate v0.1.0 launch.
**Depends on**: Phase 9
**Requirements**: RSCH-06, CITE-02, CITE-03, CITE-05
**Success Criteria** (what must be TRUE):
  1. APA 7, MLA, Chicago (notes-bib + author-date), IEEE, AMA, Vancouver, and Harvard all render correctly via `citation-js` + bundled CSL files in `templates/citation-styles/`.
  2. RIS export ships alongside BibTeX with the `.bib`/`.ris` files bundled into the export package for Mendeley/EndNote interop.
  3. Zotero MCP is detected, authenticated, and used as a source provider when present; doctor reports auth state; absence does not break research.
**Plans**: TBD
**UI hint**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Repo skeleton & plugin manifest | 4/4 | COMPLETE | 2026-05-07 |
| 1. Foundation NFRs | 14/14 | COMPLETE (VERIFICATION PASS 5/5) | 2026-05-14 |
| 2. Tier shells + doctor + tier-contract gate | 3/10 | Executing | - |
| 3. Vertical slice through one section | 0/TBD | Not started | - |
| 4. Breadth — N sections + compile + wave scheduling | 0/TBD | Not started | - |
| 5. Verifier completeness (Pass 2 + Pass 4) | 0/TBD | Not started | - |
| 6. Done / export pipeline + zero-trace gate | 0/TBD | Not started | - |
| 7. Single-command UX layer + hooks + flags | 0/TBD | Not started | - |
| 8. Style match + sketch + add + library + BYO PDF polish | 0/TBD | Not started | - |
| 9. Educator/tutorial mode + PII polish | 0/TBD | Not started | - |
| 10. Discipline + citation-style breadth + Zotero MCP | 0/TBD | Not started | - |

## Coverage

- v1 requirements: 131 total
- Mapped to phases: 131 ✓
- Unmapped: 0 ✓

Full traceability table lives in `.planning/REQUIREMENTS.md` § Traceability.

---
*Roadmap initialized: 2026-05-06 from PRD.md + research/SUMMARY.md (auto mode)*
