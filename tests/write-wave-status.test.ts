// tests/write-wave-status.test.ts — a wave write drafts only what is waiting to be drafted.
//
// runAllSections scheduled every section with a PLAN.md and never read its
// status, so `pensmith write` re-drafted a verified or hand-edited DRAFT.md
// without asking, set it back to 'written' and billed it again. Now a wave
// write drafts only sections whose plan is 'planned' or 'writing'; a section
// already drafted is drafted again only with --force, which keeps the old
// draft as DRAFT.md.bak; a stub (no plan yet) is never drafted.

import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _setGeneratorForTest, type Generator } from '../bin/lib/anthropic.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { writeOutline, type Outline } from '../bin/lib/outline-store.js';
import { renderPlan } from '../bin/lib/plan-store.js';
import { initState } from '../bin/lib/state.js';

const SECTIONS = [
  { n: 1, slug: 'verified-one', status: 'verified' },
  { n: 2, slug: 'planned-one', status: 'planned' },
  { n: 3, slug: 'written-one', status: 'written' },
  { n: 4, slug: 'stub-one', status: 'stub' },
  { n: 5, slug: 'writing-one', status: 'writing' },
  { n: 6, slug: 'failed-one', status: 'failed' },
] as const;

const OUTLINE: Outline = {
  title: 'A Paper',
  thesis: 'A thesis.',
  sections: SECTIONS.map((s) => ({
    n: s.n, slug: s.slug, title: `Section ${s.n}`, purpose: 'A purpose.', depends_on: [], word_target: 300, assigned_sources: [], counterargument: false,
  })),
};

const BRIEF = 'This section frames the question the paper answers and sets out what the following sections will argue in turn.';
const HAND_EDITED = 'A draft the author verified and then polished by hand.\n';

const dir = (n: number): string => `${String(n).padStart(2, '0')}-${SECTIONS[n - 1]!.slug}`;
const planFile = (root: string, n: number): string => join(root, '.paper', 'sections', dir(n), 'PLAN.md');
const draftFile = (root: string, n: number): string => join(root, '.paper', 'sections', dir(n), 'DRAFT.md');
const statusOf = (root: string, n: number): unknown => parseFrontmatter(readFileSync(planFile(root, n), 'utf8')).frontmatter['status'];

async function paper(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-wave-status-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  await initState(root);
  await writeOutline(root, OUTLINE);
  for (const s of SECTIONS) {
    if (s.status === 'stub') continue; // writeOutline left its stub PLAN.md
    const o = OUTLINE.sections[s.n - 1]!;
    const plan = renderPlan(
      { n: o.n, slug: o.slug, title: o.title, depends_on: [], purpose: o.purpose, word_target: o.word_target, assigned_sources: [] },
      { assigned_sources: [], claims: [], brief: BRIEF, voice: 'plain' },
    ).replace('status: planned', `status: ${s.status}`);
    writeFileSync(planFile(root, s.n), plan);
    if (s.status !== 'planned') writeFileSync(draftFile(root, s.n), `${HAND_EDITED.trim()} (section ${s.n})\n`);
  }
  return root;
}

interface Call { user: string }

function drafter(calls: Call[]): Generator {
  return {
    async generate(req) {
      const user = req.messages[0]!.content;
      calls.push({ user });
      return {
        text: JSON.stringify({ draft: `A new draft for: ${user}`, gaps: [] }),
        model: req.model, stop: 'complete', stopReason: 'end_turn',
        usage: [{ model: req.model, inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }],
      };
    },
  };
}

