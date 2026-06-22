---
phase: 03-vertical-slice-one-section
reviewed: 2026-05-28T00:00:00Z
depth: deep
files_reviewed: 41
files_reviewed_list:
  - bin/lib/handoff.ts
  - bin/lib/schemas/handoff.ts
  - bin/lib/schemas/source-candidate.ts
  - bin/lib/schemas/plan-frontmatter.ts
  - bin/lib/schemas/state.ts
  - bin/lib/deep-equal.ts
  - bin/lib/migrations/state/v1_to_v2.ts
  - bin/lib/paths.ts
  - bin/lib/citekey.ts
  - bin/lib/bibtex-write.ts
  - bin/lib/drafter-input.ts
  - bin/lib/prompt-loader.ts
  - bin/lib/http-mock.ts
  - bin/lib/http.ts
  - bin/lib/quote-extractor.ts
  - bin/lib/verify/pass1.ts
  - bin/lib/verify/pass3.ts
  - bin/lib/sources/crossref.ts
  - bin/lib/sources/openalex.ts
  - bin/lib/sources/arxiv.ts
  - bin/lib/sources/pubmed.ts
  - bin/lib/sources/semanticscholar.ts
  - bin/lib/sources/unpaywall.ts
  - bin/lib/sources/retraction-watch.ts
  - bin/lib/sources/index.ts
  - bin/lib/doctor/probes/intake-outline-verify-wiring.ts
  - bin/cli/intake.ts
  - bin/cli/research.ts
  - bin/cli/outline.ts
  - bin/cli/plan.ts
  - bin/cli/write.ts
  - bin/cli/verify.ts
  - bin/pensmith.ts
  - hooks/pre-compact.ts
  - hooks/post-tool-use.ts
  - mcp/tools.ts
  - workflows/new.md
  - workflows/research.md
  - workflows/outline.md
  - workflows/plan.md
  - workflows/write.md
  - workflows/verify.md
  - templates/prompts/intake-clarifier.md
  - templates/prompts/topic-disambiguator.md
  - templates/prompts/source-evaluator.md
  - templates/prompts/outline-author.md
  - templates/prompts/section-planner.md
  - templates/prompts/section-drafter.md
  - templates/prompts/pass1-fuzzy-judge.md
  - templates/prompts/pass3-quote-checker.md
  - templates/presets/disciplines.json
  - templates/citation-styles/apa.csl
  - .github/workflows/cassette-refresh.yml
findings:
  high: 5
  medium: 7
  low: 6
  info: 4
  critical: 5
  warning: 7
  total: 22
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-28
**Depth:** deep
**Files Reviewed:** ~52 (in-scope Phase-3 source files)
**Status:** issues_found

## Summary

Phase 3 lands the vertical slice (intake → research → outline → plan → write → verify) plus the
7 source adapters, the 8 D-12 LOCKED prompts, the HANDOFF.json writer, the deterministic
Pass-1 / Pass-3 verifiers, the strict drafter-input chokepoint, and the MCP-tool surfaces for
the 3 per-section verbs. The architecture-level discipline is high: chokepoint enforcement
(D-07 atomic-write, D-19 citation-js, D-15 retraction-watch fetchById-only) is respected,
D-13 dormancy is honored (`workflows/verify.md` does not reference `pass1-fuzzy-judge` /
`pass3-quote-checker` — grep returns zero hits), and the HANDOFF size cap is enforced both
in the zod refinement and at write time.

However, the implementation ships with **multiple defects that break the live (non-cassette)
research path**, a **scheduled CI workflow that will silently no-op**, three **hard-coded
personal email/contact addresses** at module scope (CLI-distributable code that will be
published to npm), and several **race / regex / path-handling bugs** that survive into Phase
4. The retraction-handling pipeline has an end-to-end break: research persists `retracted`
into LIBRARY.json, but `writeBibtex` only flags entries whose SourceCandidate has `retracted
=== true`. Crossref/Openalex/Arxiv/Pubmed/S2 adapters hard-code `retracted: false` at
SourceCandidate construction (the retraction-watch fetch never mutates them), so the
`note = {RETRACTED}` line never lands in CITATIONS.bib and Pass-1 cannot detect a
research-time retraction by reading the bib at verify time.

