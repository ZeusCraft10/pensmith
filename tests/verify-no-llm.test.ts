// tests/verify-no-llm.test.ts — review round 2 (D-V1-04, RUN-09, VRFY-07):
//   - with no model configured, `pensmith verify` (Tier 2) and the MCP
//     `pensmith_verify` tool (Tier 1) still record the deterministic Pass-1 /
//     Pass-3 verdict; the advisory Pass 2 / Pass 4 are "skipped (no LLM
//     configured)", never a crash;
//   - verify's early exits keep the router moving: a draft with no citations
//     (e.g. an empty library) is verified, so bare `pensmith --yolo` reaches
//     compile; a missing DRAFT.md sends the section back to write; a missing
//     CITATIONS.bib under a draft that cites is a fail-closed `Status: failed`;
//   - any citation shape counts as a citation (the one citation grammar).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EXIT_ERROR, EXIT_OK } from '../bin/lib/exit-codes.js';
import {
  MCP_BIN,
  STACK_LINE,
  sandbox,
  runCli,
  writeState,
  writeOutline,
  writePlan,
  sectionDirOf,
} from './helpers/paper-cli-harness.js';

/** The recorded Crossref work (tests/fixtures/cassettes/crossref/works-nphys1170.json). */
const BIB = '@article{aspelmeyer2009,\n  title = {Measured measurement},\n  author = {Aspelmeyer, Markus},\n  doi = {10.1038/nphys1170},\n  year = {2009}\n}\n';
const NO_KEY = { PENSMITH_NO_LLM: undefined, ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined };

function seedCitingSection(root: string): void {
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  writeOutline(root, [{ n: 1, slug: 'intro', sources: ['aspelmeyer2009'] }]);
  writePlan(root, 1, 'intro', { status: 'written', assigned_sources: '[aspelmeyer2009]' });
  writeFileSync(
    join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'),
    '# Introduction\n\nMeasurement in optomechanics is now routine at the quantum limit [@aspelmeyer2009].\n',
  );
}

function planStatus(root: string): string | undefined {
  return /^status:\s*(\S+)/m.exec(readFileSync(join(sectionDirOf(root, 1, 'intro'), 'PLAN.md'), 'utf8'))?.[1];
}

test('D-V1-04: `pensmith verify 1` with no LLM configured records the deterministic verdict; Pass 2/4 are skipped, not fatal', () => {
  const sb = sandbox('verify-nokey');
  const root = sb.project('p');
  seedCitingSection(root);
  const r = runCli(sb, root, ['verify', '1'], { env: NO_KEY });
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /ANTHROPIC_API_KEY is not set/);
  assert.match(r.stderr, /^pensmith verify: advisory claim-support and orphan checks skipped \(no LLM configured\) — the blocking Pass 1 and Pass 3 verdicts are unaffected\.$/m);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  const v = readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(v, /^Status: verified$/m);
  assert.match(v, /- aspelmeyer2009: \*\*OK\*\*/);
  assert.match(v, /\| aspelmeyer2009 \| .* \| \*\*UNCLEAR\*\* \| skipped \(no LLM configured\): no claim-support judgment was made\. \|/);
  assert.equal(planStatus(root), 'verified', 'PLAN.md status persisted');
});

test('D-V1-04: the MCP pensmith_verify tool (Tier 1, no key) is not an error and writes the same verdict', async () => {
  const sb = sandbox('verify-nokey-mcp');
  const root = sb.project('p');
  seedCitingSection(root);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(sb.env({ ...NO_KEY, PENSMITH_PAPER_ROOT: root }))) if (v !== undefined) env[k] = v;
  const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_BIN], env, cwd: root, stderr: 'pipe' });
  const client = new Client({ name: 'verify-nokey', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: 'pensmith_verify', arguments: { n: 1, slug: 'intro', yolo: true } });
    assert.notEqual(res.isError, true, JSON.stringify(res.content));
  } finally {
    await client.close();
  }
  const v = readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(v, /^Status: verified$/m);
  assert.match(v, /skipped \(no LLM configured\)/);
  assert.equal(planStatus(root), 'verified');
});

