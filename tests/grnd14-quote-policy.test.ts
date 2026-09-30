// tests/grnd14-quote-policy.test.ts — GRND-14 acceptance (the Phase 18/19
// merge; 19-SUMMARY merge notes, "Closer" row): the drafter may quote directly
// only from a source whose full text Pass 3 can check.
//
//   (1) The captured `section-drafter` request marks `full_text` true for a
//       bring-your-own PDF (re-verified through byo-text.ts at request time),
//       an Unpaywall open-access PDF (`oa_url` with a DOI) and an arXiv id, and
//       false for an abstract-only source — and for a BYO PDF deleted since
//       ingest (the recorded hashes alone never count).
//   (2) A mock drafter quoting the abstract-only source gets ONE corrective
//       turn (draft-containment.ts `quote-without-full-text`, the text of
//       full-text.ts describeQuotesWithoutFullText), and the kept draft quotes
//       only full-text sources; a second violation is rejected like FEED-04's
//       (DRAFT.rejected.md, `status: failed` + `failure_reason`, exit 4).
//
// Through the CLI (`pensmith write`) with the RUN-21 mock LLM; no network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { libraryEntry, outlineSection, seedBriefPaper } from './helpers/section-fixture.js';
import { numberFreshOutline, registerSections } from '../bin/lib/section-stubs.js';
import { renderOutlineMd } from '../bin/lib/outline-parse.js';
import { renderPlannedPlanMd } from '../bin/lib/plan-render.js';
import { parsePromptBlocks } from '../bin/lib/prompt-request.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';
import { extractPdf } from '../bin/lib/pdf-text.js';
import { quotesWithoutFullText } from '../bin/lib/full-text.js';

const KEY = 'sk-test-grnd14-quote-policy-0001';
const PDF = fs.readFileSync(fileURLToPath(new URL('./fixtures/pdf/byo-text.pdf', import.meta.url)));

/** The section's sources, one per kind of full-text basis. */
const OWN = 'owncopy2017'; // a bring-your-own PDF that still verifies
const OA = 'oapaper2020'; // an Unpaywall-confirmed open-access PDF of its DOI
const ARXIV = 'arxivpaper2017'; // an arXiv id (Pass 3 fetches its arXiv PDF)
const ABSTRACT = 'abstractonly2019'; // a DOI and an abstract, nothing more
const MOVED = 'movedcopy2018'; // a bring-your-own PDF deleted since ingest
const SOURCES = [OWN, OA, ARXIV, ABSTRACT, MOVED];

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A direct quote Pass 3 would check (≥ 10 words, ≥ 60 characters), attributed to `key`. */
function quoteOf(key: string, words: string): string {
  return `As the authors put it, "${words}" [@${key}].`;
}
const ABSTRACT_QUOTE = 'attention layers learn alignments between every source and target position in one step';
const OWN_QUOTE = 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks';

/** One planned section citing the five sources, with a real BYO PDF for OWN and a missing one for MOVED. */
async function paper(sb: LlmSandbox): Promise<string> {
  await seedBriefPaper(sb.root);
  const text = (await extractPdf(PDF)).text;
  const byo = { file: `sources/${OWN}.pdf`, sha256: sha256(PDF), text_sha256: sha256(text), asserted: false };
  fs.mkdirSync(path.join(sb.paper, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(sb.paper, 'sources', `${OWN}.pdf`), PDF);
  const entry = (citekey: string, over: Record<string, unknown>): Record<string, unknown> => ({
    ...libraryEntry({ citekey, title: `The ${citekey} study`, author: 'Doe, Jane', year: 2019, abstract: 'An abstract about attention.' }),
    ...over,
  });
  const entries = [
    entry(OWN, { byo }),
    entry(OA, { oa_url: 'https://example.org/oapaper2020.pdf' }),
    entry(ARXIV, { doi: null, arxiv: '1706.03762' }),
    entry(ABSTRACT, {}),
    entry(MOVED, { byo: { file: `sources/${MOVED}.pdf`, sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64), asserted: false } }),
  ];
  fs.writeFileSync(path.join(sb.paper, 'LIBRARY.json'), `${JSON.stringify({ $schemaVersion: 2, entries }, null, 2)}\n`);

  const sections = numberFreshOutline([outlineSection(1, 'background', { role: 'intro', assigned_sources: SOURCES })]);
  fs.writeFileSync(path.join(sb.paper, 'OUTLINE.md'), renderOutlineMd({ thesis: 'Attention replaced recurrence.', sections }, 'Attention'));
  await registerSections(sb.root, sections);
  const e = sections[0]!;
  const planPath = path.join(sb.paper, 'sections', '01-background', 'PLAN.md');
  fs.writeFileSync(
    planPath,
    renderPlannedPlanMd(
      { section: e.n, slug: e.slug, title: e.title, purpose: e.purpose, role: e.role, depends_on: e.depends_on, word_target: e.estimated_word_count, voice: e.voice, assigned_sources: e.assigned_sources },
      {
        claims: [{ claim: 'Attention replaced recurrence.', sources: [OWN], evidence: '', counterexamples: '' }],
        structure: [{ paragraph: 1, purpose: 'Make the point.', claims: [1] }],
        voice: 'Measured.',
      },
    ),
  );
  return planPath;
}

