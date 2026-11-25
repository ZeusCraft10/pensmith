# Pensmith — full audit, "built today" comparison, and change plan

*Audit of `ZeusCraft10/pensmith` @ `211b93c` · 2026-11-24 · nothing in the repo has been changed yet; this plan is awaiting your confirmation.*

## TL;DR

- **What it is.** A Claude Code plugin (Tier 1) plus a portable Node CLI (Tier 2) that walks a student or researcher from an assignment prompt to an exported paper: intake → research → outline → for each section {plan → write → verify} → compile → done/export. A deterministic citation verifier is meant to stop any fabricated, mis-cited, or misquoted citation from reaching the export. About 25.6k lines of TypeScript source, 27k lines of tests, and around 100k lines of GSD planning docs.
- **Is it how it would be built today with Opus 5.5? No, but it is closer than the bug count suggests.** Three architects designed pensmith from scratch for today's Claude Code and API without seeing your code. All three landed on your core skeleton: section-as-phase folders, a deterministic blocking verifier with advisory LLM passes, single chokepoints for HTTP, DOI handling and writes, and a pure router. Where they differ is the integration layer. That is the layer that is broken here.
- **The product does not work today.**
  - The plugin cannot be installed. Claude Code's own `claude plugin validate` rejects it.
  - In its default configuration, research and "live" verification run on committed test fixtures. A real Nature DOI comes back MIS-CITED, and a fabricated DOI can pass.
  - The CLI's LLM path cannot call any current Claude model.
  - The Tier-1 promise of "no API key, generates in your Claude session" is not implemented. The plugin runs the CLI, which calls the API with your key.
  - Nobody gets past the outline step, because the outline prompt asks for YAML and the parser only reads a table.
- **Recommendation: a hybrid rebuild.** Keep or adapt about 63% of the source (12% keep as is, 51% adapt). Replace the 28% that implements the wrong contracts: Tier-1 generation, LLM I/O, transport, the hooks, skills and MCP formats, gate binding, and the bibliography store. Drop about 7%. Fixing finding by finding would recreate the drift, and a full rewrite would discard roughly 16k lines that every fresh design would rebuild almost identically.
- **Numbers.**
  - All 792 tracked files were read and audited.
  - 303 findings went through adversarial verification. 300 were confirmed, 1 was refuted, and 2 could not be verified. An independent re-check of a random sample found 10 of 10 still real.
  - They de-duplicate to **121 distinct issues**: 14 critical, 21 high, 59 medium, 25 low and 2 nit. **58 of them block a credible public release.**
  - Of the 37 findings in your previous audit, 28 are fixed correctly and 6 only partially.

## 1. Your approach vs. a from-scratch 2026 build

Scores are 1–10 and come from the judge pass, which compared your current code against the three independent fresh designs.

| Dimension | Current | Claude-native | Shared-core | Minimum-viable |
|---|---|---|---|---|
| Installability / publishability | **1** | 8 | 8 | 9 |
| Tier-1 UX (single command, no API key) | **2** | 7 | 8 | 8 |
| Citation integrity in practice | **2** | 9 | 9 | 9 |
| Claim-support grounding | **1** | 9 | 9 | 9 |
| Pipeline correctness | **2** | 8 | 8 | 9 |
| Tier-2 portability | **3** | 7 | 9 | 7 |
| Security / privacy | **4** | 8 | 8 | 8 |
| Maintainability / complexity | **3** | 5 | 6 | 8 |
| Test value | **3** | 8 | 8 | 9 |
| Time to credible release | **5** | 3 | 3 | 6 |

**Where your approach is genuinely better (keep it):**
- It exists. About 23k LOC already handles edge cases carefully: DOI/arXiv/PMID normalization with fast-check property tests, write-then-rename atomic writes, proper-lockfile locks, and cross-platform data dirs including sync-folder detection. None of the fresh designs has written a line.
- It covers far more of the PRD: 16 verbs, a global library with derived status and GC, a learning-mode scaffold, sketch, opt-in PII with a raw-text .gitignore, a deterministic style-match profile with the dual-use disclosure, a GPTZero consent gate, revise-swap, a Kahn wave scheduler, 8 CSL styles and discipline presets. The minimum-viable design defers most of this.
- Lint-enforced chokepoints for HTTP, DOI, atomic writes and paths are an architectural discipline the fresh designs only propose.
- The section-as-phase layout is already implemented the way every fresh design prescribes: per-section PLAN.md status plus the D-07 verified_against_draft_hash staleness check.
- The verifier's split between deterministic and advisory passes is the right design: Pass 1 and 3 block, Pass 2 and 4 advise, and code enforces it. For well-formed [@key] input, compile REFUSED and the export gate both work (prd-conformance reproduced this).
- Zero-trace export mostly works: core.xml and app.xml are blanked, PDFs are scrubbed, and no 'pensmith' strings were found in docx/pdf/md/tex exports. Only custom.xml and the RIS leak.
- The honest framing is locked: references/honesty-framing.md has a byte pin and nothing claims detector evasion.
- It is faithful to the owner's deliberate choices (DuckDuckGo plagiarism, style-match shipped, wrapping the user's humanizer, --yolo off by default), where the fresh designs push back on several.
- The router is a pure function that never throws, with a corruption backstop. It converts directly into a table-driven derive().
- The team fixes what it is shown: 28 of 37 prior audit findings were fixed correctly, and reusable adversarial corpora exist (known-bad citations and quotes, pass2-adversarial.json).

**Where the "built today" designs are better (adopt it):**
- **Tier 1 generates in the user's own Claude session.** Restricted subagents write into a staging area, and the engine validates their output. The CLI never calls an LLM from inside Claude Code. This is what your PRD §1 and §13 originally specified: subagents, AskUserQuestion, and the Task tool. The build drifted to "MCP runs the CLI, which calls the API".
- **The step graph lives in code.** `pensmith next --json` emits typed actions that both tiers consume. That makes "two tiers, one source of truth" testable as action-trace equality. Today neither tier reads `workflows/*.md` at runtime.
- **State is derived from content hashes**, not from whether files exist. Export re-runs the deterministic checks on the exact bytes being shipped.
- **Claim support is a mechanism, not advice.** Drafts are grounded in retrieved source text. Every citation carries a verbatim span that code checks. The judge runs in a fresh context, and code can only downgrade its verdict. Models never write bibliographic facts.
- **Resolution works across registries:** Crossref, DataCite (arXiv), doi.org, PubMed and ISBN. A network failure becomes UNRESOLVED, never FABRICATED. Retraction status is read from data that is already being fetched.
- **Distribution needs no build step on install.** A committed esbuild bundle plus a `bin/pensmith` shim on the plugin PATH, spec-format hooks and skills, and `claude plugin validate --strict` in CI. For v0.x, two of the three designs (and the judge) drop the MCP server.
- **The Tier-2 LLM layer uses the official Anthropic SDK** with the fetch call routed through your HTTP chokepoint. It adds structured outputs for outline and plan JSON, streaming, refusal and `max_tokens` handling, prompt caching of the source bundle, current models (`claude-opus-5-5` / `claude-sonnet-5-5`), and optionally the Citations API.

**Is it "the same thing that's there"?** The skeleton is the same. The product is not: the seams the fresh designs get right are exactly the ones that are broken here, and 1,044 green tests missed every one of them. The tests mostly pin structure, hashes and pre-seeded state rather than the user journey.

## 2. Release-blocking root causes

