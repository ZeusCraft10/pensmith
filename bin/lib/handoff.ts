// bin/lib/handoff.ts — HANDOFF.json: assembly from the router's decision, the
// bounded atomic write, and the migrating reader (D-17, D-18, ARCH-04; v2:
// PLUG-14, D-23a-16).
//
// The PreCompact hook (bin/lib/hooks/pre-compact.ts) writes `.paper/HANDOFF.json`
// before Claude Code compacts the context; the SessionStart hook and `pensmith
// resume` read it back for a SUMMARY only (the router ignores it, H4). Its
// position fields come from the router's decision for the paper
// (handoffPositionOf): the phase, the section id and the section step.
//
// Writing: bin/lib/atomic-write.ts (the D-07 chokepoint) under the lock.ts
// resource lock on the HANDOFF path — its lock files live in the data dir
// (D-40), never beside HANDOFF.json in `.paper/`, which may be a sync folder.
// The document is bounded at HANDOFF_MAX_BYTES: pointers to verified sections
// are dropped first, then the ones furthest from the current section, so a
// long paper still gets a handoff instead of a failed write.
//
// Reading (loadHandoff, S-20): a v1 file is migrated in memory
// (migrations/handoff/v1_to_v2.ts); a file newer than this build understands
// is ignored and left alone — HANDOFF is a disposable pointer, so a newer one
// never blocks and is never downgraded.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CURRENT_HANDOFF_VERSION,
  HandoffSchema,
  HandoffV1Schema,
  HANDOFF_MAX_BYTES,
  type Handoff,
  type HandoffBreadcrumb,
  type HandoffPhase,
  type HandoffPosition,
  type HandoffSectionPointer,
} from './schemas/handoff.js';
import { migrate as migrateV1ToV2 } from './migrations/handoff/v1_to_v2.js';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { paperDir as paperDirOf } from './paths.js';
import { formatSectionId, sectionIdOf, sectionLabel } from './section-id.js';
import type { RouterDecision } from './router.js';

// Re-export the schema so tests + consumers can import a single module.
export { HandoffSchema, HANDOFF_MAX_BYTES, CURRENT_HANDOFF_VERSION };
export type { Handoff, HandoffBreadcrumb, HandoffSectionPointer };

export const HANDOFF_FILENAME = 'HANDOFF.json';
export const HANDOFF_PATH = `.paper/${HANDOFF_FILENAME}`;

/** How long a HANDOFF write waits for another writer before giving up. */
const WRITE_LOCK_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// The router decision → the v2 position fields.
// ---------------------------------------------------------------------------

export interface HandoffPositionFields {
  phase: HandoffPhase;
  /** The section id as `status` prints it ("2", "1a"), or null. */
  section: string | null;
  position: HandoffPosition | null;
  /** The section's slug, or null. */
  current_section: string | null;
}

function sectionOf(d: { n: number; slug: string; suffix?: string | undefined }): { id: string; slug: string } {
  return { id: formatSectionId(sectionIdOf(d.n, d.suffix)), slug: d.slug };
}

/** Where the paper stands, from the router's decision (D-23a-16). */
export function handoffPositionOf(decision: RouterDecision): HandoffPositionFields {
  switch (decision.verb) {
    case 'new':
      return { phase: 'intake', section: null, position: null, current_section: null };
    case 'research':
    case 'outline':
    case 'compile':
      return { phase: decision.verb, section: null, position: null, current_section: null };
    case 'plan':
    case 'write':
    case 'verify': {
      const s = sectionOf(decision);
      return { phase: 'sectioning', section: s.id, position: decision.verb, current_section: s.slug };
    }
    case 'done':
      return { phase: 'export', section: null, position: null, current_section: null };
    case 'status': {
      const s = decision.section ? sectionOf(decision.section) : null;
      return {
        phase: decision.reason === 'done' ? 'done' : 'attention',
        section: s?.id ?? null,
        position: null,
        current_section: s?.slug ?? null,
      };
    }
    default:
      // `resume` is never a router decision (H4); anything else is attention.
      return { phase: 'attention', section: null, position: null, current_section: null };
  }
}

/** A short label for the next step: `plan 2`, `write 1a`, `research`, `status (done)`. */
export function nextStepLabel(decision: RouterDecision): string {
  switch (decision.verb) {
    case 'plan':
    case 'write':
    case 'verify':
      return `${decision.verb} ${formatSectionId(sectionIdOf(decision.n, decision.suffix))}`;
    case 'status':
      return `status (${decision.reason})`;
    default:
      return decision.verb;
  }
}

