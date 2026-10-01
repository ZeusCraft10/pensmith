// tests/rewrite-guard.test.ts — the ONE guard around every model rewrite of
// verified prose (Phase 21, EXP-10, EXP-14; D-21-14): maskForRewrite and
// validateRewrite driven directly, as the Tier-1 boundary and humanizer
// submission tools (PLUG-07, PLUG-10) will call them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskForRewrite, unmaskRewrite, validateRewrite, boundaryAdditions, headingLines, citationAnchorProblem, compareRewrite } from '../bin/lib/rewrite-guard.js';
import { boundaryAdditions as compileBoundaryAdditions } from '../bin/lib/compile.js';

const TEXT =
  'Deep networks learn layered representations [@lecun2015, p. 4]. As @aspelmeyer2009 notes, measurement "shapes what an observer is able to record about a system" [@aspelmeyer2009].\n\n' +
  'A second paragraph cites a cluster [@lecun2015; @zhu2020] and a suppressed author [-@zhu2020].';

test('D-21-14: maskForRewrite hides every citation form and every quote of at least quote_min_words words; unmask restores the bytes', () => {
  const mask = maskForRewrite(TEXT, { namespace: 3 });
  assert.doesNotMatch(mask.masked, /@/, 'no citation survives the mask');
  assert.doesNotMatch(mask.masked, /shapes what an observer/, 'the quote is masked');
  assert.match(mask.masked, /\{\{cite_3_0\}\}/);
  assert.match(mask.masked, /\{\{quote_3_0\}\}/);
  assert.equal(mask.cites.size, 5, '[@lecun2015, p. 4], @aspelmeyer2009, the quote\'s [@aspelmeyer2009], the cluster, [-@zhu2020]');
  assert.equal(unmaskRewrite(mask.masked, mask), TEXT);
  // A short quoted phrase (under 5 words) is prose, not a checked quote: left as is.
  const short = maskForRewrite('The so-called "deep" turn [@lecun2015].');
  assert.match(short.masked, /"deep"/);
  // A block quote run is one placeholder.
  const block = maskForRewrite('Intro text [@lecun2015].\n\n> Measurement shapes what an observer is able to record [@aspelmeyer2009].\n\nAfter.');
  assert.match(block.masked, /^Intro text \{\{cite_0_0\}\}\.\n\n\{\{quote_0_0\}\}\n\nAfter\.$/);
});

test('D-21-14: validateRewrite accepts a prose-only rewrite and restores the citations byte for byte', () => {
  const mask = maskForRewrite(TEXT);
  const [p1, p2] = mask.masked.split('\n\n') as [string, string];
  const v = validateRewrite({ original: TEXT, mask, rewritten: `${p1} This carries the argument forward.\n\n${p2}`, allowedParagraphs: [0, 1] });
  assert.equal(v.ok, true, v.reasons.join('; '));
  assert.ok(v.text.includes('[@lecun2015, p. 4]') && v.text.includes('[-@zhu2020]') && v.text.includes('This carries the argument forward.'));
});

test('D-21-14: validateRewrite rejects a dropped, added or duplicated citation — "citation set changed"', () => {
  const mask = maskForRewrite(TEXT);
  const [p1, p2] = mask.masked.split('\n\n') as [string, string];
  const dropped = validateRewrite({ original: TEXT, mask, rewritten: `${p1}\n\n${p2.replace('{{cite_0_3}}', '')}` });
  assert.deepEqual([dropped.ok, dropped.reasons[0]], [false, 'citation set changed']);
  assert.equal(dropped.text, TEXT, 'a rejected rewrite keeps the original');
  const duplicated = validateRewrite({ original: TEXT, mask, rewritten: `${p1} {{cite_0_0}}\n\n${p2}` });
  assert.equal(duplicated.reasons[0], 'citation set changed');
  for (const added of ['[@fake2099, p. 3]', '[-@evil9999]', 'as @evil9999 notes', '[@{evil9999}]']) {
    const v = validateRewrite({ original: TEXT, mask, rewritten: `${p1} Moreover, ${added}.\n\n${p2}` });
    assert.equal(v.ok, false, added);
    assert.equal(v.reasons[0], 'citation set changed', added);
  }
});

