# Roadmap: pensmith

## Milestones

- ✅ **v0.1.0 Foundation** — Phases 0–10 (shipped 2026-06-22) — full two-tier architecture, Foundation NFRs, the deterministic verifier gate, compile/export pipeline, single-command UX, and the citation/style libraries. Archive: [milestones/v0.1.0-ROADMAP.md](milestones/v0.1.0-ROADMAP.md).
- ✅ **v0.2.0 End-to-End** — Phases 11–16 (shipped 2026-06-24) — connected the generative seams: Tier-2 LLM transport, live research discovery, citation rendering at export, fail-closed verifier gate, foundation/security hardening, CI/DX + docs parity. 25/25 requirements; 3-OS CI green. Archive: [milestones/v0.2.0-ROADMAP.md](milestones/v0.2.0-ROADMAP.md).
- **v0.3.0 Truly End-to-End** — Phases 17–19 (never started, not shipped) — absorbed into v1.0.0 on 2026-09-27. Its requirements keep their IDs: FEED-01..05 → Phase 18, SEC-01/02 → Phase 24, HARDEN-01/02/04 → Phase 26, HARDEN-03 → Phase 20; its deferred BRDTH-01..06 backlog → Phases 19 and 25.
- 🚧 **v1.0.0 Open Source Release** — Phases 17–27 (in progress) — finish the product and make it ready for open source: every category of the 2026-09-25 completeness assessment reaches 100%. 168 requirements covering all 200 gap-register items. Requirements: [REQUIREMENTS.md](REQUIREMENTS.md). Gap register: [research/V1-GAP-REGISTER.md](research/V1-GAP-REGISTER.md).

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

### 🚧 v1.0.0 Open Source Release (Phases 17–27) — in progress

v0.3.0 Truly End-to-End (Phases 17–19) was never started and is absorbed here: FEED → Phase 18, SEC → Phase 24, HARDEN → Phase 26 (HARDEN-03 → Phase 20). Phase numbers 17–19 are reused for the v1.0.0 phases. Locked design decisions D-V1-01..08 and the synthesis decisions are in [REQUIREMENTS.md](REQUIREMENTS.md).

- [ ] **Phase 17: Tier-2 Runtime Foundations (RUNTIME)** - Live network by default with disclosed offline mode, valid models and pricing, OpenAI-compatible/Ollama runtimes, working installed binary, documented exit codes, one paper root, session log, cost cap, and the test mock LLM
- [ ] **Phase 18: Grounded Generation (GROUND)** - Intake collects the assignment and answers, outline/plan/write run on validated contracts fed by the real topic and each section's own sources (FEED-01..05), counterargument and outline-only modes, and a full-workflow `--dry-run`
- [ ] **Phase 19: Sources and Library (SOURCES)** - Live-hardened adapters (arXiv https, Unpaywall, retractions, Crossref, OpenAlex/S2 keys), per-adapter failure reporting, evaluator tiers and policy, books/ISBN, round-trippable BibTeX, deduplicated library (BRDTH-01), correct `add`, BYO folder ingest, Zotero
- [ ] **Phase 20: Verifier Completeness (VERIFY)** - One citation grammar that fails closed, Pass 1 across Crossref/DataCite/arXiv/PubMed/ISBN with correct name matching and no fail-open, real Pass 3, Pass 2 on abstracts, Pass 4 orphans, gate recomputation in compile and done, freshness, HARDEN-03
- [ ] **Phase 21: Compile, Done and Export (EXPORT)** - Unpruned bibliography, correct styles and headings, zero-trace pandoc output, docx/pdf without pandoc, smoother, contradiction check, density map, a humanizer that runs, honest before/after scores, real plagiarism check, done flags and aliases
- [ ] **Phase 22: Revision Loop and Inline Corrections (REVISE)** - No verify loops, staleness propagation to compile/export, real `plan --revise`, length/add/drop/swap corrections, `list --class`/archive, learning-mode TUTORIAL.md, real sketch synthesis
- [ ] **Phase 23: Tier-1 Claude Code Plugin (PLUGIN)** - Spec-valid manifest/skills/hooks, committed bundles with no build step, install from the git marketplace, key-free generation through the user's Claude session with validating MCP tools, real state tools, hooks that run, a tier contract on the real plugin
- [ ] **Phase 24: Security (SEC)** - DNS-rebind IP pinning (SEC-01), worker-thread PDF abort (SEC-02), response-size cap, full security review of the v1.0.0 surface
- [ ] **Phase 25: Configuration and PRD Breadth (CONFIG)** - Every config.toml key validated and honored, presets used by every stage, schema versions, CAPABILITIES.json, PRD §13 reconciled, full doctor, figures/tables, mid-section resume, unverifiable-quote bucket, generated reference card, Phase-1 FLAG paydown (BRDTH-02..06)
- [ ] **Phase 26: CI and Test Hardening (HARDEN)** - Strict required e2e chain over the mock LLM (HARDEN-01), gate-bypass matrix, secrets-gated live lane in both tiers (HARDEN-02), real pandoc/PyMuPDF/Zotero in CI (HARDEN-04), real plugin validate/install, Node 22/24, live cassettes, coverage of spawned processes, integration inventory
- [ ] **Phase 27: Open-Source Release (RELEASE)** - Version 1.0.0, CHANGELOG, maintainer-triggered release workflow, correct npm package, marketplace listing, truthful README and docs/, community files, no stale markers, final completeness re-audit

