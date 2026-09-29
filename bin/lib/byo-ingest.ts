// bin/lib/byo-ingest.ts — bring-your-own PDFs into the paper's library
// (SRC-15, D-19-21; PRD §7.15, §9).
//
// Serves `pensmith new --pdfs <dir>` (which also records the folder as
// `[sources] byo_pdf_dir`), `pensmith add <dir>`, `pensmith add <file.pdf>`
// (strict: an unidentified PDF is refused, nothing changes) and `add <id>
// --pdf <file>` (attach a PDF to the work the identifier names); research
// ingests new files in `byo_pdf_dir` before discovery (integration pass).
//
// Per PDF:
//   1. size cap (MAX_PDF_BYTES) and the `%PDF-` magic;
//   2. sha256 of the bytes — re-ingest is idempotent by it: a PDF already in
//      the library is not added again (an unhydrated one is re-identified);
//   3. extraction in the SEC-02 worker (pdf-text.ts extractPdf);
//   4. identification (pdf-identify.ts): only an identifier or the title
//      leaves the machine (PRIVACY.md), never the text;
//   5. identified → the registrar record goes through the ONE library writer
//      (upsertSources, provenance `byo` → tag "bring-your-own"; a search hit
//      for the same work later merges into this entry). Not identified → the
//      PDF is kept with the metadata it carries itself, `hydrated: false`, and
//      a warning — never as a search hit;
//   6. the PDF is copied to `.paper/sources/<citekey>.pdf` and LIBRARY.json
//      records `byo: {file, sha256, text_sha256}` (attachByoRecord); the text
//      is cached in the data dir under the PDF's sha256 for byo-text.ts,
//      which is the only reader of BYO text (it re-hashes first).
// After a batch, RESEARCH.md's sources block is refreshed (research-md.ts).

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { extractPdf, MAX_PDF_BYTES, PdfTimeoutError, type PdfExtraction } from './pdf-text.js';
import { hasPdfMagic } from './pdf-response.js';
import {
  identifyPdf,
  isOwnWork,
  localPdfMetadata,
  metadataIdentifiers,
  type IdentifyDeps,
  type IdentifyVia,
  type LocalPdfMetadata,
} from './pdf-identify.js';
import { normalizeDoi, findArxivIdsInText } from './doi.js';
import { normArxiv } from './migrations/library/shape.js';
import {
  upsertSources,
  tryLoadLibrary,
  attachByoRecord,
  hydrateEntry,
  type LibraryCandidate,
  type LibraryEntry,
} from './library.js';
import { refreshResearchSources } from './research-md.js';
import { byoSourcesDir, sha256Hex, writeByoTextCache } from './byo-text.js';
import { CITEKEY_RE, generateCitekey } from './citekey.js';
import { isOfflineEgressError, offlineLabel } from './http.js';
import { updatePaperConfig, rawTable } from './config.js';
import { PensmithError, EXIT_USAGE } from './exit-codes.js';
import { isInsideProject } from './own-source-approvals.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

/** How deep a bring-your-own folder is searched for PDFs. */
export const BYO_MAX_DEPTH = 3;

export type ByoOutcome =
  | {
      readonly file: string;
      readonly status: 'added' | 'merged' | 'unchanged' | 'already-ingested';
      readonly citekey: string;
      readonly hydrated: boolean;
      /** How the work was identified (absent when unhydrated or already ingested). */
      readonly via?: IdentifyVia;
      readonly query?: string;
      /** Why it stayed unhydrated, or another caveat (a PDF already attached). */
      readonly warning?: string;
    }
  | { readonly file: string; readonly status: 'refused' | 'skipped'; readonly reason: string; readonly code: ByoRefusal };

/** Why a PDF was refused (strict) or skipped: unreadable file, no text, no confident match, no network. */
export type ByoRefusal = 'unreadable' | 'image-only' | 'unidentified' | 'offline';

export interface ByoIngestOptions {
  /** The provenance tag of new entries: `byo` (folder ingest), `add` (a single `add <file.pdf>`). */
  readonly provenance?: string;
  /** `add <file.pdf>`: refuse an unidentified or image-only PDF instead of keeping it unhydrated. */
  readonly strict?: boolean;
  /** Identification lookups (tests inject; defaults hit the registrars). */
  readonly deps?: IdentifyDeps;
  readonly now?: () => Date;
}

