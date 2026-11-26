// bin/lib/config-edit.ts — set keys in .paper/config.toml without losing the
// rest of the file.
//
// Parsing a TOML file and writing it back drops every comment and the
// author's layout, so a setting is changed by editing its line in place:
// an existing `key = …` line in the table is replaced, a missing key is added
// at the end of its table, and a missing table is appended. The result is
// parsed again before it is written; if the file could not be edited that way
// (it does not parse, or holds the table in a form this edit cannot change,
// such as an inline table), it is left as it is and the caller is told.

import { existsSync, readFileSync } from 'node:fs';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { atomicWriteFile } from './atomic-write.js';
import { escapeRe } from './citation-grammar.js';

type Scalar = string | number | boolean;

const HEADER = /^\s*\[\s*([A-Za-z0-9_-]+)\s*\]\s*(?:#.*)?$/;
const ANY_HEADER = /^\s*\[/;

function keyLine(key: string, value: Scalar): string {
  return stringifyToml({ [key]: value }).trim();
}

function edit(text: string, table: string, values: Record<string, Scalar>): string {
  const lines = text.split(/\r?\n/);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const start = lines.findIndex((l) => HEADER.exec(l)?.[1] === table);
  if (start === -1) {
    const body = Object.entries(values).map(([k, v]) => keyLine(k, v));
    const sep = text === '' ? '' : text.endsWith('\n') ? nl : nl + nl;
    return `${text}${sep}[${table}]${nl}${body.join(nl)}${nl}`;
  }
  for (const [key, value] of Object.entries(values)) {
    let end = lines.findIndex((l, i) => i > start && ANY_HEADER.test(l));
    if (end === -1) end = lines.length;
    const keyRe = new RegExp(`^\\s*${escapeRe(key)}\\s*=`);
    const at = lines.findIndex((l, i) => i > start && i < end && keyRe.test(l));
    if (at !== -1) {
      lines[at] = keyLine(key, value);
      continue;
    }
    // After the table's last non-blank line.
    let last = end - 1;
    while (last > start && lines[last]!.trim() === '') last -= 1;
    lines.splice(last + 1, 0, keyLine(key, value));
  }
  return lines.join(nl);
}

/**
 * Set `values` under `[table]` in the TOML file at `file` (created when
 * missing). Returns null when written, else why the file was left unchanged.
 */
export async function setConfigValues(file: string, table: string, values: Record<string, Scalar>): Promise<string | null> {
  if (Object.keys(values).length === 0) return null;
  let text = '';
  if (existsSync(file)) {
    text = readFileSync(file, 'utf8');
    try {
      parseToml(text);
    } catch (e) {
      return `it does not parse as TOML (${(e as Error).message})`;
    }
  }
  const next = edit(text, table, values);
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(next) as Record<string, unknown>;
  } catch (e) {
    return `its [${table}] table could not be edited in place (${(e as Error).message})`;
  }
  const t = parsed[table] as Record<string, unknown> | undefined;
  for (const [k, v] of Object.entries(values)) {
    if (t?.[k] !== v) return `its [${table}] table could not be edited in place`;
  }
  if (next !== text) await atomicWriteFile(file, next);
  return null;
}
