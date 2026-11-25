// tests/lib/verification-fixture.ts — a section's recorded verdicts, as
// `pensmith verify` would leave them, for fixtures that seed a paper by hand.
//
// compile and done gate on VERIFICATION.json, so a fixture that stands in for
// a verify run writes the record through the production builder and renders
// VERIFICATION.md from it, exactly as verify does.
//
// Not a test file (the runner collects only *.test.ts).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bibEntryHashes,
  buildVerificationRecord,
  renderVerificationMd,
  sha256,
  type VerificationRecord,
  type VerificationStatus,
} from '../../bin/lib/verify/verification-record.js';
import { parseBibForPass1, pass1CitedKeys, type Pass1Result, type Pass1Verdict } from '../../bin/lib/verify/pass1.js';
import type { Pass3Result, Pass3Verdict } from '../../bin/lib/verify/pass3.js';
import { writeCompileManifest } from '../../bin/lib/compile-manifest.js';

export interface CitationSpec {
  citekey: string;
  verdict: Pass1Verdict;
  reason?: string;
}

export interface QuoteSpec {
  citekey: string;
  quote: string;
  verdict: Pass3Verdict;
  reason?: string;
}

export interface VerificationSpec {
  n: number;
  slug: string;
  /** The DRAFT.md the verdicts are about. */
  draft: string | Buffer;
  assignedSources?: string[];
  /** Defaults to what the verdicts give: failed with a blocking verdict, else verified. */
  status?: VerificationStatus;
  /** False for a refusal record (verify stopped before checking). */
  checked?: boolean;
  reason?: string;
  /** Defaults to OK for every key the draft cites. */
  citations?: CitationSpec[];
  quotes?: QuoteSpec[];
  /** Cited key → CITATIONS.bib entry hash (fixtureBibHashes); none recorded by default. */
  bibEntries?: Record<string, string | null>;
  acknowledgementsSha256?: string | null;
  /** The advisory sections VERIFICATION.md shows (freshness, Pass 2, Pass 4). */
  advisoryMarkdown?: string;
}

const BLOCKING = new Set(['FABRICATED', 'MIS-CITED', 'NOT_FOUND', 'RETRACTED', 'UNRESOLVED', 'RAW_CITATION', 'UNPARSEABLE']);

/** The record `spec` describes, built by the production builder. */
export function verificationRecord(spec: VerificationSpec): VerificationRecord {
  const draftBytes = Buffer.isBuffer(spec.draft) ? spec.draft : Buffer.from(spec.draft, 'utf8');
  const citations: CitationSpec[] = spec.citations ?? pass1CitedKeys(draftBytes.toString('utf8')).map((citekey) => ({ citekey, verdict: 'OK' }));
  const quotes = spec.quotes ?? [];
  const pass1: Pass1Result[] = citations.map((c) => ({
    citekey: c.citekey, verdict: c.verdict, titleJW: c.verdict === 'OK' ? 1 : 0, authorJW: c.verdict === 'OK' ? 1 : 0, reason: c.reason ?? 'fixture',
  }));
  const pass3: Pass3Result[] = quotes.map((q) => ({
    citekey: q.citekey, quoteSnippet: q.quote.slice(0, 40), verdict: q.verdict, levRatio: q.verdict === 'OK' ? 1 : 0, reason: q.reason ?? 'fixture',
  }));
  const blocking = [...citations, ...quotes].some((v) => BLOCKING.has(v.verdict));
  return buildVerificationRecord({
    section: spec.n,
    slug: spec.slug,
    status: spec.status ?? (blocking ? 'failed' : 'verified'),
    checked: spec.checked ?? true,
    ...(spec.reason ? { reason: spec.reason } : {}),
    draftBytes,
    assignedSources: spec.assignedSources ?? [],
    bibEntries: spec.bibEntries ?? {},
    acknowledgementsSha256: spec.acknowledgementsSha256 ?? null,
    pass1,
    pass3,
    ...(spec.advisoryMarkdown !== undefined ? { advisoryMarkdown: spec.advisoryMarkdown } : {}),
  });
}

/** Write `spec`'s record into the section folder `dir`: VERIFICATION.json and the VERIFICATION.md rendered from it. */
export function writeVerificationFixture(dir: string, spec: VerificationSpec): VerificationRecord {
  const record = verificationRecord(spec);
  writeFileSync(join(dir, 'VERIFICATION.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(dir, 'VERIFICATION.md'), renderVerificationMd(record));
  return record;
}

/** The CITATIONS.bib entry hash of each key `draft` cites, as verify records them. */
export async function fixtureBibHashes(bibText: string, draft: string): Promise<Record<string, string | null>> {
  return bibEntryHashes(pass1CitedKeys(draft), await parseBibForPass1(bibText));
}

/**
 * Write .paper/COMPILE-MANIFEST.json for the files as they are now, as compile
 * does after writing .paper/DRAFT.md: the hashes of the compiled draft, of each
 * section's DRAFT.md and VERIFICATION.json, and of each cited bibliography entry.
 */
export async function writeCompileManifestFixture(paperRoot: string, sections: ReadonlyArray<{ n: number; slug: string }>): Promise<void> {
  const paper = join(paperRoot, '.paper');
  const compiled = readFileSync(join(paper, 'DRAFT.md'));
  const bibPath = join(paper, 'CITATIONS.bib');
  const bib = await parseBibForPass1(existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : '');
  const bibEntries: Record<string, string> = {};
  for (const [key, hash] of Object.entries(bibEntryHashes(pass1CitedKeys(compiled.toString('utf8')), bib))) {
    if (hash !== null) bibEntries[key] = hash;
  }
  await writeCompileManifest(paperRoot, {
    $schemaVersion: 1,
    compiled_at: new Date().toISOString(),
    draft_sha256: sha256(compiled),
    sections: sections.map((s) => {
      const dir = join(paper, 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
      return {
        n: s.n,
        slug: s.slug,
        draft_sha256: sha256(readFileSync(join(dir, 'DRAFT.md'))),
        verification_sha256: sha256(readFileSync(join(dir, 'VERIFICATION.json'))),
        re_verified: false,
      };
    }),
    bib_entries: bibEntries,
  });
}
