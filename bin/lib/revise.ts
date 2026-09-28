// bin/lib/revise.ts — single Tier-1/Tier-2 revise chokepoint (Plan 04-04).
//
// D-05 / D-06 (LOCKED): `pensmith revise` (Tier-1 slash) and the Tier-2 CLI
// BOTH delegate to runRevise — there is NO divergent code path between tiers
// (WRTE-02 satisfied by this single module). The flow follows 04-RESEARCH §I:
//
//   1. Parse sections/<N>/VERIFICATION.md for the FIRST failing citation
//      (FABRICATED / MIS-CITED / NOT_FOUND), in order of appearance.
//   2. Load PLAN.md frontmatter → assigned_sources + the section voice hint
//      (WRTE-02 per-section consume point — threaded into the prompt vars).
//   3. Ask the LLM (via the hash-pinned revise-swap prompt) for a citekey swap.
//      Parse the response with a STRICT zod schema. REJECT if action ∉
//      {swap,remove} OR replacement_citekey ∉ assigned_sources (T-04-14
//      LLM-response-injection mitigation — no new citekeys ever enter DRAFT.md).
//   4. Approval gate (default-on, PRD §19): render a before/after diff and
//      prompt. Skipped under --yolo. Non-TTY without --yolo → exit code 3.
//   5. On accept: `swap` substitutes the flagged [@k] via replaceCitekeys
//      (Plan 01 citation-token helper); `remove` mechanically deletes the
//      bracketed citation clause (NO LLM prose rewrite — 04-RESEARCH §I). Write
//      DRAFT.md via atomicWriteFile; reset PLAN.md verified_against_draft_hash
//      → null via updateFrontmatter under withLock (D-05).
//   6. --yolo auto-loop: re-run the SAME path up to 2 retries; on exhaustion
//      write a RETRY_EXHAUSTED verdict to VERIFICATION.md (D-06).
//
// `--research <query>` is NOT handled here: `plan N --research` and
// `revise N --research` both call bin/lib/section-research.ts
// runSectionResearch (GRND-17, D-19-18) — the real research pass that adds
// hits to section N only. (The old research branch of this module applied the
// hits of an injected adapter that defaulted to none; it is gone.)
//
// ALL writes route through atomicWriteFile (D-07 chokepoint) — never raw fs.

import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { atomicWriteFile } from './atomic-write.js';
import { updateFrontmatter, migrateFrontmatterText, loadFrontmatterDoc } from './frontmatter.js';
import { runGate, declineGate, canPrompt } from './gates.js';
import { withLock } from './lock.js';
import { replaceCitekeys } from './citation-token.js';
import { sectionDraft, sectionPlan, sectionVerification } from './paths.js';

// --yolo retry cap (D-06): 2 retries → 3 total attempts, then RETRY_EXHAUSTED.
const YOLO_RETRY_CAP = 2;

/** The verifier verdicts that --revise repairs, in priority/appearance order. */
const FAILING_VERDICTS = ['FABRICATED', 'MIS-CITED', 'NOT_FOUND'] as const;

// Strict-JSON contract for the revise-swap LLM response (04-RESEARCH §I).
const ReviseSwapSchema = z.object({
  action: z.enum(['swap', 'remove']),
  flagged_citekey: z.string(),
  replacement_citekey: z.string().nullable(),
  rationale: z.string(),
  patch: z.object({
    before_excerpt: z.string(),
    after_excerpt: z.string(),
  }),
});
export type ReviseSwapProposal = z.infer<typeof ReviseSwapSchema>;

/** Variables handed to the LLM proposeSwap seam (mirror the prompt's {{vars}}). */
export interface ReviseSwapVars {
  flagged_citekey: string;
  verifier_reason: string;
  claim_context: string;
  available_sources: string;
  voice_hint: string;
}

export interface ReviseOptions {
  paperRoot: string;
  n: number;
  slug: string;
  yolo: boolean;
  /**
   * LLM call seam. Returns the raw strict-JSON string the revise-swap prompt
   * asks for. Default (production) loads the hash-pinned prompt + invokes the
   * model; tests/CI inject a cassette-backed function (no live LLM).
   */
  proposeSwap?: (vars: ReviseSwapVars) => Promise<string>;
  /**
   * Approval-gate seam (default-on, PRD §19). Default uses @clack/prompts in a
   * TTY (exit code 3 in a non-TTY without --yolo). Tests inject a boolean.
   */
  approve?: (proposal: ReviseSwapProposal) => Promise<boolean>;
}

