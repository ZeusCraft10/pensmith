# Phase 8: Style Match + Sketch + Add + Library + BYO PDF Polish — Research

**Researched:** 2026-06-19
**Domain:** Multi-paper library management, per-paper style profiling, Socratic thinking-partner UX, mid-paper source ingestion (DOI/PDF/URL), BYO PDF text extraction with fallback
**Confidence:** HIGH (codebase verified), MEDIUM (style-match implementation detail)

---

## Summary

Phase 8 fills in four verbs that are currently stubs — `list`, `open`, `sketch`, and `add` — and adds two cross-cutting features: the style-match pipeline (STYL-01..04) and BYO PDF ingestion via `pymupdf` shellout fallback (RSCH-05b, extending the Phase 3 `pdf-parse` chokepoint).

**Library mode (LIB-01..05):** `bin/lib/library.ts` already provides the per-paper `.paper/LIBRARY.json` chokepoint (init, load, save, addEntry, findEntry). Phase 8 needs a SEPARATE global index at `pensmithDataDir()/library/index.json` (PRD §6) that maps paper names to folder paths, status, and class — this is distinct from the per-paper `.paper/LIBRARY.json` (which is a source/citation store). The global index is the target of `list` and `open`. The `list` verb groups by class; `open` writes an `active` pointer (a small JSON file at `pensmithDataDir()/active.json`) so any verb can resolve the currently active paper root. Paper status in the global index is a free-text lifecycle string matching LIB-05: `intake | research | outline | sectioning (X/Y) | compile | done | archived`.

**Style-match (STYL-01..04):** Per-paper `.paper/STYLE.json` only — no global cache is permissible. The profile is a JSON object capturing quantified prose features extracted from the user's writing samples: median sentence length (words), vocabulary density (type-token ratio), opening-word distribution (frequency table), closing-word distribution, subordinating-clause rate, passive-voice rate, and a sample-set fingerprint (SHA-256 of sorted sample file paths + mtimes). The fingerprint is the cross-paper reuse detection mechanism: when a new paper's intake calls style-match, it reads `pensmithDataDir()/style-fingerprints.json` to check if the same fingerprint was used for a different paper — if so, it SURFACES this to the user (a transparency signal, never hidden). The section drafter already has a `voiceHint` field in `DrafterInputSchema` (required, z.string()); Phase 8 adds an optional `styleProfile` path field (add to DrafterInputSchema as `styleProfilePath?: z.string().optional()`) so the drafter can load STYLE.json and blend it. The README must ship the dual-use disclosure as a dedicated section (STYL-04).

**Sketch (ERGO-05):** A thinking-partner pre-intake mode. State machine: (a) user invokes `sketch`, (b) LLM asks 4-5 Socratic questions (interests, disagreements, audience, target claim), (c) candidate thesis synthesized, (d) user refines or confirms, (e) ONLY on confirm does `sketch` drop into `intake` with thesis pre-filled. The key invariant is that sketch does NOT advance paper state into `intake` until the user confirms — there is no paper root, no STATE.json, and no `.paper/` directory created during the Socratic loop. The workflow body for sketch already exists at `workflows/sketch.md` (currently a stub).

**Add (ERGO-06 + RSCH-05b):** `pensmith add <doi|pdf|url>` is a mid-paper verb. It runs the Crossref/OpenAlex/arXiv adapter (already in `bin/lib/sources/`) for DOI/URL lookup, or runs `extractPdfText` (the existing `pdf-parse` chokepoint at `bin/lib/pdf-text.ts`) + metadata heuristic extraction + Crossref hydration for BYO PDFs. The RSCH-05b addition is that when `pdf-parse` fails or returns near-empty text (image-only signal already handled by `extractPdfText`), the code shellouts to `python3 -c "import fitz; ..."` — catching `ENOENT` or non-zero exit as graceful skip. After ingestion, the verb appends the source to `.paper/RESEARCH.md` and `.paper/CITATIONS.bib` (via `bibtex-write.ts`), then surfaces: "Source added. Should I remap sections to reference it?" — an approval gate (default on, skip with --yolo).

**Primary recommendation:** Implement in this wave order: (1) global-library-index (`bin/lib/global-library.ts` new file + paths.ts additions), (2) `list` + `open` CLI verbs, (3) STYLE.json schema + `bin/lib/style-match.ts` extractor, (4) `sketch` stub-to-real promotion, (5) `add` stub-to-real promotion + RSCH-05b pymupdf shellout, (6) drafter integration of STYLE.json, (7) README dual-use disclosure, (8) tier-contract + repo-files updates.

---

## Project Constraints (from CLAUDE.md)

