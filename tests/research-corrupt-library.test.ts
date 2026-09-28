// tests/research-corrupt-library.test.ts — RUN-12: an existing LIBRARY.json
// that cannot be read is an EXPECTED condition, so `pensmith research` reports
// it as one line naming the file and how to recover, and it finds it BEFORE any
// search or model call (0 requests), never after the paid work with an
// internal-error hint.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { EXIT_ERROR } from '../bin/lib/exit-codes.js';

const KEY = 'sk-test-corrupt-library-0001';

test('RUN-12: a corrupt LIBRARY.json is a one-line error naming the file, before any search or model call', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: attention mechanisms\nDiscipline: computer-science\n');
    const file = path.join(sb.paper, 'LIBRARY.json');
    for (const body of ['{"$schemaVersion":2,"entries":[{"citekey":5}]}', '{ not json']) {
      fs.writeFileSync(file, body);
      const r = await sb.runTsx(null, ['research', '--yolo']);
      assert.equal(r.status, EXIT_ERROR, `${r.stdout}\n${r.stderr}`);
      const line = r.stderr.split('\n').find((l) => l.startsWith('pensmith: '));
      assert.ok(line, r.stderr);
      assert.ok(line.includes(file), `the message names ${file}: ${line}`);
      assert.match(line, /is not a valid pensmith library \(.+\) — repair it, or move it aside/);
      assert.doesNotMatch(r.stderr, /PENSMITH_DEBUG/, 'an expected condition carries no internal-error hint');
      assert.equal(fs.readFileSync(file, 'utf8'), body, 'the file is left as it was');
      assert.ok(!fs.existsSync(path.join(sb.paper, 'RESEARCH.md')), 'nothing searched or logged');
    }
    assert.equal(sb.mock!.callCount(), 0, 'no model request');
  });
});

test('RUN-12: `add` against a corrupt LIBRARY.json is the same one actionable line — before any lookup, never a raw JSON error', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'corrupt-add', createdAt: '2026-01-01T00:00:00.000Z', sections: [] }));
    const file = path.join(sb.paper, 'LIBRARY.json');
    fs.writeFileSync(file, 'garbage\n');
    const r = await sb.runTsx(null, ['add', '10.1038/nphys1170']);
    assert.equal(r.status, EXIT_ERROR, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: .*LIBRARY\.json is not a valid pensmith library \(.+\) — repair it, or move it aside/m);
    assert.doesNotMatch(r.stderr, /PENSMITH_DEBUG/, 'no internal-error hint');
    assert.equal(r.stderr.split('\n').filter((l) => l.includes('not a valid pensmith library')).length, 1, 'one line');
    assert.doesNotMatch(r.stderr, /^pensmith: Unexpected token/m, 'never the raw parse error on its own');
    assert.equal(fs.readFileSync(file, 'utf8'), 'garbage\n', 'the file is left as it was');
  });
});
