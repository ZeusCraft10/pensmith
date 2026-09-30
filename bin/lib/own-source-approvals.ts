// bin/lib/own-source-approvals.ts — which of the user's own sources a paper
// may read (SRC-15, SRC-16; review round 1 of Phase 19).
//
// `.paper/config.toml` travels with a paper: `.paper/` may sit in a synced or
// shared folder, or be copied from someone else (CLAUDE.md, PRIVACY.md). Two
// of its keys point pensmith at the READER's private material:
//
//   [sources] byo_pdf_dir       — research copies every PDF in that folder
//                                 into `.paper/sources/`, records it in
//                                 LIBRARY.json / RESEARCH.md and sends its
//                                 title or identifiers to Crossref / OpenAlex;
//   [sources] zotero_collection — research pulls that collection of the
//                                 reader's Zotero library into LIBRARY.json.
//
// A shared paper whose config named `/home/<reader>/Documents` would so copy
// the reader's PDFs back to the sharer. The same rule local-services.ts
// applies to network targets holds here for local reads: a paper file can
// NAME a source, but only the user can APPROVE it. So:
//
//   - a byo_pdf_dir that resolves (after realpath) INSIDE the project root is
//     the paper's own folder and needs no approval — but then only the PDFs
//     that themselves resolve inside the project are read: a symlinked file in
//     it pointing elsewhere (a shared repo or archive can carry
//     `pdfs/x.pdf -> /home/<reader>/private.pdf`) is skipped, unless the user
//     approved that folder explicitly (byo-ingest.ts listPdfsInDir
//     `confineTo`; review round 2);
//   - anything else — a folder outside the project, any Zotero collection — is
//     read only when this user approved it for this paper: on the command line
//     (`new --pdfs <dir>`), or at the research gates `byo-folder` /
//     `zotero-collection` (bin/lib/gates.ts; --yolo never skips them, a run
//     without a terminal skips the source and says why).
//
// Approvals live in the pensmith data dir (paths.ts
// pensmithOwnSourceApprovalsPath), keyed by the real path of the project
// root, never in `.paper/`. A missing, unreadable or invalid approvals file
// approves nothing (fail closed: the user is asked again). Recording an
// approval never destroys the file (review round 3): it is read through the
// versioned loader, and a file written by a newer pensmith, or one that does
// not parse, is left exactly as it is — the approval is refused with one line
// saying why — instead of being replaced by this one approval (which would
// drop every other paper's).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { pensmithOwnSourceApprovalsPath } from './paths.js';
import { loadAndMigrate, ForwardIncompatError, SchemaValidationError } from './migrations/loader.js';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';

export const CURRENT_OWN_SOURCE_APPROVALS_VERSION = 1;

