// bin/lib/revise.ts — single revise chokepoint (WRTE-02, D-06).
//
// BOTH tiers (Tier 1 MCP and Tier 2 CLI) delegate 100% to this module.
// There is NO divergent code path per D-06.
//
// Flow (04-RESEARCH §I):
//   1. Parse sections/<N>/VERIFICATION.md for the FIRST failing citation
//      (FABRICATED / MIS-CITED / NOT_FOUND), in appearance order.
//   2. Load PLAN.md frontmatter → assigned_sources + voice hint (WRTE-02 consume).
//   3. Call LLM via loadPrompt('revise-swap') + interpolate(); parse strict-JSON via zod.
//      Reject if action ∉ {swap,remove} OR replacement_citekey ∉ assigned_sources.
//   4. Approval gate (default-on). Skip when yolo=true. Non-TTY without yolo → exit 3.
//   5. On accept: patch DRAFT.md (atomic), reset verified_against_draft_hash → null.
//      On reject: no-op, return accepted=false.
//   6. --yolo auto-loop: retry up to 2 times on validation failure; on exhaustion write
//      RETRY_EXHAUSTED to VERIFICATION.md (D-06).
//   7. --research: append to .paper/RESEARCH.md + per-section RESEARCH-LOG.md. (D-09)
//
// Security (T-04-14): strict zod; membership check on replacement_citekey.
// Security (T-04-15): approval gate default-on; only --yolo skips.
// Security (T-04-16): retry cap = 2.
// Security (T-04-17): --research writes ONLY project RESEARCH.md + section RESEARCH-LOG.md.
// Security (T-04-18): revise-swap.md hash-pinned; loadPrompt re-validates at runtime.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { loadPrompt, interpolate } from './prompt-loader.js';
import { atomicWriteFile, atomicAppendFile } from './atomic-write.js';
import { replaceCitekeys } from './citation-token.js';
import { parseFrontmatter, updateFrontmatter } from './frontmatter.js';
import { withLock } from './lock.js';
import { sectionPlan, sectionDraft, sectionVerification, paperDir } from './paths.js';

// ---------------------------------------------------------------------------
// Zod schema for the strict-JSON LLM response (T-04-14)
// ---------------------------------------------------------------------------
const ReviseSwapResponseSchema = z.object({
  action: z.enum(['swap', 'remove']),
  flagged_citekey: z.string().min(1),
  replacement_citekey: z.string().nullable(),
  rationale: z.string().min(1),
  patch: z.object({
    before_excerpt: z.string().min(1),
    after_excerpt: z.string(),
  }),
});
type ReviseSwapResponse = z.infer<typeof ReviseSwapResponseSchema>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReviseOptions {
  paperRoot: string;
  n: number;
  slug: string;
  yolo: boolean;
  research?: string;
  // ---------------------------------------------------------------------------
  // Test-only injection points (prefixed with _ to mark non-production use)
  // ---------------------------------------------------------------------------
  /** Override the LLM response with a literal JSON string (for cassette testing). */
  _llmResponseOverride?: string;
  /** Force the approval gate to reject (for rejection test). */
  _forceReject?: boolean;
  /** Max retries under --yolo (defaults to 2 per D-06). */
  _maxRetries?: number;
  /** Skip the citation-swap step; only run --research. */
  _skipLlmRevise?: boolean;
  /** Throw on invalid LLM response (membership/schema) instead of writing RETRY_EXHAUSTED. */
  _throwOnInvalidResponse?: boolean;
}