## Phase Details

### Phase 17: Tier-2 Runtime Foundations (RUNTIME)
**Goal**: The Tier-2 CLI talks to real services with a model that works, tells the truth about what it did (exit codes, offline banner, session log, `--show-prompts`), keeps all paper state under `.paper/`, and gives every later phase a deterministic mock LLM to test against.
**Depends on**: Nothing (first v1.0.0 phase; builds on the shipped v0.2.0 transport, http.ts and state layers)
**Requirements**: RUN-01, RUN-02, RUN-03, RUN-04, RUN-05, RUN-06, RUN-07, RUN-08, RUN-09, RUN-10, RUN-11, RUN-12, RUN-13, RUN-14, RUN-15, RUN-16, RUN-17, RUN-18, RUN-19, RUN-20, RUN-21, RUN-22, RUN-23 (23)
**Success Criteria** (what must be TRUE):
  1. A user with no env vars runs `pensmith research` and gets live Crossref/OpenAlex results; offline replay happens only under `PENSMITH_OFFLINE=1`, `--dry-run` or the test runner, is announced on stderr and marked in every artifact (never in exports), and a missed fixture lookup is UNVERIFIABLE (offline), never another paper's record
  2. With only `ANTHROPIC_API_KEY` set, requests use `claude-opus-5`; with only `OPENAI_API_KEY`, the openai provider; every current model id prices without crashing and an unknown one uses a warned fallback; `--runtime ollama` and an OpenAI-compatible endpoint work against a local server while source adapters still cannot reach loopback
  3. Refusals and failures exit with the documented codes (4 blocked, 3 approval, 2 usage, 5 cost cap, 1 error), no expected failure prints a stack trace, and a typo'd verb suggests the right one and creates nothing
  4. `npm i -g` of the packed tarball and `npm link` give a working `pensmith` (`--version`, `--help`, `doctor`) and a working MCP server through symlinks, and the installed package never reads `tests/`
  5. All paper state lives under `.paper/` (legacy root files migrate once), and after `pensmith open p2` both `status` and bare `pensmith` act on p2 from any directory
  6. SESSION.log holds prompt, response, token and cost records plus HTTP records with no secrets; `--show-prompts` prints each outbound payload before it is sent; `resume --replay` reproduces an artifact offline
  7. The config cost cap aborts before an over-cap call (exit 5 without a TTY); `status` shows the position, per-section glyphs and a cost meter; `--estimate` projects a non-zero cost for a fresh assignment with zero network calls
  8. 40 concurrent lock contenders all succeed, a second mutating session on the same paper is refused with the holder's PID, and a mock LLM server (Anthropic and OpenAI shapes) is available to every test over the real transport
