// tests/approval-gates.test.ts — approval gates work without a terminal.
//
// Claude Code's Bash tool, CI and pipes have no terminal. The outline,
// research and revise gates then failed after the paid work, discarded what
// they had made, never showed it, and told the caller to "Use --yolo"; `plan N
// --revise` crashed with a stack trace (exit 1); and done's export
// confirmation could only be answered at a terminal. Now each gate keeps what
// it proposed, prints one JSON line {pending, gate, ref, summary, options,
// default, how_to_answer} and exits 3; running the step again shows the same
// decision without redoing the work; `pensmith gate answer <ref> <option>`
// records the person's answer and finishes the step with exactly what was
// shown; a rejection writes nothing and exits 2; nothing suggests --yolo.

import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _setGeneratorForTest, type Generator } from '../bin/lib/anthropic.js';
import { initState } from '../bin/lib/state.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { writeCompileManifestFixture, writeVerificationFixture } from './lib/verification-fixture.js';
import { isolatedCliEnv } from './lib/cli-env.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

// ---------------------------------------------------------------------------
// Harness: in-process verbs with a scripted model; stdout and stderr captured.
// ---------------------------------------------------------------------------

let out = '';
let err = '';
let realOut: typeof process.stdout.write;
let realErr: typeof process.stderr.write;
let prevCwd = '';
const ENV = ['PENSMITH_NO_LLM', 'ANTHROPIC_API_KEY', 'PENSMITH_OFFLINE'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  prevCwd = process.cwd();
  for (const k of ENV) saved[k] = process.env[k];
  delete process.env['PENSMITH_NO_LLM'];
  delete process.env['PENSMITH_OFFLINE'];
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-not-sent';
  out = '';
  err = '';
  realOut = process.stdout.write.bind(process.stdout);
  realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string | Uint8Array, ...rest: unknown[]): boolean => {
    out += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
    return (realOut as (c: string | Uint8Array, ...r: unknown[]) => boolean)(c, ...rest);
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array): boolean => {
    err += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  process.exitCode = 0;
});

