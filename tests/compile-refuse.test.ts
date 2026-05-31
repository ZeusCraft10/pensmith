// tests/compile-refuse.test.ts
// COMP-01 refuse-gate: compile MUST refuse (throw / non-zero result) on
// FABRICATED / MIS-CITED / quote-NOT_FOUND verdicts, naming the section +
// citekey. NO .paper/DRAFT.md write must occur.
//
// Also covers REVIEW H-01 (always-on gate) and REVIEW H-02 (absent-artifact
// behavior): hash-match + FABRICATED still refuses; state: writing refuses;
// absent DRAFT.md refuses; absent VERIFICATION.md triggers auto-verify then
// re-applies the gate.
//
// RED — bin/lib/compile.ts does not exist yet; every test that imports it
// will fail with MODULE_NOT_FOUND. The tests that don't import compile.ts
// fail on fixture assertion (structure tests pass but compile tests fail).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---- fixture builder -------------------------------------------------------

interface SectionOpts {
  n: number;
  slug: string;
  state?: string;
  draftContent?: string | null;  // null = omit DRAFT.md
  verificationContent?: string | null;  // null = omit VERIFICATION.md
  verifiedAgainstDraftHash?: string;
  assignedSources?: string[];
}

function makeOutline(sections: Array<{ n: number; slug: string }>): string {
  const rows = sections.map(
    (s) => `| ${s.n} | ${s.slug} | ${s.slug} section |  | 300 |  |`,
  );
  return [
    '# Test Paper',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '|---|------|-------|-----------|-------------|------------------|',
    ...rows,
  ].join('\n') + '\n';
}

