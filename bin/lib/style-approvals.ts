// bin/lib/style-approvals.ts — the citation-style files a paper's config.toml
// names that the user approved (EXP-03; Phase 21 review round 2).
//
// A `.csl` file is code for the citation engine: its layout may hold any
// literal text (`<text value="…"/>`, macros, locale terms), and citeproc
// prints that text inside every citation, footnote and bibliography entry of
// the export — after the gate, which judged only the paper's own citations.
// `.paper/config.toml` travels with a paper (a synced folder, a co-author's
// copy, a template), so a paper may NAME a style file but only the user may
// APPROVE it — the rule own-source-approvals.ts applies to the reader's PDFs
// and detector-consent.ts to the detector:
//
//   - a style typed on the command line (`done --style <file.csl>`) is the
//     user's own choice, every time;
//   - a `.csl` file config.toml names is used only when this user approved it
//     for this paper: the `csl-style` gate (bin/lib/gates.ts; --yolo never
//     answers it, a run without a terminal refuses with exit 3), recorded
//     HERE, in the pensmith data dir (paths.ts pensmithStyleApprovalsPath),
//     keyed by the real path of the project root, and bound to the file's
//     path as config.toml names it (resolved against the project root,
//     lexically) AND its sha256 — an edited file is asked about again;
//   - the file is not touched before an approval exists for that path (review
//     round 3): not stat'ed, read, validated or hashed — export-style.ts
//     returns it `pending`, the gate asks with the path alone, and only then
//     is it read, validated (EXIT_USAGE) and hashed. A network path is refused
//     before that (export-style.ts isNetworkPath).
//
// The bundled 8 styles never ask. A missing, unreadable or invalid file
// approves nothing (fail closed). Recording never destroys the file: it is
// read through the versioned loader, and a newer or damaged file is left as
// it is (the approval then holds for this run only, and the caller says so).

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { pensmithStyleApprovalsPath } from './paths.js';
import { loadAndMigrate, ForwardIncompatError, SchemaValidationError } from './migrations/loader.js';
import { EXIT_ERROR, EXIT_USAGE, PensmithError } from './exit-codes.js';
import { paperApprovalKey } from './own-source-approvals.js';
import { isCslFileStyle } from './citations.js';
import { declineGate, runGate } from './gates.js';
import { CONFIG_STYLE_WHERE, validateCslFile, type ExportStyle } from './export-style.js';

export const CURRENT_STYLE_APPROVALS_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/;

const ApprovedStyleSchema = z.object({ path: z.string().min(1), sha256: z.string().regex(SHA256) }).strict();

export const StyleApprovalsSchema = z
  .object({
    $schemaVersion: z.literal(CURRENT_STYLE_APPROVALS_VERSION),
    /** Per paper (the project root's real path): the approved style files. */
    papers: z.record(z.string().min(1), z.array(ApprovedStyleSchema)).default({}),
  })
  .strict();

export type StyleApprovals = z.infer<typeof StyleApprovalsSchema>;

function empty(): StyleApprovals {
  return { $schemaVersion: CURRENT_STYLE_APPROVALS_VERSION, papers: {} };
}

function readFile(file: string): StyleApprovals {
  try {
    const parsed = StyleApprovalsSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : empty();
  } catch {
    return empty();
  }
}

