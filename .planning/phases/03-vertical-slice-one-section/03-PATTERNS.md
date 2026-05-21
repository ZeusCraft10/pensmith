# Phase 3: Vertical slice through one section — Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** ~60 (new + modified)
**Analogs found:** 58 / 60 (2 with no analog — see § No Analog Found)

> Pattern source: real files in this repo. When the analog is exact, copy the structure verbatim and substitute the new domain. When the analog is role-only, copy the file-header doc-comment style + chokepoint discipline; the body is new logic.

---

## File Classification

### Bucket 1 — `bin/lib/*` chokepoints + new utilities

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bin/lib/pdf-text.ts` (new) | chokepoint (extractor) | transform | `bin/lib/doi.ts` | exact (chokepoint w/ lint exemption) |
| `bin/lib/fuzzy.ts` (new) | deterministic primitive | transform | `bin/lib/doi.ts` | exact (in-tree deterministic algo + property test) |
| `bin/lib/normalize.ts` (new) | deterministic primitive | transform | `bin/lib/doi.ts` (normalizeDoi shape) | exact |
| `bin/lib/citations.ts` (new) | chokepoint (parser wrapper) | transform | `bin/lib/http.ts` | role (third-party-dep chokepoint w/ lint exemption) |
| `bin/lib/score.ts` (new) | deterministic primitive | transform | `bin/lib/doi.ts` | role (pure-function utility) |
| `bin/lib/drafter-input.ts` (new) | runtime guard (chokepoint) | request-response | `bin/lib/doi.ts` (normalizeDoi early-return) | role (chokepoint w/ lint AST selector) |
| `bin/lib/handoff.ts` (new) | atomic-write composer | request-response | `bin/lib/state.ts::saveState` | exact |
| `bin/lib/frontmatter.ts` (new) | YAML round-trip wrapper | transform | `bin/lib/citations.ts` (sibling) / `bin/lib/http.ts` | role (third-party-dep wrapper) |
| `bin/lib/state.ts` (modify) | composer | request-response | self — wake dormant `writeBack` branch | exact (in-file extension) |
| `bin/lib/schemas/state.ts` (modify) | zod schema | n/a | self — slim `SectionEntrySchema` lines 28-53 | exact |
| `bin/lib/runtime.ts` (modify) | composer | request-response | self — `getOpenAlexApiKey` shape mirrors for `getS2ApiKey` | exact |
| `bin/lib/paths.ts` (modify) | path helpers | transform | self — `paperDir` line 117 pattern | exact |

### Bucket 2 — `bin/lib/sources/*` (new directory, 7 adapter files)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `bin/lib/sources/crossref.ts` | adapter | request-response | `bin/lib/doctor/probes/http-crossref-ping.ts` (callsite shape) + `bin/lib/http.ts` (chokepoint usage) | role (no existing adapter; closest is doctor probe that calls http) |
| `bin/lib/sources/openalex.ts` | adapter | request-response | as above + `bin/lib/runtime.ts::getOpenAlexApiKey` (key plumbing) | role |
| `bin/lib/sources/arxiv.ts` | adapter | request-response | same as crossref.ts | role |
| `bin/lib/sources/pubmed.ts` | adapter | request-response | same as crossref.ts | role |
| `bin/lib/sources/semanticscholar.ts` | adapter | request-response | crossref.ts + `runtime.ts::getOpenAlexApiKey` (D-16 opt-in key) | role |
| `bin/lib/sources/unpaywall.ts` | adapter | request-response + file-I/O | crossref.ts + (downstream) `pdf-text.ts` | role |
| `bin/lib/sources/retraction-watch.ts` | filter (fetchById only, no search) | request-response | crossref.ts but truncated to `fetchById` only | role |

### Bucket 3 — `bin/lib/schemas/*` (new schemas)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `bin/lib/schemas/source-candidate.ts` | zod schema | n/a | `bin/lib/schemas/library.ts` | exact |
| `bin/lib/schemas/handoff.ts` | zod schema | n/a | `bin/lib/schemas/checkpoint.ts` | exact (small envelope + refs) |
| `bin/lib/schemas/plan-frontmatter.ts` | zod schema | n/a | `bin/lib/schemas/state.ts` (SectionEntrySchema enums + .passthrough) | exact |

### Bucket 4 — `bin/lib/migrations/state/v1_to_v2.ts` (REPLACE the no-op)

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `bin/lib/migrations/state/v1_to_v2.ts` | migration | transform | self — sample no-op migration becomes real; loader signature unchanged | exact |

### Bucket 5 — `bin/pensmith.ts` + `mcp/server.ts` extensions

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `bin/pensmith.ts` | dispatcher | request-response | self — `REAL_VERB_LOADERS.doctor` line 38 pattern | exact (add 5 entries) |
| `mcp/server.ts` + `mcp/tools.ts` | thin-shim | request-response | self — `paper_init_section/paper_advance_section/paper_record_verification` already wired to stubs; bodies in `bin/lib/state.ts` light up | exact |

### Bucket 6 — `workflows/*` (modify existing 6 stub bodies)

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `workflows/new.md` | workflow body | event-driven | self — Phase 2 stub at workflows/new.md + `workflows/doctor.md` (capability_check shape) | exact (extend stub) |
| `workflows/research.md` | workflow body | event-driven | same | exact |
| `workflows/outline.md` | workflow body | event-driven | same | exact |
| `workflows/plan.md` | workflow body | event-driven | same | exact |
| `workflows/write.md` | workflow body | event-driven | same | exact |
| `workflows/verify.md` | workflow body | event-driven | same | exact |

### Bucket 7 — `templates/prompts/*` (new directory, 8 files)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `templates/prompts/intake-clarifier.md` | LLM prompt | n/a | `references/doctor-output.md` (locked-copy markdown + hash-pin pattern) | role (no existing prompt file; closest is locked-copy reference) |
| `templates/prompts/topic-disambiguator.md` | LLM prompt | n/a | same | role |
| `templates/prompts/source-evaluator.md` | LLM prompt | n/a | same | role |
| `templates/prompts/outline-author.md` | LLM prompt | n/a | same | role |
| `templates/prompts/section-planner.md` | LLM prompt | n/a | same | role |
| `templates/prompts/section-drafter.md` | LLM prompt | n/a | same | role |
| `templates/prompts/pass1-fuzzy-judge.md` | LLM prompt (dormant) | n/a | same | role |
| `templates/prompts/pass3-quote-checker.md` | LLM prompt (dormant) | n/a | same | role |

### Bucket 8 — `templates/citation-styles/apa.csl` + `templates/presets/disciplines.json`

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `templates/citation-styles/apa.csl` | locked-copy asset | n/a | `references/doctor-output.md` hash-pin pattern | role |
| `templates/presets/disciplines.json` | static config | n/a | `bin/lib/verbs.json` | role (committed JSON config used by code at runtime) |

### Bucket 9 — `hooks/*` light up bodies

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `hooks/pre-compact.ts` | hook | event-driven | `bin/lib/state.ts::saveState` (write-under-lock) + self (current no-op exit-0) | exact (composer of bin/lib calls) |
| `hooks/post-tool-use.ts` | hook | event-driven | `bin/lib/checkpoint.ts` (existing append-only) + self stub | exact |

### Bucket 10 — `bin/lib/doctor/probes/*` (replace DOCT-05 placeholder)

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `bin/lib/doctor/probes/intake-outline-verify-wiring.ts` (renames `build-artifact-resolves.ts`) | probe | request-response | self — `build-artifact-resolves.ts` shape + PKG_ROOT walker | exact (replace summary + run() body) |
| `bin/lib/doctor/probes/http-crossref-ping.ts` (modify) | probe | request-response | self — Phase 2 SKIP-only stub → PASS/FAIL using `bin/lib/http-mock.ts` | exact (re-enable) |
| `bin/lib/http-mock.ts` (new) | test infra (production tree) | request-response | `bin/lib/http.ts` (chokepoint sibling) | role (NEW; closest is http.ts) |

### Bucket 11 — `tests/*` (14 new + 5 extensions per VALIDATION § Wave 0)

| New/Modified Test File | Role | Closest Analog | Match Quality |
|------------------------|------|----------------|---------------|
| `tests/section-isolation.test.ts` (new) | integration test | `tests/state.test.ts` + `tests/migrations.test.ts` `withTmp` pattern | role (mtime invariant — new shape) |
| `tests/handoff-size.test.ts` (new) | size assertion | `tests/repo-files.test.ts` (existsSync + size checks) | role |
| `tests/cassette-size.test.ts` (new) | size assertion | `tests/repo-files.test.ts` (directory walk + assert) | role |
| `tests/citation-render.test.ts` (new) | smoke | `tests/doctor-probes.test.ts` (smoke around external dep) | role |
| `tests/migration.test.ts` (new) | unit | `tests/migrations.test.ts` | exact (extend loader-contract tests with real v1→v2) |
| `tests/migration.property.test.ts` (new) | property | `tests/doi.property.test.ts` (fast-check shape) | exact |
| `tests/fuzzy.test.ts` (new) | unit | `tests/doi.test.ts` | exact |
| `tests/fuzzy.property.test.ts` (new) | property | `tests/doi.property.test.ts` | exact |
| `tests/normalize.test.ts` (new) | unit | `tests/doi.test.ts` (golden corpus) | exact |
| `tests/drafter-input.test.ts` (new) | unit + property | `tests/pii.test.ts` (corpus-driven + property) | role |
| `tests/sources/<adapter>.test.ts` × 7 (new) | unit | `tests/http-cache.test.ts` (cassette playback) + `tests/fixtures/http-cassettes/crossref-doi-200.json` | role |
| `tests/known-bad-citations.test.ts` (new) | deterministic corpus | `tests/pii.test.ts` (corpus-driven) | role |
| `tests/known-bad-quotes.test.ts` (new) | deterministic corpus | same | role |
| `tests/handoff.test.ts` (new) | integration | `tests/state.test.ts` (load-write round trip) | role |
| `tests/tier-contract.test.ts` (extend) | tier-contract | self — extend 4 cases to 10 | exact |
| `tests/repo-files.test.ts` (extend) | hash-pin | self — D-18 / IN-03 SHA-256 pattern (lines 143-166) | exact |
| `tests/pii.test.ts` (extend) | property | self — add no-leak assertion using POSITIVES | exact |
| `tests/runtime.test.ts` (extend) | property | self — add `PENSMITH_S2_API_KEY` no-leak case | exact |
| `tests/fixtures/lint-chokepoint-fixture.ts` (extend) | lint fixture | self — add `import pdfParse from 'pdf-parse'` line | exact |

### Bucket 12 — `tests/fixtures/*`

| New File | Role | Closest Analog | Match Quality |
|----------|------|----------------|---------------|
| `tests/fixtures/known-good-fixture/assignment.txt` + golden outputs (new) | fixture | `tests/fixtures/pii-corpus.ts` (typed fixture export) | role (text + JSON files rather than .ts; pattern is "deterministic input + expected output") |
| `tests/fixtures/known-bad-citations.json` (new) | fixture | `tests/fixtures/pii-corpus.ts` POSITIVES | role |
| `tests/fixtures/known-bad-quotes.json` (new) | fixture | same | role |
| `tests/fixtures/cassettes/<adapter>/*.json` × 7 (new) | fixture | `tests/fixtures/http-cassettes/crossref-doi-200.json` (existing Phase 1 cassette shape) | exact |

### Bucket 13 — CI + docs + lint config

| New/Modified File | Role | Closest Analog | Match Quality |
|-------------------|------|----------------|---------------|
| `.github/workflows/cassette-refresh.yml` (new) | CI workflow | (none — first CI workflow file in repo) | NO ANALOG |
| `eslint.config.js` (modify) | lint config | self — `bin/lib/http.ts` chokepoint block at lines 89-93 | exact |
| `references/doctor-output.md` (modify) | locked copy | self — Phase 2 DOCT-05 anti-drift removal + re-hash-pin | exact |
| `CONTRIBUTING.md` (modify) | docs | self — D-24 locked Tier-contract section | exact (add `npm run test:record` + `PENSMITH_NETWORK_TESTS=1` section) |

---

## Pattern Assignments

### `bin/lib/pdf-text.ts` (chokepoint, transform)

**Analog:** `bin/lib/doi.ts` (chokepoint discipline) + `bin/lib/http.ts` (third-party-dep wrapper)

**File-header doc-comment pattern** (from `bin/lib/doi.ts` lines 1-12):
```typescript
// bin/lib/pdf-text.ts — pdf-parse extraction chokepoint (D-06).
//
// SOLE call site for `pdf-parse` in the repo. The eslint chokepoint at
// eslint.config.js bans `import 'pdf-parse'` and `import 'pdf-parse/lib/pdf-parse.js'`
// everywhere EXCEPT this file (per-file `no-restricted-imports: 'off'` exemption).
//
// Pitfall 1 workaround: import inner module to bypass index.js debug ENOENT path.
```

**Imports pattern** (single-import + workaround per RESEARCH Pitfall 1):
```typescript
import pdfParse from 'pdf-parse/lib/pdf-parse.js';  // bypass index.js debug path
export async function extractText(buf: Buffer): Promise<string> {
  const { text } = await pdfParse(buf);
  return text;
}
```

**What to copy:** the file-header pattern from `bin/lib/doi.ts` lines 1-12 (chokepoint declaration with lint-rule cross-reference) + the single-export tight API. NO error wrapping — let Buffer/parse errors bubble (matches `doi.ts` returning null vs throw discipline applied to its domain).

---

### `bin/lib/fuzzy.ts` (deterministic primitive, transform)

**Analog:** `bin/lib/doi.ts` (in-tree deterministic algorithm, linear regex, property-test-backed)

**File-header pattern** (from `bin/lib/doi.ts` lines 1-12 + 37-42):
```typescript
// bin/lib/fuzzy.ts — Jaro-Winkler + Levenshtein-substring (D-11 / VRFY-02 / VRFY-04).
//
// Hand-rolled per Claude's Discretion in CONTEXT D-11 + RESEARCH Standard Stack
// recommendation: in-tree algorithm matches doi.ts chokepoint discipline; zero
// version-skew surface.
//
// Threat model (T-01-DOS-03 catastrophic backtracking analogue):
//   No regex. All loops bounded by input length × matchWindow (~O(n*m/2)).
//   The fast-check property test in tests/fuzzy.property.test.ts runs 1000
//   iterations and serves as a fuzz harness against pathological input.
```

**Core algorithm body:** RESEARCH § Code Examples lines 690-769 (jaroWinkler + levenshteinDistance + quoteFoundInPdf). Copy verbatim — the algorithm is canonical.

**What to copy:** the file-header doc style from `doi.ts`; the property-test linkage comment from `doi.ts` lines 37-42; the export shape (pure functions, no class). Property tests in `tests/fuzzy.property.test.ts` mirror `tests/doi.property.test.ts` iteration-count rationale (1000 runs for the strongest property, 500 for cheaper surfaces).

---

### `bin/lib/normalize.ts` (deterministic primitive, transform)

**Analog:** `bin/lib/doi.ts::normalizeDoi` step-by-step shape

**Pattern:** numbered-step doc-comment + single exported function. From `bin/lib/doi.ts` lines 10-22:
```typescript
//   normalizeDoi(input)  ──→  string | null
//     1. trim whitespace
//     2. strip prefix (one of 6 forms, case-insensitive on prefix only)
//     3. strip trailing punctuation in ONE pass (not recursive)
//     4. lowercase ASCII [A-Z] in BOTH halves
//     5. validate against /^10\.\d{4,9}\/\S+$/
```

**Core body:** RESEARCH § Code Examples lines 661-686 (`normalizeForVerify`). Copy the LIGATURE_MAP / SMART_QUOTES / DASHES table-driven design verbatim.

**What to copy:** the numbered-step header comment style; the table-driven replacement array; the `String.prototype.normalize('NFKC')` → ligature → ... → NFD/Mn/NFC pipeline. Idempotence guarantee paragraph from `doi.ts` lines 78-81.

---

### `bin/lib/citations.ts` (chokepoint, transform)

**Analog:** `bin/lib/http.ts` (third-party-dep wrapper with chokepoint comment)

**File-header pattern** (from `bin/lib/http.ts` lines 1-7):
```typescript
// bin/lib/citations.ts — citation-js parser chokepoint (D-19 / D-20).
//
// SOLE call site for `citation-js` in the repo. The eslint chokepoint at
// eslint.config.js bans `import 'citation-js'` everywhere EXCEPT this file
// (per-file `no-restricted-imports: 'off'` exemption).
//
// Role: PARSER ONLY (BibTeX → CSL-JSON). NOT a renderer in Phase 3 —
// rendering deferred to Phase 4 compile / Phase 6 export per D-21.
```

**What to copy:** the SOLE call site comment + lint-exemption reference from `bin/lib/http.ts` lines 1-6. Expose `parseBibtex(src: string): CslJson[]` and (for D-22 smoke test) `renderCsl(records, cslText): string`. NO rendering call sites in Phase 3 hot path — only the smoke test consumes the render export.

---

### `bin/lib/sources/<adapter>.ts` (adapter, request-response) × 7

**Analog:** none exact — closest is `bin/lib/doctor/probes/http-crossref-ping.ts` (callsite shape) + `bin/lib/http.ts` (chokepoint usage) + `tests/fixtures/http-cassettes/crossref-doi-200.json` (cassette shape)

**Required imports + HTTP usage** (per RESEARCH § Architectural Responsibility Map):
```typescript
import { z } from 'zod';
import { fetch } from '../http.js';                    // REPO-05 chokepoint; never undici directly
import { SourceCandidateSchema, type SourceCandidate } from '../schemas/source-candidate.js';
import { getOpenAlexApiKey } from '../runtime.js';    // openalex.ts only; D-16 mirror for semanticscholar.ts
```

**`search` + `fetchById` API surface** (per D-14):
```typescript
export async function search(query: string, opts?: { limit?: number }): Promise<SourceCandidate[]> {
  const r = await fetch('https://api.crossref.org/works?query=' + encodeURIComponent(query), {
    source: 'crossref',
  });
  // ... parse r.body, map to SourceCandidateSchema array
  return parsed.map(c => SourceCandidateSchema.parse(c));   // zod-parse at boundary
}

export async function fetchById(id: string): Promise<SourceCandidate | null> {
  const r = await fetch('https://api.crossref.org/works/' + encodeURIComponent(id), {
    source: 'crossref',
  });
  if (r.status === 404) return null;
  return SourceCandidateSchema.parse(/* mapped fields */);
}
```

**Cassette fixture shape** (from `tests/fixtures/http-cassettes/crossref-doi-200.json` lines 1-20):
```json
{
  "request": { "method": "GET", "url": "https://api.crossref.org/works/10.1038/test" },
  "responses": [
    {
      "status": 200,
      "headers": { "content-type": "application/json" },
      "body": { /* per-adapter native shape */ }
    }
  ]
}
```

**Per-adapter overrides:**
- `unpaywall.ts`: also exports `fetchOaPdf(doi): Promise<Buffer | null>` — fetches `oa_pdf_url`, returns raw bytes; downstream `pdf-text.ts` extracts.
- `retraction-watch.ts`: NO `search` export (D-15); only `fetchById(doi)`.
- `openalex.ts`: reads `getOpenAlexApiKey()` per RESEARCH Pitfall 2; sends `Authorization: Bearer <key>` when present, WARN-once when absent.
- `semanticscholar.ts`: D-16 mirror — reads `PENSMITH_S2_API_KEY` via new `runtime.ts::getS2ApiKey` accessor (same shape as `getOpenAlexApiKey` at `bin/lib/runtime.ts` lines 438-462).

**What to copy:** the `import { fetch } from '../http.js'` + `source: '<name>'` pattern from how `bin/lib/http.ts` routes through `bucketFor(src)`; zod-parse-at-boundary pattern from how `bin/lib/state.ts::saveState` parses BEFORE the write (lines 247).

---

### `bin/lib/schemas/source-candidate.ts` (zod schema)

**Analog:** `bin/lib/schemas/library.ts` lines 16-33

**Pattern:** small file, single `Schema` export + `LibraryEntrySchema` sibling, `CURRENT_<NAME>_VERSION` constant, `.optional()` everywhere we're forward-tolerant.

**Body:** CONTEXT D-14 lines 94-109 (verbatim schema). Plus:
```typescript
import { z } from 'zod';
export const SourceCandidateSchema = z.object({ /* D-14 verbatim */ });
export type SourceCandidate = z.infer<typeof SourceCandidateSchema>;
```

**What to copy:** the doc-header style from `library.ts` lines 1-14 ("Phase X scope: ...; future migrations extend ..."); the `z.infer<typeof Schema>` type export pattern.

---

### `bin/lib/schemas/handoff.ts` (zod schema)

**Analog:** `bin/lib/schemas/checkpoint.ts` (small envelope, refs map, defaults)

**Body:** RESEARCH § Code Examples lines 801-826 (`HandoffSchema` verbatim from D-17). Copy.

**What to copy:** the doc-header pattern from `checkpoint.ts` lines 1-10 (envelope-only Phase scope + future-migration comment); `z.literal(1)` for schema_version (matches `checkpoint.ts` line 17).

---

### `bin/lib/schemas/plan-frontmatter.ts` (zod schema)

**Analog:** `bin/lib/schemas/state.ts` lines 28-53 (enums + `.passthrough()` pattern)

**Pattern from `state.ts` lines 28-31:**
```typescript
export const SectionStateSchema = z.enum([
  'planned', 'writing', 'written', 'verifying', 'verified', 'failed',
]);
export type SectionState = z.infer<typeof SectionStateSchema>;
```

**Plus** (per D-08):
```typescript
export const PlanFrontmatterSchema = z.object({
  state: SectionStateSchema,
  thesis: z.string().min(1),
  word_target: z.number().int().positive(),
  sources: z.array(z.string()),               // citekeys
  depends_on: z.array(z.string()),            // slugs (D-03)
  last_verification: z.object({
    verdict: z.enum(['PASS', 'FAIL', 'PARTIAL', 'UNCLEAR']),
    timestamp: z.string().datetime(),
    draft_hash: z.string(),                   // D-10
  }).nullable(),
}).superRefine((data, ctx) => {
  // D-04 (1): no self-reference enforced at outline-write time, slug passed via ctx.path or wrapper
});
```

**What to copy:** the inline enum + `.passthrough()` from `SectionEntrySchema` line 52 — Phase 3 may want `.passthrough()` so Phase 4 adds fields without re-bumping; the doc-comment cross-reference style from `schemas/state.ts` lines 1-16.

---

### `bin/lib/state.ts` (modify — wake migration writeBack branch)

**Analog:** self — the writeBack branch already wired at line 211 with `writeBack: true`. Migration registry currently empty; D-09 adds the first real entry.

**Current pattern** (`bin/lib/state.ts` lines 198-219):
```typescript
export async function loadState(paperRoot: string): Promise<State> {
  // ...
  value = await withLock(file, async () =>
    (await loadAndMigrate({
      file, schema: StateSchema, schemaName: 'state',
      currentVersion: CURRENT_STATE_VERSION,
      writeBack: true,                              // already true
    })) as State,
  );
  // ...
}
```

**Extension (D-09):** pass a `migrations` registry to `loadAndMigrate` containing `{ 1: realV1ToV2 }`. The real migration body draws from RESEARCH § Code Examples lines 442-466 and Pitfall 9 (explicit `...rest` preserve pattern).

**Migration-context (`ctx`) pattern** (per RESEARCH lines 446-466) requires extending `loader.ts::Migration` to accept a context arg, OR (simpler) the migration receives only the parsed value and performs PLAN.md frontmatter writes via direct atomic-write call. Planner picks; cleanest is to make migration a closure over `ctx = { paths, frontmatter }`.

**What to copy:** the existing `withLock(file, async () => loadAndMigrate({...writeBack: true}))` wrapper from lines 211-218 — DO NOT add a new lock; the writeBack branch already locks. Bump `CURRENT_STATE_VERSION` from 1 to 2 in `bin/lib/schemas/state.ts` line 20 + slim `SectionEntrySchema` lines 46-52.

---

### `bin/lib/schemas/state.ts` (modify — slim SectionEntrySchema)

**Analog:** self lines 46-52

**Before** (current lines 46-52):
```typescript
export const SectionEntrySchema = z.object({
  n: z.number().int().min(1),
  slug: z.string().min(1).optional(),
  state: SectionStateSchema.default('planned'),        // DROP per D-09
  status: SectionStatusSchema.default('pending'),      // DROP per D-09
  lastVerification: VerificationVerdictSchema.optional(),  // DROP per D-09
}).passthrough();
```

**After** (per D-09):
```typescript
export const SectionEntrySchema = z.object({
  n: z.number().int().min(1),
  slug: z.string().min(1),                              // now REQUIRED (was optional)
}).passthrough();                                       // .passthrough() kept for future fields
```

**What to copy:** keep `.passthrough()` — Phase 4 will add fields without a v3 bump. Update `CURRENT_STATE_VERSION = 1` → `2` at line 20. Remove no-longer-used enum imports if the helpers (`initSection` / `advanceSection` / `setSectionStatus` / `recordVerification` in `state.ts` lines 314-369) are also removed — those helpers DELEGATE to PLAN.md frontmatter now (the per-section file is source of truth), NOT to STATE.json.

---

### `bin/lib/runtime.ts` (modify — add `getS2ApiKey`)

**Analog:** self — `getOpenAlexApiKey` at lines 438-462

**Copy verbatim with substitutions:**
```typescript
export async function getS2ApiKey(
  opts: { scope?: LoadScope; paperRoot?: string } = {},
): Promise<string | undefined> {
  const cfg = await loadRuntimeConfig(opts);
  const envName = cfg.s2ApiKeyEnv ?? 'PENSMITH_S2_API_KEY';
  const optional = cfg.s2ApiKeyOptional ?? true;
  const resolved = process.env[envName];
  const present = !!(resolved && resolved.length > 0);
  log().event({ event: 'runtime.s2', envName, optional, present });
  if (present) return resolved;
  if (optional) return undefined;
  throw new MissingApiKeyError(`env var ${envName} is not set ...`);
}
```

**Schema extension** (`bin/lib/schemas/runtime-config.ts` lines 28-35):
```typescript
// Add:
s2ApiKeyEnv: z.string().default('PENSMITH_S2_API_KEY'),
s2ApiKeyOptional: z.boolean().default(true),
```

**What to copy:** the entire no-leak comment block from `runtime.ts` lines 432-437 (T-01-07 invariant); the log-only-`present`-boolean discipline; the optional-vs-throw branching at lines 457-461.

---

### `bin/lib/paths.ts` (modify — add section path helpers)

**Analog:** self — `paperDir` at lines 117-119

**Pattern:**
```typescript
export function paperDir(root: string = projectRoot()): string {
  return path.join(root, '.paper');
}
```

**Extensions (per D-08 / OUTL-04):**
```typescript
function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

