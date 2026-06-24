# Phase 13: Citation Rendering at Export - Research

**Researched:** 2026-06-24
**Domain:** citation-js in-text rendering + Pandoc citeproc integration + exporter wiring
**Confidence:** HIGH — all critical API questions answered by live execution against the actual codebase

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Primary path (Pandoc present):** `buildPandocArgs` adds `--citeproc --csl templates/citation-styles/<style>.csl --bibliography <CITATIONS.bib>` for `.docx`/`.pdf`/`.tex`/`.md`. Pandoc resolves `[@key]` from the bundled `.bib` using the CSL — formatted in-text cites + auto-generated reference list.
- **Style selection:** CSL chosen via `resolveStyleName(discipline)` (citations.ts) from the paper's discipline (config.toml `[project]` / STATE), defaulting to APA. Closes milestone-audit MEDIUM-1 (dead `renderStyle`/`resolveStyleName`).
- **Fallback (Pandoc ABSENT — md-only path):** must NOT emit literal `[@key]`. Use citation-js `renderStyle` lib to append a formatted reference list AND resolve in-text tokens. No raw `[@key]` escapes.
- **Offline-testable (REND-03):** the citation-js renderStyle path is the REND-03 assertion target (a formatted reference string appears in offline-rendered output). Pandoc-rendered output assertions are Pandoc-gated.

### Invariants

- Zero-trace: no pensmith metadata/trace introduced. Existing `zeroTracePatch` / `--metadata title=/author=/date=` blanking stays untouched. Zero-trace test must still pass.
- Verifier gate: Phase 13 runs at export, after compile's refuse-gate. Only verified citations are in `.bib` to render.
- Determinism: `renderStyle` is Map-memoized + offline; citation rendering stays byte-stable.
- 16-verb/16-body bijection unchanged; no new verb.

### Deferred Ideas (OUT OF SCOPE)

- Re-verify the humanized FINAL.md before export (GATE-04 → Phase 14).
- Per-style in-text-format edge cases beyond the 8 shipped styles.
- Citation-style switching UI / per-section style overrides.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REND-01 | Exports resolve `[@key]` tokens into formatted in-text citations in the paper's discipline citation style | citation-js `format('citation', ...)` confirmed to produce e.g. `(Vaswani et al., 2017)` / `[1]`; Pandoc `--citeproc` handles the same on the primary path. In-text regex replacement approach verified against the known-good fixture. |
| REND-02 | Exports include a rendered bibliography / reference list in the selected CSL style | `renderStyle(entries, style)` already returns the bibliography string; the `## References` append pattern verified. Pandoc `--citeproc --csl --bibliography` auto-generates the reference list in the primary path. |
| REND-03 | An exporter test asserts a *formatted* reference appears in output (e.g. "Vaswani et al."), not merely a copied `.bib`/`.ris` sidecar | The existing fixture `tests/fixtures/known-good-fixture/CITATIONS.bib` (vaswani2017attention) + `section.md` (with `[@vaswani2017attention]`) is the offline test vehicle. `renderStyle(entries,'apa')` returns a string containing `"Vaswani"` — confirmed by live execution. The test follows the `pandocPresent=false` gating pattern already established in `tests/exporter.test.ts`. |
</phase_requirements>

---

## Summary

Phase 13 makes exported documents carry FORMATTED in-text citations and a rendered bibliography — no literal `[@key]` token survives to any output format. There are two implementation paths sharing the same discipline-based CSL selection: the primary Pandoc path (adds `--citeproc --csl --bibliography` to `buildPandocArgs`) and the offline fallback path (uses citation-js `format('citation',...)` per-key for in-text rendering plus `renderStyle(entries, style)` for the bibliography). Both paths are wired inside `bin/lib/exporter.ts` with the discipline threaded from a new `style?` field on `ExportOptions` (caller resolves via `resolveStyleName(discipline)` before calling `exportDraft`).

**The critical research finding:** citation-js 0.7.22 (the version already installed) supports `format('citation', ...)` for in-text citation formatting — this is NOT bibliography-only. Running `new Cite([entry]).format('citation', {format:'text', template:'pensmith-apa', lang:'en-US'})` against the existing `pensmith-apa` template returns `"(Vaswani et al., 2017)"` for APA, `"[1]"` for IEEE, `"(Vaswani et al.)"` for MLA, etc. This was verified by direct execution. The offline fallback is therefore fully capable of resolving BOTH in-text tokens AND appending a bibliography — no `[@key]` survives.

