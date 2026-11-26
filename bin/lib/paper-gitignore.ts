// bin/lib/paper-gitignore.ts — the .paper/.gitignore pensmith needs.
//
// Two kinds of file in .paper/ must never be committed:
//   - INTAKE.raw.local (any *.local): the unredacted assignment and answers
//     when PII redaction is on;
//   - sources/: the full text of every PDF `pensmith add` read, which is
//     usually someone else's copyrighted work.
// A missing .gitignore is written whole. An existing one is the user's: the
// lines it lacks are appended and nothing else in it changes.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { paperDir } from './paths.js';

const REQUIRED_LINES = ['INTAKE.raw.local', '*.local', 'sources/'];

const NEW_FILE = [
  '# Written by pensmith: keep these out of git.',
  '# INTAKE.raw.local holds the unredacted assignment and answers when PII redaction is on.',
  'INTAKE.raw.local',
  '*.local',
  '# sources/ holds the full text of the PDFs you added.',
  'sources/',
  '',
].join('\n');

/**
 * Make `<root>/.paper/.gitignore` ignore the files above. Best-effort: a
 * .paper/ that cannot be written must not stop the verb that called it.
 */
export async function ensurePaperGitignore(root: string = process.cwd()): Promise<void> {
  const file = path.join(paperDir(root), '.gitignore');
  try {
    if (!existsSync(file)) {
      await atomicWriteFile(file, NEW_FILE);
      return;
    }
    const text = readFileSync(file, 'utf8');
    const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
    const missing = REQUIRED_LINES.filter((l) => !have.has(l));
    if (missing.length === 0) return;
    const sep = text === '' || text.endsWith('\n') ? '' : '\n';
    await atomicWriteFile(file, `${text}${sep}${missing.join('\n')}\n`);
  } catch {
    // best-effort, see above
  }
}
