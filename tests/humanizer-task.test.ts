// tests/humanizer-task.test.ts — done's humanizer on the real user path
// (DONE-03; Phase 21 EXP-14, EXP-15, EXP-16; D-21-18, D-21-19): the BUILT CLI
// in a temp paper whose sections `pensmith verify` judged, the RUN-21 mock LLM
// named in the global runtime.json, and the fixture humanizer skill installed
// in the sandbox home (never the developer's real one).
//
// Replaces the Phase-6 Task-transport scaffold (`__setTaskRunnerForTest`, the
// `no Task transport` banner): the humanizer is now a real model call through
// complete() with the `humanizer` model slug. One paper walks through every
// outcome in turn, each asserting what done leaves behind:
//   - no skill → `humanizer skill not found at ~/.claude/skills/humanizer/SKILL.md
//     — skipping`, exit 0, the compiled draft exported, FINAL.md = DRAFT.md;
//   - `--raw` → zero humanizer requests, `humanizer skipped (--raw)`, the after
//     score `N/A (humanize skipped with --raw)`;
//   - a reply that drops a citation or adds `[@fake2099, p. 3]` → exit 4,
//     every reason, no export written, FINAL.md byte-identical;
//   - a provider failure (HTTP 500) → `humanizer failed: …`, the compiled draft
//     exported, the after score `N/A (humanizer failed: …)`;
//   - the cost cap → exit 5, nothing exported, FINAL.md byte-identical;
//   - the stub skill reply → the request's system prompt is the SKILL.md body
//     (cache_control-marked), FINAL.md differs from DRAFT.md with every
//     citation kept, the export holds the humanized text, the record says so;
//   - after a section redo, verify and recompile, a second done rewrites
//     FINAL.md and the export with the new text (EXP-15).

import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPipelinePaper, THREE_SECTIONS } from './helpers/pipeline-paper.js';
import { splitDraftSections } from '../bin/lib/humanizer.js';
import { maskForRewrite } from '../bin/lib/rewrite-guard.js';
import { findCitations } from '../bin/lib/citation-token.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';

const SKILL_BODY = parseFrontmatter(readFileSync(fileURLToPath(new URL('./fixtures/humanizer-skill/humanizer-skill.md', import.meta.url)), 'utf8')).body.trim();