The Phase 3 invariants from CLAUDE.md (verifier-blocks-compile, no-exported-trace,
honest-detection-framing, approval-gates-default-on, section-as-phase) are preserved by
the code in scope — no finding below recommends weakening any of them.

## Critical Issues

### CR-01: cassette-refresh.yml env mismatch — weekly cron will silently no-op (HIGH / BLOCKER)

**File:** `.github/workflows/cassette-refresh.yml:56` and `bin/lib/http-mock.ts:230-235`
**Issue:** The cron workflow sets `PENSMITH_REFRESH_CASSETTES: '1'`, but
`recordCassettes()` in `bin/lib/http-mock.ts` checks `process.env['PENSMITH_RECORD_CASSETTES']`.
The two env names disagree (REFRESH vs RECORD). The cron will run weekly forever, hit the
guard, throw `recordCassettes requires PENSMITH_NETWORK_TESTS=1 AND
PENSMITH_RECORD_CASSETTES=1 (D-23, D-24)`, fail the step, and open no PR — but cassettes
will silently rot against live API drift until a human notices. Compounding: the same step
invokes `npm run test:cassettes -- --refresh`, and `package.json` does **not** define a
`test:cassettes` script (only `test:tier-contract` and `test`). The cron is doubly broken
and has never produced a passing run.
**Why it matters:** PR-time CI is hermetic against cassettes; if cassettes go stale and the
upstream APIs change shape, Pass-1 / Pass-3 verdicts will start producing FABRICATED on
real citations — violating the verifier-blocks-compile invariant in production.
**Fix:** Rename the env in the workflow to `PENSMITH_RECORD_CASSETTES: '1'` to match
`bin/lib/http-mock.ts:231`, and add a `test:cassettes` script to `package.json` that drives
`recordCassettes` / `finalizeRecording` for each adapter. Pin a smoke step that asserts the
recorder produced at least one JSON file per adapter.

### CR-02: SourceCandidate.retracted is always false from search() — RETRACTED never lands in CITATIONS.bib (HIGH / BLOCKER)

**File:** `bin/lib/sources/crossref.ts:75`, `openalex.ts:70`, `arxiv.ts:112`,
`pubmed.ts:82`, `semanticscholar.ts:103`, `unpaywall.ts:79` (every adapter except
retraction-watch); consumed by `bin/lib/bibtex-write.ts:93`.
**Issue:** Every primary discovery adapter constructs SourceCandidate with
`retracted: false` hard-coded. The research workflow (`workflows/research.md` step 5)
documents a "cross-check via Retraction Watch → set `retracted: true`" pass, but no code
in scope mutates the previously-built SourceCandidate. Even if a Phase-4 caller does it
in-memory after `sources['retraction-watch'].fetchById`, the bibtex-writer's
`note = "RETRACTED"` branch reads `c.retracted === true` from the SourceCandidate, not
from a sidecar — so unless the orchestrator mutates the array element before calling
`writeBibtex`, the RETRACTED note never lands. Pass-1 at verify time (`pass1.ts:109`)
reads `claimed.retracted` from the parsed BibTeX, which means a research-time retraction
is silently dropped between `research` and `verify`.
**Why it matters:** Directly violates the verifier-blocks-compile invariant. A cited
retracted work is the canonical failure mode the workflow exists to catch.
**Fix:** Either (a) move the retraction-watch cross-check inline into each adapter's
`search()` (expensive — N extra HTTP calls per query), or (b) export an explicit
`bin/lib/sources/retraction-cross-check.ts` helper that takes `SourceCandidate[]` and
mutates `retracted` / `retraction_details` in place. Add a regression test in
`tests/sources/` that constructs a candidate, runs the cross-check, and asserts
`writeBibtex` produces a `note = {RETRACTED}` line.

