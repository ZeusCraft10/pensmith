// bin/lib/verify/acknowledgements.ts — the verdicts an author has acknowledged
// in one section.
//
// A RETRACTED citation blocks compile and export. A paper can still have a
// reason to cite the work: it may be about the retraction, or discuss why the
// work was withdrawn. `pensmith ack <N> <citekey> --reason "<text>"` records
// that decision in the section's folder (ACKNOWLEDGEMENTS.json), bound to the
// citekey and to the work itself: the SHA-256 of `doi:<DOI>` (or, for an entry
// with no DOI, of its first other identifier, `pmid:<n>` and so on). Pass 1
// then gives that citation RETRACTED_ACKNOWLEDGED, which compile and done pass
// with a warning. The same key in another section, or the key pointed at
// another work, needs an acknowledgement of its own. Nothing else, and never
// --yolo, acknowledges a verdict.
//
// `kind` leaves room for other verdicts an author may acknowledge.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteFile } from '../atomic-write.js';
import { workIdentifiers } from './resolve.js';

const AcknowledgementSchema = z.object({
  kind: z.literal('retracted'),
  citekey: z.string().min(1),
  /** The work acknowledged: `doi:<normalized DOI>`, or `pmid:`, `arxiv:`, `isbn:` and the identifier. */
  work: z.string().min(1),
  /** SHA-256 (hex) of `work`; the binding Pass 1 checks. */
  work_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** The author's reason, in their words. */
  reason: z.string().trim().min(1),
  /** ISO 8601. */
  acknowledged_at: z.string().min(1),
});
export type Acknowledgement = z.infer<typeof AcknowledgementSchema>;

const AcknowledgementsFileSchema = z.object({
  $schemaVersion: z.literal(1),
  acknowledgements: z.array(AcknowledgementSchema),
});

export interface WorkBinding {
  work: string;
  sha256: string;
}

/**
 * The work a bibliography entry names, as an acknowledgement binds it: its
 * first identifier that parses, most reliable first (DOI, arXiv ID, PMID,
 * ISBN). Null when it has none.
 */
export function workBinding(csl: Record<string, unknown>, fields: Record<string, string> = {}): WorkBinding | null {
  const id = workIdentifiers(csl, fields).find((i) => i.value !== null);
  if (!id?.value) return null;
  const work = `${id.kind}:${id.value}`;
  return { work, sha256: createHash('sha256').update(work).digest('hex') };
}

/**
 * The acknowledgements recorded at `file`. A missing file holds none. A file
 * that does not parse is `unreadable` and holds none either: an
 * acknowledgement only ever lifts a block, so an unreadable one lifts nothing.
 */
export function readAcknowledgements(file: string): { acknowledgements: Acknowledgement[]; unreadable: boolean } {
  if (!existsSync(file)) return { acknowledgements: [], unreadable: false };
  try {
    const parsed = AcknowledgementsFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? { acknowledgements: parsed.data.acknowledgements, unreadable: false } : { acknowledgements: [], unreadable: true };
  } catch {
    return { acknowledgements: [], unreadable: true };
  }
}

/** The acknowledgement of a retraction of `binding` cited as `citekey`, if one is recorded. */
export function findRetractionAck(
  acks: readonly Acknowledgement[],
  citekey: string,
  binding: WorkBinding | null,
): Acknowledgement | undefined {
  if (!binding) return undefined;
  return acks.find((a) => a.kind === 'retracted' && a.citekey === citekey && a.work_sha256 === binding.sha256);
}

/**
 * Record `ack` in `file`, replacing an earlier acknowledgement of the same
 * kind, citekey and work. The caller has checked the file is readable.
 */
export async function recordAcknowledgement(file: string, ack: Acknowledgement): Promise<void> {
  const kept = readAcknowledgements(file).acknowledgements.filter(
    (a) => !(a.kind === ack.kind && a.citekey === ack.citekey && a.work_sha256 === ack.work_sha256),
  );
  const body = { $schemaVersion: 1 as const, acknowledgements: [...kept, ack] };
  await atomicWriteFile(file, `${JSON.stringify(body, null, 2)}\n`);
}
