# Phase 6: Done / Export Pipeline + Zero-Trace Gate — Research

**Researched:** 2026-06-18
**Domain:** Export pipeline, Pandoc metadata, GPTZero honesty scoring, DuckDuckGo plagiarism, humanizer skill wrapping, DONE-09 confirmation gate
**Confidence:** HIGH (architecture) / MEDIUM (GPTZero API shape) / HIGH (zero-trace mechanism)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DONE-01 | Whole-paper Pass 4 audit on compiled draft | `runPass4` already exists in `bin/lib/verify/pass4.ts`; caller reads `.paper/DRAFT.md`, passes to `runPass4`, aggregates `orphanCount` |
| DONE-02 | Free distinctive-phrase plagiarism check via DuckDuckGo HTML | New `bin/lib/plagiarism.ts`; n-gram extraction, `http.ts` chokepoint with `generic` source type, cassette-backed tests |
| DONE-03 | Humanizer wrap; skip cleanly if absent | `isHumanizerSkillPresent()` already in `ecosystem-presence.ts`; wrap produces `.paper/FINAL.md`; `--raw` skips |
| DONE-04 | GPTZero honesty score before AND after humanize | New `bin/lib/honesty.ts`; `http.ts` chokepoint; LOCKED framing copy in `references/honesty-framing.md`; `CONTRIBUTING.md` drift rule |
| DONE-05 | Honesty backend pluggable to Originality/Sapling | Config field `honesty_backend` in `config.toml`; strategy pattern in `honesty.ts` |
| DONE-06 | Export to .docx/.pdf/.tex/.md; markdown-only fallback if Pandoc absent | `isPandocPresent()` from `ecosystem-presence.ts`; new `bin/lib/exporter.ts`; post-process ZIP for zero-trace |
| DONE-07 | Zero pensmith trace in exported document | Post-process: DOCX ZIP patch of `docProps/core.xml`+`docProps/app.xml`; LaTeX `--variable pdfcreator=`; md is clean by nature; `.tex` is clean source; zero-trace test scans all |
| DONE-08 | Bundle `.paper/CITATIONS.bib` in configured citation style | Already written by compile.ts; exporter copies alongside exported file |
| DONE-09 | Export confirmation gate — issues summary + explicit confirm; skip with `--yolo` | Gate reads Pass 2 verdicts, Pass 4 orphanCount, plagiarism hits; `@clack/prompts` confirm; wired in `bin/cli/done.ts` |
| TEST-10 | Zero-trace export test — every format scanned for "pensmith" + metadata fields | New `tests/zero-trace-export.test.ts`; fixture-based, no network, reads real generated docx/tex/md byte-for-byte |
</phase_requirements>

---

## Summary

Phase 6 is the umbrella `done` verb: it chains whole-paper Pass 4 → plagiarism → humanizer → GPTZero (before/after) → DONE-09 gate → Pandoc export → zero-trace scrub. All sub-steps are already architecturally prepared: Pass 4 exists (`bin/lib/verify/pass4.ts`), the humanizer-presence probe exists (`ecosystem-presence.ts`), http.ts is the network chokepoint, and the `done` verb slot is already in the locked 16-verb set (`verbs.ts`). This phase fills in the remaining five modules: `bin/lib/plagiarism.ts`, `bin/lib/honesty.ts`, `bin/lib/exporter.ts`, `bin/cli/done.ts`, and `tests/zero-trace-export.test.ts`.

The highest-risk item is **zero-trace DOCX metadata**. Pandoc injects `dc:creator` / `dc:title` into `docProps/core.xml` and uses "Microsoft Word 12.0.0" as the `Application` value in `docProps/app.xml` by default. The `core.xml` template uses `dc:creator` set from the `--metadata author` flag. Setting `--metadata author=""` produces an empty tag, but the field is still present in the XML (which is a ZIP entry). The correct strategy is a **post-process ZIP patch** using Node's built-in `node:zlib` + a small in-process ZIP reader/writer (JSZip or adm-zip — both slopcheck-clean) to rewrite `docProps/core.xml` with all identifying fields blanked and `docProps/app.xml` with a neutral Application value. This is the only approach that deterministically satisfies `TEST-10`.

PDF export is blocked by PDF engine availability (xelatex, wkhtmltopdf) which is absent on this machine. The markdown-only fallback for `.pdf` (skip with clear banner) is the safe path per DONE-06. `.tex` export is clean by construction: the output is source LaTeX with no embedded metadata unless a custom header is injected. GPTZero requires an API key (`x-api-key` header) for its `POST https://api.gptzero.me/v2/predict/text` endpoint; the free tier requires registration but is functional; it must be skipped cleanly (with banner) when the key is absent.

**Primary recommendation:** Use JSZip (`jszip` npm package) for the DOCX ZIP post-process step. It is slopcheck-clean [OK], has no postinstall scripts, and its in-memory API makes it easy to patch individual XML entries atomically. For PDF: pass `--variable pdfcreator= --variable pdfproducer=` to a LaTeX-based Pandoc PDF invocation to suppress those hyperref fields; for wkhtmltopdf the equivalent is `--variable header-html=''`. When PDF engine is absent, skip PDF export with a banner (DONE-06 explicit fallback).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Whole-paper Pass 4 (DONE-01) | Both | — | Pure-Node deterministic; same `runPass4` function works in both tiers |
| DuckDuckGo plagiarism n-gram (DONE-02) | Both | — | HTTP through `http.ts`; rate-limited to `generic` bucket; sequential in Tier 2 |
| Humanizer wrapping (DONE-03) | Tier 1 (Task) | Tier 2 (stdin prompt) | Tier 1 spawns `humanizer` as a Task; Tier 2 prints banner + skip when absent |
| GPTZero honesty score (DONE-04) | Both | — | HTTP through `http.ts`; skip cleanly if `GPTZERO_API_KEY` absent |
| Export format conversion (DONE-06) | Both | — | Pandoc shellout in both tiers; md fallback when Pandoc absent |
| DOCX zero-trace ZIP patch (DONE-07) | Both | — | In-process Node; `jszip` reads/patches/writes DOCX ZIP entries |
| DONE-09 confirmation gate | Both | — | `@clack/prompts` in Tier 1 full UX; stdin numbered-prompt fallback Tier 2 (already pattern from TIER-05) |

