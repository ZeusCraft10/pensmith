// tests/revise-citation-forms.test.ts — revise repairs what compile blocks.
//
// revise found the failing citation with a lowercase-only row regex, so a
// FABRICATED `Vaswani2017` blocked compile while `plan --revise` said there was
// nothing to fix. It patched only an exact `[@key]` token, so for `[@k, p. 5]`
// or `[@a; @k]` the model got '(token not found)' as context and `remove`
// changed nothing yet reported success and reset the hash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRevise, type ReviseSwapVars } from '../bin/lib/revise.js';

const PLAN = [
  '---', 'section: 1', 'slug: intro', 'title: Intro', 'depends_on: []',
  'assigned_sources:', '  - smith2020', '  - jones2019',
  "verified_against_draft_hash: 'deadbeefcafe'", 'status: failed', '---', '', '## Brief', '',
].join('\n');

function seed(draft: string, rows: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-revise-forms-'));
  const dir = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DRAFT.md'), draft);
  writeFileSync(join(dir, 'PLAN.md'), PLAN);
  writeFileSync(join(dir, 'VERIFICATION.md'), ['# VERIFICATION (Section 1, intro)', '', 'Status: failed', '', '## Pass-1', '', ...rows, ''].join('\n'));
  return root;
}

const draftOf = (root: string): string => readFileSync(join(root, '.paper', 'sections', '01-intro', 'DRAFT.md'), 'utf8');
const planOf = (root: string): string => readFileSync(join(root, '.paper', 'sections', '01-intro', 'PLAN.md'), 'utf8');
const row = (key: string, verdict = 'FABRICATED'): string => `- ${key}: **${verdict}** — titleJW=0.00, authorJW=0.00 — not in bib`;

function proposal(action: 'swap' | 'remove', flagged: string, replacement: string | null): string {
  return JSON.stringify({
    action, flagged_citekey: flagged, replacement_citekey: replacement, rationale: 'fix',
    patch: { before_excerpt: 'b', after_excerpt: 'a' },
  });
}

async function revise(root: string, raw: string): Promise<{ res: Awaited<ReturnType<typeof runRevise>>; vars: ReviseSwapVars[] }> {
  const vars: ReviseSwapVars[] = [];
  const res = await runRevise({
    paperRoot: root, n: 1, slug: 'intro', yolo: false,
    proposeSwap: (v) => { vars.push(v); return Promise.resolve(raw); },
    approve: () => Promise.resolve(true),
  });
  return { res, vars };
}

test('revise: an uppercase FABRICATED key is found and swapped, keeping its locator', async () => {
  const root = seed('Attention suffices [@Vaswani2017, p. 2].\n', [row('Vaswani2017')]);
  const { res, vars } = await revise(root, proposal('swap', 'Vaswani2017', 'smith2020'));
  assert.equal(res.flagged_citekey, 'Vaswani2017');
  assert.equal(res.accepted, true, res.message);
  assert.equal(vars[0]!.claim_context, 'Attention suffices [@Vaswani2017, p. 2].', 'the model sees the citing sentence');
  assert.equal(draftOf(root), 'Attention suffices [@smith2020, p. 2].\n');
  assert.match(planOf(root), /verified_against_draft_hash:\s*(null|~)\s*$/m);
});

test('revise: a key in a multi-cite cluster is swapped or removed inside the cluster', async () => {
  const draft = 'Two works agree [see @jones2019; @ghost2099, ch. 3].\n';
  const swapped = await revise(seed(draft, [row('ghost2099')]), proposal('swap', 'ghost2099', 'smith2020'));
  assert.equal(swapped.res.accepted, true, swapped.res.message);

  const root = seed(draft, [row('ghost2099')]);
  const removed = await revise(root, proposal('remove', 'ghost2099', null));
  assert.equal(removed.res.accepted, true, removed.res.message);
  assert.equal(draftOf(root), 'Two works agree [see @jones2019].\n');
});

test('revise: swapping a key in narrative and suppress-author form', async () => {
  const root = seed('As @ghost2099 [p. 4] argued, it holds [-@ghost2099].\n', [row('ghost2099')]);
  const { res } = await revise(root, proposal('swap', 'ghost2099', 'jones2019'));
  assert.equal(res.accepted, true, res.message);
  assert.equal(draftOf(root), 'As @jones2019 [p. 4] argued, it holds [-@jones2019].\n');
});

test('revise: removing a narrative citation is refused, since it would leave a broken sentence', async () => {
  const draft = 'As @ghost2099 argued, it holds.\n';
  const root = seed(draft, [row('ghost2099')]);
  const { res } = await revise(root, proposal('remove', 'ghost2099', null));
  assert.equal(res.accepted, false);
  assert.match(res.message + (res.rejectedReason ?? ''), /narrative|running text/);
  assert.equal(draftOf(root), draft);
});

test('revise: a patch that changes nothing is not reported as applied, and the hash stays', async () => {
  const draft = 'The draft no longer cites the flagged work [@smith2020].\n';
  const root = seed(draft, [row('ghost2099')]);
  const { res } = await revise(root, proposal('remove', 'ghost2099', null));
  assert.equal(res.accepted, false, res.message);
  assert.match(res.message, /changed nothing|not found/i);
  assert.equal(draftOf(root), draft);
  assert.match(planOf(root), /verified_against_draft_hash: '?deadbeefcafe'?/);
});

test('revise: swapping a key for itself is rejected', async () => {
  const root = seed('It holds [@jones2019].\n', [row('jones2019', 'MIS-CITED')]);
  const { res } = await revise(root, proposal('swap', 'jones2019', 'jones2019'));
  assert.equal(res.accepted, false);
  assert.match(res.rejectedReason ?? '', /itself|same/);
});

test('revise: blocking verdicts it cannot repair are named, not reported as nothing to fix', async () => {
  const root = seed('Typed (Smith, 2020) instead of a citation.\n', [row('(Smith, 2020)', 'RAW_CITATION')]);
  const { res, vars } = await revise(root, proposal('remove', 'x', null));
  assert.equal(vars.length, 0, 'no model call for a verdict revise cannot repair');
  assert.equal(res.accepted, false);
  assert.doesNotMatch(res.message, /No FABRICATED/);
  assert.match(res.message, /RAW_CITATION/);
  assert.match(res.message, /\(Smith, 2020\)/);
});
