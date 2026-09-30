// tests/dry-run-sources.test.ts — RUN-27 / D-17-11: the labelled synthetic
// dry-run source provider.
//
// Under --dry-run the ONLY source is bin/lib/sources/dry-run.ts, fed by the
// packaged corpus templates/dry-run/corpus.json (never tests/, RUN-05). For any
// query it returns deterministic synthetic sources in the reserved namespace
// (10.0000/pensmith-dryrun.<8 hex> DOIs, pensmith-dryrun.<8 hex> arXiv-style
// ids, 978-0-00 ISBN-style ids with a deliberately invalid check digit), each
// flagged synthetic. Pass 1 and Pass 3 accept a reserved id ONLY under
// --dry-run; outside it the id is FABRICATED / NOT_FOUND ("reserved dry-run
// identifier"), research filters it and add refuses it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDialRecorder } from './helpers/local-servers/dial-recorder.mjs';

process.env['PENSMITH_NO_LLM'] = '1';

const dryRun = await import('../bin/lib/sources/dry-run.js');
const { isReservedDryRunId, isbn13CheckDigit, DRY_RUN_DOI_PREFIX } = await import('../bin/lib/doi.js');
const { runResearchPassWithLog } = await import('./helpers/research-pass.js');
const { runPass1, RESERVED_DRY_RUN_REASON } = await import('../bin/lib/verify/pass1.js');
const { runPass3 } = await import('../bin/lib/verify/pass3.js');
const { networkMode } = await import('../bin/lib/http-mock.js');
const { SourceCandidateSchema } = await import('../bin/lib/schemas/source-candidate.js');

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

/** Run `fn` with --dry-run's environment (PENSMITH_DRY_RUN=1 + PENSMITH_NO_LLM=1). */
async function underDryRun<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env['PENSMITH_DRY_RUN'];
  process.env['PENSMITH_DRY_RUN'] = '1';
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_DRY_RUN'];
    else process.env['PENSMITH_DRY_RUN'] = saved;
  }
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('RUN-27: the corpus is packaged under templates/, never under tests/ (RUN-05)', () => {
  assert.ok(existsSync(dryRun.DRY_RUN_CORPUS_PATH), dryRun.DRY_RUN_CORPUS_PATH);
  assert.ok(dryRun.DRY_RUN_CORPUS_PATH.endsWith(join('templates', 'dry-run', 'corpus.json')));
  assert.ok(!dryRun.DRY_RUN_CORPUS_PATH.includes(`${sep}tests${sep}`), 'the dry-run corpus is not a test fixture');
});

test('RUN-27: search returns >=5 deterministic, schema-valid synthetic sources covering article, preprint and book', async () => {
  const a = await dryRun.search('medieval Icelandic sagas');
  const b = await dryRun.search('  Medieval   Icelandic Sagas ');
  assert.ok(a.length >= 5, `at least 5 sources, got ${a.length}`);
  assert.deepEqual(
    a.map((c) => c.doi),
    b.map((c) => c.doi),
    'same (normalized) query ⇒ same sources',
  );
  const other = await dryRun.search('protein folding');
  assert.notDeepEqual(a.map((c) => c.doi), other.map((c) => c.doi), 'a different query mints different sources');

  for (const c of a) {
    assert.equal(SourceCandidateSchema.safeParse(c).success, true, `schema-valid: ${JSON.stringify(c)}`);
    assert.equal(c.synthetic, true);
    assert.equal(c.source, 'dry-run');
    assert.ok(c.doi?.startsWith(DRY_RUN_DOI_PREFIX), `a reserved DOI: ${c.doi}`);
    assert.match((c.doi ?? '').slice(DRY_RUN_DOI_PREFIX.length), /^[0-9a-f]{8}$/);
    assert.ok(isReservedDryRunId(c.doi));
    assert.match(c.abstract ?? '', /\[synthetic dry-run source\]/);
  }
  const preprint = a.find((c) => c.arxiv !== undefined);
  assert.ok(preprint, 'a preprint with an arXiv-style id');
  assert.match(preprint.arxiv ?? '', /^pensmith-dryrun\.[0-9a-f]{8}$/);
  assert.ok(isReservedDryRunId(preprint.arxiv));
  const book = a.find((c) => c.isbn !== undefined);
  assert.ok(book, 'a book with an ISBN-style id');
  assert.match(book.isbn ?? '', /^978-0-00-\d{6}-\d$/);
  assert.ok(isReservedDryRunId(book.isbn));
});

