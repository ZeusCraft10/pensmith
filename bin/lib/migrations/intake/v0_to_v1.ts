// bin/lib/migrations/intake/v0_to_v1.ts — INTAKE.md frontmatter v0 → v1
// (GRND-03, CONF-04, S-20; D-18-07).
//
// SEAM FILE (Phase 18 plan, S-A). Every stream copies it byte-identically from
// .planning/phases/18-ground/seams/; no stream edits it during Phase 18.
//
// v0 is every INTAKE.md written before Phase 18: no frontmatter. The Phase 17
// renderer wrote `Topic:` and `Discipline:` lines and a `## Assignment`
// section; older ones held only the clarifier's questions. v1 adds the brief's
// frontmatter. This TEXT transform prepends a frontmatter block holding
// `schema_version: 1`, the topic and the discipline it can recover, and keeps
// every byte of the old document as the body (bin/lib/intake-brief.ts reads
// its `## Assignment` section). The brief's other fields take their defaults.
// A document that already has a frontmatter block only gains the version line.
//
// Self-contained on purpose: it must not import bin/lib/frontmatter.ts (which
// registers it) or bin/lib/intake-parse.ts (which may read the migrated brief).

import { stringify } from 'yaml';
import { setFrontmatterVersionText } from '../loader.js';
import { normalizeDisciplineSlug } from '../../disciplines.js';

const FRONTMATTER_BLOCK_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** `Topic: …` (or a `## Topic` heading's next line), else the assignment's first sentence. */
export function legacyTopic(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    const m = /^topic\s*:\s*(.+)$/i.exec(line);
    if (m && (m[1] ?? '').trim()) return (m[1] ?? '').trim().slice(0, 200);
    if (/^##\s+topic\b/i.test(line)) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const v = (lines[j] ?? '').trim();
        if (v && !v.startsWith('#')) return v.slice(0, 200);
      }
    }
  }
  const assignment = /(?:^|\n)## Assignment[ \t]*\n([\s\S]*?)(?=\n## |$)/.exec(text.replace(/\r\n/g, '\n'))?.[1]?.trim() ?? '';
  const first = assignment.split(/[.!?]/)[0]?.trim() ?? '';
  if (first.length < 3) return '';
  return first
    .replace(/^(write|analy[sz]e|discuss|examine|explore|describe|explain|review|argue)\s+(an?\s+)?/i, '')
    .replace(/^(\d+[- ]word\s+)?(literature review|paper|essay|report|study|analysis)\s+(on|about|regarding|of)\s+/i, '')
    .trim()
    .slice(0, 200);
}

/** `Discipline: …` normalised to a preset slug, else the fallback preset. */
export function legacyDiscipline(text: string): string {
  const m = /^discipline\s*:\s*(.+)$/im.exec(text);
  return normalizeDisciplineSlug(m ? (m[1] ?? '') : '');
}

export function migrate(text: string): string {
  if (FRONTMATTER_BLOCK_RE.test(text)) return setFrontmatterVersionText(text, 1);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const yaml = stringify({ schema_version: 1, topic: legacyTopic(text), discipline: legacyDiscipline(text) }).replace(/\n/g, eol);
  return `---${eol}${yaml}---${eol}${text}`;
}

export default migrate;