**Plans**: TBD

### Phase 18: Grounded Generation (GROUND)
**Goal**: Every generative step is fed the real assignment, answers, topic, outline entry and the section's own sources, every model output is validated against a contract the next step consumes, and bare `pensmith` goes from an assignment file to an exported paper with no hand edits. Absorbs v0.3.0 FEED-01..05.
**Depends on**: Phase 17 (mock LLM, valid model, paper root, exit codes, offline egress gate)
**Requirements**: FEED-01, FEED-02, FEED-03, FEED-04, FEED-05, GRND-01, GRND-02, GRND-03, GRND-04, GRND-05, GRND-06, GRND-07, GRND-08, GRND-09, GRND-10, GRND-11, GRND-12, GRND-13, GRND-14, GRND-15, GRND-16, GRND-17, GRND-18, GRND-19 (24)
**Success Criteria** (what must be TRUE):
  1. From a folder containing only assignment.txt, repeated bare `pensmith --yolo` against the mock LLM reaches `status (done)` with no hand-written OUTLINE.md or PLAN.md; every section is verified with at least one citation and no step re-executes
  2. INTAKE.md is a structured brief (verbatim assignment, topic, discipline, style, length, mode, class, counterargument) whether the assignment came from a file, `@file`, stdin, the cwd or a paste; the §7.1 questions are asked in a TTY, taken from flags or an answers file otherwise, and a non-TTY run with unanswered questions exits 3; research queries use the topic
  3. The outline prompt's own example parses; outline registers sections, writes the canonical table with `assigned_sources` and creates section folders with stub PLAN.md files; an invalid outline gets one corrective retry, then refuses, and later bare runs do not bill another outline call
  4. An argumentative outline without counterargument and rebuttal is refused (`--no-counter` disables it), and outline-only mode stops after outline and exports a zero-trace annotated bibliography
  5. The captured plan and write requests contain only their section's sources (fenced), the intake topic, the outline title and the word target; an injected abstract cannot change `assigned_sources` or the citations; a draft citing an unassigned key is retried once, then failed
  6. Planner output validates against PlanFrontmatterSchema, wave write works on planner-produced PLAN.md files, `write` chains to verify, and `plan N --research` adds real hits to that section only
  7. `pensmith --dry-run --yolo` completes intake through done with zero external connections, also from an installed tarball
**Plans**: TBD

### Phase 19: Sources and Library (SOURCES)
**Goal**: Every source adapter works against today's live APIs and reports failures to the user, the library has one deduplicated writer, and books, BYO PDFs and Zotero items are first-class sources.
**Depends on**: Phase 17 (live network default, http.ts, exit codes); Phase 18 for the structured intake topic that research queries are seeded from. Otherwise independent of Phase 18 and can overlap it
**Requirements**: SRC-01, SRC-02, SRC-03, SRC-04, SRC-05, SRC-06, SRC-07, SRC-08, SRC-09, SRC-10, SRC-11, SRC-12, BRDTH-01, SRC-13, SRC-14, SRC-15, SRC-16 (17)
**Success Criteria** (what must be TRUE):
  1. In the live lane, arXiv, Unpaywall, Crossref (including consortium works), OpenAlex (keyed) and Semantic Scholar return real results, and `http.ts` follows redirects with a fresh SSRF check on every hop
  2. Research prints per-adapter counts or failure reasons, disambiguates ambiguous topics, runs 5–10 focused queries in the preset's source order, applies the `[sources]` policy, tiers every source and writes RESEARCH.md; zero relevant sources exits non-zero
  3. The retracted Wakefield paper is flagged retracted; a 200 response with an error body is reported as "retraction status unknown", never as not retracted
  4. CITATIONS.bib round-trips Cyrillic, Greek, CJK, particle and "Given Family" names and carries abstracts, and LIBRARY.json validates with one entry per work across research, `add`, BYO and Zotero
  5. `add` accepts DOIs, arXiv IDs, ISBNs, PDFs and URLs and either identifies the correct work or refuses; it updates LIBRARY.json and RESEARCH.md and remaps only relevant sections
  6. `new --pdfs <dir>` ingests BYO PDFs tagged bring-your-own with local text cached, hydrating only confident matches and sending only titles or identifiers off the machine
  7. A History paper can cite a book with an ISBN, and Zotero items flow into the library in both tiers with an authenticated doctor check
