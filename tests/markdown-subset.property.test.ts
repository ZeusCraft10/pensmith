// tests/markdown-subset.property.test.ts — the built-in writers' Markdown
// reader against pandoc (D-21-10).
//
// The docx, PDF and LaTeX writers that run without pandoc read the gated text
// with bin/lib/export/markdown.ts. This differential generates drafts from the
// constructs a gated draft holds — ATX headings, paragraphs with emphasis,
// strong emphasis, inline code, links, escapes, entities and hard line
// breaks, bullet and ordered lists (tight and loose, nested), block quotes,
// fenced code, horizontal rules and pipe tables — and requires that our block
// and inline structure equals pandoc's (`pandoc -f markdown-yaml_metadata_block
// -raw_attribute-raw_tex-smart -t json`; smart typography is a spelling the
// writers apply afterwards, not structure). 1000 drafts, batched into a few
// pandoc runs. Required with CI=true. A second case writes generated drafts
// with the built-in docx writer and reads them back with `pandoc -f docx -t
// plain`: the text matches pandoc's own plain rendering of the draft.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parseMarkdown, type Block, type Inline } from '../bin/lib/export/markdown.js';
import { buildExportDocument } from '../bin/lib/export/document.js';
import { writeDocx } from '../bin/lib/export/docx-writer.js';
import { prepareText } from '../bin/lib/export/render.js';
import { requirePandoc, runPandocIn } from './helpers/pandoc-oracle.js';

const SEED = Number(process.env['PENSMITH_SUBSET_SEED'] ?? 21010);
const RUNS = Number(process.env['PENSMITH_SUBSET_RUNS'] ?? 1000);
const BATCH = 100;
const READER = 'markdown-yaml_metadata_block-raw_attribute-raw_tex-smart';

// ---------------------------------------------------------------------------
// Generated drafts
// ---------------------------------------------------------------------------

