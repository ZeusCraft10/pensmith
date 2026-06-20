// tests/global-library.test.ts — Phase 8 Wave 0 RED-by-skip scaffold for
// LIB-01/02/03/05 (the cross-project global library index + the
// DERIVE-AT-DISPLAY status resolver).
//
// RED-by-skip (mirrors the [05-01]/[06-01]/[07-01] precedent): every test is
// `{ skip: !READY }` where READY = existsSync('bin/lib/global-library.ts'). The
// module is built in 08-01; until then the whole suite reports SKIP (never a
// hard failure) so `npm test` stays GREEN. When 08-01 lands the module, these
// flip to live assertions that pin:
//   - LIB-01/02: init creates index.json under pensmithDataDir()/library/ (NEVER
//     inside any .paper/); registerPaperInGlobalLibrary UPSERTs by id (insert
//     new, UPDATE existing — NOT reject-on-duplicate); loadGlobalLibrary
//     auto-inits on ENOENT.
//   - LIB-03: the PAPER registry entry RETAINS folderPath (round-trips) — this is
//     load-bearing for `open` + status derivation, and is DELIBERATELY distinct
//     from the path-free FINGERPRINT registry asserted in style-match.test.ts.
//   - LIB-05 (the cycle-2 HIGH fix — the thing that makes the lifecycle FUNCTIONAL
//     beyond intake): deriveLibraryStatus(folderPath, storedStatus) returns the
//     DERIVED on-disk lifecycle value per paper (a real `sectioning {done,total}`,
//     not the stored intake) AND NEVER throws on a missing/corrupt STATE.json or
//     a corrupt section PLAN.md.
//
// TYPECHECK NOTE: the not-yet-built module is imported via a runtime URL.href
// specifier (NOT a static '../bin/lib/global-library.js' path) so `tsc --noEmit`
// stays clean while the module is absent — the [05-01]/known-bad-pass2 precedent.
//
// Isolation: every test uses the tests/library.test.ts env-override tmpdir
// pattern (LOCALAPPDATA / XDG_DATA_HOME / HOME → a fresh mkdtempSync).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Runtime import specifier (.js — NodeNext ESM under tsx maps to the .ts).
// Using URL.href keeps the path opaque to tsc so typecheck passes pre-build.
const GLIB_MOD = new URL('../bin/lib/global-library.js', import.meta.url);
const GLIB_SRC = fileURLToPath(new URL('../bin/lib/global-library.ts', import.meta.url));

// Type contracts the tests assert against (08-01 must satisfy these).
interface GlobalLibraryEntry {
  id: string;
  name: string;
  folderPath: string;
  class: string;
  status: 'intake' | 'research' | 'outline' | 'sectioning' | 'compile' | 'done' | 'archived';
  sectioningProgress?: { done: number; total: number };
  createdAt: string;
  updatedAt: string;
}
interface GlobalLibrary {
  entries: GlobalLibraryEntry[];
}
interface DerivedStatus {
  status: 'intake' | 'research' | 'outline' | 'sectioning' | 'compile' | 'done' | 'archived' | 'unknown';
  sectioningProgress?: { done: number; total: number };
}
interface GlobalLibraryMod {
  initGlobalLibrary: () => Promise<GlobalLibrary>;
  loadGlobalLibrary: () => Promise<GlobalLibrary>;
  registerPaperInGlobalLibrary: (entry: GlobalLibraryEntry) => Promise<GlobalLibrary>;
  deriveLibraryStatus: (folderPath: string, storedStatus?: string) => DerivedStatus;
}

async function glib(): Promise<GlobalLibraryMod> {
  return (await import(GLIB_MOD.href)) as GlobalLibraryMod;
}

// Skip-guard: bin/lib/global-library.ts is built in 08-01.
const READY = fs.existsSync(GLIB_SRC);

function mkDataRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-glib-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

/** Make a fresh, isolated PAPER ROOT (a `.paper/`-bearing project) under tmp. */
function mkPaperRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-paper-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  return root;
}

// ---------------------------------------------------------------------------
// LIB-01/02 — init + load + UPSERT + index-location invariants.
// ---------------------------------------------------------------------------

