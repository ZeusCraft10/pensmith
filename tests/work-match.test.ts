// tests/work-match.test.ts — the title, author, year and journal comparison
// Pass 1 runs between a bibliography entry and a registry record.
//
// Cases a raw string similarity got wrong in both directions: real titles
// blocked for markup, entities, spelling or a missing subtitle, and different
// works passed because only one word or one number told them apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTitle, matchWork, stripMarkup, venuesMatch, type ClaimedWork } from '../bin/lib/verify/work-match.js';
import type { WorkName, WorkRecord } from '../bin/lib/sources/work-record.js';

function record(over: Partial<WorkRecord>): WorkRecord {
  return { registry: 'Crossref', title: '', authors: [], years: [], venues: [], journalArticle: false, raw: {}, ...over };
}

const titleOk = (claimed: string, title: string, subtitle?: string): boolean =>
  matchTitle(claimed, subtitle ? { title, subtitle } : { title }).ok;

test('titles: markup, entities, case and punctuation do not make a title different', () => {
  assert.ok(titleOk('Measurement of the Higgs boson mass in pp collisions at √s = 7 and 8 TeV',
    'Measurement of the Higgs Boson Mass in\n <mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML"><mml:mi>p</mml:mi><mml:mi>p</mml:mi></mml:math>\n Collisions at <mml:math><mml:msqrt><mml:mi>s</mml:mi></mml:msqrt><mml:mo>=</mml:mo><mml:mn>7</mml:mn></mml:math> and 8 TeV'));
  assert.ok(titleOk('Computing in Science & Engineering', 'Computing in Science &amp; Engineering'));
  assert.ok(titleOk('Attention is all you need.', 'Attention Is All You Need'));
  assert.ok(titleOk('Pretraining deep bidirectional transformers', 'Pre-training of Deep Bidirectional Transformers'));
  assert.ok(titleOk('Modelling tumour behaviour', 'Modeling tumor behavior'));
  assert.ok(titleOk('Nature vs. nurture in twins', 'Nature versus nurture in twins'));
  assert.ok(titleOk('alpha-synuclein aggregation in vivo', '<i>α</i>-Synuclein aggregation <i>in vivo</i>'));
  assert.equal(stripMarkup('p &lt; 0.05 and x < y'), 'p < 0.05 and x < y');
});

test('titles: a subtitle may be missing on either side, but not replaced by another', () => {
  assert.ok(titleOk('The NumPy array', 'The NumPy Array: A Structure for Efficient Numerical Computation'));
  assert.ok(titleOk('EcoGene: a genome sequence database for Escherichia coli K-12', 'EcoGene'), 'a registry title without the subtitle');
  assert.ok(titleOk('Deep learning: A critical appraisal', 'Deep learning', 'A critical appraisal'), 'Crossref keeps the subtitle in its own field');
  assert.ok(!titleOk('Deep learning: Methods and applications', 'Deep learning: A critical appraisal'));
  assert.ok(!titleOk('BERT', 'BERT: Pre-training of Deep Bidirectional Transformers'), 'a one-word main title is too little');
});

test('titles: one changed content word or number makes a different work', () => {
  assert.ok(!titleOk('Deep residual learning for image segmentation', 'Deep residual learning for image recognition'));
  assert.ok(!titleOk('Insulin increases glucose uptake in muscle', 'Insulin decreases glucose uptake in muscle'));
  assert.ok(!titleOk('The effect of X on male mice', 'The effect of X on female mice'));
  assert.ok(!titleOk('Language models are few-shot learners', 'Language models are unsupervised multitask learners'));
  assert.ok(!titleOk('Mechanisms of fatigue: Part I', 'Mechanisms of fatigue: Part II'));
  assert.ok(!titleOk('Mechanisms of fatigue, Part 2', 'Mechanisms of fatigue, Part III'));
  assert.ok(titleOk('Mechanisms of fatigue, Part 2', 'Mechanisms of Fatigue, Part II'), 'a roman numeral is its number');
  assert.ok(!titleOk('GPT-4 technical report', 'GPT-3 technical report'));
  assert.ok(!titleOk('Comparison of the complete Escherichia coli K-13 genome', 'Comparison of the complete <i>Escherichia coli</i> K-12 genome'));
});

test('titles: a typo in a long word is tolerated, a different short word is not', () => {
  assert.ok(titleOk('Attnetion mechanisms in neural translation', 'Attention mechanisms in neural translation'));
  assert.ok(!titleOk('Mouse models of disease', 'Moose models of disease'));
});

test('titles in scripts without spaces are compared character by character', () => {
  assert.ok(titleOk('起業者の情報行動からみた公共図書館のビジネス支援サービス',
    '起業者の情報行動からみた公共図書館のビジネス支援サービス : ある自治体のビジネス相談会の事例に基づく分析'));
  assert.ok(!titleOk('起業者の情報行動からみた大学図書館のビジネス支援サービス',
    '起業者の情報行動からみた公共図書館のビジネス支援サービス'));
});

const names = (...n: WorkName[]): WorkName[] => n;

function authorsOk(claimed: WorkName[], actual: WorkName[]): boolean {
  const c: ClaimedWork = { title: 'A study', authors: claimed };
  return matchWork(c, record({ title: 'A study', authors: actual })).ok;
}

