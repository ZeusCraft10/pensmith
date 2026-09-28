// bin/lib/dry-run-paper.ts — the --dry-run workspace (GRND-19, D-18-29) and
// the boundary between dry runs and real papers (RUN-27).
//
// A dry run never works in `.paper/`. Under --dry-run (and PENSMITH_DRY_RUN=1
// in child processes) paths.ts paperDir() is `<root>/.paper-dry-run/`, so every
// loader and writer follows the workspace. This module prepares it, once per
// mutating run, under the paper's session lock (the dry run holds the SAME
// session lock as a real run on that folder, so the two never interleave):
//
//   - a folder with a real `.paper/`: the workspace is SEEDED from it — every
//     paper file copied through atomicWriteFile — and `SEED.json` records the
//     fingerprint of `.paper/` (relative paths, sizes, sha256). The workspace is
//     KEPT across dry runs while the fingerprint matches, and RE-SEEDED (wiped
//     and copied again) when `.paper/` changed (a real run since, or the real
//     paper was deleted). The real `.paper/` is only read, to fingerprint and
//     copy it; it is never created and never written.
//   - a folder with no paper: the workspace is created empty.
//   - `.paper-dry-run/DRY-RUN.md` marks the workspace (what it is, that its
//     sources are synthetic and its text is stub output, where the exports go).
//
// Not seeded: `export/` (a real paper's deliverables — the dry run writes its
// own `export/*.dry-run.*`), `SESSION.log` and `COSTS.jsonl` (the real run's
// bookkeeping: a dry run keeps its own log and spends nothing), and
// `INTAKE.raw.local` (the raw, pre-redaction assignment — GRND-05: it never
// leaves `.paper/`). They are not part of the fingerprint either, so a
// read-only real run that logs to SESSION.log does not discard a dry run's
// progress.
//
// The legacy boundary stays for normal runs: a paper a Phase 17 dry run made
// INSIDE `.paper/` carries `.paper/DRY-RUN.md`; a normal run refuses to
// continue it (its synthetic sources would be cited as if real). A marker left
// by a dry run that never created a paper is removed and the run proceeds.
// Markers are internal state: exports never contain them (zero trace).

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile } from './atomic-write.js';
import { dryRunPaperDir, paperStateFile, realPaperDir, DRY_RUN_PAPER_DIR_NAME, PAPER_DIR_NAME } from './paths.js';
import { EXIT_ERROR, PensmithError } from './exit-codes.js';
import { closeSessionLog } from './session-log.js';

/** The marker's file name (in `.paper-dry-run/`, and in a legacy dry-run `.paper/`). */
export const DRY_RUN_MARKER = 'DRY-RUN.md';

/** The workspace's record of what it was seeded from. */
export const SEED_FILE = 'SEED.json';

/** Paper-folder entries (top level) a seed never copies — see the module header. */
export const SEED_EXCLUDED: ReadonlySet<string> = new Set(['export', 'SESSION.log', 'COSTS.jsonl', 'INTAKE.raw.local']);

const WORKSPACE_MARKER_TEXT = [
  '# pensmith dry-run workspace',
  '',
  'This folder is where `pensmith --dry-run` works. The real paper in `.paper/` is never written by a dry run:',
  'when one exists, this workspace is a copy of it (see `SEED.json`), kept across dry runs and re-copied when `.paper/` changes.',
  '',
  'Sources a dry run adds are synthetic (`10.0000/pensmith-dryrun.*`) and its model replies are deterministic stubs.',
  'Its exports are written to `export/` here, named `*.dry-run.*`. Delete this folder at any time.',
  '',
].join('\n');

/** `<root>/.paper-dry-run/DRY-RUN.md`. */
export function dryRunMarkerPath(root: string): string {
  return path.join(dryRunPaperDir(root), DRY_RUN_MARKER);
}

/** `<root>/.paper/DRY-RUN.md` — the marker a Phase 17 dry run left in a real `.paper/`. */
export function legacyDryRunMarkerPath(root: string): string {
  return path.join(realPaperDir(root), DRY_RUN_MARKER);
}

