// tests/verify-cache-recheck.test.ts — the Phase 20 integration of the
// caches, the recomputation and the recheck clock (VRFY-19, VRFY-25, VRFY-26,
// VRFY-28; D-20-15, D-20-18, D-20-23, D-20-24, D-20-27), in process through
// the production verify / compile / done with every registrar and open-access
// host answered by a MockAgent (the test-lane live seam) that COUNTS requests:
//
//   - a wave of three sections verified at once: every cited key gets
//     LIBRARY.json `last_verified` (under the library lock — none is lost) and
//     `.paper/CITATIONS.bib` renders it; the quoted source's open-access PDF
//     (Unpaywall → a redirect → a real PDF) passes Pass 3;
//   - compile recomputes Pass 1 and Pass 3 from the warm caches: zero
//     registrar, Unpaywall or PDF requests, and LIBRARY.json / CITATIONS.bib
//     byte-identical (compile never writes them);
//   - done recomputes over the exported bytes from the same caches: zero
//     requests, and a second done again zero; export/CITATIONS.bib carries no
//     `last_verified` and no "pensmith";
//   - the test clock (PENSMITH_TEST_NOW): one day later done makes no request;
//     31 days later it re-fetches every cited work past the HTTP cache (and the
//     quoted source's copies) and records the new `last_verified`;
//     `[verification] recheck_after_days = 7` moves the threshold.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { writeState, writeOutline, writePlan, sectionDirOf } from './helpers/paper-cli-harness.js';
import { liveLane, uniq } from './sources/three-way.js';
import { textPdf } from './helpers/text-pdf.js';
import { upsertSources, tryLoadLibrary } from '../bin/lib/library.js';
import { TEST_NOW_ENV } from '../bin/lib/verify/clock.js';
import { _resetSourceTextMemoForTest } from '../bin/lib/verify/source-text.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

type Agent = Parameters<Parameters<typeof liveLane>[0]>[0];
const JSON_HEADERS = { headers: { 'content-type': 'application/json' } } as const;
const EMAIL = 'pensmith-dev@example.org';

const TEXT = [
  'Urban Canopy and Heat',
  'Street trees lower the surface temperature of the pavement beneath them by several degrees on a summer afternoon.',
  'The cooling is strongest where the canopy is continuous and weakest in open plazas.',
].join('\n');
const QUOTE = 'Street trees lower the surface temperature of the pavement beneath them';

interface Work {
  key: string;
  doi: string;
  title: string;
  family: string;
}

/** Request counts per kind of host. */
interface Counts {
  crossref: number;
  unpaywall: number;
  pdf: number;
  /** doi.org: the freshness HEAD of a DOI and the agency lookup of a prefix (review round 2: counted too). */
  doi: number;
}

