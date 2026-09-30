// bin/lib/person-name.ts — parse an author / editor display string into its
// parts (SRC-12, D-19-19).
//
// LIBRARY.json stores authors as display strings (schemas/library.ts): the
// registrar's "Family, Given", a "Given Family" display name (arXiv, BYO title
// pages), or a braced "{Corporate Name}". The BibTeX and RIS writers and the
// reference renderers need the parts, and they must come back EXACTLY when the
// rendered CITATIONS.bib is parsed again (verify, compile and done read it):
//
//   "Family, Given"            → family, given
//   "Family, Given, Suffix"    → family, given, suffix ("King, Martin Luther, Jr.")
//   "Given Family"             → family = the last word, given = the rest …
//   "Given van der Family"     → … except that lower-case particles (van, van der,
//                                de, de la, von, di, da, du, del, della, le, la,
//                                ten, ter, bin, al) join the family:
//                                "Laurens van der Maaten" → family "van der Maaten"
//   "Given Family Jr."         → a trailing generational suffix is kept apart
//   "{Corporate Name}"         → one literal name (never split into given/family)
//   "王小明" (one token)        → family only
//
// Pure: no I/O. Whitespace is collapsed; Unicode is NFC-normalized.
//
// A registrar that has no name-only field (arXiv, OpenAlex, Semantic Scholar,
// Unpaywall's raw names, Open Library) sends a collaboration or organisation
// as a plain display string, "The ATLAS Collaboration". Read as "Given
// Family" it becomes a person called "Collaboration, The ATLAS", so those
// adapters pass each name through `displayAuthorName`, which braces a name
// that reads as a group (SRC-12) the way Crossref's and PubMed's collective
// names are braced.

/** A parsed personal or corporate name. */
export interface PersonName {
  /** The family name (for a corporate name: the whole name). Never empty. */
  readonly family: string;
  /** Given name(s), when known. */
  readonly given?: string;
  /** A generational suffix (Jr., Sr., II, III, …), when present. */
  readonly suffix?: string;
  /** True for a braced corporate / consortium name ("{ENCODE Project Consortium}"). */
  readonly literal?: boolean;
}

/**
 * Lower-case particles that belong to the family name in "Given Family" form
 * (D-19-19). Matched case-sensitively: "Van" at the start of a given-first
 * name is a given name ("Van Morrison"), "van" is a particle.
 */
export const NAME_PARTICLES: ReadonlySet<string> = new Set([
  'van', 'der', 'den', 'de', 'la', 'von', 'di', 'da', 'du', 'del', 'della', 'le', 'ten', 'ter', 'bin', 'al',
]);

const SUFFIX_RE = /^(?:jr|sr|jnr|snr)\.?$|^(?:ii|iii|iv|v|vi)$/i;

