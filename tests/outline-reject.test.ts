// tests/outline-reject.test.ts — GRND-08 / GRND-10 through the built-from-
// source CLI and the RUN-21 mock LLM: an outline that breaks a rule gets
// exactly one corrective turn quoting the error; still invalid, the command
// exits non-zero naming it, saves both replies to OUTLINE.rejected.md and
// leaves OUTLINE.md (even a user's own) and STATE.json untouched; bare runs
// then report attention naming `pensmith outline` and never re-bill.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { outlineSection, seedBriefPaper, threeSectionOutline } from './helpers/section-fixture.js';
import { disciplineSlugs, presetFor } from '../bin/lib/disciplines.js';
import type { OutlineContract } from '../bin/lib/llm-contracts.js';

const KEY = 'sk-test-outline-reject-0001';
const USER_OUTLINE = '# My outline notes\n\nI will write about attention first, then transformers.\n';

async function seeded(sb: LlmSandbox, brief: Parameters<typeof seedBriefPaper>[1] = {}): Promise<void> {
  await seedBriefPaper(sb.root, brief);
  fs.writeFileSync(path.join(sb.paper, 'OUTLINE.md'), USER_OUTLINE);
}

function outlineRun(sb: LlmSandbox, ...extra: string[]) {
  return sb.runTsx(null, ['outline', '--yolo', ...extra], { env: { ANTHROPIC_API_KEY: KEY } });
}

function assertUntouched(sb: LlmSandbox): void {
  assert.equal(fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8'), USER_OUTLINE, 'the user OUTLINE.md is byte-identical');
  const state = JSON.parse(fs.readFileSync(path.join(sb.paper, 'STATE.json'), 'utf8')) as { sections?: unknown[] };
  assert.deepEqual(state.sections ?? [], [], 'nothing registered');
  assert.equal(fs.existsSync(path.join(sb.paper, 'sections')), false, 'no section folder');
}

const BROKEN: Array<[string, () => OutlineContract, RegExp]> = [
  ['an unknown citekey', () => {
    const o = threeSectionOutline();
    o.sections[1]!.assigned_sources = ['bahdanau2015', 'fake2099'];
    return o;
  }, /citekey "fake2099" \(assigned to "background"\) is not in the sources block/],
  ['a broken depends_on', () => {
    const o = threeSectionOutline();
    o.sections[2]!.depends_on = ['results'];
    return o;
  }, /section "conclusion" depends on "results", which is not a section of this outline/],
  ['a dependency cycle', () => {
    const o = threeSectionOutline();
    o.sections[0]!.depends_on = ['conclusion'];
    return o;
  }, /the depends_on links form a cycle/],
  ['a word total off by 50%', () => {
    const o = threeSectionOutline();
    for (const s of o.sections) s.estimated_word_count = 250;
    return o;
  }, /the word targets sum to 750, but the paper's length target is 1500 words/],
];

for (const [what, make, message] of BROKEN) {
  test(`GRND-08: ${what} → exactly one retry, then a non-zero exit naming it; OUTLINE.rejected.md; nothing else written`, async () => {
    await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
      await seeded(sb);
      sb.mock!.script('outline-author', { data: make() }, { data: make() });
      const r = await outlineRun(sb);
      assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, message);
      assert.match(r.stderr, /^pensmith: outline rejected: .* — OUTLINE\.md and the sections are unchanged; the replies are in \.paper\/OUTLINE\.rejected\.md$/m);
      assert.equal(sb.mock!.callCount('outline-author'), 2, 'one reply + one corrective turn, never a third');
      // The corrective turn quoted the problem to the model.
      const retry = JSON.stringify((sb.mock!.bodiesFor('outline-author')[1]!['messages'] as unknown[]).at(-1));
      assert.match(retry, /breaks these rules/);
      const rejected = fs.readFileSync(path.join(sb.paper, 'OUTLINE.rejected.md'), 'utf8');
      assert.match(rejected, /## Problems/);
      assert.match(rejected, /## Reply 1/);
      assert.match(rejected, /## Reply 2 \(after the corrective turn\)/);
      assertUntouched(sb);
    });
  });
}

test('RUN-12: a reply that is neither JSON nor YAML is refused with ONE stderr line (no YAMLWarning block)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seeded(sb);
    sb.mock!.script('outline-author', { text: 'I cannot produce that.' }, { text: '%%% garbage ###' });
    const r = await outlineRun(sb);
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /YAMLWarning|BAD_DIRECTIVE|trace-warnings/, r.stderr);
    const lines = r.stderr.split(/\r?\n/).filter((l) => l.trim() !== '' && !/^(?:OFFLINE MODE|LLM STUBBED)/.test(l));
    assert.deepEqual(lines.filter((l) => !l.startsWith('pensmith outline: WARN')).length, 1, r.stderr);
    assert.match(lines.at(-1) ?? '', /^pensmith: outline rejected: .*no JSON or YAML value/);
    assertUntouched(sb);
  });
});