**Plans**: TBD

### Phase 20: Verifier Completeness (VERIFY)
**Goal**: Every citation and quote form is seen, every legitimate source can pass, a lookup failure is never called fabrication, and compile and done recompute the gate from the text itself so forged or edited artifacts cannot get through (D-V1-03). Absorbs v0.3.0 HARDEN-03.
**Depends on**: Phase 18 (`assigned_sources` for the UNASSIGNED check, source-context for Pass 2) and Phase 19 (registrar adapters, redirects, Unpaywall, books, retraction data, BibTeX writer)
**Requirements**: VRFY-09, VRFY-10, VRFY-11, VRFY-12, VRFY-13, VRFY-14, VRFY-15, VRFY-16, VRFY-17, VRFY-18, VRFY-19, VRFY-20, VRFY-21, VRFY-22, VRFY-23, VRFY-24, VRFY-25, VRFY-26, VRFY-27, VRFY-28, VRFY-29, HARDEN-03 (22)
**Success Criteria** (what must be TRUE):
  1. One grammar extracts every Pandoc citation form and bare identifier, unparseable forms fail closed, and the HARDEN-03 differential property test (Pandoc oracle, at least 1000 runs) holds in CI
  2. Legitimate Crossref, DataCite (arXiv), arXiv-ID, PMID, ISBN, Zenodo, consortium and edited-volume sources verify OK live; fabricated identifiers are FABRICATED; a wrong title, first author or year is MIS-CITED; a lookup failure is UNVERIFIABLE and blocking, never FABRICATED; retracted sources block
  3. Pass 3 checks quotes against real OA or BYO text and a fabricated quote is NOT_FOUND and blocks; an uncheckable quote blocks until the user supplies the PDF, paraphrases or explicitly accepts it, and `--yolo` does not accept it
  4. Pass 2 judges every citing sentence against the real abstract, records evidence and writes the user's decision back; Pass 4 flags blatant uncited claims per paragraph and across the whole paper
  5. compile and done recompute the gate from the exact text they process: forged VERIFICATION.md or PLAN.md, hand edits to DRAFT.md or FINAL.md, unassigned keys, exotic keys and stale sections are all refused with exit 4, and a second run on an unchanged paper is served from the HTTP cache
  6. VERIFICATION.md opens with a summary table, placeholder or citation-free drafts with assigned sources are never verified, and a malformed bibliography never crashes verify
  7. The verifier acceptance tests run the production registrar path, and every cited entry carries `last_verified` and is re-checked after `recheck_after_days`
**Plans**: TBD

### Phase 21: Compile, Done and Export (EXPORT)
**Goal**: Compile produces a smoothed, checked, correctly cited paper, and done humanizes for real, scores honestly and exports every requested format with zero trace.
**Depends on**: Phase 20 (citation grammar and gate recomputation, used by bib regeneration, humanizer acceptance and export) and Phase 18 (intake style and discipline)
**Requirements**: EXP-01, EXP-02, EXP-03, EXP-04, EXP-05, EXP-06, EXP-07, EXP-08, EXP-09, EXP-10, EXP-11, EXP-12, EXP-13, EXP-14, EXP-15, EXP-16, EXP-17, EXP-18, EXP-19, EXP-20, EXP-21 (21)
**Success Criteria** (what must be TRUE):
  1. `done --format docx` produces a real .docx with and without pandoc, `--format pdf` produces a PDF, LaTeX compiles, and every export passes the zero-trace scan (no `custom.xml` paths, no home or install path) or is deleted
  2. Exports use the configured style (all 8 styles reachable, `--style` and intake overrides), number numeric styles correctly, render locators and multi-cites, and start with the title and section headings; the export bib and RIS hold exactly the cited keys, and `.paper/CITATIONS.bib` is never pruned
  3. COMPILE-REPORT.md shows smoothed transitions with citations unchanged, contradictions flagged with both sentences (target 0), per-paragraph citation density against the discipline band, and the advisory findings
  4. With the humanizer skill installed, done humanizes through the configured LLM, rewrites FINAL.md on every run, and blocks if humanizing changed the citation set
  5. The honesty score is real, before and after, with ISO timestamps and the backend named, or explicitly absent with the exact reason; GPTZero, Originality and Sapling work; `--no-score` is honored
  6. The plagiarism check sends quoted distinctive phrases from every section, counts only verbatim matches, shows real destination URLs and is labeled when offline
  7. done accepts `--no-verify`, `--no-score`, `--no-plagiarism-check` and `--style`, and the `export`, `humanize`, `score` and `plagiarism` aliases work while `UX02_VERBS` stays at 16
