// tests/lib/journey-generator.ts — the scripted model for the journey test
// (tests/journey.test.ts), loaded into the CLI process with `node --import`.
//
// Each answer depends only on what the request asks for: the step and, for
// plan and write, the section its user turn names. The works are found by
// title among those the request shows, never by a key written here.
//
// Not a test file (the runner collects only *.test.ts).

import type { GenerateRequest } from '../../bin/lib/generator.js';
import { fencedBlocks } from './fence.js';
import { installScriptedModel, requestText, stepOf, worksShown, type Step } from './scripted-model.js';

/** The two works the journey's paper is about, as the source evaluator is shown them. */
export const VISIBLE = { title: /visible islands/i, doi: '10.1556/012.2022.01524' };
export const COVERING = { title: /covering islands/i, doi: '10.1007/978-3-642-34191-5_21' };

/** A sentence of the Visible Islands paper the drafter quotes word for word. */
export const QUOTE = 'In this paper, we study a relaxed version of this question by replacing holes with visible islands';

/** The citekey of the shown work whose title matches `title`. */
function keyOf(req: GenerateRequest, title: RegExp): string {
  for (const [key, t] of worksShown(req)) if (title.test(t)) return key;
  throw new Error(`journey: no work titled ${title} was shown to the ${stepOf(req)} step`);
}

/** The journey's sections, in order: each one's slug, title and the one work it draws on. */
export const SECTIONS = [
  { slug: 'visible-islands', title: 'Visible Islands', work: VISIBLE },
  { slug: 'covering-islands', title: 'Covering Islands', work: COVERING },
  { slug: 'open-cases', title: 'Open Cases', work: VISIBLE },
] as const;

/** Each section's draft, citing the one work its plan assigns (`key`). */
export const DRAFTS: Record<(typeof SECTIONS)[number]['slug'], (key: string) => string> = {
  'visible-islands': (key) =>
    'An island of a finite point set is a subset that its convex hull meets in no other point, and it is a visible island ' +
    `when its points also see each other. Leuchtner, Nicolás and Suk frame the question directly: "${QUOTE}" [@${key}, p. 1]. ` +
    `Their answer is negative for large islands: there are point sets with no four collinear members and no visible island of size 13 [@${key}].\n`,
  'covering-islands': (key) =>
    'A related line of work asks how few islands are needed to cover a point set in the plane, ' +
    `and Fabila-Monroy and Huemer give bounds for that covering problem [@${key}].\n`,
  'open-cases': (key) =>
    `For islands of six to twelve points the question is still open, and the note on visible islands lists it as such [@${key}].\n`,
};

/** The journey section a plan or write request is for, by the title its user turn names. */
function sectionNamed(req: GenerateRequest): (typeof SECTIONS)[number] {
  const text = requestText(req, { system: false });
  const sec = SECTIONS.find((s) => text.includes(`"${s.title}"`));
  if (!sec) throw new Error(`journey: the request names no journey section: ${text.slice(0, 200)}`);
  return sec;
}

function answer(req: GenerateRequest, step: Step): unknown {
  switch (step) {
    case 'intake':
      return {
        topic: 'Visible islands in planar point sets',
        questions: [
          { id: 'topic', question: 'In a short phrase, what is the paper about?', suggested: 'Visible islands in planar point sets' },
          { id: 'discipline', question: 'Which discipline is it for?', suggested: 'other' },
          { id: 'length_words', question: 'How long should it be?', suggested: '1500' },
          { id: 'citation_style', question: 'Which citation style?', suggested: 'apa' },
          { id: 'audience', question: 'Who is it for?', suggested: 'an undergraduate course in discrete geometry' },
          { id: 'counterargument', question: 'Should it include a counterargument section?', suggested: 'none' },
        ],
      };
    case 'research':
      return { scopes: [{ label: 'visible islands', queries: ['visible islands point sets'] }] };
    case 'evaluate': {
      // Keep the two works the paper is about; the searches also find
      // fixed-point theory, shorelines and public health, which are off topic.
      const block = fencedBlocks(req.system).find((b) => b.includes('"id"'));
      if (!block) throw new Error('journey: the evaluator was shown no fenced candidates');
      const shown = JSON.parse(block) as Array<{ id: string; title: string }>;
      return {
        verdicts: shown.map((c) => {
          const keep = VISIBLE.title.test(c.title) || COVERING.title.test(c.title);
          return { id: c.id, keep, reason: keep ? 'on visible or covering islands in point sets' : 'off topic' };
        }),
      };
    }
    case 'outline':
      return {
        title: 'Visible Islands in Planar Point Sets',
        thesis: 'Visible islands of thirteen points can be avoided, while the smaller cases remain open.',
        sections: SECTIONS.map((sec, i) => ({
          slug: sec.slug,
          title: sec.title,
          purpose: `Section ${i + 1} of the review.`,
          depends_on: i === 0 ? [] : [SECTIONS[0].slug],
          word_target: 500,
          assigned_sources: [keyOf(req, sec.work.title)],
          counterargument: false,
        })),
      };
    case 'plan': {
      const sec = sectionNamed(req);
      const key = keyOf(req, sec.work.title);
      return {
        assigned_sources: [key],
        claims: [{ claim: `What ${sec.work === VISIBLE ? 'the note on visible islands' : 'the work on covering islands'} shows.`, sources: [key] }],
        brief: `Summarise for an undergraduate reader what the cited work establishes about ${sec.title.toLowerCase()} in planar point sets, ` +
          'and say plainly which question it leaves open, citing only the assigned source.',
        voice: 'plain, careful, third person',
      };
    }
    case 'write': {
      const sec = sectionNamed(req);
      const key = keyOf(req, sec.work.title);
      return { draft: DRAFTS[sec.slug](key), gaps: [] };
    }
    default:
      return undefined;
  }
}

installScriptedModel(answer);
