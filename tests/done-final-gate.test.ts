// tests/done-final-gate.test.ts — VRFY-26 (D-20-24) and EXP-14/EXP-15 (D-21-18,
// D-21-19): a humanized text is gated on its OWN exact bytes through the ONE
// acceptance function both tiers call (bin/lib/humanizer.ts acceptHumanized:
// the rewrite guard, the cited-key diff and the gate core). A text that adds
// any citation form it must never introduce — an unassigned or fabricated key
// in any Pandoc form, author-date prose, a footnote, a typed reference list, a
// metadata block that redefines a cited key, a raw {=format} block or span —
// is refused; one that only improves the prose is accepted. done writes
// FINAL.md ONCE, after the export and the paper-level record, so a done that
// fails before then leaves FINAL.md byte-identical (the Phase-20 "put the
// previous FINAL.md back" path is gone with the Task-transport seam). The
// done-level humanizer outcomes (mock LLM, built CLI) are in
// tests/humanizer-task.test.ts. Sources offline (recorded fixtures), in process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { writeState, writeOutline, writePlan, sectionDirOf } from './helpers/paper-cli-harness.js';
import { mtimes } from './helpers/gate-paper.js';
import { LECUN_BIB } from './helpers/gate-paper.js';
import { acceptHumanized } from '../bin/lib/humanizer.js';
import { EXIT_BLOCKED } from '../bin/lib/exit-codes.js';
import { finalMdState } from '../bin/lib/done-record.js';

/** Run `fn` with the verb's own stdout lines captured (the TAP stream passes through). */
async function quiet<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const s = String(chunk);
    if (/^pensmith|^\s+- /.test(s)) {
      lines.push(s);
      return true;
    }
    return orig(chunk);
  }) as typeof process.stdout.write;
  try {
    return { result: await fn(), out: lines.join('') };
  } finally {
    process.stdout.write = orig;
  }
}

/** What a humanizer must never add to the text it improves (VRFY-10, VRFY-26). */
const ADDED: ReadonlyArray<readonly [string, string]> = [
  ['a fabricated key', 'A later survey agrees [@Fake2021].'],
  ['a fabricated key with a locator', 'A later survey agrees [@fake2021, p. 4].'],
  ['a narrative key', 'As @fake2019 argues, the effect is large.'],
  ['an author-suppressed key', 'The effect is large [-@fake2019].'],
  ['author-date prose', 'The effect is large (Nguyen & Patel, 2019).'],
  ['a footnote', 'The effect is large.[^1]\n\n[^1]: Nguyen, T. (2019). Shade and heat. Urban Climate.'],
  ['a typed reference list', 'The effect is large.\n\n### References\n\n- Nguyen, T. (2019). Shade and heat. Urban Climate.'],
  ['a reference list under another heading', 'The effect is large.\n\n## References Cited\n\nNguyen, T., & Patel, R. (2019). Shade and heat. Urban Climate, 12, 45–67.'],
  ['a metadata block redefining a cited key', 'The effect is large.\n\n---\nreferences:\n- id: lecun2015\n  type: article-journal\n  title: A totally fabricated title\n...'],
  ['a raw block', 'The effect is large.\n\n```{=openxml}\n<w:p><w:r><w:t>(Nguyen &amp; Patel, 2019)</w:t></w:r></w:p>\n```'],
  ['a raw span', 'The effect is large `(Nguyen, 2019)`{=latex}.'],
  // Review round 2: forms a raw-text scan missed but the export shows as attributions.
  ['a raw TeX footnote', 'The effect is large.\\footnote{Nobody, N. A study that does not exist. Journal of Nothing 12, 2017.}'],
  ['a raw TeX environment', 'The effect is large.\n\n\\begin{quote}\nNguyen said so.\n\\end{quote}'],
  ['author-date in emphasis', 'The effect is large (*Nobody*, 2017).'],
  ['an escaped numbered marker', 'The effect is large \\[3\\].'],
  ['author-date in link text', 'The effect is large (see [Nguyen & Patel, 2019](https://example.org/trees)).'],
  ['author-date in an HTML element', 'The effect is large <span class="citation">Nguyen 2019</span>.'],
  ['a run-in reference label', 'The effect is large.\n\n**References:** Nguyen, T., & Patel, R. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10.'],
  ['a typed entry in an HTML block', 'The effect is large.\n\n<p>Nguyen, T. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10.</p>'],
  ['a typed entry in a block quote', 'The effect is large.\n\n> Nguyen, T. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10.'],
  ['a single-author narrative citation', 'Nguyen (2019) argued that the effect is large.'],
  ['a table-source label', 'The effect is large (Source: Okafor 2021).'],
];

