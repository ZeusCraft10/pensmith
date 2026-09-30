// tests/section-research.test.ts — `plan N --research <query>` (GRND-17,
// D-19-18; bin/lib/section-research.ts), in-process against the RUN-21 mock
// LLM with fake adapters injected through the research registry seam.
//
// Asserted: hits reach ONLY section N's PLAN.md assigned_sources (the real
// library keys; status and verified_against_draft_hash untouched), under the
// section-as-phase rule — every file of sections 1 and 3 keeps its sha256 and
// mtime; LIBRARY.json gains the hits tagged plan-research:§N with no
// duplicate; RESEARCH.md keeps its prior content (only the sources block is
// re-rendered); the section's RESEARCH-LOG.md gains an entry per run; the
// queries are the query and the query joined to the section title (redacted
// when PII redaction is on); a run that cannot ask refuses before anything;
// zero hits → per-adapter reasons, exit 1, nothing written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { runSectionResearch, sectionQueries, knownEntryFor } from '../bin/lib/section-research.js';
import { __setResearchRegistryForTest, type AdapterRegistry } from '../bin/lib/research-orchestrator.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { Schema as LibrarySchema, type LibraryEntry } from '../bin/lib/schemas/library.js';
import { upsertSources } from '../bin/lib/library.js';
import { candidateToEntry } from '../bin/lib/migrations/library/shape.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { EXIT_APPROVAL, EXIT_ERROR, isPensmithError } from '../bin/lib/exit-codes.js';
import { RESEARCH_LOG_END, SOURCES_START, SOURCES_END } from '../bin/lib/research-md.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import type { SearchOptions } from '../bin/lib/sources/search-failure.js';

const KEY = 'sk-test-section-research-0001';
const QUERY = 'instagram adolescent depression longitudinal';
const NOW = '2026-09-28T00:00:00.000Z';

function cand(n: number, extra: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    source: 'crossref',
    id: `10.5555/sr.${n}`,
    doi: `10.5555/sr.${n}`,
    title: `Instagram use and adolescent depression: a longitudinal study ${n}`,
    authors: [`Writer${n}, Wren`],
    year: 2019,
    abstract: `Longitudinal cohort ${n} on Instagram use and depressive symptoms in adolescents.`,
    retracted: false,
    last_verified: NOW,
    citekey: `writer${n}2019`,
    raw: {},
    type: 'article-journal',
    venue: 'JAMA Pediatrics',
    ...extra,
  } as SourceCandidate;
}

const SECTIONS = [
  { n: 1, slug: 'introduction', title: 'Introduction' },
  { n: 2, slug: 'background', title: 'Background' },
  { n: 3, slug: 'discussion', title: 'Discussion' },
] as const;

function sectionDir(sb: LlmSandbox, n: number, slug: string): string {
  return path.join(sb.paper, 'sections', `${String(n).padStart(2, '0')}-${slug}`);
}

