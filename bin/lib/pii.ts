// bin/lib/pii.ts — PII redaction primitives (ARCH-17 / D-49; GRND-05, D-18-12).
//
// This module is the redaction chokepoint that the session log calls before
// every disk write (redactKeys, then deepRedactPii), and that intake calls on
// every piece of user text before a model sees it when the user opted in to
// PII redaction (GRND-05: the assignment, the answers, the thesis seed and the
// follow-up answers; the raw text stays only in .paper/INTAKE.raw.local).
//
// Per D-49 the implementation is HAND-ROLLED regex; we do not pull in a
// regex/PII library or an NLP model. Every pattern is reviewable in diff form —
// see the comment above each one.
//
// Threat model coverage:
//   T-01-06 (PII to disk)        — redactPii on every string the log writes
//   T-01-07 (secrets in headers)  — redactKeys SENSITIVE set
//   T-01-08 (proto pollution)     — Object.create(null) clone containers +
//                                   isPlainObject proto guard
//   T-01-REDOS-01 (regex DoS)     — bounded quantifiers only (name tokens ≤ 21
//                                   letters, ≤ 3 initials / particles, ids ≤ 25
//                                   chars); no nested unbounded repetition
//
// Classes (GRND-05):
//   EMAIL, PHONE (US and +international), SSN, ID (a labelled identifier:
//   "Student ID: 2024-00173", "ID no. 44-1234", "SSN: 123456789"), IP, IBAN,
//   NAME (two or three capitalised tokens, with middle initials — "Jane Q.
//   Doe" —, hyphens — "Mary-Anne Smith" —, apostrophes — "O'Brien" —, and
//   particles — "Karl-Heinz van der Berg", "María de la Cruz"; an honorific
//   plus a surname — "Prof. Smith"), DATE (ISO, US, EU and textual: "March 3,
//   2026", "3 March 2026", "Mar. 3").
//
// Precision (GRND-05): a NAME candidate is NOT redacted when
//   - every token is a curated non-name word (name-suppression.json: months,
//     section headings, sentence-leading function words, academic terms);
//   - its last token is an entity head noun (Revolution, War, Treaty, Republic,
//     Empire, University, Act, …: "French Revolution", "Roman Empire") or its
//     first token opens an entity name ("Treaty …", "Lake …", "Mount …");
//   - its last token is a month or weekday — a date fragment ("Due March");
//   - every token belongs to a caller-supplied keep list (intake passes the
//     assignment's topic phrases — a labelled Topic line and the task
//     sentence's topic, intake-overrides.ts topicKeepPhrases: a paper may be
//     ABOUT a person) — except on a person-labelled line ("Name:", "Student:",
//     "Instructor:" …) or right after an honorific, where it never applies;
//   - it ends in a number word after an entity head ("World War One");
//   - it ends in a citation-style name followed by a style word ("Use Chicago
//     style", "Follow Harvard referencing"): an instruction, not a person.
//
// Identifiers are never rewritten (GRND-05): UUIDs (paperIds), DOIs, ISBNs,
// arXiv ids, ISO-8601 timestamps and long hex digests are found first, and a
// PII candidate that overlaps one is dropped — so SESSION.log keeps every
// paperId and DOI intact (the PHONE rule used to log `1[REDACTED:PHONE]-4333-…`).
//
// Pure module: NO I/O, NO fs, NO fetch, NO logging. The only import is a
// statically-bundled JSON data file (name-suppression.json) resolved at
// module load — not runtime I/O. diffPii is pure and deterministic.

import nameSuppression from './name-suppression.json' with { type: 'json' };

export type PiiKind = 'EMAIL' | 'PHONE' | 'SSN' | 'ID' | 'NAME' | 'DATE' | 'IP' | 'IBAN';

export interface PiiMatch {
  kind: PiiKind;
  span: [number, number];
  raw: string;
}

/** Caller options for one redaction. */
export interface PiiOptions {
  /**
   * Phrases whose capitalised words are never redacted as a NAME (e.g. the
   * assignment's labelled topic line — "Topic: Abraham Lincoln's speeches").
   * Every other class is unaffected.
   */
  readonly keep?: readonly string[];
  /**
   * Classes not to redact in this text. The session log passes NAME, DATE and
   * IP for a machine-written transport error ("Headers Timeout Error",
   * "Service Unavailable", a Retry-After date, the pinned address): its
   * capitalised words are an error's words, not a person's name (GRND-05).
   */
  readonly exclude?: readonly PiiKind[];
}

// ---------------------------------------------------------------------------
// Regex specifications. A change to a pattern is a spec change: note it in the
// phase SUMMARY and extend tests/fixtures/pii/ (the gold set).
// ---------------------------------------------------------------------------

/** No letter or digit before (a Unicode-aware \b for the u-flag patterns). */
const L_EDGE = String.raw`(?<![\p{L}\p{N}])`;
/** No letter or digit after. */
const R_EDGE = String.raw`(?![\p{L}\p{N}])`;

