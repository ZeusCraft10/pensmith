# Phase 4: Breadth — N Sections + Compile + Wave Scheduling — Research

**Researched:** 2026-05-29
**Domain:** wave scheduler, compile pipeline, multi-section orchestration, boundary smoothing, citation-swap revise
**Confidence:** HIGH (overwhelmingly grounded in existing locked decisions D-01..D-15 in this CONTEXT.md and carry-forward D-01..D-25 from Phase 3 CONTEXT.md; almost no new external research required because the technical surface for Phase 4 is largely a recomposition of Phase 1-3 chokepoints)
**Knowledge graph note:** Graph cache 310h stale at research time — any semantic relationships surfaced from graph queries treated as approximate; all load-bearing claims re-verified by direct file reads.

---

<user_constraints>
## User Constraints (from 04-CONTEXT.md)

### Locked Decisions (D-01 through D-15 — SOURCE OF TRUTH; do not re-litigate)

- **D-01 — Scheduler algorithm:** Kahn topological sort + per-section optional `wave: <int>` override in PLAN.md frontmatter. Validator REJECTS an override if `wave < max(depends_on.wave) + 1`. No partial overrides.
- **D-02 — Concurrency primitive & default:** `--max-parallel 5` default in Tier 1; Tier 2 (portable CLI) forces `--max-parallel 1` and emits a WARN. Primitive must already exist in repo (do not add p-limit).
- **D-03 — Within-wave failure policy:** Sibling failures in the same wave do NOT cancel other in-flight siblings. Transitive-dep failure (downstream wave) blocks only the dependent subtree; orthogonal subtrees continue.
- **D-04 — Scheduler statefulness:** READ-ONLY scheduler. Wave assignment is recomputed each run from outline + frontmatter; nothing persisted to STATE.json. (Confirms D-22 from Phase 3: STATE.json holds outline-discovered sections only.)
- **D-05 — `--revise` mechanic:** LLM citation-swap (revise-swap.md hash-pinned prompt). Approval gate default-on; `--yolo` skips. Existing draft hash and verification artifacts invalidated on accept (writes new `verified_against_draft_hash: null` until verifier re-runs).
- **D-06 — `pensmith revise --section N` CLI:** Tier-2 surface mirrors Tier-1 slash command. Both delegate to identical `bin/lib/revise.ts` core. WRTE-02 satisfied by this single chokepoint.
- **D-07 — `verified_against_draft_hash` exact input shape (LOCKED):**
  ```
  SHA-256(
    DRAFT.md bytes
    + '\n'
    + JSON.stringify(plan.assigned_sources.slice().sort())
  )
  ```
  Citekey array sorted alphabetically (default JS sort). Single trailing newline separator. No BOM, no normalization on draft bytes.
- **D-08 — Compile staleness handling:** WARN + auto-re-verify (Pass 1 + Pass 3 only — they're cheap and deterministic). No hard block; never invokes Pass 2/4. If re-verify FAIL, compile blocks per PRD §14.
- **D-09 — `--research` flag semantics:** Append to project-level `.paper/RESEARCH.md` AND per-section `sections/<NN-slug>/RESEARCH-LOG.md`. Both atomic-appends (≤PIPE_BUF or atomicWriteFile fallback).
- **D-10 — RSCH-10 auto-recheck timing:** Verifier (Pass 1) recomputes a "freshness probe" on every run. Stale source (DOI HEAD failure, retraction-watch hit) → WARN in VERIFICATION.md, does NOT block. Hard block only on FABRICATED/MIS-CITED/quote-NOT_FOUND (PRD §14).
- **D-11 — COMP-02 concatenation order:** Strictly OUTLINE order (1..N), never wave order. Wave order is only an execution detail for parallel writes.
- **D-12 — COMP-03 boundary smoothing:** N-1 per-boundary smoothing calls (not single big pass). Each call sees [tail_of_section_K, head_of_section_K+1] window only. Smoother prompt is hash-pinned at `templates/prompts/smoother.md`.
- **D-13 — Smoother citation-token protection:** Pre-call substitution `[@key]` → `{{cite_K_M}}` (K=section, M=index-within-window). LLM never sees raw tokens. Post-call token-set equality check: if set differs, ABORT smoother for that boundary and fall back to raw concat (with WARN in COMPILE-REPORT).
- **D-14 — COMPILE-REPORT.md schema (v1):** 5 body sections: `## Sections Compiled`, `## Boundary Smoothing`, `## Re-verification Results`, `## Cross-Section Consistency`, `## Warnings`. Plus YAML frontmatter: `schema_version: 1`, `compiled_at: <ISO>`, `outline_hash: <sha256>`, `pandoc_target: <docx|pdf>`. Frontmatter keys reserved for Pandoc namespace; do not pollute.
- **D-15 — Letter-suffix path scheme:** RESERVED but no `/pensmith add` insertion command ships in Phase 4. Phase 4 code must NOT break under a future `02b-validity-threats/` directory, but does not need to emit/handle them yet.

### Claude's Discretion (research and recommend)

- Exact in-memory wave-graph data structure (must use existing `Semaphore` from `bin/lib/budget.ts`; no new deps)
- Whether wave progress streams via a NEW MCP resource or piggy-backs on `paper://state` (lean toward minimal new surface)
- Exact smoother prompt scaffold body (hash-pinned per D-12; must include the substitution table and token-equality check instruction)
- Exact revise-swap prompt scaffold body (hash-pinned; must require explicit BEFORE/AFTER citekey diff so approval UI can render diff)
- Cross-section consistency scan rules (heuristic list — proper-noun divergence, abbreviation collisions, tense drift)
- Suggested plan decomposition for Phase 4 (recommend N plans + wave layout)

### Deferred Ideas (OUT OF SCOPE for Phase 4)

- Pass 2 (LLM author/title fuzzy judge) and Pass 4 (LLM quote-verify) — Phase 5 advisory-only
- `/pensmith add --after N --slug ...` insertion command — Phase 6+
- Multi-style citations beyond APA-7 CSL — Phase 10
- Style-match to past writing — Phase 8
- Humanizer pass and GPTZero detection — Phase 6
- Free-only plagiarism check — Phase 7
- Cross-paper library reuse / global LIBRARY persistence beyond per-project bib — backlog
- Section renumbering policy (stable vs. renumber on insert) — locked in Phase 6 when `add` ships
- Library index format (JSON / SQLite / sidecar) — beyond Phase 4 scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **ARCH-19** | Wave-scheduler primitive (in-process bounded parallel) | Question A — reuse existing `Semaphore` in `bin/lib/budget.ts`; no new deps |
| **ARCH-20** | Read-only scheduler statefulness (no on-disk wave state) | Question B + D-04 — scheduler holds graph in memory only; recomputes each run |
| **PLAN-02** | Per-section PLAN.md emits `wave: <int>` (optional) override | Questions B, J — PlanFrontmatterSchema gets optional `wave: z.number().int().positive().optional()` |
| **PLAN-03** | Scheduler validates wave override against deps (`wave >= max(deps.wave)+1`) | Question B — Kahn + validator step |
| **WRTE-02** | `/pensmith revise --section N` swaps a flagged citation, invalidates verification | Questions E, I + D-05/D-06 — single `bin/lib/revise.ts` chokepoint, approval gate, frontmatter reset |
| **RSCH-10** | Verifier auto-rechecks source freshness on every run | Question J + D-10 — Pass 1 freshness probe (DOI HEAD + retraction-watch); WARN-only |
| **COMP-01** | Compile gated on every section having `verified_against_draft_hash` matching CURRENT draft | Questions E, F + D-08 — staleness check at compile entry; auto-re-verify before block |
| **COMP-02** | Concatenate in OUTLINE order, not wave order | Question F + D-11 — sort by section.n ascending |
| **COMP-03** | N-1 per-boundary smoothing calls with citation-token protection | Questions G, H + D-12/D-13 — smoother prompt + substitution table |
| **COMP-04** | DRAFT.md emitted via atomicWriteFile | Question F + D-07 (Phase 3) — sole `atomicWriteFile` writer |
| **COMP-05** | CITATIONS.bib regenerated at compile time from project bib | Question F — bibtex-write.ts re-render (D-19 chokepoint) |
| **COMP-06** | COMPILE-REPORT.md emitted with 5 body sections + frontmatter | Question F + D-14 — schema v1 frozen |
| **COMP-07** | Cross-section consistency scan emits warnings into COMPILE-REPORT (does NOT block) | Question G — heuristic list, not blocking |

### Phase 4 Success Criteria (from ROADMAP)

1. `/pensmith write` schedules N independent sections into waves and writes them in parallel (Tier 1) or sequentially (Tier 2).
2. `/pensmith compile` produces `.paper/DRAFT.md` (concatenated, smoothed, citations resolved) and `.paper/COMPILE-REPORT.md`.
3. `/pensmith revise --section N` performs citation-swap-and-redraft with approval gate.
4. Verifier auto-re-runs at compile if any section's `verified_against_draft_hash` doesn't match current DRAFT.md.
5. No Pass 2/Pass 4 wiring; advisory-only Phase 5.
</phase_requirements>

---

## 1. Executive Summary

Phase 4 composes Phase 1-3 chokepoints into multi-section orchestration. It is a **recomposition phase, not a discovery phase**: every primitive needed already ships (Semaphore in budget.ts, atomicWriteFile, frontmatter parser, deterministic Pass 1+3, hash-pinned prompt loader, citation-js chokepoint, BibTeX writer, HANDOFF.json), and Phase 4 wires them together behind two new CLI commands (`/pensmith compile`, `/pensmith revise`) and one enhancement to `/pensmith write` (wave scheduling).

The load-bearing technical decisions are already locked in CONTEXT.md (D-01..D-15). Research confirms each is implementable against existing code without new dependencies. The most consequential finding: **the wave scheduler primitive must reuse `Semaphore` from `bin/lib/budget.ts`** (added Phase 1 D-50 for OpenRouter rate limiting), not import a new bounded-parallel library — this preserves the Phase 1 D-15 zero-runtime-deps policy AND makes Tier 2's `--max-parallel 1` degrade cleanly (Semaphore(1) is just sequential execution).

The compile pipeline is a 4-step deterministic pass — (1) outline-order concat, (2) N-1 boundary smoothing calls with citation-token escape/restore, (3) atomic write of DRAFT.md + regenerated CITATIONS.bib, (4) COMPILE-REPORT.md emission. Staleness handling (D-08) routes through the existing Pass 1+3 verifier — no new logic, just an auto-invoke when frontmatter hash diverges.

**Primary recommendation:** Decompose Phase 4 into **5 plans** (scheduler, write-orchestration, compile-pipeline, revise-swap, COMPILE-REPORT) running across 3 waves, with the scheduler and revise-swap as orthogonal subtrees so they parallelize. Total estimated complexity: ~12-15 tasks, dominated by smoother and revise-swap prompt authoring + hash-pinning.

---

## 2. Per-Question Findings

### Question A — Wave scheduler concurrency primitive

**Finding:** A bounded-parallel primitive **already exists** in `bin/lib/budget.ts` as the `Semaphore` class (Phase 1 D-50, originally for OpenRouter request fan-out). It provides:
- Constructor `new Semaphore(max: number)` with positive-integer validation
- `acquire(): Promise<() => void>` (returns a release function)
- `withLock<T>(fn: () => Promise<T>): Promise<T>` (RAII-style)
- Pure in-process; no external dependencies
- Lockless FIFO queue when contention exceeds `max`

**Recommendation:** **REUSE `Semaphore` directly.** Do not import `p-limit`, `p-map`, or any other bounded-parallel library. The wave scheduler is:

```typescript
import { Semaphore } from './budget.ts';

async function runWave(sections: Section[], maxParallel: number) {
  const sem = new Semaphore(maxParallel);
  const results = await Promise.allSettled(
    sections.map(s => sem.withLock(() => writeSection(s)))
  );
  return results; // 'fulfilled' / 'rejected' per D-03 within-wave-failure policy
}
```

Tier 2's `--max-parallel 1` is just `new Semaphore(1)` — effectively sequential, no special-case code path needed. `Promise.allSettled` matches D-03 (siblings don't cancel each other on failure).