/** A three-section paper: brief, STATE, OUTLINE, PLAN.md per section (drafts in 1 and 3), a library, RESEARCH.md with notes. */
async function seedPaper(sb: LlmSandbox, opts: { pii?: boolean } = {}): Promise<void> {
  fs.writeFileSync(
    path.join(sb.paper, 'INTAKE.md'),
    renderIntakeDocument({ topic: 'social media and adolescent mental health', discipline: 'psychology', pii_redaction: opts.pii === true }, 'Write a paper on social media and adolescent mental health.', []),
  );
  fs.writeFileSync(
    path.join(sb.paper, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'section-research', createdAt: NOW, sections: SECTIONS.map((s) => ({ n: s.n, slug: s.slug })) }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(sb.paper, 'OUTLINE.md'),
    ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      ...SECTIONS.map((s) => `| ${s.n} | ${s.slug} | ${s.title} |  | 400 | known2018 |`), ''].join('\n'),
  );
  for (const s of SECTIONS) {
    const dir = sectionDir(sb, s.n, s.slug);
    fs.mkdirSync(dir, { recursive: true });
    const status = s.n === 2 ? 'verified' : 'written';
    fs.writeFileSync(
      path.join(dir, 'PLAN.md'),
      ['---', 'schema_version: 2', `section: ${s.n}`, `slug: ${s.slug}`, `title: ${s.title}`, 'depends_on: []', 'assigned_sources:', '  - known2018',
        `status: ${status}`, `verified_against_draft_hash: ${s.n === 2 ? 'abc123' : 'null'}`, '---', '', '## Brief', '', `Section ${s.n}.`, ''].join('\n'),
    );
    if (s.n !== 2) fs.writeFileSync(path.join(dir, 'DRAFT.md'), `# ${s.title}\n\nA sentence [@known2018].\n`);
  }
  await upsertSources(sb.root, [{ ...cand(9), citekey: 'known2018', doi: '10.5555/sr.9', year: 2018 }], { provenance: 'research' });
  fs.writeFileSync(
    path.join(sb.paper, 'RESEARCH.md'),
    `# Research log\n\nScope: earlier run\n\n${SOURCES_START}\n## Sources (1)\n\n- [@known2018] old\n${SOURCES_END}\n\n${RESEARCH_LOG_END}\n\n## My notes\n\n- keep this curated note\n`,
  );
}

interface Tree {
  [rel: string]: { sha: string; mtimeMs: number };
}

function tree(dir: string): Tree {
  const out: Tree = {};
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = { sha: createHash('sha256').update(fs.readFileSync(p)).digest('hex'), mtimeMs: st.mtimeMs };
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function registryWith(results: (q: string) => SourceCandidate[]): { calls: Array<{ adapter: string; query: string }>; registry: AdapterRegistry } {
  const calls: Array<{ adapter: string; query: string }> = [];
  const registry: AdapterRegistry = {};
  for (const name of ['pubmed', 'openalex', 'crossref', 'semanticscholar', 'arxiv']) {
    registry[name] = {
      async search(query: string): Promise<SourceCandidate[]> {
        calls.push({ adapter: name, query });
        return name === 'crossref' ? results(query) : [];
      },
    };
  }
  return { calls, registry };
}

async function run(opts: Omit<Parameters<typeof runSectionResearch>[0], 'io'>): Promise<{ value: Awaited<ReturnType<typeof runSectionResearch>> | null; error: unknown; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const e = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => { err.push(String(s)); return true; };
  try {
    const value = await runSectionResearch({ ...opts, io: { out: (l) => out.push(`${l}\n`), err: (l) => err.push(`${l}\n`) } });
    return { value, error: null, out: out.join(''), err: err.join('') };
  } catch (error) {
    return { value: null, error, out: out.join(''), err: err.join('') };
  } finally {
    (process.stderr as unknown as { write: typeof e }).write = e;
  }
}

async function withSection(fn: (sb: LlmSandbox) => Promise<void>, env: Record<string, string | undefined> = {}): Promise<void> {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined, ...env } }, async (sb) => {
    try {
      await fn(sb);
    } finally {
      __setResearchRegistryForTest(null);
    }
  });
}