// EMAIL — standard local-part (apostrophes included: o'brien@…) + dotted
// domain. Intentionally not RFC-strict: "false positives acceptable, false
// negatives are the failure mode" (D-49).
const RE_EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// PHONE (US) — optional country code, optional parens around the area code,
// optional separators (dash / dot / space).
const RE_PHONE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

// PHONE (international) — a leading "+", a 1-3 digit country code, then 2-5
// digit groups; kept only when it has 8 to 15 digits (E.164) — see classify.
const RE_PHONE_INTL = /\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?!\d)/g;

// SSN — word-boundary anchored canonical dashed form ONLY (the spaceless form
// is caught only after an "SSN" label, by the ID class).
const RE_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

// ID — a labelled identifier. Only the VALUE (group 1) is redacted, so the
// label stays readable ("Student ID: [REDACTED:ID]"). The value must hold a
// digit and be 3-25 characters (or a spaced SSN, "123 45 6789"); the label is
// one of the common ID labels, and no letter may follow it (review round 3 of
// Phase 18: "since 1990" is not the label "sin" plus the value "ce 1990").
const ID_LABEL = String.raw`(?:(?:student|employee|staff|matriculation|matric|registration|enrol(?:l)?ment|passport|licen[cs]e|patient|member(?:ship)?|account|candidate|exam(?:ination)?|library|badge|university|school|campus|roll|admission|application|tax|insurance)\s*(?:id|identification|no\.?|number|num\.?|#|code)|identification(?:\s*(?:no\.?|number|num\.?|#|code))?|id\s*(?:no\.?|number|num\.?|#|code)|ssn|social\s+security(?:\s+(?:no\.?|number))?|nhs\s+(?:no\.?|number))`;
const ID_VALUE = String.raw`(\d{3}[ ]\d{2}[ ]\d{4}|[A-Za-z]{0,4}[-\s]?\d[\dA-Za-z-]{2,24})`;
const RE_ID = new RegExp(
  String.raw`${L_EDGE}${ID_LABEL}(?![\p{L}])\s*[:#=]?\s*(?:is\s+)?${ID_VALUE}${R_EDGE}`,
  'giud',
);
// The bare labels "ID" and "SIN" name an identifier only with a ":" / "#"
// ("ID: A-2201"), or before a value of the expected shape: an "ID" of 5+
// digits ("ID 20231187"), a 9-digit SIN ("SIN 123 456 789") — never "the id 42
// row", "sin 90 degrees", "idea 2024" or "since 1990".
const RE_ID_WEAK = new RegExp(
  String.raw`${L_EDGE}(?:(?:id|sin)(?![\p{L}])\s*[:#]\s*(?:is\s+)?${ID_VALUE}|id(?![\p{L}])\s+(\d(?:[\d-]*\d){4,24})|sin(?![\p{L}])\s+(\d{3}[- ]?\d{3}[- ]?\d{3}))${R_EDGE}`,
  'giud',
);

// IP — dotted-quad IPv4 literal, not range-validated (D-49).
const RE_IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

// IBAN-like — country code + 2 check digits + 4-30 alphanumerics (bounded).
const RE_IBAN_LIKE = /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g;

// NAME — Unicode-aware. A name token: an optional "O'"-style prefix, a
// capital and 1-20 lower-case letters, an optional "Mc"/"Mac"-style inner
// capital part, an optional hyphenated second part ("Mary-Anne", or a short
// lower-case syllable: "Min-jun", "Seo-yeon"). Between the
// first token and each next one: up to three middle initials ("Q.") and up to
// three lower-case particles ("van der", "de la"). Two or three tokens.
const NAME_TOKEN = String.raw`(?:\p{Lu}['’])?\p{Lu}\p{Ll}{1,20}(?:\p{Lu}\p{Ll}{1,20})?(?:-(?:\p{Lu}\p{Ll}{1,20}|\p{Ll}{2,5}))?`;
const NAME_INITIAL = String.raw`\p{Lu}\.`;
const NAME_PARTICLE = String.raw`(?:van|von|der|den|de|del|della|degli|di|da|du|dos|das|la|le|ter|ten|bin|ibn|al|el|zu|y)`;
const RE_NAME = new RegExp(
  String.raw`${L_EDGE}${NAME_TOKEN}(?:(?:[ ]${NAME_INITIAL}){0,3}(?:[ ]${NAME_PARTICLE}){0,3}[ ]${NAME_TOKEN}){1,2}${R_EDGE}`,
  'gu',
);
// NAME with leading initials: "J. R. Smith", "A. Vaswani".
const RE_NAME_INITIALS_FIRST = new RegExp(
  String.raw`${L_EDGE}${NAME_INITIAL}(?:[ ]?${NAME_INITIAL}){0,2}(?:[ ]${NAME_PARTICLE}){0,3}[ ]${NAME_TOKEN}${R_EDGE}`,
  'gu',
);
// NAME after an honorific: "Prof. Smith", "Dr Okafor", "Dr. Helen Park" —
// the whole name (group 1, up to three tokens) is redacted, the honorific kept.
const RE_NAME_HONORIFIC = new RegExp(
  String.raw`${L_EDGE}(?:Dr|Prof|Professor|Mr|Mrs|Ms|Mx|Miss|Sir|Dame|Rev|Hon)\.?[ ]+((?:${NAME_PARTICLE}[ ]){0,3}${NAME_TOKEN}(?:(?:[ ]${NAME_INITIAL}){0,3}(?:[ ]${NAME_PARTICLE}){0,3}[ ]${NAME_TOKEN}){0,2})${R_EDGE}`,
  'gud',
);

