// bin/cli/research.ts — `pensmith research` verb entrypoint (RSCH-01).
//
// Phase 11 (GEN-02 / GEN-06): Wired to the Tier-2 LLM transport.
//   - The placeholder library constant (the old Tier-2 shim) is gone.
//   - A fail-loud probe fires at the top of run(): MissingApiKeyError →
//     stderr banner + exitCode=1 + ok:false. Never ok:true on missing key.
//   - complete() is called with the 'topic-disambiguator' prompt (D-12 LOCKED).
//   - The model response is DEFENSIVELY PARSED into SourceCandidate[] via
//     SourceCandidateSchema.safeParse (T-11-10 trust boundary). On any parse
//     failure: WARN to stderr + fall back to candidates=[] (not a crash, not a
//     placeholder with _note — Open Question 2 resolution).
//   - The EXISTING chokepoints are preserved in LOCKED order:
//       crossCheckRetractions(candidates)  ← D-15 BEFORE writeBibtex
//       writeBibtex(candidates, bibPath)   ← D-19 / D-20
//       writeRis(candidates, risPath)
//   - LIBRARY.json is written as real content (no placeholder _note strings).
//
// SCOPE FENCE (CRITICAL — Phase 11 / GEN-02 only):
//   The FULL live-adapter candidate discovery + dedup + retraction cross-check
//   that POPULATES LIBRARY.json from real adapters (crossref, openalex, arxiv,
//   pubmed, semanticscholar, unpaywall, retraction-watch) is GEN-03 / Phase 12.
//   Do NOT build it here. Phase 11 research wires the transport and removes the
//   silent placeholder path. The defensive parse function below is the Phase-12
//   / GEN-03 swap seam — Phase 12 replaces it with live-adapter discovery.
//
// D-12 LOCKED prompt slugs: 'topic-disambiguator' + 'source-evaluator'.
// D-15 LOCKED ordering: crossCheckRetractions BEFORE writeBibtex.
// D-19 LOCKED chokepoint: bib output goes through writeBibtex (citation-js).
// D-20 LOCKED chokepoint: canonical .bib path is `.paper/CITATIONS.bib`.
// T-11-10: malformed LLM JSON → WARN + empty candidates, never a crash.
// T-11-12: key value never logged here — complete() owns the no-leak header path.

import { defineCommand } from 'citty';
import path from 'node:path';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { writeBibtex } from '../lib/bibtex-write.js';
import { writeRis } from '../lib/ris-write.js';
import { paperDir } from '../lib/paths.js';
import { crossCheckRetractions } from '../lib/sources/retraction-cross-check.js';
import { SourceCandidateSchema, type SourceCandidate } from '../lib/schemas/source-candidate.js';
import { complete, MissingApiKeyError } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';

// ---------------------------------------------------------------------------
// Hash-pin enforcement (D-12 defense-in-depth).
// Load both slugs eagerly at module-load time so any on-disk hash drift
// surfaces IMMEDIATELY (before run() is invoked), mirroring the intent of
// the original research.ts comment. The body values are unused here —
// this is a side-effect-only call for the hash validation.
// ---------------------------------------------------------------------------
// Note: Both slugs are still pinned in EXPECTED_PROMPT_HASHES (prompt-loader.ts).
// 'topic-disambiguator' is the Phase-11 call slug; 'source-evaluator' is Phase-12.
// We load both eagerly so drift in EITHER slug surfaces at startup.

