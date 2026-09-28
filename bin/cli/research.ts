// bin/cli/research.ts — `pensmith research` verb entrypoint (RSCH-01).
//
// Phase 12 (GEN-03): Live-adapter discovery wired. The swap-seam block from
// Phase 11 has been replaced with real source-discovery via research-orchestrator.
//
// What this verb does:
//   0. RUN-28: without a terminal and without --yolo the approval gates below
//      can never be answered — refuse up front (EXIT_APPROVAL), before any
//      model call, search or write.
//   1. Hash-pin both D-12 LOCKED slugs at startup.
//   2. GEN-06 fail-loud probe: assert LLM key configured (non-offline only);
//      an existing LIBRARY.json must load (RUN-12) — checked before any work.
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
//      CITATIONS.bib + CITATIONS.ris from it. .paper/RESEARCH.md is written only
//      after the candidate gate passed, so a refused research leaves no file.
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
import { loadPrompt } from '../lib/prompt-loader.js';
import { buildPromptRequest, requestHints } from '../lib/prompt-request.js';
import { upsertSources, assertLibraryReadable } from '../lib/library.js';
import { paperDir, projectRoot } from '../lib/paths.js';
import { crossCheckRetractions } from '../lib/sources/retraction-cross-check.js';
import { type SourceCandidate } from '../lib/schemas/source-candidate.js';
import { complete, assertLlmConfigured, StructuredOutputError } from '../lib/anthropic.js';
import type { TopicDisambiguation } from '../lib/llm-contracts.js';
import { runGate, canPrompt } from '../lib/gates.js';
import { parseIntakeMd } from '../lib/intake-parse.js';
import { discoverSources } from '../lib/research-orchestrator.js';

// ---------------------------------------------------------------------------
// Hash-pin enforcement (D-12 defense-in-depth).
// Keep void loadPrompt reference to prevent unused-import elision.
// The actual pin calls happen inside run() to catch drift before any network.
// ---------------------------------------------------------------------------
void loadPrompt; // reference kept to prevent unused-import elision

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

    // RUN-28: research asks two approval questions (scope, then the sources to
    // keep). Without a terminal and without --yolo neither can be answered, and
    // that is known NOW — so refuse before the disambiguator and evaluator calls
    // and the multi-adapter search, not after them (EXIT_APPROVAL, nothing sent,
    // nothing written).
    if (!yolo && !canPrompt()) {
      await runGate('research-prune', { yolo: false, detail: 'nothing was searched, sent or written' });
    }

    // Validate both D-12 LOCKED slugs at startup (hash-pin defense-in-depth).
    loadPrompt('topic-disambiguator');
    loadPrompt('source-evaluator');

    // GEN-06 / RUN-07 fail-loud probe: assert an LLM is configured before any LLM work.
    await assertLlmConfigured('research');

    // RUN-12: an existing LIBRARY.json that cannot be read is a one-line error
    // naming the file — found before any search or model call, not at the end.
    await assertLibraryReadable(projectRoot());

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
        `continuing with empty assignment context (run \`pensmith new\` first).\n`,
      );
    }
    const { topic, discipline, assignment } = parseIntakeMd(intakeText);

    // ── Step 2: topic-disambiguator complete() (D-12 LOCKED slug) ──
    // The template is the fixed system prompt (the cacheable prefix, RUN-26);
    // the brief's topic and discipline and the fenced assignment go once, last,
    // as data blocks (D-18-03/04) — never interpolated into the instructions,
    // so a `{{…}}` or a fence marker in INTAKE.md is inert data.
    const disambiguatorRequest = buildPromptRequest('topic-disambiguator', { topic, discipline, assignment });
    // topic-disambiguator is a STRUCTURED slug (RUN-25, T-12-01 trust boundary):
    // complete() returns {scopes:[{label, queries}]} validated against the
    // llm-contracts.ts schema (native structured output where the model has it,
    // else the tolerant parser plus one corrective retry).
    let scopes: Array<{ label: string; queries: string[] }>;
    try {
      const llmResult = await complete<TopicDisambiguation>({
        slug: 'topic-disambiguator',
        system: disambiguatorRequest.system,
        messages: disambiguatorRequest.messages,
        stubHint: requestHints(disambiguatorRequest),
      });
      scopes = (llmResult.data as TopicDisambiguation).scopes;
    } catch (e) {
      // ── Step 3: a reply that never matched the schema (after the corrective
      // retry) degrades to one scope built from the topic (T-11-10); provider,
      // cost-cap and configuration errors still propagate.
      if (!(e instanceof StructuredOutputError)) throw e;
      process.stderr.write(
        `pensmith research: WARN — ${e.message}; falling back to a single scope with the topic as the query.\n`,
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

    // ── Step 5: Live discovery (the research log is written after the gate) ──
    const discovery = await discoverSources(chosenScope.queries, {
      topic,
      discipline,
      assignment,
      scopeLabel: chosenScope.label,
      paperRoot: projectRoot(),
    });
    const candidates: SourceCandidate[] = discovery.candidates;

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

    // The gate passed: record the research log (.paper/RESEARCH.md, D-17-10).
    await discovery.writeLog(candidates);

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
