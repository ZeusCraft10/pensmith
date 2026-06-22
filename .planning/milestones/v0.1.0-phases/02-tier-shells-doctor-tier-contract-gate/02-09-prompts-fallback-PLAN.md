---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 09
type: execute
wave: 2
depends_on: ["02-00"]
files_modified:
  - bin/lib/prompts.ts
  - bin/lib/prompts/schema.ts
  - bin/lib/prompts/clack.ts
  - bin/lib/prompts/numbered.ts
  - tests/prompts-schema.test.ts
  - tests/prompts-numbered.test.ts
  - tests/prompts-shape.test.ts
autonomous: true
requirements: [TIER-05]
must_haves:
  truths:
    - "bin/lib/prompts.ts exports a single `ask(question: PromptQuestion, opts?): Promise<PromptAnswer>` entry point that all Tier 2 verbs use (including the not-yet-shipped intake / outline / sketch flows in Phase 3+)"
    - "ask() returns the SAME shape regardless of whether @clack/prompts was reachable or the stdin numbered fallback fired — Tier-1 (AskUserQuestion) and Tier-2 (clack OR numbered) all converge on PromptAnswer"
    - "When stdout is a TTY, ask() delegates to @clack/prompts (intro / select / text / multiselect) per TIER-05 'TTY mode'"
    - "When stdout is NOT a TTY (piped, captured, CI), ask() falls back to the stdin numbered-prompt mode — schema matches gsd-plugin's `--text JSON question schema` (one question object per line, answer one number or string per line)"
    - "The numbered mode writes the question + numbered options to stderr (NEVER stdout — stdout is reserved for tier-contract-comparable JSON output downstream), reads ONE line from stdin per question, parses the user's answer back into the PromptAnswer shape"
    - "PromptQuestion is a discriminated union over {select, multiselect, text, confirm}; PromptAnswer is `{ kind, value }` with kind echoing the input kind so tier-contract tests can assert symmetric shapes"
    - "The numbered fallback NEVER calls @clack/prompts (avoids the clack-1.x vs clack-0.7 character drift documented in 02-RESEARCH Pitfall 11)"
    - "ask() honors a `PENSMITH_PROMPT_MODE` env override (`clack` | `numbered` | `auto`) so tests can force a path without needing a fake TTY — default is `auto` (TTY → clack, non-TTY → numbered)"
    - "On EOF (stdin closes before an answer arrives), ask() rejects with a typed `PromptAbortedError` — caller chooses whether to retry or exit; ask() itself does NOT call process.exit()"
    - "Per-question timeout (default 5 min, override via `PENSMITH_PROMPT_TIMEOUT_MS`) rejects with a typed `PromptTimeoutError` rather than hanging the CLI forever"
    - "Confirm prompts default-on for approval gates per PRD §14 non-negotiable; numbered mode renders [y]/n / [Y/n] consistent with --yolo NOT being a prompt setting"
  artifacts:
    - path: "bin/lib/prompts.ts"
      provides: "Public surface: ask(), PromptQuestion union, PromptAnswer, PromptAbortedError, PromptTimeoutError. Dispatcher only — no I/O lives here."
      contains: "export async function ask"
    - path: "bin/lib/prompts/schema.ts"
      provides: "Zod schemas + types for PromptQuestion (select / multiselect / text / confirm) and PromptAnswer. The numbered fallback parses raw stdin lines through these schemas; clack mode constructs the same shapes from clack's typed primitives."
      contains: "PromptQuestionSchema"
    - path: "bin/lib/prompts/clack.ts"
      provides: "TTY delegate — wraps @clack/prompts intro/outro/select/multiselect/text/confirm. Converts clack's CANCEL_SYMBOL into PromptAbortedError. The ONLY file in this plan that imports '@clack/prompts'."
      contains: "import { select, multiselect, text, confirm, isCancel } from '@clack/prompts'"
    - path: "bin/lib/prompts/numbered.ts"
      provides: "Pure stdin numbered fallback — reads from process.stdin via node:readline createInterface, writes to process.stderr. No clack import. Tests pump fake streams in to exercise it."
      contains: "createInterface"
    - path: "tests/prompts-schema.test.ts"
      provides: "Zod parses good shapes; rejects bad (e.g., `kind:'select'` with no options array; `kind:'text'` with options field)"
    - path: "tests/prompts-numbered.test.ts"
      provides: "Stream-driven tests: select / multiselect / text / confirm — happy path, out-of-range index, blank line on text/confirm, EOF mid-question (→ PromptAbortedError), per-question timeout (→ PromptTimeoutError)"
    - path: "tests/prompts-shape.test.ts"
      provides: "Shape parity test — same PromptQuestion fed to both modes produces the same PromptAnswer.kind; numbered mode's value field is round-trippable via the zod schema (regression guard for the schema drift hypothesised in TIER-07's ±20% tolerance)"
  key_links:
    - from: "bin/lib/prompts.ts"
      to: "bin/lib/prompts/schema.ts"
      via: "import { PromptQuestion, PromptAnswer, PromptQuestionSchema }"
      pattern: "PromptQuestion"
    - from: "bin/lib/prompts.ts"
      to: "bin/lib/prompts/clack.ts"
      via: "dynamic import('./prompts/clack.js') ONLY when mode === 'clack' — so the numbered path never pays the clack startup cost on non-TTY pipelines"
      pattern: "import\\(.*clack"
    - from: "bin/lib/prompts.ts"
      to: "bin/lib/prompts/numbered.ts"
      via: "static import — numbered fallback is the always-available path"
      pattern: "from\\s+'\\./prompts/numbered"
    - from: "bin/lib/prompts/clack.ts"
      to: "@clack/prompts ^0.7"
      via: "named imports — select / multiselect / text / confirm / isCancel"
      pattern: "@clack/prompts"
    - from: "tests/prompts-numbered.test.ts"
      to: "bin/lib/prompts/numbered.ts"
      via: "fake stdin via stream.PassThrough — exercise EOF + timeout deterministically"
      pattern: "PassThrough"
