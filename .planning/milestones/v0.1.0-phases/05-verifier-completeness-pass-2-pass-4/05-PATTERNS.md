# Phase 5: Verifier Completeness (Pass 2 + Pass 4) - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 11 new/modified files
**Analogs found:** 11 / 11

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bin/lib/verify/pass2.ts` | service | request-response (LLM advisory) | `bin/lib/verify/freshness.ts` | exact |
| `bin/lib/verify/pass4.ts` | service | transform + request-response (LLM advisory) | `bin/lib/quote-extractor.ts` + `bin/lib/verify/freshness.ts` | role-match (composite) |
| `templates/prompts/claim-support.md` | config | n/a | `templates/prompts/revise-swap.md` (WN-3 sentinel pattern) | exact |
| `templates/prompts/orphan-label.md` | config | n/a | `templates/prompts/revise-swap.md` (WN-3 sentinel pattern) | exact |
| `bin/lib/prompt-loader.ts` | utility | n/a | self (MODIFIED: add sentinel entries) | self |
| `bin/cli/verify.ts` | controller | request-response | self (MODIFIED: extend orchestrator) | self |
| `tests/known-bad-pass2.test.ts` | test | n/a | `tests/known-bad-citations.test.ts` | exact |
| `tests/known-bad-pass4.test.ts` | test | n/a | `tests/known-bad-citations.test.ts` | exact |
| `tests/fixtures/pass2-adversarial.json` | config | n/a | `tests/fixtures/known-bad-citations.json` | role-match |
| `tests/fixtures/pass4-orphan.json` | config | n/a | `tests/fixtures/known-bad-quotes.json` | role-match |
| `tests/tier-contract.test.ts` | test | n/a | self (MODIFIED: extend verify-section case) | self |

---

## Pattern Assignments

### `bin/lib/verify/pass2.ts` (service, LLM advisory)

**Analog:** `bin/lib/verify/freshness.ts`

**Imports pattern** (`freshness.ts` lines 24–28):
```typescript
import { normalizeDoi } from '../doi.js';
import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteFile } from '../http-mock.js';
import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js';
import { Semaphore } from '../budget.js';
```

For pass2.ts, adapt as:
```typescript
import { assertBudget, appendCost, type CostRecord } from '../budget.js';
import { loadPrompt, interpolate } from '../prompt-loader.js';
import { getProviderApiKey } from '../runtime.js';
```

**Result interface pattern** (`freshness.ts` lines 30–48):
```typescript
export type FreshnessProbe = 'DOI HEAD' | 'retraction-watch';
export type FreshnessStatus = 'WARN';

export interface FreshnessWarning {
  probe: FreshnessProbe;
  status: FreshnessStatus;
  detail: string;
}

export interface FreshnessResult {
  citekey: string;
  doi: string | null;
  warnings: FreshnessWarning[];
}
```

Copy this interface-per-result shape directly into `pass2.ts`:
```typescript
export type Pass2Verdict = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNCLEAR';

export interface Pass2Result {
  citekey: string;
  claimSentence: string;
  verdict: Pass2Verdict;
  rationale: string;   // ≤200 chars, enforced at parse time
  evidence: string;    // direct quote from abstract, or ''
}
```

**PENSMITH_NO_LLM guard pattern** (`bin/cli/revise.ts` lines 34–44):
```typescript
function tier2ProposeSwap(vars: ReviseSwapVars): Promise<string> {
  return Promise.resolve(JSON.stringify({
    action: 'remove',
    flagged_citekey: vars.flagged_citekey,
    replacement_citekey: null,
    rationale: 'Tier-2 placeholder: no model transport wired; recommending mechanical removal of the flagged citation.',
    patch: {
      before_excerpt: `[@${vars.flagged_citekey}]`,
      after_excerpt: '',
    },
  }));
}
```

Apply same guard at the top of `runPass2`:
```typescript
const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
if (noLlm) return citations.map((c) => pass2Placeholder(c.claimSentence, c.citekey));
```

**Budget gate pattern** (`bin/lib/budget.ts` lines 127–148):
```typescript
// Pre-call gate (D-44). MUST be called BEFORE any paid API request.
export async function assertBudget(spec: BudgetSpec, estimateUsd: number): Promise<void> {
  const spent = await totalCost({ scope: spec.scope, scopeId: spec.scopeId });
  if (spent + estimateUsd > spec.cap) {
    throw new BudgetExceededError(spec, spent, estimateUsd);
  }
}

