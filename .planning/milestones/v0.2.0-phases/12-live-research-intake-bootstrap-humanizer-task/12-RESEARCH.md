# Phase 12: Live Research + Intake Bootstrap + Humanizer Task — Research

**Researched:** 2026-06-22
**Domain:** Adapter fan-out orchestration, STATE.json bootstrap, Tier-1 Claude Code Task invocation
**Confidence:** HIGH (all findings verified against live source files in this repo)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**GEN-03 — Live research discovery**
- Flow: generate focused queries via `complete()` (LOCKED `topic-disambiguator` prompt) → fan out across the registered adapters in `bin/lib/sources/index.ts` (all 7 + zotero-mcp; OpenAlex primary per PRD) → aggregate `SourceCandidate[]` → DOI-normalize + fuzzy-dedup (`bin/lib/doi.ts` + `bin/lib/fuzzy.ts`) → evaluate/tier via `complete()` (LOCKED `source-evaluator` prompt) → `crossCheckRetractions` (D-15, BEFORE writeBibtex) → `writeBibtex` + `writeRis` + real `LIBRARY.json`.
- All adapter network through `bin/lib/http.ts`; cassette-backed offline. LLM steps honor `PENSMITH_NO_LLM`. Tier 1 parallel fan-out; Tier 2 sequential.
- Research approval gate default-ON; `--yolo` skips. Non-TTY: `ApprovalUnavailableError`/exit-3.
- Zero-candidate degenerate case: WARN + write an EMPTY-but-real `LIBRARY.json` (never a placeholder).

**GEN-04 — Intake STATE.json bootstrap**
- Intake writes `.paper/STATE.json` conforming to the existing v2 `StateSchema` (`$schemaVersion: 2`, `paperId`, `createdAt`, slim `sections: [{n, slug}]` optional) via `initState()` (state.ts).
- `paperId` is stable per paper: generated ONCE at intake; re-running intake on an existing paper is IDEMPOTENT (does not regenerate the id).
- With STATE.json present, existing global-library registration + style-match opt-in producer run instead of WARN-skipping.

**GEN-05 — Humanizer Task (Tier 1)**
- `runHumanizer` in `bin/lib/exporter.ts` (currently returns null) invokes the user's `humanizer` skill at `~/.claude/skills/humanizer/` via Claude Code Task — Tier-1 only.
- Records real before/after honesty (GPTZero) score with LOCKED honest-framing copy.
- Absent skill OR absent Task → skip banner + continue. Export never fails on humanizer absence.
- INJECTABLE seam (function param / module seam, mirror Phase-11 transport pattern). No live Task call in CI.

### Claude's Discretion
- paperId generation strategy: prefer `randomUUID()` (already used in `initState()` — no new dependency) vs. content-hash.

### Deferred Ideas (OUT OF SCOPE)
- Citation rendering at export (`[@key]` → formatted text) — REND → Phase 13.
- Re-verify humanized FINAL.md before export (GATE-04 → Phase 14).
- Reference dedup across BYO/add/Zotero/live-search as a unified pass (RDUP-01 → v2/Future).
- Live-path smoke CI for a real adapter round-trip (LIVE-01 → v2/Future).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GEN-03 | `pensmith research` discovers real source candidates by querying registered adapters, dedupes them, and runs retraction cross-check — replacing the hardcoded zero-candidate placeholder library | Adapter search() signatures catalogued; orchestration pattern described; swap-seam identified in research.ts |
| GEN-04 | Intake bootstraps a paper-level STATE.json + paperId so global-library registration and style-match run in the real flow instead of WARN-skipping | STATE.json schema verified; initState() API confirmed; WARN-skip guard in intake.ts located (resolvePaperId → null guard) |
| GEN-05 | The Tier-1 humanizer wrap invokes the humanizer skill via Task and records a real before/after honesty score, skipping cleanly with a banner when the skill is absent | runHumanizer seam confirmed; injectable pattern described; honesty.ts scoreHonesty API confirmed |
</phase_requirements>

---

## Summary

Phase 12 connects three "make the pipeline real" workstreams that all build on the Phase-11 `complete()` transport. The code is already nearly wired — the heavy lifting is replacing one well-marked swap-seam in `research.ts`, calling `initState()` at the right point in `intake.ts`, and filling in the `runHumanizer` body in `exporter.ts`.

**GEN-03** is the largest workstream: the `research.ts` swap-seam block (lines 153–197) replaces with an orchestrated fan-out that: (1) parses the `topic-disambiguator` LLM response into a `scopes` object, (2) runs each scope's queries across all adapters that expose `search()` (crossref, openalex, arxiv, pubmed, semanticscholar, zotero-mcp; unpaywall and retraction-watch are fetchById-only so they're skipped in the search fan-out), (3) DOI-deduplicates the aggregate, (4) evaluates/tiers survivors via `complete()` with `source-evaluator`, and (5) preserves the existing D-15/D-19/D-20 locked ordering. Cassettes already exist for all five searchable adapters; the LLM steps are already offline-safe via `PENSMITH_NO_LLM`.

**GEN-04** is narrow: `intake.ts` must call `initState(paperDir())` early in `run()`, before `runSideEffects()`. The `initState()` API already handles the idempotent case (throws `StateAlreadyExistsError` if already present — the caller must `catch` and skip). After that, `resolvePaperId()` in `intake.ts` will find the freshly written STATE.json and the downstream guards that currently WARN-skip will proceed.

**GEN-05** is about filling the `runHumanizer` body to call the Claude Code Task transport (injecting a seam for offline CI), then wiring the before/after `scoreHonesty()` calls that `done.ts` already sets up around it.

