// bin/lib/assignment.ts — where `pensmith new` gets the assignment from
// (GRND-01, D-18-08; PRD §5.1 row 1, §7.1).
//
// Sources, in order:
//   1. `--from <file>`;
//   2. a positional `@path` (`pensmith new @notes.md`);
//   3. an assignment piped on stdin — only when no file was named, stdin is
//      not a terminal, its fstat is a FIFO or a non-empty regular file and
//      PENSMITH_PROMPT_MODE is not `numbered` (then stdin carries scripted
//      answers). Reading waits at most 2 s for the first byte (no byte and no
//      EOF → no stdin assignment, so a never-closing stdin cannot hang `new`),
//      caps the text at 1 MiB, then reads to EOF (stdin-source.ts, D-17-36);
//   4. an `assignment.{txt,md,pdf}` in the paper folder, through the
//      `assignment-pickup` gate: a terminal confirms it; --yolo and a run that
//      cannot prompt use it and print its name; "no" falls through to paste.
//      Several such files: a select in a terminal, EXIT_USAGE naming them
//      otherwise;
//   5. an interactive multi-line paste (a terminal, or scripted numbered
//      answers).
// A `--thesis` seed (from `sketch`) may stand in for the assignment. Nothing
// found in a run that cannot prompt is EXIT_USAGE `no assignment found` —
// decided before anything is written.
//
// Supported files: .txt, .md, .pdf. A PDF goes through the pdf-text.ts
// chokepoint (PyMuPDF fallback) and only its TEXT is ever kept — no `%PDF-`
// byte reaches `.paper/`. A missing, unreadable, unsupported, oversized or
// empty input fails with one line (EXIT_USAGE), never a stack trace.

import * as fs from 'node:fs';
import path from 'node:path';
import { ASSIGNMENT_FILE_NAMES } from './paths.js';
import { PensmithError, EXIT_USAGE } from './exit-codes.js';
import { stdinMayCarryAssignment } from './stdin-source.js';
import { runGate } from './gates.js';
import type { PromptAnswer, PromptQuestion } from './prompts.js';
import type { AssignmentSourceKind } from './intake-brief.js';

/** File types an assignment may come in (GRND-01). */
export const SUPPORTED_ASSIGNMENT_TYPES: readonly string[] = Object.freeze(['.txt', '.md', '.pdf']);

/** The largest assignment text accepted (a file's text, stdin, a paste): 1 MiB. */
export const MAX_ASSIGNMENT_BYTES = 1024 * 1024;

/** How long piped stdin may stay silent before it is taken to carry nothing (D-18-08). */
export const STDIN_FIRST_BYTE_TIMEOUT_MS = 2000;

export interface AssignmentSource {
  readonly kind: AssignmentSourceKind;
  /** The file name (never a full path) for file sources; '' otherwise. */
  readonly name: string;
}

export interface ResolvedAssignment {
  /** The assignment text, verbatim (a PDF's extracted text), or '' for a thesis-seed-only intake. */
  readonly text: string;
  readonly source: AssignmentSource;
}

function usage(message: string): PensmithError {
  return new PensmithError(message, EXIT_USAGE);
}

/** Drop a UTF-8 byte-order mark; keep every other byte of the text. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function mib(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)} MiB`;
}

/**
 * The text of an assignment file: .txt and .md verbatim (UTF-8, BOM dropped),
 * .pdf through the pdf-text chokepoint. Fails with one EXIT_USAGE line for a
 * missing, unreadable, unsupported, oversized or empty file; the line names
 * the file as `shown` (what the user typed: `--from notes.txt`, `@notes.md`).
 */
export async function readAssignmentFile(file: string, shown: string): Promise<string> {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    throw usage(`${shown}: no such file`);
  }
  if (!st.isFile()) throw usage(`${shown}: not a file`);
  const ext = path.extname(file).toLowerCase();
  if (!SUPPORTED_ASSIGNMENT_TYPES.includes(ext)) {
    throw usage(`${shown}: unsupported file type "${ext || '(none)'}" — supported types: ${SUPPORTED_ASSIGNMENT_TYPES.join(', ')}`);
  }
  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(file);
  } catch (e) {
    throw usage(`${shown}: cannot read it (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`);
  }
  let text: string;
  if (ext === '.pdf') {
    const { extractPdfText } = await import('./pdf-text.js');
    try {
      text = await extractPdfText(bytes);
    } catch (e) {
      throw usage(`${shown}: cannot extract text from this PDF (${(e as Error).message.split('\n')[0]})`);
    }
    if (text.trim().length === 0) throw usage(`${shown}: the PDF has no extractable text (a scanned PDF needs PyMuPDF, or paste the text)`);
  } else {
    if (bytes.length > MAX_ASSIGNMENT_BYTES) throw usage(`${shown}: larger than ${mib(MAX_ASSIGNMENT_BYTES)} — an assignment should be a few pages`);
    text = stripBom(bytes.toString('utf8'));
    if (text.trim().length === 0) throw usage(`${shown}: the file is empty`);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_ASSIGNMENT_BYTES) throw usage(`${shown}: its text is larger than ${mib(MAX_ASSIGNMENT_BYTES)}`);
  return text;
}