afterEach(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
  _setGeneratorForTest(null);
  process.chdir(prevCwd);
  process.exitCode = 0;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

interface Call { system: string }

function model(calls: Call[], answer: (c: Call) => unknown): Generator {
  return {
    async generate(req) {
      const call = { system: req.system };
      calls.push(call);
      const a = answer(call);
      return {
        text: typeof a === 'string' ? a : JSON.stringify(a),
        model: req.model, stop: 'complete', stopReason: 'end_turn',
        usage: [{ model: req.model, inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }],
      };
    },
  };
}

type Run = (c: { args: Record<string, unknown> }) => Promise<Record<string, unknown> | undefined>;

async function verb(name: 'outline' | 'research' | 'gate', root: string, args: Record<string, unknown>): Promise<{ exit: number; res: Record<string, unknown> }> {
  const mod = await import(`../bin/cli/${name}.js`) as Record<string, { run: Run }>;
  const cmd = mod[`${name}Command`]!;
  process.chdir(root);
  out = '';
  err = '';
  process.exitCode = 0;
  const res = (await cmd.run({ args })) ?? {};
  return { exit: Number(process.exitCode ?? 0), res };
}

/** The last JSON line printed. */
function pending(): Record<string, unknown> {
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON line on stdout:\n${out}\n${err}`);
  return JSON.parse(line) as Record<string, unknown>;
}

function gateFiles(root: string): string[] {
  const dir = join(root, '.paper', 'gates');
  return existsSync(dir) ? readdirSync(dir) : [];
}

// ---------------------------------------------------------------------------
// The outline approval
// ---------------------------------------------------------------------------

const OUTLINE = {
  title: 'Tidal Power and Estuaries',
  thesis: 'Tidal barrages trade clean power for estuary change.',
  sections: [
    { slug: 'introduction', title: 'Introduction', purpose: 'Frame it.', depends_on: [], word_target: 300, assigned_sources: [], counterargument: false },
    { slug: 'evidence', title: 'Evidence', purpose: 'Survey it.', depends_on: ['introduction'], word_target: 900, assigned_sources: ['smith2020'], counterargument: false },
  ],
};

async function outlinePaper(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gates-outline-'));
  const pdir = join(root, '.paper');
  mkdirSync(pdir, { recursive: true });
  await initState(root);
  writeFileSync(join(pdir, 'PROJECT.md'), '# p\n\n## Assignment\n\nArgue whether tidal power is worth it.\n');
  writeFileSync(join(pdir, 'INTAKE.json'), JSON.stringify({
    $schemaVersion: 1, topic: 'tidal power', discipline: 'other', length_words: 1500,
    citation_style: 'apa', audience: 'a course', counterargument: 'optional',
  }));
  writeFileSync(join(pdir, 'LIBRARY.json'), JSON.stringify({
    $schemaVersion: 2, researched_at: '2026-11-01T00:00:00.000Z',
    entries: [{ id: 'smith2020', type: 'article-journal', title: 'Tidal barrages', author: [{ family: 'Smith', given: 'J' }], issued: { 'date-parts': [[2020]] },
      DOI: '10.1000/smith2020', custom: { identities: ['doi:10.1000/smith2020'], added_at: '2026-11-01T00:00:00.000Z' } }],
  }));
  return root;
}

test('outline without a terminal keeps the checked proposal, shows it with a ref, exits 3 and writes no outline', async () => {
  const root = await outlinePaper();
  const calls: Call[] = [];
  _setGeneratorForTest(model(calls, () => OUTLINE));
  const r = await verb('outline', root, { yolo: false, force: false });
  assert.equal(r.exit, 3, `${out}\n${err}`);
  const p = pending();
  assert.equal(p['gate'], 'outline');
  assert.match(String(p['ref']), /^outline-[0-9a-f]{12}$/);
  assert.deepEqual(p['options'], ['approve', 'reject']);
  assert.match(String(p['outline']), /Evidence/, 'the proposal itself is shown');
  assert.match(String(p['how_to_answer']), new RegExp(`pensmith gate answer ${String(p['ref'])}`));
  assert.doesNotMatch(out + err, /--yolo/, 'never suggests --yolo');
  assert.ok(!existsSync(join(root, '.paper', 'OUTLINE.json')), 'no outline is written before approval');
  assert.equal(calls.length, 1);

  // Asked again before the answer: the same decision, and no new model call.
  const again = await verb('outline', root, { yolo: false, force: false });
  assert.equal(again.exit, 3);
  assert.equal(pending()['ref'], p['ref']);
  assert.equal(calls.length, 1, 'the kept proposal is shown again, not paid for again');

  // Approved: exactly that outline is written, still with no model call.
  const a = await verb('gate', root, { action: 'answer', ref: p['ref'], option: 'approve' });
  assert.equal(a.exit, 0, `${out}\n${err}`);
  assert.equal(calls.length, 1);
  const stored = JSON.parse(readFileSync(join(root, '.paper', 'OUTLINE.json'), 'utf8')) as { sections: Array<{ slug: string }> };
  assert.deepEqual(stored.sections.map((s) => s.slug), ['introduction', 'evidence']);
  assert.deepEqual(gateFiles(root), [], 'an answered decision is removed');
});

test('outline: a rejected proposal writes nothing and exits 2', async () => {
  const root = await outlinePaper();
  _setGeneratorForTest(model([], () => OUTLINE));
  await verb('outline', root, { yolo: false, force: false });
  const ref = pending()['ref'];
  const r = await verb('gate', root, { action: 'answer', ref, option: 'reject' });
  assert.equal(r.exit, 2, `${out}\n${err}`);
  assert.match(out, /outline rejected/);
  assert.ok(!existsSync(join(root, '.paper', 'OUTLINE.json')));
  assert.deepEqual(gateFiles(root), []);
});

test('gate answer refuses an option the decision does not offer, and a ref that is not waiting (exit 2)', async () => {
  const root = await outlinePaper();
  _setGeneratorForTest(model([], () => OUTLINE));
  await verb('outline', root, { yolo: false, force: false });
  const ref = String(pending()['ref']);
  const bad = await verb('gate', root, { action: 'answer', ref, option: 'yes' });
  assert.equal(bad.exit, 2);
  assert.match(err, /not an option here: yes/);
  assert.ok(!existsSync(join(root, '.paper', 'OUTLINE.json')));
  const gone = await verb('gate', root, { action: 'answer', ref: 'outline-000000000000', option: 'approve' });
  assert.equal(gone.exit, 2);
  assert.match(err, /no decision with ref/);
  const list = await verb('gate', root, { action: 'list' });
  assert.equal(list.exit, 0);
  assert.equal(pending()['ref'], ref, '`gate list` shows the decision still waiting');
});

test('outline: a proposal kept for an intake that changed since is not applied', async () => {
  const root = await outlinePaper();
  const calls: Call[] = [];
  _setGeneratorForTest(model(calls, () => OUTLINE));
  await verb('outline', root, { yolo: false, force: false });
  writeFileSync(join(root, '.paper', 'INTAKE.json'), JSON.stringify({
    $schemaVersion: 1, topic: 'wave power', discipline: 'other', length_words: 1500,
    citation_style: 'apa', audience: 'a course', counterargument: 'optional',
  }));
  const r = await verb('outline', root, { yolo: false, force: false });
  assert.equal(r.exit, 3);
  assert.equal(calls.length, 2, 'a new proposal is made for the new intake');
});

// ---------------------------------------------------------------------------
// Research: the scope and the candidates
// ---------------------------------------------------------------------------

function researchProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gates-research-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  // Recorded registry answers for this query (tests/fixtures/cassettes/crossref/synthetic-research-rerun.json).
  writeFileSync(join(root, '.paper', 'INTAKE.md'), '# Intake\n\nTopic: citekey stability first run\nDiscipline: other\n');
  return root;
}

const SCOPES = { scopes: [
  { label: 'stability', queries: ['citekey stability first run'] },
  { label: 'history', queries: ['citekey stability first run'] },
] };

function researchModel(calls: Call[]): Generator {
  return model(calls, (c) => {
    if (/disambiguat|scopes/i.test(c.system) && !c.system.includes('"id"')) return SCOPES;
    const block = /"id"/.test(c.system) ? c.system : '';
    const ids = [...block.matchAll(/"id":\s*"([^"]+)"/g)].map((m) => m[1]);
    return { verdicts: ids.map((id) => ({ id, keep: true, reason: 'in scope' })) };
  });
}

test('research without a terminal asks for the scope, then the candidates, each kept until answered, and merges what the user chose', async () => {
  const root = researchProject();
  const calls: Call[] = [];
  _setGeneratorForTest(researchModel(calls));
  const first = await verb('research', root, { yolo: false });
  assert.equal(first.exit, 3, `${out}\n${err}`);
  const scope = pending();
  assert.equal(scope['gate'], 'research-scope');
  assert.deepEqual(scope['options'], ['stability', 'history']);
  assert.doesNotMatch(out + err, /--yolo/);
  const afterScope = calls.length;

  const second = await verb('gate', root, { action: 'answer', ref: scope['ref'], option: 'history' });
  assert.equal(second.exit, 3, `${out}\n${err}`);
  const cands = pending();
  assert.equal(cands['gate'], 'research-candidates');
  assert.equal(cands['multiple'], true);
  const options = cands['options'] as string[];
  assert.ok(options.length > 0, 'the candidates are offered');
  assert.ok(Array.isArray(cands['candidates']), 'each candidate is shown');
  assert.ok(calls.length > afterScope, 'the chosen scope was searched and screened');
  assert.ok(!existsSync(join(root, '.paper', 'LIBRARY.json')) || !(JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { researched_at?: string }).researched_at,
    'research is not done before the candidates are approved');

  const before = calls.length;
  const third = await verb('gate', root, { action: 'answer', ref: cands['ref'], option: options[0] });
  assert.equal(third.exit, 0, `${out}\n${err}`);
  assert.equal(calls.length, before, 'approving the candidates calls no model');
  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ id: string }>; researched_at?: string };
  assert.deepEqual(lib.entries.map((e) => e.id), [options[0]], 'exactly the chosen candidate is merged');
  assert.equal(typeof lib.researched_at, 'string');
  assert.deepEqual(gateFiles(root), []);
});

// ---------------------------------------------------------------------------
// plan N --revise, through the CLI (offline: the deterministic proposal)
// ---------------------------------------------------------------------------

function cli(root: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd: root,
    env: isolatedCliEnv({ PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: '1', ANTHROPIC_API_KEY: undefined, GPTZERO_API_KEY: undefined }),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function lastJson(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON line on stdout: ${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

const FLAGGED = 'Barrages change sediment [@ghost2020]. Tides are regular [@real2020].\n';

function revisePaper(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gates-revise-'));
  const pdir = join(root, '.paper');
  const sdir = join(pdir, 'sections', '01-intro');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(join(pdir, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'gates-revise', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }));
  writeFileSync(join(pdir, 'OUTLINE.md'), '| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Intro | | 300 | ghost2020, real2020 |\n');
  writeFileSync(join(pdir, 'CITATIONS.bib'), '@article{real2020, title={Real}, author={Doe, Jane}, year={2020}, doi={10.1000/real}}\n');
  writeFileSync(join(sdir, 'DRAFT.md'), FLAGGED);
  writeFileSync(join(sdir, 'PLAN.md'), `---\nsection: 1\nslug: intro\nstatus: failed\nassigned_sources: [ghost2020, real2020]\nverified_against_draft_hash: null\n---\n## Brief\n\nVoice: plain.\n`);
  writeVerificationFixture(sdir, {
    n: 1, slug: 'intro', draft: FLAGGED, assignedSources: ['ghost2020', 'real2020'],
    citations: [{ citekey: 'ghost2020', verdict: 'FABRICATED' }, { citekey: 'real2020', verdict: 'OK' }],
  });
  return root;
}

test('plan --revise without a terminal keeps the proposed change (exit 3, no stack trace); approving it applies exactly that change', () => {
  const root = revisePaper();
  const r = cli(root, ['plan', '1', '--revise']);
  assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /at .*\.ts:\d+|ApprovalUnavailableError/, 'no stack trace');
  assert.doesNotMatch(r.stdout + r.stderr, /--yolo/);
  const p = lastJson(r.stdout);
  assert.equal(p['gate'], 'revise');
  assert.match(String(p['ref']), /^revise-1-[0-9a-f]{12}$/);
  assert.deepEqual(p['options'], ['approve', 'reject']);
  assert.match(String(p['change']), /ghost2020/);
  const draft = join(root, '.paper', 'sections', '01-intro', 'DRAFT.md');
  assert.equal(readFileSync(draft, 'utf8'), FLAGGED, 'nothing changes before approval');

  const a = cli(root, ['gate', 'answer', String(p['ref']), 'approve']);
  assert.equal(a.status, 0, `${a.stdout}\n${a.stderr}`);
  const after = readFileSync(draft, 'utf8');
  assert.doesNotMatch(after, /ghost2020/, 'the approved removal is applied');
  assert.match(after, /\[@real2020\]/);
  assert.deepEqual(gateFiles(root), []);
});

