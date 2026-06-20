// tests/tutorial-provenance.test.ts — Phase 9 Wave 0 RED-by-skip provenance suite.
//
// Pins the TUTORIAL.md provenance CONTRACTS the Wave-1 render (09-02) must
// satisfy. RED-by-skip via the SAME SOURCE-GREP as tutorial-observer
// (tutorialRenderWired) so the suite stays GREEN until the subscriber renders.
//
// Contracts:
//   (a) SECTION-stage (goal=both): a section.written event with assignedSources
//       yields a `## Section` provenance header naming the citekeys.
//   (b) RESEARCH-stage per-claim (H2 — THE load-bearing learning-mode contract):
//       a research.done event carrying the curated sources + per-source claim
//       mapping yields ≥1 per-claim provenance line naming a citekey AND its
//       supported claim — asserted WITHOUT any section.written ever being
//       emitted (proves learning mode produces per-claim provenance at/before
//       the research hard-stop).
//   (c) TUTORIAL.md content never references `.paper/sections/` paths.
//   (d) export-exclusion (structural): exportDraft reads ONLY inputPath, so a
//       sibling TUTORIAL.md never leaks into an export.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

// Same wired-render detector as tutorial-observer.test.ts.
function tutorialRenderWired(): boolean {
  const p = repoPath('bin/lib/tutorial.ts');
  if (!fs.existsSync(p)) return false;
  const src = fs.readFileSync(p, 'utf8');
  return /atomicWriteFile\(/.test(src) && /provenance|citekey|## Section|## Research/i.test(src);
}

const RENDER_READY = tutorialRenderWired();

const TUTORIAL_MOD = new URL('../bin/lib/tutorial.js', import.meta.url);
interface TutorialMod {
  TutorialSubscriber: new (opts: { tutorialPath: string; goal: 'learning' | 'both' }) => {
    emit: (e: { kind: string; payload: unknown }) => void;
    flush: () => Promise<void>;
  };
}

const FIXTURE = repoPath('tests/fixtures/tutorial-paper');

function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-tutorial-prov-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

/** Read the curated research.done payload from the committed RESEARCH/LIBRARY fixtures. */
function researchDonePayload(): unknown {
  const library = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'LIBRARY.json'), 'utf8'));
  const research = fs.readFileSync(path.join(FIXTURE, 'RESEARCH.md'), 'utf8');
  // The per-claim mapping: one entry per `### <citekey>` + its `supports:` line.
  const claims: Array<{ citekey: string; claim: string }> = [];
  const blocks = research.split(/^### /m).slice(1);
  for (const block of blocks) {
    const citekey = block.split(/\s|\n/)[0]?.trim() ?? '';
    const m = /supports:\s*([\s\S]+?)(?:\n\n|\n###|$)/.exec(block);
    const claim = m?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    if (citekey && claim) claims.push({ citekey, claim });
  }
  return { sources: library, claims };
}

test('SECTION-stage (goal=both): section.written yields a ## Section provenance header naming citekeys', { skip: !RENDER_READY }, async () => {
  const root = mkPaperRoot();
  const tutorialPath = path.join(root, '.paper', 'TUTORIAL.md');
  fs.mkdirSync(path.dirname(tutorialPath), { recursive: true });

  const { TutorialSubscriber } = (await import(TUTORIAL_MOD.href)) as TutorialMod;
  const sub = new TutorialSubscriber({ tutorialPath, goal: 'both' });
  sub.emit({
    kind: 'section.written',
    payload: { n: 1, slug: 'background', assignedSources: ['smith2021', 'jones2019'] },
  });
  await sub.flush();

  const md = fs.readFileSync(tutorialPath, 'utf8');
  assert.match(md, /## Section/, 'expected a ## Section provenance header');
  assert.match(md, /smith2021/, 'expected citekey smith2021 named');
  assert.match(md, /jones2019/, 'expected citekey jones2019 named');
});

test('RESEARCH-stage per-claim (H2): research.done yields ≥1 citekey+claim line WITHOUT any section.written', { skip: !RENDER_READY }, async () => {
  const root = mkPaperRoot();
  const tutorialPath = path.join(root, '.paper', 'TUTORIAL.md');
  fs.mkdirSync(path.dirname(tutorialPath), { recursive: true });

  const { TutorialSubscriber } = (await import(TUTORIAL_MOD.href)) as TutorialMod;
  const sub = new TutorialSubscriber({ tutorialPath, goal: 'learning' });
  // ONLY a research.done event — NO section.written EVER fires. This proves
  // learning mode produces per-claim provenance from RESEARCH-stage data, at the
  // hard-stop, before any section exists.
  sub.emit({ kind: 'research.done', payload: researchDonePayload() });
  await sub.flush();

  const md = fs.readFileSync(tutorialPath, 'utf8');
  // ≥1 line that names a citekey AND a fragment of its supported claim.
  const lines = md.split(/\r?\n/);
  const provLine = lines.find(
    (l) =>
      /smith2021/.test(l) && /sub-quadratic/i.test(l) ||
      /jones2019/.test(l) && /benchmark/i.test(l),
  );
  assert.ok(
    provLine,
    `expected ≥1 per-claim provenance line naming a citekey AND its supported claim; got:\n${md}`,
  );
});

test('TUTORIAL.md never references .paper/sections/ paths', { skip: !RENDER_READY }, async () => {
  const root = mkPaperRoot();
  const tutorialPath = path.join(root, '.paper', 'TUTORIAL.md');
  fs.mkdirSync(path.dirname(tutorialPath), { recursive: true });

  const { TutorialSubscriber } = (await import(TUTORIAL_MOD.href)) as TutorialMod;
  const sub = new TutorialSubscriber({ tutorialPath, goal: 'both' });
  sub.emit({
    kind: 'section.written',
    payload: { n: 1, slug: 'background', assignedSources: ['smith2021'] },
  });
  await sub.flush();

  const md = fs.readFileSync(tutorialPath, 'utf8');
  assert.ok(!/\.paper[\\/]sections[\\/]/.test(md), `TUTORIAL.md must not reference .paper/sections/ paths; got:\n${md}`);
});

test('idempotence: re-emitting the same events produces byte-stable TUTORIAL.md (overwrite, not grow)', { skip: !RENDER_READY }, async () => {
  const root = mkPaperRoot();
  const tutorialPath = path.join(root, '.paper', 'TUTORIAL.md');
  fs.mkdirSync(path.dirname(tutorialPath), { recursive: true });

  const { TutorialSubscriber } = (await import(TUTORIAL_MOD.href)) as TutorialMod;

  async function renderOnce(): Promise<string> {
    const sub = new TutorialSubscriber({ tutorialPath, goal: 'both' });
    sub.emit({ kind: 'research.done', payload: researchDonePayload() });
    sub.emit({
      kind: 'section.written',
      payload: { n: 1, slug: 'background', assignedSources: ['smith2021', 'jones2019'] },
    });
    await sub.flush();
    return fs.readFileSync(tutorialPath, 'utf8');
  }

  const first = await renderOnce();
  const second = await renderOnce();
  assert.equal(second, first, 're-running with the same events must produce identical TUTORIAL.md (idempotent overwrite, not append-duplicate)');
  // And a single source line is not duplicated within one render.
  const smithCount = (first.match(/smith2021/g) ?? []).length;
  assert.ok(smithCount >= 1, 'expected smith2021 to appear');
  const secondSmithCount = (second.match(/smith2021/g) ?? []).length;
  assert.equal(secondSmithCount, smithCount, 're-render must not grow the smith2021 occurrence count');
});

// Export-exclusion is STRUCTURAL: exporter reads only inputPath. This test wakes
// up on exporter presence (it already exists from Phase 6) and proves a sibling
// TUTORIAL.md does NOT leak into an export.
const EXPORTER_MOD = new URL('../bin/lib/exporter.js', import.meta.url);
function exporterReady(): boolean {
  return fs.existsSync(repoPath('bin/lib/exporter.ts'));
}
interface ExporterMod {
  exportDraft: (opts: {
    inputPath: string;
    outputDir?: string;
    format: 'md' | 'pdf' | 'docx' | 'latex';
    paperRoot?: string;
    pandocPresent?: boolean;
  }) => Promise<{ outputPath: string }>;
}

test('export-exclusion (structural): exportDraft reads only inputPath — sibling TUTORIAL.md never leaks', { skip: !exporterReady() }, async () => {
  const root = mkPaperRoot();
  const paper = path.join(root, '.paper');
  fs.mkdirSync(paper, { recursive: true });
  const draftPath = path.join(paper, 'DRAFT.md');
  fs.writeFileSync(draftPath, '# Draft\n\nThe only content that should be exported.\n');
  // A sibling TUTORIAL.md with a UNIQUE sentinel the export must NOT contain.
  const sentinel = 'TUTORIAL_LEAK_SENTINEL_2f8c';
  fs.writeFileSync(path.join(paper, 'TUTORIAL.md'), `# Tutorial\n\n${sentinel}\n`);

  const { exportDraft } = (await import(EXPORTER_MOD.href)) as ExporterMod;
  const outDir = path.join(paper, 'export');
  const res = await exportDraft({
    inputPath: draftPath,
    outputDir: outDir,
    format: 'md',
    paperRoot: root,
    pandocPresent: false,
  });
  const exported = fs.readFileSync(res.outputPath, 'utf8');
  assert.ok(!exported.includes(sentinel), `export leaked TUTORIAL.md content; exported:\n${exported}`);
});
