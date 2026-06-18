// bin/lib/exporter.ts
//
// Zero-trace export (DONE-07 / TEST-10) — THE non-negotiable: no exported doc
// carries a pensmith metadata trace, in ANY format. zeroTracePatch() is the
// MANDATORY last step of every .docx export; zeroTracePdf() is the MANDATORY
// last step of every .pdf export. Pandoc shellout via execFile (never exec).
// md-only fallback when Pandoc/PDF-engine absent (DONE-06) — never throws.
// Exports written to a DISTINCT export dir, never over the source artifacts.
//
// WHY in-process scrubs (not just Pandoc flags):
//   - .docx: even `--metadata author=""` leaves an empty-but-present field, and a
//     source YAML header can inject a real name. zeroTracePatch loads the ZIP and
//     blanks the FULL identifying field set across core.xml + app.xml, then sweeps
//     EVERY non-binary entry (incl. _rels/.rels) for the literal 'pensmith'.
//   - .pdf: the `--variable pdfcreator=/pdfproducer=` flags CANNOT strip the XMP
//     stream the engine injects (06-RESEARCH Pitfall 3). pdf-lib's save()
//     serializes ALL indirect objects regardless of reachability, so deleting the
//     catalog /Metadata reference is NOT enough — the XMP stream OBJECT must be
//     deleted from the context so save() never emits it (HIGH-C2-1). NO
//     length-altering byte edits on the serialized PDF (the latin1 replace
//     approach shifts xref offsets + /Length values and corrupts the file).
//
// Both scrubs run OFFLINE in-process (JSZip for docx, pure-JS pdf-lib for pdf),
// so the gating zero-trace test passes on the build machine where Pandoc + the
// PDF engine are absent.
//
// D-07 chokepoint: all file output routes through atomicWriteFile / copyFile;
// this module NEVER calls fs.writeFile-family methods directly.

import * as fsp from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDocument, PDFName } from 'pdf-lib';
import { atomicWriteFile } from './atomic-write.js';

// Fixed epoch used for ZIP entry timestamps + dcterms normalization — keeps the
// scrubbed .docx deterministic (Pitfall 6) and strips authoring-time metadata.
const EPOCH = new Date(0);
const EPOCH_W3CDTF = '1970-01-01T00:00:00Z';

// ---------------------------------------------------------------------------
// zeroTracePatch — DOCX ZIP scrub (DONE-07 / T-06-04-01)
// ---------------------------------------------------------------------------

// The FULL identifying field set blanked in docProps/core.xml (HIGH-2 — the
// narrow set in a prior cycle MISSED dc:subject/dc:description/cp:category/
// cp:contentStatus). Each is set to an empty element.
const CORE_BLANK_TAGS = [
  'dc:creator',
  'dc:title',
  'dc:subject',
  'dc:description',
  'cp:keywords',
  'cp:category',
  'cp:contentStatus',
  'cp:lastModifiedBy',
];

// The extended-property fields blanked in docProps/app.xml.
const APP_BLANK_TAGS = ['Application', 'Company', 'Manager', 'Template'];

/**
 * Blank an XML element `<ns:tag ...>...</ns:tag>` to `<ns:tag></ns:tag>`,
 * tolerating (a) attribute-bearing open tags, (b) multiline content, and
 * (c) the self-closing form `<ns:tag/>`. Escapes the tag name for the RegExp.
 */
function blankXmlTag(xml: string, tag: string): string {
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Paired form: <tag ...> ... </tag>  (attributes optional, content any).
  const paired = new RegExp(`<${esc}(\\s[^>]*)?>[\\s\\S]*?<\\/${esc}>`, 'g');
  // Self-closing form: <tag ... />
  const selfClosing = new RegExp(`<${esc}(\\s[^>]*)?\\/>`, 'g');
  return xml.replace(paired, `<${tag}></${tag}>`).replace(selfClosing, `<${tag}></${tag}>`);
}

