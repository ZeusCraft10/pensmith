# Phase 5: Verifier Completeness (Pass 2 + Pass 4) - Research

**Researched:** 2026-06-17
**Domain:** LLM-judged advisory verifier passes, deterministic claim extraction, tier-contract extension
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VRFY-03 | Pass 2 — claim support (LLM-judged), verdict ∈ {SUPPORTED, PARTIAL, UNSUPPORTED, UNCLEAR}, prompt calibrated UNCLEAR-bias (advisory) | Covered by §Standard Stack, §Pass 2 Architecture, §Prompt Design, §Code Examples |
| VRFY-06 | Pass 4 — per-paragraph orphan-claim audit. Claim extraction DETERMINISTIC (pure-Node). LLM only for edge-case labeling. Written to VERIFICATION.md. Never auto-blocks. Feeds §7.9 export-confirmation gate (DONE-09). | Covered by §Pass 4 Architecture, §Deterministic Claim Extraction, §Code Examples |
</phase_requirements>

## Summary

Phase 5 adds the two advisory verifier passes. Both are structurally separated from the blocking path (Pass 1 + Pass 3) and must never touch `hasFail` / `status` in the existing `bin/cli/verify.ts` orchestrator. The key separation technique already used by `freshness.ts` — a parallel advisory channel that runs *after* the blocking verdict is computed — is the exact pattern to follow.

**Pass 2** (claim support) is a pure LLM call per in-text citation. Each citation sentence is extracted deterministically (regex over `[@citekey]` occurrences in a paragraph), the abstract is pulled from CITATIONS.bib metadata (already available), and a single structured-output LLM call returns `{verdict, rationale, evidence}`. The prompt must be calibrated UNCLEAR-bias: the model defaults UNCLEAR rather than manufacturing a confident SUPPORTED when evidence is thin. Verdicts are appended to VERIFICATION.md under a new `## Pass-2` section and written to a structured `pass2` field in the return value for DONE-09 consumption. They never modify `hasFail`.

**Pass 4** (per-paragraph orphan-claim audit) is a two-stage pipeline: (1) a deterministic pure-Node paragraph-to-claim extractor identifies claim sentences (no LLM); (2) each extracted claim is cross-referenced with the paragraph's in-text `[@citekey]` tokens to decide orphan/cited — also deterministic; (3) an optional LLM call for *edge-case labeling only* (e.g., "is this a definition or a claim?") on sentences that the grammar heuristic cannot classify. Stage 3 is advisory and gated; if `PENSMITH_NO_LLM=1` it is skipped and ambiguous sentences are labeled `UNCLEAR`. Orphan claim results go to VERIFICATION.md under `## Pass-4` and the return value. They never modify `hasFail`.

**Primary recommendation:** Model Pass 2/4 exactly on the `freshness.ts` advisory side-channel pattern — run after blocking passes, independent of `hasFail`, write to dedicated VERIFICATION.md sections, return structured data the CLI/MCP can surface to DONE-09.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pass 2 LLM call (claim support) | Backend/CLI lib (`bin/lib/verify/pass2.ts`) | MCP thin shim via same lib | LLM call must go through runtime.ts SDK chokepoint; all business logic in `bin/lib/*` per D-09 |
| Pass 4 deterministic extraction | Backend/CLI lib (`bin/lib/verify/pass4.ts`) | Both tiers share same pure-Node code | Pure-Node = no tier difference; identical on both sides of the contract |
| Pass 4 edge-case LLM label | Backend/CLI lib (`bin/lib/verify/pass4.ts`) | Same lib on both tiers | Advisory-only; same chokepoint pattern as Pass 2 |
| VERIFICATION.md rendering | `bin/cli/verify.ts` orchestrator | MCP `pensmith_verify` tool | Orchestrator is the sole writer of VERIFICATION.md; Pass 2/4 append new sections |
| Budget gate | `bin/lib/budget.ts::assertBudget` | Same module on both tiers | Pre-call, before every LLM token is spent; same pattern as smoother/revise |
| Tier-contract parity assertion | `tests/tier-contract.test.ts` | SC#3 hard gate | D-24 obligation: every new workflow-body change registers a tier-contract case |

## Standard Stack

### Core (already in project — no new installs required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | `^0.93` (installed: 0.104.2) | LLM API calls for Pass 2 + Pass 4 edge-case labeling | Already declared in package.json; runtime.ts chokepoint already loads it [VERIFIED: package.json] |
| `openai` | `^4` (installed: 6.43.0) | OpenAI-compatible endpoint (Tier 2 fallback) | Already declared; same SDK used by revise/smoother stubs [VERIFIED: package.json] |
| `bin/lib/budget.ts` | n/a | Pre-call assertBudget gate + cost ledger | Already shipped; ARCH-10 per-step cap pattern [VERIFIED: codebase grep] |
| `bin/lib/prompt-loader.ts` | n/a | Hash-pinned prompt loading for Pass 2/4 prompt files | Already shipped; D-12 LOCKED slug protocol applies [VERIFIED: codebase grep] |
| `bin/lib/runtime.ts` | n/a | Provider API key resolution | Already shipped; getProviderApiKey is the canonical LLM key accessor [VERIFIED: codebase grep] |

### New Prompt Files Required

| Slug | Purpose | Activation Phase | Hash-pin |
|------|---------|-----------------|----------|
| `claim-support` | Pass 2 per-claim verdict prompt | Phase 5 ACTIVE | WN-3 sentinel → real SHA-256 at end of phase |
| `orphan-label` | Pass 4 edge-case claim vs definition classifier | Phase 5 ACTIVE | WN-3 sentinel → real SHA-256 at end of phase |

