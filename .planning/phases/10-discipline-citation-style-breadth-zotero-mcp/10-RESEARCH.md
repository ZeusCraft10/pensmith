# Phase 10: Discipline + Citation-Style Breadth + Zotero MCP — Research

**Researched:** 2026-06-20
**Domain:** citation rendering (CSL/citeproc-js via citation-js), RIS export, Zotero MCP source provider, discipline-preset schema completion
**Confidence:** HIGH

---

## Summary

Phase 10 closes four open requirements that were explicitly deferred from earlier phases: CITE-02 (MLA/Chicago/IEEE/AMA/Vancouver styles), CITE-03 (Harvard), CITE-05 (RIS export), and RSCH-06 (Zotero MCP source provider). The work does NOT gate v0.1.0 launch — these are breadth additions on an already-working v0.1.0 skeleton.

**Key finding — no new npm packages required.** `citation-js@0.7.22` (already installed, pinned in `package.json`) bundles `@citation-js/plugin-csl` and `@citation-js/plugin-ris` as its own declared dependencies. Both are already installed in `node_modules/@citation-js/`. RIS export (`cite.format('ris')`) is verified working in the current project context. The only new artifacts are bundled `.csl` files from the official CSL styles repository (MIT/CC-BY-SA, fetched once at build/planning time and committed to `templates/citation-styles/`).

The discipline-preset schema (`templates/presets/disciplines.json`) currently carries only `defaultTone` and `defaultCitationStyle` per entry. Phase 10 expands it to include `sourcePreference`, `sectioningConvention`, `counterargDefault`, and `densityTarget` — the fields specified in PRD §8 that earlier phases stubbed or left absent. The intake-clarifier prompt must be updated to offer all newly-supported styles, and the `exporter.ts` path must be extended to also copy `.paper/CITATIONS.ris` into the export bundle alongside `.bib`.

The Zotero MCP integration is detection-first, absence-non-breaking. The doctor probe (`zotero-mcp-presence.ts`) already exists and reports PASS/WARN. The new work is: (a) a Zotero source adapter in `bin/lib/sources/zotero-mcp.ts`, (b) registration in `bin/lib/sources/index.ts` under the `AdapterName` union, (c) gating every Zotero call behind `isZoteroMcpPresent()` so absence degrades to a no-op with a logged WARN (same pattern as Pandoc and humanizer), and (d) updating the `<capability_check>` block in `workflows/research.md`.

**Primary recommendation:** Treat this phase as three independent wave groups: (A) CSL file procurement + `citations.ts` `renderStyle()` function + discipline preset schema expansion; (B) RIS writer + `exporter.ts` bundle extension + `bibtex-write.ts` sibling; (C) Zotero adapter + source registry update + capability_check wiring.

---

## Project Constraints (from CLAUDE.md)

- **Section-as-phase is non-negotiable.** Not directly affected by this phase but must not regress.
- **Verifier gate + zero-trace must not weaken.** RIS file in export bundle carries no pensmith fingerprint (same treatment as BibTeX — plain-text data, no metadata fields to scrub).
- **Two-tier architecture.** Every new function in `bin/lib/` must be callable from both Tier 1 (Claude Code) and Tier 2 (CLI). Zotero MCP is Tier 1 only when the MCP tool surface is used; Tier 2 must degrade cleanly.
- **All network via `bin/lib/http.ts`.** Zotero MCP calls in Tier 1 flow through the MCP protocol, not `http.ts`. But any Zotero Web API fallback (if ever added) MUST use `http.ts`.
- **16-verb locked set + 16-workflow bijection.** Zotero is a source provider + doctor probe. Zero new verbs.
- **No hand-rolled citation formatter** (from REQUIREMENTS.md Out-of-Scope). CITE-04 already resolved this with CSL via citeproc-js. Phase 10 extends that — never re-opens the hand-roll question.
- **`templates/` is in the `files` array** in `package.json`. New `.csl` files in `templates/citation-styles/` are automatically published. No `package.json` change needed.
- **ESLint chokepoint:** `citation-js` import is restricted to `bin/lib/citations.ts` only (D-19). Any new style renderer must live in or be exported from `citations.ts`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RSCH-06 | Zotero MCP source provider when detected and authenticated | §Architecture Patterns: Zotero MCP Adapter; built-in degrade pattern via `isZoteroMcpPresent()` |
| CITE-02 | MLA, Chicago (notes-bib + author-date), IEEE, AMA, Vancouver via CSL | §Standard Stack: CSL files confirmed at official CSL repo; `citation-js` renders all via `plugins.config.get('@csl').templates.add()` |
| CITE-03 | Harvard citation style (UK/AU audiences) | `harvard-cite-them-right.csl` confirmed at official CSL repo; same rendering path |
| CITE-05 | RIS export alongside BibTeX for Mendeley/EndNote interop | `cite.format('ris')` verified working in current project; `@citation-js/plugin-ris` already installed |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CSL template registration + style rendering | `bin/lib/citations.ts` (D-19 chokepoint) | — | All citation-js calls restricted to this file by ESLint no-restricted-imports rule |
| RIS serialization (`writeRis`) | `bin/lib/ris-write.ts` (new, mirrors `bibtex-write.ts`) | — | Sibling serializer; same chokepoint imports |
| Export bundle: copy `.ris` alongside `.bib` | `bin/lib/exporter.ts` | — | DONE-08 extension; `exportDraft` already handles `.bib` copy |
| Discipline preset schema (source preference, sectioning, density) | `templates/presets/disciplines.json` | — | Template data, consumed by workflow bodies + `citation-density.ts` |
| Style selection: discipline → CSL name | `bin/lib/citations.ts` (new `resolveStyleName()`) | — | Keeps style-to-CSL mapping collocated with rendering |
| Zotero MCP presence detection | `bin/lib/ecosystem-presence.ts` (exists) | — | Already shared between doctor probes and capabilities |
| Zotero source adapter | `bin/lib/sources/zotero-mcp.ts` (new) | — | Follows 7-adapter pattern; registered in `sources/index.ts` |
| Zotero in AdapterName union | `bin/lib/sources/index.ts` | — | Single registry; consumers iterate generically |
| Doctor auth-state probe | `bin/lib/doctor/probes/zotero-mcp-presence.ts` (exists — extend) | — | Probe already lands PASS/WARN; extend to check auth env vars |
| `<capability_check>` update | `workflows/research.md` | — | Declares Zotero presence/absence inline fallback |
| intake-clarifier prompt update | `templates/prompts/intake-clarifier.md` | — | Currently says "APA is the only option in this build" — remove that caveat |