/**
 * Read an assignment piped on stdin (the caller checked stdinMayCarryAssignment).
 * Resolves null when no byte (and no EOF) arrives within the first-byte
 * timeout, or when the input is empty or whitespace; throws EXIT_USAGE when
 * the text passes 1 MiB. After the first byte it reads to EOF.
 */
export function readPipedStdin(
  stream: NodeJS.ReadableStream = process.stdin,
  opts: { firstByteTimeoutMs?: number; maxBytes?: number } = {},
): Promise<string | null> {
  const timeoutMs = opts.firstByteTimeoutMs ?? STDIN_FIRST_BYTE_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_ASSIGNMENT_BYTES;
  return new Promise<string | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let started = false;
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      stream.pause();
    };
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onData = (chunk: Buffer | string): void => {
      started = true;
      const b = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      total += b.length;
      if (total > maxBytes) {
        settle(() => reject(usage(`the assignment piped on stdin is larger than ${mib(maxBytes)} — an assignment should be a few pages`)));
        return;
      }
      chunks.push(b);
    };
    const onEnd = (): void => {
      settle(() => {
        const text = stripBom(Buffer.concat(chunks).toString('utf8'));
        resolve(text.trim().length === 0 ? null : text);
      });
    };
    const onError = (): void => settle(() => resolve(null));
    const timer = setTimeout(() => {
      if (!started) settle(() => resolve(null));
    }, timeoutMs);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    stream.resume();
  });
}

/** The fewest words a piped stdin must hold to be read as an assignment ("Write about tides." is 3). */
export const MIN_STDIN_ASSIGNMENT_WORDS = 3;

export interface ResolveAssignmentOptions {
  /** The paper's project root (where `assignment.*` is looked for). */
  readonly root: string;
  /** `--from <file>` (resolved against the working directory). */
  readonly from?: string | undefined;
  /** The positional source (`@path`; a bare path is accepted too). */
  readonly at?: string | undefined;
  /** A `--thesis` seed: stands in for the assignment when nothing else is found. */
  readonly thesisSeed?: string | undefined;
  readonly yolo: boolean;
  /** The run can prompt (a terminal, or scripted numbered answers). */
  readonly canPrompt: boolean;
  /** Asks the paste question (bin/cli/intake.ts passes prompts.ts ask()). */
  ask(q: PromptQuestion): Promise<PromptAnswer>;
  /** One status line (stdout) — the picked-up file is named. */
  say(line: string): void;
  /** Test seams: whether stdin may carry an assignment, and how to read it. */
  readonly stdinMayCarry?: boolean;
  readStdin?(): Promise<string | null>;
  /** The working directory `--from` and `@path` are resolved against. */
  readonly cwd?: string;
}

/** The one-line refusal when no source produced an assignment. */
export function noAssignmentError(root: string): PensmithError {
  return usage(
    `no assignment found: pass --from <file> or @<file> (.txt, .md, .pdf), pipe it on stdin, ` +
      `put ${ASSIGNMENT_FILE_NAMES.join(' / ')} in ${root}, or run in a terminal to paste it`,
  );
}

/** Every `assignment.{txt,md,pdf}` in `root`, in ASSIGNMENT_FILE_NAMES order. */
export function assignmentFilesIn(root: string): string[] {
  const out: string[] = [];
  for (const name of ASSIGNMENT_FILE_NAMES) {
    const p = path.join(path.resolve(root), name);
    try {
      if (fs.statSync(p).isFile()) out.push(p);
    } catch {
      // absent
    }
  }
  return out;
}

