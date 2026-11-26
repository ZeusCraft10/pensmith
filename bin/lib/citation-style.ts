// bin/lib/citation-style.ts — which citation style a paper uses.
//
// The user's choice wins. In order:
//   1. config.toml `[project] citation_style` (set by `pensmith new
//      --citation-style`, or edited by hand as PRD §8 allows);
//   2. a "Citation style: …" answer line in .paper/INTAKE.md;
//   3. the discipline's preset in templates/presets/disciplines.json.
// A choice pensmith has no CSL file for is reported and the preset is used.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeStyleName, resolveStyleName, SUPPORTED_STYLES } from './citations.js';
import { parseIntakeMd } from './intake-parse.js';
import { paperDir } from './paths.js';
import { paperConfigFiles, readProjectConfig } from './project-config.js';

export interface ResolvedStyle {
  /** A style key with a bundled CSL file. */
  style: string;
  /** Where it came from. */
  source: 'config.toml' | 'INTAKE.md' | 'discipline preset';
  /** Set when the user's choice could not be used. */
  warning?: string;
}

/** `[project] citation_style` from the paper's config.toml, if any. */
function configuredStyle(paperRoot: string): string | null {
  // config.toml lives at the project root today; .paper/config.toml is read too.
  // An unreadable config.toml gives no choice; the preset applies.
  for (const file of paperConfigFiles(paperRoot)) {
    const v = readProjectConfig(file)['citation_style'];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** A "Citation style: X" answer line in INTAKE.md. Question lines are ignored. */
export function intakeStyleAnswer(intake: string): string | null {
  const m = /^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?citation[ -]style(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.+?)[ \t]*$/im.exec(intake);
  return m?.[1] ? m[1].replace(/\*\*/g, '').trim() : null;
}

/** The citation style for the paper at `paperRoot`. Never throws. */
export function resolveCitationStyle(paperRoot: string): ResolvedStyle {
  let intake = '';
  try {
    intake = readFileSync(path.join(paperDir(paperRoot), 'INTAKE.md'), 'utf8');
  } catch {
    // no intake yet
  }
  const warnings: string[] = [];
  const choices: Array<[string | null, ResolvedStyle['source']]> = [
    [configuredStyle(paperRoot), 'config.toml'],
    [intakeStyleAnswer(intake), 'INTAKE.md'],
  ];
  for (const [choice, source] of choices) {
    if (!choice) continue;
    const style = normalizeStyleName(choice);
    if (style) return { style, source, ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}) };
    warnings.push(
      `citation style '${choice}' is not supported (from ${source}); supported styles: ${SUPPORTED_STYLES.join(', ')}.`,
    );
  }
  // Only when no usable choice was made is the discipline preset looked up.
  const preset = resolveStyleName(parseIntakeMd(intake).discipline);
  return {
    style: preset,
    source: 'discipline preset',
    ...(warnings.length > 0 ? { warning: `${warnings.join(' ')} Using '${preset}', the discipline default.` } : {}),
  };
}
