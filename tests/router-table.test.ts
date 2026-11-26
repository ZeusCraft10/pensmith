// tests/router-table.test.ts — the router sends each recorded state to the
// step that moves it on, and says why.
//
// The router sent 'failed' and 'unverifiable' sections back to verify. verify
// is deterministic on an unchanged draft, so bare `pensmith` repeated the same
// verdict forever (re-billing the advisory passes), never reached revise, and
// never reached compile for a section whose only problem was a paywalled
// quotation. Once DRAFT.md and FINAL.md existed it decided compile and done
// by file existence, so after a section was redone it exported the stale
// compiled draft or reported "done" for good.
//
// Now: a failed section goes to the step its recorded verdicts call for
// (revise a flagged citation, redraft placeholder or uncited text, verify a
// changed draft or a registry that did not answer), an unverifiable one is
// compiled with a warning, compile is due whenever the sections, the outline
// or the bibliography differ from what the last compile recorded, done is due
// until FINAL.md is the export of the current compile, and every decision
// carries the reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNextAction, type RouterDecision } from '../bin/lib/router.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { sha256 } from '../bin/lib/verify/verification-record.js';
import { writeExportRecord } from '../bin/lib/export-record.js';
import { writeCompileManifestFixture, writeVerificationFixture, type VerificationSpec } from './lib/verification-fixture.js';
import { isolatedCliEnv } from './lib/cli-env.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

const SECTIONS = [{ n: 1, slug: 'intro' }, { n: 2, slug: 'body' }];

interface SectionSpec {
  status: string;
  draft?: string | null;
  record?: Omit<VerificationSpec, 'n' | 'slug' | 'draft'> | null;
}

/** A researched, outlined paper whose sections are as `specs` say (default: verified with a clean record). */
function paper(specs: Partial<Record<number, SectionSpec>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-router-table-'));
  const pdir = join(root, '.paper');
  mkdirSync(pdir, { recursive: true });
  writeFileSync(join(pdir, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'router-table', createdAt: new Date().toISOString(), sections: SECTIONS }));
  writeFileSync(join(pdir, 'RESEARCH.md'), '# Research\n');
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    '| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n' +
      SECTIONS.map((s) => `| ${s.n} | ${s.slug} | ${s.slug} | | 300 | a2020 |`).join('\n') + '\n',
  );
  writeFileSync(join(pdir, 'CITATIONS.bib'), '@article{a2020, title={A}, author={Doe, Jane}, year={2020}, doi={10.1000/a}}\n');
  for (const { n, slug } of SECTIONS) {
    const spec: SectionSpec = specs[n] ?? { status: 'verified' };
    const sdir = join(pdir, 'sections', `0${n}-${slug}`);
    mkdirSync(sdir, { recursive: true });
    const draft = spec.draft === undefined ? `Section ${n} rests on prior work [@a2020].\n` : spec.draft;
    if (draft !== null) writeFileSync(join(sdir, 'DRAFT.md'), draft);
    writeFileSync(
      join(sdir, 'PLAN.md'),
      `---\nsection: ${n}\nslug: ${slug}\nstatus: ${spec.status}\nassigned_sources: [a2020]\n` +
        `verified_against_draft_hash: ${draft === null ? 'null' : computeDraftHash(Buffer.from(draft), ['a2020'])}\n---\n`,
    );
    if (spec.record !== null) {
      writeVerificationFixture(sdir, { n, slug, draft: draft ?? '', assignedSources: ['a2020'], ...(spec.record ?? {}) });
    }
  }
  return root;
}

/** Compile `root` as compile would record it: .paper/DRAFT.md from the section drafts, and the manifest. */
async function compiled(root: string): Promise<string> {
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nSection 1 rests on prior work [@a2020].\n\nSection 2 rests on prior work [@a2020].\n');
  await writeCompileManifestFixture(root, SECTIONS);
  return root;
}

/** Record an export of the compiled draft as done does: FINAL.md and EXPORT.json. */
async function exported(root: string): Promise<string> {
  const { readFileSync } = await import('node:fs');
  const draft = readFileSync(join(root, '.paper', 'DRAFT.md'));
  writeFileSync(join(root, '.paper', 'FINAL.md'), draft);
  await writeExportRecord(root, {
    $schemaVersion: 1, exported_at: new Date().toISOString(), draft_sha256: sha256(draft), final_sha256: sha256(draft), format: 'md', humanized: false,
  });
  return root;
}

function pick(d: RouterDecision): Record<string, unknown> {
  const o = d as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { verb: o['verb'] };
  for (const k of ['n', 'slug', 'revise', 'force', 'reason']) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function why(d: RouterDecision): string {
  const w = (d as { why?: unknown }).why;
  assert.equal(typeof w, 'string', `every decision carries a reason; got ${JSON.stringify(d)}`);
  assert.ok((w as string).length > 0);
  return w as string;
}

// ---- failed sections ----

test('a section verify failed on a fabricated citation goes to plan --revise, naming the citation, not back to verify', async () => {
  const root = paper({ 1: { status: 'failed', record: { citations: [{ citekey: 'a2020', verdict: 'FABRICATED' }] } } });
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'plan', n: 1, slug: 'intro', revise: true });
  assert.match(why(d), /FABRICATED/);
  assert.match(why(d), /\[@a2020\]/);
});