// Append a cost record to .paper/COSTS.jsonl via O_APPEND (D-45/D-46).
export async function appendCost(record: CostRecord): Promise<void> {
  const line = JSON.stringify(record) + '\n';
  await atomicAppendFile(costsPath(), line);
}
```

Apply this exact call-site pattern in each per-claim LLM loop iteration:
```typescript
await assertBudget(
  { scope: 'section', scopeId: `${n}-pass2`, cap: PASS2_SECTION_CAP },
  estimatedCallCost,
);
const result = await llm.call(prompt);
await appendCost({ ts: new Date().toISOString(), scope: 'section', scopeId: `${n}-pass2`, provider: 'anthropic', model: modelId, inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens, costUsd: estimateCost(...) });
```

**Advisory run function signature** (`freshness.ts` lines 156–163):
```typescript
export async function probeFreshnessAll(
  sources: ReadonlyArray<{ citekey: string; doi: string | null }>,
): Promise<FreshnessResult[]> {
  const sem = new Semaphore(5);
  return Promise.all(
    sources.map((s) => sem.withLock(() => probeFreshness(s.citekey, s.doi))),
  );
}
```

Pass2 top-level export:
```typescript
export async function runPass2(
  draftMd: string,
  bibByCitekey: Map<string, { DOI?: string; title?: string; author?: string[] }>,
  opts: { n: number; scopeCapUsd?: number },
): Promise<Pass2Result[]>
```

**Rendering pattern** (`freshness.ts` lines 170–191):
```typescript
export function renderFreshnessTable(results: ReadonlyArray<FreshnessResult>): string {
  const lines = [
    '## Source Freshness (RSCH-10)',
    '',
    '| Citekey | Probe | Status | Detail |',
    '|---------|-------|--------|--------|',
  ];
  if (results.length === 0) {
    lines.push('| _(none)_ | — | — | no DOIs to probe |');
    return lines.join('\n');
  }
  for (const r of results) {
    if (r.warnings.length === 0) {
      lines.push(`| ${r.citekey} | DOI HEAD | ok | |`);
      continue;
    }
    for (const w of r.warnings) {
      lines.push(`| ${r.citekey} | ${w.probe} | ${w.status} | ${w.detail} |`);
    }
  }
  return lines.join('\n');
}
```

Copy this table-render shape for `renderPass2Section`:
```typescript
export function renderPass2Section(results: Pass2Result[]): string {
  if (results.length === 0) return '## Pass-2 (claim support, advisory)\n\n_(no citations to judge)_\n';
  return [
    '## Pass-2 (claim support, advisory — LLM-judged)',
    '',
    '| Citekey | Claim Sentence | Verdict | Rationale |',
    '|---------|---------------|---------|-----------|',
    ...results.map(r => `| ${r.citekey} | ${r.claimSentence.slice(0, 60)}… | **${r.verdict}** | ${r.rationale} |`),
    '',
  ].join('\n');
}
```

**Error handling pattern** — mirror freshness.ts silent-error policy (`freshness.ts` lines 124–128):
```typescript
} catch (err) {
  // Transport error (ECONNREFUSED / ETIMEDOUT / DNS) is network noise,
  // NOT source staleness (D-10). Silent — optional DEBUG only.
  debug(`citekey=${citekey} doi=${normalized} HEAD transport error: ${String(err)} — silent`);
}
```

For pass2.ts, non-silent — LLM errors should surface as UNCLEAR verdicts, not swallowed:
```typescript
} catch (err) {
  // LLM call failed — return conservative UNCLEAR rather than crashing.
  results.push({ citekey, claimSentence, verdict: 'UNCLEAR', rationale: `LLM error: ${String(err).slice(0, 100)}`, evidence: '' });
}
```

---

### `bin/lib/verify/pass4.ts` (service, deterministic transform + advisory LLM)

**Primary analog (Step 1 — deterministic extraction):** `bin/lib/quote-extractor.ts`

**Imports + interface pattern** (`quote-extractor.ts` lines 18–27):
```typescript
export interface ExtractedQuote {
  /** The quoted text, with citation tokens stripped and whitespace collapsed. */
  text: string;
  /** The citekey associated with this quote (the `[@citekey]` immediately following). */
  citekey: string;
  /** Whether this was a markdown block quote (`> ...`) or an inline quote. */
  kind: 'block' | 'inline';
}
```

Map to pass4.ts claim interface:
```typescript
export interface ExtractedClaim {
  sentence: string;
  startIndex: number;
  endIndex: number;
  claimConfidence: 'HIGH' | 'AMBIGUOUS';  // HIGH = 2+ markers; AMBIGUOUS = single heuristic hit
}
```

**Deterministic extraction pattern** (`quote-extractor.ts` lines 30–95 — extractQuotes):

The key pattern is: split text into structural units, apply deterministic rules (regex/word-count thresholds, no NLP), return only qualifying elements. Copy this structure for `extractClaimsFromParagraph`:

```typescript
// From quote-extractor.ts lines 30-35 — threshold constants as named knobs:
const MIN_WORDS = 10;
const MIN_INLINE_CHARS = 60;

