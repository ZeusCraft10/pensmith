// tests/citation-clusters.test.ts — a Pandoc citation CLUSTER (`[@a; @b]`, a
// locator `[@a, p. 5]`, a prefix `[see @a]`) is never "absent" to a consumer
// that gates or repairs a draft (AUDIT-FINDINGS #2/#3, CLAUDE.md
// "Non-negotiables"). The drafter is told to write one bare `[@key]` per source,
// but a model or the humanizer can still write a cluster, so:
//   - GATE-04 (done.ts reCheckFinalMd) diffs the cited key sets with the broad
//     grammar — a key dropped from or swapped into a cluster is a hard block;
//   - the Pass-3 quote extractor attributes a quote followed by a cluster to
//     EVERY key in it (fail closed), and a locator is still an attribution;
//   - revise's mechanical remove and its swap edit a key inside a cluster;
//   - the GRND-06 density count counts every key of a cluster.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countCitations,
  extractCitedKeysForVerification,
  findCitationClusters,
  removeCitekey,
  renameCitekey,
  stripCitationClusters,
} from '../bin/lib/citation-token.js';
import { extractQuotes } from '../bin/lib/quote-extractor.js';
import { reCheckFinalMd } from '../bin/cli/done.js';
import { computeCitationDensity } from '../bin/lib/citation-density.js';
import { citationDensityForReport } from '../bin/lib/compile-report.js';
import { runRevise } from '../bin/lib/revise.js';
import { loadPrompt } from '../bin/lib/prompt-loader.js';

const QUOTE = 'attention mechanisms allow the model to relate every position of a sequence to every other position at once';

test('the drafter template asks for one bare [@key] per source (never a cluster or a locator)', () => {
  const t = loadPrompt('section-drafter');
  assert.match(t, /every citation is exactly `\[@citekey\]`, one\s+token per source/);
  assert.match(t, /For two sources write `\[@a\] \[@b\]`; never group keys in one\s+bracket/);
  assert.doesNotMatch(t, /`\[@a; @b\]` for two sources/);
});

test('findCitationClusters / countCitations / stripCitationClusters read every citation form', () => {
  const md = 'A [@a]. B [@b; @c]. C [see @d, p. 5; also @e]. Mail me at x@y.org [not a cite]. [@Upper2020]';
  assert.deepEqual(findCitationClusters(md).map((c) => c.keys), [['a'], ['b', 'c'], ['d', 'e'], ['Upper2020']]);
  assert.equal(countCitations(md), 6);
  assert.equal(stripCitationClusters('One [@a] two [@b; @c].'), 'One  two .');
  assert.deepEqual(extractCitedKeysForVerification(md), ['a', 'b', 'c', 'd', 'e', 'Upper2020']);
});

test('GATE-04: a key dropped from, or swapped into, a cluster by the humanizer is a hard block', async () => {
  const draft = 'Attention replaced recurrence [@vaswani2017; @bahdanau2015].';
  const swapped = await reCheckFinalMd('Attention replaced recurrence [@vaswani2017; @fabricated2099].', draft, '/nonexistent.bib');
  assert.equal(swapped.passed, false);
  assert.match(swapped.reason, /citekey-set mismatch after humanization — added: \[fabricated2099\]; dropped: \[bahdanau2015\]/);
  const dropped = await reCheckFinalMd('Attention replaced recurrence [@vaswani2017].', draft, '/nonexistent.bib');
  assert.equal(dropped.passed, false);
  assert.match(dropped.reason, /dropped: \[bahdanau2015\]/);
  // Rewriting a cluster as bare tokens keeps the set: not a change.
  const same = await reCheckFinalMd('Attention replaced recurrence [@vaswani2017] [@bahdanau2015].', draft, '/nonexistent.bib');
  assert.deepEqual(same, { passed: true, reason: '' });
});

test('Pass 3 input: a quote followed by a cluster is attributed to every key in it; a locator still attributes', () => {
  const bare = extractQuotes(`As noted, "${QUOTE}" [@vaswani2017].`);
  assert.deepEqual(bare.map((q) => q.citekey), ['vaswani2017']);
  const cluster = extractQuotes(`As noted, "${QUOTE}" [@vaswani2017; @fabricated2099].`);
  assert.deepEqual(cluster.map((q) => q.citekey), ['vaswani2017', 'fabricated2099'], 'fail closed: each cited source must hold the quote');
  assert.ok(cluster.every((q) => q.text === QUOTE && q.kind === 'inline'));
  const locator = extractQuotes(`As noted, “${QUOTE}” [@vaswani2017, p. 3].`);
  assert.deepEqual(locator.map((q) => q.citekey), ['vaswani2017']);
  const block = extractQuotes(`> ${QUOTE}\n\n[see @vaswani2017; @luong2015]\n`);
  assert.deepEqual(block.map((q) => [q.kind, q.citekey]), [['block', 'vaswani2017'], ['block', 'luong2015']]);
  // CRLF alike.
  assert.deepEqual(extractQuotes(`> ${QUOTE}\r\n\r\n[@vaswani2017; @luong2015]\r\n`).map((q) => q.citekey), ['vaswani2017', 'luong2015']);
});

