// tests/gates-reoutline.test.ts — the `reoutline` gate (RUN-28, GRND-09,
// D-18-18). Re-outlining a paper that already has section drafts needs
// `--force` AND the gate's answer:
//   - no terminal and no --yolo → exit 3 (EXIT_APPROVAL) before any model call,
//     every paper file byte- and mtime-identical;
//   - an explicit "no" (scripted numbered answers) → exit 3, nothing touched;
//   - --yolo without --force never re-outlines: a valid OUTLINE.md is only
//     re-registered ("Not regenerating — pass --force"), and with no usable
//     OUTLINE.md the run is a usage error naming --force (exit 2) — no model call
//     either way;
//   - --force --yolo re-outlines (one outline-author call).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { fingerprint, outlineSection, seedBriefPaper, threeSectionOutline } from './helpers/section-fixture.js';
import { gateDef } from '../bin/lib/gates.js';
import { EXIT_APPROVAL, EXIT_USAGE } from '../bin/lib/exit-codes.js';

const KEY = 'sk-test-gates-reoutline-0001';

/** Every paper file except the session log (which records the refused run itself). */
function paperFiles(sb: LlmSandbox): Map<string, { mtimeMs: number; bytes: string }> {
  const all = fingerprint(sb.paper);
  all.delete('SESSION.log');
  return all;
}

/** An outlined paper whose three sections all have drafts. */
async function draftedPaper(sb: LlmSandbox): Promise<void> {
  await seedBriefPaper(sb.root);
  sb.mock!.script('outline-author', { data: threeSectionOutline() });
  const r = await sb.runTsx(null, ['outline', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
  assert.equal(r.status, 0, r.stderr);
  for (const d of ['01-introduction', '02-background', '03-conclusion']) {
    fs.writeFileSync(path.join(sb.paper, 'sections', d, 'DRAFT.md'), `Draft of ${d}.\n`);
  }
  sb.mock!.reset();
}

const outline = (sb: LlmSandbox, args: string[], extra: { env?: Record<string, string>; input?: string } = {}) =>
  sb.runTsx(null, ['outline', ...args], { env: { ANTHROPIC_API_KEY: KEY, ...(extra.env ?? {}) }, ...(extra.input !== undefined ? { input: extra.input } : {}) });

test('RUN-28: the reoutline gate is registered: --yolo skips it (only with --force), a run without a terminal refuses with 3', () => {
  const def = gateDef('reoutline');
  assert.equal(def.yolo, 'skip');
  assert.match(def.yoloChoice, /only with --force/);
  assert.equal(def.nonInteractive, 'refuse');
  assert.equal(def.nonTtyExit, EXIT_APPROVAL);
  assert.equal(def.declineExit, EXIT_APPROVAL);
});

test('GRND-09 / RUN-28: outline --force with no terminal and no --yolo exits 3 before any model call; nothing is touched', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await draftedPaper(sb);
    const before = paperFiles(sb);
    const r = await outline(sb, ['--force']);
    assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: Re-outline a paper that already has drafts\? \(no outline was requested and no section was changed\) needs an answer: re-run in a terminal, or pass --yolo to re-outline \(only with --force\)\.$/m);
    assert.equal(sb.mock!.callCount('outline-author'), 0, 'nothing sent or billed');
    assert.deepEqual(paperFiles(sb), before, 'every paper file byte- and mtime-identical');
  });
});

test('GRND-09 / RUN-28: an explicit "no" at the reoutline gate exits 3; nothing is touched', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await draftedPaper(sb);
    const before = paperFiles(sb);
    const r = await outline(sb, ['--force'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: 'n\n' });
    assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /re-outline cancelled — nothing changed/);
    assert.equal(sb.mock!.callCount('outline-author'), 0);
    assert.deepEqual(paperFiles(sb), before);
  });
});

test('GRND-09: --yolo without --force never re-outlines a paper with drafts', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await draftedPaper(sb);
    const sections = path.join(sb.paper, 'sections');
    const before = fingerprint(sections);
    const outlineBefore = fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8');

    // A valid OUTLINE.md: re-registered only, no model call.
    const kept = await outline(sb, ['--yolo']);
    assert.equal(kept.status, 0, kept.stderr);
    assert.match(kept.stdout, /Not regenerating — pass --force to re-outline\./);
    assert.equal(sb.mock!.callCount('outline-author'), 0);
    assert.deepEqual(fingerprint(sections), before, 'the sections are untouched');
    assert.equal(fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8'), outlineBefore);

    // No usable OUTLINE.md: a usage error naming --force, still no model call.
    fs.writeFileSync(path.join(sb.paper, 'OUTLINE.md'), 'not an outline\n');
    const paperBefore = paperFiles(sb);
    const refused = await outline(sb, ['--yolo']);
    assert.equal(refused.status, EXIT_USAGE, `${refused.stdout}\n${refused.stderr}`);
    assert.match(refused.stderr, /this paper already has section drafts — re-outlining it needs --force/);
    assert.equal(sb.mock!.callCount('outline-author'), 0);
    assert.deepEqual(paperFiles(sb), paperBefore, 'nothing touched');
  });
});

test('GRND-09: outline --force --yolo re-outlines (one outline-author call); a numbered "yes" twice does too', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await draftedPaper(sb);
    const next = threeSectionOutline();
    next.sections = [next.sections[0]!, outlineSection(2, 'methods', { depends_on: ['introduction'], assigned_sources: ['luong2015'], estimated_word_count: 500 }), next.sections[2]!];
    next.sections[2] = { ...next.sections[2]!, depends_on: ['methods'] };
    sb.mock!.script('outline-author', { data: next });
    const r = await outline(sb, ['--force', '--yolo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(sb.mock!.callCount('outline-author'), 1);
    assert.match(r.stdout, /kept 2 section\(s\) untouched; added §1a methods; archived §2 background/);
    assert.ok(fs.existsSync(path.join(sb.paper, 'sections', '_archive', '02-background', 'DRAFT.md')));

    // Answered in a terminal-equivalent: yes to the reoutline gate, yes to the outline approval.
    const again = threeSectionOutline();
    again.sections = [again.sections[0]!, { ...outlineSection(2, 'methods', { depends_on: ['introduction'], assigned_sources: ['luong2015'], estimated_word_count: 500 }) }, { ...again.sections[2]!, depends_on: ['methods'] }];
    sb.mock!.script('outline-author', { data: again });
    const answered = await outline(sb, ['--force'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: 'y\ny\n' });
    assert.equal(answered.status, 0, `${answered.stdout}\n${answered.stderr}`);
    assert.equal(sb.mock!.callCount('outline-author'), 2);
    assert.match(answered.stdout, /kept 3 section\(s\) untouched\./);
  });
});