export function sectionDir(n: number, slug: string, root: string = projectRoot()): string {
  return path.join(paperDir(root), 'sections', `${pad2(n)}-${slug}`);
}
export function planPath(n: number, slug: string, root: string = projectRoot()): string {
  return path.join(sectionDir(n, slug, root), 'PLAN.md');
}
export function draftPath(n: number, slug: string, root: string = projectRoot()): string {
  return path.join(sectionDir(n, slug, root), 'DRAFT.md');
}
export function verificationPath(n: number, slug: string, root: string = projectRoot()): string {
  return path.join(sectionDir(n, slug, root), 'VERIFICATION.md');
}
```

**Slug regex** (per VALIDATION 3-W0-01 / T-3-12 path-traversal threat):
```typescript
const SLUG_RE = /^[a-z0-9-]+$/;
function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug: ${JSON.stringify(slug)}`);
}
```

**What to copy:** the chokepoint discipline comment from `paths.ts` lines 1-7; the cross-platform `path.join` pattern; the slug zod-enforcement (planner adds `SectionSlug = z.string().regex(/^[a-z0-9-]+$/)` to `plan-frontmatter.ts`).

---

### `bin/lib/handoff.ts` (new) + `hooks/pre-compact.ts` (modify body)

**Analog for `handoff.ts`:** `bin/lib/state.ts::saveState` (atomic-write under lock)

