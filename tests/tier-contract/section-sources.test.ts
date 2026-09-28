// tests/tier-contract/section-sources.test.ts — D-18-32 tier parity for a
// section's sources (FEED-04, GRND-09): on a paper the CLI made, the MCP
// server's paper://section/2 and paper://section/1a expose exactly the
// `assigned_sources` the CLI wrote into that section's PLAN.md — for the
// outline's stub and again after `plan` — and a lettered section id resolves in
// both tiers to the same folder (01a-<slug>/).
//
// Run `npm run build` first — both tiers are the BUILT artifacts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ASSIGNMENT_FIXTURE, MCP_BIN, sandbox, runCli } from '../helpers/paper-cli-harness.js';
import { writeLibrary } from '../helpers/section-fixture.js';
import { loadFrontmatterDocSync } from '../../bin/lib/frontmatter.js';

interface SectionPayload {
  n: number;
  id: string;
  suffix?: string;
  slug: string;
  state: string;
  plan?: string;
  assigned_sources: string[];
}

/** The canonical 8-column OUTLINE.md with an inserted §1a (the ids a re-outline gives). */
const OUTLINE = [
  '# Attention in Transformers',
  '',
  'Thesis: Self-attention displaced recurrence because it models long-range dependencies in parallel.',
  '',
  '| # | slug | title | role | depends_on | word target | assigned_sources | voice |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 1 | introduction | Introduction | intro |  | 300 | vaswani2017 |  |',
  '| 1a | methods | Methods | body | introduction | 400 | luong2015 | plain, expository |',
  '| 2 | background | Background | body | introduction | 500 | bahdanau2015, luong2015 |  |',
  '| 3 | conclusion | Conclusion | conclusion | background | 300 | devlin2019 |  |',
  '',
].join('\n');

function planSources(root: string, folder: string): string[] {
  const doc = loadFrontmatterDocSync('plan', join(root, '.paper', 'sections', folder, 'PLAN.md'));
  return doc.frontmatter['assigned_sources'] as string[];
}

test('D-18-32 parity: paper://section/2 and paper://section/1a expose the PLAN.md assigned_sources the CLI wrote', async () => {
  const sb = sandbox('parity-section-sources');
  const root = sb.project('paper');
  assert.equal(runCli(sb, root, ['new', '--yolo', '--from', ASSIGNMENT_FIXTURE]).status, 0);
  writeLibrary(root);
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), OUTLINE);
  const outline = runCli(sb, root, ['outline', '--yolo']);
  assert.equal(outline.status, 0, `outline registers the existing table: ${outline.stderr}`);
  assert.match(outline.stdout, /registered 4 section\(s\) in STATE\.json, wrote 4 stub PLAN\.md/);
  assert.ok(existsSync(join(root, '.paper', 'sections', '01a-methods', 'PLAN.md')), 'the lettered section has its own folder');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env: sb.env({ PENSMITH_PAPER_ROOT: root }),
    cwd: sb.base,
  });
  const client = new Client({ name: 'section-sources-parity', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const read = async (id: string): Promise<SectionPayload> =>
    JSON.parse(((await client.readResource({ uri: `paper://section/${id}` })).contents[0] as { text: string }).text) as SectionPayload;
  try {
    // The outline's stubs: the allocation the CLI wrote.
    let two = await read('2');
    let oneA = await read('1a');
    assert.deepEqual(two.assigned_sources, planSources(root, '02-background'));
    assert.deepEqual(two.assigned_sources, ['bahdanau2015', 'luong2015'], 'the OUTLINE row allocation');
    assert.deepEqual(oneA.assigned_sources, planSources(root, '01a-methods'));
    assert.deepEqual(oneA.assigned_sources, ['luong2015']);
    assert.equal(oneA.id, '1a');
    assert.equal(oneA.suffix, 'a');
    assert.equal(oneA.slug, 'methods');
    assert.equal(oneA.plan, readFileSync(join(root, '.paper', 'sections', '01a-methods', 'PLAN.md'), 'utf8'));
    assert.match(oneA.plan ?? '', /^stub: true$/m);

    // The CLI plans both sections (the section ids are the same in both tiers).
    for (const id of ['2', '1a']) {
      const r = runCli(sb, root, ['plan', id]);
      assert.equal(r.status, 0, `plan ${id}: ${r.stdout}\n${r.stderr}`);
    }
    two = await read('2');
    oneA = await read('1a');
    assert.deepEqual(two.assigned_sources, planSources(root, '02-background'), 'paper://section/2 = PLAN.md after plan');
    assert.deepEqual(oneA.assigned_sources, planSources(root, '01a-methods'), 'paper://section/1a = PLAN.md after plan');
    assert.deepEqual(two.assigned_sources, ['bahdanau2015', 'luong2015'], 'FEED-04: planned within the outline allocation');
    assert.deepEqual(oneA.assigned_sources, ['luong2015']);
    assert.doesNotMatch(oneA.plan ?? '', /^stub: true$/m, 'the stub became a planned PLAN.md');
    assert.equal(oneA.state, 'planned');

    // §1 was never planned: its stub is untouched and still exposes its own allocation.
    const one = await read('1');
    assert.deepEqual(one.assigned_sources, ['vaswani2017']);
    assert.match(one.plan ?? '', /^stub: true$/m);
  } finally {
    await client.close();
  }
});
