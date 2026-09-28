// tests/e2e-chain.test.ts — GRND-18 end to end (18-PLAN.md §7 step 3), with
// the RUN-26 plan/write cache proof and the FEED-01/02 chain-wide allocation
// check. Integration test: it needs all four Phase 18 streams.
//
// A folder holding only tests/fixtures/assignment.txt (the PRD §15 assignment)
// is driven by repeated bare `pensmith --yolo` runs of the BUILT CLI against
// the RUN-21 mock LLM, over the recorded e2e corpus (D-18-31): the scripted
// intake-clarifier / topic-disambiguator / source-evaluator replies of
// tests/fixtures/e2e-corpus/mock-script.json, every other slug on its contract
// stub, and every source request replayed offline from
// tests/fixtures/cassettes/e2e/. It asserts:
//   - `status (done)` within 5 + N runs, every run exit 0, FINAL.md and an
//     export, every section verified with >= 1 citation of its own sources;
//   - no step ran twice (the `pensmith: ran …` lines and the per-slug mock
//     call counts);
//   - a stale `open` pointer's paper is byte- and mtime-identical afterwards;
//   - the SESSION.log `kind:"llm"` costs add up to the COSTS.jsonl total;
//   - every section DRAFT.md is reproduced byte-for-byte from the log — by
//     scripts/extract-fixture.mjs + a fixture-only mock, and by `resume
//     --replay <id>` with zero model calls;
//   - RUN-26: every planner and drafter call sends the unmodified template as
//     a cache_control system block, and the second and third calls of each
//     read it from the cache (mock usage and SESSION.log);
//   - FEED-01/02: each captured planner and drafter request carries only its
//     own section's sources.
// A second case: without --yolo and without a terminal, the outline gate stops
// the chain with exit 3 before any outline request, registering nothing.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadE2eManifest, openChainSandbox, REPO, type ChainRun, type ChainSandbox } from './helpers/e2e-chain.js';
import { startMockLlm, type CapturedRequest } from './helpers/local-servers/mock-llm.js';
import { extractCitedKeysForVerification } from '../bin/lib/citation-token.js';
import { promptHints } from '../bin/lib/prompt-request.js';
import { loadPrompt } from '../bin/lib/prompt-loader.js';
import { parseOutline } from '../bin/lib/outline-parse.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';
import { pensmithDataDir } from '../bin/lib/paths.js';

const sandboxes: ChainSandbox[] = [];
after(async () => {
  for (const sb of sandboxes) await sb.close();
});

async function sandbox(prefix: string): Promise<ChainSandbox> {
  const sb = await openChainSandbox({ prefix, assignment: true });
  sandboxes.push(sb);
  return sb;
}

/** relative path → sha256 + mtime of every file under `dir`. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(relative(dir, p), `${createHash('sha256').update(readFileSync(p)).digest('hex')} ${statSync(p).mtimeMs}`);
    }
  };
  walk(dir);
  return out;
}

function jsonl(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** The `pensmith: ran …` step labels of a run (exit suffixes stripped). */
function ranSteps(r: ChainRun): string[] {
  const m = /^pensmith: ran (.+); next: .+$/m.exec(r.stderr);
  if (!m) return [];
  return (m[1] as string).split(', ').map((s) => s.replace(/ \(exit \d+\)$/, ''));
}

/** The section folders (sections/NN[a]-slug), archive excluded, in order. */
function sectionDirs(paper: string): string[] {
  return readdirSync(join(paper, 'sections')).filter((d) => d !== '_archive').sort();
}

function planOf(paper: string, dir: string): Record<string, unknown> {
  return loadFrontmatterDocSync('plan', join(paper, 'sections', dir, 'PLAN.md')).frontmatter as Record<string, unknown>;
}

/** The data blocks of a captured request's user message, as a stub reads them. */
function requestBlocks(req: CapturedRequest): Record<string, unknown> {
  const messages = (req.body?.['messages'] ?? []) as Array<{ content: unknown }>;
  const content = messages[messages.length - 1]?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map((b) => (b as { text?: string }).text ?? '').join('') : '';
  return promptHints(text);
}