---

## Standard Stack

### Core (no new installs — all already in node_modules)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `citation-js` | `0.7.22` (pinned, installed) | Parse BibTeX → CSL-JSON; render any CSL style; export RIS | Already the D-19 LOCKED chokepoint; bundles plugin-csl + plugin-ris |
| `@citation-js/plugin-csl` | `0.7.22` (transitive dep, installed) | CSL rendering via citeproc-js | Bundled as `citation-js` dependency; no separate install needed |
| `@citation-js/plugin-ris` | `0.7.21` (transitive dep, installed) | RIS output format | Bundled as `citation-js` dependency; `cite.format('ris')` already works |
| `citeproc` | `2.4.63` (transitive dep, installed) | The underlying CSL processor (Juris-M/Frank Bennett) | Used by `@citation-js/plugin-csl` internally |

**Confirmed working in project (no install):**
```
$ node --input-type=module: cite.format('ris') → "TY  - JOUR\nAU  - ..." (81 chars) ✓
$ node --input-type=module: cite.format('bibliography', {template:'apa'}) → "Smith, J. (2023)..." ✓
```

[VERIFIED: npm registry + live node execution in project]

### New Artifacts (CSL files to download and commit)

| File | Source URL | Pensmith path | Style |
|------|-----------|---------------|-------|
| `modern-language-association.csl` | `github.com/citation-style-language/styles/blob/master/modern-language-association.csl` | `templates/citation-styles/mla.csl` | MLA 9th ed. |
| `chicago-fullnote-bibliography.csl` | `github.com/citation-style-language/styles-distribution/blob/master/chicago-fullnote-bibliography.csl` | `templates/citation-styles/chicago-notes-bib.csl` | Chicago 17th (full note + bibliography) |
| `chicago-author-date.csl` | `github.com/citation-style-language/styles/blob/master/chicago-author-date.csl` | `templates/citation-styles/chicago-author-date.csl` | Chicago 18th (author-date) |
| `ieee.csl` | `github.com/citation-style-language/styles/blob/master/ieee.csl` | `templates/citation-styles/ieee.csl` | IEEE Reference Guide v11.29.2023 |
| `american-medical-association.csl` | `github.com/citation-style-language/styles/blob/master/american-medical-association.csl` | `templates/citation-styles/ama.csl` | AMA 11th ed. (JAMA) |
| `vancouver.csl` | `github.com/citation-style-language/styles/blob/master/vancouver.csl` | `templates/citation-styles/vancouver.csl` | Vancouver (ICMJE) |
| `harvard-cite-them-right.csl` | `github.com/citation-style-language/styles/blob/master/harvard-cite-them-right.csl` | `templates/citation-styles/harvard.csl` | Harvard Cite Them Right (UK/AU standard) |

**Already shipped:** `templates/citation-styles/apa.csl` (Phase 3)

**License:** All CSL styles at `citation-style-language/styles` are CC-BY-SA 3.0. Attribution is in each file's `<rights>` element. No README change needed — the files themselves carry attribution.

**Important filename notes:**
- `chicago-note-bibliography.csl` does NOT exist in the main `citation-style-language/styles` repo (404 confirmed). Use `chicago-fullnote-bibliography.csl` from the `styles-distribution` repo — confirmed title: "Chicago Manual of Style 17th edition (full note)".
- `chicago-author-date.csl` in the main repo now implements **CMOS 18th edition** (confirmed from file title element).
- `harvard-cite-them-right.csl` is the canonical "Harvard" style used in UK/AU institutions.

[CITED: github.com/citation-style-language/styles (official CSL repo)]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bundled `.csl` files (committed to repo) | Fetch `.csl` at render time from Zotero Style Repo | Fetching at render time violates offline-determinism requirement; bundled files guarantee hermetic offline tests |
| `harvard-cite-them-right.csl` | `harvard-limerick.csl` or others | `harvard-cite-them-right` is the de-facto standard for UK/AU; "Cite Them Right" is the most widely referenced Harvard guide |
| `chicago-fullnote-bibliography.csl` | `chicago-note-bibliography-with-ibid.csl` | ibid variant adds complication for most users; full-note without ibid is simpler and more commonly required |

