// tests/intake-assignment.test.ts — GRND-01 (D-18-08): where `pensmith new`
// gets the assignment from, unit level (bin/lib/assignment.ts and the stdin
// predicate of bin/lib/stdin-source.ts). The CLI user paths are in
// tests/intake-cli.test.ts and tests/gates-intake.test.ts.
//
//   - files: .txt/.md verbatim (BOM dropped, CRLF kept), .pdf through the
//     pdf-text chokepoint (text only), missing / unsupported / empty /
//     oversized inputs fail with one EXIT_USAGE line naming the path as typed;
//   - piped stdin: read to EOF; silent for the first-byte timeout → nothing
//     piped; empty → nothing piped; over 1 MiB → one-line refusal;
//   - the order: --from, @path (both → refused), stdin, the folder's
//     assignment.* (one: used under --yolo or without a terminal; several:
//     EXIT_USAGE naming them), a paste, a thesis seed, else "no assignment
//     found";
//   - stdinMayCarryAssignment: a FIFO or non-empty file only, never
//     numbered-answer mode.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_ASSIGNMENT_BYTES,
  readAssignmentFile,
  readPipedStdin,
  resolveAssignment,
  type ResolveAssignmentOptions,
} from '../bin/lib/assignment.js';
import { statMayCarryAssignment, stdinMayCarryAssignment } from '../bin/lib/stdin-source.js';
import { resolvePaperRoot } from '../bin/lib/paths.js';
import { PensmithError, EXIT_USAGE } from '../bin/lib/exit-codes.js';
import type { PromptAnswer, PromptQuestion } from '../bin/lib/prompts.js';

const PDF = fileURLToPath(new URL('./fixtures/assignment.pdf', import.meta.url));

function dir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-assignment-')));
}

function usageError(re: RegExp): (e: unknown) => boolean {
  return (e: unknown) => e instanceof PensmithError && e.exitCode === EXIT_USAGE && re.test(e.message) && !e.message.includes('\n');
}

function opts(root: string, extra: Partial<ResolveAssignmentOptions> = {}): ResolveAssignmentOptions & { said: string[]; asked: PromptQuestion[] } {
  const said: string[] = [];
  const asked: PromptQuestion[] = [];
  return {
    root,
    cwd: root,
    yolo: false,
    canPrompt: false,
    stdinMayCarry: false,
    ask: async (q: PromptQuestion): Promise<PromptAnswer> => {
      asked.push(q);
      return { id: q.id, kind: 'multiline', value: 'Pasted: write about bridges.' };
    },
    say: (l: string) => said.push(l),
    said,
    asked,
    ...extra,
  };
}

test('GRND-01: .txt and .md are read verbatim (BOM dropped, CRLF kept); .pdf yields its text only', async () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'a.txt'), '﻿Write about tides.\r\nUse APA.\r\n');
  assert.equal(await readAssignmentFile(path.join(d, 'a.txt'), 'a.txt'), 'Write about tides.\r\nUse APA.\r\n');
  fs.writeFileSync(path.join(d, 'a.md'), '# Brief\n\nWrite about tides.\n');
  assert.equal(await readAssignmentFile(path.join(d, 'a.md'), 'a.md'), '# Brief\n\nWrite about tides.\n');
  const text = await readAssignmentFile(PDF, '@assignment.pdf');
  assert.match(text, /The review must compare self-attention with recurrent sequence models\./);
  assert.ok(!text.includes('%PDF-'), 'no PDF bytes, only its text');
});

