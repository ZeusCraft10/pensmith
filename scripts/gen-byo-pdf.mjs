// scripts/gen-byo-pdf.mjs — generator for the committed PDF fixtures:
//   tests/fixtures/pdf/byo-text.pdf  (Phase 8 BYO text fixture, unchanged)
//   tests/fixtures/byo/*.pdf         (SRC-13 / SRC-15 PDF identification, D-19-20)
//
// Produces WELL-FORMED uncompressed PDFs via pdf-lib (already a dependency).
// History: a prior hand-rolled %PDF-1.4 with a byte-offset xref table parsed
// locally + on win/mac but failed on ubuntu CI with PDF.js "bad XRef entry"
// (the hand-built xref was fragile across PDF.js platform builds). pdf-lib
// emits a spec-correct classic xref; `useObjectStreams: false` keeps the
// catalog/pages/page/font objects uncompressed and the text content stream as
// plain `BT /F1 Tf Td (..) Tj ET` operators, which pdf-parse@1.1.1 (a 2018
// pdf.js fork) extracts reliably on all three OSes. Creation/modification
// dates are pinned to the epoch so every regeneration is byte-identical.
//
// The tests/fixtures/byo/ set (the works they name have recorded registrar
// answers under tests/fixtures/cassettes/ where noted):
//   attention-arxiv-layout.pdf  laid out like arXiv 1706.03762's first page: a
//                               permission notice on lines 1-2, the title on
//                               line 3, an author line, affiliations, e-mails,
//                               the abstract, and the arXiv stamp down the left
//                               margin → identified by its arXiv id
//                               (cassettes/arxiv/id-1706.03762.json)
//   attention-title-only.pdf    the same page without the stamp or any
//                               identifier → identified by title + first author
//   doi-footer.pdf              "Measured measurement" (Aspelmeyer 2009) with
//                               its DOI in the page footer → identified by DOI
//                               (cassettes/crossref/works-nphys1170.json)
//   metadata-doi.pdf            "Deep learning" (LeCun, Bengio, Hinton 2015)
//                               whose DOI is in the Info dictionary (Subject,
//                               and a custom `doi` key) → identified by the
//                               embedded metadata
//   no-match.pdf                an unpublished field note no registrar knows →
//                               never identified
//   image-only.pdf              a page with shapes and no text → no
//                               extractable text
//   cites-in-footnote.pdf       a student essay whose page-1 footnote and
//                               page-2 reference list cite "Deep learning"
//                               with its DOI (10.1038/nature14539, recorded)
//                               → never identified as LeCun 2015: the DOI
//                               names a work the essay cites, not the essay
//
// Run via: node scripts/gen-byo-pdf.mjs   (from the repository root)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';

const EPOCH = new Date(0);

async function newDoc() {
  const doc = await PDFDocument.create();
  // Determinism: pin metadata to epoch so the committed fixture is byte-stable
  // across regenerations (no wall-clock CreationDate/ModDate drift).
  doc.setCreationDate(EPOCH);
  doc.setModificationDate(EPOCH);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}

/** Draw `lines` top-down; each entry is a string or {text, size, bold, gap}. */
function drawLines(page, fonts, lines, { x = 56, y = 740 } = {}) {
  let cursor = y;
  for (const entry of lines) {
    const spec = typeof entry === 'string' ? { text: entry } : entry;
    const size = spec.size ?? 10;
    cursor -= spec.gap ?? 0;
    if (spec.text) page.drawText(spec.text, { x, y: cursor, size, font: spec.bold ? fonts.bold : fonts.font });
    cursor -= size + 6;
  }
}

async function save(doc, file) {
  // useObjectStreams:false → classic uncompressed xref table (no cross-reference
  // streams), which the old pdf-parse PDF.js fork parses without "bad XRef entry".
  const bytes = await doc.save({ useObjectStreams: false });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  console.log('wrote', file, bytes.length, 'bytes');
}

