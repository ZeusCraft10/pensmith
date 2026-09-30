// tests/tier-contract/status-fields.test.ts — RUN-19 tier parity.
//
// `pensmith status` (Tier 2, the built CLI) and the `paper://state` resource
// (Tier 1, the built MCP server) expose the same status fields for the same
// paper: title, class, current section and step, per-section glyph + status,
// the cost meter and the next action. The cost line is the same in both tiers
// (review round 2): in this release the plugin's pensmith_plan / pensmith_write
// bill the provider configured for pensmith, so Tier 1 meters COSTS.jsonl like
// the CLI (it used to print `cost: n/a (Claude session)`). Both views come from
// bin/lib/status-view.ts; a divergence is a shipped-code bug in one tier, never
// something to normalize here.
//
// PLUG-03 / D-23a-12: the Tier-1 `pensmith_status` tool returns exactly the text
// `pensmith status` prints (the same verb under a capturing output sink), so
// the second and third cases compare it byte for byte with the CLI's stdout.
//
// Spawns dist/ — run `npm run build` first.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { withLlmSandbox } from '../helpers/llm-sandbox.js';
import { seedThreeSectionPaper } from '../helpers/status-fixture.js';
import { pensmithActivePointerPath } from '../../bin/lib/paths.js';

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
    // The cost meter: both tiers meter the last (or running) session + the
    // paper total — the fixture's $1.23 was spent by an earlier session.
    assert.ok(cliLines.includes('cost: $1.23 last session / $1.23 total (cap $5.00)'), cli.stdout);
    assert.ok(cliLines.includes(status.cost.line), `paper://state's cost line is the CLI's: ${status.cost.line}`);
  });
});

// ---------------------------------------------------------------------------
// PLUG-03 / D-23a-12: the Tier-1 status tool. `pensmith_status` runs the same
// status verb under a capturing output sink, so its text is byte-identical to
// the CLI's stdout for the same paper — in either glyph set — and, like every
// MCP surface, it addresses the server's paper, never the `pensmith open`
// pointer (D-17-33).
// ---------------------------------------------------------------------------

interface ToolText {
  isError: boolean;
  texts: string[];
}

/** Call pensmith_status on a built server started in `cwd` with `env`. */
async function callStatusTool(env: Record<string, string>, cwd: string): Promise<ToolText> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_BIN], env, cwd, stderr: 'pipe' });
  const client = new Client({ name: 'tier-contract-status-tool', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: 'pensmith_status', arguments: {} });
    return { isError: res.isError === true, texts: (res.content as Array<{ text: string }>).map((c) => c.text) };
  } finally {
    await client.close();
  }
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}

test('PLUG-03 / D-23a-12: the pensmith_status tool text equals `pensmith status` stdout for the same paper (both glyph sets)', async () => {
  await withLlmSandbox({}, async (sb) => {
    await seedThreeSectionPaper(sb.root);
    for (const LANG of ['en_US.UTF-8', 'C']) {
      const env = stringEnv(sb.spawnEnv({ LANG, LC_ALL: undefined, LC_CTYPE: undefined, PENSMITH_PAPER_ROOT: undefined }));
      const cli = spawnSync(process.execPath, [CLI_BIN, 'status'], { cwd: sb.root, env, encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr);
      const tool = await callStatusTool({ ...env, PENSMITH_PAPER_ROOT: sb.root }, sb.root);
      assert.equal(tool.isError, false, tool.texts.join('\n'));
      assert.deepEqual(tool.texts, [cli.stdout], `LANG=${LANG}: the tool returns exactly the CLI stdout`);
      assert.match(cli.stdout, LANG === 'C' ? /\n {4}\[x\] #1 intro: verified\n/ : /\n {4}✓ §1 intro: verified\n/, cli.stdout);
      assert.ok(cli.stdout.includes('cost: $1.23 last session / $1.23 total (cap $5.00)'), 'the tool shows the CLI cost meter, not the n/a of paper://state');
    }
  });
});

test('D-17-33: pensmith_status addresses the server\'s paper — never the `pensmith open` pointer the CLI follows', async () => {
  await withLlmSandbox({}, async (sb) => {
    await seedThreeSectionPaper(sb.root);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-status-elsewhere-'));
    try {
      const env = stringEnv(sb.spawnEnv({ LANG: 'en_US.UTF-8', LC_ALL: undefined, LC_CTYPE: undefined, PENSMITH_PAPER_ROOT: undefined }));
      // The pointer `pensmith open` writes (bin/cli/open.ts), naming the seeded paper.
      const pointer = pensmithActivePointerPath();
      assert.equal(path.dirname(pointer), sb.pensmithData, 'the sandbox data dir the spawned CLI and server share');
      fs.writeFileSync(pointer, JSON.stringify({ paperId: 'x', folderPath: sb.root, openedAt: new Date().toISOString() }));

      // The CLI's read-only status follows the pointer from a folder with no paper…
      const cli = spawnSync(process.execPath, [CLI_BIN, 'status'], { cwd: elsewhere, env, encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr);
      assert.match(cli.stdout, /paper: Tidal Power and Coastal Ecology/);
      // …the MCP server started there does not: its paper is its working directory.
      const tool = await callStatusTool(env, elsewhere);
      assert.equal(tool.isError, true);
      assert.match(tool.texts[0] ?? '', /^pensmith status: no active paper — run `pensmith new` to start\.\n$/);
      assert.deepEqual(JSON.parse(tool.texts[1] ?? '{}'), { exit_code: 1, classification: 'EXIT_ERROR', message: null });
      assert.ok(fs.existsSync(pointer), 'the pointer is left as it was');
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
