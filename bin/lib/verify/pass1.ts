// bin/lib/verify/pass1.ts — Pass-1 citation-integrity verifier.
//
// Deterministic: no LLM. Each cited key gets one verdict from:
//   - whether the key is in .paper/CITATIONS.bib, with a title and authors;
//   - whether a registry holds the work its identifiers name: a DOI through
//     Crossref, DataCite and doi.org, an arXiv ID through arXiv, a PMID through
//     PubMed, an ISBN through Open Library (bin/lib/verify/resolve.ts);
//   - whether the entry's title, authors, year and journal match the record
//     the registry returned (bin/lib/verify/work-match.ts);
//   - whether the work is retracted: recorded so in CITATIONS.bib, said so by
//     the record itself, or listed so by OpenAlex (bin/lib/verify/retraction.ts),
//     and whether the author acknowledged citing it in this section
//     (bin/lib/verify/acknowledgements.ts).
//
// The verdicts:
//   OK          the registry's record matches the entry;
//   MIS-CITED   the work exists, but the entry's metadata or one of its
//               identifiers is wrong;
//   FABRICATED  the key is not in the bibliography, or every registry that can
//               answer for the entry's identifiers says no such work exists;
//   UNRESOLVED  nothing could be confirmed: a registry gave no answer (offline,
//               timeout, 429 or 5xx), the entry has no identifier to look up,
//               or the only registry for it does not hold every work;
//   RETRACTED   the entry matches a work that was retracted, withdrawn or
//               removed;
//   RETRACTED_ACKNOWLEDGED  the same, and the author acknowledged citing it
//               here (`pensmith ack`): it does not block, and every verb warns;
//   EXPRESSION_OF_CONCERN   the entry matches a work its publisher has
//               published an expression of concern about: it does not block,
//               and every verb warns.
// UNRESOLVED blocks like the others; it never passes an unchecked citation and
// never accuses a real one.
//
// The row fields `titleJW` / `authorJW` carry the title and author match
// scores (0..1) for the record that was compared.

import { parseBibByCitekey, parseBibFieldsByCitekey } from '../citations.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir } from '../paths.js';
import { probeFreshnessAll, type FreshnessResult } from './freshness.js';
import { lookupRetraction } from '../sources/openalex.js';
import { describeSignal, recordRetraction, type RetractionSignal } from './retraction.js';
import { findRetractionAck, workBinding, type Acknowledgement, type WorkBinding } from './acknowledgements.js';
import {
  citedKeys,
  findCitations,
  findRawCitations,
  findUnparseableCitations,
  type RawCitationKind,
} from '../citation-grammar.js';
import { isOfflineMode } from '../network-mode.js';
import { oneLine } from './verdict-rows.js';
import { normalizeDoi, sameDoi } from '../doi.js';
import { cslDateYear, cslNames, firstString, nameFromDisplay, type WorkName, type WorkRecord } from '../sources/work-record.js';
import { matchWork, withoutRetractionLabel, type ClaimedWork } from './work-match.js';
import { registryList, resolveId, workIdentifiers, type IdResolution, type WorkId } from './resolve.js';

export type { FreshnessResult } from './freshness.js';
export { renderFreshnessTable } from './freshness.js';

// RAW_CITATION: a DOI, arXiv ID, PMID or author-year citation typed as text.
// UNPARSEABLE: a bracketed citation whose key does not parse. Neither is a
// citation Pandoc renders from the bibliography, so neither can be checked;
// both block until rewritten as a `[@key]` citation.
export type Pass1Verdict =
  | 'OK' | 'MIS-CITED' | 'FABRICATED' | 'UNRESOLVED' | 'RAW_CITATION' | 'UNPARSEABLE'
  | 'RETRACTED' | 'RETRACTED_ACKNOWLEDGED' | 'EXPRESSION_OF_CONCERN';

export interface Pass1Options {
  /** The acknowledgements recorded in the section being verified. */
  acknowledgements?: readonly Acknowledgement[];
  /** The section's number, for the `pensmith ack` command a RETRACTED reason gives. */
  section?: number;
}

export interface Pass1Result {
  citekey: string;
  verdict: Pass1Verdict;
  titleJW: number;
  authorJW: number;
  reason: string;
  /**
   * Set when the work's retraction status was read from its registry record
   * alone, because OpenAlex could not be asked; the reason says so too.
   */
  retractionRecordOnly?: true;
}

/** A bibliography entry as citation-js reads it (CSL-JSON). */
export interface BibEntry extends Record<string, unknown> {
  id?: string;
  title?: string | string[];
  DOI?: string;
  retracted?: boolean;
  // The library writes a retracted work's entry with `note = {RETRACTED}`;
  // citation-js keeps the note but has no `retracted` flag to restore.
  note?: string;
}

