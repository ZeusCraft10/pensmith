// Red-team fixture for the D-09 thin-shim chokepoint (Phase 2).
// This file INTENTIONALLY violates the chokepoint by:
//   (a) importing 'node:fs' at the top (no fs imports allowed in mcp/**)
//   (b) calling `server.registerTool(...)` with a 31-statement handler body
//   (c) calling `server.registerResource(...)` that uses the top-level fs import
// It is ignored by the project ESLint config (eslint.config.js global-ignores)
// so `npm run lint` over the repo passes. The chokepoint regression test at
// tests/lint-thin-shim.test.ts runs ESLint programmatically against THIS
// file and asserts the rule fires.
//
// The live D-09 no-restricted-imports rule (scoped to mcp/**/*.ts) lands in
// Task 2 of this plan (02-01). The AST-walk statement-count gate (Test 3 in
// lint-thin-shim.test.ts) walks this file's CallExpression handler bodies.
//
// @ts-nocheck — this file is never type-checked or executed.

import fs from 'node:fs';                            // === D-09 violation (a): fs import in mcp-style file ===

// Declare a fake McpServer-like shape for the fixture.
declare const server: {
  registerTool: (name: string, schema: unknown, handler: (...args: any[]) => any) => void;
  registerResource: (name: string, uri: string, meta: unknown, handler: (...args: any[]) => any) => void;
};

// === D-09 violation (b): handler with 31 statements (>30-statement budget) ===
server.registerTool('fat-tool', { /* schema */ }, async () => {
  const s1 = 1;
  const s2 = 2;
  const s3 = 3;
  const s4 = 4;
  const s5 = 5;
  const s6 = 6;
  const s7 = 7;
  const s8 = 8;
  const s9 = 9;
  const s10 = 10;
  const s11 = 11;
  const s12 = 12;
  const s13 = 13;
  const s14 = 14;
  const s15 = 15;
  const s16 = 16;
  const s17 = 17;
  const s18 = 18;
  const s19 = 19;
  const s20 = 20;
  const s21 = 21;
  const s22 = 22;
  const s23 = 23;
  const s24 = 24;
  const s25 = 25;
  const s26 = 26;
  const s27 = 27;
  const s28 = 28;
  const s29 = 29;
  const s30 = 30;
  const s31 = 31;                                    // === 31st statement — D-09 violation ===
  return { content: [{ type: 'text', text: String(s1 + s31) }] };
});

// === D-09 violation (c): forbidden fs import used inside an mcp/-style file ===
const usedFs = fs.readFileSync('/dev/null', 'utf-8');

export const _redTeam = { usedFs };