function userMessage(body: Record<string, unknown>): string {
  const m = (body['messages'] as Array<{ content: unknown }>)[0]!.content;
  return typeof m === 'string' ? m : (m as Array<{ text?: string }>).map((b) => b.text ?? '').join('');
}

function lastMessage(body: Record<string, unknown>): string {
  return JSON.stringify((body['messages'] as unknown[]).at(-1));
}

const write = (sb: LlmSandbox, ...args: string[]) => sb.runTsx(null, ['write', ...args], { env: { ANTHROPIC_API_KEY: KEY } });

test('GRND-14 (1): the drafter request marks full_text for a BYO, an Unpaywall-OA and an arXiv source, and not for an abstract-only one or a deleted BYO PDF', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await paper(sb);
    sb.mock!.script('section-drafter', { text: `Attention replaced recurrence [@${OWN}].\n` });
    const r = await write(sb, '1', '--no-verify');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const records = JSON.parse(parsePromptBlocks(userMessage(sb.mock!.bodiesFor('section-drafter')[0]!)).get('sources')!) as Array<{ citekey: string; full_text: boolean }>;
    assert.deepEqual(
      Object.fromEntries(records.map((s) => [s.citekey, s.full_text])),
      { [OWN]: true, [OA]: true, [ARXIV]: true, [ABSTRACT]: false, [MOVED]: false },
    );
    assert.equal(sb.mock!.callCount('section-drafter'), 1, 'a draft without quotes needs no corrective turn');
  });
});

test('GRND-14 (2): a quote from the abstract-only source gets one corrective turn; the kept draft quotes only full-text sources', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const planPath = await paper(sb);
    const bad = { text: `${quoteOf(ABSTRACT, ABSTRACT_QUOTE)} Background follows [@${OWN}].\n` };
    const fixed = { text: `Attention layers align every position in one step [@${ABSTRACT}]. ${quoteOf(OWN, OWN_QUOTE)}\n` };
    sb.mock!.script('section-drafter', bad, fixed);
    const r = await write(sb, '1', '--no-verify');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(sb.mock!.callCount('section-drafter'), 2, 'exactly one corrective turn');
    const correction = lastMessage(sb.mock!.bodiesFor('section-drafter')[1]!);
    assert.match(correction, new RegExp(`\\[@${ABSTRACT}\\] \\\\"attention layers learn alignments`), 'the corrective turn names the quote');
    assert.match(correction, /full_text: false/);
    assert.match(correction, /paraphrase them, or quote only a source marked full_text: true/);
    const draft = fs.readFileSync(path.join(sb.paper, 'sections', '01-background', 'DRAFT.md'), 'utf8');
    assert.ok(draft.includes(OWN_QUOTE), 'the kept draft quotes the full-text source');
    assert.ok(!draft.includes(ABSTRACT_QUOTE), 'the abstract-only quote was paraphrased');
    const fullText = new Map([[OWN, true], [OA, true], [ARXIV, true], [ABSTRACT, false], [MOVED, false]]);
    assert.deepEqual(quotesWithoutFullText(draft, fullText), [], 'every quote the kept draft makes has full text');
    assert.equal(loadFrontmatterDocSync('plan', planPath).frontmatter['status'], 'written');
    assert.equal(fs.existsSync(path.join(sb.paper, 'sections', '01-background', 'DRAFT.rejected.md')), false);
  });
});

test('GRND-14 (2): a second quote without full text is rejected — DRAFT.rejected.md, status failed with the reason, exit 4', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const planPath = await paper(sb);
    const bad = { text: `${quoteOf(ABSTRACT, ABSTRACT_QUOTE)}\n` };
    // The retry quotes the BYO copy that was deleted since ingest: still no full text.
    const stillBad = { text: `${quoteOf(MOVED, ABSTRACT_QUOTE)}\n` };
    sb.mock!.script('section-drafter', bad, stillBad);
    const r = await write(sb, '1');
    assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
    assert.equal(sb.mock!.callCount('section-drafter'), 2, 'one corrective turn, then the section fails');
    assert.match(r.stderr, new RegExp(`^pensmith: section 1 failed: direct quote\\(s\\) from source\\(s\\) whose full text pensmith cannot check \\(full_text: false\\): \\[@${MOVED}\\]`, 'm'));
    const dir = path.join(sb.paper, 'sections', '01-background');
    assert.equal(fs.existsSync(path.join(dir, 'DRAFT.md')), false, 'no draft is kept');
    assert.match(fs.readFileSync(path.join(dir, 'DRAFT.rejected.md'), 'utf8'), new RegExp(`\\[@${MOVED}\\]`));
    const fm = loadFrontmatterDocSync('plan', planPath).frontmatter;
    assert.equal(fm['status'], 'failed');
    assert.match(String(fm['failure_reason']), new RegExp(`full_text: false\\): \\[@${MOVED}\\] "attention layers learn alignments`));
    assert.equal(fs.existsSync(path.join(dir, 'VERIFICATION.md')), false, 'no verify after a failed draft');
  });
});
