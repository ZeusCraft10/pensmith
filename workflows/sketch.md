# pensmith sketch

> A thinking-partner thesis-discovery mode that runs BEFORE intake — a short
> Socratic loop helps you shape a candidate thesis, then, ONLY after you
> confirm, hands that thesis to the `new` (intake) verb.
>
> **LOAD-BEARING no-advance invariant (ERGO-05 / Pitfall 6): sketch NEVER
> creates paper state.** No `.paper/` directory, no STATE.json, no LIBRARY.json
> is created anywhere in the Socratic loop or on decline. State creation lives in
> ONE place — the `new` verb — preserving the section-as-phase isolation
> contract. A DECLINED sketch leaves the working directory byte-unchanged.

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: ask the Socratic questions and the confirm gate via @clack/prompts over stdin (the bin/cli/sketch.ts CLI path)
</capability_check>

## Overview

`pensmith sketch` is the fourth library/ergonomics verb (list / open / **sketch**
/ add). It is the pre-intake on-ramp: a 4-5 question Socratic loop that
synthesizes a candidate thesis, presents it, then dispatches the existing `new`
verb with the thesis as a seed (`intake --thesis`, NOT a 17th verb).

The implementation lives in `bin/cli/sketch.ts` (`sketchCommand`) delegating to
`bin/lib/prompts.ts` (`ask`) for the loop + gate and to `dispatchVerb('new', …)`
for the hand-off. Both Tier 1 (plugin) and Tier 2 (CLI) run the SAME
`bin/cli/sketch.ts` path: Tier 1 surfaces the questions + confirm via
`AskUserQuestion`; Tier 2 degrades to `@clack/prompts` over stdin. There is no
`pensmith_sketch` MCP tool (the Tier-1 surface is THIS workflow body delegating
to the same code — the compile/done asymmetry precedent, keeping the locked 16
verbs bijective with the 16 workflow bodies).

## Outputs

- stdout — the synthesized candidate thesis, then either a cancellation line (on
  decline) or the downstream `new` verb's intake artifacts (on confirm).
- On confirm ONLY: the `new` verb creates `.paper/STATE.json` + `.paper/INTAKE.md`
  (seeded with the thesis). sketch itself writes NOTHING (the no-advance
  invariant).

## Body

> **LOCKED INVARIANT — no-advance-until-confirm (ERGO-05 / Pitfall 6).** Steps
> 1-2 MUST NOT call `initState`, MUST NOT `mkdir .paper/`, and MUST NOT call
> `initLibrary`. Only step 3 (after an explicit confirm) advances paper state,
> and it does so by dispatching `new` — sketch never self-initializes.

1. **Socratic loop** (ERGO-05): ask 4-5 thinking-partner questions to surface a
   thesis — e.g. what motivates the paper, what conventional view the author
   disagrees with, the target audience, and the candidate thesis claim. Tier 1
   asks via `AskUserQuestion`; Tier 2 via `@clack/prompts` over stdin. Synthesize
   the answers into a single candidate thesis sentence and print it. (A
   pre-supplied `--thesis` skips the loop — the one-shot / test-seam path.)
   CRITICAL: nothing in this step creates `.paper/` / STATE.json / LIBRARY.json.

2. **Confirm gate** (approval-gates-default-on): present the candidate thesis and
   ask `Proceed to intake with this thesis?` (default no). `--yolo` skips the
   prompt; a pre-supplied `--confirm` (test seam) wins over both. On DECLINE:
   print `cancelled — re-run to try again.` and return `{ ok: false }` WITHOUT
   creating ANY state (the no-advance invariant — Pitfall 6).

3. **Dispatch `new` with the thesis seed** (Open-Q2): ONLY after confirm,
   dispatch the existing `new` verb via `dispatchVerb('new', { args: { thesis },
   globalFlags: { yolo, dryRun } })`. `new` is the single state-init site; sketch
   never calls `initState` itself. The thesis is forwarded so it is not dropped
   (`intake --thesis` pre-fills the intake brief — NOT a new verb).

4. **Shell fallback** (TIER-06 equivalence path): `pensmith sketch [--yolo]
   [--dry-run]`. `--yolo` auto-confirms; `--dry-run` makes zero external API
   calls.