// NAME suppression dictionary (Phase 9): ~600 curated capitalised tokens the
// loose NAME regex over-matches (months, weekdays, section headings,
// sentence-leading function words, academic terms). Bundled JSON, read once.
const NAME_SUPPRESSION: ReadonlySet<string> = new Set<string>(nameSuppression);

// Entity head nouns (GRND-05): a capitalised phrase ENDING in one of these is
// an event, institution, place or document, not a person.
const ENTITY_HEADS: ReadonlySet<string> = new Set([
  'Revolution', 'Revolutions', 'War', 'Wars', 'Treaty', 'Treaties', 'Republic', 'Empire', 'Kingdom', 'Dynasty',
  'University', 'College', 'Institute', 'Academy', 'School', 'Act', 'Acts', 'Bill', 'Amendment', 'Constitution',
  'Declaration', 'Charter', 'Accord', 'Accords', 'Agreement', 'Pact', 'Convention', 'Doctrine', 'Plan', 'Deal',
  'Union', 'League', 'Alliance', 'Coalition', 'Party', 'Parliament', 'Congress', 'Senate', 'Assembly', 'Council',
  'Court', 'Tribunal', 'Church', 'Cathedral', 'Temple', 'Mosque', 'Movement', 'Era', 'Age', 'Period', 'Crisis',
  'Depression', 'Recession', 'Renaissance', 'Reformation', 'Enlightenment', 'Rebellion', 'Uprising', 'Revolt',
  'Riots', 'Massacre', 'Battle', 'Siege', 'Campaign', 'Expedition', 'Crusade', 'Crusades', 'Army', 'Navy',
  'Force', 'Forces', 'Guard', 'Corps', 'Bank', 'Company', 'Corporation', 'Foundation', 'Society', 'Association',
  'Organization', 'Organisation', 'Agency', 'Commission', 'Ministry', 'Office', 'Bureau', 'Service', 'Hospital',
  'Museum', 'Library', 'Press', 'Times', 'Journal', 'Review', 'Prize', 'Award', 'Ocean', 'Sea', 'River', 'Lake',
  'Mountains', 'Mountain', 'Valley', 'Desert', 'Island', 'Islands', 'Peninsula', 'Coast', 'Bay', 'Canal', 'Bridge',
  'Street', 'Avenue', 'Road', 'Square', 'Park', 'State', 'States', 'City', 'County', 'Province', 'Region',
  'Territory', 'Colony', 'Colonies', 'Nations', 'Commonwealth', 'Federation', 'Confederacy', 'Summit',
  'Conference', 'Festival', 'Games', 'Olympics', 'Cup', 'Syndrome', 'Disease', 'Effect', 'Theory', 'Theorem',
  'Law', 'Laws', 'Principle', 'Paradox', 'Hypothesis', 'Model', 'Test', 'Scale', 'Index', 'Program', 'Programme',
  'Project', 'Mission', 'Initiative', 'Policy', 'Report', 'Survey', 'Census', 'Study', 'Trial', 'Trials',
  // Continents, regions and landforms ("Southeast Asia", "Amazon Basin", "Sub-Saharan Africa").
  'Asia', 'Africa', 'America', 'Americas', 'Europe', 'Oceania', 'Antarctica', 'Arctic', 'Basin', 'Delta',
  'Plateau', 'Highlands', 'Lowlands', 'Rainforest', 'Strait', 'Straits', 'Archipelago', 'Subcontinent',
  'Hemisphere', 'Canyon', 'Reef', 'Glacier',
  // Topics and events that read as two capitalised words ("Social Media", "Black Death",
  // "Emancipation Proclamation", "Climate Change", "Civil Rights"; a field of study whose
  // head word is lint-reserved outside tutorial.ts is in name-suppression.json instead).
  'Media', 'Intelligence', 'Networks', 'Warming', 'Change', 'Rights', 'Proclamation', 'Death',
  'Plague', 'Famine', 'Pandemic', 'Epidemic', 'Genocide', 'Holocaust',
  // Coursework documents ("Final Paper", "Term Essay").
  'Paper', 'Essay', 'Assignment', 'Exam', 'Thesis', 'Dissertation',
  // The last word of a multiword place name no one bears as a surname ("Great Britain",
  // "Los Angeles", "New Zealand", "Buenos Aires", "Sri Lanka"; review round 3).
  'Britain', 'Zealand', 'Angeles', 'Aires', 'Janeiro', 'Lanka', 'Arabia', 'Korea', 'Guinea', 'Vegas', 'Francisco',
  'Delhi', 'Orleans', 'Scotia', 'Herzegovina', 'Tobago', 'Emirates',
]);