/** True when the `.paper/` at `root` was made by a Phase 17 --dry-run (marked in place). */
export function isDryRunPaper(root: string): boolean {
  return existsSync(legacyDryRunMarkerPath(root));
}

/**
 * The files and folders that make `.paper/` a paper (or part of one): what
 * intake, research, outline, the section steps, compile and done write. A
 * `.paper/` holding only settings or bookkeeping (config.toml, .gitignore,
 * SESSION.log, COSTS.jsonl) is not a paper.
 */
const PAPER_ARTIFACTS: ReadonlySet<string> = new Set([
  path.basename(paperStateFile('.')),
  'INTAKE.md',
  'INTAKE.raw.local',
  'LIBRARY.json',
  'CITATIONS.bib',
  'CITATIONS.ris',
  'RESEARCH.md',
  'OUTLINE.md',
  'STYLE.json',
  'TUTORIAL.md',
  'DRAFT.md',
  'COMPILE-REPORT.md',
  'VERIFICATION.md',
  'FINAL.md',
  'HANDOFF.json',
  'sections',
  'export',
]);

/** True when the real `.paper/` holds a paper, or part of one (any PAPER_ARTIFACTS entry). */
export function hasPaperFiles(root: string): boolean {
  let names: string[];
  try {
    names = readdirSync(realPaperDir(root));
  } catch {
    return false;
  }
  return names.some((n) => PAPER_ARTIFACTS.has(n));
}

// ---------------------------------------------------------------------------
// Fingerprint + seed
// ---------------------------------------------------------------------------

export interface SeedFileEntry {
  /** Path relative to `.paper/`, `/`-separated on every platform. */
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface PaperFingerprint {
  /** sha256 over the sorted (path, size, sha256) list; null when there is no `.paper/`. */
  readonly digest: string | null;
  readonly files: readonly SeedFileEntry[];
}

const SeedRecordSchema = z.object({
  $schemaVersion: z.literal(1),
  seededAt: z.string(),
  source: z.literal(PAPER_DIR_NAME),
  digest: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), size: z.number().int().min(0), sha256: z.string() })),
});

export type SeedRecord = z.infer<typeof SeedRecordSchema>;

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Every regular file under `dir` (relative, `/`-separated, sorted), minus the seed exclusions. */
function listSeedFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    let names: string[];
    try {
      names = readdirSync(abs);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      if (rel === '' && SEED_EXCLUDED.has(name)) continue;
      const childAbs = path.join(abs, name);
      const childRel = rel === '' ? name : `${rel}/${name}`;
      let st;
      try {
        st = lstatSync(childAbs);
      } catch {
        continue;
      }
      // Symlinks and special files are never followed or copied.
      if (st.isDirectory()) walk(childAbs, childRel);
      else if (st.isFile()) out.push(childRel);
    }
  };
  walk(dir, '');
  return out;
}

/** The fingerprint of the real `.paper/` at `root` (D-18-29): what a seed copies. */
export function fingerprintPaper(root: string): PaperFingerprint {
  const dir = realPaperDir(root);
  let isDir = false;
  try {
    isDir = lstatSync(dir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return { digest: null, files: [] };
  const files: SeedFileEntry[] = [];
  for (const rel of listSeedFiles(dir)) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(dir, ...rel.split('/')));
    } catch {
      continue; // vanished between the listing and the read
    }
    files.push({ path: rel, size: bytes.length, sha256: sha256(bytes) });
  }
  const digest = sha256(files.map((f) => `${f.path}\u0000${f.size}\u0000${f.sha256}\n`).join(''));
  return { digest, files };
}