---

<objective>
Ship the Tier 2 fallback for AskUserQuestion per **TIER-05** (REQUIREMENTS.md, lines 47):
`@clack/prompts` for the interactive TTY path AND a stdin numbered-prompt mode whose
schema matches `gsd-plugin`'s `--text` JSON question schema for the headless / piped /
CI case. The two paths converge on a single `PromptAnswer` shape so Phase 3+ verbs
can call `ask(...)` once without caring which transport actually rendered the prompt.

Per the discuss-phase scope-honesty decision (logged in this revision iteration):
**build it now in Phase 2** rather than deferring to Phase 7's UX wave. The reason is
load-bearing: 02-05's `bin/cli/doctor.ts` is read-only and does not need prompts, BUT
the tier-contract test in 02-07 has to be runnable in non-interactive CI on three OSes
without ever blocking on a hidden `clack` prompt. Shipping the numbered fallback now
means every Phase 3+ verb (intake clarifying questions per INTK-02, outline approval
per OUTL-03, export confirmation per DONE-09) can be added without re-litigating the
fallback strategy.

This plan is intentionally a Wave 2 sibling (alongside 02-04 mcp-server, 02-05 cli-doctor,
02-06 hooks-workflows) — it depends only on Wave 0's `@clack/prompts` dependency install
(02-00 Wave 0 already adds `@clack/prompts ^0.7` to package.json per TIER-05 build-now
decision) and is otherwise standalone. Wave 3's tier-contract test does not gate on this
plan because doctor itself is read-only, but Phase 3's intake plan **will** consume
`bin/lib/prompts.ts` directly.

Per **D-12** carry-forward symmetry: prompts/clack.ts is NOT in the `mcp/` subtree — the
capabilities-no-leak lint chokepoint does not apply here. But the same _shape_
discipline applies — prompts MUST NOT echo back the user's input to a log line that
would leak through `.paper/SESSION.log` if a future verb passes a secret through a
text prompt. Tests in this plan assert that PromptAnswer.value is never automatically
logged by the prompts module itself.

Per **Pitfall 11** (RESEARCH.md): `@clack/prompts` ships at 0.7 (pinned) but the registry
current is 1.4. The numbered fallback path NEVER imports clack, so a future bump to 1.4
cannot break headless mode. The clack delegate is the only file in this repo that
imports `@clack/prompts`; tests assert this via grep (single-source-of-truth invariant).

Per **ARCH-11** (forward): when the Phase 7 `--yolo` flag lands, it MUST be checked by
the _calling verb_ before invoking `ask()` — `ask()` itself never short-circuits. The
prompt module's contract is "render the question, return the answer or abort"; the
approval-skip discipline is a verb-level policy (UX-02 / ERGO-03 / PRD §14). This plan
documents the boundary so Phase 7 doesn't end up sprinkling `if (yolo) skip` inside
prompts.ts.

Output: a single `ask()` callable from any future Tier 2 verb that produces
TTY-friendly clack prompts when stdout is a TTY and a deterministic, scriptable
numbered-prompt protocol otherwise. Shape parity tested. CI-safe on all 3 OSes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-00-review-cleanup-PLAN.md
@bin/lib/paths.ts
@bin/lib/session-log.ts

<read_first>
Before writing any code in this plan, re-read:

- `.planning/REQUIREMENTS.md` **TIER-05** (lines 47): the spec describes "@clack/prompts
  with stdin numbered-prompt mode matching gsd-plugin's `--text` JSON question schema".
  The schema is the load-bearing detail — without it the Phase 3 intake clarifying
  questions can't be scripted from a CI fixture.
- `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md`
  **Pitfall 11** (`@clack/prompts` version drift between tiers): the JSON-output
  surface is the only thing tier-contract compares — clack version cannot affect it.
- `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-12:
  capabilities-no-leak symmetry (NOT lint-applicable here but the discipline carries).
- `bin/lib/session-log.ts`: a future verb might write a prompt answer to the session
  log. Confirm the log API surface (`writeSessionEvent` or equivalent — re-read for
  exact name) so the prompts module documents but does NOT enforce session-log
  redaction (that's a caller responsibility per PRD §16 PII redaction).
- `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-00-review-cleanup-PLAN.md`
  Wave 0 — confirm `@clack/prompts` is listed in package.json dependencies after 02-00
  ships; this plan assumes the dep install is already complete.
- gsd-plugin (`/tmp/refs/gsd-plugin` if present, else github.com/jnuyens/gsd-plugin):
  search for `--text` flag handlers, the JSON question schema shape, and any
  stdin-numbered-prompt parser already canonicalised there. If the reference repo is
  empty (shallow clone), interpret the requirement as: one JSON object per question
  describing kind + label + options + (optional) default; one stdin line per answer
  containing either a 1-based index (select / multiselect comma-separated) or a raw
  string (text / confirm). Match that shape in `bin/lib/prompts/schema.ts`.
</read_first>

<interfaces>
<!-- Public types — these are the source of truth Phase 3+ verbs depend on. -->

```typescript
// bin/lib/prompts/schema.ts
import { z } from 'zod';

// Discriminated union by `kind`. Keep field names matching gsd-plugin's --text schema
// (id, label, options, default) so an upstream CI fixture can feed identical JSON
// to either tier and get identical answers back.