---

## Standard Stack

### Core (existing — already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `undici` (via `http.ts`) | 7.25.0 | All outbound HTTP including GPTZero + DDG | Existing chokepoint; ESLint enforces sole-use |
| `@anthropic-ai/sdk` | 0.93.0 | Pass 4 advisory LLM labels (already wired) | Already dependency |
| `@clack/prompts` | 0.7.0 | DONE-09 confirmation gate | Already dependency; TIER-05 pattern |
| `zod` | 3.25.76 | Schema validation for honesty response | Already dependency |

### New Dependencies
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `jszip` | 3.10.1 [VERIFIED: npm registry] | In-memory DOCX ZIP manipulation for zero-trace patch | Slopcheck [OK], no postinstall, 8+ years old, 1M+/wk downloads; adm-zip is alternative but synchronous API is less ergonomic for async pipeline |

### Package Legitimacy Audit

> All packages for this phase run through the Package Legitimacy Gate.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| jszip | npm | 13 yrs | ~2M/wk | github.com/Stuk/jszip | [OK] | Approved |
| adm-zip | npm | 12 yrs | ~10M/wk | github.com/cthackers/adm-zip | [OK] | Approved (alternative to jszip — choose one) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged [SUS]:** none
**Postinstall scripts:** neither jszip nor adm-zip has a postinstall script.

**Decision:** Use `jszip` (async API fits the async pipeline). `adm-zip` is synchronous only — it blocks the event loop for large files. JSZip v3.10.1 is the current stable version. [VERIFIED: npm registry]

**Installation:**
```bash
npm install jszip
npm install --save-dev @types/jszip   # if TypeScript type defs needed
```

Note: `@types/jszip` may not exist as a separate package — JSZip ships its own `.d.ts` in the main package since v3.x. [ASSUMED — verify at install time]

---

## Architecture Patterns

### System Architecture Diagram

```
.paper/DRAFT.md  ──────────────────────────────────────────┐
                                                             │
       ┌─────────────────────────────────────────────┐      │
       │  bin/cli/done.ts  (thin orchestrator)        │      │
       │                                               │      │
       │  1. runPass4(DRAFT.md)    ←─────────────────────────┘
       │     → orphanCount[] (deterministic)
       │
       │  2. runPlagiarism(DRAFT.md) via http.ts
       │     → DuckDuckGo HTML → n-gram hits[]
       │
       │  3. scoreHonesty(DRAFT.md, 'before')
       │     → GPTZero POST /v2/predict/text via http.ts
       │     → { completely_generated_prob, document_classification }
       │
       │  4. [if humanizer present]
       │     → invoke humanizer skill / Task
       │     → .paper/FINAL.md
       │
       │     scoreHonesty(FINAL.md, 'after')
       │     → second GPTZero call
       │
       │  5. DONE-09 gate (LOCKED framing from references/honesty-framing.md)
       │     → collect: UNSUPPORTED claims (from Pass 2 in VERIFICATION.md)
       │                orphanCount > 0 (from step 1)
       │                plagiarism hits (from step 2)
       │     → show per-issue summary
       │     → @clack/prompts confirm (or stdin-numbered Tier 2)
       │     → abort if rejected (unless --yolo)
       │
       │  6. exportDraft(format, .paper/FINAL.md | .paper/DRAFT.md)
       │     → Pandoc shellout (if present)
       │     → zeroTracePatch(output.docx)   ← JSZip ZIP post-process
       │     → copy .paper/CITATIONS.bib alongside
       │
       └─────────────────────────────────────────────┘
               │
               ▼
       output.{docx,pdf,tex,md}  +  CITATIONS.bib
```

### Recommended Project Structure (new files this phase)

```
bin/
├── cli/
│   └── done.ts              # Thin orchestrator for the done verb
└── lib/
    ├── plagiarism.ts        # N-gram extraction + DDG HTML search
    ├── honesty.ts           # GPTZero/Originality/Sapling backends
    └── exporter.ts          # Pandoc shellout + zero-trace ZIP patch + bib copy
references/
└── honesty-framing.md       # LOCKED copy for GPTZero framing — hash-pinned in repo-files.test.ts
tests/
└── zero-trace-export.test.ts
workflows/
└── done.md                  # (existing stub — flesh out this phase)
prompts/
├── plagiarism-ngram.md      # (if LLM-assisted n-gram filtering needed — ASSUMED)
└── (none required — all paths are deterministic or use existing prompts)
```

### Pattern 1: Zero-Trace DOCX ZIP Patch

**What:** After Pandoc generates a `.docx`, the file is a ZIP archive. `docProps/core.xml` contains `dc:creator`, `dc:title`, `cp:lastModifiedBy`. `docProps/app.xml` contains `Application`. Both must be neutralized.

**When to use:** Every `.docx` export, always. Non-negotiable per DONE-07.

**The key insight:** Pandoc's `core.xml` template sets `dc:creator` from the `--metadata author` variable. Setting `--metadata author="" --metadata title=""` produces empty-value tags, but the tags remain in the XML. The guaranteed-clean approach is to rewrite the ZIP entries in-process.

**Exact XML target in `docProps/core.xml`:** [CITED: github.com/jgm/pandoc/blob/main/data/docx/docProps/core.xml]
```xml
<!-- Fields to blank (set to empty string or remove the element entirely) -->
<dc:creator></dc:creator>
<dc:title></dc:title>
<cp:lastModifiedBy></cp:lastModifiedBy>
<cp:keywords></cp:keywords>
<!-- Timestamps: set to a fixed epoch (1970-01-01T00:00:00Z) for reproducibility -->
<dcterms:created xsi:type="dcterms:W3CDTF">1970-01-01T00:00:00Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">1970-01-01T00:00:00Z</dcterms:modified>
```

**Exact XML target in `docProps/app.xml`:** [CITED: github.com/jgm/pandoc/blob/main/data/docx/docProps/app.xml]
```xml
<!-- Replace Application with a neutral value (or remove it) -->
<Application>Microsoft Office Word</Application>
<!-- AppVersion is innocuous numeric — leave or remove -->
```

