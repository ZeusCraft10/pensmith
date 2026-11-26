// tests/write-wave-output-order.test.ts — the order of a wave write's closing
// lines when stdout and stderr share one stream.
//
// `pensmith write` with no section number ends by printing one wave_complete
// JSON line per wave on stdout and then, on stderr, one "not drafted" line for
// each section skipped because a section it depends on was not drafted. Read
// through one merged stream (a terminal, `2>&1`, or a tool that captures both),
// every wave_complete line comes first, together, and the skipped-section lines
// follow. A behaviour-preserving cleanup once folded the two loops into one,
// which put each wave's skipped lines between the wave_complete events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './lib/cli-env.js';

const CLI = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));

/** A .paper/ with an outline and a planned PLAN.md for each section. */
function seedPaper(sections: Array<{ n: number; slug: string; deps: string[] }>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pensmith-wave-order-'));
  const paper = path.join(dir, '.paper');
  mkdirSync(paper, { recursive: true });
  writeFileSync(
    path.join(paper, 'OUTLINE.md'),
    '# Paper\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n' +
      sections.map((s) => `| ${s.n} | ${s.slug} | ${s.slug} | ${s.deps.join(', ')} | 300 | |`).join('\n') +
      '\n',
  );
  for (const s of sections) {
    const sec = path.join(paper, 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    mkdirSync(sec, { recursive: true });
    writeFileSync(
      path.join(sec, 'PLAN.md'),
      `---\nsection: ${s.n}\nslug: ${s.slug}\ntitle: ${s.slug}\ndepends_on: [${s.deps.join(', ')}]\n` +
        `assigned_sources: []\nstatus: planned\n---\n# ${s.slug}\n\nBrief.\n`,
    );
  }
  return dir;
}

test('a wave write prints every wave_complete line before any "not drafted" line on a merged stream', () => {
  // Wave 1: intro (fails) and background. Wave 2: method, blocked by intro.
  // Wave 3: results, blocked by method.
  const dir = seedPaper([
    { n: 1, slug: 'intro', deps: [] },
    { n: 2, slug: 'method', deps: ['intro'] },
    { n: 3, slug: 'results', deps: ['method'] },
    { n: 4, slug: 'background', deps: [] },
  ]);
  // A directory where intro's DRAFT.md goes makes its write fail.
  mkdirSync(path.join(dir, '.paper', 'sections', '01-intro', 'DRAFT.md'));
  const merged = path.join(dir, 'merged.out');
  const fd = openSync(merged, 'w');
  let status: number | null;
  try {
    const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), CLI, 'write', '--max-parallel', '1'], {
      cwd: dir,
      env: isolatedCliEnv({
        PENSMITH_NO_LLM: '1',
        ANTHROPIC_API_KEY: undefined,
        PENSMITH_COST_CAP_USD: undefined,
        PENSMITH_TEST_CASSETTES: undefined,
      }),
      // stdout and stderr share one descriptor, so the file keeps the order
      // the lines were written in.
      stdio: ['ignore', fd, fd],
      timeout: 60_000,
    });
    status = r.status;
  } finally {
    closeSync(fd);
  }
  try {
    const lines = readFileSync(merged, 'utf8').split('\n').filter((l) => l.length > 0);
    const out = lines.join('\n');
    assert.equal(status, 1, out);
    const waveComplete = lines.flatMap((l, i) => (l.startsWith('{"event":"wave_complete"') ? [i] : []));
    const notDrafted = lines.flatMap((l, i) =>
      (/not drafted, because a section it depends on was not\.$/.test(l) ? [i] : []));
    assert.equal(waveComplete.length, 3, `one wave_complete per wave\n${out}`);
    assert.deepEqual(
      notDrafted.map((i) => lines[i]),
      [
        'pensmith write: section 2 (method): not drafted, because a section it depends on was not.',
        'pensmith write: section 3 (results): not drafted, because a section it depends on was not.',
      ],
      out,
    );
    assert.ok(
      Math.max(...waveComplete) < Math.min(...notDrafted),
      `every wave_complete line comes before the first "not drafted" line\n${out}`,
    );
    assert.deepEqual(
      waveComplete.map((i) => (JSON.parse(lines[i]!) as { wave: number }).wave),
      [1, 2, 3],
      out,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
