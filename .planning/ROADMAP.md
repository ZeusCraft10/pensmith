# Roadmap: pensmith

## Milestones

- ✅ **v0.1.0 Foundation** — Phases 0–10 (shipped 2026-06-22) — full two-tier architecture, Foundation NFRs, the deterministic verifier gate, compile/export pipeline, single-command UX, and the citation/style libraries. Archive: [milestones/v0.1.0-ROADMAP.md](milestones/v0.1.0-ROADMAP.md).
- ✅ **v0.2.0 End-to-End** — Phases 11–16 (shipped 2026-06-24) — connected the generative seams: Tier-2 LLM transport, live research discovery, citation rendering at export, fail-closed verifier gate, foundation/security hardening, CI/DX + docs parity. 25/25 requirements; 3-OS CI green. Archive: [milestones/v0.2.0-ROADMAP.md](milestones/v0.2.0-ROADMAP.md).
- **v0.3.0 Truly End-to-End** — Phases 17–19 (never started, not shipped) — absorbed into v1.0.0 on 2026-09-27. Its requirements keep their IDs: FEED-01..05 → Phase 18, SEC-01 → Phase 17, SEC-02 → Phase 19, HARDEN-01/02/04 → Phase 26, HARDEN-03 → Phase 20; its deferred BRDTH-01..06 backlog → Phases 17 (BRDTH-01) and 25.
- 🚧 **v1.0.0 Open Source Release** — Phases 17–27 (in progress) — finish the product and make it ready for open source: every category of the 2026-09-25 completeness assessment reaches 100%. 184 requirements covering all 333 gap-register items (200 from the audit, 133 from the SWEEP-01 stub sweep). Requirements: [REQUIREMENTS.md](REQUIREMENTS.md). Gap register: [research/V1-GAP-REGISTER.md](research/V1-GAP-REGISTER.md).

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

v0.3.0 Truly End-to-End (Phases 17–19) was never started and is absorbed here: FEED → Phase 18, SEC-01 → Phase 17, SEC-02 → Phase 19, HARDEN → Phase 26 (HARDEN-03 → Phase 20), BRDTH-01 → Phase 17, BRDTH-02..06 → Phase 25. Phase numbers 17–19 are reused for the v1.0.0 phases. Locked design decisions D-V1-01..08 and the synthesis decisions S-01..S-23 are in [REQUIREMENTS.md](REQUIREMENTS.md). After the critique, foundations moved ahead of their consumers (S-23): the config and frontmatter loaders, the library writer, IP pinning and the size cap, and the test infrastructure now land in Phase 17, and SEC-02 in Phase 19. Phase 24 keeps the security-review role, and the release surface gets its own review in Phase 27.

