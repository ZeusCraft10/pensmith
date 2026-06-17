// tests/revise-swap.test.ts — WRTE-02 / PLAN-02 / PLAN-03 / RSCH-10 (Plan 04-04).
//
// The single bin/lib/revise.ts chokepoint (D-06) backs both Tier 1 and Tier 2.
// `runRevise` parses the section's VERIFICATION.md for the first FABRICATED /
// MIS-CITED / NOT_FOUND verdict, asks an LLM (here: an injected `proposeSwap`
// seam fed from a cassette) for a citekey swap drawn ONLY from the section's
// assigned_sources, renders the diff behind the default-on approval gate
// (PRD §19), and on accept patches DRAFT.md atomically + resets
// verified_against_draft_hash to null.
//
// Test seams (mirror the 04-03 injectable-writeSection pattern so the chokepoint
// stays pure/testable and CI never touches a live LLM or an interactive TTY):
//   - proposeSwap(vars) — the LLM call seam. We feed the strict-JSON content
//     out of a cassette (tests/fixtures/cassettes/revise-swap/*.json).
//   - approve(proposal) — the approval-gate seam. Default is the clack TTY;
//     tests inject a deterministic boolean (and --yolo skips it entirely).
//   - researchAdapter(query) — the --research seam (PLAN-03). Returns synthetic
//     SourceCandidate-shaped hits so no network is touched.
//
// RED in Task 1 (bin/lib/revise.ts absent → import throws). GREEN in Task 2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCassetteFile } from '../bin/lib/http-mock.js';
import { runRevise } from '../bin/lib/revise.js';

// ---------------------------------------------------------------------------
// Cassette → strict-JSON content helper.
//
// Each revise-swap cassette is a one-element nock array whose response carries
// the LLM chat-completion body. We pull choices[0].message.content (the strict
// JSON string the prompt asks for) so the injected proposeSwap returns exactly
// what a live LLM would emit. runRevise owns the zod parse + membership check.
// ---------------------------------------------------------------------------
function cassetteContent(basename: string): string {
  const cs = loadCassetteFile('revise-swap', basename);
  assert.ok(cs && cs[0], `missing cassette revise-swap/${basename}`);
  const body = cs[0].response as { choices: Array<{ message: { content: string } }> };
  const content = body.choices?.[0]?.message?.content;
  assert.ok(typeof content === 'string', `cassette ${basename} has no message content`);
  return content;
}

// ---------------------------------------------------------------------------
// Fixture seeding.
//
// Seeds a .paper/ with two sections so cross-section isolation can be asserted:
//   sections/02-target/  — the section under revise (flagged jones2019)
//   sections/03-sibling/ — untouched neighbour (mtime/content guard)
// ---------------------------------------------------------------------------
const TARGET_DRAFT = [
  '# Target Section',
  '',
  'The mechanism is robust and the effect is well established [@jones2019].',
  'A second supporting line cites [@smith2020] for the baseline.',
  '',
].join('\n');

const TARGET_PLAN = [
  '---',
  'section: 2',
  'slug: target',
  'title: Target Section',
  'depends_on: []',
  'assigned_sources:',
  '  - smith2020',
  '  - jones2019',
  '  - brown2018',
  "verified_against_draft_hash: 'deadbeefcafe'",
  'status: failed',
  '---',
  '',
  '## Brief',
  '',
  'Establish the mechanism. Voice: declarative, comparative, avoid hedging.',
  '',
].join('\n');

const TARGET_VERIFICATION = [
  '# VERIFICATION (Section 2, target)',
  '',
  'Status: failed',
  '',
  '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
  '',
  '- smith2020: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed',
  '- jones2019: **FABRICATED** — titleJW=0.00, authorJW=0.00 — DOI did not resolve via Crossref',
  '',
].join('\n');

const SIBLING_DRAFT = '# Sibling Section\n\nUntouched neighbour cites [@smith2020].\n';

function seedFixture(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-revise-'));
  mkdirSync(join(root, '.paper', 'sections', '02-target'), { recursive: true });
  mkdirSync(join(root, '.paper', 'sections', '03-sibling'), { recursive: true });
  writeFileSync(join(root, '.paper', 'sections', '02-target', 'DRAFT.md'), TARGET_DRAFT);
  writeFileSync(join(root, '.paper', 'sections', '02-target', 'PLAN.md'), TARGET_PLAN);
  writeFileSync(join(root, '.paper', 'sections', '02-target', 'VERIFICATION.md'), TARGET_VERIFICATION);
  writeFileSync(join(root, '.paper', 'sections', '03-sibling', 'DRAFT.md'), SIBLING_DRAFT);
  // Project-level RESEARCH.md + bib for the --research case.
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research\n\nInitial findings.\n');
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  return { root };
}

