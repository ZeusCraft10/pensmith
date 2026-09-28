// tests/wave-write-cli.test.ts — wave-mode `pensmith write` through the REAL
// CLI against the RUN-21 mock LLM (review round 2):
//   - RUN-22 criterion 3: 10 independent sections with `--max-parallel 10`, a
//     slow mock and explicitly seeded schema-valid PLAN.md files — every
//     section is drafted concurrently and no ELOCKED (or any lock error) escapes;
//   - RUN-09 / RUN-12: a failed section is one stderr line naming it and the
//     failure, the run exits with the failure's documented code (EXIT_COST_CAP
//     for the session cap), and a fatal failure stops the run — the sections
//     not yet started are reported `skipped`, not attempted.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { EXIT_COST_CAP } from '../bin/lib/exit-codes.js';

const KEY = 'sk-ant-test-wave-0001';
const SLUGS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];

/** A paper with `slugs.length` independent sections, each with a schema-valid planned PLAN.md. */
function seedPlannedPaper(sb: LlmSandbox, slugs: readonly string[]): void {
  const sections = slugs.map((slug, i) => ({ n: i + 1, slug }));
  fs.writeFileSync(
    path.join(sb.paper, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'wave-cli', createdAt: '2026-01-01T00:00:00.000Z', sections }, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(sb.paper, 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  fs.writeFileSync(
    path.join(sb.paper, 'OUTLINE.md'),
    ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      ...sections.map((s) => `| ${s.n} | ${s.slug} | ${s.slug} | | 300 | |`), ''].join('\n'),
  );
  for (const s of sections) {
    const dir = path.join(sb.paper, 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'PLAN.md'), [
      '---',
      'schema_version: 1',
      `section: ${s.n}`,
      `slug: ${s.slug}`,
      `title: ${s.slug}`,
      'depends_on: []',
      'assigned_sources: []',
      'verified_against_draft_hash: null',
      'status: planned',
      '---',
      '',
      '## Brief',
      '',
      `Section ${s.n} argues one point.`,
      '',
    ].join('\n'));
  }
}

function events(stdout: string): Array<Record<string, unknown>> {
  return stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>);
}

test('RUN-22: a wave write of 10 independent sections at --max-parallel 10 drafts them all concurrently, with no ELOCKED', async () => {
  const DELAY_MS = 3000;
  await withLlmSandbox({ mock: 'anthropic', mockOptions: { delayMs: DELAY_MS }, env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    seedPlannedPaper(sb, SLUGS);
    const r = await sb.runTsx(null, ['write', '--max-parallel', '10']);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, 0, out);
    assert.doesNotMatch(out, /ELOCKED|LockTimeoutError|lock .*timed out/i, 'no lock error escapes');
    const done = events(r.stdout).filter((e) => e['event'] === 'section_done');
    assert.equal(done.length, 10, out);
    for (const [i, slug] of SLUGS.entries()) {
      const draft = path.join(sb.paper, 'sections', `${String(i + 1).padStart(2, '0')}-${slug}`, 'DRAFT.md');
      assert.ok(fs.existsSync(draft) && fs.readFileSync(draft, 'utf8').length > 0, `${slug} drafted`);
    }
    // Concurrency, not a serial run: all 10 drafter requests reached the slow
    // mock before the first of them could have been answered.
    const at = sb.mock!.requests.filter((q) => q.slug === 'section-drafter').map((q) => q.at);
    assert.equal(at.length, 10);
    assert.ok(Math.max(...at) - Math.min(...at) < DELAY_MS, `the 10 requests overlapped (spread ${Math.max(...at) - Math.min(...at)} ms)`);
  });
});

test('RUN-09 / RUN-12: a wave stopped by the session cost cap names the failure in one line, exits 5 and attempts nothing more', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    seedPlannedPaper(sb, SLUGS.slice(0, 3));
    const r = await sb.runTsx(null, ['write', '--max-parallel', '1'], { env: { PENSMITH_COST_CAP_USD: '0.0001' } });
    assert.equal(r.status, EXIT_COST_CAP, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith write: section 1 \(alpha\) failed: This call would exceed your cost cap\. Continue\? \(section-drafter on \S+: projected \$[\d.]+ \+ \$0\.00 spent this session > cap \$0\.0001/m);
    assert.match(r.stderr, /^pensmith write: stopped — 2 section\(s\) not attempted; fix the failure above and re-run `pensmith write`\.$/m);
    assert.doesNotMatch(r.stderr, /^\s+at .*\.[cm]?[jt]s:\d+/m, 'no stack trace');
    const waves = events(r.stdout).filter((e) => e['event'] === 'wave_complete').map((e) => e['results']);
    assert.deepEqual(waves, [{ failed: 1, skipped: 2 }], 'one failure; the rest were never attempted (serial wave)');
    assert.equal(sb.mock!.callCount('section-drafter'), 0, 'the cap refused before any request');
  });
});