- [ ] **Phase 17: Tier-2 Runtime Foundations (RUNTIME)** - Live network by default with orthogonal offline, no-LLM and dry-run modes; current models parsed correctly with native structured output and per-slug defaults that fit the cost cap; safe OpenAI-compatible/Ollama runtimes; working installed binary; exit codes; one paper root and resolver; session log; one gate registry; the chokepoint table; the versioned config and frontmatter loaders; the single library writer; IP pinning and response-size cap; the synthetic dry-run provider; the mock LLM; Node 22/24, the cassette recorder and data-dir isolation in CI; and the finished stub sweep
- [ ] **Phase 18: Grounded Generation (GROUND)** - Intake collects the assignment and answers, outline/plan/write run on validated contracts fed by the real topic, voice and each section's own sources (FEED-01..05), counterargument enforcement, a recorded e2e corpus, and a full-workflow `--dry-run` that never touches the real paper
- [ ] **Phase 19: Sources and Library (SOURCES)** - Live-hardened adapters (arXiv https, Unpaywall, retractions, Crossref, OpenAlex/S2 keys), per-adapter failure reporting, evaluator tiers and policy, books/ISBN, round-trippable BibTeX, correct `add`, hashed BYO PDF ingest in a worker thread (SEC-02), Zotero, the drafter quote policy and `plan N --research`, and polite rate-limit handling with a per-host circuit breaker (SRC-17)
- [ ] **Phase 20: Verifier Completeness (VERIFY)** - One citation grammar that fails closed on every unsupported form (footnotes, reference lists, raw TeX/HTML included), Pass 1 across Crossref/DataCite/arXiv/PubMed/ISBN with correct name matching, real Pass 3 with a cached source store, per-quote acceptance, Pass 2 on abstracts, Pass 4 orphans, gate recomputation in compile and done that trusts no local file, freshness through the library writer, HARDEN-03
- [ ] **Phase 21: Compile, Done and Export (EXPORT)** - Unpruned bibliography, correct styles and headings, zero-trace output (paths, producer fields, image metadata), docx/pdf without pandoc, smoother, capped contradiction check, density map, a humanizer that runs, honest before/after scores with explicit detector consent, real plagiarism check, done flags and aliases, outline-only mode with an annotated bibliography
- [ ] **Phase 22: Revision Loop and Inline Corrections (REVISE)** - No verify loops, `--auto-revise` as an explicit opt-in, staleness propagation to compile/export, real `plan --revise`, length/add/drop/swap corrections, `list --class`/archive, learning-mode TUTORIAL.md, real sketch synthesis
- [ ] **Phase 23: Tier-1 Claude Code Plugin (PLUGIN)** - One canonical `plugin/` directory with committed bundles and no build step, spec-valid manifest/skills/hooks validated and installed in CI (CI-05), key-free generation through the user's Claude session with context/submit tools for every generative role, thin agents, real state tools, owner-aware locks and hooks, a doctor tool, and real headless sessions as the exit gate
- [ ] **Phase 24: Security Review (SEC)** - Full security review of everything Phases 17–23 added, with every medium-or-higher finding fixed or accepted with a reason
- [ ] **Phase 25: Configuration and PRD Breadth (CONFIG)** - Every config.toml key has an observable effect, presets used by every stage, CAPABILITIES.json (booleans-only resource), PRD §13 reconciled, full doctor, figures/tables, mid-section resume, unverifiable-quote bucket, generated reference card, Phase-1 FLAG paydown (BRDTH-02..06), and newer-version state refused by every verb (CONF-08)
- [ ] **Phase 26: CI and Test Hardening (HARDEN)** - Strict required e2e chain over the mock LLM (HARDEN-01), gate-bypass matrix including forged local files, a secrets-gated live lane in both tiers plus a mandatory Ollama job (HARDEN-02), real pandoc/PyMuPDF/Zotero in CI (HARDEN-04), a real-model output replay corpus, the cassette-refresh workflow and drift job, coverage of spawned processes, integration inventory, the shipped chokepoint lint holes closed, and `npm run check` identical to the required CI job (CI-14, CI-15)
- [ ] **Phase 27: Open-Source Release (RELEASE)** - Version 1.0.0, CHANGELOG, maintainer-triggered release workflow, correct npm package, a pinned marketplace listing, truthful README and docs/, community files, third-party notices and a full privacy table, a release-surface security review (SEC-05), no stale markers, final completeness re-audit

## Phase Details

