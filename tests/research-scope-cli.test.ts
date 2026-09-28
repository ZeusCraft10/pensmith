// tests/research-scope-cli.test.ts — the research scope choice through the
// REAL CLI (SRC-08, RUN-28; D-19-15): the verb runs from source against the
// in-process RUN-21 mock LLM (scripted topic-disambiguator replies, every
// model request captured) and the recorded source cassettes (the test runner
// is sources-offline, RUN-01).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { EXIT_APPROVAL, EXIT_OK, EXIT_USAGE } from '../bin/lib/exit-codes.js';

const KEY = 'sk-test-research-scope-cli-0001';
const SEARCHABLE = 'attention mechanisms in neural networks'; // recorded by the source cassettes

const AMBIGUOUS = {
  ambiguous: true,
  scopes: [
    { label: 'power-transformers', description: 'Electrical power transformers.', queries: ['power transformer fault', 'winding insulation ageing', 'dissolved gas analysis', 'transformer core loss', 'transformer thermal model'] },
    { label: 'neural-attention', description: 'Attention mechanisms in neural networks.', queries: [SEARCHABLE, 'self attention transformer', 'multi head attention', 'attention heads ablation', 'efficient attention'] },
  ],
};

test('SRC-08 (CLI): an ambiguous topic without a terminal exits 3 with 0 model requests; --scope 2 --yolo --show-prompts searches scope 2', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined, PENSMITH_PROMPT_MODE: undefined } }, async (sb) => {
    writeFileSync(join(sb.paper, 'INTAKE.md'), renderIntakeDocument({ topic: 'transformers', discipline: 'computer-science' }, 'Write about transformers.', []));
    sb.mock!.script('topic-disambiguator', { data: AMBIGUOUS });
    const refused = await sb.runTsx(null, ['research']);
    assert.equal(refused.status, EXIT_APPROVAL, `${refused.stdout}\n${refused.stderr}`);
    assert.equal(sb.mock!.callCount(), 0, 'refused before any model request');
    assert.ok(!existsSync(join(sb.paper, 'RESEARCH.md')));

    const bad = await sb.runTsx(null, ['research', '--scope', '3', '--yolo']);
    assert.equal(bad.status, EXIT_USAGE, `${bad.stdout}\n${bad.stderr}`);
    assert.match(bad.stderr, /^pensmith: --scope 3: 2 scopes were proposed — 1\) power-transformers — Electrical power transformers\.; 2\) neural-attention — Attention mechanisms in neural networks\.$/m);

    sb.mock!.script('topic-disambiguator', { data: AMBIGUOUS });
    const r = await sb.runTsx(null, ['research', '--scope', '2', '--yolo', '--show-prompts']);
    assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^pensmith research: scope "neural-attention" — 5 queries$/m);
    const urls = r.stderr.split('\n').filter((l) => l.startsWith('[show-prompts] GET https://'));
    assert.ok(urls.some((l) => /api\.crossref\.org\/works\?query=attention\+mechanisms\+in\+neural\+networks/.test(l)), urls.join('\n'));
    assert.ok(!urls.some((l) => /power\+transformer|dissolved\+gas/.test(l)), 'scope 1 was never searched');
    const md = readFileSync(join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /^Scope: neural-attention — Attention mechanisms in neural networks\.$/m);
    assert.match(md, new RegExp(`^1\\. ${SEARCHABLE}$`, 'm'));
    const lib = JSON.parse(readFileSync(join(sb.paper, 'LIBRARY.json'), 'utf8')) as { entries: unknown[] };
    assert.ok(lib.entries.length > 0, 'recorded hits reached the library');
  });
});
