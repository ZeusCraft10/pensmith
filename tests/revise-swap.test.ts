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
//
// `--research <query>` is no longer part of runRevise: `plan N --research` and
// `revise N --research` run bin/lib/section-research.ts (GRND-17, D-19-18),
// covered by tests/section-research.test.ts and tests/plan-research-cli.test.ts.
// The old research test here injected a `researchAdapter` whose production
// default returned no hits; that seam and its applyResearch are deleted.
//
// RED in Task 1 (bin/lib/revise.ts absent → import throws). GREEN in Task 2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCassetteFile } from '../bin/lib/http-mock.js';
import { runRevise, failingCitations, firstFailingCitation, REVISABLE_VERDICTS } from '../bin/lib/revise.js';
import { proposeSwap } from '../bin/lib/revise-swap.js';
import { loadPrompt } from '../bin/lib/prompt-loader.js';
import { promptHints } from '../bin/lib/prompt-request.js';
import { FENCE_OPEN } from '../bin/lib/untrusted-fence.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';

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

test('revise (review round 1): a flagged citation an earlier revise already removed is skipped — the next one still in DRAFT.md is repaired; none left is "nothing to change", no model call', async () => {
  const { root } = seedFixture();
  // Two flagged rows; the first (jones2019) was removed by an earlier revise, VERIFICATION.md not yet re-run.
  writeFileSync(targetVerifPath(root), TARGET_VERIFICATION + '- brown2018: **MIS-CITED** — titleJW=0.41, authorJW=1.00 — JW below threshold\n');
  writeFileSync(targetDraftPath(root), 'The effect is established.\nA second line cites [@smith2020] and [@brown2018].\n');
  const asked: string[] = [];
  const res = await runRevise({
    paperRoot: root, n: 2, slug: 'target', yolo: true,
    proposeSwap: (vars) => {
      asked.push(vars.flagged_citekey);
      return Promise.resolve(JSON.stringify({ action: 'remove', flagged_citekey: vars.flagged_citekey, replacement_citekey: null, rationale: 'r', patch: { before_excerpt: 'a', after_excerpt: 'b' } }));
    },
  });
  assert.deepEqual(asked, ['brown2018'], 'the citation still in the draft is the one proposed');
  assert.equal(res.accepted, true);
  assert.equal(res.flagged_citekey, 'brown2018');
  assert.doesNotMatch(readFileSync(targetDraftPath(root), 'utf8'), /brown2018/);

  // Every flagged citation is gone now: a third run changes nothing and says so.
  const before = readFileSync(targetDraftPath(root), 'utf8');
  const planBefore = readFileSync(targetPlanPath(root), 'utf8');
  const again = await runRevise({ paperRoot: root, n: 2, slug: 'target', yolo: true, proposeSwap: () => Promise.reject(new Error('no model call expected')) });
  assert.equal(again.accepted, false);
  assert.match(again.message, /^Nothing to change: every citation VERIFICATION\.md flags in section 2 \(jones2019, brown2018\) is already gone from DRAFT\.md — re-check the section with `pensmith verify 2`\.$/);
  assert.equal(readFileSync(targetDraftPath(root), 'utf8'), before, 'DRAFT.md unchanged');
  assert.equal(readFileSync(targetPlanPath(root), 'utf8'), planBefore, 'PLAN.md unchanged (no hash reset reported as applied)');
});