**Plans**: TBD

### Phase 22: Revision Loop and Inline Corrections (REVISE)
**Goal**: Redoing, fixing, resizing, adding or dropping a section works through the user path and reaches compile and export without loops, and the secondary modes (library filters, learning mode, sketch) do what the PRD says.
**Depends on**: Phase 18 (grounded planner), Phase 20 (verify semantics, compile record) and Phase 21 (compile and export outputs that must be rebuilt)
**Requirements**: REV-01, REV-02, REV-03, REV-04, REV-05, REV-06, REV-07, REV-08, REV-09, REV-10 (10)
**Success Criteria** (what must be TRUE):
  1. Bare `pensmith` never re-runs verify on an unchanged failed or unverifiable section: it prints the verdicts and options and exits 4, or with `--yolo` makes one automatic revision per failing draft
  2. After section 2 is redone, `next` and bare `pensmith` route to compile and then done, and DRAFT.md, FINAL.md and `export/` carry the new text while the other sections stay byte-identical; `status` reports the staleness until then
  3. `plan N --revise` re-plans from feedback or verification gaps, and `outline --length`, `outline --insert-after` (a 3a section), `outline --drop` (including a failed section) and `plan N --revise --swap` work through the user path, each touching only the affected sections
  4. `list --class` filters papers and `list --archive` / `--unarchive` hide and restore them
  5. goal learning writes TUTORIAL.md and stops after research, goal both prints explain notes at every step, and `tutorial.ts` stays the only goal-aware module
  6. sketch synthesizes a real thesis, supports refining it, and seeds intake with it
**Plans**: TBD

### Phase 23: Tier-1 Claude Code Plugin (PLUGIN)
**Goal**: The plugin installs from the git marketplace with no build step, loads its skills, hooks and MCP server, and runs the whole flow with no API key: the user's Claude session authors the generative artifacts and deterministic MCP tools validate, isolate and gate them (D-V1-04, D-V1-05).
**Depends on**: Phases 17–22 (the MCP tools are thin shims over the `bin/lib` behaviour those phases build)
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-06, PLUG-07, PLUG-08, PLUG-09, PLUG-10, PLUG-11, PLUG-12, PLUG-13, PLUG-14, PLUG-15 (15)
**Success Criteria** (what must be TRUE):
  1. `claude plugin validate` passes, and from a fresh clone with no build step `claude plugin marketplace add` plus `claude plugin install pensmith@pensmith` succeed, `/pensmith` exists, and the 4 hooks and the MCP server load
  2. With no API keys, a headless Claude session runs `/pensmith` from an assignment to an exported paper; the drafter subagent receives only its section's sources, and every section is verified by the verify tool
  3. Submit tools reject malformed outlines and plans, out-of-scope citations and writes into another section; only the verify tool can mark a section verified, and forged artifacts are refused by compile
  4. Hooks run: PreCompact writes HANDOFF.json, SessionStart gives Claude the resume context, PostToolUse checkpoints at most once a minute, and Stop releases locks
  5. MCP resources read the CLI's paper without `PENSMITH_PAPER_ROOT` and give an explicit error when there is none, and stdout stays valid JSON-RPC while verb tools run
  6. All 11 PRD §5.4 phrases route to the right verb, the plumbing namespace is available, and the repo-root `.mcp.json` works for developers
  7. The tier-contract test drives the real bundled plugin server for every workflow and fails on a deliberate parity break
