// bin/lib/intake-parse.ts — the research-facing view of INTAKE.md (GRND-03).
//
// INTAKE.md is the paper's structured brief (bin/lib/intake-brief.ts, D-18-07):
// versioned frontmatter (topic, thesis, discipline, paper type, …) plus the
// assignment between markers and a Q/A section. parseIntakeMd is a thin
// wrapper over that brief for the callers that only need topic, discipline and
// assignment (research seeds its queries from the STRUCTURED topic — never
// from clarifier text — status, plan, outline, done):
//
//   - a document with frontmatter → migrated through the CONF-04 loader
//     (frontmatter.ts, kind `intake`) and validated as the brief; the topic
//     and discipline are the brief's, the assignment is the body's assignment
//     block. It round-trips: parseIntakeMd(renderIntakeDocument(b, a, qa))
//     returns b.topic, b.discipline and a.
//   - raw text (a pre-Phase-18 INTAKE.md, or a bare assignment) → the intake
//     v0→v1 migration's legacy heuristics (`Topic:` / `Discipline:` lines,
//     the `## Assignment` section), then the deterministic topic phrase and
//     discipline mention of intake-overrides.ts.
//
// Never throws: a document the brief schema rejects falls back to the raw-text
// heuristics (the readers that must refuse such a file use readIntakeBrief).
// Discipline normalisation is disciplines.ts normalizeDisciplineSlug — this
// module holds no discipline map (GRND-06).

import { migrateFrontmatterText } from './frontmatter.js';
import { assignmentFromBody, parseIntakeFrontmatter, type IntakeBrief } from './intake-brief.js';
import { legacyDiscipline, legacyTopic } from './migrations/intake/v0_to_v1.js';
import { FALLBACK_DISCIPLINE } from './disciplines.js';
import { disciplineMentionFrom, topicFromAssignment } from './intake-overrides.js';

/** The research inputs of an INTAKE.md. */
export interface ParsedIntake {
  /** Short topic phrase (the brief's `topic`). */
  topic: string;
  /** Discipline preset slug (disciplines.ts; the fallback preset when unknown). */
  discipline: string;
  /** The assignment text (the body's assignment block; the whole text for a bare assignment). */
  assignment: string;
  /** The validated brief when the document has frontmatter, else null. */
  brief: IntakeBrief | null;
}

/**
 * Escape `{{` and `}}` sequences in a user-controlled string so they cannot
 * act as template placeholders when the string is passed to interpolate().
 * Kept until the Phase 18 integration pass removes interpolate() (D-18-03):
 * the remaining interpolate() call sites (research.ts, research-orchestrator.ts,
 * outline.ts, plan.ts) share this ONE implementation (CR-01).
 */
export function escapeTemplateTokens(s: string): string {
  return s.replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }');
}

const FRONTMATTER_START = /^﻿?---\r?\n/;

/** A document with frontmatter → the brief's view, or null when it is not a valid brief. */
function fromBrief(text: string): ParsedIntake | null {
  try {
    const doc = migrateFrontmatterText('intake', text.replace(/^﻿/, ''), 'INTAKE.md');
    const parsed = parseIntakeFrontmatter(doc.frontmatter, doc.body, 'INTAKE.md', doc.diskVersion);
    return {
      topic: parsed.brief.topic,
      discipline: parsed.brief.discipline,
      assignment: parsed.assignment,
      brief: parsed.brief,
    };
  } catch {
    return null;
  }
}

/** Raw text → the legacy heuristics (never throws). */
function fromRawText(text: string): ParsedIntake {
  const section = assignmentFromBody(text);
  const assignment = section || text.trim();
  const topic = legacyTopic(text) || topicFromAssignment(assignment) || assignment.replace(/\s+/g, ' ').trim().slice(0, 80);
  const discipline = /^\s*discipline\s*:/im.test(text)
    ? legacyDiscipline(text)
    : (disciplineMentionFrom(text) ?? FALLBACK_DISCIPLINE);
  return { topic, discipline, assignment, brief: null };
}

/**
 * Parse INTAKE.md text into its research inputs (see the module comment).
 * Never throws; empty text yields empty values and the fallback discipline.
 */
export function parseIntakeMd(text: string): ParsedIntake {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { topic: '', discipline: FALLBACK_DISCIPLINE, assignment: '', brief: null };
  }
  try {
    if (FRONTMATTER_START.test(text)) {
      const brief = fromBrief(text);
      if (brief !== null) return brief;
    }
    return fromRawText(text);
  } catch {
    return { topic: text.trim().slice(0, 80), discipline: FALLBACK_DISCIPLINE, assignment: text.trim(), brief: null };
  }
}
