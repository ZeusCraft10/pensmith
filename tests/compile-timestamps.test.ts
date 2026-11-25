// tests/compile-timestamps.test.ts — when compile stamps what it writes.
//
// compile writes .paper/DRAFT.md, then COMPILE-REPORT.md, then
// COMPILE-MANIFEST.json. The report's compiled_at is taken once DRAFT.md is
// written, and the manifest's once the report is written, so each records the
// time its own file was made. A clock that moves on at every reading shows
// the order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
import { compiledPaper } from './lib/export-fixture.js';

const BIB =
  '@book{kuhn1962,\n  title = {The Structure of Scientific Revolutions},\n  author = {Kuhn, Thomas S.},\n' +
  '  publisher = {University of Chicago Press},\n  year = {1962},\n  isbn = {9780226458083}\n}\n';

/** Run `fn` with a clock that moves on 5 ms at every reading. */
async function withTickingClock<T>(fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  let t = RealDate.UTC(2026, 10, 25, 12, 0, 0, 0);
  class TickingDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        t += 5;
        super(t);
      } else {
        super(...(args as [string | number]));
      }
    }
    static override now(): number {
      t += 5;
      return t;
    }
  }
  globalThis.Date = TickingDate as DateConstructor;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

test('compile: COMPILE-MANIFEST.json is stamped after COMPILE-REPORT.md, each when it is written', async () => {
  const root = await compiledPaper({
    title: 'Paradigms',
    bib: BIB,
    sections: [{ slug: 'intro', title: 'Intro', draft: 'Paradigms shift [@kuhn1962].\n', sources: ['kuhn1962'] }],
  });
  const result = await withTickingClock(() => runCompile({ paperRoot: root, onWarn: () => {} }));
  assert.equal(result.refused, false, (result.refuseReasons ?? []).join('\n'));

  const report = /compiled_at: (\S+)/.exec(readFileSync(join(root, '.paper', 'COMPILE-REPORT.md'), 'utf8'))?.[1];
  const manifest = (JSON.parse(readFileSync(join(root, '.paper', 'COMPILE-MANIFEST.json'), 'utf8')) as { compiled_at: string }).compiled_at;
  assert.ok(report, 'COMPILE-REPORT.md carries compiled_at');
  assert.ok(Date.parse(manifest) > Date.parse(report.replace(/^['"]|['"]$/g, '')), `report ${report}, manifest ${manifest}`);
});