**Pattern from `state.ts` lines 245-258:**
```typescript
export async function saveState(paperRoot: string, state: State): Promise<void> {
  const file = stateFile(paperRoot);
  const validated = StateSchema.parse(state);
  await withLock(file, async () => {
    await atomicWriteFile(file, JSON.stringify(validated, null, 2) + '\n');
  });
  log().event({ event: 'state.save', ... });
}
```

**Apply to `handoff.ts`:**
```typescript
import { HandoffSchema } from './schemas/handoff.js';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { paperDir } from './paths.js';

export async function writeHandoff(paperRoot: string, handoff: Handoff): Promise<void> {
  const file = path.join(paperDir(paperRoot), 'HANDOFF.json');
  const validated = HandoffSchema.parse(handoff);
  await withLock(file, async () => {
    await atomicWriteFile(file, JSON.stringify(validated, null, 2) + '\n');
  });
}
```

**Hook body** (`hooks/pre-compact.ts` — replaces current `process.exit(0)` stub):
```typescript
#!/usr/bin/env node
import { writeHandoff } from '../bin/lib/handoff.js';
import { computeHandoff } from '../bin/lib/handoff.js';   // reads STATE.json + per-section PLAN.md frontmatter
import { paperDir } from '../bin/lib/paths.js';
try {
  const root = process.env.PENSMITH_PAPER_ROOT ?? paperDir();
  const h = await computeHandoff(root);
  await writeHandoff(root, h);
  process.exit(0);
} catch (_e) {
  process.exit(0);                                          // never block compact on hook failure
}
```

