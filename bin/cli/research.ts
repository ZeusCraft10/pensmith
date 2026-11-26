// bin/cli/research.ts — `pensmith research`: find and screen sources into the library.
//
// What this verb does:
//   1. Load both research prompts first, so a prompt that drifted from its
//      pinned hash stops the run before any network call.
//   2. A candidate list kept for the author's choice (below) is applied, or
//      shown again, first: that needs neither the network nor a model key.
//   3. Otherwise: offline stops here; a model key must be configured.
//   4. Read the intake: topic, discipline and assignment.
//   5. Ask the topic disambiguator for search scopes, parsed defensively (an
//      answer that cannot be used falls back to the topic as the one query).
//   6. Scope approval gate (default-on): the author picks one; --yolo takes
//      the first.
//   7. runResearchOrchestrator: search the registries, merge duplicates, and
//      screen the candidates with the source evaluator.
//   8. Candidate approval gate (default-on): the author prunes what the
//      evaluator kept; --yolo keeps those; with no candidates there is
//      nothing to ask. When the evaluator gave no usable answer, the gate
//      offers every candidate with none selected, and --yolo adds nothing
//      (exit 2, research not marked done).
//      Without a terminal each gate keeps its choice (.paper/gates/) and
//      prints it as JSON with exit 3; `pensmith gate answer <ref> <option>`
//      continues from there with the author's answer, searching nothing
//      again for a kept candidate list.
//   9. Merge the approved candidates (marked retracted where their own
//      records say so) into .paper/LIBRARY.json (bin/lib/library.ts), which writes
//      CITATIONS.bib and CITATIONS.ris from it. A work the library already
//      holds keeps its citekey, and nothing already in it (a source added with
//      `pensmith add`, an entry edited by hand) is removed or rewritten.
//
// The key's value is never printed here; complete() alone puts it in a header.

import { defineCommand } from 'citty';
import path from 'node:path';
import { z } from 'zod';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { mergeCandidates, updateLibrary } from '../lib/library.js';
import { paperDir, paperIntakeFile } from '../lib/paths.js';
import { SourceCandidateSchema, type SourceCandidate } from '../lib/schemas/source-candidate.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { ask, canAskInTerminal } from '../lib/prompts.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';
import { closeGate, gateStillApplies, openGate, readGate, stopForAnswer, type GateRecord } from '../lib/gates.js';
import { fileSha256 } from '../lib/verify/verification-record.js';
import { escapeTemplateTokens } from '../lib/intake-parse.js';
import { readIntake } from '../lib/intake-record.js';
import { runResearchOrchestrator, SourceEvaluationError } from '../lib/research-orchestrator.js';
import { isOfflineMode, OFFLINE_SKIP_NOTE } from '../lib/network-mode.js';

// ---------------------------------------------------------------------------
// The topic disambiguator's answer, checked before it is used; research keeps
// the scopes in this shape while it waits for the author's choice.
// ---------------------------------------------------------------------------
const ScopeSchema = z.object({
  label: z.string().min(1),
  queries: z.array(z.string().min(1)).min(1),
});
const ScopesSchema = z.object({
  scopes: z.array(ScopeSchema).min(1),
});

type Scope = z.infer<typeof ScopeSchema>;

/** The candidates research keeps while it waits for the author's choice. */
const KeptCandidatesSchema = z.object({
  candidates: z.array(SourceCandidateSchema).min(1),
  evaluated: z.boolean(),
  /** When not evaluated: true when the evaluator kept none, false when it gave no usable answer. */
  kept_none: z.boolean().optional(),
  scope: z.string(),
});

/**
 * Why none of the candidates is chosen for the author, or null when the
 * evaluator chose some. A choice kept by an earlier build does not say which.
 */
function noneChosenBecause(kept: { evaluated: boolean; kept_none?: boolean | undefined }): string | null {
  if (kept.evaluated) return null;
  if (kept.kept_none === undefined) return 'The source evaluator chose none of them';
  return kept.kept_none ? 'The source evaluator kept none of them' : 'The source evaluator gave no usable answer';
}

/** What a kept choice is about: the intake research was asked for. */
function intakeFingerprint(root: string): string | null {
  return fileSha256(paperIntakeFile(root)) ?? fileSha256(path.join(paperDir(root), 'INTAKE.md'));
}

/** The scope labelled `label`, or the first scope when none is. */
function scopeNamed(scopes: Scope[], label: string | undefined): Scope {
  return scopes.find((sc) => sc.label === label) ?? scopes[0]!;
}

