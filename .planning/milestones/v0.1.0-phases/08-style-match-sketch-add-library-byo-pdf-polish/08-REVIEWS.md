---
phase: 8
cycle: 1
date: 2026-06-19
reviewers:
  - codex        # ran, HIGH_COUNT 0
  - claude       # ran, HIGH_COUNT 1
  - opencode     # ran, HIGH_COUNT 1
  - gemini       # UNAVAILABLE this cycle (IneligibleTierError — auth/tier, not a timeout)
current_high: 1
---

# Phase 8 — Cross-AI Plan Review (Cycle 1)

Four reviewers were dispatched against the full text of all 7 Phase-8 PLAN files (08-00..08-06) plus the goal, the 4 success criteria, and the CLAUDE.md non-negotiables. Three produced usable output (codex, claude, opencode); gemini failed at auth (`IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals`) and is unavailable this cycle.

## Synthesized Findings

Severity-ordered, deduplicated across reviewers. Agreement and judging notes are called out per item.

### HIGH

- **[HIGH] The style-match producer is never wired — no verb calls `buildStyleProfile` / `writeStyleProfile` / `checkAndRegisterFingerprint`, so `.paper/STYLE.json` is never created and cross-paper reuse is never surfaced.**
  *Plans:* `08-02` (Task 2) builds the four library functions but modifies only `bin/lib/schemas/style.ts` + `bin/lib/style-match.ts` — no verb. `08-05` (the only claimed downstream) *consumes* a pre-existing `.paper/STYLE.json` in `write.ts` ("dynamic import when `.paper/STYLE.json` exists and PLAN voice_hint is empty") and registers the paper in the global library at intake — but it never **builds** a profile and never calls `checkAndRegisterFingerprint`. No plan (08-01/04/05/06) adds an opt-in trigger that runs the profiler over the user's samples folder.
  *Two load-bearing consequences:*
  1. **SC-2 unmet:** STYLE.json is produced by no user-facing path, so `write.ts`'s `existsSync(STYLE.json)` branch is always false and the drafter integration is effectively dead — "style-match writes a per-paper `.paper/STYLE.json`" is never delivered.
  2. **Non-negotiable violated by omission:** `checkAndRegisterFingerprint` returns `priorPapers` "for the caller to surface unconditionally," but no caller exists — so "cross-paper reuse must be DETECTED and SURFACED, unconditionally" cannot run. (08-02's own threat-model row T-08-02-02 cites "the consuming verb (08-05) prints the notice unconditionally" — that consumer does not exist in 08-05.)
  *Agreement:* raised independently by **claude** and **opencode** with matching evidence; **verified by direct grep of the plan set** (the three producer functions appear only in 08-00's RED-test interface block and 08-02's implementation — never in a verb plan). codex did not flag it (it audited contents, not the producer→consumer wiring).
  *Judge note:* KEPT as HIGH. This is an incomplete delivery of a success criterion AND a non-negotiable that cannot fire — exactly the HIGH bar. Since the locked 16-verb set forbids a new `style` verb, the fix must wire the producer into an existing verb (most naturally `intake`, behind the style-match opt-in / a samples flag), calling `buildStyleProfile` → `checkAndRegisterFingerprint` (surface `priorPapers` unconditionally) → `writeStyleProfile`. That task is absent from every Phase-8 plan and should be added (likely folded into the 08-05 intake task or a new wave-2 task), with a corresponding RED test for the build+surface path.

### MEDIUM

- **[MEDIUM] Fingerprint registry stores `folderPath` (and `paperName`), exceeding the permitted "hashes + paper IDs."**
  *Plan:* `08-02` Task 2 appends `{paperId, paperName, folderPath, addedAt}` per fingerprint to `pensmithDataDir()/style-fingerprints.json`. The non-negotiable permits the registry to hold ONLY hashes + paper IDs, never features. The core bar (no `features` key) is met and asserted by the 08-00 RED test — good. But `folderPath` (an absolute filesystem path) is neither a hash nor a paper ID; it is scope-creep beyond the stated contract and a minor info-disclosure surface in a global cross-paper file. The returned `priorPapers` shape in 08-00's interface is `{paperId, paperName, addedAt}` — it does not even include `folderPath`, so the stored path is not needed for surfacing.
  *Agreement:* **codex** and **claude** (both MEDIUM). *Judge note:* KEPT as MEDIUM — does not defeat SC-2 (no features leak), so not HIGH; but it should be tightened to drop `folderPath` (and ideally store the paperName only if surfacing truly needs it, else resolve names from the global library).

- **[MEDIUM] `08-05` Task 2 README instructions are internally contradictory and would fail the content guard.**
  *Plan:* `08-05` Task 1/2 tells the executor to "state it does NOT make text undetectable and is not for impersonation," while the same task's content guard forbids the substrings `impersonate`, `evade detection`, and `undetectable`. A literal executor would write the forbidden words and the guard would fail.
  *Agreement:* **codex** (MEDIUM). *Judge note:* KEPT as MEDIUM — a self-contradiction in the plan body that can break the task; reword the planned copy to deliver honest dual-use disclosure without using any forbidden term.

- **[MEDIUM] `08-02` `depends_on` omits `08-01` but imports a `paths.ts` export `08-01` creates.**
  *Plan:* `08-02` imports `pensmithStyleFingerprintsPath` from `paths.ts`, which is added by `08-01`; both are wave 1, yet `08-02` `depends_on: ["08-00"]` only. Run truly in parallel, `08-02` can fail typecheck/test on the missing export. The 08-02 interface block acknowledges the ordering but neither `depends_on` nor a threat-model row resolves it.
  *Agreement:* **claude** (MEDIUM). *Judge note:* KEPT as MEDIUM — real parallel-execution race; fix by adding `08-01` to `08-02`'s `depends_on`, or moving the three `paths.ts` exports into `08-00` (wave 0).

### LOW

- **[LOW] `add` skips the remap prompt under `--yolo` (vs. the compile/done "`--yolo` = auto-proceed" precedent).** `08-04` Task 1: `if (!args.yolo) ask(...); on yes remap`. So `--yolo` skips remapping rather than auto-approving it. Safe for section-state isolation (errs toward not touching sections) but inconsistent with `--yolo` intent. Clarify intended semantics. *(codex + claude)*
- **[LOW] pin guard checks the installed version, not the `package.json` spec string.** `08-03` asserts `require('pdf-parse/package.json').version === '1.1.1'` (effective drift protection) but no task asserts `package.json` declares an exact `"1.1.1"` (vs `^1.1.1`). Research says it's already exact; add a spec-string assertion to be certain. `package.json`/lockfile are also not in `08-03` `files_modified`. *(codex + claude)*
- **[LOW] `open <name>` resolves by a non-unique key.** `08-01` UPSERTs by `id` but `open` finds by `name`; two same-named papers across classes make `open` order-dependent. Consider disambiguation. *(claude)*
- **[LOW] `python3` is hardcoded in the pymupdf shellout.** On Windows the interpreter is typically `python`/`py`, so the fallback is effectively Windows-dead. *(opencode)* *Judge note:* DOWNGRADED from the way it could read as a delivery gap to LOW — the entire pymupdf design is absent-graceful (returns `null` on any failure), opencode itself notes this is graceful degradation, so it is NOT a non-negotiable violation; only a fidelity-on-Windows nicety.
- **[LOW] `add <url>` HTML `<meta>` DOI scrape has no JS-render fallback.** Heuristic; user can retry with a DOI. *(opencode)*

## Per-Reviewer Raw

### codex (ran — HIGH_COUNT: 0)

```
No HIGH concerns.

[MEDIUM] `08-02` Task 2 stores more than “hashes + paper IDs” in `style-fingerprints.json`: `{paperId,paperName,folderPath,addedAt}`. The non-negotiable explicitly says the registry may store ONLY hashes + paper IDs, never features. It does avoid features, but `paperName` and especially `folderPath` exceed the stated storage boundary. Tighten the registry to fingerprint -> paper IDs only, and resolve display names elsewhere if needed.

[MEDIUM] `08-05` Task 2 gives contradictory README instructions: it says to state “does NOT make text undetectable and is not for impersonation,” while also saying the copy MUST NOT contain `impersonate`, `evade detection`, or `undetectable`. The test guard would fail if the executor follows the first sentence literally. Reword the planned copy to avoid the forbidden terms entirely while still giving honest dual-use disclosure.

[LOW] `08-04` Task 1 makes the remap prompt skippable under `--yolo`. The success criterion says `add <doi|pdf|url>` prompts “remap sections?” The broader project pattern may allow `--yolo` to skip approval gates, but the plan should explicitly state that the normal path always surfaces the prompt and that `--yolo` is an intentional approval-gate bypass, not a silent default.

[LOW] `08-03` Task 2 adds a runtime/version guard for `pdf-parse@1.1.1`, but `package.json` / lockfile are not in `files_modified`. If the exact pin is already present, this is fine; if not, the plan would not actually deliver the pin, only detect drift. Add an explicit package manifest check or include the manifest edit if needed.

HIGH_COUNT: 0
```

### claude (ran — HIGH_COUNT: 1)

```
## Cross-AI Plan Review — Pensmith Phase 8

I audited all 7 plan files against the 4 success criteria and the non-negotiables. One HIGH concern (a non-negotiable not delivered by omission), plus several MEDIUM/LOW.

### Findings

- [HIGH] The entire style-match pipeline is built but never invoked by any verb — SC-2's "writes STYLE.json" and the *cross-paper-reuse-must-be-surfaced* non-negotiable are not delivered. `08-02` creates `buildStyleProfile` / `writeStyleProfile` / `checkAndRegisterFingerprint` as **library functions only** (it modifies just `bin/lib/schemas/style.ts` + `bin/lib/style-match.ts`, no verb). `08-05` (the only downstream consumer) *reads* `.paper/STYLE.json` if it already exists (`write.ts` voiceHint resolution) and registers the paper in the global library at intake — but it never calls `buildStyleProfile`, never calls `writeStyleProfile`, and never calls `checkAndRegisterFingerprint`. No plan (`08-01`, `08-04`, `08-05`, `08-06`) wires the opt-in trigger that runs the profiler over the user's samples. Consequences, both load-bearing:
  - STYLE.json is **never produced** by any user-facing path, so the drafter integration in `08-05` is effectively dead (`STYLE.json exists` is always false) and SC-2's "writes a per-paper STYLE.json" is unmet.
  - `checkAndRegisterFingerprint` returns `priorPapers` "for the CALLER to surface unconditionally" (`08-02` Task 2 header comment), **but no caller exists**. The non-negotiable "cross-paper reuse must be DETECTED and SURFACED — unconditionally" is therefore violated by omission: detection code ships, surfacing never runs. Since the locked 16-verb set forbids a new `style` verb, the trigger must be wired into an existing verb (e.g. intake with a samples flag), and that task is absent from every plan.

- [MEDIUM] `08-02` `depends_on: ["08-00"]` omits `08-01`, but `08-02` imports `pensmithStyleFingerprintsPath` from `paths.ts`, which `08-01` creates — both are wave 1. The interface block admits this ("added by 08-01, same wave … ordering note in threat model"), yet the `08-02` threat model has no row resolving it and `depends_on` does not encode it. Run in parallel, `08-02` can fail typecheck/test on a missing export. Either add `08-01` to `08-02`'s `depends_on`, or move the three `paths.ts` exports into `08-00`.

- [MEDIUM] `08-02`'s fingerprint registry stores `folderPath` (absolute filesystem paths), exceeding the permitted "hashes + paper IDs." The non-negotiable allows the registry to hold *"ONLY hashes + paper IDs, never features."* The core bar (no `features`) is met and the RED test asserts no `features` key — good. But `08-02` Task 2 appends `{paperId,paperName,folderPath,addedAt}` per fingerprint. `folderPath` is neither a hash nor a paper ID; writing absolute paths into a global cross-paper registry is scope-creep beyond the permitted contents and a minor info-disclosure surface. The returned `priorPapers` doesn't even include it (`08-00` interface: `{paperId,paperName,addedAt}`), so it isn't needed for surfacing — drop `folderPath` from the stored record.

- [LOW] `08-04` `add` skips remap entirely under `--yolo`, contradicting the compile/done `--yolo`=proceed precedent it copies. Task 1: "if `!args.yolo`, ask(…); on yes call remapSections." So `--yolo` (auto-approve) *skips* remapping rather than performing it. The plan cites `done.ts`/`compile.ts` where `--yolo` means "skip the prompt and proceed." The behavior here is safe for section-state isolation (errs toward not touching sections) but is inconsistent with the user's `--yolo` intent and the referenced pattern. Clarify intended `--yolo` semantics.

- [LOW] `08-03` enforces the pin via the installed version only, not the `package.json` spec string. The repo-files guard asserts `require('pdf-parse/package.json').version === '1.1.1'` (effective protection against drift) but no task asserts `package.json` declares an *exact* `"1.1.1"` (vs `^1.1.1`). The non-negotiable says "pinned EXACT." Research claims it is already exact; add a spec-string assertion to be certain.

- [LOW] `08-01` `open <name>` resolves by `name`, which is not unique (UPSERT is by `id`). Two papers with the same name across classes make `open` ambiguous/order-dependent. Consider disambiguating or matching on a unique key.

### What is correctly handled (no concern)
- `add` remap touches only `assigned_sources[]` via `updateFrontmatter`+`withLock`+`atomicWriteFile`; explicitly never `status`/`verified_against_draft_hash`. ✓
- `sketch` creates no `.paper/`/STATE.json/LIBRARY.json before confirm; never calls `initState`/`initLibrary`/`mkdir .paper`; dispatches `new` only after confirm. ✓
- `pymupdf` shellout: `execFile('python3', ['-c', script])` arg array, tmpfile path internally generated + `JSON.stringify`-embedded, returns `null` on any failure, never throws, `finally` unlink. ✓
- `pdf-parse` drift guard present; fallback only in the image-only branch (no per-PDF spawn). ✓
- 16-verb / 16-workflow bijection re-asserted by three guards; list/open/sketch/add promoted via `REAL_VERB_LOADERS` only, `UX02_VERBS` stays length-16. ✓
- All network via `httpFetch` (D-06); offline cassette for `add <doi>`; RED-by-skip keeps suite green. ✓
- README dual-use disclosure with honest framing + content guard forbidding `impersonate`/`evade detection`/`undetectable`. ✓
- `writeStyleProfile` writes only `join(paperDir,'STYLE.json')` and must not import `pensmithDataDir` for its write target. ✓ (though, per the HIGH, it's never called.)

HIGH_COUNT: 1
```

### opencode (ran — HIGH_COUNT: 1)

```
## Cross-AI Plan Review — Pensmith Phase 8

Reviewer assessment: The plans are well-structured and show careful attention to non-negotiables (section-state isolation, no 17th verb, sketch no-advance, pymupdf shellout safety, honest README disclosure). However, there is one HIGH concern that would prevent SC-2 from being delivered.

### [HIGH] 08-02 + 08-05: Style profile is never built — no verb calls `buildStyleProfile`/`writeStyleProfile`/`checkAndRegisterFingerprint`

- `bin/lib/style-match.ts` (08-02) exports four functions: `buildStyleProfile`, `writeStyleProfile`, `checkAndRegisterFingerprint`, `styleMatchToVoiceHint`.
- `bin/cli/write.ts` (08-05) *consumes* an existing `STYLE.json` — reads it, renders a `voiceHint` via `styleMatchToVoiceHint`. It never calls `buildStyleProfile` or `checkAndRegisterFingerprint`.
- `bin/cli/intake.ts` (08-05) registers the paper in the global library but never builds a style profile.
- No other verb (new, sketch, add, list, open, or any of the existing 12) is modified to call `buildStyleProfile` → `writeStyleProfile` → `checkAndRegisterFingerprint`.

Consequence: No `.paper/STYLE.json` is ever created. `write.ts` always falls through to the default `'Formal academic tone.'` because the `STYLE.json` `existsSync` check is always false. SC-2 ("style-match writes a per-paper .paper/STYLE.json") is completely undeliverable. Cross-paper reuse (SC-2 bullet: "cross-paper reuse is detected + surfaced") is also impossible because `checkAndRegisterFingerprint` is never called by any verb — the detection code exists but has no trigger. The fingerprint registry at `pensmithDataDir()/style-fingerprints.json` is never populated. The unconditional reuse-notice non-negotiable cannot be satisfied.

This is a HIGH concern — a missing orchestrator verb/flow. The fix would be to either: (a) add a style profile build step to `intake` or to a pre-write hook, or (b) create an explicit build flow within the 16-verb set (perhaps gating profile building inside `write` with an auto-build-on-absence step). The plans currently assume `STYLE.json` magically appears on disk.

### No other HIGH concerns found

The remaining success criteria and non-negotiables are handled correctly:
- SC-1 (Library): `list` groups by class with sectioning X/Y status; `open` switches via active pointer; 7-state lifecycle UPSERT'd. (08-01, 08-06) ✓
- SC-3 (Sketch): No state advance before confirm; dispatches `new` with thesis after confirm. (08-04) ✓
- SC-4 (Add + BYO PDF): DOI/PDF/URL ingestion through chokepoints; remap touches only `assigned_sources[]`; `pdf-parse@1.1.1` pinned exact with drift guard; `pymupdfShellout` returns `null` on any failure, uses `execFile` arg array with `JSON.stringify`-embedded path. (08-03, 08-04) ✓
- 16-verb bijection: No 17th verb introduced; `list`/`open`/`sketch`/`add` already in `UX02_VERBS`; bijection re-asserted in 08-06 with three guards. ✓
- Honest disclosure: README forbids "impersonate"/"evade detection"/"undetectable"; content guard enforces. (08-05) ✓
- All network via `http.ts`: `add` uses `httpFetch` for URLs; `crossref.ts` uses `http.ts` internally. ✓
- Offline cassette tests: Crossref `add-doi.json` fixture; all new tests RED-by-skip. (08-00) ✓
- Per-paper-only STYLE.json: `writeStyleProfile` writes to `join(paperDir, 'STYLE.json')` only; registry stores hashes+IDs never features; RED test asserts no `"features"` key. (08-02) ✓

### Minor notes (MEDIUM/LOW)
- `python3` hardcoded in pymupdf shellout (08-03): On Windows, the executable is `python` or `py`, not `python3`. The shellout will always return `null` on Windows (graceful degradation, so not a non-negotiable violation), but the fallback is effectively Windows-dead. Consider `python3` with `python` fallback via platform detection.
- Add `<url>` HTML scrapes `<meta>` DOI (08-04): The plan correctly routes through `httpFetch`, but the HTML scraping for a `<meta>` DOI is heuristic-based with no fallback if the page is JS-rendered. Low concern in practice since the user can retry with a DOI.

HIGH_COUNT: 1
```

### gemini (UNAVAILABLE this cycle)

`gemini` exited without producing output. stderr: `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` (authentication/tier failure during setup, before any review ran — not a timeout). No findings from this reviewer this cycle.

---

## Cycle 2

**Date:** 2026-06-19
**Reviewers:** codex (ran — HIGH_COUNT 0), claude (ran — HIGH_COUNT 1), opencode (ran — HIGH_COUNT 0), gemini (UNAVAILABLE — same `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` auth/tier failure as cycle 1, not a timeout).
**current_high: 1**

Same protocol as cycle 1: all 7 revised PLAN files (08-00..08-06) plus GOAL + 4 SCs + non-negotiables + the cycle-1-fix summary were sent to four reviewers in parallel. Three produced usable output; gemini failed at auth before any review ran.

### Synthesized Findings (cycle 2)

#### Cycle-1 fixes — adjudication

All four cycle-1 items are **GENUINELY RESOLVED**, confirmed by direct plan inspection and unanimous across the three reviewers that ran:

- **HIGH (style-match producer wiring) — RESOLVED.** 08-05 Task 2 Part B wires a real run-path on the EXISTING `intake` verb behind opt-in `--style-samples <dir>` (NO 17th verb): `buildStyleProfile → checkAndRegisterFingerprint (priorPapers printed by the producer OUTSIDE any --yolo gate) → writeStyleProfile(paperDir())`. The build→check→print-notice→write ordering means a `writeStyleProfile` failure cannot swallow the already-printed reuse notice. 08-00 adds `tests/intake-style-producer.test.ts` (source-grep skip-guard on intake importing `buildStyleProfile`/referencing `styleSamples`) asserting (1) STYLE.json written + parses via StyleProfileSchema, (2) reuse notice fires unconditionally even without --yolo, (3) opt-in gating (no flag → no STYLE.json). The consumer branch in write.ts (08-05 Task 1) is now reachable because the producer writes the file. Live end-to-end chain, not a description. (codex/claude/opencode all confirm.)
- **M1 (08-02 wave/dep) — RESOLVED.** 08-02 is now `wave: 2, depends_on: ["08-00","08-01"]`; its import of `pensmithStyleFingerprintsPath` (added by 08-01 in wave 1) is correctly ordered. Cascade verified: 08-05 wave 3, 08-06 wave 4. No intra-wave file collisions — `bin/pensmith.ts` is edited by 08-01 (wave 1) and 08-04 (wave 2) in different waves; `tests/repo-files.test.ts` by 08-03 (wave 1) and 08-05 (wave 3) in different waves.
- **M2 (registry tightened) — RESOLVED.** `checkAndRegisterFingerprint(fingerprint, paperId, paperName)` takes no `folderPath`; the registry record is `{ "<hash>": [{paperId,paperName,addedAt}] }`. 08-02 explicitly forbids a `features` key and any path, and resolves a prior paper's folder from the global library by `paperId` when the notice needs it. 08-00 RED test asserts no `features`/`folderPath` keys. Per-paper-only STYLE.json storage preserved (writeStyleProfile must not import `pensmithDataDir`).
- **M3 (README copy/guard) — RESOLVED.** 08-05 Task 3 supplies compliant phrasings ("passing off someone else's work," "make AI authorship invisible to detectors"), explicitly warns against the negation trap ("does not make text undetectable"), and the content guard asserts presence of `## Style Match` + a voice phrase and absence of all three forbidden substrings. Copy and guard reconciled.

Also re-confirmed: **no 17th verb** (list/open/add/sketch promoted only via REAL_VERB_LOADERS; UX02_VERBS untouched; 16-verb/16-workflow bijection re-guarded three ways in 08-06).

#### Remaining / NEW findings

- **[HIGH] The status lifecycle never advances past `intake`, so SC-1's `list` status column and the explicitly-promised "sectioning X/Y" display are non-functional as planned.** (Raised by **claude**; **upheld by judge after direct plan inspection**.) The global registry is brand-new in 08-01, so no pre-Phase-8 verb writes it. Within Phase 8 the ONLY `registerPaperInGlobalLibrary` call that sets status is 08-05 Part A, with a hardcoded `status:'intake'`. No plan modifies the existing lifecycle verbs (`research`/`outline`/`plan`/`write`/`compile`/`done` — none appear in any `files_modified`) to UPSERT a new status or `sectioningProgress`, and 08-01's `list.ts` reads `entry.status`/`entry.sectioningProgress` STRAIGHT from the registry rather than deriving them from each paper's STATE.json. The 7-state lifecycle is round-tripped **only in tests** (08-01's global-library.test asserts the schema can hold all 7 states). Net effect as the 7 plans stand: every paper shows `intake` forever and the `status==='sectioning' && sectioningProgress` render branch is dead code. SC-1 (ROADMAP §Phase-8) promises status values that "cycle through `intake | ... | sectioning (X/Y) | ... | archived`" and that `list` "shows status (sectioning shows X/Y)" — behavioral language, not merely a representable-set requirement. This meets the HIGH bar: incomplete delivery of a success criterion. The fix is bounded — either (a) have the existing lifecycle verbs UPSERT status + sectioningProgress into the registry at each transition, or (b) have `list` derive status/progress per paper from STATE.json — but as planned the feature ships non-functional beyond the initial intake state.
  *Judge note:* This was masked in cycle 1 because the producer-wiring HIGH dominated, and intake-registration itself did not exist until the cycle-1 replan added it to 08-05. It is a genuine NEW HIGH surfaced now that registration is in place. Not a re-raise of any cycle-1 item.

