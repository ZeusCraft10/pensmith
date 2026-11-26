# pensmith next

> Advance to the next workflow step based on current paper state — the bare `/pensmith` flow.

<capability_check>
required:
  - (none required)

degrade_if_missing:
  - (no degradation needed — `pensmith next` reads .paper/STATE.json, .paper/OUTLINE.json and each section's PLAN.md from disk)
</capability_check>

## Overview

`pensmith next` is the bare `/pensmith` invocation: the state-aware next-step resolver.
It calls `resolveNextAction()` (`bin/lib/router.ts`), which only reads: STATE.json (that a paper
was started), the outline (`.paper/OUTLINE.json`, the one list of sections), each section's
PLAN.md frontmatter, DRAFT.md, VERIFICATION.json, ACKNOWLEDGEMENTS.json and REVISE.json (why the
last revise left the draft unchanged), and the paper's COMPILE-MANIFEST.json, COMPILE-REFUSAL.json
(the verified sections compile's re-check refused), DRAFT.md, CITATIONS.bib, FINAL.md and EXPORT.json. The resolver IGNORES HANDOFF.json (H4) and NEVER
returns `{ verb:'resume' }`. It dispatches the resolved verb via `dispatchVerb()`.

State machine: `new → research → outline → (plan → write → verify per section) → compile → done`.
The resolver reads the configured paper mode and may halt early for mode-specific termination
states (`{ verb:'status', reason:'done' }` or `{ verb:'status', reason:'attention' }`).

## Outputs

- Delegates entirely to the dispatched verb. No direct file writes.

## Body

1. **Read the paper mode** via `readGoalFromConfig(paperRoot)` + `stopAfterResearchFor(config)`.

2. **Call `resolveNextAction(paperRoot, { stopAfterResearch })`** (`bin/lib/router.ts`). NEVER throws (C3-HIGH-1 + C4-HIGH + C5-HIGH totality invariant — every fs/parse op is guarded with catch-all backstop).

3. **Map the decision** (every decision carries `why`, the reason in plain words, which `next`, `status` and bare `pensmith` print):
   - `{ verb:'new' }` → run intake
   - `{ verb:'research' }` → run research
   - `{ verb:'outline' }` → run outline
   - `{ verb:'plan', n, slug }` → plan section N; with `revise: true`, `plan N --revise` repairs the citation its recorded verdicts flag (FABRICATED, MIS-CITED, quote NOT_FOUND, RETRACTED; for RETRACTED `why` also names `pensmith ack`, which only the user may choose). When the last revise of the same draft and verdicts left DRAFT.md unchanged (the change could not be applied, the proposal could not be used, or the user rejected it), the decision is attention instead, with the reason, so the same refusal is not paid for again
   - `{ verb:'write', n, slug }` → draft section N; with `force: true`, `write N --force` redrafts placeholder, empty or uncited text
   - `{ verb:'verify', n, slug }` → verify section N: drafted and not verified, or its draft, assigned sources, acknowledgements or verifier version changed since its verdicts, or a registry did not answer (UNRESOLVED marked as worth retrying, or recorded offline), or compile refused the verified section when it checked it again. verify is never sent an unchanged draft whose verdicts it would only repeat: an UNRESOLVED entry with no identifier, or one the only registry for it does not hold, is attention, naming the entry
   - `{ verb:'compile' }` → compile: every section is verified (or unverifiable only because a quotation could not be checked, which `why` warns about), and `.paper/DRAFT.md` is not what the last compile wrote from the sections, outline and bibliography as they are now
   - `{ verb:'done' }` → final audit and export: the compiled draft is current and `.paper/FINAL.md` is not its recorded export (`.paper/EXPORT.json`)
   - `{ verb:'status', reason:'done' }` → the current compile is exported (or a mode-specific end-state)
   - `{ verb:'status', reason:'attention' }` → something only the user can sort out, which `why` names: a corrupt STATE.json or PLAN.md, a citation typed as text, an UNRESOLVED entry that needs an identifier, a revise that left the draft unchanged, a verify that could not run, or a compiled DRAFT.md edited by hand (never overwritten unasked)

4. **Dispatch** via `dispatchVerb(decision.verb, verbArgs)` forwarding `yolo` + other global flags (C3-HIGH-2).

5. Shell fallback (TIER-06): `pensmith next` (or bare `pensmith`).
