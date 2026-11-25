# Pensmith: current implementation vs. a from-scratch build in the Opus 5.5 era (judge report)

Inputs read in full: `PRD.md`, `CLAUDE.md`, `CONTEXT.md`, `DIGEST.md` (18 slice maps, 283 confirmed findings: 37 critical and 55 high, with many duplicates across slices), and the three clean-sheet designs: `claude-native.md` (CN), `shared-core.md` (SC) and `minimum-viable.md` (MV). The designs were written without reading the code.

I also spot-checked the code myself. Each of these headline claims was confirmed against the current tree:
- `isOfflineMode()` returns `PENSMITH_NETWORK_TESTS !== '1'`.
- `anthropic.ts:222` reads `content[0]` and requires it to be text.
- `outline-author.md` asks for "YAML", but `outline-parse.ts` only parses a table.
- `intake.ts:521` writes `result.text`, which is the model's questions.
- `quote-extractor.ts:84` uses a bare-lowercase `[@key]` regex.
- `write.ts:220` sends `assignedSources: '[]'`, and `plan.ts:129` sends the "(no sources loaded yet…)" placeholder.
- The retraction adapter calls `api.labs.crossref.org`.
- `_taskRunner` is set only by a test seam.
- `plugin.json` declares `skills` as `{name,file}` objects, and `hooks.json` uses the invented `{schemaVersion, hooks:[{event,script}]}` shape.
- `claude-haiku-4` and `claude-sonnet-4` are the defaults.

---

## 0. Verdict

**No. The current implementation is not what I would build from scratch today, and it does not work as a product right now.** Its architecture is still closer to the right answer than 283 findings suggest, so the fix is a **hybrid rebuild**, not a rewrite.

**Where the owner's approach is right:** it is right on what matters most.
- Section-as-phase directories, with per-section `PLAN.md` status and draft hashes.
- A deterministic verifier: Pass 1 and Pass 3 block compile and export, and the LLM passes stay advisory.
- Single audited chokepoints for HTTP, DOI normalization, atomic writes and paths, enforced by lint.
- A pure router that never throws.
- A Kahn wave scheduler.
- State validated with zod, plus migrations.
- Locked honest-framing copy.

Three independent clean-sheet designs, written without seeing this code, arrived at the same skeleton. The current code also covers far more of the PRD than any fresh design: 16 verbs, the library, learning mode, sketch, PII, style-match, GPTZero consent and plagiarism. It also keeps the owner's deliberate choices, several of which the fresh designs push back on. **About 60% of the TypeScript is worth keeping.**

**What is broken is the integration layer, and the problems are at the root:**
- **The plugin cannot install.** The `skills` field is invalid, the hooks schema is invented, and `dist/` is gitignored.
- **Production silently replays test cassettes.** Research returns fixture papers. Pass 1 "verifies" against a substituted record, so a fabricated DOI can pass and a real one reads MIS-CITED. GPTZero shows a canned 82%.
- **Nobody gets past the outline.** The outline prompt asks for YAML that the parser cannot read. Intake saves the model's questions and throws the assignment away.
- **Tier 1's "no API key" promise is false.** The MCP tools run the CLI, which posts to the API with a key. That transport rejects every current-model response, and the default model ID is invalid.
- **The verifier has holes:**
  - Crossref-only resolution marks arXiv DOIs FABRICATED.
  - The retraction endpoint never worked.
  - Quotes with page locators are never checked.
  - Pass 2 always sees an empty abstract.
  - The drafter receives zero sources.
  - Export is not bound to the verified bytes.
  - DOCX files leak absolute paths.
- **Gates are passable in Claude Code only with `--yolo`**, and the error text suggests exactly that.
- **The tests didn't catch any of it.** 1,044 tests pass because they pin the broken formats and pre-seed state.

**Where the fresh designs are better:** on exactly those seams.
- Tier 1 generates in the user's session through restricted subagents. The engine never calls an LLM there.
- The step graph lives in code, and both tiers consume the same action stream.
- State is derived from content hashes, and export re-runs the deterministic checks on the exact bytes it ships.
- Models never write bibliographic facts. Every citation carries a verbatim span that code can check.
- Identifier resolution works across registries, and a network failure is UNRESOLVED, never FABRICATED.
- The plugin ships a committed bundle.
- The tests check behaviour.

**Recommendation:** a hybrid rebuild in seven shippable phases. Phase 1 is an installable, honest alpha.

---

## 1. Scorecard

Scores run from 1 to 10. The fresh-design scores rate **the design as specified**; none of them is built. Discount them by about 1–2 points for execution risk. The "current" score for time-to-credible-release means using the current repo as the starting point of the recommended hybrid.

| Dimension | Current | Claude-native | Shared-core | Min-viable | Note |
|---|---|---|---|---|---|
| Installability / publishability | **1** | 8 | 8 | 9 | Current: 4 stacked install blockers (invalid `skills`, invented `hooks.json`, flat colon-named skills, gitignored `dist/`). The root `.mcp.json` also loads as a project server with no `CLAUDE_PLUGIN_ROOT`. The repo ships 337 `.planning` files containing personal paths. CN puts the plugin at the repo root, with dev tooling in `dev/`. SC and MV use a clean `plugin/` payload with a committed bundle. |
| Tier-1 UX (single command, no API key) | **2** | 7 | 8 | 8 | Current: skills aren't discovered, generation needs an API key, and gates can only be passed with `--yolo`. CN's guard hook on every Read/Bash/Write in *every* session adds 40–70 ms per call. SC and MV guard only Write/Edit. |
| Citation integrity in practice | **2** | 9 | 9 | 9 | Current: cassettes are the production default; resolution is Crossref-only; retraction checking is dead; quote extraction is too narrow; Pass 3 can't read PDFs; export isn't hash-bound. The gate *design* is right. All three designs use a resolver chain, UNRESOLVED ≠ FABRICATED, and an export recompute. |
| Claim-support grounding | **1** | 9 | 9 | 9 | Current: the drafter gets `[]`, and Pass 2 judges against an empty abstract, so it can't return UNSUPPORTED. The designs use verbatim spans checked by code, an independent judge, downgrade-only guards and a repair loop. SC adds the Citations API in Tier 2. MV adds "models never author bibliographic facts". |
| Pipeline correctness | **2** | 8 | 8 | 9 | Current: the outline/YAML mismatch stops every user; intake loses the assignment; the router loops on failed or unverifiable sections; a stale DRAFT is exported after a redo; `--dry-run` overwrites drafts; refusals exit 0. MV has the fewest moving parts. |
| Tier-2 portability | **3** | 7 | 9 | 7 | Current: the `npm link` entry guard does nothing; endpoints are hard-coded to Anthropic and OpenAI; no Ollama; the transport breaks on current models. SC has native Anthropic + OpenAI-compatible providers and byte-identical packets. CN's Lane A is Claude-only. |
| Security / privacy | **4** | 8 | 8 | 8 | Current positives: SSRF guard, chokepoints, opt-in PII with a raw-text `.gitignore`, no telemetry. Negatives: absolute paths in DOCX `custom.xml`; the contact email goes to every host; the PyMuPDF fallback imports `fitz.py` from the cwd; MCP tools let the model set `yolo`; unfenced abstracts go to the evaluator; `PRIVACY.md` is incomplete; the developer's email is in the cassettes. |
| Maintainability / complexity | **3** | 5 | 6 | 8 | Current: 25.6k source LOC, 27k test LOC and 100k lines of `.planning`. There are three sources of truth for the section list, prose workflows that nothing executes, runtime hash-pinned prompts and a hand-rolled transport. CN is about 13k LOC with 12 agents, 5 hooks, an HMAC ledger and 2 lanes. SC is about 15–16.5k. MV is about 8–9k. |
| Test value | **3** | 8 | 8 | 9 | Current: the known-bad citation test hardcodes `actual:null`; there are tautological presence guards; tests skip when a feature is missing instead of failing; tests pin invalid formats. On the plus side, the router, state, lock, DOI-property and verdict-row tests are real. MV's mutation e2e ("every injected failure must block export") is the strongest gate. |
| Time to credible release | **5** | 3 | 3 | 6 | Hybrid from the current repo: about 6–9 weeks to directory quality (P1–P5). CN and SC rewrites: about 10–16 weeks. MV claims 6 weeks, but only by deferring features the owner chose to ship. |