test('LIB-01: initGlobalLibrary then loadGlobalLibrary returns an empty entry set', { skip: !READY }, async () => {
  mkDataRoot();
  const { initGlobalLibrary, loadGlobalLibrary } = await glib();

  await initGlobalLibrary();
  const lib = await loadGlobalLibrary();

  assert.ok(Array.isArray(lib.entries), 'entries must be an array');
  assert.equal(lib.entries.length, 0, 'fresh library has zero entries');
});

test('LIB-02: loadGlobalLibrary auto-inits on ENOENT (never throws on a missing index)', { skip: !READY }, async () => {
  mkDataRoot();
  const { loadGlobalLibrary } = await glib();

  // No initGlobalLibrary() first — load must seed an empty index rather than reject.
  const lib = await loadGlobalLibrary();
  assert.deepEqual(lib.entries, [], 'auto-init yields an empty index');
});

test('LIB-02: the global index lives under pensmithDataDir()/library, NEVER inside any .paper/', { skip: !READY }, async () => {
  const tmp = mkDataRoot();
  const { initGlobalLibrary } = await glib();
  const { pensmithDataDir } = await import('../bin/lib/paths.js');

  await initGlobalLibrary();

  const libDir = path.join(pensmithDataDir(), 'library');
  assert.ok(fs.existsSync(libDir), 'library dir must exist under pensmithDataDir()');
  assert.ok(libDir.startsWith(tmp), 'index must resolve inside the tmp data dir, not a .paper/');
  // Negative control: nothing was written under any `.paper/` for the index.
  assert.ok(!libDir.includes('.paper'), 'global index must NOT live inside any .paper/');
});

test('LIB-02: registerPaperInGlobalLibrary UPSERTs by id (insert new, then UPDATE existing — NOT reject-on-duplicate)', { skip: !READY }, async () => {
  mkDataRoot();
  const { initGlobalLibrary, registerPaperInGlobalLibrary, loadGlobalLibrary } = await glib();

  await initGlobalLibrary();

  const id = 'paper-1';
  const base: GlobalLibraryEntry = {
    id,
    name: 'First Title',
    folderPath: '/papers/first',
    class: 'Unfiled',
    status: 'intake',
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z',
  };

  await registerPaperInGlobalLibrary(base);
  // Re-register the SAME id with a changed name — UPSERT must UPDATE, not reject
  // and not duplicate.
  await registerPaperInGlobalLibrary({ ...base, name: 'Renamed Title', updatedAt: '2099-02-02T00:00:00.000Z' });

  const lib = await loadGlobalLibrary();
  const matching = lib.entries.filter((e) => e.id === id);
  assert.equal(matching.length, 1, 'UPSERT must keep exactly one entry per id (no duplicate insert)');
  assert.equal(matching[0]?.name, 'Renamed Title', 'UPSERT must UPDATE the existing entry in place');
});

// ---------------------------------------------------------------------------
// LIB-03 — the PAPER registry RETAINS folderPath (distinct from the path-free
// FINGERPRINT registry). open + status derivation both need it.
// ---------------------------------------------------------------------------

test('LIB-03: a registered PAPER entry round-trips its folderPath (load-bearing for open + status derivation)', { skip: !READY }, async () => {
  mkDataRoot();
  const { initGlobalLibrary, registerPaperInGlobalLibrary, loadGlobalLibrary } = await glib();

  await initGlobalLibrary();

  const folderPath = path.join(os.tmpdir(), 'pensmith-some-paper-folder');
  await registerPaperInGlobalLibrary({
    id: 'paper-fp',
    name: 'Folder Path Test',
    folderPath,
    class: 'Unfiled',
    status: 'intake',
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z',
  });

  const lib = await loadGlobalLibrary();
  const entry = lib.entries.find((e) => e.id === 'paper-fp');
  assert.ok(entry, 'entry must persist');
  assert.equal(entry?.folderPath, folderPath, 'PAPER registry MUST retain folderPath (LIB-03)');
});

