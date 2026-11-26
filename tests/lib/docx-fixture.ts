// tests/lib/docx-fixture.ts — a .docx shaped like Pandoc's output, and a
// reader for the parts of any .docx.

import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';

/** Every text part of a .docx, by name. */
export async function docxParts(file: string): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const out = new Map<string, string>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) out.set(name, await entry.async('string'));
  }
  return out;
}

/** A docx the way Pandoc writes one when given absolute --csl/--bibliography paths. */
export async function pandocLikeDocx(file: string, leak: string): Promise<void> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" />' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml" />' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml" />' +
      '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml" /></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" />' +
      '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml" />' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml" />' +
      '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml" /></Relationships>',
  );
  zip.file(
    'docProps/custom.xml',
    '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="bibliography"><vt:lpwstr>${leak}/.paper/export/CITATIONS.bib</vt:lpwstr></property>` +
      `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="csl"><vt:lpwstr>${leak}/.claude/plugins/cache/x/templates/citation-styles/apa.csl</vt:lpwstr></property></Properties>`,
  );
  zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z"><dc:title>T</dc:title><dcterms:created>2026-11-25T03:43:52Z</dcterms:created></cp:coreProperties>');
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8"?><Properties><Application>Microsoft Word 12.0.0</Application><TotalTime>6</TotalTime></Properties>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Body.</w:t></w:r></w:p></w:body></w:document>');
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}
