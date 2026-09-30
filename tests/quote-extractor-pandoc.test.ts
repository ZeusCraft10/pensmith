// tests/quote-extractor-pandoc.test.ts — VRFY-18: Pass 3 sees every direct
// quote Pandoc renders as one. Pandoc is the oracle: each Quoted node
// (straight or typographic, double or single marks, HTML entity marks) and
// each BlockQuote (at the top level, in a list item or a definition) of at
// least five words in a generated draft must be inside a quote
// extractQuotes returns. The extractor may extract more (escaped `\"…\"` and
// entity marks `&ldquo;…&rdquo;`, which Pandoc prints as literal marks); it
// may never extract less.
//
// Pandoc must be on PATH: with CI=true a missing pandoc FAILS the test (ci.yml
// installs pandoc 3.x); locally it is skipped with one loud line.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { extractQuotes } from '../bin/lib/quote-extractor.js';

const DRAFTS = 1500;
const BATCH = 250;

function pandocVersion(): string | null {
  try {
    return /^pandoc\S*\s+(\S+)/m.exec(execFileSync('pandoc', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))?.[1] ?? null;
  } catch {
    return null;
  }
}

const PANDOC = pandocVersion();

function requirePandoc(t: { skip(msg?: string): void }): boolean {
  if (PANDOC !== null) return true;
  if (process.env['CI'] === 'true') assert.fail('VRFY-18: pandoc is not on PATH, and CI=true requires it');
  process.stderr.write('\n*** VRFY-18 quote differential SKIPPED: pandoc is not on PATH (CI runs it) ***\n\n');
  t.skip('pandoc is not on PATH');
  return false;
}

type Node = { t: string; c?: unknown };

/** The text of Pandoc inlines as a reader sees it (citations and notes left out, as the extractor leaves them out). */
function inlineText(nodes: readonly Node[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.t) {
      case 'Str':
        out += n.c as string;
        break;
      case 'Space':
      case 'SoftBreak':
      case 'LineBreak':
        out += ' ';
        break;
      case 'Code':
      case 'Math':
        out += (n.c as [unknown, string])[1];
        break;
      case 'Quoted': {
        const [type, inner] = n.c as [{ t: string }, Node[]];
        const [o, c] = type.t === 'SingleQuote' ? ['‘', '’'] : ['“', '”'];
        out += `${o}${inlineText(inner)}${c}`;
        break;
      }
      case 'Emph':
      case 'Strong':
      case 'Strikeout':
      case 'Superscript':
      case 'Subscript':
      case 'SmallCaps':
      case 'Underline':
        out += inlineText(n.c as Node[]);
        break;
      case 'Span':
      case 'Link':
      case 'Image':
        out += inlineText((n.c as [unknown, Node[]])[1]);
        break;
      default:
        break; // Cite, Note, RawInline
    }
  }
  return out;
}

function blocksText(blocks: readonly Node[]): string {
  return blocks
    .map((b) => (b.t === 'Para' || b.t === 'Plain' ? inlineText(b.c as Node[]) : b.t === 'BlockQuote' ? blocksText(b.c as Node[]) : ''))
    .join(' ');
}

/** Every top-level quote Pandoc reads: Quoted nodes outside other quotes, and BlockQuotes (anywhere in lists and definitions). */
function pandocQuotes(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const v of node) pandocQuotes(v, out);
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  const n = node as Node;
  if (n.t === 'Quoted') {
    out.push(inlineText((n.c as [unknown, Node[]])[1]));
    return out;
  }
  if (n.t === 'BlockQuote') {
    out.push(blocksText(n.c as Node[]));
    return out;
  }
  if (n.t === 'Cite' || n.t === 'Note' || n.t === 'Code' || n.t === 'CodeBlock') return out;
  for (const v of Object.values(n)) pandocQuotes(v, out);
  return out;
}

/** Text compared the way a reader compares it: marks, dashes and ellipses in one form, whitespace collapsed. */
function norm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/—/g, '---')
    .replace(/–/g, '--')
    .replace(/\s+/g, ' ')
    .trim();
}

const wordCount = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// ---- The generator (seeded) -------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['model', 'data', 'attention', 'layer', 'result', 'network', 'signal', 'method', 'study', 'effect', 'value', 'system', "don't", "it's", 'claim'];
const MARKS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ['“', '”'],
  ["'", "'"],
  ['‘', '’'],
  ['&ldquo;', '&rdquo;'],
  ['&#8220;', '&#8221;'],
  ['&lsquo;', '&rsquo;'],
  ['&#39;', '&#39;'],
];

