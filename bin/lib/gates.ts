// bin/lib/gates.ts — decisions that wait for a person, kept until answered.
//
// An approval gate with nobody at a terminal to ask (Claude Code's Bash tool,
// CI, a pipe) used to fail after the paid work, discard what it had made, and
// tell the caller to add --yolo. Now the gate is two-phase:
//
//   1. The verb does its work, keeps what the person must decide about in
//      .paper/gates/<id>.json (the proposal, and the hashes of the files it is
//      about), prints one line of JSON — {pending, gate, ref, summary,
//      options, default, how_to_answer, ...} — and exits 3.
//   2. `pensmith gate answer <ref> <option>` records the person's answer and
//      runs the verb again, which applies exactly the kept proposal (checked
//      again against the files as they are then) and removes the record.
//
// Running the verb again before it is answered shows the same decision
// without redoing the work. A record whose files changed since is dropped and
// the work done afresh. Nothing here ever suggests --yolo.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { removePath } from './atomic-write.js';
import { EXIT_NEEDS_ANSWER } from './exit-codes.js';
import { readJsonRecord, writeJsonRecord } from './json-record.js';
import { paperGatesDir } from './paths.js';
import { sha256 } from './verify/verification-record.js';

/** The gates that wait this way, and the verb that owns each. */
export const GATE_VERBS = {
  outline: 'outline',
  'research-scope': 'research',
  'research-candidates': 'research',
  revise: 'plan',
  export: 'done',
} as const;
export type GateName = keyof typeof GATE_VERBS;

const GATE_NAMES = Object.keys(GATE_VERBS) as [GateName, ...GateName[]];

/** One gate's file name: its name, and for a per-section gate the section number. */
const GATE_ID = /^[a-z-]+(?:-\d{1,2})?$/;

export const GateRecordSchema = z.object({
  $schemaVersion: z.literal(1),
  gate: z.enum(GATE_NAMES),
  /** The file name, without `.json`: `outline`, `revise-3`. */
  id: z.string().regex(GATE_ID),
  /** What the person names in `pensmith gate answer`. */
  ref: z.string().regex(/^[a-z-]+(?:-\d{1,2})?-[0-9a-f]{12}$/),
  /** The arguments the owning verb runs with again once answered. */
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  summary: z.string().min(1),
  options: z.array(z.string().min(1)).min(1),
  /** True when the answer may name several options (or `all` / `none`). */
  multiple: z.boolean(),
  default: z.array(z.string()),
  created_at: z.string().min(1),
  /** The hashes of the files the proposal is about; the verb checks them again before applying it. */
  binding: z.record(z.string(), z.string().nullable()),
  /** What the verb kept to apply: its proposal, and what it showed. */
  payload: z.unknown(),
  /** The pending line the verb printed (its name and what it showed), so `gate list` prints the same. */
  shown: z.object({ pending: z.string().min(1), extra: z.record(z.string(), z.unknown()) }).strict(),
  answer: z.object({ options: z.array(z.string()), answered_at: z.string().min(1) }).strict().optional(),
}).strict();

export type GateRecord = z.infer<typeof GateRecordSchema>;

export interface OpenGate {
  gate: GateName;
  /** A per-section gate's section number. */
  n?: number;
  args?: GateRecord['args'];
  summary: string;
  options: string[];
  multiple?: boolean;
  default: string[];
  binding: GateRecord['binding'];
  payload: unknown;
  /** The pending name and what the decision line shows besides the record's own fields. */
  shown: GateRecord['shown'];
}

function gateFile(paperRoot: string, id: string): string {
  return join(paperGatesDir(paperRoot), `${id}.json`);
}

/** The id of `gate` (for section `n`, when it is per section). */
export function gateId(gate: GateName, n?: number): string {
  return n === undefined ? gate : `${gate}-${n}`;
}

/** Keep a decision for a person to make, replacing any earlier one of the same id. */
export async function openGate(paperRoot: string, spec: OpenGate): Promise<GateRecord> {
  const id = gateId(spec.gate, spec.n);
  const created_at = new Date().toISOString();
  const ref = `${id}-${sha256(JSON.stringify({ id, created_at, binding: spec.binding, payload: spec.payload })).slice(0, 12)}`;
  return writeJsonRecord(gateFile(paperRoot, id), GateRecordSchema, {
    $schemaVersion: 1,
    gate: spec.gate,
    id,
    ref,
    args: spec.args ?? {},
    summary: spec.summary,
    options: spec.options,
    multiple: spec.multiple === true,
    default: spec.default,
    created_at,
    binding: spec.binding,
    payload: spec.payload,
    shown: spec.shown,
  });
}