**Plans**: TBD

### Phase 24: Security (SEC)
**Goal**: The two documented residuals in `.planning/SECURITY.md` (WR-03 DNS-rebind TOCTOU, WR-05 PDF-parse non-cancellation) are closed with real fixes, the missing response-size cap lands, and everything v1.0.0 adds gets a full security review. Absorbs v0.3.0 SEC-01/02.
**Depends on**: Phase 19 (the redirect loop whose hops must be pinned) and Phase 17 (the local LLM endpoint allowlist). Independent of Phases 20–23 otherwise and can run alongside them; SEC-04 reviews the surfaces added through Phase 23
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04 (4)
**Success Criteria** (what must be TRUE):
  1. A rebinding test shows the dialed IP equals the SSRF-validated IP, a virtual-hosted HTTPS fetch still works, and a test fails if undici's `maxRedirections` stops being 0
  2. A hanging PDF parse is terminated with no zombie worker, and a result that arrives at the timeout boundary is kept
  3. An oversized upstream response is aborted at its cap without being fully buffered
  4. A recorded security review of the v1.0.0 surface has every medium-or-higher finding fixed with a regression test or accepted with a reason, and `.planning/SECURITY.md` rows 2a and 9 read PROVEN
**Plans**: TBD

### Phase 25: Configuration and PRD Breadth (CONFIG)
**Goal**: Every documented config key is validated and honored, the discipline presets drive every stage, and the remaining PRD breadth lands: figures and tables, mid-section resume, the unverifiable-quote bucket, the reference card, CAPABILITIES.json, a complete doctor and the deferred Phase-1 FLAGs.
**Depends on**: Phases 18–21 (the stages that consume config keys and presets) and Phase 23 (the Tier-1 hooks that mid-section resume relies on)
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, CONF-06, CONF-07, BRDTH-02, BRDTH-03, BRDTH-04, BRDTH-05, BRDTH-06 (12)
**Success Criteria** (what must be TRUE):
  1. Every PRD §10 key validates and has an observable effect in a table-driven test; config.toml carries `schema_version` and migrates; `verify_quotes` is refused with the §14 reason; `status --config` shows where each value came from
  2. Each discipline preset's style, source order, sectioning, counterargument default and density band reach their stages, and no hard-coded discipline literal remains
  3. Section frontmatter carries `schema_version` with migrations, `.paper/CAPABILITIES.json` holds presence facts only, and the PRD §13 tree matches the repo
  4. `pensmith doctor` runs every §7.21 check (live connectivity, key validity, write permission, disk space, a tiny end-to-end check), including from an installed package
  5. Tables, captions and user-supplied figures appear numbered in every export format, and a missing figure file makes compile refuse
  6. Killing `pensmith write` at any of 10 random points and running `resume` completes the section without redoing finished work
  7. done shows the unverifiable-quote bucket, the reference card and README command table are generated and drift-checked, and the 13 Phase-1 FLAG/NIT items are fixed or accepted with reasons
**Plans**: TBD