function draftOf(r: () => number): string {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const words = (n: number): string => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const key = (): string => pick(['smith2020', 'lee2019', 'Vaswani2017']);
  const paragraphs: string[] = [];
  const blocks = 1 + Math.floor(r() * 4);
  for (let b = 0; b < blocks; b += 1) {
    const kind = r();
    const text = words(5 + Math.floor(r() * 8));
    if (kind < 0.3) {
      const lead = pick(['> ', '- > ', '1. > ', '* > ', 'Term\n:   > ', '- item\n\n    > ']);
      paragraphs.push(`${lead}${text} [@${key()}]`);
      continue;
    }
    const sentences: string[] = [];
    for (let s = 0, n = 1 + Math.floor(r() * 3); s < n; s += 1) {
      const [o, c] = pick(MARKS);
      const t = r();
      if (t < 0.25) sentences.push(`The authors' ${words(4)} is what it's about.`);
      else if (t < 0.6) sentences.push(`${pick(['Thus', 'Indeed', 'As noted,', 'He said:'])} ${o}${words(5 + Math.floor(r() * 8))}${c} [@${key()}].`);
      else if (t < 0.8) sentences.push(`As @${key()} wrote, ${o}${words(5 + Math.floor(r() * 8))}${c}.`);
      else sentences.push(`Critics say ${o}${words(5 + Math.floor(r() * 8))}${c} in passing.`);
    }
    paragraphs.push(sentences.join(' '));
  }
  return `${paragraphs.join('\n\n')}\n`;
}

/** Each draft's Pandoc quotes, a few pandoc calls in all (one fenced Div per draft; a batch that does not come back intact runs draft by draft). */
function pandocQuotesAll(drafts: readonly string[]): string[][] {
  const json = (md: string): { blocks: unknown[] } =>
    JSON.parse(execFileSync('pandoc', ['--from', 'markdown', '--to', 'json'], { input: md, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] })) as { blocks: unknown[] };
  const out: string[][] = [];
  for (let from = 0; from < drafts.length; from += BATCH) {
    const batch = drafts.slice(from, from + BATCH);
    const doc = batch.map((d, j) => `::: {#qd${from + j}}\n\n${d}\n\n:::\n\n`).join('');
    const blocks = json(doc).blocks as Array<{ t: string; c: [[string, unknown, unknown], unknown[]] }>;
    const intact = blocks.length === batch.length && blocks.every((b, j) => b.t === 'Div' && b.c[0][0] === `qd${from + j}`);
    batch.forEach((d, j) => out.push(pandocQuotes(intact ? (blocks[j] as { c: [unknown, unknown[]] }).c[1] : json(d).blocks)));
  }
  return out;
}

function missed(md: string, pandoc: readonly string[]): string[] {
  const got = extractQuotes(md).map((q) => norm(q.text));
  return pandoc.map(norm).filter((p) => wordCount(p) >= 5 && !got.some((g) => g.includes(p)));
}

test('VRFY-18: every quote Pandoc reads in the reviewers\' forms is extracted — straight single quotes, entity marks, block quotes in list items and definitions', (t) => {
  if (!requirePandoc(t)) return;
  const q = 'the effect vanishes entirely once household income is controlled for';
  const forms = [
    `Smith argues that '${q}' [@smith2020].`,
    `Intro.\n\n- > ${q} [@smith2020]`,
    `Intro.\n\n1. > ${q} [@smith2020]`,
    `Term\n:   > ${q} [@smith2020]`,
    `As Harris and colleagues put it, 'NumPy was invented on the moon by a committee of forty seven penguins' [@harris2020, p. 357].`,
  ];
  const pandoc = pandocQuotesAll(forms);
  forms.forEach((md, i) => {
    assert.ok((pandoc[i] as string[]).length > 0, `pandoc reads a quote in ${JSON.stringify(md)}`);
    assert.deepEqual(missed(md, pandoc[i] as string[]), [], md);
  });
  // Escaped marks and entity marks print as literal quotation marks: extracted although Pandoc makes no Quoted node.
  for (const md of [`Escaped \\"${q}\\" [@smith2020].`, `Entity &ldquo;${q}&rdquo; [@smith2020].`, `&#8216;${q}&#8217; [@smith2020].`, `&quot;${q}&quot; [@smith2020].`]) {
    assert.deepEqual(extractQuotes(md).map((x) => [x.text, x.citekey]), [[q, 'smith2020']], md);
  }
});

test(`VRFY-18: pandoc differential — every Quoted node and BlockQuote of ${DRAFTS} generated drafts is inside an extracted quote`, (t) => {
  if (!requirePandoc(t)) return;
  const r = rng(0x9e0de18);
  const drafts = Array.from({ length: DRAFTS }, () => draftOf(r));
  const pandoc = pandocQuotesAll(drafts);
  let checked = 0;
  drafts.forEach((md, i) => {
    const p = pandoc[i] as string[];
    checked += p.filter((x) => wordCount(norm(x)) >= 5).length;
    const m = missed(md, p);
    if (m.length > 0) assert.fail(`draft ${i}: pandoc quotes the extractor missed: ${JSON.stringify(m)}\n${md}`);
  });
  assert.ok(checked > DRAFTS, `${checked} pandoc quotes checked`);
});
