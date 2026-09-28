// tests/plan-feed.test.ts — FEED-01 / GRND-12 / GRND-13 through the CLI and the
// RUN-21 mock LLM: the planner request carries the brief, the section's OUTLINE
// row, its upstream claim summaries and ONLY its own sources (one fence); an
// invented citekey is refused naming it (one corrective turn, then
// "planner output invalid") with the stub byte-identical and the router still
// on `plan`; a valid reply renders a planned PLAN.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { seedBriefPaper, threeSectionOutline } from './helpers/section-fixture.js';
import { parsePromptBlocks } from '../bin/lib/prompt-request.js';
import { loadPrompt } from '../bin/lib/prompt-loader.js';
import { FENCE_OPEN, FENCE_CLOSE } from '../bin/lib/untrusted-fence.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';
import { buildStatusView } from '../bin/lib/status-view.js';

const KEY = 'sk-test-plan-feed-0001';

function plannerReply(n: number, slug: string, deps: string[], sources: string[], claim: string) {
  return {
    data: {
      frontmatter: { section: n, slug, title: 'Model Title', depends_on: deps, assigned_sources: sources },
      claims: sources.length > 0
        ? sources.map((s, i) => ({ claim: `${claim} (${i + 1})`, sources: [s], evidence: 'The source shows it.', counterexamples: '' }))
        : [{ claim, sources: [], evidence: '', counterexamples: '' }],
      structure: [{ paragraph: 1, purpose: 'Make the case.', claims: [1] }],
      voice: 'Measured.',
    },
  };
}

function userMessage(body: Record<string, unknown>): string {
  const m = (body['messages'] as Array<{ content: unknown }>)[0]!.content;
  return typeof m === 'string' ? m : (m as Array<{ text?: string }>).map((b) => b.text ?? '').join('');
}

function systemText(body: Record<string, unknown>): string {
  const s = body['system'];
  return typeof s === 'string' ? s : (s as Array<{ text?: string }>).map((b) => b.text ?? '').join('');
}

async function outlined(sb: LlmSandbox): Promise<void> {
  await seedBriefPaper(sb.root);
  sb.mock!.script('outline-author', { data: threeSectionOutline() });
  const r = await sb.runTsx(null, ['outline', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
  assert.equal(r.status, 0, r.stderr);
}

const plan = (sb: LlmSandbox, n: string) => sb.runTsx(null, ['plan', n], { env: { ANTHROPIC_API_KEY: KEY } });

test('GRND-13 / FEED-01: invented citekeys are refused naming both; the stub stays byte-identical; status says plan §1', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await outlined(sb);
    const stubPath = path.join(sb.paper, 'sections', '01-introduction', 'PLAN.md');
    const stub = fs.readFileSync(stubPath, 'utf8');
    const bad = plannerReply(1, 'introduction', [], ['fakecite2099', 'vaswani2017', 'zzzinvented2001'], 'Attention matters');
    sb.mock!.script('section-planner', bad, bad);
    const r = await plan(sb, '1');
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: planner output invalid: assigned_sources has citekeys that are not this section's sources: fakecite2099, zzzinvented2001 /m);
    assert.match(r.stderr, /nothing was written/);
    assert.equal(sb.mock!.callCount('section-planner'), 2, 'one corrective turn, never a third');
    assert.equal(fs.readFileSync(stubPath, 'utf8'), stub, 'the stub PLAN.md is byte-identical');
    const view = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    assert.equal(view.nextLine, 'next: plan §1');

    // FEED-01: §1's request holds §1's sources only, inside one fence.
    const body = sb.mock!.bodiesFor('section-planner')[0]!;
    assert.equal(systemText(body), loadPrompt('section-planner'), 'the system prompt is the unmodified template');
    const user = userMessage(body);
    const sources = JSON.parse(parsePromptBlocks(user).get('sources')!) as Array<{ citekey: string; title: string; abstract: string | null; full_text: boolean }>;
    assert.deepEqual(sources.map((s) => s.citekey), ['vaswani2017']);
    assert.equal(sources[0]!.title, 'Attention Is All You Need');
    assert.equal(sources[0]!.full_text, true);
    for (const other of ['bahdanau2015', 'luong2015', 'devlin2019']) assert.doesNotMatch(user, new RegExp(other), `${other} belongs to another section`);
    assert.equal(user.split(FENCE_OPEN).length - 1, 1);
    assert.ok(user.indexOf(FENCE_OPEN) < user.indexOf('vaswani2017') && user.indexOf('vaswani2017') < user.indexOf(FENCE_CLOSE));
  });
});

