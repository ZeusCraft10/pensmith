// tests/add-source.test.ts — `pensmith add <doi|pdf>` (ERGO-06, RSCH-05).
//
// `add` introduces a source after outlining, by DOI or from a local PDF, and
// can remap it onto a section. The remap touches only the section PLAN.md's
// `assigned_sources[]`; it never changes `status` or
// `verified_against_draft_hash` (those belong to write and verify).
//
// The test runner replays recorded registry answers: Crossref's record for
// 10.1038/nphys1170 (tests/fixtures/cassettes/crossref/add-doi.json) and
// arXiv's for 1706.03762, the ID printed in the committed BYO PDF.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADD_MOD = new URL('../bin/cli/add.js', import.meta.url);
const BYO_PDF = fileURLToPath(new URL('../tests/fixtures/pdf/byo-text.pdf', import.meta.url));

// The DOI carried by the committed add-doi.json cassette.
const CASSETTE_DOI = '10.1038/nphys1170';

interface CittyRun {
  run: (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
}
interface AddMod {
  addCommand: CittyRun;
}

/** Build an isolated project root with a real `.paper/` + one section PLAN.md. */
async function mkProjectWithSection(): Promise<{ root: string; planPath: string; n: number; slug: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-add-'));
  process.env.PENSMITH_NO_LLM = '1';
  process.env.PENSMITH_TEST_CASSETTES = '1'; // replay committed cassettes, never live

  const { initState, initSection } = await import('../bin/lib/state.js');
  const { sectionPlan } = await import('../bin/lib/paths.js');
  const { atomicWriteFile } = await import('../bin/lib/atomic-write.js');

  await initState(root);
  const n = 1;
  const slug = 'background';
  await initSection(root, n, slug);

  const planPath = sectionPlan(n, slug, root);
  // INLINE section PLAN.md fixture (do NOT rely on an unlisted committed path).
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

async function runAdd(cwd: string, args: Record<string, unknown>): Promise<unknown> {
  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    const { addCommand } = (await import(ADD_MOD.href)) as AddMod;
    return await addCommand.run({ args });
  } finally {
    process.chdir(prevCwd);
  }
}

test('ERGO-06: `add <doi>` hydrates from the recorded Crossref answer and appends to .paper/CITATIONS.bib', async () => {
  const { root } = await mkProjectWithSection();

  await runAdd(root, { source: CASSETTE_DOI, yolo: true });

  const bibPath = path.join(root, '.paper', 'CITATIONS.bib');
  assert.ok(fs.existsSync(bibPath), 'add <doi> must append to .paper/CITATIONS.bib');
  const bib = fs.readFileSync(bibPath, 'utf8');
  // Crossref's record: "Measured measurement" by Markus Aspelmeyer (2009).
  assert.match(bib, /@article\{aspelmeyer2009,/, bib);
  assert.match(bib, /title = \{Measured measurement\}/, bib);
  assert.match(bib, /author = \{Aspelmeyer, Markus\}/, bib);
});

test('RSCH-05: `add <pdf>` reads the committed text-bearing PDF and extracts text via the existing chokepoint', async () => {
  const { root } = await mkProjectWithSection();

  // byo-text.pdf yields >=50 non-whitespace chars, so the pdf-parse path is
  // taken (not the image-only path).
  const result = (await runAdd(root, { source: BYO_PDF, yolo: true })) as { ok?: boolean } | undefined;

  assert.ok(result === undefined || result.ok !== false, 'PDF ingest must not fail');
  const bibPath = path.join(root, '.paper', 'CITATIONS.bib');
  assert.ok(fs.existsSync(bibPath), 'add <pdf> must produce/append a CITATIONS.bib entry');
});

test('Pitfall 3 / A6: the remap appends the citekey to assigned_sources[] and leaves status + verified_against_draft_hash UNCHANGED', async () => {
  const { root, planPath, n, slug } = await mkProjectWithSection();

  const { parseFrontmatter } = await import('../bin/lib/frontmatter.js');

  // Snapshot the protected fields BEFORE the add+remap.
  const before = parseFrontmatter(fs.readFileSync(planPath, 'utf8')).frontmatter;
  assert.equal(before.status, 'written', 'precondition: status starts written');
  assert.equal(before.verified_against_draft_hash, 'abc123def456', 'precondition: hash is set');

  // add <doi> with an approved remap onto section n. The verb appends the
  // generated citekey to that section's assigned_sources[].
  await runAdd(root, { source: CASSETTE_DOI, section: n, slug, remap: true, yolo: true });

  const after = parseFrontmatter(fs.readFileSync(planPath, 'utf8')).frontmatter;

  // The remap MUST have added a source.
  const sources = after.assigned_sources as unknown[];
  assert.ok(Array.isArray(sources) && sources.length > 0, 'remap must append a citekey to assigned_sources[]');

  // The protected fields MUST be byte-for-byte unchanged (section-state guard).
  assert.equal(after.status, before.status, 'remap must NOT mutate status');
  assert.equal(
    after.verified_against_draft_hash,
    before.verified_against_draft_hash,
    'remap must NOT mutate verified_against_draft_hash',
  );
});

test('add <doi>: a registry record whose DOI differs from the requested DOI is rejected, not added', async () => {
  // The redirect-audit16 cassette answers /works/10.0000/alias-audit16 with a
  // record whose DOI is 10.0000/retracted — a different work.
  const { root } = await mkProjectWithSection();
  const out: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  let result: unknown;
  let exitCode: typeof process.exitCode;
  try {
    result = await runAdd(root, { source: '10.0000/alias-audit16', yolo: true });
  } finally {
    process.stdout.write = origWrite;
    // The refusal sets the CLI's exit code; read it, then clear it so this test
    // process itself does not exit non-zero.
    exitCode = process.exitCode;
    process.exitCode = undefined;
  }
  assert.deepEqual(result, { ok: false });
  assert.equal(exitCode, 2, 'a refused source exits 2');
  assert.match(out.join(''), /10\.0000\/retracted/, 'the refusal names the DOI the registry returned');
  assert.ok(
    !fs.existsSync(path.join(root, '.paper', 'CITATIONS.bib')),
    'a mismatched record must not be written to CITATIONS.bib',
  );
});
