// tests/citation-grammar-pandoc.test.ts — the fail-closed citation grammar
// against Pandoc itself (review round 3 of Phase 18, D-18-42).
//
// Every gate (FEED-04 containment, Pass 1, the GATE-04 humanizer re-check, the
// export bibliography) reads citations through citation-token.ts. A citation
// Pandoc renders but the grammar misses is never contained and never verified
// (AUDIT-FINDINGS #2/#3), so the invariant is one-sided: every key Pandoc
// renders must be a key to the gates; the gates may see more (fail closed).
//
//   - tests/fixtures/citation-grammar/pandoc-cites.json: markdown cases with
//     the keys pandoc 3.9 renders (the review's bypasses, Pandoc's key grammar,
//     sub/superscript decoding, table cuts, code, and random documents from a
//     differential fuzzer); re-record with `node scripts/record-pandoc-cites.mjs`;
//   - cases marked `expect: "equal"` are Pandoc code the gates must NOT read
//     as a citation (a Python `@decorator`), so the proof that hides them works;
//   - when a pandoc is on PATH the same invariant is checked against it live,
//     and the recorded keys against it when it is the recorded version;
//   - tests/fixtures/citation-grammar/unparseable.json (Phase 20, VRFY-09,
//     D-20-07): each UNPARSEABLE rule against Pandoc's reading of its cases —
//     recorded, and live when a pandoc is on PATH.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { citationItems, extractCitedKeysForVerification, findCitations, findUnparseableCitations } from '../bin/lib/citation-token.js';
import { checkDraft } from '../bin/lib/draft-containment.js';

interface PandocCase {
  name: string;
  md: string;
  pandoc: string[];
  expect?: 'equal';
}

const CORPUS = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/citation-grammar/pandoc-cites.json', import.meta.url)), 'utf8'),
) as { pandoc: string; cases: PandocCase[] };

/** Pandoc's empty braced key `@{}` is reported as `{}` (it can never match a library citekey). */
const reported = (k: string): string => (k === '' ? '{}' : k);

function misses(c: PandocCase, pandocKeys: readonly string[]): string[] {
  const got = new Set(extractCitedKeysForVerification(c.md));
  return pandocKeys
    .filter((k) => !got.has(reported(k)))
    .map((k) => `${c.name}: pandoc cites "${k}", the gates see ${JSON.stringify([...got])} in ${JSON.stringify(c.md)}`);
}

test('every citation Pandoc renders is a key to the gates (recorded pandoc corpus)', () => {
  assert.ok(CORPUS.cases.length >= 100, `the corpus is not trivially small (${CORPUS.cases.length} cases)`);
  assert.deepEqual(CORPUS.cases.flatMap((c) => misses(c, c.pandoc)), []);
});

test('Pandoc code hides a narrative @key: fenced blocks (after a blank line or a paragraph), attributes, inline code, the backtick retreat', () => {
  const equal = CORPUS.cases.filter((c) => c.expect === 'equal');
  assert.ok(equal.length >= 6, 'the hiding cases are in the corpus');
  for (const c of equal) {
    assert.deepEqual(new Set(extractCitedKeysForVerification(c.md)), new Set(c.pandoc.map(reported)), c.name);
  }
});

test('FEED-04: each round-3 bypass is now a containment violation', () => {
  const opts = { assigned: ['good'], section: '1' };
  for (const draft of [
    '```x```\nText @evil here.\n```y``` [@good]',
    '… [@good]. See the appendix a](@evil) for details.',
    '<ab:@evil> [@good]',
    'Escaped \\` here @evil and ` tick [@good]',
    '`<!--` then @evil says it --> [@good]',
    '```\ncode\n```python\ntext\n```\nText @evil says.\n```js\n[@good]',
    '[@{ev{i}l}] [@good]',
    'A ~&#64;evil~ note [@good].',
    'x@a@evil [@good]',
    'x\n - \nk@evil y [@good]\n',
  ]) {
    const keys = checkDraft(draft, opts).map((v) => v.citekey);
    assert.ok(keys.some((k) => k.startsWith('ev')), `${JSON.stringify(draft)} → ${JSON.stringify(keys)}`);
  }
  assert.deepEqual(checkDraft('The `@dataclass` decorator [@good].\n\n```python\n@property\n```\n', opts), [], 'code is not a citation');
});

const execFileAsync = promisify(execFile);