/** The sha256 of a string (UTF-8). */
function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sha(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

/** Answer every registrar and open-access host the paper reaches, counting requests. */
function arm(agent: Agent, works: readonly Work[], pdf: Buffer, counts: Counts, onSearch?: () => void): void {
  const crossref = agent.get('https://api.crossref.org');
  for (const w of works) {
    crossref
      .intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${w.doi}`, method: 'GET' })
      .reply(() => {
        counts.crossref += 1;
        return {
          statusCode: 200,
          data: JSON.stringify({ status: 'ok', 'message-type': 'work', message: { DOI: w.doi, title: [w.title], author: [{ family: w.family, given: 'Ann' }], issued: { 'date-parts': [[2020]] }, type: 'journal-article' } }),
          responseOptions: JSON_HEADERS,
        };
      })
      .persist();
  }
  // The retraction re-query (Crossref's update filter) and anything else at Crossref: no notice.
  crossref
    .intercept({ path: /^\/works\?/, method: 'GET' })
    .reply(() => {
      counts.crossref += 1;
      return { statusCode: 200, data: JSON.stringify({ status: 'ok', 'message-type': 'work-list', message: { items: [], 'total-results': 0 } }), responseOptions: JSON_HEADERS };
    })
    .persist();
  const quoted = works[0] as Work;
  agent
    .get('https://api.unpaywall.org')
    .intercept({ path: (p: string) => decodeURIComponent(p).startsWith('/v2/'), method: 'GET' })
    .reply((opts) => {
      counts.unpaywall += 1;
      const doi = decodeURIComponent(String(opts.path)).replace(/^\/v2\//, '').replace(/\?.*$/, '');
      const loc = doi === quoted.doi ? [{ url: 'https://oa.example/link/1', url_for_pdf: 'https://oa.example/link/1', host_type: 'repository' }] : [];
      return {
        statusCode: 200,
        data: JSON.stringify({ doi, title: 'x', is_oa: loc.length > 0, z_authors: [{ raw_author_name: 'Ann Doe' }], best_oa_location: loc[0] ?? null, oa_locations: loc }),
        responseOptions: JSON_HEADERS,
      };
    })
    .persist();
  agent.get('https://oa.example').intercept({ path: '/link/1', method: 'GET' }).reply(302, '', { headers: { location: 'https://cdn.example/files/1.pdf' } }).persist();
  agent
    .get('https://cdn.example')
    .intercept({ path: '/files/1.pdf', method: 'GET' })
    .reply(() => {
      counts.pdf += 1;
      return { statusCode: 200, data: pdf, responseOptions: { headers: { 'content-type': 'application/pdf' } } };
    })
    .persist();
  // The advisory freshness probe (DOI HEAD) — counted: compile and done send none.
  agent
    .get('https://doi.org')
    .intercept({ path: /.*/, method: 'HEAD' })
    .reply(() => {
      counts.doi += 1;
      return { statusCode: 302, data: '', responseOptions: { headers: { location: 'https://publisher.example/' } } };
    })
    .persist();
  // The plagiarism phrase search (`onSearch` runs while done waits for it).
  agent
    .get('https://html.duckduckgo.com')
    .intercept({ path: /.*/, method: /GET|POST/ })
    .reply(() => {
      onSearch?.();
      return { statusCode: 200, data: '<html><body></body></html>', responseOptions: { headers: { 'content-type': 'text/html' } } };
    })
    .persist();
}

/** Run `fn` with the verb's stdout lines captured (the TAP stream passes through). */
async function quiet<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const s = String(chunk);
    if (/^pensmith|^\s+- /.test(s)) {
      lines.push(s);
      return true;
    }
    return orig(chunk);
  }) as typeof process.stdout.write;
  try {
    return { result: await fn(), out: lines.join('') };
  } finally {
    process.stdout.write = orig;
  }
}

async function withClock<T>(iso: string | null, fn: () => Promise<T>): Promise<T> {
  const saved = process.env[TEST_NOW_ENV];
  if (iso === null) delete process.env[TEST_NOW_ENV];
  else process.env[TEST_NOW_ENV] = iso;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env[TEST_NOW_ENV];
    else process.env[TEST_NOW_ENV] = saved;
  }
}

const plus = (iso: string, days: number): string => new Date(Date.parse(iso) + days * 86_400_000).toISOString();

test('VRFY-19 / VRFY-25 / VRFY-26 / VRFY-28: a wave verify records every last_verified; compile and done recompute from the warm caches with zero requests; the test clock re-checks exactly the stale citations', async () => {
  const pdf = await textPdf(TEXT);
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    const works: Work[] = [1, 2, 3].map((i) => ({ key: `work${i}`, doi: `10.5555/${uniq(`vrfy28-${i}`)}`, title: `Urban Canopy and Heat, Part ${['One', 'Two', 'Three'][i - 1]}`, family: ['Doe', 'Roe', 'Poe'][i - 1] as string }));
    await upsertSources(
      sb.root,
      works.map((w) => ({ source: 'crossref', id: w.doi, doi: w.doi, title: w.title, authors: [`${w.family}, Ann`], year: 2020, retracted: false, last_verified: null, citekey: w.key, raw: null }) as unknown as SourceCandidate),
      { provenance: 'add' },
    );
    const sections = works.map((w, i) => ({ n: i + 1, slug: `s${i + 1}`, sources: [w.key] }));
    writeState(sb.root, sections.map((s) => ({ n: s.n, slug: s.slug })));
    writeOutline(sb.root, sections);
    for (const [i, s] of sections.entries()) {
      writePlan(sb.root, s.n, s.slug, { status: 'written', assigned_sources: `[${works[i]!.key}]` });
      const body = i === 0 ? `One study reports that "${QUOTE}" [@${works[i]!.key}].` : `Canopy cover matters for heat in cities [@${works[i]!.key}].`;
      writeFileSync(join(sectionDirOf(sb.root, s.n, s.slug), 'DRAFT.md'), `# Section ${s.n}\n\n${body}\n`);
    }
    const counts: Counts = { crossref: 0, unpaywall: 0, pdf: 0, doi: 0 };
    const libPath = join(sb.paper, 'LIBRARY.json');
    const bibPath = join(sb.paper, 'CITATIONS.bib');

    await liveLane(async (agent) => {
      arm(agent, works, pdf, counts);
      const { verifySection } = await import('../bin/cli/verify.js');
      const { compileCommand } = await import('../bin/cli/compile.js');
      const { doneCommand } = await import('../bin/cli/done.js');
      const done = async (): Promise<string> => {
        _resetSourceTextMemoForTest(); // a new process
        const { result, out } = await quiet(() => doneCommand.run!({ args: { yolo: true, raw: true, format: 'md' } } as never));
        assert.equal((result as { ok?: boolean }).ok, true, out);
        return out;
      };

      // A wave: the three sections verified at once (VRFY-28: none of the stamps is lost).
      const verified = await quiet(() => Promise.all(sections.map((s) => verifySection(s.n, s.slug, null))));
      for (const v of verified.result) assert.equal(v.status, 'verified', verified.out);
      const q = verified.result[0]!.pass3?.[0];
      assert.equal(q?.verdict, 'PASS', q?.reason);
      assert.match(q?.reason ?? '', /verbatim in the open-access PDF at oa\.example/);
      const lib = await tryLoadLibrary(sb.root);
      const stamps = new Map((lib?.entries ?? []).map((e) => [e.citekey, e.last_verified ?? null]));
      for (const w of works) assert.match(String(stamps.get(w.key)), /^\d{4}-\d\d-\d\dT/, `${w.key} last_verified`);
      const bib = readFileSync(bibPath, 'utf8');
      for (const w of works) assert.match(bib, new RegExp(`last_verified = \\{${String(stamps.get(w.key)).replace(/[.]/g, '\\.')}\\}`), `CITATIONS.bib renders ${w.key}'s last_verified`);
      assert.ok(counts.crossref >= 3 && counts.unpaywall >= 1 && counts.pdf === 1, JSON.stringify(counts));

      // compile: the recomputation reads the warm caches — zero requests, nothing paper-level written.
      const before = { ...counts };
      const [libSha, bibSha] = [sha(libPath), sha(bibPath)];
      _resetSourceTextMemoForTest();
      const compiled = await quiet(() => compileCommand.run!({ args: { yolo: true } } as never));
      assert.notEqual((compiled.result as { refused?: boolean }).refused, true, compiled.out);
      assert.ok(existsSync(join(sb.paper, 'DRAFT.md')));
      assert.deepEqual(counts, before, 'compile recomputes Pass 1 and Pass 3 with zero registrar, Unpaywall or PDF requests');
      assert.equal(sha(libPath), libSha, 'compile never writes LIBRARY.json');
      assert.equal(sha(bibPath), bibSha, 'compile never writes CITATIONS.bib');

      // done, twice: the same caches — zero requests.
      await done();
      assert.deepEqual(counts, before, 'done recomputes over the exported bytes with zero requests');
      const exported = readFileSync(join(sb.paper, 'export', 'CITATIONS.bib'), 'utf8');
      assert.doesNotMatch(exported, /last_verified/, 'the exported bibliography keeps only standard fields');
      assert.doesNotMatch(exported, /pensmith/i);
      await done();
      assert.deepEqual(counts, before, 'a second done makes zero citation or PDF requests');

      // The test clock (D-20-27): one day later nothing is due.
      const stamp = String(stamps.get('work1'));
      await withClock(plus(stamp, 1), done);
      assert.deepEqual(counts, before, 'a 1-day-old check is served from the cache');

      // 31 days later every cited work is re-fetched past the HTTP cache, and the quoted source's copies too.
      await withClock(plus(stamp, 31), done);
      assert.equal(counts.crossref - before.crossref >= 3, true, `each stale citation re-fetched: ${JSON.stringify(counts)}`);
      assert.equal(counts.unpaywall - before.unpaywall >= 1, true, JSON.stringify(counts));
      assert.equal(counts.pdf - before.pdf, 1, 'the quoted source\'s PDF fetched again');
      const relib = await tryLoadLibrary(sb.root);
      const restamped = new Map((relib?.entries ?? []).map((e) => [e.citekey, e.last_verified ?? null]));
      for (const w of works) assert.ok(Date.parse(String(restamped.get(w.key))) > Date.parse(String(stamps.get(w.key))), `${w.key} re-stamped by done`);

      // recheck_after_days = 7 moves the threshold: 6 days later nothing, 8 days later a re-fetch.
      writeFileSync(join(sb.paper, 'config.toml'), 'schema_version = 3\n\n[verification]\nrecheck_after_days = 7\n');
      const newest = String(restamped.get('work1'));
      const mid = { ...counts };
      await withClock(plus(newest, 6), done);
      assert.deepEqual(counts, mid, 'within 7 days: served from the cache');
      await withClock(plus(newest, 8), done);
      assert.ok(counts.crossref > mid.crossref, `past 7 days: re-fetched ${JSON.stringify(counts)}`);
    }, { contactEmail: EMAIL });
  });
});

