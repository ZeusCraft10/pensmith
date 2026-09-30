// tests/bare-chain.test.ts — GRND-18 (D-18-28): one bare `pensmith`, `next`
// or `resume` invocation completes ONE step of the paper, and a section's step
// is plan → write → verify.
//
// Each case seeds a paper whose outline is approved (two stub sections, a
// library with a recorded source) and runs the BUILT CLI against the RUN-21
// mock LLM (tests/helpers/e2e-chain.ts): sources are offline, so Pass 1 replays
// the recorded Crossref / Retraction Watch fixtures of 10.1038/nphys1170.
//   - one bare `pensmith --yolo` makes exactly one section-planner and one
//     section-drafter call, writes PLAN.md, DRAFT.md and VERIFICATION.md for §1,
//     verifies §1, and prints `pensmith: ran …; next: plan §2`;
//   - `next --yolo` then does the same for §2 (next: compile), and `resume
//     --yolo` on a fresh copy does the same for §1;
//   - the exit code is the last verb's: a verify that blocks (a cited source
//     with no recorded fixture is UNVERIFIABLE offline) ends the step with 4,
//     and the chain stops there;
//   - `plan` typed without a number keeps its single-verb behaviour (it never
//     runs the chain).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openChainSandbox, type ChainSandbox } from './helpers/e2e-chain.js';
import { upsertSources } from '../bin/lib/library.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

const sandboxes: ChainSandbox[] = [];
after(async () => {
  for (const sb of sandboxes) await sb.close();
});

async function sandbox(prefix: string): Promise<ChainSandbox> {
  const sb = await openChainSandbox({ prefix });
  sandboxes.push(sb);
  return sb;
}

interface Src {
  citekey: string;
  doi: string;
  title: string;
  author: string;
  year: number;
}

/** The recorded Crossref work (tests/fixtures/cassettes/crossref/works-nphys1170.json): Pass 1 OK offline. */
const RECORDED: Src = { citekey: 'aspelmeyer2009', doi: '10.1038/nphys1170', title: 'Measured measurement', author: 'Aspelmeyer, Markus', year: 2009 };
/** A DOI with no recorded fixture: Pass 1 is UNVERIFIABLE offline (blocking). */
const UNRECORDED: Src = { citekey: 'nofixture2020', doi: '10.5555/pensmith-no-fixture', title: 'A Study Nobody Recorded', author: 'Nobody, Nora', year: 2020 };

function candidate(s: Src): SourceCandidate {
  return {
    source: 'crossref',
    id: s.doi,
    doi: s.doi,
    title: s.title,
    authors: [s.author],
    year: s.year,
    retracted: false,
    last_verified: '2026-01-01T00:00:00.000Z',
    citekey: s.citekey,
    raw: null,
  } as SourceCandidate;
}

/**
 * An approved outline: STATE.json with the sections, a v1 INTAKE.md brief, the
 * library (through the one library writer), OUTLINE.md and a stub PLAN.md per
 * section (what outline approval writes, D-18-17).
 */
async function seedPaper(root: string, sections: Array<{ n: number; slug: string; title: string; source: Src }>): Promise<void> {
  const pDir = join(root, '.paper');
  mkdirSync(pDir, { recursive: true });
  writeFileSync(
    join(pDir, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'bare-chain-test', createdAt: '2026-01-01T00:00:00.000Z', sections: sections.map(({ n, slug }) => ({ n, slug })) }, null, 2) + '\n',
  );
  writeFileSync(
    join(pDir, 'INTAKE.md'),
    renderIntakeDocument(
      { topic: 'quantum measurement', discipline: 'other', paper_type: 'expository', length_target_words: 600 },
      'Write a 600-word essay on quantum measurement.',
      [],
    ),
  );
  await upsertSources(root, [...new Set(sections.map((s) => s.source))].map(candidate), { provenance: 'research' });
  writeFileSync(
    join(pDir, 'OUTLINE.md'),
    [
      '# Outline',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      ...sections.map((s) => `| ${s.n} | ${s.slug} | ${s.title} |  | 300 | ${s.source.citekey} |`),
      '',
    ].join('\n'),
  );
  for (const s of sections) {
    const dir = join(pDir, 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'PLAN.md'),
      [
        '---',
        'schema_version: 2',
        `section: ${s.n}`,
        `slug: ${s.slug}`,
        `title: ${s.title}`,
        `purpose: Cover ${s.title.toLowerCase()}.`,
        'role: body',
        'depends_on: []',
        'word_target: 300',
        'assigned_sources:',
        `  - ${s.source.citekey}`,
        'stub: true',
        'status: planned',
        'verified_against_draft_hash: null',
        '---',
        '',
        '## Outline entry',
        '',
        `Cover ${s.title.toLowerCase()}.`,
        '',
      ].join('\n'),
    );
  }
}