**Implementation using JSZip:** [ASSUMED — pattern, not Context7 verified]
```typescript
// Source: JSZip docs https://stuk.github.io/jszip/
import JSZip from 'jszip';
import * as fsp from 'node:fs/promises';
import { atomicWriteFile } from './atomic-write.js';

export async function zeroTracePatch(docxPath: string): Promise<void> {
  const buf = await fsp.readFile(docxPath);
  const zip = await JSZip.loadAsync(buf);

  // Patch core.xml
  const coreFile = zip.file('docProps/core.xml');
  if (coreFile) {
    let xml = await coreFile.async('string');
    // Blank dc:creator, dc:title, cp:lastModifiedBy, cp:keywords
    xml = xml.replace(/<dc:creator>[^<]*<\/dc:creator>/g, '<dc:creator></dc:creator>');
    xml = xml.replace(/<dc:title>[^<]*<\/dc:title>/g, '<dc:title></dc:title>');
    xml = xml.replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/g, '<cp:lastModifiedBy></cp:lastModifiedBy>');
    // Normalize timestamps to epoch
    xml = xml.replace(/<dcterms:created[^>]*>[^<]*<\/dcterms:created>/g,
      '<dcterms:created xsi:type="dcterms:W3CDTF">1970-01-01T00:00:00Z</dcterms:created>');
    xml = xml.replace(/<dcterms:modified[^>]*>[^<]*<\/dcterms:modified>/g,
      '<dcterms:modified xsi:type="dcterms:W3CDTF">1970-01-01T00:00:00Z</dcterms:modified>');
    zip.file('docProps/core.xml', xml);
  }

  // Patch app.xml — remove Application value (or set to innocuous value)
  const appFile = zip.file('docProps/app.xml');
  if (appFile) {
    let xml = await appFile.async('string');
    xml = xml.replace(/<Application>[^<]*<\/Application>/g, '<Application></Application>');
    zip.file('docProps/app.xml', xml);
  }

  // Write back atomically
  const patched = await zip.generateAsync({ type: 'nodebuffer' });
  await atomicWriteFile(docxPath, patched);
}
```

**Zero-trace test verification approach:**
```typescript
// Read the patched docx as a zip, scan every XML entry for 'pensmith'
const zip = await JSZip.loadAsync(buf);
for (const [name, file] of Object.entries(zip.files)) {
  if (!file.dir) {
    const text = await file.async('string');
    assert(!text.toLowerCase().includes('pensmith'), `Found 'pensmith' in ${name}`);
  }
}
```

### Pattern 2: LaTeX PDF Metadata Suppression

**What:** Pandoc uses LaTeX → PDF via xelatex/pdflatex/lualatex. The hyperref package sets `pdfcreator` and `pdfproducer` in PDF metadata. These must be suppressed via `--variable` flags. [CITED: pandoc.org/MANUAL.html — Variables for LaTeX section]

**Pandoc invocation for zero-trace PDF:** [ASSUMED — exact flag names need verification with an installed Pandoc]
```bash
pandoc input.md \
  --from markdown \
  --to pdf \
  --pdf-engine xelatex \
  --metadata title="" \
  --metadata author="" \
  --variable pdfcreator="" \
  --variable pdfproducer="" \
  --variable pdfauthor="" \
  --variable colorlinks=false \
  --output output.pdf
```

**Pitfall:** If PDF engine (xelatex/pdflatex) is absent, this fails. Always check `isPandocPresent()` AND the engine before attempting PDF. Skip PDF with a clear banner per DONE-06 when absent.

**Post-PDF check:** Even with empty variables, the LaTeX engine itself may inject `Creator: LaTeX with hyperref` into PDF XMP metadata. A post-process scan using Node's buffer inspection (`output.pdf` as binary, grep for `Creator` in XMP stream) is part of `TEST-10`. [ASSUMED — needs verification against actual PDF output]

### Pattern 3: GPTZero Honesty Score

**What:** POST to `https://api.gptzero.me/v2/predict/text` with a JSON body containing `{ "document": "<text>" }` and an `x-api-key` header. [CITED: gptzero.me/developers]

**Response fields used:** [MEDIUM confidence — from support docs, not full API reference]
- `document_classification`: `"HUMAN_ONLY" | "MIXED" | "AI_ONLY"`
- `class_probabilities.ai`: float 0..1 (the "AI-generated probability" to display)
- `predicted_class`: the highest-probability class

**All calls go through `http.ts`** with `source: 'generic'` and `noCache: true` (content changes per call). [VERIFIED: codebase grep]

**Skip-clean pattern (when `GPTZERO_API_KEY` absent):**
```typescript
const key = process.env['GPTZERO_API_KEY'];
if (!key) {
  process.stdout.write('pensmith: GPTZero API key not set — honesty score skipped.\n');
  return null;
}
```

**LOCKED framing copy rule:**
The exact output lines are stored in `references/honesty-framing.md` and hash-pinned in `tests/repo-files.test.ts` (same SHA-256 byte-pin pattern used for `references/http-warnings.md`, `prompts/revise-swap.md`). The `done.ts` module reads and renders these lines verbatim — never embeds them inline. A `CONTRIBUTING.md` rule (documented at the top of the file) states: "The honesty-framing.md copy file is LOCKED. Changes require a deliberate PR update AND a re-pin of the SHA-256 in repo-files.test.ts." This prevents drift per the non-negotiable honest-framing requirement.

**Exact output format (LOCKED in references/honesty-framing.md):**
```
Pensmith honesty check (before humanize): reads as XX% AI-generated (GPTZero).
Pensmith honesty check (after humanize):  reads as XX% AI-generated (GPTZero).
Note: this score reflects prose patterns. The humanizer improves readability;
it does not promise to make output undetectable.
```

### Pattern 4: DuckDuckGo Plagiarism N-gram

**What:** Extract 5+ word n-grams from the compiled draft, filter for "distinctive" (low-frequency) phrases, query DuckDuckGo HTML endpoint with each phrase, parse result count and first-N URLs.