- **[MEDIUM] The `extractPdfText` image-only fallback branch (the real integration point of the pymupdf fallback) has no driving test.** (claude.) 08-03 adds the lazy import + threshold check + WARN-and-degrade in the image-only branch, but `byo-text.pdf` is built to yield ≥50 chars (the SUCCESS path), and 08-03's verify runs only `pymupdf-shellout`/`add-source`/`repo-files`. `pymupdfShellout` returning null is unit-tested in isolation, but no fixture drives an image-only PDF through `extractPdfText` to confirm the graceful-degrade return + single WARN. SC-4's "degrades gracefully" at the chokepoint level is asserted only indirectly. Low blast radius (simple branch logic) → MEDIUM, not HIGH. Worth adding a near-empty/image-only PDF fixture + an extractPdfText integration assertion during execution.

- **[LOW] write.ts STYLE.json parse lacks an explicit try/catch.** (claude.) T-08-05-05 promises "parse failure falls back to default tone," but Task 1's action says to parse via `StyleProfileSchema` without specifying the guard; a malformed STYLE.json could throw inside a core verb. atomicWriteFile makes corruption unlikely and the threat model states intent, so risk is low — encode the fallback during execution.

- **[LOW] `checkAndRegisterFingerprint` appends without dedup, so re-running `intake --style-samples` on the same paper accumulates duplicate `{paperId}` entries under one hash.** (claude.) `priorPapers` correctly excludes the current paperId (no false self-notice), but a later third paper's notice could name a prior paper multiple times and the registry grows unbounded on repeated runs. Cosmetic/data-hygiene; dedupe-by-paperId on insert resolves it.

