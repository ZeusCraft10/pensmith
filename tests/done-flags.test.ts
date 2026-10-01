// tests/done-flags.test.ts — done's flags and the four aliases (Phase 21
// EXP-21, EXP-03, EXP-15..EXP-20; D-21-23, D-21-24, D-21-19) on the BUILT CLI
// in a temp paper whose sections `pensmith verify` judged, with the RUN-21 mock
// LLM named in the global runtime.json.
//
//   - `done --help` lists every flag and the aliases;
//   - a bad flag combination is EXIT_USAGE before anything is read or sent:
//     `--no-verify --raw` without --yolo (PRD §7.9's refusal), `--format html`
//     (listing md, docx, pdf, latex (tex)), `--only bogus`, `--style bogus`
//     (listing the 8 styles and the path form), `export --only score`;
//   - `--no-verify --raw --yolo` runs — and a FABRICATED citation still blocks;
//   - `score` prints the score line and writes nothing; `plagiarism` prints the
//     check and writes nothing; `humanize` runs the gate first, then writes
//     FINAL.md and the record and exports nothing; `export` gates, asks the
//     confirmation, exports FINAL.md when it is done's own and current
//     (re-gated) and writes the record;
//   - `--no-plagiarism-check`, `--no-score`, `--no-verify`, `--format tex` and
//     `--style` each do what they say, and every run prints `style: … (from …)`.
//   - The 16 verbs are unchanged (tests/cli-verbs.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withPipelinePaper, THREE_SECTIONS, type PipelinePaper } from './helpers/pipeline-paper.js';
import { FAKE_DOI_BIB, LECUN_BIB } from './helpers/gate-paper.js';
import { UX02_VERBS } from '../bin/lib/verbs.js';

function read(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Every file of the paper folder but SESSION.log / COSTS.jsonl, with its mtime (what "writes nothing" compares). */
function snapshot(paper: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string, rel: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const r = rel === '' ? name : `${rel}/${name}`;
      if (r === 'SESSION.log' || r === 'COSTS.jsonl' || r.endsWith('.lock')) continue;
      const st = statSync(p);
      if (st.isDirectory()) walk(p, r);
      else out.set(r, st.mtimeMs);
    }
  };
  walk(paper, '');
  return out;
}

async function compiled(p: PipelinePaper): Promise<string> {
  await p.verifyAll();
  const c = await p.cli(['compile', '--yolo', '--no-smooth']);
  assert.equal(c.status, 0, c.stdout + c.stderr);
  return readFileSync(join(p.root, '.paper', 'DRAFT.md'), 'utf8');
}

test('EXP-21: done --help lists the seven flags, --only and the aliases', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS }, async (p) => {
    const r = await p.cli(['done', '--help']);
    assert.equal(r.status, 0, r.stderr);
    for (const flag of ['--yolo', '--format', '--style', '--raw', '--no-verify', '--no-score', '--no-plagiarism-check', '--only']) {
      assert.ok(r.stdout.includes(flag), `${flag} in done --help`);
    }
    for (const alias of ['export', 'humanize', 'score', 'plagiarism']) assert.match(r.stdout, new RegExp(`^  ${alias}\\s+pensmith done --only ${alias}$`, 'm'));
    assert.equal(UX02_VERBS.length, 16);
  });
});

test('EXP-21: bad flags are EXIT_USAGE before anything is read, written or sent', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS }, async (p) => {
    const paper = join(p.root, '.paper');
    const before = snapshot(paper);
    const cases: Array<[string[], RegExp]> = [
      [['done', '--no-verify', '--raw'], /^pensmith done: --no-verify cannot be combined with --raw without --yolo \(PRD §7\.9\)/m],
      [['done', '--format', 'html'], /^pensmith done: unknown --format 'html' — use one of md, docx, pdf, latex \(tex\)$/m],
      [['done', '--only', 'bogus'], /^pensmith done: unknown --only step 'bogus' — use one of export, humanize, score, plagiarism$/m],
      [['done', '--style', 'bogus'], /--style: unknown citation style "bogus" — use one of APA, MLA, .* or a path to a local \.csl file/],
      [['done', '--only', 'score', '--no-score'], /--only score cannot be combined with --no-score/],
      [['export', '--only', 'score'], /'pensmith export' is 'pensmith done --only export' — it takes no --only of its own/],
      [['export', '--format', 'html'], /unknown --format 'html'/],
    ];
    for (const [args, re] of cases) {
      const r = await p.cli(args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, re, args.join(' '));
    }
    assert.deepEqual(snapshot(paper), before, 'nothing was written');
    assert.equal(p.sb.mock!.requests.length, 0, 'no model call');
  });
});

test('EXP-21 (built CLI): --no-verify --raw --yolo runs; a FABRICATED citation still blocks it', async () => {
  const sections = [
    { n: 1, slug: 'claims', title: 'Claims', assigned: ['fake2017'], draft: 'A study that does not exist reports a large effect on everything measured [@fake2017].\n' },
  ];
  await withPipelinePaper({ sections, bib: LECUN_BIB + FAKE_DOI_BIB }, async (p) => {
    const v = await p.cli(['verify', '1']);
    assert.equal(v.status, 4, 'the section fails verification');
    const r = await p.cli(['done', '--no-verify', '--raw', '--yolo']);
    assert.equal(r.status, 4, r.stdout + r.stderr);
    assert.match(r.stdout, /BLOCKED/);
    assert.match(r.stderr, /--no-verify skips only the whole-paper Pass 4 audit; the blocking re-verification of every citation always runs/);
    assert.ok(!existsSync(join(p.root, '.paper', 'export')), 'nothing exported');
  });
});