### CR-03: hard-coded personal email in three adapters (HIGH / BLOCKER for npm publish)

**File:** `bin/lib/sources/crossref.ts:25` (`UA = 'pensmith/0.x (mailto:akhilachanta8@gmail.com)'`),
`bin/lib/sources/openalex.ts:20` (`MAILTO = 'akhilachanta8@gmail.com'`),
`bin/lib/sources/unpaywall.ts:20` (`EMAIL = 'akhilachanta8@gmail.com'`).
**Issue:** The adapter modules hard-code the maintainer's personal Gmail at module scope.
The HTTP chokepoint (`bin/lib/http.ts:162-169`) already builds a polite User-Agent from
`process.env.PENSMITH_CONTACT_EMAIL` and WARNs once when unset — the adapters bypass that
chokepoint. Three consequences:
  1. Every downstream user of pensmith installed from npm will identify itself as
     `akhilachanta8@gmail.com` to Crossref, OpenAlex, and Unpaywall.
  2. The polite-pool maintainers will rate-limit / block traffic when the volume from
     "one" contact email exceeds individual thresholds, breaking research for ALL pensmith
     users.
  3. Crossref's UA in `crossref.ts` is passed as a header override (`headers: { 'user-agent': UA }`),
     defeating the chokepoint banner in `http.ts:128` for that adapter.
**Why it matters:** Personal-data leakage, abuse-of-trust from upstream registrars, and
guaranteed rate-limit collapse the moment pensmith gains > 1 user.
**Fix:** Remove the module-level constants. Let `bin/lib/http.ts` own the polite-pool UA
(it already does). For OpenAlex `mailto=` and Unpaywall `email=` (which must live in the
URL query, not the header), read `process.env.PENSMITH_CONTACT_EMAIL` lazily in the URL
builder and emit no `mailto=` / `email=` param when unset (the polite-pool degradation is
documented as "no-contact" mode in `http.ts:166`).

### CR-04: hooks/post-tool-use.ts throttle uses uncoordinated readFile + appendFile — TOCTOU race + corrupt JSONL (HIGH / BLOCKER)

**File:** `hooks/post-tool-use.ts:25-50`
**Issue:** The throttle decides whether to write by reading `CHECKPOINTS.jsonl`, parsing
the last line, and comparing timestamps — then **without any locking** calls
`appendFileSync`. Two concurrent Claude Code tool invocations (PostToolUse fires per tool
call, and the SDK can issue parallel tool calls) will both read `lastWriteAt` as the same
stale value, both pass the throttle gate, and both append. Worse, partial-line interleaving
between `appendFileSync` calls on the same FD can produce malformed JSONL (
`{...}{ts:...}\n` instead of two separate lines). The next `JSON.parse(last)` fails, falls
through to `lastWriteAt = 0` (line 35), and the throttle is permanently broken until the
file is hand-truncated.
**Why it matters:** Violates T-3-DOS-04 (throttle ≤ 1 per minute). A broken throttle means
unbounded checkpoint growth — disk fill, slow session-start, and the throttle test in CI
goes flaky.
**Fix:** Use the same `proper-lockfile` pattern as `hooks/pre-compact.ts` against
`.claude/CHECKPOINTS.jsonl.lock`. Or use O_APPEND semantics and an atomic single-line write
via `fs.writeFileSync` to a `.tmp` file followed by `appendFileSync(...)` (atomic on POSIX
for writes < PIPE_BUF / 4096 bytes). The simpler fix: pull the throttle decision into a
single locked-read-then-write block.

### CR-05: ReDoS via unbounded backtracking in arxiv.ts XML regex (HIGH / BLOCKER for live mode)

