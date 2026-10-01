// bin/lib/content-terms.ts — the content terms of a sentence (Phase 21:
// claim-consistency.ts EXP-11; the rewrite guard's citation anchoring, review
// round 1).
//
// A light, dependency-free reader (citation-token.ts only), so the rewrite
// guard — which the Tier-1 submission tools reach — never pulls in the model
// transport through claim-consistency.ts.

import { replaceCitations } from './citation-token.js';

/** Function words, hedges and the claim markers themselves: never a shared "content" term. */
const STOPWORDS: ReadonlySet<string> = new Set(`
a an and are as at be been being but by can could did do does done for from had has have having he her his how however i if in into is it its
may might more most much must not no nor of on once only or other our out over own same she should so some such than that the their them then
there these they this those through to too under until up very was we were what when where which while who whom why will with would yet you your
also although among because between both each either even every few further here many neither never none often per rather since still thus
therefore whether within without across after again against all almost along already always another any around before being below beyond
cannot during less like least many maybe others otherwise perhaps quite seem seems shown show shows study studies paper section research
evidence finding findings found suggest suggests suggested indicate indicates indicated report reports reported argue argues argued claim
claims claimed relationship relation link linked association associated effect effects impact impacts role result results resulted
`.split(/\s+/).filter(Boolean));

/** Light stemming: a plural `s` (never `ss`) and a possessive. */
function stem(w: string): string {
  let t = w.replace(/'s$/, '');
  if (t.length > 4 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) t = t.slice(0, -1);
  return t;
}

/** The content terms of a sentence: citations removed, lowercase words of 3+ letters, no stopword, stemmed. */
export function contentTerms(sentence: string): string[] {
  const words = replaceCitations(sentence, () => ' ')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && /\p{L}/u.test(w) && !STOPWORDS.has(w));
  return [...new Set(words.map(stem))];
}
