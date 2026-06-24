---
phase: 13-citation-rendering-at-export
reviewed: 2026-06-24T00:00:00Z
depth: deep
files_reviewed: 5
files_reviewed_list:
  - bin/lib/citations.ts
  - bin/lib/exporter.ts
  - bin/cli/done.ts
  - tests/exporter.test.ts
  - tests/citation-render.test.ts
findings:
  critical: 2
  warning: 2
  info: 2
  total: 6
status: fixed
---

# Phase 13: Code Review Report

**Reviewed:** 2026-06-24T00:00:00Z
**Depth:** deep
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 13 adds `renderInText`, `resolveAndRenderCitations`, citeproc Pandoc args, bib-copy reorder, and discipline→style resolution in `done.ts`. The D-19 chokepoint is intact (no direct `citation-js` imports outside `citations.ts`). The ordering invariants (bib-copy before Pandoc shellout, `renderStyle` before the in-text loop) are correctly implemented. Zero-trace for `## References` heading is clean. The `exactOptionalPropertyTypes` spread workaround in `done.ts` is the correct idiom.

Two blockers are present: the offline citation rendering path (`resolveAndRenderCitations` at line 672) is not protected by any `try/catch`, meaning a malformed `.bib` or an unknown style key will throw out of `exportDraft` and break the never-throw contract that the md/fallback path carries. The second blocker is that Pandoc locator syntax (`[@key p. 5]`) causes the key-extraction logic to produce `'smith2020 pp. 3-5'` instead of `'smith2020'`, leaving a raw `[@...]` token in offline output and silently violating REND-01 for any paper that uses page locators; this failure mode is invisible to the test suite because the fixture contains no locator citations.

---

## Critical Issues

### CR-01: `resolveAndRenderCitations` throws propagate out of `exportDraft` on the md/offline path — violates never-throw guarantee

**File:** `bin/lib/exporter.ts:671-673`

**Issue:** The md-only branch calls `await resolveAndRenderCitations(md, bibDst, style)` with no surrounding `try/catch`. Two upstream callers inside that function can throw synchronously or asynchronously:

1. `parseBib` (line 511) throws `Error: parseBib: invalid BibTeX — …` on any malformed `.bib`. A CITATIONS.bib with a single bad entry (e.g. a broken TeX accent) is enough.
2. `ensureStyleTemplate` (called via `renderStyle` at line 516 and `renderInText` at line 523) throws `Error: renderStyle: CSL file not found for style '...' at ...` when the style key has no matching `.csl` file. This path is reachable if a future caller passes a custom `opts.style` string that is not in `STYLE_FILENAMES` and the file does not exist.