export interface ReviseResult {
  accepted: boolean;
  status: 'accepted' | 'rejected' | 'retry_exhausted' | 'no_failures' | 'research_only';
  patchedCitekey?: string;
  replacementCitekey?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the FIRST failing citekey from VERIFICATION.md (FABRICATED/MIS-CITED/NOT_FOUND). */
function parseFirstFailure(verifText: string): { citekey: string; verdict: string; reason: string } | null {
  // Match lines like: `- citekey: **FABRICATED** — ...reason...`
  // or `- citekey: **MIS-CITED** — ...` or `- citekey: **NOT_FOUND** — ...`
  const lineRe = /^- ([a-z][a-z0-9_-]*): \*\*(FABRICATED|MIS-CITED|NOT_FOUND)\*\* — (.+)$/m;
  const m = lineRe.exec(verifText);
  if (!m) return null;
  return { citekey: m[1] ?? '', verdict: m[2] ?? '', reason: m[3] ?? '' };
}

/** Extract voice hint from the PLAN.md body (after the frontmatter). */
function extractVoiceHint(planText: string): string {
  const { body } = parseFrontmatter(planText);
  // Look for a "Voice: ..." line in the brief
  const voiceMatch = /^Voice:\s*(.+)$/m.exec(body);
  return voiceMatch ? (voiceMatch[1] ?? '') : '';
}

/**
 * Apply REMOVE action to DRAFT.md content.
 *
 * Handles three cases (REVIEW LOW — OpenCode L-03):
 *   (a) Compound bracket [@a; @b] — remove only the targeted key, preserve others.
 *   (b) Sole key [@a] — strip the entire [...] clause (and normalize surrounding spaces).
 *   (c) Citekey appears multiple times — disambiguate by matching patch.before_excerpt.
 */
export function applyRemoveAction(
  draft: string,
  flaggedKey: string,
  patch: { before_excerpt: string; after_excerpt: string },
): string {
  // Strategy: locate the correct occurrence using before_excerpt, then apply the surgery.
  const beforeExcerpt = patch.before_excerpt;
  const afterExcerpt = patch.after_excerpt;

  // If before_excerpt is present and differs from after_excerpt, we can anchor the edit.
  // Use a broader search that strips [@...] tokens from the excerpt for loose-matching.
  const excerptPresent = beforeExcerpt.length > 0 && beforeExcerpt !== afterExcerpt;

  if (excerptPresent) {
    // Try exact match
    if (draft.includes(beforeExcerpt)) {
      return draft.replace(beforeExcerpt, afterExcerpt);
    }
    // Try after stripping leading/trailing `...` (LLM convention)
    const beforeNorm = normalizeExcerpt(beforeExcerpt);
    const afterNorm = normalizeExcerpt(afterExcerpt);
    if (beforeNorm.length > 0 && beforeNorm !== afterNorm && draft.includes(beforeNorm)) {
      return draft.replace(beforeNorm, afterNorm);
    }
  }

  // Fallback: apply the surgery on the first occurrence of the flagged token in any bracket.
  // Handle compound brackets: [@a; @b] containing flaggedKey
  // Pattern: [...] clause containing the key
  const compoundRe = new RegExp(`\\[([^\\]]*@${escapeRegex(flaggedKey)}[^\\]]*)\\]`, 'g');

  let applied = false;
  const result = draft.replace(compoundRe, (match, inner: string) => {
    if (applied) return match; // only first occurrence

    // Remove the targeted citekey from the compound expression
    const tokens = inner
      .split(/;\s*/)
      .map((t) => t.trim())
      .filter((t) => t !== `@${flaggedKey}` && t.length > 0);

    applied = true;

    if (tokens.length === 0) {
      // Sole key → strip the entire [...] clause and normalize surrounding whitespace
      // Return empty string; we'll clean up extra spaces after
      return '';
    } else {
      // Compound → preserve remaining tokens
      return `[${tokens.join('; ')}]`;
    }
  });

  // Clean up doubled spaces left by stripping a sole [@key] mid-sentence
  return result.replace(/  +/g, ' ').replace(/ ([,;.!?])/g, '$1');
}

/**
 * Strip leading/trailing `...` from an excerpt (LLMs often add them to indicate context).
 */
function normalizeExcerpt(s: string): string {
  return s.replace(/^\.\.\./, '').replace(/\.\.\.$/, '').trim();
}

/** Apply SWAP action to DRAFT.md content using replaceCitekeys. */
function applySwapAction(
  draft: string,
  flaggedKey: string,
  replacementKey: string,
  patch: { before_excerpt: string; after_excerpt: string },
): string {
  const beforeRaw = patch.before_excerpt;
  const afterRaw = patch.after_excerpt;

  // Try exact match first
  if (beforeRaw.length > 0 && beforeRaw !== afterRaw && draft.includes(beforeRaw)) {
    return draft.replace(beforeRaw, afterRaw);
  }

  // Try after stripping leading/trailing `...` (LLM convention)
  const beforeNorm = normalizeExcerpt(beforeRaw);
  const afterNorm = normalizeExcerpt(afterRaw);
  if (beforeNorm.length > 0 && beforeNorm !== afterNorm && draft.includes(beforeNorm)) {
    return draft.replace(beforeNorm, afterNorm);
  }

  // Fallback: use replaceCitekeys (from Plan 01 citation-token.ts) for the first occurrence.
  let replaced = false;
  return replaceCitekeys(draft, (key) => {
    if (!replaced && key === flaggedKey) {
      replaced = true;
      return replacementKey;
    }
    return key;
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Validate that the LLM response has a valid replacement_citekey (T-04-14). */
function validateResponse(
  resp: ReviseSwapResponse,
  assignedSources: string[],
): { ok: true } | { ok: false; reason: string } {
  if (resp.action === 'swap') {
    if (resp.replacement_citekey === null || resp.replacement_citekey === '') {
      return { ok: false, reason: 'action=swap but replacement_citekey is null/empty' };
    }
    if (!assignedSources.includes(resp.replacement_citekey)) {
      return {
        ok: false,
        reason: `replacement_citekey "${resp.replacement_citekey}" not in assigned_sources (invalid replacement — T-04-14)`,
      };
    }
  }
  if (resp.action === 'remove' && resp.replacement_citekey !== null) {
    // Soft: silently null it out — remove action should not have a replacement
    resp.replacement_citekey = null;
  }
  return { ok: true };
}

/**
 * Parse the LLM response JSON (sentinel path or real LLM call).
 * In test mode, _llmResponseOverride bypasses the real HTTP call.
 */
async function callLlm(promptBody: string, override?: string): Promise<string> {
  if (override !== undefined) {
    return override;
  }
  // Real LLM call via PENSMITH_NO_LLM stub (same pattern as write.ts)
  if (process.env['PENSMITH_NO_LLM'] === '1') {
    // Return a stub response that immediately triggers no-failure
    return JSON.stringify({
      action: 'remove',
      flagged_citekey: '__stub__',
      replacement_citekey: null,
      rationale: 'PENSMITH_NO_LLM stub — no real LLM call made.',
      patch: { before_excerpt: '', after_excerpt: '' },
    });
  }
  // Production: in a real Phase 4 deployment, this would call the LLM via the
  // configured provider. For now the test path always uses _llmResponseOverride.
  // The prompt body is already interpolated at this point.
  void promptBody;
  throw new Error('runRevise: real LLM call not yet wired (use _llmResponseOverride in tests or PENSMITH_NO_LLM=1)');
}

// ---------------------------------------------------------------------------
// --research helper (D-09 / T-04-17)
// ---------------------------------------------------------------------------

async function runResearch(
  paperRoot: string,
  n: number,
  slug: string,
  query: string,
): Promise<void> {
  const padded = String(n).padStart(2, '0');
  const secDir = join(paperDir(paperRoot), 'sections', `${padded}-${slug}`);
  const projectResearchPath = join(paperDir(paperRoot), 'RESEARCH.md');
  const researchLogPath = join(secDir, 'RESEARCH-LOG.md');

  const timestamp = new Date().toISOString();
  const entry = `\n## Research: "${query}" (section ${n}, ${timestamp})\n\nQuery: ${query}\nAdapter: manual\nHit count: 0\nCitekeys added: none\n`;

  // D-09: append to PROJECT RESEARCH.md only (atomicAppendFile)
  await atomicAppendFile(projectResearchPath, entry);

  // D-09: append provenance row to sections/<N>/RESEARCH-LOG.md
  await atomicAppendFile(researchLogPath, entry);

  // TOUCH NO OTHER section's files (T-04-17 / D-09 isolation)
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function runRevise(opts: ReviseOptions): Promise<ReviseResult> {
  const {
    paperRoot,
    n,
    slug,
    yolo,
    research,
    _llmResponseOverride,
    _forceReject = false,
    _maxRetries = 2,
    _skipLlmRevise = false,
    _throwOnInvalidResponse = false,
  } = opts;

  // --research path (D-09 — may run independently of the citation swap)
  if (research) {
    await runResearch(paperRoot, n, slug, research);
    if (_skipLlmRevise) {
      return { accepted: false, status: 'research_only' };
    }
  }

  const verifPath = sectionVerification(n, slug, paperRoot);
  const planPath = sectionPlan(n, slug, paperRoot);
  const draftPath = sectionDraft(n, slug, paperRoot);

  // 1. Parse VERIFICATION.md for the first failing citation
  if (!existsSync(verifPath)) {
    return { accepted: false, status: 'no_failures' };
  }
  const verifText = readFileSync(verifPath, 'utf8');
  const failure = parseFirstFailure(verifText);
  if (!failure) {
    return { accepted: false, status: 'no_failures' };
  }

  // 2. Load PLAN.md frontmatter → assigned_sources + voice hint (WRTE-02 consume point)
  const planText = readFileSync(planPath, 'utf8');
  const { frontmatter } = parseFrontmatter(planText);
  const assignedSources = Array.isArray(frontmatter['assigned_sources'])
    ? (frontmatter['assigned_sources'] as string[])
    : [];
  const voiceHint = extractVoiceHint(planText);

  // 3. Build available_sources display string
  const availableSourcesText = assignedSources
    .map((key) => `- [@${key}]`)
    .join('\n');

  // 4. Load and interpolate the prompt
  const promptBody = (() => {
    try {
      const body = loadPrompt('revise-swap');
      return interpolate(body, {
        flagged_citekey: failure.citekey,
        claim_context: `(See DRAFT.md for the full context around [@${failure.citekey}])`,
        verifier_reason: `${failure.verdict}: ${failure.reason}`,
        voice_hint: voiceHint || '(no voice hint in PLAN.md)',
        available_sources: availableSourcesText || '(no assigned sources)',
      });
    } catch (e) {
      // Sentinel bypass in test mode (PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1)
      if (_llmResponseOverride !== undefined) return '(prompt bypassed in test mode)';
      throw e;
    }
  })();

  const maxRetries = _maxRetries ?? 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    // 5. Call LLM
    let rawResponse: string;
    try {
      rawResponse = await callLlm(promptBody, _llmResponseOverride);
    } catch (e) {
      if (_throwOnInvalidResponse) throw e;
      // On LLM failure with --yolo, count as one retry
      attempt++;
      continue;
    }

    // 6. Parse and validate strict-JSON response
    let parsed: ReviseSwapResponse;
    try {
      const json = JSON.parse(rawResponse) as unknown;
      parsed = ReviseSwapResponseSchema.parse(json);
    } catch (e) {
      if (_throwOnInvalidResponse) {
        throw new Error(`runRevise: invalid LLM response: ${String(e)}`);
      }
      if (yolo) {
        attempt++;
        if (attempt > maxRetries) break;
        continue;
      }
      // Non-yolo: surface error
      throw new Error(`runRevise: LLM response failed strict-JSON parse: ${String(e)}`);
    }

    // Security validation: replacement_citekey membership (T-04-14)
    const validation = validateResponse(parsed, assignedSources);
    if (!validation.ok) {
      if (_throwOnInvalidResponse) {
        throw new Error(`runRevise: ${validation.reason}`);
      }
      if (yolo) {
        attempt++;
        if (attempt > maxRetries) break;
        continue;
      }
      throw new Error(`runRevise: ${validation.reason}`);
    }

    // 7. Approval gate (T-04-15 — default-on; only --yolo skips)
    let userAccepted: boolean;
    if (yolo) {
      userAccepted = true;
    } else if (_forceReject) {
      // Test-only: simulate user pressing "reject"
      userAccepted = false;
    } else {
      // Production: show diff via @clack/prompts
      // Non-TTY without --yolo → exit code 3 (T-04-15)
      if (!process.stdout.isTTY) {
        process.stderr.write(
          `pensmith revise: non-TTY terminal; use --yolo to auto-accept the proposed swap.\n`,
        );
        process.exitCode = 3;
        return { accepted: false, status: 'rejected' };
      }

      // TTY: show the diff and prompt
      try {
        const { confirm } = await import('@clack/prompts');
        process.stdout.write(
          `\nRevise-swap proposal:\n` +
          `  Before: ${parsed.patch.before_excerpt}\n` +
          `  After:  ${parsed.patch.after_excerpt}\n` +
          `  Rationale: ${parsed.rationale}\n\n`,
        );
        const answer = await confirm({ message: 'Accept this swap?' });
        userAccepted = answer === true;
      } catch {
        // @clack/prompts not available: degrade to TTY prompt (fallback)
        userAccepted = false;
      }
    }

    if (!userAccepted) {
      return { accepted: false, status: 'rejected' };
    }

    // 8. Apply the accepted patch to DRAFT.md
    const draftContent = readFileSync(draftPath, 'utf8');
    let patchedDraft: string;

    if (parsed.action === 'remove') {
      patchedDraft = applyRemoveAction(draftContent, parsed.flagged_citekey, parsed.patch);
    } else {
      // action = 'swap'
      patchedDraft = applySwapAction(
        draftContent,
        parsed.flagged_citekey,
        parsed.replacement_citekey ?? '',
        parsed.patch,
      );
    }

    // 9. Atomic write to DRAFT.md (D-07 chokepoint)
    await atomicWriteFile(draftPath, patchedDraft);

    // 10. Reset verified_against_draft_hash → null (D-05) via updateFrontmatter under withLock
    const planLockResource = planPath;
    await withLock(planLockResource, async () => {
      const freshPlanText = readFileSync(planPath, 'utf8');
      const updatedPlan = updateFrontmatter(freshPlanText, (fm) => {
        fm['verified_against_draft_hash'] = null;
      });
      await atomicWriteFile(planPath, updatedPlan);
    });

    return {
      accepted: true,
      status: 'accepted',
      patchedCitekey: parsed.flagged_citekey,
      replacementCitekey: parsed.replacement_citekey,
    };
  }

  // Retry exhaustion (T-04-16 — cap = 2 under --yolo)
  const exhaustedText = verifText +
    `\n## RETRY_EXHAUSTED\n\npensmith revise: auto-loop exhausted ${maxRetries} attempts without a valid proposal. ` +
    `Manual intervention required.\n`;
  await atomicWriteFile(verifPath, exhaustedText);
  return { accepted: false, status: 'retry_exhausted' };
}