// From quote-extractor.ts lines 51-78 — line-based iteration with flush pattern:
const lines = draftMd.split('\n');
let blockBuf: string[] = [];
// ... apply heuristic rules per line/sentence, flush when boundary hit
```

```typescript
// From quote-extractor.ts lines 82-94 — regex-based inline match:
const inlineRe = /[""]([^""]{60,})[""]\s*\[@([a-z][a-z0-9_-]*)\]/g;
for (const m of draftMd.matchAll(inlineRe)) {
  const text = m[1] ?? '';
  const citekey = m[2] ?? '';
  if (!text || !citekey) continue;
  if (text.length < MIN_INLINE_CHARS) continue;
  if (wordCount(text) < MIN_WORDS) continue;
  out.push({ text: stripCites(text), citekey, kind: 'inline' });
}
```

For pass4.ts sentence-level claim extraction, the regex target changes but the deterministic iteration + threshold pattern is identical:
```typescript
const CLAIM_MIN_WORDS = 8;
const CLAIM_MARKERS = /\b(is|are|demonstrates|shows|proves|indicates|suggests|reveals|confirms|establishes|argues|claims|because|therefore|thus|hence|consequently)\b/i;

export function extractClaimsFromParagraph(para: string): ExtractedClaim[] {
  // Split on sentence boundaries (period/exclamation/question — pure regex, no NLP)
  // Apply CLAIM_MARKERS heuristic; count matches for HIGH vs AMBIGUOUS
  // Filter by CLAIM_MIN_WORDS
  // Return ExtractedClaim[]
}
```

**Citekey extraction pattern** (`pass1.ts` lines 191–195 and `verify.ts` lines 96, 191):
```typescript
// From pass1.ts lines 191-193:
const citekeys = [...draftMd.matchAll(/\[@([a-z][a-z0-9_-]*)\]/g)]
  .map((m) => m[1])
  .filter((s): s is string => Boolean(s));
const unique = [...new Set(citekeys)];
```

Use the same regex for `findCitekeys(para)` in Step 2:
```typescript
function findCitekeys(para: string): Set<string> {
  return new Set(
    [...para.matchAll(/\[@([a-z][a-z0-9_-]*)\]/g)]
      .map((m) => m[1])
      .filter((s): s is string => Boolean(s)),
  );
}
```

**Secondary analog (advisory structure):** `bin/lib/verify/freshness.ts`

**Top-level export signature** mirrors `probeFreshnessAll` (`freshness.ts` lines 156–163):
```typescript
export async function runPass4(
  draftMd: string,
  opts: { n: number; scopeCapUsd?: number },
): Promise<Pass4Result[]>
```

**PENSMITH_NO_LLM guard** — same as pass2.ts, applied at Step 3 only:
```typescript
const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
// Step 1 and Step 2 are deterministic — always run regardless of noLlm.
// Step 3 (orphan-label LLM) is skipped when noLlm:
if (noLlm) return 'UNCLEAR';
```

**Result interfaces:**
```typescript
export interface Pass4ClaimResult {
  paragraphIndex: number;
  sentence: string;
  confidence: 'HIGH' | 'AMBIGUOUS';
  isOrphan: boolean;
  label: 'claim' | 'definition' | 'UNCLEAR';
}

