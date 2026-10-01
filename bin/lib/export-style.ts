// bin/lib/export-style.ts — the export's citation style, resolved once, with
// where it came from (Phase 21, EXP-03; D-21-24, D-21-07).
//
// Precedence (EXP-03): `done --style <name|path.csl>` > config.toml `[project]
// citation_style` > the intake brief's `citation_style` (GRND-04) > the
// discipline preset's default (GRND-06) — the keys layered through
// disciplines.ts resolveDiscipline, so a paper without INTAKE.md still gets its
// config's style, else its preset's, never raw `[@key]` tokens.
//
// A style is one of the 8 bundled CSL keys (any alias config.ts accepts: "APA
// 7", "Chicago", …) or a path to a local `.csl` file (relative to the project
// root, or absolute). A file is accepted only when validateCslFile passes:
// well-formed XML, the CSL 1.0 namespace, a `<style>` root whose `class` is
// `in-text` or `note`, `<citation>` and `<bibliography>` elements, and no
// `<link rel="independent-parent">` (a dependent style would need its parent
// fetched — nothing is fetched at export). An unknown name is EXIT_USAGE
// listing the 8 styles and the path form; a bad `.csl` is EXIT_USAGE with the
// validator's reason. Pure reads; nothing is written.

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve, basename } from 'node:path';
import { EXIT_USAGE, PensmithError } from './exit-codes.js';
import { citationStyleKey, CITATION_STYLE_NAMES, isCslPathSpelling } from './schemas/config.js';
import { CSL_STYLE_KEYS, resolveDiscipline, type CslStyleKey } from './disciplines.js';
import { tryReadPaperConfigSync } from './config.js';
import { readIntakeBrief } from './intake-brief.js';

/** Where the export style came from. */
export type ExportStyleSource = 'flag' | 'config' | 'intake' | 'preset';

export interface ExportStyle {
  /** A CSL key (`apa`) or the absolute path of a validated local `.csl` file. */
  readonly style: string;
  readonly source: ExportStyleSource;
  /** How the terminal names it: the key, or the file name with the style's title. */
  readonly name: string;
  /** How the terminal names the source: `--style`, `config.toml [project] citation_style`, `INTAKE.md`, `the <discipline> discipline preset` or `the default preset (no discipline set)`. */
  readonly from: string;
  /** `in-text` or `note` for a local file (the bundled keys: unset). */
  readonly cslClass?: 'in-text' | 'note';
}

/** The largest local `.csl` file accepted (the bundled styles are under 100 KB). */
export const CSL_MAX_BYTES = 2 * 1024 * 1024;

const CSL_NAMESPACE = 'http://purl.org/net/xbiblio/csl';

/** The one-line list of what `--style` accepts. */
export function exportStyleChoices(): string {
  return `${CITATION_STYLE_NAMES.join(', ')} (or their keys: ${CSL_STYLE_KEYS.join(', ')}), or a path to a local .csl file`;
}

export type CslValidation =
  | { readonly ok: true; readonly cslClass: 'in-text' | 'note'; readonly title: string }
  | { readonly ok: false; readonly reason: string };

interface XmlElement {
  readonly name: string;
  readonly attrs: ReadonlyMap<string, string>;
  readonly depth: number;
  text: string;
}