// ---------------------------------------------------------------------------
// tests/fixtures/pdf/byo-text.pdf (Phase 8; byte-identical to earlier runs).
// ---------------------------------------------------------------------------
{
  const lines = [
    'Attention Is All You Need',
    'Vaswani Shazeer Parmar Uszkoreit 2017',
    'Abstract The dominant sequence transduction models are based on',
    'complex recurrent or convolutional neural networks',
    'We propose the Transformer based solely on attention mechanisms',
    'doi 10.48550 arXiv 1706.03762',
  ];
  const doc = await PDFDocument.create();
  doc.setCreationDate(EPOCH);
  doc.setModificationDate(EPOCH);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  let y = 740;
  for (const ln of lines) {
    page.drawText(ln, { x: 56, y, size: 12, font });
    y -= 18;
  }
  await save(doc, path.join('tests', 'fixtures', 'pdf', 'byo-text.pdf'));
}

// ---------------------------------------------------------------------------
// tests/fixtures/byo/
// ---------------------------------------------------------------------------
const BYO = path.join('tests', 'fixtures', 'byo');

const ATTENTION_PAGE = [
  'Provided proper attribution is provided, Google hereby grants permission to reproduce the tables and',
  'figures in this paper solely for use in journalistic or scholarly works.',
  { text: 'Attention Is All You Need', size: 17, bold: true, gap: 18 },
  { text: 'Ashish Vaswani*    Noam Shazeer*    Niki Parmar*    Jakob Uszkoreit*', gap: 10 },
  'Google Brain    Google Brain    Google Research    Google Research',
  'avaswani@google.com    noam@google.com    nikip@google.com    usz@google.com',
  { text: 'Llion Jones*    Aidan N. Gomez*    Lukasz Kaiser*    Illia Polosukhin*', gap: 6 },
  'Google Research    University of Toronto    Google Brain',
  { text: 'Abstract', bold: true, size: 12, gap: 14 },
  'The dominant sequence transduction models are based on complex recurrent or convolutional',
  'neural networks that include an encoder and a decoder. The best performing models also connect',
  'the encoder and decoder through an attention mechanism. We propose a new simple network',
  'architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence',
  'and convolutions entirely. Experiments on two machine translation tasks show these models to',
  'be superior in quality while being more parallelizable and requiring significantly less time to train.',
];

for (const [name, stamp] of [
  ['attention-arxiv-layout.pdf', true],
  ['attention-title-only.pdf', false],
]) {
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([612, 792]);
  if (stamp) {
    // The stamp arXiv prints down the left margin of page 1.
    page.drawText('arXiv:1706.03762v7  [cs.CL]  2 Aug 2023', {
      x: 30,
      y: 230,
      size: 18,
      font,
      rotate: degrees(90),
      color: rgb(0.5, 0.5, 0.5),
    });
  }
  drawLines(page, { font, bold }, ATTENTION_PAGE);
  page.drawText('31st Conference on Neural Information Processing Systems (NIPS 2017), Long Beach, CA, USA.', {
    x: 56,
    y: 60,
    size: 8,
    font,
  });
  await save(doc, path.join(BYO, name));
}

{
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([612, 792]);
  drawLines(page, { font, bold }, [
    'NEWS & VIEWS',
    { text: 'Measured measurement', size: 17, bold: true, gap: 16 },
    { text: 'Markus Aspelmeyer', gap: 8 },
    { text: 'Quantum measurements are usually thought of as instantaneous projections. Experiments', gap: 12 },
    'with superconducting circuits now follow a measurement as it unfolds in time, and show how',
    'the back-action of a weak, continuous measurement steers the state of a quantum system.',
    'Such experiments open the way to feedback control of individual quantum systems and to tests',
    'of the foundations of quantum mechanics in a new regime of macroscopic devices.',
  ]);
  page.drawText('NATURE PHYSICS | VOL 5 | JANUARY 2009 | www.nature.com/naturephysics    doi:10.1038/nphys1170', {
    x: 56,
    y: 40,
    size: 8,
    font,
  });
  await save(doc, path.join(BYO, 'doi-footer.pdf'));
}

