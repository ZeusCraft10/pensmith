// tests/outline-feed.test.ts — FEED-03 / GRND-07 / GRND-09 through the real
// outline verb and the RUN-21 mock LLM: the request is the fixed template plus
// the paper's data (the intake brief, every LIBRARY source fenced once), the
// reply in the template's format registers its sections, OUTLINE.md is the
// canonical 8-column table, and each section gets its stub PLAN.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { seedBriefPaper, threeSectionOutline } from './helpers/section-fixture.js';
import { outlineCommand } from '../bin/cli/outline.js';
import { loadPrompt } from '../bin/lib/prompt-loader.js';
import { parsePromptBlocks } from '../bin/lib/prompt-request.js';
import { FENCE_OPEN, FENCE_CLOSE } from '../bin/lib/untrusted-fence.js';
import { parseOutline } from '../bin/lib/outline-parse.js';
import { loadState } from '../bin/lib/state.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';
import { buildStatusView } from '../bin/lib/status-view.js';

const KEY = 'sk-test-outline-feed-0001';
type Run = (ctx: { args: Record<string, unknown> }) => Promise<unknown>;

/** The system text and the user data message of a captured Anthropic request body. */
function requestParts(body: Record<string, unknown>): { system: string; user: string } {
  const sys = body['system'];
  const system = typeof sys === 'string' ? sys : Array.isArray(sys) ? sys.map((b) => (b as { text?: string }).text ?? '').join('') : '';
  const msgs = body['messages'] as Array<{ content: unknown }>;
  const first = msgs[0]!.content;
  const user = typeof first === 'string' ? first : (first as Array<{ text?: string }>).map((b) => b.text ?? '').join('');
  return { system, user };
}

test('FEED-03 / GRND-07 / GRND-09: outline --yolo sends the brief and every source, registers the reply, writes stubs', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedBriefPaper(sb.root);
    sb.mock!.script('outline-author', { data: threeSectionOutline() });
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string | Uint8Array) => { out.push(String(c)); return true; }) as typeof process.stdout.write;
    try {
      await (outlineCommand.run as Run)({ args: { yolo: true } });
    } finally {
      process.stdout.write = write;
    }
    assert.match(out.join(''), /registered 3 section\(s\)/);

    // The request: the template as system (cacheable), the data once as blocks.
    assert.equal(sb.mock!.callCount('outline-author'), 1);
    const { system, user } = requestParts(sb.mock!.bodiesFor('outline-author')[0]!);
    assert.equal(system, loadPrompt('outline-author'), 'the system prompt is the unmodified template');
    const blocks = parsePromptBlocks(user);
    assert.deepEqual([...blocks.keys()], ['brief', 'sources'], 'no existing_sections on a first outline');
    const brief = JSON.parse(blocks.get('brief')!) as Record<string, unknown>;
    assert.equal(brief['topic'], 'attention mechanisms in transformer models');
    assert.match(String(brief['thesis']), /Self-attention displaced recurrence/);
    assert.equal(brief['discipline'], 'computer-science');
    assert.equal(brief['length_target_words'], 1500, 'the intake length, not a 2000 placeholder');
    assert.ok(Array.isArray(brief['sectioning_convention']) && (brief['sectioning_convention'] as unknown[]).length > 0);
    assert.equal(brief['counterargument_required'], false);
    const sources = JSON.parse(blocks.get('sources')!) as Array<{ citekey: string }>;
    assert.deepEqual(sources.map((s) => s.citekey), ['vaswani2017', 'bahdanau2015', 'luong2015', 'devlin2019']);
    assert.equal(user.split(FENCE_OPEN).length - 1, 1, 'the sources sit in exactly one fence');
    assert.ok(user.indexOf(FENCE_OPEN) < user.indexOf('vaswani2017') && user.indexOf('devlin2019') < user.indexOf(FENCE_CLOSE));
    assert.doesNotMatch(user, /"general"|the assigned topic/);

    // The result: STATE.json, the canonical OUTLINE.md and stub PLAN.md files.
    const state = await loadState(sb.root);
    assert.deepEqual(state.sections?.map((s) => [s.n, s.slug]), [[1, 'introduction'], [2, 'background'], [3, 'conclusion']]);
    const md = fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8');
    assert.match(md, /^\| # \| slug \| title \| role \| depends_on \| word target \| assigned_sources \| voice \|$/m);
    const parsed = parseOutline(md);
    assert.deepEqual(parsed.sections[1]!.assigned_sources, ['bahdanau2015', 'luong2015']);
    assert.equal(parsed.sections[1]!.voice, 'plain, expository');
    assert.deepEqual(fs.readdirSync(path.join(sb.paper, 'sections')).sort(), ['01-introduction', '02-background', '03-conclusion']);
    const stub = loadFrontmatterDocSync('plan', path.join(sb.paper, 'sections', '02-background', 'PLAN.md'));
    assert.equal(stub.frontmatter['stub'], true);
    assert.equal(stub.frontmatter['status'], 'planned');
    assert.equal(stub.frontmatter['section'], 2);
    assert.equal(stub.frontmatter['word_target'], 500);
    assert.equal(stub.frontmatter['voice'], 'plain, expository');
    assert.equal(stub.frontmatter['role'], 'body');
    assert.deepEqual(stub.frontmatter['depends_on'], ['introduction']);
    assert.deepEqual(stub.frontmatter['assigned_sources'], ['bahdanau2015', 'luong2015']);
    assert.match(stub.body, /^## Outline entry\n\nEstablish the background\.$/m);
    const view = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    assert.equal(view.nextLine, 'next: plan §1');

    // Re-running without --force registers the same outline again (no model call, no rewrite).
    const before = fs.readFileSync(path.join(sb.paper, 'sections', '01-introduction', 'PLAN.md'), 'utf8');
    await (outlineCommand.run as Run)({ args: { yolo: true } });
    assert.equal(sb.mock!.callCount('outline-author'), 1, 'an existing valid outline is never re-billed');
    assert.equal(fs.readFileSync(path.join(sb.paper, 'sections', '01-introduction', 'PLAN.md'), 'utf8'), before, 'an existing PLAN.md is never touched');
  });
});

test('FEED-03: without a terminal and without --yolo the outline refuses (exit 3) before any request', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedBriefPaper(sb.root);
    const r = await sb.runTsx(null, ['outline'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
    assert.equal(sb.mock!.callCount('outline-author'), 0, 'nothing was sent or billed');
    assert.equal(fs.existsSync(path.join(sb.paper, 'OUTLINE.md')), false);
  });
});

test('GRND-07: a legacy OUTLINE.md (6 columns) registers with stubs seeded from its assigned_sources', async () => {
  await withLlmSandbox({}, async (sb) => {
    await seedBriefPaper(sb.root);
    fs.writeFileSync(path.join(sb.paper, 'OUTLINE.md'), [
      '# Legacy', '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 400 | vaswani2017 |',
      '| 2 | body | Body | intro | 800 | luong2015, devlin2019 |',
      '',
    ].join('\n'));
    await (outlineCommand.run as Run)({ args: { yolo: true } });
    const stub = loadFrontmatterDocSync('plan', path.join(sb.paper, 'sections', '02-body', 'PLAN.md'));
    assert.deepEqual(stub.frontmatter['assigned_sources'], ['luong2015', 'devlin2019']);
    assert.equal(stub.frontmatter['word_target'], 800);
    assert.equal(stub.frontmatter['stub'], true);
    assert.equal(stub.frontmatter['role'], 'body', 'a legacy row without a role is a body section');
  });
});