**Evidence:**
- `bin/lib/budget.ts` (lines ~85-160) defines `Semaphore` with the API above (verified during context-gathering).
- Phase 1 D-15 (zero runtime deps beyond locked manifest) is preserved.
- Phase 1 D-50 added Semaphore for OpenRouter; reusing it satisfies D-02 verbatim.

**Open Risks:**
- If Semaphore is buried inside budget.ts as a private (non-exported) class, Phase 4 Wave 0 needs to export it OR move it to `bin/lib/semaphore.ts`. Verify export visibility first task of Phase 4.
- `Promise.allSettled` rejection branches must thread through to the wave-level result aggregator so D-03's "transitive-dep failure blocks downstream" semantics work. A failed section's slug must be visible to the next-wave scheduler step to prune its dependents.

---

### Question B — In-memory wave-graph data structure

**Finding:** Three viable shapes; the simplest fits Phase 4.

**Recommendation:** Use a flat `Map<slug, SectionNode>` plus a derived `waves: Section[][]` array, both held in scheduler-local memory, never persisted. Schema:

```typescript
interface SectionNode {
  n: number;                    // outline order (1..N)
  slug: string;                 // primary key
  title: string;
  depends_on: string[];         // slugs (matches Phase 3 D-03)
  wave_override?: number;       // from PLAN.md frontmatter (D-01, optional)
  computed_wave: number;        // Kahn output OR validated override
  status: 'pending' | 'in_flight' | 'done' | 'failed' | 'blocked';
}

interface WaveGraph {
  nodes: Map<string, SectionNode>;
  waves: SectionNode[][];       // waves[0] = roots, waves[k] = depth-k
}
```

**Construction:**
1. Parse `.paper/OUTLINE.md` (parser TBD — see Question C; this is a Wave 0 task).
2. Walk each section's PLAN.md frontmatter to populate `depends_on` (slugs) and `wave_override`.
3. Kahn topological sort assigns `computed_wave` = depth-of-deepest-dep + 1 (roots = wave 1).
4. For each section with `wave_override`: validate `wave_override >= max(deps.computed_wave) + 1`. REJECT (exit 2, structured error) if violated (D-01).
5. If valid override exceeds Kahn depth, promote `computed_wave` to override. (Honors user intent to defer a section.)
6. Cycle detection on graph build: any non-empty residual after Kahn → exit 2 with the cycle's slug list.

**Evidence:**
- D-01/D-04 already pin algorithm and statefulness.
- Phase 3 D-03/04/05 pinned `depends_on: slug[]` schema in PlanFrontmatterSchema.
- D-15 letter-suffix reserve: this Map keyed by slug — letter-suffix-tolerant by construction (slug is the immutable key, `n` is the ordering attribute).

**Open Risks:**
- Validator error UX: a missing dep (PLAN.md references `validity-threats` but no section with that slug exists) needs a friendly message pointing to the OUTLINE entry. Wave 0 task: design the error format.
- If a section has zero PLAN.md (i.e., user ran `/pensmith write` for sections 1-3 but not 4), the scheduler must skip section 4 with INFO, not error. Walk only sections whose PLAN.md exists; treat missing PLAN.md as "not yet planned, skip this run."

---

### Question C — Outline-order iteration helper

**Finding:** Current `bin/lib/outline.ts` (22 lines) exposes only `loadOutline(paperRoot): Promise<string>` — returns raw OUTLINE.md as a string with empty-string fallback on ENOENT. **There is no parsed-outline helper.** This is the single most important missing piece for Phase 4.

**Recommendation:** Add `parseOutline(rawMd: string): ParsedOutline` in a new module `bin/lib/outline-parse.ts` (keeps the read-side `outline.ts` untouched). Shape:

```typescript
interface ParsedOutlineSection {
  n: number;                      // 1-indexed
  slug: string;                   // validated via paths.ts::validateSlug
  title: string;                  // raw heading text
  estimated_word_count?: number;  // optional, from inline marker
  role?: string;                  // optional 'intro'|'method'|'results'|...
}

interface ParsedOutline {
  paper_title: string;
  sections: ParsedOutlineSection[];   // ordered by appearance (= outline order)
}
```

Parser is markdown-heading-based: each `## <N>. <Title> (<slug>)` (or whatever Phase 2 outline-author.md emits — verify against an existing outline before locking the regex) becomes a section. Bare YAML frontmatter at top of OUTLINE.md may carry paper_title and global metadata.

**Used by:**
- `bin/lib/scheduler.ts` (new) — builds WaveGraph
- `bin/lib/compile.ts` (new) — orders sections for COMP-02 concat
- Validator for `/pensmith write` — confirms requested section number exists in outline before invoking drafter

**Evidence:**
- `bin/lib/outline.ts` lines 1-22 — confirmed only raw-text loader exists.
- `bin/lib/section.ts::loadSection(paperRoot, n)` already takes `n: number` — compatible with `ParsedOutlineSection.n`.
- `bin/lib/paths.ts::validateSlug` — reuse for slug validation.

**Open Risks:**
- Phase 2 outline-author prompt emits the outline structure. Need to read the exact format Phase 2 settled on before writing the regex. Recommend Wave 0 task: read one shipped outline from a test fixture (if any) OR draft a Phase 2 outline format spec quickly.
- If the parser is too lenient (accepts loosely-formatted user-edited outlines), edge cases will surface in Phase 4 compile. Recommend strict parser + clear "couldn't parse line X" error.

---

### Question D — Citation token regex

**Finding:** Regex **already locked and in use** in `bin/lib/verify/pass1.ts`:
```
/\[@([a-z][a-z0-9_-]*)\]/g
```
Citekey grammar `CITEKEY_RE = /^[a-z][a-z0-9_-]*$/` is locked in `bin/lib/citekey.ts` (Phase 3 D-14).