test('RUN-27: fetchById reconstructs a minted source from its DOI or arXiv-style id; anything else is null', async () => {
  const [first] = await dryRun.search('medieval Icelandic sagas');
  assert.ok(first?.doi);
  const again = await dryRun.fetchById(first.doi);
  assert.equal(again?.title, first.title);
  assert.deepEqual(again?.authors, first.authors);
  const hex = first.doi.slice(DRY_RUN_DOI_PREFIX.length);
  assert.equal((await dryRun.fetchById(`pensmith-dryrun.${hex}`))?.doi, first.doi);
  assert.equal(await dryRun.fetchById('10.1038/nphys1170'), null);
  assert.equal(await dryRun.fetchById('10.0000/pensmith-dryrun.nothex!!'), null);
});

test('RUN-27: isReservedDryRunId recognises exactly the reserved namespace', () => {
  for (const id of [
    '10.0000/pensmith-dryrun.00c0ffee',
    'https://doi.org/10.0000/pensmith-dryrun.00c0ffee',
    'doi:10.0000/pensmith-dryrun.00c0ffee',
    'pensmith-dryrun.0a1b2c3d',
    'arXiv:pensmith-dryrun.0a1b2c3d',
  ]) {
    assert.equal(isReservedDryRunId(id), true, id);
  }
  // ISBN-style: 978-0-00-<6> with a WRONG check digit is reserved; the valid
  // check digit is a real ISBN and is not.
  const first12 = '978000123456';
  const valid = isbn13CheckDigit(first12);
  const invalid = (valid + 1) % 10;
  assert.equal(isReservedDryRunId(`978-0-00-123456-${invalid}`), true);
  assert.equal(isReservedDryRunId(`978-0-00-123456-${valid}`), false);
  for (const id of ['10.1038/nphys1170', '10.0000/other', '1706.03762', 'pensmith-dryrun', '', null, undefined]) {
    assert.equal(isReservedDryRunId(id), false, String(id));
  }
});

test('RUN-27: dry-run research uses ONLY the synthetic provider — >=5 sources, 0 dials, 0 DNS, 0 cassette reads, RESEARCH.md marker', async () => {
  const root = tmp('pensmith-dryrun-research-');
  mkdirSync(join(root, '.paper'), { recursive: true });
  const rec = installDialRecorder();
  let cands;
  try {
    cands = await underDryRun(() => {
      assert.equal(networkMode().dryRun, true);
      return runResearchPassWithLog(['medieval Icelandic sagas'], {
        topic: 'medieval Icelandic sagas', discipline: 'history', paperRoot: root,
      });
    });
  } finally {
    rec.restore();
  }
  assert.ok(cands.length >= 5, `>=5 synthetic sources, got ${cands.length}`);
  assert.ok(cands.every((c) => c.synthetic === true && isReservedDryRunId(c.doi)));
  assert.deepEqual(rec.events, [], `no dial, DNS lookup or cassette read: ${JSON.stringify(rec.events)}`);
  // GRND-19: under --dry-run the research log is written in the workspace, never in .paper/.
  assert.ok(!existsSync(join(root, '.paper', 'RESEARCH.md')), 'nothing was written to .paper/');
  const log = readFileSync(join(root, '.paper-dry-run', 'RESEARCH.md'), 'utf8');
  assert.match(log, /^> OFFLINE MODE \(--dry-run\) — synthetic dry-run sources, not live results\.$/m);
  assert.match(log, /synthetic dry-run source/);
});

test('RUN-27: outside --dry-run the orchestrator filters reserved identifiers out of any adapter result', async () => {
  const synthetic = dryRun.syntheticSource('00c0ffee');
  const real = { ...dryRun.syntheticSource('00beef00') };
  // A real-looking candidate (not synthetic, a real DOI) survives.
  const realCandidate = {
    ...real, source: 'crossref' as const, id: '10.1038/nphys1170', doi: '10.1038/nphys1170',
    title: 'Measured measurement', synthetic: undefined, raw: {},
  };
  delete (realCandidate as { synthetic?: unknown }).synthetic;
  const smuggled = { ...synthetic, source: 'crossref' as const };
  delete (smuggled as { synthetic?: unknown }).synthetic;
  const root = tmp('pensmith-dryrun-filter-');
  mkdirSync(join(root, '.paper'), { recursive: true });
  const saved = process.stderr.write.bind(process.stderr);
  const err: string[] = [];
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => { err.push(String(s)); return saved(s); };
  let out;
  try {
    out = await runResearchPassWithLog(['anything'], {
      topic: 'anything', discipline: 'other', paperRoot: root,
      registry: {
        fake: { search: async () => [smuggled, realCandidate] },
      },
    });
  } finally {
    (process.stderr as unknown as { write: typeof saved }).write = saved;
  }
  assert.deepEqual(out.map((c) => c.doi), ['10.1038/nphys1170'], 'the reserved-namespace candidate is dropped');
  assert.match(err.join(''), /synthetic sources exist only under --dry-run/);
});

