// tests/research-md.test.ts — the RESEARCH.md sources block (Phase 19 seam S-B).
//
// The block is a view of LIBRARY.json: rendered deterministically (formatted
// reference, tier, relevance, provenance tags, why-relevant, abstract excerpt,
// retraction and unhydrated notes), inserted above the research-log end line,
// replaced in place on refresh, adopting the file's line ending, and never
// touching anything outside its markers (the user's notes survive byte-for-
// byte). It uses no `### ` headings, so the tutorial's curated-claims parser
// cannot mistake a source for a curated entry.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  RESEARCH_LOG_END,
  SOURCES_START,
  SOURCES_END,
  renderSourcesBlock,
  upsertSourcesBlock,
  refreshResearchSources,
  formatReference,
  provenanceTags,
} from '../bin/lib/research-md.js';
import { RESEARCH_LOG_END as ORCHESTRATOR_LOG_END } from '../bin/lib/research-orchestrator.js';
import { upsertSources, type LibraryCandidate } from '../bin/lib/library.js';
import { candidateToEntry } from '../bin/lib/migrations/library/shape.js';
import { parseResearchClaims } from '../bin/cli/goal.js';

const NOW = '2026-09-28T00:00:00.000Z';

function entry(c: LibraryCandidate, provenance: string[] = ['research:crossref']) {
  return candidateToEntry(c, provenance, NOW);
}

const LECUN = entry({
  citekey: 'lecun2015',
  doi: '10.1038/nature14539',
  title: 'Deep learning',
  authors: ['LeCun, Yann', 'Bengio, Yoshua', 'Hinton, Geoffrey'],
  year: 2015,
  venue: 'Nature',
  volume: '521',
  issue: '7553',
  pages: '436-444',
  tier: 'peer-reviewed',
  relevance: 0.92,
  why_relevant: 'The review the background section summarizes.',
  abstract: 'Deep learning allows computational models that are composed of multiple processing layers to learn representations of data with multiple levels of abstraction. '.repeat(8),
  retraction_status: 'clear',
});
const KUHN = entry(
  { citekey: 'kuhn1996', isbn: '9780226458083', title: 'The Structure of Scientific Revolutions', authors: ['Kuhn, Thomas S.'], year: 1996, publisher: 'University of Chicago Press', type: 'book', tier: 'book' },
  ['add:books', 'zotero:users/1'],
);
const WAKEFIELD = entry({
  citekey: 'wakefield1998',
  doi: '10.1016/s0140-6736(97)11096-0',
  title: 'RETRACTED: Ileal-lymphoid-nodular hyperplasia',
  authors: ['Wakefield, A.J.', 'Murch, S.H.', 'Anthony, A.', 'Linnell, J.'],
  year: 1998,
  retracted: true,
  retraction_details: '2010-02-06: Retraction (notice 10.1016/s0140-6736(10)60175-4)',
});
const BYO = entry(
  { citekey: 'notes2020', title: 'Course reader: week 3', authors: ['{Department of History}'], year: 2020, hydrated: false, byo: { file: 'sources/notes2020.pdf', sha256: 'e'.repeat(64), text_sha256: null }, retraction_status: 'unknown' },
  ['byo'],
);

test('seam S-B: RESEARCH_LOG_END is the research orchestrator\'s end line', () => {
  assert.equal(RESEARCH_LOG_END, ORCHESTRATOR_LOG_END);
});

test('seam S-B: formatReference and provenanceTags', () => {
  assert.equal(
    formatReference(LECUN),
    'LeCun, Yann; Bengio, Yoshua; Hinton, Geoffrey (2015). Deep learning. Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14539',
  );
  assert.equal(
    formatReference(KUHN),
    'Kuhn, Thomas S. (1996). The Structure of Scientific Revolutions. University of Chicago Press. ISBN 9780226458083',
  );
  assert.match(formatReference(WAKEFIELD), /^Wakefield, A\.J\.; Murch, S\.H\.; Anthony, A\.; et al\. \(1998\)/);
  assert.match(formatReference(BYO), /^Department of History \(2020\)\. Course reader: week 3\.$/);
  assert.deepEqual(provenanceTags(KUHN), ['added', 'zotero']);
  assert.deepEqual(provenanceTags(BYO), ['bring-your-own']);
  const mixed = entry({ title: 'x', authors: ['A, B'] }, ['research:openalex', 'research:zotero', 'research:byo', 'plan-research:§2', 'bib-import']);
  assert.deepEqual(provenanceTags(mixed), ['search', 'zotero', 'bring-your-own', 'plan-research', 'imported']);
});

