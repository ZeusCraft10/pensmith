// bin/lib/verify/verify-reply.ts — what the MCP `pensmith_verify` tool returns
// for one section verification (Phase 20 + 23a merge, review round 1; main-branch merge review, round 1).
//
// verifySection's result (bin/cli/verify.ts) is for the in-process callers
// (`write`, compile's staleness re-verify): every gate row with the draft text
// it quotes, Pass-2 evidence quoted from open-access passages, per-pass copies
// of the same rows (its bibliography is already reduced to a path and its
// problems, compactGate). The CLI never prints it, and the tool never sends it:
// its text quotes the paper and its sources, which must reach the model fenced
// as data (FEED-05), and it holds far more than the model needs. The tool
// returns this projection:
//
//   - `summary`: a small JSON object with no text from the paper or from a
//     source — the status, whether the section blocks compile, the
//     VERIFICATION.md path, whether this call wrote it (`recorded`), and the
//     counts of VERIFICATION.md's summary table;
//   - `rows`: the blocking rows as VERIFICATION.md words them (renderGateRow),
//     at most MAX_REPLY_ROWS, each at most MAX_REPLY_ROW_CHARS long, then one
//     line naming how many more VERIFICATION.md lists. They quote the draft
//     and its sources, so the MCP shim hands them to the model inside the
//     FEED-05 fence after a data note, as pensmith_status does (D-23a-12);
//   - `message`: the line verify printed when it stopped before judging the
//     draft (a failed write's refusal, a missing DRAFT.md) — the reason and
//     the step that fixes it, which the CLI user reads on the terminal. It can
//     quote a section's failure_reason, so the shim fences it too, as a
//     verb's words (mcp/tools.ts verbToolResult).
//
// It reads only the rows, Pass 2, Pass 4, the freshness probe and the early
// return's fields of the result, never its bibliography.
//
// PURE: no I/O.

import { blocksCompile } from './verdicts.js';
import { renderGateRow, summaryRows, type SummaryRow } from './verification-md.js';
import type { GateRow } from './gate.js';
import type { FreshnessResult } from './freshness.js';

/** The most blocking rows the reply lists (VERIFICATION.md lists every row). */
export const MAX_REPLY_ROWS = 40;
/** The longest a listed row may be, in characters (a longer one is cut with `…`). */
export const MAX_REPLY_ROW_CHARS = 400;

/** The JSON half of the reply: nothing in it quotes the paper or a source. */
export interface VerifyReplySummary {
  readonly ok: boolean;
  readonly status: string;
  readonly blocked: boolean;
  /** The section's VERIFICATION.md. */
  readonly path: string;
  /**
   * Whether this call wrote that VERIFICATION.md. False when verify refused
   * before judging the draft (a failed write): a VERIFICATION.md there is an
   * earlier verdict, and `message` says why and what to run.
   */
  readonly recorded: boolean;
  /** VERIFICATION.md's summary table: every non-zero (pass, verdict) count. */
  readonly summary: SummaryRow[];
  /** How many rows block compile and export. */
  readonly blocking_rows: number;
}

export interface VerifyReply {
  readonly summary: VerifyReplySummary;
  /** The blocking rows as VERIFICATION.md words them (bounded); untrusted text. */
  readonly rows: string[];
  /** The line verify printed when it stopped before judging the draft; untrusted text. Null when it judged the draft. */
  readonly message: string | null;
}

/** The fields of verifySection's result the projection reads. */
interface VerifyResultLike {
  ok?: unknown;
  status?: unknown;
  blocked?: unknown;
  path?: unknown;
  recorded?: unknown;
  message?: unknown;
  gate?: { rows?: unknown };
  freshness?: unknown;
  pass2?: unknown;
  pass4?: unknown;
}

function isAccepted(row: GateRow): boolean {
  return row.kind === 'pass3' && row.accepted !== undefined;
}

function bounded(line: string): string {
  return line.length <= MAX_REPLY_ROW_CHARS ? line : `${line.slice(0, MAX_REPLY_ROW_CHARS - 1)}…`;
}

/**
 * Project verifySection's result into the MCP reply (see the module header).
 * Null for anything that is not a verify result (a verb that threw returns
 * null, and the tool reports the failure alone).
 */
export function verifyReply(result: unknown): VerifyReply | null {
  if (result === null || typeof result !== 'object') return null;
  const r = result as VerifyResultLike;
  if (typeof r.status !== 'string' || typeof r.path !== 'string') return null;
  const gateRows = r.gate?.rows;
  const rows: GateRow[] = Array.isArray(gateRows) ? (gateRows as GateRow[]) : [];
  const pass2 = Array.isArray(r.pass2) ? (r.pass2 as Array<{ verdict?: unknown }>).map((p) => String(p.verdict)) : null;
  const pass4 = Array.isArray(r.pass4) ? (r.pass4 as Array<{ orphanCount?: unknown }>).reduce((s, p) => s + (typeof p.orphanCount === 'number' ? p.orphanCount : 0), 0) : null;
  const freshness = Array.isArray(r.freshness) ? (r.freshness as FreshnessResult[]) : null;
  const blocking = rows.filter((row) => blocksCompile(row.verdict, isAccepted(row)));
  const listed = blocking.slice(0, MAX_REPLY_ROWS).map((row) => bounded(renderGateRow(row)));
  if (blocking.length > listed.length) {
    listed.push(`… and ${blocking.length - listed.length} more blocking row(s): VERIFICATION.md lists every row.`);
  }
  return {
    summary: {
      ok: r.ok === true,
      status: r.status,
      blocked: r.blocked === true,
      path: r.path,
      recorded: r.recorded !== false,
      summary: summaryRows({ rows, freshness, pass2Verdicts: pass2 !== null && pass2.length > 0 ? pass2 : null, pass4Orphans: pass4 }),
      blocking_rows: blocking.length,
    },
    rows: listed,
    message: typeof r.message === 'string' && r.message.trim() !== '' ? r.message : null,
  };
}
