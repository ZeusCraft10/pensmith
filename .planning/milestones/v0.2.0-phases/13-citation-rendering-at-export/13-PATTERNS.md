# Phase 13: Citation Rendering at Export - Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 4 (3 modified, 1 extended test)
**Analogs found:** 4 / 4

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bin/lib/exporter.ts` — `buildPandocArgs` extension + `resolveAndRenderCitations` helper | service | request-response + transform | `bin/lib/exporter.ts` existing body (self-modification) | exact |
| `bin/lib/exporter.ts` — `ExportOptions.style` field + bib-copy reorder | service | request-response | `bin/lib/exporter.ts` lines 347-365, 556-578 | exact |
| `bin/cli/done.ts` — discipline→style resolution before `exportDraft` call | controller | request-response | `bin/cli/done.ts` lines 387-462 (existing `run` body) | exact |
| `tests/exporter.test.ts` — REND-01/02/03 assertions | test | transform | `tests/exporter.test.ts` lines 46-135 (existing test body) | exact |

---

## Pattern Assignments

### `bin/lib/exporter.ts` — `ExportOptions` + `buildPandocArgs` extension

**Analog:** `bin/lib/exporter.ts` (self — existing interface + function)

**Existing `ExportOptions` interface** (lines 347-357):
```typescript
export interface ExportOptions {
  /** Absolute (or cwd-relative) path to the source markdown draft. */
  inputPath: string;
  /** Override the export dir; defaults to `<paperDir>/export` (DISTINCT). */
  outputDir?: string;
  format: ExportFormat;
  /** Project root for paperDir() resolution. */
  paperRoot?: string;
  /** Injectable Pandoc-presence flag (deterministic tests); defaults to live probe. */
  pandocPresent?: boolean;
}
```
Phase 13 adds one optional field after `pandocPresent`:
```typescript
  /** CSL style key for citation rendering (e.g. 'apa', 'ieee'). Resolved by
   *  caller via resolveStyleName(discipline). Undefined → defaults to 'apa'. */
  style?: string;
```

**Existing `buildPandocArgs` signature + body** (lines 453-468):
```typescript
function buildPandocArgs(inputPath: string, outputPath: string, format: ExportFormat): string[] {
  const to = format === 'latex' ? 'latex' : format;
  const args = [
    inputPath,
    '--from', 'markdown',
    '--to', to,
    '--output', outputPath,
    '--metadata', 'title=',
    '--metadata', 'author=',
    '--metadata', 'date=',
  ];
  if (format === 'pdf') {
    args.push('--variable', 'pdfcreator=', '--variable', 'pdfproducer=', '--variable', 'pdfauthor=');
  }
  return args;
}
```
Phase 13 changes the signature to accept an optional `citeOpts` bag and appends the three citeproc args AFTER the zero-trace metadata flags:
```typescript
function buildPandocArgs(
  inputPath: string,
  outputPath: string,
  format: ExportFormat,
  citeOpts?: { cslPath: string; bibPath: string },
): string[] {
  // ... existing body unchanged up to the pdf block ...
  if (citeOpts?.cslPath && citeOpts?.bibPath) {
    // --citeproc MUST precede --csl and --bibliography (Pitfall 3).
    args.push('--citeproc', '--csl', citeOpts.cslPath, '--bibliography', citeOpts.bibPath);
  }
  return args;
}
```

**Existing `execFileAsync` call sites that pass `buildPandocArgs`** (lines 505, 538):
```typescript
// latex path (line 505):
await execFileAsync('pandoc', buildPandocArgs(inputPath, outputPath, 'latex'), { timeout: 60_000 });

