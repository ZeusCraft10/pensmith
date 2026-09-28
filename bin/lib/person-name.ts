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