**Installation:** No new `npm install` — all runtime dependencies are already installed as transitive deps of `citation-js`. Only action: `curl`/`wget` the seven `.csl` files from the CSL GitHub repos and commit them to `templates/citation-styles/`.

---

## Package Legitimacy Audit

No new npm packages are installed in this phase. All rendering capability already exists via `citation-js@0.7.22` and its bundled transitive dependencies.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@citation-js/plugin-csl` | npm | 8+ yrs | ~50K/wk | github.com/citation-js/citation.js | [OK] | Already installed — no action |
| `@citation-js/plugin-ris` | npm | 8+ yrs | ~50K/wk | github.com/citation-js/citation.js | [OK] | Already installed — no action |
| `citeproc` | npm | 10+ yrs | ~200K/wk | github.com/Juris-M/citeproc-js | [OK] | Already installed — no action |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

slopcheck output (run 2026-06-20):
```
[OK] @citation-js/plugin-csl (npm)
[OK] citeproc (npm)
[OK] @citation-js/plugin-ris (npm)
```

[VERIFIED: npm registry + slopcheck run]

---

## Architecture Patterns

### System Architecture Diagram

```
User picks "IEEE" at intake
         |
         v
config.toml: citation_style = "ieee"
         |
         v
  [citations.ts: resolveStyleName("ieee")]
         |
         v
  Load templates/citation-styles/ieee.csl   (bundled, offline)
         |
         v
  plugins.config.get('@csl').templates.add('pensmith-ieee', cslString)
         |
         v
  cite.format('bibliography', {template:'pensmith-ieee', format:'text'})
         |
         v
  bibliography string → CITATIONS.bib section / export render

Export path (DONE-08 extension):
  exportDraft() → copy CITATIONS.bib → copy CITATIONS.ris (new)
                 both land in .paper/export/

Zotero path (RSCH-06, Tier 1 only):
  isZoteroMcpPresent() === true
         |
         v
  zotero-mcp adapter.search(query)
  → MCP tool call to Zotero MCP server
  → SourceCandidate[] (same shape as other adapters)
  → merged into sources registry results

  isZoteroMcpPresent() === false
         |
         v
  WARN log "Zotero MCP not configured — skipping"
  → research continues offline-only (no throw)
```

### Recommended Project Structure (Phase 10 additions only)

```
templates/citation-styles/
├── apa.csl               (already shipped Phase 3)
├── mla.csl               (NEW — download from CSL repo)
├── chicago-notes-bib.csl (NEW)
├── chicago-author-date.csl (NEW)
├── ieee.csl              (NEW)
├── ama.csl               (NEW)
├── vancouver.csl         (NEW)
└── harvard.csl           (NEW)

bin/lib/
├── citations.ts          (EXTEND — add resolveStyleName(), renderStyle(), memoize per style)
├── ris-write.ts          (NEW — sibling to bibtex-write.ts; writeRis(candidates, targetPath))
├── exporter.ts           (EXTEND — copy CITATIONS.ris alongside CITATIONS.bib in exportDraft)
└── sources/
    ├── index.ts          (EXTEND — add 'zotero-mcp' to sources const + AdapterName union)
    └── zotero-mcp.ts     (NEW — Zotero MCP source adapter)

templates/presets/
└── disciplines.json      (EXTEND — add sourcePreference, sectioningConvention,
                           counterargDefault, densityTarget per PRD §8)

templates/prompts/
└── intake-clarifier.md   (UPDATE — remove "APA is the only option"; list all 7 styles)
```

### Pattern 1: Style Registration Memoization (mirrors existing `renderApa`)

The existing `renderApa` function in `citations.ts` uses a module-level boolean flag `apaRegistered` + `ensureApaTemplate()`. Phase 10 generalizes this to a `Map<string, boolean>` keyed by style name so all 7 styles can be memoized in one process run.

```typescript
// Source: bin/lib/citations.ts (existing pattern, generalized)
const registeredStyles = new Map<string, boolean>();

function ensureStyleTemplate(name: string, cslPath: string): void {
  if (registeredStyles.get(name)) return;
  const cslString = readFileSync(cslPath, 'utf8');
  const cslPlugin = plugins.config.get('@csl');
  cslPlugin.templates.add(`pensmith-${name}`, cslString);
  registeredStyles.set(name, true);
}

export async function renderStyle(
  entries: Array<Record<string, unknown>>,
  style: string,  // 'apa' | 'mla' | 'chicago-notes-bib' | 'chicago-author-date' | 'ieee' | 'ama' | 'vancouver' | 'harvard'
): Promise<string> {
  const cslPath = path.join(PKG_ROOT, 'templates', 'citation-styles', `${styleToFilename(style)}.csl`);
  if (!existsSync(cslPath)) {
    throw new Error(`renderStyle: CSL file not found for style '${style}' at ${cslPath}`);
  }
  ensureStyleTemplate(style, cslPath);
  const cite = new Cite(entries, { forceType: '@csl/object' });
  return cite.format('bibliography', {
    format: 'text',
    template: `pensmith-${style}`,
    lang: 'en-US',
  });
}
```

[ASSUMED — exact function signature; planner should verify against citation-render.test.ts Wave 0 contract before locking]

### Pattern 2: RIS Serializer (mirrors `bibtex-write.ts`)

`@citation-js/plugin-ris` is already loaded (bundled in `citation-js`). The `writeRis` function follows the identical shape as `writeBibtex` — same citekey collision logic, same sort, same atomic write:

```typescript
// Source: bin/lib/ris-write.ts (new file, mirrors bibtex-write.ts)
import { Cite } from './citations.js';
import { atomicWriteFile } from './atomic-write.js';
import { generateCitekey } from './citekey.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