---

## 2. What the current code genuinely gets right

| Area | Evidence (from slices / code) | Why it matters |
|---|---|---|
| Section-as-phase layout | `.paper/sections/<NN-slug>/{PLAN,DRAFT,VERIFICATION}.md`; status and `verified_against_draft_hash` (D-07) in PLAN frontmatter; compile staleness check | This is the load-bearing model, already built the way every fresh design prescribes |
| Deterministic gate separation | Pass 1/3 decide status; Pass 2/4 are advisory. For well-formed `[@key]` input, compile REFUSED and the done export gate both work (prd-conformance reproduced) | The right architecture. The defects are in data and calibration (domain-expert) |
| Chokepoints | `doi.ts` (property tests, linear regexes), `atomic-write.ts`, `paths.ts` (XDG/AppData/macOS plus sync-folder detection), `http.ts` (cache header allowlist, Retry-After cap, token buckets, SSRF preflight), all lint-enforced | A discipline the fresh designs only propose. It needs hardening, not replacement |
| Router | `resolveNextAction` is a pure function that never throws, with a corruption backstop | It becomes the table-driven `derive()` with little change |
| Scheduler | Kahn waves (after the #33 fix), semaphore | All three designs pick Kahn layering |
| Durability | proper-lockfile, zod loaders, a migrations loader (v1→v2 done) | The healthiest slice-2 pieces |
| Zero-trace (mostly) | `core.xml`/`app.xml` blanked, PDF scrub; 0 "pensmith" strings in docx/pdf/md/tex (prd-conformance) | Only `custom.xml` and the RIS leak need fixing |
| Honest framing | `references/honesty-framing.md` with a byte pin; no evasion claims anywhere | A non-negotiable that is already met in copy |
| Breadth | 16 verbs, global library with GC, learning-mode scaffold, sketch, PII opt-in, style-match (deterministic, with disclosure), GPTZero consent gate, revise-swap, 8 CSL styles, discipline presets | MV defers most of this. Rebuilding it costs weeks |
| Responsiveness | 28 of 37 prior audit findings fixed correctly | The team fixes what it is shown. The process missed integration, not care |
| Adversarial fixtures | known-bad citation/quote corpora, `pass2-adversarial.json` | Reusable once they run through the real path |

---

## 3. What is broken (deduplicated themes)

| # | Theme | Representative findings | Effect | Root cause |
|---|---|---|---|---|
| T1 | Packaging | s1#1, s2#3, e2e#2, s2#2, s1#7, prompt#10 | The plugin can't install or load. The npm-installed `pensmith` does nothing | Hand-written validator and tests pinned invented formats; `claude plugin validate` never ran |
| T2 | Cassettes are the production default | s8#1, s5#1, domain#4, s7#1, s3#1, s6#3, prd#1, p1–p6 (≥12 duplicates) | Research uses fixture papers; Pass 1 compares against a substituted record; fake GPTZero and plagiarism results | The test gate env var was repurposed as the product's live switch, and fallbacks substitute the first cassette item |
| T3 | Generative I/O contracts | e2e#1, s4#1, prompt#6/#7/#8, s4#2, p3#7 | 0 sections register; wave write crashes; intake loses the assignment | Free-text model output is saved verbatim and parsed by a different grammar than the prompt asked for. No structured outputs |
| T4 | Tier 1 has no real path | s1#2, s2#3, prompt#10, e2e#11, s7#8 | Skills point at non-existent commands; MCP tools call the API with a key and print to the JSON-RPC stdout; 3 MCP tools are no-ops | No decision was made about who generates in Tier 1. Prose workflows are never executed |
| T5 | LLM transport | s4#3/#4/#5/#16, prompt#4, p6#4/#5, s7#3 | Every current-model response is rejected; truncation is saved; a 30 s timeout; the price table throws on real IDs | Hand-rolled POST with positional parsing and invented model IDs |
| T6 | Verifier extraction drift | prompt#1, s5#3/#6, p1#2/#9/#10, p4#2, domain#3/#9/#10, s6#6, p6#8, prd#2 | Locator, uppercase and multi-cite quotes are never checked; bib entries vanish; GATE-04 is blind; raw DOIs bypass checks | Audit #2/#20 widened only Pass 1. Six regex families remain |
| T7 | Identifier resolution and retraction | e2e#7, s5#2/#9/#10/#11, domain#1/#5/#13/#14, prd#7, p2#2/#3, p3#2/#5, s7#5 | arXiv/DataCite DOIs are FABRICATED; outages read as FABRICATED; retracted papers pass; case-sensitive DOIs are MIS-CITED | Crossref-only; a fail-open, non-existent Labs endpoint; calibrated against synthetic cassettes |
| T8 | Pass 3 can't work | s5#4, domain#2/#15, p3#4/#11, s5#13 | PDF bytes are corrupted by UTF-8 decoding; Unpaywall returns 422 without an email; matching takes about 17–34 s per quote; one-word misquotes pass | Text-only cache path; O(n·m²) sliding Levenshtein; a 0.95 character-ratio threshold |
| T9 | Grounding (FEED) | s4#8, prompt#3/#9/#13/#14, domain#12, prd#15 | Drafts are uncited or cite invented keys; an empty draft is "verified"; Pass 2 can't return UNSUPPORTED | Sources were never wired to the planner, drafter or judge (v0.3.0 debt) |
| T10 | Export not bound to verified bytes | s2#1, s8#2, s5#8, s6#4/#14, prd#4, p1#3/#5 | A post-compile edit or a bib swap exports a fabricated citation; a redo exports a stale draft; FINAL.md makes a paper "done" forever | Freshness decided by file existence; no manifest |
| T11 | Gates in non-TTY | e2e#5, s4#7, prompt#5, prd#8, s3#7, s6#8, s6#15 | Tier 1 can only proceed with `--yolo`, which the error text suggests; done crashes or fails open | Interactive-prompt gates; no propose/approve split |
| T12 | Bibliographic data model | s3#3/#4/#10/#11/#12, domain#6/#7/#8/#11, s6#2/#5/#7, prd#3, p6#7 | `add` erases RETRACTED notes and DOI-less entries; citekeys reshuffle between runs; numeric styles all render `[1]`; no headings; the RIS leaks unverified entries | Lossy CSL↔candidate round-trips; per-entry rendering; BibTeX as the store |
| T13 | Trace leak | e2e#3, s6#1 | Absolute paths (username, plugin cache) in `docProps/custom.xml` | A blacklist scrub; tests used synthetic docx |
| T14 | State and router lifecycle | s2#4/#5/#6/#7/#8/#15, s5#12, p1#6, e2e#6/#9/#13/#14/#15, s4#6/#12 | Infinite verify loops; `--dry-run` destroys drafts; unknown verbs run work; `STATE.json`/`config.toml` clobber user files at the root; refusals exit 0 | Three sources for the section list; status semantics that don't match the docs; no exit-code contract |
| T15 | Hooks | s1#4/#5/#6, prompt#16, e2e#12, p4#4/#5/#6 | Hooks never fire; `systemMessage` never reaches the model; once fixed, they would write into unrelated repos | Invented schema; `.ts` scripts with no entry point |
| T16 | Humanizer, budget, doctor, show-prompts | s6#9, prd#9/#10, p6#9/#11, s4#10/#11, s7#12, e2e#17 | Humanize never runs; the cap is a lifetime $0.50 per scope; doctor PASSes the broken states; `--show-prompts` is a no-op | Test-only seams shipped as features |
| T17 | Tests that cannot fail | s8#4/#8/#9, s1#3/#10, s5#17, domain#19, p3#8, s6#18, e2e#18 | A green suite over a broken product | Tests are structural, use pre-seeded state, skip when a feature is missing, and are tautological. The tier-contract test runs the same code twice |

---

## 4. What the fresh designs agree on, and where they differ

**Convergence across all three designs. This is the strongest signal in the review.**

| Idea | CN | SC | MV | Current |
|---|---|---|---|---|
| Deterministic engine CLI on plugin `bin/` PATH, committed esbuild bundle, no install-time build | ✔ | ✔ | ✔ | ✘ (gitignored `dist/`, `.ts` bin) |
| Tier 1 generation in-session (subagents); engine makes no LLM calls in Tier 1 | ✔ | ✔ | ✔ | ✘ |
| One user-facing skill, `skills/pensmith/SKILL.md`; bare `/pensmith` needs a spike | ✔ | ✔ | ✔ | ✘ (flat, colon names) |
| Step graph / Action stream in code; both tiers consume it; tier contract = action-trace equality | ✔ | ✔ | ✔ | ✘ (prose bodies, tautological test) |
| State derived from content hashes; no stored "current step" | ✔ | ✔ | ✔ | partial (D-07 hash in PLAN) |
| Structured outputs; code renders OUTLINE and PLAN | ✔ | ✔ | ✔ | ✘ |
| Verbatim evidence spans checked by code; claim judge in a fresh context; downgrade-only post-checks; repair loop ≤2 rounds | ✔ | ✔ | ✔ | ✘ |
| Resolver chain (Crossref/DataCite/doi.org Handle/content negotiation; arXiv; E-utilities; ISBN); UNRESOLVED ≠ FABRICATED | ✔ | ✔ | ✔ | ✘ |
| Retraction from Crossref `updated-by` (+ OpenAlex/PubMed) | ✔ | ✔ | ✔ | ✘ (dead Labs endpoint) |
| Export recomputes deterministic passes on exact bytes; hash-bound gates; no `--force` | ✔ | ✔ | ✔ | ✘ |
| Gates recorded from real human input (hook or TTY); `--yolo` only if user-typed; never waives blocking verdicts | ✔ | ✔ | ✔ | ✘ |
| Local source-overlap plagiarism check | ✔ | ✔ | ✔ | ✘ |
| citeproc + CSL at export; pure-JS docx fallback; allowlist scrub + trace scanner | ✔ | ✔ | ✔ | partial |
| No PostToolUse checkpoint; SessionStart injects `additionalContext` | ✔ | ✔ | ✔ | ✘ |
| Live by default; cassettes only in tests | ✔ | ✔ | ✔ | ✘ |
| Judge gold-set eval with published precision | ✔ | ✔ | ✔ | ✘ |

**Divergence. These are the points where I had to pick.**

| Question | CN | SC | MV | My pick |
|---|---|---|---|---|
| MCP | none | narrow transport for subagent isolation, with CLI fallback | none | **None in v0.x** (owner decision). Isolation of effect is enforced at submit |
| Agents | 12 | 3 executors | 6 | **5** (source-evaluator, outliner, section-planner, section-writer, claim-judge) |
| Hooks | 5, incl. a guard on Read/Bash | 3, Write/Edit guard | 3, Write/Edit guard + AskUserQuestion capture | MV's three |
| Humanize | after compile, marker-locked, re-verify | same | per section *before* verify | **After compile, marker-locked, re-verify** (owner decision) |
| UNSUPPORTED | review item, ack; `--yolo` acks | waivable-blocking; `--yolo` never waives | blocking until per-claim ack; `--yolo` never acks | **SC/MV** (owner decision) |
| Tier 2 | Agent SDK lane + portable runner | in-process orchestrator, native SDK + OpenAI-compatible | same binary runner + adapters | **SC** |
| Scope | full PRD | most of PRD | defers style-match, GPTZero, PII, sketch, learning, smoothing, waves; replaces DDG | **Full scope, sequenced**: core first, breadth in P6. Honors CLAUDE.md choices |
| Gate integrity | HMAC-signed ledger | hash-bound records | hash-bound records with `method` | **Hash-bound with method.** HMAC is over-engineered against a user who owns the machine |
| Payload layout | repo root, deps in `dev/` | `plugin/` subdir | `plugin/` subdir | **`plugin/` subdir** (keeps `.planning`, tests and src out of installs) |

---

## 5. Recommended path: hybrid rebuild

**Fix-in-place is not enough.** About a third of the code embodies the wrong *contracts*, not just bugs:
- the Tier 1 generation path;
- LLM I/O without structured outputs;
- the hand-rolled transport;
- MCP, hooks and skills;
- gates bound to file existence;
- state split across three sources.

Patching each finding recreates the drift. Audits #2 and #20 widened one regex and left six siblings. The v0.3.0 roadmap (FEED/SEC/HARDEN) would bolt FEED onto these contracts. Its success criterion "tier-contract extended stays green" is a test that can't fail. It assumes `e2e-smoke` can be made strict, but that script cannot get past outline. It has no packaging phase.

**A full rewrite throws away good code.** It discards about 16k LOC of foundations, adapters and gate logic that every fresh design would re-implement almost identically: `doi`, `atomic-write`, `lock`, `paths`, the `http` chokepoint, the adapters, `scheduler`, `router`, `style-match`, `global-library`, `session-log`, `budget`, schemas and migrations, CSL and presets, and the export scrubbing. It would also delay a credible release by roughly 1.5–2×.

**Survival analysis** of the 25,613 source LOC in `bin/`, `mcp/` and `hooks/` (classification script in this directory):

| Class | LOC | Share | Contents |
|---|---|---|---|
| Keep (as-is or trivial fixes) | 3,151 | 12% | `doi`, `atomic-write`, `paths`, `scheduler`, `retry`, `style-match`, `consistency-scan`, `citation-density`, schemas, migrations, `list` |
| Adapt (keep the core, rework the edges) | 13,111 | 51% | `http`, `lock`, `frontmatter`, `citation-token`, `fuzzy` (JW part), `router`, `state`, `compile`, `exporter`, `honesty`, `plagiarism`, `pii`, `budget`, `session-log`, `global-library`, `library`, `research-orchestrator`, `write-orchestrator`, source adapters, `pass1`/`pass3`/`pass4`, verify/compile/research/status/doctor CLIs, `bibtex`/`ris` writers (become derived) |
| Replace | 7,047 | 28% | `anthropic.ts`, `runtime.ts`, `pricing.ts`, `http-mock.ts`, `outline-parse`, `intake-parse`, `quote-extractor`, `revise`/`revise-swap`, `pass2`, `verdict-rows`, `author-normalize`, `estimator`, `drafter-input`, intake/outline/plan/write/add/done/sketch CLIs, `session-start` hook |
| Drop | 1,811 | 7% | MCP server, resources and tools; pre-compact/post-tool-use/stop hooks; `checkpoint`/`handoff`; the `retraction-watch` Labs adapter; the `zotero-mcp` stub; `pymupdf-shellout` (deferred); `cli/revise.ts`; `stubs`; `cost-fixture` |

About **63% of source LOC survives in some form**. About 35–45% of the 27k test LOC survives: the real unit and property tests. The skip-when-missing guards, tautologies and format-pinning tests are deleted. The replaced and dropped code is concentrated in the integration layer.

---

## 6. Target architecture

```
repo (marketplace + dev workspace)
├─ .claude-plugin/marketplace.json  → plugins[0].source = "./plugin"
├─ src/  (TypeScript; most of today's bin/lib migrates here)   tests/  evals/  scripts/  .planning (archived)
└─ plugin/                         ← the only thing users install (no package-lock; no npm ci)
   ├─ .claude-plugin/plugin.json   name, version, displayName, icon, privacyPolicyUrl, userConfig{contact_email, gptzero_api_key(sensitive)}
   ├─ skills/pensmith/SKILL.md     conductor loop + <capability_check>; reference/<verb>.md (former workflows/)
   ├─ agents/{source-evaluator,outliner,section-planner,section-writer,claim-judge}.md   tools: Read, Write
   ├─ hooks/hooks.json → dist/hook.mjs   SessionStart(additionalContext) · PreToolUse guard-write · PostToolUse(AskUserQuestion) capture
   ├─ bin/pensmith (sh shim, +x, LF)  → dist/pensmith.mjs (esbuild, deps inlined; pdf.js lazy chunk)
   └─ assets/{prompts/*.md, csl/, presets/, honesty-framing.md}
```

**Engine.** `pensmith` owns `.paper/`. `derive(snapshot) → Action` is a pure function of artifacts and their content hashes.
- `OUTLINE.json` is the only section list.
- Each section folder holds PLAN, BUNDLE, DRAFT, anchors and `VERIFICATION.json`, all bound by sha.
- `STATE.json` and `config.toml` live inside `.paper/`.
- Plumbing: `next --json`, `submit <action> --from`, `gate show|answer`.
- Porcelain: the PRD verbs.
- Exit codes: 0 ok, 2 blocked by verifier, 3 approval needed.

**Generation.** One `Generator` contract: packet → validated output.
- **Tier 1:** a subagent writes to `.paper/work/`, and the engine validates on `submit`. The CLI refuses to generate inside Claude Code.
- **Tier 2:** the runner calls `@anthropic-ai/sdk` (fetch routed through the chokepoint, structured outputs, streaming, caching, refusal handling) or an OpenAI-compatible adapter (Ollama, vLLM).
- Both tiers use the same prompts, packets and validators.

**Sources.** `LIBRARY.json` (CSL-JSON) is canonical, with stable citekeys; BibTeX and RIS are derived from it. Adapters go through `http.ts` (live by default, proxy-aware, connect-time SSRF pinning). Full text is pinned and chunked, with page maps and BM25.

**Verifier.**

| Pass | Kind | Checks |
|---|---|---|
| Pass 0 | code | grammar, isolation, raw-citation detector |
| Pass 1 | code | resolver chain, metadata match, retraction |
| Pass 2 | code | anchors verbatim, numbers, local overlap |
| Pass 3 | code | quotes |
| Judge | model | claim support; post-checks can only downgrade |
| Pass 4 | model | orphan claims |

The output is `VERIFICATION.json`, validated with zod.

**Gates.** Two-phase (propose, then approve). Hash-bound. Recorded by the capture hook or the TTY. `--yolo` counts only if the user typed it, and it never acks integrity items.

**Compile and done.**
1. Deterministic assembly, then a manifest of hashes.
2. Audit.
3. Plagiarism check on DRAFT (local, then DDG).
4. Humanize on marker-locked text (the user's skill), then re-verify.
5. Plagiarism check on FINAL.
6. Honesty score (requires a key and consent).
7. Export: recompute Passes 0–3 on the bytes, render with document-level citeproc, build docx with pandoc or the pure-JS writer, apply the allowlist scrub, run the trace scanner.

**Tests.**
- unit and property tests;
- cassettes recorded from real APIs;
- a fixture-LLM journey e2e from bare `pensmith` to docx;
- a mutation e2e;
- the action-trace tier contract;
- `claude plugin validate --strict` and `plugin eval`;
- the judge gold set;
- a nightly live lane.

---

## 7. Keep / Replace / Drop

### Keep (specific modules and ideas)

| Item | Why |
|---|---|
| Section-as-phase `.paper/sections/<NN-slug>/` + PLAN frontmatter status + D-07 draft hash | The load-bearing model; already built; extend to hash-derived status |
| `bin/lib/doi.ts` + its fast-check property tests | Correct normalization chokepoint; becomes the identity key for LIBRARY |
| `bin/lib/atomic-write.ts` | Write-then-rename is sound. Add mode preservation and a Windows EPERM retry; skip the chmod test as root |
| `bin/lib/lock.ts` (proper-lockfile) | Keep. Add a run-level paper lock with a payload and an onCompromised handler |
| `bin/lib/paths.ts` | Cross-platform data dirs plus sync-folder detection; extend the provider list |
| `bin/lib/http.ts` chokepoint design + cache header allowlist + Retry-After cap + token buckets | Rebuild the internals as a composed undici dispatcher (proxy, `connect.lookup` SSRF, redirects, size caps) |
| `bin/lib/router.ts` pure never-throw function | Becomes the table-driven `derive()` |
| `bin/lib/scheduler.ts` Kahn waves | All designs choose Kahn. Make it status-aware |
| `bin/lib/citation-token.ts` (`extractCitedKeysForVerification`) | Becomes the single citation grammar used everywhere (parity-tested against the pandoc AST) |
| `fuzzy.ts` normalization + Jaro-Winkler | Reuse for metadata match. Replace `levenshteinSubstring` |
| zod schemas + migrations loader | Typed state with versioning from day one |
| Source adapters (OpenAlex, Crossref, arXiv, PubMed, S2, Unpaywall) + research-orchestrator fan-out/dedupe | Remove the offline branches; fix field mapping (abstract de-inversion, OA URL, `is_retracted`, structured names) |
| Verifier gate separation (deterministic block / LLM advisory) + compile refuse + staleness check | The right design; extend it to the manifest and `VERIFICATION.json` |
| `exporter.ts` scrubbing (core/app.xml, PDF) + pandoc path | Extend to the allowlist and `custom.xml`; add the trace scanner |
| `references/honesty-framing.md` + byte pin | Guards a non-negotiable |
| `style-match.ts` deterministic profile + README dual-use disclosure | Honest, private, matches the deliberate choice |
| `global-library.ts` registry with derived status + GC | Library mode works from any dir |
| `budget.ts` ledger append path, `session-log.ts` infrastructure | Sound infrastructure. Fix the cap semantics; emit prompt records |
| CSL files, `templates/presets/disciplines.json` | Data assets; reuse |
| Known-bad corpora, `pass2-adversarial.json`, PII raw-text `.gitignore` | Reusable once they run through the real path |

### Replace

| What | With | Why |
|---|---|---|
| `anthropic.ts` hand-rolled POST, `content[0]` parsing, `claude-haiku-4` default | `@anthropic-ai/sdk` with fetch routed through `http.ts`; streaming; text blocks read by type; `stop_reason` handling; current IDs | Rejects every current response; 30 s timeout; invalid model |
| `pricing.ts` invented IDs that throw | Dated price table keyed by provider name; unknown model → warn + conservative rate; per-paper aggregate cap | No real config works today |
| `http-mock.ts` production offline mode + first-item fallbacks | Cassettes only via a test-runner flag/MockAgent; `--offline`/`--dry-run` as an egress-refusing dispatcher | Fixture data reaches real papers |
| Flat `skills/*.md` with colon names + `skills:[{name,file}]` | `plugin/skills/pensmith/SKILL.md` (+ optional `disable-model-invocation` aliases) | Install aborts; skills not discovered |
| Invented `hooks.json` + `.ts` hooks without `main()` | Spec `hooks.json` → bundled `dist/hook.mjs`: SessionStart `additionalContext`, guard-write, AskUserQuestion capture | Hooks never fire |
| gitignored `dist/` built by tsc | Committed esbuild bundles + `bin/pensmith` shim; CI drift check | MCP/CLI cannot start from a git-clone install |
| MCP verbs in-process + prose workflow bodies as "Tier 1" | Skill-driven action loop: `pensmith next --json` → subagent/AskUserQuestion → `pensmith submit` | No working Tier 1 path; API key required; stdout corruption |
| intake saving the model's questions | Structured `INTAKE.json`/`PROJECT.md`: assignment verbatim + answered dimensions | Assignment lost; research searches question text |
| Outline YAML prompt vs table parser; `STATE.sections` append-only | Structured output (zod → JSON Schema), validated, rendered; `OUTLINE.json` is the single section list | 0 sections register; drift between three section lists |
| Planner/drafter free-text prompts with placeholder inputs | Structured plan; drafter bundle with only assigned sources; verbatim anchors checked at submit | FEED gap; uncited or invented keys |
| Pass 1 Crossref-only | Crossref → DataCite → doi.org Handle/content negotiation; arXiv API; E-utilities; ISBN | False FABRICATED for arXiv/DataCite; outages accuse authors |
| Labs retraction endpoint | Crossref `updated-by`/`update-to` + OpenAlex `is_retracted` + PubMed pubtype | Retraction checking is dead |
| `quote-extractor.ts` narrow regex | Shared citation grammar; quotes attributed to the nearest cluster; unattributed long quote = blocking | Fabricated locator quotes escape |
| `levenshteinSubstring` 0.95 char ratio | Normalized exact match + ellipsis segments + Sellers/Myers alignment + negation/number guard | 17–34 s per quote; meaning-flipping misquotes pass |
| Pass 2 on an empty abstract | Evidence spans from pinned text; structured verdict; downgrade-only post-checks; repair loop | Can never return UNSUPPORTED |
| `VERIFICATION.md` parsed by regex (`verdict-rows`) | `VERIFICATION.json` (zod) as source of truth; Markdown rendered from it | Punctuated keys or bold text bypass the gate |
| Export gate by file existence | Compile/export manifest; export recomputes Pass 0–3 over the exact bytes | Stale/edited drafts export fabricated keys |
| `regenerateBib` / `add` lossy round-trips | `LIBRARY.json` CSL-JSON canonical; filtered derivation to `.bib`/`.ris` | Data loss, erased RETRACTED notes, citekey drift |
| Per-entry offline citation renderer | Document-level citeproc (pandoc `--citeproc` for every format, or a citeproc-js cluster registry) | Every IEEE/Vancouver citation renders `[1]` |
| TTY-only gates telling the agent to use `--yolo` | Two-phase propose/approve; AskUserQuestion with capture hook in Tier 1 | Default-on gates are unreachable in Tier 1 |
| `runHumanizer` test-only TaskRunner | The skill invokes the user's humanizer on marker-locked text; the engine validates and re-verifies | Humanize never runs |
| `validate-plugin-manifest.cjs`, tautological tier-contract test, PASS=8 e2e-smoke | `claude plugin validate --strict`; action-trace equivalence; strict journey e2e | Green suite over a broken product |
| Per-scopeId lifetime $0.50 cap | Per-paper aggregate cap from `.paper/config.toml` with warn and confirm | Locks users out and fails to protect them |
| PII NAME-bigram redaction | Contact/ID classes by default; NAME opt-in with a confirm diff | Redacts the subject matter, misses real PII |

### Drop or defer

| What | Why |
|---|---|
| PostToolUse checkpoint hook, Stop hook (drop) | No consumer; engine state is durable; writes `.claude/` into unrelated repos |
| `HANDOFF.json` as separate state (drop; derive on demand) | Duplicates state that `derive()` computes; stale copy |
| MCP no-op tools and `yolo` in model-facing schemas (drop) | Let the model write verification state / bypass gates |
| `bin/cli/revise.ts` orphan, `stubs.ts` (drop) | Not registered; `plan --revise` is canonical |
| Runtime SHA-256 throw on prompt files (drop; keep a PR-time snapshot) | Adds friction to every model-migration prompt change and protects nothing |
| Skip-when-missing guards and tautological tests (drop) | Turn regressions into green skips |
| `cassette-refresh.yml` no-op (replace with a recorder + live drift job) | Fails weekly and records nothing |
| Per-query researcher subagents (drop) | Search is deterministic; engine fan-out |
| 19 PRD agents (collapse to 5) | Deterministic roles belong in code |
| `pyproject.toml` / Python tier (drop) | Node-only resolves PRD §17 |
| Zotero adapter (defer; import-file path later) | Dead code today; ecosystem nicety |
| Originality/Sapling backends, Message Batches, Agent SDK lane (defer) | Not on the integrity path |
| PyMuPDF fallback (defer; if kept, run with `-I` and a tmp cwd) | Code-exec vector via a planted `fitz.py` |
| LLM cross-section contradiction judge (defer; keep the terminology linter) | Advisory; after the core works |
| CN's HMAC ledger and Read/Bash guard hooks (don't adopt) | Over-engineering, and latency in every session |
| `.planning/` 100k lines (archive to a branch/docs/history; scrub personal paths) | Stale claims, privacy, install size |

---

## 8. Phased plan (Claude executes in this repo; each phase ships independently)

**Conventions:**
- Every PR lands failing-test-first.
- Exit criteria are behavioural: they run the real CLI or plugin, not grep checks.
- Effort is in Claude working days, with owner review per PR.

### Phase 1: Installable, honest core (v0.3.0-alpha)

**Goal.** Ship a plugin that installs from the owner's marketplace and a CLI that works via npm link. The whole pipeline (intake → research → outline → plan → write → verify → compile → done) runs on live sources: no fixture data, no false verdicts, no trace leaks. Docs say exactly what it does. In this phase Tier 1 still uses the Tier 2 generator and an `ANTHROPIC_API_KEY`, labelled as alpha; Phase 2 removes that.

Ordered PRs. 1.1 can ship alone in about 2 days.

1. **Integrity stopgap.**
   - Network is live by default. Cassettes load only when the test runner sets `PENSMITH_TEST_CASSETTES=1`, and the loader refuses otherwise.
   - Delete every "first cassette item" fallback.
   - `--dry-run`/`--offline` become an egress-refusing dispatcher, and their writes go only to `.paper/.dry-run/`.
   - Remove the canned GPTZero and DDG results.
   - Exit codes: 2 = blocked, 3 = approval needed.
   - Compile refuses `Status: failed`.
   - A draft with assigned sources and zero citations is never `verified`.
   - DOCX: drop `custom.xml`, run pandoc with a relative cwd, add a trace scanner.
   - Regenerate RIS from the verified key set.
   - Realpath-safe entry guard.
2. **Verifier holes.**
   - One citation grammar everywhere: quote extraction, bib regen, GATE-04, the verify guard, revise, verdict rows. The **HARDEN-03** differential test lands here.
   - Raw DOI/arXiv/author-year citations in prose → blocking UNPARSEABLE.
   - Resolver chain with a tri-state result (found/not_found/unavailable); unavailable → UNRESOLVED.
   - Normalized DOI equality; year ±1; particle-aware surnames; titles with markup stripped.
   - Retraction from Crossref `updated-by` + OpenAlex `is_retracted`; delete the Labs adapter.
   - Pass 3 fetches binary (bodyBytes, noCache, content-type check). Unpaywall gets an email or is skipped with a reason.
   - Quote matcher: normalized exact match + ellipsis segments + bounded alignment.
   - `revise remove` deletes the quotation itself.
   - `VERIFICATION.json` becomes the source of truth.
   - Compile manifest; export recomputes Pass 1/3 on the exact bytes.
   - `LIBRARY.json` is canonical CSL-JSON with stable citekeys. `add`, research and compile never round-trip it lossily.
3. **Transport.**
   - `@anthropic-ai/sdk` with fetch routed through `http.ts`; streaming; text blocks read by type; typed `max_tokens`/refusal errors; 429/529 retry.
   - Current model defaults: `claude-sonnet-5-5`, with `claude-opus-5-5` for the writer.
   - Price table keyed by provider name, with a warn-and-fallback path.
   - Per-paper aggregate cap.
   - All generation goes behind a `Generator` interface.
4. **Pipeline contracts + minimal FEED (FEED-01..05).**
   - Intake: assignment stored verbatim + structured answers. Questions asked with clack on a TTY; `--answers` otherwise.
   - Outline and plan via structured outputs, validated (slugs, DAG, counterargument rule, sources ⊆ library) and rendered.
   - `OUTLINE.json` is the single section list.
   - Outline sees the library; the planner sees mapped sources; the drafter sees only assigned sources (metadata + abstract), fenced. Real titles and word targets.
   - Table-driven router:
     - failed → `plan --revise`, naming the blocking keys;
     - unverifiable → ack;
     - compile/export freshness from manifest hashes;
     - `stub` and `planned` are distinct statuses.
   - Wave write skips verified sections.
   - Unknown verbs exit 2; `intake` becomes an alias.
   - `STATE.json` and `config.toml` move into `.paper/` with a migration.
   - Compile emits headings and the paper title.
5. **Gates.**
   - Two-phase propose/approve for research, outline, export and `add --remap`.
   - Non-TTY runs exit 3 with pending-decision JSON.
   - No error text suggests `--yolo`.
   - Export confirmation defaults to *no* and requires a strict y/n.
   - No model-settable `yolo`.
6. **Packaging.**
   - `plugin/` payload with a valid `plugin.json` (`displayName`, `icon`, `privacyPolicyUrl`, `userConfig.contact_email`).
   - `skills/pensmith/SKILL.md`: domain-qualified triggers; `allowed-tools: Bash(pensmith:*)`, AskUserQuestion; a `<capability_check>` block; per-verb references built from `workflows/`.
   - Spec `hooks.json` with one bundled SessionStart hook (`additionalContext`, no-op outside `.paper/`).
   - No MCP declaration and no root `.mcp.json`.
   - Committed esbuild bundles and a `bin/pensmith` shim; `engines.node >= 22`.
   - CI: `claude plugin validate --strict`, isolated marketplace install smoke, bundle drift check, Node 22/24 on 3 OSes.
   - Version `0.3.0-alpha.1`.
   - README and PRIVACY rewritten honestly, including a host table.

**Exit criteria:**
1. **Install.** `claude plugin validate plugin --strict` passes. An isolated `marketplace add` + `install` shows 1 skill, 1 hook and 0 errors. `pensmith --version` works through an npm-link symlink.
2. **Live by default.** No production code path can read `tests/fixtures`. With no env vars set, a novel topic returns live OpenAlex results, and an unknown DOI returns UNRESOLVED or null, never a substituted record.
3. **Verifier corpora through the real `verify` CLI:**
   - 10/10 fabricated DOIs → FABRICATED;
   - arXiv `10.48550` and Zenodo DOIs → OK;
   - 429/5xx cassettes → UNRESOLVED with 0 FABRICATED;
   - Wakefield 1998 → RETRACTED;
   - fabricated quotes in locator, uppercase-key and multi-cite form → NOT_FOUND.
4. **Journey test.** A journey test with a scripted fake generator runs bare `pensmith` from an empty dir containing `assignment.txt` to an exported `.docx`:
   - sections are registered from a prompt-compliant outline;
   - the assignment is preserved;
   - every key cited is in its section's `assigned_sources`;
   - a post-compile hand edit, or a bib-entry swap, makes export refuse with exit 2.
5. **Trace.** Running the trace scanner on real pandoc docx/pdf/tex/md output finds no "pensmith", no `$HOME`, no `.paper`, and no `custom.xml`.
6. **Exit codes and dry-run.** Every refusal exits non-zero. `--dry-run` leaves the `.paper/` hash snapshot unchanged.
7. **Live Tier 2 smoke** (secrets lane): one 2-section paper with `claude-sonnet-5-5`.

### Phase 2: No-key Tier 1 (engine action protocol)

**Goal.** Tier 1 generates in the user's Claude Code session. The CLI never calls an LLM inside Claude Code. Both tiers run the same action stream, which makes the two-tier requirement real.

**Scope:**
- `pensmith next --json` returns typed actions: run, agent, gate, ack, converse, stop. Each carries input/output paths and a nonce.
- `pensmith submit` runs the same validators the Tier 2 runner uses.
- 5 agents, with tools `Read, Write`, generated from the shared prompt templates.
- `.paper/work/` is the only model-writable area, enforced by the PreToolUse guard-write hook on `Write|Edit|MultiEdit|NotebookEdit`.
- Gates use AskUserQuestion with a ref code and are recorded by a PostToolUse capture hook. Spike first; the fallback is `model_attested`, shown in status.
- `--yolo` counts only if the user typed it.
- The CLI refuses generative porcelain when `CLAUDECODE=1`.
- `workflows/*.md` become `skills/pensmith/reference/*.md` (owner decision).
- SessionStart(compact) injects the next step.
- The tier-contract test is rewritten as action-trace equivalence: a Tier 1 simulator vs the Tier 2 runner.
- Bare `/pensmith` spike.
- `claude plugin eval` routing suite.

**Exit criteria:**
- Nightly headless `claude -p --plugin-dir plugin`, with no `ANTHROPIC_API_KEY`, completes intake → a verified section on a fixture project.
- `EGRESS.log` shows 0 calls to `api.anthropic.com` from the pensmith process in Tier 1.
- The action-trace equivalence test is green.
- Evals:
  - "continue" in a folder without `.paper/` doesn't trigger;
  - "just approve the outline for me" creates no gate record;
  - a model write under `.paper/` outside `work/` is denied.

**Effort:** L, about 8–10 days. **Depends on:** P1.

### Phase 3: Grounded drafting and real claim support (FEED completed, SEC-02 folded)

**Goal.** "Every citation supports its claim" becomes a mechanism.

**Scope:**
- **OA full-text acquisition** from OpenAlex `best_oa_location`, arXiv, Europe PMC JATS, and BYO PDFs (`new --pdfs`, `add <pdf>`). pdf.js runs in a worker thread that can be terminated (**SEC-02**). Includes an identity check, pinned normalized text, chunks with a page map, and BM25.
- **Planner** picks passages; the engine builds `BUNDLE.md` (mapped sources only, fenced, injection-scanned).
- **Writer** attaches verbatim anchors, checked at submit:
  - keys ⊆ the section mapping;
  - `cited_text` ⊂ a bundle passage;
  - quotes ⊂ their anchor;
  - raw-citation detector;
  - prose surname attribution.
- **Claim judge** runs in a fresh context: a subagent in Tier 1, SDK structured output in Tier 2. The Citations API is optional for the Tier 2 writer.
  - Downgrade-only post-checks: span substring, numbers, hedge wording.
  - Repair loop, at most 2 rounds.
  - Per-claim ack policy, per owner decision.
- **Orphan audit:** code finds candidates; the model may only dismiss them.
- **Quote policy:** QUOTE_UNVERIFIABLE for sources without text.
- **Local COPY check.**
- **Caching:** prompt caching of the section bundle across plan, write and judge.

**Exit criteria:**
- **Mutation e2e.** Each of these blocks export (100%): an unmapped key, a fabricated span, an altered quote, a changed number, a raw DOI, a wrong surname in prose, a judge SUPPORTED with a bogus span, an injected passage, 12 copied words.
- **Judge gold set** (≥150 items): SUPPORTED precision ≥ 0.95 and UNSUPPORTED+PARTIAL recall ≥ 0.85 on the default judge, published.
- **PDF timeout** test proves the worker is terminated.
- **Isolation:** a 2-section paper with disjoint sources shows 0 cross-section bleed.

**Effort:** XL, about 12–15 days. **Depends on:** P2. Tier 2 parts can start after P1.

### Phase 4: Done pipeline (humanize, plagiarism, honesty, export)

**Scope:**
- **Done order:**
  1. whole-paper deterministic audit;
  2. plagiarism check on DRAFT;
  3. humanize;
  4. re-verify;
  5. plagiarism check on FINAL;
  6. honesty score;
  7. acks;
  8. export confirmation;
  9. export.
- **Humanize.** The skill invokes the user's `humanizer` by name, on marker-locked text. The engine validates tokens, quotes, length and numbers; reverts failing paragraphs; and re-judges changed cited sentences. Tier 2 uses the humanizer's `SKILL.md` body as its prompt when present, otherwise skips with a note.
- **DDG plagiarism.** Detect status and challenge pages; send quoted verbatim phrases spread across the paper; ask for consent once. A blocked run reports "incomplete", never "clean".
- **GPTZero.** Key via `userConfig` (sensitive); consent once, defaulting to no; before and after scores with the locked framing; a note when no key is set.
- **Export:**
  - document-level citeproc for every format;
  - pure-JS docx fallback;
  - LaTeX `--standalone`;
  - docProps rebuilt from an allowlist;
  - PDF Info/XMP blanked;
  - zip timestamps normalized;
  - blocking trace scanner;
  - exported `.bib` without `last_verified` or `note`.
- **Optional boundary smoother** with frozen cited sentences.

**Exit criteria:**
- PRD §15 #1, #4 and #5 pass in CI, both with pandoc + TeX and without pandoc.
- IEEE numbering follows first appearance; Chicago notes-bibliography produces footnotes.
- A humanizer fixture that drops a marker or alters a quote is reverted.
- A DDG 202 challenge fixture yields "web check incomplete".

**Effort:** L, about 7–9 days. **Depends on:** P3.

### Phase 5: HARDEN + SEC-01 (v0.3.0 Phases 18/19 folded)

**Scope:**
- **HARDEN-01:** a strict journey e2e, required on 3 OSes. It runs bare `pensmith` with LLM cassettes keyed by packet hash and asserts every router transition.
- **Resilience tests:** kill-and-resume fault injection (PRD §15 #12); redo-isolation hash test (#11); pandoc-parity property tests.
- **HARDEN-02/04 nightly live lane:** Crossref, DataCite, doi.org, arXiv and PubMed; a retracted DOI; a real pandoc export; the Tier 2 provider.
- **Cassettes:** re-recorded from real APIs, with mailto scrubbed.
- **`http.ts` as a composed undici dispatcher:**
  - `EnvHttpProxyAgent`;
  - SSRF validation at connect time via `connect.lookup` (**SEC-01**);
  - redirect interceptor with a check on every hop;
  - response size caps and total deadlines;
  - method-aware retry;
  - mailto sent only to scholarly APIs.
- **Test hygiene:** delete the skip-when-missing guards and tautologies; CI fails on any unexpected skip; close the lint gaps.
- **`claude plugin eval` behaviour suite:** bypass attempts, injection, and framing ("make it undetectable").

**Exit criteria:**
- Everything above is required and green.
- A test shows the validated IP equals the dialed IP.
- Skip count equals the allowlist.
- Seeded regressions (a router loop, a stale export) fail CI.

**Effort:** M–L, about 6–8 days. **Depends on:** P1. Journey parts depend on P3/P4.

### Phase 6: Breadth restore

**Scope:**
- **Library:** `list --class`, class asked at intake, `open` prints the path or a cd hint.
- **Learning mode:** tutorial generated by the model from LIBRARY.
- **Sketch:** a Tier-1 Socratic reference procedure plus `new --thesis`.
- **Style-match** profile fed into bundles.
- **PII** narrowed to contact/ID data, with a confirm diff.
- **Doctor** per §7.21:
  - live probes;
  - `/v1/models` check of key and model;
  - data-dir write test and disk space;
  - network mode and proxy;
  - Node version;
  - humanizer and pandoc detection.
- **`--estimate`** via token counting.
- **`--show-prompts`** at the chokepoint.
- **Inline corrections:** length retarget; insert or drop a section with stable ids; remap a source.
- **OpenAI-compatible provider + Ollama e2e** (sets `num_ctx`).
- **Tier 1 parallel waves:** Kahn layering, cap 3.

**Exit criteria:**
- PRD §15 #6, #7 and #9 pass. #7 is an Ollama run with the deterministic guarantees intact.
- Each correction op changes only the expected directories.
- doctor FAILs when Node is missing or the stack is misconfigured.

**Effort:** L, about 7–9 days. **Depends on:** P2; P3 for style-match bundles.

### Phase 7: Publish v1.0

**Scope:**
- Scrub personal paths and emails from tracked files: cassettes, tests, `.planning`, `AUDIT-FINDINGS`.
- Archive `.planning`.
- README generated from the verb registry. It includes the PRD §3 disclaimer, a section on what is deterministic and what is model-judged, and the judge metrics.
- PRIVACY host table; SECURITY threat model.
- Icon.
- Release script: single version source, tag, `npm publish --provenance`, GitHub release.
- Anthropic directory submission.

**Exit criteria:**
- A fresh-machine marketplace install passes `doctor` on macOS, Linux and Windows.
- `npm i -g pensmith` and `npx pensmith --version` work.
- 0 matches for personal-path or email patterns in the plugin payload and the npm tarball.
- Directory submission filed.

**Effort:** S–M, about 3–4 days. **Depends on:** P4, P5.

**Total.** About 55–70 Claude working days. A directory-quality release comes after P5, about 6–9 weeks of elapsed work with review.

### Where the v0.3.0 roadmap lands

| v0.3.0 req | Lands in | Note |
|---|---|---|
| FEED-01..05 | P1.4 (minimal: real sources, fenced, isolation by construction) + P3 (passages, anchors, judge) | The roadmap's "tier-contract stays green" criterion becomes action-trace equivalence (P2) |
| SEC-01 DNS-rebind pinning | P5 (as undici `connect.lookup` in a composed dispatcher, plus proxy and redirect hygiene) | Same intent, supported primitive |
| SEC-02 PDF worker abort | P3 (needed as soon as OA PDFs are fetched for grounding) | |
| HARDEN-01 strict e2e | Seeded in P1 (journey test), made required in P5 | e2e-smoke as written cannot pass outline; replaced |
| HARDEN-02/04 live lane | P5 (a small live smoke already in P1) | |
| HARDEN-03 citation-integrity differential | P1.2 | Cheap; it guards the single-extractor refactor |
| (missing) packaging | P1.6 | The roadmap had no phase for the release blocker |

### Critical findings → phase

| Critical theme | Phase |
|---|---|
| Install blockers / npm symlink entry (s1#1, e2e#2, s2#2, s2#3) | P1.6, P1.1 |
| Cassette production default (≈12 slices) | P1.1 |
| Outline YAML vs table; intake loses assignment (e2e#1, s4#1, s3#2, prd#5) | P1.4 |
| DOCX `custom.xml` path leak (e2e#3, s6#1) | P1.1 (allowlist in P4) |
| Stale export / not hash-bound (s2#1) | P1.2 + P1.4 |
| Quote extractor + revise laundering (prompt#1, #2, s5#3, p1#2, p4#2) | P1.2 |
| Retraction dead (s5#2, domain#1, p3#2, p6#2) | P1.2 |
| Pass 3 cannot read PDFs (s5#4, domain#2) | P1.2 (grounded text in P3) |
| Empty-bib shortcut (p1#10) | P1.2 |
| `--dry-run` data loss (p6#3) | P1.1 |

---

## 9. Owner decisions

| # | Question | Options | Recommendation | Why |
|---|---|---|---|---|
| 1 | Replace the `<capability_check>` workflow-body files with an engine step graph? (touches the CLAUDE.md two-tier wording) | A keep prose workflows as the shared source; B step graph in code + shared prompt templates + one SKILL.md with `<capability_check>` + per-verb reference procedures; C B, keeping `workflows/` as docs only | **B** | Today neither tier reads the workflows. Prose interpreted by an LLM and by JS can't be proven equivalent. B keeps the intent (one source, both tiers, graceful degradation) and makes it testable as action traces |
| 2 | MCP server keep or drop | A drop for v0.x (CLI on PATH); B a narrow typed surface (read-only resources + `task_get`/`task_submit` for subagent isolation); C fix the current server | **A**, revisit B if Desktop/Cowork without Bash becomes a target | It fails to start today, corrupts stdout, has no-op tools and a model-settable `yolo`. Two of three designs drop it. Isolation of effect is enforced at submit |
| 3 | Tier 2 provider scope | A Anthropic only; B native Anthropic SDK + OpenAI-compatible base_url (OpenAI, Ollama, vLLM, llama.cpp); C B + Claude Agent SDK lane | **B** (C deferred) | PRD §15 #7 needs Ollama. Anthropic is not OpenAI-compatible for structured outputs, citations or refusals. The Agent SDK is Claude-only, heavy and not OSI-licensed |
| 4 | Stricter blocking of UNSUPPORTED/PARTIAL/UNCLEAR | A PRD letter: advisory, shown at export confirmation, `--yolo` skips; B repair ≤2 rounds, then a per-claim ack bound to the claim hash before export; `--yolo` never acks (halts with a report); C B but `--yolo` may ack (logged) | **B** | Turns "flags unsupported claims for human review" into a mechanism. Compile stays allowed; the hard-blocking list is unchanged |
| 5 | Humanize ordering vs verification | A after compile, marker-locked, deterministic re-verify + re-judge changed cited sentences + per-sentence revert; B per section before verify; C after verify, unprotected (PRD letter) | **A** | Keeps the §5.3 folded UX and `--raw`, and the humanizer sees the whole paper. Hash-bound export makes it safe. C silently invalidates verification |
| 6 | GPTZero honesty score | A default-on as in the PRD; B on when the user configured a key + one-time consent, otherwise "skipped: no key"; C defer | **B** | The API needs a key and receives the full paper. The framing non-negotiable is unchanged, and cached or fixture numbers are never shown |
| 7 | Plagiarism (deliberate choice: free-only DuckDuckGo) | A DDG only, fixed; B local source-overlap primary + DDG best-effort with consent; C local + Claude Code WebSearch instead of DDG | **B** | Honors free-only and DDG. The realistic risk is copying the supplied (often paywalled) sources, which a web search can't see. DDG bot-blocks and its ToS discourage scraping: report "incomplete", never "clean" |
| 8 | Retraction policy (PRD says warning; code says MIS-CITED) | A block as MIS-CITED; B distinct RETRACTED verdict, blocking unless a per-citation ack (e.g. the paper discusses the retraction); C warning only | **B** | Never silently cites retracted work, while allowing legitimate discussion of it |
| 9 | Citing sources without accessible text (paywalled, books) | A allow, mark unverifiable; B quotes only from sources with text (else QUOTE_UNVERIFIABLE, blocking unless the user supplies the PDF or attests); abstract-level claims allowed and labelled; C no citation without text (MV) | **B** | C makes humanities books uncitable without the user's copy. A lets fabricated paywalled quotes escape |
| 10 | How Tier 1 records approvals | A model-attested `pensmith gate approve`; B AskUserQuestion answer captured by a PostToolUse hook with a ref code (fallback A, shown visibly); C typed reply phrase via UserPromptSubmit | **B with A fallback** | Approval gates default-on is a non-negotiable; the model must not approve for the user. Needs a spike on the hook payload |
| 11 | If bare `/pensmith` doesn't resolve for a plugin skill | A plugin-root single-SKILL.md layout; B teach `/pensmith:pensmith` + natural language; C NL first, namespaced form in README | **Spike first**; if it fails, **C** | Touches the single-command non-negotiable. NL routing is the real zero-memory UX either way |
| 12 | Process: GSD phases vs direct PRs | A continue with GSD (`/gsd:plan-phase`…); B direct small PRs executed by Claude against this plan with behavioural exit gates; C GSD for planning docs, PRs for execution | **B**. If staying on GSD, require its verify-work to run the journey e2e + `plugin validate` instead of grep gates | GSD artefacts recorded PASS on broken things (manifests valid, hooks wired, verifier blocks, known-bad 10/10). That is 100k lines of process for 25k of code. CLAUDE.md currently mandates GSD, so this is the owner's call |
| 13 | Distribution targets and timing | A own GitHub marketplace only; B own marketplace (alpha from P1) → npm (from P2/P3) → Anthropic directory (after P5); C directory now | **B** | The directory needs an icon, privacy URL, `validate --strict`, and will scrutinize the integrity framing. The npm entry bug must be fixed first |
| 14 | Does `.planning/` (and tests/src) ship inside the plugin? | A as today (git-clone installs carry 337 `.planning` files, tests, fixtures); B `plugin/` payload subdir, scrub personal paths; C B + archive `.planning` to a branch | **C** | Privacy (Windows user paths and institution names; developer email in cassettes), install size, and stale claims that mislead readers |
| 15 | Timing of deliberate breadth features (style-match, learning, sketch, PII, Zotero) | A all in the first credible release; B core first (P1–P5), breadth in P6, style-match stays shipped, Zotero deferred; C drop | **B** | CLAUDE.md says style-match IS shipped, so keep it. Breadth must not delay integrity |

---

## 10. PRD edits

| PRD § | Change |
|---|---|
| §1, §5.1, §5.5 | Plugin skills are namespaced `/<plugin>:<skill>`, and colon names are invalid. Primary UX: the `pensmith` skill (natural language) plus the slash form proven by eval. The "hidden namespace" becomes the CLI (`pensmith plan 3`) or `disable-model-invocation` alias skills |
| §1 Tier 1 | Define it: in Tier 1 the session model and plugin subagents generate. The engine/CLI is deterministic and makes no LLM calls; no API key |
| §1 Tier 2, §10 [runtime] | Native Anthropic via `@anthropic-ai/sdk` plus an OpenAI-compatible adapter with base_url (OpenAI, Ollama, vLLM, llama.cpp). Role-based defaults (`claude-sonnet-5-5`, writer `claude-opus-5-5`); per-role overrides; model validated by doctor |
| §1, §14 two-tier source of truth | Per decision 1: shared truth = engine step graph + prompt templates + SKILL.md procedures; `<capability_check>` lives in SKILL.md; the tier contract compares action traces |
| §7.1 | Persist the assignment verbatim; auto-detect `assignment.*`; record answers as structured fields. PII caveat: in Tier 1, `@file` content is already in the model's context; pass a path so the engine redacts. NAME redaction is opt-in |
| §7.2 | Search fan-out runs in the engine; models generate queries and score relevance (no per-query subagents). §13: about 5 agents, not 19 |
| §7.7 Pass 1 | Resolve by registry (Crossref → DataCite → doi.org Handle/content negotiation; arXiv API; E-utilities; ISBN). FABRICATED only on a definitive not-found; transport failure → UNRESOLVED (blocking, retry). Compare year ±1 and the author set |
| §7.7 citation grammar | Drafts cite only through Pandoc `[@key]` clusters. Any other citation-like construct is a blocking UNPARSEABLE/RAW_CITATION |
| §7.7 Pass 2 | Evidence spans must be verbatim in the cited source's pinned text. The judge runs in a fresh context; code may only downgrade verdicts. Ack policy per decision 4 |
| §7.7 Pass 3, §9 | Quotes only from sources with text; QUOTE_UNVERIFIABLE otherwise. Handle ellipses and brackets; verify page locators. §9: BYO passages *are* sent to the LLM when used (correct "PDF contents stay local") |
| §7.8 | Smoothing freezes cited sentences; a boundary diff is validated. Only a heuristic terminology linter is required; the contradiction judge is advisory |
| §7.9, §7.10 | Humanize on marker-locked text with re-verification (decision 5). Export binds to the FINAL hash. Remove `--no-verify` from the export path. Pure-JS docx so `.docx` works without pandoc |
| §7.9, §14 zero trace | Scope it precisely: no pensmith strings, user paths, custom props or invisible characters; not "forensically indistinguishable from Word". `last_verified` stays out of the exported `.bib` |
| §7.11 | GPTZero needs a key; consent first; never show cached, fixture or estimated numbers; say when it was skipped |
| §7.12 | Retraction from Crossref `updated-by`/OpenAlex/PubMed; a RETRACTED verdict with ack (decision 8). Remove the `api.labs.crossref.org` reference from §12 |
| §7.17 | Add the local source-overlap check (primary). Run on DRAFT and FINAL. A blocked or challenged DDG check is "incomplete", never "clean" |
| §7.19 | The cost cap is a per-paper aggregate for Tier-2 billed calls with a confirm-to-continue; in Tier 1 it is a work budget shown as estimated API-equivalent dollars. `--dry-run` = no pensmith-initiated egress, outputs labelled, real artifacts never overwritten |
| §7.20 | `--yolo` counts only when user-originated; it never waives blocking or integrity items; the research gate is also skippable |
| §5.1, §7.14 | SessionStart injects context and cannot force a skill to run. Drop the PostToolUse checkpoint; HANDOFF is derived |
| §6 | `open <name>` sets a pointer and prints the path/cd hint; a plugin can't change the session's cwd |
| §10, §13 layout | `.paper/STATE.json` and `.paper/config.toml` (schema_version) inside `.paper/`. Mark which §10 keys v0.x actually reads |
| §12 | Contact email is opt-in and sent only to scholarly APIs. Unpaywall requires it. arXiv over https at 1 request per 3 s |
| §13, §19 build | The plugin ships committed runnable bundles in a `plugin/` payload directory; no install-time build. CI runs `claude plugin validate --strict` and a clean-clone install smoke. Drop `pyproject.toml` (Node-only) |
| §14 cassettes | Cassette replay is test-harness-only and must never be reachable from a production invocation |
| §14, §15 #10 | Tier contract = action-trace equivalence + plugin validate + headless plugin eval. Not "outputs equivalent modulo prose" |
| §15 #7 | "Same deterministic guarantees; claim-support quality depends on the judge model, which is recorded in VERIFICATION." |
| §17 | Mark as resolved: MCP (none in v0.x), PDF (pdf.js in a worker), citation styles (CSL + citeproc), style-match (stylometrics + one voice note), library (pointer index + lazy status), dependency syntax (`depends_on` list), waves (Kahn, cap 3), renumbering (stable ids with letter suffixes), Tier 2 language (Node only) |
| §19 | Process per decision 12. If GSD stays, verify-work must run behavioural gates |

---

## 11. Risks and spikes (week 1 of Phase 2, some in P1)

- **S1.** Does bare `/pensmith` resolve for `skills/pensmith/` in plugin `pensmith`? (Decision 11.)
- **S2.** Does the PostToolUse(AskUserQuestion) payload expose the chosen answer? (Decision 10.)
- **S3.** Is the subagent tool named `Agent` or `Task`? Does `allowed-tools: Bash(pensmith:*)` suppress prompts? Do agent `tools` restrictions hold?
- **S4.** Does `marketplace.json` `source: "./plugin"` copy only the subdirectory into the cache? (Assumed by SC and MV; verify with an isolated install.)
- **S5.** How do `userConfig` values reach hooks and the CLI (env var or substitution)? Is `sensitive` storage supported?
- **S6.** The exact shape of Crossref `updated-by`; GPTZero API key terms.
- **Node prerequisite.** Users of the native Claude Code installer may lack Node. The shim and doctor must say so first; standalone binaries are a later option.
- **Refusals.** Opus 5.5 classifiers can trip on biology and chemistry topics. Handle `stop_reason: "refusal"` explicitly and allow a configurable fallback model.
