// tests/research-topic-seed.test.ts — GRND-03: research seeds its queries from
// the STRUCTURED topic in INTAKE.md, never from clarifier text.
//
// `pensmith new --yolo` beside the PRD §15 assignment, then `pensmith research
// --yolo --show-prompts`, against the RUN-21 mock: the topic-disambiguator
// request (and its --show-prompts mirror) carries the brief's topic and the
// assignment, and none of INTAKE.md's Q/A section — no clarifier follow-up
// question, no "Questions and answers", no "assignment topic clarification".
// (The llm stream moves that request to the data-last layout; the request
// still carries the same topic and assignment.)

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { readIntakeBrief } from '../bin/lib/intake-brief.js';
import { parseIntakeMd } from '../bin/lib/intake-parse.js';

const A1 = 'Write a 1500-word literature review on attention mechanisms in transformers, APA style.\n';

test('GRND-03: the research disambiguator request carries the intake topic and never clarifier text', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-topic-seed-0001' }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), A1);
    const made = await sb.runTsx(null, ['new', '--yolo']);
    assert.equal(made.status, 0, `${made.stdout}\n${made.stderr}`);
    const brief = readIntakeBrief(sb.root)!.brief;
    assert.equal(brief.topic, 'attention mechanisms in transformers');
    const followUpQuestions = brief.follow_ups.map((f) => f.question);
    assert.ok(followUpQuestions.length > 0, 'the clarifier suggested a follow-up (recorded in INTAKE.md)');

    // parseIntakeMd (research's reader) returns the structured topic.
    const parsed = parseIntakeMd(fs.readFileSync(path.join(sb.paper, 'INTAKE.md'), 'utf8'));
    assert.equal(parsed.topic, brief.topic);
    assert.equal(parsed.assignment, A1.trim());

    const r = await sb.runTsx(null, ['research', '--yolo', '--show-prompts']);
    assert.ok(r.status !== null, `${r.stdout}\n${r.stderr}`);
    const bodies = sb.mock!.requests.filter((q) => q.slug === 'topic-disambiguator').map((q) => q.rawBody);
    assert.equal(bodies.length, 1, 'one disambiguator request');
    const body = bodies[0]!;
    assert.ok(body.includes('attention mechanisms in transformers'), 'the structured topic seeds the queries');
    assert.ok(body.includes('Write a 1500-word literature review on attention mechanisms in transformers'), 'the assignment is the context');
    for (const q of followUpQuestions) assert.ok(!body.includes(q), `no clarifier follow-up ("${q}")`);
    for (const noise of ['Questions and answers', 'assignment topic clarification', 'suggested default', 'pensmith:assignment:start']) {
      assert.ok(!body.includes(noise), `no INTAKE.md scaffolding ("${noise}")`);
    }
    // --show-prompts mirrors the same request to stderr.
    assert.match(r.stderr, /attention mechanisms in transformers/);
    assert.doesNotMatch(r.stderr, /Who is the intended audience for this paper\?/);
  });
});
