---
description: "PLUMBING: scriptable per-section drafting, mapping onto the existing write verb. Trigger phrases (PRD §5.4): \"write section N\", \"draft section N\", \"rewrite section N\", \"re-draft section N\", \"write the draft for section N\". No new verb is introduced."
name: pensmith:write-section
---

# pensmith:write-section — plumbing skill (porcelain: bare /pensmith)

Scriptable namespace for drafting a single section. Routing shim onto the
existing `write` verb; adds no workflow logic.

## Routing

| The user says… | Route to |
| --- | --- |
| "write section N" / "draft section N" | `pensmith write N` |
| "rewrite section N" / "re-draft section N" | `pensmith write N` |

A bare "rewrite section N" re-runs the `write` verb against that section's
existing PLAN.md (section directories are independent — `section-as-phase`
isolation means re-writing section N never touches the other sections).

`N` is the section id as `pensmith status` shows it (`3`, or `1a`). The section
must be planned first: on the outline's stub PLAN.md, `write N` stops with
"section N is not planned yet — run `pensmith plan N` first". `write N` verifies
the draft right away and reports the verify status (`--no-verify` leaves the
section `written`). A draft that cites a source outside the section's
`assigned_sources` twice is not kept (it goes to `DRAFT.rejected.md`, the section
is marked failed with the reason, exit 4); adjust the plan or sources, then run
`pensmith write N` again.

## No 17th verb

`write` is one of the locked-16 verbs (bijective with `workflows/write.md`).
This plumbing skill never introduces a new verb. Scriptable invocation:
`/pensmith:write-section` ≡ `pensmith write`.
