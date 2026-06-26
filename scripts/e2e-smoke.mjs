#!/usr/bin/env node
// scripts/e2e-smoke.mjs
//
// End-to-end smoke harness for the Tier-2 (portable Node CLI) pipeline.
//
// WHY THIS EXISTS
//   The unit/contract suite (`npm test`, 971 tests) exercises each verb in
//   ISOLATION — every plan/write/verify/compile/done case pre-seeds its own
//   fixture. Nothing drives the *bare* `pensmith` router across the real
//   new -> research -> outline -> ... chain to confirm that running one verb
//   actually lets the single-command UX (`/pensmith`, the README headline)
//   advance to the next. This harness fills exactly that gap.
//
// WHAT IT DOES
//   1. Builds an ISOLATED workspace AND an isolated data dir (LOCALAPPDATA /
//      XDG_DATA_HOME) so the run never touches the user's real paper registry.
//   2. Runs the pipeline fully OFFLINE (PENSMITH_NO_LLM=1 + cassettes; zero
//      network, zero API key, zero cost).
//   3. Asserts a battery of named checks and prints a PASS/FAIL/FINDING table.
//
// USAGE
//   node scripts/e2e-smoke.mjs            # run all checks
//   node scripts/e2e-smoke.mjs --keep     # keep the temp workspace for inspection
//
// EXIT CODE
//   0 if no hard regression (a verb that should succeed crashed, or an artifact
//   is missing). Known design FINDINGS are reported but do not fail the run —
//   they are tagged [FINDING] so CI can be made strict later.

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PEN = path.join(REPO, 'bin', 'pensmith.ts');
const TSX_LOADER = path.join(REPO, 'node_modules', 'tsx', 'dist', 'loader.mjs');

const KEEP = process.argv.includes('--keep');

if (!existsSync(TSX_LOADER)) {
  console.error(`FATAL: tsx loader not found at ${TSX_LOADER}. Run \`npm install\` first.`);
  process.exit(2);
}

// ── Isolated workspace + isolated data dir (no real-registry pollution) ──
const WORK = mkdtempSync(path.join(tmpdir(), 'pensmith-e2e-'));
const DATA = path.join(WORK, '_data');           // becomes LOCALAPPDATA/XDG_DATA_HOME
mkdirSync(DATA, { recursive: true });

const ASSIGNMENT = path.join(WORK, 'assignment.txt');
writeFileSync(ASSIGNMENT, [
  'PSYC 210 — Research Paper Assignment',
  '',
  'Write a 1500-word argumentative paper answering the question:',
  '"Does social media use causally increase rates of anxiety and depression',
  'among adolescents, or is the relationship merely correlational?"',
  '',
  'Requirements:',
  '- Take a clear thesis position.',
  '- Use at least 5 peer-reviewed sources published since 2015.',
  '- Include an introduction, a literature review, an analysis section, and a conclusion.',
  '- APA 7th edition citations.',
  '',
].join('\n'));

// Child env: fully offline + isolated data dir.
const childEnv = {
  ...process.env,
  PENSMITH_NO_LLM: '1',           // LLM calls -> offline placeholder (zero egress)
  PENSMITH_NETWORK_TESTS: '',     // source adapters -> cassettes (offline)
  PENSMITH_DRY_RUN: '1',          // advisory marker
  LOCALAPPDATA: DATA,             // Windows data root -> isolated temp
  XDG_DATA_HOME: DATA,            // POSIX data root  -> isolated temp
  PENSMITH_CONTACT_EMAIL: 'e2e-smoke@example.invalid',
};

/** Run a pensmith verb offline in the isolated workspace. */
function pen(args, { cwd = WORK } = {}) {
  const res = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(TSX_LOADER).href, PEN, ...args],
    { cwd, env: childEnv, encoding: 'utf8' },
  );
  return {
    code: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    out: (res.stdout ?? '') + (res.stderr ?? ''),
  };
}

