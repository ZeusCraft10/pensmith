---
description: "Work on an academic paper in natural language. Trigger phrases (PRD §5.4): \"start my paper\", \"I have an essay to write on X\", \"begin writing\", \"write the next section\", \"continue\", \"what's next?\", \"where am I?\", \"continue where I left off\", \"resume\", \"resume my paper\", \"put it all together\", \"make it sound less AI\". Also handles a bare /pensmith (no verb) — routes to the correct next step automatically from paper state. \"where am I?\"/\"what's next?\" → status; \"resume\"/\"continue where I left off\" → resume; \"write the next section\"/\"continue\" → next; \"make it sound less AI\" → done (humanize under done); \"compile\"/\"put it all together\" → compile."
name: pensmith
---

# pensmith — primary natural-language routing skill

This skill is the porcelain entry point. It carries no workflow logic of its
own: it routes a natural-language message (or a bare `/pensmith`) to ONE of the
locked-16 verbs and lets that verb's workflow body do the work.

## Bare `/pensmith` is state-aware

A bare `/pensmith` (no verb) resolves the next pending action from paper state.
The single source of truth for that decision is `bin/lib/router.ts`
(`resolveNextAction`), which reads `STATE.json` + each section's `PLAN.md`
frontmatter and returns the next WORK verb. This skill body MUST delegate to
that same `resolveNextAction` decision table — do NOT duplicate the routing
logic here. (Tier-2 CLI runs the identical `resolveNextAction`; Tier-1 reaches
it via the bare-command dispatch in `bin/pensmith.ts`.)

## Natural-language → verb (PRD §5.4)

| The user says… | Route to |
| --- | --- |
| "where am I?" / "what's next?" | `pensmith status` |
| "resume" / "continue where I left off" | `pensmith resume` |
| "write the next section" / "continue" | `pensmith next` (plan → write → verify of the next incomplete section) |
| "make it sound less AI" | `pensmith done` (the humanizer runs as part of the done gate) |
| "compile" / "put it all together" | `pensmith compile` |
| anything that just means "do the next thing" | the bare state-aware route above |

"make it sound less AI" maps to the done/humanize path — the humanizer improves
prose; it is never framed as evading detection (CLAUDE.md honest-framing
non-negotiable).

## Non-negotiables this skill honors

- **Single-command UX.** `/pensmith` is the only command taught in the README;
  the verb shortcuts and the `/pensmith:*` plumbing namespace are power-user
  fallbacks (CLAUDE.md).
- **No 17th verb.** Every route above targets one of the locked-16 verbs. Inline
  corrections (length change, add/drop section, swap source, redo) ride the
  EXISTING `pensmith plan` / `plan --revise` path — see `skills/plan-section.md`.