**DDG HTML endpoint:** `https://html.duckduckgo.com/html/?q=<encoded-phrase>` [CITED: multiple web sources confirming this is the static HTML endpoint that does not require an API key]

**Rate limiting:** DDG blocks sessions that make >~10-15 rapid requests without browser headers. The approach: add browser-like headers (`Accept-Language: en-US,en;q=0.9`, `Sec-Fetch-Site: none`), introduce 300–900ms jitter between requests (within `http.ts` generic bucket at 5 RPS), and limit to a maximum of 10 n-gram queries per paper (configurable). [CITED: multiple web sources on DDG scraping best practices]

**N-gram extraction algorithm (deterministic, no LLM):**
```typescript
// Extract 5-gram candidates, filter by rarity heuristic
function extractDistinctivePhrases(text: string, minWords = 5, maxPhrases = 10): string[] {
  const sentences = text.split(/[.!?]\s+/);
  const ngrams: string[] = [];
  for (const sent of sentences) {
    const words = sent.trim().split(/\s+/).filter(w => w.length > 2);
    if (words.length < minWords) continue;
    // Extract overlapping windows
    for (let i = 0; i <= words.length - minWords; i++) {
      const phrase = words.slice(i, i + minWords).join(' ');
      // Filter: skip common phrases (high-frequency words only), keep unusual ones
      if (isDistinctive(phrase)) ngrams.push(phrase);
    }
  }
  // Dedupe, limit to maxPhrases
  return [...new Set(ngrams)].slice(0, maxPhrases);
}
```

**Output to `.paper/VERIFICATION.md`:** Appended as a `## Plagiarism Check` section listing matched phrases + URLs. Never blocks export (DONE-09 warns but does not auto-block on plagiarism hits alone).

### Pattern 5: Humanizer Skill Wrapping

**Humanizer skill location:** `~/.claude/skills/humanizer/` (detected by `isHumanizerSkillPresent()` in `ecosystem-presence.ts`). [VERIFIED: codebase]

**The humanizer skill is NOT installed on this machine** — `isHumanizerSkillPresent()` returns false. Per DONE-03, this must be handled with a clean skip + banner. The implementation:

```typescript
if (!isHumanizerSkillPresent()) {
  process.stdout.write(
    'pensmith: humanizer skill not found at ~/.claude/skills/humanizer/ — skipping humanize step.\n' +
    'Install the humanizer skill to enable prose improvement.\n'
  );
  return null; // draft stays as-is; export uses .paper/DRAFT.md
}
// else: invoke via Task tool (Tier 1) or as a CLI subcommand (Tier 2)
```

**Tier 1 invocation:** Spawn a `Task` with the humanizer skill on `.paper/DRAFT.md`, result written to `.paper/FINAL.md`.
**Tier 2 fallback:** Since the humanizer skill requires Claude Code's `Task` tool, Tier 2 prints the skip banner unconditionally (or optionally calls a configured `humanizer` CLI if `PENSMITH_HUMANIZER_CMD` is set — this is discretionary, not locked). [ASSUMED — Tier 2 fallback strategy for humanizer]

### Pattern 6: DONE-09 Gate Wiring

**Pass 2 results** are read from `.paper/sections/*/VERIFICATION.md` — specifically parsing the `## Pass-2` table for any `UNSUPPORTED` verdict rows.

**Pass 4 results** are computed fresh by DONE-01 (running `runPass4` on the compiled DRAFT.md), not re-read from section VERIFICATION.md files. This catches issues at section boundaries.

**Plagiarism hits** from DONE-02.

**Gate logic:**
```typescript
const issues = {
  unsupported: pass2Results.filter(r => r.verdict === 'UNSUPPORTED'),
  orphanClaims: pass4Results.filter(r => r.orphanCount > 0),
  plagiarismHits: plagiarismResults.filter(r => r.matches.length > 0),
};
const hasIssues = Object.values(issues).some(a => a.length > 0);

// Generic confirm always shown — even with no issues (PRD §7.9)
if (!yolo) {
  if (hasIssues) {
    // Show per-issue summary
    renderIssuesSummary(issues);
  }
  const confirmed = await prompt('Ready to export? (y/n)');
  if (!confirmed) return { exported: false };
}
```

**@clack/prompts usage (existing dependency):**
```typescript
import { confirm } from '@clack/prompts';
const go = await confirm({ message: 'Export the paper?' });
if (!go) process.exit(0);
```

### Anti-Patterns to Avoid

- **Embedding framing copy inline:** The honesty framing ("improves prose, not evades detection") MUST live in `references/honesty-framing.md`, not hardcoded in `done.ts`. Otherwise drift is undetectable at CI time.
- **Skipping the ZIP patch and trusting `--metadata author=""`:** Pandoc writes empty XML tags but the field name is still present. The zero-trace test reads actual ZIP entries — empty tags still fail if `<dc:creator>Akhil Achanta</dc:creator>` was in the source document's YAML header. Post-process is mandatory.
- **Calling DDG with no delay:** Rate limits trigger after ~10 rapid requests. Use jitter sleep between each n-gram query.
- **Using `fetch` directly in plagiarism.ts:** ESLint chokepoint bans `fetch`/`undici` outside `http.ts`. All HTTP must go through `bin/lib/http.ts`.
- **Blocking export on plagiarism hits alone:** The plagiarism check is free/low-recall and explicitly advisory. DONE-09 warns but only the gate confirm blocks (which always fires, even on clean papers).
- **GPTZero calls without key check:** Must check `GPTZERO_API_KEY` presence before attempting calls; skip cleanly with banner when absent.
- **Generating PDF on machines without a PDF engine:** Always gate on `isPandocPresent()` AND verify the PDF engine is available before attempting PDF export.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DOCX ZIP manipulation | Custom ZIP reader | `jszip` | ZIP format has alignment/compression edge cases; JSZip is battle-tested for 13 years |
| Honesty score API client | Custom HTTP client | `http.ts` + thin wrapper | Rate limits, retry, caching — already solved |
| DuckDuckGo HTTP | Direct fetch | `http.ts` with `generic` source bucket | ESLint chokepoint; retry + UA already solved |
| AskUser confirmation | Roll your own stdin | `@clack/prompts` | Already installed; TIER-05 pattern established |
| Atomic file writes for exported doc | `fs.writeFile` | `atomicWriteFile` from `atomic-write.ts` | Write-then-rename integrity |
| Human-readable percent for GPTZero | Custom rounding | `Math.round(prob * 100)` | Trivial; just be consistent (0 decimal places) |

