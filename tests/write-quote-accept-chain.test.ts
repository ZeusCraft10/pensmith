// tests/write-quote-accept-chain.test.ts — review round 3 (D-20-22, VRFY-20):
// the verify that `write N` chains is interactive, so the single-command flow
// (a bare `pensmith` runs `write N` for a section) asks the `quote-accept` gate
// for a quote no source text can check — the question `pensmith verify N`
// asks — instead of leaving the user to a compile refusal naming a power-user
// flag. Without a terminal it is skipped (the section stays unverifiable and
// compile names the remedies).
//
// Built CLI with the RUN-21 mock LLM: the drafter is scripted to quote
// vaswani2017 (a source with an open-access URL, so GRND-14 lets the drafter
// quote it). No contact email is set, so Pass 3 cannot ask Unpaywall for the
// copy: the quote is UNVERIFIABLE-QUOTE. The prompt runs in numbered mode
// (PENSMITH_PROMPT_MODE=numbered) with its answer on stdin.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openChainSandbox, type ChainSandbox } from './helpers/e2e-chain.js';
import { DEFAULT_SOURCES, seedBriefPaper } from './helpers/section-fixture.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';
import { quoteAcceptancesPath, readQuoteAcceptances } from '../bin/lib/quote-acceptance.js';

const sandboxes: ChainSandbox[] = [];
after(async () => {
  for (const sb of sandboxes) await sb.close();
});

const QUOTE = 'the Transformer relies entirely on an attention mechanism to draw global dependencies';

async function writtenSection(prefix: string): Promise<{ sb: ChainSandbox; dir: string }> {
  const sb = await openChainSandbox({ prefix });
  sandboxes.push(sb);
  await seedBriefPaper(sb.root, {}, { sources: DEFAULT_SOURCES });
  assert.equal((await sb.run(['outline', '--yolo'])).status, 0);
  const sectionsDir = join(sb.root, '.paper', 'sections');
  const [s1] = readdirSync(sectionsDir).filter((d) => d !== '_archive').sort();
  assert.ok(s1);
  const planned = await sb.run(['plan', '1', '--yolo']);
  assert.equal(planned.status, 0, planned.stderr);
  const dir = join(sectionsDir, s1);
  const assigned = loadFrontmatterDocSync('plan', join(dir, 'PLAN.md')).frontmatter['assigned_sources'] as string[];
  assert.ok(assigned.includes('vaswani2017'), `§1 is assigned vaswani2017: ${assigned.join(', ')}`);
  const draft = { text: `# Introduction\n\nAs @vaswani2017 put it, "${QUOTE}" [p. 2].\n\nAttention also aligns source and target words [@vaswani2017].\n` };
  sb.mock.script('section-drafter', draft);
  return { sb, dir };
}

test('D-20-22 (built CLI, review round 3): `write N` in a terminal asks the quote-accept gate for its UNVERIFIABLE-QUOTE quote and records the answer', async () => {
  const { sb, dir } = await writtenSection('write-quote-accept');
  const r = await sb.run(['write', '1'], { env: { PENSMITH_PROMPT_MODE: 'numbered', PENSMITH_CONTACT_EMAIL: undefined }, input: '1\n' });
  assert.match(r.stdout, /pensmith verify: section 1 has 1 quote\(s\) no source text could be checked against \(UNVERIFIABLE-QUOTE\)/, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /pensmith verify: accepted q1 for section 1 \(recorded in QUOTE-ACCEPTANCES\.json\)/);
  assert.deepEqual(readQuoteAcceptances(dir).map((a) => [a.quote_id, a.citekey, a.via]), [['q1', 'vaswani2017', 'prompt']]);
  assert.match(readFileSync(join(dir, 'VERIFICATION.md'), 'utf8'), /^- vaswani2017 \[q1\] .*\*\*UNVERIFIABLE-QUOTE\*\* — .* — accepted by you \S+ \(at the prompt\)$/m);
});

test('D-20-22 (built CLI, review round 3): without a terminal the chained verify asks nothing — the quote stays unverifiable and nothing is recorded', async () => {
  const { sb, dir } = await writtenSection('write-quote-noprompt');
  const r = await sb.run(['write', '1'], { env: { PENSMITH_CONTACT_EMAIL: undefined } });
  assert.doesNotMatch(r.stdout, /no source text could be checked against/, r.stdout);
  assert.ok(!existsSync(quoteAcceptancesPath(dir)), 'nothing recorded');
  assert.match(readFileSync(join(dir, 'VERIFICATION.md'), 'utf8'), /^- vaswani2017 \[q1\] .*\*\*UNVERIFIABLE-QUOTE\*\*/m);
});
