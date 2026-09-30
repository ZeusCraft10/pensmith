// tests/llm-contracts.test.ts — RUN-25 (D-17-23): structured output.
//
// One zod schema per structured slug (bin/lib/llm-contracts.ts) is the single
// source of truth: the Anthropic output_config.format schema, the OpenAI
// strict response_format schema and the Ollama (non-strict) response_format
// schema are all generated from it. Replies go through ONE tolerant parser
// (bare, fenced, prose-wrapped, trailing commentary, YAML), then exactly one
// corrective retry, then a one-line StructuredOutputError with nothing written.
// OUTLINE.md and PLAN.md are rendered from the validated objects.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { complete } from '../bin/lib/anthropic.js';
import {
  CONTRACTS,
  OutlineSchema,
  candidateValues,
  jsonSchemaForSlug,
  parseStructured,
  toJsonSchema,
  type OutlineContract,
} from '../bin/lib/llm-contracts.js';
import { setRuntimeOverride } from '../bin/lib/runtime.js';
import { parseOutline, renderOutlineMd } from '../bin/lib/outline-parse.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { outlineCommand, OutlineRejectedError } from '../bin/cli/outline.js';
import { planCommand } from '../bin/cli/plan.js';

const KEY = 'sk-test-contracts-0001';
const STRUCTURED = Object.keys(CONTRACTS);

type Run = (ctx: { args: Record<string, unknown> }) => Promise<unknown>;

function call<T>(slug: string, content = 'go'): Promise<{ data?: T; text: string }> {
  return complete<T>({ slug, system: 'sys', messages: [{ role: 'user', content }] });
}

test('RUN-25: every structured slug sends its zod-generated schema to Anthropic, OpenAI (strict) and Ollama', async () => {
  const anthropicBodies = new Map<string, Record<string, unknown>>();
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    for (const slug of STRUCTURED) {
      await call(slug);
      anthropicBodies.set(slug, sb.mock!.bodiesFor(slug)[0]!);
    }
  });
  const openaiBodies = new Map<string, Record<string, unknown>>();
  await withLlmSandbox({ mock: 'openai', env: { OPENAI_API_KEY: KEY } }, async (sb) => {
    for (const slug of STRUCTURED) {
      await call(slug);
      openaiBodies.set(slug, sb.mock!.bodiesFor(slug)[0]!);
    }
  });
  const ollamaBodies = new Map<string, Record<string, unknown>>();
  await withLlmSandbox({ mock: 'ollama' }, async (sb) => {
    setRuntimeOverride({ model: 'qwen2.5' });
    for (const slug of STRUCTURED) {
      await call(slug);
      ollamaBodies.set(slug, sb.mock!.bodiesFor(slug)[0]!);
    }
  });

  for (const slug of STRUCTURED) {
    const a = anthropicBodies.get(slug)!;
    const format = (a['output_config'] as { format: { type: string; schema: unknown } }).format;
    assert.equal(format.type, 'json_schema', `${slug}: anthropic native structured output`);
    assert.deepEqual(format.schema, jsonSchemaForSlug(slug, 'standard'), `${slug}: anthropic schema`);

    const o = openaiBodies.get(slug)!;
    const rf = o['response_format'] as { type: string; json_schema: { strict: boolean; schema: unknown } };
    assert.equal(rf.type, 'json_schema');
    assert.equal(rf.json_schema.strict, true, `${slug}: openai strict`);
    assert.deepEqual(rf.json_schema.schema, jsonSchemaForSlug(slug, 'openai-strict'), `${slug}: openai schema`);

    const l = ollamaBodies.get(slug)!;
    const lrf = l['response_format'] as { type: string; json_schema: { strict?: boolean; schema: unknown } };
    assert.equal(lrf.type, 'json_schema');
    assert.equal(lrf.json_schema.strict, undefined, `${slug}: local servers get the non-strict form`);
    assert.deepEqual(lrf.json_schema.schema, jsonSchemaForSlug(slug, 'standard'), `${slug}: ollama schema`);
  }
});