export interface Bib {
  entries: Map<string, BibEntry>;
  /** Raw BibTeX fields, for the identifiers CSL has no slot for. */
  fields: Map<string, Record<string, string>>;
}

/** What the entry says about the work: title, authors (or editors), year, journal. */
function claimedWork(entry: BibEntry): ClaimedWork {
  const authors: WorkName[] = cslNames(entry['author']);
  const claimed: ClaimedWork = {
    title: firstString(entry.title) ?? '',
    authors: authors.length > 0 ? authors : cslNames(entry['editor']),
  };
  const year = cslDateYear(entry['issued']);
  if (year !== undefined) claimed.year = year;
  const venue = firstString(entry['container-title']);
  if (venue) claimed.venue = venue;
  return claimed;
}

function result(citekey: string, verdict: Pass1Verdict, reason: string, titleJW = 0, authorJW = 0): Pass1Result {
  return { citekey, verdict, titleJW, authorJW, reason };
}

/** Why an identifier gave no work, in one clause. */
function missDetail(id: WorkId, r: Exclude<IdResolution, { kind: 'found' }>): string {
  if (r.kind === 'not_found') {
    if (r.invalid) return r.invalid;
    return r.authoritative
      ? `${id.shown} is not registered (${registryList(r.registries)} ${r.registries.length > 1 ? 'have' : 'has'} no record of it)`
      : `${registryList(r.registries)} has no record of ${id.shown}`;
  }
  const failed = r.failures.map((f) => `${f.registry}: ${f.detail}`).join('; ');
  const said = r.registries.length > 0 ? `; ${registryList(r.registries)} had no record of it` : '';
  return `${id.shown} could not be checked (${failed})${said}`;
}

/** What one citation is checked under: its key, the work it binds to, and any acknowledgement. */
interface CiteContext {
  ck: string;
  /** The work an acknowledgement binds to; null when the entry has no identifier. */
  binding: WorkBinding | null;
  ack: Acknowledgement | undefined;
  section: number | undefined;
}

/**
 * The verdict for a citation of a retracted work: RETRACTED, or, when the
 * author acknowledged citing it here, RETRACTED_ACKNOWLEDGED with their reason.
 */
function retractedResult(ctx: CiteContext, what: string, titleJW = 0, authorJW = 0): Pass1Result {
  if (ctx.ack) {
    return result(ctx.ck, 'RETRACTED_ACKNOWLEDGED',
      `${what}; acknowledged ${ctx.ack.acknowledged_at.slice(0, 10)}: "${ctx.ack.reason}"`, titleJW, authorJW);
  }
  // `pensmith ack` binds an acknowledgement to an identifier, so it refuses
  // an entry with none: say what will work instead.
  if (!ctx.binding) {
    return result(ctx.ck, 'RETRACTED',
      `${what} — remove the citation, or add the work's DOI, PMID or arXiv ID to its CITATIONS.bib entry: ` +
      'with none, it can be neither looked up nor acknowledged', titleJW, authorJW);
  }
  return result(ctx.ck, 'RETRACTED',
    `${what} — cite another source; if the paper discusses the retraction, acknowledge this citation with ` +
    `\`pensmith ack ${ctx.section ?? '<N>'} ${ctx.ck} --reason "<why>"\``, titleJW, authorJW);
}

/**
 * Whether the work `record` describes is retracted, by what the record says,
 * or else by OpenAlex. `note` says when OpenAlex could not be asked; that
 * never blocks, since the registry's own record was read.
 */
async function retractionOf(record: WorkRecord, id: WorkId): Promise<{ retracted: RetractionSignal[]; concerns: RetractionSignal[]; note: string | null }> {
  const signals = recordRetraction(record);
  const retracted = signals.filter((x) => x.kind === 'retracted');
  const concerns = signals.filter((x) => x.kind === 'concern');
  let note: string | null = null;
  const doi = normalizeDoi(record.doi ?? '') ?? (id.kind === 'doi' ? id.value : null);
  if (retracted.length === 0 && doi) {
    const oa = await lookupRetraction(doi);
    if (oa.kind === 'found' && oa.retracted) retracted.push({ kind: 'retracted', what: 'listed as retracted', by: 'OpenAlex' });
    else if (oa.kind === 'unavailable') note = `OpenAlex could not be asked whether it is retracted (${oa.detail})`;
  }
  return { retracted, concerns, note };
}