export interface Pass4Result {
  paragraphIndex: number;
  totalSentences: number;
  claimsDetected: number;
  orphanCount: number;
  claims: Pass4ClaimResult[];
}
```

---

### `templates/prompts/claim-support.md` (new prompt file, WN-3 sentinel)

**Analog:** Any existing prompt in `templates/prompts/` (same format). The WN-3 registration in `bin/lib/prompt-loader.ts` is the critical pattern.

**WN-3 sentinel pattern** (`prompt-loader.ts` lines 91–117 — EXPECTED_PROMPT_HASHES):
```typescript
export const EXPECTED_PROMPT_HASHES: Record<string, string> = {
  'intake-clarifier':    'bc93c546f5853196379c8958b1d8895b3cc3d0c2aabef94858e48638e181ba94',
  // ...
  // Phase 4 04-CONTEXT.md D-12 — hash-pinned smoother prompt (Plan 04-05). Lands
  // here as a __PENDING_HASH_smoother__ sentinel at Task 1a (WN-3); Plan 04-05
  // Task 4 re-pins it to the SAME real SHA-256...
  'smoother':            'ee934f8eee89bf239a95bd8b3eebf04f7802eeb39b0cadb8510c5cddc49097f5',
};
```

Add at Phase 5 Wave 0:
```typescript
// Phase 5 05-CONTEXT.md — hash-pinned claim-support + orphan-label prompts (Wave 0 sentinel).
// WN-3: land as __PENDING_HASH_<slug>__ sentinels; re-pin atomically with real SHA-256
// once prompt files are byte-stable. PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 in CI during Waves 0-N.
'claim-support':       '__PENDING_HASH_claim-support__',   // Phase 5 advisory Pass 2
'orphan-label':        '__PENDING_HASH_orphan-label__',    // Phase 5 advisory Pass 4 Step 3
```

**interpolate() usage pattern** (`prompt-loader.ts` lines 203–210):
```typescript
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`interpolate: missing var "${key}" — template references {{${key}}} but vars has keys [${Object.keys(vars).join(', ')}]`);
    }
    return vars[key] ?? '';
  });
}
```

Call site in pass2.ts:
```typescript
const prompt = interpolate(loadPrompt('claim-support'), {
  citekey,
  claim_sentence: claimSentence,
  source_abstract: abstract,
  source_title: bibEntry.title ?? '',
  source_authors: (bibEntry.author ?? []).join(', '),
});
```

---

### `templates/prompts/orphan-label.md` (new prompt file, WN-3 sentinel)

**Same WN-3 pattern as `claim-support.md`.** Sentinel key `'orphan-label'` added alongside `'claim-support'` in the same Wave 0 commit.

Call site in pass4.ts Step 3:
```typescript
const prompt = interpolate(loadPrompt('orphan-label'), {
  sentence: claim.sentence,
  paragraph_context: para.slice(0, 500),
});
```

---

### `bin/lib/prompt-loader.ts` (MODIFIED — add sentinel entries)

**Modification scope:** Add two lines to `EXPECTED_PROMPT_HASHES` (lines 91–117). No structural change.

**Pattern to copy** (lines 113–116 — Phase 4 smoother sentinel addition):
```typescript
  // Phase 4 04-CONTEXT.md D-12 — hash-pinned smoother prompt (Plan 04-05). Lands
  // here as a __PENDING_HASH_smoother__ sentinel at Task 1a (WN-3); Plan 04-05
  // Task 4 re-pins it to the SAME real SHA-256 the tests/repo-files.test.ts pin
  // already carries (the prompt body is byte-stable on creation — both surfaces
  // then agree and loadPrompt('smoother') succeeds WITHOUT the pending bypass).
  'smoother':            'ee934f8eee89bf239a95bd8b3eebf04f7802eeb39b0cadb8510c5cddc49097f5',
```

Apply same comment + sentinel structure for Phase 5 slugs. Also update the D-13 comment at lines 23–26 to permit `claim-support` and `orphan-label` `loadPrompt` calls (see `bin/cli/verify.ts` modification below).

---

### `bin/cli/verify.ts` (MODIFIED — extend orchestrator)

**Modification scope:** Add `runPass2` / `runPass4` / `renderPass2Section` / `renderPass4Section` imports and call sites after the existing freshness call (line 115). Update D-13 comment at lines 1–13. Never touch `hasFail` / `hasUnverifiable` / `status` computation (lines 119–124).

**Existing advisory call-site pattern to mirror** (`verify.ts` lines 112–116):
```typescript
// RSCH-10 freshness probe (D-10, WARN-only). Runs AFTER the blocking
// verdict computation and NEVER influences `status` — a stale DOI or a
// retraction-watch hit surfaces as an advisory table row, not a block.
const freshness = await runFreshnessForDraft(draftMd, bibPath);
```

Add AFTER line 116 (after freshness, before lines.join):
```typescript
// Pass-2 (claim support, advisory). Runs AFTER hasFail is locked. NEVER
// modifies hasFail / hasUnverifiable / status. Returns results for DONE-09.
const pass2 = await runPass2(draftMd, bibByCitekey, { n });

