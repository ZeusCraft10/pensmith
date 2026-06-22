// tests/ris-write.test.ts — Phase 10 Plan 10-00 Wave-0 RED scaffold (CITE-05).
//
// RIS export contract suite. Mirrors tests/bibtex-write.test.ts structurally and
// reuses the SAME 3 SourceCandidate fixtures (Vaswani/He/Doe) verbatim.
//
// RED-by-skip convention (Phase-10 Wave 0 — matches 05-01/06-01/08-00 so the
// FULL suite stays GREEN with ZERO failures, only skips, until Wave 1 lands):
//   - The existence gate AND every behavioral assertion are skip-guarded on
//     existsSync(ris-write.ts). They report as skipped NOW (with a MISSING
//     reason) and flip to real assertions once Plan 10-02 ships the module.
//   - The module is loaded via a DYNAMIC import of a runtime URL `.href`
//     specifier INSIDE each test body (the 08-00 pattern). A top-level static
//     import — or a string-literal dynamic import — of the not-yet-existing
//     module would be statically resolved (tsc TS2307 / ESM hard-crash) before
//     the skip guard runs; the `.href` specifier keeps tsc clean AND the suite
//     GREEN-with-skips until Wave 1 (cycle-3 MEDIUM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

const risWritePath = new URL('../bin/lib/ris-write.ts', import.meta.url);
const skip = !existsSync(risWritePath);

// Runtime module specifier (the .js sibling resolved by tsx at run time). Imported
// via `.href` so `tsc --noEmit` does NOT statically resolve the not-yet-existing
// module (the 08-00 RED-by-skip pattern: URL.href specifier + local type), which
// keeps the typecheck clean while bin/lib/ris-write.ts is absent.
const risWriteModule = new URL('../bin/lib/ris-write.js', import.meta.url);
type WriteRis = (candidates: SourceCandidate[], targetPath: string) => Promise<void>;
async function loadWriteRis(): Promise<WriteRis> {
  const mod = (await import(risWriteModule.href)) as { writeRis: WriteRis };
  return mod.writeRis;
}

function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-ris-'));
  return join(dir, 'CITATIONS.ris');
}

// Same 3 fixtures as tests/bibtex-write.test.ts — each carries a DOI so it passes
// the hasId gate in the serializer's toCsl boundary parse.
const fixtures: SourceCandidate[] = [
  {
    source: 'crossref',
    id: '10.0000/aaa',
    doi: '10.0000/aaa',
    title: 'Attention Is All You Need',
    authors: ['Vaswani, Ashish'],
    year: 2017,
    retracted: false,
    citekey: 'vaswani2017',
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: {},
  },
  {
    source: 'openalex',
    id: '10.0000/bbb',
    doi: '10.0000/bbb',
    title: 'Deep Residual Learning',
    authors: ['He, Kaiming'],
    year: 2016,
    retracted: false,
    citekey: 'he2016',
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: {},
  },
  {
    source: 'arxiv',
    id: '2401.00001',
    doi: '10.48550/arXiv.2401.00001',
    title: 'Naive Bayes Revisited (na\\"ive)',
    authors: ['Doe, Jane'],
    year: 2024,
    retracted: false,
    citekey: 'doe2024',
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: { arxivId: '2401.00001' },
  } as SourceCandidate,
];

// RED-by-skip existence gate (Phase-10 Wave-0 convention — matches 05-01/06-01/08-00:
// Wave-0 scaffolds skip rather than hard-fail so the FULL suite stays GREEN with
// zero failures). Skips NOW with a MISSING reason; once Plan 10-02 ships the
// module the skip guard inverts and this becomes a real existence assertion.
test('ris-write: bin/lib/ris-write.ts production module exists (CITE-05)', { skip }, () => {
  assert.ok(
    existsSync(risWritePath),
    'MISSING: bin/lib/ris-write.ts — Plan 10-02 must create (RIS serializer, mirrors bibtex-write.ts)',
  );
});

test('writeRis: round-trips 3 fixtures into RIS2001 (TY  - JOUR / ER  -) (CITE-05)', { skip }, async () => {
  const writeRis = await loadWriteRis();
  const target = tmpFile();
  await writeRis(fixtures, target);
  const body = readFileSync(target, 'utf8');
  // RIS2001 new spec (Pitfall 4 spec:'new'): TY tag + ER terminator are required.
  assert.match(body, /TY\s+-\s+JOUR/, 'RIS2001 TY  - JOUR tag present');
  assert.match(body, /ER\s+-/, 'RIS2001 ER  - terminator present');
  assert.equal(
    (body.match(/^TY\s+-/gm) ?? []).length,
    fixtures.length,
    'exactly fixtures.length TY  - records emitted',
  );
  rmSync(target, { force: true });
});

test('writeRis: empty array writes a zero-length file (verify.md must NOT ENOENT)', { skip }, async () => {
  const writeRis = await loadWriteRis();
  const target = tmpFile();
  await writeRis([], target);
  const body = readFileSync(target, 'utf8');
  assert.equal(body.trim(), '', 'empty array -> zero-length file (but the file exists)');
  rmSync(target, { force: true });
});

test('writeRis: no-id candidate dropped silently, does NOT throw (CITE-05)', { skip }, async () => {
  const writeRis = await loadWriteRis();
  const target = tmpFile();
  const noIdCandidate = {
    source: 'crossref',
    id: 'tmp-noid',
    title: 'No id',
    authors: ['Nobody'],
    year: 2020,
    retracted: false,
    citekey: 'noid2020',
    last_verified: '2024-01-01T00:00:00.000Z',
    raw: {},
  } as unknown as SourceCandidate;
  const mixed: SourceCandidate[] = [...fixtures, noIdCandidate];
  await writeRis(mixed, target);
  const body = readFileSync(target, 'utf8');
  assert.equal(
    (body.match(/^TY\s+-/gm) ?? []).length,
    3,
    'no-id candidate dropped silently — only the 3 with DOIs remain',
  );
  rmSync(target, { force: true });
});
