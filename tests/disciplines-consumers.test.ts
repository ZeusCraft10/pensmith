// tests/disciplines-consumers.test.ts — GRND-06 (D-18-13): one discipline-preset
// loader feeds every consumer.
//
//   - grep: no shipped module but bin/lib/disciplines.ts maps a discipline to a
//     style, a density, sections or a tone — no discipline-slug string literal,
//     no identifier-keyed discipline table (`history: …`, `cs: …`), and the
//     removed private tables (intake-parse.ts DISCIPLINE_MAP, citation-density.ts
//     DISCIPLINE_TARGETS, citations.ts's style map) stay gone;
//   - the consumers answer exactly what the preset table says: citations.ts
//     resolveStyleName, citation-density.ts bands, intake-parse.ts
//     normalisation, the intake battery's discipline options and defaults,
//     and the clarifier request's `disciplines` block.
// (The PRD §8 values themselves and the preset < intake < config < flag
// precedence are pinned in tests/disciplines-schema.test.ts.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultCitationStyleFor,
  densityBandFor,
  disciplineSlugs,
  loadDisciplinePresets,
  normalizeDisciplineSlug,
  presetFor,
} from '../bin/lib/disciplines.js';
import { resolveStyleName } from '../bin/lib/citations.js';
import { computeCitationDensity } from '../bin/lib/citation-density.js';
import { parseIntakeMd } from '../bin/lib/intake-parse.js';
import { Q, intakeQuestions } from '../bin/lib/intake-questions.js';
import { buildPromptRequest, requestHints } from '../bin/lib/prompt-request.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(?:ts|mts|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** Code lines only (line comments and block-comment bodies dropped). */
function code(text: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) continue;
    out.push(line.replace(/\s\/\/.*$/, ''));
  }
  return out.join('\n');
}

const SLUGS = ['computer-science', 'biology', 'history', 'literature', 'psychology', 'economics', 'philosophy', 'sociology'];
const ABBREVIATIONS = ['cs', 'bio', 'hist', 'lit', 'psych', 'econ', 'phil', 'soc'];

test('GRND-06 grep: no module but bin/lib/disciplines.ts holds a discipline slug, a discipline-keyed table or the removed private maps', () => {
  const files = ['bin', 'mcp', 'hooks'].flatMap((d) => walk(join(REPO, d)));
  assert.ok(files.length > 50, 'the tree was scanned');
  const quoted = new RegExp(`['"\`](?:${SLUGS.join('|')})['"\`]`);
  const keyed = new RegExp(`(?:^|[{,\\s])(?:${[...SLUGS.map((s) => s.replace('-', '[-_]?')), ...ABBREVIATIONS].join('|')})\\s*:\\s*['"\\d]`, 'm');
  const removed = /\b(?:DISCIPLINE_MAP|DISCIPLINE_TARGETS)\b/;
  const offenders: string[] = [];
  for (const f of files) {
    const rel = relative(REPO, f).split('\\').join('/');
    if (rel === 'bin/lib/disciplines.ts') continue;
    const c = code(readFileSync(f, 'utf8'));
    for (const [name, re] of [['slug literal', quoted], ['discipline-keyed table', keyed], ['removed private map', removed]] as const) {
      const m = re.exec(c);
      if (m) offenders.push(`${rel}: ${name} ${JSON.stringify(m[0])}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('GRND-06: citations.ts resolveStyleName is the preset\'s default style, for every slug, name and alias', () => {
  for (const p of Object.values(loadDisciplinePresets())) {
    for (const name of [p.slug, p.name, ...p.aliases]) {
      assert.equal(resolveStyleName(name), p.defaultCitationStyle, `${name} → ${p.defaultCitationStyle}`);
      assert.equal(resolveStyleName(name), defaultCitationStyleFor(name));
    }
  }
  assert.equal(resolveStyleName('unknown field'), presetFor('other').defaultCitationStyle);
});

test('GRND-06: citation-density.ts uses the preset\'s per-paragraph band', () => {
  for (const slug of disciplineSlugs()) {
    assert.deepEqual(computeCitationDensity([], slug).band, densityBandFor(slug), slug);
    assert.deepEqual(computeCitationDensity([], presetFor(slug).name).band, presetFor(slug).densityPerParagraph);
  }
});

test('GRND-06: intake-parse.ts normalises through disciplines.ts (no private map)', () => {
  for (const p of Object.values(loadDisciplinePresets())) {
    for (const name of [p.slug, p.name, ...p.aliases]) {
      assert.equal(parseIntakeMd(`Discipline: ${name}\n`).discipline, normalizeDisciplineSlug(name), name);
    }
  }
});

test('GRND-06: the intake battery offers every preset and the clarifier is told every preset', () => {
  const d = intakeQuestions().find((q) => q.id === Q.discipline)!;
  assert.deepEqual(d.options.map((o) => o.value), disciplineSlugs());
  assert.deepEqual(d.options.map((o) => o.label), disciplineSlugs().map((s) => presetFor(s).name));
  const req = buildPromptRequest('intake-clarifier', {
    disciplines: disciplineSlugs().map((slug) => ({ slug, name: presetFor(slug).name })),
    assignment: 'Write about tides.',
  });
  assert.deepEqual(requestHints(req)['disciplines'], disciplineSlugs().map((slug) => ({ slug, name: presetFor(slug).name })));
});