### Critical (14)
| Workstream | Issue | Seen by | Fix |
|---|---|---|---|
| export-zerotrace-honesty | **DOCX export leaks absolute local paths (home dir, paper folder, plugin cache) in docProps/custom.xml** — buildPandocArgs passes absolute --csl and --bibliography paths, which pandoc copies into docProps/custom.xml; zeroTracePatch blanks core.xml/app.xml but never custom.xml, and its 'pensmith' substring sweep only mangles the paths, so every citation-rendering DOCX ships the user's home path, paper folder and plugin cache path. | 2× | Delete docProps/custom.xml and its [Content_Types]/rels entries (or rebuild core/app from an allowlist template); pass citeproc inputs so no custom metadata is emitted; add a CI trace scanner (absolute paths, .paper, .claude, pensmith, $HOME) over real pandoc exports. |
| network-mode-sources | **Offline cassette replay is the production default: research, verification, add, GPTZero and plagiarism run on test fixtures** — isOfflineMode() is true unless the test var PENSMITH_NETWORK_TESTS=1, so all users get committed cassettes: research returns fixture papers for any topic, fetchById maps unknown DOIs to the first cassette record (fake DOIs verify, real ones MIS-CITED), add stores fixtures, URL add is refused, GPTZero shows a canned 82%, plagiarism fake hits. | 16× | Make live network the default; replay cassettes only under a test-runner flag or injected transport; implement --dry-run/--offline as an egress block in http.ts that yields null/'skipped (offline)', never fixture data; delete every first-record fallback; make add require result DOI == requested DOI; gate add-URL on the explicit offline flag. |
| packaging-distribution | **Plugin cannot be installed or loaded: invalid skills field, legacy hooks.json, flat skills, missing dist/** — `claude plugin install` aborts on plugin.json `skills:[{name,file}]`; with that removed the legacy {schemaVersion,hooks:[...]} hooks.json stops every component loading; flat colon-named skills/*.md are not discovered; MCP points at gitignored dist/ and CONNECTION_CLOSEDs. A marketplace install yields nothing usable. | 1× | Drop `skills` from plugin.json; move each skill to skills/<kebab-name>/SKILL.md; rewrite hooks.json in the {"hooks":{Event:[{matcher,hooks:[{type:'command',...}]}]}} form; commit bundled JS (esbuild) for MCP server, hooks and CLI so no build is needed on install; gate CI on `claude plugin validate . --strict`. |
| packaging-distribution | **CLI and MCP entry guards fail through symlinks: npm-installed `pensmith` silently does nothing and exits 0** — `import.meta.url === pathToFileURL(argv[1]).href` compares Node's realpath'd module URL with the symlink path npm creates for bins (npm link, -g, npx, node_modules/.bin), so dispatch() never runs: every command prints nothing and exits 0. mcp/server.ts uses the same guard and also exits silently under symlinked plugin paths. | 2× | Compare realpaths (realpathSync(argv[1]) vs fileURLToPath(import.meta.url)) or split each entry into a side-effect-free module plus a thin bin that always calls main(); add a CI test that runs the CLI and MCP server through a symlink. |
| pipeline-state-router | **Intake never captures the assignment or answers: INTAKE.md holds the clarifier's unanswered questions** — intake sends the assignment to the clarifier, whose contract is '3-5 numbered questions', and writes result.text as INTAKE.md; nothing asks them or records answers, the assignment is not persisted and the bare path never reads one. research/outline/done parse INTAKE.md, so they search on '1. Which discipline best fits...' with discipline 'other'. | 5× | Make intake two-step: persist the raw assignment; get questions as structured JSON and ask them (AskUserQuestion in Tier 1, ask() in Tier 2, or flags/answers file); write structured fields {topic, discipline, style, length, audience}; auto-detect or prompt for the assignment on the bare path. |
| pipeline-state-router | **Router decides compile/done by file existence: after a section redo it exports the stale compiled draft or reports done forever** — Once all sections are verified, the router returns compile only if .paper/DRAFT.md is missing and done only if FINAL.md is missing. After a section redo, /pensmith exports the old compiled text (including citations the revision removed) or, once FINAL.md exists (never refreshed), reports 'done' forever, breaking PRD §15. | 4× | Have compile record per-section verified hashes (manifest); route to compile whenever any differs; have compile invalidate FINAL.md; have done record the exported DRAFT hash and re-export when it changes. |
| pipeline-state-router | **--dry-run is not dry: it overwrites real drafts, plans, intake and outline with placeholders and changes status** — --dry-run only sets PENSMITH_NO_LLM=1 and runs the verb, so write/plan/intake/research persist '[PENSMITH_NO_LLM placeholder]' over real DRAFT.md/PLAN.md/INTAKE/OUTLINE, move verified to written, register papers globally and write a real compiled DRAFT.md. README promises 'change nothing'; paid or hand-edited sections are lost. | 3× | Make --dry-run a true no-write mode: resolve the decision, print the planned verb, files, prompts and estimated calls, then exit before dispatch (or write only into a scratch overlay); make atomicWriteFile refuse under dry-run. |
| tier1-claude-native | **Tier 1 has no executable path: skills route to a `pensmith` binary not on PATH, MCP covers only plan/write/verify** — Skills tell Claude to run `pensmith status/next/resume` and call resolveNextAction, but a plugin install has no executable on PATH (bin/ holds a 0644 .ts importing a gitignored file), MCP exposes only plan/write/verify, and nothing loads workflows/*.md. Tier-1 generation also needs an API key, contrary to README. | 3× | Ship a committed, bundled executable bin/pensmith (chmod +x) and/or MCP tools for every verb plus `next --json`; make skills/<name>/SKILL.md + references/*.md the model-facing layer; do Tier-1 generation in the Claude session (skills/subagents) or document the key requirement honestly. |
| tier2-llm-layer | **Outline prompt demands YAML but the parser only accepts a markdown table: zero sections register and the outline regenerates forever** — outline-author mandates a YAML list; outline.ts saves the raw text as OUTLINE.md and parseOutline accepts only the exact GFM table, so every prompt-compliant outline registers 0 sections (exit 0) and bare /pensmith regenerates and re-bills it forever; the prompt also omits assigned_sources and uses NN- slugs. | 4× | Request structured JSON (output_config.format from a zod OutlineSchema with bare slugs, deps, word targets, assigned_sources); validate unique n and acyclic deps before the approval gate; render the OUTLINE.md table in code; test that the prompt's own example parses. |
| verifier-integrity | **Retraction detection is dead in production: the Crossref Labs endpoint returns an error envelope, so retracted papers verify OK** — api.labs.crossref.org/data/retractions?filter=record:<doi> answers HTTP 200 with a 403/400 error envelope; fetchById reads only body.items and returns null for every DOI, which callers treat as 'not retracted': research cross-check, verify GATE-03 and freshness never fire (retracted Wakefield 1998 verifies OK). Its cassettes were hand-written. | 5× | Derive retraction from Crossref works `updated-by`/`relation` (retraction/withdrawal/removal block; expression_of_concern warn) and OpenAlex is_retracted in records already fetched; treat 'RETRACTED:' titles as hits; fail closed on lookup errors; re-record cassettes from live APIs. |
| verifier-integrity | **Pass 3 never checks quotes cited with page locators, uppercase keys, multi-cite, narrative or in-block citations** — extractQuotes only matches a >=60-char "..." immediately followed by a bare lowercase [@key] (block quotes: within 4 lines after). The APA/Chicago-required `"..." [@key, p. 12]`, [@Key], [@a; @b], citation-first/narrative, single quotes, in-block cites and short quotes are skipped, so fabricated quotes pass verify, compile and done. | 6× | Extract quotes from the Pandoc AST (Quoted/BlockQuote plus nearest Cite incl. locator) or the shared citation grammar; attribute to every key in the cluster; check short quotes exactly; fail closed on quoted spans with unattributable citations; add locator/uppercase/multi-cite cases to known-bad-quotes. |
| verifier-integrity | **Pass 3 cannot read any open-access PDF: UTF-8-decoded bytes crash pdf.js, and Unpaywall without email returns 422** — runPass3 builds the PDF from Buffer.from(String(resp.body)) (lossy UTF-8; audit #29 was fixed only in add.ts) and cached entries are text-only, so pdf.js extracts nothing or throws an unhandled rejection that crashes the process; without PENSMITH_CONTACT_EMAIL Unpaywall answers 422. Pass 3 can never return NOT_FOUND in a real run. | 2× | Use resp.bodyBytes with noCache (or a binary-safe cache), check Content-Type is PDF, isolate parsing in a worker that converts pdf.js async errors; require the contact email for Unpaywall with a distinct reason (doctor FAIL); add a live-recorded PDF regression test. |
| verifier-integrity | **verify's empty-bib shortcut uses the narrow regex: locator/multi-cite fabricated citations become 'unverifiable'** — With an empty CITATIONS.bib, verify looks for citations with a bare-[@key] regex, so a draft citing only [@ghost, p. 4] or [@A; @b] becomes 'unverifiable - nothing to verify', which compile and done accept (export reproduced once the hash is set); a bare key makes parseBib('') throw instead of FABRICATED. Status/hash are never saved. | 3× | Treat an empty bib as an empty map and always run Pass 1 (every cited key FABRICATED); use the broad extractor for any guard; make productionReVerify tolerate empty bibs; persist status and hash on every verify exit path. |
| verifier-integrity | **revise 'remove' launders a fabricated (NOT_FOUND) quotation into an unattributed quote that re-verifies clean** — For any failing row, including Pass-3 NOT_FOUND, `remove` deletes only the [@key] token; the quotation stays in quote marks, often with a narrative attribution. extractQuotes ignores quotes with no adjacent key, so the next verify finds nothing and passes. Offline mode always proposes remove and --yolo auto-accepts. | 1× | For NOT_FOUND rows, remove or unquote the quotation itself (delete the sentence, or mark it for paraphrase and redraft), not just its key; make Pass 3 fail closed on quoted spans without an attributable citation. |

### High (21, plus 1 from the gap-fill pass)
| Workstream | Issue | Seen by | Fix |
|---|---|---|---|
| export-zerotrace-honesty | **Offline/markdown citation rendering numbers every numeric cite [1], orders references by key and mangles locators** — resolveAndRenderCitations renders each entry in isolation, so every IEEE (CS default)/Vancouver/AMA cite is [1] while the bibliography is in key order; `[@key, p. 2]` survives as `[@key,]`, prefixes are mangled and Chicago notes inlined. This path runs for every --format md export and for docx/pdf/latex whenever pandoc or the PDF engine is missing. | 3× | Render every format with document-level citeproc (pandoc --citeproc for md too); without pandoc use one ordered citeproc-js/citation-js session with full cluster grammar (prefix, locator, suppress-author); test numeric styles end to end. |
| export-zerotrace-honesty | **Compiled manuscript has no section headings and no paper title: compile concatenates bare section bodies** — The drafter is told not to emit a leading # title and write.ts saves text verbatim, but runCompile never inserts the OUTLINE titles it loads (used only for the smoother) and nothing adds a paper title, so every exported docx/pdf/tex/md is one unstructured run of paragraphs; the compile-order test passes only because fixtures embed headings. | 1× | In runCompile insert `## <outline title>` before each section body (unless it already starts with a heading) and the paper title as YAML `title:` or `# Title`; use realistic fixtures without headings. |
| export-zerotrace-honesty | **Compile overwrites the canonical CITATIONS.bib: uncited sources and bibliographic fields are destroyed** — regenerateBib rewrites .paper/CITATIONS.bib (verify's source of truth) in place from cited keys via a lossy SourceCandidate round-trip, deleting uncited sources and journal/volume/pages/publisher/URL/entry type and forcing Title Case; research also overwrites add-ed sources. Later valid citations become FABRICATED. | 2× | Keep the library bib (all approved sources) intact; write the cited subset, verbatim, only into .paper/export/ (or COMPILED.bib); never re-serialize through SourceCandidate; make research merge into existing entries keyed by DOI. |
| network-mode-sources | **DOI-less sources (arXiv-only, books, PubMed without DOI) are dropped from CITATIONS.bib and always FABRICATED** — toCsl keeps only entries with doi/isbn/arxivId, but no adapter sets isbn/arxivId/PMID and SourceCandidateSchema strips them, so DOI-less works stay in LIBRARY.json (which the planner/drafter see) but vanish from CITATIONS.bib; the drafter cites them and Pass 1 FABRICATEs any entry without a DOI, so books can never be cited. | 2× | Add arxivId/pmid/isbn to SourceCandidate and map them in the arXiv, S2, PubMed and Zotero adapters; emit them to the bib; make Pass 1 resolve by identifier (arXiv API, PubMed esummary, ISBN lookup) instead of FABRICATING DOI-less entries. |
| network-mode-sources | **Author names are flattened: 'Given Family' strings become literal surnames and PubMed 'Family AJ' yields surname 'aj'** — OpenAlex/arXiv/S2/Zotero emit 'Given Family' and PubMed 'Family II'; parseAuthor splits only on commas, so BibTeX gets braced literal family names (APA prints 'Ashish Vaswani et al.', sorted by first name) and firstAuthorSurname turns 'Wakefield AJ' into 'aj', giving citekey aj1998 and a false MIS-CITED. | 2× | Carry structured {family, given} names from each API's own fields (Crossref family/given, PubMed LastName/Initials, OpenAlex raw names plus a name parser, or hydrate CSL names from Crossref/DataCite by DOI); write CSL name objects; test each adapter against real payloads. |
| network-mode-sources | **`pensmith add` rewrites CITATIONS.bib through a lossy converter: deletes DOI-less entries, erases RETRACTED flags, renames keys** — To append one source, add reloads every bib entry via cslToCandidate and rewrites the file: DOI-less books/arXiv entries are deleted, note={RETRACTED} is reset (silently undoing the stored-retraction gate Pass 1 relies on), non-lowercase keys become 'anon' (dangling [@Key] cites), journal/volume/pages are dropped; LIBRARY.json is not updated. | 4× | Make LIBRARY.json (CSL-JSON) the source of truth: append the new candidate there and regenerate the bib losslessly, or append only the new entry; share one audited bib<->candidate converter that preserves retracted, ISBN, arXiv, original key and container fields. |
| network-mode-sources | **`add <pdf\|url>` accepts Crossref's top-1 hit for a heuristic first-line title with no similarity or DOI check** — add takes the PDF's first 8-300 char line (often a licence line or running header) as a title and accepts Crossref's top-1 search hit unconditionally, ignoring a DOI printed in the PDF, then discards the text. The metadata is self-consistent, so Pass 1 cannot catch the mis-attribution. arXiv IDs and BibTeX import are unsupported. | 2× | Scan the PDF text for a DOI/arXiv id first; otherwise fetch several candidates and accept only above a title-JW threshold plus author overlap with names in the text; keep the PDF text for Pass 3 (PRD §9); add arXiv-id and BibTeX/CSL import. |
| pipeline-state-router | **Bare /pensmith loops forever on 'failed' or 'unverifiable' sections and never routes to a fix or to compile** — resolveNextAction maps 'failed' and 'unverifiable' to verify; re-verifying an unchanged draft repeats the verdict and re-bills Pass 2/4, so the single command never reaches revise or compile, while explicit compile/done silently accept 'unverifiable' (any paywalled quote). verify's early exits never save status or hash. | 7× | Route 'failed' to plan N --revise (or an attention decision naming the blocking citekeys and repair command); route 'unverifiable' to an explicit user acknowledgement that compile/done honor; never re-dispatch verify on an unchanged hash; persist status on every verify exit. |
| pipeline-state-router | **Wave-mode `pensmith write` re-drafts every planned section, overwriting verified or hand-edited drafts** — runAllSections schedules every section that has a PLAN.md and never reads its status, so writeOneSection regenerates verified or hand-edited DRAFT.md files without confirmation or backup, downgrades them to 'written' and re-bills them, violating section-as-phase isolation. | 1× | In wave mode schedule only planned/writing sections (or those without DRAFT.md); require --force to re-draft written/verified sections and keep a DRAFT.md.bak before overwriting. |
| tier1-claude-native | **Approval gates are TTY-only: in Claude Code (non-TTY) the only way through is --yolo, which the error text recommends** — Outline/research/revise gates throw whenever stdin/stdout isn't a TTY (always, in Claude Code's Bash and MCP) after paying for generation, never show the proposal, and say 'Use --yolo to auto-accept'; add and sketch crash in ask() on closed stdin; plan --revise dumps a stack trace (exit 1, not 3). Default-on gates are unreachable in Tier 1. | 6× | Make gates two-phase: --propose writes a reviewable artifact (OUTLINE.proposed.md, candidate list, revise diff) and exits with a distinct 'awaiting approval' code/JSON; --approve <id> commits exactly that; skills ask via AskUserQuestion; never suggest --yolo in non-TTY errors; catch ApprovalUnavailableError everywhere. |
| tier2-llm-layer | **LLM transport rejects every current-model response: content[0] must be text, but thinking blocks come first** — parseAnthropicResponse throws unless content[0].type === 'text'; current models return thinking blocks first (always on Opus 5.5, default on Sonnet/Haiku 5.5), so every Tier-2 generation and Pass 2/4 call fails even after the model-ID fix, and because appendCost runs after parsing, billed tokens never reach the cost ledger. | 4× | Use @anthropic-ai/sdk with a custom fetch routed through http.ts (keeps the chokepoint); concatenate all text blocks; record usage cost before content validation in a finally path; add thinking-block fixtures to llm-transport tests. |
| tier2-llm-layer | **Pricing is keyed by provider-map key and only knows unservable model IDs, so no Anthropic configuration can run** — complete() passes the runtime.json map key to estimateCost, so providers:{claude:{name:'anthropic'}} throws UnknownModelError; the table's only Anthropic IDs (claude-opus-4/sonnet-4/haiku-4, with haiku-4 the default) are not served, and any real ID (claude-opus-5-5 etc.) also throws, so nothing both prices and runs; model selection is undocumented. | 1× | Price by providerCfg.name; replace the table with current IDs (claude-opus-5-5 $4/$20, claude-sonnet-5-5 $2/$10, claude-haiku-5-5 $0.10/$0.50, plus cache rates) and a valid default; treat unknown models as warn + conservative estimate (or Models API lookup); document model config. |
| tier2-llm-layer | **Outline, planner and drafter receive no sources and hardcoded placeholders, so drafts are uncited or cite invented keys** — Prompts get candidateSources '[]', topic '(wire via Phase 12)', title=slug, fixed 300-400 words, discipline 'general'/'other' and the raw PLAN.md frontmatter in a code span; assertDrafterInput validates constants, not the prompt inputs, so §7.6 source isolation is unenforced and drafts cite nothing or planner-invented keys with quotes from memory. | 3× | Build one PlannerInput/DrafterInput object in code from OUTLINE rows, INTAKE fields and LIBRARY.json filtered to PLAN.assigned_sources (metadata, abstracts, verbatim passages); validate that exact object and render prompts only from it; strip frontmatter from the brief. |
| verifier-integrity | **Export gate is not bound to the exported bytes: post-compile edits and bib changes export unverified citations** — runExportBlockingGate only rescans section VERIFICATION.md files. It never checks that .paper/DRAFT.md is the gated compile output, recomputes section hashes or re-runs Pass 1 on the exported bytes, and the draft hash excludes bib entry contents, so post-compile edits (user or Tier-1 agent) or changed bib entries export unverified. | 4× | Have compile write a manifest (DRAFT.md sha256, per-section verified hashes, hashes of cited bib entries); done refuses on any mismatch and runs deterministic Pass 1 over every citekey in the exact file being exported; require explicit acknowledgement for 'unverifiable'. |
| verifier-integrity | **Narrow bare-lowercase [@key] regex still drives compile bib regen, GATE-04, smoother masking and Pass 2/4** — Audits #2/#20 widened only Pass 1. regenerateBib, reCheckFinalMd (GATE-04), smoother masking and Pass 2/4 still use /\[@([a-z][a-z0-9_-]*)\]/, so verified [@k, p. 5], [@a; @b] and [@Key] sources vanish from CITATIONS.bib (export shows raw tokens, no references) and humanizer-injected fabricated keys in clusters pass GATE-04. | 5× | Use one shared citation tokenizer (ideally Pandoc AST Cite nodes, incl. -@ and narrative @) in verify, compile regen, exporter, GATE-04, smoother and Pass 2/4; fail compile if a cited key is missing from the bib; add a differential test that every exported key is in the bib. |
| verifier-integrity | **Pass 1 ignores [-@key], narrative @key, raw DOIs, arXiv IDs and author-year prose citations** — extractCitedKeysForVerification only scans [...] clusters and requires start/whitespace/';' before '@', so Pandoc suppress-author [-@key] and narrative @key (both rendered) plus inline DOIs, doi.org URLs, arXiv IDs and 'Smith and Lee (2021)' produce no Pass-1 row; the section is marked verified and the text exports unchecked (PRD §7.7). | 2× | Accept '-@' and narrative @key (or use the Pandoc AST); add a fail-closed detector for raw DOIs, arXiv IDs, PMIDs and parenthetical author-year patterns that blocks until each is converted to a verified citekey. |
| verifier-integrity | **Pass 1 resolves DOIs only via Crossref, so arXiv/DataCite and other non-Crossref DOIs are falsely FABRICATED** — verdictForCitekey calls only crossref.fetchById and maps null to FABRICATED, so every arXiv 10.48550 DOI (which research itself collects), DataCite (Zenodo, figshare), mEDRA and JaLC DOIs and Crossref works with organization-only authors are falsely FABRICATED, blocking most CS/ML papers; the cassette fakes a Crossref 200. | 6× | Resolve via doi.org content negotiation (CSL-JSON covers Crossref, DataCite, mEDRA, JaLC) or the RA lookup then the right registry; arXiv API for 10.48550 and eprint IDs; keep org-only authors in toCandidate; re-record the cassette as the real 404. |
| verifier-integrity | **Pass 1 title/author matching gives false MIS-CITED (particles, markup, subtitles, compound names) and false OK (sibling titles)** — Pass 1 runs Jaro-Winkler on raw lowercased titles and the CSL `family` only: particle surnames (even pensmith's own bib round-trip), HTML/MathML in Crossref titles, omitted subtitles, 'et al.', Iberian/CJK names and suffixes give false MIS-CITED, while sibling papers differing by one word stay above 0.92. | 2× | Build surnames from particles+family and accept literal/organization names; strip markup and entities; compare against title and title+subtitle with token-set or normalized-Levenshtein similarity; check surname-set overlap; add a known-good corpus test. |
| verifier-integrity | **Pass 3 0.95 character-level threshold accepts one-word misquotes that reverse the meaning** — QUOTE_LEV_THRESHOLD = 0.95 on a character-level substring ratio lets a 267-char quote absorb ~13 edits, so negations, changed numbers or antonyms pass as FOUND; the known-bad-quotes corpus contains only wholesale fabrications, so tests never catch it. | 1× | After normalization (NFKC, de-hyphenation, ligatures, whitespace) require token-level exact match, allowing only bounded extraction-noise edits that never touch alphabetic word tokens; add negation/number/antonym misquote fixtures. |
| verifier-integrity | **Pass 2 claim-support never sees source text (empty abstract), so UNSUPPORTED and the done confirmation can never fire** — Pass 2 reads bibEntry.abstract from CITATIONS.bib, which writeBibtex never writes (OpenAlex abstracts are not even de-inverted), so every verdict defaults to UNCLEAR, evidence must be a substring of '' and the DONE-09 UNSUPPORTED gate is dead; Pass 4 Step-3 labels are paid for but unused, and both re-bill on every router loop. | 4× | Persist abstracts/OA passages in LIBRARY.json keyed by citekey and feed them, ideally as Citations-API document blocks requiring cited_text for SUPPORTED; label 'no source text' distinctly; use or drop Pass 4 Step 3; skip re-billing unchanged drafts. |
| verifier-integrity | **verify extracts verdicts from one read of DRAFT.md but hashes a later read (TOCTOU)** — DRAFT.md is read once for Pass 1/3, then computeDraftHash re-reads it after the minutes-long Pass 2/4 LLM calls; an edit (by the user or an agent) in that window is stored with a fresh hash next to verdicts for the old text, so compile's staleness check treats unverified content as verified. | 1× | Read the draft bytes once and use the same Buffer for extraction and hashing; store the hash inside the verdict file as well. |
| tier2-llm-layer (gap-fill) | **section-planner prompt emits `number`/`state` keys; wave-mode write throws a raw ZodError on such a PLAN.md and writes no section** — The section-planner prompt's Output Format example uses `number:`, `state: planned` and `estimated_word_count:`. PlanFrontmatterSchema requires `section` (and `title`/`slug`). plan.ts writes the model output verbatim and only adds `status: writing`. In wave mode, loadPlanFrontmatter calls PlanFrontmatterSchema.parse with no try/catch, so one non-conforming PLAN.md aborts the entire runAllSections. Sibling sections wi | 1× | Align the prompt with PlanFrontmatterSchema, or have plan.ts normalize and validate model frontmatter before writing (set section/slug/title from the outline). In the orchestrator, use safeParse per section and report a failed or blocked SectionResult instead of throwing for the whole run. Add a test with one malformed PLAN.md that asserts the sibl |

The full list of 121 issues, with medium, low and nit, fix notes and member findings, is in `ISSUES.md`. Every raw finding, with its evidence and verifier votes, is in `VERIFIED-FINDINGS-DIGEST.md`.

## 3. Proposed plan — 7 shippable phases

Each phase ends with behavioural exit gates: real commands and journey tests, not grep checks. Phases 1 and 2 are what make it a usable plugin. Public announcement should wait for Phase 2.

### Phase 1 - Installable, honest core (v0.3.0-alpha)
*Size: XL: about 12-15 Claude working days as 6 PRs. 1.1 can ship alone in about 2 days.*

**Goal.** Ship a plugin that installs from the owner's marketplace and a CLI that works through npm link. The full pipeline (intake through done) runs on live sources with no fixture data, no false verdicts and no trace leaks, and the docs state exactly what it does. Tier 1 still uses the Tier-2 generator and an API key, labelled alpha.

**Scope.**

Ordered PRs.

1.1 Integrity stopgap:
- Network is live by default. Cassettes load only when the test runner sets PENSMITH_TEST_CASSETTES=1. Delete every first-item fallback.
- --dry-run/--offline become an egress-refusing dispatcher that writes only to .paper/.dry-run/.
- Remove the canned GPTZero and DDG results.
- Exit codes: 2 = blocked, 3 = approval needed.
- Compile refuses 'Status: failed'. A zero-citation draft with assigned sources is never verified.
- DOCX: drop custom.xml, run pandoc with relative paths, add a trace scanner.
- Regenerate RIS from the verified key set. Fix the realpath entry guard.

1.2 Verifier holes:
- One citation grammar everywhere, with the HARDEN-03 differential test. Raw DOI/arXiv/author-year citations in prose become a blocking UNPARSEABLE.
- Resolver chain (Crossref, DataCite, doi.org Handle API, arXiv, E-utilities) with found/not_found/unavailable results; unavailable means UNRESOLVED.
- Normalized DOI comparison, year within 1, particle-aware surnames, markup-stripped titles.
- Retraction from Crossref updated-by and OpenAlex is_retracted; delete the Labs adapter.
- Pass 3 fetches binary (bodyBytes, noCache, content-type check); Unpaywall needs an email.
- Quote matcher: normalized exact match, ellipsis segments, bounded alignment.
- revise 'remove' deletes the quotation itself.
- VERIFICATION.json becomes the source of truth. A compile manifest is written, and export re-runs Pass 1/3 on the exact bytes.
- LIBRARY.json holds canonical CSL-JSON with stable citekeys; add, research and compile no longer round-trip it lossily.

1.3 Transport:
- @anthropic-ai/sdk with fetch routed through http.ts, streaming, stop_reason handling, current models.
- Price table keyed by provider name; per-paper aggregate cap.
- A Generator interface.

1.4 Contracts and minimal FEED-01..05:
- Intake stores the assignment verbatim plus structured answers.
- Outline and plan via structured outputs, validated and rendered. OUTLINE.json is the single section list.
- The planner and drafter receive only the section's assigned sources, fenced.
- Table-driven router:
  - failed routes to plan --revise;
  - unverifiable routes to an ack;
  - freshness comes from the manifest.
- Wave write skips verified sections. Unknown verbs exit 2.
- STATE.json and config.toml move into .paper/ with a migration. Compile emits headings.

1.5 Gates:
- Two-phase propose/approve. Non-TTY runs exit 3 with JSON.
- Error text never suggests --yolo. Export confirmation defaults to no.

1.6 Packaging:
- plugin/ payload with a valid plugin.json.
- skills/pensmith/SKILL.md.
- Spec hooks.json with one SessionStart hook.
- No MCP declaration.
- Committed esbuild bundle and a bin/pensmith shim.
- CI runs claude plugin validate --strict and an isolated install smoke, on Node 22/24 across 3 OSes.
- Version 0.3.0-alpha.1. README and PRIVACY rewritten honestly, with a host table.

**Exit criteria.**

1. Install: claude plugin validate plugin --strict passes. An isolated marketplace add + install shows 1 skill, 1 hook and 0 errors. pensmith --version works through an npm-link symlink.
2. Live by default: no production code path can read tests/fixtures. With no env vars set, a novel topic returns live OpenAlex results, and an unknown DOI returns UNRESOLVED or null, never a substituted record.
3. Through the real verify CLI:
   - 10/10 fabricated DOIs are FABRICATED;
   - arXiv 10.48550 and Zenodo DOIs resolve OK;
   - 429/5xx cassettes give UNRESOLVED with 0 FABRICATED;
   - Wakefield 1998 is RETRACTED;
   - fabricated quotes in locator, uppercase-key and multi-cite form are NOT_FOUND.
4. Journey test: a scripted fake generator drives bare pensmith from an empty dir with assignment.txt to an exported docx. Sections register from a prompt-compliant outline, the assignment is preserved, and each section cites only its own assigned keys. A post-compile hand edit or a bib swap makes export exit 2.
5. The trace scanner finds nothing on real pandoc docx/pdf/tex/md output: no pensmith, no $HOME, no .paper, no custom.xml.
6. Every refusal exits non-zero, and --dry-run leaves the .paper/ hash snapshot unchanged.
7. A secrets-lane live Tier-2 smoke completes one 2-section paper.

### Phase 2 - No-key Tier 1 (engine action protocol)
*Size: L: about 8-10 days · depends on: Phase 1 - Installable, honest core (v0.3.0-alpha)*

**Goal.** Tier 1 generates in the user's Claude Code session. The CLI never calls an LLM inside Claude Code. Both tiers run the same action stream, which makes the two-tier requirement real and testable.

**Scope.**

- pensmith next --json returns typed actions (run, agent, gate, ack, converse, stop), each with input/output paths and a nonce.
- pensmith submit runs the same validators the Tier-2 runner uses.
- 5 agents with tools Read and Write, generated from the shared prompt templates.
- .paper/work/ is the only model-writable area, enforced by a PreToolUse guard-write hook on Write/Edit/MultiEdit/NotebookEdit.
- Gates use AskUserQuestion with a ref code and are recorded by a PostToolUse capture hook (spike first; the fallback is model_attested, shown in status).
- --yolo counts only if the user typed it.
- The CLI refuses generative porcelain when CLAUDECODE=1.
- workflows/*.md become skills/pensmith/reference/*.md procedures (owner decision 1).
- SessionStart(compact) injects the next step.
- The Tier-2 runner is refactored to consume the same action stream.
- The tier-contract test is rewritten as action-trace equivalence (a Tier-1 simulator vs the Tier-2 runner).
- Spike: does bare /pensmith resolve?
- claude plugin eval routing suite.

**Exit criteria.**

1. Nightly headless claude -p --plugin-dir plugin, with no ANTHROPIC_API_KEY, completes intake through one verified section on a fixture project.
2. EGRESS.log shows 0 calls to api.anthropic.com from the pensmith process in Tier 1.
3. The action-trace equivalence test is green.
4. Evals:
   - 'continue' in a folder without .paper/ does not trigger the skill;
   - 'just approve the outline for me' creates no gate record without a real AskUserQuestion answer;
   - a model write under .paper/ outside work/ is denied.

### Phase 3 - Grounded drafting and real claim support (FEED completed, SEC-02 folded)
*Size: XL: about 12-15 days. Tier-2 parts can start after P1. · depends on: Phase 2 - No-key Tier 1 (engine action protocol)*

**Goal.** Make 'every citation supports its claim' a mechanism, not advice.

**Scope.**

Acquisition:
- OA full text from OpenAlex best_oa_location, arXiv and Europe PMC JATS, plus BYO PDFs via new --pdfs and add <pdf>.
- pdf.js runs in a worker thread that can be terminated (SEC-02).
- Identity check of each PDF against canonical metadata; pinned normalized text; chunks with a page map; BM25.

Drafting:
- The planner picks passages, and the engine builds BUNDLE.md (mapped sources only, fenced, injection-scanned).
- The writer attaches verbatim anchors, checked at submit:
  - keys come only from the section's mapping;
  - cited_text appears in a bundle passage;
  - each quote sits inside its anchor;
  - raw-citation detector;
  - surnames named in prose must match the cited source.

Judging:
- The claim judge runs in a fresh context: a subagent in Tier 1, SDK structured output in Tier 2. The Citations API is optional for the Tier-2 writer.
- Downgrade-only post-checks: span substring, numbers, hedge wording.
- Repair loop, at most 2 rounds. Per-claim ack policy per owner decision 4.
- Orphan audit: code finds candidates and the model may only dismiss them.
- Quote policy: QUOTE_UNVERIFIABLE for sources without text (owner decision 9).
- Local source-overlap (COPY) check.
- Prompt caching of the section bundle across plan, write and judge.

**Exit criteria.**

1. Mutation e2e: each of these blocks export, 100% of the time: an unmapped key, a fabricated span, an altered quote, a changed number, a raw DOI, a wrong surname in prose, a judge SUPPORTED with a bogus span, an injected passage, 12 copied words.
2. Judge gold set (at least 150 items): SUPPORTED precision >= 0.95 and UNSUPPORTED+PARTIAL recall >= 0.85 on the default judge, published in the README.
3. A PDF timeout test proves the worker is terminated.
4. A 2-section paper with disjoint sources shows 0 cross-section citation bleed.

### Phase 4 - Done pipeline: humanize, plagiarism, honesty, export
*Size: L: about 7-9 days · depends on: Phase 3 - Grounded drafting and real claim support (FEED completed, SEC-02 folded)*

**Goal.** The finishing steps run in an order that never lets unverified text reach the exported document, with zero trace.

**Scope.**

Done order:
1. whole-paper deterministic audit;
2. plagiarism check on DRAFT;
3. humanize;
4. re-verify;
5. plagiarism check on FINAL;
6. honesty score;
7. acks;
8. export confirmation;
9. export.

Humanize:
- The skill invokes the user's humanizer skill by name on marker-locked text.
- The engine validates tokens, quotes, length and numbers, reverts failing paragraphs, and re-judges changed cited sentences.
- Tier 2 uses the humanizer's SKILL.md body as the prompt if present, otherwise skips with a note.

Plagiarism and honesty:
- DuckDuckGo: detect status and challenge pages, send quoted verbatim phrases spread across the paper, ask for consent once. A blocked run reports 'incomplete', never 'clean'.
- GPTZero: key from userConfig (sensitive), consent once defaulting to no, before and after scores with the locked framing, a skip note when there is no key.

Export:
- Document-level citeproc for every format; pure-JS docx fallback; LaTeX --standalone.
- docProps rebuilt from an allowlist; PDF Info/XMP blanked; zip timestamps normalized; blocking trace scanner.
- Exported .bib carries no last_verified or note fields.
- Optional boundary smoother with frozen cited sentences.

**Exit criteria.**

1. PRD §15 #1, #4 and #5 pass in CI, both with pandoc + TeX and without pandoc.
2. IEEE numbering follows first appearance, and Chicago notes-bibliography produces footnotes.
3. A humanizer fixture that drops a marker or alters a quote is reverted.
4. A DuckDuckGo 202 challenge fixture yields 'web check incomplete'.

### Phase 5 - HARDEN + SEC-01 (v0.3.0 Phases 18/19 folded)
*Size: M-L: about 6-8 days · depends on: Phase 1 - Installable, honest core (v0.3.0-alpha), Phase 4 - Done pipeline: humanize, plagiarism, honesty, export*

**Goal.** Regressions in routing, integrity and the network layer can't land silently, and the two documented security residuals are closed.

**Scope.**

HARDEN:
- HARDEN-01: a strict journey e2e, required on 3 OSes. It runs bare pensmith with LLM cassettes keyed by packet hash and asserts each router transition.
- Kill-and-resume fault injection (PRD §15 #12) and a redo-isolation hash test (#11).
- Pandoc-parity property tests for the citation grammar.
- HARDEN-02/04: a nightly live lane against real Crossref, DataCite, doi.org, arXiv and PubMed, including a retracted DOI, a real pandoc export and the Tier-2 provider.
- Re-record cassettes from the real APIs with mailto scrubbed.

SEC-01 and the network layer, as a composed undici dispatcher:
- EnvHttpProxyAgent;
- SSRF validation at connect time via connect.lookup;
- a redirect interceptor that re-checks every hop;
- response size caps and total deadlines;
- method-aware retry;
- mailto sent only to scholarly APIs.

Test hygiene and evals:
- Delete the skip-when-missing guards and tautologies; CI fails on any unexpected skip.
- Close the lint gaps: global fetch, writeFileSync, named imports.
- A claude plugin eval behaviour suite: bypass attempts, prompt injection, and framing requests like 'make it undetectable'.

**Exit criteria.**

1. All of the suites above are required checks and green.
2. A test proves the validated IP is the dialed IP.
3. CI's skip count equals the explicit allowlist.
4. Seeded regressions (a router loop, a stale export, an extractor drift) fail CI.
5. The live lane is green on main.

### Phase 6 - Breadth restore
*Size: L: about 7-9 days · depends on: Phase 2 - No-key Tier 1 (engine action protocol), Phase 3 - Grounded drafting and real claim support (FEED completed, SEC-02 folded)*

**Goal.** Restore the PRD breadth the owner chose to ship, on top of the hardened core.

**Scope.**

- Library: list --class, class asked at intake, open prints the path or a cd hint.
- Learning mode: a tutorial generated by the model from LIBRARY.json.
- Sketch: a Tier-1 Socratic reference procedure plus new --thesis.
- Style-match: the profile is fed into bundles (opt-in, with the disclosure).
- PII: narrowed to contact and ID classes, with a confirm diff.
- doctor per PRD §7.21:
  - live probes;
  - a /v1/models check of the key and model ID;
  - data-dir write test and free disk space;
  - network mode and proxy;
  - Node version;
  - humanizer and pandoc detection.
- --estimate via the token-counting endpoint; --show-prompts at the chokepoint.
- Inline corrections: retarget length, insert or drop a section with stable ids, remap a source.
- OpenAI-compatible provider and an Ollama e2e (setting num_ctx).
- Tier-1 parallel waves (Kahn layering, cap 3).
- Optional Zotero import-file path.

**Exit criteria.**

1. PRD §15 #6, #7 and #9 pass. #7 is an Ollama run with the deterministic guarantees intact and the judge model recorded.
2. Each correction op changes only the expected directories (hash test).
3. doctor FAILs when Node is missing or the stack is misconfigured.

### Phase 7 - Publish v1.0
*Size: S-M: about 3-4 days · depends on: Phase 4 - Done pipeline: humanize, plagiarism, honesty, export, Phase 5 - HARDEN + SEC-01 (v0.3.0 Phases 18/19 folded)*

**Goal.** A clean, honest public release on the owner's marketplace, npm and the Anthropic directory.

**Scope.**

- Scrub personal paths and emails from tracked files: cassettes, tests, .planning, AUDIT-FINDINGS.
- Archive .planning.
- README generated from the verb registry, with the PRD §3 disclaimer, a section on what is deterministic vs model-judged, and the judge metrics.
- PRIVACY host table and an honest SECURITY threat model.
- Icon.
- Release script: single version source, tag, npm publish --provenance, GitHub release, CHANGELOG.
- Anthropic directory submission.

**Exit criteria.**

1. A fresh-machine marketplace install passes doctor on macOS, Linux and Windows.
2. npm i -g pensmith and npx pensmith --version work.
3. 0 matches for personal-path or email patterns in the plugin payload and the npm tarball.
4. The directory submission is filed.


## 4. Decisions that are yours to make

I'll ask the four most consequential ones directly. For the rest I'll use my recommendation unless you say otherwise.

1. **Replace the workflow-body <capability_check> files with an engine step graph? (This changes the mechanism behind the CLAUDE.md two-tier non-negotiable.)**
   - Options: A: keep prose workflows/*.md as the shared source and have Tier 2 parse them; B: step graph in code (pensmith next --json action stream), shared prompt templates, one SKILL.md with the <capability_check>, and per-verb reference procedures converted from workflows/; C: B, but keep workflows/ as human docs only
   - **Recommendation: B** — Today neither tier reads the workflow bodies at runtime. Prose read by an LLM in Tier 1 and by JS in Tier 2 can't be proven equivalent. B keeps the intent (one source of truth, both tiers first-class, graceful degradation) and makes the tier contract testable as action traces. The CLAUDE.md wording needs updating.
2. **Keep or drop the MCP server?**
   - Options: A: drop it for v0.x; Claude uses the CLI on the plugin bin/ PATH; B: keep a narrow typed surface (read-only resources plus task_get/task_submit so subagents have no file or network tools); `C: fix the current server`
   - **Recommendation: A now; revisit B if Claude Desktop/Cowork without Bash becomes a target** — The current server fails to start from an install, writes plain text into the JSON-RPC stdout, has three no-op tools and a model-settable yolo. The CLI covers every verb, and two of the three fresh designs drop MCP. Isolation of effect is enforced at submit regardless. The PRD's 'MCP-backed state' wording would change.
3. **Tier 2 provider scope?**
   - Options: `A: Anthropic native SDK only`; B: Anthropic native SDK plus an OpenAI-compatible base_url adapter (OpenAI, Ollama, vLLM, llama.cpp); C: B plus a Claude Agent SDK lane that runs the plugin headlessly
   - **Recommendation: B (defer C)** — PRD §15 #7 requires Ollama. Anthropic isn't usefully OpenAI-compatible for structured outputs, citations, caching or refusal semantics. The Agent SDK is Claude-only, heavy, and not OSI-licensed for bundling.
4. **Block UNSUPPORTED/PARTIAL/UNCLEAR claims more strictly than the PRD does?**
   - Options: A: PRD as written: advisory, summarized at the export confirmation, --yolo skips it; B: auto-repair up to 2 rounds, then require a per-claim acknowledgement bound to the claim hash before export; --yolo never acks and halts with a report; C: B, but --yolo may ack review items (logged)
   - **Recommendation: B** — It turns 'flags unsupported claims for human review' into a mechanism. Compile stays allowed and the hard-blocking list (FABRICATED, MIS-CITED, NOT_FOUND) is unchanged, so no non-negotiable is weakened.
5. **Where does humanize run relative to verification?**
   - Options: A: after compile in done, on marker-locked text, with a deterministic re-verify, re-judging of changed cited sentences, and per-sentence revert; `B: per section, before verify`; C: after verify with no protection (the PRD letter)
   - **Recommendation: A** — It keeps the PRD §5.3 'humanize is folded into done' UX and --raw, and the humanizer sees the whole paper. Hash-bound export makes it safe. C silently invalidates verification.
6. **GPTZero honesty score: default-on, gated, or deferred?**
   - Options: `A: default-on as in the PRD`; B: on when the user has configured a key (userConfig, sensitive), with one-time consent; otherwise a 'skipped: no key' note; `C: defer to a later release`
   - **Recommendation: B** — The API needs a key and receives the full paper. The honest-framing non-negotiable is unchanged, and cached or fixture numbers are never shown.
7. **Plagiarism check (deliberate choice: free-only via DuckDuckGo)?**
   - Options: A: DuckDuckGo only, fixed (status checks, quoted phrases, blocked means incomplete); B: a local source-overlap check as primary, plus DuckDuckGo as best effort with consent; C: local check plus Claude Code WebSearch instead of DuckDuckGo
   - **Recommendation: B** — It keeps the free-only choice and DuckDuckGo. The realistic risk in grounded drafting is copying the supplied (often paywalled) sources, which a web search can't see. DuckDuckGo bot-blocks automated queries and discourages scraping, so a blocked check must read 'incomplete', never 'clean'.
8. **How should retracted sources be handled?**
   - Options: `A: block as MIS-CITED (current code)`; B: a distinct RETRACTED verdict that blocks unless the user acknowledges that citation (e.g. the paper discusses the retraction); `C: warning only (PRD §7.12)`
   - **Recommendation: B** — Retracted work is never cited silently, but a paper about the retraction itself is still possible.
9. **Can sources without accessible text (paywalled, books) be cited or quoted?**
   - Options: A: allow it and mark the result unverifiable; B: direct quotes only from sources with text, otherwise a blocking QUOTE_UNVERIFIABLE unless the user supplies the PDF or attests; abstract-level claims allowed and labelled; `C: no citation at all without text`
   - **Recommendation: B** — C makes humanities books uncitable without the user's own copy. A is how fabricated quotes from paywalled works escape.
10. **How are approvals recorded in Tier 1?**
   - Options: A: model-attested: Claude calls pensmith gate approve after AskUserQuestion; B: a PostToolUse(AskUserQuestion) hook captures the user's real answer with a ref code, falling back to A recorded visibly; C: a typed reply phrase captured by a UserPromptSubmit hook
   - **Recommendation: B with A as a visible fallback** — Default-on approval gates are non-negotiable, and the model must not be able to approve on the user's behalf. Needs a spike on the hook payload.
11. **What if bare /pensmith doesn't resolve for a plugin skill?**
   - Options: A: use a plugin-root single-SKILL.md layout; B: teach /pensmith:pensmith plus natural language; C: natural language first in the README, with the namespaced slash form as the explicit command
   - **Recommendation: Run the spike first; if bare /pensmith fails, C** — This touches the single-command non-negotiable, and the plugin spec doesn't document the bare form. Natural-language routing is the real zero-memory UX either way.
12. **Process: keep building via GSD phases, or direct PRs?**
   - Options: A: continue with GSD (/gsd:plan-phase, execute-phase, verify-work); B: direct small PRs executed by Claude against this plan, each with behavioural exit gates; C: GSD for planning docs only, PRs for execution
   - **Recommendation: B. If staying on GSD, require its verify-work to run the journey e2e and claude plugin validate instead of grep gates.** — GSD artifacts recorded PASS on things that were broken (manifests valid, hooks wired, verifier blocks, known-bad 10/10). The project carries 100k lines of process docs for 25k lines of code. CLAUDE.md currently mandates GSD, so this is the owner's call.
13. **Distribution targets and timing?**
   - Options: `A: own GitHub marketplace only`; B: own marketplace (alpha from P1), then npm (from P2/P3), then the Anthropic directory (after P5); `C: submit to the directory now`
   - **Recommendation: B** — The directory needs an icon, a privacy policy URL and a clean validate --strict, and reviewers will scrutinize the academic-integrity framing. The npm symlink entry bug must be fixed before publishing the CLI.
14. **Should .planning/ (and tests and src) ship inside the plugin?**
   - Options: A: as today: git-clone installs carry 337 .planning files plus tests and fixtures; B: a plugin/ payload subdirectory so only runtime files ship, with personal paths scrubbed; C: B, plus archive .planning to a branch or docs/history
   - **Recommendation: C** — Privacy (Windows user paths and institution names in tracked files, the developer's email in cassettes), install size, and stale PASS claims that would mislead users and contributors.
15. **When do the deliberate breadth features (style-match, learning mode, sketch, PII, Zotero) land?**
   - Options: `A: all in the first credible release`; B: core first (P1-P5) and breadth in P6; style-match stays shipped, Zotero is deferred; `C: drop some of them`
   - **Recommendation: B** — CLAUDE.md says style-match IS shipped, so keep it; it already exists and is honest. Breadth must not delay the integrity fixes.

## 5. PRD edits these changes imply

- **§1, §5.1, §5.5 command naming** — Plugin skills are namespaced /<plugin>:<skill>, and colon-named skills are invalid. The primary UX is the pensmith skill (natural language) plus whichever slash form the eval proves works. The 'hidden namespace' becomes the CLI (pensmith plan 3) or disable-model-invocation alias skills.
- **§1 Tier 1** — Define who generates: in Tier 1 the session model and plugin subagents produce all outline, plan and draft text. The engine/CLI is deterministic, never calls an LLM, and needs no API key.
- **§1 Tier 2, §10 [runtime]** — Native Anthropic via @anthropic-ai/sdk plus an OpenAI-compatible base_url adapter for OpenAI, Ollama, vLLM and llama.cpp. Role-based defaults (claude-sonnet-5-5, with claude-opus-5-5 for the writer), per-role overrides, and model IDs validated by doctor.
- **§1, §14 two-tier source of truth** — Per decision 1: the shared truth is the engine step graph plus prompt templates plus SKILL.md procedures. <capability_check> lives in SKILL.md, and the tier contract compares action traces.
- **§7.1 intake** — Persist the assignment verbatim (PROJECT.md '## Assignment'), auto-detect assignment.* on bare /pensmith, and record answers as structured fields. PII caveat: in Tier 1 an @file is already in the model's context, so pass a path for the engine to redact. NAME redaction becomes opt-in.
- **§7.2 research, §13 agents** — Search fan-out runs in the engine; models generate queries and score relevance, with no per-query subagents. About 5 agents instead of 19.
- **§7.7 Pass 1** — Resolve by registration agency: Crossref, then DataCite, then the doi.org Handle API/content negotiation; arXiv API; E-utilities; ISBN. FABRICATED only on a definitive not-found. Transport failure is UNRESOLVED (blocking, retry). Compare year within ±1 and the author set, not only the first author.
- **§7.7 citation grammar** — Drafts cite only through Pandoc [@key] clusters. Any other citation-like construct (a raw DOI or doi.org URL, arXiv ID, PMID, bare author-year) is a blocking UNPARSEABLE/RAW_CITATION verdict.
- **§7.7 Pass 2** — Evidence spans must appear verbatim in the cited source's pinned text. The judge runs in a fresh context, and code may only downgrade its verdicts. The ack policy for UNSUPPORTED follows decision 4.
- **§7.7 Pass 3, §9 BYO** — Direct quotes only from sources with accessible text; otherwise QUOTE_UNVERIFIABLE. Handle ellipses and bracketed insertions, and verify page locators. Correct §9: BYO passages ARE sent to the LLM when used for drafting or verification.
- **§7.8 compile** — Smoothing freezes cited sentences, and a boundary diff validates every edit. Only a heuristic terminology linter is required; the contradiction judge is advisory.
- **§7.9, §7.10 done/humanize** — Humanize runs on marker-locked text with re-verification (decision 5). Export binds to the FINAL hash. Remove --no-verify from the export path. Add a pure-JS docx writer so §15 #1 holds without pandoc.
- **§7.9, §14 zero trace** — State the scope precisely: no pensmith strings, user paths, custom properties or invisible characters; not a claim of being forensically indistinguishable from Word. last_verified stays out of the exported .bib.
- **§7.11 honesty score** — GPTZero needs a key. Ask for consent before the first send. Never display cached, fixture or estimated numbers, and say in the report when the score was skipped.
- **§7.12 retraction, §12 sources** — Read retraction from Crossref updated-by, OpenAlex is_retracted and PubMed pubtype. Add a RETRACTED verdict with acknowledgement (decision 8). Remove the api.labs.crossref.org endpoint.
- **§7.17 plagiarism** — Add the local source-overlap check as primary. Run plagiarism on both DRAFT and FINAL. A blocked or challenged DuckDuckGo check reports 'incomplete', never 'clean'.
- **§7.19 dry-run/estimate/cap** — cost_cap_usd is a per-paper aggregate for provider-billed Tier-2 calls, with confirm-to-continue. In Tier 1 it is a work budget shown as estimated API-equivalent dollars. --dry-run means no pensmith-initiated egress, labelled outputs, and real artifacts never overwritten.
- **§7.20 --yolo** — --yolo counts only when the user typed it. It never waives blocking or integrity items, and it also skips the research approval gate.
- **§5.1, §7.14 resume/hooks** — SessionStart injects context; it cannot force a skill to run. Drop the PostToolUse checkpoint. HANDOFF is derived from on-disk state.
- **§6 library** — open <name> sets the active pointer and prints the path or a cd hint; a plugin can't change the session's working directory.
- **§10, §13 .paper layout** — STATE.json and config.toml (with schema_version) live inside .paper/. Mark which §10 keys v0.x actually reads.
- **§12 network** — The contact email is opt-in and sent only to scholarly APIs; Unpaywall requires it. Query arXiv over https at 1 request every 3 s.
- **§13, §19 repo layout/build** — The plugin ships committed runnable bundles in a plugin/ payload directory, with no install-time build. CI runs claude plugin validate --strict and a clean-clone install smoke. Drop pyproject.toml; the project is Node-only.
- **§14 cassettes** — Cassette replay is for the test harness only and must never be reachable from a production invocation.
- **§14, §15 #10 tier contract** — Define the tier contract as action-trace equivalence plus plugin validate plus a headless plugin eval, replacing 'outputs equivalent modulo prose'.
- **§15 #7 Ollama** — Reword to: 'same deterministic guarantees; claim-support quality depends on the judge model, which is recorded in VERIFICATION'.
- **§17 open questions** — Mark as resolved: MCP (none in v0.x), PDF (pdf.js in a worker), citation styles (CSL plus citeproc), style-match (stylometrics plus one voice note), library (pointer index with lazy status), dependency syntax (depends_on list), waves (Kahn, cap 3), renumbering (stable ids with letter suffixes), Tier 2 language (Node only).
- **§19 how to use** — Update per decision 12. If GSD stays, verify-work must run the behavioural gates (journey e2e, plugin validate, mutation e2e).

## 6. What this audit did not cover (do these before calling v1.0 done)

- **[high] No real Claude Code session has ever loaded and driven the plugin. The audit proved it cannot install, but nothing downstream of loading has been observed: skill routing, whether a bare /pensmith or /pensmith:pensmith resolves, MCP tool schemas as Claude sees them, approval gates through AskUserQuestion, <capability_check> degradation, SessionStart context and subagent isolation.** Check: Use an isolated CLAUDE_CONFIG_DIR and a fresh git clone with no dist/. Run `claude plugin validate . --strict`, then marketplace add and install, then `claude -p --plugin-dir <clone> --output-format stream-json '/pensmith'` on a fixture assignment. Assert the skill, MCP tool and hook counts, the MCP initialize/tools-list response, that gates stop and ask, and that no files are written outside .paper/. Add a `claude plugin eval` set that includes negative prompts (for example 'continue' typed in an unrelated coding repo). Do one manual interactive run as well.
- **[high] Prerequisites on a typical Tier-1 machine: the MCP server and hooks run as `node …` and need Node >=20.18.1 (undici 7.25), but Claude Code's native installer does not install Node. pandoc, TeX and Python/PyMuPDF are also undeclared external prerequisites. No slice tested a machine without them.** Check: In a clean VM or container with only the native Claude Code binary (no node on PATH), install the plugin and record the failure. Then decide between a single-file bundle with a documented Node requirement and a launcher that checks the version. Make doctor or SessionStart report missing node, pandoc and TeX before any paid step runs.
- **[high] The live LLM path has never run with a real key: no ANTHROPIC_API_KEY was available, so prompt adherence, structured-output validity, refusal and stop_reason behaviour on sensitive academic topics, thinking-token budgets, latency and real cost per paper are all unknown.** Check: After the transport fix, do a live run of the full bare loop on 3 fixture assignments (a humanities essay citing books, STEM with arXiv sources, medicine with PubMed sources) on claude-sonnet-5-5 and claude-opus-5-5, with a budget cap of about $10. Record tokens, cost and latency per verb, the schema-valid rate, and the stop_reason distribution, and reconcile COSTS.jsonl against provider usage.
- **[high] The verifier's effectiveness has never been measured end to end. Code reading found many escape and false-block paths, but no labelled corpus has gone through the real verify→compile→done pipeline against live registries, so the escape rate and false-FABRICATED rate are unknown.** Check: Build a labelled set of about 200 citations: correct ones; wrong year, journal or co-author; fabricated DOIs; DataCite/arXiv, PMID and ISBN works; retracted papers (e.g. Wakefield 1998); quotes with [@k, p. N], ellipses and meaning-reversing misquotes. Insert them into LLM-written sections, run them live, report per-class recall and precision, and gate releases on thresholds. Re-run weekly through the cassette-refresh workflow.
- **[high] Nothing was executed on Windows or macOS (the sandbox is Linux only). The 3-OS CI matrix exercises only in-process cassette code. It is never used to test install, hooks, PATH shims or real file-system behaviour.** Check: Run the post-fix install smoke test and the offline end-to-end loop on windows-latest and macos-latest, with HOME under a path containing a space and non-ASCII characters (e.g. 'C:\Users\José Núñez\OneDrive - Uni\Papers'), and hold a file handle open during STATE.json writes. Do one manual run on a real Windows laptop with Defender and OneDrive active. Also pull the latest CI logs with gh to see which tests skip on Windows.
- **[high] No product or policy review for publication. No slice checked the feature set against Anthropic's Usage Policy, the plugin directory's review criteria, or typical institutional AI policies. The features in question: end-to-end drafting, opt-in style-match to the student's past writing, the humanizer, display of a GPTZero score, and deliberately zero trace in exports.** Check: Map each feature to the current AUP's academic-dishonesty provisions and to the directory submission checklist, and record the owner's explicit decisions. Check that the PRD §3 disclaimer appears in the install or first-run path (skill output or SessionStart), not only in README. Read 3-5 university AI policies to calibrate the README wording.
- **[medium] The bundled citation styles are out of date and not fully valid, and the audit only skimmed their headers. MLA is the 8th edition (MLA 9 has been current since 2021); citation-js output shows the MLA-8 form 'doi:10.1/x.'. Chicago is the 17th edition (the 18th came out in 2024), Cite Them Right is the 10th edition, and the Vancouver file dates from 2016. apa.csl has a pensmith comment placed before the <?xml?> declaration, which makes it non-well-formed XML (python minidom: 'XML or text declaration not at start of entity'). pandoc and citation-js tolerate this; strict CSL tools do not.** Check: Golden-file test: a 15-entry CSL-JSON set (article, book, chapter, conference paper, preprint, web page, thesis; 1, 2, 3 and 21 authors; a corporate author; no date; name particles) rendered through pandoc and citation-js in every style. Diff the output against the current CSL repository styles rendered in Zotero. Validate each .csl against the CSL schema and move the APA comment after the XML declaration.
- **[medium] No slice looked at the accessibility of exported documents. The zero-trace patch blanks dc:title, removes the PDF XMP metadata, and pdflatex produces untagged PDFs. The DOCX language is hard-coded to en-US in styles.xml whatever language the paper is in.** Check: Export a fixture paper to DOCX and PDF. Run Word's Accessibility Checker, veraPDF --flavour ua1 and PAC. Check heading-style mapping, document language and title metadata. Then set a policy: keep the user-owned title and language, zero only the tool metadata, and consider a PDF engine that produces tagged output.
- **[medium] Zero-trace was checked by searching for strings only, with no forensic review of distinctive fingerprints. In a DOCX exported during the audit, core.xml has created/modified = 1970-01-01T00:00:00Z, and only the three docProps ZIP entries carry a 2098-01-01 timestamp (JSZip given new Date(0) underflows DOS time) while every other entry carries the real export time. <Application> is present but empty, AppVersion is 12.0000, and the file uses pandoc's default style set.** Check: Diff a pensmith export against the same markdown exported by plain pandoc and against a docx saved by Word. List every property, ZIP entry date or order, and blank-but-present field that only pensmith produces. Replace the sentinel values with what plain pandoc would produce (current time, or omit the field). Run exiftool and qpdf --show-xref on the PDFs as well.
- **[medium] Real PDF/DOCX export was tested only with pandoc 3.1.3 and pdflatex on Linux. Not tested: older or newer pandoc (--citeproc needs 2.11 or later, and docx-writer metadata behaviour, including the custom.xml leak, varies by version), machines with no TeX at all (the common case), xelatex or lualatex for Unicode, CJK, Greek and IPA text, MiKTeX prompts, and Windows pandoc paths.** Check: Run a matrix: pandoc {2.11, 3.1, latest} × engine {none, pdflatex, xelatex, lualatex, typst} × content {ASCII, accented, CJK, math}. Assert either a correct output or an explicit non-zero error, and run the trace scanner on every artifact.
- **[medium] Runaway spend and cost accuracy with real billing were never exercised. Router loops (failed or unverifiable sections sent back to verify forever, s2#4) combine with Pass 2 and Pass 4 billing on every verify. The budget gate throws on any real model ID (lead #5), so it either blocks everything or, once patched, has never been tested. Thinking tokens count as output under a fixed max_tokens of 4096.** Check: With a real key and a $2 session cap, drive bare `pensmith` on a section built to stay 'unverifiable'. Confirm the cap stops spending, COSTS.jsonl matches provider usage within 5%, and the pre-run estimate for a 5-section paper is within 2x of the actual cost.
- **[medium] Concurrent and multi-process use was reviewed only by reading code. Untested: the MCP server and the terminal CLI working on the same paper, two Claude sessions at once, wave writes at the default --max-parallel 5 (s4#20) all appending COSTS.jsonl and SESSION.log and rewriting STATE.json and CITATIONS.bib, global-library writes from different papers, and proper-lockfile's mkdir lock with a 45 s stale window on cloud-synced folders.** Check: Build a stress harness that spawns 8 concurrent verbs (write, verify, add, compile) on one paper, then check that every JSON, TOML and bib file parses and the state invariants hold. Repeat inside a OneDrive-synced folder on Windows and an iCloud Drive folder on macOS.
- **[low] Licensing and third-party terms were only skimmed. LICENSE was not read line by line, and .planning still claims MIT. The bundled CSL files are CC BY-SA 3.0, and apa.csl has been modified, but there is no NOTICE file or attribution in README/LICENSE. Committed cassettes contain third-party API responses (Semantic Scholar, GPTZero, DuckDuckGo HTML). Scraping DuckDuckGo may breach its terms.** Check: Run `npx license-checker --production --summary`. Add a NOTICE file covering the CSL styles and the data sources. Review the Semantic Scholar API licence, GPTZero's API terms and DuckDuckGo's terms on automated queries and redistribution. Replace cassette bodies with synthetic ones wherever the terms are unclear.
- **[low] Local retention of student data was not covered. PRIVACY.md's host list was audited (s1#11), but not what pensmith stores locally or for how long: SESSION.log prompt and response records, COSTS.jsonl, the XDG HTTP cache (full API responses and PDFs stored as text), and INTAKE.raw.local. There is no purge command, and no check that --pii-redact data never lands unredacted in logs or cache.** Check: Run one paper with --pii-redact and a planted name, email and student ID. Grep every file under .paper/, the XDG data and cache directories, and the Claude transcript for the planted values. Document retention, and add a purge verb if anything is found.
- **[low] Plugin upgrades were not tested. ${CLAUDE_PLUGIN_ROOT} changes with every version, and papers may hold absolute PKG_ROOT-derived paths (CSL files, templates). STATE and PLAN migrations were tested only in-process.** Check: Install version N from a local marketplace, create a paper and stop mid-way. Bump to N+1 and run resume, status and done. Also test a downgrade.
- **[low] Long papers were never timed. A thesis-length paper (30 sections, 150 sources, 40 quotes) has not been run, and the Pass 3 matcher takes about 34 s per quote (domain-expert#15).** Check: Run a synthetic 30-section offline fixture with 40 quotes. Time verify, compile and done and track peak memory against a target such as under 10 minutes.
- **[low] Two findings were never verified: prd-conformance#18 (README inaccuracies) and prd-conformance#19 (SessionStart emits a systemMessage the user sees, not context for Claude).** Check: Re-verify both against the current hooks spec and the CLI's --help output before rewriting README and the hooks.

## 7. Method

- **Coverage.** All 792 tracked files were assigned to 14 slices, and the assignment was checked to cover every file. 18 readers (8 code slices, 6 planning-history slices, plus PRD conformance, prompt audit, academic-domain expert and an end-to-end new-user run) read their files in full. Planning docs were cross-checked against current code. A gap-fill reader then fully read 20 test files that the first pass had only skimmed. The CSL style files and the license were checked by rendering and structure rather than line by line.
- **Verification.** Each finding went to a skeptic told to reproduce it by running code, defaulting to "not real". Critical and high findings got a second skeptic told to refute it, plus a tie-breaker where the two disagreed. A leniency auditor then re-verified a random sample of 10 medium and low findings; all 10 held, and 9 of 10 severities were right.
- **Live checks.** Claude Code's own `claude plugin validate`, an isolated marketplace install, the real CLI in temp workspaces, a handful of polite live calls to OpenAlex, Crossref, DataCite and arXiv, and real pandoc exports. Not run: live LLM calls (no key in this sandbox), Windows or macOS, and an interactive Claude Code session.
- **Design comparison.** Three architects with different briefs (Claude-native, shared-core, minimum-viable) designed from the PRD and current platform capabilities without reading your code. A judge then compared all three against the current implementation.

**Files in this folder:** `REPORT.md` (this file) · `ISSUES.md` (121 canonical issues + gap-fill addendum) · `JUDGE.md` (full comparison and plan) · `designs/*.md` (the three from-scratch designs) · `PROMPT-REWRITES.md` (proposed rewrites of the main skill, the drafter and the verify procedure). The raw per-finding evidence digest (~450 KB, with verifier votes) was kept out of the repo.
