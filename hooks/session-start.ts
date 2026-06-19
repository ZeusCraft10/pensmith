#!/usr/bin/env node
// hooks/session-start.ts — Phase 7 Plan 07-03 (HOOK-02).
//
// Claude Code SessionStart hook. Reads .paper/HANDOFF.json (the crash-resilient
// pointer document written by hooks/pre-compact.ts) and, when a resumable paper
// exists, emits a SINGLE { systemMessage } JSON frame on stdout so Claude Code
// auto-invokes `pensmith resume` on the session's first turn.
//
// CRITICAL stdout protocol (T-07-01 / Pitfall 1): stdout is the hook-protocol
// channel. It MUST be empty OR exactly one parseable JSON frame. This is the
// ONLY hook permitted to write a non-empty stdout frame. Diagnostics go to
// stderr. The hook NEVER throws and ALWAYS exits 0 — a malformed HANDOFF.json
// must never crash the session (T-07-13).
//
// NEVER console.log here — stdout is reserved for the single JSON frame.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HandoffSchema, type Handoff } from '../bin/lib/schemas/handoff.js';

function readHandoff(paperDir: string): Handoff | null {
  const path = join(paperDir, 'HANDOFF.json');
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const result = HandoffSchema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    // Malformed JSON / read error — never throw; nothing to resume.
    return null;
  }
}

function buildResumeMessage(handoff: Handoff): string {
  const section = handoff.current_section ?? '(none)';
  const states = handoff.section_pointers
    .map((p) => `${p.slug}(${p.state})`)
    .join(', ');
  const sectionsSummary = states.length > 0 ? ` Sections: ${states}.` : '';
  return (
    `Pensmith has an in-progress paper at phase "${handoff.phase}" ` +
    `(section ${section}). ${handoff.next_action}${sectionsSummary} ` +
    `Run \`pensmith resume\` to continue.`
  );
}

function main(): void {
  try {
    const handoff = readHandoff('.paper');
    // Nothing to resume: no handoff, or the paper is already done.
    if (!handoff || handoff.phase === 'done') return;
    const message = buildResumeMessage(handoff);
    process.stdout.write(JSON.stringify({ systemMessage: message }) + '\n');
  } catch (err) {
    // Diagnostics → stderr ONLY. Never corrupt the stdout frame.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[session-start] resume-context skipped: ${msg}\n`);
  }
}

main();
process.exit(0);
