// tests/citation-integrity.property.test.ts — HARDEN-03 (D-20-09): the
// citation-integrity differential property test, with Pandoc as the oracle.
//
// fast-check generates drafts mixing bracketed, narrative, `[-@k]`, locator,
// prefix and suffix, multi-cite, nested-bracket, uppercase, collision-suffixed
// and punctuated (`: . - _ / # $ % & + ? < > ~`) citations, the UNPARSEABLE
// shapes, the VRFY-10 unsupported forms (footnotes, inline notes, in-draft
// reference lists, raw TeX and HTML citations, numbered and superscript
// markers, author-date prose, metadata blocks, raw {=format} output), and
// noise (emails, escapes, code, math, intervals, numbered labels, events and
// enumerations), with LF or CRLF line endings, some with a leading byte-order
// mark. The drafts are batched into a few `pandoc -t json` calls (one fenced
// Div per draft; a batch whose Divs do not come back one per draft is re-run
// draft by draft, and a draft with a byte-order mark runs alone, since Pandoc
// strips the mark only at the start of its input), and every draft is checked for:
//
//   Property A — every citationId in Pandoc's Cite nodes is in the Pass-1 key
//                set (extractCitedKeysForVerification), or the draft carries a
//                blocking text finding (UNPARSEABLE / UNSUPPORTED-FORM);
//   Property B — every key the offline exporter renders (citationItems over
//                findRenderedCitations — and, on a sample, the real exporter's
//                output) is in the Pass-1 key set;
//   Property C — the text half: a draft holding an unsupported or unparseable
//                form always carries a blocking finding (so it can never be
//                verified), and on a sample, Pass 1 over an empty bibliography
//                gives every Pandoc key a FABRICATED row and a blocked outcome.
//                The gate-level half runs the drafts through the ONE gate
//                core verify, compile and done share (verify/gate.ts
//                recomputeGate): a flagged draft is never `verified`, and a
//                key missing from the bibliography is a blocking FABRICATED.
//   Property D — no false positive: a clean draft (citations and noise —
//                intervals, shapes, numbered labels, math, emails — with no
//                code) carries no text finding.
//
// `Claim A [@smith2020 [see note]].` is a fixed regression example.
//
// Pandoc must be on PATH: with CI=true a missing pandoc FAILS the test (ci.yml
// installs pandoc 3.x on every runner); locally it is skipped with one loud
// line on stderr. Re-run a failure with PENSMITH_PROPERTY_SEED=<seed>.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fc from 'fast-check';
import {
  citationItems,
  extractCitedKeysForVerification,
  findRenderedCitations,
  findUnparseableCitations,
} from '../bin/lib/citation-token.js';
import { findUnsupportedForms } from '../bin/lib/verify/unsupported-forms.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { sectionOutcome } from '../bin/lib/verify/verdicts.js';
import { recomputeGate, rowBlocks } from '../bin/lib/verify/gate.js';
import { exportDraft } from '../bin/lib/exporter.js';

const RUNS = Math.max(1000, Number(process.env['PENSMITH_PROPERTY_RUNS'] ?? 1000));
const SEED = Number(process.env['PENSMITH_PROPERTY_SEED'] ?? Math.floor(Math.random() * 2 ** 31));
const BATCH = 250;

// ---- Pandoc ----------------------------------------------------------------------