/**
 * Set a `<dcterms:created>`/`<dcterms:modified>` element to the fixed epoch,
 * preserving its attributes (e.g. `xsi:type="dcterms:W3CDTF"`).
 */
function epochDctermsTag(xml: string, tag: string): string {
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const paired = new RegExp(`<${esc}((?:\\s[^>]*)?)>[\\s\\S]*?<\\/${esc}>`, 'g');
  const selfClosing = new RegExp(`<${esc}((?:\\s[^>]*)?)\\/>`, 'g');
  return xml
    .replace(paired, (_m, attrs: string) => `<${tag}${attrs}>${EPOCH_W3CDTF}</${tag}>`)
    .replace(selfClosing, (_m, attrs: string) => `<${tag}${attrs}>${EPOCH_W3CDTF}</${tag}>`);
}

/**
 * Heuristic: is this ZIP entry a binary part we must NOT string-sweep?
 *
 * MEDIUM-1 (cycle-3): the defense-in-depth 'pensmith' sweep must NOT run a
 * string replace over binary parts (media images, embedded fonts, thumbnails) —
 * doing so would corrupt the LIVE Pandoc docx path (the CI fixture has no binary
 * parts, but a real export may). We treat known binary subtrees + a NUL-byte
 * sniff as binary and pass those entries through untouched.
 */
function isBinaryDocxEntry(name: string, text: string): boolean {
  const lower = name.toLowerCase();
  if (
    lower.startsWith('word/media/') ||
    lower.startsWith('word/embeddings/') ||
    lower.startsWith('word/fonts/') ||
    lower.startsWith('docprops/thumbnail') ||
    /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|bin|ttf|otf|woff2?|eot)$/.test(lower)
  ) {
    return true;
  }
  // NUL byte → certainly not text we should string-edit.
  return text.includes('\x00');
}

/**
 * zeroTracePatch — MANDATORY last step of every .docx export (DONE-07).
 *
 * Loads `docxPath` as a ZIP, blanks the FULL identifying field set in
 * docProps/core.xml + docProps/app.xml, epochs the dcterms timestamps, sweeps
 * EVERY non-binary entry (including non-.xml entries like `_rels/.rels`) for the
 * literal 'pensmith', and writes the result back atomically.
 *
 * Idempotent (running twice yields the same clean output) and tolerant (missing
 * core.xml/app.xml is skipped without error).
 */
export async function zeroTracePatch(docxPath: string): Promise<void> {
  const buf = await fsp.readFile(docxPath);
  const zip = await JSZip.loadAsync(buf);

  // (1) docProps/core.xml — blank the full identifying set + epoch timestamps.
  const coreEntry = zip.file('docProps/core.xml');
  if (coreEntry) {
    let core = await coreEntry.async('string');
    for (const tag of CORE_BLANK_TAGS) core = blankXmlTag(core, tag);
    core = epochDctermsTag(core, 'dcterms:created');
    core = epochDctermsTag(core, 'dcterms:modified');
    zip.file('docProps/core.xml', core, { date: EPOCH });
  }

  // (2) docProps/app.xml — blank the extended-property identifying fields.
  const appEntry = zip.file('docProps/app.xml');
  if (appEntry) {
    let app = await appEntry.async('string');
    for (const tag of APP_BLANK_TAGS) app = blankXmlTag(app, tag);
    zip.file('docProps/app.xml', app, { date: EPOCH });
  }

  // (3) Defense-in-depth sweep — strip the literal 'pensmith' from EVERY
  //     non-binary entry (incl. _rels/.rels, custom.xml, headers, any text
  //     part — NOT just *.xml). Binary parts pass through untouched.
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    let text: string;
    try {
      text = await file.async('string');
    } catch {
      // Unreadable as string → treat as binary, leave untouched.
      continue;
    }
    if (isBinaryDocxEntry(name, text)) continue;
    if (/pensmith/i.test(text)) {
      const swept = text.replace(/pensmith/gi, '');
      zip.file(name, swept, { date: EPOCH });
    }
  }

  const out = await zip.generateAsync({ type: 'nodebuffer' });
  await atomicWriteFile(docxPath, out);
}

