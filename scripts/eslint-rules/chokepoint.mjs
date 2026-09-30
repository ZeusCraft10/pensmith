// scripts/eslint-rules/chokepoint.mjs — the data-driven chokepoint rule
// (RUN-29 / D-17-44), wired as `pensmith/chokepoint` in eslint.config.js.
//
// Every architectural chokepoint added from Phase 17 on is ONE JSON row in
// scripts/chokepoints/<id>.json:
//
//   {
//     "id":          "library-writer",              // unique, = file name
//     "requirement": "BRDTH-01",                    // the REQ-ID that owns it
//     "module":      "bin/lib/library.ts",          // the one allowed module
//     "description": "…why, and what to call instead…",
//     "scope":       ["bin/**/*.ts", …],            // repo-relative globs checked
//     "allow":       ["bin/lib/library.ts"],        // globs exempt from the row
//     "match":       { "kind": …, "pattern": … }    // or an array of matchers
//     "fixture":     "tests/fixtures/chokepoints/<id>.violation.ts.txt",
//     "fixturePath": "bin/lib/x.ts",                // optional: where the harness puts the fixture
//     "baseline":    { "<path>": <max count> }      // file-regex rows only (optional)
//   }
//
// `fixturePath` (optional, repo-relative `.ts`): the path tests/chokepoints.test.ts
// reads the fixture at. An ESLint row's fixture is linted as that file (default:
// a virtual file under the row's first `.ts` scope glob); an import-graph row's
// fixture stands in for that module — when the path lies outside the row's
// scope, the harness walks the row's real in-scope modules, so the fixture
// proves the real graph reaches it (e.g. a bin/cli verb the MCP tools import).
//
// Matcher kinds (each `pattern` is a JavaScript regular-expression source):
//   string-literal  any string literal or template-literal chunk whose value matches.
//   import          an import / export-from / dynamic import() / require() whose
//                   module specifier matches. Optional `names` (a regex over the
//                   imported binding names: `default`, `*` for namespace and
//                   dynamic imports) and `typeImports: "allow"` (type-only
//                   imports are exempt).
//   call            a call or `new` whose callee name (`foo`, `obj.foo` → `foo`) or
//                   dotted callee (`obj.foo`) matches. Optional `arg: {index,
//                   pattern}`: only when that argument's source text — or, for a
//                   same-file identifier, its initializer's — matches. `index`
//                   is a position (default 0) or "any" (any argument matches,
//                   e.g. a path segment anywhere in `path.join(root, 'x', …)`).
//   member          a member expression whose dotted text matches
//                   (`process.env['X']` is normalized to `process.env.X`).
//   file-regex      the whole file text (reported per match); `flags` optional.
//                   With `baseline`, a listed file may keep up to that many matches.
//   import-graph    enforced only by the harness (tests/chokepoints.test.ts): no
//                   in-scope module may reach a module whose repo-relative path
//                   matches, through static or dynamic relative imports.
//                   Optional `content` (a regex source, no flags, over the raw
//                   module text — comments included): then a module is a
//                   violation only when its path matches AND its text does, the
//                   in-scope module itself counts (chain = [itself]), and the
//                   walk goes on through it so every offending module is named.
//                   Optional `typeImports: "allow"`: `import type … from` /
//                   `export type … from` edges are not followed (they are erased
//                   at runtime under verbatimModuleSyntax; an inline
//                   `import { type X }` still loads the module and is followed).
//   regex-literal   a regular-expression literal whose pattern (`node.regex.pattern`)
//                   matches, or a `new RegExp(…)` / `RegExp(…)` whose pattern
//                   argument's static text does (a string or template literal, a
//                   String.raw template, a `+` concatenation of those, or a
//                   same-file const holding one). Phase 20 D-20-06 (VRFY-09).
//
// Why a separate rule instead of more no-restricted-syntax selectors: flat config
// lets the LAST matching block win per rule name, so file-scoped overrides of
// no-restricted-syntax silently drop the project-wide selectors (see the re-listed
// selectors in eslint.config.js). One rule name that owns every row cannot be
// shadowed that way. Violations are never silenced with an inline disable
// comment: the `no-new-eslint-disable` row forbids adding one, and
// tests/chokepoints.test.ts re-checks every row outside ESLint.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CHOKEPOINT_DIR = path.join(REPO_ROOT, 'scripts', 'chokepoints');
export const MATCH_KINDS = ['string-literal', 'import', 'call', 'member', 'file-regex', 'import-graph', 'regex-literal'];