test('D-21-14: validateRewrite rejects a changed quote, a changed heading, a change outside the allowed paragraphs and anything new the gate would check', () => {
  const mask = maskForRewrite(TEXT);
  const [p1, p2] = mask.masked.split('\n\n') as [string, string];
  assert.equal(validateRewrite({ original: TEXT, mask, rewritten: `${p1.replace('{{quote_0_0}}', '"a different quotation of several words here"')}\n\n${p2}` }).reasons[0], 'a quoted passage changed');
  assert.equal(validateRewrite({ original: TEXT, mask, rewritten: `${p1}\n\n${p2} Changed.`, allowedParagraphs: [0] }).reasons[0], 'text outside the allowed paragraphs changed');
  assert.match(validateRewrite({ original: TEXT, mask, rewritten: `${p1}\n\nExtra.\n\n${p2}`, allowedParagraphs: [0, 1] }).reasons[0] ?? '', /^paragraph structure changed/);
  const headed = '## Methods\n\nWe measure carefully [@aspelmeyer2009].';
  const hm = maskForRewrite(headed);
  assert.equal(validateRewrite({ original: headed, mask: hm, rewritten: hm.masked.replace('## Methods', '## Method') }).reasons[0], 'a heading changed');
  assert.deepEqual(headingLines(headed), ['## Methods']);
  for (const extra of ['as (Smith & Jones, 2019) found', 'and "deep networks will always outperform every other method ever devised"', 'see doi:10.9999/fabricated.2019', 'as in [3]']) {
    const v = validateRewrite({ original: TEXT, mask, rewritten: `${p1} Moreover, ${extra}.\n\n${p2}` });
    assert.equal(v.ok, false, extra);
    assert.match(v.reasons[0] ?? '', /^adds .* which no section verified$|^a quoted passage changed$/, extra);
  }
  assert.equal(validateRewrite({ original: TEXT, mask, rewritten: '   ' }).reasons[0], 'empty rewrite');
});

test('D-21-14: boundaryAdditions moved to the guard and stays re-exported from compile.ts', () => {
  assert.equal(compileBoundaryAdditions, boundaryAdditions);
  assert.equal(boundaryAdditions('Plain text.', 'Plain text, rephrased.'), null);
  assert.match(boundaryAdditions('Plain text.', 'Plain text (Smith, 2019).') ?? '', /UNSUPPORTED-FORM/);
});

// ---------------------------------------------------------------------------
// Review round 1: a citation stays in its paragraph (the smoother's two
// paragraphs are two SECTIONS, PRD §7.6) and on its claim; the reply carries
// no fence marker, no "pensmith" and no chatter paragraph.
// ---------------------------------------------------------------------------

test('review r1: the smoother may not move a citation (and its claim) across the section boundary', () => {
  const window = 'Section one concludes that sleep improves memory [@a2020].\n\nSection two opens: exercise reduces stress in adults [@b2021].';
  const mask = maskForRewrite(window);
  assert.match(mask.masked, /\{\{cite_0_0\}\}[\s\S]*\{\{cite_0_1\}\}/);
  const reply = 'Section one concludes that sleep improves memory {{cite_0_0}} and that exercise reduces stress {{cite_0_1}}.\n\nSection two opens with a related point about adults.';
  const v = validateRewrite({ original: window, mask, rewritten: reply, allowedParagraphs: [0, 1] });
  assert.equal(v.ok, false);
  assert.equal(v.reasons[0], 'a citation crossed the boundary between the paragraphs');
  assert.equal(v.text, window, 'the original is kept');
  // A quote placeholder may not cross it either.
  const qWindow = 'Smith closes with "every measurement leaves a trace on the system" [@a2020].\n\nThe next section begins plainly [@b2021].';
  const qm = maskForRewrite(qWindow);
  const qReply = qm.masked.replace(/^(.*?)(\{\{quote_0_0\}\}) /, '$1').replace('begins plainly', 'begins with {{quote_0_0}} plainly');
  assert.equal(validateRewrite({ original: qWindow, mask: qm, rewritten: qReply, allowedParagraphs: [0, 1] }).ok, false);
});