**Recommendation:** **Reuse the existing constant**. Extract to a shared module if not already (`bin/lib/citation-token.ts` could export `CITATION_TOKEN_RE` + `extractCitekeys(md: string): string[]` + `replaceCitekeys(md: string, fn: (key: string) => string): string`). Phase 4's smoother substitution (D-13) needs the `replace` helper, and the compile pipeline's "tokens-resolved" check needs the `extract` helper.

**Evidence:**
- `bin/lib/verify/pass1.ts` lines ~30-50 — regex used in extraction.
- `bin/lib/citekey.ts` — CITEKEY_RE locked.
- D-21 (Phase 3) — Pandoc citation token format `[@key]` is the on-disk format until compile.

**Open Risks:**
- Pandoc supports richer syntax (`[@key, p. 23]`, `[@a; @b]`). Phase 4 must decide: support these or restrict to bare `[@key]`. **Recommendation: restrict to bare `[@key]` for Phase 4** (drafter prompt enforces this — verify Phase 3 section-drafter.md instructs the model to use bare tokens only). Multi-citation per token and locator/page-number support is a Phase 10 extension.
- The substitution placeholder `{{cite_K_M}}` (D-13) must NOT match the regex — confirmed: `{{...}}` is not `[@...]`, no collision.

---

### Question E — `verified_against_draft_hash` exact format

**Finding:** Locked in D-07:
```
SHA-256(
  DRAFT.md bytes
  + '\n'
  + JSON.stringify(plan.assigned_sources.slice().sort())
)
```

**Recommendation:** Implement as a single pure helper `bin/lib/draft-hash.ts::computeDraftHash(draftBytes: Buffer, assignedSources: string[]): string`. Centralize so both the writer (sets the hash after verification) and the compile-staleness check (recomputes and compares) use identical logic. Test cases:

```
- empty assigned_sources → hash(draft + '\n' + '[]')
- single citekey → hash(draft + '\n' + '["smith2020"]')
- multi citekey → sorted alphabetically, then JSON.stringify (not Set, not Map)
- draft with CRLF — bytes-as-stored, NO normalization
- UTF-8 BOM in draft — included if present in file (we don't strip)
```

**Evidence:**
- `bin/lib/schemas/plan-frontmatter.ts` confirms `assigned_sources: z.array(z.string())` (array of strings = citekeys).
- D-07 explicit; `.slice().sort()` is `Array.prototype.sort` default = lexicographic ASCII.
- Single trailing newline separator; no double newline, no BOM.