test('GRND-01: missing, unsupported, empty and oversized files fail with one line naming the path as typed', async () => {
  const d = dir();
  await assert.rejects(readAssignmentFile(path.join(d, 'missing.txt'), '@missing.txt'), usageError(/^@missing\.txt: no such file$/));
  fs.writeFileSync(path.join(d, 'file.docx'), 'PK');
  await assert.rejects(readAssignmentFile(path.join(d, 'file.docx'), '@file.docx'), usageError(/^@file\.docx: unsupported file type "\.docx" — supported types: \.txt, \.md, \.pdf$/));
  fs.writeFileSync(path.join(d, 'empty.md'), ' \n\t\n');
  await assert.rejects(readAssignmentFile(path.join(d, 'empty.md'), '--from empty.md'), usageError(/^--from empty\.md: the file is empty$/));
  fs.writeFileSync(path.join(d, 'big.txt'), 'x'.repeat(MAX_ASSIGNMENT_BYTES + 1));
  await assert.rejects(readAssignmentFile(path.join(d, 'big.txt'), 'big.txt'), usageError(/larger than 1 MiB/));
  fs.mkdirSync(path.join(d, 'folder.txt'));
  await assert.rejects(readAssignmentFile(path.join(d, 'folder.txt'), 'folder.txt'), usageError(/not a file/));
  fs.writeFileSync(path.join(d, 'broken.pdf'), '%PDF-1.4 not really');
  await assert.rejects(readAssignmentFile(path.join(d, 'broken.pdf'), '@broken.pdf'), usageError(/^@broken\.pdf: cannot extract text from this PDF|^@broken\.pdf: the PDF has no extractable text/));
});

test('GRND-01: piped stdin is read to EOF; silence, emptiness and oversize are handled without hanging', async () => {
  const piped = new PassThrough();
  queueMicrotask(() => {
    piped.write('Argue whether social media\r\n');
    setTimeout(() => piped.end('harms adolescents.\r\n'), 30);
  });
  assert.equal(await readPipedStdin(piped, { firstByteTimeoutMs: 1000 }), 'Argue whether social media\r\nharms adolescents.\r\n');

  const silent = new PassThrough();
  const started = Date.now();
  assert.equal(await readPipedStdin(silent, { firstByteTimeoutMs: 50 }), null, 'no byte and no EOF → nothing piped');
  assert.ok(Date.now() - started < 2000);

  const empty = new PassThrough();
  queueMicrotask(() => empty.end('  \n'));
  assert.equal(await readPipedStdin(empty, { firstByteTimeoutMs: 1000 }), null, 'an empty pipe carries no assignment');

  const huge = new PassThrough();
  queueMicrotask(() => huge.end('y'.repeat(64)));
  await assert.rejects(readPipedStdin(huge, { firstByteTimeoutMs: 1000, maxBytes: 32 }), usageError(/^the assignment piped on stdin is larger than/));
});

test('GRND-01: the order — --from, then @path; both at once is refused', async () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'notes.md'), 'Write about notes.');
  fs.writeFileSync(path.join(d, 'assignment.txt'), 'Write about the folder file.');
  const o = opts(d, { stdinMayCarry: true, readStdin: async () => 'Write about stdin.' });
  assert.deepEqual(await resolveAssignment({ ...o, from: 'notes.md' }), { text: 'Write about notes.', source: { kind: 'file', name: 'notes.md' } });
  assert.deepEqual(await resolveAssignment({ ...o, at: '@notes.md' }), { text: 'Write about notes.', source: { kind: 'at-file', name: 'notes.md' } });
  await assert.rejects(resolveAssignment({ ...o, from: 'notes.md', at: '@notes.md' }), usageError(/give the assignment once/));
  await assert.rejects(resolveAssignment({ ...o, at: '@' }), usageError(/name the assignment file after the @/));
  assert.deepEqual(await resolveAssignment(o), { text: 'Write about stdin.', source: { kind: 'stdin', name: '' } }, 'stdin before the folder file');
  // A piped confirmation ("y") is not an assignment (fewer than 3 words): one line, EXIT_USAGE.
  await assert.rejects(resolveAssignment(opts(d, { stdinMayCarry: true, readStdin: async () => 'y\n' })), usageError(/^the text piped on stdin \("y"\) is too short to be an assignment \(fewer than 3 words\)/));
});

test('GRND-01: the folder\'s assignment file — used without a terminal or under --yolo (and named); several files refuse', async () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'assignment.md'), 'Write about the folder file.');
  const noTty = opts(d, { stdinMayCarry: true, readStdin: async () => null });
  assert.deepEqual(await resolveAssignment(noTty), { text: 'Write about the folder file.', source: { kind: 'cwd', name: 'assignment.md' } });
  assert.deepEqual(noTty.said, ['pensmith new: using the assignment file in this folder: assignment.md']);
  const yolo = opts(d, { yolo: true });
  assert.equal((await resolveAssignment(yolo)).source.kind, 'cwd');
  fs.writeFileSync(path.join(d, 'assignment.txt'), 'Another one.');
  await assert.rejects(resolveAssignment(opts(d)), usageError(/^several assignment files in .+: assignment\.txt, assignment\.md — name one with --from <file> or @<file>$/));
  await assert.rejects(resolveAssignment(opts(d, { yolo: true })), usageError(/several assignment files/));
});

