// tests/dry-run-chain.test.ts — GRND-19 end to end (18-PLAN.md §7 step 3,
// D-18-29/30). Integration test: it needs all four Phase 18 streams.
//
// The BUILT CLI runs `--dry-run` with the socket-level dial recorder preloaded
// (tests/helpers/local-servers/dial-recorder.mjs: every dns.lookup and
// net/tls connect is recorded and refused), next to the RUN-21 mock LLM, which
// a dry run must never call (every model call is a contract stub).
//   - Fresh folder with assignment.txt: without --yolo and without a terminal
//     the dry run stops at the first gate (intake-defaults, exit 3) with
//     nothing registered; `pensmith --dry-run --yolo` then goes from the
//     assignment to `.paper-dry-run/FINAL.md` and `.paper-dry-run/export/
//     DRAFT.dry-run.*` in ONE invocation, every section verified with >= 1
//     synthetic citation, no `.paper/`, 0 dials, 0 model calls.
//   - An existing paper: a dry run without --yolo stops at the outline gate
//     (exit 3, nothing registered) once research is done; after the outline, a
//     full `--dry-run --yolo` works in the seeded workspace and reports the real
//     citations it cannot check as UNVERIFIABLE (exit 4, never a faked
//     verdict); every `.paper/` file keeps its sha256 and mtime, and the next
//     live bare run routes exactly as before.
// The same dry run from an `npm pack`-installed copy (no tests/) is
// tests/installed-offline.test.ts.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openChainSandbox, REPO, type ChainRun, type ChainSandbox } from './helpers/e2e-chain.js';
import { readDialLog } from './helpers/local-servers/dial-recorder.mjs';
import { extractCitedKeysForVerification } from '../bin/lib/citation-token.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';

const sandboxes: ChainSandbox[] = [];
after(async () => {
  for (const sb of sandboxes) await sb.close();
});

async function sandbox(prefix: string): Promise<ChainSandbox> {
  const sb = await openChainSandbox({ prefix, assignment: true });
  sandboxes.push(sb);
  return sb;
}

const DIAL_RECORDER = pathToFileURL(join(REPO, 'tests', 'helpers', 'local-servers', 'dial-recorder.mjs')).href;
let dialRuns = 0;