const targetPlanPath = (root: string): string => join(root, '.paper', 'sections', '02-target', 'PLAN.md');
const targetDraftPath = (root: string): string => join(root, '.paper', 'sections', '02-target', 'DRAFT.md');
const targetVerifPath = (root: string): string => join(root, '.paper', 'sections', '02-target', 'VERIFICATION.md');

// ===========================================================================
// 1. Accept (--yolo) → DRAFT.md patched + verified_against_draft_hash reset null
// ===========================================================================
test('revise: --yolo accept swaps the flagged citekey and resets the hash to null', async () => {
  const { root } = seedFixture();
  const suggest = cassetteContent('revise-swap-suggest');

  const res = await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'target',
    yolo: true,
    proposeSwap: () => Promise.resolve(suggest),
  });

  assert.equal(res.action, 'swap');
  assert.equal(res.accepted, true);
  assert.equal(res.flagged_citekey, 'jones2019');
  assert.equal(res.replacement_citekey, 'smith2020');

  // DRAFT.md: the flagged token is gone, the replacement is present.
  const draft = readFileSync(targetDraftPath(root), 'utf8');
  assert.ok(!draft.includes('[@jones2019]'), 'flagged [@jones2019] must be gone from DRAFT.md');
  assert.match(draft, /\[@smith2020\]/, 'replacement [@smith2020] must be in DRAFT.md');

  // PLAN.md frontmatter: verified_against_draft_hash reset to null (D-05).
  const plan = readFileSync(targetPlanPath(root), 'utf8');
  assert.match(plan, /verified_against_draft_hash:\s*(null|~)\s*$/m, 'hash must be reset to null');
});

// ===========================================================================
// 2. Reject (approval gate returns false) → no-op, DRAFT.md unchanged, exit 0
// ===========================================================================
test('revise: a rejected proposal leaves DRAFT.md unchanged (no-op, exit 0)', async () => {
  const { root } = seedFixture();
  const rejected = cassetteContent('revise-swap-rejected');
  const before = readFileSync(targetDraftPath(root), 'utf8');
  const planBefore = readFileSync(targetPlanPath(root), 'utf8');

  const res = await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'target',
    yolo: false,
    proposeSwap: () => Promise.resolve(rejected),
    approve: () => Promise.resolve(false), // user declines at the gate
  });

  assert.equal(res.accepted, false);
  assert.equal(readFileSync(targetDraftPath(root), 'utf8'), before, 'DRAFT.md must be byte-identical after a reject');
  assert.equal(readFileSync(targetPlanPath(root), 'utf8'), planBefore, 'PLAN.md must be unchanged after a reject');
});

// ===========================================================================
// 3. --yolo retry exhaustion (2 failed proposals) → RETRY_EXHAUSTED in VERIFICATION.md
// ===========================================================================
test('revise: --yolo exhausts after 2 retries and writes RETRY_EXHAUSTED', async () => {
  const { root } = seedFixture();
  const draftBefore = readFileSync(targetDraftPath(root), 'utf8');
  let calls = 0;

  // Every proposal is invalid (replacement not in assigned_sources) → rejected
  // by the membership check → --yolo retries up to the cap, then exhausts.
  const res = await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'target',
    yolo: true,
    proposeSwap: () => {
      calls++;
      return Promise.resolve(JSON.stringify({
        action: 'swap',
        flagged_citekey: 'jones2019',
        replacement_citekey: 'not-in-assigned-sources',
        rationale: 'invalid replacement',
        patch: { before_excerpt: '[@jones2019]', after_excerpt: '[@not-in-assigned-sources]' },
      }));
    },
  });

  assert.equal(res.accepted, false);
  assert.equal(res.retryExhausted, true, 'must report retry exhaustion');
  assert.ok(calls <= 3, `retry cap is 2 (max 3 total attempts); got ${calls} calls`);
  assert.equal(readFileSync(targetDraftPath(root), 'utf8'), draftBefore, 'DRAFT.md must be untouched on exhaustion');
  const verif = readFileSync(targetVerifPath(root), 'utf8');
  assert.match(verif, /RETRY_EXHAUSTED/, 'VERIFICATION.md must carry the RETRY_EXHAUSTED verdict (D-06)');
});