**What to copy:** the `validate → withLock → atomicWriteFile` order from `state.ts::saveState`; the test-only-`event`-log discipline (no payload); the never-block-compact exit-0 from existing pre-compact stub line 8.

---

### `hooks/post-tool-use.ts` (modify body)

**Analog:** `bin/lib/checkpoint.ts` (append-only) + RESEARCH integration points (≤1/min throttled via mtime gate)

**Pattern:**
```typescript
#!/usr/bin/env node
import { writeCheckpointLine } from '../bin/lib/checkpoint.js';
import { paperDir } from '../bin/lib/paths.js';
const THROTTLE_MS = 60_000;
try {
  const root = process.env.PENSMITH_PAPER_ROOT ?? paperDir();
  const file = path.join(root, 'CHECKPOINTS.jsonl');
  const stat = await fs.promises.stat(file).catch(() => null);
  if (stat && Date.now() - stat.mtimeMs < THROTTLE_MS) process.exit(0);
  await writeCheckpointLine(root, { ts: new Date().toISOString(), event: 'tool-use' });
} finally {
  process.exit(0);
}
```

**What to copy:** the mtime-throttle pattern (new); the never-block exit-0 finally; the `CHECKPOINTS.jsonl` append-only invariant from `bin/lib/checkpoint.ts`.

