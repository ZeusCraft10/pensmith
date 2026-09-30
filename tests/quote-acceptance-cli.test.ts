// tests/quote-acceptance-cli.test.ts — VRFY-20 (D-20-22, D-20-26): accepting
// a quote whose source text cannot be checked, from the command line.
//
//   - `pensmith verify N --accept-quote <id>` (repeatable) records only
//     UNVERIFIABLE-QUOTE rows; an id with another verdict, an id the draft
//     does not hold, or a malformed id exits 2 naming why — nothing recorded,
//     the section's verification still written;
//   - `--accept-unverifiable-quotes` (a blanket acceptance) is not a flag:
//     exit 2 like any unknown flag;
//   - the interactive `quote-accept` gate is a multi-select of the quotes plus
//     "accept all" (the only way to accept several at once): picking records
//     `via: prompt`; an empty answer declines; without a terminal it is
//     skipped, and --yolo never answers it (the section stays unverifiable).
//
// Every case runs the production passes offline (the recorded Crossref answer
// for lecun2015; no contact email, so Pass 3 cannot ask Unpaywall for an
// open-access copy and each quote is UNVERIFIABLE-QUOTE — D-20-03). The gate
// cases run verifySection in a child process
// (tests/fixtures/paper-cli/verify-quote-prompt.ts), answered on stdin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_USAGE } from '../bin/lib/exit-codes.js';
import { repeatedFlagValues } from '../bin/cli/verify.js';
import { readQuoteAcceptances, quoteAcceptancesPath } from '../bin/lib/quote-acceptance.js';
import { seedGatePaper, LECUN_BIB, type GatePaper } from './helpers/gate-paper.js';
import { runLibScript, lastJson, STACK_LINE } from './helpers/paper-cli-harness.js';

/** Two quotes whose source text cannot be checked (no contact email: Unpaywall is not asked). */
const QUOTES = [
  'attention mechanisms are nothing more than lookup tables for bananas',
  'every transformer secretly counts the commas in its training data',
] as const;

/** No contact email reaches the child, whatever the developer's shell exports. */
const NO_EMAIL = { PENSMITH_CONTACT_EMAIL: undefined } as const;

function quotePaper(prefix: string): GatePaper {
  return seedGatePaper(
    prefix,
    [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft: `# Intro\n\nOne review claims that "${QUOTES[0]}" [@lecun2015]. It adds that "${QUOTES[1]}" [@lecun2015].\n` }],
    LECUN_BIB,
  );
}

interface PromptRun {
  ok: boolean;
  result?: { status: string; blocked: boolean };
  message?: string;
}

function promptVerify(p: GatePaper, opts: { input?: string; interactive?: boolean; yolo?: boolean }): PromptRun {
  const r = runLibScript(p.sb, 'verify-quote-prompt.ts', ['1', 'intro', String(opts.interactive ?? true), String(opts.yolo ?? false)], {
    cwd: p.root,
    env: { ...NO_EMAIL, PENSMITH_NO_LLM: '1', PENSMITH_PROMPT_MODE: opts.input !== undefined ? 'numbered' : undefined },
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  });
  assert.doesNotMatch(r.stderr, STACK_LINE, r.stderr);
  return lastJson<PromptRun>(r);
}

test('VRFY-20: --accept-quote is read from every occurrence (citty keeps only the last)', () => {
  assert.deepEqual(repeatedFlagValues(['1', '--accept-quote', 'q1', '--accept-quote=q3', '--yolo', '--accept-quote', 'q2'], 'accept-quote'), ['q1', 'q3', 'q2']);
  assert.deepEqual(repeatedFlagValues(['1', '--', '--accept-quote', 'q1'], 'accept-quote'), []);
  assert.deepEqual(repeatedFlagValues(['1', '--accept-quotes', 'q1'], 'accept-quote'), []);
});

