// tests/router-outline.property.test.ts — the outline-only route (GRND-11,
// D-21-25) over generated paper states.
//
// fast-check builds outline-mode papers from every input the router reads —
// RESEARCH.md, OUTLINE.md (absent, a table, a malformed row), STATE.json's
// registrations (none, matching, divergent), each section's PLAN.md (absent,
// stub, every lifecycle status, corrupt) and DRAFT.md, CITATIONS.bib, the
// compiled DRAFT.md / FINAL.md / COMPILE-INPUTS.json, ANNOTATED-BIBLIOGRAPHY.md
// (absent, done's, edited), the export files, and DONE-RECORD.json (absent,
// an outline record that matches or is stale, a draft record, a v1 record, a
// newer one, junk) — and asserts, with `stopAfterOutline`:
//   - the router is total: it resolves, never throws, and never names plan,
//     write, verify or compile (no section is ever routed in outline mode);
//   - once the outline is approved and the outline record is current, the
//     decision is status (done) with the outline-only detail
//     (isOutlineOnlyDoneDetail);
//   - an approved outline with no current record, no hand-written annotated
//     bibliography and no newer record routes to done.
// PENSMITH_ROUTER_OUTLINE_RUNS (default 300) and PENSMITH_ROUTER_OUTLINE_SEED.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { resolveNextAction, isOutlineOnlyDoneDetail } from '../bin/lib/router.js';

const RUNS = Number(process.env['PENSMITH_ROUTER_OUTLINE_RUNS'] ?? 300);
const SEED = process.env['PENSMITH_ROUTER_OUTLINE_SEED'] !== undefined ? Number(process.env['PENSMITH_ROUTER_OUTLINE_SEED']) : undefined;

const SLUGS = ['intro', 'method', 'results', 'discussion'] as const;
const PLAN_STATES = ['absent', 'stub', 'planned', 'writing', 'written', 'verifying', 'verified', 'failed', 'unverifiable', 'corrupt', 'weird'] as const;

interface Section {
  plan: (typeof PLAN_STATES)[number];
  draft: boolean;
}

interface PaperState {
  research: boolean;
  outline: 'absent' | 'table' | 'malformed';
  registration: 'none' | 'matching' | 'divergent';
  sections: Section[];
  bib: boolean;
  compiled: boolean;
  final: boolean;
  annotated: 'absent' | 'done' | 'edited';
  exports: boolean;
  record: 'absent' | 'current' | 'stale-outline' | 'stale-bib' | 'draft' | 'v1' | 'newer' | 'junk';
  rejected: boolean;
}

const sectionArb: fc.Arbitrary<Section> = fc.record({ plan: fc.constantFrom(...PLAN_STATES), draft: fc.boolean() });

const stateArb: fc.Arbitrary<PaperState> = fc.record({
  research: fc.boolean(),
  outline: fc.constantFrom('absent', 'table', 'table', 'table', 'malformed'),
  registration: fc.constantFrom('none', 'matching', 'matching', 'matching', 'divergent'),
  sections: fc.array(sectionArb, { minLength: 1, maxLength: SLUGS.length }),
  bib: fc.constantFrom(true, true, true, false),
  compiled: fc.boolean(),
  final: fc.boolean(),
  annotated: fc.constantFrom('absent', 'done', 'done', 'edited'),
  exports: fc.constantFrom(true, true, true, false),
  record: fc.constantFrom('absent', 'current', 'current', 'current', 'stale-outline', 'stale-bib', 'draft', 'v1', 'newer', 'junk'),
  rejected: fc.boolean(),
});

const sha = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const SHA_X = sha('x');

