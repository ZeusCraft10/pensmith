// bin/lib/verbs.ts
//
// WR-03: single source of truth for the UX-02 16-verb list. Imported by:
//   - bin/pensmith.ts                (citty subCommands keys)
//   - tests/cli-verbs.test.ts        (assertion against runtime introspection)
//
// scripts/validate-plugin-manifest.cjs (CommonJS, runs before tsc) reads
// the same list via bin/lib/verbs.json generated at prebuild time by
// scripts/prebuild.mjs. Both consumers stay in lock-step because they share
// this source.
//
// REQUIREMENTS.md UX-02 line 61 is the spec — keep this list in step with
// REQUIREMENTS.md and the workflows/*.md filenames.

export const UX02_VERBS = [
  'doctor',
  'new',
  'next',
  'status',
  'research',
  'outline',
  'plan',
  'write',
  'verify',
  'compile',
  'done',
  'resume',
  'list',
  'open',
  'sketch',
  'add',
] as const;

export type Ux02Verb = (typeof UX02_VERBS)[number];

/**
 * Verb aliases (RUN-11, D-17-35): alias → canonical verb. EMPTY in Phase 17;
 * EXP-21 fills it. An alias dispatches exactly like its verb and is never a
 * 17th verb (the 16-verb list above stays the only verb set). Kept a plain
 * record so a test can register an alias and observe the dispatch.
 */
export const VERB_ALIASES: Record<string, Ux02Verb> = {};

/** True if `token` is one of the 16 verbs. */
export function isVerb(token: string): token is Ux02Verb {
  return (UX02_VERBS as readonly string[]).includes(token);
}

/** The canonical verb for a verb or alias token, or null for anything else. */
export function canonicalVerb(token: string): Ux02Verb | null {
  if (isVerb(token)) return token;
  const alias = Object.prototype.hasOwnProperty.call(VERB_ALIASES, token) ? VERB_ALIASES[token] : undefined;
  return alias !== undefined && isVerb(alias) ? alias : null;
}

/** Levenshtein edit distance (small inputs: verbs, aliases and flag names). */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/**
 * The nearest candidate within edit distance 2 (ties: the first in list
 * order), or null. Used for `unknown command 'stauts'` → `did you mean
 * 'status'` and for unknown flags.
 */
export function nearest(token: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestD = 3;
  for (const c of candidates) {
    const d = editDistance(token, c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
