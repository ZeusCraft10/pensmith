---
phase: 10
cycle: 1
reviewers: [codex, claude, opencode]
reviewers_unavailable: [gemini]
date: 2026-06-20
current_high: 2
---

# Phase 10 — Cross-AI Plan Review (Cycle 1)

Auditing PLANS (not code) for the FINAL phase: discipline + citation-style breadth + Zotero MCP.
Reviewers run: **codex, claude, opencode** (3-way quorum). **gemini unavailable** this cycle
(`IneligibleTierError: UNSUPPORTED_CLIENT` — free-tier client no longer supported).

Raw HIGH_COUNT per reviewer: codex=3, claude=1, opencode=1.
After careful judging (dedup + severity reconciliation): **current HIGH = 2**.

---

## Synthesized Findings

### HIGH (genuine SC failures / non-negotiable violations)

- **[HIGH] H1 — Zotero MCP is never actually "used-as-source" (SC3 incompletely delivered).**
  *Plans 10-03 Task 1 + 10-04 Task 2.* **Agreement: codex (2 HIGH bullets), opencode (1 HIGH). claude flags the same gap at MEDIUM but explicitly notes this leg of SC3 has "zero executable coverage."**
  The `zotero-mcp` adapter `search()` returns `[]` in *every* path — including when Zotero is
  present AND authenticated. 10-04 Task 2 only edits `workflows/research.md` prose (capability_check
  + adapter-list note); no plan implements an actual Zotero MCP tool call, candidate normalization to
  `SourceCandidate[]`, or a test proving an authenticated Zotero contributes a candidate. Net result:
  after the final phase, Zotero is *detected*, *auth-reported by doctor*, and *absence-non-breaking* —
  but the "used-as-source when present" clause of SC3 has no executable path and no test.
  **Fix direction:** add a concrete step (in 10-03 adapter or 10-04 workflow body) that, when
  `isZoteroMcpPresent() && isZoteroAuthenticated()`, issues the real Zotero MCP tool call, maps results
  to `SourceCandidate[]`, and keeps absent/no-auth returning `[]`; cover it with a test (mock/inject the
  present+authenticated path). If the team intends to defer the live pull, SC3 / must_haves must be
  revised to say "registered + detected + auth-reported" rather than "used-as-source," so the plan and
  the success criterion agree.

- **[HIGH] H2 — `renderApa` / `renderStyle('apa')` double-registration sanctioned by the plan (breaks the locked renderApa contract + determinism/collision must-have).**
  *Plan 10-01 Task 1, step 6.* **Agreement: codex (HIGH), claude (HIGH). opencode raises the identical mechanism at LOW.**
  The plan permits `renderApa` to "remain self-contained" while `renderStyle` also registers
  `pensmith-apa`, justifying it with the false claim that "ensureApaTemplate's boolean and the Map both
  guard … only once." The two guards are independent over the *same* citeproc template name: if both
  `renderApa()` and `renderStyle(entries,'apa')` run in one process (the Task-1 behavior list requires
  both to work *and match*), the second `templates.add('pensmith-apa', …)` throws
  "template already registered" — exactly Pitfall 1, breaking the locked Wave-0 `renderApa` contract and
  the determinism/no-collision must-have. The plan's "either is acceptable" framing sanctions the
  breaking branch.
  **Fix direction:** make `renderApa` delegating to `renderStyle(entries,'apa')` (single shared
  registration path) MANDATORY; have `_resetApaTemplateForTest` also clear the Map; delete the
  "either is acceptable" wording and the false "only once" justification.

### MEDIUM (real risk; not a goal-threat)

- **[MEDIUM] M1 — `resolveStyleName` map duplicates `disciplines.json.defaultCitationStyle` (two sources of truth, no agreement test).** *10-01 / 10-03.* claude. The discipline→style mapping is hardcoded in `citations.ts` (10-01) and also written into `disciplines.json` (10-03); they can drift silently. Fix: have `resolveStyleName` read `disciplines.json`, or add a test asserting the two maps are identical.

