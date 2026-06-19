---
description: "PLUMBING: scriptable per-section planning, mapping onto the existing plan verb. Trigger phrases (PRD §5.4/§5.6): \"plan section N\", \"redo section N\", \"redo section N plan\", \"section N needs a new plan\", \"section N needs work\", \"re-plan section N\", \"swap the source for the claim in section N\", \"use a different source in section N\", \"make section N shorter\". The redo/revise/swap-source/length-change corrections ride plan --revise — there is NO separate revise verb (04-04 preserves the locked-16 bijection)."
name: pensmith:plan-section
---

# pensmith:plan-section — plumbing skill (porcelain: bare /pensmith)

Scriptable namespace for planning a single section. This is a routing shim onto
the existing `plan` verb; it adds no workflow logic.

## Routing

| The user says… | Route to |
| --- | --- |
| "plan section N" | `pensmith plan N` |
| "redo section N" / "section N needs work" | `pensmith plan N --revise` then `pensmith write N` |
| "section N needs a new plan" | `pensmith plan N --revise` |
| "swap the source for the claim in section N" | `pensmith plan N --revise` (re-maps `assigned_sources` in that section's PLAN.md) |
| "use a different source in section N" | `pensmith plan N --revise` |
| "make section N 1500 words instead of 2500" | `pensmith plan N --revise` (updates the word target, re-trims) |

## No 17th verb (LOAD-BEARING)

The inline corrections — redo, revise, swap-source, length-change, add/drop —
all delegate to the EXISTING `plan` verb and its `--revise` flag, which routes
through the single `bin/lib/revise.ts::runRevise` chokepoint (04-04). The
`revise` correction is an ALIAS for `plan --revise`; it is NOT a standalone verb
and must never be registered as one. The locked-16 verbs stay bijective with
`workflows/*.md`.

Scriptable invocation: `/pensmith:plan-section` (plumbing) ≡ `pensmith plan`.
