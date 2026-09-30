// tests/last-verified-recheck.test.ts — VRFY-28 (D-20-15, D-20-27): which
// citations verify re-checks past the HTTP cache, and the recording of
// `last_verified` through the one library writer.
//   - verify passes `refresh` = the cited keys whose LIBRARY.json last_verified
//     is null or older than `[verification] recheck_after_days` (default 30) at
//     the test clock (PENSMITH_TEST_NOW);
//   - after verify, every citation a registrar confirmed has last_verified =
//     its checkedAt in LIBRARY.json AND in .paper/CITATIONS.bib's source of
//     truth (the library writer re-renders the bib); a failing row records nothing;
//   - compile only reads: LIBRARY.json and CITATIONS.bib stay byte-identical
//     (the staleness re-verify included).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { writeState, sectionDirOf } from './helpers/paper-cli-harness.js';
import { seedGatePaper, fileSha } from './helpers/gate-paper.js';
import { upsertSources, tryLoadLibrary } from '../bin/lib/library.js';
import { TEST_NOW_ENV } from '../bin/lib/verify/clock.js';
import { EXIT_OK } from '../bin/lib/exit-codes.js';
import type { Pass1Options, Pass1Result } from '../bin/lib/verify/pass1.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

function cand(citekey: string, doi: string, title: string, author: string, year: number, last: string | null): SourceCandidate {
  return { source: 'crossref', id: doi, doi, title, authors: [author], year, retracted: false, last_verified: last, citekey, raw: null } as unknown as SourceCandidate;
}

async function seedSection(root: string, paper: string, keys: string[]): Promise<string> {
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writeFileSync(join(paper, 'OUTLINE.md'), `# O\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | intro |  | 300 | ${keys.join(', ')} |\n`);
  const dir = sectionDirOf(root, 1, 'intro');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'PLAN.md'), `---\nschema_version: 2\nsection: 1\nslug: intro\ntitle: intro\ndepends_on: []\nassigned_sources: [${keys.map((k) => `'${k}'`).join(', ')}]\nverified_against_draft_hash: null\nstatus: written\n---\n\n## Brief\n`);
  writeFileSync(join(dir, 'DRAFT.md'), `# Intro\n\n${keys.map((k) => `A claim [@${k}].`).join(' ')}\n`);
  return dir;
}

test('VRFY-28: verify re-checks exactly the citations older than recheck_after_days (test clock), and records last_verified from the passing answers only', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1', [TEST_NOW_ENV]: '2030-02-01T00:00:00.000Z' } }, async (sb) => {
    await upsertSources(
      sb.root,
      [
        cand('old2020', '10.5555/old', 'An Old Check', 'Doe, Jane', 2020, '2029-12-31T00:00:00.000Z'),
        cand('fresh2020', '10.5555/fresh', 'A Fresh Check', 'Roe, Rick', 2020, '2030-01-31T00:00:00.000Z'),
        cand('never2020', '10.5555/never', 'Never Checked', 'Poe, Pat', 2020, null),
      ],
      { provenance: 'add' },
    );
    await seedSection(sb.root, sb.paper, ['old2020', 'fresh2020', 'never2020']);
    const seen: Array<ReadonlySet<string> | undefined> = [];
    const runPass1 = async (text: string, _bib: string, opts: Pass1Options): Promise<Pass1Result[]> => {
      seen.push(opts.refresh);
      const { extractCitedKeysForVerification } = await import('../bin/lib/citation-token.js');
      return extractCitedKeysForVerification(text).map((k) => ({
        citekey: k,
        verdict: k === 'never2020' ? 'UNVERIFIABLE-NETWORK' : 'OK',
        titleJW: 1,
        authorJW: 1,
        reason: 'stand-in registrar',
        ...(k === 'never2020' ? {} : { checkedAt: '2030-02-01T00:00:00.000Z' }),
      }));
    };
    const { verifySection } = await import('../bin/cli/verify.js');
    const v = await verifySection(1, 'intro', null, { gateDeps: { runPass1 } });
    assert.equal(v.status, 'unverifiable');
    assert.deepEqual([...(seen[0] ?? [])].sort(), ['never2020', 'old2020'], 'refresh = null or older than 30 days');
    const lib = await tryLoadLibrary(sb.root);
    const stamp = new Map((lib?.entries ?? []).map((e) => [e.citekey, e.last_verified]));
    assert.equal(stamp.get('old2020'), '2030-02-01T00:00:00.000Z', 'a confirmed citation is re-stamped');
    assert.equal(stamp.get('fresh2020'), '2030-02-01T00:00:00.000Z', 'a cached answer records its own time (here the stand-in time)');
    assert.equal(stamp.get('never2020'), null, 'a row that did not pass records nothing');
    // recheck_after_days moves the threshold (0: anything not verified in this instant is re-checked).
    writeFileSync(join(sb.paper, 'config.toml'), 'schema_version = 2\n\n[verification]\nrecheck_after_days = 0\n');
    seen.length = 0;
    await verifySection(1, 'intro', null, { gateDeps: { runPass1 } });
    assert.deepEqual([...(seen[0] ?? [])].sort(), ['never2020'], 'every stamp is "now" (2030-02-01): only the never-verified one is older than 0 days');
  });
});

test('VRFY-28 (built CLI): compile only reads — LIBRARY.json and CITATIONS.bib byte-identical, the staleness re-verify included', async () => {
  const p = seedGatePaper('lv-compile', [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Intro\n\nDeep learning [@lecun2015].\n' }]);
  await upsertSources(p.root, [cand('lecun2015', '10.1038/nature14539', 'Deep learning', 'LeCun, Yann', 2015, '2026-01-01T00:00:00.000Z')], { provenance: 'research' });
  assert.equal(p.cli(['verify', '1']).status, EXIT_OK);
  const lib = join(p.root, '.paper', 'LIBRARY.json');
  const bib = join(p.root, '.paper', 'CITATIONS.bib');
  const before = [fileSha(lib), fileSha(bib)];
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_OK, `${c.stdout}\n${c.stderr}`);
  assert.deepEqual([fileSha(lib), fileSha(bib)], before, 'compile wrote neither');
  // A stale section: compile re-verifies it (writing only its VERIFICATION.md and PLAN.md).
  writeFileSync(join(p.sectionDir(1, 'intro'), 'DRAFT.md'), '# Intro\n\nDeep learning, revised [@lecun2015].\n');
  const c2 = p.cli(['compile', '--yolo']);
  assert.equal(c2.status, EXIT_OK, `${c2.stdout}\n${c2.stderr}`);
  assert.deepEqual([fileSha(lib), fileSha(bib)], before, 'the staleness re-verify wrote neither');
  assert.match(readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8'), /not run — compile staleness re-verify; run `pensmith verify 1`/);
});
