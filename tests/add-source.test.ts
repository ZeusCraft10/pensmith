// tests/add-source.test.ts — ERGO-06 (mid-project `add <doi|pdf>`), RSCH-05
// (BYO PDF ingestion) and SRC-13 (D-19-20: `add` identifies the right work or
// refuses).
//
// The load-bearing safety invariant (Pitfall 3 / A6 — section-state-corruption
// guard): a remap touches ONLY the section PLAN.md `assigned_sources[]`; it
// never mutates `status` or `verified_against_draft_hash`.
//
// Offline: the test runner is sources-offline (RUN-01), so the adapters replay
// the EXACT recorded fixtures under tests/fixtures/cassettes/ (Crossref
// works-nphys1170.json for DOI 10.1038/nphys1170; arXiv id-1706.03762.json).
//
// Updated for SRC-13 (19-PLAN §8): `add <byo-text.pdf>` used to take the PDF's
// first line as a title and add Crossref's first search hit — for this fixture
// "Is Attention All You Need?" (a DIFFERENT work, 10.1007/978-3-031-84300-6_13)
// — the UX-19 wrong-work bug. The fixture carries no identifier, so identifying
// it needs a title search, which has no recorded answer offline: `add` now
// refuses and changes nothing. The arXiv-layout fixture, whose first page
// carries the arXiv stamp, is added by its arXiv id.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCommand } from '../bin/cli/add.js';

const BYO_PDF = fileURLToPath(new URL('../tests/fixtures/pdf/byo-text.pdf', import.meta.url));
const ARXIV_LAYOUT_PDF = fileURLToPath(new URL('../tests/fixtures/byo/attention-arxiv-layout.pdf', import.meta.url));

// The DOI with a recorded Crossref answer (works-nphys1170.json).
const CASSETTE_DOI = '10.1038/nphys1170';

/** Build an isolated project root with a real `.paper/` + one section PLAN.md. */
async function mkProjectWithSection(): Promise<{ root: string; planPath: string; n: number; slug: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-add-'));
  process.env['PENSMITH_NO_LLM'] = '1';
  delete process.env['PENSMITH_NETWORK_TESTS']; // ensure offline cassette mode

  const { initState, initSection } = await import('../bin/lib/state.js');
  const { sectionPlan } = await import('../bin/lib/paths.js');
  const { atomicWriteFile } = await import('../bin/lib/atomic-write.js');

  await initState(root);
  const n = 1;
  const slug = 'background';
  await initSection(root, n, slug);

  const planPath = sectionPlan(n, slug, root);
  // status=written + a real verified_against_draft_hash so the no-mutation
  // invariant has a non-default value to protect.
  await atomicWriteFile(
    planPath,
    `---\n` +
      `section: ${n}\n` +
      `slug: ${slug}\n` +
      `title: Background\n` +
      `status: written\n` +
      `assigned_sources: []\n` +
      `verified_against_draft_hash: abc123def456\n` +
      `---\n# Background\n`,
  );

  return { root, planPath, n, slug };
}

async function runAdd(cwd: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const prevExit = process.exitCode;
  try {
    return (await addCommand.run!({ args } as never)) as Record<string, unknown>;
  } finally {
    process.exitCode = prevExit;
    process.chdir(prevCwd);
  }
}

test('ERGO-06: `add <doi>` hydrates from the offline crossref cassette and writes .paper/CITATIONS.bib', async () => {
  const { root } = await mkProjectWithSection();

  const r = await runAdd(root, { source: CASSETTE_DOI, yolo: true });
  assert.equal(r['ok'], true);

  const bib = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  // The RECORDED Crossref answer for 10.1038/nphys1170 (CI-07) is the real work:
  // "Measured measurement" (Aspelmeyer, Nature Physics 2009).
  const { loadCassetteFile } = await import('../bin/lib/http-mock.js');
  const recorded = loadCassetteFile('crossref', 'works-nphys1170');
  const msg = (recorded?.[0]?.response as { message: { title: string[]; author: Array<{ family: string }> } }).message;
  assert.ok(bib.includes(msg.title[0]!), 'hydrated entry must carry the recorded title');
  assert.ok(bib.includes(msg.author[0]!.family), 'hydrated entry must carry the recorded first author');
  assert.match(bib, /2009/);
});

test('SRC-13: `add <pdf>` adds the arXiv-layout PDF by the arXiv stamp on its first page, keeping the PDF', async () => {
  const { root } = await mkProjectWithSection();
  const r = await runAdd(root, { source: ARXIV_LAYOUT_PDF, yolo: true });
  assert.equal(r['ok'], true);
  assert.equal(r['citekey'], 'vaswani2017');
  const bib = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /@misc\{vaswani2017,[\s\S]*title = \{Attention Is All You Need\}[\s\S]*eprint = \{1706\.03762\},\n {2}archivePrefix = \{arXiv\}/);
  assert.ok(fs.existsSync(path.join(root, '.paper', 'sources', 'vaswani2017.pdf')), 'the PDF is kept as the bring-your-own copy');
});

test('SRC-13 (supersedes RSCH-05 hits[0] hydration): a PDF without an identifier is never hydrated from a guessed search hit', async () => {
  const { root } = await mkProjectWithSection();
  const r = await runAdd(root, { source: BYO_PDF, yolo: true });
  assert.equal(r['ok'], false);
  assert.equal(r['exitCode'], 1);
  assert.equal(fs.existsSync(path.join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was added');
  assert.equal(fs.existsSync(path.join(root, '.paper', 'LIBRARY.json')), false);
});

test('Pitfall 3 / A6: the remap appends the citekey to assigned_sources[] and leaves status + verified_against_draft_hash UNCHANGED', async () => {
  const { root, planPath, n, slug } = await mkProjectWithSection();

  const { parseFrontmatter } = await import('../bin/lib/frontmatter.js');

  // Snapshot the protected fields BEFORE the add+remap.
  const before = parseFrontmatter(fs.readFileSync(planPath, 'utf8')).frontmatter;
  assert.equal(before['status'], 'written', 'precondition: status starts written');
  assert.equal(before['verified_against_draft_hash'], 'abc123def456', 'precondition: hash is set');

  await runAdd(root, { source: CASSETTE_DOI, section: n, slug, remap: true, yolo: true });

  const after = parseFrontmatter(fs.readFileSync(planPath, 'utf8')).frontmatter;
  const sources = after['assigned_sources'] as unknown[];
  assert.deepEqual(sources, ['aspelmeyer2009'], 'remap appends the real citekey to assigned_sources[]');
  assert.equal(after['status'], before['status'], 'remap must NOT mutate status');
  assert.equal(after['verified_against_draft_hash'], before['verified_against_draft_hash'], 'remap must NOT mutate verified_against_draft_hash');
});