---

## Common Pitfalls

### Pitfall 1: Pandoc Absent — Silent Failure
**What goes wrong:** `exporter.ts` calls Pandoc via `execFile`, which throws `ENOENT` (command not found) — if uncaught, the whole `done` step crashes rather than falling back to markdown.
**Why it happens:** `isPandocPresent()` gates the doctor probe but the exporter may not recoup the check at call time.
**How to avoid:** At the top of `exportDraft()`, call `isPandocPresent()` directly (or accept it as an injected capability flag). If false, skip all non-md formats and write a clear `process.stdout.write` banner.
**Warning signs:** `ENOENT pandoc` in error stack.

### Pitfall 2: DOCX Metadata Leak via Source Document YAML Header
**What goes wrong:** The user's `.paper/DRAFT.md` or `.paper/FINAL.md` contains a YAML front-matter block with `author: Akhil Achanta`. Pandoc reads this and sets `dc:creator` in `core.xml`. The ZIP post-process neutralizes it, but only if the post-process actually runs.
**Why it happens:** Compile step may have written author metadata into DRAFT.md front matter as part of citation header generation.
**How to avoid:** (1) Pass `--metadata author="" --metadata title=""` flags to Pandoc unconditionally. (2) Always run `zeroTracePatch()` after Pandoc output regardless of whether front matter is expected. (3) `TEST-10` catches this if the patch is skipped.
**Warning signs:** `TEST-10` fails on `dc:creator` containing a real name.

### Pitfall 3: PDF Producer/Creator Not Suppressed by Empty Variables
**What goes wrong:** Even with `--variable pdfcreator=""`, the LaTeX hyperref package may still inject `Producer: pdfTeX-1.40.26` or `Creator: LaTeX with hyperref` in the XMP metadata stream embedded in the PDF.
**Why it happens:** hyperref and pdflatex independently inject PDF XMP metadata. The `--variable` only controls pandoc's `\hypersetup{}` invocation; the PDF engine itself has defaults.
**How to avoid:** For PDF: skip it (DONE-06 fallback). If PDF must be supported, use `qpdf --empty --pages input.pdf -- output.pdf` to re-linearize and strip XMP, or use a custom LaTeX template that sets `\hypersetup{pdfcreator={},pdfproducer={}}`. These require additional external tools; scope to a future phase.
**Warning signs:** `TEST-10` PDF XMP scan finds `Creator:` or `Producer:` values.

### Pitfall 4: GPTZero Free Tier Rate Limits
**What goes wrong:** GPTZero free tier has low rate limits (~10 requests/day on the free plan, based on typical AI API patterns). Running before + after humanize = 2 calls per paper. This should be fine, but burst failures may occur.
**Why it happens:** API key is from free tier; limits apply per key.
**How to avoid:** Cache the result for a given document hash (same content → same score). Use `http.ts` cache with a short TTL (1h). Skip gracefully (banner) on 429.
**Warning signs:** HTTP 429 from `api.gptzero.me`.

### Pitfall 5: DuckDuckGo Rate Limit / Block
**What goes wrong:** DDG HTML endpoint blocks IPs that make rapid requests without browser-like headers. Returns empty results or a CAPTCHA page.
**Why it happens:** DDG anti-scraping measures; no formal API contract.
**How to avoid:** Add `Accept-Language: en-US,en;q=0.9` and `Accept: text/html` headers. Use `noCache: true` (or short TTL) for DDG responses. Limit to max 10 n-gram queries per paper. Add 500ms jitter between queries (built into `http.ts` generic bucket at 5 RPS = 200ms minimum, plus the bucket naturally paces requests).
**Warning signs:** DDG responses contain no `<a class="result__a">` links or contain CAPTCHA text.