- **[LOW] 08-00's add-source remap test references "a committed fixture `.paper/` with one section PLAN.md," but no such fixture path appears in `files_modified`.** (claude.) Either created inline in the test (fine) or an omission; reconcile so the Wave-0 fixture set is complete.

- **[LOW] README guard regex `match your.*voice` is single-line (`.` excludes newline).** (claude.) The honest-framing copy must keep "match your … voice" on one line or the positive assertion fails. The plan tells the executor to re-read after writing, so it is flagged not unhandled.

- **[LOW] write.ts consumer hardcodes `join(paperRoot, '.paper', 'STYLE.json')` instead of `paperDir()`.** (opencode.) Equivalent today since `paperDir(root)` resolves to `<root>/.paper`, but a subtle drift risk if the paper dir location were ever configurable. Prefer `join(paperDir(paperRoot), 'STYLE.json')` for producer/consumer consistency.

- **[LOW] 08-04's `add` plan appends a `RESEARCH.md` row but is less explicit than the remap path about lock/atomic-write behavior for that file.** (codex.) Worth tightening during execution; does not break a Phase-8 SC as written.

- **[LOW] The registry no-path assertion checks for `folderPath` specifically; the contract forbids filesystem paths generally.** (codex.) The narrowed API shape makes accidental path storage unlikely, but implementation review should also watch for alternate path-like keys/values.