**Primary recommendation:** Work in this order: GEN-04 first (it unlocks the stateful foundation), GEN-03 second (it's the bulk), GEN-05 last (it layers on the export path without touching research or intake).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Query generation (topic-disambiguator) | API/Backend (Tier-2 CLI) | — | `complete()` transport; offline-mockable via `PENSMITH_NO_LLM` |
| Adapter search fan-out | API/Backend (Tier-2 CLI) | — | All adapters already route through `http.ts`; cassette-backed offline |
| DOI dedup | API/Backend (in-process) | — | `normalizeDoi()` is a pure in-process function; no network |
| Source evaluation/tiering | API/Backend (Tier-2 CLI) | — | `complete()` transport; `PENSMITH_NO_LLM` mock sufficient |
| Retraction cross-check | API/Backend (in-process) | — | `crossCheckRetractions()` already wired and offline-cassette-backed |
| STATE.json write | API/Backend (Tier-2 CLI) | — | `initState()` from `state.ts`; all writes through `atomicWriteFile`+`withLock` |
| Global-library registration | API/Backend (Tier-2 CLI) | — | `registerPaperInGlobalLibrary()` already wired, guarded on paperId |
| Humanizer Task invocation | Browser/Client (Tier-1 Claude Code) | Tier-2: clean skip | Task is a Claude Code capability; Tier-2 skip path already implemented |
| Honesty score (before/after) | API/Backend (Tier-2 CLI) | — | `scoreHonesty()` in `honesty.ts`; offline cassette + key-absence skip |
| Approval gate (prune/approve/add) | API/Backend (Tier-2 CLI) | — | `@clack/prompts` TTY; non-TTY: `ApprovalUnavailableError`/exit-3 |

---

## Standard Stack

No new npm packages are required for this phase. All tools already exist in the repo.

### Core (existing — no installs)

| Module | Location | Purpose | Already Used By |
|--------|----------|---------|----------------|
| `complete()` | `bin/lib/anthropic.ts` | LLM calls (query-gen + eval) | outline, plan, write, intake |
| `isNoLlmMode()` | `bin/lib/anthropic.ts:109` | Offline short-circuit | research.ts, all verbs |
| `sources` registry | `bin/lib/sources/index.ts` | 7+1 adapter collection | verifier, research.ts |
| `crossCheckRetractions()` | `bin/lib/sources/retraction-cross-check.ts` | D-15 retraction pass | research.ts (already called) |
| `normalizeDoi()` | `bin/lib/doi.ts:83` | DOI canonical form for dedup | verifier, add-source |
| `jaroWinkler()` + `TITLE_JW_THRESHOLD` | `bin/lib/fuzzy.ts:169,54` | Title/author dedup | verifier Pass-1 |
| `initState()` | `bin/lib/state.ts:146` | Write `.paper/STATE.json` | Not called by intake yet |
| `loadState()` | `bin/lib/state.ts:209` | Read STATE.json | `resolvePaperId()` in intake.ts |
| `atomicWriteFile()` | `bin/lib/atomic-write.ts` | All file writes | everything |
| `loadPrompt()` + `interpolate()` | `bin/lib/prompt-loader.ts` | Hash-pinned prompt loading | all LLM callers |
| `writeBibtex()` | `bin/lib/bibtex-write.ts:134` | D-19 BibTeX writer | research.ts (already called) |
| `writeRis()` | `bin/lib/ris-write.ts` | RIS writer | research.ts (already called) |
| `isHumanizerSkillPresent()` | `bin/lib/ecosystem-presence.ts:76` | Skill presence check | exporter.ts |
| `scoreHonesty()` | `bin/lib/honesty.ts:293` | GPTZero before/after | done.ts (wired; key-absence safe) |
| `renderHonestyReport()` | `bin/lib/honesty.ts:317` | Locked-framing report | done.ts |
| `SourceCandidateSchema` | `bin/lib/schemas/source-candidate.ts` | D-14 Zod schema | all adapters |
| `ask()` | `bin/lib/prompts.ts` | TTY approval prompt | outline.ts, revise.ts |

### Prompt Hashes (locked — DO NOT change)

| Slug | SHA-256 (from `EXPECTED_PROMPT_HASHES`) | Input vars | Output shape |
|------|-----------------------------------------|------------|--------------|
| `topic-disambiguator` | `165e533fa1…` | `{{topic}}`, `{{discipline}}`, `{{assignment}}` | `{ scopes: [{ label, queries[] }] }` JSON |
| `source-evaluator` | `45488935a0…` | `{{candidateSources}}`, `{{topic}}`, `{{scope}}`, `{{discipline}}` | `[{ citekey, keep, reason }]` JSON array |

Both slugs are already in `EXPECTED_PROMPT_HASHES` and hash-pinned. `loadPrompt()` validates on every call. No re-pinning needed.

---

## Package Legitimacy Audit

No new packages are installed in this phase.

| Package | Notes |
|---------|-------|
| _(none)_ | Phase 12 uses only existing repo modules. No npm installs. |

---

## Architecture Patterns

### System Architecture Diagram

```
pensmith research
      │
      ▼
[GEN-06 fail-loud probe] ── no key + no offline → stderr + exit 1
      │ (key present OR PENSMITH_NO_LLM=1)
      ▼
loadPrompt('topic-disambiguator') ← hash-pin check
      │
      ▼
complete({ system, messages: [{role:'user', content: interpolatedPrompt}] })
      │  PENSMITH_NO_LLM=1 → deterministic mock text
      ▼
parseTopicDisambiguatorResponse(llmResult.text)
      │  defensive JSON.parse → { scopes: [...] }
      │  fallback on parse failure: single scope with user topic as-is
      ▼
[Scope approval gate] ── TTY: @clack/prompts select
      │                  non-TTY: ApprovalUnavailableError → exit 3
      │                  --yolo: auto-select scope[0]
      ▼
Fan-out queries across adapters (Tier-1 parallel, Tier-2 sequential):
  ┌─────────────────────────────────────────────────────────────┐
  │ crossref.search(q)  → SourceCandidate[]                     │
  │ openalex.search(q)  → SourceCandidate[]  ← PRIMARY (PRD)    │
  │ arxiv.search(q)     → SourceCandidate[]                     │
  │ pubmed.search(q)    → SourceCandidate[]                     │
  │ semanticscholar.search(q) → SourceCandidate[]               │
  │ zotero-mcp.search(q) → SourceCandidate[]  (absent → [])     │
  │ unpaywall: SKIP (fetchById-only; no search endpoint)        │
  │ retraction-watch: SKIP (D-15 fetchById-only)                │
  └─────────────────────────────────────────────────────────────┘
      │
      ▼
aggregate + DOI-dedup (normalizeDoi → Map<canonicalDoi, SourceCandidate>)
title-dedup for no-DOI candidates (jaroWinkler >= TITLE_JW_THRESHOLD)
      │
      ▼
loadPrompt('source-evaluator') ← hash-pin check
complete({ candidateSources JSON, topic, scope.label, discipline })
      │  PENSMITH_NO_LLM=1 → mock text → defensive parse → keep all
      ▼
filter candidates where verdict.keep === true
      │
      ▼
[Candidate approval gate] ── TTY: prune / approve / add
      │                       non-TTY: exit 3
      │                       --yolo: skip
      ▼
crossCheckRetractions(candidates)  ← D-15 BEFORE writeBibtex
      │
      ▼
writeBibtex(candidates, bibPath)   ← D-19/D-20 LOCKED
writeRis(candidates, risPath)
atomicWriteFile(libraryPath, JSON { $schemaVersion:1, entries: candidates })
```

```
pensmith new (intake)
      │
      ▼
[existing: GEN-06 probe, prompt load, PII block, complete()]
      │
      ▼
► NEW: initState(paperDir()) ◄
      │  throws StateAlreadyExistsError if STATE.json exists → catch + skip (idempotent)
      │  paperId = randomUUID() (from node:crypto — already imported in state.ts)
      ▼
atomicWriteFile(INTAKE.md, result.text)  ← existing
      │
      ▼
runSideEffects():
  resolvePaperId(cwd)              ← now finds the freshly written STATE.json
  registerPaperNonFatal(...)       ← proceeds (paperId non-null)
  runStyleProducerNonFatal(...)    ← proceeds (paperId non-null, if --style-samples)
```

```
pensmith done (export path, GEN-05)
      │
      ▼
scoreHonesty(draftMd)              ← before score (existing)
      │
      ▼
runHumanizer(draftMd, paperRoot)   ← FILLED IN:
      │
      ├─ isHumanizerSkillPresent() === false
      │    → stdout banner 'humanizer skill not found…'
      │    → return null
      │
      ├─ skill present, Task transport available (Tier 1)
      │    → invoke Task via injectable TaskRunner seam
      │    → write .paper/FINAL.md
      │    → return finalPath
      │
      └─ skill present, no Task transport (Tier 2)
           → stdout banner 'humanizer skill present but no Task transport…'
           → return null
      │
      ▼
if (finalPath !== null): scoreHonesty(readFileSync(finalPath))  ← after score
      │
      ▼
renderHonestyReport(before, after, backend)  ← locked framing copy
      │
      ▼
exportDraft({ inputPath: finalPath ?? draftPath, ... })
```

### Recommended Project Structure (changes only)

```
bin/
├── cli/
│   ├── research.ts       # REPLACE swap-seam block (lines 153–197) with live orchestrator
│   └── intake.ts         # ADD initState() call before runSideEffects()
├── lib/
│   ├── exporter.ts       # FILL runHumanizer body with Task seam
│   └── research-orchestrator.ts  # NEW — extracted fan-out logic (keeps research.ts thin)
tests/
└── research-discovery.test.ts  # NEW — offline unit tests for fan-out + dedup
```

The `research-orchestrator.ts` extraction is recommended (not mandatory) to keep `research.ts` under 200 lines and make the orchestration unit-testable in isolation.

### Pattern 1: Adapter Search Fan-out

Every adapter (except unpaywall and retraction-watch) exposes the same signature:

```typescript
// Source: bin/lib/sources/crossref.ts:84, openalex.ts:84, arxiv.ts:142,
//         pubmed.ts:108, semanticscholar.ts:110
export async function search(
  query: string,
  opts: { limit?: number } = {},
): Promise<SourceCandidate[]>
```

The orchestrator iterates adapters generically with the `'search' in adapter` guard (per `sources/index.ts` comment), which naturally excludes `retraction-watch` (no search export) and degrades gracefully for `zotero-mcp` (returns `[]` when absent).

```typescript
// Source: bin/lib/sources/index.ts — the guard pattern documented in the file header
const searchableAdapters = Object.entries(sources).filter(
  ([, adapter]) => 'search' in adapter,
) as Array<[string, { search: typeof crossref.search }]>;
```

### Pattern 2: DOI Dedup

```typescript
// Source: bin/lib/doi.ts:83 normalizeDoi
const seen = new Map<string, SourceCandidate>(); // canonical DOI → first seen
for (const c of allCandidates) {
  const key = c.doi ? normalizeDoi(c.doi) : null;
  if (key) {
    if (!seen.has(key)) seen.set(key, c);
    // else: duplicate — prefer the candidate with the more complete record
    // (has abstract, has oa_pdf_url) or just first-wins; keep it simple
  } else {
    // No DOI: title+author fuzzy dedup
    const existing = [...seen.values()].find(
      (s) => jaroWinkler(s.title, c.title) >= TITLE_JW_THRESHOLD,
    );
    if (!existing) seen.set(`no-doi:${c.id}`, c);
  }
}
const deduped = [...seen.values()];
```

### Pattern 3: Defensive LLM Response Parsing

The `topic-disambiguator` prompt returns:
```json
{ "scopes": [{ "label": "transformer-architecture", "queries": ["q1", "q2"] }] }
```

The `source-evaluator` prompt returns:
```json
[{ "citekey": "vaswani2017attention", "keep": true, "reason": "Foundational" }]
```

Both need defensive JSON.parse + Zod validation (T-11-10 trust boundary):

```typescript
// Source: research.ts lines 153-197 establish the pattern; mirror it
function parseTopicDisambiguatorResponse(text: string): { scopes: Array<{ label: string; queries: string[] }> } {
  try {
    const raw: unknown = JSON.parse(text);
    // Zod parse for shape safety; on failure → fallback single scope
    const schema = z.object({
      scopes: z.array(z.object({
        label: z.string().min(1),
        queries: z.array(z.string().min(1)).min(1),
      })).min(1),
    });
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
  } catch { /* fall through */ }
  // Fallback: single scope with the original topic as the sole query
  process.stderr.write('pensmith research: WARN — topic-disambiguator response was not valid JSON; using fallback single scope.\n');
  return { scopes: [{ label: 'auto', queries: [/* topic from INTAKE.md */] }] };
}
```

### Pattern 4: Injectable Task Seam (GEN-05)

Mirror the Phase-11 `PENSMITH_NO_LLM` seam pattern for the Task runner:

```typescript
// Source: pattern from anthropic.ts isNoLlmMode() + zotero-mcp.ts setZoteroClientForTest
export type TaskRunner = (skill: string, input: Record<string, string>) => Promise<{ output: string }>;

let _taskRunner: TaskRunner | null = null;

/** Test-only seam: inject a deterministic Task runner (mirrors __setInterpolateForTest in intake.ts). */
export function __setTaskRunnerForTest(fn: TaskRunner | null): void {
  _taskRunner = fn;
}

async function invokeTask(skill: string, input: Record<string, string>): Promise<{ output: string } | null> {
  if (_taskRunner !== null) return _taskRunner(skill, input);
  // Live: call Claude Code Task API — Tier 1 only
  // Tier 2 has no Task runtime → return null
  return null; // triggers the skip-banner path
}
```

The `runHumanizer` body then becomes:

```typescript
export async function runHumanizer(
  draftMd: string,
  paperRoot?: string,
): Promise<string | null> {
  try {
    if (!isHumanizerSkillPresent()) {
      process.stdout.write('pensmith done: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n');
      return null;
    }
    const taskResult = await invokeTask('humanizer', { draft: draftMd });
    if (taskResult === null) {
      process.stdout.write('pensmith done: humanizer skill present but no Task transport in this tier — skipping humanize step (export proceeds on DRAFT.md).\n');
      return null;
    }
    // Write FINAL.md and return its path
    const finalPath = join(paperDir(paperRoot), 'FINAL.md');
    await atomicWriteFile(finalPath, taskResult.output);
    return finalPath;
  } catch {
    process.stdout.write('pensmith done: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n');
    return null;
  }
}
```

### Anti-Patterns to Avoid

- **Calling retraction-watch.search():** The adapter deliberately has NO `search` export (ESLint enforces this). Use `crossCheckRetractions()` after discovery.
- **Calling unpaywall.search():** It returns `[]` by protocol design (DOI-lookup only). Call `fetchById()` with a known DOI to enrich OA PDF URL after initial discovery.
- **Implementing adapter-parallel fan-out in Tier 2:** Tier 2 is sequential. Only Tier 1 (subagents) fans out in parallel. The contract test asserts parity within ±20%.
- **Writing STATE.json with `atomicWriteFile` directly:** Always use `initState()` from `state.ts` — it enforces `StateSchema.parse()`, `withLock()`, and the idempotency check atomically.
- **Parsing LLM JSON without defensive fallback:** The offline `PENSMITH_NO_LLM` mock returns `"[PENSMITH_NO_LLM placeholder — ...]"` which is NOT valid JSON. The parser MUST have a catch + fallback.
- **Injecting the paperId as content-hash:** `randomUUID()` is already the pattern in `initState()`. A content-hash would vary with the assignment text and break idempotency (re-running intake on the same paper must not re-register a new id).
- **Calling `loadPrompt()` once at module-load time for deferred slugs:** `source-evaluator` is already loaded in `run()` (line 83 of research.ts); do not move it into a top-level `void loadPrompt` — that path is already covered.
- **Storing the `topic` var extracted from INTAKE.md in STATE.json:** The context is INTAKE.md-only. STATE.json stays `{ $schemaVersion, paperId, createdAt, sections? }` — no new fields.
- **Calling `scoreHonesty()` inside `runHumanizer()`:** `done.ts` already calls it before and after. `runHumanizer` writes FINAL.md and returns the path; `done.ts` owns the honesty bookkeeping.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DOI normalization | Custom prefix stripping | `normalizeDoi()` in `bin/lib/doi.ts` | Handles 6 prefix forms, trailing punct, ASCII-lowercase; has property tests |
| Title dedup | Exact-string compare or Levenshtein | `jaroWinkler()` + `TITLE_JW_THRESHOLD` | Handles diacritics, soft hyphens; already calibrated at 0.92 |
| STATE.json write | Direct `JSON.stringify` + `fs.writeFile` | `initState()` from `state.ts` | Enforces schema, locking, idempotency atomically |
| Atomic file write | Rename-then-replace | `atomicWriteFile()` | Cross-platform, already enforced by ESLint chokepoint |
| BibTeX serialization | Template strings | `writeBibtex()` | citation-js chokepoint (D-19); handles collision suffixes |
| Prompt loading | `readFileSync('templates/...')` directly | `loadPrompt()` | Hash-pin validation (D-12); drift caught at runtime |
| LLM call | Fetch the Anthropic API directly | `complete()` in `anthropic.ts` | Budget gate, key-no-leak, offline seam, provider routing |
| Honesty framing copy | Inline string | `renderHonestyReport()` with `loadFramingNote()` | Locked copy from `references/honesty-framing.md`; CI hash-pinned |

**Key insight:** The entire research pipeline infrastructure is already built. Phase 12 is about connecting the existing pieces with real data flow, not building new infrastructure.

---

## Adapter Search Contract Catalog

This is the authoritative catalog of each adapter's `search()` and `fetchById()` signatures, cassette keys, and relevant constraints.

### crossref

```typescript
// bin/lib/sources/crossref.ts:84
export async function search(query: string, opts: { limit?: number } = {}): Promise<SourceCandidate[]>
export async function fetchById(doi: string): Promise<SourceCandidate | null>
// Offline cassette: loadCassetteDir('crossref') — scans ALL files in tests/fixtures/cassettes/crossref/
// Looks for: c.method === 'GET' && c.path.includes('/works?query=')
// Online: GET https://api.crossref.org/works?query=<q>&rows=<limit>
// Contact: http.ts polite-pool UA with PENSMITH_CONTACT_EMAIL
// Returns: SourceCandidate with source:'crossref', id=doi, retracted:false initially
```

### openalex (PRIMARY per PRD)

```typescript
// bin/lib/sources/openalex.ts:84
export async function search(query: string, opts: { limit?: number } = {}): Promise<SourceCandidate[]>
export async function fetchById(id: string): Promise<SourceCandidate | null>
// Offline cassette: loadCassetteFile('openalex', 'works-attention')
// Looks for: c.method === 'GET' && c.path.includes('/works?search=')
// Online: GET https://api.openalex.org/works?search=<q>&per-page=<limit>&mailto=<email>
// Contact: &mailto= query param (NOT a header)
// NOTE (from code comment): polite-pool slot sunsets Feb 2026; today (2026-06-22) still in effect
// Returns: source:'openalex', id=OpenAlex W-ID or DOI, retracted:false
```

### arxiv

```typescript
// bin/lib/sources/arxiv.ts:142
export async function search(query: string, opts: { limit?: number } = {}): Promise<SourceCandidate[]>
export async function fetchById(id: string): Promise<SourceCandidate | null>
// Offline cassette: loadCassetteFile('arxiv', 'query-attention')
// Looks for: c.method === 'GET' && c.path.includes('search_query=')
// Online: GET http://export.arxiv.org/api/query?search_query=<q>&max_results=<limit>
// Response: Atom XML (no JSON); parsed by internal parseFeed() regex extractor
// No auth, no rate-limit param; http.ts enforces 3-second per-source rate limit
// Body cap: ARXIV_MAX_BODY_BYTES = 10_000_000 (CR-05)
// Returns: source:'arxiv', id=arXiv URL, doi=optional (arxiv:doi tag)
```

### pubmed (TWO-STEP search)

```typescript
// bin/lib/sources/pubmed.ts:108
export async function search(query: string, opts: { limit?: number } = {}): Promise<SourceCandidate[]>
export async function fetchById(pmid: string): Promise<SourceCandidate | null>
// Offline cassettes: loadCassetteFile('pubmed', 'esearch-attention') +
//                   loadCassetteFile('pubmed', 'esummary-attention')
// Step 1: GET esearch.fcgi?db=pubmed&term=<q>&retmode=json → idlist[]
// Step 2: GET esummary.fcgi?db=pubmed&id=<csv>&retmode=json → records
// Online two-step; offline replays both cassettes sequentially
// Returns: source:'pubmed', id=PMID (bare digits), doi=optional from articleids
```

### semanticscholar

```typescript
// bin/lib/sources/semanticscholar.ts:110
export async function search(query: string, opts: { limit?: number } = {}): Promise<SourceCandidate[]>
export async function fetchById(paperId: string): Promise<SourceCandidate | null>
// Offline cassette: loadCassetteFile('semanticscholar', 'search-attention')
// Looks for: c.path.includes('/paper/search?')
// Online: GET https://api.semanticscholar.org/graph/v1/paper/search?query=<q>&limit=<n>&fields=title,authors,year,externalIds,abstract
// PENSMITH_S2_API_KEY: optional; absent → WARN-once + keyless mode
// Returns: source:'semanticscholar', id=S2 paperId, doi=externalIds.DOI
```

### unpaywall (fetchById-only; search() returns [])

```typescript
// bin/lib/sources/unpaywall.ts:98
export async function search(_query: string, _opts?: {}): Promise<SourceCandidate[]>  // always returns []
export async function fetchById(doi: string): Promise<SourceCandidate | null>
// Offline cassette: loadCassetteFile('unpaywall', 'doi-vaswani2017')
// Online: GET https://api.unpaywall.org/v2/<doi>?email=<contact>
// USE: call fetchById(doi) AFTER initial discovery to enrich oa_pdf_url
// Returns: source:'unpaywall', id=doi, oa_pdf_url=best_oa_location.url_for_pdf
```

### retraction-watch (fetchById-only; NO search export — D-15 LOCKED)

```typescript
// bin/lib/sources/retraction-watch.ts:93
// NO search export — ESLint enforces this; the registry index.ts comment warns:
// "IMPORTANT: 'retraction-watch' exposes fetchById ONLY"
export async function fetchById(doi: string): Promise<SourceCandidate | null>
// Offline cassette: loadCassetteFile('retraction-watch', 'fetchById-fake')
// Online: GET https://api.labs.crossref.org/data/retractions?filter=record:<doi>
// Returns: source:'retraction-watch', retracted:true (or null if not retracted)
// USED VIA: crossCheckRetractions() — never call directly in the fan-out
```

### zotero-mcp (search present; absent → [])

```typescript
// bin/lib/sources/zotero-mcp.ts
export async function search(query: string, opts?: {}): Promise<SourceCandidate[]>
// Returns [] when: Zotero MCP absent, ZOTERO_API_KEY unset, OR no client wired
// Injectable client seam: setZoteroClientForTest()
// Returns: source:'zotero-mcp'
// INCLUDE in fan-out (it respects 'search' in adapter guard and degrades gracefully)
```

### Summary: which adapters participate in search fan-out

| Adapter | In search fan-out? | How |
|---------|--------------------|-----|
| crossref | YES | `search()` |
| openalex | YES (PRIMARY) | `search()` |
| arxiv | YES | `search()` |
| pubmed | YES | `search()` two-step |
| semanticscholar | YES | `search()` |
| unpaywall | NO | `fetchById()` post-discovery only |
| retraction-watch | NO (D-15 locked) | via `crossCheckRetractions()` |
| zotero-mcp | YES (degrades to []) | `search()` |

---

## STATE.json Schema (GEN-04)

The v2 `StateSchema` (from `bin/lib/schemas/state.ts:83`) is:

```typescript
// CURRENT_STATE_VERSION = 2
// bin/lib/schemas/state.ts:83
export const Schema = z.object({
  $schemaVersion: z.literal(2),       // REQUIRED — must be exactly 2
  paperId: z.string().min(1),          // REQUIRED — UUID v4
  createdAt: z.string().datetime(),    // REQUIRED — ISO-8601
  sections: z.array(SectionEntrySchema).optional(),  // optional slim array
}).passthrough(); // allows extra fields for forward compat
```

`SectionEntrySchema` is `{ n: number.int().min(1), slug: /^[a-z0-9-]+$/ }` — section state lives in PLAN.md frontmatter, NOT STATE.json.

### initState() API

```typescript
// bin/lib/state.ts:146
export async function initState(
  paperRoot: string,           // typically paperDir() = cwd + '/.paper'
  seed?: { paperId?: string }, // optional; omit to generate randomUUID()
): Promise<State>
// Throws StateAlreadyExistsError (code: 'STATE_ALREADY_EXISTS') if STATE.json exists
// Uses withLock() atomically (BLOCKER-01 fix)
// Validates via StateSchema.parse() BEFORE write (T-01-08)
// Logs via openSessionLog child('state')
```

### Where to call initState() in intake.ts

In `intake.ts run()`, after the PII block and before `runSideEffects()`, and specifically before `atomicWriteFile(targetPath, result.text)`. The idiomatic placement:

```typescript
// After complete() returns result.text, before writing INTAKE.md:
try {
  await initState(paperDir(cwd));
} catch (e) {
  if ((e as { code?: string }).code === 'STATE_ALREADY_EXISTS') {
    // Idempotent: STATE.json already present from a prior intake run — proceed.
  } else {
    throw e;
  }
}
await atomicWriteFile(targetPath, result.text);  // existing
await runSideEffects();                           // existing
```

After this, `resolvePaperId()` (line 167 of intake.ts) calls `loadState(cwd)` and will find the newly written file. The `registerPaperNonFatal` WARN-skip guard (line 195–202) is a `if (!paperId) return` check — it will proceed with the non-null paperId.

---

## Topic Disambiguator → Research Orchestrator Data Flow

The `topic-disambiguator` prompt returns `scopes`, not candidates directly. The orchestrator must:

1. Parse the response into `{ scopes: [{ label, queries[] }] }`.
2. Present scope choices to the user (or auto-pick scope[0] under `--yolo`).
3. For the chosen scope, iterate `queries` and call `adapter.search(query)` for each searchable adapter.
4. De-duplicate the aggregate.
5. Pass deduped candidates to `source-evaluator`.

The `source-evaluator` prompt takes `{{candidateSources}}` as a JSON-serialized array. The `{{topic}}` and `{{scope}}` vars come from the original intake INTAKE.md and the chosen scope label respectively. The `{{discipline}}` comes from INTAKE.md (or defaults to `'other'`).

**Practical concern:** `source-evaluator` gets the full `SourceCandidate[]` JSON as the `candidateSources` var. For large candidate sets (e.g., 5 queries × 6 adapters × 20 results = 600 candidates before dedup), this can push the token estimate toward the budget cap. The orchestrator should cap per-query limit at 10 (not 20) during Phase 12 to stay within budget. The `limit` parameter in each adapter's `opts` defaults to 20 — pass `{ limit: 10 }` in Phase 12.

---

## Source Evaluator Response → Candidate Filtering

The `source-evaluator` response is a JSON array:
```json
[{ "citekey": "vaswani2017attention", "keep": true, "reason": "Foundational" }]
```

The orchestrator:
1. Parses defensively (try/catch; fallback on failure: keep all candidates with a WARN).
2. Builds a `Set<string>` of `keep: true` citekeys.
3. Filters `deduped.filter(c => keepSet.has(c.citekey))`.
4. If offline (`PENSMITH_NO_LLM`): the mock text is not valid JSON; fallback keeps all candidates.

---

## Approval Gates (GEN-03)

Two gates, following the outline/revise precedent:

### Gate 1: Scope Selection (after topic-disambiguator)

When `scopes.length > 1` and `!yolo`: present a select prompt with scope labels and first 3 queries from each. The user picks a scope; the orchestrator proceeds with that scope's queries.

When `yolo`: auto-select `scopes[0]`.

Non-TTY (CI): `ApprovalUnavailableError` / exit-3 (same as outline gate).

### Gate 2: Candidate Prune/Approve (after source-evaluator + dedup)

Present the evaluated candidates (show: title, year, source, keep verdict). The user can:
- Approve all → proceed.
- Prune specific entries.
- Add a DOI/ID manually (triggers `fetchById` for that adapter).

When `yolo`: skip, proceed with all `keep:true` candidates.

Non-TTY: exit-3 (same pattern).

The `ask()` utility from `bin/lib/prompts.ts` supports `kind: 'confirm'` and `kind: 'select'`; for the candidate table, use `@clack/prompts` directly as outline.ts does.

---

## Common Pitfalls

### Pitfall 1: PENSMITH_NO_LLM mock text is not valid JSON

**What goes wrong:** The offline mock from `complete()` returns `"[PENSMITH_NO_LLM placeholder — ...]"` (a bracket-prefixed string). `JSON.parse` throws. If the orchestrator doesn't catch this, `research` crashes in CI.

**Why it happens:** The offline mock is a predictable sentinel, not valid JSON. This is by design (T-11-10: LLM output is untrusted; parse defensively).

**How to avoid:** Always wrap `JSON.parse(llmResult.text)` in try/catch with a fallback:
- `topic-disambiguator` parse failure → single scope with topic as the sole query.
- `source-evaluator` parse failure → keep all candidates (WARN to stderr).

**Warning signs:** Crashes in CI with `SyntaxError: Unexpected token [ in JSON at position 0`.

---

### Pitfall 2: StateAlreadyExistsError on second intake run

**What goes wrong:** `initState()` throws `StateAlreadyExistsError` when `.paper/STATE.json` already exists. If the caller doesn't catch it, the second `pensmith intake` crashes.

**Why it happens:** `initState()` enforces the "never clobber" contract (BLOCKER-01). Idempotency is the caller's responsibility.

**How to avoid:** Always catch `StateAlreadyExistsError` and skip silently (log a WARN at most). The paperId from the existing STATE.json is correct; no regeneration needed.

**Warning signs:** `StateAlreadyExistsError: STATE.json already exists at ...` in tests that run `intake` twice.

---

### Pitfall 3: retraction-watch in the search fan-out

**What goes wrong:** `sources['retraction-watch']` has no `search` property. Calling `(adapter as any).search(q)` throws `TypeError: adapter.search is not a function`.

**Why it happens:** D-15 LOCKED design — retraction-watch is a post-hoc filter, not a discovery source.

**How to avoid:** Use `if ('search' in adapter)` guard when iterating `Object.entries(sources)`. The ESLint chokepoint also backstops this.

**Warning signs:** `TypeError: adapter.search is not a function` for the retraction-watch adapter.

---

### Pitfall 4: Unpaywall in the search fan-out

**What goes wrong:** `unpaywall.search()` always returns `[]`. This is correct behavior, but if it's included in the fan-out loop, it wastes an iteration and adds confusion to logs.

**How to avoid:** Document that unpaywall is excluded from the search fan-out. The `'search' in adapter` guard would include it (it exports `search` for protocol compatibility), so explicitly exclude it by name or treat its `[]` return as acceptable.

**Note:** Call `unpaywall.fetchById(doi)` for each DOI-bearing candidate after dedup to enrich `oa_pdf_url`. This is an optional enrichment step (WARN on failure, not a blocker).

---

### Pitfall 5: Topic/discipline vars not extracted from INTAKE.md before calling topic-disambiguator

**What goes wrong:** In Phase 11, `research.ts` (line 124–128) uses placeholder strings for `topic`, `discipline`, and `assignment`. In Phase 12, these MUST come from the actual INTAKE.md content.

**How to avoid:** Read `.paper/INTAKE.md` at the top of `run()` (or a dedicated parsing function). The `interpolate()` function throws if a `{{varname}}` placeholder has no corresponding key — so undefined vars will surface immediately.

**Warning signs:** `interpolate: missing var "topic"` error during research.

---

### Pitfall 6: source-evaluator candidateSources JSON exceeds token budget

**What goes wrong:** Passing 500+ candidates as JSON to `source-evaluator` can exceed the `DEFAULT_CAP_USD = $0.50` budget gate. `BudgetExceededError` is thrown and research fails.

**How to avoid:**
- Cap per-query limit at 10 (not the default 20).
- Dedup BEFORE passing to source-evaluator (reduces the payload significantly).
- If the candidate set exceeds a threshold (e.g., 50 after dedup), truncate to the top-N by recency (sort by year desc, take first 50).

---

### Pitfall 7: Hash drift on topic-disambiguator or source-evaluator prompts

**What goes wrong:** If either prompt file is edited (even a whitespace change) after the Phase-12 wave starts, `loadPrompt()` throws a hash-drift error at `run()` startup — before any adapters fire.

**Why it happens:** The hash is SHA-256 of the ENTIRE file bytes including the YAML frontmatter (which is hashed but stripped from the returned body).

**How to avoid:** Never edit prompt files in Phase 12. Both slugs (`165e533f...` and `45488935...`) are real SHA-256 values (not `__PENDING_HASH_` sentinels) — they validate without `PENSMITH_ALLOW_PENDING_PROMPT_HASHES`.

---

### Pitfall 8: runHumanizer writing FINAL.md to the wrong path

**What goes wrong:** Writing FINAL.md to `cwd + '/FINAL.md'` instead of `paperDir(paperRoot) + '/FINAL.md'`. Phase 14 (GATE-04 re-verification) expects FINAL.md in `.paper/`.

**How to avoid:** Always use `join(paperDir(paperRoot), 'FINAL.md')`. `done.ts` already passes `paperRoot = process.cwd()` to `runHumanizer`.

---

## Offline Determinism (Full CI Path)

| Component | Offline mechanism | What happens under CI |
|-----------|-------------------|----------------------|
| Adapter HTTP | `isOfflineMode()` checks `PENSMITH_NETWORK_TESTS !== '1'`; adapters short-circuit to `loadCassetteFile()` | Returns real SourceCandidate[] from committed cassette fixtures |
| LLM (complete()) | `isNoLlmMode()` checks `PENSMITH_NO_LLM === '1'`; returns `[PENSMITH_NO_LLM placeholder — ...]` | topic-disambiguator: parse fails → fallback single scope. source-evaluator: parse fails → keep all |
| STATE.json | Real file write via `initState()` | Uses `tmp` dir in tests; idempotent if STATE.json exists |
| GPTZero | `isOfflineMode()` → reads `loadCassetteFile('gptzero', 'predict-text')` | Returns parsed HonestyScore from cassette |
| Task (humanizer) | `_taskRunner !== null` check via injectable seam | Tests inject `() => Promise.resolve({ output: '...' })` |
| Approval gate | Non-TTY → `ApprovalUnavailableError` / exit-3 | Tests supply `--yolo` or mock the `ask()` function |

The existing `tests/tier-contract.test.ts` sets `PENSMITH_NO_LLM=1` and runs with no API key. Phase-12 tests must also set `PENSMITH_NO_LLM=1` and set no `PENSMITH_NETWORK_TESTS` (offline mode default).

---

## Runtime State Inventory

This phase does not rename, rebrand, or migrate existing data. Step 2.5 is not applicable; omitted.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node:crypto.randomUUID` | GEN-04 paperId generation | YES | Built-in Node.js | — |
| `PENSMITH_NO_LLM=1` (env var) | CI offline seam | YES | N/A (env var) | — |
| Cassettes in `tests/fixtures/cassettes/` | Adapter offline | YES | Committed fixtures | — |
| `tests/fixtures/cassettes/gptzero/` | Honesty offline | YES (verify) | Committed fixture | Skip (key-absence path) |
| `~/.claude/skills/humanizer/` | GEN-05 real path | NO on CI | — | Clean skip (already implemented) |
| GPTZERO_API_KEY | Honesty score | NO on CI | — | scoreHonesty returns null; honesty check prints skip banner |

**Missing dependencies with no fallback:** None — all CI paths have offline equivalents.

**Missing dependencies with fallback:** humanizer skill, GPTZero key — both have existing clean-skip paths in the code.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `assert/strict` |
| Config file | none — `package.json` test script: `node --test 'tests/**/*.test.ts' --require tsx/esm` |
| Quick run command | `npx tsx --test tests/research-discovery.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GEN-03 | Fan-out returns SourceCandidate[] from at least 1 adapter under offline cassettes | unit | `npx tsx --test tests/research-discovery.test.ts` | NO — Wave 0 |
| GEN-03 | DOI dedup: two candidates with same DOI → 1 in output | unit | same | NO — Wave 0 |
| GEN-03 | PENSMITH_NO_LLM: source-evaluator parse failure → keeps all candidates | unit | same | NO — Wave 0 |
| GEN-03 | Zero-candidate path: WARN + empty LIBRARY.json written | unit | same | NO — Wave 0 |
| GEN-03 | Approval gate: --yolo skips both scope selection and candidate prune | integration | `PENSMITH_NO_LLM=1 node dist/bin/pensmith.js research --yolo` | NO — Wave 0 |
| GEN-03 | Approval gate: non-TTY exits 3 (ApprovalUnavailableError) | integration | same without --yolo | NO — Wave 0 |
| GEN-04 | initState() writes STATE.json with $schemaVersion:2 and paperId | unit | `npx tsx --test tests/intake-bootstrap.test.ts` | NO — Wave 0 |
| GEN-04 | initState() idempotent: second call with existing STATE.json → StateAlreadyExistsError caught, paperId unchanged | unit | same | NO — Wave 0 |
| GEN-04 | After initState(), registerPaperNonFatal proceeds (not WARN-skipped) | unit | same | NO — Wave 0 |
| GEN-05 | runHumanizer: absent skill → null + banner 'humanizer skill not found' | unit | `npx tsx --test tests/humanizer-wrap.test.ts` | YES (tests pass today) |
| GEN-05 | runHumanizer: injectable TaskRunner returns output → FINAL.md written, path returned | unit | `npx tsx --test tests/humanizer-task.test.ts` | NO — Wave 0 |
| GEN-05 | runHumanizer: null TaskRunner (Tier-2) → null + 'no Task transport' banner | unit | same | NO — Wave 0 |
| GEN-05 | scoreHonesty before/after wired in done.ts (existing test passes) | unit | `npx tsx --test tests/honesty.test.ts` | YES |

### Sampling Rate

- **Per task commit:** `npx tsx --test tests/research-discovery.test.ts tests/intake-bootstrap.test.ts tests/humanizer-wrap.test.ts tests/humanizer-task.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/research-discovery.test.ts` — covers GEN-03 fan-out, dedup, offline fallback, zero-candidate
- [ ] `tests/intake-bootstrap.test.ts` — covers GEN-04 STATE.json write, idempotency, WARN-skip flip
- [ ] `tests/humanizer-task.test.ts` — covers GEN-05 injectable seam, FINAL.md write, Tier-2 skip

Existing test infrastructure: `tests/humanizer-wrap.test.ts` already covers the absent-skill skip path (GEN-05 base). `tests/honesty.test.ts` and `tests/export-gate.test.ts` cover the surrounding done.ts flow. `tests/state.test.ts` covers `initState()` exhaustively — Phase 12 tests can import and reuse.

---

## Security Domain

`security_enforcement: true`, ASVS level 1. The ASVS categories applicable to Phase 12:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | NO | Phase 12 adds no auth flows |
| V3 Session Management | NO | No session state introduced |
| V4 Access Control | NO | No new access control paths |
| V5 Input Validation | YES | LLM JSON response → Zod `safeParse()` (T-11-10); `SourceCandidateSchema.safeParse()` per element |
| V6 Cryptography | PARTIAL | `randomUUID()` from `node:crypto` for paperId (appropriate for identifier, not secret) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hostile LLM response (prompt injection via source titles in topic-disambiguator output) | Tampering | Defensive JSON parse → Zod safeParse; `SourceCandidateSchema` validates all string fields |
| paperId regeneration across runs (staleness / registry collision) | Tampering | `StateAlreadyExistsError` catch + skip; `randomUUID()` is non-guessable |
| Task runner injected output not sanitized | Tampering | FINAL.md is written to `.paper/` (inside trusted boundary); re-verification deferred to Phase 14 (GATE-04) |
| Cassette response carries x-api-key | Information Disclosure | `SENSITIVE_HEADERS` deny-list in `http-mock.ts:120`; `tests/cassette-no-leak.test.ts` sentinel scan |
| PENSMITH_S2_API_KEY leaking to logs | Information Disclosure | `getS2ApiKey()` returns `{ present, name }` only; the env read is gated (semanticscholar.ts:61 uses process.env directly — this is the one T-3-12 exception; the value goes only to the header) |
| Source evaluator output inflating candidate count (DoS budget) | Denial of Service | `assertBudget()` before `complete()` in `anthropic.ts:382`; per-query limit cap (10, not 20); dedup before source-evaluator call |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase-11 placeholder: `complete()` called with placeholder `topic`/`assignment` vars; LLM response parsed as `SourceCandidate[]` (always fails) | Phase-12: `complete()` called with real INTAKE.md content; LLM response parsed as `{ scopes }` | This phase | Fan-out actually produces real candidates |
| intake: `resolvePaperId()` returns `null` (STATE.json absent) → WARN-skip | Phase-12: `initState()` writes STATE.json → `resolvePaperId()` returns UUID → registration proceeds | This phase | Global-library registration and style-match are real |
| `runHumanizer()` returns null unconditionally (present-but-no-transport banner) | Phase-12: Task seam wired; Tier-1 actually invokes skill | This phase | Real before/after honesty score possible in Tier 1 |

**Deprecated/outdated:**
- The `(topic from INTAKE.md — wire via Phase 12 / GEN-03)` placeholder strings in `research.ts` lines 124–128: replace with real INTAKE.md extraction.
- The `void draftMd` and `void paperRoot` in `runHumanizer()` (exporter.ts lines 76, 87): replace with actual use of both parameters.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `topic`, `discipline`, and `assignment` are extractable from INTAKE.md as structured fields (e.g., headings or YAML frontmatter) | Pattern 1 / topic-disambiguator data flow | If INTAKE.md is free prose with no structure, the extractor must use heuristics; research may get incorrect topic/discipline; low risk (the fallback single-scope path still works) |
| A2 | The Claude Code Task API (Tier-1) accepts a skill name + input dict and returns `{ output: string }` | GEN-05 injectable seam pattern | If the Task API has a different shape, the seam interface must be adjusted; the injectable seam design protects against this at test time |
| A3 | The `@clack/prompts` library used by outline.ts supports `select` prompts with structured options | Approval gate (scope selection) | If the existing prompts.ts wraps only `confirm` and `text`, a select prompt for scope choice may need direct `@clack/prompts` import; low risk |
| A4 | `tests/fixtures/cassettes/gptzero/predict-text.json` exists as a committed fixture | Honesty score offline path | The honesty score is advisory-only; if the cassette is absent, `parseGptzeroResponse(null)` returns null → clean skip; safe |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (It is not empty — four claims are assumed.)

---

## Open Questions (RESOLVED)

> Resolved at Phase-12 planning (commit 4b176a6):
> 1. **INTAKE.md parsing** — confirmed `intake-clarifier.md` produces free-form prose (no stable `## Topic`/`## Discipline` headings). Resolution: a shared `bin/lib/intake-parse.ts` (`parseIntakeMd`) uses the heuristic fallback — full INTAKE.md text as `{{assignment}}`, `discipline = 'other'`, first heading/sentence as `{{topic}}`.
> 2. **Scope-selection gate** — confirmed `bin/lib/prompts/schema.ts` `ask()` DOES support `kind:'select'` AND `kind:'multiselect'` (lines 33, 46, 85-86) with a built-in non-TTY numbered fallback. Resolution: both research approval gates use `ask()` directly; no new prompt plumbing, no direct `@clack/prompts` import needed.
> 3. **Shared `parseIntakeMd()`** — resolved YES; extracted to `bin/lib/intake-parse.ts` as the interface-first task of plan 12-02 (Phase 12 is the first consumer).
>
> **Wave-0 test file names** (authoritative, matching the PLANs + VALIDATION.md): `tests/research-discovery.test.ts`, `tests/intake-bootstrap.test.ts`, `tests/humanizer-task.test.ts`. (Earlier draft names in this doc — research-orchestrator / intake-state-bootstrap / humanizer-wrap-task — have been reconciled to these.)

1. **INTAKE.md parsing for `{{topic}}`, `{{discipline}}`, `{{assignment}}`**
   - What we know: INTAKE.md is generated by `complete()` from the `intake-clarifier` prompt. The `intake-clarifier.md` template (verified at `templates/prompts/intake-clarifier.md`) determines the structure of INTAKE.md's content.
   - What's unclear: Is INTAKE.md consistently structured with headings that can be reliably parsed for `topic`, `discipline`, and `assignment`? The current `intake-clarifier` prompt content was not read in this session.
   - Recommendation: Read `templates/prompts/intake-clarifier.md` at planning time to confirm the INTAKE.md output format. If it has consistent headings (`## Topic`, `## Discipline`, etc.), extraction is straightforward. If it's free prose, the research.ts orchestrator should pass the full INTAKE.md text as the `{{assignment}}` var and use a simple heuristic for `{{topic}}` (first heading or first sentence).

2. **Scope selection gate: select vs. confirm pattern**
   - What we know: The existing `ask()` helper in `bin/lib/prompts.ts` wraps `@clack/prompts`. The `outline.ts` and `revise.ts` precedents use `kind: 'confirm'`.
   - What's unclear: Does `ask()` support `kind: 'select'`? If not, a direct `@clack/prompts` import is needed for scope selection.
   - Recommendation: Read `bin/lib/prompts.ts` at plan time to check the supported `kind` values. If `select` is not in the union, add it to `ask()` (a small Wave-0 task) or call `@clack/prompts` select() directly in the research command (the simpler option — outline.ts already imports it directly for multi-select confirm flows).

3. **INTAKE.md extraction may be needed in both research.ts AND outline.ts**
   - What we know: Phase 12 adds INTAKE.md reading to research.ts. Phase 13 (REND) and later phases also need discipline/topic context.
   - What's unclear: Should a shared `parseIntakeMd()` utility be created in `bin/lib/intake-parse.ts`?
   - Recommendation: Create the utility in Phase 12 since it's the first consumer. The planner can designate this as a Wave-0 task.

---

## Sources

### Primary (HIGH confidence — verified against live source files)

- `bin/lib/anthropic.ts` — `complete()`, `isNoLlmMode()`, `CompleteOptions`, `CompleteResult` (read in full)
- `bin/cli/research.ts` — swap-seam at lines 153–197; prompt slugs; existing ordered chokepoints (read in full)
- `bin/lib/sources/index.ts` — adapter registry and `AdapterName` type (read in full)
- `bin/lib/sources/crossref.ts`, `openalex.ts`, `arxiv.ts`, `pubmed.ts`, `semanticscholar.ts`, `unpaywall.ts`, `retraction-watch.ts` — search() and fetchById() signatures, cassette keys (all read in full)
- `bin/lib/sources/retraction-cross-check.ts` — `crossCheckRetractions()` signature and injectable `RetractionLookup` (read in full)
- `bin/lib/doi.ts` — `normalizeDoi()`, `isDoi()` (read in full)
- `bin/lib/fuzzy.ts` — `jaroWinkler()`, `TITLE_JW_THRESHOLD`, `normalizeForFuzzy()` (read in full)
- `bin/lib/state.ts` — `initState()`, `loadState()`, `StateAlreadyExistsError` (read in full)
- `bin/lib/schemas/state.ts` — `StateSchema`, `CURRENT_STATE_VERSION`, `SectionEntrySchema` (read in full)
- `bin/cli/intake.ts` — `resolvePaperId()`, `registerPaperNonFatal()`, `runStyleProducerNonFatal()`, `runSideEffects()` (read in full)
- `bin/lib/library.ts` — `registerPaperInGlobalLibrary()` call pattern (read in full)
- `bin/lib/global-library.ts` — `registerPaperInGlobalLibrary()` upsert semantics (read in full)
- `bin/lib/exporter.ts` — `runHumanizer()` current stub, `isHumanizerSkillPresent()` call (read in full)
- `bin/lib/honesty.ts` — `scoreHonesty()`, `renderHonestyReport()`, `HonestyScore` type (read in full)
- `bin/cli/done.ts` — `runHumanizer()` call site, before/after pattern at lines 406–419 (read in full)
- `bin/lib/prompt-loader.ts` — `loadPrompt()`, `interpolate()`, `EXPECTED_PROMPT_HASHES` (read in full)
- `templates/prompts/topic-disambiguator.md` — input vars, output format (read in full)
- `templates/prompts/source-evaluator.md` — input vars, output format (read in full)
- `bin/lib/schemas/source-candidate.ts` — `SourceCandidateSchema`, D-14 field set (read in full)
- `bin/lib/http-mock.ts` — `isOfflineMode()`, `loadCassetteFile()`, `loadCassetteDir()`, `Cassette` type (read in part)
- `bin/lib/ecosystem-presence.ts` — `isHumanizerSkillPresent()` (read in full)
- `.planning/config.json` — `nyquist_validation: true`, `security_enforcement: true` (read in full)
- `tests/humanizer-wrap.test.ts` — existing test infrastructure for GEN-05 (read in full)
- `tests/tier-contract.test.ts` — `PENSMITH_NO_LLM` usage pattern (read in part)

### Secondary (MEDIUM confidence)

- `.planning/phases/12-live-research-intake-bootstrap-humanizer-task/12-CONTEXT.md` — locked decisions (read in full)
- `.planning/REQUIREMENTS.md` — GEN-03/04/05 acceptance criteria (read in full)

---

## Metadata

**Confidence breakdown:**
- Adapter search contract: HIGH — all 7+1 adapter source files read; signatures verified
- STATE.json bootstrap: HIGH — state.ts, schemas/state.ts, intake.ts all read; initState() API confirmed
- Humanizer Task seam: HIGH — exporter.ts, ecosystem-presence.ts, honesty.ts, done.ts all read; injectable seam pattern confirmed from zotero-mcp.ts precedent
- Prompt variables: HIGH — both prompt .md files read verbatim
- Hash pins: HIGH — EXPECTED_PROMPT_HASHES read from prompt-loader.ts
- Approval gate: MEDIUM — pattern confirmed from CONTEXT.md decisions; exact @clack/prompts select() availability in ask() not verified (Open Question 2)

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable codebase; 30-day window)
