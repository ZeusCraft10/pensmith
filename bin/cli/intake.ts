// bin/cli/intake.ts — `pensmith new`: start a paper.
//
// Intake keeps the assignment and the user's answers (bin/lib/intake-record.ts):
//   1. The assignment comes from --from <file> (`-` for stdin), else an
//      assignment.txt / .md / .pdf in the folder, else the one kept from an
//      earlier run, else it is asked for. A thesis (--thesis, from `sketch`,
//      or the one kept) is added to it once, as its last paragraph, and stands
//      alone when there is no assignment; `--thesis ''` clears it. It is kept
//      word for word in .paper/PROJECT.md before any model sees it.
//   2. The intake clarifier suggests answers to six questions (topic,
//      discipline, length, citation style, audience, counterargument) as
//      structured JSON. It is asked only when an answer is still missing.
//   3. The answers come from --answers <file|json> and --citation-style, and on
//      a terminal from the user. Without a terminal, intake stops with exit 3
//      and prints the questions as one JSON line; nothing is guessed. The
//      answers and options given so far are kept in .paper/INTAKE.pending.json
//      for the answering run, which sends only what is still open.
//   4. The checked answers are written to .paper/INTAKE.json (and readable in
//      INTAKE.md); the citation style goes to [project] citation_style in
//      .paper/config.toml, edited in place, together with --goal and
//      --pii-redact when this intake was given them.
// With PII redaction on, the assignment and the free-text answers are redacted
// before they are stored in .paper/ or sent to a model; the raw text goes only
// to .paper/INTAKE.raw.local, which .paper/.gitignore keeps out of git.

import { defineCommand } from 'citty';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { ask, canAskInTerminal, PromptAbortedError, PromptTimeoutError, type AskOptions } from '../lib/prompts.js';
import { atomicWriteFile, removePath } from '../lib/atomic-write.js';
import { redactPii, diffPii } from '../lib/pii.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { SUPPORTED_STYLES } from '../lib/citations.js';
import { EXIT_NEEDS_ANSWER, EXIT_REFUSED } from '../lib/exit-codes.js';
import { paperConfigFile, paperDir, paperIntakeFile } from '../lib/paths.js';
import { ensurePaperGitignore } from '../lib/paper-gitignore.js';
import { readProjectConfig } from '../lib/project-config.js';
import { setConfigValues } from '../lib/config-edit.js';
import { initState, loadState, StateAlreadyExistsError } from '../lib/state.js';
import { registerPaperInGlobalLibrary } from '../lib/global-library.js';
import { extractPdfText } from '../lib/pdf-text.js';
import { checkModelJson, modelJsonSchema } from '../lib/schemas/model-json.js';
import { sha256 } from '../lib/verify/verification-record.js';
import {
  buildQuestions,
  checkAnswer,
  ClarifierSchema,
  intakeFromAnswers,
  normalizeThesis,
  presetCounterargument,
  QUESTION_IDS,
  readAssignment,
  renderIntakeMd,
  renderProjectMd,
  splitThesis,
  withThesis,
  type ClarifierAnswer,
  type Question,
  type QuestionId,
} from '../lib/intake-record.js';
import {
  buildStyleProfile,
  checkAndRegisterFingerprint,
  writeStyleProfile,
} from '../lib/style-match.js';

// Every model-bound interpolate goes through this seam, so a test can see the
// exact text that leaves for the model (tests/intake-pii-egress.test.ts). An
// ES module's exports cannot be replaced from outside, so the seam is here.
let _interpolate: (template: string, vars: Record<string, string>) => string = interpolate;

/** Test-only seam: override the model-bound interpolate to capture egress. */
export function __setInterpolateForTest(
  fn: (template: string, vars: Record<string, string>) => string,
): () => void {
  const prev = _interpolate;
  _interpolate = fn;
  return () => {
    _interpolate = prev;
  };
}

/** Ask one question; null when the user cancels. */
type Asker = (q: Question, invalid?: string) => Promise<string | null>;
let _ask: Asker | null = null;

/** Test-only seam: answer the questions as a terminal user would. */
export function __setAskForTest(fn: Asker | null): () => void {
  const prev = _ask;
  _ask = fn;
  return () => {
    _ask = prev;
  };
}

