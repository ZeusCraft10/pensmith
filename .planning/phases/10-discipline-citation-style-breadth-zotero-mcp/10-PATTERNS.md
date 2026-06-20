# Phase 10: Discipline + Citation-Style Breadth + Zotero MCP — Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 13 new/modified files
**Analogs found:** 13 / 13

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bin/lib/ris-write.ts` | utility | transform | `bin/lib/bibtex-write.ts` | exact |
| `bin/lib/citations.ts` (extend) | utility | transform | self (existing APA block) | exact |
| `bin/lib/exporter.ts` (extend) | utility | file-I/O | self (existing bibCopied block) | exact |
| `bin/lib/sources/zotero-mcp.ts` | service | request-response | `bin/lib/sources/crossref.ts` | role-match |
| `bin/lib/sources/index.ts` (extend) | config | — | self (existing sources const) | exact |
| `bin/lib/doctor/probes/zotero-mcp-presence.ts` (extend) | middleware | request-response | `bin/lib/doctor/probes/pandoc-presence.ts` | exact |
| `templates/presets/disciplines.json` (extend) | config | — | self (existing 2-field entries) | exact |
| `templates/prompts/intake-clarifier.md` (extend) | config | — | self (existing Q3 citation-style text) | exact |
| `templates/citation-styles/*.csl` (7 new files) | config | — | `templates/citation-styles/apa.csl` (exists) | exact |
| `tests/ris-write.test.ts` | test | transform | `tests/bibtex-write.test.ts` | exact |
| `tests/sources/zotero-mcp.test.ts` | test | request-response | `tests/sources/crossref.test.ts` | exact |
| `tests/disciplines-schema.test.ts` | test | — | `tests/citation-render.test.ts` (existence + schema) | role-match |
| `tests/citation-render.test.ts` (extend) | test | transform | self (existing renderApa tests) | exact |

---

## Pattern Assignments

### `bin/lib/ris-write.ts` (utility, transform) — NEW

**Analog:** `bin/lib/bibtex-write.ts` — EXACT structural template. Must mirror it completely: same imports, same `toCsl()` function, same collision loop, same sort, same atomic write. The SOLE difference is the final `cite.format()` call.

**D-19 chokepoint warning (from research Pitfall 8):** Import `{ Cite }` from `'./citations.js'`, NEVER from `'citation-js'` directly.

**Imports pattern** (lines 33-36 of bibtex-write.ts):
```typescript
import { Cite } from './citations.js';
import { atomicWriteFile } from './atomic-write.js';
import { generateCitekey } from './citekey.js';
import type { SourceCandidate } from './schemas/source-candidate.js';
```

**Core pattern — the one divergence from bibtex-write.ts** (replace lines 163-182):
```typescript
// cite.format('ris', { spec: 'new', format: 'text' }) produces RIS2001-compliant output.
// spec:'new' is required for maximum interop (Mendeley/EndNote). See RESEARCH Pitfall 4.
// Verified working in project: TY  - JOUR / AU  - / DA  - / ER  -
let ris = '';
if (entries.length > 0) {
  const cite = new Cite(entries.map((e) => e.csl));
  ris = (cite as { format: (...args: unknown[]) => string })
    .format('ris', { spec: 'new', format: 'text' });
}
await atomicWriteFile(targetPath, ris);
```

**Full function signature mirrors writeBibtex exactly:**
```typescript
export async function writeRis(
  candidates: SourceCandidate[],
  targetPath: string,
): Promise<void>
```

**Copy wholesale from bibtex-write.ts:**
- Lines 38-63: `CslAuthor`, `CslEntry` interfaces
- Lines 65-71: `parseAuthor()` function
- Lines 73-96: `toCsl()` function (identical — RIS needs the same CSL intermediate)
- Lines 134-161: The seenKeys collision loop, entries array, sort (identical)
- `suffixForCollision` is NOT re-exported from ris-write.ts — import from bibtex-write.js instead if needed, or duplicate privately

---

### `bin/lib/citations.ts` (extend — add `renderStyle`, `resolveStyleName`, memoization Map) (utility, transform)

**Analog:** `bin/lib/citations.ts` lines 100-199 — the existing `apaRegistered` / `ensureApaTemplate` / `renderApa` block is the exact pattern to generalize.

**Existing single-style memoization pattern** (lines 105-113):
```typescript
const CUSTOM_APA_NAME = 'pensmith-apa';
let apaRegistered = false;

function ensureApaTemplate(cslTemplateString: string): void {
  if (apaRegistered) return;
  const cslPlugin = plugins.config.get('@csl');
  cslPlugin.templates.add(CUSTOM_APA_NAME, cslTemplateString);
  apaRegistered = true;
}
```

**Phase 10 generalization — replace the boolean flag with a Map:**
```typescript
// CITE-02 / CITE-03: generalize from single apaRegistered boolean to a Map so
// all 8 styles (apa + 7 new) share one memoization mechanism.
// Pitfall 1 (RESEARCH): citeproc throws "template already registered" on a
// second templates.add(name, ...) call — the Map guard prevents this.
const registeredStyles = new Map<string, boolean>();

const STYLE_FILENAMES: Readonly<Record<string, string>> = {
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
  if (registeredStyles.get(style)) return;
  const filename = STYLE_FILENAMES[style] ?? style;
  const cslPath = path.join(PKG_ROOT, 'templates', 'citation-styles', `${filename}.csl`);
  if (!existsSync(cslPath)) {
    throw new Error(
      `renderStyle: CSL file not found for style '${style}' at ${cslPath}`,
    );
  }
  const cslString = readFileSync(cslPath, 'utf8');
  plugins.config.get('@csl').templates.add(`pensmith-${style}`, cslString);
  registeredStyles.set(style, true);
}
```

**New `renderStyle` export** (mirrors `renderApa` at lines 181-199):
```typescript
// CITE-02/CITE-03: generic style renderer — extends the renderApa pattern to N styles.
export async function renderStyle(
  entries: Array<Record<string, unknown>>,
  style: string,
): Promise<string> {
  if (!Array.isArray(entries)) {
    throw new TypeError('renderStyle: input must be an array of parsed entries (from parseBib)');
  }
  ensureStyleTemplate(style);
  const cite = new Cite(entries, { forceType: '@csl/object' });
  return cite.format('bibliography', {
    format: 'text',
    template: `pensmith-${style}`,
    lang: 'en-US',
  });
}
```

**New `resolveStyleName` export** — discipline→CSL style name mapping:
```typescript
// Resolves a discipline key from disciplines.json to its defaultCitationStyle.
// Callers that have already read PROJECT.md / config.toml can pass the style
// directly; this is a lookup convenience for workflow bodies.
export function resolveStyleName(discipline: string): string {
  const map: Readonly<Record<string, string>> = {
    'computer-science': 'ieee',
    'biology': 'apa',
    'psychology': 'apa',
    'sociology': 'apa',
    'economics': 'apa',
    'history': 'chicago-author-date',
    'philosophy': 'chicago-author-date',
    'literature': 'mla',
    'other': 'apa',
  };
  return map[discipline.toLowerCase()] ?? 'apa';
}
```

**Keep `renderApa` unchanged** — it is the Wave-0 contract used by `citation-render.test.ts` lines 44-64. Do NOT remove or rename it. The `renderApa` function can internally delegate to `renderStyle(entries, 'apa')` or remain self-contained — both are acceptable.

**New test-reset export** (mirrors `_resetApaTemplateForTest` at line 120):
```typescript
export function _resetStyleTemplatesForTest(): void {
  registeredStyles.clear();
}
```

---

### `bin/lib/exporter.ts` (extend — add `risCopied` to `ExportResult` and copy step) (utility, file-I/O)

**Analog:** `bin/lib/exporter.ts` lines 519-528 — the existing `bibCopied` block is the exact copy pattern.

**Existing bib copy pattern** (lines 519-528):
```typescript
let bibCopied = false;
const bibSrc = join(paperDir(opts.paperRoot), 'CITATIONS.bib');
const bibDst = join(exportDir, 'CITATIONS.bib');
if (bibSrc !== bibDst && existsSync(bibSrc)) {
  await fsp.copyFile(bibSrc, bibDst);
  bibCopied = true;
}

return { outputPath, format, pandocUsed, bibCopied };
```

**Phase 10 extension — add immediately after bibCopied block, before the return:**
```typescript
// CITE-05 (DONE-08 extension): copy CITATIONS.ris into the export dir alongside .bib.
// Same pattern as bibCopied: same-path guard + existsSync guard + never throws.
let risCopied = false;
const risSrc = join(paperDir(opts.paperRoot), 'CITATIONS.ris');
const risDst = join(exportDir, 'CITATIONS.ris');
if (risSrc !== risDst && existsSync(risSrc)) {
  await fsp.copyFile(risSrc, risDst);
  risCopied = true;
}

return { outputPath, format, pandocUsed, bibCopied, risCopied };
```

**ExportResult interface extension** (lines 321-326):
```typescript
export interface ExportResult {
  outputPath: string;
  format: ExportFormat;
  pandocUsed: boolean;
  bibCopied: boolean;
  risCopied: boolean;  // NEW — CITE-05
}
```

---

### `bin/lib/sources/zotero-mcp.ts` (service, request-response) — NEW

**Analog:** `bin/lib/sources/crossref.ts` for the adapter shell shape. `bin/lib/doctor/probes/pandoc-presence.ts` + `bin/lib/ecosystem-presence.ts` for the absence-non-breaking degrade pattern.

**Key constraint from research (Pattern 3):** This adapter is a TYPE-REGISTRAR + PRESENCE GUARD only. The real MCP tool call happens at the workflow level via `<capability_check>`. The `search()` function returns `[]` in all current tiers.

**Imports pattern** (mirrors crossref.ts lines 19-22 but without http.ts — no network in this adapter):
```typescript
import { isZoteroMcpPresent } from '../ecosystem-presence.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
```

**Core pattern — presence-gated empty return** (degrade contract from ARCH-03):
```typescript
// RSCH-06: Zotero MCP source adapter — presence-gated, absence-non-breaking.
//
// In Tier 1: real Zotero MCP tool calls happen at the workflow body level
// (workflows/research.md <capability_check>), NOT in this module. This adapter
// registers the 'zotero-mcp' key in AdapterName and gates on presence so
// consumers that iterate `sources` generically can call search() safely.
//
// In Tier 2: no MCP transport → graceful empty return (same as Tier 1 absent case).
//
// Anti-pattern BLOCKED: NEVER import from 'http.ts' here (Zotero MCP calls
// use MCP protocol, not HTTP; any future Zotero Web API calls must go through
// http.ts — but that is NOT this phase).

export async function search(query: string, _limit = 10): Promise<SourceCandidate[]> {
  if (!isZoteroMcpPresent()) {
    // Logged by the research orchestrator — return [] not throw (ARCH-03).
    return [];
  }
  // Present path: the workflow body issues the actual Zotero MCP tool call.
  // This adapter stub returns [] so the research orchestrator's generic
  // `sources[adapter].search(query)` call completes without error.
  // The Zotero results arrive via the capability_check path, not this return.
  return [];
}
```

**Auth-state check pattern** (from research Pitfall 6 — mirrors `PENSMITH_CONTACT_EMAIL` env check in ecosystem-presence):
```typescript
// Auth check helper for the doctor probe extension — T-01-07 no-leak pattern:
// check presence (boolean) only, NEVER log the value.
export function isZoteroAuthenticated(): boolean {
  return isZoteroMcpPresent() && !!process.env['ZOTERO_API_KEY'];
}
```

---

### `bin/lib/sources/index.ts` (extend — add 'zotero-mcp' entry) (config)

**Analog:** `bin/lib/sources/index.ts` lines 12-31 — copy the existing pattern exactly.

**Existing registration pattern** (lines 12-31):
```typescript
import * as crossref from './crossref.js';
// ... (6 more imports)

export const sources = {
  crossref,
  openalex,
  arxiv,
  pubmed,
  semanticscholar,
  unpaywall,
  'retraction-watch': retractionWatch,
} as const;

export type AdapterName = keyof typeof sources;
```

**Phase 10 extension — add one import + one entry:**
```typescript
import * as zoteroMcp from './zotero-mcp.js';   // NEW — RSCH-06

export const sources = {
  crossref,
  openalex,
  arxiv,
  pubmed,
  semanticscholar,
  unpaywall,
  'retraction-watch': retractionWatch,
  'zotero-mcp': zoteroMcp,   // NEW — presence-gated; search() returns [] when absent
} as const;
```

**`AdapterName` automatically expands** — `keyof typeof sources` picks up `'zotero-mcp'` with no additional change.

---

### `bin/lib/doctor/probes/zotero-mcp-presence.ts` (extend — tri-state auth check) (middleware, request-response)

**Analog:** `bin/lib/doctor/probes/pandoc-presence.ts` (lines 11-31) for the PASS/WARN probe shape. Existing `zotero-mcp-presence.ts` (lines 23-43) for the current binary logic.

**Existing probe structure** (lines 23-43):
```typescript
export const zoteroMcpPresenceProbe: Probe = {
  id: 'zotero-mcp-presence',
  async run(): Promise<ProbeResult> {
    if (isZoteroMcpPresent()) {
      return {
        id: 'zotero-mcp-presence',
        severity: 'PASS',
        summary: 'Zotero MCP configured in a known Claude MCP config location',
      };
    }
    return {
      id: 'zotero-mcp-presence',
      severity: 'WARN',
      summary: 'Zotero MCP server not configured — ...',
      detail: `Checked: ${candidatePaths().join(', ')}`,
      fix: '...',
    };
  },
};
```

**Phase 10 extension — tri-state: ABSENT / CONFIGURED_NO_AUTH / PASS** (per research Pitfall 6):
```typescript
// T-01-07 no-leak: check env var PRESENCE only (boolean), never log the value.
const API_KEY_ENV = 'ZOTERO_API_KEY';

export const zoteroMcpPresenceProbe: Probe = {
  id: 'zotero-mcp-presence',
  async run(): Promise<ProbeResult> {
    const configured = isZoteroMcpPresent();
    const authenticated = configured && !!process.env[API_KEY_ENV];

    if (!configured) {
      return {
        id: 'zotero-mcp-presence',
        severity: 'WARN',
        summary: 'Zotero MCP server not configured — citations and research verbs will be offline-only.',
        detail: `Checked: ${candidatePaths().join(', ')}`,
        fix: 'See https://github.com/<zotero-mcp-org>/zotero-mcp for installation.',
      };
    }
    if (!authenticated) {
      return {
        id: 'zotero-mcp-presence',
        severity: 'WARN',
        summary: `Zotero MCP configured but ${API_KEY_ENV} not set — Zotero sources will be skipped.`,
        detail: `Checked: ${candidatePaths().join(', ')}. ${API_KEY_ENV} not found in env.`,
        fix: `Set ${API_KEY_ENV} in your environment (see Zotero MCP documentation).`,
      };
    }
    return {
      id: 'zotero-mcp-presence',
      severity: 'PASS',
      summary: 'Zotero MCP configured and authenticated',
    };
  },
};
```

**Note for test update:** `tests/doctor-probes.test.ts` line 41-46 currently asserts `severity ∈ {PASS, WARN}` and checks `r.detail` contains `'Checked:'` only when `severity === 'WARN'`. The extended probe still satisfies both assertions — both WARN variants include `'Checked:'` in detail.

---

### `templates/presets/disciplines.json` (extend — add 4 fields per entry) (config)

**Analog:** `templates/presets/disciplines.json` lines 1-11 — existing 2-field structure to extend to 6 fields.

**Existing structure** (lines 1-11):
```json
{
  "computer-science": { "defaultTone": "technical", "defaultCitationStyle": "apa" }
}
```

**Phase 10 extended structure per entry** (PRD §8 fields + CS `apa`→`ieee` fix):
```json
{
  "computer-science": {
    "defaultTone": "technical",
    "defaultCitationStyle": "ieee",
    "sourcePreference": ["arxiv", "semanticscholar", "openalex"],
    "sectioningConvention": ["Abstract", "Introduction", "Related Work", "Methods", "Results", "Conclusion"],
    "counterargDefault": "off",
    "densityTarget": { "low": 10, "center": 20, "high": 30 }
  },
  "psychology": {
    "defaultTone": "academic-formal",
    "defaultCitationStyle": "apa",
    "sourcePreference": ["pubmed", "openalex", "semanticscholar"],
    "sectioningConvention": ["Abstract", "Introduction", "Method", "Results", "Discussion"],
    "counterargDefault": "optional",
    "densityTarget": { "low": 12, "center": 22, "high": 35 }
  }
}
```

**Important corrections per research:**
- `computer-science.defaultCitationStyle`: `"apa"` → `"ieee"` (PRD §8 fix; research Open Question 3)
- `densityTarget` field: KEEP `citation-density.ts` DISCIPLINE_TARGETS as-is (Option B per research); the `center` value should match the existing DISCIPLINE_TARGETS entries for consistency

**Field semantics:**
- `sourcePreference`: ordered array of AdapterName strings; research orchestrator consults this to rank adapter results
- `sectioningConvention`: default section headings proposed to the user at outline time
- `counterargDefault`: `"off"` | `"optional"` | `"required"` — sets OUTL-02 default
- `densityTarget`: `{ low, center, high }` — low/high are the band edges; center is the DISCIPLINE_TARGETS value

---

### `templates/prompts/intake-clarifier.md` (extend — update Q3 citation style) (config)

**Analog:** `templates/prompts/intake-clarifier.md` lines 32-38 — the existing Q3 block containing the deferral text.

**Existing Q3 text** (line 37):
```
3. Citation style — propose `APA` as the default (Phase 3 ships only
   `templates/citation-styles/apa.csl`; `chicago-author-date` and `mla` are
   referenced by the preset table but their CSL files are deferred).
```

**Phase 10 replacement for Q3** (remove deferral caveat, list all 8 styles):
```
3. Citation style — propose the discipline preset default from
   `templates/presets/disciplines.json` as the suggested value. All 8 styles
   are now available: `APA`, `MLA`, `Chicago (Notes-Bibliography)`,
   `Chicago (Author-Date)`, `IEEE`, `AMA`, `Vancouver`, `Harvard`.
   If the user picks a style not listed, record it verbatim and the workflow
   will fall back to `APA` at render time.
```

**Also update Q3 example output** (line 62):
```
3. Which citation style? (APA is the discipline default; options: APA, MLA,
   Chicago NB, Chicago AD, IEEE, AMA, Vancouver, Harvard)
```

---

### `templates/citation-styles/*.csl` (7 new files) (config)

**Analog:** `templates/citation-styles/apa.csl` — the existing bundled CSL file establishes the pattern: committed binary, never fetched at runtime.

**File list and download sources** (from research Standard Stack):

| Pensmith path | Source URL | Notes |
|---------------|-----------|-------|
| `templates/citation-styles/mla.csl` | `raw.githubusercontent.com/citation-style-language/styles/master/modern-language-association.csl` | MLA 9th ed. |
| `templates/citation-styles/chicago-notes-bib.csl` | `raw.githubusercontent.com/citation-style-language/styles-distribution/master/chicago-fullnote-bibliography.csl` | CMOS 17th full note; styles-distribution repo, NOT main styles repo (Pitfall 2) |
| `templates/citation-styles/chicago-author-date.csl` | `raw.githubusercontent.com/citation-style-language/styles/master/chicago-author-date.csl` | CMOS 18th ed., NOT 17th (Pitfall 3) |
| `templates/citation-styles/ieee.csl` | `raw.githubusercontent.com/citation-style-language/styles/master/ieee.csl` | IEEE ref guide |
| `templates/citation-styles/ama.csl` | `raw.githubusercontent.com/citation-style-language/styles/master/american-medical-association.csl` | AMA 11th ed. |
| `templates/citation-styles/vancouver.csl` | `raw.githubusercontent.com/citation-style-language/styles/master/vancouver.csl` | ICMJE Vancouver |
| `templates/citation-styles/harvard.csl` | `raw.githubusercontent.com/citation-style-language/styles/master/harvard-cite-them-right.csl` | UK/AU standard |

**Validation after download:** Each file must start with `<?xml` or `<style`. If the file starts with `<!DOCTYPE html>`, it is a 404 page — re-fetch from the correct URL.

**No `package.json` change needed** — `templates/` is already in the `files` array (confirmed in research).

---

### `tests/ris-write.test.ts` (test, transform) — NEW

**Analog:** `tests/bibtex-write.test.ts` — EXACT structural template. Mirror all 5 base cases + 3 collision cases, replacing BibTeX-specific assertions with RIS-specific ones.

**Imports pattern** (mirrors bibtex-write.test.ts lines 13-20):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRis } from '../bin/lib/ris-write.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
```

**Fixture pattern** (copy fixtures array from bibtex-write.test.ts lines 30-68 verbatim — same SourceCandidate fixtures work for both serializers):
```typescript
const fixtures: SourceCandidate[] = [ /* same 3 fixtures as bibtex-write.test.ts */ ];
```

**Core test pattern — RIS2001 assertions** (replace BibTeX patterns):
```typescript
test('writeRis: round-trips 3 fixtures via citation-js plugin-ris (CITE-05)', async () => {
  const target = tmpFile();
  await writeRis(fixtures, target);
  const body = readFileSync(target, 'utf8');
  // RIS2001 new spec: TY  - JOUR tag and ER  - terminator are required (Pitfall 4).
  assert.match(body, /TY\s+-\s+JOUR/, 'RIS2001 TY tag present');
  assert.match(body, /ER\s+-/, 'RIS2001 ER terminator present');
  assert.equal((body.match(/^TY\s+-/gm) ?? []).length, fixtures.length, 'all 3 entries present');
});

