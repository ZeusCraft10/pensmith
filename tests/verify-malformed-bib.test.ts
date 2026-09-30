// tests/verify-malformed-bib.test.ts — VRFY-16 (D-20-20): verify fails closed
// on a malformed bibliography and always persists a status.
//   - CITATIONS.bib is parsed entry by entry (citations.ts parseBibEntries): a
//     cited key whose entry does not parse is UNPARSEABLE naming the key and
//     its line; the good entry is checked; exit 4 and no stack trace;
//   - a 0-byte (or missing) bib with a cited key is FABRICATED, Status failed,
//     exit 4 — and `compile --yolo` exits 4 with no parseBib stack;
//   - PLAN.md is `verifying` (no verified hash) BEFORE any pass runs: a crash
//     never leaves an earlier `verified` in place;
//   - with DRAFT.md deleted, verify sets PLAN.md back to `writing`, and the
//     router sends the section to write — three bare runs never repeat an
//     identical verify; a VERIFIED section whose DRAFT.md is deleted is sent to
//     write as well (compile could only refuse it, run after run).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBibEntries } from '../bin/lib/citations.js';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { seedGatePaper, LECUN_BIB } from './helpers/gate-paper.js';
import { STACK_LINE } from './helpers/paper-cli-harness.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';

const BROKEN = '\n@article{broken2020,\n  title = A {broken value,\n  author = {X, Y}\n}\n';

test('VRFY-16: parseBibEntries parses entry by entry — the good entries, and each broken one with its key and line (LF and CRLF)', () => {
  for (const eol of ['\n', '\r\n']) {
    const text = `${LECUN_BIB}${BROKEN}\n@book{ok2021, title={Fine}, author={Doe, Jane}, year={2021}}\n@article{unclosed,\n  title = {Never closed\n`.replace(/\n/g, eol);
    const r = parseBibEntries(text);
    assert.deepEqual(r.entries.map((e) => e['id']), ['lecun2015', 'ok2021'], eol);
    assert.deepEqual(r.problems.map((p) => [p.key, p.line]), [['broken2020', 9], ['unclosed', 15]], eol);
    assert.ok(r.problems.every((p) => p.detail.length > 0 && !p.detail.includes('\n')));
  }
  assert.deepEqual(parseBibEntries('   \n'), { entries: [], problems: [] }, 'whitespace is an empty bibliography');
  assert.deepEqual(parseBibEntries('not bibtex at all').problems.map((p) => p.line), [1], 'text with no entry is one problem');
  const withString = parseBibEntries('@string{jn = {Journal N}}\n@comment{ignored}\n@article{s2020, title={S}, author={S, S}, journal=jn, year={2020}}\n');
  assert.deepEqual(withString.entries.map((e) => e['id']), ['s2020']);
  assert.deepEqual(withString.problems, []);
});

test('VRFY-16 (built CLI): one broken and one good entry — verify exits 4, the broken key is UNPARSEABLE with its line, the good key OK, no stack', () => {
  const p = seedGatePaper('bib-broken', [{ n: 1, slug: 'intro', assigned: ['lecun2015', 'broken2020'], draft: '# Intro\n\nDeep learning [@lecun2015] and more [@broken2020].\n' }], LECUN_BIB + BROKEN);
  const r = p.cli(['verify', '1']);
  assert.equal(r.status, EXIT_BLOCKED, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /parseBib: invalid BibTeX/);
  const md = readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: failed$/m);
  assert.match(md, /^- lecun2015: \*\*OK\*\*/m);
  assert.match(md, /^- broken2020: \*\*UNPARSEABLE\*\* — titleJW=n\/a, authorJW=n\/a — its \.paper\/CITATIONS\.bib entry \(line 9\) does not parse/m);
  assert.match(readFileSync(join(p.sectionDir(1, 'intro'), 'PLAN.md'), 'utf8'), /^status: failed$/m);
});

test('VRFY-16 (built CLI): a 0-byte CITATIONS.bib with [@a] → FABRICATED, Status failed, exit 4; compile --yolo exits 4 with no parseBib stack', () => {
  const p = seedGatePaper('bib-empty', [{ n: 1, slug: 'intro', assigned: ['a'], draft: '# Intro\n\nA claim [@a].\n' }], '');
  const v = p.cli(['verify', '1']);
  assert.equal(v.status, EXIT_BLOCKED, `${v.stdout}\n${v.stderr}`);
  const md = readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: failed$/m);
  assert.match(md, /^- a: \*\*FABRICATED\*\* — .*CITATIONS\.bib has no entries/m);
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /REFUSED/);
  assert.match(c.stdout, /\[@a\] is FABRICATED/);
  assert.doesNotMatch(`${c.stdout}${c.stderr}`, /parseBib|BibParseError/);
  assert.doesNotMatch(c.stderr, STACK_LINE);
  assert.ok(!existsSync(join(p.root, '.paper', 'DRAFT.md')));
  // A missing bib: the same FABRICATED rows (EXIT_BLOCKED, never EXIT_ERROR).
  rmSync(join(p.root, '.paper', 'CITATIONS.bib'));
  const missing = p.cli(['verify', '1']);
  assert.equal(missing.status, EXIT_BLOCKED);
  assert.match(readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8'), /^- a: \*\*FABRICATED\*\* — .*CITATIONS\.bib is missing/m);
});