function wordHit(text: string, key: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${key}([^A-Za-z0-9_]|$)`).test(text);
}

test('GRND-18: bare `pensmith --yolo` from a folder with only assignment.txt reaches done in <= 5 + N runs over the recorded corpus', async () => {
  const manifest = loadE2eManifest();
  const n = manifest.expectedSections;
  const sb = await sandbox('e2e-chain');
  const paper = join(sb.root, '.paper');

  // A stale `open` pointer at another paper (S-21): a bare run beside an
  // assignment starts its own paper here and never touches the pointed one.
  const other = join(sb.base, 'other-paper');
  mkdirSync(other);
  writeFileSync(join(other, 'assignment.txt'), 'Write a 1200-word expository essay on tidal energy in estuaries, MLA style.\n');
  assert.equal((await sb.run(['new', '--yolo'], { cwd: other })).status, 0, 'the other paper was created');
  const opened = await sb.run(['open', 'other-paper'], { cwd: sb.base });
  assert.equal(opened.status, 0, `open: ${opened.stderr}`);
  const otherBefore = snapshot(join(other, '.paper'));
  const baseline = sb.mock.requests.length;

  sb.applyCorpusScript();
  const runs = await sb.loop(['--yolo'], { maxRuns: 5 + n, until: (r) => /next: status \(done\)$/m.test(r.stderr) });
  const transcript = runs.map((r, i) => `#${i + 1} exit ${r.status}\n${r.stderr.split('\n').filter((l) => l.startsWith('pensmith')).join('\n')}`).join('\n');
  for (const r of runs) assert.equal(r.status, 0, `every run succeeds:\n${transcript}\n${r.stdout}\n${r.stderr}`);
  assert.ok(runs.length <= manifest.runBound && runs.length <= 5 + n, `done within 5 + N = ${5 + n} runs (took ${runs.length}):\n${transcript}`);
  assert.match(runs[runs.length - 1]!.stderr, /^pensmith: ran done; next: status \(done\)$/m, transcript);

  // No step ran twice: the ran-lines name each step once, in pipeline order.
  const steps = runs.flatMap(ranSteps);
  assert.equal(new Set(steps).size, steps.length, `no step re-executed: ${steps.join(', ')}`);
  for (const s of ['new', 'research', 'outline', 'compile', 'done']) assert.ok(steps.includes(s), `${s} ran: ${steps.join(', ')}`);
  for (let i = 1; i <= n; i += 1) {
    assert.ok(steps.includes(`plan §${i}`) && steps.includes(`write §${i}`), `§${i} was planned and written in its step: ${steps.join(', ')}`);
  }

  // … and every model step was billed once (the per-slug mock call counts).
  const chainRequests = sb.mock.requests.slice(baseline).filter((r) => r.slug !== null && r.shape !== 'models');
  const counts: Record<string, number> = {};
  for (const r of chainRequests) counts[r.slug as string] = (counts[r.slug as string] ?? 0) + 1;
  assert.deepEqual(
    { clarifier: counts['intake-clarifier'], disambiguator: counts['topic-disambiguator'], evaluator: counts['source-evaluator'], outline: counts['outline-author'], planner: counts['section-planner'], drafter: counts['section-drafter'] },
    { clarifier: 1, disambiguator: 1, evaluator: 1, outline: 1, planner: n, drafter: n },
    `one call per step: ${JSON.stringify(counts)}`,
  );

  // The paper: FINAL.md, an export, every section verified citing its own sources.
  assert.ok(existsSync(join(paper, 'FINAL.md')), 'FINAL.md');
  assert.ok(readdirSync(join(paper, 'export')).some((f) => f.startsWith('DRAFT.')), 'an exported draft');
  const outline = parseOutline(readFileSync(join(paper, 'OUTLINE.md'), 'utf8')).sections;
  assert.equal(outline.length, n, 'the expected section count');
  const dirs = sectionDirs(paper);
  assert.equal(dirs.length, n);
  const library = (JSON.parse(readFileSync(join(paper, 'LIBRARY.json'), 'utf8')) as { entries: Array<{ citekey: string }> }).entries.map((e) => e.citekey);
  assert.deepEqual([...library].sort(), manifest.keptSources.map((s) => s.citekey).sort(), 'the library is the corpus keep-list');
  for (const dir of dirs) {
    const plan = planOf(paper, dir);
    assert.equal(plan['status'], 'verified', `${dir} verified`);
    assert.ok(existsSync(join(paper, 'sections', dir, 'VERIFICATION.md')), `${dir}/VERIFICATION.md`);
    const cited = extractCitedKeysForVerification(readFileSync(join(paper, 'sections', dir, 'DRAFT.md'), 'utf8'));
    assert.ok(cited.length >= 1, `${dir} cites at least one source`);
    const assigned = plan['assigned_sources'] as string[];
    for (const key of cited) assert.ok(assigned.includes(key), `${dir} cites only its assigned sources (${key})`);
  }

  // compile measured citation density against the paper's own preset (GRND-06).
  assert.match(readFileSync(join(paper, 'COMPILE-REPORT.md'), 'utf8'), new RegExp(`^Discipline: ${manifest.discipline} · band `, 'm'));

  // The stale pointer's paper was never touched.
  assert.deepEqual(snapshot(join(other, '.paper')), otherBefore, 'the pointed paper is byte- and mtime-identical');

  // Costs: the SESSION.log model-call records add up to the COSTS ledger.
  const llm = jsonl(join(paper, 'SESSION.log')).filter((r) => r['kind'] === 'llm');
  const costs = jsonl(join(paper, 'COSTS.jsonl'));
  assert.equal(llm.length, costs.length, 'one ledger row per model call');
  const logged = llm.reduce((a, r) => a + (r['cost_usd'] as number), 0);
  const ledger = costs.reduce((a, r) => a + (r['costUsd'] as number), 0);
  assert.ok(logged > 0 && Math.abs(logged - ledger) < 1e-9, `SESSION.log ${logged} = COSTS ${ledger}`);

  // RUN-26: the planner and drafter system prompts are the unmodified templates,
  // cache-marked; the first call writes the cache and the later ones read it.
  for (const slug of ['section-planner', 'section-drafter'] as const) {
    const reqs = chainRequests.filter((r) => r.slug === slug);
    assert.equal(reqs.length, n);
    for (const r of reqs) {
      const system = r.body?.['system'] as Array<{ type: string; text: string; cache_control?: { type: string } }>;
      assert.ok(Array.isArray(system) && system.length === 1, `${slug}: one system block`);
      assert.equal(system[0]!.text, loadPrompt(slug), `${slug}: the system prompt is the template, unmodified`);
      assert.deepEqual(system[0]!.cache_control, { type: 'ephemeral' }, `${slug}: cache-marked`);
    }
    const usage = reqs.map((r) => r.response?.usage ?? {});
    assert.ok((usage[0]!['cache_creation_input_tokens'] as number) > 0, `${slug}: the first call writes the cache ${JSON.stringify(usage[0])}`);
    for (const u of usage.slice(1)) assert.ok((u['cache_read_input_tokens'] as number) > 0, `${slug}: a later call reads the cache ${JSON.stringify(u)}`);
    const recs = llm.filter((r) => r['slug'] === slug);
    assert.ok(recs.slice(1).every((r) => (r['cache_read_tokens'] as number) > 0), `${slug}: SESSION.log records the cache reads`);
  }

  // FEED-01/02: each planner and drafter request carries only its section's sources.
  const bySlug = new Map(outline.map((row) => [row.slug, row]));
  for (const r of chainRequests.filter((x) => x.slug === 'section-planner' || x.slug === 'section-drafter')) {
    const blocks = requestBlocks(r);
    const section = blocks['section'] as { slug: string; title: string; word_target: number };
    const row = bySlug.get(section.slug);
    assert.ok(row, `${r.slug}: a known section (${section.slug})`);
    assert.equal(section.title, row.title, `${r.slug} §${section.slug}: the outline title, not the slug`);
    assert.equal(section.word_target, row.estimated_word_count, `${r.slug} §${section.slug}: the outline word target`);
    const sent = (blocks['sources'] as Array<{ citekey: string }>).map((s) => s.citekey);
    assert.ok(sent.length > 0, `${r.slug} §${section.slug}: sources sent`);
    assert.deepEqual([...sent].sort(), [...row.assigned_sources].sort(), `${r.slug} §${section.slug}: exactly the section's allocation`);
    for (const key of library.filter((k) => !row.assigned_sources.includes(k))) {
      assert.ok(!wordHit(r.rawBody, key), `${r.slug} §${section.slug}: ${key} (another section's source) is not in the request`);
    }
  }

  // Replay 1 — scripts/extract-fixture.mjs: a mock that serves only the logged
  // responses reproduces every section DRAFT.md byte-for-byte, matching each
  // request by its body hash; the model mock is never called.
  const originals = new Map(dirs.map((d) => [d, readFileSync(join(paper, 'sections', d, 'DRAFT.md'), 'utf8')]));
  const fixture = JSON.parse(execFileSync(process.execPath, [join(REPO, 'scripts', 'extract-fixture.mjs'), join(paper, 'SESSION.log')], { encoding: 'utf8' })) as {
    slugs: Record<string, Array<{ request_sha256: string }>>;
  };
  const drafterHashes = new Set((fixture.slugs['section-drafter'] ?? []).map((e) => e.request_sha256));
  assert.equal(drafterHashes.size, n, 'the fixture holds every drafter call');
  const fixtureMock = await startMockLlm({ fixture: fixture as never });
  const runtimeFile = join(pensmithDataDir(process.platform, sb.env()), 'runtime.json');
  const runtime = readFileSync(runtimeFile, 'utf8');
  const modelCalls = sb.calls();
  try {
    writeFileSync(runtimeFile, JSON.stringify({ $schemaVersion: 2, provider: 'anthropic', endpoint: fixtureMock.url }, null, 2) + '\n');
    for (const [i, dir] of dirs.entries()) {
      writeFileSync(join(paper, 'sections', dir, 'DRAFT.md'), 'edited since\n');
      const w = await sb.run(['write', String(i + 1), '--no-verify', '--yolo']);
      assert.equal(w.status, 0, `fixture replay of write ${i + 1}: ${w.stderr}`);
      assert.equal(readFileSync(join(paper, 'sections', dir, 'DRAFT.md'), 'utf8'), originals.get(dir), `${dir}: reproduced byte-for-byte`);
    }
    const served = fixtureMock.requests.filter((r) => r.slug === 'section-drafter');
    assert.equal(served.length, n);
    for (const r of served) assert.ok(drafterHashes.has(r.bodySha256), 'each replayed request is a logged request (same body hash)');
  } finally {
    writeFileSync(runtimeFile, runtime);
    await fixtureMock.close();
  }
  assert.equal(sb.calls(), modelCalls, 'the fixture replay made no model call');

  // Replay 2 — `resume --replay <id>` (sources offline): the logged responses
  // reproduce each draft with zero model calls.
  const drafterRecs = llm.filter((r) => r['slug'] === 'section-drafter');
  for (const [i, dir] of dirs.entries()) {
    const rec = drafterRecs.find((r) => r['section'] === i + 1);
    assert.ok(rec, `§${i + 1}: the drafter call was logged`);
    writeFileSync(join(paper, 'sections', dir, 'DRAFT.md'), 'edited again\n');
    const replay = await sb.run(['resume', '--replay', String(rec['id'])], { env: { PENSMITH_OFFLINE: '1' } });
    assert.equal(replay.status, 0, `replay §${i + 1}: ${replay.stderr}`);
    assert.equal(readFileSync(join(paper, 'sections', dir, 'DRAFT.md'), 'utf8'), originals.get(dir), `${dir}: replayed byte-for-byte`);
  }
  assert.equal(sb.calls(), modelCalls, 'resume --replay made no model call');
});

