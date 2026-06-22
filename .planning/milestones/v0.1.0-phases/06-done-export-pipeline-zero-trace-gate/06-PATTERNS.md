# Phase 6: Done / Export Pipeline + Zero-Trace Gate — Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 13 new/modified files
**Analogs found:** 13 / 13

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bin/cli/done.ts` | controller (thin orchestrator) | request-response | `bin/cli/compile.ts` | exact |
| `bin/lib/plagiarism.ts` | service | request-response (HTTP) | `bin/lib/verify/freshness.ts` | exact |
| `bin/lib/honesty.ts` | service | request-response (HTTP) | `bin/lib/verify/pass2.ts` | exact |
| `bin/lib/exporter.ts` | service | file-I/O + shellout | `bin/lib/ecosystem-presence.ts` + `bin/lib/atomic-write.ts` | role-match |
| `references/honesty-framing.md` | config (locked copy) | — | `references/http-warnings.md` | exact |
| `workflows/done.md` | config (workflow body stub → full) | — | `workflows/compile.md` | exact |
| `tests/zero-trace-export.test.ts` | test | file-I/O | `tests/cassette-no-leak.test.ts` | exact |
| `tests/plagiarism.test.ts` | test | cassette | `tests/revise-swap.test.ts` | role-match |
| `tests/honesty.test.ts` | test | cassette | `tests/revise-swap.test.ts` | role-match |
| `tests/exporter.test.ts` | test | file-I/O | `tests/compile-refuse.test.ts` | role-match |
| `tests/done-gate.test.ts` | test | unit | `tests/compile-refuse.test.ts` | role-match |
| `tests/done-humanizer-absent.test.ts` | test | unit | `tests/revise-swap.test.ts` | role-match |
| `tests/repo-files.test.ts` (extend) | test (extension) | — | `tests/repo-files.test.ts` itself | exact |

---

## Pattern Assignments

### `bin/cli/done.ts` (controller, request-response)

**Analog:** `bin/cli/compile.ts`

**Imports pattern** (lines 22–30):
```typescript
import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPass4 } from '../lib/verify/pass4.js';
import { paperDir } from '../lib/paths.js';
// Phase-6 additions mirror compile's pattern:
import { runPlagiarism } from '../lib/plagiarism.js';
import { scoreHonesty } from '../lib/honesty.js';
import { exportDraft } from '../lib/exporter.js';
import { isHumanizerSkillPresent } from '../lib/ecosystem-presence.js';
```

**Command definition pattern** (lines 63–83):
```typescript
// bin/cli/compile.ts lines 63-83 — defineCommand with named args incl. --yolo
export const doneCommand = defineCommand({
  meta: {
    name: 'done',
    description: 'Humanize, score, gate, and export the compiled paper.',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip the export confirmation gate.',
      default: false,
    },
    format: {
      type: 'string',
      description: 'Export format: docx | pdf | latex | md (default: docx).',
      default: 'docx',
    },
    raw: {
      type: 'boolean',
      description: 'Skip the humanizer step.',
      default: false,
    },
  },
  async run({ args }) { ... }
});
```

**Thin orchestrator pattern** (lines 84–112):
```typescript
// bin/cli/compile.ts lines 84-112 — 100% delegation to lib; no business logic
async run({ args }) {
  const paperRoot = process.cwd();
  const result = await runDone({
    paperRoot,
    yolo: args.yolo === true,
    format: typeof args.format === 'string' ? args.format : 'docx',
    raw: args.raw === true,
  });
  if (!result.exported) {
    process.stdout.write('pensmith done: export cancelled by user.\n');
    return { ok: false };
  }
  process.stdout.write(`pensmith done: exported ${result.outputPath}\n`);
  return { ok: true, ...result };
}
```

**stdout-only pattern** (line 11):
```typescript
// bin/cli/compile.ts line 11:
// stdout-only (no console.* — keeps a future stdio/MCP frame clean)
```

---

### `bin/lib/plagiarism.ts` (service, request-response)

**Analog:** `bin/lib/verify/freshness.ts`

**Imports pattern** (lines 24–28):
```typescript
// freshness.ts lines 24-28 — http.ts chokepoint, never direct undici
import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteFile } from '../http-mock.js';
// plagiarism.ts adds:
// All HTTP through bin/lib/http.ts — ESLint chokepoint enforced.
```

**Offline-mode guard pattern** (lines 96–102):
```typescript
// freshness.ts lines 96-104 — isOfflineMode() branch before any network call
if (isOfflineMode()) {
  const hit = offlineDdgResult(phrase);
  if (hit === null) {
    debug(`phrase="${phrase}" no DDG cassette — silent`);
  }
  return { phrase, matches: hit ?? [] };
} else {
  // live DDG HTML scrape via httpFetch(... source: 'generic', noCache: true)
}
```

**Advisory-only pattern** (lines 83–84 + function signature):
```typescript
// freshness.ts — never throws, never blocks; returns result array
export async function runPlagiarism(
  draftMd: string,
  opts?: { maxPhrases?: number },
): Promise<PlagiarismResult[]> {
  // ... returns advisory results only; never throws transport errors out
}
```

**Error swallow pattern** (lines 122–128):
```typescript
// freshness.ts lines 122-128 — transport errors are swallowed as noise
try {
  const res = await httpFetch(url, { source: 'generic', noCache: true, ... });
  // parse DDG HTML for result links
} catch (err) {
  debug(`phrase="${phrase}" DDG transport error: ${String(err)} — silent`);
}
```

**Debug helper pattern** (lines 50–54):
```typescript
// freshness.ts lines 50-54
function debug(msg: string): void {
  if (process.env['PENSMITH_DEBUG'] === '1') {
    process.stderr.write(`[plagiarism] ${msg}\n`);
  }
}
```

**Semaphore concurrency pattern** (lines 156–163):
```typescript
// freshness.ts lines 156-163 — Semaphore(5) fan-out cap
import { Semaphore } from '../budget.js';
export async function runPlagiarismAll(phrases: string[]): Promise<PlagiarismResult[]> {
  const sem = new Semaphore(5);
  return Promise.all(phrases.map((p) => sem.withLock(() => queryDdg(p))));
}
```

**Render table pattern** (lines 170–191):
```typescript
// freshness.ts lines 170-191 — renderFreshnessTable for VERIFICATION.md
export function renderPlagiarismSection(results: ReadonlyArray<PlagiarismResult>): string {
  const lines = [
    '## Plagiarism Check (DONE-02)',
    '',
    '| Phrase | Matches |',
    '|--------|---------|',
  ];
  // ...
  return lines.join('\n');
}
```

---

### `bin/lib/honesty.ts` (service, request-response)

**Analog:** `bin/lib/verify/pass2.ts`

**PENSMITH_NO_LLM / key-absence guard pattern** (lines 215–219):
```typescript
// pass2.ts lines 215-219 — the canonical key-absence check
const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
// honesty.ts analog:
const apiKey = process.env['GPTZERO_API_KEY'];
if (!apiKey) {
  process.stdout.write('pensmith: GPTZero API key not set — honesty score skipped.\n');
  return null;
}
```

**Budget gate + api key pattern** (lines 225–232):
```typescript
// pass2.ts lines 225-232 — assertBudget BEFORE any external call
const apiKey = await getProviderApiKey('anthropic');
// honesty.ts uses http.ts with noCache: true; key presence-check is the gate
```

**http.ts POST with noCache pattern** (lines 254–258 pass2 analog; adapted for http.ts):
```typescript
// honesty.ts — GPTZero call through http.ts chokepoint (per RESEARCH pattern)
const resp = await httpFetch('https://api.gptzero.me/v2/predict/text', {
  method: 'POST',
  source: 'generic',
  noCache: true,
  headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
  body: JSON.stringify({ document: text }),
});
```

**Defensive response parse pattern** (lines 162–189):
```typescript
// pass2.ts lines 162-189 — parsePass2Response: UNCLEAR-bias, defensive
function parseHonestyResponse(raw: string): HonestyScore | null {
  try {
    const parsed = JSON.parse(raw) as { documents?: Array<{...}> };
    const doc = parsed.documents?.[0];
    if (!doc) return null;
    return {
      aiProbability: doc.class_probabilities?.ai ?? 0,
      classification: doc.document_classification ?? 'MIXED',
      backend: 'gptzero',
    };
  } catch {
    return null; // unparseable → skip (same UNCLEAR-bias stance)
  }
}
```

**Pluggable backend interface pattern** (pass2.ts HonestyBackend variant):
```typescript
// honesty.ts — strategy pattern; pass2.ts shows how to structure alternatives
export interface HonestyBackend {
  name: string;
  score(text: string): Promise<HonestyScore | null>;
}
```

**LOCKED framing read pattern** (from http.ts lines 96–126):
```typescript
// http.ts lines 96-126 — reads locked string from references/ at module load
// honesty.ts copies EXACTLY this pattern for references/honesty-framing.md:
import { readFileSync, statSync } from 'node:fs';
const FRAMING_FILE = path.join(PKG_ROOT, 'references', 'honesty-framing.md');
function loadFramingString(): string {
  const md = readFileSync(FRAMING_FILE, 'utf8');
  // parse out the note paragraph (same section-parsing approach as http.ts)
  return md;
}
```

---

### `bin/lib/exporter.ts` (service, file-I/O + shellout)

**Analog:** `bin/lib/ecosystem-presence.ts` (for `isPandocPresent` / `execFileSync` pattern) + `bin/lib/atomic-write.ts` (for output write)

**isPandocPresent + execFileSync pattern** (ecosystem-presence.ts lines 33–45):
```typescript
// ecosystem-presence.ts lines 33-45 — execFileSync, never exec (shell injection)
import { execFileSync } from 'node:child_process';
export function isPandocPresent(): boolean {
  try {
    execFileSync('pandoc', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}
```

**Pandoc-absent fallback + stdout banner pattern** (freshness.ts debug / compile.ts stdout pattern):
```typescript
// bin/cli/compile.ts lines 97-100 — process.stdout.write, no console.*
if (!isPandocPresent()) {
  process.stdout.write('pensmith export: Pandoc not found — markdown-only fallback.\n');
  // ... write .md only
  return;
}
```

**execFile async (promisify) pattern** (compile.ts productionReVerify uses child_process):
```typescript
// exporter.ts — async Pandoc shellout; args are an array, never a shell string
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
await execFileAsync('pandoc', [inputPath, '--from', 'markdown', '--to', format,
  '--output', outputPath, '--metadata', 'title=', '--metadata', 'author='],
  { timeout: 60_000 });
```

**Atomic write output pattern** (atomic-write.ts lines 87–153):
```typescript
// atomic-write.ts — atomicWriteFile for the patched DOCX Buffer
import { atomicWriteFile } from './atomic-write.js';
const patched = await zip.generateAsync({ type: 'nodebuffer' });
await atomicWriteFile(docxPath, patched); // Buffer is accepted (string | Buffer)
```

**isHumanizerSkillPresent skip pattern** (ecosystem-presence.ts lines 76–86):
```typescript
// ecosystem-presence.ts lines 76-86 — absent-skill detection
import { isHumanizerSkillPresent } from './ecosystem-presence.js';
if (!isHumanizerSkillPresent()) {
  process.stdout.write(
    'pensmith: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n',
  );
  return null;
}
```

**CITATIONS.bib copy pattern** (bibtex-write.ts line 184):
```typescript
// bibtex-write.ts — atomicWriteFile for .bib; exporter copies it alongside output
import * as fsp from 'node:fs/promises';
const bibSrc = path.join(paperDir(), 'CITATIONS.bib');
const bibDst = path.join(path.dirname(outputPath), 'CITATIONS.bib');
await fsp.copyFile(bibSrc, bibDst);
```

---

### `references/honesty-framing.md` (config, locked copy)

**Analog:** `references/http-warnings.md`

**File structure pattern** (`references/http-warnings.md` lines 1–15):
```markdown
# Honesty Framing Strings (locked — D-XX)

This file is the SINGLE source of truth for GPTZero honesty-score user-facing
framing prose. `bin/lib/honesty.ts` reads these strings at module load.
Drift between the code and this file is a CI failure (hash-pin in
tests/repo-files.test.ts). See CONTRIBUTING.md for the lock rule.

## Output format

> Pensmith honesty check (before humanize): reads as XX% AI-generated (GPTZero).
> Pensmith honesty check (after humanize):  reads as XX% AI-generated (GPTZero).

## Note

> Note: this score reflects prose patterns. The humanizer improves readability;
> it does not promise to make output undetectable.

(One blockquote per line above is the literal string. The leading `> ` is
markdown syntax stripped on read. Do NOT edit the wording without also
updating the SHA-256 pin in tests/repo-files.test.ts.)
```

**CONTRIBUTING.md lock rule pattern** (CONTRIBUTING.md):
```
The honesty-framing.md copy file is LOCKED. Changes require a deliberate
PR update AND a re-pin of the SHA-256 in tests/repo-files.test.ts.
```

---

### `workflows/done.md` (config, workflow body)

**Analog:** `workflows/compile.md`

**File structure pattern** (`workflows/compile.md` lines 1–95):
```markdown
# pensmith done

> Finalize — Pass 4 → plagiarism → humanize → honesty → gate → export.
>
> NON-NEGOTIABLE: no exported doc carries pensmith metadata trace.

<capability_check>
required:
  - Pandoc (for non-md formats)
  - humanizer skill (DONE-03)

degrade_if_missing:
  - if no Pandoc: markdown-only export
  - if no humanizer skill: skip humanize, no 'after' honesty score
  - if no GPTZERO_API_KEY: skip honesty score
</capability_check>

## Overview

## Outputs

## Body

1. **runPass4** on .paper/DRAFT.md ...
2. **runPlagiarism** ...
[etc — mirrors compile.md numbered-step body]
```

---

### `tests/zero-trace-export.test.ts` (test, TEST-10)

**Analog:** `tests/cassette-no-leak.test.ts`

**Test structure + file-walk pattern** (cassette-no-leak.test.ts lines 1–83):
```typescript
// cassette-no-leak.test.ts lines 1-3 header — same threat-model documentation
// lines 16-38 — walkDir helper; re-use or replace with JSZip entry iteration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
```

**Entry iteration + assertion pattern** (cassette-no-leak.test.ts lines 55–83):
```typescript
// cassette-no-leak.test.ts lines 55-83 — iterates all entries, asserts no leaks
test('zero-trace-export: DOCX ZIP entries contain no pensmith trace (DONE-07 / TEST-10)', async () => {
  const buf = await fsp.readFile(FIXTURE_DOCX);
  const zip = await JSZip.loadAsync(buf);
  const violations: string[] = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const text = await file.async('string').catch(() => '');
    if (text.toLowerCase().includes('pensmith')) {
      violations.push(`${name}: contains 'pensmith'`);
    }
    if (name === 'docProps/core.xml') {
      const match = /<dc:creator>([^<]+)<\/dc:creator>/.exec(text);
      if (match && match[1]?.trim()) {
        violations.push(`docProps/core.xml: dc:creator not empty: '${match[1]}'`);
      }
    }
  }
  assert.deepEqual(violations, [], `Zero-trace violations: ${violations.join(', ')}`);
});
```

**SHA-256 hash-pin usage** (repo-files.test.ts lines 143–166):
```typescript
// The fixture .docx itself should be hash-pinned in repo-files.test.ts
// following the exact pattern at lines 143-166 for references/honesty-framing.md:
test('tests/fixtures/sample-zero-trace.docx hash-pin (TEST-10 fixture)', () => {
  const bytes = readFileSync('tests/fixtures/sample-zero-trace.docx');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const PINNED = '__COMPUTE_AT_CREATION__';
  assert.equal(hash, PINNED, `fixture drifted. Update PINNED to ${hash} if intentional.`);
});
```

---

### `tests/plagiarism.test.ts` (test, cassette)

**Analog:** `tests/revise-swap.test.ts`

**Cassette load pattern** (revise-swap.test.ts lines 38–45):
```typescript
// revise-swap.test.ts lines 38-45 — loadCassetteFile + extract body content
import { loadCassetteFile } from '../bin/lib/http-mock.js';
function cassetteContent(basename: string): string {
  const cs = loadCassetteFile('duckduckgo', basename);
  assert.ok(cs && cs[0], `missing cassette duckduckgo/${basename}`);
  // cassette carries the DDG HTML response as a string
  return cs[0].response as string;
}
```

**PENSMITH_NO_LLM guard (applied to offline-only test):**
```typescript
// pass2.ts lines 215-219 / honesty.ts pattern — tests set PENSMITH_NO_LLM=1
// plagiarism tests use isOfflineMode() check in the module; no env var needed
// but tests run with PENSMITH_CASSETTE=1 via http-mock.ts isOfflineMode()
```

**tmp-dir fixture pattern** (compile-refuse.test.ts lines 49–56):
```typescript
// compile-refuse.test.ts lines 49-56 — mkdtempSync fixture root
const root = mkdtempSync(join(tmpdir(), 'pensmith-plagiarism-'));
```

---

### `tests/honesty.test.ts` (test, cassette)

**Analog:** `tests/revise-swap.test.ts`

**Same cassette load pattern** (revise-swap.test.ts lines 38–45):
```typescript
import { loadCassetteFile } from '../bin/lib/http-mock.js';
function gptzeroResponse(basename: string): unknown {
  const cs = loadCassetteFile('gptzero', basename);
  assert.ok(cs && cs[0], `missing cassette gptzero/${basename}`);
  return cs[0].response;
}
```

**Key-absence skip-clean test:**
```typescript
// mirrors pass2.ts PENSMITH_NO_LLM guard pattern (lines 215-219)
test('honesty: absent GPTZERO_API_KEY returns null (skip-clean)', async () => {
  const saved = process.env['GPTZERO_API_KEY'];
  delete process.env['GPTZERO_API_KEY'];
  try {
    const result = await scoreHonesty('some text');
    assert.equal(result, null);
  } finally {
    if (saved !== undefined) process.env['GPTZERO_API_KEY'] = saved;
  }
});
```

---

### `tests/exporter.test.ts` (test, file-I/O)

**Analog:** `tests/compile-refuse.test.ts`

**Pandoc-absent path test pattern** (compile-refuse.test.ts lines 49–56):
```typescript
// compile-refuse.test.ts — fixture root via mkdtempSync; exporter tests do same
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
const root = mkdtempSync(join(tmpdir(), 'pensmith-exporter-'));
mkdirSync(join(root, '.paper'), { recursive: true });
writeFileSync(join(root, '.paper', 'DRAFT.md'), 'test draft content');
writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
// Then call exportDraft with isPandocPresent injected as false
```

**CITATIONS.bib copy assertion:**
```typescript
// Test that CITATIONS.bib lands alongside the exported file
import { existsSync } from 'node:fs';
assert.ok(existsSync(join(outputDir, 'CITATIONS.bib')), 'CITATIONS.bib must be copied');
```

---

### `tests/done-gate.test.ts` (test, unit)

**Analog:** `tests/compile-refuse.test.ts`

**Gate trigger test pattern** (compile-refuse.test.ts refuse-gate):
```typescript
// compile-refuse.test.ts — asserts result.refused on bad verdicts
// done-gate.test.ts asserts the gate fires/skips based on issues
test('done-gate: UNSUPPORTED claim triggers confirmation gate', async () => {
  const result = await runDoneGate({
    pass2Results: [{ verdict: 'UNSUPPORTED', citekey: 'smith2020', ... }],
    pass4Results: [],
    plagiarismResults: [],
    yolo: false,
    approve: async () => false,  // inject: user cancels
  });
  assert.equal(result.exported, false);
});
test('done-gate: --yolo bypasses gate', async () => {
  const result = await runDoneGate({ ..., yolo: true, approve: async () => { throw new Error('should not be called'); } });
  assert.equal(result.gateSkipped, true);
});
```

---

### `tests/done-humanizer-absent.test.ts` (test, unit)

**Analog:** `tests/revise-swap.test.ts` (env-manipulation pattern)

**Env manipulation pattern** (from honesty test above + freshness.ts):
```typescript
// mirrors revise-swap and honesty test env patterns
test('done: humanizer absent → banner written, no crash, export proceeds', async () => {
  // isHumanizerSkillPresent() returns false when ~/.claude/skills/humanizer absent
  // (already false on this machine — test verifies skip-clean behavior)
  const stdoutLines: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string) => { stdoutLines.push(s); return origWrite(s); };
  try {
    // call the done orchestrator with humanizer absent; assert no throw, banner present
    assert.ok(stdoutLines.some(l => l.includes('humanizer skill not found')));
  } finally {
    process.stdout.write = origWrite;
  }
});
```

---

### `tests/repo-files.test.ts` (extension — add honesty-framing.md hash-pin)

**Analog:** `tests/repo-files.test.ts` lines 159–166 (http-warnings.md hash-pin)

**Exact pattern to copy** (repo-files.test.ts lines 159–166):
```typescript
// Extend PENDING_HASH_PINS array OR add a standalone test:
test('references/honesty-framing.md hash-pin (Phase 6 DONE-04 LOCKED)', () => {
  const bytes = readFileSync('references/honesty-framing.md');
  const hash = createHash('sha256').update(bytes).digest('hex');
  // PINNED-HASH below: regenerate with
  // node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/honesty-framing.md')).digest('hex'))"
  const PINNED = '__COMPUTE_AFTER_FILE_IS_WRITTEN__';
  assert.equal(hash, PINNED,
    `references/honesty-framing.md drifted from locked copy. Update PINNED to ${hash} if intentional.`);
});
```

---

## Shared Patterns

### HTTP Chokepoint (ALL new files making network calls)

**Source:** `bin/lib/http.ts` lines 476–575
**Apply to:** `bin/lib/plagiarism.ts`, `bin/lib/honesty.ts`

```typescript
// bin/lib/http.ts lines 476-491 — the only allowed HTTP call site
import { fetch } from './http.js';
// All outbound HTTP must go through this import.
// ESLint no-restricted-imports bans: fetch, undici, node:http, node:https
// anywhere outside bin/lib/http.ts. The lint step catches violations at CI.
export async function fetch(url: string, opts: FetchOptions = {}): Promise<HttpResponse>
// FetchOptions.source: HttpSource = 'generic' for DDG + GPTZero
// FetchOptions.noCache: true for content-sensitive calls (honesty, DDG)
// FetchOptions.method: 'POST' for GPTZero; 'GET' for DDG
```

**API key security pattern** (pass2.ts line 215; runtime.ts getProviderApiKey):
```typescript
// NEVER log the key value. Use presence check only:
const apiKey = process.env['GPTZERO_API_KEY'];
if (!apiKey) return null; // skip-clean
// Value passed to headers only; never reaches session log or cost ledger
```

### Atomic Write (ALL file output)

**Source:** `bin/lib/atomic-write.ts` lines 87–153
**Apply to:** `bin/lib/exporter.ts` (DOCX output after zip patch), `bin/lib/plagiarism.ts` (VERIFICATION.md append)

```typescript
// atomic-write.ts lines 87-90 — signature accepts string | Buffer
export async function atomicWriteFile(
  targetPath: string,
  data: string | Buffer,      // Buffer accepted for DOCX
  opts: AtomicWriteOptions = {},
): Promise<void>
```

### PENSMITH_NO_LLM / Key-Absence Guard (ALL external-call modules)

**Source:** `bin/lib/verify/pass2.ts` lines 215–219
**Apply to:** `bin/lib/honesty.ts`, `bin/lib/plagiarism.ts` (offline guard via `isOfflineMode()`)

```typescript
// pass2.ts lines 215-219
const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
if (noLlm) {
  return pairs.map((p) => pass2Placeholder(p.claimSentence, p.citekey));
}
// honesty.ts uses GPTZERO_API_KEY presence; plagiarism.ts uses isOfflineMode()
```

### Advisory-Never-Throws Pattern (ALL advisory modules)

**Source:** `bin/lib/verify/freshness.ts` lines 83–148
**Apply to:** `bin/lib/plagiarism.ts`, `bin/lib/honesty.ts`

```typescript
// freshness.ts lines 83-86 — advisory function signature + never-throws contract
export async function probeFreshness(
  citekey: string,
  doi: string | null,
): Promise<FreshnessResult> {
  // ... transport errors swallowed as noise; returns result, NEVER throws
}
```

### LOCKED Copy File Pattern (references/honesty-framing.md)

**Source:** `bin/lib/http.ts` lines 96–126 (WARN-once from references/http-warnings.md)
**Apply to:** `bin/lib/honesty.ts` (reads honesty framing from references/honesty-framing.md)

```typescript
// http.ts lines 96-106 — walk-up pkgRoot then read from references/
const WARN_FILE = path.join(PKG_ROOT, 'references', 'http-warnings.md');
function loadWarnString(): string {
  const md = readFileSync(WARN_FILE, 'utf8');
  const lines = md.split(/\r?\n/);
  // parse the section and blockquote line
}
// honesty.ts copies this exactly for references/honesty-framing.md
```

### @clack/prompts Confirm Gate (DONE-09)

**Source:** `bin/lib/prompts/clack.ts` lines 74–79
**Apply to:** `bin/cli/done.ts` (DONE-09 gate)

```typescript
// clack.ts lines 74-79 — confirm is already wired; use through prompts.ts facade
import { askQuestion } from '../prompts.js'; // the Tier-aware facade
// OR use the schema-based confirm question:
const answer = await askQuestion({
  id: 'export-confirm',
  kind: 'confirm',
  label: 'Export the paper?',
  default: true,
});
if (!answer.value) process.exit(0); // abort on cancel
// --yolo: skip this call entirely (args.yolo check before calling askQuestion)
```

### PKG_ROOT Walk-Up Pattern (for references/ path resolution)

**Source:** `bin/lib/http.ts` lines 77–91
**Apply to:** `bin/lib/honesty.ts` (resolving references/honesty-framing.md at any depth)

```typescript
// http.ts lines 77-91 — walk up until package.json found; works both in
// tsx (bin/lib/http.ts) and post-build (dist/bin/lib/http.js)
function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      if (statSync(path.join(cur, 'package.json')).isFile()) return cur;
    } catch { /* continue */ }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return start;
}
const PKG_ROOT = findPkgRoot(__dirname);
```

### execFileSync Presence-Check (not exec — shell injection prevention)

**Source:** `bin/lib/ecosystem-presence.ts` lines 33–45
**Apply to:** `bin/lib/exporter.ts` (isPandocPresent() inline call + Pandoc shellout via execFileAsync)

```typescript
// ecosystem-presence.ts lines 34-44 — execFileSync, NEVER exec
execFileSync('pandoc', ['--version'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  timeout: 5000,
});
// exporter.ts Pandoc invocation: execFileAsync with args as an array (no shell string)
```

### Test Node.js Built-in Runner Pattern

**Source:** `tests/cassette-no-leak.test.ts` lines 17–18 + `tests/compile-refuse.test.ts` lines 24–29
**Apply to:** All new test files

```typescript
// All new test files use the same imports:
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// No mocha, no jest, no vitest — node:test only
```

---

## No Analog Found

All 13 files have analogs. The JSZip-based DOCX ZIP patch inside `bin/lib/exporter.ts` has no existing codebase analog (no ZIP manipulation exists yet) — the planner should use the RESEARCH.md Pattern 1 (zero-trace DOCX ZIP patch, lines 161–226) directly for that function.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `zeroTracePatch()` function inside `exporter.ts` | utility | file-I/O (ZIP) | No ZIP manipulation exists in codebase; use RESEARCH.md Pattern 1 as primary reference |
| `tests/fixtures/cassettes/gptzero/predict-text.json` | fixture | — | New cassette schema; use existing cassettes in `tests/fixtures/cassettes/` as schema reference |
| `tests/fixtures/cassettes/duckduckgo/html-search.json` | fixture | — | New cassette schema; same as above |
| `tests/fixtures/sample-zero-trace.docx` | fixture (binary) | — | No existing .docx fixture; must be generated programmatically using JSZip in a setup script |

---

## Metadata

**Analog search scope:** `bin/cli/`, `bin/lib/`, `bin/lib/verify/`, `tests/`, `references/`, `workflows/`
**Files scanned:** 18 (read in full or targeted sections)
**Pattern extraction date:** 2026-06-18