// Defer the eager load until module is first imported (dynamic — avoids blocking
// the import graph during testing). The hash check still fires on first use.
// (The original code used `void loadPrompt` — we keep the same guard approach.)
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
  async run() {
    // Validate both D-12 LOCKED slugs at startup (hash-pin defense-in-depth).
    // Calling loadPrompt here catches any on-disk drift before we make any
    // network call or write any artifact. 'source-evaluator' is Phase-12 runtime;
    // we pin it now so drift surfaces before the phase lands.
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
        await getProviderApiKey('anthropic');
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

    // Call complete() with the 'topic-disambiguator' prompt (D-12 LOCKED slug).
    // Phase 12 / GEN-03 will wire topic + discipline + assignment from INTAKE.md.
    // For now (Phase 11 scope fence) we supply placeholder values; the offline
    // mock (PENSMITH_NO_LLM=1) returns a deterministic string that the defensive
    // parse below will fail to parse as JSON — yielding candidates=[] with a WARN.
    const topicDisambiguatorPrompt = loadPrompt('topic-disambiguator');
    // Phase 12 / GEN-03 will extract these vars from INTAKE.md / OUTLINE.md.
    const interpolatedPrompt = interpolate(topicDisambiguatorPrompt, {
      topic: '(topic from INTAKE.md — wire via Phase 12 / GEN-03)',
      discipline: 'other',
      assignment: '(assignment text from INTAKE.md — wire via Phase 12 / GEN-03)',
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

    // -------------------------------------------------------------------------
    // Phase-12 / GEN-03 swap seam — REPLACE THIS ENTIRE BLOCK in Phase 12.
    //
    // Phase 11 scope: parse the model response defensively into SourceCandidate[].
    // Phase 12 / GEN-03: replace this with live-adapter discovery + dedup +
    // retraction cross-check using the scopes/queries from the disambiguator response.
    // The live adapters (crossref, openalex, arxiv, pubmed, semanticscholar,
    // unpaywall, retraction-watch) will populate a real SourceCandidate[] from
    // network calls; this parse-from-LLM block is a temporary Phase-11 shim.
    //
    // T-11-10 trust boundary: the model's JSON is UNTRUSTED input. We use
    // SourceCandidateSchema.safeParse per element so a malformed or hostile
    // LLM response never injects an unvalidated entry into LIBRARY.json.
    // -------------------------------------------------------------------------
    let candidates: SourceCandidate[] = [];
    try {
      // Attempt to parse the LLM response as a JSON array of SourceCandidate objects.
      // The topic-disambiguator prompt returns scopes/queries, not candidates —
      // so this will normally fail and fall back to candidates=[] with a WARN.
      // Phase 12 / GEN-03 replaces this block with live adapter discovery that
      // actually populates candidates from network calls.
      const raw: unknown = JSON.parse(llmResult.text);
      if (!Array.isArray(raw)) {
        process.stderr.write(
          `pensmith research: WARN — model response is not a JSON array; ` +
          `falling back to empty candidates. Phase 12 / GEN-03 will wire live discovery.\n`,
        );
        candidates = [];
      } else {
        const validated: SourceCandidate[] = [];
        for (const item of raw) {
          const parsed = SourceCandidateSchema.safeParse(item);
          if (parsed.success) {
            validated.push(parsed.data);
          }
          // Silently skip invalid elements — T-11-10 boundary enforcer.
        }
        if (validated.length < raw.length) {
          process.stderr.write(
            `pensmith research: WARN — ${raw.length - validated.length} of ${raw.length} ` +
            `candidate(s) failed schema validation and were dropped. ` +
            `Phase 12 / GEN-03 will wire live adapter discovery.\n`,
          );
        }
        candidates = validated;
      }
    } catch {
      // JSON.parse threw — the model response was not valid JSON.
      // This is expected during Phase 11 (topic-disambiguator returns scopes/queries,
      // not SourceCandidate arrays). Emit a WARN and continue with empty candidates.
      // Phase 12 / GEN-03 replaces this entire block with live adapter discovery.
      process.stderr.write(
        `pensmith research: WARN — model response could not be parsed as JSON ` +
        `(expected in Phase 11; Phase 12 / GEN-03 will wire live adapter discovery). ` +
        `Continuing with empty candidates.\n`,
      );
      candidates = [];
    }
    // ---- end Phase-12 / GEN-03 swap seam ----

    // D-15 LOCKED ordering: crossCheckRetractions MUST run BEFORE writeBibtex.
    // Marks any retracted candidates so writeBibtex persists retracted=true.
    await crossCheckRetractions(candidates);

    // D-19 + D-20 LOCKED: writeBibtex is the SOLE citation-js writer.
    await writeBibtex(candidates, bibPath);
    // CITE-05: emit CITATIONS.ris alongside CITATIONS.bib at the SAME call site.
    await writeRis(candidates, risPath);

    // Write a real LIBRARY.json (no placeholder _note strings).
    // Content: { $schemaVersion: 1, entries: SourceCandidate[] }
    const libraryContent = JSON.stringify(
      { $schemaVersion: 1, entries: candidates },
      null,
      2,
    );
    await atomicWriteFile(libraryPath, libraryContent);

    process.stdout.write(
      `pensmith research: wrote LIBRARY.json (${candidates.length} candidate(s)) to ${libraryPath}` +
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
