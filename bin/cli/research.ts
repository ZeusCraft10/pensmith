// bin/cli/research.ts — `pensmith research` verb entrypoint (RSCH-01).
//
// Phase 12 (GEN-03): Live-adapter discovery wired. The swap-seam block from
// Phase 11 has been replaced with real source-discovery via research-orchestrator.
//
// What this verb does:
//   1. Hash-pin both D-12 LOCKED slugs at startup.
//   2. GEN-06 fail-loud probe: assert LLM key configured (non-offline only).
//   3. Read INTAKE.md → parseIntakeMd → topic/discipline/assignment.
//   4. Call topic-disambiguator complete() → defensively parse scopes.
//   5. Scope approval gate (default-ON, `research-scope`): select one scope;
//      --yolo → scope[0]; no terminal → GateRefusedError / EXIT_APPROVAL.
//   6. Call runResearchOrchestrator (adapter fan-out + dedup + source-evaluator).
//   7. Candidate approval gate (default-ON, `research-prune`): multiselect prune;
//      --yolo → keep all; zero-candidates → skip gate; no terminal →
//      GateRefusedError / EXIT_APPROVAL.
//   8. D-15 LOCKED: crossCheckRetractions BEFORE the library write — upsertSources
//      (BRDTH-01, the one writer) merges into LIBRARY.json and renders
//      CITATIONS.bib + CITATIONS.ris from it.
//
// D-12 LOCKED prompt slugs: 'topic-disambiguator' + 'source-evaluator'.
// D-15 LOCKED ordering: crossCheckRetractions BEFORE upsertSources.
// D-19 LOCKED chokepoint: bib output is rendered by the library writer (citation-js).
// D-20 LOCKED chokepoint: canonical .bib path is `.paper/CITATIONS.bib`.
// T-11-10: malformed LLM JSON → WARN + fallback, never a crash.
// T-11-12: key value never logged here — complete() owns the no-leak header path.

import { defineCommand } from 'citty';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { upsertSources } from '../lib/library.js';
import { paperDir, projectRoot } from '../lib/paths.js';
import { crossCheckRetractions } from '../lib/sources/retraction-cross-check.js';
import { type SourceCandidate } from '../lib/schemas/source-candidate.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { runGate } from '../lib/gates.js';
import { parseIntakeMd, escapeTemplateTokens } from '../lib/intake-parse.js';
import { runResearchOrchestrator } from '../lib/research-orchestrator.js';

// ---------------------------------------------------------------------------
// Hash-pin enforcement (D-12 defense-in-depth).
// Keep void loadPrompt reference to prevent unused-import elision.
// The actual pin calls happen inside run() to catch drift before any network.
// ---------------------------------------------------------------------------
void loadPrompt; // reference kept to prevent unused-import elision

