// tests/verify-quote-flow-cli.test.ts — the Phase 20 integration flows for a
// quote no source text can check (VRFY-19, VRFY-20; D-20-03, D-20-18,
// D-20-22), through the BUILT CLI with sources offline and no contact email:
//
//   1. a fabricated quote from a recorded Crossref work (lecun2015) — no
//      contact email, so Unpaywall is not asked and no text can be read — is
//      UNVERIFIABLE-QUOTE q1: the section is unverifiable (exit 4) and
//      `compile --yolo` refuses naming the quote and its three remedies;
//   2. the user's own PDF of the work (`pensmith add <pdf>`): the fabricated
//      quote is NOT_FOUND in it (failed); the real sentence is PASS "verified
//      against your local file" — listed in COMPILE-REPORT.md and in done's
//      confirmation, with zero network (offline, the PDF is local);
//   3. `verify 1 --accept-quote q1` on the UNVERIFIABLE-QUOTE: the section
//      verifies, compile succeeds and COMPILE-REPORT.md lists the quote with
//      its timestamp; done lists it and records it in .paper/VERIFICATION.md;
//      one changed draft byte outside the quote voids the acceptance (compile
//      refuses again) and restoring the byte restores it;
//   4. VRFY-23 at done: the register's two orphan sentences appended to a
//      section draft, re-verified and recompiled, are named in done's
//      confirmation summary and in the paper-level .paper/VERIFICATION.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sandbox, runCli, writeState, writeOutline, writePlan, sectionDirOf, REPO, STACK_LINE, type Sandbox, type CliRun } from './helpers/paper-cli-harness.js';

const BYO = path.join(REPO, 'tests', 'fixtures', 'byo', 'metadata-doi.pdf');
const FAKE = 'attention mechanisms are nothing more than lookup tables for bananas';
const REAL = 'deep learning allows computational models that are composed of multiple processing layers to learn representations';
/** No contact email reaches the child, whatever the developer's shell exports (Unpaywall is then never asked). */
const ENV = { PENSMITH_CONTACT_EMAIL: undefined } as const;

function cli(sb: Sandbox, root: string, args: readonly string[]): CliRun {
  const r = runCli(sb, root, args, { env: ENV, timeoutMs: 120_000 });
  assert.doesNotMatch(r.stderr, STACK_LINE, r.stderr);
  return r;
}

/** A one-section paper citing lecun2015 (added by its recorded DOI) with `quote`. */
function seed(prefix: string, quote: string): { sb: Sandbox; root: string; dir: string } {
  const sb = sandbox(prefix);
  const root = sb.project('p');
  writeState(root, [], 'vrfy20-flow');
  const a = runCli(sb, root, ['add', '10.1038/nature14539', '--yolo'], { env: ENV, timeoutMs: 120_000 });
  assert.equal(a.status, 0, `${a.stdout}\n${a.stderr}`);
  writeState(root, [{ n: 1, slug: 'intro' }], 'vrfy20-flow');
  writeOutline(root, [{ n: 1, slug: 'intro', sources: ['lecun2015'] }]);
  writePlan(root, 1, 'intro', { status: 'written', assigned_sources: '[lecun2015]' });
  const dir = sectionDirOf(root, 1, 'intro');
  fs.writeFileSync(path.join(dir, 'DRAFT.md'), `# Intro\n\nDeep learning reshaped the field [@lecun2015]. One review claims that "${quote}" [@lecun2015].\n`);
  return { sb, root, dir };
}

const read = (p: string): string => fs.readFileSync(p, 'utf8');

