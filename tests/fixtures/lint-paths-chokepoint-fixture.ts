// Red-team fixture for the D-41 paths chokepoint (Phase 1).
// This file INTENTIONALLY violates the chokepoint by calling os.homedir()
// and reading process.env.LOCALAPPDATA / process.env.XDG_DATA_HOME directly.
// It is ignored by the project ESLint config (eslint.config.js global-ignores)
// so `npm run lint` over the repo passes. The chokepoint regression test at
// tests/lint-paths-chokepoint.test.ts (lands Wave 1) runs ESLint
// programmatically against THIS file and asserts the rule fires.
//
// @ts-nocheck — this file is never type-checked or executed.

import os from 'node:os';

// === D-41 violation: direct os.homedir() outside bin/lib/paths.ts ===
const home = os.homedir();

// === D-41 violation: direct process.env.LOCALAPPDATA outside bin/lib/paths.ts ===
const localAppData = process.env.LOCALAPPDATA;

// === D-41 violation: direct process.env.XDG_DATA_HOME outside bin/lib/paths.ts ===
const xdgData = process.env.XDG_DATA_HOME;

// === D-41 violation: direct process.env.APPDATA outside bin/lib/paths.ts ===
// (also enforces "use LOCALAPPDATA not APPDATA" — Pitfall 4)
const roamingAppData = process.env.APPDATA;

export const _redTeam = { home, localAppData, xdgData, roamingAppData };