{
  const { doc, font, bold } = await newDoc();
  doc.setTitle('Deep learning');
  doc.setAuthor('Yann LeCun; Yoshua Bengio; Geoffrey Hinton');
  doc.setSubject('Nature 521, 436-444 (2015). doi:10.1038/nature14539');
  doc.setKeywords(['deep learning', 'representation learning']);
  doc.getInfoDict().set(PDFName.of('doi'), PDFString.of('10.1038/nature14539'));
  const page = doc.addPage([612, 792]);
  drawLines(page, { font, bold }, [
    'REVIEW',
    { text: 'Deep learning', size: 17, bold: true, gap: 16 },
    { text: 'Yann LeCun, Yoshua Bengio & Geoffrey Hinton', gap: 8 },
    { text: 'Deep learning allows computational models that are composed of multiple processing layers', gap: 12 },
    'to learn representations of data with multiple levels of abstraction. These methods have',
    'dramatically improved the state-of-the-art in speech recognition, visual object recognition,',
    'object detection and many other domains such as drug discovery and genomics.',
  ]);
  await save(doc, path.join(BYO, 'metadata-doi.pdf'));
}

{
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([612, 792]);
  drawLines(page, { font, bold }, [
    { text: 'Field Notes on Moss Growth Beside the Old Mill Stream', size: 16, bold: true },
    { text: 'Harriet Quillfeather', gap: 8 },
    { text: 'These notes record weekly observations of moss cover on six stones beside the mill stream', gap: 12 },
    'between March and October. They were kept for a village history society and have not been',
    'published anywhere; no registrar holds a record of them, so an identifier lookup must fail',
    'and a title search must not return a confident match.',
  ]);
  await save(doc, path.join(BYO, 'no-match.pdf'));
}

{
  const { doc, font, bold } = await newDoc();
  const page = doc.addPage([612, 792]);
  drawLines(page, { font, bold }, [
    { text: 'Machine Perception and the Limits of Representation', size: 16, bold: true },
    { text: 'Jane Q. Student', gap: 8 },
    { text: 'Essay for PHIL 210, Philosophy of Mind', gap: 4 },
    { text: 'Whether a machine can be said to perceive depends on what we take representation to be.', gap: 14 },
    'Layered statistical models now label images and transcribe speech with striking accuracy,',
    'and some writers take this as evidence that such systems form representations of the world.1',
    'This essay argues that accuracy alone settles nothing about representation, because the same',
    'behaviour is compatible with several accounts of what, if anything, the system represents.',
  ]);
  page.drawText('1 Y. LeCun, Y. Bengio and G. Hinton, Deep learning, Nature 521 (2015) 436-444, https://doi.org/10.1038/nature14539.', {
    x: 56,
    y: 60,
    size: 8,
    font,
  });
  const page2 = doc.addPage([612, 792]);
  drawLines(page2, { font, bold }, [
    'The argument of the previous section applies to any system trained only on labelled examples.',
    { text: 'References', bold: true, size: 12, gap: 14 },
    'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444.',
    'https://doi.org/10.1038/nature14539',
  ]);
  await save(doc, path.join(BYO, 'cites-in-footnote.pdf'));
}

{
  const { doc } = await newDoc();
  const page = doc.addPage([612, 792]);
  // Shapes only — the stand-in for a scanned page: no text operators at all.
  for (let i = 0; i < 12; i++) {
    page.drawRectangle({ x: 60, y: 700 - i * 40, width: 480 - (i % 3) * 60, height: 12, color: rgb(0.2, 0.2, 0.2) });
  }
  await save(doc, path.join(BYO, 'image-only.pdf'));
}
