# Phase 12: Live Research + Intake Bootstrap + Humanizer Task — Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 6 new/modified files (3 modified, 1 new, 2 new test files)
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `bin/cli/research.ts` | orchestrator/controller | batch (fan-out → aggregate → filter) | `bin/cli/research.ts` (self, replace swap-seam block lines 153–197) | exact |
| `bin/lib/research-orchestrator.ts` | service | batch (fan-out → dedup → transform) | `bin/lib/sources/retraction-cross-check.ts` + `bin/lib/sources/zotero-mcp.ts` | role-match |
| `bin/cli/intake.ts` | controller | request-response | `bin/cli/intake.ts` (self, add `initState()` call) | exact |
| `bin/lib/exporter.ts` | service | request-response | `bin/lib/sources/zotero-mcp.ts` (injectable seam) + `bin/cli/intake.ts` (`__setInterpolateForTest`) | role-match |
| `tests/research-orchestrator.test.ts` | test | batch | `tests/state.test.ts` + `tests/humanizer-wrap.test.ts` | role-match |
| `tests/intake-state-bootstrap.test.ts` | test | request-response | `tests/state.test.ts` | exact |
| `tests/humanizer-wrap-task.test.ts` | test | request-response | `tests/humanizer-wrap.test.ts` | exact |

---

## Pattern Assignments

### `bin/cli/research.ts` — replace swap-seam block (lines 153–197)

**Analog:** `bin/cli/research.ts` itself (lines 77–228 — the surrounding shell is kept intact)

**Existing imports to retain** (lines 33–44):
```typescript
import { defineCommand } from 'citty';
import path from 'node:path';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { writeBibtex } from '../lib/bibtex-write.js';
import { writeRis } from '../lib/ris-write.js';
import { paperDir } from '../lib/paths.js';
import { crossCheckRetractions } from '../lib/sources/retraction-cross-check.js';
import { SourceCandidateSchema, type SourceCandidate } from '../lib/schemas/source-candidate.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
```

**New imports to add** (Phase-12 fan-out wiring):
```typescript
import { sources } from '../lib/sources/index.js';
import { normalizeDoi } from '../lib/doi.js';
import { jaroWinkler, TITLE_JW_THRESHOLD } from '../lib/fuzzy.js';
import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
// OR: import { runResearchOrchestrator } from '../lib/research-orchestrator.js';
```

**GEN-06 fail-loud probe pattern** (lines 95–115) — keep exactly as is:
```typescript
const noLlm = process.env['PENSMITH_NO_LLM'] === '1';
if (!noLlm) {
  try {
    const providerId = await resolveProviderId();
    await getProviderApiKey(providerId);
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      process.stderr.write(
        `pensmith research: ERROR — no LLM key configured.\n` +
        `Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation.\n` +
        `Run inside Claude Code (Tier 1) for key-free operation.\n`,
      );
      process.exitCode = 1;
      return { ok: false, mode: 'no-key-configured' };
    }
    throw e;
  }
}
```

**complete() call pattern** (lines 129–137) — the existing call shape to replicate for source-evaluator:
```typescript
const llmResult = await complete({
  system:
    'You are an academic research assistant. Your task is to disambiguate a ' +
    'research topic and propose search scopes. Return a JSON object in the ' +
    'exact format specified in the prompt. No prose outside the JSON object.',
  messages: [{ role: 'user', content: interpolatedPrompt }],
  scope: 'task',
  scopeId: 'research',
});
```

**LOCKED ordering at bottom of run()** — preserve EXACTLY (lines 199–215):
```typescript
// D-15 LOCKED: crossCheckRetractions BEFORE writeBibtex
await crossCheckRetractions(candidates);
// D-19 + D-20 LOCKED: writeBibtex is the SOLE citation-js writer
await writeBibtex(candidates, bibPath);
await writeRis(candidates, risPath);
const libraryContent = JSON.stringify(
  { $schemaVersion: 1, entries: candidates },
  null,
  2,
);
await atomicWriteFile(libraryPath, libraryContent);
```

**Swap-seam replacement target** — the ENTIRE block lines 153–197 is replaced with the orchestrated fan-out. Everything before line 153 (the `complete()` call with `topic-disambiguator`) and everything after line 197 (the `crossCheckRetractions` call) stays unchanged.

---

### `bin/lib/research-orchestrator.ts` (new service file)