test('writeRis: empty array writes a zero-length file', async () => {
  const target = tmpFile();
  await writeRis([], target);
  const body = readFileSync(target, 'utf8');
  assert.equal(body.trim(), '');
});

test('writeRis: no-id candidate dropped silently, does NOT throw', async () => {
  // Same as bibtex-write, only assertion changes to count TY  - tags
});
```

---

### `tests/sources/zotero-mcp.test.ts` (test, request-response) — NEW

**Analog:** `tests/sources/crossref.test.ts` — the cassette-based Wave-0 existence + behavioral scaffold. Adapted for presence-gated degrade contract.

**Imports and existence pattern** (mirrors crossref.test.ts lines 1-24):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const ADAPTER = 'zotero-mcp';
const adapterPath = new URL(`../../bin/lib/sources/${ADAPTER}.ts`, import.meta.url);
const skip = !existsSync(adapterPath);

test(`${ADAPTER}: production adapter exists (RSCH-06)`, () => {
  assert.ok(existsSync(adapterPath), `MISSING: bin/lib/sources/${ADAPTER}.ts`);
});
```

**Behavioral pattern — degrade contract is the key contract** (no cassette needed):
```typescript
// RSCH-06 degrade contract: search() NEVER throws when Zotero is absent.
// Returns [] instead (ARCH-03). No cassette required — the adapter's return
// value is deterministic regardless of Zotero MCP state.
test(`${ADAPTER}.search() returns [] when Zotero MCP is absent (RSCH-06 degrade)`, { skip }, async () => {
  // Force absence by temporarily clearing any MCP config env the adapter reads.
  // isZoteroMcpPresent() checks filesystem — on CI machines with no Zotero config
  // this is naturally absent. The test asserts the no-throw contract only.
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  let result: unknown;
  await assert.doesNotReject(async () => {
    result = await adapter.search('test query');
  }, 'search() must not throw when Zotero is absent');
  assert.ok(Array.isArray(result), 'search() must return an array');
});

test(`${ADAPTER}: AdapterName union includes 'zotero-mcp' after registration`, { skip }, async () => {
  const { sources } = await import('../../bin/lib/sources/index.js');
  assert.ok('zotero-mcp' in sources, "'zotero-mcp' must be registered in sources const");
});
```

