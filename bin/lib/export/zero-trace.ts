// bin/lib/export/zero-trace.ts — zero trace, scrubbed and then CHECKED
// (DONE-07, EXP-06, EXP-07, D-21-08).
//
// Two halves:
//
// 1. The scrubs, the mandatory last step of a pandoc docx or PDF:
//    - zeroTracePatch(docx) blanks the full identifying set of
//      docProps/core.xml (creator, title, subject, description, keywords,
//      category, content status, last-modified-by; epoch dates) and of
//      docProps/app.xml (Application, AppVersion, Company, Manager, Template),
//      removes docProps/custom.xml (pandoc's home for the absolute
//      bibliography / CSL paths) with its relationship and content-type
//      override, and removes XML comments from — and sweeps the literal
//      "pensmith" out of — every non-binary structural part, never the
//      author's content parts (audit #18: a paper may say "pensmith") nor an
//      external relationship's target (a hyperlink the body or a reference
//      shows — rewriting it would point the link somewhere its text does not).
//    - zeroTracePdf(pdf) empties /Info (and deletes every key that is not a
//      standard one — pdfTeX's /PTEX.Fullbanner and the like), epochs the
//      dates, and deletes the XMP stream OBJECT (pdf-lib serialises every
//      indirect object, so removing only the catalog reference would leave it;
//      HIGH-C2-1). No length-altering byte edit of a serialised PDF, ever.
//
// 2. The scanner, run on EVERY file an export writes (the document, the
//    exported bib and RIS), after writing and after every scrub:
//    - metadata (docx docProps and every structural part, PDF /Info and XMP,
//      the LaTeX preamble, the text of a bib outside its entries) may hold no
//      absolute path, no home folder, no OS user name as a path segment or a
//      field value, no `.paper`, `citation-styles`, `.csl` or `.bib` path, no
//      `.claude/plugins`, no home-folder path of any user, no file:// URL,
//      no offline / stub / dry-run marker and no "pensmith"; docx Application / AppVersion and PDF Producer / Creator
//      must be empty; docx creator / last-modified-by and PDF Author must be
//      empty; pdfTeX keys (/PTEX.*) and an XMP packet are findings; a
//      docProps/custom.xml part is a finding;
//    - author content (the body, notes, the rendered references, the bib and
//      RIS entries, a docx's external link targets) is checked only for THIS
//      machine's paths — the paper's own folder, the home folder, a home-folder
//      path naming the OS user (/Users/<user>/, /home/<user>/,
//      C:\Users\<user>\), `.paper/` and `.claude/plugins` paths — outside
//      http(s) URLs (a source's web address may hold /home/x/; review round 1),
//      and for the markers (an untrusted-data fence marker included) and a
//      generator comment; NEVER for a bare word (audit #18) nor for someone
//      else's example path (a systems paper may print /home/alice/data/);
//    - media (word/media/*, PDF image streams) are flagged for EXIF, XMP and
//      PNG tEXt / iTXt / zTXt chunks (stripping them on embed is BRDTH-02).
//    exporter.ts deletes every file the export wrote on any finding, or when a
//    scrub throws, and throws ZeroTraceError (EXIT_ERROR) — no unscrubbed file
//    stays in export/ and there is no Markdown fallback (D-21-08).

import * as fsp from 'node:fs/promises';
import os from 'node:os';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, type PDFObject } from 'pdf-lib';
import { atomicWriteFile } from '../atomic-write.js';
import { EXIT_ERROR, PensmithError } from '../exit-codes.js';
import { OFFLINE_MARKER_PREFIX } from '../http-mock.js';
import { userHomeDir } from '../paths.js';
import { STUB_DRAFT_MARKER } from '../verify/gate.js';
import { fenceMarkerCount } from '../untrusted-fence.js';

/** The zip entries' date: the ZIP (DOS) epoch, 1980-01-01 — no authoring time in the archive. */
const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1));
const EPOCH_W3CDTF = '1970-01-01T00:00:00Z';

// ---------------------------------------------------------------------------
// The docx scrub
// ---------------------------------------------------------------------------

/** The identifying fields blanked in docProps/core.xml (HIGH-2: the full set). */
const CORE_BLANK_TAGS = ['dc:creator', 'dc:title', 'dc:subject', 'dc:description', 'cp:keywords', 'cp:category', 'cp:contentStatus', 'cp:lastModifiedBy'];