test('RUN-25: the converter is driven by the zod schema — a changed schema changes every provider form', () => {
  const extended = OutlineSchema.innerType().extend({ audience: z.string(), note: z.string().optional() });
  const standard = toJsonSchema(extended, 'standard') as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  const strict = toJsonSchema(extended, 'openai-strict') as { properties: Record<string, unknown>; required: string[] };
  const base = jsonSchemaForSlug('outline-author', 'standard') as { properties: Record<string, unknown> };
  assert.equal('audience' in base.properties, false);
  assert.deepEqual(standard.properties['audience'], { type: 'string' });
  assert.ok(standard.required.includes('audience'));
  assert.equal(standard.required.includes('note'), false, 'optional fields may be omitted (standard)');
  assert.equal(standard.additionalProperties, false);
  assert.ok(strict.required.includes('note'), 'openai strict requires every property');
  assert.deepEqual(strict.properties['note'], { anyOf: [{ type: 'string' }, { type: 'null' }] }, 'strict optional → nullable');
  // Nested objects are closed too.
  const sections = standard.properties['sections'] as { items: { additionalProperties: boolean; required: string[] } };
  assert.equal(sections.items.additionalProperties, false);
  assert.ok(sections.items.required.includes('assigned_sources'));
});

test('RUN-25: the tolerant parser accepts bare, fenced, prose-wrapped, trailing-commentary and YAML replies', () => {
  const obj = { label: 'claim' };
  const replies = [
    JSON.stringify(obj),
    '```json\n{"label":"claim"}\n```',
    'Here is the label you asked for:\n\n{"label": "claim"}\n\nLet me know if you need more.',
    '{"label":"claim"}\n\nNote: I chose "claim" because the sentence asserts a finding.',
    '```yaml\nlabel: claim\n```',
    'label: claim',
  ];
  for (const r of replies) {
    const parsed = parseStructured('orphan-label', r);
    assert.equal(parsed.ok, true, `parsed: ${JSON.stringify(r)}`);
    assert.deepEqual(parsed.ok && parsed.data, obj);
  }
  // A brace inside a JSON string does not break the balanced scan.
  assert.deepEqual(candidateValues('prefix {"a":"x}y"} suffix')[0], { a: 'x}y' });
  // A bare-array root is coerced into the object contract (SRC-09: every
  // verdict carries relevance and tier; a verdict without them fails the schema).
  const ev = parseStructured('source-evaluator', '[{"citekey":"a2020","keep":true,"reason":"relevant","relevance":0.8,"tier":"Peer reviewed"}]');
  assert.equal(ev.ok, true, ev.ok ? '' : ev.error);
  assert.equal(ev.ok && (ev.data as { verdicts: Array<{ tier: string }> }).verdicts[0]?.tier, 'peer-reviewed', 'the tier is normalised');
  assert.equal(parseStructured('source-evaluator', '[{"citekey":"a2020","keep":true,"reason":"relevant"}]').ok, false, 'no relevance or tier → schema miss (the corrective retry asks for them)');
  // OpenAI strict nulls for optional fields are stripped before validation.
  const nulls = parseStructured('outline-author', JSON.stringify({
    thesis: 't',
    sections: [{ n: 1, slug: 'intro', title: 'Intro', purpose: 'p', depends_on: [], estimated_word_count: 400, assigned_sources: [], role: 'intro', voice: null }],
  }), { strictNulls: true });
  assert.equal(nulls.ok, true, nulls.ok ? '' : nulls.error);
  // Schema violations are reported, not silently accepted.
  const bad = parseStructured('orphan-label', '{"label":"not-a-label"}');
  assert.equal(bad.ok, false);
});

test('RUN-25: exactly one corrective retry — invalid then valid succeeds with 2 requests', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    sb.mock!.script('orphan-label', { text: 'I think this is a claim.' }, { text: '{"label":"claim"}' });
    const r = await call<{ label: string }>('orphan-label');
    assert.equal(r.data?.label, 'claim');
    const bodies = sb.mock!.bodiesFor('orphan-label');
    assert.equal(bodies.length, 2);
    const msgs = bodies[1]!['messages'] as Array<{ role: string; content: string }>;
    assert.equal(msgs.length, 3);
    assert.equal(msgs[1]!.role, 'assistant');
    assert.equal(msgs[1]!.content, 'I think this is a claim.');
    assert.equal(msgs[2]!.role, 'user');
    assert.match(msgs[2]!.content, /did not match the required output schema/);
  });
});