const NAME_RE = /^[A-Za-z_][-A-Za-z0-9_.:]*$/;
const ATTR_RE = /\s+([A-Za-z_][-A-Za-z0-9_.:]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
const ENTITY_RE = /&(?:#[0-9]+|#x[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/y;

/**
 * A strict, minimal XML reader for CSL files: elements, attributes (quoted),
 * text with the five predefined and numeric entities, comments, CDATA and
 * processing instructions. A DOCTYPE (an external entity) is refused.
 * Returns every element in document order with its depth, or the first reason
 * the text is not well-formed.
 */
function readXml(text: string): { elements: XmlElement[] } | { reason: string } {
  const elements: XmlElement[] = [];
  const stack: XmlElement[] = [];
  let i = 0;
  let rootClosed = false;
  const line = (at: number): number => text.slice(0, at).split('\n').length;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const chunk = lt === -1 ? text.slice(i) : text.slice(i, lt);
    // Text: only entities may follow '&'; outside the root only whitespace.
    for (let a = chunk.indexOf('&'); a !== -1; a = chunk.indexOf('&', a + 1)) {
      ENTITY_RE.lastIndex = a;
      if (!ENTITY_RE.test(chunk)) return { reason: `an unescaped "&" on line ${line(i + a)}` };
    }
    if (stack.length === 0 && chunk.trim().length > 0) return { reason: `text outside the root element on line ${line(i)}` };
    if (stack.length > 0) (stack[stack.length - 1] as XmlElement).text += chunk;
    if (lt === -1) break;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) return { reason: `an unclosed comment on line ${line(lt)}` };
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1 || stack.length === 0) return { reason: `a CDATA section outside an element or unclosed on line ${line(lt)}` };
      (stack[stack.length - 1] as XmlElement).text += text.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) return { reason: `an unclosed processing instruction on line ${line(lt)}` };
      i = end + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) return { reason: `a DOCTYPE or declaration on line ${line(lt)} (not accepted in a CSL file)` };
    const gt = text.indexOf('>', lt + 1);
    if (gt === -1) return { reason: `an unclosed tag on line ${line(lt)}` };
    const raw = text.slice(lt + 1, gt);
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (open === undefined || open.name !== name) return { reason: `a closing </${name}> with no matching open tag on line ${line(lt)}` };
      if (stack.length === 0) rootClosed = true;
      i = gt + 1;
      continue;
    }
    if (rootClosed) return { reason: `a second root element on line ${line(lt)}` };
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^[^\s/>]+/.exec(body);
    const name = nameMatch?.[0] ?? '';
    if (!NAME_RE.test(name)) return { reason: `a malformed tag on line ${line(lt)}` };
    const attrs = new Map<string, string>();
    let at = name.length;
    for (;;) {
      ATTR_RE.lastIndex = at;
      const m = ATTR_RE.exec(body);
      if (m === null) break;
      if (attrs.has(m[1] as string)) return { reason: `a repeated attribute "${m[1]}" on line ${line(lt)}` };
      attrs.set(m[1] as string, (m[2] ?? m[3] ?? '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
      at = ATTR_RE.lastIndex;
    }
    if (body.slice(at).trim().length > 0) return { reason: `a malformed attribute in <${name}> on line ${line(lt)}` };
    const el: XmlElement = { name, attrs, depth: stack.length, text: '' };
    elements.push(el);
    if (!selfClosing) stack.push(el);
    else if (stack.length === 0) rootClosed = true;
    i = gt + 1;
  }
  if (stack.length > 0) return { reason: `<${(stack[stack.length - 1] as XmlElement).name}> is never closed` };
  if (elements.length === 0) return { reason: 'no root element' };
  return { elements };
}

/**
 * Check that `file` is a usable CSL 1.0 style (see the header). Never throws:
 * an unreadable file is a reason too.
 */
