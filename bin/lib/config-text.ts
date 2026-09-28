// bin/lib/config-text.ts — comment-preserving edits of a TOML document (CONF-01).
//
// config.ts writes `.paper/config.toml` back when it migrates an older file and
// when `pensmith new` updates a key. Re-serializing the parsed object would
// delete every comment the user wrote (PRD §7 tells power users to edit the
// file by hand) and turn TOML dates into strings. editTomlText instead applies
// the DIFFERENCE between the file's parsed value and the value to write as
// line edits:
//   - a changed or added top-level scalar / depth-1 table key → its line is
//     replaced (keeping a trailing `# comment`) or a new `key = value` line is
//     inserted (a new top-level key before the first table, after the header
//     comment block; a new table key after the table's last key; a new table
//     appended at the end);
//   - a removed key → its line is deleted.
// Every untouched line — comments, blank lines, key order, TOML dates, quoting
// — stays byte-identical. The result is re-parsed and must equal the value to
// write exactly; anything this editor cannot express (nested tables such as
// [runtime.slugs.<slug>], arrays of tables, multi-line values that change)
// returns null and the caller falls back to a full re-serialization.
//
// Pure: no fs, no TOML dependency (config.ts passes its parser and renderer, so
// smol-toml stays behind the config-toml chokepoint).

export interface TomlEditIo {
  /** Parse TOML text into the normalized value config.ts compares against. */
  reparse(text: string): Record<string, unknown>;
  /** Render one `key = value` line (no newline). */
  render(key: string, value: unknown): string;
  /** A top-level key that belongs first in the file (schema_version). */
  leadingKey?: string;
}

type Op =
  | { kind: 'set'; table: string | null; key: string; value: unknown }
  | { kind: 'delete'; table: string | null; key: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** Deep equality over parsed TOML values (key order ignored). */
export function tomlValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => tomlValueEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && tomlValueEqual(a[k], b[k]));
  }
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  return false;
}

/** A value one `key = value` line can hold (no table, no array of tables). */
function isLineValue(v: unknown): boolean {
  if (isPlainObject(v)) return false;
  if (Array.isArray(v)) return v.every((x) => !isPlainObject(x));
  return true;
}

/** The ops that turn `before` into `after`, or null when one is not a line edit. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>): Op[] | null {
  const ops: Op[] = [];
  for (const [key, value] of Object.entries(after)) {
    const old = before[key];
    if (isPlainObject(value)) {
      if (old !== undefined && !isPlainObject(old)) return null;
      const oldTable = (old as Record<string, unknown> | undefined) ?? {};
      for (const [k, v] of Object.entries(value)) {
        if (tomlValueEqual(oldTable[k], v)) continue;
        if (!isLineValue(v) || (oldTable[k] !== undefined && !isLineValue(oldTable[k]))) return null;
        ops.push({ kind: 'set', table: key, key: k, value: v });
      }
      for (const k of Object.keys(oldTable)) {
        if (value[k] !== undefined) continue;
        if (!isLineValue(oldTable[k])) return null;
        ops.push({ kind: 'delete', table: key, key: k });
      }
      if (old === undefined && Object.keys(value).length === 0) return null; // a new, empty table
      continue;
    }
    if (tomlValueEqual(old, value)) continue;
    if (!isLineValue(value) || (old !== undefined && !isLineValue(old))) return null;
    ops.push({ kind: 'set', table: null, key, value });
  }
  for (const key of Object.keys(before)) {
    if (after[key] !== undefined) continue;
    return null; // removing a whole top-level key or table: not a line edit
  }
  return ops;
}

const HEADER_RE = /^\s*\[\s*([A-Za-z0-9_-]+)\s*\]\s*(#.*)?$/;
const ANY_HEADER_RE = /^\s*\[/;

function keyPattern(key: string): RegExp {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*(?:${esc}|"${esc}"|'${esc}')\\s*=`);
}

interface Region {
  /** First line of the region's body (after its header; 0 for the top level). */
  start: number;
  /** One past the region's last line. */
  end: number;
}

function regions(lines: readonly string[]): { top: Region; tables: Map<string, Region> } | null {
  const tables = new Map<string, Region>();
  let topEnd = lines.length;
  let current: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!ANY_HEADER_RE.test(line)) continue;
    const m = HEADER_RE.exec(line);
    if (current === null) topEnd = Math.min(topEnd, i);
    else {
      const r = tables.get(current);
      if (r) r.end = i;
    }
    if (!m) {
      // A dotted or array-of-tables header: fine if nothing edits it, but the
      // simple region model stops here.
      current = `\u0000${i}`;
      tables.set(current, { start: i + 1, end: lines.length });
      continue;
    }
    const name = m[1] as string;
    if (tables.has(name)) return null; // a table defined twice (invalid TOML anyway)
    current = name;
    tables.set(name, { start: i + 1, end: lines.length });
  }
  return { top: { start: 0, end: topEnd }, tables };
}

