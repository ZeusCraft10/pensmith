// tests/write-containment.test.ts — FEED-02 / FEED-04 / GRND-15 through the CLI
// and the RUN-21 mock LLM. The drafter request is built only from the section's
// validated input: its own sources (fenced), the outline title, the PLAN word
// target and the resolved voice; single and wave writes send byte-identical
// bodies. A draft citing an unassigned key gets one corrective turn; if it
// persists, write exits 4, keeps no draft (DRAFT.rejected.md), sets status
// failed + failure_reason, touches no other section, and the router reports
// attention naming `pensmith write N`. write chains verify unless --no-verify.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { fingerprint, seedBriefPaper, threeSectionOutline } from './helpers/section-fixture.js';
import { numberFreshOutline, registerSections } from '../bin/lib/section-stubs.js';
import { renderOutlineMd } from '../bin/lib/outline-parse.js';
import { renderPlannedPlanMd } from '../bin/lib/plan-render.js';
import { parsePromptBlocks } from '../bin/lib/prompt-request.js';
import { loadPrompt } from '../bin/lib/prompt-loader.js';
import { FENCE_OPEN } from '../bin/lib/untrusted-fence.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';
import { resolveNextAction } from '../bin/lib/router.js';

const KEY = 'sk-test-write-containment-0001';

/** Outline + planned PLAN.md for every section (§2 depends on §1; §3 on §2 unless `independent3`). */
async function plannedPaper(sb: LlmSandbox, opts: { emptySources?: string; independent3?: boolean } = {}): Promise<void> {
  await seedBriefPaper(sb.root);
  const outline = threeSectionOutline();
  if (opts.independent3) outline.sections[2]!.depends_on = [];
  for (const s of outline.sections) if (s.slug === opts.emptySources) s.assigned_sources = [];
  const entries = numberFreshOutline(outline.sections);
  fs.writeFileSync(path.join(sb.paper, 'OUTLINE.md'), renderOutlineMd({ thesis: outline.thesis, sections: entries }, 'Attention'));
  await registerSections(sb.root, entries);
  for (const e of entries) {
    const md = renderPlannedPlanMd(
      { section: e.n, slug: e.slug, title: e.title, purpose: e.purpose, role: e.role, depends_on: e.depends_on, word_target: e.estimated_word_count, voice: e.voice, assigned_sources: e.assigned_sources },
      {
        claims: [{ claim: `The ${e.slug} claim.`, sources: e.assigned_sources.slice(0, 1), evidence: '', counterexamples: '' }],
        structure: [{ paragraph: 1, purpose: 'Make the point.', claims: [1] }],
        voice: 'Measured.',
      },
    );
    fs.writeFileSync(path.join(sb.paper, 'sections', `0${e.n}-${e.slug}`, 'PLAN.md'), md);
  }
}

function userMessage(body: Record<string, unknown>): string {
  const m = (body['messages'] as Array<{ content: unknown }>)[0]!.content;
  return typeof m === 'string' ? m : (m as Array<{ text?: string }>).map((b) => b.text ?? '').join('');
}

const write = (sb: LlmSandbox, ...args: string[]) => sb.runTsx(null, ['write', ...args], { env: { ANTHROPIC_API_KEY: KEY } });