test('VRFY-20 (built CLI): `--accept-unverifiable-quotes` is an unknown flag — exit 2, nothing verified or recorded', () => {
  const p = seedGatePaper('qa-blanket', [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Intro\n\nDeep learning matters [@lecun2015].\n' }], LECUN_BIB);
  const r = p.cli(['verify', '1', '--accept-unverifiable-quotes']);
  assert.equal(r.status, EXIT_USAGE, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /accept-unverifiable-quotes/);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.ok(!existsSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md')), 'a usage error runs no verification');
  assert.ok(!existsSync(quoteAcceptancesPath(p.sectionDir(1, 'intro'))));
});

test('VRFY-20 (built CLI): --accept-quote naming another verdict, a quote the draft lacks, or a malformed id exits 2 naming why; nothing recorded; the verification is still written', () => {
  // q1 has no citation (UNATTRIBUTED, blocking and never acceptable); q2 is attributed.
  const p = seedGatePaper(
    'qa-refuse',
    [
      {
        n: 1,
        slug: 'intro',
        assigned: ['lecun2015'],
        draft:
          '# Intro\n\nDeep learning changed the field [@lecun2015]. As one review put it, "deep learning allows computational models that are composed of multiple processing layers".\n\n' +
          `Another review claims that "${QUOTES[0]}" [@lecun2015].\n`,
      },
    ],
    LECUN_BIB,
  );
  const dir = p.sectionDir(1, 'intro');
  const other = p.cli(['verify', '1', '--accept-quote', 'q1'], NO_EMAIL);
  assert.equal(other.status, EXIT_USAGE, `${other.stdout}\n${other.stderr}`);
  assert.match(other.stderr, /--accept-quote q1: its verdict is UNATTRIBUTED \(no citation\) — only an UNVERIFIABLE-QUOTE quote .* can be accepted; nothing was recorded/);
  const md = readFileSync(join(dir, 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^- \(unattributed\) \[q1\] \("deep learning allows computational model…"\): \*\*UNATTRIBUTED\*\*/m, 'the verification ran and was written');
  assert.match(md, /^- lecun2015 \[q2\] \("attention mechanisms are nothing more th…"\): \*\*UNVERIFIABLE-QUOTE\*\* — .*Unpaywall needs a contact email/m);

  // Repeated: the first id the draft does not hold is named (both occurrences are read).
  const missing = p.cli(['verify', '1', '--accept-quote', 'q9', '--accept-quote', 'q2'], NO_EMAIL);
  assert.equal(missing.status, EXIT_USAGE, `${missing.stdout}\n${missing.stderr}`);
  assert.match(missing.stderr, /--accept-quote q9: section 1's draft has no quote q9 — nothing was recorded/);

  const malformed = p.cli(['verify', '1', '--accept-quote', 'quote-1'], NO_EMAIL);
  assert.equal(malformed.status, EXIT_USAGE);
  assert.match(malformed.stderr, /--accept-quote quote-1: a quote id is q1, q2, … as VERIFICATION\.md lists them — nothing was recorded/);
  for (const r of [other, missing, malformed]) assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.ok(!existsSync(quoteAcceptancesPath(dir)), 'nothing was recorded');

  // The acceptable quote is accepted; the UNATTRIBUTED one still fails the section.
  const ok = p.cli(['verify', '1', '--accept-quote', 'q2'], NO_EMAIL);
  assert.equal(ok.status, 4, `${ok.stdout}\n${ok.stderr}`);
  assert.deepEqual(readQuoteAcceptances(dir).map((a) => [a.quote_id, a.citekey, a.via]), [['q2', 'lecun2015', 'flag']]);
  assert.match(readFileSync(join(dir, 'VERIFICATION.md'), 'utf8'), /^Status: failed$/m);
});

test('VRFY-20 / D-20-26: the quote-accept gate — "accept all" records every UNVERIFIABLE-QUOTE via the prompt and the section verifies', () => {
  const p = quotePaper('qa-all');
  const r = promptVerify(p, { input: '3\n' });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.result, { status: 'verified', blocked: false });
  const acc = readQuoteAcceptances(p.sectionDir(1, 'intro'));
  assert.deepEqual(acc.map((a) => [a.quote_id, a.citekey, a.via]), [['q1', 'lecun2015', 'prompt'], ['q2', 'lecun2015', 'prompt']]);
  const md = readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: verified$/m);
  assert.equal(md.match(/— accepted by you \S+ \(at the prompt\)$/gm)?.length, 2);
  assert.match(md, /^## Accepted quotes$/m);
});

test('VRFY-20 / D-20-26: the quote-accept gate — picking one quote accepts only it; the other keeps the section unverifiable', () => {
  const p = quotePaper('qa-one');
  const r = promptVerify(p, { input: '2\n' });
  assert.deepEqual(r.result, { status: 'unverifiable', blocked: true });
  assert.deepEqual(readQuoteAcceptances(p.sectionDir(1, 'intro')).map((a) => a.quote_id), ['q2']);
  const md = readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^- lecun2015 \[q1\] \("[^\n]*\*\*UNVERIFIABLE-QUOTE\*\* — lev=0\.000 — Unpaywall needs a contact email[^\n]*\)$/m);
  assert.match(md, /^- lecun2015 \[q2\] \("[^\n]*\*\*UNVERIFIABLE-QUOTE\*\* — [^\n]*— accepted by you \S+ \(at the prompt\)$/m);
});

test('VRFY-20 / D-20-26: an empty answer declines; without a terminal the gate is skipped and --yolo never answers it — nothing recorded, unverifiable', () => {
  const declined = quotePaper('qa-decline');
  assert.deepEqual(promptVerify(declined, { input: '\n' }).result, { status: 'unverifiable', blocked: true });
  assert.ok(!existsSync(quoteAcceptancesPath(declined.sectionDir(1, 'intro'))));

  const noTty = quotePaper('qa-notty');
  assert.deepEqual(promptVerify(noTty, { yolo: true }).result, { status: 'unverifiable', blocked: true });
  assert.ok(!existsSync(quoteAcceptancesPath(noTty.sectionDir(1, 'intro'))), '--yolo never accepts a quote');
});
