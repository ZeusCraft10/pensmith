# Phase 9: Educator/Tutorial Mode + PII Polish - Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 12 new/modified files
**Analogs found:** 12 / 12

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `bin/lib/tutorial.ts` | service | event-driven | `bin/lib/session-log.ts` (enqueue/EventEmitter pattern) | role-match |
| `bin/cli/write.ts` (modify) | controller | event-driven | `bin/cli/write.ts` itself + `bin/cli/intake.ts` (non-fatal DI callback pattern) | exact-self |
| `bin/cli/intake.ts` (modify) | controller | request-response | `bin/cli/intake.ts` itself (`runStyleProducerNonFatal` optional-arg wiring) | exact-self |
| `bin/lib/pii.ts` (modify) | utility | transform | `bin/lib/pii.ts` itself (extend classifyPii/redactPii) | exact-self |
| `bin/lib/router.ts` (modify) | service | request-response | `bin/lib/router.ts` itself (resolveNextAction state-machine extension) | exact-self |
| `templates/prompts/tutorial-section-provenance.md` | config | — | `templates/prompts/` existing slugs + `bin/lib/prompt-loader.ts` EXPECTED_PROMPT_HASHES | role-match |
| `templates/prompts/tutorial-research-rationale.md` | config | — | same as above | role-match |
| `tests/tutorial.test.ts` | test | event-driven | `tests/write-orchestrator.test.ts` (stub-callback pattern) + `tests/library.test.ts` (env-override isolation) | role-match |
| `tests/pii-polish.test.ts` | test | transform | `tests/pii.test.ts` (corpus/fixture + idempotence + property pattern) | exact |
| `tests/intake-pii-ordering.test.ts` | test | request-response | `tests/intake-style-producer.test.ts` (source-grep skip-predicate + ordering assertion) | exact |
| `.gitignore` (modify) | config | — | existing `.gitignore` entries (e.g. `*.local`) | exact |
| `tests/lint-tutorial-no-branch.test.ts` | test | transform | `tests/lint-chokepoint.test.ts` (ESLint programmatic grep-style invariant) | exact |

---

## Pattern Assignments

### `bin/lib/tutorial.ts` (new — service, event-driven)

**Analog:** `bin/lib/session-log.ts`

**Key architectural constraint:** TutorialSubscriber is activated ONLY by CLI verb entrypoints (bin/cli/*.ts). It is NEVER imported by any bin/lib/* file other than itself. Foundation libs receive an optional callback parameter — not a TutorialSubscriber instance.

**Imports pattern** (`bin/lib/session-log.ts` lines 25-30):
```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicAppendFile, atomicWriteFile } from './atomic-write.js';
import { redactPii, redactKeys } from './pii.js';
import { paperDir, pensmithDataDir } from './paths.js';
```
For tutorial.ts: replace session-log imports with `node:events` + `atomic-write.js` + `paths.js`. No pii.js needed — subscriber receives post-redaction plan metadata only (citekeys, verdicts — no raw user PII).

**In-flight write chain (enqueue pattern)** (`bin/lib/session-log.ts` lines 251-255):
```typescript
let chain: Promise<void> = Promise.resolve();

function enqueue(work: () => Promise<void>): void {
  chain = chain.then(work, work);
}
```
Copy this exact pattern into tutorial.ts for sequential TUTORIAL.md append ordering. The second arg to `.then(work, work)` ensures one rejection never breaks the chain — critical for "teaching annotations stay readable."

**child(bindings) scoped-logger pattern** (`bin/lib/session-log.ts` lines 380-390):
```typescript
child: (b) =>
  makeLogger({
    ...bindings,
    ...(redactKeys(b) as Record<string, unknown>),
  }),
close: async () => {
  await chain;
},
```
The `close(): Promise<void>` / drain pattern: TutorialSubscriber needs the same `flush(): Promise<void>` so CLI verbs can `await subscriber.flush()` before exiting and guarantee TUTORIAL.md is complete.

**Event emit wiring** (`bin/lib/session-log.ts` lines 351-379):
```typescript
function makeLogger(bindings: Record<string, unknown>): SessionLogger {
  function emit(kind: Kind, payload: Record<string, unknown>): void {
    const record = buildRecord(kind, payload, bindings, run_id);
    mirrorIfPrompt(record);
    enqueue(async () => {
      try {
        const line = await writeLineOrTruncate(...);
        await atomicAppendFile(logFile, line);
        await maybeRotate(logFile, maxBytes, maxBackups);
      } catch {
        /* swallow — logger must never throw */
      }
    });
  }
  return {
    event: (p) => emit('event', p),
    // ...
  };
}
```
TutorialSubscriber.emit() must follow the same "never throw" contract: wrap every `atomicAppendFile` call in try/catch, swallow. Errors in tutorial emission must never surface into Foundation orchestrators.

**Kind/type declaration** (`bin/lib/session-log.ts` lines 36-44):
```typescript
export type Kind =
  | 'prompt'
  | 'response'
  | 'tool_call'
  | 'tool_result'
  | 'cost'
  | 'event'
  | 'warn'
  | 'error';
