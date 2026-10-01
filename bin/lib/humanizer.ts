// bin/lib/humanizer.ts — the Tier-2 humanizer and the ONE acceptance function
// for a humanized paper (Phase 21, EXP-14; D-21-18).
//
// The humanizer improves prose; it is never described as a way to avoid
// detection (PRD §14). It is the user's installed skill
// (`~/.claude/skills/humanizer/SKILL.md`, the account-synced skills or an
// installed plugin's — located through paths.ts
// humanizerSkillPath): its body (frontmatter stripped) is the system prompt —
// sent cache_control-marked like every system prompt — through the `humanizer`
// MODEL slug (llm-models.ts; no templates/prompts file, S-06). The user message
// is the hash-pinned contract (plugin/references/humanizer-contract.md, its `##
// Contract` section verbatim), the voice to keep, and the section text masked by
// the rewrite guard (every citation and every Pass-3 quote a placeholder) inside
// the FEED-05 fence.
//
// humanizeDraft() rewrites the compiled draft one `##` section at a time — the
// title and the headings never reach the model — and validates every section's
// reply through rewrite-guard.ts validateRewrite. It returns text; it never
// writes FINAL.md (done does, after the export, D-21-19). The model call is
// injected (bin/cli/done.ts passes complete()), so this module never imports
// the transport and a Tier-1 tool can import acceptHumanized.
//
// acceptHumanized() is the acceptance function BOTH tiers call (PLUG-10): the
// rewrite guard on the whole text (headings, every citation as written, every
// quote, nothing new for the gate), the cited-key diff (citedKeySetChange,
// GATE-04) and the gate core over the humanized bytes (done-gate.ts
// recomputeExportGate). Any reason rejects the humanized text.

import { readFileSync } from 'node:fs';
import { humanizerSkillPath, pluginReferencePath } from './paths.js';
import { parseFrontmatter } from './frontmatter.js';
import { fenceUntrusted, stripFenceMarkers } from './untrusted-fence.js';
import { maskForRewrite, validateRewrite, compareRewrite } from './rewrite-guard.js';
import { citedKeySetChange, recomputeExportGate, type DoneSection } from './done-gate.js';
import type { GateResult, LoadedBibliography } from './verify/gate.js';

/** The `humanizer` model slug (llm-models.ts; generation tier, verb done, no template). */
export const HUMANIZER_SLUG = 'humanizer';


/** A humanizer request: the skill as the system prompt, the contract and the masked section as the one user message. */
export interface HumanizerRequest {
  readonly slug: typeof HUMANIZER_SLUG;
  readonly system: string;
  readonly messages: Array<{ role: 'user'; content: string }>;
}

/** The installed skill: its file and its body (frontmatter stripped). */
export interface HumanizerSkill {
  readonly path: string;
  readonly body: string;
}

/**
 * The user's humanizer skill, or null when it is not installed (no SKILL.md,
 * an empty body, or — under a test context — a home outside os.tmpdir()).
 * Never throws.
 */
export function loadHumanizerSkill(): HumanizerSkill | null {
  const path = humanizerSkillPath();
  if (path === null) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
  let body = raw;
  if (raw.startsWith('---\n')) {
    try {
      body = parseFrontmatter(raw).body;
    } catch {
      const end = raw.indexOf('\n---', 4);
      body = end === -1 ? raw : raw.slice(raw.indexOf('\n', end + 1) + 1);
    }
  }
  body = body.trim();
  return body.length === 0 ? null : { path, body };
}

let contractCache: string | null = null;

/** The `## Contract` section of plugin/references/humanizer-contract.md, verbatim (hash-pinned). */
export function humanizerContract(): string {
  if (contractCache !== null) return contractCache;
  const md = readFileSync(pluginReferencePath('humanizer-contract.md'), 'utf8').replace(/\r\n/g, '\n');
  const at = md.indexOf('\n## Contract\n');
  if (at === -1) throw new Error('humanizer-contract.md has no "## Contract" section');
  contractCache = md.slice(at + '\n## Contract\n'.length).trim();
  return contractCache;
}

