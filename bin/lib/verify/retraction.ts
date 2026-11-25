// bin/lib/verify/retraction.ts — is a cited work retracted? Read from the
// record the registry already returned.
//
// Retraction detection used to ask a Crossref Labs route that answers every
// DOI with an error envelope, so it never found a retraction and Wakefield
// 1998 verified OK. The registries Pass 1 already asks carry the answer:
//
//   Crossref   `updated-by`: the notices that update the work, with Retraction
//              Watch's records among them (source "retraction-watch"). A
//              retraction, partial retraction, withdrawal or removal retracts
//              it; an expression of concern is a warning; a correction is
//              neither. A publisher that retracts "in place" turns the
//              article's own record into the notice: its `update-to` then
//              names its own DOI. An `update-to` naming another DOI means the
//              record IS the notice, and citing a notice is not citing
//              retracted work.
//   PubMed     the "Retracted Publication" publication type, and the
//              "Retraction in" / "Expression of concern in" links.
//   any        a title labelled "RETRACTED:", "RETRACTED ARTICLE:" or
//              "WITHDRAWN:", as Elsevier, Springer and others relabel the work.
//
// OpenAlex `is_retracted` is a cross-check Pass 1 asks for when the record
// says nothing (bin/lib/sources/openalex.ts lookupRetraction).

import { sameDoi } from '../doi.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import type { RegistryName, WorkRecord } from '../sources/work-record.js';
import { stripMarkup } from './work-match.js';

/** What a record says about the work's standing. */
export interface RetractionSignal {
  /** `retracted` blocks (unless acknowledged); `concern` warns. */
  kind: 'retracted' | 'concern';
  /** One clause for a verdict reason: "Retraction, 2010-02-06, notice 10.1016/…". */
  what: string;
  /** Who said so: a registry, or "OpenAlex". A reason reads "<what> (per <by>)". */
  by: RegistryName | 'OpenAlex';
}

// Crossref update types (https://www.crossref.org/documentation/crossmark/).
const RETRACTING_UPDATES: ReadonlySet<string> = new Set(['retraction', 'partial_retraction', 'withdrawal', 'removal']);
const CONCERN_UPDATES: ReadonlySet<string> = new Set(['expression_of_concern']);

// "RETRACTED: …", "Retracted Article: …", "WITHDRAWN: …", in any case, after
// any markup is stripped. A notice's own title ("Retraction: …", "Retraction
// notice to …") is not a label and does not match.
const LABEL = /^\s*(?:retracted|withdrawn)(?:\s+article)?\s*[:：]\s*/i;

/** `title` without a leading retraction label, so the label is not read as a title mismatch. */
export function withoutRetractionLabel(title: string): string {
  const plain = stripMarkup(title);
  return LABEL.test(plain) ? plain.replace(LABEL, '') : title;
}

function hasRetractionLabel(title: unknown): boolean {
  return typeof title === 'string' && LABEL.test(stripMarkup(title));
}

interface CrossrefUpdate {
  DOI?: unknown;
  type?: unknown;
  label?: unknown;
  source?: unknown;
  updated?: { 'date-time'?: unknown; 'date-parts'?: unknown };
}

/** "2010-02-06" from a Crossref update's `updated` date, when it has one. */
function updateDate(u: CrossrefUpdate): string | undefined {
  const dt = u.updated?.['date-time'];
  if (typeof dt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dt)) return dt.slice(0, 10);
  const parts = u.updated?.['date-parts'];
  if (Array.isArray(parts) && Array.isArray(parts[0])) {
    return (parts[0] as unknown[]).filter((p) => typeof p === 'number').map((p, i) => (i === 0 ? String(p) : String(p).padStart(2, '0'))).join('-') || undefined;
  }
  return undefined;
}

function describeUpdate(u: CrossrefUpdate, type: string): string {
  const label = typeof u.label === 'string' && u.label.trim() ? u.label.trim() : type.replace(/_/g, ' ');
  const parts = [label];
  const date = updateDate(u);
  if (date) parts.push(date);
  if (typeof u.DOI === 'string' && u.DOI) parts.push(`notice ${u.DOI}`);
  if (u.source === 'retraction-watch') parts.push('Retraction Watch record');
  return parts.join(', ');
}

const updates = (v: unknown): CrossrefUpdate[] =>
  Array.isArray(v) ? v.filter((u): u is CrossrefUpdate => !!u && typeof u === 'object') : [];

/**
 * The notices a Crossref-shaped record (a Crossref message, or CSL from
 * Crossref's content negotiation) lists about its own work.
 */
