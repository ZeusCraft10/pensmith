// tests/lib/verify-cli.ts — one section verified by the real `pensmith verify`,
// on the recorded registry answers, and what it recorded.
//
// Not a test file (the runner collects only *.test.ts).

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './export-fixture.js';
import { outlineTable } from './outline-fixture.js';
import { citedKeys, findCitations } from '../../bin/lib/citation-grammar.js';
import type { VerificationRecord } from '../../bin/lib/verify/verification-record.js';

export interface VerifiedSection {
  status: number | null;
  /** stdout then stderr. */
  out: string;
  /** The section's VERIFICATION.json. */
  record: VerificationRecord;
}

/**
 * A one-section paper ('01-intro') whose DRAFT.md is `draft` and whose
 * CITATIONS.bib is `bib`, its outline and plan assigning every key the draft
 * cites, run through `pensmith verify 1` in the real CLI.
 */
export function verifySection(draft: string, bib: string, env: Record<string, string> = {}): VerifiedSection {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-verify-cli-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  const keys = citedKeys(findCitations(draft));
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), outlineTable([{ n: 1, slug: 'intro', title: 'Introduction', sources: keys }], 'Verified Section'));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  writeFileSync(join(sec, 'PLAN.md'), `---\nsection: 1\nslug: intro\ntitle: Introduction\nstatus: written\nassigned_sources: [${keys.join(', ')}]\n---\n# Introduction\n`);
  writeFileSync(join(sec, 'DRAFT.md'), draft);
  const r = runCli(['verify', '1'], root, env);
  const record = JSON.parse(readFileSync(join(sec, 'VERIFICATION.json'), 'utf8')) as VerificationRecord;
  return { status: r.status, out: r.stdout + r.stderr, record };
}

/** A section's draft with one sentence citing each of `keys`. */
export function citingDraft(keys: readonly string[]): string {
  return `# Introduction\n\n${keys.map((k) => `One claim here rests on this work [@${k}].`).join('\n')}\n`;
}

/** Each citekey's Pass 1 verdict, from the record. */
export function citationVerdicts(record: VerificationRecord): Record<string, string> {
  return Object.fromEntries(record.citations.map((c) => [c.citekey, c.verdict]));
}

/** An entry of the known-bad citation corpus (tests/fixtures/known-bad-citations.json). */
export interface KnownBadCitation {
  citekey: string;
  title: string;
  authors: string[];
  year: number;
  journal?: string;
  doi: string;
  expected_verdict: string;
  /** Why the entry earns its verdict. */
  why: string;
}

/** The known-bad citation corpus. */
export const KNOWN_BAD_CITATIONS: readonly KnownBadCitation[] = JSON.parse(
  readFileSync(new URL('../fixtures/known-bad-citations.json', import.meta.url), 'utf8'),
) as KnownBadCitation[];

/** A BibTeX `@article` from a corpus entry's fields. */
export function bibEntry(e: { citekey: string; title: string; authors: string[]; year: number; journal?: string; doi?: string }): string {
  return [
    `@article{${e.citekey},`,
    `  title = {${e.title}},`,
    `  author = {${e.authors.join(' and ')}},`,
    ...(e.journal ? [`  journal = {${e.journal}},`] : []),
    `  year = {${e.year}},`,
    ...(e.doi ? [`  doi = {${e.doi}}`] : []),
    '}',
    '',
  ].join('\n');
}

/**
 * S. Leuchtner, C. M. Nicolás and A. Suk, "A Note on Visible Islands" (2022),
 * as a bibliography writes it, under `key`. Its Crossref and OpenAlex records
 * and its open-access PDF (arXiv:2109.00022v3) are recorded, so Pass 3 checks
 * quotations of it against real text.
 */
export const VISIBLE_ISLANDS_BIB = (key: string): string =>
  `@article{${key},\n  title = {A Note on Visible Islands},\n  author = {Leuchtner, Sophie and Nicol{\\'a}s, Carlos M. and Suk, Andrew},\n` +
  '  journal = {Studia Scientiarum Mathematicarum Hungarica},\n  year = {2022},\n  doi = {10.1556/012.2022.01524}\n}\n';