// docx/pdf path (line 538):
await execFileAsync('pandoc', buildPandocArgs(inputPath, outputPath, format), { timeout: 60_000 });
```
Phase 13 passes `citeOpts` as the fourth argument at both call sites when `opts.style` and the bib are resolvable.

**Existing bib-copy block** (lines 557-565) — this must move BEFORE the Pandoc shellout (Pitfall 4):
```typescript
let bibCopied = false;
const bibSrc = join(paperDir(opts.paperRoot), 'CITATIONS.bib');
const bibDst = join(exportDir, 'CITATIONS.bib');
if (bibSrc !== bibDst && existsSync(bibSrc)) {
  await fsp.copyFile(bibSrc, bibDst);
  bibCopied = true;
}
```
Reorder: move this block to execute before any `execFileAsync('pandoc', ...)` call so `--bibliography bibDst` finds the file. The guard `bibSrc !== bibDst` and `existsSync(bibSrc)` are unchanged.

**Existing imports block** (lines 30-40):
```typescript
import { execFile } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { PDFDocument, PDFName } from 'pdf-lib';
import { atomicWriteFile } from './atomic-write.js';
import { isHumanizerSkillPresent, isPandocPresent } from './ecosystem-presence.js';
import { paperDir } from './paths.js';
```
Phase 13 adds these imports (D-19 chokepoint — import from `./citations.js`, NEVER from `citation-js` directly):
```typescript
import { parseBib, renderStyle, Cite } from './citations.js';
```
Also add `path` for `join(PKG_ROOT, ...)`:
```typescript
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
```
Use the same `findPkgRoot` / `PKG_ROOT` pattern that already exists in `citations.ts` (lines 87-102), copy it verbatim into `exporter.ts` to locate `templates/citation-styles/`.

---

### `bin/lib/exporter.ts` — new `resolveAndRenderCitations` helper

**Analog:** `bin/lib/citations.ts` — `renderStyle` + `parseBib` patterns (lines 189-251)

**Pattern: async helper, empty-input guards, per-key Cite iteration, regex over draft string**

The helper is placed immediately before `buildPandocArgs` in the file. All citation-js API calls go through the `parseBib` / `renderStyle` / `Cite` imports from `./citations.js` — never reaching `citation-js` directly (D-19 chokepoint, Phase-10 Pitfall 2).

Key patterns extracted from citations.ts:

**Empty-input guard pattern** (citations.ts lines 189-206):
```typescript
// parseBib guard: throws on empty/whitespace input.
// resolveAndRenderCitations must guard BEFORE calling parseBib:
if (!bibText.trim()) return md;  // empty bib → pass through unchanged
```

**Per-key `new Cite([entry])` pattern** (from RESEARCH.md, verified by live execution):
```typescript
// DO NOT pass all entries to one Cite — that produces a single combined
// in-text string (Pitfall 1). Iterate one entry at a time:
for (const entry of entries) {
  const id = String((entry as { id?: string }).id ?? '');
  if (!id) continue;
  const cite = new Cite([entry], { forceType: '@csl/object' });
  const formatted = cite
    .format('citation', { format: 'text', template: `pensmith-${style}`, lang: 'en-US' })
    .trim();
  intextMap.set(id, formatted);
}
```
Note: `forceType: '@csl/object'` is the same flag used in `renderStyle` (citations.ts line 245) — copy that pattern.

**Regex over draft string — `[@key]` / `[@key1; @key2]` replacement** (RESEARCH.md Pattern 1):
```typescript
const resolved = md.replace(/\[(@[^\]]+)\]/g, (_match, inner: string) => {
  const keys = inner.split(';').map((k) => k.trim().replace(/^@/, ''));
  if (keys.length === 1) {
    const key = keys[0]!;
    return intextMap.get(key) ?? `[@${key}]`; // unknown key: leave as-is
  }
  const parts = keys.map((k) => (intextMap.get(k) ?? k).replace(/^[(]|[)]$/g, ''));
  return '(' + parts.join('; ') + ')';
});
```

**Bibliography append pattern** — mirror the zero-trace stance: `## References`, never `## Rendered by pensmith`:
```typescript
const bibliography = await renderStyle(entries, style);
if (bibliography.trim()) {
  return resolved + '\n\n## References\n\n' + bibliography;
}
return resolved;
```