/** The candidates whose citekeys are `keys`, in the order found. */
function candidatesNamed(candidates: SourceCandidate[], keys: readonly string[]): SourceCandidate[] {
  return candidates.filter((c) => keys.includes(c.citekey));
}

/** The topic-disambiguator's scopes, or the topic as the one query when its answer cannot be used. */
async function proposeScopes(topic: string, discipline: string, assignment: string): Promise<Scope[]> {
  // The intake's text is escaped before interpolation, so {{...}} in it
  // cannot expand as a template token.
  const interpolatedPrompt = interpolate(loadPrompt('topic-disambiguator'), {
    topic: escapeTemplateTokens(topic || '(unknown topic — run pensmith intake first)'),
    discipline: escapeTemplateTokens(discipline),
    assignment: escapeTemplateTokens(assignment || '(no assignment text — run pensmith intake first)'),
  });
  const llmResult = await complete({
    system:
      'You are an academic research assistant. Your task is to disambiguate a ' +
      'research topic and propose search scopes. Return a JSON object in the ' +
      'exact format specified in the prompt. No prose outside the JSON object.',
    messages: [{ role: 'user', content: interpolatedPrompt }],
    role: 'research',
    scope: 'task',
    scopeId: 'research',
  });
  // On any parse failure: WARN + fall back to a single auto scope.
  try {
    const zodResult = ScopesSchema.safeParse(JSON.parse(llmResult.text));
    if (zodResult.success) return zodResult.data.scopes;
    process.stderr.write(
      `pensmith research: WARN — topic-disambiguator response failed schema validation ` +
      `(${zodResult.error.message.slice(0, 120)}); ` +
      `falling back to single-scope with topic as query.\n`,
    );
  } catch {
    process.stderr.write(
      `pensmith research: WARN — topic-disambiguator response is not valid JSON; ` +
      `falling back to single-scope with topic as query.\n`,
    );
  }
  return [{ label: 'auto', queries: [topic || 'research'] }];
}

/** Ask the person at the terminal which scope to search; the scope they chose. */
async function askScope(scopes: Scope[]): Promise<Scope> {
  const answer = await ask({
    id: 'scope',
    kind: 'select',
    label: 'Which research scope should I use?',
    options: scopes.map((sc) => ({ value: sc.label, label: sc.label, hint: sc.queries.slice(0, 2).join(', ') })),
    default: scopes[0]!.label,
  });
  const value = (answer as { value: string }).value;
  if (!scopes.some((sc) => sc.label === value)) {
    // Say so rather than silently falling through to the default.
    process.stderr.write(
      `pensmith research: WARN — scope selection returned unrecognised value "${value}"; falling back to first scope "${scopes[0]!.label}".\n`,
    );
  }
  return scopeNamed(scopes, value);
}

/** Ask the person at the terminal which candidates to keep; their citekeys. */
async function askCandidates(candidates: SourceCandidate[], evaluated: boolean): Promise<string[]> {
  const answer = await ask({
    id: 'candidates',
    kind: 'multiselect',
    label: `Select candidates to keep (${candidates.length} found):`,
    options: candidates.map((c) => ({
      value: c.citekey,
      label: `[${c.source}] ${c.title.slice(0, 60)}${c.title.length > 60 ? '…' : ''} (${c.year ?? '?'})`,
      hint: c.authors.slice(0, 2).join(', '),
    })),
    default: evaluated ? candidates.map((c) => c.citekey) : [],
  });
  const value = (answer as { value: unknown }).value;
  return Array.isArray(value) ? value.map(String) : [];
}

/** Print the kept scope choice (`scopes`, the ones an answer chooses from) and stop for the author's answer (exit 3). */
function showScopes(record: GateRecord, scopes: Scope[]): Record<string, unknown> {
  return stopForAnswer(
    'pensmith research: choosing the search scope needs the user, and there is no terminal to ask in; the scopes are kept until they answer.',
    record,
    'research-scope',
    { scopes },
  );
}

/** What the candidate decision shows: each candidate in brief. */
function candidatesShown(kept: z.infer<typeof KeptCandidatesSchema>): Record<string, unknown> {
  const candidates = kept.candidates.map((c) => ({
    key: c.citekey, source: c.source, title: c.title, authors: c.authors.slice(0, 3), year: c.year ?? null,
    ...(c.doi ? { doi: c.doi } : {}), ...(c.retracted ? { retracted: true } : {}),
  }));
  return { scope: kept.scope, evaluated: kept.evaluated, candidates };
}

