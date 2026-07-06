# Architecture Research

**Domain:** v0.3.0 integration architecture — wiring FEED (LIBRARY.json → prompts), HARDEN (strict e2e CI + live lane), SEC (SSRF pin + PDF worker abort) into the existing pensmith pipeline
**Researched:** 2026-07-06
**Confidence:** HIGH (all integration points read directly from the existing codebase, not inferred)

> Note: this document supersedes the 2026-05-06 project-inception ARCHITECTURE.md at this path. That document covered the original greenfield system design (Tier-1/Tier-2 split, the three-ring Foundation/Domain/Surface model, the initial vertical-slice build order) and remains valid as background — this revision is scoped narrowly to the v0.3.0 milestone's three integration workstreams (FEED/HARDEN/SEC) against the NOW-EXISTING implementation.

## Standard Architecture

### System Overview (current, pre-v0.3.0)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CLI verbs (bin/cli/*.ts)                                                │
│  new → research → outline → { plan → write → verify }* → compile → done  │
├──────────────────────────────────────────────────────────────────────────┤
│  research.ts:                                                            │
│    runResearchOrchestrator → SourceCandidate[] → crossCheckRetractions   │
│      → writeBibtex/.bib, writeRis/.ris → atomicWriteFile(LIBRARY.json)   │
│      LIBRARY.json = { $schemaVersion: 1, entries: SourceCandidate[] }    │
├──────────────────────────────────────────────────────────────────────────┤
│  outline.ts:                                                             │
│    loadPrompt('outline-author') → interpolate({topic,length,             │
│      candidateSources:'[]' ← PLACEHOLDER, discipline}) → complete()      │
│      → OUTLINE.md (GFM table incl. "assigned_sources" COLUMN, currently  │
│      ignored by outline-parse.ts) → registerOutlineSections → STATE.json │
├──────────────────────────────────────────────────────────────────────────┤
│  plan.ts (per section n):                                                │
│    loadPrompt('section-planner') → interpolate({section,                 │
│      candidateSources:'(no sources loaded yet)' ← PLACEHOLDER, topic,    │
│      discipline, upstreamPlans}) → complete() → PLAN.md written          │
│      (frontmatter incl. assigned_sources — but LLM invents it since no   │
│      real candidateSources were given) → status:'writing'                │
├──────────────────────────────────────────────────────────────────────────┤
│  write.ts (writeOneSection, shared by single + wave path):               │
│    read PLAN.md → voiceHint resolve → assertDrafterInput() [CHOKEPOINT]  │
│      → loadPrompt('section-drafter') → interpolate({section, brief,      │
│      assignedSources:'[]' ← PLACEHOLDER, voiceHint}) → complete()        │
│      → DRAFT.md written → status:'written'                               │
├──────────────────────────────────────────────────────────────────────────┤
│  verify.ts: deterministic Pass1 (DOI/author/title) + Pass3 (quote) block │
│  compile.ts: outline-order concat + citekey render prep                  │
│  export: citation-token.ts extractCitekeys() + bibtex-write.ts render    │
├──────────────────────────────────────────────────────────────────────────┤
│  bin/lib/http.ts — SOLE undici call site (D-06). checkSsrf() does a      │
│  DNS-lookup-then-classify preflight; the ACTUAL request() call is a      │
│  SEPARATE later connect (TOCTOU / DNS-rebind gap — WR-03)                │
├──────────────────────────────────────────────────────────────────────────┤
│  bin/lib/pdf-text.ts — SOLE pdf-parse call site. parseWithRetry() has a  │
│  Promise.race timeout but pdf-parse itself keeps running on the main     │
│  event loop after "timeout" (no real cancellation — WR-05)               │
└──────────────────────────────────────────────────────────────────────────┘
```

**The gap this milestone closes (FEED):** every `candidateSources` / `assignedSources` interpolation var above is a **placeholder literal**, not real data from `LIBRARY.json`. The LLM currently has to invent citekeys, and the section-isolation contract ("the drafter sees ONLY its mapped sources") is unenforced because there is no real "its mapped sources" yet.

### Component Responsibilities (current + new)

| Component | Responsibility | Status |
|-----------|----------------|--------|
| `bin/lib/schemas/source-candidate.ts` (`SourceCandidateSchema`) | Canonical shape of one discovered source; discriminated union on `source` | EXISTING — reuse as-is |
| `LIBRARY.json` (`{$schemaVersion, entries: SourceCandidate[]}`) | Per-paper source pool, unique `citekey` per entry | EXISTING — reuse as-is |
| `bin/cli/outline.ts` | Calls `outline-author` prompt; writes OUTLINE.md w/ `assigned_sources` column | MODIFIED — must load real `candidateSources` from LIBRARY.json |
| `bin/lib/outline-parse.ts` (`parseOutline`) | Parses OUTLINE.md GFM table | MODIFIED (optional) — currently drops the `assigned_sources` cell (comment says "ignored by the wave graph"); see Open Questions for whether FEED needs it surfaced |
| `bin/cli/plan.ts` | Calls `section-planner` prompt; writes PLAN.md incl. `assigned_sources` frontmatter | MODIFIED — must load real `candidateSources` (whole filtered library) + `upstreamPlans`, and validate/reconcile the LLM's chosen `assigned_sources` against real citekeys |
| **`bin/lib/source-context.ts`** (proposed) | PURE builder: `LIBRARY.json` entries → prompt-shaped `candidateSources` JSON string (plan/outline) and → restricted `assignedSources` JSON string (write), given a citekey allow-list | **NEW** |
| `bin/cli/write.ts` (`writeOneSection`) | Reads PLAN.md `assigned_sources`, builds drafter input, calls `section-drafter` | MODIFIED — must resolve real `assignedSources` array from LIBRARY.json filtered to PLAN.md's citekeys, and pass it BOTH into `assertDrafterInput` (existing `sources`/`assignedSources` fields already schema-shaped) and into `interpolate()` |
| `bin/lib/drafter-input.ts` (`assertDrafterInput`) | Strict `.strict()` zod chokepoint — the section-isolation ENFORCEMENT POINT | EXISTING shape already supports `sources: string[]` + `assignedSources: {citekey,title,authors,year,doi}[]` — currently called with `sources: []` (hardcoded empty); MODIFIED call site only, schema unchanged |
| `scripts/e2e-smoke.mjs` | Offline smoke run of the whole router chain | MODIFIED — add FEED assertions (PLAN.md `assigned_sources` non-empty & ⊆ LIBRARY.json citekeys; DRAFT.md citekeys ⊆ PLAN.md `assigned_sources`); promote existing FINDINGs to FAILs where applicable |
| `.github/workflows/ci.yml` `check` job | 3-OS matrix: lint/typecheck/build/tier-contract/unit+coverage/manifest/porcelain | MODIFIED — insert e2e-smoke as a required step (or add a second required job) |
| **`.github/workflows/ci.yml` `live` job** (proposed) | Secrets-gated live-provider lane: real pass2/pass4 LLM calls + live Crossref/Retraction-Watch + SSRF preflight | **NEW** job, naturally no-ops on fork PRs (no secrets), non-blocking-by-default on the default job |
| **`tests/citation-integrity-differential.test.ts`** (proposed) | Every exporter-rendered citekey was seen by Pass-1 extraction — no citekey silently invented downstream of verify | **NEW** test file |
| `bin/lib/http.ts` (`checkSsrf`, `callOnce`) | SSRF DNS preflight + undici `request()` | MODIFIED — pin the resolved IP via undici's `connect` option so the actual TCP connection cannot re-resolve to a different (rebound) address |
| `bin/lib/pdf-text.ts` (`extractPdfText`, `parseWithRetry`) | pdf-parse wrapper w/ byte cap + `Promise.race` timeout | MODIFIED — move `pdfParse()` invocation into a `node:worker_threads` Worker so a genuine `worker.terminate()` is possible on timeout (current `Promise.race` only walks away, it doesn't stop the CPU-bound parse) |

## Recommended Project Structure (new files only; existing tree unchanged otherwise)

```
bin/
├── lib/
│   ├── source-context.ts        # NEW — FEED: LIBRARY.json → prompt-var builder (pure)
│   ├── pdf-worker.ts             # NEW — SEC: worker_threads entry point wrapping pdfParse()
│   └── http.ts                   # MODIFIED — SEC: connect-option IP pin in checkSsrf/callOnce
├── cli/
│   ├── outline.ts                 # MODIFIED — FEED: real candidateSources
│   ├── plan.ts                    # MODIFIED — FEED: real candidateSources + upstreamPlans
│   └── write.ts                   # MODIFIED — FEED: real assignedSources + isolation enforcement
scripts/
└── e2e-smoke.mjs                  # MODIFIED — HARDEN: promote FINDINGs to hard FAILs + FEED asserts
tests/
├── citation-integrity-differential.test.ts   # NEW — HARDEN: exporter citekeys ⊆ Pass-1-seen citekeys
├── source-context.test.ts                    # NEW — FEED: pure builder unit tests
└── ssrf-dns-rebind.test.ts                    # NEW — SEC: connect-option pin regression test
.github/workflows/
└── ci.yml                          # MODIFIED — HARDEN: strict e2e job + gated live job
.planning/SECURITY.md               # MODIFIED — mark WR-03/WR-05 resolved once shipped
```

### Structure Rationale

- **`bin/lib/source-context.ts` as a NEW pure module, not inline in `plan.ts`/`write.ts`/`outline.ts`:** the same "citekeys → prompt-shaped JSON" transform is needed at three call sites (outline, plan, write) with two different projections (full filtered library vs. citekey-restricted subset). A single pure function pair keeps the transform testable in isolation and prevents each CLI verb from re-inventing its own JSON-shaping (and drifting from `assertDrafterInput`'s `assignedSources` object shape: `{citekey, title, authors, year, doi}`).
- **Enforcement stays in `assertDrafterInput`, not in a new gate:** the schema already declares the exact restricted shape (`sources: string[]`, `assignedSources: {...}[]`). FEED's job is to make the CALLER pass real, already-filtered data — the `.strict()` zod parse is the existing chokepoint and doesn't need to change shape, only its inputs need to stop being placeholders.
- **`pdf-worker.ts` as a separate file, not inlined in `pdf-text.ts`:** `worker_threads` requires the worker body to live in its own module (loaded via `new Worker(new URL(...))` or a file path), so the SOLE-pdf-parse-import chokepoint constraint (ESLint `no-restricted-imports` exemption) moves from `pdf-text.ts` to `pdf-worker.ts`. `pdf-text.ts` remains the public API surface; only the ESLint per-file exemption target changes.
- **`tests/citation-integrity-differential.test.ts` as a NEW top-level test, not folded into an existing suite:** it's a cross-cutting property (Pass-1 extraction set ⊇ exporter render set) that spans `bin/lib/verify/pass1.ts` + `bin/lib/citation-token.ts` + the exporter path — it doesn't belong to any single unit's existing test file.

## Architectural Patterns

### Pattern 1: Pure Context Builder Feeding Interpolation Vars (FEED)

**What:** A pure function (no I/O) takes `SourceCandidate[]` (already loaded from disk by the CLI verb) plus an optional citekey allow-list, and returns the exact JSON shape each prompt's `{{candidateSources}}` / `{{assignedSources}}` placeholder expects. The CLI verb owns all I/O (reading LIBRARY.json, PLAN.md); the builder only transforms already-in-memory data.

**When to use:** Any of the three FEED call sites — `outline.ts` (full filtered library), `plan.ts` (full filtered library + `upstreamPlans` briefs), `write.ts` (library entries restricted to `PLAN.md.assigned_sources`).

**Trade-offs:** Keeping this pure (vs. letting each verb inline its own `JSON.stringify(entries.filter(...))`) costs one extra file/import but buys: (a) a single unit-testable seam for "does the JSON shape match what the prompt/schema expects", (b) a single place to bound context size (LIBRARY.json can be large; the prompt only wants a subset of fields — id/title/authors/year/doi/citekey — not `raw`), and (c) zero duplication between the plan-time "give me candidates" projection and the write-time "give me ONLY assigned" projection, which are otherwise easy to accidentally implement inconsistently (e.g., write.ts forgetting to strip `raw`).

**Example:**
```typescript
// bin/lib/source-context.ts (proposed shape)
import type { SourceCandidate } from './schemas/source-candidate.js';