- **Section-as-phase is load-bearing** — no change to `.paper/sections/<NN-slug>/` directory contract.
- **Two-tier architecture** — all four verbs (list/open/sketch/add) need workflow body updates AND CLI implementations.
- **Locked 16-verb bijection** — list/open/sketch/add ARE existing members of UX02_VERBS. Phase 8 fills their stubs; it does NOT add a 17th verb.
- **Style-match is opt-in with honest dual-use disclosure** — framing in README must say "match your established voice" not "impersonate" or "evade detection."
- **Per-paper STYLE.json ONLY, NO global cache** — the style profile is written to `.paper/STYLE.json`; the fingerprint registry at `pensmithDataDir()/style-fingerprints.json` tracks which samples were used (for cross-paper reuse detection) but stores no prose features.
- **Verifier blocks compile and export** — `add` cannot introduce unverified sources that bypass Pass 1.
- **No exported-document trace** — no change needed; Phase 6 handles zero-trace.
- **Approval gates default-on** — the `add` remap-sections prompt and the `sketch` confirm gate are both default-on; `--yolo` skips them.
- **All network via http.ts** — Crossref hydration in `add` must use `httpFetch` from `bin/lib/http.ts`, not raw fetch.
- **pdf-parse pinned EXACT at 1.1.1** — already in package.json and installed. Do not upgrade.
- **pymupdf is a Python shellout, NOT an npm package** — detect via `python3 -c "import fitz"` subprocess; absent → graceful skip.
- **Honest framing on detection** — no change to honesty framing in Phase 8; README style-match disclosure is separate and must not imply detection evasion.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIB-01 | Global library at `~/.pensmith/library/index.json` (platform-equiv), JSON + `proper-lockfile` | New `bin/lib/global-library.ts` + `pensmithLibraryIndexPath()` in `paths.ts`; `proper-lockfile` already installed (v4) |
| LIB-02 | `/pensmith list` shows all papers grouped by class | `list.ts` CLI verb reads global index, groups by `class` field, formats table to stdout |
| LIB-03 | `/pensmith open <name>` switches active paper | `open.ts` CLI verb writes `pensmithDataDir()/active.json` active-pointer; resolveNextAction reads it |
| LIB-04 | Class assignment at intake (free-form string, default "Unfiled") | `intake.ts` already reads `config.toml [project] class`; global-library registration at end of intake |
| LIB-05 | Status values per paper: `intake\|research\|outline\|sectioning (X/Y)\|compile\|done\|archived` | Stored as `status` field in global-library index entry; updated by each verb on state advance |
| ERGO-05 | `/pensmith sketch` thinking-partner thesis-discovery mode, does NOT advance state until confirm | `sketch.ts` CLI + workflow body update; uses LLM (runtime.ts); confirm gate before intake |
| ERGO-06 | `/pensmith add <doi\|pdf\|url>` mid-paper source ingestion with "remap sections?" prompt | `add.ts` CLI + workflow body update; uses crossref.ts + pdf-text.ts + bibtex-write.ts + remap approval gate |
| RSCH-05b | BYO PDF ingestion: pdf-parse (pinned exact) + pymupdf shellout fallback + Crossref hydration | Extends existing `extractPdfText` chokepoint; new `pymupdfShellout()` function in `pdf-text.ts`; crossref `fetchById` for hydration |
| STYL-01 | Intake folder of past writing samples → `.paper/STYLE.json` per-paper profile, NO global cache | New `bin/lib/style-match.ts` analyzer; profile schema in `bin/lib/schemas/style.ts`; written atomically |
| STYL-02 | Sample-set fingerprint stored; cross-paper reuse detected and surfaced to user | Fingerprint registry at `pensmithDataDir()/style-fingerprints.json`; checked at intake if style-match enabled |
| STYL-03 | Section drafter consumes profile; per-section voice hints override | Add `styleProfilePath?: z.string().optional()` to `DrafterInputSchema`; write verb reads STYLE.json and passes path |
| STYL-04 | README ships dual-use disclosure for style-match feature | README.md `## Style Match` section; honest framing only |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Global library index (list/open/class) | Node CLI / bin/lib | MCP resource (future) | Index is a local JSON file; CLI is the primary writer; MCP read-only resource would be TIER-01 extension |
| Active-paper pointer (open) | Node CLI / bin/lib | Tier 1 plugin (reads pointer) | Both tiers need to resolve active paper; pointer lives in pensmithDataDir() |
| Paper status lifecycle transitions | Node CLI (each verb) | MCP tool paper_set_status | Each verb (research, outline, compile, done) calls `updateGlobalLibraryEntry` to advance status |
| Style-match feature extraction | Node CLI / bin/lib | — | LLM-based featurization; runs at intake in both tiers; STYLE.json is the output |
| Cross-paper fingerprint registry | Node CLI / bin/lib | — | Pure local JSON at pensmithDataDir(); no MCP surface needed |
| Sketch thinking-partner loop | Claude (LLM) via workflow body | Tier 2 CLI sequential prompting | Socratic questions are LLM-driven; Tier 2 degrades gracefully to stdin prompts |
| Add source ingestion | Node CLI / bin/lib | Tier 1 via workflow body | pdf-text.ts, bibtex-write.ts, crossref adapter — all bin/lib |
| pymupdf shellout | Node CLI / bin/lib (pdf-text.ts) | — | Subprocess to python3; never MCP-exposed |
| Drafter style injection | Node CLI (write verb) | Tier 1 (write workflow body) | DrafterInput schema already has voiceHint; add styleProfilePath for STYLE.json pass-through |

---

## Standard Stack

### Core (No New Packages — All Already Installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pdf-parse` | `1.1.1` (PINNED EXACT) | PDF text extraction (Phase 3 chokepoint already wired) | Already installed; `extractPdfText` in `bin/lib/pdf-text.ts` is the sole call site [VERIFIED: installed in package.json] |
| `proper-lockfile` | `^4` (4.1.2 installed) | Cross-process lock for global-library-index writes | Already installed for `.paper/` state files; same pattern for global index [VERIFIED: package.json] |
| `zod` | `^3.23` | Schema validation for STYLE.json, global-library entry, fingerprint record | Already the project-wide validation engine [VERIFIED: package.json] |
| `citation-js` | `0.7.22` | BibTeX serialization for `add` → CITATIONS.bib | Already installed; `writeBibtex` in `bin/lib/bibtex-write.ts` is the chokepoint [VERIFIED: package.json] |
| `@clack/prompts` | `^0.7` | Tier 2 stdin approval gates for "remap sections?" and sketch confirm | Already installed as the Tier 2 AskUserQuestion fallback [VERIFIED: package.json] |

### Supporting (Python — External Shellout Only)

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `pymupdf` (Python `fitz` module) | 1.27.2.3 (installed on this machine) | Higher-fidelity PDF text extraction as `pdf-parse` fallback | Only when `extractPdfText` returns near-empty text (image-only heuristic); shellout via `python3 -c "import fitz; ..."` |

**pymupdf availability on this machine:** PyMuPDF 1.27.2.3 is pip-installed (`pip show pymupdf` confirmed), but `import fitz` is failing in the current Python 3.13 environment (likely a binary compatibility issue between the installed version and the interpreter). The shellout must catch all subprocess failures (non-zero exit, ENOENT, stderr) and degrade gracefully — the PDF source is still usable via pdf-parse even if pymupdf is absent. [VERIFIED: pip show pymupdf, python3 import test failed]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LLM featurization for style-match | Pure statistical (sentence length, TTR, regex-based passive voice detector) | LLM is richer but slower and costs tokens; pure stats are deterministic, offline-capable, and sufficient for the bias signal STYL-03 needs. Recommend: **pure stats for profile extraction, no LLM call at profile-build time**. The voiceHint string passed to the drafter is the natural-language rendering of the stats profile. |
| Fingerprint registry in pensmithDataDir() | Per-paper file with no cross-paper index | Registry approach enables O(1) lookup and surfaces reuse without scanning all paper dirs |
| SHA-256 of sorted sample paths + mtimes | SHA-256 of sample file contents | Content hash is more robust to path renames; path+mtime is faster and avoids reading large files twice. Recommend: **content-hash** (read each sample file, hash its bytes; sort hashes; SHA-256 the concatenation). This detects same files under different paths and differs if any sample changes. |
| Separate `bin/lib/global-library.ts` | Extend existing `bin/lib/library.ts` | `library.ts` is the per-paper `.paper/LIBRARY.json` chokepoint (source/citation store). The global index serves a different purpose (paper registry). Mixing them would break the D-59 schema contract. **Use a separate file.** |

**Installation:** No new npm packages needed for Phase 8. All dependencies are already in `package.json`.

---

## Package Legitimacy Audit

Phase 8 installs NO new npm packages. All packages used are already in `package.json` (installed in Phase 1 or earlier phases).

| Package | Registry | Age | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|
| `pdf-parse` | npm | ~8 yrs (2018-01-07) | OK | Approved — already installed, pinned 1.1.1 |
| `proper-lockfile` | npm | Well-established | OK | Approved — already installed |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**pymupdf:** Python shellout only, never imported as npm package.

---

## Architecture Patterns

### System Architecture Diagram