export function validateCslFile(file: string): CslValidation {
  let text: string;
  try {
    const st = statSync(file);
    if (!st.isFile()) return { ok: false, reason: `${file} is not a file` };
    if (st.size > CSL_MAX_BYTES) return { ok: false, reason: `${basename(file)} is larger than ${CSL_MAX_BYTES / (1024 * 1024)} MB` };
    text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (e) {
    return { ok: false, reason: `${file} cannot be read (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})` };
  }
  const xml = readXml(text);
  if ('reason' in xml) return { ok: false, reason: `${basename(file)} is not well-formed XML: ${xml.reason}` };
  const root = xml.elements[0] as XmlElement;
  if (root.name !== 'style') return { ok: false, reason: `${basename(file)} is not a CSL style: its root element is <${root.name}>, not <style>` };
  if (root.attrs.get('xmlns') !== CSL_NAMESPACE) return { ok: false, reason: `${basename(file)} is not a CSL 1.0 style: <style> must declare xmlns="${CSL_NAMESPACE}"` };
  const version = root.attrs.get('version') ?? '';
  if (!/^1\.0(?:\.\d+)?$/.test(version)) return { ok: false, reason: `${basename(file)} is not a CSL 1.0 style (version="${version}")` };
  const cslClass = root.attrs.get('class');
  if (cslClass !== 'in-text' && cslClass !== 'note') return { ok: false, reason: `${basename(file)}: <style class="…"> must be "in-text" or "note" (got "${cslClass ?? ''}")` };
  const children = xml.elements.filter((e) => e.depth === 1).map((e) => e.name);
  const parent = xml.elements.find((e) => e.name === 'link' && e.attrs.get('rel') === 'independent-parent');
  if (parent !== undefined) {
    return { ok: false, reason: `${basename(file)} is a dependent style (it names an independent parent, ${parent.attrs.get('href') ?? '?'}) — use the parent style's .csl file instead` };
  }
  if (!children.includes('citation')) return { ok: false, reason: `${basename(file)} has no <citation> element` };
  if (!children.includes('bibliography')) return { ok: false, reason: `${basename(file)} has no <bibliography> element` };
  const title = xml.elements.find((e) => e.name === 'title' && e.depth === 2)?.text.replace(/\s+/g, ' ').trim() ?? '';
  return { ok: true, cslClass, title };
}

function usage(message: string): PensmithError {
  return new PensmithError(message, EXIT_USAGE);
}

/** A style value (a name, an alias or a `.csl` path) → the key or the validated absolute path. Throws EXIT_USAGE. */
function resolveValue(paperRoot: string, value: string, where: string): Omit<ExportStyle, 'source' | 'from'> {
  const key = citationStyleKey(value);
  if (key !== null) return { style: key, name: key };
  if (isCslPathSpelling(value)) {
    const file = isAbsolute(value.trim()) ? value.trim() : resolve(paperRoot, value.trim());
    const v = validateCslFile(file);
    if (!v.ok) throw usage(`${where}: ${v.reason}`);
    return { style: file, name: `${basename(file)}${v.title.length > 0 ? ` (${v.title})` : ''}`, cslClass: v.cslClass };
  }
  throw usage(`${where}: unknown citation style "${value}" — use one of ${exportStyleChoices()}`);
}

/**
 * The export style of the paper at `paperRoot` (see the header), with its
 * source. `flag` is done's `--style` value. Throws PensmithError(EXIT_USAGE)
 * for an unknown style or a bad `.csl` file; an unreadable INTAKE.md or
 * config.toml falls through to the next layer only when it is absent — an
 * invalid config.toml throws its own one-line ConfigError.
 */
export function resolveExportStyle(paperRoot: string, flag?: string): ExportStyle {
  if (flag !== undefined && flag.trim().length > 0) {
    return { ...resolveValue(paperRoot, flag, '--style'), source: 'flag', from: '--style' };
  }
  const config = tryReadPaperConfigSync(paperRoot);
  const configured = config?.project?.citation_style;
  if (configured !== undefined && configured.trim().length > 0) {
    return { ...resolveValue(paperRoot, configured, 'config.toml [project] citation_style'), source: 'config', from: 'config.toml [project] citation_style' };
  }
  let intakeStyle: CslStyleKey | undefined;
  let intakeDiscipline: string | undefined;
  try {
    const brief = readIntakeBrief(paperRoot)?.brief;
    if (brief !== undefined) {
      intakeDiscipline = brief.discipline;
      if (brief.citation_style !== '') intakeStyle = brief.citation_style;
    }
  } catch {
    // An INTAKE.md this build cannot read gives no style; the next layer decides.
  }
  const resolved = resolveDiscipline({
    discipline: { intake: intakeDiscipline, config: config?.project?.discipline_preset },
    ...(intakeStyle !== undefined ? { intake: { citationStyle: intakeStyle } } : {}),
  });
  const style = resolved.citationStyle;
  if (style.source === 'intake') return { style: style.value, name: style.value, source: 'intake', from: 'INTAKE.md' };
  const presetFrom = resolved.slug.source === 'preset' ? 'the default preset (no discipline set)' : `the ${resolved.slug.value} discipline preset`;
  return { style: style.value, name: style.value, source: 'preset', from: presetFrom };
}
