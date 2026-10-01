// bin/lib/export/docx-writer.ts — the built-in .docx writer (EXP-08, D-21-10).
//
// Used when pandoc is not on PATH (and as the fallback when a pandoc run
// fails): a requested docx is always a docx, never a Markdown file (D-21-02).
// It writes WordprocessingML with jszip from the document model
// (document.ts): Word's built-in style IDs — Normal, Heading1–6 (the paper's
// `# title` is Heading 1 and its `## sections` Heading 2, D-21-13), Quote,
// SourceCode, FootnoteText, FootnoteReference, Hyperlink, Bibliography (a
// hanging indent) — emphasis, strong, strikeout, superscript, subscript, small
// caps and links as run properties, lists through numbering.xml (each list
// numbered afresh, nested levels indented), real footnotes in
// word/footnotes.xml, pipe tables as tables, and the bibliography under its
// heading.
//
// Zero trace by construction (D-21-08): docProps/core.xml holds empty title
// and creator and epoch dates; docProps/app.xml has no Application or
// AppVersion (no property at all); there is no custom.xml, no header or
// footer, no generator comment, and every zip entry carries the epoch date.
// The export's scanner (zero-trace.ts) checks it like any other file.

import JSZip from 'jszip';
import type { Block, Inline, ListStyle } from './markdown.js';
import type { ExportDocument } from './document.js';

/** The zip entries' date: the ZIP (DOS) epoch, 1980-01-01 — no authoring time in the archive. */
const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1));
const EPOCH_W3CDTF = '1970-01-01T00:00:00Z';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** XML text: the five specials escaped, characters XML 1.0 forbids dropped. */
export function xmlEscape(s: string): string {
  return s
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Run properties of one inline run. */
interface RunProps {
  readonly italic?: boolean;
  readonly bold?: boolean;
  readonly strike?: boolean;
  readonly sup?: boolean;
  readonly sub?: boolean;
  readonly smallCaps?: boolean;
  readonly code?: boolean;
  readonly link?: boolean;
}

function rPr(p: RunProps): string {
  const parts: string[] = [];
  if (p.link) parts.push('<w:rStyle w:val="Hyperlink"/>');
  if (p.code) parts.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>');
  if (p.bold) parts.push('<w:b/><w:bCs/>');
  if (p.italic) parts.push('<w:i/><w:iCs/>');
  if (p.strike) parts.push('<w:strike/>');
  if (p.smallCaps) parts.push('<w:smallCaps/>');
  if (p.sup) parts.push('<w:vertAlign w:val="superscript"/>');
  else if (p.sub) parts.push('<w:vertAlign w:val="subscript"/>');
  return parts.length > 0 ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

/** One text run (tabs and newlines as their elements). */
function textRun(text: string, p: RunProps): string {
  const pieces = text.split(/(\t|\n)/);
  const body = pieces
    .map((piece) => (piece === '\t' ? '<w:tab/>' : piece === '\n' ? '<w:br/>' : piece === '' ? '' : `<w:t xml:space="preserve">${xmlEscape(piece)}</w:t>`))
    .join('');
  return `<w:r>${rPr(p)}${body}</w:r>`;
}

/** The writer's state: hyperlink relationships, list numbering instances, footnotes. */
class DocxState {
  readonly links: string[] = [];
  readonly nums: Array<{ abstract: number; start: number }> = [];

  linkId(href: string): string {
    let i = this.links.indexOf(href);
    if (i === -1) {
      this.links.push(href);
      i = this.links.length - 1;
    }
    return `rIdL${i + 1}`;
  }

  numId(style: ListStyle | 'bullet', start: number): number {
    const abstract = ['bullet', 'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'].indexOf(style) + 1;
    this.nums.push({ abstract, start });
    return this.nums.length;
  }
}

function inlinesXml(nodes: readonly Inline[], st: DocxState, p: RunProps = {}): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return textRun(n.text, p);
        case 'code':
          return textRun(n.text, { ...p, code: true });
        case 'break':
          return '<w:r><w:br/></w:r>';
        case 'note':
          return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${n.n}"/></w:r>`;
        case 'emph':
          return inlinesXml(n.children, st, { ...p, italic: !p.italic });
        case 'strong':
          return inlinesXml(n.children, st, { ...p, bold: true });
        case 'strike':
          return inlinesXml(n.children, st, { ...p, strike: true });
        case 'sup':
          return inlinesXml(n.children, st, { ...p, sup: true });
        case 'sub':
          return inlinesXml(n.children, st, { ...p, sub: true });
        case 'smallcaps':
          return inlinesXml(n.children, st, { ...p, smallCaps: true });
        case 'link':
          if (!/^[a-z][a-z0-9+.-]*:/i.test(n.href)) return inlinesXml(n.children, st, p);
          return `<w:hyperlink r:id="${st.linkId(n.href)}">${inlinesXml(n.children, st, { ...p, link: true })}</w:hyperlink>`;
        default:
          return '';
      }
    })
    .join('');
}