function clean(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function build(family: string, given: string, suffix: string): PersonName {
  return {
    family,
    ...(given ? { given } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

/** True for a braced corporate name: "{…}" whose braces enclose the whole string. */
function isBracedLiteral(s: string): boolean {
  if (!s.startsWith('{') || !s.endsWith('}')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0 && i < s.length - 1) return false;
    }
  }
  return depth === 0;
}

/**
 * The last words that make a display name a group, not a person: "The ATLAS
 * Collaboration", "Dphep Study Group", "World Health Organization", "The
 * SPRINT Research Group", "PIONEER Investigators". Compared case-insensitively.
 */
const GROUP_WORDS: ReadonlySet<string> = new Set([
  'collaboration', 'collaborations', 'collaborative', 'collaborators', 'consortium', 'consortia',
  'group', 'groups', 'team', 'investigators', 'organization', 'organisation', 'institute',
  'committee', 'project', 'network', 'society', 'association', 'council', 'foundation',
  'commission', 'agency', 'alliance', 'initiative', 'federation', 'coalition', 'partnership',
  'laboratory', 'laboratories', 'programme',
]);

/**
 * True when a display name (no comma, not braced) names a group: it starts
 * with "The" and has more words, or its last word is a group word (above).
 * A person's name never starts with "The" and never ends in one of them.
 */
export function isGroupDisplayName(input: string): boolean {
  if (typeof input !== 'string') return false;
  const s = clean(input);
  if (!s || s.includes(',') || isBracedLiteral(s)) return false;
  const words = s.split(' ');
  if (words.length < 2) return false;
  if (/^the$/i.test(words[0]!)) return true;
  const last = words[words.length - 1]!.replace(/[^\p{L}]/gu, '').toLowerCase();
  return GROUP_WORDS.has(last);
}

/**
 * A registrar's display name as LIBRARY.json stores it: a group's name braced
 * (`{The ATLAS Collaboration}`, one literal name — SRC-12), anything else with
 * its whitespace collapsed.
 */
export function displayAuthorName(input: string): string {
  const s = typeof input === 'string' ? clean(input) : '';
  return isGroupDisplayName(s) ? `{${s.replace(/[{}]/g, '')}}` : s;
}

/**
 * Parse one author / editor string. Returns null for an empty string.
 */
export function parsePersonName(input: string): PersonName | null {
  if (typeof input !== 'string') return null;
  const s = clean(input);
  if (!s) return null;

  if (isBracedLiteral(s)) {
    const inner = clean(s.slice(1, -1));
    return inner ? { family: inner, literal: true } : null;
  }

  if (s.includes(',')) {
    const parts = s.split(',').map(clean);
    const family = parts[0] ?? '';
    if (!family) {
      // ", Given" — no family: treat the rest as a single-token name.
      const rest = parts.slice(1).filter(Boolean).join(' ');
      return rest ? { family: rest } : null;
    }
    if (parts.length >= 3) {
      // "Family, Given, Suffix" (D-19-19) — or BibTeX's "Family, Jr, Given" when
      // the middle part is the generational suffix.
      const second = parts[1] ?? '';
      const third = parts.slice(2).filter(Boolean).join(', ');
      if (SUFFIX_RE.test(second) && !SUFFIX_RE.test(third)) return build(family, third, second);
      return build(family, second, third);
    }
    return build(family, parts[1] ?? '', '');
  }

  const words = s.split(' ');
  if (words.length === 1) return { family: s };
  // "de la Fontaine" — a display name that starts with a particle has no given
  // name: the whole string is the family.
  if (NAME_PARTICLES.has(words[0]!)) return { family: s };

  // A trailing generational suffix ("Martin Luther King Jr.").
  let suffix = '';
  if (words.length >= 3 && SUFFIX_RE.test(words[words.length - 1]!)) {
    suffix = words.pop()!;
  }
  // The family starts at the first lower-case particle that follows at least
  // one given word; otherwise it is the last word.
  let start = words.length - 1;
  for (let i = 1; i < words.length - 1; i++) {
    if (NAME_PARTICLES.has(words[i]!)) {
      start = i;
      break;
    }
  }
  const family = words.slice(start).join(' ');
  const given = words.slice(0, start).join(' ');
  return build(family, given, suffix);
}

/**
 * The canonical "Family, Given[, Suffix]" display string for a parsed name
 * ("{Corporate}" for a literal). parsePersonName(formatPersonName(n)) equals n.
 */
export function formatPersonName(n: PersonName): string {
  if (n.literal) return `{${n.family}}`;
  if (!n.given && !n.suffix) return n.family;
  if (!n.suffix) return `${n.family}, ${n.given}`;
  return `${n.family}, ${n.given ?? ''}, ${n.suffix}`;
}

// ---------------------------------------------------------------------------
// PubMed's compact personal-name form.
// ---------------------------------------------------------------------------

/** A generational suffix as PubMed writes it after the initials ("King ML Jr", "Smith J 3rd"). */
const PUBMED_SUFFIX_RE = /^(?:Jr|Sr|2nd|3rd|4th|5th|II|III|IV|V)\.?$/;
/** PubMed initials: one to four upper-case letters, no dots ("N", "GF", "JRR"). */
const PUBMED_INITIALS_RE = /^\p{Lu}{1,4}$/u;

/**
 * PubMed (E-utilities esummary) writes personal names surname-first with no
 * comma: the LAST token is the initials — "Zhu N", "Gao GF", "van den Berg R",
 * "King ML Jr". Read as a display name, "Zhu N" would be given "Zhu", family
 * "N" (parsePersonName's "Given Family" rule), so the PubMed adapter rewrites
 * each one into the canonical "Family, Initials[, Suffix]" form with dotted
 * initials (what a reference renderer initializes correctly — citeproc reads
 * a bare "GF" as one name and prints "G."): "Zhu, N.", "Gao, G. F.",
 * "van den Berg, R.", "King, M. L., Jr".
 *
 * A string that is not in the compact form (one token, a comma already, a
 * braced group name, or a last token that is not upper-case initials) comes
 * back unchanged.
 */
export function fromPubmedCompactName(input: string): string {
  if (typeof input !== 'string') return input;
  const s = clean(input);
  if (!s || s.includes(',') || isBracedLiteral(s)) return input;
  const words = s.split(' ');
  let suffix = '';
  if (words.length >= 3 && PUBMED_SUFFIX_RE.test(words[words.length - 1]!)) suffix = words.pop()!;
  if (words.length < 2) return input;
  const initials = words[words.length - 1]!;
  if (!PUBMED_INITIALS_RE.test(initials)) return input;
  const family = words.slice(0, -1).join(' ');
  const dotted = [...initials].map((ch) => `${ch}.`).join(' ');
  return formatPersonName(build(family, dotted, suffix));
}