function pandocVersion(): string | null {
  try {
    return /^pandoc\S*\s+(\S+)/m.exec(execFileSync('pandoc', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Every citationId in the Cite nodes under `node`, in order. */
function citeIds(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const v of node) citeIds(v, out);
  } else if (node !== null && typeof node === 'object') {
    const n = node as { t?: unknown; c?: unknown };
    if (n.t === 'Cite') for (const c of (n.c as [Array<{ citationId: string }>])[0]) out.push(c.citationId);
    for (const v of Object.values(node)) citeIds(v, out);
  }
  return out;
}

function pandocJson(md: string): { blocks: unknown[] } {
  return JSON.parse(execFileSync('pandoc', ['--from', 'markdown', '--to', 'json'], { input: md, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] })) as { blocks: unknown[] };
}

/** The Pandoc Cite keys of one draft (Pandoc's empty key `@{}` is reported `{}` by the grammar). */
function pandocKeysOne(md: string): string[] {
  return citeIds(pandocJson(md).blocks).map((k) => (k === '' ? '{}' : k));
}

/**
 * The Pandoc Cite keys of every draft, a few pandoc calls in all: each batch is
 * one document of fenced Divs (`::: {#hd<i>}`), split back from the JSON. A
 * batch that does not come back as exactly its Divs, in order (a draft whose
 * text escaped its Div), and a draft whose footnote labels another draft of
 * the batch also uses, are run on their own.
 */
function pandocKeysAll(drafts: readonly string[]): string[][] {
  const out: string[][] = new Array<string[]>(drafts.length);
  for (let from = 0; from < drafts.length; from += BATCH) {
    const idx = [...Array(Math.min(BATCH, drafts.length - from)).keys()].map((i) => from + i);
    const labels = new Map<string, number>();
    const batch: number[] = [];
    for (const i of idx) {
      const own = [...new Set([...(drafts[i] as string).matchAll(/\[\^([^\]\s]+)\]/g)].map((m) => m[1] as string))];
      // A leading byte-order mark is stripped only at the start of Pandoc's input: such a draft runs alone.
      if (own.some((l) => labels.has(l)) || (drafts[i] as string).charCodeAt(0) === 0xfeff) {
        out[i] = pandocKeysOne(drafts[i] as string);
        continue;
      }
      for (const l of own) labels.set(l, i);
      batch.push(i);
    }
    const doc = batch.map((i) => `::: {#hd${i}}\n\n${drafts[i] as string}\n\n:::\n\n`).join('');
    const blocks = pandocJson(doc).blocks as Array<{ t: string; c: [[string, unknown, unknown], unknown[]] }>;
    const divs = blocks.filter((b) => b.t === 'Div' && /^hd\d+$/.test(b.c[0][0]));
    const intact = blocks.length === batch.length && divs.length === batch.length && divs.every((d, j) => d.c[0][0] === `hd${batch[j] as number}`);
    batch.forEach((i, j) => {
      out[i] = intact ? citeIds((divs[j] as { c: [unknown, unknown[]] }).c[1]).map((k) => (k === '' ? '{}' : k)) : pandocKeysOne(drafts[i] as string);
    });
  }
  return out;
}

// ---- The draft generator ----------------------------------------------------------

interface Segment {
  readonly text: string;
  /** An unsupported or unparseable form (outside code): the draft must carry a finding. */
  readonly flagged: boolean;
}
interface Draft {
  readonly md: string;
  readonly flagged: boolean;
}