---

### `tests/disciplines-schema.test.ts` (test) — NEW

**Analog:** `tests/citation-render.test.ts` — the existence + schema structure assertion pattern.

**Pattern — file existence + field completeness assertion:**
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const disciplinesPath = fileURLToPath(
  new URL('../templates/presets/disciplines.json', import.meta.url)
);

const REQUIRED_FIELDS = [
  'defaultTone',
  'defaultCitationStyle',
  'sourcePreference',
  'sectioningConvention',
  'counterargDefault',
  'densityTarget',
] as const;

test('disciplines-schema: disciplines.json exists (INTK-03)', () => {
  assert.ok(existsSync(disciplinesPath), 'templates/presets/disciplines.json missing');
});

test('disciplines-schema: all entries contain all 6 required PRD §8 fields', () => {
  const raw = readFileSync(disciplinesPath, 'utf8');
  const presets = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  for (const [discipline, preset] of Object.entries(presets)) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(
        field in preset,
        `disciplines.json['${discipline}'] missing required field '${field}'`,
      );
    }
  }
});

test('disciplines-schema: computer-science defaultCitationStyle is ieee, not apa (PRD §8 fix)', () => {
  const raw = readFileSync(disciplinesPath, 'utf8');
  const presets = JSON.parse(raw) as Record<string, { defaultCitationStyle: string }>;
  assert.equal(
    presets['computer-science']?.defaultCitationStyle,
    'ieee',
    'CS preset must default to IEEE per PRD §8',
  );
});