const TWO_SECTIONS = [
  { n: 1, slug: 'introduction', title: 'Introduction', source: RECORDED },
  { n: 2, slug: 'discussion', title: 'Discussion', source: RECORDED },
];

function sectionFile(root: string, n: number, slug: string, file: string): string {
  return join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`, file);
}

function statusOf(root: string, n: number, slug: string): string {
  const { frontmatter } = loadFrontmatterDocSync('plan', sectionFile(root, n, slug, 'PLAN.md'));
  return String((frontmatter as { status?: unknown }).status);
}

/** The step line: the section's verbs (write may already verify — then no separate verify step). */
function stepLine(n: number, next: string): RegExp {
  return new RegExp(`^pensmith: ran plan §${n}, write §${n}(, verify §${n})?; next: ${next}$`, 'm');
}

test('GRND-18: one bare `pensmith --yolo` plans, writes and verifies the next section — one planner and one drafter call — and names the next step', async () => {
  const sb = await sandbox('bare-chain');
  await seedPaper(sb.root, TWO_SECTIONS);

  const r = await sb.run(['--yolo']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.equal(sb.calls('section-planner'), 1, 'one planner call');
  assert.equal(sb.calls('section-drafter'), 1, 'one drafter call');
  assert.ok(existsSync(sectionFile(sb.root, 1, 'introduction', 'DRAFT.md')), '§1 drafted');
  assert.ok(existsSync(sectionFile(sb.root, 1, 'introduction', 'VERIFICATION.md')), '§1 verified in the same invocation');
  assert.equal(statusOf(sb.root, 1, 'introduction'), 'verified');
  assert.match(r.stderr, stepLine(1, 'plan §2'));
  assert.ok(!existsSync(sectionFile(sb.root, 2, 'discussion', 'DRAFT.md')), 'one step: §2 is untouched');
  assert.equal(sb.calls('outline-author') + sb.calls('intake-clarifier') + sb.calls('topic-disambiguator'), 0, 'no other step ran');

  // `next --yolo` takes the following step the same way.
  const next = await sb.run(['next', '--yolo']);
  assert.equal(next.status, EXIT_OK, `${next.stdout}\n${next.stderr}`);
  assert.match(next.stderr, /^pensmith next: → plan$/m);
  assert.match(next.stderr, stepLine(2, 'compile'));
  assert.equal(sb.calls('section-planner'), 2);
  assert.equal(sb.calls('section-drafter'), 2);
  assert.equal(statusOf(sb.root, 2, 'discussion'), 'verified');

  // Non-section steps are one verb each: compile, then done (export gate skipped by --yolo).
  const compile = await sb.run(['--yolo']);
  assert.equal(compile.status, EXIT_OK, `${compile.stdout}\n${compile.stderr}`);
  assert.match(compile.stderr, /^pensmith: ran compile; next: done$/m);
  const done = await sb.run(['--yolo']);
  assert.equal(done.status, EXIT_OK, `${done.stdout}\n${done.stderr}`);
  assert.match(done.stderr, /^pensmith: ran done; next: status \(done\)$/m);
  assert.ok(existsSync(join(sb.root, '.paper', 'FINAL.md')));
  const finished = await sb.run([]);
  assert.equal(finished.status, EXIT_OK, `${finished.stdout}\n${finished.stderr}`);
  assert.match(finished.stderr, /^pensmith: ran status \(done\); next: status \(done\)$/m);
});

test('GRND-18: `resume --yolo` runs the same one step (plan → write → verify) as bare `pensmith`', async () => {
  const sb = await sandbox('resume-chain');
  await seedPaper(sb.root, TWO_SECTIONS);
  const r = await sb.run(['resume', '--yolo']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith resume: → plan$/m);
  assert.match(r.stderr, stepLine(1, 'plan §2'));
  assert.equal(sb.calls('section-planner'), 1);
  assert.equal(sb.calls('section-drafter'), 1);
  assert.equal(statusOf(sb.root, 1, 'introduction'), 'verified');
  assert.ok(!existsSync(sectionFile(sb.root, 2, 'discussion', 'DRAFT.md')));
});

test('GRND-18: the step exits with the last verb\'s code — a blocking verify ends it with 4 and nothing runs after it', async () => {
  const sb = await sandbox('bare-chain-blocked');
  await seedPaper(sb.root, [
    { n: 1, slug: 'introduction', title: 'Introduction', source: UNRECORDED },
    { n: 2, slug: 'discussion', title: 'Discussion', source: RECORDED },
  ]);
  // The drafter cites its (assigned) source, whose DOI has no recorded fixture:
  // Pass 1 is UNVERIFIABLE offline — blocking.
  sb.mock.script('section-drafter', { text: `# Introduction\n\nMeasurement shapes what is observed [@${UNRECORDED.citekey}].\n` });
  const r = await sb.run(['--yolo']);
  assert.equal(r.status, EXIT_BLOCKED, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: ran plan §1, write §1(, verify §1)? \(exit 4\); next: /m, 'the failing verb is named with its code');
  assert.match(readFileSync(sectionFile(sb.root, 1, 'introduction', 'VERIFICATION.md'), 'utf8'), /UNVERIFIABLE/);
  assert.equal(sb.calls('section-planner'), 1, '§2 was not planned');
  assert.ok(!existsSync(sectionFile(sb.root, 2, 'discussion', 'DRAFT.md')));

  // Review round 3 (D-18-43): the verdict judged THIS draft and a blocking
  // UNVERIFIABLE row stays until the source can be reached — next and resume
  // report attention naming the re-run instead of re-billing the verify on
  // every bare run; an explicit `verify 1` still re-checks it (exit 4 offline).
  const before = sb.mock.requests.length;
  for (const verb of ['next', 'resume']) {
    const r2 = await sb.run([verb, '--yolo']);
    assert.equal(r2.status, EXIT_OK, `${r2.stdout}\n${r2.stderr}`);
    assert.match(r2.stdout, /attention: section 1 could not be verified: citation \[@nofixture2020\] is UNVERIFIABLE .*`pensmith verify 1`/);
  }
  assert.equal(sb.mock.requests.length, before, 'no model call: the unchanged draft is not re-verified');
  const verify = await sb.run(['verify', '1', '--yolo']);
  assert.equal(verify.status, EXIT_BLOCKED, `${verify.stdout}\n${verify.stderr}`);
});