```
Copy pattern for `TutorialEventKind` union type. Use the research-defined set: `'research.done' | 'outline.done' | 'section.written' | 'section.verified' | 'compile.done'`.

---

### `bin/cli/write.ts` (modify — dependency-injection onSectionWritten? seam)

**Analog:** `bin/cli/write.ts` itself (wave-mode `writeSection` callback pattern, lines 199-229) and `bin/cli/intake.ts` (`runStyleProducerNonFatal` optional-arg pattern, lines 144-183).

**Existing wave-mode callback pattern** (`bin/cli/write.ts` lines 203-215):
```typescript
const results = await runAllSections(paperRoot, {
  maxParallel,
  writeSection: async (node: SectionNode) => {
    process.stdout.write(
      JSON.stringify({ event: 'section_start', wave: node.computed_wave, section: node.slug }) + '\n',
    );
    await writeOneSection(node.n, node.slug);
    process.stdout.write(
      JSON.stringify({ event: 'section_done', wave: node.computed_wave, section: node.slug, status: 'done' }) + '\n',
    );
  },
});
```
This is the EXACT seam where the tutorial callback wires in. After `writeOneSection` completes, call `subscriber?.emit(...)` — the `?.` means goal=draft (subscriber=undefined) costs zero branches inside Foundation.

**Non-fatal DI callback activation pattern** (`bin/cli/intake.ts` lines 236-242):
```typescript
const runSideEffects = async (): Promise<void> => {
  const paperId = await resolvePaperId(cwd);
  await registerPaperNonFatal(cwd, paperId, meta);
  if (styleSamples) {
    await runStyleProducerNonFatal(cwd, styleSamples, paperId, meta.name);
  }
};
```
The goal-aware activation block in write.ts follows the same guard pattern:
```typescript
const goal = readGoalFromConfig(cwd);  // 'draft' | 'learning' | 'both'
const subscriber = (goal === 'learning' || goal === 'both')
  ? new TutorialSubscriber({ tutorialPath: path.join(paperDir(paperRoot), 'TUTORIAL.md'), goal })
  : undefined;