/** The request for one masked section. */
export function humanizerRequest(skill: HumanizerSkill, maskedSection: string, preserveVoice: string): HumanizerRequest {
  const content = [
    humanizerContract(),
    '',
    '<preserve_voice>',
    stripFenceMarkers(preserveVoice),
    '</preserve_voice>',
    '',
    '<text>',
    fenceUntrusted(stripFenceMarkers(maskedSection).split('</text>').join('<\\/text>')),
    '</text>',
  ].join('\n');
  return { slug: HUMANIZER_SLUG, system: skill.body, messages: [{ role: 'user', content }] };
}

/** One `##` section of the compiled draft. */
export interface DraftSection {
  /** The heading line (`## Methods`), never sent to the model. */
  readonly heading: string;
  /** The text after the heading, up to the next `##` heading. */
  readonly body: string;
}

/**
 * The compiled draft as compile writes it (`# <title>`, then `## <section>`
 * blocks): the text before the first `##` heading (the title) and the
 * sections. Lines inside a fenced code block never start a section.
 */
export function splitDraftSections(draft: string): { preamble: string; sections: DraftSection[] } {
  const lines = draft.replace(/\r\n/g, '\n').split('\n');
  const starts: number[] = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s{0,3}(?:```|~~~)/.test(l)) fence = !fence;
    else if (!fence && /^## \S/.test(l)) starts.push(i);
  });
  if (starts.length === 0) return { preamble: draft, sections: [] };
  const preamble = lines.slice(0, starts[0]).join('\n');
  const sections = starts.map((s, k) => ({
    heading: lines[s] as string,
    body: lines.slice(s + 1, k + 1 < starts.length ? starts[k + 1] : lines.length).join('\n'),
  }));
  return { preamble, sections };
}

/** Put the draft back together (the inverse of splitDraftSections). */
export function joinDraftSections(preamble: string, sections: readonly DraftSection[]): string {
  return [preamble, ...sections.flatMap((s) => [s.heading, s.body])].join('\n');
}

/**
 * A reply line that labels the final rewrite, with any text after the label:
 * `3. Final rewrite`, `**Final rewrite:**`, `## Final version`, or the
 * skill's own step-8 prompt line that introduces its final version (quoted
 * from the published skill, "Now make it not obviously AI generated.").
 */
const FINAL_LABEL_RE = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*(?:\d+[.)][ \t]*)?(?:\*\*|__)?[ \t]*(?:prompt:[ \t]*)?["\u201C]?(?:final (?:rewrite|version)|now make it not obviously ai[- ]generated)[.!]?["\u201D]?[ \t]*(?:\*\*|__)?[ \t]*(?::[ \t]*(?:\*\*|__)?[ \t]*(.*))?$/im;

/** A reply line that labels a summary of the changes (the part after the final rewrite). */
const SUMMARY_LABEL_RE = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*(?:\d+[.)][ \t]*)?(?:\*\*|__)?[ \t]*(?:a )?(?:brief )?(?:summary of (?:the )?changes|changes made)\b/im;

/**
 * The final rewrite of a reply that answered in the skill's own multi-part
 * format (review round 2: the published humanizer skill asks for a draft
 * rewrite, an audit, a final rewrite and a summary of changes, and a model
 * that follows its system prompt answers that way): the text after the
 * `Final rewrite` label, up to a summary label, with horizontal rules at its
 * ends removed. A reply with no such label is returned as it is — the rewrite
 * guard then judges it whole. humanizeDraft uses it only when the whole
 * reply is not accepted.
 */
export function finalRewriteOf(reply: string): string {
  const text = reply.replace(/\r\n/g, '\n');
  const label = FINAL_LABEL_RE.exec(text);
  if (label === null) return reply;
  let rest = `${(label[1] ?? '').trim()}\n${text.slice(label.index + label[0].length + 1)}`;
  const summary = SUMMARY_LABEL_RE.exec(rest);
  if (summary !== null) rest = rest.slice(0, summary.index);
  return rest.replace(/^(?:\s*(?:-{3,}|\*{3,}|_{3,})\s*\n)+/u, '').replace(/(?:\n\s*(?:-{3,}|\*{3,}|_{3,})\s*)+$/u, '').trim();
}

export interface HumanizeInput {
  /** The compiled draft (DRAFT.md bytes as text). */
  readonly draft: string;
  readonly skill: HumanizerSkill;
  /** `[humanizer] preserve_voice` (default academic). */
  readonly preserveVoice?: string;
  /** `[verification] quote_min_words`. */
  readonly quoteMinWords?: number;
  /** One model call: the request → the reply text. */
  readonly call: (req: HumanizerRequest, sectionIndex: number) => Promise<string>;
}