test('a failed section whose draft changed since its verdicts (a revise was applied) goes to verify', async () => {
  const root = paper({ 1: { status: 'failed', record: { citations: [{ citekey: 'a2020', verdict: 'MIS-CITED' }] } } });
  writeFileSync(join(root, '.paper', 'sections', '01-intro', 'DRAFT.md'), 'Section 1, revised, rests on prior work [@a2020].\n');
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'verify', n: 1, slug: 'intro' });
  assert.match(why(d), /DRAFT\.md changed/);
});

test('a section failed only on a retracted work names both revising and `pensmith ack`', async () => {
  const root = paper({ 1: { status: 'failed', record: { citations: [{ citekey: 'a2020', verdict: 'RETRACTED' }] } } });
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'plan', n: 1, slug: 'intro', revise: true });
  assert.match(why(d), /RETRACTED/);
  assert.match(why(d), /pensmith ack 1 a2020 --reason/);
});

test('a section acknowledged since it failed on a retraction goes to verify', async () => {
  const root = paper({ 1: { status: 'failed', record: { citations: [{ citekey: 'a2020', verdict: 'RETRACTED' }] } } });
  writeFileSync(join(root, '.paper', 'sections', '01-intro', 'ACKNOWLEDGEMENTS.json'), '{"$schemaVersion":1,"acknowledgements":[]}\n');
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'verify', n: 1, slug: 'intro' });
  assert.match(why(d), /ACKNOWLEDGEMENTS\.json changed/);
});

test('a section that failed because its draft is placeholder text goes to write --force', async () => {
  const root = paper({
    1: { status: 'failed', record: { status: 'failed', checked: false, citations: [], reason: 'DRAFT.md is placeholder text from PENSMITH_NO_LLM, not a draft' } },
  });
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'write', n: 1, slug: 'intro', force: true });
  assert.match(why(d), /placeholder/);
});

test('a section that failed because it cites none of its sources goes to write --force', async () => {
  const draft = 'Section 1 makes a claim with no citation.\n';
  const root = paper({ 1: { status: 'failed', draft, record: { status: 'failed', citations: [], reason: 'the draft cites none of its assigned sources (a2020)' } } });
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'write', n: 1, slug: 'intro', force: true });
  assert.match(why(d), /cites none of its assigned sources/);
});

test('a section that failed only because a registry did not answer goes to verify again', async () => {
  const root = paper({ 1: { status: 'failed', record: { citations: [{ citekey: 'a2020', verdict: 'UNRESOLVED' }] } } });
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'verify', n: 1, slug: 'intro' });
  assert.match(why(d), /UNRESOLVED/);
  assert.match(why(d), /network|registry/i);
});

test('a section that failed only on a citation typed as text needs attention, with what to rewrite', async () => {
  const draft = 'Section 1 rests on prior work (Doe, 2020).\n';
  const root = paper({ 1: { status: 'failed', draft, record: { citations: [{ citekey: '(Doe, 2020)', verdict: 'RAW_CITATION' }] } } });
  const d = await resolveNextAction(root);
  assert.equal(d.verb, 'status');
  assert.equal((d as { reason?: string }).reason, 'attention');
  assert.deepEqual((d as { section?: unknown }).section, { n: 1, slug: 'intro' });
  assert.match(why(d), /RAW_CITATION/);
  assert.match(why(d), /\(Doe, 2020\)/);
  assert.match(why(d), /\[@key\]/);
});

test('a failed section with no recorded verdicts goes to verify', async () => {
  const root = paper({ 1: { status: 'failed', record: null } });
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'verify', n: 1, slug: 'intro' });
  why(d);
});

test('a verified section with no recorded verdicts goes to verify, not to a compile that would refuse it', async () => {
  const root = paper({ 2: { status: 'verified', record: null } });
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'verify', n: 2, slug: 'body' });
});

test('a verified section whose DRAFT.md is gone goes to write --force', async () => {
  const root = paper({ 1: { status: 'verified', draft: null, record: { citations: [] } } });
  const d = await resolveNextAction(root);
  assert.deepEqual(pick(d), { verb: 'write', n: 1, slug: 'intro', force: true });
});

// ---- unverifiable sections ----

test('a section unverifiable only because a quotation\'s source text cannot be read is compiled, with a warning', async () => {
  const draft = 'Doe wrote that "tidal barrages change estuary sediment over many decades" [@a2020].\n';
  const root = paper({
    1: {
      status: 'unverifiable', draft,
      record: { status: 'unverifiable', quotes: [{ citekey: 'a2020', quote: 'tidal barrages change estuary sediment over many decades', verdict: 'PDF_UNAVAILABLE' }] },
    },
  });
  const d = await resolveNextAction(root);
  assert.equal(d.verb, 'compile');
  assert.match(why(d), /section 1 .*could not be checked/i);
});

