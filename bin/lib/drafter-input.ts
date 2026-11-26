// bin/lib/drafter-input.ts — the section drafter's contract.
//
// In: a DrafterInput, built in code from the outline entry, the section's
// PLAN.md and the works LIBRARY.json holds for the sources it assigns. The
// prompt is rendered from that one object (renderDrafterPrompt), after it is
// checked (assertDrafterInput): no field beyond the schema's, and no source
// the section was not assigned (PRD §7.6), so what is checked is what is sent.
//
// Out: JSON to SectionDraftSchema: the draft, and the claims the plan asks for
// that no source supports ("gaps"), which stay out of the draft and are shown
// to the author. draftProblems gives every reason a draft cannot be saved: it
// is empty, or cites a key outside the section's sources, or writes a
// citation as text. write.ts sends a failing draft back once, then refuses.

import { z } from 'zod/v4';
import {
  citedKeys,
  findCitations,
  findRawCitations,
  findUnparseableCitations,
} from './citation-grammar.js';
import { escapeTemplateTokens } from './intake-parse.js';
import { interpolate, loadPrompt } from './prompt-loader.js';
import { renderSourceContext, SourceContextEntrySchema } from './source-context.js';
import { stripFenceMarkers } from './untrusted-fence.js';

/** Everything the drafter prompt is rendered from, and nothing else. */
export const DrafterInputSchema = z.object({
  section: z.object({
    number: z.number().int().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    purpose: z.string(),
    depends_on: z.array(z.string()),
    word_target: z.number().int().positive().nullable(),
  }).strict(),
  paper: z.object({ title: z.string(), thesis: z.string() }).strict(),
  /** PLAN.md's body (the brief, the voice line, the claims), without its frontmatter. */
  brief: z.string().min(1),
  voice: z.string().min(1),
  /** The works the section's PLAN.md assigns that LIBRARY.json holds. */
  sources: z.array(SourceContextEntrySchema),
}).strict();
export type DrafterInput = z.infer<typeof DrafterInputSchema>;

/**
 * Check a drafter input. Throws on a field the schema does not have, a
 * missing or mistyped field, or a source that is not one of
 * `assignedSources` (or is listed twice).
 */
export function assertDrafterInput(input: unknown, assignedSources: readonly string[]): asserts input is DrafterInput {
  const parsed = DrafterInputSchema.parse(input);
  const assigned = new Set(assignedSources);
  const seen = new Set<string>();
  for (const s of parsed.sources) {
    if (!assigned.has(s.citekey)) throw new Error(`drafter input: source ${s.citekey} is not one the section's PLAN.md assigns`);
    if (seen.has(s.citekey)) throw new Error(`drafter input: source ${s.citekey} is listed twice`);
    seen.add(s.citekey);
  }
}

/** How much of PLAN.md's body the drafter is shown. */
const BRIEF_CHARS = 12_000;

/** The drafter's system prompt, from `input` alone, once it is checked. */
export function renderDrafterPrompt(input: unknown, assignedSources: readonly string[]): string {
  assertDrafterInput(input, assignedSources);
  const text = (s: string): string => escapeTemplateTokens(stripFenceMarkers(s));
  return interpolate(loadPrompt('section-drafter'), {
    section: text(JSON.stringify(input.section)),
    paper: text(JSON.stringify(input.paper)),
    brief: text(input.brief.slice(0, BRIEF_CHARS)),
    voice: text(input.voice),
    sources: renderSourceContext(input.sources),
  });
}

/** What the drafter returns. */
export const SectionDraftSchema = z.object({
  draft: z.string(),
  gaps: z.array(z.object({ claim: z.string(), reason: z.string() }).strict()),
}).strict();
export type SectionDraft = z.infer<typeof SectionDraftSchema>;

/** How a problem quotes the text it is about. */
const QUOTED = 80;

/** Every reason `d` cannot be saved as the section's draft; empty when it can. */
export function draftProblems(d: SectionDraft, sourceKeys: readonly string[]): string[] {
  if (d.draft.trim().length === 0) return ['the draft is empty'];
  const problems: string[] = [];
  const cites = findCitations(d.draft);
  const allowed = new Set(sourceKeys);
  const outside = citedKeys(cites).filter((k) => !allowed.has(k));
  if (outside.length > 0) {
    problems.push(
      `it cites ${outside.join(', ')}, which ${outside.length === 1 ? 'is' : 'are'} not among this section's sources ` +
        `(${sourceKeys.length > 0 ? sourceKeys.join(', ') : 'it has none'}); cite only those, ` +
        'or leave the claim out of the draft and list it in gaps',
    );
  }
  for (const r of findRawCitations(d.draft, cites)) {
    problems.push(`it writes a citation as text, "${r.raw.slice(0, QUOTED)}"; cite a source as [@citekey], or leave the claim out and list it in gaps`);
  }
  for (const u of findUnparseableCitations(d.draft, cites)) {
    problems.push(`"${u.raw.slice(0, QUOTED)}" is not a citation pensmith can read; write [@citekey] with a key from the list`);
  }
  return problems;
}
