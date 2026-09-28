// tests/gates-registry.test.ts — RUN-28 (S-16, D-17-36): ONE approval-gate
// registry (bin/lib/gates.ts) decides what --yolo may skip, what a run without
// a terminal does, and each gate's exit code.
//
//   1. The registry table itself (ids, the never-skipped set).
//   2. Every gate driven through runGate/declineGate without a terminal, with
//      and without --yolo — the documented code or skip.
//   3. Every WIRED gate driven through its real verb without a terminal, with
//      and without --yolo — the code, and that a refusal changed no file.
//   4. PRD §7.20 carries the table; a drift test compares it with GATES.
//   5. The gate-registry chokepoint row: only gates.ts and sketch.ts import ask().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GATES,
  gateDef,
  runGate,
  declineGate,
  canPrompt,
  GateRefusedError,
  type GateId,
} from '../bin/lib/gates.js';
import { EXIT_OK, EXIT_ERROR, EXIT_USAGE, EXIT_APPROVAL, EXIT_COST_CAP } from '../bin/lib/exit-codes.js';
import { CURRENT_PLAN_FRONTMATTER_VERSION } from '../bin/lib/schemas/plan-frontmatter.js';
import {
  REPO,
  ASSIGNMENT_FIXTURE,
  STACK_LINE,
  sandbox,
  runCli,
  runLibScript,
  lastJson,
  seedCompiledPaper,
  seedFabricatedSection,
  writePlan,
  writeState,
  writeOutline,
  sectionDirOf,
  snapshot,
  changedPaths,
} from './helpers/paper-cli-harness.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';

const IGNORE_LOGS = /^\.paper[\\/](SESSION\.log|sessions)/;
const NEVER: ReadonlySet<GateId> = new Set(['cost-cap', 'estimate-proceed', 'detector-consent', 'paper-pointer']);

// ---------------------------------------------------------------------------
// 1. The registry
// ---------------------------------------------------------------------------

test('RUN-28: GATES is one table of unique gates; --yolo never skips cost-cap, estimate-proceed, detector-consent or paper-pointer', () => {
  const ids = GATES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.deepEqual(new Set(GATES.filter((g) => g.yolo === 'never').map((g) => g.id)), NEVER);
  for (const g of GATES) {
    assert.equal(gateDef(g.id), g);
    if (g.yolo === 'skip') assert.ok(g.yoloChoice.length > 0, `${g.id}: a skipping gate names its choice`);
    else assert.equal(g.yoloChoice, '', `${g.id}: a never-skipped gate has no choice`);
    if (g.nonInteractive === 'skip') assert.equal(g.nonTtyExit, EXIT_OK, `${g.id}: a skip exits 0`);
  }
  assert.throws(() => gateDef('nope' as GateId), /unknown gate/);
});

// ---------------------------------------------------------------------------
// 2. Every gate without a terminal, with and without --yolo
// ---------------------------------------------------------------------------

test('RUN-28: every gate without a terminal — refuse with its code or skip; --yolo skips only the skippable ones', async () => {
  const prevMode = process.env['PENSMITH_PROMPT_MODE'];
  delete process.env['PENSMITH_PROMPT_MODE'];
  try {
    assert.equal(canPrompt(), Boolean(process.stdin.isTTY), 'the test runner has no terminal');
    if (canPrompt()) return; // an interactive runner cannot exercise the no-terminal path
    for (const g of GATES) {
      for (const yolo of [false, true]) {
        const label = `${g.id} (yolo=${String(yolo)})`;
        if (yolo && g.yolo === 'skip') {
          assert.deepEqual(await runGate(g.id, { yolo }), { kind: 'yolo', choice: g.yoloChoice }, label);
          continue;
        }
        if (g.nonInteractive === 'skip') {
          assert.deepEqual(await runGate(g.id, { yolo }), { kind: 'skipped' }, label);
          continue;
        }
        await assert.rejects(runGate(g.id, { yolo, detail: 'test detail' }), (e: unknown) => {
          assert.ok(e instanceof GateRefusedError, label);
          assert.equal(e.exitCode, g.nonTtyExit, label);
          assert.equal(e.gateId, g.id);
          assert.match(e.message, new RegExp(`\\(test detail\\) needs an answer: re-run in a terminal`));
          assert.match(e.message, g.yolo === 'skip' ? /pass --yolo to / : /--yolo does not skip this gate/);
          return true;
        });
      }
      // An explicit decline carries the gate's decline code.
      assert.throws(() => declineGate(g.id, 'declined'), (e: unknown) => e instanceof GateRefusedError && e.exitCode === g.declineExit);
    }
  } finally {
    if (prevMode !== undefined) process.env['PENSMITH_PROMPT_MODE'] = prevMode;
  }
  assert.equal(gateDef('cost-cap').nonTtyExit, EXIT_COST_CAP);
  assert.equal(gateDef('paper-pointer').nonTtyExit, EXIT_USAGE);
  assert.equal(gateDef('outline-approval').nonTtyExit, EXIT_APPROVAL);
});

