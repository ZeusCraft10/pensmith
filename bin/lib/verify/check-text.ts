// bin/lib/verify/check-text.ts — the blocking passes, run on one text.
//
// verify, compile's re-check of a section edited since verify, and done's
// re-check of the exact text it exports all run the same two deterministic
// passes: Pass 1 (each citation against its registries) and Pass 3 (each
// quotation word for word in its open-access source). No model is involved.

import { runPass1, type Bib, type Pass1Result } from './pass1.js';
import { runPass3, type Pass3Result } from './pass3.js';
import type { Acknowledgement } from './acknowledgements.js';

export interface CheckedText {
  pass1: Pass1Result[];
  pass3: Pass3Result[];
}

export interface CheckTextOptions {
  /** The bibliography, read once by the caller (parseBibForPass1). */
  bib: Bib;
  acknowledgements?: readonly Acknowledgement[];
  section?: number;
  /** False when the caller has already run Pass 3 on this exact text. */
  pass3?: boolean;
}

export async function checkCitationsAndQuotes(text: string, opts: CheckTextOptions): Promise<CheckedText> {
  const pass1 = await runPass1(text, opts.bib, {
    ...(opts.acknowledgements ? { acknowledgements: opts.acknowledgements } : {}),
    ...(opts.section !== undefined ? { section: opts.section } : {}),
  });
  const pass3 = opts.pass3 === false
    ? []
    : await runPass3(text, opts.bib.entries, opts.bib.fields);
  return { pass1, pass3 };
}