/** The verdict for an entry claiming `work`, whose identifier `id` led to `record`. */
async function verdictForRecord(ctx: CiteContext, work: ClaimedWork, id: WorkId, record: WorkRecord): Promise<Pass1Result> {
  const ck = ctx.ck;
  // A "RETRACTED:" label a publisher put on the title is not part of it, on
  // either side.
  const m = matchWork(
    { ...work, title: withoutRetractionLabel(work.title) },
    { ...record, title: withoutRetractionLabel(record.title) },
  );
  const source = `the ${record.registry} record for ${id.shown}`;
  const notes = m.notes.length > 0 ? ` (${m.notes.join('; ')})` : '';
  // A registry may answer an alias DOI with the work's canonical DOI.
  const alias = id.kind === 'doi' && record.doi && !sameDoi(record.doi, id.raw) ? record.doi : null;
  if (!m.ok) {
    const what = alias
      ? `the DOI resolves to a different work (canonical: ${alias}): ${m.problems.join('; ')}`
      : m.problems.join('; ');
    const retracted = recordRetraction(record).find((x) => x.kind === 'retracted');
    const also = retracted ? `; that work is also retracted: ${describeSignal(retracted)}` : '';
    return result(ck, 'MIS-CITED', `${what} — compared with ${source}${also}`, m.titleScore, m.authorScore);
  }
  const matched = `${alias ? `matches ${source}, whose canonical DOI is ${alias}` : `matches ${source}`}${notes}`;
  const r = await retractionOf(record, id);
  if (r.retracted.length > 0) {
    return retractedResult(ctx, `${matched}, but the work is retracted: ${r.retracted.map(describeSignal).join('; ')}`,
      m.titleScore, m.authorScore);
  }
  const note = r.note ? `; ${r.note}` : '';
  const out = r.concerns.length > 0
    ? result(ck, 'EXPRESSION_OF_CONCERN',
      `${matched}; an expression of concern was published about it: ${r.concerns.map(describeSignal).join('; ')} — ` +
      `say so where it is cited, or cite another source${note}`, m.titleScore, m.authorScore)
    : result(ck, 'OK', `${matched}${note}`, m.titleScore, m.authorScore);
  if (r.note) out.retractionRecordOnly = true;
  return out;
}

/** Pass-1 deterministic verdict for a single cited key. */
async function verdictForCitekey(
  ck: string,
  claimed: BibEntry | undefined,
  fields: Record<string, string> | undefined,
  opts: Pass1Options,
): Promise<Pass1Result> {
  if (!claimed) {
    return result(ck, 'FABRICATED', 'citekey not in .paper/CITATIONS.bib (drafter invented)');
  }
  const work = claimedWork(claimed);
  if (!work.title || work.authors.length === 0) {
    return result(ck, 'MIS-CITED', 'claimed citation metadata incomplete (empty title or no authors)');
  }
  const binding = workBinding(claimed, fields);
  const ctx: CiteContext = {
    ck,
    binding,
    ack: opts.acknowledgements?.length ? findRetractionAck(opts.acknowledgements, ck, binding) : undefined,
    section: opts.section,
  };
  // A retraction recorded when the source was added (the boolean on an
  // in-memory candidate, or the `note = {RETRACTED}` a bib round trip keeps)
  // blocks without a lookup, offline too. Once acknowledged, the entry is
  // still checked like any other.
  const stored = claimed.retracted === true || claimed.note === 'RETRACTED';
  if (stored && !ctx.ack) {
    return retractedResult(ctx, 'the work was recorded as retracted in CITATIONS.bib (note = {RETRACTED}) when it was added');
  }
  const r = await checkIdentifiers(ctx, claimed, fields, work);
  // The record no longer says so, but the bibliography does: the
  // acknowledgement is what lets it pass.
  if (stored && (r.verdict === 'OK' || r.verdict === 'EXPRESSION_OF_CONCERN')) {
    return retractedResult(ctx, `the work was recorded as retracted in CITATIONS.bib when it was added; ${r.reason}`, r.titleJW, r.authorJW);
  }
  return r;
}