/** The sha256 of a style file's bytes, or '' when it cannot be read. */
function fileSha(file: string): string {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

/**
 * True when the user approved the style file `file`, as it is now, for the
 * paper at `root`. The file is read (hashed) only when an approval for its
 * path exists — a path never approved is never touched. Never throws.
 */
export function isCslStyleApproved(root: string, file: string): boolean {
  const want = path.resolve(file);
  const approved = readFile(pensmithStyleApprovalsPath()).papers[paperApprovalKey(root)]?.filter((a) => a.path === want) ?? [];
  if (approved.length === 0) return false;
  const sha = fileSha(want);
  return sha !== '' && approved.some((a) => a.sha256 === sha);
}

/** An approvals file this pensmith must not overwrite (newer, or damaged): nothing was changed. */
export class StyleApprovalsUnwritableError extends PensmithError {
  constructor(file: string, why: string) {
    super(`${file}: ${why} — the approval was not recorded and the file was left as it is (upgrade pensmith, or move the file aside)`, EXIT_ERROR);
    this.name = 'StyleApprovalsUnwritableError';
  }
}

/** Record that the user approved the style file `file`, as it is now, for the paper at `root` (the gate, or a Tier-1 question). */
export async function approveCslStyle(root: string, file: string): Promise<void> {
  const store = pensmithStyleApprovalsPath();
  const entry = { path: path.resolve(file), sha256: fileSha(file) };
  if (entry.sha256 === '') throw new PensmithError(`${file} cannot be read — the style was not approved`, EXIT_ERROR);
  await fs.promises.mkdir(path.dirname(store), { recursive: true });
  await withLock(store, async () => {
    let all = empty();
    if (fs.existsSync(store)) {
      try {
        all = await loadAndMigrate({ file: store, schema: StyleApprovalsSchema, schemaName: 'style-approvals', currentVersion: CURRENT_STYLE_APPROVALS_VERSION });
      } catch (e) {
        if (e instanceof ForwardIncompatError) throw new StyleApprovalsUnwritableError(store, `written by a newer pensmith (v${e.diskVersion}; this one writes v${e.codeVersion})`);
        const why = e instanceof SchemaValidationError ? 'not a valid approvals file' : e instanceof SyntaxError ? 'not valid JSON' : `unreadable (${(e as Error).message.split(/\r?\n/)[0] ?? 'error'})`;
        throw new StyleApprovalsUnwritableError(store, why);
      }
    }
    const key = paperApprovalKey(root);
    const list = (all.papers[key] ?? []).filter((a) => a.path !== entry.path);
    all.papers[key] = [...list, entry];
    await atomicWriteFile(store, `${JSON.stringify(all, null, 2)}\n`);
  });
}

/**
 * Before an export in `style`: a `.csl` file config.toml names must be one
 * this user approved for this paper (see the header) — else the `csl-style`
 * gate asks in a terminal with the path alone (the file is not read before a
 * yes), and refuses without one (exit 3, naming `--style`, which is the
 * user's own choice) or on a no (exit 3). An approved file is then read and
 * validated (EXIT_USAGE with the validator's reason) and a new approval is
 * recorded. Returns the style to export: a bundled style and a `--style`
 * value as given, a config.toml file validated (no longer `pending`). `write`
 * prints one line.
 */
export async function assertCslStyleApproved(paperRoot: string, style: ExportStyle, write: (line: string) => void): Promise<ExportStyle> {
  if (style.source !== 'config' || !isCslFileStyle(style.style)) return style;
  const known = isCslStyleApproved(paperRoot, style.style);
  if (!known) {
    const outcome = await runGate('csl-style', {
      yolo: false,
      detail: `${style.style} — or pass it yourself with --style ${style.style}`,
      question: {
        id: 'csl-style',
        kind: 'confirm',
        label: `This paper's config.toml names the citation style file ${style.style}. Its text is printed in every citation and reference of the export. Use it?`,
        default: false,
      },
    });
    if (outcome.kind !== 'answered' || outcome.answer.kind !== 'confirm' || outcome.answer.value !== true) {
      declineGate('csl-style', `export cancelled — the citation style file ${style.style} that config.toml names was not approved (pass a style with --style)`);
    }
  }
  const v = validateCslFile(style.style);
  if (!v.ok) throw new PensmithError(`${CONFIG_STYLE_WHERE}: ${v.reason}`, EXIT_USAGE);
  if (!known) {
    try {
      await approveCslStyle(paperRoot, style.style);
    } catch (e) {
      if (!(e instanceof StyleApprovalsUnwritableError)) throw e;
      write(`pensmith done: WARN — ${e.message}; the style is used for this run only`);
    }
  }
  return { style: style.style, source: style.source, from: style.from, name: `${path.basename(style.style)}${v.title.length > 0 ? ` (${v.title})` : ''}`, cslClass: v.cslClass };
}