/** The folder's assignment file: the gate decides; null when declined (→ paste). */
async function pickUpFromFolder(o: ResolveAssignmentOptions): Promise<string | null> {
  const files = assignmentFilesIn(o.root);
  if (files.length === 0) return null;
  const names = files.map((f) => path.basename(f));
  if (files.length > 1) {
    if (o.yolo || !o.canPrompt) {
      throw usage(
        `several assignment files in ${o.root}: ${names.join(', ')} — name one with --from <file> or @<file>`,
      );
    }
    const pasteValue = '(paste instead)';
    const outcome = await runGate('assignment-pickup', {
      yolo: false,
      question: {
        id: 'assignment-pickup',
        kind: 'select',
        label: 'Which assignment file in this folder should I use?',
        options: [...names.map((n) => ({ value: n, label: n })), { value: pasteValue, label: 'None of them — paste the assignment instead' }],
        default: names[0] as string,
      },
    });
    if (outcome.kind === 'answered' && outcome.answer.kind === 'select' && outcome.answer.value !== pasteValue) {
      return path.join(path.resolve(o.root), outcome.answer.value);
    }
    return null;
  }
  const file = files[0] as string;
  const name = path.basename(file);
  const outcome = await runGate('assignment-pickup', {
    yolo: o.yolo,
    detail: name,
    question: { id: 'assignment-pickup', kind: 'confirm', label: `Use the assignment file in this folder (${name})?`, default: true },
  });
  if (outcome.kind === 'answered') {
    return outcome.answer.kind === 'confirm' && outcome.answer.value === true ? file : null;
  }
  // --yolo, or a run that cannot prompt: the gate's skip choice is "use the file".
  o.say(`pensmith new: using the assignment file in this folder: ${name}`);
  return file;
}

/**
 * Resolve the assignment for `pensmith new` (see the module comment for the
 * order). Throws a one-line EXIT_USAGE PensmithError when a named input is
 * bad or when nothing is found in a run that cannot prompt.
 */
export async function resolveAssignment(o: ResolveAssignmentOptions): Promise<ResolvedAssignment> {
  // --from and @path are relative to where the user typed them (path.resolve's default).
  const here = (p: string): string => (o.cwd !== undefined ? path.resolve(o.cwd, p) : path.resolve(p));
  const from = typeof o.from === 'string' && o.from.length > 0 ? o.from : undefined;
  const atRaw = typeof o.at === 'string' && o.at.length > 0 ? o.at : undefined;
  if (from !== undefined && atRaw !== undefined) {
    throw usage(`give the assignment once: --from ${from} or ${atRaw}, not both`);
  }
  if (from !== undefined) {
    const file = here(from);
    return { text: await readAssignmentFile(file, `--from ${from}`), source: { kind: 'file', name: path.basename(file) } };
  }
  if (atRaw !== undefined) {
    const rel = atRaw.startsWith('@') ? atRaw.slice(1) : atRaw;
    if (rel.length === 0) throw usage('@: name the assignment file after the @ (e.g. new @assignment.pdf)');
    const file = here(rel);
    return { text: await readAssignmentFile(file, `@${rel}`), source: { kind: 'at-file', name: path.basename(file) } };
  }
  const mayStdin = o.stdinMayCarry ?? (!process.stdin.isTTY && stdinMayCarryAssignment());
  if (mayStdin) {
    const text = await (o.readStdin ? o.readStdin() : readPipedStdin());
    if (text !== null) {
      // A confirmation piped into the run (`printf 'y\n' | pensmith`) is not
      // an assignment: refuse it before anything is written.
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      if (words < MIN_STDIN_ASSIGNMENT_WORDS) {
        const shown = text.trim().length > 40 ? `${text.trim().slice(0, 40)}…` : text.trim();
        throw usage(
          `the text piped on stdin (${JSON.stringify(shown)}) is too short to be an assignment ` +
            `(fewer than ${MIN_STDIN_ASSIGNMENT_WORDS} words); pipe the assignment itself, or pass --from <file>`,
        );
      }
      return { text, source: { kind: 'stdin', name: '' } };
    }
  }
  const picked = await pickUpFromFolder(o);
  if (picked !== null) {
    return { text: await readAssignmentFile(picked, path.basename(picked)), source: { kind: 'cwd', name: path.basename(picked) } };
  }
  const seed = (o.thesisSeed ?? '').trim();
  if (o.canPrompt && seed.length === 0) {
    const a = await o.ask({
      id: 'assignment',
      kind: 'multiline',
      label: 'Paste the assignment (the prompt, rubric or brief your instructor gave you)',
    });
    const text = a.kind === 'multiline' || a.kind === 'text' ? String(a.value) : '';
    if (text.trim().length === 0) throw usage('the pasted assignment is empty');
    if (Buffer.byteLength(text, 'utf8') > MAX_ASSIGNMENT_BYTES) throw usage(`the pasted assignment is larger than ${mib(MAX_ASSIGNMENT_BYTES)}`);
    return { text, source: { kind: 'paste', name: '' } };
  }
  if (seed.length > 0) return { text: '', source: { kind: 'thesis-seed', name: '' } };
  throw noAssignmentError(o.root);
}