/** Run the built CLI with the dial recorder preloaded; returns the run and every dial / DNS event it made. */
async function recorded(sb: ChainSandbox, args: string[]): Promise<{ run: ChainRun; events: ReturnType<typeof readDialLog> }> {
  dialRuns += 1;
  const log = join(sb.base, `dial-${dialRuns}.log`);
  const inherited = process.env['NODE_OPTIONS'];
  const run = await sb.run(args, {
    timeoutMs: 300_000,
    env: {
      NODE_OPTIONS: `${inherited ? `${inherited} ` : ''}--import=${DIAL_RECORDER}`,
      PENSMITH_DIAL_LOG: log,
    },
  });
  assert.ok(existsSync(log), 'the dial recorder was loaded (it creates its log when it loads)');
  return { run, events: readDialLog(log).filter((e) => e.kind === 'connect' || e.kind === 'dns') };
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

function stateSections(paperDir: string): unknown[] {
  const file = join(paperDir, 'STATE.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { sections?: unknown[] }).sections ?? [];
}

function outOf(r: ChainRun): string {
  return `exit ${r.status}\n${r.stdout}\n${r.stderr}`;
}

test('GRND-19: a fresh folder — non-TTY `--dry-run` stops at intake-defaults (exit 3); `--dry-run --yolo` reaches a .dry-run export in one invocation with 0 dials and 0 model calls', async () => {
  const sb = await sandbox('dry-chain-fresh');
  const ws = join(sb.root, '.paper-dry-run');

  const refused = await recorded(sb, ['--dry-run']);
  assert.equal(refused.run.status, 3, outOf(refused.run));
  assert.match(refused.run.stderr, /^pensmith: ran new \(exit 3\); next: new$/m);
  assert.match(refused.run.stderr, /Accept the intake defaults\? \(unanswered: .+\) needs an answer: re-run in a terminal, or pass --yolo/);
  assert.ok(!existsSync(join(sb.root, '.paper')), 'no .paper/');
  assert.ok(!existsSync(join(ws, 'INTAKE.md')) && !existsSync(join(ws, 'STATE.json')), 'nothing registered in the workspace');
  assert.deepEqual(refused.events, [], 'the refused dry run dialled nothing');

  const { run, events } = await recorded(sb, ['--dry-run', '--yolo']);
  assert.equal(run.status, 0, outOf(run));
  assert.match(run.stderr, /OFFLINE MODE \(reason: --dry-run\).*\.paper-dry-run/);
  for (const step of ['ran new;', 'ran research;', 'ran outline;', 'ran compile;', 'ran done; next: status (done)']) {
    assert.ok(run.stderr.includes(`pensmith: ${step}`), `the one invocation ran ${step}\n${run.stderr}`);
  }
  assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /no parseable section table/);
  assert.deepEqual(events, [], 'zero DNS lookups and zero connections');
  assert.equal(sb.calls(), 0, 'a dry run never calls the model');

  assert.ok(!existsSync(join(sb.root, '.paper')), 'a dry run never creates .paper/');
  assert.ok(existsSync(join(ws, 'FINAL.md')), '.paper-dry-run/FINAL.md');
  const exported = readdirSync(join(ws, 'export')).filter((f) => f.startsWith('DRAFT.'));
  assert.ok(exported.length > 0 && exported.every((f) => f.startsWith('DRAFT.dry-run.')), `DRAFT.dry-run.* export: ${exported.join(', ')}`);
  assert.match(run.stdout, /pensmith done: exported .*DRAFT\.dry-run\./);

  const library = (JSON.parse(readFileSync(join(ws, 'LIBRARY.json'), 'utf8')) as { entries: Array<{ citekey: string; doi: string | null; synthetic?: boolean }> }).entries;
  const synthetic = new Set(library.filter((e) => e.synthetic === true && (e.doi ?? '').startsWith('10.0000/pensmith-dryrun.')).map((e) => e.citekey));
  assert.equal(synthetic.size, library.length, 'every dry-run source is a labelled synthetic record');
  const sections = readdirSync(join(ws, 'sections')).filter((d) => d !== '_archive');
  assert.ok(sections.length >= 3, `the outline registered its sections: ${sections.join(', ')}`);
  assert.equal(stateSections(ws).length, sections.length);
  for (const dir of sections) {
    const plan = loadFrontmatterDocSync('plan', join(ws, 'sections', dir, 'PLAN.md')).frontmatter as Record<string, unknown>;
    assert.equal(plan['status'], 'verified', `${dir} verified`);
    const cited = extractCitedKeysForVerification(readFileSync(join(ws, 'sections', dir, 'DRAFT.md'), 'utf8'));
    assert.ok(cited.length >= 1, `${dir} cites at least one synthetic source`);
    for (const key of cited) assert.ok(synthetic.has(key), `${dir} cites ${key}, a synthetic source`);
  }
});

test('GRND-19: an existing paper — the dry run stops at the outline gate without --yolo, runs in the seeded workspace with --yolo, never changes .paper/, and the next live run routes as before', async () => {
  const sb = await sandbox('dry-chain-paper');
  const paper = join(sb.root, '.paper');
  const ws = join(sb.root, '.paper-dry-run');
  sb.applyCorpusScript();
  const live = await sb.loop(['--yolo'], { maxRuns: 2, until: () => false });
  assert.deepEqual(live.map((r) => r.status), [0, 0], live.map(outOf).join('\n'));
  assert.match(live[1]!.stderr, /^pensmith: ran research; next: outline$/m);

  // Research done: a non-TTY dry run without --yolo stops at the outline gate.
  let before = snapshot(paper);
  const gate = await recorded(sb, ['--dry-run']);
  assert.equal(gate.run.status, 3, outOf(gate.run));
  assert.match(gate.run.stderr, /^pensmith: ran outline \(exit 3\); next: outline$/m);
  assert.match(gate.run.stderr, /Approve this outline and register its sections\?/);
  assert.equal(stateSections(ws).length, 0, 'no section registered in the workspace');
  assert.ok(!existsSync(join(ws, 'OUTLINE.md')), 'no outline written in the workspace');
  assert.deepEqual(snapshot(paper), before, '.paper/ is byte- and mtime-identical');
  assert.deepEqual(gate.events, []);

  // The real paper's outline, then a full dry run over it.
  const outlined = await sb.run(['--yolo']);
  assert.match(outlined.stderr, /^pensmith: ran outline; next: plan §1$/m, outOf(outlined));
  const calls = sb.calls();
  before = snapshot(paper);
  const dry = await recorded(sb, ['--dry-run', '--yolo']);
  // The workspace was re-seeded from the outlined paper; its real citations
  // cannot be checked in a dry run, so §1's verification blocks honestly.
  assert.match(dry.run.stderr, /seeded the dry-run workspace .+\.paper-dry-run from .+\.paper \(\d+ files\); the dry run never writes \.paper\//);
  assert.equal(dry.run.status, 4, outOf(dry.run));
  // Review round 3 (D-18-43): the dry run's verdict judged this draft, so it
  // is never re-billed; S-13 (Phase 20): an unverifiable section does not stop
  // the others — the next step is §2, and compile refuses §1 with its options.
  assert.match(dry.run.stderr, /^pensmith: ran plan §1, write §1 \(exit 4\); next: plan §2$/m);
  const wsSection = readdirSync(join(ws, 'sections')).find((d) => d.startsWith('01-'));
  assert.ok(wsSection, 'the workspace holds §1');
  assert.match(readFileSync(join(ws, 'sections', wsSection, 'VERIFICATION.md'), 'utf8'), /UNVERIFIABLE/, 'a real citation is UNVERIFIABLE in a dry run — never a faked verdict');
  assert.deepEqual(dry.events, [], 'zero DNS lookups and zero connections');
  assert.equal(sb.calls(), calls, 'no model call');
  assert.deepEqual(snapshot(paper), before, 'every .paper/ file keeps its sha256 and mtime');
  for (const dir of readdirSync(join(paper, 'sections'))) {
    assert.ok(!existsSync(join(paper, 'sections', dir, 'DRAFT.md')), `.paper/sections/${dir} gained no draft`);
  }

  // The next live bare run routes exactly as it would have: §1's plan → write → verify.
  const next = await sb.run(['--yolo']);
  assert.equal(next.status, 0, outOf(next));
  assert.match(next.stderr, /^pensmith: ran plan §1, write §1; next: plan §2$/m);
  const plan1 = readdirSync(join(paper, 'sections')).find((d) => d.startsWith('01-'))!;
  const fm = loadFrontmatterDocSync('plan', join(paper, 'sections', plan1, 'PLAN.md')).frontmatter as Record<string, unknown>;
  assert.equal(fm['status'], 'verified', 'the live run verified the real §1');
});

test('GRND-19: README describes PENSMITH_NO_LLM as contract stubs for every model call, and the dry-run workspace', () => {
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /PENSMITH_NO_LLM[^\n]*only (skips|affects) (the )?advisory/i);
  assert.match(readme, /`PENSMITH_NO_LLM=1` \|[^\n]*every model call[^\n]*stub/);
  assert.match(readme, /\.paper-dry-run/);
});