**Analog 1:** `bin/lib/sources/retraction-cross-check.ts` — for the injectable seam + for-loop-over-candidates pattern

**Injectable seam pattern** (retraction-cross-check.ts lines 31–33):
```typescript
export interface RetractionLookup {
  fetchById: (doi: string) => Promise<SourceCandidate | null>;
}
```
Mirror this for the `SourceFetcher` / `SearchRunner` seam so offline tests inject fake adapters.

**Adapter iteration guard pattern** (documented in `bin/lib/sources/index.ts` header):
```typescript
// From: bin/lib/sources/index.ts comment + RESEARCH.md Pattern 1
const searchableAdapters = Object.entries(sources).filter(
  ([, adapter]) => 'search' in adapter,
) as Array<[string, { search: (q: string, opts?: { limit?: number }) => Promise<SourceCandidate[]> }]>;
```

**Analog 2:** `bin/lib/sources/zotero-mcp.ts` — for the module-level null-seam + graceful degradation pattern (lines 70–80):
```typescript
// From: bin/lib/sources/zotero-mcp.ts:70–80
let _client: ZoteroClient | null = null;

export function setZoteroClientForTest(client: ZoteroClient | null): void {
  _client = client;
}
```
The research-orchestrator's adapter seam mirrors this shape exactly. Name it `__setAdapterRegistryForTest` (or accept it as a function parameter for cleaner DI).

**DOI dedup pattern** (from RESEARCH.md Pattern 2, verified against `bin/lib/doi.ts` + `bin/lib/fuzzy.ts`):
```typescript
import { normalizeDoi } from '../doi.js';
import { jaroWinkler, TITLE_JW_THRESHOLD } from '../fuzzy.js';

const seen = new Map<string, SourceCandidate>();
for (const c of allCandidates) {
  const key = c.doi ? normalizeDoi(c.doi) : null;
  if (key) {
    if (!seen.has(key)) seen.set(key, c);
    // duplicate DOI → first-wins (prefer record with abstract)
  } else {
    const existing = [...seen.values()].find(
      (s) => jaroWinkler(s.title, c.title) >= TITLE_JW_THRESHOLD,
    );
    if (!existing) seen.set(`no-doi:${c.id}`, c);
  }
}
const deduped = [...seen.values()];
```

**Defensive JSON parse pattern** (lines 185–196 of research.ts — the existing Phase-11 shim shows the shape; Phase-12 replaces it with this same guard applied to the two new LLM responses):
```typescript
// Pattern from research.ts lines 185-196:
try {
  const raw: unknown = JSON.parse(llmResult.text);
  // ... Zod safeParse ...
} catch {
  process.stderr.write(
    `pensmith research: WARN — model response could not be parsed as JSON ...\n`,
  );
  candidates = [];  // or fallback single-scope
}
```

**SourceCandidateSchema validation per element** (research.ts lines 168–175):
```typescript
const validated: SourceCandidate[] = [];
for (const item of raw) {
  const parsed = SourceCandidateSchema.safeParse(item);
  if (parsed.success) {
    validated.push(parsed.data);
  }
  // Silently skip invalid elements — T-11-10 boundary enforcer.
}
```

**Error handling pattern** (research.ts + retraction-cross-check.ts):
```typescript
// Per-adapter failure is swallowed; only total failure degrades to empty set
try {
  const results = await adapter.search(query, { limit: 10 });
  allCandidates.push(...results);
} catch {
  process.stderr.write(`pensmith research: WARN — adapter ${name} failed for query "${query}" (non-fatal).\n`);
}
```

---

### `bin/cli/intake.ts` — add `initState()` call

**Analog:** `bin/cli/intake.ts` itself — the existing `runSideEffects` pattern (lines 389–395) shows exactly where the new call slots in

**runSideEffects pattern** (lines 389–395):
```typescript
const runSideEffects = async (): Promise<void> => {
  const paperId = await resolvePaperId(cwd);
  await registerPaperNonFatal(cwd, paperId, meta);
  if (styleSamples) {
    await runStyleProducerNonFatal(cwd, styleSamples, paperId, meta.name);
  }
};
```

**StateAlreadyExistsError idempotent catch pattern** (from RESEARCH.md + state.ts API):
```typescript
// INSERT BEFORE: await atomicWriteFile(targetPath, result.text);
// AFTER: const result = await complete(...)
import { initState, StateAlreadyExistsError } from '../lib/state.js';

try {
  await initState(paperDir(cwd));
} catch (e) {
  if ((e as { code?: string }).code === 'STATE_ALREADY_EXISTS') {
    // Idempotent: STATE.json already present — proceed without re-seeding.
  } else {
    throw e;
  }
}
```

