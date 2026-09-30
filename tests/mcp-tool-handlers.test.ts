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
// paper_doi_verify's outcomes replay the recorded registrar answers offline.

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

test('GRND-09 (Tier 1): paper_init_section registers a lettered section (§1a); idempotent by slug; a taken id with another slug is an error', async () => {
  const root = freshPaperRoot();
  const { client } = await pair(root);
  const one = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, slug: 'intro' } });
  assert.notEqual(one.isError, true);
  const lettered = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, suffix: 'a', slug: 'background' } });
  assert.notEqual(lettered.isError, true, JSON.stringify(lettered.content));
  const state = await client.readResource({ uri: 'paper://state' });
  const sections = (JSON.parse(String((state.contents[0] as { text: string }).text)) as { sections: Array<{ n: number; suffix?: string; slug: string }> }).sections;
  assert.deepEqual(sections, [{ n: 1, slug: 'intro' }, { n: 1, suffix: 'a', slug: 'background' }]);
  const again = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, suffix: 'a', slug: 'background' } });
  assert.notEqual(again.isError, true, 'idempotent by slug');
  const taken = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, suffix: 'a', slug: 'other' } });
  assertToolError(taken, 'a different slug at a taken id is an error');
  const badLetter = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 1, suffix: 'AB', slug: 'x' } });
  assertToolError(badLetter, 'suffix must be one lowercase letter');
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

// Phase 20 (VRFY-11, D-20-03): the DOI at its registrar, three outcomes —
// replayed offline from the recorded answers (the test runner's sources-offline mode).
test('VRFY-11: paper_doi_verify finds a recorded Crossref DOI and returns its registrar record', async () => {
  const { client } = await pair(freshPaperRoot());
  const res = await client.callTool({ name: 'paper_doi_verify', arguments: { doi: 'https://doi.org/10.1038/NATURE14539' } });
  assert.notEqual(res.isError, true);
  const body = JSON.parse((res.content as Array<{ text: string }>)[0]!.text) as Record<string, any>;
  assert.equal(body.outcome, 'found');
  assert.equal(body.valid, true);
  assert.equal(body.canonical, '10.1038/nature14539');
  assert.equal(body.metadata.title, 'Deep learning');
  assert.equal(body.metadata.source, 'crossref');
});

test('VRFY-11: paper_doi_verify reads a DataCite DOI at DataCite (Crossref has no record of it), never "invalid"', async () => {
  const { client } = await pair(freshPaperRoot());
  const res = await client.callTool({ name: 'paper_doi_verify', arguments: { doi: '10.5281/zenodo.1212303' } });
  const body = JSON.parse((res.content as Array<{ text: string }>)[0]!.text) as Record<string, any>;
  assert.equal(body.outcome, 'found', JSON.stringify(body));
  assert.equal(body.metadata.source, 'datacite');
});

test('D-20-03: paper_doi_verify says `failed` (not invalid, not not-found) when the registrar gives no answer, and `invalid` for a non-DOI', async () => {
  const { client } = await pair(freshPaperRoot());
  const res = await client.callTool({ name: 'paper_doi_verify', arguments: { doi: '10.9999/pensmith-never-recorded-2026' } });
  assert.notEqual(res.isError, true);
  const body = JSON.parse((res.content as Array<{ text: string }>)[0]!.text) as Record<string, any>;
  assert.equal(body.outcome, 'failed', JSON.stringify(body));
  assert.equal(body.valid, false);
  assert.match(body.reason, /offline|check it again online|failed/);
  const bad = await client.callTool({ name: 'paper_doi_verify', arguments: { doi: 'not a doi' } });
  const badBody = JSON.parse((bad.content as Array<{ text: string }>)[0]!.text) as Record<string, any>;
  assert.equal(badBody.outcome, 'invalid');
  assert.equal(badBody.canonical, null);
});

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
