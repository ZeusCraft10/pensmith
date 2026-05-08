// Red-team fixture for the D-07 atomic-write chokepoint (Phase 1).
// This file INTENTIONALLY violates the chokepoint by calling fs.writeFile
// and fs.promises.writeFile directly. It is ignored by the project ESLint
// config (eslint.config.js global-ignores) so `npm run lint` over the repo
// passes. The chokepoint regression test at
// tests/lint-atomic-write-chokepoint.test.ts (lands Wave 2) runs ESLint
// programmatically against THIS file and asserts the rule fires.
//
// DO NOT add a real import or run this file. It exists only as a static
// input to the ESLint programmatic API.
//
// @ts-nocheck — this file is never type-checked or executed.

import fs from 'node:fs';
import fsp from 'node:fs/promises';

// === D-07 violation: direct fs.writeFile outside bin/lib/atomic-write.ts ===
fs.writeFile('/tmp/test.json', '{}', () => {});

// === D-07 violation: direct fs.promises.writeFile outside bin/lib/atomic-write.ts ===
await fsp.writeFile('/tmp/test2.json', '{}');

// Reference the bindings so the imports are not tree-shaken.
export const _redTeam = { fs, fsp };