export async function writeRis(
  candidates: SourceCandidate[],
  targetPath: string,
): Promise<void> {
  // ... (same toCsl() + collision loop as bibtex-write.ts) ...
  const cite = new Cite(entries.map(e => e.csl));
  const ris = cite.format('ris', { spec: 'new', format: 'text' });
  await atomicWriteFile(targetPath, ris);
}
```

**Key:** `cite.format('ris', { spec: 'new', format: 'text' })` is verified working in the project:
```
RIS output: TY  - JOUR\nAU  - Smith, John\nDA  - 2023///\nPY  - 2023\nDO  - 10.1234/test.2023\nID  - test2023\nTI  - Test Paper\nER  -
```

[VERIFIED: live node execution in project]

### Pattern 3: Zotero MCP Adapter (absence-non-breaking)

```typescript
// Source: bin/lib/sources/zotero-mcp.ts (new)
import { isZoteroMcpPresent } from '../ecosystem-presence.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

// RSCH-06: Zotero MCP source provider — ONLY called when present AND authenticated.
// Absence is a WARN not a FAIL. The research orchestrator guards every call with
// the presence check (same pattern as isPandocPresent / isHumanizerSkillPresent).

export async function search(query: string, _limit = 10): Promise<SourceCandidate[]> {
  if (!isZoteroMcpPresent()) {
    // Logged by caller — return empty rather than throw.
    return [];
  }
  // In Tier 1: Zotero MCP tools are called via the Claude Code Task tool
  // (the workflow body delegates, not this module directly).
  // In Tier 2: no MCP transport → graceful empty return.
  // This adapter is a TYPE-REGISTRAR + PRESENCE GUARD; the actual MCP call
  // happens at the workflow level via <capability_check>.
  return [];
}
```

**Registration in `sources/index.ts`:**
```typescript
import * as zoteroMcp from './zotero-mcp.js';