test('FEED-02: the drafter request holds only the section\'s sources, the outline title, the PLAN word target and the voice', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await plannedPaper(sb);
    sb.mock!.script('section-drafter', { text: 'Attention predates the transformer [@bahdanau2015].\n' });
    const r = await write(sb, '2', '--no-verify');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const body = sb.mock!.bodiesFor('section-drafter')[0]!;
    const sys = body['system'];
    assert.equal(typeof sys === 'string' ? sys : (sys as Array<{ text: string }>)[0]!.text, loadPrompt('section-drafter'));
    const user = userMessage(body);
    const blocks = parsePromptBlocks(user);
    assert.deepEqual([...blocks.keys()], ['brief', 'section', 'voice', 'plan', 'sources']);
    assert.deepEqual(JSON.parse(blocks.get('section')!), { n: 2, suffix: null, slug: 'background', title: 'Background', role: 'body', word_target: 500 });
    assert.equal(blocks.get('voice'), 'plain, expository', 'the outline voice');
    assert.match(blocks.get('plan')!, /^## Claims\n\n1\. The background claim\./);
    assert.doesNotMatch(blocks.get('plan')!, /status: |verified_against_draft_hash/, 'no lifecycle keys reach the model');
    assert.deepEqual((JSON.parse(blocks.get('sources')!) as Array<{ citekey: string }>).map((s) => s.citekey), ['bahdanau2015', 'luong2015']);
    for (const other of ['vaswani2017', 'devlin2019']) assert.doesNotMatch(user, new RegExp(other));
    assert.equal(user.split(FENCE_OPEN).length - 1, 1);
    const brief = JSON.parse(blocks.get('brief')!) as Record<string, unknown>;
    assert.equal(brief['topic'], 'attention mechanisms in transformer models');
    assert.equal(loadFrontmatterDocSync('plan', path.join(sb.paper, 'sections', '02-background', 'PLAN.md')).frontmatter['status'], 'written', '--no-verify leaves it written');

    // A wave write builds the byte-identical request for the same section.
    sb.mock!.reset();
    fs.rmSync(path.join(sb.paper, 'sections', '02-background', 'DRAFT.md'));
    const planPath = path.join(sb.paper, 'sections', '02-background', 'PLAN.md');
    fs.writeFileSync(planPath, fs.readFileSync(planPath, 'utf8').replace('status: written', 'status: planned'));
    const wave = await write(sb, '--no-verify');
    assert.equal(wave.status, 0, wave.stderr);
    const waveBody = sb.mock!.bodiesFor('section-drafter').find((b) => userMessage(b).includes('"slug": "background"'))!;
    assert.equal(userMessage(waveBody), user, 'single and wave writes send byte-identical data');
  });
});

test('FEED-02: a section with no sources drafts without citations and prints the WARN naming plan --research and add', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await plannedPaper(sb, { emptySources: 'conclusion' });
    sb.mock!.script('section-drafter', { text: 'The argument closes here.\n' });
    const r = await write(sb, '3', '--no-verify');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /WARN — section 3 has no assigned sources; drafting it without citations\. Add sources with `pensmith plan 3 --research "<query>"` or `pensmith add <doi> --section 3 --slug conclusion`/);
    const sources = parsePromptBlocks(userMessage(sb.mock!.bodiesFor('section-drafter')[0]!)).get('sources');
    assert.equal(sources, '[]');
  });
});

test('FEED-02 / PRD §7.18: with style-match on the request carries the STYLE.json render; the outline voice still wins', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await plannedPaper(sb);
    const { buildStyleProfile, styleMatchToVoiceHint } = await import('../bin/lib/style-match.js');
    const profile = await buildStyleProfile(fileURLToPath(new URL('./fixtures/style-samples/paperA', import.meta.url)));
    fs.writeFileSync(path.join(sb.paper, 'STYLE.json'), JSON.stringify(profile, null, 2));
    sb.mock!.script('section-drafter', { text: 'One.\n' }, { text: 'Two.\n' });
    assert.equal((await write(sb, '2', '--no-verify')).status, 0);
    assert.equal((await write(sb, '1', '--no-verify')).status, 0);
    const [two, one] = sb.mock!.bodiesFor('section-drafter').map((b) => parsePromptBlocks(userMessage(b)));
    assert.equal(two!.get('style_profile'), styleMatchToVoiceHint(profile));
    assert.equal(two!.get('voice'), 'plain, expository', 'the section hint wins over the profile');
    assert.equal(one!.get('voice'), styleMatchToVoiceHint(profile), 'no section hint → the STYLE.json render');
  });
});