export interface ListPdfsOptions {
  /**
   * Read only the PDFs whose real path (links resolved) lies inside this
   * folder — the project root, for a bring-your-own folder the user never
   * approved themselves (own-source-approvals.ts): a symlinked file pointing
   * outside the project is skipped and reported through `onSkip`.
   */
  readonly confineTo?: string;
  readonly onSkip?: (file: string, reason: string) => void;
}

/**
 * The PDFs in `dir` (and its sub-folders, to BYO_MAX_DEPTH), sorted; hidden
 * entries and symlinked folders are skipped, and with `confineTo` every file
 * that resolves outside it (see ListPdfsOptions).
 */
export async function listPdfsInDir(dir: string, opts: ListPdfsOptions = {}): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, depth: number): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < BYO_MAX_DEPTH) await walk(p, depth + 1);
      } else if ((e.isFile() || e.isSymbolicLink()) && /\.pdf$/i.test(e.name)) {
        if (opts.confineTo !== undefined && !isInsideProject(opts.confineTo, p)) {
          opts.onSkip?.(p, 'it links to a file outside the paper folder, and you have not approved this folder for the paper');
          continue;
        }
        out.push(p);
      }
    }
  };
  await walk(path.resolve(dir), 1);
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve a `--pdfs <dir>` / `add <dir>` argument: an existing directory, as
 * an absolute path. Anything else is a usage error (exit 2) before anything is
 * written.
 */
export function resolveByoDirArg(arg: unknown, flag = '--pdfs'): string {
  const raw = typeof arg === 'string' ? arg.trim() : '';
  if (!raw) throw new PensmithError(`${flag} needs a folder of PDFs`, EXIT_USAGE);
  const abs = path.resolve(raw);
  let isDir = false;
  try {
    isDir = fs.statSync(abs).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new PensmithError(`${flag} ${raw}: no such folder`, EXIT_USAGE);
  return abs;
}

/**
 * Record the folder as `[sources] byo_pdf_dir` through the one config writer
 * (CONF-01): relative to the project root when it lies inside it (so the
 * paper folder can move), else absolute.
 */
export async function recordByoPdfDir(root: string, dir: string): Promise<string> {
  const abs = path.resolve(dir);
  const rel = path.relative(path.resolve(root), abs);
  const stored = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : abs;
  await updatePaperConfig(root, (raw) => {
    rawTable(raw, 'sources')['byo_pdf_dir'] = stored;
  });
  return stored;
}

/**
 * A citekey-derived file name that is safe on every filesystem and unique per
 * citekey — also on the case-insensitive filesystems macOS and Windows use by
 * default (review round 2). A D-14 key (`[a-z][a-z0-9_-]*`, lowercase) is its
 * own name; any other key (`smith:2020`, `Smith2020`) becomes its lowercased,
 * sanitized form plus `.` and the first 12 hex digits of the key's sha256 —
 * a `.` no D-14 key contains, so the two forms never meet.
 */
export function pdfFileName(citekey: string): string {
  if (CITEKEY_RE.test(citekey)) return `${citekey}.pdf`;
  const safe = citekey.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 64) || 'source';
  return `${safe}.${sha256Hex(citekey).slice(0, 12)}.pdf`;
}

/** A citekey for a PDF no registrar identified: from its own metadata, else its file name. */
function localCitekey(local: LocalPdfMetadata, file: string): string {
  if (local.authors.length > 0) {
    return generateCitekey({ authors: [...local.authors], ...(local.year !== null ? { year: local.year } : {}) });
  }
  const stem = path
    .basename(file, path.extname(file))
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  return `byo${stem || 'pdf'}`;
}

/** The unhydrated candidate for a PDF: only what the PDF says about itself. */
function localCandidate(local: LocalPdfMetadata, file: string): LibraryCandidate {
  return {
    citekey: localCitekey(local, file),
    title: local.title ?? path.basename(file, path.extname(file)),
    authors: [...local.authors],
    year: local.year,
    hydrated: false,
  };
}

export interface Prepared {
  readonly bytes: Buffer;
  readonly sha256: string;
}

async function prepare(file: string): Promise<Prepared | { skip: string }> {
  let st: fs.Stats;
  try {
    st = await fsp.stat(file);
  } catch {
    return { skip: 'no such file' };
  }
  if (!st.isFile()) return { skip: 'not a file' };
  if (st.size > MAX_PDF_BYTES) return { skip: `larger than the ${MAX_PDF_BYTES / (1024 * 1024)} MB limit` };
  const bytes = await fsp.readFile(file);
  if (!hasPdfMagic(bytes)) return { skip: 'not a PDF (no %PDF- header)' };
  return { bytes, sha256: sha256Hex(bytes) };
}