- **[MEDIUM] M2 — `.ris` emitted only at `research.ts`, not at every `writeBibtex` call site (stale `.ris` after `pensmith add`).** *10-02.* claude (also RESEARCH Open Q1). `writeBibtex` is called from `add`/regen paths too; only `research.ts` gets the symmetric `writeRis`. After `pensmith add`, the bundled `.ris` is stale relative to `.bib`. Fix: emit `.ris` at every `writeBibtex` call site (add, compile-regen).

- **[MEDIUM] M3 — Registering an 8th, search-exposing adapter may break adapter-count / "all adapters cassette-backed" assumptions.** *10-03 Task 1.* claude (codex raises the parallel `ExportResult` consumer concern, M4). `zotero-mcp` exposes `search` but has no cassette; an "iterate all adapters against cassettes" test would now call it. No plan audits for a hard-coded adapter set/count. Fix: grep for adapter-count / enumeration assertions and update them.

- **[MEDIUM] M4 — `ExportResult.risCopied` added as a required field may break literal constructors / consumers.** *10-02 Task 2.* codex. Making `risCopied: boolean` required can break any `ExportResult` literal or consumer not updated. Fix: add a repo-wide check/update of `ExportResult` consumers (or confirm the field-add matches the existing `bibCopied` precedent everywhere).

- **[MEDIUM] M5 — Configured-path probe branches (PASS + CONFIGURED_NO_AUTH) ship unverified.** *10-03 Task 2.* codex + claude. The tri-state probe's two configured branches are never exercised (plan concedes presence is "hard to force on CI"; tests cover only ABSENT + the no-leak sentinel). The no-leak property IS proven; the branch logic is not. Fix: inject/mock `isZoteroMcpPresent()` so ABSENT / CONFIGURED_NO_AUTH / PASS are each forced deterministically. (Severity capped at MEDIUM: the load-bearing no-leak non-negotiable is genuinely tested; only branch coverage is missing.)

- **[MEDIUM] M6 — No plan wires `renderStyle`/`resolveStyleName` into the compile/export bibliography path keyed off `config.toml` `citation_style`.** *10-04 / cross-phase.* claude. SC1's literal "each render via citation-js" is satisfied at the unit level, but a user who picks "IEEE" has no plan-guaranteed path making the *exported bibliography* come out in IEEE (10-03 scopes consumption out). Fix: confirm an existing consumer already dispatches on `citation_style`; if none exists, SC1's user-facing leg is unwired. (MEDIUM, not HIGH: the SC1 text as written — "render via citation-js + bundled templates" — is met by `renderStyle`; the gap is end-to-end wiring, which may already exist outside this phase. Worth confirming before sign-off.)

