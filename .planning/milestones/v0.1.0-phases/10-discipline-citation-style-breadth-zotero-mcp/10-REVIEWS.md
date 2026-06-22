---
phase: 10
cycle: 2
reviewers: [codex, claude, opencode]
reviewers_unavailable: [gemini]
date: 2026-06-20
current_high: 1
cycle_1_high: 2
cycle_2_high: 1
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

---

## Cycle 2

**Reviewers run:** codex, claude, opencode (3-way quorum). **gemini unavailable again** (`IneligibleTierError: UNSUPPORTED_CLIENT` — free-tier Gemini Code Assist client no longer supported; attempted, empty output).

Re-review of the revised plans after cycle 1 addressed 2 HIGH (H1 Zotero used-as-source via injectable client seam + normalization + tests; H2 renderApa mandatory delegation to renderStyle('apa')).

Raw HIGH_COUNT per reviewer: codex=1, claude=1, opencode=1.
After careful judging (all three independently found the SAME single new HIGH; full agreement): **current HIGH = 1**.

### Synthesized Findings (cycle 2)

#### Prior-HIGH resolution status

- **H2 (renderApa double-registration) — RESOLVED.** Unanimous (codex, claude, opencode). 10-01 makes `renderApa` MANDATORILY delegate to `renderStyle(entries,'apa')`; deletes the standalone `apaRegistered` boolean + `ensureApaTemplate`; routes all registration through the single Map-guarded `ensureStyleTemplate` (sole registrar of `'pensmith-apa'`); re-points `_resetApaTemplateForTest` to `registeredStyles.delete('apa')` so it stays in lockstep with `_resetStyleTemplatesForTest`; and pins it with a same-process `renderApa`↔`renderStyle('apa')` byte-parity + no-collision regression test (10-01 Task 2). The "either is acceptable" defect (PATTERNS.md line 168) is explicitly overridden. The second `templates.add('pensmith-apa')` collision is genuinely eliminated. **Confirmed resolved.**

- **H1 (Zotero MCP used-as-source) — INTENT delivered, but the executable PROOF is broken by a 10-00 ↔ 10-03 contract contradiction (re-raised as new HIGH H3).** The cycle-1 fix added the right pieces (injectable `ZoteroClient`/`ZoteroItem` seam, `setZoteroClientForTest`, `toCandidate` normalizer mirroring semanticscholar, D-14 `'zotero-mcp'` variant, registry wiring, 10-04 production client wiring). Production-path used-as-source works because a real configured Zotero makes `isZoteroMcpPresent()` true. BUT the *tested, executable* proof the cycle-1 fix promised does not run as specified — see H3. So H1 is resolved on paper / in production, **not in its CI-executable test**, which was the whole point of the cycle-1 fix.

#### HIGH (genuine SC failure)

- **[HIGH] H3 — 10-00 ↔ 10-03 gating contradiction: the Zotero "used-as-source" proof test cannot pass on CI as written (SC3 executable coverage broken; blocks the required all-green `npm run check`).**
  *Plans 10-00 Task 2 leg (c) vs. 10-03 Task 1 STEP B.* **Full agreement: codex (HIGH), claude (HIGH), opencode (HIGH).**
  10-00's injected-client test (the H1 executable proof) runs on CI where `isZoteroMcpPresent()` is filesystem-gated to **false** (the plan says so explicitly: "unforceable from env on CI"). To still reach the pull→normalize path, 10-00 Task 2 (lines 218–220) mandates the 10-03 adapter use a pull-gate of **`isZoteroMcpPresent() || _client !== null`**, with `isZoteroAuthenticated()` requiring only `ZOTERO_API_KEY`. But 10-03 Task 1 STEP B (lines 214–223) specifies the OPPOSITE: `if (!isZoteroMcpPresent()) return [];` as the FIRST gate (no `|| _client` override), AND `isZoteroAuthenticated()` defined as `isZoteroMcpPresent() && !!process.env['ZOTERO_API_KEY']` — a SECOND gate that is also false on CI. Following 10-03's literal code, `search()` returns `[]` before reaching the injected client, so the test's `≥1 normalized SourceCandidate (.source==='zotero-mcp')` assertion FAILS. Because 10-04 requires a fully-green `npm run check` as the phase gate, the contradiction either fails the phase or forces an autonomous executor to silently deviate from 10-03's spec. The two plans disagree on the single most load-bearing piece of the H1 fix.
  **Fix direction:** make 10-03 STEP B's gating IDENTICAL to the contract 10-00's test encodes — pull-gate `if (!isZoteroMcpPresent() && !_client) return [];`, and decouple the auth check from FS presence when a client is injected (e.g. `isZoteroAuthenticated()` = `_client !== null ? !!process.env['ZOTERO_API_KEY'] : isZoteroMcpPresent() && !!process.env['ZOTERO_API_KEY']`, or a separate pull-path auth predicate that only needs the key). State that single gate definition in ONE place both plans cite, so the executor cannot implement the failing variant. (This is the minimal change; it preserves the absent/unauth/no-client → `[]` contract on every other path.)