/**
 * Copy the PDF into `.paper/sources/<citekey>.pdf` and record it on the entry
 * (attachByoRecord). An entry that already carries a DIFFERENT PDF keeps it
 * unless `replace`; the warning says so.
 */
async function storePdf(
  root: string,
  citekey: string,
  prepared: Prepared,
  textSha: string | null,
  replace: boolean,
  asserted = false,
): Promise<string | undefined> {
  const name = pdfFileName(citekey);
  const record = { file: `sources/${name}`, sha256: prepared.sha256, text_sha256: textSha, asserted };
  const lib = await tryLoadLibrary(root);
  const existing = lib?.entries.find((e) => e.citekey === citekey)?.byo ?? null;
  if (existing !== null && existing.sha256 !== prepared.sha256 && !replace) {
    return `${citekey} already has a PDF (${existing.file}); this copy was not stored`;
  }
  // Never overwrite the PDF another entry references (its recorded hash would
  // stop matching, and its text would read as "changed since ingest").
  const owner = lib?.entries.find(
    (e) => e.citekey !== citekey && e.byo !== null && e.byo.file.toLowerCase() === record.file.toLowerCase() && e.byo.sha256 !== prepared.sha256,
  );
  if (owner !== undefined) {
    return `${record.file} already holds the PDF of ${owner.citekey}, which this copy would overwrite; this copy was not stored`;
  }
  const dest = path.join(byoSourcesDir(root), name);
  let same = false;
  try {
    same = sha256Hex(await fsp.readFile(dest)) === prepared.sha256;
  } catch {
    same = false;
  }
  if (!same) await atomicWriteFile(dest, prepared.bytes);
  await attachByoRecord(root, citekey, record, { replace });
  return undefined;
}

function textShaOf(ex: PdfExtraction): string | null {
  return ex.imageOnly ? null : sha256Hex(ex.text);
}

/** The library entry that already holds a PDF with this sha256, if any. */
async function entryWithPdf(root: string, sha256: string): Promise<LibraryEntry | undefined> {
  const lib = await tryLoadLibrary(root);
  return lib?.entries.find((e) => e.byo !== null && e.byo.sha256 === sha256);
}

/** Ingest one PDF (see the header). Never throws for a bad PDF; OfflineEgressError propagates in strict mode only. */
export async function ingestByoPdf(root: string, file: string, opts: ByoIngestOptions = {}): Promise<ByoOutcome> {
  const abs = path.resolve(file);
  const provenance = opts.provenance ?? 'byo';
  const prepared = await prepare(abs);
  const refuse = (reason: string, code: ByoRefusal): ByoOutcome => ({ file: abs, status: opts.strict ? 'refused' : 'skipped', reason, code });
  if ('skip' in prepared) return refuse(prepared.skip, 'unreadable');

  const known = await entryWithPdf(root, prepared.sha256);
  if (known !== undefined && known.hydrated) {
    return { file: abs, status: 'already-ingested', citekey: known.citekey, hydrated: true };
  }

  let ex: PdfExtraction;
  try {
    ex = await extractPdf(prepared.bytes);
  } catch (e) {
    const reason = e instanceof PdfTimeoutError ? 'reading it took too long (the parser was stopped)' : `could not be read (${(e as Error).message.split('\n')[0]})`;
    return refuse(reason, 'unreadable');
  }
  if (opts.strict && ex.imageOnly) return refuse('no extractable text (an image-only or scanned PDF)', 'image-only');
  const textSha = textShaOf(ex);
  if (textSha !== null) await writeByoTextCache(prepared.sha256, ex.text);

  let identified: Awaited<ReturnType<typeof identifyPdf>>;
  try {
    identified = await identifyPdf(ex, opts.deps, { pdf: prepared.bytes });
  } catch (e) {
    if (!isOfflineEgressError(e) || opts.strict) throw e;
    return refuse(`identifying it needs the network (${offlineLabel(e)}) — re-run online to add it`, 'offline');
  }

  // A PDF already in the library but still unhydrated: try to identify it again.
  if (known !== undefined) {
    if (identified.kind !== 'identified') {
      return { file: abs, status: 'already-ingested', citekey: known.citekey, hydrated: false, warning: identified.reason };
    }
    const h = await hydrateEntry(root, known.citekey, identified.candidate as LibraryCandidate, { provenance, ...(opts.now ? { now: opts.now } : {}) });
    return {
      file: abs,
      status: h.status === 'merged' ? 'merged' : 'already-ingested',
      citekey: known.citekey,
      hydrated: h.status === 'merged',
      via: identified.via,
      query: identified.query,
      ...(h.status === 'conflict' ? { warning: `the record it matches is already in the library as ${h.citekey}` } : {}),
    };
  }

  if (identified.kind !== 'identified' && opts.strict) return refuse(identified.reason, 'unidentified');
  const candidate: LibraryCandidate =
    identified.kind === 'identified' ? (identified.candidate as SourceCandidate as LibraryCandidate) : localCandidate(identified.local, abs);
  const upsert = await upsertSources(root, [candidate], { provenance, ...(opts.now ? { now: opts.now } : {}) });
  const outcome = upsert.outcomes[0]!;
  const warnStore = await storePdf(root, outcome.citekey, prepared, textSha, false);
  const entry = (await tryLoadLibrary(root))?.entries.find((e) => e.citekey === outcome.citekey);
  const base = {
    file: abs,
    status: outcome.status,
    citekey: outcome.citekey,
    hydrated: entry?.hydrated ?? identified.kind === 'identified',
  } as const;
  if (identified.kind === 'identified') {
    return { ...base, via: identified.via, query: identified.query, ...(warnStore ? { warning: warnStore } : {}) };
  }
  const why = `not identified (${identified.reason}) — kept with the PDF's own metadata; check it before citing`;
  return { ...base, warning: warnStore ? `${why}; ${warnStore}` : why };
}