test('seam S-B: renderSourcesBlock is deterministic, ordered by relevance, list-only', () => {
  const block = renderSourcesBlock([BYO, WAKEFIELD, KUHN, LECUN]);
  assert.equal(block, renderSourcesBlock([LECUN, KUHN, WAKEFIELD, BYO]), 'input order does not matter');
  assert.ok(block.startsWith(`${SOURCES_START}\n## Sources (4)\n`));
  assert.ok(block.endsWith(SOURCES_END));
  const keys = [...block.matchAll(/^- \[@([^\]]+)\]/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ['lecun2015', 'kuhn1996', 'notes2020', 'wakefield1998'], 'scored first, then by citekey');
  assert.match(block, /Tier: peer-reviewed · Relevance: 0\.92 · Tags: search/);
  assert.match(block, /Why relevant: The review the background section summarizes\./);
  const abstractLine = block.split('\n').find((l) => l.startsWith('  - Abstract: ')) ?? '';
  assert.ok(abstractLine.length <= '  - Abstract: '.length + 601, 'abstract excerpt is bounded');
  assert.ok(abstractLine.endsWith('…'));
  assert.match(block, /Retraction: RETRACTED — 2010-02-06: Retraction/);
  assert.match(block, /Retraction: retraction status unknown/);
  assert.match(block, /Metadata: local only/);
  assert.match(block, /Tier: not evaluated/);
  assert.doesNotMatch(block, /^### /m);
  assert.equal(parseResearchClaims(block).size, 0, 'the curated-claims parser sees no entries');
  assert.match(renderSourcesBlock([]), /_No sources in LIBRARY\.json yet\._/);
});

test('seam S-B: upsertSourcesBlock inserts, replaces and preserves everything else', () => {
  const block = renderSourcesBlock([LECUN]);
  const fresh = upsertSourcesBlock(null, block);
  assert.equal(fresh, `# Research\n\n${block}\n\n${RESEARCH_LOG_END}\n`);

  const log = `# Research log\n\nScope: x\n\n${RESEARCH_LOG_END}\n\n## My notes\n\nKeep me.\n`;
  const inserted = upsertSourcesBlock(log, block);
  assert.ok(inserted.startsWith('# Research log\n\nScope: x\n\n' + block + '\n\n' + RESEARCH_LOG_END));
  assert.ok(inserted.endsWith('## My notes\n\nKeep me.\n'));

  const block2 = renderSourcesBlock([LECUN, KUHN]);
  const replaced = upsertSourcesBlock(inserted, block2);
  assert.equal(replaced, inserted.replace(block, block2));
  assert.equal(upsertSourcesBlock(replaced, block2), replaced, 'idempotent');

  const notesOnly = 'Hand-written notes, no log yet.\n';
  const prepended = upsertSourcesBlock(notesOnly, block);
  assert.ok(prepended.endsWith(`${RESEARCH_LOG_END}\n\n${notesOnly}`), 'existing notes move below the end line untouched');

  const crlf = log.replace(/\n/g, '\r\n');
  const out = upsertSourcesBlock(crlf, block);
  assert.doesNotMatch(out.replace(/\r\n/g, ''), /\n/, 'a CRLF file stays CRLF');
});

test('seam S-B: refreshResearchSources renders LIBRARY.json and keeps the notes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-researchmd-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  const file = path.join(root, '.paper', 'RESEARCH.md');

  assert.deepEqual(await refreshResearchSources(root), { path: file, changed: false, count: 0 }, 'no library, no file: nothing written');
  assert.equal(fs.existsSync(file), false);

  await upsertSources(root, [{ citekey: 'lecun2015', source: 'crossref', doi: '10.1038/nature14539', title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 }], { provenance: 'add' });
  const first = await refreshResearchSources(root);
  assert.equal(first.changed, true);
  assert.equal(first.count, 1);
  const text1 = fs.readFileSync(file, 'utf8');
  assert.match(text1, /- \[@lecun2015\] LeCun, Yann \(2015\)\. Deep learning\./);

  fs.appendFileSync(file, '\n## My notes\n\nKeep me exactly.\n');
  await upsertSources(root, [{ citekey: 'kuhn1996', source: 'books', isbn: '9780226458083', title: 'The Structure of Scientific Revolutions', authors: ['Kuhn, Thomas S.'], year: 1996 }], { provenance: 'add' });
  const second = await refreshResearchSources(root);
  assert.equal(second.changed, true);
  const text2 = fs.readFileSync(file, 'utf8');
  assert.match(text2, /\[@kuhn1996\]/);
  assert.ok(text2.endsWith('\n## My notes\n\nKeep me exactly.\n'));
  assert.equal((await refreshResearchSources(root)).changed, false, 'unchanged library, no write');
});