test('plan --revise: a rejected change leaves DRAFT.md as it was and exits 2', () => {
  const root = revisePaper();
  const p = lastJson(cli(root, ['plan', '1', '--revise']).stdout);
  const r = cli(root, ['gate', 'answer', String(p['ref']), 'reject']);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.equal(readFileSync(join(root, '.paper', 'sections', '01-intro', 'DRAFT.md'), 'utf8'), FLAGGED);
});

test('plan --revise: a change kept for a draft edited since is not applied', () => {
  const root = revisePaper();
  const p = lastJson(cli(root, ['plan', '1', '--revise']).stdout);
  const draft = join(root, '.paper', 'sections', '01-intro', 'DRAFT.md');
  const edited = 'Barrages change sediment a great deal [@ghost2020]. Tides are regular [@real2020].\n';
  writeFileSync(draft, edited);
  const r = cli(root, ['gate', 'answer', String(p['ref']), 'approve']);
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(draft, 'utf8'), edited, 'a change shown for another draft is never applied');
});

// ---------------------------------------------------------------------------
// done: the export confirmation
// ---------------------------------------------------------------------------

async function compiledPaper(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gates-done-'));
  const pdir = join(root, '.paper');
  const sdir = join(pdir, 'sections', '01-intro');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(join(pdir, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'gates-done', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }));
  writeFileSync(join(pdir, 'OUTLINE.md'), '| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Intro | | 300 | |\n');
  writeFileSync(join(pdir, 'CITATIONS.bib'), '');
  const draft = 'Tidal barrages change estuary sediment over decades.\n';
  writeFileSync(join(sdir, 'DRAFT.md'), draft);
  writeFileSync(join(sdir, 'PLAN.md'), `---\nsection: 1\nslug: intro\nstatus: verified\nassigned_sources: []\nverified_against_draft_hash: ${computeDraftHash(Buffer.from(draft), [])}\n---\n`);
  writeVerificationFixture(sdir, { n: 1, slug: 'intro', draft });
  writeFileSync(join(pdir, 'DRAFT.md'), `# Intro\n\n${draft}`);
  await writeCompileManifestFixture(root, [{ n: 1, slug: 'intro' }]);
  return root;
}