**resolvePaperId pattern** (lines 167–174) — this is already wired; after initState() runs first, it will return non-null:
```typescript
async function resolvePaperId(cwd: string): Promise<string | null> {
  try {
    const state = await loadState(cwd);
    return state.paperId;
  } catch {
    return null;
  }
}
```

**registerPaperNonFatal WARN-skip guard** (lines 194–200) — the guard that currently WARN-skips; adding initState() makes paperId non-null so this proceeds:
```typescript
if (!paperId) {
  process.stderr.write(
    'pensmith new: WARN — no paperId yet (STATE.json absent); skipping global-library registration (non-fatal).\n',
  );
  return;
}
```

**New import** to add at top of intake.ts:
```typescript
import { initState, StateAlreadyExistsError } from '../lib/state.js';
// (loadState is already imported at line 48)
```

---

### `bin/lib/exporter.ts` — fill `runHumanizer` body

**Analog 1:** `bin/cli/intake.ts` lines 35–46 — `__setInterpolateForTest` seam (the canonical precedent for injectable module-level function seams in this repo):
```typescript
// From: bin/cli/intake.ts:35–46
let _interpolate: (template: string, vars: Record<string, string>) => string = interpolate;

export function __setInterpolateForTest(
  fn: (template: string, vars: Record<string, string>) => string,
): () => void {
  const prev = _interpolate;
  _interpolate = fn;
  return () => {
    _interpolate = prev;
  };
}
```
The `__setTaskRunnerForTest` seam for GEN-05 copies this shape exactly (double-underscore prefix = test-only, module-level let, restore function returned).

**Analog 2:** `bin/lib/sources/zotero-mcp.ts` lines 70–80 — alternative seam shape (simpler: no restore function):
```typescript
// From: bin/lib/sources/zotero-mcp.ts:70–80
let _client: ZoteroClient | null = null;
export function setZoteroClientForTest(client: ZoteroClient | null): void {
  _client = client;
}
```

**TaskRunner type + seam** (new, to add above `runHumanizer`):
```typescript
export type TaskRunner = (skill: string, input: Record<string, string>) => Promise<{ output: string }>;

let _taskRunner: TaskRunner | null = null;

/** Test-only seam: inject a deterministic Task runner (mirrors __setInterpolateForTest in intake.ts). */
export function __setTaskRunnerForTest(fn: TaskRunner | null): void {
  _taskRunner = fn;
}
```

**runHumanizer body** — replace `void draftMd` (line 76) and `void paperRoot` (line 88) stubs:
```typescript
// Existing skeleton to keep (lines 72–99):
export async function runHumanizer(
  draftMd: string,
  paperRoot?: string,
): Promise<string | null> {
  try {
    if (!isHumanizerSkillPresent()) {
      process.stdout.write(
        'pensmith done: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n',
      );
      return null;
    }
    // --- FILL IN: replace the void stubs with real Task invocation ---
    const taskResult = _taskRunner !== null
      ? await _taskRunner('humanizer', { draft: draftMd })
      : null; // Tier-2: no Task transport
    if (taskResult === null) {
      process.stdout.write(
        'pensmith done: humanizer skill present but no Task transport in this tier — skipping humanize step (export proceeds on DRAFT.md).\n',
      );
      return null;
    }
    const finalPath = join(paperDir(paperRoot), 'FINAL.md');
    await atomicWriteFile(finalPath, taskResult.output);
    return finalPath;
    // --- END FILL ---
  } catch {
    process.stdout.write(
      'pensmith done: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n',
    );
    return null;
  }
}
```

**done.ts before/after pattern** (lines 406–420) — `runHumanizer` must NOT call scoreHonesty internally; done.ts owns it:
```typescript
// From: bin/cli/done.ts:406–420
const before = await scoreHonesty(draftMd);

let finalPath: string | null = null;
let after: Awaited<ReturnType<typeof scoreHonesty>> = null;
if (args.raw !== true) {
  finalPath = await runHumanizer(draftMd, paperRoot);
  if (finalPath !== null) {
    try {
      after = await scoreHonesty(readFileSync(finalPath, 'utf8'));
    } catch {
      after = null;
    }
  }
}
```