// ---------------------------------------------------------------------------
// 3. The wired gates, through their real verbs
// ---------------------------------------------------------------------------

test('RUN-28 outline-approval: no terminal → 3 and nothing written; --yolo approves', () => {
  const sb = sandbox('gate-outline');
  const root = sb.project('p');
  writeState(root, []);
  writeFileSync(join(root, '.paper', 'INTAKE.md'), '# Intake\n\nTopic: tidal power\n');
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  const before = snapshot(root);
  const r = runCli(sb, root, ['outline']);
  assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: Approve this outline and register its sections\? \(no outline was requested and no OUTLINE\.md was written\) needs an answer: re-run in a terminal, or pass --yolo to approve the outline\.$/m);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), []);
  const y = runCli(sb, root, ['outline', '--yolo']);
  assert.ok(existsSync(join(root, '.paper', 'OUTLINE.md')), `--yolo approves: ${y.stderr}`);
  // An explicit "no" (scripted answer) declines with 3 and writes nothing.
  const sb2 = sandbox('gate-outline-no');
  const root2 = sb2.project('p');
  writeState(root2, []);
  writeFileSync(join(root2, '.paper', 'INTAKE.md'), '# Intake\n\nTopic: tidal power\n');
  const no = runCli(sb2, root2, ['outline'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: 'n\n' });
  assert.equal(no.status, EXIT_APPROVAL);
  assert.match(no.stderr, /^pensmith: outline rejected — no OUTLINE\.md written$/m);
  assert.ok(!existsSync(join(root2, '.paper', 'OUTLINE.md')));
});

test('RUN-28 export-confirm: no terminal → 3 and nothing exported; --yolo exports', () => {
  const sb = sandbox('gate-export');
  const root = sb.project('p');
  seedCompiledPaper(root);
  const before = snapshot(root);
  const r = runCli(sb, root, ['done', '--format', 'md']);
  assert.equal(r.status, EXIT_APPROVAL, r.stderr);
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), []);
  const y = runCli(sb, root, ['done', '--yolo', '--format', 'md']);
  assert.equal(y.status, EXIT_OK, `${y.stdout}\n${y.stderr}`);
  assert.ok(existsSync(join(root, '.paper', 'export', 'DRAFT.md')));
});