// ---------------------------------------------------------------------------
// zeroTracePdf — PDF /Info clear + STRUCTURAL XMP-object delete (DONE-07 / T-06-04-02)
// ---------------------------------------------------------------------------

/**
 * zeroTracePdf — MANDATORY last step of every .pdf export (DONE-07, HIGH-C2-1).
 *
 * Loads `pdfPath` via pure-JS pdf-lib (no external engine), empties the /Info
 * document-info dictionary (Producer/Creator/Author/Title/Subject/Keywords),
 * and removes the XMP metadata stream STRUCTURALLY — capturing the catalog
 * /Metadata indirect ref and deleting the actual indirect stream OBJECT from the
 * context BEFORE save() (pdf-lib serializes ALL indirect objects regardless of
 * reachability, so deleting only the catalog reference leaves the <x:xmpmeta>
 * stream object in the context and save() still writes it — leaking BOTH
 * 'pensmith' AND the non-'pensmith' token 'Trace Sentinel'). Also drops the
 * catalog entry. Performs NO length-altering byte edits on the serialized PDF;
 * any literal-'pensmith' check is a READ-ONLY post-save assertion.
 *
 * Idempotent and tolerant: a PDF with no /Info or /Metadata is scrubbed without
 * error; never throws on a malformed-but-loadable PDF (other than the explicit
 * residual assertion, which signals an incomplete structural strip to fix).
 */
export async function zeroTracePdf(pdfPath: string): Promise<void> {
  const buf = await fsp.readFile(pdfPath);
  // updateMetadata:false → do NOT let pdf-lib re-inject its own Producer/ModDate.
  const pdf = await PDFDocument.load(buf, { updateMetadata: false });

  // Empty the /Info document-info dictionary.
  pdf.setTitle('');
  pdf.setAuthor('');
  pdf.setSubject('');
  pdf.setKeywords([]);
  pdf.setProducer('');
  pdf.setCreator('');
  // Normalize dates to the fixed epoch (determinism; not identifying trace).
  try {
    pdf.setCreationDate(EPOCH);
    pdf.setModificationDate(EPOCH);
  } catch {
    // Some pdf-lib builds may reject epoch dates — non-fatal, dates are not trace.
  }

  // Remove the XMP metadata stream STRUCTURALLY (THE HIGH-C2-1 fix).
  try {
    const metaRef = pdf.catalog.get(PDFName.of('Metadata'));
    if (metaRef) {
      // Delete the ACTUAL indirect stream object so save() cannot serialize it.
      pdf.context.delete(metaRef as Parameters<typeof pdf.context.delete>[0]);
      // Also drop the catalog entry.
      pdf.catalog.delete(PDFName.of('Metadata'));
    }
  } catch {
    // A PDF with no /Metadata (or an unusual catalog) → nothing to remove.
  }

  // updateFieldAppearances:false → no incidental form mutation. NO post-save
  // length-altering byte edit (that would shift xref offsets + /Length values
  // and corrupt the file).
  const bytes = await pdf.save({ updateFieldAppearances: false });
  const out = Buffer.from(bytes);

  // READ-ONLY defense-in-depth assertion: a residual 'pensmith' means the
  // structural strip is incomplete and must be FIXED — never byte-edited away.
  if (out.toString('latin1').toLowerCase().includes('pensmith')) {
    throw new Error(
      `zeroTracePdf: residual 'pensmith' after structural scrub of ${pdfPath} — ` +
        `the XMP/Info strip is incomplete (fix the structural removal, do NOT byte-edit)`,
    );
  }

  await atomicWriteFile(pdfPath, out);
}
