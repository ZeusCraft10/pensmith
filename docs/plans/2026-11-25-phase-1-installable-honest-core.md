# Phase 1 — Installable, honest core (v0.3.0-alpha) — Implementation Plan

> **For agentic workers:** execute task-by-task (subagent-driven: one implementer per task, then a task review, then a bounded fix loop). Each task is test-first: write the failing regression test, watch it fail, fix, watch it pass.

**Goal:** A plugin that installs from the owner's marketplace and a CLI that works through `npm link`. The full pipeline (intake through done) runs on live sources with no fixture data, no false verdicts and no trace leaks, and the docs say exactly what it does. In Phase 1, Tier-1 generation still goes through the Tier-2 generator and an API key, and is labelled alpha. Phase 2 removes the key requirement.

**Spec:** `docs/audit/2026-11-24/REPORT.md` §3 Phase 1, with `docs/audit/2026-11-24/JUDGE.md` for rationale and `docs/audit/2026-11-24/ISSUES.md` for the canonical issues. Each task below lists the issue keys it closes; the ISSUES.md row for a key is that task's detailed requirement. Raw evidence for every member finding is in the audit digest at `/tmp/claude-0/-home-user-pensmith/d215d403-59ed-5fd5-8322-103c08c7e93a/scratchpad/VERIFIED-FINDINGS-DIGEST.md`, if present (search for the finding id, e.g. `s5-verifier#4`).

## Owner decisions (2026-11-25) — binding

1. **Path:** hybrid rebuild. Keep the deterministic core, replace the integration layer. This document is Phase 1 of 7.
2. **Tier 1:** action stream (`pensmith next --json`) consumed by a plugin skill plus subagents, which is Phase 2. **No MCP server in v0.x**: it is removed in this phase (T14). The workflow bodies + `<capability_check>` are replaced in Phase 2 by the engine step graph plus `skills/pensmith/reference/*.md`.
3. **Process:** direct commits from this plan, no GSD. Practices: TDD, task review, verification before completion. `.planning/` is frozen history; do not edit it.
4. **Claim support:** auto-repair up to 2 rounds, then a per-claim acknowledgement bound to the claim's text hash blocks export. Compile stays allowed, and `--yolo` can never waive it. This lands in Phase 3; Phase 1 must not foreclose it.

Defaults (the owner may revise these later):
- GPTZero runs only with a configured key, after one-time consent that defaults to no.
- Plagiarism: a local source-overlap check first, DuckDuckGo best-effort, and a blocked check reports "incomplete", never "clean".
- RETRACTED is a distinct blocking verdict that can be acknowledged.
- Direct quotes only from sources with accessible text (Phase 3).
- Approvals are captured from real user answers (Phase 2).
- Distribution order: own marketplace, then npm, then the Anthropic directory.
- `.planning/` is archived in Phase 7.

## Global Constraints (every task)

- **Non-negotiables (CLAUDE.md):**
  - section-as-phase isolation;
  - the verifier blocks compile AND export;
  - no pensmith trace in exported documents;
  - honest detection framing;
  - approval gates default-on (only a user-typed `--yolo` skips outline approval and export confirmation, and `--yolo` never waives integrity verdicts).
- **Chokepoints stay:**
  - all HTTP through `bin/lib/http.ts`;
  - DOI normalization through `bin/lib/doi.ts`;
  - state writes through `bin/lib/atomic-write.ts`;
  - paths through `bin/lib/paths.ts`.
  - The ESLint chokepoint rules must keep passing. Add rules rather than disabling them.
- **Network mode contract:**
  - Production is live by default.
  - Cassette replay happens only when `PENSMITH_TEST_CASSETTES=1`, which only the test runner sets.
  - A cassette miss returns `null` or not-found. It never substitutes another record.
  - `--offline` / `--dry-run` make `http.ts` refuse all egress with a typed error. Callers then report `skipped (offline)`. Verification under offline yields `UNRESOLVED`, never `OK` and never `FABRICATED`.
- **Exit codes:** 0 ok · 1 unexpected error · 2 blocked or refused (verifier, gate refusal, unknown verb, invalid input) · 3 approval or answers needed (non-TTY pending decision). Every refusal is non-zero.
- **Verdicts:**
  - Blocking: `FABRICATED`, `MIS-CITED`, `NOT_FOUND` (quote), `RETRACTED` (unless acknowledged), `UNRESOLVED` (registry unreachable; retry), `RAW_CITATION` / `UNPARSEABLE`.
  - Advisory: Pass 2 and Pass 4 (until Phase 3).
  - `UNVERIFIABLE` (no OA text for a quote) does not block in Phase 1, but must surface loudly.
  - `UNATTRIBUTED` (a quotation of ten or more words with no citation) does not block in Phase 1 either: it may be the author's own data or an epigraph, which no source can confirm. The section is `unverifiable`, verify, compile and done each warn, and GATE-04 blocks a quotation the humanizer separated from its citation or reworded. Owner to rule whether it should block, with a per-quote acknowledgement (as for claim support and RETRACTED) as the way out.
- **Tests:**
  - Write a failing regression test first, from the ISSUES.md failure scenario.
  - Prefer behavioural tests that drive the real CLI or real functions over structure or hash pins.
  - Never weaken a correct existing test. If an existing test pins the wrong behaviour, fix it and say so in the report.
  - No new skip-when-missing guards.
  - Run tests with isolated global state: `export HOME=$(mktemp -d) XDG_DATA_HOME=$(mktemp -d) XDG_CONFIG_HOME=$(mktemp -d) XDG_CACHE_HOME=$(mktemp -d) LOCALAPPDATA=$(mktemp -d)`. T15 makes the runner do this itself.
  - `tests/atomic-write.test.ts`'s chmod test fails only as root (environmental); T15 fixes it.