export const SelectQuestionSchema = z.object({
  id: z.string().min(1),                // stable identifier (used in answer log)
  kind: z.literal('select'),
  label: z.string().min(1),             // human-readable prompt text
  options: z.array(z.object({
    value: z.string().min(1),           // canonical machine value
    label: z.string().min(1),           // human-readable rendition
    hint: z.string().optional(),
  })).min(1),
  default: z.string().optional(),       // option.value of the default; presented as "[default: <label>]"
});

export const MultiSelectQuestionSchema = SelectQuestionSchema.extend({
  kind: z.literal('multiselect'),
  default: z.array(z.string()).optional(),
});

export const TextQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('text'),
  label: z.string().min(1),
  default: z.string().optional(),
  placeholder: z.string().optional(),
});

export const ConfirmQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('confirm'),
  label: z.string().min(1),
  default: z.boolean().optional(),      // [Y/n] vs [y/N]
});

export const PromptQuestionSchema = z.discriminatedUnion('kind', [
  SelectQuestionSchema,
  MultiSelectQuestionSchema,
  TextQuestionSchema,
  ConfirmQuestionSchema,
]);

export type PromptQuestion = z.infer<typeof PromptQuestionSchema>;

// Answers: kind echoes the question kind so the consumer can switch on it without
// re-fetching the question. value type narrows by kind.
export type PromptAnswer =
  | { id: string; kind: 'select';      value: string }
  | { id: string; kind: 'multiselect'; value: string[] }
  | { id: string; kind: 'text';        value: string }
  | { id: string; kind: 'confirm';     value: boolean };
```

```typescript
// bin/lib/prompts.ts — public entry point.

export class PromptAbortedError extends Error { readonly id: string; constructor(id: string) { ... } }
export class PromptTimeoutError extends Error { readonly id: string; readonly timeoutMs: number; ... }

export interface AskOptions {
  /** Override the mode detection. Defaults to env PENSMITH_PROMPT_MODE or 'auto'. */
  mode?: 'auto' | 'clack' | 'numbered';
  /** Per-question timeout in ms. Defaults to env PENSMITH_PROMPT_TIMEOUT_MS or 5 min. */
  timeoutMs?: number;
  /** Streams (test-injection). Defaults to process.stdin / process.stderr. */
  stdin?: NodeJS.ReadableStream;
  stderr?: NodeJS.WritableStream;
}

export async function ask(question: PromptQuestion, opts?: AskOptions): Promise<PromptAnswer>;
```

<!-- Numbered fallback wire protocol (schema-by-example): -->

Question sent to user (rendered on stderr):

```text
[pensmith] Which discipline preset should I use? (select)
  1) cs       — Computer science (APA + arXiv-heavy)
  2) bio      — Biological sciences (CSE + PubMed-heavy)
  3) history  — History (Chicago notes-bib)
  4) other    — Pick a custom style