**Open Risks:**
- A draft that legitimately ends with `\n` followed by hash-relevant content (it can't, since `\n + JSON` is appended afterward) — non-issue: trailing newline in the draft becomes `...\n\n["..."]` which is a deterministic input.
- The hash is consumed by COMP-01 staleness check: at compile time, **the input draft is the section's DRAFT.md (per-section), not the compiled .paper/DRAFT.md**. Be explicit in the helper docstring: this is a per-section hash, not a project-level hash.

---

### Question F — Compile pipeline file layout

**Finding:** Phase 4 introduces **two new project-level files** beyond Phase 3 outputs:
- `.paper/DRAFT.md` — compiled, smoothed, citation-tokens-still-present (Pandoc resolves at export, Phase 6)
- `.paper/COMPILE-REPORT.md` — D-14 schema v1

Existing files at compile entry:
- `.paper/OUTLINE.md` (Phase 2)
- `.paper/RESEARCH.md` (Phase 2)
- `.paper/CITATIONS.bib` (Phase 3 — but regenerated by COMP-05 at compile)
- `.paper/sections/<NN-slug>/PLAN.md`, `DRAFT.md`, `VERIFICATION.md`, `HANDOFF.json` (Phase 3, all sections)

**Recommendation:** Compile pipeline (in `bin/lib/compile.ts`):

```
1. Load outline (parseOutline)
2. For each section in outline order:
   a. Load PLAN.md frontmatter → check verified_against_draft_hash
   b. If hash != computeDraftHash(currentDraftBytes, sources):
      → WARN, invoke Pass 1+3 re-verify (D-08)
      → If re-verify FAIL: BLOCK compile, exit 1 with section list
   c. Load DRAFT.md text
3. Concatenate texts in outline order with separator '\n\n' (COMP-02 = D-11)
4. For k in 1..N-1:
   a. Extract window [tail_K, head_K+1]
   b. Substitute citation tokens (D-13)
   c. Call smoother (hash-pinned prompt)
   d. Verify token-set equality → restore tokens OR fall back to raw concat with WARN
5. Run cross-section consistency scan (COMP-07 = heuristic, non-blocking; emits warnings)
6. Regenerate .paper/CITATIONS.bib via bibtex-write.ts (D-19) — pull all unique citekeys from compiled draft
7. atomicWriteFile('.paper/DRAFT.md', compiledText)
8. atomicWriteFile('.paper/COMPILE-REPORT.md', renderReport(...))
```

**All writes** through `atomicWriteFile` (D-07 Phase 3 sole-writer chokepoint).

**Evidence:**
- `bin/lib/atomic-write.ts` (194 lines) — `atomicWriteFile` is the chokepoint.
- `bin/lib/bibtex-write.ts` — citation-js chokepoint with citekey collision handling.
- Existing `workflows/compile.md` is a 24-line Phase 2 stub awaiting Phase 4 fill-in.

**Open Risks:**
- Concat separator: `\n\n` is the common markdown paragraph break; smoother sees [tail, head] across this separator. If a section's DRAFT.md ends without a trailing newline, the join may produce malformed markdown. Recommendation: normalize each section's draft to end in exactly one `\n` before concat.
- `.paper/RESEARCH.md` and per-section `RESEARCH-LOG.md` are append-only (D-09). They are NOT regenerated at compile; they accumulate across runs. Confirmed not in compile output set.

---

### Question G — Cross-section consistency scan rules (COMP-07, warn-only)

**Finding:** No prior art in repo — this is a new heuristic to design. PRD §14 places this as advisory-only (warnings, not blocks).

**Recommendation:** Three deterministic heuristics for Phase 4 (LLM-free, fast, cheap):

1. **Proper-noun divergence:** Extract all 2+ word Capitalized phrases per section (regex `\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b`). For each phrase appearing in 2+ sections, check exact-string equality. Variants ("Smith et al" vs "Smith et al.") → WARN.
2. **Abbreviation collision:** Find `(ABBR)` introductions (regex `\b[A-Z]{2,}\b` immediately following `(...)`). For each ABBR introduced in section K, check section K+1..N never re-introduces it. Re-introduction → WARN ("ABBR introduced twice").
3. **Tense drift in headings:** Section headings ending in `-ed`/`-ing` vs bare noun → WARN at low confidence. Optional; skip if noisy.

Emit each warning in COMPILE-REPORT.md under `## Cross-Section Consistency` with section refs (e.g., `[§2, §5]: "Bayesian Network" vs "Bayesian network"`).

**Recommendation rationale:** These are deterministic, cheap, well-bounded, and align with PRD §14 (no LLM in the deterministic verifier layer; consistency scan is part of compile, not verifier, but same spirit). They produce real value (a missed abbreviation reintroduction is a common multi-author paper bug) without false-positive flood.

**Evidence:**
- No existing consistency scanner in repo (grep confirmed).
- D-14 reserves `## Cross-Section Consistency` body section in COMPILE-REPORT.md schema.
- COMP-07 explicitly non-blocking.

**Open Risks:**
- Heuristics will produce some false positives (e.g., legitimate phrase variants). Phase 4 acceptance: tolerate FP-rate ≤30% as long as warnings are skimmable. Future enhancement (Phase 10+) could add LLM disambiguation.
- Heading-tense heuristic may be too noisy — recommend feature-flag it OFF by default and emit only if user opts in via `--lint-headings`.

---

### Question H — Smoother prompt scaffold (D-12, hash-pinned)

**Finding:** Smoother prompt is new; D-12 specifies hash-pinned, N-1 per-boundary windows, citation-token protection (D-13).

**Recommendation:** Author `templates/prompts/smoother.md` with this structural skeleton (final wording to be tuned during Phase 4 plan-phase):

```markdown
# Smoother Prompt (Phase 4)

You will receive the END of one paper section and the START of the next.
Your job: rewrite ONLY the transition (last paragraph of section A + first
paragraph of section B) so the boundary reads as a single continuous piece
of academic prose.

## Constraints (hard)

1. Do NOT change citation placeholders. They look like `{{cite_K_M}}`. 
   Treat each as an opaque token. Emit every input placeholder exactly
   once in the output; emit no new placeholders.
2. Do NOT change section headings or hierarchical structure.
3. Do NOT add citations, footnotes, or factual claims not present in the input.
4. Preserve technical terminology verbatim (case-sensitive).
5. Output ONLY the rewritten boundary text (last paragraph of A + first
   paragraph of B), in that order, separated by a single blank line.

## Input

### End of section <K>: <Title K>

<tail_of_section_K>

### Start of section <K+1>: <Title K+1>

<head_of_section_K+1>

## Output

Return rewritten boundary text only. No preamble, no explanation.
```

Add hash to `EXPECTED_PROMPT_HASHES` in `prompt-loader.ts`. The `loadPrompt('smoother')` call validates at runtime.

**Recommendation rationale:** Locked constraints (1-5) match D-13 (citation token protection) and the broader PRD §14 spirit (no claim invention). The "last paragraph of A + first paragraph of B" window keeps the LLM input bounded (~1-2K tokens per call) so N-1 calls remain cheap.

**Evidence:**
- D-12, D-13 fully specify the contract.
- `bin/lib/prompt-loader.ts` (lines 1-195) — `EXPECTED_PROMPT_HASHES` dict + `loadPrompt(name)` validates at runtime.
- Phase 3 D-12/D-13 pattern (hash-pinned prompts at templates/prompts/) is the established convention.

**Open Risks:**
- Token-set equality post-check (D-13): if smoother drops a placeholder, fallback to raw concat for that boundary. Need to verify the fallback codepath also emits a clear `## Boundary Smoothing` warning in COMPILE-REPORT.md (D-14 §2).
- LLM may insert spurious whitespace or zero-width chars. Recommend normalize input/output via NFC before token-set comparison.
- Window size: "last paragraph + first paragraph" may be too small if either paragraph is 1 sentence. Consider "last 200 words" and "first 200 words" instead for stability. Decision: lock during plan-phase.

---

### Question I — `--revise` citation-swap prompt scaffold (D-05/D-06)

**Finding:** Revise-swap prompt is new; D-05 specifies LLM swap + approval gate; D-06 wires the same core into both Tier 1 slash command and Tier 2 CLI.

**Recommendation:** Author `templates/prompts/revise-swap.md`:

```markdown
# Revise-Swap Prompt (Phase 4)

A citation in this section was flagged by the verifier as FABRICATED or
MIS-CITED. Your job: produce a DIFF proposing which citekey to swap to,
or recommend deletion if no substitute exists in the assigned sources.

## Constraints (hard)

1. Pick replacement ONLY from the `## Available Sources` list below
   (these are the section's assigned_sources from PLAN.md frontmatter).
2. The replacement must support the surrounding claim. If no source in
   the list supports the claim, recommend REMOVE the citation and
   rephrase the sentence to remove the unsupported claim.
3. Do NOT add new citekeys. Do NOT pick from outside the assigned list.
4. Output STRICT JSON (no preamble):

   {
     "action": "swap" | "remove",
     "flagged_citekey": "<original>",
     "replacement_citekey": "<new>" | null,
     "rationale": "<one sentence>",
     "patch": {
       "before_excerpt": "<~50 chars context including the [@flagged]>",
       "after_excerpt": "<~50 chars context with [@replacement] OR rephrased>"
     }
   }

## Flagged citation

- Citekey: <flagged>
- Claim context: <surrounding sentence(s)>
- Verifier reason: <FABRICATED|MIS-CITED detail>

## Available sources

<bulleted list of assigned_sources with title + authors + year>
```

CLI flow:
1. Parse VERIFICATION.md for first failing citation (Phase 3 D-26 verification report format).
2. Load PLAN.md → extract `assigned_sources`.
3. Call LLM with revise-swap prompt; parse strict-JSON response.
4. **Approval gate (default-on; `--yolo` skips):** render the diff (before_excerpt vs after_excerpt) and prompt user. (Use `@clack/prompts` already in deps.)
5. On accept:
   a. Apply patch to DRAFT.md via atomicWriteFile.
   b. Reset PLAN.md frontmatter `verified_against_draft_hash: null` (D-05 invalidation).
   c. Mark section status `'planned'` (back to writing/verifying cycle) — actually leave as `'written'` so user re-runs `/pensmith verify`.
6. On reject: no-op, exit 0.

Add hash to `EXPECTED_PROMPT_HASHES`.

**Evidence:**
- D-05, D-06 specify mechanics.
- WRTE-02 requirement satisfied.
- `bin/lib/verify/pass1.ts` and `pass3.ts` emit structured failures (verified during context-gathering) — verifier output parseable.
- `@clack/prompts ^0.7` in package.json → approval UI primitive available.

**Open Risks:**
- Multi-failure handling: if VERIFICATION.md flags 3 citations, does `--revise` handle all 3 in one invocation or one-at-a-time? **Recommendation: one-at-a-time, in order of appearance.** User runs `/pensmith revise --section 2` repeatedly until clean. Simpler UX, simpler approval flow.
- The "REMOVE + rephrase" branch is risky — LLM rewrites prose. Recommendation: in Phase 4, support `action: "remove"` as "delete the citation token and the bracketed clause containing it" mechanically, NOT LLM-rewrite. Cleaner, more reviewable. If user wants substantive rewrite, they re-run `/pensmith write --section 2 --revise`.
- Tier 2 approval UI: `@clack/prompts` works in interactive TTY. For non-TTY Tier 2 (CI/script), exit with code 3 and a "use --yolo to auto-accept" message.

---

### Question J — RSCH-10 auto-recheck timing (D-10)

**Finding:** D-10 locks the policy: Pass 1 runs a freshness probe per source, WARN-only, never blocks. Hard block reserved for FABRICATED/MIS-CITED/quote-NOT_FOUND.

**Recommendation:** Extend `bin/lib/verify/pass1.ts` (or compose a new helper `bin/lib/verify/freshness.ts` called from pass1.ts) with:

1. For each citekey resolved against `.paper/CITATIONS.bib`:
   a. If has DOI: HTTP HEAD `https://doi.org/<doi>` (10s timeout, 1 retry via existing p-retry pattern).
   b. Check retraction-watch JSON feed (already integrated Phase 3 D-? — verify; otherwise stub for Phase 5).
2. On DOI HEAD failure (4xx/5xx after retry): emit WARN to VERIFICATION.md under new `## Source Freshness` section.
3. On retraction-watch hit: emit WARN (same section).
4. Cache results in-memory for run; do NOT persist (matches D-04 stateless principle for verifier-internal results).

Result format in VERIFICATION.md:
```markdown
## Source Freshness (RSCH-10)

| Citekey | Probe | Status | Detail |
|---------|-------|--------|--------|
| smith2020 | DOI HEAD | ✓ 200 | |
| jones2019 | DOI HEAD | ✗ 404 | WARNING — DOI may be invalid |
| brown2018 | retraction-watch | ✗ HIT | WARNING — paper retracted 2024-03-15 |
```

**Evidence:**
- D-10 specifies WARN-only.
- PRD §14 non-negotiable: only fabrication/mis-cite blocks.
- `bin/lib/retry.ts` (line 119 grep result) — p-retry pattern available.
- `undici ^7` in package.json — HEAD requests primitive.

**Open Risks:**
- Network failure (timeout, DNS error) should NOT be a WARN — that's network noise, not source staleness. Distinguish via response type: 4xx/5xx with a real status = WARN; ECONNREFUSED/ETIMEDOUT = silent (or DEBUG log).
- Retraction-watch feed format: confirm during Phase 4 Wave 0 that the chosen feed is still live (last verified in Phase 3 plan; sources can disappear).
- Rate limiting: probing 30 sources serially is slow; in parallel risks ban. Recommend `Semaphore(5)` for HEAD requests (same primitive as wave scheduler).

---

### Question K — Letter-suffix path audit (D-15)

**Finding:** Grep results for `parseInt|Number(`:
- `bin/cli/{plan,verify,write}.ts` — `Number(args.n)` parses CLI args, not directory names. SAFE.
- `mcp/resources.ts:60` — `Number(vars.n)` parses URI variable from `paper://section/{n}`. SAFE.
- `bin/lib/retry.ts:119` — parseInt of Retry-After header. SAFE.
- `bin/lib/prompts/numbered.ts` — parseInt of stdin input. SAFE.
- **No code does `parseInt(dirname)` or `Number(dirname)` to extract section number from a directory path.** Section discovery is consistently via outline parsing (when implemented) or via `loadSection(paperRoot, n)` which is given `n` directly.

**However:** `bin/lib/paths.ts::sectionDir(n, slug)` hardcodes the directory name as `${pad2(n)}-${safeSlug}` (e.g., `02-attention-mechanism`). Letter suffix (`02b-validity-threats`) is NOT produced by this helper. `pad2(n)` validates integer-in-[0,99] and emits 2-digit zero-padded string only.

**Recommendation:** **Phase 4 minimum:** introduce an OPTIONAL `letterSuffix?: string` parameter in `sectionDir`:

```typescript
export function sectionDir(n: number, slug: string, opts?: { letterSuffix?: string }): string {
  const prefix = opts?.letterSuffix ? `${pad2(n)}${opts.letterSuffix}` : pad2(n);
  return `${prefix}-${validateSlug(slug)}`;
}
```

Existing callers pass no `opts` → no behavior change. Phase 6 `add` command can pass `letterSuffix: 'b'`. Phase 4 does NOT emit suffixed paths (D-15) but the helper becomes tolerant.

**Section discovery (Phase 4):** the new scheduler iterates from parsed outline (which is the source of truth for which sections exist), not from `fs.readdir(.paper/sections)`. This means even if a user manually created `02b-foo/` on disk, Phase 4 scheduler ignores it unless outline references it. Future `add` command will add `02b-foo` to OUTLINE.md → it becomes visible.

**Evidence:**
- `bin/lib/paths.ts` (322 lines) — `sectionDir` and `pad2` reviewed.
- Grep for `readdir.*sections|globSync.*sections` (during context-gathering): no current code scans the sections directory.
- D-15: no `/pensmith add` ships in Phase 4.

**Open Risks:**
- One quiet bug: if Phase 4 code ever needs `fs.readdir` over sections (e.g., for "is this section folder orphaned?" linting), the readdir result will include directories whose basename is not parseable as `${pad2}-${slug}`. Defensive parser needed even if not used yet. **Recommendation:** add a `parseSectionDirName(basename): {n, letterSuffix, slug} | null` helper now (Wave 0 task), even if no callers in Phase 4. Cheap insurance.
- `STATE.json` SectionEntrySchema is currently `{n, slug}`. Letter-suffix would require adding `letter_suffix?: string` to the entry. Phase 4 does NOT need this (no add command), but schema migration v2→v3 will be needed in Phase 6. Note for backlog.

---

### Question L — MCP surface for wave progress

**Finding:** Existing MCP resources (`mcp/resources.ts`, 95 lines, 5 resources):
- `paper://state` — reads STATE.json
- `paper://outline` — reads OUTLINE.md
- `paper://section/{n}` — reads section payload
- `paper://research` — reads RESEARCH.md
- `paper://citations` — reads CITATIONS.bib

None expose wave progress. STATE.json (per D-04) does NOT carry wave state. MCP tool handlers are constrained to ≤30 lines (Phase 2 D-09).

**Recommendation:** **Two-tier approach:**

1. **Phase 4 (minimum):** Stream wave progress to STDERR/STDOUT as the scheduler runs — Tier 1 slash command surface is the calling LLM, which reads stdout. Use structured log lines:
   ```
   {"event":"wave_start","wave":1,"sections":["intro","background"]}
   {"event":"section_done","wave":1,"section":"intro","status":"verified","duration_ms":12400}
   {"event":"wave_complete","wave":1,"results":{"verified":2,"failed":0}}
   ```
   No new MCP resource needed; the LLM sees this in the tool output.

2. **Optional (Phase 4 stretch OR Phase 6):** Add `paper://compile-progress` resource that returns the most recent run's wave summary from in-memory cache held by the MCP server process. SKIP for Phase 4 unless wave 0 reveals a use case.

**Recommendation rationale:** Adding an MCP resource for ephemeral progress invites stale-data bugs (server process restarted between runs → stale or empty resource). Stdout streaming is the GSD plugin convention (see CLAUDE.md reference) and keeps the LLM in the loop without persistence headaches.

**Evidence:**
- `mcp/resources.ts` (lines 1-95) — 5 resources, all file-reads.
- Phase 2 D-09: MCP tool handler ≤30 lines.
- D-04: scheduler is read-only, no persisted state — same spirit for progress reporting.

**Open Risks:**
- If LLM/user wants mid-run "is wave 2 done?" introspection, they have to wait for the tool to finish. Acceptable Phase 4 tradeoff. Phase 6+ could add progress streaming.

---

### Question M — Validation Architecture (Nyquist)

See dedicated Section 3 below.

---

### Question N — Cassette plan

**Finding:** Phase 3 D-23/24/25 established the cassette pattern: ≤50KB per adapter, fixtures at `tests/cassettes/`, played back via `nock ^14` (already in deps).

**Recommendation:** Phase 4 cassettes:

1. **Wave scheduler cassettes:** Pure unit tests, no network. Cassettes not applicable.
2. **Compile pipeline cassettes:**
   - Smoother LLM call: 1 cassette per realistic boundary scenario (clean, missing-token-recovery, multi-paragraph). ~3 cassettes, each ≤5KB.
   - Re-verify path: reuse existing Phase 3 Pass 1 cassettes.
3. **Revise-swap cassettes:**
   - LLM swap suggestion call: 3 cassettes (swap-accepted-by-user, swap-rejected, remove-recommendation). Each ≤3KB.
4. **RSCH-10 freshness cassettes:**
   - DOI HEAD success, DOI HEAD 404, retraction-watch hit. 3 cassettes via nock. Each ≤2KB.

Total Phase 4 cassettes: ~9 new, total ~30KB. Well under per-adapter cap.

**Evidence:**
- Phase 3 D-23/D-24/D-25 established pattern.
- `tests/cassette-size.test.ts` enforces 50KB ceiling.
- `nock ^14` in package.json.

**Open Risks:**
- Smoother cassette may exceed 5KB if section windows are large. Recommend test fixtures use small (≤200-word) paragraphs to keep cassettes small.
- Retraction-watch feed format may change; cassette becomes stale. Acceptable — they get refreshed when test re-records.

---

### Question O — Tier-contract test cases for Phase 4

**Finding:** `tests/tier-contract.test.ts` exists (Phase 3). Phase 4 adds new commands (`/pensmith compile`, `/pensmith revise`, enhanced `/pensmith write` with wave scheduling).

**Recommendation:** Three new tier-contract test cases:

1. **`compile` parity:**
   - Setup: 3-section paper, all verified.
   - Tier 1 run: invoke MCP-backed compile flow.
   - Tier 2 run: invoke `pensmith compile` CLI.
   - Assert: both produce identical `.paper/DRAFT.md` modulo timestamps; both emit COMPILE-REPORT.md with same `## Sections Compiled` body.
   - Length-equivalence: ≤±20% on smoother output deltas (D-? from Phase 3 tier-contract).

2. **`revise` parity:**
   - Setup: 1 section with 1 flagged citation in VERIFICATION.md, `--yolo` for auto-accept.
   - Both tiers should produce identical patched DRAFT.md and identical frontmatter reset (`verified_against_draft_hash: null`).

3. **`write` with wave scheduling parity:**
   - Setup: 3 sections, slugs `a`, `b`, `c`, dependencies `b→a`, `c→a` (b and c are wave-2 siblings).
   - Tier 1 (--max-parallel 5): both b and c may run in parallel — assert ORDER doesn't matter, but both complete.
   - Tier 2 (--max-parallel 1): sequential — assert b completes before c starts (or any deterministic order); assert WARN emitted about forced sequential.
   - Assert: both tiers end with identical final state for all 3 sections.

**Evidence:**
- `tests/tier-contract.test.ts` exists; D-50 (Phase 1) and Phase 3 D-? established length-equivalence tolerance.
- `package.json` script `test:tier-contract` runs these.

**Open Risks:**
- Parallel execution timing non-determinism: assertions must be on final-state, not on intermediate order. Use settled-state diff, not order-of-events.

---

### Question P — Common pitfalls

1. **Wave-cycle silent acceptance:** if Kahn algorithm has a bug, cycle goes undetected. **Mitigation:** explicit cycle-detect step after Kahn (check `nodes.size == sum(waves[].length)`); if not equal, error with the unprocessed slug list.
2. **Compile reads stale DRAFT.md while section is being re-verified:** **Mitigation:** compile is single-threaded after wave scheduler completes. Re-verify (D-08) runs SEQUENTIALLY before any concat. No race.
3. **Smoother edits a citation token despite the substitution:** **Mitigation:** post-call token-set equality check (D-13); fallback to raw concat.
4. **`Semaphore` deadlock under nested `withLock`:** **Mitigation:** wave scheduler does NOT nest withLock calls. Each section's write is a single top-level acquire.
5. **`Promise.allSettled` swallowing logical errors:** if a section throws a non-Error object, the rejection.reason is opaque. **Mitigation:** wrap each writeSection call in `try/catch` that normalizes to `{ slug, error: serializeError(e) }` before letting Promise.allSettled see it.
6. **Atomic write race on `.paper/DRAFT.md`:** two compile invocations running in parallel would corrupt. **Mitigation:** `atomicWriteFile` is rename-based so the final file is always consistent, but compile is a long pipeline. **Hold a `proper-lockfile` lock on `.paper/` for the entire compile run** (already a Phase 1 pattern in state.ts).
7. **Revise-swap removing a citation that's referenced elsewhere in the same section:** if a section cites `[@smith2020]` twice and revise only patches the first occurrence, the second is now orphaned. **Mitigation:** revise prompt receives ALL occurrences as the patch target; or restrict revise to one-citation-at-a-time and run multiple passes.
8. **COMPILE-REPORT.md schema_version mismatch:** if a future Phase regenerates the report with `schema_version: 2`, existing readers break. **Mitigation:** D-14 freezes schema v1 with refuse-forward-incompat (consistent with ARCH-07).
9. **Letter-suffix slug collision:** `02b-validity-threats` and `02-validity-threats` could both exist. **Mitigation:** outline parser rejects duplicate slugs regardless of suffix prefix.
10. **`citation-js` lazy plugin registration race:** Phase 3 surfaced this. **Mitigation:** `bin/lib/citations.ts` chokepoint already handles registration; Phase 4 BibTeX regeneration goes through `bibtex-write.ts` which already imports from `citations.ts`.

---

### Question Q — Web/docs research

**Finding:** Phase 4 surface is overwhelmingly defined by repo's own locked conventions (D-01..D-15 + Phase 3 carry-forward). External research needed only for:

1. **Topological sort edge cases:** Kahn algorithm is textbook (Knuth Vol 1). No external research required.
2. **Pandoc citation token format:** Confirmed [@key] is standard ([pandoc-citeproc docs](https://pandoc.org/MANUAL.html#citation-syntax)). Locator syntax `[@key, p. 23]` is OPTIONAL — explicitly out of Phase 4 scope.
3. **`undici` HEAD-request idioms:** `fetch(url, {method: 'HEAD'})` works in undici ≥6. No special handling.
4. **`proper-lockfile` re-entrant behavior:** Already used in state.ts. Not re-entrant by default; nested `lock(path)` calls on same path will block. **Mitigation:** compile pipeline acquires the `.paper/` lock once at entry, releases at exit. No nested calls.

No new ecosystem decisions required. Phase 4 is a wiring exercise on top of Phase 1-3 foundations.

**Sources:**
- Confidence: HIGH — all decisions trace to repo-internal locked decisions or first-principles algorithms.

---

### Question R — Project skill check

**Finding:** `.claude/skills/` does NOT exist in this project. The user's global `~/.claude/skills/humanizer/` skill IS referenced by CLAUDE.md as the humanize backend, but that's Phase 6 territory, not Phase 4.

**Recommendation:** No project skills applicable to Phase 4. Phase 4 plans should not invoke skills. (Phase 6 will wire humanizer.)

**Evidence:**
- Glob `.claude/skills/**` → empty.
- CLAUDE.md confirms humanizer is global and Phase 6 scope.

---

## 3. Validation Architecture (Nyquist)

> Required by config (`workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `tsx` for TS execution |
| Config file | none — `scripts/run-tests.mjs` is the dispatcher |
| Quick run command | `node --import tsx --test tests/<specific>.test.ts` |
| Full suite command | `npm test` |
| Cassette/contract subset | `npm run test:tier-contract` |
| Full check | `npm run check` (lint + typecheck + build + tier-contract + tests + manifests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-19 | `Semaphore`-based bounded parallel with `--max-parallel` honored | unit | `node --import tsx --test tests/wave-scheduler.test.ts` | ❌ Wave 0 |
| ARCH-20 | Scheduler holds NO on-disk state (STATE.json unchanged across runs) | integration | `node --import tsx --test tests/scheduler-stateless.test.ts` | ❌ Wave 0 |
| PLAN-02 | PLAN.md `wave: 3` frontmatter override is honored | unit | `node --import tsx --test tests/wave-override.test.ts` | ❌ Wave 0 |
| PLAN-03 | Validator REJECTS `wave: 1` when dep is in wave 2 | unit | `node --import tsx --test tests/wave-override.test.ts -t reject` | ❌ Wave 0 |
| WRTE-02 | `revise --section N --yolo` patches DRAFT.md and resets hash | integration | `node --import tsx --test tests/revise-swap.test.ts` | ❌ Wave 0 |
| RSCH-10 | Stale DOI emits WARN, does not block | unit (cassette) | `node --import tsx --test tests/freshness-probe.test.ts` | ❌ Wave 0 |
| COMP-01 | Compile WARNS + auto-re-verifies when frontmatter hash diverges | integration | `node --import tsx --test tests/compile-staleness.test.ts` | ❌ Wave 0 |
| COMP-02 | Compile output = outline order, not wave order | unit | `node --import tsx --test tests/compile-order.test.ts` | ❌ Wave 0 |
| COMP-03 | Smoother runs N-1 times for N sections | integration (cassette) | `node --import tsx --test tests/compile-smoother.test.ts` | ❌ Wave 0 |
| COMP-03 (D-13) | Token-set drift triggers raw-concat fallback + WARN | unit | `node --import tsx --test tests/smoother-token-protect.test.ts` | ❌ Wave 0 |
| COMP-04 | All compile writes route through atomicWriteFile | unit | extend `tests/atomic-write-chokepoint.test.ts` | partial |
| COMP-05 | CITATIONS.bib regenerated at compile (citekey collisions resolved) | integration | `node --import tsx --test tests/compile-bib-regen.test.ts` | ❌ Wave 0 |
| COMP-06 | COMPILE-REPORT.md matches schema v1 (5 body sections + frontmatter) | unit | `node --import tsx --test tests/compile-report-schema.test.ts` | ❌ Wave 0 |
| COMP-07 | Cross-section consistency emits warnings, never blocks | unit | `node --import tsx --test tests/consistency-scan.test.ts` | ❌ Wave 0 |
| D-15 (path tolerance) | `parseSectionDirName("02b-foo")` returns `{n:2, letterSuffix:'b', slug:'foo'}` | unit | `node --import tsx --test tests/letter-suffix-paths.test.ts` | ❌ Wave 0 |
| Tier contract (compile) | Tier 1 vs Tier 2 produce equivalent DRAFT.md | tier-contract | `npm run test:tier-contract` (extend) | partial |
| Tier contract (revise) | Tier 1 vs Tier 2 produce identical patch | tier-contract | `npm run test:tier-contract` (extend) | partial |
| Tier contract (write) | Tier 1 parallel vs Tier 2 sequential produce same final state | tier-contract | `npm run test:tier-contract` (extend) | partial |

### Sampling Rate
- **Per task commit:** `node --import tsx --test tests/<changed-area>.test.ts`
- **Per wave merge:** `npm test` (full suite, ~60s)
- **Phase gate:** `npm run check` (full check) green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/wave-scheduler.test.ts` — covers ARCH-19
- [ ] `tests/scheduler-stateless.test.ts` — covers ARCH-20
- [ ] `tests/wave-override.test.ts` — covers PLAN-02, PLAN-03
- [ ] `tests/revise-swap.test.ts` — covers WRTE-02 + D-05/D-06
- [ ] `tests/freshness-probe.test.ts` — covers RSCH-10
- [ ] `tests/compile-staleness.test.ts` — covers COMP-01
- [ ] `tests/compile-order.test.ts` — covers COMP-02
- [ ] `tests/compile-smoother.test.ts` — covers COMP-03
- [ ] `tests/smoother-token-protect.test.ts` — covers D-13
- [ ] `tests/compile-bib-regen.test.ts` — covers COMP-05
- [ ] `tests/compile-report-schema.test.ts` — covers COMP-06
- [ ] `tests/consistency-scan.test.ts` — covers COMP-07
- [ ] `tests/letter-suffix-paths.test.ts` — covers D-15
- [ ] `tests/cassettes/smoother-clean.json` + `smoother-token-drift.json` + `smoother-multi-paragraph.json`
- [ ] `tests/cassettes/revise-swap-suggest.json` + `revise-swap-remove.json` + `revise-swap-rejected.json`
- [ ] `tests/cassettes/doi-head-ok.json` + `doi-head-404.json` + `retraction-watch-hit.json`
- [ ] Extend `tests/tier-contract.test.ts` with compile + revise + write-wave cases

No new test framework install needed; `node:test` + `tsx` + `nock` already in place.

---

## 4. New Files Inventory

Grouped by suggested plan-grouping (see Section 5).

### Plan 1: Wave Scheduler

| Path | Purpose |
|------|---------|
| `bin/lib/outline-parse.ts` | NEW — `parseOutline(rawMd): ParsedOutline` |
| `bin/lib/scheduler.ts` | NEW — Kahn + override validator + WaveGraph |
| `bin/lib/schemas/wave-graph.ts` | NEW — zod schemas for SectionNode, WaveGraph (in-memory only, not persisted) |
| `bin/lib/citation-token.ts` | NEW — extract `CITATION_TOKEN_RE` + `extractCitekeys` + `replaceCitekeys` helpers (refactored from pass1.ts) |
| `tests/wave-scheduler.test.ts` | NEW |
| `tests/wave-override.test.ts` | NEW |
| `tests/scheduler-stateless.test.ts` | NEW |
| Patch `bin/lib/schemas/plan-frontmatter.ts` | Add optional `wave: z.number().int().positive().optional()` |
| Patch `bin/lib/budget.ts` | Export `Semaphore` if not already exported |

### Plan 2: Write Orchestration (multi-section)

| Path | Purpose |
|------|---------|
| Patch `bin/cli/write.ts` | Add wave-scheduling driver path when no `--section N` flag provided |
| Patch `workflows/write.md` | Add wave-mode capability check + status streaming |
| `bin/lib/write-orchestrator.ts` | NEW — orchestrates `Promise.allSettled` per wave, calls existing per-section writer for each |
| `tests/write-orchestrator.test.ts` | NEW |

### Plan 3: Compile Pipeline

| Path | Purpose |
|------|---------|
| `bin/lib/compile.ts` | NEW — main pipeline |
| `bin/lib/draft-hash.ts` | NEW — `computeDraftHash(bytes, sources): string` (D-07) |
| `bin/lib/consistency-scan.ts` | NEW — heuristics from Question G |
| `bin/cli/compile.ts` | Promote Phase 2 stub to real command |
| Patch `workflows/compile.md` | Fill in from Phase 2 stub |
| `templates/prompts/smoother.md` | NEW (hash-pinned per D-12) |
| Patch `bin/lib/prompt-loader.ts` | Add `smoother` to EXPECTED_PROMPT_HASHES |
| `tests/compile-order.test.ts` | NEW |
| `tests/compile-staleness.test.ts` | NEW |
| `tests/compile-smoother.test.ts` | NEW |
| `tests/smoother-token-protect.test.ts` | NEW |
| `tests/compile-bib-regen.test.ts` | NEW |
| `tests/compile-report-schema.test.ts` | NEW |
| `tests/consistency-scan.test.ts` | NEW |
| `tests/cassettes/smoother-*.json` | NEW (3 fixtures) |

### Plan 4: Revise-Swap

| Path | Purpose |
|------|---------|
| `bin/lib/revise.ts` | NEW — single chokepoint for Tier 1 + Tier 2 (D-06) |
| `bin/cli/revise.ts` | NEW — Tier 2 surface |
| `workflows/revise.md` | NEW |
| `templates/prompts/revise-swap.md` | NEW (hash-pinned per D-05) |
| Patch `bin/lib/prompt-loader.ts` | Add `revise-swap` to EXPECTED_PROMPT_HASHES |
| `tests/revise-swap.test.ts` | NEW |
| `tests/cassettes/revise-swap-*.json` | NEW (3 fixtures) |

### Plan 5: RSCH-10 + COMPILE-REPORT + Path-Tolerance

| Path | Purpose |
|------|---------|
| `bin/lib/verify/freshness.ts` | NEW — DOI HEAD + retraction-watch (D-10) |
| Patch `bin/lib/verify/pass1.ts` | Invoke freshness probe |
| `bin/lib/compile-report.ts` | NEW — renders COMPILE-REPORT.md per D-14 schema v1 |
| `bin/lib/schemas/compile-report.ts` | NEW — zod schema for frontmatter |
| Patch `bin/lib/paths.ts` | Add optional `letterSuffix` param to `sectionDir`; add `parseSectionDirName` helper |
| `tests/freshness-probe.test.ts` | NEW |
| `tests/letter-suffix-paths.test.ts` | NEW |
| `tests/cassettes/doi-head-*.json` | NEW (3 fixtures) |
| `tests/cassettes/retraction-watch-hit.json` | NEW |

### Cross-Cutting

| Path | Purpose |
|------|---------|
| Extend `tests/tier-contract.test.ts` | Add compile, revise, write-wave parity cases |
| Update `bin/lib/cli-aliases.ts` (if exists) | Register `revise` alias |

---

## 5. Suggested Plan Decomposition

### Recommended: 5 plans across 3 waves

```
Wave 1 (foundation, parallel):
  - Plan 1: Wave Scheduler         (independent, blocks Plans 2-3)
  - Plan 5: RSCH-10 + COMPILE-REPORT + Path-Tolerance
                                    (independent, blocks Plan 3 partially)

Wave 2 (orchestration, parallel):
  - Plan 2: Write Orchestration    (depends on Plan 1)
  - Plan 4: Revise-Swap            (independent of Plans 1-3 architecturally;
                                    depends on Plan 5 only for re-verify path)

Wave 3 (composition):
  - Plan 3: Compile Pipeline       (depends on Plans 1, 5)
```

**Rationale:**
- Plan 1 (scheduler) and Plan 5 (utility primitives) have no shared file edits — both can run in wave 1 in parallel. Plan 5 ships freshness probe + COMPILE-REPORT renderer + letter-suffix path tolerance as a "utilities" plan because none of these has a strong dependency on the scheduler.
- Plan 2 (write orchestration) wraps the scheduler from Plan 1 into the `/pensmith write` flow.
- Plan 4 (revise-swap) is architecturally orthogonal to scheduling and compilation — touches only `bin/lib/revise.ts`, `bin/cli/revise.ts`, `workflows/revise.md`, `templates/prompts/revise-swap.md`. Can run in wave 2 alongside Plan 2.
- Plan 3 (compile pipeline) needs the scheduler (parseOutline) AND the compile-report renderer AND the freshness probe. Wave 3.

**Estimated complexity:** ~12-15 tasks total across all 5 plans. Smoother and revise-swap prompt authoring + hash-pinning are the highest-uncertainty tasks (LLM behavior surface).

**Alternative decomposition considered:** Merge Plans 1+5 (smaller single utility plan) and 2+3 (compile + write together). REJECTED because (a) 5-plan decomposition surfaces clearer dependencies for the planner, (b) parallelism is wasted if utilities are bundled, (c) compile pipeline is too large to merge with write.

---

## 6. Open Questions for Planner

1. **Outline format exact regex:** the parseOutline parser depends on what Phase 2 outline-author.md emits. Recommend reading `templates/prompts/outline-author.md` first task of Wave 0 to lock the regex.
2. **Smoother window size:** "last paragraph + first paragraph" vs "last 200 words + first 200 words". Pick during plan-phase based on what produces small enough cassettes.
3. **Revise multi-failure UX:** confirm one-at-a-time (recommended) vs all-at-once.
4. **Heading-tense consistency heuristic:** include in COMP-07 default, or feature-flag off? Recommend off-by-default given uncertain FP rate.
5. **Wave progress: stdout JSON lines only (recommended), or also add `paper://compile-progress` MCP resource?** Recommend stdout-only for Phase 4.
6. **`Semaphore` export visibility:** verify it's exported from `bin/lib/budget.ts`. If not, first Wave 1 task is to add the export (or extract to `bin/lib/semaphore.ts` and re-export).
7. **retraction-watch feed:** confirm the integration chosen in Phase 3 (if any) is still live; if not, stub for Phase 5.
8. **Approval-gate UI in Tier 2 non-TTY environments:** confirm exit-code-3 + "use --yolo" message is acceptable, OR consider a `--swap-to <citekey>` flag that bypasses approval for scripted use.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wave scheduling | Tier 2 (`bin/lib/scheduler.ts`) | Tier 1 (workflow body invokes via MCP tool) | Pure logic; Tier 1 plugin slash command delegates. |
| Compile pipeline | Tier 2 (`bin/lib/compile.ts`) | Tier 1 (workflow `workflows/compile.md`) | Same — bin/lib/ owns logic, workflows/ owns UX shape. |
| Revise-swap (LLM call) | Tier 2 (`bin/lib/revise.ts`) | Tier 1 (workflow `workflows/revise.md`) | LLM access via OpenRouter is Tier 2; Tier 1 calls into it. |
| Approval gate UI | Tier 2 (`@clack/prompts`) | Tier 1 (AskUserQuestion via capability_check) | TTY-based clack in CLI; AskUserQuestion when available. |
| Atomic writes | Tier 2 (`bin/lib/atomic-write.ts` chokepoint) | — | Filesystem operation; pure Tier 2. |
| MCP resources (progress reporting) | Tier 1 (`mcp/resources.ts`) | — | MCP is Tier 1 only by definition. |
| Cassette playback | Tier 2 (`tests/`, `nock`) | — | Tests are Tier 2. |

---

## Project Constraints (from CLAUDE.md)

- **PRD §14 (verifier non-negotiables):** No FABRICATED, MIS-CITED, or quote-NOT_FOUND citation may escape a section. Phase 4 compile MUST invoke Pass 1+3 (and only Pass 1+3, never Pass 2/4) on staleness, and MUST hard-block compile if re-verify fails.
- **PRD §19 (approval gates default-on):** `--revise` approval gate and `--yolo` override are required.
- **PRD §19 (no exported-document trace):** Phase 4 produces `.paper/DRAFT.md` which is internal; export to Pandoc is Phase 6. Phase 4 must NOT add any metadata stamp.
- **Section-as-phase load-bearing model:** Phase 4 must NOT collapse multiple sections into shared state. Per-section directories remain isolated.
- **Two-tier architecture:** Every new command needs BOTH a `bin/cli/<cmd>.ts` AND a `workflows/<cmd>.md`. The workflow body uses `<capability_check>` blocks.
- **Atomic-write chokepoint (D-07 Phase 3):** ALL file writes from Phase 4 code MUST route through `bin/lib/atomic-write.ts::atomicWriteFile`. Never use `fs.writeFile` directly.
- **citation-js single import site (D-19 Phase 3):** Phase 4's BibTeX regeneration uses `bin/lib/citations.ts` re-exports only.
- **Hash-pinned prompts (D-12 Phase 3):** New prompts (smoother.md, revise-swap.md) MUST be added to `EXPECTED_PROMPT_HASHES` in `prompt-loader.ts`.
- **Zero new runtime deps (D-15 Phase 1):** Reuse `Semaphore` from `budget.ts`; do not add `p-limit`, `p-map`, or any new dep.

---

## Security Domain

> Required by `security_enforcement: true`, `security_asvs_level: 1`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in Phase 4 |
| V3 Session Management | no | CLI is single-user, no sessions |
| V4 Access Control | yes (filesystem only) | Per-section directory isolation via `paths.ts`; relies on OS filesystem perms |
| V5 Input Validation | **yes** | zod schemas for outline parse, wave-override, revise prompt response, compile-report frontmatter |
| V6 Cryptography | yes (hashing only) | SHA-256 for `verified_against_draft_hash` via `node:crypto`; never hand-roll |
| V8 Data Protection | yes (no PII; just user paper drafts) | Atomic writes prevent partial-write corruption; lockfile prevents concurrent overwrite |
| V12 Files & Resources | **yes** | Path traversal: `validateSlug` and `pad2` already gate; new `parseSectionDirName` MUST reject `..`, absolute paths, null bytes |
| V14 Config | yes | New schemas use zod `.strict()` to refuse forward-incompat extra keys (ARCH-07) |

### Known Threat Patterns for Phase 4 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via crafted slug or section name | Tampering | `validateSlug` regex `/^[a-z0-9-]+$/` already enforces; extend to `parseSectionDirName` |
| Prompt injection via section draft content reaching smoother | Tampering / Repudiation | Smoother prompt structurally separates user content from instructions via markdown headings; sees only [tail, head] window not full draft; cannot exfiltrate other sections |
| LLM response injection via revise-swap prompt return | Tampering | Strict JSON parsing with zod schema; reject if action ∉ {swap, remove} or replacement_citekey ∉ assigned_sources |
| Malicious DOI causing SSRF via freshness probe | SSRF | DOI regex (`doi-regex` already in deps) validates format before HEAD request; HEAD goes to `doi.org` only, not arbitrary URLs |
| Cassette tampering for test bypass | Tampering | Cassettes are git-committed; CI runs `npm run check` which includes test runs |
| Lockfile deadlock if compile crashes | DoS | `proper-lockfile` has stale-detection timeout (already configured Phase 1) |
| Smoother LLM exfiltrates citation tokens by encoding them in prose | Information disclosure | Token-set equality post-check (D-13) detects any drift; fallback to raw concat |
| Revise approval gate bypassed by simulated TTY | Elevation of privilege | `--yolo` flag is explicit user intent; non-TTY exits with code 3 unless `--yolo` |

### New Security-Relevant Surface in Phase 4

1. **DOI HEAD requests (RSCH-10):** outbound HTTPS to `doi.org`. Mitigation: `doi-regex` validation + 10s timeout + 1 retry max. No data sent in body.
2. **Retraction-watch lookup:** outbound JSON fetch. Mitigation: cassette-based for tests; production reads a single known feed URL.
3. **LLM prompts containing draft content:** sent to OpenRouter via existing Phase 1 chokepoint. No new exfil surface beyond Phase 3 drafter.
4. **Letter-suffix path scheme:** new `parseSectionDirName` MUST validate strictly. Recommend explicit unit tests for `..`, absolute paths, null bytes, unicode normalization attacks (NFKC inputs).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | ≥20.10 (per package.json engines) | none — hard requirement |
| `Semaphore` (in-repo) | wave scheduler | ✓ | Phase 1 D-50 | none — reuse mandated |
| `atomicWriteFile` (in-repo) | compile writes | ✓ | Phase 1 | none |
| `proper-lockfile` | compile-run lock | ✓ | ^4 (deps) | none |
| `undici` (HEAD requests) | freshness probe | ✓ | ^7 (deps) | fall back to `node:https` if needed |
| `doi-regex` | DOI validation | ✓ | ^0.1.17 (deps) | none |
| `nock` (test cassettes) | freshness + smoother tests | ✓ | ^14 (deps) | none |
| `@clack/prompts` | revise approval gate | ✓ | ^0.7 (deps) | exit-code-3 + message for non-TTY |
| `yaml` | frontmatter parse | ✓ | ^2.9 (deps) | none |
| `zod` | schema validation | ✓ | ^3.23 (deps) | none |
| `citation-js` | bib regeneration | ✓ | 0.7.22 pinned (deps) | none |
| `tsx` | test runner | ✓ | ^4 (devDeps) | none |
| Pandoc | compile time | not needed Phase 4 | — | Phase 6 export concern |
| retraction-watch feed | RSCH-10 production | unknown | — | stub returns "no hits" if unreachable; emits DEBUG log |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Retraction-watch feed (stub to no-hit if unreachable).

---

## Sources

### Primary (HIGH confidence — repo internal)
- `.planning/phases/04-breadth-n-sections-compile-wave-scheduling/04-CONTEXT.md` (D-01..D-15)
- `.planning/phases/03-vertical-slice-one-section/03-CONTEXT.md` (D-01..D-25 carry-forward)
- `.planning/REQUIREMENTS.md` (phase requirement IDs)
- `.planning/ROADMAP.md` (Phase 4 spec lines 142-153 + success criteria)
- `PRD.md` §1-§19 (non-negotiables)
- `CLAUDE.md` (project constraints)
- `bin/lib/budget.ts` — Semaphore class
- `bin/lib/atomic-write.ts` — atomic-write chokepoint
- `bin/lib/paths.ts` — sectionDir/pad2/validateSlug
- `bin/lib/outline.ts` — raw outline loader (parsed helper missing)
- `bin/lib/verify/pass1.ts` — citation token regex + deterministic AND-gate
- `bin/lib/verify/pass3.ts` — Levenshtein-substring on PDF text
- `bin/lib/citekey.ts` — CITEKEY_RE locked grammar
- `bin/lib/prompt-loader.ts` — EXPECTED_PROMPT_HASHES dispatcher
- `bin/lib/schemas/plan-frontmatter.ts` — verified_against_draft_hash schema
- `bin/lib/handoff.ts`, `bin/lib/bibtex-write.ts`, `bin/lib/citations.ts`
- `mcp/resources.ts` — 5 existing MCP resources
- `package.json` — dependency manifest
- `workflows/compile.md` (Phase 2 stub)
- `workflows/plan.md` (Phase 3 plan workflow pattern)

### Secondary (MEDIUM confidence — referenced docs/conventions)
- Pandoc citation syntax docs (`[@key]`) — well-established standard
- Knuth Vol 1 Kahn topological sort — textbook algorithm
- GSD plugin reference repos (per CLAUDE.md, cloned at `/tmp/refs/`) — pattern source for two-tier delegation

### Tertiary (LOW confidence — flagged for verification)
- Retraction-watch feed availability and format — needs live verification in Wave 0

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Semaphore` is exported from `bin/lib/budget.ts` (not just defined) | Q-A | LOW — if not exported, trivial first-task fix |
| A2 | Phase 2 outline format uses `## <N>. <Title> (<slug>)` heading convention | Q-C | MEDIUM — regex shape depends on this; verify by reading outline-author.md |
| A3 | retraction-watch feed integration was wired in Phase 3 | Q-J, Q-N | LOW — stub if absent; ship Phase 5 |
| A4 | section-drafter prompt enforces bare `[@key]` tokens (no locator syntax) | Q-D | MEDIUM — if drafter emits richer Pandoc syntax, smoother substitution must adapt |
| A5 | VERIFICATION.md format from Phase 3 is structured enough for revise to parse first failing citation | Q-I | MEDIUM — if VERIFICATION.md is freeform, revise needs a parser or VERIFICATION.md needs structuring |
| A6 | `@clack/prompts` works in Tier 2 CLI non-interactive env with exit-code-3 fallback | Q-I | LOW — well-understood |
| A7 | `proper-lockfile` configured in Phase 1 supports `.paper/` directory-scoped lock | Q-F, P6 | LOW — lock-target file convention; can be a sentinel file like `.paper/.compile.lock` |
| A8 | Phase 4 stays under the citation-js 0.7.22 pin; no version bump needed | Q-Q | LOW — Phase 4 reuses Phase 3 chokepoint |

**If user confirms or refutes A2, A4, A5 before plan-phase, scope tightens.** Other assumptions are LOW risk and self-mitigating.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every primitive already ships in repo; no new ecosystem decisions needed
- Architecture: **HIGH** — D-01..D-15 lock the surface; Phase 3 D-01..D-25 lock the foundations
- Pitfalls: **MEDIUM-HIGH** — pitfalls inferred from Phase 3 surface knowledge; LLM-behavior pitfalls (smoother token drift, revise-swap edge cases) are best-effort predictions

**Research date:** 2026-05-29
**Valid until:** 2026-06-28 (30 days; Phase 4 scope is stable repo-internal recomposition)