test('RUN-28 add-remap: no terminal → the source is added, the remap skipped with the command to run later; --yolo skips it too', () => {
  const sb = sandbox('gate-remap');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writeOutline(root, [{ n: 1, slug: 'intro' }]);
  const plan = writePlan(root, 1, 'intro');
  const planBefore = readFileSync(plan, 'utf8');
  const r = runCli(sb, root, ['add', '10.1038/nphys1170']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  const key = /added ([a-z][a-z0-9_-]*)/.exec(r.stdout)?.[1];
  assert.ok(key, r.stdout);
  assert.match(r.stdout, new RegExp(`remap skipped \\(non-interactive\\); run pensmith add --remap ${key} --section N`));
  assert.match(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'), new RegExp(`@\\w+\\{${key},`), 'the bib holds the source');
  assert.equal(readFileSync(plan, 'utf8'), planBefore, 'no section was remapped');

  const later = runCli(sb, root, ['add', '--remap', key, '--section', '1']);
  assert.equal(later.status, EXIT_OK, `${later.stdout}\n${later.stderr}`);
  assert.match(readFileSync(plan, 'utf8'), new RegExp(`- ${key}`), 'the printed command remaps the section');
  assert.match(readFileSync(plan, 'utf8'), new RegExp(`^schema_version: ${CURRENT_PLAN_FRONTMATTER_VERSION}$`, 'm'), 'the remap write stamps the frontmatter version');

  const sb2 = sandbox('gate-remap-yolo');
  const root2 = sb2.project('p');
  writeState(root2, [{ n: 1, slug: 'intro' }]);
  const y = runCli(sb2, root2, ['add', '10.1038/nphys1170', '--yolo']);
  assert.equal(y.status, EXIT_OK, y.stderr);
  assert.match(y.stdout, /added [a-z0-9_-]+\.$/m);
});

test('RUN-28 research-prune: no terminal → 3 before any search, and nothing written; --yolo keeps every candidate', () => {
  const sb = sandbox('gate-prune');
  const root = sb.project('p');
  assert.equal(runCli(sb, root, ['new', '--yolo', '--from', ASSIGNMENT_FIXTURE]).status, EXIT_OK);
  // SRC-08: research seeds its queries from the brief's topic; this one is the
  // query the source cassettes record, so the stubbed run finds real hits.
  writeFileSync(join(root, '.paper', 'INTAKE.md'), `---\ntopic: ${SEARCHABLE}\ndiscipline: computer-science\n---\n# Intake\n\n## Assignment\n\nWrite a 1500-word review of ${SEARCHABLE}.\n`);
  const before = snapshot(root);
  const r = runCli(sb, root, ['research']);
  assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: Select the candidate sources to keep \(nothing was searched, sent or written\) needs an answer: re-run in a terminal, or pass --yolo to keep every candidate\.$/m);
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'nothing written (no RESEARCH.md, no LIBRARY.json)');
  const y = runCli(sb, root, ['research', '--yolo']);
  assert.equal(y.status, EXIT_OK, `${y.stdout}\n${y.stderr}`);
  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: unknown[] };
  const kept = /^pensmith research: (\d+) kept/m.exec(y.stdout);
  assert.ok(kept, y.stdout);
  assert.ok(lib.entries.length >= 1 && lib.entries.length === Number(kept[1]), `--yolo kept every candidate the evaluator kept: ${y.stdout}`);
});

// The research and outline gates through the REAL verbs against the mock LLM:
// a refusal without a terminal is decided before any model call (0 requests,
// no COSTS.jsonl entry, no RESEARCH.md); with scripted answers both research
// questions are really asked (the scope choice decides the searched queries,
// the prune choice decides what the library keeps).
const MOCK_KEY = 'sk-test-gates-0001';
const SEARCHABLE = 'attention mechanisms in neural networks'; // recorded in the source cassettes

function seedIntake(paper: string): void {
  writeFileSync(join(paper, 'INTAKE.md'), '---\ntopic: attention mechanisms\ndiscipline: computer-science\n---\n# Intake\n\nWrite a 1500-word review of attention mechanisms in neural networks.\n');
}