test('VRFY-16: a stale compile re-verify over a malformed bibliography is a REFUSED reason, never a stack', () => {
  const p = seedGatePaper('bib-stale', [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Intro\n\nDeep learning [@lecun2015].\n' }], LECUN_BIB);
  assert.equal(p.cli(['verify', '1']).status, EXIT_OK);
  writeFileSync(join(p.sectionDir(1, 'intro'), 'DRAFT.md'), '# Intro\n\nDeep learning, revised [@lecun2015].\n');
  writeFileSync(join(p.root, '.paper', 'CITATIONS.bib'), '@article{lecun2015,\n  title = {Deep learning\n');
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /staleness re-verify FAILED — citation \[@lecun2015\] is UNPARSEABLE/);
  assert.doesNotMatch(c.stderr, STACK_LINE);
  assert.ok(!existsSync(join(p.root, '.paper', 'DRAFT.md')));
});

test('VRFY-16: PLAN.md is `verifying` with no verified hash before any pass; a pass that throws leaves it so, never an earlier `verified`', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    const { writeState, sectionDirOf } = await import('./helpers/paper-cli-harness.js');
    writeState(sb.root, [{ n: 1, slug: 'intro' }]);
    writeFileSync(join(sb.paper, 'OUTLINE.md'), '# O\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | intro |  | 300 | lecun2015 |\n');
    writeFileSync(join(sb.paper, 'CITATIONS.bib'), LECUN_BIB);
    const dir = sectionDirOf(sb.root, 1, 'intro');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'PLAN.md'), "---\nschema_version: 2\nsection: 1\nslug: intro\ntitle: intro\ndepends_on: []\nassigned_sources: ['lecun2015']\nverified_against_draft_hash: null\nstatus: written\n---\n\n## Brief\n");
    writeFileSync(join(dir, 'DRAFT.md'), '# Intro\n\nDeep learning [@lecun2015].\n');
    const { verifySection } = await import('../bin/cli/verify.js');
    const first = await verifySection(1, 'intro');
    assert.equal(first.status, 'verified');
    assert.match(readFileSync(join(dir, 'PLAN.md'), 'utf8'), /^status: verified$/m);
    // A Pass-3 error injected after the verified run: verify is killed mid-pass.
    writeFileSync(join(dir, 'DRAFT.md'), '# Intro\n\nDeep learning, again [@lecun2015].\n');
    await assert.rejects(
      verifySection(1, 'intro', null, { gateDeps: { runPass3: async () => { throw new Error('injected Pass-3 failure'); } } }),
      /injected Pass-3 failure/,
    );
    const plan = readFileSync(join(dir, 'PLAN.md'), 'utf8');
    assert.match(plan, /^status: verifying$/m, 'the crashed verify left `verifying`');
    assert.doesNotMatch(plan, /verified_against_draft_hash: [0-9a-f]{64}/, 'no earlier verified hash survives');
  });
});

test('VRFY-16 (built CLI): DRAFT.md deleted from a written section → verify sets `writing`; the next bare run routes to write, and bare runs never repeat an identical verify', () => {
  const p = seedGatePaper('bib-nodraft', [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Intro\n\nDeep learning [@lecun2015].\n' }], LECUN_BIB);
  rmSync(join(p.sectionDir(1, 'intro'), 'DRAFT.md'));
  const v = p.cli(['verify', '1']);
  assert.notEqual(v.status, EXIT_OK);
  assert.match(readFileSync(join(p.sectionDir(1, 'intro'), 'PLAN.md'), 'utf8'), /^status: writing$/m);
  assert.match(readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8'), /DRAFT\.md missing .* `pensmith write 1`/);
  // Three bare runs: each one writes (stub drafts under PENSMITH_NO_LLM) and verifies at most once per new draft.
  const verifies: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const r = p.cli(['--yolo']);
    const ran = /pensmith: ran ([^;]+);/.exec(r.stderr)?.[1] ?? '';
    verifies.push(ran);
  }
  assert.match(verifies[0] ?? '', /^write §?1/, `the first bare run re-drafts: ${verifies.join(' | ')}`);
  const verifyOnly = verifies.filter((s) => /^verify /.test(s));
  assert.equal(verifyOnly.length, 0, `no bare run re-verifies an unchanged draft: ${verifies.join(' | ')}`);
});

test('VRFY-16 (built CLI): DRAFT.md deleted from a VERIFIED section → the next bare run routes to write, never to a compile that can only refuse', () => {
  const p = seedGatePaper('bib-verified-nodraft', [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Intro\n\nDeep learning [@lecun2015].\n' }], LECUN_BIB);
  const v = p.cli(['verify', '1']);
  assert.equal(v.status, EXIT_OK, `${v.stdout}\n${v.stderr}`);
  assert.match(readFileSync(join(p.sectionDir(1, 'intro'), 'PLAN.md'), 'utf8'), /^status: verified$/m);
  rmSync(join(p.sectionDir(1, 'intro'), 'DRAFT.md'));
  const st = p.cli(['status']);
  assert.match(st.stdout + st.stderr, /next: write [#§]1$/m, 'status names the re-draft');
  const r = p.cli(['--yolo']);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.match(r.stderr, /^pensmith: ran write §?1/m, `the bare run re-drafts the section:\n${r.stderr}`);
  assert.ok(existsSync(join(p.sectionDir(1, 'intro'), 'DRAFT.md')), 'the section has a draft again');
});