export const sources = {
  crossref,
  openalex,
  arxiv,
  pubmed,
  semanticscholar,
  unpaywall,
  'retraction-watch': retractionWatch,
  'zotero-mcp': zoteroMcp,  // NEW — presence-gated; search() returns [] when absent
} as const;
```

**The degrade contract (ARCH-03 requirement):** The `<capability_check>` block in `workflows/research.md` must declare `Zotero MCP` and its inline fallback. When the MCP is absent, the workflow body skips the Zotero pull step and notes it in the research log — research continues with the other 7 adapters.

### Pattern 4: Discipline Preset Schema Completion

PRD §8 specifies four fields per preset that `disciplines.json` currently lacks:

```json
{
  "computer-science": {
    "defaultTone": "technical",
    "defaultCitationStyle": "ieee",
    "sourcePreference": ["arxiv", "semanticscholar", "openalex"],
    "sectioningConvention": ["Abstract", "Introduction", "Related Work", "Methods", "Results", "Conclusion"],
    "counterargDefault": "off",
    "densityTarget": { "low": 10, "center": 20, "high": 30 }
  }
}
```

The `citation-density.ts` currently hard-codes a separate `DISCIPLINE_TARGETS` map with center values only. Phase 10 should either:
- (A) Move density targets into `disciplines.json` and load from there, or
- (B) Keep `DISCIPLINE_TARGETS` in `citation-density.ts` and add the new fields only to `disciplines.json`

**Recommendation: Option B** — keep `DISCIPLINE_TARGETS` in `citation-density.ts` (it is a pure computational concern already tested), add the other three fields to `disciplines.json` only. Avoids a breaking change to the density module's tests. [ASSUMED — needs planner confirmation]

### Anti-Patterns to Avoid

- **Fetching CSL files at render time:** Never call any network endpoint to retrieve `.csl` content during rendering. All `.csl` files MUST be committed to `templates/citation-styles/` and read via `readFileSync`. Offline tests must pass.
- **Registering templates more than once per process:** citation-js throws `"template already registered"` on a second `templates.add(name, ...)` call with the same name. The memoization Map guards against this.
- **Importing `citation-js` directly outside `citations.ts`:** The D-19 ESLint chokepoint. `ris-write.ts` must import `{ Cite }` from `'./citations.js'` (the re-export), not from `'citation-js'`.
- **Zotero MCP absence throwing:** The adapter must return `[]` not throw when Zotero is absent. The verifier gate must never be conditional on a Zotero call that can fail.
- **Adding a 17th verb for Zotero:** Explicitly forbidden. Zotero is a source provider inside `research`, not a new verb.
- **Storing Zotero API keys in any state file:** Auth is detected via env vars (same pattern as `PENSMITH_CONTACT_EMAIL`). Values never reach disk (T-01-07 no-leak property).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Citation formatting for MLA/Chicago/IEEE | Custom formatters | `citation-js` + bundled `.csl` files | The Out-of-Scope list in REQUIREMENTS.md explicitly bans hand-rolled citation formatters; CSL via citeproc-js handles 10,000+ styles correctly |
| RIS serialization | Custom string builder | `citation-js` `cite.format('ris')` | `@citation-js/plugin-ris` already installed; handles RIS2001 new spec, field mapping, multi-author |
| Zotero API client | Hand-rolled HTTP calls to Zotero Web API | Zotero MCP tool calls via Claude Code Task | The MCP server handles auth, pagination, and field normalization |
| CSL locale resolution | Custom locale loading | Built-in `citeproc` locales (bundled in `@citation-js/plugin-csl`) | `citeproc` ships `locales-en-US.xml` etc.; no manual locale loading needed for English-language output |

**Key insight:** The entire citation rendering problem is already solved by `citation-js` + the official CSL repository. Phase 10's work is configuration + file procurement, not new algorithm development.

---

## Common Pitfalls

### Pitfall 1: Template Name Collision (citeproc "already registered" error)
**What goes wrong:** Calling `templates.add('pensmith-apa', ...)` twice in the same process throws. The current `renderApa` uses a single boolean flag; generalizing to N styles needs a Map keyed by style name.
**Why it happens:** `citation-js`'s template registry has no idempotency — it rejects duplicate names rather than silently overwriting.
**How to avoid:** Use `registeredStyles.get(name)` check before every `templates.add()` call. Test with two back-to-back `renderStyle('ieee')` calls.
**Warning signs:** `Error: citeproc template already registered` in tests.

### Pitfall 2: Wrong CSL Filename for Chicago Notes-Bib
**What goes wrong:** `chicago-note-bibliography.csl` does NOT exist in the main `citation-style-language/styles` repo (404 confirmed during research). Using that filename as a download target silently fails or downloads a 404 page.
**Why it happens:** The style lives in the `styles-distribution` fork under a different name: `chicago-fullnote-bibliography.csl`.
**How to avoid:** Download from `github.com/citation-style-language/styles-distribution/blob/master/chicago-fullnote-bibliography.csl`.
**Warning signs:** The downloaded `.csl` file is a GitHub 404 HTML page rather than XML — catch this by checking that the file starts with `<?xml` or `<style`.

### Pitfall 3: `chicago-author-date.csl` is now CMOS 18th Edition
**What goes wrong:** The plan or code comments say "CMOS 17th" but the current `chicago-author-date.csl` implements CMOS 18th (confirmed from file's title element). Misleading comments cause user confusion.
**Why it happens:** The CSL repo updated to CMOS 18th in 2024.
**How to avoid:** The file title says "Chicago Manual of Style 18th edition (author-date)". Ensure PRD §8's "Chicago Author-Date" entry and all code comments reference 18th edition.

### Pitfall 4: RIS `spec:'mixed'` vs `spec:'new'`
**What goes wrong:** `spec:'mixed'` (the default) may produce `TY  -` tags from the older RIS1 spec that Mendeley/EndNote accept but some newer tools reject. `spec:'new'` produces RIS2001-compliant output.
**Why it happens:** The `@citation-js/plugin-ris` `spec` option controls which RIS tag variant is used.
**How to avoid:** Use `spec:'new'` in `writeRis` for maximum interop. Add a test fixture asserting the output contains `TY  - JOUR` (RIS2001 standard journal tag) not the legacy variant.

### Pitfall 5: Chicago Full-Note vs Short-Title-Subsequent
**What goes wrong:** `chicago-fullnote-bibliography.csl` uses full author-title on every note repetition. Academic users may prefer `chicago-fullnote-bibliography-short-title-subsequent.csl` (abbreviated subsequent notes). Shipping full-note without disclosure surprises users.
**Why it happens:** The "correct" Chicago variant depends on the journal/institution's style guide.
**How to avoid:** Ship `chicago-fullnote-bibliography.csl` and document in the doctor/intake output that it uses full notes (not Ibid. / short title). CITE-02 does not mandate a specific variant — the planner should pick the most common one (full note).

### Pitfall 6: Zotero MCP "configured but not authenticated"
**What goes wrong:** `isZoteroMcpPresent()` checks for a `zotero`-named entry in `mcp_servers.json` — but doesn't verify that `ZOTERO_API_KEY` is set. A user can have the server configured without an auth token, causing silent tool failures.
**Why it happens:** MCP server config (the presence) and authentication (env var) are two separate things.
**How to avoid:** Extend the `zotero-mcp-presence` doctor probe to also check for `ZOTERO_API_KEY` env var presence (not value — T-01-07). PASS = configured AND key present. WARN-CONFIGURED-NO-AUTH = configured but key absent. WARN-ABSENT = not configured at all. The WARN variant should say "Zotero configured but ZOTERO_API_KEY not set — Zotero sources will be skipped."

### Pitfall 7: `disciplines.json` defaultCitationStyle drift vs available `.csl` files
**What goes wrong:** `disciplines.json` sets `"defaultCitationStyle": "chicago-author-date"` for History and Philosophy — but until Phase 10 ships `chicago-author-date.csl`, any code that tries to load the preset's default CSL file will fail.
**Why it happens:** The preset value was set in Phase 8/9 but the CSL file was explicitly deferred.
**How to avoid:** Ship all 7 `.csl` files atomically in Wave 0 of Phase 10 before any code tries to read them. The intake-clarifier update should happen in the same wave so it starts offering the new styles only once the files exist.

### Pitfall 8: ESLint `no-restricted-imports` catches `ris-write.ts` importing `citation-js` directly
**What goes wrong:** The new `ris-write.ts` file imports `Cite` to construct the RIS output. If the import says `from 'citation-js'` instead of `from './citations.js'`, the ESLint chokepoint fires in CI.
**Why it happens:** D-19 ESLint rule bans `citation-js` imports everywhere except `bin/lib/citations.ts`. `citations.ts` already re-exports `Cite` for exactly this purpose.
**How to avoid:** `import { Cite } from './citations.js'` in `ris-write.ts` — same pattern as `bibtex-write.ts` (which already does this correctly).

---

## Code Examples

### CSL Template Registration and Multi-Style Rendering

```typescript
// Source: bin/lib/citations.ts (generalized from existing renderApa pattern)
// Key verified finding: citation-js 0.7.22 bundles @citation-js/plugin-csl;
// plugins.config.get('@csl').templates.add() is the authoritative registration API.