test('EXP-21 / EXP-16 / EXP-19 (built CLI): score and plagiarism print and write nothing; humanize writes FINAL.md and the record only after the gate; export renders it', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS }, async (p) => {
    const paper = join(p.root, '.paper');
    const draft = await compiled(p);

    // score: the before score (here: no key, then offline), nothing written.
    let before = snapshot(paper);
    let r = await p.cli(['score']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Pensmith honesty check: skipped \(no GPTZERO_API_KEY set\)$/m);
    assert.match(r.stdout, /Note: this score reflects prose patterns/);
    r = await p.cli(['score'], { GPTZERO_API_KEY: 'test-key-score-alias' });
    assert.match(r.stdout, /^Pensmith honesty check: unavailable \(offline\)$/m);
    assert.ok(!r.stdout.includes('test-key-score-alias') && !r.stderr.includes('test-key-score-alias'));
    assert.deepEqual(snapshot(paper), before, 'score writes nothing');
    assert.doesNotMatch(r.stdout, /style:/, 'score resolves no export style');

    // plagiarism: the check (offline here), nothing written.
    r = await p.cli(['plagiarism']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^pensmith done: plagiarism check skipped \(offline\)$/m);
    assert.deepEqual(snapshot(paper), before, 'plagiarism writes nothing');

    // humanize: the gate first — a section edited since its verification refuses it.
    const sec1 = join(p.sectionDir(1, 'learning'), 'DRAFT.md');
    const original = readFileSync(sec1, 'utf8');
    writeFileSync(sec1, original.replace('several levels', 'many levels'));
    p.installHumanizerSkill();
    r = await p.cli(['humanize']);
    assert.equal(r.status, 4, r.stdout + r.stderr);
    assert.equal(p.sb.mock!.callCount('humanizer'), 0, 'the gate runs before any humanizer request');
    writeFileSync(sec1, original);

    // humanize, gated: FINAL.md and the record, no export, no confirmation needed.
    before = snapshot(paper);
    r = await p.cli(['humanize']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /wrote \.paper\/FINAL\.md \(humanized; `pensmith export` renders it\)/);
    const finalMd = read(join(paper, 'FINAL.md')) ?? '';
    assert.notEqual(finalMd, draft);
    assert.equal(JSON.parse(read(join(paper, 'DONE-RECORD.json')) ?? '{}')['humanized'], true);
    assert.ok(!existsSync(join(paper, 'export')), 'humanize exports nothing');
    assert.equal(snapshot(paper).get('DRAFT.md'), before.get('DRAFT.md'), 'DRAFT.md untouched');

    // export: the confirmation applies (no terminal, no --yolo → exit 3, nothing exported) ...
    r = await p.cli(['export', '--format', 'md']);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.ok(!existsSync(join(paper, 'export')));
    // ... and with --yolo it renders done's own, current FINAL.md (re-gated).
    r = await p.cli(['export', '--format', 'md', '--yolo', '--style', 'mla']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^pensmith done: style: mla \(from --style\)$/m);
    assert.match(read(join(paper, 'export', 'DRAFT.md')) ?? '', /Put simply:/, 'the export holds the humanized FINAL.md');
    assert.equal(read(join(paper, 'FINAL.md')), finalMd, 'FINAL.md unchanged');
    const verification = read(join(paper, 'VERIFICATION.md')) ?? '';
    assert.match(verification, /^Text checked: \.paper\/FINAL\.md/m);
    assert.match(verification, /plagiarism check skipped \(--only export\)/);
    assert.equal(p.sb.mock!.callCount('humanizer'), THREE_SECTIONS.length, 'export sends no humanizer request');
  });
});

test('EXP-20 / EXP-16 / EXP-21 (built CLI): --no-plagiarism-check, --no-score, --no-verify and --format tex do what they say', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS, intake: { discipline: 'computer science', citationStyle: 'apa' } }, async (p) => {
    const paper = join(p.root, '.paper');
    await compiled(p);
    const r = await p.cli(['done', '--yolo', '--no-plagiarism-check', '--no-score', '--no-verify', '--format', 'tex'], { GPTZERO_API_KEY: 'test-key-noscore' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^pensmith done: style: apa \(from INTAKE\.md\)$/m);
    assert.match(r.stdout, /^pensmith done: plagiarism check skipped \(--no-plagiarism-check\)$/m);
    assert.match(r.stdout, /Pensmith honesty check \(before humanize\): skipped \(--no-score\)/);
    assert.match(r.stderr, /--no-verify skips only the whole-paper Pass 4 audit/);
    assert.ok(existsSync(join(paper, 'export', 'DRAFT.tex')), 'tex is latex');
    const verification = read(join(paper, 'VERIFICATION.md')) ?? '';
    assert.match(verification, /plagiarism check skipped \(--no-plagiarism-check\)/);
    assert.match(verification, /whole-paper Pass 4 skipped \(--no-verify\)/);
    assert.match(verification, /skipped \(--no-score\)/);
    assert.doesNotMatch(read(join(paper, 'SESSION.log')) ?? '', /duckduckgo|gptzero/i, 'no detector or search request was made');
  });
});
