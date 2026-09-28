// tests/intake-pii-egress.test.ts — GRND-05 / H3: with PII redaction on, no
// model request carries the raw PII (egress BY CONTENT).
//
// The request bodies are captured by the RUN-21 mock LLM — the real transport
// (bin/lib/anthropic.ts → bin/lib/http.ts) sends them there — so this checks
// what actually leaves the machine, not an internal seam (the old
// __setInterpolateForTest seam is gone with interpolate() at the intake call
// site, D-18-03). The chain covered here is new → research; the integration
// pass extends it through outline, plan and write (tests/pii-chain-egress.test.ts).
//
// Also pinned: INTAKE.md keeps entity phrases ("French Revolution", "Treaty
// of Versailles") and the month fragment "Due March" while redacting the
// student's details; the raw text lives only in the gitignored
// .paper/INTAKE.raw.local.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { PII_EGRESS_SENTINELS } from './fixtures/pii-polish-corpus.js';

const KEY = 'sk-test-pii-egress-0001';

/** The GRND-05 chain assignment: a middle-initial name, a student ID, an email, a phone, a date of birth. */
const PII = {
  name: 'Jane Q. Doe',
  studentId: '2024-00173',
  email: PII_EGRESS_SENTINELS.email,
  phone: '(555) 201-7788',
  dob: 'March 3, 2004',
  ssn: PII_EGRESS_SENTINELS.ssn,
  sentinelName: PII_EGRESS_SENTINELS.name,
} as const;

const ASSIGNMENT = [
  `Name: ${PII.name}`,
  `Student ID: ${PII.studentId}`,
  `Email: ${PII.email}`,
  `Phone: ${PII.phone}`,
  `Date of birth: ${PII.dob}`,
  `SSN: ${PII.ssn}`,
  `Tutor: ${PII.sentinelName}`,
  '',
  'Due March. Write a 1500-word argumentative essay on the causes of the French Revolution',
  'and how the Treaty of Versailles was later remembered. Use Chicago style.',
  '',
].join('\n');

test('GRND-05: new → research with --pii-redact: no captured model request carries the raw PII; the redacted tags do', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const made = await sb.runTsx(null, ['new', '--from', 'assignment.txt', '--yolo', '--pii-redact']);
    assert.equal(made.status, 0, `${made.stdout}\n${made.stderr}`);
    const research = await sb.runTsx(null, ['research', '--yolo']);
    assert.ok(research.status !== null, `${research.stdout}\n${research.stderr}`);

    const bodies = sb.mock!.requests.filter((r) => r.shape !== 'models').map((r) => r.rawBody);
    assert.ok(sb.mock!.callCount('intake-clarifier') === 1, 'one clarifier call');
    assert.ok(sb.mock!.callCount('topic-disambiguator') >= 1, 'research sent its disambiguator request');
    const all = bodies.join('\n---\n');
    for (const [kind, raw] of Object.entries(PII)) {
      assert.ok(!all.includes(raw), `PII LEAK: raw ${kind} "${raw}" reached a model request`);
    }
    for (const tag of ['[REDACTED:NAME]', '[REDACTED:ID]', '[REDACTED:EMAIL]', '[REDACTED:PHONE]', '[REDACTED:DATE]']) {
      assert.ok(all.includes(tag), `the redacted ${tag} crossed instead (redaction by content, not an empty payload)`);
    }
    assert.ok(all.includes('French Revolution'), 'the topic survives redaction');
  });
});

test('GRND-05: INTAKE.md keeps entities and "Due March" but not the student’s details; INTAKE.raw.local keeps the raw text and is gitignored', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1' }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const r = await sb.runTsx(null, ['new', '--from', 'assignment.txt', '--yolo', '--pii-redact']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const intake = fs.readFileSync(path.join(sb.paper, 'INTAKE.md'), 'utf8');
    for (const [kind, raw] of Object.entries(PII)) assert.ok(!intake.includes(raw), `INTAKE.md must not hold the raw ${kind}`);
    for (const keep of ['French Revolution', 'Treaty of Versailles', 'Due March']) assert.ok(intake.includes(keep), `INTAKE.md keeps "${keep}"`);
    assert.match(intake, /^pii_redaction: true$/m);
    const raw = fs.readFileSync(path.join(sb.paper, 'INTAKE.raw.local'), 'utf8');
    for (const v of Object.values(PII)) assert.ok(raw.includes(v), `INTAKE.raw.local keeps "${v}"`);
    assert.match(fs.readFileSync(path.join(sb.paper, '.gitignore'), 'utf8'), /^INTAKE\.raw\.local$/m);
    // The reviewable diff names each redaction (stdout, the user's own terminal).
    assert.match(r.stdout, /\[EMAIL\] "leak\.sentinel@example\.test" → \[REDACTED:EMAIL\]/);
    // config.toml mirrors the opt-in.
    assert.match(fs.readFileSync(path.join(sb.paper, 'config.toml'), 'utf8'), /^pii_redaction = true$/m);
  });
});

test('GRND-05: with PII redaction off (the default) nothing is redacted and no INTAKE.raw.local is written', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1' }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const r = await sb.runTsx(null, ['new', '--from', 'assignment.txt', '--yolo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const intake = fs.readFileSync(path.join(sb.paper, 'INTAKE.md'), 'utf8');
    assert.ok(intake.includes(PII.email), 'opt-out keeps the assignment verbatim');
    assert.ok(!fs.existsSync(path.join(sb.paper, 'INTAKE.raw.local')), 'no raw copy without the opt-in');
    assert.match(intake, /^pii_redaction: false$/m);
  });
});
