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

/** An alias: the verb it runs and the arguments it stands for (`export` = `done --only export`). */
export interface VerbAlias {
  readonly verb: Ux02Verb;
  readonly args: readonly string[];
}

/**
 * Verb aliases (RUN-11, D-17-35; EXP-21, D-21-23): alias → `{ verb, args }`.
 * The pre-dispatch rewrite (bin/pensmith.ts, expandVerbAlias) turns
 * `pensmith export …` into `pensmith done --only export …` before argv
 * validation, so an alias dispatches exactly like the verb and arguments it
 * names and is never a 17th verb (the 16-verb list above stays the only verb
 * set; no workflow file is added). The four done sub-steps are aliases
 * because the 16 verbs are locked (PRD §5.3, §7.9). Kept a plain record so a
 * test can register an alias and observe the dispatch.
 */
export const VERB_ALIASES: Record<string, VerbAlias> = {
  export: { verb: 'done', args: ['--only', 'export'] },
  humanize: { verb: 'done', args: ['--only', 'humanize'] },
  score: { verb: 'done', args: ['--only', 'score'] },
  plagiarism: { verb: 'done', args: ['--only', 'plagiarism'] },
};

/** True if `token` is one of the 16 verbs. */
export function isVerb(token: string): token is Ux02Verb {
  return (UX02_VERBS as readonly string[]).includes(token);
}

/** The alias `token` names, or null. */
export function verbAlias(token: string): VerbAlias | null {
  const alias = Object.prototype.hasOwnProperty.call(VERB_ALIASES, token) ? VERB_ALIASES[token] : undefined;
  return alias !== undefined && isVerb(alias.verb) ? alias : null;
}

/** The canonical verb for a verb or alias token, or null for anything else. */
export function canonicalVerb(token: string): Ux02Verb | null {
  if (isVerb(token)) return token;
  return verbAlias(token)?.verb ?? null;
}

/**
 * argv with the alias at `at` (the verb position) replaced by its verb and
 * arguments: `['export', '--format', 'docx']` → `['done', '--only', 'export',
 * '--format', 'docx']`. Unchanged when `at` holds no alias. An alias whose
 * arguments the user also gives (`pensmith export --only score`) is
 * ambiguous: `conflict` names the option and the caller refuses it.
 */
export function expandVerbAlias(argv: readonly string[], at: number): { argv: string[]; conflict: string | null } {
  const alias = at >= 0 ? verbAlias(argv[at] ?? '') : null;
  if (alias === null) return { argv: [...argv], conflict: null };
  const options = alias.args.filter((a) => a.startsWith('--'));
  const rest = argv.slice(at + 1);
  const end = rest.indexOf('--');
  const given = end >= 0 ? rest.slice(0, end) : rest;
  const conflict = options.find((o) => given.some((t) => t === o || t.startsWith(`${o}=`))) ?? null;
  return { argv: [...argv.slice(0, at), alias.verb, ...alias.args, ...rest], conflict };
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
