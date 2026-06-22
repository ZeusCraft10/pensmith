# Phase 8: Style Match + Sketch + Add + Library + BYO PDF Polish — Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 22 new/modified files
**Analogs found:** 20 / 22

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `bin/lib/global-library.ts` | service | CRUD | `bin/lib/library.ts` | exact (same shape, different scope) |
| `bin/lib/schemas/global-library.ts` | model | transform | `bin/lib/schemas/library.ts` | exact |
| `bin/lib/style-match.ts` | service | transform | `bin/lib/pdf-text.ts` (pure-function pipeline analogy) | role-match |
| `bin/lib/schemas/style.ts` | model | transform | `bin/lib/schemas/library.ts` | role-match |
| `bin/lib/pymupdf-shellout.ts` | utility | request-response | `bin/lib/pdf-text.ts` (chokepoint pattern) | role-match |
| `bin/lib/paths.ts` (modify) | utility | transform | itself | n/a — additive only |
| `bin/cli/list.ts` | controller | request-response | `bin/cli/status.ts` | exact |
| `bin/cli/open.ts` | controller | request-response | `bin/cli/status.ts` | exact |
| `bin/cli/sketch.ts` | controller | event-driven | `bin/cli/next.ts` (dispatchVerb + resolveNextAction pattern) | role-match |
| `bin/cli/add.ts` | controller | CRUD | `bin/cli/compile.ts` (thin orchestrator pattern) | role-match |
| `bin/pensmith.ts` (modify) | config | transform | itself (REAL_VERB_LOADERS) | n/a — additive only |
| `bin/lib/drafter-input.ts` (modify) | model | transform | itself | n/a — additive only |
| `workflows/list.md` | config | request-response | any existing filled `workflows/*.md` | role-match |
| `workflows/open.md` | config | request-response | any existing filled `workflows/*.md` | role-match |
| `workflows/sketch.md` | config | event-driven | any existing filled `workflows/*.md` | role-match |
| `workflows/add.md` | config | CRUD | any existing filled `workflows/*.md` | role-match |
| `README.md` (modify) | config | — | `references/honesty-framing.md` (locked-copy disclosure pattern) | partial |
| `tests/global-library.test.ts` | test | CRUD | `tests/library.test.ts` | exact |
| `tests/style-match.test.ts` | test | transform | `tests/library.test.ts` (tmpdir isolation pattern) | role-match |
| `tests/pymupdf-shellout.test.ts` | test | request-response | `tests/http.test.ts` (stub/mock pattern) | role-match |
| `tests/add-verb.test.ts` | test | CRUD | `tests/cassette-size.test.ts` + cassette infra | partial |
| `tests/repo-files.test.ts` (modify) | test | transform | itself | n/a — additive only |

---

## Pattern Assignments

### `bin/lib/global-library.ts` (service, CRUD)

**Analog:** `bin/lib/library.ts`

**Imports pattern** (lines 72–84):
```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { loadAndMigrate } from './migrations/loader.js';
import {
  Schema as GlobalLibrarySchema,
  GlobalLibraryEntrySchema,
  CURRENT_GLOBAL_LIBRARY_VERSION,
  type GlobalLibrary,
  type GlobalLibraryEntry,
} from './schemas/global-library.js';
import { openSessionLog, type SessionLogger } from './session-log.js';
```

**Path helper pattern** (analog: `bin/lib/library.ts` lines 123–125):
```typescript
function globalLibraryFile(): string {
  return pensmithGlobalLibraryIndexPath(); // from paths.ts (new export)
}
```

**Lazy singleton logger pattern** (lines 134–140 of library.ts):
```typescript
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) {
    _log = openSessionLog({ scope: 'auto' }).child({ module: 'global-library' });
  }
  return _log;
}
```

**Init with existence-check-inside-lock pattern** (lines 157–196 of library.ts):
```typescript
export async function initGlobalLibrary(): Promise<GlobalLibrary> {
  const file = globalLibraryFile();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const seeded: GlobalLibrary = GlobalLibrarySchema.parse({
    $schemaVersion: CURRENT_GLOBAL_LIBRARY_VERSION,
    entries: [],
  });
  await withLock(file, async () => {
    try {
      await fs.promises.access(file);
      // already exists — don't overwrite; just return
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | null)?.code;
      if (code !== 'ENOENT') throw e;
    }
    await atomicWriteFile(file, JSON.stringify(seeded, null, 2) + '\n');
  });
  return seeded;
}
```