/** The citation keys the pandoc on PATH renders for `md` (scripts/record-pandoc-cites.mjs reads them the same way). */
async function livePandocKeys(md: string): Promise<string[]> {
  const run = execFileAsync('pandoc', ['--from', 'markdown', '--to', 'json']);
  run.child.stdin?.end(md);
  const ast = JSON.parse((await run).stdout) as { blocks: unknown; meta: unknown };
  const keys: string[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const v of x) walk(v);
    } else if (x !== null && typeof x === 'object') {
      const node = x as { t?: unknown; c?: unknown };
      if (node.t === 'Cite') for (const c of (node.c as [Array<{ citationId: string }>])[0]) if (!keys.includes(c.citationId)) keys.push(c.citationId);
      for (const v of Object.values(x)) walk(v);
    }
  };
  walk(ast.blocks);
  walk(ast.meta);
  return keys;
}

test('the invariant holds against the pandoc on PATH, and the recorded keys match it (when one is installed)', async () => {
  let version: string | null = null;
  try {
    version = /^pandoc\S*\s+(\S+)/m.exec((await execFileAsync('pandoc', ['--version'])).stdout)?.[1] ?? null;
  } catch {
    version = null;
  }
  // No pandoc here: the recorded corpus above is the check (CI installs pandoc
  // 3.9 for the HARDEN-03 oracle, D-20-09, so CI runs this live check too).
  if (version === null) return;
  const live: string[][] = [];
  for (let i = 0; i < CORPUS.cases.length; i += 8) {
    live.push(...(await Promise.all(CORPUS.cases.slice(i, i + 8).map((c) => livePandocKeys(c.md)))));
  }
  assert.deepEqual(CORPUS.cases.flatMap((c, i) => misses(c, live[i] ?? [])), [], `pandoc ${version}`);
  if (version === CORPUS.pandoc) {
    const drift = CORPUS.cases.filter((c, i) => JSON.stringify(live[i]) !== JSON.stringify(c.pandoc)).map((c) => c.name);
    assert.deepEqual(drift, [], 'the recorded keys differ from this pandoc — re-record with `node scripts/record-pandoc-cites.mjs`');
  }
});

// ---- UNPARSEABLE (VRFY-09, D-20-07): every rule agrees with Pandoc --------------

interface PandocReading {
  cites: Array<Array<{ id: string; mode: string }>>;
  literal: string;
}

interface UnparseableCase {
  name: string;
  md: string;
  forms: string[];
  reading: PandocReading;
}

const UNPARSEABLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/citation-grammar/unparseable.json', import.meta.url)), 'utf8'),
) as { pandoc: string; cases: UnparseableCase[] };

/**
 * Why Pandoc's reading shows a rule's finding is not a citation the grammar
 * models (empty when it agrees). The grammar's own reading is findCitations.
 */
