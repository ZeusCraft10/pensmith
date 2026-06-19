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
