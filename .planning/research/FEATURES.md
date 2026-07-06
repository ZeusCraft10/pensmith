# Feature Research

**Domain:** AI-assisted academic paper writing — structured workflow + citation verification
**Researched:** 2026-05-06
**Confidence:** HIGH on category structure and table-stakes; MEDIUM on specific competitor behaviors (mostly verified via official product pages and 2025-2026 review articles, not hands-on); MEDIUM on edge-case complaint sourcing (Reddit-style anecdotes attested in summaries but not deep-linked).

## Scope and frame

The PRD already takes strong opinions on every dimension this research covers. Treat this document as a **landscape audit + validation** of those opinions, not a fresh product design. Where research contradicts or pressures the PRD, this is called out explicitly under "Push-back" notes. Where research strongly confirms PRD choices, that is also called out — the PRD's instinct is generally correct, and several anti-features it flags (paid plagiarism integration, "evade detection" framing) are exactly what the loud market is doing wrong.

The competitive map breaks roughly into four buckets:

1. **Discovery / literature-review tools** — Elicit, SciSpace, Consensus, Scite, Research Rabbit, Connected Papers, Scholarcy. Find and synthesize sources; not drafting tools.
2. **Drafting assistants** — Jenni AI, Yomu AI, Paperpal, Writefull, Litero, Textero. Help write the paper; weak verification.
3. **Reference managers (with AI plugins)** — Zotero + ARIA / PapersGPT / Beaver. Manage sources; AI as a search/chat overlay.
4. **Integrity tooling** — Turnitin, Copyleaks, Originality.ai, GPTZero, Sapling (detection); Citely, SwanRef, CiteMe (post-hoc citation checking).

