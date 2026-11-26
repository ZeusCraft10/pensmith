// scripts/test-reporter.mjs — a node:test reporter that writes one test
// file's results as JSON, for scripts/run-tests.mjs.
//
// It runs inside the test file's own process and reads the test events
// directly, so its counts do not depend on parsing TAP: a test that prints
// "ok 3 - ..." or a half line cannot add a pass or hide a failure.

/** @param {AsyncIterable<{ type: string, data: any }>} source */
export default async function* fileResults(source) {
  const tests = [];
  for await (const ev of source) {
    if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
    const d = ev.data;
    const kind = d.details?.type ?? 'test';
    // A suite is counted through its tests, except when the suite itself
    // fails (a hook throws), which is a failure of its own.
    if (kind === 'suite' && ev.type === 'test:pass') continue;
    tests.push({
      name: d.name,
      nesting: d.nesting,
      kind,
      outcome: ev.type === 'test:fail' ? 'fail' : d.skip !== undefined ? 'skip' : d.todo !== undefined ? 'todo' : 'pass',
      ...(d.skip !== undefined ? { reason: typeof d.skip === 'string' ? d.skip : '' } : {}),
      ...(d.todo !== undefined ? { reason: typeof d.todo === 'string' ? d.todo : '' } : {}),
      ...(ev.type === 'test:fail' ? { error: String(d.details?.error?.cause?.message ?? d.details?.error?.message ?? 'failed').split('\n')[0] } : {}),
    });
  }
  yield `${JSON.stringify({ complete: true, tests })}\n`;
}
