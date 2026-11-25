// tests/citation-grammar-chokepoint.test.ts — citation syntax is read in one
// place: bin/lib/citation-grammar.ts.
//
// Each consumer used to carry its own `/\[@([a-z][a-z0-9_-]*)\]/` regex, and
// each copy drifted from Pandoc in its own way: compile dropped locator
// citations from the bibliography, the humanizer gate missed cluster keys,
// Pass 3 never saw `[@key, p. 12]`. This test fails when a regex that parses
// citation syntax appears anywhere else in the shipped code: a regex literal,
// or a `RegExp(...)` built from a string or template, with an escaped `[`
// before an `@` (a bracketed cluster) or an `@` right after a space, `^` or
// group (a narrative `@key`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const GRAMMAR = 'bin/lib/citation-grammar.ts';
const ROOTS = ['bin', 'hooks', 'scripts'];
const EXTS = new Set(['.ts', '.mts', '.mjs', '.js', '.cjs']);

/** Does this regex source read citation syntax? */
function readsCitations(source: string): boolean {
  return /\\\[.*@/.test(source) || /(?:\\s|\^|\)|\])@/.test(source);
}

/** The regex sources in a file: literals, and string or template arguments to RegExp. */
function regexSources(file: string, text: string): string[] {
  const kind = extname(file) === '.ts' || extname(file) === '.mts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const literalText = (n: ts.Node): string | null => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((s) => `\${}${s.literal.text}`)].join('');
    if (ts.isTaggedTemplateExpression(n)) {
      const t = n.template;
      return ts.isNoSubstitutionTemplateLiteral(t)
        ? (t.rawText ?? t.text)
        : [t.head.rawText ?? t.head.text, ...t.templateSpans.map((s) => `\${}${s.literal.rawText ?? s.literal.text}`)].join('');
    }
    return null;
  };
  const visit = (n: ts.Node): void => {
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const lit = n.getText(sf);
      out.push(lit.slice(1, lit.lastIndexOf('/')));
    } else if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && ts.isIdentifier(n.expression) && n.expression.text === 'RegExp') {
      const arg = n.arguments?.[0];
      const s = arg ? literalText(arg) : null;
      if (s !== null) out.push(s);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'dist') out.push(...sourceFiles(full));
    } else if (EXTS.has(extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

test('the detector flags the narrow citation regexes this codebase used to carry, and nothing else', () => {
  const flagged = regexSources('probe.ts', [
    'const a = /\\[@([a-z][a-z0-9_-]*)\\]/g;',
    'const b = new RegExp(`\\\\[@${key}\\\\]`, "g");',
    'const c = /["“]([^"”]{60,})["”]\\s*\\[@([a-z][a-z0-9_-]*)\\]/g;',
    'const d = /(^|\\s)@[A-Za-z0-9_:-]+/g;',
    'const e = /\\[([^[\\]]*@[^[\\]]*)\\]/g;',
  ].join('\n'));
  assert.deepEqual(flagged.map(readsCitations), [true, true, true, true, true]);
  const unflagged = regexSources('probe.ts', [
    'const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g;',
    'const bibHeader = /^(@\\w+\\{)[^,]+(,)/gm;',
    'const anyEntry = /^\\s*@\\s*\\w+\\s*[{(]/m;',
  ].join('\n'));
  assert.deepEqual(unflagged.map(readsCitations), [false, false, false]);
});

test('no regex outside the citation grammar reads citation syntax', () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(REPO, root))) {
      const rel = relative(REPO, file).split('\\').join('/');
      if (rel === GRAMMAR) continue;
      for (const src of regexSources(file, readFileSync(file, 'utf8'))) {
        if (readsCitations(src)) offenders.push(`${rel}: /${src}/`);
      }
    }
  }
  assert.deepEqual(offenders, [], `parse citations with ${GRAMMAR} (findCitations and friends), not a local regex`);
});
