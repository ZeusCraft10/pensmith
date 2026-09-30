// tests/tier-contract/paper-root.test.ts — RUN-13 tier parity (D-17-32): the
// CLI and the MCP server resolve the SAME paper — the project folder that
// contains .paper/ — so paper://state reads the .paper/STATE.json `pensmith`
// wrote, and paper://section/3 on a CLI-created 5-section paper returns that
// section's plan, draft and verification.
//
// Run `npm run build` first — both tiers are the BUILT artifacts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ASSIGNMENT_FIXTURE, MCP_BIN, sandbox, runCli, writeOutline, sectionDirOf } from '../helpers/paper-cli-harness.js';

const SECTIONS = [
  { n: 1, slug: 'introduction' },
  { n: 2, slug: 'background' },
  { n: 3, slug: 'methods' },
  { n: 4, slug: 'results' },
  { n: 5, slug: 'discussion' },
];

test('RUN-13 parity: paper://state and paper://section/3 read the paper the CLI created', async () => {
  const sb = sandbox('parity-paper-root');
  const root = sb.project('paper');
  // Tier 2 builds the paper: new → an approved 5-section outline → plan/write/verify §3.
  assert.equal(runCli(sb, root, ['new', '--yolo', '--from', ASSIGNMENT_FIXTURE]).status, 0);
  writeOutline(root, SECTIONS);
  const outline = runCli(sb, root, ['outline', '--yolo']);
  assert.equal(outline.status, 0, `outline registers the existing table: ${outline.stderr}`);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@article{real2020, title={A Real Paper}, author={Real, Rita}, year={2020}}\n');
  // VRFY-24 (Phase 20): a PENSMITH_NO_LLM draft is stub text (PLACEHOLDER), so
  // write drafts without its chained verify and the section gets the user's
  // own prose before `verify 3` — the paper Tier 1 then reads is a verified one.
  for (const verb of [['plan', '3'], ['write', '3', '--no-verify']]) {
    const r = runCli(sb, root, verb);
    assert.equal(r.status, 0, `${verb.join(' ')}: ${r.stdout}\n${r.stderr}`);
  }
  writeFileSync(join(sectionDirOf(root, 3, 'methods'), 'DRAFT.md'), '# Methods\n\nWe describe the method in plain words, citing nothing in this section.\n');
  const verified = runCli(sb, root, ['verify', '3']);
  assert.equal(verified.status, 0, `verify 3: ${verified.stdout}\n${verified.stderr}`);
  const stateOnDisk = JSON.parse(readFileSync(join(root, '.paper', 'STATE.json'), 'utf8')) as { paperId: string; sections: unknown[] };
  assert.equal(stateOnDisk.sections.length, 5, 'the CLI registered five sections in .paper/STATE.json');

  // Tier 1 reads it — PENSMITH_PAPER_ROOT names the project root.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env: sb.env({ PENSMITH_PAPER_ROOT: root }),
    cwd: sb.base,
  });
  const client = new Client({ name: 'paper-root-parity', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const state = await client.readResource({ uri: 'paper://state' });
    const stateJson = JSON.parse((state.contents[0] as { text: string }).text) as { paperId: string; sections: Array<{ n: number; slug: string }> };
    assert.equal(stateJson.paperId, stateOnDisk.paperId, 'paper://state is the same STATE.json');
    assert.deepEqual(stateJson.sections.map((s) => s.slug), SECTIONS.map((s) => s.slug));

    const sec = await client.readResource({ uri: 'paper://section/3' });
    const payload = JSON.parse((sec.contents[0] as { text: string }).text) as {
      n: number; slug: string; state: string; plan?: string; draft?: string; verification?: string;
    };
    const dir = sectionDirOf(root, 3, 'methods');
    assert.equal(payload.slug, 'methods');
    assert.equal(payload.plan, readFileSync(join(dir, 'PLAN.md'), 'utf8'), 'plan');
    assert.equal(payload.draft, readFileSync(join(dir, 'DRAFT.md'), 'utf8'), 'draft');
    assert.equal(payload.verification, readFileSync(join(dir, 'VERIFICATION.md'), 'utf8'), 'verification');
    assert.equal(payload.state, 'verified', 'the PLAN.md frontmatter status verify wrote');

    // GRND-09 (Phase 18): outline approval gives every section its stub PLAN.md;
    // planning, writing and verifying §3 never touched §4 (section isolation).
    const other = JSON.parse(((await client.readResource({ uri: 'paper://section/4' })).contents[0] as { text: string }).text) as {
      plan?: string; draft?: string; verification?: string; state: string;
    };
    assert.match(other.plan ?? '', /^stub: true$/m, 'section 4 still holds only the outline\'s stub (section isolation)');
    assert.equal(other.state, 'planned');
    assert.equal(other.draft, undefined, 'section 4 was never drafted');
    assert.equal(other.verification, undefined, 'section 4 was never verified');
  } finally {
    await client.close();
  }
});