function findKeyLine(lines: readonly string[], region: Region, key: string): number {
  const re = keyPattern(key);
  for (let i = region.start; i < region.end; i += 1) if (re.test(lines[i] ?? '')) return i;
  return -1;
}

/** The trailing ` # comment` of `key = value # comment`, when the value parses without it. */
function trailingComment(line: string, key: string, oldValue: unknown, io: TomlEditIo): string {
  const eq = line.indexOf('=');
  if (eq < 0) return '';
  const rest = line.slice(eq + 1);
  for (let i = rest.indexOf('#'); i >= 0; i = rest.indexOf('#', i + 1)) {
    try {
      const parsed = io.reparse(`k = ${rest.slice(0, i)}`);
      if (tomlValueEqual(parsed['k'], oldValue)) {
        const ws = /\s*$/.exec(rest.slice(0, i))?.[0] ?? ' ';
        return `${ws || ' '}${rest.slice(i).trimEnd()}`;
      }
    } catch {
      /* the '#' was inside the value; try the next one */
    }
  }
  void key;
  return '';
}

/** Where a new key goes in a region: after its last key line (or at its start). */
function insertionPoint(lines: readonly string[], region: Region): number {
  let at = region.start;
  for (let i = region.start; i < region.end; i += 1) {
    const t = (lines[i] ?? '').trim();
    if (t.length > 0 && !t.startsWith('#')) at = i + 1;
  }
  return at;
}

/** Where a new top-level key goes: before the first non-comment line (after a header comment block). */
function topInsertionPoint(lines: readonly string[], region: Region, leading: boolean): number {
  if (leading) {
    for (let i = region.start; i < region.end; i += 1) {
      const t = (lines[i] ?? '').trim();
      if (t.length > 0 && !t.startsWith('#')) return i;
    }
    // Only comments (or nothing) before the first table: after the comments.
    let at = region.start;
    for (let i = region.start; i < region.end; i += 1) if ((lines[i] ?? '').trim().startsWith('#')) at = i + 1;
    return at;
  }
  return insertionPoint(lines, region);
}

/**
 * Apply the difference between `before` (the parsed `text`) and `after` to
 * `text` as line edits (see the module header). Null when that is impossible
 * or the edited text does not parse back to exactly `after`.
 */
export function editTomlText(
  text: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  io: TomlEditIo,
): string | null {
  const ops = diff(before, after);
  if (ops === null) return null;
  if (ops.length === 0) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const hadFinalNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (hadFinalNewline) lines.pop();

  // Apply one op at a time, recomputing regions (edits shift line numbers).
  for (const op of ops) {
    const reg = regions(lines);
    if (reg === null) return null;
    const region = op.table === null ? reg.top : reg.tables.get(op.table);
    if (op.kind === 'delete') {
      if (!region) return null;
      const at = findKeyLine(lines, region, op.key);
      if (at < 0) return null;
      lines.splice(at, 1);
      continue;
    }
    const rendered = io.render(op.key, op.value);
    if (rendered.includes('\n')) return null;
    if (!region) {
      // A new table: appended at the end, after one blank line.
      if (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() !== '') lines.push('');
      lines.push(`[${op.table}]`, rendered);
      continue;
    }
    const at = findKeyLine(lines, region, op.key);
    if (at >= 0) {
      const oldValue = op.table === null ? before[op.key] : (before[op.table] as Record<string, unknown> | undefined)?.[op.key];
      const indent = /^\s*/.exec(lines[at] ?? '')?.[0] ?? '';
      lines[at] = `${indent}${rendered}${trailingComment(lines[at] ?? '', op.key, oldValue, io)}`;
      continue;
    }
    const insertAt = op.table === null
      ? topInsertionPoint(lines, region, op.key === io.leadingKey)
      : insertionPoint(lines, region);
    lines.splice(insertAt, 0, rendered);
  }

  const out = lines.join(eol) + (hadFinalNewline || lines.length > 0 ? eol : '');
  try {
    if (!tomlValueEqual(io.reparse(out), after)) return null;
  } catch {
    return null;
  }
  return out;
}
