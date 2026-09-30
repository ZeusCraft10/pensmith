// tests/plan-research-cli.test.ts — `pensmith plan 2 --research "<query>"`
// through the BUILT CLI on recorded sources (19-PLAN §7.4; GRND-17, D-19-18).
//
// A three-section psychology paper; section 2 is "Social media and
// depression". Under the test runner the section pass's two queries — the
// user's query, and the query joined to the section title — are answered by
// the real Crossref and PubMed recordings (tests/fixtures/cassettes/*/
// search-plan-research-*.json); the other adapters report `offline: no
// recorded fixture`. PENSMITH_NO_LLM: the evaluator's stub keeps every hit.
//
//   - `--yolo` reports > 0 hits; LIBRARY.json gains them with no duplicate DOI;
//     sections/02-*/PLAN.md `assigned_sources` includes them; every file of
//     sections/01-* and sections/03-* is byte-identical (sha256) and keeps its
//     mtime; RESEARCH.md's prior content is kept; the section's RESEARCH-LOG.md
//     records the run.
//   - Without a terminal and without --yolo: exit 3 before any file changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sandbox,
  runCli,
  writeState,
  writeOutline,
  writePlan,
  sectionDirOf,
  snapshot,
  changedPaths,
  STACK_LINE,
} from './helpers/paper-cli-harness.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { RESEARCH_LOG_END } from '../bin/lib/research-md.js';

const QUERY = 'instagram adolescent depression longitudinal';
const SECTIONS = [
  { n: 1, slug: 'introduction', title: 'Introduction' },
  { n: 2, slug: 'social-media', title: 'Social media and depression' },
  { n: 3, slug: 'discussion', title: 'Discussion' },
];

function seedPaper(root: string): void {
  writeState(root, SECTIONS.map(({ n, slug }) => ({ n, slug })), 'plan-research-cli');
  writeOutline(root, SECTIONS.map(({ n, slug }) => ({ n, slug })));
  for (const s of SECTIONS) writePlan(root, s.n, s.slug, { title: s.title, assigned_sources: '[]' });
  writeFileSync(join(sectionDirOf(root, 1, 'introduction'), 'DRAFT.md'), '# Introduction\n\nA draft that must not change.\n');
  writeFileSync(
    join(root, '.paper', 'INTAKE.md'),
    renderIntakeDocument(
      { topic: 'social media use and adolescent depression', discipline: 'psychology', paper_type: 'literature-review' },
      'Write a literature review on social media use and adolescent depression.',
      [],
    ),
  );
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), `# Research log\n\nEarlier research.\n\n${RESEARCH_LOG_END}\n\nMy own notes about the scope.\n`);
}

function sha(root: string, n: number, slug: string): Map<string, string> {
  return snapshot(sectionDirOf(root, n, slug));
}

function mtimes(root: string, n: number, slug: string): number[] {
  const dir = sectionDirOf(root, n, slug);
  return ['PLAN.md', ...(n === 1 ? ['DRAFT.md'] : [])].map((f) => statSync(join(dir, f)).mtimeMs);
}

test('GRND-17 (built CLI, recorded sources): `plan 2 --research … --yolo` adds real hits to §2 only', () => {
  const sb = sandbox('plan-research-cli');
  const root = sb.project('paper');
  seedPaper(root);
  const s1 = sha(root, 1, 'introduction');
  const s3 = sha(root, 3, 'discussion');
  const m1 = mtimes(root, 1, 'introduction');
  const m3 = mtimes(root, 3, 'discussion');

  const r = runCli(sb, root, ['plan', '2', '--research', QUERY, '--yolo'], { timeoutMs: 180_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.match(r.stdout, /^pensmith plan --research: section 2 "Social media and depression" — 2 queries$/m);
  assert.match(r.stdout, /^ {2}crossref +\d+ {2}ok/m);
  assert.match(r.stdout, /^ {2}pubmed +\d+ {2}ok/m);
  const added = /^pensmith plan --research: added (\d+) source\(s\) to section 2's assigned_sources \((\d+) new to LIBRARY\.json/m.exec(r.stdout);
  assert.ok(added, r.stdout);
  assert.ok(Number(added[1]) > 0, 'hits were added to §2');

  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ citekey: string; doi: string | null; provenance: string[] }> };
  assert.ok(lib.entries.length > 0);
  const dois = lib.entries.map((e) => e.doi).filter((d): d is string => d !== null);
  assert.equal(new Set(dois).size, dois.length, 'no duplicate DOI');
  for (const e of lib.entries) assert.ok(e.provenance.some((p) => p.startsWith('plan-research:§2')), `${e.citekey} is tagged plan-research:§2`);

  const plan2 = readFileSync(join(sectionDirOf(root, 2, 'social-media'), 'PLAN.md'), 'utf8');
  for (const e of lib.entries) assert.ok(plan2.includes(e.citekey), `§2 assigned_sources includes ${e.citekey}`);
  assert.match(plan2, /^status: planned$/m, 'the section status is untouched');

  // Section-as-phase: §1 and §3 are byte-identical with their mtimes kept.
  assert.deepEqual(changedPaths(s1, sha(root, 1, 'introduction')), [], '§1 unchanged');
  assert.deepEqual(changedPaths(s3, sha(root, 3, 'discussion')), [], '§3 unchanged');
  assert.deepEqual(mtimes(root, 1, 'introduction'), m1);
  assert.deepEqual(mtimes(root, 3, 'discussion'), m3);

  const md = readFileSync(join(root, '.paper', 'RESEARCH.md'), 'utf8');
  assert.match(md, /Earlier research\./, 'the prior research log is kept');
  assert.ok(md.endsWith('My own notes about the scope.\n'), 'the notes below the end line are kept');
  assert.match(md, new RegExp(`\\[@${lib.entries[0]!.citekey}\\]`), 'the sources block lists the new sources');
  const log = readFileSync(join(sectionDirOf(root, 2, 'social-media'), 'RESEARCH-LOG.md'), 'utf8');
  assert.match(log, new RegExp(`^## .* — "${QUERY}"$`, 'm'));
  assert.match(log, /^- Added to this section's assigned_sources: \S/m);
});

test('GRND-17 (built CLI): without a terminal and without --yolo, exit 3 before any file changes', () => {
  const sb = sandbox('plan-research-cli-refuse');
  const root = sb.project('paper');
  seedPaper(root);
  const before = snapshot(root);
  const r = runCli(sb, root, ['plan', '2', '--research', QUERY]);
  assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /needs an answer: re-run in a terminal, or pass --yolo/);
  assert.deepEqual(changedPaths(before, snapshot(root), /(?:^|[\\/])SESSION\.log$/), [], 'nothing changed');
});