**Load + migrate inside lock pattern** (lines 214–250 of library.ts):
```typescript
export async function loadGlobalLibrary(): Promise<GlobalLibrary> {
  const file = globalLibraryFile();
  let value: GlobalLibrary;
  try {
    value = await withLock(file, async () =>
      (await loadAndMigrate({
        file,
        schema: GlobalLibrarySchema,
        schemaName: 'global-library',
        currentVersion: CURRENT_GLOBAL_LIBRARY_VERSION,
        writeBack: true,
      })) as GlobalLibrary,
    );
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT') {
      // Auto-init on first use (no paper root exists yet)
      return initGlobalLibrary();
    }
    throw e;
  }
  return value;
}
```

**Add/update entry inside single lock pattern** (lines 299–339 of library.ts):
```typescript
export async function registerPaperInGlobalLibrary(entry: GlobalLibraryEntry): Promise<GlobalLibrary> {
  const file = globalLibraryFile();
  const validatedEntry = GlobalLibraryEntrySchema.parse(entry);
  let next!: GlobalLibrary;
  await withLock(file, async () => {
    const current = (await loadAndMigrate({
      file, schema: GlobalLibrarySchema,
      schemaName: 'global-library',
      currentVersion: CURRENT_GLOBAL_LIBRARY_VERSION,
      writeBack: false,
    })) as GlobalLibrary;
    const existing = current.entries.findIndex(e => e.id === validatedEntry.id);
    const updatedEntries = existing >= 0
      ? current.entries.map((e, i) => i === existing ? { ...e, ...validatedEntry, updatedAt: new Date().toISOString() } : e)
      : [...current.entries, validatedEntry];
    next = GlobalLibrarySchema.parse({ ...current, entries: updatedEntries });
    await atomicWriteFile(file, JSON.stringify(next, null, 2) + '\n');
  });
  log().event({ event: 'global-library.register', id: validatedEntry.id });
  return next;
}
```

**Key difference from library.ts:** global-library uses UPSERT (update if exists, insert if new) instead of reject-on-duplicate, because `intake` calls `registerPaper` every time and STATUS updates (from each verb) must update an existing entry. Also: `initGlobalLibrary` auto-creates on first use rather than throwing `AlreadyExists`.

---

### `bin/lib/schemas/global-library.ts` (model, transform)

**Analog:** `bin/lib/schemas/library.ts` (lines 1–36)

**Imports + schema pattern** (all lines of library schema):
```typescript
import { z } from 'zod';

export const CURRENT_GLOBAL_LIBRARY_VERSION = 1;

export const GlobalLibraryEntrySchema = z.object({
  id: z.string().uuid(),             // paperId from STATE.json
  name: z.string().min(1),
  folderPath: z.string().min(1),     // absolute path, path.resolve() at write time
  class: z.string().default('Unfiled'),
  status: z.enum([
    'intake', 'research', 'outline',
    'sectioning', 'compile', 'done', 'archived',
  ]),
  sectioningProgress: z.object({
    done: z.number().int().min(0),
    total: z.number().int().min(1),
  }).optional(),                     // only when status === 'sectioning'
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const GlobalLibrarySchema = z.object({
  $schemaVersion: z.literal(CURRENT_GLOBAL_LIBRARY_VERSION),
  entries: z.array(GlobalLibraryEntrySchema).default([]),
});

export type GlobalLibraryEntry = z.infer<typeof GlobalLibraryEntrySchema>;
export type GlobalLibrary = z.infer<typeof GlobalLibrarySchema>;
```

---

### `bin/lib/paths.ts` (modify — additive only)

**Where to insert:** After `pensmithHttpCacheDir()` (line 133), before `projectRoot()` (line 140).

