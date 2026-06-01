# pensmith new

> Start a new paper project — capture the assignment, run the clarifying battery,
> detect the discipline, and persist a structured `INTAKE.md` for downstream verbs.
>
> CYCLE-3 NAMING NOTE: per Plan 06 REVIEWS CONVERGENCE, the canonical user-facing verb is
> `pensmith intake`; `pensmith new` is a friendly alias mapped by the bin/cli/index.ts
> dispatcher (Plan 07). This workflow file is named `new.md` to remain bijective with the
> UX-02 16-verb canonical list (bin/lib/verbs.ts) that ARCH-01 (workflows-keyequal.test.ts)
> enforces; when Plan 07 renames the verb in `verbs.ts`, this file will move to
> `workflows/intake.md`. Until then, this file *is* the intake workflow body.

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: read response from stdin in Tier 2
</capability_check>

## Overview

`pensmith new` (canonical alias: `pensmith intake`) bootstraps a paper project from an
assignment text + a discipline-aware clarifying battery. It is the front door of the
workflow: intake → research → outline → (plan → write → verify)* → compile.

The implementation lives in `bin/cli/intake.ts` (created by Plan 07). The workflow body
below is the prompt that drives the verb's behavior under both Tier 1 (Task/MCP) and
Tier 2 (shell) — the `<capability_check>` block above degrades the Tier-1 affordances
to a Tier-2 shell invocation when those tools are unavailable, preserving TIER-06
equivalence.

## Steps

1. (see Body below — `## Body` is the executable prompt; the steps above are just an overview)

## Outputs

- `.paper/INTAKE.md` — clarified assignment + discipline + tone + citation style (committed)
- `.paper/INTAKE.raw.local` — raw answers before PII redaction (gitignored, never committed)

## Body

1. **Read inputs**:
   - Assignment text from `.paper/INTAKE.md` if present, else prompt user (or read `--from <file>`).
   - `templates/presets/disciplines.json` (the 9 INTK-03 keys: 8 disciplines + explicit `other` fallback per Plan 05 Task 5.3).
   - `templates/prompts/intake-clarifier.md` (D-12 LOCKED slug — the prompt template; interpolate `{{assignment}}`).

2. **Detect discipline** (heuristic match assignment keywords against the 9 disciplines.json keys; fall back to `"other"` → which itself maps to `tone: "academic-formal"` + `citation_style: "apa"` for unrecognized inputs).

3. **Run clarifying battery** (INTK-02):
   - If Task/MCP available (Tier 1): delegate to model with `templates/prompts/intake-clarifier.md` (D-12 LOCKED slug — the canonical slug per Plan 03 CONTEXT D-12).
   - If `AskUserQuestion` available (Tier 1): present 3–5 questions via that tool.
   - Tier 2 fallback: write questions to stdout, read answers from stdin via `@clack/prompts` (`bin/lib/prompts.ts` from Phase 2).

4. **Apply PII redaction** (INTK-05): before persisting answers, run the user's RAW ANSWERS through `bin/lib/pii.ts redactPII(answer)`.

   PII redaction ordering (Codex MEDIUM consensus #18 — locked):
   - PII redaction operates on the **user's answers only**, NEVER on the prompt template or the LLM-generated questions (those are pensmith-controlled strings with no user PII).
   - Sequence: (a) prompt user, (b) collect raw answer string, (c) `redactPII(answer)`, (d) persist redacted answer to `.paper/INTAKE.md` AND a separate `.paper/INTAKE.raw.local` file (gitignored — never committed) for the user's own forensics.
   - The redactor processes input in this **deterministic order**:
     ```
     EMAIL → PHONE → SSN-LIKE → CREDIT-CARD-LIKE → URL_WITH_QUERY → IP_ADDRESS → IBAN_LIKE
     ```
     Multi-pattern coverage matters: redacting EMAIL last would cause `foo@bar.com` in a URL to slip through PHONE-shaped regex; processing EMAIL first ensures clean tokenization. `tests/pii.test.ts` asserts ordering by feeding `foo@bar.com (+1-555-555-5555)` and asserting the result is `[REDACTED-EMAIL] (+[REDACTED-PHONE])` (NOT `[REDACTED-PHONE]` swallowing the email).

5. **Write `.paper/INTAKE.md`** (atomic via `bin/lib/atomic-write.ts`, the D-07 chokepoint) with the clarified assignment + discipline + tone + citation style. Persist the un-redacted RAW answers to `.paper/INTAKE.raw.local` (gitignored).

6. **Shell fallback** (TIER-06 equivalence path): `pensmith intake [--from <file>] [--yolo]` (alias: `pensmith new [--from <file>] [--yolo]` — both invocations dispatch to the same `bin/cli/intake.ts` handler).
