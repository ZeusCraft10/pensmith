// tests/person-name.test.ts — SRC-12 (D-19-19): author / editor strings parse
// into family / given / suffix exactly as the BibTeX writer needs them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonName, formatPersonName } from '../bin/lib/person-name.js';

const CASES: Array<[string, { family: string; given?: string; suffix?: string; literal?: boolean }]> = [
  // "Family, Given"
  ['Эсенаманов, Байэл', { family: 'Эсенаманов', given: 'Байэл' }],
  ['Παπαδόπουλος, Γιώργος', { family: 'Παπαδόπουλος', given: 'Γιώργος' }],
  ['van der Maaten, Ernst', { family: 'van der Maaten', given: 'Ernst' }],
  ['LeCun, Yann', { family: 'LeCun', given: 'Yann' }],
  ['Kuhn, Thomas S.', { family: 'Kuhn', given: 'Thomas S.' }],
  // "Family, Given, Suffix" (D-19-19) and BibTeX's "Family, Jr, Given"
  ['King, Martin Luther, Jr.', { family: 'King', given: 'Martin Luther', suffix: 'Jr.' }],
  ['King, Jr., Martin Luther', { family: 'King', given: 'Martin Luther', suffix: 'Jr.' }],
  // "Given Family"
  ['Ashish Vaswani', { family: 'Vaswani', given: 'Ashish' }],
  ['Aidan N. Gomez', { family: 'Gomez', given: 'Aidan N.' }],
  ['Laurens van der Maaten', { family: 'van der Maaten', given: 'Laurens' }],
  ['Jean de la Fontaine', { family: 'de la Fontaine', given: 'Jean' }],
  ['Ludwig von Mises', { family: 'von Mises', given: 'Ludwig' }],
  ['Ibn bin Laden', { family: 'bin Laden', given: 'Ibn' }],
  ['Martin Luther King Jr.', { family: 'King', given: 'Martin Luther', suffix: 'Jr.' }],
  // "Van" capitalized at the start is a given name, not a particle
  ['Van Morrison', { family: 'Morrison', given: 'Van' }],
  // a display name starting with a particle has no given name
  ['de la Fontaine', { family: 'de la Fontaine' }],
  // a single token is the family
  ['王小明', { family: '王小明' }],
  ['Aristotle', { family: 'Aristotle' }],
  // a braced corporate name is one literal name
  ['{ENCODE Project Consortium}', { family: 'ENCODE Project Consortium', literal: true }],
  ['{Smith, Jones & Co}', { family: 'Smith, Jones & Co', literal: true }],
];

for (const [input, want] of CASES) {
  test(`SRC-12: parsePersonName(${JSON.stringify(input)})`, () => {
    const got = parsePersonName(input);
    assert.ok(got);
    assert.deepEqual({ ...got }, want);
  });
}

test('SRC-12: whitespace is collapsed and Unicode NFC-normalized; empty input is null', () => {
  assert.deepEqual(parsePersonName('  Müller ,   Jürgen  '), { family: 'Müller', given: 'Jürgen' });
  assert.equal(parsePersonName(''), null);
  assert.equal(parsePersonName('   '), null);
  assert.equal(parsePersonName('{}'), null);
});

test('SRC-12: formatPersonName is the inverse of parsePersonName', () => {
  for (const [input] of CASES) {
    const parsed = parsePersonName(input)!;
    assert.deepEqual(parsePersonName(formatPersonName(parsed)), parsed, input);
  }
});

test('SRC-12: PubMed compact names ("Zhu N") become "Family, Initials" and parse with the right family', async () => {
  const { fromPubmedCompactName } = await import('../bin/lib/person-name.js');
  const cases: Array<[string, string, { family: string; given?: string; suffix?: string }]> = [
    ['Zhu N', 'Zhu, N.', { family: 'Zhu', given: 'N.' }],
    ['Gao GF', 'Gao, G. F.', { family: 'Gao', given: 'G. F.' }],
    ['van den Berg R', 'van den Berg, R.', { family: 'van den Berg', given: 'R.' }],
    ['King ML Jr', 'King, M. L., Jr', { family: 'King', given: 'M. L.', suffix: 'Jr' }],
    ['Smith J 3rd', 'Smith, J., 3rd', { family: 'Smith', given: 'J.', suffix: '3rd' }],
    ['Öztürk Ö', 'Öztürk, Ö.', { family: 'Öztürk', given: 'Ö.' }],
    ['Garcia-Lopez JA', 'Garcia-Lopez, J. A.', { family: 'Garcia-Lopez', given: 'J. A.' }],
  ];
  for (const [input, display, parsed] of cases) {
    const out = fromPubmedCompactName(input);
    assert.equal(out, display, input);
    assert.deepEqual({ ...parsePersonName(out)! }, parsed, input);
  }
  // Not the compact form: returned unchanged.
  for (const s of ['Zhu, N.', '{China Novel Coronavirus Investigating and Research Team}', 'Aristotle', 'Ashish Vaswani', 'Na Zhu', '']) {
    assert.equal(fromPubmedCompactName(s), s, s);
  }
});

test('SRC-12: a registrar display name that reads as a group is braced (one literal name); a person\'s name is not', async () => {
  const { displayAuthorName, isGroupDisplayName } = await import('../bin/lib/person-name.js');
  const groups: Array<[string, string]> = [
    [' The ATLAS Collaboration', '{The ATLAS Collaboration}'],
    ['CMS Collaboration', '{CMS Collaboration}'],
    ['Gemini Team', '{Gemini Team}'],
    ['Dphep Study Group', '{Dphep Study Group}'],
    ['World Health Organization', '{World Health Organization}'],
    ['The SPRINT Research Group', '{The SPRINT Research Group}'],
    ['PIONEER Investigators', '{PIONEER Investigators}'],
    ['ENCODE Project Consortium', '{ENCODE Project Consortium}'],
    ['Open Science Collaboration.', '{Open Science Collaboration.}'],
  ];
  for (const [input, want] of groups) {
    assert.equal(isGroupDisplayName(input), true, input);
    assert.equal(displayAuthorName(input), want, input);
    const parsed = parsePersonName(want)!;
    assert.equal(parsed.literal, true, input);
    assert.equal(parsed.family, want.slice(1, -1), input);
  }
  for (const person of ['Ashish Vaswani', 'Laurens van der Maaten', 'Martin Luther King Jr.', 'Aristotle', 'Vaswani, Ashish', '{Already Braced Consortium}', 'Thea Group-Smith', 'Grace Hopper', 'Theodore Groupman']) {
    assert.equal(isGroupDisplayName(person), false, person);
  }
  assert.equal(displayAuthorName('  Ashish   Vaswani '), 'Ashish Vaswani', 'whitespace collapsed, otherwise unchanged');
});