// ── Tiny check framework ──
const results = [];
function record(kind, name, detail) { results.push({ kind, name, detail }); }
const pass    = (n, d) => record('PASS', n, d);
const fail    = (n, d) => record('FAIL', n, d);            // hard regression -> nonzero exit
const finding = (n, d) => record('FINDING', n, d);         // design/robustness issue, reported
const info    = (n, d) => record('INFO', n, d);

const ppaper = (f) => path.join(WORK, '.paper', f);

console.log(`workspace : ${WORK}`);
console.log(`data dir  : ${DATA}`);
console.log(`repo      : ${REPO}`);
console.log('running offline pipeline (PENSMITH_NO_LLM=1)…\n');

// ── 0. doctor ──
{
  const r = pen(['doctor', '--json']);
  if (r.code === 0 && r.stdout.includes('"schemaVersion"')) pass('doctor', 'exits 0, emits JSON report');
  else fail('doctor', `exit=${r.code}`);
}

// ── 1. new -> INTAKE.md ──
{
  const r = pen(['new', '--from', ASSIGNMENT, '--dry-run', '--yolo']);
  if (r.code === 0 && existsSync(ppaper('INTAKE.md'))) pass('new', 'INTAKE.md written, exit 0');
  else fail('new', `exit=${r.code}; INTAKE.md exists=${existsSync(ppaper('INTAKE.md'))}\n${r.out}`);
}

// ── 2. research -> LIBRARY.json (+ .bib/.ris) ──
{
  const r = pen(['research', '--dry-run', '--yolo']);
  const lib = existsSync(ppaper('LIBRARY.json'));
  const bib = existsSync(ppaper('CITATIONS.bib'));
  if (r.code === 0 && lib && bib) pass('research', 'LIBRARY.json + CITATIONS.bib written, exit 0');
  else fail('research', `exit=${r.code}; LIBRARY.json=${lib} CITATIONS.bib=${bib}\n${r.out}`);
  // The research verb does NOT write RESEARCH.md — record the artifact reality.
  info('research-artifact', `RESEARCH.md present after research? ${existsSync(ppaper('RESEARCH.md'))} (expected: false — research writes LIBRARY.json)`);
}

// ── 3. outline -> OUTLINE.md ──
{
  const r = pen(['outline', '--dry-run', '--yolo']);
  if (r.code === 0 && existsSync(ppaper('OUTLINE.md'))) pass('outline', 'OUTLINE.md written, exit 0');
  else fail('outline', `exit=${r.code}; OUTLINE.md exists=${existsSync(ppaper('OUTLINE.md'))}\n${r.out}`);
}

// ── 4. BUG-1: bare router advancement past research ──
// After research wrote LIBRARY.json, does the single-command router advance?
{
  const before = pen(['status']);
  const stuckOnResearch = /next:\s*research/.test(before.stdout);
  // Now create the file the router actually gates on, and re-check.
  writeFileSync(ppaper('RESEARCH.md'), '# Research\n');
  const after = pen(['status']);
  const advanced = /next:\s*outline/.test(after.stdout);

  if (stuckOnResearch && advanced) {
    finding(
      'router-research-sentinel',
      'bare `pensmith` routes to `research` even after research wrote LIBRARY.json; ' +
      'it only advances once RESEARCH.md exists. Root cause: bin/lib/router.ts:169 ' +
      '(and bin/lib/global-library.ts:358) gate "research done" on RESEARCH.md, but the ' +
      'research verb writes LIBRARY.json (workflows/research.md §Outputs). The single-command ' +
      'UX cannot advance past research on its own.',
    );
  } else if (!stuckOnResearch) {
    pass('router-research-sentinel', 'router advanced past research without RESEARCH.md (gap appears fixed)');
  } else {
    info('router-research-sentinel', `inconclusive: stuckOnResearch=${stuckOnResearch} advanced=${advanced}`);
  }
}

