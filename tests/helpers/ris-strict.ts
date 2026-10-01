// tests/helpers/ris-strict.ts — an independent, strict RIS reader for the tests
// (EXP-02, D-21-11). It shares no code with bin/lib/ris-write.ts and refuses
// anything a strict reference manager would misread:
//   - every line is `TAG  - value` (two capitals or capital+digit, two spaces,
//     a hyphen, a space) — an untagged continuation line (a wrapped value) is
//     an error, so a reader never silently drops the rest of a title;
//   - a record opens with `TY` and closes with `ER  - `; nothing between
//     records; no empty value; no stray white space in a value; LF only.

import assert from 'node:assert/strict';

export interface RisRecord {
  readonly type: string;
  readonly tags: ReadonlyMap<string, readonly string[]>;
}

/** The first value of `tag` in a record. */
export function risFirst(r: RisRecord, tag: string): string | undefined {
  return r.tags.get(tag)?.[0];
}

/** Every value of `tag` in a record, in order. */
export function risAll(r: RisRecord, tag: string): readonly string[] {
  return r.tags.get(tag) ?? [];
}

/** Parse RIS strictly; throws naming the line on anything a strict reader would misread. */
export function parseRisStrict(text: string): RisRecord[] {
  if (text === '') return [];
  if (text.includes('\r')) throw new Error('a carriage return in the file (LF only)');
  if (!text.endsWith('\n')) throw new Error('the file does not end with a newline');
  const lines = text.slice(0, -1).split('\n');
  const records: RisRecord[] = [];
  let cur: { type: string; tags: Map<string, string[]> } | null = null;
  for (const [i, line] of lines.entries()) {
    const m = /^([A-Z][A-Z0-9]) {2}- (.*)$/.exec(line);
    if (m === null) throw new Error(`line ${i + 1} is not "TAG  - value" (a wrapped or stray line): ${JSON.stringify(line)}`);
    const tag = m[1] as string;
    const value = m[2] as string;
    if (cur === null) {
      if (tag !== 'TY') throw new Error(`line ${i + 1}: ${tag} outside a record (a record opens with TY)`);
      if (value === '') throw new Error(`line ${i + 1}: TY with no type`);
      cur = { type: value, tags: new Map() };
      continue;
    }
    if (tag === 'TY') throw new Error(`line ${i + 1}: TY inside an open record (ER missing)`);
    if (tag === 'ER') {
      if (value !== '') throw new Error(`line ${i + 1}: ER carries a value`);
      records.push(cur);
      cur = null;
      continue;
    }
    if (value === '') throw new Error(`line ${i + 1}: ${tag} with an empty value`);
    if (value !== value.trim() || /\s{2}/u.test(value)) throw new Error(`line ${i + 1}: ${tag} value has stray white space: ${JSON.stringify(value)}`);
    const list = cur.tags.get(tag) ?? [];
    list.push(value);
    cur.tags.set(tag, list);
  }
  if (cur !== null) throw new Error('the last record is not closed with ER');
  return records;
}

/** The records by their `ID` (each must carry exactly one, unique). */
export function risById(records: readonly RisRecord[]): Map<string, RisRecord> {
  const map = new Map<string, RisRecord>();
  for (const r of records) {
    const ids = risAll(r, 'ID');
    assert.equal(ids.length, 1, `every record carries one ID:\n${JSON.stringify([...r.tags])}`);
    const id = ids[0] as string;
    assert.ok(!map.has(id), `ID ${id} appears once`);
    map.set(id, r);
  }
  return map;
}
