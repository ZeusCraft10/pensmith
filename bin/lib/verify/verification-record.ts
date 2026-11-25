// bin/lib/verify/verification-record.ts — a section's verdicts as data.
//
// `pensmith verify <n>` records what it found in the section's
// VERIFICATION.json, and compile and done gate on that record, never on the
// Markdown report: VERIFICATION.md is rendered from the record for people to
// read, so rewording or reformatting it changes nothing a gate decides.
//
// The record says what the verdicts are about, so a gate can tell whether
// they still apply:
//   - draft_sha256 / draft_hash: the DRAFT.md bytes verify read (once) and
//     checked, alone and with the section's assigned sources (the hash PLAN.md
//     keeps as verified_against_draft_hash);
//   - bib_entries: a hash of each cited CITATIONS.bib entry, as verify read it;
//   - acknowledgements_sha256: the section's ACKNOWLEDGEMENTS.json;
//   - verifier_version and network_mode: which verifier ran, and whether it
//     could reach the registries.
// A record with `checked: false` is a refusal: verify stopped before any pass
// ran, and `reason` says why. It never lets a section through.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteFile } from '../atomic-write.js';
import { networkMode } from '../network-mode.js';
import { VERSION } from '../version.generated.js';
import { computeDraftHash } from '../draft-hash.js';
import type { Bib, Pass1Result, Pass1Verdict } from './pass1.js';
import type { Pass3Result, Pass3Verdict } from './pass3.js';
import {
  blockingReasons,
  citationWarnings,
  isBlockingVerdict,
  renderPass1VerdictRow,
  renderPass3VerdictRow,
  unattributedWarning,
  uncheckedQuoteWarning,
} from './verdict-rows.js';

/** A SHA-256, in lowercase hex. */
export const HEX64 = z.string().regex(/^[0-9a-f]{64}$/);

const PASS1_VERDICTS = [
  'OK', 'MIS-CITED', 'FABRICATED', 'UNRESOLVED', 'RAW_CITATION', 'UNPARSEABLE',
  'RETRACTED', 'RETRACTED_ACKNOWLEDGED', 'EXPRESSION_OF_CONCERN',
] as const satisfies readonly Pass1Verdict[];
const PASS3_VERDICTS = [
  'OK', 'NOT_FOUND', 'PDF_UNAVAILABLE', 'TEXT_UNAVAILABLE', 'UNATTRIBUTED',
] as const satisfies readonly Pass3Verdict[];

const CitationVerdictSchema = z.object({
  /** The citekey, or for RAW_CITATION / UNPARSEABLE the text the verdict is about. */
  citekey: z.string(),
  verdict: z.enum(PASS1_VERDICTS),
  reason: z.string(),
  /** How well the entry's title and authors matched the registry's record (0..1). */
  title_score: z.number().min(0).max(1),
  author_score: z.number().min(0).max(1),
}).strict();

const QuoteVerdictSchema = z.object({
  /** The first 12 hex digits of the SHA-256 of the quotation's text. */
  quote_id: z.string().min(1),
  /** The work the quotation was checked against, or NO_CITATION_KEY. */
  citekey: z.string(),
  /** The start of the quotation, for people to find it. */
  quote: z.string(),
  verdict: z.enum(PASS3_VERDICTS),
  reason: z.string(),
}).strict();

export const VerificationRecordSchema = z.object({
  $schemaVersion: z.literal(1),
  section: z.number().int().min(1),
  slug: z.string().min(1),
  status: z.enum(['verified', 'failed', 'unverifiable']),
  /** False when verify refused before checking anything. */
  checked: z.boolean(),
  /** Why the section has this status, when the verdicts alone do not say. */
  reason: z.string().optional(),
  verifier_version: z.string().min(1),
  network_mode: z.enum(['live', 'cassette', 'offline']),
  verified_at: z.string().min(1),
  draft_sha256: HEX64.nullable(),
  draft_hash: HEX64.nullable(),
  assigned_sources: z.array(z.string()),
  /** Each key the draft cites → the hash of its CITATIONS.bib entry, or null when it has none. */
  bib_entries: z.record(z.string(), HEX64.nullable()),
  acknowledgements_sha256: HEX64.nullable(),
  citations: z.array(CitationVerdictSchema),
  quotes: z.array(QuoteVerdictSchema),
  /** The advisory sections (freshness, Pass 2, Pass 4) as rendered; nothing gates on them. */
  advisory_markdown: z.string(),
}).strict();

export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;
export type VerificationStatus = VerificationRecord['status'];

export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/** `value` as JSON with every object's keys sorted, so equal data always hashes the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The hash of each of `keys`' CITATIONS.bib entry, as Pass 1 reads it: the
 * CSL fields and the raw BibTeX fields CSL has no slot for. Null for a key
 * with no entry. citation-js's `_graph` holds the whole file, so it is left
 * out: an entry's hash changes only when that entry does.
 */