function disagreement(c: UnparseableCase, reading: PandocReading): string[] {
  const out: string[] = [];
  const findings = findUnparseableCitations(c.md);
  const narrativeKeys = new Set(findCitations(c.md).filter((x) => x.narrative).flatMap((x) => x.keys));
  const modes = (id: string): string[] => reading.cites.flat().filter((i) => i.id === id).map((i) => i.mode);
  for (const f of findings) {
    const keys = [...new Set(findCitations(f.text).flatMap((x) => citationItems(x).map((i) => i.key)))];
    switch (f.form) {
      case 'empty-key':
      case 'unterminated-braced-key': {
        // Pandoc prints the key-less `@` as text.
        const at = f.text.includes('@{') ? f.text.slice(f.text.indexOf('@{')) : f.text.slice(f.text.indexOf('@'));
        if (!reading.literal.includes(at.replace(/\s+/g, ' '))) out.push(`${f.form}: Pandoc does not print ${JSON.stringify(at)} as text`);
        break;
      }
      case 'unbalanced-bracket': {
        // Pandoc prints the "[" as text around a narrative citation of the key.
        if (!reading.literal.includes('[')) out.push('unbalanced-bracket: Pandoc does not print the "[" as text');
        for (const k of keys) if (!modes(k).every((m) => m === 'AuthorInText' || m === 'SuppressAuthor') || modes(k).length === 0) out.push(`unbalanced-bracket: Pandoc reads ${k} as ${JSON.stringify(modes(k))}`);
        break;
      }
      case 'nested-bracket': {
        // Pandoc reads one bracketed citation; the grammar reads a narrative one: a structure it does not model.
        for (const k of keys) {
          if (!modes(k).includes('NormalCitation')) out.push(`nested-bracket: Pandoc reads ${k} as ${JSON.stringify(modes(k))}`);
          if (!narrativeKeys.has(k)) out.push(`nested-bracket: the grammar models ${k} as Pandoc does`);
        }
        break;
      }
      default:
        out.push(`unknown form ${f.form}`);
    }
  }
  if (findings.length === 0) {
    // A negative: Pandoc cites exactly the keys the grammar reads, bracketed or narrative alike.
    const grammar = findCitations(c.md).map((x) => citationItems(x).map((i) => `${i.key}:${x.narrative === true ? 'narrative' : 'bracketed'}`));
    const pandoc = reading.cites.map((cl) => cl.map((i) => `${i.id}:${i.mode === 'AuthorInText' || (i.mode === 'SuppressAuthor' && cl.length === 1 && !c.md.includes(`[-@${i.id}`)) ? 'narrative' : 'bracketed'}`));
    if (JSON.stringify(grammar) !== JSON.stringify(pandoc)) out.push(`the grammar reads ${JSON.stringify(grammar)}, Pandoc ${JSON.stringify(pandoc)}`);
  }
  return out;
}

test('VRFY-09: each UNPARSEABLE rule reports its cases, and Pandoc 3.9 (recorded) confirms each is not a citation the grammar models', () => {
  assert.equal(UNPARSEABLE.pandoc, CORPUS.pandoc, 'both corpora are recorded with one pandoc');
  const rules = new Set(UNPARSEABLE.cases.flatMap((c) => c.forms));
  assert.deepEqual([...rules].sort(), ['empty-key', 'nested-bracket', 'unbalanced-bracket', 'unterminated-braced-key']);
  assert.ok(UNPARSEABLE.cases.some((c) => c.forms.length === 0), 'negatives are in the corpus');
  for (const c of UNPARSEABLE.cases) {
    assert.deepEqual(findUnparseableCitations(c.md).map((f) => f.form), c.forms, c.name);
    assert.deepEqual(disagreement(c, c.reading), [], c.name);
    // Fail closed twice: every key Pandoc cites is still a key to the gates.
    const got = new Set(extractCitedKeysForVerification(c.md));
    for (const k of c.reading.cites.flat().map((i) => i.id)) assert.ok(got.has(k), `${c.name}: ${k}`);
  }
  // The HARDEN-03 fixed example.
  assert.deepEqual(findUnparseableCitations('Claim A [@smith2020 [see note]].').map((f) => f.form), ['nested-bracket']);
});

/** Pandoc's reading of `md` by the pandoc on PATH (scripts/record-pandoc-cites.mjs pandocReading, the same walk). */
async function livePandocReading(md: string): Promise<PandocReading> {
  const run = execFileAsync('pandoc', ['--from', 'markdown', '--to', 'json']);
  run.child.stdin?.end(md);
  const ast = JSON.parse((await run).stdout) as { blocks: unknown };
  const cites: PandocReading['cites'] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const v of x) walk(v);
    } else if (x !== null && typeof x === 'object') {
      const node = x as { t?: unknown; c?: unknown };
      if (node.t === 'Cite') cites.push((node.c as [Array<{ citationId: string; citationMode: { t: string } }>])[0].map((i) => ({ id: i.citationId, mode: i.citationMode.t })));
      for (const v of Object.values(x)) walk(v);
    }
  };
  walk(ast.blocks);
  const literal = (x: unknown): string => {
    if (Array.isArray(x)) return x.map(literal).join('');
    const node = x as { t?: unknown; c?: unknown } | null;
    if (node === null || typeof node !== 'object' || typeof node.t !== 'string') return '';
    if (node.t === 'Str') return node.c as string;
    if (node.t === 'Space' || node.t === 'SoftBreak' || node.t === 'LineBreak') return ' ';
    if (['Cite', 'Code', 'CodeBlock', 'RawInline', 'RawBlock'].includes(node.t)) return '';
    return literal(node.c);
  };
  return { cites, literal: literal(ast.blocks) };
}

test('VRFY-09: each UNPARSEABLE rule agrees with the pandoc on PATH, and the recorded readings match it (when one is installed)', async () => {
  let version: string | null = null;
  try {
    version = /^pandoc\S*\s+(\S+)/m.exec((await execFileAsync('pandoc', ['--version'])).stdout)?.[1] ?? null;
  } catch {
    version = null;
  }
  if (version === null) return; // the recorded readings above are the check
  for (const c of UNPARSEABLE.cases) {
    const live = await livePandocReading(c.md);
    assert.deepEqual(disagreement(c, live), [], `${c.name} (pandoc ${version})`);
    if (version === UNPARSEABLE.pandoc) assert.deepEqual(live, c.reading, `${c.name}: re-record with \`node scripts/record-pandoc-cites.mjs\``);
  }
});