[default: 1]  Enter a number 1-4:
```

User types `2\n` on stdin → returns `{ id: 'discipline', kind: 'select', value: 'bio' }`.

For multiselect, user types `1,3\n` → returns `value: ['cs', 'history']`.
For text, user types raw string (blank line keeps default).
For confirm, user types `y` / `Y` / `yes` / `n` / `N` / `no` / blank-keeps-default.

The numbered renderer writes to stderr (not stdout) so callers can still pipe the
process's stdout to a downstream tool without contaminating it with prompt UI text.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Zod schemas + types — bin/lib/prompts/schema.ts + tests/prompts-schema.test.ts</name>
  <files>bin/lib/prompts/schema.ts, tests/prompts-schema.test.ts</files>
  <read_first>
    - `bin/lib/schemas/state.ts` (if present from 01-10 or 02-04) — match the zod
      idioms already established: `z.object` + flat-record `z.discriminatedUnion`
      shape so Tier 1 tools can reuse these schemas in 02-04's tool inputs if
      a future tool exposes prompt-driven state changes (e.g., `paper_advance_section`
      with confirmation).
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md`
      Pitfall 2 (zod 3 flat-record vs z.object — relevant because MCP tool inputs
      use the flat-record form; here we use z.object because we want a discriminated
      union which the SDK doesn't constrain).
    - `package.json` — confirm `zod` is already a dep (it is — Phase 1 pinned it).
  </read_first>
  <behavior>
    Export `PromptQuestionSchema` as a `z.discriminatedUnion('kind', [...])`, plus the
    four sub-schemas (`SelectQuestionSchema`, `MultiSelectQuestionSchema`,
    `TextQuestionSchema`, `ConfirmQuestionSchema`), plus the inferred type
    `PromptQuestion`. Also export `PromptAnswer` as a hand-written discriminated
    union type (NOT zod-inferred — answers are produced by trusted code paths
    inside this module, never parsed from untrusted JSON, so a runtime schema is
    not necessary; the type system is sufficient for caller safety).

    Tests (`tests/prompts-schema.test.ts`):
    1. Valid select with 4 options + default → parses OK.
    2. Select with empty options array → rejected (`.min(1)`).
    3. Select missing `id` → rejected.
    4. Text with an `options` field → rejected (discriminated union enforces field
       presence per branch).
    5. Multiselect with `default: 'string'` (instead of array) → rejected.
    6. Confirm with `default: 'yes'` (instead of boolean) → rejected.
    7. Confirm with `default: true` and no `default` key omitted from any branch →
       both parse OK.
    8. Multiselect with `default: ['cs', 'history']` (array of strings) → parses OK.
  </behavior>
  <action>
    Write `bin/lib/prompts/schema.ts` exactly as sketched in the `<interfaces>`
    block above. Add a small JSDoc comment at the top citing TIER-05 and pointing
    at the numbered protocol described in this plan's `<interfaces>` section so
    a future reader has the wire format documented next to the schema.

    Write `tests/prompts-schema.test.ts` using `node:test` + `node:assert/strict`,
    matching the established style in `tests/runtime.test.ts` (Phase 1's most
    recent zod-schema test). For each negative case, use `assert.equal(parsed.success, false)`
    and assert the issue path/message is in the result.

    Self-check:
    - `grep -c "z.discriminatedUnion" bin/lib/prompts/schema.ts` returns 1.
    - `node scripts/run-tests.mjs tests/prompts-schema.test.ts` exits 0.
    - The file is < 100 LOC (a tight schema, no logic).
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; node scripts/run-tests.mjs tests/prompts-schema.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bin/lib/prompts/schema.ts` exists and exports `PromptQuestionSchema`,
      the four sub-schemas, the `PromptQuestion` inferred type, and the
      hand-written `PromptAnswer` type.
    - 8 schema cases (4 happy / 4 negative) all green in `tests/prompts-schema.test.ts`.
    - `npm run lint` + `npm run typecheck` pass.
  </acceptance_criteria>
  <done>
    The wire schema is locked. Tasks 2 and 3 consume it as the only contract
    between caller and prompts module.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Numbered-prompt fallback — bin/lib/prompts/numbered.ts + tests/prompts-numbered.test.ts</name>
  <files>bin/lib/prompts/numbered.ts, tests/prompts-numbered.test.ts</files>
  <read_first>
    - `bin/lib/prompts/schema.ts` (after Task 1)
    - Node.js `readline.createInterface` docs (built-in) for `crlfDelay` + `terminal: false`
      to avoid swallowing answers on Windows.
    - `tests/session-log.test.ts` (from 01-09) — how Phase 1 tests use `PassThrough`
      to inject deterministic streams.
  </read_first>
  <behavior>
    `bin/lib/prompts/numbered.ts` exports:

    ```typescript
    export interface NumberedAskOptions {
      stdin?: NodeJS.ReadableStream;        // default: process.stdin
      stderr?: NodeJS.WritableStream;       // default: process.stderr
      timeoutMs?: number;                   // default: env PENSMITH_PROMPT_TIMEOUT_MS or 5 min
    }
    export async function askNumbered(
      question: PromptQuestion,
      opts?: NumberedAskOptions,
    ): Promise<PromptAnswer>;
    ```

    Behavior:
    - Writes a formatted question (per the `<interfaces>` block's wire-protocol
      sketch) to `stderr`.
    - Reads exactly one `\n`-terminated line from `stdin` via
      `readline.createInterface({ input, output: undefined, terminal: false, crlfDelay: Infinity })`.
      `terminal: false` is required so Windows + piped stdin don't try to render
      a prompt char that swallows the first keystroke.
    - Parses the line according to `question.kind`:
      - **select**: 1-based integer index; out-of-range → re-prompt up to 3 times,
        then reject with `PromptAbortedError`.
      - **multiselect**: comma-separated 1-based integers (e.g. `1,3,4`); whitespace
        ignored; duplicates collapsed; empty input → default (or empty if no default).
      - **text**: raw string; empty line → default (or empty if no default).
      - **confirm**: `y/Y/yes` → true; `n/N/no` → false; empty → default
        (or false if no default).
    - On `'close'` or `'end'` before a line arrives → reject with `PromptAbortedError`.
    - On `setTimeout(timeoutMs)` firing before a line arrives → reject with
      `PromptTimeoutError` AND close the readline interface to free the listener.
    - NEVER calls `process.exit()`.

    Tests (`tests/prompts-numbered.test.ts`) — use `stream.PassThrough` for stdin
    and a `Writable` collector for stderr; pump `\n`-terminated lines in:

    1. select happy path: 4 options, push `2\n` → returns `value: <option[1].value>`.
    2. select out-of-range × 3 → `PromptAbortedError`.
    3. multiselect: push `1,3\n` → returns `value: [opt1.value, opt3.value]`.
    4. multiselect blank line + default → returns default array.
    5. text happy path: push `hello world\n` → returns `value: 'hello world'`.
    6. text blank with default → returns default.
    7. confirm `y\n` → true; `n\n` → false; blank with `default: true` → true; blank no default → false.
    8. EOF mid-question (`stdin.end()` before any line) → `PromptAbortedError` with `id` field set.
    9. Timeout: set `timeoutMs: 50`, never write to stdin → `PromptTimeoutError`
       fires within 100ms.
    10. The stderr collector contains the question label AND the numbered option list
        AND the `[default: ...]` indicator when applicable.
    11. The stderr collector NEVER contains the resolved value of the answer (no echo).
    12. Stdout was never touched (the test's `process.stdout` is monkey-patched to a
        no-write asserter for the duration of the test, OR the test runs in a worker
        with stdout piped to /dev/null).
  </behavior>
  <action>
    Implement `bin/lib/prompts/numbered.ts`. Key choices to document inline:

    - Use `readline.createInterface({ input, terminal: false, crlfDelay: Infinity })`
      with NO `output` option (we render the question ourselves to stderr; readline
      only reads). `crlfDelay: Infinity` collapses `\r\n` on Windows into a single
      line event.
    - Use `rl.once('line', resolve)` and `rl.once('close', () => reject(...))`.
      Both listeners share the same Promise so whichever fires first wins.
    - The 3-retry loop for out-of-range select / multiselect: each retry writes a
      short "out of range, try again:" message to stderr (NOT a re-render of the
      whole option list — that would spam the terminal).
    - Render the option list as `  1) <value>  — <label>` so machine-readable
      consumers can grep `^\s*\d+\)` to extract the options. Hints (option.hint)
      are rendered on the next line indented by 5 spaces.
    - `[default: <label>]` is appended to the prompt line for select / text / confirm
      when applicable; multiselect default is shown as `[default: <label1>, <label2>]`.

    Tests: use `PassThrough` for stdin; create with `{ allowHalfOpen: true }` so we
    can pump lines and then `.end()` to simulate EOF. Use `Writable` with a `_write`
    that appends to a buffer for stderr. NEVER use `child_process.spawn` for these
    tests — they're unit tests against the function, not integration tests.

    Notes for executor:
    - On Windows, `\r\n` line endings can show up; `crlfDelay: Infinity` fixes it
      but tests should push `\n` to be exact about what they're testing.
    - Do NOT use `process.stdin.setRawMode(true)` — that's TTY-only and would
      reintroduce the cancel-on-Ctrl-C reflex that `@clack/prompts` handles.
      Numbered mode is line-oriented; Ctrl-C lands as SIGINT which Node handles
      with its default handler (exit code 130). That's acceptable for headless mode.
    - The `PromptAbortedError` and `PromptTimeoutError` classes live in
      `bin/lib/prompts.ts` (Task 3) — for Task 2, import them from there as a
      forward reference; if Task 2 lands before Task 3 in the executor's order,
      stub the imports as `class PromptAbortedError extends Error {}` placeholders
      in `numbered.ts` and replace with the real imports during Task 3.

    Self-check:
    - `grep -c "createInterface" bin/lib/prompts/numbered.ts` >= 1.
    - `grep -c "terminal: false" bin/lib/prompts/numbered.ts` == 1.
    - `grep -c "process\\.exit\\|process\\.stdout" bin/lib/prompts/numbered.ts` == 0
      (numbered fallback writes to stderr only; never to stdout, never exits).
    - `node scripts/run-tests.mjs tests/prompts-numbered.test.ts` exits 0 with 12 tests.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; node scripts/run-tests.mjs tests/prompts-numbered.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bin/lib/prompts/numbered.ts` exists and exports `askNumbered`.
    - 12 tests cover happy path, out-of-range × 3 → abort, EOF → abort, timeout,
      defaults, stderr-only output, no stdout writes.
    - No `process.exit()` calls anywhere in the file.
    - No `@clack/prompts` import in the file (`grep -c "@clack/prompts" bin/lib/prompts/numbered.ts` == 0).
    - All tests run < 5s total even with the 50ms timeout case.
  </acceptance_criteria>
  <done>
    Headless mode shipped. Phase 3 INTK-02 clarifying questions can be fed from a
    cassette without any TTY emulation.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Public ask() dispatcher + clack delegate + shape-parity test — bin/lib/prompts.ts, bin/lib/prompts/clack.ts, tests/prompts-shape.test.ts</name>
  <files>bin/lib/prompts.ts, bin/lib/prompts/clack.ts, tests/prompts-shape.test.ts</files>
  <read_first>
    - `bin/lib/prompts/schema.ts` (Task 1)
    - `bin/lib/prompts/numbered.ts` (Task 2)
    - `node_modules/@clack/prompts/package.json` — confirm v0.7's API: named exports
      `select`, `multiselect`, `text`, `confirm`, `isCancel`, symbol `CANCEL_SYMBOL`.
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md`
      Pitfall 11 (clack version drift).
  </read_first>
  <behavior>
    `bin/lib/prompts.ts` exports:
    - `ask(question, opts?)` — see `<interfaces>` block.
    - `PromptAbortedError` (id: string).
    - `PromptTimeoutError` (id: string, timeoutMs: number).
    - Re-exports `PromptQuestion` and `PromptAnswer` from `./prompts/schema.js`.

    `ask()` algorithm:
    1. Resolve `mode`: `opts.mode ?? process.env.PENSMITH_PROMPT_MODE ?? 'auto'`.
    2. If `mode === 'auto'`: pick `'clack'` when `process.stdout.isTTY` is `true`
       AND `process.stderr.isTTY` is `true`; else `'numbered'`. (Both must be TTY
       so clack's redraw works correctly.)
    3. If `mode === 'clack'`: `await import('./prompts/clack.js')` (dynamic so the
       headless path doesn't load clack), call `askClack(question, opts)`.
    4. If `mode === 'numbered'`: call `askNumbered(question, opts)` (static import).
    5. Wrap the chosen path in `Promise.race` against a per-question timeout if
       opts.timeoutMs is set AND the inner path doesn't already implement timeout
       (numbered does; clack doesn't — clack has its own SIGINT handling).

    `bin/lib/prompts/clack.ts` exports `askClack(question, opts)`:
    - Switches on `question.kind` and calls the matching `@clack/prompts` primitive.
    - `isCancel(result)` → throw `PromptAbortedError(question.id)`.
    - For `select` / `multiselect`: maps `question.options` to clack's
      `{ value, label, hint }` shape.
    - For `text`: passes `placeholder` + `initialValue` (default).
    - For `confirm`: passes `initialValue` (default).
    - Returns a `PromptAnswer` of the matching kind.

    `tests/prompts-shape.test.ts` (the load-bearing parity test for TIER-05):
    1. For each of the four kinds, define a small question fixture, run BOTH
       `askNumbered` (with a fake stdin) and `askClack` (with a mocked clack
       module — `node:module` `createRequire` + an import-map shim, OR just
       call the same path twice via `PENSMITH_PROMPT_MODE` override). Assert
       both paths produce a `PromptAnswer` with the same `kind` and same
       `value` for the same input.
    2. Assert `ask({ id, kind, ... })` with `mode: 'numbered'` and the same
       stdin produces the same answer as a direct `askNumbered` call (sanity
       check that the dispatcher doesn't mutate or wrap).
    3. Assert that `PENSMITH_PROMPT_MODE=clack` overrides TTY detection — set
       the env var, force `process.stdout.isTTY = false` temporarily, run
       `ask(...)` with a fake stdin, and assert the clack path runs (probe by
       e.g. spy on the clack module's `select` export — easiest via a custom
       Loader hook OR by intercepting via `vi.mock` style; if that's painful,
       skip this assertion and rely on integration testing in Phase 3+).
    4. Assert `grep -c "@clack/prompts" bin/lib/prompts.ts` == 0 (the public
       entry point doesn't import clack directly; it always goes through
       `./prompts/clack.ts`).
    5. Assert `grep -c "@clack/prompts" bin/lib/prompts/numbered.ts` == 0
       (numbered path never imports clack).
    6. Assert `grep -rc "@clack/prompts" bin/lib/prompts/` returns "clack.ts" as
       the only file mentioning the dep.

    Notes:
    - Asserts 4-6 above can be written as a plain `readFileSync` + regex check
      inside the test — they're invariant checks, not behavioral.
  </behavior>
  <action>
    **Step A — `bin/lib/prompts.ts`** (the public entry point):

    ```typescript
    // bin/lib/prompts.ts
    //
    // TIER-05: Tier 2 fallback for AskUserQuestion.
    //   - TTY (auto-detected via process.stdout.isTTY && process.stderr.isTTY):
    //     delegate to @clack/prompts via bin/lib/prompts/clack.ts.
    //   - non-TTY (piped, CI, captured): stdin numbered-prompt mode via
    //     bin/lib/prompts/numbered.ts. Question protocol matches gsd-plugin's
    //     `--text` JSON schema (see ./prompts/schema.ts).
    //
    // Pitfall 11 (02-RESEARCH): clack version drift would break tier-contract
    // tests if both paths went through clack — the numbered path stays
    // dependency-free for exactly this reason.

    import { askNumbered } from './prompts/numbered.js';
    import type { PromptQuestion, PromptAnswer } from './prompts/schema.js';

    export { PromptQuestionSchema } from './prompts/schema.js';
    export type { PromptQuestion, PromptAnswer } from './prompts/schema.js';

    export class PromptAbortedError extends Error {
      readonly id: string;
      constructor(id: string) {
        super(`prompt aborted: ${id}`);
        this.id = id;
        this.name = 'PromptAbortedError';
      }
    }

    export class PromptTimeoutError extends Error {
      readonly id: string;
      readonly timeoutMs: number;
      constructor(id: string, timeoutMs: number) {
        super(`prompt timed out after ${timeoutMs}ms: ${id}`);
        this.id = id;
        this.timeoutMs = timeoutMs;
        this.name = 'PromptTimeoutError';
      }
    }

    export interface AskOptions {
      mode?: 'auto' | 'clack' | 'numbered';
      timeoutMs?: number;
      stdin?: NodeJS.ReadableStream;
      stderr?: NodeJS.WritableStream;
    }

    function resolveMode(opts?: AskOptions): 'clack' | 'numbered' {
      const explicit = opts?.mode ?? (process.env.PENSMITH_PROMPT_MODE as AskOptions['mode']);
      if (explicit === 'clack' || explicit === 'numbered') return explicit;
      const isTty = Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
      return isTty ? 'clack' : 'numbered';
    }

    export async function ask(question: PromptQuestion, opts: AskOptions = {}): Promise<PromptAnswer> {
      const mode = resolveMode(opts);
      if (mode === 'clack') {
        const { askClack } = await import('./prompts/clack.js');
        return askClack(question, opts);
      }
      return askNumbered(question, opts);
    }
    ```

    **Step B — `bin/lib/prompts/clack.ts`** (TTY delegate):

    ```typescript
    // bin/lib/prompts/clack.ts
    //
    // The ONLY file in this repo allowed to import '@clack/prompts'.
    // tests/prompts-shape.test.ts asserts the single-source-of-truth invariant.
    //
    // Pinned at @clack/prompts ^0.7 (D-03 stack pin / Pitfall 11). Do NOT
    // bump to 1.x in this plan — the only path that depends on clack is the
    // TTY-only one, which is not compared by tier-contract.

    import { select, multiselect, text, confirm, isCancel } from '@clack/prompts';
    import type { PromptQuestion, PromptAnswer } from './schema.js';
    import { PromptAbortedError } from '../prompts.js';

    type CancelOr<T> = T | symbol;

    function unwrap<T>(value: CancelOr<T>, id: string): T {
      if (isCancel(value)) throw new PromptAbortedError(id);
      return value as T;
    }

    export async function askClack(
      question: PromptQuestion,
      _opts?: { stdin?: NodeJS.ReadableStream; stderr?: NodeJS.WritableStream },
    ): Promise<PromptAnswer> {
      switch (question.kind) {
        case 'select': {
          const value = unwrap(
            await select({
              message: question.label,
              options: question.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
              initialValue: question.default,
            }),
            question.id,
          );
          return { id: question.id, kind: 'select', value: String(value) };
        }
        case 'multiselect': {
          const value = unwrap(
            await multiselect({
              message: question.label,
              options: question.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
              initialValues: question.default ?? [],
              required: false,
            }),
            question.id,
          );
          return { id: question.id, kind: 'multiselect', value: (value as string[]).map(String) };
        }
        case 'text': {
          const value = unwrap(
            await text({
              message: question.label,
              placeholder: question.placeholder,
              initialValue: question.default,
            }),
            question.id,
          );
          return { id: question.id, kind: 'text', value: String(value) };
        }
        case 'confirm': {
          const value = unwrap(
            await confirm({
              message: question.label,
              initialValue: question.default,
            }),
            question.id,
          );
          return { id: question.id, kind: 'confirm', value: Boolean(value) };
        }
      }
    }
    ```

    **Step C — `tests/prompts-shape.test.ts`** (parity + invariant checks):

    Write the 6 tests sketched in the `<behavior>` block. For tests 1-3 (the
    behavioral parity ones), the simplest path is to call BOTH modes via the
    public `ask()` API with explicit `mode: 'numbered'` and a fake stdin OR
    `mode: 'clack'` with a real clack invocation gated behind a `PENSMITH_TEST_CLACK=1`
    env opt-in (clack does real terminal I/O — only run in interactive dev, skip
    in CI; the parity case is `ask({mode: 'numbered'}, ...)` vs `askNumbered(...)`).

    Pragmatic simplification for CI: tests 1-3 exercise the **numbered** path only
    (since CI is non-TTY, clack would hang). Test 6's grep-invariant is the
    single-source-of-truth guard. The clack delegate's behavior is asserted by
    structural inspection of its switch arms (not its I/O — that's beyond Phase 2
    scope and lands in Phase 3 when intake actually calls `ask()`).

    Test outline:
    ```typescript
    // tests/prompts-shape.test.ts
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { PassThrough } from 'node:stream';
    import { ask } from '../bin/lib/prompts.js';

    function fakeStdin(line: string) {
      const s = new PassThrough();
      queueMicrotask(() => { s.write(line + '\n'); s.end(); });
      return s;
    }

    test('shape: ask(select, mode:numbered) returns select PromptAnswer', async () => {
      const ans = await ask(
        { id: 'q', kind: 'select', label: 'pick', options: [
          { value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
        },
        { mode: 'numbered', stdin: fakeStdin('2'), stderr: new PassThrough() },
      );
      assert.equal(ans.kind, 'select');
      assert.equal(ans.value, 'b');
      assert.equal(ans.id, 'q');
    });

    test('shape: ask(text, mode:numbered, blank line) returns default', async () => {
      const ans = await ask(
        { id: 't', kind: 'text', label: 'name', default: 'alice' },
        { mode: 'numbered', stdin: fakeStdin(''), stderr: new PassThrough() },
      );
      assert.equal(ans.kind, 'text');
      assert.equal(ans.value, 'alice');
    });

    test('shape: ask(confirm, mode:numbered, y) returns true', async () => {
      const ans = await ask(
        { id: 'c', kind: 'confirm', label: 'sure?', default: false },
        { mode: 'numbered', stdin: fakeStdin('y'), stderr: new PassThrough() },
      );
      assert.equal(ans.kind, 'confirm');
      assert.equal(ans.value, true);
    });

    test('shape: ask(multiselect, mode:numbered, "1,3") returns array of two values', async () => {
      const ans = await ask(
        { id: 'm', kind: 'multiselect', label: 'pick many', options: [
          { value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }],
        },
        { mode: 'numbered', stdin: fakeStdin('1,3'), stderr: new PassThrough() },
      );
      assert.equal(ans.kind, 'multiselect');
      assert.deepEqual(ans.value, ['a', 'c']);
    });

    test('TIER-05 invariant: only prompts/clack.ts imports @clack/prompts', () => {
      const pub = readFileSync('bin/lib/prompts.ts', 'utf8');
      const num = readFileSync('bin/lib/prompts/numbered.ts', 'utf8');
      const sch = readFileSync('bin/lib/prompts/schema.ts', 'utf8');
      const clack = readFileSync('bin/lib/prompts/clack.ts', 'utf8');
      assert.equal(/@clack\/prompts/.test(pub), false, 'public entry point must not import clack directly');
      assert.equal(/@clack\/prompts/.test(num), false, 'numbered fallback must not import clack');
      assert.equal(/@clack\/prompts/.test(sch), false, 'schema must not import clack');
      assert.match(clack, /@clack\/prompts/, 'clack delegate MUST be the file that imports clack');
    });

    test('TIER-05 invariant: PENSMITH_PROMPT_MODE=numbered forces numbered mode under fake TTY', async () => {
      const prev = process.env.PENSMITH_PROMPT_MODE;
      process.env.PENSMITH_PROMPT_MODE = 'numbered';
      try {
        const ans = await ask(
          { id: 'forced', kind: 'text', label: 'hi', default: 'd' },
          { stdin: fakeStdin(''), stderr: new PassThrough() },
        );
        assert.equal(ans.value, 'd');
      } finally {
        if (prev === undefined) delete process.env.PENSMITH_PROMPT_MODE;
        else process.env.PENSMITH_PROMPT_MODE = prev;
      }
    });
    ```

    Self-check:
    - `grep -c "@clack/prompts" bin/lib/prompts.ts` == 0.
    - `grep -c "@clack/prompts" bin/lib/prompts/numbered.ts` == 0.
    - `grep -c "@clack/prompts" bin/lib/prompts/schema.ts` == 0.
    - `grep -c "@clack/prompts" bin/lib/prompts/clack.ts` == 1.
    - `grep -c "PromptAbortedError" bin/lib/prompts.ts` >= 1.
    - `grep -c "PromptTimeoutError" bin/lib/prompts.ts` >= 1.
    - `node scripts/run-tests.mjs tests/prompts-shape.test.ts` exits 0 with 6 tests.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck &amp;&amp; node scripts/run-tests.mjs tests/prompts-shape.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bin/lib/prompts.ts` exists with `ask()`, error classes, type re-exports.
    - `bin/lib/prompts/clack.ts` exists and is the SOLE importer of `@clack/prompts`
      in the entire repo (test 5 asserts this).
    - 6 tests in `tests/prompts-shape.test.ts` all green.
    - `npm run lint` + `npm run typecheck` pass.
    - `node dist/bin/lib/prompts.js` doesn't auto-load `@clack/prompts` until
      `ask({mode:'clack'},...)` actually fires (the dynamic import achieves this;
      verify by `grep -c "import(.\\./prompts/clack" dist/bin/lib/prompts.js` >= 1).
  </acceptance_criteria>
  <done>
    Public `ask()` shipped. TIER-05 closed in Phase 2.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| stdin (untrusted user input, possibly from a piped CI fixture) → bin/lib/prompts/numbered.ts | Single-line text per question; parsed by index lookup or value string; max 8KB per line (readline default). |
| @clack/prompts module → bin/lib/prompts/clack.ts | Trusted dep, pinned ^0.7. Pitfall 11 risk is version drift; mitigated by the numbered fallback never importing clack. |
| caller (Phase 3+ verb) → ask() | Verb decides whether `--yolo` skips the call entirely. ask() never reads --yolo state. |
| ask() return value → caller | Caller is responsible for any session-log redaction (PII / secret material). prompts module does NOT log answers. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-09-01 | Tampering | Adversarial CI fixture pumps a megabyte of `\n` to exhaust memory in the numbered prompt loop | mitigate | Each prompt reads exactly ONE line via `rl.once('line', ...)`. Subsequent lines stay in the buffer for the next `ask()` call; they don't accumulate in this function's heap. Readline's default line-length limit (no explicit cap, but Node caps at a few MB) covers single-line abuse. |
| T-02-09-02 | Tampering | Adversarial select index = `1e308` overflows integer parsing | mitigate | The parser uses `Number.parseInt(line, 10)` and checks `Number.isInteger(n) && n >= 1 && n <= options.length`. Out-of-range is treated as a re-prompt, not an exception. |
| T-02-09-03 | Information Disclosure | A caller passes a secret-bearing question label or default through `ask()` and the prompt module logs it | mitigate | prompts module NEVER calls any logging function. Tests assert no `session-log` / `console.log` / `process.stdout.write` calls inside the module. Caller-side redaction (per `bin/lib/pii.ts` from Phase 1) remains the responsibility of the verb that wraps `ask()` in a session-log event. |
| T-02-09-04 | Denial of Service | A scripted CI run forgets to close stdin → ask() hangs forever | mitigate | Per-question timeout (default 5 min, env-overridable) rejects with `PromptTimeoutError`. Test 9 in tests/prompts-numbered.test.ts asserts the 50ms timeout fires within 100ms. |
| T-02-09-05 | Spoofing | A custom Node loader hook replaces the @clack/prompts module with a malicious shim | accept | This is outside Pensmith's threat model — if a user has installed a malicious Node loader, they have full process control. Documented for completeness. |
| T-02-09-06 | Repudiation | A user claims they never answered "approve" on the export gate (when DONE-09 lands in Phase 6) | mitigate (out-of-scope) | The export-gate audit log is DONE-09's responsibility — Phase 6 will record the PromptAnswer in `.paper/CHECKPOINTS.jsonl` per the append-only audit pattern (carry-forward from 01-12 / D-60). This plan ships the prompt; the audit-log linkage lands in Phase 6. |
| T-02-09-07 | Information Disclosure (D-12 symmetric) | A future caller passes an env-var-resolved API key through `ask()` as a `default: ` value, and the numbered renderer echoes it back to stderr | mitigate | Tests assert stderr output for confirm/text prompts NEVER includes the `default` value verbatim when the question id contains the substring "key" / "secret" / "token"; instead it renders `[default: <REDACTED>]`. (Pragmatic carry-forward of D-12 capabilities-no-leak.) **Defer to Phase 7** if implementation in Phase 2 requires extending the schema (`secret: boolean` field) — Phase 2 schema lands without the field; the lint-style guard is the caller-side discipline described in the threat model. |

Security domain: V8 Data Protection (no leak of user answers), V14 Configuration (no leak of resolved env-var values through prompt defaults).
</threat_model>

<verification>
After all three tasks:

1. `npm run lint` exits 0.
2. `npm run typecheck` exits 0.
3. `node scripts/run-tests.mjs tests/prompts-schema.test.ts tests/prompts-numbered.test.ts tests/prompts-shape.test.ts` exits 0 with all green.
4. `grep -rc "@clack/prompts" bin/lib/prompts/` shows clack.ts as the SOLE importer.
5. `grep -c "process\\.exit\\|process\\.stdout" bin/lib/prompts/numbered.ts` == 0.
6. `grep -c "PENSMITH_PROMPT_MODE" bin/lib/prompts.ts` >= 1 (env override honored).
7. `grep -c "PromptAbortedError\\|PromptTimeoutError" bin/lib/prompts.ts` >= 2 (both error classes exported).
8. `node -e "import('./dist/bin/lib/prompts.js').then(m => console.log(typeof m.ask))"` prints `function`.
9. `npm run check` exits 0 (full chain — but only after Wave 3 lands the tier-contract step; Wave 2 only needs lint + typecheck + tests).
</verification>

<success_criteria>
- TIER-05: `bin/lib/prompts.ts` ships an `ask()` callable that delegates to @clack/prompts on TTY and to a stdin numbered-prompt parser on non-TTY. Both paths return the same `PromptAnswer` shape per `bin/lib/prompts/schema.ts`.
- The numbered protocol matches gsd-plugin's `--text` JSON question schema (id + kind + label + options + default; one stdin line per answer).
- Pitfall 11 mitigated: clack import is confined to `bin/lib/prompts/clack.ts`; the numbered fallback is dependency-free; tier-contract comparisons never depend on clack version.
- All Phase 3+ intake / outline / sketch / export-confirm flows have a single `ask()` to call — no per-verb prompt-strategy decisions needed.
- Error path complete: PromptAbortedError on EOF + cancel, PromptTimeoutError on hang, neither calls process.exit (verb-level concern).
- No `process.stdout` writes from the prompts module (stdout reserved for tier-contract-comparable JSON downstream).
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-09-SUMMARY.md`.
Phase 2 closes after 02-09 (Wave 2) + 02-07 (Wave 3) + 02-08 (Wave 4) all green.
</output>
