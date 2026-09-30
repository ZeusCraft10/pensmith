// tests/forged-artifacts.test.ts — VRFY-25 / VRFY-26 (D-20-04, D-20-22,
// D-20-23, D-20-24): compile and done trust no local file. A section's
// VERIFICATION.md and PLAN.md can only ADD refusals; the verdicts are
// recomputed by the one gate core over the exact text compile concatenates
// and done exports. So a hand-made "clean" record — PLAN.md `verified` with
// the right hash, a VERIFICATION.md rendered by the real renderer with OK rows
// — over a fabricated citation is REFUSED with the recomputed row, and a
// hand-written quote acceptance (a VERIFICATION.md line, or a schema-valid
// QUOTE-ACCEPTANCES.json entry for a quote whose source text refutes it)
// lifts nothing.
//
// Built CLI, sources offline: 10.5555/pensmith-no-such-work-2017 is Crossref's
// recorded 404 (FABRICATED), lecun2015's PDF is the user's own hashed copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { renderVerificationMd } from '../bin/lib/verify/verification-md.js';
import { quoteTextSha256 } from '../bin/lib/verify/verdicts.js';
import { quoteAcceptancesPath } from '../bin/lib/quote-acceptance.js';
import { QUOTE_ACCEPTANCES_SCHEMA_VERSION } from '../bin/lib/schemas/quote-acceptances.js';
import { seedGatePaper, sectionDraftHash, mtimes, LECUN_BIB, FAKE_DOI_BIB, type GatePaper } from './helpers/gate-paper.js';
import { writeCompileRecord, runCli, sandbox, writeState, writeOutline, writePlan, sectionDirOf, REPO, STACK_LINE } from './helpers/paper-cli-harness.js';

/** Make section `n` look verified and clean: PLAN.md `verified` with the right hash, a rendered all-OK VERIFICATION.md. */
function forgeClean(root: string, dir: string, n: number, slug: string, assigned: readonly string[], rows: { pass1?: readonly string[]; acceptedQuote?: { key: string; quote: string } } = {}): void {
  const hash = sectionDraftHash(root, n, slug, assigned);
  const plan = join(dir, 'PLAN.md');
  writeFileSync(
    plan,
    readFileSync(plan, 'utf8')
      .replace(/^status: .*$/m, 'status: verified')
      .replace(/^verified_against_draft_hash: .*$/m, `verified_against_draft_hash: '${hash}'`),
  );
  const md = renderVerificationMd({
    sectionId: String(n),
    slug,
    offlineMarker: null,
    status: 'verified',
    draftHash: hash,
    rows: [
      ...(rows.pass1 ?? assigned).map((key) => ({ kind: 'pass1' as const, key, verdict: 'OK', titleJW: 1, authorJW: 1, reason: 'D-11 AND-gate passed' })),
      ...(rows.acceptedQuote !== undefined
        ? [{
            kind: 'pass3' as const,
            key: rows.acceptedQuote.key,
            id: 'q1',
            quoteSha256: quoteTextSha256(rows.acceptedQuote.quote),
            snippet: rows.acceptedQuote.quote.slice(0, 40),
            verdict: 'UNVERIFIABLE-QUOTE',
            levRatio: 0,
            reason: 'no source text',
            accepted: { at: '2026-01-01T00:00:00.000Z', via: 'flag' as const },
          }]
        : []),
    ],
  });
  writeFileSync(join(dir, 'VERIFICATION.md'), md);
}

function fabricatedPaper(prefix: string): GatePaper {
  const p = seedGatePaper(prefix, [{ n: 1, slug: 'intro', assigned: ['fake2017'], draft: '# Intro\n\nA landmark result [@fake2017].\n' }], LECUN_BIB + FAKE_DOI_BIB);
  forgeClean(p.root, p.sectionDir(1, 'intro'), 1, 'intro', ['fake2017']);
  return p;
}