// Words that OPEN an entity name ("Treaty …", "Lake …", "Mount …", "Fort …").
const ENTITY_OPENERS: ReadonlySet<string> = new Set([
  'Treaty', 'Battle', 'Siege', 'Act', 'Bank', 'University', 'Kingdom', 'Republic', 'Empire', 'Church', 'Council',
  'House', 'Ministry', 'Department', 'Museum', 'Lake', 'Mount', 'Fort', 'Cape', 'Port', 'Gulf', 'Isle',
  // Region and era qualifiers no one bears as a first name ("Southeast Asia", "Middle East",
  // "Latin America", "World War One", "Soviet Union", "Global South").
  'Southeast', 'Southwest', 'Northeast', 'Northwest', 'Sub-Saharan', 'Middle', 'Global', 'Latin', 'Central',
  'Northern', 'Southern', 'Eastern', 'Western', 'Greater', 'Upper', 'Lower', 'Ancient', 'Medieval', 'Imperial',
  'Colonial', 'Soviet', 'World',
  // The first word of a multiword place name ("Great Britain", "New York", "Los Angeles",
  // "San Francisco", "Monte Carlo", "Hong Kong", "South Korea"; review round 3).
  'Great', 'New', 'Los', 'Las', 'San', 'Santa', 'Santo', 'Sao', 'São', 'Rio', 'Buenos', 'Costa', 'Puerto', 'Porto',
  'Sri', 'Hong', 'Tel', 'Kuala', 'Abu', 'Addis', 'Baton', 'Palo', 'Saudi', 'Monte', 'North', 'South', 'East', 'West',
]);

// Number words: a candidate that ends in one after an entity head is an event ("World War One").
const NUMBER_TOKENS: ReadonlySet<string> = new Set([
  'One', 'Two', 'Three', 'Four', 'Five', 'First', 'Second', 'Third', 'Fourth', 'Fifth',
]);

// Person labels (GRND-05): a line opening with one of these ("Name: …", "Student: …",
// "Instructor: …") holds people, so the caller's keep list never applies on it — a
// topic phrase that repeats the student's name must not un-redact the cover block.
const PERSON_LINE = /^[ \t]*(?:(?:full[ \t]+)?name|student(?:[ \t]+name)?|author|authors|by|written[ \t]+by|submitted[ \t]+by|prepared[ \t]+by|instructor|professor|prof\.?|teacher|lecturer|tutor|ta|teaching[ \t]+assistant|advis[eo]r|supervisor|mentor|from|to|cc|group[ \t]+members?|team[ \t]+members?|members?|partners?|contact|signed|signature)[ \t]*:[^\n]*/gimu;

// An honorific right before a candidate: a person, whatever the keep list says.
const HONORIFIC_BEFORE = /(?:^|[^\p{L}])(?:Dr|Prof|Professor|Mr|Mrs|Ms|Mx|Miss|Sir|Dame|Rev|Hon)\.?[ ]+$/u;

// Citation-style names (GRND-05 × GRND-04): a candidate ending in one of these
// and followed by a style word names a citation style ("Use Chicago style"),
// not a person — the redactor must not eat the style instruction.
const CITATION_STYLE_NAMES: ReadonlySet<string> = new Set([
  'Chicago', 'Harvard', 'Vancouver', 'Turabian', 'Oxford', 'Bluebook', 'APA', 'MLA', 'IEEE', 'AMA',
]);
const STYLE_WORD_AFTER = /^[ ]+(?:style|styles|format|formatting|citations?|referencing|references|reference[ ]style|notes|author-date|manual)\b/i;

// Month and weekday names and abbreviations: a candidate ending in one is a
// date fragment ("Due March"), never a person.
const DATE_WORDS: ReadonlySet<string> = new Set([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November',
  'December', 'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec', 'Monday',
  'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Mon', 'Tue', 'Tues', 'Wed', 'Thu', 'Thur',
  'Thurs', 'Fri', 'Sat', 'Sun',
]);