function crossrefSignals(raw: Record<string, unknown>, by: RegistryName): RetractionSignal[] {
  const out: RetractionSignal[] = [];
  const seen = new Set<string>();
  const add = (u: CrossrefUpdate): void => {
    const type = typeof u.type === 'string' ? u.type.toLowerCase() : '';
    const kind = RETRACTING_UPDATES.has(type) ? 'retracted' : CONCERN_UPDATES.has(type) ? 'concern' : null;
    if (!kind) return;
    const what = describeUpdate(u, type);
    // Crossref often lists one notice twice (from the publisher and from
    // Retraction Watch); say it once.
    const key = `${kind}|${type}|${String(u.DOI ?? '').toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, what, by });
  };
  for (const u of updates(raw['updated-by'])) add(u);
  // A notice on the work's own DOI: the publisher retracted it in place.
  const own = typeof raw['DOI'] === 'string' ? raw['DOI'] : '';
  for (const u of updates(raw['update-to'])) {
    if (own && typeof u.DOI === 'string' && sameDoi(u.DOI, own)) add(u);
  }
  return out;
}

/** A record whose `update-to` names another work: it is that work's notice. */
function isNoticeOfAnotherWork(raw: Record<string, unknown>): boolean {
  const own = typeof raw['DOI'] === 'string' ? raw['DOI'] : '';
  return updates(raw['update-to']).some((u) => typeof u.DOI === 'string' && !(own && sameDoi(u.DOI, own)));
}

interface PubmedReference { reftype?: unknown; refsource?: unknown }

function pubmedSignals(raw: Record<string, unknown>): RetractionSignal[] {
  const out: RetractionSignal[] = [];
  const types = Array.isArray(raw['pubtype']) ? raw['pubtype'].filter((t): t is string => typeof t === 'string') : [];
  const refs = Array.isArray(raw['references']) ? (raw['references'] as PubmedReference[]) : [];
  const linked = (reftype: string): string[] =>
    refs.filter((r) => r && r.reftype === reftype && typeof r.refsource === 'string').map((r) => String(r.refsource));
  if (types.includes('Retracted Publication')) {
    const notices = linked('Retraction in');
    out.push({
      kind: 'retracted',
      what: `a Retracted Publication${notices.length > 0 ? ` (retraction in ${notices.join('; ')})` : ''}`,
      by: 'PubMed',
    });
  }
  for (const n of linked('Expression of concern in')) {
    out.push({ kind: 'concern', what: `expression of concern in ${n}`, by: 'PubMed' });
  }
  return out;
}

/** A signal as a reason gives it: "<what> (per <by>)". */
export function describeSignal(s: RetractionSignal): string {
  return `${s.what} (per ${s.by})`;
}

/** What `record` itself says: notices it lists, its publication type, its title. */
export function recordRetraction(record: Pick<WorkRecord, 'registry' | 'title' | 'raw'>): RetractionSignal[] {
  const raw = record.raw && typeof record.raw === 'object' ? (record.raw as Record<string, unknown>) : {};
  const out = record.registry === 'PubMed' ? pubmedSignals(raw) : crossrefSignals(raw, record.registry);
  if (!out.some((s) => s.kind === 'retracted') && hasRetractionLabel(record.title) && !isNoticeOfAnotherWork(raw)) {
    out.push({ kind: 'retracted', what: `titled "${stripMarkup(record.title).trim()}"`, by: record.registry });
  }
  return out;
}

/** The registries whose records a research candidate keeps in `raw`. */
const CANDIDATE_REGISTRY: Partial<Record<SourceCandidate['source'], RegistryName>> = {
  crossref: 'Crossref',
  pubmed: 'PubMed',
};

/**
 * Whether a research candidate is retracted, from its own record and title:
 * the reason when it is, else null. No request is made.
 */
export function candidateRetraction(c: SourceCandidate): string | null {
  const raw = c.raw && typeof c.raw === 'object' ? (c.raw as Record<string, unknown>) : {};
  if (c.source === 'openalex' && raw['is_retracted'] === true) return 'OpenAlex lists it as retracted';
  const registry = CANDIDATE_REGISTRY[c.source];
  if (registry) {
    const hit = recordRetraction({ registry, title: c.title, raw }).find((s) => s.kind === 'retracted');
    return hit ? describeSignal(hit) : null;
  }
  return hasRetractionLabel(c.title) ? `titled "${stripMarkup(c.title).trim()}"` : null;
}
