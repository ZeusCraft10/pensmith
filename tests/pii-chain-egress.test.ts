// tests/pii-chain-egress.test.ts — GRND-05 across the chain (18-PLAN.md §7
// step 3, D-18-12). Integration test: it needs all four Phase 18 streams.
//
// With PII redaction on, intake is the only door user PII comes through: the
// assignment is redacted before the clarifier call and before INTAKE.md is
// written, the raw text goes only to the gitignored INTAKE.raw.local, and every
// later step reads the redacted brief. So over new → research → outline →
// plan → write (the BUILT CLI, the RUN-21 mock LLM, the recorded e2e corpus),
// no captured model request — and no SESSION.log line — carries the name with
// a middle initial, the student ID, the email address, the phone number, the
// date of birth, or the instructor, TA and co-authors (names ending in an
// entity word, after an honorific, hyphenated), while the assignment's content
// ("French Revolution") survives.
// Every identity below is fictional.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openChainSandbox, type ChainSandbox } from './helpers/e2e-chain.js';

const PII = {
  name: 'Marcus T. Ellery',
  studentId: '2025-00419',
  email: 'marcus.t.ellery@example.edu',
  phone: '(555) 319-4410',
  dateOfBirth: 'July 14, 2003',
} as const;

/**
 * Review round 3: names that end in an entity word ("Law", "Park"), follow an
 * honorific, or sit in a "prepared by" list with a hyphenated given name.
 */
const COVER = {
  instructor: 'Grace Law',
  assistant: 'Helen Park',
  coAuthors: ['Jiwoo Hale', 'Kim Min-jun'],
} as const;

const ASSIGNMENT = [
  `Name: ${PII.name}`,
  `Student ID: ${PII.studentId}`,
  `Email: ${PII.email}`,
  `Phone: ${PII.phone}`,
  `Date of birth: ${PII.dateOfBirth}`,
  `Instructor: ${COVER.instructor}`,
  `TA: Dr. ${COVER.assistant}`,
  `Prepared by ${COVER.coAuthors[0]} and ${COVER.coAuthors[1]}.`,
  '',
  'Write a 1500-word literature review on attention mechanisms in transformers, APA style.',
  'Open with how pamphlets focused public attention during the French Revolution.',
  '',
].join('\n');

/** Every fragment that must never leave the machine (whole values and their distinctive parts). */
const NEEDLES = [...Object.values(PII), 'Ellery', '319-4410', '555) 319', 'example.edu', 'July 14', COVER.instructor, COVER.assistant, ...COVER.coAuthors, 'Jiwoo', 'Min-jun'];

const sandboxes: ChainSandbox[] = [];
after(async () => {
  for (const sb of sandboxes) await sb.close();
});

test('GRND-05: new --pii-redact → research → outline → plan → write sends no PII in any model request; INTAKE.md keeps the content, INTAKE.raw.local the original', async () => {
  const sb = await openChainSandbox({ prefix: 'pii-chain', assignment: ASSIGNMENT });
  sandboxes.push(sb);
  const paper = join(sb.root, '.paper');
  sb.applyCorpusScript();

  const intake = await sb.run(['new', '--pii-redact', '--yolo']);
  assert.equal(intake.status, 0, `${intake.stdout}\n${intake.stderr}`);
  const chain = await sb.loop(['--yolo'], { maxRuns: 3, until: () => false });
  const ran = chain.map((r) => /^pensmith: ran (.+); next: /m.exec(r.stderr)?.[1] ?? `exit ${r.status}: ${r.stderr}`);
  assert.deepEqual(ran, ['research', 'outline', 'plan §1, write §1'], 'the chain ran research, outline, and §1 plan → write → verify');
  for (const r of chain) assert.equal(r.status, 0, r.stderr);

  // Every model step was reached …
  const slugs = new Set(sb.mock.requests.map((r) => r.slug).filter((s): s is string => s !== null));
  for (const slug of ['intake-clarifier', 'topic-disambiguator', 'source-evaluator', 'outline-author', 'section-planner', 'section-drafter']) {
    assert.ok(slugs.has(slug), `${slug} was called`);
  }
  // … and no request body carries any PII fragment.
  for (const req of sb.mock.requests) {
    for (const needle of NEEDLES) {
      assert.ok(!req.rawBody.includes(needle), `the ${req.slug ?? req.path} request carries no "${needle}"`);
    }
  }
  // The model saw the redacted assignment (its content, not the identity).
  const clarifier = sb.mock.requests.find((r) => r.slug === 'intake-clarifier')!;
  assert.match(clarifier.rawBody, /French Revolution/, 'the clarifier still reads the assignment content');
  assert.match(clarifier.rawBody, /attention mechanisms in transformers/);

  // Nothing the pipeline logs or writes for later steps holds the PII either.
  const sessionLog = readFileSync(join(paper, 'SESSION.log'), 'utf8');
  for (const needle of NEEDLES) assert.ok(!sessionLog.includes(needle), `SESSION.log carries no "${needle}"`);
  const intakeMd = readFileSync(join(paper, 'INTAKE.md'), 'utf8');
  for (const needle of NEEDLES) assert.ok(!intakeMd.includes(needle), `INTAKE.md carries no "${needle}"`);
  assert.match(intakeMd, /French Revolution/, 'INTAKE.md keeps "French Revolution"');
  assert.match(intakeMd, /^ {2}- Computer Science \(computer-science\) — /m, 'a preset name in the Q/A is not taken for a person');
  assert.match(intakeMd, /^pii_redaction: true$/m);
  for (const dir of readdirSync(join(paper, 'sections'))) {
    for (const f of ['PLAN.md', 'DRAFT.md']) {
      const file = join(paper, 'sections', dir, f);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const needle of NEEDLES) assert.ok(!text.includes(needle), `sections/${dir}/${f} carries no "${needle}"`);
    }
  }

  // The original stays only in the local, gitignored raw copy.
  const raw = readFileSync(join(paper, 'INTAKE.raw.local'), 'utf8');
  for (const value of Object.values(PII)) assert.ok(raw.includes(value), `INTAKE.raw.local keeps "${value}"`);
  assert.match(readFileSync(join(paper, '.gitignore'), 'utf8'), /INTAKE\.raw\.local/);
});