---

### `bin/pensmith.ts` (modify — light up 5 verbs)

**Analog:** self — `REAL_VERB_LOADERS.doctor` line 38

**Pattern from `bin/pensmith.ts` lines 37-39:**
```typescript
const REAL_VERB_LOADERS: Partial<Record<Ux02Verb, () => Promise<AnyCommandDef>>> = {
  doctor: () => import('./cli/doctor.js').then((m) => m.doctorCommand),
};
```

**Add (5 entries):**
```typescript
const REAL_VERB_LOADERS: Partial<Record<Ux02Verb, () => Promise<AnyCommandDef>>> = {
  doctor: () => import('./cli/doctor.js').then((m) => m.doctorCommand),
  new: () => import('./cli/new.js').then((m) => m.newCommand),
  research: () => import('./cli/research.js').then((m) => m.researchCommand),
  outline: () => import('./cli/outline.js').then((m) => m.outlineCommand),
  plan: () => import('./cli/plan.js').then((m) => m.planCommand),
  write: () => import('./cli/write.js').then((m) => m.writeCommand),
  verify: () => import('./cli/verify.js').then((m) => m.verifyCommand),
};
```

**What to copy:** the single-line `() => import('...').then(m => m.<name>Command)` shape from line 38 — keep imports lazy so the dispatcher cold-start stays fast; the corresponding `bin/cli/<verb>.ts` files define `<verb>Command` as a citty `defineCommand` (mirror `bin/cli/doctor.ts`).

---

### `mcp/server.ts` + `mcp/tools.ts` (modify — light up 3 state-mutation tools)

**Analog:** self — `mcp/tools.ts` already registers `paper_init_section` / `paper_advance_section` / `paper_record_verification` at lines 30-83. The handlers delegate to `bin/lib/state.ts::initSection` etc.

**Phase 3 change:** the delegate targets MOVE from `state.ts::initSection` (line 314) to per-section PLAN.md frontmatter writers. The thin-shim discipline (`mcp/tools.ts` handler ≤30 stmts, D-08) is unchanged.

**Pattern from `mcp/tools.ts` lines 30-46:**
```typescript
server.registerTool('paper_init_section', {
  title: 'Initialize a new section',
  description: '...',
  inputSchema: { paperRoot: z.string().min(1), n: z.number().int().min(1), slug: z.string().min(1) },
}, async ({ paperRoot, n, slug }) => {
  const next = await initSection(paperRoot, n, slug);                  // delegate to bin/lib
  return { content: [{ type: 'text' as const, text: JSON.stringify(next, null, 2) }] };
});
```

**What to copy:** the thin-shim discipline — handler body is 1 delegate call + 1 return. Per `mcp/tools.ts` doc comment lines 4-7, the `inputSchema` is a flat record (NOT `z.object({...})`).

---

### `workflows/<verb>.md` (modify — 6 stub bodies)

**Analog:** self — `workflows/new.md` Phase 2 stub structure

**Pattern from `workflows/new.md`:**
```markdown
# pensmith new

> Start a new paper project (capture initial requirements).

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: read response from stdin in Tier 2
</capability_check>

## Overview
(Phase 2 stub — Phase 3+ fills this in.)

## Steps
1. (stub)

## Outputs
- (stub)
```

**Phase 3 fills `## Overview`, `## Steps`, `## Outputs` for each of 6 files.** `<capability_check>` block stays at the top per RESEARCH § Open Questions #2 recommendation (ONE per file, multiple `<step>` children, NOT nested per sub-step).

**What to copy:** the `<capability_check>` block shape verbatim; the `## Overview / ## Steps / ## Outputs` headings (planner fills bodies). Each workflow body's `<capability_check>` declares what Tier 1 needs (AskUserQuestion / Task / MCP tool names) + what to do on Tier 2 (clack / stdin / direct file read). Reference: `workflows/verify.md` lines 5-13 for the most-detailed existing example.