/** One line: what the next step is and how to take it (≤ 200 chars). */
export function nextActionOf(decision: RouterDecision): string {
  const run = (cmd: string): string => `run /pensmith (or \`pensmith ${cmd}\`)`;
  let text: string;
  switch (decision.verb) {
    case 'new':
      text = `Start the paper from the assignment: ${run('new')}.`;
      break;
    case 'research':
      text = `Find and evaluate sources: ${run('research')}.`;
      break;
    case 'outline':
      text = `Outline the paper and approve it: ${run('outline')}.`;
      break;
    case 'plan':
    case 'write':
    case 'verify': {
      const id = formatSectionId(sectionIdOf(decision.n, decision.suffix));
      const what = { plan: 'Plan', write: 'Draft', verify: 'Verify the citations of' }[decision.verb];
      text = `${what} section ${sectionLabel(sectionIdOf(decision.n, decision.suffix))} (${decision.slug}): ${run(`${decision.verb} ${id}`)}.`;
      break;
    }
    case 'compile':
      text = `Compile the verified sections into DRAFT.md: ${run('compile')}.`;
      break;
    case 'done':
      text = `Export the paper: ${run('done')}.`;
      break;
    case 'status':
      // A `done` with a detail is a mode's own end state (GRND-02 outline-only:
      // OUTLINE_ONLY_DONE), not a finished paper.
      text = decision.reason === 'done'
        ? decision.detail
          ? `Nothing more is routed: ${decision.detail}`
          : 'The paper is complete: .paper/FINAL.md and .paper/export/ hold it (/pensmith status shows it).'
        : `Needs attention: ${decision.detail ?? 'run /pensmith status to see what'}`;
      break;
    default:
      text = 'Run /pensmith status to see where the paper stands.';
  }
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

export interface AssembleInput {
  /** The router's decision for the paper (resolveNextAction). */
  decision: RouterDecision;
  breadcrumbs: readonly HandoffBreadcrumb[];
  sectionPointers: readonly HandoffSectionPointer[];
  /** Defaults to the current time. */
  now?: Date;
}

/** The bytes writeHandoff writes for `h` (pretty-printed, trailing newline). */
function serializedSize(h: unknown): number {
  return Buffer.byteLength(JSON.stringify(h, null, 2), 'utf8') + 1;
}

/**
 * Fit the pointers into the byte budget: drop verified sections first, then,
 * one at a time, the pointer at whichever end of the outline is further from
 * the current section.
 */
function fitPointers(base: Omit<Handoff, 'section_pointers'>, pointers: readonly HandoffSectionPointer[]): HandoffSectionPointer[] {
  let kept = [...pointers];
  const fits = (): boolean => serializedSize({ ...base, section_pointers: kept }) <= HANDOFF_MAX_BYTES;
  if (fits()) return kept;
  kept = kept.filter((p) => p.state !== 'verified');
  while (kept.length > 0 && !fits()) {
    const at = kept.findIndex((p) => p.slug === base.current_section);
    if (at < 0 || kept.length - 1 - at >= at) kept.pop();
    else kept.shift();
  }
  return kept;
}

/** Build a schema-valid v2 HANDOFF from the router's decision (never over the byte budget). */
export function assembleHandoff(input: AssembleInput): Handoff {
  const pos = handoffPositionOf(input.decision);
  const base: Omit<Handoff, 'section_pointers'> = {
    schema_version: CURRENT_HANDOFF_VERSION,
    last_updated: (input.now ?? new Date()).toISOString(),
    phase: pos.phase,
    section: pos.section,
    position: pos.position,
    current_section: pos.current_section,
    next_action: nextActionOf(input.decision),
    breadcrumbs: input.breadcrumbs.slice(-5),
  };
  return HandoffSchema.parse({ ...base, section_pointers: fitPointers(base, input.sectionPointers) });
}

// ---------------------------------------------------------------------------
// Writing.
// ---------------------------------------------------------------------------

export async function writeHandoff(
  handoff: Handoff,
  paperDir: string = paperDirOf(),
): Promise<void> {
  HandoffSchema.parse(handoff);
  const content = JSON.stringify(handoff, null, 2) + '\n';
  const size = Buffer.byteLength(content, 'utf8');
  if (size > HANDOFF_MAX_BYTES) {
    throw new Error(
      `HANDOFF serialized size ${size} exceeds ${HANDOFF_MAX_BYTES} bytes (D-17)`,
    );
  }
  const targetPath = path.join(paperDir, HANDOFF_FILENAME);
  await withLock(targetPath, () => atomicWriteFile(targetPath, content), { timeoutMs: WRITE_LOCK_TIMEOUT_MS });
}

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

export type HandoffRead =
  | { kind: 'absent' }
  /** Unreadable, not JSON, or not a valid v1/v2 document. */
  | { kind: 'invalid' }
  /** Written by a newer pensmith: ignored and left in place (never downgraded). */
  | { kind: 'newer'; version: number }
  | { kind: 'ok'; handoff: Handoff; migratedFrom: number | null };

/** Read `<paperDir>/HANDOFF.json`, migrating a v1 file in memory. Never throws. */
export function readHandoff(paperDir: string): HandoffRead {
  const file = path.join(paperDir, HANDOFF_FILENAME);
  if (!existsSync(file)) return { kind: 'absent' };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { kind: 'invalid' };
  }
  const version = raw !== null && typeof raw === 'object' ? (raw as { schema_version?: unknown }).schema_version : undefined;
  if (typeof version === 'number' && Number.isInteger(version) && version > CURRENT_HANDOFF_VERSION) {
    return { kind: 'newer', version };
  }
  if (version === 1) {
    const v1 = HandoffV1Schema.safeParse(raw);
    if (!v1.success) return { kind: 'invalid' };
    const v2 = HandoffSchema.safeParse(migrateV1ToV2(v1.data));
    return v2.success ? { kind: 'ok', handoff: v2.data, migratedFrom: 1 } : { kind: 'invalid' };
  }
  const v2 = HandoffSchema.safeParse(raw);
  return v2.success ? { kind: 'ok', handoff: v2.data, migratedFrom: null } : { kind: 'invalid' };
}

/** The HANDOFF of the paper whose `.paper/` is `paperDir`, as v2, or null (absent, invalid or newer). */
export function loadHandoff(paperDir: string): Handoff | null {
  const r = readHandoff(paperDir);
  return r.kind === 'ok' ? r.handoff : null;
}

/** `phase sectioning, section 2 (write)` — the one-line summary resume and SessionStart print. */
export function describeHandoffPosition(h: Handoff): string {
  if (h.phase === 'sectioning') {
    return `phase sectioning, section ${h.section ?? h.current_section ?? '?'} (${h.position ?? '?'})`;
  }
  const at = h.section !== null ? `, section ${h.section}` : h.current_section !== null ? `, section ${h.current_section}` : '';
  return `phase ${h.phase}${at}`;
}