const registeredStyles = new Map<string, boolean>();

const STYLE_FILENAMES: Record<string, string> = {
  'apa': 'apa',
  'mla': 'mla',
  'chicago-notes-bib': 'chicago-notes-bib',
  'chicago-author-date': 'chicago-author-date',
  'ieee': 'ieee',
  'ama': 'ama',
  'vancouver': 'vancouver',
  'harvard': 'harvard',
};

function ensureStyleTemplate(style: string): void {
  const internalName = `pensmith-${style}`;
  if (registeredStyles.get(style)) return;
  const filename = STYLE_FILENAMES[style] ?? style;
  const cslPath = path.join(PKG_ROOT, 'templates', 'citation-styles', `${filename}.csl`);
  const cslString = readFileSync(cslPath, 'utf8');
  plugins.config.get('@csl').templates.add(internalName, cslString);
  registeredStyles.set(style, true);
}

export async function renderStyle(
  entries: Array<Record<string, unknown>>,
  style: string,
): Promise<string> {
  ensureStyleTemplate(style);
  const cite = new Cite(entries, { forceType: '@csl/object' });
  return cite.format('bibliography', {
    format: 'text',
    template: `pensmith-${style}`,
    lang: 'en-US',
  });
}
```

### RIS Export via citation-js plugin-ris

```typescript
// Source: verified via live node execution in project 2026-06-20
// cite.format('ris', { spec: 'new', format: 'text' }) produces:
//   TY  - JOUR
//   AU  - Smith, John
//   DA  - 2023///
//   PY  - 2023
//   DO  - 10.1234/test.2023
//   ID  - test2023
//   TI  - Test Paper
//   ER  -

export async function writeRis(
  candidates: SourceCandidate[],
  targetPath: string,
): Promise<void> {
  // Same collision-loop + sort as writeBibtex
  const entries = buildCslEntries(candidates);  // reuse toCsl() logic
  let ris = '';
  if (entries.length > 0) {
    const cite = new Cite(entries.map(e => e.csl));
    ris = (cite as { format: (...args: unknown[]) => string })
      .format('ris', { spec: 'new', format: 'text' });
  }
  await atomicWriteFile(targetPath, ris);
}
```

### exportDraft Extension (DONE-08 RIS bundle)

```typescript
// Source: bin/lib/exporter.ts — extend the existing bibCopied pattern
// At the end of exportDraft(), after the existing .bib copy:

let risCopied = false;
const risSrc = join(paperDir(opts.paperRoot), 'CITATIONS.ris');
const risDst = join(exportDir, 'CITATIONS.ris');
if (risSrc !== risDst && existsSync(risSrc)) {
  await fsp.copyFile(risSrc, risDst);
  risCopied = true;
}

return { outputPath, format, pandocUsed, bibCopied, risCopied };
```

Note: `ExportResult` interface must be extended to include `risCopied: boolean`.

### Zotero MCP Auth State Check (extended doctor probe)

```typescript
// Source: bin/lib/doctor/probes/zotero-mcp-presence.ts (extend existing probe)
// Extend to distinguish: ABSENT / CONFIGURED_NO_AUTH / PASS

const apiKeyEnv = 'ZOTERO_API_KEY';
const configured = isZoteroMcpPresent();
const authenticated = configured && !!process.env[apiKeyEnv];

if (!configured) {
  return { id, severity: 'WARN', summary: 'Zotero MCP not configured — skipping' };
}
if (!authenticated) {
  return { id, severity: 'WARN', summary: `Zotero MCP configured but ${apiKeyEnv} not set — sources will be skipped` };
}
return { id, severity: 'PASS', summary: 'Zotero MCP configured and authenticated' };
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled APA formatter (banned) | `citation-js` + bundled CSL (CITE-04, Phase 3) | Phase 3 | All 10,000+ CSL styles now reachable via the same API |
| `chicago-author-date.csl` = CMOS 17th | Same filename now implements CMOS 18th | 2024 (CSL repo update) | Plans that say "CMOS 17th" are outdated; use "18th" in code comments |
| RIS as separate dep | `@citation-js/plugin-ris` bundled in `citation-js` | 0.7.x (2023+) | Zero new deps for RIS export |
| Zotero integration via REST API | Zotero MCP (absence-tolerant, Tier 1) | 2024 (MCP era) | No API key needed for local Zotero; web API needs `ZOTERO_API_KEY` |