let prevCwd = '';
const ENV = ['PENSMITH_NO_LLM', 'ANTHROPIC_API_KEY', 'PENSMITH_OFFLINE'];
const saved: Record<string, string | undefined> = {};
let stderr = '';
let realStderrWrite: typeof process.stderr.write;
beforeEach(() => {
  prevCwd = process.cwd();
  for (const k of ENV) saved[k] = process.env[k];
  delete process.env['PENSMITH_NO_LLM'];
  delete process.env['PENSMITH_OFFLINE'];
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-not-sent';
  stderr = '';
  realStderrWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string | Uint8Array) => boolean }).write = (s) => {
    stderr += typeof s === 'string' ? s : Buffer.from(s).toString('utf8');
    return true;
  };
});
afterEach(() => {
  process.stderr.write = realStderrWrite;
  _setGeneratorForTest(null);
  process.chdir(prevCwd);
  process.exitCode = 0;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function runWrite(root: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { writeCommand } = await import('../bin/cli/write.js');
  process.chdir(root);
  const res = (await (writeCommand.run as (c: { args: Record<string, unknown> }) => Promise<Record<string, unknown>>)({ args: { yolo: true, ...args } })) ?? {};
  return { ...res, exitCode: process.exitCode ?? 0 };
}

test('a wave write drafts the planned and writing sections and leaves every drafted section as it is', async () => {
  const root = await paper();
  const before = new Map([1, 3, 6].map((n) => [n, readFileSync(draftFile(root, n), 'utf8')]));
  const calls: Call[] = [];
  _setGeneratorForTest(drafter(calls));
  const res = await runWrite(root, { 'max-parallel': '1' });
  assert.equal(res['exitCode'], 0, `${JSON.stringify(res)}\n${stderr}`);

  assert.deepEqual(calls.map((c) => c.user).sort(), ['Write section 2, "Section 2".', 'Write section 5, "Section 5".']);
  for (const [n, text] of before) {
    assert.equal(readFileSync(draftFile(root, n), 'utf8'), text, `section ${n}'s DRAFT.md is untouched`);
    assert.ok(!existsSync(`${draftFile(root, n)}.bak`), `no backup for section ${n}, which was not drafted`);
  }
  assert.equal(statusOf(root, 1), 'verified');
  assert.equal(statusOf(root, 3), 'written');
  assert.equal(statusOf(root, 6), 'failed');
  assert.equal(statusOf(root, 4), 'stub');
  assert.ok(!existsSync(draftFile(root, 4)), 'a stub is never drafted');
  assert.equal(statusOf(root, 2), 'written');
  assert.equal(statusOf(root, 5), 'written');

  // Each section left alone is named, with what to do.
  assert.match(stderr, /section 1 \(verified-one\).*already drafted \(status verified\).*--force/);
  assert.match(stderr, /section 3 \(written-one\).*already drafted \(status written\)/);
  assert.match(stderr, /section 4 \(stub-one\).*no plan yet.*pensmith plan 4/);
});

test('--force drafts the drafted sections again and keeps each old draft as DRAFT.md.bak; a stub still waits for its plan', async () => {
  const root = await paper();
  const old1 = readFileSync(draftFile(root, 1), 'utf8');
  const calls: Call[] = [];
  _setGeneratorForTest(drafter(calls));
  const res = await runWrite(root, { 'max-parallel': '1', force: true });
  assert.equal(res['exitCode'], 0, stderr);
  assert.equal(calls.length, 5, 'every section but the stub');
  assert.equal(readFileSync(`${draftFile(root, 1)}.bak`, 'utf8'), old1, 'the verified draft is kept');
  assert.match(readFileSync(draftFile(root, 1), 'utf8'), /A new draft for: Write section 1/);
  assert.equal(statusOf(root, 1), 'written', 'so it is verified again');
  assert.ok(!existsSync(draftFile(root, 4)));
});

test('write <n> refuses a drafted section without --force, and a stub always, before any model call', async () => {
  const root = await paper();
  const text = readFileSync(draftFile(root, 1), 'utf8');
  const calls: Call[] = [];
  _setGeneratorForTest(drafter(calls));

  const drafted = await runWrite(root, { n: 1 });
  assert.equal(drafted['exitCode'], 2, stderr);
  assert.match(stderr, /already drafted \(status verified\).*pensmith write 1 --force/);
  assert.equal(readFileSync(draftFile(root, 1), 'utf8'), text);
  assert.equal(statusOf(root, 1), 'verified');

  process.exitCode = 0;
  const stub = await runWrite(root, { n: 4, force: true });
  assert.equal(stub['exitCode'], 2, stderr);
  assert.match(stderr, /no plan yet.*pensmith plan 4/);
  assert.equal(calls.length, 0, 'nothing was asked of the model');

  process.exitCode = 0;
  const forced = await runWrite(root, { n: 1, force: true });
  assert.equal(forced['exitCode'], 0, stderr);
  assert.equal(readFileSync(`${draftFile(root, 1)}.bak`, 'utf8'), text);
  assert.equal(calls.length, 1);
});
