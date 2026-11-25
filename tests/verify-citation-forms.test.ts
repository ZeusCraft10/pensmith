// tests/verify-citation-forms.test.ts — every way a draft can cite reaches the
// verifier, through the real `pensmith verify`.
//
// Pass 1 used to read only `[...]` clusters whose `@` followed a space, so
// `[-@key]`, narrative `@key`, DOIs and `(Author, 2020)` citations typed as
// text produced no verdict. Pass 3 read only a quote followed by a bare
// lowercase `[@key]`. With an empty CITATIONS.bib, verify looked for citations
// with a bare-`[@key]` regex, so a draft citing `[@ghost, p. 4]` was "nothing
// to verify". Each case here is a section that must not verify.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './lib/cli-env.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

const REAL_BIB =
  '@article{engel2007,\n  title = {Evidence for wavelike energy transfer through quantum coherence in photosynthetic systems},\n' +
  '  author = {Engel, Gregory S.},\n  doi = {10.1038/nature05678},\n  year = {2007}\n}\n';

interface Verified { status: number | null; verification: string; plan: Record<string, unknown>; out: string }

const WRITTEN_PLAN = '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: [engel2007]\n---\n# Intro\n';

/**
 * A one-section paper with `draft` as its DRAFT.md (none when null) and `bib`
 * as its CITATIONS.bib (none when null), verified by the real CLI.
 */
function verifyDraft(draft: string | null, bib: string | null = REAL_BIB, plan = WRITTEN_PLAN): Promise<Verified> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-verify-forms-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(join(sec, 'PLAN.md'), plan);
  if (draft !== null) writeFileSync(join(sec, 'DRAFT.md'), draft);
  if (bib !== null) writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  const env = isolatedCliEnv({ PENSMITH_TEST_CASSETTES: '1', PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: undefined }, 'pensmith-verify-forms-home-');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, 'verify', '1', '--slug', 'intro'], { cwd: root, env });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('close', (status) => {
      resolve({
        status,
        out,
        verification: readFileSync(join(sec, 'VERIFICATION.md'), 'utf8'),
        plan: parseFrontmatter(readFileSync(join(sec, 'PLAN.md'), 'utf8')).frontmatter,
      });
    });
  });
}

function assertBlocked(r: Verified, row: RegExp): void {
  assert.match(r.verification, row, r.verification);
  assert.match(r.verification, /^Status: failed$/m, r.verification);
  assert.equal(r.status, 2, `a blocking verdict exits 2\n${r.out}`);
  assert.equal(r.plan['status'], 'failed', 'the verdict is saved to PLAN.md');
}

const FABRICATED_FORMS: Array<[string, string, string]> = [
  ['locator', 'Coherence is long lived [@ghost2099, p. 4].', 'ghost2099'],
  ['uppercase', 'Coherence is long lived [@Ghost2099].', 'Ghost2099'],
  ['multi-cite', 'Coherence is long lived [see @engel2007; @ghost2099b, ch. 2].', 'ghost2099b'],
  ['narrative', 'As @ghostnarr2099 [p. 7] showed, coherence is long lived.', 'ghostnarr2099'],
  ['suppress-author', 'Coherence is long lived [-@ghostsupp2099].', 'ghostsupp2099'],
  ['key with punctuation', 'Coherence is long lived [@ghost.2099:v2].', 'ghost.2099:v2'],
];

for (const [form, draft, key] of FABRICATED_FORMS) {
  test(`verify: a fabricated citation in ${form} form is FABRICATED and blocks`, async () => {
    const r = await verifyDraft(`# Intro\n\n${draft}\n`);
    assertBlocked(r, new RegExp(`^- ${key.replace(/[.:]/g, '\\$&')}: \\*\\*FABRICATED\\*\\*`, 'm'));
  });
}

test('verify: an empty CITATIONS.bib is an empty library, so a locator citation is FABRICATED, not "nothing to verify"', async () => {
  const r = await verifyDraft('# Intro\n\nCoherence is long lived [@ghost2099, p. 4] and [@a; @b].\n', '');
  assertBlocked(r, /^- ghost2099: \*\*FABRICATED\*\*/m);
  assert.match(r.verification, /^- a: \*\*FABRICATED\*\*/m);
  assert.match(r.verification, /^- b: \*\*FABRICATED\*\*/m);
  assert.equal(typeof r.plan['verified_against_draft_hash'], 'string', 'the draft hash is saved with the verdict');
});

const RAW_FORMS: Array<[string, string]> = [
  ['a DOI', 'Coherence is long lived (doi:10.1038/nature05678).'],
  ['a doi.org link', 'Coherence is long lived, see https://doi.org/10.1038/nature05678.'],
  ['an arXiv ID', 'Attention suffices (arXiv:1706.03762).'],
  ['a PMID', 'The trial was positive (PMID: 9500320).'],
  ['an author-year citation', 'Coherence is long lived (Engel et al., 2007).'],
  ['a narrative author-year citation', 'Engel and Fleming (2007) showed coherence is long lived.'],
];

