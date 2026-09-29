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
//     and the recorded keys against it when it is the recorded version.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { extractCitedKeysForVerification } from '../bin/lib/citation-token.js';
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
  // No pandoc here (CI installs none): the recorded corpus above is the check.
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