**New exports pattern** (modeled after existing helper functions lines 112–133):
```typescript
/**
 * Returns `<pensmithDataDir>/library/index.json` — the global paper registry.
 * Separate from per-paper `.paper/LIBRARY.json` (D-59 source/citation store).
 * LIB-01: lives in pensmithDataDir(), never inside a sync-folder-risk `.paper/`.
 */
export function pensmithGlobalLibraryIndexPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(pensmithDataDir(platform, env), 'library', 'index.json');
}

/**
 * Returns `<pensmithDataDir>/active.json` — the active-paper pointer (LIB-03).
 * Written by `open`; read by resolveNextAction and any verb needing paperRoot
 * from a different cwd.
 */
export function pensmithActivePointerPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(pensmithDataDir(platform, env), 'active.json');
}

/**
 * Returns `<pensmithDataDir>/style-fingerprints.json` — cross-paper reuse
 * detection registry (STYL-02). Stores fingerprint→[{paperId, paperName}] only;
 * NO prose features (those live only in `.paper/STYLE.json`).
 */
export function pensmithStyleFingerprintsPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(pensmithDataDir(platform, env), 'style-fingerprints.json');
}
```

---

### `bin/lib/schemas/style.ts` (model, transform)

**Analog:** `bin/lib/schemas/library.ts` (structure), with domain from RESEARCH.md Pattern 3.

```typescript
import { z } from 'zod';

export const CURRENT_STYLE_VERSION = 1;

export const StyleProfileSchema = z.object({
  $schemaVersion: z.literal(CURRENT_STYLE_VERSION),
  samplesDir: z.string().min(1),
  sampleSetFingerprint: z.string().length(64),   // SHA-256 hex
  samplesAnalyzed: z.number().int().min(1),
  features: z.object({
    medianSentenceLengthWords: z.number(),
    p25SentenceLengthWords: z.number(),
    p75SentenceLengthWords: z.number(),
    typeTokenRatio: z.number().min(0).max(1),
    passiveVoiceRate: z.number().min(0).max(1),
    subordinatingClauseRate: z.number().min(0).max(1),
    openingWordTopN: z.record(z.string(), z.number()),
    closingWordTopN: z.record(z.string(), z.number()),
    avgParagraphLengthSentences: z.number(),
  }),
  generatedAt: z.string().datetime(),
});

export type StyleProfile = z.infer<typeof StyleProfileSchema>;
```

---

### `bin/lib/style-match.ts` (service, transform)

**Analog:** `bin/lib/pdf-text.ts` (pure-function chokepoint with single public API) + `bin/lib/library.ts` (withLock + atomicWriteFile for the write side).

**Imports pattern** (modeled on pdf-text.ts lines 53 + atomicWriteFile chokepoint):
```typescript
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import {
  StyleProfileSchema,
  CURRENT_STYLE_VERSION,
  type StyleProfile,
} from './schemas/style.ts';
import { pensmithStyleFingerprintsPath } from './paths.js';
```

**Pure extraction function pattern** (modeled on extractPdfText lines 83–111):
```typescript
export async function buildStyleProfile(samplesDir: string): Promise<StyleProfile> {
  // Only .md / .txt / .docx extensions processed (path-traversal: path.resolve first)
  const resolved = path.resolve(samplesDir);
  const files = (await fs.promises.readdir(resolved))
    .filter(f => /\.(md|txt|docx)$/i.test(f))
    .sort(); // deterministic order for fingerprint

  if (files.length === 0) {
    throw new Error(`buildStyleProfile: no .md/.txt/.docx files found in ${resolved}`);
  }

  // Content-hash fingerprint (content-based, not path+mtime per RESEARCH §Alternatives)
  const contentHashes = await Promise.all(
    files.map(async f => {
      const buf = await fs.promises.readFile(path.join(resolved, f));
      return createHash('sha256').update(buf).digest('hex');
    })
  );
  const fingerprint = createHash('sha256')
    .update(contentHashes.sort().join(''))
    .digest('hex');

  // ... stat extraction (sentences, TTR, passive-voice regex) ...

  return StyleProfileSchema.parse({ $schemaVersion: CURRENT_STYLE_VERSION, ... });
}
```

**Write STYLE.json atomically to paperDir** (MUST use atomicWriteFile, NOT pensmithDataDir):
```typescript
export async function writeStyleProfile(paperDir: string, profile: StyleProfile): Promise<void> {
  const target = path.join(path.resolve(paperDir), 'STYLE.json');
  await atomicWriteFile(target, JSON.stringify(profile, null, 2) + '\n');
}
```