- **[LOW] `intake-style-producer` RED test uses a source-grep skip-predicate (heuristic) rather than `existsSync`.** (opencode.) If `buildStyleProfile` were imported into intake before 08-05 for any other reason, the RED test could flip GREEN prematurely. Inherent to the source-grep pattern, consistent with prior phases — acceptable.

*Carry-over from cycle 1 (still LOW, already adjudicated — not re-litigated): `--yolo` skips the add remap prompt rather than auto-approving (safe-by-default, intentional); `python3` hardcoded in the pymupdf shellout (Windows-dead but graceful-absent by design); pin guard checks installed version not the spec string; `open <name>` resolves by a non-unique key; `add <url>` <meta> DOI scrape has no JS-render fallback.*

### Per-Reviewer Raw (cycle 2)

#### codex (ran — HIGH_COUNT: 0)

[LOW] Cycle-1 HIGH producer wiring appears genuinely resolved. 08-05 wires `intake --style-samples <dir>` into the real intake path, with the live chain `buildStyleProfile → checkAndRegisterFingerprint → writeStyleProfile(.paper/STYLE.json)`, and 08-00 adds `tests/intake-style-producer.test.ts` to prove STYLE.json creation, opt-in behavior, and unconditional reuse notice.

[LOW] Cycle-1 M1 wave/dependency issue appears resolved. 08-02 is now wave 2 and depends on 08-01, so its import of `pensmithStyleFingerprintsPath` is ordered correctly. 08-05 is wave 3 and 08-06 is wave 4, with no obvious intra-wave conflict.