function para(style: string | null, content: string, extraPPr = ''): string {
  const pPr = style !== null || extraPPr !== '' ? `<w:pPr>${style !== null ? `<w:pStyle w:val="${style}"/>` : ''}${extraPPr}</w:pPr>` : '';
  return `<w:p>${pPr}${content}</w:p>`;
}

/** Blocks as body XML; `quoteDepth` and `list` carry the container context. */
function blocksXml(blocks: readonly Block[], st: DocxState, ctx: { quoteDepth: number; listLevel: number; numPr: string | null; indent: number }): string {
  const out: string[] = [];
  for (const b of blocks) {
    const indentPPr = ctx.indent > 0 && ctx.numPr === null ? `<w:ind w:left="${ctx.indent}"/>` : '';
    const style = ctx.quoteDepth > 0 ? 'Quote' : null;
    const quoteInd = ctx.quoteDepth > 1 ? `<w:ind w:left="${720 * ctx.quoteDepth}" w:right="720"/>` : '';
    switch (b.t) {
      case 'heading':
        out.push(para(`Heading${Math.min(b.level, 6)}`, inlinesXml(b.children, st)));
        break;
      case 'para':
      case 'plain': {
        const numPr = ctx.numPr ?? '';
        out.push(para(ctx.numPr !== null ? 'ListParagraph' : style, inlinesXml(b.children, st), numPr + (numPr === '' ? quoteInd || indentPPr : '')));
        ctx.numPr = null;
        break;
      }
      case 'quote':
        out.push(blocksXml(b.blocks, st, { ...ctx, quoteDepth: ctx.quoteDepth + 1, numPr: null }));
        break;
      case 'bullets':
      case 'ordered': {
        const id = b.t === 'bullets' ? st.numId('bullet', 1) : st.numId(b.style, b.start);
        const level = ctx.listLevel;
        for (const item of b.items) {
          const itemCtx = { quoteDepth: ctx.quoteDepth, listLevel: level + 1, numPr: `<w:numPr><w:ilvl w:val="${Math.min(level, 8)}"/><w:numId w:val="${id}"/></w:numPr>` as string | null, indent: 720 * (level + 1) };
          if (item.length === 0 || (item[0]?.t !== 'para' && item[0]?.t !== 'plain')) {
            out.push(para('ListParagraph', '', itemCtx.numPr as string));
            itemCtx.numPr = null;
          }
          out.push(blocksXml(item, st, itemCtx));
        }
        break;
      }
      case 'code':
        out.push(para('SourceCode', textRun(b.text, { code: true }), indentPPr));
        break;
      case 'hr':
        out.push(para(null, '', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>'));
        break;
      case 'table': {
        const cols = b.head.length;
        const width = Math.floor(9360 / Math.max(cols, 1));
        const jc = (a: string): string => (a === 'center' ? '<w:jc w:val="center"/>' : a === 'right' ? '<w:jc w:val="right"/>' : '');
        const cell = (inl: readonly Inline[], c: number, header: boolean): string =>
          `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${jc(b.aligns[c] ?? 'default')}</w:pPr>${inlinesXml(inl, st, header ? { bold: true } : {})}</w:p></w:tc>`;
        const rows = [
          `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.head.map((h, c) => cell(h, c, true)).join('')}</w:tr>`,
          ...b.rows.map((r) => `<w:tr>${r.map((x, c) => cell(x, c, false)).join('')}</w:tr>`),
        ];
        out.push(
          `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${b.head.map(() => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`,
          para(null, ''),
        );
        break;
      }
    }
  }
  return out.join('');
}

const LEVEL_TEXT_BULLETS = ['•', '◦', '▪'];
const ORDERED_FORMATS: ReadonlyArray<[number, string]> = [
  [2, 'decimal'],
  [3, 'lowerLetter'],
  [4, 'upperLetter'],
  [5, 'lowerRoman'],
  [6, 'upperRoman'],
];

function numberingXml(nums: ReadonlyArray<{ abstract: number; start: number }>): string {
  const levels = (fmt: string, bullet: boolean): string =>
    Array.from({ length: 9 }, (_v, l) => {
      const ind = `<w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr>`;
      if (bullet) {
        return `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${LEVEL_TEXT_BULLETS[l % 3]}"/><w:lvlJc w:val="left"/>${ind}</w:lvl>`;
      }
      return `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${l === 0 ? fmt : ['decimal', 'lowerLetter', 'lowerRoman'][l % 3]}"/><w:lvlText w:val="%${l + 1}."/><w:lvlJc w:val="left"/>${ind}</w:lvl>`;
    }).join('');
  const abstracts = [
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels('bullet', true)}</w:abstractNum>`,
    ...ORDERED_FORMATS.map(([id, fmt]) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${levels(fmt, false)}</w:abstractNum>`),
  ];
  const instances = nums.map(
    (n, i) =>
      `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${n.abstract}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`,
  );
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${NS_W}">${abstracts.join('')}${instances.join('')}</w:numbering>`;
}

