// tests/disciplines-schema.test.ts — GRND-06 (PRD §8): templates/presets/
// disciplines.json holds the PRD §8 table, row by row, and bin/lib/disciplines.ts
// is its one validated loader and resolver.
//
// Every PRD §8 value is asserted (not only field presence): default citation
// style (plus the selectable alternates), source preference in order, the
// sectioning convention, the counterargument default and the per-paragraph
// citation-density band. `sociology` is the extra preset PRD §8 lists.
// Replaces the Phase 10 Wave-0 scaffold, whose assertions skipped until the
// file had six fields (it never did).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DISCIPLINES_PATH,
  PresetsFileSchema,
  loadDisciplinePresets,
  disciplineSlugs,
  normalizeDisciplineSlug,
  presetFor,
  resolveDiscipline,
  resolveLayered,
  defaultCitationStyleFor,
  densityBandFor,
  FALLBACK_DISCIPLINE,
} from '../bin/lib/disciplines.js';

interface Row {
  style: string;
  alternates: string[];
  sources: string[];
  sections: string[];
  counter: 'on' | 'off' | 'ask';
  density: [number, number];
}

// PRD §8, one row per preset (source ids: bin/lib/disciplines.ts SOURCE_PREFERENCE_IDS).
const PRD_8: Readonly<Record<string, Row>> = {
  'computer-science': {
    style: 'ieee', alternates: [], sources: ['arxiv', 'semanticscholar', 'openalex'],
    sections: ['Abstract', 'Introduction', 'Related Work', 'Methods', 'Results', 'Conclusion'], counter: 'off', density: [1, 3],
  },
  biology: {
    style: 'ama', alternates: ['vancouver'], sources: ['pubmed', 'openalex', 'crossref'],
    sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion', 'Conclusion'], counter: 'off', density: [2, 4],
  },
  history: {
    style: 'chicago-notes-bib', alternates: [], sources: ['openalex', 'jstor', 'books'],
    sections: ['Thesis', 'Body', 'Counterargument', 'Conclusion'], counter: 'on', density: [0.5, 2],
  },
  literature: {
    style: 'mla', alternates: [], sources: ['openalex', 'jstor', 'books'],
    sections: ['Thesis', 'Body', 'Counterargument', 'Conclusion'], counter: 'on', density: [0.5, 2],
  },
  psychology: {
    style: 'apa', alternates: [], sources: ['pubmed', 'psycnet', 'openalex'],
    sections: ['Abstract', 'Introduction', 'Method', 'Results', 'Discussion'], counter: 'ask', density: [2, 4],
  },
  economics: {
    style: 'apa', alternates: ['chicago-author-date'], sources: ['nber', 'openalex', 'crossref'],
    sections: ['Abstract', 'Introduction', 'Literature Review', 'Model', 'Results', 'Conclusion'], counter: 'off', density: [1, 3],
  },
  philosophy: {
    style: 'chicago-author-date', alternates: [], sources: ['openalex', 'philpapers', 'books'],
    sections: ['Thesis', 'Argument', 'Objections', 'Reply', 'Conclusion'], counter: 'on', density: [0.5, 2],
  },
  sociology: {
    style: 'apa', alternates: [], sources: ['openalex', 'crossref', 'semanticscholar'],
    sections: ['Introduction', 'Literature Review', 'Methods', 'Findings', 'Discussion', 'Conclusion'], counter: 'off', density: [1, 3],
  },
  other: {
    style: 'apa', alternates: [], sources: ['openalex', 'crossref', 'arxiv'],
    sections: [], counter: 'off', density: [1, 3],
  },
};

test('GRND-06: disciplines.json validates and holds exactly the PRD §8 presets (plus sociology)', () => {
  const raw = JSON.parse(readFileSync(DISCIPLINES_PATH, 'utf8')) as unknown;
  assert.doesNotThrow(() => PresetsFileSchema.parse(raw));
  assert.deepEqual(disciplineSlugs().sort(), Object.keys(PRD_8).sort());
});

test('GRND-06: every PRD §8 row value — style, alternates, source order, sections, counterargument, density band', () => {
  const presets = loadDisciplinePresets();
  for (const [slug, row] of Object.entries(PRD_8)) {
    const p = presets[slug];
    assert.ok(p, slug);
    assert.equal(p.defaultCitationStyle, row.style, `${slug}: citation style`);
    assert.deepEqual([...p.alternateCitationStyles], row.alternates, `${slug}: selectable styles`);
    assert.deepEqual([...p.sourcePreference], row.sources, `${slug}: source preference order`);
    assert.deepEqual([...p.sectioningConvention], row.sections, `${slug}: sectioning convention`);
    assert.equal(p.counterargDefault, row.counter, `${slug}: counterargument default`);
    assert.deepEqual([p.densityPerParagraph.min, p.densityPerParagraph.max], row.density, `${slug}: citations per paragraph`);
  }
});