/** Ingest several PDFs in order, then refresh RESEARCH.md's sources block once. */
export async function ingestByoPdfs(root: string, files: readonly string[], opts: ByoIngestOptions = {}): Promise<ByoOutcome[]> {
  const outcomes: ByoOutcome[] = [];
  for (const f of files) outcomes.push(await ingestByoPdf(root, f, opts));
  if (outcomes.some((o) => o.status === 'added' || o.status === 'merged')) await refreshResearchSources(root);
  return outcomes;
}

/** A PDF named by `add <id> --pdf <file>`, read and checked against the record it is for. */
export interface PdfForRecord {
  readonly file: string;
  readonly prepared: Prepared;
  readonly textSha: string | null;
  readonly imageOnly: boolean;
  /** True when the PDF shows the record's work (see checkPdfForRecord). */
  readonly matches: boolean;
  /** Why it does not (one line), when it does not. */
  readonly why: string | null;
}

/**
 * Read the PDF the user named for a registrar record and check that it IS
 * that work (SRC-13: a wrong work is never attached silently). It is when its
 * embedded metadata or its arXiv margin stamp carries the record's DOI / arXiv
 * id, or when its own title and first author match the record's
 * (pdf-identify.ts isOwnWork: the Pass-1 thresholds, or the title printed as a
 * title with the author below). No network: only the record already fetched.
 */
export async function checkPdfForRecord(
  file: string,
  record: Pick<LibraryCandidate, 'title' | 'authors' | 'doi' | 'arxiv'>,
): Promise<PdfForRecord> {
  const prepared = await prepare(path.resolve(file));
  if ('skip' in prepared) throw new PensmithError(`--pdf ${file}: ${prepared.skip}`, EXIT_USAGE);
  let ex: PdfExtraction;
  try {
    ex = await extractPdf(prepared.bytes);
  } catch (e) {
    const reason = e instanceof PdfTimeoutError ? 'reading it took too long (the parser was stopped)' : `could not be read (${(e as Error).message.split('\n')[0]})`;
    throw new PensmithError(`--pdf ${file}: ${reason}`, EXIT_USAGE);
  }
  const textSha = textShaOf(ex);
  if (textSha !== null) await writeByoTextCache(prepared.sha256, ex.text);
  const base = { file: path.resolve(file), prepared, textSha, imageOnly: ex.imageOnly };
  const title = record.title ?? '';
  if (ex.imageOnly) {
    return { ...base, matches: false, why: 'the PDF has no extractable text (an image-only or scanned PDF), so it cannot be checked against the record' };
  }
  const doi = typeof record.doi === 'string' ? normalizeDoi(record.doi) : null;
  const arxiv = typeof record.arxiv === 'string' ? normArxiv(record.arxiv) : null;
  const meta = metadataIdentifiers(ex);
  const stamped = findArxivIdsInText(ex.pages.slice(0, 2).join('\n')).stamped.map((a) => normArxiv(a));
  const selfIdentified =
    (doi !== null && meta.doi !== null && normalizeDoi(meta.doi) === doi) ||
    (arxiv !== null && ((meta.arxiv !== null && normArxiv(meta.arxiv) === arxiv) || stamped.includes(arxiv)));
  const firstPage = ex.pages[0] ?? ex.text.slice(0, 6000);
  if (selfIdentified || (title !== '' && isOwnWork({ title, authors: [...(record.authors ?? [])] }, firstPage, localPdfMetadata(ex)))) {
    return { ...base, matches: true, why: null };
  }
  const first = record.authors?.[0];
  return {
    ...base,
    matches: false,
    why: `its first page does not show "${title}"${first ? ` by ${first}` : ''} (the title and first author), and it carries no identifier of that work`,
  };
}