export interface ReviseResult {
  /** The action the LLM proposed for the accepted/last proposal. */
  action: 'swap' | 'remove' | null;
  /** True iff a patch was applied to DRAFT.md (and the hash reset). */
  accepted: boolean;
  flagged_citekey: string | null;
  replacement_citekey: string | null;
  /** True iff --yolo exhausted its retry budget (D-06). */
  retryExhausted: boolean;
  /** Why a proposal was rejected (membership guard / invalid shape), if any. */
  rejectedReason?: string;
  /** Human-readable summary for the CLI / workflow narration. */
  message: string;
}

// ---------------------------------------------------------------------------
// VERIFICATION.md parsing — first failing citation, in appearance order.
// ---------------------------------------------------------------------------

interface FailingCitation {
  citekey: string;
  reason: string;
}

/**
 * Find the FIRST failing citation in VERIFICATION.md (one-at-a-time, in order
 * of appearance — 04-RESEARCH §I). A failing line looks like:
 *   - jones2019: **FABRICATED** — ... — <reason>
 * We scan top-to-bottom and return the first line whose verdict is one of
 * FAILING_VERDICTS. Returns null when the section has no failing citation.
 */
export function firstFailingCitation(verificationMd: string): FailingCitation | null {
  const lines = verificationMd.split(/\r?\n/);
  for (const line of lines) {
    // `- <citekey>: **<VERDICT>** — ...rest`
    const m = /^\s*-\s*([a-z][a-z0-9_-]*)\s*[:(].*?\*\*([A-Z_-]+)\*\*\s*(.*)$/.exec(line);
    if (!m) continue;
    const citekey = m[1];
    const verdict = m[2];
    if (citekey === undefined || verdict === undefined) continue;
    if ((FAILING_VERDICTS as readonly string[]).includes(verdict)) {
      return { citekey, reason: `${verdict}: ${(m[3] ?? '').replace(/^—\s*/, '').trim()}` };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Claim-context extraction — the line(s) around the flagged [@citekey] token.
// ---------------------------------------------------------------------------

function claimContext(draftMd: string, citekey: string): string {
  const token = `[@${citekey}]`;
  for (const line of draftMd.split(/\r?\n/)) {
    if (line.includes(token)) return line.trim();
  }
  return '(token not found in DRAFT.md)';
}

// ---------------------------------------------------------------------------
// Voice-hint extraction — WRTE-02 per-section consume point.
// The section-planner prompt writes a one-line `Voice: ...` in the ## Brief.
// ---------------------------------------------------------------------------

function voiceHint(planMd: string): string {
  const m = /(^|\n)\s*Voice:\s*([^\n]+)/i.exec(planMd);
  return m && m[2] ? `Voice: ${m[2].trim()}` : 'Voice: formal academic tone.';
}

// ---------------------------------------------------------------------------
// Mechanical bracket-clause removal for action: "remove".
// Deletes the flagged [@citekey] token plus a single adjacent space and a
// trailing punctuation-preserving cleanup. NO prose rewrite (04-RESEARCH §I).
// ---------------------------------------------------------------------------

function mechanicalRemove(draftMd: string, citekey: string): string {
  const token = `\\[@${citekey}\\]`;
  // " [@k]." -> "." ; " [@k]" -> "" ; "[@k] " -> "" ; "[@k]" -> ""
  return draftMd
    .replace(new RegExp(`\\s*${token}(?=[.,;:])`, 'g'), '')
    .replace(new RegExp(`\\s*${token}`, 'g'), '')
    .replace(new RegExp(`${token}\\s*`, 'g'), '');
}

// ---------------------------------------------------------------------------
// Default LLM proposeSwap — loads the hash-pinned prompt + (would) call the
// model. Production callers inject a real transport; this default throws so a
// caller that forgot to wire the transport fails loudly instead of silently.
// ---------------------------------------------------------------------------

async function defaultProposeSwap(vars: ReviseSwapVars): Promise<string> {
  // The prompt body is loaded + interpolated by the CLI/MCP caller which owns
  // the actual model transport (no model client exists in bin/lib yet). When a
  // caller does not inject proposeSwap, there is nothing to call.
  void vars;
  await Promise.resolve();
  throw new Error(
    'runRevise: no proposeSwap transport injected. The CLI/MCP caller must ' +
    'supply an LLM seam (loadPrompt(\'revise-swap\') + interpolate + model call).',
  );
}

// ---------------------------------------------------------------------------
// Default approval gate — the `revise-swap` gate of the registry (RUN-28,
// bin/lib/gates.ts). --yolo is handled by the caller before this runs. A run
// that cannot prompt refuses with EXIT_APPROVAL (GateRefusedError); an explicit
// "no" is the registry's decline (EXIT_APPROVAL, DRAFT.md unchanged).
// ---------------------------------------------------------------------------

async function defaultApprove(proposal: ReviseSwapProposal): Promise<boolean> {
  if (canPrompt()) {
    process.stderr.write(
      `Proposed ${proposal.action} — ${proposal.rationale}\n` +
        `- ${proposal.patch.before_excerpt}\n+ ${proposal.patch.after_excerpt}\n`,
    );
  }
  const outcome = await runGate('revise-swap', {
    yolo: false,
    detail: `${proposal.action} of [@${proposal.flagged_citekey}]`,
    question: { id: 'revise-swap', kind: 'confirm', label: `Apply this ${proposal.action}?`, default: false },
  });
  const yes = outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true;
  if (!yes) declineGate('revise-swap', `citation ${proposal.action} declined — DRAFT.md unchanged`);
  return true;
}

// ---------------------------------------------------------------------------
// Validate + parse one LLM proposal against the strict schema + membership.
// ---------------------------------------------------------------------------

function validateProposal(
  raw: string,
  flagged: string,
  assignedSources: readonly string[],
): { ok: true; proposal: ReviseSwapProposal } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'LLM response was not valid JSON' };
  }
  const parsed = ReviseSwapSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `LLM response failed strict schema: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
  }
  const p = parsed.data;
  if (p.flagged_citekey !== flagged) {
    return { ok: false, reason: `LLM flagged_citekey "${p.flagged_citekey}" does not match the verifier-flagged "${flagged}"` };
  }
  if (p.action === 'swap') {
    if (!p.replacement_citekey) {
      return { ok: false, reason: 'swap action requires a non-null replacement_citekey' };
    }
    // T-04-14: replacement MUST be drawn from assigned_sources — no new citekeys.
    if (!assignedSources.includes(p.replacement_citekey)) {
      return { ok: false, reason: `replacement_citekey "${p.replacement_citekey}" is not in assigned_sources (no new citekeys allowed)` };
    }
  } else {
    // remove
    if (p.replacement_citekey !== null) {
      return { ok: false, reason: 'remove action requires replacement_citekey: null' };
    }
  }
  return { ok: true, proposal: p };
}

// ---------------------------------------------------------------------------
// Apply an accepted proposal: patch DRAFT.md + reset the hash under withLock.
// ---------------------------------------------------------------------------

async function applyProposal(
  opts: ReviseOptions,
  proposal: ReviseSwapProposal,
  draftPath: string,
  planPath: string,
  draftMd: string,
): Promise<void> {
  let patched: string;
  if (proposal.action === 'swap') {
    const replacement = proposal.replacement_citekey as string;
    // Locate + swap the flagged token via the Plan 01 citation-token helper
    // (NOT a bespoke regex) — only the flagged citekey is rewritten.
    patched = replaceCitekeys(draftMd, (k) =>
      k === proposal.flagged_citekey ? `[@${replacement}]` : `[@${k}]`,
    );
  } else {
    patched = mechanicalRemove(draftMd, proposal.flagged_citekey);
  }
  await atomicWriteFile(draftPath, patched);

  // Reset verified_against_draft_hash → null under a per-PLAN.md lock (D-05).
  await withLock(planPath, async () => {
    // CONF-04: migrate a v0 PLAN.md (stamp schema_version) before mutating it.
    const cur = migrateFrontmatterText('plan', readFileSync(planPath, 'utf8'), planPath).text;
    const next = updateFrontmatter(cur, (fm) => {
      fm['verified_against_draft_hash'] = null;
    });
    await atomicWriteFile(planPath, next);
  });
}

// ---------------------------------------------------------------------------
// RETRY_EXHAUSTED verdict → VERIFICATION.md (D-06).
// ---------------------------------------------------------------------------

async function writeRetryExhausted(verifPath: string, flagged: string): Promise<void> {
  const cur = existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : '';
  const note = [
    '',
    '## Revise (RETRY_EXHAUSTED — D-06)',
    '',
    `- ${flagged}: **RETRY_EXHAUSTED** — --yolo auto-revise reached the ${YOLO_RETRY_CAP}-retry cap without a valid swap. Human review required.`,
    '',
  ].join('\n');
  await atomicWriteFile(verifPath, cur + note);
}

// ===========================================================================
// runRevise — the single Tier-1/Tier-2 chokepoint.
// ===========================================================================

export async function runRevise(opts: ReviseOptions): Promise<ReviseResult> {
  const draftPath = sectionDraft(opts.n, opts.slug, opts.paperRoot);
  const planPath = sectionPlan(opts.n, opts.slug, opts.paperRoot);
  const verifPath = sectionVerification(opts.n, opts.slug, opts.paperRoot);

  const base: ReviseResult = {
    action: null,
    accepted: false,
    flagged_citekey: null,
    replacement_citekey: null,
    retryExhausted: false,
    message: '',
  };

  if (!existsSync(verifPath)) {
    return { ...base, message: `${base.message} No VERIFICATION.md at section ${opts.n} — nothing to revise.`.trim() };
  }
  const verificationMd = readFileSync(verifPath, 'utf8');
  const failing = firstFailingCitation(verificationMd);
  if (!failing) {
    return { ...base, message: `${base.message} No FABRICATED/MIS-CITED/NOT_FOUND citation in section ${opts.n}.`.trim() };
  }
  base.flagged_citekey = failing.citekey;

  if (!existsSync(planPath) || !existsSync(draftPath)) {
    return { ...base, message: `${base.message} Section ${opts.n} is missing PLAN.md or DRAFT.md.`.trim() };
  }
  // CONF-04: the versioned PLAN.md reader, read-only here: a rejected proposal
  // leaves PLAN.md byte-identical; applyProposal persists the migration.
  const { frontmatter, text: planMd } = await loadFrontmatterDoc('plan', planPath);
  const assignedSources = Array.isArray(frontmatter['assigned_sources'])
    ? (frontmatter['assigned_sources'] as unknown[]).map(String)
    : [];

  const proposeSwap = opts.proposeSwap ?? defaultProposeSwap;
  const approve = opts.approve ?? defaultApprove;
  const draftMd = readFileSync(draftPath, 'utf8');

  const vars: ReviseSwapVars = {
    flagged_citekey: failing.citekey,
    verifier_reason: failing.reason,
    claim_context: claimContext(draftMd, failing.citekey),
    available_sources: assignedSources.map((k) => `- ${k}`).join('\n'),
    voice_hint: voiceHint(planMd),
  };

  const maxAttempts = opts.yolo ? YOLO_RETRY_CAP + 1 : 1;
  let lastRejection = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await proposeSwap(vars);
    const validated = validateProposal(raw, failing.citekey, assignedSources);
    if (!validated.ok) {
      lastRejection = validated.reason;
      continue; // --yolo retries; single-attempt mode falls through to reject
    }
    const proposal = validated.proposal;
    base.action = proposal.action;
    base.replacement_citekey = proposal.replacement_citekey;

    // Approval gate (default-on, PRD §19). --yolo skips.
    const accepted = opts.yolo ? true : await approve(proposal);
    if (!accepted) {
      return { ...base, accepted: false, message: `${base.message} Proposal rejected at the approval gate — DRAFT.md unchanged.`.trim() };
    }

    await applyProposal(opts, proposal, draftPath, planPath, draftMd);
    return {
      ...base,
      accepted: true,
      message: `${base.message} Applied ${proposal.action} for [@${failing.citekey}]${proposal.replacement_citekey ? ` → [@${proposal.replacement_citekey}]` : ''}; verification hash reset.`.trim(),
    };
  }

  // Exhausted (only reachable under --yolo with all proposals invalid, or a
  // single-attempt invalid proposal). Write RETRY_EXHAUSTED only under --yolo.
  if (opts.yolo) {
    await writeRetryExhausted(verifPath, failing.citekey);
    return { ...base, retryExhausted: true, rejectedReason: lastRejection, message: `${base.message} --yolo retries exhausted (${lastRejection}); RETRY_EXHAUSTED written.`.trim() };
  }
  return { ...base, accepted: false, rejectedReason: lastRejection, message: `${base.message} Proposal rejected (${lastRejection}); DRAFT.md unchanged.`.trim() };
}

export default runRevise;
