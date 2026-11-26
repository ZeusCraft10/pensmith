// bin/lib/migrations/layout.ts — move a project laid out the old way.
//
// Up to v0.2 pensmith kept STATE.json and config.toml in the project root,
// which is the user's own folder: a thesis repo, a Hugo site or a Python
// package may have a config.toml of its own. Both files now live in .paper/.
// A project still laid out the old way is moved the first time pensmith runs
// in it:
//   - STATE.json moves when it is pensmith's (a $schemaVersion, a paperId and
//     a createdAt); any other STATE.json is someone else's and is left alone;
//   - config.toml moves as it is (comments kept) when it holds only the tables
//     pensmith documents (PRD §10). Otherwise only those tables are copied
//     into .paper/config.toml and the user's file is not changed;
//   - .paper/.gitignore gains the lines pensmith needs (paper-gitignore.ts).
// The move runs once: it is keyed on the root STATE.json, which goes last.

import { existsSync, readFileSync } from 'node:fs';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { atomicWriteFile, isDryRun, removePath } from '../atomic-write.js';
import { withLock } from '../lock.js';
import { ensurePaperGitignore } from '../paper-gitignore.js';
import { legacyConfigFile, legacyStateFile, paperConfigFile, paperStateFile } from '../paths.js';

/** The top-level keys of a config.toml that PRD §10 documents. */
const PENSMITH_CONFIG_KEYS = new Set([
  'schema_version', 'project', 'sources', 'verification', 'humanizer', 'style', 'runtime', 'budget', 'network',
]);

/** True for the JSON pensmith wrote as STATE.json. */
function isPensmithState(text: string): boolean {
  try {
    const v = JSON.parse(text) as Record<string, unknown> | null;
    return (
      v !== null && typeof v === 'object' && !Array.isArray(v) &&
      typeof v['$schemaVersion'] === 'number' && typeof v['paperId'] === 'string' && typeof v['createdAt'] === 'string'
    );
  } catch {
    return false;
  }
}

function isTable(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

async function moveLegacyConfig(root: string): Promise<void> {
  const from = legacyConfigFile(root);
  const to = paperConfigFile(root);
  if (!existsSync(from) || existsSync(to)) return;
  let text: string;
  let doc: Record<string, unknown>;
  try {
    text = readFileSync(from, 'utf8');
    doc = parseToml(text) as Record<string, unknown>;
  } catch (e) {
    process.stderr.write(
      `pensmith: config.toml in the project root could not be read (${(e as Error).message}); ` +
        'it was left as it is, and pensmith now reads its settings from .paper/config.toml only.\n',
    );
    return;
  }
  const keys = Object.keys(doc);
  const ours = keys.filter((k) => PENSMITH_CONFIG_KEYS.has(k));
  if (ours.length === 0) return;
  if (ours.length === keys.length) {
    await atomicWriteFile(to, text);
    await removePath(from);
    process.stderr.write('pensmith: moved config.toml into .paper/.\n');
    return;
  }
  const copy: Record<string, unknown> = {};
  for (const k of ours) if (k === 'schema_version' || isTable(doc[k])) copy[k] = doc[k];
  await atomicWriteFile(to, stringifyToml(copy) + '\n');
  process.stderr.write(
    `pensmith: copied the [${ours.join('], [')}] settings from config.toml into .paper/config.toml; ` +
      'config.toml in the project root was not changed, and pensmith no longer reads it.\n',
  );
}

/**
 * True when the project at `root` is still laid out the old way: a pensmith
 * STATE.json in the project root and none in .paper/.
 */
export function hasLegacyLayout(root: string): boolean {
  const legacy = legacyStateFile(root);
  if (!existsSync(legacy) || existsSync(paperStateFile(root))) return false;
  try {
    return isPensmithState(readFileSync(legacy, 'utf8'));
  } catch {
    return false;
  }
}

/** The paperId and createdAt of a pensmith STATE.json, or null. */
function stateIdentity(file: string): string | null {
  try {
    const text = readFileSync(file, 'utf8');
    if (!isPensmithState(text)) return null;
    const v = JSON.parse(text) as { paperId: string; createdAt: string };
    return `${v.paperId} ${v.createdAt}`;
  } catch {
    return null;
  }
}

/**
 * Remove a root STATE.json that a move stopped before its last step left
 * behind: the same paper (paperId and createdAt) as .paper/STATE.json.
 */
async function removeLeftoverState(legacy: string, target: string): Promise<void> {
  await withLock(target, async () => {
    const left = stateIdentity(legacy);
    if (left !== null && left === stateIdentity(target)) await removePath(legacy);
  });
}

/**
 * Move STATE.json and config.toml from the project root at `root` into
 * .paper/, when the project is still laid out the old way. Does nothing in a
 * dry run (which writes nothing), or when the root STATE.json is not
 * pensmith's; when .paper/STATE.json already exists, it only removes a root
 * copy of the same paper that an interrupted move left. Readers do not call
 * it (they read an old layout in place); the dispatcher and the state
 * writers do.
 */
export async function migrateLegacyLayout(root: string): Promise<boolean> {
  const legacy = legacyStateFile(root);
  const target = paperStateFile(root);
  if (!existsSync(legacy) || isDryRun()) return false;
  if (existsSync(target)) {
    await removeLeftoverState(legacy, target);
    return false;
  }
  let moved = false;
  await withLock(target, async () => {
    if (!existsSync(legacy) || existsSync(target)) return; // another process moved it
    const text = readFileSync(legacy, 'utf8');
    if (!isPensmithState(text)) return;
    await moveLegacyConfig(root);
    await ensurePaperGitignore(root);
    await atomicWriteFile(target, text);
    await removePath(legacy);
    moved = true;
  });
  if (moved) process.stderr.write('pensmith: moved STATE.json into .paper/, where pensmith now keeps it.\n');
  return moved;
}