**Cross-paper reuse registry pattern** (modeled on withLock + atomicWriteFile from library.ts):
```typescript
export async function checkAndRegisterFingerprint(
  fingerprint: string,
  paperId: string,
  paperName: string,
  folderPath: string,
): Promise<{ priorPapers: Array<{ paperId: string; paperName: string; addedAt: string }> }> {
  const registryPath = pensmithStyleFingerprintsPath();
  await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });
  let priorPapers: Array<{ paperId: string; paperName: string; addedAt: string }> = [];
  await withLock(registryPath, async () => {
    // load existing registry, find prior users, append current, write back
    // priorPapers = existing entries for this fingerprint (before appending current)
    await atomicWriteFile(registryPath, JSON.stringify(updated, null, 2) + '\n');
  });
  return { priorPapers };
}
```

**voiceHint rendering** (pure function, no I/O):
```typescript
export function styleMatchToVoiceHint(profile: StyleProfile): string {
  const f = profile.features;
  // "Match this style: median sentence ~18 words, vocabulary density 0.72 (high variety), ..."
  return `Match this style: median sentence ~${f.medianSentenceLengthWords} words, ...`;
}
```

---

### `bin/lib/pymupdf-shellout.ts` (utility, request-response)

**Analog:** `bin/lib/pdf-text.ts` (chokepoint + graceful-degrade pattern). No codebase subprocess analog exists — pattern from RESEARCH.md is the reference.

**Imports pattern:**
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
```

**Subprocess pattern** (from RESEARCH.md Pattern 5):
```typescript
const execFileAsync = promisify(execFile);
const PYMUPDF_TIMEOUT_MS = 15_000;