### Pitfall 6: Zero-Trace Test Non-Determinism
**What goes wrong:** The `TEST-10` zero-trace test generates a real DOCX in a temp directory during the test. On Windows, ZIP file timestamps include the local system time, making the output non-deterministic. The test checks for "pensmith" string presence, which is stable, but byte-for-byte comparison would fail.
**Why it happens:** JSZip uses `Date.now()` for ZIP entry modification times by default.
**How to avoid:** Pass `{ date: new Date(0) }` (epoch) to `zip.file(name, content, { date: new Date(0) })` when writing each entry in `zeroTracePatch()`. The "pensmith" string scan is robust to timestamp variance (it's a content scan, not a hash comparison).
**Warning signs:** Test passes locally but fails on CI with "file modified" detection.

### Pitfall 7: Humanizer Absent — Hard Exit vs. Clean Skip
**What goes wrong:** If `done.ts` throws on missing humanizer rather than skipping, the entire `done` step fails and no export happens.
**Why it happens:** Absent-skill detection not wired before humanizer invocation.
**How to avoid:** Always call `isHumanizerSkillPresent()` first. If false → skip humanizer, score GPTZero on the DRAFT.md only (with "N/A" for after-score), export DRAFT.md as final source.
**Warning signs:** `pensmith done` exits non-zero with "humanizer not found" rather than printing a skip banner and continuing.

### Pitfall 8: ESLint Chokepoint Violation in New Files
**What goes wrong:** `bin/lib/plagiarism.ts` or `bin/lib/honesty.ts` directly imports `undici` or uses `fetch` instead of routing through `http.ts`.
**Why it happens:** New file, engineer forgets the chokepoint rule.
**How to avoid:** The ESLint lint step catches this at CI. Tests should run `npm run lint` before `npm test`. Add a note in each new file's header: "All HTTP through bin/lib/http.ts — ESLint chokepoint enforced."
**Warning signs:** `npm run lint` fails with `no-restricted-imports` on `fetch` or `undici`.

---

## Runtime State Inventory

> This phase is greenfield addition — no rename/refactor. No runtime state migration required.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — no new persistent data stores | — |
| Live service config | None | — |
| OS-registered state | None | — |
| Secrets/env vars | `GPTZERO_API_KEY` (new env var, never set) | Document in doctor probe DOCT-02 extension; skip-clean when absent |
| Build artifacts | None | — |

**New env var:** `GPTZERO_API_KEY` — read by `bin/lib/honesty.ts`. Must be checked for presence before any GPTZero call. The env var NAME is stored in `runtime.json` via a new `honestyBackend` config slot (following the `getProviderApiKey` pattern). [ASSUMED — exact runtime.json schema extension needed]

---

## Code Examples

### Zero-Trace DOCX Test Pattern (TEST-10)

```typescript
// Source: pattern derived from existing tests/cassette-no-leak.test.ts
import JSZip from 'jszip';
import * as fsp from 'node:fs/promises';
import assert from 'node:assert/strict';

async function assertNoTrace(docxPath: string): Promise<void> {
  const buf = await fsp.readFile(docxPath);
  const zip = await JSZip.loadAsync(buf);
  const violations: string[] = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const text = await file.async('string').catch(() => ''); // binary files return garbage
    if (text.toLowerCase().includes('pensmith')) {
      violations.push(`${name}: contains 'pensmith'`);
    }
    // Check for specific metadata fields that should be blank
    if (name === 'docProps/core.xml') {
      const match = /<dc:creator>([^<]+)<\/dc:creator>/.exec(text);
      if (match && match[1]?.trim()) {
        violations.push(`docProps/core.xml: dc:creator is not empty: '${match[1]}'`);
      }
    }
  }
  assert.deepEqual(violations, [], `Zero-trace violations: ${violations.join(', ')}`);
}
```

### GPTZero Call Pattern (via http.ts)

```typescript
// Source: bin/lib/http.ts pattern; applied to honesty.ts
import { fetch } from './http.js';

export interface HonestyScore {
  aiProbability: number;               // 0..1; multiply by 100 for display
  classification: 'HUMAN_ONLY' | 'MIXED' | 'AI_ONLY';
  backend: string;
}

export async function scoreWithGptzero(text: string): Promise<HonestyScore | null> {
  const apiKey = process.env['GPTZERO_API_KEY'];
  if (!apiKey) return null; // skip-clean

  const resp = await fetch('https://api.gptzero.me/v2/predict/text', {
    method: 'POST',
    source: 'generic',
    noCache: true, // content-dependent; don't cache honesty scores
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ document: text }),
  });

  if (resp.status !== 200) return null; // skip on any error
  const json = JSON.parse(resp.body) as {
    documents?: Array<{
      class_probabilities?: { ai?: number };
      document_classification?: string;
    }>;
  };
  const doc = json.documents?.[0];
  if (!doc) return null;
  return {
    aiProbability: doc.class_probabilities?.ai ?? 0,
    classification: (doc.document_classification as HonestyScore['classification']) ?? 'MIXED',
    backend: 'gptzero',
  };
}
```

### Pandoc Export Invocation Pattern

```typescript
// Source: bin/lib/ecosystem-presence.ts (isPandocPresent pattern adapted)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export async function exportWithPandoc(
  inputPath: string,
  outputPath: string,
  format: 'docx' | 'pdf' | 'latex' | 'markdown',
): Promise<void> {
  const args = [
    inputPath,
    '--from', 'markdown',
    '--to', format === 'latex' ? 'latex' : format,
    '--output', outputPath,
    // Zero-trace metadata suppression
    '--metadata', 'title=',
    '--metadata', 'author=',
    '--metadata', 'date=',
  ];
  if (format === 'pdf') {
    args.push('--variable', 'pdfcreator=');
    args.push('--variable', 'pdfproducer=');
  }
  await execFileAsync('pandoc', args, { timeout: 60_000 });
  if (format === 'docx') {
    await zeroTracePatch(outputPath); // mandatory post-process
  }
}
```

### Honesty Framing Render (from LOCKED copy)

```typescript
// Source: references/honesty-framing.md (hash-pinned in repo-files.test.ts)
import { readFileSync } from 'node:fs';
import path from 'node:path';

function renderHonestyReport(before: number, after: number | null, backend: string): string {
  const framingPath = path.join(pkgRoot, 'references', 'honesty-framing.md');
  const framing = readFileSync(framingPath, 'utf8');
  // Extract the note paragraph (below the "## Note" heading)
  const noteMatch = /## Note\s*\n\n([\s\S]+?)(?:\n\n|$)/.exec(framing);
  const note = noteMatch?.[1] ?? '';
  const beforePct = Math.round(before * 100);
  const afterLine = after !== null
    ? `Pensmith honesty check (after humanize):  reads as ${Math.round(after * 100)}% AI-generated (${backend}).`
    : `Pensmith honesty check (after humanize):  N/A (humanizer not installed).`;
  return [
    `Pensmith honesty check (before humanize): reads as ${beforePct}% AI-generated (${backend}).`,
    afterLine,
    note,
  ].join('\n');
}
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Pandoc | DONE-06 export | ✗ | — | Markdown-only export; skip .docx/.pdf/.tex with banner |
| xelatex / pdflatex | DONE-06 PDF export | ✗ | — | Skip PDF export with banner |
| wkhtmltopdf | DONE-06 PDF (alternative) | ✗ | — | Skip PDF export with banner |
| Node.js | All | ✓ | 24.16.0 | — |
| jszip | DONE-07 ZIP patch | ✗ (not yet installed) | 3.10.1 available | No fallback — must install |
| GPTZero API key | DONE-04 | ✗ (not set) | — | Skip-clean with banner per DONE-04 |
| Humanizer skill | DONE-03 | ✗ (not installed) | — | Skip-clean with banner per DONE-03 |

**Missing dependencies with no fallback:** `jszip` (must install — needed for zero-trace DOCX patch). All others have defined fallback paths per DONE-03, DONE-04, DONE-06.

**Missing dependencies with fallback:** Pandoc (→ md-only), PDF engine (→ skip PDF), GPTZero key (→ skip honesty score), humanizer (→ skip humanize).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) |
| Config file | `scripts/run-tests.mjs` (discovers `tests/**/*.test.ts`) |
| Quick run command | `node --import tsx --test tests/zero-trace-export.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DONE-01 | runPass4 on compiled draft produces Pass4Result[] | unit | `node --import tsx --test tests/known-bad-pass4.test.ts` | ✅ (existing) |
| DONE-02 | Plagiarism n-gram extraction + DDG search | unit (cassette) | `node --import tsx --test tests/plagiarism.test.ts` | ❌ Wave 0 |
| DONE-03 | Humanizer absent → banner + skip, no crash | unit | `node --import tsx --test tests/done-humanizer-absent.test.ts` | ❌ Wave 0 |
| DONE-04 | GPTZero before+after; absent key → clean skip | unit (cassette) | `node --import tsx --test tests/honesty.test.ts` | ❌ Wave 0 |
| DONE-05 | Pluggable backend config field respected | unit | included in `tests/honesty.test.ts` | ❌ Wave 0 |
| DONE-06 | Pandoc absent → md-only + banner | unit | `node --import tsx --test tests/exporter.test.ts` | ❌ Wave 0 |
| DONE-07 | Zero trace in DOCX ZIP entries | unit (TEST-10) | `node --import tsx --test tests/zero-trace-export.test.ts` | ❌ Wave 0 |
| DONE-07 | Zero trace in .tex output | unit (TEST-10) | included in `tests/zero-trace-export.test.ts` | ❌ Wave 0 |
| DONE-07 | Zero trace in .md output | unit (TEST-10) | included in `tests/zero-trace-export.test.ts` | ❌ Wave 0 |
| DONE-08 | CITATIONS.bib copied alongside exported doc | unit | included in `tests/exporter.test.ts` | ❌ Wave 0 |
| DONE-09 | Gate fires on UNSUPPORTED/orphan/plagiarism hits | unit | `node --import tsx --test tests/done-gate.test.ts` | ❌ Wave 0 |
| DONE-09 | --yolo skips gate | unit | included in `tests/done-gate.test.ts` | ❌ Wave 0 |
| TEST-10 | Zero-trace test for all formats | integration | `node --import tsx --test tests/zero-trace-export.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run lint && node --import tsx --test tests/zero-trace-export.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + `npm run lint` + `tsc --noEmit` before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/plagiarism.test.ts` — covers DONE-02; needs cassette for DDG HTML response
- [ ] `tests/honesty.test.ts` — covers DONE-04/05; needs cassette for GPTZero response
- [ ] `tests/exporter.test.ts` — covers DONE-06/08; fixture-based, no Pandoc required for Pandoc-absent path
- [ ] `tests/zero-trace-export.test.ts` — covers DONE-07/TEST-10; generates real DOCX in memory using jszip
- [ ] `tests/done-gate.test.ts` — covers DONE-09; mock Pass2/Pass4/plagiarism results
- [ ] `tests/done-humanizer-absent.test.ts` — covers DONE-03; env manipulation
- [ ] `tests/fixtures/cassettes/gptzero/predict-text.json` — GPTZero cassette
- [ ] `tests/fixtures/cassettes/duckduckgo/html-search.json` — DDG HTML cassette
- [ ] `references/honesty-framing.md` — LOCKED framing copy file
- [ ] CONTRIBUTING.md update — document honesty-framing.md lock rule

---

## Security Domain

> `security_enforcement: true` in `.planning/config.json`. ASVS Level 1 applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | GPTZero response parsed defensively (zod or hand-rolled type guard); DDG HTML parsed with `String.includes` / regex only (no eval/innerHTML) |
| V6 Cryptography | no | — |
| V7 Error Handling | yes | All external calls wrapped in try/catch; failures → advisory skip, never crash |
| V8 Data Protection | yes | API key (`GPTZERO_API_KEY`) must never be logged (follow existing T-01-07 pattern from `getProviderApiKey`); `http.ts` header allowlist drops `x-api-key` from cached headers (CACHE_HEADER_ALLOWLIST) |

### Known Threat Patterns for Export Pipeline

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Metadata leak (author/creator in exported doc) | Information Disclosure | DONE-07 zero-trace ZIP patch + TEST-10 |
| API key in session log | Information Disclosure | `GPTZERO_API_KEY` value never passes through session-log call (presence-boolean pattern from runtime.ts) |
| DDG HTML injection via crafted text | Tampering | n-gram search strings URL-encoded; DDG response parsed as plain text only (no DOM eval) |
| Pandoc command injection via file paths | Tampering | `execFile` (not `exec`); args are an array, not a shell string; input paths are from `paperDir()` which is validated |
| GPTZero response fabrication | Spoofing | Response parsed defensively; unexpected values → null (skip); score shown as-is (no trust claims) |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pandoc `--metadata author=` to suppress | Post-process ZIP patch on DOCX | Established pattern 2023+ | Reliable; Pandoc alone is insufficient for full suppression |
| GPTZero v1 endpoint | GPTZero v2 `/predict/text` | ~2023 | v2 is the current stable endpoint; v1 is deprecated |
| DDG API (no longer exists) | DDG HTML scrape (`html.duckduckgo.com/html/`) | 2021+ | No formal API; HTML scrape is the only free approach |

**Deprecated/outdated:**
- `duck-duck-scrape` npm package [ASSUMED — slopcheck-clean but adds unnecessary dependency; direct HTTP via `http.ts` is simpler and already rate-limited]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@types/jszip` does not exist as separate package — types bundled in jszip | Standard Stack | If wrong, import will work but TypeScript may throw — add `@types/jszip` if needed |
| A2 | GPTZero v2 `/predict/text` endpoint accepts `{ "document": "<text>" }` in POST body with `x-api-key` header | Code Examples | If API changed, honesty score silently skips on 4xx; cassette must capture real response |
| A3 | DDG HTML endpoint at `https://html.duckduckgo.com/html/?q=<query>` is stable and parseable | Architecture Patterns | If DDG changes HTML structure, n-gram hits fail to parse; advisory only so export still proceeds |
| A4 | Pandoc `--variable pdfcreator=` successfully blanks the PDF Creator field in hyperref | Code Examples | If wrong, TEST-10 PDF scan fails; PDF export must be disabled (fallback already exists) |
| A5 | JSZip v3 `.generateAsync({ type: 'nodebuffer' })` produces a valid DOCX that Word can open | Zero-trace pattern | If ZIP structure is broken after patch, exported DOCX is unreadable — critical to test |
| A6 | The `done` verb (already in `UX02_VERBS`) maps to `workflows/done.md` which already exists as a stub | Verb wiring | Confirmed: `verbs.ts` has `'done'`, `workflows/done.md` exists — no new verb needed |
| A7 | Tier 2 humanizer invocation: print banner + skip (since `Task` tool is Tier 1 only) | Humanizer Wrapping | If Tier 2 has an alternate humanizer invocation path, tier-contract test will catch the gap |
| A8 | GPTZero free tier allows 2 calls per paper execution without hitting rate limits | GPTZero Pitfall | If wrong, DONE-04 will see 429; `http.ts` retry + `generic` bucket handles it gracefully |
| A9 | `docProps/app.xml` in Pandoc-generated DOCX contains `Application: Microsoft Word 12.0.0` (from Pandoc's template) and NOT "Pandoc" or "pensmith" | Zero-trace DOCX | If Pandoc changed its template, TEST-10 may pass trivially or fail unexpectedly — verify in test |

---

## Open Questions

1. **GPTZero API key — free tier registration requirement**
   - What we know: GPTZero requires an API key (no truly anonymous endpoint). Free tier registration is available at `app.gptzero.me`.
   - What's unclear: Whether the free tier has a per-day request limit that 2 calls/paper would exceed for heavy users.
   - Recommendation: Implement skip-clean when key absent. Document in `pensmith doctor` that `GPTZERO_API_KEY` enables honesty scoring.

2. **Honesty score storage location**
   - What we know: PRD §7.11 says "Score reported in `.paper/VERIFICATION.md` with timestamp."
   - What's unclear: Whether whole-paper VERIFICATION.md is a new file (separate from section VERIFICATIONs) or appended to an existing file.
   - Recommendation: Write to `.paper/VERIFICATION.md` (whole-paper, new file per `done` run). This mirrors `.paper/COMPILE-REPORT.md` as a top-level paper artifact.

3. **Pluggable honesty backends (DONE-05)**
   - What we know: PRD §7.11 mentions Originality and Sapling as alternatives to GPTZero.
   - What's unclear: Whether Originality/Sapling have similar API shapes (`/predict/text` + API key) or require different request structures.
   - Recommendation: Define `HonestyBackend` interface in `honesty.ts` with `score(text, apiKey): Promise<HonestyScore | null>`. Ship GPTZero backend only. Stubs for Originality/Sapling that `throw new Error('not implemented')` until a future phase.

4. **JSZip vs adm-zip choice for DOCX post-process**
   - What we know: Both slopcheck-clean. JSZip is async; adm-zip is sync.
   - What's unclear: Whether the `atomicWriteFile` pattern requires the output to be a Buffer (JSZip yes; adm-zip yes for `toBuffer()`).
   - Recommendation: JSZip — async is preferred in the pipeline; `atomicWriteFile` accepts `string | Buffer` per existing usage.

---

## Sources

### Primary (HIGH confidence)
- `bin/lib/verify/pass4.ts` — Pass 4 interface confirmed: `runPass4(draftMd, { n, scopeCapUsd })` returns `Pass4Result[]`
- `bin/lib/verify/pass2.ts` — Pass 2 interface confirmed: advisory only, `Pass2Result[]`
- `bin/lib/http.ts` — HTTP chokepoint interface confirmed; `FetchOptions.source`, `noCache`, header allowlist
- `bin/lib/ecosystem-presence.ts` — `isHumanizerSkillPresent()`, `isPandocPresent()` confirmed
- `bin/lib/compile.ts` — `.paper/DRAFT.md` and `.paper/CITATIONS.bib` confirmed as compile outputs
- `bin/lib/verbs.ts` — `done` verb confirmed in locked 16-verb set
- `workflows/done.md` — stub confirmed (Phase 2 stub to be filled in Phase 6)
- `bin/cli/compile.ts` — thin-orchestrator pattern for new `bin/cli/done.ts` to follow
- [github.com/jgm/pandoc/blob/main/data/docx/docProps/core.xml](https://github.com/jgm/pandoc/blob/main/data/docx/docProps/core.xml) — Pandoc default `core.xml` template fields confirmed
- [github.com/jgm/pandoc/blob/main/data/docx/docProps/app.xml](https://github.com/jgm/pandoc/blob/main/data/docx/docProps/app.xml) — Pandoc default `app.xml` uses "Microsoft Word 12.0.0" as Application

### Secondary (MEDIUM confidence)
- [gptzero.me/developers](https://gptzero.me/developers) + support docs — GPTZero endpoint `POST https://api.gptzero.me/v2/predict/text`, `x-api-key` header, `{ "document": "<text>" }` body, `document_classification` / `class_probabilities.ai` response fields
- [html.duckduckgo.com/html/?q=](https://html.duckduckgo.com/html/) — DDG static HTML endpoint confirmed as the standard free approach; rate limiting requires browser headers and jitter
- Web sources on DDG scraping best practices — 300–900ms jitter, `Accept-Language` headers extend session lifetime 3–5x

### Tertiary (LOW confidence)
- Pandoc `--variable pdfcreator=` suppresses PDF Creator in hyperref (not explicitly confirmed in docs — needs live Pandoc test)
- GPTZero free tier daily request count (unknown — design for graceful 429 handling)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all existing deps confirmed; jszip confirmed via npm registry + slopcheck
- Architecture: HIGH — all architectural chokepoints confirmed in codebase; zero-trace mechanism confirmed via Pandoc source templates
- Pitfalls: HIGH — most derived from codebase patterns and confirmed web sources
- GPTZero API shape: MEDIUM — endpoint URL and basic request/response shape confirmed; full schema from docs requires API access

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (30 days; GPTZero API is stable but DDG scraping approach may change)