// ── 5. BUG-2: graceful failure when OUTLINE.md has no section table ──
// The offline outline is a placeholder (no table). write/compile must degrade
// to a friendly diagnostic, not dump a raw Node stack trace.
function looksLikeRawStack(s) {
  return /\n\s+at\s+\w/.test(s) || /ERR_[A-Z_]+/.test(s) || /\.ts:\d+:\d+\)/.test(s);
}
for (const verb of ['write', 'compile']) {
  const r = pen([verb, '--dry-run', '--yolo']);
  if (r.code === 0) {
    info(`${verb}-no-sections`, `exit 0 (handled)`);
  } else if (looksLikeRawStack(r.out)) {
    finding(
      `${verb}-no-sections`,
      `\`pensmith ${verb}\` on a section-less OUTLINE.md throws a RAW stack trace ` +
      `(unhandled parseOutline error) instead of a friendly message. Contrast: \`done\` ` +
      `degrades gracefully ("run 'pensmith compile' first"). Reachable via --dry-run, ` +
      `hand-edited outlines, or a malformed LLM outline.`,
    );
  } else {
    pass(`${verb}-no-sections`, `exit ${r.code} with a friendly (non-stack) diagnostic`);
  }
}

// ── 6. done: graceful when no compiled draft ──
{
  const r = pen(['done', '--dry-run', '--yolo']);
  if (r.code === 0 && /run 'pensmith compile'/.test(r.out)) pass('done-no-draft', 'graceful "run compile first"');
  else if (!looksLikeRawStack(r.out)) pass('done-no-draft', `exit ${r.code}, no raw stack`);
  else fail('done-no-draft', `raw stack:\n${r.out}`);
}

// ── 7. registry isolation (Bug-3 hygiene) ──
// Our isolated data dir should hold exactly the papers WE created — proving the
// run did not pollute the user's real %LOCALAPPDATA%\pensmith\library\index.json.
{
  const idx = path.join(DATA, 'pensmith', 'library', 'index.json');
  if (existsSync(idx)) {
    let n = -1, dead = -1;
    try {
      const j = JSON.parse(readFileSync(idx, 'utf8'));
      const arr = Array.isArray(j) ? j : (j.entries ?? j.papers ?? []);
      n = arr.length;
      dead = arr.filter((e) => { const p = e.folderPath ?? e.path; return !(p && existsSync(p)); }).length;
    } catch { /* ignore */ }
    if (n >= 0 && n <= 2) pass('registry-isolation', `isolated registry holds ${n} paper(s); real registry untouched`);
    else info('registry-isolation', `isolated registry holds ${n} entries (${dead} dead)`);
    info('registry-gc', 'NOTE: the production registry has no GC for dead (deleted-folder) entries — see findings.');
  } else {
    info('registry-isolation', 'no isolated registry written (intake may have WARN-skipped registration)');
  }
}

// ── Summary ──
console.log('\n──────── E2E SMOKE SUMMARY ────────');
const order = { FAIL: 0, FINDING: 1, INFO: 2, PASS: 3 };
results.sort((a, b) => order[a.kind] - order[b.kind]);
for (const r of results) {
  const tag = r.kind.padEnd(7);
  console.log(`[${tag}] ${r.name}`);
  if (r.detail && (r.kind === 'FAIL' || r.kind === 'FINDING')) {
    console.log(`          ${r.detail.replace(/\n/g, '\n          ')}`);
  } else if (r.detail && r.kind === 'INFO') {
    console.log(`          ${r.detail}`);
  }
}
const fails = results.filter((r) => r.kind === 'FAIL').length;
const findings = results.filter((r) => r.kind === 'FINDING').length;
const passes = results.filter((r) => r.kind === 'PASS').length;
console.log('───────────────────────────────────');
console.log(`PASS=${passes}  FINDING=${findings}  FAIL=${fails}`);

if (KEEP) console.log(`\n(workspace kept: ${WORK})`);
else { try { rmSync(WORK, { recursive: true, force: true }); } catch { /* ignore */ } }

process.exit(fails > 0 ? 1 : 0);
