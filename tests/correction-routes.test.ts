// tests/correction-routes.test.ts — the PRD §5.6 correction routes the
// pensmith skill gives (plugin/skills/pensmith/SKILL.md, "What the user says →
// verb") work through the real CLI (review round 2, D-23a-10: the skill
// describes what exists, truthfully).
//
// On a paper the built CLI made (new → research → outline → plan/write §2,
// with the stub LLM and recorded sources):
//   - `plan N --revise` on a section with no flagged citation changes nothing —
//     which is why the skill never routes a length or source change there;
//   - length: edit OUTLINE.md's word target, `outline` (no model call), `plan N`,
//     `write N` → the plan carries the new target, the draft follows it, and
//     no other section changes;
//   - source: `add --remap <citekey> --section N` makes the source available to
//     section N and the next `plan N` may use it;
//   - add a section: a lettered row (`2a`) registers `02a-<slug>` with its stub
//     PLAN.md; a row that renumbers an existing section is refused and nothing
//     changes.
//
// Spawns dist/bin/pensmith.js — run `npm run build` first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedPaths, runCli, sandbox, snapshot, type Sandbox } from './helpers/paper-cli-harness.js';

const ASSIGNMENT = 'Write a 1500-word literature review on attention mechanisms in neural networks, APA style.\n';

interface Row {
  line: string;
  cells: string[];
}

function outlinePath(root: string): string {
  return join(root, '.paper', 'OUTLINE.md');
}

/** The OUTLINE.md table rows (8-column canonical form), with their cells. */
function outlineRows(root: string): Row[] {
  return readFileSync(outlinePath(root), 'utf8')
    .split('\n')
    .filter((l) => /^\| [0-9]/.test(l))
    .map((line) => ({ line, cells: line.split('|').slice(1, -1).map((c) => c.trim()) }));
}

function planFrontmatter(root: string, dir: string): string {
  const text = readFileSync(join(root, '.paper', 'sections', dir, 'PLAN.md'), 'utf8');
  return /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
}

function assignedSources(root: string, dir: string): string[] {
  const block = /assigned_sources:\n((?: {2}- .*\n?)*)/.exec(planFrontmatter(root, dir) + '\n')?.[1] ?? '';
  return block.split('\n').map((l) => l.replace(/^ {2}- /, '').trim()).filter(Boolean);
}

function words(file: string): number {
  return readFileSync(file, 'utf8').split(/\s+/).filter(Boolean).length;
}

function cli(sb: Sandbox, root: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  return runCli(sb, root, args, { timeoutMs: 120_000 });
}