export interface HumanizeResult {
  /** The humanized draft (the original, section by section, where nothing was sent). */
  readonly text: string;
  /** Sections sent to the model. */
  readonly sectionsSent: number;
  /** Why a section's rewrite was rejected (`§2 (## Methods): citation set changed`); empty when every section was accepted. */
  readonly rejected: readonly string[];
}

/**
 * Humanize the compiled draft one `##` section at a time (see the header).
 * The title, the headings and every masked span never reach the model. A
 * section whose reply the rewrite guard rejects is named in `rejected` (done
 * then refuses the whole humanized text). Model errors propagate to the
 * caller (done reports `humanizer failed: …`, or the cost cap's refusal).
 */
export async function humanizeDraft(input: HumanizeInput): Promise<HumanizeResult> {
  const { preamble, sections } = splitDraftSections(input.draft);
  const voice = input.preserveVoice ?? 'academic';
  const rejected: string[] = [];
  const out: DraftSection[] = [];
  let sent = 0;
  for (let i = 0; i < sections.length; i += 1) {
    const s = sections[i] as DraftSection;
    const lead = /^\n*/.exec(s.body)?.[0] ?? '';
    const trail = /\n*$/.exec(s.body)?.[0] ?? '';
    const core = s.body.slice(lead.length, s.body.length - trail.length);
    if (core.trim().length === 0) {
      out.push(s);
      continue;
    }
    const mask = maskForRewrite(core, { namespace: i, ...(input.quoteMinWords !== undefined ? { quoteMinWords: input.quoteMinWords } : {}) });
    const reply = await input.call(humanizerRequest(input.skill, mask.masked, voice), i);
    sent += 1;
    const judge = (rewritten: string): ReturnType<typeof validateRewrite> =>
      validateRewrite({ original: core, mask, rewritten, ...(input.quoteMinWords !== undefined ? { quoteMinWords: input.quoteMinWords } : {}) });
    let verdict = judge(reply);
    // A reply in the skill's own multi-part format: its final rewrite is judged
    // when the whole reply is not accepted (review round 2).
    const final = verdict.ok ? reply : finalRewriteOf(reply);
    if (final !== reply) {
      const second = judge(final);
      if (second.ok) verdict = second;
    }
    if (!verdict.ok) {
      rejected.push(`§${i + 1} (${s.heading.replace(/^##\s+/, '')}): ${verdict.reasons.join('; ')}`);
      out.push(s);
      continue;
    }
    out.push({ heading: s.heading, body: `${lead}${verdict.text}${trail}` });
  }
  return { text: joinDraftSections(preamble, out), sectionsSent: sent, rejected };
}

export interface AcceptInput {
  readonly paperRoot: string;
  /** The compiled draft the humanizer started from (the gated DRAFT.md text). */
  readonly draft: string;
  /** The humanized text to accept or reject. */
  readonly humanized: string;
  readonly sections?: readonly DoneSection[];
  readonly bib?: LoadedBibliography;
  readonly quoteMinWords?: number;
}

export interface AcceptResult {
  readonly ok: boolean;
  /** Every reason the humanized text is refused (empty when accepted). */
  readonly reasons: readonly string[];
  /** The gate core's result over the humanized bytes. */
  readonly gate: GateResult;
}

/**
 * The ONE acceptance function for a humanized paper (both tiers, PLUG-10):
 * the rewrite guard over the whole text (every heading, every citation as
 * written, every Pass-3 quote unchanged; nothing new the gate would check),
 * the cited-key diff (GATE-04) and the gate core over the humanized bytes
 * (VRFY-26). Never writes a file.
 */
export async function acceptHumanized(input: AcceptInput): Promise<AcceptResult> {
  const reasons: string[] = [...compareRewrite(input.draft, input.humanized, input.quoteMinWords !== undefined ? { quoteMinWords: input.quoteMinWords } : {})];
  const change = citedKeySetChange(input.humanized, input.draft);
  if (change !== null) reasons.push(change);
  const gate = await recomputeExportGate(input.paperRoot, input.humanized, {
    ...(input.sections !== undefined ? { sections: input.sections } : {}),
    ...(input.bib !== undefined ? { bib: input.bib } : {}),
  });
  reasons.push(...gate.refusals);
  return { ok: reasons.length === 0, reasons, gate: gate.gate };
}
