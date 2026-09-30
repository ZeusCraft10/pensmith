// bin/cli/intake.ts — `pensmith new`, the intake step (`intake` is not a verb,
// RUN-11; INTK-01, ARCH-02; GRND-01..06, D-18-07..13).
//
// The PRD §7.1 intake, in the D-18-09 order:
//   1. the answers given up front — flags and `--answers <file.toml>` (read
//      by bin/lib/config.ts) — validated (an invalid value or an unknown
//      answers-file key is EXIT_USAGE);
//   2. the assignment (bin/lib/assignment.ts: --from, @path, piped stdin, the
//      folder's assignment.* through the `assignment-pickup` gate, a paste);
//   3. a run that cannot prompt, without --yolo, with unanswered questions is
//      refused through the `intake-defaults` gate (EXIT_APPROVAL) naming them —
//      BEFORE any model call or write;
//   4. assertLlmConfigured (RUN-07), the PRD §3 disclaimer;
//   5. PII redaction (opt-in, GRND-05): the assignment, thesis seed, class and
//      follow-up answers are redacted before any model call and before
//      INTAKE.md; the raw text goes only to the gitignored INTAKE.raw.local;
//   6. ONE intake-clarifier call (a structured slug: suggestions only —
//      topic, discipline, paper type, thesis, stated length and style,
//      sectioning notes, ≤ 3 follow-ups), built by prompt-request.ts: the
//      fixed template as the system prompt, the data as fenced blocks;
//   7. the battery: every unanswered question asked in a terminal with the
//      suggestion as its default, or — under --yolo — the suggestions
//      accepted and printed; then the follow-ups (a run that cannot ask them
//      records the suggested answer and says so);
//   8. the writes: STATE.json (idempotent), INTAKE.md (the versioned brief,
//      renderIntakeDocument), config.toml [project]/[style] mirror,
//      STYLE.json (opt-in), the global registry entry with the answered class.
// The clarifier's reply is never written as INTAKE.md: the brief is built from
// the answers, the deterministic overrides (intake-overrides.ts) and the
// suggestions.
//
// D-12 LOCKED prompt slug: `intake-clarifier`.

import { defineCommand } from 'citty';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { redactPii, diffPii } from '../lib/pii.js';
import { complete, assertLlmConfigured } from '../lib/anthropic.js';
import { buildPromptRequest, requestHints, type PromptJson } from '../lib/prompt-request.js';
import { tryReadPaperConfigSync, readIntakeAnswersFile, writeIntakeConfig } from '../lib/config.js';
import type { IntakeClarification } from '../lib/llm-contracts.js';
import { resolveByoDirArg, recordByoPdfDir, listPdfsInDir, ingestByoPdfs, describeByoOutcome } from '../lib/byo-ingest.js';
import { approveByoFolder } from '../lib/own-source-approvals.js';
import { paperDir, projectRoot } from '../lib/paths.js';
import { resolveAssignment, type ResolvedAssignment } from '../lib/assignment.js';
import { initState, loadState, StateAlreadyExistsError } from '../lib/state.js';
import { registerPaperInGlobalLibrary } from '../lib/global-library.js';
import { buildStyleProfile, checkAndRegisterFingerprint, writeStyleProfile } from '../lib/style-match.js';
import { ask, type PromptAnswer, type PromptQuestion } from '../lib/prompts.js';
import { canPrompt } from '../lib/gates.js';
import { networkMode, offlineMarkerLine } from '../lib/http-mock.js';
import { PensmithError, EXIT_USAGE } from '../lib/exit-codes.js';
import {
  FALLBACK_DISCIPLINE,
  defaultCitationStyleFor,
  disciplineSlugs,
  normalizeDisciplineSlug,
  presetFor,
} from '../lib/disciplines.js';
import { citationStyleKey } from '../lib/schemas/config.js';
import { intakePath, renderIntakeDocument, type IntakeBriefInput, type IntakeQa } from '../lib/intake-brief.js';
import { Q, citationStyleDisplay, describeIntakeQuestions, intakeQuestions, type IntakeAnswerValue, type IntakeQuestion } from '../lib/intake-questions.js';
import {
  collectFixedAnswers,
  promptFor,
  refuseUnanswered,
  resolveBattery,
  resolveFollowUps,
  unansweredQuestions,
  type FixedAnswers,
  type FollowUpAnswer,
  type ResolvedAnswer,
} from '../lib/intake-answers.js';
import {
  disciplineMentionFrom,
  topicKeepPhrases,
  paperTypeFrom,
  parseIntakeOverrides,
  statedLengthWords,
  topicFromAssignment,
  topicIsGrounded,
  withThesisSeed,
  THESIS_SEED_LABEL,
} from '../lib/intake-overrides.js';
import { TUTORIAL_INTAKE_QUESTION } from '../lib/tutorial.js';