function outlineTable(n: number, malformed: boolean): string {
  const rows = SLUGS.slice(0, n).map((slug, i) => `| ${i + 1} | ${slug} | ${slug} | ${malformed && i === 0 ? 'not-a-role' : 'body'} |  | 500 | a2020 |  |`);
  return ['# Paper', '', 'Thesis: t', '', '| # | slug | title | role | depends_on | word target | assigned_sources | voice |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
}

/** Write the paper `s` describes under a fresh root; returns the root. */
function writePaper(s: PaperState): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-router-outline-'));
  const p = join(root, '.paper');
  mkdirSync(p, { recursive: true });
  const n = s.sections.length;
  const registered = s.registration === 'none' ? [] : SLUGS.slice(0, n).map((slug, i) => ({ n: i + 1, slug: s.registration === 'divergent' && i === n - 1 ? `${slug}-x` : slug }));
  writeFileSync(join(p, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'router-outline', createdAt: new Date(0).toISOString(), sections: registered }));
  writeFileSync(join(p, 'config.toml'), 'schema_version = 3\n\n[project]\nmode = "outline"\n');
  if (s.research) writeFileSync(join(p, 'RESEARCH.md'), '# Research log\n');
  if (s.rejected) writeFileSync(join(p, 'OUTLINE.rejected.md'), 'rejected\n');
  if (s.outline !== 'absent') writeFileSync(join(p, 'OUTLINE.md'), outlineTable(n, s.outline === 'malformed'));
  for (const [i, sec] of s.sections.entries()) {
    const dir = join(p, 'sections', `${String(i + 1).padStart(2, '0')}-${SLUGS[i] as string}`);
    mkdirSync(dir, { recursive: true });
    if (sec.plan === 'corrupt') writeFileSync(join(dir, 'PLAN.md'), '---\nstatus: *missing\n---\n');
    else if (sec.plan === 'stub') writeFileSync(join(dir, 'PLAN.md'), '---\nstatus: planned\nstub: true\n---\n');
    else if (sec.plan !== 'absent') writeFileSync(join(dir, 'PLAN.md'), `---\nstatus: ${sec.plan}\n---\n`);
    if (sec.draft) writeFileSync(join(dir, 'DRAFT.md'), 'Draft [@a2020].\n');
  }
  if (s.bib) writeFileSync(join(p, 'CITATIONS.bib'), '@article{a2020,\n  title = {A},\n  year = {2020},\n  doi = {10.5555/a},\n}\n');
  if (s.compiled) writeFileSync(join(p, 'DRAFT.md'), '# Paper\n\nText [@a2020].\n');
  if (s.final) writeFileSync(join(p, 'FINAL.md'), '# Paper\n\nText [@a2020].\n');
  if (s.annotated !== 'absent') writeFileSync(join(p, 'ANNOTATED-BIBLIOGRAPHY.md'), '# Paper — Annotated Bibliography\n');
  const doneAnnotatedSha = sha('# Paper — Annotated Bibliography\n');
  if (s.annotated === 'edited') writeFileSync(join(p, 'ANNOTATED-BIBLIOGRAPHY.md'), '# Paper — Annotated Bibliography\n\nMy note.\n');
  if (s.exports) {
    mkdirSync(join(p, 'export'), { recursive: true });
    writeFileSync(join(p, 'export', 'OUTLINE.md'), '# Paper\n');
    writeFileSync(join(p, 'export', 'ANNOTATED-BIBLIOGRAPHY.md'), '# Paper\n');
  }
  const fileSha = (name: string): string => {
    try {
      return sha(readFileSync(join(p, name)));
    } catch {
      return SHA_X;
    }
  };
  const outlineRecord = {
    $schemaVersion: 2,
    mode: 'outline',
    done_at: new Date(0).toISOString(),
    outline_sha256: s.record === 'stale-outline' ? SHA_X : fileSha('OUTLINE.md'),
    bib_sha256: s.record === 'stale-bib' ? SHA_X : fileSha('CITATIONS.bib'),
    annotated_sha256: doneAnnotatedSha,
    outline_exports: ['export/OUTLINE.md', 'export/ANNOTATED-BIBLIOGRAPHY.md'],
  };
  const draftRecord = { done_at: new Date(0).toISOString(), compiled_draft_sha256: SHA_X, final_sha256: SHA_X, humanized: false };
  const records: Record<PaperState['record'], string | null> = {
    absent: null,
    current: JSON.stringify(outlineRecord),
    'stale-outline': JSON.stringify(outlineRecord),
    'stale-bib': JSON.stringify(outlineRecord),
    draft: JSON.stringify({ $schemaVersion: 2, ...draftRecord }),
    v1: JSON.stringify({ $schemaVersion: 1, ...draftRecord }),
    newer: JSON.stringify({ $schemaVersion: 3, mode: 'outline' }),
    junk: '{ not json',
  };
  const body = records[s.record];
  if (body !== null) writeFileSync(join(p, 'DONE-RECORD.json'), body);
  return root;
}

/** The outline is approved and registered and every input the outline route needs is readable. */
function approved(s: PaperState): boolean {
  // The research sentinel counts an OUTLINE.md as research done.
  return s.outline === 'table' && s.registration === 'matching';
}

test('GRND-11 property: in outline mode the router is total, never routes a section or compile, ends at status (done) once the outline record is current, and routes an approved outline to done until then', async () => {
  const hits = { complete: 0, done: 0, attention: 0 };
  await fc.assert(
    fc.asyncProperty(stateArb, async (s) => {
      const root = writePaper(s);
      try {
        const d = await resolveNextAction(root, { stopAfterOutline: true });
        assert.ok(d !== undefined && typeof d.verb === 'string', 'a decision');
        assert.ok(!['plan', 'write', 'verify', 'compile', 'resume'].includes(d.verb), `outline mode never routes ${d.verb}: ${JSON.stringify(s)}`);
        if (!approved(s)) return;
        const current = s.record === 'current' && s.annotated === 'done' && s.exports && s.bib;
        if (current) {
          assert.equal(d.verb, 'status', JSON.stringify({ s, d }));
          assert.equal(d.verb === 'status' && d.reason, 'done', JSON.stringify({ s, d }));
          assert.equal(isOutlineOnlyDoneDetail(d.verb === 'status' ? (d.detail ?? '') : ''), true, JSON.stringify(d));
          hits.complete += 1;
        } else if (s.annotated === 'absent' && s.record !== 'newer') {
          assert.equal(d.verb, 'done', JSON.stringify({ s, d }));
          hits.done += 1;
        } else if (s.annotated === 'edited' || (s.annotated === 'done' && s.record !== 'current' && s.record !== 'stale-outline' && s.record !== 'stale-bib')) {
          // Not the text done wrote (no matching record): attention, never replaced.
          assert.equal(d.verb === 'status' && d.reason, 'attention', JSON.stringify({ s, d }));
          hits.attention += 1;
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: RUNS, ...(SEED !== undefined ? { seed: SEED } : {}) },
  );
  // The three outcomes were each reached (the property is not vacuous).
  if (RUNS >= 200) for (const [k, v] of Object.entries(hits)) assert.ok(v > 0, `no generated paper reached ${k}: ${JSON.stringify(hits)}`);
});
