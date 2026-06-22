// bin/lib/intake-parse.ts — Parse INTAKE.md into structured research inputs.
//
// INTAKE.md is the clarifier output (intake-clarifier.md prompt): a numbered
// list of questions and answers. It is NOT a structured markdown document with
// ## Topic / ## Discipline headings. This module applies a heuristic fallback
// path by default; structured headings are supported defensively for future
// intake formats.
//
// Exported: parseIntakeMd(text: string): { topic, discipline, assignment }
//   - topic:      first non-empty line/heading extracted from the text, or
//                 a reasonable phrase from the first question/answer pair.
//   - discipline: extracted from a "Discipline" answer if present; defaults
//                 to 'other' (the INTK-03 fallback slug).
//   - assignment: the full INTAKE.md text (the entire clarifier output serves
//                 as assignment context for the topic-disambiguator prompt).
//   - Never throws — all parse errors → silent fallback to safe defaults.

/**
 * Structured output of parseIntakeMd. Feeds directly into the
 * topic-disambiguator interpolate call in research.ts.
 */
export interface ParsedIntake {
  /** Short topic phrase (1-15 words) suitable for the {{topic}} slot. */
  topic: string;
  /** INTK-03 discipline slug (e.g. 'computer-science', 'other'). */
  discipline: string;
  /** Full assignment context text for the {{assignment}} slot. */
  assignment: string;
}

// Canonical discipline slug map. Keys are patterns that appear in common
// user answers; values are the INTK-03 canonical slugs from disciplines.json.
const DISCIPLINE_MAP: ReadonlyMap<string, string> = new Map([
  ['cs', 'computer-science'],
  ['computer science', 'computer-science'],
  ['computer-science', 'computer-science'],
  ['bio', 'biology'],
  ['biology', 'biology'],
  ['hist', 'history'],
  ['history', 'history'],
  ['lit', 'literature'],
  ['literature', 'literature'],
  ['psych', 'psychology'],
  ['psychology', 'psychology'],
  ['econ', 'economics'],
  ['economics', 'economics'],
  ['phil', 'philosophy'],
  ['philosophy', 'philosophy'],
  ['soc', 'sociology'],
  ['sociology', 'sociology'],
  ['other', 'other'],
  // AI / ML abbreviations → CS
  ['ai', 'computer-science'],
  ['ml', 'computer-science'],
]);

/**
 * Normalize a raw discipline answer string to an INTK-03 canonical slug.
 * Returns 'other' if no known mapping exists.
 */
function normalizeDiscipline(raw: string): string {
  const key = raw.trim().toLowerCase();
  // Direct map lookup (longest match wins via iteration order).
  for (const [pattern, slug] of DISCIPLINE_MAP) {
    if (key === pattern || key.startsWith(pattern + ' ') || key.startsWith(pattern + ',')) {
      return slug;
    }
  }
  // Substring match as a fallback.
  for (const [pattern, slug] of DISCIPLINE_MAP) {
    if (key.includes(pattern)) {
      return slug;
    }
  }
  return 'other';
}

/**
 * Extract the topic phrase from INTAKE.md text.
 *
 * Strategy (in priority order):
 *   1. A line containing "Topic:" or matching "## Topic" → extract the value.
 *   2. A numbered answer that follows a "topic" question → use the answer text.
 *   3. The first non-empty, non-question-number line of meaningful text.
 *   4. Fallback: first 80 chars of the trimmed text, clipped at a word boundary.
 *
 * Never throws.
 */
