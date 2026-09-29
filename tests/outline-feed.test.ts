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
import { normalizeDisciplineSlug, presetFor } from '../bin/lib/disciplines.js';

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

test('GRND-06: a History paper\'s outline request carries the History sectioning convention (asserted through --show-prompts)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const history = normalizeDisciplineSlug('History');
    await seedBriefPaper(sb.root, { discipline: history, counterargument: 'no' });
    sb.mock!.script('outline-author', { data: threeSectionOutline() });
    const r = await sb.runTsx(null, ['--show-prompts', 'outline', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    // The mirror prints each outbound model body in full, before it is sent.
    const bodies = r.stderr
      .split(/\r?\n/)
      .filter((l) => l.startsWith('[show-prompts] body: {'))
      .map((l) => JSON.parse(l.slice('[show-prompts] body: '.length)) as Record<string, unknown>);
    const outline = bodies.filter((b) => requestParts(b).system === loadPrompt('outline-author'));
    assert.equal(outline.length, 1, 'one outline-author request was mirrored');
    const brief = JSON.parse(parsePromptBlocks(requestParts(outline[0]!).user).get('brief')!) as Record<string, unknown>;
    assert.equal(brief['discipline'], history);
    assert.deepEqual(brief['sectioning_convention'], [...presetFor(history).sectioningConvention], 'the History preset\'s sectioning convention (PRD §8)');
    assert.notDeepEqual(brief['sectioning_convention'], [...presetFor(normalizeDisciplineSlug('Computer Science')).sectioningConvention], 'not another preset\'s');
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

test('GRND-18: outline offers only the sources the citation verifier can check; an arXiv-only or identifier-less one is named, never allocated', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const { DEFAULT_SOURCES } = await import('./helpers/section-fixture.js');
    await seedBriefPaper(sb.root, {}, {
      sources: [
        ...DEFAULT_SOURCES,
        { citekey: 'raffel2019', title: 'Exploring the Limits of Transfer Learning', author: 'Raffel, Colin', year: 2019, doi: '10.48550/arXiv.1910.10683' },
        { citekey: 'huang2018', title: 'An untitled preprint', author: 'Huang, Wei', year: 2018, doi: null },
      ],
    });
    // A reply that allocates a source outline was never offered is rejected like an invented key.
    const bad = threeSectionOutline();
    bad.sections[1] = { ...bad.sections[1]!, assigned_sources: ['bahdanau2015', 'raffel2019'] };
    sb.mock!.script('outline-author', { data: bad }, { data: threeSectionOutline() });
    const r = await sb.runTsx(null, ['outline', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /pensmith outline: WARN — 2 of 6 source\(s\) in LIBRARY\.json are not offered to the outline because the citation verifier would not pass a citation of them: raffel2019 \(a DataCite DOI \(10\.48550\) Crossref does not resolve\), huang2018 \(no DOI\)/);
    const { user } = requestParts(sb.mock!.bodiesFor('outline-author')[0]!);
    const offered = (JSON.parse(parsePromptBlocks(user).get('sources')!) as Array<{ citekey: string }>).map((s) => s.citekey);
    assert.deepEqual(offered, DEFAULT_SOURCES.map((s) => s.citekey));
    assert.equal(sb.mock!.callCount('outline-author'), 2, 'the unofferable key got the corrective turn');
    const rows = parseOutline(fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8')).sections;
    assert.ok(rows.every((row) => !row.assigned_sources.includes('raffel2019') && !row.assigned_sources.includes('huang2018')));

    // D-18-37: where the user decides — the approval gate — the withheld sources are named too.
    sb.mock!.script('outline-author', { data: threeSectionOutline() });
    const asked = await sb.runTsx(null, ['outline', '--force'], { env: { ANTHROPIC_API_KEY: KEY, PENSMITH_PROMPT_MODE: 'numbered' }, input: 'y\n' });
    assert.equal(asked.status, 0, `${asked.stdout}\n${asked.stderr}`);
    const gate = asked.stderr.slice(asked.stderr.indexOf('Proposed outline:'));
    assert.match(gate, /Not offered to the outline \(2 of 6 LIBRARY\.json source\(s\)\) because the citation verifier would not pass a citation of them: raffel2019 \(a DataCite DOI \(10\.48550\) Crossref does not resolve\), huang2018 \(no DOI\)\. To use one the verifier cannot check, `pensmith add` the DOI of its published/);
  });
});