test('review r1: a reply that swaps two citations between claims is rejected — the multisets alone would pass it', () => {
  const original = 'Vaccination reduced hospitalisation in the cohort [@smith2020]. Rising temperatures had no measurable effect on transmission [@jones2019].';
  const mask = maskForRewrite(original);
  const swapped = mask.masked.replace('{{cite_0_0}}', '\u0001').replace('{{cite_0_1}}', '{{cite_0_0}}').replace('\u0001', '{{cite_0_1}}');
  const v = validateRewrite({ original, mask, rewritten: swapped });
  assert.equal(v.ok, false, 'the swap is rejected');
  assert.match(v.reasons[0] ?? '', /^a citation moved to another claim/);
  // A partial overlap (both claims mention the cohort) is a move too.
  const shared = 'Vaccination reduced hospitalisation in the cohort [@smith2020]. Rising temperatures had no effect on the cohort [@jones2019].';
  const sm = maskForRewrite(shared);
  const sSwap = 'Vaccination reduced hospitalisation in the cohort {{cite_0_1}}. Rising temperatures had no effect on the cohort {{cite_0_0}}.';
  assert.match(validateRewrite({ original: shared, mask: sm, rewritten: sSwap }).reasons[0] ?? '', /moved to another claim/);
  // Two sentences reordered with their citations is fine; so is a reworded
  // sentence and a merge with uncited context.
  const reordered = 'Rising temperatures had no measurable effect on transmission {{cite_0_1}}. Vaccination reduced hospitalisation in the cohort {{cite_0_0}}.';
  assert.equal(validateRewrite({ original, mask, rewritten: reordered }).ok, true, 'citations travel with their claims');
  const reworded = 'In the cohort, vaccination cut hospitalisation {{cite_0_0}}. Transmission showed no measurable effect from rising temperatures {{cite_0_1}}.';
  assert.equal(validateRewrite({ original, mask, rewritten: reworded }).ok, true, 'a reworded sentence keeps its citation');
  const ctx = 'Sleep was studied in adults over ten years. The results showed improved memory [@walker2017].';
  const cm = maskForRewrite(ctx);
  const merged = 'In a ten-year study of adults, sleep improved memory {{cite_0_0}}.';
  const mv = validateRewrite({ original: ctx, mask: cm, rewritten: merged });
  assert.notEqual(mv.reasons[0] ?? '', 'paragraph structure changed');
  assert.equal(mv.ok, true, mv.reasons.join('; '));
  // Inside one sentence, two citations keep their order.
  const two = 'Sleep consolidates memory [@a2020], whereas stress impairs recall [@b2021].';
  const tm = maskForRewrite(two);
  assert.match(validateRewrite({ original: two, mask: tm, rewritten: 'Sleep consolidates memory {{cite_0_1}}, whereas stress impairs recall {{cite_0_0}}.' }).reasons[0] ?? '', /swapped places/);
});

// Review round 2: a humanizer rewords — a cited sentence often keeps under
// half of its words, and a neighbouring sentence on the same topic shares one
// or two. Those are not moves (they made done exit 4 on ordinary paraphrases);
// a move needs another claim to live in the citation's sentence.
const PARAPHRASES: ReadonlyArray<readonly [string, string]> = [
  ['Transformer models have reshaped natural language processing. Self-attention allows each token to weigh every other token in the sequence [@vaswani2017]. This design removes the sequential bottleneck of recurrent networks, which processed tokens one at a time [@hochreiter1997]. As a result, training on large corpora became far more efficient.',
    'Transformer models have changed natural language processing. With self-attention, every token can look at all the others in the sequence at once [@vaswani2017]. Recurrent networks had to read tokens one by one, and this design does away with that bottleneck [@hochreiter1997]. Training on large corpora got much faster as a result.'],
  ['Sleep deprivation impairs working memory in adolescents [@smith2019]. Several longitudinal studies have documented this effect across different age groups. Moreover, the impairment appears to be dose-dependent, with greater loss of sleep producing larger deficits [@jones2021].',
    'Teenagers who lose sleep do worse on working-memory tasks [@smith2019]. Several longitudinal studies have documented this effect across different age groups. The more sleep they lose, the bigger the deficit seems to be [@jones2021].'],
  ['The policy reduced emissions in the first year of implementation [@lee2020]. However, critics argue that the reduction reflected the economic downturn rather than the policy itself [@park2021].',
    "Emissions fell in the policy's first year [@lee2020]. Critics say the recession, not the policy, drove that drop [@park2021]."],
  ['Prior research has established a strong link between socioeconomic status and educational attainment [@bourdieu1986]. Students from wealthier families are more likely to complete university degrees. This pattern persists even when controlling for prior academic performance [@chetty2014].',
    'Family income tracks closely with how far students get in school [@bourdieu1986]. Students from wealthier families are more likely to complete university degrees. The gap holds up even after accounting for earlier grades [@chetty2014].'],
  ['Climate models project a rise of two to four degrees by 2100 under current policies [@ipcc2021]. Such warming would increase the frequency of extreme heat events. Coastal cities face particular risk from sea-level rise [@nicholls2010].',
    "Under today's policies, the models expect warming of two to four degrees by 2100 [@ipcc2021]. Such warming would increase the frequency of extreme heat events. Cities on the coast are especially exposed as seas rise [@nicholls2010]."],
  ['Antibiotic resistance has become one of the most pressing threats to global health [@who2020]. Overuse of antibiotics in livestock contributes substantially to the problem. Resistant strains now account for hundreds of thousands of deaths annually [@murray2022].',
    'Few health threats worry experts more than drug-resistant bacteria [@who2020]. Overuse of antibiotics in livestock contributes substantially to the problem. Hundreds of thousands of people now die each year from infections that drugs can no longer treat [@murray2022].'],
  ['Remote work increased self-reported productivity for knowledge workers during the pandemic [@bloom2015]. Managers, however, often perceived a decline in collaboration. Long-term effects on career progression remain unclear [@emanuel2023].',
    'Knowledge workers said they got more done at home during the pandemic [@bloom2015]. Managers, however, often perceived a decline in collaboration. Nobody yet knows what this means for promotions over the long run [@emanuel2023].'],
  ['Minimum wage increases have modest effects on employment in most empirical studies [@card1994]. Critics counter that small businesses bear a disproportionate share of the costs. Recent meta-analyses find employment elasticities close to zero [@dube2019].',
    'Most studies find that raising the minimum wage costs few jobs [@card1994]. Critics counter that small businesses bear a disproportionate share of the costs. Pooled estimates put the employment effect near zero [@dube2019].'],
  ['Social media use is associated with higher rates of depressive symptoms among teenage girls [@twenge2018]. The direction of causality, however, is still debated. Experimental reductions in use have produced small improvements in well-being [@allcott2020].',
    'Teenage girls who spend more time on social media report more symptoms of depression [@twenge2018]. The direction of causality, however, is still debated. When people are asked to cut back, their well-being improves a little [@allcott2020].'],
  ['The section develops this point in steps. Prior work examined here offers direct evidence for the point at hand [@cai2024].',
    'The section develops this point in steps. Earlier studies back this point up directly [@cai2024].'],
];