test('authors: particles, structure, transliteration and suffixes do not change a surname', () => {
  assert.ok(authorsOk(names({ family: 'Walt', given: 'Stéfan', particle: 'van der' }), names({ family: 'van der Walt', given: 'Stefan' })));
  assert.ok(authorsOk(names({ family: 'van der Walt', given: 'S.' }), names({ text: 'Stéfan van der Walt' })));
  assert.ok(authorsOk(names({ family: 'Vaswani', given: 'Ashish' }), names({ text: 'Vaswani A' })));
  assert.ok(authorsOk(names({ family: 'Mueller', given: 'K.' }), names({ family: 'Müller', given: 'Klaus' })));
  assert.ok(authorsOk(names({ family: 'Smith', given: 'John', suffix: 'Jr.' }), names({ family: 'Smith Jr.', given: 'John' })));
  assert.ok(authorsOk(names({ family: 'García Márquez', given: 'Gabriel' }), names({ text: 'Gabriel García Márquez' })));
  assert.ok(authorsOk(names({ family: 'Márquez', given: 'G.' }), names({ family: 'García Márquez', given: 'Gabriel' })));
  assert.ok(authorsOk(names({ family: '滑川', given: '貴之' }), names({ family: '滑川', given: '貴之' })));
  assert.ok(!authorsOk(names({ family: '山田', given: '太郎' }), names({ family: '山本', given: '太郎' })));
  assert.ok(authorsOk(names({ family: 'Wang', given: 'Li' }), names({ family: 'Li', given: 'Wang' })), 'family and given swapped by the registry');
  assert.ok(!authorsOk(names({ family: 'Wang', given: 'Li' }), names({ family: 'Li', given: 'Wei' })));
});

test('authors: corporate names match by their telling words, not by "Collaboration"', () => {
  assert.ok(authorsOk(names({ family: 'The ENCODE Project Consortium' }), names({ literal: 'ENCODE Project Consortium' })));
  assert.ok(authorsOk(names({ literal: 'World Health Organization' }), names({ literal: 'World Health Organization (WHO)' })));
  assert.ok(!authorsOk(names({ literal: 'CMS Collaboration' }), names({ literal: 'ATLAS Collaboration' })));
  assert.ok(authorsOk(names({ literal: 'ATLAS Collaboration' }), names({ family: 'Aad', given: 'G.' }, { literal: 'ATLAS Collaboration' })),
    'a consortium listed after the people');
});

test('authors: a truncated list ("and others") is fine; an invented co-author is not', () => {
  const work = names({ family: 'Vaswani', given: 'A.' }, { family: 'Shazeer', given: 'N.' }, { family: 'Parmar', given: 'N.' });
  assert.ok(authorsOk(names({ family: 'Vaswani', given: 'Ashish' }, { family: 'others' }), work));
  assert.ok(authorsOk(names({ family: 'Vaswani', given: 'Ashish' }, { family: 'Parmar', given: 'Niki' }), work));
  assert.ok(!authorsOk(names({ family: 'Vaswani', given: 'Ashish' }, { family: 'Hinton', given: 'Geoffrey' }), work));
  assert.ok(!authorsOk(names({ family: 'Shazeer', given: 'Noam' }, { family: 'Vaswani', given: 'Ashish' }), work), 'the first author must be first');
});

test('authors: a record that lists no authors gives nothing to compare, and says so', () => {
  const m = matchWork({ title: 'A study', authors: names({ family: 'Doe', given: 'J.' }) }, record({ title: 'A study' }));
  assert.ok(m.ok);
  assert.match(m.notes.join(' '), /lists no authors/);
});

test('year: within one year of a year the record gives', () => {
  const base = { title: 'A study', authors: names({ family: 'Doe', given: 'J.' }) };
  const rec = record({ title: 'A study', authors: names({ family: 'Doe', given: 'Jane' }), years: [2019, 2020] });
  assert.ok(matchWork({ ...base, year: 2021 }, rec).ok);
  assert.ok(matchWork({ ...base, year: 2018 }, rec).ok);
  assert.ok(!matchWork({ ...base, year: 2022 }, rec).ok);
  assert.ok(matchWork(base, rec).ok, 'an entry with no year is not compared');
});

test('journals: abbreviations and acronyms match; a different journal does not', () => {
  assert.ok(venuesMatch('Phys. Rev. Lett.', 'Physical Review Letters'));
  assert.ok(venuesMatch('Proc. Natl. Acad. Sci. U.S.A.', 'Proceedings of the National Academy of Sciences'));
  assert.ok(venuesMatch('PNAS', 'Proceedings National Academy Sciences'));
  assert.ok(venuesMatch('J. Am. Chem. Soc.', 'Journal of the American Chemical Society'));
  assert.ok(venuesMatch('The Lancet', 'Lancet'));
  assert.ok(!venuesMatch('Nature', 'Science'));
  assert.ok(!venuesMatch('Journal of Biology', 'Journal of Chemistry'));
  const base = { title: 'A study', authors: names({ family: 'Doe', given: 'J.' }) };
  const article = record({ title: 'A study', authors: names({ family: 'Doe', given: 'Jane' }), venues: ['Science'], journalArticle: true });
  assert.ok(!matchWork({ ...base, venue: 'Nature' }, article).ok);
  assert.ok(matchWork({ ...base, venue: 'arXiv preprint arXiv:2001.00001' }, article).ok, 'a preprint venue is not compared');
  assert.ok(matchWork({ ...base, venue: 'Nature' }, { ...article, journalArticle: false }).ok, 'only a journal article\'s journal is compared');
});