Both slugs must be added to `EXPECTED_PROMPT_HASHES` in `bin/lib/prompt-loader.ts` (D-12 LOCKED). The WN-3 sentinel-then-real pattern applies: land with `__PENDING_HASH_claim-support__` / `__PENDING_HASH_orphan-label__`, then re-pin atomically with real SHA-256 once the prompt files are byte-stable.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single LLM call per citation (Pass 2) | Batch all citations into one prompt | Single call is simpler, auditable, and maps 1:1 to the per-claim verdict table; batch is cheaper but harder to attribute rationale per citekey |
| Pure-Node regex for claim extraction (Pass 4) | NLP library (`compromise`, `natural`) | Pure-Node regex matches PRD §14 "Determinism where it counts" requirement; NLP library adds a dependency and is non-deterministic across locale/version updates |
| LLM for all Pass 4 sentence classification | LLM only for edge cases | Determinism first; LLM only for the hard cases reduces cost and non-determinism surface area |

**Installation:** No new packages. Phase 5 uses only existing dependencies.

## Package Legitimacy Audit

> Phase 5 installs NO new packages. All libraries used are already declared in package.json and have been audited in previous phases.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@anthropic-ai/sdk` | npm | ~2 yrs | High | github.com/anthropics/anthropic-sdk-python (JS port) | OK | Approved (already installed) |
| `openai` | npm | ~3 yrs | Very high | github.com/openai/openai-node | OK | Approved (already installed) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
bin/cli/verify.ts (orchestrator)
    │
    ├── runPass1(draftMd, bibPath)          ← BLOCKING (existing)
    ├── runPass3(draftMd, bibByCitekey)     ← BLOCKING (existing)
    │
    │   hasFail = pass1.any(FABRICATED|MIS-CITED) || pass3.any(NOT_FOUND)
    │   status = hasFail ? 'failed' : ...  ← NEVER TOUCHED by Pass 2/4
    │
    ├── runFreshnessForDraft(...)           ← ADVISORY (existing pattern)
    ├── runPass2(draftMd, bibByCitekey)     ← ADVISORY (NEW Phase 5)
    │       │
    │       │  for each [@citekey] sentence:
    │       │    extractClaimSentences(para, citekey)  ← deterministic regex
    │       │    pullAbstract(bibEntry)                ← from bib metadata
    │       │    assertBudget(...)                     ← BEFORE LLM call
    │       │    llm.call(claim-support prompt)        ← via runtime.ts
    │       │    appendCost(...)                       ← after LLM returns
    │       │    → Pass2Result { citekey, verdict, rationale, evidence }
    │       │
    │       └── [PENSMITH_NO_LLM=1] → tier2Placeholder { verdict:'UNCLEAR', ... }
    │
    └── runPass4(draftMd)                  ← ADVISORY (NEW Phase 5)
            │
            │  for each paragraph:
            │    extractClaims(para)         ← DETERMINISTIC pure-Node (Step 1)
            │    citedKeys = findCitekeys(para)  ← regex (Step 2, deterministic)
            │    orphans = claims.filter(c => !citedKeys.covers(c))  ← deterministic
            │    for ambiguous claims only:
            │      assertBudget(...)         ← BEFORE LLM call
            │      llm.call(orphan-label)   ← via runtime.ts (Step 3, advisory)
            │      appendCost(...)
            │    → Pass4Result { paragraphIndex, claims, orphans, ambiguous }
            │
            └── [PENSMITH_NO_LLM=1] → skip Step 3, label ambiguous as 'UNCLEAR'

VERIFICATION.md write (atomicWriteFile):
    ## Pass-1 (existing)
    ## Pass-3 (existing)
    ## Source Freshness RSCH-10 (existing)
    ## Pass-2 (claim support) [NEW]   ← advisory section
    ## Pass-4 (orphan claims) [NEW]   ← advisory section
```

### Recommended Project Structure

```
bin/lib/verify/
├── pass1.ts             # existing blocking pass
├── pass3.ts             # existing blocking pass
├── freshness.ts         # existing advisory pattern (model for Pass 2/4)
├── pass2.ts             # NEW: claim support (LLM-judged, advisory)
└── pass4.ts             # NEW: orphan-claim audit (deterministic extract + optional LLM)

templates/prompts/
├── claim-support.md     # NEW: Pass 2 claim-support prompt (hash-pinned)
└── orphan-label.md      # NEW: Pass 4 edge-case classifier prompt (hash-pinned)

tests/
├── fixtures/
│   ├── pass2-adversarial.json    # NEW: adversarial fixtures for UNCLEAR-bias calibration
│   └── pass4-orphan.json         # NEW: orphan-claim fixtures (paragraphs with/without citations)
├── known-bad-pass2.test.ts       # NEW: adversarial UNCLEAR-bias test (analogous to known-bad-citations)
├── known-bad-pass4.test.ts       # NEW: orphan extraction determinism test
└── tier-contract.test.ts         # MODIFIED: add pass2/pass4 tier-contract cases (D-24)
```

### Pattern 1: Advisory Side-Channel (from freshness.ts — exact model to follow)

**What:** A function that runs *after* `hasFail` is computed and *never* feeds back into it. Results are written to their own VERIFICATION.md section and returned for downstream consumers (DONE-09).

**When to use:** Every advisory pass follows this pattern. Do not add conditionals that say "if pass2 says UNSUPPORTED, set hasFail=true" — that would violate VRFY-07.

