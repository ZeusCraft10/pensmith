---
phase: 6
cycle: 1
reviewers: [codex, gemini, claude, opencode]
date: 2026-06-17
high_count: 3
---

# Phase 6 — Cross-AI Plan Review (Cycle 1)

Four external reviewers (codex, gemini, claude, opencode) audited the five Phase-6
PLAN files (06-01 … 06-05) against the goal, the five success criteria, and the
non-negotiables. All four ran and returned usable output (exit 0, non-empty).

The judge below dedups across reviewers, keeps `[HIGH]` only where a finding genuinely
maps to a success-criterion failure or a non-negotiable violation, downgrades
over-escalated nits (with reason), and upgrades a real goal-threat raised at lower
severity (with reason). For the zero-trace concern specifically, each claim was
verified against the actual plan text plus 06-RESEARCH.md and 06-VALIDATION.md.

---

## Synthesized Findings

### HIGH

- **[HIGH] PDF (and unverified `.tex`) zero-trace is not delivered or automatically tested — fails success criterion 1.**
  *Reviewer agreement: codex, gemini, claude, opencode (4/4).* Criterion 1 requires the
  zero-trace test to scan **every** export format including **PDF metadata**, and
  06-VALIDATION.md line 44 restates "scan every format … (incl. .docx ZIP entries, PDF
  metadata) → 0." But 06-04 Task 1 calls `zeroTracePatch` only for `format==='docx'`;
  PDF relies solely on `--variable pdfcreator=/pdfproducer=/pdfauthor=`, which the plan's
  own Pitfall 3 / threat T-06-04-02 admit "cannot fully suppress" XMP, and the real PDF
  zero-trace tooling (qpdf / custom template) is **deferred to a later phase**. 06-01
  Task 2 Test C only asserts `.md` is trace-free and that `.tex`/`.docx` *skip* on a
  Pandoc-absent machine; there is no automated scan of real PDF or `.tex` output.
  06-VALIDATION.md routes all live-format zero-trace to **manual-only** ("CI cannot
  exercise the live Pandoc path here"). Net effect: the automated gate proves zero-trace
  only for `.md` + a synthetic `.docx` fixture; PDF is acknowledged-unreliable AND
  unimplemented this phase, so even the manual test would likely fail. This is a direct
  miss of criterion 1 and of the "ZERO exported-document trace — THE gating test"
  non-negotiable for at least one required format (PDF).
  *Note on `.tex`:* lower real-leak risk than PDF — 06-RESEARCH states `.tex` is "clean
  by construction" (pure source LaTeX, no injected header), so the `.tex` gap is
  "untested" rather than "broken." PDF is the load-bearing part of this finding.
  **Fix direction:** either (a) scope PDF out of criterion 1 explicitly in the
  ROADMAP/PRD for this phase and re-state the criterion as "docx + md automated; tex/pdf
  deferred," OR (b) add a committed offline PDF fixture + a metadata-scan test and a real
  PDF scrub step (qpdf re-linearize / XMP strip) so PDF is genuinely CI-gated. Do not
  ship the phase claiming criterion 1 met while PDF zero-trace is deferred.

- **[HIGH] `zeroTracePatch` field coverage + the `pensmith` sweep scope are too narrow, and the fixture is co-authored with the patch so the test cannot catch real-Pandoc leaks — metadata-leak vector the gating test would miss (criterion 1 / non-negotiable).**
  *Reviewer agreement: codex, gemini, claude (3/4).* Three independent gaps with one root
  cause: (1) 06-04 Task 1 blanks only `dc:creator`, `dc:title`, `cp:lastModifiedBy`,
  `cp:keywords`, the dcterms timestamps, and `app.xml <Application>` — it does **not**
  touch `dc:subject`, `dc:description`, `cp:category`, `cp:contentStatus`, `cp:revision`,
  or `app.xml <Company>`/`<Manager>`/`<Template>`, all of which Word/templates routinely
  populate with identifying values. (2) The literal-`pensmith` defense-in-depth sweep
  runs **only on entries whose name ends in `.xml`**, missing `_rels/.rels` (no `.xml`
  extension) and any non-`.xml` part; it also strips only the literal string "pensmith",
  not other identifying values. (3) The regexes (`/<dc:creator>[^<]*<\/dc:creator>/g`)
  won't match self-closing (`<dc:creator/>`) or attribute-bearing
  (`<dc:creator xml:lang="en">`) variants that real Pandoc/Word emit. The deeper problem
  (claude): 06-01 Task 1 hand-authors `sample-zero-trace.docx` "using the exact namespace
  declarations from 06-RESEARCH Pattern 1 so the regex targets match," and 06-04 cleans it
  with those same regexes — the test is a closed loop validating the patch only against the
  shape the patch already handles. Because Pandoc is absent, the scrub is never exercised
  against a real artifact. The zero-trace test (06-01) asserts only on the same blanked
  field set, so any identifying value (not literally "pensmith") in an unhandled field is
  both unstripped and unverified. This is exactly the "metadata-leak vector the zero-trace
  test would miss" called out as HIGH-class.
  **Fix direction:** expand the blank set to the full Dublin Core + cp + extended-property
  identifying fields; widen the sweep to ALL non-binary entries (not just `.xml`),
  including `_rels/.rels` and `docProps/custom.xml`; make the regexes tolerant of
  self-closing/attribute forms (or parse the XML); and harden the fixture so it carries an
  identifying value in at least one field the patch is NOT yet coded to handle, so the test
  fails until coverage is complete (turn the tautology into a real negative control).

- **[HIGH] The Pass-2 UNSUPPORTED → DONE-09 gate feed (`readSectionUnsupported`) is untested and silently swallows parse failures; the only integration test runs `--yolo` (gate skipped) — fails success criterion 5.**
  *Reviewer agreement: claude (1/4); upgraded by judge — verified against 06-05 text.*
  06-05 Task 2 specifies `readSectionUnsupported` as a markdown-table parser over
  `.paper/sections/*/VERIFICATION.md`, "Defensive: missing files / no Pass-2 section /
  malformed rows → empty array, never throw." But `tests/export-gate.test.ts` (06-05
  Task 1) exercises `collectGateIssues`/`runDoneGate` only with **injected** issue data —
  never through `readSectionUnsupported`. The single integration path (06-05 Task 3 bespoke
  tier-contract parity test) runs `pensmith done --yolo`, which **skips the gate entirely**.
  So the disk→gate wiring has zero coverage. If the on-disk `## Pass-2` table shape diverges
  from what the parser expects, UNSUPPORTED claims are silently dropped, `hasIssues` becomes
  false, the user sees the generic "clean paper" confirm, and exports over unsupported
  citations with no test catching it. DONE-09 is the SOLE escape valve reconciling the Core
  Value with VRFY-07; a silent miss in its issue-detection defeats that reconciliation —
  criterion 5 ("per-issue summary when any UNSUPPORTED … present") is not actually
  guaranteed. Raised by only one reviewer but verified true and mapping directly to a
  criterion-5 failure, so upgraded to HIGH.
  **Fix direction:** add a unit test that writes a real section `VERIFICATION.md` with a
  `renderPass2Section`-shaped table containing an UNSUPPORTED row, calls
  `readSectionUnsupported`, and asserts the row is parsed; add a non-`--yolo` gate
  integration test (inject `approve`) that drives the gate from real on-disk Pass-2 data so
  the parser→gate path is covered; and pin the Pass-2 table contract (or use a structured
  artifact) so the parser cannot silently desync from the writer.