const NAMED_KEYS = [
  'smith2020', 'smith2020a', 'smith2020b', 'Vaswani2017', 'lee2021', 'doe.2021', 'doe:2021', 'doe-2021', 'doe_2021', 'doe/2021',
  'doe+2021', 'doe#1', '_ghost2099', 'ghost.2099', 'k$x', 'k%x', 'k&x', 'k?x', 'k<x', 'k>x', 'k~x', 'müller2020', 'Park2019',
];
const key = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...NAMED_KEYS) },
  { weight: 2, arbitrary: fc.stringMatching(/^[A-Za-z_][A-Za-z0-9]{0,6}(?:[:./#$%&+?<>~_-][A-Za-z0-9]{1,3}){0,2}$/) },
);
const page = fc.integer({ min: 1, max: 400 });
const ok = (text: string): Segment => ({ text, flagged: false });
const bad = (text: string): Segment => ({ text, flagged: true });

const citation: fc.Arbitrary<Segment> = fc.oneof(
  key.map((k) => ok(`[@${k}]`)),
  fc.tuple(key, page).map(([k, n]) => ok(`[@${k}, p. ${n}]`)),
  fc.tuple(key, page).map(([k, n]) => ok(`[@${k} p. ${n}]`)),
  key.map((k) => ok(`[see @${k}, chap. 2]`)),
  key.map((k) => ok(`[e.g., @${k}, emphasis added]`)),
  fc.tuple(key, key).map(([a, b]) => ok(`[@${a}; @${b}]`)),
  fc.tuple(key, key, page).map(([a, b, n]) => ok(`[see @${a}, pp. ${n}-${n + 3}; also -@${b}]`)),
  key.map((k) => ok(`[-@${k}]`)),
  key.map((k) => ok(`@${k} argues`)),
  key.map((k) => ok(`-@${k} notes`)),
  key.map((k) => ok(`@{${k}} says`)),
  key.map((k) => ok(`[@{${k}}]`)),
  key.map((k) => bad(`[@${k} [see note]]`)),
  key.map((k) => bad(`[see [x] @${k}]`)),
  key.map((k) => bad(`[@${k} with no close`)),
  fc.constant(bad('[@]')),
  key.map((k) => bad(`[@ ${k}]`)),
  key.map((k) => bad(`[-@] and @{${k} open`)),
  key.map((k) => bad(`[@${k}; @]`)),
);

const unsupported: fc.Arbitrary<Segment> = fc.oneof(
  fc.constant(bad('(Nguyen & Patel, 2019)')),
  fc.constant(bad('(Smith et al., 2019, p. 4)')),
  fc.constant(bad('Smith et al. (2019) found it')),
  fc.constant(bad('Nguyen and Patel (2019) agree')),
  fc.constant(bad('(World Health Organization, 2020)')),
  key.map((k) => bad(`^[see @${k}]`)),
  fc.constant(bad('^[Nguyen & Patel 2019]')),
  key.map((k) => bad(`\\cite{${k}}`)),
  key.map((k) => bad(`\\citep[p.~4]{${k}}`)),
  fc.constant(bad('<cite>Nguyen 2019</cite>')),
  fc.constant(bad('shown<sup>1</sup>')),
  fc.constant(bad('as shown [3]')),
  fc.constant(bad('studies¹ agree')),
  // MLA author-page and title forms, an APA personal communication.
  fc.constant(bad('asthma fell (Nguyen 45)')),
  fc.constant(bad('(Nguyen, *Street Trees*, 2019)')),
  fc.constant(bad('(T. Nguyen, personal communication, May 3, 2019)')),
  // Review round 2: forms whose markup hides them from a raw-text scan — the
  // reader sees the plain citation (emphasis, entities, escapes, link text,
  // inline HTML) — raw TeX notes, a table-source label, and single-author
  // narrative citations.
  fc.constantFrom(
    '(*Smith*, 2019)', '(**Smith**, 2019)', '(Smith&nbsp;et&nbsp;al., 2019)', 'attention \\[3\\]', 'memory \\[Smith, 2019\\]',
    '([Smith](http://example.org/s), 2019)', '(see [Nguyen & Patel, 2019](https://example.org/trees))', 'as [Nguyen et al., 2019](https://example.org) showed',
    '<a href="https://example.org">Nguyen et al., 2019</a>', '<span class="citation">Nguyen 2019</span>',
    'shade helps\\footnote{Nguyen, T. (2019). Street trees. Urban Climate, 3, 1-9.}', 'shade\\endnote{Nguyen 2019}', 'heat\\marginpar{Okafor 2021}',
    'asthma fell (Source: Okafor 2021)', 'Nguyen (2019) argued it', 'According to Nguyen (2019), it rose', "Nguyen's (2019) review agrees",
    'Nguyen and colleagues (2019) found it', 'Nguyen (2019, p. 5) wrote it', 'Nguyen (2019a) agrees',
    'Nguyen et al. [2019] showed it', 'as shown by Nguyen and Patel [2019]', 'it rose (see e.g. Nguyen 2019)', 'it rose (see, e.g., Nguyen & Patel, 2019)',
  ).map(bad),
  // Review round 3: forms outside the scanner's cue and verb lists — a lone name with any verb or none
  // (fail closed), a sentence-initial cue, a bare year after a citing cue, numbered markers in parentheses.
  fc.constantFrom(
    'Okonkwo (2017) developed it', 'it was introduced by Okonkwo (2017)', 'Kahneman (2011) coined it', 'Following Brandt (2016), it holds',
    'See Brandt (2016) for more', 'Okonkwo [2017] introduced it', 'As shown in Okonkwo, 2017, it holds', 'In Germany (2015), it fell',
    'common in older adults (3, 4)', 'rates vary (3–5)', 'As reported in (12), it rose', 'it rose (ref. 12)', 'it rose (refs. 3 and 4)',
  ).map(bad),
);

const noise: fc.Arbitrary<Segment> = fc.oneof(
  fc.constantFrom('Trees cool cities.', 'The effect was large.', 'Heat rose (n = 2019).', 'The Treaty of Versailles (1919) ended it.', 'Canopy fell sharply in the north', 'It rose.').map(ok),
  key.map((k) => ok(`mail x.${k.replace(/[^A-Za-z0-9]/g, '')}@example.org`)),
  key.map((k) => ok(`an escaped \\@${k}`)),
  key.map((k) => ok(`code \`@${k}\` here`)),
  fc.constant(ok('the interval $[1]$')),
  // Intervals, shapes, indices and numbered labels are not citation markers.
  fc.constantFrom('scores normalized to [0, 1]', 'a tensor of shape [32, 224, 224, 3]', 'values lie in [1, 5]', 'array indices [1] and [2]', 'as in (Figure 3) and (Apollo 11)').map(ok),
  // A lone name before a year the prose does not cite, emphasis and links that are not attributions.
  fc.constantFrom('Washington, D.C. (2019) hosted it', 'the Treaty of Versailles (1919) ended the war', 'a *large* effect', 'see the [methods](#methods) section', 'the [data](https://example.org/data) are open', 'the Treaty of Versailles [1919] ended the war').map(ok),
  // Review round 3: events and documents before a year, values and enumerations in parentheses.
  fc.constantFrom('Hurricane Katrina (2005) flooded it', 'the Paris Agreement (2015) set targets', 'a Likert scale (1–5) was used', 'Steps: (1) collect, (2) clean', 'the point (3, 4) lies above').map(ok),
);

const segment = fc.oneof({ weight: 4, arbitrary: citation }, { weight: 2, arbitrary: unsupported }, { weight: 3, arbitrary: noise });

/** A paragraph, or one of the block forms (a fenced code block, an in-draft reference list, a footnote). */
const block: fc.Arbitrary<{ text: string; flagged: boolean; note?: string }> = fc.oneof(
  { weight: 6, arbitrary: fc.tuple(fc.array(segment, { minLength: 1, maxLength: 6 }), fc.array(fc.constantFrom(' ', '\n'), { minLength: 6, maxLength: 6 })).map(([segs, joins]) => ({
    text: segs.map((s, i) => (i === 0 ? '' : joins[i] ?? ' ') + s.text).join(''),
    flagged: segs.some((s) => s.flagged),
  })) },
  { weight: 1, arbitrary: key.map((k) => ({ text: `\`\`\`\n@${k} and \\cite{${k}}\n\`\`\``, flagged: false })) },
  { weight: 1, arbitrary: fc.constant({ text: '### References\n\n- Nguyen, T. (2019). Shade and heat. Urban Climate.', flagged: true }) },
  // A metadata block that redefines a key, raw output (copied into the export unread).
  { weight: 1, arbitrary: key.map((k) => ({ text: `---\nreferences:\n- id: ${k.replace(/[^A-Za-z0-9]/g, '')}\n  title: Fabricated\n...`, flagged: true })) },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom('```{=latex}\n(Nguyen \\& Patel, 2019) \\cite{fake2019}\n```', '```{=openxml}\n<w:p><w:t>(Nguyen, 2019)</w:t></w:p>\n```', 'Inline `(Nguyen, 2019)`{=html} text.')
      .map((text) => ({ text, flagged: true })),
  },
  // Reference lists under other headings, or none (APA, MLA, Vancouver entries).
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(
        '## References Cited\n\nNguyen, T., & Patel, R. (2019). Street trees and urban asthma. Journal of Urban Climate, 12(3), 45–67.',
        '## Key Sources\n\n- Lee, K. (2021). Canopy. Nature, 1, 2.',
        'Nguyen, T., & Patel, R. (2019). Street trees and urban asthma. Journal of Urban Climate, 12(3), 45–67.',
        'Nguyen, Thanh. "Street Trees and Asthma." Journal of Urban Climate, vol. 12, 2019, pp. 45–67.',
        '1. Nguyen T, Patel R. Street trees and asthma. J Urban Clim. 2019;12(3):45-67.',
      )
      .map((text) => ({ text, flagged: true })),
  },
  { weight: 1, arbitrary: fc.tuple(fc.integer({ min: 1, max: 9 }), key).map(([n, k]) => ({ text: `A claim.[^n${n}]`, flagged: true, note: `[^n${n}]: Fakeson, A. (2019). See @${k}.` })) },
  // Review round 2: typed entries in containers, run-in labels and raw TeX environments.
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(
        '**References:** Nguyen, T., & Patel, R. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10.',
        '<p>Nguyen, T. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10.</p>',
        '<ol><li>Nguyen, T. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10.</li></ol>',
        '::: {.references}\nNguyen, T. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10.\n:::',
        '> Nguyen, T. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10.',
        'Term\n:   Nguyen, T. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10.',
        '| n | entry |\n|---|---|\n| 1 | Nguyen, T. (2019). Street trees and asthma. Journal of Urban Health, 3(2), 1-10. |',
        'Sources: World Bank (2020); Okafor 2021.',
        '\\begin{quote}\nNguyen said so.\n\\end{quote}',
      )
      .map((text) => ({ text, flagged: true })),
  },
);