#### MEDIUM (real risk; not a goal-threat)

- **[MEDIUM] M8 — Doctor tri-state PASS branch (configured+authenticated) remains unprovable on CI.** *10-03 Task 2.* codex + claude. `isZoteroAuthenticated()`'s FS-presence coupling means the probe's PASS path (and the adapter's authenticated path in isolation) can never be exercised on CI; 10-03 Task 2 correctly tests only ABSENT + the load-bearing no-leak sentinel. The no-leak non-negotiable IS proven; only the PASS branch is unverified. (Carried over from cycle-1 M5; still MEDIUM. A presence-injection seam for the probe, or documenting PASS as manual-only, would close it. NOTE: the H3 fix that decouples auth-from-presence on the client path would ALSO make this probe branch forceable if extended to the probe.)

- **[MEDIUM] M9 — `ris-write.ts` duplicates `CslAuthor`/`CslEntry`/`parseAuthor`/`toCsl` verbatim from `bibtex-write.ts`.** *10-02.* opencode. Future CSL-mapping changes must touch both files. Maintenance liability, not a goal-threat; the plan deliberately chose verbatim-copy for structural fidelity to a tested analog, which is defensible.

#### LOW (nits / quality)

- **[LOW] L7 — `setZoteroClientForTest` is the production injection point (10-04 wires the real MCP client through it) but the `*ForTest` name makes the production contract look accidental.** codex + claude. A clearer name or production alias would reduce future misuse. (10-03 already documents in the header that it is the production seam.)
- **[LOW] L8 — `.csl` procurement (10-00 Task 1) has no pinned commit/checksum** — committed bytes are whatever `styles-distribution@master` served. The XML/404 validator catches a bad fetch loudly, and once committed the bytes are frozen, so this is reproducibility hygiene, not a goal-threat (carried from cycle-1 L2). codex/claude.
- **[LOW] L9 — Cross-plan test coupling:** 10-00 leg (c) encodes 10-03's internal gate logic as a test contract in a different plan — brittle even after H3 is fixed; a single shared interface note would reduce coupling. claude.
- **[LOW] L10 — `CUSTOM_APA_NAME` may become dead code** after `renderApa` delegates (10-01 says "MAY keep" it; nothing imports it). opencode.
- **[LOW] L11 — zero-trace export test mechanism assumed, not confirmed:** 10-02 claims the test scans artifacts for the `'pensmith'` string (so a new `.ris` is covered); if it instead enumerates expected filenames, the `.ris` would trip it. Worth a one-line confirmation. opencode.

#### Adjudication notes (downgrades / dismissals)

- Cycle-1 H1 and H2 are **not** re-counted as current HIGHs: H2 is fully resolved; H1's residual risk is captured precisely by H3 (the proof-doesn't-run defect), not double-counted.
- Cycle-1 MEDIUMs M1 (resolveStyleName vs disciplines.json two-sources-of-truth), M2 (stale `.ris` after `pensmith add`), M3 (8th-adapter enumeration), M4 (`risCopied` required-field consumers), M6 (compile/export `citation_style` wiring), M7 (render-time locale fetch) were raised in cycle 1 and are NOT re-escalated by cycle-2 reviewers; they remain previously-adjudicated MEDIUM/LOW and out of the current HIGH count.
- opencode's L11 (zero-trace mechanism) and M9 (duplication) are genuine but non-goal-threatening; kept at LOW/MEDIUM.

