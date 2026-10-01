// bin/lib/rewritten-claims.ts — claim support (Pass 2, advisory) for the cited
// sentences a rewrite changed (Phase 21 review round 3; VRFY-22, EXP-14).
//
// The humanizer rewrites verified prose. The rewrite guard (rewrite-guard.ts)
// keeps every citation on its claim on positive structural evidence — no
// moved, swapped or negated claim — but whether a REWORDED claim still says
// what its source supports is a judgment, the one Pass 2 makes. done
// therefore judges every (citing sentence, key) pair of the text it is about
// to export that the compiled draft does not hold — exactly the cited
// sentences the rewrite changed — and its confirmation lists the UNSUPPORTED
// ones in place of the section records' verdicts on the sentences they
// replaced. A section record's claim whose sentence the rewrite left
// unchanged (or that cannot be matched to a compiled sentence) is kept.
//
// Advisory, like Pass 2 (VRFY-07): it never blocks; the `unsupported-claims`
// gate decides and `.paper/VERIFICATION.md` records each decision. Only done
// imports this module (it reaches the model transport through Pass 2).

import { claimPairs } from './verify/draft-text.js';
import { runPass2, pass2SentenceCell } from './verify/pass2.js';
import { sourceTextPassage } from './verify/source-text.js';
import { assertLlmConfigured } from './anthropic.js';
import { tryReadPaperConfigSync } from './config.js';
import type { UnsupportedClaim, DoneSection } from './done-gate.js';
import type { LoadedBibliography } from './verify/gate.js';

/** What re-judging a rewrite found. */
export interface RewrittenClaims {
  /** The claims to confirm: the section records' claims still standing, then the rewrite's UNSUPPORTED pairs. */
  readonly claims: UnsupportedClaim[];
  /** How many changed (citing sentence, key) pairs Pass 2 judged. */
  readonly changedPairs: number;
  /** How many section-record claims the rewrite replaced (their sentence changed). */
  readonly replaced: number;
}

const pairId = (p: { readonly citekey: string; readonly claimSentence: string }): string => `${p.citekey}\u0000${p.claimSentence}`;

/** The section id of the `##` section of `text` that holds `offset` (sectionIds in the draft's `##` order), else ''. */
function sectionAt(text: string, offset: number, sectionIds: readonly string[]): string {
  if (offset < 0) return '';
  const before = text.slice(0, offset).replace(/\r\n/g, '\n');
  const headings = before.split('\n').filter((l) => /^## (?!#)/.test(l)).length;
  return headings > 0 ? (sectionIds[headings - 1] ?? '') : '';
}

/**
 * Re-judge the claims of `text` (the humanized text done is about to export)
 * against `compiled` (the gated compiled draft): see the header. The session
 * cost cap and an invalid runtime configuration propagate (Pass 2 rethrows
 * them); with no model configured the changed pairs are not judged (UNCLEAR)
 * and the section claims they replaced are kept.
 */
export async function rejudgeRewrittenClaims(input: {
  readonly paperRoot: string;
  readonly compiled: string;
  readonly text: string;
  /** The section records' UNSUPPORTED claims (done-gate.ts readUnsupportedClaims). */
  readonly claims: readonly UnsupportedClaim[];
  readonly bib: LoadedBibliography;
  readonly sections: readonly DoneSection[];
  /** The section ids in the draft's `##` order. */
  readonly sectionIds: readonly string[];
}): Promise<RewrittenClaims> {
  if (input.text === input.compiled) return { claims: [...input.claims], changedPairs: 0, replaced: 0 };
  const compiledPairs = claimPairs(input.compiled);
  const compiledIds = new Set(compiledPairs.map(pairId));
  const textIds = new Set(claimPairs(input.text).map(pairId));
  const changed = [...textIds].filter((id) => !compiledIds.has(id));
  if (changed.length === 0) return { claims: [...input.claims], changedPairs: 0, replaced: 0 };

  type BibValue = { DOI?: string; title?: string | string[]; author?: Array<{ family?: string; given?: string }> | string[]; abstract?: string };
  const bibByCitekey = new Map<string, BibValue>(input.bib.entries.map((e) => [String(e['id'] ?? ''), e as BibValue]));
  const modelReady = await assertLlmConfigured('done').then(
    () => true,
    () => false,
  );
  const shareByoPassages = tryReadPaperConfigSync(input.paperRoot)?.verification?.send_byo_passages === true;
  const results = await runPass2(input.text, bibByCitekey, {
    n: 0,
    root: input.paperRoot,
    shareByoPassages,
    only: (p) => !compiledIds.has(pairId(p)),
    ...(modelReady ? { fullText: (key: string, claim: string) => sourceTextPassage(input.paperRoot, key, claim) } : {}),
  });
  const judged = results.filter((r) => r.verdict !== 'UNCLEAR' || !/no claim-support judgment was made|LLM error/.test(r.rationale));

  // A section claim is replaced only when it matches a compiled sentence the
  // rewrite changed AND that sentence's rewrite was judged; otherwise it stands.
  const judgedFully = judged.length === results.length;
  let replaced = 0;
  const kept = input.claims.filter((c) => {
    const from = compiledPairs.filter((p) => p.citekey === c.result.citekey && pass2SentenceCell(p.claimSentence) === c.result.claimSentence);
    if (from.length === 0 || from.some((p) => textIds.has(pairId(p))) || !judgedFully) return true;
    replaced += 1;
    return false;
  });
  const slugOf = new Map(input.sections.map((s) => [s.id, s.identity.slug]));
  const rejudged: UnsupportedClaim[] = results
    .filter((r) => r.verdict === 'UNSUPPORTED')
    .map((r) => {
      const section = sectionAt(input.text, input.text.indexOf(r.claimSentence), input.sectionIds);
      return { section, slug: slugOf.get(section) ?? '', row: 0, result: r, rewritten: true };
    });
  return { claims: [...kept, ...rejudged], changedPairs: results.length, replaced };
}