test('disciplines-schema: densityTarget has low/center/high keys', () => {
  const raw = readFileSync(disciplinesPath, 'utf8');
  const presets = JSON.parse(raw) as Record<string, { densityTarget?: Record<string, number> }>;
  for (const [discipline, preset] of Object.entries(presets)) {
    const dt = preset.densityTarget;
    assert.ok(dt && 'low' in dt && 'center' in dt && 'high' in dt,
      `disciplines.json['${discipline}'].densityTarget must have low/center/high`);
  }
});
```

---

### `tests/citation-render.test.ts` (extend — add multi-style tests) (test, transform)

**Analog:** `tests/citation-render.test.ts` lines 39-64 — the existing `renderApa` behavioral test is the exact pattern to replicate for each new style.

**Extension pattern** (add after existing tests):
```typescript
// CITE-02 / CITE-03 — multi-style render tests
// Mirror the existing renderApa test for each new style.
// Skip guard: check both citations.ts AND the specific .csl file exist.

const stylesToTest = ['mla', 'chicago-notes-bib', 'chicago-author-date', 'ieee', 'ama', 'vancouver', 'harvard'] as const;

for (const style of stylesToTest) {
  const cslPath = new URL(`../templates/citation-styles/${style}.csl`, import.meta.url);
  const shouldSkipStyle = shouldSkip || !existsSync(cslPath);

  test(`citation-render: renderStyle('${style}') produces non-empty bibliography from BibTeX input (CITE-02/03)`,
    { skip: shouldSkipStyle },
    async () => {
      const { parseBib, renderStyle } = await import('../bin/lib/citations.js');
      const bibContent = readFileSync(fixtureBibPath, 'utf-8');
      const entries = await parseBib(bibContent);
      const rendered = await renderStyle(entries, style);
      assert.ok(typeof rendered === 'string' && rendered.length > 0,
        `renderStyle('${style}') must return non-empty string`);
    },
  );

  test(`citation-render: templates/citation-styles/${style}.csl exists (CITE-02/03)`, () => {
    assert.ok(existsSync(cslPath), `MISSING: templates/citation-styles/${style}.csl`);
  });
}
```

---

## Shared Patterns

### D-19 Citation-JS Chokepoint
**Source:** `bin/lib/citations.ts` lines 64-72, `bin/lib/bibtex-write.ts` lines 1-11
**Apply to:** `bin/lib/ris-write.ts`
```typescript
// CORRECT — through the re-export:
import { Cite } from './citations.js';

