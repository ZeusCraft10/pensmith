// bin/lib/citation-style.ts — which citation style a paper uses.
//
// The user's choice wins. In order:
//   1. .paper/config.toml `[project] citation_style` (written by intake from
//      the user's answer, or edited by hand as PRD §8 allows);
//   2. the answer stored in .paper/INTAKE.json, or a "Citation style: …" line
//      in an INTAKE.md an older intake wrote;
//   3. the discipline's preset in templates/presets/disciplines.json.
// A choice pensmith has no CSL file for is reported and the preset is used.

import { normalizeStyleName, resolveStyleName, SUPPORTED_STYLES } from './citations.js';
import { readIntake } from './intake-record.js';
import { readProjectConfig } from './project-config.js';

export interface ResolvedStyle {
  /** A style key with a bundled CSL file. */
  style: string;
  /** Where it came from. */
  source: 'config.toml' | 'INTAKE.json' | 'INTAKE.md' | 'discipline preset';
  /** Set when the user's choice could not be used. */
  warning?: string;
}

/** `[project] citation_style` from .paper/config.toml, if any. An unreadable file gives no choice. */
function configuredStyle(paperRoot: string): string | null {
  const v = readProjectConfig(paperRoot)['citation_style'];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The citation style for the paper at `paperRoot`. Never throws. */
export function resolveCitationStyle(paperRoot: string): ResolvedStyle {
  // The intake's answer: INTAKE.json's, or (for a paper an older intake
  // wrote) INTAKE.md's "Citation style:" line (intake-record.ts readIntake).
  const stored = readIntake(paperRoot);
  const warnings: string[] = [];
  const choices: Array<[string | null, ResolvedStyle['source']]> = [
    [configuredStyle(paperRoot), 'config.toml'],
    [stored?.citation_style ?? null, stored?.intake ? 'INTAKE.json' : 'INTAKE.md'],
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
  const preset = resolveStyleName(stored?.discipline ?? 'other');
  return {
    style: preset,
    source: 'discipline preset',
    ...(warnings.length > 0 ? { warning: `${warnings.join(' ')} Using '${preset}', the discipline default.` } : {}),
  };
}