test('§5.6 correction routes of the pensmith skill work through the CLI (length, source, a new section; --revise is not one of them)', { timeout: 600_000 }, () => {
  const sb = sandbox('correction-routes');
  const root = sb.project('paper');
  writeFileSync(join(root, 'assignment.txt'), ASSIGNMENT);
  for (const step of [['new', '--from', 'assignment.txt', '--yolo'], ['research', '--yolo'], ['outline', '--yolo']]) {
    const r = cli(sb, root, ...step);
    assert.equal(r.status, 0, `pensmith ${step.join(' ')}:\n${r.stdout}\n${r.stderr}`);
  }
  const rows = outlineRows(root);
  assert.ok(rows.length >= 3, `a paper with at least three sections: ${rows.map((r) => r.line).join('\n')}`);
  const [first, second] = [rows[0]!, rows[1]!];
  const dirOf = (row: Row): string => `${row.cells[0]!.replace(/^(\d+)/, (d) => d.padStart(2, '0'))}-${row.cells[1]}`;
  const secondDir = dirOf(second);
  // Plan and write §2 (write verifies; offline, its sources are unverifiable — exit 4 — but the draft is written).
  assert.equal(cli(sb, root, 'plan', '2', '--yolo').status, 0);
  cli(sb, root, 'write', '2', '--yolo');
  const firstDraftWords = words(join(root, '.paper', 'sections', secondDir, 'DRAFT.md'));

  // `plan 2 --revise` on a section with no FABRICATED / MIS-CITED / NOT_FOUND row changes nothing.
  const before = snapshot(join(root, '.paper'));
  const revise = cli(sb, root, 'plan', '2', '--revise', '--yolo');
  assert.equal(revise.status, 0, revise.stderr);
  assert.match(revise.stdout, /No FABRICATED\/MIS-CITED\/NOT_FOUND citation in section 2\./);
  assert.deepEqual(changedPaths(before, snapshot(join(root, '.paper')), /^(SESSION\.log|COSTS\.jsonl|sessions)/), [], '--revise left the paper as it was');

  // Length: the word target column, then outline (applies, no model call), plan 2, write 2.
  const oldTarget = Number(second.cells[5]);
  const newTarget = Math.max(150, Math.round(oldTarget / 2));
  assert.ok(newTarget < oldTarget, `a shorter target (${oldTarget} → ${newTarget})`);
  const others = rows.filter((r) => r !== second).map(dirOf);
  const othersBefore = new Map(others.map((d) => [d, snapshot(join(root, '.paper', 'sections', d))]));
  const edited = [...second.cells];
  edited[5] = String(newTarget);
  writeFileSync(outlinePath(root), readFileSync(outlinePath(root), 'utf8').replace(second.line, `| ${edited.join(' | ')} |`));
  const apply = cli(sb, root, 'outline');
  assert.equal(apply.status, 0, `outline applies the edited table:\n${apply.stdout}\n${apply.stderr}`);
  assert.match(apply.stdout, /Not regenerating/, 'the edit is applied as written, without a model re-outline');
  assert.equal(cli(sb, root, 'plan', '2', '--yolo').status, 0);
  assert.match(planFrontmatter(root, secondDir), new RegExp(`^word_target: ${newTarget}$`, 'm'), 'the new plan carries the new target');
  cli(sb, root, 'write', '2', '--yolo');
  const draftWords = words(join(root, '.paper', 'sections', secondDir, 'DRAFT.md'));
  assert.ok(draftWords < firstDraftWords, `the redraft is shorter (${firstDraftWords} → ${draftWords} words)`);
  assert.ok(Math.abs(draftWords - newTarget) <= newTarget * 0.35, `the redraft follows the new target (${draftWords} words for ${newTarget})`);
  for (const d of others) {
    assert.deepEqual(changedPaths(othersBefore.get(d)!, snapshot(join(root, '.paper', 'sections', d))), [], `section ${d} is untouched`);
  }

  // Source: a library source not allocated to §1 becomes available to it; the next plan may use it.
  const firstDir = dirOf(first);
  const firstSources = new Set(first.cells[6]!.split(',').map((s) => s.trim()).filter(Boolean));
  const candidate = second.cells[6]!.split(',').map((s) => s.trim()).find((k) => k && !firstSources.has(k));
  assert.ok(candidate, 'a source allocated to §2 but not §1');
  assert.equal(cli(sb, root, 'plan', '1', '--yolo').status, 0);
  assert.ok(!assignedSources(root, firstDir).includes(candidate), `${candidate} is not §1's before the add`);
  const add = cli(sb, root, 'add', '--remap', candidate, '--section', '1');
  assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);
  assert.match(add.stdout, new RegExp(`${candidate} mapped to §1`));
  assert.ok(assignedSources(root, firstDir).includes(candidate), 'mapped into §1\'s PLAN.md');
  assert.equal(cli(sb, root, 'plan', '1', '--yolo').status, 0);
  assert.ok(assignedSources(root, firstDir).includes(candidate), 'the re-plan may use it (the stub planner takes the whole allowed set)');

  // A new section: a lettered row after §2 registers 02a-<slug>; a row that
  // renumbers the sections after it is refused and nothing changes.
  const table = readFileSync(outlinePath(root), 'utf8');
  const current = outlineRows(root);
  const at = current.findIndex((r) => r.cells[1] === second.cells[1]);
  const render = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  const newRow = (id: string): string => render([id, 'counterexamples', 'Counterexamples', 'body', second.cells[1]!, '300', candidate, '']);
  let renumbered = table;
  for (const r of current.slice(at + 1)) {
    const n = Number(r.cells[0]);
    if (Number.isInteger(n)) renumbered = renumbered.replace(r.line, render([String(n + 1), ...r.cells.slice(1)]));
  }
  renumbered = renumbered.replace(current[at]!.line, `${current[at]!.line}\n${newRow(String(Number(second.cells[0]) + 1))}`);
  const beforeRefusal = snapshot(join(root, '.paper'));
  writeFileSync(outlinePath(root), renumbered);
  const refused = cli(sb, root, 'outline');
  assert.equal(refused.status, 1, `a renumbered section is refused:\n${refused.stdout}\n${refused.stderr}`);
  assert.match(refused.stderr, /renumbers .* nothing was changed/);
  assert.deepEqual(
    changedPaths(beforeRefusal, snapshot(join(root, '.paper')), /^(SESSION\.log|COSTS\.jsonl|sessions|OUTLINE\.md)/),
    [],
    'nothing but the hand-edited OUTLINE.md differs',
  );
  writeFileSync(outlinePath(root), table.replace(current[at]!.line, `${current[at]!.line}\n${newRow(`${second.cells[0]}a`)}`));
  const applied = cli(sb, root, 'outline');
  assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
  assert.match(readFileSync(join(root, '.paper', 'sections', '02a-counterexamples', 'PLAN.md'), 'utf8'), /^stub: true$/m, 'the new section gets its stub plan');
  assert.match(cli(sb, root, 'status').stdout, /2a counterexamples: outlined/);
});