test('VRFY-26 (review round 2): done exports the bytes its gate judged — a DRAFT.md and a CITATIONS.bib written while done runs (here: during the plagiarism queries) never reach the export', async () => {
  const pdf = await textPdf(TEXT);
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    const w: Work = { key: 'work1', doi: `10.5555/${uniq('toctou')}`, title: 'Urban Canopy and Heat, Part One', family: 'Doe' };
    await upsertSources(
      sb.root,
      [{ source: 'crossref', id: w.doi, doi: w.doi, title: w.title, authors: [`${w.family}, Ann`], year: 2020, retracted: false, last_verified: null, citekey: w.key, raw: null } as unknown as SourceCandidate],
      { provenance: 'add' },
    );
    writeState(sb.root, [{ n: 1, slug: 's1' }]);
    writeOutline(sb.root, [{ n: 1, slug: 's1', sources: [w.key] }]);
    writePlan(sb.root, 1, 's1', { status: 'written', assigned_sources: `[${w.key}]` });
    writeFileSync(join(sectionDirOf(sb.root, 1, 's1'), 'DRAFT.md'), `# Section 1\n\nCanopy cover matters for heat in cities [@${w.key}].\n`);
    const counts: Counts = { crossref: 0, unpaywall: 0, pdf: 0, doi: 0 };
    const draftPath = join(sb.paper, 'DRAFT.md');
    const bibPath = join(sb.paper, 'CITATIONS.bib');
    let armed = false;
    let tampered = 0;
    // A sync client (or an editor) writes the compiled draft and the bibliography while done runs its plagiarism queries.
    const tamper = (): void => {
      if (!armed || tampered++ > 0) return;
      writeFileSync(draftPath, `${readFileSync(draftPath, 'utf8')}\nA fabricated survey agrees [@fake2099]. See also (Nguyen & Patel, 2019).\n`);
      writeFileSync(bibPath, `${readFileSync(bibPath, 'utf8')}\n@article{fake2099, title = {Fabricated}, author = {Nobody, Nora}, year = {2099}}\n`);
    };
    await liveLane(async (agent) => {
      arm(agent, [w], pdf, counts, tamper);
      const { verifySection } = await import('../bin/cli/verify.js');
      const { compileCommand } = await import('../bin/cli/compile.js');
      const { doneCommand } = await import('../bin/cli/done.js');
      const v = await quiet(() => verifySection(1, 's1', null));
      assert.equal(v.result.status, 'verified', v.out);
      const c = await quiet(() => compileCommand.run!({ args: { yolo: true } } as never));
      assert.notEqual((c.result as { refused?: boolean }).refused, true, c.out);
      const gated = readFileSync(draftPath, 'utf8');

      const stderr: string[] = [];
      const origErr = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      armed = true;
      let d: { result: unknown; out: string };
      try {
        d = await quiet(() => doneCommand.run!({ args: { yolo: true, raw: true, format: 'md' } } as never));
      } finally {
        process.stderr.write = origErr;
      }
      assert.ok(tampered > 0, 'the files were written while done ran');
      assert.equal((d.result as { ok?: boolean }).ok, true, d.out);
      const exported = readFileSync(join(sb.paper, 'export', 'DRAFT.md'), 'utf8');
      assert.doesNotMatch(exported, /fake2099|Nguyen/, 'the export holds only the gated text');
      assert.match(exported, /Canopy cover matters for heat in cities/);
      assert.doesNotMatch(readFileSync(join(sb.paper, 'export', 'CITATIONS.bib'), 'utf8'), /fake2099/, 'the exported bibliography is the gated one');
      assert.equal(readFileSync(join(sb.paper, 'FINAL.md'), 'utf8'), gated, 'FINAL.md is the text done checked');
      assert.match(stderr.join(''), /pensmith done: WARN — \.paper\/DRAFT\.md and \.paper\/CITATIONS\.bib changed while done ran; the export holds the text done checked/);
      const report = readFileSync(join(sb.paper, 'VERIFICATION.md'), 'utf8');
      assert.ok(report.includes(`Text checked: .paper/DRAFT.md (sha256 ${sha256Of(gated)})`), 'the report names the exported bytes');
    }, { contactEmail: EMAIL });
  });
});