---

### `templates/prompts/<role>.md` (new — 8 files)

**Analog:** `references/doctor-output.md` (locked-copy + hash-pin pattern)

**Pattern from `references/doctor-output.md` lines 1-8:**
```markdown
# Doctor Output Strings (locked — D-18)

This file is the SINGLE source of truth for `/pensmith doctor` user-facing prose.
`bin/cli/doctor.ts` reads these strings at module load.
Drift between the locked copy and the rendered output is a regression — pinned
by sha256 hash in `tests/repo-files.test.ts`.
```

**Apply to each prompt** (8 files, each ~30-60 lines):
```markdown
# <role> prompt (locked — D-12)

This file is the SINGLE source of truth for the <role> subagent's system+user
messages. <consumer file> reads this at module load.
Pinned by sha256 hash in `tests/repo-files.test.ts`.

## System message
> <verbatim system prompt>

## User message template
> <verbatim user prompt with placeholders>

## Input contract
- <field>: <type> — <description>

## Output contract (zod-validated by consumer)
- <field>: <type>
```

**What to copy:** locked-copy disclaimer at top; SHA-256 hash-pin cross-reference; `> blockquote` for any literal string the consumer reads at runtime (matches `doctor-output.md` pattern for footer copy at lines 19-25).

---

### `templates/citation-styles/apa.csl` (new — locked-copy asset)

**Analog:** `references/doctor-output.md` hash-pin pattern (lines 143-150)

**What to copy:** download official APA-7 CSL from `https://github.com/citation-style-language/styles/blob/master/apa.csl`, commit verbatim, add SHA-256 hash-pin to `tests/repo-files.test.ts` matching the exact pattern at lines 143-150:
```typescript
test('templates/citation-styles/apa.csl hash-pin (CITE-01 / D-19)', () => {
  const bytes = readFileSync('templates/citation-styles/apa.csl');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const PINNED = '<sha256-of-bundled-version>';
  assert.equal(hash, PINNED, `apa.csl drifted from locked copy. Update PINNED to ${hash} if intentional.`);
});
```

---

### `templates/presets/disciplines.json` (new — static config)

**Analog:** `bin/lib/verbs.json` (committed JSON used by code at runtime)

**Pattern:** JSON array of 8 discipline preset objects (humanities/social-sci/STEM/medicine/law/business/CS/general). Consumer = `bin/cli/new.ts` (the intake CLI) reads via `JSON.parse(readFileSync(...))` once at module load.

**What to copy:** the JSON-loaded-at-module-init discipline from `bin/lib/verbs.ts` reading `UX02_VERBS` (referenced in `bin/pensmith.ts` line 20).

---

### `bin/lib/doctor/probes/intake-outline-verify-wiring.ts` (replace `build-artifact-resolves.ts`)

**Analog:** self — `build-artifact-resolves.ts` lines 1-106

**Replace the body of `run()`:** existing probe checks `dist/bin/pensmith.js --version`. New probe:
1. uses `tests/fixtures/known-good-fixture/assignment.txt` (D-01) + cassettes (D-23) to exercise a tiny intake→outline→verify slice;
2. asserts the resulting `.paper/sections/<slug>/PLAN.md` + `VERIFICATION.md` exist + parse;
3. returns PASS / WARN / FAIL per D-15.

**What to copy:** `findPkgRoot` walker from lines 30-44; `presentNonEmpty` error-classification from lines 53-68; `execFileSync` (NEVER `exec` — Pitfall 8 line 9); 5s `timeout`; PASS/FAIL summary lines lines 76-103. NEW behavior is the actual fixture-driven exercise; same probe shape.

**Doctor output copy update:** `references/doctor-output.md` removes the `wiring-smoke|DOCT-05 must NOT appear` anti-drift assertion currently in `tests/repo-files.test.ts` line 182, ADDS a new section for `intake-outline-verify-wiring (DOCT-05)`, re-hashes via the existing pattern at lines 143-150.

---

### `bin/lib/http-mock.ts` (new — production tree, re-enables `http-crossref-ping`)

**Analog:** `bin/lib/http.ts` (chokepoint sibling)

**Per the comment block in `bin/lib/doctor/probes/http-crossref-ping.ts` lines 1-23:** Phase 3 introduces a production-tree `bin/lib/http-mock.ts` chokepoint owned by the http layer. The probe's `run()` will: (a) check for the chokepoint, (b) if present, call `dispatchCrossrefPing()` against MockAgent, (c) discriminate PASS/FAIL on response status.

**What to copy:** the `bin/lib/http.ts` file-header chokepoint discipline (lines 1-7) — `http-mock.ts` is the ONLY production-tree file allowed to import `undici/mock-agent` (extend the eslint chokepoint to permit this one extra file).

---

### `tests/sources/<adapter>.test.ts` × 7 (new)

**Analog:** `tests/http-cache.test.ts` (cassette playback) + `tests/fixtures/http-cassettes/crossref-doi-200.json` (cassette shape)

**Pattern:** each adapter test loads its cassette JSON, installs nock interceptors, invokes `search` or `fetchById`, asserts zod-parse succeeds at the boundary + returned shape matches `SourceCandidateSchema`.

**Sample:**
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nock from 'nock';
import { search } from '../../bin/lib/sources/crossref.js';