[LOW] Cycle-1 M2 registry tightening appears resolved. The revised `checkAndRegisterFingerprint(fingerprint, paperId, paperName)` signature cannot receive `folderPath` or prose features, and the planned registry stores only `fingerprint → [{paperId,paperName,addedAt}]`. The RED test also asserts no `features` or `folderPath` keys.

[LOW] Cycle-1 M3 README guard/copy mismatch appears resolved. 08-05 explicitly avoids the forbidden substrings while still requiring a dual-use disclosure, and adds a content guard to keep the copy and policy aligned.

[LOW] No 17th verb is introduced in the revised plans. `list`, `open`, `add`, and `sketch` are promoted through `REAL_VERB_LOADERS`, while the plans repeatedly say not to touch `UX02_VERBS`; 08-06 reasserts the 16-verb/16-workflow bijection and alias guards.

[LOW] Remaining implementation risk: 08-04’s `add` plan says to append a `RESEARCH.md` row but is less explicit than the remap path about locking/atomic write behavior for that file. This is worth tightening during execution, but it does not appear to break a Phase 8 success criterion as written.

[LOW] Remaining test-strength risk: the registry no-path assertion checks for `folderPath` specifically. The plan text forbids filesystem paths generally, so implementation review should also watch for alternate path-like keys or values, but the planned API shape makes the intended storage narrow enough.

HIGH_COUNT: 0

#### claude (ran — HIGH_COUNT: 1)

# Cross-AI Plan Review — Pensmith Phase 8 (Cycle 2)

## Cycle-1 fix verification

**Fix 1 — HIGH producer wiring: GENUINELY RESOLVED.** 08-05 Task 2 Part B wires a real run-path: `intake --style-samples <dir>` → `buildStyleProfile` → `checkAndRegisterFingerprint` (surfaces `priorPapers` before the return) → `writeStyleProfile(paperDir())`. The opt-in is explicit (absent flag = no profiling), the notice is printed by the producer outside any `--yolo` gate, and the ordering (build → check → print notice → write) means a `writeStyleProfile` failure cannot swallow the already-printed notice. 08-00 Task 2(c) adds `tests/intake-style-producer.test.ts` with a source-grep skip-guard (`bin/cli/intake.ts` imports `buildStyleProfile`/references `styleSamples`) so it stays RED-by-skip until 08-05 lands, then asserts (1) STYLE.json written, (2) unconditional reuse notice, (3) opt-in gating. The consumer side (08-05 Task 1, write.ts existsSync branch) is now reachable because the producer writes the file. This is a live end-to-end chain, not a description.

**Fix 2 — M1 wave/dep: RESOLVED.** 08-02 is `wave: 2, depends_on: ["08-00","08-01"]`; it imports `pensmithStyleFingerprintsPath` which 08-01 (wave 1) adds. Cascade checks out: 08-05 wave 3 (deps 08-01/08-02), 08-06 wave 4. No intra-wave file collisions — `bin/pensmith.ts` is edited by 08-01 (wave 1, list/open) and 08-04 (wave 2, add/sketch) in *different* waves; `tests/repo-files.test.ts` by 08-03 (wave 1) and 08-05 (wave 3) in different waves. Clean.

**Fix 3 — M2 registry tightened: GENUINELY RESOLVED.** `checkAndRegisterFingerprint(fingerprint, paperId, paperName)` takes no `folderPath`; registry record is `{ "<hash>": [{paperId,paperName,addedAt}] }`. 08-02 explicitly forbids a `features` key and any path, and resolves the prior paper's folder from the global library by `paperId` when the notice needs it. 08-00's RED test asserts no `features`/`folderPath` keys. Per-paper-only STYLE.json storage preserved (writeStyleProfile must not import `pensmithDataDir`).

**Fix 4 — M3 README copy/guard: RESOLVED.** 08-05 Task 3 supplies compliant phrasings ("passing off someone else's work," "make AI authorship invisible to detectors") and explicitly warns against the negation trap ("does not make text undetectable"). Guard asserts presence of `## Style Match` + a voice phrase and absence of all three forbidden substrings; copy and guard are reconciled.

## Findings