- **Before every commit:** `npm run check` (isolated env) must be green. It runs prebuild, lint, typecheck, build, `npm run bundle` and the tests. A change to the CLI or its runtime assets also needs `node scripts/plugin-smoke.mjs` green.
- **Dependencies:** no new runtime dependencies unless the task names them. Allowed new dev dependency: `esbuild` (T14). `@anthropic-ai/sdk` and `undici` are already present.
- **Model IDs:** model IDs appear only as functional configuration values. Never add comments or prose stating which AI model wrote the code.
- **Commits:** small, imperative conventional-commit subjects (`fix(verify): …`). Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HhSkxqB7QtgUKSpvttjKii
  ```
  Commit only on the current branch `akhil/intelligent-franklin-vvn8rx`. Never push; the controller pushes after verification.
- **Comments:** write comments that explain *why* in plain words. Do not add decision IDs, plan numbers or reviewer names to new comments. When you touch a comment full of process history, trim it.

## Tasks

Order: T01 → T13 and T15 run sequentially on the branch, with the controller follow-ups A2F (after T09) and A3F (after T13). T14 (packaging) runs in a parallel worktree and is merged before T15.

### T01 — Live network by default; cassettes are test-only
**Issues:** `cassette-replay-production-default`, `http-ignores-proxy-env`, `cassette-committed-personal-email`
- Change `isOfflineMode()` semantics:
  - `PENSMITH_TEST_CASSETTES=1` → cassette replay;
  - `--offline` / `--dry-run` / `PENSMITH_OFFLINE=1` → egress refused;
  - otherwise → live.
  - Make `scripts/run-tests.mjs` and the test helpers set `PENSMITH_TEST_CASSETTES=1`.
  - Keep `PENSMITH_NETWORK_TESTS=1` as the opt-in for live test lanes.
- Delete every first-record or arbitrary-record fallback in the source adapters (`bin/lib/sources/*`). A cassette miss returns null.
- `add <doi>` must reject a result whose normalized DOI differs from the requested one.
- Remove canned GPTZero scores and DuckDuckGo hits from production paths. Offline, they report "skipped (offline)".
- Make `http.ts` honour `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` (undici `EnvHttpProxyAgent`) without weakening the SSRF guard.
- Scrub the personal email from the committed cassettes.
- **Exit:**
  - With no env vars set, `isOfflineMode()` is false.
  - In live mode, a research query for a novel topic hits OpenAlex (verify with a live smoke you run manually in the sandbox and quote in the report).
  - An unknown DOI under cassettes returns null.
  - Under `--offline`, research and verify make zero HTTP requests and report skipped/UNRESOLVED.

### T02 — CLI safety: entry guard, real dry-run, verbs, exit codes
**Issues:** `cli-entry-guard-symlink`, `dry-run-overwrites-artifacts`, `unknown-verb-falls-through-to-router`, `gate-refusals-exit-zero`, `export-confirm-fails-open`, `no-llm-placeholders-exported`
- Make the entry-point check realpath-safe, so the CLI works through npm-link, `-g`, npx and `.bin` symlinks. Add a test that runs the built CLI through a symlink.
- `--dry-run`: no egress (T01 offline) and no writes to real artifacts. It prints the planned actions and may write only under `.paper/.dry-run/`. A hash snapshot of `.paper/` must be unchanged afterwards.
- Unknown or misspelled verbs exit 2 with a suggestion. Explicit aliases: `intake`→`new`, `export`→`done`.
- Apply the exit-code convention across verify, compile and done.
- Export confirmation defaults to no. Non-TTY returns exit 3 (pending) and never auto-approves on garbage input.
- `PENSMITH_NO_LLM` output is marked as placeholder (frontmatter flag). verify, compile and done refuse placeholder artifacts with exit 2.

### T03 — Export integrity: zero trace and a real manuscript
**Issues:** `docx-custom-xml-path-leak`, `export-ris-unverified`, `compile-no-headings-or-title`, `export-failures-swallowed`, `offline-citation-render-wrong`, `latex-export-not-standalone`, `citation-style-choice-ignored`
- Run pandoc from `.paper/` with relative `--csl`/`--bibliography` paths.
- Rebuild DOCX docProps from an allowlist. Drop `custom.xml`.
- Add a blocking trace scanner over every export format (docx/pdf/tex/md/bib/ris). It fails on `pensmith`, `$HOME`, absolute paths, `.paper` and generator stamps.
- Generate exported BIB/RIS from the cited, verified keys only. Never export `last_verified` or `note` fields.
- Compile emits the paper title and section headings.
- Export failures report the real error. No silent `.md` fallback presented as success.
- Offline/markdown rendering uses document-level citeproc (citation-js): numeric styles number by first appearance, and references follow the style's order.
- LaTeX export uses `--standalone`.
- The user's chosen citation style is honoured.

### T04 — One citation grammar everywhere
**Issues:** `narrow-citekey-regex-residual-sites`, `pass1-misses-non-bracket-citations`, `verify-empty-bib-shortcut`, `quote-extractor-misses-standard-forms`, `revise-narrow-regex-noop`
- Create one module, `bin/lib/citation-grammar.ts`. It parses Pandoc citation clusters `[see @a, p. 3; -@B:2020]` (key charset per Pandoc), narrative `@key`, and prefix, suffix and locator.
- It detects raw DOIs, doi.org URLs, arXiv IDs, PMIDs and bare author-year prose citations as `RAW_CITATION` (blocking).
- It attributes direct quotes (inline straight, curly and single quotes; block quotes) to the nearest enclosing or following cluster, including locator forms.
- Every consumer switches to it: Pass 1/2/3/4, compile bib regen, the done/GATE-04 diff, smoother masking, verify's empty-bib shortcut, the verdict-row parser and revise.
- Delete the narrow regexes. Add an ESLint rule or test that fails if a new `\[@` regex appears outside the grammar module.
- **Exit:**
  - A property test (fast-check): every key the exporter would render is extracted by the grammar.
  - When pandoc is available, a parity test against `pandoc -t json` Cite nodes on a corpus.
  - Fabricated citations in locator, uppercase, multi-cite, narrative and suppress-author forms all produce blocking verdicts through the real `pensmith verify`.

### T05 — Pass 1 resolver chain and matching
**Issues:** `pass1-crossref-only-resolution`, `transient-errors-reported-fabricated`, `pass1-doi-case-sensitive`, `pass1-matching-false-verdicts`, `pass1-ignores-year-venue-coauthors`, verifier half of `doi-less-sources-unciteable`
- Resolve DOIs through Crossref (polite pool, mailto only when configured). On a definitive 404, try the DataCite API, then doi.org content negotiation (CSL-JSON).
- Resolve arXiv IDs through the arXiv API (https, rate limit 1 request per 3 s), PMIDs through E-utilities esummary, and ISBNs through Open Library.
- Each resolver returns `found | not_found | unavailable`:
  - `FABRICATED` only if every applicable registry gives a definitive not-found;
  - `unavailable` (429/5xx/timeouts) gives `UNRESOLVED` (blocking, retryable).
- DOI comparison is case-insensitive and normalized.
- Title matching: strip HTML/MathML tags and entities; compare with and without the subtitle; numbers and roman numerals must match (so "Part I" vs "Part II" is MIS-CITED).
- Author matching: particle-aware surnames ("van der", "de la"), structured names, corporate or consortium authors.
- Year within ±1, else `MIS-CITED`.
- Record real registry responses as new cassettes with live calls in the sandbox (polite, ≤40 requests, mailto scrubbed). Cases:
  - arXiv `10.48550/arXiv.1706.03762`;
  - a Crossref title containing markup;
  - a particle surname;
  - a corporate author;
  - a book by ISBN;
  - a fabricated DOI.

### T06 — Retraction detection that works
**Issues:** `retraction-check-dead`
- Read retraction from Crossref `updated-by` / `update-to` (retraction, withdrawal, removal; also expression_of_concern as a warning) and the "RETRACTED:" title prefix, using the record Pass 1 already fetched.
- Cross-check OpenAlex `is_retracted` when it is available.
- Delete the `api.labs.crossref.org` adapter and its tests.
- Add a distinct `RETRACTED` verdict. It blocks unless acknowledged with `pensmith ack <section> <citekey> --reason "<text>"`. The acknowledgement is bound to the citekey plus the DOI hash and recorded in the section folder.
- **Exit:** a recorded cassette of Wakefield 1998 (`10.1016/S0140-6736(97)11096-0`) yields `RETRACTED` through the real verify.

### T07 — Pass 3 quote verification that can fail
**Issues:** `pass3-pdf-bytes-corrupted`, `pass3-threshold-accepts-misquotes`, `pass3-matcher-slow-false-notfound`, `revise-remove-launders-quote`
- Fetch PDFs as binary (`bodyBytes`, content-type check, never cached as text).
- Get OA locations from OpenAlex `best_oa_location` first (no email needed). Use Unpaywall only with a configured contact email; otherwise say "set contact email" rather than fail silently.
- Matcher:
  - normalize: NFKC, de-hyphenate line breaks, ligatures, smart quotes, whitespace;
  - exact substring first;
  - ellipsis splits the quote into segments that must appear in order;
  - bracketed insertions are allowed;
  - bounded word-level alignment, where any changed content word gives `NOT_FOUND`;
  - roughly linear time on long PDFs.
- revise `remove` deletes the quotation text itself, then requires re-verification.
- **Exit:**
  - Fabricated and one-word-altered quotes give `NOT_FOUND`.
  - A legitimate elided quote gives `OK`.
  - A 400-page text matches in under 1 s.

### T08 — Verdicts as data; compile manifest; export bound to exact bytes
**Issues:** `export-gate-not-bound-to-exported-bytes`, `verify-toctou-hash`, `compile-gate-verdict-row-parse`, `empty-or-uncited-draft-verified`
- `VERIFICATION.json` (zod) becomes the source of truth. It holds:
  - per-citation and per-quote verdicts;
  - the draft sha256;
  - the cited bib-entry hashes;
  - the verifier version;
  - the network mode.
- `VERIFICATION.md` is rendered from it.
- verify computes the verdicts and the hash from one read.
- compile refuses any section that is not clean. It writes `.paper/COMPILE-MANIFEST.json` (section draft and verification hashes, bib entry hashes, DRAFT.md sha).
- done/export checks the manifest against the current files, re-runs deterministic Pass 1 and Pass 3 on the exact text being exported (HTTP cache makes this cheap), and exits 2 on any mismatch or blocking verdict.
- A draft with zero citations when sources were assigned is not verified.

### T09 — Canonical bibliographic store
**Issues:** `compile-overwrites-canonical-bib`, `add-rewrites-bib-lossy`, store half of `doi-less-sources-unciteable`, `author-names-unstructured`, `citekeys-unstable-across-research`, `add-citekey-suffix-and-dedup`, `add-pdf-hydration-unchecked`
- `LIBRARY.json` v2 holds CSL-JSON items:
  - structured `{family, given}` names (from each API's own fields);
  - identifiers (DOI, arXiv, PMID, ISBN);
  - abstract, OA URL, provenance, retraction status;
  - a citekey assigned once and persisted.
- Add a migration from v1.
- `CITATIONS.bib`/`.ris` become derived views. Compile writes its export bibliography separately and never overwrites the canonical store.
- research and add merge by normalized identifier, and citekeys stay stable across re-runs.
- add hydrates a PDF from a DOI or arXiv ID found in its text first. Otherwise it accepts a title search hit only above the similarity threshold with author overlap.
- Carry-overs from T03:
  - Write the derived `CITATIONS.bib` through `formatBibtex` in `bin/lib/citations.ts`. The research-time writer (`bin/lib/bibtex-write.ts`) still uses citation-js's ASCII-only BibTeX output, which drops Chinese, Cyrillic and Arabic text and turns Greek into math mode. The export path already uses `formatBibtex`.
  - Wire `sourcePreference` from `templates/presets/disciplines.json` into research's merge-by-identifier ordering, or delete it from the presets and the disciplines schema. It is still unread.

### A2F — A2 review follow-ups (controller follow-up to T04–T09)
**Issues:** the minor review findings from T04–T09 that no later task owns. Re-check each against the current code first; T07 rewrote the quote matcher after T04's review.
- Usage errors exit 2. A missing required argument (`pensmith ack 1`, `pensmith add`) exits 1 today, while an unknown verb exits 2. Map every citty usage error to `EXIT_REFUSED` in one place in `bin/pensmith.ts`, with the usage text on stderr. Test two verbs through the real CLI.
- Ack advice that cannot work. A stored `note = {RETRACTED}` on an entry with no identifier gives RETRACTED with advice to run `pensmith ack`, which refuses an entry with no identifier. Say what will work instead: add the DOI, PMID or arXiv ID, or remove the citation.
- A record from another verifier is stale. VERIFICATION.json records `verifier_version` but nothing reads it, so a section verified by an older, more lenient verifier still compiles and exports. `verificationStaleness` treats a different `verifier_version` as stale, so compile re-verifies the section.
- Make the retraction note visible. When OpenAlex could not be asked, the OK reason says so only in VERIFICATION.md. verify's summary should also say how many citations had their retraction status checked from the record alone.
- Sentence ends in source text. Pass 3's sentence detection misses a full stop followed by a numeric reference marker (`[12]`, `12,13`) and a paragraph break between a heading and the next paragraph. So within the 150-character bound, an ellipsis can join two sentences. Probes that must give NOT_FOUND: 'the treatment ... was ineffective' against 'We found the treatment effective.[12] The placebo was ineffective.', against the same text with `effective.12,13 The placebo`, and against 'effective\n\nResults\n\nThe placebo was ineffective'. If the quadratic rescan in the short-quote matcher is still there, bound it.
- Missing tests (T06, T09 reviews):
  - the PMID acknowledgement binding;
  - a stored note together with an acknowledgement;
  - a PubMed expression of concern;
  - the word-for-word title check on both `add <pdf>` paths, through the CLI;
  - the v1→v2 migration's `researched_at` stamp.
  Fix any defect they find, in scope.
- Cleanup:
  - rename `READ_ONLY_VERBS` in `bin/pensmith.ts` to `NO_COST_VERBS`: it lists the verbs the cost-cap pre-flight skips, and `ack` writes a file;
  - fix the comments and docs that still describe the old verdict set, the Retraction Watch Labs adapter or the MCP server (`bin/cli/verify.ts`, `verifyDoi` in `bin/lib/doi.ts`, a grep for `retraction-watch`, `Labs` and `MCP`).
  Leave the dormant hash-pinned prompts in `templates/prompts/` alone; Phase 3 rewrites them.

### T10 — LLM transport on the official SDK
**Issues:** `anthropic-response-parse-thinking`, `pricing-table-and-model-ids`, `llm-stop-reason-max-tokens`, `llm-timeout-no-streaming`, `budget-scope-cap-lifetime`, `no-session-cost-cap`, `yolo-preflight-whole-paper-estimate`, `openai-reasoning-params`
- Rebuild `bin/lib/anthropic.ts` as a `Generator` interface. The Anthropic implementation uses `@anthropic-ai/sdk` with `fetch` routed through the `http.ts` chokepoint:
  - streaming plus `finalMessage()`;
  - read text blocks by type (thinking blocks come first on current models);
  - `stop_reason` handling: `max_tokens` gives a typed truncation error (never saved as a section) and `refusal` gives a typed error;
  - SDK retries for 429/529;
  - no `temperature`/`top_p`/`top_k`, no prefill;
  - structured outputs via `output_config.format` when a schema is given.
- Default model: `claude-opus-5-5`, with per-role `effort` and per-role model overrides in runtime config. Send `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`.
- Price table keyed by provider name, with current models: opus-5-5 $4/$20, sonnet-5-5 $2/$10, haiku-5-5 $0.10/$0.50, fable-5-2 $8/$40, plus older valid IDs. An unknown model warns and uses the highest rate; it never throws.
- Budget: remove the lifetime $0.50 per-scope cap. Enforce a per-paper aggregate `cost_cap_usd` (config/env, default $5) at run time, with a clear refusal. The estimator counts only remaining work.
- OpenAI-compatible path: `max_completion_tokens`, check `finish_reason`, configurable `base_url`.
- Tests use a mocked transport, including thinking-first responses, max_tokens, refusal and 529.
- Carry-over from T07: `http.ts` reads a whole response body into memory with no size cap. `extractPdfText`'s 50 MB cap applies only after the read, and `add <url>` has the same problem. Routing the SDK's `fetch` through `http.ts` needs streamed bodies anyway: add a per-request maximum body size there, past which the request fails with a typed error.

### T11 — Intake, outline and plan contracts
**Issues:** `intake-discards-assignment`, `intake-clobbers-config-toml`, `outline-format-mismatch`, `planner-output-schema-mismatch`, `planned-status-overloaded`, `section-registry-diverges`, `state-config-at-project-root`
- Intake persists the assignment verbatim (`.paper/PROJECT.md` `## Assignment`) and structured answers (`.paper/INTAKE.json`). It auto-detects `assignment.*` in the cwd.
  - Clarifying questions are asked on a TTY.
  - Non-TTY: exit 3 with a pending-questions JSON, answered via `--answers <file|json>`.
  - Never rewrite an existing `config.toml` lossily.
- Outline and plan come from structured outputs (zod → JSON Schema), validated in code: slugs, an acyclic `depends_on`, the counterargument rule, and assigned sources that exist in LIBRARY.json.
  - Code renders `OUTLINE.md` and writes `OUTLINE.json`, which is the single section list. STATE and the folders derive from it.
  - Code writes the PLAN.md frontmatter (section/slug/title/status); the model supplies the body and the sources.
  - The status enum is disambiguated (`stub` vs `planned`).
- `STATE.json` and `config.toml` move into `.paper/`, with a migration from the root locations.
- Prompts in `templates/prompts/` are updated to match the schemas. Trim their process-history cruft.
- Carry-over from T03: when intake records the clarifier's "Which citation style?" answer, write it as `citation_style` under `[project]` in `.paper/config.toml` (normalized with `normalizeStyleName`). `done` reads that key first (`bin/lib/citation-style.ts`). Today the choice is honoured only through `pensmith new --citation-style`, a hand edit of config.toml, or a `Citation style:` line in INTAKE.md.
- Carry-over from T08: compile adds the outline titles as headings, and done re-checks them, but verify never sees them. So a title that reads like an author-year citation gives RAW_CITATION only at done. Check titles with `citation-grammar` when the outline is validated, and refuse one that holds a citation.
- Carry-over from T09: `pensmith add <pdf>` keeps the PDF's full text in `.paper/sources/<key>.txt`, but the `.paper/.gitignore` that intake writes ignores only `*.local`. Add `sources/` to it, and to an existing project's `.paper/.gitignore` when it is migrated.

### T12 — Minimal source feed and drafter contract
**Issues:** `feed-gap-llm-gets-no-sources`, `write-wave-overwrites-verified`, `source-evaluator-unfenced-fail-open`, `revise-swap-prompt-blind`, drafter side of `empty-or-uncited-draft-verified`
- Add `bin/lib/source-context.ts`. It builds the section's assigned sources only (citekey, title, authors, year, venue, abstract), fenced as untrusted data with breakout stripping.
- Planner, drafter and revise-swap receive it.
- write rejects drafts that cite keys outside `assigned_sources` (one repair attempt, then fail). An empty source pool gives a clear WARN and skip, never an invented key.
- The drafter-input contract validates the real payload.
- Wave `write` drafts only sections with status planned or writing, unless `--force`.
- source-evaluator input is fenced, and it fails closed on parse errors.
- **Exit:** a 2-section paper with disjoint sources shows zero cross-section citekey bleed. Use a fake Generator in tests.
- Carry-over from T04/T09: read a draft's keys only through `bin/lib/citation-grammar.ts` (`citedKeys`); an AST test fails on any citation regex outside it. Build the source context from LIBRARY.json v2 (`loadLibrary` in `bin/lib/library.ts`), not from CITATIONS.bib, which is a derived view.

### T13 — Router and approval gates
**Issues:** `router-failed-unverifiable-loop`, `router-stale-compile-and-final`, `approval-gates-unusable-non-tty`, `gptzero-consent-flow`, `plagiarism-check-false-assurance`
- Table-driven router (keep the pure, never-throw design):
  - `failed` → `plan <N> --revise` (with the blocking keys in the reason);
  - `unverifiable` → compile-eligible with a warning;
  - compile freshness is derived from the manifest (recompile after any section changes);
  - compile invalidates FINAL.
  - Every decision carries a human-readable reason.
- Two-phase gates:
  - Non-TTY → exit 3 with pending-decision JSON `{gate, ref, summary, options}`.
  - Answered via `pensmith gate answer <ref> <option>`.
  - Error text never suggests `--yolo`. Export confirmation defaults to no.
- GPTZero: consent once, default no, only with a configured key.
- Plagiarism: a DuckDuckGo challenge or blocked response gives "incomplete", never "clean". Phrases are sent quoted.
- Carry-over from T03: on the humanizer path (a wired TaskRunner, which only tests wire in Phase 1), `runHumanizer` writes `.paper/FINAL.md`, the router's done marker, before the export gate and `exportDraft` run. A cancelled, refused or failed export then still leaves the marker. Write the humanized text under a staging name and make it FINAL.md only after a successful export.
- Carry-over from T08: the FINAL.md re-check (`recheckExportText`, `pass3: false`) blocks a changed quotation only when its source text can be read. If the humanizer changes a cited quotation whose source is PDF_UNAVAILABLE or TEXT_UNAVAILABLE at that check, the changed quotation is exported unblocked. Humanize runs on protected text (owner decision), so make export refuse (exit 2) when any citation or quotation in the humanized text differs from the compiled DRAFT.md, whether or not its source can be read. Compare the spans `citation-grammar` and `extractQuotes` find.
- Carry-over from T08: in cassette mode, plagiarism reads a cassette miss as "no matches". The "incomplete, never clean" rule covers every lookup that did not get an answer, including a cassette miss and `OfflineEgressError`.
- Carry-over from T06: when a section fails only on RETRACTED, the router's reason names `pensmith ack <n> <key> --reason "..."` as well as revising. The ack action itself is Phase 2's.
- Carry-over (T06/T14): `pensmith gate` makes the 18th verb. Add it to `UX02_VERBS` (`bin/lib/verbs.ts`) with a `workflows/gate.md`, and update the verb-count pins (cli-verbs, nl-triggers, tier-contract). Every backticked `pensmith <verb>` in SKILL.md must be one of them.

### A3F — A3 review follow-ups (controller follow-up to A2F and T10–T13)
**Issues:** the parked finding and the minor review findings from A2F and T10–T13, plus the real bugs their simplify passes flagged and left for a fix round. The A2F–T13 reports in `/tmp/claude-0/-home-user-pensmith/d215d403-59ed-5fd5-8322-103c08c7e93a/scratchpad/phase1/reports/` hold the evidence. Re-check each item against the current code first.
- **A kept thesis must never replace the kept assignment.** This is important; T11 parked it. The repro at HEAD, with `PENSMITH_NO_LLM=1` and no terminal:
  - Run 1: `new --thesis 'SM raises anxiety.' --answers '{"assignment":"PSYC 210 …","topic":"…"}'` exits 3. PROJECT.md holds the assignment and the thesis.
  - Run 2: `new --answers '{the other five}'` exits 3 again. PROJECT.md's Assignment section now holds only `Thesis: SM raises anxiety.`, and `topic` is asked again.
  - The same loss happens with `--from brief.txt --thesis T` followed by an answering run without `--from`.
  - It also happens on sketch's three-run path: `new --thesis X`, then `new --answers '{"assignment":A}'`, then `new --answers '{all six}'`.

  Required behaviour:
  - A run that brings no assignment text starts from the kept one.
  - A thesis, given now or kept, is added to it at most once.
  - An assignment kept earlier is never dropped.
  - Adding a thesis on a later run (`new --answers '{"assignment":A}'`, then `new --thesis T --answers '{rest}'`) gives A plus `Thesis: T`, and the answers already given survive it.
  - An explicit `--thesis ''` clears a kept thesis.

  Write a CLI regression test for each path.
- **Model failures.** The OpenAI-compatible generator (`bin/lib/generators/openai.ts`) reports a missed deadline as `ProviderError('connection')`. Give it the `timeout` kind that the Anthropic path gives; T10's simplify flagged this.
  - Check the bodyless-response rule in `bin/lib/http.ts` too. `chokepointFetch` refuses a HEAD or a 304 that declares a large Content-Length, and `fetch()` skips the declared-length check for 204 and 304. Use one shared rule, with tests.
- **OpenAI output caps.**
  - Add the common OpenAI chat models to `MODEL_OUTPUT_LIMITS.openai` (`bin/lib/llm-config.ts`): 32768 for the gpt-4.1 family, 4096 for gpt-4-turbo and gpt-3.5-turbo.
  - When a provider answers 400 because the output limit is too large, the error names `roles.<role>.maxTokens` in runtime.json.
- **Empty model turn.** `pensmith new` must never send an empty user message, which the Messages API rejects with a 400. Check whether any path still can (a whitespace-only assignment, for example), and refuse it or skip the clarifier.
- **Years in prompts.**
  - A hand-edited non-integer year (`issued [[2019.5]]`) makes `pensmith write N` exit 1 with a ZodError before any model call.
  - String date-parts (`[["2019","3"]]`, as Zotero exports write them) show no year.
  - Accept any integer year, including pre-1500 and negative ones, and a leading numeric string. Drop a non-integer, and never throw. Test with 1265, -350, "2019" and 2019.5.
- **Placeholder plans.** `write` drafts from a placeholder PLAN.md (written under `PENSMITH_NO_LLM`) when a real model is configured. Refuse it with exit 2 and the advice `pensmith plan N --force`, as verify, compile and done refuse placeholders.
- **`add <pdf>` identity** (A2F concern, T09 minor).
  - On the DOI path, a hit whose title appears anywhere in the first 30 lines is accepted when no line starts with `Abstract` (for example `Summary` or `a b s t r a c t`).
  - `REFERENCES_HEADING` (`bin/lib/source-hydrate.ts`) misses `References and Notes`, `Notes`, `Endnotes`, `Literatur` and `Références`.
  - The T09 reviewer's P3 and P4 probes still store the wrong work.
  - A PDF whose identity cannot be confirmed is refused with exit 2. It is never stored as another work.
- **Gates (T12/T13 minors).**
  - `ExportAuditSchema.honestySkip` (`bin/cli/done.ts`) is required. An audit kept by an earlier build therefore fails the strict parse, done says the confirmation "was for another draft, bibliography or format", and it audits again. Make the field optional, with a missing value meaning unknown, or give a schema mismatch its own message.
  - `outline --yolo` closes an answered but unapplied kept proposal, and a `--force` replacement is then lost silently. Apply an answered kept proposal before the `--yolo` skip, and drop only an unanswered one.
  - The refusal for a stale outline answer always advises `--force`. Advise it only when the proposal was made with `--force`.
  - `plan --revise` requires an API key even when it only applies a kept, answered proposal, which needs no model call.
  - research's non-TTY refusal says the evaluator "kept none" when it gave no usable answer. Word it from the actual cause.
- **Estimator.** `--estimate` prices a failed section as verify, but the router sends it to `plan --revise` or `write --force`. Price the step the router will run.
- **Docs and comments** (A2F minors).
  - `workflows/*.md` still describe pensmith's removed MCP server (`MCP state.read`, `MCP library.read`, `MCP state.update`, "keep the MCP stdio frame clean", "if no MCP tools: …"), and `verifyDoi` running at add time. Drop or reword those lines. Phase 2 replaces these bodies, but until then they must not describe code that is gone.
  - Trim the stale verb-count comments ("locked UX-02 16 verbs", "No 17th verb", "15 of the 16 verbs") in `bin/cli/done.ts`, `compile.ts`, `stubs.ts`, `plan.ts`, `sketch.ts` and `bin/lib/sources/zotero-mcp.ts`. There are 18 verbs.
  - README's Pass 3 row says a heading ends a sentence, but only a heading set off by a blank line does. Say exactly that, or name the single-newline heading as a known gap.
  - Drop the decision IDs from the comments A2F rewrote (`bin/lib/state.ts`, `bin/lib/outline.ts`, `bin/lib/write-orchestrator.ts`), and rewrap the long goal comment in `bin/cli/intake.ts`.

### T14 — Packaging: installable plugin + bundled CLI (parallel worktree)
**Issues:** `plugin-manifest-uninstallable`, Phase-1 part of `tier1-no-executable-path`, `root-mcp-json-project-scope`, `sessionstart-context-not-delivered`, `hooks-write-into-every-project`, `hooks-no-entrypoint-wrong-state`, `stop-hook-useless`, `handoff-size-bound-rejects`, `mcp-verbs-write-stdout`, `mcp-surface-noop-and-unwired`, `mcp-resources-wrong-root`, `mcp-tools-expose-yolo-and-paperroot`, `skill-descriptions-overtrigger`, `ci-gates-pin-invalid-plugin-format`, `build-ships-compiled-tests`, `package-deps-engines-hygiene`, `ecosystem-presence-wrong-paths`, `docs-inaccurate`
- `plugin/` is the only installed payload. Root `.claude-plugin/marketplace.json` uses `"source": "./plugin"`; remove the root `plugin.json`. `plugin/` contains:
  - `.claude-plugin/plugin.json`: name, version `0.3.0-alpha.1`, description, author, homepage, repository, license, keywords;
  - `skills/pensmith/SKILL.md`: a "Use when…" description scoped to academic-paper work, `allowed-tools: Bash(pensmith:*)`. The body drives the CLI's `--json` outputs and the exit-3 pending-decision protocol with AskUserQuestion, and states plainly that Phase-1 generation needs an API key;
  - `hooks/hooks.json`: spec format, one SessionStart hook (exec form `node` + args). It emits `hookSpecificOutput.additionalContext` only when `.paper/` exists in the session cwd;
  - `bin/pensmith` (POSIX sh shim, plus `bin/pensmith.cmd`), executable, calling `dist/pensmith.mjs`;
  - `dist/`: committed esbuild bundles (`pensmith.mjs`, `hook.mjs`) with dependencies inlined;
  - runtime assets: templates, CSL, presets, references.
  - No `package.json` or lockfile, so Claude Code never runs npm install.
- Delete the MCP server (`mcp/`, `.mcp.json`, the MCP SDK dependency, the MCP tests, the MCP-spawning parts of `tests/tier-contract.test.ts`; Phase 2 replaces tier parity with action-trace equivalence).
- Delete the PreCompact, PostToolUse and Stop hooks, `checkpoint.ts` if it becomes unused, `scripts/validate-plugin-manifest.cjs`, and the tests that pin the old formats.
- Build:
  - `npm run bundle` (esbuild);
  - `tsconfig.build.json` excludes tests;
  - CI fails if `plugin/dist` is stale.
- CI:
  - install the Claude Code CLI;
  - `claude plugin validate plugin --strict` and `claude plugin validate .`;
  - an isolated-install smoke: `CLAUDE_CONFIG_DIR`/`HOME` temp → `claude plugin marketplace add <checkout>` → `claude plugin install pensmith@pensmith` → `claude plugin details` shows 1 skill and 1 hook;
  - run `plugin/bin/pensmith --version` through a symlink;
  - Node 22 and 24 on 3 OSes.
- Dependency hygiene:
  - remove unused deps (`doi-regex`, `p-retry`, and anything else unused);
  - move type-only deps to dev;
  - `engines.node >= 22`.
- Rewrite README and PRIVACY honestly: alpha status, Phase-1 API-key need, a network host table, install steps that work.
- Update `CLAUDE.md` with the owner decisions above.

### T14b — Keep the built bundle out of source history; publish via a release branch (controller follow-up to T14)
**Why:** committing the ~9 MB `plugin/dist` bundle and failing CI whenever it is stale would add megabytes to git history on every source change, and every marketplace install clones that history. The controller removed `plugin/dist` from the unpushed T14 commits; this task finishes the model.
- `.gitignore` `/plugin/dist/`. `npm run bundle` builds it locally and in CI; nothing in source history contains it.
- Minify the bundles (esbuild `minify: true`, `keepNames: true`) and keep the legal comments; report the before/after sizes. Everything that passes today must still pass against the minified bundle.
- Replace `bundle:check` (the stale-committed-bundle gate) with build-then-test: `check` runs `npm run bundle` before the tests. Tests that need the bundle fail loudly if it is missing ("run `npm run bundle`"). They never skip.
- `.claude-plugin/marketplace.json`: the plugin source becomes `{"source": "github", "repo": "ZeusCraft10/pensmith", "ref": "release"}`, so users always install the last published release. `claude plugin validate . --strict` must still pass.
- `scripts/plugin-smoke.mjs`:
  - validate `plugin/` (after the bundle is built) and the root marketplace;
  - for the isolated install, generate a throwaway local marketplace in a temp dir whose entry uses `"source": "./plugin"`, pointing at a copy of the built `plugin/` payload, so the install exercises exactly what a release ships;
  - all other checks stay as they are (1 skill, 1 hook, 0 MCP, `--version` installed, through a symlink and through npm link).
- New `.github/workflows/release.yml`:
  - triggers on tags `v*`, with `permissions: contents: write`;
  - fails unless tag == `plugin/.claude-plugin/plugin.json` version == `package.json` version;
  - runs `npm ci && npm run check`, then `node scripts/plugin-smoke.mjs` (Claude Code CLI pinned as in ci.yml);
  - then publishes the built `plugin/` payload as the root of the `release` branch: check out or create `release` in a separate worktree, replace its contents with `plugin/` (including `dist/`), and commit `release <tag>` on top of the previous release commit (history kept; no force-push). Push `release`. Optionally create a GitHub Release for the tag.
- `ci.yml`: drop the committed-bundle step; build the bundle before the tests and the smoke.
- Docs:
  - README install: in Claude Code, `/plugin marketplace add ZeusCraft10/pensmith` then `/plugin install pensmith@pensmith` (the latest release). Until the first tag exists, install from a checkout: `npm ci && npm run bundle && claude --plugin-dir plugin`.
  - CONTRIBUTING: the release steps (bump the version in package.json and plugin.json, tag, push the tag).
- **Exit:**
  - `git ls-files plugin/dist` is empty;
  - `npm run check` is green;
  - `node scripts/plugin-smoke.mjs` passes;
  - `claude plugin validate . --strict` passes;
  - running release.yml's publish step locally into a scratch clone produces a `release`-shaped tree that `claude plugin validate --strict` accepts.

### T15 — Journey e2e and honest test gates
**Issues:** Phase-1 part of `no-e2e-or-real-tier-parity-test`, `known-bad-corpus-tests-vacuous`, `vacuous-red-by-skip-tests` (touched areas), `test-env-isolation-leaks`, `section-isolation-tests-vacuous`
- Journey test: a scripted fake Generator plus HTTP cassettes keyed by request. It drives bare `pensmith` from an empty dir containing `assignment.txt` to an exported docx. It asserts:
  - each router transition;
  - the assignment is preserved;
  - sections register from a prompt-compliant outline;
  - each section cites only its own assigned keys;
  - a post-compile hand edit, or a bib swap, makes export exit 2;
  - `--dry-run` leaves the `.paper/` hash unchanged.
- The known-bad citation and quote corpora run through the real verify pipeline (no test-only twin) and give 10/10 blocking verdicts.
- `scripts/run-tests.mjs` isolates HOME/XDG/LOCALAPPDATA/tmp itself and sets `PENSMITH_TEST_CASSETTES=1`.
- Fix the root-only chmod test so it skips when uid is 0.
- Carry-over (controller, after the T14 merge): in-process tests write `.paper/SESSION.log` and `.paper/COSTS.jsonl` into the repository root, because `paperDir()` defaults to `process.cwd()`. Examples are the state race tests (`paper-rt`, `paper-race`) and the GPTZero cost record (`honesty-gptzero`). Make every such test pass an explicit temp paper root, or chdir into one. Make the runner fail any test that creates `<repo>/.paper`. Check that production writes the session log and the cost ledger under the paper root it was given, not under the cwd.
- Carry-over from T05: exit criterion 3's 10/10 fabricated DOIs must go through the real verify CLI. T05 recorded one fabricated DOI (Crossref, DataCite and doi.org all answer not-found). Record nine more for the known-bad corpus (about 27 live requests, no contact email sent), and run that corpus through `pensmith verify`, not `runPass1Unit`.
- Carry-over from T06: record OpenAlex answers for the corpora, so their OK reasons no longer end with "OpenAlex could not be asked (PENSMITH_CASSETTE_MISS)".
- Carry-over from T05: the research-side cassettes (the Crossref `works-attention` search entry, Semantic Scholar, OpenAlex) claim Crossref holds arXiv DOIs. Correct them, or re-record them.
- Carry-over from T07: tests leave about 30 `pensmith-bib-fixture-*` temp folders behind (`tests/lib/bib-fixture.ts`). Remove each in the test's teardown; the runner's tmp isolation should catch any others.
- Carry-over from the T10–T13 simplify passes (test hygiene they could not do):
  - Share one Messages-API SSE helper (`tests/lib/messages-stream.ts`) across `write-truncated` and the other hand-built SSE fixtures.
  - Share one `outlineTable()` helper across the estimator and section-status-stub tests.
- Carry-over from T12: one full-suite gate lost a TAP line from a passing file (the "PRODUCER (2)" line; the file passed 3/3 when run alone). Make the runner's pass and fail counts and its exit status independent of interleaved TAP output, so that a lost line can never hide a failing test.

## Phase 1 exit criteria (controller verifies before declaring done)

1. `claude plugin validate plugin --strict` passes. An isolated marketplace add + install shows 1 skill, 1 hook and 0 errors. `pensmith --version` works through an npm-link symlink.
2. No production code path can read `tests/fixtures`. With no env vars set, a novel topic returns live OpenAlex results, and an unknown DOI is UNRESOLVED or null, never a substituted record.
3. Through the real verify CLI:
   - 10/10 fabricated DOIs → FABRICATED;
   - arXiv `10.48550/*` and Zenodo DOIs → OK;
   - 429/5xx → UNRESOLVED with 0 FABRICATED;
   - Wakefield 1998 → RETRACTED;
   - fabricated quotes in locator, uppercase and multi-cite form → NOT_FOUND.
4. The journey test (T15) is green.
5. The trace scanner finds nothing on real pandoc docx/pdf/tex/md output.
6. Every refusal exits non-zero, and `--dry-run` leaves `.paper/` unchanged.
7. `npm run check` is green.