**Full helper signature** (no Pandoc dependency — offline):
```typescript
async function resolveAndRenderCitations(
  md: string,
  bibPath: string,
  style: string,
): Promise<string>
```

**Wiring in the md-only fallback** (lines 525-532 — existing `format === 'md' || !pandoc` branch):
```typescript
// existing:
outputPath = join(exportDir, `${stem}.md`);
const md = await fsp.readFile(inputPath, 'utf8');
await writeMarkdown(md, outputPath);

// Phase 13 — replace with:
outputPath = join(exportDir, `${stem}.md`);
let md = await fsp.readFile(inputPath, 'utf8');
if (opts.style && bibCopied) {
  md = await resolveAndRenderCitations(md, bibDst, opts.style);
}
await writeMarkdown(md, outputPath);
```
Note: `bibCopied` and `bibDst` must be declared BEFORE this block (which requires the bib-copy reorder from Pitfall 4).

---

### `bin/cli/done.ts` — discipline→style resolution

**Analog:** `bin/cli/done.ts` lines 387-462 (existing `run` body) + `bin/lib/intake-parse.ts` (existing `parseIntakeMd`)

**Existing imports pattern** (done.ts lines 24-34):
```typescript
import { defineCommand } from 'citty';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// ...existing imports...
import { exportDraft, runHumanizer, type ExportFormat } from '../lib/exporter.js';
import { paperDir } from '../lib/paths.js';
```
Phase 13 adds two imports after the existing ones:
```typescript
import { parseIntakeMd } from '../lib/intake-parse.js';
import { resolveStyleName } from '../lib/citations.js';
```

**Existing `paperDir` + `readFileSync` error-catch pattern** (done.ts lines 388-398):
```typescript
const paperRoot = process.cwd();
const draftPath = join(paperDir(paperRoot), 'DRAFT.md');
let draftMd: string;
try {
  draftMd = readFileSync(draftPath, 'utf8');
} catch {
  process.stdout.write(
    `pensmith done: no compiled draft at ${draftPath} — run 'pensmith compile' first.\n`,
  );
  return { ok: false };
}
```
The discipline-read block follows the same try/catch-and-skip pattern (never throws, falls back to undefined → APA default). Insert before the `exportDraft` call (done.ts line 458):
```typescript
const intakePath = join(paperDir(paperRoot), 'INTAKE.md');
let style: string | undefined;
try {
  const intakeText = readFileSync(intakePath, 'utf8');
  const { discipline } = parseIntakeMd(intakeText);
  style = resolveStyleName(discipline);
} catch {
  // Missing INTAKE.md → fall through; exportDraft defaults to APA.
}
```

**Existing `exportDraft` call** (done.ts lines 458-462):
```typescript
const result = await exportDraft({
  inputPath: finalPath ?? draftPath,
  format,
  paperRoot,
});
```
Phase 13 adds `style` as a new field:
```typescript
const result = await exportDraft({
  inputPath: finalPath ?? draftPath,
  format,
  paperRoot,
  style, // undefined → exportDraft defaults to 'apa'
});
```

**`parseIntakeMd` return shape** (intake-parse.ts lines 22-29):
```typescript
export interface ParsedIntake {
  /** Short topic phrase (1-15 words) suitable for the {{topic}} slot. */
  topic: string;
  /** INTK-03 discipline slug (e.g. 'computer-science', 'other'). */
  discipline: string;
  /** Full assignment context text for the {{assignment}} slot. */
  assignment: string;
}
```
Only `discipline` is needed by Phase 13. Destructure as `const { discipline } = parseIntakeMd(intakeText)`.

---

### `tests/exporter.test.ts` — REND-01/02/03 test additions

**Analog:** `tests/exporter.test.ts` lines 46-135 (existing test body — copy structure exactly)