// Pass-4 (orphan-claim audit, advisory). Runs AFTER hasFail. NEVER modifies
// hasFail / hasUnverifiable / status. Deterministic extraction + optional LLM
// for AMBIGUOUS edge-cases (PENSMITH_NO_LLM guard inside runPass4).
const pass4 = await runPass4(draftMd, { n });
```

**VERIFICATION.md render extension** (`verify.ts` lines 126–141):
```typescript
const lines = [
  `# VERIFICATION (Section ${n}, ${slug})`,
  '',
  `Status: ${status}`,
  '',
  '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
  '',
  ...pass1.map((r) => `- ${r.citekey}: **${r.verdict}** — ...`),
  '',
  '## Pass-3 (quote integrity, deterministic — levenshtein-substring)',
  '',
  ...pass3.map((r) => `- ${r.citekey} ...`),
  '',
  renderFreshnessTable(freshness),
  '',
];
await atomicWriteFile(verifPath, lines.join('\n'));
```

Extend `lines` array with Phase 5 advisory sections (after `renderFreshnessTable` entry):
```typescript
  renderPass2Section(pass2),
  '',
  renderPass4Section(pass4),
  '',
```

**Return value extension** (line 144):
```typescript
return { ok: status !== 'failed', status, path: verifPath, pass1, pass3, freshness };
```

Add pass2/pass4 to the return:
```typescript
return { ok: status !== 'failed', status, path: verifPath, pass1, pass3, freshness, pass2, pass4 };
```

**D-13 comment update** (lines 1–13 — Pitfall 8 mitigation):
Update the comment to document that `loadPrompt('claim-support')` and `loadPrompt('orphan-label')` are PERMITTED Phase 5 advisory calls, while `pass1-fuzzy-judge` and `pass3-quote-checker` remain DORMANT. The D-13 grep chokepoint from Plan 03-07 Task 7.2 must be narrowed to exclude the two new slugs.

---

### `tests/known-bad-pass2.test.ts` (new test — adversarial UNCLEAR-bias)

**Analog:** `tests/known-bad-citations.test.ts`

**Test file structure** (`known-bad-citations.test.ts` lines 1–84):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../tests/fixtures/known-bad-citations.json', import.meta.url));
const verifyCliPath = new URL('../bin/cli/verify.ts', import.meta.url);

test('known-bad-citations: fixture file exists (SC-2)', () => {
  assert.ok(existsSync(fixturePath), 'MISSING: ...');
});

test('known-bad-citations: fixture contains ≥ 10 entries with expected_verdict: "MIS-CITED" (SC-2)',
  { skip: !existsSync(fixturePath) },
  () => {
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as unknown[];
    // ... assertions
  },
);
```

Apply same structure for pass2:
```typescript
const fixturePath = fileURLToPath(new URL('../tests/fixtures/pass2-adversarial.json', import.meta.url));
const pass2ModPath = new URL('../bin/lib/verify/pass2.ts', import.meta.url);

test('known-bad-pass2: fixture file exists (VRFY-03)', () => { ... });
test('known-bad-pass2: adversarial fixtures all have expected_verdict: "UNCLEAR" (VRFY-03)',
  { skip: !existsSync(fixturePath) }, () => { ... });
test('known-bad-pass2: pass2 module exists (VRFY-03)',
  { skip: !existsSync(fixturePath) }, () => { ... });
test('known-bad-pass2: runPass2 returns UNCLEAR for all adversarial fixtures (VRFY-03, PENSMITH_NO_LLM=1)',
  { skip: !existsSync(fixturePath) || !existsSync(pass2ModPath) },
  async () => {
    // PENSMITH_NO_LLM=1 → placeholder UNCLEAR for all
    // Assert runPass2 return value verdict is 'UNCLEAR' for every fixture entry
    // Assert hasFail is NEVER modified by runPass2 (call site pattern — read-only)
  },
);
test('known-bad-pass2: assertBudget fires before LLM call (ARCH-10)',
  { skip: !existsSync(pass2ModPath) },
  async () => { ... },
);
```

**PENSMITH_NO_LLM test pattern** (`tier-contract.test.ts` lines 457–473):
```typescript
function runCliInDir(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const out = execFileSync(process.execPath, [CLI_BIN_ABS, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PENSMITH_NO_LLM: '1' },  // ← key pattern
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });
    return { stdout: out, stderr: '', exitCode: 0 };
  } catch (err) { ... }
}
```

Set `PENSMITH_NO_LLM: '1'` in process.env before importing/calling runPass2/runPass4 in test:
```typescript
process.env['PENSMITH_NO_LLM'] = '1';
const { runPass2 } = await import('../bin/lib/verify/pass2.js');
```

---

### `tests/known-bad-pass4.test.ts` (new test — orphan extraction determinism)