### Per-Reviewer Raw (cycle 2)

#### codex (HIGH_COUNT: 1)

```
H1 is not resolved. H2 is resolved.

- [HIGH] H1 remains broken because the revised plans contradict themselves on the injected-client presence path. 10-00 correctly says the fake injected client must be treated as sufficient presence for CI: isZoteroMcpPresent() || _client !== null. But 10-03 Task 1 then instructs the actual adapter to do `if (!isZoteroMcpPresent()) return []` before checking auth/client, and isZoteroAuthenticated() also returns isZoteroMcpPresent() && !!ZOTERO_API_KEY. On CI, where filesystem presence is false, the injected-client test can never reach normalization. That means the executable used-as-source proof still fails or gets "fixed" only by deviating from the implementation plan. This is a direct SC3 threat.

- [LOW] The production injection API is named setZoteroClientForTest while 10-04 says Tier 1 uses it to wire the real MCP-backed client. That is confusing and makes the production contract look accidental. Not a launch blocker if implemented consistently, but a clearer name or alias would reduce future misuse.

- [LOW] Doctor tri-state coverage is mostly implementation-trusting because the configured-but-no-auth branch cannot be forced in CI. The plan still implements the branch, so this is not a success-criteria blocker, but it leaves one state weakly tested.

H2 resolution: 10-01 explicitly removes the independent APA registration path, requires renderApa(entries) to delegate to renderStyle(entries, 'apa'), replaces the standalone boolean with the shared registeredStyles Map, and adds same-process byte-parity/no-double-registration tests. That genuinely addresses the prior double-registration finding.

HIGH_COUNT: 1
```

#### claude (HIGH_COUNT: 1)

```
H2 (renderApa double-registration) — RESOLVED.
- renderApa keeps export name/async/single-arg signature + Array.isArray guard, then delegates with return renderStyle(entries, 'apa').
- ensureStyleTemplate is the SOLE registrar of 'pensmith-apa' (Map-guarded templates.add); standalone apaRegistered boolean + ensureApaTemplate deleted.
- _resetApaTemplateForTest re-pointed to registeredStyles.delete('apa'), so it and _resetStyleTemplatesForTest operate on one registry (no de-sync).
- Byte-parity structurally guaranteed + pinned by Task-2 renderApa↔renderStyle('apa') byte-identical + no-collision regression test. 10-01 explicitly overrides PATTERNS.md line 168's "either is acceptable" defect. Resolved.

H1 (Zotero MCP used-as-source) — NOT GENUINELY RESOLVED.
- [HIGH] The 10-00 used-as-source test cannot pass against the 10-03 adapter as written — the H1 proof is broken. 10-00 Task 2 leg (c) runs on CI where isZoteroMcpPresent() is FS-gated false (plan says so, calls it "unforceable from env on CI"). To reach the pull path, 10-00 mandates a present-gate of isZoteroMcpPresent() || _client !== null. But 10-03 Task 1 STEP B specifies the opposite — if (!isZoteroMcpPresent()) return []; as the FIRST guard, no || _client override. The injected-client test returns [] and the ≥1 normalized SourceCandidate assertion fails. Worse, a SECOND blocking gate: 10-03 defines isZoteroAuthenticated() as isZoteroMcpPresent() && !!process.env['ZOTERO_API_KEY'], so even if presence were overridden, if (!isZoteroAuthenticated()) return []; still returns [] on CI. 10-00's prose only addresses the presence gate and does not reconcile the auth gate's presence dependency. Net: the adapter spec fails its own RSCH-06 SC3 test, the phase cannot reach all-green npm run check (10-04), and "used-as-source when present" is asserted by a test that never exercises it. Fix: make 10-03 STEP B's gating identical to 10-00's contract — pull-gate isZoteroMcpPresent() || _client !== null, auth check that passes on !!ZOTERO_API_KEY when a client is injected — stated in one place both plans cite.

- [MEDIUM] 10-03's isZoteroAuthenticated() requiring isZoteroMcpPresent() leaves "authenticated" untestable in isolation on CI — doctor-probe PASS branch likewise never exercised on CI. 10-03 Task 2 asserts only PASS∈{PASS,WARN} + no-leak sentinel (acceptable), but PASS path unproven. Consider a presence-injection seam for the probe, or document PASS as manual-only.
- [LOW] 10-00 Task 1: 7 styles-distribution URLs "CONFIRMED HTTP 200 at planning time" but build-time curl has no pinned commit/checksum; XML/404 validator catches bad fetch, so acceptable for CC-BY-SA corpus; noting it.
- [LOW] 10-00 leg (c) encodes the adapter's internal gate logic as a cross-plan test contract — brittle; a shared interface note would reduce coupling.

Verdict: H2 resolved. H1 NOT genuinely resolved — 10-00's proof test and 10-03's adapter gating are mutually contradictory; the executable used-as-source assertion fails as specified.

HIGH_COUNT: 1
```