/**
 * `add <id> --pdf <file>`: put the registrar record in the library and attach
 * the PDF the user named, checked by checkPdfForRecord. A PDF that does not
 * show the work is attached only when the caller passes `asserted` (the user
 * confirmed it at the `pdf-attach-unmatched` gate): it is recorded
 * `byo.asserted`, and its text is never evidence (byo-text.ts). An entry that
 * already carries a DIFFERENT PDF keeps it unless `replace` (`--replace-pdf`).
 * When that PDF is already in the library as an UNHYDRATED entry (ingested
 * earlier without a confident match), the record hydrates that entry — its
 * citekey stays, so drafts citing it keep resolving — instead of adding the
 * work a second time.
 */
export async function upsertWithPdf(
  root: string,
  candidate: LibraryCandidate,
  pdf: PdfForRecord,
  provenance: string,
  opts: { readonly replace?: boolean; readonly asserted?: boolean } = {},
): Promise<{ citekey: string; status: 'added' | 'merged' | 'unchanged'; stored: boolean; warnings: string[] }> {
  if (!pdf.matches && opts.asserted !== true) {
    throw new PensmithError(`--pdf ${path.basename(pdf.file)}: ${pdf.why ?? 'it does not show this work'} — nothing attached`, EXIT_USAGE);
  }
  const warnings: string[] = [];
  let citekey: string | null = null;
  let status: 'added' | 'merged' | 'unchanged' = 'unchanged';
  const holder = await entryWithPdf(root, pdf.prepared.sha256);
  if (holder !== undefined && !holder.hydrated) {
    const h = await hydrateEntry(root, holder.citekey, candidate, { provenance });
    if (h.status !== 'conflict') {
      citekey = holder.citekey;
      status = h.status === 'merged' ? 'merged' : 'unchanged';
    } else {
      warnings.push(`this PDF was also ingested earlier as ${holder.citekey}, which stays unhydrated`);
    }
  }
  if (citekey === null) {
    const upsert = await upsertSources(root, [candidate], { provenance });
    citekey = upsert.outcomes[0]!.citekey;
    status = upsert.outcomes[0]!.status;
  }
  const kept = await storePdf(root, citekey, pdf.prepared, pdf.textSha, opts.replace === true, !pdf.matches);
  if (kept !== undefined) {
    warnings.push(kept.includes('already has a PDF') ? `${kept} — pass --replace-pdf to replace it` : kept);
    return { citekey, status, stored: false, warnings };
  }
  if (pdf.imageOnly) warnings.push('the PDF has no extractable text (an image-only or scanned PDF)');
  return { citekey, status, stored: true, warnings };
}

/** One human-readable line for an outcome (`<prefix>: bring-your-own: …`). */
export function describeByoOutcome(o: ByoOutcome, prefix: string): { line: string; stream: 'stdout' | 'stderr' } {
  const name = path.basename(o.file);
  switch (o.status) {
    case 'skipped':
      return { line: `${prefix}: bring-your-own: ${name} skipped — ${o.reason}`, stream: 'stderr' };
    case 'refused':
      return { line: `${prefix}: ${name}: ${o.reason}`, stream: 'stderr' };
    case 'already-ingested':
      return {
        line: `${prefix}: bring-your-own: ${name} is already in the library as ${o.citekey}${o.warning ? ` (${o.warning})` : ''}`,
        stream: o.warning ? 'stderr' : 'stdout',
      };
    default: {
      const how = o.via ? ` (identified by ${o.via === 'title-search' ? `title: "${o.query ?? ''}"` : o.query ?? o.via})` : '';
      const verb = o.status === 'added' ? 'added as' : o.status === 'merged' ? 'merged into' : 'matches';
      if (o.warning) return { line: `${prefix}: WARN — bring-your-own: ${name} ${verb} ${o.citekey}${how}: ${o.warning}`, stream: 'stderr' };
      return { line: `${prefix}: bring-your-own: ${name} ${verb} ${o.citekey}${how}`, stream: 'stdout' };
    }
  }
}
