// tests/empty-bib.test.ts — an EMPTY CITATIONS.bib is a valid document.
//
// bin/lib/library.ts (BRDTH-01, the one library writer) renders an empty
// library as an empty CITATIONS.bib — e.g. after a research run that found no
// source. Every reader of the file must treat that as zero entries, while a
// MALFORMED bib still throws (T-3-04) and a draft that cites a key the empty
// bib lacks is FABRICATED (the verifier fails closed; CLAUDE.md non-negotiable).
//
// Found in the Phase 17 integration run: offline research with zero
// candidates, then `compile` re-verified the stale section and crashed in
// Pass 1's strict parseBib ("no entries parsed … empty document").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBibFile } from '../bin/lib/citations.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { OFFLINE_MARKER_PREFIX } from '../bin/lib/http-mock.js';
import {
  CLI_BIN,
  sandbox,
  runCli,
  tmp,
  writeState,
  writeOutline,
  writePlan,
  sectionDirOf,
} from './helpers/paper-cli-harness.js';

test('parseBibFile: a whitespace-only file is zero entries; malformed text still throws (T-3-04)', async () => {
  assert.deepEqual(await parseBibFile(''), []);
  assert.deepEqual(await parseBibFile('\n  \r\n'), []);
  await assert.rejects(() => parseBibFile('this is not bibtex'), /parseBib: invalid BibTeX/);
});

test('Pass 1 over an empty CITATIONS.bib: every cited key is FABRICATED (fails closed, never a crash)', async () => {
  const dir = tmp('empty-bib-pass1');
  const bib = join(dir, 'CITATIONS.bib');
  writeFileSync(bib, '');
  const rows = await runPass1('A claim [@ghost2020]. Another [@phantom2019].\n', bib);
  assert.deepEqual(rows.map((r) => [r.citekey, r.verdict]), [['ghost2020', 'FABRICATED'], ['phantom2019', 'FABRICATED']]);
  assert.deepEqual(await runPass1('No citations here.\n', bib), []);
});

function seedWrittenSections(root: string, draft: string): void {
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writeOutline(root, [{ n: 1, slug: 'intro' }]);
  writePlan(root, 1, 'intro', { status: 'written' });
  writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'), draft);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
}

test('RUN-02 / RUN-09: verify over an empty bib — no citations: verified (nothing to check, exit 0, status persisted); citations: FABRICATED, exit 4', () => {
  assert.ok(existsSync(CLI_BIN), `expected ${CLI_BIN} — run npm run build first`);
  const sb = sandbox('empty-bib-verify');

  // Review round 2: a citation-free draft takes the normal path — Pass 1 and
  // Pass 3 have nothing to check, so it is verified (as against a non-empty
  // bib) and PLAN.md is updated, so the router moves on instead of looping.
  const quiet = sb.project('quiet');
  seedWrittenSections(quiet, '# Intro\n\nNo citations in this section.\n');
  const a = runCli(sb, quiet, ['verify', '1']);
  assert.equal(a.status, EXIT_OK, a.stderr);
  const quietVerif = readFileSync(join(sectionDirOf(quiet, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.ok(quietVerif.startsWith(OFFLINE_MARKER_PREFIX), `the body carries the offline marker:\n${quietVerif}`);
  assert.match(quietVerif, /^Status: verified$/m);
  assert.match(quietVerif, /cites no sources/);
  assert.match(readFileSync(join(sectionDirOf(quiet, 1, 'intro'), 'PLAN.md'), 'utf8'), /^status: verified$/m);

  const cited = sb.project('cited');
  seedWrittenSections(cited, '# Intro\n\nA claim [@ghost2020].\n');
  const b = runCli(sb, cited, ['verify', '1']);
  assert.equal(b.status, EXIT_BLOCKED, b.stderr);
  const citedVerif = readFileSync(join(sectionDirOf(cited, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(citedVerif, /ghost2020.*FABRICATED/);
  assert.doesNotMatch(b.stderr, /parseBib/);
});

test('compile over an empty bib: refuses an unverified section; after verify, re-verifies the stale citation-free section and compiles', () => {
  const sb = sandbox('empty-bib-compile');
  const root = sb.project('p');
  seedWrittenSections(root, '# Intro\n\nNo citations in this section.\n');

  const before = runCli(sb, root, ['compile', '--yolo']);
  assert.equal(before.status, EXIT_BLOCKED, before.stderr);
  assert.match(before.stdout, /no verifiable VERIFICATION\.md/);
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')));

  runCli(sb, root, ['verify', '1']);
  // An edit after verification makes the section stale: compile re-verifies it
  // (Pass 1 over the empty bib — the crash this file was written for).
  writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'), '# Intro\n\nNo citations in this section, edited.\n');
  const after = runCli(sb, root, ['compile', '--yolo']);
  assert.doesNotMatch(after.stderr, /parseBib|stack trace/, after.stderr);
  assert.match(after.stderr, /stale — re-verifying/, 'the section is re-verified (Pass 1 over the empty bib)');
  assert.equal(after.status, 0, `${after.stdout}\n${after.stderr}`);
  assert.ok(existsSync(join(root, '.paper', 'DRAFT.md')), 'the citation-free paper compiles');
});