test('RUN-25: a first reply with no text (thinking only) — the correction joins the user turn; no empty assistant turn is ever sent', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    sb.mock!.script('orphan-label', { text: '' }, { text: '{"label":"claim"}' });
    const r = await call<{ label: string }>('orphan-label');
    assert.equal(r.data?.label, 'claim', 'the corrective retry repaired the output (the mock 400s an empty non-final turn, like the API)');
    const bodies = sb.mock!.bodiesFor('orphan-label');
    assert.equal(bodies.length, 2);
    const first = bodies[0]!['messages'] as Array<{ role: string; content: string }>;
    const msgs = bodies[1]!['messages'] as Array<{ role: string; content: string }>;
    assert.equal(msgs.length, first.length, 'no assistant turn was added');
    assert.ok(msgs.every((m) => m.content.trim().length > 0), 'every message has content');
    assert.equal(msgs[msgs.length - 1]!.role, 'user');
    assert.ok(msgs[msgs.length - 1]!.content.startsWith(first[first.length - 1]!.content), 'the original user turn is kept');
    assert.match(msgs[msgs.length - 1]!.content, /did not match the required output schema/);
  });
});

test('RUN-21: the mock rejects an empty non-final message with the API\'s 400 (so a test catches it)', async () => {
  const { startMockLlm } = await import('./helpers/local-servers/mock-llm.js');
  const mock = await startMockLlm();
  try {
    const res = await fetch(`${mock.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pensmith-slug': 'orphan-label' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 10, messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: '' }, { role: 'user', content: 'fix it' }] }),
    });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /messages\.1: all messages must have non-empty content/);
  } finally {
    await mock.close();
  }
});

test('RUN-21: `shape` limits the mock to one API (the other answers 404)', async () => {
  const { startMockLlm } = await import('./helpers/local-servers/mock-llm.js');
  const mock = await startMockLlm({ shape: 'openai' });
  try {
    const a = await fetch(`${mock.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(a.status, 404);
    assert.match(await a.text(), /speaks openai only/);
    const o = await fetch(`${mock.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(o.status, 200);
  } finally {
    await mock.close();
  }
});

test('RUN-25: invalid twice → one-line refusal after exactly 2 requests; OUTLINE.md is not written', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: tidal energy\nDiscipline: engineering\n');
    sb.mock!.script('outline-author', { text: 'Sections: intro, body, end.' }, { text: '{"sections": "three"}' });
    // GRND-08 (Phase 18): the outline verb turns the transport's
    // StructuredOutputError into its own refusal and saves the replies in
    // .paper/OUTLINE.rejected.md — the only file a failed outline writes.
    await assert.rejects(
      (outlineCommand.run as Run)({ args: { yolo: true, force: true } }),
      (e: unknown) =>
        e instanceof OutlineRejectedError &&
        e.exitCode === 1 &&
        !e.message.includes('\n') &&
        /^outline rejected: the reply from claude-opus-5 did not match the required schema after one corrective retry/.test(e.message) &&
        /OUTLINE\.md and the sections are unchanged; the replies are in \.paper\/OUTLINE\.rejected\.md$/.test(e.message),
    );
    assert.equal(sb.mock!.callCount('outline-author'), 2, 'one initial + one corrective, never a third');
    assert.equal(fs.existsSync(path.join(sb.paper, 'OUTLINE.md')), false);
    const rejected = fs.readFileSync(path.join(sb.paper, 'OUTLINE.rejected.md'), 'utf8');
    assert.match(rejected, /Sections: intro, body, end\./, 'the first reply is saved');
    assert.match(rejected, /\{"sections": "three"\}/, 'the corrective reply is saved');
  });
});

async function seedLibrary(sb: LlmSandbox): Promise<void> {
  fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: tidal energy\nDiscipline: engineering\n');
  fs.writeFileSync(path.join(sb.paper, 'LIBRARY.json'), JSON.stringify({
    $schemaVersion: 1,
    entries: [
      // DOIs: outline and plan offer only sources the citation verifier can check (GRND-18).
      { citekey: 'smith2020', title: 'Tidal arrays', authors: ['Smith, A.'], year: 2020, doi: '10.5555/fixture.smith2020' },
      { citekey: 'jones2021', title: 'Marine turbines', authors: ['Jones, B.'], year: 2021, doi: '10.5555/fixture.jones2021' },
    ],
  }));
}

const OUTLINE_OBJECT: OutlineContract = {
  thesis: 'Tidal energy is predictable but costly.',
  sections: [
    { n: 1, slug: 'introduction', title: 'Introduction', purpose: 'Frame the question.', depends_on: [], estimated_word_count: 400, assigned_sources: ['smith2020'], role: 'intro' },
    { n: 2, slug: 'costs', title: 'Costs | and risks', purpose: 'Weigh the costs.', depends_on: ['introduction'], estimated_word_count: 700, assigned_sources: ['smith2020', 'jones2021'], role: 'body', voice: 'measured' },
    { n: 3, slug: 'conclusion', title: 'Conclusion', purpose: 'Answer it.', depends_on: ['costs'], estimated_word_count: 300, assigned_sources: [], role: 'conclusion' },
  ],
};

test('RUN-25: OUTLINE.md is rendered from the validated object (not model text) and round-trips', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedLibrary(sb);
    // The reply is prose-wrapped: the parser extracts the object and the file is rendered from it.
    sb.mock!.script('outline-author', { text: `Here is the outline.\n\n\`\`\`json\n${JSON.stringify(OUTLINE_OBJECT)}\n\`\`\`\nHope this helps!` });
    await (outlineCommand.run as Run)({ args: { yolo: true, force: true } });
    const md = fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8');
    assert.equal(md, renderOutlineMd(OutlineSchema.parse(OUTLINE_OBJECT), 'tidal energy'));
    assert.ok(!md.includes('Hope this helps'), 'no model prose reaches OUTLINE.md');
    const parsed = parseOutline(md);
    assert.deepEqual(parsed.sections.map((s) => [s.n, s.slug, s.depends_on]), [
      [1, 'introduction', []],
      [2, 'costs', ['introduction']],
      [3, 'conclusion', ['costs']],
    ]);
    assert.match(md, /\| 2 \| costs \| Costs \/ and risks \|/, 'a pipe in a title cannot break the table');
  });
});