// WRONG — blocked by ESLint no-restricted-imports (D-19):
// import Cite from 'citation-js';
```

### D-07 Atomic Write Chokepoint
**Source:** `bin/lib/bibtex-write.ts` line 184, `bin/lib/exporter.ts` lines 227, 300
**Apply to:** `bin/lib/ris-write.ts`
```typescript
// All file output MUST go through atomicWriteFile, NEVER raw fs.writeFile:
await atomicWriteFile(targetPath, ris);
```

### Absence-Non-Breaking Degrade Pattern
**Source:** `bin/lib/ecosystem-presence.ts` lines 33-45 (`isPandocPresent`), `bin/lib/exporter.ts` lines 72-100 (`runHumanizer` never throws)
**Apply to:** `bin/lib/sources/zotero-mcp.ts`, `bin/lib/doctor/probes/zotero-mcp-presence.ts`
```typescript
// Pattern: check presence → return empty / emit WARN → never throw
if (!isZoteroMcpPresent()) {
  return [];  // not throw
}
```

### T-01-07 No-Leak Pattern (env var values never logged)
**Source:** `tests/doctor-probes.test.ts` lines 122-151 (the `SENTINEL` test), `bin/lib/doctor/probes/contact-email-presence.ts`
**Apply to:** `bin/lib/doctor/probes/zotero-mcp-presence.ts`, `bin/lib/sources/zotero-mcp.ts`
```typescript
// CORRECT — boolean presence only:
const authenticated = !!process.env['ZOTERO_API_KEY'];
// detail: `${API_KEY_ENV} not found in env`   (name only, never value)

