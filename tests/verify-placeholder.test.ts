// tests/verify-placeholder.test.ts — VRFY-24 (D-20-21): "verified" means
// verified. A draft written with no model (PENSMITH_NO_LLM=1 or --dry-run)
// carries the stub-draft marker on its first line; outside --dry-run it is
// PLACEHOLDER (unverifiable, blocking), the other sections go on (S-13), and
// compile refuses naming `pensmith write N` with a model configured — so
// repeated `PENSMITH_NO_LLM=1 pensmith next --yolo` never exports. Under
// --dry-run the marker passes, the chain completes, and the compiled dry-run
// draft and every dry-run export carry no marker. A model's draft (the RUN-21
// mock LLM) is never marked.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { upsertSources } from '../bin/lib/library.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { STUB_DRAFT_MARKER } from '../bin/lib/verify/gate.js';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { sandbox, runCli, STACK_LINE, type Sandbox } from './helpers/paper-cli-harness.js';
import { openChainSandbox, type ChainSandbox } from './helpers/e2e-chain.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

const chains: ChainSandbox[] = [];
after(async () => {
  for (const c of chains) await c.close();
});

/** The recorded Crossref work (Pass 1 OK offline). */
const SOURCE = { citekey: 'aspelmeyer2009', doi: '10.1038/nphys1170', title: 'Measured measurement', author: 'Aspelmeyer, Markus', year: 2009 };

/** An approved outline (stub PLAN.md per section), a brief and a library: ready for bare runs. */
async function seedApproved(root: string, slugs: readonly string[], withSources = true): Promise<void> {
  const pDir = join(root, '.paper');
  mkdirSync(pDir, { recursive: true });
  writeFileSync(join(pDir, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'placeholder-test', createdAt: '2026-01-01T00:00:00.000Z', sections: slugs.map((slug, i) => ({ n: i + 1, slug })) }) + '\n');
  writeFileSync(
    join(pDir, 'INTAKE.md'),
    renderIntakeDocument({ topic: 'quantum measurement', discipline: 'other', paper_type: 'expository', length_target_words: 600 }, 'Write a 600-word essay on quantum measurement.', []),
  );
  const c = { source: 'crossref', id: SOURCE.doi, doi: SOURCE.doi, title: SOURCE.title, authors: [SOURCE.author], year: SOURCE.year, retracted: false, last_verified: '2026-01-01T00:00:00.000Z', citekey: SOURCE.citekey, raw: null } as unknown as SourceCandidate;
  await upsertSources(root, [c], { provenance: 'research' });
  const keys = withSources ? [SOURCE.citekey] : [];
  writeFileSync(
    join(pDir, 'OUTLINE.md'),
    ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', ...slugs.map((s, i) => `| ${i + 1} | ${s} | ${s} |  | 300 | ${keys.join(', ')} |`), ''].join('\n'),
  );
  slugs.forEach((slug, i) => {
    const dir = join(pDir, 'sections', `${String(i + 1).padStart(2, '0')}-${slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'PLAN.md'),
      ['---', 'schema_version: 2', `section: ${i + 1}`, `slug: ${slug}`, `title: ${slug}`, `purpose: Cover ${slug}.`, 'role: body', 'depends_on: []', 'word_target: 300', ...(keys.length > 0 ? ['assigned_sources:', ...keys.map((k) => `  - ${k}`)] : ['assigned_sources: []']), 'stub: true', 'status: planned', 'verified_against_draft_hash: null', '---', '', '## Outline entry', '', `Cover ${slug}.`, ''].join('\n'),
    );
  });
}

function sectionFile(root: string, n: number, slug: string, file: string, dir = '.paper'): string {
  return join(root, dir, 'sections', `${String(n).padStart(2, '0')}-${slug}`, file);
}

test('VRFY-24 (built CLI): repeated `PENSMITH_NO_LLM=1 pensmith next --yolo` (no --dry-run) never exports — stub drafts are PLACEHOLDER, the other sections go on, and the walk stops naming `pensmith write N` (never a compile loop); compile refuses the same way', async () => {
  const sb: Sandbox = sandbox('placeholder-chain');
  const root = sb.project('p');
  await seedApproved(root, ['introduction', 'discussion']);
  const outputs: string[] = [];
  let stopped = '';
  for (let i = 0; i < 6; i += 1) {
    const r = runCli(sb, root, ['next', '--yolo'], { env: { PENSMITH_NO_LLM: '1' } });
    outputs.push(`${r.status}: ${r.stderr.split('\n').find((l) => l.startsWith('pensmith: ran')) ?? ''} ${r.stdout.split('\n')[0] ?? ''}`);
    assert.doesNotMatch(r.stderr, STACK_LINE);
    assert.ok(!existsSync(join(root, '.paper', 'export')), `run ${i + 1} never exports:\n${outputs.join('\n')}`);
    assert.doesNotMatch(r.stderr, /ran compile/, `run ${i + 1}: no compile loop over stub text:\n${outputs.join('\n')}`);
    if (/stub text .*PLACEHOLDER.* `pensmith write 1`/.test(`${r.stdout}\n${r.stderr}`)) stopped = `${r.stdout}\n${r.stderr}`;
  }
  assert.ok(stopped !== '', `the walk stops at the stub sections naming \`pensmith write 1\`:\n${outputs.join('\n')}`);
  // An explicit compile refuses with the placeholder reason (VRFY-24).
  const c = runCli(sb, root, ['compile', '--yolo'], { env: { PENSMITH_NO_LLM: '1' } });
  const refused = c.stdout;
  for (const [n, slug] of [[1, 'introduction'], [2, 'discussion']] as const) {
    const draft = readFileSync(sectionFile(root, n, slug, 'DRAFT.md'), 'utf8');
    assert.equal(draft.split('\n')[0], STUB_DRAFT_MARKER, `§${n} is marked stub text`);
    const md = readFileSync(sectionFile(root, n, slug, 'VERIFICATION.md'), 'utf8');
    assert.match(md, /^Status: unverifiable$/m);
    assert.match(md, /^- draft: \*\*PLACEHOLDER\*\* — .*`pensmith write \d`/m);
  }
  assert.match(refused, /PLACEHOLDER — this is stub text written with no model configured .* `pensmith write 1`/, `compile refused with the placeholder reason:\n${outputs.join('\n')}`);
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), 'no compiled draft');
  // `status` names what the unverifiable sections need.
  const st = runCli(sb, root, ['status']);
  assert.match(st.stdout, /unverifiable .*stub text .*`pensmith write 1`/);
});