test('a section unverifiable because verify could not run (no bibliography) needs attention', async () => {
  const root = paper({ 1: { status: 'unverifiable', record: { status: 'unverifiable', checked: false, citations: [], reason: '.paper/CITATIONS.bib missing — run `pensmith research` first.' } } });
  const d = await resolveNextAction(root);
  assert.equal(d.verb, 'status');
  assert.equal((d as { reason?: string }).reason, 'attention');
  assert.match(why(d), /CITATIONS\.bib missing/);
});

// ---- compile and done ----

test('every section verified and nothing compiled: compile', async () => {
  const d = await resolveNextAction(paper());
  assert.equal(d.verb, 'compile');
  why(d);
});

test('a compiled draft not exported yet: done', async () => {
  const d = await resolveNextAction(await compiled(paper()));
  assert.equal(d.verb, 'done');
  why(d);
});

test('a compiled draft with no manifest (not from a gated compile): compile', async () => {
  const root = paper();
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nhand made\n');
  const d = await resolveNextAction(root);
  assert.equal(d.verb, 'compile');
  assert.match(why(d), /COMPILE-MANIFEST/);
});

test('a section redone and verified again after compile: compile again, not done with the stale draft', async () => {
  const root = await compiled(paper());
  const draft = 'Section 2, redone, rests on prior work [@a2020].\n';
  const sdir = join(root, '.paper', 'sections', '02-body');
  writeFileSync(join(sdir, 'DRAFT.md'), draft);
  writeVerificationFixture(sdir, { n: 2, slug: 'body', draft, assignedSources: ['a2020'] });
  const d = await resolveNextAction(root);
  assert.equal(d.verb, 'compile');
  assert.match(why(d), /section 2/);
});

test('an exported paper whose section was redone is not done: compile again', async () => {
  const root = await exported(await compiled(paper()));
  assert.deepEqual(pick(await resolveNextAction(root)), { verb: 'status', reason: 'done' });
  const draft = 'Section 1, redone, rests on prior work [@a2020].\n';
  const sdir = join(root, '.paper', 'sections', '01-intro');
  writeFileSync(join(sdir, 'DRAFT.md'), draft);
  writeVerificationFixture(sdir, { n: 1, slug: 'intro', draft, assignedSources: ['a2020'] });
  assert.equal((await resolveNextAction(root)).verb, 'compile');
});

test('a bibliography changed after compile: compile again', async () => {
  const root = await compiled(paper());
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@article{a2020, title={A}, author={Doe, Jane}, year={2021}, doi={10.1000/a}}\n');
  const d = await resolveNextAction(root);
  assert.equal(d.verb, 'compile');
  assert.match(why(d), /CITATIONS\.bib/);
});

test('a compiled draft edited by hand after compile needs attention, so compile does not overwrite the edit unasked', async () => {
  const root = await compiled(paper());
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nAn edit made after compile.\n');
  const d = await resolveNextAction(root);
  assert.equal(d.verb, 'status');
  assert.equal((d as { reason?: string }).reason, 'attention');
  assert.match(why(d), /DRAFT\.md (was )?(edited|changed) after compile/);
});

test('a FINAL.md that no export recorded does not mark the paper done', async () => {
  const root = await compiled(paper());
  writeFileSync(join(root, '.paper', 'FINAL.md'), 'left by a refused export\n');
  assert.equal((await resolveNextAction(root)).verb, 'done');
});

test('a FINAL.md exported from an earlier compile does not mark a recompiled paper done', async () => {
  const root = await exported(await compiled(paper()));
  // A recompile writes a new DRAFT.md and manifest; FINAL.md is the old export.
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nSection 1 rests on prior work [@a2020].\n\nSection 2 rests on prior work [@a2020]. Recompiled.\n');
  await writeCompileManifestFixture(root, SECTIONS);
  assert.equal((await resolveNextAction(root)).verb, 'done');
  renameSync(join(root, '.paper', 'FINAL.md'), join(root, '.paper', 'FINAL.stale.md'));
  assert.equal((await resolveNextAction(root)).verb, 'done');
});

// ---- the next step, as the CLI shows it ----

function cli(root: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd: root,
    env: isolatedCliEnv({ PENSMITH_NO_LLM: '1', ANTHROPIC_API_KEY: undefined }),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('status and a dry run show the repair step for a failed section, with the reason', () => {
  const root = paper({ 1: { status: 'failed', record: { citations: [{ citekey: 'a2020', verdict: 'FABRICATED' }] } } });
  const status = cli(root, ['status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /next: plan §1 --revise/);
  assert.match(status.stdout, /why: .*FABRICATED \[@a2020\]/);
  const dry = cli(root, ['--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /pensmith plan 1 --revise/);
});

test('a dry run names the routed command with its flags (write --force for placeholder text)', () => {
  const root = paper({
    1: { status: 'failed', record: { status: 'failed', checked: false, citations: [], reason: 'DRAFT.md is placeholder text from PENSMITH_NO_LLM, not a draft' } },
  });
  const dry = cli(root, ['--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /the next step is `pensmith write 1 --force`, because section 1 \(intro\) was not verified: DRAFT\.md is placeholder text/);
});