export function bibEntryHashes(keys: Iterable<string>, bib: Bib): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of keys) {
    const entry = bib.entries.get(key);
    if (!entry) {
      out[key] = null;
      continue;
    }
    const csl = Object.fromEntries(Object.entries(entry).filter(([k]) => !k.startsWith('_')));
    out[key] = sha256(canonicalJson({ csl, fields: bib.fields.get(key) ?? {} }));
  }
  return out;
}

/** The id of a quotation: the start of the SHA-256 of its text. */
export function quoteId(text: string): string {
  return sha256(text).slice(0, 12);
}

/** The facts a section's status is decided from, and the decision. */
export interface StatusInput {
  section: number;
  pass1: readonly Pass1Result[];
  pass3: readonly Pass3Result[];
  /** The keys the draft cites (pass1CitedKeys). */
  citedKeys: readonly string[];
  assignedSources: readonly string[];
  bibIsEmpty: boolean;
}

export interface StatusDecision {
  status: VerificationStatus;
  reason?: string;
  /** Quotations whose source text could not be read. */
  sourceTextMissing: boolean;
  /** Quotations that cite nothing. */
  unattributed: number;
  /** Nothing cited, nothing quoted, and an empty library. */
  nothingToCheck: boolean;
}

/**
 * A section's status from its verdicts. Any blocking verdict fails it. A
 * draft that cites none of the sources its plan assigns fails too: none of
 * its claims was checked against what it was meant to rest on. A quotation
 * nothing could check (no source text, or no citation) leaves it
 * unverifiable, as does a draft citing nothing against an empty library.
 * Otherwise it is verified.
 */
export function decideStatus(input: StatusInput): StatusDecision {
  const hasFail = [...input.pass1, ...input.pass3].some((r) => isBlockingVerdict(r.verdict));
  const sourceTextMissing = input.pass3.some((r) => UNCHECKED_QUOTE.has(r.verdict));
  const unattributed = input.pass3.filter((r) => r.verdict === 'UNATTRIBUTED').length;
  const uncited = input.citedKeys.length === 0 && input.assignedSources.length > 0;
  const nothingToCheck = input.bibIsEmpty && input.pass1.length === 0 && input.pass3.length === 0;
  const status: VerificationStatus = hasFail || uncited
    ? 'failed'
    : (sourceTextMissing || unattributed > 0 || nothingToCheck ? 'unverifiable' : 'verified');
  const decision: StatusDecision = { status, sourceTextMissing, unattributed, nothingToCheck };
  if (uncited) {
    decision.reason =
      `the draft cites none of its assigned sources (${input.assignedSources.join(', ')}), so none of its claims was checked — ` +
      `redraft it with citations (\`pensmith write ${input.section}\`), or empty assigned_sources in PLAN.md if the section needs none`;
  }
  return decision;
}

export interface VerificationInput {
  section: number;
  slug: string;
  status: VerificationStatus;
  checked: boolean;
  reason?: string;
  /** The DRAFT.md bytes the verdicts are about, or null when there was no draft to read. */
  draftBytes: Buffer | null;
  assignedSources: readonly string[];
  bibEntries?: Record<string, string | null>;
  acknowledgementsSha256?: string | null;
  pass1?: readonly Pass1Result[];
  pass3?: readonly Pass3Result[];
  advisoryMarkdown?: string;
}

/** A schema-valid record of one verify run. */
export function buildVerificationRecord(input: VerificationInput): VerificationRecord {
  const clamp = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
  return VerificationRecordSchema.parse({
    $schemaVersion: 1,
    section: input.section,
    slug: input.slug,
    status: input.status,
    checked: input.checked,
    ...(input.reason ? { reason: input.reason } : {}),
    verifier_version: VERSION,
    network_mode: networkMode(),
    verified_at: new Date().toISOString(),
    draft_sha256: input.draftBytes ? sha256(input.draftBytes) : null,
    draft_hash: input.draftBytes && input.checked ? computeDraftHash(input.draftBytes, [...input.assignedSources]) : null,
    assigned_sources: [...input.assignedSources],
    bib_entries: input.bibEntries ?? {},
    acknowledgements_sha256: input.acknowledgementsSha256 ?? null,
    citations: (input.pass1 ?? []).map((r) => ({
      citekey: r.citekey, verdict: r.verdict, reason: r.reason, title_score: clamp(r.titleJW), author_score: clamp(r.authorJW),
    })),
    quotes: (input.pass3 ?? []).map((r) => ({
      quote_id: r.quoteId, citekey: r.citekey, quote: r.quoteSnippet, verdict: r.verdict, reason: r.reason,
    })),
    advisory_markdown: input.advisoryMarkdown ?? '',
  });
}

