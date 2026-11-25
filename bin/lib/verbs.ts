// bin/lib/verbs.ts
//
// WR-03: single source of truth for the UX-02 16-verb list. Imported by:
//   - bin/pensmith.ts                (citty subCommands keys)
//   - scripts/verb-table.ts          (the README command table, one row per verb)
//   - tests/cli-verbs.test.ts        (assertion against runtime introspection)
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