/**
 * A block with no unsupported or unparseable form: citations and noise only
 * (Property A and B still apply to it; a clean draft must never be blocked for
 * nothing — the Pass-1 gate still sees every key).
 */
const cleanSegment = fc.oneof({ weight: 4, arbitrary: citation.filter((s) => !s.flagged) }, { weight: 3, arbitrary: noise });
const cleanBlock: fc.Arbitrary<{ text: string; flagged: boolean; note?: string }> = fc.oneof(
  { weight: 6, arbitrary: fc.array(cleanSegment, { minLength: 1, maxLength: 6 }).map((segs) => ({ text: segs.map((x) => x.text).join(' '), flagged: false })) },
  { weight: 1, arbitrary: key.map((k) => ({ text: `\`\`\`\n@${k} and \\cite{${k}}\n\`\`\``, flagged: false })) },
);

// A mixed draft is clean only about one time in ten (every block must draw no
// flagged segment), so a quarter of the drafts are drawn from clean blocks
// only: both shapes stay well represented whatever the seed.
const draft: fc.Arbitrary<Draft> = fc.tuple(
  fc.oneof({ weight: 3, arbitrary: fc.array(block, { minLength: 1, maxLength: 4 }) }, { weight: 1, arbitrary: fc.array(cleanBlock, { minLength: 1, maxLength: 4 }) }),
  fc.boolean(),
  // Review round 3: a draft saved with a leading byte-order mark (Pandoc strips it and reads line 1 normally).
  fc.integer({ min: 0, max: 7 }).map((n) => n === 0),
).map(([blocks, crlf, bom]) => {
  const notes = blocks.flatMap((b) => (b.note !== undefined ? [b.note] : []));
  const md = [...blocks.map((b) => b.text), ...notes].join('\n\n') + '\n';
  return { md: (bom ? '\uFEFF' : '') + (crlf ? md.replace(/\n/g, '\r\n') : md), flagged: blocks.some((b) => b.flagged) };
});