```typescript
// Source: bin/lib/verify/freshness.ts (existing, VERIFIED: codebase)
// Pass 2/4 MUST follow this structural shape:

export interface Pass2Result {
  citekey: string;
  claimSentence: string;          // the sentence containing [@citekey]
  verdict: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNCLEAR';
  rationale: string;              // ≤200 chars, for VERIFICATION.md
  evidence: string;               // quoted text from abstract/source
}

// bin/cli/verify.ts call site — modeled on freshness call site:
const pass2 = await runPass2(draftMd, bibByCitekey);  // AFTER hasFail
// ... NEVER: if (pass2.some(r => r.verdict === 'UNSUPPORTED')) hasFail = true;
```

### Pattern 2: Budget Gate — assertBudget Before Every LLM Call

**What:** Call `assertBudget` before the LLM call, `appendCost` after.

**When to use:** Every LLM call. This is ARCH-10 (per-step cap) + ARCH-09 (session cap).

```typescript
// Source: bin/lib/budget.ts (existing, VERIFIED: codebase)
// Per-section Pass 2 cap (ARCH-10 pattern) — constant TBD by planner, suggest $0.50/section
const PASS2_SECTION_CAP = 0.50;  // USD per section

await assertBudget(
  { scope: 'section', scopeId: `${n}-pass2`, cap: PASS2_SECTION_CAP },
  estimatedCallCost,
);
const result = await llm.call(prompt);
await appendCost({
  ts: new Date().toISOString(),
  scope: 'section',
  scopeId: `${n}-pass2`,
  provider: 'anthropic',
  model: modelId,
  inputTokens: result.usage.input_tokens,
  outputTokens: result.usage.output_tokens,
  costUsd: estimateCost({ providerId: 'anthropic', modelId, ...result.usage }),
});
```

### Pattern 3: Deterministic Claim Extraction for Pass 4

**What:** A pure-Node regex/grammar pipeline that takes a paragraph string and returns claim sentences without any LLM call.

**Claim sentence detection heuristics (pure-Node, PRD §14 "Determinism where it counts"):**

A sentence is treated as a *claim* if it matches at least one of these patterns:
1. Contains a modal verb indicating assertion: "is", "are", "demonstrates", "shows", "proves", "indicates", "suggests", "reveals", "confirms", "establishes", "argues", "claims"
2. Contains a comparative or causal connector: "because", "therefore", "thus", "hence", "consequently", "as a result"
3. Is not a rhetorical question (does not end in `?`)
4. Is not a definition marker: does not begin with "defined as", "refers to", "known as", "(from X, meaning ...)"
5. Has word count >= 8 (short fragments are not claims)

**Orphan detection (deterministic):**
A claim sentence is *orphaned* if the paragraph contains no `[@citekey]` token within 500 characters of the sentence, and the sentence's content is not attributable to the paper's own argument scope.

```typescript
// Source: [ASSUMED] — designed to match PRD §14 determinism requirement
// Pattern is analogous to bin/lib/quote-extractor.ts (extractQuotes):
export interface ExtractedClaim {
  sentence: string;
  startIndex: number;
  endIndex: number;
  claimConfidence: 'HIGH' | 'AMBIGUOUS';  // HIGH = multiple markers; AMBIGUOUS = single heuristic hit
}

export function extractClaimsFromParagraph(para: string): ExtractedClaim[] {
  // Split into sentences via period/exclamation boundary (simple but consistent)
  // Apply heuristic rules above
  // Return only sentences with claimConfidence HIGH or AMBIGUOUS
  // AMBIGUOUS triggers optional LLM labeling in Pass 4 Step 3
}
```

### Pattern 4: PENSMITH_NO_LLM Placeholder for Advisory Passes

**What:** When `PENSMITH_NO_LLM=1` (or no API key), advisory LLM calls return deterministic placeholder verdicts so tier-contract tests pass without a live LLM.

**When to use:** All LLM seams in advisory passes. Identical to the `tier2ProposeSwap` pattern in `bin/cli/revise.ts`.

```typescript
// Source: bin/cli/revise.ts (existing, VERIFIED: codebase)
// For Pass 2 placeholder:
function pass2Placeholder(claimSentence: string, citekey: string): Pass2Result {
  return {
    citekey,
    claimSentence,
    verdict: 'UNCLEAR',   // conservative UNCLEAR-bias in placeholder too
    rationale: 'Tier-2 placeholder: no LLM transport wired.',
    evidence: '',
  };
}

// For Pass 4 Step 3 placeholder:
function orphanLabelPlaceholder(sentence: string): 'claim' | 'definition' | 'UNCLEAR' {
  return 'UNCLEAR';  // conservative: treat as possibly-a-claim, flag for human
}
```

### Pattern 5: Pass 2 Prompt — UNCLEAR-Bias Calibration

**What:** The prompt must be calibrated to produce UNCLEAR rather than SUPPORTED when evidence is thin. The adversarial fixtures (see §Common Pitfalls) drive calibration.

**Prompt structural requirements:**
- Input variables: `{{citekey}}`, `{{claim_sentence}}`, `{{source_abstract}}`, `{{source_title}}`, `{{source_authors}}`
- Output: structured JSON `{ "verdict": "SUPPORTED"|"PARTIAL"|"UNSUPPORTED"|"UNCLEAR", "rationale": "...", "evidence": "..." }`
- Hard constraint in prompt: "When the abstract does not contain text that clearly supports OR clearly contradicts the claim, return UNCLEAR. Do NOT infer support from vague thematic similarity."
- UNCLEAR-bias test: adversarial fixtures where abstract is thematically adjacent but not literally supportive → must return UNCLEAR, not SUPPORTED.