const PaperApprovalsSchema = z
  .object({
    byo_pdf_dirs: z.array(z.string().min(1)).default([]),
    zotero_collections: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const OwnSourceApprovalsSchema = z
  .object({
    $schemaVersion: z.literal(CURRENT_OWN_SOURCE_APPROVALS_VERSION),
    papers: z.record(z.string().min(1), PaperApprovalsSchema).default({}),
  })
  .strict();

export type OwnSourceApprovals = z.infer<typeof OwnSourceApprovalsSchema>;

/** The real path of `p` (symlinks and junctions resolved), else its absolute path. */
export function realPath(p: string): string {
  try {
    return fs.realpathSync.native(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/** True when `dir` lies inside (or is) the project root, after resolving links. */
export function isInsideProject(root: string, dir: string): boolean {
  const rel = path.relative(realPath(root), realPath(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function emptyApprovals(): OwnSourceApprovals {
  return { $schemaVersion: CURRENT_OWN_SOURCE_APPROVALS_VERSION, papers: {} };
}

function readApprovals(file: string): OwnSourceApprovals {
  try {
    const parsed = OwnSourceApprovalsSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : emptyApprovals();
  } catch {
    return emptyApprovals();
  }
}

/** Platform-appropriate comparison key for a path (Windows and macOS paths are case-insensitive by default). */
function pathKey(p: string): string {
  return process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;
}

function paperKey(root: string): string {
  return pathKey(realPath(root));
}

/** A approvals file this pensmith must not overwrite (newer, or damaged): nothing was changed. */
export class OwnSourceApprovalsUnwritableError extends PensmithError {
  constructor(file: string, why: string) {
    super(
      `${file}: ${why} — the approval was not recorded and the file was left as it is ` +
        '(upgrade pensmith, or move the file aside to start the approvals over)',
      EXIT_ERROR,
    );
    this.name = 'OwnSourceApprovalsUnwritableError';
  }
}

/** The approvals file for an update: missing → empty; newer or damaged → OwnSourceApprovalsUnwritableError. */
async function loadForUpdate(file: string): Promise<OwnSourceApprovals> {
  if (!fs.existsSync(file)) return emptyApprovals();
  try {
    return await loadAndMigrate({
      file,
      schema: OwnSourceApprovalsSchema,
      schemaName: 'own-source-approvals',
      currentVersion: CURRENT_OWN_SOURCE_APPROVALS_VERSION,
    });
  } catch (e) {
    if (e instanceof ForwardIncompatError) throw new OwnSourceApprovalsUnwritableError(file, `written by a newer pensmith (v${e.diskVersion}; this one writes v${e.codeVersion})`);
    const why = e instanceof SchemaValidationError ? 'not a valid approvals file' : e instanceof SyntaxError ? 'not valid JSON' : `unreadable (${(e as Error).message.split(/\r?\n/)[0] ?? 'error'})`;
    throw new OwnSourceApprovalsUnwritableError(file, why);
  }
}

async function update(root: string, mutate: (paper: { byo_pdf_dirs: string[]; zotero_collections: string[] }) => void): Promise<void> {
  const file = pensmithOwnSourceApprovalsPath();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await withLock(file, async () => {
    const all = await loadForUpdate(file);
    const key = paperKey(root);
    const paper = all.papers[key] ?? { byo_pdf_dirs: [], zotero_collections: [] };
    mutate(paper);
    all.papers[key] = paper;
    await atomicWriteFile(file, `${JSON.stringify(all, null, 2)}\n`);
  });
}

/** True when research may read the bring-your-own folder `dir` for the paper at `root`. */
export function isByoFolderApproved(root: string, dir: string): boolean {
  return isInsideProject(root, dir) || isByoFolderExplicitlyApproved(root, dir);
}

/**
 * True when the user approved the folder `dir` for the paper at `root` themselves
 * (`new --pdfs`, the `byo-folder` gate): the links in it are then theirs to
 * follow. A folder inside the project that nobody approved is readable
 * (isByoFolderApproved) but confined to the project.
 */
export function isByoFolderExplicitlyApproved(root: string, dir: string): boolean {
  const paper = readApprovals(pensmithOwnSourceApprovalsPath()).papers[paperKey(root)];
  const want = pathKey(realPath(dir));
  return paper?.byo_pdf_dirs.some((d) => d === want) ?? false;
}

/** Record that the user approved reading `dir` (and the files its links point to) for the paper at `root`. */
export async function approveByoFolder(root: string, dir: string): Promise<void> {
  const want = pathKey(realPath(dir));
  await update(root, (paper) => {
    if (!paper.byo_pdf_dirs.includes(want)) paper.byo_pdf_dirs.push(want);
  });
}

/** True when research may pull the Zotero collection `name` into the paper at `root`. */
export function isZoteroCollectionApproved(root: string, name: string): boolean {
  const paper = readApprovals(pensmithOwnSourceApprovalsPath()).papers[paperKey(root)];
  return paper?.zotero_collections.includes(name) ?? false;
}

/** Record that the user approved pulling the Zotero collection `name` into the paper at `root`. */
export async function approveZoteroCollection(root: string, name: string): Promise<void> {
  await update(root, (paper) => {
    if (!paper.zotero_collections.includes(name)) paper.zotero_collections.push(name);
  });
}
