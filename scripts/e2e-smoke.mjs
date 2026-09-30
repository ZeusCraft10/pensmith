#!/usr/bin/env node
// scripts/e2e-smoke.mjs
//
// End-to-end smoke harness for the Tier-2 (portable Node CLI) pipeline.
//
// WHY THIS EXISTS
//   The unit/contract suite (`npm test`) exercises each verb in
//   ISOLATION — every plan/write/verify/compile/done case pre-seeds its own
//   fixture. Nothing drives the *bare* `pensmith` router across the real
//   new -> research -> outline -> ... chain to confirm that running one verb
//   actually lets the single-command UX (`/pensmith`, the README headline)
//   advance to the next. This harness fills exactly that gap.
//
// WHAT IT DOES
//   1. Builds an ISOLATED workspace AND an isolated data dir (LOCALAPPDATA /
//      XDG_DATA_HOME) so the run never touches the user's real paper registry.
//   2. Runs the pipeline as a --dry-run preview (D-17-04: the http.ts gate
//      refuses every request, research uses the labelled synthetic dry-run
//      provider, PENSMITH_NO_LLM answers every model call with its contract
//      stub — zero network, zero API key, zero cost). A dry run works in the
//      `.paper-dry-run/` workspace and never creates `.paper/` (D-18-29).
//   3. Walks the verbs one at a time (new → research → outline → plan → write,
//      which verifies), checking after each that the router names the next
//      step, then lets one bare `pensmith --dry-run --yolo` loop to the export
//      (D-18-30).
//   4. Asserts a battery of named checks and prints a PASS/FAIL/FINDING table.
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
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync,
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

// Child env: --dry-run mode + isolated data dir. Every verb below also passes
// --dry-run, which sets these two itself; setting them here covers `status`.
const childEnv = {
  ...process.env,
  PENSMITH_NO_LLM: '1',           // every model call -> deterministic stub (zero egress)
  PENSMITH_DRY_RUN: '1',          // http.ts gate refuses every request; synthetic sources
  LOCALAPPDATA: DATA,             // Windows data root -> isolated temp
  XDG_DATA_HOME: DATA,            // POSIX data root  -> isolated temp
  PENSMITH_CONTACT_EMAIL: 'e2e-smoke@example.invalid',
};
delete childEnv.PENSMITH_NETWORK_TESTS; // the live test lane never applies here

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
const info    = (n, d) => record('INFO', n, d);

// Every run below is a dry run, so the paper lives in the workspace (D-18-29).
const ppaper = (f) => path.join(WORK, '.paper-dry-run', f);

console.log(`workspace : ${WORK}`);
console.log(`data dir  : ${DATA}`);
console.log(`repo      : ${REPO}`);
console.log('running the --dry-run pipeline (PENSMITH_NO_LLM=1, synthetic sources)…\n');

/** A run that printed a raw Node stack trace instead of one line (RUN-12). */
function looksLikeRawStack(s) {
  return /\n\s+at\s+\w/.test(s) || /ERR_[A-Z_]+/.test(s) || /\.ts:\d+:\d+\)/.test(s);
}

/** The router's next step, as `pensmith status` prints it (`§` or the ASCII `#`). */
function nextStep() {
  const r = pen(['status']);
  return (/^\s*next:\s*(.+)$/m.exec(r.stdout)?.[1] ?? '').replace('#', '§').trim();
}

/** A PLAN.md frontmatter value (flat keys only). */
function planField(file, key) {
  if (!existsSync(file)) return null;
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(readFileSync(file, 'utf8'));
  return m ? m[1].trim() : null;
}

// ── 0. doctor ──
{
  const r = pen(['doctor', '--json']);
  if (r.code === 0 && r.stdout.includes('"schemaVersion"')) pass('doctor', 'exits 0, emits JSON report');
  else fail('doctor', `exit=${r.code}`);
}