for (const [what, draft] of RAW_FORMS) {
  test(`verify: ${what} typed as text is RAW_CITATION and blocks`, async () => {
    const r = await verifyDraft(`# Intro\n\n${draft}\n`);
    assertBlocked(r, /: \*\*RAW_CITATION\*\*/);
  });
}

test('verify: a bracketed citation with no parseable key is UNPARSEABLE and blocks', async () => {
  const r = await verifyDraft('# Intro\n\nCoherence is long lived [@ engel2007].\n');
  assertBlocked(r, /^- \[@ engel2007\]: \*\*UNPARSEABLE\*\*/m);
});

const QUOTE = 'coherence plays no role whatsoever in any photosynthetic energy transfer process observed to date';

const QUOTE_FORMS: Array<[string, string, string]> = [
  ['an APA page locator', `They wrote "${QUOTE}" [@ghostq1, p. 2].`, 'ghostq1'],
  ['an uppercase key', `They wrote "${QUOTE}" [@GhostQ2].`, 'GhostQ2'],
  ['a multi-cite cluster', `They wrote "${QUOTE}" [@ghostq3; @ghostq3b].`, 'ghostq3b'],
  ['a citation before the quote', `As @ghostq4 put it, "${QUOTE}".`, 'ghostq4'],
  ['single curly quotes', `They wrote ‘${QUOTE}’ [@ghostq5].`, 'ghostq5'],
  ['a citation inside a block quote', `Intro.\n\n> ${QUOTE}\n> and beyond [@ghostq6, p. 9]\n`, 'ghostq6'],
];

for (const [form, draft, key] of QUOTE_FORMS) {
  test(`verify: a quote cited with ${form} reaches Pass 3`, async () => {
    const r = await verifyDraft(`# Intro\n\n${draft}\n`);
    assert.match(r.verification, new RegExp(`^- ${key} \\("coherence plays no role`, 'm'), r.verification);
  });
}

// A long quotation with no citation cannot be checked against anything. It
// may be a source quoted without its citation, or the author's own data (an
// interview, a participant) or an epigraph. It does not block in this phase,
// but the section is not "verified" and verify says so.
const UNATTRIBUTED_FORMS: Array<[string, string]> = [
  ['a quotation nobody is credited with', `Someone once said "${QUOTE}" but nobody knows who.`],
  ['a participant quote from the author\'s own interviews', 'Participants often said "I just did not feel like the system cared about me or my family at all" in interviews.'],
  ['an epigraph block quote', '> The whole of science is nothing more than a refinement of everyday thinking, as anyone will tell you.\n\nThis section reviews the field.'],
];

for (const [what, draft] of UNATTRIBUTED_FORMS) {
  test(`verify: ${what} is UNATTRIBUTED, which leaves the section unverifiable and warns, but does not block`, async () => {
    const r = await verifyDraft(`# Intro\n\n${draft}\n`);
    assert.match(r.verification, /^- \(no citation\) \("[^\n]*\*\*UNATTRIBUTED\*\*/m, r.verification);
    assert.match(r.verification, /^Status: unverifiable$/m, r.verification);
    assert.equal(r.status, 0, `an unattributed quotation alone does not block\n${r.out}`);
    assert.equal(r.plan['status'], 'unverifiable');
    assert.match(r.out, /WARN — section 1 has 1 quotation with no citation/, r.out);
  });
}

// An earlier run's mark: a section verified against this exact hash.
const VERIFIED_PLAN = WRITTEN_PLAN.replace('status: written', "status: verified\nverified_against_draft_hash: 'earlier-run'");

test('verify: a refusal for a missing CITATIONS.bib leaves no earlier "verified" mark in PLAN.md', async () => {
  const r = await verifyDraft('# Intro\n\nCoherence is long lived [@engel2007].\n', null, VERIFIED_PLAN);
  assert.equal(r.status, 2);
  assert.notEqual(r.plan['status'], 'verified');
  assert.equal(r.plan['verified_against_draft_hash'], null);
});

test('verify: a refusal for a missing DRAFT.md leaves no earlier "verified" mark in PLAN.md', async () => {
  const r = await verifyDraft(null, REAL_BIB, VERIFIED_PLAN);
  assert.equal(r.status, 2);
  assert.notEqual(r.plan['status'], 'verified');
  assert.equal(r.plan['verified_against_draft_hash'], null);
});

for (const preDraft of ['planned', 'writing']) {
  test(`verify: a refusal for a missing DRAFT.md keeps a ${preDraft} section ${preDraft}, so the router still sends it on to plan or write`, async () => {
    const plan = WRITTEN_PLAN.replace('status: written', `status: ${preDraft}\nverified_against_draft_hash: 'earlier-run'`);
    const r = await verifyDraft(null, REAL_BIB, plan);
    assert.equal(r.status, 2);
    assert.equal(r.plan['status'], preDraft);
    assert.equal(r.plan['verified_against_draft_hash'], null);
  });
}