**Deprecated/outdated:**
- The note in `intake-clarifier.md` that says "APA is the only option in this build" — this is an explicit Phase 10 target to remove.
- `disciplines.json` entries that map CS to `apa` rather than `ieee` — PRD §8 says CS should default to IEEE. Phase 10 corrects this.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `renderStyle()` function signature (entries + style string) is compatible with existing `citation-render.test.ts` Wave 0 contract | Code Examples | The existing test imports `renderApa` specifically; if it also tests `renderStyle` with a different signature, the plan will conflict |
| A2 | Keeping density targets in `citation-density.ts` (Option B) avoids breaking density-module tests | Architecture Patterns §Pattern 4 | If the planner chooses Option A (move to disciplines.json), a density module refactor is needed |
| A3 | `chicago-author-date.csl` from the main CSL repo is the correct "Chicago Author-Date" file for Philosophy/Econ disciplines (even though it now says CMOS 18th) | Standard Stack §New Artifacts | If users or course requirements specifically need CMOS 17th, a different file or clarification is needed |
| A4 | Zotero MCP adapter returns `[]` from `search()` in Tier 2 (no MCP transport) — the real Zotero call happens only in Tier 1 workflow bodies | Architecture Patterns §Pattern 3 | If the planner expects the adapter to make network calls in Tier 2 via the Zotero Web API, additional auth and http.ts wiring is needed |

---

## Open Questions

1. **`CITATIONS.ris` generation timing**
   - What we know: `CITATIONS.bib` is written by the `research` verb (via `writeBibtex`). The export verb copies it.
   - What's unclear: Should `CITATIONS.ris` be written alongside `.bib` at research time (requiring `writeRis` to be called from `research.ts`), or generated lazily at export time from the existing `.bib`?
   - Recommendation: Write `.ris` at research time alongside `.bib` — same call site, symmetric pattern. Regenerate on `pensmith add` (same location that calls `writeBibtex`). The exporter then copies the pre-existing `.ris` file (no regeneration needed at export time).

2. **Zotero MCP — local vs web API detection**
   - What we know: Zotero MCP can operate in local mode (no API key, requires Zotero app running) or web API mode (requires `ZOTERO_API_KEY`).
   - What's unclear: Should pensmith distinguish these two modes in the doctor probe?
   - Recommendation: Yes — the probe should check for BOTH `ZOTERO_LOCAL_API_ENABLED` (or equivalent local-API env flag) and `ZOTERO_API_KEY`. This is a LOW-confidence detail that the planner should confirm against the actual Zotero MCP server documentation for whichever server the user has installed.

3. **`disciplines.json` `defaultCitationStyle` correction for CS**
   - What we know: Current file maps `computer-science → apa`. PRD §8 says `computer-science → IEEE`.
   - What's unclear: Was the `apa` mapping intentional (simpler default) or an oversight?
   - Recommendation: Correct to `ieee` per PRD §8. This is a breaking change to any existing `.paper/config.toml` with `discipline_preset = "computer-science"` and `citation_style = "apa"` — but `config.toml` is per-paper and user-editable, so drift is acceptable.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `citation-js` | CSL rendering + RIS export | ✓ | 0.7.22 (pinned) | — |
| `@citation-js/plugin-csl` | CSL rendering | ✓ | 0.7.22 (transitive) | — |
| `@citation-js/plugin-ris` | RIS export | ✓ | 0.7.21 (transitive) | — |
| `citeproc` | CSL engine (via plugin-csl) | ✓ | 2.4.63 (transitive) | — |
| Official CSL repo `.csl` files | 7 new style templates | Download required | N/A | Cannot render styles without files — Wave 0 must fetch+commit |
| Zotero MCP server | RSCH-06 | ✗ on dev machine | — | Graceful degrade (absence returns [] from adapter) |
| `ZOTERO_API_KEY` env var | Zotero web API auth | ✗ on dev machine | — | Doctor WARN; research continues without Zotero |

**Missing dependencies with no fallback:**
- The 7 new `.csl` files must be fetched from the CSL GitHub repo and committed in Wave 0 before any rendering code references them. This is a build-time procurement step, not a runtime dependency.