### Phase 17: Tier-2 Runtime Foundations (RUNTIME)
**Goal**: The Tier-2 CLI talks to real services with a model that works, tells the truth about what it did (exit codes, offline banner, session log, `--show-prompts`), keeps all paper state under `.paper/`, and gives every later phase the foundations it consumes: a deterministic mock LLM, structured-output contracts, the gate registry, the versioned config and frontmatter loaders, the single library writer, the hardened http.ts transport, a synthetic dry-run provider and supported-Node CI.
**Depends on**: Nothing (first v1.0.0 phase; builds on the shipped v0.2.0 transport, http.ts and state layers). SWEEP-01 must finish before Phase 18 is planned.
**Requirements**: RUN-01, RUN-02, RUN-03, RUN-04, RUN-05, RUN-06, RUN-07, RUN-08, RUN-09, RUN-10, RUN-11, RUN-12, RUN-13, RUN-14, RUN-15, RUN-16, RUN-17, RUN-18, RUN-19, RUN-20, RUN-21, RUN-22, RUN-23, RUN-24, RUN-25, RUN-26, RUN-27, RUN-28, RUN-29, CONF-01, CONF-04, BRDTH-01, SEC-01, SEC-03, CI-06, CI-07, CI-09, SWEEP-01 (38)
**Success Criteria** (what must be TRUE):
  1. A user with no env vars runs `pensmith research` and gets live Crossref/OpenAlex results; offline replay happens only under `PENSMITH_OFFLINE=1`, `--dry-run` or the test runner, is announced on stderr and marked in every artifact (never in exports), and a missed fixture lookup is UNVERIFIABLE (offline), never another paper's record; under the test runner sources are offline while the configured loopback mock LLM stays reachable, `PENSMITH_NO_LLM` leaves the network mode alone, and `--dry-run` opens zero sockets while producing synthetic sources for any topic
  2. With only `ANTHROPIC_API_KEY` set, requests use `claude-opus-5`; responses that start with a thinking block parse, a refusal exits 1 with its category, and a `max_tokens` stop is never persisted; structured slugs use native structured output generated from one zod schema; every current model prices without crashing and an unknown one uses a warned fallback; judgment slugs default to cheaper models and `--estimate` projects the §15 paper under the $5 cap with at least 30% margin
  3. `--runtime ollama` and an OpenAI-compatible endpoint work against a local server; a paper's config.toml cannot set the endpoint or key variable, link-local and metadata endpoints are refused even from the global config, and source adapters still cannot reach loopback; the SSRF guard pins the validated IP and aborts oversized responses before buffering them
  4. Refusals and failures exit with the documented codes (4 blocked, 3 approval, 2 usage, 5 cost cap, 1 error), no expected failure prints a stack trace, a typo'd verb suggests the right one and creates nothing, and every approval gate comes from one registry whose `--yolo` behaviour matches the amended PRD §7.20 table
  5. `npm i -g` of the packed tarball and `npm link` give a working `pensmith` (`--version`, `--help`, `doctor`) and a working MCP server through symlinks, and the installed package never reads `tests/`
  6. All paper state lives under `.paper/` (legacy root files migrate once); config.toml and section and intake frontmatter carry `schema_version` and migrate; LIBRARY.json validates and has one writer; after `pensmith open p2`, `status` acts on p2 from any directory, while a fresh folder with an assignment starts a new paper and non-interactive mutating runs need `--paper`
  7. SESSION.log holds prompt, response, token and cost records plus HTTP records with no secrets; `--show-prompts` prints each outbound payload before it is sent; `resume --replay` reproduces a logged call's artifact offline; the config cost cap aborts before an over-cap call (exit 5 without a TTY); `status` shows the position, per-section glyphs and a cost meter
  8. 40 concurrent lock contenders all succeed, a second mutating session on the same paper is refused with the holder's PID while MCP-style per-section sub-locks let different sections proceed, and a mock LLM server in the real current response shape (Anthropic and OpenAI) is available to every test over the real transport
  9. Every new chokepoint is in the CLAUDE.md table and enforced without `eslint-disable`; CI runs on Node 22 and 24; no test touches the real data dir; `npm run cassettes:refresh` re-records scrubbed cassettes locally
  10. Every one of the 158 previously Complete requirements has a stub-sweep verdict with evidence, and each not-done item is a register gap mapped to a v1.0.0 requirement before Phase 18 is planned
**Plans**: 1 plan, [17-PLAN.md](phases/17-runtime/17-PLAN.md), executed as four parallel streams (egress, llm, paper-cli, foundations). **Status (2026-09-28):** 35/37 in-scope requirements Complete. RUN-26 (prompt caching is a no-op) and CI-06 (the Node 22/24 × 3-OS CI run has not been observed) are open. Success criterion 9 is not met until CI-06 closes, and criterion 10 (SWEEP-01) was run by a separate workflow. See [17-SUMMARY.md](phases/17-runtime/17-SUMMARY.md) and [17-VERIFICATION.md](phases/17-runtime/17-VERIFICATION.md).