test('review round 3 (D-18-43): a section left `unverifiable` by advisory rows only (its quoted source has no full text) is verified ONCE; the chain moves on', async () => {
  const sb = await sandbox('bare-chain-advisory');
  await seedPaper(sb.root, TWO_SECTIONS);
  // GRND-14 (Phase 18/19 merge): the drafter may keep a direct quote only from a
  // source whose full text Pass 3 can check — here an open-access PDF recorded
  // for its DOI (`oa_url`, what research's Unpaywall enrichment writes).
  const libPath = join(sb.root, '.paper', 'LIBRARY.json');
  const lib = JSON.parse(readFileSync(libPath, 'utf8')) as { entries: Array<Record<string, unknown>> };
  for (const e of lib.entries) if (e['citekey'] === RECORDED.citekey) e['oa_url'] = 'https://example.org/aspelmeyer2009.pdf';
  writeFileSync(libPath, `${JSON.stringify(lib, null, 2)}\n`);
  // A direct quote: Pass 3 cannot fetch the source's text offline — PDF/TEXT_UNAVAILABLE, advisory (Pitfall 3).
  sb.mock.script('section-drafter', {
    text: `# Introduction\n\nAs the authors put it, "measurement always shapes what is observed in these systems, whatever the apparatus and whatever the observer happens to intend" [@${RECORDED.citekey}].\n`,
  });
  const r = await sb.run(['--yolo']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  const verification = readFileSync(sectionFile(sb.root, 1, 'introduction', 'VERIFICATION.md'), 'utf8');
  assert.match(verification, /^Status: unverifiable$/m);
  assert.match(verification, /\*\*(?:PDF|TEXT)_UNAVAILABLE\*\*/);
  assert.doesNotMatch(verification, /\*\*UNVERIFIABLE\*\*/, 'no blocking row');
  assert.match(r.stderr, /^pensmith: ran plan §1, write §1; next: plan §2$/m, 'write verified §1 once; the chain does not verify it again');
  const calls = sb.mock.requests.length;
  const next = await sb.run(['next', '--yolo']);
  assert.equal(next.status, EXIT_OK, `${next.stdout}\n${next.stderr}`);
  assert.match(next.stderr, /^pensmith next: → plan$/m, 'the router walks on to §2, never back to verify §1');
  assert.ok(sb.mock.requests.length > calls);
});

test('GRND-18: `plan` typed without a number stays one verb (the chain is only for bare / next / resume)', async () => {
  const sb = await sandbox('plan-no-number');
  await seedPaper(sb.root, TWO_SECTIONS);
  const r = await sb.run(['plan', '--yolo']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.equal(sb.calls('section-planner'), 1);
  assert.equal(sb.calls('section-drafter'), 0, 'plan does not write');
  assert.ok(!existsSync(sectionFile(sb.root, 1, 'introduction', 'DRAFT.md')));
  assert.doesNotMatch(r.stderr, /^pensmith: ran /m);
});

test('GRND-18 (review round 2): after a finished paper is re-drafted, bare runs recompile, re-export ONCE and settle at status (done); a dry run of the finished paper routes like the paper', async () => {
  const sb = await sandbox('bare-chain-redo');
  await seedPaper(sb.root, TWO_SECTIONS);
  for (const expected of [/next: plan §2$/m, /next: compile$/m, /^pensmith: ran compile; next: done$/m, /^pensmith: ran done; next: status \(done\)$/m]) {
    const r = await sb.run(['--yolo']);
    assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, expected);
  }
  const finalMd = join(sb.root, '.paper', 'FINAL.md');
  const firstFinal = readFileSync(finalMd, 'utf8');

  // A dry run of the finished paper: the seeded workspace keeps the paper's
  // content and mtimes, so it routes to done too (never "done ran without advancing").
  const dry = await sb.run(['--dry-run', '--yolo']);
  assert.notEqual(dry.status, 1, `${dry.stdout}\n${dry.stderr}`);
  assert.doesNotMatch(dry.stderr, /without advancing the paper/);
  assert.match(dry.stderr, /status \(done\)/);

  // Re-draft §2 (verified again), then: compile once, done once, then done.
  sb.mock.script('section-drafter', { text: `# Discussion\n\nA second look at measurement [@${RECORDED.citekey}].\n` });
  const redo = await sb.run(['write', '2', '--yolo']);
  assert.equal(redo.status, EXIT_OK, `${redo.stdout}\n${redo.stderr}`);
  assert.equal(statusOf(sb.root, 2, 'discussion'), 'verified');
  const compile = await sb.run(['--yolo']);
  assert.match(compile.stderr, /^pensmith: ran compile; next: done$/m, compile.stderr);
  const done = await sb.run(['--yolo']);
  assert.match(done.stderr, /^pensmith: ran done; next: status \(done\)$/m, `${done.stdout}\n${done.stderr}`);
  assert.notEqual(readFileSync(finalMd, 'utf8'), firstFinal, 'FINAL.md was refreshed from the new compile (no humanizer)');
  assert.equal(readFileSync(finalMd, 'utf8'), readFileSync(join(sb.root, '.paper', 'DRAFT.md'), 'utf8'));
  const calls = sb.mock.requests.length;
  for (let i = 0; i < 2; i += 1) {
    const settled = await sb.run(['--yolo']);
    assert.equal(settled.status, EXIT_OK, `${settled.stdout}\n${settled.stderr}`);
    assert.match(settled.stderr, /^pensmith: ran status \(done\); next: status \(done\)$/m, settled.stderr);
  }
  assert.equal(sb.mock.requests.length, calls, 'a finished paper makes no further model calls');
});
