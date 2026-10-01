// bin/lib/detector-consent.ts — the user's answer to "send the full paper to
// the AI detector?" (EXP-17, S-14; Phase 21 review round 1).
//
// The honesty check sends the WHOLE paper to a third party (GPTZero,
// Originality.ai or Sapling) with the reader's own API key. `.paper/config.toml`
// travels with a paper — a synced folder, a co-author's copy, a template — so a
// paper file may NAME a detector (`[humanizer] honesty_backend`) but never
// consent for the person running pensmith: the same rule own-source-approvals.ts
// applies to the reader's PDFs and Zotero collections. So:
//
//   - the answer to the `detector-consent` gate is recorded HERE, in the
//     pensmith data dir (paths.ts pensmithDetectorConsentPath), keyed by the
//     real path of the project root AND the detector — a yes for GPTZero is
//     not a yes for Sapling, and a copied paper is a different paper;
//   - config.toml's `[humanizer] honesty_consent = false` stays an opt-out a
//     paper may carry (never send); `true` there grants nothing.
//
// A missing, unreadable or invalid file records nothing (fail closed: the
// user is asked again). Recording an answer never destroys the file: it is
// read through the versioned loader, and a file written by a newer pensmith,
// or one that does not parse, is left as it is (the answer then applies to
// this run only, and the caller says so).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { pensmithDetectorConsentPath } from './paths.js';
import { loadAndMigrate, ForwardIncompatError, SchemaValidationError } from './migrations/loader.js';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';
import { paperApprovalKey } from './own-source-approvals.js';
import { HONESTY_BACKENDS } from './schemas/config.js';

export const CURRENT_DETECTOR_CONSENT_VERSION = 1;

const BackendEnum = z.enum(HONESTY_BACKENDS);

export const DetectorConsentSchema = z
  .object({
    $schemaVersion: z.literal(CURRENT_DETECTOR_CONSENT_VERSION),
    /** Per paper (the project root's real path): per detector, the user's answer. */
    papers: z.record(z.string().min(1), z.record(BackendEnum, z.boolean())).default({}),
  })
  .strict();

export type DetectorConsentFile = z.infer<typeof DetectorConsentSchema>;
export type DetectorName = (typeof HONESTY_BACKENDS)[number];

function empty(): DetectorConsentFile {
  return { $schemaVersion: CURRENT_DETECTOR_CONSENT_VERSION, papers: {} };
}

function readFile(file: string): DetectorConsentFile {
  try {
    const parsed = DetectorConsentSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : empty();
  } catch {
    return empty();
  }
}

/** The user's recorded answer for the paper at `root` and `backend`: true, false, or undefined (never asked here). Never throws. */
export function recordedDetectorConsent(root: string, backend: DetectorName): boolean | undefined {
  return readFile(pensmithDetectorConsentPath()).papers[paperApprovalKey(root)]?.[backend];
}

/** A consent file this pensmith must not overwrite (newer, or damaged): nothing was changed. */
export class DetectorConsentUnwritableError extends PensmithError {
  constructor(file: string, why: string) {
    super(`${file}: ${why} — your answer was not recorded and the file was left as it is (upgrade pensmith, or move the file aside)`, EXIT_ERROR);
    this.name = 'DetectorConsentUnwritableError';
  }
}

/** Record the user's answer for the paper at `root` and `backend` (the detector-consent gate, or a Tier-1 question). */
export async function recordDetectorConsent(root: string, backend: DetectorName, yes: boolean): Promise<void> {
  const file = pensmithDetectorConsentPath();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await withLock(file, async () => {
    let all = empty();
    if (fs.existsSync(file)) {
      try {
        all = await loadAndMigrate({ file, schema: DetectorConsentSchema, schemaName: 'detector-consent', currentVersion: CURRENT_DETECTOR_CONSENT_VERSION });
      } catch (e) {
        if (e instanceof ForwardIncompatError) throw new DetectorConsentUnwritableError(file, `written by a newer pensmith (v${e.diskVersion}; this one writes v${e.codeVersion})`);
        const why = e instanceof SchemaValidationError ? 'not a valid consent file' : e instanceof SyntaxError ? 'not valid JSON' : `unreadable (${(e as Error).message.split(/\r?\n/)[0] ?? 'error'})`;
        throw new DetectorConsentUnwritableError(file, why);
      }
    }
    const key = paperApprovalKey(root);
    all.papers[key] = { ...(all.papers[key] ?? {}), [backend]: yes };
    await atomicWriteFile(file, `${JSON.stringify(all, null, 2)}\n`);
  });
}
