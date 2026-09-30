// bin/lib/migrations/handoff/v1_to_v2.ts — HANDOFF.json v1 → v2 (PLUG-14,
// D-23a-16, S-20).
//
// v1's `phase` mixed paper stages with a section's steps. v2 splits them:
//   v1 plan | write | verify  → phase 'sectioning', position = that step
//   v1 intake | research | outline | compile | done → the same phase, position null
// `section` (the section id, "2" / "1a") did not exist in v1: it is read from
// the `current_section` pointer's folder name (`sections/02-methods/PLAN.md`
// → "2", `01a-background` → "1a"), else null. Every other field is carried
// over unchanged. Pure: the input is a parsed v1 document (HandoffV1Schema),
// and the caller validates the result against the v2 schema. HANDOFF is a
// disposable pointer file, so the migration runs in memory only (loadHandoff
// never writes the upgraded file back).

import type { Handoff, HandoffV1 } from '../../schemas/handoff.js';

const SECTION_STEPS: ReadonlySet<string> = new Set(['plan', 'write', 'verify']);

/** `02-methods` → "2", `01a-background` → "1a" (the folder of a section's PLAN.md). */
function sectionIdFromPlanPath(planPath: string): string | null {
  const parts = planPath.split(/[\\/]/).filter(Boolean);
  const folder = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const m = /^(\d{1,2})([a-z])?-/.exec(folder ?? '');
  if (!m) return null;
  return `${Number(m[1])}${m[2] ?? ''}`;
}

export function migrate(v1: HandoffV1): Handoff {
  const pointer = v1.current_section === null
    ? undefined
    : v1.section_pointers.find((p) => p.slug === v1.current_section);
  const section = pointer ? sectionIdFromPlanPath(pointer.plan_path) : null;
  const step = SECTION_STEPS.has(v1.phase) ? (v1.phase as 'plan' | 'write' | 'verify') : null;
  return {
    schema_version: 2,
    last_updated: v1.last_updated,
    phase: step !== null ? 'sectioning' : (v1.phase as Exclude<HandoffV1['phase'], 'plan' | 'write' | 'verify'>),
    section,
    position: step,
    current_section: v1.current_section,
    next_action: v1.next_action,
    breadcrumbs: v1.breadcrumbs,
    section_pointers: v1.section_pointers,
  };
}

export default migrate;
