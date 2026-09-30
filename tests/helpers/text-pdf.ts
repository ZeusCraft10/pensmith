// tests/helpers/text-pdf.ts — a real, deterministic PDF whose text layer is
// the given text (Phase 20 quotes stream: Pass 3's sources, the known-bad
// quotes, the extracted-text cache).
//
// pdf-lib draws the text with the standard Helvetica font. Its WinAnsi
// encoding covers ASCII, the typographic quotes, dashes, the ellipsis and the
// Latin-1 letters with diacritics; a /Differences entry adds the glyphs a PDF's
// text layer carries as extraction artifacts — the `fi` / `fl` ligatures and
// the soft hyphen — so the PDF holds them as PDFs from publishers do.
// Creation and modification dates are the epoch: the same text always gives
// the same bytes.

import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFOperatorNames as Ops } from 'pdf-lib';

/** Characters outside WinAnsi drawn through the font's /Differences: code → glyph name. */
const DIFFERENCES: Readonly<Record<string, readonly [number, string]>> = {
  'ﬁ': [0x80, 'fi'],
  'ﬂ': [0x81, 'fl'],
  '­': [0x8d, 'sfthyphen'],
};

/** WinAnsi codes of the characters above U+00FF it has. */
const WINANSI: Readonly<Record<string, number>> = {
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '…': 0x85,
};

function encode(line: string): string {
  let hex = '';
  for (const ch of line) {
    const cp = ch.codePointAt(0) as number;
    let b: number;
    const diff = DIFFERENCES[ch];
    if (diff !== undefined) b = diff[0];
    else if (WINANSI[ch] !== undefined) b = WINANSI[ch] as number;
    else if ((cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff)) b = cp;
    else throw new Error(`text-pdf: U+${cp.toString(16).toUpperCase().padStart(4, '0')} cannot be drawn with the standard font`);
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/** `text` broken into lines of at most `width` characters, at spaces (paragraphs kept). */
function wrap(text: string, width = 88): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      if (line !== '' && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else {
        line = line === '' ? word : `${line} ${word}`;
      }
    }
    out.push(line);
  }
  return out;
}

/** A PDF whose pages show `text` (wrapped; `\n` starts a new line). */
export async function textPdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const ctx = doc.context;
  const differences = ctx.obj([0x80, PDFName.of('fi'), PDFName.of('fl'), 0x8d, PDFName.of('sfthyphen')]);
  const encoding = ctx.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: differences });
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: encoding }));
  const lines = wrap(text);
  const perPage = 44;
  for (let i = 0; i < lines.length; i += perPage) {
    const page = doc.addPage([612, 792]);
    page.node.setFontDictionary(PDFName.of('F1'), font);
    const ops: PDFOperator[] = [
      PDFOperator.of(Ops.BeginText),
      PDFOperator.of(Ops.SetFontAndSize, [PDFName.of('F1'), PDFNumber.of(10)]),
      PDFOperator.of(Ops.SetTextLineHeight, [PDFNumber.of(15)]),
      PDFOperator.of(Ops.MoveText, [PDFNumber.of(56), PDFNumber.of(740)]),
    ];
    for (const line of lines.slice(i, i + perPage)) {
      ops.push(PDFOperator.of(Ops.ShowText, [PDFHexString.of(encode(line))]));
      ops.push(PDFOperator.of(Ops.NextLine));
    }
    ops.push(PDFOperator.of(Ops.EndText));
    page.pushOperators(...ops);
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