/** Minimal per-source projection sent into ANY prompt context (never `raw`). */
export interface PromptSource {
  citekey: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
}

function toPromptSource(c: SourceCandidate): PromptSource {
  return {
    citekey: c.citekey,
    title: c.title,
    authors: c.authors,
    year: c.year ?? null,
    doi: c.doi ?? null,
  };
}

/** outline.ts / plan.ts: the full (optionally filtered) candidate pool. */
export function buildCandidateSources(entries: SourceCandidate[]): PromptSource[] {
  return entries.map(toPromptSource);
}

/**
 * write.ts: STRICT allow-list projection — the section-isolation enforcement
 * point for FEED. Only citekeys in `assignedCitekeys` (PLAN.md frontmatter)
 * are ever included; anything else in LIBRARY.json is invisible to this call.
 */
export function buildAssignedSources(
  entries: SourceCandidate[],
  assignedCitekeys: string[],
): PromptSource[] {
  const allow = new Set(assignedCitekeys);
  return entries.filter((c) => allow.has(c.citekey)).map(toPromptSource);
}
```
The CLI verb then does `JSON.stringify(buildCandidateSources(entries))` / `JSON.stringify(buildAssignedSources(entries, assigned))` for the `interpolate()` call, and passes the un-stringified array directly to `assertDrafterInput({ assignedSources: buildAssignedSources(...), ... })` in `write.ts` — one computation, two consumers (string for the prompt, array for the schema).

### Pattern 2: Section-Isolation Enforced at Three Layers (belt + suspenders)

**What:** FEED does NOT introduce a new enforcement mechanism — it feeds the enforcement points that already exist, correctly, and the existing pipeline supplies a third, independent, post-hoc layer:

1. **Prompt-injection layer** (new, FEED-owned): `write.ts` calls `buildAssignedSources(libraryEntries, planFrontmatter.assigned_sources)` — so the `{{assignedSources}}` string interpolated into the `section-drafter` prompt is ALREADY filtered before the model ever sees it. This is the primary enforcement point requested by the isolation contract.
2. **Schema layer** (existing, `assertDrafterInput`): the drafter-input object is validated as `.strict()` — extra top-level fields throw. FEED does not touch this schema; it only stops passing `sources: []` / omitting `assignedSources` and starts passing the real filtered arrays, which the schema already accepts.
3. **Post-hoc verification layer** (existing, unchanged by FEED): the verifier's Pass-1 extraction (`bin/lib/citation-token.ts::extractCitedKeysForVerification`, the broad detector) and the `runRevise`/`proposeSwap` membership guard (per `plan.ts`'s header comment: "runRevise's membership guard rejects `replacement_citekey ∉ assigned_sources`") independently re-check that any citekey appearing in DRAFT.md is one the section was allowed to use. This detects a model that ignores the restricted prompt and free-invents a citekey anyway.

**When to use:** This three-layer pattern (filter-before-prompt, schema-validate-the-call, post-hoc-verify-the-output) is exactly the shape FEED should preserve — do not collapse it to "just trust the prompt."

**Trade-offs:** Filtering before the prompt (layer 1) is necessary but not sufficient — an LLM can still hallucinate a citekey that looks plausible. The existing Pass-1 verifier (blocking) is what actually prevents a FABRICATED/invented citekey from reaching compile/export; FEED's job is only to reduce how OFTEN that happens by giving the model a small, correct candidate set instead of nothing.

### Pattern 3: `assigned_sources` Decided Once at Plan Time, Persisted, Re-read Downstream

**What:** The `assigned_sources` list is decided by the `section-planner` LLM call at `plan <n>` time (NOT re-derived at `write` time), written into `PLAN.md` frontmatter (`bin/lib/schemas/plan-frontmatter.ts::PlanFrontmatterSchema.assigned_sources: string[]`), and then treated as a fixed fact by every downstream reader: `write.ts::readAssignedSources`, `write-orchestrator.ts::loadPlanFrontmatter`, `revise.ts`'s membership guard, and the verifier. OUTLINE.md ALSO carries an `assigned_sources` column (per `outline-parse.ts`'s `EXPECTED_HEADER`) — today this column is written by `outline-author` but explicitly "ignored by the wave graph" (`outline-parse.ts:25`).

**When to use / FEED's decision point:** FEED must decide whether OUTLINE.md's `assigned_sources` column becomes an authoritative pre-seed that `plan.ts` reads and passes as a strong suggestion to `section-planner`, or whether it stays purely advisory/decorative and `plan.ts` independently re-derives assignment from the full `candidateSources` pool every time (matching `section-planner.md`'s existing contract: "You decide which SourceCandidate citekeys this section will draw on"). Recommendation: **OUTLINE.md's `assigned_sources` column stays advisory (a human-readable preview); `plan.ts` is the single authoritative writer of the real `PLAN.md.assigned_sources`**, reading `candidateSources` from LIBRARY.json directly rather than depending on the OUTLINE.md column. This avoids a two-writer inconsistency between OUTLINE.md and PLAN.md and matches the "PLAN.md is the source of truth for section state from v2 onward" comment already in `plan-frontmatter.ts`.

**Trade-offs:** Making OUTLINE.md's column authoritative would remove one LLM decision (cheaper, more deterministic) but requires `outline-author` to pre-assign well before any per-section brief exists — a harder problem, even though the prompt already receives `candidateSources` today. Document this as an explicit v0.3.0 decision rather than leaving it implicit; see Open Questions below.

## Data Flow

### FEED: LIBRARY.json → Prompt Context (new/changed flow)

```
research verb
    ↓ (writes)
