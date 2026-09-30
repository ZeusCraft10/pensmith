// tests/workflow-shell-fallbacks.test.ts — every workflows/<verb>.md body ends
// with a "Shell fallback" line (TIER-06): the exact `pensmith <verb> …` command
// a Tier-1 session degrades to when its tools are unavailable. RUN-11 made any
// unknown verb or option a usage error (EXIT_USAGE), so a documented fallback
// that drifts from the CLI would hand the model a command that exits 2. This
// test extracts each synopsis, instantiates every optional part and
// placeholder, and runs it through the dispatcher's own argv validation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArgv } from '../bin/pensmith.js';
import { UX02_VERBS } from '../bin/lib/verbs.js';

const WORKFLOWS = fileURLToPath(new URL('../plugin/workflows/', import.meta.url));

/** The first backtick span after "Shell fallback" (it may wrap across lines). */
function fallbackSynopsis(body: string): string | null {
  const at = body.indexOf('Shell fallback');
  if (at < 0) return null;
  const m = /`([^`]+)`/.exec(body.slice(at));
  return m ? m[1]!.replace(/\s+/g, ' ').trim() : null;
}

/** Instantiate a synopsis: every [optional] part included, placeholders filled, `a|b` → a. */
function toArgv(synopsis: string): string[] {
  const tokens = synopsis.replace(/[[\]]/g, ' ').split(/\s+/).filter(Boolean);
  assert.equal(tokens[0], 'pensmith', `a fallback starts with "pensmith": ${synopsis}`);
  return tokens.slice(1).map((tok) => {
    if (/^<[^>]+>$/.test(tok)) return /^<[Nn]>$/.test(tok) ? '1' : 'x';
    if (!tok.startsWith('-') && tok.includes('|')) return tok.split('|')[0]!;
    return tok;
  });
}

const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.md')).sort();

test('TIER-06 / RUN-11: every workflow body has a shell fallback for its own verb', () => {
  assert.deepEqual(files.map((f) => f.replace(/\.md$/, '')).sort(), [...UX02_VERBS].sort());
  for (const f of files) {
    const synopsis = fallbackSynopsis(readFileSync(join(WORKFLOWS, f), 'utf8'));
    assert.ok(synopsis, `${f} has a "Shell fallback" command`);
    assert.equal(toArgv(synopsis)[0], f.replace(/\.md$/, ''), `${f}: the fallback runs its own verb (${synopsis})`);
  }
});

for (const f of files) {
  test(`TIER-06 / RUN-11: the ${f} shell fallback passes the CLI's argv validation`, async () => {
    const synopsis = fallbackSynopsis(readFileSync(join(WORKFLOWS, f), 'utf8'))!;
    const argv = toArgv(synopsis);
    await assert.doesNotReject(validateArgv(argv), `${f}: \`${synopsis}\` → pensmith ${argv.join(' ')}`);
  });
}