function bib(entry: { key: string; doi: string; title: string; author: string; year: number }): string {
  const dir = tmp('pensmith-dryrun-bib-');
  const p = join(dir, 'CITATIONS.bib');
  writeFileSync(p, `@article{${entry.key},\n  title = {${entry.title}},\n  author = {${entry.author}},\n  doi = {${entry.doi}},\n  year = {${entry.year}}\n}\n`);
  return p;
}

const QUOTE_DRAFT = (ck: string): string =>
  `Claim [@${ck}].\n\n> The synthetic corpus text that no real source could ever contain for a careful reader today.\n\n[@${ck}]\n`;

test('RUN-27: Pass 1 accepts a reserved DOI ONLY under --dry-run (AND-gate against the minted source); outside it is FABRICATED', async () => {
  const s = dryRun.syntheticSource('00c0ffee');
  const good = bib({ key: 'syn', doi: s.doi ?? '', title: s.title, author: s.authors[0] ?? '', year: s.year ?? 2020 });
  const [outside] = await runPass1('Claim [@syn].\n', good);
  assert.equal(outside?.verdict, 'FABRICATED');
  assert.equal(outside?.reason, RESERVED_DRY_RUN_REASON);

  const [inside] = await underDryRun(() => runPass1('Claim [@syn].\n', good));
  assert.equal(inside?.verdict, 'OK', inside?.reason);
  // Under --dry-run the AND-gate still runs: a wrong title is MIS-CITED.
  const wrong = bib({ key: 'syn', doi: s.doi ?? '', title: 'Completely different title about something else', author: 'Nobody, Anne', year: 2020 });
  const [mis] = await underDryRun(() => runPass1('Claim [@syn].\n', wrong));
  assert.equal(mis?.verdict, 'MIS-CITED', mis?.reason);
});

test('RUN-27: Pass 3 — a quote from a reserved DOI is NOT_FOUND outside --dry-run, "text unavailable (dry-run)" under it', async () => {
  const s = dryRun.syntheticSource('00c0ffee');
  const map = new Map([['syn', { DOI: s.doi ?? '' }]]);
  const [outside] = await runPass3(QUOTE_DRAFT('syn'), map);
  assert.equal(outside?.verdict, 'NOT_FOUND');
  assert.match(outside?.reason ?? '', /reserved dry-run identifier/);
  const [inside] = await underDryRun(() => runPass3(QUOTE_DRAFT('syn'), map));
  assert.equal(inside?.verdict, 'PDF_UNAVAILABLE');
  assert.match(inside?.reason ?? '', /text unavailable \(dry-run\)/);
});

function runCli(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const data = tmp('pensmith-dryrun-data-');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === 'PENSMITH_DRY_RUN') continue;
    env[k] = v;
  }
  Object.assign(env, { XDG_DATA_HOME: data, LOCALAPPDATA: data, PENSMITH_NO_LLM: '1' });
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('RUN-27: `add <reserved DOI>` is refused outside --dry-run (non-zero) and reports unavailable (dry-run) under it', () => {
  const doi = dryRun.syntheticSource('00c0ffee').doi ?? '';
  const seed = (prefix: string): string => {
    const root = tmp(prefix);
    mkdirSync(join(root, '.paper'), { recursive: true });
    writeFileSync(join(root, '.paper', 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'dryrun', createdAt: new Date().toISOString(), sections: [] }));
    return root;
  };
  const real = seed('pensmith-dryrun-add-real-');
  const outside = runCli(['add', doi, '--yolo'], real);
  assert.notEqual(outside.status, 0, `refused: ${outside.stderr}`);
  assert.match(outside.stderr, /is a reserved dry-run identifier .*Source NOT added/);
  // A --dry-run works in its workspace, seeded from the paper (GRND-19).
  const preview = seed('pensmith-dryrun-add-preview-');
  const inside = runCli(['--dry-run', 'add', doi, '--yolo'], preview);
  assert.equal(inside.status, 0, `a dry-run preview is not an error: ${inside.stderr}`);
  assert.match(inside.stderr, /DOI verification unavailable \(dry-run\) — .* NOT added\./);
  for (const bibPath of [real, preview].flatMap((root) => [join(root, '.paper', 'CITATIONS.bib'), join(root, '.paper-dry-run', 'CITATIONS.bib')])) {
    assert.ok(!existsSync(bibPath) || !readFileSync(bibPath, 'utf8').includes('pensmith-dryrun'), `nothing is added in either mode (${bibPath})`);
  }
});

// ---------------------------------------------------------------------------
// A paper verified UNDER --dry-run never compiles or exports outside it
// ---------------------------------------------------------------------------

