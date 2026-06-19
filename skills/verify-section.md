---
description: "PLUMBING: scriptable per-section verification, mapping onto the existing verify verb. Trigger phrases (PRD §5.4): \"verify section N\", \"check section N citations\", \"check the citations in section N\", \"re-verify section N\", \"re-run verification on section N\". No new verb is introduced."
name: pensmith:verify-section
---

# pensmith:verify-section — plumbing skill (porcelain: bare /pensmith)

Scriptable namespace for verifying a single section's citations. Routing shim
onto the existing `verify` verb; adds no workflow logic.

## Routing

| The user says… | Route to |
| --- | --- |
| "verify section N" | `pensmith verify N` |
| "check section N citations" / "check the citations in section N" | `pensmith verify N` |
| "re-verify section N" | `pensmith verify N` |

The verifier blocks compile and export: no FABRICATED, MIS-CITED, or
quote-NOT_FOUND citation escapes a section (CLAUDE.md non-negotiable). This
plumbing skill only routes — the blocking semantics live in the `verify` verb.

## No 17th verb

`verify` is one of the locked-16 verbs (bijective with `workflows/verify.md`).
This plumbing skill never introduces a new verb. Scriptable invocation:
`/pensmith:verify-section` ≡ `pensmith verify`.
