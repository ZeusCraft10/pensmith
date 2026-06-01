// Red-team fixture for the D-10 MCP no-network chokepoint (Phase 2).
// This file INTENTIONALLY violates the chokepoint by calling
// net.createServer / http.createServer / tls.createServer / new Server().
// It is ignored by the project ESLint config (eslint.config.js global-ignores)
// so `npm run lint` over the repo passes. The chokepoint regression test at
// tests/lint-mcp-no-network.test.ts runs ESLint programmatically against
// THIS file and asserts the rule fires.
//
// @ts-nocheck — this file is never type-checked or executed.

// imports are intentionally any-shaped to avoid type errors; the file is
// never compiled or executed — only AST-walked.
declare const net: any;
declare const http: any;
declare const https: any;
declare const tls: any;
declare const Server: any;

// === D-10 violation: net.createServer() — non-stdio transport ===
const s1 = net.createServer(() => {});

// === D-10 violation: http.createServer() — non-stdio transport ===
const s2 = http.createServer(() => {});

// === D-10 violation: https.createServer() — non-stdio transport ===
const s3 = https.createServer({}, () => {});

// === D-10 violation: tls.createServer() — non-stdio transport ===
const s4 = tls.createServer({}, () => {});

// === D-10 violation: new Server() — generic server constructor ===
const s5 = new Server();

export const _redTeam = { s1, s2, s3, s4, s5 };