/** Ask one question in the terminal; null when the user cancels or does not answer in time. `opts` is for tests. */
export async function askInTerminal(q: Question, invalid?: string, opts: AskOptions = {}): Promise<string | null> {
  try {
    const a = await ask(
      {
        id: q.id,
        kind: 'text',
        label: invalid ? `${q.question} (${invalid})` : q.question,
        ...(q.suggested ? { default: q.suggested } : {}),
      },
      opts,
    );
    return typeof a.value === 'string' ? a.value : null;
  } catch (e) {
    // A cancelled or unanswered prompt ends intake as a refusal, with the state left as it was.
    if (e instanceof PromptAbortedError || e instanceof PromptTimeoutError) return null;
    throw e;
  }
}

/**
 * Resolve the paper's display name + class: [project] title and class in
 * .paper/config.toml, else the folder's name and 'Unfiled'. Never throws.
 */
function resolvePaperMeta(cwd: string): { name: string; class: string } {
  const name = path.basename(cwd) || 'Untitled paper';
  const project = readProjectConfig(cwd);
  const c = project['class'];
  const klass = typeof c === 'string' && c.trim() ? c.trim() : 'Unfiled';
  const t = project['title'];
  return { name: typeof t === 'string' && t.trim() ? t.trim() : name, class: klass };
}

const GOALS = ['draft', 'learning', 'both'] as const;

/** The options a run that stops for answers keeps for the answering run (RunSettings, and the thesis in PROJECT.md). */
const KEPT_OPTIONS = '--goal, --pii-redact, --thesis, --style-samples';

/** PII redaction is opt-in: the --pii-redact argument, else [project] pii_redaction. */
function resolvePiiRedact(cwd: string, argValue: boolean | undefined): boolean {
  if (typeof argValue === 'boolean') return argValue;
  return readProjectConfig(cwd)['pii_redaction'] === true;
}

/** The paperId in .paper/STATE.json, or null when there is none yet. */
async function resolvePaperId(cwd: string): Promise<string | null> {
  try {
    return (await loadState(cwd)).paperId;
  } catch {
    return null;
  }
}

/**
 * Add the paper to the global list of papers (`list`, `open`). Its status
 * there is worked out from the paper's own files whenever it is shown, so
 * intake records only 'intake'. Never fails the verb.
 */
async function registerPaperNonFatal(
  cwd: string,
  paperId: string | null,
  meta: { name: string; class: string },
): Promise<void> {
  try {
    if (!paperId) {
      process.stderr.write('pensmith new: WARN — no paperId yet (STATE.json absent); not added to the list of papers.\n');
      return;
    }
    const now = new Date().toISOString();
    await registerPaperInGlobalLibrary({
      id: paperId,
      name: meta.name,
      folderPath: path.resolve(cwd),
      class: meta.class,
      status: 'intake',
      createdAt: now,
      updatedAt: now,
    });
  } catch (e) {
    process.stderr.write(`pensmith new: WARN — could not add the paper to the list of papers: ${(e as Error).message}\n`);
  }
}

/**
 * The opt-in style match: build .paper/STYLE.json from the user's writing
 * samples. Reuse of the same samples for another paper is always reported,
 * before the profile is written. Never fails the verb.
 */
async function runStyleProducerNonFatal(
  cwd: string,
  samplesDir: string,
  paperId: string | null,
  name: string,
): Promise<void> {
  try {
    const fpPaperId = paperId ?? `unregistered:${path.resolve(cwd)}`;
    const profile = await buildStyleProfile(samplesDir);
    const { priorPapers } = await checkAndRegisterFingerprint(profile.fingerprint, fpPaperId, name);
    if (priorPapers.length > 0) {
      const names = priorPapers.map((p) => p.paperName || p.paperId).join(', ');
      process.stdout.write(
        `pensmith new: NOTICE — these writing samples were already used to style a prior paper: ${names}. ` +
          `Style Match mirrors your own voice; reuse across papers is surfaced here for transparency.\n`,
      );
    }
    await writeStyleProfile(paperDir(cwd), profile);
    process.stdout.write(`pensmith new: wrote style profile to ${path.join(paperDir(cwd), 'STYLE.json')}\n`);
  } catch (e) {
    process.stderr.write(`pensmith new: WARN — style-match producer failed (non-fatal): ${(e as Error).message}\n`);
  }
}

const ASSIGNMENT_FILE = /^assignment\.(txt|md|markdown|pdf)$/i;