// ---------------------------------------------------------------------------
// Topic-disambiguator response schema (T-12-01 trust boundary).
// ---------------------------------------------------------------------------
const ScopeSchema = z.object({
  label: z.string().min(1),
  queries: z.array(z.string().min(1)).min(1),
});
const DisambiguatorResponseSchema = z.object({
  scopes: z.array(ScopeSchema).min(1),
});

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

    // Validate both D-12 LOCKED slugs at startup (hash-pin defense-in-depth).
    loadPrompt('topic-disambiguator');
    loadPrompt('source-evaluator');

    // GEN-06 fail-loud probe: assert a key is configured before doing any LLM work.
    // CRITICAL ordering (Pitfall 6): isNoLlmMode() inside complete() fires BEFORE
    // getProviderApiKey. When PENSMITH_NO_LLM=1 is set, complete() short-circuits to
    // the offline mock — MissingApiKeyError is never thrown. The probe here is ONLY
    // for the non-offline case: if no key and no offline mode, we fail loud.
    // NEVER log the resolved key value — T-11-12 / T-01-07.
    const noLlm = process.env['PENSMITH_NO_LLM'] === '1';
    if (!noLlm) {
      try {
        // CR-01: resolve provider ID dynamically so OpenAI-only configs don't
        // false-positive with "no config for 'anthropic'". resolveProviderId()
        // is the single source of truth (shared with complete()).
        const providerId = await resolveProviderId();
        await getProviderApiKey(providerId);
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

    // ── Step 1: Read INTAKE.md and parse → topic/discipline/assignment ──
    // D-07: read via readFileSync; WARN + empty string if absent.
    const intakePath = path.join(paperDir(), 'INTAKE.md');
    let intakeText = '';
    if (existsSync(intakePath)) {
      try {
        intakeText = readFileSync(intakePath, 'utf8');
      } catch (err) {
        process.stderr.write(
          `pensmith research: WARN — could not read INTAKE.md (${String(err)}); ` +
          `continuing with empty assignment context.\n`,
        );
      }
    } else {
      process.stderr.write(
        `pensmith research: WARN — INTAKE.md not found at ${intakePath}; ` +
        `continuing with empty assignment context (run \`pensmith intake\` first).\n`,
      );
    }
    const { topic, discipline, assignment } = parseIntakeMd(intakeText);

    // ── Step 2: topic-disambiguator complete() (D-12 LOCKED slug) ──
    // CR-01: sanitize user-controlled strings before interpolation so that
    // {{...}} tokens in INTAKE.md cannot cause secondary template expansion.
    const topicDisambiguatorPrompt = loadPrompt('topic-disambiguator');
    const interpolatedPrompt = interpolate(topicDisambiguatorPrompt, {
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
      scope: 'task',
      scopeId: 'research',
    });

    // ── Step 3: Defensively parse topic-disambiguator response (T-12-01) ──
    // On any parse failure: WARN + fall back to a single auto scope.
    let scopes: Array<{ label: string; queries: string[] }>;
    try {
      const rawParsed: unknown = JSON.parse(llmResult.text);
      const zodResult = DisambiguatorResponseSchema.safeParse(rawParsed);
      if (zodResult.success) {
        scopes = zodResult.data.scopes;
      } else {
        process.stderr.write(
          `pensmith research: WARN — topic-disambiguator response failed schema validation ` +
          `(${zodResult.error.message.slice(0, 120)}); ` +
          `falling back to single-scope with topic as query.\n`,
        );
        scopes = [{ label: 'auto', queries: [topic || 'research'] }];
      }
    } catch {
      process.stderr.write(
        `pensmith research: WARN — topic-disambiguator response is not valid JSON; ` +
        `falling back to single-scope with topic as query.\n`,
      );
      scopes = [{ label: 'auto', queries: [topic || 'research'] }];
    }

    // ── Step 4: Scope approval gate (default-ON) — `research-scope` (RUN-28) ──
    // When scopes.length > 1: a select over the scope labels.
    // --yolo: the registry's choice (the first proposed scope).
    // No terminal and no --yolo: GateRefusedError → EXIT_APPROVAL, nothing written.
    let chosenScope = scopes[0]!;
    if (scopes.length > 1) {
      const outcome = await runGate('research-scope', {
        yolo,
        detail: `${scopes.length} scopes proposed; nothing was searched or written`,
        question: {
          id: 'research-scope',
          kind: 'select',
          label: 'Which research scope should I use?',
          options: scopes.map((s) => ({
            value: s.label,
            label: s.label,
            hint: s.queries.slice(0, 2).join(', '),
          })),
          default: scopes[0]!.label,
        },
      });
      const answerValue = outcome.kind === 'answered' && outcome.answer.kind === 'select'
        ? outcome.answer.value
        : scopes[0]!.label;
      const selected = scopes.find((s) => s.label === answerValue);
      if (selected) {
        chosenScope = selected;
      } else {
        // WR-01: the gate answer did not match any scope label.
        // Emit a WARN rather than silently falling through to the pre-gate default.
        process.stderr.write(
          `pensmith research: WARN — scope selection returned unrecognised value ` +
          `"${answerValue}"; falling back to first scope "${scopes[0]!.label}".\n`,
        );
        // chosenScope is already scopes[0] — no assignment needed.
      }
    }

    // ── Step 5: Live discovery — runResearchOrchestrator ──
    const candidates: SourceCandidate[] = await runResearchOrchestrator(
      chosenScope.queries,
      {
        topic,
        discipline,
        assignment,
        scopeLabel: chosenScope.label,
      },
    );

    // ── Step 6: Candidate approval gate (default-ON) — `research-prune` (RUN-28) ──
    // Zero-candidate path: skip the gate (nothing to prune).
    // --yolo: the registry's choice (keep every candidate).
    // No terminal and no --yolo: GateRefusedError → EXIT_APPROVAL, nothing written.
    let finalCandidates: SourceCandidate[] = candidates;
    if (candidates.length > 0) {
      const outcome = await runGate('research-prune', {
        yolo,
        detail: `${candidates.length} candidates found; no library was written`,
        question: {
          id: 'research-prune',
          kind: 'multiselect',
          label: `Select candidates to keep (${candidates.length} found):`,
          options: candidates.map((c) => ({
            value: c.citekey,
            label: `[${c.source}] ${c.title.slice(0, 60)}${c.title.length > 60 ? '…' : ''} (${c.year ?? '?'})`,
            hint: c.authors.slice(0, 2).join(', '),
          })),
          default: candidates.map((c) => c.citekey),
        },
      });
      if (outcome.kind === 'answered' && outcome.answer.kind === 'multiselect') {
        const keepKeys = new Set(outcome.answer.value);
        finalCandidates = candidates.filter((c) => keepKeys.has(c.citekey));
      }
    }

    if (finalCandidates.length === 0) {
      process.stderr.write(
        `pensmith research: WARN — 0 candidates remain after discovery ` +
        `(${candidates.length > 0 ? 'all pruned by approval gate' : 'no results from adapters'}); ` +
        `the library gains no new source.\n`,
      );
    }

    // ── Step 7: D-15 LOCKED ordering — crossCheckRetractions BEFORE the library write ──
    // Marks any retracted candidates so the library (and the CITATIONS.bib it
    // renders) persists retracted=true.
    await crossCheckRetractions(finalCandidates);

    // BRDTH-01 / D-17-43: the ONE library writer. upsertSources dedups against
    // the existing LIBRARY.json (DOI, then arXiv/PMID/ISBN, then the
    // preprint ↔ version-of-record rule), merges, and renders CITATIONS.bib (D-19
    // citation-js chokepoint, D-20 canonical path) and CITATIONS.ris (CITE-05)
    // from the validated LIBRARY.json — so a re-run never duplicates a source and
    // paper://library always parses.
    const upsert = await upsertSources(projectRoot(), finalCandidates, { provenance: 'research' });
    const added = upsert.outcomes.filter((o) => o.status === 'added').length;
    const known = upsert.outcomes.length - added;

    process.stdout.write(
      `pensmith research: wrote LIBRARY.json (${upsert.library.entries.length} source(s); ${added} new` +
      `${known > 0 ? `, ${known} already in library` : ''}) to ${upsert.paths.library}` +
      ` and .bib/.ris to ${upsert.paths.bib} / ${upsert.paths.ris}\n`,
    );
    return {
      ok: true,
      library: upsert.paths.library,
      bib: upsert.paths.bib,
      ris: upsert.paths.ris,
    };
  },
});

export default researchCommand;