test('GRND-01: a paste when the run can prompt; a thesis seed alone; otherwise "no assignment found"', async () => {
  const d = dir();
  const paste = opts(d, { canPrompt: true });
  assert.deepEqual(await resolveAssignment(paste), { text: 'Pasted: write about bridges.', source: { kind: 'paste', name: '' } });
  assert.equal(paste.asked[0]?.kind, 'multiline');
  const seedOnly = opts(d, { canPrompt: true, thesisSeed: 'Bridges shape cities.' });
  assert.deepEqual(await resolveAssignment(seedOnly), { text: '', source: { kind: 'thesis-seed', name: '' } });
  assert.equal(seedOnly.asked.length, 0, 'a thesis seed (sketch) is not asked to paste');
  await assert.rejects(resolveAssignment(opts(d)), usageError(/^no assignment found: pass --from <file> or @<file> \(\.txt, \.md, \.pdf\), pipe it on stdin, put assignment\.txt \/ assignment\.md \/ assignment\.pdf in .+, or run in a terminal to paste it$/));
  const emptyPaste = opts(d, { canPrompt: true, ask: async (q) => ({ id: q.id, kind: 'multiline', value: '   ' }) });
  await assert.rejects(resolveAssignment(emptyPaste), usageError(/the pasted assignment is empty/));
});

test('GRND-01 / RUN-14: stdin may carry an assignment only as a FIFO or a non-empty file, never in numbered-answer mode', () => {
  const d = dir();
  const file = path.join(d, 'stdin.txt');
  fs.writeFileSync(file, 'Write about tides.');
  const fd = fs.openSync(file, 'r');
  const emptyFile = path.join(d, 'empty.txt');
  fs.writeFileSync(emptyFile, '');
  const efd = fs.openSync(emptyFile, 'r');
  try {
    assert.equal(stdinMayCarryAssignment({}, fd), true, 'a regular file');
    assert.equal(stdinMayCarryAssignment({ PENSMITH_PROMPT_MODE: 'numbered' }, fd), false, 'numbered mode: stdin carries answers');
    assert.equal(stdinMayCarryAssignment({}, efd), false, 'an empty file');
    assert.equal(stdinMayCarryAssignment({}, 987654), false, 'an invalid descriptor');
  } finally {
    fs.closeSync(fd);
    fs.closeSync(efd);
  }
  // The file type comes from st_mode's type bits on every platform: Node's
  // Stats.isFIFO() / isSocket() are always false on Windows, where libuv's
  // fstat reports a pipe (`type a.txt | pensmith`, child_process 'pipe') as
  // exactly _S_IFIFO with size 0, and NUL as a character device.
  assert.equal(statMayCarryAssignment({ mode: 0o010000, size: 0 }), true, 'a pipe (a POSIX FIFO; libuv\'s Windows pipe)');
  assert.equal(statMayCarryAssignment({ mode: 0o140755, size: 0 }), true, 'a socket');
  assert.equal(statMayCarryAssignment({ mode: 0o100644, size: 18 }), true, 'a non-empty regular file');
  assert.equal(statMayCarryAssignment({ mode: 0o100644, size: 0 }), false, 'an empty regular file');
  assert.equal(statMayCarryAssignment({ mode: 0o020666, size: 0 }), false, '/dev/null or NUL (a character device)');
  assert.equal(statMayCarryAssignment({ mode: 0o040755, size: 4096 }), false, 'a directory');
  // The resolver: a bare run with a piped assignment starts a new paper here.
  const empty = dir();
  assert.deepEqual(resolvePaperRoot({ verb: null, mode: 'cli', cwd: empty, env: {}, stdinAssignment: true }), { kind: 'root', root: empty, source: 'new' });
  assert.notDeepEqual(resolvePaperRoot({ verb: null, mode: 'cli', cwd: empty, env: {}, stdinAssignment: false }), { kind: 'root', root: empty, source: 'new' });
});