test('review r2: ordinary paraphrases that keep each citation on its own sentence pass the anchor check', () => {
  for (const [original, rewritten] of PARAPHRASES) {
    assert.equal(citationAnchorProblem(original, rewritten), null, rewritten);
    assert.deepEqual(compareRewrite(original, rewritten), [], rewritten);
  }
});

test('review r2: a citation moved onto another (uncited or cited) claim is still rejected', () => {
  const original = 'Vaccination reduced hospitalisation in the cohort [@smith2020]. Rising temperatures had no measurable effect on transmission.';
  assert.match(
    citationAnchorProblem(original, 'Vaccination reduced hospitalisation in the cohort. Rising temperatures had no measurable effect on transmission [@smith2020].') ?? '',
    /moved to another claim \(\[@smith2020\] now sits on "Rising temperatures/,
  );
  const [first, second] = PARAPHRASES[3] as readonly [string, string];
  const swapped = second.replace('[@bourdieu1986]', '\u0001').replace('[@chetty2014]', '[@bourdieu1986]').replace('\u0001', '[@chetty2014]');
  assert.match(citationAnchorProblem(first, swapped) ?? '', /moved to another claim/, 'two citations swapped between paraphrased claims');
  const onUncited = second.replace(' [@bourdieu1986]', '').replace('university degrees.', 'university degrees [@bourdieu1986].');
  assert.match(citationAnchorProblem(first, onUncited) ?? '', /moved to another claim \(\[@bourdieu1986\] now sits on "Students from wealthier/);
});

test('review r1: a reply that echoes the untrusted-data fence, adds "pensmith" or adds a chatter paragraph is rejected', async () => {
  const { FENCE_OPEN, FENCE_CLOSE } = await import('../bin/lib/untrusted-fence.js');
  const original = 'Deep networks learn layered representations [@lecun2015].\n\nA second paragraph follows [@zhu2020].';
  const mask = maskForRewrite(original);
  const [p1, p2] = mask.masked.split('\n\n') as [string, string];
  const fenced = validateRewrite({ original, mask, rewritten: `${FENCE_OPEN}\n${p1}\n${FENCE_CLOSE}\n\n${FENCE_OPEN}\n${p2}\n${FENCE_CLOSE}`, allowedParagraphs: [0, 1] });
  assert.equal(fenced.ok, false);
  assert.match(fenced.reasons.join('\n'), /echoes the untrusted-data fence/);
  const named = validateRewrite({ original, mask, rewritten: `${p1} Pensmith smoothed this.\n\n${p2}` });
  assert.match(named.reasons.join('\n'), /adds the word "pensmith"/);
  const chatter = validateRewrite({ original, mask, rewritten: `Here is the improved text:\n\n${p1}\n\n${p2}` });
  assert.equal(chatter.ok, false);
  assert.match(chatter.reasons[0] ?? '', /^paragraph structure changed \(2 paragraph\(s\) became 3\)/);
  const chatterFenced = validateRewrite({ original, mask, rewritten: `Here is the improved text:\n\n${FENCE_OPEN}\n${p1}\n\n${p2}\n${FENCE_CLOSE}` });
  assert.equal(chatterFenced.ok, false);
});