// DATE — numeric: ISO, US, EU.
const RE_DATE_ISO = /\b\d{4}-\d{2}-\d{2}\b/g;
const RE_DATE_US = /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g;
const RE_DATE_EU = /\b(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:19|20)\d{2}\b/g;
// DATE — textual (GRND-05): "March 3, 2026", "Mar. 3", "March 3rd", "3 March
// 2026", "3rd of March". A month with a year only ("June 2017") is not a
// date of anyone's — it is left alone.
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const DAY = String.raw`(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?`;
const RE_DATE_TEXT_MDY = new RegExp(String.raw`${L_EDGE}${MONTH}\.?[ ]${DAY}(?:,?[ ](?:1[89]|20)\d{2})?${R_EDGE}`, 'gu');
const RE_DATE_TEXT_DMY = new RegExp(String.raw`${L_EDGE}${DAY}[ ](?:of[ ])?${MONTH}\.?(?:,?[ ](?:1[89]|20)\d{2})?${R_EDGE}`, 'gu');

// Identifiers that are never PII and must pass through unchanged (GRND-05).
const PROTECTED: readonly RegExp[] = [
  // UUID (paperIds, session ids).
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
  // DOI anywhere in text (a URL path included); ends at whitespace or a quote.
  new RegExp(String.raw`${L_EDGE}10\.\d{4,9}\/[^\s"'<>]+`, 'gu'),
  // ISBN: labelled (10 or 13 digits, hyphens / spaces allowed) or a bare 978/979 ISBN-13.
  /ISBN(?:-1[03])?:?\s*(?:[\dX][-\s]?){9,16}[\dX]/gi,
  new RegExp(String.raw`${L_EDGE}97[89](?:[-\s]?\d){10}${R_EDGE}`, 'gu'),
  // arXiv: new style (2305.12345v2) and old style (hep-th/9901001).
  new RegExp(String.raw`${L_EDGE}(?:arXiv:\s*)?\d{4}\.\d{4,5}(?:v\d{1,3})?${R_EDGE}`, 'giu'),
  new RegExp(String.raw`${L_EDGE}(?:arXiv:\s*)?[a-z]{2,8}(?:-[a-z]{2,8})?(?:\.[A-Z]{2})?\/\d{7}(?:v\d{1,3})?${R_EDGE}`, 'gu'),
  // ISO-8601 timestamps (a date with a time) — log timestamps, createdAt.
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?/g,
  // Hex digests / ids of 16+ characters holding a letter and a digit (sha256, request hashes).
  new RegExp(String.raw`${L_EDGE}(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{16,128}${R_EDGE}`, 'gu'),
];

interface Pattern {
  readonly kind: PiiKind;
  readonly re: RegExp;
  /** Redact only this capture group (label patterns) — the first of several that matched. */
  readonly group?: number | readonly number[];
}

// Scan order matters only for exact-tie overlaps (earlier = higher priority):
// the structured classes (EMAIL, PHONE, SSN, ID, IP, IBAN) come before NAME.
const PATTERNS: readonly Pattern[] = [
  { kind: 'EMAIL', re: RE_EMAIL },
  { kind: 'PHONE', re: RE_PHONE },
  { kind: 'PHONE', re: RE_PHONE_INTL },
  { kind: 'SSN', re: RE_SSN },
  { kind: 'ID', re: RE_ID, group: 1 },
  { kind: 'ID', re: RE_ID_WEAK, group: [1, 2, 3] },
  { kind: 'IP', re: RE_IP },
  { kind: 'IBAN', re: RE_IBAN_LIKE },
  { kind: 'DATE', re: RE_DATE_TEXT_MDY },
  { kind: 'DATE', re: RE_DATE_TEXT_DMY },
  { kind: 'NAME', re: RE_NAME },
  { kind: 'NAME', re: RE_NAME_INITIALS_FIRST },
  { kind: 'NAME', re: RE_NAME_HONORIFIC, group: 1 },
  { kind: 'DATE', re: RE_DATE_ISO },
  { kind: 'DATE', re: RE_DATE_US },
  { kind: 'DATE', re: RE_DATE_EU },
];

// ---------------------------------------------------------------------------
// NAME precision (Phase 9 suppression + GRND-05 exclusions).
// ---------------------------------------------------------------------------