test('VRFY-26 (in process): the ONE acceptance function refuses a humanized text that adds any citation form, and accepts one that only improves the prose', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1', PENSMITH_CONTACT_EMAIL: undefined } }, async (sb) => {
    writeState(sb.root, [{ n: 1, slug: 'intro' }]);
    writeOutline(sb.root, [{ n: 1, slug: 'intro', sources: ['lecun2015'] }]);
    writeFileSync(join(sb.paper, 'CITATIONS.bib'), LECUN_BIB);
    writePlan(sb.root, 1, 'intro', { status: 'written', assigned_sources: '[lecun2015]' });
    writeFileSync(join(sectionDirOf(sb.root, 1, 'intro'), 'DRAFT.md'), '# Intro\n\nDeep learning reshaped computer vision and speech recognition [@lecun2015].\n');
    const { verifySection } = await import('../bin/cli/verify.js');
    const { compileCommand } = await import('../bin/cli/compile.js');
    const v = await quiet(() => verifySection(1, 'intro', null));
    assert.equal(v.result.status, 'verified', v.out);
    const c = await quiet(() => compileCommand.run!({ args: { yolo: true } } as never));
    assert.notEqual((c.result as { refused?: boolean }).refused, true, c.out);
    const compiled = readFileSync(join(sb.paper, 'DRAFT.md'), 'utf8');
    const sections = mtimes(join(sb.paper, 'sections'));

    for (const [what, added] of ADDED) {
      const verdict = await acceptHumanized({ paperRoot: sb.root, draft: compiled, humanized: `${compiled.trimEnd()}\n\n${added}\n` });
      assert.equal(verdict.ok, false, `${what}: refused`);
      assert.ok(verdict.reasons.length > 0, what);
    }
    const improved = compiled.replace('reshaped', 'transformed');
    const ok = await acceptHumanized({ paperRoot: sb.root, draft: compiled, humanized: improved });
    assert.deepEqual(ok.reasons, [], 'a prose-only change is accepted');
    assert.equal(ok.ok, true);
    assert.deepEqual(mtimes(join(sb.paper, 'sections')), sections, 'nothing under sections/ changed');
    assert.ok(!existsSync(join(sb.paper, 'FINAL.md')), 'the acceptance function writes nothing');
  });
});

test('EXP-15 (in process): FINAL.md is written once, after the export and the paper record — a done that fails before then leaves it byte-identical', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1', PENSMITH_CONTACT_EMAIL: undefined } }, async (sb) => {
    writeState(sb.root, [{ n: 1, slug: 'intro' }]);
    writeOutline(sb.root, [{ n: 1, slug: 'intro', sources: ['lecun2015'] }]);
    writeFileSync(join(sb.paper, 'CITATIONS.bib'), LECUN_BIB);
    writePlan(sb.root, 1, 'intro', { status: 'written', assigned_sources: '[lecun2015]' });
    writeFileSync(join(sectionDirOf(sb.root, 1, 'intro'), 'DRAFT.md'), '# Intro\n\nDeep learning reshaped computer vision and speech recognition [@lecun2015].\n');
    const { verifySection } = await import('../bin/cli/verify.js');
    const { compileCommand } = await import('../bin/cli/compile.js');
    const { doneCommand } = await import('../bin/cli/done.js');
    await quiet(() => verifySection(1, 'intro', null));
    await quiet(() => compileCommand.run!({ args: { yolo: true } } as never));
    const compiled = readFileSync(join(sb.paper, 'DRAFT.md'), 'utf8');

    // The paper-level VERIFICATION.md cannot be written (a folder in its place): done fails after the export.
    const verificationMd = join(sb.paper, 'VERIFICATION.md');
    mkdirSync(verificationMd);
    await assert.rejects(() => quiet(() => doneCommand.run!({ args: { yolo: true, raw: false, format: 'md' } } as never)));
    assert.ok(!existsSync(join(sb.paper, 'FINAL.md')), 'no FINAL.md before the record is written');
    assert.ok(!existsSync(join(sb.paper, 'DONE-RECORD.json')));
    rmSync(verificationMd, { recursive: true, force: true });

    const ok = await quiet(() => doneCommand.run!({ args: { yolo: true, raw: false, format: 'md' } } as never));
    assert.equal((ok.result as { ok?: boolean }).ok, true, ok.out);
    assert.match(ok.out, /pensmith done: humanizer skill not found \(looked for ~\/\.claude\/skills\/humanizer\/SKILL\.md, .*\) — skipping/);
    assert.equal(readFileSync(join(sb.paper, 'FINAL.md'), 'utf8'), compiled, 'FINAL.md is the compiled draft');
    const record = JSON.parse(readFileSync(join(sb.paper, 'DONE-RECORD.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(record['humanized'], false);
    assert.equal(record['final_sha256'], createHash('sha256').update(compiled, 'utf8').digest('hex'));
    assert.equal(finalMdState(sb.root), 'current');

    // A second failure leaves the recorded FINAL.md exactly as it was — never read as a hand edit.
    const before = readFileSync(join(sb.paper, 'FINAL.md'));
    rmSync(verificationMd);
    mkdirSync(verificationMd);
    try {
      await assert.rejects(() => quiet(() => doneCommand.run!({ args: { yolo: true, raw: false, format: 'md' } } as never)));
      assert.deepEqual(readFileSync(join(sb.paper, 'FINAL.md')), before);
      assert.equal(finalMdState(sb.root), 'current');
    } finally {
      rmSync(verificationMd, { recursive: true, force: true });
    }
    assert.equal(EXIT_BLOCKED, 4);
  });
});
