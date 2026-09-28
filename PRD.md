# `pensmith` — Product Requirements Document

**Intended use:** feed this into GSD via `/gsd:new-project --auto @PRD.md`, then let GSD's planner break it into phases.

**Project type:** greenfield Claude Code plugin + portable Node CLI.
**Inspiration:** [Get Shit Done](https://github.com/gsd-build/get-shit-done) and [gsd-plugin](https://github.com/jnuyens/gsd-plugin) — same architectural patterns (skills, agents, MCP server, hooks, workflow bodies, HANDOFF.json), academic-paper domain instead of code.
**License:** AGPL-3.0-or-later.
**Name:** `pensmith`.

---

## 1. What we're building

A structured research-and-drafting assistant for academic papers. Given an assignment prompt, it runs an opinionated workflow:

```
intake → research → outline → for each section { plan → write → verify } → compile → done (humanize + honesty + export)
```

It ships in two tiers from one source of truth:
- **Tier 1 — Claude Code plugin.** Single slash command `/pensmith`, parallel subagents via the `Task` tool, MCP-backed state, hooks for auto-resume across `/compact`. Best UX.
- **Tier 2 — Portable Node CLI.** `pensmith <verb>` runs the same workflows against any OpenAI-compatible endpoint (Anthropic, OpenAI, Ollama, vLLM, llama.cpp). Sequential execution, no subagents, no MCP. Same workflow files, same templates.

Workflow bodies (`workflows/*.md`) and templates (`templates/*.md`) are the shared source of truth — both tiers read them. Workflows must include `<capability_check>` blocks that detect Task / MCP / AskUserQuestion availability and degrade gracefully.

---

## 2. Why now / who is this for

For students, grad students, and researchers who already use LLMs to help with academic writing and want a structured workflow that (a) only pulls from real, citable academic sources, (b) verifies every citation against the live source, and (c) doesn't pollute their writing with obvious AI tells. Existing options: ad-hoc ChatGPT/Claude prompting (no verification, frequent fabricated citations), or paid tools like Elicit and SciSpace (closed source, narrow workflows). Open-source gap is real.

---

## 3. Disclaimer (load-bearing — appears in README and intake step)

> `pensmith` is a structured research-and-drafting assistant for academic writing. It helps you turn an assignment prompt into a sourced outline or, optionally, a full draft, using only verifiable peer-reviewed and configurable academic sources. It includes a citation verifier that re-fetches every cited DOI and flags unsupported claims for human review, and a humanizer pass that improves readability.
>
> This tool is for your own writing, research, and learning. It is not a guarantee against AI detectors and it is not a substitute for doing the reading. Submitting fully tool-generated work as your own is, in many institutions, a violation of academic integrity policy. You are responsible for the work you submit.

(No metadata stamp or visible disclosure is added to exported documents — see §7.9.)

---


## 4. The core mental model — paper as project, section as phase

The single most important architectural insight: **a paper is a project, a section is a phase, the outline is the roadmap, and compile is milestone completion.** GSD's structured-workflow primitives map directly onto academic writing if you let them.

| GSD primitive | Pensmith primitive |
|---|---|
| Project | Paper |
| Roadmap | Outline |
| Phase | Section |
| Plan-phase | Plan-section (which claims, which sources, what argument structure) |
| Execute-phase | Write-section (drafts the section using only its mapped sources) |
| Verify-work | Verify-section (DOI integrity + claim support + quote check + orphan-claim audit, *bounded to that section*) |
| Complete-milestone | Compile (assemble sections, smooth transitions, run cross-section checks) |
| Ship | Done (final whole-paper verify + humanize + honesty + export) |
| `.planning/` | `.paper/` |
| `.planning/<phase>/PLAN.md` | `.paper/sections/<N>/PLAN.md` |
| Wave-based parallel phase execution | Wave-based parallel section writing |
| HANDOFF.json | HANDOFF.json (section-granular) |

**Why this matters:** every section gets its own `.paper/sections/<N>/` folder with its own plan, draft, verification report. Section state is isolated by directory structure, not by careful prompting. You can completely re-do section 3 without disturbing 1, 2, 4, 5. The verifier runs bounded against one section at a time (~20–40 LLM calls) instead of the whole paper at once (~200 calls). Inline corrections become trivial: "re-do section 3" is a literal command, not a state-machine splice.

This is the **load-bearing design choice** for the entire project. Everything else flows from it.

---

## 5. Command UX — the single-command philosophy

The single most important UX rule: **a user should only have to remember one thing: `/pensmith`.**

GSD's command set is operationally well-named but cognitively heavy — it forces the user to internalize the workflow stages. Pensmith inverts this. The tool tracks state; the user just talks to it.

### 5.1 The primary command

```
/pensmith
```

Behavior depends on state (like `git status` knowing what to suggest). Section-aware:

| Situation | What happens |
|---|---|
| No active paper in this folder + no library entry | Starts new-paper intake (from an `assignment.{txt,md,pdf}` in the folder, a piped assignment, or a paste) |
| Intake done, no research | Runs research |
| Research done, no outline | Runs outline (approval gate) |
| Outline approved, sections incomplete | Plans → writes → verifies the next incomplete section (or the next wave of independent sections in Tier 1) |
| All sections verified, not compiled | Runs compile (smooths transitions, cross-section claim consistency) |
| Compiled, not exported | Runs done (verify pass + plagiarism + humanize + honesty + export) |
| After `/compact` | Auto-resumes from HANDOFF.json (also via SessionStart hook) |

**One invocation completes one step** (D-18-28). A step is one row of the table; for a section, the step is its whole plan → write → verify: the section is planned, then — if planning succeeded — drafted, then — if drafting succeeded — verified, all in the same invocation, each stage only when the router names the same section's next stage (`write` may already have verified the draft). The step stops at the first verb that does not succeed and exits with that verb's code (e.g. 4 when the verifier blocks). Every step ends with one line naming what ran and what comes next (`pensmith: ran plan §2, write §2, verify §2; next: plan §3`, or `next: status (done)`). `pensmith next` and `pensmith resume` run exactly the same step. From a folder with only an assignment file, repeated `pensmith --yolo` reaches an exported paper in at most 5 + N invocations (intake, research, outline, one per section, compile, done). Without `--yolo` the outline and export gates ask in a terminal and exit 3 when there is none. A step that failed without leaving work to verify (a rejected outline, a section whose draft was refused) reports `status (attention)` with the command that fixes it instead of re-running — and re-billing — the failed step. Under `--dry-run` the invocation repeats steps until the paper is done (§7.19).

This is the only command anyone needs to learn.

### 5.2 Optional verb shortcuts (for explicit control)

```
/pensmith new                start a new paper
/pensmith next               do the next thing (same as bare /pensmith)
/pensmith status             where am I, what's done, what's next, per-section status
/pensmith research           re-run research (with --refresh) or first time
/pensmith outline            re-run outline; opens approval gate
/pensmith plan <N>           plan section N (or --revise an existing plan)
/pensmith write <N>          write section N
/pensmith verify <N>         verify section N (bounded scope)
/pensmith compile            assemble sections + smooth transitions
/pensmith done               final whole-paper verify + humanize + honesty + export
/pensmith resume             after /compact (mostly auto via hook anyway)
/pensmith list               list papers in your library (across folders/classes)
/pensmith open <name>        switch active paper
/pensmith sketch             thinking-partner mode for finding a thesis
/pensmith add <doi|pdf|url>  add a source manually
```

Most users only ever use the bare command. Section-targeted commands (`plan 3`, `write 3`, `verify 3`) exist for iteration and re-do, not initial run.

### 5.3 Folded actions

Several actions that the user might think of as standalone are **folded into the common commands** so the user never has to remember them:

- **`humanize`** is part of `done`. Default-on. Disable with `--raw`.
- **`verify-citations`** at the section level runs automatically after each `write <N>`. The whole-paper verify is part of `done`. User never needs to manually invoke either in the happy path.
- **Detection-aware honesty pass** runs as part of humanize.
- **Plagiarism check** runs as part of `done` (after verify, before humanize).

Standalone power-user paths (`/pensmith verify`, `/pensmith humanize`, `/pensmith score`, `/pensmith plagiarism`) exist but aren't in the README's quick start.

### 5.4 Natural-language skill triggering

Skill descriptions are written so users can talk normally:

| You say... | Routes to |
|---|---|
| "I have an essay to write on X" | `pensmith-new` |
| "research my topic" / "find sources" | `pensmith-research` |
| "outline the paper" | `pensmith-outline` |
| "write the next section" / "continue" | `pensmith-next` (which does plan→write→verify of the next incomplete section) |
| "redo section 3" / "section 3 needs work" | `pensmith-plan` then `pensmith-write` for section 3 |
| "check the citations in section 3" | `pensmith-verify` scoped to 3 |
| "make it sound less AI" | `pensmith-humanize` |
| "compile" / "put it all together" | `pensmith-compile` |
| "export to Word" | `pensmith-export` |
| "where am I?" / "what's next?" | `pensmith-status` |
| "what papers do I have?" | `pensmith-list` |

The slash command is the *fallback* for explicit control, not the primary UX.

### 5.5 Hidden namespace for scripting

The full set still exists as `/pensmith:plan-section`, `/pensmith:write-section`, etc. — they aren't taught in the README but are documented for users building automation or scheduled tasks on top of pensmith. Like `git` plumbing vs. porcelain.

### 5.6 Inline conversational corrections

Section isolation makes most corrections trivial. The user can issue these in plain English at any point:

- "Make it 1500 words instead of 2500" → updates target, re-trims existing sections proportionally
- "Add a section about counterexamples" → inserts new section folder (e.g., `sections/3.5/`), runs plan→write→verify on it, integrates in next compile
- "Drop the section about X" → archives that section folder, re-runs adjacent sections' transition paragraphs
- "Re-do section 3" → `plan 3 --revise` → `write 3` → `verify 3`. No state-machine splice required — section directories are independent.
- "Use a different source for the claim about X in section 4" → swaps source mapping in `sections/4/PLAN.md`, re-writes only the affected paragraph

The state isolation by directory structure makes this work; the workflow doesn't need a special "splice" mode for most corrections.

---

## 6. Library mode — multi-paper management

Pensmith maintains a global library of all your papers across folders, with optional grouping by class.

- `~/.pensmith/library/index.json` (or platform equivalent — see §13) maps name → folder path → status → class
- `/pensmith list` shows all papers, grouped by class, with status
- `/pensmith list --class "PHIL 101"` filters by class
- `/pensmith open <name>` sets the active-paper pointer (`active.json` in the data dir; it never changes the cwd). The pointer never hijacks a fresh folder — a paper is resolved in this order (S-21, RUN-14):
  1. `--paper <name|path>` (a name from `list`, or a folder containing `.paper/`), or `PENSMITH_PAPER_ROOT`;
  2. the current folder, when it contains `.paper/`;
  3. a new paper in the current folder for `new` and `sketch`, or for a bare `/pensmith` that finds `assignment.{txt,md,pdf}` there;
  4. the pointer. Read-only verbs (`status`, `list`, `doctor`, `--estimate`) use it and print `(active paper "<name>" at <path>)`. Mutating verbs and a bare `/pensmith`, `next` or `resume` ask in a terminal (continue the active paper, or start a new one here); without a terminal they refuse with exit 2, naming `--paper <name>` and `pensmith new`. `--yolo` never follows the pointer.
  A pointer to a folder that no longer holds a paper is cleared with a warning. The MCP server and the hooks never follow the pointer: they use `PENSMITH_PAPER_ROOT`, else their working directory.
- `/pensmith new` prompts for class assignment at intake (optional; "Unfiled" if skipped)
- Class names are free-form strings (`PHIL 101`, `ENGL-250`, `Senior Thesis`, etc.)
- Per-paper folders still hold `.paper/` state; library is just an index over them

Status values: `intake`, `research`, `outline`, `sectioning` (with section count progress like `3/7`), `compile`, `done`, `archived`.

---

## 7. Functional requirements

Each subsection below describes a workflow stage. Most are invoked transparently by `/pensmith`; the verb shown is the explicit-shortcut form.

### 7.1 Intake (`/pensmith new`)

- **The assignment** (amended by GRND-01): `--from <file>` or `@file.{pdf,md,txt}` (a PDF is reduced to its text through the pdf-text chokepoint; no PDF bytes are stored), an assignment piped on stdin (read only when no file is named, stdin is a pipe or a file and not scripted numbered answers, and given up after 2 s of silence), an `assignment.{txt,md,pdf}` in the folder (the `assignment-pickup` gate: confirmed in a terminal, used and named under `--yolo` or without a terminal; several such files need a choice), or an interactive multi-line paste in a terminal. A `--thesis` seed (from `sketch`) may stand in for it. Missing, unreadable, unsupported or empty input fails with one line; no assignment in a run that cannot prompt exits 2 (`no assignment found`) and writes nothing.
- **The questions** (amended by GRND-02), asked deterministically — via AskUserQuestion (Tier 1), in the terminal or through scripted numbered answers (Tier 2), or answered up front with flags or `--answers <file.toml>` (`pensmith new --questions` lists each question's id, options, flag and answers-file key):
  1. **PII redaction?** — opt-in, default no. Asked first: it must be settled before the assignment reaches any model. If yes, intake redacts names, IDs, emails, phones and dates before the LLM call and before INTAKE.md is written (§14, GRND-05).
  2. **Discipline preset** (see §8) — the presets of `templates/presets/disciplines.json`; names and abbreviations are accepted. Pre-fills sensible defaults for the rest.
  3. **Mode** — `draft` (full paper through compile) or `outline` (outline-only: stops after outline approval; produces sourced outline + annotated bibliography).
  4. **Goal** — `producing a draft` / `learning the topic` / `both` (see §7.13 educator mode).
  5. **Class** for library grouping (optional; defaults to "Unfiled").
  6. **Counterargument & rebuttal section?** — yes/no/auto-by-paper-type (§7.4).
  7. **Style-match to past writing?** — opt-in; a folder of writing samples (§7.18).
  8. **Length target** — the assignment's stated length ("1500-word", "6 pages" at 300 words a page), else the clarifier's suggestion, else 1500 words.
  9. **Citation style** — one of the 8 styles of §10; names match an alias table (APA 7, MLA 9, Chicago → Chicago notes-bibliography, Chicago Author-Date, …) and an unknown name is refused listing the 8.
- **The clarifier only suggests** (GRND-02): one structured model call reads the assignment and suggests a topic phrase, a discipline, the paper type, a working thesis, the stated length and style, sectioning notes and at most 3 assignment-specific follow-up questions. The suggestions are the defaults offered for the questions above; `--yolo` accepts and prints them (gate `intake-defaults`, §7.20); a run that cannot prompt, has no `--yolo` and leaves a question unanswered exits 3 naming them, before any model call or write. The follow-ups are asked (a run that cannot ask them records the suggested answer and says so). The clarifier's reply is never written as INTAKE.md.
- Discipline preset's defaults can be overridden inline, in the assignment or any answer ("use MLA instead of APA", "APA 7", "I need a literature review section before methods" in plain English): pensmith parses them deterministically (GRND-04). A style override becomes the offered default; sectioning notes go into the brief and on to the outline.
- Writes `.paper/INTAKE.md` — **the project brief** (amended by GRND-03; there is no PROJECT.md): versioned frontmatter (topic, thesis, discipline, paper type, mode, goal, class, counterargument, length target, citation style, sectioning notes, PII and style-match flags, where the assignment came from, the follow-ups and their answers), then the assignment and a questions-and-answers section. It also writes `.paper/config.toml` (`[project]` and `[style]` mirror the answers, §10), `.paper/STATE.json`, `.paper/STYLE.json` when style-match is on, and the paper's entry in the library under its class.
- Prints the disclaimer.
- Routes to `/pensmith research`.

### 7.2 Research (`/pensmith research`)

- Reads the brief (`.paper/INTAKE.md`, §7.1) + config.toml; its queries are seeded from the brief's structured topic and the assignment, never from clarifier text (GRND-03).
- **Topic disambiguation gate**: spawns a tiny disambiguation subagent that scans the assignment for ambiguous terms (e.g., "transformer" could be ML or EE). If ambiguous, asks the user before searching. Saves wasted research passes.
- Generates 5–10 focused search queries from the assignment.
- Spawns one `pensmith-source-researcher` subagent per query (Tier 1) or loops sequentially (Tier 2). Each returns 3–5 candidates.
- **If user provided BYO PDFs** (§9): also ingests, parses, and merges them into the candidate pool, tagged `bring-your-own`.
- **If Zotero MCP is detected** (§11): also pulls relevant items from the user's Zotero library, tagged `zotero`.
- `pensmith-source-evaluator` scores candidates for relevance, recency, policy compliance; dedupes; tiers (peer-reviewed / preprint / book / gov-report / other).
- **Approval gate**: shows the curated list, lets the user prune/approve/add.
- Writes `.paper/RESEARCH.md` (curated source list with abstracts + why-relevant notes) and `.paper/CITATIONS.bib` (BibTeX seed).
- Each citation gets a `last_verified` ISO timestamp (§7.12).

### 7.3 Outline (`/pensmith outline`)

This is the equivalent of GSD's `roadmap` step — it produces the section structure that the rest of the workflow iterates over.

- Produces section structure with thesis, target word count per section, and a `sections/` plan: each section gets an entry naming it, declaring its purpose and role, listing its mapped sources from the source pool, and declaring its dependencies on other sections (e.g., "Discussion depends on Results").
- The request is fed by the intake brief (topic, thesis, discipline and its sectioning convention, paper type, length target, sectioning notes) and every LIBRARY.json source, fenced as untrusted data.
- The reply is one validated contract: unique slugs, known and acyclic dependencies, every mapped source in the library, word targets within ±20% of the length target, at most two body sections without sources, and the §7.4 rule. An invalid reply gets one corrective turn; if it is still invalid, the replies are kept in `.paper/OUTLINE.rejected.md`, nothing else changes, and the router reports the problem instead of calling the model again (no silent re-billing).
- **If counterargument enabled** (§7.4): refuses to proceed unless the outline contains a counterargument + rebuttal section.
- **Approval gate** before any section gets written.
- Writes `.paper/OUTLINE.md` AND creates `.paper/sections/<N>/` folders, each pre-populated with a stub `PLAN.md` containing that section's outline entry (`stub: true`, `status: planned`); every section is registered in STATE.json. Section folders are numbered (`01-introduction/`, `02-background/`, etc.) so they sort cleanly, and a section's folder is found by its slug.
- `OUTLINE.md` is rendered by pensmith, never copied from model text: a `Thesis:` line, the table `| # | slug | title | role | depends_on | word target | assigned_sources | voice |` and a `## Sections` list with each purpose. The older six-column table is still read.
- **Re-outline** (`outline --force`; a paper with drafts also asks the `reoutline` gate): sections are matched by slug. A kept section keeps its number, folder and files byte-identical; a dropped section moves to `sections/_archive/`; an inserted section gets a lettered id after the section it follows (`1a`, folder `01a-<slug>/`) or the next free number at the end. Nothing is renumbered, so the order of kept sections cannot change. Section ids (`3`, `1a`) are accepted wherever a section number is (`plan 1a`, `paper://section/1a`).

### 7.4 Counterargument enforcement

- For papers tagged `argumentative` or `persuasive` in the discipline preset (or auto-detected from the assignment prompt), the outline approval gate refuses unless the outline contains a counterargument + rebuttal section.
- User can disable per-paper at intake or via `--no-counter` on the outline command.
- Skipped for non-argumentative paper types (lab reports, summaries, primers).
- Whether it is required resolves once (`bin/lib/counterargument.ts`): `--no-counter`, then the paper's `counterargument_required` config, then the intake answer, then the paper type, then the discipline preset. The rule is enforced on the outline reply before the approval gate (one corrective turn, then `counterargument + rebuttal section required (§7.4); use --no-counter to disable`); a section with the `counterargument` role and one with the `rebuttal` role (or one `counterargument-rebuttal` section) satisfy it.

### 7.5 Plan section (`/pensmith plan <N>` — equivalent to `/gsd:plan-phase`)

- Reads the section's stub PLAN.md from outline.
- For each claim the section will make: identifies which sources support it, what evidence is required, what counterexamples should be addressed.
- The planner is fed the intake brief, the section's OUTLINE row (title, purpose, role, dependencies, word target, voice), short summaries of the claims its dependencies already planned, and only the section's own sources. Its reply is validated — the section it names, its dependencies, and every citekey within the section's sources — with one corrective turn; a reply that is still invalid writes nothing and leaves the stub as it was.
- Optional `--revise` flag: re-plans an existing section based on new feedback (e.g., from a verification gap).
- Optional `--research <query>` flag: triggers a section-scoped research pass for additional sources if the outline allocation is insufficient.
- Writes `.paper/sections/<N>/PLAN.md` (claim-source mapping, paragraph-level structure, target word count, voice hints) with `status: planned` and no `stub` flag. A stub routes to `plan`; a planned section routes to `write`. (Before v1.0 a planned PLAN.md without `stub` routed to `plan`; only hand-made files had that shape.)

### 7.6 Write section (`/pensmith write <N>` — equivalent to `/gsd:execute-phase`)

- Reads `sections/<N>/PLAN.md`. A section still holding the outline's stub is not planned, and `write` refuses it, naming `pensmith plan <N>`.
- The write subagent's prompt receives ONLY the sources mapped to this section (source-isolation enforced by directory structure, not just prompt convention). The request is built only from a validated drafter input (the brief, the section's outline entry, its plan, its voice and its sources' records), and every draft is checked: a draft that cites a source outside the section gets one corrective turn, and if it still does, it is not kept — it is saved as `DRAFT.rejected.md`, the section is marked `failed` with the reason, and no other section is touched.
- Drafts the section.
- Writes `.paper/sections/<N>/DRAFT.md`.
- **Style-match (§7.18)** is applied per-section if enabled. A voice the outline gives the section takes precedence over the style-match profile.
- After writing, automatically chains to verify (§7.7) unless `--no-verify` is set.
- `write` with no section drafts every planned section in dependency waves (bounded by `--max-parallel`, default 5), verifying each; a malformed PLAN.md is reported by file and field while the independent sections still draft.

### 7.7 Verify section (`/pensmith verify <N>` — equivalent to `/gsd:verify-work`)

Bounded to a single section. Four passes, all scoped to this section's draft:

**Pass 1 — DOI/identifier integrity (deterministic):**
- Extract every DOI / arXiv ID / PMID from the section.
- DOI normalization (`bin/lib/doi.js` — strips prefixes, normalizes case) before lookup.
- Re-fetch each via Crossref / arXiv / PubMed.
- 404 → `FABRICATED` (hard fail; blocks compile).
- Fuzzy-match cited authors/year/title against canonical metadata; mismatch → `MIS-CITED`. *Author/title verification is part of Pass 1, not optional.*

**Pass 2 — Claim support (LLM-judged):**
- For each in-text citation in this section, find the supported sentence(s).
- Pull cited paper's abstract; if open-access via Unpaywall, also pull the relevant section.
- Spawn `pensmith-claim-verifier` per citation, in waves of 5.
- Verdict ∈ {SUPPORTED, PARTIAL, UNSUPPORTED, UNCLEAR}, with rationale + quoted evidence.
- Prompt calibrated to err toward UNCLEAR rather than false-confident SUPPORTED.

**Pass 3 — Quotation verification:**
- For every direct quote in this section, fetch OA full text and confirm presence.
- PASS / NOT_FOUND / FUZZY_MATCH.
- NOT_FOUND blocks compile.

**Pass 4 — Per-paragraph claim audit:**
- For each paragraph, list claims it makes and which sources support each.
- Flag orphan claims (asserted but uncited).

Output `.paper/sections/<N>/VERIFICATION.md` with summary table. Section is marked `verified` only when Passes 1 and 3 are clean (FABRICATED, MIS-CITED, NOT_FOUND must all be 0).

### 7.8 Compile (`/pensmith compile` — equivalent to `/gsd:complete-milestone`)

This is the equivalent of GSD's milestone completion. It assembles the verified sections into a coherent paper.

- Refuses if any section has FABRICATED, MIS-CITED, or quote-NOT_FOUND.
- Concatenates sections in outline order.
- **Cross-section smoothing pass**: reads the assembled draft and edits *only* the last paragraph of each section + first paragraph of the next, integrating transitions. Does not touch citations or claims.
- **Cross-section claim consistency check**: flags contradictions between sections (e.g., section 2 claims X, section 4 claims not-X).
- **Citation density check**: per-discipline density target (§8); flags out-of-range paragraphs.
- Writes `.paper/DRAFT.md` (the compiled paper) and `.paper/COMPILE-REPORT.md` (transitions changed, contradictions flagged, density stats).

### 7.9 Done (`/pensmith done` or `/pensmith export`)

The umbrella for finishing. Equivalent to GSD's `/gsd:ship`.

- Refuses to run if any section's verification is unclean.
- Runs **whole-paper verify pass** (Pass 4 — per-paragraph audit across the compiled draft, catches issues that emerged at section boundaries).
- Runs **plagiarism check** (§7.16).
- Runs **humanizer** (§7.10), which itself runs the **detection-aware honesty score** (§7.11).
- Confirms with user if any UNSUPPORTED, orphan claims, or plagiarism hits.
- Exports to `.docx` / `.pdf` / `.tex` / `.md` (via pandoc if present, else markdown for docx).
- **No metadata stamp. No visible footer. No trace of pensmith in the exported document.** This is a deliberate user-facing design choice. The README disclaimer (§3) is the project's only integrity-disclosure mechanism.
- Bundles the bibliography of the cited sources only (`export/CITATIONS.bib` / `.ris`, never the whole research library), formatted in the configured citation style.
- Flags: `--raw` skips humanize. `--no-verify` skips the final whole-paper verify pass (warns; refuses to combine with `--raw` without `--yolo`).

### 7.10 Humanize (folded into `done`)

- Invokes the user's installed `humanizer` skill on `.paper/DRAFT.md`.
- If `humanizer` skill not present, prints a clear note and skips with no error.
- Output `.paper/FINAL.md`.
- Calls the honesty score (§7.11) before and after; reports both numbers.

### 7.11 Detection-aware honesty (folded into humanize)

- Runs the draft through GPTZero's free endpoint (or another configured detector) and shows the actual AI-detection score:

```
Pensmith honesty check (before humanize): reads as 73% AI-generated (GPTZero).
Pensmith honesty check (after humanize):  reads as 41% AI-generated (GPTZero).
Note: this score reflects prose patterns. The humanizer improves readability;
it does not promise to make output undetectable.
```

- Default-on. Disable with `--no-score`.
- Multiple backends supported (GPTZero, Originality, Sapling); user picks via config.
- Framing is non-negotiable: "improves prose," not "evades detection."
- Score reported in `.paper/VERIFICATION.md` with timestamp.

### 7.12 Last-verified timestamps + auto-recheck

Each citation in CITATIONS.bib gets a `last_verified` ISO timestamp.

- On every `verify <N>` or `done` run, citations older than `recheck_after_days` (default: 30) are auto-rechecked.
- Retraction Watch flag triggers a hard warning, surfaced for user review.
- Configurable per-project in config.toml.

### 7.13 Educator / tutorial mode

At intake, the user picks: `producing a draft` / `learning the topic` / `both`.

In `learning` or `both` mode, every step adds an "explain" wrapping:
- Research step: "Here's why I picked these three sources: X, Y, Z."
- Outline step: "Here's the structure I'm proposing and why this organizes the argument."
- Section plan step: "I mapped Smith here because their paper makes exactly this claim."
- Section write step: brief inline notes on rhetorical choices.
- Section verify step: walks the user through each verification verdict and what it means.
- Compile step: explains transition smoothing decisions and any flagged contradictions.

In `learning` mode (no draft), pensmith generates a tutorial-style summary of the topic from the curated sources after research, then stops.

In `producing a draft` mode (default), the explain wrapping is silent unless the user asks.

### 7.14 Resume / pause / status

Same patterns as GSD:
- PreCompact hook writes HANDOFF.json (schema in `schema/handoff-v1.json`). Section-granular: includes current section number, plan/write/verify position within it.
- SessionStart auto-invokes resume.
- PostToolUse writes throttled mid-session checkpoint (≤1/min).
- `/pensmith status` shows: current paper, current section, per-section status (✓ written/verified, ⌛ in progress, ⌽ pending), running cost meter.

### 7.15 Add source manually (`/pensmith add`)

For when the researcher misses something the user knows about. Accepts a DOI / arXiv ID / URL / local PDF path; verifies it; adds to RESEARCH.md. **Surfaces a "should I remap sections to use this?" prompt** so the user doesn't end up with a stranded source not mapped to any section.

### 7.16 Sketch / thinking-partner mode (`/pensmith sketch`)

Entry point for users who haven't found their angle yet.

- "I want to write about LLM-assisted education but I don't know my angle."
- Pensmith asks 4–5 Socratic questions: "What about it interests you?" "What position have you heard that you disagree with?" "Who's the audience?" "What's the one sentence you want them to walk away believing?"
- Synthesizes a candidate thesis statement.
- User refines or accepts.
- Drops into regular `/pensmith new` intake with the thesis pre-filled.

### 7.17 Plagiarism check (free-only)

A free-only plagiarism check runs as part of `done` (after compile, before humanize):

- Extract distinctive phrases (5+ word n-grams that are unusual / low-frequency) from the compiled draft.
- Search them via free engines (e.g., DuckDuckGo) and surface any verbatim matches.
- Limited recall vs. paid services; free, no API key, demonstrably about catching real plagiarism rather than enabling evasion.
- Output added to `.paper/VERIFICATION.md`.
- Disable with `--no-plagiarism-check`.
- README is clear: this is a basic check, not a substitute for institutional plagiarism tools.

### 7.18 Style-match to past writing (opt-in at intake)

If user provides a folder of their past writing samples at intake:

- Pensmith analyzes voice, sentence-length distribution, vocabulary level, opening/closing patterns.
- Stores a style profile in `.paper/STYLE.json`.
- Section drafter (§7.6) consumes the style profile to bias its output toward the user's voice. Per-section voice hints (terse for methods, expository for intros — set in OUTLINE.md) override style-match where they conflict.
- README explicitly addresses dual-use: legitimate uses (consistency across a thesis or dissertation; matching established voice for a multi-part project) AND can be misused for detection evasion. Gated behind opt-in intake. The user takes responsibility.

### 7.19 Dry-run + cost estimator + cost cap

- `/pensmith --dry-run` runs the entire workflow without calling external APIs or LLMs: zero sockets, sources from a labelled synthetic provider, and every model call answered by a deterministic stub that satisfies the step's contract (the drafter stub writes to the word target and cites the section's assigned sources). Sources it finds are synthetic and labelled as such (reserved `10.0000/pensmith-dryrun.*` identifiers, a `synthetic` flag and an `OFFLINE MODE (reason: --dry-run)` banner that names the workspace); they are accepted by the verifier only under `--dry-run` and never reach a real paper. A real citation is reported UNVERIFIABLE (dry-run) — a dry run never fakes a verdict.
  - **Workspace** (D-18-29). A dry run works in `./.paper-dry-run/`, never in `.paper/`. When the folder holds a real paper, the workspace is seeded from `.paper/` (a copy of its paper files; `SEED.json` records the fingerprint — relative paths, sizes, sha256 — of what was copied), kept across dry runs, and re-seeded when `.paper/` changes. `SESSION.log`, `COSTS.jsonl`, `INTAKE.raw.local` and `export/` are not copied. The real `.paper/` is never created, never written, and read only to seed. The dry run holds the paper's own session lock, a dry-run paper is never registered in the library (§6), and `.paper-dry-run/` is ignored like `.paper/`. Every dry-run artifact carries a marker (`.paper-dry-run/DRY-RUN.md`, the offline marker line in RESEARCH/VERIFICATION/COMPILE-REPORT and in the INTAKE/OUTLINE/PLAN bodies, `synthetic: true` on library entries) except the section drafts, the compiled `DRAFT.md`/`FINAL.md` and the exports, which stay zero-trace and are disclosed by their name and place: `.paper-dry-run/export/DRAFT.dry-run.<ext>`, whose path `done` prints.
  - **Loop** (D-18-30). Bare `pensmith --dry-run` (and `next`/`resume --dry-run`) repeats the §5.1 step until the router reports done or attention, a step fails or a gate refuses, or a decision repeats without progress. With `--yolo` it goes from the assignment to the export in one invocation; without it, it stops at the first gate it cannot answer (no terminal: exit 3).
  - A paper a pre-v1.0 dry run made inside `.paper/` (marked `.paper/DRY-RUN.md`) is still refused by normal commands; delete it to start a real paper.
- `/pensmith --estimate` runs the workflow planner only and makes no LLM or network call. It projects the *remaining* work with the resolved runtime's per-slug models and prices (an unknown model is marked `(fallback price)`) and recorded per-slug output-token p90s from SESSION.log (shipped defaults until 5 samples exist). Completed steps are excluded; with nothing left it prints `nothing left to run ($0.00)`. Without a paper it derives the section count from the assignment (`assignment.*`, `--from` or INTAKE.md) and the length target. It prints per-step rows, the total, the model and the cap, then asks `Proceed? [y/N]` in a terminal: yes runs the next router action (or, for an explicit command such as `pensmith write 2 --estimate`, that command — whose own steps are what is projected, a completed step included), no exits 0. A non-interactive run prints and exits 0. `--yolo` never answers this prompt.
- **Hard runtime cost cap.** Per `[budget] cost_cap_usd` in config (default: $5 per session; `PENSMITH_COST_CAP_USD` overrides). A *session* is one top-level CLI invocation (a bare-router chain included) or one Claude Code session (one MCP server process). Before every model call, the session's spend plus the call's projection (input estimate plus the slug's p90 output, never more than `max_tokens`) is compared with the cap. Over the cap, a terminal user is asked once per session whether to continue; a run that cannot prompt — `--yolo` included — sends nothing and exits 5 with one line. `warn_at_usd` prints one warning with the running total. This is the only cap: there are no per-step or per-section caps. The `--yolo` pre-flight refuses only when the projected remaining cost exceeds the cap. Running cost meter shown in `/pensmith status` (`cost: $X this session / $Y total (cap $Z)`; `n/a (Claude session)` in the plugin).
- All three are critical for budget-conscious users.

### 7.20 `--yolo` flag (autonomous mode, default off)

For power users / batch processing / CI testing:

- `/pensmith done --yolo` skips outline approval gate and export confirmation gate.
- Default-off. README documents this as deliberately gated behavior.

**Approval gates (amended by RUN-28, S-16).** Every interactive decision point is one gate in `bin/lib/gates.ts` (`GATES`), and both tiers ask the same questions. `--yolo` may skip only the gates marked "skip"; it never authorizes spend, third-party data egress, a verification decision, or following the active-paper pointer. "Without a terminal" is a run that cannot prompt (stdin is not a terminal and `PENSMITH_PROMPT_MODE=numbered` answers are not scripted): the gate refuses with its exit code, or skips its step. Exit codes are the RUN-09 table (`pensmith --help`). Rows marked *(planned)* land with the named requirement, which adds the gate to `GATES` in the same change; `tests/gates-registry.test.ts` checks this table against `GATES`.

| Gate | Asks | `--yolo` | Without a terminal | Explicit "no" | Owner |
|---|---|---|---|---|---|
| `outline-approval` | Approve this outline and register its sections? | skip: approve the outline | refuse: 3 | 3 | PRD §7.20 |
| `export-confirm` | Export the paper now? | skip: export | refuse: 3 | 3 | PRD §7.20 |
| `research-scope` | Which research scope should I use? | skip: use the first proposed scope | refuse: 3 | 3 | SRC-08 |
| `research-prune` | Select the candidate sources to keep | skip: keep every candidate | refuse: 3 | 3 | SRC-09 |
| `add-remap` | Map this source to a section now? | skip: skip the remap | skip: 0 | 0 | SRC-14 |
| `revise-swap` | Apply this citation swap to the section? | skip: apply the proposed swap | refuse: 3 | 3 | PRD §7.5 |
| `cost-cap` | This call would exceed your cost cap. Continue? | never | refuse: 5 | 5 | RUN-18 |
| `estimate-proceed` | Proceed? | never | skip: 0 | 0 | RUN-20 |
| `detector-consent` | Send the full paper text to GPTZero for an AI-detection score? | never | skip: 0 | 0 | EXP-17 |
| `paper-pointer` | Continue the active paper, or start a new paper here? | never | refuse: 2 | 2 | RUN-14 |
| `sketch-confirm` | Proceed to intake with this thesis? | skip: proceed to intake | refuse: 3 | 3 | ERGO-05 |
| `assignment-pickup` | Use the assignment file in this folder? | skip: use the file | skip: 0 | 0 | GRND-01 |
| `intake-defaults` | Accept the intake defaults? | skip: accept the defaults | refuse: 3 | 3 | GRND-02 |
| `plan-research` | Run this section-scoped research? | skip: run it | refuse: 3 | 3 | GRND-17 (planned) |
| `unsupported-confirm` | Keep this UNSUPPORTED claim? | skip: keep it and flag it | refuse: 3 | 3 | VRFY-22 (planned) |
| `quote-accept` | Accept this quote match? | never | refuse: 3 | 3 | VRFY-20 (planned) |
| `reoutline` | Re-outline a paper that already has drafts? | skip: re-outline (only with --force) | refuse: 3 | 3 | GRND-09 |

Automatic revision of a failed section is not a gate `--yolo` can open: it is its own opt-in, `--auto-revise` or `[project] auto_revise = true` (REV-01). Detector consent persisted in `config.toml` (EXP-17) is the only way that gate is answered without asking.

### 7.21 Health check (`/pensmith doctor`)

Run before the user's first paper or any time something feels off:

- API connectivity check: OpenAlex, Crossref, configured LLM endpoint, optional GPTZero.
- API key presence and validity (where applicable).
- Detection of Zotero MCP, Pandoc, humanizer skill.
- Write permissions on `~/.pensmith/` (or platform equivalent).
- Disk space sanity check.
- Tiny end-to-end test against `tests/fixtures/`.
- Reports a clean PASS/WARN/FAIL summary.

### 7.22 Replayable session log

Every workflow step writes its inputs and outputs to `.paper/SESSION.log` (jsonl format). Each entry: timestamp, step name, section number (if applicable), inputs (prompt, context files), outputs (response, tool calls), token counts, cost.

- Used for debugging, reproducibility, and replay-from-checkpoint when something goes wrong.
- `--show-prompts` flag lets the user see what's about to be sent to any external service (LLM, source API, detector) before it leaves the box. Trust + debugging.

---

## 8. Discipline presets

Pensmith ships with discipline presets at intake. Each preset configures source preferences, default citation style, sectioning conventions, reading-level defaults, counterargument-default behavior, and citation-density target. All preset values are overridable per-paper.

| Preset | Default citation | Source preference | Sections | Counter | Citation density (per ¶) |
|---|---|---|---|---|---|
| Computer Science | IEEE | arXiv → Semantic Scholar → OpenAlex | Abstract / Intro / Related Work / Methods / Results / Conclusion | off | 1–3 |
| Biology / Life Sci | AMA or Vancouver | PubMed → OpenAlex → Crossref | Abstract / Intro / Methods / Results / Discussion / Conclusion | off | 2–4 |
| History | Chicago Notes-Bibliography | OpenAlex → JSTOR (if configured) → books | Thesis / Body / Counter / Conclusion | **on** | 0.5–2 |
| Literature | MLA | OpenAlex → JSTOR → books | Thesis / Body / Counter / Conclusion | **on** | 0.5–2 |
| Psychology | APA 7 | PubMed → APA PsycNET (if configured) → OpenAlex | Abstract / Intro / Method / Results / Discussion | mixed (asks at intake) | 2–4 |
| Economics | APA or Chicago Author-Date | NBER (if configured) → OpenAlex → Crossref | Abstract / Intro / Lit Review / Model / Results / Conclusion | off | 1–3 |
| Philosophy | Chicago Author-Date | OpenAlex → PhilPapers (if configured) → books | Thesis / Argument / Objections / Reply / Conclusion | **on** | 0.5–2 |
| Sociology (extra preset) | APA 7 | OpenAlex → Crossref → Semantic Scholar | Intro / Lit Review / Methods / Findings / Discussion / Conclusion | off | 1–3 |
| Other / Custom | APA 7 (default) | OpenAlex → Crossref → arXiv | (free-form) | off | 1–3 |

The table lives in `templates/presets/disciplines.json`, read and validated by one module, `bin/lib/disciplines.ts` (GRND-06): every consumer — intake's defaults, the outline's sectioning convention and counterargument default, the plan and draft tone, the export's citation style, the per-paragraph density band of the compile report — asks it, and no other module holds a discipline literal (chokepoint row `discipline-literals`). Precedence for every preset-backed value: preset < intake answer < config.toml < CLI flag. Source preferences are stored as ids — `arxiv`, `semanticscholar`, `openalex`, `pubmed`, `crossref`, `books`, `jstor`, `psycnet`, `nber`, `philpapers` — in the order shown; the ids with no adapter yet (books, JSTOR, PsycNET, NBER, PhilPapers) are skipped until their adapters land. `sociology` is shipped as an extra preset (amended: it was always in the preset file).

Override examples (parsed deterministically from the assignment and every intake answer, GRND-04):
- "Use MLA for this paper" at intake → swaps citation style; everything else stays preset.
- "I need a literature review section before methods" at intake → modifies sectioning (the note reaches the outline).
- Edit `.paper/config.toml` directly for power users.

---

## 9. Bring-your-own sources (BYO PDFs)

At intake, the user can specify a folder of PDFs they've already read:

```
/pensmith new --pdfs ~/Documents/cs101-readings/
```

Or interactively: "I have a folder of assigned readings — want me to use those?" → pasted path.

Pensmith then:
1. Parses each PDF (text + structure) using `pdf-parse` (pure JS), falling back to shell-out to `pymupdf` if installed for higher fidelity.
2. Attempts metadata extraction:
   - First pass: GROBID if installed locally OR a regex/heuristic extractor for title, authors, year, DOI.
   - Second pass: cross-reference extracted title against Crossref/OpenAlex; if found, hydrate full canonical metadata.
3. Tags each ingested source as `bring-your-own` in RESEARCH.md.
4. BYO sources participate in the section source-mapping like any other source.
5. Verification works on them: if the PDF text is locally available, claim-support and quote-verify can read it directly (no need to re-fetch).

Edge cases documented in PRIVACY.md: PDF contents stay local; only Crossref/OpenAlex hydration calls leave the box (and only the title — not the full text).

---

## 10. Per-project config (`.paper/config.toml`)

`bin/lib/config.ts` is the only reader and writer of this file (smol-toml + zod; the schema is `bin/lib/schemas/config.ts`, and `tests/config-drift.test.ts` parses the block below against it). `pensmith new` writes it with `schema_version = 1`. An older file is migrated (`bin/lib/migrations/config/`) and written back; a file with a newer `schema_version` is refused with "upgrade pensmith"; an unknown key is warned about once and ignored. Every key is optional and takes the default shown when absent. `pensmith status --config` prints every effective value with its source (default, preset, intake, config, env, flag, global).

```toml
schema_version = 1                   # MANDATORY — see §14 NFRs

[project]
# `pensmith new` writes mode, goal, class, discipline_preset, citation_style,
# length_target_words, counterargument_required (only for a yes/no answer; auto
# leaves it unset) and pii_redaction from the intake answers (§7.1, GRND-03).
title = "..."
class = "PHIL 101"
assignment_prompt = "@./assignment.pdf"
mode = "draft"                       # draft | outline
goal = "draft"                       # draft | learning | both (the §7.13 intake choices)
length_target_words = 2500
citation_style = "APA"               # APA | MLA | Chicago (Notes-Bibliography) | Chicago (Author-Date) | IEEE | AMA | Vancouver | Harvard — or a CSL key (intake writes one, e.g. chicago-notes-bib) or an alias ("APA 7", "Chicago")
discipline_preset = "psychology"
due_date = "2026-05-20"
counterargument_required = true
pii_redaction = false                # if true, intake redacts PII before any LLM call

[sources]
require_doi = true
allow_preprints = true
allow_books = true
allow_gov_reports = true
allow_news = false
allowed_databases = ["openalex", "semanticscholar", "crossref", "arxiv", "pubmed"]
byo_pdf_dir = ""                     # path to user-provided PDFs, optional
zotero_collection = ""               # optional Zotero collection name, if Zotero MCP connected
min_year = 2010
peer_reviewed_only = false

[verification]
fetch_full_text = true
flag_threshold = "low"               # low | medium | high
recheck_after_days = 30
plagiarism_check = true              # free distinctive-phrase check
citation_density_min = 1             # per ¶
citation_density_max = 3             # per ¶
# verify_quotes is NOT a key: Pass 3 quote verification is a blocking pass (§14).
# Setting it (true or false) is a config error that explains why.

[humanizer]
enabled = true
preserve_voice = "academic"          # academic | formal | casual
honesty_score = true                 # show GPTZero score
honesty_backend = "gptzero"          # gptzero | originality | sapling

[style]
match_past_writing = false           # written by intake from the style-match answer (§7.18)
samples_dir = ""

[runtime]
# Tier 2 only; ignored in the Claude Code plugin. Precedence: --runtime/--model
# flags > this table > the global runtime.json > environment detection (only
# OPENAI_API_KEY set → openai) > anthropic.
provider = "anthropic"               # anthropic | openai | ollama | vllm | openai-compatible
model = "claude-opus-5"              # generation model; judgment slugs use the provider's small model (claude-haiku-4-5 / gpt-6-luna)
effort = "medium"                    # low | medium | high | xhigh | max — generation slugs (the drafter defaults to high)
price_in_per_mtok = 0.0              # USD per million input tokens for a model the price table does not know (or a priced local server)
price_out_per_mtok = 0.0
refusal_fallbacks = "off"            # off | default — opt-in Anthropic server-side refusal fallbacks (disclosed in SESSION.log)
# endpoint and api_key_env are NOT allowed here: a paper's files cannot choose
# where prompts and keys are sent. They live only in the global runtime.json
# (pensmithDataDir()/runtime.json); api_key_env must be ANTHROPIC_API_KEY,
# OPENAI_API_KEY or match ^[A-Z][A-Z0-9_]*_API_KEY$ (never e.g. GITHUB_TOKEN).

[runtime.slugs.section-drafter]      # per-prompt-slug overrides (any slug in templates/prompts/, or a step alias: pass2, pass4, evaluator, queries)
model = "claude-opus-5"
effort = "high"
# Prompt caching needs no setting (RUN-26, D-18-05). Every prompt's fixed
# template is the system prompt, always sent as one cache_control-marked block
# (Anthropic, 5-minute TTL; the first message on chat-completions providers,
# which OpenAI caches automatically from 1024 tokens), and the per-call data
# follows it (§14). A prefix below its model's minimum is silently not cached:
# claude-opus-5 / claude-fable-5 / claude-fable-5-1 512 tokens, claude-sonnet-5 /
# claude-opus-4-8 1024, claude-haiku-4-5 4096 (so the judgment slugs on Haiku do
# not cache; a model the table does not list is reported against 4096).
# `pensmith status --config` shows per slug whether its template reaches its
# model's minimum. A cache read is billed at 0.1x input (COSTS.jsonl,
# SESSION.log cache_read_tokens); `--estimate` projects without a cache discount.

[budget]
cost_cap_usd = 5.00                  # per-session cap (one CLI invocation or one Claude session); PENSMITH_COST_CAP_USD overrides
warn_at_usd = 2.00                   # one warning when the session total passes this

[network]
contact_email_env = "PENSMITH_CONTACT_EMAIL"
http_cache_ttl_seconds = 86400       # 24h for DOI lookups
http_search_cache_ttl_seconds = 3600 # 1h for search queries
http_max_retries = 5
http_backoff_base_ms = 250           # exponential, with jitter

[logging]
session_bodies = "full"              # full | redacted — redacted keeps hashes + 200-char previews (then `resume --replay` is unavailable)
```

---

## 11. Ecosystem composition

At startup, pensmith probes for and adapts to other installed tools:

- **Zotero MCP** (if installed AND authenticated): exposes a `pull-from-zotero` source provider. Auth status check, not just presence.
- **Pandoc** (if installed): enables `.pdf` and richer `.docx` exports. Else degrades to markdown-based `.docx`, skips PDF with a clear note.
- **The user's installed humanizer skill**: pensmith auto-detects and uses it. If absent, prints a clear note and skips with no error.

Detection cached in `.paper/CAPABILITIES.json` for the run.

---

## 12. External dependencies (the source clients)

All free, no keys required for the basics. Polite User-Agent with `PENSMITH_CONTACT_EMAIL`.

| Source | Endpoint | Use |
|---|---|---|
| OpenAlex | `api.openalex.org` | Primary search backend |
| Crossref | `api.crossref.org` | DOI verification + canonical metadata for fuzzy match |
| arXiv | `export.arxiv.org/api` | STEM preprints |
| PubMed | NCBI E-utilities | Biomedical |
| Semantic Scholar | `api.semanticscholar.org` | Citation graph (optional, rate-limited) |
| Unpaywall | `api.unpaywall.org` | OA full-text PDF discovery |
| GPTZero | `api.gptzero.me` (free tier) | Honesty score (§7.11) |
| Retraction Watch | `api.crossref.org/works?filter=updates:<doi>` (the Retraction Watch data Crossref serves as `update-to` notices) | Recheck flagging (§7.12); an unanswerable lookup is "retraction status unknown", never "not retracted" |
| DuckDuckGo HTML | (no formal API) | Free distinctive-phrase plagiarism check (§7.17) |

All HTTP traffic goes through `bin/lib/http.js` which provides: response cache (TTL per source), exponential backoff with jitter, retry on transient errors, polite User-Agent, DOI normalization on the way in.

---

## 13. Repo layout

```
pensmith/
├── .claude-plugin/{plugin.json, marketplace.json}
├── .mcp.json
├── README.md  PRIVACY.md  LICENSE  CHANGELOG.md
├── package.json  pyproject.toml
├── bin/
│   ├── pensmith-cli.js          # Tier 2 CLI
│   ├── pensmith-tools.js        # state queries + verify-doi subcommand
│   └── lib/
│       ├── state.js             # .paper/STATE.json atomic read/write (write-then-rename) + the one-time pre-v1 layout move
│       ├── library.js           # ~/.pensmith/library/ (or platform path) index, class grouping
│       ├── checkpoint.js        # HANDOFF.json
│       ├── lock.js              # per-file locks (proper-lockfile)
│       ├── session-lock.js      # per-paper session lock (host, PID, session id, start time; RUN-23)
│       ├── paths.js             # cross-platform path resolution (XDG / AppData / ~)
│       ├── http.js              # cached HTTP client with backoff, polite UA, DOI normalization
│       ├── doi.js               # DOI / arXiv ID / PMID normalization
│       ├── sources.js           # OpenAlex/Crossref/arXiv/PubMed/Unpaywall clients
│       ├── pdf-ingest.js        # BYO PDF parsing + metadata extraction
│       ├── verifier.js          # DOI integrity + claim support + quote verify + per-¶ audit
│       ├── plagiarism.js        # distinctive-phrase free check
│       ├── style-match.js       # past-writing voice profile
│       ├── citations.js         # APA/MLA/Chicago/IEEE/AMA/Vancouver formatters + BibTeX
│       ├── disciplines.js       # discipline preset definitions
│       ├── ecosystem.js         # Zotero/Pandoc/humanizer detection (with auth checks)
│       ├── honesty.js           # GPTZero/Originality/Sapling backends
│       ├── runtime.js           # OpenAI-compatible client wrapper + per-step token budget
│       ├── budget.js            # cost meter + cap + abort
│       ├── pii.js               # PII redaction (intake-time)
│       ├── session-log.js       # .paper/SESSION.log writer (jsonl)
│       ├── doctor.js            # /pensmith doctor health checks
│       ├── estimator.js         # cost estimation, dry-run stub responses
│       └── migrations/          # schema migrations, one file per (from→to) version
├── mcp/server.js                # Tier 1 MCP server
├── hooks/hooks.json
├── skills/                      # one dir per command — primary `pensmith` skill plus shortcuts
├── agents/
│   ├── pensmith-intake.md
│   ├── pensmith-disambiguator.md
│   ├── pensmith-source-researcher.md
│   ├── pensmith-source-evaluator.md
│   ├── pensmith-pdf-ingestor.md
│   ├── pensmith-outliner.md
│   ├── pensmith-section-planner.md
│   ├── pensmith-section-writer.md
│   ├── pensmith-doi-verifier.md
│   ├── pensmith-claim-verifier.md
│   ├── pensmith-quote-verifier.md
│   ├── pensmith-paragraph-auditor.md
│   ├── pensmith-compiler.md
│   ├── pensmith-style-analyzer.md
│   ├── pensmith-sketch-partner.md
│   ├── pensmith-humanizer-wrapper.md
│   ├── pensmith-honesty-scorer.md
│   ├── pensmith-plagiarism-scanner.md
│   └── pensmith-citations-formatter.md
├── workflows/<one .md per skill>
├── templates/{PROJECT, RESEARCH, OUTLINE, section-PLAN, section-DRAFT,
│             section-VERIFICATION, COMPILE-REPORT, FINAL, STYLE, disclaimer}.md
│            + citation-style templates + discipline preset YAML
├── references/{source-policies, citation-styles, claim-extraction,
│              academic-integrity, runtime-contract, command-ux,
│              ecosystem-composition, section-as-phase}.md
├── schema/
│   ├── handoff-v1.json
│   ├── state-v1.json
│   ├── config-v1.json
│   └── section-state-v1.json
└── tests/
    ├── fixtures/{assignment-prompts/, pdfs/, known-good-citations.json,
    │             known-bad-citations.json, known-bad-quotes.json,
    │             style-samples/, http-cassettes/}
    ├── verifier.test.js
    ├── pdf-ingest.test.js
    ├── plagiarism.test.js
    ├── style-match.test.js
    ├── library.test.js
    ├── doi-normalization.test.js
    ├── http-cache.test.js
    ├── lock.test.js
    ├── budget.test.js
    ├── paths.test.js
    ├── migrations.test.js
    ├── tier-contract.test.js   # runs every workflow body in BOTH Tier 1 + Tier 2 modes
    └── sources.test.js          # cassette-based; gated on PENSMITH_NETWORK_TESTS for live
```

The `.paper/` directory layout per project. The project folder that contains `.paper/` is the paper root everywhere — the CLI, the MCP server (`PENSMITH_PAPER_ROOT`) and the hooks. All paper state, `STATE.json` and `config.toml` included, lives under `.paper/`; a pre-v1 paper with a root-level `STATE.json`/`config.toml` is moved into `.paper/` on first use, once, under the file lock (RUN-13):

```
.paper/
├── INTAKE.md                # the project brief (§7.1; amended by GRND-03 — there is no PROJECT.md)
├── INTAKE.raw.local         # only with PII redaction: the raw intake text (gitignored)
├── config.toml
├── RESEARCH.md
├── CITATIONS.bib
├── OUTLINE.md
├── STATE.json               # paper state (the only STATE file; RUN-13)
├── HANDOFF.json
├── CAPABILITIES.json
├── SESSION.log              # jsonl, append-only
├── DRAFT.md                 # written by compile
├── FINAL.md                 # written by humanize
├── COMPILE-REPORT.md
├── VERIFICATION.md          # whole-paper verify report from `done`
└── sections/
    ├── 01-introduction/
    │   ├── PLAN.md
    │   ├── DRAFT.md
    │   └── VERIFICATION.md
    ├── 02-background/
    │   ├── PLAN.md
    │   ├── DRAFT.md
    │   └── VERIFICATION.md
    └── 03-methods/
        └── ...
```

---

## 14. Non-functional requirements (must-haves baked into v0.1.0)

These are the operational guarantees. Each maps to a specific common pitfall.

- **Section-as-phase is the load-bearing model.** All state is section-scoped via `.paper/sections/<N>/`. Verifier runs bounded per-section. Re-doing one section never disturbs another.
- **One thing to remember.** `/pensmith` is the only command in the README quick-start. Everything else is fallback.
- **Two-tier source-of-truth.** Workflow bodies and templates are read by both Claude Code plugin (Tier 1) and portable CLI (Tier 2). Never duplicate logic in SKILL.md when it belongs in the workflow body.
- **Two-tier contract testing.** `tests/tier-contract.test.js` runs every workflow body in both modes against the same fixtures; outputs must be equivalent (modulo prose). This catches drift between the tiers.
- **Graceful degradation.** Workflow `<capability_check>` blocks detect `Task` / MCP / AskUserQuestion / Pandoc / Zotero MCP / external humanizer and choose appropriate paths.
- **Determinism where it counts.** DOI integrity, DOI normalization, distinctive-phrase plagiarism, quote-verify, per-paragraph claim extraction are pure-Bash/Node, not LLM-judged. Model requests are deterministic too (RUN-26, FEED-05; D-18-03/04): every `templates/prompts/<slug>.md` is fixed instruction text (it interpolates nothing; its `inputs:` frontmatter and `## Inputs` section name the data blocks it receives) and is sent as the system prompt, byte-identical for every call of the slug, so it is a reusable cache prefix; the per-call data follows once, last, in one user message of tagged blocks (`<tag>` … `</tag>`, JSON built field by field in a fixed order), rendered only by `bin/lib/prompt-request.ts`. Data from outside pensmith and the user — source records and abstracts, drafts under review, PDF text, the pasted assignment — is wrapped in the one untrusted-data fence (`bin/lib/untrusted-fence.ts`) after every fence marker and closing block tag in it is neutralised, and every such template says that fenced content is data, never instructions. Under `PENSMITH_NO_LLM` every call gets a contract-valid stub built from those same blocks (`bin/lib/llm-stubs.ts`, `bin/lib/llm-text-stubs.ts`).
- **DOI / arXiv ID / PMID normalization.** All identifier reads and writes go through `bin/lib/doi.js`. `10.1145/foo`, `https://doi.org/10.1145/foo`, `doi:10.1145/foo` all normalize to the same canonical form.
- **Author/title verification is part of Pass 1.** DOI existence is necessary but not sufficient; cited authors/year/title must fuzzy-match the canonical metadata or the citation is `MIS-CITED`.
- **Atomic state writes.** Every state file uses write-then-rename (`.paper/STATE.json.<nonce>.tmp` → fsync → rename → `.paper/STATE.json`, through `bin/lib/atomic-write.ts`). State transitions are single rename operations.
- **Concurrent-run lock.** `bin/lib/session-lock.ts` takes a per-paper session lock (owner record: host, PID, session id, start time) for every mutating verb and every mutating MCP tool call; a second session refuses with the holder's PID and `run pensmith resume once it ends`. Stale locks (dead PID on this host, or older than the longest-step timeout, 6 h) auto-clear with a notice (RUN-23).
- **Schema versioning from day one.** Every persisted file carries a version: JSON state (`STATE.json`, `LIBRARY.json`, `runtime.json`, …) a `$schemaVersion` envelope, and `config.toml` plus the markdown frontmatter of section `PLAN.md` (and, when they gain frontmatter, `INTAKE.md`, `DRAFT.md`, `VERIFICATION.md`) a `schema_version` key. Those three are plain markdown (version 0) until then: `INTAKE.md` gains versioned frontmatter with GRND-03, and `DRAFT.md` / `VERIFICATION.md` with the first requirement that adds a field to them; the loader already registers their kinds, and a `schema_version` hand-written into one of them before that is refused as newer than the build supports. Reads go through a migration loader — `loadAndMigrate` for JSON, `loadFrontmatterDoc(kind, file, {writeBack})` for frontmatter — with migrations in `bin/lib/migrations/<kind>/vN_to_vN+1.ts`. A file newer than the build is refused with an "upgrade pensmith" message, never downgraded. A requirement that adds a field ships its migration and version bump in the same change (S-20, CONF-04).
- **Cross-platform paths.** `bin/lib/paths.js` resolves the data directory: `%APPDATA%\Pensmith\` on Windows, `~/Library/Application Support/Pensmith/` on macOS, `$XDG_DATA_HOME/pensmith` (default `~/.local/share/pensmith`) on Linux.
- **Hard cost cap.** `cost_cap_usd` (default $5/session) aborts any step that would exceed it. Cost meter visible in `/pensmith status`.
- **HTTP caching + backoff.** All source-API calls go through `bin/lib/http.js`: response cache (TTL per source — 24h for DOI, 1h for search), exponential backoff with jitter, retry on transient errors, polite User-Agent.
- **Cassette-based source tests.** Cassettes are a test and dry-run mechanism only; normal runs are live. `tests/fixtures/cassettes/` holds real API responses recorded by `npm run cassettes:refresh` (synthetic fixtures for negative tests live under `synthetic/`), and tests replay them. A user's run re-fetches every source, DOI and detector live by default, because the core value is "verified by re-fetching the live DOI". Recorded fixtures are replayed only under the test runner or `PENSMITH_OFFLINE=1`, by exact match, failing closed: a miss is "unavailable (offline)", which blocks compile and export, and never another paper's record. `--dry-run` uses a labelled synthetic source provider instead of cassettes. Offline and dry-run runs are always disclosed, and the disclosure never reaches an exported document. Under the test runner, live-network tests run only with `PENSMITH_NETWORK_TESTS=1`. (Amended in Phase 17, RUN-01.)
- **Replayable session log.** Every workflow step appends an entry to `.paper/SESSION.log` (jsonl): inputs, outputs, token counts, cost. Used for debugging and regression-fixture extraction.
- **Show-prompts flag.** `--show-prompts` displays exactly what's about to be sent to any external service (LLM, source API, detector) before it leaves the box.
- **PII redaction option at intake.** `pii_redaction = true` strips names/dates/identifiers from the assignment before any LLM call. Disabled by default (most academic assignments don't contain PII); opt-in for sensitive cases.
- **No paywall bypass.** Full-text via Unpaywall (legitimate OA only) and arXiv/PubMed Central. Paywalled → fall back to abstract-only with note.
- **All citation IDs are real.** Anywhere the system writes a DOI/arXiv ID/PMID into a file, the verifier MUST be able to re-fetch it.
- **Verifier blocks compile and export.** No FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes a section, let alone reaches a final document.
- **No telemetry.** Documented in PRIVACY.md.
- **No exported-document trace.** Per §7.9: no metadata stamp, no visible footer, no trace of pensmith in the exported file.
- **Honest framing.** §7.11 honesty score shows real numbers; nothing in pensmith claims to evade detection.
- **Approval gates are non-negotiable by default.** Outline approval and export confirmation only skip with `--yolo`.
- **Tests cover the verifier.** `tests/fixtures/known-bad-citations.json` has 10+ plausibly-formatted but fabricated DOIs; verifier must flag all 10 as FABRICATED. Same for known-bad-quotes (NOT_FOUND in cited source). Network-required tests gated.
- **Documentation generated from skill files.** README's command reference auto-generates from skill descriptions on every release; stays in sync.
- **`/pensmith doctor` ships in v0.1.0** so users can self-diagnose before reporting issues.

---

## 15. Success criteria (v0.1.0 done)

End-to-end smoke test in a fresh directory:

```bash
mkdir /tmp/test-paper && cd /tmp/test-paper
echo "Write a 1500-word literature review on attention mechanisms in transformers, APA style." > assignment.txt

# Tier 1 (in a Claude Code session in /tmp/test-paper):
/pensmith doctor                          # health check passes
/pensmith                                 # starts intake automatically
# answer questions, approve research, approve outline
# /pensmith plans, writes, and verifies each section automatically
# you can interject "redo section 3" at any point and it works
/pensmith done --format docx              # compile + final verify + plagiarism + humanize + honesty + export
```

Pass conditions:
1. A `.docx` exists in the directory.
2. Each `.paper/sections/<N>/VERIFICATION.md` shows zero FABRICATED, zero MIS-CITED, zero quote NOT_FOUND. UNSUPPORTED claims (if any) carry evidence and a user confirmation.
3. `.paper/COMPILE-REPORT.md` shows transitions changed, contradictions flagged (target: 0), citation density per section in range.
4. The exported `.docx` has zero pensmith metadata, zero visible footer, zero trace.
5. Honesty score appears before AND after humanize in `.paper/VERIFICATION.md`; framed as "improves prose, not evades detection."
6. `/pensmith list` (run from any directory) shows the test paper with class and status.
7. The same workflow runs through Tier 2 against an Ollama model (`pensmith` CLI with `--runtime ollama`) with same correctness guarantees, lower prose quality acceptable.
8. `/pensmith --dry-run` from a fresh project completes without making any external calls.
9. `/pensmith --estimate` reports a projected cost before any LLM calls happen.
10. `tests/tier-contract.test.js` is green: every workflow body produces equivalent outputs in Tier 1 and Tier 2 against fixtures.
11. Re-doing a single section (`/pensmith plan 3 --revise && /pensmith write 3 && /pensmith verify 3`) never modifies any other section's files.
12. Killing the process mid-section and resuming completes the section correctly from the last checkpoint.

---

## 16. Out of scope for v0.1.0

- Inline LaTeX equation rendering (export to .tex; user runs LaTeX).
- Paywalled full-text parsing.
- Automatic Turnitin / GPTZero submission for certification (we score with GPTZero for honesty display only; we don't submit work to certification services).
- Cross-paper "literature comparison" mode.
- Multi-author / collaboration features.
- Cloud-hosted state (everything is local-only).
- Paid plagiarism services.
- Voice/speech UI.
- Per-section research (research is whole-paper; sections can request *additional* sources via `plan <N> --research <query>` but the primary research pass is upfront).

---

## 17. Open questions for GSD's discuss-phase to resolve

Deliberately left for GSD's per-phase discussion:

- Exact prompt wording for `pensmith-claim-verifier`, `pensmith-quote-verifier`, `pensmith-paragraph-auditor`, `pensmith-section-writer`, `pensmith-compiler` (drives recall/precision/quality tradeoffs).
- Section-dependency declaration syntax in OUTLINE.md (e.g., simple `depends_on: [1, 2]` per section vs. richer dependency graph).
- Wave scheduling algorithm for parallel section writing in Tier 1 (topological sort by `depends_on`; user-overridable wave assignment).
- MCP server: `@modelcontextprotocol/sdk` vs. hand-rolled JSON-RPC like gsd-plugin's `mcp/server.cjs`.
- Tier 2 implementation language: Node-only vs. also Python.
- Citation-style template format: Pandoc CSL files vs. hand-rolled formatters.
- PDF parsing library: `pdf-parse` (pure JS) vs. shell-out to `pymupdf`.
- Style-match implementation: featurize via LLM pass vs. embed and use vector similarity.
- Library index storage: JSON vs. SQLite vs. per-paper sidecar files aggregated at read time.
- Compile-time cross-section claim consistency: how aggressive to be on flagging contradictions; default heuristics.
- Section renumbering when inserting/dropping sections mid-project (e.g., after "add a section about X"): keep numbers stable or renumber? (Recommendation: stable. Use folder names like `03-methods/` and add `03b-validity-threats/` rather than renumbering.)

---

## 18. Architectural inspiration credit (must appear in README)

> `pensmith` is heavily inspired by [Get Shit Done](https://github.com/gsd-build/get-shit-done) by TÂCHES (Lex Christopherson) and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging by Jasper Nuyens. The skill / agent / MCP / workflow-body / HANDOFF.json patterns are theirs, and the section-as-phase mental model is a direct application of GSD's structured-workflow philosophy to academic writing. Domain (academic writing instead of code), command UX (single-command vs. per-stage), and implementation are independent.

---

## 19. How to use this PRD

```bash
# In a fresh empty directory:
claude --dangerously-skip-permissions
# Inside Claude Code:
/gsd:new-project --auto @PRD.md
```

GSD will: read this document → run automatic intake → produce REQUIREMENTS.md and ROADMAP.md → break it into 7–10 phases → ask you to approve. Then `/gsd:plan-phase 1`, `/gsd:execute-phase 1`, `/gsd:verify-work 1`, repeat.

Things to remind GSD of explicitly when it asks:

1. **Section-as-phase is the load-bearing model.** §4 spells this out. Every architectural choice — state layout, verifier scope, resume granularity, parallelization, inline corrections — flows from it. If a phase plan loses this, push back hard.
2. **Study the reference repos before writing code.** Tell GSD to clone `gsd-build/get-shit-done` and `jnuyens/gsd-plugin` to `/tmp/refs/` and read their skill, agent, MCP, hooks, and workflow patterns first. Adapt, don't copy.
3. **The two-tier requirement is non-negotiable.** Both Claude Code plugin and portable CLI must work. Workflow bodies must include `<capability_check>` blocks. The `tier-contract.test.js` gates this.
4. **The single-command UX is non-negotiable.** §5 is the contract. The README's quick start teaches `/pensmith` and only `/pensmith`.
5. **The verifier acceptance test gates v0.1.0.** Don't ship if `tests/fixtures/known-bad-citations.json` doesn't 10/10 flag as FABRICATED, or if `tests/fixtures/known-bad-quotes.json` doesn't 10/10 flag as NOT_FOUND.
6. **The pitfall-mitigation NFRs in §14 are not optional.** Cost cap, HTTP cache, atomic writes, concurrent-run lock, DOI normalization, schema versioning, cross-platform paths, replayable session log, two-tier contract tests — these are foundation, not polish. They get their own phase early in the roadmap.
7. **Inline corrections (§5.6) get their own phase**, but are mostly enabled by the section-isolation directory structure. Implementation should be small if §4 is honored.