- **[HIGH] The status lifecycle never advances past `intake`, so `list`'s status column (and the "sectioning X/Y" display SC-1 explicitly promises) is unreachable in practice.** The global registry is brand-new in 08-01, so no pre-Phase-8 verb writes it. Within Phase 8, the *only* call that sets status is 08-05 Part A (`status:'intake'`). No plan wires `research`/`outline`/`sectioning`/`compile`/`done` to UPSERT a new status or `sectioningProgress`. 08-01 Task 2 reads status straight from the registry entry (`status==='sectioning' && sectioningProgress present`), and 08-01 round-trips the 7 states *only in tests*. Net effect: every paper shows `intake` forever and the `sectioning X/Y` branch is dead code. SC-1's "shows status (sectioning shows X/Y)" and "papers carry a 7-state lifecycle" are therefore only partially delivered — the data model and intake-registration exist, but the dynamic transitions that make the feature meaningful are absent. The fix is bounded (have the lifecycle verbs UPSERT status, or have `list` derive status/progress from each paper's STATE.json), but as planned it ships non-functional.

- **[MEDIUM] The `extractPdfText` image-only fallback branch (the actual integration point of the pymupdf fallback) has no driving test.** 08-03 adds the lazy import + threshold check + WARN-and-degrade in the image-only branch, but `byo-text.pdf` is built to yield ≥50 chars (the *success* path), and the verify steps run only `pymupdf-shellout`/`add-source`/`repo-files`. `pymupdfShellout` returning null is tested in isolation, but no fixture exercises an image-only PDF through `extractPdfText` to confirm it returns the near-empty pdf-parse text with a single WARN. SC-4's "degrades gracefully" at the chokepoint level is asserted only indirectly. Low blast radius (simple logic), but it is the SC-4 integration that is unverified.

- **[LOW] write.ts STYLE.json parse is not explicitly guarded.** T-08-05-05 claims "parse failure falls back to default tone," but Task 1's action says to parse via `StyleProfileSchema` and render without specifying a try/catch. A malformed/partial STYLE.json could throw inside a core verb. atomicWriteFile makes corruption unlikely and the threat model flags the intent, so risk is low — but the task body should encode the fallback the threat register promises.

- **[LOW] `checkAndRegisterFingerprint` appends (never overwrites), so re-running `intake --style-samples` on the same paper accumulates duplicate `{paperId}` entries** under the same hash. `priorPapers` correctly excludes the current paperId (no false self-notice), but a later third paper's notice could name a prior paper multiple times, and the registry grows unbounded on repeated runs. Cosmetic/data-hygiene; dedupe-by-paperId on insert would resolve it.

- **[LOW] 08-00's add-source remap test references "a committed fixture `.paper/` with one section PLAN.md," but no such fixture path appears in `files_modified`.** Either the fixture is created inline in the test (fine) or it's an omission; worth reconciling so the Wave-0 fixture set is complete and the test isn't relying on an unlisted artifact.

- **[LOW] README guard regex `match your.*voice` is single-line (`.` excludes newline).** The honest-framing copy must keep "match your … voice" on one line, or the guard's positive assertion fails even with correct content. The plan tells the executor to re-read after writing, so this is flagged, not unhandled.

## Summary

All four cycle-1 fixes are genuinely resolved: the style-match producer is wired into a real `intake --style-samples` run-path with a backing RED test, the cross-paper notice fires unconditionally within the opt-in path, the registry stores only hashes + paper identity, and no 17th verb is introduced (the 16-verb bijection is re-guarded three ways in 08-06). The one remaining HIGH is pre-existing rather than introduced by the revisions: the library status lifecycle has a sound data model and intake registration but no transition wiring, leaving SC-1's status/X-Y display non-functional after intake.

HIGH_COUNT: 1

#### opencode (ran — HIGH_COUNT: 0)

## Review: Phase 8 (Cycle 2) — Revised Plans 08-00 through 08-06

### Cycle-1 Fix Verification

**Fix 1 (HIGH — producer wiring): GENUINELY RESOLVED.**

The producer chain is now fully live on the existing `intake` verb with `--style-samples` flag in 08-05 Task 2: `buildStyleProfile → checkAndRegisterFingerprint (surfaces priorPapers UNCONDITIONALLY) → writeStyleProfile(.paper/STYLE.json)`. The consumer path in 08-05 Task 1 (write.ts) reads STYLE.json, parses via StyleProfileSchema, resolves voiceHint with PLAN.md override priority. A RED test in 08-00 (`tests/intake-style-producer.test.ts`) asserts STYLE.json is written, the reuse notice fires unconditionally, and the flag is opt-in. No 17th verb.

**Fix 2 (M1 — wave/dep): GENUINELY RESOLVED.**

08-02 is wave 2 with `depends_on: ["08-00", "08-01"]` (imports 08-01's paths.ts). 08-05 is wave 3, 08-06 is wave 4. No intra-wave conflicts.

**Fix 3 (M2 — registry tightened): GENUINELY RESOLVED.**

Registry stores only `fingerprint → [{paperId, paperName, addedAt}]`. 08-02 explicitly forbids `features` key and `folderPath`/absolute paths. 08-00 style-match.test.ts asserts no `features`/`folderPath` keys.

**Fix 4 (M3 — README copy/guard reconciled): GENUINELY RESOLVED.**

08-05 Task 3 prescribes compliant phrasing avoids `impersonate`/`evade detection`/`undetectable` and adds a content guard in repo-files.test.ts. Copy and guard are explicitly reconciled.

---

### Remaining / New Findings

**[LOW] write.ts consumer uses hardcoded `join(paperRoot, '.paper', 'STYLE.json')` instead of `paperDir()` from paths.ts.** Currently equivalent since `paperDir(root)` resolves to `<root>/.paper`, but this introduces a subtle drift risk if the paper directory location were ever configurable. Recommend using `paperDir()` or `join(paperDir(paperRoot), 'STYLE.json')` for consistency with producer.

**[LOW] 08-00 creates `tests/intake-style-producer.test.ts` guarded by a "source-grep that bin/cli/intake.ts imports buildStyleProfile"** — this skip-predicate will flip GREEN once 08-05 wires the producer. However, the skip guard pattern is a heuristic grep rather than a deterministic `existsSync`. If `buildStyleProfile` happens to be imported before 08-05 for any other reason (e.g., an intermediate edit), the RED test would prematurely turn GREEN without the actual producer being wired. This is an inherent limitation of the source-grep skip pattern and is consistent with prior phases — acceptable.

No HIGH issues. All four Cycle-1 fixes are genuinely resolved. The 7 plans form a coherent, non-contradictory delivery of all four SCs with no 17th verb, honest framing, per-paper-only storage, unconditional reuse notice, assigned_sources-only remap, and tier-contract parity for all promoted verbs.

**HIGH_COUNT: 0**

#### gemini (UNAVAILABLE this cycle)

`gemini` exited without producing output (0 bytes stdout). stderr: `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` — the same auth/tier failure as cycle 1 (it has NOT recovered), occurring during setup before any review ran (not a timeout). No findings from this reviewer this cycle.

---

## Cycle 3

**Date:** 2026-06-19
**Reviewers:** codex (ran — HIGH_COUNT 0), claude (ran — HIGH_COUNT 0), opencode (ran — HIGH_COUNT 0), gemini (UNAVAILABLE — same `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` auth/tier failure as cycles 1-2, NOT a timeout; it has not recovered and the CLI now points users to migrate to the Antigravity suite). Three-reviewer quorum (codex + claude + opencode) satisfied.
**current_high: 0**

Same protocol as cycles 1-2: all 7 revised PLAN files (08-00..08-06) plus GOAL + 4 SCs + non-negotiables + the two-prior-HIGH-families summary (style-match producer wiring; status lifecycle now derived at display from authoritative STATE.json) were sent to four reviewers in parallel. Three produced usable output; gemini failed at auth before any review ran.

### Synthesized Findings (cycle 3)

#### Prior HIGH families — adjudication

Both prior HIGH families are **GENUINELY RESOLVED**, confirmed unanimously by the three reviewers that ran and by direct plan inspection:

- **HIGH #1 (style-match producer wiring) — RESOLVED.** 08-05 Task 2 Part B wires the producer onto the existing `intake` verb behind opt-in `--style-samples <dir>` (NO 17th verb): `buildStyleProfile → checkAndRegisterFingerprint` (priorPapers surfaced UNCONDITIONALLY, explicitly outside any `--yolo` gate; ordered build→check→print-notice→write so a `writeStyleProfile` failure cannot swallow the already-printed notice) `→ writeStyleProfile(.paper/STYLE.json)`. The consumer half (08-05 Task 1, write.ts) reads STYLE.json and resolves voiceHint by PLAN `voice_hint` > style-match > default, on the producer/consumer-agreed `join(paperDir(paperRoot),'STYLE.json')` path. 08-00's RED test `tests/intake-style-producer.test.ts` asserts STYLE.json written + unconditional reuse notice + opt-in gating. The four library functions now have a live caller. (codex/claude/opencode all confirm.)
- **HIGH #2 (status lifecycle stuck at intake → derive-at-display) — RESOLVED.** 08-01 builds `deriveLibraryStatus(folderPath, storedStatus?)`, a never-throw resolver that mirrors `router.resolveNextAction`'s on-disk machine onto the LIB-05 vocabulary (archived from the stored flag; else derived intake/research/outline/sectioning{X/Y}/compile/done), reusing the existing `readSectionState` never-throw helper plus an outer backstop. `list.ts` (08-01 Task 2) derives per-paper at display time with a belt-and-suspenders per-entry try/catch, rendering a real `sectioning X/Y` (X = drafted-or-beyond sections, Y = total) and never crashing on a missing/corrupt paper STATE.json. The PAPER registry retains `folderPath` (load-bearing); the FINGERPRINT registry stays features-free and path-free. 08-00's RED test covers the full lifecycle + missing/corrupt-STATE.json never-throw cases. (codex/claude/opencode all confirm.)

Also re-confirmed clean against the concrete HIGH checklist: no global style-feature cache (registry hashes+identity only; RED test asserts no `features`/`folderPath` keys); cross-paper reuse surfaced unconditionally (outside `--yolo`); `add` remap touches only `assigned_sources[]` (status + `verified_against_draft_hash` asserted unchanged); no 17th verb (stub promotion via REAL_VERB_LOADERS + triple bijection guard); sketch creates no `.paper/`/STATE.json/LIBRARY.json before confirm (RED test asserts); pymupdf shellout uses `execFile` arg-array with a JSON.stringify'd internally-generated tmp path (no injection surface); pdf-parse pinned exact 1.1.1 + drift guard; all tests offline/cassette-backed.

#### Remaining / NEW findings (all sub-HIGH)

- **[MEDIUM] LIB-04 intake-registration and the style-producer are keyed on a `paperId`/`STATE.json` that no current intake path creates; LIB-04 also ships without its own forcing test.** (claude, with direct codebase grounding.) `initState` has zero production call sites — `bin/cli/intake.ts` is a Tier-2 placeholder that writes only `INTAKE.md` (no `initState`, no STATE.json, no paperId); the Tier-1 `new.md` body writes only `INTAKE.md`; MCP exposes only `paper_init_section` (= `initSection`, not paper-level state). **Independently verified by judge:** grep confirms `initState` appears only in `bin/lib/state.ts` (definition) and `tests/state.test.ts` (no `bin/cli/**` or `bin/lib/**` caller), and `intake.ts` references none of `initState`/`loadState`/`paperId`/`STATE.json`. Consequence: at the moment intake runs today, `loadState` throws `StateNotFoundError`, so 08-05's registration (`id = paperId from STATE.json`) and `checkAndRegisterFingerprint(fingerprint, paperId, name)` both fall into their acknowledged non-fatal "no paperId → WARN-skip" branch — the global registry stays empty (`list` shows nothing) and STYLE.json is never written in the *real* flow. The producer RED test can still pass by pre-seeding STATE.json in its tmpdir (08-00's interface block lists `initState` as a test seed), so the gap is green-but-non-functional end-to-end. **Why MEDIUM, not HIGH:** the missing STATE.json bootstrap is a pre-existing, cross-cutting property of the current build (intake/research/outline/verify are all explicit placeholder stubs that never advance authoritative on-disk paper-level state; real intake LLM wiring is flagged as Phase-4+ work in intake.ts's own comments). Phase 8 correctly targets the *same* accepted "authoritative STATE.json is the source of truth" contract that the cycle-2 derive-at-display HIGH fix was adjudicated against — both 08-05 Part A and the producer wrap registration in non-fatal try/catch with an explicit WARN-skip on absent paperId, so the plans degrade gracefully (no crash) rather than mis-deliver. Re-raising this as a Phase-8 HIGH would re-litigate an already-accepted contract boundary. *Recommended (non-blocking, for execution):* have 08-05 instruct intake to bootstrap STATE.json (so `paperId` exists before registration + producer run), and add an `intake-library.test.ts` forcing test that intake registers a paper without pre-seeding state.
- **[MEDIUM] The Tier-1 `intake` workflow body is not modified by any of the 7 plans, so Tier-1 has no interactive style-match opt-in prompt.** (opencode.) Both tiers can use the feature via the deterministic `--style-samples` CLI flag, but Tier-1 discoverability is weaker than an `AskUserQuestion` opt-in. Not a tier-parity *violation* (the flag works in both tiers and 08-06 fills the four promoted-verb bodies), so sub-HIGH; worth a Tier-1 prompt during execution. (Note: `intake`/`new` is not one of Phase 8's four promoted verbs, so its workflow body is legitimately outside the 08-06 fill scope.)
- **[LOW] `archived` has no producer.** (claude.) SC-1 lists `archived` and the plans represent/honor it (stored terminal flag → derived passthrough), but no Phase-8 verb sets it (there is no archive verb among the locked 16). Representable and honored, never reachable — consistent with prior scope.
- **[LOW] `add <pdf>` fallback passes `input` (`Buffer|Uint8Array`) to `pymupdfShellout(buf: Buffer)`.** (claude.) Cosmetic type-width mismatch; `fs.writeFile` accepts both. No correctness impact.
- **[LOW] 08-06 `workflows/list.md` Tier-1 line ("reads `paper://library` (or runs the list verb)") leaves an "or" ambiguity.** (codex.) `<capability_check>` + tier-contract parity are still required, so not HIGH; tighten the final body during execution.
- **[LOW] `add <url>` URL safety is inherited from the `http.ts` chokepoint.** (codex.) Matches the plan's stated architecture and the non-negotiable (route through the chokepoint, never raw fetch); the plan does not bypass it, so any residual SSRF posture is an `http.ts` property, not a Phase-8 plan defect.

*Carry-over from cycles 1-2 (still LOW/MEDIUM, already adjudicated — NOT re-litigated): folderPath dropped from the registry; README copy/guard reconciled; 08-02 wave/dep fixed; `--yolo` skips the add remap prompt (safe-by-default, intentional); `python3` hardcoded shellout (Windows-dead but graceful-absent by design); pin guard checks installed version not the spec string; `open <name>` resolves by a non-unique key; the image-only `extractPdfText` fallback branch lacks a driving test; write.ts STYLE.json parse try/catch; fingerprint dedup-by-paperId on re-run; intake-style-producer source-grep skip-predicate heuristic.*

### Per-Reviewer Raw (cycle 3)

#### codex (ran — HIGH_COUNT: 0)

```
Prior HIGH families look genuinely resolved in the revised plan text.

- Style-match producer wiring is now present in 08-05: `intake --style-samples <dir>` calls `buildStyleProfile -> checkAndRegisterFingerprint -> writeStyleProfile`, writes per-paper `.paper/STYLE.json`, and surfaces `priorPapers` unconditionally before the write step can fail.
- Status lifecycle stuck-at-intake is now resolved by 08-01: `list` calls `deriveLibraryStatus(entry.folderPath, entry.status)` per paper, derives from `STATE.json` + section `PLAN.md`, renders real `sectioning X/Y`, honors `archived`, and never crashes on missing/corrupt state.

Findings:

[LOW] 08-06 workflow text is slightly loose where `workflows/list.md` says Tier-1 "reads `paper://library` (or runs the list verb)." The plan still requires `<capability_check>` and tier-contract parity, so this is not a HIGH, but the executor should avoid leaving "or" ambiguity in the final workflow body.

[LOW] 08-04 `add <url>` relies on the existing `httpFetch` chokepoint for URL safety. That matches the plan's stated architecture, but if `http.ts` does not already enforce SSRF protections, this feature inherits that risk. Not a Phase 8 plan HIGH because the non-negotiable only requires the chokepoint, and the plan does not bypass it.

No remaining or new HIGH findings found.

HIGH_COUNT: 0
```

#### claude (ran — HIGH_COUNT: 0)

```
I've now traced the load-bearing facts against the actual codebase. Key findings: `initState` has zero production call sites — neither the Tier-2 CLI verbs (`intake.ts`/`research.ts` are explicit "Tier-2 placeholder" stubs) nor the Tier-1 workflow body (`new.md` writes only `INTAKE.md`) nor the MCP tools (`paper_init_section` = `initSection`, not paper-level state) ever create a paper-level `STATE.json`/`paperId`. With that grounding, here is my review.

## Verification of the two prior HIGH families

Prior HIGH #1 — style-match producer wiring: GENUINELY RESOLVED (at the plan-contract level). 08-05 Task 2 Part B wires the producer onto the existing `intake` verb behind `--style-samples`, in the correct order: buildStyleProfile → checkAndRegisterFingerprint (priorPapers surfaced unconditionally, explicitly outside any `--yolo` gate, ordered build→check→print→write so a write failure can't swallow the notice) → writeStyleProfile(.paper/STYLE.json). Consumer half (08-05 Task 1, write.ts) reads .paper/STYLE.json and resolves voiceHint by PLAN voice_hint > style-match > default, on the agreed join(paperDir(paperRoot),'STYLE.json') path. RED test tests/intake-style-producer.test.ts asserts STYLE.json written + unconditional reuse notice + opt-in gating. The four library functions now have a live caller.

Prior HIGH #2 — status lifecycle derive-at-display: GENUINELY RESOLVED (at the plan-contract level). 08-01 builds deriveLibraryStatus(folderPath, storedStatus?), a never-throw resolver mirroring router.resolveNextAction's on-disk machine onto LIB-05 vocab, reusing readSectionState plus an outer backstop. list.ts derives per-paper at display, with a per-entry try/catch. PAPER registry retains folderPath; FINGERPRINT registry stays path/feature-free. RED test covers the full lifecycle + missing/corrupt-STATE.json never-throw cases.

Both fixes are correct against the contract "STATE.json is the authoritative per-paper source."

## New / remaining findings

[MEDIUM] LIB-04 (intake registers the paper in the global registry) ships with no test, and the whole library+producer chain is keyed on a paperId/STATE.json that no intake path actually creates. initState has zero production call sites: Tier-2 intake.ts writes only INTAKE.md; the Tier-1 new.md body writes only INTAKE.md; MCP exposes only paper_init_section. So at the moment intake runs, loadState throws StateNotFoundError, and 08-05's registration (id = paperId from STATE.json) and the producer's checkAndRegisterFingerprint(fingerprint, paperId, name) both fall into their acknowledged "no paperId → WARN-skip" branch — in the real flow the global registry is never populated (list shows nothing) and STYLE.json is never written. 08-00 omits the intake-library.test.ts that 08-RESEARCH itself called for, and the producer RED test can pass by pre-seeding STATE.json in the tmpdir, so the gap ships green-but-non-functional. Why MEDIUM not HIGH: the missing STATE.json bootstrap is a pre-existing, cross-cutting property of the current build (research/outline/verify are all placeholder stubs that never advance on-disk state), and Phase 8 correctly targets the accepted "authoritative STATE.json" contract — the same contract the cycle-2 derive fix was adjudicated against. Recommended (non-blocking): have 08-05 explicitly instruct intake to bootstrap STATE.json, and add a forcing test that intake registers a paper in the global registry without pre-seeding state.

[LOW] archived has no producer. SC-1 lists archived and the plans represent/honor it (stored terminal flag, derived passthrough), but no Phase-8 verb sets it (no archive verb among the locked 16). Representable and honored, never reachable.

[LOW] add <pdf> fallback passes input (Buffer|Uint8Array) to pymupdfShellout(buf: Buffer). Cosmetic type-width mismatch; fs.writeFile accepts both. No correctness impact.

## Concrete HIGH checklist (all clear)
Global style-feature cache — no. Cross-paper reuse hidden/conditional — no. add remap mutating status/verified_against_draft_hash — no. 17th verb — no. Sketch creating .paper/ before confirm — no. pymupdf shell injection — no. pdf-parse not pinned — no. Network in tests — no.

HIGH_COUNT: 0
```

#### opencode (ran — HIGH_COUNT: 0)

```
I've reviewed all 7 plans against the success criteria and non-negotiables.

Prior HIGH families:
- Style-match producer wiring — RESOLVED. 08-05 Task 2 wires intake --style-samples → buildStyleProfile → checkAndRegisterFingerprint → unconditional reuse notice → writeStyleProfile. 08-02 provides the library functions. 08-00 encodes a RED test.
- Status lifecycle stuck at intake — RESOLVED. 08-01 Task 1 deriveLibraryStatus maps STATE.json + section frontmatter onto LIB-05 (real X/Y sectioning, never-throw for corrupt/missing). list.ts in 08-01 Task 2 derives at display time. 08-00 RED test encodes the lifecycle + corrupt-input assertions.

Zero new HIGHs. All non-negotiables respected:
- Section-as-phase isolation (remap touches only assigned_sources[])
- Two-tier architecture (08-06 fills workflow bodies with <capability_check> blocks)
- Per-paper STYLE.json only (08-02 write path never imports pensmithDataDir; fingerprint registry hashes + identity ONLY)
- Unconditional cross-paper reuse surfacing (producer path prints notice outside any --yolo gate, per 08-05 Task 2)
- 16-verb bijection intact (UX02_VERBS verified length-16 across 08-01/04/06)
- Honest framing enforced by content guard (forbidden substrings excluded from README)
- Approval gates default-on (sketch confirm, add remap both require --yolo to skip)
- pdf-parse pinned exact with drift guard
- pymupdf shellout uses execFile arg array with internally-generated JSON.stringified path (no injection surface)

One MEDIUM gap: the intake workflow body (workflows/intake.md) is not modified in any of the 7 plans, so the Tier-1 workflow path lacks an interactive style-match opt-in prompt; both tiers can use it via --style-samples, but Tier-1 discoverability is weaker. No HIGH.

HIGH_COUNT: 0
```

#### gemini (UNAVAILABLE this cycle)

`gemini` exited without producing output (0 bytes stdout). stderr: `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products` — the same auth/tier failure as cycles 1-2 (it has NOT recovered), occurring during setup before any review ran (not a timeout). No findings from this reviewer this cycle.
