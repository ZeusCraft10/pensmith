// Red-team fixture for the chokepoint lint rules (D-08).
// This file INTENTIONALLY violates both chokepoints.
// It is ignored by the project ESLint config (eslint.config.js) so that
// `npm run lint` over the repo passes. The chokepoint regression test at
// tests/lint-chokepoint.test.ts runs ESLint programmatically against THIS
// file with overrideConfigFile:true and asserts both rules fire.
//
// DO NOT add a real import or run this file. It exists only as a static
// input to the ESLint programmatic API.
//
// @ts-nocheck — this file is never type-checked or executed.

// === D-06 violation: HTTP import outside bin/lib/http.ts ===
import { fetch } from 'undici';

// === D-07 violation: /^10\./ regex outside bin/lib/doi.ts ===
const doiPrefixRegex = /^10\./;

// Reference the bindings so the imports are not tree-shaken away by some
// future linter doing dead-code elimination before rule evaluation.
export const _redTeam = { fetch, doiPrefixRegex };