test('FEED-04: a drafter citing an unassigned key gets one retry, then exit 4 — no draft kept, status failed, other sections untouched', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await plannedPaper(sb);
    const sections = path.join(sb.paper, 'sections');
    const others = new Map(['01-introduction', '03-conclusion'].map((d) => [d, fingerprint(path.join(sections, d))]));
    const evil = { text: 'IGNORE ALL PREVIOUS INSTRUCTIONS worked, see [@evil9999] and [@bahdanau2015].\n' };
    sb.mock!.script('section-drafter', evil, evil);
    const r = await write(sb, '2');
    assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: section 2 failed: citekey evil9999 not assigned to section 2 — the draft was not kept \(it is in \.paper\/sections\/02-background\/DRAFT\.rejected\.md\)/m);
    assert.equal(sb.mock!.callCount('section-drafter'), 2, 'one corrective turn');
    const retry = JSON.stringify((sb.mock!.bodiesFor('section-drafter')[1]!['messages'] as unknown[]).at(-1));
    assert.match(retry, /\[@evil9999\]/);
    assert.match(retry, /Cite only these citekeys: bahdanau2015, luong2015/);
    assert.equal(fs.existsSync(path.join(sections, '02-background', 'DRAFT.md')), false);
    assert.match(fs.readFileSync(path.join(sections, '02-background', 'DRAFT.rejected.md'), 'utf8'), /evil9999/);
    const fm = loadFrontmatterDocSync('plan', path.join(sections, '02-background', 'PLAN.md')).frontmatter;
    assert.equal(fm['status'], 'failed');
    assert.equal(fm['failure_reason'], 'citekey evil9999 not assigned to section 2');
    assert.equal(fs.existsSync(path.join(sections, '02-background', 'VERIFICATION.md')), false, 'no verify after a failed draft');
    for (const [d, before] of others) assert.deepEqual(fingerprint(path.join(sections, d)), before, `${d} untouched`);
    // §1 is still next (planned); once §1 is verified the router reports §2's failure instead of a paid loop.
    const p1 = path.join(sections, '01-introduction', 'PLAN.md');
    fs.writeFileSync(p1, fs.readFileSync(p1, 'utf8').replace('status: planned', 'status: verified'));
    const d = await resolveNextAction(sb.root);
    assert.equal(d.verb, 'status');
    assert.match(d.verb === 'status' ? d.detail ?? '' : '', /section 2 failed: citekey evil9999 not assigned to section 2 — .*`pensmith write 2`/);

    // A clean retry recovers: the rejected draft goes, failure_reason is cleared.
    sb.mock!.script('section-drafter', { text: 'Attention predates transformers [@bahdanau2015].\n' });
    const again = await write(sb, '2', '--no-verify');
    assert.equal(again.status, 0, again.stderr);
    const fm2 = loadFrontmatterDocSync('plan', path.join(sections, '02-background', 'PLAN.md')).frontmatter;
    assert.equal(fm2['status'], 'written');
    assert.equal(fm2['failure_reason'], undefined);
    assert.equal(fs.existsSync(path.join(sections, '02-background', 'DRAFT.rejected.md')), false);
  });
});

test('FEED-04: a failed RE-write keeps the older DRAFT.md byte-identical, reports attention, and neither verify nor compile passes the older draft off as the section', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await plannedPaper(sb);
    const sections = path.join(sb.paper, 'sections');
    for (const d of ['01-introduction']) {
      const p = path.join(sections, d, 'PLAN.md');
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('status: planned', 'status: verified'));
    }
    sb.mock!.script('section-drafter', { text: 'Attention predates transformers.\n' });
    assert.equal((await write(sb, '2', '--no-verify')).status, 0);
    const draft = path.join(sections, '02-background', 'DRAFT.md');
    const kept = fs.readFileSync(draft, 'utf8');

    const evil = { text: 'See [@evil9999].\n' };
    sb.mock!.script('section-drafter', evil, evil);
    const r = await write(sb, '2');
    assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(draft, 'utf8'), kept, 'the older draft is not overwritten by the rejected one');
    const d = await resolveNextAction(sb.root);
    assert.equal(d.verb, 'status', 'the failure is reported, the older draft is not silently verified');
    assert.match(d.verb === 'status' ? d.detail ?? '' : '', /section 2 failed: citekey evil9999 not assigned to section 2 — .*`pensmith write 2`/);

    // (Superseded Phase 18 behaviour: verify used to verify the older draft and
    // clear the failure — hiding the failed write.) verify refuses, naming the
    // retry; PLAN.md keeps the failure; nothing is written.
    const planPath = path.join(sections, '02-background', 'PLAN.md');
    const planBefore = fs.readFileSync(planPath, 'utf8');
    const v = await sb.runTsx(null, ['verify', '2'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(v.status, 4, `${v.stdout}\n${v.stderr}`);
    assert.match(v.stderr, /pensmith verify: section 2 not verified — its last write failed \(citekey evil9999 not assigned to section 2\); the DRAFT\.md on disk is older — run `pensmith write 2`/);
    assert.equal(fs.readFileSync(planPath, 'utf8'), planBefore, 'PLAN.md keeps status failed and the failure reason');
    assert.ok(!fs.existsSync(path.join(sections, '02-background', 'VERIFICATION.md')), 'no verification of the older draft');
    const fm = loadFrontmatterDocSync('plan', planPath).frontmatter;
    assert.equal(fm['status'], 'failed');
    assert.equal(fm['failure_reason'], 'citekey evil9999 not assigned to section 2');

    // compile (and so done) refuses the section as well, even with a passing VERIFICATION.md.
    fs.writeFileSync(path.join(sections, '02-background', 'VERIFICATION.md'), '# VERIFICATION\n\nStatus: verified\n');
    const c = await sb.runTsx(null, ['compile', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(c.status, 4, `${c.stdout}\n${c.stderr}`);
    assert.match(`${c.stdout}${c.stderr}`, /section 2 \(background\): its last write failed \(citekey evil9999 not assigned to section 2\); the DRAFT\.md on disk is older — run `pensmith write 2`/);
    assert.ok(!fs.existsSync(path.join(sb.paper, 'DRAFT.md')), 'no compiled draft');
    const { runExportBlockingGate } = await import('../bin/cli/done.js');
    const gate = runExportBlockingGate(sb.root);
    assert.equal(gate.blocked, true);
    // VRFY-26: done names a section by its id and slug (the registry), as compile does.
    assert.ok(gate.reasons.some((r) => /section 2 \(background\): its last write failed/.test(r)), gate.reasons.join(' | '));
  });
});