**Analog:** `tests/known-bad-citations.test.ts` (same structure) + `tests/known-bad-quotes.test.ts` (same fixture-driven pattern)

**Additional pattern — determinism assertion:** Call `extractClaimsFromParagraph` twice on the same input and assert deep equality (no NLP library non-determinism):
```typescript
test('known-bad-pass4: extractClaimsFromParagraph is deterministic (VRFY-06, PRD §14)', async () => {
  const { extractClaimsFromParagraph } = await import('../bin/lib/verify/pass4.js');
  const para = 'Climate change demonstrates accelerating ice loss. This proves the feedback loop.';
  const r1 = extractClaimsFromParagraph(para);
  const r2 = extractClaimsFromParagraph(para);
  assert.deepEqual(r1, r2, 'extractClaimsFromParagraph must be deterministic across calls');
});
```

**Orphan count fixture assertion pattern:**
```typescript
test('known-bad-pass4: orphan count matches expected for known fixtures (VRFY-06)',
  { skip: !existsSync(fixturePath) || !existsSync(pass4ModPath) },
  async () => {
    process.env['PENSMITH_NO_LLM'] = '1';
    const { runPass4 } = await import('../bin/lib/verify/pass4.js');
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Array<{ para: string; expected_orphan_count: number }>;
    for (const entry of fixtures) {
      const results = await runPass4(entry.para, { n: 1 });
      const orphans = results.reduce((s, r) => s + r.orphanCount, 0);
      assert.equal(orphans, entry.expected_orphan_count, `orphan count mismatch for: ${entry.para.slice(0, 60)}`);
    }
  },
);
```

---

### `tests/fixtures/pass2-adversarial.json` (new fixture)

**Analog:** `tests/fixtures/known-bad-citations.json`

**Shape pattern** (from `known-bad-citations.test.ts` lines 27–36 — the fixture schema the test expects):
```typescript
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as unknown[];
assert.ok(Array.isArray(fixtures), 'known-bad-citations.json must be a JSON array');
assert.ok(fixtures.length >= 10, `must have ≥ 10 entries`);
for (const entry of fixtures) {
  const e = entry as Record<string, unknown>;
  assert.ok(e['expected_verdict'] === 'MIS-CITED', ...);
  assert.ok(typeof e['doi'] === 'string', ...);
  assert.ok(typeof e['citekey'] === 'string', ...);
}
```

For pass2-adversarial.json, each entry shape:
```json
{
  "citekey": "smith2023",
  "claim_sentence": "Climate change accelerates sea level rise dramatically.",
  "source_title": "Atmospheric CO2 and global temperature trends",
  "source_abstract": "This paper investigates the correlation between atmospheric carbon dioxide levels and long-term temperature data from 1950-2023.",
  "expected_verdict": "UNCLEAR",
  "adversarial_reason": "Abstract is thematically adjacent (climate) but does not specifically address sea level rise — must return UNCLEAR, not SUPPORTED"
}
```

Minimum 5 entries where the abstract is thematically adjacent but NOT literally supportive (UNCLEAR-bias calibration test).

---

### `tests/fixtures/pass4-orphan.json` (new fixture)

**Analog:** `tests/fixtures/known-bad-quotes.json`

Each entry shape:
```json
{
  "paragraph": "Climate change demonstrates accelerating ice loss. This proves the feedback loop is intensifying. Ice sheets are retreating globally.",
  "in_text_citekeys": [],
  "expected_orphan_count": 2,
  "description": "Two HIGH-confidence claim sentences with no citations — both orphaned"
}
```

Include entries with: (a) zero citations + multiple claims → all orphaned, (b) one citation + multiple claims → some orphaned, (c) one citation per claim → zero orphaned (control), (d) definition sentences that should NOT be flagged as claims.

---

### `tests/tier-contract.test.ts` (MODIFIED — extend verify-section case)

**Modification scope:** Extend the existing `verify-section` PHASE_3_CASES entry and the test loop body. No new case entry needed (D-24 obligation is satisfied by updating the existing case).

**Existing verify-section artifact assertion pattern** (`tier-contract.test.ts` lines 557–616):
```typescript
test(`tier-contract: ${tc.name} (TIER-06, Plan 09 GREEN)`, { skip: !verbExists }, async () => {
  const root = seedPaperFixture();
  const cliResult = runCliInDir(tc.cliArgs, root);
  assert.equal(cliResult.exitCode, 0, ...);

  const artifactPath = join(root, tc.expectedArtifact);
  assert.ok(existsSync(artifactPath), ...);
  const cliArtifactBytes = readFileSync(artifactPath, 'utf8');
  assert.ok(cliArtifactBytes.length > 0, ...);
  // ... MCP equivalence assertions
});
```

