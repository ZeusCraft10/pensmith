// tests/bib-fixture-cleanup.test.ts — the bibliography fixture removes the
// folders it makes.
//
// bibFile() made a temp folder per call and nothing removed it, so a suite run
// left about thirty pensmith-bib-fixture-* folders behind. This runs a test
// file that uses it, with its own temp folder, and looks at what is left.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('./lib/bib-fixture.ts', import.meta.url));

test('bibFile removes its temp folders when the test file ends', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'pensmith-bib-cleanup-'));
  const user = path.join(mkdtempSync(path.join(tmpdir(), 'pensmith-bib-cleanup-src-')), 'uses-bib.test.ts');
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'pensmith-bib-cleanup-out-')), 'seen.json');
  writeFileSync(user, [
    "import { test } from 'node:test';",
    "import { existsSync, writeFileSync } from 'node:fs';",
    `import { bibFile } from ${JSON.stringify(HELPER)};`,
    "test('writes two bibliographies', () => {",
    "  const a = bibFile('@misc{a, title = {A}}\\n');",
    "  const b = bibFile('@misc{b, title = {B}}\\n');",
    '  writeFileSync(process.env.REPORT_TO!, JSON.stringify([a, b].map((p) => existsSync(p))));',
    '});',
    '',
  ].join('\n'));
  const r = spawnSync(process.execPath, ['--import', 'tsx', user], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, REPORT_TO: report },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.ok(existsSync(report), 'the fixture test ran');
  assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')), [true, true], 'each bibliography existed during the test');
  const left = readdirSync(tmp).filter((f) => f.startsWith('pensmith-bib-fixture-'));
  assert.deepEqual(left, [], 'no fixture folder is left behind');
});
