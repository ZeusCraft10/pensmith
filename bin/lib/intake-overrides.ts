// bin/lib/intake-overrides.ts — plain-English overrides and deterministic
// facts read from the assignment and the intake answers (GRND-04, D-18-11).
//
// PRD §8 "Override examples": "Use MLA for this paper" swaps the citation
// style; "I need a literature review section before methods" modifies the
// sectioning. Intake parses both deterministically — from the assignment AND
// from every free-text answer (thesis seed, follow-up answers) — before and
// independently of the clarifier model, so a stated override is never lost to
// a model that ignored it.
//
// The same module holds the other facts intake reads from the assignment
// text without a model: the stated length ("1500-word", "1,500 words",
// "5 pages" × 300), the paper type, a first-guess topic phrase and an explicit
// discipline mention. The intake-clarifier contract stub (llm-stubs.ts) reads
// a request through these functions, so a stubbed or mocked intake behaves
// like a model that read the assignment (GRND-19, D-18-06).
//
// Pure: no I/O, no model, no network. Discipline names and aliases come from
// the preset file through bin/lib/disciplines.ts (no discipline literal here —
// chokepoint row `discipline-literals`); style names from the alias table in
// bin/lib/schemas/config.ts.

import { citationStyleAliases, citationStyleKey } from './schemas/config.js';
import { FALLBACK_DISCIPLINE, loadDisciplinePresets, type CslStyleKey } from './disciplines.js';
import { PAPER_TYPES, type PaperType } from './intake-brief.js';

/** Words per page when an assignment states its length in pages (double-spaced, 12 pt). */
export const WORDS_PER_PAGE = 300;

/** Length targets outside this range are not a length statement ("3 words", "90000 words"). */
const MIN_WORDS = 100;
const MAX_WORDS = 50_000;

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Clauses of a text: sentences, split at . ! ? ; and line breaks (CRLF-safe). */
export function clausesOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// Citation style (GRND-04)
// ---------------------------------------------------------------------------

/** A style mention with a cue that makes it an instruction, not a passing name. */
export interface StyleOverride {
  readonly style: CslStyleKey;
  /** The clause the override came from (for the Q/A record). */
  readonly evidence: string;
}

/**
 * Style names that are also ordinary words or places ("in Chicago", "Harvard
 * University", "a Vancouver study"): they count only with a strong cue — a
 * style word after them, or use/follow/cite/format before them.
 */
const AMBIGUOUS_STYLE_ALIASES: ReadonlySet<string> = new Set(['chicago', 'harvard', 'vancouver', 'turabian', 'author date', 'notes bibliography', 'ama']);