// ---------------------------------------------------------------------------
// LIB-05 — the DERIVE-AT-DISPLAY status resolver (the cycle-2 HIGH fix).
//
// deriveLibraryStatus(folderPath, storedStatus?) mirrors router.resolveNextAction's
// on-disk stage machine onto the LIB-05 vocabulary and NEVER throws. We build
// papers in DIFFERENT on-disk lifecycle states and assert the DERIVED value
// (NOT the stored entry.status).
// ---------------------------------------------------------------------------

/** Seed STATE.json (via initState) so the resolver has a real envelope to read. */
async function seedState(root: string): Promise<void> {
  const { initState } = await import('../bin/lib/state.js');
  await initState(root);
}

test('LIB-05 (1): STATE.json present, no .paper/RESEARCH.md → "intake"', { skip: !READY }, async () => {
  mkDataRoot();
  const root = mkPaperRoot();
  await seedState(root);
  const { deriveLibraryStatus } = await glib();

  const r = deriveLibraryStatus(root);
  assert.equal(r.status, 'intake');
});

test('LIB-05 (2): +.paper/RESEARCH.md, no OUTLINE.md → "research"', { skip: !READY }, async () => {
  mkDataRoot();
  const root = mkPaperRoot();
  await seedState(root);
  fs.writeFileSync(path.join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  const { deriveLibraryStatus } = await glib();

  assert.equal(deriveLibraryStatus(root).status, 'research');
});

test('LIB-05 (3): +.paper/OUTLINE.md but sections empty → "outline"', { skip: !READY }, async () => {
  mkDataRoot();
  const root = mkPaperRoot();
  await seedState(root);
  fs.writeFileSync(path.join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  fs.writeFileSync(path.join(root, '.paper', 'OUTLINE.md'), '# Outline\n');
  // No initSection calls → sections.length === 0.
  const { deriveLibraryStatus } = await glib();

  assert.equal(deriveLibraryStatus(root).status, 'outline');
});

test('LIB-05 (4): N sections seeded, M past-planned → "sectioning" with a REAL {done:M,total:N}', { skip: !READY }, async () => {
  mkDataRoot();
  const root = mkPaperRoot();
  await seedState(root);
  fs.writeFileSync(path.join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  fs.writeFileSync(path.join(root, '.paper', 'OUTLINE.md'), '# Outline\n');

  const { initSection } = await import('../bin/lib/state.js');
  const { sectionPlan } = await import('../bin/lib/paths.js');
  const { atomicWriteFile } = await import('../bin/lib/atomic-write.js');

  // 3 sections; 2 are past 'planned' (written / verified), 1 is still 'planned'.
  const sections: Array<{ n: number; slug: string; status: string }> = [
    { n: 1, slug: 'intro', status: 'written' },
    { n: 2, slug: 'methods', status: 'verified' },
    { n: 3, slug: 'results', status: 'planned' },
  ];
  for (const s of sections) {
    await initSection(root, s.n, s.slug);
    const body =
      `---\nsection: ${s.n}\nslug: ${s.slug}\ntitle: ${s.slug}\nstatus: ${s.status}\n---\n# ${s.slug}\n`;
    await atomicWriteFile(sectionPlan(s.n, s.slug, root), body);
  }

  const { deriveLibraryStatus } = await glib();
  const r = deriveLibraryStatus(root);
  assert.equal(r.status, 'sectioning', 'a mid-sectioning paper must derive "sectioning"');
  assert.deepEqual(
    r.sectioningProgress,
    { done: 2, total: 3 },
    'sectioningProgress must be a REAL X/Y (2 of 3 past planned) — proves the branch is live, not dead',
  );
});

test('LIB-05 (5): all sections verified, no DRAFT.md → "compile"; +DRAFT.md → "done"', { skip: !READY }, async () => {
  mkDataRoot();
  const root = mkPaperRoot();
  await seedState(root);
  fs.writeFileSync(path.join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  fs.writeFileSync(path.join(root, '.paper', 'OUTLINE.md'), '# Outline\n');

  const { initSection } = await import('../bin/lib/state.js');
  const { sectionPlan } = await import('../bin/lib/paths.js');
  const { atomicWriteFile } = await import('../bin/lib/atomic-write.js');

  for (const s of [{ n: 1, slug: 'intro' }, { n: 2, slug: 'methods' }]) {
    await initSection(root, s.n, s.slug);
    await atomicWriteFile(
      sectionPlan(s.n, s.slug, root),
      `---\nsection: ${s.n}\nslug: ${s.slug}\ntitle: ${s.slug}\nstatus: verified\n---\n# ${s.slug}\n`,
    );
  }

  const { deriveLibraryStatus } = await glib();
  assert.equal(deriveLibraryStatus(root).status, 'compile', 'all-verified, no DRAFT.md → compile');

  fs.writeFileSync(path.join(root, '.paper', 'DRAFT.md'), '# Compiled draft\n');
  assert.equal(deriveLibraryStatus(root).status, 'done', '+DRAFT.md → done');
});

test('LIB-05 (6): storedStatus="archived" → "archived" regardless of on-disk state (terminal flag honored)', { skip: !READY }, async () => {
  mkDataRoot();
  const root = mkPaperRoot();
  await seedState(root);
  // Even a fully on-disk-"done" paper must show archived when the stored flag is set.
  fs.writeFileSync(path.join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  fs.writeFileSync(path.join(root, '.paper', 'OUTLINE.md'), '# Outline\n');
  fs.writeFileSync(path.join(root, '.paper', 'DRAFT.md'), '# Draft\n');

  const { deriveLibraryStatus } = await glib();
  assert.equal(deriveLibraryStatus(root, 'archived').status, 'archived');
});

test('LIB-05 (7a): NEVER-THROW — absent STATE.json → "intake" (resolves, does not reject)', { skip: !READY }, async () => {
  mkDataRoot();
  const root = mkPaperRoot();
  // No seedState — STATE.json is ABSENT.
  const { deriveLibraryStatus } = await glib();

  let result: DerivedStatus | undefined;
  assert.doesNotThrow(() => {
    result = deriveLibraryStatus(root);
  }, 'deriveLibraryStatus must NOT throw on an absent STATE.json');
  assert.equal(result?.status, 'intake', 'absent STATE.json → intake');
});

test('LIB-05 (7b): NEVER-THROW — corrupt STATE.json → "unknown" (resolves, does not reject)', { skip: !READY }, async () => {
  mkDataRoot();
  const root = mkPaperRoot();
  // STATE.json PRESENT but invalid JSON / schema-invalid.
  fs.writeFileSync(path.join(root, 'STATE.json'), '{ this is : not, valid json');
  const { deriveLibraryStatus } = await glib();

  let result: DerivedStatus | undefined;
  assert.doesNotThrow(() => {
    result = deriveLibraryStatus(root);
  }, 'deriveLibraryStatus must NOT throw on a corrupt STATE.json');
  assert.equal(result?.status, 'unknown', 'corrupt STATE.json → unknown');
});

test('LIB-05 (7c): NEVER-THROW — a corrupt section PLAN.md does not crash derivation', { skip: !READY }, async () => {
  mkDataRoot();
  const root = mkPaperRoot();
  await seedState(root);
  fs.writeFileSync(path.join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  fs.writeFileSync(path.join(root, '.paper', 'OUTLINE.md'), '# Outline\n');

  const { initSection } = await import('../bin/lib/state.js');
  const { sectionPlan } = await import('../bin/lib/paths.js');

  await initSection(root, 1, 'intro');
  // Write a CORRUPT PLAN.md (alias to a missing anchor — genuinely throws through
  // parseFrontmatter per the [07-01] corrupt-fixture precedent).
  fs.mkdirSync(path.dirname(sectionPlan(1, 'intro', root)), { recursive: true });
  fs.writeFileSync(sectionPlan(1, 'intro', root), '---\nstatus: *missing_anchor\n---\n# intro\n');

  const { deriveLibraryStatus } = await glib();
  assert.doesNotThrow(() => {
    deriveLibraryStatus(root);
  }, 'a corrupt section PLAN.md must not crash deriveLibraryStatus');
});