// ---- The properties -----------------------------------------------------------------

function findings(md: string): number {
  return findUnparseableCitations(md).length + findUnsupportedForms(md).length;
}

/** Why `d` breaks a property, given Pandoc's keys for it ([] when it holds). */
function violations(d: Draft, pandoc: readonly string[]): string[] {
  const out: string[] = [];
  const pass1 = new Set(extractCitedKeysForVerification(d.md));
  const blocked = findings(d.md) > 0;
  const missed = pandoc.filter((k) => !pass1.has(k));
  if (missed.length > 0 && !blocked) out.push(`A: Pandoc cites ${JSON.stringify(missed)}, which Pass 1 never sees, and no text finding blocks the draft`);
  const rendered = findRenderedCitations(d.md).flatMap((c) => citationItems(c).map((i) => i.key));
  const unseen = rendered.filter((k) => !pass1.has(k));
  if (unseen.length > 0) out.push(`B: the exporter renders ${JSON.stringify(unseen)}, which Pass 1 never sees`);
  if (d.flagged && !blocked) out.push('C: an unsupported or unparseable form yields no blocking finding');
  // D: a clean draft is never blocked for nothing. (Code is left out: where the
  // grammar cannot PROVE a span is code, it scans it — fail closed — so a
  // `\cite` shown in a code block may count when another construct voids the proof.)
  if (!d.flagged && blocked && !d.md.includes('`')) out.push(`D: a clean draft has a text finding (${[...findUnparseableCitations(d.md), ...findUnsupportedForms(d.md)].map((f) => f.text).join(' | ')})`);
  return out;
}

