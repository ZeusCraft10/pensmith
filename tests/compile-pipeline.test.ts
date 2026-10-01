// tests/compile-pipeline.test.ts — Phase 21 compile on the real user path
// (EXP-05, EXP-10, EXP-11, EXP-12, EXP-13): the BUILT CLI in a temp paper,
// sections verified by `pensmith verify`, the RUN-21 mock LLM named in the
// global runtime.json.
//
//   - EXP-05: DRAFT.md starts with `# <title>` and has `## <section title>` per
//     section in outline order;
//   - EXP-10: a placeholder-preserving smoother → `boundary 1→2: smoothed`,
//     only the four boundary paragraphs differ from the raw concatenation,
//     every citation token byte-identical, sections/* untouched; a mock that
//     drops a citation → `rejected (citation set changed)` and the raw text
//     kept; PENSMITH_NO_LLM / --no-smooth / config give their skip reasons;
//   - EXP-11: the "X causes Y" / "no relationship between X and Y" fixture →
//     `Contradictions flagged: 1 (target 0)` with both sentences (model), the
//     heuristic alone flags it (PENSMITH_NO_LLM), a consistent paper → 0, the
//     cap is honoured;
//   - EXP-12: bare `pensmith next` on a computer-science paper names the
//     discipline with its source and band 1–3; config min/max change the band;
//   - EXP-13: COMPILE-REPORT has the transitions with before/after text,
//     Advisory Findings from each section record, the Contradictions and the
//     density sections, the title in its frontmatter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { withPipelinePaper, THREE_SECTIONS, type PipelineSection } from './helpers/pipeline-paper.js';
import { openChainSandbox } from './helpers/e2e-chain.js';
import { maskForRewrite } from '../bin/lib/rewrite-guard.js';
import { findCitations } from '../bin/lib/citation-token.js';
import { loadPrompt } from '../bin/lib/prompt-loader.js';
import { fileURLToPath } from 'node:url';

interface ContradictionFixture {
  sections: Array<{ n: number; slug: string; title: string; assigned: string[]; draft: string; claims: string[] }>;
}
const fixture = (name: string): ContradictionFixture =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/contradictions/${name}.json`, import.meta.url)), 'utf8')) as ContradictionFixture;
const contradictionFixture = fixture('x-causes-y');
const consistentFixture = fixture('consistent');

const TITLE = 'Deep Learning and Measurement';

function mtimes(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.set(relative(dir, p), st.mtimeMs);
    }
  };
  walk(dir);
  return out;
}

/** The raw compiled text compile writes when no boundary is smoothed. */
function rawCompiled(sections: readonly PipelineSection[], title = TITLE): string {
  return `# ${title}\n\n${sections.map((s) => `## ${s.title}\n\n${s.draft.replace(/\n+$/, '')}\n`).join('\n')}`;
}

/** The boundary window of sections k and k+1 (last paragraph of k, first of k+1). */
function windowOf(sections: readonly PipelineSection[], k: number): string {
  const left = sections[k]!.draft.trim().split(/\n\s*\n/);
  const right = sections[k + 1]!.draft.trim().split(/\n\s*\n/);
  return `${left[left.length - 1]}\n\n${right[0]}`;
}

function report(root: string): string {
  return readFileSync(join(root, '.paper', 'COMPILE-REPORT.md'), 'utf8');
}