test('GRND-17: plan 2 --research adds real hits to section 2 only; §1/§3 byte- and mtime-identical; RESEARCH.md prior content kept', async () => {
  await withSection(async (sb) => {
    await seedPaper(sb);
    const { registry, calls } = registryWith(() => [cand(1), cand(2), cand(9, { citekey: 'writer92019' })]);
    __setResearchRegistryForTest(registry);
    const past = new Date(Date.now() - 120_000);
    for (const s of [SECTIONS[0], SECTIONS[2]]) {
      for (const f of fs.readdirSync(sectionDir(sb, s.n, s.slug))) fs.utimesSync(path.join(sectionDir(sb, s.n, s.slug), f), past, past);
    }
    const other1 = tree(sectionDir(sb, 1, 'introduction'));
    const other3 = tree(sectionDir(sb, 3, 'discussion'));
    const researchBefore = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');

    const r = await run({ root: sb.root, n: 2, slug: 'background', query: QUERY, yolo: true });
    assert.equal(r.error, null, `${String(r.error)}\n${r.err}`);
    assert.deepEqual([...new Set(calls.map((c) => c.query))], [QUERY, `${QUERY} Background`], 'the query, and the query joined to the section title');
    assert.equal(calls[0]!.adapter, 'pubmed', 'the psychology preset\'s adapter plan');

    // LIBRARY.json: the new hits tagged plan-research:§2; the known work merged, not duplicated.
    const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    const dois = lib.entries.map((e) => e.doi);
    assert.equal(new Set(dois).size, dois.length, 'no duplicate DOI');
    assert.deepEqual(lib.entries.map((e) => e.citekey).sort(), ['known2018', 'writer12019', 'writer22019']);
    assert.ok(lib.entries.find((e) => e.citekey === 'writer12019')!.provenance.includes('plan-research:§2:crossref'));
    assert.ok(lib.entries.find((e) => e.citekey === 'known2018')!.provenance.includes('plan-research:§2:crossref'), 'the known work records this pass too');

    // Only §2's PLAN.md gains the real keys; its status and hash are untouched.
    const plan2 = parseFrontmatter(fs.readFileSync(path.join(sectionDir(sb, 2, 'background'), 'PLAN.md'), 'utf8')).frontmatter;
    assert.deepEqual(plan2['assigned_sources'], ['known2018', 'writer12019', 'writer22019']);
    assert.equal(plan2['status'], 'verified');
    assert.equal(plan2['verified_against_draft_hash'], 'abc123');
    assert.deepEqual(r.value!.added, ['writer12019', 'writer22019'], 'the already-assigned known work is not added twice');
    assert.deepEqual(r.value!.newToLibrary, ['writer12019', 'writer22019']);

    // Section-as-phase: §1 and §3 unchanged, content and mtime.
    assert.deepEqual(tree(sectionDir(sb, 1, 'introduction')), other1);
    assert.deepEqual(tree(sectionDir(sb, 3, 'discussion')), other3);

    // RESEARCH.md: only the sources block changed.
    const after = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    const strip = (t: string): string => t.slice(0, t.indexOf(SOURCES_START)) + t.slice(t.indexOf(SOURCES_END));
    assert.equal(strip(after), strip(researchBefore), 'everything outside the sources block is byte-identical');
    assert.match(after, /## Sources \(3\)/);
    assert.match(after, /Tags: search, plan-research/);
    assert.ok(after.endsWith('## My notes\n\n- keep this curated note\n'));

    // The section's research log.
    const log = fs.readFileSync(path.join(sectionDir(sb, 2, 'background'), 'RESEARCH-LOG.md'), 'utf8');
    assert.match(log, /^# Research log — section 2: Background$/m);
    assert.match(log, new RegExp(`^## \\d{4}-\\d{2}-\\d{2}T[^ ]+ — "${QUERY}"$`, 'm'));
    assert.match(log, /^- Added to this section's assigned_sources: writer12019, writer22019$/m);
    assert.match(log, /^- New to LIBRARY\.json: writer12019, writer22019$/m);
    assert.match(log, /^- Adapters: pubmed 0 \(no results\); openalex 0 \(no results\); semanticscholar 0 \(no results\); crossref 6 \(ok\)/m, 'psychology: pubmed, openalex (psycnet), then the default five');
    assert.match(r.out, /added 2 source\(s\) to section 2's assigned_sources \(2 new to LIBRARY\.json, 1 already in the library\): writer12019, writer22019/);

    // A second run appends a second entry; nothing is re-added.
    const again = await run({ root: sb.root, n: 2, slug: 'background', query: 'instagram depression cohort', yolo: true });
    assert.equal(again.error, null, String(again.error));
    const log2 = fs.readFileSync(path.join(sectionDir(sb, 2, 'background'), 'RESEARCH-LOG.md'), 'utf8');
    assert.equal(log2.split('\n## ').length - 1, 2, 'two entries');
    assert.ok(log2.startsWith(log), 'appended, not rewritten');
    assert.deepEqual(again.value!.added, []);
  });
});

test('D-18-37 (review round 1): a retracted hit is kept in LIBRARY.json but never assigned to the section — the drafter can never be shown it', async () => {
  await withSection(async (sb) => {
    await seedPaper(sb);
    const notice = '2020-06-04: Retraction (notice 10.5555/sr.notice)';
    const { registry } = registryWith(() => [cand(1), cand(3, { retracted: true, retraction_status: 'retracted', retraction_details: notice })]);
    __setResearchRegistryForTest(registry);
    const r = await run({ root: sb.root, n: 2, slug: 'background', query: QUERY, yolo: true });
    assert.equal(r.error, null, `${String(r.error)}\n${r.err}`);

    const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    const bad = lib.entries.find((e) => e.citekey === 'writer32019');
    assert.ok(bad, 'the retracted work is recorded in the library');
    assert.equal(bad.retracted, true);

    const plan2 = parseFrontmatter(fs.readFileSync(path.join(sectionDir(sb, 2, 'background'), 'PLAN.md'), 'utf8')).frontmatter;
    assert.deepEqual(plan2['assigned_sources'], ['known2018', 'writer12019'], 'the retracted hit never reaches assigned_sources');
    assert.deepEqual(r.value!.added, ['writer12019']);
    assert.match(r.err, /pensmith plan --research: WARN — not added to section 2: writer32019 \(retracted \(Retraction Watch\)\) — the citation verifier would not pass a citation of them \(a retracted source is never cited\)/);

    const log = fs.readFileSync(path.join(sectionDir(sb, 2, 'background'), 'RESEARCH-LOG.md'), 'utf8');
    assert.match(log, /^- Added to this section's assigned_sources: writer12019$/m);
    assert.match(log, /^ {2}- \[@writer32019\] .* — not assigned: the citation verifier would not pass a citation of it \(retracted \(Retraction Watch\)\)$/m);
    assert.match(log, /^- RETRACTED \(kept in LIBRARY\.json, not assigned — Pass 1 blocks a citation of it\): writer32019$/m);
  });
});

test('GRND-17: without a terminal and without --yolo it refuses (exit 3) before any model call, search or file change', async () => {
  await withSection(async (sb) => {
    await seedPaper(sb);
    const { registry, calls } = registryWith(() => [cand(1)]);
    __setResearchRegistryForTest(registry);
    const before = tree(sb.paper);
    const r = await run({ root: sb.root, n: 2, slug: 'background', query: QUERY, yolo: false });
    assert.ok(isPensmithError(r.error) && r.error.exitCode === EXIT_APPROVAL, String(r.error));
    assert.match((r.error as Error).message, /^Add these research hits to the section\? \(section 2: nothing was searched, sent or written\) needs an answer: re-run in a terminal, or pass --yolo to add every hit to the section\.$/);
    assert.equal(calls.length, 0);
    assert.equal(sb.mock!.callCount(), 0);
    assert.deepEqual(tree(sb.paper), before, 'no file changed (content or mtime)');
  });
});

test('GRND-17: zero hits → the per-adapter reasons, exit 1, nothing written', async () => {
  await withSection(async (sb) => {
    await seedPaper(sb);
    const { registry } = registryWith(() => []);
    registry['openalex'] = {
      async search(_q: string, o?: SearchOptions): Promise<SourceCandidate[]> {
        o?.onFailure?.('keyless daily budget exhausted — set OPENALEX_API_KEY (free)');
        return [];
      },
    };
    __setResearchRegistryForTest(registry);
    const before = tree(sb.paper);
    const r = await run({ root: sb.root, n: 2, slug: 'background', query: QUERY, yolo: true });
    assert.ok(isPensmithError(r.error) && r.error.exitCode === EXIT_ERROR, String(r.error));
    assert.match((r.error as Error).message, /^pensmith plan --research: no research hits for "instagram adolescent depression longitudinal" — pubmed 0 \(no results\), openalex 0 \(failed \(keyless daily budget exhausted — set OPENALEX_API_KEY \(free\)\)\), semanticscholar 0 \(no results\), crossref 0 \(no results\)/);
    assert.match((r.error as Error).message, /nothing was changed$/);
    const after = tree(sb.paper);
    for (const k of Object.keys(after)) {
      if (/SESSION\.log|COSTS\.jsonl/.test(k)) delete after[k];
    }
    assert.deepEqual(after, before, 'nothing written');
  });
});

test('GRND-17: with PII redaction on, the query is redacted before any search or model request', async () => {
  await withSection(async (sb) => {
    await seedPaper(sb, { pii: true });
    const { registry, calls } = registryWith(() => [cand(1)]);
    __setResearchRegistryForTest(registry);
    const r = await run({ root: sb.root, n: 2, slug: 'background', query: 'depression survey jane.doe@example.com', yolo: true });
    assert.equal(r.error, null, String(r.error));
    assert.ok(calls.length > 0);
    for (const c of calls) assert.doesNotMatch(c.query, /jane\.doe@example\.com/, c.query);
    for (const body of sb.mock!.bodiesFor('source-evaluator')) assert.doesNotMatch(JSON.stringify(body), /jane\.doe@example\.com/);
    assert.match(r.out, /\(PII-redacted\)/);
  });
});

test('GRND-17: a section without a PLAN.md is refused (exit 1) before any search', async () => {
  await withSection(async (sb) => {
    await seedPaper(sb);
    fs.rmSync(path.join(sectionDir(sb, 2, 'background'), 'PLAN.md'));
    const { registry, calls } = registryWith(() => [cand(1)]);
    __setResearchRegistryForTest(registry);
    const r = await run({ root: sb.root, n: 2, slug: 'background', query: QUERY, yolo: true });
    assert.ok(isPensmithError(r.error) && r.error.exitCode === EXIT_ERROR);
    assert.match((r.error as Error).message, /section 2 has no PLAN\.md yet/);
    assert.equal(calls.length, 0);
  });
});

test('sectionQueries: the query and the query joined to the title, distinct', () => {
  assert.deepEqual(sectionQueries('  instagram   depression ', 'Background'), ['instagram depression', 'instagram depression Background']);
  assert.deepEqual(sectionQueries('x', ''), ['x']);
});

test('knownEntryFor: the library-writer identity rules label a hit already in the library', () => {
  const entry = (c: Partial<SourceCandidate>): LibraryEntry => candidateToEntry({ ...cand(1), ...c }, ['research'], NOW);
  const lib = [entry({ citekey: 'a2019', doi: '10.5555/sr.1' }), entry({ citekey: 'b2019', doi: undefined, id: '1706.03762', source: 'arxiv', arxiv: '1706.03762', title: 'Attention Is All You Need' })];
  assert.equal(knownEntryFor(lib, entry({ doi: 'https://doi.org/10.5555/SR.1' }))?.citekey, 'a2019', 'normalized DOI');
  assert.equal(knownEntryFor(lib, entry({ doi: undefined, id: '1706.03762v5', source: 'arxiv', arxiv: '1706.03762v5', title: 'Other' }))?.citekey, 'b2019', 'arXiv id without version');
  assert.equal(knownEntryFor(lib, entry({ doi: '10.5555/other', title: 'Unrelated work' })), null);
});