```markdown
<!-- Source: [ASSUMED] — prompt template design based on PRD §7.7 Pass 2 description -->
<!-- This is what the prompt file templates/prompts/claim-support.md should contain -->

You are a citation-support judge for an academic paper verifier.

## Task
Determine whether the cited source supports the claim sentence.

## Inputs
- Claim sentence: {{claim_sentence}}
- Source: {{source_title}} by {{source_authors}}
- Source abstract: {{source_abstract}}
- Citekey: {{citekey}}

## Hard Constraints
- **UNCLEAR bias**: When evidence is ambiguous, return UNCLEAR — not SUPPORTED.
- Return SUPPORTED only when the abstract contains text that explicitly or near-explicitly supports the claim.
- Return PARTIAL when the source supports the claim's topic but not its specific assertion.
- Return UNSUPPORTED only when the abstract explicitly contradicts the claim or is clearly off-topic.
- NEVER infer support from thematic similarity alone.
- NEVER fabricate evidence quotes. The "evidence" field must be a substring of the provided abstract.

## Output
One JSON object, no prose before or after:
{ "verdict": "SUPPORTED"|"PARTIAL"|"UNSUPPORTED"|"UNCLEAR", "rationale": "<≤200 chars>", "evidence": "<direct quote from abstract or empty string>" }
```

### Anti-Patterns to Avoid

- **Anti-pattern: Advisory pass modifying hasFail.** Any code that sets `hasFail = true` based on Pass 2 or Pass 4 output violates VRFY-07 and must be rejected at plan-check.
- **Anti-pattern: LLM call inside deterministic Pass 4 claim extraction.** Step 1 (sentence splitting) and Step 2 (orphan detection) are pure-Node. LLM is only Step 3 (labeling AMBIGUOUS sentences). Mixing LLM into Step 1/2 breaks PRD §14.
- **Anti-pattern: Pass 2 runs before Pass 1/3.** The order must be: Pass 1 (blocking) → Pass 3 (blocking) → freshness (advisory) → Pass 2 (advisory) → Pass 4 (advisory). Reordering risks making status depend on advisory results.
- **Anti-pattern: New prompt slug without D-12 registration.** Every prompt file needs an entry in `EXPECTED_PROMPT_HASHES` before `loadPrompt()` will work. Skipping this crashes at runtime.
- **Anti-pattern: Cassette-bypassing LLM tests.** Pass 2/4 LLM calls must be testable with `PENSMITH_NO_LLM=1` (returns placeholder) so tier-contract tests work offline. Do not add live-network LLM calls to the default test suite.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| API key resolution | Custom env-var reading | `getProviderApiKey()` from `bin/lib/runtime.ts` | T-01-07 no-leak invariant; session log; config scope handling |
| Cost estimation | Hard-coded per-call USD | `estimateCost()` from `bin/lib/pricing.ts` | Single source of truth for rates; git-blame auditable |
| Budget pre-call gate | Ad-hoc budget check | `assertBudget()` from `bin/lib/budget.ts` | ARCH-09/10 contract — MUST be before the LLM call, not after |
| Atomic file writes | `fs.writeFileSync` | `atomicWriteFile()` from `bin/lib/atomic-write.ts` | ARCH-05; lint chokepoint D-07 blocks direct writeFile |
| Prompt loading | `readFileSync('templates/prompts/...')` | `loadPrompt(slug)` from `bin/lib/prompt-loader.ts` | D-12 hash-pin; drift detection at runtime AND PR-time |
| Sentence splitting | NLP library | Pure-Node regex boundary detection | PRD §14 determinism; no new dependency |

**Key insight:** The advisory pass infrastructure (budget gate, prompt loader, cost ledger, atomic writes) is already built. Phase 5 is plumbing new content (two pass modules + two prompt files + fixtures) into existing infrastructure, not building infrastructure.

---

## Common Pitfalls

### Pitfall 1: Advisory Pass Accidentally Writes to hasFail
**What goes wrong:** A developer adds `if (pass2.some(r => r.verdict === 'UNSUPPORTED')) hasFail = true;` in `bin/cli/verify.ts`, making Pass 2 block compile.
**Why it happens:** VRFY-07 says "advisory" but the code structure near `hasFail` makes it tempting.
**How to avoid:** `runPass2` and `runPass4` must return results ONLY; they must not mutate any shared state. The call sites in `verify.ts` are read-only: collect, render, return.
**Warning signs:** Any write to `hasFail`, `hasUnverifiable`, or `status` variable that touches pass2/pass4 output.

### Pitfall 2: LLM Seam Not Guarded by PENSMITH_NO_LLM
**What goes wrong:** `runPass2` calls the LLM unconditionally, breaking all tier-contract tests (which set `PENSMITH_NO_LLM=1`).
**Why it happens:** The PENSMITH_NO_LLM pattern is documented in `intake.ts` but must be replicated in every new LLM caller.
**How to avoid:** At the top of `runPass2` and `runPass4.step3`:
  ```typescript
  const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
  if (noLlm) return pass2Placeholder(claimSentence, citekey);
  ```
**Warning signs:** `tier-contract: verify-section` fails with "API key not set" or network errors.