```
`subscriber` is `undefined` for goal=draft — the `?.emit()` call in the callback is the zero-branch mechanism. No `if (goal === 'learning')` inside Foundation; no import of tutorial.ts inside write-orchestrator.ts.

**Imports to add** (follow the intake.ts import pattern, lines 19-32):
```typescript
import { TutorialSubscriber } from '../lib/tutorial.js';
import { parse as parseToml } from 'smol-toml';
import { readFileSync, existsSync } from 'node:fs';
```

---

### `bin/lib/write-orchestrator.ts` (modify — additive onSectionWritten? seam)

**Analog:** `bin/lib/write-orchestrator.ts` itself — the `RunAllSectionsOpts.writeSection` injectable callback (lines 57-69).

**Existing injectable seam pattern** (`bin/lib/write-orchestrator.ts` lines 57-69):
```typescript
export interface RunAllSectionsOpts {
  /** Per-wave concurrency cap. Tier 2 forces 1 (with a single WARN). */
  maxParallel: number;
  /** The existing per-section writer, invoked once per non-blocked node. */
  writeSection: (node: SectionNode) => Promise<void>;
  /**
   * Optional slug allow-list. When present, only these sections are written.
   */
  only?: string[];
}
```
Add `onSectionWritten?: SectionWrittenCallback` to this interface. The callback is `optional` (undefined for goal=draft). Foundation never reads `goal` — it just calls `if (onSectionWritten) { onSectionWritten(...) }` after each `writeSection` settles. This is the single permitted branch inside write-orchestrator.ts for tutorial mode.

**Call site after section settles** (`bin/lib/write-orchestrator.ts` lines 161-165 — the `fulfilled` branch):
```typescript
if (r.status === 'fulfilled') {
  node.status = 'done';
  sections.push({ slug: node.slug, n: node.n, status: 'done' });
}
```
Add the `onSectionWritten` call HERE (and only here), after the push:
```typescript
if (r.status === 'fulfilled') {
  node.status = 'done';
  sections.push({ slug: node.slug, n: node.n, status: 'done' });
  if (opts.onSectionWritten) {
    opts.onSectionWritten({ n: node.n, slug: node.slug, planPath: sectionPlan(node.n, node.slug, paperRoot), assignedSources: plan?.assigned_sources ?? [] });
  }
}
```
The `plan` map (line 123: `plans.set(s.slug, plan)`) already has `assigned_sources` from PlanFrontmatterSchema — pass it through the callback payload so TutorialSubscriber can render provenance without re-reading disk.

---

### `bin/cli/intake.ts` (modify — goal field + PII opt-in diff wiring)

**Analog:** `bin/cli/intake.ts` itself — specifically the `styleSamples` opt-in arg wiring (lines 208-229) and the `runSideEffects` pattern (lines 236-242).

**Existing optional-arg pattern** (`bin/cli/intake.ts` lines 208-229):
```typescript
args: {
  // ...
  styleSamples: {
    type: 'string',
    description: 'Opt-in: path to a folder of your writing samples...',
  },
  yolo: {
    type: 'boolean',
    description: 'Skip the approval gate (auto-accept the intake).',
    default: false,
  },
},
async run({ args }) {
  const styleSamples =
    typeof args.styleSamples === 'string' && args.styleSamples.trim()
      ? args.styleSamples.trim()
      : '';
```
Add `goal` arg in the same style:
```typescript
goal: {
  type: 'string',
  description: 'Workflow goal: draft (default), learning, or both.',
  default: 'draft',
},
```

**Pre-LLM PII ordering seam** (`bin/cli/intake.ts` lines 266-275):
```typescript
// Tier-1 path: load the prompt (hash-validated by prompt-loader)
const prompt = loadPrompt('intake-clarifier');
const seed = args.from && existsSync(args.from) ? readFileSync(args.from, 'utf8') : '';
const _interpolated = interpolate(prompt, { seed });
void _interpolated;
await atomicWriteFile(targetPath, TIER2_PLACEHOLDER);
```
The PII block must be inserted BEFORE `loadPrompt('intake-clarifier')` is reached. The `loadPrompt` call is the first LLM-bound operation (D-12 lock). PII redaction is purely synchronous (redactPii + diffPii), so the ordering is structural:
```typescript
// 1. Collect raw answers
// 2. PII redaction (BEFORE loadPrompt — structural ordering guarantee)
if (piiRedactionEnabled) {
  const redacted = redactPii(rawAnswers);
  const diff = diffPii(rawAnswers, redacted);
  if (diff.length > 0) { /* print diff + confirm */ }
  await atomicWriteFile(rawPath, rawAnswers);       // INTAKE.raw.local (gitignored)
  await atomicWriteFile(targetPath, redacted);      // INTAKE.md (redacted)
} else {
  await atomicWriteFile(targetPath, rawAnswers);
}
// 3. ONLY NOW: loadPrompt + LLM call
const prompt = loadPrompt('intake-clarifier');
```

**config.toml write pattern** (`bin/cli/intake.ts` lines 52-72 — `resolvePaperMeta`):
```typescript
const cfg = parseToml(readFileSync(cfgPath, 'utf8')) as {
  project?: { class?: unknown; title?: unknown };
};
```
Read goal from config.toml after the file is written; persist goal using `atomicWriteFile` on config.toml (same atomic-write chokepoint as all other state files). Do NOT use a new STATE.json field — per research assumption A2, config.toml is the canonical store per PRD §10.

---

### `bin/lib/pii.ts` (modify — extend with new patterns + NAME suppression + diffPii)

**Analog:** `bin/lib/pii.ts` itself — extend in-place, never break existing exports.

**Existing pattern structure to extend** (`bin/lib/pii.ts` lines 61-69):
```typescript
const PATTERNS: ReadonlyArray<{ kind: PiiKind; re: RegExp }> = [
  { kind: 'EMAIL', re: RE_EMAIL },
  { kind: 'PHONE', re: RE_PHONE },
  { kind: 'SSN', re: RE_SSN },
  { kind: 'NAME', re: RE_NAME },
  { kind: 'DATE', re: RE_DATE_ISO },
  { kind: 'DATE', re: RE_DATE_US },
  { kind: 'DATE', re: RE_DATE_EU },
];
```
Extend by adding new patterns BEFORE NAME (earlier in PATTERNS array = higher priority in overlap resolution):
```typescript
// IP address — added Phase 9
const RE_IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// IBAN-like (length cap prevents ReDoS — T-01-REDOS-01 still holds)
const RE_IBAN_LIKE = /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g;
```
Extend `PiiKind` union:
```typescript
// bin/lib/pii.ts line 22 — current:
export type PiiKind = 'EMAIL' | 'PHONE' | 'SSN' | 'NAME' | 'DATE';
// Phase 9 addition:
export type PiiKind = 'EMAIL' | 'PHONE' | 'SSN' | 'NAME' | 'DATE' | 'IP' | 'IBAN';
```

**NAME suppression dictionary** — extend classifyPii (lines 76-124) to filter NAME matches whose entire raw string appears in NAME_SUPPRESSION. The two-token rule from research pitfall 6 applies: suppress ONLY if the ENTIRE match is in the set (single-token case), OR the LAST token is NOT a standalone name.

**diffPii — new pure function** following the existing pure-module guarantee (`bin/lib/pii.ts` header comment lines 20-21: "Pure module: NO I/O, NO fs, NO fetch, NO logging"):
```typescript
export interface PiiDiff {
  span: [number, number];
  kind: PiiKind;
  raw: string;
  tag: string;   // e.g. '[REDACTED:EMAIL]'
}

// Pure function: (string, string) => PiiDiff[]. No I/O, no randomness.
// Spans sorted by start position (stable). Idempotent: diffPii(redactPii(s), redactPii(redactPii(s))) === [].
export function diffPii(original: string, redacted: string): PiiDiff[] {
  const spans = classifyPii(original);
  return spans.map((m) => ({
    span: m.span,
    kind: m.kind,
    raw: m.raw,
    tag: `[REDACTED:${m.kind}]`,
  }));
}
```
Uses `classifyPii(original)` — no comparison against `redacted` needed since `classifyPii` is already deterministic. The `redacted` param is accepted for API symmetry but the implementation derives diffs from the original spans. NO `Math.random()`, `Date.now()`, or `randomUUID()` — the diff must be purely positional.

---

### `bin/lib/router.ts` (modify — goal=learning stop-point)

**Analog:** `bin/lib/router.ts` itself — extend `resolveNextAction` after the research-done check (lines 144-146).

**Existing research-done routing** (`bin/lib/router.ts` lines 144-146):
```typescript
if (!existsSync(join(pDir, 'RESEARCH.md'))) return { verb: 'research' };
if (!existsSync(join(pDir, 'OUTLINE.md'))) return { verb: 'outline' };
```
The goal=learning stop-point inserts BETWEEN these two checks — after research exists, before routing to outline:
```typescript
if (!existsSync(join(pDir, 'RESEARCH.md'))) return { verb: 'research' };

// Phase 9 — goal=learning stop-point (AFTER research, BEFORE outline):
// Read goal from config.toml best-effort (never throws — NEVER-THROW invariant).
const goal = readGoalBestEffort(paperRoot);  // helper reads config.toml, returns 'draft' on any error
if (goal === 'learning' && existsSync(join(pDir, 'RESEARCH.md'))) {
  return { verb: 'status', reason: 'done' };  // or new { verb: 'tutorial-done' } terminal
}

if (!existsSync(join(pDir, 'OUTLINE.md'))) return { verb: 'outline' };
```

**NEVER-THROW invariant** (`bin/lib/router.ts` lines 121-127): the outer try/catch backstop already covers the new goal-read helper. The helper must follow the `existsSync` / `try { ... } catch { return 'draft'; }` pattern used throughout the router — no unguarded file reads.

**RouterDecision union extension** (`bin/lib/router.ts` lines 47-61):
```typescript
export type RouterDecision =
  | { verb: 'new' }
  | { verb: 'research' }
  // ...
  | { verb: 'status'; reason: 'done' | 'attention'; section?: ... }
```
If a new `tutorial-done` terminal is added, it must join this union. The simpler option (routing goal=learning to `{ verb: 'status', reason: 'done' }` with a special message) avoids touching the union — prefer if sufficient.

---

### `templates/prompts/tutorial-section-provenance.md` (new — hash-pinned prompt)

**Analog:** Any existing `templates/prompts/*.md` file + `bin/lib/prompt-loader.ts` EXPECTED_PROMPT_HASHES map (lines 91-133).

**Hash-pin registration pattern** (`bin/lib/prompt-loader.ts` lines 97-110):
```typescript
export const EXPECTED_PROMPT_HASHES: Record<string, string> = {
  'intake-clarifier':    'bc93c546f5853196379c8958b1d8895b3cc3d0c2aabef94858e48638e181ba94',
  // ...
  'smoother':            'ee934f8eee89bf239a95bd8b3eebf04f7802eeb39b0cadb8510c5cddc49097f5',
```
Phase 9 must add two new slugs:
```typescript
'tutorial-section-provenance':   '__PENDING_HASH_tutorial-section-provenance__',   // Phase 9 D-12
'tutorial-research-rationale':   '__PENDING_HASH_tutorial-research-rationale__',    // Phase 9 D-12
```
These start as `__PENDING_HASH_<slug>__` sentinels (WN-3 pattern — set `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1` during Waves 1-n). A single re-pin commit in the final wave replaces them with real SHA-256 values simultaneously in `bin/lib/prompt-loader.ts` AND `tests/repo-files.test.ts` (single source of truth, lockstep).

**Frontmatter strip** is automatic via `stripFrontmatter()` in `loadPrompt()` (`bin/lib/prompt-loader.ts` lines 143-151) — prompt files may include a YAML frontmatter block for slug metadata.

---

### `tests/tutorial.test.ts` (new — subscriber activation, emit, TUTORIAL.md contract)

**Analog:** `tests/write-orchestrator.test.ts` (stub callback + wave fixture pattern, lines 1-83) AND `tests/library.test.ts` (env-override tmpdir isolation, lines 25-38).

**Tmpdir isolation pattern** (`tests/library.test.ts` lines 25-38):
```typescript
function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-library-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}
```
Copy verbatim for `mkTutorialRoot()` — env-override prevents the test from touching the real pensmith data dir.

**Stub callback + sink pattern** (`tests/write-orchestrator.test.ts` lines 105-120):
```typescript
const written: string[] = [];
const results = await runAllSections(root, {
  maxParallel: 2,
  writeSection: async (node) => {
    await Promise.resolve();
    written.push(node.slug);
  },
});
const status = statusBySlug(results);
assert.equal(status.get('a'), 'done', 'a must complete');
```
For tutorial tests, replace `written: string[]` with a stub `onSectionWritten` callback that records invocations, then assert both (a) callback was invoked for each section, and (b) TUTORIAL.md content matches expected provenance blocks.

**File content assertion pattern** (after `atomicWriteFile` to tmpdir):
```typescript
const tutorialContent = fs.readFileSync(tutorialPath, 'utf8');
assert.ok(tutorialContent.includes('## Section'), 'TUTORIAL.md must contain section provenance header');
assert.ok(!tutorialContent.includes('.paper/sections/'), 'TUTORIAL.md must not reference section paths');
```

**goal=draft zero-activation assertion** (key invariant test):
```typescript
test('goal=draft: TutorialSubscriber never created, TUTORIAL.md never written', async () => {
  // Activate write with goal=draft (subscriber=undefined)
  // Assert .paper/TUTORIAL.md does NOT exist after write
  assert.ok(!fs.existsSync(tutorialPath), 'TUTORIAL.md must not be written for goal=draft');
});
```

---

### `tests/pii-polish.test.ts` (new — extended PII corpus + diffPii + NAME suppression)

**Analog:** `tests/pii.test.ts` — exact same structure (corpus-driven + property test). Copy the file skeleton.

**Test structure to copy** (`tests/pii.test.ts` lines 1-53):
```typescript
import { classifyPii, redactPii, redactKeys } from '../bin/lib/pii.js';
import { POSITIVES, NEGATIVES, KEY_FIXTURES } from './fixtures/pii-corpus.js';
import * as fc from 'fast-check';

test('classifyPii: every positive fixture finds at least one matching span of the expected kind', () => {
  for (const c of POSITIVES) {
    const matches = classifyPii(c.input);
    const hit = matches.find(m => m.kind === c.kind && m.raw === c.raw);
    assert.ok(hit, `expected to find ${c.kind}=${JSON.stringify(c.raw)} ...`);
  }
});
test('redactPii is idempotent: redactPii(redactPii(s)) === redactPii(s)', () => {
  for (const c of POSITIVES) {
    const once = redactPii(c.input);
    const twice = redactPii(once);
    assert.equal(twice, once);
  }
});
```
For pii-polish.test.ts: import the NEW `diffPii` export and add a `PII_POLISH_POSITIVES` fixture set covering IP, IBAN-like, and NAME suppression cases. Key tests:

1. **diffPii determinism**: `diffPii(x, y)` called twice on same input returns identical output (`assert.deepEqual`).
2. **diffPii idempotence**: `diffPii(redactPii(x), redactPii(redactPii(x))).length === 0` (no spans in already-redacted text).
3. **NAME suppression**: "Results Section" does NOT produce a NAME match; "Jane Smith" DOES produce a NAME match.
4. **Two-token rule**: "In Smith" produces a NAME match (last token "Smith" not in suppression set).
5. **IP positive**: `192.168.1.1` produces `IP` kind.
6. **IBAN-like positive**: `GB29NWBK60161331926819` produces `IBAN` kind.

**Property test to copy** (`tests/pii.test.ts` lines 112-150): extend `piiArb` to include IP addresses and verify no raw IP appears in redacted output.

---

### `tests/intake-pii-ordering.test.ts` (new — pre-LLM ordering gate)

**Analog:** `tests/intake-style-producer.test.ts` — source-grep skip-predicate pattern (lines 37-44).

**Source-grep skip-predicate** (`tests/intake-style-producer.test.ts` lines 37-44):
```typescript
function intakeStyleWired(): boolean {
  const intakePath = repoPath('bin/cli/intake.ts');
  if (!fs.existsSync(intakePath)) return false;
  const src = fs.readFileSync(intakePath, 'utf8');
  return /buildStyleProfile/.test(src) && /style[-_]?[sS]amples/.test(src);
}
const READY = intakeStyleWired();
```
For intake-pii-ordering.test.ts, the wiring predicate checks that `diffPii` AND the `rawPath` / `INTAKE.raw.local` path appear in intake.ts BEFORE `loadPrompt`:
```typescript
function piiOrderingWired(): boolean {
  const src = fs.readFileSync(intakePath, 'utf8');
  const diffPiiIdx = src.indexOf('diffPii');
  const loadPromptIdx = src.indexOf("loadPrompt('intake-clarifier')");
  return diffPiiIdx !== -1 && loadPromptIdx !== -1 && diffPiiIdx < loadPromptIdx;
}
```
This is the structural ordering assertion: the test does NOT run the verb, it asserts the source code ordering is correct (because the LLM call is not available in unit tests). The nock/cassette PII-egress test (for actually verifying no raw PII reaches HTTP) is a separate integration concern.

**INTAKE.raw.local written assertion** (follows `tests/intake-style-producer.test.ts` tmpdir pattern): seed a tmp paper dir, run `intake` with `PENSMITH_NO_LLM=1`, assert both `.paper/INTAKE.md` (redacted) and `.paper/INTAKE.raw.local` (raw) exist and have the correct content.

---

### `tests/lint-tutorial-no-branch.test.ts` (new — zero-if-educator-mode invariant)

**Analog:** `tests/lint-chokepoint.test.ts` — ESLint programmatic grep-style invariant (lines 13-49).

**ESLint programmatic pattern** (`tests/lint-chokepoint.test.ts` lines 13-49):
```typescript
test('lint chokepoints flag both fixture violations', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: {
        'no-restricted-syntax': ['error', {
          selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]',
          message: 'doi chokepoint',
        }],
      },
    }],
  });
  const fixture = path.resolve('tests/fixtures/lint-chokepoint-fixture.ts');
  const results = await eslint.lintFiles([fixture]);
```
For lint-tutorial-no-branch.test.ts, use the same structure but grep Foundation lib files for `educator_mode`, `tutorial`, `learning` strings in bin/lib/* (excluding tutorial.ts itself). The assertion is that ZERO occurrences exist.

Since ESLint `no-restricted-syntax` can match string literals (identifier references are harder), the simpler pattern is a grep-based invariant using `fs.readdirSync` + `readFileSync` on `bin/lib/` directory, excluding `tutorial.ts`:
```typescript
test('zero-branch invariant: no Foundation lib (bin/lib/* except tutorial.ts) references educator_mode or goal===learning', async () => {
  const libDir = path.resolve('bin/lib');
  const files = fs.readdirSync(libDir)
    .filter(f => f.endsWith('.ts') && f !== 'tutorial.ts');
  for (const file of files) {
    const src = fs.readFileSync(path.join(libDir, file), 'utf8');
    assert.ok(
      !/(educator_mode|goal\s*===\s*['"]learning|TutorialSubscriber)/.test(src),
      `${file}: Foundation lib must not reference educator_mode/goal=learning/TutorialSubscriber`,
    );
  }
});
```
This is a grep-style invariant, not an ESLint rule — matches the intent of `tests/lint-chokepoint.test.ts` but uses the simpler filesystem-scan pattern since there's no existing ESLint rule for this.

---

## Shared Patterns

### Atomic Write (D-07 chokepoint)
**Source:** `bin/lib/atomic-write.ts`
**Apply to:** `bin/lib/tutorial.ts` (TUTORIAL.md writes), `bin/cli/intake.ts` (INTAKE.raw.local + INTAKE.md)
```typescript
import { atomicWriteFile, atomicAppendFile } from './atomic-write.js';
// TUTORIAL.md: use atomicAppendFile for sequential append of provenance blocks
// INTAKE.raw.local: use atomicWriteFile (full content, single write)
```
D-07 lint rule bans all other write paths — any direct `fs.writeFile` in tutorial.ts would be a lint error.

### enqueue (sequential async chain)
**Source:** `bin/lib/session-log.ts` lines 251-255
**Apply to:** `bin/lib/tutorial.ts`
```typescript
let chain: Promise<void> = Promise.resolve();
function enqueue(work: () => Promise<void>): void {
  chain = chain.then(work, work);
}
```
Both handlers of `.then(work, work)` are intentional — one rejection never breaks the chain. This guarantees TUTORIAL.md sections appear in emission order even when sections finish asynchronously in wave mode.

### Non-fatal optional side-effect pattern
**Source:** `bin/cli/intake.ts` lines 102-129 (`registerPaperNonFatal`)
**Apply to:** Tutorial subscriber activation in `bin/cli/write.ts`
```typescript
async function runStyleProducerNonFatal(...): Promise<void> {
  try {
    // ... build, check, print notice, write
  } catch (e) {
    process.stderr.write(
      `pensmith new: WARN — style-match producer failed (non-fatal): ${(e as Error).message}\n`,
    );
  }
}
```
Tutorial emission errors must NOT fail the write verb. Wrap subscriber creation in try/catch: if TutorialSubscriber construction throws (e.g., bad tutorialPath), log to stderr and set `subscriber = undefined`.

### loadPrompt hash-pin registration (D-12 WN-3 sentinel)
**Source:** `bin/lib/prompt-loader.ts` lines 91-133
**Apply to:** New tutorial prompt slugs in EXPECTED_PROMPT_HASHES
```typescript
// Add to EXPECTED_PROMPT_HASHES (and matching tests/repo-files.test.ts entry):
'tutorial-section-provenance': '__PENDING_HASH_tutorial-section-provenance__',
'tutorial-research-rationale': '__PENDING_HASH_tutorial-research-rationale__',
```
Set `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1` in CI during Waves 1-n. Re-pin atomically in the final wave (same commit updates both files).

### tmpdir env-override isolation for tests
**Source:** `tests/library.test.ts` lines 25-38
**Apply to:** `tests/tutorial.test.ts`, `tests/intake-pii-ordering.test.ts`
```typescript
function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-library-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}
```
Prevents test from resolving to the real pensmith data directory. Must be called at the start of EVERY test that touches disk.

### RED-by-skip source-grep predicate
**Source:** `tests/intake-style-producer.test.ts` lines 37-44
**Apply to:** `tests/tutorial.test.ts` (skip until tutorial.ts exports TutorialSubscriber), `tests/intake-pii-ordering.test.ts` (skip until diffPii is wired before loadPrompt)
```typescript
const READY = existsSync(fileURLToPath(new URL('../bin/lib/tutorial.ts', import.meta.url)))
  && /TutorialSubscriber/.test(fs.readFileSync(..., 'utf8'));
// Each test: { skip: !READY }
```

---

## No Analog Found

All files have close analogs in the codebase. No "no analog" entries.

---

## Metadata

**Analog search scope:** `bin/lib/`, `bin/cli/`, `tests/`, `templates/prompts/`
**Files scanned:** 15 source files + 10 test files read directly; 100+ file paths inspected via glob
**Pattern extraction date:** 2026-06-20

---

## Critical Invariants for Planner

1. **Zero Foundation branches:** `bin/lib/write-orchestrator.ts` gets ONE permitted branch: `if (opts.onSectionWritten) { ... }`. This is a callback invocation guard, not a goal check. No other Foundation lib gets any tutorial-related branch.

2. **TutorialSubscriber import boundary:** `bin/lib/tutorial.ts` is imported ONLY by `bin/cli/*.ts` files. The ESLint invariant test (`tests/lint-tutorial-no-branch.test.ts`) enforces this.

3. **PII before loadPrompt:** The structural ordering in `bin/cli/intake.ts` — `diffPii`/`redactPii` block appears in source BEFORE the `loadPrompt('intake-clarifier')` call. The ordering test asserts this via source-grep, not runtime instrumentation.

4. **TUTORIAL.md excluded from exports:** `bin/lib/exporter.ts` must explicitly exclude `.paper/TUTORIAL.md` from all export output paths (add to exclusion list). Tests: extend `tests/zero-trace-export.test.ts` to assert TUTORIAL.md content never appears in exported documents.

5. **diffPii is pure:** `(string, string) => PiiDiff[]` with no I/O, no randomness, no Date.now(). Test: `assert.deepEqual(diffPii(x, y), diffPii(x, y))` on same input twice.