test('VRFY-24 (built CLI): with --dry-run the chain completes; the compiled dry-run draft and the dry-run export carry no stub marker', async () => {
  const sb: Sandbox = sandbox('placeholder-dry');
  const root = sb.project('p');
  // No assigned source: a real citation is unverifiable under --dry-run (by design), so the preview
  // exercises the stub marker alone.
  await seedApproved(root, ['introduction'], false);
  const r = runCli(sb, root, ['--dry-run', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  const ws = join(root, '.paper-dry-run');
  assert.equal(readFileSync(sectionFile(root, 1, 'introduction', 'DRAFT.md', '.paper-dry-run'), 'utf8').split('\n')[0], STUB_DRAFT_MARKER, 'the section draft is marked');
  assert.match(readFileSync(sectionFile(root, 1, 'introduction', 'VERIFICATION.md', '.paper-dry-run'), 'utf8'), /^Status: verified$/m, 'the marker passes under --dry-run');
  const compiled = readFileSync(join(ws, 'DRAFT.md'), 'utf8');
  assert.ok(!compiled.includes(STUB_DRAFT_MARKER), 'the compiled dry-run draft has no marker');
  for (const f of readdirSync(join(ws, 'export'))) {
    const bytes = readFileSync(join(ws, 'export', f));
    assert.ok(!bytes.includes(Buffer.from('stub draft (no model configured)')), `${f} carries no marker`);
  }
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), 'the real paper was not touched');
});

test('VRFY-24 (built CLI, mock LLM): a model\'s draft is never marked and verifies — the placeholder rule catches stub text only', async () => {
  const cs = await openChainSandbox({ prefix: 'placeholder-mock' });
  chains.push(cs);
  await seedApproved(cs.root, ['introduction']);
  const r = await cs.run(['--yolo']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  const draft = readFileSync(sectionFile(cs.root, 1, 'introduction', 'DRAFT.md'), 'utf8');
  assert.ok(!draft.includes(STUB_DRAFT_MARKER), 'no marker on a model draft');
  const md = readFileSync(sectionFile(cs.root, 1, 'introduction', 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: verified$/m);
  assert.doesNotMatch(md, /PLACEHOLDER/);
  void EXIT_BLOCKED;
});
