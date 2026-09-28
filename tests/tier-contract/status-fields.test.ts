// tests/tier-contract/status-fields.test.ts — RUN-19 tier parity.
//
// `pensmith status` (Tier 2, the built CLI) and the `paper://state` resource
// (Tier 1, the built MCP server) expose the same status fields for the same
// paper: title, class, current section and step, per-section glyph + status,
// and the next action. Only the cost line differs by design (Tier 1 prints
// `cost: n/a (Claude session)` — the user's Claude session does the
// generation). Both views come from bin/lib/status-view.ts; a divergence is a
// shipped-code bug in one tier, never something to normalize here.
//
// Spawns dist/ — run `npm run build` first.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { withLlmSandbox } from '../helpers/llm-sandbox.js';
import { seedThreeSectionPaper } from '../helpers/status-fixture.js';

const CLI_BIN = path.resolve('dist', 'bin', 'pensmith.js');
const MCP_BIN = path.resolve('dist', 'mcp', 'server.js');

interface StatusFields {
  title: string;
  class: string;
  currentLine: string;
  sections: Array<{ glyph: string; n: number; slug: string; status: string }>;
  cost: { line: string };
  nextLine: string;
}

test('RUN-19: CLI `status` and paper://state expose the same status fields', async () => {
  await withLlmSandbox({}, async (sb) => {
    await seedThreeSectionPaper(sb.root);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(sb.spawnEnv({ LANG: 'en_US.UTF-8', LC_ALL: undefined, LC_CTYPE: undefined }))) {
      if (v !== undefined) env[k] = v;
    }

    const cli = spawnSync(process.execPath, [CLI_BIN, 'status'], { cwd: sb.root, env, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const cliLines = cli.stdout.split('\n').map((l) => l.trim());

    const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_BIN], env: { ...env, PENSMITH_PAPER_ROOT: sb.root }, cwd: sb.root });
    const client = new Client({ name: 'tier-contract-status-fields', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    let status: StatusFields;
    try {
      const res = await client.readResource({ uri: 'paper://state' });
      const first = res.contents[0] as { text?: string };
      status = (JSON.parse(first.text ?? '{}') as { status: StatusFields }).status;
    } finally {
      await client.close();
    }

    assert.ok(status, 'paper://state carries the status view');
    assert.ok(cliLines.some((l) => l.startsWith(`paper: ${status.title} `) && l.endsWith(`— class ${status.class}`)), `title/class:\n${cli.stdout}`);
    assert.equal(status.title, 'Tidal Power and Coastal Ecology');
    assert.ok(cliLines.includes(status.currentLine), status.currentLine);
    assert.equal(status.currentLine, 'current: §2 (write)');
    for (const s of status.sections) {
      assert.ok(cliLines.includes(`${s.glyph} §${s.n} ${s.slug}: ${s.status}`), `section ${s.n}`);
    }
    assert.deepEqual(status.sections.map((s) => s.glyph), ['✓', '⌛', '⌽']);
    assert.ok(cliLines.includes(status.nextLine), status.nextLine);
    assert.equal(status.nextLine, 'next: write §2');
    // The cost meter: Tier 2 meters the last (or running) session + paper
    // total — the fixture's $1.23 was spent by an earlier session; Tier 1 says n/a.
    assert.ok(cliLines.includes('cost: $1.23 last session / $1.23 total (cap $5.00)'), cli.stdout);
    assert.equal(status.cost.line, 'cost: n/a (Claude session)');
  });
});