/** The workspace's SEED.json, or null when it is absent or unreadable. */
export function readSeedRecord(root: string): SeedRecord | null {
  try {
    const parsed = SeedRecordSchema.safeParse(JSON.parse(readFileSync(path.join(dryRunPaperDir(root), SEED_FILE), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type WorkspaceAction = 'created' | 'kept' | 'seeded' | 're-seeded';

export interface WorkspaceOutcome {
  readonly action: WorkspaceAction;
  /** `<root>/.paper-dry-run`. */
  readonly dir: string;
  /** Files copied from `.paper/` by this call (0 when kept or created empty). */
  readonly copied: number;
  /**
   * The one line to tell the user (a seed, a re-seed or a reset), or null. The
   * CLI prints it after the OFFLINE MODE banner (RUN-02: the banners come
   * first); the MCP server stays silent.
   */
  readonly note: string | null;
}

/**
 * Prepare the dry-run workspace of the paper at `root` (see the module
 * header): create it, keep it, or (re-)seed it from `.paper/`. Called under
 * the session lock by the CLI pre-flight and by every mutating MCP call made
 * in dry-run mode. Never writes under `.paper/`.
 */
export async function prepareDryRunWorkspace(root: string): Promise<WorkspaceOutcome> {
  const ws = dryRunPaperDir(root);
  const fp = fingerprintPaper(root);
  const prior = existsSync(ws) ? readSeedRecord(root) : null;
  if (prior !== null && prior.digest === fp.digest) {
    if (!existsSync(dryRunMarkerPath(root))) await atomicWriteFile(dryRunMarkerPath(root), WORKSPACE_MARKER_TEXT);
    return { action: 'kept', dir: ws, copied: 0, note: null };
  }
  const existed = existsSync(ws);
  // A workspace seeded from another state of `.paper/` (or one without a
  // SEED.json: a seed that never finished) is discarded as a whole — after
  // any queued session-log append into it has landed.
  if (existed) {
    await closeSessionLog();
    rmSync(ws, { recursive: true, force: true });
  }
  const src = realPaperDir(root);
  for (const f of fp.files) {
    const parts = f.path.split('/');
    await atomicWriteFile(path.join(ws, ...parts), readFileSync(path.join(src, ...parts)));
  }
  await atomicWriteFile(dryRunMarkerPath(root), WORKSPACE_MARKER_TEXT);
  const record: SeedRecord = {
    $schemaVersion: 1,
    seededAt: new Date().toISOString(),
    source: PAPER_DIR_NAME,
    digest: fp.digest,
    files: fp.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
  };
  // SEED.json last: a workspace without it is an unfinished seed (discarded above).
  await atomicWriteFile(path.join(ws, SEED_FILE), JSON.stringify(record, null, 2) + '\n');
  const action: WorkspaceAction = fp.digest === null ? (existed ? 're-seeded' : 'created') : existed ? 're-seeded' : 'seeded';
  let note: string | null = null;
  if (fp.digest !== null) {
    note =
      `pensmith: ${action === 'seeded' ? 'seeded' : 're-seeded'} the dry-run workspace ${ws} from ${src} ` +
      `(${fp.files.length} file${fp.files.length === 1 ? '' : 's'}); the dry run never writes ${PAPER_DIR_NAME}/`;
  } else if (existed) {
    note = `pensmith: reset the dry-run workspace ${ws} (the paper it was copied from is gone)`;
  }
  return { action, dir: ws, copied: fp.files.length, note };
}

/**
 * Enforce the dry-run boundary for one MUTATING run on the paper at `root`
 * (see the module header). `dryRun` is whether this run is a --dry-run: a dry
 * run gets its workspace prepared (the outcome is returned); a normal run
 * refuses a Phase 17 dry-run paper (EXIT_ERROR) and otherwise proceeds (null).
 */
export async function enforceDryRunBoundary(root: string, dryRun: boolean): Promise<WorkspaceOutcome | null> {
  if (dryRun) return prepareDryRunWorkspace(root);
  if (!isDryRunPaper(root)) return null;
  if (!hasPaperFiles(root)) {
    // A dry run that stopped before it created anything: nothing to protect.
    rmSync(legacyDryRunMarkerPath(root), { force: true });
    return null;
  }
  throw new PensmithError(
    `the paper at ${root} was made by --dry-run (synthetic sources, stub text) and cannot become a real paper — ` +
      `delete ${realPaperDir(root)} or use another folder, then run pensmith new ` +
      `(dry runs now work in ${DRY_RUN_PAPER_DIR_NAME}/ and never touch ${PAPER_DIR_NAME}/)`,
    EXIT_ERROR,
  );
}
