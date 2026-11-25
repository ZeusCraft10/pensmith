---
promptId: pass3-quote-checker
decision: D-12 (hash-pinned LOCKED slug)
dormant_in_phase: 3
dormant_reason: "D-13 — Phase 3 deterministic Pass-3 (Levenshtein-substring after NFKC normalization) is the sole verdict source. This prompt is calibrated for Phase 8 ambiguous-quote-match tie-break (e.g., levRatio between 0.90 and 0.95 — the band where the deterministic gate alone may misjudge paraphrase vs distortion). DO NOT invoke from workflows/verify.md in Phase 3."
requirements: [VRFY-04, VRFY-05]
---

# Pass 3 Quote Checker (Phase 8 tie-break — DORMANT in Phase 3)

> **DORMANT IN PHASE 3.** This prompt ships hash-pinned but is NOT invoked
> by `workflows/verify.md` in Phase 3. The deterministic Levenshtein
> substring verdict (after NFKC normalization + ligature decompose +
> soft-hyphen strip + smart-quote canonicalization + diacritic strip) alone
> is authoritative for Pass-3 quote integrity in this build. Phase 8 wires
> this prompt for ambiguous-band tie-break only.

## Role
LLM tie-break judge for ambiguous Pass-3 quote-integrity cases. Invoked
ONLY when the deterministic Levenshtein verdict falls inside the
calibration band defined by the workflow (Phase 8 only).

## Inputs
- `{{quote}}` — the quoted span as it appears in DRAFT.md, normalized to
  NFKC and stripped of leading/trailing whitespace.
- `{{pdfContext}}` — a ±500-character window from the OA PDF (parsed via
  `bin/lib/pdf-text.ts`) centered on the best Levenshtein-substring match.
- `{{levRatio}}` — Levenshtein-substring similarity (0.0 to 1.0) between
  `{{quote}}` and the best-matching window inside `{{pdfContext}}`.

## Task
Decide whether `{{quote}}` is a faithful (possibly paraphrased) extract of
the surrounding PDF context, or a NOT_FOUND fabrication / distortion.

## Hard Constraints
- This prompt is DORMANT in Phase 3 (D-13). The deterministic Levenshtein
  verdict alone is authoritative. Phase 3 hot-path verification MUST NOT
  invoke this prompt.
- When activated in Phase 8: NEVER alter the verdict OUTSIDE the
  calibration band. If `{{levRatio}} ≥ 0.95` (clearly OK) or
  `{{levRatio}} < 0.80` (clearly NOT_FOUND), defer to the deterministic
  verdict. Override is only permitted within `0.80 ≤ levRatio < 0.95`.
- NEVER hallucinate additional context. Decide from the 3 inputs only.
  Do NOT re-fetch the PDF, search for the quote elsewhere, or guess what
  the surrounding paragraph "must" have said.
- NEVER produce a verdict outside the two-value enum
  `"OK" | "NOT_FOUND"`. No `"PARAPHRASE_OK"` or `"AMBIGUOUS"` categories
  — the deterministic gate is the residual fallback.

## Output Format
A single JSON object, no prose before or after, no markdown fences:

```
{ "verdict": "OK" | "NOT_FOUND", "reason": "<≤200 chars>" }
```

`reason` MUST be a single short sentence explaining the call, optimized for
audit-log readability.