test('RUN-28: outline and research refuse without a terminal BEFORE any model call — 0 requests, nothing billed, nothing written', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: MOCK_KEY, PENSMITH_NO_LLM: undefined, PENSMITH_PROMPT_MODE: undefined } }, async (sb) => {
    seedIntake(sb.paper);
    const before = snapshot(sb.root);
    for (const verb of ['outline', 'research']) {
      const r = await sb.runTsx(null, [verb]);
      assert.equal(r.status, EXIT_APPROVAL, `${verb}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /needs an answer: re-run in a terminal, or pass --yolo/, verb);
    }
    assert.equal(sb.mock!.callCount(), 0, 'no model request');
    assert.deepEqual(changedPaths(before, snapshot(sb.root), IGNORE_LOGS), [], 'no COSTS.jsonl, RESEARCH.md, LIBRARY.json or OUTLINE.md');
  });
});

test('RUN-28 research-scope + research-prune: scripted answers drive both questions through the real verb', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: MOCK_KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    seedIntake(sb.paper);
    const scopes = { scopes: [{ label: 'unrelated-scope', queries: ['zz no recorded results zz'] }, { label: 'attention-scope', queries: [SEARCHABLE] }] };
    sb.mock!.script('topic-disambiguator', { data: scopes });
    // Scope question → option 2; prune question → keep only candidate 1.
    const r = await sb.runTsx(null, ['research'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: '2\n1\n' });
    assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /Which research scope should I use\?/, 'the scope question was asked');
    assert.match(r.stderr, /Select candidates to keep \(\d+ found\)/, 'the prune question was asked');
    const log = readFileSync(join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(log, /attention-scope/, 'the chosen scope was searched');
    assert.ok(log.includes(SEARCHABLE));
    assert.ok(!log.includes('zz no recorded results zz'), 'the other scope was not');
    const lib = JSON.parse(readFileSync(join(sb.paper, 'LIBRARY.json'), 'utf8')) as { entries: unknown[] };
    assert.equal(lib.entries.length, 1, 'the prune answer kept one source');

    // --yolo takes the registry choice for both: the first scope (announced),
    // every kept candidate. That scope's queries have no recorded results, so
    // the run finds no source: SRC-07 exits 1 naming why, logs the run in
    // RESEARCH.md and leaves LIBRARY.json as it was.
    sb.mock!.script('topic-disambiguator', { data: scopes });
    const libBefore = readFileSync(join(sb.paper, 'LIBRARY.json'), 'utf8');
    const y = await sb.runTsx(null, ['research', '--yolo']);
    assert.equal(y.status, EXIT_ERROR, y.stderr);
    assert.doesNotMatch(y.stderr, /Which research scope should I use\?/);
    assert.match(y.stdout, /--yolo: using scope 1 of 2 — "unrelated-scope"/);
    assert.match(y.stderr, /^pensmith research: no sources found — /m);
    assert.match(readFileSync(join(sb.paper, 'RESEARCH.md'), 'utf8'), /unrelated-scope/, '--yolo searched the first proposed scope');
    assert.equal(readFileSync(join(sb.paper, 'LIBRARY.json'), 'utf8'), libBefore, 'LIBRARY.json unchanged');
  });
});

test('RUN-28: research aborted at the prune question writes no RESEARCH.md and no library', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: MOCK_KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    seedIntake(sb.paper);
    sb.mock!.script('topic-disambiguator', { data: { scopes: [{ label: 'attention-scope', queries: [SEARCHABLE] }] } });
    // One scope (no scope question); stdin closes before the prune answer.
    const r = await sb.runTsx(null, ['research'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: '' });
    assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
    assert.ok(!existsSync(join(sb.paper, 'RESEARCH.md')), 'no research log for a research that did not finish');
    assert.ok(!existsSync(join(sb.paper, 'LIBRARY.json')));
  });
});

test('RUN-28 revise-swap: no terminal → 3 and DRAFT.md unchanged; --yolo applies the swap', () => {
  const sb = sandbox('gate-revise');
  const seed = (name: string): string => {
    const root = sb.project(name);
    seedFabricatedSection(root);
    writePlan(root, 1, 'intro', { status: 'failed', assigned_sources: '[real2020]' });
    writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), '# VERIFICATION (Section 1, intro)\n\nStatus: failed\n\n- ghost2099: **FABRICATED** — no such entry\n');
    return root;
  };
  const root = seed('refuse');
  const before = snapshot(root);
  const r = lastJson<{ ok: boolean; exitCode: number; gateId: string; message: string }>(runLibScript(sb, 'revise-gate.ts', [root, 'false']));
  assert.equal(r.ok, false);
  assert.equal(r.gateId, 'revise-swap');
  assert.equal(r.exitCode, EXIT_APPROVAL);
  assert.match(r.message, /Apply this citation swap to the section\? \(swap of \[@ghost2099\]\) needs an answer/);
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'DRAFT.md and PLAN.md unchanged');

  const root2 = seed('yolo');
  const y = lastJson<{ ok: boolean; accepted: boolean }>(runLibScript(sb, 'revise-gate.ts', [root2, 'true']));
  assert.deepEqual({ ok: y.ok, accepted: y.accepted }, { ok: true, accepted: true });
  assert.match(readFileSync(join(sectionDirOf(root2, 1, 'intro'), 'DRAFT.md'), 'utf8'), /\[@real2020\]/);
});

test('RUN-28 paper-pointer: no terminal and --yolo both refuse with 2 (see tests/paper-root-resolver.test.ts for the full drive)', () => {
  const sb = sandbox('gate-pointer');
  const p2 = sb.project('p2');
  assert.equal(runCli(sb, p2, ['new', '--yolo', '--from', ASSIGNMENT_FIXTURE]).status, EXIT_OK);
  assert.equal(runCli(sb, p2, ['open', 'p2']).status, EXIT_OK);
  const empty = sb.project('empty');
  for (const args of [['write', '1'], ['write', '1', '--yolo']]) {
    const r = runCli(sb, empty, args);
    assert.equal(r.status, EXIT_USAGE, `${args.join(' ')}: ${r.stderr}`);
  }
  assert.ok(!existsSync(join(empty, '.paper')));
});

// ---------------------------------------------------------------------------
// 4. PRD §7.20 ↔ GATES drift
// ---------------------------------------------------------------------------

interface PrdGateRow {
  id: string;
  asks: string;
  yolo: string;
  nonTty: string;
  decline: string;
  owner: string;
}

function prdGateRows(): PrdGateRow[] {
  const prd = readFileSync(join(REPO, 'PRD.md'), 'utf8');
  const start = prd.indexOf('### 7.20');
  const end = prd.indexOf('### 7.21');
  assert.ok(start >= 0 && end > start, 'PRD §7.20 exists');
  const rows: PrdGateRow[] = [];
  for (const line of prd.slice(start, end).split(/\r?\n/)) {
    const m = /^\| `([a-z-]+)` \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$/.exec(line);
    if (m) rows.push({ id: m[1]!, asks: m[2]!, yolo: m[3]!, nonTty: m[4]!, decline: m[5]!, owner: m[6]! });
  }
  return rows;
}

test('RUN-28: PRD §7.20 carries the gate table and it matches GATES (drift test)', () => {
  const rows = prdGateRows();
  assert.ok(rows.length >= GATES.length, 'every gate has a row');
  for (const g of GATES) {
    const row = rows.find((r) => r.id === g.id);
    assert.ok(row, `PRD §7.20 has a row for ${g.id}`);
    assert.equal(row.asks, g.label, `${g.id}: Asks`);
    assert.equal(row.yolo, g.yolo === 'skip' ? `skip: ${g.yoloChoice}` : 'never', `${g.id}: --yolo`);
    assert.equal(row.nonTty, `${g.nonInteractive}: ${g.nonTtyExit}`, `${g.id}: without a terminal`);
    assert.equal(row.decline, String(g.declineExit), `${g.id}: explicit no`);
    assert.equal(row.owner, g.requirement, `${g.id}: owner`);
  }
  const ids = new Set(GATES.map((g) => g.id as string));
  for (const row of rows.filter((r) => !ids.has(r.id))) {
    assert.match(row.owner, /^[A-Z]+-\d+ \(planned\)$/, `${row.id} is not in GATES, so it must be marked (planned) with its landing requirement`);
  }
  // GRND-01, GRND-02 and GRND-09 landed their gates in Phase 18 (seam S-A);
  // GRND-17 landed plan-research in Phase 19 (seam S-B).
  for (const req of ['VRFY-22', 'VRFY-20']) {
    assert.ok(rows.some((r) => r.owner === `${req} (planned)`), `future gate from ${req} is listed`);
  }
});

// ---------------------------------------------------------------------------
// 5. The gate-registry chokepoint row
// ---------------------------------------------------------------------------

interface ChokepointRow {
  id: string;
  requirement: string;
  allow: string[];
  match: { kind: string; pattern: string };
  fixture: string;
}

test('RUN-28: the gate-registry chokepoint row flags its fixture and none of the converted verbs', () => {
  const row = JSON.parse(readFileSync(join(REPO, 'scripts', 'chokepoints', 'gate-registry.json'), 'utf8')) as ChokepointRow;
  assert.equal(row.id, 'gate-registry');
  assert.equal(row.requirement, 'RUN-28');
  assert.equal(row.match.kind, 'file-regex');
  const re = new RegExp(row.match.pattern);
  assert.match(readFileSync(join(REPO, row.fixture), 'utf8'), re, 'the violation fixture is flagged');
  for (const allowed of ['bin/lib/gates.ts', 'bin/cli/sketch.ts']) {
    assert.ok(row.allow.includes(allowed), `${allowed} is allowed`);
    assert.match(readFileSync(join(REPO, allowed), 'utf8'), re, `${allowed} really imports ask()`);
  }
  for (const converted of ['bin/cli/outline.ts', 'bin/cli/research.ts', 'bin/cli/add.ts', 'bin/cli/done.ts', 'bin/lib/revise.ts', 'bin/pensmith.ts']) {
    assert.doesNotMatch(readFileSync(join(REPO, converted), 'utf8'), re, `${converted} goes through the registry`);
  }
  for (const file of ['bin/cli/outline.ts', 'bin/cli/research.ts', 'bin/lib/revise.ts']) {
    assert.doesNotMatch(readFileSync(join(REPO, file), 'utf8'), /ApprovalUnavailableError/, `${file}: no private approval error`);
  }
});