test('GRND-18 / FEED-03: without --yolo and without a terminal the chain stops at the outline gate — exit 3, no outline request, nothing registered', async () => {
  const sb = await sandbox('e2e-gate');
  sb.applyCorpusScript();
  const first = await sb.loop(['--yolo'], { maxRuns: 2, until: () => false });
  assert.deepEqual(first.map(ranSteps), [['new'], ['research']]);
  const before = sb.calls('outline-author');
  const stopped = await sb.run([]);
  assert.equal(stopped.status, 3, stopped.stderr);
  assert.match(stopped.stderr, /^pensmith: ran outline \(exit 3\); next: outline$/m);
  assert.match(stopped.stderr, /Approve this outline and register its sections\? \(no outline was requested and no OUTLINE\.md was written\) needs an answer: re-run in a terminal, or pass --yolo/);
  assert.equal(sb.calls('outline-author'), before, 'no outline request');
  assert.ok(!existsSync(join(sb.root, '.paper', 'OUTLINE.md')), 'no OUTLINE.md');
  assert.ok(!existsSync(join(sb.root, '.paper', 'sections')), 'no section registered');
  const state = JSON.parse(readFileSync(join(sb.root, '.paper', 'STATE.json'), 'utf8')) as { sections?: unknown[] };
  assert.equal((state.sections ?? []).length, 0);
  // --yolo approves it: the chain continues from the same place.
  const approved = await sb.run(['--yolo']);
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stderr, /^pensmith: ran outline; next: plan §1$/m);
});