test('RUN-09: a draft that cites nothing (an empty library) is verified, so bare `pensmith --yolo` moves on to compile', () => {
  const sb = sandbox('verify-empty-lib');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  writeOutline(root, [{ n: 1, slug: 'intro' }]);
  writePlan(root, 1, 'intro', { status: 'written' });
  writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'), '# Introduction\n\nAn uncited overview of the topic.\n');
  const verify = runCli(sb, root, ['--yolo']);
  assert.equal(verify.status, EXIT_OK, `${verify.stdout}\n${verify.stderr}`);
  assert.equal(planStatus(root), 'verified');
  const v = readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(v, /^Status: verified$/m);
  assert.match(v, /Note: DRAFT\.md cites no sources \(\[@citekey\]\) — Pass 1 and Pass 3 had nothing to check\./);
  const compile = runCli(sb, root, ['--yolo']);
  assert.equal(compile.status, EXIT_OK, `${compile.stdout}\n${compile.stderr}`);
  assert.ok(existsSync(join(root, '.paper', 'DRAFT.md')), 'the router reached compile');
});

test('RUN-09: every citation shape against an empty bib is FABRICATED (the one grammar), never "nothing to verify"', () => {
  const sb = sandbox('verify-shapes');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  writeOutline(root, [{ n: 1, slug: 'intro' }]);
  writePlan(root, 1, 'intro', { status: 'written' });
  writeFileSync(
    join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'),
    'Transformers changed NLP [@vaswani2017, p. 3]. Others agree [@ghost:2099; @phantom.2020].\n',
  );
  const r = runCli(sb, root, ['verify', '1']);
  assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
  const v = readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(v, /^Status: failed$/m);
  assert.doesNotMatch(v, /nothing to verify|cites no sources/);
});

test('RUN-09: a missing DRAFT.md sends the section back to write; a missing CITATIONS.bib under a citing draft fails closed', () => {
  const sb = sandbox('verify-early');
  const root = sb.project('p');
  seedCitingSection(root);
  // No CITATIONS.bib: the cited source cannot be checked — Status: failed, exit 1, PLAN untouched.
  rmSync(join(root, '.paper', 'CITATIONS.bib'));
  const noBib = runCli(sb, root, ['verify', '1']);
  assert.equal(noBib.status, EXIT_ERROR, `${noBib.stdout}\n${noBib.stderr}`);
  const v = readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(v, /^Status: failed$/m);
  assert.match(v, /CITATIONS\.bib is missing, so the 1 source\(s\) DRAFT\.md cites cannot be checked — run `pensmith research`/);
  assert.equal(planStatus(root), 'written');

  // No DRAFT.md: the section needs writing again (the router re-drafts it).
  rmSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'));
  const noDraft = runCli(sb, root, ['verify', '1']);
  assert.equal(noDraft.status, EXIT_ERROR, `${noDraft.stdout}\n${noDraft.stderr}`);
  assert.match(noDraft.stdout, /DRAFT\.md missing — .* run `pensmith write 1` first/);
  assert.equal(planStatus(root), 'writing');
});

test('RUN-18: the session cap stops verify\'s advisory passes AFTER the deterministic verdict is written — exit 5, verdict and PLAN status on disk', async () => {
  const { withLlmSandbox } = await import('./helpers/llm-sandbox.js');
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-ant-test-verify-cap' } }, async (sb) => {
    seedCitingSection(sb.root);
    const r = await sb.runTsx(null, ['verify', '1'], { env: { PENSMITH_COST_CAP_USD: '0.0000001' } });
    assert.equal(r.status, 5, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: This call would exceed your cost cap\./m);
    assert.match(r.stdout, /wrote verified VERIFICATION\.md/);
    const v = readFileSync(join(sectionDirOf(sb.root, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
    assert.match(v, /^Status: verified$/m, 'the frozen Pass-1/Pass-3 verdict is written');
    assert.match(v, /\*\*UNCLEAR\*\* \| not run \(This call would exceed your cost cap/);
    assert.match(v, /## Pass-4 \(orphan claims, advisory\)\n\n_\(not run: This call would exceed your cost cap/);
    assert.equal(planStatus(sb.root), 'verified', 'the verdict is persisted before stopping');
    assert.equal(sb.mock!.callCount(), 0, 'no model request was sent');
  });
});