const word = fc.oneof(
  { weight: 6, arbitrary: fc.stringMatching(/^[a-z]{1,8}$/) },
  { weight: 1, arbitrary: fc.stringMatching(/^[A-Z][a-z]{1,6}$/) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 2030 }).map(String) },
);
const words = (min: number, max: number): fc.Arbitrary<string> => fc.array(word, { minLength: min, maxLength: max }).map((w) => w.join(' '));
const punct = fc.constantFrom('.', ',', ';', ':', '?', '!');
const inlineAtom = fc.oneof(
  { weight: 8, arbitrary: words(1, 4) },
  { weight: 2, arbitrary: words(1, 3).map((w) => `*${w}*`) },
  { weight: 2, arbitrary: words(1, 3).map((w) => `**${w}**`) },
  { weight: 1, arbitrary: word.map((w) => `_${w}_`) },
  { weight: 1, arbitrary: fc.stringMatching(/^[a-z][a-z0-9 ]{0,10}[a-z0-9]$/).map((c) => `\`${c}\``) },
  { weight: 1, arbitrary: fc.tuple(words(1, 2), fc.stringMatching(/^[a-z]{1,6}$/)).map(([t, p]) => `[${t}](https://example.org/${p})`) },
  { weight: 1, arbitrary: fc.constantFrom('\\*', '\\_', '\\[', '\\]', '\\#', '&amp;', '&lt;', '&gt;', '&copy;') },
  { weight: 1, arbitrary: fc.tuple(word, punct).map(([w, p]) => `${w}${p}`) },
);
const inlineLine = fc.array(inlineAtom, { minLength: 1, maxLength: 6 }).map((a) => a.join(' '));
const paragraph = fc.array(inlineLine, { minLength: 1, maxLength: 3 }).chain((lines) =>
  fc.constantFrom('\n', '  \n', '\\\n').map((sep) => lines.join(sep)),
);
const heading = fc.tuple(fc.integer({ min: 1, max: 3 }), words(1, 5)).map(([n, t]) => `${'#'.repeat(n)} ${t}`);
const listItem = inlineLine;
const bulletList = fc.tuple(fc.array(listItem, { minLength: 1, maxLength: 4 }), fc.boolean(), fc.option(fc.array(listItem, { minLength: 1, maxLength: 3 }), { nil: undefined })).map(
  ([items, loose, sub]) =>
    items
      .map((it, i) => `- ${it}${i === 0 && sub !== undefined ? `\n${sub.map((s) => `  - ${s}`).join('\n')}` : ''}`)
      .join(loose ? '\n\n' : '\n'),
);
const orderedList = fc.tuple(fc.array(listItem, { minLength: 1, maxLength: 4 }), fc.boolean(), fc.integer({ min: 1, max: 5 })).map(([items, loose, start]) =>
  items.map((it, i) => `${start + i}. ${it}`).join(loose ? '\n\n' : '\n'),
);
const quote = fc.array(inlineLine, { minLength: 1, maxLength: 2 }).map((lines) => lines.map((l) => `> ${l}`).join('\n'));
const code = fc.array(fc.stringMatching(/^[a-z0-9 =();]{0,20}$/), { minLength: 1, maxLength: 3 }).map((lines) => `\`\`\`\n${lines.join('\n')}\n\`\`\``);
const hr = fc.constantFrom('---', '***', '* * *');
const table = fc.tuple(fc.integer({ min: 2, max: 3 }), fc.integer({ min: 1, max: 3 })).chain(([cols, rows]) =>
  fc.tuple(
    fc.array(word, { minLength: cols, maxLength: cols }),
    fc.array(fc.constantFrom('---', ':--', '--:', ':-:'), { minLength: cols, maxLength: cols }),
    fc.array(fc.array(words(1, 2), { minLength: cols, maxLength: cols }), { minLength: rows, maxLength: rows }),
  ).map(([head, seps, body]) => [`| ${head.join(' | ')} |`, `|${seps.join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n')),
);
const block = fc.oneof(
  { weight: 6, arbitrary: paragraph },
  { weight: 2, arbitrary: heading },
  { weight: 2, arbitrary: bulletList },
  { weight: 1, arbitrary: orderedList },
  { weight: 1, arbitrary: quote },
  { weight: 1, arbitrary: code },
  { weight: 1, arbitrary: hr },
  { weight: 1, arbitrary: table },
);
const draft = fc.array(block, { minLength: 1, maxLength: 7 }).map((b) => `${b.join('\n\n')}\n`);

// ---------------------------------------------------------------------------
// One normal form for both readers
// ---------------------------------------------------------------------------

type N = unknown;

function mergeText(out: N[], text: string): void {
  const last = out[out.length - 1];
  if (typeof last === 'string') out[out.length - 1] = last + text;
  else out.push(text);
}

function normOurs(nodes: readonly Inline[]): N[] {
  const out: N[] = [];
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        mergeText(out, n.text);
        break;
      case 'break':
        out.push({ br: true });
        break;
      case 'code':
        out.push({ code: n.text });
        break;
      case 'link':
        out.push({ a: n.href, c: normOurs(n.children) });
        break;
      case 'note':
        out.push({ note: n.n });
        break;
      default:
        out.push({ [n.t]: normOurs(n.children) });
    }
  }
  return out;
}

function normOurBlocks(blocks: readonly Block[]): N[] {
  return blocks.map((b): N => {
    switch (b.t) {
      case 'heading':
        return { h: b.level, i: normOurs(b.children) };
      case 'para':
        return { p: normOurs(b.children) };
      case 'plain':
        return { plain: normOurs(b.children) };
      case 'quote':
        return { q: normOurBlocks(b.blocks) };
      case 'bullets':
        return { ul: b.items.map(normOurBlocks) };
      case 'ordered':
        return { ol: b.start, items: b.items.map(normOurBlocks) };
      case 'code':
        return { code: b.text };
      case 'hr':
        return { hr: true };
      case 'table':
        return { table: b.aligns.map((a) => (a === 'default' ? 'd' : a[0])), head: b.head.map(normOurs), rows: b.rows.map((r) => r.map(normOurs)) };
    }
  });
}

interface PNode { t: string; c?: unknown }

function normPandoc(nodes: readonly PNode[]): N[] {
  const out: N[] = [];
  for (const n of nodes) {
    switch (n.t) {
      case 'Str':
        mergeText(out, n.c as string);
        break;
      case 'Space':
      case 'SoftBreak':
        mergeText(out, ' ');
        break;
      case 'LineBreak':
        out.push({ br: true });
        break;
      case 'Code':
        out.push({ code: (n.c as [unknown, string])[1] });
        break;
      case 'Link': {
        const [, kids, [href]] = n.c as [unknown, PNode[], [string, string]];
        out.push({ a: href, c: normPandoc(kids) });
        break;
      }
      case 'Emph':
        out.push({ emph: normPandoc(n.c as PNode[]) });
        break;
      case 'Strong':
        out.push({ strong: normPandoc(n.c as PNode[]) });
        break;
      case 'Strikeout':
        out.push({ strike: normPandoc(n.c as PNode[]) });
        break;
      case 'Superscript':
        out.push({ sup: normPandoc(n.c as PNode[]) });
        break;
      case 'Subscript':
        out.push({ sub: normPandoc(n.c as PNode[]) });
        break;
      default:
        out.push({ unsupported: n.t });
    }
  }
  return out;
}

const ALIGN: Readonly<Record<string, string>> = { AlignDefault: 'd', AlignLeft: 'l', AlignRight: 'r', AlignCenter: 'c' };

function cellInlines(cell: unknown): N[] {
  // Cell: [attr, alignment, rowspan, colspan, blocks]
  const blocks = (cell as [unknown, unknown, number, number, PNode[]])[4];
  return blocks.flatMap((b) => (b.t === 'Plain' || b.t === 'Para' ? normPandoc(b.c as PNode[]) : [{ unsupported: b.t }]));
}

function normPandocBlocks(blocks: readonly PNode[]): N[] {
  return blocks.map((b): N => {
    switch (b.t) {
      case 'Header': {
        const [level, , inl] = b.c as [number, unknown, PNode[]];
        return { h: level, i: normPandoc(inl) };
      }
      case 'Para':
        return { p: normPandoc(b.c as PNode[]) };
      case 'Plain':
        return { plain: normPandoc(b.c as PNode[]) };
      case 'BlockQuote':
        return { q: normPandocBlocks(b.c as PNode[]) };
      case 'BulletList':
        return { ul: (b.c as PNode[][]).map(normPandocBlocks) };
      case 'OrderedList': {
        const [[start], items] = b.c as [[number, unknown, unknown], PNode[][]];
        return { ol: start, items: items.map(normPandocBlocks) };
      }
      case 'CodeBlock':
        return { code: (b.c as [unknown, string])[1] };
      case 'HorizontalRule':
        return { hr: true };
      case 'Table': {
        const [, , colspecs, head, bodies] = b.c as [unknown, unknown, Array<[{ t: string }, unknown]>, [unknown, Array<[unknown, unknown[]]>], Array<[unknown, unknown, unknown, Array<[unknown, unknown[]]>]>];
        const headRow = head[1][0];
        return {
          table: colspecs.map(([a]) => ALIGN[a.t] ?? '?'),
          head: headRow === undefined ? [] : headRow[1].map(cellInlines),
          rows: bodies.flatMap((body) => body[3].map((row) => row[1].map(cellInlines))),
        };
      }
      default:
        return { unsupported: b.t };
    }
  });
}

/** pandoc's block structure for each draft, several drafts per run (each in its own div). */
function pandocBlocks(drafts: readonly string[]): N[][] {
  const out: N[][] = [];
  for (let from = 0; from < drafts.length; from += BATCH) {
    const batch = drafts.slice(from, from + BATCH);
    const doc = batch.map((d, i) => `::: {#d${from + i}}\n\n${d}\n:::\n\n`).join('');
    const json = JSON.parse(runPandocIn({ 'in.md': doc }, ['in.md', '-f', READER, '-t', 'json'])) as { blocks: PNode[] };
    const divs = json.blocks.filter((b) => b.t === 'Div');
    assert.equal(divs.length, batch.length, 'one div per draft');
    for (const d of divs) out.push(normPandocBlocks((d.c as [unknown, PNode[]])[1]));
  }
  return out;
}

test(`D-21-10: the subset reader builds pandoc's block and inline structure (${RUNS} generated drafts, seed ${SEED})`, (t) => {
  if (!requirePandoc(t, 'markdown subset differential')) return;
  const drafts = fc.sample(draft, { seed: SEED, numRuns: RUNS });
  const theirs = pandocBlocks(drafts);
  const failures: string[] = [];
  drafts.forEach((d, i) => {
    const parsed = parseMarkdown(d);
    const ours = normOurBlocks(parsed.blocks);
    if (JSON.stringify(ours) !== JSON.stringify(theirs[i])) {
      failures.push(`draft ${JSON.stringify(d)}\n  ours:   ${JSON.stringify(ours)}\n  pandoc: ${JSON.stringify(theirs[i])}`);
    }
    assert.deepEqual(parsed.literal, [], `a generated draft uses only the subset: ${JSON.stringify(d)}`);
  });
  assert.deepEqual(failures.slice(0, 3), [], `${failures.length} of ${drafts.length} drafts differ`);
});

test('D-21-10: anything outside the subset is written as its literal text, with a note — never dropped', () => {
  const r = parseMarkdown('A formula $x^2$ and <b>raw</b> HTML.\n\n::: note\nfenced\n:::\n\n![alt](img.png)\n');
  const text = JSON.stringify(r.blocks);
  for (const literal of ['$x', '<b>raw</b>', '::: note', '![alt](img.png)']) assert.ok(text.includes(literal.replace(/"/g, '\\"')), `${literal} kept in ${text}`);
  assert.ok(r.literal.some((l) => /TeX math/.test(l)) && r.literal.some((l) => /raw HTML/.test(l)) && r.literal.some((l) => /fenced div/.test(l)) && r.literal.some((l) => /image/.test(l)), r.literal.join('; '));
});

test('D-21-10: the built-in docx reads back through pandoc (-f docx -t plain) with the text pandoc gives the draft itself', async (t) => {
  if (!requirePandoc(t, 'docx read-back')) return;
  const drafts = fc.sample(draft, { seed: SEED + 1, numRuns: 40 });
  const norm = (s: string): string =>
    s
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/—/g, '---')
      .replace(/–/g, '--')
      .replace(/…/g, '...')
      .replace(/[─-]{3,}/g, '---')
      .replace(/\s+/g, ' ')
      .trim();
  for (const d of drafts) {
    const prep = await prepareText(d, [], null);
    const docx = await writeDocx(buildExportDocument(prep, { withBibliography: false }));
    const back = runPandocIn({ 'in.docx': docx }, ['in.docx', '-f', 'docx', '-t', 'plain', '--wrap=none']);
    const direct = runPandocIn({ 'in.md': d }, ['in.md', '-f', 'markdown-yaml_metadata_block-raw_attribute-raw_tex', '-t', 'plain', '--wrap=none']);
    // Pandoc's plain writer draws tables and rules from the source's layout;
    // the comparison is of the words, in order.
    const words = (s: string): string => norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    assert.equal(words(back), words(direct), `draft ${JSON.stringify(d)}`);
  }
});
