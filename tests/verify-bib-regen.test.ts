// tests/verify-bib-regen.test.ts — SRC-12 (D-19-19): a CITATIONS.bib that does
// not parse is regenerated from LIBRARY.json on `verify` (one notice, the old
// file kept as a backup) and verification proceeds. E2E-12: live research once
// wrote `author = {,{\u  }}` for "Эсенаманов, Байэл" and every later verify
// crashed on it. Without a LIBRARY.json the parse error stands (fail closed —
// covered in tests/library-writer.test.ts). Spawns the BUILT CLI.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initState, initSection } from '../bin/lib/state.js';
import { upsertSources, rerenderCitations, loadLibrary } from '../bin/lib/library.js';
import { parseBib } from '../bin/lib/citations.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(REPO, 'dist', 'bin', 'pensmith.js');

/** The broken entry an older pensmith wrote for a Cyrillic author (E2E-12). */
const E2E12_BIB = '@article{anon2025,\n\tauthor = {,{\\u  }},\n\ttitle = {{\\u  } {\\u  }},\n\tdoi = {10.1038/nphys1170},\n\tyear = {2025},\n}\n';

async function paperWithBrokenBib(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-bibregen-'));
  await initState(root);
  await initSection(root, 1, 'intro');
  await upsertSources(
    root,
    [{ citekey: 'anon2025', doi: '10.1038/nphys1170', title: 'Исследование квантовой когерентности', authors: ['Эсенаманов, Байэл'], year: 2025 }],
    { provenance: 'research' },
  );
  fs.writeFileSync(path.join(root, '.paper', 'CITATIONS.bib'), E2E12_BIB);
  const sec = path.join(root, '.paper', 'sections', '01-intro');
  fs.mkdirSync(sec, { recursive: true });
  fs.writeFileSync(
    path.join(root, '.paper', 'OUTLINE.md'),
    ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', '| 1 | intro | Introduction | | 300 | anon2025 |', ''].join('\n'),
  );
  fs.writeFileSync(path.join(sec, 'PLAN.md'), ['---', 'section: 1', 'slug: intro', 'title: Introduction', 'depends_on: []', 'assigned_sources: [anon2025]', 'status: written', '---', ''].join('\n'));
  fs.writeFileSync(path.join(sec, 'DRAFT.md'), '# Introduction\n\nQuantum coherence was measured [@anon2025].\n');
  return root;
}

test('SRC-12: rerenderCitations re-renders a bib that does not parse and keeps it as a backup', async () => {
  const root = await paperWithBrokenBib();
  await assert.rejects(parseBib(E2E12_BIB), 'precondition: the E2E-12 bib does not parse');
  const r = await rerenderCitations(root);
  assert.ok(r.backup && fs.readFileSync(r.backup, 'utf8') === E2E12_BIB, 'the unreadable file is kept');
  assert.ok(r.previousProblem);
  const parsed = await parseBib(fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8'));
  assert.deepEqual(parsed[0]!['author'], [{ family: 'Эсенаманов', given: 'Байэл' }]);
  assert.equal((await loadLibrary(root)).entries.length, 1, 'the library itself is unchanged');
  // a bib that parses is re-rendered without a backup
  const again = await rerenderCitations(root);
  assert.equal(again.backup, null);
});

test('SRC-12: `verify 1` re-renders the E2E-12 bib from LIBRARY.json with one notice, then verifies', async () => {
  assert.ok(fs.existsSync(CLI), 'dist/ is missing — run `npm run build` first');
  const root = await paperWithBrokenBib();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { PENSMITH_TEST: '1', PENSMITH_NO_LLM: '1' });
  delete env['PENSMITH_NETWORK_TESTS'];
  const r = spawnSync(process.execPath, [CLI, 'verify', '1', '--yolo'], { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  const notices = r.stderr.split('\n').filter((l) => /CITATIONS\.bib did not parse/.test(l));
  assert.equal(notices.length, 1, r.stderr);
  assert.match(notices[0]!, /^pensmith verify: \.paper\/CITATIONS\.bib did not parse \(.+\) — re-rendered it from LIBRARY\.json; the old file is kept at .*CITATIONS\.bib\.unparsed-.*\.bak$/);
  assert.doesNotMatch(r.stderr, /is not valid BibTeX/, 'the parse error no longer stops verify');
  const verification = fs.readFileSync(path.join(root, '.paper', 'sections', '01-intro', 'VERIFICATION.md'), 'utf8');
  assert.match(verification, /## Pass-1/);
  assert.match(verification, /anon2025/, 'Pass 1 checked the cited source');
  const bib = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /author = \{Эсенаманов, Байэл\}/);
  assert.doesNotMatch(bib, /\\u/);
});