test('done without a terminal keeps the audit with a ref; asked again it shows the same decision; `gate answer <ref> export` exports', async () => {
  const root = await compiledPaper();
  const first = cli(root, ['done', '--format', 'md']);
  assert.equal(first.status, 3, `${first.stdout}\n${first.stderr}`);
  const p = lastJson(first.stdout);
  assert.equal(p['gate'], 'export');
  assert.deepEqual(p['options'], ['export', 'cancel']);
  assert.equal(p['default'], 'cancel');
  assert.match(String(p['how_to_answer']), /pensmith gate answer export-[0-9a-f]{12} <option>/);
  assert.doesNotMatch(first.stdout + first.stderr, /--yolo/);
  assert.ok(!existsSync(join(root, '.paper', 'export')));

  const again = cli(root, ['done', '--format', 'md']);
  assert.equal(again.status, 3);
  assert.equal(lastJson(again.stdout)['ref'], p['ref'], 'the kept audit is shown again, not redone');

  const a = cli(root, ['gate', 'answer', String(p['ref']), 'export']);
  assert.equal(a.status, 0, `${a.stdout}\n${a.stderr}`);
  assert.match(a.stdout, /pensmith done: exported /);
  assert.ok(existsSync(join(root, '.paper', 'export', 'DRAFT.md')));
  assert.ok(existsSync(join(root, '.paper', 'FINAL.md')));
  assert.deepEqual(gateFiles(root), []);
});

test('done: `gate answer <ref> cancel` exports nothing and exits 2', async () => {
  const root = await compiledPaper();
  const p = lastJson(cli(root, ['done', '--format', 'md']).stdout);
  const r = cli(root, ['gate', 'answer', String(p['ref']), 'cancel']);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /export cancelled/);
  assert.ok(!existsSync(join(root, '.paper', 'export')));
  assert.ok(!existsSync(join(root, '.paper', 'FINAL.md')));
});

test('done: an export confirmed for a draft that changed since is not exported', async () => {
  const root = await compiledPaper();
  const p = lastJson(cli(root, ['done', '--format', 'md']).stdout);
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Intro\n\nEdited after the question was asked.\n');
  const r = cli(root, ['gate', 'answer', String(p['ref']), 'export']);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'the edited draft is refused by the export gate');
});