**Existing `seedPaper` helper** (lines 28-35) — reuse without modification:
```typescript
function seedPaper(slug: string): { root: string; inputPath: string } {
  const root = mkdtempSync(join(tmpdir(), `pensmith-exporter-${slug}-`));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, '# Draft\n\nA clean draft with no identifying trace.\n');
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@article{x2020, title={X}}\n');
  return { root, inputPath };
}
```

**Existing `skip: !existsSync(exporterSrcPath)` guard pattern** (line 47) — copy to ALL new REND tests:
```typescript
test('exporter: ...description...',
  { skip: !existsSync(exporterSrcPath) },
  async () => {
    const mod = await import(exporterModUrl.href) as { exportDraft: ExportDraft };
    // ...
  },
);
```

**Existing `pandocPresent: false` injection pattern** (line 60, 80, 101, 119, 131) — REND-03 uses this to stay offline:
```typescript
const res = await mod.exportDraft({
  inputPath,
  format: 'md',
  paperRoot: root,
  pandocPresent: false,
  style: 'apa',   // Phase 13 addition
});
```

**Known-good fixture paths** (for REND-03 — use the committed fixture, not seedPaper's generic draft):
```typescript
// tests/fixtures/known-good-fixture/section.md contains:
//   # Background
//   Attention mechanisms were popularized by [@vaswani2017attention] as a replacement for recurrence.
//
// tests/fixtures/known-good-fixture/CITATIONS.bib contains:
//   @article{vaswani2017attention, author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki}, ...}

import { fileURLToPath } from 'node:url';
const FIXTURE_DIR = fileURLToPath(new URL('../tests/fixtures/known-good-fixture', import.meta.url));
```
Seed a tmp paper whose `DRAFT.md` is the fixture section content and whose `CITATIONS.bib` is the fixture bib, then call `exportDraft` with `format: 'md', pandocPresent: false, style: 'apa'`.

**REND-03 assertion pattern** (mirrors existing `assert.ok(existsSync(...))` / `assert.ok(...)` style):
```typescript
const rendered = readFileSync(res.outputPath, 'utf8');
assert.ok(!rendered.includes('[@'), 'no raw [@key] tokens must survive in rendered output (REND-01)');
assert.ok(rendered.includes('Vaswani'), 'formatted reference "Vaswani" must appear in output (REND-03)');
assert.ok(rendered.includes('## References'), 'bibliography heading must appear in output (REND-02)');
```

**ExportDraft type extension** (lines 24-26 — update the local interface for the new `style` field):
```typescript
type ExportDraft = (opts: {
  inputPath: string; format: string; paperRoot: string;
  pandocPresent?: boolean; style?: string;
}) => Promise<ExportResult>;
```

---

## Shared Patterns

### D-19 Citation-js Chokepoint
**Source:** `bin/lib/citations.ts` header comment (lines 1-55), eslint.config.js restriction
**Apply to:** `bin/lib/exporter.ts` ONLY — all citation-js imports go through `./citations.js`
```typescript
// CORRECT — the D-19 pattern:
import { parseBib, renderStyle, Cite } from './citations.js';

// FORBIDDEN — never in exporter.ts or any file except citations.ts:
// import Cite from 'citation-js';
// import { plugins } from 'citation-js';
```
The ESLint `no-restricted-imports` rule enforces this. Phase 13 code in `exporter.ts` must only call `parseBib`, `renderStyle`, and the re-exported `Cite` — never `Cite.plugins` or `plugins.config` directly (use `ensureStyleTemplate` via `renderStyle` which calls it internally).

### Memoized Style Template Registration (Pitfall 2)
**Source:** `bin/lib/citations.ts` lines 118-151 (`registeredStyles` Map + `ensureStyleTemplate`)
**Apply to:** `resolveAndRenderCitations` in `exporter.ts`
```typescript
// The per-key loop calls new Cite([entry]).format('citation', { template: `pensmith-${style}`, ... })
// ensureStyleTemplate(style) is called implicitly by renderStyle(entries, style) at the
// bibliography step. BUT for the in-text loop, the template must already be registered
// before the first format('citation') call.
// Solution: call renderStyle([], style) or ensureStyleTemplate directly is not exported.
// Instead, call renderStyle(entries, style) for the bibliography FIRST (it registers the
// template), then do the per-key in-text loop (template already registered).
// OR: call renderStyle with a single-element slice first to prime registration, then loop.
// Simplest: declare the bibliography string before the in-text loop so ensureStyleTemplate
// runs via renderStyle before any format('citation') call.
```

### Never-Throw Advisory Pattern
**Source:** `bin/cli/done.ts` lines 131-137 (catch-and-skip in `runHumanizer`), lines 390-399 (draft read try/catch)
**Apply to:** The INTAKE.md discipline-read block in `done.ts`
```typescript
try {
  // ...read and parse...
} catch {
  // Missing INTAKE.md → fall through; exportDraft defaults to APA.
  // No stdout.write needed — the export still proceeds cleanly.
}
```

### Zero-Trace Non-Regression
**Source:** `bin/lib/exporter.ts` lines 141-338 (`zeroTracePatch`/`zeroTracePdf`) + `tests/zero-trace-export.test.ts`
**Apply to:** `resolveAndRenderCitations` output — the bibliography is plain text author/title content. The helper MUST NOT inject any string containing `pensmith` as a heading or label. Use `## References`, never `## Generated by pensmith` or `## Rendered by pensmith`.
**The zero-trace test (`tests/zero-trace-export.test.ts`) must still pass after Phase 13 changes — do not modify it.**

### PKG_ROOT / CSL Path Resolution
**Source:** `bin/lib/citations.ts` lines 84-102 (`findPkgRoot` + `PKG_ROOT`)
```typescript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
**Apply to:** The CSL path construction in `buildPandocArgs` extension. `exporter.ts` already imports `path` as `{ join }` (line 33) and `existsSync` (line 32). Add `path` (default import), `fileURLToPath`, `statSync` for `PKG_ROOT`. The CSL path is:
```typescript
path.join(PKG_ROOT, 'templates', 'citation-styles', `${style}.csl`)
```
On win32, Pandoc accepts backslash-separated paths via `execFile` (no shell) — no `path.posix` conversion needed (A2, verified by reasoning).

### `execFileAsync` Error-to-Fallback Pattern
**Source:** `bin/lib/exporter.ts` lines 536-554 (the catch block that falls through to md-only):
```typescript
try {
  await execFileAsync('pandoc', buildPandocArgs(inputPath, outputPath, format), { timeout: 60_000 });
  // MANDATORY per-format zero-trace scrub
  if (format === 'docx') await zeroTracePatch(outputPath);
  else await zeroTracePdf(outputPath);
  pandocUsed = true;
} catch {
  // Any Pandoc failure → md-only fallback, never throw
  process.stdout.write(`pensmith export: ${format === 'pdf' ? 'PDF engine' : 'Pandoc'} not available — markdown-only fallback.\n`);
  outputPath = join(exportDir, `${stem}.md`);
  const md = await fsp.readFile(inputPath, 'utf8');
  await writeMarkdown(md, outputPath);
  pandocUsed = false;
}
```
Phase 13 does NOT change this catch block structure. The Pandoc failure path writes raw md; it must also call `resolveAndRenderCitations` if `opts.style` is set (same as the explicit `format === 'md'` path).

---

## No Analog Found

All four files have direct analogs in the existing codebase. No new files are created by Phase 13.

---

## Metadata

**Analog search scope:** `bin/lib/`, `bin/cli/`, `tests/`, `tests/fixtures/known-good-fixture/`
**Files scanned:** citations.ts (305 lines, full), exporter.ts (582 lines, full), done.ts (477 lines, full), intake-parse.ts (140 lines, partial), exporter.test.ts (136 lines, full), zero-trace-export.test.ts (60 lines, partial), fixtures/known-good-fixture/section.md, fixtures/known-good-fixture/CITATIONS.bib
**Pattern extraction date:** 2026-06-24