test('VRFY-19 / VRFY-20 (built CLI): a quote with no source text is UNVERIFIABLE-QUOTE q1 and compile refuses it; the user\'s own PDF then decides it — NOT_FOUND for a fabricated quote, PASS "verified against your local file" for a real one, listed by compile and done', () => {
  const { sb, root, dir } = seed('vrfy20-byo', FAKE);
  const v = cli(sb, root, ['verify', '1', '--yolo']);
  assert.equal(v.status, 4, `${v.stdout}\n${v.stderr}`);
  const md = read(path.join(dir, 'VERIFICATION.md'));
  assert.match(md, /^Status: unverifiable$/m);
  assert.match(md, /^- lecun2015 \[q1\] \("attention mechanisms are nothing more th…"\): \*\*UNVERIFIABLE-QUOTE\*\* — lev=0\.000 — Unpaywall needs a contact email/m);
  const c = cli(sb, root, ['compile', '--yolo']);
  assert.equal(c.status, 4, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout + c.stderr, /quote q1 \("attention mechanisms are nothing more th…"\) \[@lecun2015\] is UNVERIFIABLE-QUOTE — .*pensmith add <pdf>.*re-draft with `pensmith write 1`, or edit the section's DRAFT\.md and run `pensmith verify 1`.*pensmith verify 1 --accept-quote q1/);
  assert.ok(!fs.existsSync(path.join(root, '.paper', 'DRAFT.md')), 'nothing compiled');

  // The user's own copy of the work: Pass 3 now reads real text (local, no network).
  fs.copyFileSync(BYO, path.join(root, 'lecun.pdf'));
  const add = cli(sb, root, ['add', 'lecun.pdf', '--yolo']);
  assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);
  const fake = cli(sb, root, ['verify', '1', '--yolo']);
  assert.equal(fake.status, 4);
  const fakeMd = read(path.join(dir, 'VERIFICATION.md'));
  assert.match(fakeMd, /^Status: failed$/m);
  assert.match(fakeMd, /- lecun2015 \[q1\] \("attention mechanisms are nothing more th…"\): \*\*NOT_FOUND\*\* — .*quote not found in your local file sources\/lecun2015\.pdf/);

  fs.writeFileSync(path.join(dir, 'DRAFT.md'), `# Intro\n\nDeep learning reshaped the field [@lecun2015]. One review writes that "${REAL}" [@lecun2015].\n`);
  const real = cli(sb, root, ['verify', '1', '--yolo']);
  assert.equal(real.status, 0, `${real.stdout}\n${real.stderr}`);
  assert.match(read(path.join(dir, 'VERIFICATION.md')), /- lecun2015 \[q1\] \("deep learning allows computational model…"\): \*\*PASS\*\* — lev=1\.000 — verified against your local file sources\/lecun2015\.pdf \(sha256 [0-9a-f]{12}…\)/);
  const compiled = cli(sb, root, ['compile', '--yolo']);
  assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
  assert.match(read(path.join(root, '.paper', 'COMPILE-REPORT.md')), /## Quotes Verified Against Your Files\n\n- q1 \[@lecun2015\] "deep learning allows computational model…" — verified against your local file sources\/lecun2015\.pdf/);
  const done = cli(sb, root, ['done', '--yolo', '--format', 'md']);
  assert.equal(done.status, 0, `${done.stdout}\n${done.stderr}`);
  assert.match(done.stdout, /q1 \[@lecun2015\] "deep learning allows computational model…" verified against your local file sources\/lecun2015\.pdf/);
  assert.match(read(path.join(root, '.paper', 'VERIFICATION.md')), /verified against your local file|sources\/lecun2015\.pdf/);
});

test('VRFY-20 (built CLI): `verify 1 --accept-quote q1` accepts that one UNVERIFIABLE-QUOTE — compile succeeds and reports it with its timestamp, done lists and records it; one changed draft byte voids the acceptance', () => {
  const { sb, root, dir } = seed('vrfy20-accept', FAKE);
  assert.equal(cli(sb, root, ['verify', '1', '--yolo']).status, 4);
  assert.equal(cli(sb, root, ['compile', '--yolo']).status, 4, 'refused before the acceptance');

  const acc = cli(sb, root, ['verify', '1', '--accept-quote', 'q1', '--yolo']);
  assert.equal(acc.status, 0, `${acc.stdout}\n${acc.stderr}`);
  assert.match(acc.stdout, /accepted q1 for section 1 \(recorded in QUOTE-ACCEPTANCES\.json\)/);
  const record = JSON.parse(read(path.join(dir, 'QUOTE-ACCEPTANCES.json'))) as { acceptances: Array<{ quote_id: string; citekey: string; accepted_at: string; via: string }> };
  assert.deepEqual(record.acceptances.map((a) => [a.quote_id, a.citekey, a.via]), [['q1', 'lecun2015', 'flag']]);
  const at = record.acceptances[0]!.accepted_at;
  const md = read(path.join(dir, 'VERIFICATION.md'));
  assert.match(md, /^Status: verified$/m);
  assert.match(md, new RegExp(`\\*\\*UNVERIFIABLE-QUOTE\\*\\* — .* — accepted by you ${at.replace(/[.]/g, '\\.')} \\(--accept-quote\\)$`, 'm'));

  const c = cli(sb, root, ['compile', '--yolo']);
  assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`);
  assert.match(read(path.join(root, '.paper', 'COMPILE-REPORT.md')), new RegExp(`## Accepted Quotes\\n\\n- section 1 q1 \\[@lecun2015\\] "attention mechanisms are nothing more th" — accepted ${at.replace(/[.]/g, '\\.')} \\(--accept-quote\\)`));
  const done = cli(sb, root, ['done', '--yolo', '--format', 'md']);
  assert.equal(done.status, 0, `${done.stdout}\n${done.stderr}`);
  assert.match(done.stdout, new RegExp(`accepted without a source check: §1 q1 \\[@lecun2015\\] "attention mechanisms are nothing more th" \\(${at.replace(/[.]/g, '\\.')}\\)`));
  assert.match(read(path.join(root, '.paper', 'VERIFICATION.md')), /## Accepted quotes[\s\S]*\| q1 "attention mechanisms are nothing more th" \| lecun2015 \| §1 \|/);

  // One byte outside the quote: the acceptance is bound to the draft it was given for.
  const draft = read(path.join(dir, 'DRAFT.md'));
  fs.writeFileSync(path.join(dir, 'DRAFT.md'), draft.replace('reshaped', 'reshapes'));
  const voided = cli(sb, root, ['compile', '--yolo']);
  assert.equal(voided.status, 4, `${voided.stdout}\n${voided.stderr}`);
  assert.match(voided.stdout + voided.stderr, /quote q1 .* is UNVERIFIABLE-QUOTE/);
  fs.writeFileSync(path.join(dir, 'DRAFT.md'), draft);
  assert.equal(cli(sb, root, ['compile', '--yolo']).status, 0, 'the same draft again: the acceptance applies again');
});

test('VRFY-23 (built CLI): the register\'s orphan sentences appended to a section draft, re-verified and recompiled — done reports both in its confirmation summary and in .paper/VERIFICATION.md', () => {
  const { sb, root, dir } = seed('vrfy23-done', REAL);
  fs.copyFileSync(BYO, path.join(root, 'lecun.pdf'));
  assert.equal(cli(sb, root, ['add', 'lecun.pdf', '--yolo']).status, 0);
  fs.appendFileSync(
    path.join(dir, 'DRAFT.md'),
    '\nSocial media use clearly causes depression in every adolescent. Studies show that 73% of American cities saw street trees lower asthma hospitalizations by 40 percent.\n',
  );
  assert.equal(cli(sb, root, ['verify', '1', '--yolo']).status, 0, 'Pass 4 is advisory: the section still verifies');
  assert.match(read(path.join(dir, 'VERIFICATION.md')), /^Orphan claims: 2 /m);
  assert.equal(cli(sb, root, ['compile', '--yolo']).status, 0);
  const done = cli(sb, root, ['done', '--yolo', '--format', 'md']);
  assert.equal(done.status, 0, `${done.stdout}\n${done.stderr}`);
  assert.match(done.stdout, /- 2 orphan claim\(s\) across 1 paragraph\(s\) \(Pass 4\)/);
  assert.match(done.stdout, /uncited: "Social media use clearly causes depression in every adolescent\."/);
  assert.match(done.stdout, /uncited: "Studies show that 73% of American cities saw street trees lower asthma hospitalizations by 40 percent\."/);
  const paper = read(path.join(root, '.paper', 'VERIFICATION.md'));
  assert.match(paper, /^Orphan claims: 2 /m);
  assert.match(paper, /"Social media use clearly causes depression in every adolescent\." · "Studies show that 73%/);
});
