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
  in the current folder (a new paper — sketch never follows the `pensmith open`
  pointer; RUN-14), seeded with the thesis. sketch itself writes NOTHING (the
  no-advance invariant).
- Exit code: 0 after a confirmed hand-off (or `new`'s own code); 3 (EXIT_APPROVAL)
  on a decline, when the answers run out, or without a terminal, scripted answers
  or `--yolo` (RUN-09, RUN-28).

## Body

> **LOCKED INVARIANT — no-advance-until-confirm (ERGO-05 / Pitfall 6).** Steps
> 1-2 MUST NOT call `initState`, MUST NOT `mkdir .paper/`, and MUST NOT call
> `initLibrary`. Only step 3 (after an explicit confirm) advances paper state,
> and it does so by dispatching `new` — sketch never self-initializes.

1. **Socratic loop** (ERGO-05): ask 4-5 thinking-partner questions to surface a
   thesis — e.g. what motivates the paper, what conventional view the author
   disagrees with, the target audience, and the candidate thesis claim. Tier 1
   asks via `AskUserQuestion`; Tier 2 via `@clack/prompts` in a terminal, else the
   scripted numbered prompts over stdin — one line per question, so the answers
   (the confirm included) can be piped with
   `printf '…\n…\n' | PENSMITH_PROMPT_MODE=numbered pensmith sketch` (RUN-12).
   Without a terminal, scripted answers or `--yolo`, the confirm below can never be
   answered, so sketch refuses BEFORE the first question (exit 3, nothing asked or
   created; the refusal names `PENSMITH_PROMPT_MODE=numbered`). Piped stdin is read
   only in that mode (D-17-36), never guessed from a pipe. Synthesize
   the answers into a single candidate thesis sentence and print it. (A
   pre-supplied `--thesis` skips the loop — the one-shot / test-seam path.)
   CRITICAL: nothing in this step creates `.paper/` / STATE.json / LIBRARY.json.

2. **Confirm gate** — `sketch-confirm` in the one gate registry
   (`bin/lib/gates.ts`, RUN-28, PRD §7.20; approval-gates-default-on): present the
   candidate thesis and ask `Proceed to intake with this thesis?` (default no).
   `--yolo` takes the registry's choice (proceed to intake); a pre-supplied
   `--confirm` (test seam) wins over both. On DECLINE: `sketch cancelled — nothing
   was created; re-run to try again` (exit 3, EXIT_APPROVAL) WITHOUT creating ANY
   state (the no-advance invariant — Pitfall 6). Only the Socratic content
   questions of step 1 are asked directly (`ask()` — the gate-registry chokepoint
   allows sketch that).

3. **Dispatch `new` with the thesis seed** (Open-Q2): ONLY after confirm,
   dispatch the existing `new` verb via `dispatchVerb('new', { args: { thesis },
   globalFlags: { yolo, dryRun } })`. `new` is the single state-init site; sketch
   never calls `initState` itself. The thesis is forwarded so it is not dropped
   (`intake --thesis` pre-fills the intake brief — NOT a new verb).

4. **Shell fallback** (TIER-06 equivalence path): `pensmith sketch [--yolo]
   [--dry-run]`. `--yolo` auto-confirms; `--dry-run` makes zero external API
   calls.