#### opencode (HIGH_COUNT: 1)

```
H1 Resolution: RESOLVED (intent) — adds setZoteroClientForTest, ZoteroClient/ZoteroItem, toCandidate normalizer, search() pulls+normalizes on present+auth+client and returns [] otherwise; D-14 union gains 'zotero-mcp'; used-as-source path executable + tested via injected fake client in 10-00.
H2 Resolution: RESOLVED — 10-01 rewrites renderApa to delegate to renderStyle(entries,'apa'), removes standalone apaRegistered/ensureApaTemplate, routes all registration through single Map-guarded ensureStyleTemplate; _resetApaTemplateForTest clears Map's 'apa'; byte-parity + collision tests prove lockstep.

NEW FINDING
[HIGH] 10-00 ↔ 10-03 contract mismatch: Zotero MCP present+authenticated test cannot pass on CI as written. 10-00 (Task 2 leg c) requires that when setZoteroClientForTest(client) is called AND ZOTERO_API_KEY is set, search() reaches the client pull path and returns normalized SourceCandidate[]. To make this work on CI (isZoteroMcpPresent() false), 10-00 encodes: present-gate = isZoteroMcpPresent() || _client !== null, auth = !!process.env.ZOTERO_API_KEY (standalone). But 10-03 Task 1 defines TWO gates that independently block on CI:
  if (!isZoteroMcpPresent()) return [];          // blocks when FS absent
  if (!isZoteroAuthenticated()) return [];        // isZoteroAuth = isZoteroMcpPresent() && !!ZOTERO_API_KEY → false on CI
Neither gate accounts for an injected _client. After 10-03 ships, the test un-skips (feature-detects setZoteroClientForTest) and then FAILS because search() returns [] at the first gate. SC3's "used-as-source when present" proof cannot be verified on CI. Fix: change presence gate to `!isZoteroMcpPresent() && !_client` and decouple isZoteroAuthenticated() from FS presence, matching the contract 10-00's test encodes.

[MEDIUM] Code duplication in 10-02: ris-write.ts copies CslAuthor, CslEntry, parseAuthor, toCsl verbatim from bibtex-write.ts instead of extracting to a shared module.
[LOW] 10-02 asserts zero-trace test stays green with .ris in export dir but doesn't verify the test's actual assertion mechanism (scan-for-'pensmith' vs filename enumeration) — confirm rather than assume.
[LOW] 10-01 CUSTOM_APA_NAME may become dead code after renderApa delegates.

HIGH_COUNT: 1
```

#### gemini

unavailable this cycle (`IneligibleTierError: UNSUPPORTED_CLIENT` — free-tier Gemini Code Assist client no longer supported; attempted, produced empty output).

---

## Cycle 3

**Reviewers:** codex, claude, opencode ran (3-way quorum). gemini UNAVAILABLE (IneligibleTierError: UNSUPPORTED_CLIENT — free-tier client retired). Aggregated by the orchestrator from captured raw outputs (the review subagent dropped its connection after the CLIs completed but before writing this section).

**current_high: 0 — CONVERGED.**