### MEDIUM (notable, not goal-blocking)

- **[MEDIUM] `renderHonestyReport` composes the before/after percent lines in code while reading only the `## Note` blockquote verbatim — spec inconsistency with 06-01 (which says the locked file provides "before/after output lines + the note").** *(codex raised at HIGH; downgraded.)* The non-negotiable honest-framing claim ("improves prose, not evades detection") IS the `## Note`, and it IS verbatim-locked and byte-pinned; the before/after lines are mechanical (`reads as XX% AI-generated (backend)`) and carry no detection claim. So the non-negotiable is satisfied; the issue is an internal spec mismatch worth reconciling (either lock the before/after templates too, or correct 06-01's artifact description).

- **[MEDIUM] The transparency-only guard is a weak denylist; deliberate framing drift can pass a re-pin.** *(claude.)* 06-03 Task 2 asserts the note contains no "evade/beat/defeat" tokens, and the SHA-256 byte-pin only blocks *accidental* drift — an intentional edit re-pins cleanly, so "makes your text undetectable" would pass the denylist and re-pin. Hardening: add "undetectable"/"bypass"/"fool"/"pass as human" to the denylist AND assert the note still contains the required transparency assertion.

- **[MEDIUM] Regex-based XML patching is brittle across Pandoc/Word versions.** *(gemini; folded into HIGH #2 as same root cause but retained here as a standalone hardening note — prefer a lightweight XML parse over regex-only, since jszip is already in the tree.)*

- **[MEDIUM] Markdown-table parsing for Pass-2 rows is fragile (cell alignment/spacing).** *(gemini; folded into HIGH #3 — the reliability concern is the same as the untested-feed concern.)*

- **[MEDIUM] Offline DDG cassette fallback ("otherwise use the single cassette entry") can make every queried phrase return the same hits, inflating advisory noise into DONE-09.** *(codex.)* Make unmatched cassette queries return empty deterministically.

- **[MEDIUM] PDF/`--format pdf` silently degrades to markdown when the engine is absent — no explicit error/consent.** *(opencode.)* User who requested `.pdf` receives `.md` with only a banner. Consider a typed `ExportFormatUnavailableError` surfaced clearly, or an explicit "exported as markdown instead" line.

- **[MEDIUM] Wave-0 module-existence test stance is internally inconsistent (06-01 Task 2 acceptance criteria).** *(codex.)* The plan first says existence tests "always run and fail," then says "mirror Phase-5, maybe skip." Ambiguity could yield a permanently-red Wave 0 or weaker tests that don't pin module creation. Resolve to one stance ("mirror known-bad-pass2.test.ts exactly").

### LOW

- **[LOW] before/after honesty degrades to before-only when the humanizer is absent.** *(codex raised at HIGH; downgraded — this is the intended skip-clean behavior; "after = N/A" is explicitly allowed by criterion 2/3.)*

- **[LOW] JSZip byte-pin determinism across OS/Node/zlib is assumed, not guaranteed.** *(gemini, claude.)* DEFLATE output can vary; a regenerate on a different platform breaks the pin. Annoyance, not a goal failure (the binary is committed once).

- **[LOW] The fixture embeds a real-looking name ("Akhil Achanta") as the synthetic trace.** *(codex, claude.)* Test-only and excluded from `package.json` files[]; a synthetic placeholder ("Trace Sentinel") would avoid shipping a real PII string and clarify intent.

- **[LOW] md-only fallback writes `outputDir/<basename>.md`, which can overwrite the input `DRAFT.md` in place.** *(opencode.)* Atomic-write-mitigated but surprising; a distinct output name avoids confusion.

- **[LOW] `parseDdgHtml` regex breaks silently if DDG changes HTML structure.** *(opencode.)* Advisory check stops working with no signal; low severity since plagiarism never blocks.

### Positives confirmed by reviewers (no action)

The Pandoc-independence requirement for the *mechanism* IS met (the zero-trace test patches a
committed ZIP, never invokes Pandoc); no live network in tests (cassettes + `isOfflineMode`);
the locked-16 verb set is preserved (`done` promoted, no 17th verb, `cli-verbs.test.ts`
guards 16); the DONE-09 gate **logic** (always-confirm, `--yolo`-only skip, injectable
approver) is correctly designed and unit-tested; the jszip supply-chain risk is addressed
(slopcheck [OK], no postinstall, lockfile pin). No reviewer found a 17th-verb violation, a
network-in-tests violation, or a gate that is bypassable without `--yolo` in the gate logic
itself (the bypass risk is in the *issue-detection feed*, HIGH #3, not the gate).

---

## Per-Reviewer Raw

### codex (exit 0)

```
[HIGH] 06-04 Task 2 / verification: PDF zero-trace is explicitly deferred to "manual-only" and skipped when the PDF engine is absent, but success criterion 1 requires automated zero-trace coverage for every export format, including PDF metadata. The plan therefore cannot prove "ZERO pensmith trace in any exported document" for `.pdf`.

[HIGH] 06-01 Task 2 + 06-04 Task 2: TEST-10 does not scan every export format. It validates a patched fixture `.docx`, a constructed `.md`, and treats `.tex/.docx` Pandoc paths as manual or skipped when Pandoc is absent. The phase goal requires automated scanning of `.docx/.pdf/.tex/.md`, so the planned gate can pass while `.tex` or live Pandoc-generated artifacts leak traces.

[HIGH] 06-04 Task 1: `zeroTracePatch()` only blanks a narrow subset of DOCX metadata (`dc:creator`, `dc:title`, `cp:lastModifiedBy`, `cp:keywords`, timestamps, `Application`) and sweeps only `.xml` entries for the literal `pensmith`. It misses common identifying DOCX metadata fields such as `dc:subject`, `dc:description`, `cp:category`, `cp:contentStatus`, `Manager`, `Company`, and XML relationship files ending in `.rels`. The zero-trace test fixture is too narrow, so leaks outside the fixture shape could survive.

[HIGH] 06-04 Task 1: The defense-in-depth sweep removes only the literal string `pensmith`, not other identifying metadata values. The success criterion says zero-trace scans for "pensmith + identifying metadata," including docProps entries. A DOCX with a real author/company/title not equal to `pensmith` could pass the string sweep while still exposing identity.

[HIGH] 06-03 Task 2: `renderHonestyReport()` hardcodes the before/after output prose in code and reads only the `## Note` blockquote from `references/honesty-framing.md`. 06-01 says the locked file provides "before/after output lines + the note" and the success criterion requires honest framing rendered verbatim from a locked SHA-pinned file. This plan leaves part of the user-visible framing driftable in code.

[HIGH] 06-05 Task 2: The done pipeline runs `scoreHonesty(before)` before humanizing, but `scoreHonesty(after)` is only run when `FINAL.md` exists; absent humanizer produces `after=null`. The phase goal says GPTZero honesty score is computed before AND after humanize, while humanizer absence should skip cleanly. If "after" is required on the post-humanizer candidate, the plan needs an explicit second score on the unchanged draft when humanizer is absent, or a clearly tested locked "after skipped because absent" contract. As written, the before/after success criterion can silently degrade to before-only.

[MEDIUM] 06-01 Task 2: The RED scaffold guidance is internally inconsistent about module-existence tests: it first says existence tests always run and fail, then acceptance criteria says mirror Phase 5 and maybe skip them. This ambiguity can produce either a permanently red Wave 0 or weaker tests that do not actually pin required module creation.

[MEDIUM] 06-02 Task 2: Offline DDG cassette fallback says "match by path/q when present; otherwise use the single cassette entry." That can make every queried phrase appear to have the same plagiarism hits, inflating false positives and feeding DONE-09 with advisory noise. It should distinguish unmatched cassette queries deterministically.

[MEDIUM] 06-05 Task 2: `readSectionUnsupported()` parses Markdown Pass-2 tables from section `VERIFICATION.md` files "best-effort." If table escaping or formatting changes, UNSUPPORTED citations may be missed and the DONE-09 gate will not show the required per-issue summary. A structured artifact or parser contract should be required.

[LOW] 06-01 Task 1: The fixture uses a real personal-looking creator name, even though it is test-only. The threat model accepts it, but a synthetic value such as `Fixture Author` would reduce unnecessary identity-like data while still testing metadata scrubbing.

HIGH_COUNT: 6
```

### gemini (exit 0)

```
This review evaluates the five plan files for Phase 6 of the Pensmith project against the established goals, non-negotiables, and build-machine constraints.

### [HIGH] PDF Zero-Trace Automated Test and Implementation Gap
The PRD and Phase 6 Goal explicitly require that the zero-trace test (TEST-10) scans "every export format... AND PDF metadata" and that the implementation ensures "ZERO pensmith trace" in all exports. However, **Plan 06-01 Task 2** omits PDF from the automated test suite detailed in the action block, and **Plan 06-04 Task 2** explicitly treats PDF as "manual-only verification," "NOT a CI-gated format," and defers the necessary zero-trace tools (like `qpdf`) to a later phase (06-04 Threat Model T-06-04-02). This is a direct failure to deliver a primary success criterion and a non-negotiable "Done" gate.

### [HIGH] Metadata Leak Vector: Incomplete ZIP Entry Sweep
**Plan 06-04 Task 1** implements a "sweep" that only replaces "pensmith" in entries "whose name ends in .xml". This will miss critical metadata/relationship files such as `_rels/.rels` and `[Content_Types].xml` (if they contain traces) or custom property files that do not use the `.xml` extension. Since the non-negotiable requirement is "0 occurrences... including... every entry," this restricted file-extension filter creates a significant metadata-leak vector that would cause the zero-trace test to fail if traces are present in the relationship files.

### [MEDIUM] Regex-based XML Patching Brittleness
**Plan 06-04 Task 1** relies on regex patterns like `/<dc:creator>[^<]*<\/dc:creator>/g` to blank metadata. This approach is brittle; it may fail to match empty-element tags (e.g., `<dc:creator/>`), tags with XML attributes (e.g., `<dc:creator xml:lang="en">`), or tags with varied whitespace. Given that `jszip` is already a dependency, utilizing a lightweight XML parser or a more robust parsing strategy would be safer than the proposed regex-only approach to guarantee the zero-trace outcome across different Pandoc/Word version outputs.

### [MEDIUM] Verification Table Parsing Reliability
**Plan 06-05 Task 2** implements `readSectionUnsupported` by parsing Markdown tables in `VERIFICATION.md` files. While the tables are generated by `renderPass2Section`, Markdown table structure (especially cell alignment and spacing) can be fragile for regex-based row extraction. A failure to correctly parse these rows would cause the DONE-09 gate to miss `UNSUPPORTED` claims, violating the Core Value of ensuring citations support their claims.

### [LOW] JSZip Byte-Pinning Cross-Platform Risk
**Plan 06-01 Task 1** attempts to ensure byte-identical binary fixtures by setting the date and platform in JSZip. While this is the established project pattern, binary byte-pins are notoriously sensitive to environment variations (e.g., zlib compression library versions). If the pin fails on the build machine despite deterministic settings, it will require a "sentinel" hash approach (WN-3) which may add minor friction to the first CI run.

HIGH_COUNT: 2
```

### claude (exit 0)

```
I reviewed the five Phase-6 plans against the goal, the five success criteria, and the non-negotiables. The plans are unusually disciplined (chokepoint discipline, advisory contracts, locked-16 verb, jszip slopcheck + lockfile, offline cassettes, byte-pinned framing copy). The build-machine constraint is genuinely respected in one sense — the zero-trace test patches a committed JSZip-authored fixture and never shells out to Pandoc. But that very design produces the most serious concern below.

## Concerns

- **[HIGH] The gating zero-trace test (TEST-10) is a tautology — it never scans real Pandoc output, only a fixture co-authored with the patch.** `06-01-PLAN.md` Task 1 hand-authors `sample-zero-trace.docx` with JSZip using "the exact namespace declarations from 06-RESEARCH Pattern 1 so the regex targets match," and `06-04-PLAN.md` Task 1 cleans it with those same regexes (`/<dc:creator>[^<]*<\/dc:creator>/g`, etc.). The fixture explicitly need not be "openable" and contains only the entries the test scans. Because Pandoc is absent, `zeroTracePatch` is never exercised against a real Pandoc `.docx`. Real Pandoc/Word output can defeat the regexes the test validates: self-closing empty elements (`<dc:creator/>`), attributes on the element, different namespace prefixes, or metadata in entries the fixture omits (`docProps/custom.xml`, `word/settings.xml`). The literal-`pensmith` sweep over `*.xml` mitigates the string fingerprint, but identifying metadata that is *not* the literal "pensmith" (a real author name in `dc:creator` is only caught because the fixture happens to put it there) is structurally untested. Criterion 1 ("scans every export format … finds exactly 0 … including .docx ZIP entries") is only proven for a synthetic negative control, not for the artifact users actually export.

- **[HIGH] Criterion 1's PDF and `.tex` coverage is neither tested nor implemented in this phase.** Criterion 1 requires the automated test to find 0 occurrences "including … PDF metadata," across "every export format." But `06-04-PLAN.md` Task 1/2 only calls `zeroTracePatch` for `format==='docx'`; PDF relies solely on `--variable pdfcreator=/pdfproducer=/pdfauthor=` which the plan itself (T-06-04-02, Pitfall 3) admits "cannot fully suppress" XMP, and defers "full PDF zero-trace (qpdf/custom template) … to a later phase." `06-01-PLAN.md` Task 2 Test C only asserts `.md` is trace-free and that `.tex`/`.docx` *skip* on the Pandoc-absent machine. So on the build machine the automated zero-trace gate effectively covers only `.md` + the synthetic `.docx` fixture; `.tex` (no in-process scrub at all) and PDF (acknowledged-unreliable scrub, deferred) real outputs are never scanned. Criterion 1 is not delivered for two of the four required formats.

- **[HIGH] The Pass-2 UNSUPPORTED feed into the DONE-09 gate (`readSectionUnsupported`) is untested and silently swallows failures, and the only integration test runs `--yolo` (gate skipped).** `06-05-PLAN.md` Task 2 specifies `readSectionUnsupported` as a markdown-table parser over `.paper/sections/*/VERIFICATION.md` that is "Defensive: missing files / no Pass-2 section → empty array, never throw." `tests/export-gate.test.ts` exercises `collectGateIssues`/`runDoneGate` only with *injected* data, never via `readSectionUnsupported`; and the bespoke tier-contract parity test in Task 3 runs `pensmith done --yolo`, which skips the gate entirely. So the disk→gate wiring has zero coverage. If the real `## Pass-2` table shape differs from what the parser expects, UNSUPPORTED claims are silently dropped, `hasIssues` is false, and the user is shown the generic "clean" confirm and exports over unsupported citations. DONE-09 is described as the SOLE escape valve reconciling the Core Value with VRFY-07; a silent miss in its issue-detection defeats that reconciliation (criterion 5) without any test catching it.

## Lower-severity concerns

- **[MEDIUM] `zeroTracePatch` blanks a fixed, incomplete metadata field set, and the test checks only that same set.** `06-04-PLAN.md` Task 1 blanks `dc:creator`, `dc:title`, `cp:lastModifiedBy`, `cp:keywords`, dcterms timestamps, and `app.xml <Application>`. It does not touch `dc:subject`, `dc:description`, `cp:category`, `cp:contentStatus`, `cp:revision`, or `app.xml` `<Company>`/`<Manager>`/`<Template>`. The `06-01` zero-trace test asserts only on the same blanked fields, so any identifying value (not literally "pensmith") that a real template/Pandoc places in an unhandled field would be both unstripped and unverified.

- **[MEDIUM] The transparency-only guard is a weak denylist; deliberate framing drift can slip through a re-pin.** `06-03-PLAN.md` Task 2 asserts the rendered note contains no "evade/beat/defeat" tokens, and the SHA-256 byte-pin (`06-01` Task 3) only blocks *accidental* drift — an intentional edit re-pins the hash. A change to e.g. "makes your text undetectable" passes the denylist (no banned token) and re-pins cleanly; the CONTRIBUTING.md rule is a human gate, not enforcement. Criterion 3's "verbatim-locked" is met literally, but the honest-framing non-negotiable is not robustly enforced against deliberate drift. Add "undetectable"/"bypass"/"fool"/"pass as human" to the denylist and assert the note still contains the required transparency assertion.

- **[MEDIUM] In the default CI/build environment the "before AND after" honesty scores are likely both null, so criterion 3 is only manually verifiable.** With `GPTZERO_API_KEY` absent (presumed on the build machine) `scoreHonesty` returns null per `06-03`, and with the humanizer absent there is no "after" pass per `06-05`. The before/after capability is unit-tested via cassette, but the end-to-end "computed before AND after humanize" path is exercised nowhere automatically — consistent with the deferred-manual stance, but worth surfacing as residual risk.

- **[MEDIUM] JSZip output determinism across OS/Node/zlib is assumed, not guaranteed.** `06-01` relies on `{ date: new Date(0) }` + `platform:'UNIX'` to keep `sample-zero-trace.docx` byte-stable so the `repo-files.test.ts` pin holds. DEFLATE output can vary across zlib/Node versions; if the fixture is ever regenerated on a different platform the pin breaks (a CI annoyance, not a goal failure, since the binary is committed once).

- **[LOW] The fixture embeds the user's real name ("Akhil Achanta") as the synthetic trace.** `06-01` Task 1 / T-06-01-03 accept this as a test-only fixture excluded from `package.json` `files[]`. Reasonable, but a synthetic placeholder (e.g., "Trace Sentinel") would avoid shipping a real PII string in the repo and make the negative-control intent clearer.

Positives worth noting: the Pandoc-independence requirement for the *mechanism* is met (the test patches a committed ZIP, no Pandoc invocation); no live network in tests (cassettes + `isOfflineMode`); the locked-16 verb set is preserved (`done` promoted, `cli-verbs.test.ts` guards 16); the DONE-09 gate logic itself (always-confirm, `--yolo`-only skip, injectable approver) is correctly designed and unit-tested; and the jszip supply-chain risk is addressed (slopcheck, no postinstall, lockfile pin).

HIGH_COUNT: 3
```

### opencode (exit 0)

```
## Cross-AI Plan Review — Phase 6 (Done / Export Pipeline + Zero-Trace Gate)

### [HIGH] PDF zero-trace is explicitly deferred to a future phase, violating success criterion 1 (06-04-PLAN.md, threat register T-06-04-02, Task 2)

Success criterion 1 mandates: *"Zero-trace test scans every export format ... AND PDF metadata."* But 06-04 states: *"full PDF zero-trace (qpdf/custom template) deferred to a later phase per 06-RESEARCH Pitfall 3; PDF treated as manual-only verification — not a CI-gated format."* The automated TEST-10 zero-trace suite (06-01) contains no PDF fixture, no PDF metadata scan, and no offline PDF test. An export via `pensmith done --format pdf` on a machine with a PDF engine will produce a PDF whose Producer/Creator metadata is suppressed only by `--variable pdfcreator=` flags (which hyperref can override). There is no automated guard catching metadata leakage in PDF output. The plans propose no offline PDF fixture (akin to the JSZip .docx fixture) to verify PDF zero-trace. This directly contradicts the success criteria.

**Why it's HIGH:** The non-negotiable states "ZERO exported-document trace — THIS is the gating test." PDF is an export format. Deferring PDF zero-trace means the phase goal is not completely delivered. A user exporting to PDF could receive a document carrying pensmith metadata, and CI would not catch it.

---

### No further HIGH concerns found.

---

### [MEDIUM] Honesty-framing exact wording is underspecified relative to CLAUDE.md non-negotiable (06-01-PLAN.md Task 3, 06-03-PLAN.md Task 2)

CLAUDE.md requires the framing to be `"improves prose, not evades detection"`. The plan at 06-01 Task 3 authoring guidance says *"its blockquote contains the verbatim 'improves ... does not ... undetectable' honest-framing sentence"* and points to 06-RESEARCH lines 287-293. This is imprecise — `"improves ... does not ... undetectable"` could match multiple strings. The SHA-256 byte-pin makes post-creation changes expensive, so any divergence from the non-negotiated wording at creation time becomes locked in. The acceptance criteria should reference the exact required string from CLAUDE.md.

**Risk:** If the authored `honesty-framing.md` uses a softened phrasing (e.g., "may improve prose"), the locked copy enshrines that drift until a re-pin PR. The non-negotiable "improves prose, not evades detection" should be authored into the file explicitly, and the acceptance criteria should assert it literally.

### [MEDIUM] PDF format silently degrades to markdown when the engine is absent, no user consent (06-04-PLAN.md Task 2)

When a user runs `pensmith done --format pdf` but Pandoc/PDF-engine is absent, `exportDraft` falls back to markdown-only with a banner: *"PDF engine not found — skipping PDF"*. The user receives a `.md` file where they expected a `.pdf`, with no explicit error or prompt. The format was explicitly requested; silently substituting markdown could result in the user unknowingly using the wrong file (e.g., submitting a `.md` to a journal expecting `.pdf`).

**Risk:** Data integrity — format mismatch is user-visible and could cause downstream issues. A better approach would be to throw a typed `ExportFormatUnavailableError` (caught by the orchestrator to print "PDF export unavailable; use `--format md` to export as markdown instead") or at minimum `console.error` prominently before the banner.

### [MEDIUM] Zero-trace unit test only exercises the committed fixture, not a Pandoc-generated .docx integration path (06-01-PLAN.md Task 2 Test B, 06-04-PLAN.md Task 1)

The zero-trace test (`zero-trace-export.test.ts` Test B) calls `zeroTracePatch` on the committed fixture `.docx`. This verifies the JSZip-based metadata scrub works on a known structure. But it does **not** test that a real Pandoc-generated `.docx` (which may have different namespace declarations, additional metadata fields like `cp:keywords`, `w:docVars`, or non-core custom XML parts) is also properly cleaned. The integration path (Pandoc → zeroTracePatch) is only manually verified. While this is a necessary compromise given Pandoc's absence on the build machine, the plans should at minimum add a regression-test fixture that more closely mimics Pandoc's output structure (e.g., real namespace URIs, `w:document` structure, headers/footers with metadata).

**Risk:** A future Pandoc version could add new metadata fields or change XML structure that zeroTracePatch doesn't handle, and CI would not detect the regression.

### [LOW] The md-only fallback overwrites the input DRAFT.md in place (06-04-PLAN.md Task 2, 06-05-PLAN.md Task 2)

When Pandoc is absent, `exportDraft` writes the output markdown to `outputDir/<basename>.md` where basename derives from the input path. If `inputPath = .paper/DRAFT.md` and `outputDir = .paper/`, the output overwrites `DRAFT.md` with the same content. While functionally benign in the default path, this becomes a problem if the gate renders before export: if approval is given and export proceeds, any file-system watchers or concurrent processes reading DRAFT.md could see a partial write (mitigated by atomicWriteFile, but still surprising). The plans should output to a distinct filename (e.g., `DRAFT.exported.md`) to avoid in-place overwrite confusion.

### [LOW] DDG HTML parsing is regex-based and will break silently on structural changes (06-02-PLAN.md Task 2)

`parseDdgHtml` uses regex to match `<a class="result__a" href="...">`. If DuckDuckGo changes their HTML output (adding whitespace, changing class names, moving to JSON-in-HTML), the parser returns zero matches silently. Since plagiarism is advisory, this is low-severity — but the silent failure means the plagiarism check effectively stops working without any user-visible signal. A future-proofing note or a simple fallback to "parsing changed" warning would be helpful.

**HIGH_COUNT: 1**
```

---

## Judge's Reconciliation Notes

- **Raw HIGH counts:** codex 6, claude 3, gemini 2, opencode 1. **Adjudicated: 3.**
- **PDF / `.tex` / "fixture tautology" findings** (codex's first two HIGHs, gemini's PDF HIGH, claude's first two HIGHs, opencode's HIGH) all collapse into **one PDF-format-coverage HIGH** (criterion 1) plus the separate **field-coverage/sweep-scope HIGH**. The `.tex` portion is noted as lower-risk ("clean by construction") within the PDF HIGH rather than a separate item.
- **Field-coverage + `.rels`/non-`.xml` sweep + regex-brittleness + fixture-is-co-authored** (codex HIGH #3/#4, gemini metadata-sweep HIGH + regex MEDIUM, claude tautology HIGH + metadata MEDIUM, opencode integration-path MEDIUM) → consolidated into **one HIGH** (same root cause).
- **`readSectionUnsupported` untested feed** (claude HIGH; gemini/codex MEDIUM) → **upgraded to HIGH** because it maps directly to a criterion-5 failure (gate can silently miss UNSUPPORTED claims) and was verified true against 06-05 (only injected-data unit tests; the sole integration test uses `--yolo`).
- **`renderHonestyReport` before/after-in-code** (codex HIGH) → **downgraded to MEDIUM**: the honest-framing *non-negotiable* is the `## Note`, which IS verbatim-locked; the before/after lines carry no detection claim. Real issue is a spec inconsistency, not a non-negotiable violation.
- **before/after degrades to before-only when humanizer absent** (codex HIGH) → **downgraded to LOW**: this is the intended skip-clean behavior allowed by the criteria.
- No reviewer found a true gate-bypass-without-`--yolo` in the gate *logic*, a 17th verb, or live network in tests — the non-negotiables on those points hold.