/** VERIFICATION.md, rendered from the record. */
export function renderVerificationMd(r: VerificationRecord): string {
  const head = `# VERIFICATION (Section ${r.section}, ${r.slug})`;
  if (!r.checked) return `${head}\n\nStatus: ${r.status}\nReason: ${r.reason ?? ''}\n`;
  return [
    head,
    '',
    `Status: ${r.status}`,
    ...(r.reason ? [`Reason: ${r.reason}`] : []),
    '',
    '## Pass-1 (citation integrity, deterministic)',
    '',
    ...r.citations.map((c) => renderPass1VerdictRow(c.citekey, c.verdict, c.title_score, c.author_score, c.reason)),
    '',
    '## Pass-3 (quote integrity, deterministic — word for word)',
    '',
    ...r.quotes.map((q) => renderPass3VerdictRow(q.citekey, q.quote, q.verdict, q.verdict === 'OK' ? 1 : 0, q.reason)),
    '',
    r.advisory_markdown,
    '',
  ].join('\n');
}

/**
 * Write the record to `jsonPath` and the report rendered from it to `mdPath`.
 * The record goes first: it is what the gates read.
 */
export async function writeVerification(jsonPath: string, mdPath: string, record: VerificationRecord): Promise<void> {
  await atomicWriteFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
  await atomicWriteFile(mdPath, renderVerificationMd(record));
}

export type ReadVerification =
  | { ok: true; record: VerificationRecord; sha256: string }
  | { ok: false; problem: 'missing' | 'unreadable'; detail: string };

/** The record at `jsonPath`, with the hash of its bytes. Never throws. */
export function readVerificationRecord(jsonPath: string): ReadVerification {
  if (!existsSync(jsonPath)) return { ok: false, problem: 'missing', detail: 'no VERIFICATION.json' };
  let bytes: Buffer;
  try {
    bytes = readFileSync(jsonPath);
  } catch (err) {
    return { ok: false, problem: 'unreadable', detail: (err as NodeJS.ErrnoException).code ?? String(err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { ok: false, problem: 'unreadable', detail: 'VERIFICATION.json is not JSON' };
  }
  const result = VerificationRecordSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return { ok: false, problem: 'unreadable', detail: `VERIFICATION.json does not match its schema (${first?.path.join('.') || 'record'}: ${first?.message ?? 'invalid'})` };
  }
  return { ok: true, record: result.data, sha256: sha256(bytes) };
}

/** Quote verdicts that mean the quotation could not be checked against its source. */
export const UNCHECKED_QUOTE: ReadonlySet<string> = new Set<string>(['PDF_UNAVAILABLE', 'TEXT_UNAVAILABLE']);

/**
 * The record as compile and done gate it: a refusal reason for a section verify
 * did not pass (not checked, failed, or any blocking verdict, whatever the
 * status says), and a warning for each thing that passes but must not look
 * clean. `where` names the section.
 */
export function verificationGate(record: VerificationRecord, where: string): { reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  if (!record.checked) {
    reasons.push(`${where}: not verified — ${record.reason ?? 'verify did not check it'}`);
  } else if (record.status === 'failed') {
    reasons.push(`${where}: verify failed this section${record.reason ? ` — ${record.reason}` : ''}`);
  }
  reasons.push(...blockingReasons([...record.citations, ...record.quotes], where));
  const warnings = citationWarnings(record.citations, where);
  const unattributed = record.quotes.filter((q) => q.verdict === 'UNATTRIBUTED').length;
  if (unattributed > 0) warnings.push(unattributedWarning(where, unattributed));
  const unchecked = record.quotes.filter((q) => UNCHECKED_QUOTE.has(q.verdict)).length;
  if (unchecked > 0) warnings.push(uncheckedQuoteWarning(where, unchecked));
  return { reasons, warnings };
}

/** What the record's verdicts are compared against: the section as it is now. */
export interface SectionNow {
  draftBytes: Buffer;
  assignedSources: readonly string[];
  bib: Bib;
  acknowledgementsSha256: string | null;
}

/**
 * Why the record's verdicts no longer describe the section: its draft or
 * assigned sources, a cited CITATIONS.bib entry, or its acknowledgements
 * changed since verify. Empty when they still apply.
 */
export function verificationStaleness(record: VerificationRecord, now: SectionNow): string[] {
  const draftNow = sha256(now.draftBytes);
  if (record.draft_sha256 !== draftNow) {
    return [`DRAFT.md changed since verify (${(record.draft_sha256 ?? 'none').slice(0, 12)} → ${draftNow.slice(0, 12)})`];
  }
  const sorted = (sources: readonly string[]): string => JSON.stringify([...sources].sort());
  if (sorted(record.assigned_sources) !== sorted(now.assignedSources)) return ["PLAN.md's assigned sources changed since verify"];
  const why: string[] = [];
  const current = bibEntryHashes(Object.keys(record.bib_entries), now.bib);
  for (const [key, hash] of Object.entries(record.bib_entries)) {
    if (current[key] !== hash) why.push(`the CITATIONS.bib entry for [@${key}] changed since verify`);
  }
  if (record.acknowledgements_sha256 !== now.acknowledgementsSha256) why.push('ACKNOWLEDGEMENTS.json changed since verify');
  return why;
}