**File:** `bin/lib/sources/arxiv.ts:31-32`
**Issue:** `extractAll(xml, 'entry')` builds `new RegExp('<entry\\b[^>]*>([\\s\\S]*?)</entry>', 'g')`
and runs it across the entire ATOM feed body. The `[\s\S]*?` is lazy, so on well-formed
input it's linear — but on malformed input from a hostile/buggy arXiv response (a stray
`<entry>` opening tag with no closing `</entry>`), the regex engine will scan the rest of
the document repeatedly for `</entry>`, each subsequent `<entry` match starting the lazy
walk over again. On a 10 MB malformed feed the regex can take O(n²) time. arXiv responses
are user-influenced (`query` interpolates into the URL — encoded but the response itself
is not bounded). The bigger issue is that arxiv returns up to `max_results` entries
**plus** trailing metadata; a 50-result query producing a 1 MB body with N nested entries
still scans the rest of the body N times because `extractAll` re-runs on the whole feed
for each tag. Combined with the **missing response-size guard** (no MAX_BYTES check in
arxiv.ts, pubmed.ts, openalex.ts, crossref.ts), a single malicious / malformed upstream
response can stall the verify step.
**Why it matters:** Single point of denial-of-service in live mode; in offline (cassette)
mode the cassettes are bounded so this is asymptotically safe — but the path runs in
production research mode.
**Fix:** Cap response body size in `bin/lib/http.ts.callOnce` (read at most N MB from
`body.text()` via a streaming guard). Replace the arxiv regex with a streaming SAX-style
parser (or `fast-xml-parser` — already accepted as a Phase-4 dep candidate per
03-CONTEXT.md). At minimum, add a length sanity check (`xml.length < 10_000_000`) before
each `parseFeed` call and bail with `[]`.

## Warnings

### WR-01: hooks/pre-compact.ts directory walking is non-deterministic and unstable across platforms (MEDIUM / WARNING)