### Pitfall 3: Prompt Slug Not Registered Before loadPrompt()
**What goes wrong:** `loadPrompt('claim-support')` throws "unknown prompt 'claim-support' — no entry in EXPECTED_PROMPT_HASHES".
**Why it happens:** The WN-3 pattern requires adding the sentinel to `EXPECTED_PROMPT_HASHES` BEFORE Wave 0 delivers the prompt file.
**How to avoid:** Wave 0 of Phase 5 must: (1) add sentinel entries to `EXPECTED_PROMPT_HASHES`, (2) set `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1` in CI, (3) create stub prompt files. Re-pin atomically at end of phase.
**Warning signs:** `loadPrompt: unknown prompt` error at runtime or in tests.

### Pitfall 4: Non-Deterministic Claim Extraction
**What goes wrong:** Using an NLP library for sentence splitting (e.g., `compromise`) introduces non-determinism across Node versions or locale settings. Pass 4 extracts different claims on different machines, causing tier-contract divergence.
**Why it happens:** NLP tokenizers have locale-sensitive behavior.
**How to avoid:** Implement claim extraction as pure regex over ASCII sentence boundary patterns (`.`, `!`, `?`). Avoid any NLP library. The quote-extractor.ts pattern (pure regex, no library) is the precedent.
**Warning signs:** `tier-contract: verify-section` fails on Windows but passes on Linux (a classic locale-sensitivity symptom).

### Pitfall 5: Budget Blowout on Papers with Many Citations
**What goes wrong:** A 20-section paper with 10 citations each spawns 200 Pass 2 LLM calls, exhausting the $5 session cap on Pass 2 alone before compile runs.
**Why it happens:** No per-step cap (ARCH-10) is set for Pass 2.
**How to avoid:** Use `{ scope: 'section', scopeId: '<n>-pass2', cap: 0.50 }` per section. A claude-haiku-4 call (~2000 tokens in+out) costs ~$0.007; 200 calls = $1.40 — well under 50% of the cap, leaving headroom for other phases.
**Warning signs:** `BudgetExceededError` during verify on large papers; no per-step cap defined.

### Pitfall 6: Pass 4 Treats All Sentences as Claims (Precision Collapse)
**What goes wrong:** The orphan-claim audit flags every sentence as a claim, producing dozens of false orphan warnings and drowning out real issues.
**Why it happens:** Over-broad claim detection heuristics (e.g., flagging all declarative sentences).
**How to avoid:** Apply confidence filtering: only HIGH-confidence claims (2+ heuristic markers) are auto-flagged as orphans; AMBIGUOUS ones go to LLM labeling. The `claimConfidence` field on `ExtractedClaim` gates this.
**Warning signs:** VERIFICATION.md shows 20+ orphan claims in a 300-word section with 5 citations.

### Pitfall 7: D-12 WN-3 sentinel not in lockstep
**What goes wrong:** `EXPECTED_PROMPT_HASHES` in `prompt-loader.ts` has the real SHA-256 but `tests/repo-files.test.ts` still has the sentinel (or vice versa), causing `repo-files.test.ts` to fail.
**Why it happens:** The re-pin commit must update BOTH files atomically (WN-3 invariant — single source of truth is `EXPECTED_PROMPT_HASHES`, which `repo-files.test.ts` imports).
**How to avoid:** The re-pin commit must be atomic and touch ONLY the two pin files together.
**Warning signs:** `repo-files.test.ts` failing with "hash mismatch" on `claim-support` or `orphan-label` after what was believed to be a successful re-pin.

### Pitfall 8: Pass 2 Runs Inside Deterministic Path (D-13 Pattern Violation)
**What goes wrong:** `loadPrompt('claim-support')` is called inside the verify orchestrator without the `PENSMITH_NO_LLM` guard, and the D-13 grep chokepoint fires (any prompt-loader invocation in verify.ts without an explicit D-13 exception is flagged).
**Why it happens:** D-13 currently says pass1-fuzzy-judge and pass3-quote-checker are DORMANT in Phase 3. Pass 2/4 are NEW and ACTIVE — they DO invoke loadPrompt. The D-13 comment in verify.ts must be updated.
**How to avoid:** Update the D-13 comment in `bin/cli/verify.ts` to document that `loadPrompt` calls for `claim-support` and `orphan-label` are PERMITTED (active Phase 5 advisory passes), while `pass1-fuzzy-judge` and `pass3-quote-checker` remain DORMANT. The grep chokepoint in Plan 03-07 must be extended or its scope narrowed.
**Warning signs:** CI lint failure or the Plan 03-07 acceptance grep fires on `bin/cli/verify.ts` after adding `loadPrompt('claim-support')`.

---

## Code Examples

### Pass 2 Module Skeleton (bin/lib/verify/pass2.ts)

```typescript
// Source: Modeled on bin/lib/verify/freshness.ts structure [VERIFIED: codebase]
// Advisory only — never feeds hasFail.

export type Pass2Verdict = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNCLEAR';

export interface Pass2Result {
  citekey: string;
  claimSentence: string;
  verdict: Pass2Verdict;
  rationale: string;   // ≤200 chars
  evidence: string;    // direct quote from abstract, or ''
}

// Extract the sentence(s) in draftMd that cite the given citekey.
function extractClaimSentences(para: string, citekey: string): string[] { ... }

export async function runPass2(
  draftMd: string,
  bibByCitekey: Map<string, { DOI?: string; title?: string; author?: string[] }>,
  opts: { n: number; scopeCapUsd?: number },
): Promise<Pass2Result[]> {
  const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
  // Extract all [@citekey] occurrences and their surrounding sentences
  // For each: assertBudget → llmCall → appendCost
  // NOWORK if noLlm → return placeholder UNCLEAR for all
}
```

