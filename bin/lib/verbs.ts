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

import { levenshtein } from './fuzzy.js';

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
 * Words users type for a verb under another name. The dispatcher rewrites the
 * alias to its verb before parsing, so the alias takes exactly the verb's
 * arguments and the 16-verb command table stays unchanged.
 */
export const VERB_ALIASES: Readonly<Record<string, Ux02Verb>> = {
  intake: 'new',
  export: 'done',
};

/**
 * Words that look like verbs but are not, with where that work actually lives.
 * They used to fall through to the router, which ran a different step.
 */
const NOT_A_VERB_HINTS: Readonly<Record<string, string>> = {
  revise: 'to repair a flagged citation run `pensmith plan <N> --revise`',
  humanize: 'humanizing runs inside `pensmith done`',
  score: 'the GPTZero score runs inside `pensmith done`',
  'gpt-zero': 'the GPTZero score runs inside `pensmith done`',
  gptzero: 'the GPTZero score runs inside `pensmith done`',
  plagiarism: 'the plagiarism check runs inside `pensmith done`',
};

function isVerb(word: string): word is Ux02Verb {
  return (UX02_VERBS as readonly string[]).includes(word);
}

/** The verb a typed word names, through an alias if needed; null when it names none. */
export function canonicalVerb(word: string): Ux02Verb | null {
  if (isVerb(word)) return word;
  return Object.prototype.hasOwnProperty.call(VERB_ALIASES, word) ? (VERB_ALIASES[word] ?? null) : null;
}

/** Verbs and aliases close enough to `word` to be what the user meant. */
function suggestVerbs(word: string): string[] {
  const lower = word.toLowerCase();
  const names = [...UX02_VERBS, ...Object.keys(VERB_ALIASES)];
  return names
    .map((name) => ({ name, d: levenshtein(lower, name) }))
    .filter(({ name, d }) => d <= 2 && d < Math.max(name.length, lower.length) / 2)
    .sort((x, y) => x.d - y.d || x.name.localeCompare(y.name))
    .map(({ name }) => name);
}

/** The error text for a first word that is not a verb (no trailing newline). */
export function unknownVerbMessage(word: string): string {
  const lines = [`pensmith: unknown command '${word}'.`];
  const hint = Object.prototype.hasOwnProperty.call(NOT_A_VERB_HINTS, word) ? NOT_A_VERB_HINTS[word] : undefined;
  if (hint) {
    lines.push(`  ${hint}.`);
  } else {
    const close = suggestVerbs(word);
    if (close.length > 0) lines.push(`  Did you mean ${close.map((v) => `\`pensmith ${v}\``).join(' or ')}?`);
  }
  const aliases = Object.entries(VERB_ALIASES).map(([alias, verb]) => `${alias} = ${verb}`).join(', ');
  lines.push(`  Commands: ${UX02_VERBS.join(', ')} (aliases: ${aliases}).`);
  lines.push('  Run `pensmith` with no command to take the next step, or `pensmith --help` for usage.');
  return lines.join('\n');
}