```
User invokes verb
        |
        v
bin/pensmith.ts (dispatch)
        |
        +---> list.ts / open.ts --> global-library.ts --> pensmithDataDir()/library/index.json
        |
        +---> sketch.ts --> LLM Socratic loop (runtime.ts) --> confirm gate --> intake verb
        |
        +---> add.ts --> {
        |        |
        |        +--[doi]---> crossref.ts / openalex.ts (http.ts) --> toCandidate()
        |        |
        |        +--[pdf]---> extractPdfText (pdf-text.ts)
        |        |               |
        |        |               +--[text ok]-----> heuristic metadata --> crossref.ts hydration
        |        |               |
        |        |               +--[empty/fail]--> pymupdfShellout (python3 fitz)
        |        |                                    |
        |        |                                    +--[ok] --> metadata --> crossref.ts hydration
        |        |                                    |
        |        |                                    +--[absent/fail] --> WARN + partial metadata
        |        |
        |        +--[url]---> httpFetch (http.ts) --> {doi detect | pdf detect | html meta}
        |        |
        |        +--> writeBibtex (bibtex-write.ts) --> .paper/CITATIONS.bib (append)
        |        |
        |        +--> "remap sections?" approval gate --> section PLAN.md updates (if yes)
        |
        +---> write verb (existing) --> DrafterInput {voiceHint, styleProfilePath?}
                                                          |
                                                          v
                                               STYLE.json (if enabled at intake)
```

### Recommended Project Structure (New Files)

```
bin/
├── cli/
│   ├── list.ts          # list verb — reads global index, groups by class
│   ├── open.ts          # open verb — writes active pointer, confirms switch
│   ├── sketch.ts        # sketch verb — Socratic LLM loop + intake drop-in
│   └── add.ts           # add verb — DOI/PDF/URL ingestion + remap gate
├── lib/
│   ├── global-library.ts       # NEW: global index at pensmithDataDir()/library/index.json
│   ├── style-match.ts          # NEW: prose feature extractor → STYLE.json
│   ├── pymupdf-shellout.ts     # NEW: python3 fitz subprocess wrapper (graceful fallback)
│   └── schemas/
│       ├── global-library.ts   # NEW: GlobalLibraryEntrySchema + GlobalLibrarySchema
│       └── style.ts            # NEW: StyleProfileSchema (sentence-length, TTR, etc.)
workflows/
├── list.md              # FILL stub
├── open.md              # FILL stub
├── sketch.md            # FILL stub
└── add.md               # FILL stub
tests/
├── global-library.test.ts  # NEW
├── style-match.test.ts     # NEW
├── pymupdf-shellout.test.ts # NEW
└── add-verb.test.ts         # NEW (cassette-backed)
```

### Pattern 1: Global Library Index (LIB-01)