- **[MEDIUM] M7 — Render-time locale fetch not explicitly proven blocked.** *10-01 Task 1.* opencode. The render relies on `lang:'en-US'` + the bundled citeproc locale, but no plan adds an explicit locale-injection or a network-blocked determinism test proving `@plugin-csl` never fetches `locales-en-US.xml`. Determinism/offline is a non-negotiable. (MEDIUM not HIGH: this is the *same* path Phase-3 `renderApa` already ships and the project's offline test posture already exercises; risk is "extended to 8 styles without a fresh offline assertion," not a known online fetch.) Fix: add a determinism/offline test with network blocked, or explicitly configure the bundled locale.

### LOW (nits / quality)

- **[LOW] L1 — 10-00 Task 3 / 10-01: skip-guard on a not-yet-exported `renderStyle` must use dynamic import + runtime feature-detect, else a static named import hard-fails (TypeError) instead of skipping.** codex + claude. (The 10-00 plan already prescribes dynamic `await import` and an "if needed" feature-detect; reviewers want the feature-detect made mandatory.)
- **[LOW] L2 — 10-00 Task 1: `.csl` procured from `styles-distribution@master` (unpinned HEAD); procurement not reproducible, and all-7-render-under-pinned-`citeproc@2.4.63` is assumed, not gated.** claude (raised at MEDIUM; downgraded — once committed the bytes are frozen and 10-01 render tests act as the gate, so this is a reproducibility/robustness nit, not a goal-threat). Consider pinning to a commit SHA.
- **[LOW] L3 — Chicago edition mismatch (full-note = CMOS 17th, author-date = CMOS 18th) shipped without user-facing note.** opencode. SCs don't specify edition; both Chicago variants render. Add a disclosure note.
- **[LOW] L4 — 10-00 Task 1 uses `curl`; host is win32.** opencode. Use a portable fetch (Node script / `Invoke-WebRequest`) if `curl` is absent. (Bash tool here is Git Bash, which ships `curl`; minor.)
- **[LOW] L5 — 10-02: `(cite as {format})` assertion + `spec:'new'` option keys lose TS validation; RED test's `TY  - JOUR` assertion is the backstop.** opencode. RESEARCH live-verified `spec:'new'` output, and the RED test asserts it — covered.
- **[LOW] L6 — 10-03 Task 3: disciplines.json field VALUES (sourcePreference contents, sectioningConvention) only presence-checked; `sociology` densityTarget.center diverges from citation-density.ts.** codex + claude + opencode. Schema completeness is the contract; values are author-chosen.

---

## Per-Reviewer Raw

### codex (HIGH_COUNT: 3)

```
[HIGH] 10-03 Task 1: The Zotero adapter’s “present path” still returns `[]`, and the plan says real MCP tool calls happen only in `workflows/research.md` in 10-04. But 10-04 only documents the capability check; it does not implement any actual Zotero MCP pull. This fails success criterion 3: “Zotero MCP is detected / authenticated / used-as-source when present.” Fix direction: add an implementation step that actually invokes the available Zotero MCP/library source when configured and authenticated, maps results to `SourceCandidate[]`, and keeps absence/no-auth returning `[]`.

[HIGH] 10-04 Task 2: The workflow change is documentation-only and explicitly says Tier-2 `zotero-mcp` search returns `[]` unless present/authenticated, with real results pulled at workflow/capability level. No concrete code path, MCP call contract, candidate mapping, tests, or cassette/offline adapter test is specified. This means Zotero can be detected and reported by doctor but never actually “used-as-source.” Fix direction: specify the MCP tool call surface, fallback behavior, candidate normalization, and a test proving authenticated/present Zotero contributes candidates.

[HIGH] 10-01 Task 1: The plan says renderApa may remain self-contained while renderStyle also registers `pensmith-apa`; that can double-register the same template if `renderApa()` and `renderStyle(entries, 'apa')` are both called in one process. The text later recommends delegating, but still permits the unsafe path. Fix direction: require one shared registration path for APA, with `renderApa` delegating to `renderStyle(entries, 'apa')` or both functions using the same `registeredStyles` map.

[MEDIUM] 10-03 Task 2: The doctor tri-state is not fully testable as written because configured-no-auth depends on real local MCP config. The plan only asserts generic PASS/WARN and no-leak behavior, so the “configured but no `ZOTERO_API_KEY`” branch could regress unnoticed. Fix direction: expose/inject the presence check for tests or add a small test helper so ABSENT, CONFIGURED_NO_AUTH, and PASS are each forced deterministically.

[MEDIUM] 10-00 Task 3: The renderStyle skip-guard guidance is loose around missing named exports. A static named import of a not-yet-exported `renderStyle` would fail module linking before a test can skip. Fix direction: require dynamic import plus runtime feature detection until 10-01 lands.

[MEDIUM] 10-02 Task 2: `ExportResult` is extended with required `risCopied: boolean`; this can break any tests or call sites constructing `ExportResult` literals unless all are updated. Fix direction: include a repo-wide check/update task for `ExportResult` consumers, or make the field optional only if that matches existing patterns.

[LOW] 10-03 Task 3: The plan says the committed JSON is “the source of truth for field VALUES” and tests may be tweaked to match it. That weakens the schema test’s usefulness. Fix direction: keep tests focused on invariant fields and known required values like `computer-science.defaultCitationStyle === 'ieee'`, not implementation convenience.

HIGH_COUNT: 3
```

### claude (HIGH_COUNT: 1)

```
Plan 10-00 (Wave 0 RED scaffold + CSL procurement)
- [MEDIUM] Task 1 procures all 7 .csl files from styles-distribution @ master (HEAD), unpinned. Once committed render is deterministic/offline, but procurement is not reproducible; pinned citeproc@2.4.63 is older than the 2024-updated chicago-author-date.csl (CMOS 18th) and recent IEEE/AMA styles; plan only assumes all 7 render (RESEARCH live-verified APA only). If citeproc@2.4.63 rejects any style at registration, SC1 is incompletely delivered, not caught until 10-01. Fix: pin to a specific styles-distribution release/commit SHA known-compatible with citeproc@2.4.63, treat "all 7 render under the pinned engine" as a verification gate.
- [LOW] Task 3 render tests meant to SKIP until renderStyle ships, but shouldSkip keys on citations.ts/apa.csl/fixture presence (all TRUE after Phase 3). A missing renderStyle named export imports as undefined → test hard-fails (TypeError) rather than skips. Plan only optionally prescribes feature-detect. Make the feature-detect on the renderStyle symbol mandatory.

Plan 10-01 (multi-style renderStyle)
- [HIGH] Task 1 step 6 (renderApa generalization) contains a false correctness claim that will throw citeproc "template already registered". apaRegistered (boolean) guards renderApa's path and registeredStyles (Map) guards renderStyle's path — independent guards over the SAME citeproc template name pensmith-apa. If renderApa stays self-contained AND renderStyle(entries,'apa') is also called in the same process, the second templates.add('pensmith-apa', …) throws — breaking the locked renderApa Wave-0 contract and the determinism/collision-guard must-have. Plan offers "either is acceptable," sanctioning the breaking branch. Fix: make renderApa delegate to renderStyle(entries,'apa') (single registration path) MANDATORY, have _resetApaTemplateForTest also clear the Map, delete the "either is acceptable" framing and the false "only once" justification.
- [MEDIUM] resolveStyleName hardcodes a discipline→style map inside citations.ts while 10-03 writes defaultCitationStyle into disciplines.json. Two sources of truth, no test asserting they agree — will drift. Fix: have resolveStyleName read disciplines.json, or add a test asserting the two maps are identical.

Plan 10-02 (RIS writer + export bundle)
- D-19, D-07, zero-trace, empty-array→zero-length all correctly preserved. SC2 (.bib + .ris bundled) delivered and tested. No HIGH.
- [MEDIUM] writeRis added only to bin/cli/research.ts. RESEARCH Open Q1 says .ris should also regenerate wherever writeBibtex is called — notably pensmith add (and compile-time .bib regen). Plan does not touch those call sites → after pensmith add the bundled .ris is stale relative to .bib. Fix: emit .ris at every writeBibtex call site.

Plan 10-03 (Zotero adapter + tri-state probe + disciplines.json)
- ZOTERO_API_KEY boolean-only check, search() returns [] never throws, no 17th verb, no http import — all correctly enforced. No HIGH.
- [MEDIUM] Registering 'zotero-mcp' as the 8th adapter (exposing search) may break consumers/tests assuming 7 adapters or that every searchable adapter is cassette/HTTP-backed. Plan never mentions auditing for a hard-coded adapter set/count. Fix: grep for adapter-count/enumeration assertions and update them.
- [MEDIUM] SC3's "used-as-source when present" satisfied only by prose added to workflows/research.md (10-04); adapter returns [] in all tiers and no test proves any Zotero candidate enters the pipeline. Detection, doctor auth-report, absence-non-breaking genuinely delivered/tested; "used as source" is documentation-only — zero executable coverage.
- [MEDIUM] tri-state probe PASS and CONFIGURED_NO_AUTH branches never exercised by a test forcing isZoteroMcpPresent()===true (plan concedes "hard to force on CI"; tests only absent path + no-leak sentinel). Configured-path logic ships unverified. Fix: inject/mock presence to cover both configured branches.
- [LOW] disciplines.json field values (sourcePreference contents, sectioningConvention) only presence-checked, never validated for correctness.

Plan 10-04 (intake 8-style + WN-3 hash re-pin + research.md fallback + tier-contract)
- WN-3 atomic dual-surface hash re-pin correct; 16-verb bijection re-assertion sound. No HIGH.
- [MEDIUM] Neither this plan nor any sibling wires renderStyle/resolveStyleName into the compile/export bibliography path keyed off config.toml citation_style. 10-03 scopes consumption out. Result: intake offers 8 styles, renderStyle renders all 8 at unit level (SC1 literal text satisfied), but a user who picks "IEEE" has no plan-guaranteed path making the exported bibliography actually IEEE. Confirm an existing consumer already dispatches on citation_style, or the style choice is cosmetic.
- [LOW] workflows/research.md keeps Zotero MCP in capability_check required[] while genuinely optional; correctness depends entirely on degrade_if_missing. Consider moving it out of required[].

Overall: plans are careful; non-negotiables each explicitly addressed. The single goal-threatening defect is the renderApa/renderStyle('apa') double-registration in 10-01.

HIGH_COUNT: 1
```

### opencode (HIGH_COUNT: 1)

```
[HIGH] Plan 10-03 Task 1 + Plan 10-04 Task 2: Zotero MCP is never actually "used-as-source".
SC3 requires "detected / authenticated / used-as-source when present." The adapter's search() returns [] in ALL cases — including when Zotero IS present and authenticated. Plan 10-04 only updates documentation in research.md's capability_check; implements zero actual Zotero data-pulling code at the workflow level. After Phase 10, Zotero is detected, authenticated, doctor reports state — but NEVER feeds a single source into research. Fix: (a) implement actual Zotero MCP tool calls in search() when present+authenticated, or (b) implement the real pull at workflow level (not just capability_check docs), or (c) acknowledge the deferral and revise SC3 / must_haves.

[MEDIUM] Plan 10-01 Task 1: No locale configuration — offline/deterministic render not proven. Uses lang:'en-US' and claims "no fetch" but provides no mechanism guaranteeing citation-js never fetches locale data from the CSL locales repo at render time. Fix: add locale config to plugins.config.get('@csl').locale from a bundled file, AND a determinism test with network blocked.

[MEDIUM] Plan 10-00 Task 1: Chicago edition mismatch — fullnote = CMOS 17th, author-date = CMOS 18th. Shipping two parallel Chicago styles from different editions → formatting inconsistencies. Fix: fetch matching editions or document the difference.

[LOW] Plan 10-02 Task 1: RIS format options { spec:'new', format:'text' } not independently verified; option keys differ from common citation-js patterns (type vs spec). If unrecognized, may silently produce old-spec RIS, failing TY  - JOUR.
[LOW] Plan 10-01 Task 1: Dual registration-path complexity — if renderApa kept self-contained, _resetApaTemplateForTest must clear the Map too or renderApa-then-renderStyle('apa') after reset triggers "already registered".
[LOW] Plan 10-02 Task 1: (cite as {format}) assertion loses compile-time validation of option keys.
[LOW] Plan 10-00 Task 1: curl may not be available on Windows (win32). Consider Invoke-WebRequest or Node script.
[LOW] Plan 10-03 Task 3: sociology densityTarget.center (15) has no entry in citation-density.ts DISCIPLINE_TARGETS — two data sources diverge.

HIGH_COUNT: 1
```

### gemini

unavailable this cycle (`IneligibleTierError: UNSUPPORTED_CLIENT` — free-tier Gemini Code Assist client no longer supported; attempted, produced empty output).