// ── 1. new -> INTAKE.md (the brief) ──
{
  const r = pen(['new', '--from', ASSIGNMENT, '--dry-run', '--yolo']);
  if (r.code === 0 && existsSync(ppaper('INTAKE.md'))) pass('new', 'INTAKE.md written in .paper-dry-run/, exit 0');
  else fail('new', `exit=${r.code}; INTAKE.md exists=${existsSync(ppaper('INTAKE.md'))}\n${r.out}`);
  const intake = existsSync(ppaper('INTAKE.md')) ? readFileSync(ppaper('INTAKE.md'), 'utf8') : '';
  if (/^schema_version: 1$/m.test(intake) && /^citation_style: apa$/m.test(intake) && /^length_target_words: 1500$/m.test(intake)) {
    pass('intake-brief', 'INTAKE.md is the v1 brief (APA 7 and 1500 words read from the assignment)');
  } else {
    fail('intake-brief', `INTAKE.md is not the expected brief:\n${intake.slice(0, 600)}`);
  }
}

// ── 2. research -> LIBRARY.json (+ .bib/.ris, RESEARCH.md) ──
{
  const r = pen(['research', '--dry-run', '--yolo']);
  const lib = existsSync(ppaper('LIBRARY.json'));
  const bib = existsSync(ppaper('CITATIONS.bib'));
  if (r.code === 0 && lib && bib) pass('research', 'LIBRARY.json + CITATIONS.bib written, exit 0');
  else fail('research', `exit=${r.code}; LIBRARY.json=${lib} CITATIONS.bib=${bib}\n${r.out}`);
  // D-17-10: research also writes the RESEARCH.md log (the router's
  // research-done sentinel), marked as a dry-run preview.
  const researchMd = existsSync(ppaper('RESEARCH.md'));
  if (researchMd) pass('research-artifact', 'RESEARCH.md written alongside LIBRARY.json');
  else fail('research-artifact', 'research did not write RESEARCH.md (D-17-10)');
  const next = nextStep();
  if (next === 'outline') pass('router-after-research', 'the router advanced: next: outline');
  else fail('router-after-research', `after research the router says next: ${next || '(nothing)'}`);
}

// ── 3. outline -> OUTLINE.md + a stub PLAN.md per section (GRND-07, GRND-09) ──
let sections = [];
{
  const r = pen(['outline', '--dry-run', '--yolo']);
  const dir = ppaper('sections');
  sections = existsSync(dir) ? readdirSync(dir).filter((d) => d !== '_archive').sort() : [];
  if (r.code === 0 && existsSync(ppaper('OUTLINE.md')) && /registered \d+ section\(s\)/.test(r.out)) {
    pass('outline', `OUTLINE.md written, ${sections.length} section(s) registered, exit 0`);
  } else {
    fail('outline', `exit=${r.code}; OUTLINE.md exists=${existsSync(ppaper('OUTLINE.md'))}\n${r.out}`);
  }
  const stubs = sections.filter((d) => planField(path.join(dir, d, 'PLAN.md'), 'stub') === 'true');
  if (sections.length >= 3 && stubs.length === sections.length) pass('outline-stubs', 'every section has a stub PLAN.md');
  else fail('outline-stubs', `sections=${sections.join(', ')} stubs=${stubs.length}`);
  const next = nextStep();
  if (next === 'plan §1') pass('router-after-outline', 'next: plan §1');
  else fail('router-after-outline', `after outline the router says next: ${next || '(nothing)'}`);
}

// ── 4. done before compile: graceful ──
{
  const r = pen(['done', '--dry-run', '--yolo']);
  if (looksLikeRawStack(r.out)) fail('done-no-draft', `raw stack:\n${r.out}`);
  else if (r.code === 0 && /run 'pensmith compile'/.test(r.out)) pass('done-no-draft', 'graceful "run compile first"');
  else pass('done-no-draft', `exit ${r.code}, no raw stack`);
}