/** Name tokens of a candidate: the capitalised words (initials and particles dropped). */
function nameTokens(raw: string): string[] {
  return raw.split(/\s+/).filter((t) => /^(?:\p{Lu}['’])?\p{Lu}\p{Ll}/u.test(t));
}

/** Capitalised words of the caller's keep phrases. */
function keepTokens(keep: readonly string[] | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const phrase of keep ?? []) {
    for (const w of phrase.split(/[^\p{L}'’-]+/u)) if (/^\p{Lu}/u.test(w)) out.add(w.replace(/['’]s$/u, ''));
  }
  return out;
}

/**
 * Trim or drop a NAME candidate (null = not a person's name).
 *
 * In a PERSON CONTEXT (`person`: a person-labelled line, right after an
 * honorific, or a "prepared by …" name list) every capitalised name token is
 * a name: no entity, date, number, style or keep rule applies there (GRND-05,
 * review round 3 — "Student: Jiwoo Park", "Instructor: Grace Law", "Dr. Helen
 * Park"); only a candidate made entirely of curated non-name words (months
 * excepted: "April May" is a person) is dropped.
 *
 * Elsewhere:
 *   1. every token suppressed → drop ("Results Section", "January March");
 *   2. strip leading suppressed words while ≥ 2 name tokens remain (a
 *      sentence-initial verb or heading word: "Compare Great Britain" →
 *      "Great Britain", "Author Jane Smith" → "Jane Smith"; "In Smith" keeps
 *      both), then judge what is left:
 *   3. the last token a citation-style name and `after` (the text right after
 *      the candidate) opens with a style word → drop ("Use Chicago style");
 *   4. the last token a month/weekday → drop ("Due March");
 *   5. the last token an entity head, or the first an entity opener → drop
 *      ("French Revolution", "Lake Erie", "Great Britain", "Los Angeles");
 *   6. a number word after an entity head → drop ("World War One");
 *   7. every token in the keep list → drop (the paper's own topic).
 * Returns the kept text and its offset in `raw`.
 */
function resolveName(
  raw: string,
  keep: ReadonlySet<string>,
  after = '',
  person = false,
): { raw: string; startDelta: number } | null {
  const all = nameTokens(raw);
  if (all.length === 0) return null;
  if (person) {
    return all.every((t) => NAME_SUPPRESSION.has(t) && !DATE_WORDS.has(t)) ? null : { raw, startDelta: 0 };
  }
  if (all.every((t) => NAME_SUPPRESSION.has(t))) return null;
  const words = raw.split(' ');
  let start = 0;
  let remaining = all.length;
  while (start < words.length - 1 && remaining > 2 && NAME_SUPPRESSION.has(words[start] as string)) {
    start += 1;
    remaining -= 1;
  }
  const startDelta = start === 0 ? 0 : words.slice(0, start).join(' ').length + 1;
  const kept = raw.slice(startDelta);
  const tokens = nameTokens(kept);
  const last = tokens[tokens.length - 1] as string;
  const first = tokens[0] as string;
  const lastBase = last.split('-').pop() as string;
  if (CITATION_STYLE_NAMES.has(last) && STYLE_WORD_AFTER.test(after)) return null;
  if (DATE_WORDS.has(last) || DATE_WORDS.has(lastBase)) return null;
  if (ENTITY_HEADS.has(last) || ENTITY_HEADS.has(lastBase) || ENTITY_OPENERS.has(first)) return null;
  if (NUMBER_TOKENS.has(last) && tokens.slice(0, -1).some((t) => ENTITY_HEADS.has(t))) return null;
  if (keep.size > 0 && tokens.every((t) => keep.has(t))) return null;
  return { raw: kept, startDelta };
}

// ---------------------------------------------------------------------------
// classifyPii — returns spans in source order, no overlaps.
// Overlap rule: longer raw wins; on tie, the earlier pattern wins.
// ---------------------------------------------------------------------------

/** Spans of identifiers that must never be rewritten (UUIDs, DOIs, ISBNs, arXiv ids, ISO timestamps, digests). */
export function protectedSpans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const re of PROTECTED) {
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      out.push([at, at + m[0].length]);
    }
  }
  return out;
}

function overlapsAny(span: [number, number], spans: ReadonlyArray<[number, number]>): boolean {
  return spans.some(([a, b]) => span[0] < b && span[1] > a);
}

// A name list after "prepared by", "submitted by", "written by" … with no colon
// ("Prepared by Grace Law and Tom Church."): its names are people (review round 3).
const PERSON_PHRASE = /(?<![\p{L}])(?:prepared|submitted|written|authored|co-authored|compiled|edited|signed|graded|taught|supervised|presented|reviewed|assessed|marked)[ \t]+by[ \t]+/giu;
const PERSON_LIST = /^(?:(?:\p{Lu}[\p{L}'’-]{0,30}\.?|van|von|der|den|de|del|della|di|da|du|la|le|and|&|,)[ \t]{0,4}){1,40}/u;

/** Spans of the name lists after "prepared by" / "submitted by" … (see PERSON_PHRASE). */
function personPhraseSpans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(PERSON_PHRASE)) {
    const at = (m.index ?? 0) + m[0].length;
    const list = PERSON_LIST.exec(text.slice(at, at + 400));
    if (list !== null) out.push([at, at + list[0].length]);
  }
  return out;
}

/** Spans of the person-labelled lines ("Name: …", "Student: …", "Instructor: …"). */
function personLineSpans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(PERSON_LINE)) {
    const at = m.index ?? 0;
    out.push([at, at + m[0].length]);
  }
  return out;
}