/** Print the kept candidates (`kept`, the ones an answer chooses from) and stop for the author's choice (exit 3). */
function showCandidates(record: GateRecord, kept: z.infer<typeof KeptCandidatesSchema>): Record<string, unknown> {
  return stopForAnswer(
    'pensmith research: choosing which sources to keep needs the user, and there is no terminal to ask in; the candidates are kept until they answer.' +
      (noneChosenBecause(kept) ? ` ${noneChosenBecause(kept)}, so none is chosen for them.` : ''),
    record,
    'research-candidates',
    candidatesShown(kept),
  );
}

export const researchCommand = defineCommand({
  meta: {
    name: 'research',
    description: 'Discover sources and build the working library.',
  },
  args: {
    queries: {
      type: 'string',
      description: 'Max number of disambiguation queries to issue (optional).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    const yolo = args.yolo === true;

    // Both prompts load first: one that drifted from its pinned hash stops the run here.
    loadPrompt('topic-disambiguator');
    loadPrompt('source-evaluator');

    const libraryPath = path.join(paperDir(), 'LIBRARY.json');
    const bibPath = path.join(paperDir(), 'CITATIONS.bib');
    const risPath = path.join(paperDir(), 'CITATIONS.ris');
    const root = process.cwd();
    const binding = { intake_sha256: intakeFingerprint(root) };

    // A list of candidates kept for the author's choice: take their answer,
    // ask at a terminal, or show the same list again. Nothing is searched or
    // screened again, so this needs neither the network nor a model key.
    // --yolo starts afresh.
    let finalCandidates: SourceCandidate[] | null = null;
    let candidates: SourceCandidate[] = [];
    const keptList = readGate(root, 'research-candidates');
    if (keptList && !yolo) {
      const kept = KeptCandidatesSchema.safeParse(keptList.payload);
      if (kept.success && gateStillApplies(keptList, binding)) {
        candidates = kept.data.candidates;
        if (!keptList.answer && !canAskInTerminal(process.stdout)) return showCandidates(keptList, kept.data);
        const keys = keptList.answer ? keptList.answer.options : await askCandidates(candidates, kept.data.evaluated);
        finalCandidates = candidatesNamed(candidates, keys);
      }
    }
    if (keptList) await closeGate(root, 'research-candidates');

    if (finalCandidates === null) {
      // Offline (--offline / --dry-run): searching is nothing but network
      // calls. Stop before the model and before any write, so an existing
      // library is never replaced by an empty one.
      if (isOfflineMode()) {
        process.stdout.write(
          `pensmith research: ${OFFLINE_SKIP_NOTE} — no sources were queried; LIBRARY.json and CITATIONS.bib left unchanged.\n`,
        );
        return { ok: false, mode: 'offline' };
      }

      // A key must be configured before any model work. PENSMITH_NO_LLM=1
      // answers from the offline mock inside complete(), so it needs none.
      // The key's value is never printed.
      if (process.env['PENSMITH_NO_LLM'] !== '1') {
        try {
          await getProviderApiKey(await resolveProviderId());
        } catch (e) {
          if (e instanceof MissingApiKeyError) {
            process.stderr.write(
              `pensmith research: ERROR — no LLM key configured.\n` +
              `Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation.\n` +
              `Run inside Claude Code (Tier 1) for key-free operation.\n`,
            );
            process.exitCode = 1;
            return { ok: false, mode: 'no-key-configured' };
          }
          throw e;
        }
      }

      // The topic, discipline and assignment intake kept.
      const intake = readIntake(root);
      if (!intake) {
        process.stderr.write(
          'pensmith research: WARN — no intake found in .paper/; continuing with no assignment context (run `pensmith new` first).\n',
        );
      }
      const { topic, discipline, assignment } = intake ?? { topic: '', discipline: 'other', assignment: '' };

      // ── The search scope: one kept for the author's choice, else the
      //    topic disambiguator's. ──
      let chosenScope: Scope | null = null;
      const keptScope = readGate(root, 'research-scope');
      if (keptScope && !yolo) {
        const kept = ScopesSchema.safeParse(keptScope.payload);
        if (kept.success && gateStillApplies(keptScope, binding)) {
          if (!keptScope.answer && !canAskInTerminal(process.stdout)) return showScopes(keptScope, kept.data.scopes);
          chosenScope = keptScope.answer ? scopeNamed(kept.data.scopes, keptScope.answer.options[0]) : await askScope(kept.data.scopes);
        }
      }
      if (keptScope) await closeGate(root, 'research-scope');

      if (chosenScope === null) {
        const scopes = await proposeScopes(topic, discipline, assignment);
        chosenScope = scopes[0]!;
        // ── Step 3: scope approval gate (default-ON): --yolo takes the first
        //    scope; a terminal asks; otherwise the scopes are kept for the
        //    author's choice (exit 3). ──
        if (scopes.length > 1 && !yolo) {
          if (!canAskInTerminal(process.stdout)) {
            const record = await openGate(root, {
              gate: 'research-scope',
              summary: 'Which search scope should research use?',
              options: scopes.map((sc) => sc.label),
              default: [scopes[0]!.label],
              binding,
              payload: { scopes },
              shown: { pending: 'research-scope', extra: { scopes } },
            });
            return showScopes(record, scopes);
          }
          chosenScope = await askScope(scopes);
        }
      }

      // ── Step 4: Live discovery — runResearchOrchestrator ──
      // When the source evaluator gives no usable answer, or keeps none,
      // nothing is chosen for the author: the gate shows every candidate with
      // none selected, and --yolo (which keeps what the evaluator kept) adds
      // nothing and leaves research not done.
      let evaluated = true;
      let keptNone = false;
      try {
        candidates = await runResearchOrchestrator(
          chosenScope.queries,
          {
            topic,
            discipline,
            assignment,
            scopeLabel: chosenScope.label,
          },
        );
      } catch (e) {
        if (!(e instanceof SourceEvaluationError)) throw e;
        candidates = e.candidates;
        evaluated = false;
        keptNone = e.keptNone;
        process.stderr.write(`pensmith research: WARN — ${e.message}; no candidate is kept unless you choose it.\n`);
      }

      if (!evaluated && yolo) {
        process.stderr.write(
          `pensmith research: --yolo keeps the candidates the source evaluator keeps, and ${keptNone ? 'it kept none' : 'it gave no usable answer'}, so nothing was added ` +
          `to LIBRARY.json and research is not marked done. Run \`pensmith research\` again, or without --yolo to choose ` +
          `from the ${candidates.length} candidates yourself.\n`,
        );
        process.exitCode = EXIT_REFUSED;
        return { ok: false, mode: 'evaluation-failed' };
      }

      // ── Step 5: Candidate approval gate (default-ON) ──
      // Zero candidates: nothing to choose. --yolo keeps what the evaluator
      // kept. A terminal asks; otherwise the candidates are kept for the
      // author's choice (exit 3).
      finalCandidates = candidates;
      if (candidates.length > 0 && !yolo) {
        if (!canAskInTerminal(process.stdout)) {
          const kept = { candidates, evaluated, ...(evaluated ? {} : { kept_none: keptNone }), scope: chosenScope.label };
          const because = noneChosenBecause(kept);
          const record = await openGate(root, {
            gate: 'research-candidates',
            summary: `Which of the ${candidates.length} candidate sources should the library keep?` +
              (because ? ` ${because}, so none is chosen for you.` : ''),
            options: candidates.map((c) => c.citekey),
            multiple: true,
            default: evaluated ? candidates.map((c) => c.citekey) : [],
            binding,
            payload: kept,
            shown: { pending: 'research-candidates', extra: candidatesShown(kept) },
          });
          return showCandidates(record, kept);
        }
        finalCandidates = candidatesNamed(candidates, await askCandidates(candidates, evaluated));
      }
    }

    if (finalCandidates.length === 0) {
      process.stderr.write(
        `pensmith research: WARN — 0 candidates remain after discovery ` +
        `(${candidates.length > 0 ? 'none chosen at the approval gate' : 'the searches found none'}); ` +
        `nothing added to LIBRARY.json.\n`,
      );
    }

    // The orchestrator marked each candidate its own record shows as
    // retracted; the library keeps the flag, and CITATIONS.bib carries it as
    // note = {RETRACTED}.
    // The run is recorded even when it found nothing: it is how the router
    // knows research is done (`pensmith add` writes the library too).
    const merged = await updateLibrary(process.cwd(), (lib, at) => {
      lib.researched_at = at;
      // The orchestrator already merged each work's records under the
      // discipline's source preference, so these are one candidate per work.
      return mergeCandidates(lib, finalCandidates, at);
    });
    const added = merged.works.filter((w) => w.status === 'added').length;

    process.stdout.write(
      `pensmith research: ${added} new, ${merged.works.length - added} already in the library; ` +
      `wrote ${libraryPath} and ${bibPath} / ${risPath}\n`,
    );
    return {
      ok: true,
      library: libraryPath,
      bib: bibPath,
      ris: risPath,
    };
  },
});

export default researchCommand;