/** The record at `file`, or null when there is none or it cannot be trusted. Never throws. */
function readGateFile(file: string): GateRecord | null {
  return readJsonRecord(file, GateRecordSchema);
}

/** The decision kept for `gate` (section `n`), or null. Never throws. */
export function readGate(paperRoot: string, gate: GateName, n?: number): GateRecord | null {
  return readGateFile(gateFile(paperRoot, gateId(gate, n)));
}

/** The decision whose ref is `ref` (`<id>-<12 hex>`, in `<id>.json`), or null. Never throws. */
export function readGateByRef(paperRoot: string, ref: string): GateRecord | null {
  const id = ref.replace(/-[0-9a-f]{12}$/, '');
  if (id === ref || !GATE_ID.test(id)) return null;
  const record = readGateFile(gateFile(paperRoot, id));
  return record?.ref === ref ? record : null;
}

/** Every decision kept for the paper, oldest first. Never throws. */
export function listGates(paperRoot: string): GateRecord[] {
  let names: string[];
  try {
    names = readdirSync(paperGatesDir(paperRoot)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return names
    .map((f) => readGateFile(join(paperGatesDir(paperRoot), f)))
    .filter((r): r is GateRecord => r !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Remove the decision kept for `gate` (section `n`), answered or not. */
export async function closeGate(paperRoot: string, gate: GateName, n?: number): Promise<void> {
  await removePath(gateFile(paperRoot, gateId(gate, n)));
}

/** Whether `record` is still about files whose hashes are `now`. */
export function gateStillApplies(record: GateRecord, now: GateRecord['binding']): boolean {
  const keys = new Set([...Object.keys(record.binding), ...Object.keys(now)]);
  return [...keys].every((k) => (record.binding[k] ?? null) === (now[k] ?? null));
}

/** The options `typed` names for `record`, or why it names none it takes. */
export function parseAnswer(record: GateRecord, typed: string): { options: string[] } | { error: string } {
  const words = typed.split(',').map((w) => w.trim()).filter((w) => w.length > 0);
  if (words.length === 0) return { error: 'no option given' };
  if (record.multiple) {
    if (words.length === 1 && words[0] === 'all') return { options: [...record.options] };
    if (words.length === 1 && words[0] === 'none') return { options: [] };
  } else if (words.length > 1) {
    return { error: `this decision takes one option, not ${words.length}` };
  }
  const unknown = words.filter((w) => !record.options.includes(w));
  if (unknown.length > 0) return { error: `not an option here: ${unknown.join(', ')}` };
  return { options: [...new Set(words)] };
}

/** Record `options` as the person's answer to `record`. */
export async function answerGate(paperRoot: string, record: GateRecord, options: string[]): Promise<GateRecord> {
  return writeJsonRecord(gateFile(paperRoot, record.id), GateRecordSchema, { ...record, answer: { options, answered_at: new Date().toISOString() } });
}

/** How the person's answer comes back, for the pending JSON. */
export function howToAnswer(record: GateRecord): string {
  const pick = record.multiple
    ? `<option>[,<option>...] (or \`all\` / \`none\`)`
    : '<option>';
  return `Show this to the user and ask them to choose; then run \`pensmith gate answer ${record.ref} ${pick}\` with their choice. Never choose for them.`;
}

/**
 * The one JSON line a verb prints when it stops for this decision, built from
 * the record: its `shown` carries what the person needs to see to decide (the
 * proposal itself), so `pensmith gate list` prints the same line. `more`
 * adds to it, or replaces what a verb shows as it is now.
 */
export function pendingDecision(record: GateRecord, more: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pending: record.shown.pending,
    gate: record.gate,
    ref: record.ref,
    summary: record.summary,
    options: record.options,
    ...(record.multiple ? { multiple: true } : {}),
    default: record.multiple ? record.default : (record.default[0] ?? null),
    ...record.shown.extra,
    ...more,
    how_to_answer: howToAnswer(record),
  };
}

/**
 * Stop the verb for the person's answer: `note` (one line, saying why) on
 * stderr, the decision line on stdout, exit 3.
 */
export function stopForAnswer(note: string, record: GateRecord, more: Record<string, unknown> = {}): { ok: false; mode: 'pending'; ref: string } {
  process.stderr.write(`${note}\n`);
  process.stdout.write(`${JSON.stringify(pendingDecision(record, more))}\n`);
  process.exitCode = EXIT_NEEDS_ANSWER;
  return { ok: false, mode: 'pending', ref: record.ref };
}