export function classifyPii(text: string, opts: PiiOptions = {}): PiiMatch[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const keepAll = keepTokens(opts.keep);
  const noKeep: ReadonlySet<string> = new Set();
  const shielded = protectedSpans(text);
  const personSpans = [...personLineSpans(text), ...personPhraseSpans(text)];
  // A person context — a person-labelled line, a "prepared by" name list, or
  // right after an honorific — holds people: no keep list, entity or date rule
  // un-redacts a name there (resolveName).
  const personAt = (start: number, end: number): boolean =>
    overlapsAny([start, end], personSpans) || HONORIFIC_BEFORE.test(text.slice(Math.max(0, start - 14), start));

  const candidates: Array<PiiMatch & { order: number }> = [];
  const excluded: ReadonlySet<PiiKind> = new Set(opts.exclude ?? []);
  PATTERNS.forEach(({ kind, re, group }, order) => {
    if (excluded.has(kind)) return;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? -1;
      if (at < 0) continue;
      let raw = m[0];
      let start = at;
      if (group !== undefined) {
        const which = (typeof group === 'number' ? [group] : group).find((g) => m[g] !== undefined);
        const idx = which === undefined ? undefined : (m as RegExpMatchArray & { indices?: Array<[number, number] | undefined> }).indices?.[which];
        const g = which === undefined ? undefined : m[which];
        if (!idx || g === undefined) continue;
        raw = g;
        start = idx[0];
      }
      if (kind === 'PHONE' && re === RE_PHONE_INTL) {
        const digits = raw.replace(/\D/g, '').length;
        if (digits < 8 || digits > 15) continue;
      }
      if (kind === 'NAME') {
        const person = re === RE_NAME_HONORIFIC || personAt(start, start + raw.length);
        const resolved = resolveName(raw, person ? noKeep : keepAll, text.slice(start + raw.length, start + raw.length + 40), person);
        if (resolved === null) continue;
        raw = resolved.raw;
        start += resolved.startDelta;
      }
      const span: [number, number] = [start, start + raw.length];
      if (overlapsAny(span, shielded)) continue;
      candidates.push({ kind, span, raw, order });
    }
  });

  // Start ascending; on a tie, longer first, then pattern order.
  candidates.sort((a, b) => a.span[0] - b.span[0] || b.raw.length - a.raw.length || a.order - b.order);

  const accepted: Array<PiiMatch & { order: number }> = [];
  for (const cand of candidates) {
    const last = accepted[accepted.length - 1];
    if (!last || cand.span[0] >= last.span[1]) {
      accepted.push(cand);
      continue;
    }
    // Overlap: keep the longer; on a tie keep `last` (earlier start / pattern).
    if (cand.raw.length > last.raw.length) accepted[accepted.length - 1] = cand;
  }
  return accepted.map(({ kind, span, raw }) => ({ kind, span, raw }));
}

// ---------------------------------------------------------------------------
// redactPii — splice spans right-to-left so offsets remain valid.
// ---------------------------------------------------------------------------

export function redactPii(text: string, opts: PiiOptions = {}): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  const spans = classifyPii(text, opts);
  if (spans.length === 0) return text;
  let out = text;
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i];
    if (!s) continue;
    out = out.slice(0, s.span[0]) + `[REDACTED:${s.kind}]` + out.slice(s.span[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// diffPii — pure, deterministic, reviewable diff (Phase 9 / ERGO-07).
//
// One entry per classified span of `original`, tagged with the same
// `[REDACTED:${kind}]` literal redactPii splices in. The optional `redacted`
// argument is accepted only for API symmetry; the diff is computed from
// `original` alone (a character diff would be ambiguous under tied spans).
// Feeding already-redacted text yields an empty diff (the tags hold no PII).
// ---------------------------------------------------------------------------

export interface PiiDiff {
  span: [number, number];
  kind: PiiKind;
  raw: string;
  tag: string;
}

export function diffPii(original: string, _redacted?: string, opts: PiiOptions = {}): PiiDiff[] {
  void _redacted;
  return classifyPii(original, opts).map((m) => ({
    span: m.span,
    kind: m.kind,
    raw: m.raw,
    tag: `[REDACTED:${m.kind}]`,
  }));
}

// ---------------------------------------------------------------------------
// redactKeys — recursive deep-clone with sensitive-key value replacement.
// ---------------------------------------------------------------------------

// 15 keys, lowercase, exact-token match (case-insensitive via toLowerCase
// on the property name). Any change is a spec deviation — see SUMMARY.
const SENSITIVE: ReadonlySet<string> = new Set([
  'authorization',
  'x-api-key',
  'api_key',
  'apikey',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'client_secret',
  'cookie',
  'set-cookie',
  'password',
  'passwd',
  'ssn',
  'ssn_last4',
]);

// Plain-object guard: refuses class instances, Map, Set, Date, Buffer,
// Error, etc. Their prototype is not Object.prototype (or null for
// Object.create(null)) — we treat them as opaque scalars.
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Pure deep-clone that uses Object.create(null) containers for plain
// objects. This means __proto__ keys (when planted as own properties via
// JSON.parse) become inert data on a null-prototype object — they never
// reach Object.prototype.
function deepClone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deepClone);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(v)) {
      out[k] = deepClone(v[k]);
    }
    return out;
  }
  // Scalars and opaque objects (class instances, Map, Set, Date, Buffer,
  // Error...) returned by reference. They are NOT traversed and NOT
  // mutated; any sensitive-key path that points at one will be replaced
  // wholesale with '[REDACTED]' in the walk pass below.
  return v;
}