const STYLES_XML = (): string => {
  const heading = (n: number, size: number): string =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 240 : 200}" w:after="120"/>${n === 1 ? '<w:jc w:val="center"/>' : ''}<w:outlineLvl w:val="${n - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="${NS_W}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>' +
    '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading(1, 32) + heading(2, 28) + heading(3, 26) + heading(4, 24) + heading(5, 24) + heading(6, 24) +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/>' +
    '<w:pPr><w:ind w:left="720" w:right="720"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/>' +
    '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Bibliography"><w:name w:val="Bibliography"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="37"/>' +
    '<w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>'
  );
};

/** The .docx bytes of a document. Deterministic: the same document gives the same bytes. */
export async function writeDocx(doc: ExportDocument): Promise<Buffer> {
  const st = new DocxState();
  let body = blocksXml(doc.blocks, st, { quoteDepth: 0, listLevel: 0, numPr: null, indent: 0 });
  if (doc.bibliography !== null) {
    body += para('Heading2', textRun(doc.bibliography.title, {}));
    for (const e of doc.bibliography.entries) {
      const label = e.label !== null ? `${inlinesXml(e.label, st)}${textRun(' ', {})}` : '';
      body += para('Bibliography', label + inlinesXml(e.body, st));
    }
  }
  const sectPr = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${body}${sectPr}</w:body></w:document>`;

  const hasNotes = doc.notes.length > 0;
  // A footnote's links are relationships of the footnotes part (its own .rels).
  const noteSt = new DocxState();
  const footnotesXml = hasNotes
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="${NS_W}" xmlns:r="${NS_R}">` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
      doc.notes
        .map(
          (n, i) =>
            `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${textRun(' ', {})}${inlinesXml(n, noteSt)}</w:p></w:footnote>`,
        )
        .join('') +
      '</w:footnotes>'
    : null;
  const hasLists = st.nums.length > 0;

  const docRels = [
    `<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rIdSettings" Type="${REL}/settings" Target="settings.xml"/>`,
    ...(hasLists ? [`<Relationship Id="rIdNumbering" Type="${REL}/numbering" Target="numbering.xml"/>`] : []),
    ...(footnotesXml !== null ? [`<Relationship Id="rIdFootnotes" Type="${REL}/footnotes" Target="footnotes.xml"/>`] : []),
    ...st.links.map((href, i) => `<Relationship Id="rIdL${i + 1}" Type="${REL}/hyperlink" Target="${xmlEscape(href)}" TargetMode="External"/>`),
  ];
  const settingsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="${NS_W}">` +
    (hasNotes ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : '') +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    (hasLists ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : '') +
    (footnotesXml !== null ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : '') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';
  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>` +
    '</Relationships>';
  const coreXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title></dc:title><dc:creator></dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${EPOCH_W3CDTF}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${EPOCH_W3CDTF}</dcterms:modified></cp:coreProperties>`;
  const appXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>';

  const zip = new JSZip();
  const add = (name: string, data: string): void => {
    zip.file(name, data, { date: ZIP_EPOCH, createFolders: false });
  };
  add('[Content_Types].xml', contentTypes);
  add('_rels/.rels', rootRels);
  add('docProps/core.xml', coreXml);
  add('docProps/app.xml', appXml);
  add('word/document.xml', documentXml);
  add('word/styles.xml', STYLES_XML());
  add('word/settings.xml', settingsXml);
  if (hasLists) add('word/numbering.xml', numberingXml(st.nums));
  if (footnotesXml !== null) add('word/footnotes.xml', footnotesXml);
  if (footnotesXml !== null && noteSt.links.length > 0) {
    add(
      'word/_rels/footnotes.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">${noteSt.links
        .map((href, i) => `<Relationship Id="rIdL${i + 1}" Type="${REL}/hyperlink" Target="${xmlEscape(href)}" TargetMode="External"/>`)
        .join('')}</Relationships>`,
    );
  }
  add('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">${docRels.join('')}</Relationships>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
