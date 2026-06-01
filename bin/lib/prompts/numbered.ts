// bin/lib/prompts/numbered.ts — Pure stdin numbered-prompt fallback.
//
// TIER-05: Headless / piped / CI prompt mode. Reads from process.stdin via
// node:readline createInterface. Writes to process.stderr (NEVER stdout —
// stdout is reserved for tier-contract-comparable JSON output downstream).
//
// This file MUST NOT import @clack/prompts — it is the dependency-free path.
// Tests assert this via grep (single-source-of-truth invariant, see Task 3).
//
// Security mitigations:
//   T-02-09-01: Each prompt reads exactly ONE line via rl.once('line', ...).
//   T-02-09-02: Index parsed with parseInt + bounds check (1 to N); out-of-range
//               is a re-prompt, not an exception.
//   T-02-09-03: This file never calls any logging function. No process.stdout writes.
//   T-02-09-04: Per-question timeout via PENSMITH_PROMPT_TIMEOUT_MS (default 5 min).
//
// Wire protocol (stderr output, one example):
//   [pensmith] Which discipline preset should I use? (select)
//     1) cs       — Computer science (APA + arXiv-heavy)
//     2) bio      — Biological sciences (CSE + PubMed-heavy)
//   [default: Computer science]  Enter a number 1-2:

import * as readline from 'node:readline';
import { PromptAbortedError, PromptTimeoutError } from '../prompts.js';
import type { PromptQuestion, PromptAnswer } from './schema.js';

// ── Options ───────────────────────────────────────────────────────────────────

export interface NumberedAskOptions {
  stdin?: NodeJS.ReadableStream;   // default: process.stdin
  stderr?: NodeJS.WritableStream;  // default: process.stderr
  timeoutMs?: number;              // default: env PENSMITH_PROMPT_TIMEOUT_MS or 5 min
}

// ── Default timeout resolution ────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function resolveTimeout(opts?: NumberedAskOptions): number {
  if (opts?.timeoutMs !== undefined) return opts.timeoutMs;
  const envVal = process.env['PENSMITH_PROMPT_TIMEOUT_MS'];
  if (envVal !== undefined) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function writeStderr(stream: NodeJS.WritableStream, text: string): void {
  stream.write(text);
}

function renderQuestion(question: PromptQuestion, stderr: NodeJS.WritableStream): void {
  // Header line
  writeStderr(stderr, `[pensmith] ${question.label} (${question.kind})\n`);

  if (question.kind === 'select' || question.kind === 'multiselect') {
    // Numbered option list: "  1) <value>  — <label>"
    for (let i = 0; i < question.options.length; i++) {
      const opt = question.options[i];
      if (!opt) continue;
      writeStderr(stderr, `  ${i + 1}) ${opt.value}  — ${opt.label}\n`);
      if (opt.hint) {
        writeStderr(stderr, `       ${opt.hint}\n`);
      }
    }

    // Default indicator
    if (question.kind === 'select' && question.default !== undefined) {
      const defaultOpt = question.options.find((o) => o.value === question.default);
      const defaultLabel = defaultOpt?.label ?? question.default;
      const defaultIdx = question.options.findIndex((o) => o.value === question.default) + 1;
      writeStderr(stderr, `[default: ${defaultLabel} (${defaultIdx})]  Enter a number 1-${question.options.length}: `);
    } else if (question.kind === 'multiselect' && question.default !== undefined && question.default.length > 0) {
      const defaultLabels = question.default.map((dv) => {
        const found = question.options.find((o) => o.value === dv);
        return found?.label ?? dv;
      });
      writeStderr(stderr, `[default: ${defaultLabels.join(', ')}]  Enter numbers (comma-separated) 1-${question.options.length}: `);
    } else {
      const separator = question.kind === 'multiselect' ? 'comma-separated ' : '';
      writeStderr(stderr, `Enter ${separator}number 1-${question.options.length}: `);
    }
  } else if (question.kind === 'text') {
    if (question.placeholder) {
      writeStderr(stderr, `  (e.g. ${question.placeholder})\n`);
    }
    if (question.default !== undefined) {
      writeStderr(stderr, `[default: ${question.default}]  `);
    }
    writeStderr(stderr, `Enter text (blank to keep default): `);
  } else if (question.kind === 'confirm') {
    const hint = question.default === true ? '[Y/n]' : '[y/N]';
    writeStderr(stderr, `${hint}  Enter y or n: `);
  }
}