// ── 5. plan 1 -> write 1 (which verifies §1; GRND-13, GRND-15) ──
{
  const first = sections[0];
  const plan = first ? path.join(ppaper('sections'), first, 'PLAN.md') : '';
  const p = pen(['plan', '1', '--dry-run', '--yolo']);
  if (p.code === 0 && planField(plan, 'status') === 'planned' && planField(plan, 'stub') === null) pass('plan', '§1 planned (the stub replaced)');
  else fail('plan', `exit=${p.code}; status=${planField(plan, 'status')}\n${p.out}`);
  const w = pen(['write', '1', '--dry-run', '--yolo']);
  const draft = first ? path.join(ppaper('sections'), first, 'DRAFT.md') : '';
  const cites = existsSync(draft) ? (readFileSync(draft, 'utf8').match(/\[@[^\]]+\]/g) ?? []).length : 0;
  if (looksLikeRawStack(w.out)) {
    fail('write', `\`pensmith write 1\` printed a raw stack trace (RUN-12):\n${w.out}`);
  } else if (w.code === 0 && planField(plan, 'status') === 'verified' && cites > 0) {
    pass('write', `§1 drafted with ${cites} synthetic citation(s) and verified in one invocation`);
  } else {
    fail('write', `exit=${w.code}; status=${planField(plan, 'status')}; citations=${cites}\n${w.out}`);
  }
  const next = nextStep();
  if (next === 'plan §2') pass('router-after-write', 'next: plan §2');
  else fail('router-after-write', `after write 1 the router says next: ${next || '(nothing)'}`);
}

// ── 6. bare `pensmith --dry-run --yolo` loops to the export (D-18-30) ──
{
  const r = pen(['--dry-run', '--yolo']);
  const exportDir = ppaper('export');
  const exported = existsSync(exportDir) ? readdirSync(exportDir).filter((f) => f.startsWith('DRAFT.')) : [];
  if (looksLikeRawStack(r.out)) {
    fail('dry-run-loop', `the bare dry run printed a raw stack trace (RUN-12):\n${r.out}`);
  } else if (r.code === 0 && /^pensmith: ran done; next: status \(done\)$/m.test(r.stderr) && existsSync(ppaper('FINAL.md')) &&
    exported.length > 0 && exported.every((f) => f.startsWith('DRAFT.dry-run.'))) {
    pass('dry-run-loop', `one invocation finished the paper: ${exported.join(', ')}`);
  } else {
    fail('dry-run-loop', `exit=${r.code}; FINAL.md=${existsSync(ppaper('FINAL.md'))}; export=${exported.join(', ')}\n${r.out}`);
  }
  if (!existsSync(path.join(WORK, '.paper'))) pass('no-real-paper', 'the dry run never created .paper/');
  else fail('no-real-paper', 'a dry run created .paper/ (D-18-29)');
  // VRFY-24 (D-20-21): every section draft of the dry run carries the stub
  // marker, and neither the compiled draft nor the export does.
  const MARKER = '<!-- stub draft (no model configured) — not real prose -->';
  const sectionsDir = ppaper('sections');
  const drafts = existsSync(sectionsDir)
    ? readdirSync(sectionsDir).filter((d) => d !== '_archive').map((d) => path.join(sectionsDir, d, 'DRAFT.md')).filter((f) => existsSync(f))
    : [];
  const unmarked = drafts.filter((f) => !readFileSync(f, 'utf8').startsWith(MARKER));
  const leaked = [ppaper('DRAFT.md'), ...exported.map((f) => path.join(exportDir, f))].filter((f) => existsSync(f) && readFileSync(f, 'latin1').includes('stub draft (no model configured)'));
  if (drafts.length > 0 && unmarked.length === 0 && leaked.length === 0) {
    pass('stub-marker', `${drafts.length} stub section draft(s) marked; the compiled draft and the export carry no marker`);
  } else {
    fail('stub-marker', `drafts=${drafts.length} unmarked=${unmarked.join(', ')} leaked=${leaked.join(', ')}`);
  }
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
    if (n === 0) pass('registry-isolation', 'a dry-run paper is never registered; the real registry is untouched');
    else fail('registry-isolation', `the isolated registry holds ${n} entries (${dead} dead): a dry run registered a paper (D-18-29)`);
    info('registry-gc', 'registering a paper prunes dead-folder entries (audit M3, tests/registry-gc.test.ts).');
  } else {
    pass('registry-isolation', 'no registry written: a dry-run paper is never registered (D-18-29)');
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
