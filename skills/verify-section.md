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
| "accept quote qK in section N" (a quote VERIFICATION.md lists as UNVERIFIABLE-QUOTE) | `pensmith verify N --accept-quote qK` (MCP: `pensmith_verify` with `accept_quote: ["qK"]`) — ask the user first (AskUserQuestion); never on your own |

The verifier blocks compile and export: no FABRICATED, MIS-CITED, RETRACTED,
UNVERIFIABLE(-NETWORK), unparseable or unsupported citation form, or
quote-NOT_FOUND escapes a section (CLAUDE.md non-negotiable), and compile and
done recompute every verdict themselves. This
plumbing skill only routes — the blocking semantics live in the `verify` verb.
Only a quote whose source text cannot be checked (UNVERIFIABLE-QUOTE) can be
accepted, one id at a time and only by the user's own decision; there is no
blanket acceptance.
A section whose last `write` failed is not verified: `verify N` refuses (exit 4)
and names `pensmith write N`, the step that fixes it.

## No 17th verb

`verify` is one of the locked-16 verbs (bijective with `workflows/verify.md`).
This plumbing skill never introduces a new verb. Scriptable invocation:
`/pensmith:verify-section` ≡ `pensmith verify`.
