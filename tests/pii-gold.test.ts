// tests/pii-gold.test.ts — GRND-05 (D-18-12): opt-in PII redaction is precise.
//
//   - the gold set (tests/fixtures/pii/gold.json): recall 1.0 on the annotated
//     PII (names with middle initials, hyphens, particles and apostrophes;
//     labelled IDs; textual dates; emails; phones) and every entity phrase,
//     month fragment and identifier kept verbatim;
//   - identifiers are never rewritten, by redactPii or by the session log's
//     deepRedactPii: a fast-check property over 10 000 random v4 UUIDs, plus
//     DOIs, ISBNs, arXiv ids and ISO-8601 timestamps (today's paperIds used to
//     log as `1[REDACTED:PHONE]-4333-…`);
//   - the intake keep list: the assignment's labelled topic line is never
//     redacted as a NAME, while the same name elsewhere is kept only when the
//     line names it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as fc from 'fast-check';
import { classifyPii, deepRedactPii, diffPii, protectedSpans, redactPii } from '../bin/lib/pii.js';
import { labelledTopicLines } from '../bin/lib/intake-overrides.js';

interface GoldItem {
  id: string;
  text: string;
  pii: string[];
  keep: string[];
  keep_terms?: string[];
}

const GOLD = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/pii/gold.json', import.meta.url)), 'utf8'),
) as { items: GoldItem[] };

test('GRND-05 gold set: recall 1.0 on the PII items, every keep phrase verbatim', () => {
  let found = 0;
  let total = 0;
  const misses: string[] = [];
  for (const item of GOLD.items) {
    const keep = item.keep_terms ?? labelledTopicLines(item.text);
    const out = redactPii(item.text, { keep });
    for (const p of item.pii) {
      total += 1;
      if (out.includes(p)) misses.push(`${item.id}: "${p}" survived → ${JSON.stringify(out)}`);
      else found += 1;
    }
    for (const k of item.keep) {
      assert.ok(out.includes(k), `${item.id}: "${k}" must be kept → ${JSON.stringify(out)}`);
    }
  }
  assert.deepEqual(misses, [], `recall ${found}/${total}`);
  assert.equal(found, total);
  assert.ok(total >= 30, `the gold set is not trivially small (${total} PII items)`);
});

test('GRND-05: the named precision cases — "French Revolution", "Treaty of Versailles", "Due March" are never redacted', () => {
  for (const text of [
    'Due March. The French Revolution and the Treaty of Versailles.',
    'Essay on the French Revolution (due March).',
    'Due March: the Treaty of Versailles.',
  ]) {
    const out = redactPii(text);
    for (const k of ['French Revolution', 'Treaty of Versailles']) if (text.includes(k)) assert.ok(out.includes(k), `${k} kept in ${out}`);
    assert.ok(/Due March|due March/.test(out), `the month fragment stays: ${out}`);
  }
  assert.equal(redactPii('Due March 14.'), 'Due [REDACTED:DATE].', 'a day turns the fragment into a date');
});

test('GRND-05: classes — middle initials, hyphens, particles, labelled IDs and textual dates each classify', () => {
  const cases: Array<[string, string, string]> = [
    ['Signed, Jane Q. Doe.', 'NAME', 'Jane Q. Doe'],
    ['by Mary-Anne Smith today', 'NAME', 'Mary-Anne Smith'],
    ['Prof. Karl-Heinz van der Berg', 'NAME', 'Karl-Heinz van der Berg'],
    ['TA María de la Cruz', 'NAME', 'María de la Cruz'],
    ['Office: Dr. Okafor', 'NAME', 'Okafor'],
    ['Student ID: 2024-00173', 'ID', '2024-00173'],
    ['ID no. 44-1234', 'ID', '44-1234'],
    ['SSN: 123456789', 'ID', '123456789'],
    ['born March 3, 2026', 'DATE', 'March 3, 2026'],
    ['born 3 March 2026', 'DATE', '3 March 2026'],
    ['due Mar. 3', 'DATE', 'Mar. 3'],
    ['call +44 20 7946 0958', 'PHONE', '+44 20 7946 0958'],
    ["mail j.o'brien@example.org", 'EMAIL', "j.o'brien@example.org"],
  ];
  for (const [text, kind, raw] of cases) {
    const hit = classifyPii(text).find((m) => m.kind === kind && m.raw === raw);
    assert.ok(hit, `${kind} "${raw}" in ${JSON.stringify(text)} → ${JSON.stringify(classifyPii(text))}`);
  }
  // Only the value of a labelled ID is replaced; the label stays readable.
  assert.equal(redactPii('Student ID: 2024-00173'), 'Student ID: [REDACTED:ID]');
});