test('VRFY-15 / VRFY-26 (review round 2): done\'s retraction re-check sends no DOI HEAD, asks the prefix\'s agency before any registrar, and records a DataCite DOI\'s status as unknown for good — a second done asks nothing', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    const doi = '10.5281/zenodo.1234567';
    await upsertSources(
      sb.root,
      [{ source: 'datacite', id: doi, doi, title: 'A dataset of things', authors: ['Doe, Ann'], year: 2020, retracted: false, retraction_status: 'unknown', last_verified: null, citekey: 'doe2020', raw: null } as unknown as SourceCandidate],
      { provenance: 'add' },
    );
    const counts = { head: 0, crossref: 0, ra: 0 };
    await liveLane(async (agent) => {
      agent.get('https://api.crossref.org').intercept({ path: /.*/, method: 'GET' }).reply(() => {
        counts.crossref += 1;
        return { statusCode: 404, data: 'Resource not found.' };
      }).persist();
      agent
        .get('https://doi.org')
        .intercept({ path: /^\/ra\//, method: 'GET' })
        .reply(() => {
          counts.ra += 1;
          return { statusCode: 200, data: JSON.stringify([{ DOI: '10.5281', RA: 'DataCite' }]), responseOptions: JSON_HEADERS };
        })
        .persist();
      agent.get('https://doi.org').intercept({ path: /.*/, method: 'HEAD' }).reply(() => {
        counts.head += 1;
        return { statusCode: 302, data: '', responseOptions: { headers: { location: 'https://zenodo.org/x' } } };
      }).persist();
      const { recheckUnknownRetractions } = await import('../bin/cli/done.js');
      const { recordRetractionStatuses } = await import('../bin/lib/library.js');
      const text = 'A claim [@doe2020].\n';
      const first = await recheckUnknownRetractions(sb.root, text);
      assert.deepEqual(first.retracted, []);
      assert.deepEqual(first.decided, { doe2020: { status: 'unknown', details: 'no retraction data for DataCite DOIs' } });
      assert.deepEqual(counts, { head: 0, crossref: 0, ra: 1 }, 'the prefix\'s agency only: no DOI HEAD, no Crossref lookup');
      // done records the answers once it exports.
      await recordRetractionStatuses(sb.root, first.decided);
      const e = (await tryLoadLibrary(sb.root))?.entries.find((x) => x.citekey === 'doe2020');
      assert.equal(e?.retraction_status, 'unknown', 'never "clear"');
      assert.equal(e?.retraction_details, 'no retraction data for DataCite DOIs');
      const second = await recheckUnknownRetractions(sb.root, text);
      assert.deepEqual(second, { retracted: [], decided: {} });
      assert.deepEqual(counts, { head: 0, crossref: 0, ra: 1 }, 'a second done asks nothing');
    }, { contactEmail: EMAIL });
  });
});