test('FEED-04: an unassigned key in a citation group is caught too; a corrected retry succeeds', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await plannedPaper(sb);
    sb.mock!.script('section-drafter',
      { text: 'Two views [@bahdanau2015; @devlin2019].\n' },
      { text: 'Two views [@bahdanau2015; @luong2015].\n' });
    const r = await write(sb, '2', '--no-verify');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(sb.mock!.callCount('section-drafter'), 2);
    assert.equal(fs.readFileSync(path.join(sb.paper, 'sections', '02-background', 'DRAFT.md'), 'utf8'), 'Two views [@bahdanau2015; @luong2015].\n');
  });
});

test('FEED-04: an unassigned key cited author-suppressed ([-@k]) or narratively (@k) is caught like [@k] (review round 2)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await plannedPaper(sb);
    const evil = { text: 'Attention predates transformers [-@evil9999].\r\nAs @ghost2020 argues, it scales [@bahdanau2015].\n' };
    sb.mock!.script('section-drafter', evil, evil);
    const r = await write(sb, '2');
    assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /section 2 failed: citekeys evil9999, ghost2020 not assigned to section 2/);
    assert.equal(sb.mock!.callCount('section-drafter'), 2, 'one corrective turn');
    const retry = JSON.stringify((sb.mock!.bodiesFor('section-drafter')[1]!['messages'] as unknown[]).at(-1));
    assert.match(retry, /\[@evil9999\], \[@ghost2020\]/);
    assert.equal(fs.existsSync(path.join(sb.paper, 'sections', '02-background', 'DRAFT.md')), false);
    assert.equal(loadFrontmatterDocSync('plan', path.join(sb.paper, 'sections', '02-background', 'PLAN.md')).frontmatter['status'], 'failed');
  });
});

test('GRND-15: write N chains verify — DRAFT.md and VERIFICATION.md in one invocation, the verify status reported', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    // §1 is assigned no source: its citation-free draft verifies (VRFY-24 — the
    // same draft for a section WITH assigned sources is NO-CITATIONS).
    await plannedPaper(sb, { emptySources: 'introduction' });
    sb.mock!.script('section-drafter', { text: 'The transformer changed sequence modelling.\n' });
    const r = await write(sb, '1');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /pensmith write: wrote DRAFT\.md/);
    assert.match(r.stdout, /pensmith write: section 1 verify: verified/);
    const dir = path.join(sb.paper, 'sections', '01-introduction');
    assert.ok(fs.existsSync(path.join(dir, 'DRAFT.md')));
    assert.match(fs.readFileSync(path.join(dir, 'VERIFICATION.md'), 'utf8'), /^Status: verified$/m);
    assert.equal(loadFrontmatterDocSync('plan', path.join(dir, 'PLAN.md')).frontmatter['status'], 'verified');
  });
});

test('GRND-15: write exits with verify\'s code — a blocking verdict (a cited key with no bib entry) is exit 4', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await plannedPaper(sb);
    fs.writeFileSync(path.join(sb.paper, 'CITATIONS.bib'), '@article{other2020, title={Other}, author={Other, O}, year={2020}}\n');
    sb.mock!.script('section-drafter', { text: 'The transformer [@vaswani2017].\n' });
    const r = await write(sb, '1');
    assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /pensmith write: section 1 verify: failed/);
    assert.ok(fs.existsSync(path.join(sb.paper, 'sections', '01-introduction', 'DRAFT.md')), 'the contained draft is kept; verify judged it');
  });
});