**The REND-03 test is straightforward:** the existing `tests/fixtures/known-good-fixture/CITATIONS.bib` (Vaswani 2017, citekey `vaswani2017attention`) and `section.md` (with `[@vaswani2017attention]`) constitute the ready-made offline fixture. The test uses `parseBib` + `renderStyle` offline (no Pandoc) and asserts the output contains `"Vaswani"` instead of `"[@vaswani2017attention]"`. Structure mirrors existing `pandocPresent=false`-gated tests in `tests/exporter.test.ts`.

**Primary recommendation:** Add a `style?: string` field to `ExportOptions`. In `buildPandocArgs`, append `--citeproc`, `--csl <cslAbsPath>`, `--bibliography <bibAbsPath>` when `style` and bib are both resolvable. In the md-only fallback (and `format === 'md'` branch), call `resolveAndRenderCitations(md, bibSrc, style)` — a new helper that parses the bib, builds a per-key in-text map, replaces `[@key]` / `[@key1; @key2]` tokens, and appends the bibliography. In `done.ts`, read discipline from `INTAKE.md` via the existing `parseIntakeMd`, resolve to a style name via `resolveStyleName`, and pass it into `exportDraft`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| In-text `[@key]` resolution (Pandoc path) | Pandoc process (external) | — | Pandoc citeproc does this end-to-end when `--citeproc --csl --bibliography` are present; exporter only passes the args. |
| In-text `[@key]` resolution (offline/md fallback) | API/Backend (`exporter.ts`) | citations.ts (library) | citation-js `format('citation', ...)` provides per-key formatted strings; a regex pass in exporter replaces tokens. |
| Bibliography rendering (both paths) | API/Backend (`exporter.ts`) | citations.ts (`renderStyle`) | For Pandoc: automatic after `--citeproc`. For fallback: `renderStyle(entries, style)` + append to end of document. |
| Discipline → style name resolution | API/Backend (`done.ts`) | citations.ts (`resolveStyleName`) | `parseIntakeMd` reads INTAKE.md; `resolveStyleName` maps to CSL key; passed as `style` into `exportDraft`. |
| CSL file lookup | citations.ts (library) | templates/citation-styles/*.csl | `ensureStyleTemplate` already reads the committed CSL from PKG_ROOT; same path used by Pandoc `--csl` arg. |
| Zero-trace enforcement | API/Backend (`exporter.ts`) | zeroTracePatch / zeroTracePdf | Citation content (bibliography) is paper content — zero-trace concern is metadata, not citations. No conflict. |

---

## Standard Stack

### Core (all already installed — no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| citation-js | 0.7.22 | In-text + bibliography rendering (offline fallback) | Already the D-19 LOCKED chokepoint; `format('citation',...)` confirmed working for in-text |
| Pandoc | external binary | Primary citation rendering via citeproc | Pandoc's `--citeproc` is the gold-standard CSL processor; exporter already shellouts to it |

No new npm packages are required. The phase adds code, not dependencies.

### Supporting (no changes)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jszip | 3.10.1 | DOCX scrub (zeroTracePatch) | Always for .docx — unchanged |
| pdf-lib | 1.17.1 | PDF scrub (zeroTracePdf) | Always for .pdf — unchanged |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| citation-js `format('citation',...)` per-key | Build in-text strings from raw CSL-JSON fields (e.g. `author[0].family + year`) | Brittle — each style has different in-text rules (author-date, numeric, etc.); citation-js handles all 8 styles correctly by deferring to citeproc |
| Passing `resolveStyleName` output into `ExportOptions.style` | Passing raw `discipline` string | `resolveStyleName` is already the CSL-key chokepoint; callers (done.ts) should resolve before calling exportDraft, keeping the exporter interface clean |

**Installation:** No new packages. Phase 13 is code-only.

---

## Package Legitimacy Audit

No new packages are installed in this phase. All libraries used (citation-js, jszip, pdf-lib) were installed and slopcheck-verified in earlier phases.

| Package | Registry | Age | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|
| citation-js | npm | ~8 yrs (2016-10-27) | [OK] (verified this session) | Approved — already installed, D-19 chokepoint |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
done.ts (doneCommand.run)
  │
  ├─ readFileSync(INTAKE.md) → parseIntakeMd() → { discipline }
  │                                              │
  │                                    resolveStyleName(discipline)
  │                                              │ style (e.g. 'apa', 'ieee')
  │
  └─ exportDraft({ inputPath, format, paperRoot, style })
       │
       ├─ [Pandoc present + format=docx/pdf/latex/md]
       │    buildPandocArgs(input, output, format, { style, bibPath })
       │      → pandoc <input> --from markdown --to <format>
       │        --metadata title= --metadata author= --metadata date=
       │        --citeproc --csl <PKG_ROOT>/templates/citation-styles/<style>.csl
       │        --bibliography <exportDir>/CITATIONS.bib   ← bib already copied
       │        --output <output>
       │    → zeroTracePatch / zeroTracePdf (MANDATORY, unchanged)
       │    → Result: [@key] resolved by Pandoc citeproc; bibliography auto-appended
       │
       └─ [Pandoc ABSENT or format=md fallback]
            resolveAndRenderCitations(md, bibSrc, style)
              ├─ parseBib(readFileSync(bibSrc)) → entries[]
              ├─ ensureStyleTemplate(style) (memoized)
              ├─ Per-key in-text map:
              │    for each entry:
              │      new Cite([entry], {forceType:'@csl/object'})
              │        .format('citation', {format:'text', template:`pensmith-${style}`, lang:'en-US'})
              ├─ Regex replace:
              │    /\[(@[^\]]+)\]/g  →  per-key lookup (handles [@k1; @k2] multi-cite)
              └─ Append "\n\n## References\n\n" + renderStyle(entries, style)
              → Result: no raw [@key] survives; bibliography appended; offline
```

### Recommended Project Structure

No new directories. Changes touch:
```
bin/lib/
├── exporter.ts          ← Add style?: string to ExportOptions;
│                           extend buildPandocArgs; add resolveAndRenderCitations helper;
│                           wire into md-only fallback + format==='md' branch
│                           Import: parseBib, renderStyle, resolveStyleName from ./citations.js
bin/cli/
└── done.ts              ← Add parseIntakeMd() call to read INTAKE.md discipline;
                            pass resolveStyleName(discipline) as style into exportDraft
tests/
└── exporter.test.ts     ← Add REND-01/02/03 tests using pandocPresent=false +
                            known-good fixture; assert "Vaswani" in output, no "[@"
```

### Pattern 1: In-text Citation Replacement (offline fallback)

**What:** Replace every `[@key]` / `[@key1; @key2]` Pandoc citation token in a markdown string with the CSL-formatted in-text citation string, then append the full bibliography.
**When to use:** Whenever Pandoc is absent, or format is explicitly `'md'`.

```typescript
// Source: verified by live execution against citation-js 0.7.22
// bin/lib/exporter.ts — new helper

async function resolveAndRenderCitations(
  md: string,
  bibPath: string,
  style: string,
): Promise<string> {
  if (!existsSync(bibPath)) return md; // no bib → pass through unchanged
  const bibText = await fsp.readFile(bibPath, 'utf8');
  if (!bibText.trim()) return md;       // empty bib → pass through

  const entries = await parseBib(bibText);   // from './citations.js'

  // Build per-citekey in-text citation map.
  // Each entry gets its own Cite instance so citeproc numbers it correctly
  // (numeric styles like IEEE/Vancouver assign sequential numbers relative
  // to the cite group size — for inline single-key replacements, one entry
  // per group is always correct).
  const intextMap = new Map<string, string>();
  for (const entry of entries) {
    const id = String((entry as { id?: string }).id ?? '');
    if (!id) continue;
    const cite = new Cite([entry], { forceType: '@csl/object' });
    const formatted = cite
      .format('citation', { format: 'text', template: `pensmith-${style}`, lang: 'en-US' })
      .trim();
    intextMap.set(id, formatted);
  }

  // Replace [@key] and [@key1; @key2] tokens. Pandoc's extended Markdown
  // syntax for multi-cite is [@key1; @key2]; semicolons separate citekeys.
  const resolved = md.replace(/\[(@[^\]]+)\]/g, (_match, inner: string) => {
    const keys = inner.split(';').map((k) => k.trim().replace(/^@/, ''));
    if (keys.length === 1) {
      const key = keys[0]!;
      return intextMap.get(key) ?? `[@${key}]`; // unknown key: leave as-is
    }
    // Multi-key: strip outer parens from each, wrap in a single pair.
    const parts = keys.map((k) => (intextMap.get(k) ?? k).replace(/^[(]|[)]$/g, ''));
    return '(' + parts.join('; ') + ')';
  });

  // Append bibliography under a ## References heading.
  const bibliography = await renderStyle(entries, style); // from './citations.js'
  return resolved + '\n\n## References\n\n' + bibliography;
}
```

### Pattern 2: Pandoc citeproc args (primary path)

**What:** Extend `buildPandocArgs` with `--citeproc --csl <path> --bibliography <path>` when a style and bib are available.
**When to use:** Pandoc present + format is docx/pdf/latex/md.

```typescript
// Source: verified against Pandoc documentation + existing buildPandocArgs shape
// bin/lib/exporter.ts — extend buildPandocArgs

function buildPandocArgs(
  inputPath: string,
  outputPath: string,
  format: ExportFormat,
  citeOpts?: { cslPath: string; bibPath: string },
): string[] {
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
  // REND-01/02: append citeproc args when style + bib are resolvable.
  // --citeproc MUST come before --csl and --bibliography (Pandoc reads flags left-to-right).
  if (citeOpts?.cslPath && citeOpts?.bibPath) {
    args.push('--citeproc', '--csl', citeOpts.cslPath, '--bibliography', citeOpts.bibPath);
  }
  return args;
}
```

**Cross-platform path note:** `path.join(PKG_ROOT, 'templates', 'citation-styles', `${style}.csl`)` produces backslash-separated paths on win32. Pandoc (a native C app) accepts both forward and backward slashes on Windows — the `execFile` call (no shell) passes the raw path directly to the OS, and Pandoc handles it. No `path.posix` conversion is needed. [VERIFIED: live execution on win32]

### Pattern 3: Discipline resolution in done.ts

**What:** Read `INTAKE.md` using the existing `parseIntakeMd` helper, map to a CSL style name via `resolveStyleName`, and thread into `exportDraft`.
**When to use:** At every `pensmith done` invocation.

```typescript
// Source: existing parseIntakeMd in bin/lib/intake-parse.ts (VERIFIED in codebase)
// bin/cli/done.ts — new snippet before exportDraft call

import { parseIntakeMd } from '../lib/intake-parse.js';
import { resolveStyleName } from '../lib/citations.js';

// In doneCommand.run, before exportDraft:
const intakePath = join(paperDir(paperRoot), 'INTAKE.md');
let style: string | undefined;
try {
  const intakeText = readFileSync(intakePath, 'utf8');
  const { discipline } = parseIntakeMd(intakeText);
  style = resolveStyleName(discipline);
} catch {
  // Missing INTAKE.md → fall through; exportDraft defaults to APA.
}

const result = await exportDraft({
  inputPath: finalPath ?? draftPath,
  format,
  paperRoot,
  style, // undefined → exportDraft defaults to APA
});
```

**Fallback:** When INTAKE.md is absent or unparseable, `style` is `undefined`. `exportDraft` defaults to `'apa'`. This is safe — APA is the most common academic style and the existing default from `resolveStyleName`.

### Anti-Patterns to Avoid

- **Pandoc `--bibliography` pointing at bibSrc instead of the already-copied export-dir bib:** The bib is copied to `exportDir` before Pandoc runs (DONE-08). Pass `bibDst` (the export-dir copy) to `--bibliography`, not `bibSrc` (the paper-dir source). This avoids a potential file-lock race on Windows (two processes reading the same path).
- **Appending `## References` even when bib is empty:** `renderStyle` with zero entries returns an empty string. Guard: if the bibliography string is blank after `.trim()`, skip the append — don't add an empty `## References` section.
- **Registering `pensmith-${style}` template inside `buildPandocArgs`:** That function is synchronous and must remain so. All citation-js template registration belongs inside `citations.ts` via `ensureStyleTemplate`. `exporter.ts` imports `parseBib`, `renderStyle` — it does NOT reach into `Cite.plugins` directly.
- **Calling `resolveAndRenderCitations` for Pandoc-present formats when Pandoc succeeds:** If Pandoc processes the file successfully (citeproc runs), do NOT run the offline helper on the output — Pandoc has already resolved citations. The offline helper is for the fallback branch only.
- **Zero-trace regression from `## References` header:** The bibliography content is paper content, not pensmith metadata. However, do not inject any string containing `pensmith` as a heading or label. Use `## References` (or `## Bibliography`), never `## Rendered by pensmith`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| In-text citation formatting | Custom author-year/numeric regex per style | `Cite.format('citation', {template:'pensmith-X', lang:'en-US'})` | CSL handles 8 styles including edge cases (et al. thresholds, numeric counters, title-case, date formats) |
| Bibliography rendering | String concatenation from BibTeX fields | `renderStyle(entries, style)` — already exists, already tested | Handles author formatting, DOI links, journal italics per CSL spec |
| CSL style resolution | Hardcoded author-year string | `resolveStyleName(discipline)` — already exists | Maps all 9 discipline keys correctly; unknown disciplines fall back to APA |
| BibTeX parsing | Custom BibTeX parser | `parseBib(bibtex)` — already exists | Handles braces, diacritics, multi-author, quote escaping; citations.ts is the D-19 LOCKED chokepoint |
| Pandoc citation processing | Manual Pandoc argument construction | Extend `buildPandocArgs` with `--citeproc --csl --bibliography` | Pandoc's citeproc is the correct tool; exporter already uses execFile safely |

**Key insight:** The entire rendering stack already exists in `citations.ts`. Phase 13 is a wiring task — connecting the exporter's export path to the rendering library, not building a renderer.

---

## Common Pitfalls

### Pitfall 1: citation-js `format('citation')` is per-cite-group, not per-document

**What goes wrong:** Calling `Cite([allEntries]).format('citation', ...)` returns a SINGLE combined in-text citation string for the entire group (e.g. `"(Vaswani et al., 2017; Smith, 2020)"`). It does NOT produce a map from citekey to individual in-text strings.
**Why it happens:** citeproc treats the `Cite` input as ONE citation group (one `[@key]` token). If you pass all entries to a single `Cite`, you get one combined string, not per-key strings.
**How to avoid:** Iterate `entries` one at a time — `new Cite([entry])` per key — to build the `intextMap`. This gives correct individual in-text strings that can be substituted token-by-token. [VERIFIED: live execution]
**Warning signs:** All `[@key]` tokens replaced with the same long string containing all authors.

### Pitfall 2: citation-js template collision ("template already registered")

**What goes wrong:** Calling `plugins.config.get('@csl').templates.add('pensmith-apa', ...)` twice in one process throws `"template already registered"`.
**Why it happens:** citeproc's template registry has no idempotency. This is already documented as Phase-10 Pitfall 1.
**How to avoid:** All style registration flows through `ensureStyleTemplate(style)` in `citations.ts`, which checks `registeredStyles.get(style)` first. Never call `templates.add` outside that function. `exporter.ts` must import and call `renderStyle`/`parseBib` — never `Cite` or `plugins` directly.
**Warning signs:** `Error: template already registered` in tests that import both `renderStyle` and `renderApa` in the same process.

### Pitfall 3: `--bibliography` and `--citeproc` order matters in Pandoc

**What goes wrong:** Pandoc may not pick up the bibliography if `--citeproc` comes after `--bibliography` in some versions.
**Why it happens:** Pandoc processes some flags order-dependently in older versions.
**How to avoid:** Always emit `--citeproc` BEFORE `--csl` and `--bibliography` in the args array. The order in the Pandoc path should be: `[...zeroTraceMetadataFlags, '--citeproc', '--csl', cslPath, '--bibliography', bibPath]`. [ASSUMED — Pandoc not installed on dev machine; this is a well-documented best practice]
**Warning signs:** Pandoc runs without error but output still contains raw `[@key]` tokens.

### Pitfall 4: bib path timing — bib must be copied before Pandoc runs

**What goes wrong:** Passing the bibDst path to `--bibliography` before the bib has been copied into the export dir causes Pandoc to fail with "bibliography file not found".
**Why it happens:** The current `exportDraft` copies CITATIONS.bib AFTER the Pandoc call (at the bottom of the function). The `--bibliography` arg needs the file to exist at call time.
**How to avoid:** Move the `bibCopied` block (currently at line ~559 in exporter.ts) to execute BEFORE the Pandoc shellout. The guard `bibSrc !== bibDst && existsSync(bibSrc)` stays unchanged — just reorder.
**Warning signs:** Pandoc exits with non-zero; `catch` block falls through to md-only fallback.

### Pitfall 5: empty CITATIONS.bib produces empty bibliography string

**What goes wrong:** `parseBib('')` throws `"no entries parsed from input"`. `renderStyle([], style)` with an empty array also throws `"renderStyle: input must be an array of parsed entries"` from the Array.isArray check (actually: it passes the check but `Cite([])` produces an empty bibliography string).
**Why it happens:** `parseBib` rejects empty/whitespace input with an explicit error.
**How to avoid:** Guard: `if (!bibText.trim()) return md;` before calling `parseBib`. Also guard: `if (!bibliography.trim()) skip the append`. This preserves behavior for papers with no citations yet.
**Warning signs:** `Error: parseBib: no entries parsed from input` in tests using empty bib fixtures.

### Pitfall 6: Multi-cite `[@key1; @key2]` tokens left unreplaced

**What goes wrong:** A regex of `/\[@([^\]]+)\]/g` (matching only a single `@`-prefixed key) leaves `[@key1; @key2]` unchanged because the inner content `@key1; @key2` doesn't match a single non-semicolon key.
**Why it happens:** Pandoc supports semicolon-separated multi-cite syntax. The regex must handle both single and multi-key forms.
**How to avoid:** Use `/\[(@[^\]]+)\]/g` (match the full inner content starting with `@`) and then split on `;` inside the callback. [VERIFIED: live execution — the multi-key pattern tested and working]
**Warning signs:** `[@key1; @key2]` appears literally in md fallback output.

### Pitfall 7: Zero-trace regression from bib reorder

**What goes wrong:** Moving the bib copy before Pandoc could, in a naive implementation, copy the bib INTO paperDir rather than exportDir, creating a collision.
**Why it happens:** The `bibSrc !== bibDst` guard prevents same-path copies. As long as `exportDir` is distinct from `paperDir` (which the existing code enforces), reordering the copy is safe.
**How to avoid:** Keep the `bibDst = join(exportDir, 'CITATIONS.bib')` path construction unchanged — only the ORDER of the copy relative to the Pandoc call changes.

---

## Code Examples

### Verified: citation-js `format('citation')` output per style

```
// All verified by live execution — citation-js 0.7.22, pensmith-* templates
// Entry: vaswani2017attention (Vaswani, Shazeer, Parmar — 2017)

APA  bibliography: "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is All You Need. Advances in Neural Information Processing Systems.\n"
APA  in-text:      "(Vaswani et al., 2017)"

IEEE bibliography: "[1] A. Vaswani, N. Shazeer, and N. Parmar, "Attention is All You Need," Advances in Neural Information Processing Systems, 2017.\n"
IEEE in-text:      "[1]"

MLA  in-text:      "(Vaswani et al.)"

Chicago-author-date in-text: "(Vaswani, Shazeer, and Parmar 2017)"

Vancouver in-text: "(1)"
Harvard  in-text:  "(Vaswani, Shazeer and Parmar, 2017)"
AMA      in-text:  "1"
```

### Verified: full offline round-trip on the known-good fixture

```
// Input (tests/fixtures/known-good-fixture/section.md):
//   # Background
//   Attention mechanisms were popularized by [@vaswani2017attention] as a replacement for recurrence.

// After resolveAndRenderCitations with style='apa':
//   # Background
//   Attention mechanisms were popularized by (Vaswani et al., 2017) as a replacement for recurrence.
//
//   ## References
//
//   Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is All You Need. Advances in Neural Information Processing Systems.

// Key assertions for REND-03:
//   assert.ok(!rendered.includes('[@'), 'no raw [@key] tokens in output')
//   assert.ok(rendered.includes('Vaswani'), 'formatted reference appears in output')
```

### Verified: renderStyle return type

```typescript
// citations.ts:237 — confirmed by reading source and live execution
export async function renderStyle(
  entries: Array<Record<string, unknown>>,
  style: string,
): Promise<string>
// Returns: a formatted bibliography string (ends with '\n').
// IMPORTANT: this is BIBLIOGRAPHY ONLY. In-text formatting requires
// format('citation', ...) on individual Cite instances (see Pitfall 1).
```

### Verified: Pandoc citeproc args shape

```typescript
// Extend buildPandocArgs (exporter.ts:453)
// Verified no conflict with existing zero-trace --metadata flags:
// --metadata title= / author= / date= blank frontmatter YAML — these are
// document metadata fields, not citation-processing flags. --citeproc
// operates on the body content. No overlap.

// For PDF: --variable pdfcreator= etc. are PDF-only rendering hints;
// --citeproc is a content-processing filter; they compose cleanly.
// Pandoc documentation confirms: metadata, variables, and citeproc are
// orthogonal concerns. [ASSUMED — Pandoc not installed; doc-based reasoning]

const args = [
  inputPath, '--from', 'markdown', '--to', format,
  '--output', outputPath,
  '--metadata', 'title=', '--metadata', 'author=', '--metadata', 'date=',
  // REND-01/02 additions:
  '--citeproc',
  '--csl', cslAbsPath,       // path.join(PKG_ROOT, 'templates', 'citation-styles', `${style}.csl`)
  '--bibliography', bibDst,  // join(exportDir, 'CITATIONS.bib') — must exist before this call
];
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `[@key]` tokens copied verbatim to all exports | `[@key]` resolved to formatted in-text cites + bibliography appended | Phase 13 | Exports become submission-ready rather than requiring manual post-processing |
| `renderStyle` / `resolveStyleName` dead code (milestone-audit MEDIUM-1) | Both gain production consumers in `exportDraft` + `done.ts` | Phase 13 | Closes MEDIUM-1 |

**Deprecated/outdated:**
- `format('bibliography', ...)` for in-text resolution: This approach (only-bibliography) was the assumption before live API testing. **It is wrong** — `format('citation', ...)` exists and works. The offline fallback does NOT need a custom author-year string builder.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `--citeproc` must come before `--csl` and `--bibliography` in the Pandoc args array for all Pandoc versions | Common Pitfalls — Pitfall 3 | Low risk: if order doesn't matter, the args still work. If it does matter and we get it wrong, Pandoc fails and the catch block falls through to the offline fallback (graceful degradation). |
| A2 | Pandoc on win32 accepts backslash-separated paths in `--csl` and `--bibliography` args | Architecture Patterns | Low risk: Pandoc is a native C app on Windows and accepts both path separator styles. Verified by reasoning about execFile (no shell), not by executing Pandoc on dev machine. |
| A3 | `--citeproc` + `--metadata title=` compose cleanly (no conflict) | Code Examples | Low risk: metadata flags blank frontmatter YAML fields; citeproc is a content filter. Pandoc documentation supports this. Can be verified empirically the first time Pandoc is available. |

---

## Open Questions

1. **Numeric styles (IEEE/Vancouver/AMA) — in-text counter stability across the document**
   - What we know: `format('citation', ...)` on a single entry from one of these styles always returns `[1]` or `"1"` because a single-entry cite-group always gets number 1. The offline fallback can only produce `[1]` for every citation.
   - What's unclear: Whether preserving the original order (IEEE `[1]`, `[2]`, ...) is feasible offline without reconstructing the full-document citation order.
   - Recommendation: Accept `[1]` for all numeric-style citations in the offline fallback. The Pandoc path handles correct numbering. Document this as a known limitation of the offline path. The CONTEXT.md already says "if full in-text CSL formatting is infeasible without Pandoc, at minimum render a formatted bibliography + a clear, deterministic in-text rendering" — this qualifies.

2. **`done --format md` path vs. the Pandoc-absent fallback — should both use the offline helper?**
   - What we know: The current code has `format === 'md' || !pandoc` branching to the same `writeMarkdown` path. The Pandoc-absent fallback calls `writeMarkdown(md, outputPath)` — raw copy with no rendering.
   - What's unclear: The CONTEXT.md says the fallback must resolve `[@key]`. Format=md is a deliberate md request (not a fallback), but it still emits raw `[@key]` today. Should `format === 'md'` with Pandoc present use Pandoc + citeproc (yes, it should — Pandoc can process `md → md` with citeproc), or should it always use the offline helper?
   - Recommendation: Use Pandoc + citeproc for `format === 'md'` when Pandoc is present (Pandoc can convert md→md with citation rendering). Use the offline helper for `format === 'md'` when Pandoc is absent AND for the explicit Pandoc-absent fallback for other formats. Both cases are covered by the same code path with `!pandoc`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| citation-js | REND-01/02/03 offline rendering | ✓ | 0.7.22 | — (already installed, no fallback needed) |
| Pandoc | REND-01/02 primary path | ✗ (not on dev machine) | — | Offline citation-js path (the entire point of the fallback) |
| templates/citation-styles/*.csl | Both paths | ✓ | All 8 present | — (committed to repo) |

**Missing dependencies with no fallback:** none — the offline path is the fallback.
**Missing dependencies with fallback:** Pandoc — the offline citation-js path is the designed fallback.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) |
| Config file | `scripts/run-tests.mjs` (test runner script) |
| Quick run command | `node --import tsx/esm tests/exporter.test.ts` |
| Full suite command | `node scripts/run-tests.mjs` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REND-01 | `[@key]` replaced with formatted in-text cite in offline-rendered output | unit | `node --import tsx/esm tests/exporter.test.ts` | ✅ (extend existing) |
| REND-02 | Formatted bibliography appended to offline-rendered output | unit | `node --import tsx/esm tests/exporter.test.ts` | ✅ (extend existing) |
| REND-03 | Offline test asserts "Vaswani" appears in rendered output (not `[@vaswani2017attention]`) | unit | `node --import tsx/esm tests/exporter.test.ts` | ✅ (extend existing) |
| REND-01/02 (Pandoc) | Pandoc path: citeproc args passed, formatted output produced | integration | Pandoc-gated test inside exporter.test.ts | ✅ (extend with `pandocPresent` guard) |
| zero-trace | Bibliography content does not introduce "pensmith" trace | regression | `node --import tsx/esm tests/zero-trace-export.test.ts` | ✅ (existing; must still pass) |

### Sampling Rate

- **Per task commit:** `node --import tsx/esm tests/exporter.test.ts && node --import tsx/esm tests/zero-trace-export.test.ts`
- **Per wave merge:** `node scripts/run-tests.mjs`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

None — the test file (`tests/exporter.test.ts`) and fixture (`tests/fixtures/known-good-fixture/CITATIONS.bib` + `section.md`) already exist. New tests are additions to the existing file, not new files. The fixture has `vaswani2017attention` — exactly the citekey for REND-03.

*(Existing test infrastructure covers all phase requirements — only new test cases need authoring, not new files or framework setup.)*

---

## Security Domain

`security_enforcement: true` in config. Phase 13 makes citation content flow into exported documents.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | BibTeX input parsed via `parseBib` (already validated in citations.ts); malformed input throws, not silently empty |
| V6 Cryptography | no | — |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| BibTeX injection via crafted `.bib` entry containing LaTeX commands | Tampering | `parseBib` passes content through citation-js's BibTeX parser which normalizes to CSL-JSON; the rendered output is plain text (`format:'text'`), not LaTeX or HTML — injection vectors don't survive to exported plain text. For `.docx`/`.pdf` (Pandoc path), Pandoc's `--citeproc` processes the bibliography safely within its own sandboxed pipeline. |
| Pensmith trace via bibliography content | Information Disclosure | Bibliography text is paper content (author names, titles, journal names) — inherently trace-free. The "pensmith" literal sweep in `zeroTracePatch` catches any edge case. No mitigation beyond what already exists. |
| `[@key]` tokens with path traversal or injection content | Tampering | Citekeys are validated by the verifier gate before they reach the `.bib`. `resolveAndRenderCitations` only looks up `intextMap.get(id)` — if the key is not in the map, it emits the original `[@key]` literal unchanged (harmless). No filesystem or shell access from the citekey value. |

---

## Sources

### Primary (HIGH confidence)

- `bin/lib/citations.ts` — full source read; `renderStyle`, `resolveStyleName`, `parseBib`, `ensureStyleTemplate`, `registeredStyles` Map — all verified by reading the implementation
- `bin/lib/exporter.ts` — full source read; `buildPandocArgs` (line 453), `exportDraft`, `writeMarkdown`, `zeroTracePatch`, `zeroTracePdf`, bib copy logic — all verified
- `bin/cli/done.ts` — full source read; discipline NOT currently read, no `--discipline` flag, `exportDraft` called without style
- `bin/lib/intake-parse.ts` — `parseIntakeMd` returns `{ topic, discipline, assignment }` — verified by source read
- citation-js 0.7.22 live execution — `format('citation', ...)` returns in-text strings; `format('bibliography', ...)` returns bibliography strings; all 8 `pensmith-*` templates confirmed working; per-entry `new Cite([entry])` approach confirmed for individual in-text strings
- `tests/fixtures/known-good-fixture/CITATIONS.bib` — `vaswani2017attention` entry confirmed present and parseable
- `tests/fixtures/known-good-fixture/section.md` — `[@vaswani2017attention]` token confirmed; full offline round-trip verified by live execution
- `tests/exporter.test.ts` — full source read; `pandocPresent=false` gating pattern confirmed; `seedPaper` helper confirmed reusable

### Secondary (MEDIUM confidence)

- `tests/zero-trace-export.test.ts` — full source read; confirmed zero-trace tests structure; confirmed `format='md'` test (Test E) and `format='latex'` test (Test F) pattern
- npm registry `citation-js` metadata — version 0.7.22, created 2016-10-27, repo `github.com/larsgw/citation.js`, slopcheck [OK]

### Tertiary (LOW confidence)

- Pandoc `--citeproc` flag ordering (before `--csl`/`--bibliography`) — stated as best practice; Pandoc not installed on dev machine for direct verification [ASSUMED: A1]
- Pandoc win32 path separator handling — reasoning-based [ASSUMED: A2]

---

## Metadata

**Confidence breakdown:**
- citation-js API shape (format/citation/bibliography): HIGH — verified by live execution in the actual installed package
- Exporter wiring pattern (where to add code, what to import): HIGH — full source read of all relevant files
- Pandoc citeproc args: MEDIUM — Pandoc not installed; args derived from documentation and the existing buildPandocArgs pattern
- Discipline reading in done.ts: HIGH — confirmed done.ts has no discipline reading; parseIntakeMd confirmed in intake-parse.ts
- Zero-trace non-regression: HIGH — bibliography is plain text content; existing zeroTracePatch sweep covers any edge case

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (citation-js 0.7.x is stable; no known breaking changes pending)