function extractTopic(text: string): string {
  const lines = text.split('\n');

  // 1. Explicit ## Topic heading (structured format — rare but defensive).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^##\s+topic/i.test(line)) {
      // Value is on the next non-empty line.
      for (let j = i + 1; j < lines.length; j++) {
        const val = lines[j]!.trim();
        if (val && !val.startsWith('#')) return val.slice(0, 200);
      }
    }
    if (/^topic\s*:/i.test(line)) {
      const val = line.replace(/^topic\s*:\s*/i, '').trim();
      if (val) return val.slice(0, 200);
    }
  }

  // 2. The assignment text often starts with a statement like
  //    "Write a literature review on X" or "This paper is about X".
  //    Extract the topic phrase from the first descriptive sentence.
  const firstSentence = text.trim().split(/[.!?]/)[0]?.trim() ?? '';
  if (firstSentence.length > 5 && firstSentence.length <= 200) {
    // Strip leading imperative verbs for brevity.
    const stripped = firstSentence
      .replace(/^(write|analyze|discuss|examine|explore|describe|explain|review)\s+(a\s+)?/i, '')
      .replace(/^(literature review|paper|essay|report|study|analysis)\s+(on|about|regarding)\s+/i, '')
      .trim();
    if (stripped.length >= 3) return stripped.slice(0, 200);
    return firstSentence.slice(0, 200);
  }

  // 3. First non-empty, non-numbered line.
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip numbered list markers (Q&A pairs from clarifier output).
    if (/^\d+\./.test(trimmed)) continue;
    return trimmed.slice(0, 200);
  }

  // 4. Fallback: clip the full text.
  return text.trim().slice(0, 80).split(' ').slice(0, -1).join(' ') || text.trim().slice(0, 80);
}

/**
 * Extract the discipline from INTAKE.md text.
 *
 * Strategy (in priority order):
 *   1. Explicit "## Discipline" heading → extract value.
 *   2. "Discipline:" label line → extract value.
 *   3. A numbered answer that follows question text mentioning "discipline"
 *      or "subject area" → extract the answer text.
 *   4. Fallback: 'other'.
 *
 * Never throws.
 */
function extractDiscipline(text: string): string {
  const lines = text.split('\n');

  // 1. Explicit ## Discipline heading.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^##\s+discipline/i.test(line)) {
      for (let j = i + 1; j < lines.length; j++) {
        const val = lines[j]!.trim();
        if (val && !val.startsWith('#')) return normalizeDiscipline(val);
      }
    }
    if (/^discipline\s*:/i.test(line)) {
      const val = line.replace(/^discipline\s*:\s*/i, '').trim();
      if (val) return normalizeDiscipline(val);
    }
  }

  // 2. Scan numbered Q&A pairs from clarifier output.
  // Pattern: "1. Which discipline..." followed by answer text on the next line.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/discipline|subject\s*area|field/i.test(line) && /^\d+\./.test(line)) {
      // Answer is on the next non-empty line.
      for (let j = i + 1; j < lines.length; j++) {
        const answerLine = lines[j]!.trim();
        if (!answerLine) continue;
        // Skip lines that look like another question.
        if (/^\d+\./.test(answerLine)) break;
        return normalizeDiscipline(answerLine);
      }
    }
  }

  // 3. Inline discipline mention in the assignment text itself.
  // e.g. "Target discipline: computer science / machine learning"
  const disciplineMatch = text.match(/(?:discipline|subject|field)\s*[:/–-]\s*([^.\n]{2,60})/i);
  if (disciplineMatch?.[1]) {
    return normalizeDiscipline(disciplineMatch[1]);
  }

  return 'other';
}

/**
 * Parse the text content of INTAKE.md into structured research inputs.
 *
 * This is a HEURISTIC parser — INTAKE.md is the output of the intake-clarifier
 * prompt (a numbered Q&A list), NOT a structured document with ## headings.
 * The structured-heading branch is implemented defensively for future intake
 * formats, but the heuristic fallback path is the expected production path.
 *
 * Contract:
 *   - Never throws for any input.
 *   - Empty string → all fields are safe empty/default values.
 *   - Returns { topic, discipline, assignment } always.
 *   - assignment is ALWAYS the full input text (the complete INTAKE.md content
 *     serves as the assignment context for topic-disambiguator).
 *
 * @param text  Raw string content of INTAKE.md (readFileSync result).
 */
export function parseIntakeMd(text: string): ParsedIntake {
  if (!text || !text.trim()) {
    return { topic: '', discipline: 'other', assignment: '' };
  }

  try {
    const topic = extractTopic(text);
    const discipline = extractDiscipline(text);
    // assignment = full text — topic-disambiguator needs full context.
    const assignment = text.trim();

    return { topic, discipline, assignment };
  } catch {
    // Absolute safety net — should never be reached given the extractors
    // are themselves fully defensive, but belt-and-suspenders matters here
    // because parse failure would break the research pipeline.
    return {
      topic: text.trim().slice(0, 80),
      discipline: 'other',
      assignment: text.trim(),
    };
  }
}