// ── Read one line ─────────────────────────────────────────────────────────────

/**
 * Read exactly one newline-terminated line from stdin.
 * Returns the trimmed line or rejects with PromptAbortedError (EOF) /
 * PromptTimeoutError (timeout).
 */
async function readOneLine(
  id: string,
  stdin: NodeJS.ReadableStream,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const rl = readline.createInterface({
      input: stdin,
      output: undefined,    // we manage output ourselves on stderr
      terminal: false,      // required on Windows + piped stdin
      crlfDelay: Infinity,  // collapse \r\n into single line event on Windows
    });

    let settled = false;

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      action();
    }

    // The timer is intentionally NOT unref'd. While a prompt is pending we are
    // actively waiting for input, so the timeout must keep the event loop alive
    // and fire deterministically — even when stdin is a closed / non-TTY pipe
    // (as in CI) that does not itself hold the loop open. settle() always
    // clearTimeout()s it, so it never outlives a resolved prompt. (An unref'd
    // timer here caused CI-only flakiness: the loop drained before it fired,
    // leaving the promise pending → node:test "cancelledByParent".)
    const timer = setTimeout(() => {
      settle(() => reject(new PromptTimeoutError(id, timeoutMs)));
    }, timeoutMs);

    rl.once('line', (line: string) => {
      settle(() => resolve(line.trim()));
    });

    rl.once('close', () => {
      settle(() => reject(new PromptAbortedError(id)));
    });
  });
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

function parseSelectIndex(line: string, maxIdx: number): number | null {
  const n = parseInt(line, 10);
  if (!Number.isInteger(n) || n < 1 || n > maxIdx) return null;
  return n;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function askNumbered(
  question: PromptQuestion,
  opts?: NumberedAskOptions,
): Promise<PromptAnswer> {
  const stdin: NodeJS.ReadableStream = opts?.stdin ?? process.stdin;
  const stderr: NodeJS.WritableStream = opts?.stderr ?? process.stderr;
  const timeoutMs = resolveTimeout(opts);

  renderQuestion(question, stderr);

  switch (question.kind) {
    case 'select': {
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const line = await readOneLine(question.id, stdin, timeoutMs);
        // Blank line → use default
        if (line === '' && question.default !== undefined) {
          return { id: question.id, kind: 'select', value: question.default };
        }
        const idx = parseSelectIndex(line, question.options.length);
        if (idx !== null) {
          const opt = question.options[idx - 1];
          if (opt) {
            return { id: question.id, kind: 'select', value: opt.value };
          }
        }
        if (attempt < maxRetries - 1) {
          writeStderr(stderr, `Out of range, please enter 1-${question.options.length}: `);
        }
      }
      throw new PromptAbortedError(question.id);
    }

    case 'multiselect': {
      const line = await readOneLine(question.id, stdin, timeoutMs);
      // Blank line → use default (or empty array)
      if (line === '') {
        return {
          id: question.id,
          kind: 'multiselect',
          value: question.default ?? [],
        };
      }
      // Parse comma-separated 1-based indices
      const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
      const values: string[] = [];
      const seen = new Set<string>();
      for (const part of parts) {
        const idx = parseSelectIndex(part, question.options.length);
        if (idx !== null) {
          const opt = question.options[idx - 1];
          if (opt && !seen.has(opt.value)) {
            seen.add(opt.value);
            values.push(opt.value);
          }
        }
      }
      return { id: question.id, kind: 'multiselect', value: values };
    }

    case 'text': {
      const line = await readOneLine(question.id, stdin, timeoutMs);
      if (line === '') {
        return { id: question.id, kind: 'text', value: question.default ?? '' };
      }
      return { id: question.id, kind: 'text', value: line };
    }

    case 'confirm': {
      const line = await readOneLine(question.id, stdin, timeoutMs);
      if (line === '') {
        return { id: question.id, kind: 'confirm', value: question.default ?? false };
      }
      const lower = line.toLowerCase();
      if (lower === 'y' || lower === 'yes') {
        return { id: question.id, kind: 'confirm', value: true };
      }
      if (lower === 'n' || lower === 'no') {
        return { id: question.id, kind: 'confirm', value: false };
      }
      // Unrecognised input → use default (lenient)
      return { id: question.id, kind: 'confirm', value: question.default ?? false };
    }
  }
}