test('revise (review round 2): text rows (L<line>, a bare doi:…) are not citations — never "already gone", named with the edit or re-draft that fixes them, no model call', async () => {
  const { root } = seedFixture();
  const textOnly = [
    '# VERIFICATION (Section 2, target)',
    '',
    'Status: failed',
    '',
    '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
    '',
    '- smith2020: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed',
    '- L3: **UNPARSEABLE** — titleJW=n/a, authorJW=n/a — `[@smith2020`: `[@smith2020` is never closed in its paragraph',
    '- doi:10.5555/pensmith-no-such-work-2017: **FABRICATED** — titleJW=0.00, authorJW=0.00 — DOI did not resolve via Crossref',
    '',
  ].join('\n');
  assert.deepEqual(failingCitations(textOnly), [], 'no citekey among the text rows');
  writeFileSync(targetVerifPath(root), textOnly);
  const before = readFileSync(targetDraftPath(root), 'utf8');
  const res = await runRevise({ paperRoot: root, n: 2, slug: 'target', yolo: true, proposeSwap: () => Promise.reject(new Error('no model call expected')) });
  assert.equal(res.accepted, false);
  assert.doesNotMatch(res.message, /already gone/);
  assert.match(res.message, /^No citation in section 2 for revise to swap\. VERIFICATION\.md flags text that is not a citation revise can swap — L3 \(UNPARSEABLE\), doi:10\.5555\/pensmith-no-such-work-2017 \(FABRICATED\): edit that text in DRAFT\.md \(a citation written as \[@citekey\]\) or re-draft the section \(`pensmith write 2`\), then `pensmith verify 2`\.$/);
  assert.equal(readFileSync(targetDraftPath(root), 'utf8'), before, 'DRAFT.md unchanged');
});

test('revise (Phase 20 + 23a merge, review round 2): a bibliography entry\'s UNPARSEABLE row is still a citation revise repairs; an UNVERIFIABLE-QUOTE is named with the routes that paraphrase it', async () => {
  const bibRow = '- brown2018: **UNPARSEABLE** — titleJW=n/a, authorJW=n/a — the CITATIONS.bib entry brown2018 (line 4) does not parse';
  assert.deepEqual(failingCitations(bibRow).map((f) => f.citekey), ['brown2018'], "a bibliography entry's UNPARSEABLE row is keyed by its citekey");

  const { root } = seedFixture();
  const quoteRow = '- smith2020 [q1] ("the quick brown fox jumps…"): **UNVERIFIABLE-QUOTE** — lev=0.000 — no open-access copy';
  const acceptedRow = '- smith2020 [q2] ("a second quoted sentence…"): **UNVERIFIABLE-QUOTE** — lev=0.000 — no open-access copy — accepted by you 2026-09-30T10:00:00.000Z (--accept-quote)';
  writeFileSync(targetVerifPath(root), ['# VERIFICATION (Section 2, target)', '', 'Status: unverifiable', '', '## Pass-3', '', quoteRow, acceptedRow, ''].join('\n'));
  const before = readFileSync(targetDraftPath(root), 'utf8');
  const res = await runRevise({ paperRoot: root, n: 2, slug: 'target', yolo: true, proposeSwap: () => Promise.reject(new Error('no model call expected')) });
  assert.equal(res.accepted, false);
  assert.match(
    res.message,
    /^No FABRICATED\/MIS-CITED\/NOT_FOUND citation \(nor RETRACTED, UNASSIGNED, UNPARSEABLE or UNRESOLVABLE\) in section 2\. revise cannot paraphrase quote\(s\) q1, which no source text could be checked against: paraphrase \(re-draft with `pensmith write 2`, or edit DRAFT\.md and run `pensmith verify 2`\), add the source's PDF \(`pensmith add <pdf>`\), or accept a quote \(`pensmith verify 2 --accept-quote q1`\)\.$/,
    'the accepted quote q2 is not named',
  );
  assert.equal(readFileSync(targetDraftPath(root), 'utf8'), before, 'DRAFT.md unchanged');
});