/** The extended-property fields blanked in docProps/app.xml (Application and AppVersion name the writer). */
const APP_BLANK_TAGS = ['Application', 'AppVersion', 'Company', 'Manager', 'Template'];

/** The OOXML custom-properties part (pandoc's home for non-standard metadata fields). */
const CUSTOM_PROPS_PART = 'docProps/custom.xml';

/** The docx parts that hold the author's own content (never swept, checked only for paths and markers). */
const AUTHOR_CONTENT = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Blank `<ns:tag …>…</ns:tag>` (and the self-closing form) to `<ns:tag></ns:tag>`. */
function blankXmlTag(xml: string, tag: string): string {
  const esc = escapeRe(tag);
  const paired = new RegExp(`<${esc}(\\s[^>]*)?>[\\s\\S]*?<\\/${esc}>`, 'g');
  const selfClosing = new RegExp(`<${esc}(\\s[^>]*)?\\/>`, 'g');
  return xml.replace(paired, `<${tag}></${tag}>`).replace(selfClosing, `<${tag}></${tag}>`);
}

/** Set `<dcterms:created>` / `<dcterms:modified>` to the epoch, keeping its attributes. */
function epochDctermsTag(xml: string, tag: string): string {
  const esc = escapeRe(tag);
  const paired = new RegExp(`<${esc}((?:\\s[^>]*)?)>[\\s\\S]*?<\\/${esc}>`, 'g');
  const selfClosing = new RegExp(`<${esc}((?:\\s[^>]*)?)\\/>`, 'g');
  return xml
    .replace(paired, (_m, attrs: string) => `<${tag}${attrs}>${EPOCH_W3CDTF}</${tag}>`)
    .replace(selfClosing, (_m, attrs: string) => `<${tag}${attrs}>${EPOCH_W3CDTF}</${tag}>`);
}

/** A binary docx part (media, embeddings, fonts, thumbnails) — never string-edited. */
function isBinaryDocxEntry(name: string, text: string): boolean {
  const lower = name.toLowerCase();
  if (
    lower.startsWith('word/media/') ||
    lower.startsWith('word/embeddings/') ||
    lower.startsWith('word/fonts/') ||
    lower.startsWith('docprops/thumbnail') ||
    /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|bin|ttf|otf|woff2?|eot|odttf)$/.test(lower)
  ) {
    return true;
  }
  return text.includes('\x00');
}

/** An external relationship element (a hyperlink target: author content). */
const EXTERNAL_RELATIONSHIP_RE = /<Relationship\b[^>]*\bTargetMode="External"[^>]*>/g;

/** Sweep "pensmith" out of a structural part, leaving every external relationship element as written. */
function sweepStructural(xml: string): string {
  let out = '';
  let at = 0;
  for (const m of xml.matchAll(EXTERNAL_RELATIONSHIP_RE)) {
    out += xml.slice(at, m.index).replace(/pensmith/gi, '') + m[0];
    at = m.index + m[0].length;
  }
  return out + xml.slice(at).replace(/pensmith/gi, '');
}

/**
 * zeroTracePatch — the MANDATORY last step of every pandoc .docx (DONE-07):
 * see the module header. Idempotent; a missing core.xml / app.xml is skipped.
 */
