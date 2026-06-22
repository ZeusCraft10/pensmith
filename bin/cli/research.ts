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
//   5. Scope approval gate (default-ON): select one scope; --yolo → scope[0];
//      non-TTY → ApprovalUnavailableError / exit-3.
//   6. Call runResearchOrchestrator (adapter fan-out + dedup + source-evaluator).
//   7. Candidate approval gate (default-ON): multiselect prune; --yolo → keep all;
//      zero-candidates → skip gate; non-TTY → ApprovalUnavailableError / exit-3.
//   8. D-15 LOCKED: crossCheckRetractions BEFORE writeBibtex BEFORE writeRis BEFORE
//      LIBRARY.json write.
//
// D-12 LOCKED prompt slugs: 'topic-disambiguator' + 'source-evaluator'.
// D-15 LOCKED ordering: crossCheckRetractions BEFORE writeBibtex.
// D-19 LOCKED chokepoint: bib output goes through writeBibtex (citation-js).
// D-20 LOCKED chokepoint: canonical .bib path is `.paper/CITATIONS.bib`.
// T-11-10: malformed LLM JSON → WARN + fallback, never a crash.
// T-11-12: key value never logged here — complete() owns the no-leak header path.

import { defineCommand } from 'citty';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { writeBibtex } from '../lib/bibtex-write.js';
import { writeRis } from '../lib/ris-write.js';
import { paperDir } from '../lib/paths.js';
import { crossCheckRetractions } from '../lib/sources/retraction-cross-check.js';
import { type SourceCandidate } from '../lib/schemas/source-candidate.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { ask } from '../lib/prompts.js';
import { parseIntakeMd } from '../lib/intake-parse.js';
import { runResearchOrchestrator } from '../lib/research-orchestrator.js';

// ---------------------------------------------------------------------------
// Hash-pin enforcement (D-12 defense-in-depth).
// Keep void loadPrompt reference to prevent unused-import elision.
// The actual pin calls happen inside run() to catch drift before any network.
// ---------------------------------------------------------------------------
void loadPrompt; // reference kept to prevent unused-import elision

// ---------------------------------------------------------------------------
// ApprovalUnavailableError — mirrors outline.ts exactly (CLAUDE.md non-negotiable:
// approval gates default-on; non-TTY without --yolo → exit 3).
// ---------------------------------------------------------------------------
class ApprovalUnavailableError extends Error {
  exitCode = 3 as const;
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalUnavailableError';
  }
}

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

    const libraryPath = path.join(paperDir(), 'LIBRARY.json');
    const bibPath = path.join(paperDir(), 'CITATIONS.bib');
    const risPath = path.join(paperDir(), 'CITATIONS.ris');

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
    const topicDisambiguatorPrompt = loadPrompt('topic-disambiguator');
    const interpolatedPrompt = interpolate(topicDisambiguatorPrompt, {
      topic: topic || '(unknown topic — run pensmith intake first)',
      discipline: discipline,
      assignment: assignment || '(no assignment text — run pensmith intake first)',
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

    // ── Step 4: Scope approval gate (default-ON) ──
    // When scopes.length > 1 and not --yolo: ask() a kind:'select' over scope labels.
    // --yolo: auto-select scopes[0].
    // non-TTY: ApprovalUnavailableError → exit-3 (outline precedent).
    let chosenScope = scopes[0]!;
    if (scopes.length > 1 && !yolo) {
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        const err = new ApprovalUnavailableError(
          'research: scope selection requires an interactive terminal. ' +
          'Use --yolo to auto-select the first scope (CLAUDE.md non-negotiable: approval-gates default-on).',
        );
        process.stderr.write(`pensmith ${err.message}\n`);
        process.exitCode = err.exitCode;
        return { ok: false, mode: 'approval-unavailable' };
      }

      const answer = await ask({
        id: 'scope',
        kind: 'select',
        label: 'Which research scope should I use?',
        options: scopes.map((s) => ({
          value: s.label,
          label: s.label,
          hint: s.queries.slice(0, 2).join(', '),
        })),
        default: scopes[0]!.label,
      });

      const selected = scopes.find((s) => s.label === (answer as { value: string }).value);
      if (selected) chosenScope = selected;
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

    // ── Step 6: Candidate approval gate (default-ON) ──
    // Zero-candidate path: skip the gate (nothing to prune).
    // non-TTY and not --yolo: ApprovalUnavailableError → exit-3.
    let finalCandidates: SourceCandidate[] = candidates;
    if (candidates.length > 0 && !yolo) {
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        const err = new ApprovalUnavailableError(
          'research: candidate approval requires an interactive terminal. ' +
          'Use --yolo to auto-accept all candidates (CLAUDE.md non-negotiable: approval-gates default-on).',
        );
        process.stderr.write(`pensmith ${err.message}\n`);
        process.exitCode = err.exitCode;
        return { ok: false, mode: 'approval-unavailable' };
      }

      const pruneAnswer = await ask({
        id: 'candidates',
        kind: 'multiselect',
        label: `Select candidates to keep (${candidates.length} found):`,
        options: candidates.map((c) => ({
          value: c.citekey,
          label: `[${c.source}] ${c.title.slice(0, 60)}${c.title.length > 60 ? '…' : ''} (${c.year ?? '?'})`,
          hint: c.authors.slice(0, 2).join(', '),
        })),
        default: candidates.map((c) => c.citekey),
      });

      const keepKeys = new Set(
        Array.isArray((pruneAnswer as { value: unknown }).value)
          ? (pruneAnswer as { value: string[] }).value
          : candidates.map((c) => c.citekey),
      );
      finalCandidates = candidates.filter((c) => keepKeys.has(c.citekey));
    }

    if (finalCandidates.length === 0) {
      process.stderr.write(
        `pensmith research: WARN — 0 candidates remain after discovery ` +
        `(${candidates.length > 0 ? 'all pruned by approval gate' : 'no results from adapters'}); ` +
        `writing empty LIBRARY.json.\n`,
      );
    }

    // ── D-15 LOCKED ordering: crossCheckRetractions BEFORE writeBibtex ──
    // Marks any retracted candidates so writeBibtex persists retracted=true.
    await crossCheckRetractions(finalCandidates);

    // D-19 + D-20 LOCKED: writeBibtex is the SOLE citation-js writer.
    await writeBibtex(finalCandidates, bibPath);
    // CITE-05: emit CITATIONS.ris alongside CITATIONS.bib at the SAME call site.
    await writeRis(finalCandidates, risPath);

    // Write a real LIBRARY.json (no placeholder _note strings).
    // Content: { $schemaVersion: 1, entries: SourceCandidate[] }
    const libraryContent = JSON.stringify(
      { $schemaVersion: 1, entries: finalCandidates },
      null,
      2,
    );
    await atomicWriteFile(libraryPath, libraryContent);

    process.stdout.write(
      `pensmith research: wrote LIBRARY.json (${finalCandidates.length} candidate(s)) to ${libraryPath}` +
      ` and .bib/.ris to ${bibPath} / ${risPath}\n`,
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
