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
  'revise',   // Phase 4 Plan 04-04 (WRTE-02) — citation-swap section-mutation verb
  'compile',
  'done',
  'resume',
  'list',
  'open',
  'sketch',
  'add',
] as const;

export type Ux02Verb = (typeof UX02_VERBS)[number];