/** The length target when neither the assignment nor the clarifier states one (D-18-09). */
export const DEFAULT_LENGTH_WORDS = 1500;

/** PRD §3 disclaimer — printed before any prompt or model call (DOCS-01, non-negotiable copy). */
const DISCLAIMER = [
  'pensmith is a structured research-and-drafting assistant for academic writing.',
  'It helps you turn an assignment prompt into a sourced outline or, optionally, a full draft,',
  'using only verifiable peer-reviewed and configurable academic sources. It includes a citation',
  'verifier that re-fetches every cited DOI and flags unsupported claims for human review,',
  'and a humanizer pass that improves readability.',
  '',
  'This tool is for your own writing, research, and learning. It is not a guarantee against AI detectors',
  'and it is not a substitute for doing the reading. Submitting fully tool-generated',
  'work as your own is, in many institutions, a violation of academic integrity policy.',
  'You are responsible for the work you submit.',
].join('\n');

function say(line: string): void {
  process.stdout.write(line + '\n');
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `citation-style` → `citationStyle`. */
function camel(flag: string): string {
  return flag.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * The flag values the user gave, by IntakeQuestion.flag. citty exposes both
 * the kebab and the camelCase spelling; an in-process caller (sketch's
 * dispatch, tests) may pass either.
 */
function flagValues(args: Record<string, unknown>, questions: readonly IntakeQuestion[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const q of questions) {
    const v = args[q.flag] ?? args[camel(q.flag)];
    if (v === undefined) continue;
    if (!q.booleanFlag && typeof v === 'boolean') continue; // a value flag given without a value is citty's to report
    out[q.flag] = v;
  }
  return out;
}

/** A style-samples answer must name an existing folder (checked before anything is sent or written). */
function checkSamplesDir(dir: string, from: string): string {
  if (!dir) return '';
  const abs = path.resolve(dir);
  let ok = false;
  try {
    ok = statSync(abs).isDirectory();
  } catch {
    ok = false;
  }
  if (!ok) throw new PensmithError(`${from}: ${dir}: no such folder`, EXIT_USAGE);
  return abs;
}

/** Display name + class for the global registry (LIB-04). */
function paperName(cwd: string): string {
  const t = tryReadPaperConfigSync(cwd)?.project?.title;
  if (typeof t === 'string' && t.trim()) return t.trim();
  return path.basename(cwd) || 'Untitled paper';
}

/**
 * LIB-04 — register the paper in the global paper registry (non-fatal): id,
 * name, folderPath, the ANSWERED class, and a seeded status 'intake' (`list`
 * derives the live status from STATE.json at display time).
 */
async function registerPaperNonFatal(cwd: string, paperId: string | null, name: string, klass: string): Promise<void> {
  try {
    if (!paperId) {
      process.stderr.write('pensmith new: WARN — no paperId yet (STATE.json absent); skipping global-library registration (non-fatal).\n');
      return;
    }
    const now = new Date().toISOString();
    await registerPaperInGlobalLibrary({
      id: paperId,
      name,
      folderPath: path.resolve(cwd),
      class: klass,
      status: 'intake',
      createdAt: now,
      updatedAt: now,
    });
  } catch (e) {
    process.stderr.write(`pensmith new: WARN — global-library registration failed (non-fatal): ${(e as Error).message}\n`);
  }
}

/**
 * STYL-01/02 — the opt-in style-match producer: build → check → PRINT the
 * cross-paper-reuse notice (unconditional, never --yolo-gated) → write
 * .paper/STYLE.json. Non-fatal: a bad samples folder never fails intake.
 */
async function runStyleProducerNonFatal(cwd: string, samplesDir: string, paperId: string | null, name: string): Promise<boolean> {
  try {
    const fpPaperId = paperId ?? `unregistered:${path.resolve(cwd)}`;
    const profile = await buildStyleProfile(samplesDir);
    const { priorPapers } = await checkAndRegisterFingerprint(profile.fingerprint, fpPaperId, name);
    if (priorPapers.length > 0) {
      const names = priorPapers.map((p) => p.paperName || p.paperId).join(', ');
      say(
        `pensmith new: NOTICE — these writing samples were already used to style a prior paper: ${names}. ` +
          'Style Match mirrors your own voice; reuse across papers is surfaced here for transparency.',
      );
    }
    await writeStyleProfile(paperDir(cwd), profile);
    say(`pensmith new: wrote style profile to ${path.join(paperDir(cwd), 'STYLE.json')}`);
    return true;
  } catch (e) {
    process.stderr.write(`pensmith new: WARN — style-match producer failed (non-fatal): ${(e as Error).message}\n`);
    return false;
  }
}

/**
 * Audit #13 — `.paper/.gitignore` keeps INTAKE.raw.local (the raw, unredacted
 * text when PII redaction is on) and every *.local file out of git. Never
 * overwrites a user's own .gitignore; best-effort.
 */
async function ensurePaperGitignore(cwd: string): Promise<void> {
  try {
    const gi = path.join(paperDir(cwd), '.gitignore');
    if (existsSync(gi)) return;
    await atomicWriteFile(
      gi,
      [
        '# Written by pensmith — keep unredacted PII and local-only artifacts out of git.',
        '# INTAKE.raw.local holds the RAW (unredacted) intake text when PII redaction',
        '# is enabled; it must NEVER be committed.',
        'INTAKE.raw.local',
        '*.local',
        '',
      ].join('\n'),
    );
  } catch {
    // best-effort
  }
}

/** The fixed answers with one more (the PII question is settled before the model call). */
function withAnswer(fixed: FixedAnswers, id: string, a: ResolvedAnswer): FixedAnswers {
  const values = new Map(fixed.values);
  values.set(id, a);
  return { values, followUps: fixed.followUps, thesis: fixed.thesis };
}

/** The `answers` block of the clarifier request: only what flags / the answers file / config fixed. */
function clarifierAnswers(fixed: FixedAnswers): Record<string, PromptJson> | undefined {
  const out: Record<string, PromptJson> = {};
  const get = (id: string): IntakeAnswerValue | undefined => fixed.values.get(id)?.value;
  const d = get(Q.discipline);
  if (typeof d === 'string') out['discipline'] = d;
  const l = get(Q.length);
  if (typeof l === 'number') out['length_target_words'] = l;
  const c = get(Q.citationStyle);
  if (typeof c === 'string') out['citation_style'] = c;
  const ca = get(Q.counterargument);
  if (typeof ca === 'string') out['counterargument'] = ca;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** An empty suggestion set (the preset defaults and the assignment's own wording apply). */
const NO_SUGGESTIONS: IntakeClarification = Object.freeze({
  topic: '',
  discipline: '',
  paper_type: 'other',
  thesis: '',
  length_target_words: 0,
  citation_style: '',
  sectioning_notes: [],
  follow_ups: [],
}) as IntakeClarification;

/**
 * True when a clarifier reply is the template's own Output Format example
 * (its topic equals the example's): a model that parrots the example has not
 * read the assignment, and the example must never become the brief (D-18-10).
 */
export function isTemplateExample(reply: IntakeClarification, system: string): boolean {
  const blocks = [...system.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const last = blocks[blocks.length - 1]?.[1];
  if (last === undefined) return false;
  try {
    const example = JSON.parse(last) as { topic?: unknown };
    const topic = typeof example.topic === 'string' ? oneLine(example.topic).toLowerCase() : '';
    return topic !== '' && oneLine(reply.topic).toLowerCase() === topic;
  } catch {
    return false;
  }
}

function sourceNote(source: ResolvedAnswer['source']): string {
  switch (source) {
    case 'flag':
      return 'from a flag';
    case 'answers':
      return 'from --answers';
    case 'asked':
      return 'answered';
    default:
      return 'suggested default, accepted with --yolo';
  }
}

function followUpNote(f: FollowUpAnswer, yolo: boolean): string {
  if (f.how === 'answers') return `${f.answer} — from --answers`;
  if (f.how === 'asked') return f.answer;
  return `${f.answer || '(no suggestion)'} — the clarifier's suggested answer, not asked (${yolo ? '--yolo' : 'no terminal'})`;
}

/**
 * SRC-15 (D-19-21): `new --pdfs <dir>` — record the folder as `[sources]
 * byo_pdf_dir` (and, in the data dir, the user's approval to read it for this
 * paper) and ingest every PDF in it through byo-ingest.ts (hashed,
 * identified, tagged bring-your-own; an unidentified PDF is kept unhydrated
 * with a warning). One line per PDF; a PDF that cannot be ingested never
 * fails intake.
 *
 * Under --dry-run nothing of the user's is touched (as research skips its
 * own-source step, GRND-19 / D-18-29): the folder is recorded in the dry-run
 * workspace's config.toml only — no approval is written to the data dir (a
 * dry run writes nothing global), no PDF is read or copied, and no entry
 * enters the workspace library.
 */
async function ingestByoFolderForNew(cwd: string, dir: string): Promise<void> {
  const stored = await recordByoPdfDir(cwd, dir);
  if (networkMode().dryRun) {
    process.stdout.write(`pensmith new: bring-your-own: skipped (--dry-run) — ${stored} recorded as [sources] byo_pdf_dir; no PDF was read\n`);
    return;
  }
  // The user named the folder on the command line: research may re-read it
  // for this paper (own-source-approvals.ts; a folder inside the project
  // needs no record).
  await approveByoFolder(cwd, dir);
  const files = await listPdfsInDir(dir);
  process.stdout.write(`pensmith new: bring-your-own: ${files.length} PDF(s) in ${stored} (recorded as [sources] byo_pdf_dir)\n`);
  const outcomes = await ingestByoPdfs(cwd, files, { provenance: 'byo' });
  for (const o of outcomes) {
    const d = describeByoOutcome(o, 'pensmith new');
    (d.stream === 'stdout' ? process.stdout : process.stderr).write(`${d.line}\n`);
  }
}

export const intakeCommand = defineCommand({
  meta: {
    name: 'new',
    description: 'Start a new paper: take in the assignment and answer the intake questions (the intake step).',
  },
  args: {
    source: {
      type: 'positional',
      required: false,
      description: 'The assignment file as @path (.txt, .md or .pdf), e.g. `pensmith new @assignment.pdf`.',
      valueHint: '@file',
    },
    from: {
      type: 'string',
      description: 'The assignment file (.txt, .md or .pdf).',
      valueHint: 'file',
    },
    answers: {
      type: 'string',
      description: 'A TOML file answering the intake questions (keys: see --questions; plus thesis and [follow_ups]).',
      valueHint: 'file.toml',
    },
    questions: {
      type: 'boolean',
      description: 'Print the intake questions (id, options, flag, answers-file key) as JSON and exit.',
    },
    discipline: {
      type: 'string',
      description: `Discipline preset: ${disciplineSlugs().join(', ')} (names and abbreviations work too).`,
    },
    mode: {
      type: 'string',
      description: 'draft (the full paper, default) or outline (stop after the approved outline).',
    },
    [TUTORIAL_INTAKE_QUESTION.flag]: {
      type: 'string',
      description: TUTORIAL_INTAKE_QUESTION.flagDescription,
    },
    class: {
      type: 'string',
      description: 'The class this paper is for, e.g. "PHIL 101" (groups papers in `pensmith list`; default Unfiled).',
    },
    counterargument: {
      type: 'string',
      description: 'Require a counterargument and rebuttal section: yes, no or auto (default auto).',
    },
    length: {
      type: 'string',
      description: 'Target length in words (or "N pages").',
    },
    citationStyle: {
      type: 'string',
      description: 'Citation style: APA, MLA, Chicago (Notes-Bibliography), Chicago (Author-Date), IEEE, AMA, Vancouver or Harvard.',
    },
    styleSamples: {
      type: 'string',
      description: 'Opt-in: a folder of your writing samples to match your voice (.md/.txt/.docx); "no" to skip.',
    },
    'pii-redact': {
      type: 'boolean',
      description: 'Opt-in: redact personal information before any model call (--no-pii-redact to answer no).',
    },
    thesis: {
      type: 'string',
      description: 'A candidate thesis to seed the intake (supplied by `sketch`).',
    },
    yolo: {
      type: 'boolean',
      description: 'Accept the suggested defaults for every unanswered intake question (and print them).',
      default: false,
    },
    // SRC-15 (D-19-21): a folder of the user's own PDFs. Each is hashed,
    // identified (only a title or identifier leaves the machine) and added to
    // LIBRARY.json tagged bring-your-own; the folder is recorded as
    // `[sources] byo_pdf_dir` so research picks up files added later.
    pdfs: {
      type: 'string',
      description: 'A folder of your own PDFs to add as sources (bring-your-own).',
      valueHint: 'dir',
    },
  },
  async run({ args }) {
    const a = args as Record<string, unknown>;
    // --questions: the battery, for scripts and the Tier-1 workflow body. No paper is touched.
    if (a['questions'] === true) {
      say(JSON.stringify({ questions: describeIntakeQuestions() }, null, 2));
      return { ok: true, questions: true };
    }

    const cwd = projectRoot();
    // SRC-15: an unusable --pdfs folder is a usage error before anything is sent or written.
    const byoDir = typeof a['pdfs'] === 'string' ? resolveByoDirArg(a['pdfs'] as string) : null;
    const yolo = a['yolo'] === true;
    const prompting = canPrompt();
    const questions = intakeQuestions();

    // 1. Answers given up front (validated; nothing sent or written yet).
    const answersArg = typeof a['answers'] === 'string' && a['answers'].length > 0 ? (a['answers'] as string) : undefined;
    const answersFile = answersArg ? { path: answersArg, data: readIntakeAnswersFile(path.resolve(answersArg)) } : null;
    let fixed = collectFixedAnswers({ questions, flags: flagValues(a, questions), answersFile });
    const fixedSamples = fixed.values.get(Q.styleSamples);
    if (fixedSamples && typeof fixedSamples.value === 'string' && fixedSamples.value) {
      checkSamplesDir(fixedSamples.value, fixedSamples.source === 'flag' ? '--style-samples' : `--answers ${answersArg ?? ''}`);
    }
    const thesisSeed = oneLine(typeof a['thesis'] === 'string' ? (a['thesis'] as string) : fixed.thesis);

    // 2. The assignment (GRND-01).
    const assignment: ResolvedAssignment = await resolveAssignment({
      root: cwd,
      from: typeof a['from'] === 'string' ? (a['from'] as string) : undefined,
      at: typeof a['source'] === 'string' ? (a['source'] as string) : undefined,
      thesisSeed,
      yolo,
      canPrompt: prompting,
      ask: (q: PromptQuestion): Promise<PromptAnswer> => ask(q),
      say,
    });

    // 3. GRND-02: refuse before any model call or write when questions are left and nobody can answer them.
    await refuseUnanswered(unansweredQuestions(questions, fixed), yolo);

    // 4. RUN-07: a usable provider, before anything is written or sent.
    await assertLlmConfigured('new');
    process.stdout.write(DISCLAIMER + '\n\n');

    // 5. PII (GRND-05): settled BEFORE the model call.
    const piiQ = questions.find((q) => q.id === Q.pii) as IntakeQuestion;
    if (!fixed.values.has(Q.pii)) {
      if (prompting && !yolo) {
        const answer = await ask(promptFor(piiQ, false));
        const r = piiQ.parse(answer.value);
        fixed = withAnswer(fixed, Q.pii, { value: r.ok ? r.value : false, source: 'asked' });
      } else {
        fixed = withAnswer(fixed, Q.pii, { value: false, source: 'default' });
      }
    }
    const piiOn = fixed.values.get(Q.pii)?.value === true;
    const keep = topicKeepPhrases(assignment.text);
    const redact = (s: string): string => (piiOn ? redactPii(s, { keep }) : s);
    // The model-bound text: LF line ends, no trailing blank lines (a byte-stable request on every platform).
    const rawModelText = withThesisSeed(assignment.text.replace(/\r\n?/g, '\n').replace(/\s+$/, ''), thesisSeed);
    const modelText = redact(rawModelText);
    if (piiOn) {
      for (const d of diffPii(rawModelText, undefined, { keep })) say(`pensmith new: [${d.kind}] "${d.raw}" → ${d.tag}`);
    }

    // 6. The clarifier (suggestions only; GRND-02, D-18-10).
    const answersBlock = clarifierAnswers(fixed);
    const req = buildPromptRequest('intake-clarifier', {
      disciplines: disciplineSlugs().map((slug) => ({ slug, name: presetFor(slug).name })),
      ...(answersBlock !== undefined ? { answers: answersBlock } : {}),
      assignment: modelText || '(no assignment text was provided)',
    });
    const result = await complete<IntakeClarification>({
      slug: 'intake-clarifier',
      system: req.system,
      messages: req.messages,
      stubHint: requestHints(req),
    });
    // D-18-10: a reply that merely copies the template's own example is not a
    // suggestion for THIS assignment — every field of it is discarded.
    const parroted = isTemplateExample(result.data as IntakeClarification, req.system);
    if (parroted) {
      process.stderr.write('pensmith new: WARN — the clarifier replied with its template example, not suggestions for this assignment; using the assignment\'s own wording and the preset defaults\n');
    }
    const suggestion: IntakeClarification = parroted ? NO_SUGGESTIONS : (result.data as IntakeClarification);

    // Deterministic facts and overrides from the assignment and the thesis seed
    // (GRND-04). The citation style, the stated length and a discipline mention
    // are closed values (a CSL key, a number, a preset slug), so they are read
    // from the RAW text: no user text travels through them, and a style name
    // the PII redactor took for a person ("Use Chicago style") still counts.
    // Sectioning notes and the topic are text, so they come only from the
    // model-bound (redacted) text (GRND-05).
    const rawOverrides = parseIntakeOverrides(rawModelText, []);
    const overrides = { ...parseIntakeOverrides(modelText, []), citationStyle: rawOverrides.citationStyle };
    const stated = statedLengthWords(rawModelText);
    const deterministicTopic = topicFromAssignment(modelText);
    const clarifierTopic = oneLine(suggestion.topic);
    // The topic is the clarifier's phrase when it is grounded in the
    // assignment's words, else the assignment's own topic phrase.
    const topic = clarifierTopic && topicIsGrounded(clarifierTopic, modelText)
      ? clarifierTopic
      : deterministicTopic || clarifierTopic || thesisSeed.split(/\s+/).slice(0, 12).join(' ');
    const suggestedDiscipline = suggestion.discipline
      ? normalizeDisciplineSlug(suggestion.discipline)
      : (disciplineMentionFrom(rawModelText) ?? FALLBACK_DISCIPLINE);

    // 7. The battery.
    const answers = await resolveBattery({
      questions,
      fixed,
      yolo,
      canPrompt: prompting,
      ask: (q) => ask(q),
      note: (line) => process.stderr.write(line + '\n'),
      suggest: (q, sofar) => {
        if (q.id === Q.discipline) return suggestedDiscipline;
        if (q.id === Q.length) {
          return stated ?? (suggestion.length_target_words > 0 ? suggestion.length_target_words : DEFAULT_LENGTH_WORDS);
        }
        if (q.id === Q.citationStyle) {
          const d = sofar.get(Q.discipline)?.value;
          return overrides.citationStyle?.style
            ?? citationStyleKey(suggestion.citation_style)
            ?? defaultCitationStyleFor(typeof d === 'string' ? d : suggestedDiscipline);
        }
        return q.staticDefault ?? '';
      },
    });
    const defaulted = questions.filter((q) => answers.get(q.id)?.source === 'default');
    if (yolo && defaulted.length > 0) {
      say('pensmith new: --yolo accepted the suggested intake defaults:');
      for (const q of defaulted) say(`  ${q.id} = ${q.display((answers.get(q.id) as ResolvedAnswer).value)}`);
    }
    const followUps = await resolveFollowUps({
      followUps: suggestion.follow_ups,
      fixed: fixed.followUps,
      yolo,
      canPrompt: prompting,
      ask: (q) => ask(q),
    });

    // Overrides in the answers (GRND-04): a style asked for in a follow-up
    // answer replaces a DEFAULTED style (never one the user chose); every
    // sectioning note is kept.
    const answerTexts = followUps.filter((f) => f.how !== 'suggested').map((f) => f.answer);
    const fromAnswers = parseIntakeOverrides('', answerTexts.map(redact));
    // As above: the style (a CSL key) from the raw answers, the notes redacted.
    const styleFromAnswers = parseIntakeOverrides('', answerTexts).citationStyle;
    const styleAnswer = answers.get(Q.citationStyle) as ResolvedAnswer;
    const citationStyle = styleAnswer.source === 'default' && styleFromAnswers
      ? styleFromAnswers.style
      : String(styleAnswer.value);
    const notes = [...overrides.sectioningNotes];
    for (const n of [...fromAnswers.sectioningNotes, ...suggestion.sectioning_notes.map(oneLine).map(redact)]) {
      if (n && !notes.some((x) => x.toLowerCase() === n.toLowerCase())) notes.push(n);
    }

    // The style-samples folder of an asked or defaulted answer (flags were checked up front).
    const samplesAnswer = String(answers.get(Q.styleSamples)?.value ?? '');
    const samplesDir = checkSamplesDir(samplesAnswer, '--style-samples');

    const value = (id: string): IntakeAnswerValue => (answers.get(id) as ResolvedAnswer).value;
    const fq = questions.find((q) => q.key === TUTORIAL_INTAKE_QUESTION.key) as IntakeQuestion;
    const klass = redact(String(value(Q.class)));
    const discipline = String(value(Q.discipline));
    const lengthWords = Number(value(Q.length));
    const counterargument = String(value(Q.counterargument)) as 'yes' | 'no' | 'auto';
    const brief: IntakeBriefInput = {
      topic: redact(topic).slice(0, 300),
      thesis: redact(thesisSeed || oneLine(suggestion.thesis)),
      discipline,
      paper_type: suggestion.paper_type !== 'other' ? suggestion.paper_type : paperTypeFrom(modelText),
      mode: String(value(Q.mode)) as 'draft' | 'outline',
      [fq.key]: value(fq.id),
      class: klass,
      counterargument,
      length_target_words: lengthWords,
      citation_style: citationStyle as IntakeBriefInput['citation_style'],
      sectioning_notes: notes.slice(0, 10),
      pii_redaction: piiOn,
      style_match: samplesDir !== '',
      assignment_source: { kind: assignment.source.kind, name: assignment.source.name },
      follow_ups: followUps.map((f) => ({ id: f.id, question: oneLine(f.question), answer: redact(oneLine(f.answer)) })),
    };
    const qa: IntakeQa[] = [
      ...questions.map((q) => {
        const r = answers.get(q.id) as ResolvedAnswer;
        // Only a free-text answer can carry user PII; a choice or yes/no answer
        // is shown by its fixed option label ("Computer Science"), which the
        // redactor would otherwise mistake for a name (GRND-05 precision).
        const shown = q.kind === 'text' ? redact(q.display(r.value)) : q.display(r.value);
        return { id: q.id, question: q.label, answer: `${shown} — ${sourceNote(r.source)}` };
      }),
      ...followUps.map((f) => ({ id: `follow-up/${f.id}`, question: f.question, answer: redact(followUpNote(f, yolo)) })),
    ];
    const assignmentBlock = assignment.text ? redact(assignment.text) : thesisSeed ? `${THESIS_SEED_LABEL} ${redact(thesisSeed)}` : '';
    let doc = renderIntakeDocument(brief, assignmentBlock, qa);
    const marker = networkMode().dryRun ? offlineMarkerLine() : null;
    if (marker) doc = doc.replace(/^# Intake\n/m, `# Intake\n\n${marker}\n`);

    // 8. Writes — nothing above wrote a byte.
    await ensurePaperGitignore(cwd);
    if (piiOn) {
      const raw = [
        '# INTAKE.raw.local — the raw intake text before PII redaction (local only: never sent to a model, never committed)',
        '',
        '## Assignment',
        '',
        assignment.text.replace(/\r\n/g, '\n').trim() || '(none)',
        '',
        ...(thesisSeed ? ['## Thesis seed', '', thesisSeed, ''] : []),
        '## Answers',
        '',
        `- class: ${String(value(Q.class))}`,
        ...followUps.map((f) => `- follow-up/${f.id}: ${oneLine(f.answer)}`),
        '',
      ].join('\n');
      await atomicWriteFile(path.join(paperDir(cwd), 'INTAKE.raw.local'), raw);
    }
    try {
      await initState(cwd);
    } catch (e) {
      if (!(e instanceof StateAlreadyExistsError)) throw e;
    }
    const target = intakePath(cwd);
    await atomicWriteFile(target, doc);
    say(`pensmith new: wrote INTAKE.md to ${target}`);
    await writeIntakeConfig(cwd, {
      mode: String(value(Q.mode)),
      fragment: { [fq.key]: value(fq.id) },
      class: klass,
      disciplinePreset: discipline,
      citationStyle,
      lengthTargetWords: lengthWords,
      counterargument,
      piiRedaction: piiOn,
      styleSamplesDir: samplesDir,
    });
    // SRC-15 (D-19-21): bring-your-own PDFs, after STATE.json, INTAKE.md and config.toml exist.
    if (byoDir !== null) await ingestByoFolderForNew(cwd, byoDir);
    let paperId: string | null = null;
    try {
      paperId = (await loadState(cwd)).paperId;
    } catch {
      paperId = null;
    }
    const name = paperName(cwd);
    await registerPaperNonFatal(cwd, paperId, name, klass);
    if (samplesDir) await runStyleProducerNonFatal(cwd, samplesDir, paperId, name);
    say(`pensmith new: topic: ${brief.topic} · ${presetFor(discipline).name} · ${lengthWords} words · ${citationStyleDisplay(citationStyle)} · class ${klass}`);
    return { ok: true, path: target, mode: 'real' };
  },
});

export default intakeCommand;