// ---------------------------------------------------------------------------
// Globs (repo-relative, '/'-separated): ** (any depth), * and ? (within a
// segment), {a,b} alternation. A trailing '/' or '/**' matches everything under.
// ---------------------------------------------------------------------------

const globCache = new Map();

export function globToRegExp(glob) {
  const cached = globCache.get(glob);
  if (cached) return cached;
  let g = glob.replace(/\\/g, '/');
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        const slash = g[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
      } else {
        re += `(?:${g
          .slice(i + 1, end)
          .split(',')
          .map((alt) => alt.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
          .join('|')})`;
        i = end;
      }
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
  }
  const compiled = new RegExp(`^${re}$`);
  globCache.set(glob, compiled);
  return compiled;
}

export function matchesAny(rel, globs) {
  return (globs ?? []).some((g) => globToRegExp(g).test(rel));
}

/**
 * The '/'-separated path of `file` relative to the repo root. A file on another
 * Windows drive has no relative path (os.tmpdir() is on C: while a CI checkout
 * is on D:): path.relative returns it absolute, e.g. `C:/Users/…/a.ts`.
 * `root` and `p` (a node:path flavour) are seams for the win32 self-test.
 */
export function toRepoRelative(file, root = REPO_ROOT, p = path) {
  return p.relative(root, p.resolve(file)).split(p.sep).join('/');
}

/**
 * The absolute path of a toRepoRelative() result — the inverse. It resolves
 * rather than joins, so an absolute result (another drive) stays itself instead
 * of being glued under the repo root (`D:\repo\C:\Users\…`).
 */
export function fromRepoRelative(rel, root = REPO_ROOT, p = path) {
  return p.resolve(root, rel);
}

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

/** Every matcher of a row, as an array. */
export function matchersOf(row) {
  return Array.isArray(row.match) ? row.match : [row.match];
}

/** Load and validate every scripts/chokepoints/*.json row (throws on a bad row). */
export function loadChokepointRows(dir = CHOKEPOINT_DIR) {
  const rows = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    const row = JSON.parse(readFileSync(file, 'utf8'));
    const problems = validateRow(row, name);
    if (problems.length > 0) throw new Error(`chokepoint row ${name}: ${problems.join('; ')}`);
    rows.push(row);
  }
  return rows;
}

export function validateRow(row, fileName) {
  const p = [];
  if (!row || typeof row !== 'object') return ['not an object'];
  if (typeof row.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(row.id)) p.push('id must be kebab-case');
  if (fileName && row.id !== fileName.replace(/\.json$/, '')) p.push(`id "${row.id}" must equal the file name`);
  if (typeof row.requirement !== 'string' || !/^[A-Z][A-Z0-9]*-\d+$/.test(row.requirement)) p.push('requirement must be a REQ-ID');
  if (typeof row.module !== 'string' || !row.module) p.push('module is required');
  if (typeof row.description !== 'string' || row.description.length < 20) p.push('description is required');
  if (!Array.isArray(row.scope) || row.scope.length === 0) p.push('scope must be a non-empty glob array');
  if (row.allow !== undefined && !Array.isArray(row.allow)) p.push('allow must be a glob array');
  if (typeof row.fixture !== 'string' || !/^tests\/fixtures\/chokepoints\/[a-z0-9-]+\.violation\.ts\.txt$/.test(row.fixture)) {
    p.push('fixture must be tests/fixtures/chokepoints/<id>.violation.ts.txt');
  }
  if (row.fixturePath !== undefined && (typeof row.fixturePath !== 'string' || !/^(?:[\w.-]+\/)*[\w.-]+\.ts$/.test(row.fixturePath) || row.fixturePath.split('/').some((seg) => seg === '..' || seg === '.'))) {
    p.push('fixturePath must be a repo-relative .ts path');
  }
  const matchers = row.match === undefined ? [] : matchersOf(row);
  if (matchers.length === 0) p.push('match is required');
  for (const m of matchers) {
    if (!m || !MATCH_KINDS.includes(m.kind)) p.push(`unknown match kind ${JSON.stringify(m && m.kind)}`);
    if (m && m.content !== undefined && (m.kind !== 'import-graph' || typeof m.content !== 'string' || m.content === '')) {
      p.push('content is a non-empty regex source, for import-graph matchers only');
    }
    if (m && m.typeImports !== undefined && (m.typeImports !== 'allow' || (m.kind !== 'import' && m.kind !== 'import-graph'))) {
      p.push('typeImports is "allow", for import and import-graph matchers only');
    }
    if (m && m.arg !== undefined) {
      if (m.kind !== 'call' || typeof m.arg !== 'object' || m.arg === null || typeof m.arg.pattern !== 'string') {
        p.push('arg is {index, pattern}, for call matchers only');
      } else if (m.arg.index !== undefined && m.arg.index !== 'any' && !(Number.isInteger(m.arg.index) && m.arg.index >= 0)) {
        p.push('arg.index is a non-negative integer or "any"');
      }
    }
    try {
      new RegExp(m.pattern, m.flags ?? '');
      if (m.names) new RegExp(m.names);
      if (m.arg) new RegExp(m.arg.pattern);
      if (typeof m.content === 'string') new RegExp(m.content);
    } catch (e) {
      p.push(`bad pattern: ${e.message}`);
    }
  }
  if (row.baseline !== undefined && (typeof row.baseline !== 'object' || Array.isArray(row.baseline))) p.push('baseline must be {path: count}');
  return p;
}