### Pass 4 Module Skeleton (bin/lib/verify/pass4.ts)

```typescript
// Source: Modeled on bin/lib/quote-extractor.ts (deterministic extraction) [VERIFIED: codebase]
// + freshness.ts (advisory structure) [VERIFIED: codebase]

export interface Pass4ClaimResult {
  paragraphIndex: number;
  sentence: string;
  confidence: 'HIGH' | 'AMBIGUOUS';
  isOrphan: boolean;    // true if no nearby [@citekey]
  label: 'claim' | 'definition' | 'UNCLEAR';  // from Step 3 LLM or 'claim' by default for HIGH
}

export interface Pass4Result {
  paragraphIndex: number;
  totalSentences: number;
  claimsDetected: number;
  orphanCount: number;
  claims: Pass4ClaimResult[];
}

export async function runPass4(
  draftMd: string,
  opts: { n: number; scopeCapUsd?: number },
): Promise<Pass4Result[]> {
  const paragraphs = draftMd.split(/\n{2,}/);
  const results: Pass4Result[] = [];
  for (const [i, para] of paragraphs.entries()) {
    // Step 1 (deterministic): extractClaimsFromParagraph(para)
    // Step 2 (deterministic): findCitekeys(para) → Set<string>
    // Step 3 (advisory LLM for AMBIGUOUS only): label ambiguous claims
    // Orphan = HIGH-confidence claim with no nearby [@citekey]
  }
  return results;
}
```

### VERIFICATION.md Rendering Extensions (bin/cli/verify.ts)

```typescript
// Source: Modeled on renderFreshnessTable in bin/lib/verify/freshness.ts [VERIFIED: codebase]
function renderPass2Section(results: Pass2Result[]): string {
  if (results.length === 0) return '## Pass-2 (claim support, advisory)\n\n_(no citations to judge)_\n';
  return [
    '## Pass-2 (claim support, advisory — LLM-judged)',
    '',
    '| Citekey | Verdict | Rationale |',
    '|---------|---------|-----------|',
    ...results.map(r => `| ${r.citekey} | **${r.verdict}** | ${r.rationale} |`),
    '',
  ].join('\n');
}

function renderPass4Section(results: Pass4Result[]): string {
  const orphanCount = results.reduce((s, r) => s + r.orphanCount, 0);
  // render per-paragraph orphan table
}
```

### Tier-Contract Case for Pass 2/4 (tests/tier-contract.test.ts addition)

```typescript
// Source: Modeled on existing verify-section case in tests/tier-contract.test.ts [VERIFIED: codebase]
// D-24: the verify workflow body changes in Phase 5, so its tier-contract case must be updated.
// The 'verify-section' case already exists — it must be extended to assert:
//   1. VERIFICATION.md contains '## Pass-2' section
//   2. VERIFICATION.md contains '## Pass-4' section
//   3. Pass-2 section contains at least one verdict row (UNCLEAR for no-LLM placeholder)
//   4. Length equivalence ±20% still holds (TIER-07)
// No new tier-contract CASE is needed — the existing verify-section case is updated.
```

### Cassette Schema for LLM Calls (tests/fixtures/cassettes/)

Pass 2/4 LLM calls go through `@anthropic-ai/sdk` / `openai`, NOT through the `bin/lib/http.ts` undici chokepoint. Therefore the `nock`/`loadCassetteFile` cassette pattern does NOT apply to them. Instead:

