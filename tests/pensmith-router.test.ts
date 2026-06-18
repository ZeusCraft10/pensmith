// tests/pensmith-router.test.ts — Phase 7 Wave 0 RED scaffold for UX-01.
//
// RED-by-skip precedent (05-01 / 06-01): every behavioral assertion is
// skip-guarded on existsSync('bin/lib/router.ts'). Until Plan 07-02 lands the
// module the suite reports SKIPS with ZERO failures (RED-by-skip, NOT
// RED-by-crash). When router.ts lands these tests un-skip and must PASS — and
// would FAIL against the original broken designs (H4 resume-loop, C3-HIGH-1
// non-total decision table, C4-HIGH corrupt-STATE re-throw, C5-HIGH unguarded
// per-section PLAN.md read).
//
// Asserts the EXACT contract from 07-01-PLAN.md <interfaces>:
//   export function resolveNextAction(paperRoot: string): Promise<RouterDecision>
//   RouterDecision is TOTAL over SectionStateSchema and NEVER undefined / throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// RED-by-skip guard — the module under test does not exist until Plan 07-02.
const ROUTER_SRC = fileURLToPath(new URL('../bin/lib/router.ts', import.meta.url));
const built = existsSync(ROUTER_SRC);
// Runtime import specifier (.js — NodeNext ESM under tsx maps to the .ts).
const ROUTER_MOD = new URL('../bin/lib/router.js', import.meta.url).href;

interface RouterDecision {
  verb: string;
  n?: number;
  slug?: string;
  reason?: string;
  section?: { n: number; slug: string };
}
type ResolveNextAction = (paperRoot: string) => Promise<RouterDecision>;

async function loadResolve(): Promise<ResolveNextAction> {
  const mod = (await import(ROUTER_MOD)) as { resolveNextAction: ResolveNextAction };
  return mod.resolveNextAction;
}

// === Fixture builders ===
// STATE.json lives at <root>/STATE.json (stateFile() contract); RESEARCH.md /
// OUTLINE.md / DRAFT.md / FINAL.md live under <root>/.paper/ (paperDir()); each
// per-section PLAN.md lives at <root>/.paper/sections/<NN-slug>/PLAN.md
// (sectionPlan() contract). Section dirs use zero-padded NN-slug.

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-router-'));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function writeState(root: string, sections: Array<{ n: number; slug: string }>): void {
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 2,
      paperId: 'router-test',
      createdAt: new Date().toISOString(),
      sections,
    }),
  );
}

function writePaperFile(root: string, name: string, body = '# ' + name + '\n'): void {
  const pDir = join(root, '.paper');
  mkdirSync(pDir, { recursive: true });
  writeFileSync(join(pDir, name), body);
}