test('GRND-05: the keep list (a labelled topic line) protects names the paper is about, and only those', () => {
  const text = 'Topic: Abraham Lincoln\nStudent: Jane Sentinel\nWrite about Abraham Lincoln.';
  const keep = labelledTopicLines(text);
  assert.deepEqual(keep, ['Abraham Lincoln']);
  const out = redactPii(text, { keep });
  assert.ok(out.includes('Write about Abraham Lincoln.'), out);
  assert.ok(!out.includes('Jane Sentinel'), out);
  assert.ok(!redactPii(text).includes('Abraham Lincoln'), 'without the keep list the name is redacted (recall first)');
  assert.deepEqual(diffPii(text, undefined, { keep }).map((d) => d.raw), ['Jane Sentinel']);
});

test('GRND-05 property: 10 000 random v4 UUIDs pass through redactPii and deepRedactPii unchanged', () => {
  fc.assert(
    fc.property(fc.uuid({ version: 4 }), (uuid) => {
      assert.equal(redactPii(uuid), uuid);
      assert.equal(redactPii(`paperId ${uuid} logged`), `paperId ${uuid} logged`);
      const rec = deepRedactPii({ paperId: uuid, nested: [{ id: uuid }], note: `${uuid}` }) as Record<string, unknown>;
      assert.equal(rec['paperId'], uuid);
      assert.equal(rec['note'], uuid);
      assert.equal(((rec['nested'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)['id'], uuid);
    }),
    { numRuns: 10_000 },
  );
});

test('GRND-05: DOIs, ISBNs, arXiv ids and ISO-8601 timestamps are never rewritten (session-log path included)', () => {
  const ids = [
    '10.1038/nphys1170',
    'https://doi.org/10.1145/3292500.3330701',
    '10.5555/555-201-7788',
    'ISBN 978-0-306-40615-7',
    'ISBN-10: 0-306-40615-2',
    '9780306406157',
    'arXiv:2305.12345v2',
    '1706.03762',
    'hep-th/9901001',
    '2026-09-28T04:00:45.123Z',
    '2026-09-28T04:00:45+02:00',
    '3f2a9c0d1e4b5a6978e1f2a3b4c5d6e7',
  ];
  for (const id of ids) {
    assert.equal(redactPii(id), id, `${id} unchanged`);
    assert.equal(redactPii(`see ${id}.`), `see ${id}.`, `${id} unchanged in a sentence`);
    assert.equal(deepRedactPii({ v: id }) && (deepRedactPii({ v: id }) as Record<string, string>)['v'], id);
    assert.ok(protectedSpans(id).length > 0, `${id} is a protected identifier`);
  }
  // A plain ISO date is still a date (a date of birth is PII); a timestamp is not.
  assert.equal(redactPii('born 2004-03-03'), 'born [REDACTED:DATE]');
});

test('GRND-05: redaction is idempotent and CRLF-safe', () => {
  for (const item of GOLD.items) {
    const keep = item.keep_terms ?? labelledTopicLines(item.text);
    const once = redactPii(item.text, { keep });
    assert.equal(redactPii(once, { keep }), once, `${item.id}: idempotent`);
    const crlf = item.text.replace(/\r?\n/g, '\r\n');
    const lf = item.text.replace(/\r\n/g, '\n');
    assert.equal(redactPii(crlf, { keep }).replace(/\r\n/g, '\n'), redactPii(lf, { keep }), `${item.id}: CRLF and LF redact alike`);
  }
});