### Synthesized Findings (cycle 3)

All three usable reviewers independently returned HIGH_COUNT: 0. The 3 prior HIGHs are confirmed GENUINELY RESOLVED (claude traced all 4 Zotero gates against live source):

- **H2 (renderApa single registration): RESOLVED** — renderApa delegates to renderStyle(entries,'apa'); apaRegistered boolean + ensureApaTemplate deleted; single Map-guarded ensureStyleTemplate; _resetApaTemplateForTest clears the Map; byte-parity + no-collision regression test (10-01 Task 2).
- **H1 (Zotero used-as-source normalization): RESOLVED** — injectable ZoteroClient seam + setZoteroClientForTest + toCandidate (mirrors semanticscholar) + 'zotero-mcp' D-14 union variant + registry wiring; 10-00 Task 2 leg (c) injected-client+key test proves ≥1 normalized candidate (fails against the old []-everywhere stub).
- **H3 (10-00↔10-03 canonical gate): RESOLVED** — one 4-gate predicate owned by 10-03 STEP B, quoted verbatim in 10-00 leg (c); claude path-traced CI(inject+key)→normalize, absent→[], present+unwired→[], stray-key+absent→[]; doctor keeps its own FS+key tri-state (no contradiction).

Non-negotiables all hold (claude verified against source): D-19 ({Cite} from ./citations.js; suffixForCollision exported), D-07 (writeRis→atomicWriteFile), 16-verb bijection (Zotero stays source provider + probe), zero-trace (.ris plain text covered by existing scan), no-leak (key boolean-only), no new npm deps, offline/deterministic render.

### Remaining MEDIUM/LOW (carried to execution — non-blocking)

- [MEDIUM, codex] 10-00 ris-write.test.ts RED stub: use DYNAMIC import inside skipped behavioral tests (static ESM import of ../bin/lib/ris-write.js resolves before the skip-guard → would hard-crash Wave-0). Honor the "skip cleanly / no hard crash" Wave-0 contract.
- [MEDIUM, opencode] Committed CSL files parent <link> risk: if any of the 7 styles-distribution CSL files contain a <link> to a parent style, citation-js plugin-csl may attempt a NETWORK fetch at templates.add (breaking the offline-render non-negotiable). Executor must add a post-download validation asserting no external-URL <link> elements (the determinism/offline test is the safety net).
- [LOW] CUSTOM_APA_NAME may become an unused const after the H2 deletion → delete it or no-unused-vars fails the eslint gate (self-correcting at execution).
- [LOW] Zotero adapter search(query, limit) positional vs semanticscholar search(query, opts:{limit}) — cosmetic/forward-risk; single-arg orchestrator + leg-(c) test unaffected.
- [LOW] isZoteroAuthenticated() (key-only) vs doctor probe (FS+key) asymmetry — add a comment in the doctor probe pointing to the adapter definition to reduce future-maintainer confusion.
- [LOW] tier-contract negative-token list could add renderStyle/writeRis for thoroughness (length=16 is the primary guard).

All prior MEDIUMs M1-M9 correctly not re-litigated. No manufactured HIGHs.

### Per-Reviewer Raw (cycle 3)

#### codex (HIGH_COUNT: 0)
3 prior HIGHs genuinely resolved. [MEDIUM] ris-write.test.ts static-import-before-skip-guard → use dynamic import. [LOW] 10-04 live MCP end-to-end remains manual-only — make explicit in the implementation summary.

#### claude (HIGH_COUNT: 0)
Source-grounded verification of all 3 HIGHs + full 4-gate path trace + non-negotiables check (D-19/D-07/16-verb/zero-trace/no-leak/no-deps all hold). LOWs: search signature drift; CUSTOM_APA_NAME possibly-unused; CSL 200-status unverifiable-at-review (backstopped by Task 1 CSL-XML/404 validation gate).

#### opencode (HIGH_COUNT: 0)
H1/H2/H3 CONFIRMED RESOLVED. [MEDIUM] CSL parent <link> offline-fetch risk → post-download validation. [LOW] tier-contract negative list; isZoteroAuthenticated vs doctor duplication comment.