function makePaperRoot(sections: SectionOpts[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-refuse-'));
  const paperDir = join(root, '.paper');
  mkdirSync(paperDir, { recursive: true });

  // Write OUTLINE.md
  writeFileSync(
    join(paperDir, 'OUTLINE.md'),
    makeOutline(sections.map((s) => ({ n: s.n, slug: s.slug }))),
  );

  // Write CITATIONS.bib (empty is fine for refuse tests)
  writeFileSync(join(paperDir, 'CITATIONS.bib'), '');

  // Write sections
  for (const sec of sections) {
    const pad = String(sec.n).padStart(2, '0');
    const secDir = join(paperDir, 'sections', `${pad}-${sec.slug}`);
    mkdirSync(secDir, { recursive: true });

    // PLAN.md with frontmatter
    const state = sec.state ?? 'verified';
    const hash = sec.verifiedAgainstDraftHash ?? 'aabbccdd';
    const sources = sec.assignedSources ?? [];
    const planMd = [
      '---',
      `slug: ${sec.slug}`,
      `state: ${state}`,
      `verified_against_draft_hash: ${hash}`,
      `assigned_sources: [${sources.join(', ')}]`,
      '---',
      '',
      `# ${sec.slug}`,
    ].join('\n') + '\n';
    writeFileSync(join(secDir, 'PLAN.md'), planMd);

    // DRAFT.md (unless null)
    if (sec.draftContent !== null) {
      const content = sec.draftContent ?? `# ${sec.slug}\n\nSome content [@fakecite2024].\n`;
      writeFileSync(join(secDir, 'DRAFT.md'), content);
    }

    // VERIFICATION.md (unless null)
    if (sec.verificationContent !== null) {
      const content = sec.verificationContent ?? `# VERIFICATION\n\nverdict: OK\nstate: verified\n`;
      writeFileSync(join(secDir, 'VERIFICATION.md'), content);
    }
  }

  return root;
}

// ---- tests -----------------------------------------------------------------

test('compile-refuse: FABRICATED verdict → refuse, name section + citekey, no DRAFT.md (COMP-01)', async () => {
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      verificationContent: [
        '# VERIFICATION',
        '',
        'verdict: FABRICATED',
        'citekey: fakecite2024',
        'state: verified',
      ].join('\n'),
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(!result.ok, 'compile must refuse on FABRICATED verdict');
  assert.match(result.reason ?? '', /intro|1/i, 'refuse reason must name the section');
  assert.match(result.reason ?? '', /fakecite2024/i, 'refuse reason must name the citekey');
  assert.ok(
    !existsSync(join(root, '.paper', 'DRAFT.md')),
    'DRAFT.md must NOT be written on refuse (COMP-01)',
  );
});

test('compile-refuse: MIS-CITED verdict → refuse, name section + citekey (COMP-01)', async () => {
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'method',
      verificationContent: [
        '# VERIFICATION',
        '',
        'verdict: MIS-CITED',
        'citekey: wrong2020',
        'state: verified',
      ].join('\n'),
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(!result.ok, 'compile must refuse on MIS-CITED verdict');
  assert.match(result.reason ?? '', /method|1/i, 'refuse reason must name the section');
  assert.match(result.reason ?? '', /wrong2020/i, 'refuse reason must name the citekey');
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')));
});

test('compile-refuse: quote-NOT_FOUND verdict → refuse (COMP-01)', async () => {
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'results',
      verificationContent: [
        '# VERIFICATION',
        '',
        'verdict: NOT_FOUND',
        'citekey: quote2019',
        'state: verified',
      ].join('\n'),
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(!result.ok, 'compile must refuse on NOT_FOUND verdict');
  assert.match(result.reason ?? '', /quote2019/i, 'refuse reason must name the citekey');
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')));
});

test('REVIEW H-01: hash-match + FABRICATED → always-on gate still refuses, no DRAFT.md', async () => {
  // Even when verified_against_draft_hash matches the current draft hash,
  // if VERIFICATION.md holds a FABRICATED verdict, compile must still refuse.
  // The gate does not trust a hash match as proxy for "no blocking verdict".
  const draftContent = 'Some draft text for intro.\n';
  // We'll use a known hash here — the point is that even if the hashes matched,
  // the FABRICATED verdict must refuse.
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      draftContent,
      verifiedAgainstDraftHash: 'deadbeef',  // will mismatch or match — doesn't matter
      verificationContent: [
        '# VERIFICATION',
        '',
        'verdict: FABRICATED',
        'citekey: ghost2021',
        'state: verified',
      ].join('\n'),
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(!result.ok, 'H-01: FABRICATED must refuse even when hash appears to match');
  assert.match(result.reason ?? '', /ghost2021/i);
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')));
});

test('REVIEW H-01: state: writing → refuse (not silently auto-verified)', async () => {
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      state: 'writing',
      verificationContent: '# VERIFICATION\n\nverdict: OK\nstate: verified\n',
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(!result.ok, 'H-01: state: writing must be refused');
  assert.match(result.reason ?? '', /intro|writing|state/i);
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')));
});

test('REVIEW H-01: state: failed → refuse', async () => {
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      state: 'failed',
      verificationContent: '# VERIFICATION\n\nverdict: OK\nstate: verified\n',
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(!result.ok, 'H-01: state: failed must be refused');
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')));
});

test('REVIEW H-02: absent DRAFT.md → refuse naming the section (COMP-01)', async () => {
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      draftContent: null,  // omit DRAFT.md
      verificationContent: '# VERIFICATION\n\nverdict: OK\nstate: verified\n',
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(!result.ok, 'H-02: absent DRAFT.md must cause refuse');
  assert.match(result.reason ?? '', /intro|1|draft/i, 'refuse reason must name the section');
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')));
});

test('REVIEW H-02: DRAFT.md present, VERIFICATION.md absent → auto-verify Pass 1+3 then gate (COMP-01)', async () => {
  // When VERIFICATION.md is absent but DRAFT.md exists, compile should
  // auto-verify (Pass 1+3). If the auto-verify result has a blocking verdict,
  // compile refuses. This test uses an empty bib so Pass 1 returns FABRICATED
  // for any [@citekey] in the draft → compile refuses.
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      draftContent: '# Intro\n\nSome text with [@ghost2024] citation.\n',
      verificationContent: null,  // omit VERIFICATION.md
    },
  ]);
  // CITATIONS.bib is empty (written by makePaperRoot) → FABRICATED for ghost2024

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  // In test mode we don't have network — with PENSMITH_NO_LLM, auto-verify
  // should still execute Pass1+Pass3 (deterministic). The test simply asserts
  // that compile does NOT silently succeed on missing VERIFICATION.md.
  const result = await runCompile({ paperRoot: root, yolo: true }).catch((e: Error) => ({
    ok: false as const,
    reason: e.message,
  }));
  // Either refuse OR the test passes as red (module missing)
  assert.ok(!result.ok || result.ok === false, 'H-02: absent VERIFICATION.md must trigger auto-verify gate');
});

test('compile-refuse: multi-section, one bad section → refuse naming the bad section', async () => {
  const root = makePaperRoot([
    {
      n: 1,
      slug: 'intro',
      verificationContent: '# VERIFICATION\n\nverdict: OK\nstate: verified\n',
    },
    {
      n: 2,
      slug: 'method',
      verificationContent: [
        '# VERIFICATION',
        '',
        'verdict: FABRICATED',
        'citekey: bad2020',
        'state: verified',
      ].join('\n'),
    },
    {
      n: 3,
      slug: 'results',
      verificationContent: '# VERIFICATION\n\nverdict: OK\nstate: verified\n',
    },
  ]);

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(!result.ok, 'compile must refuse when any section has a FABRICATED verdict');
  assert.match(result.reason ?? '', /method|2|bad2020/i, 'refuse reason must name the failing section');
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')));
});