export async function zeroTracePatch(docxPath: string): Promise<void> {
  const zip = await JSZip.loadAsync(await fsp.readFile(docxPath));
  const coreEntry = zip.file('docProps/core.xml');
  if (coreEntry) {
    let core = await coreEntry.async('string');
    for (const tag of CORE_BLANK_TAGS) core = blankXmlTag(core, tag);
    core = epochDctermsTag(core, 'dcterms:created');
    core = epochDctermsTag(core, 'dcterms:modified');
    zip.file('docProps/core.xml', core, { date: ZIP_EPOCH, createFolders: false });
  }
  const appEntry = zip.file('docProps/app.xml');
  if (appEntry) {
    let app = await appEntry.async('string');
    for (const tag of APP_BLANK_TAGS) app = blankXmlTag(app, tag);
    zip.file('docProps/app.xml', app, { date: ZIP_EPOCH, createFolders: false });
  }
  if (zip.file(CUSTOM_PROPS_PART)) {
    zip.remove(CUSTOM_PROPS_PART);
    const ctEntry = zip.file('[Content_Types].xml');
    if (ctEntry) {
      const ct = await ctEntry.async('string');
      zip.file('[Content_Types].xml', ct.replace(/<Override\b[^>]*\bPartName="\/docProps\/custom\.xml"[^>]*\/>/g, ''), { date: ZIP_EPOCH, createFolders: false });
    }
    const relsEntry = zip.file('_rels/.rels');
    if (relsEntry) {
      const rels = await relsEntry.async('string');
      zip.file('_rels/.rels', rels.replace(/<Relationship\b[^>]*\bTarget="\/?docProps\/custom\.xml"[^>]*\/>/g, ''), { date: ZIP_EPOCH, createFolders: false });
    }
  }
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || AUTHOR_CONTENT.test(name)) continue;
    let text: string;
    try {
      text = await file.async('string');
    } catch {
      continue;
    }
    if (isBinaryDocxEntry(name, text)) continue;
    // Comments in a structural part are tool notes, never content: removed;
    // then the literal 'pensmith' is swept from what is left — except an
    // external relationship (a hyperlink's target is the author's content).
    const swept = sweepStructural(text.replace(/<!--[\s\S]*?-->/g, ''));
    if (swept !== text) zip.file(name, swept, { date: ZIP_EPOCH, createFolders: false });
  }
  // The package is rebuilt from its parts alone, in their order: a folder
  // entry is not an OPC part (pandoc, Word and the built-in writer write
  // none, but JSZip adds them when a part is rewritten), and every entry
  // carries the epoch date (no authoring time in the archive).
  const clean = new JSZip();
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    clean.file(name, await file.async('nodebuffer'), { date: ZIP_EPOCH, binary: true, createFolders: false });
  }
  await atomicWriteFile(docxPath, await clean.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

// ---------------------------------------------------------------------------
// The PDF scrub
// ---------------------------------------------------------------------------

/** The document-information keys the PDF standard defines (ISO 32000-1 §14.3.3). */
const STANDARD_INFO_KEYS = new Set(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']);

/** The /Info dictionary of a loaded PDF, or null. */
function infoDict(pdf: PDFDocument): PDFDict | null {
  const ref = pdf.context.trailerInfo.Info;
  if (ref === undefined) return null;
  const obj = pdf.context.lookup(ref);
  return obj instanceof PDFDict ? obj : null;
}

/**
 * zeroTracePdf — the MANDATORY last step of every pandoc .pdf (DONE-07,
 * HIGH-C2-1): see the module header. Idempotent; a residual "pensmith" after
 * the structural strip is an error to fix, never a byte edit.
 */
export async function zeroTracePdf(pdfPath: string): Promise<void> {
  const pdf = await PDFDocument.load(await fsp.readFile(pdfPath), { updateMetadata: false });
  pdf.setTitle('');
  pdf.setAuthor('');
  pdf.setSubject('');
  pdf.setKeywords([]);
  pdf.setProducer('');
  pdf.setCreator('');
  try {
    pdf.setCreationDate(new Date(0));
    pdf.setModificationDate(new Date(0));
  } catch {
    /* dates are not trace */
  }
  // pdfTeX's /PTEX.Fullbanner and every other non-standard /Info key.
  const info = infoDict(pdf);
  if (info !== null) {
    for (const key of info.keys()) {
      if (!STANDARD_INFO_KEYS.has(key.decodeText())) info.delete(key);
    }
  }
  try {
    const metaRef = pdf.catalog.get(PDFName.of('Metadata'));
    if (metaRef) {
      pdf.context.delete(metaRef as Parameters<typeof pdf.context.delete>[0]);
      pdf.catalog.delete(PDFName.of('Metadata'));
    }
  } catch {
    /* no XMP */
  }
  const out = Buffer.from(await pdf.save({ updateFieldAppearances: false }));
  if (out.toString('latin1').toLowerCase().includes('pensmith')) {
    throw new Error(`zeroTracePdf: residual 'pensmith' after the structural scrub of ${pdfPath} — the /Info or XMP strip is incomplete`);
  }
  await atomicWriteFile(pdfPath, out);
}

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

/** What the scanner knows about the machine the export ran on. */
export interface ZeroTraceContext {
  /** The paper's project root (absolute). */
  readonly paperRoot: string;
  /** The user's home folder (default: paths.ts userHomeDir()). */
  readonly home?: string;
  /** The OS user name (default: os.userInfo().username). */
  readonly username?: string;
}

/** One finding: the file, where in it, and what. */
export interface ZeroTraceFinding {
  readonly file: string;
  readonly where: string;
  readonly finding: string;
}

/**
 * A written export that failed the zero-trace scan, or whose scrub failed
 * (D-21-08): every file the export wrote was deleted. EXIT_ERROR.
 */
export class ZeroTraceError extends PensmithError {
  readonly findings: readonly ZeroTraceFinding[];

  constructor(findings: readonly ZeroTraceFinding[], deleted: readonly string[]) {
    const first = findings[0];
    const more = findings.length > 1 ? ` (and ${findings.length - 1} more)` : '';
    super(
      `export refused: ${first !== undefined ? `${first.file} (${first.where}) ${first.finding}` : 'the zero-trace check failed'}${more} — ` +
        `nothing was exported (${deleted.length} file${deleted.length === 1 ? '' : 's'} removed)`,
      EXIT_ERROR,
    );
    this.name = 'ZeroTraceError';
    this.findings = findings;
  }
}

interface Rules {
  readonly paperRoots: readonly string[];
  readonly home: string | null;
  readonly username: string | null;
}

function rulesFor(ctx: ZeroTraceContext): Rules {
  const root = ctx.paperRoot.replace(/[\\/]+$/, '');
  const variants = new Set([root, root.replace(/\\/g, '/'), root.replace(/\//g, '\\')].filter((r) => r.length > 1));
  let home: string | null = ctx.home ?? null;
  if (home === null) {
    try {
      home = userHomeDir();
    } catch {
      home = null;
    }
  }
  if (home !== null && home.replace(/[\\/]+$/, '').length <= 1) home = null;
  let username: string | null = ctx.username ?? null;
  if (username === null) {
    try {
      username = os.userInfo().username;
    } catch {
      username = null;
    }
  }
  if (username !== null && username.trim().length < 2) username = null;
  return { paperRoots: [...variants], home: home?.replace(/[\\/]+$/, '') ?? null, username };
}

const MARKERS: ReadonlyArray<[RegExp, string]> = [
  [new RegExp(`(^|\\n)\\s*${escapeRe(OFFLINE_MARKER_PREFIX)}`), 'holds the offline marker line'],
  [new RegExp(escapeRe(STUB_DRAFT_MARKER)), 'holds the stub-draft marker'],
  [/LLM STUBBED \(/, 'holds the LLM-stubbed banner'],
  [/<!--\s*(?:generated\b|pensmith)/i, 'holds a generator comment'],
  [/(^|\n)\s*%[^\n]*\b(?:generated by|pensmith)\b/i, 'holds a generator comment'],
];

const HOME_PATH_RE = /(?:\/Users\/[^/\s"'<>]+\/|\/home\/[^/\s"'<>]+\/|[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>]+[\\/])/;

/** A web address: its path is a site's, never this machine's (review round 1). */
const WEB_URL_RE = /https?:\/\/[^\s"'<>]*/gi;

/**
 * Author-content findings: THIS machine's paths (outside web addresses) and
 * the markers only — never a bare word (audit #18), never another user's
 * example path (see the header).
 */
function authorFindings(text: string, r: Rules): string[] {
  const out: string[] = [];
  const local = text.replace(WEB_URL_RE, ' ');
  for (const root of r.paperRoots) if (local.includes(root)) out.push(`holds the paper's folder path (${root})`);
  if (r.home !== null && (local.includes(`${r.home}/`) || local.includes(`${r.home}\\`))) out.push('holds a path in the home folder');
  if (r.username !== null) {
    const u = escapeRe(r.username);
    const own = new RegExp(`(?:\\/Users\\/|\\/home\\/|[A-Za-z]:[\\\\/]Users[\\\\/])${u}(?:[\\\\/]|$)`, 'im').exec(local);
    if (own !== null) out.push(`holds a home-folder path of the OS user (${own[0]})`);
  }
  if (/(?:^|[\\/\s"'(])\.paper(?:-dry-run)?[\\/]/.test(local)) out.push('holds a .paper path');
  if (/\.claude[\\/]plugins/i.test(local)) out.push('holds a .claude/plugins path');
  for (const [re, what] of MARKERS) if (re.test(text)) out.push(what);
  if (fenceMarkerCount(text) > 0) out.push('holds an untrusted-data fence marker (a model artifact)');
  return out;
}

/** Metadata findings: everything authorFindings checks, plus any absolute path, any home-folder path, file:// URLs, the tool names and the user name. */
function metadataFindings(text: string, r: Rules): string[] {
  const out = authorFindings(text, r);
  // http(s) URLs (namespaces, schemas) are not local paths.
  const local = text.replace(WEB_URL_RE, '');
  const home = HOME_PATH_RE.exec(local);
  if (home !== null) out.push(`holds a home-folder path (${home[0]})`);
  if (/file:\/\//i.test(local)) out.push('holds a file:// URL');
  const abs = /(?<![\w:/.])\/(?:[^\s/"'<>{}()]+\/)+[^\s/"'<>{}()]*|(?<![\w])[A-Za-z]:[\\/][^\s"'<>]*|\\\\[A-Za-z0-9._-]+\\[^\s"'<>]+/.exec(local);
  if (abs !== null) out.push(`holds an absolute path (${abs[0]})`);
  if (/pensmith/i.test(text)) out.push('names pensmith');
  if (/(?:^|[^\w-])\.paper(?![\w-])/.test(text)) out.push('names the .paper folder');
  if (/citation-styles/i.test(text)) out.push('names citation-styles');
  if (/[\w-]\.csl\b/i.test(text)) out.push('names a .csl file');
  if (/[\w-]\.bib\b/i.test(text)) out.push('names a .bib file');
  if (r.username !== null) {
    const u = escapeRe(r.username);
    if (new RegExp(`(?:^|[\\\\/])${u}(?:[\\\\/]|$)`, 'm').test(local) || new RegExp(`>\\s*${u}\\s*<|=\\s*"${u}"|\\(${u}\\)`).test(text)) {
      out.push('holds the OS user name');
    }
  }
  return [...new Set(out)];
}

/** Media findings: EXIF, XMP and PNG text chunks. */
function mediaFindings(bytes: Uint8Array): string[] {
  const out: string[] = [];
  const buf = Buffer.from(bytes);
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) {
    let at = 8;
    while (at + 8 <= buf.length) {
      const len = buf.readUInt32BE(at);
      const type = buf.toString('latin1', at + 4, at + 8);
      if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') out.push(`embeds an image with a PNG ${type} chunk`);
      if (type === 'eXIf') out.push('embeds an image with EXIF data');
      at += 12 + len;
      if (type === 'IEND') break;
    }
  }
  const latin = buf.toString('latin1');
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && /\xff\xe1..Exif\0/s.test(latin)) out.push('embeds an image with EXIF data');
  if (latin.includes('<x:xmpmeta') || latin.includes('http://ns.adobe.com/xap/1.0/')) out.push('embeds XMP metadata');
  return [...new Set(out)];
}

/**
 * XML with the parts that are not data removed: namespace and schema URIs,
 * relationship types, package-internal part names, and every relationship
 * target — an internal one names a part, an external one is a hyperlink the
 * body or a reference shows (author content, checked by externalTargets).
 */
function xmlData(xml: string): string {
  return xml
    .replace(/\sxmlns(?::[\w-]+)?="[^"]*"/g, '')
    .replace(/\s(?:xsi:schemaLocation|mc:Ignorable|Type|ContentType)="[^"]*"/g, '')
    .replace(/\sPartName="\/[^"]*"/g, '')
    .replace(/<Relationship\b([^>]*?)\sTarget="[^"]*"/g, '<Relationship$1')
    .replace(/<\?xml[^>]*\?>/g, '');
}

/** The targets of a part's external relationships (hyperlinks), one per line, XML entities decoded. */
function externalTargets(xml: string): string {
  const out: string[] = [];
  for (const m of xml.matchAll(EXTERNAL_RELATIONSHIP_RE)) {
    const t = /\sTarget="([^"]*)"/.exec(m[0])?.[1];
    if (t !== undefined) out.push(t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  return out.join('\n');
}

/** The text content of one XML element (first match), or null. */
function xmlElementText(xml: string, tag: string): string | null {
  const m = new RegExp(`<${escapeRe(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(tag)}>`).exec(xml);
  return m === null ? null : (m[1] as string).trim();
}

async function scanDocx(file: string, bytes: Buffer, r: Rules): Promise<ZeroTraceFinding[]> {
  const out: ZeroTraceFinding[] = [];
  const zip = await JSZip.loadAsync(bytes);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const data = await entry.async('uint8array');
    const text = Buffer.from(data).toString('utf8');
    const add = (finding: string): void => {
      out.push({ file, where: name, finding });
    };
    if (isBinaryDocxEntry(name, text)) {
      for (const f of mediaFindings(data)) add(f);
      continue;
    }
    if (name === CUSTOM_PROPS_PART) add('is a custom-properties part (tool metadata)');
    if (AUTHOR_CONTENT.test(name)) {
      for (const f of authorFindings(text.replace(/<[^>]*>/g, ''), r)) add(f);
      for (const f of authorFindings(text.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, '').replace(/https?:\/\/[^\s"'<>]*/g, ''), r)) add(f);
      continue;
    }
    if (name === 'docProps/app.xml') {
      for (const tag of ['Application', 'AppVersion']) {
        const v = xmlElementText(text, tag);
        if (v !== null && v !== '') add(`sets ${tag} ("${v.slice(0, 60)}") — it must be empty`);
      }
    }
    if (name === 'docProps/core.xml') {
      for (const tag of ['dc:creator', 'cp:lastModifiedBy']) {
        const v = xmlElementText(text, tag);
        if (v !== null && v !== '') add(`sets ${tag} ("${v.slice(0, 60)}") — it must be empty`);
      }
    }
    for (const f of authorFindings(externalTargets(text), r)) add(f);
    for (const f of metadataFindings(xmlData(text), r)) add(f);
  }
  return dedupe(out);
}

function pdfString(obj: PDFObject | undefined): string | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return null;
}

/** Every string in a PDF object (dicts and arrays walked). */
function pdfStrings(obj: PDFObject | undefined, out: string[], depth = 0): void {
  if (obj === undefined || depth > 6) return;
  const s = pdfString(obj);
  if (s !== null) {
    out.push(s);
    return;
  }
  if (obj instanceof PDFDict) for (const [, v] of obj.entries()) pdfStrings(v, out, depth + 1);
  else if (obj instanceof PDFArray) for (const v of obj.asArray()) pdfStrings(v, out, depth + 1);
}

async function scanPdf(file: string, bytes: Buffer, r: Rules): Promise<ZeroTraceFinding[]> {
  const out: ZeroTraceFinding[] = [];
  const add = (where: string, finding: string): void => {
    out.push({ file, where, finding });
  };
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const info = infoDict(pdf);
  if (info !== null) {
    for (const [key, value] of info.entries()) {
      const name = key.decodeText();
      if (!STANDARD_INFO_KEYS.has(name)) add('/Info', `has the non-standard key /${name}${/^PTEX/.test(name) ? ' (a TeX engine banner)' : ''}`);
      const v = pdfString(value);
      if (v === null) continue;
      if ((name === 'Producer' || name === 'Creator' || name === 'Author') && v.trim() !== '') add('/Info', `sets /${name} ("${v.slice(0, 60)}") — it must be empty`);
      for (const f of metadataFindings(v, r)) add(`/Info /${name}`, f);
    }
  }
  if (pdf.catalog.get(PDFName.of('Metadata')) !== undefined) add('catalog', 'carries an XMP metadata stream');
  for (const [ref, obj] of pdf.context.enumerateIndirectObjects()) {
    const where = `object ${ref.objectNumber}`;
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict !== null) {
      for (const key of dict.keys()) if (/^PTEX/.test(key.decodeText())) add(where, `has the key /${key.decodeText()} (a TeX engine record)`);
      const strings: string[] = [];
      pdfStrings(dict, strings);
      for (const s of strings) for (const f of authorFindings(s, r)) add(where, f);
    }
    if (obj instanceof PDFRawStream) {
      const raw = obj.getContents();
      const filter = obj.dict.get(PDFName.of('Filter'));
      const subtype = obj.dict.get(PDFName.of('Subtype'));
      const type = obj.dict.get(PDFName.of('Type'));
      if (type instanceof PDFName && type.decodeText() === 'Metadata') {
        add(where, 'is an XMP metadata stream');
        continue;
      }
      if (subtype instanceof PDFName && subtype.decodeText() === 'Image') {
        for (const f of mediaFindings(raw)) add(where, f);
        continue;
      }
      // An embedded font program is binary glyph data, not text.
      if (obj.dict.has(PDFName.of('Length1')) || obj.dict.has(PDFName.of('Length2')) || (subtype instanceof PDFName && /^(Type1C|CIDFontType0C|OpenType)$/.test(subtype.decodeText()))) continue;
      let content: Buffer | null = null;
      if (filter === undefined) content = Buffer.from(raw);
      else if (filter instanceof PDFName && filter.decodeText() === 'FlateDecode') {
        try {
          content = inflateSync(Buffer.from(raw));
        } catch {
          content = null;
        }
      }
      if (content !== null) {
        const text = content.toString('latin1');
        if (text.includes('<x:xmpmeta')) add(where, 'holds an XMP packet');
        for (const f of authorFindings(text, r)) add(where, f);
      }
    }
  }
  return dedupe(out);
}

function scanLatex(file: string, text: string, r: Rules): ZeroTraceFinding[] {
  const out: ZeroTraceFinding[] = [];
  const at = text.indexOf('\\begin{document}');
  const preamble = at === -1 ? '' : text.slice(0, at);
  const body = at === -1 ? text : text.slice(at);
  for (const f of metadataFindings(preamble.replace(/https?:\/\/[^\s{}]*/g, ''), r)) out.push({ file, where: 'preamble', finding: f });
  for (const m of preamble.matchAll(/\b(pdfcreator|pdfproducer|pdfauthor)\s*=\s*\{([^{}]*)\}/g)) {
    if ((m[2] as string).trim() !== '') out.push({ file, where: 'preamble', finding: `sets ${m[1]} ("${(m[2] as string).slice(0, 60)}") — it must be empty` });
  }
  for (const f of authorFindings(body, r)) out.push({ file, where: 'body', finding: f });
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*%.*\b(generated by|pandoc|pensmith)\b/i.test(line)) out.push({ file, where: 'comment', finding: `holds a generator comment ("${line.trim().slice(0, 60)}")` });
  }
  return dedupe(out);
}

function scanBib(file: string, text: string, r: Rules): ZeroTraceFinding[] {
  const out: ZeroTraceFinding[] = [];
  // The text between entries (comments, @comment blocks) is metadata; the entries are the bibliography's content.
  const outside = text.replace(/@(?!comment\b)[A-Za-z]+\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/gi, '');
  for (const f of metadataFindings(outside.replace(/https?:\/\/\S*/g, ''), r)) out.push({ file, where: 'outside the entries', finding: f });
  for (const f of authorFindings(text, r)) out.push({ file, where: 'entries', finding: f });
  return dedupe(out);
}

function scanRis(file: string, text: string, r: Rules): ZeroTraceFinding[] {
  const out: ZeroTraceFinding[] = authorFindings(text, r).map((f) => ({ file, where: 'records', finding: f }));
  if (/^N1 {2}- RETRACTED\s*$/im.test(text)) out.push({ file, where: 'records', finding: 'carries the library\'s RETRACTED note' });
  return dedupe(out);
}

function dedupe(findings: ZeroTraceFinding[]): ZeroTraceFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = `${f.where}\u0000${f.finding}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Scan one exported file (by its extension: .docx, .pdf, .tex, .md, .bib,
 * .ris; anything else as author text). Returns every finding; [] is clean.
 * A file that cannot be read as its format is a finding (never "clean").
 */
export async function scanExportFile(file: string, ctx: ZeroTraceContext): Promise<ZeroTraceFinding[]> {
  const r = rulesFor(ctx);
  const bytes = await fsp.readFile(file);
  const lower = file.toLowerCase();
  try {
    if (lower.endsWith('.docx')) return await scanDocx(file, bytes, r);
    if (lower.endsWith('.pdf')) return await scanPdf(file, bytes, r);
  } catch (e) {
    return [{ file, where: 'file', finding: `could not be read for the zero-trace check (${(e as Error).message.split('\n')[0] ?? ''})` }];
  }
  const text = bytes.toString('utf8');
  if (lower.endsWith('.tex')) return scanLatex(file, text, r);
  if (lower.endsWith('.bib')) return scanBib(file, text, r);
  if (lower.endsWith('.ris')) return scanRis(file, text, r);
  return dedupe(authorFindings(text, r).map((f) => ({ file, where: 'text', finding: f })));
}