The `exportDraft` JSDoc and the `done.ts` comment both state that the md fallback "NEVER throws". In the existing code the docx/pdf Pandoc-failure branch (lines 687–699) is correctly wrapped in `catch`, but the equivalent offline citation path (line 672) is not. The same gap exists at line 696 (the Pandoc-error fallback's offline resolution call), though that one sits inside the outer `catch` for the Pandoc shellout, so the throw propagates as if Pandoc failed for a second time — the outer `pandocUsed = false` assignment is reached but `outputPath` is already set and written, so the final `return` carries a stale `outputPath`. This is a secondary inconsistency.

**Fix:**

```typescript
// exporter.ts — lines 667-674 (md-only branch)
outputPath = join(exportDir, `${stem}.md`);
let md = await fsp.readFile(inputPath, 'utf8');
if (style && bibCopied) {
  try {
    md = await resolveAndRenderCitations(md, bibDst, style);
  } catch {
    // Malformed BibTeX or unknown style → skip citation rendering, leave tokens raw.
    // Never-throw guarantee: export proceeds on the unprocessed draft.
    process.stdout.write(
      'pensmith export: citation rendering failed — exporting without inline citations.\n',
    );
  }
}
await writeMarkdown(md, outputPath);
```

Apply the same pattern at line 696 (the Pandoc-failure fallback). In both cases the never-throw contract requires degrading gracefully to the raw markdown rather than propagating the error.

---

### CR-02: Pandoc locator syntax `[@key p. 5]` leaves a raw `[@...]` token in offline output — REND-01 violated for real papers

**File:** `bin/lib/exporter.ts:527-537`

**Issue:** The key-extraction step at line 529:

```typescript
const keys = inner.split(';').map((k) => k.trim().replace(/^@/, ''));
```

strips the leading `@` sigil but does not strip the locator suffix that Pandoc citation syntax allows after the citekey (e.g. `[@smith2020 p. 5]`, `[@jones2019, see also]`, `[@doe2022 pp. 3–7]`). The locator is separated from the citekey by a space (not a semicolon), so `split(';')` yields one element: `['@smith2020 p. 5']`, and after the `replace(/^@/, '')` the key is `'smith2020 p. 5'`. This string does not match `'smith2020'` in `intextMap`, so the single-key fallback fires and returns `[@smith2020 p. 5]` unchanged — including the `[@` prefix that REND-01 checks for. Any real-world paper that cites a specific page range fails REND-01 silently at export time.

The test suite uses only `[@vaswani2017attention]` with no locator, so this failure is invisible in CI.

**Fix:** Strip the locator suffix before the map lookup. The Pandoc spec defines the citekey as the sequence of non-whitespace, non-semicolon characters after `@`:

```typescript
// Replace: k.trim().replace(/^@/, '')
// With: k.trim().replace(/^@/, '').replace(/\s.*$/, '')
//                                   ^^^^^^^^^^^^^^^^^^^
//                                   strip locator suffix (space + anything after)
const keys = inner.split(';').map((k) => k.trim().replace(/^@/, '').replace(/\s.*$/, ''));
```

Add a fixture with a locator citation to `tests/fixtures/known-good-fixture/section.md` (e.g., `[@vaswani2017attention p. 2]`) and assert it does not survive in rendered output.

---

## Warnings

### WR-01: Multi-cite with an unknown key silently emits the bare citekey as if it were a named citation

**File:** `bin/lib/exporter.ts:534-536`

**Issue:** The single-key unknown-key path correctly preserves the raw `[@key]` token as a visible signal that resolution failed:

```typescript
return intextMap.get(key) ?? `[@${key}]`;  // unknown key: leave as-is
```

The multi-key path does not apply the same logic. For an unknown key in a multi-cite group, the fallback is `?? k` (the bare citekey string), which strips the `@` sigil and the brackets:

```typescript
const parts = keys.map((k) => (intextMap.get(k) ?? k).replace(/^[(]|[)]$/g, ''));
return '(' + parts.join('; ') + ')';
```

So `[@valid; @unknown]` produces `(Author, 2021; unknown)`. The bare word `unknown` looks like a surname in the final document, silently misrepresenting an unresolved citation as a resolved one. The REND-01 test passes because `'[@'` is not present, but the output is factually wrong.

**Fix:**

```typescript
const parts = keys.map((k) => {
  const hit = intextMap.get(k);
  if (!hit) return `[@${k}]`; // preserve the unresolved signal
  return hit.replace(/^[(]|[)]$/g, '');
});
return '(' + parts.join('; ') + ')';
```

---

### WR-02: `ExportOptions.style` JSDoc contains a contradictory, misleading claim about the undefined-style default

**File:** `bin/lib/exporter.ts:383-386`

**Issue:** The JSDoc for `style?` reads:

> Undefined → defaults to 'apa' when the offline rendering path runs. When absent, citation rendering is skipped (back-compat: existing callers without style pass through).

These two sentences contradict each other. The code at line 627–632 implements the second sentence: when `opts.style` is `undefined`, `style` is `undefined`, the guard `if (style && bibCopied)` is false, and citation rendering is entirely skipped. There is no APA default. The comment in `done.ts` at line 462 repeats the same incorrect claim ("exportDraft defaults to APA").

A caller who reads the first sentence and omits `style` will expect APA rendering; they will get no rendering at all. This is a contract violation in documentation that will mislead future callers of `exportDraft`.

**Fix:** Remove the first contradictory sentence. The correct description is:

```typescript
/** CSL style key for citation rendering (e.g. 'apa', 'ieee'). Resolved by
 *  caller via resolveStyleName(discipline). When absent, citation rendering
 *  is skipped entirely (back-compat: existing callers without style pass through
 *  unchanged). */
style?: string;
```

Update the corresponding comment in `done.ts` at line 462 to read: "… leaves style undefined; citation rendering is skipped."

---

## Info

### IN-01: `findPkgRoot` / `PKG_ROOT` is duplicated verbatim between `exporter.ts` and `citations.ts`

**File:** `bin/lib/exporter.ts:50-65` and `bin/lib/citations.ts:103-118`

**Issue:** The `findPkgRoot` function and the `PKG_ROOT` constant are character-for-character identical in both files. The duplication is functionally harmless today because both files live at the same depth (`bin/lib/`) so they walk to the same root. If either file is moved or the walk limit (8) is changed in one copy only, the two copies diverge silently.

**Fix:** Extract to `bin/lib/pkg-root.ts`:

```typescript
// bin/lib/pkg-root.ts
import { statSync } from 'node:fs';
import path from 'node:path';
export function findPkgRoot(start: string): string { … }
```

Then in both consumers: `import { findPkgRoot } from './pkg-root.js'`.

---

### IN-02: `cslPath` truthiness check in `citeOpts` construction is dead code; missing `existsSync` guard is the real intended check

**File:** `bin/lib/exporter.ts:628-632`

**Issue:** The ternary condition `style && bibCopied && cslPath` includes `&& cslPath` as if an empty string were possible. `cslPath` is assigned via `path.join(PKG_ROOT, ...)`, which always returns a non-empty string when `style` is truthy. The `&& cslPath` sub-expression never filters anything.

Meanwhile the analogous guard for the bib file (line 620) correctly uses `existsSync(bibSrc)`. There is no `existsSync(cslPath)` check before building `citeOpts`. If a non-standard style name is provided (e.g. via direct API call), `citeOpts` is constructed with a non-existent `cslPath` and passed to Pandoc, which then fails. The failure is caught by the outer `try/catch` and degrades to the md path, so behavior is ultimately correct — but the pattern is asymmetric with the bib guard and harder to audit.

**Fix:** Replace the dead `&& cslPath` with the intended existence check:

```typescript
const citeOpts =
  style && bibCopied && existsSync(cslPath)
    ? { cslPath, bibPath: bibDst }
    : undefined;
```

This makes the guard symmetric with the bib guard (line 620) and avoids a predictable Pandoc failure for callers who supply a nonstandard style key.

---

_Reviewed: 2026-06-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