test('RUN-25: PLAN.md is rendered from the validated object; identity/deps from OUTLINE.md; sources checked, never silently dropped', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedLibrary(sb);
    fs.writeFileSync(path.join(sb.paper, 'OUTLINE.md'), renderOutlineMd(OutlineSchema.parse(OUTLINE_OBJECT), 'Tidal energy'));
    // GRND-13 (Phase 18): a planner reply with a wrong identity or a citekey
    // outside the section's sources is REFUSED (one corrective turn, then
    // "planner output invalid") instead of being silently repaired.
    const bad = {
      frontmatter: { section: 9, slug: 'wrong-slug', title: 'Model title', depends_on: ['nowhere'], assigned_sources: ['jones2021', 'ghost2099'] },
      claims: [{ claim: 'Costs fall.', sources: ['jones2021'], evidence: 'e', counterexamples: '' }],
      structure: [{ paragraph: 1, purpose: 'p', claims: [1] }],
      voice: 'measured',
    };
    const good = {
      frontmatter: { section: 2, slug: 'costs', title: 'Model title', depends_on: ['introduction'], assigned_sources: ['jones2021'] },
      claims: [{ claim: 'Levelized costs fall as arrays grow.', sources: ['jones2021'], evidence: 'The source reports falling costs.', counterexamples: 'Small sites.' }],
      structure: [{ paragraph: 1, purpose: 'Compare levelized costs across two arrays.', claims: [1] }],
      voice: 'Measured and quantitative.',
    };
    sb.mock!.script('section-planner', { data: bad }, { data: good });
    await (planCommand.run as Run)({ args: { n: '2', revise: false, yolo: true } });
    assert.equal(sb.mock!.callCount('section-planner'), 2, 'invalid once, then valid: one corrective turn');
    const planPath = path.join(sb.paper, 'sections', '02-costs', 'PLAN.md');
    const { frontmatter, body } = parseFrontmatter(fs.readFileSync(planPath, 'utf8'));
    assert.equal(frontmatter['section'], 2);
    assert.equal(frontmatter['slug'], 'costs');
    assert.equal(frontmatter['title'], 'Costs / and risks', 'the title comes from OUTLINE.md, not the model');
    assert.deepEqual(frontmatter['depends_on'], ['introduction']);
    assert.deepEqual(frontmatter['assigned_sources'], ['jones2021']);
    assert.equal(frontmatter['status'], 'planned', 'only write sets writing');
    assert.equal(frontmatter['stub'], undefined);
    assert.match(body, /^## Claims\n\n1\. Levelized costs fall as arrays grow\.\n {3}- Sources: jones2021$/m);
    // The corrective turn named the problems.
    const retry = sb.mock!.bodiesFor('section-planner')[1]!;
    const lastUser = JSON.stringify((retry['messages'] as unknown[]).at(-1));
    assert.match(lastUser, /ghost2099/);
    assert.match(lastUser, /wrong-slug/);
    // Section isolation: nothing else under sections/ was created.
    assert.deepEqual(fs.readdirSync(path.join(sb.paper, 'sections')), ['02-costs']);
  });
});