Extend to assert Pass-2 and Pass-4 section presence in VERIFICATION.md:
```typescript
// After existing artifact-present assertion, add:
if (tc.name === 'verify-section') {
  assert.ok(
    cliArtifactBytes.includes('## Pass-2'),
    `tier-contract verify-section: VERIFICATION.md must contain ## Pass-2 section (VRFY-03)`,
  );
  assert.ok(
    cliArtifactBytes.includes('## Pass-4'),
    `tier-contract verify-section: VERIFICATION.md must contain ## Pass-4 section (VRFY-06)`,
  );
  // Pass-2 section must contain at least one verdict row (UNCLEAR for no-LLM placeholder)
  assert.match(
    cliArtifactBytes,
    /\*\*UNCLEAR\*\*/,
    `tier-contract verify-section: Pass-2 must contain an UNCLEAR verdict row when PENSMITH_NO_LLM=1`,
  );
}
```

**seedPaperFixture pattern for verify-section** (`tier-contract.test.ts` lines 508–525):
```typescript
function seedPaperFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-phase3-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  // ...
  // Seed CITATIONS.bib for verify-section.
  const bibFixture = fileURLToPath(new URL('./fixtures/known-good-fixture/CITATIONS.bib', import.meta.url));
  if (existsSync(bibFixture)) {
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), readFileSync(bibFixture, 'utf8'));
  }
  return root;
}
```

The seeded DRAFT.md must contain at least one `[@citekey]` token for Pass-2 to have something to judge (otherwise VERIFICATION.md shows "no citations to judge" and the UNCLEAR assertion fails). Ensure `seedPaperFixture` seeds a DRAFT.md with a citation sentence.

---

## Shared Patterns

### PENSMITH_NO_LLM Guard (applies to all LLM seams in pass2.ts and pass4.ts Step 3)

**Source:** `bin/cli/revise.ts` lines 34–44 + `bin/lib/verify/freshness.ts` structural model
**Apply to:** `bin/lib/verify/pass2.ts`, `bin/lib/verify/pass4.ts` (Step 3 only)

```typescript
// At the top of every function that may call the LLM:
const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
if (noLlm) return placeholderResult(...);

// Placeholder shape for pass2 (conservative UNCLEAR-bias):
function pass2Placeholder(claimSentence: string, citekey: string): Pass2Result {
  return {
    citekey,
    claimSentence,
    verdict: 'UNCLEAR',
    rationale: 'Tier-2 placeholder: no LLM transport wired.',
    evidence: '',
  };
}

// Placeholder for pass4 Step 3 (conservative: treat as possibly-a-claim):
function orphanLabelPlaceholder(): 'claim' | 'definition' | 'UNCLEAR' {
  return 'UNCLEAR';
}
```

### assertBudget / appendCost Pre-Call Gate (applies to every LLM call)

**Source:** `bin/lib/budget.ts` lines 127–148
**Apply to:** `bin/lib/verify/pass2.ts`, `bin/lib/verify/pass4.ts` (Step 3 LLM calls)

```typescript
// assertBudget BEFORE every LLM call:
await assertBudget(
  { scope: 'section', scopeId: `${n}-pass2`, cap: PASS2_SECTION_CAP },
  estimatedCallCost,
);
const result = await llm.call(prompt);
// appendCost AFTER:
await appendCost({
  ts: new Date().toISOString(),
  scope: 'section',
  scopeId: `${n}-pass2`,
  provider: 'anthropic',
  model: modelId,
  inputTokens: result.usage.input_tokens,
  outputTokens: result.usage.output_tokens,
  costUsd: estimateCost(...),
});
```

### loadPrompt / interpolate Pattern (applies to all new prompt files)

**Source:** `bin/lib/prompt-loader.ts` lines 151–210
**Apply to:** `bin/lib/verify/pass2.ts` (claim-support), `bin/lib/verify/pass4.ts` (orphan-label)

```typescript
const promptBody = loadPrompt('claim-support');  // hash-validated; throws if slug unknown
const filled = interpolate(promptBody, {
  citekey,
  claim_sentence: claimSentence,
  source_abstract: abstract,
  source_title: title,
  source_authors: authors,
});
```

### getProviderApiKey API Key Resolution

**Source:** `bin/lib/runtime.ts` lines 385–412
**Apply to:** `bin/lib/verify/pass2.ts`, `bin/lib/verify/pass4.ts`

```typescript
// From runtime.ts lines 385-390:
export async function getProviderApiKey(
  providerId: string,
  opts: { scope?: LoadScope; paperRoot?: string } = {},
): Promise<string> {
  const cfg = await loadRuntimeConfig(opts);
  const provider = cfg.providers?.[providerId];
  // ...
}
```

Use `getProviderApiKey('anthropic')` — never read `process.env.ANTHROPIC_API_KEY` directly. The no-LLM guard short-circuits before this call when `PENSMITH_NO_LLM=1`.

### Advisory Call-Site Position (applies to verify.ts orchestrator modifications)

**Source:** `bin/cli/verify.ts` lines 112–116 — freshness call after `hasFail` is computed
**Apply to:** Pass-2 and Pass-4 call sites in `bin/cli/verify.ts`

```typescript
// hasFail / hasUnverifiable / status are LOCKED after line 124. All advisory
// calls come AFTER this block. Never add pass2/pass4 result to hasFail.
const hasFail = pass1.some((r) => r.verdict !== 'OK')
  || pass3.some((r) => r.verdict === 'NOT_FOUND');
