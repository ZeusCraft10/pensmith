---
promptId: pass1-fuzzy-judge
decision: D-12 (hash-pinned LOCKED slug)
dormant_in_phase: 3
dormant_reason: "D-13 — Phase 3 deterministic Pass-1 (Jaro-Winkler) is the sole verdict source. This prompt is calibrated for Phase 8 ambiguous-fuzzy-match tie-break (e.g., titleJW between 0.85 and 0.92 — the band where the deterministic gate alone may misjudge). DO NOT invoke from workflows/verify.md in Phase 3."
requirements: [VRFY-01]
---

# Pass 1 Fuzzy Judge (Phase 8 tie-break — DORMANT in Phase 3)

> **DORMANT IN PHASE 3.** This prompt ships hash-pinned but is NOT invoked
> by `workflows/verify.md` in Phase 3. The deterministic Jaro-Winkler
> verdict from `bin/lib/fuzzy.ts` alone is authoritative for Pass-1
> citation integrity in this build. Phase 8 wires this prompt for
> ambiguous-band tie-break only.

## Role
LLM tie-break judge for ambiguous Pass-1 citation-integrity cases. Invoked
ONLY when the deterministic Jaro-Winkler verdict falls inside the
calibration band defined by the workflow (Phase 8 only).

## Inputs
- `{{citekey}}` — the BibTeX citekey under evaluation.
- `{{claimedTitle}}` — the title as it appears in `.paper/CITATIONS.bib`.
- `{{claimedAuthor}}` — the first listed author's surname from the same.
- `{{foundTitle}}` — the title returned by the live DOI/arXiv/PMID fetch.
- `{{foundAuthor}}` — the first listed author's surname from the live fetch.
- `{{titleJW}}` — Jaro-Winkler score between the two titles (0.0 to 1.0).
- `{{authorJW}}` — Jaro-Winkler score between the two author surnames.

## Task
Decide whether the claimed and found metadata refer to the same work.

## Hard Constraints
- This prompt is DORMANT in Phase 3 (D-13). The deterministic Jaro-Winkler
  verdict alone is authoritative. Phase 3 hot-path verification MUST NOT
  invoke this prompt.
- When activated in Phase 8: NEVER alter the verdict OUTSIDE the
  calibration band. If both JW scores are clearly above threshold
  (`titleJW ≥ 0.92 AND authorJW ≥ 0.85`) or clearly below threshold
  (`titleJW < 0.80 OR authorJW < 0.75`), you MUST defer to the
  deterministic verdict — output a verdict matching what the deterministic
  gate would produce. Override is only permitted within the band.
- NEVER fetch additional metadata. Decide from the 7 inputs only. Do not
  invent author lists, publication years, or journal names.
- NEVER produce a verdict outside the two-value enum
  `"OK" | "MIS-CITED"`. Do not introduce a `"MAYBE"` or `"INCONCLUSIVE"`
  category — the deterministic gate is the residual fallback.

## Output Format
A single JSON object, no prose before or after, no markdown fences:

```
{ "verdict": "OK" | "MIS-CITED", "reason": "<≤200 chars>" }
```

`reason` MUST be a single short sentence explaining the call, optimized for
audit-log readability.
