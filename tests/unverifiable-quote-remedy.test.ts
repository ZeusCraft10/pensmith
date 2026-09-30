// tests/unverifiable-quote-remedy.test.ts — the paraphrase the refusals name
// for a quote no source text can check actually resolves it (Phase 20 + 23a
// merge, review round 2).
//
// Every surface — `pensmith status` (router.ts unverifiableSectionDetail),
// compile's and done's refusals (gate.ts gateRowReason, verdict-rows.ts) and
// the next workflow — named `pensmith plan N --revise` as the paraphrase. It
// is not one: revise swaps or removes a flagged citekey, and it skips
// UNVERIFIABLE-QUOTE rows ("No FABRICATED/MIS-CITED/NOT_FOUND citation …").
// The surfaces now name a re-draft (`pensmith write N`, whose drafter may quote
// only a source with full text — GRND-14) or an edit of the draft and
// `pensmith verify N`. This suite runs both and checks the section verifies.
//
// Offline: lecun2015 is added by its recorded Crossref answer; no contact
// email, so Pass 3 cannot ask Unpaywall and the quote is UNVERIFIABLE-QUOTE
// (D-20-03). The RUN-21 mock LLM answers the drafter.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { writeOutline, writePlan, writeState, sectionDirOf } from './helpers/paper-cli-harness.js';
import { runRevise } from '../bin/lib/revise.js';

const KEY = 'sk-test-unverifiable-quote-remedy-01';
/** No contact email: Pass 3 never asks Unpaywall, whatever the developer's shell exports. */
const ENV = { ANTHROPIC_API_KEY: KEY, PENSMITH_CONTACT_EMAIL: undefined } as const;
const QUOTE = 'attention mechanisms are nothing more than lookup tables for bananas';
const QUOTED = `Deep learning reshaped the field [@lecun2015]. One review claims that "${QUOTE}" [@lecun2015].\n`;
const PARAPHRASED = 'Deep learning reshaped the field [@lecun2015]. One review treats attention as little more than a lookup step [@lecun2015].\n';

/** A written section quoting lecun2015 with no source text to check: verify makes it unverifiable (exit 4). */
async function unverifiableSection(sb: LlmSandbox): Promise<string> {
  writeState(sb.root, [], 'unverifiable-quote-remedy');
  const added = await sb.runTsx(null, ['add', '10.1038/nature14539', '--yolo'], { env: ENV });
  assert.equal(added.status, 0, `${added.stdout}\n${added.stderr}`);
  writeState(sb.root, [{ n: 1, slug: 'intro' }], 'unverifiable-quote-remedy');
  writeOutline(sb.root, [{ n: 1, slug: 'intro', sources: ['lecun2015'] }]);
  writePlan(sb.root, 1, 'intro', { status: 'written', assigned_sources: '[lecun2015]' });
  const dir = sectionDirOf(sb.root, 1, 'intro');
  fs.writeFileSync(path.join(dir, 'DRAFT.md'), `# Intro\n\n${QUOTED}`);

  const v = await sb.runTsx(null, ['verify', '1', '--yolo'], { env: ENV });
  assert.equal(v.status, 4, `${v.stdout}\n${v.stderr}`);
  const md = fs.readFileSync(path.join(dir, 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: unverifiable$/m);
  assert.match(md, /^- lecun2015 \[q1\] \("attention mechanisms are nothing more th…"\): \*\*UNVERIFIABLE-QUOTE\*\*/m);

  // What the user is told: the re-draft or the edit, never `plan 1 --revise`.
  const st = await sb.runTsx(null, ['status'], { env: ENV });
  assert.equal(st.status, 0, st.stderr);
  assert.match(st.stdout, /could not be checked against any source text — .*paraphrase \(re-draft with `pensmith write 1`, or edit its DRAFT\.md and run `pensmith verify 1`\)/);
  assert.doesNotMatch(st.stdout, /--revise/);
  const compile = await sb.runTsx(null, ['compile', '--yolo'], { env: ENV });
  assert.equal(compile.status, 4, `${compile.stdout}\n${compile.stderr}`);
  assert.match(compile.stdout + compile.stderr, /is UNVERIFIABLE-QUOTE — .*paraphrase the quote \(re-draft with `pensmith write 1`, or edit the section's DRAFT\.md and run `pensmith verify 1`\)/);
  assert.doesNotMatch(compile.stdout + compile.stderr, /--revise/);
  return dir;
}

test('review round 2: `plan 1 --revise` — the remedy the surfaces used to name — changes nothing on an UNVERIFIABLE-QUOTE section and says what does', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const dir = await unverifiableSection(sb);
    const before = fs.readFileSync(path.join(dir, 'DRAFT.md'), 'utf8');
    const res = await runRevise({ paperRoot: sb.root, n: 1, slug: 'intro', yolo: true, proposeSwap: () => Promise.reject(new Error('no model call expected')) });
    assert.equal(res.accepted, false);
    assert.match(res.message, /--revise cannot repair this: quote\(s\) q1 could not be checked against any source text — paraphrase \(re-draft with `pensmith write 1`/);
    assert.equal(fs.readFileSync(path.join(dir, 'DRAFT.md'), 'utf8'), before, 'DRAFT.md unchanged');
  });
});

test('review round 2: `pensmith write 1` — the named re-draft — resolves an UNVERIFIABLE-QUOTE section: the drafter is told to paraphrase and the section verifies', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const dir = await unverifiableSection(sb);
    // The drafter quotes the abstract-only source again; its one corrective turn asks for a paraphrase.
    sb.mock!.script('section-drafter', { text: QUOTED }, { text: PARAPHRASED });
    const w = await sb.runTsx(null, ['write', '1', '--yolo'], { env: ENV });
    assert.equal(w.status, 0, `${w.stdout}\n${w.stderr}`);
    assert.equal(sb.mock!.callCount('section-drafter'), 2, 'one corrective turn');
    const correction = JSON.stringify((sb.mock!.bodiesFor('section-drafter')[1]!['messages'] as unknown[]).at(-1));
    assert.match(correction, /paraphrase them, or quote only a source marked full_text: true/);
    assert.ok(!fs.readFileSync(path.join(dir, 'DRAFT.md'), 'utf8').includes(QUOTE), 'the kept draft paraphrases');
    const md = fs.readFileSync(path.join(dir, 'VERIFICATION.md'), 'utf8');
    assert.match(md, /^Status: verified$/m);
    assert.doesNotMatch(md, /UNVERIFIABLE-QUOTE/);
    assert.match(fs.readFileSync(path.join(dir, 'PLAN.md'), 'utf8'), /^status: verified$/m);
  });
});

test('review round 2: an edit of the draft and `pensmith verify 1` — the other named route — resolves it with no model call', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const dir = await unverifiableSection(sb);
    const calls = sb.mock!.callCount('section-drafter');
    fs.writeFileSync(path.join(dir, 'DRAFT.md'), `# Intro\n\n${PARAPHRASED}`);
    const v = await sb.runTsx(null, ['verify', '1', '--yolo'], { env: ENV });
    assert.equal(v.status, 0, `${v.stdout}\n${v.stderr}`);
    assert.match(fs.readFileSync(path.join(dir, 'VERIFICATION.md'), 'utf8'), /^Status: verified$/m);
    assert.equal(sb.mock!.callCount('section-drafter'), calls, 'no drafter call');
  });
});