**What:** A separate JSON file at `pensmithDataDir()/library/index.json` — NOT inside `.paper/` — indexed by a stable paper ID (UUID from STATE.json's `paperId`). Each entry stores: `{ id, name, folderPath, class, status, createdAt, updatedAt }`.

**When to use:** All list/open/add/status operations that need to enumerate papers across folders.

**Key design decisions:**
- The lock is on the index file itself (same `proper-lockfile` pattern as library.ts).
- `pensmithDataDir()` is already the correct location (not inside `.paper/` — avoids sync-folder corruption).
- `folderPath` is stored as an absolute path; `open` resolves it when switching.
- The `status` field is updated by each verb when it advances state (intake writes `intake`, research writes `research`, etc.).

```typescript
// Source: codebase pattern from bin/lib/library.ts
export const GlobalLibraryEntrySchema = z.object({
  id: z.string().uuid(),             // paperId from STATE.json
  name: z.string().min(1),           // user-provided name (intake prompt)
  folderPath: z.string().min(1),     // absolute path to paper root
  class: z.string().default('Unfiled'),
  status: z.enum([
    'intake', 'research', 'outline',
    'sectioning', 'compile', 'done', 'archived',
  ]),
  sectioningProgress: z.object({
    done: z.number().int().min(0),
    total: z.number().int().min(1),
  }).optional(),                     // populated when status === 'sectioning'
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

**`list` output format:**

```
pensmith list:
  [PHIL 101]
    my-ethics-paper (research) /path/to/folder
    another-paper   (outline)  /path/to/folder
  [ENGL 250]
    senior-thesis   (sectioning 3/7) /path/to/folder
  [Unfiled]
    draft-paper     (intake)   /path/to/folder
```

### Pattern 2: Active-Paper Pointer (LIB-03)

**What:** `pensmithDataDir()/active.json` — a tiny JSON `{ paperId, folderPath }` file. Written by `open`; read by `resolveNextAction` and every verb that needs `paperRoot` but was invoked from a different directory.

**Fallback:** If `active.json` doesn't exist or the folder is gone, fall back to `process.cwd()` (current behavior). Never crash.

```typescript
// Source: established paths.ts pattern
export function pensmithActivePointerPath(): string {
  return path.join(pensmithDataDir(), 'active.json');
}
```

### Pattern 3: STYLE.json Schema (STYL-01)

**What:** Per-paper `.paper/STYLE.json`. Written at intake (if style-match opted in). Read by the write verb before constructing DrafterInput.

**Feature set (pure stats, no LLM at profile-build time):**

```typescript
// Source: PRD §7.18 + ASSUMED statistical NLP conventions
export const StyleProfileSchema = z.object({
  $schemaVersion: z.literal(1),
  samplesDir: z.string(),                        // original samples folder path
  sampleSetFingerprint: z.string().length(64),   // SHA-256 hex of sorted content hashes
  samplesAnalyzed: z.number().int().min(1),
  features: z.object({
    medianSentenceLengthWords: z.number(),
    p25SentenceLengthWords: z.number(),
    p75SentenceLengthWords: z.number(),
    typeTokenRatio: z.number().min(0).max(1),    // vocabulary diversity
    passiveVoiceRate: z.number().min(0).max(1),  // fraction of sentences with passive
    subordinatingClauseRate: z.number().min(0).max(1),
    openingWordTopN: z.record(z.string(), z.number()),  // top-10 opening words + freq
    closingWordTopN: z.record(z.string(), z.number()),  // top-10 closing words + freq
    avgParagraphLengthSentences: z.number(),
  }),
  generatedAt: z.string().datetime(),
});
```

**voiceHint rendering:** `styleMatchToVoiceHint(profile: StyleProfile): string` renders the stats into a natural-language hint string that becomes `DrafterInput.voiceHint`. Example: `"Match this style: median sentence ~18 words, vocabulary density 0.72 (high variety), low passive voice (0.08), subordinating clauses frequent (0.22). Favor opening sentences with 'The', 'This', 'In'."` This is the mechanism by which style-match biases the drafter WITHOUT adding a new required field to DrafterInputSchema — the voiceHint field already exists and is required.

**STYL-03 implementation decision:** The `styleProfilePath` optional field in DrafterInputSchema is needed so the drafter can re-read the full profile (e.g., for longer reasoning); but the `voiceHint` field is the load-bearing signal the drafter LLM consumes. Both are used: voiceHint carries the rendered profile, styleProfilePath lets a capable Tier-1 drafter fetch the raw JSON for richer reasoning.

### Pattern 4: Cross-Paper Reuse Detection (STYL-02)

**What:** `pensmithDataDir()/style-fingerprints.json` — a global registry mapping fingerprint → `[{ paperId, paperName, folderPath, addedAt }]`. Written by intake when style-match is enabled. Read at intake BEFORE writing STYLE.json to check for prior use.

**Detection flow:**
1. User enables style-match at intake and provides `samplesDir`.
2. `buildStyleProfile(samplesDir)` computes `sampleSetFingerprint`.
3. Load `style-fingerprints.json`; look up the fingerprint.
4. If found (same samples used for another paper): print a surfaced notice:
   ```
   pensmith notice: These writing samples were already used for style-match on
   paper "my-ethics-paper" (created 2026-01-15). The style profile will reflect
   your established voice across papers. Cross-paper style consistency is legitimate;
   be aware this also means the profile is not specific to this paper's topic.
   ```
5. Register the new paper in the fingerprint entry (append, never overwrite).
6. Write STYLE.json to the current paper's `.paper/`.

**Privacy:** The fingerprint registry stores only the fingerprint hash + paper IDs — NOT the prose features, NOT the sample contents. The full StyleProfile (with features) lives only in `.paper/STYLE.json` (per-paper). [ASSUMED — consistent with PRD §13 local-only contract]

### Pattern 5: pymupdf Shellout (RSCH-05b)

**What:** `bin/lib/pymupdf-shellout.ts` — a thin subprocess wrapper that attempts `python3 -c "import fitz; ..."` to extract PDF text when `extractPdfText` (pdf-parse) returns near-empty.

**Trigger condition:** The existing `extractPdfText` already emits `console.warn` and returns near-empty string when `isImageOnlyResult` is true (< 50 non-whitespace chars). `pymupdfShellout` is called ONLY in this case.

**Implementation sketch:**
```typescript
// Source: established subprocess pattern; ASSUMED interface
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function pymupdfShellout(buf: Buffer): Promise<string | null> {
  // Write buffer to tmpfile, shellout to python3, return text or null
  // Catches: ENOENT (python3 absent), non-zero exit (fitz absent), timeout
  // All errors → return null (graceful degradation, never throw)
}
```

**Graceful fallback chain:**
1. `extractPdfText(buf)` (pdf-parse) → text
2. If near-empty → `pymupdfShellout(buf)` → text or null
3. If null → WARN "pymupdf not available; PDF extracted with limited fidelity" + return near-empty string
4. Pass 3 verifier already handles near-empty text as `unverifiable` (not `failed`)

**ESLint chokepoint:** `pymupdf-shellout.ts` must be added to the `no-restricted-imports` override list alongside `pdf-text.ts` (if we ban `child_process.execFile` generally). In practice the project bans `fetch/http/https` but NOT `child_process`, so no new ESLint rule is needed. [VERIFIED: eslint.config.js patterns]

### Pattern 6: `add` Mid-Paper Source Ingestion (ERGO-06)

**Flow:**

```
pensmith add 10.1234/example        # DOI
pensmith add ./path/to/paper.pdf    # local PDF
pensmith add https://example.com/pdf  # URL (may be PDF or DOI landing page)
```

1. **Detect input type:** DOI regex (`doi-regex` already installed), `.pdf` extension, or URL.
2. **Fetch/parse:**
   - DOI → `crossref.fetchById(doi)` → `SourceCandidate`
   - PDF → `fs.readFile(path)` → `extractPdfText(buf)` → metadata heuristic → `crossref.search(title)` for hydration
   - URL → `httpFetch(url)` → detect Content-Type; if PDF bytes, treat as PDF; if HTML, scrape `<meta>` for DOI then retry as DOI
3. **Hydrate:** Call `crossref.fetchById(doi)` if DOI available (canonical metadata).
4. **Dedup:** Check `citekey` against existing `.paper/CITATIONS.bib` entries; warn if collision.
5. **Write:** `writeBibtex([...existingCandidates, newCandidate], bibPath)` (re-generates the full file — this is the existing pattern in bibtex-write.ts).
6. **Append to RESEARCH.md:** A short Markdown table row with title, authors, year, DOI, citekey, status `unverified-new`.
7. **Approval gate:** "Source added. Remap sections to reference it? (y/N)" — AskUserQuestion (Tier 1) or `@clack/prompts` (Tier 2). If yes → surface a list of sections with their source counts; user selects which to remap.
8. **Section remap:** For each selected section, read `PLAN.md` frontmatter, append the citekey to `assigned_sources`, write back atomically. Does NOT re-run the plan — just registers the source so the user can `plan <N> --revise` if they want.

**Non-negotiable:** Add runs `verifyDoi(doi)` (existing in `bin/lib/doi.ts`) before writing. A 404 on the DOI is flagged but the source is still added as `unverified` — the user is shown the warning. A FABRICATED verdict from Pass 1 at verify time will still block compile.

### Anti-Patterns to Avoid

- **Writing STYLE.json to a global location:** The profile stores prose features from a user's past writing — it must live only in `.paper/STYLE.json`. Writing it to `pensmithDataDir()` would be a privacy violation and defeats the per-paper-only constraint.
- **LLM call at style-profile-build time:** The profile extractor runs at intake on the user's samples. An LLM call here adds cost, latency, and non-determinism. Pure stat extraction (sentence splitter, TTR, regex passive-voice detector) is deterministic, free, and faster. The LLM sees the rendered voiceHint during writing — not during profile building.
- **Calling `pymupdfShellout` on every PDF:** Only call it when `extractPdfText` returns near-empty. A subprocess spawn per PDF adds 200-500ms each; it would blow the budget on large research passes.
- **Suppressing the cross-paper reuse notice:** STYL-02 requires the notice to be SURFACED, not hidden. The notice must appear even when the user is in `--yolo` mode (it's a transparency signal, not an approval gate).
- **Re-running `plan` after `add`:** The `add` verb only registers the source; it does NOT automatically re-plan. The "remap sections?" prompt only updates `assigned_sources` in PLAN.md frontmatter. The user must `plan <N> --revise` to rebuild the claim→source mapping with the new source. This boundary prevents `add` from corrupting sections that are already verified.
- **Writing `active.json` inside `.paper/`:** The active pointer must live in `pensmithDataDir()` — it is cross-project state, not per-paper state.
- **Adding a 17th verb:** list/open/sketch/add are all in `UX02_VERBS` already. Three independent guards prevent a 17th: the cli-verbs.test.ts length assertion (16), the tier-contract test (T-07-02), and the validate-plugin-manifest.cjs. Phase 8 only promotes stubs to real implementations.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BibTeX serialization for `add` output | Custom BibTeX writer | `writeBibtex` (`bin/lib/bibtex-write.ts`) | Already handles citekey collision, sorting, git-diff-stable output, citation-js chokepoint |
| DOI normalization in `add` | Inline regex | `normalizeDoi` (`bin/lib/doi.ts`) | Already handles arXiv old/new format, trailing punctuation, PMID/PMCID separation |
| Cross-process lock for global-library-index | Hand-rolled lock | `proper-lockfile` via `withLock` (`bin/lib/lock.ts`) | Same chokepoint pattern as state.ts, library.ts, runtime.ts |
| Atomic write of STYLE.json | `fs.writeFileSync` | `atomicWriteFile` (`bin/lib/atomic-write.ts`) | Crash-safety requirement; already enforced by ESLint chokepoint |
| Sentence splitting for style analysis | Custom regex sentence splitter | Regex-based splitter scoped to plain text (no third-party NLP needed at this fidelity level) | Style-match is a bias signal, not a clinical NLP measurement; a sentence-end regex (`/(?<=[.!?])\s+(?=[A-Z])/`) is sufficient |
| HTTP fetch in `add` for URL sources | `node:https` | `httpFetch` from `bin/lib/http.ts` | ESLint chokepoint bans direct `fetch`/`http`/`https` outside `http.ts` |
| Vocabulary density (TTR) | Complex NLP | Simple word tokenize + Set dedup — pure JS | TTR = unique_words / total_words; no library needed |

**Key insight:** Every new operation in Phase 8 has an existing chokepoint. The risk is bypassing those chokepoints (using raw `fs.writeFile` instead of `atomicWriteFile`, or raw `fetch` instead of `httpFetch`). ESLint will catch most bypasses at lint time.

---

## Common Pitfalls

### Pitfall 1: Global-Cache Leak for STYLE.json
**What goes wrong:** Developer writes style features (prose statistics) to `pensmithDataDir()/style-cache.json` instead of `.paper/STYLE.json`, effectively creating a cross-paper global cache.
**Why it happens:** Confusion between the fingerprint registry (correct global location) and the profile itself (must be per-paper).
**How to avoid:** The StyleProfileSchema is only written via `atomicWriteFile(paperDir + '/STYLE.json', ...)`. The fingerprint registry at `pensmithDataDir()/style-fingerprints.json` stores hashes + paper IDs ONLY — no prose features.
**Warning signs:** If `bin/lib/style-match.ts` imports `pensmithDataDir` for its write target, that is a bug.

### Pitfall 2: Undisclosed Cross-Paper Style Reuse
**What goes wrong:** The fingerprint registry is read but the notice is suppressed (e.g., gated behind a verbose flag, or simply dropped).
**Why it happens:** The notice feels like noise; a developer silences it as a UX polish move.
**How to avoid:** The STYL-02 requirement is "cross-paper reuse detected AND SURFACED." The notice must be printed unconditionally when a fingerprint match is found — it is NOT an approval gate (no y/N prompt), just a transparency print to stdout. Do not gate it behind `--yolo` or any flag.
**Warning signs:** `if (verbose)` or `if (!yolo)` guards around the reuse notice.

### Pitfall 3: add Corrupting Section State
**What goes wrong:** The `add` verb rewrites section PLAN.md files (e.g., to inject the new source into `assigned_sources`) using raw `fs.writeFile` instead of the atomic-write + lock pattern, or does so outside the "remap sections?" gate.
**Why it happens:** It feels natural to "just update the plan" inline during `add`.
**How to avoid:** If the user approves remap: read PLAN.md frontmatter via `parseFrontmatter`, update `assigned_sources[]`, write back via `atomicWriteFile`. Use `withLock(sectionPlanPath, ...)` because the write verb may be running concurrently (Tier 1 wave). Never touch section `status` or `verified_against_draft_hash` in `add`.
**Warning signs:** Import of raw `fs.writeFile` in `add.ts`.

### Pitfall 4: pdf-parse Version Drift
**What goes wrong:** npm install or a lockfile refresh silently upgrades `pdf-parse` from `1.1.1` to a newer version (e.g., `2.x`), breaking the `pdf-parse/lib/pdf-parse.js` sub-path import (the debug-shim workaround documented in `pdf-text.ts`).
**Why it happens:** The package is declared as `"pdf-parse": "1.1.1"` (exact pin) in package.json, but `npm update` or a lockfile reset can override exact pins in some configurations.
**How to avoid:** The version is already pinned exact in `package.json`. Add a test assertion that `require('pdf-parse/package.json').version === '1.1.1'` in the cassette-size or repo-files tests.
**Warning signs:** CI failure on the `pdf-parse/lib/pdf-parse.js` import line with `MODULE_NOT_FOUND`.

### Pitfall 5: pymupdf Absent — Unhandled Subprocess Error
**What goes wrong:** `pymupdfShellout` throws or returns a rejected Promise when `python3` is on PATH but `fitz` is not importable (as on this machine — pip shows it installed but `import fitz` fails, likely a binary compatibility issue).
**Why it happens:** `execFile('python3', [...])` succeeds (process spawned) but exits non-zero; if the caller treats any truthy return as success, it may pass garbage to downstream.
**How to avoid:** `pymupdfShellout` catches ALL errors (non-zero exit, ENOENT, timeout) and returns `null`. The caller checks `if (result === null) { /* degrade */ }`. The unit test for `pymupdf-shellout.ts` explicitly tests the absent case by providing a script that exits non-zero.
**Warning signs:** `result!` non-null assertion without a null check after `pymupdfShellout(buf)`.

### Pitfall 6: sketch Advancing State Before Confirm
**What goes wrong:** The `sketch` verb writes `.paper/STATE.json` or creates section directories during the Socratic question loop, before the user confirms they want to proceed to intake.
**Why it happens:** The developer reuses the `initState` call from the intake verb without realizing it's premature.
**How to avoid:** `sketch` must NOT call `initState`, must NOT create `.paper/`, and must NOT call `initLibrary` until after the user confirms the thesis and the verb calls `dispatchVerb('new', { args: { prefillThesis: ... } })`. The STATE.json guard in the router already routes a folder with no STATE.json to `new` — so sketch correctly routes there after confirmation.
**Warning signs:** `fs.mkdirSync('.paper', ...)` or `initState(cwd)` in `sketch.ts` before the approval gate.

### Pitfall 7: style-match over-fitting (per-section voice-hint override forgotten)
**What goes wrong:** The style profile's `voiceHint` is passed verbatim to every section, overriding the section-specific voice hints in OUTLINE.md (e.g., "terse for methods" becomes overridden by "long sentences like your samples").
**Why it happens:** The write verb passes `voiceHint: styleMatchToVoiceHint(profile)` without merging with the section-specific override from PLAN.md.
**How to avoid:** PLAN.md frontmatter already has a `voice_hint` field (confirmed in `bin/lib/revise.ts`). The write verb must: (a) read `voice_hint` from PLAN.md, (b) if non-empty, use PLAN.md voice_hint as the DrafterInput voiceHint (section override wins), (c) if empty, fall back to `styleMatchToVoiceHint(profile)`. This is the STYL-03 "per-section voice hints override style-match where they conflict" contract.
**Warning signs:** `voiceHint: styleMatchToVoiceHint(profile)` without a check for `planFrontmatter.voice_hint`.

---

## Code Examples

### Global Library Init + Registration Pattern
```typescript
// Source: bin/lib/library.ts + state.ts established patterns [VERIFIED: codebase]
// bin/lib/global-library.ts (new)
export async function registerPaperInGlobalLibrary(
  paperId: string,
  name: string,
  folderPath: string,
  paperClass: string,
): Promise<void> {
  const indexPath = pensmithGlobalLibraryIndexPath();
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await withLock(indexPath, async () => {
    let lib: GlobalLibrary;
    try {
      lib = await loadAndMigrate({ file: indexPath, schema: GlobalLibrarySchema, ... });
    } catch { lib = GlobalLibrarySchema.parse({ $schemaVersion: 1, entries: [] }); }
    const existing = lib.entries.findIndex(e => e.id === paperId);
    const entry: GlobalLibraryEntry = {
      id: paperId, name, folderPath: path.resolve(folderPath),
      class: paperClass || 'Unfiled', status: 'intake',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    if (existing >= 0) lib.entries[existing] = entry;
    else lib.entries.push(entry);
    await atomicWriteFile(indexPath, JSON.stringify(lib, null, 2) + '\n');
  });
}
```

### Style Profile Build Pattern
```typescript
// Source: [ASSUMED] — statistical NLP conventions; no third-party library
// bin/lib/style-match.ts (new)
export async function buildStyleProfile(samplesDir: string): Promise<StyleProfile> {
  const files = (await fs.promises.readdir(samplesDir))
    .filter(f => /\.(md|txt|docx)$/i.test(f));
  
  // Content fingerprint for cross-paper reuse detection
  const contentHashes = await Promise.all(
    files.map(async f => {
      const buf = await fs.promises.readFile(path.join(samplesDir, f));
      return createHash('sha256').update(buf).digest('hex');
    })
  );
  const fingerprint = createHash('sha256')
    .update(contentHashes.sort().join(''))
    .digest('hex');
  
  // Aggregate text from all samples
  const texts = await Promise.all(files.map(f =>
    fs.promises.readFile(path.join(samplesDir, f), 'utf8')
  ));
  const combined = texts.join('\n');
  
  // Sentence segmentation (simple but sufficient for bias signal)
  const sentences = combined.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s => s.trim().length > 0);
  const lengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  lengths.sort((a, b) => a - b);
  
  // Token-level stats
  const words = combined.toLowerCase().split(/\s+/).filter(Boolean);
  const uniqueWords = new Set(words);
  const ttr = uniqueWords.size / words.length;
  
  // Passive voice heuristic (was/were/is/are/been + past participle)
  const passiveRe = /\b(was|were|is|are|been|be)\s+\w+ed\b/gi;
  const passiveCount = (combined.match(passiveRe) ?? []).length;
  
  return StyleProfileSchema.parse({
    $schemaVersion: 1,
    samplesDir,
    sampleSetFingerprint: fingerprint,
    samplesAnalyzed: files.length,
    features: {
      medianSentenceLengthWords: lengths[Math.floor(lengths.length / 2)] ?? 0,
      p25SentenceLengthWords: lengths[Math.floor(lengths.length * 0.25)] ?? 0,
      p75SentenceLengthWords: lengths[Math.floor(lengths.length * 0.75)] ?? 0,
      typeTokenRatio: ttr,
      passiveVoiceRate: passiveCount / (sentences.length || 1),
      // ... opening/closing word distributions, paragraph length
    },
    generatedAt: new Date().toISOString(),
  });
}
```

### pymupdf Shellout Pattern
```typescript
// Source: [ASSUMED] — Node.js child_process pattern; no third-party library
// bin/lib/pymupdf-shellout.ts (new)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const execAsync = promisify(execFile);

const PYMUPDF_TIMEOUT_MS = 15_000; // 15s max for PDF extraction

export async function pymupdfShellout(buf: Buffer): Promise<string | null> {
  // Write to tmpfile — pymupdf needs a file path, not stdin
  const tmp = path.join(os.tmpdir(), `pensmith-pdf-${Date.now()}.pdf`);
  try {
    await fs.promises.writeFile(tmp, buf);
    const script = [
      'import sys, fitz',
      `doc = fitz.open("${tmp.replace(/\\/g, '/')}")`,
      'text = "".join(page.get_text() for page in doc)',
      'sys.stdout.write(text)',
    ].join('; ');
    const { stdout } = await execAsync('python3', ['-c', script], {
      timeout: PYMUPDF_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return typeof stdout === 'string' && stdout.length > 0 ? stdout : null;
  } catch {
    // ENOENT (python3 absent), non-zero exit (fitz not importable), timeout
    return null; // graceful degradation — never throw
  } finally {
    fs.promises.unlink(tmp).catch(() => {}); // cleanup, ignore errors
  }
}
```

### DrafterInput Style Integration (STYL-03)
```typescript
// Source: bin/lib/drafter-input.ts existing schema [VERIFIED: codebase]
// Proposed amendment to DrafterInputSchema:
export const DrafterInputSchema = z.object({
  // ... existing fields ...
  voiceHint: z.string(),                          // required — may carry style profile rendering
  styleProfilePath: z.string().optional(),        // path to .paper/STYLE.json when style enabled
}).strict();

// In bin/cli/write.ts, style integration:
// 1. Read planFrontmatter.voice_hint (section-specific override)
// 2. If non-empty → voiceHint = planFrontmatter.voice_hint (PLAN wins)
// 3. Else if .paper/STYLE.json exists → voiceHint = styleMatchToVoiceHint(profile)
//    AND styleProfilePath = path.join(paperDir(), 'STYLE.json')
// 4. Else → voiceHint = 'Formal academic tone.'
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Style-match via LLM featurization | Pure-stats extraction (sentence length, TTR, passive-voice heuristic) | Phase 8 decision (PRD §17 open question resolved) | Deterministic, offline-capable, zero per-profile cost |
| Single active paper = cwd | Global active-paper pointer at pensmithDataDir()/active.json | Phase 8 (LIB-03) | Enables `open` to switch context without cd |
| Library index as per-paper source store (LIBRARY.json) | TWO separate concepts: global paper registry (global-library.ts) + per-paper source store (library.ts) | Phase 8 clarification | Per-paper LIBRARY.json stays for citations; new global index for paper management |

**Deprecated/outdated:**
- `list.md`, `open.md`, `sketch.md`, `add.md` workflow stubs: to be filled with real content in Phase 8.
- `voiceHint: 'Formal academic tone (Tier-2 placeholder).'` hardcoded in `bin/cli/write.ts`: replace with dynamic resolution (PLAN override > style-match > default).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Style profile is built from pure statistical analysis (sentence length, TTR, passive-voice heuristic) with no LLM call at profile-build time | Standard Stack, Pattern 3 | If PRD §7.18 intends LLM featurization, the profile cost and latency are higher; would need budget gate |
| A2 | `sampleSetFingerprint` is a SHA-256 of sorted content hashes of all sample files (not path+mtime) | Pattern 3 | If path+mtime is acceptable, implementation is simpler; content-hash is more robust |
| A3 | The active-paper pointer lives at `pensmithDataDir()/active.json` and is set by `open` | Pattern 2 | If the pointer lives inside a paper folder, cross-directory `open` semantics need redesign |
| A4 | `voiceHint` (existing DrafterInputSchema field) is the sole load-bearing signal from style-match to the drafter, with `styleProfilePath` optional for richer Tier-1 reasoning | Pattern 3, STYL-03 | If the drafter cannot be adequately guided by a single rendered string, a more complex profile pass-through is needed |
| A5 | `add` for a URL that resolves to HTML (not PDF) attempts to extract a DOI from `<meta>` tags and retries as DOI | Pattern 6 | If URL handling is simpler (only DOI/PDF supported, URL must be a direct PDF link), the HTML scraping path is unnecessary |
| A6 | The `add` remap-sections approval gate updates only `assigned_sources[]` in PLAN.md frontmatter, NOT `status` or `verified_against_draft_hash` | Pattern 6 | If remap should also invalidate verify status, compile guard is bypassed for stale sections |
| A7 | pymupdf shellout writes a tmpfile (not stdin) because `fitz.open()` requires a file path | Pattern 5 | If fitz supports BytesIO (it does in newer versions), tmpfile can be avoided; but tmpfile is the safe cross-version approach |

---

## Open Questions

1. **Global library "name" field — user-chosen or derived?**
   - What we know: PRD §6 says "`/pensmith open <name>`"; the library maps "name → folder path".
   - What's unclear: Is the `name` set at `intake` (user prompt) or derived from the paper title?
   - Recommendation: Prompt at intake ("Paper name for library? (default: derived from title)") via `@clack/prompts`. Store user-provided name in config.toml `[project] name` and in global-library entry.

2. **`sketch` + `intake` handoff — same process or subprocess?**
   - What we know: `dispatchVerb('new', args)` is the shared dispatch helper; sketch can call it.
   - What's unclear: Does pre-filling `prefillThesis` require a new arg in `intakeCommand`?
   - Recommendation: Add an optional `--thesis` flag to `intakeCommand` (not a new verb). Sketch calls `dispatchVerb('new', { args: { thesis: synthesizedThesis } })`.

3. **Style-match with `.docx` files in samples folder**
   - What we know: PRD §7.18 says "folder of past writing samples" without specifying format.
   - What's unclear: Does the extractor need to parse `.docx` (requires `jszip` to unzip + XML parse) or only `.md`/`.txt`?
   - Recommendation: Support `.md` and `.txt` natively. For `.docx`, use `jszip` (already installed, used in `exporter.ts`) to extract `word/document.xml` and strip XML tags. Flag: this is medium complexity; if `.docx` is deferred, document the limitation in README.

4. **LIB-05 status auto-update — who writes the status?**
   - What we know: Each verb advances the paper through states; the global-library index needs to be updated.
   - What's unclear: Does each verb call `updateGlobalLibraryEntry` directly, or does the router update it after verb completion?
   - Recommendation: Each verb writes the status at the END of its successful run (research.ts updates to 'research', outline.ts to 'outline', etc.). The global-library update is a non-fatal side effect — if it fails, log a warning but don't fail the verb.

---

## Runtime State Inventory

> Included because Phase 8 adds a NEW global persistent file that must be accounted for.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `pensmithDataDir()/library/index.json` — NEW file; does not exist yet | Code creates on first `list`/`open`/`intake` that registers; no migration of existing data needed |
| Stored data | `pensmithDataDir()/style-fingerprints.json` — NEW file | Code creates on first style-match enable; no migration |
| Stored data | `.paper/STYLE.json` — NEW per-paper file | Written at intake for papers with style-match enabled; absent for others (no migration needed) |
| Stored data | `.paper/CITATIONS.bib` — EXISTING file, extended by `add` | `add` re-generates via `writeBibtex` (same pattern as research phase) |
| Stored data | `.paper/RESEARCH.md` — EXISTING file, extended by `add` | `add` appends a table row; no structural change to existing content |
| Live service config | None | — |
| OS-registered state | None | — |
| Secrets/env vars | None new | — |
| Build artifacts | None | — |

**Nothing found in category "Live service config", "OS-registered state", "Secrets/env vars":** Verified — Phase 8 introduces no new env vars, no new CI/CD state, and no OS-level registrations.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 20.10 | All verbs | ✓ | 24.16.0 | — |
| `pdf-parse` (npm) | RSCH-05b (primary path) | ✓ | 1.1.1 (exact) | — |
| `python3` | pymupdf shellout | ✓ | 3.13.14 | Return null (graceful skip) |
| `pymupdf` (fitz) | pymupdf shellout | Installed but `import fitz` failing on this machine | 1.27.2.3 (pip) | Return null — already the designed fallback |
| `proper-lockfile` | global-library.ts | ✓ | 4.1.2 | — |
| `@clack/prompts` | sketch + add approval gates | ✓ | installed | — |
| `citation-js` | add → CITATIONS.bib | ✓ | 0.7.22 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- `pymupdf/fitz`: The module is pip-installed (1.27.2.3) but `import fitz` fails in this environment (likely a binary/wheel compatibility issue with Python 3.13). The `pymupdfShellout` function already returns `null` on any subprocess failure — this is the designed graceful degradation path. No action required; fallback is built-in.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `tsx` (no jest/vitest) |
| Config file | `scripts/run-tests.mjs` (test runner) |
| Quick run command | `node --import tsx --test tests/global-library.test.ts tests/style-match.test.ts tests/pymupdf-shellout.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIB-01 | Global index init, lock, addEntry, forward-incompat | unit | `node --import tsx --test tests/global-library.test.ts` | ❌ Wave 0 |
| LIB-02 | `list` groups by class, shows status | unit (stdout capture) | `node --import tsx --test tests/list-verb.test.ts` | ❌ Wave 0 |
| LIB-03 | `open` writes active.json, subsequent `status` picks it up | unit | `node --import tsx --test tests/open-verb.test.ts` | ❌ Wave 0 |
| LIB-04 | Intake registers paper in global index with class | integration (stub LLM) | `node --import tsx --test tests/intake-library.test.ts` | ❌ Wave 0 |
| LIB-05 | Status lifecycle: intake→research→outline→sectioning→compile→done | unit (updateGlobalLibraryEntry) | `node --import tsx --test tests/global-library.test.ts` | ❌ Wave 0 |
| ERGO-05 | Sketch does NOT create .paper/ before confirm | unit | `node --import tsx --test tests/sketch-verb.test.ts` | ❌ Wave 0 |
| ERGO-06 | Add <doi> → CITATIONS.bib updated, remap gate shown | integration (cassette) | `node --import tsx --test tests/add-verb.test.ts` | ❌ Wave 0 |
| RSCH-05b | pdf-parse near-empty → pymupdf shellout called | unit (stub shellout) | `node --import tsx --test tests/pymupdf-shellout.test.ts` | ❌ Wave 0 |
| RSCH-05b | pymupdf absent → null returned, PDF still ingested with warning | unit | `node --import tsx --test tests/pymupdf-shellout.test.ts` | ❌ Wave 0 |
| STYL-01 | buildStyleProfile → STYLE.json written to .paper/, not global | unit | `node --import tsx --test tests/style-match.test.ts` | ❌ Wave 0 |
| STYL-02 | Cross-paper fingerprint match → notice surfaced unconditionally | unit | `node --import tsx --test tests/style-match.test.ts` | ❌ Wave 0 |
| STYL-03 | write verb: PLAN voice_hint overrides style-match | unit (DrafterInput assembly) | `node --import tsx --test tests/write-style-integration.test.ts` | ❌ Wave 0 |
| STYL-04 | README contains dual-use disclosure section | static (grep) | `node --import tsx --test tests/repo-files.test.ts` | ✅ (extend existing) |

### Sampling Rate

- **Per task commit:** `node --import tsx --test tests/global-library.test.ts tests/style-match.test.ts tests/pymupdf-shellout.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/global-library.test.ts` — covers LIB-01, LIB-05
- [ ] `tests/list-verb.test.ts` — covers LIB-02
- [ ] `tests/open-verb.test.ts` — covers LIB-03
- [ ] `tests/sketch-verb.test.ts` — covers ERGO-05
- [ ] `tests/add-verb.test.ts` — covers ERGO-06 (cassette-backed)
- [ ] `tests/pymupdf-shellout.test.ts` — covers RSCH-05b
- [ ] `tests/style-match.test.ts` — covers STYL-01, STYL-02
- [ ] `tests/write-style-integration.test.ts` — covers STYL-03
- [ ] `bin/lib/global-library.ts` — new library module
- [ ] `bin/lib/schemas/global-library.ts` — new schema
- [ ] `bin/lib/style-match.ts` — new style extractor
- [ ] `bin/lib/schemas/style.ts` — new style profile schema
- [ ] `bin/lib/pymupdf-shellout.ts` — new subprocess wrapper
- [ ] `bin/cli/list.ts`, `open.ts`, `sketch.ts`, `add.ts` — promote from stubs
- [ ] `pensmithGlobalLibraryIndexPath()` + `pensmithActivePointerPath()` — add to `paths.ts`
- [ ] `workflows/list.md`, `open.md`, `sketch.md`, `add.md` — fill stubs
- [ ] `README.md` — `## Style Match` dual-use disclosure section

---

## Security Domain

`security_enforcement: true` (config.json default).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `zod` for all schema inputs; `validateSlug` for section paths; `normalizeDoi` for DOI inputs |
| V6 Cryptography | partial | SHA-256 for fingerprint (one-way, non-secret — acceptable); no key material involved |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via user-supplied `samplesDir` | Tampering | `path.resolve(samplesDir)` + `isInsideSyncFolder` warning; only `.md`/`.txt`/`.docx` files processed |
| Path traversal via `add <pdf>` local path | Tampering | Only `Buffer` passed to `extractPdfText` (existing T-3-FS-01); `fs.readFile(resolvedPath)` with explicit `path.resolve` |
| Script injection via pymupdf shellout | Tampering | `tmpfile` path is generated internally (not from user input); the script string embeds the tmpfile path — sanitize with `path.resolve` and reject paths containing shell metacharacters |
| Cross-paper style reuse without disclosure | Information Disclosure | STYL-02 unconditional notice; fingerprint registry is local only |
| Crossref hydration leaking PDF content | Information Disclosure | PRD §9 documents: "only the title — not the full text" leaves the box; crossref call uses `fetchById(doi)` or `search(title)` — no PDF content sent |
| Global library index corruption by concurrent `open` + `add` | Denial of Service | `proper-lockfile` via `withLock` on the index file (same pattern as library.ts) |

---

## Sources

### Primary (HIGH confidence)
- `bin/lib/library.ts`, `bin/lib/state.ts`, `bin/lib/paths.ts` — established patterns for global-library.ts [VERIFIED: codebase read]
- `bin/lib/pdf-text.ts` — confirmed `extractPdfText` API + near-empty heuristic + debug-shim workaround [VERIFIED: codebase read]
- `bin/lib/bibtex-write.ts` + `bin/lib/citekey.ts` — confirmed `add` can reuse `writeBibtex` + `generateCitekey` [VERIFIED: codebase read]
- `bin/lib/drafter-input.ts` — confirmed `voiceHint` is required z.string(); `styleProfilePath` addition is additive-only [VERIFIED: codebase read]
- `bin/lib/verbs.ts` — confirmed `list`, `open`, `sketch`, `add` are existing members of UX02_VERBS [VERIFIED: codebase read]
- `bin/pensmith.ts` — confirmed REAL_VERB_LOADERS pattern for promoting stubs [VERIFIED: codebase read]
- `tests/tier-contract.test.ts` — confirmed 16-verb bijection enforcement [VERIFIED: codebase read]
- `package.json` — confirmed all Phase 8 deps already installed; pdf-parse@1.1.1 exact pin confirmed [VERIFIED: codebase read]
- `PRD.md §6, §7.15, §7.16, §7.18, §9` — locked PRD requirements for library, add, sketch, style-match, BYO PDF [VERIFIED: PRD read]
- `REQUIREMENTS.md` — confirmed LIB-01..05, ERGO-05/06, RSCH-05b, STYL-01..04 Phase 8 assignment [VERIFIED: codebase read]

### Secondary (MEDIUM confidence)
- `pip show pymupdf` output: PyMuPDF 1.27.2.3 installed on this machine; `import fitz` failing (binary compatibility issue) [VERIFIED: environment probe]
- `slopcheck install pdf-parse proper-lockfile` → both [OK] [VERIFIED: slopcheck run]
- `npm view pdf-parse` → version 1.1.1 exists on registry, published 2018-01-07 [VERIFIED: npm registry]

### Tertiary (LOW confidence)
- Style-profile feature set (sentence length, TTR, passive-voice heuristic, opening-word distribution): [ASSUMED] based on standard computational stylometry conventions — no Context7 or official docs consulted for this specific combination

---

## Metadata

**Confidence breakdown:**
- Library mode (LIB): HIGH — codebase patterns fully understood; proper-lockfile already used; paths.ts already has pensmithDataDir()
- Style-match (STYL): MEDIUM — feature set is [ASSUMED]; implementation approach is well-reasoned from PRD constraints; no precedent in codebase
- Sketch (ERGO-05): HIGH — state-machine constraint is clear; LLM dispatch via runtime.ts is established pattern
- Add (ERGO-06): HIGH — all required chokepoints exist; RSCH-05b pymupdf shellout is a straightforward subprocess pattern
- BYO PDF / pymupdf (RSCH-05b): HIGH for architecture; MEDIUM for pymupdf compatibility (import fails on this machine despite pip install)
- Tier bijection: HIGH — 16-verb invariant is multiply guarded; all four verbs are existing members

**Research date:** 2026-06-19
**Valid until:** 2026-07-19 (stable stack; 30-day validity)
