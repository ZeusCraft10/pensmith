// tests/mcp-tool-handlers.test.ts
//
// TIER-06: each of the 6 MCP tools parses input via zod. Malformed input is rejected.
// Uses InMemoryTransport (faster than stdio); the stdio path is covered
// by 02-07's tier-contract test.
//
// SDK v1.29 behavior (deviation note): The SDK wraps ALL errors (including McpError
// from zod validation failures) in a CallToolResult body with isError:true, rather
// than returning a JSON-RPC error that would cause Client.callTool() to throw.
// See mcp.js lines 138-144 (catch block calls createToolError, not re-throw).
// Tests assert res.isError === true instead of assert.rejects.
//
// The paper_doi_verify valid-input positive test is omitted: it requires a Crossref
// cassette; the live-handshake form is covered in 02-07's tier-contract test.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../mcp/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

async function pair(paperRoot: string) {
  const server = buildServer(paperRoot);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'pensmith-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientT);
  return { client, server };
}

function freshPaperRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tool-test-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  // Minimal STATE.json so loadState doesn't throw StateNotFoundError.
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 1, paperId: 'test-paper', createdAt: new Date().toISOString(), sections: [] }),
  );
  // Minimal LIBRARY.json so loadLibrary doesn't throw.
  writeFileSync(
    join(root, 'LIBRARY.json'),
    JSON.stringify({ $schemaVersion: 1, entries: [] }),
  );
  return root;
}

/**
 * Assert that a callTool response indicates an error.
 * SDK v1.29 returns { isError: true, content: [...] } for validation failures.
 */
function assertToolError(res: Awaited<ReturnType<Client['callTool']>>, msg?: string): void {
  assert.equal(res.isError, true, msg ?? 'expected isError=true for invalid input');
}

// ===== paper_init_section =====
test('TIER-06: paper_init_section accepts valid input', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, slug: 'intro' } });
  assert.ok(Array.isArray(res.content));
  assert.notEqual(res.isError, true, 'valid input should not error');
});

test('TIER-06: paper_init_section rejects missing slug', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1 } });
  assertToolError(res, 'missing slug should return isError=true');
});

test('TIER-06: paper_init_section rejects n=0', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 0, slug: 'intro' } });
  assertToolError(res, 'n=0 should return isError=true (min(1) violated)');
});

// ===== paper_advance_section =====
test('TIER-06: paper_advance_section rejects invalid toState', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'paper_advance_section', arguments: { paperRoot: root, n: 1, toState: 'BOGUS' } });
  assertToolError(res, 'invalid toState should return isError=true');
});

test('TIER-06: paper_advance_section accepts valid state transition', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, slug: 'intro' } });
  const res = await client.callTool({ name: 'paper_advance_section', arguments: { paperRoot: root, n: 1, toState: 'writing' } });
  assert.ok(Array.isArray(res.content));
  assert.notEqual(res.isError, true, 'valid toState should not error');
});

// ===== paper_record_verification =====
test('TIER-06: paper_record_verification rejects malformed verdict', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'paper_record_verification', arguments: { paperRoot: root, n: 1, verdict: 'NOT_A_VERDICT' } });
  assertToolError(res, 'invalid verdict should return isError=true');
});

test('TIER-06: paper_record_verification accepts valid verdict', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, slug: 'intro' } });
  const res = await client.callTool({ name: 'paper_record_verification', arguments: { paperRoot: root, n: 1, verdict: 'PASS' } });
  assert.ok(Array.isArray(res.content));
  assert.notEqual(res.isError, true, 'valid verdict should not error');
});

// ===== paper_set_status =====
test('TIER-06: paper_set_status rejects invalid status', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'paper_set_status', arguments: { paperRoot: root, n: 1, status: 'BOGUS' } });
  assertToolError(res, 'invalid status should return isError=true');
});

test('TIER-06: paper_set_status accepts valid status', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, slug: 'intro' } });
  const res = await client.callTool({ name: 'paper_set_status', arguments: { paperRoot: root, n: 1, status: 'in-progress' } });
  assert.ok(Array.isArray(res.content));
  assert.notEqual(res.isError, true, 'valid status should not error');
});

// ===== paper_doi_verify =====
test('TIER-06: paper_doi_verify rejects empty doi', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'paper_doi_verify', arguments: { doi: '' } });
  assertToolError(res, 'empty doi should return isError=true (min(1) violated)');
});

test('TIER-06: paper_doi_verify rejects missing doi', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'paper_doi_verify', arguments: {} });
  assertToolError(res, 'missing doi should return isError=true');
});

// NOTE: a *valid* paper_doi_verify positive case would require a Crossref cassette;
// 02-07's tier-contract test covers the live-handshake form. Here we only assert
// the zod gate; success path is exercised in 02-07.

// ===== paper_capability_probe =====
test('TIER-06: paper_capability_probe accepts empty args', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'paper_capability_probe', arguments: {} });
  assert.ok(Array.isArray(res.content));
  assert.notEqual(res.isError, true, 'empty args (valid for capability_probe) should not error');
  const payload = JSON.parse((res.content as any)[0].text) as Record<string, unknown>;
  assert.equal(typeof payload.mcp_self, 'boolean');
  assert.equal(typeof payload.contact_email_set, 'boolean');
  assert.ok(Array.isArray(payload.providers));
  // D-12 invariant: no secret values leaked.
  const flat = JSON.stringify(payload);
  assert.equal(/sk-[a-zA-Z0-9]/.test(flat), false, 'no API-key-shaped strings in capability probe output');
});