const { runCompile } = await import('../bin/lib/compile.js');
const { runExportBlockingGate } = await import('../bin/cli/done.js');
const { computeDraftHash } = await import('../bin/lib/draft-hash.js');
const { offlineMarkerLine } = await import('../bin/lib/http-mock.js');
const { renderPass1VerdictRow, dryRunVerificationReason, DRY_RUN_VERIFICATION_MARKER } = await import('../bin/lib/verify/verdict-rows.js');

/** One section whose VERIFICATION.md is what `verify --dry-run` writes for a reserved DOI. */
function seedDryRunVerifiedPaper(): string {
  const s = dryRun.syntheticSource('00c0ffee');
  const root = tmp('pensmith-dryrun-verified-');
  const secDir = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(secDir, { recursive: true });
  const bibPath = bib({ key: 'syn', doi: s.doi ?? '', title: s.title, author: s.authors[0] ?? '', year: s.year ?? 2020 });
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), readFileSync(bibPath, 'utf8'));
  // VRFY-26: the export gate reads the sections STATE.json registers.
  writeFileSync(join(root, '.paper', 'STATE.json'), JSON.stringify({ $schemaVersion: 3, paperId: 'dryrun-verified', createdAt: '2026-01-01T00:00:00.000Z', sections: [{ n: 1, slug: 'intro' }] }));
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', '| 1 | intro | Introduction | | 300 | syn |', ''].join('\n'),
  );
  const draft = '# Introduction\n\nA claim about the synthetic corpus [@syn].\n';
  writeFileSync(join(secDir, 'DRAFT.md'), draft);
  const hash = computeDraftHash(Buffer.from(draft, 'utf8'), ['syn']);
  writeFileSync(
    join(secDir, 'PLAN.md'),
    ['---', 'schema_version: 1', 'section: 1', 'slug: intro', 'title: Introduction', 'depends_on: []', 'assigned_sources: [syn]', `verified_against_draft_hash: '${hash}'`, 'status: verified', '---', '', '## Brief', ''].join('\n'),
  );
  const marker = offlineMarkerLine({ ...networkMode(), sourcesOffline: true, dryRun: true, reason: '--dry-run' });
  writeFileSync(
    join(secDir, 'VERIFICATION.md'),
    [marker ?? '', '', '# VERIFICATION (Section 1, intro)', '', 'Status: verified', '', '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)', '', renderPass1VerdictRow('syn', 'OK', 1, 1, 'dry-run synthetic source; D-11 AND-gate passed'), ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'DRAFT.md'), draft);
  return root;
}

test('RUN-27: the dry-run VERIFICATION.md marker is the one offlineMarkerLine writes under --dry-run', () => {
  const marker = offlineMarkerLine({ ...networkMode(), sourcesOffline: true, dryRun: true, reason: '--dry-run' });
  assert.ok(marker?.startsWith(DRY_RUN_VERIFICATION_MARKER), String(marker));
  assert.equal(dryRunVerificationReason(`${marker}\n\n# VERIFICATION\n\nStatus: verified\n`, true), null, 'accepted under --dry-run');
  assert.match(dryRunVerificationReason(`${marker}\n\n# VERIFICATION\n\nStatus: verified\n`, false) ?? '', /verified under --dry-run/);
  const offline = offlineMarkerLine({ ...networkMode(), sourcesOffline: true, dryRun: false, reason: 'PENSMITH_OFFLINE=1' });
  assert.equal(dryRunVerificationReason(`${offline}\n\nStatus: verified\n`, false), null, 'an offline (recorded-fixture) verification is not a dry-run one');
});

test('RUN-27: a section verified under --dry-run never compiles or exports outside --dry-run', async () => {
  const root = seedDryRunVerifiedPaper();
  const real = await runCompile({ paperRoot: root, yolo: true, onWarn: () => {} });
  assert.equal(real.refused, true, 'compile outside --dry-run refuses the dry-run verification');
  assert.ok((real.refuseReasons ?? []).some((r) => /verified under --dry-run against synthetic sources/.test(r)), JSON.stringify(real.refuseReasons));
  const block = runExportBlockingGate(root);
  assert.equal(block.blocked, true);
  assert.ok(block.reasons.some((r) => /verified under --dry-run/.test(r)), JSON.stringify(block.reasons));

  // Under --dry-run the same paper — as its workspace copy (GRND-19) — compiles.
  cpSync(join(root, '.paper'), join(root, '.paper-dry-run'), { recursive: true });
  const preview = await underDryRun(() => runCompile({ paperRoot: root, yolo: true, onWarn: () => {} }));
  assert.equal(preview.refused, false, `the --dry-run preview compiles: ${JSON.stringify(preview.refuseReasons)}`);
  assert.ok(existsSync(join(root, '.paper-dry-run', 'COMPILE-REPORT.md')), 'the preview compiled in the workspace');
});