test('VRFY-25 (built CLI): a forged clean VERIFICATION.md + PLAN.md over [@fake2017] — compile REFUSES with the recomputed FABRICATED row, exit 4, no DRAFT.md; the forged record is left as it was', () => {
  const p = fabricatedPaper('forged-compile');
  const verif = join(p.sectionDir(1, 'intro'), 'VERIFICATION.md');
  const forged = readFileSync(verif, 'utf8');
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /pensmith compile: REFUSED/);
  assert.match(c.stdout, /section 1 \(intro\): citation \[@fake2017\] is FABRICATED — /);
  assert.doesNotMatch(c.stderr, STACK_LINE);
  assert.ok(!existsSync(join(p.root, '.paper', 'DRAFT.md')), 'no compiled DRAFT.md');
  assert.ok(!existsSync(join(p.root, '.paper', 'COMPILE-INPUTS.json')), 'no compile record');
  assert.equal(readFileSync(verif, 'utf8'), forged, 'compile never rewrites a current section\'s record');
});

test('VRFY-25 (built CLI): a forged clean record over a key that is in no bibliography is REFUSED as FABRICATED', () => {
  const p = seedGatePaper('forged-nobib', [{ n: 1, slug: 'intro', assigned: ['ghost2099'], draft: '# Intro\n\nAs shown before [@ghost2099].\n' }], LECUN_BIB);
  forgeClean(p.root, p.sectionDir(1, 'intro'), 1, 'intro', ['ghost2099']);
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /section 1 \(intro\): citation \[@ghost2099\] is FABRICATED/);
  assert.ok(!existsSync(join(p.root, '.paper', 'DRAFT.md')));
});