test('GRND-06: an invalid preset file is rejected (unknown style, empty sources, inverted band, missing fallback)', () => {
  const good = JSON.parse(readFileSync(DISCIPLINES_PATH, 'utf8')) as { presets: Record<string, Record<string, unknown>> };
  const mutate = (fn: (f: typeof good) => void): unknown => {
    const copy = JSON.parse(JSON.stringify(good)) as typeof good;
    fn(copy);
    return copy;
  };
  assert.throws(() => PresetsFileSchema.parse(mutate((f) => { f.presets['history']!['defaultCitationStyle'] = 'turabian'; })));
  assert.throws(() => PresetsFileSchema.parse(mutate((f) => { f.presets['history']!['sourcePreference'] = []; })));
  assert.throws(() => PresetsFileSchema.parse(mutate((f) => { f.presets['history']!['densityPerParagraph'] = { min: 3, max: 1 }; })));
  assert.throws(() => PresetsFileSchema.parse(mutate((f) => { delete f.presets['other']; })));
  assert.throws(() => PresetsFileSchema.parse(mutate((f) => { f.presets['history']!['extra'] = 1; })));
});

test('GRND-06: free-text disciplines normalise to a preset; unknown text falls back to other', () => {
  const cases: Array<[string, string]> = [
    ['CS', 'computer-science'],
    ['computer science', 'computer-science'],
    ['Biology / Life Sci', 'biology'],
    ['History', 'history'],
    ['Lit', 'literature'],
    ['Psych', 'psychology'],
    ['econ, micro', 'economics'],
    ['Philosophy', 'philosophy'],
    ['sociology', 'sociology'],
    ['Other', 'other'],
    ['', FALLBACK_DISCIPLINE],
    ['underwater basket weaving', FALLBACK_DISCIPLINE],
    ['email marketing', FALLBACK_DISCIPLINE],
  ];
  for (const [text, slug] of cases) assert.equal(normalizeDisciplineSlug(text), slug, text);
  assert.equal(presetFor('no-such-preset').slug, FALLBACK_DISCIPLINE);
  assert.equal(defaultCitationStyleFor('History'), 'chicago-notes-bib');
  assert.deepEqual(densityBandFor('Biology'), { min: 2, max: 4 });
});

test('GRND-06: precedence is preset < intake answer < config.toml < CLI flag, with the winning layer named', () => {
  assert.deepEqual(resolveLayered({ preset: 'a' }), { value: 'a', source: 'preset' });
  assert.deepEqual(resolveLayered({ preset: 'a', intake: 'b' }), { value: 'b', source: 'intake' });
  assert.deepEqual(resolveLayered({ preset: 'a', intake: 'b', config: 'c' }), { value: 'c', source: 'config' });
  assert.deepEqual(resolveLayered({ preset: 'a', intake: 'b', config: 'c', flag: 'd' }), { value: 'd', source: 'flag' });
  assert.deepEqual(resolveLayered({ preset: 'a', intake: undefined, config: undefined, flag: undefined }), { value: 'a', source: 'preset' });

  const bio = resolveDiscipline({ discipline: { intake: 'Biology' }, intake: { citationStyle: 'mla' } });
  assert.deepEqual([bio.slug.value, bio.slug.source], ['biology', 'intake']);
  assert.deepEqual([bio.citationStyle.value, bio.citationStyle.source], ['mla', 'intake'], '"Use MLA" beats the AMA preset');
  const hist = resolveDiscipline({
    discipline: { intake: 'history', config: 'philosophy', flag: 'psychology' },
    config: { counterargument: 'off' },
  });
  assert.deepEqual([hist.slug.value, hist.slug.source], ['psychology', 'flag']);
  assert.deepEqual([hist.counterargument.value, hist.counterargument.source], ['off', 'config']);
  assert.deepEqual([...hist.sourcePreference], ['pubmed', 'psycnet', 'openalex']);
  assert.equal(hist.tone, presetFor('psychology').defaultTone);
  const none = resolveDiscipline({ discipline: {} });
  assert.deepEqual([none.slug.value, none.slug.source, none.citationStyle.value], [FALLBACK_DISCIPLINE, 'preset', 'apa']);
});