test('GRND-08: invalid once, then valid → success; OUTLINE.rejected.md from an earlier failure is deleted', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seeded(sb);
    fs.writeFileSync(path.join(sb.paper, 'OUTLINE.rejected.md'), '# Rejected outline\n');
    const bad = threeSectionOutline();
    bad.sections[0]!.assigned_sources = ['nope2020'];
    sb.mock!.script('outline-author', { data: bad }, { data: threeSectionOutline() });
    const r = await outlineRun(sb);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /registered 3 section\(s\)/);
    assert.equal(sb.mock!.callCount('outline-author'), 2);
    assert.equal(fs.existsSync(path.join(sb.paper, 'OUTLINE.rejected.md')), false);
  });
});

test('GRND-08: two garbage replies leave a user OUTLINE.md byte-identical; bare runs then report attention without re-billing', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seeded(sb);
    sb.mock!.script('outline-author', { text: 'Sure! Intro, body, end.' }, { text: '{"sections": 3}' });
    const r = await outlineRun(sb);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /outline rejected: the reply from .* did not match the required schema after one corrective retry/);
    assert.equal(sb.mock!.callCount('outline-author'), 2);
    assertUntouched(sb);
    const rejected = fs.readFileSync(path.join(sb.paper, 'OUTLINE.rejected.md'), 'utf8');
    assert.match(rejected, /Sure! Intro, body, end\./, 'the replies are recovered from SESSION.log');
    assert.match(rejected, /\{"sections": 3\}/);

    for (let i = 0; i < 2; i += 1) {
      const next = await sb.runTsx(null, ['next', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
      assert.match(next.stdout, /attention: the last outline was rejected .*`pensmith outline`/, `${next.stdout}\n${next.stderr}`);
    }
    assert.equal(sb.mock!.callCount('outline-author'), 2, 'bare runs make 0 outline calls');
    const status = await sb.runTsx(null, ['status'], {});
    assert.match(status.stdout, /next: status \(attention\)/);
    assert.match(status.stdout, /attention: the last outline was rejected/);
  });
});

// GRND-10: a preset whose counterargument default is `on` (by table value — no discipline literal).
const ON = disciplineSlugs().find((s) => presetFor(s).counterargDefault === 'on')!;

test('GRND-10: a paper needing a counterargument refuses a counter-less outline after one retry, registering nothing', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seeded(sb, { discipline: ON, paper_type: 'analytical' });
    sb.mock!.script('outline-author', { data: threeSectionOutline() }, { data: threeSectionOutline() });
    const r = await outlineRun(sb);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /counterargument \+ rebuttal section required \(§7\.4\); use --no-counter to disable/);
    assert.equal(sb.mock!.callCount('outline-author'), 2);
    const brief = JSON.stringify(sb.mock!.bodiesFor('outline-author')[0]!['messages']);
    assert.match(brief, /\\"counterargument_required\\": true/, 'the request said a counterargument is required');
    assertUntouched(sb);
  });
});

test('GRND-10: --no-counter accepts the same outline; a counterargument + rebuttal outline is accepted without it', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seeded(sb, { discipline: ON, paper_type: 'analytical' });
    sb.mock!.script('outline-author', { data: threeSectionOutline() });
    const r = await outlineRun(sb, '--no-counter');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(sb.mock!.callCount('outline-author'), 1);
    const brief = JSON.stringify(sb.mock!.bodiesFor('outline-author')[0]!['messages']);
    assert.match(brief, /\\"counterargument_required\\": false/);
  });
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seeded(sb, { discipline: ON, paper_type: 'argumentative' });
    const o = threeSectionOutline();
    o.sections[1]!.estimated_word_count = 300;
    o.sections.splice(2, 0,
      outlineSection(3, 'objection', { role: 'counterargument', depends_on: ['background'], assigned_sources: ['luong2015'], estimated_word_count: 100 }),
      outlineSection(4, 'reply', { role: 'rebuttal', depends_on: ['objection'], assigned_sources: ['vaswani2017'], estimated_word_count: 100 }),
    );
    sb.mock!.script('outline-author', { data: o });
    const r = await outlineRun(sb);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /registered 5 section\(s\)/);
    assert.match(r.stdout, /counterargument rule applied \(paper-type\)/);
  });
});