**No tool currently in the market combines structured per-section drafting + real citation re-fetch + author/title fuzzy match + quote verification + claim support + free-only plagiarism + honest detection framing in one workflow.** That is pensmith's open lane. The closest individual pieces are Citely (does citation existence + match checking after the fact, not in a drafting flow) and Scite (citation context classification, but not for verifying your own draft's citations against the source).

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these = users bounce to Elicit, SciSpace, Paperpal, or Jenni AI. The PRD covers all of them; this validates the choice.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Major citation styles: APA 7, MLA, Chicago (notes-bib + author-date), IEEE, AMA, Vancouver, Harvard | Every drafting tool ships these; Jenni claims 2,600+ styles, Paperpal 10,000+. Missing MLA or Chicago = "Elicit complaint" territory (Elicit is APA-centric and that's a known sore spot for humanities users) | MEDIUM | PRD §8 covers this. Decision pending in PRD §17 between hand-rolled formatters vs CSL files via citeproc-js — strongly recommend CSL: 10,000+ styles for free, and CSL is the standard Zotero/Mendeley/Pandoc all use |
| Real DOI verification (re-fetch, not just format check) | Users have been burned by ChatGPT fabricating DOIs that look right and 404 on click. ~25–35% of unaided LLM citations are fabricated; even RAG-based tools sit at 5–15% fabrication. This is the #1 complaint in academic AI use | MEDIUM | PRD §7.7 Pass 1 — load-bearing. Crossref + arXiv + PubMed + OpenAlex APIs, all free. Pensmith's differentiator is doing this *during drafting in a section-bounded way*, not after the fact |
| Author / title / year fuzzy match against canonical metadata | DOI integrity alone isn't sufficient — LLMs sometimes attach a real DOI to wrong authors. The Citely-class tools all do title fuzzy matching (95%+ claimed accuracy on detecting mismatches). PRD §14 explicitly makes this part of Pass 1 | MEDIUM | PRD §7.7 + §14. Use a normalized Levenshtein or Jaro-Winkler on title; set author-set overlap threshold. Tunable in v0.1.x |
| Word / DOCX export | Required for institutional submission. Every tool ships this; Pandoc-mediated is fine | LOW (with Pandoc) / MEDIUM (markdown-to-docx native) | PRD §11 ecosystem composition. Hard requirement |
| PDF export | Universal expectation, especially for finals | LOW with Pandoc, MEDIUM otherwise | PRD §11 |
| BibTeX / RIS export | Reference-manager interop. Zotero/Mendeley round-trip is expected | LOW | PRD §13 already lists `CITATIONS.bib` |
| Source search across major academic indexes (not just arXiv or just PubMed) | Users in mixed disciplines need cross-index. Elicit indexes 138M, Consensus 200M+ via Semantic Scholar, Paperpal 250M+. Single-index tools feel narrow | LOW–MEDIUM (clients are simple HTTP) | PRD §12. OpenAlex (~250M+) + Crossref + arXiv + PubMed covers ~all of this for free |
| Outline-first workflow with user approval | Every drafting tool that doesn't approve the outline produces drafts users have to throw away. Jenni, Yomu, Paperpal, Litero, Textero all default to outline-first now | LOW | PRD §7.3, with explicit approval gate |
| Resume / save state | LLM sessions get expensive and lossy. Without persistence, users lose work and trust | MEDIUM (HANDOFF + locking) | PRD §7.14, §14. Section-granular HANDOFF.json is more robust than what most competitors ship |
| Free tier or fully-free with BYO key | Paperpal, Jenni, SciSpace all gate the actually useful features behind $10–50/mo. The "free" alternatives (QuillBot, Grammarly free citation gen) are weak. A genuinely free tool that runs on Ollama is a real product position | N/A — architectural | PRD ships free, MIT licensed, Ollama-compatible Tier 2. This is a real moat |
| Outline / draft / verify status visibility | "Where am I?" — without it, users get lost in long drafts. Jenni and Yomu do this through their UI; for a CLI/plugin it has to be a status command | LOW | PRD §5.2 `/pensmith status`, §7.14 |
| In-text citation with bibliography auto-generation | Manually maintaining a bib while AI writes is friction. Every drafter generates this together | MEDIUM | PRD §7.8 + `bin/lib/citations.js`. Couple to the source-mapping; never write a citation without a backing source object |
| Quote verification when the user includes direct quotes | Lazy LLMs invent quotes. Quote-NOT_FOUND is the most damaging failure mode in humanities papers and rare in current tools | HIGH (depends on OA full-text availability) | PRD §7.7 Pass 3. Limited to Unpaywall / arXiv / PubMed Central reachable papers; degrade to "quote unverifiable, please confirm" for paywalled |
| Plagiarism check before final export | Users are conditioned by Turnitin to expect this. Even a weak free check is better than none — at minimum it catches the LLM regurgitating training data verbatim | MEDIUM | PRD §7.17. Free distinctive-phrase + DuckDuckGo is honest about its limits |
| Markdown export for power users | Increasingly expected (Obsidian / Notion / static-site users); LOW cost given internal format is markdown anyway | LOW | PRD already produces markdown internally |

**Push-back / pressure on PRD:**

- **PRD §7.7 marks Pass 2 (claim support) and Pass 4 (per-paragraph audit) as required for verify, but only Pass 1 + Pass 3 gate `verified` status.** Research strongly confirms this is the right call — claim support is the LLM-judged pass and prone to false-confident SUPPORTED on weak evidence; making it advisory not blocking is correct.
- **PRD does not explicitly list Harvard citation style in §8** but Harvard is the dominant style at most UK and Australian universities. Add to discipline preset table or document as "use --citation-style harvard". Recommend adding to the table.
- **PRD does not include EndNote `.enl` or RIS export** — only BibTeX. RIS is a 30-line addition and unlocks Mendeley/EndNote users. Recommend adding to v0.1.0; EndNote `.enl` can wait.

### Differentiators (Competitive Advantage)

These are where pensmith wins. Each one corresponds to a known, painful gap in the existing market.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Section-isolated state (load-bearing)** | "Re-do section 3" without disturbing 1, 2, 4, 5. No competitor offers this. Every drafting tool today re-runs the whole document or asks the user to copy-paste pieces around | MEDIUM (directory layout + bounded prompts) | PRD §4. The architectural foundation; everything else benefits from it. Verifier complexity drops from ~200 calls/paper to ~20–40 calls/section |
| **Re-fetch every cited DOI in drafting (not after)** | Citely, SwanRef, CiteMe all do post-hoc citation checking against an existing draft. Pensmith does it *during* the section-write loop, so the user never sees a fabricated cite. Closes the loop the LLM tools left open | MEDIUM (already implemented in PRD §7.7) | Critical wedge. Don't market this as "another verifier" — market it as "our drafter cannot fabricate a citation by construction" |
| **Quote verification (Pass 3)** | Almost no tool does this. It's the kill-shot for humanities/lit-review use cases where direct quotes are the substance | HIGH (OA availability is the limit) | PRD §7.7. Be honest about coverage: paywalled sources can't be verified, mark as `UNVERIFIABLE` with note |
| **Two-tier from one source of truth (plugin + portable CLI)** | Users who want a Claude Code plugin get the best UX; users on any LLM (Ollama, OpenAI, Anthropic API) get the same workflow. No competitor ships both. Jenni/Yomu/Paperpal are SaaS only; Zotero plugins require Zotero | HIGH (workflow body engineering + capability_check + tier-contract test) | PRD §1 §14. The two-tier contract test (`tier-contract.test.js`) is the integrity check |
| **Honest detection framing — show GPTZero score before/after, never claim "undetectable"** | Every humanizer-tool markets itself as "bypass detection 99%." Pensmith's framing is "we improve prose; here's the score; you decide." This is both ethically defensible AND a real differentiator with academic-integrity-conscious users (and their professors, advisors, IRBs) | LOW (just calibrate the prompt + framing in templates) | PRD §3 §7.11 §14. Non-negotiable; the framing is the differentiator |
| **Free-only plagiarism check via distinctive-phrase + DuckDuckGo** | Limited recall vs Turnitin/Copyleaks but free, no API key, ethically clean. Most competitors gate plagiarism behind a paid plan | MEDIUM | PRD §7.17. Honest about being a check, not a guarantee. README must call this out |
| **Local-only, no telemetry, no cloud** | Massive moat with privacy-conscious users (some institutions ban SaaS), and a clear differentiator vs Jenni/Yomu/Paperpal/SciSpace which all phone home | LOW (architectural — nothing to add, just nothing to add) | PRD constraint. PRIVACY.md required |
| **BYO PDF ingestion with metadata hydration** | Most tools either don't accept user PDFs at all, or accept them only as chat-with-PDF (no draft integration). Pensmith treats BYO sources as first-class verifiable sources | MEDIUM (pdf-parse + GROBID/heuristic + Crossref hydration) | PRD §9. Differentiator especially for assigned-reading workflows |
| **Zotero MCP integration** | Zotero is the dominant academic reference manager. Pulling from a user's existing collection respects their already-curated library. ARIA, PapersGPT, Beaver all have plugin-style integrations; pensmith going the MCP route is more interoperable | LOW (probe + adapt; MCP server already in PRD) | PRD §11 |
| **Section-as-phase parallel writing (Tier 1)** | Wave-scheduled parallel section drafting. None of Elicit/Jenni/Yomu/Paperpal do this — they're all sequential or they re-run the whole doc. Genuinely faster for long papers | HIGH (wave scheduling + dependency graph + Task tool orchestration) | PRD §4 §14, §17 (algorithm TBD). Wins on long papers (e.g., dissertation chapters) |
| **Discipline presets (CS / Bio / History / Lit / Psych / Econ / Philosophy / Other)** | Most tools assume "research paper" = generic. Pensmith pre-configures citation style + source preferences + section structure + counterargument default + citation density target per discipline | MEDIUM | PRD §8. Could be the most-loved feature for non-STEM users where most AI tools feel STEM-centric |
| **Counterargument enforcement for argumentative papers** | Outline approval refuses without a counter+rebuttal section in argumentative papers. Forces good academic structure; no tool currently does this | LOW | PRD §7.4. Small but distinctive |
| **Hard cost cap with abort + cost meter** | Users running on paid APIs (Anthropic, OpenAI) have been burned by runaway agent loops. A per-session $5 cap is a trust signal. None of Jenni/Yomu/Paperpal expose this because they meter you on subscription, not per-call | LOW | PRD §7.19 §14 |
| **`--dry-run` + `--estimate`** | Run the workflow on cached fixtures with no API calls (great for CI/learning the tool) and project token cost before executing. No competitor offers either; it's a "this team gets it" signal for serious users | MEDIUM | PRD §7.19 |
| **Replayable session log + `--show-prompts`** | Jsonl log of every step's inputs, outputs, tokens, cost. `--show-prompts` lets the user see exactly what's about to leave the box. This is a researcher-friendly trust feature; no other tool ships it | LOW | PRD §7.22 §14. Pair with PRIVACY.md |
| **Educator / tutorial mode** | Optional "explain why I picked this source / structured this way" wrapping. Turns the tool into a learning aid instead of a black-box drafter. Distinctive ethical positioning vs. tools that hide their reasoning | LOW–MEDIUM (mostly prompt template variants) | PRD §7.13 |
| **Inline conversational corrections ("redo section 3", "make it 1500 words")** | Section-isolation directly enables this. Most tools require you to use a UI button or restart. Plain-English commands are easier than learning the tool's UI | LOW (given §4 honored) | PRD §5.6 |
| **Style-match to past writing (opt-in, dual-use disclosed)** | Legitimate use: consistency across multi-section thesis. Most tools either don't offer it or do without disclosure. Honest dual-use framing in README is the differentiator (vs. tools that quietly ship the same feature) | MEDIUM–HIGH (LLM featurization vs embeddings — PRD §17 open) | PRD §7.18 |
| **Last-verified timestamps + auto-recheck + Retraction Watch flag** | Citations age. A paper cited 6 months ago might have been retracted. No drafting tool tracks this; only specialized tools like Scite. Pensmith bakes it into normal verify | MEDIUM (timestamps + Crossref retraction API) | PRD §7.12 |
| **`/pensmith doctor` health check** | Self-diagnostic before reporting bugs. Reduces support load + builds user trust. Tools that don't ship this generate a lot of "is it me or the API?" issues | LOW–MEDIUM | PRD §7.21 |

### Anti-Features (Commonly Requested, Often Problematic)

These are what the loud market is doing wrong. Pensmith should explicitly NOT build them. Each row's "Why Problematic" is the load-bearing argument; don't hand-wave past it.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **"Bypass AI detection" / "undetectable" framing on the humanizer** | The biggest category of competitor marketing. WriteHybrid, undetectable.ai, AI Humanize, Walter Writes etc. all promise 99%+ detection bypass. It's what students Google for | (1) Detection bypass is fundamentally an arms race pensmith will lose. (2) The framing makes the tool a cheating aid, which violates academic integrity policies at most institutions and creates legal exposure. (3) Users who get caught using a tool that promised "undetectable" sue / leave loud reviews. (4) "Improves prose" is achievable; "evades detection" is a lie | PRD's framing: humanizer "improves prose," honesty score is shown as transparency. Show real GPTZero score before AND after. **Non-negotiable.** PRD §3 §7.11 §14 |
| **Auto-submit to Turnitin / GPTZero / Copyleaks for "official" certification** | Some users want a button that gets them a Turnitin cert without going through their school | (1) Turnitin's TOS forbids third-party submission. (2) Submitting on the user's behalf creates legal risk. (3) Most institutions require institutional submission, not pre-cert. (4) The "I'm safe because I pre-checked" mental model is wrong (institutional Turnitin uses different corpus including your prior submissions) | PRD §16 already excludes this. Keep it out. We do score for honesty display only |
| **Paid plagiarism integration (Turnitin / Copyleaks / Originality API)** | "Better than DuckDuckGo distinctive-phrase!" is true but the user pays | (1) API keys = friction at install. (2) Costs vary $7.99–13.99/mo, against pensmith's free positioning. (3) The user's institution probably has Turnitin already. (4) Adds maintenance burden of multiple integrations | PRD §7.17 free distinctive-phrase. Document limits clearly. If a power user really wants Turnitin they can run their final draft through their institution |
| **Auto-write whole paper in one shot ("type prompt, get paper")** | What ChatGPT / Jenni's "essay writer" mode does. Marketed as "fastest" | (1) Bypasses the verification loop entirely — every claim is unverified. (2) Trains users to submit unread work, which is the academic-integrity failure mode pensmith exists to fight. (3) Tools that do this generate the citation-fabrication horror stories ("I submitted and 14 of 20 references didn't exist") | PRD §4 mental model: section-as-phase forces user engagement. Outline approval gate is the explicit checkpoint. Pensmith is structured *for* slow, verified workflow |
| **Live conversational chat-with-paper mode as the primary UX** | Elicit, SciSpace, ChatPDF, Jenni all have this. Users like it because it's familiar | (1) Conversation has no state isolation; corrections splice into the running draft unpredictably. (2) Token cost is unbounded. (3) Doesn't enforce verification — claims accumulate without source mapping | PRD §5: structured workflow primary, single command (`/pensmith`), state-aware. Conversational corrections allowed via `inline` (§5.6) but always rooted in section directories |
| **Cloud-sync state, multi-device, accounts, login** | Standard SaaS expectation | (1) Telemetry / privacy concerns; many institutions forbid SaaS for student work. (2) Auth maintenance, password reset, security audit overhead. (3) Conflicts with local-only positioning. (4) Adds friction for the CLI-power-user audience | PRD §16. Local library at `~/.pensmith/library/`. If users want sync, they sync the directory themselves |
| **Multi-user collaboration / track-changes / comments** | Co-authoring expectation, especially for grad students with advisors | (1) Section-isolation model + git-friendly markdown already gives 90% of this for free. (2) Real-time collab requires a server, breaks local-only. (3) Out of v0.1.0 scope by PRD §16 | Markdown sections + git commit per-section is the alternative. Power users compose with their existing collab tools (Overleaf for LaTeX, GitHub PRs, etc.) |
| **Voice / speech UI** | Accessibility narrative, but mostly chase-the-trend | Out of scope; CLI/plugin form factor doesn't naturally support it. Text-first | PRD §16 explicit |
| **Built-in LaTeX equation rendering / preview** | STEM users want WYSIWYG | LaTeX is its own ecosystem (Overleaf, TeXShop). Building a preview adds a huge dependency surface for marginal value | PRD §16: export `.tex`, user runs LaTeX. Correct call |
| **Paywalled full-text scraping (sci-hub style)** | Users want quote verification on paywalled papers | (1) Legal exposure for the project. (2) MIT license + clean operations forbids it. (3) Loud political signal that compromises pensmith's serious-tool positioning | PRD §14: Unpaywall + arXiv + PubMed Central only. Mark paywalled as `UNVERIFIABLE` |
| **Citation-graph visualization (like Connected Papers / Research Rabbit)** | Visually impressive, popular at conferences | (1) Out of pensmith's drafting lane. (2) These tools (Research Rabbit, Connected Papers) already do it well — not a place to compete. (3) Adds heavy dependency for marginal drafter value | Pensmith shells out to Zotero MCP / users use Research Rabbit alongside. Stay focused |
| **Auto-thesis-generation without dialogue** | "Just give me a thesis on X" | Bad theses come from this. The PRD's `/pensmith sketch` mode (Socratic) produces better theses | PRD §7.16 sketch mode |
| **Per-section research as the default workflow** | "Research as I go" feels organic | (1) Burns API budget — research per section duplicates calls. (2) Loses cross-section coherence (sources for §3 may have been better used in §1). (3) Forces a shallower research pass | PRD §16: research is whole-paper upfront; sections can request *additions* via `plan <N> --research <query>`. Correct call |
| **AI image generation for figures / diagrams** | Trendy | (1) Quality is poor for technical/scientific figures. (2) Academic norms strongly disfavor AI figures. (3) Out of drafting lane | Out of scope; user uses their own tooling |
| **"AI co-author" branding / metadata stamp on exports** | Some tools brand themselves into the output ("Made with Jenni"); some institutions want disclosure metadata | PRD §7.9 explicit user choice: zero metadata, zero footer, zero pensmith trace. README disclaimer is the only disclosure mechanism. This is a user-facing choice (the spec author chose against the recommendation; honor it) | None — the disclaimer is the disclosure path |
| **Fine-grained subscription tiers / freemium gating of core features** | Industry norm (Paperpal, Jenni, Yomu, SciSpace, Elicit all do this) | Conflicts with MIT-licensed-free positioning. Killing the freemium-gating is part of the differentiator | Free + BYO API key for paid LLMs. Ollama for full free |
| **In-app purchase of premium AI detector subscriptions** | Commercial integration opportunity | Conflicts with free-only positioning + creates affiliate-link conflict-of-interest with the honesty score's framing | GPTZero free tier only |
| **Auto-Wikipedia / news / blog as legitimate sources** | "More sources!" feels like a feature | Encyclopedia/news sources are not citable in most academic disciplines. Letting them in invites students to cite blog posts. PRD `allow_news = false` default is correct | PRD §10 config. Let opt-in for non-research papers, default off |

### Feature Dependencies

```
Section-as-phase directory layout
    ├──enables──> Bounded per-section verifier
    ├──enables──> Inline corrections ("redo section 3")
    ├──enables──> Wave-scheduled parallel writing (Tier 1)
    └──enables──> Section-granular HANDOFF.json + resume

Two-tier source-of-truth (workflow bodies + templates)
    └──requires──> capability_check blocks
                       ├──requires──> Tier-contract test (catches drift)
                       └──requires──> Workflow body == prompt template (no logic in SKILL.md)

DOI verification (Pass 1)
    ├──requires──> DOI normalization library (bin/lib/doi.js)
    ├──requires──> HTTP client with cache + backoff (bin/lib/http.js)
    └──requires──> Crossref / arXiv / PubMed clients
        └──enables──> Author/title fuzzy match (Pass 1 cont.)
            └──enables──> MIS-CITED detection

Claim support (Pass 2)
    ├──requires──> Source full-text or abstract reachability
    │   └──requires──> Unpaywall integration
    └──enables──> SUPPORTED / PARTIAL / UNSUPPORTED / UNCLEAR verdicts
        └──enables──> Per-section verification report

Quote verification (Pass 3)
    ├──requires──> OA full-text fetch (Unpaywall + arXiv + PMC)
    ├──requires──> Fuzzy string match (Levenshtein/n-gram)
    └──blocks──> Compile (NOT_FOUND blocks export)

Per-paragraph claim audit (Pass 4)
    ├──requires──> Claim extraction (deterministic, not LLM)
    └──surfaces──> Orphan claims (uncited assertions)

Compile
    ├──requires──> All sections: Pass 1 + Pass 3 clean
    ├──requires──> Cross-section claim consistency check
    └──enables──> Done (export)

Done (export)
    ├──requires──> Compile clean
    ├──requires──> Free plagiarism check
    ├──requires──> (optional) Humanizer skill
    │   └──enables──> Honesty score before/after
    └──produces──> .docx / .pdf / .tex / .md

Library mode
    ├──requires──> Cross-platform paths (bin/lib/paths.js)
    └──enables──> /pensmith list / open across folders

BYO PDFs
    ├──requires──> pdf-parse OR pymupdf shell-out
    ├──requires──> Metadata extraction (GROBID or heuristic)
    └──requires──> Crossref hydration for canonical metadata

Style-match
    ├──requires──> Past-writing samples folder
    ├──requires──> Featurization (LLM pass OR embeddings)  [PRD §17 open]
    └──consumed-by──> Section drafter (per-section)
        └──conflicts──> Per-section voice hints (hints win)

Cost cap + meter
    ├──requires──> bin/lib/budget.js
    ├──requires──> Per-step token counting via runtime wrapper
    └──surfaces──> /pensmith status

Educator mode
    └──enhances──> Every workflow step (adds explain wrapping)
```

### Dependency Notes

- **Section-as-phase is the keystone.** Almost every differentiator depends on it. A roadmap that doesn't put `.paper/sections/<N>/` directory layout in the foundation phase will pay enormous costs later. PRD §4 §14 say this; the dependency graph confirms it.
- **DOI verification depends on DOI normalization.** Several known-bad citation tests (the same DOI written 4 different ways) will fail without a single normalize-on-the-way-in step. PRD §14 is correct to mandate `bin/lib/doi.js` first.
- **Quote verification (Pass 3) is gated by OA reachability.** Cannot promise 100% quote verification because not every cited paper is OA. The tool must clearly mark `UNVERIFIABLE` for paywalled and document this in the README. Otherwise a user expects "all quotes verified" and is surprised when paywalled quotes pass through.
- **Style-match conflicts with per-section voice hints.** Per PRD §7.18, voice hints win. Document this conflict resolution so the section drafter prompt template is unambiguous.
- **Educator mode enhances rather than gates anything.** It's a wrapping layer on existing steps, not a separate flow. The implementation is a prompt-template variant per workflow body, not a parallel codepath.
- **Library mode requires cross-platform paths.** PRD §14 already mandates `bin/lib/paths.js`; the library index has to live in the platform-correct location (`%APPDATA%`/`Application Support`/XDG). Not handling this leaks to "works on my Mac, broken on Windows" issues that competitors regularly hit.
- **Two-tier requires capability_check + workflow bodies that contain no logic.** If logic creeps into SKILL.md (Tier 1) or CLI dispatch (Tier 2), the tier-contract test will catch it but only if it's actually run. PRD §14 mandates the test; treat this as a CI gate, not a manual check.

## MVP Definition

**Reading the PRD's v0.1.0 success criteria (§15) as the actual MVP.** That's what `pensmith` ships. Everything else is post-launch.

### Launch With (v0.1.0)

Foundation:
- [ ] Section-as-phase directory layout (`.paper/sections/<NN-slug>/{PLAN,DRAFT,VERIFICATION}.md`) — the load-bearing architecture
- [ ] Two-tier source-of-truth: workflow bodies + templates shared between Tier 1 plugin and Tier 2 CLI; `<capability_check>` blocks throughout
- [ ] HANDOFF.json (section-granular) + atomic write-then-rename + concurrent-run lock
- [ ] Schema versioning + migrations dir from day one (`schema_version` on every state file)
- [ ] Cross-platform paths (Windows / macOS / Linux)
- [ ] Hard cost cap + meter; `/pensmith status` exposes it
- [ ] HTTP client with response cache (TTL per source), exponential backoff with jitter, polite User-Agent
- [ ] DOI / arXiv ID / PMID normalization (`bin/lib/doi.js`)
- [ ] Replayable session log + `--show-prompts`

Single command:
- [ ] `/pensmith` bare command resolves state-aware behavior; verb shortcuts as fallback
- [ ] Natural-language skill triggering ("redo section 3", "where am I?")
- [ ] Inline conversational corrections (length, add/drop section, swap source, redo)

Workflow:
- [ ] Intake with discipline presets (CS / Bio / History / Lit / Psych / Econ / Philosophy / Other)
- [ ] Research with parallel source-researchers (Tier 1) / sequential (Tier 2), source-evaluator, approval gate
- [ ] Outline with thesis + section structure + counterargument enforcement (where applicable) + approval gate
- [ ] Per-section plan → write → verify loop, with source-mapping isolation enforced by directory
- [ ] Verify Pass 1 (DOI integrity + author/title/year fuzzy match) — blocking
- [ ] Verify Pass 2 (claim support, LLM-judged) — advisory
- [ ] Verify Pass 3 (quote verification, OA full-text) — blocking
- [ ] Verify Pass 4 (per-paragraph orphan-claim audit) — advisory
- [ ] Last-verified timestamps + auto-recheck + Retraction Watch flag
- [ ] Compile (refuses on FABRICATED/MIS-CITED/NOT_FOUND; cross-section smoothing + claim consistency + density check)
- [ ] Done: whole-paper Pass 4, free distinctive-phrase plagiarism check, humanizer (skip cleanly if absent), honesty score before/after, export to .docx/.pdf/.tex/.md, no metadata stamp
- [ ] Library mode (`/pensmith list`, `/pensmith open`, class grouping)
- [ ] BYO PDFs (intake + ingestion + metadata extraction + Crossref hydration)
- [ ] Zotero MCP integration when detected and authenticated
- [ ] Style-match opt-in
- [ ] Educator / tutorial mode (intake choice)
- [ ] `/pensmith sketch` Socratic thesis-discovery mode
- [ ] `/pensmith doctor` health check
- [ ] `--dry-run` and `--estimate`
- [ ] `--yolo` flag (default off)

Major citation styles:
- [ ] APA 7, MLA, Chicago (notes-bib + author-date), IEEE, AMA, Vancouver
- [ ] **Add Harvard** (recommend; not in PRD §8 table but it's table stakes for UK/AU)

Tests:
- [ ] `tests/fixtures/known-bad-citations.json` (10+ fabricated DOIs; verifier flags 10/10 as FABRICATED)
- [ ] `tests/fixtures/known-bad-quotes.json` (10+ NOT_FOUND in cited source; verifier flags 10/10)
- [ ] `tests/tier-contract.test.js` (every workflow body in both tiers; equivalent outputs modulo prose)
- [ ] Cassette-based source tests; live-network gated

### Add After Validation (v1.x)

- [ ] **RIS export** — Mendeley/EndNote interop. Cheap (one-file format converter). Add when first user asks (likely week 1)
- [ ] **More citation styles via CSL** — switch from hand-rolled to `citeproc-js` + CSL files; unlocks 10,000+ styles (PRD §17 open question; recommend CSL)
- [ ] **Per-discipline source databases** beyond defaults: PhilPapers (philosophy), JSTOR config, NBER (econ), APA PsycNET (psych) — currently flagged "if configured"; bake in real clients once auth flows are documented
- [ ] **Better PDF parsing** — shell out to `pymupdf` (PRD §17 open) for higher fidelity than `pdf-parse`; enable when users hit fidelity limits
- [ ] **Wave scheduling visualization in `/pensmith status`** — show the wave plan: which sections are being written in parallel
- [ ] **Citation-graph hint** — if a section's sources cluster heavily into a citation neighborhood (Semantic Scholar API gives this for free), surface that to the user as "you might want to look at these adjacent papers"
- [ ] **Better claim extraction** — currently a deterministic step but could benefit from a calibrated LLM-judged version; pair with the Pass 4 auditor
- [ ] **Optional Turnitin-pre-check via user's own institutional account** — only if there's clear demand; never as a default
- [ ] **`/pensmith export` with custom Pandoc filters** — for users wanting specific journal templates
- [ ] **Granular cost reporting** — per-step / per-section breakdown of cost; helps users tune which models to use where (e.g., cheap model for plan, premium for verify)
- [ ] **More humanizer backends** — currently wraps the user's installed `humanizer` skill; could optionally support API-based humanizers (with the same honest framing — "improves prose, not evades")

### Future Consideration (v2+)

- [ ] **Cross-paper "literature comparison" mode** — out of v0.1.0 scope per PRD §16; revisit if users ask. Adjacent to Research Rabbit / Connected Papers — competing with established tools, low ROI
- [ ] **Multi-author / collaboration features** — section-isolation + git already handles 90% of this; revisit only if significant user demand
- [ ] **Cloud-hosted state (opt-in)** — conflicts with local-only positioning; revisit only with strong privacy-respecting design (encrypted, user-key-only) and never as default
- [ ] **Voice/speech UI** — out of form factor
- [ ] **Inline LaTeX equation rendering** — out of v0.1.0 by PRD §16; revisit only if STEM users specifically request and Overleaf integration isn't sufficient
- [ ] **Other languages beyond English** — most academic writing is English; multilingual is a large surface area to support correctly (citation styles in other languages, source databases, prompt engineering per language)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Section-as-phase directory layout | HIGH | MEDIUM | **P1** |
| DOI verification (Pass 1) | HIGH | MEDIUM | **P1** |
| Author/title fuzzy match (Pass 1 cont.) | HIGH | LOW–MEDIUM | **P1** |
| Quote verification (Pass 3) | HIGH | HIGH | **P1** |
| Two-tier (plugin + CLI) from one source | HIGH | HIGH | **P1** |
| Single `/pensmith` command, state-aware | HIGH | MEDIUM | **P1** |
| Discipline presets | HIGH | MEDIUM | **P1** |
| Outline with approval gate | HIGH | LOW | **P1** |
| Counterargument enforcement | MEDIUM | LOW | **P1** (cheap win) |
| Honest detection framing + GPTZero score | HIGH (positioning) | LOW | **P1** |
| Free distinctive-phrase plagiarism check | MEDIUM | MEDIUM | **P1** |
| Compile (cross-section smoothing + consistency) | HIGH | MEDIUM | **P1** |
| Major citation styles (APA/MLA/Chicago/IEEE/AMA/Vancouver/Harvard) | HIGH | MEDIUM | **P1** |
| .docx / .pdf / .tex / .md export | HIGH | LOW (with Pandoc) | **P1** |
| BibTeX export | HIGH | LOW | **P1** |
| Library mode (multi-paper) | MEDIUM | MEDIUM | **P1** |
| Cost cap + meter | HIGH (trust) | LOW | **P1** |
| HTTP cache + backoff | HIGH (operational) | MEDIUM | **P1** |
| HANDOFF.json + atomic writes + lock | HIGH (operational) | MEDIUM | **P1** |
| Cross-platform paths | HIGH (operational) | LOW–MEDIUM | **P1** |
| Schema versioning | MEDIUM (future-proofing) | LOW | **P1** |
| BYO PDF ingestion | HIGH | MEDIUM–HIGH | **P1** |
| Zotero MCP integration | MEDIUM | LOW (probe only; capability_check) | **P1** |
| Educator / tutorial mode | MEDIUM | LOW | **P1** (cheap, distinctive) |
| `/pensmith sketch` thesis discovery | MEDIUM | LOW | **P1** |
| `/pensmith doctor` health check | MEDIUM (trust) | MEDIUM | **P1** |
| Style-match opt-in | MEDIUM | MEDIUM–HIGH | **P1** |
| `--dry-run` + `--estimate` | MEDIUM | MEDIUM | **P1** |
| `--yolo` (default off) | LOW (power user) | LOW | **P1** |
| Replayable session log + `--show-prompts` | MEDIUM (trust) | LOW | **P1** |
| Last-verified timestamps + Retraction Watch | MEDIUM | LOW–MEDIUM | **P1** |
| Tier-contract test | HIGH (correctness) | MEDIUM | **P1** |
| Known-bad citation/quote test fixtures | HIGH (correctness) | LOW | **P1** |
| RIS export | LOW–MEDIUM | LOW | **P2** |
| CSL-based citation styles (10,000+ styles) | MEDIUM | MEDIUM | **P2** |
| Wave-scheduled parallel writing visualization | LOW | LOW | **P2** |
| Better PDF fidelity (pymupdf) | MEDIUM (when needed) | LOW | **P2** (degrade-gracefully) |
| Cross-paper literature comparison | LOW for v0.1.0 audience | HIGH | **P3** |
| Multi-author collab | LOW for v0.1.0 audience | HIGH | **P3** |
| Cloud sync | LOW (conflicts with positioning) | HIGH | **P3** |
| AI image gen for figures | LOW | HIGH | **P3** (anti-feature, really) |

**Priority key:**
- P1: Must have for v0.1.0 launch (everything in PRD's success criteria §15)
- P2: Should have, add post-launch in v0.1.x as users surface need
- P3: Defer indefinitely / out of scope

## Competitor Feature Analysis

| Feature | Elicit | SciSpace | Consensus | Scite | Paperpal | Jenni AI | Yomu AI | Citely / SwanRef / CiteMe (post-hoc) | Pensmith (our approach) |
|---------|--------|----------|-----------|-------|----------|----------|---------|--------------------------------------|--------------------------|
| Source discovery | 138M papers | broad | 200M+ via S2 | 1.6B+ citations | 250M+ refs | uses 200M | uses Sourcely | n/a | OpenAlex 250M+ + Crossref + arXiv + PubMed (free, no key) |
| Real DOI re-fetch during drafting | partial (links) | partial | partial | yes (citation context) | partial | partial (links to source PDF) | partial | yes (post-hoc on submitted text) | **yes, in-loop, blocking** |
| Author/title fuzzy match | n/a | n/a | n/a | n/a | weak | weak | weak | yes (95%+ claimed) | **yes, blocking, Pass 1** |
| Quote verification (text in cited paper) | no | no | no | partial (statements) | no | no | no | partial (some) | **yes, OA full-text, blocking** |
| Claim support (does source actually support claim) | weak | weak | meter (binary) | yes (smart citations) | weak | weak | weak | partial | **yes, LLM-judged, advisory** |
| Plagiarism check | no | no | no | no | yes (paid) | yes (paid) | yes (paid) | no | **free distinctive-phrase, no API key** |
| AI detection / honesty score | no | no | no | no | yes ("AI checker") | yes | yes | no | **GPTZero free, framed honestly** |
| "Humanizer" / detection bypass | no | no | no | no | yes (claims polishing) | yes | yes | no | **yes, framed as "improves prose"; never "undetectable"** |
| Outline-then-section workflow | data-table-first, no | yes (write mode) | no | no | yes | yes (outline-first) | yes | n/a | **yes, with approval gate** |
| Per-section state isolation | no | no | no | no | no | no | no | n/a | **yes (load-bearing)** |
| Inline corrections ("redo section 3") | no | no | no | no | partial | partial | partial | n/a | **yes, native via directory isolation** |
| Major citation styles | APA strong, others weak | many | n/a | n/a | 10,000+ | 2,600+ | many | n/a | **APA/MLA/Chicago/IEEE/AMA/Vancouver/Harvard at launch** |
| BibTeX / RIS / EndNote export | partial | partial | partial | partial | yes | yes | yes | n/a | **BibTeX at launch; RIS soon** |
| Word/PDF/LaTeX/Markdown export | partial | partial | partial | partial | docx/PDF | docx/LaTeX/HTML | docx/LaTeX/HTML/PDF | n/a | **all four via Pandoc** |
| BYO PDFs as first-class sources | partial (chat-with-PDF) | partial | no | no | partial | partial | partial | n/a | **yes, with metadata hydration + verification** |
| Zotero integration | partial | partial | no | partial | partial | partial | partial | n/a | **MCP, with auth check** |
| Resume after crash | weak | partial | n/a | n/a | partial | yes | yes | n/a | **section-granular HANDOFF + lock** |
| Local-only / no cloud | no (SaaS) | no | no | no | no | no | no | varies | **yes, local-only** |
| Cost cap | n/a (subscription) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **hard $5/session default** |
| Free + open source | partial (free tier) | partial | partial | no | freemium | freemium | freemium | partial | **MIT, fully free** |
| Two-tier (plugin + portable CLI) | no | no | no | no | no | no | no | no | **yes** |
| Educator / explain mode | no | no | partial | partial (smart citation viewer) | partial | no | no | n/a | **opt-in at intake** |

**Reading the matrix:** the "yes/strong" cells in pensmith's column that are unique to pensmith are the differentiators. Roughly:
1. Section-isolated state with inline corrections
2. Quote verification
3. Free distinctive-phrase plagiarism (vs paid)
4. Honest detection framing (vs "evade detection")
5. Two-tier
6. Local-only
7. Hard cost cap
8. MIT-licensed free

That's a strong position — none of those is shipped well by any single competitor.

## Open feature questions for downstream phases

These are real ambiguities that the requirements / phase plans should resolve. Some are also flagged in PRD §17 as discuss-phase items.

1. **Wave scheduling algorithm.** Topological-sort by `depends_on` is the obvious default; allow user override. Phase: parallel-writing implementation phase. (PRD §17.)
2. **Section-dependency declaration syntax in OUTLINE.md.** Simple `depends_on: [1, 2]` per section vs. richer graph. Recommend simple. (PRD §17.)
3. **Section renumbering when inserting/dropping mid-project.** PRD §17 recommends stable: use folder names like `03-methods/` and add `03b-validity-threats/` rather than renumbering. Confirm and document in user-facing help.
4. **CSL vs hand-rolled citation formatters.** Recommend CSL via `citeproc-js`. (PRD §17.)
5. **PDF parsing: `pdf-parse` (pure JS) vs shell-out to `pymupdf`.** Recommend `pdf-parse` for v0.1.0, `pymupdf` opt-in for fidelity. (PRD §17.)
6. **Style-match implementation.** LLM featurization (semantic) vs embeddings + similarity. Embeddings cheaper at scale; LLM featurization more interpretable. Recommend embeddings with an LLM fallback when sample folder is small. (PRD §17.)
7. **Library index format.** JSON vs SQLite vs sidecar. Recommend JSON for v0.1.0 (simple, diffable, ~thousands of entries fine). SQLite if it grows. (PRD §17.)
8. **Compile cross-section claim consistency aggressiveness.** Default heuristics. Start conservative — flag explicit contradictions ("X is Y" vs "X is not Y"); don't try to detect subtle disagreement. (PRD §17.)
9. **Honesty score backend default.** GPTZero has the lowest false-positive rate (0.24% reported) per recent comparisons; recommend default. Originality.ai second (paid). Sapling third. PRD already lists all three; default to GPTZero free tier.
10. **Should the verifier ever auto-correct, or always flag for human?** Strongly recommend always flag; never auto-correct citations. The verifier exists because the LLM cannot be trusted; letting it correct itself defeats the purpose. PRD seems to agree but make this explicit in the verifier prompt template.
11. **Should pensmith ship Harvard citation style at v0.1.0?** Recommend yes — it's table stakes for UK/AU users and absent from PRD §8 table. Cheap to add.
12. **Honesty score: report format.** Show before/after as percentages with a note. Don't show a "you're safe" or "you're flagged" interpretation — let the user read the number. PRD §7.11 already nails this; reinforce in template.

## Sources

- [Elicit vs Consensus comparison (Paperguide, 2026)](https://paperguide.ai/blog/elicit-vs-consensus/)
- [Elicit vs SciSpace comparison (Paperguide, 2026)](https://paperguide.ai/blog/elicit-vs-scispace/)
- [Trust in AI: Evaluating Scite, Elicit, Consensus, and Scopus AI for Generating Literature Reviews (HKUST Library)](https://library.hkust.edu.hk/sc/trust-ai-lit-rev/)
- [AI Citation Hallucination: What It Is and How to Prevent It (Citely)](https://citely.ai/posts/ai-citation-hallucination-what-it-is-and-how-to-prevent-it)
- [How to Check if an AI-Generated Citation Is Real, 2026 Guide (Citely)](https://citely.ai/posts/how-to-check-if-an-ai-generated-citation-is-real-2026-guide)
- [AI Hallucinations in Research: Why 40% of AI Citations Are Wrong (Enago)](https://www.enago.com/academy/ai-hallucinations-research-citations/)
- [The Fabrication Problem: How AI Models Generate Fake Citations (Medium / Nayeem Islam)](https://medium.com/@nomannayeem/the-fabrication-problem-how-ai-models-generate-fake-citations-urls-and-references-55c052299936)
- [SwanRef AI Citation Checker](https://www.swanref.org/)
- [CiteMe AI Reference Checker](https://citeme.app/tools/reference-checker)
- [Paperpal product page](https://paperpal.com/)
- [Writefull review on Paperpal blog](https://paperpal.com/blog/news-updates/industry-insights/writefull-review)
- [Writefull vs Paperpal (Otio Blog)](https://otio.ai/blog/writefull-vs-paperpal)
- [GPTZero vs Copyleaks vs Originality (GPTZero blog)](https://gptzero.me/news/gptzero-vs-copyleaks-vs-originality/)
- [AI Detection Accuracy Studies — Meta-Analysis of 14 Studies (Originality.AI)](https://originality.ai/blog/ai-detection-studies-round-up)
- [GPTZero Limitations: Accuracy Issues & False Positives (Hastewire)](https://hastewire.com/blog/gptzero-limitations-accuracy-issues-and-false-positives)
- [Scite product page](https://scite.ai/)
- [scite: A smart citation index (Quantitative Science Studies, MIT Press)](https://direct.mit.edu/qss/article/2/3/882/102990/scite-A-smart-citation-index-that-displays-the)
- [AI Humanizers in Academic Writing: Risks (Paperpal)](https://paperpal.com/blog/academic-writing-guides/ai-humanizers-in-academic-writing-risks)
- [ARIA AI Research Assistant for Zotero (GitHub)](https://github.com/lifan0127/ai-research-assistant)
- [7 Best Zotero AI Plugins, 2026 (PapersFlow)](https://papersflow.ai/blog/best-zotero-ai-plugins-2026)
- [Litmaps vs ResearchRabbit vs Connected Papers (Effortless Academic)](https://effortlessacademic.com/litmaps-vs-researchrabbit-vs-connected-papers-the-best-literature-review-tool-in-2025/)
- [Research Rabbit vs Connected Papers (Qubic Research, 2026)](https://qubicresearch.com/research-rabbit-vs-connected-papers/)
- [Jenni AI Review 2025 (Skywork)](https://skywork.ai/blog/jenni-ai-review-2025-academic-writing-citation-comparison/)
- [Yomu AI vs Jenni AI (Jenni AI blog)](https://jenni.ai/blog/jenni-ai-vs-yomu-ai)
- [Jenni AI product page](https://jenni.ai/)
- [Yomu AI Review (Effortless Academic)](https://effortlessacademic.com/yomu-ai-review-academic-ai-writing-tool/)
- [Copyleaks vs Turnitin: Which Wins for AI Detection in 2025 (Hastewire)](https://hastewire.com/blog/copyleaks-vs-turnitin-which-wins-for-ai-detection-in-2025)
- [I Tested Every AI Plagiarism Checker, 2025 (Skyline Academic)](https://skylineacademic.com/blog/i-tested-every-ai-plagiarism-checker/)
- [OpenAlex documentation FAQ](https://docs.openalex.org/additional-help/faq)
- [OpenAlex Work object documentation](https://docs.openalex.org/api-entities/works/work-object)
- [Retraction Watch retractions in the Crossref API (Crossref blog)](https://www.crossref.org/blog/retraction-watch-retractions-now-in-the-crossref-api/)
- [Best AI tools for medical research 2026 (iatroX)](https://www.iatrox.com/blog/best-ai-tools-medical-research-2026-elicit-consensus-semantic-scholar-perplexity)
- [Top 5 AI Tools for Academic Writing 2026 (Paperpal)](https://paperpal.com/blog/news-updates/top-5-ai-tools-for-academic-writing)

---
*Feature research for: AI-assisted academic paper writing*
*Researched: 2026-05-06*

---
---

# ADDENDUM (v0.3.0): Citation-Grounded Drafting Feed

**Domain:** Citation-grounded LLM drafting (RAG-style source-feeding for academic paper generation) — the "FEED" workstream
**Researched:** 2026-07-06
**Confidence:** HIGH (codebase-verified) / MEDIUM (external grounding-technique claims)

## Context: what's actually being closed here

This addendum covers a narrower, later-milestone question than the section above: not
"what should pensmith's feature set be" (already answered, above, for v0.1.0), but
"how does feeding discovered sources into the plan/write prompts typically work, and
what does v0.3.0 need to build to close the tech-debt gap." It is not greenfield —
the codebase already specifies almost the entire target design in two prompt
templates that predate the wiring:

- `templates/prompts/section-planner.md` — already instructs the planner to pick
  3-15 citekeys from `{{candidateSources}}` into `assigned_sources`, with an explicit
  "NEVER invent a citekey" constraint and a citekey-existence requirement.
- `templates/prompts/section-drafter.md` — already instructs the drafter to cite
  ONLY `{{assignedSources}}` (its per-section restricted view), NEVER reach outside
  it, and to prefer an uncited claim over a fabricated citation.

The gap is **purely in the CLI wiring**, confirmed by direct code read:

- `bin/cli/plan.ts:129` — `candidateSources: '(no sources loaded yet — wire via Phase 12 / GEN-03)'` (a literal placeholder string interpolated into the prompt).
- `bin/cli/write.ts:220` — `assignedSources: '[]'` (always empty).
- `bin/cli/write.ts:158` `readAssignedSources()` already parses `PLAN.md` frontmatter's
  `assigned_sources` citekey array — it just isn't used to hydrate full source
  objects from `LIBRARY.json` yet (it's currently only read at line 429 for a
  different, unrelated purpose — tutorial provenance).
- `LIBRARY.json` (`bin/cli/research.ts:298-309`) already has the exact shape needed:
  `{ $schemaVersion: 1, entries: SourceCandidate[] }`, where each `SourceCandidate`
  carries `title, authors, year, doi, abstract, citekey` (confirmed in
  `research-orchestrator.ts`, which already caps abstracts at 500 chars for its own
  source-evaluator prompt — precedent for the token-budgeting approach below).

So this addendum treats "how does citation-grounded drafting typically work" as the
industry frame, then maps every element onto the specific pieces pensmith already
has (LIBRARY.json, citekey grammar, `[@citekey]` token, blocking verifier) vs. what
v0.3.0 must still build (the two wiring points + hydration + token budget + a
stranded-source safety net).

## Feature Landscape (FEED workstream)

### Table Stakes (Users Expect These)

These are the load-bearing mechanics that make "the planner/drafter are no longer
blind to research" true. Missing any of these means the feature is not actually
shipped, just partially wired.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Plan step reads real `LIBRARY.json` into `{{candidateSources}}`** | The section-planner prompt already contracts on this variable; it's the entire point of the milestone | LOW | Replace `plan.ts:129`'s placeholder string with `JSON.parse(readFileSync(libraryPath))` → filtered/shaped candidate array. `LIBRARY.json` and its schema already exist; no new I/O primitive needed. |
| **Write step hydrates `assigned_sources` citekeys into full source objects for `{{assignedSources}}`** | The section-drafter prompt already contracts on receiving full `SourceCandidate` objects, not bare citekeys — it needs title/authors/year/DOI to write real claims | LOW-MEDIUM | `readAssignedSources()` already extracts the citekey array from `PLAN.md` frontmatter; add a citekey→`LIBRARY.json`-entry lookup (Map keyed by citekey) and pass the hydrated subset. This is the second of the two literal placeholder fixes. |
| **Section→source assignment persisted in `PLAN.md` `assigned_sources`** | Already implemented (frontmatter field + schema `bin/lib/schemas/plan-frontmatter.ts` + zod validation) | DONE | Not new work — confirm the field survives round-trip once real data flows through it. This is the persistence contract the plan/write split (below) depends on. |
| **Field selection: title, authors, year, DOI, abstract (truncated), citekey — not full text** | This is the standard "shape retrieved docs for the prompt" step in every RAG-style writing tool (Perplexity, Elicit-style pipelines): bibliographic metadata + abstract, not full papers, keeps the prompt scoped to what a section brief needs | LOW | The 500-char abstract cap is precedent already set in `research-orchestrator.ts`'s own source-evaluator call — reuse the exact same truncation constant/helper rather than re-deriving a new budget. |
| **Per-section citekey scoping enforced at the object level, not just by convention** | PRD §7.6 explicitly requires "source-isolation enforced by directory structure, not just prompt convention" — a prompt instruction alone ("please only use these") is a documented-insufficient mitigation (see Grounding section below); the input array itself must not contain other sections' sources | LOW | Already partly done — `assertDrafterInput` (referenced in `write.ts`) is the enforcement chokepoint; extend its validation to assert every prompt-injected source is drawn from `assigned_sources`, not merely that the shape is well-typed. |
| **Topic/discipline context flows into planning** | `{{topic}}` and `{{discipline}}` are already contracted prompt variables (currently hardcoded placeholders `'(topic from INTAKE.md — wire via Phase 12)'` / `'other'`) — needed for the planner to judge source relevance per section, not just presence | LOW | Read from `PROJECT.md`/`config.toml`, which already exist from intake. Small, mechanical. |
| **Upstream section plans flow into dependent sections' planning** | `{{upstreamPlans}}` is already a contracted variable (per `depends_on`) — a Discussion section needs to know what Results already claimed to avoid re-citing redundantly or contradicting | LOW-MEDIUM | Read already-written `sections/<M>/PLAN.md` briefs for `M` in `depends_on`. Read-only; does not touch upstream section files (preserves isolation). |
| **Empty/insufficient-candidate-pool handling** | If `LIBRARY.json` has zero or too few entries (e.g., research produced nothing, or approval-gate pruning left too few), the planner must not silently assign nothing or hallucinate placeholder citekeys | LOW | `research.ts` already WARNs and writes an empty `LIBRARY.json` on zero candidates (line 283-286) — the planner needs a parallel guard: if `candidateSources` is empty, either block with a clear message routing back to `research`/`add`, or (for `outline-only` mode) proceed uncited. Small, but must not be skipped. |

### Differentiators (Competitive Advantage)

These go beyond "wire the placeholder" and materially improve grounding quality or
UX. They align with the core value (every citation real + verifiable) more than
with raw feature breadth — worth doing, but each should be sized against the
existing verifier/citekey machinery rather than invented independently.

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| **Relevance-ranked candidate ordering before truncation, not just first-N** | If `candidateSources` must be token-budgeted down from (e.g.) 40 sources to a manageable prompt size, naive truncation (array order) silently drops the most relevant sources for a given section. Cheap relevance signal (keyword/embedding overlap between section title+brief-seed and each candidate's title/abstract) ordered before any cap keeps the best matches in view | MEDIUM | Elicit/Perplexity-style pipelines rank-then-truncate rather than truncate-then-rank. Pensmith doesn't need embeddings — reuse the Jaro-Winkler/lexical tooling already in `research-orchestrator.ts` for a lightweight relevance score, or let the source-evaluator's existing per-candidate scoring (already computed once at research time) double as the sort key so this is metadata reuse, not new inference. |
| **"Stranded source" surfacing after planning** | PRD §7.15 already requires the `add` verb to ask "should I remap sections to use this?" — the inverse case (a `LIBRARY.json` source that no section ever picked up across all sections) is worth surfacing at outline/plan completion so approved research doesn't silently go unused | LOW-MEDIUM | Diff `LIBRARY.json` citekeys against the union of all sections' `assigned_sources` after all sections are planned; report unused sources in the outline/status output. Advisory only — never blocks. |
| **Section-scoped research (`plan <N> --research <query>`) merges cleanly into the same candidate/hydration pipeline** | PRD §7.5 already specifies this flag; once real `LIBRARY.json` feeding exists, the section-scoped addition must append to `LIBRARY.json` (or a section-local extension of it) using the SAME `SourceCandidate` shape and citekey uniqueness guarantee, not a parallel ad-hoc structure | MEDIUM | Depends on the citekey-uniqueness contract (`tests/citekey-collision.test.ts` already exists) — new section-scoped candidates must run through the same dedup/citekey-assignment path as whole-paper research, or divergent citekey formats become a second class of "unresolvable citekey" the verifier has to handle. |
| **Voice-hint + brief separation from source list in the drafter prompt structure** | Already implemented in the section-drafter template design (`{{brief}}`, `{{assignedSources}}`, `{{voiceHint}}` as distinct blocks) — worth explicitly preserving as prompt *structure* (not concatenating everything into one blob) because it lets the drafter distinguish "argument I must make" from "ground truth I may cite" | LOW | This is a documentation/structure-preservation note more than new code — the existing `interpolate()` call already keeps these as separate template variables; just don't collapse them into a single string when wiring the real data through. |
| **Machine-readable source list format in the prompt (small JSON array, not prose paragraph)** | A structured `[{citekey, title, authors, year, doi, abstract}, ...]` block is easier for the model to enumerate exhaustively (and copy citekeys verbatim from) than a prose-rendered bibliography; reduces the chance of the model paraphrasing a citekey wrong | LOW | `research-orchestrator.ts` already serializes candidates as JSON for the source-evaluator prompt (`JSON.stringify` with the same field subset) — reuse that exact serialization helper for `candidateSources`/`assignedSources` rather than writing a second renderer. |

### Anti-Features (Commonly Requested, Often Problematic)

Each of these sounds like it would make drafting better-grounded or more capable,
but actively fights either the blocking verifier, the section-isolation model, or
the citekey-uniqueness contract. Flag these explicitly for the roadmap so they
don't get proposed as "obvious" additions later.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| **Let the drafter free-cite from the full `LIBRARY.json`, not just `assigned_sources`** | "More sources visible = richer draft, fewer orphan claims" | Directly violates PRD §7.6's restricted-view contract, which is *the* load-bearing isolation mechanism (re-doing section 3 must never pull in section 5's sources or drift its argument). It also defeats the purpose of the planner step entirely — if the drafter can see everything, the plan's `assigned_sources` field becomes decorative | Keep the drafter's input hard-scoped to `assigned_sources`. If a section is under-cited, the planner re-balances (`plan <N> --revise`) and re-assigns — the fix is a re-plan, not a wider draft-time aperture. |
| **Model self-reports which sources it "used" after drafting, and pensmith trusts that as the citation ground truth** | Feels efficient — skip parsing `[@citekey]` tokens, just ask the model to list what it cited | This inverts the trust model. The verifier's entire design (Pass 1 re-fetch, Pass 3 quote-check) exists *because* the model's self-report cannot be trusted — a model can claim it cited `[@smith2020]` correctly while emitting a typo'd or wrong key, or claim support it didn't actually establish. Self-report is exactly the failure mode RAG grounding research (see Sources) warns is insufficient on its own | Deterministic extraction of `[@citekey]` tokens from the actual draft text (`citation-token.ts`'s `extractCitekeys`, which already exists) is the only ground truth. Self-report can be an *advisory* cross-check at most, never authoritative. |
| **Free-text citation styles in the draft (e.g., "(Smith, 2020)" or "[1]") that get normalized to `[@citekey]` post-hoc** | Feels more natural for the model to write in the target citation style directly | The section-drafter prompt already explicitly forbids this (D-21: Pandoc `[@citekey]` is the only accepted form) for good reason — normalizing free-text back to a citekey is a fuzzy-match problem (which paper does "(Smith, 2020)" mean if two assigned sources are both Smith 2020a/2020b?) that reintroduces exactly the ambiguity the citekey system exists to eliminate | Keep `[@citekey]` as the only in-draft citation form; render to the target style (APA/MLA/etc.) only at compile/export time via the existing CSL rendering library. Already the design — don't let a "nicer draft-time UX" argument erode it. |
| **Over-stuffing: assign all/most `LIBRARY.json` sources to every section "just in case"** | Seems safer than under-citing — more sources visible means the drafter is less likely to write an orphan claim | The section-planner prompt already caps this at 3-15 for a documented reason (below 3 → too little ground truth; above 15 → drafter loses focus and sections blur together). Over-stuffing also multiplies Pass-1/Pass-3 verifier work per section (re-fetching DOIs, quote-checking) for sources that may never actually get cited, inflating verifier cost without improving correctness | Keep the 3-15 assignment band planner-side. If a section is legitimately source-poor, that's a signal for `plan <N> --research <query>` (targeted addition), not "hand it the whole library." |
| **Silent citekey substitution when the model emits a near-miss key (e.g., auto-correct `[@smith2020]` → `[@smith-2020]`)** | Feels helpful — reduce false FABRICATED verdicts caused by trivial formatting drift | This is a fail-open behavior in a system whose #1 non-negotiable is fail-closed citation integrity (GATE-04 already treats the verifier as `--yolo`-unskippable). A "helpful" auto-correct that guesses the intended citekey is itself an unverified inference sitting upstream of the verifier — if it guesses wrong, a MIS-CITED-worthy substitution now looks clean | If the drafter emits a citekey outside `assigned_sources`, that's a hard bug in the constrained-generation step, not something to paper over with fuzzy correction. Surface it as a drafting-contract violation (retry the write step / flag in `assertDrafterInput`-style validation) rather than silently rewriting the token. |
| **Cross-section shared source pool with mutable global "already cited" state during drafting** | Wanting to avoid two sections citing the same source in a way that reads redundant, or to enable live coordination ("section 4 already used Smith for X, so section 5 should use it differently") | This requires drafting sections to be aware of sibling section state in real time, which breaks the parallel wave-scheduling model (sections in the same wave are written concurrently with no ordering guarantee) and reintroduces the exact cross-section coupling that section-as-phase isolation was built to eliminate | Redundancy-across-sections is a `compile`-time concern (the existing cross-section claim-consistency check), not a drafting-time one. Let sections draft independently; resolve redundancy/contradiction at compile. |
| **Token-budget the source list by truncating abstracts to near-zero or dropping them entirely to fit more citekeys in** | If the source list is "too big," cutting abstracts seems like the easy lever | Abstracts are what let the planner/drafter reason about *why* a source supports a claim, not just that it exists. Dropping them turns source selection into citekey-matching-by-title-alone, which increases the odds of assigning a topically-irrelevant source just because its title contains matching keywords | Budget by candidate *count* (rank-then-cap, per the differentiator above) before budgeting by per-field truncation. The existing 500-char abstract cap (already precedented in `research-orchestrator.ts`) is a reasonable floor — don't go lower to fit more sources; instead show fewer, better-ranked sources at full detail. |

## Feature Dependencies (FEED workstream)

```
LIBRARY.json (SourceCandidate[] — EXISTS, GEN-03)
    └──required-by──> Plan step reads candidateSources
                           └──required-by──> assigned_sources written to PLAN.md frontmatter (EXISTS)
                                                  └──required-by──> Write step hydrates assignedSources
                                                                         └──required-by──> [@citekey] tokens in DRAFT.md
                                                                                                └──verified-by──> Blocking verifier Pass 1 (DOI/author fuzzy) + Pass 3 (quote-check) (EXISTS)

Citekey uniqueness contract (EXISTS — tests/citekey-collision.test.ts)
    └──required-by──> Section-scoped research (`plan <N> --research`) merging into same pool
    └──required-by──> Hydration lookup (citekey → SourceCandidate Map) not ambiguous

assertDrafterInput chokepoint (EXISTS — write.ts)
    └──enforces──> Per-section restricted view (drafter never receives outside-assigned_sources data)

Relevance ranking (differentiator)
    └──enhances──> Token-budgeted truncation (doesn't drop the best-fit sources first)

Stranded-source surfacing (differentiator)
    └──enhances──> Outline/plan completeness (but is advisory — never blocks compile)

Anti-feature: free-cite from full library ──conflicts──> Section-as-phase isolation (PRD §7.6, load-bearing)
Anti-feature: self-reported citations ──conflicts──> Blocking verifier's re-fetch-the-source design (Core Value)
Anti-feature: silent citekey auto-correct ──conflicts──> Fail-closed verifier gate (GATE-04, --yolo-unskippable)
```

### Dependency Notes (FEED workstream)

- **Plan step requires LIBRARY.json to exist and be non-empty (or explicitly empty with a warning)** before it can meaningfully populate `assigned_sources`. This is already the shape research.ts produces — no new upstream dependency, just a consumer that doesn't exist yet.
- **Write step requires `assigned_sources` to already be persisted in PLAN.md** (it is, per the existing frontmatter schema) — the write step's ONLY new responsibility is the citekey→object hydration lookup against `LIBRARY.json`, not re-deciding assignment.
- **The verifier's DOI/author/title fuzzy-match (Pass 1) and quote-check (Pass 3) are unchanged by this milestone** — they already operate on whatever `[@citekey]` tokens land in DRAFT.md, regardless of how those tokens got there. This milestone's job is entirely upstream of the verifier: make sure the tokens that land are drawn from real, resolvable, section-scoped sources so the verifier has something legitimate to check, rather than nothing (today) or something invented.
- **Citekey uniqueness (global across LIBRARY.json) is a hard prerequisite for hydration correctness** — if two entries ever shared a citekey, a citekey→object Map lookup would be ambiguous. This is already tested (`tests/citekey-collision.test.ts`); the FEED work should add a regression test that hydration explicitly uses this map-based lookup, not an array scan that could silently pick the wrong duplicate.
- **Relevance ranking enhances but does not gate** the table-stakes wiring — ship naive (array-order or research-time-scored) candidate lists first; ranking refinement can follow once real usage shows truncation actually drops relevant sources in practice.
- **Anti-features conflict with existing non-negotiables**, not with each other — each one independently violates either §7.6 (section isolation), the Core Value (verifier re-fetches, doesn't trust self-report), or GATE-04 (fail-closed, unconditional). They should be called out explicitly in the roadmap/requirements doc as "considered and rejected," not silently omitted.

## MVP Definition (FEED workstream)

### Launch With (v0.3.0 FEED milestone)

Minimum viable product — closes the exact tech-debt gap named in PROJECT.md.

- [ ] `plan.ts` reads real `LIBRARY.json` and populates `{{candidateSources}}` (replacing the literal placeholder string at line 129) — this is the headline fix
- [ ] `plan.ts` populates `{{topic}}` / `{{discipline}}` from `PROJECT.md`/`config.toml` (currently hardcoded placeholders)
- [ ] `plan.ts` populates `{{upstreamPlans}}` from already-planned `depends_on` sections' briefs
- [ ] `write.ts` hydrates `assigned_sources` citekeys into full `SourceCandidate` objects via a citekey→entry Map over `LIBRARY.json`, replacing `assignedSources: '[]'` at line 220
- [ ] Field shape for both prompts: `{ citekey, title, authors, year, doi, abstract (500-char cap, reusing the existing truncation precedent) }` — no full text, no extra fields
- [ ] `assertDrafterInput` (or an equivalent chokepoint) validates every source object passed to the drafter is a member of that section's `assigned_sources` — enforcement at the object level, not just prompt wording
- [ ] Empty/insufficient-`LIBRARY.json` guard in the plan step (clear message + non-crashing path), mirroring the existing zero-candidate WARN already in `research.ts`
- [ ] Regression test: hydration uses citekey-keyed lookup (not array scan) and fails loudly on a citekey present in `assigned_sources` but absent from `LIBRARY.json` (stale/edited PLAN.md case)

### Add After Validation (v1.x of the FEED workstream)

- [ ] Relevance-ranked candidate ordering before any truncation cap (reuse source-evaluator's existing per-candidate scoring or a lightweight lexical/keyword overlap score)
- [ ] Stranded-source surfacing (sources in `LIBRARY.json` never picked up by any section) at outline/plan-complete time, advisory only
- [ ] Section-scoped research (`plan <N> --research <query>`) merges new candidates into the same `LIBRARY.json`-shaped pool with the same citekey-uniqueness guarantee

### Future Consideration (v2+)

- [ ] Embedding-based relevance ranking (only if lexical/keyword ranking proves insufficient in real usage — don't reach for this by default; it adds an infra dependency the project doesn't currently have)
- [ ] Cross-paper source reuse / shared candidate cache (explicitly out of scope per PROJECT.md — "Cross-paper literature comparison mode" is scope creep beyond current direction)

## Feature Prioritization Matrix (FEED workstream)

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Plan step: real `candidateSources` from `LIBRARY.json` | HIGH | LOW | P1 |
| Write step: hydrated `assignedSources` from citekey lookup | HIGH | LOW | P1 |
| `assertDrafterInput`-level scoping enforcement | HIGH | LOW | P1 |
| Empty-library guard in plan step | MEDIUM | LOW | P1 |
| Topic/discipline/upstreamPlans real wiring | MEDIUM | LOW | P1 |
| Relevance-ranked truncation | MEDIUM | MEDIUM | P2 |
| Stranded-source surfacing | LOW-MEDIUM | LOW-MEDIUM | P2 |
| Section-scoped research merge into shared pool | MEDIUM | MEDIUM | P2 |
| Embedding-based ranking | LOW (unproven need) | HIGH | P3 |

**Priority key:**
- P1: Must have — this IS the v0.3.0 milestone (the two placeholder fixes + the enforcement/guard work that makes them safe)
- P2: Should have, natural follow-on once P1 is proven in real usage
- P3: Nice to have, explicitly defer until a concrete gap is observed

## Competitor / Reference-Pattern Analysis (FEED workstream)

| Pattern | Perplexity-style RAG pipelines | Generic "cite-only-provided-docs" LLM prompting (industry consensus) | Pensmith's approach |
|---------|-------------------------------|------------------------------------------------------------------------|----------------------|
| Source shaping | Structured prompt assembly with pre-embedded, numbered citations from reranked retrieval | Explicit whitelist instructions ("do NOT cite papers not in this list") + structured (JSON-like) source blocks | JSON-serialized `SourceCandidate[]` subset (citekey/title/authors/year/doi/abstract), matching the precedent already set for the source-evaluator prompt |
| Grounding enforcement | Multi-stage rerank + citation-by-index format that structurally limits what can be cited | Prompt instructions ALONE are documented as insufficient; needs real-time/post-hoc validation against the source list | Two-layer enforcement: (1) prompt-level hard constraints already written into `section-drafter.md`/`section-planner.md`, PLUS (2) deterministic post-hoc verification — the blocking verifier (Pass 1 DOI re-fetch + author/title fuzzy match, Pass 3 quote-check) that re-fetches live sources rather than trusting the model's compliance |
| Scope of retrieved set per generation unit | Perplexity retrieves 5-10 candidates per query/answer, filtering >50% before final synthesis | N/A (single-shot chat, not multi-section documents) | Per-*section* scoping (3-15 assigned citekeys), not per-whole-document — this is pensmith's differentiator relative to generic RAG chat tools, and is what the section-as-phase model requires |
| Self-report vs. deterministic extraction | Perplexity embeds citations structurally at generation time (citation-by-index is part of the output format, not a separate self-report step) | Structured output / tool-calling schemas preferred over free-text self-report, because free-text citation claims are unreliable | Deterministic extraction via `extractCitekeys()`/`CITATION_TOKEN_RE` from the actual draft text — never trusts a model self-report of what it cited |

## Sources (FEED workstream)

- [How to Stop LLM Hallucinations in Retrieval-Augmented Generation (RAG)](https://sharur7.medium.com/how-to-stop-llm-hallucinations-in-retrieval-augmented-generation-rag-5ef2894f9cd6) — MEDIUM confidence, general RAG grounding mechanics
- [Grounding and Evaluation for Large Language Models: Practical Challenges and Lessons Learned (arXiv survey)](https://arxiv.org/pdf/2407.12858) — MEDIUM confidence, "grounding necessary but not sufficient" framing
- [How to Prevent AI Citation Hallucinations in 2026 — INRA.AI](https://www.inra.ai/blog/citation-accuracy) — MEDIUM confidence, closed-set whitelist prompt pattern ("do NOT cite papers not in this list") directly informs the anti-invented-citekey framing
- [My AI Kept Hallucinating Citations. Here's the Code That Fixed It. (Medium)](https://medium.com/@taotang757/my-ai-kept-hallucinating-citations-heres-the-code-that-fixed-it-353d0dbc0d78) — LOW-MEDIUM confidence, corroborates that prompt-only constraints are insufficient without deterministic post-hoc validation; consistent with pensmith's existing blocking-verifier design (independently arrived at, verified as sound practice)
- [How Perplexity AI Answers Work: Retrieval, Ranking, and Citation Pipeline](https://ziptie.dev/blog/how-perplexity-ai-answers-work/) — MEDIUM confidence, rank-then-truncate and structured-prompt-with-pre-embedded-citations patterns
- [CiteCheck: Retrieval-Grounded Detection of LLM Citation Hallucinations in Scientific Text (arXiv)](https://arxiv.org/pdf/2605.27700) — LOW confidence (not deeply read, title/abstract-level only), flags citation-hallucination-in-scientific-text as an active research problem, corroborating why re-fetch-based verification (already built) is the right posture rather than prompt-trust alone
- Direct codebase inspection (HIGH confidence, primary source for all pensmith-specific claims):
  - `templates/prompts/section-planner.md` — existing assignment/grounding contract
  - `templates/prompts/section-drafter.md` — existing per-section restricted-view contract
  - `bin/cli/plan.ts` (lines 118-133) — confirmed placeholder gap for `candidateSources`/`topic`/`discipline`/`upstreamPlans`
  - `bin/cli/write.ts` (lines 156-220, 429) — confirmed placeholder gap for `assignedSources`, existing `readAssignedSources()` helper
  - `bin/lib/research-orchestrator.ts` — confirmed `SourceCandidate` field shape and existing 500-char abstract truncation precedent
  - `bin/cli/research.ts` (lines 96-309) — confirmed `LIBRARY.json` schema (`{ $schemaVersion, entries }`) and empty-candidate WARN precedent
  - `bin/lib/citation-token.ts` — confirmed deterministic `[@citekey]` extraction machinery already used by the verifier
  - `.planning/PROJECT.md` and `PRD.md` §7.5-7.6 — confirmed the section-as-phase / restricted-view non-negotiable this milestone must not violate

---
*Feature research for: citation-grounded drafting feed (pensmith v0.3.0)*
*Researched: 2026-07-06*