/** An assignment.* file in `cwd`, text before PDF, or null. */
function findAssignmentFile(cwd: string): string | null {
  let names: string[];
  try {
    names = readdirSync(cwd).filter((n) => ASSIGNMENT_FILE.test(n));
  } catch {
    return null;
  }
  names.sort((a, b) => Number(a.toLowerCase().endsWith('.pdf')) - Number(b.toLowerCase().endsWith('.pdf')) || a.localeCompare(b));
  return names[0] ? path.join(cwd, names[0]) : null;
}

async function readAssignmentFile(file: string): Promise<string> {
  if (file === '-') return readFileSync(0, 'utf8');
  const bytes = readFileSync(file);
  return file.toLowerCase().endsWith('.pdf') ? extractPdfText(bytes) : bytes.toString('utf8');
}

class IntakeInputError extends Error {}

/** The --answers argument (a JSON object, or the path of a file holding one) as id → answer. */
function parseAnswersArg(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  let text: string;
  if (typeof raw === 'object' && !Array.isArray(raw)) text = JSON.stringify(raw); // a dispatched verb's own args
  else if (typeof raw === 'string') text = raw.trim();
  else throw new IntakeInputError('--answers takes a JSON object or the path of a JSON file');
  if (!text.startsWith('{')) {
    if (!existsSync(text)) throw new IntakeInputError(`--answers: no such file ${JSON.stringify(text)}, and it is not a JSON object`);
    text = readFileSync(text, 'utf8');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new IntakeInputError(`--answers is not valid JSON (${(e as Error).message})`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new IntakeInputError('--answers must be a JSON object of question id to answer');
  }
  const known = new Set<string>([...QUESTION_IDS, 'assignment']);
  const unknown = Object.keys(value).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new IntakeInputError(`--answers has unknown question id(s): ${unknown.join(', ')}. Known: ${[...known].join(', ')}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Where intake keeps what a run without a terminal left open: the options it
 * was given, the questions it is waiting on and the answers already given,
 * the last two keyed on the assignment. The answering run then asks the model
 * nothing, need not repeat the options, and a client can answer the questions
 * a few at a time.
 */
function pendingFile(cwd: string): string {
  return path.join(paperDir(cwd), 'INTAKE.pending.json');
}

type Answers = Partial<Record<QuestionId, string | number>>;

/**
 * The options of a run besides its answers. They shape what is kept (the
 * assignment, its redaction) and what intake saves when it completes, so an
 * answering run that leaves them out must not lose them.
 */
interface RunSettings {
  goal?: string;
  pii_redaction?: boolean;
  style_samples?: string;
}

/** The pending file as JSON, or null (none, or a file pensmith cannot use). */
function readPendingJson(cwd: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(readFileSync(pendingFile(cwd), 'utf8'));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The options an earlier run of this intake kept, checked again (the file is in the user's folder). */
function readKeptSettings(cwd: string): RunSettings {
  const v = readPendingJson(cwd)?.['settings'];
  if (v === null || typeof v !== 'object') return {};
  const s = v as Record<string, unknown>;
  const out: RunSettings = {};
  if (typeof s['goal'] === 'string' && (GOALS as readonly string[]).includes(s['goal'])) out.goal = s['goal'];
  if (typeof s['pii_redaction'] === 'boolean') out.pii_redaction = s['pii_redaction'];
  if (typeof s['style_samples'] === 'string' && s['style_samples'].trim()) out.style_samples = s['style_samples'].trim();
  return out;
}

interface Pending {
  /** The questions kept for this assignment; null when none were (the run before had no assignment). */
  questions: Question[] | null;
  answers: Answers;
}

/**
 * The key the answers are kept under: the assignment without its thesis, so a
 * thesis added or changed later keeps them. null while there is no assignment
 * text besides a thesis.
 */
function answersKey(assignment: string): string | null {
  const { base } = splitThesis(assignment);
  return base ? sha256(base) : null;
}

/**
 * What an earlier run kept for `assignment` (null: no assignment yet), or null
 * (none, another assignment, or a file pensmith cannot use). The questions are
 * reused only for the same assignment and thesis. The answers count for the
 * same assignment whatever its thesis, and answers kept by a run that had no
 * assignment yet count for the one given next.
 */
function readPending(cwd: string, assignment: string | null): Pending | null {
  const v = readPendingJson(cwd);
  if (v === null) return null;
  let questions: Question[] | null = null;
  if (assignment !== null && v['assignment_sha256'] === sha256(assignment) && Array.isArray(v['questions'])) {
    const kept = v['questions'] as Question[];
    if (QUESTION_IDS.every((id) => kept.some((q) => q?.id === id))) questions = kept;
  }
  const answersCount =
    'answers_key' in v
      ? v['answers_key'] === null || (assignment !== null && v['answers_key'] === answersKey(assignment))
      : v['assignment_sha256'] === undefined || (assignment !== null && v['assignment_sha256'] === sha256(assignment));
  if (!answersCount) return null;
  const answers: Answers = {};
  const kept = v['answers'] !== null && typeof v['answers'] === 'object' ? (v['answers'] as Record<string, unknown>) : {};
  for (const id of QUESTION_IDS) {
    if (kept[id] === undefined) continue;
    // Checked again: the file is in the user's folder.
    const c = checkAnswer(id, kept[id]);
    if (c.ok) answers[id] = c.value;
  }
  return { questions, answers };
}

async function writePending(
  cwd: string,
  kept: { assignment_sha256?: string; answers_key?: string | null; questions?: Question[]; answers: Answers; settings: RunSettings },
): Promise<void> {
  await atomicWriteFile(pendingFile(cwd), JSON.stringify(kept, null, 2) + '\n');
}

/** Where the raw assignment is kept when PII redaction is on (.paper/.gitignore keeps it out of git). */
function rawAssignmentFile(cwd: string): string {
  return path.join(paperDir(cwd), 'INTAKE.raw.local');
}

/** With PII redaction on, the free-text answers as they may be stored. */
function storableAnswers(answers: Answers, piiRedact: boolean): Answers {
  if (!piiRedact) return answers;
  const out: Answers = { ...answers };
  for (const id of ['topic', 'audience'] as const) if (out[id] !== undefined) out[id] = redactPii(String(out[id]));
  return out;
}

/**
 * The assignment as it may be stored: with PII redaction on, `raw` redacted
 * (each redaction listed when `reportDiff`), its raw text written only to
 * INTAKE.raw.local; else `raw`.
 */
async function keepAssignment(cwd: string, raw: string, piiRedact: boolean, reportDiff: boolean): Promise<string> {
  if (!piiRedact) return raw;
  const redacted = redactPii(raw);
  if (reportDiff) {
    for (const d of diffPii(raw, redacted)) process.stdout.write(`pensmith new: [${d.kind}] "${d.raw}" → ${d.tag}\n`);
  }
  await atomicWriteFile(rawAssignmentFile(cwd), raw + '\n');
  return redacted;
}

/**
 * The kept assignment's raw text, for redacting it again with what this run
 * adds: INTAKE.raw.local when its redaction is what PROJECT.md holds, else
 * PROJECT.md's own text.
 */
function keptRawAssignment(cwd: string, stored: string): string {
  try {
    const raw = readFileSync(rawAssignmentFile(cwd), 'utf8').trim();
    if (raw && redactPii(raw).trim() === stored) return raw;
  } catch {
    // none kept: PROJECT.md's text is the one there is
  }
  return stored;
}

/** The clarifier's answer for `assignment`, or null when no model ran. */
async function askClarifier(assignment: string): Promise<ClarifierAnswer | null> {
  const prompt = loadPrompt('intake-clarifier');
  // The assignment (redacted when PII redaction is on) is the user turn.
  const system = _interpolate(prompt, { assignment });
  const result = await complete({
    system,
    messages: [{ role: 'user', content: assignment }],
    role: 'intake',
    scope: 'task',
    scopeId: 'intake',
    jsonSchema: modelJsonSchema(ClarifierSchema),
  });
  if (result.placeholder) return null;
  const checked = checkModelJson(ClarifierSchema, result.json);
  if (!checked.ok) {
    process.stderr.write(`pensmith new: WARN — the clarifier's suggestions were not usable (${checked.problems.join('; ')}); asking without them.\n`);
    return null;
  }
  return checked.value;
}

function refuse(message: string): { ok: false; mode: 'invalid-input' } {
  process.stderr.write(`pensmith new: ${message}\n`);
  process.exitCode = EXIT_REFUSED;
  return { ok: false, mode: 'invalid-input' };
}

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

export const intakeCommand = defineCommand({
  meta: {
    name: 'new',
    description: 'Start a new paper: keep the assignment and answer the clarifying questions.',
  },
  args: {
    from: {
      type: 'string',
      description: 'The assignment file (.txt, .md or .pdf; - for stdin). Default: assignment.* in this folder.',
    },
    answers: {
      type: 'string',
      description: `Answers to the intake questions: a JSON object of ${QUESTION_IDS.join(', ')}, or the path of a JSON file.`,
    },
    // `sketch` dispatches `new` with the thesis the user confirmed.
    thesis: {
      type: 'string',
      description: 'A candidate thesis to start from (optional; supplied by `sketch`).',
    },
    // Opt-in: no flag, no profiling.
    styleSamples: {
      type: 'string',
      description: 'Opt-in: path to a folder of your writing samples to match your voice (.md/.txt/.docx).',
    },
    // Saved only when given (no default), so a rerun never resets it.
    goal: {
      type: 'string',
      description: 'Workflow goal: draft (the default), learning, or both.',
    },
    'pii-redact': {
      type: 'boolean',
      description: 'Opt-in: redact PII from the assignment and your answers before they are stored or sent to a model.',
    },
    'citation-style': {
      type: 'string',
      description: `Citation style for the export (answers that question): ${SUPPORTED_STYLES.join(', ')}.`,
    },
    yolo: {
      type: 'boolean',
      description: 'Has no effect on intake: the questions are always answered by you.',
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();

    // ── Check the arguments before anything is written. ──
    let given: Record<string, unknown>;
    try {
      given = parseAnswersArg(args.answers);
    } catch (e) {
      if (e instanceof IntakeInputError) return refuse(e.message);
      throw e;
    }
    if (typeof args['citation-style'] === 'string' && args['citation-style'].trim()) {
      given['citation_style'] = args['citation-style'].trim();
    }
    const answers: Answers = {};
    for (const id of QUESTION_IDS) {
      if (given[id] === undefined) continue;
      const c = checkAnswer(id, given[id]);
      if (!c.ok) return refuse(`the ${id} answer cannot be used: ${c.why}.`);
      answers[id] = c.value;
    }
    const goalArg = typeof args.goal === 'string' && args.goal.trim() ? args.goal.trim().toLowerCase() : undefined;
    if (goalArg !== undefined && !(GOALS as readonly string[]).includes(goalArg)) {
      return refuse(`unknown goal '${args.goal}'. Use one of: ${GOALS.join(', ')}.`);
    }
    const piiArg =
      typeof args['pii-redact'] === 'boolean'
        ? (args['pii-redact'] as boolean)
        : typeof (args as Record<string, unknown>)['redactPii'] === 'boolean'
          ? ((args as Record<string, unknown>)['redactPii'] as boolean)
          : undefined;
    const fromArg = typeof args.from === 'string' && args.from.trim() ? args.from.trim() : undefined;
    if (fromArg !== undefined && fromArg !== '-' && !existsSync(fromArg)) {
      return refuse(`no such assignment file: ${fromArg}`);
    }
    // An option given now wins; else the one an earlier run of this intake kept.
    const settings: RunSettings = readKeptSettings(cwd);
    if (goalArg !== undefined) settings.goal = goalArg;
    if (piiArg !== undefined) settings.pii_redaction = piiArg;
    // A thesis given now ('' clears it), else the one kept in PROJECT.md.
    const thesisArg = typeof args.thesis === 'string' ? normalizeThesis(args.thesis) : undefined;
    if (typeof args.styleSamples === 'string' && args.styleSamples.trim()) settings.style_samples = args.styleSamples.trim();

    // PRD §3 disclaimer, before any question or model call.
    process.stdout.write(DISCLAIMER + '\n\n');

    // The raw-PII file and the source texts are kept out of git before anything is written.
    await ensurePaperGitignore(cwd);

    // ── 1. The assignment. ──
    let brought = '';
    const file = fromArg ?? findAssignmentFile(cwd);
    if (file !== null) {
      try {
        brought = (await readAssignmentFile(file)).trim();
      } catch (e) {
        return refuse(`could not read the assignment from ${file}: ${(e as Error).message}`);
      }
      if (fromArg === undefined) process.stdout.write(`pensmith new: using the assignment in ${path.basename(file)}\n`);
    }
    if (typeof given['assignment'] === 'string' && given['assignment'].trim()) {
      brought = [brought, given['assignment'].trim()].filter(Boolean).join('\n\n');
    }

    // Resolved before the assignment is redacted and hashed, so an answering run finds what was kept for it.
    const piiRedact = resolvePiiRedact(cwd, settings.pii_redaction);
    // A run that brings no assignment text starts from the kept one, and a
    // kept thesis stays unless this run gives another or clears it.
    const keptStored = readAssignment(cwd);
    const keptRaw = keptStored === null ? null : piiRedact ? keptRawAssignment(cwd, keptStored) : keptStored;
    const keptParts = keptRaw === null ? null : splitThesis(keptRaw);
    const rawAssignment = withThesis(brought || keptParts?.base || '', thesisArg ?? keptParts?.thesis ?? '');
    let assignment: string;
    if (rawAssignment) {
      if (rawAssignment === keptRaw && !piiRedact) {
        assignment = keptStored!;
      } else {
        // The raw text goes only to INTAKE.raw.local; everything else sees the redacted text.
        assignment = await keepAssignment(cwd, rawAssignment, piiRedact, brought !== '' || rawAssignment !== keptRaw);
      }
    } else {
      // The kept text was only a thesis, and this run clears it.
      if (keptStored !== null) await removePath(path.join(paperDir(cwd), 'PROJECT.md'));
      if (_ask || canAskInTerminal(process.stdout)) {
        const typed = await (_ask ?? askInTerminal)({
          id: 'assignment',
          question: 'Paste the assignment prompt (or rerun with --from <file>):',
          suggested: '',
        });
        if (!typed?.trim()) return refuse('no assignment was given; nothing was saved.');
        assignment = await keepAssignment(cwd, typed.trim(), piiRedact, false);
      } else {
        // The options and answers given so far are kept for the run that brings the assignment.
        const keptAnswers: Answers = { ...readPending(cwd, null)?.answers, ...storableAnswers(answers, piiRedact) };
        if (Object.keys(keptAnswers).length > 0 || Object.keys(settings).length > 0) {
          await writePending(cwd, { answers: keptAnswers, settings });
        }
        process.stderr.write(
          'pensmith new: there is no assignment to start from. Pass --from <file>, put an assignment.txt, .md or .pdf in this folder, ' +
            'or answer "assignment" with --answers.\n',
        );
        process.stdout.write(
          `${JSON.stringify({
            pending: 'intake-questions',
            gate: 'intake',
            summary: 'pensmith needs the assignment prompt to start the paper.',
            questions: [{ id: 'assignment', question: 'What is the assignment prompt? (paste it in full)', suggested: '' }],
            answered: QUESTION_IDS.filter((id) => keptAnswers[id] !== undefined),
            how_to_answer:
              "Run `pensmith new --from <file>`, or `pensmith new --answers '{\"assignment\": \"...\"}'`. " +
              `The answers and options given so far (${KEPT_OPTIONS}) are kept until intake completes.`,
          })}\n`,
        );
        process.exitCode = EXIT_NEEDS_ANSWER;
        return { ok: false, mode: 'pending', pending: ['assignment'] };
      }
    }
    const projectMd = path.join(paperDir(cwd), 'PROJECT.md');
    const meta = resolvePaperMeta(cwd);
    if (readAssignment(cwd) !== assignment) {
      await atomicWriteFile(projectMd, renderProjectMd(meta.name, assignment));
      process.stdout.write(`pensmith new: kept the assignment in ${projectMd}\n`);
    }

    // ── 2. The questions still to answer, with the clarifier's suggestions. ──
    // Answers an earlier run kept for this assignment count; one given now wins.
    const pending = readPending(cwd, assignment);
    for (const id of QUESTION_IDS) {
      const kept = pending?.answers[id];
      if (answers[id] === undefined && kept !== undefined) answers[id] = kept;
    }
    const missing = QUESTION_IDS.filter((id) => answers[id] === undefined);
    if (missing.length > 0) {
      let questions: Question[];
      if (pending?.questions) {
        questions = pending.questions;
      } else {
        // Without a key there is no model to ask, and intake says so.
        if (process.env['PENSMITH_NO_LLM'] !== '1') {
          try {
            await getProviderApiKey(await resolveProviderId());
          } catch (e) {
            if (e instanceof MissingApiKeyError) {
              process.stderr.write(
                'pensmith new: ERROR — no LLM key configured.\n' +
                  'Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation,\n' +
                  `or give every answer with --answers (${QUESTION_IDS.join(', ')}).\n`,
              );
              process.exitCode = 1;
              return { ok: false, mode: 'no-key-configured' };
            }
            throw e;
          }
        }
        questions = buildQuestions(assignment, await askClarifier(assignment));
      }
      // The counterargument default is the discipline's, once the discipline is known.
      const discipline = answers['discipline'];
      questions = questions.map((q) =>
        q.id === 'counterargument' && !q.suggested && typeof discipline === 'string' ? { ...q, suggested: presetCounterargument(discipline) } : q,
      );

      // ── 3. The answers: asked on a terminal, else reported and left pending. ──
      const waiting = questions.filter((q) => missing.includes(q.id as QuestionId));
      const ask = _ask ?? (canAskInTerminal(process.stdout) ? askInTerminal : null);
      if (ask) {
        for (const q of waiting) {
          let why: string | undefined;
          for (;;) {
            const typed = await ask(q, why);
            if (typed === null) return refuse('intake was cancelled; nothing more was saved.');
            const c = checkAnswer(q.id as QuestionId, typed);
            if (c.ok) {
              answers[q.id as QuestionId] = c.value;
              break;
            }
            why = c.why;
          }
        }
      } else {
        const given = storableAnswers(answers, piiRedact);
        await writePending(cwd, { assignment_sha256: sha256(assignment), answers_key: answersKey(assignment), questions, answers: given, settings });
        const keptIds = QUESTION_IDS.filter((id) => given[id] !== undefined);
        process.stderr.write(
          `pensmith new: ${waiting.length} intake question(s) need your answers and there is no terminal to ask in. ` +
            `The assignment${keptIds.length > 0 ? ' and the answers given so far are' : ' is'} kept until intake completes.\n`,
        );
        process.stdout.write(
          `${JSON.stringify({
            pending: 'intake-questions',
            gate: 'intake',
            summary: `Answer ${waiting.length} question(s) about the paper.`,
            questions: waiting,
            answered: keptIds,
            how_to_answer:
              "Ask the user each question, then run `pensmith new --answers '<JSON object of question id to answer>'` (or the path of a JSON file). " +
              'Answers already given (answered) are kept; send only the questions listed, or resend one to change it. ' +
              `The options given so far (${KEPT_OPTIONS}) are kept too.`,
          })}\n`,
        );
        process.exitCode = EXIT_NEEDS_ANSWER;
        return { ok: false, mode: 'pending', pending: waiting.map((q) => q.id), questions: waiting };
      }
    }

    // ── 4. Save. ──
    const intake = intakeFromAnswers(storableAnswers(answers, piiRedact) as Record<QuestionId, string | number>);
    await atomicWriteFile(paperIntakeFile(cwd), JSON.stringify(intake, null, 2) + '\n');
    const intakeMd = path.join(paperDir(cwd), 'INTAKE.md');
    await atomicWriteFile(intakeMd, renderIntakeMd(intake));
    await removePath(pendingFile(cwd));

    try {
      await initState(cwd);
    } catch (e) {
      if (!(e instanceof StateAlreadyExistsError)) throw e;
    }

    // Only the settings given to this intake (on this run or one that stopped
    // for answers) are written, and the file is edited in place.
    const project: Record<string, string | boolean> = { citation_style: intake.citation_style };
    if (settings.goal !== undefined) project['goal'] = settings.goal;
    if (settings.pii_redaction !== undefined) project['pii_redaction'] = settings.pii_redaction;
    const configFile = paperConfigFile(cwd);
    const notWritten = await setConfigValues(configFile, 'project', project);
    if (notWritten) {
      process.stderr.write(
        `pensmith new: WARN — ${configFile} was left as it is because ${notWritten}. ` +
          `Set these under [project] yourself: ${Object.entries(project).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')}.\n`,
      );
    }

    process.stdout.write(`pensmith new: wrote ${paperIntakeFile(cwd)} and ${intakeMd}\n`);
    const paperId = await resolvePaperId(cwd);
    await registerPaperNonFatal(cwd, paperId, meta);
    if (settings.style_samples) await runStyleProducerNonFatal(cwd, settings.style_samples, paperId, meta.name);
    return { ok: true, path: paperIntakeFile(cwd), mode: 'real', intake };
  },
});

export default intakeCommand;