test('EXP-05 / EXP-10 / EXP-13 (built CLI, mock LLM): a placeholder-preserving smoother smooths both boundaries — only the boundary paragraphs change, citations byte-identical, sections untouched, the report fully populated', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS }, async (p) => {
    await p.verifyAll();
    for (let k = 0; k < 2; k += 1) {
      const [tail, head] = maskForRewrite(windowOf(THREE_SECTIONS, k), { namespace: k }).masked.split('\n\n');
      p.sb.mock!.script('smoother', { text: `${tail} The next section turns from this result to a new question.\n\n${head} That question frames this section.` });
    }
    const sectionsBefore = mtimes(join(p.root, '.paper', 'sections'));
    const r = await p.cli(['compile', '--yolo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /boundary 1→2: smoothed/);
    assert.match(r.stdout, /boundary 2→3: smoothed/);

    // The smoother saw masked text only, through the pinned template.
    assert.equal(p.sb.mock!.callCount('smoother'), 2, 'N-1 = 2 boundary calls');
    for (const body of p.sb.mock!.bodiesFor('smoother')) {
      assert.deepEqual((body['system'] as Array<{ text: string }>)[0]!.text, loadPrompt('smoother'));
      const msg = (body['messages'] as Array<{ content: string }>)[0]!.content;
      assert.doesNotMatch(msg, /\[@/, 'no raw citation reaches the model');
      assert.match(msg, /\{\{cite_\d_\d\}\}/);
    }

    const draft = readFileSync(join(p.root, '.paper', 'DRAFT.md'), 'utf8');
    // EXP-05: the title, then each section heading in outline order.
    assert.ok(draft.startsWith(`# ${TITLE}\n\n## Learning Representations\n\n`), draft.slice(0, 120));
    const headings = draft.split('\n').filter((l) => l.startsWith('#'));
    assert.deepEqual(headings, [`# ${TITLE}`, '## Learning Representations', '## Measurement in Physics', '## An Outbreak Case']);

    // Only the boundary paragraphs differ from the raw concatenation.
    const raw = rawCompiled(THREE_SECTIONS).split('\n\n');
    const now = draft.split('\n\n');
    assert.equal(now.length, raw.length);
    const changed = raw.flatMap((para, i) => (para === now[i] ? [] : [i]));
    // paragraphs: 0 title, 1 §1 heading, 2-3 §1, 4 §2 heading, 5-6 §2, 7 §3 heading, 8-9 §3
    assert.deepEqual(changed, [3, 5, 6, 8], 'the last paragraph of §1 and §2 and the first of §2 and §3');
    assert.match(now[3]!, /The next section turns from this result to a new question\./);
    // Every citation token byte-identical.
    const cites = (t: string): string[] => findCitations(t).map((c) => c.text).sort();
    assert.deepEqual(cites(draft), cites(rawCompiled(THREE_SECTIONS)));
    assert.deepEqual(mtimes(join(p.root, '.paper', 'sections')), sectionsBefore, 'sections/* are never written');

    const md = report(p.root);
    assert.match(md, new RegExp(`^title: '${TITLE}'$`, 'm'), 'the frontmatter carries the paper title');
    assert.match(md, /^- boundary 1→2: smoothed \(before=\d+ chars, after=\d+ chars\)$/m);
    assert.match(md, /^- boundary 2→3: smoothed /m);
    assert.equal((md.match(/^ {2}- before: "/gm) ?? []).length, 2);
    assert.equal((md.match(/^ {2}- after: ".*The next section turns/gm) ?? []).length, 2);
    // Advisory Findings from each section's own record (Pass 2 judged by the mock: UNCLEAR rows).
    const adv = md.slice(md.indexOf('## Advisory Findings'), md.indexOf('## Accepted Quotes'));
    for (const s of ['§1 (learning)', '§2 (measurement)', '§3 (outbreak)']) assert.ok(adv.includes(`- ${s}:`), s);
    assert.match(adv, /claim support \(Pass 2\): \d+ claim\(s\) not SUPPORTED\n {4}- row 1 \[@lecun2015\] UNCLEAR:/);
    assert.match(adv, /orphan claims \(Pass 4\): /);
    assert.doesNotMatch(md, /Phase 5 will populate/);
    assert.match(md, /## Contradictions\n\nContradictions flagged: 0 \(target 0\)/);
    assert.match(md, /^Discipline: other \(from preset default\) · band 1–3 citations per paragraph \(from other preset\)/m);
  });
});

test('EXP-10 (built CLI, mock LLM): a smoother that drops a citation is rejected — `rejected (citation set changed)`, the raw text kept', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS }, async (p) => {
    await p.verifyAll();
    const [tail] = maskForRewrite(windowOf(THREE_SECTIONS, 0), { namespace: 0 }).masked.split('\n\n');
    p.sb.mock!.script('smoother', { text: `${tail}\n\nMeasurement in quantum physics shapes what an observer records.` });
    const r = await p.cli(['compile', '--yolo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /boundary 1→2: rejected \(citation set changed\)/);
    const md = report(p.root);
    assert.match(md, /^- boundary 1→2: rejected \(citation set changed\) /m);
    const draft = readFileSync(join(p.root, '.paper', 'DRAFT.md'), 'utf8');
    assert.ok(draft.includes(THREE_SECTIONS[1]!.draft.split('\n\n')[0]!), 'the raw head of §2 is kept');
    assert.match(draft, /\[@aspelmeyer2009\]/);
  });
});

test('EXP-10 / EXP-13 (built CLI): PENSMITH_NO_LLM, --no-smooth, --raw and [compile] smooth_transitions = false skip smoothing, each naming its reason', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS }, async (p) => {
    await p.verifyAll();
    const cases: ReadonlyArray<readonly [string[], Record<string, string>, string]> = [
      [['compile', '--yolo'], { PENSMITH_NO_LLM: '1' }, 'no LLM'],
      [['compile', '--yolo', '--no-smooth'], {}, '--no-smooth'],
      [['compile', '--yolo', '--raw'], {}, '--raw'],
    ];
    for (const [args, env, reason] of cases) {
      const r = await p.cli(args, env);
      assert.equal(r.status, 0, `${reason}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, new RegExp(`smoothing skipped \\(${reason.replace(/-/g, '\\-')}\\)`), reason);
      const md = report(p.root);
      assert.ok(md.includes(`_smoothing skipped (${reason}) — every boundary keeps the section text as verified._`), reason);
      assert.match(md, new RegExp(`^- boundary 1→2: skipped \\(${reason.replace(/-/g, '\\-')}\\)`, 'm'));
      assert.equal(readFileSync(join(p.root, '.paper', 'DRAFT.md'), 'utf8'), rawCompiled(THREE_SECTIONS), `${reason}: the raw concatenation`);
    }
    writeFileSync(join(p.root, '.paper', 'config.toml'), 'schema_version = 4\n[compile]\nsmooth_transitions = false\n');
    const r = await p.cli(['compile', '--yolo']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(report(p.root), /_smoothing skipped \(config\)/);
    assert.equal(p.sb.mock!.callCount('smoother'), 0, 'no smoother request in any skipped run');
  });
});

function fixtureSections(f: ContradictionFixture): PipelineSection[] {
  return f.sections.map((s) => ({ n: s.n, slug: s.slug, title: s.title, assigned: s.assigned, draft: s.draft, claims: s.claims }));
}

test('EXP-11 (built CLI, mock LLM): "X causes Y" in §2 against "no relationship between X and Y" in §3 is 1 contradiction citing both sentences; the heuristic alone flags it with no LLM', async () => {
  const sections = fixtureSections(contradictionFixture);
  await withPipelinePaper({ sections }, async (p) => {
    await p.verifyAll();
    // No LLM: the deterministic floor alone flags the pair.
    const r0 = await p.cli(['compile', '--yolo', '--no-smooth'], { PENSMITH_NO_LLM: '1' });
    assert.equal(r0.status, 0, r0.stderr);
    const heuristicOnly = report(p.root);
    assert.match(heuristicOnly, /Contradictions flagged: 1 \(target 0\)/, 'the heuristic floor flags the pair offline');
    assert.match(heuristicOnly, /model check skipped \(no LLM\) — the deterministic heuristic ran alone/);
    const flagged = heuristicOnly.split('\n').find((l) => l.includes('flagged by the heuristic (negation; not judged by the model)'));
    assert.ok(flagged, heuristicOnly);
    assert.match(flagged!, /§2 \(Screen Time and Sleep\) "Heavy screen time causes sleep loss/);
    assert.match(flagged!, /§3 \(A Second Look\) "There is no relationship between screen time and sleep loss/);
    assert.equal(p.sb.mock!.callCount('claim-consistency'), 0, 'no model call with no LLM');

    // With the model: one call; the pairs are fenced, the heuristic pair first.
    const r = await p.cli(['compile', '--yolo', '--no-smooth']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(p.sb.mock!.callCount('claim-consistency'), 1, 'one claim-consistency call');
    const body = p.sb.mock!.bodiesFor('claim-consistency')[0]!;
    assert.equal((body['system'] as Array<{ text: string }>)[0]!.text, loadPrompt('claim-consistency'));
    const msg = (body['messages'] as Array<{ content: string }>)[0]!.content;
    const pairs = JSON.parse(/<pairs>\n<<<PENSMITH_UNTRUSTED_DATA_[^>]+>>>\n([\s\S]*?)\n<<<END_PENSMITH_UNTRUSTED_DATA_[^>]+>>>\n<\/pairs>/.exec(msg)![1]!) as Array<{ id: string; sentence_a: string; sentence_b: string }>;
    assert.ok(pairs.length >= 1);
    assert.equal(pairs[0]!.id, 'p1');
    assert.match(pairs[0]!.sentence_a + pairs[0]!.sentence_b, /no relationship/, 'the heuristic pair ranks first');
    // The mock's contract stub answers UNCLEAR: the model judged the pair, so it is listed but not counted.
    const md = report(p.root);
    assert.match(md, /Contradictions flagged: 0 \(target 0\)/);
    assert.match(md, /Heuristic flags the model judged UNCLEAR \(not counted — review them\):\n- §2/);
  });
});

test('EXP-11 (built CLI, mock LLM): the model\'s CONTRADICTS is counted with both sentences; a heuristic flag it clears is listed, not counted; a consistent paper gives 0; the cap is honoured', async () => {
  const sections = fixtureSections(contradictionFixture);
  await withPipelinePaper({ sections }, async (p) => {
    await p.verifyAll();
    p.sb.mock!.script('claim-consistency', { data: { pairs: [{ id: 'p1', verdict: 'CONTRADICTS', rationale: 'One asserts a causal effect the other denies.' }] } });
    const r = await p.cli(['compile', '--yolo', '--no-smooth']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Contradictions flagged: 1 \(target 0\)/);
    const md = report(p.root);
    assert.match(md, /Contradictions flagged: 1 \(target 0\)/);
    const line = md.split('\n').find((l) => l.includes('CONTRADICTS (model)'));
    assert.ok(line, md);
    assert.match(line!, /§2 \(Screen Time and Sleep\) ".*causes.*" ↔ §3 \(A Second Look\) ".*no relationship.*"/);

    // The model clears the heuristic flag: listed under Cleared, count 0.
    p.sb.mock!.script('claim-consistency', { data: { pairs: [{ id: 'p1', verdict: 'CONSISTENT', rationale: 'Different populations.' }] } });
    await p.cli(['compile', '--yolo', '--no-smooth']);
    const cleared = report(p.root);
    assert.match(cleared, /Contradictions flagged: 0 \(target 0\)/);
    assert.match(cleared, /Cleared \(a heuristic flag the model judged CONSISTENT — not counted\):\n- §2 .* — Different populations\./);

    // The cap: contradiction_pairs = 1 sends one pair.
    writeFileSync(join(p.root, '.paper', 'config.toml'), 'schema_version = 4\n[compile]\ncontradiction_pairs = 1\n');
    const before = p.sb.mock!.callCount('claim-consistency');
    await p.cli(['compile', '--yolo', '--no-smooth']);
    const last = p.sb.mock!.bodiesFor('claim-consistency')[before]!;
    const msg = (last['messages'] as Array<{ content: string }>)[0]!.content;
    const sent = JSON.parse(/<<<PENSMITH_UNTRUSTED_DATA_[^>]+>>>\n([\s\S]*?)\n<<<END_PENSMITH_UNTRUSTED_DATA_/.exec(msg)![1]!) as unknown[];
    assert.equal(sent.length, 1, 'the cap is honoured');
    assert.match(report(p.root), /1 pair\(s\) judged by the claim-consistency model \(cap 1\)/);
  });
  await withPipelinePaper({ sections: fixtureSections(consistentFixture) }, async (p) => {
    await p.verifyAll();
    const r = await p.cli(['compile', '--yolo', '--no-smooth'], { PENSMITH_NO_LLM: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(report(p.root), /Contradictions flagged: 0 \(target 0\)/);
  });
});

test('EXP-12 (built CLI): bare `pensmith next` on a computer-science paper names the discipline and band 1–3 with their sources; config min/max change the band', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS, intake: { discipline: 'computer-science', citationStyle: 'apa' } }, async (p) => {
    await p.verifyAll();
    const r = await p.cli(['next', '--yolo'], { PENSMITH_NO_LLM: '1' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const md = report(p.root);
    assert.match(md, /^Discipline: computer-science \(from INTAKE\.md\) · band 1–3 citations per paragraph \(from computer-science preset\)/m);
    for (const s of ['1 (learning)', '2 (measurement)', '3 (outbreak)']) assert.match(md, new RegExp(`^- ${s.replace(/[()]/g, '\\$&')}: \\d+(\\.\\d)? citations/paragraph over 2 paragraph\\(s\\) \\(within 1–3\\)`, 'm'));

    writeFileSync(join(p.root, '.paper', 'config.toml'), 'schema_version = 4\n[verification]\ncitation_density_min = 2\ncitation_density_max = 5\n');
    const r2 = await p.cli(['compile', '--yolo'], { PENSMITH_NO_LLM: '1' });
    assert.equal(r2.status, 0, r2.stderr);
    const md2 = report(p.root);
    assert.match(md2, /band 2–5 citations per paragraph \(from config\.toml \[verification\] citation_density_min and citation_density_max\)/);
    assert.match(md2, /^- 1 \(learning\): 1 citations\/paragraph over 2 paragraph\(s\) \(BELOW 2–5\)/m);

    // --discipline overrides both the paper's discipline and the config band.
    const r3 = await p.cli(['compile', '--yolo', '--discipline', 'history'], { PENSMITH_NO_LLM: '1' });
    assert.equal(r3.status, 0, r3.stderr);
    assert.match(report(p.root), /^Discipline: history \(from --discipline\) · band 0\.5–2 citations per paragraph \(from history preset \(--discipline\)\)/m);
  });
});

test('EXP-05 (built CLI): a section title holding a citation or an author-date form is refused, naming the fix; nothing is written', async () => {
  const sections = THREE_SECTIONS.map((s, i) => (i === 1 ? { ...s, title: 'Measurement after Smith (2019)' } : s));
  await withPipelinePaper({ sections }, async (p) => {
    await p.verifyAll();
    const r = await p.cli(['compile', '--yolo'], { PENSMITH_NO_LLM: '1' });
    assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /section 2 \(measurement\): its title "Measurement after Smith \(2019\)" holds UNSUPPORTED-FORM .* retitle it in \.paper\/OUTLINE\.md and run `pensmith outline`/);
    assert.throws(() => readFileSync(join(p.root, '.paper', 'DRAFT.md')), /ENOENT/);
  });
});

test('EXP-10 / EXP-13 (built CLI): a --dry-run compile says `smoothing skipped (dry-run)` and the contradiction model check names dry-run — no model call', async () => {
  const sb = await openChainSandbox({ prefix: 'compile-dry', assignment: true });
  try {
    const run = await sb.run(['--dry-run', '--yolo'], { timeoutMs: 300_000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const md = readFileSync(join(sb.root, '.paper-dry-run', 'COMPILE-REPORT.md'), 'utf8');
    assert.match(md, /_smoothing skipped \(dry-run\) — every boundary keeps the section text as verified\._/);
    assert.match(md, /model check skipped \(dry-run\)/);
    assert.match(run.stdout, /smoothing skipped \(dry-run\)/);
    assert.equal(sb.calls(), 0, 'a dry run never calls the model');
    assert.ok(readFileSync(join(sb.root, '.paper-dry-run', 'DRAFT.md'), 'utf8').startsWith('# '), 'the compiled dry-run draft has its title');
  } finally {
    await sb.close();
  }
});
