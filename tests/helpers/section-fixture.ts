// tests/helpers/section-fixture.ts — a paper seeded for the Phase 18 sections
// stream tests (GRND-07..16, FEED-01..04): STATE.json, a v1 INTAKE.md written
// through the one brief renderer (renderIntakeDocument), and a current-version
// LIBRARY.json (v2 entries through the library's own v2 → v3 migration, so a
// read never has to migrate — and rewrite — it) with a handful of sources.
// No network, no model.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderIntakeDocument, type IntakeBriefInput } from '../../bin/lib/intake-brief.js';
import { initState } from '../../bin/lib/state.js';
import type { OutlineContract } from '../../bin/lib/llm-contracts.js';
import { migrate as libraryV2ToV3 } from '../../bin/lib/migrations/library/v2_to_v3.js';

export const FIXTURE_NOW = '2026-09-01T00:00:00.000Z';

export interface FixtureSource {
  citekey: string;
  title: string;
  author: string;
  year: number;
  abstract?: string;
  oaUrl?: string | null;
  /**
   * The DOI (default `10.5555/fixture.<citekey>`, under Crossref's test prefix):
   * outline and plan offer only sources the citation verifier can check
   * (source-context.ts verifierBlindSpot). `null` makes a source it cannot.
   */
  doi?: string | null;
}

export const DEFAULT_SOURCES: readonly FixtureSource[] = Object.freeze([
  { citekey: 'vaswani2017', title: 'Attention Is All You Need', author: 'Vaswani, Ashish', year: 2017, abstract: 'The Transformer relies entirely on attention.', oaUrl: 'https://arxiv.org/pdf/1706.03762' },
  { citekey: 'bahdanau2015', title: 'Neural Machine Translation by Jointly Learning to Align and Translate', author: 'Bahdanau, Dzmitry', year: 2015, abstract: 'Additive attention over the encoder states.' },
  { citekey: 'luong2015', title: 'Effective Approaches to Attention-based Neural Machine Translation', author: 'Luong, Minh-Thang', year: 2015, abstract: 'Global and local attention.' },
  { citekey: 'devlin2019', title: 'BERT: Pre-training of Deep Bidirectional Transformers', author: 'Devlin, Jacob', year: 2019, abstract: 'Bidirectional pre-training of transformers.' },
]);

/** A v2 LIBRARY.json entry (writeLibrary migrates it to the current version). */
export function libraryEntry(s: FixtureSource): Record<string, unknown> {
  return {
    citekey: s.citekey,
    doi: s.doi === undefined ? `10.5555/fixture.${s.citekey}` : s.doi,
    arxiv: null,
    pmid: null,
    pmcid: null,
    isbn: null,
    title: s.title,
    authors: [s.author],
    year: s.year,
    venue: 'Proceedings',
    abstract: s.abstract ?? null,
    oa_url: s.oaUrl ?? null,
    alternate_dois: [],
    provenance: ['fixture'],
    retracted: false,
    retraction_details: null,
    synthetic: false,
    last_verified: null,
    byo: null,
    addedAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
  };
}

export function writeLibrary(root: string, sources: readonly FixtureSource[] = DEFAULT_SOURCES): void {
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.paper', 'LIBRARY.json'),
    JSON.stringify(libraryV2ToV3({ $schemaVersion: 2, entries: sources.map(libraryEntry) }), null, 2) + '\n',
  );
}

export const DEFAULT_ASSIGNMENT = 'Write a 1500-word expository paper on how attention mechanisms work in transformer models.';

/** Seed STATE.json, a v1 INTAKE.md and LIBRARY.json under `root/.paper/`. */
export async function seedBriefPaper(
  root: string,
  brief: IntakeBriefInput = {},
  opts: { sources?: readonly FixtureSource[]; assignment?: string } = {},
): Promise<void> {
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  await initState(root);
  const md = renderIntakeDocument(
    {
      topic: 'attention mechanisms in transformer models',
      thesis: 'Self-attention displaced recurrence because it models long-range dependencies in parallel.',
      discipline: 'computer-science',
      paper_type: 'expository',
      length_target_words: 1500,
      ...brief,
    },
    opts.assignment ?? DEFAULT_ASSIGNMENT,
    [],
  );
  fs.writeFileSync(path.join(root, '.paper', 'INTAKE.md'), md);
  writeLibrary(root, opts.sources ?? DEFAULT_SOURCES);
}

type OutlineSection = OutlineContract['sections'][number];

/** One outline section (the model's shape). */
export function outlineSection(
  n: number,
  slug: string,
  extra: Partial<OutlineSection> = {},
): OutlineSection {
  return {
    n,
    slug,
    title: slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    purpose: `Establish the ${slug.replace(/-/g, ' ')}.`,
    depends_on: [],
    estimated_word_count: 500,
    assigned_sources: [],
    role: 'body',
    ...extra,
  };
}

/** The default three-section reply: intro → background → conclusion, 1500 words. */
export function threeSectionOutline(): OutlineContract {
  return {
    thesis: 'Self-attention displaced recurrence because it models long-range dependencies in parallel.',
    sections: [
      outlineSection(1, 'introduction', { role: 'intro', assigned_sources: ['vaswani2017'] }),
      outlineSection(2, 'background', { depends_on: ['introduction'], assigned_sources: ['bahdanau2015', 'luong2015'], voice: 'plain, expository' }),
      outlineSection(3, 'conclusion', { role: 'conclusion', depends_on: ['background'], assigned_sources: ['devlin2019'] }),
    ],
  };
}

/** The mtime (ms) and bytes of every file under `dir` (relative path → fingerprint). */
export function fingerprint(dir: string): Map<string, { mtimeMs: number; bytes: string }> {
  const out = new Map<string, { mtimeMs: number; bytes: string }>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(path.relative(dir, p), { mtimeMs: fs.statSync(p).mtimeMs, bytes: fs.readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return out;
}