**New import to add in exporter.ts**:
```typescript
import { join } from 'node:path'; // already imported
// join(paperDir(paperRoot), 'FINAL.md') — always use paperDir(), never cwd+'FINAL.md' (Pitfall 8)
```

---

### `tests/research-orchestrator.test.ts` (new)

**Analog:** `tests/state.test.ts` — for the `mkPaperRoot()` tmp-dir + env override + dynamic-import pattern (lines 27–43):
```typescript
// From: tests/state.test.ts:27–43
function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-state-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}
```

**Analog:** `tests/humanizer-wrap.test.ts` — for the stdout-capture pattern + skip guard + no-throw assertion (lines 63–86):
```typescript
// From: tests/humanizer-wrap.test.ts:63–86
const stdoutLines: string[] = [];
const origWrite = process.stdout.write.bind(process.stdout);
(process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
  stdoutLines.push(s);
  return true;
};
let result: string | null;
try {
  result = await mod.runHumanizer('# Draft\n\nSome prose to humanize.\n');
} finally {
  (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
}
assert.equal(result, null, 'absent humanizer must return null');
assert.ok(
  stdoutLines.some((l) => l.includes('humanizer skill not found')),
  'must print a banner containing "humanizer skill not found"',
);
```

**PENSMITH_NO_LLM env var pattern** (from tier-contract.test.ts — the offline gate CI tests use):
```typescript
// Set before the fan-out call; the adapter offline path and the LLM mock both key on this
process.env['PENSMITH_NO_LLM'] = '1';
// PENSMITH_NETWORK_TESTS NOT set → isOfflineMode() returns true → cassettes fire
```

**node:test import pattern** (matches all test files in the repo):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
```

---

### `tests/intake-state-bootstrap.test.ts` (new)

**Analog:** `tests/state.test.ts` — exact match; reuse `mkPaperRoot()` pattern and dynamic-import pattern (lines 41–64):
```typescript
// From: tests/state.test.ts:41–64
test('initState then loadState round-trips ($schemaVersion + paperId + createdAt)', async () => {
  const root = mkPaperRoot();
  const { initState, loadState } = await import('../bin/lib/state.js');

  const seeded = await initState(root, { paperId: 'paper-abc' });
  const loaded = await loadState(root);

  assert.equal(loaded.paperId, 'paper-abc');
  assert.equal(loaded.$schemaVersion, seeded.$schemaVersion);
});

test('initState refuses to overwrite an existing STATE.json', async () => {
  const root = mkPaperRoot();
  const { initState, StateAlreadyExistsError } = await import('../bin/lib/state.js');

  await initState(root);
  await assert.rejects(
    () => initState(root),
    (e: unknown) => e instanceof StateAlreadyExistsError,
  );
});
```

**intake.ts run() call pattern** (mirrors `tests/intake-pii-ordering.test.ts` lines 59–80) — for tests that exercise the full intake verb:
```typescript
// From: tests/intake-pii-ordering.test.ts:59–end (the runIntake helper pattern)
async function runIntake(cwd: string, args: Record<string, unknown>): Promise<void> {
  // dynamic import of intakeCommand; call run() with args
  // requires PENSMITH_NO_LLM=1 in env
}
```

---

### `tests/humanizer-wrap-task.test.ts` (new)

**Analog:** `tests/humanizer-wrap.test.ts` — exact match; extends the existing test file's structure with Task seam tests (lines 60–86):
```typescript
// From: tests/humanizer-wrap.test.ts:60–86
test('humanizer-wrap: runHumanizer absent-skill → no throw, returns null, banner "humanizer skill not found" (DONE-03)',
  { skip: !runHumanizerExported() },
  async () => {
    const mod = await import(exporterModUrl.href) as {
      runHumanizer: (draftMd: string) => Promise<string | null>;
    };
    // ... stdout-capture pattern ...
  },
);
```

**Injectable seam test pattern** (derived from `zotero-mcp.ts` + `__setInterpolateForTest`):
```typescript
// Test body for GEN-05 injectable seam:
const { runHumanizer, __setTaskRunnerForTest } = await import(exporterModUrl.href) as {
  runHumanizer: (draftMd: string, paperRoot?: string) => Promise<string | null>;
  __setTaskRunnerForTest: (fn: null | ((skill: string, input: Record<string, string>) => Promise<{ output: string }>)) => void;
};