### Phase 18: Grounded Generation (GROUND)
**Goal**: Every generative step is fed the real assignment, answers, topic, outline entry, voice and the section's own sources, every model output is validated against a contract the next step consumes, and bare `pensmith` goes from an assignment file to an exported paper with no hand edits. Absorbs v0.3.0 FEED-01..05.
**Depends on**: Phase 17 (mock LLM, structured outputs, config and frontmatter loaders, library writer, gate registry, dry-run provider, offline egress gate, and SWEEP-01's findings mapped into this document)
**Requirements**: FEED-01, FEED-02, FEED-03, FEED-04, FEED-05, GRND-01, GRND-02, GRND-03, GRND-04, GRND-05, GRND-06, GRND-07, GRND-08, GRND-09, GRND-10, GRND-12, GRND-13, GRND-15, GRND-16, GRND-18, GRND-19 (21)
**Success Criteria** (what must be TRUE):
  1. From a folder containing only assignment.txt, repeated bare `pensmith --yolo` against the mock LLM over the recorded e2e corpus reaches `status (done)` with no hand-written OUTLINE.md or PLAN.md; every section is verified with at least one citation, no step re-executes, and a stale `open` pointer to another paper leaves that paper untouched
  2. INTAKE.md is a structured, versioned brief (verbatim assignment, topic, discipline, style, length, mode, class, counterargument) whether the assignment came from a file, `@file`, stdin, the cwd or a paste; the §7.1 questions are asked in a TTY, taken from flags or an answers file otherwise, and a non-TTY run with unanswered questions exits 3; the tutorial lint allowlist is unchanged; research queries use the topic
  3. The outline prompt's own example parses; outline registers sections, writes the canonical table with `assigned_sources` and `voice` and creates section folders with stub PLAN.md files; an invalid outline gets one corrective retry, then refuses, and later bare runs do not bill another outline call; a forced re-outline never renames, renumbers or touches unchanged sections
  4. An argumentative outline without counterargument and rebuttal is refused (`--no-counter` disables it)
  5. The captured plan and write requests contain only their section's sources (fenced), the intake topic, the outline title, the word target and the resolved voice (STYLE.json when style-match is on); an injected abstract cannot change `assigned_sources` or the citations; a draft citing an unassigned key is retried once, then failed
  6. Planner output validates against PlanFrontmatterSchema, wave write works on planner-produced PLAN.md files, and `write` chains to verify
  7. `pensmith --dry-run --yolo` completes intake through done with zero external connections, also from an installed tarball, in a scratch workspace whose exports are named `.dry-run`, and leaves the real `.paper/` byte-identical
**Plans**: TBD

### Phase 19: Sources and Library (SOURCES)
**Goal**: Every source adapter works against today's live APIs and reports failures to the user, every ingest goes through the Phase 17 library writer, books, hashed BYO PDFs and Zotero items are first-class sources, and the drafter and `plan --research` can use this phase's full-text flags and evaluator.
**Depends on**: Phase 17 (live network default, the pinned and size-capped http.ts transport, the library writer, the cassette recorder, exit codes) and Phase 18 (the structured intake topic research is seeded from, the source-context builder, the planner)
**Requirements**: SRC-01, SRC-02, SRC-03, SRC-04, SRC-05, SRC-06, SRC-07, SRC-08, SRC-09, SRC-10, SRC-11, SRC-12, SRC-13, SRC-14, SRC-15, SRC-16, SRC-17, GRND-14, GRND-17, SEC-02 (20)
**Success Criteria** (what must be TRUE):
  1. In the live lane, arXiv, Unpaywall, Crossref (including consortium works), OpenAlex (keyed) and Semantic Scholar return real results, and `http.ts` follows redirects with a fresh SSRF check and IP pin on every hop
  2. Research prints per-adapter counts or failure reasons, disambiguates ambiguous topics, runs 5–10 focused queries in the preset's source order, applies the `[sources]` policy, tiers every source and writes RESEARCH.md; zero relevant sources exits non-zero
  3. The retracted Wakefield paper is flagged retracted; a 200 response with an error body is reported as "retraction status unknown", never as not retracted
  4. CITATIONS.bib round-trips Cyrillic, Greek, CJK, particle and "Given Family" names and carries abstracts, and LIBRARY.json holds one entry per work across research, `add`, BYO and Zotero
  5. `add` accepts DOIs, arXiv IDs, ISBNs, PDFs and URLs and either identifies the correct work or refuses; it updates LIBRARY.json and RESEARCH.md and remaps only relevant sections
  6. `new --pdfs <dir>` ingests BYO PDFs tagged bring-your-own, kept with their hashes and extracted in a worker thread that is hard-aborted on timeout; editing local text never changes a verdict; only titles or identifiers leave the machine
  7. A History paper can cite a book with an ISBN, Zotero items flow into the library in both tiers with an authenticated doctor check, the drafter quotes directly only from sources with real full text, and `plan N --research` adds real hits to that section only
  8. `http.ts` sends each service's polite contact form (Crossref `mailto:` User-Agent), honours `X-Rate-Limit` headers, stops retrying a host whose `Retry-After` exceeds the cap, trips a per-host circuit breaker on 429/5xx storms, and never caches an error body as a success (SRC-17)
**Plans**: [19-PLAN.md](phases/19-sources/19-PLAN.md) (1/1: four parallel streams — net, adapters, library, research — then an integration pass)
**Status**: executed and integrated on `v1/p19` (merges after Phase 18 closes); review rounds 1, 2 and 3 fixed. 19 of 20 requirements met (SRC-06's keyed live round trip is a maintainer item: no key here); GRND-14 is not met on this branch — its library half is built (since round 3 the full-text flag counts an Unpaywall link only once it served a PDF, and `describeQuotesWithoutFullText` is the corrective text), its drafter half and acceptance run at the Phase 18/19 merge ([19-VERIFICATION.md](phases/19-sources/19-VERIFICATION.md), [19-SUMMARY.md](phases/19-sources/19-SUMMARY.md)). Criterion 7's book citation holds end to end since round 1 (Pass 1 resolves ISBNs, arXiv ids and PMIDs); criterion 8's breaker catches real storms without taking a throttled host down for the run since round 3.

### Phase 20: Verifier Completeness (VERIFY)
**Goal**: Every citation and quote form is seen, every legitimate source can pass, a lookup failure is never called fabrication, and compile and done recompute the gate from the text itself, trusting no local file, so forged or edited artifacts cannot get through (D-V1-03, S-17). Absorbs v0.3.0 HARDEN-03.
**Depends on**: Phase 18 (`assigned_sources` for the UNASSIGNED check, source-context for Pass 2) and Phase 19 (registrar adapters, redirects, Unpaywall, books, retraction data, BibTeX writer, BYO hashes, the PDF worker)
**Requirements**: VRFY-09, VRFY-10, VRFY-11, VRFY-12, VRFY-13, VRFY-14, VRFY-15, VRFY-16, VRFY-17, VRFY-18, VRFY-19, VRFY-20, VRFY-21, VRFY-22, VRFY-23, VRFY-24, VRFY-25, VRFY-26, VRFY-27, VRFY-28, VRFY-29, HARDEN-03 (22)
**Success Criteria** (what must be TRUE):
  1. One grammar extracts every Pandoc citation form and bare identifier; unparseable forms, author-date prose, footnotes, reference lists and raw TeX or HTML citations fail closed; the HARDEN-03 differential property test (Pandoc oracle, at least 1000 runs) holds in CI
  2. Legitimate Crossref, DataCite (arXiv), arXiv-ID, PMID, ISBN, Zenodo, consortium and edited-volume sources verify OK live; fabricated identifiers are FABRICATED; a wrong title, first author or year is MIS-CITED; a lookup failure is UNVERIFIABLE and blocking, never FABRICATED; retracted sources block
  3. Pass 3 checks quotes against real OA or hash-matched BYO text and a fabricated quote is NOT_FOUND and blocks; an uncheckable quote blocks until the user supplies the PDF, paraphrases or accepts that one quote, the acceptance is void once the draft changes, and `--yolo` does not accept it
  4. Pass 2 judges every citing sentence against the real abstract and records evidence, with the user's decision in the paper-level VERIFICATION.md; Pass 4 flags blatant uncited claims per paragraph and across the whole paper
  5. compile and done recompute the gate from the exact text they process: forged VERIFICATION.md or PLAN.md, forged BYO text, forged quote acceptances, forged alternate DOIs, hand edits to DRAFT.md or FINAL.md, unassigned keys, exotic keys and stale sections are all refused with exit 4; a second run on an unchanged paper, Pass 3 included, is served from the cache, and done never writes into `sections/*`
  6. VERIFICATION.md opens with a summary table, placeholder or citation-free drafts with assigned sources are never verified, and a malformed bibliography never crashes verify
  7. The verifier acceptance tests run the production registrar path, and every cited entry's `last_verified` lives in LIBRARY.json (rendered into CITATIONS.bib by the one writer, never by compile) and is re-checked after `recheck_after_days`
**Plans**: TBD

### Phase 21: Compile, Done and Export (EXPORT)
**Goal**: Compile produces a smoothed, checked, correctly cited paper, done humanizes for real, scores honestly and exports every requested format with zero trace, and outline-only mode produces a sourced outline and annotated bibliography.
**Depends on**: Phase 20 (citation grammar and gate recomputation, used by bib regeneration, humanizer acceptance and export), Phase 19 (source tiers and why-relevant text for the annotated bibliography) and Phase 18 (intake style and discipline)
**Requirements**: EXP-01, EXP-02, EXP-03, EXP-04, EXP-05, EXP-06, EXP-07, EXP-08, EXP-09, EXP-10, EXP-11, EXP-12, EXP-13, EXP-14, EXP-15, EXP-16, EXP-17, EXP-18, EXP-19, EXP-20, EXP-21, GRND-11 (22)
**Success Criteria** (what must be TRUE):
  1. `done --format docx` produces a real .docx with and without pandoc, `--format pdf` produces a PDF, LaTeX compiles, and every export passes the zero-trace scan (no `custom.xml` paths, no home or install path, empty producer and application fields, no image metadata) or is deleted
  2. Exports use the configured style (all 8 styles reachable, `--style` and intake overrides), number numeric styles correctly, render locators and multi-cites, and start with the title and section headings; the export bib and RIS hold exactly the cited keys, and `.paper/CITATIONS.bib` is never pruned
  3. COMPILE-REPORT.md shows smoothed transitions with citations unchanged, contradictions flagged with both sentences (target 0, pairs capped), per-paragraph citation density against the discipline band, the advisory findings and skip reasons that name the mode
  4. With the humanizer skill installed, done humanizes through the configured LLM, rewrites FINAL.md on every run, and blocks if humanizing changed the citation set
  5. The honesty score is real, before and after, with ISO timestamps and the backend named, or explicitly absent with the exact reason; detector consent is recorded explicitly and never implied by `--yolo`; GPTZero, Originality and Sapling work; `--no-score` is honored
  6. The plagiarism check sends quoted distinctive phrases from every section, counts only verbatim matches, shows real destination URLs and is labeled when offline
  7. done accepts `--no-verify`, `--no-score`, `--no-plagiarism-check` and `--style`, and the `export`, `humanize`, `score` and `plagiarism` aliases work while `UX02_VERBS` stays at 16
  8. Outline-only mode stops after the outline and exports a zero-trace annotated bibliography whose sources were re-verified by the gate
**Plans**: TBD

### Phase 22: Revision Loop and Inline Corrections (REVISE)
**Goal**: Redoing, fixing, resizing, adding or dropping a section works through the user path and reaches compile and export without loops, and the secondary modes (library filters, learning mode, sketch) do what the PRD says.
**Depends on**: Phase 18 (grounded planner), Phase 20 (verify semantics, compile record) and Phase 21 (compile and export outputs that must be rebuilt)
**Requirements**: REV-01, REV-02, REV-03, REV-04, REV-05, REV-06, REV-07, REV-08, REV-09, REV-10 (10)
**Success Criteria** (what must be TRUE):
  1. Bare `pensmith` never re-runs verify on an unchanged failed or unverifiable section: it prints the verdicts and options and exits 4, with or without `--yolo`; only the explicit `--auto-revise` opt-in makes one automatic revision per failing draft
  2. After section 2 is redone, `next` and bare `pensmith` route to compile and then done, and DRAFT.md, FINAL.md and `export/` carry the new text while the other sections stay byte-identical; `status` reports the staleness until then
  3. `plan N --revise` re-plans from feedback or verification gaps, and `outline --length`, `outline --insert-after` (a 3a section), `outline --drop` (including a failed section) and `plan N --revise --swap` work through the user path, each touching only the affected sections (section-isolation tests cover `outline --length`)
  4. `list --class` filters papers and `list --archive` / `--unarchive` hide and restore them
  5. goal learning writes TUTORIAL.md and stops after research, goal both prints explain notes at every step in both tiers, and `tutorial.ts` stays the only goal-aware module
  6. sketch synthesizes a real thesis, supports refining it, and seeds intake with it
**Plans**: TBD

### Phase 23: Tier-1 Claude Code Plugin (PLUGIN)
**Goal**: The plugin installs from the git marketplace with no build step from one canonical `plugin/` directory that both tiers read, loads its skills, hooks and MCP server, and runs the whole flow with no API key: the user's Claude session authors the generative artifacts through thin agents, and deterministic MCP tools validate, isolate and gate them (D-V1-04, D-V1-05, S-19).
**Depends on**: Phases 17–22 (the MCP tools are thin shims over the `bin/lib` behaviour those phases build)
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-06, PLUG-07, PLUG-08, PLUG-09, PLUG-10, PLUG-11, PLUG-12, PLUG-13, PLUG-14, PLUG-15, CI-05 (16)
**Success Criteria** (what must be TRUE):
  1. `claude plugin validate plugin` passes, and from a fresh clone with no build step `claude plugin marketplace add` plus `claude plugin install pensmith@pensmith` succeed, `/pensmith` exists, and the 4 hooks and the MCP server load; a required CI job repeats this on every change; no workflow, prompt, preset, reference, skill or agent file exists outside `plugin/`
  2. At least 3 real headless Claude sessions (claude-sonnet-5, claude-opus-5 and a repeat), authenticated without a provider key and with the MCP server provably reading none, run `/pensmith` from an assignment to an exported paper and pass the transcript checklist (router first, drafter sees only its section context, verify tool per section, no direct writes to gate files); a session told to hand-write VERIFICATION.md ends with compile refusing; the first green run is recorded in the phase SUMMARY
  3. Context and submit tools cover every generative role with the Tier-2 schemas; submit tools reject malformed outlines, plans and evaluations, out-of-scope citations and writes into another section; only the verify tool can mark a section verified, and forged artifacts are refused by compile
  4. Hooks run: PreCompact writes HANDOFF.json, SessionStart gives Claude the resume context, PostToolUse checkpoints at most once a minute, and Stop releases only its own session's locks; concurrent draft submissions for different sections succeed
  5. MCP resources read the CLI's paper without `PENSMITH_PAPER_ROOT`, never follow the `open` pointer and give an explicit error when there is none; stdout stays valid JSON-RPC while verb tools run; `/pensmith doctor` works and a missing `node` is reported with the Node ≥ 22 fix
  6. All 11 PRD §5.4 phrases route to the right verb, every RUN-28 gate appears in the Tier-1 workflow bodies, the plumbing namespace is available, and the repo-root `.mcp.json` works for developers
  7. The tier-contract test drives the real bundled plugin server for every workflow, context/submit pair and gate, and fails on a deliberate parity break
**Plans**: TBD

### Phase 24: Security Review (SEC)
**Goal**: Everything v1.0.0 added through Phase 23 gets a full security review, and every finding rated medium or above is fixed or accepted with a written reason. The documented residuals are already closed: WR-03 DNS-rebind pinning and the response-size cap landed in Phase 17 (SEC-01, SEC-03) and WR-05 PDF-parse cancellation in Phase 19 (SEC-02), because earlier phases depend on them (S-23). The release surface is reviewed in Phase 27 (SEC-05).
**Depends on**: Phases 17–23 (the surfaces under review)
**Requirements**: SEC-04 (1)
**Success Criteria** (what must be TRUE):
  1. A recorded security review covers the MCP submit and context tools, the LLM endpoint configuration (including the paper-level endpoint and key-variable attack cases), the redirect loop, the Zotero local origin, the BYO PDF store, the humanizer system prompt, hook input parsing and lock release, secret redaction and PII redaction
  2. Every medium-or-higher finding is fixed with a regression test or accepted with a written reason, and `.planning/SECURITY.md` has one row per finding
  3. `.planning/SECURITY.md` rows 2a and 9 read PROVEN, and no PROVEN-with-residual row is left unexplained
**Plans**: TBD

### Phase 25: Configuration and PRD Breadth (CONFIG)
**Goal**: Every documented config key has an observable effect, the discipline presets drive every stage, and the remaining PRD breadth lands: figures and tables, mid-section resume, the unverifiable-quote bucket, the reference card, CAPABILITIES.json, a complete doctor and the deferred Phase-1 FLAGs.
**Depends on**: Phases 18–21 (the stages that consume config keys and presets) and Phase 23 (the Tier-1 hooks that mid-section resume relies on); the config and frontmatter loaders landed in Phase 17
**Requirements**: CONF-02, CONF-03, CONF-05, CONF-06, CONF-07, CONF-08, BRDTH-02, BRDTH-03, BRDTH-04, BRDTH-05, BRDTH-06 (11)
**Success Criteria** (what must be TRUE):
  1. Every PRD §10 key has an observable effect in a table-driven test, and the README configuration section lists every key
  2. Each discipline preset's style, source order, sectioning, counterargument default and density band reach their stages, and no hard-coded discipline literal remains
  3. `.paper/CAPABILITIES.json` holds presence facts and version strings while `paper://capabilities` stays booleans-only, and the PRD §13 tree (including `plugin/`, the thin agents and the dry-run workspace) matches the repo
  4. `pensmith doctor` runs every §7.21 check (live connectivity, key validity, write permission, disk space, a tiny end-to-end check on packaged fixtures), including from an installed package
  5. Tables, captions and user-supplied figures appear numbered in every export format with image metadata stripped, and a missing figure file makes compile refuse
  6. Killing `pensmith write` at any of 10 random points and running `resume` completes the section without redoing finished work
  7. done shows the unverifiable-quote bucket, the reference card and README command table (gate table and global flags included) are generated and drift-checked, and the 13 Phase-1 FLAG/NIT items are fixed or accepted with reasons
  8. Every verb, the router, the MCP resources and the hooks refuse a state file with a newer schema version, name it, and leave it untouched (CONF-08)
**Plans**: TBD

### Phase 26: CI and Test Hardening (HARDEN)
**Goal**: The whole chain, the gate, pandoc, real model output and the live services are exercised in CI, so none of the v1.0.0 behaviour can regress silently. Absorbs v0.3.0 HARDEN-01/02/04. Runs that need maintainer-held secrets are prepared here and their first green run is a maintainer-triggered checklist item (D-V1-07).
**Depends on**: Phases 17–25 (it gates the finished behaviour)
**Requirements**: HARDEN-01, HARDEN-02, HARDEN-04, CI-04, CI-08, CI-10, CI-11, CI-12, CI-13, CI-14, CI-15 (11)
**Success Criteria** (what must be TRUE):
  1. A required e2e-chain job on ubuntu, macOS and Windows takes a folder containing only assignment.txt to an exported, zero-trace paper through bare `pensmith`, with per-stage assertions over the recorded corpus, and also runs against the installed binary, an OpenAI-compatible endpoint, `--dry-run` and a data dir with a stale `open` pointer
  2. A gate-bypass matrix covering every known bypass, including forged BYO text, forged quote acceptances, forged alternate DOIs, footnotes, reference lists and raw TeX/HTML, exits 4 with no export on every OS
  3. A secrets-gated live lane (never triggered by pull requests) runs the PRD §15 smoke test in both tiers with real keys at default settings under the $5 cap with at least 30% margin, runs a mandatory Ollama job, the multi-session Tier-1 checklist and registrar, retraction, SSRF, GPTZero and DuckDuckGo checks; its first green run is a recorded maintainer-triggered checklist item
  4. Every structured parser runs in required CI over real responses from each supported model plus adversarial variants
  5. CI exports through real pandoc and tectonic, extracts with PyMuPDF and runs the Zotero stub; the cassette-refresh workflow and a scheduled drift job run for real; source tests assert real values
  6. Coverage includes spawned CLI, MCP and hook processes with per-file floors on the blocking passes, and every major user path, interactive prompts included, is in the integration inventory
  7. The shipped chokepoint lint rules catch every forbidden pattern in every directory scope (named `homedir` imports, HTTP imports in `mcp/`, the DOI regex in doctor probes), and `npm run check` runs exactly the steps of the required CI job (CI-14, CI-15)
**Plans**: TBD

### Phase 27: Open-Source Release (RELEASE)
**Goal**: Everything a maintainer needs to publish 1.0.0 is prepared and true, the release surface has passed its own security review, and a final re-audit shows every completeness category at 100%. Publishing itself stays with the maintainer (D-V1-07).
**Depends on**: Phase 26 (release needs green required CI, the maintainer-triggered live-lane and cassette-refresh runs, and the final audit evidence)
**Requirements**: REL-01, REL-02, REL-03, REL-04, REL-05, REL-06, REL-07, REL-08, REL-09, REL-10, REL-11, SEC-05 (12)
**Success Criteria** (what must be TRUE):
  1. package.json, plugin.json and marketplace.json say 1.0.0, CHANGELOG.md covers 0.1.0 through 1.0.0, `npm publish --dry-run` succeeds, and the tarball matches its allowlist and ships THIRD_PARTY_NOTICES.md
  2. A release workflow publishes on a pushed tag or a manual dispatch behind a protected environment and moves the marketplace pin; RELEASING.md and the release checklist (including PR closures, branch deletions and the maintainer-triggered runs) are ready; no tag, release, npm publish, PR closure or branch deletion happened during the milestone
  3. The marketplace listing, pinned to a release ref, installs from a fresh clone of the release commit with no build step
  4. Every README claim is true, the env-var table matches the code, the quick start shows only `/pensmith`, Node ≥ 22 is listed for both tiers, the §7.18 dual-use paragraph is present, PRIVACY.md lists every egress destination, and docs/ covers setup, both tiers and exit codes
  5. CODE_OF_CONDUCT, a SECURITY.md policy, issue and PR templates and a rewritten CONTRIBUTING.md exist; dependency licenses are checked and attributed; no stale deferral markers remain; the release-surface review has no open medium-or-higher finding
  6. The final re-audit records every gap-register item (including stub-sweep additions) and every prior and v1.0.0 requirement as closed with evidence, and all seven completeness categories at 100% once the maintainer-triggered evidence is recorded
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 17. Tier-2 Runtime Foundations (RUNTIME) | 1/1 | In progress: 35/37 requirements Complete; RUN-26, CI-06 open | - |
| 18. Grounded Generation (GROUND) | 0/TBD | Not started | - |
| 19. Sources and Library (SOURCES) | 1/1 | Integrated on v1/p19, review rounds 1–3 fixed: 19/20 requirements Complete; GRND-14 (drafter half) at the Phase 18/19 merge | - |
| 20. Verifier Completeness (VERIFY) | 0/TBD | Not started | - |
| 21. Compile, Done and Export (EXPORT) | 0/TBD | Not started | - |
| 22. Revision Loop and Inline Corrections (REVISE) | 0/TBD | Not started | - |
| 23. Tier-1 Claude Code Plugin (PLUGIN) | 0/TBD | Not started | - |
| 24. Security Review (SEC) | 0/TBD | Not started | - |
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
*v0.3.0 phases 17–19 added: 2026-07-06 · absorbed into v1.0.0 (phases 17–27): 2026-09-27 · refined after critique (180 requirements): 2026-09-27 · SWEEP-01 stub sweep mapped (184 requirements, 333 gap items): 2026-09-27*
*Phase 17 executed and verified: 2026-09-28 (35/37 Complete; RUN-26 and CI-06 open, so the phase box stays unticked)*
