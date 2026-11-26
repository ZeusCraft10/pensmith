// tests/gptzero-consent.test.ts — the paper goes to GPTZero only with a key
// and the user's consent, asked once, defaulting to no.
//
// done called the scorer with no options: --yolo never reached it, consent
// was asked before and again after humanizing, the question defaulted to yes
// (Enter sent the whole paper to a third party), and with no terminal it
// declined silently while the report blamed a missing API key. Now consent is
// decided once per run and kept for the paper (.paper/config.toml [honesty]
// gptzero_consent): asked once at a terminal with "no" as the default,
// given with `done --score`, never by --yolo; `--no-score` skips the score;
// and the report says which of no key, no consent, declined, offline,
// --no-score or a backend error kept the score away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { writeCompileManifestFixture, writeVerificationFixture } from './lib/verification-fixture.js';
import { isolatedCliEnv } from './lib/cli-env.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');
const FAKE_TERMINAL = 'data:text/javascript,process.stdin.isTTY=true;process.stderr.isTTY=true;process.stdout.isTTY=true;';
const CONSENT_QUESTION = /Send paper text to GPTZero/g;

async function compiledPaper(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gptzero-consent-'));
  const pdir = join(root, '.paper');
  const sdir = join(pdir, 'sections', '01-intro');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(join(pdir, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'gptzero', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }));
  writeFileSync(join(pdir, 'OUTLINE.md'), '| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Intro | | 300 | |\n');
  writeFileSync(join(pdir, 'CITATIONS.bib'), '');
  const draft = 'Tidal barrages change estuary sediment over decades.\n';
  writeFileSync(join(sdir, 'DRAFT.md'), draft);
  writeFileSync(join(sdir, 'PLAN.md'), `---\nsection: 1\nslug: intro\nstatus: verified\nassigned_sources: []\nverified_against_draft_hash: ${computeDraftHash(Buffer.from(draft), [])}\n---\n`);
  writeVerificationFixture(sdir, { n: 1, slug: 'intro', draft });
  writeFileSync(join(pdir, 'DRAFT.md'), `# Intro\n\n${draft}`);
  await writeCompileManifestFixture(root, [{ n: 1, slug: 'intro' }]);
  return root;
}

function done(root: string, args: string[], opts: { terminal?: boolean; input?: string; key?: boolean } = {}): { status: number | null; out: string } {
  const env = isolatedCliEnv({
    PENSMITH_NO_LLM: '1',
    PENSMITH_OFFLINE: undefined,
    ANTHROPIC_API_KEY: undefined,
    GPTZERO_API_KEY: opts.key === false ? undefined : 'gptzero-test-key-not-sent',
    PENSMITH_PROMPT_MODE: opts.terminal ? 'numbered' : undefined,
    PENSMITH_COST_CAP_USD: '100',
  });
  const r = spawnSync(process.execPath, [...(opts.terminal ? ['--import', FAKE_TERMINAL] : []), '--import', TSX_LOADER, PENSMITH_TS, 'done', '--format', 'md', ...args], {
    cwd: root, env, encoding: 'utf8', input: opts.input ?? '', timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

const report = (root: string): string => readFileSync(join(root, '.paper', 'VERIFICATION.md'), 'utf8');
const config = (root: string): string => (existsSync(join(root, '.paper', 'config.toml')) ? readFileSync(join(root, '.paper', 'config.toml'), 'utf8') : '');

test('without a terminal and without consent, nothing goes to GPTZero, and the report says consent is required, not that the key is missing', async () => {
  const root = await compiledPaper();
  const r = done(root, ['--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /GPTZero.*consent/i);
  assert.match(r.out, /--score/);
  assert.doesNotMatch(report(root), /no GPTZero API key/, 'the key is set; the reason is consent');
  assert.match(report(root), /consent/i);
  assert.doesNotMatch(report(root), /% AI-generated/, 'no score: nothing was sent');
});

test('--yolo is not consent: it skips the export confirmation, never the GPTZero question', async () => {
  const root = await compiledPaper();
  const r = done(root, ['--yolo'], { terminal: true, input: '\n' });
  assert.equal(r.status, 0, r.out);
  assert.equal((r.out.match(CONSENT_QUESTION) ?? []).length, 1, 'consent is still asked');
});

test('at a terminal, consent is asked once, defaults to no, and the answer is kept for the paper', async () => {
  const root = await compiledPaper();
  const first = done(root, ['--yolo'], { terminal: true, input: '\n' });
  assert.equal(first.status, 0, first.out);
  assert.equal((first.out.match(CONSENT_QUESTION) ?? []).length, 1, 'asked once');
  assert.doesNotMatch(report(root), /% AI-generated/, 'Enter means no: nothing was sent');
  assert.match(config(root), /gptzero_consent = false/);
  const second = done(root, ['--yolo'], { terminal: true, input: 'y\n' });
  assert.equal(second.status, 0, second.out);
  assert.equal((second.out.match(CONSENT_QUESTION) ?? []).length, 0, 'not asked again');
  assert.match(report(root), /declined/i);
});

test('--score gives consent, kept for the paper; the score is the backend\'s', async () => {
  const root = await compiledPaper();
  const r = done(root, ['--yolo', '--score']);
  assert.equal(r.status, 0, r.out);
  assert.match(report(root), /reads as 82% AI-generated \(gptzero\)/);
  assert.match(config(root), /gptzero_consent = true/);
  const again = done(root, ['--yolo']);
  assert.equal(again.status, 0, again.out);
  assert.match(report(root), /reads as 82% AI-generated/, 'the kept consent applies to the next run');
});

test('--no-score skips the score and says so', async () => {
  const root = await compiledPaper();
  const r = done(root, ['--yolo', '--no-score', '--score']);
  assert.equal(r.status, 0, r.out);
  assert.match(report(root), /--no-score/);
  assert.doesNotMatch(report(root), /% AI-generated/);
});

test('with no key the report says the key is missing', async () => {
  const root = await compiledPaper();
  const r = done(root, ['--yolo'], { key: false });
  assert.equal(r.status, 0, r.out);
  assert.match(report(root), /no GPTZERO_API_KEY/);
});
