---
promptId: revise-swap
decision: D-05/D-12 (hash-pinned LOCKED slug, Phase 4)
requirements: [WRTE-02]
---

# Revise-Swap Prompt (Phase 4)

A citation in this section was flagged by the verifier as FABRICATED, MIS-CITED,
or NOT_FOUND. Your job: produce a DIFF proposing which citekey to swap to, OR
recommend deletion if no substitute exists in the assigned sources.

## Hard Constraints

1. Pick replacement ONLY from the `## Available sources` list below
   (these are the section's `assigned_sources` from PLAN.md frontmatter).
   You MUST NOT invent a citekey. You MUST NOT use a citekey from outside this list.
2. The replacement must directly support the surrounding claim. If no source in
   the list supports the claim, recommend REMOVE the citation entirely.
3. Do NOT add new citekeys. Do NOT reference any source not in the Available sources list.
4. Output STRICT JSON only — no preamble, no explanation, no markdown fences:

```json
{
  "action": "swap" | "remove",
  "flagged_citekey": "<original citekey that was flagged>",
  "replacement_citekey": "<new citekey from available sources>" | null,
  "rationale": "<one sentence explaining the swap or removal>",
  "patch": {
    "before_excerpt": "<~50 chars of surrounding text including [@flagged]>",
    "after_excerpt": "<~50 chars of surrounding text with [@replacement] OR rephrased (no citation)"
  }
}
```

## JSON Schema

- `action`: REQUIRED. Must be exactly `"swap"` or `"remove"`.
- `flagged_citekey`: REQUIRED. The exact citekey from the flagged citation.
- `replacement_citekey`: REQUIRED if `action == "swap"`. Must be a key from Available sources. Set to `null` if `action == "remove"`.
- `rationale`: REQUIRED. One sentence only. Must not contain newlines.
- `patch.before_excerpt`: REQUIRED. ~50 chars of context surrounding the flagged `[@flagged_citekey]` token in DRAFT.md. Used to locate the correct occurrence when a citekey appears multiple times.
- `patch.after_excerpt`: REQUIRED. The same context window after applying the swap or removal.

## Inputs

### Flagged citation

- Citekey: {{flagged_citekey}}
- Claim context (sentence containing the citation):
  {{claim_context}}
- Verifier verdict and reason:
  {{verifier_reason}}

### Voice hint (from section PLAN.md brief — WRTE-02 consume point)

{{voice_hint}}

## Available sources

The section's assigned_sources from PLAN.md frontmatter:

{{available_sources}}

---

Respond with STRICT JSON only. No markdown fences. No explanation outside the JSON object.