test('VRFY-26 (built CLI): done over a forged compiled paper (records, compiled DRAFT.md and COMPILE-INPUTS all consistent) is BLOCKED by the recomputed row — nothing exported, nothing under sections/ touched', () => {
  const p = fabricatedPaper('forged-done');
  writeFileSync(join(p.root, '.paper', 'DRAFT.md'), readFileSync(join(p.sectionDir(1, 'intro'), 'DRAFT.md')));
  writeCompileRecord(p.root, [{ n: 1, slug: 'intro' }]);
  const sectionsBefore = mtimes(join(p.root, '.paper', 'sections'));
  const d = p.cli(['done', '--yolo', '--format', 'md']);
  assert.equal(d.status, EXIT_BLOCKED, `${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /pensmith done: BLOCKED/);
  assert.match(d.stdout, /\.paper\/DRAFT\.md: citation \[@fake2017\] is FABRICATED/);
  assert.doesNotMatch(d.stderr, STACK_LINE);
  assert.ok(!existsSync(join(p.root, '.paper', 'export')), 'nothing under export/');
  assert.ok(!existsSync(join(p.root, '.paper', 'FINAL.md')), 'no FINAL.md');
  assert.deepEqual(mtimes(join(p.root, '.paper', 'sections')), sectionsBefore, 'done never writes under sections/');
});

// ---------------------------------------------------------------------------
// Hand-written acceptances
// ---------------------------------------------------------------------------

const BYO = join(REPO, 'tests', 'fixtures', 'byo');
/** Not in lecun2015's own PDF: Pass 3 reads the user's hashed copy and answers NOT_FOUND. */
const FAKE_QUOTE = 'deep learning has already solved every open problem in artificial intelligence and will soon replace all scientists';

test('VRFY-20 (built CLI): a hand-written acceptance lifts nothing — an "(accepted)" VERIFICATION.md line and a schema-valid QUOTE-ACCEPTANCES.json entry leave a NOT_FOUND quote blocking in verify, compile and done', () => {
  const sb = sandbox('forged-acceptance');
  const root = sb.project('p');
  writeState(root, [], 'forged-acceptance');
  copyFileSync(join(BYO, 'metadata-doi.pdf'), join(root, 'lecun.pdf'));
  const a = runCli(sb, root, ['add', 'lecun.pdf', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(a.status, EXIT_OK, `${a.stdout}\n${a.stderr}`);
  writeState(root, [{ n: 1, slug: 'background' }], 'forged-acceptance');
  writeOutline(root, [{ n: 1, slug: 'background', sources: ['lecun2015'] }]);
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: '[lecun2015]' });
  const dir = sectionDirOf(root, 1, 'background');
  writeFileSync(join(dir, 'DRAFT.md'), `# Background\n\nThe review states that "${FAKE_QUOTE}" [@lecun2015].\n`);

  // The forgeries: a clean record with the quote "accepted", and an acceptance
  // bound to this very quote and draft.
  forgeClean(root, dir, 1, 'background', ['lecun2015'], { acceptedQuote: { key: 'lecun2015', quote: FAKE_QUOTE } });
  assert.match(readFileSync(join(dir, 'VERIFICATION.md'), 'utf8'), /\*\*UNVERIFIABLE-QUOTE\*\* — .* — accepted by you /);
  writeFileSync(
    quoteAcceptancesPath(dir),
    JSON.stringify({
      $schemaVersion: QUOTE_ACCEPTANCES_SCHEMA_VERSION,
      acceptances: [{
        quote_id: 'q1',
        citekey: 'lecun2015',
        quote_sha256: quoteTextSha256(FAKE_QUOTE),
        excerpt: FAKE_QUOTE.slice(0, 80),
        draft_sha256: sectionDraftHash(root, 1, 'background', ['lecun2015']),
        accepted_at: '2026-01-01T00:00:00.000Z',
        via: 'flag',
      }],
    }, null, 2) + '\n',
  );

  const c = runCli(sb, root, ['compile', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(c.status, EXIT_BLOCKED, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /section 1 \(background\): quote q1 \("deep learning has already solved every o…"\) \[@lecun2015\] is NOT_FOUND/);
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')));

  const v = runCli(sb, root, ['verify', '1', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(v.status, EXIT_BLOCKED, `${v.stdout}\n${v.stderr}`);
  const md = readFileSync(join(dir, 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: failed$/m);
  assert.match(md, /^- lecun2015 \[q1\] \("deep learning has already solved every o…"\): \*\*NOT_FOUND\*\* — /m);
  assert.doesNotMatch(md, /accepted by you/);

  // done over a compiled draft holding the quote (its record forged to match): still refused.
  writeFileSync(join(root, '.paper', 'DRAFT.md'), readFileSync(join(dir, 'DRAFT.md')));
  forgeClean(root, dir, 1, 'background', ['lecun2015'], { acceptedQuote: { key: 'lecun2015', quote: FAKE_QUOTE } });
  writeCompileRecord(root, [{ n: 1, slug: 'background' }]);
  const d = runCli(sb, root, ['done', '--yolo', '--format', 'md'], { timeoutMs: 120_000 });
  assert.equal(d.status, EXIT_BLOCKED, `${d.stdout}\n${d.stderr}`);
  // At paper scope the row also names the quote's own section and id (§1's q1).
  assert.match(d.stdout, /quote q1 \(§1's q1\) \("deep learning has already solved every o…"\) \[@lecun2015\] is NOT_FOUND/);
  assert.ok(!existsSync(join(root, '.paper', 'export')));
});

test('VRFY-15 / D-20-13 (built CLI): done re-checks a cited source LIBRARY.json holds as `unknown` — found retracted now, the export is refused naming it, and nothing is written', async () => {
  const { upsertSources } = await import('../bin/lib/library.js');
  const sb = sandbox('forged-retraction-recheck');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'background' }], 'forged-retraction-recheck');
  // A work whose (recorded, synthetic) Crossref record and Retraction Watch answer say retracted.
  const doi = '10.0000/gate03-retracted';
  await upsertSources(
    root,
    [{ source: 'openalex', id: doi, doi, title: 'A Gate-03 Live-Retraction Fixture', authors: ['Retracted, Alice'], year: 2018, retraction_status: 'unknown', last_verified: new Date().toISOString(), citekey: 'retracted2018', raw: {} }],
    { provenance: 'research' },
  );
  writeOutline(root, [{ n: 1, slug: 'background', sources: ['retracted2018'] }]);
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: '[retracted2018]' });
  const dir = sectionDirOf(root, 1, 'background');
  writeFileSync(join(dir, 'DRAFT.md'), '# Background\n\nAn early study proposed a link [@retracted2018].\n');
  // A record that says verified, and a compile record to match (the forgery done must not trust).
  forgeClean(root, dir, 1, 'background', ['retracted2018']);
  writeFileSync(join(root, '.paper', 'DRAFT.md'), readFileSync(join(dir, 'DRAFT.md')));
  writeCompileRecord(root, [{ n: 1, slug: 'background' }]);
  const libBefore = readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8');
  const d = runCli(sb, root, ['done', '--yolo', '--format', 'md'], { timeoutMs: 120_000 });
  assert.equal(d.status, EXIT_BLOCKED, `${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /citation \[@retracted2018\] is RETRACTED — .*\(re-checked now: LIBRARY\.json had its retraction status unknown\)/);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing exported');
  assert.equal(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8'), libBefore, 'a refused done writes nothing');
});