**File:** `hooks/pre-compact.ts:158-205`
**Issue:** `readdirSync(sectionsDir)` returns entries in filesystem order (POSIX: undefined;
NTFS: alphabetical; some FUSE / network mounts: insertion order). The function uses
`mtimeMs` to pick `currentSection`, but the section_pointers array is emitted in
readdirSync order — making the HANDOFF.json git-diff churn on every pre-compact run. The
section_pointers stride into the 5 KB cap (HandoffSchema.refine at handoff.ts:46), so
order-instability can flip a borderline-size handoff between accept and reject runs.
Additionally, `basename.replace(/^\d+-/, '')` (line 169) strips the NN prefix but does not
validate the result against `/^[a-z0-9-]+$/` — a directory like `02-` (slug-less) yields an
empty slug that fails downstream `validateSlug`.
**Fix:** Sort `dirEntries` lexically before iterating. Validate the stripped slug; skip
the entry (don't include in pointers) if it fails the slug regex.

### WR-02: HANDOFF refine() runs JSON.stringify TWICE per parse — O(N) waste on the hot path (MEDIUM / WARNING)

**File:** `bin/lib/schemas/handoff.ts:46`, `bin/lib/handoff.ts:60-62`
**Issue:** `HandoffSchema.refine((h) => Buffer.byteLength(JSON.stringify(h), 'utf8') <=
HANDOFF_MAX_BYTES)` stringifies on every parse. `writeHandoff` then **also** calls
`HandoffSchema.parse(handoff)` (line 60) AND `JSON.stringify(handoff, null, 2)` (line 61),
so for every write the handoff is stringified 3× (1× in the refine, 1× explicitly, 1× in
the refine again — wait, parse runs once so 2×). Minor performance concern, but the bigger
defect: the refine uses the compact stringify (no indent), but `writeHandoff` writes the
pretty-printed (`null, 2`) form. **The pretty form is larger than the refine-checked form.**
Boundary case: a handoff that's exactly `HANDOFF_MAX_BYTES` compact-stringified will pass
zod.parse but be rejected by the explicit `size > HANDOFF_MAX_BYTES` guard at handoff.ts:63
— the refine and the explicit check disagree. This is recoverable (write throws cleanly),
but inconsistent.
**Fix:** Use `JSON.stringify(h, null, 2)` in the refine to match the on-disk format, or
remove the refine and rely solely on the explicit `writeHandoff` size check (preferred —
the refine is on a hot path).

### WR-03: assembleHandoff truncates next_action with .slice(0, 200), corrupting multi-byte UTF-8 (MEDIUM / WARNING)

**File:** `bin/lib/handoff.ts:49`
**Issue:** `next_action: input.nextAction.slice(0, 200)` slices by code-unit, not by code
point or byte. A nextAction containing a surrogate pair (emoji, CJK rare characters) at
the cut boundary produces an invalid lone surrogate; subsequent `JSON.stringify` emits the
lone surrogate verbatim, and downstream consumers parsing the JSON may reject or replace
it. More commonly, the next_action is template-formatted and will exceed 200 chars on
sections with long slug strings (`Resume verify on section attention-mechanism-with-very-long-name. Last verb: pensmith verify.`),
producing a truncated-mid-word string that confuses the resumed session.
**Fix:** Truncate by graphemes (or at the last whitespace ≤ 200). If the original is over
200, append "..." so consumers know the string was clipped. Also: the schema bound is 1..200
(`max(200)`) — the slice ensures parse never throws, but the schema lies about its inputs.
Document that next_action is auto-truncated.

### WR-04: writeBibtex header-rewrite regex misaligns when citation-js outputs extra header lines (MEDIUM / WARNING)

**File:** `bin/lib/bibtex-write.ts:177-181`
**Issue:** The rewrite walks `entries` in order, replacing the N-th `@<type>{<autokey>,`
header. citation-js can emit `@string{}` macro declarations or comment headers
(`@comment{...}`) before / between entries depending on input shape and library version.
The regex `^(@\w+\{)[^,]+(,)` matches `@string{`, `@comment{`, AND `@article{` — so the
N-th match may be a non-entry header, shifting every subsequent citekey rewrite by one and
silently corrupting the bib. Detection is hard because the resulting bib still parses.
**Fix:** Use a narrower regex that excludes `@string`, `@comment`, `@preamble`:
`/^(@(?!string|comment|preamble)\w+\{)[^,]+(,)/gim`. Add a length-check assertion (matches
== entries.length) and throw on mismatch — better to fail loudly than corrupt the bib.

### WR-05: stripFrontmatter splits on `^---\s*$` and produces wrong body if a YAML value contains `---` on its own line (MEDIUM / WARNING)

**File:** `bin/lib/prompt-loader.ts:111-119`
**Issue:** `text.split(/^---\s*$/m)` splits on every line that is exactly `---`. A
multiline YAML scalar (block string with `|`) containing `---` (mathematicians often do
this in prose) will produce parts.length >= 4 and `parts.slice(2).join('---')`
**reconstructs the body** — but the first `---` after the YAML closing fence has been
consumed as a separator. The result includes a literal `---` line at the body start. Phase
3 prompts don't trigger this (all 8 prompts have simple YAML), but the loader is shared
infrastructure and Phase 4+ prompts can hit it. Worse: if the prompt body legitimately
opens with `---` (markdown horizontal rule before the first heading), the split eats it.
**Fix:** Match only the FIRST `---` block: find the opening `---\n`, then find the next
`^---\s*$` on its own line, then return everything after that match. Use a non-greedy
regex with anchors: `/^---\n[\s\S]*?\n---\s*\n/`.

### WR-06: post-tool-use.ts reads the whole CHECKPOINTS.jsonl into memory on every tool call (MEDIUM / WARNING)

**File:** `hooks/post-tool-use.ts:27`
**Issue:** `readFileSync(CHECKPOINTS_PATH, 'utf8').trim().split('\n')` reads the full file
into memory just to grab the last line. After a week of tool use (no rotation policy
exists in scope) the file grows monotonically and every tool call pays the full read cost.
This is an O(N²) growth pattern that surfaces as session-start slowness.
**Fix:** Use a fixed-size tail reader (`fs.read` the last 4 KB) — JSONL lines are bounded
small. Or add a rotation gate: if file size > 1 MB, truncate before append. Note: this is
deliberately out-of-scope per the v1 perf carve-out, BUT it manifests as a correctness
defect when the file grows past a few hundred MB and `readFileSync` allocates more than
node's default 4 GB buffer — at that point throw is silent (catch swallows) and throttling
stops working.

### WR-07: section-planner.md and outline-author.md prompt examples emit slugs in the wrong shape (MEDIUM / WARNING)

**File:** `templates/prompts/section-planner.md:55` (`slug: 02-attention-mechanism`),
`templates/prompts/outline-author.md:55-64` (`slug: 01-introduction`, `slug:
02-attention-mechanism`).
**Issue:** Both example outputs put the `NN-` prefix INTO the slug field. But the
PlanFrontmatter schema (`bin/lib/schemas/plan-frontmatter.ts:33-35`) requires
`slug.regex(/^[a-z0-9-]+$/)`, which **accepts** the NN-prefixed form — but `validateSlug`
in `bin/lib/paths.ts:54` and the convention documented in paths.ts:32-42 explicitly define
slug as the BARE form (no NN). When the LLM follows the example and emits `02-attention-mechanism`,
`sectionPlan(n=2, slug='02-attention-mechanism')` will resolve to
`.paper/sections/02-02-attention-mechanism/PLAN.md` (double-prefix), silently breaking
section-isolation and the test fixture path conventions. Additionally,
`section-planner.md:60` uses `state: planned`, but the schema field is `status`, not
`state`. The LLM following this example produces a PLAN.md that fails
`PlanFrontmatterSchema.parse`.
**Fix:** Rewrite both example blocks: `slug: attention-mechanism` (bare) and `status:
planned` (not `state`). Add a `tests/prompts-examples.test.ts` that extracts the YAML
example block from each prompt and parses it through `PlanFrontmatterSchema` — drift will
fail PR.

## Info

### IN-01: deep-equal.ts does not handle NaN equality (LOW / INFO)

**File:** `bin/lib/deep-equal.ts:20`
**Issue:** Comment says "primitives caught above; NaN !== NaN" — but the early-return
`if (a === b) return true` does not catch NaN (NaN !== NaN), and the `typeof a !==
'object'` branch then returns false. So `deepEqual(NaN, NaN)` returns false. JSON-shaped
inputs (the documented contract) cannot contain NaN, so in scope this is correct — but
the comment is misleading. If a future caller passes a Map/Set / Date that internally
contains NaN, the migration idempotency contract silently breaks.
**Fix:** Add an explicit `Number.isNaN(a) && Number.isNaN(b)` short-circuit. Or strengthen
the docblock to "JSON-shaped values only; NaN / Date / Map / Set unsupported."

### IN-02: drafter-input optional field 'authors' duplicates assignedSources[].authors with no cross-validation (LOW / INFO)

**File:** `bin/lib/drafter-input.ts:70`
**Issue:** Both `assignedSources[].authors` AND top-level `authors` are accepted as
optional arrays. The schema does not check that they agree, and there is no
documentation explaining which field the drafter reads. A drafter-input that sets both
fields with disagreeing values silently passes parse. This widens the T-3-10 attack
surface the strict() chokepoint exists to close.
**Fix:** Either drop the top-level `authors` field (assigned-source-author info already
lives in the per-source object), or require it to be a strict subset of
flatMap(assignedSources.authors).

### IN-03: pubmed.ts esearchresult.idlist parsed without strict shape validation (LOW / INFO)

**File:** `bin/lib/sources/pubmed.ts:121,149`
**Issue:** `(esearchEntry.response as EsearchResponse)?.esearchresult?.idlist ?? []` casts
the cassette response to a typed shape but does not validate. A malformed cassette (or a
hostile upstream PubMed response in live mode) producing `idlist: "not-an-array"` will
flow into `idlist[0]` (returns the first char), then into URL interpolation in the live
path. Not exploitable today (cassettes are committed bytes), but the same pattern in live
mode is the boundary where a strict zod parse is warranted (RSCH-11 trust boundary).
**Fix:** Wrap each adapter's response parse in a small zod schema; treat parse failure as
`return []`. Same pattern applies to crossref.ts, openalex.ts, semanticscholar.ts.

### IN-04: bibtex-write.ts toCsl drops candidates without DOI/ISBN/arxivId without diagnostic (LOW / INFO)

**File:** `bin/lib/bibtex-write.ts:73-79`
**Issue:** Candidates lacking any persistent ID are silently dropped (line 79: `if
(!hasId) return null`). The research workflow can produce them (a Google-scholar-ish
discovery path in Phase 4+, or a malformed cassette today), and the writer eats them. No
log line, no warning, no diagnostic counter. The user sees fewer entries in CITATIONS.bib
than in LIBRARY.json with no explanation. The retraction-watch adapter, which **does**
emit candidates with DOI, is unaffected — but reachable from the dedup pipeline.
**Fix:** Emit a `process.stderr.write` count of dropped candidates with their titles, so
the user can audit. Add to the Pass-1 diagnostics in VERIFICATION.md.

## Architecture Invariant Checks (all PASS — no findings)

- **D-07 atomic-write chokepoint**: every persistent write in scope (handoff.ts:80,
  bibtex-write.ts:184, intake.ts:67, research.ts:63-67, outline.ts:45, plan.ts:67,
  write.ts:71, verify.ts:74,80,100,135, http.ts:439) routes through `atomicWriteFile`.
  `hooks/post-tool-use.ts:50` uses `appendFileSync` — that is throttle/append-only and
  not a durable write, so the chokepoint is preserved. CR-04 is an orthogonal
  concurrency bug.
- **D-19 citation-js chokepoint**: only `bin/lib/bibtex-write.ts:33` and
  `bin/lib/verify/pass1.ts:28` import from `'./citations.js'`; no source file imports
  `'citation-js'` directly.
- **D-15 retraction-watch fetchById-only**: `bin/lib/sources/retraction-watch.ts` exports
  only `fetchById` (no `search` export). `index.ts:27` registers it under the union;
  consumers that iterate are told (header comment) to guard with `'search' in adapter`.
- **D-12 LOCKED 8 prompt slugs**: prompt-loader.ts:87-101 enumerates exactly the 8 slugs;
  no other slug files exist under `templates/prompts/`.
- **D-13 dormancy**: `grep "pass1-fuzzy-judge\|pass3-quote-checker\|loadPrompt"
  workflows/verify.md` returns zero hits. Verify body is template-literal narration only.
- **HANDOFF 5 KB cap**: both the schema refine and the explicit writeHandoff guard enforce
  it (modulo WR-02 inconsistency).
- **Path-traversal mitigation**: `validateSlug` is called on every strict-section helper.
  `slugify` rejects `..`. The slug regex is linear (no nested quantifier — no ReDoS).
- **No exported metadata trace**: no code in scope writes a `.docx` / `.pdf` (export verb
  is deferred per Phase 6 ROADMAP); the templates/citation-styles/apa.csl is an unmodified
  CSL standard file and carries no pensmith fingerprint.
- **Approval-gates default-on**: all CLI verbs declare `yolo: { type: 'boolean', default:
  false }` (intake.ts:50, outline.ts:38, plan.ts:54, write.ts:46, verify.ts:57).

---

_Reviewed: 2026-05-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