test('removeCitekey / renameCitekey edit a key inside a cluster and keep bare-token behaviour', () => {
  // Bare tokens: the token and the space before it go; neighbours stay.
  assert.equal(removeCitekey('Claim [@k]. Other [@j].', 'k'), 'Claim. Other [@j].');
  assert.equal(removeCitekey('[@k] Starts the line.\nNext [@k]', 'k'), 'Starts the line.\nNext');
  // Inside a cluster: only that key's segment.
  assert.equal(removeCitekey('Two views [@a; @k].', 'k'), 'Two views [@a].');
  assert.equal(removeCitekey('Two views [see @k, p. 5; also @a].', 'k'), 'Two views [also @a].');
  assert.equal(removeCitekey('Key prefix [@k2; @k].', 'k'), 'Key prefix [@k2].', 'k2 is a different key');
  // Swap keeps prefixes and locators.
  assert.equal(renameCitekey('See [@k] and [see @a; @k, p. 5].', 'k', 'r'), 'See [@r] and [see @a; @r, p. 5].');
  assert.equal(renameCitekey('Near miss [@k2].', 'k', 'r'), 'Near miss [@k2].');
});

test('revise remove / swap act on a flagged key inside a cluster (the draft really changes)', async () => {
  const seed = (): { root: string; draft: string; plan: string } => {
    const root = mkdtempSync(join(tmpdir(), 'pensmith-cluster-revise-'));
    const dir = join(root, '.paper', 'sections', '02-target');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), 'The effect is established [@smith2020; @jones2019].\n');
    writeFileSync(join(dir, 'PLAN.md'), [
      '---', 'section: 2', 'slug: target', 'title: Target', 'depends_on: []',
      'assigned_sources:', '  - smith2020', '  - jones2019', '  - brown2018',
      "verified_against_draft_hash: 'deadbeefcafe'", 'status: failed', '---', '',
    ].join('\n'));
    writeFileSync(join(dir, 'VERIFICATION.md'), [
      '# VERIFICATION (Section 2, target)', '', 'Status: failed', '',
      '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)', '',
      '- smith2020: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed',
      '- jones2019: **FABRICATED** — titleJW=0.00, authorJW=0.00 — DOI did not resolve via Crossref', '',
    ].join('\n'));
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
    return { root, draft: join(dir, 'DRAFT.md'), plan: join(dir, 'PLAN.md') };
  };
  const proposal = (action: 'remove' | 'swap', replacement: string | null): string => JSON.stringify({
    action, flagged_citekey: 'jones2019', replacement_citekey: replacement, rationale: 'r',
    patch: { before_excerpt: '[@smith2020; @jones2019]', after_excerpt: '' },
  });

  const a = seed();
  let seen = '';
  const removed = await runRevise({
    paperRoot: a.root, n: 2, slug: 'target', yolo: true,
    proposeSwap: (vars) => { seen = vars.claim_context; return Promise.resolve(proposal('remove', null)); },
  });
  assert.equal(removed.accepted, true);
  assert.equal(seen, 'The effect is established [@smith2020; @jones2019].', 'the claim context is the line with the cluster');
  assert.equal(readFileSync(a.draft, 'utf8'), 'The effect is established [@smith2020].\n');
  assert.match(readFileSync(a.plan, 'utf8'), /verified_against_draft_hash:\s*(null|~)\s*$/m);

  const b = seed();
  const swapped = await runRevise({
    paperRoot: b.root, n: 2, slug: 'target', yolo: true,
    proposeSwap: () => Promise.resolve(proposal('swap', 'brown2018')),
  });
  assert.equal(swapped.accepted, true);
  assert.equal(readFileSync(b.draft, 'utf8'), 'The effect is established [@smith2020; @brown2018].\n');
});

test('GRND-06: the density count counts every key of a cluster (no false "BELOW band")', () => {
  const clustered = computeCitationDensity([{ n: 1, slug: 'a', text: 'One claim [@a; @b].\n\nAnother claim [@c; @d].\n' }], 'computer-science');
  const bare = computeCitationDensity([{ n: 1, slug: 'a', text: 'One claim [@a] [@b].\n\nAnother claim [@c] [@d].\n' }], 'computer-science');
  assert.equal(clustered.sections[0]!.citations, 4);
  assert.equal(clustered.sections[0]!.citations_per_paragraph, bare.sections[0]!.citations_per_paragraph);
  assert.equal(clustered.sections[0]!.status, bare.sections[0]!.status);
  // A lettered section is labelled as itself (GRND-09).
  const lettered = computeCitationDensity([{ n: 1, suffix: 'a', slug: 'background', text: 'No citation here at all.\n' }], 'computer-science');
  assert.equal(lettered.sections[0]!.suffix, 'a');
  assert.equal(lettered.warnings.length, 1, 'an uncited section is below the band');
  assert.ok(lettered.warnings[0]!.detail.startsWith('§1a (background): '), lettered.warnings[0]!.detail);
  assert.equal(citationDensityForReport(lettered).entries[0]!.section, '1a (background)', 'COMPILE-REPORT names §1a, not §1');
});
