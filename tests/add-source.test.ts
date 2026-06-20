// tests/add-source.test.ts — Phase 8 Wave 0 RED-by-skip scaffold for ERGO-06
// (mid-project `add <doi|pdf>`) + RSCH-05 (BYO PDF ingestion).
//
// `add` lets a user introduce a new source AFTER outlining — by DOI (offline
// cassette hydration) or by a local PDF (pdf-parse text extraction) — and then
// REMAP it onto a section. The load-bearing safety invariant (Pitfall 3 / A6 —
// section-state-corruption guard): the remap MUST touch ONLY the section PLAN.md
// `assigned_sources[]`; it must NEVER mutate `status` or
// `verified_against_draft_hash` (those are owned by the write/verify verbs).
//
// RED-by-skip via SOURCE-GREP (mirrors [07-01]): the add verb is a stub until
// 08-06. READY = bin/cli/add.ts exists AND imports BOTH extractPdfText AND
// writeBibtex (the two chokepoints it must route through). existsSync alone is
// insufficient. Until 08-06 wires it, every test SKIPS so `npm test` stays GREEN.
//
// Offline: PENSMITH_NETWORK_TESTS is NOT set, so isOfflineMode() is true and the
// crossref adapter serves the committed tests/fixtures/cassettes/crossref/
// add-doi.json cassette. The DOI under test is 10.1038/nphys1170.
//
// TYPECHECK NOTE: the not-yet-built verb is imported via a runtime URL.href
// specifier so `tsc --noEmit` stays clean while the module is absent.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADD_SRC = fileURLToPath(new URL('../bin/cli/add.ts', import.meta.url));
const ADD_MOD = new URL('../bin/cli/add.js', import.meta.url);
const BYO_PDF = fileURLToPath(new URL('../tests/fixtures/pdf/byo-text.pdf', import.meta.url));

// The DOI carried by the committed add-doi.json cassette.
const CASSETTE_DOI = '10.1038/nphys1170';

// SOURCE-GREP skip-predicate: add.ts must route through the two chokepoints.
function addWired(): boolean {
  if (!fs.existsSync(ADD_SRC)) return false;
  const src = fs.readFileSync(ADD_SRC, 'utf8');
  return /extractPdfText/.test(src) && /writeBibtex/.test(src);
}

const READY = addWired();

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
  delete process.env.PENSMITH_NETWORK_TESTS; // ensure offline cassette mode

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

test('ERGO-06: `add <doi>` hydrates from the offline crossref cassette and appends to .paper/CITATIONS.bib', { skip: !READY }, async () => {
  const { root } = await mkProjectWithSection();

  await runAdd(root, { source: CASSETTE_DOI, yolo: true });

  const bibPath = path.join(root, '.paper', 'CITATIONS.bib');
  assert.ok(fs.existsSync(bibPath), 'add <doi> must append to .paper/CITATIONS.bib');
  const bib = fs.readFileSync(bibPath, 'utf8');
  // The cassette title is "Quantum coherence in photosynthetic complexes" (2009).
  assert.match(bib, /Quantum coherence|photosynthetic|2009/i, 'hydrated entry must reflect the cassette payload');
});

test('RSCH-05: `add <pdf>` reads the committed text-bearing PDF and extracts text via the existing chokepoint', { skip: !READY }, async () => {
  const { root } = await mkProjectWithSection();

  // byo-text.pdf yields >=50 non-whitespace chars (Task 1 fixture), so the
  // pdf-parse-succeeds path is taken (not the image-only UNVERIFIABLE path).
  const result = (await runAdd(root, { source: BYO_PDF, yolo: true })) as { ok?: boolean } | undefined;

  // The add verb returns ok on a successful PDF ingest; a CITATIONS.bib entry
  // (or a staged candidate) is the observable effect.
  assert.ok(result === undefined || result.ok !== false, 'PDF ingest must not fail');
  const bibPath = path.join(root, '.paper', 'CITATIONS.bib');
  assert.ok(fs.existsSync(bibPath), 'add <pdf> must produce/append a CITATIONS.bib entry');
});

test('Pitfall 3 / A6: the remap appends the citekey to assigned_sources[] and leaves status + verified_against_draft_hash UNCHANGED', { skip: !READY }, async () => {
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