const fakeOutput = '# Humanized draft\n\nSome improved prose.\n';
__setTaskRunnerForTest((_skill, _input) => Promise.resolve({ output: fakeOutput }));
try {
  const result = await runHumanizer('# Draft\n\nOriginal prose.\n', tmpDir);
  assert.ok(result !== null, 'present + Task → returns FINAL.md path');
  assert.ok(result.endsWith('FINAL.md'), 'path ends with FINAL.md');
  assert.equal(fs.readFileSync(result, 'utf8'), fakeOutput, 'FINAL.md content matches Task output');
} finally {
  __setTaskRunnerForTest(null);
}
```

---

## Shared Patterns

### Offline mode guard (applies to ALL new code touching network or LLM)

**Source:** `bin/lib/http-mock.ts` lines 139–141 + `bin/lib/anthropic.ts` lines 109–111

```typescript
// Network offline: checks PENSMITH_NETWORK_TESTS !== '1'
export function isOfflineMode(): boolean {
  return process.env['PENSMITH_NETWORK_TESTS'] !== '1';
}

// LLM offline: checks PENSMITH_NO_LLM === '1'
export function isNoLlmMode(): boolean {
  return process.env['PENSMITH_NO_LLM'] === '1';
}
```

**Apply to:** `bin/lib/research-orchestrator.ts` fan-out (adapters check `isOfflineMode()` internally; LLM calls use `complete()` which checks `isNoLlmMode()` internally — no extra guards needed in the orchestrator).

**Apply to:** All new tests — set `process.env['PENSMITH_NO_LLM'] = '1'` before invoking any LLM-path code.

---

### Atomic write (applies to ALL file-output code)

**Source:** `bin/lib/atomic-write.ts` — D-07 chokepoint

**Apply to:** `bin/lib/research-orchestrator.ts` (library write), `bin/lib/exporter.ts` (FINAL.md write)

```typescript
// ALWAYS use atomicWriteFile — NEVER fs.writeFile directly (ESLint enforces this)
import { atomicWriteFile } from './atomic-write.js';
await atomicWriteFile(filePath, content);
```

---

### Non-fatal stderr WARN pattern (applies to all advisory side-effects)

**Source:** `bin/cli/intake.ts` lines 195–200 + `bin/lib/sources/retraction-cross-check.ts` lines 63–67

```typescript
// Per-item failure: swallow and WARN, never throw
} catch (e) {
  process.stderr.write(
    `pensmith <verb>: WARN — <operation> failed (non-fatal): ${(e as Error).message}\n`,
  );
}
```

**Apply to:** adapter failures in research-orchestrator fan-out, `runHumanizer` catch block (already present in exporter.ts skeleton).

---

### Locked D-15 ordering (research path only)

**Source:** `bin/cli/research.ts` lines 199–215

```
crossCheckRetractions → writeBibtex → writeRis → atomicWriteFile(LIBRARY.json)
```

This order is LOCKED. The orchestrator must deliver its final `SourceCandidate[]` to `research.ts` BEFORE `crossCheckRetractions` is called. `research.ts` continues to own the final chokepoint sequence.

---

### Test stdout capture (applies to all tests asserting stdout banners)

**Source:** `tests/humanizer-wrap.test.ts` lines 68–73

```typescript
const stdoutLines: string[] = [];
const origWrite = process.stdout.write.bind(process.stdout);
(process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
  stdoutLines.push(s);
  return true;
};
try {
  // ... code under test ...
} finally {
  (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
}
```

**Apply to:** `tests/humanizer-wrap-task.test.ts` (Tier-2 skip banner assertion), `tests/research-orchestrator.test.ts` (zero-candidate WARN assertion).

---

### Dynamic import for verb tests (applies to all verb-level tests)

**Source:** `tests/state.test.ts` lines 43–45

```typescript
const { initState, loadState } = await import('../bin/lib/state.js');
```

Dynamic import is used (not static) so the module is loaded AFTER env overrides take effect. All Phase-12 tests that touch state.ts, intake.ts, or exporter.ts MUST use dynamic import with env set first.

---

## No Analog Found

No files in this phase lack a codebase analog. All patterns have direct precedents.

---

## Metadata

**Analog search scope:** `bin/cli/`, `bin/lib/`, `bin/lib/sources/`, `tests/`
**Files scanned (read in full):** 14 source files + 4 test files
**Pattern extraction date:** 2026-06-22
