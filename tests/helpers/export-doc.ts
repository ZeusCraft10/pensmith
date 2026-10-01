// tests/helpers/export-doc.ts — a rich sample paper for the built-in writer
// tests (docx, PDF, LaTeX): every construct of the Markdown subset plus
// in-text citations, superscripts, footnotes and a bibliography.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBibEntries } from '../../bin/lib/citations.js';
import { prepareText, type PreparedText } from '../../bin/lib/export/render.js';
import { buildExportDocument, type ExportDocument } from '../../bin/lib/export/document.js';

export const SAMPLE_BIB =
  '@article{lindqvist2012, author = {Lindqvist, Anna and Berg, Erik}, title = {Economic growth in China and the World Bank\'s lending policy}, journal = {Journal of Development Economics}, year = {2012}, volume = {98}, number = {2}, pages = {145--162}, doi = {10.1016/j.jdeveco.2011.08.003}}\n' +
  '@book{kuhn1962, author = {Kuhn, Thomas S.}, title = {The Structure of Scientific Revolutions}, publisher = {University of Chicago Press}, address = {Chicago}, year = {1962}}\n' +
  '@incollection{okafor2019, author = {Okafor, Chidi}, title = {Measuring trust in NGO networks}, booktitle = {Handbook of Civil Society Research}, editor = {Hart, Miriam and Patel, Ravi}, publisher = {Routledge}, address = {London}, year = {2019}, pages = {33--58}}\n';

export const SAMPLE_MD = [
  '# The Paradigm & the Bank: 100% "Growth"',
  '',
  '## Introduction',
  '',
  'Paradigms shift when anomalies accumulate [@kuhn1962]. Lending follows *growth* and **policy** [@lindqvist2012, p. 150]. Costs rose by 5% -- or $3 per unit -- in the #1 market_share case.',
  '',
  '> Trust can be measured, with care, across networks [@okafor2019 41].',
  '',
  '- First point with `code`',
  '- Second point',
  '  - A nested point',
  '',
  '1. One',
  '2. Two',
  '',
  '| Region | Growth |',
  '|:--|--:|',
  '| East | 4.2 |',
  '| West | 3.1 |',
  '',
  '```',
  'x = f(y)  # a comment',
  '```',
  '',
  '---',
  '',
  '## Discussion',
  '',
  '@lindqvist2012 argue that lending policy follows growth; see also [@kuhn1962; @okafor2019]. Greek α and β, and a link to [the data](https://example.org/data).',
  '',
].join('\n');

/** The sample paper prepared and built for the built-in writers in `style`. */
export async function sampleDocument(style: string, md = SAMPLE_MD): Promise<{ prep: PreparedText; doc: ExportDocument }> {
  const prep = await prepareText(md, parseBibEntries(SAMPLE_BIB).entries, style);
  return { prep, doc: buildExportDocument(prep, { withBibliography: true }) };
}

/** A paper folder holding the sample bibliography and `md` as its DRAFT.md. */
export function samplePaper(md = SAMPLE_MD): { root: string; inputPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-sample-paper-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), SAMPLE_BIB);
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, md);
  return { root, inputPath };
}