test('crossref search returns SourceCandidate[] against cassette', async () => {
  nock('https://api.crossref.org').get(/\/works\?query=.+/).reply(200, /* cassette body */);
  const out = await search('attention mechanisms in transformers');
  assert.ok(Array.isArray(out));
  assert.ok(out.every(c => typeof c.title === 'string'));
});
```

**What to copy:** cassette-fixture loading shape from existing Phase 1 cassettes; nock setup discipline from `tests/http-cache.test.ts` (it's the only existing file importing nock per eslint exemption block lines 121-130).

---

### `tests/fuzzy.test.ts` + `tests/fuzzy.property.test.ts`

**Analog:** `tests/doi.test.ts` (golden corpus) + `tests/doi.property.test.ts` (fast-check shape)

**Pattern from `tests/doi.property.test.ts` lines 16-21:**
```typescript
// Iteration counts:
//   - 1000 runs for normalizeDoi idempotence (the strongest guarantee)
//   - 1000 runs for trailing-punct accept (high-volume false-FABRICATED risk)
//   - 500 runs for arxiv/pmid (smaller surface)
```

**Apply to fuzzy:**
```typescript
// Iteration counts:
//   - 1000 runs for jaroWinkler(a,a)=1 (identity)
//   - 1000 runs for symmetry: jw(a,b)=jw(b,a)
//   - 1000 runs for range: jw ∈ [0,1]
//   - 500 runs for Levenshtein triangle inequality on small alphabets
```

**Plus golden cases** (per VALIDATION 3-W0-07):
```typescript
test('jaro-winkler thresholds: Müller / Mueller (post-normalize) ≥ 0.85', () => {
  const a = normalizeForVerify('Müller');
  const b = normalizeForVerify('Mueller');
  assert.ok(jaroWinkler(a, b) >= 0.85);
});
```

**What to copy:** fast-check import + arbitrary-corpus pattern from `tests/doi.property.test.ts` lines 23-40; iteration-count rationale comments.

---

### `tests/migration.test.ts` + `tests/migration.property.test.ts`

**Analog:** `tests/migrations.test.ts` (lines 1-50 setup + 53-327 test cases)

**Pattern (from `tests/migrations.test.ts`):**
```typescript
async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-mig-'));
  try { await fn(dir); }
  finally { await fsp.rm(dir, { recursive: true, force: true }); }
}
```

**Required test cases (per D-09 / VALIDATION 3-W0-05):**
1. v1 → v2 round-trip (v1 read → migrate → v2 on disk → re-read v2)
2. Idempotent on v2 (v2 read → no migration → v2 unchanged)
3. Refuse-forward on v3 (`ForwardIncompatError` per Phase 1 D-39 / `tests/migrations.test.ts` lines 53-81)

**Property test pattern (per Pitfall 9):**
```typescript
import fc from 'fast-check';
test('migrate preserves all top-level fields except enumerated drops', () => {
  fc.assert(fc.property(arbitraryV1State(), (v1) => {
    const v2 = migrateV1ToV2(v1);
    for (const k of Object.keys(v1)) {
      if (k === 'sections') continue;     // sections re-shaped
      assert.deepEqual(v2[k], v1[k]);
    }
  }), { numRuns: 1000 });
});
```

**What to copy:** `withTmp` helper verbatim; `seed` helper via `atomicWriteFile` per `tests/migrations.test.ts` lines 38-40 (atomic-write chokepoint discipline applies to tests too); the BLOCKER-02 concurrent-load-and-migrate test at lines 231-293 — extend to assert section state correctly migrated into PLAN.md frontmatter under concurrent load.

---

### `tests/repo-files.test.ts` (extend — 11 new hash-pins)

**Analog:** self — D-18 pattern at lines 143-150 + IN-03 pattern at lines 159-166

**Pattern verbatim (from lines 143-150):**
```typescript
test('<file> hash-pin (<decision-id>)', () => {
  const bytes = readFileSync('<path>');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const PINNED = '<sha256>';
  assert.equal(hash, PINNED, `<file> drifted from locked copy. Update PINNED to ${hash} if the edit was intentional.`);
});
```

**Apply 11 times** to:
- 8 × `templates/prompts/<role>.md` (D-12)
- 1 × `templates/citation-styles/apa.csl` (D-19 / CITE-01)
- 1 × `tests/fixtures/known-good-fixture/assignment.txt` (D-01 / TEST-04)
- 1 × `tests/fixtures/known-bad-citations.json` (TEST-04 / SC-2)
- 1 × `tests/fixtures/known-bad-quotes.json` (TEST-04 / SC-3)

**REMOVAL (per VALIDATION 3-W0-14):** delete the anti-drift assertion at line 182 (`wiring-smoke|DOCT-05 must NOT appear`) — DOCT-05 lights up in Phase 3; add corresponding new anchor-presence assertion for `intake-outline-verify-wiring (DOCT-05)`.

**What to copy:** the regenerate-one-liner comment from lines 146-147 verbatim (the `node -e "console.log(require('node:crypto').createHash..."` recipe). Keep PR-diff visibility intent.

---

### `tests/tier-contract.test.ts` (extend — 6 new cases)

**Analog:** self — current 4 cases (A capability / B paper://capabilities / C state idempotency / D prose tolerance) at lines 1-100+

**Pattern (from lines 30-71):**
```typescript
before(async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: [MCP_BIN] });
  client = new Client({ name: 'tier-contract', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
});

function freshPaperRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-contract-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, /* slim v2 schema */ }));
  return root;
}
```

**Extension (per TEST-01 + VALIDATION 3-W0-13):** add 6 cases (one per new verb). Each:
1. `freshPaperRoot()` with `PENSMITH_PAPER_ROOT=<tmp>` for both tiers
2. invoke Tier 1 via MCP `Client` (use `paper_init_section` / `paper_advance_section` / `paper_record_verification` for state-mutating verbs)
3. invoke Tier 2 via `execFileSync(CLI_BIN, [<verb>])` 
4. `assertEquivalent(tier1, tier2, { tolerance: 0.20 })` per existing TIER-07 import line 25
5. Cassettes (D-23) serve all source-adapter HTTP — no live network

**What to copy:** the `Client + StdioClientTransport` setup at lines 33-43; the `freshPaperRoot()` helper at lines 54-71 (update `$schemaVersion: 1` → `2` per D-09 slim schema); the `assertEquivalent` import + tolerance-0.20 convention.

---

### `tests/lint-chokepoint-fixture.ts` (extend)

**Analog:** self — current fixture violates D-06 (HTTP) + D-07 (DOI regex)

**Current pattern (from lines 13-21):**
```typescript
// === D-06 violation: HTTP import outside bin/lib/http.ts ===
import { fetch } from 'undici';
// === D-07 violation: /^10\./ regex outside bin/lib/doi.ts ===
const doiPrefixRegex = /^10\./;
export const _redTeam = { fetch, doiPrefixRegex };
```

**Extension (Phase 3 D-06 chokepoint):**
```typescript
// === D-06 (Phase 3): pdf-parse import outside bin/lib/pdf-text.ts ===
import pdfParse from 'pdf-parse';
// === D-19 (Phase 3): citation-js import outside bin/lib/citations.ts ===
import citation from 'citation-js';
export const _redTeam = { fetch, doiPrefixRegex, pdfParse, citation };
```

**What to copy:** the `@ts-nocheck` discipline at line 11; the `_redTeam` export pattern that prevents tree-shaking (line 21); the corresponding entry in `eslint.config.js` chokepoint block (add `{ name: 'pdf-parse', ... }` and `{ name: 'citation-js', ... }` to `no-restricted-imports.paths` — extend the existing block at lines 40-48).

---

### `.github/workflows/cassette-refresh.yml` (NEW — no analog)

**Analog:** none in repo (first workflow file)

**Body:** RESEARCH § Pattern 4 lines 484-509 (verbatim). Copy.

**What to copy:** the full file verbatim from RESEARCH. Schedule `0 6 * * 1` per D-24; `peter-evans/create-pull-request@v6` for the auto-PR; `secrets.PENSMITH_CONTACT_EMAIL` / `secrets.OPENALEX_API_KEY` / `secrets.PENSMITH_S2_API_KEY` for the rate-good env. Per RESEARCH Pitfall 6: explicit `NOCK_BACK_MODE=record` + `PENSMITH_NETWORK_TESTS=1` in this job (and only this job).

---

### `eslint.config.js` (modify — add pdf-parse + citation-js chokepoints)

**Analog:** self — D-06 HTTP chokepoint block at lines 39-48 + per-file exemption at lines 89-93

**Extend lines 40-48** (add 3 entries to `paths` array):
```javascript
'no-restricted-imports': ['error', {
  paths: [
    { name: 'undici', message: 'Import HTTP only via bin/lib/http.ts' },
    // ... existing entries ...
    { name: 'pdf-parse', message: 'Use bin/lib/pdf-text.ts::extractText instead.' },
    { name: 'pdf-parse/lib/pdf-parse.js', message: 'Use bin/lib/pdf-text.ts::extractText instead.' },
    { name: 'citation-js', message: 'Use bin/lib/citations.ts instead.' },
  ],
}],
```

**Add 2 per-file exemption blocks** (mirror lines 89-93 + 95-99):
```javascript
{
  files: ['bin/lib/pdf-text.ts'],
  rules: { 'no-restricted-imports': 'off' },
},
{
  files: ['bin/lib/citations.ts'],
  rules: { 'no-restricted-imports': 'off' },
},
```

**What to copy:** the per-file-exemption shape from `bin/lib/http.ts` block at lines 89-93. Single rule with `'off'`, NOT a re-declaration of the rule's paths.

---

### `references/doctor-output.md` (modify — DOCT-05 replacement) + `CONTRIBUTING.md` (modify — test:record docs)

**Analog:** self — existing locked sections + D-24 documentation discipline

**`references/doctor-output.md`:** add a new section for `intake-outline-verify-wiring (DOCT-05)` matching the existing section style at lines 30-40. Update SHA-256 pin in `tests/repo-files.test.ts` line 148. Remove the line 182 anti-drift assertion (per VALIDATION 3-W0-14).

**`CONTRIBUTING.md`:** add a new section documenting the `npm run test:record` pattern + `PENSMITH_NETWORK_TESTS=1` opt-in (per CONTEXT D-deferred final note: "Phase 3 documents the pattern in CONTRIBUTING.md but does NOT ship a one-line npm run test:record until plan-phase researcher confirms"). Section follows the D-24-locked "Tier contract" section's heading discipline.

**What to copy:** the locked-heading discipline from `tests/repo-files.test.ts` lines 188-214 (CF-D24 test) — heading additions must update both the `.md` file AND the test pin.

---

## Shared Patterns

### Chokepoint discipline (REPO-05 / Phase 0 D-07 extended)

**Source:** `bin/lib/http.ts` lines 1-7 + `bin/lib/doi.ts` lines 1-12 + `eslint.config.js` lines 89-93

**Apply to:** every new bin/lib/* file that wraps a third-party dep or houses a deterministic primitive (`pdf-text.ts`, `citations.ts`, `fuzzy.ts`, `normalize.ts`, `drafter-input.ts`, `http-mock.ts`)

**Required elements:**
1. File-header doc-comment declaring "SOLE call site for X" + naming the lint rule
2. Per-file `eslint.config.js` exemption block (3-line `{ files, rules: { '<rule>': 'off' } }`)
3. Single small public surface (1-3 named exports max — see `pdf-text.ts::extractText`)
4. Corresponding red-team fixture line in `tests/fixtures/lint-chokepoint-fixture.ts`

### Atomic-write under lock (D-07 / D-04)

**Source:** `bin/lib/state.ts::saveState` lines 245-258

**Apply to:** every file write in Phase 3 — PROJECT.md / config.toml / RESEARCH.md / CITATIONS.bib / sections/<N>/{PLAN.md,DRAFT.md,VERIFICATION.md} / HANDOFF.json

**Pattern:**
```typescript
const validated = Schema.parse(value);                  // validate BEFORE the lock (T-01-08)
await withLock(file, async () => {
  await atomicWriteFile(file, JSON.stringify(validated, null, 2) + '\n');
});
log().event({ event: '<verb>.save', /* SAFE FIELDS ONLY */ });
```

### Load-INSIDE-the-lock for mutations (Phase 1 BLOCKER-01/02)

**Source:** `bin/lib/state.ts::updateState` lines 274-301 + `bin/lib/state.ts::loadState` lines 198-219

**Apply to:** every PLAN.md frontmatter mutation (write-section / verify-section state transitions); every STATE.json mutation (rare in Phase 3 — only on section add/remove after migration)

### No-leak invariant (T-01-07)

**Source:** `bin/lib/runtime.ts` lines 36-47 + lines 432-437

**Apply to:** `getS2ApiKey` (new, D-16) + every source-adapter that consumes an API key — log only env-var NAME + `present:boolean`, NEVER the resolved value. Extend `tests/runtime.test.ts` no-leak property.

### SHA-256 hash-pin (Phase 2 D-18 / IN-03)

**Source:** `tests/repo-files.test.ts` lines 143-150 + 159-166

**Apply to:** 11 new pins per VALIDATION 3-W0-14 (8 prompts + apa.csl + assignment.txt + 2 known-bad-*.json). One test per file, regenerate-one-liner comment, descriptive failure message.

### Cassette + cron (D-23 / D-24)

**Source:** RESEARCH § Pattern 4 lines 484-509 + `tests/fixtures/http-cassettes/crossref-doi-200.json`

**Apply to:** 7 adapter cassette dirs (`tests/fixtures/cassettes/<adapter>/`) + 1 new GitHub Action workflow

### Property-test rigor (Phase 1 fast-check discipline)

**Source:** `tests/doi.property.test.ts` lines 16-21

**Apply to:** `tests/fuzzy.property.test.ts`, `tests/migration.property.test.ts`, extension of `tests/runtime.test.ts` and `tests/pii.test.ts`. Iteration counts: 1000 for strongest properties, 500 for cheaper surfaces.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.github/workflows/cassette-refresh.yml` | CI workflow | event-driven (cron) | First GitHub Actions workflow file in repo; copy verbatim from RESEARCH § Pattern 4 lines 484-509 |
| `bin/lib/sources/*` directory (overall) | adapter directory | request-response | No existing adapter directory in repo; closest precedent is `bin/lib/doctor/probes/*` for directory shape, but probes are read-only single-call; adapters are dual `search`+`fetchById`. Planner uses `bin/lib/doctor/probes/http-crossref-ping.ts` for the HTTP-call shape and `bin/lib/schemas/library.ts` for the per-adapter schema shape, but the bucket as a whole is new architectural territory. |

(Two entries above; everything else has a concrete analog in this repo.)

---

## Metadata

**Analog search scope:** `bin/lib/**`, `bin/lib/doctor/probes/**`, `bin/lib/schemas/**`, `bin/lib/migrations/**`, `bin/cli/**`, `mcp/**`, `hooks/**`, `workflows/**`, `templates/**`, `references/**`, `tests/**`, `eslint.config.js`, `bin/pensmith.ts`

**Files scanned:** ~25 files Read directly; ~50 file paths inspected via Glob/Bash directory listings

**Pattern extraction date:** 2026-05-17

**Key insight for planner:** Phase 3 is overwhelmingly "extend existing patterns" — 58/60 new+modified files have an exact or role-match analog already in the repo. The two no-analog cases (`.github/workflows/*.yml`, `bin/lib/sources/*` directory) are both fully spec'd in RESEARCH.md and CONTEXT.md respectively. The chokepoint discipline at `bin/lib/http.ts` / `bin/lib/doi.ts` is the single most-reused pattern (applies to 6 new bin/lib/* files); the atomic-write-under-lock pattern at `bin/lib/state.ts::saveState` is the second most-reused (applies to every Phase 3 file write).