/** The rows whose scope covers `rel` and whose allow list does not. */
export function rowsForFile(rows, rel) {
  return rows.filter((r) => matchesAny(rel, r.scope) && !matchesAny(rel, r.allow));
}

/** file-regex matches of one matcher over `text`: [{index, text}]. */
export function fileRegexMatches(matcher, text) {
  const flags = new Set([...(matcher.flags ?? ''), 'g']);
  const re = new RegExp(matcher.pattern, [...flags].join(''));
  const out = [];
  for (const m of text.matchAll(re)) {
    out.push({ index: m.index ?? 0, text: m[0] });
    if (m[0].length === 0) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// import-graph (harness-only kind).
// ---------------------------------------------------------------------------

const IMPORT_SPEC_RE =
  /(?:^|[^\w$.])(?:import|export)\s[^'"`;]*?\sfrom\s*(['"])([^'"]+)\1|(?:^|[^\w$.])import\s*(['"])([^'"]+)\3|(?:^|[^\w$.])import\s*\(\s*(['"])([^'"]+)\5\s*\)/g;

/** `import type … from` / `export type … from` (erased at runtime), not `import type from '…'` (a default import named type). */
const TYPE_ONLY_RE = /^[^\w$.]?(?:import|export)\s+type(?:\s*[{*]|\s+(?!from\b)[\w$])/;

/**
 * Relative module specifiers imported by `text` (static, side-effect, dynamic).
 * With `opts.skipTypeOnly`, type-only import / export statements are left out.
 */
export function relativeImports(text, opts = {}) {
  const out = [];
  for (const m of text.matchAll(IMPORT_SPEC_RE)) {
    const spec = m[2] ?? m[4] ?? m[6];
    if (!spec || !spec.startsWith('.')) continue;
    if (opts.skipTypeOnly && m[2] !== undefined && TYPE_ONLY_RE.test(m[0])) continue;
    out.push(spec);
  }
  return out;
}

/**
 * Resolve a relative specifier to an existing source file (`.js` → `.ts`, …), or
 * null. `p` (a node:path flavour) is a seam for the win32 self-test.
 */
export function resolveImport(fromFile, spec, exists, p = path) {
  const base = p.resolve(p.dirname(fromFile), spec);
  const candidates = [base];
  if (/\.js$/.test(base)) candidates.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.mts'));
  if (/\.mjs$/.test(base)) candidates.push(base.replace(/\.mjs$/, '.mts'));
  if (/\.cjs$/.test(base)) candidates.push(base.replace(/\.cjs$/, '.cts'));
  if (!/\.[cm]?[jt]s$/.test(base)) candidates.push(`${base}.ts`, p.join(base, 'index.ts'));
  return candidates.find((c) => exists(c)) ?? null;
}

/**
 * import-graph enforcement: for every entry (repo-relative path) in scope and
 * not allowed, walk its relative imports; a reached module whose repo-relative
 * path matches the row's pattern is a violation, reported with the import chain.
 * With a `content` matcher, the path AND the module's text must match; the
 * entry itself is checked too, and the walk continues through a violating
 * module (its imports may hold more). `io` = { read(abs) → text,
 * exists(abs) → boolean } (injectable for tests), plus the optional seams
 * `root` (the repo root, default REPO_ROOT) and `path` (a node:path flavour,
 * default the host's) for the win32 self-test.
 *
 * An entry is a toRepoRelative() result, which is absolute for a file on
 * another Windows drive (a temp dir on C: while the checkout is on D:), so the
 * walk starts from fromRepoRelative(entry) — never `path.join(root, entry)`.
 */
export function importGraphViolations(row, entries, io) {
  const root = io.root ?? REPO_ROOT;
  const p = io.path ?? path;
  const texts = new Map();
  /** A module's text (read once per call), or null when it cannot be read. */
  const textOf = (file) => {
    if (!texts.has(file)) {
      let text = null;
      try {
        text = io.read(file);
      } catch {
        text = null;
      }
      texts.set(file, text);
    }
    return texts.get(file);
  };
  const out = [];
  for (const matcher of matchersOf(row).filter((m) => m.kind === 'import-graph')) {
    const target = new RegExp(matcher.pattern, matcher.flags ?? '');
    const content = typeof matcher.content === 'string' ? new RegExp(matcher.content) : null;
    /** Whether the module at `file` (repo-relative `rel`) violates this matcher. */
    const violates = (file, rel) => target.test(rel) && (content === null || content.test(textOf(file) ?? ''));
    const skipTypeOnly = matcher.typeImports === 'allow';
    for (const rel of entries) {
      if (!matchesAny(rel, row.scope) || matchesAny(rel, row.allow)) continue;
      const start = fromRepoRelative(rel, root, p);
      if (content !== null && violates(start, rel)) out.push({ row: row.id, entry: rel, reached: rel, chain: [rel] });
      const seen = new Map([[start, null]]);
      const queue = [start];
      while (queue.length > 0) {
        const file = queue.shift();
        const text = textOf(file);
        if (text === null) continue;
        for (const spec of relativeImports(text, { skipTypeOnly })) {
          const next = resolveImport(file, spec, io.exists, p);
          if (!next || seen.has(next)) continue;
          seen.set(next, file);
          const nextRel = toRepoRelative(next, root, p);
          if (violates(next, nextRel)) {
            const chain = [nextRel];
            for (let at = file; at; at = seen.get(at)) chain.unshift(toRepoRelative(at, root, p));
            out.push({ row: row.id, entry: rel, reached: nextRel, chain });
            if (content === null) continue;
          }
          queue.push(next);
        }
      }
    }
  }
  return out;
}

function summary(row) {
  const first = row.description.split(/(?<=\.)\s/)[0] ?? row.description;
  return `chokepoint "${row.id}" (${row.requirement}): ${first}`;
}

// ---------------------------------------------------------------------------
// The ESLint rule.
// ---------------------------------------------------------------------------

let ROWS = null;
function rows() {
  if (!ROWS) ROWS = loadChokepointRows();
  return ROWS;
}

function calleeNames(node, sourceCode) {
  const names = [];
  const c = node.callee;
  if (c.type === 'Identifier') names.push(c.name);
  else if (c.type === 'MemberExpression') {
    if (!c.computed && c.property.type === 'Identifier') names.push(c.property.name);
    else if (c.computed && c.property.type === 'Literal' && typeof c.property.value === 'string') names.push(c.property.value);
    names.push(sourceCode.getText(c).replace(/\s+/g, ''));
  }
  return names;
}

function memberText(node, sourceCode) {
  return sourceCode
    .getText(node)
    .replace(/\s+/g, '')
    .replace(/\?\./g, '.')
    .replace(/\[(['"`])([A-Za-z_$][\w$]*)\1\]/g, '.$2');
}

/** The source text of `arg`, plus the initializer of a same-file const it names. */
function argTexts(arg, sourceCode, context) {
  const texts = [sourceCode.getText(arg)];
  if (arg.type === 'Identifier') {
    let scope = sourceCode.getScope ? sourceCode.getScope(arg) : context.getScope();
    while (scope) {
      const v = scope.set.get(arg.name);
      if (v) {
        for (const def of v.defs) {
          if (def.type === 'Variable' && def.node.init) texts.push(sourceCode.getText(def.node.init));
          if (def.type === 'Parameter') texts.push(sourceCode.getText(def.name));
        }
        break;
      }
      scope = scope.upper;
    }
  }
  return texts;
}

/** The initializer of the same-file `const`/`let` that `id` names, or null. */
function initializerOf(id, sourceCode, context) {
  let scope = sourceCode.getScope ? sourceCode.getScope(id) : context.getScope();
  while (scope) {
    const v = scope.set.get(id.name);
    if (v) {
      const def = v.defs.find((d) => d.type === 'Variable' && d.node.init);
      return def ? def.node.init : null;
    }
    scope = scope.upper;
  }
  return null;
}

/**
 * The static text(s) a RegExp pattern argument evaluates to: a string literal,
 * a regex literal's pattern, a template literal (its cooked and raw text,
 * interpolations left empty), a String.raw template (raw), a `+` concatenation
 * of those, or a same-file const initialised with one. [] when not static.
 */
export function staticPatternTexts(node, sourceCode, context, depth = 0) {
  if (!node || depth > 4) return [];
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') return [node.value];
      if (node.regex) return [node.regex.pattern];
      return [];
    case 'TemplateLiteral':
      return [node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(''), node.quasis.map((q) => q.value.raw).join('')];
    case 'TaggedTemplateExpression':
      return [node.quasi.quasis.map((q) => q.value.raw).join(''), node.quasi.quasis.map((q) => q.value.cooked ?? q.value.raw).join('')];
    case 'BinaryExpression': {
      if (node.operator !== '+') return [];
      const left = staticPatternTexts(node.left, sourceCode, context, depth + 1);
      const right = staticPatternTexts(node.right, sourceCode, context, depth + 1);
      return left.flatMap((l) => right.map((r) => l + r)).slice(0, 16);
    }
    case 'Identifier':
      return staticPatternTexts(initializerOf(node, sourceCode, context), sourceCode, context, depth + 1);
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return staticPatternTexts(node.expression, sourceCode, context, depth + 1);
    default:
      return [];
  }
}

/** True for a `RegExp(…)` / `new RegExp(…)` / `globalThis.RegExp(…)` callee. */
function isRegExpCallee(callee) {
  if (callee.type === 'Identifier') return callee.name === 'RegExp';
  return callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' && callee.property.name === 'RegExp';
}

function importedNames(node) {
  if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration') {
    if (!node.specifiers || node.specifiers.length === 0) return ['*'];
    return node.specifiers.map((s) => {
      if (s.type === 'ImportDefaultSpecifier') return 'default';
      if (s.type === 'ImportNamespaceSpecifier') return '*';
      const n = node.type === 'ImportDeclaration' ? s.imported : s.local;
      return n.type === 'Identifier' ? n.name : String(n.value);
    });
  }
  return ['*'];
}

function isTypeOnlyImport(node) {
  if (node.importKind === 'type' || node.exportKind === 'type') return true;
  return (
    Array.isArray(node.specifiers) &&
    node.specifiers.length > 0 &&
    node.specifiers.every((s) => s.importKind === 'type' || s.exportKind === 'type')
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce the data-driven chokepoint rows in scripts/chokepoints/*.json (RUN-29).',
    },
    schema: [],
    messages: {
      violation: '{{summary}} Matched `{{matched}}` — use {{module}} (scripts/chokepoints/{{id}}.json).',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const rel = toRepoRelative(filename);
    const active = rowsForFile(rows(), rel);
    if (active.length === 0) return {};
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    const report = (row, node, matched, loc) => {
      context.report({
        ...(loc ? { loc } : { node }),
        messageId: 'violation',
        data: { summary: summary(row), matched: String(matched).slice(0, 120), module: row.module, id: row.id },
      });
    };

    const byKind = (kind) =>
      active.flatMap((row) => matchersOf(row).filter((m) => m.kind === kind).map((m) => ({ row, m, re: new RegExp(m.pattern, m.flags ?? '') })));

    const listeners = {};
    const add = (type, fn) => {
      const prev = listeners[type];
      listeners[type] = prev ? (n) => (prev(n), fn(n)) : fn;
    };

    const strings = byKind('string-literal');
    if (strings.length > 0) {
      add('Literal', (node) => {
        if (typeof node.value !== 'string') return;
        for (const { row, re } of strings) if (re.test(node.value)) report(row, node, node.value);
      });
      add('TemplateElement', (node) => {
        const v = node.value.cooked ?? node.value.raw;
        for (const { row, re } of strings) if (re.test(v)) report(row, node, v);
      });
    }

    const imports = byKind('import');
    if (imports.length > 0) {
      const check = (node, source) => {
        if (!source || typeof source.value !== 'string') return;
        for (const { row, m, re } of imports) {
          if (!re.test(source.value)) continue;
          if (m.typeImports === 'allow' && isTypeOnlyImport(node)) continue;
          if (m.names) {
            const namesRe = new RegExp(m.names);
            const hit = importedNames(node).filter((n) => n === '*' || namesRe.test(n));
            if (hit.length === 0) continue;
          }
          report(row, source, source.value);
        }
      };
      add('ImportDeclaration', (node) => check(node, node.source));
      add('ExportNamedDeclaration', (node) => check(node, node.source));
      add('ExportAllDeclaration', (node) => check(node, node.source));
      add('ImportExpression', (node) => check(node, node.source.type === 'Literal' ? node.source : null));
      add('CallExpression', (node) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]?.type === 'Literal') {
          check(node, node.arguments[0]);
        }
      });
    }

    const calls = byKind('call');
    if (calls.length > 0) {
      const onCall = (node) => {
        const names = calleeNames(node, sourceCode);
        for (const { row, m, re } of calls) {
          const hit = names.find((n) => re.test(n));
          if (!hit) continue;
          if (m.arg) {
            const argRe = new RegExp(m.arg.pattern);
            const args = m.arg.index === 'any' ? node.arguments : [node.arguments[m.arg.index ?? 0]].filter(Boolean);
            if (!args.some((a) => argTexts(a, sourceCode, context).some((t) => argRe.test(t)))) continue;
          }
          report(row, node, hit);
        }
      };
      add('CallExpression', onCall);
      add('NewExpression', onCall);
    }

    const members = byKind('member');
    if (members.length > 0) {
      add('MemberExpression', (node) => {
        const text = memberText(node, sourceCode);
        for (const { row, re } of members) if (re.test(text)) report(row, node, text);
      });
    }

    const regexLiterals = byKind('regex-literal');
    if (regexLiterals.length > 0) {
      add('Literal', (node) => {
        if (!node.regex) return;
        for (const { row, re } of regexLiterals) if (re.test(node.regex.pattern)) report(row, node, `/${node.regex.pattern}/${node.regex.flags}`);
      });
      const onRegExp = (node) => {
        if (!isRegExpCallee(node.callee) || node.arguments.length === 0) return;
        const texts = staticPatternTexts(node.arguments[0], sourceCode, context);
        for (const { row, re } of regexLiterals) {
          const hit = texts.find((t) => re.test(t));
          if (hit !== undefined) report(row, node, `RegExp(${JSON.stringify(hit)})`);
        }
      };
      add('CallExpression', onRegExp);
      add('NewExpression', onRegExp);
    }

    const regexes = byKind('file-regex');
    if (regexes.length > 0) {
      add('Program:exit', () => {
        const text = sourceCode.text;
        for (const { row, m } of regexes) {
          const allowed = Number(row.baseline?.[rel] ?? 0);
          fileRegexMatches(m, text).forEach((hit, i) => {
            if (i < allowed) return;
            const start = sourceCode.getLocFromIndex(hit.index);
            const end = sourceCode.getLocFromIndex(hit.index + hit.text.length);
            report(row, null, hit.text, { start, end });
          });
        }
      });
    }

    return listeners;
  },
};

export default rule;