```typescript
// Use PENSMITH_NO_LLM=1 for all tier-contract and CI tests.
// Live LLM tests are gated behind PENSMITH_NETWORK_TESTS=1 (same as TEST-03 pattern).
// No new cassette infrastructure needed — the no-LLM placeholder path is the test path.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic verifier (all passes in one function) | Modular pass files (pass1.ts, pass3.ts, freshness.ts, pass2.ts, pass4.ts) | Phase 3 established the modular pattern | Pass 2/4 slot cleanly into existing structure |
| LLM for all claim detection (no determinism) | Deterministic extraction + optional LLM labeling only | PRD §14 design decision | Avoids non-determinism for the core claim/orphan detection |
| Hard-blocking all advisory issues | Advisory only; blocking gate is Pass 1 + Pass 3 only | VRFY-07 design decision | Maintains Core Value without over-blocking on LLM noise |

**No deprecated approaches in this domain** — the advisory-pass pattern was designed for Phase 5 from the start.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claim sentence extraction via pure-Node regex (heuristic markers like "demonstrates", "shows", "argues") is sufficient for HIGH-confidence claim detection in academic English | §Pass 4 Architecture, §Deterministic Claim Extraction | If wrong, precision collapses (too many false positives) → lower the HIGH-confidence threshold or add more negative signals; does NOT affect the correctness invariant since orphan-label LLM handles AMBIGUOUS cases |
| A2 | A per-section Pass 2 cap of $0.50 USD is sufficient for sections with up to 10 citations using claude-haiku-4 | §Common Pitfalls §5 | If wrong (e.g., abstracts are very long), cap must be raised in CONTEXT.md; the cap is a config knob, not a structural invariant |
| A3 | `@anthropic-ai/sdk` version `^0.93` (resolved to 0.104.2) supports structured JSON output (tool use or response format) suitable for parsing Pass 2 verdicts | §Standard Stack | If wrong, must use text parsing with JSON.parse fallback; the prompt output contract mitigates this |
| A4 | The D-13 LOCKED comment in bin/cli/verify.ts only requires updating (not a hard lint chokepoint) to allow Pass 2/4 prompt loads | §Pitfall 8 | If wrong and a hard lint chokepoint exists, must add an ESLint override; needs investigation during Wave 0 |

---

## Open Questions

1. **Cap value for Pass 2 per-section budget**
   - What we know: ARCH-10 requires a per-step cap; Phase 4 smoother uses per-boundary calls.
   - What's unclear: The exact $0.50/section cap is a placeholder based on haiku-4 pricing estimates.
   - Recommendation: Confirm in CONTEXT.md or leave as a config-file knob (TOML) so users can adjust without code change.

2. **Abstract source for Pass 2: CITATIONS.bib only, or Unpaywall fetch?**
   - What we know: CITATIONS.bib already contains title/author/year; the PRD says "pull cited paper's abstract; if open-access via Unpaywall, also pull the relevant section" (§7.7).
   - What's unclear: Phase 5 scope — should abstract be freshly fetched (like Pass 3 fetches OA PDF), or used from the bib entry if present?
   - Recommendation: Use abstract from the bib entry if present (zero HTTP cost, fast). Unpaywall fetch is a nice-to-have — defer to Phase 8 alongside the broader PDF expansion (RSCH-05b). Flag this as a decision for CONTEXT.md.

3. **D-13 lint chokepoint scope**
   - What we know: The comment in `bin/cli/verify.ts` line 8 says "loadPrompt call MUST NOT be invoked here" and Plan 03-07 Task 7.2 wires a grep chokepoint.
   - What's unclear: Is the chokepoint a soft comment or a hard `tests/lint-*` ESLint assertion? If hard, it must be explicitly updated to permit `claim-support` and `orphan-label` slugs.
   - Recommendation: Wave 0 task: grep for the Plan 03-07 Task 7.2 acceptance test to determine the chokepoint form and update it.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Pass 4 deterministic extraction | ✓ | v24.16.0 | — |
| `@anthropic-ai/sdk` | Pass 2 LLM calls | ✓ | 0.104.2 (via npm) | PENSMITH_NO_LLM placeholder |
| `openai` | Tier 2 OpenAI-compatible endpoint | ✓ | 6.43.0 (via npm) | PENSMITH_NO_LLM placeholder |
| `ANTHROPIC_API_KEY` | Live LLM calls | ✗ (not in CI) | — | PENSMITH_NO_LLM=1 guard |

**Missing dependencies with no fallback:** none

**Missing dependencies with fallback:**
- `ANTHROPIC_API_KEY`: All test paths use `PENSMITH_NO_LLM=1`; no live LLM in CI (same pattern as all existing LLM-adjacent code in this codebase).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `tsx` runner |
| Config file | `scripts/run-tests.mjs` (discovers `tests/**/*.test.ts`) |
| Quick run command | `node --import tsx --test tests/known-bad-pass2.test.ts tests/known-bad-pass4.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VRFY-03 | Pass 2 produces UNCLEAR-biased verdicts on adversarial fixtures | unit | `node --import tsx --test tests/known-bad-pass2.test.ts` | ❌ Wave 0 |
| VRFY-03 | Pass 2 NEVER modifies hasFail (advisory non-regression) | unit | `node --import tsx --test tests/known-bad-pass2.test.ts` | ❌ Wave 0 |
| VRFY-03 | Pass 2 appears in VERIFICATION.md under `## Pass-2` section | integration | `node --import tsx --test tests/tier-contract.test.ts` | ✅ (must extend existing verify-section case) |
| VRFY-06 | Pass 4 extraction is deterministic (same output on repeated calls) | unit | `node --import tsx --test tests/known-bad-pass4.test.ts` | ❌ Wave 0 |
| VRFY-06 | Pass 4 orphan count is correct on known fixtures | unit | `node --import tsx --test tests/known-bad-pass4.test.ts` | ❌ Wave 0 |
| VRFY-06 | Pass 4 appears in VERIFICATION.md under `## Pass-4` section | integration | `node --import tsx --test tests/tier-contract.test.ts` | ✅ (must extend existing verify-section case) |
| SC#3 (tier parity) | Pass 2/4 verdicts equivalent (modulo prose) on both tiers | tier-contract | `npm run test:tier-contract` | ✅ (must extend verify-section case) |
| ARCH-10 | assertBudget fires BEFORE LLM call in Pass 2 | unit | `node --import tsx --test tests/known-bad-pass2.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --import tsx --test tests/known-bad-pass2.test.ts tests/known-bad-pass4.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/known-bad-pass2.test.ts` — adversarial UNCLEAR-bias fixtures, covers VRFY-03 + ARCH-10
- [ ] `tests/known-bad-pass4.test.ts` — orphan extraction determinism fixtures, covers VRFY-06
- [ ] `tests/fixtures/pass2-adversarial.json` — fixture file: paragraphs + citations + expected UNCLEAR verdicts
- [ ] `tests/fixtures/pass4-orphan.json` — fixture file: paragraphs with/without citations + expected orphan counts
- [ ] `templates/prompts/claim-support.md` — Pass 2 prompt file (stub, hash-pinned as sentinel)
- [ ] `templates/prompts/orphan-label.md` — Pass 4 edge-case classifier prompt (stub, hash-pinned as sentinel)
- [ ] EXPECTED_PROMPT_HASHES sentinel entries in `bin/lib/prompt-loader.ts` for both new slugs
- [ ] CI env `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1` set for Wave 0-N (removed atomically at re-pin commit)

---

## Security Domain