const PANDOC = pandocVersion();
let skipAnnounced = false;

function requirePandoc(t: { skip(msg?: string): void }): boolean {
  if (PANDOC !== null) return true;
  if (process.env['CI'] === 'true') {
    assert.fail('HARDEN-03: pandoc is not on PATH, and CI=true requires it (ci.yml installs pandoc 3.x on every runner)');
  }
  if (!skipAnnounced) {
    skipAnnounced = true;
    process.stderr.write('\n*** HARDEN-03 SKIPPED: pandoc is not on PATH — install pandoc 3.x to run the citation-integrity property test (CI runs it) ***\n\n');
  }
  t.skip('pandoc is not on PATH');
  return false;
}

test(`HARDEN-03: Properties A, B, C and D hold over ${RUNS} generated drafts against pandoc (seed ${SEED})`, async (t) => {
  if (!requirePandoc(t)) return;
  const t0 = Date.now();
  const sample = fc.sample(draft, { seed: SEED, numRuns: RUNS });
  const keys = pandocKeysAll(sample.map((d) => d.md));
  const cache = new Map(sample.map((d, i) => [d.md, keys[i] as string[]] as const));
  let checked = 0;
  fc.assert(
    fc.property(draft, (d) => {
      checked += 1;
      const pandoc = cache.get(d.md) ?? pandocKeysOne(d.md); // a shrunk draft is sent on its own
      const v = violations(d, pandoc);
      if (v.length > 0) throw new Error(`${v.join('; ')}\n  draft: ${JSON.stringify(d.md)}\n  pandoc: ${JSON.stringify(pandoc)}`);
    }),
    { seed: SEED, numRuns: RUNS },
  );
  assert.ok(checked >= RUNS, `${checked} drafts checked`);
  // The generator reaches every shape it is meant to: pandoc cites something,
  // some drafts are blocked by a text finding, some are clean.
  assert.ok(keys.filter((k) => k.length > 0).length > RUNS / 2, 'most drafts carry a citation Pandoc renders');
  assert.ok(sample.filter((d) => d.flagged).length > RUNS / 10 && sample.filter((d) => !d.flagged).length > RUNS / 10, 'flagged and clean drafts');
  process.stderr.write(`HARDEN-03: ${RUNS} drafts checked against pandoc ${PANDOC} in ${Date.now() - t0} ms (seed ${SEED})\n`);
});

test('HARDEN-03: the fixed example `Claim A [@smith2020 [see note]].` — Pandoc cites smith2020, Pass 1 sees it, and the draft is blocked', (t) => {
  if (!requirePandoc(t)) return;
  const md = 'Claim A [@smith2020 [see note]].';
  assert.deepEqual(pandocKeysOne(md), ['smith2020']);
  assert.deepEqual(extractCitedKeysForVerification(md), ['smith2020']);
  assert.deepEqual(findUnparseableCitations(md).map((f) => f.form), ['nested-bracket']);
  assert.deepEqual(violations({ md, flagged: true }, ['smith2020']), []);
});

test('HARDEN-03 (Property C): Pass 1 over an empty bibliography gives every Pandoc key of a generated draft a FABRICATED row, and the outcome blocks', async (t) => {
  if (!requirePandoc(t)) return;
  const sample = fc.sample(draft, { seed: SEED + 1, numRuns: 40 });
  const keys = pandocKeysAll(sample.map((d) => d.md));
  for (const [i, d] of sample.entries()) {
    const rows = await runPass1(d.md, path.join(os.tmpdir(), 'no-such-CITATIONS.bib'), { bibEntries: [] });
    const verdicts = new Map(rows.map((r) => [r.citekey, r.verdict] as const));
    for (const k of keys[i] as string[]) assert.equal(verdicts.get(k), 'FABRICATED', `${k} in ${JSON.stringify(d.md)}`);
    if (rows.length > 0) assert.equal(sectionOutcome(rows).blocked, true);
  }
});

