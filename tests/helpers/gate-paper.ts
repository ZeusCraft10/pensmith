// tests/helpers/gate-paper.ts — scratch papers for the Phase 20 gate suites
// (compile / done recomputation, forged artifacts, stale inputs, placeholder
// drafts, quote acceptances). Every paper is real: STATE.json, OUTLINE.md,
// PLAN.md per section, and citations of RECORDED works whose Crossref and
// Retraction Watch answers replay offline (tests/fixtures/cassettes), so the
// built CLI's `verify` / `compile` / `done` run the production gate with no
// stand-in anywhere.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { sandbox, runCli, writeState, sectionDirOf, type Sandbox, type CliRun } from './paper-cli-harness.js';
import { computeDraftHash } from '../../bin/lib/draft-hash.js';

/** Recorded Crossref works (Pass 1 OK offline). */
export const LECUN_BIB =
  '@article{lecun2015,\n  title = {Deep learning},\n  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},\n  journal = {Nature},\n  year = {2015},\n  doi = {10.1038/nature14539}\n}\n';
export const ASPELMEYER_BIB =
  '@article{aspelmeyer2009,\n  title = {Measured measurement},\n  author = {Aspelmeyer, Markus},\n  journal = {Nature Physics},\n  year = {2009},\n  doi = {10.1038/nphys1170}\n}\n';
export const ZHU_BIB =
  '@article{zhu2020,\n  title = {A Novel Coronavirus from Patients with Pneumonia in China, 2019},\n  author = {Zhu, Na},\n  journal = {New England Journal of Medicine},\n  year = {2020},\n  doi = {10.1056/NEJMoa2001017}\n}\n';
/** Three recorded works (Crossref + Retraction Watch answers replay offline): Pass 1 OK with no network. */
export const RECORDED_BIB = LECUN_BIB + ASPELMEYER_BIB + ZHU_BIB;
/** A DOI Crossref answers 404 for (recorded): FABRICATED offline. */
export const FAKE_DOI_BIB =
  '@article{fake2017,\n  title = {A Study That Does Not Exist},\n  author = {Nobody, Nora},\n  journal = {Journal of Nothing},\n  year = {2017},\n  doi = {10.5555/pensmith-no-such-work-2017}\n}\n';

export interface GateSection {
  n: number;
  slug: string;
  assigned: string[];
  /** DRAFT.md text; null leaves no draft. */
  draft: string | null;
  status?: string;
}

export interface GatePaper {
  sb: Sandbox;
  root: string;
  sectionDir(n: number, slug: string): string;
  cli(args: readonly string[], env?: Record<string, string | undefined>): CliRun;
}

/** A paper whose outline lists `sections`, with `bib` as .paper/CITATIONS.bib (null: none). */
export function seedGatePaper(prefix: string, sections: readonly GateSection[], bib: string | null = LECUN_BIB + ASPELMEYER_BIB): GatePaper {
  const sb = sandbox(prefix);
  const root = sb.project('p');
  writeState(root, sections.map((s) => ({ n: s.n, slug: s.slug })));
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    [
      '# Outline',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      ...sections.map((s) => `| ${s.n} | ${s.slug} | ${s.slug} |  | 300 | ${s.assigned.join(', ')} |`),
      '',
    ].join('\n'),
  );
  if (bib !== null) writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  for (const s of sections) {
    const dir = sectionDirOf(root, s.n, s.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'PLAN.md'),
      [
        '---',
        'schema_version: 2',
        `section: ${s.n}`,
        `slug: ${s.slug}`,
        `title: ${s.slug}`,
        'depends_on: []',
        `assigned_sources: [${s.assigned.map((k) => `'${k}'`).join(', ')}]`,
        'verified_against_draft_hash: null',
        `status: ${s.status ?? 'written'}`,
        '---',
        '',
        '## Brief',
        '',
        `Section ${s.n}.`,
        '',
      ].join('\n'),
    );
    if (s.draft !== null) writeFileSync(join(dir, 'DRAFT.md'), s.draft);
  }
  return {
    sb,
    root,
    sectionDir: (n, slug) => sectionDirOf(root, n, slug),
    cli: (args, env = {}) => runCli(sb, root, args, { env }),
  };
}

/** The D-07 draft hash of a section as its PLAN.md records it. */
export function sectionDraftHash(root: string, n: number, slug: string, assigned: readonly string[]): string {
  return computeDraftHash(readFileSync(join(sectionDirOf(root, n, slug), 'DRAFT.md')), [...assigned]);
}

/** relative path → mtimeMs for every file under `dir`. */
export function mtimes(dir: string): Map<string, number> {
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

/** sha256 of a file's bytes. */
export function fileSha(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