function read(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function exportFiles(paper: string): string[] {
  const dir = join(paper, 'export');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** The masked text of compiled section `i` — what the humanizer request carries for it. */
function maskedSection(draft: string, i: number): string {
  const s = splitDraftSections(draft).sections[i]!;
  return maskForRewrite(s.body.replace(/^\n+|\n+$/g, ''), { namespace: i }).masked;
}

const citationsOf = (t: string): string[] => findCitations(t).map((c) => c.text).sort();

test('EXP-14 / EXP-15 (built CLI, mock LLM): every humanizer outcome on one paper — skipped, raw, rejected, failed, capped, accepted, and a second done after a redo', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS }, async (p) => {
    const paper = join(p.root, '.paper');
    const mock = p.sb.mock!;
    await p.verifyAll();
    const c = await p.cli(['compile', '--yolo', '--no-smooth']);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    const draft = readFileSync(join(paper, 'DRAFT.md'), 'utf8');

    // (a) No skill installed: skipped with the exact line, the compiled draft exported.
    let r = await p.cli(['done', '--yolo', '--format', 'md']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /pensmith done: humanizer skill not found at ~\/\.claude\/skills\/humanizer\/SKILL\.md — skipping/);
    assert.equal(mock.callCount('humanizer'), 0);
    assert.equal(read(join(paper, 'FINAL.md')), draft, 'FINAL.md is the compiled draft');
    assert.match(read(join(paper, 'VERIFICATION.md')) ?? '', /after humanize\):  N\/A \(humanizer not installed\)/);
    const rawFinal = read(join(paper, 'FINAL.md'));

    p.installHumanizerSkill();

    // (b) --raw: no humanizer request at all.
    r = await p.cli(['done', '--yolo', '--raw', '--format', 'md']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /pensmith done: humanizer skipped \(--raw\)/);
    assert.equal(mock.callCount('humanizer'), 0, '--raw sends no humanizer request');
    assert.match(read(join(paper, 'VERIFICATION.md')) ?? '', /after humanize\):  N\/A \(humanize skipped with --raw\)/);

    // (c, d) A reply that drops a citation, or adds one: refused, nothing exported, FINAL.md untouched.
    const exportsBefore = exportFiles(paper).map((f) => [f, statSync(join(paper, 'export', f)).mtimeMs] as const);
    const m0 = maskedSection(draft, 0);
    for (const [what, reply, reason] of [
      ['a dropped citation', m0.replace(/\s*\{\{cite_0_0\}\}/, ''), /placeholder|citation set changed/],
      ['an added citation', `${m0.trimEnd()} A later survey agrees [@fake2099, p. 3].`, /citation set changed|adds/],
    ] as const) {
      mock.reset();
      mock.script('humanizer', { text: reply });
      r = await p.cli(['done', '--yolo', '--format', 'md']);
      assert.equal(r.status, 4, `${what}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /GATE-04 BLOCKED — the humanized text failed re-verification; nothing was exported and FINAL\.md was not changed/, what);
      assert.match(r.stdout, reason, what);
      assert.match(r.stdout, /`pensmith done --raw` exports the compiled draft without the humanizer/, what);
      assert.equal(read(join(paper, 'FINAL.md')), rawFinal, `${what}: FINAL.md byte-identical`);
      assert.deepEqual(exportFiles(paper).map((f) => [f, statSync(join(paper, 'export', f)).mtimeMs] as const), exportsBefore, `${what}: no export written`);
      // Review round 2: the rejection is kept, bound to this compiled draft.
      const kept = read(join(paper, 'FINAL.rejected.md')) ?? '';
      assert.match(kept, new RegExp(`^Compiled draft: sha256 ${createHash('sha256').update(draft).digest('hex')}$`, 'm'), what);
      assert.match(r.stdout, /the reasons are kept in \.paper\/FINAL\.rejected\.md/, what);
    }

    // Review round 2: a bare `pensmith` (and `next`) does not bill the
    // humanizer again for the same compiled draft — attention naming
    // `pensmith done --raw` and `pensmith done`; no request is sent.
    // (A paper whose FINAL.md is the current raw export stays complete: there
    // is nothing to route to. A paper that has not been exported yet is the
    // case that looped — FINAL.md and the record are set aside to make it.)
    mock.reset();
    assert.match((await p.cli(['status'])).stdout, /current: complete/);
    rmSync(join(paper, 'FINAL.md'));
    rmSync(join(paper, 'DONE-RECORD.json'));
    const st = await p.cli(['status']);
    assert.match(st.stdout, /current: needs attention/);
    assert.match(st.stdout, /the humanizer's rewrite of the compiled draft was rejected \(the reasons are in \.paper\/FINAL\.rejected\.md\)/);
    for (const args of [['--yolo'], ['next', '--yolo']]) {
      const bare = await p.cli(args);
      assert.doesNotMatch(bare.stderr, /ran done/, args.join(' '));
      assert.equal(mock.callCount('humanizer'), 0, `${args.join(' ')}: no humanizer request`);
    }
    assert.equal(existsSync(join(paper, 'FINAL.md')), false, 'nothing written by the bare runs');

    // (e) A provider failure: `humanizer failed: …`, the compiled draft exported.
    mock.reset();
    mock.fail({ kind: 'http', status: 500, message: 'upstream exploded' }, { slug: 'humanizer', times: 20 });
    r = await p.cli(['done', '--yolo', '--format', 'md']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /pensmith done: humanizer failed: .+ — exporting the compiled draft/);
    assert.equal(read(join(paper, 'FINAL.md')), draft);
    assert.equal(existsSync(join(paper, 'FINAL.rejected.md')), false, 'an export removes the kept rejection');
    assert.match(read(join(paper, 'VERIFICATION.md')) ?? '', /after humanize\):  N\/A \(humanizer failed: /);

    // (f) The cost cap refuses the first humanizer call: exit 5, nothing exported or rewritten.
    mock.reset();
    const finalBytes = read(join(paper, 'FINAL.md'));
    const exportsNow = exportFiles(paper).map((f) => [f, statSync(join(paper, 'export', f)).mtimeMs] as const);
    r = await p.cli(['done', '--yolo', '--format', 'md'], { PENSMITH_COST_CAP_USD: '0.000001' });
    assert.equal(r.status, 5, r.stdout + r.stderr);
    assert.equal(mock.callCount('humanizer'), 0, 'refused before the request');
    assert.equal(read(join(paper, 'FINAL.md')), finalBytes);
    assert.deepEqual(exportFiles(paper).map((f) => [f, statSync(join(paper, 'export', f)).mtimeMs] as const), exportsNow);

    // (g) Accepted: the stub skill reply keeps every citation; FINAL.md and the export hold it.
    mock.reset();
    r = await p.cli(['done', '--yolo', '--format', 'md']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(mock.callCount('humanizer'), THREE_SECTIONS.length, 'one request per section');
    const body = mock.bodiesFor('humanizer')[0]!;
    assert.match(JSON.stringify(body['system']), /cache_control/, 'the system prompt is cache_control-marked');
    assert.ok(JSON.stringify(body['system']).includes(JSON.stringify(SKILL_BODY).slice(1, -1)), 'the system prompt is the SKILL.md body');
    const finalMd = read(join(paper, 'FINAL.md')) ?? '';
    assert.notEqual(finalMd, draft, 'FINAL.md differs from DRAFT.md');
    assert.deepEqual(citationsOf(finalMd), citationsOf(draft), 'every citation kept, as written');
    assert.equal(read(join(paper, 'DRAFT.md')), draft, 'DRAFT.md untouched');
    const exported = read(join(paper, 'export', 'DRAFT.md')) ?? '';
    assert.match(exported, /Put simply:/, 'the export derives from the humanized FINAL.md');
    assert.match(read(join(paper, 'VERIFICATION.md')) ?? '', /^Text checked: \.paper\/FINAL\.md/m);
    const record = JSON.parse(read(join(paper, 'DONE-RECORD.json')) ?? '{}') as Record<string, unknown>;
    assert.equal(record['humanized'], true);

    // (h) EXP-15: redo §2, verify, recompile — the next done rewrites FINAL.md and the export.
    writeFileSync(
      join(p.sectionDir(2, 'measurement'), 'DRAFT.md'),
      'Measurement in quantum physics limits what an observer can record about a system [@aspelmeyer2009].\n\n' +
        'Careful experimental design keeps that influence small enough to report honestly [@aspelmeyer2009].\n',
    );
    const v = await p.cli(['verify', '2']);
    assert.equal(v.status, 0, v.stdout + v.stderr);
    const c2 = await p.cli(['compile', '--yolo', '--no-smooth']);
    assert.equal(c2.status, 0, c2.stdout + c2.stderr);
    mock.reset();
    r = await p.cli(['done', '--yolo', '--format', 'md']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(read(join(paper, 'FINAL.md')) ?? '', /limits what an observer can record/);
    assert.match(read(join(paper, 'export', 'DRAFT.md')) ?? '', /limits what an observer can record/);
    rmSync(join(paper, 'export'), { recursive: true, force: true });
  });
});

test('EXP-14: the Task-transport banner and seam are gone from bin, mcp, hooks and plugin (21-PLAN §7.3)', () => {
  // The committed bundles under plugin/dist are built from these sources and
  // drift-checked by `npm run bundle:check`, so they are not read here.
  const root = fileURLToPath(new URL('..', import.meta.url));
  const skip = new Set([join(root, 'plugin', 'dist')]);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (skip.has(full)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(?:ts|mjs|cjs|js|md|json)$/.test(name)) files.push(full);
    }
  };
  for (const top of ['bin', 'mcp', 'hooks', 'plugin']) walk(join(root, top));
  assert.ok(files.length > 50, `scanned ${files.length} files`);
  const hits = files.filter((f) => /no Task transport|TaskRunner|__setTaskRunnerForTest|runHumanizer\b/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});