// ===========================================================================
// 5. runRevise has no research branch any more (GRND-17 moved it to
//    bin/lib/section-research.ts): the options it accepts are the swap loop's.
// ===========================================================================
test('revise: runRevise no longer takes a research query (GRND-17 — section-research.ts owns --research)', async () => {
  const src = readFileSync(new URL('../bin/lib/revise.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /researchAdapter|applyResearch/, 'the injected-adapter research branch is deleted');
  const cli = readFileSync(new URL('../bin/cli/revise.ts', import.meta.url), 'utf8');
  assert.match(cli, /runSectionResearch\(/, 'revise --research routes to the section research pass');
  const plan = readFileSync(new URL('../bin/cli/plan.ts', import.meta.url), 'utf8');
  assert.match(plan, /runSectionResearch\(/, 'plan --research routes to the section research pass');
});

// ===========================================================================
// 6. The real proposeSwap (bin/lib/revise-swap.ts) — request shape (D-18-03/04,
//    RUN-26, FEED-05) and its PENSMITH_NO_LLM stub (GRND-19, D-18-06).
// ===========================================================================

const SWAP_VARS = {
  flagged_citekey: 'jones2019',
  verifier_reason: 'FABRICATED — DOI did not resolve via Crossref',
  claim_context: 'The mechanism is robust and the effect is well established [@jones2019].',
  available_sources: '- smith2020\n- jones2019\n- brown2018',
  voice_hint: 'Voice: declarative, comparative, avoid hedging.',
};

test('revise-swap: the request is the fixed template + data blocks (library metadata, claim and sources fenced)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-ant-test-revise-swap-0001' } }, async (sb) => {
    writeFileSync(join(sb.paper, 'LIBRARY.json'), JSON.stringify({
      $schemaVersion: 2,
      entries: [
        { citekey: 'smith2020', title: 'Baseline mechanisms', authors: ['Smith, Ann'], year: 2020, addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
    }));
    sb.mock!.script('revise-swap', { text: JSON.stringify({ action: 'remove', flagged_citekey: 'jones2019', replacement_citekey: null, rationale: 'r', patch: { before_excerpt: '[@jones2019]', after_excerpt: '' } }) });
    const raw = await proposeSwap(SWAP_VARS);
    assert.equal((JSON.parse(raw) as { action: string }).action, 'remove');
    const body = sb.mock!.bodiesFor('revise-swap')[0]!;
    assert.deepEqual(body['system'], [{ type: 'text', text: loadPrompt('revise-swap'), cache_control: { type: 'ephemeral' } }]);
    const content = (body['messages'] as Array<{ content: string }>)[0]!.content;
    const hints = promptHints(content);
    assert.deepEqual(hints['flag'], { flagged_citekey: 'jones2019', verifier_reason: SWAP_VARS.verifier_reason });
    assert.equal(hints['voice'], SWAP_VARS.voice_hint);
    assert.deepEqual(hints['available_sources'], [
      { citekey: 'smith2020', title: 'Baseline mechanisms', authors: ['Smith, Ann'], year: 2020 },
      { citekey: 'jones2019', title: null, authors: [], year: null },
      { citekey: 'brown2018', title: null, authors: [], year: null },
    ]);
    assert.equal(hints['claim'], SWAP_VARS.claim_context);
    // The claim and the source list are fenced; the flag and voice are not.
    assert.equal(content.split(FENCE_OPEN).length - 1, 2);
    assert.ok(content.indexOf('<flag>') < content.indexOf('<voice>'));
    assert.ok(content.indexOf('<available_sources>') < content.indexOf('<claim>'));
  });
});

test('revise-swap: under PENSMITH_NO_LLM the stub removes the flagged citation through runRevise (no request)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    const parsed = JSON.parse(await proposeSwap(SWAP_VARS)) as Record<string, unknown>;
    assert.equal(parsed['action'], 'remove');
    assert.equal(parsed['flagged_citekey'], 'jones2019');
    assert.equal(parsed['replacement_citekey'], null);
    assert.equal(sb.mock!.callCount(), 0);

    const { root } = seedFixture();
    const res = await runRevise({ paperRoot: root, n: 2, slug: 'target', yolo: true, proposeSwap });
    assert.equal(res.action, 'remove');
    assert.equal(res.accepted, true);
    const draft = readFileSync(targetDraftPath(root), 'utf8');
    assert.ok(!draft.includes('[@jones2019]'));
    assert.match(draft, /\[@smith2020\]/);
  });
});

