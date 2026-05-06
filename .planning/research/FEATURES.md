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