/** Look the entry up by its identifiers and compare it with the record found. */
async function checkIdentifiers(
  ctx: CiteContext,
  claimed: BibEntry,
  fields: Record<string, string> | undefined,
  work: ClaimedWork,
): Promise<Pass1Result> {
  const ck = ctx.ck;
  const ids = workIdentifiers(claimed, fields);
  // Offline (--offline / --dry-run): nothing can be looked up. Saying OK would
  // pass an unchecked citation and FABRICATED would accuse a real one.
  if (isOfflineMode()) {
    const what = ids[0]?.shown ?? 'this entry';
    return result(ck, 'UNRESOLVED', `registry not queried (offline) — re-run verify with network access to check ${what}`);
  }
  if (ids.length === 0) {
    return result(ck, 'UNRESOLVED',
      'the entry has no DOI, arXiv ID, PMID or ISBN to look the work up by, so nothing can confirm it — ' +
      'add one to its CITATIONS.bib entry (or re-add the source with `pensmith add`)');
  }

  // Identifiers are tried most reliable first. The first one a registry
  // holds is compared; one before it that does not exist is itself an error
  // in the entry, since the reference list prints it.
  const misses: Array<{ id: WorkId; r: Exclude<IdResolution, { kind: 'found' }> }> = [];
  for (const id of ids) {
    const r = await resolveId(id);
    if (r.kind !== 'found') {
      misses.push({ id, r });
      continue;
    }
    const bad = misses.find((x) => x.r.kind === 'not_found' && x.r.authoritative);
    if (bad) {
      return result(ck, 'MIS-CITED',
        `${missDetail(bad.id, bad.r)}, although ${id.shown} is (${r.record.registry}) — correct or remove it`);
    }
    const unchecked = misses[0];
    if (unchecked) {
      return result(ck, 'UNRESOLVED',
        `${missDetail(unchecked.id, unchecked.r)}; ${id.shown} was found, but every identifier the entry ` +
        'prints must be confirmed — re-run verify later');
    }
    return verdictForRecord(ctx, work, id, r.record);
  }

  const detail = misses.map((x) => missDetail(x.id, x.r)).join('; ');
  if (misses.every((x) => x.r.kind === 'not_found' && x.r.authoritative)) {
    // An identifier that is not even well formed was never looked up: the
    // entry is wrong, but nothing says the work is invented.
    if (misses.every((x) => x.r.kind === 'not_found' && x.r.invalid)) {
      return result(ck, 'MIS-CITED', `${detail} — correct the identifier`);
    }
    return result(ck, 'FABRICATED', `no registry holds a work with this entry's identifiers: ${detail}`);
  }
  const retry = misses.some((x) => x.r.kind === 'unavailable')
    ? ' — re-run verify when the registry answers'
    : ' — check the identifier, or cite an edition a registry lists';
  return result(ck, 'UNRESOLVED', `${detail}${retry}`);
}

/**
 * BibTeX `text` by citekey, as Pass 1 reads it: the CSL entries and the raw
 * fields. `pensmith ack` reads the bib the same way, so the work an
 * acknowledgement binds is the one Pass 1 matches it against.
 */
export async function parseBibForPass1(text: string): Promise<Bib> {
  return { entries: await parseBibByCitekey<BibEntry>(text), fields: await parseBibFieldsByCitekey(text) };
}

/**
 * The bibliography at `citationsBibPath` by citekey. A file with no entries
 * (research found nothing yet) is an empty library, not an error: every key a
 * draft cites is then FABRICATED.
 */
function readBib(citationsBibPath: string): Promise<Bib> {
  return parseBibForPass1(readFileSync(citationsBibPath, 'utf8'));
}

/** The text of .paper/CITATIONS.bib, or null when there is none. Throws when it cannot be read. */
export function readBibText(paperRoot: string): string | null {
  const bibPath = join(paperDir(paperRoot), 'CITATIONS.bib');
  return existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : null;
}

const RAW_WHAT: Readonly<Record<RawCitationKind, string>> = {
  'doi': 'a DOI typed as text',
  'arxiv': 'an arXiv ID typed as text',
  'pmid': 'a PubMed ID typed as text',
  'author-year': 'an author-year citation typed as text',
};

/**
 * Every key `draftMd` cites, in first-appearance order, in any Pandoc form:
 * clusters with prefixes and locators, `-@key`, and narrative `@key`.
 */
export function pass1CitedKeys(draftMd: string): string[] {
  return citedKeys(findCitations(draftMd));
}

/**
 * Pass-1 verdicts for a draft: one per cited key, then one per citation that
 * is not a Pandoc citation (typed as text, or a key that does not parse).
 * `bibOrPath` is the bibliography already read (parseBibForPass1), so the
 * verdicts are about the bytes the caller hashed, or the path of a
 * CITATIONS.bib to read. `opts.acknowledgements` are the section's, so an
 * acknowledged retraction reads the same to verify, compile's re-check and
 * anything else that asks.
 *
 * 100% deterministic — no LLM, no narration, no side effects beyond the
 * registry reads.
 */