// Review round 3 (WRTE-02): a Phase 18 planned PLAN.md carries the planner's
// voice as a `## Voice` section (plan-render.ts), not a `Voice:` line — the
// revise-swap request gets THAT voice, never the default.
test('revise: the swap request carries the planned `## Voice`, then the outline frontmatter voice, then the default', async () => {
  const { renderPlannedPlanMd } = await import('../bin/lib/plan-render.js');
  const { voiceHint } = await import('../bin/lib/revise.js');
  const { root } = seedFixture();
  const fields = { section: 2, slug: 'target', title: 'Target Section', depends_on: [], assigned_sources: ['smith2020', 'jones2019', 'brown2018'] };
  const planned = renderPlannedPlanMd(fields, {
    claims: [{ claim: 'The mechanism is robust.', sources: ['jones2019'], evidence: 'e', counterexamples: '' }],
    structure: [{ paragraph: 1, purpose: 'Establish it', claims: [1] }],
    voice: 'academic-formal, comparative',
  }).replace('status: planned', 'status: failed');
  writeFileSync(targetPlanPath(root), planned);
  let seen = '';
  await runRevise({
    paperRoot: root,
    n: 2,
    slug: 'target',
    yolo: true,
    proposeSwap: (vars) => {
      seen = vars.voice_hint;
      return Promise.resolve(cassetteContent('revise-swap-suggest'));
    },
  });
  assert.equal(seen, 'Voice: academic-formal, comparative');
  assert.equal(voiceHint('---\nvoice: plain and direct\n---\n\n## Outline entry\n\nx\n'), 'Voice: plain and direct', 'a stub: the outline row voice');
  assert.equal(voiceHint('---\nsection: 1\n---\n\n## Brief\n\nVoice: terse\n'), 'Voice: terse', 'a legacy PLAN.md');
  assert.equal(voiceHint('---\nsection: 1\n---\n\n## Voice\n\n(no voice direction)\n'), 'Voice: formal academic tone.');
});

test('Phase 20 (D-20-20): revise reads every citekey-bearing failing row — RETRACTED, UNASSIGNED, UNPARSEABLE, UNRESOLVABLE and a `[qN]` NOT_FOUND quote row — and leaves the rows without a citekey to a re-plan', () => {
  const md = [
    'Status: failed',
    '',
    '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
    '',
    '- lecun2015: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed',
    '- lecun2015: **UNASSIGNED** — titleJW=n/a, authorJW=n/a — not in section 1\'s assigned_sources',
    '- Wakefield:1998: **RETRACTED** — titleJW=1.00, authorJW=1.00 — cited work is retracted',
    '- brokenEntry2020: **UNPARSEABLE** — titleJW=n/a, authorJW=n/a — its entry (line 4) does not parse',
    '- nobody2019: **UNRESOLVABLE** — titleJW=n/a, authorJW=n/a — no registrar has this work',
    '- L7: **UNSUPPORTED-FORM** — titleJW=n/a, authorJW=n/a — a citation form the grammar cannot read',
    '',
    '## Pass-3 (quote integrity, deterministic — levenshtein-substring)',
    '',
    '- smith2020 [q1] ("the quoted words that are not in the so…"): **NOT_FOUND** — lev=0.410 — quote not found',
    '- (unattributed) [q2] ("a quote with no citation at all in the…"): **UNATTRIBUTED** — lev=0.000 — no citation',
    '',
    '## Draft checks',
    '',
    '- draft: **NO-CITATIONS** — no citations; 2 sources assigned',
    '',
  ].join('\n');
  assert.deepEqual(
    failingCitations(md).map((f) => [f.citekey, f.reason.split(':')[0]]),
    [['lecun2015', 'UNASSIGNED'], ['Wakefield:1998', 'RETRACTED'], ['brokenEntry2020', 'UNPARSEABLE'], ['nobody2019', 'UNRESOLVABLE'], ['smith2020', 'NOT_FOUND']],
  );
  assert.equal(firstFailingCitation(md)?.citekey, 'lecun2015');
  assert.deepEqual([...REVISABLE_VERDICTS], ['FABRICATED', 'MIS-CITED', 'RETRACTED', 'UNASSIGNED', 'UNPARSEABLE', 'UNRESOLVABLE', 'NOT_FOUND']);
  // A pre-Phase-20 quote row (no id) still reads.
  assert.equal(firstFailingCitation('- smith2020 ("old style quote row snippet…"): **NOT_FOUND** — lev=0.2 — x\n')?.citekey, 'smith2020');
});
