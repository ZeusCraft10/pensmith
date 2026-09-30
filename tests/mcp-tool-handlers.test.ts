// tests/mcp-tool-handlers.test.ts
//
// TIER-06: each MCP tool parses input via zod. Malformed input is rejected.
// PLUG-03 / PLUG-13: pensmith_status returns the CLI's status text, captured
// per call through bin/lib/output-sink.ts (11 tools; the counts are asserted
// in mcp-server-thin-shim and tier-contract/preflight).
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
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildServer } from '../mcp/server.js';
import { STATUS_DATA_NOTE } from '../mcp/tools.js';
import { fenceUntrusted, unfence } from '../bin/lib/untrusted-fence.js';
import { out, setOutputSink, resetOutputSink } from '../bin/lib/output-sink.js';
import { buildStatusView, renderStatusView } from '../bin/lib/status-view.js';
import { routeOptionsFor } from '../bin/cli/route-options.js';
import { seedThreeSectionPaper } from './helpers/status-fixture.js';
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

// ===== pensmith_status (PLUG-03, D-23a-12) =====

/** Every file under `dir` (relative, sorted) — to prove a read-only call wrote nothing. */
function listTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

/** A temp dir removed when the test ends (the in-memory server holds no handle on it). */
function tempRoot(t: { after: (fn: () => void) => void }, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A process-wide sink double installed for `fn` (what the server's stderr sink would receive). */
async function withRecordingSink<T>(fn: (printed: () => string) => Promise<T>): Promise<T> {
  const chunks: string[] = [];
  setOutputSink({ write: (t: string) => chunks.push(t) });
  try {
    return await fn(() => chunks.join(''));
  } finally {
    resetOutputSink();
  }
}

test('PLUG-03: pensmith_status returns exactly the text `pensmith status` prints, captured (never on the process sink), and writes nothing', async (t) => {
  const root = tempRoot(t, 'pensmith-status-tool-');
  await seedThreeSectionPaper(root);
  const { client } = await pair(root);
  const expected = renderStatusView(await buildStatusView(root, { tier: 'cli', ...routeOptionsFor(root) })) + '\n';
  const before = listTree(root);
  await withRecordingSink(async (printed) => {
    const res = await client.callTool({ name: 'pensmith_status', arguments: {} });
    assert.notEqual(res.isError, true);
    const content = res.content as Array<{ type: string; text: string }>;
    assert.equal(content.length, 2, 'two text blocks: the data note, then the fenced status text');
    assert.deepEqual(content.map((c) => c.type), ['text', 'text']);
    assert.equal(content[0]!.text, STATUS_DATA_NOTE);
    assert.equal(content[1]!.text, fenceUntrusted(expected), 'the status text inside the FEED-05 fence');
    const status = unfence(content[1]!.text);
    assert.equal(status, expected, 'byte-identical to the CLI rendering');
    assert.match(status ?? '', /^pensmith status:\n {2}paper: Tidal Power and Coastal Ecology/);
    assert.match(status ?? '', /next: write .2\n$/);
    assert.equal(printed(), '', 'the status text was captured, not written to the process-wide sink');
  });
  assert.deepEqual(listTree(root), before, 'read-only: no file created or removed');
});

test('PLUG-03: pensmith_status on a folder without a paper is an error carrying the CLI text and exit code', async (t) => {
  const root = tempRoot(t, 'pensmith-status-tool-empty-');
  const { client } = await pair(root);
  const res = await client.callTool({ name: 'pensmith_status', arguments: {} });
  assert.equal(res.isError, true);
  const content = res.content as Array<{ type: string; text: string }>;
  assert.equal(content[0]!.text, STATUS_DATA_NOTE);
  assert.match(unfence(content[1]!.text) ?? '', /^pensmith status: no active paper .* run `pensmith new` to start\.\n$/);
  const body = JSON.parse(content[2]!.text) as { exit_code: number; classification: string };
  assert.deepEqual(body, { exit_code: 1, classification: 'EXIT_ERROR', message: null });
  assert.deepEqual(listTree(root), [], 'nothing created in a folder without a paper');
});

test('PLUG-13: parallel pensmith_status calls and other printing never mix (the capture is per call)', async (t) => {
  const root = tempRoot(t, 'pensmith-status-tool-parallel-');
  await seedThreeSectionPaper(root);
  const { client } = await pair(root);
  const expected = renderStatusView(await buildStatusView(root, { tier: 'cli', ...routeOptionsFor(root) })) + '\n';
  await withRecordingSink(async (printed) => {
    // Another call chain printing through the sink while the tool calls run
    // (as a pensmith_plan call's `pensmith plan: …` lines would).
    const noise = (async () => {
      for (let i = 0; i < 20; i += 1) {
        out(`pensmith plan: line ${i}\n`);
        await new Promise((r) => setImmediate(r));
      }
    })();
    const calls = await Promise.all(Array.from({ length: 4 }, () => client.callTool({ name: 'pensmith_status', arguments: {} })));
    await noise;
    for (const res of calls) {
      assert.notEqual(res.isError, true);
      assert.equal(unfence((res.content as Array<{ text: string }>)[1]!.text), expected);
    }
    assert.equal(printed(), Array.from({ length: 20 }, (_, i) => `pensmith plan: line ${i}\n`).join(''), 'the other chain printed on the process sink, in order, and nothing else did');
  });
});