export async function pymupdfShellout(buf: Buffer): Promise<string | null> {
  const tmp = path.join(os.tmpdir(), `pensmith-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await fs.promises.writeFile(tmp, buf);
    const script = [
      'import sys, fitz',
      `doc = fitz.open(${JSON.stringify(tmp.replace(/\\/g, '/'))})`,
      'text = "".join(page.get_text() for page in doc)',
      'sys.stdout.write(text)',
    ].join('; ');
    const { stdout } = await execFileAsync('python3', ['-c', script], {
      timeout: PYMUPDF_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return typeof stdout === 'string' && stdout.length > 0 ? stdout : null;
  } catch {
    // ENOENT (python3 absent), non-zero exit (fitz not importable), timeout
    return null; // graceful degradation — never throw
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}
```

**Caller pattern in `pdf-text.ts`** (extend existing `extractPdfText`):
```typescript
// After the pdf-parse attempt, in the near-empty branch:
if (isImageOnlyResult(text, numpages)) {
  console.warn('extractPdfText: PDF appears image-only; attempting pymupdf shellout...');
  // Import lazily so the subprocess module isn't loaded on every pdf-text import
  const { pymupdfShellout } = await import('./pymupdf-shellout.js');
  const fallbackText = await pymupdfShellout(input);
  if (fallbackText !== null && fallbackText.replace(/\s/g, '').length >= IMAGE_ONLY_TEXT_THRESHOLD) {
    return fallbackText;
  }
  console.warn('extractPdfText: pymupdf unavailable or returned empty; continuing with near-empty text.');
}
```

---

### `bin/cli/list.ts` (controller, request-response)

**Analog:** `bin/cli/status.ts` (thin orchestrator + stdout-only + never-crash pattern, lines 1–80)

**Imports pattern** (modeled on status.ts lines 17–21):
```typescript
import { defineCommand } from 'citty';
import { loadGlobalLibrary } from '../lib/global-library.js';
```

**Core pattern** (modeled on status.ts):
```typescript
export const listCommand = defineCommand({
  meta: { name: 'list', description: 'Show all papers grouped by class.' },
  async run() {
    let lib: GlobalLibrary;
    try {
      lib = await loadGlobalLibrary();
    } catch {
      // Auto-init on first use (no global library yet)
      process.stdout.write('pensmith list: no papers yet — run `pensmith new` to start.\n');
      return { ok: true, papers: [] };
    }
    if (lib.entries.length === 0) {
      process.stdout.write('pensmith list: no papers yet.\n');
      return { ok: true, papers: [] };
    }

    // Group by class field
    const byClass = new Map<string, typeof lib.entries>();
    for (const entry of lib.entries) {
      const cls = entry.class || 'Unfiled';
      const arr = byClass.get(cls) ?? [];
      arr.push(entry);
      byClass.set(cls, arr);
    }

    const lines: string[] = ['pensmith list:'];
    for (const [cls, entries] of byClass) {
      lines.push(`  [${cls}]`);
      for (const e of entries) {
        const statusStr = e.status === 'sectioning' && e.sectioningProgress
          ? `sectioning ${e.sectioningProgress.done}/${e.sectioningProgress.total}`
          : e.status;
        lines.push(`    ${e.name} (${statusStr})  ${e.folderPath}`);
      }
    }
    process.stdout.write(lines.join('\n') + '\n');
    return { ok: true, papers: lib.entries };
  },
});
```

---

### `bin/cli/open.ts` (controller, request-response)

**Analog:** `bin/cli/status.ts` (thin orchestrator) + `bin/cli/next.ts` (dispatch helper style)

**Imports pattern:**
```typescript
import { defineCommand } from 'citty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadGlobalLibrary } from '../lib/global-library.js';
import { pensmithActivePointerPath } from '../lib/paths.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
```

**Core pattern** (approval gate style from done.ts, args style from compile.ts):
```typescript
export const openCommand = defineCommand({
  meta: { name: 'open', description: 'Switch the active paper by name.' },
  args: {
    name: { type: 'positional', description: 'Paper name from library.', required: true },
  },
  async run({ args }) {
    const lib = await loadGlobalLibrary();
    const entry = lib.entries.find(e => e.name === args.name);
    if (!entry) {
      process.stdout.write(`pensmith open: no paper named "${args.name}". Run \`pensmith list\` to see papers.\n`);
      return { ok: false };
    }
    if (!fs.existsSync(entry.folderPath)) {
      process.stdout.write(`pensmith open: folder not found: ${entry.folderPath}\n`);
      return { ok: false };
    }
    // Write active pointer (atomicWriteFile — D-07 chokepoint)
    const activePtr = pensmithActivePointerPath();
    await fs.promises.mkdir(path.dirname(activePtr), { recursive: true });
    await atomicWriteFile(activePtr, JSON.stringify({
      paperId: entry.id,
      folderPath: entry.folderPath,
      openedAt: new Date().toISOString(),
    }, null, 2) + '\n');
    process.stdout.write(`pensmith open: switched to "${entry.name}" at ${entry.folderPath}\n`);
    return { ok: true, folderPath: entry.folderPath };
  },
});
```

---

### `bin/cli/sketch.ts` (controller, event-driven)

**Analog:** `bin/cli/next.ts` (dispatchVerb + global flag forwarding, lines 1–53) + `bin/cli/status.ts` (never-crash pattern)

**Key invariant:** sketch MUST NOT call initState, must NOT create `.paper/`, and must NOT call initLibrary until after confirm.

**Imports pattern:**
```typescript
import { defineCommand } from 'citty';
import { ask } from '../lib/prompts.js';
import { dispatchVerb } from '../pensmith.js';
```

**Core pattern** (Socratic loop + confirm gate):
```typescript
export const sketchCommand = defineCommand({
  meta: { name: 'sketch', description: 'Thinking-partner thesis discovery before intake.' },
  args: {
    yolo: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
  async run({ args }) {
    // Tier-2: stdin-based Socratic Q&A (4-5 questions)
    // NO .paper/ creation, NO STATE.json, NO initLibrary here
    const answers = {
      interests: (await ask({ id: 'sketch-interests', type: 'text', label: 'What interests or questions motivate this paper?' })).value,
      disagreements: (await ask({ id: 'sketch-disagree', type: 'text', label: 'What conventional view do you disagree with?' })).value,
      audience: (await ask({ id: 'sketch-audience', type: 'text', label: 'Who is your target audience?' })).value,
      claim: (await ask({ id: 'sketch-claim', type: 'text', label: 'What is your candidate thesis claim?' })).value,
    };

    // Synthesize + show candidate thesis
    const synthesized = `Thesis: ${answers.claim}`;
    process.stdout.write(`\npensmith sketch:\n  ${synthesized}\n\n`);

    if (args.yolo) {
      // Skip confirm gate
    } else {
      const confirm = await ask({ id: 'sketch-confirm', type: 'confirm', label: 'Proceed to intake with this thesis?' });
      if (!confirm.value) {
        process.stdout.write('pensmith sketch: cancelled — re-run to try again.\n');
        return { ok: false };
      }
    }

    // ONLY after confirm: drop into intake with thesis pre-filled
    return dispatchVerb('new', {
      args: { thesis: synthesized },
      globalFlags: { yolo: args.yolo === true, dryRun: args['dry-run'] === true },
    });
  },
});
```

---

### `bin/cli/add.ts` (controller, CRUD)

**Analog:** `bin/cli/compile.ts` (thin orchestrator pattern, lines 1–112) + `bin/cli/done.ts` (approval gate pattern, lines 58–72)

**Imports pattern** (compile.ts lines 22–30):
```typescript
import { defineCommand } from 'citty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractPdfText } from '../lib/pdf-text.js';
import { search as crossrefSearch, fetchById as crossrefFetchById } from '../lib/sources/crossref.js';
import { writeBibtex } from '../lib/bibtex-write.js';
import { normalizeDoi } from '../lib/doi.js';
import { parseFrontmatter, updateFrontmatter } from '../lib/frontmatter.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { withLock } from '../lib/lock.js';
import { ask } from '../lib/prompts.js';
import { paperDir, sectionPlan } from '../lib/paths.js';
import { fetch as httpFetch } from '../lib/http.js';
```

**Core pattern** (thin orchestrator delegating to lib, compile.ts lines 84–110):
```typescript
export const addCommand = defineCommand({
  meta: { name: 'add', description: 'Ingest a source mid-paper (DOI, PDF, or URL).' },
  args: {
    source: { type: 'positional', description: 'DOI, local PDF path, or URL.', required: true },
    yolo: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const paperRoot = process.cwd();
    const source = String(args.source);

    // 1. Detect input type + fetch/parse
    let candidate: SourceCandidate | null = null;
    if (isDoi(source)) {
      candidate = await crossrefFetchById(normalizeDoi(source));
    } else if (source.endsWith('.pdf') || fs.existsSync(source)) {
      const buf = await fs.promises.readFile(path.resolve(source));
      const text = await extractPdfText(buf); // calls pymupdf fallback internally
      const title = extractTitleHeuristic(text);
      if (title) candidate = await crossrefSearch(title, { limit: 1 }).then(r => r[0] ?? null);
    } else {
      // URL path — httpFetch (D-06 chokepoint; never raw fetch)
      candidate = await resolveUrl(source);
    }

    if (!candidate) {
      process.stdout.write(`pensmith add: could not hydrate "${source}". Source NOT added.\n`);
      return { ok: false };
    }

    // 2. Write to CITATIONS.bib via writeBibtex chokepoint
    const bibPath = path.join(paperDir(paperRoot), 'CITATIONS.bib');
    // ... load existing, append, writeBibtex([...existing, candidate], bibPath) ...

    // 3. Approval gate for remap-sections (default on, skip with --yolo)
    if (!args.yolo) {
      const remap = await ask({ id: 'add-remap', type: 'confirm',
        label: `Source added. Remap sections to reference it?` });
      if (remap.value) {
        await remapSections(paperRoot, candidate.citekey);
      }
    }

    process.stdout.write(`pensmith add: added ${candidate.citekey}.\n`);
    return { ok: true, citekey: candidate.citekey };
  },
});
```

**Remap-sections pattern** (using frontmatter.ts + atomicWriteFile + withLock — Pitfall 3 mitigation):
```typescript
async function remapSections(paperRoot: string, citekey: string): Promise<void> {
  // For each section, read PLAN.md via parseFrontmatter, append citekey to
  // assigned_sources[], write back via atomicWriteFile inside withLock.
  // NEVER touch status or verified_against_draft_hash.
  const planPath = sectionPlan(n, slug, paperRoot);
  await withLock(planPath, async () => {
    const text = await fs.promises.readFile(planPath, 'utf8');
    const updated = updateFrontmatter(text, fm => {
      const existing = Array.isArray(fm.assigned_sources) ? fm.assigned_sources : [];
      if (!existing.includes(citekey)) fm.assigned_sources = [...existing, citekey];
    });
    await atomicWriteFile(planPath, updated);
  });
}
```

---

### `bin/pensmith.ts` (modify — REAL_VERB_LOADERS only)

**Location:** Lines 57–80 (REAL_VERB_LOADERS object).

**Pattern to follow** (exact pattern from compile/done/next additions):
```typescript
// Phase 8 Plan 08-XX — list/open/sketch/add promoted from Phase-2 stubs to real verbs.
list: () => import('./cli/list.js').then((m) => m.listCommand),
open: () => import('./cli/open.js').then((m) => m.openCommand),
sketch: () => import('./cli/sketch.js').then((m) => m.sketchCommand),
add: () => import('./cli/add.js').then((m) => m.addCommand),
```

**Location invariant:** Add inside the existing `REAL_VERB_LOADERS` constant body. The `buildSubCommands()` function at line 152 auto-picks up new entries — no other edit needed.

---

### `bin/lib/drafter-input.ts` (modify — additive field only)

**Location:** Line 71, inside the `.strict()` schema object, after `authors`.

**Pattern to follow** (existing optional fields, lines 55–70):
```typescript
// Phase 8 STYL-03: optional path to .paper/STYLE.json when style-match is enabled.
// The load-bearing signal is voiceHint (rendered from the profile); styleProfilePath
// lets a capable Tier-1 drafter fetch the raw JSON for richer reasoning.
styleProfilePath: z.string().optional(),
```

**Write verb integration pattern** (modeled on write.ts lines 51–55 + STYL-03 from RESEARCH.md):
```typescript
// In bin/cli/write.ts writeOneSection():
// Priority: PLAN voice_hint > style-match > default
let voiceHint = 'Formal academic tone.';
let styleProfilePath: string | undefined;

const planText = await fs.promises.readFile(planPath, 'utf8').catch(() => '');
const { frontmatter } = parseFrontmatter(planText);
if (typeof frontmatter.voice_hint === 'string' && frontmatter.voice_hint.trim()) {
  voiceHint = frontmatter.voice_hint.trim(); // section-specific override WINS
} else {
  const stylePath = path.join(paperRoot, '.paper', 'STYLE.json');
  if (fs.existsSync(stylePath)) {
    const { buildStyleProfile, styleMatchToVoiceHint } = await import('../lib/style-match.js');
    // ... load profile from file, render hint ...
    voiceHint = styleMatchToVoiceHint(profile);
    styleProfilePath = stylePath;
  }
}

assertDrafterInput({ planPath, sources, wordTarget, voiceHint, styleProfilePath });
```

---

### `workflows/list.md`, `workflows/open.md`, `workflows/sketch.md`, `workflows/add.md` (config)

**Analog:** Any already-filled workflow body in `workflows/`. These need real content replacing the stub.

**Pattern:** Each workflow body must include a `<capability_check>` block per ARCH-03 (Tier 1 / Tier 2 degradation). The research verb workflow bodies (workflows/research.md) are the closest filled analog.

---

### `README.md` (modify — dual-use disclosure section)

**Analog:** `references/honesty-framing.md` (locked-copy disclosure pattern; hash-pinned in repo-files.test.ts).

**Pattern:** Add a `## Style Match` section to README.md. Framing rules from CLAUDE.md non-negotiables: "match your established voice" not "impersonate" or "evade detection." Modeled on the honest framing in honesty-framing.md.

**Important:** After writing the README section, add a content-guard to `tests/repo-files.test.ts` (same pattern as the `CF-D24` test at line 326):
```typescript
test('README has style-match dual-use disclosure (STYL-04)', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /## Style Match/);
  assert.match(readme, /match your.*voice|established voice/i);
  // Must NOT contain "evade detection" or "undetectable"
  assert.ok(!/evade detection/i.test(readme), 'README must not claim detection evasion');
  assert.ok(!/undetectable/i.test(readme), 'README must not claim undetectability');
});
```

---

## Shared Patterns

### withLock + atomicWriteFile (all state-file writes)
**Source:** `bin/lib/lock.ts` (lines 187–204), `bin/lib/atomic-write.ts`
**Apply to:** `global-library.ts`, `style-match.ts` (fingerprint registry), `add.ts` (remap sections)
```typescript
await withLock(filePath, async () => {
  // read → mutate → atomicWriteFile
  await atomicWriteFile(filePath, JSON.stringify(data, null, 2) + '\n');
});
```
**Critical:** The existence-check (fs.access) MUST be inside the lock, not before it (BLOCKER-01 in library.ts comments).

### loadAndMigrate pattern
**Source:** `bin/lib/library.ts` lines 226–233
**Apply to:** `global-library.ts` (both init and addEntry paths)
```typescript
(await loadAndMigrate({
  file,
  schema: GlobalLibrarySchema,
  schemaName: 'global-library',
  currentVersion: CURRENT_GLOBAL_LIBRARY_VERSION,
  writeBack: true,  // true for load-only; false when immediately re-writing
})) as GlobalLibrary
```

### defineCommand thin-orchestrator structure
**Source:** `bin/cli/compile.ts` lines 63–112, `bin/cli/status.ts` lines 23–80
**Apply to:** `list.ts`, `open.ts`, `sketch.ts`, `add.ts`
```typescript
export const xyzCommand = defineCommand({
  meta: { name: 'xyz', description: '...' },
  args: { yolo: { type: 'boolean', default: false }, ... },
  async run({ args }) {
    // 1. Resolve inputs
    // 2. Call lib functions (NO business logic here)
    // 3. Write stdout only (no console.*)
    // 4. Return { ok: boolean, ... }
  },
});
export default xyzCommand;
```

### ask() approval gate (ERGO-05/06)
**Source:** `bin/lib/prompts.ts` lines 74–83, `bin/cli/done.ts` lines 78–115
**Apply to:** `sketch.ts` (confirm gate), `add.ts` (remap-sections gate)
```typescript
// Pattern: skip gate with --yolo; otherwise call ask()
if (!args.yolo) {
  const answer = await ask({ id: 'gate-id', type: 'confirm', label: 'Proceed? (y/N)' });
  if (!answer.value) return { ok: false };
}
```
**Constraint (STYL-02 exception):** The cross-paper reuse NOTICE in style-match.ts is NOT an approval gate — it must print unconditionally even with --yolo. Do NOT wrap it in `if (!args.yolo)`.

### httpFetch chokepoint
**Source:** `bin/lib/sources/crossref.ts` line 19
**Apply to:** `add.ts` URL path, Crossref hydration in add flow
```typescript
import { fetch as httpFetch } from '../lib/http.js';
// NEVER: import fetch from 'node:http' or bare fetch()
```

### parseFrontmatter + updateFrontmatter pattern
**Source:** `bin/lib/frontmatter.ts` lines 29–107
**Apply to:** `add.ts` remap-sections, `write.ts` (STYL-03 voice_hint read)
```typescript
const text = await fs.promises.readFile(planPath, 'utf8');
const { frontmatter } = parseFrontmatter(text);
// Read: frontmatter.voice_hint, frontmatter.assigned_sources, etc.

// Write (atomic + locked):
const updated = updateFrontmatter(text, fm => {
  fm.assigned_sources = [...(fm.assigned_sources as string[] ?? []), citekey];
});
await atomicWriteFile(planPath, updated);
```

### Env-override test isolation
**Source:** `tests/library.test.ts` lines 26–38
**Apply to:** `tests/global-library.test.ts`, `tests/style-match.test.ts`
```typescript
function mkTestEnv(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-global-lib-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}
```

### REAL_VERB_LOADERS promotion pattern
**Source:** `bin/pensmith.ts` lines 57–80
**Apply to:** Phase 8 `list`/`open`/`sketch`/`add` promotion
```typescript
// In REAL_VERB_LOADERS:
list: () => import('./cli/list.js').then((m) => m.listCommand),
// Pattern: dynamic import, .then((m) => m.<VerbName>Command) — never static import
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `bin/lib/pymupdf-shellout.ts` | utility | request-response | No subprocess/shellout pattern exists in codebase; all external I/O uses HTTP (http.ts) or pdf-parse (pdf-text.ts). The RESEARCH.md Pattern 5 is the reference. |
| `workflows/sketch.md` (Socratic body) | config | event-driven | No existing workflow body implements a multi-turn Socratic LLM loop. The sketch workflow body is novel within this codebase. |

---

## Metadata

**Analog search scope:** `bin/lib/`, `bin/cli/`, `tests/`, `bin/pensmith.ts`, `bin/lib/schemas/`
**Files scanned:** 25 source files read
**Pattern extraction date:** 2026-06-19

### Dep availability confirmation (from RESEARCH.md)
- `pdf-parse@1.1.1` — already installed (exact pin); `extractPdfText` chokepoint at `bin/lib/pdf-text.ts`
- `proper-lockfile@4.1.2` — already installed; `withLock` chokepoint at `bin/lib/lock.ts`
- `zod@^3.23` — already installed; all schemas use it
- `citation-js@0.7.22` — already installed; `writeBibtex` chokepoint at `bin/lib/bibtex-write.ts`
- `@clack/prompts` — already installed; `ask()` chokepoint at `bin/lib/prompts.ts`
- `pymupdf` (python3 fitz) — installed but `import fitz` failing on this machine; shellout must return `null` on any failure (designed graceful fallback)