> `security_enforcement: true` (absent = enabled per config.json)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | Yes | Claim/sentence extraction uses fixed regex; LLM prompt variables use `interpolate()` with strict key-presence check (throws on missing var) — no injection vector |
| V6 Cryptography | No | — |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via draft text | Tampering | Claim sentences are extracted programmatically (regex) and inserted via `interpolate()`, not string concatenation; `interpolate()` throws on unexpected `{{ }}` in the extracted text (treat as untrusted input — escape before interpolation if `{{` appears in claim sentence) |
| API key leak via Pass 2 session log | Information Disclosure | `getProviderApiKey()` in `runtime.ts` never logs the resolved value (T-01-07 no-leak invariant); Pass 2 must follow the same pattern — log only `{ event: 'pass2.llmCall', citekey, model, inputTokens }`, never the API key |
| LLM output injection into VERIFICATION.md | Tampering | `rationale` and `evidence` fields from LLM are written as table cell text (no HTML, no Markdown that could escape the table); max 200-char rationale limit enforced at parse time |

---

## Project Constraints (from CLAUDE.md)

These are mandatory directives extracted from `./CLAUDE.md` that the planner must verify compliance with:

1. **Section-as-phase isolation**: Pass 2/4 run inside `pensmith verify <N>` — per-section, bounded. No cross-section state mutation. Non-negotiable.
2. **Two-tier architecture**: Both Tier 1 (MCP plugin) and Tier 2 (Node CLI) must produce equivalent Pass 2/4 verdicts (modulo prose) as tested by `tier-contract.test.ts`.
3. **Single-command UX**: No new user-facing commands in Phase 5. `verify <N>` already exists; Pass 2/4 are internal to it.
4. **Verifier blocks compile and export**: Pass 2/4 are advisory. Pass 1 + Pass 3 remain the ONLY blocking gate. Any plan task that makes Pass 2/4 block compile is architecturally wrong.
5. **Approval gates default-on**: Pass 2/4 advisory verdicts feed the Phase 6 export-confirmation gate (DONE-09). The gate itself ships in Phase 6, not Phase 5. Phase 5 only produces the data (orphan count, UNSUPPORTED count) that the gate will consume.
6. **No exported-document trace**: Unaffected by Phase 5.
7. **Honest framing on detection**: Unaffected by Phase 5.
8. **GSD orchestrates the build**: Follow GSD phase planning process.

---

## Sources

### Primary (HIGH confidence)
- `bin/lib/verify/freshness.ts` — existing advisory side-channel pattern (direct model for Pass 2/4) [VERIFIED: codebase grep]
- `bin/lib/verify/pass1.ts` — existing blocking pass structure (Pass 2/4 must not replicate or approach this pattern) [VERIFIED: codebase grep]
- `bin/lib/verify/pass3.ts` — existing blocking pass structure [VERIFIED: codebase grep]
- `bin/cli/verify.ts` — orchestrator; hasFail/status computation; VERIFICATION.md writer [VERIFIED: codebase grep]
- `bin/lib/budget.ts` — assertBudget pre-call gate contract [VERIFIED: codebase grep]
- `bin/lib/pricing.ts` — estimateCost function, MODEL_PRICES table [VERIFIED: codebase grep]
- `bin/lib/runtime.ts` — getProviderApiKey, LLM provider config [VERIFIED: codebase grep]
- `bin/lib/prompt-loader.ts` — D-12 LOCKED slug protocol, WN-3 sentinel pattern [VERIFIED: codebase grep]
- `bin/lib/quote-extractor.ts` — deterministic extraction pattern to model Pass 4 Step 1 on [VERIFIED: codebase grep]
- `bin/cli/revise.ts` — PENSMITH_NO_LLM placeholder pattern [VERIFIED: codebase grep]
- `tests/tier-contract.test.ts` — D-24 obligation, existing verify-section case structure [VERIFIED: codebase grep]
- `.planning/REQUIREMENTS.md` — VRFY-03, VRFY-06 full text [VERIFIED: file read]
- `PRD.md` §7.7 — Pass 2 + Pass 4 specification [VERIFIED: file read]
- `.planning/ROADMAP.md` Phase 5 section [VERIFIED: file read]
- `.planning/STATE.md` — D-10 (COMP-01 scope = Pass 1 + Pass 3 only) [VERIFIED: file read]
- `.planning/phases/04-breadth-n-sections-compile-wave-scheduling/04-CONTEXT.md` D-10 — advisory pass compile scope [VERIFIED: file read]
- `package.json` — `@anthropic-ai/sdk ^0.93`, `openai ^4` already declared [VERIFIED: file read]

### Secondary (MEDIUM confidence)
- slopcheck legitimacy: `@anthropic-ai/sdk` [OK], `openai` [OK], `natural` [OK], `compromise` [OK] [VERIFIED: slopcheck run]
- npm registry: `@anthropic-ai/sdk@0.104.2`, `openai@6.43.0` [VERIFIED: npm view]

### Tertiary (LOW confidence)
- Claim extraction heuristics (modal verb markers, causal connectors) [ASSUMED] — based on academic NLP training knowledge; calibration against adversarial fixtures is the validation mechanism

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; existing SDK already declared in package.json; verified with npm view
- Architecture: HIGH — modeled directly on verified existing code (freshness.ts, quote-extractor.ts, revise.ts)
- Pitfalls: HIGH — derived from actual code patterns in the codebase; not theoretical
- Prompt design: MEDIUM — UNCLEAR-bias calibration approach is architecturally sound; exact wording needs adversarial fixture testing

**Research date:** 2026-06-17
**Valid until:** 2026-07-17 (30 days; stable SDK, stable codebase patterns)