test('HARDEN-03 (Property C, gate level): the ONE gate core never passes a generated draft with a form it cannot check, and every Pandoc key missing from the bibliography is a blocking FABRICATED row', async (t) => {
  if (!requirePandoc(t)) return;
  const sample = fc.sample(draft, { seed: SEED + 3, numRuns: 60 });
  const keys = pandocKeysAll(sample.map((d) => d.md));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-harden03-gate-'));
  try {
    fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
    const bib = { path: path.join(root, '.paper', 'CITATIONS.bib'), exists: true, entries: [], problems: [] };
    let flagged = 0;
    for (const [i, d] of sample.entries()) {
      const pandoc = keys[i] as string[];
      // The allowed set holds every key the draft names, so UNASSIGNED never
      // decides the outcome: only the text findings and the registrar rows do.
      const allowed = new Set([...pandoc, ...extractCitedKeysForVerification(d.md)]);
      const gate = await recomputeGate({ root, text: d.md, allowedKeys: allowed, scope: { kind: 'section', id: '1' }, dryRun: false, bib });
      const where = JSON.stringify(d.md);
      if (d.flagged) {
        flagged += 1;
        assert.ok(gate.rows.some((r) => r.kind === 'text' && rowBlocks(r)), `a flagged draft has a blocking text row: ${where}`);
        assert.notEqual(gate.outcome.status, 'verified', `a flagged draft is never verified: ${where}`);
        assert.equal(gate.outcome.blocked, true, where);
      }
      const verdicts = new Map(gate.rows.filter((r) => r.kind === 'pass1').map((r) => [r.key, r.verdict] as const));
      for (const k of pandoc) assert.equal(verdicts.get(k), 'FABRICATED', `${k} (not in the bibliography) in ${where}`);
      if (pandoc.length > 0) assert.equal(gate.outcome.blocked, true, `a draft citing keys the bibliography lacks blocks: ${where}`);
    }
    assert.ok(flagged > 0, 'the sample holds flagged drafts (the check is not vacuous)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('HARDEN-03 (Property B): the real offline exporter renders only keys Pass 1 sees', async (t) => {
  if (!requirePandoc(t)) return;
  const sample = fc.sample(draft, { seed: SEED + 2, numRuns: 25 });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-harden03-'));
  const writes: string[] = [];
  let renderedTotal = 0;
  const stderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk)); // the exporter's "cited key(s) not in CITATIONS.bib" WARNs
    return true;
  }) as typeof process.stderr.write;
  try {
    for (const [i, d] of sample.entries()) {
      const dir = path.join(root, `p${i}`);
      fs.mkdirSync(path.join(dir, '.paper'), { recursive: true });
      // Every key the draft could name gets an entry whose author is unique:
      // a rendered citation shows that author in the exported body.
      const candidates = [...new Set([...pandocKeysOne(d.md), ...extractCitedKeysForVerification(d.md), ...findRenderedCitations(d.md).flatMap((c) => citationItems(c).map((x) => x.key))])]
        .filter((k) => /^[A-Za-z0-9_:./+-]+$/.test(k));
      const author = (j: number): string => `Zq${String.fromCharCode(97 + (j % 26))}${String.fromCharCode(97 + Math.floor(j / 26) % 26)}x`;
      const bib = candidates.map((k, j) => `@article{${k}, author = {${author(j)}, Ann}, title = {Title ${j}}, journal = {J}, year = {2020}}`).join('\n');
      fs.writeFileSync(path.join(dir, '.paper', 'CITATIONS.bib'), `${bib}\n`);
      const input = path.join(dir, '.paper', 'DRAFT.md');
      fs.writeFileSync(input, d.md);
      const res = await exportDraft({ inputPath: input, format: 'md', paperRoot: dir, pandocPresent: false, style: 'apa' });
      const body = (fs.readFileSync(res.outputPath, 'utf8').split('## References')[0] as string);
      const pass1 = new Set(extractCitedKeysForVerification(d.md));
      const rendered = candidates.filter((_k, j) => body.includes(author(j)));
      for (const k of rendered) assert.ok(pass1.has(k), `the exporter rendered ${k}, which Pass 1 never sees: ${JSON.stringify(d.md)}`);
      renderedTotal += rendered.length;
    }
  } finally {
    process.stderr.write = stderr;
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.ok(renderedTotal > 0, 'the exporter rendered citations (the check is not vacuous)');
  assert.ok(writes.every((w) => !/Error|stack/i.test(w)), writes.join(''));
});