export async function runPass1(
  draftMd: string,
  bibOrPath: Bib | string,
  opts: Pass1Options = {},
): Promise<Pass1Result[]> {
  const bib = typeof bibOrPath === 'string' ? await readBib(bibOrPath) : bibOrPath;
  const cites = findCitations(draftMd);
  const bracketed = new Set(citedKeys(cites.filter((c) => !c.narrative)));

  const results: Pass1Result[] = [];
  for (const ck of citedKeys(cites)) {
    const r = await verdictForCitekey(ck, bib.entries.get(ck), bib.fields.get(ck), opts);
    // `@word` in running text is a citation to Pandoc; when it was meant as
    // text (a handle), the fix is an escape, not a new source.
    if (r.verdict === 'FABRICATED' && !bib.entries.has(ck) && !bracketed.has(ck)) {
      r.reason += ` — if @${ck} is not a citation, write it as \\@${ck}`;
    }
    results.push(r);
  }
  // The row key for text that is not a citation is the text itself, on one
  // line: a draft wrapped mid-citation must still give a row compile reads.
  // `escape` says how to write text that only looks like a citation so the
  // verifier reads it as text.
  for (const raw of findRawCitations(draftMd, cites)) {
    const escape = raw.kind === 'author-year' ? 'write its bracket as \\(' : 'put it in backticks';
    results.push({
      citekey: oneLine(raw.raw), verdict: 'RAW_CITATION', titleJW: 0, authorJW: 0,
      reason: `${RAW_WHAT[raw.kind]}, which nothing checks — cite the work as [@key] from CITATIONS.bib ` +
        `(add it with \`pensmith add\` if it is missing); if it is not a citation, ${escape}`,
    });
  }
  for (const u of findUnparseableCitations(draftMd, cites)) {
    results.push({
      citekey: oneLine(u.raw), verdict: 'UNPARSEABLE', titleJW: 0, authorJW: 0,
      reason: 'a bracketed citation with no key that parses (a citekey starts right after @) — fix the key',
    });
  }
  return results;
}

/**
 * RSCH-10 source-freshness probe for a draft (D-10, WARN-only).
 *
 * SEPARATE from `runPass1` by design: this never feeds the blocking verdict
 * path. It reads the same cited keys out of the draft, resolves each
 * to its DOI in `entries` (the bibliography as the caller read it), and probes freshness (a DOI HEAD) advisory-only. A
 * stale DOI produces a WARN row; it can NEVER produce a blocking verdict
 * (PRD §14 / D-10). Retraction is checked by runPass1, and blocks.
 *
 * Returns one FreshnessResult per unique citekey, in draft-appearance order.
 */
export async function runFreshnessForDraft(
  draftMd: string,
  entries: ReadonlyMap<string, BibEntry>,
): Promise<FreshnessResult[]> {
  // The same keys runPass1 checks, so the advisory probe covers what the gate sees.
  return probeFreshnessAll(
    pass1CitedKeys(draftMd).map((ck) => ({ citekey: ck, doi: entries.get(ck)?.DOI ?? null })),
  );
}

/**
 * Fixture-shape helper for tests/known-bad-citations.test.ts: a synthetic
 * `{ claimed, actual }` pair with no HTTP, BibTeX or DRAFT.md. It applies the
 * same comparison as runPass1 (`actual: null` is a DOI no registry holds).
 */
export function runPass1Unit(input: {
  claimed: { title: string; authors: string[]; doi: string | null; retracted?: boolean };
  actual: { title: string; authors: string[]; doi: string | null } | null;
}): Omit<Pass1Result, 'citekey'> {
  const unit = (verdict: Pass1Verdict, reason: string, titleJW = 0, authorJW = 0) => ({ verdict, titleJW, authorJW, reason });
  if (!input.claimed.doi) return unit('UNRESOLVED', 'no identifier in the claimed citation to look the work up by');
  if (input.claimed.retracted) return unit('RETRACTED', 'cited a retracted work');
  if (!input.actual) return unit('FABRICATED', `DOI ${input.claimed.doi} is not registered`);
  const record: WorkRecord = {
    registry: 'Crossref',
    title: input.actual.title ?? '',
    authors: (input.actual.authors ?? []).map(nameFromDisplay),
    years: [],
    venues: [],
    journalArticle: false,
    raw: input.actual,
    ...(input.actual.doi ? { doi: input.actual.doi } : {}),
  };
  const m = matchWork({ title: input.claimed.title ?? '', authors: (input.claimed.authors ?? []).map(nameFromDisplay) }, record);
  return m.ok
    ? unit('OK', 'matches the record', m.titleScore, m.authorScore)
    : unit('MIS-CITED', m.problems.join('; '), m.titleScore, m.authorScore);
}
