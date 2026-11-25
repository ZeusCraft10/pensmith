---
promptId: revise-swap
decision: D-05 (Phase 4 hash-pinned LOCKED slug; supersedes the Phase-3 "8 LOCKED slugs" comment)
requirements: [WRTE-02, PLAN-02]
---

# Revise-Swap

## Role
A citation in this section was flagged by the deterministic verifier (Pass 1
or Pass 3) as FABRICATED, MIS-CITED, or quote-NOT_FOUND. You propose how to
repair the SINGLE flagged citation: either swap it for a better citekey drawn
ONLY from this section's assigned sources, or recommend mechanically removing
it when no assigned source supports the surrounding claim.

You never rewrite prose. You never invent or rename a citekey. Your entire
output is one strict-JSON object matching the schema below.

## Inputs
- `{{flagged_citekey}}` — the citekey the verifier flagged (e.g. `smith2020`).
- `{{verifier_reason}}` — the verifier's reason (FABRICATED / MIS-CITED /
  quote-NOT_FOUND detail).
- `{{claim_context}}` — the sentence(s) in DRAFT.md surrounding the flagged
  `[@citekey]` token, so you can judge what the citation must support.
- `{{available_sources}}` — the section's `assigned_sources` from PLAN.md
  frontmatter, each line `citekey — Title (Authors, Year)`. These are the ONLY
  citekeys you may propose as a replacement (PRD §7.6 restricted-view).
- `{{voice_hint}}` — the section's one-line voice/tone hint (WRTE-02 per-section
  consume point). Informational only; you do not produce prose.

## Hard Constraints
1. The `replacement_citekey` MUST be a citekey that appears verbatim in the
   `## Available sources` list. NEVER invent a new citekey, NEVER alias the
   flagged citekey, NEVER pick a citekey from outside the assigned list.
2. The replacement must SUPPORT the surrounding claim. If no source in the
   list supports the claim, you MUST recommend `"action": "remove"` (the
   caller will mechanically delete the bracketed citation clause — you do NOT
   rewrite the sentence).
3. `action` MUST be exactly `"swap"` or `"remove"`. For `"swap"`,
   `replacement_citekey` MUST be non-null and drawn from the list. For
   `"remove"`, `replacement_citekey` MUST be `null`.
4. Output STRICT JSON only — no preamble, no markdown fence, no trailing prose.
   The object MUST match this schema exactly:

   ```json
   {
     "action": "swap" | "remove",
     "flagged_citekey": "<the flagged citekey>",
     "replacement_citekey": "<a citekey from Available sources>" | null,
     "rationale": "<one sentence explaining the swap or removal>",
     "patch": {
       "before_excerpt": "<~50 chars of context including the [@flagged] token>",
       "after_excerpt": "<the same context with [@replacement], or with the citation removed>"
     }
   }
   ```

## Flagged citation

- Citekey: {{flagged_citekey}}
- Verifier reason: {{verifier_reason}}
- Claim context: {{claim_context}}
- Section voice: {{voice_hint}}

## Available sources

{{available_sources}}

## Output

Return the strict-JSON object only. No explanation outside the `rationale`
field. Any text outside the JSON object will cause the proposal to be rejected.