function writeSectionPlan(root: string, n: number, slug: string, status: string): void {
  const dir = join(root, '.paper', 'sections', `${pad(n)}-${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'PLAN.md'), `---\nstatus: ${status}\n---\n# Section ${n}\n`);
}

// Write a per-section PLAN.md whose YAML frontmatter THROWS in
// parseFrontmatter (yaml@^2 parseDocument().toJSON()). An alias to a
// non-existent anchor (`status: *missing`) makes toJSON() throw a
// ReferenceError — the genuine corrupt-PLAN throw path. (The plan's
// duplicate-key example is silently tolerated by yaml@^2, so it would
// NOT exercise the C5/C6 throw; see 07-01-SUMMARY Deviations.)
function writeCorruptSectionPlan(root: string, n: number, slug: string): void {
  const dir = join(root, '.paper', 'sections', `${pad(n)}-${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'PLAN.md'), `---\nstatus: *missing_anchor\n---\nbody text\n`);
}

// --- RED-by-skip presence guard (mirrors known-bad-pass2 module-presence) ---
test('UX-01: router module presence is consistent with Wave-0 RED state', () => {
  if (built) {
    assert.ok(built, 'bin/lib/router.ts present — behavioral tests active');
  } else {
    assert.ok(!built, 'Wave-0: bin/lib/router.ts absent (RED-by-skip)');
  }
});

// === (a) no STATE.json → new (StateNotFoundError caught, no throw) ===
test('UX-01 (a): absent STATE.json → { verb: "new" } (no throw)', { skip: !built }, async () => {
  const resolveNextAction = await loadResolve();
  const root = freshRoot();
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'new', 'UX-01: a paper-less dir routes to new');
});

// === (b) STATE.json present, RESEARCH.md absent → research ===
test('UX-01 (b): STATE.json + no RESEARCH.md → { verb: "research" }', { skip: !built }, async () => {
  const resolveNextAction = await loadResolve();
  const root = freshRoot();
  writeState(root, []);
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'research', 'UX-01: RESEARCH.md missing routes to research');
});

// === (c) RESEARCH.md present, no OUTLINE.md / zero sections → outline ===
test('UX-01 (c): RESEARCH.md present, no OUTLINE.md → { verb: "outline" }', { skip: !built }, async () => {
  const resolveNextAction = await loadResolve();
  const root = freshRoot();
  writeState(root, []);
  writePaperFile(root, 'RESEARCH.md');
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'outline', 'UX-01: OUTLINE.md missing routes to outline');
});

// === (d) section with a 'planned' PLAN.md → plan ===
test('UX-01 (d): planned section → { verb: "plan", n, slug }', { skip: !built }, async () => {
  const resolveNextAction = await loadResolve();
  const root = freshRoot();
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writePaperFile(root, 'RESEARCH.md');
  writePaperFile(root, 'OUTLINE.md');
  writeSectionPlan(root, 1, 'intro', 'planned');
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'plan', 'UX-01: planned section routes to plan');
  assert.equal(decision.n, 1, 'UX-01: plan decision carries n');
  assert.equal(decision.slug, 'intro', 'UX-01: plan decision carries slug');
});

// === (e) all sections verified, no DRAFT.md → compile ===
test('UX-01 (e): all verified, no DRAFT.md → { verb: "compile" }', { skip: !built }, async () => {
  const resolveNextAction = await loadResolve();
  const root = freshRoot();
  writeState(root, [{ n: 1, slug: 'intro' }, { n: 2, slug: 'methods' }]);
  writePaperFile(root, 'RESEARCH.md');
  writePaperFile(root, 'OUTLINE.md');
  writeSectionPlan(root, 1, 'intro', 'verified');
  writeSectionPlan(root, 2, 'methods', 'verified');
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'compile', 'UX-01: all-verified + no DRAFT.md routes to compile');
});

// === (f) DRAFT.md present, no FINAL.md → done ===
test('UX-01 (f): DRAFT.md present, no FINAL.md → { verb: "done" }', { skip: !built }, async () => {
  const resolveNextAction = await loadResolve();
  const root = freshRoot();
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writePaperFile(root, 'RESEARCH.md');
  writePaperFile(root, 'OUTLINE.md');
  writeSectionPlan(root, 1, 'intro', 'verified');
  writePaperFile(root, 'DRAFT.md');
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'done', 'UX-01: DRAFT.md + no FINAL.md routes to done');
});

// ===========================================================================
// C3-HIGH-1 TOTALITY — every SectionStateSchema state + the mixed stuck case.
// The original suite fixtured only planned/verified/DRAFT/FINAL, so a reachable
// stuck section (failed/unverifiable) stayed GREEN against a non-total resolver
// that fell through to undefined. Each case below also creates STATE.json +
// RESEARCH.md + OUTLINE.md so the walk REACHES the section branch (review M5).
// ===========================================================================

function totalityRoot(sections: Array<{ n: number; slug: string }>): string {
  const root = freshRoot();
  writeState(root, sections);
  writePaperFile(root, 'RESEARCH.md');
  writePaperFile(root, 'OUTLINE.md');
  return root;
}

// === (g) writing → write ===
test('UX-01 / C3-HIGH-1 (g): first section "writing" → { verb: "write", n, slug } (non-undefined)',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = totalityRoot([{ n: 1, slug: 'intro' }]);
    writeSectionPlan(root, 1, 'intro', 'writing');
    const decision = await resolveNextAction(root);
    assert.notEqual(decision, undefined, 'C3-HIGH-1: resolver must not return undefined for "writing"');
    assert.equal(decision.verb, 'write', 'C3-HIGH-1: "writing" routes to write');
    assert.equal(decision.n, 1);
    assert.equal(decision.slug, 'intro');
  });

// === (h) written → verify ===
test('UX-01 / C3-HIGH-1 (h): first section "written" → { verb: "verify", n, slug } (non-undefined)',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = totalityRoot([{ n: 1, slug: 'intro' }]);
    writeSectionPlan(root, 1, 'intro', 'written');
    const decision = await resolveNextAction(root);
    assert.notEqual(decision, undefined, 'C3-HIGH-1: resolver must not return undefined for "written"');
    assert.equal(decision.verb, 'verify', 'C3-HIGH-1: "written" routes to verify');
  });

// === (i) verifying → verify ===
test('UX-01 / C3-HIGH-1 (i): first section "verifying" → { verb: "verify", n, slug } (non-undefined)',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = totalityRoot([{ n: 1, slug: 'intro' }]);
    writeSectionPlan(root, 1, 'intro', 'verifying');
    const decision = await resolveNextAction(root);
    assert.notEqual(decision, undefined, 'C3-HIGH-1: resolver must not return undefined for "verifying"');
    assert.equal(decision.verb, 'verify', 'C3-HIGH-1: "verifying" routes to verify');
  });

// === (j) failed → verify (NOT continue/compile) — KEY totality assertion ===
test('UX-01 / C3-HIGH-1 (j): first section "failed" → { verb: "verify" } NOT continue/compile (non-undefined)',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = totalityRoot([{ n: 1, slug: 'intro' }]);
    writeSectionPlan(root, 1, 'intro', 'failed');
    const decision = await resolveNextAction(root);
    assert.notEqual(decision, undefined, 'C3-HIGH-1: resolver must not return undefined for "failed"');
    assert.equal(typeof decision.verb, 'string', 'C3-HIGH-1: decision.verb must be a string');
    assert.equal(decision.verb, 'verify', 'C3-HIGH-1: "failed" re-attempts verify (must NOT continue to compile)');
  });

// === (k) unverifiable → verify (NOT continue/compile) ===
test('UX-01 / C3-HIGH-1 (k): first section "unverifiable" → { verb: "verify" } NOT continue/compile (non-undefined)',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = totalityRoot([{ n: 1, slug: 'intro' }]);
    writeSectionPlan(root, 1, 'intro', 'unverifiable');
    const decision = await resolveNextAction(root);
    assert.notEqual(decision, undefined, 'C3-HIGH-1: resolver must not return undefined for "unverifiable"');
    assert.equal(decision.verb, 'verify', 'C3-HIGH-1: "unverifiable" re-attempts verify (must NOT continue to compile)');
  });

// === (l) MIXED STUCK CASE: [verified, failed, verified] + no DRAFT.md ===
test('UX-01 / C3-HIGH-1 (l): mixed [verified,failed,verified] + no DRAFT.md → valid non-undefined verify at the failed section',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = totalityRoot([
      { n: 1, slug: 'intro' },
      { n: 2, slug: 'methods' },
      { n: 3, slug: 'results' },
    ]);
    writeSectionPlan(root, 1, 'intro', 'verified');
    writeSectionPlan(root, 2, 'methods', 'failed');
    writeSectionPlan(root, 3, 'results', 'verified');
    // Intentionally NO DRAFT.md — the stuck middle section must NOT let the
    // walk fall through to undefined and must NOT prematurely compile.
    const decision = await resolveNextAction(root);
    assert.notEqual(decision, undefined,
      'C3-HIGH-1: the mixed stuck state must NOT return undefined (the reachable cycle-3 HIGH)');
    assert.equal(typeof decision.verb, 'string', 'C3-HIGH-1: decision.verb must be a string');
    assert.equal(decision.verb, 'verify',
      'C3-HIGH-1: the failed middle section routes to verify, NOT undefined and NOT compile');
    assert.equal(decision.n, 2, 'C3-HIGH-1: verify targets the failed section (n=2)');
    assert.equal(decision.slug, 'methods', 'C3-HIGH-1: verify targets the failed section (methods)');
  });

// ===========================================================================
// C4-HIGH — present-but-corrupt STATE.json must NOT crash the router. loadState
// translates ONLY ENOENT → StateNotFoundError; a malformed STATE.json throws a
// SyntaxError / SchemaValidationError that the cycle-3 StateNotFoundError-ONLY
// catch re-threw, crashing the bare dispatcher before decision.verb. The router
// must reclassify: present-but-corrupt → { verb:'status', reason:'attention' }
// (NOT 'new', which is the ABSENT-file disposition).
// ===========================================================================

// === (m) invalid-JSON STATE.json → status/attention, no throw ===
test('UX-01 / C4-HIGH (m): invalid-JSON STATE.json → status/attention, no throw (not treated as absent)',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = freshRoot();
    // Non-JSON content → JSON.parse throws a SyntaxError inside loadState.
    writeFileSync(join(root, 'STATE.json'), '{ this is not json ');
    let decision: RouterDecision | undefined;
    await assert.doesNotReject(
      async () => { decision = await resolveNextAction(root); },
      'C4-HIGH: a present-but-corrupt STATE.json must NOT crash the router (no throw)',
    );
    assert.notEqual(decision, undefined, 'C4-HIGH: decision must be defined');
    assert.equal(typeof decision!.verb, 'string', 'C4-HIGH: decision.verb must be a string');
    assert.equal(decision!.verb, 'status',
      'C4-HIGH: a present-but-corrupt STATE.json routes to status (the attention terminus), NOT new');
    assert.equal(decision!.reason, 'attention',
      'C4-HIGH: corrupt-file disposition is reason:"attention", distinct from the absent-file "new"');
  });

// === (n) schema-invalid STATE.json (section missing slug) → status/attention ===
test('UX-01 / C4-HIGH (n): schema-invalid STATE.json (section missing slug) → status/attention, no throw',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = freshRoot();
    // Valid JSON but fails StateSchema: a sections entry missing the required slug.
    writeFileSync(
      join(root, 'STATE.json'),
      JSON.stringify({
        $schemaVersion: 2,
        paperId: 'p',
        createdAt: new Date().toISOString(),
        sections: [{ n: 1 }],
      }),
    );
    let decision: RouterDecision | undefined;
    await assert.doesNotReject(
      async () => { decision = await resolveNextAction(root); },
      'C4-HIGH: a schema-invalid STATE.json must NOT crash the router (no throw)',
    );
    assert.notEqual(decision, undefined, 'C4-HIGH: decision must be defined');
    assert.equal(decision!.verb, 'status',
      'C4-HIGH: a hand-edited / schema-broken STATE.json routes to status without crashing');
    assert.equal(decision!.reason, 'attention', 'C4-HIGH: schema-invalid → reason:"attention"');
  });

// ===========================================================================
// C5-HIGH — present-but-corrupt per-section PLAN.md must NOT crash the router.
// The section walk reads parseFrontmatter(readFileSync(planPath)); a PLAN.md
// whose frontmatter throws in yaml@^2 toJSON() (alias to a missing anchor)
// escaped the unguarded read and crashed bare /pensmith before the switch
// default. The router must reclassify a present-but-corrupt PLAN.md →
// status/attention+section (NOT 'plan', which is the ABSENT-file disposition).
// The estimator gets NO C5 case — it counts sections from STATE.json and never
// reads PLAN.md.
// ===========================================================================

// === (o) corrupt PLAN.md (unparseable frontmatter) → status/attention+section ===
test('UX-01 / C5-HIGH (o): present-but-corrupt PLAN.md → status/attention+section, no throw (not treated as absent)',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = totalityRoot([{ n: 1, slug: 'intro' }]);
    writeCorruptSectionPlan(root, 1, 'intro'); // alias-to-missing-anchor → parseFrontmatter throws
    let decision: RouterDecision | undefined;
    await assert.doesNotReject(
      async () => { decision = await resolveNextAction(root); },
      'C5-HIGH: a present-but-corrupt PLAN.md must NOT crash the router (no throw)',
    );
    assert.notEqual(decision, undefined, 'C5-HIGH: decision must be defined');
    assert.equal(typeof decision!.verb, 'string', 'C5-HIGH: decision.verb must be a string');
    assert.equal(decision!.verb, 'status',
      'C5-HIGH: a present-but-corrupt PLAN.md routes to status/attention, NOT plan (the absent disposition)');
    assert.equal(decision!.reason, 'attention', 'C5-HIGH: corrupt PLAN.md → reason:"attention"');
    assert.deepEqual(decision!.section, { n: 1, slug: 'intro' },
      'C5-HIGH: status/attention names the corrupt section');
  });

// === (p) absent PLAN.md → plan (the genuinely-absent disposition) ===
test('UX-01 / C5-HIGH (p): section in STATE.json but PLAN.md absent → { verb: "plan", n, slug }',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = totalityRoot([{ n: 1, slug: 'intro' }]);
    // Deliberately do NOT create the section's PLAN.md (existsSync(planPath) false).
    const decision = await resolveNextAction(root);
    assert.equal(decision.verb, 'plan',
      'C5-HIGH: an ABSENT PLAN.md routes to plan (distinct from the corrupt disposition status/attention)');
    assert.equal(decision.n, 1);
    assert.equal(decision.slug, 'intro');
  });

// ===========================================================================
// H4 — resume circularity. A valid non-done HANDOFF.json must NOT make bare
// /pensmith resolve to { verb:'resume' } (which re-dispatched to itself
// forever). resolveNextAction IGNORES HANDOFF and returns the next WORK verb.
// ===========================================================================
test('UX-01 / H4: a valid non-done HANDOFF resolves to the next WORK verb, NEVER resume',
  { skip: !built }, async () => {
    const resolveNextAction = await loadResolve();
    const root = totalityRoot([{ n: 1, slug: 'intro' }]);
    writeSectionPlan(root, 1, 'intro', 'planned');
    // A VALID non-done HANDOFF.json — the original design returned { verb:'resume' }
    // here, looping forever. The resolver must ignore it.
    writeFileSync(
      join(root, '.paper', 'HANDOFF.json'),
      JSON.stringify({
        schema_version: 1,
        last_updated: new Date().toISOString(),
        current_section: 'intro',
        phase: 'write',
        next_action: 'Resume write on section intro.',
        breadcrumbs: [],
        section_pointers: [
          {
            slug: 'intro',
            plan_path: join(root, '.paper', 'sections', '01-intro', 'PLAN.md'),
            draft_path: null,
            verification_path: null,
            state: 'planned',
          },
        ],
      }),
    );
    const decision = await resolveNextAction(root);
    assert.notEqual(decision.verb, 'resume',
      'H4: resolveNextAction must NEVER return resume (bare /pensmith must always advance)');
    assert.equal(decision.verb, 'plan',
      'H4: with a planned section the next WORK verb is plan (HANDOFF is ignored)');
  });