**Missing dependencies with fallback:**
- Zotero MCP: all source adapters work without it; doctor emits WARN.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) |
| Config file | `scripts/run-tests.mjs` (test discoverer) |
| Quick run command | `node --import tsx --test tests/citation-render.test.ts tests/bibtex-write.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CITE-02 | MLA/Chicago(NB+AD)/IEEE/AMA/Vancouver render non-empty bibliography from BibTeX input | unit | `node --import tsx --test tests/citation-render.test.ts` | ✅ (extend existing) |
| CITE-03 | Harvard renders non-empty bibliography from BibTeX input | unit | `node --import tsx --test tests/citation-render.test.ts` | ✅ (extend existing) |
| CITE-05 | RIS export produces valid RIS2001 output with `TY  - JOUR` and `ER  -` terminators | unit | `node --import tsx --test tests/ris-write.test.ts` | ❌ Wave 0 |
| CITE-05 | `exportDraft()` copies `CITATIONS.ris` into export dir when present | unit | `node --import tsx --test tests/exporter.test.ts` | ✅ (extend existing) |
| RSCH-06 | Zotero adapter returns `[]` when `isZoteroMcpPresent()` is false (no throw) | unit | `node --import tsx --test tests/sources/zotero-mcp.test.ts` | ❌ Wave 0 |
| RSCH-06 | Doctor probe reports WARN when Zotero not configured | unit | `node --import tsx --test tests/doctor-probes.test.ts` | ✅ (extend existing) |
| CITE-02/03 | All 7 `.csl` files exist in `templates/citation-styles/` | unit | `node --import tsx --test tests/repo-files.test.ts` | ✅ (extend existing) |
| INTK-03 | `disciplines.json` contains all 4 required fields per preset entry | unit | `node --import tsx --test tests/disciplines-schema.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --import tsx --test tests/citation-render.test.ts tests/ris-write.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/ris-write.test.ts` — covers CITE-05 RIS output contract
- [ ] `tests/sources/zotero-mcp.test.ts` — covers RSCH-06 absence-non-breaking contract
- [ ] `tests/disciplines-schema.test.ts` — covers INTK-03 expanded preset fields contract
- [ ] `templates/citation-styles/{mla,chicago-notes-bib,chicago-author-date,ieee,ama,vancouver,harvard}.csl` — all 7 files must exist before code references them

*(Existing `tests/citation-render.test.ts` and `tests/doctor-probes.test.ts` can be extended in-place — no new file required for those.)*

---

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` confirmed in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not applicable — no user auth surface in this phase |
| V3 Session Management | No | Not applicable |
| V4 Access Control | No | Not applicable |
| V5 Input Validation | Yes | CSL file content validated by checking it starts with `<?xml` or `<style`; BibTeX input validated by existing `parseBib` (throws on malformed) |
| V6 Cryptography | No | Not applicable |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed `.csl` file injected in `templates/citation-styles/` | Tampering | `citation-js` throws on invalid CSL XML — caught at registration time, not at render time. Add a Wave 0 test asserting each bundled `.csl` file passes `plugins.config.get('@csl').templates.add()` without throwing. |
| `ZOTERO_API_KEY` value leaking to session log | Information Disclosure | Follow T-01-07 pattern: check `!!process.env.ZOTERO_API_KEY` (boolean), never log the value. The doctor probe and any log events emit `apiKeyPresent: boolean` only. |
| Zotero adapter returning attacker-controlled candidates | Tampering | All `SourceCandidate` objects from the Zotero adapter pass through the same `pensmith-source-evaluator` scoring + RSCH-11 retraction check as other adapters. No bypass. |
| CSL injection via malicious BibTeX `note` field | Tampering | CSL rendering is bibliography-only (reference list, not inline HTML/JS). Output is plain text via `format:'text'` — no HTML injection surface. |

---

## Sources

### Primary (HIGH confidence)

- Live node.js execution in project (2026-06-20): verified `cite.format('ris')`, `cite.format('bibliography', {template:'apa'})`, template availability
- `bin/lib/citations.ts` — existing APA rendering pattern (template registration, memoization, PKG_ROOT walk)
- `bin/lib/bibtex-write.ts` — sibling pattern for RIS writer
- `bin/lib/sources/index.ts` — existing AdapterName union + registration pattern
- `bin/lib/ecosystem-presence.ts` — `isZoteroMcpPresent()` implementation
- `bin/lib/doctor/probes/zotero-mcp-presence.ts` — existing probe
- `templates/presets/disciplines.json` — current preset schema (2 fields only)
- `templates/prompts/intake-clarifier.md` — explicit deferral statement for non-APA styles
- `package.json` — `citation-js: 0.7.22`, `@citation-js/plugin-csl: 0.7.22`, `@citation-js/plugin-ris: 0.7.21` all confirmed installed
- slopcheck 0.6.1 output: `[OK]` for all three packages
- npm registry: confirmed package existence, versions, publication dates

### Secondary (MEDIUM confidence)

- [github.com/citation-style-language/styles](https://github.com/citation-style-language/styles) — official CSL styles repo; filenames and editions verified via WebFetch/WebSearch
- [github.com/citation-style-language/styles-distribution](https://github.com/citation-style-language/styles-distribution) — distribution repo for `chicago-fullnote-bibliography.csl`
- [citation.js.org/api/0.7/plugin-ris_src_index.js.html](https://citation.js.org/api/0.7/plugin-ris_src_index.js.html) — RIS plugin API documentation
- [github.com/54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp) — Zotero MCP server; auth pattern and detection mechanism

### Tertiary (LOW confidence)

- WebSearch results for Zotero local vs web API detection (env var names not authoritative — confirmed from 54yyyu/zotero-mcp only, not from official Zotero documentation)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified installed + working in project context
- Architecture: HIGH — mirrors established patterns from bibtex-write.ts, ecosystem-presence.ts, citations.ts
- CSL filenames: MEDIUM — confirmed via official GitHub repo WebSearch + WebFetch; `chicago-fullnote-bibliography.csl` location confirmed from styles-distribution repo
- Zotero MCP env vars: LOW — `ZOTERO_API_KEY` confirmed from 54yyyu/zotero-mcp README; official Zotero docs not checked

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (CSL repo files are stable; citation-js API is stable at 0.7.x; Zotero MCP auth pattern may evolve)