test('GRND-12 / GRND-13: plan 1 then plan 2 — the request carries the brief, the OUTLINE row and §1\'s claims; PLAN.md is planned', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await outlined(sb);
    // Invalid once (wrong slug), then valid: one corrective turn, success.
    sb.mock!.script(
      'section-planner',
      plannerReply(1, 'intro', [], ['vaswani2017'], 'Transformers replaced recurrence'),
      plannerReply(1, 'introduction', [], ['vaswani2017'], 'Transformers replaced recurrence'),
    );
    const one = await plan(sb, '1');
    assert.equal(one.status, 0, one.stderr);
    assert.equal(sb.mock!.callCount('section-planner'), 2);

    sb.mock!.script('section-planner', plannerReply(2, 'background', ['introduction'], ['bahdanau2015', 'luong2015'], 'Attention predates transformers'));
    const two = await plan(sb, '2');
    assert.equal(two.status, 0, two.stderr);
    const user = userMessage(sb.mock!.bodiesFor('section-planner')[2]!);
    const blocks = parsePromptBlocks(user);
    assert.deepEqual([...blocks.keys()], ['brief', 'section', 'upstream', 'sources']);
    const brief = JSON.parse(blocks.get('brief')!) as Record<string, unknown>;
    assert.equal(brief['topic'], 'attention mechanisms in transformer models');
    assert.match(String(brief['thesis']), /Self-attention displaced recurrence/);
    assert.equal(brief['discipline'], 'computer-science');
    assert.equal(typeof brief['tone'], 'string');
    assert.ok(String(brief['tone']).length > 0, 'the discipline tone');
    const section = JSON.parse(blocks.get('section')!) as Record<string, unknown>;
    assert.deepEqual(section, {
      n: 2, suffix: null, slug: 'background', title: 'Background', purpose: 'Establish the background.', role: 'body',
      depends_on: ['introduction'], word_target: 500, voice: 'plain, expository',
    }, 'the OUTLINE row, not title = slug and 400 words');
    const upstream = JSON.parse(blocks.get('upstream')!) as Array<{ slug: string; title: string; claims_summary: string }>;
    assert.deepEqual(upstream.map((u) => u.slug), ['introduction']);
    assert.match(upstream[0]!.claims_summary, /Transformers replaced recurrence/);
    assert.deepEqual((JSON.parse(blocks.get('sources')!) as Array<{ citekey: string }>).map((s) => s.citekey), ['bahdanau2015', 'luong2015']);
    assert.doesNotMatch(user, /wire via Phase|topic from INTAKE\.md|the assigned topic/);

    const doc = loadFrontmatterDocSync('plan', path.join(sb.paper, 'sections', '02-background', 'PLAN.md'));
    assert.equal(doc.frontmatter['status'], 'planned');
    assert.equal(doc.frontmatter['stub'], undefined);
    assert.equal(doc.frontmatter['title'], 'Background');
    assert.equal(doc.frontmatter['voice'], 'plain, expository', 'the outline entry is kept');
    assert.deepEqual(doc.frontmatter['assigned_sources'], ['bahdanau2015', 'luong2015']);
    for (const h of ['## Claims', '## Structure', '## Word target', '## Voice']) assert.ok(doc.body.includes(h), h);
    const view = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    assert.equal(view.nextLine, 'next: write §1', 'a planned section routes to write');
  });
});

test('GRND-13: a re-plan may use an outline source the previous plan dropped (the allowed set never shrinks)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await outlined(sb);
    const planPath = path.join(sb.paper, 'sections', '02-background', 'PLAN.md');
    // The first plan picks one of §2's two outline sources.
    sb.mock!.script('section-planner', plannerReply(2, 'background', ['introduction'], ['bahdanau2015'], 'Attention predates transformers'));
    const first = await plan(sb, '2');
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(loadFrontmatterDocSync('plan', planPath).frontmatter['assigned_sources'], ['bahdanau2015']);

    // The re-plan still sees both outline sources and may pick the dropped one.
    sb.mock!.script('section-planner', plannerReply(2, 'background', ['introduction'], ['luong2015'], 'Alignment came first'));
    const again = await plan(sb, '2');
    assert.equal(again.status, 0, again.stderr);
    const user = userMessage(sb.mock!.bodiesFor('section-planner')[1]!);
    assert.deepEqual(
      (JSON.parse(parsePromptBlocks(user).get('sources')!) as Array<{ citekey: string }>).map((s) => s.citekey),
      ['bahdanau2015', 'luong2015'],
      'the outline allocation, not the previous pick',
    );
    assert.equal(sb.mock!.callCount('section-planner'), 2, 'no corrective turn: luong2015 is allowed');
    assert.deepEqual(loadFrontmatterDocSync('plan', planPath).frontmatter['assigned_sources'], ['luong2015']);
  });
});

test('GRND-13: a planner reply that never parses reports `planner output invalid`; PLAN.md is unchanged; status says plan §N', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await outlined(sb);
    const stubPath = path.join(sb.paper, 'sections', '01-introduction', 'PLAN.md');
    const stub = fs.readFileSync(stubPath, 'utf8');
    sb.mock!.script('section-planner', { text: 'Here is my plan: write about attention.' }, { text: 'Still no JSON, sorry.' });
    const r = await plan(sb, '1');
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: planner output invalid: the reply did not match the plan contract \(.+\) — nothing was written; .+PLAN\.md is unchanged$/m);
    assert.equal(fs.readFileSync(stubPath, 'utf8'), stub, 'PLAN.md is byte-identical');
    const view = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    assert.equal(view.nextLine, 'next: plan §1', 'the router still plans the failed section');
  });
});