.paper/LIBRARY.json  { $schemaVersion:1, entries: SourceCandidate[] }
    ↓ (read by, NEW)
outline.ts: readFileSync(LIBRARY.json) → validate shape →
  buildCandidateSources(entries) → JSON.stringify
    ↓ interpolate({ candidateSources: <real JSON>, ... })
outline-author prompt → complete() → OUTLINE.md
  (GFM table incl. assigned_sources column — ADVISORY, per Pattern 3)
    ↓
plan.ts <n>: readFileSync(LIBRARY.json) (NEW) + parseOutline(OUTLINE.md)
  for upstreamPlans (read each depends_on section's PLAN.md ## Brief, NEW)
    ↓ interpolate({ candidateSources: <real JSON>, upstreamPlans: <real>, ... })
section-planner prompt → complete() → PLAN.md
  frontmatter.assigned_sources: string[]  ← AUTHORITATIVE (Pattern 3)
    ↓ (existing) updatePlanFrontmatter → status:'writing'
    ↓
write.ts writeOneSection(n, slug):
  readFileSync(PLAN.md) → PlanFrontmatterSchema.parse → assigned_sources
  readFileSync(LIBRARY.json) (NEW) → buildAssignedSources(entries, assigned_sources)
    ↓ ISOLATION ENFORCEMENT POINT (Pattern 2, layer 1):
    only the filtered subset ever reaches interpolate()/assertDrafterInput
    ↓ interpolate({ assignedSources: <filtered JSON>, ... })
    ↓ assertDrafterInput({ sources: assigned_sources, assignedSources: <filtered objs>, ... })
section-drafter prompt → complete() → DRAFT.md ([@citekey] tokens)
    ↓
verify.ts Pass 1: extractCitedKeysForVerification(DRAFT.md) — post-hoc check (Pattern 2, layer 3)
    ↓
compile/export: citation-token.ts + bibtex-write.ts render citekeys → final doc
```

### HARDEN: e2e Assertion Points Mapped to Router Contract

```
router.ts::resolveNextAction is the SPEC for what "advanced correctly" means.
scripts/e2e-smoke.mjs asserts the SAME transitions it encodes, PLUS (NEW) the
FEED data actually flowed:

  new        → INTAKE.md exists                         [EXISTING assert]
  research   → LIBRARY.json + CITATIONS.bib exist        [EXISTING assert]
  outline    → OUTLINE.md exists, parseOutline().sections.length > 0
               (NEW: assigned_sources column present per row, once FEED lands)
  plan <n>   → PLAN.md exists; PlanFrontmatterSchema.parse succeeds;
               frontmatter.status === 'writing' (router.ts:210-211 contract)
               (NEW HARDEN assert): assigned_sources.length ∈ [3,15] AND
               every citekey ∈ LIBRARY.json entries[].citekey
  write <n>  → DRAFT.md exists; PLAN.md status === 'written'
               (router.ts:212-213 contract: 'written' → verify next)
               (NEW HARDEN assert): extractCitekeys(DRAFT.md) ⊆
               PLAN.md.assigned_sources (the isolation contract, checked
               EXTERNALLY/black-box, not just at the prompt-input layer)
  verify <n> → PLAN.md status ∈ {verified, failed, unverifiable}
               (router.ts:206,214-215 contract)
  compile    → DRAFT.md (paper-level) exists; router.ts:226 contract
  done       → FINAL.md exists; router.ts:227 contract
  (terminal) → status/done; router.ts:228
```

**Router-advance contract, spelled out for the e2e harness:** at every stage transition, the harness must assert BOTH (a) the artifact file exists/is well-formed, AND (b) re-running `pensmith status` (which internally calls `resolveNextAction`) reports the NEXT verb in the chain, not the SAME verb again. This is exactly what the existing "BUG-1" check in `e2e-smoke.mjs` (lines 144-168) already does for research→outline; HARDEN generalizes this pattern to plan→write→verify→compile→done. An assertion that only checks file existence without checking the router's next-action would miss the exact class of bug `e2e-smoke.mjs` was written to catch (a written artifact that doesn't flip the frontmatter `status` the router keys on).

### SEC: DNS-Rebind Pin Data Flow (http.ts)

```
fetch(url, opts) [existing]
    ↓
callOnce():
    if (untrusted) await checkSsrf(url)   ← EXISTING preflight (resolve+classify)
    ↓ (TOCTOU GAP today: the resolved IP from checkSsrf is DISCARDED;
       request(url, reqInit) below does its OWN independent DNS resolution,
       which — for a hostile/rebinding DNS server — can return a DIFFERENT,
       private-range IP on the SECOND lookup, after the preflight passed)
    ↓
request(url, reqInit)  [undici, default dispatcher's own resolver]
```

**NEW flow (SEC):**
```
callOnce():
    if (untrusted) {
      const addrs = await checkSsrfAndReturnAddrs(url)   // MODIFIED: return the
                                                           // validated addresses,
                                                           // not just void
      reqInit.dispatcher = new Agent({
        connect: (opts, cb) => {
          // Pin to the ALREADY-VALIDATED address; undici's own resolver is
          // bypassed for THIS request, closing the rebind window between
          // preflight and connect. servername stays the original hostname
          // for correct TLS SNI/cert validation on https:.
          const connectFn = opts.protocol === 'https:' ? tls.connect : net.connect;
          const socket = connectFn({ ...opts, host: addrs[0].address, servername: opts.hostname });
          socket.once('connect', () => cb(null, socket));
          socket.once('error', (err) => cb(err, null));
        },
      });
    }
    request(url, reqInit)
```

The connect-option approach pins the exact socket that undici opens to the address `checkSsrf` already validated, eliminating the window where a second, independent DNS lookup (inside `request()`) could resolve to a different, attacker-controlled address (classic TOCTOU DNS-rebind). `servername` must still be set to the original hostname for correct TLS SNI/cert validation on `https:`. The existing (currently-unused) `Agent` import at `http.ts:51/66` is the natural seam for this — it is already imported and explicitly held live ("we may use it in Phase 2 when wiring connection pooling") for exactly this kind of per-request dispatcher construction.

### SEC: Worker-Thread PDF Abort Data Flow (pdf-text.ts)

```
extractPdfText(buf) [existing]
    ↓
Promise.race([ parseWithRetry(input), timeoutPromise ])
    ↓ (GAP today: on timeout, the race's LOSER promise — parseWithRetry,
       running pdfParse() on the main thread — is NOT cancelled. It keeps
       consuming CPU and can still resolve/reject later, potentially after
       the caller has moved on, and does not free the event loop during a
       pathological parse.)
```

**NEW flow (SEC):**
```
extractPdfText(buf) [modified]
    ↓
new Worker(pdf-worker.js, { workerData: { bytes: input } })
    ↓
Promise.race([
  new Promise((res,rej) => { worker.once('message', res); worker.once('error', rej); }),
  timeoutPromise
])
    ↓ on timeout:
    await worker.terminate()   // ACTUALLY stops the CPU-bound parse
    ↓ throw the existing "parse timed out after Nms" error (message unchanged
      so existing callers/tests keep working)
```

`worker.terminate()` is the only way in Node to forcibly stop synchronous/CPU-bound work; `Promise.race` alone (current state) only stops the CALLER from waiting, it never stops the callee from running. This closes WR-05 (a pathological or adversarial PDF can otherwise pin a CPU core indefinitely even after the "timeout" fires). Because the existing retry rationale in `pdf-text.ts` is explicitly about transient PDF.js scheduling artifacts ("the SAME bytes parse cleanly on the very next tick") rather than genuinely hostile input, recommend wrapping the WHOLE `parseWithRetry` loop in ONE worker (fewer spawns, retry logic unchanged inside the worker) and terminating on the OUTER timeout only — a hung/adversarial PDF should abort ALL attempts, not retry.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|---------------------------|
| Small paper (5-10 sources, 3-7 sections) | Current design is fine as-is: `buildCandidateSources` sends the WHOLE filtered library into `outline-author`/`section-planner` prompts (this is already the documented contract — "full filtered SourceCandidate library" per `section-planner.md`) |
| Larger paper (50+ sources) | The `{{candidateSources}}` JSON could approach context-window-relevant sizes. Not a v0.3.0 blocker (matches existing prompt contract), but worth a follow-up: the `PromptSource` projection already excludes `abstract`/`raw` by construction; consider a length guard with a WARN, mirroring the existing pattern at `drafter-input.ts` |
| Many sections written in parallel (wave mode) | `write-orchestrator.ts::runAllSections` already reads each section's `PlanFrontmatter` once via `loadPlanFrontmatter` before scheduling; FEED's LIBRARY.json read should happen ONCE per `runAllSections` invocation (not once per section) and be threaded down to each `writeOneSection` call, to avoid N redundant `readFileSync(LIBRARY.json)` calls across a large wave |

## Anti-Patterns

### Anti-Pattern 1: Passing the Full LIBRARY.json Into the Drafter "For Convenience"

**What people do:** Skip building a restricted `assignedSources` projection and instead pass the entire `LIBRARY.json` entries array into the `section-drafter` prompt, relying on the brief/instructions ("use only your assigned sources") to keep the model in-bounds.

**Why it's wrong:** This directly violates the section-isolation contract stated in CLAUDE.md ("the drafter must see ONLY its mapped sources") and in `section-drafter.md` itself ("You do NOT see the rest of the candidate library. This restriction is enforced at the workflow-body input-contract layer"). It also multiplies hallucination surface — a bigger candidate pool in-context makes it MORE likely the model cites something outside its assignment, not less, because more plausible-looking citekeys are visible.

**Do this instead:** `write.ts` must call `buildAssignedSources(entries, planFrontmatter.assigned_sources)` — the citekey-filtered projection — and that filtered result is the ONLY thing that reaches `interpolate()` and `assertDrafterInput()`. The unfiltered library is legitimately visible ONLY at `outline.ts`/`plan.ts` time (assignment-decision time), never at `write.ts` time (assignment-consumption time).

### Anti-Pattern 2: Widening `assertDrafterInput`'s Schema Instead of Fixing the Call Site

**What people do:** When FEED needs richer per-source data in the drafter prompt, add new top-level fields to `DrafterInputSchema` (`bin/lib/drafter-input.ts`) rather than populating the EXISTING `assignedSources` field the schema already declares.

**Why it's wrong:** `DrafterInputSchema` already has `assignedSources: z.array(z.object({citekey,title,authors,year,doi})).optional()` — exactly the shape FEED needs. Widening the schema instead of using this field is redundant, and worse, risks accidentally loosening the `.strict()` chokepoint that exists specifically to prevent "opportunistic information leakage into the model's context" (T-3-10). Any new top-level field added here needs the SAME security scrutiny as the original Wave-0 contract, and FEED doesn't need any — the shape already fits.

**Do this instead:** Populate the existing `assignedSources` field with real data. `write.ts` computes the filtered array once (`buildAssignedSources(entries, assigned_sources)`), then both `JSON.stringify()`s it for `interpolate()` and passes the SAME array directly to `assertDrafterInput`. Do not add new schema surface for FEED.

### Anti-Pattern 3: Making the Strict e2e Job "Advisory" or Allow-Failure

**What people do:** Add the promoted `scripts/e2e-smoke.mjs` as a CI step with `continue-on-error: true`, or as a separate non-required workflow, to avoid blocking merges while the FEED/isolation asserts are new and might be flaky at first.

**Why it's wrong:** The whole point of "promote to a strict required CI job" is that today `e2e-smoke.mjs` reports `[FINDING]` for known gaps WITHOUT failing the run (`process.exit(fails > 0 ? 1 : 0)` — findings never count toward `fails`, lines 235-244). If the strict job is allow-failure, it provides zero additional guarantee over the current non-required manual run, and regressions in the FEED wiring (e.g., a future refactor that reintroduces a placeholder) would silently ship.

**Do this instead:** Convert the specific FEED/router-advance FINDING checks that should now ALWAYS pass into hard `fail()` calls (not `finding()`), and make the CI step required — no `continue-on-error`, part of the `check` job's step sequence (or a second required job in `ci.yml`). Any check that is inherently non-deterministic (e.g., a live network call) belongs in the SEPARATE secrets-gated live lane, not in the strict offline job.

### Anti-Pattern 4: Weakening the Offline Default to Make Room for the Live Lane

**What people do:** Change `PENSMITH_NO_LLM` / `PENSMITH_NETWORK_TESTS` default behavior, or make the main `check` job conditionally skip cassette-based tests "when secrets are available," so the same job can serve both offline and live modes.

**Why it's wrong:** The existing design principle (per `.planning/PROJECT.md`'s Constraints and the `test:tier-contract`/`test:cassettes` split in `package.json`) is that the default, always-running suite is 100% offline/deterministic (cassettes, `PENSMITH_NO_LLM=1`), and CI must be reproducible without secrets for external contributors and forks (where `secrets.*` are unavailable on PRs from forks). Coupling the two modes in one job risks the live lane silently no-op'ing (masquerading as "passing") on fork PRs, or the offline lane picking up live-mode env vars by accident.

**Do this instead:** The live lane is a SEPARATE job (see HARDEN section below) gated on a condition like `secrets.ANTHROPIC_API_KEY != ''`, which naturally no-ops (not fails) on forks/PRs without secrets — the standard GitHub Actions idiom for optional-secret jobs. The default `check` job's cassette/offline behavior is untouched.

## Integration Points

### FEED — Concrete File/Function Integration Points

| Call site | Current state | Required change |
|-----------|---------------|------------------|
| `bin/cli/outline.ts:205-211` | `interpolate(prompt, { topic, length:'2000', candidateSources:'[]', discipline:'general' })` | Read `.paper/LIBRARY.json` (path via `paperDir()`), parse `entries: SourceCandidate[]`, call `JSON.stringify(buildCandidateSources(entries))` (NEW `bin/lib/source-context.ts`), pass real JSON string. Also derive `topic`/`discipline`/`length` from `parseIntakeMd` (already used by `research.ts`) instead of raw `INTAKE.md` text dump — consistency improvement, optional but recommended |
| `bin/cli/plan.ts:127-133` | `interpolate(planPrompt, { section, candidateSources:'(no sources loaded yet...)', topic:'(topic from INTAKE.md...)', discipline:'other', upstreamPlans:'[]' })` | Read LIBRARY.json → `buildCandidateSources`; read `parseIntakeMd(INTAKE.md)` for `topic`/`discipline` (mirrors `research.ts`); read each `depends_on` section's PLAN.md `## Brief` body (via existing `sectionPlan()` path helper + a small new brief-extraction parser) and JSON-encode into `upstreamPlans` |
| `bin/cli/write.ts:216-222` (`writeOneSection`) | `interpolate(drafterPrompt, { section, brief: planMd \|\| ..., assignedSources: '[]', voiceHint })` | After reading `planMd`, parse its frontmatter via `PlanFrontmatterSchema` (reuse `readAssignedSources`'s pattern, already present at lines 158-166) to get `assigned_sources: string[]`; read LIBRARY.json; call `buildAssignedSources(entries, assigned_sources)` for BOTH the `interpolate()` var AND the array passed to `assertDrafterInput` at lines 202-208 (replace `sources: []` with `sources: assigned_sources` and add `assignedSources: <the built array>`) |
| `bin/lib/drafter-input.ts` | Schema already declares `assignedSources` optional field (lines 60-68) | **NO SCHEMA CHANGE** — only the `write.ts` call site changes what it passes |
| `bin/lib/outline-parse.ts:25` | Comment: "`assigned_sources -> ignored by the wave graph (not consumed here)`" | Decision needed (see Open Questions): recommend leaving `outline-parse.ts` UNCHANGED for v0.3.0 — `plan.ts` reads LIBRARY.json directly rather than depending on the OUTLINE.md column, avoiding a second, potentially-stale source of the same information |
| `bin/lib/schemas/plan-frontmatter.ts` | `assigned_sources: z.array(z.string()).default([])` | **NO CHANGE** — already the persistence target |
| Section-isolation enforcement | Currently NOT enforced (placeholders mean nothing to isolate) | Enforced by construction once `write.ts` only ever constructs `assignedSources`/`sources` from the citekey-filtered `buildAssignedSources` result — i.e., enforcement is a DATA-FLOW property (the drafter's prompt-building code path structurally cannot reach unfiltered LIBRARY.json entries), backstopped by the existing `assertDrafterInput` `.strict()` schema and the existing Pass-1 post-hoc verifier |

### HARDEN — Concrete CI/Assertion Integration Points

| Integration point | Current state | Required change |
|--------------------|----------------|------------------|
| `.github/workflows/ci.yml` `check` job | Single job, 3-OS matrix, steps: prebuild → lint → tsc → build → tier-contract → test:coverage → manifest validate → porcelain check | ADD a new step after `test:coverage` (or a new required job `e2e`): `node scripts/e2e-smoke.mjs` with a NON-ZERO exit treated as job failure (already the script's contract). `e2e-smoke.mjs` invokes the CLI via the tsx loader against `bin/pensmith.ts` directly (per the script header), so it does not strictly need `npm run build` first — but running it after the unit suite keeps fast-fail ergonomics (fail fast on cheaper checks before the slower full-pipeline smoke run) |
| `scripts/e2e-smoke.mjs` FINDING vs FAIL | `router-research-sentinel` (lines 154-167) and the `write`/`compile` no-sections checks (lines 176-191) currently use `finding()` for known gaps that "do not fail the run" | Promote what FEED should have fixed: (1) `router-research-sentinel` is a router-gate issue orthogonal to FEED/HARDEN/SEC per the milestone scope — recommend leaving it as `finding()` unless explicitly rescoped. (2) ADD new hard `pass()`/`fail()` checks: after `plan <n>`, assert `PLAN.md` frontmatter `assigned_sources.length >= 3` (mirrors `section-planner.md`'s "3 to 15 citekeys" hard constraint) — note the OFFLINE placeholder response (`PENSMITH_NO_LLM=1`) needs its own offline mock updated to emit a plausible `assigned_sources` list sourced from LIBRARY.json, since the e2e harness runs fully offline; (3) after `write <n>` (or wave `write`), assert every citekey extracted from DRAFT.md is ∈ that section's `PLAN.md.assigned_sources` |
| STATE.json / PLAN.md transition asserts (the router-advance contract) | `e2e-smoke.mjs` currently only checks this pattern for research→outline (the BUG-1 check, lines 144-168) | Generalize: for each of plan→write→verify→compile→done, assert BOTH artifact existence AND that `pensmith status`'s reported next-verb (or a direct call to `resolveNextAction`, if invoked as a library rather than shelled out) matches the CORRECT next verb per `router.ts`'s status→verb switch (lines 205-221) — e.g., after `write <n>` sets `status:'written'`, assert the router now proposes `verify` (not `write` again, not `plan`) |
| Secrets-gated live lane | Does not exist | NEW job in `ci.yml`, e.g. `live-smoke`, conditioned on the repo owner AND `secrets.ANTHROPIC_API_KEY` being non-empty (GitHub Actions never exposes repo secrets to fork-PR workflow runs, so this condition naturally no-ops rather than fails on forks); runs a SUBSET of the pipeline with `PENSMITH_NO_LLM` unset and `PENSMITH_NETWORK_TESTS` enabled, hitting the real configured LLM provider for pass2/pass4, real Crossref + Retraction-Watch re-query in `verify`, and exercising the real `checkSsrf` DNS preflight against a real (non-cassette) hostname. Should run on a schedule or on `main`-branch pushes ONLY (not every PR) to control API cost, mirroring the `cost_cap_usd` discipline already in the codebase. An alternative to a fully-live lane is a recorded-cassette approach (record once, replay in CI) — but the milestone context explicitly asks for "hitting real pass2/pass4 + live Crossref/Retraction-Watch re-query + the SSRF preflight," which implies a genuinely live (secrets-present) run, not a cassette replay, for this specific lane |
| Citation-integrity differential test | Does not exist | NEW `tests/citation-integrity-differential.test.ts`: construct a DRAFT.md fixture, run it through the SAME extraction Pass-1 uses internally (`citation-token.ts::extractCitedKeysForVerification`, the broad "fail-closed" detector — Pass-1 must SEE every citation-shaped reference) to get `pass1Seen: Set<string>`; separately run the exporter's citekey substitution path (`citation-token.ts::extractCitekeys`, the narrow bare-token extractor used by `replaceCitekeys`/the smoother/bibtex-write render) to get `exporterRendered: Set<string>`; assert `exporterRendered ⊆ pass1Seen`. This catches a class of bug where the exporter's NARROWER regex (`CITATION_TOKEN_RE`, lowercase-first-only) silently renders a citekey that never actually went through Pass-1's broader verification sweep (e.g., a caching bug, an early-return path, a case-mismatch edge case) |

### SEC — Concrete File/Function Integration Points

| Integration point | Current state | Required change |
|--------------------|----------------|------------------|
| `bin/lib/http.ts::checkSsrf` (lines 144-177) | Resolves hostname via `dnsLookup`, classifies each address, throws on private/reserved; the resolved address is NEVER returned to the caller | Change the return contract to also surface the validated `{address, family}` list on success (e.g., return `Array<{address,family}>` instead of `void`, or add a sibling function `resolveAndValidate()` that `checkSsrf` becomes a thin wrapper around, keeping `checkSsrf`'s existing void-returning signature for any callers that only need the guard behavior) |
| `bin/lib/http.ts::callOnce` (lines 691-720) | `if (untrusted) { await checkSsrf(url); } ... await request(url, reqInit)` — `request()` does its OWN DNS resolution via undici's default `Agent`, independent of the preflight | Capture the validated address from the (modified) SSRF check, then construct a PER-REQUEST `Agent`/`Client` with a `connect` option that pins to that address (host override) while preserving `servername` for TLS SNI, and pass it as `reqInit.dispatcher` for THIS request only (not the global dispatcher — avoid cross-request pollution) |
| undici's `connect` option | N/A (not currently used); the `Agent`/`getGlobalDispatcher`/`setGlobalDispatcher` imports at lines 51/62-66 are currently held live but unused ("we may use it in Phase 2 when wiring connection pooling") | These unused imports are the natural existing seam for this work — the `Agent` constructor accepts a `connect` option (a function or a `net.connect`/`tls.connect`-shaped options object) that undici uses instead of its own default connector. Confirm the exact callback signature against the pinned undici version in `package.json` at implementation time (recommend a doc lookup pass then, since the exact shape has evolved across undici major versions) |
| Scheme/trust gating | `untrusted` flag already distinguishes `source==='generic'` (untrusted, e.g. user-supplied URLs) from hardcoded trusted API hosts | UNCHANGED — the connect-pin only needs to apply when `untrusted` is true, matching where `checkSsrf` already runs today. Trusted, hardcoded hosts (crossref/openalex/etc.) don't need pinning since their DNS isn't attacker-influenced in the threat model already documented in `.planning/SECURITY.md` |
| `bin/lib/pdf-text.ts::extractPdfText` (lines 140-209) | `Promise.race([parseWithRetry(input), timeoutPromise])`; on timeout, `parseWithRetry`'s in-flight `pdfParse()` call keeps running (no cancellation) | Move the `pdfParse()` invocation (currently inside `parseWithRetry`, lines 101-119) into a NEW `bin/lib/pdf-worker.ts` worker-thread entry point. `extractPdfText` spawns ONE `Worker` per call, wrapping the WHOLE retry loop (not per-attempt — the existing retry rationale is about transient scheduling artifacts, and a genuinely-hung parse should abort ALL attempts on the outer timeout, not retry) |
| ESLint chokepoint (`eslint.config.js`, `pdf-parse` import ban) | Per-file override currently targets `bin/lib/pdf-text.ts` only | The `pdfParse()` CALL moves into `bin/lib/pdf-worker.ts` — the ESLint per-file exemption must move (or be added) to `pdf-worker.ts`; `pdf-text.ts` should no longer import `pdf-parse` directly once the worker owns the call. The red-team fixture at `tests/fixtures/lint-chokepoint-fixture.ts` should be updated/extended to also probe the new worker file |
| `bin/lib/pymupdf-shellout.ts` fallback | Invoked from `extractPdfText` when pdf-parse returns near-empty text (image-only detection, lines 178-198) | UNCHANGED — this fallback triggers AFTER a successful (non-timed-out) pdf-parse call returns near-empty text; it is orthogonal to the timeout/worker change and stays a lazy dynamic `import()` on the main thread as today |
| `MAX_PDF_BYTES` / `PDF_TIMEOUT_MS` constants (lines 63, 70) | Exported for test scaffolding | UNCHANGED values; `PDF_TIMEOUT_MS` becomes the worker-termination deadline instead of (only) the `Promise.race` deadline. `workerData` transfer of the input `Buffer` should use a `Transferable`/`SharedArrayBuffer` or structured-clone copy depending on the byte-cap size vs. copy-cost trade-off — a straightforward structured-clone copy is fine given the existing 50MB cap |
| `.planning/SECURITY.md` | Documents WR-03 (DNS-rebind) and WR-05 (worker-abort) as residuals | MODIFIED to mark both resolved once shipped, per the existing pattern of that document tracking hardening status |

## Suggested Build Order (dependency-respecting)

The three workstreams are largely independent of each other, but HARDEN's new e2e assertions are written IN TERMS OF FEED's output (assigned_sources population, citekey containment), so ordering matters for HARDEN specifically. SEC has no dependency on FEED or HARDEN and can proceed in parallel with either.

1. **FEED first** (`bin/lib/source-context.ts` NEW + `outline.ts`/`plan.ts`/`write.ts` MODIFIED). This is the prerequisite for HARDEN's new assertions to have anything meaningful to check — a HARDEN assertion like "assigned_sources ⊆ LIBRARY.json citekeys" is trivially true-but-meaningless against the current placeholder data (an empty/invented list vacuously satisfies weaker checks, but the "3-15 citekeys drawn from the real library" assertion specifically requires FEED's real data to exist first). Order-of-work within FEED: `source-context.ts` (pure, testable standalone) → `outline.ts` → `plan.ts` → `write.ts`, mirroring the pipeline's own data dependency (outline's candidates inform planning; planning's `assigned_sources` gates writing).

2. **SEC in parallel with FEED** (`http.ts` connect-pin + `pdf-worker.ts`/`pdf-text.ts` worker-abort). Neither security fix touches the plan/write/outline data flow or the prompt-interpolation surface — they are orthogonal subsystems (network transport chokepoint; PDF-parsing chokepoint). Can be built, reviewed, and merged independently of FEED's progress, by a different contributor/session if desired. The two SEC items are also independent OF EACH OTHER (different files, different failure modes) and can land as two separate PRs in either order.

3. **HARDEN last, in two sub-phases:**
   a. **CI job promotion + router-advance assertion generalization** (the plan→write→verify→compile→done STATE/PLAN transition checks) does NOT strictly require FEED to be done first — these are testing the EXISTING router contract (`router.ts`) which is unchanged by FEED. This sub-phase COULD start before FEED lands.
   b. **FEED-specific e2e assertions** (assigned_sources population + containment, citekey isolation containment) STRICTLY require FEED to be merged first, since they assert on FEED's actual output shape.
   c. **The secrets-gated live lane** and **the citation-integrity differential test** are independent of FEED (they test the verifier/exporter path, which is unchanged by FEED) and can be built any time — but logically make more sense to land after FEED so that a live-pipeline smoke run has something non-placeholder to exercise end-to-end (a live run against placeholder `candidateSources` would exercise less of the real pipeline value).

**Recommended sequencing for a single build queue:** FEED (source-context.ts → outline.ts → plan.ts → write.ts) → HARDEN sub-phase (a) CI/router-generalization done in parallel with FEED if bandwidth allows → HARDEN sub-phase (b) FEED-specific e2e asserts (blocked on FEED merge) → HARDEN sub-phase (c) live lane + differential test → SEC (either fix, any time, fully parallel track).

## Open Questions

- **OUTLINE.md `assigned_sources` column: advisory or authoritative?** (Pattern 3). Recommend advisory-only for v0.3.0 (plan.ts re-derives from LIBRARY.json independently), but this should be an explicit roadmap decision, not an implicit one, since it affects whether `outline-parse.ts` needs to change at all.
- **Live lane shape: genuinely live (secrets required) vs. recorded-cassette replay?** The milestone context says "or recorded-live cassette" as an alternative — recommend genuinely live (simpler to reason about, matches "hitting real pass2/pass4 + live Crossref/Retraction-Watch re-query" literally), but this trades off CI cost/flakiness against a cassette's determinism. Needs a roadmap-level call on acceptable CI cost.
- **undici `connect` option exact signature for the pinned version.** Recommend a Context7/official-docs lookup against the exact undici version in `package.json` at implementation time — the `connect` callback shape has had minor evolution across undici majors, and training-data knowledge here is MEDIUM confidence only.
- **Worker-per-call vs. worker-pool for PDF parsing.** A single ad-hoc `Worker` per `extractPdfText` call is simplest and matches the current one-shot-per-PDF usage pattern; a persistent worker pool would reduce spawn overhead for research runs ingesting many BYO PDFs but adds lifecycle-management complexity. Recommend starting with per-call workers (simpler, correctness-first) and revisiting pooling only if profiling shows spawn overhead is a real bottleneck.

## Sources

- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\.planning\PROJECT.md` — v0.3.0 scope, carried-forward tech debt, non-negotiables
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\cli\plan.ts` — current placeholder `candidateSources`/`topic`/`upstreamPlans` interpolation (lines 118-133)
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\cli\write.ts` — `writeOneSection`, `assertDrafterInput` call site (lines 175-253), `readAssignedSources` helper (lines 158-166)
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\cli\outline.ts` — placeholder `candidateSources:'[]'` (lines 205-211), `registerOutlineSections`
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\cli\research.ts` — real LIBRARY.json shape (`{$schemaVersion:1, entries: SourceCandidate[]}`, lines 298-305) and `parseIntakeMd` usage pattern
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\prompt-loader.ts` — `loadPrompt`/`interpolate`, hash-pinned prompt slugs
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\templates\prompts\section-planner.md` — `assigned_sources` selection contract (3-15 citekeys), PLAN.md output format
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\templates\prompts\section-drafter.md` — restricted-view contract ("You do NOT see the rest of the candidate library")
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\templates\prompts\outline-author.md` — `candidateSources` input, `assigned_sources` semantics at outline stage
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\schemas\plan-frontmatter.ts` — `assigned_sources: string[]` persistence target, PLAN.md-as-source-of-truth
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\schemas\source-candidate.ts` — `SourceCandidateSchema`, D-14 LOCKED shape
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\drafter-input.ts` — `.strict()` chokepoint, existing `assignedSources` optional field shape
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\outline-parse.ts` — OUTLINE.md table format, `assigned_sources` column currently ignored (line 25 comment)
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\write-orchestrator.ts` — wave scheduler read of `PlanFrontmatter.assigned_sources` (line 195), `onSectionWritten` observer
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\router.ts` — `resolveNextAction`, the STATE/PLAN status→verb contract (lines 205-221) used to spec HARDEN's assertions
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\scripts\e2e-smoke.mjs` — existing offline harness, PASS/FAIL/FINDING framework, BUG-1 router-advance check pattern
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\.github\workflows\ci.yml` — current single-job 3-OS matrix, step ordering
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\http.ts` — `checkSsrf` (lines 144-177), `callOnce` (lines 691-720), unused `Agent`/`getGlobalDispatcher`/`setGlobalDispatcher` imports (lines 62-66) as the pin-point seam
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\pdf-text.ts` — `extractPdfText`/`parseWithRetry` (lines 101-209), `Promise.race` timeout without cancellation
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\citation-token.ts` — `extractCitekeys` (narrow, exporter-side) vs `extractCitedKeysForVerification` (broad, verifier-side) — the two regexes the citation-integrity differential test must reconcile
- `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\package.json` — `test:tier-contract`/`test:cassettes`/`test:coverage`/`check` script split, offline-by-default discipline
- undici documentation on the `connect` option / custom dispatchers for DNS-pinning (training-data knowledge, MEDIUM confidence — not independently verified against the currently-pinned undici version in this research pass; recommend a documentation-lookup pass at implementation time to confirm the exact `connect` callback signature)
- Node.js `worker_threads` API (training-data knowledge, HIGH confidence — stable, long-standing Node core API; `Worker.terminate()` semantics unchanged across recent Node LTS versions)

---
*Architecture research for: pensmith v0.3.0 (FEED / HARDEN / SEC integration)*
*Researched: 2026-07-06*