const hasUnverifiable = pass3.some((r) => r.verdict === 'PDF_UNAVAILABLE' || r.verdict === 'TEXT_UNAVAILABLE');
const status = hasFail ? 'failed' : (hasUnverifiable ? 'unverifiable' : 'verified');

// ← advisory calls go here, after status is frozen:
const freshness = await runFreshnessForDraft(draftMd, bibPath);
// pass2 and pass4 mirror this pattern
const pass2 = await runPass2(draftMd, bibByCitekey, { n });
const pass4 = await runPass4(draftMd, { n });
```

### WN-3 Sentinel Registration (applies to new prompt slugs)

**Source:** `bin/lib/prompt-loader.ts` lines 91–117 — EXPECTED_PROMPT_HASHES map
**Apply to:** Wave 0 modifications to `bin/lib/prompt-loader.ts`

Step 1: Add sentinel entries (Wave 0):
```typescript
'claim-support': '__PENDING_HASH_claim-support__',
'orphan-label':  '__PENDING_HASH_orphan-label__',
```

Step 2: Set `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1` in CI for Waves 0-N.

Step 3: Atomic re-pin commit at phase end — replace sentinels with real SHA-256 AND update `tests/repo-files.test.ts` pins in the same commit (WN-3 single-source-of-truth invariant; both surfaces must agree).

---

## No Analog Found

All files in Phase 5 have strong analogs in the existing codebase. No files require falling back to RESEARCH.md patterns exclusively.

---

## Metadata

**Analog search scope:** `bin/lib/verify/`, `bin/cli/`, `bin/lib/`, `tests/`, `tests/fixtures/`
**Files scanned:** 11 analog files read in full
**Pattern extraction date:** 2026-06-17

### Key analog summary

| File | Analog | Critical excerpt location |
|------|--------|--------------------------|
| `bin/lib/verify/freshness.ts` | pass2.ts + pass4.ts structure | Lines 30–48 (interfaces), 83–149 (advisory function body), 156–163 (all-items runner), 170–191 (render) |
| `bin/lib/quote-extractor.ts` | pass4.ts Step 1 deterministic extraction | Lines 18–95 (full file — extraction interface + logic) |
| `bin/lib/verify/pass1.ts` | pass2.ts [@citekey] regex, pass4.ts citekey extraction | Lines 191–195 (citekey regex pattern) |
| `bin/lib/budget.ts` | assertBudget / appendCost call site in pass2.ts + pass4.ts | Lines 127–148 |
| `bin/lib/prompt-loader.ts` | WN-3 sentinel registration + loadPrompt/interpolate usage | Lines 91–117 (EXPECTED_PROMPT_HASHES), 151–210 |
| `bin/lib/runtime.ts` | getProviderApiKey in pass2.ts + pass4.ts | Lines 385–412 |
| `bin/cli/revise.ts` | PENSMITH_NO_LLM placeholder in pass2.ts + pass4.ts | Lines 34–44 |
| `bin/cli/verify.ts` | orchestrator extension pattern | Lines 112–116 (freshness call site), 119–124 (hasFail lock), 126–141 (lines array), 144 (return) |
| `tests/known-bad-citations.test.ts` | known-bad-pass2.test.ts + known-bad-pass4.test.ts | Lines 1–84 (full test file structure) |
| `tests/tier-contract.test.ts` | verify-section case extension | Lines 557–616 (generic case loop), 508–525 (seedPaperFixture) |