### Phase 26: CI and Test Hardening (HARDEN)
**Goal**: The whole chain, the gate, the real plugin, pandoc and the live services are exercised in CI, so none of the v1.0.0 behaviour can regress silently. Absorbs v0.3.0 HARDEN-01/02/04.
**Depends on**: Phases 17–25 (it gates the finished behaviour)
**Requirements**: HARDEN-01, HARDEN-02, HARDEN-04, CI-04, CI-05, CI-06, CI-07, CI-08, CI-09, CI-10, CI-11 (11)
**Success Criteria** (what must be TRUE):
  1. A required e2e-chain job on ubuntu, macOS and Windows takes a folder containing only assignment.txt to an exported, zero-trace paper through bare `pensmith`, with per-stage assertions, and also runs against the installed binary, an OpenAI-compatible endpoint and `--dry-run`
  2. A gate-bypass matrix covering every known bypass exits 4 with no export on every OS
  3. A secrets-gated live lane (never triggered by pull requests) runs the PRD §15 smoke test in both tiers with real keys, registrars, retraction data, the SSRF preflight, GPTZero and DuckDuckGo, and a green run is on record
  4. CI exports through real pandoc and tectonic, extracts with PyMuPDF, runs the Zotero stub, validates and installs the plugin with Claude Code, and runs on Node 22 and 24
  5. Cassettes are live recordings refreshed by a working workflow with drift detection, source tests assert real values, and no test touches the real user data dir
  6. Coverage includes spawned CLI, MCP and hook processes with per-file floors on the blocking passes, and every major user path, interactive prompts included, is in the integration inventory
**Plans**: TBD

### Phase 27: Open-Source Release (RELEASE)
**Goal**: Everything a maintainer needs to publish 1.0.0 is prepared and true, and a final re-audit shows every completeness category at 100%. Publishing itself stays with the maintainer (D-V1-07).
**Depends on**: Phase 26 (release needs green required CI, a green live-lane run and the final audit evidence)
**Requirements**: REL-01, REL-02, REL-03, REL-04, REL-05, REL-06, REL-07, REL-08, REL-09 (9)
**Success Criteria** (what must be TRUE):
  1. package.json, plugin.json and marketplace.json say 1.0.0, CHANGELOG.md covers 0.1.0 through 1.0.0, `npm publish --dry-run` succeeds, and the tarball matches its allowlist
  2. A release workflow publishes on a pushed tag or a manual dispatch behind a protected environment, RELEASING.md and the release checklist are ready, and no tag, release or npm publish happened during the milestone
  3. The marketplace listing installs from a fresh clone of the release commit with no build step
  4. Every README claim is true, the env-var table matches the code, the quick start shows only `/pensmith`, and docs/ covers setup, both tiers and exit codes
  5. CODE_OF_CONDUCT, a SECURITY.md policy, issue and PR templates and a rewritten CONTRIBUTING.md exist, stale PRs are closed or on the maintainer checklist, and no stale deferral markers remain
  6. The final re-audit records every gap-register item as closed with evidence and all seven completeness categories at 100%
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 17. Tier-2 Runtime Foundations (RUNTIME) | 0/TBD | Not started | - |
| 18. Grounded Generation (GROUND) | 0/TBD | Not started | - |
| 19. Sources and Library (SOURCES) | 0/TBD | Not started | - |
| 20. Verifier Completeness (VERIFY) | 0/TBD | Not started | - |
| 21. Compile, Done and Export (EXPORT) | 0/TBD | Not started | - |
| 22. Revision Loop and Inline Corrections (REVISE) | 0/TBD | Not started | - |
| 23. Tier-1 Claude Code Plugin (PLUGIN) | 0/TBD | Not started | - |
| 24. Security (SEC) | 0/TBD | Not started | - |
| 25. Configuration and PRD Breadth (CONFIG) | 0/TBD | Not started | - |
| 26. CI and Test Hardening (HARDEN) | 0/TBD | Not started | - |
| 27. Open-Source Release (RELEASE) | 0/TBD | Not started | - |

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v0.1.0 Foundation | 0–10 (11) | 73 | ✅ Complete | 2026-06-22 |
| v0.2.0 End-to-End | 11–16 (6) | 26 | ✅ Complete | 2026-06-24 |
| v0.3.0 Truly End-to-End | 17–19 (3) | 0 | Absorbed into v1.0.0 | - |
| v1.0.0 Open Source Release | 17–27 (11) | TBD | 🚧 In progress | - |

---
*Roadmap initialized: 2026-05-06 from PRD.md*
*v0.1.0 archived 2026-06-22 · v0.2.0 archived 2026-06-24*
*v0.3.0 phases 17–19 added: 2026-07-06 · absorbed into v1.0.0 (phases 17–27): 2026-09-27*