// WRONG — leaks the value:
// detail: `API key: ${process.env.ZOTERO_API_KEY}`
```

### Probe Shape Pattern
**Source:** `bin/lib/doctor/probes/pandoc-presence.ts` lines 11-31
**Apply to:** `bin/lib/doctor/probes/zotero-mcp-presence.ts` (extended structure)
```typescript
export const myProbe: Probe = {
  id: 'probe-id',
  async run(): Promise<ProbeResult> {
    return {
      id: 'probe-id',
      severity: 'PASS' | 'WARN' | 'FAIL',
      summary: '...',
      detail?: '...',
      fix?: '...',
    };
  },
};
```

### PKG_ROOT Walk Pattern
**Source:** `bin/lib/citations.ts` lines 81-99
**Apply to:** `bin/lib/citations.ts` (the new `ensureStyleTemplate` function uses `PKG_ROOT` already defined at line 99)
```typescript
// PKG_ROOT is already defined at line 99 — reuse it in ensureStyleTemplate:
const cslPath = path.join(PKG_ROOT, 'templates', 'citation-styles', `${filename}.csl`);
```

### Wave-0 RED-by-skip Test Scaffold
**Source:** `tests/citation-render.test.ts` lines 11-16, `tests/sources/crossref.test.ts` lines 12-24
**Apply to:** `tests/ris-write.test.ts`, `tests/sources/zotero-mcp.test.ts`, `tests/disciplines-schema.test.ts`
```typescript
// Existence assertion fires RED immediately (no skip guard):
test('module exists', () => {
  assert.ok(existsSync(srcPath), 'MISSING: path — Plan XX must create');
});
// Behavioral tests skip gracefully until module exists:
const skip = !existsSync(srcPath);
test('behavioral test', { skip }, async () => { ... });
```

---

## No Analog Found

All files have a close analog. No entries in this section.

---

## Metadata

**Analog search scope:** `bin/lib/`, `bin/lib/sources/`, `bin/lib/doctor/probes/`, `tests/`, `tests/sources/`, `templates/presets/`, `templates/prompts/`, `templates/citation-styles/`
**Files scanned:** 18 source files read directly; project structure confirmed via Glob
**Pattern extraction date:** 2026-06-20