// Walk the cloned tree and replace sensitive-key values. Mutates the clone
// in place (which is safe — caller never sees the clone container).
function walkAndRedact(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) walkAndRedact(item);
    return;
  }
  if (!isPlainObject(node)) return;

  for (const key of Object.keys(node)) {
    const lower = key.toLowerCase();
    const val = node[key];
    if (SENSITIVE.has(lower)) {
      // Replace value. Per spec:
      //   - string with classifiable PII → keep redactPii(value)
      //   - string without PII          → literal '[REDACTED]'
      //   - non-string (anything else)   → literal '[REDACTED]'
      // Either branch erases the original raw secret.
      if (typeof val === 'string') {
        const redacted = redactPii(val);
        node[key] = redacted !== val ? redacted : '[REDACTED]';
      } else {
        node[key] = '[REDACTED]';
      }
      // Do NOT recurse into a redacted subtree.
      continue;
    }
    // Non-sensitive key — recurse into structures, leave scalars alone.
    if (Array.isArray(val) || isPlainObject(val)) {
      walkAndRedact(val);
    }
  }
}

export function redactKeys<T>(obj: T): T {
  // Clone first so the input object is never mutated. The clone uses
  // null-prototype containers for proto-pollution defense.
  const cloned = deepClone(obj);
  walkAndRedact(cloned);
  return cloned as T;
}

// ---------------------------------------------------------------------------
// deepRedactPii — recursive string-leaf redactor (HARD-03 / T-15-03).
//
// Complements redactKeys: redactKeys replaces VALUES under SENSITIVE key names
// at any depth, but does NOT apply redactPii to non-sensitive nested string
// leaves. deepRedactPii fills that gap by walking every node in the structure
// and applying redactPii to every string leaf.
//
// Structural rules (mirror walkAndRedact / deepClone patterns above):
//   - string  → redactPii(node)               (apply PII redaction)
//   - Array   → node.map(deepRedactPii)        (recurse into every element)
//   - plain object → recurse into a fresh Object.create(null) container so
//                    __proto__ keys stay inert (T-15-03c proto-pollution guard)
//   - anything else (number, boolean, null, class instance, Map, Set, …) →
//               returned unchanged; isPlainObject rejects opaque objects so
//               their internals are never traversed (matches deepClone sentinel)
//
// Output: always a NEW structure — the input is never mutated (same invariant
// as deepClone). `opts` passes a keep list through to every redactPii call.
// A WeakSet guard turns a circular array or object into '[CIRCULAR]' (IN-01).
// Identifiers (UUIDs, DOIs, ISBNs, arXiv ids, ISO timestamps, digests) pass
// through unchanged, like in redactPii (GRND-05).
//
// Called by session-log.ts buildRecord AFTER redactKeys so the two stages
// compose without overlap: redactKeys (sensitive keys at depth) then
// deepRedactPii (PII in remaining non-sensitive string leaves).
// ---------------------------------------------------------------------------

export function deepRedactPii(node: unknown, opts: PiiOptions = {}): unknown {
  return deepRedactWalk(node, opts, new WeakSet());
}

function deepRedactWalk(node: unknown, opts: PiiOptions, seen: WeakSet<object>): unknown {
  if (typeof node === 'string') return redactPii(node, opts);
  if (Array.isArray(node)) {
    // IN-01: guard against circular arrays to prevent stack overflow.
    if (seen.has(node)) return '[CIRCULAR]';
    seen.add(node);
    return node.map((el) => deepRedactWalk(el, opts, seen));
  }
  if (isPlainObject(node)) {
    // IN-01: guard against circular plain objects to prevent stack overflow.
    if (seen.has(node)) return '[CIRCULAR]';
    seen.add(node);
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(node)) {
      const lower = k.toLowerCase();
      if (SENSITIVE.has(lower)) {
        // Sensitive key: replace value wholesale (mirrors walkAndRedact logic).
        // If the value is a string with classifiable PII, keep the redactPii
        // form; otherwise use the literal sentinel. Either branch erases the raw
        // secret — matching the walkAndRedact contract exactly.
        const val = node[k];
        if (typeof val === 'string') {
          const redacted = redactPii(val, opts);
          out[k] = redacted !== val ? redacted : '[REDACTED]';
        } else {
          out[k] = '[REDACTED]';
        }
        // Do NOT recurse into a redacted subtree (mirrors walkAndRedact).
      } else {
        out[k] = deepRedactWalk(node[k], opts, seen);
      }
    }
    return out;
  }
  // Non-string scalars (number, boolean, null, undefined) and opaque objects
  // (class instances, Map, Set, Date, Buffer, Error, …) — returned as-is.
  return node;
}