/** A style word right after the name: "APA style", "MLA format", "IEEE citations", "APA 7th edition", "APA-formatted". */
const AFTER_CUE = /^[\s-]*(?:\(?\s*(?:\d{1,2}(?:st|nd|rd|th)?\s*(?:ed(?:ition)?\.?)?\s*\)?\s*)?)(?:style|format|formatting|formatted|citations?|citing|referencing|references?|reference\s+list|bibliography|in-text|edition|guidelines?|conventions?|rules)\b/i;
/** A bare edition number right after the name: "APA 7", "MLA 9". */
const AFTER_EDITION = /^\s*\(?\d{1,2}(?:st|nd|rd|th)?\)?(?![\d.])/;
/** An instruction right before the name: "use MLA", "in APA", "follow Chicago", "Citation style: APA". */
const BEFORE_STRONG = /(?:\b(?:use|using|uses|follow|follows|following|per|cite|cited|citing|cites|format|formatted|formatting|reference|referenced|document|documented|according to)\b(?:\s+(?:the|a|an|in|with|using|to|sources|references|citations|them|your|all))*\s*|\b(?:style|format|citations?|referencing)\s*[:=-]\s*)$/i;
/** A weaker cue: "in APA", "with MLA" — enough for an unambiguous acronym only. */
const BEFORE_WEAK = /\b(?:in|with|to)\s+(?:the\s+)?$/i;
/** Negation right before the name: "instead of APA", "rather than MLA", "not APA", "no Chicago". */
const BEFORE_NEGATION = /\b(?:instead\s+of|rather\s+than|not|no|never|without|avoid|avoiding|except|than|over|but\s+not|replace|replacing|switch\s+from|change\s+from|don['’]t|do\s+not|never)\s+(?:the\s+)?(?:(?:use|using|follow|following|cite\s+in|format\s+in|in)\s+)?(?:the\s+)?$/i;

interface StyleMention {
  readonly at: number;
  readonly end: number;
  readonly alias: string;
  readonly style: CslStyleKey;
}

/** Every alias mention in `text` at word boundaries, longest alias first, non-overlapping. */
function styleMentions(text: string): StyleMention[] {
  const taken: Array<[number, number]> = [];
  const out: StyleMention[] = [];
  for (const alias of citationStyleAliases()) {
    // Aliases are stored normalised ("chicago author date"); in text the parts
    // may be joined by spaces, dashes, brackets or "and".
    const pattern = alias
      .split(' ')
      .map(escapeRe)
      .join('[\\s()\\-–—/]+(?:and\\s+)?');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu');
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      if (taken.some(([a, b]) => at < b && end > a)) continue;
      const style = citationStyleKey(alias);
      if (style === null) continue;
      taken.push([at, end]);
      out.push({ at, end, alias, style: style as CslStyleKey });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * The citation style a text asks for, or null: a style name with an
 * instruction cue ("use MLA instead of APA" → mla; "APA style"; "APA 7";
 * "in MLA format"; "Citation style: Chicago"), never a negated one ("instead
 * of APA", "not MLA") and never a place or institution ("in Chicago",
 * "Harvard University"). When several clauses ask for different styles, the
 * LAST instruction wins (a later sentence corrects an earlier one).
 */
export function styleOverrideFrom(text: string): StyleOverride | null {
  let found: StyleOverride | null = null;
  for (const clause of clausesOf(text)) {
    for (const m of styleMentions(clause)) {
      const before = clause.slice(Math.max(0, m.at - 60), m.at);
      const after = clause.slice(m.end, m.end + 40);
      if (BEFORE_NEGATION.test(before)) continue;
      const ambiguous = AMBIGUOUS_STYLE_ALIASES.has(m.alias);
      const afterCue = AFTER_CUE.test(after) || (!ambiguous && AFTER_EDITION.test(after));
      const strong = BEFORE_STRONG.test(before) || afterCue;
      const weak = !ambiguous && BEFORE_WEAK.test(before);
      if (strong || weak) found = { style: m.style, evidence: oneLine(clause).slice(0, 200) };
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Sectioning notes (GRND-04)
// ---------------------------------------------------------------------------

/** Section names a sectioning instruction talks about. */
const SECTION_WORDS =
  /\b(?:abstract|introduction|intro|background|literature\s+review|lit(?:erature)?\s+survey|related\s+work|methods?|methodology|materials(?:\s+and\s+methods)?|results|findings|discussion|analysis|conclusions?|limitations|future\s+work|counterarguments?|rebuttal|objections?|recommendations?|appendix|appendices|case\s+stud(?:y|ies)|executive\s+summary|references|bibliography|annotated\s+bibliography)\b/i;
const SECTION_NOUN = /\b(?:sections?|headings?|subsections?|chapters?|parts?)\b/i;
const ORDER_CUE = /\b(?:before|after|between|following|precede[sd]?|then|first|last|start(?:ing)?\s+with|begin(?:ning)?\s+with|end(?:ing)?\s+with|open(?:ing)?\s+with|close\s+with|followed\s+by)\b/i;
const NEED_CUE = /\b(?:need|needs|include|includes|including|add|must|should|require[sd]?|requiring|want|have|has|contain|omit|skip|drop|exclude|without|no|separate|dedicated|own)\b/i;

/**
 * Plain-English sectioning instructions in a text ("I need a literature review
 * section before methods", "Include a limitations section", "Start with an
 * abstract", "No abstract"), one note per clause, in order, de-duplicated. A
 * clause is a note when it names a section and either orders it or asks for /
 * against it with a section noun. The task sentence itself ("Write a 1500-word
 * literature review on …") is not a note.
 */
export function sectioningNotesFrom(text: string): string[] {
  const out: string[] = [];
  for (const raw of clausesOf(text)) {
    const clause = oneLine(raw).replace(/^[-*•\d.)\s]+/, '');
    if (clause.length < 6 || clause.length > 300) continue;
    if (!SECTION_WORDS.test(clause) && !SECTION_NOUN.test(clause)) continue;
    const ordered = SECTION_WORDS.test(clause) && ORDER_CUE.test(clause);
    const asked = SECTION_NOUN.test(clause) && NEED_CUE.test(clause);
    const noSection = /^(?:no|without|omit|skip|drop)\b/i.test(clause) && SECTION_WORDS.test(clause);
    if (!ordered && !asked && !noSection) continue;
    const note = clause.replace(/[.;]+$/, '');
    if (!out.some((n) => n.toLowerCase() === note.toLowerCase())) out.push(note);
  }
  return out.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Length (GRND-02 default: the assignment's stated length)
// ---------------------------------------------------------------------------

function toInt(s: string): number {
  return Number(s.replace(/[,\s]/g, ''));
}

function plausible(n: number): number | null {
  return Number.isInteger(n) && n >= MIN_WORDS && n <= MAX_WORDS ? n : null;
}

/**
 * The length an assignment states, in words: "1500-word", "1,500 words",
 * "1500–2000 words" (the midpoint, rounded to 50), "5 pages" / "5-page" (×300),
 * "4–6 pages". Null when no plausible statement is found.
 */
export function statedLengthWords(text: string): number | null {
  const t = text.replace(/\r\n?/g, '\n');
  const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{2,6})`;
  const range = new RegExp(`${NUM}\\s*(?:-|–|—|to)\\s*${NUM}[\\s-]*words?\\b`, 'i').exec(t);
  if (range) {
    const lo = toInt(range[1] ?? '');
    const hi = toInt(range[2] ?? '');
    if (lo > 0 && hi >= lo) {
      const mid = plausible(Math.round((lo + hi) / 2 / 50) * 50);
      if (mid !== null) return mid;
    }
  }
  const words = new RegExp(`${NUM}[\\s-]*(?:words?|wds?)\\b`, 'i').exec(t);
  if (words) {
    const n = plausible(toInt(words[1] ?? ''));
    if (n !== null) return n;
  }
  const pageRange = /(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})[\s-]*pages?\b/i.exec(t);
  if (pageRange) {
    const lo = Number(pageRange[1]);
    const hi = Number(pageRange[2]);
    if (lo > 0 && hi >= lo) return plausible(Math.round(((lo + hi) / 2) * WORDS_PER_PAGE));
  }
  const pages = /(\d{1,2})[\s-]*pages?\b/i.exec(t);
  if (pages) return plausible(Number(pages[1]) * WORDS_PER_PAGE);
  return null;
}

/**
 * A length answer ("1500", "1,500 words", "6 pages") in words, or null when it
 * is not a plausible length.
 */
export function parseLengthAnswer(raw: string): number | null {
  const t = raw.trim();
  if (/^\d{1,3}(?:,\d{3})+$|^\d{2,6}$/.test(t)) return plausible(toInt(t));
  return statedLengthWords(t);
}

// ---------------------------------------------------------------------------
// Paper type
// ---------------------------------------------------------------------------

const PAPER_TYPE_CUES: ReadonlyArray<readonly [PaperType, RegExp]> = [
  ['literature-review', /\b(?:literature\s+review|lit(?:erature)?\s+survey|review\s+of\s+(?:the\s+)?(?:literature|research|evidence)|systematic\s+review|scoping\s+review)\b/i],
  ['lab-report', /\blab(?:oratory)?\s+report\b/i],
  ['research-report', /\bresearch\s+(?:report|paper|proposal)\b/i],
  ['primer', /\bprimer\b/i],
  ['summary', /\b(?:summary|summari[sz]e|summari[sz]ing|synopsis|abstract\s+of)\b/i],
  ['persuasive', /\bpersuasive\b|\bpersuade\b|\bconvince\b/i],
  ['argumentative', /\bargumentative\b|\bargue\b|\bargument\s+(?:essay|paper)\b|\bposition\s+paper\b|\btake\s+a\s+(?:clear\s+)?(?:position|stance|side)\b|\bdefend\s+(?:a|the|your)\s+(?:thesis|claim|position)\b/i],
  ['analytical', /\banalytical\b|\banaly[sz]e\b|\banalysis\b|\bcritically\s+(?:assess|evaluate|examine)\b/i],
  ['expository', /\bexpository\b|\bexplain\b|\bexplanatory\b|\binformative\b|\bdescribe\b/i],
];

/** The paper type an assignment asks for, else 'other' (sectioning instructions do not count). */
export function paperTypeFrom(text: string): PaperType {
  const body = clausesOf(text)
    .filter((c) => sectioningNotesFrom(c).length === 0)
    .join('\n');
  for (const [type, re] of PAPER_TYPE_CUES) if (re.test(body)) return type;
  return 'other';
}

/** Coerce a free-text paper type ("Literature Review", "argumentative essay") to PAPER_TYPES, else 'other'. */
export function normalizePaperType(raw: string): PaperType {
  const t = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if ((PAPER_TYPES as readonly string[]).includes(t)) return t as PaperType;
  return paperTypeFrom(raw);
}

// ---------------------------------------------------------------------------
// Topic phrase (a first guess; the clarifier's topic wins)
// ---------------------------------------------------------------------------

const TASK_VERB = /^(?:please\s+)?(?:write|compose|draft|prepare|produce|create|discuss|analy[sz]e|argue|examine|explore|describe|explain|review|evaluate|compare|contrast|investigate|research|assess|consider|summari[sz]e|critique|reflect|develop|present)\b/i;
/** A sentence that only instructs ("Use MLA for this paper", "Cite five sources", "Include a limitations section"). */
const INSTRUCTION_ONLY = /^(?:please\s+)?(?:use|follow|cite|include|add|submit|format|double[\s-]space|no|omit|skip|avoid|make\s+sure|remember|note|ensure)\b/i;
const NUMBER_WORDS = String.raw`(?:\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)`;
const REQUIREMENT_PARTS: readonly RegExp[] = [
  new RegExp(String.raw`^\(?\s*(?:about\s+|around\s+|at\s+least\s+|no\s+more\s+than\s+|max(?:imum)?\s+|min(?:imum)?\s+)?${NUMBER_WORDS}(?:\s*(?:-|–|—|to)\s*${NUMBER_WORDS})?[\s-]*(?:words?|pages?)\b`, 'i'),
  /\b(?:style|format|formatting|formatted|referencing|edition|double[\s-]spaced|single[\s-]spaced)\s*\)?\s*$/i,
  new RegExp(String.raw`^(?:citing|cite|using|use|with|including|include|drawing\s+on)\s+(?:at\s+least\s+|a\s+minimum\s+of\s+)?${NUMBER_WORDS}\s+(?:(?:peer[\s-]reviewed|scholarly|academic|credible|primary|secondary)\s+)*(?:sources|references|citations|articles|papers|studies)\b`, 'i'),
  /^(?:due|deadline|submit|submitted)\b/i,
];

/** A trailing "for my History class" / "for the PHIL 101 seminar" — who the paper is for, not what it is about. */
const COURSE_TAIL = /\s+(?:for\s+(?:my|our|the|this|your)|in\s+(?:my|our|your))\s+(?:[\p{L}\p{N}&.'’-]+\s+){0,4}(?:class|course|seminar|module|unit|lecture|tutorial|section)\s*$/iu;

function isRequirementPart(part: string): boolean {
  const p = part.trim().replace(/[.)]+$/, '');
  return p.length === 0 || citationStyleKey(p) !== null || REQUIREMENT_PARTS.some((re) => re.test(p));
}

/** Drop the comma- or semicolon-separated parts that state a style, a length, a source count or a deadline. */
function stripRequirementParts(s: string): string {
  const parts = s.split(/(?:,|;)\s+/);
  const kept = parts.filter((p) => !isRequirementPart(p));
  return kept.join(', ').replace(/,\s+(?=(?:on|about|regarding|concerning|of|into|that|whether)\s)/gi, ' ').trim();
}

/** The part of a `Label: text` clause after the label, when that part is a task sentence; null drops the clause. */
function unlabelled(clause: string): string | null {
  const m = /^([^:]{1,40}):\s+(.+)$/.exec(clause);
  if (!m) return clause;
  const rest = (m[2] ?? '').trim();
  return TASK_VERB.test(rest) ? rest : null;
}

/**
 * The first task sentence's topic phrase, with its instruction and requirements
 * stripped ('' when none). `taskVerbOnly` (the PII keep list) accepts only a
 * sentence that opens with a task verb ("Write …", "Argue …") — never the first
 * clause as a fallback, which may be "Reach me at …, or my advisor Jane Doe".
 */
function taskTopicPhrase(t: string, taskVerbOnly = false): string {
  const clauses = clausesOf(t)
    .filter((c) => !/^thesis\s+seed\s*:/i.test(c))
    .map(unlabelled)
    .filter((c): c is string => c !== null && !INSTRUCTION_ONLY.test(c) && sectioningNotesFrom(c).length === 0 && stripRequirementParts(oneLine(c).replace(/[.!?]+$/, '')).length > 0);
  const sentence = clauses.find((c) => TASK_VERB.test(c)) ?? (taskVerbOnly ? '' : clauses[0] ?? '');
  let s = stripRequirementParts(oneLine(sentence).replace(/[.!?]+$/, ''));
  s = s
    .replace(TASK_VERB, '')
    .replace(/^\s*(?:an?|one|your)\s+/i, '')
    .replace(/^\s*(?:(?:short|brief|detailed|critical|formal|well[\s-]researched|original|thoughtful|clear)\s+)*/i, '')
    .replace(new RegExp(String.raw`^\s*${NUMBER_WORDS}(?:\s*(?:-|–|—|to)\s*${NUMBER_WORDS})?[\s-]*(?:word|page)s?\s+`, 'i'), '')
    .replace(/^\s*(?:(?:argumentative|persuasive|analytical|expository|research|critical|reflective|comparative|academic|short|term|informative|explanatory)\s+)*/i, '')
    .replace(/^\s*(?:literature\s+review|lit(?:erature)?\s+survey|review|paper|essay|report|study|analysis|article|proposal|memo|primer|summary|brief|piece|assignment|lab\s+report|research\s+paper)s?\s*/i, '')
    .replace(/^\s*in\s+(?:english|plain\s+language|the\s+(?:first|third)\s+person)\s+/i, '')
    .replace(/^\s*(?:on|about|of|regarding|concerning|examining|exploring|discussing|covering|addressing|investigating|into|that\s+(?:examines|explores|discusses|analy[sz]es|argues))\s+/i, '')
    .replace(COURSE_TAIL, '')
    .replace(/[,;:]+$/, '')
    .trim();
  // "Write 6-8 pages." leaves only a requirement: no topic.
  return s.length >= 3 && !isRequirementPart(s) ? s.slice(0, 200) : '';
}

/** The value of the first `Label: …` line whose label matches `labels`, one line, no trailing dots ('' when none). */
function labelledLine(t: string, labels: RegExp): string {
  const re = new RegExp(String.raw`^\s*(?:paper\s+)?(?:${labels.source})\s*[:–—-]\s*(.+?)\s*$`, 'im');
  const v = re.exec(t)?.[1];
  return v && oneLine(v).length >= 3 ? oneLine(v).replace(/[.]+$/, '').slice(0, 200) : '';
}

/** Labels that state the paper's topic outright. */
const TOPIC_LABELS = /topic|research\s+question|prompt/;
/** Labels that name a document, not always its topic ("Title: Final Paper - Jane Doe", an e-mail "Subject:"). */
const TITLE_LABELS = /title|subject/;
/** A PII redaction tag (GRND-05): a topic that holds one is the last resort. */
const REDACTION_TAG = /\[REDACTED:[A-Z]+\]/;

/**
 * A short topic phrase from the assignment: a labelled `Topic:` / `Research
 * question:` line, else the first task sentence with its instruction and
 * requirements stripped ("Write a 1500-word literature review on attention
 * mechanisms in transformers, APA style." → "attention mechanisms in
 * transformers"), else a `Title:` / `Subject:` line (often a document name —
 * "Final Paper - Jane Doe" — so only when nothing better exists). A candidate
 * holding a PII redaction tag is used only when no other one is left. Label
 * lines (`Name: …`, `Due: …`) and instruction-only sentences ("Use MLA for this
 * paper") are never a topic. '' when nothing usable is left.
 */
export function topicFromAssignment(text: string): string {
  const t = text.replace(/\r\n?/g, '\n');
  const candidates = [labelledLine(t, TOPIC_LABELS), taskTopicPhrase(t), labelledLine(t, TITLE_LABELS)].filter((c) => c.length > 0);
  return candidates.find((c) => !REDACTION_TAG.test(c)) ?? candidates[0] ?? '';
}

/**
 * The assignment's labelled topic lines (`Topic: …`, `Research question: …`,
 * `Prompt: …`). A `Title:` or `Subject:` line is NOT one: it often names the
 * student or the instructor ("Title: Final Paper - Jane Doe", an e-mailed
 * "Subject: HIST 201 essay for Prof. Doe"), GRND-05.
 */
export function labelledTopicLines(text: string): string[] {
  const re = new RegExp(String.raw`^\s*(?:paper\s+)?(?:${TOPIC_LABELS.source})\s*[:–—-]\s*(.+?)\s*$`, 'gim');
  return [...text.replace(/\r\n?/g, '\n').matchAll(re)].map((m) => oneLine(m[1] ?? '')).filter((l) => l.length > 0);
}

/**
 * The phrases a PII redaction keeps (GRND-05 "terms from the topic line", D-18-12):
 * the labelled topic lines and the task sentence's topic phrase ("Write about
 * Abraham Lincoln and the Emancipation Proclamation" keeps both), so a paper may
 * be ABOUT a named person, place or event. Never a `Title:` / `Subject:` line.
 * pii.ts never applies the keep list on a person-labelled line (`Name:`,
 * `Student:`, `Instructor:` …) or after an honorific, so a student's own name
 * is redacted even when a topic phrase repeats it.
 */
export function topicKeepPhrases(text: string): string[] {
  const t = text.replace(/\r\n?/g, '\n');
  const out = labelledTopicLines(t);
  const task = taskTopicPhrase(t, true);
  if (task) out.push(task);
  return out;
}

const STOPWORDS: ReadonlySet<string> = new Set([
  'about', 'after', 'also', 'among', 'and', 'between', 'both', 'from', 'have', 'into', 'more', 'most', 'other',
  'over', 'paper', 'essay', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'under', 'upon', 'what', 'when', 'where', 'whether', 'which', 'while', 'with', 'within',
  'would', 'your', 'topic', 'study', 'analysis', 'review', 'report',
]);

function contentStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    out.add(w.slice(0, 5));
  }
  return out;
}

/**
 * True when a suggested topic shares a content word (a 5-letter stem of a
 * word of 4+ letters) with the assignment — a clarifier that parroted its own
 * template example, or answered about something else, is not grounded, and
 * intake uses topicFromAssignment() instead (GRND-02, D-18-10).
 */
export function topicIsGrounded(topic: string, assignment: string): boolean {
  const t = contentStems(topic);
  if (t.size === 0) return false;
  const a = contentStems(assignment);
  for (const s of t) if (a.has(s)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Discipline mention (a first guess; the clarifier's suggestion wins)
// ---------------------------------------------------------------------------

/** Words that make a preset name a course/field mention ("a Biology assignment", "my psych class"). */
const COURSE_NOUNS = String.raw`(?:class|course|seminar|module|program(?:me)?|department|major|minor|unit|assignment|homework|paper|essay|lab|project|coursework|exam)`;

/**
 * An explicit discipline mention in an assignment, as a preset slug, else
 * null: a labelled line (`Discipline: …`, `Subject: …`, `Field: …`,
 * `Course: …`, `Class: …`), or a preset name/alias used as a course or field
 * ("for my Biology class", "a psychology paper", "in economics"). Paper-type
 * phrases ("literature review") never count, and a bare word in running text
 * ("written in English") is not a mention.
 */
export function disciplineMentionFrom(text: string): string | null {
  const presets = Object.values(loadDisciplinePresets());
  const t = text.replace(/\r\n?/g, '\n').replace(/\bliterature\s+(?:review|survey|search)\b/gi, ' ');
  const names = (p: (typeof presets)[number]): string[] =>
    [p.slug.replace(/-/g, ' '), p.name, ...p.aliases]
      .flatMap((n) => n.split('/'))
      .map((n) => n.trim())
      .filter((n) => n.length >= 2);
  const labelled = /^\s*(?:discipline|subject(?:\s+area)?|field(?:\s+of\s+study)?|course|class|department|major)\s*[:–—-]\s*(.+?)\s*$/gim;
  for (const m of t.matchAll(labelled)) {
    const value = (m[1] ?? '').toLowerCase();
    for (const p of presets) {
      if (p.slug === FALLBACK_DISCIPLINE) continue;
      if (names(p).some((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n.toLowerCase()).replace(/\\ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'u').test(value))) return p.slug;
    }
  }
  let best: { slug: string; at: number } | null = null;
  for (const p of presets) {
    if (p.slug === FALLBACK_DISCIPLINE) continue;
    for (const n of names(p)) {
      const body = escapeRe(n).replace(/\\ /g, '\\s+').replace(/ /g, '\\s+');
      const res = [
        new RegExp(`(?<![\\p{L}\\p{N}])${body}\\s+${COURSE_NOUNS}\\b`, 'iu'),
        new RegExp(`\\b(?:in|of|for)\\s+(?:the\\s+)?(?:field\\s+of\\s+)?${body}(?:\\s+${COURSE_NOUNS})?(?![\\p{L}\\p{N}])(?=\\s*(?:[.,;:)]|$|\\s+${COURSE_NOUNS}))`, 'iu'),
      ];
      for (const re of res) {
        const m = re.exec(t);
        if (m && (best === null || (m.index ?? 0) < best.at)) best = { slug: p.slug, at: m.index ?? 0 };
      }
    }
  }
  return best?.slug ?? null;
}

// ---------------------------------------------------------------------------
// Thesis seed (sketch → new --thesis)
// ---------------------------------------------------------------------------

/** The line intake appends to the model-bound assignment for a `--thesis` seed. */
export const THESIS_SEED_LABEL = 'Thesis seed:';

/** Append a thesis seed to the model-bound assignment text (18-PLAN.md §3.3). */
export function withThesisSeed(assignment: string, thesis: string): string {
  const seed = oneLine(thesis);
  if (!seed) return assignment;
  const base = assignment.replace(/\s+$/, '');
  return base ? `${base}\n\n${THESIS_SEED_LABEL} ${seed}` : `${THESIS_SEED_LABEL} ${seed}`;
}

/** The thesis seed line of a model-bound assignment, or ''. */
export function thesisSeedFrom(text: string): string {
  const m = new RegExp(`^\\s*${escapeRe(THESIS_SEED_LABEL)}\\s*(.+)$`, 'im').exec(text.replace(/\r\n?/g, '\n'));
  return m ? oneLine(m[1] ?? '') : '';
}

// ---------------------------------------------------------------------------
// Everything at once
// ---------------------------------------------------------------------------

export interface IntakeOverrides {
  /** The citation style asked for in the assignment or an answer (the last instruction wins). */
  readonly citationStyle: StyleOverride | null;
  /** Sectioning instructions, assignment first, then answers. */
  readonly sectioningNotes: readonly string[];
  /** The length the assignment states, in words. */
  readonly lengthWords: number | null;
}

/**
 * The deterministic overrides of an intake: the assignment first, then each
 * free-text answer in order (a later statement corrects an earlier one for the
 * style; notes accumulate).
 */
export function parseIntakeOverrides(assignment: string, answers: readonly string[] = []): IntakeOverrides {
  let style = styleOverrideFrom(assignment);
  const notes = [...sectioningNotesFrom(assignment)];
  for (const a of answers) {
    const s = styleOverrideFrom(a);
    if (s !== null) style = s;
    for (const n of sectioningNotesFrom(a)) if (!notes.some((x) => x.toLowerCase() === n.toLowerCase())) notes.push(n);
  }
  return { citationStyle: style, sectioningNotes: notes.slice(0, 10), lengthWords: statedLengthWords(assignment) };
}