// ===========================================================================
// 3b. Membership guard: a replacement outside assigned_sources is rejected
//     even on a single (non-yolo) accept attempt (T-04-14 mitigation).
// ===========================================================================
test('revise: rejects an LLM replacement_citekey not in assigned_sources', async () => {
  const { root } = seedFixture();
  const before = readFileSync(targetDraftPath(root), 'utf8');

  const res = await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'target',
    yolo: false,
    proposeSwap: () => Promise.resolve(JSON.stringify({
      action: 'swap',
      flagged_citekey: 'jones2019',
      replacement_citekey: 'evil-injected-key',
      rationale: 'injection attempt',
      patch: { before_excerpt: '[@jones2019]', after_excerpt: '[@evil-injected-key]' },
    })),
    approve: () => Promise.resolve(true), // user would accept, but membership guard blocks first
  });

  assert.equal(res.accepted, false, 'out-of-list replacement must never be applied');
  assert.ok(res.rejectedReason && /assigned_sources|not in/i.test(res.rejectedReason));
  assert.equal(readFileSync(targetDraftPath(root), 'utf8'), before, 'DRAFT.md must be unchanged');
});

// ===========================================================================
// 4. remove action → mechanical bracket-clause delete (no LLM prose rewrite)
// ===========================================================================
test('revise: --yolo remove deletes the flagged citation mechanically', async () => {
  const { root } = seedFixture();
  const remove = cassetteContent('revise-swap-remove');

  const res = await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'target',
    yolo: true,
    proposeSwap: () => Promise.resolve(remove),
  });

  assert.equal(res.action, 'remove');
  assert.equal(res.accepted, true);
  const draft = readFileSync(targetDraftPath(root), 'utf8');
  assert.ok(!draft.includes('[@jones2019]'), 'flagged token must be removed from DRAFT.md');
  // The OTHER citation must survive — remove is surgical, not a rewrite.
  assert.match(draft, /\[@smith2020\]/, 'unrelated citation must survive a remove');
  const plan = readFileSync(targetPlanPath(root), 'utf8');
  assert.match(plan, /verified_against_draft_hash:\s*(null|~)\s*$/m, 'hash must be reset on remove too');
});

// ===========================================================================
// 5. --research appends to project RESEARCH.md AND section RESEARCH-LOG.md,
//    leaving a SIBLING section's files untouched (PLAN-03 / D-09 isolation).
// ===========================================================================
test('revise --research: section-scoped append, sibling untouched (PLAN-03 / D-09)', async () => {
  const { root } = seedFixture();
  const siblingDraft = join(root, '.paper', 'sections', '03-sibling', 'DRAFT.md');
  const researchMd = join(root, '.paper', 'RESEARCH.md');
  const logPath = join(root, '.paper', 'sections', '02-target', 'RESEARCH-LOG.md');

  // Backdate the sibling so an unintended touch would change its mtime.
  const past = new Date(Date.now() - 60_000);
  utimesSync(siblingDraft, past, past);
  const siblingBefore = readFileSync(siblingDraft, 'utf8');
  const siblingMtimeBefore = statSync(siblingDraft).mtimeMs;
  const researchBefore = readFileSync(researchMd, 'utf8');

  const res = await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'target',
    yolo: true,
    research: 'mechanism robustness follow-up',
    researchAdapter: () => Promise.resolve([
      { citekey: 'wu2021', title: 'Robustness of the Mechanism', authors: ['Wu, A.'], year: 2021, doi: '10.1000/wu2021', source: 'openalex' },
    ]),
  });

  assert.equal(res.researchApplied, true);

  // Project RESEARCH.md grew (append, not overwrite).
  const researchAfter = readFileSync(researchMd, 'utf8');
  assert.ok(researchAfter.startsWith(researchBefore), 'RESEARCH.md must be appended to, not rewritten');
  assert.ok(researchAfter.length > researchBefore.length, 'RESEARCH.md must grow');
  assert.match(researchAfter, /mechanism robustness follow-up/, 'query must be recorded in RESEARCH.md');

  // Section provenance log created/appended (the ONLY section-level file --research writes).
  assert.ok(existsSync(logPath), 'sections/02-target/RESEARCH-LOG.md must exist');
  const log = readFileSync(logPath, 'utf8');
  assert.match(log, /mechanism robustness follow-up/, 'RESEARCH-LOG.md must record the query');
  assert.match(log, /wu2021/, 'RESEARCH-LOG.md must record the added citekey');

  // Sibling section untouched (content AND mtime).
  assert.equal(readFileSync(siblingDraft, 'utf8'), siblingBefore, 'sibling DRAFT.md content must be unchanged');
  assert.equal(statSync(siblingDraft).mtimeMs, siblingMtimeBefore, 'sibling DRAFT.md mtime must be unchanged');
});
