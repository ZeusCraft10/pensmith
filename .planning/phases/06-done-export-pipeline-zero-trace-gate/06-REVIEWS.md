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

---

## Cycle 2

Re-review after the three cycle-1 HIGHs were addressed. Four external reviewers
(codex, gemini, claude, opencode) re-audited the five revised Phase-6 PLAN files
(06-01 … 06-05) against the goal, the five success criteria, the non-negotiables,
and the specific cycle-1 HIGH fixes. All four ran and returned usable output
(exit 0, non-empty). Raw HIGH counts: codex 2, gemini 2, claude 1, opencode 0.

The judge below dedups across reviewers, verifies each claim against the actual
plan text (plus an empirical Node check for the `copyFile` claim and a pdf-lib
serialization-semantics check), keeps `[HIGH]` only where a finding genuinely maps
to a success-criterion failure or a non-negotiable violation, and downgrades
over-escalated items with reason.

### Prior-HIGH Resolution Status (cycle 2)

- **HIGH-1 (PDF/.tex zero-trace) — PARTIALLY RESOLVED.** The *PDF fixture* and *coverage*
  ARE fixed (genuine hand-authored negative control independent of pdf-lib; TEST-10
  scans all four formats offline; SC1 not narrowed). BUT the cycle-1 fix introduced a
  NEW HIGH: the `zeroTracePdf()` *mechanism as specified* fails its own Test D (see
  HIGH-C2-1 below). Two residual gaps: (a) the `.tex` no-generator-comment contract is
  only gated on the md-fallback artifact, not a real `.tex` (MEDIUM); (b) the PDF scrub
  mechanism is broken (HIGH). So HIGH-1 is NOT fully closed.
- **HIGH-2 (docx field coverage + sweep breadth + fixture independence) — RESOLVED.**
  All four reviewers concur. The fixture is a genuine independent negative control
  (trap in `cp:category` AND `_rels/.rels`); the blank set covers the full DC+cp+app
  identifying fields; the sweep iterates ALL non-dir entries (not just `*.xml`);
  regexes handle self-closing + attribute-bearing tags; Test B keeps a separate
  per-field empty assertion so the literal sweep cannot mask a missing field-blank.
- **HIGH-3 (Pass-2 → DONE-09 gate feed) — RESOLVED.** All four reviewers concur.
  `readSectionUnsupported` fails safe (present-but-unparseable → synthetic UNSUPPORTED
  sentinel; absent heading / `_(no citations to judge)_` / missing file → clean), pins
  the renderPass2Section contract, and the disk→gate feed is now tested end-to-end
  (unit parse + fail-safe + non-`--yolo` on-disk integration). One residual: the full
  `doneCommand.run()` orchestrator wiring is still only exercised via `--yolo` at the
  verb level (MEDIUM, claude) — the gate-feed primitives are tested, the verb-level
  non-yolo composition is not.

### Synthesized Findings (cycle 2)

#### HIGH

- **[HIGH] (HIGH-C2-1 — NEW) `zeroTracePdf()` as specified does not actually strip the
  XMP stream and risks corrupting the PDF — fails its own Test D, threatening SC1.**
  *Reviewer agreement: codex (HIGH), gemini (HIGH), claude (HIGH), opencode (LOW) — 3/4 HIGH;
  verified against 06-04 lines 95/143/144 and pdf-lib save semantics.* Two converging
  defects in 06-04 Task 1: **(a)** the final defense-in-depth byte sweep
  `out.toString('latin1').replace(/pensmith/gi, '')` (line 144) DELETES bytes from the
  already-serialized PDF, shifting every subsequent byte offset and invalidating the
  xref table + stream `/Length` values — if it ever fires it corrupts the file, failing
  Test D assertion (4) "still loads via PDFDocument.load". **(b)** `pdf.catalog.delete(
  PDFName.of('Metadata'))` (lines 95/143) removes only the catalog *reference* to the XMP
  stream, not the stream object itself; pdf-lib's `save()` serializes all indirect objects
  in its context regardless of reachability, so the `<x:xmpmeta>` stream (carrying both
  `pensmith` AND the non-`pensmith` identifying token `Trace Sentinel`) is still written.
  The byte sweep only removes the literal `pensmith`, so `Trace Sentinel` survives in an
  intact XMP block — failing Test D assertion (3) "XMP block removed OR scrubbed of
  identifying values". Net: the MANDATORY PDF scrub cannot go green as written, and a real
  PDF would leak non-`pensmith` identifying metadata — a direct SC1 / no-exported-trace
  non-negotiable miss for the PDF format that the cycle-1 fix was supposed to deliver.
  **Fix direction:** capture the metadata ref first
  (`const ref = catalog.get(PDFName.of('Metadata'))`) and `pdf.context.delete(ref)`
  BEFORE `save()` so the structured serializer emits clean, valid bytes; demote the
  literal-`pensmith` byte check to a post-save *assertion* (defense-in-depth, not a
  length-altering mutation) and, if a residual is ever found, re-run the structured strip
  rather than editing bytes; update Test D / 06-01 acceptance so the fixture
  `Trace Sentinel` token (not just `pensmith`) is asserted absent from the XMP after scrub.

#### MEDIUM

- **[MEDIUM] `.tex` zero-trace is not genuinely CI-gated on a real `.tex` artifact —
  only the md-fallback is scanned offline.** *(codex raised HIGH; opencode MEDIUM;
  downgraded to MEDIUM.)* 06-01 Test F permits scanning the md-fallback artifact when
  Pandoc is absent, and 06-04 has no non-Pandoc `.tex` code path, so no real `.tex` is
  ever produced/scanned in CI; live Pandoc `.tex` is a documented manual check. This is a
  real gap in SC1's *automated* four-format claim, but the leak risk is low: per
  06-RESEARCH `.tex` is "clean by construction" (pure source LaTeX, no injected metadata)
  and the no-generator-comment contract IS enforced on the offline-producible artifact plus
  a defensive `% Generated`/`% pensmith` strip. Downgraded because it is "untested" not
  "broken" (the cycle-1 judge reached the same conclusion for `.tex`). **Fix:** either add
  a tiny non-Pandoc `.tex` writer/template so a real `.tex` is produced + scanned offline,
  or explicitly restate SC1's `.tex` clause as "CI-gated on the offline-producible
  artifact; live Pandoc `.tex` is a manual check."

- **[MEDIUM] The non-`--yolo` disk→gate feed is never exercised through the real
  `doneCommand.run()` orchestrator.** *(claude.)* The HIGH-3 integration test composes
  `readSectionUnsupported` + `collectGateIssues` + `runDoneGate` by hand; the only test
  that runs the full verb (06-05 Task 3 tier-contract) uses `--yolo`, which skips the gate.
  So if `run()` forgets to call `readSectionUnsupported(paperRoot)`, passes the wrong root,
  or drops `pass2Results` into `collectGateIssues`, no test fails. The gate-feed
  *primitives* are well covered (HIGH-3 resolved); the verb-level *composition* is not.
  **Fix:** add one non-`--yolo` test that runs `doneCommand.run()` on a seeded on-disk
  `.paper` (DRAFT.md + a section VERIFICATION.md with an UNSUPPORTED row) with an injected
  `approve`→false, asserting the run cancels `{ ok:false }` and the per-issue summary
  reached stdout.

- **[MEDIUM] Export `outputDir = paperDir(paperRoot)` collides with the source artifacts —
  the bib "copy" is a no-op and the md-fallback writes `DRAFT.md` onto itself, making the
  verb-level zero-trace scan vacuous.** *(claude MEDIUM; gemini raised the same collision as
  a HIGH `copyFile`-crash — see downgrade note.)* 06-05 calls
  `exportDraft({ outputDir: paperDir(paperRoot) })` and 06-04 copies
  `bibSrc = join(paperDir, 'CITATIONS.bib')` to `join(outputDir, 'CITATIONS.bib')` —
  identical paths. On the build machine `fs.copyFile(p,p)` is a silent no-op (empirically
  verified — it does NOT throw, so gemini's "reliably crashes" claim is FALSE here), but the
  deeper problem stands: in the md-fallback path (humanizer absent = the default)
  `inputPath = .paper/DRAFT.md` and the export atomic-writes `DRAFT.md` onto itself, so
  there is no distinct deliverable and the 06-05 Task 3 tier-contract "produced artifact"
  scan trivially re-scans the seeded input. SC2/SC4 are not violated (nothing throws, md is
  produced, bib "present"), but the verb-level zero-trace assertion is weak and the UX is
  confusing. **Fix:** export to a distinct name/dir (e.g. `.paper/exports/<slug>.<ext>` or
  the project root), and/or guard the bib copy with `if (bibSrc !== bibDst)`.

#### LOW

- **[LOW] DOCX all-entry sweep could rewrite binary parts that happen to contain the bytes
  `pensmith`.** *(codex.)* "attempt `.async('string')`, skip obviously-binary" is heuristic;
  JSZip will decode arbitrary bytes as a string. Low risk but an explicit text-entry
  allowlist (core/app/custom/rels/headers/footers/document/settings) would be safer.
- **[LOW] `before.aiProbability ?? skip` in the 06-05 instruction reads as a null-deref.**
  *(gemini MEDIUM; downgraded.)* The same sentence states the correct null-handling ("when
  scoreHonesty returns null … emit the skip banner"), so an executor following the prose
  will guard `before`; it is shorthand, not a bug, but worth tightening to an explicit
  `if (!before)`.
- **[LOW] `readSectionUnsupported` section iteration order is unspecified.** *(opencode.)*
  Sort the section-dir read for deterministic gate-summary output.
- **[LOW] `collectGateIssues` re-filters UNSUPPORTED that `readSectionUnsupported` already
  filtered.** *(opencode.)* Harmless redundancy; single-filter-point cleanup optional.
- **[LOW] docx byte-pin determinism across environments.** *(claude.)* JSZip DEFLATE is
  pako-based + `{date:new Date(0)}`, so probably stable while `jszip` is lockfile-pinned;
  consider `compression:'STORE'` for the fixture. Annoyance, not a goal failure.
- **[LOW] "key never in stdout" is asserted by a source-text scan.** *(claude.)* A
  behavioral assertion (sentinel key never appears in captured stdout) would be
  refactor-proof; the source scan is acceptable belt-and-suspenders.
- **[LOW] Wave-0 module-existence test stance still reads as internally conflicted.**
  *(codex.)* "mirror known-bad-pass2.test.ts EXACTLY" resolves it; pick one stance.

### Judge's Reconciliation Notes (cycle 2)

- **Raw HIGH counts:** codex 2, gemini 2, claude 1, opencode 0. **Adjudicated: 1.**
- **The single genuine HIGH (HIGH-C2-1)** is the `zeroTracePdf` mechanism — the only
  finding 3/4 reviewers independently rate HIGH, verified against the plan text and pdf-lib
  save semantics. It is a NEW HIGH introduced by the HIGH-1 fix (zeroTracePdf is new this
  cycle) and it fails the very Test D the fix added, so it maps directly to SC1.
- **gemini's `copyFile` same-path "reliable crash" HIGH → downgraded.** Empirically
  `fs.copyFile(p,p)` is a silent no-op on this Node/Windows build (it does NOT throw), so
  the crash claim is false. The real underlying path-collision concern is retained as the
  MEDIUM above (claude's framing).
- **codex's `.tex` HIGH → downgraded to MEDIUM**, matching opencode and the cycle-1 judge:
  `.tex` is "clean by construction," so the gap is untested-not-broken.
- **codex/gemini/opencode "byte-sweep corrupts PDF" + claude "XMP not actually dropped"**
  are the SAME root finding (the `zeroTracePdf` mechanism) — merged into HIGH-C2-1.
- HIGH-2 and HIGH-3 are confirmed RESOLVED by unanimous reviewer agreement and plan-text
  verification. No reviewer found a 17th verb, live network in tests, a gate bypass without
  `--yolo`, a chokepoint violation, or a honest-framing non-negotiable regression.

### Per-Reviewer Raw (cycle 2)

#### codex (exit 0)

```
**Prior HIGHs**

HIGH-1: **NOT RESOLVED.** The PDF side is much stronger: 06-01 Task 1 requires a hand-authored PDF fixture independent of `pdf-lib`, with both `/Info` and XMP traces; 06-04 Task 1 adds `zeroTracePdf()` that clears document info, deletes catalog `/Metadata`, and tests the fixture offline. However, the `.tex` offline gate is not genuinely proven: 06-01 Test F allows “the emitted .tex … OR the md-fallback artifact when Pandoc is absent,” while 06-04 Task 2 says absent Pandoc always falls back to markdown-only. That means CI can pass without scanning a real `.tex` artifact.

HIGH-2: **RESOLVED.** 06-01 Task 1 requires the DOCX fixture to include traps in `cp:category` and `_rels/.rels`, plus full DC/cp/app metadata with attribute-bearing and self-closing forms. 06-04 Task 1 requires blanking the expanded field set and sweeping every non-dir text entry, explicitly including `_rels/.rels`, with tests asserting no `pensmith` remains anywhere.

HIGH-3: **RESOLVED.** 06-05 Task 2 distinguishes missing Pass-2 sections from present-but-unparseable Pass-2 tables, emits a synthetic `UNSUPPORTED` sentinel on parser desync, and adds three tests: real fixture parse, fail-safe malformed table, and non-`--yolo` on-disk gate integration that verifies the approver is called and the issue summary is shown.

**Remaining Concerns**

[HIGH] 06-01 Task 2 / 06-04 Task 2: The `.tex` zero-trace contract is not actually CI-gated offline. The plan permits the latex test to scan a markdown fallback artifact when Pandoc is absent, but SC1 requires scanning every export format, including `.tex`. Fix direction: add a deterministic offline `.tex` fixture or native minimal `.tex` writer/postprocessor test, and assert a real `.tex` file has no `% pensmith`, `% Generated by`, or `pensmith`.

[HIGH] 06-04 Task 1: `zeroTracePdf()` includes a final length-changing byte sweep over the saved PDF bytes: `replace(/pensmith/gi, '')`. If that branch ever triggers on a real PDF, it can invalidate xref offsets or corrupt binary streams after `pdf-lib` has serialized the file. The fixture may not catch this if structured metadata removal already removes all traces. Fix direction: avoid length-changing byte edits; either replace with equal-length spaces in safe text streams before serialization, remove the owning metadata object structurally, or fail closed if residual `pensmith` remains, then reload the final bytes in production and tests.

[MEDIUM] 06-04 Task 1: The DOCX all-entry sweep is described as “attempt `.async('string')` and skip obviously-binary parts.” JSZip can decode arbitrary binary as a string, so the implementation could accidentally rewrite binary media if it contains the byte sequence `pensmith`. Fix direction: use an explicit text-entry allowlist plus required OOXML metadata/rels/custom/header/footer parts, and keep the test coverage for `_rels/.rels`.

[LOW] 06-01 Task 2: The RED scaffold acceptance text is internally conflicted about whether module-existence tests should fail or mirror Phase-5 skip behavior. It probably won’t threaten the phase if executors follow the “mirror existing precedent” instruction, but the plan would be clearer if it picked one exact expected Wave-0 status.

HIGH_COUNT: 2
```

#### gemini (exit 0)

```
### Resolution of Cycle 1 HIGH Concerns

1. **HIGH-1 (PDF/.tex zero-trace):** **RESOLVED.** The PDF fixture is explicitly required to be authored by hand (byte-level) and independent of `pdf-lib` (a genuine negative control). `zeroTracePdf` properly drops the `/Metadata` (XMP) stream via catalog deletion. The `.tex` format is tested offline for the absence of generator comments, successfully CI-gating the contract.
2. **HIGH-2 (docx field coverage + sweep breadth + fixture independence):** **RESOLVED.** The DOCX fixture is genuinely independent, using JSZip to zip hand-authored XML, and explicitly places trap strings in `cp:category` and `_rels/.rels`. The patch sweeps all non-binary entries and robustly blanks the full, expanded field set.
3. **HIGH-3 (Pass-2 -> DONE-09 gate feed):** **RESOLVED.** `readSectionUnsupported` explicitly fails safe by generating a synthetic UNSUPPORTED sentinel row when a table is present but unparseable, preventing silent bypasses. The end-to-end disk→gate feed is now robustly covered by a non-yolo on-disk integration test.

### Remaining and NEW Concerns

- **[HIGH] PDF binary corruption via literal byte sweep:** In `06-04-PLAN.md` Task 1, `zeroTracePdf` performs a literal byte sweep on the serialized PDF bytes by converting the `pdf-lib` output to a latin1 string and replacing `/pensmith/gi` with an empty string `''`. Because a PDF relies on exact byte offsets mapped in its cross-reference (`xref`) table, replacing an 8-character string with a 0-character string alters the file length and instantly invalidates all subsequent object offsets, completely corrupting the PDF structure.
  *Fix direction:* If a defense-in-depth literal sweep is necessary on the binary PDF buffer, it MUST replace the target string with a string of exactly the same length (e.g., replacing `'pensmith'` with `'        '` - 8 spaces) to preserve all byte offsets and stream lengths. Alternatively, rely entirely on `pdf-lib` to strip the `/Info` and XMP metadata without performing a raw byte-length-altering replacement.

- **[HIGH] `copyFile` crashes when `src` and `dest` are the same path:** In `06-05-PLAN.md` Task 2, the `done.ts` orchestrator calls `exportDraft` with `outputDir: paperDir(paperRoot)` (which points to the hidden `.paper/` folder). Inside `06-04-PLAN.md` Task 2, `exportDraft` attempts to copy the bibliography via `fsp.copyFile(bibSrc, join(outputDir, 'CITATIONS.bib'))`. Since `bibSrc` is also located at `.paper/CITATIONS.bib`, the source and destination paths are identical. In Node.js, `fs.copyFile` throws an error when `src` and `dest` are the exact same file, which will reliably crash the final export step.
  *Fix direction:* Change the `done.ts` orchestrator to export the final documents to the project root (`outputDir: paperRoot`) instead of the hidden `.paper/` directory, so exports are visible to the user and the `.bib` file can be copied safely alongside them. Alternatively, inside `exportDraft`, explicitly verify `if (bibSrc !== bibDst)` before executing the copy.

- **[MEDIUM] `scoreHonesty` returning `null` causes a `TypeError` in plan instructions:** In `06-05-PLAN.md` Task 2, the plan instructs the executor to build the honesty report via `renderHonestyReport(before.aiProbability ?? skip, ...)`. However, `scoreHonesty` is explicitly designed to return `null` when the API key is missing (skip-clean). Accessing `before.aiProbability` directly when `before` is `null` will throw a runtime `TypeError`.
  *Fix direction:* Update the instructions to properly check if `before` is `null` before attempting to access its properties (e.g., `if (!before) { emit skip banner; } else { renderHonestyReport(before.aiProbability, ...) }`).

HIGH_COUNT: 2
```

#### claude (exit 0)

```
I've read the five revised plans and the supporting research/pattern/validation docs. Here is my adversarial cycle-2 review.

---

# Cross-AI Plan Review — Phase 6 (Cycle 2)

## Verdict on the 3 prior HIGH concerns

### HIGH-1 (PDF/.tex zero-trace) — **PARTIALLY RESOLVED** (one genuine gap remains)

What is genuinely fixed:
- **Fixture independence:** 06-01 Task 1 hand-authors the PDF bytes via `fs.writeFileSync` of a Buffer, *not* via pdf-lib (pdf-lib is only used to *validate* loadability at the end). This is a real negative control, not a closed loop. ✓
- **.tex no-generator-comment is CI-gated offline:** 06-04 Task 2 + zero-trace Test F drive the `.tex`/`md` artifacts from the exporter's deterministic offline path (no Pandoc), and 06-04 strips any `% pensmith`/`% Generated` line. ✓
- **TEST-10 scans all four formats offline:** 06-01 Task 2 Tests A–F, with negative-control assertions (A/C) passing now and scrub assertions (B/D/E/F) skip-guarded. SC1 is not narrowed. ✓

What is **not** genuinely resolved — see the HIGH concern below: the *mechanism* 06-04 specifies for removing the XMP stream does not actually remove it from pdf-lib's serialized output, and the byte-sweep only targets the literal `pensmith` — leaving the fixture's other identifying token (`Trace Sentinel`) in a still-serialized XMP stream. So the answer to the cycle-2 question "*Does `zeroTracePdf` actually strip the XMP stream?*" is **no, not as written.**

### HIGH-2 (docx field coverage + sweep breadth + fixture independence) — **RESOLVED**

- The fixture (06-01 Task 1) is a genuine independent negative control: `pensmith` is planted in `cp:category` (a field the prior narrow patch missed) **and** in `_rels/.rels` (a non-`.xml` entry). 06-04's field-blank list now includes `dc:subject/dc:description/cp:category/cp:contentStatus/cp:lastModifiedBy` + app `Company/Manager/Template`, with regexes for self-closing + attribute-bearing tags, and the sweep iterates **all** non-dir entries (explicitly `_rels/.rels`), not just `*.xml`. ✓
- The fixture **forces** failure of a too-narrow patch in a robust way: even though the all-entry literal sweep would strip the `pensmith` substring from `cp:category` (masking the string assertion), Test B's *separate* "`cp:category` is empty" assertion still catches a missing field-blank target. The trap can't be silently swallowed by the sweep. ✓

### HIGH-3 (Pass-2 → DONE-09 gate feed) — **RESOLVED** (one residual, see MEDIUM)

- `readSectionUnsupported` (06-05 Task 2) genuinely fails safe: present-but-unparseable `## Pass-2` table → synthetic `<unparseable>` UNSUPPORTED sentinel (forces confirmation); absent heading / `_(no citations to judge)_` / missing file → clean. The "no Pass-2 section (clean)" vs "present-but-unparseable (issue)" distinction is explicit, and the parser keys on the `## Pass-2` prefix (so a heading-suffix drift doesn't read as "absent → clean"). ✓
- The disk→feed is tested from real on-disk markdown, not just injected: a parse test over the committed fixture (UNSUPPORTED detected, SUPPORTED filtered), a fail-safe test (malformed table → sentinel; no-heading → clean), and a non-`--yolo` integration test driving `collectGateIssues(readSectionUnsupported(root))` + `runDoneGate(approve=false)` with a stdout summary assertion. ✓

---

## Concerns

- **[HIGH] 06-04 Task 1 — `zeroTracePdf` does not actually remove the XMP stream; its specified mechanism fails its own Test D and risks PDF corruption.** The plan strips XMP via `pdf.catalog.delete(PDFName.of('Metadata'))`, then `pdf.save()`, then a post-save `out.toString('latin1').replace(/pensmith/gi,'')`. Two problems: (a) pdf-lib serializes **every** indirect object in its `context` on save, *reachable or not* — deleting the catalog `/Metadata` reference does **not** drop the XMP stream object, so the stream (containing `<pdf:Producer>pensmith…` **and** `<dc:creator>…Trace Sentinel`) is still written. The byte-sweep deletes only `pensmith`, so the fixture's other identifying token (`Trace Sentinel`) survives inside an intact `<x:xmpmeta>` block — which is exactly what zero-trace Test D assertion (3) ("xmpmeta block removed OR scrubbed of identifying values") checks, so the implementation as specified **fails its own gating test**. (b) The post-save `latin1` byte-deletion shifts all subsequent byte offsets, invalidating the xref table and stream `/Length` values, jeopardizing Test D assertion (4) ("still loads via `PDFDocument.load`"). Fix direction: capture the ref first (`const ref = catalog.get(PDFName.of('Metadata'))`), then `pdf.context.delete(ref)` **before** `save()` so the structured save emits clean, valid bytes; keep the literal `pensmith` byte-check as a *post-save assertion* (defense-in-depth), not a mutation — and if a residual is ever found, re-run the structured strip rather than editing bytes in place. Without this, SC1 leaks non-`pensmith` identifying metadata from PDF and the PDF scrub task cannot go green as written.

- **[MEDIUM] 06-05 Task 2/Task 3 — the non-`--yolo` disk→gate feed is never exercised through the real `doneCommand.run()` orchestrator.** The new HIGH-3 integration test composes `readSectionUnsupported` + `collectGateIssues` + `runDoneGate` *by hand*; the only test that runs the full verb (`done` tier-contract, 06-05 Task 3) uses `--yolo`, which **skips** the gate (and pointlessly seeds Pass-2 data the run never reads). So if `doneCommand.run()` forgets to call `readSectionUnsupported(paperRoot)`, passes the wrong `paperRoot`, or drops `pass2Results` into `collectGateIssues`, no test fails. Fix direction: add one non-`--yolo` orchestrator-level test that runs `doneCommand.run()` on an on-disk `.paper` (seeded DRAFT.md + a section VERIFICATION.md with an UNSUPPORTED row) with an injected/stubbed `approve` returning false, asserting the run cancels with `{ ok:false }` and the per-issue summary reached stdout — closing the wiring gap end-to-end.

- **[MEDIUM] 06-04 Task 2 / 06-05 Task 2 — the md-only fallback output path collides with the source `DRAFT.md`, making the verb-level "produced artifact" scan vacuous.** In the orchestrator, `outputDir = paperDir(paperRoot)` and the fallback writes `outputDir/<basename(inputPath)>.md`. With the humanizer absent (the build-machine default), `inputPath = .paper/DRAFT.md`, so the "export" atomic-writes `.paper/DRAFT.md` onto itself — there is no distinct deliverable, and the 06-05 Task 3 tier-contract zero-trace scan ends up scanning the seeded input file it just wrote (trivially clean). This doesn't violate SC2 (it doesn't throw, and md is produced), but the produced-artifact assertion is weak and the UX is confusing ("your export is the internal compile artifact"). Fix direction: write exports to a distinct name/dir (e.g. `.paper/exports/<paper-slug>.md`) so the fallback yields a separate file and the verb-level scan is meaningful.

- **[LOW] 06-01 Task 1 / 06-03 — byte-pin determinism of `sample-zero-trace.docx` across environments.** The docx pin relies on JSZip producing byte-identical output everywhere. JSZip's DEFLATE is pako-based (bundled, so independent of Node's zlib) and `{date:new Date(0)}` fixes entry timestamps, so this is *probably* stable — but it is only guaranteed while `jszip` is exactly version-pinned in `package-lock.json` and contributors never regenerate. Worth an explicit note in CONTRIBUTING/the generator script that the committed binary is the source of truth and regeneration requires a re-pin; consider `compression:'STORE'` for the fixture to remove DEFLATE from the determinism surface entirely.

- **[LOW] 06-03 Task 1 — the "key never interpolated into stdout" guarantee is asserted by a source-text scan.** Asserting `honesty.ts` contains no `${apiKey}` is brittle (it won't catch `'key=' + apiKey` or a logger call). It's an acceptable belt-and-suspenders given the presence-check design, but a behavioral assertion (capture stdout during a live-branch call with a sentinel key value and assert the sentinel never appears) would be stronger and refactor-proof.

---

HIGH_COUNT: 1
```

#### opencode (exit 0)

```
## Adversarial Plan Review — Cycle 2

### HIGH-1 (PDF/.tex zero-trace): PARTIALLY RESOLVED

**PDF side:** RESOLVED. The fixture is genuinely hand-authored (independent of pdf-lib), carries 'pensmith' in both `/Info` and XMP stream, `zeroTracePdf` removes both (via `setTitle('')` + `catalog.delete(PDFName.of('Metadata'))`) and does a defense-in-depth byte sweep — all OFFLINE on the engine-absent build machine. Locked by SHA-256 pin to prevent fixture drift.

**.tex side:** NOT RESOLVED as claimed. HIGH-1's cycle-1 statement said ".tex no-generator-comment contract is genuinely CI-gated offline." In reality, when Pandoc is absent (CI), format `latex` falls back to md-only. Test F in 06-01 scans the md fallback artifact, NOT actual `.tex` output. The plan acknowledges this as a "documented manual check" (06-04). This means the SC1 gate for `.tex` outputs from Pandoc is NOT CI-gated — a gap HIGH-1 claimed was closed.

**[MEDIUM] 06-04: The Pandoc-produced .tex generator-comment strip (defense-in-depth `% Generated by` removal in exportDraft) is untestable in CI since Pandoc is absent. The plan documents this as manual-only, which contradicts HIGH-1's "genuinely CI-gated offline" assertion for .tex. Fix: either accept the gap explicitly in SC1's docstring, or add a small offline LaTeX template renderer that emits .tex directly without Pandoc (if the architecture supports it).**

### HIGH-2 (docx field coverage + sweep breadth + fixture independence): RESOLVED

- Fixture carries the full Dublin-Core + cp + app set including dc:subject (attribute-bearing), cp:category, cp:contentStatus, self-closing Template
- Trap in cp:category + _rels/.rels (non-.xml) ensures a narrow patch fails TEST-10
- Sweep iterates ALL non-dir entries (not just *.xml), tries `.async('string')`, skips only obviously binary
- Regexes handle both `<tag attrs>...</tag>` and `<tag/>` forms
- Fixture is hand-authored JSZip XML, independent of the patch regexes
- SHA-256 pinned against drift

### HIGH-3 (Pass-2 → DONE-09 gate feed): RESOLVED

- `readSectionUnsupported` explicitly distinguishes: absent `## Pass-2` heading → clean; present-but-unparseable → synthetic `UNSUPPORTED` sentinel; malformed table → never silent `[]`
- `_(no citations to judge)_` is explicitly recognized as clean
- Three new tests: (1) unit parse of fixture → correct UNSUPPORTED citekey, SUPPORTED filtered out; (2) fail-safe: malformed table → synthetic sentinel, absent heading → `[]`; (3) non-`--yolo` on-disk integration: seeds real files → gate fires, approve called, per-issue summary in stdout, `exported: false`
- Pin on the renderPass2Section header contract as a module-level constant

### Remaining concerns

**[MEDIUM] 06-01/06-04, .tex CI gate gap:** As noted under HIGH-1, the .tex no-generator-comment contract is not genuinely CI-gated for Pandoc-produced .tex. Only the md-fallback is tested. The plan should either (a) add a lightweight .tex-only code path that works without Pandoc (write a LaTeX preamble template directly), or (b) explicitly mark SC1's .tex clause as "CI-gated for the fallback artifact; live Pandoc .tex verified via documented manual check per the defense-in-depth strip."

**[LOW] 06-05, `collectGateIssues` redundant UNSUPPORTED filter:** `readSectionUnsupported` already returns only UNSUPPORTED rows, but `collectGateIssues` also filters by verdict. Not a bug — the function is designed to accept raw Pass2Results too — but the design is slightly inconsistent. Consider either removing the redundant filter or having `readSectionUnsupported` return all verdicts so `collectGateIssues` is the single filter point.

**[LOW] 06-05, `readSectionUnsupported` section ordering:** The plan says "list section dirs" without specifying sort order. If filesystem iteration order is non-deterministic (e.g., on some OS/filesystem combos), the gate summary output order could vary. Use a sorted read (`readdirSync` + sort) for deterministic output.

**[LOW] 06-04, zeroTracePdf byte-sweep on full output:** The latin1 round-trip on the entire saved PDF could corrupt binary streams if 'pensmith' appears in compressed content. However, since the structured removal (empty /Info + delete XMP) is the primary mechanism and the byte-sweep is defense-in-depth, the risk is minimal. Consider constraining the byte sweep to string objects only (via pdf-lib's object iteration) rather than the raw buffer, or keep as-is since it only triggers on actual 'pensmith' presence.

---

HIGH_COUNT: 0
```

---

## Cycle 3

Re-review after the cycle-2 HIGH (HIGH-C2-1, the `zeroTracePdf` mechanism) was
fixed. Four external reviewers (codex, gemini, claude, opencode) re-audited the
five revised Phase-6 PLAN files (06-01 … 06-05) against the goal, the five success
criteria, the non-negotiables, and the four prior-cycle HIGH fixes. All four ran
and returned usable output (exit 0, non-empty). Raw HIGH counts: codex 0,
gemini 1, claude 0, opencode 0.

The judge below dedups across reviewers, verifies each claim against the actual
plan text plus pdf-lib serialization semantics, keeps `[HIGH]` only where a
finding genuinely maps to a success-criterion failure or a non-negotiable
violation, and downgrades over-escalated items with reason.

### Prior-HIGH Resolution Status (cycle 3)

- **HIGH-1 (PDF/.tex zero-trace not delivered/tested) — RESOLVED.** Unanimous (4/4).
  06-04 ships `zeroTracePdf` (pure-JS pdf-lib) as the mandatory last step of every
  `.pdf` export; 06-01 commits an independent hand-authored PDF negative-control
  fixture; TEST-10 Test D scrubs+scans it offline; Test F scans a REAL
  offline-produced `.tex` from the deterministic md→tex writer (no longer "clean by
  construction"). All four formats are CI-gated offline. The two cycle-2 residual
  MEDIUMs (the `.tex` real-artifact gate; the `zeroTracePdf` mechanism) are both now
  closed.
- **HIGH-2 (docx field coverage + sweep breadth + fixture independence) — RESOLVED.**
  Unanimous (4/4). Full Dublin-Core+cp+app field set in both fixture and scrub;
  sweep over ALL non-dir entries incl. `_rels/.rels`; regexes tolerant of
  self-closing + attribute-bearing tags; genuine independent negative control with
  traps in `cp:category` AND `_rels/.rels`.
- **HIGH-3 (Pass-2 → DONE-09 gate feed) — RESOLVED.** Unanimous (4/4).
  `readSectionUnsupported` fails safe (present-but-unparseable → synthetic
  `<unparseable>` UNSUPPORTED sentinel; absent / `_(no citations to judge)_` /
  missing file → clean), pinned to the `renderPass2Section` contract, and the
  disk→gate feed is tested end-to-end (unit parse + fail-safe + non-`--yolo` on-disk
  integration).
- **HIGH-C2-1 (`zeroTracePdf` mechanism broken) — RESOLVED.** Unanimous (4/4),
  with pdf-lib serialization semantics verified by codex, gemini, claude, AND
  opencode. The catalog-only delete + length-altering byte-sweep is GONE; replaced
  with `pdf.context.delete(metaRef)` on the indirect XMP STREAM object BEFORE
  `save()` (so the serializer — which enumerates `context.indirectObjects` — never
  emits it), then the catalog `/Metadata` entry removal, `/Info` cleared via
  pdf-lib setters, and a READ-ONLY post-save literal check (no mutation). Test D
  asserts BOTH `pensmith` AND the non-`pensmith` `Trace Sentinel` token are absent
  AND the PDF still loads — a genuine negative control proving structural removal,
  not literal masking. See the mechanism verdict below.

### `zeroTracePdf` Mechanism Verdict (cycle 3): TECHNICALLY SOUND

All four reviewers independently confirm the corrected mechanism is correct, and
the judge concurs after verifying against pdf-lib internals:

1. `catalog.get(PDFName.of('Metadata'))` returns the indirect `PDFRef` (PDFDict
   `.get()` does NOT follow references — only `.lookup()` does), and the PDF spec +
   the fixture both make `/Metadata` indirect. The plan correctly uses `.get`.
2. `pdf.context.delete(metaRef)` removes the entry from `indirectObjects`; pdf-lib's
   writer serializes by enumerating exactly that map, so the deleted XMP stream
   object is never emitted. Deleting the catalog `/Metadata` entry too leaves no
   dangling ref → the rebuilt xref is valid → the PDF still loads.
3. NO length-altering byte edit: the byte-sweep is removed; the literal-`pensmith`
   check is an explicit READ-ONLY post-save assertion (optionally throwing, never
   mutating).
4. Test D is a genuine negative control: because XMP is a *stream* object it can
   never be packed into a pdf-lib object stream, so a failed deletion would leave
   `Trace Sentinel` *literally* in the bytes — Test D would catch it. The
   still-loads assertion confirms no corruption.
   (Confirming detail the plan got right: `load(..., { updateMetadata: false })`
   suppresses pdf-lib's constructor-time `updateInfoDict()` Producer/ModDate
   injection; and the subsequent `setProducer('')` would overwrite it regardless.)

### Synthesized Findings (cycle 3)

#### HIGH

None. No reviewer found a residual or new goal-threatening defect that survives
adjudication. (gemini raised one [HIGH] — the DOCX binary-sweep heuristic — which
3/4 reviewers rated LOW and the judge downgrades to MEDIUM; see below.)

#### MEDIUM

- **[MEDIUM] Test D's `/Info` coverage can be defeated by pdf-lib's default
  `useObjectStreams: true` — a test-STRENGTH gap, not a delivered-property gap.**
  *(claude MEDIUM; codex MEDIUM — convergent, sharpest finding.)* `pdf.save()`
  defaults to object streams (PDF 1.5 compressed xref), which Flate-compresses all
  NON-stream objects — including the `/Info` dictionary — into a binary object
  stream. A `bytes.toString('latin1')` literal scan therefore cannot see `/Info`
  contents, so a future regression that broke the `/Info` setters (but kept XMP
  deletion) could pass a literal-only Test D falsely. The load-bearing
  `Trace Sentinel`/XMP assertion is UNAFFECTED (stream objects stay uncompressed),
  so structural XMP removal IS genuinely proven and SC1's delivered property holds —
  this is why it is MEDIUM (test strength) not HIGH (delivery). **Fix direction:**
  make Test D assertion (3) reload the scrubbed PDF via `PDFDocument.load` and
  inspect `getProducer()/getAuthor()/…` STRUCTURALLY (not a byte scan), OR have
  `zeroTracePdf` save with `{ useObjectStreams: false }` so `/Info` stays literally
  scannable — and state which in the plan so the executor does not implement (3) as
  a latin1 scan and inherit the blind spot.

- **[MEDIUM] The DOCX defense-in-depth sweep's text-vs-binary heuristic
  (`attempt .async('string')`; skip only `word/media/*`) can corrupt binary parts on
  the LIVE Pandoc path.** *(gemini HIGH; claude LOW; codex LOW — downgraded from HIGH
  to MEDIUM.)* JSZip's `.async('string')` does NOT throw on binary data — it blindly
  coerces bytes to a string — so the only real protection against corrupting a
  non-`media` binary part (embedded fonts under `word/fonts/`, `docProps/thumbnail.*`,
  OLE objects, `.bin` printer settings) is the name-based `media/*` skip. A
  re-encode-on-rewrite of such a part would produce an unopenable `.docx`. **Why
  NOT HIGH:** the committed offline fixture contains no such binary parts, so the
  CI-gated zero-trace test (the SC1 proof) is safe and passes; the corruption risk
  only materializes on the live Pandoc export path, which is a documented manual
  check, not CI-gated. So SC1's delivered/tested property is not threatened — but a
  real user export could break. **Fix direction:** replace the `async('string')` +
  `media/*` heuristic with a strict text-entry ALLOWLIST (`.xml`, `.rels`, known
  text parts: core/app/custom/document/settings/headers/footers) before any
  string-replace + rewrite; harden this before the live Pandoc path ships.

#### LOW

- **[LOW] The optional post-save residual assertion names only `pensmith`, not the
  equally load-bearing `Trace Sentinel`.** *(codex.)* If a read-only post-save
  assertion is added inside `zeroTracePdf`, assert BOTH tokens absent (Test D already
  does; mirror it in the production assertion).
- **[LOW] `context.delete(metaRef)` should be `instanceof PDFRef`-guarded.**
  *(claude, opencode.)* `PDFDict.get` is typed `PDFObject | undefined`; guard with
  `if (metaRef instanceof PDFRef)` so an unexpectedly-inline `/Metadata` is a clean
  no-op rather than a type error / wrong delete. The plan already says "wrap in
  try/catch"; the `instanceof PDFRef` guard is the precise contract (and resolves the
  TS cast opencode flagged).
- **[LOW] The PDF-fixture generator should additionally assert
  `catalog.get(/Metadata) instanceof PDFRef`, not just that `load` succeeds.**
  *(claude.)* So a botched hand-authored xref/`/Length` that makes pdf-lib silently
  rebuild the xref (and not expose `/Metadata` as a ref) is caught at fixture
  creation — guaranteeing the fixture provably exercises the structural-delete path.
- **[LOW] Pin BOTH `## Pass-2` heading variants in the contract constant.**
  *(claude.)* `renderPass2Section` emits `advisory — LLM-judged` (non-empty) vs.
  `advisory` + `_(no citations to judge)_` (empty); ensure the pinned constant covers
  both so a clean empty section is not misclassified as present-but-unparseable
  (which would spuriously trip the fail-safe sentinel on every clean section). The
  plan already recognizes the empty marker; make the constant explicit.
- **[LOW] `readSectionUnsupported` treats an UNREADABLE (vs. absent)
  `VERIFICATION.md` as clean.** *(codex.)* Consider treating a read error on an
  EXISTING file as the synthetic UNSUPPORTED sentinel (keeping a genuinely missing
  file clean), to avoid a permissions/partial-write silent drop.
- **[LOW] `--raw` flag name is unintuitive for "skip humanizer."** *(opencode.)*
  Consider `--no-humanize`. Cosmetic.
- **[LOW] `collectGateIssues` Pass-4 aggregation is correct but should be
  test-asserted for the multi-paragraph case.** *(opencode.)* `some(orphanCount>0)`
  over `Pass4Result[]` is right; add a test that one clean + one orphaned paragraph
  still trips `hasIssues`.

#### Dismissed (not a real finding)

- **gemini's "[MEDIUM] typo in `extractDistinctivePhrases` citation stripping" —
  FALSE / relay artifact.** The actual 06-02 plan text reads `[@citekey]` correctly
  at Task 1 behavior, action, and acceptance lines (verified: 06-02-PLAN.md lines
  98, 103, 113). The mangled rendering gemini saw is a prompt-relay auto-link
  artifact, not a planner hallucination — the plan's intent ("strip `[@citekey]`
  markdown citation tokens before windowing") is unambiguous.

### Judge's Reconciliation Notes (cycle 3)

- **Raw HIGH counts:** codex 0, gemini 1, claude 0, opencode 0. **Adjudicated: 0.**
- **All four prior HIGHs (HIGH-1, HIGH-2, HIGH-3, HIGH-C2-1) are confirmed
  GENUINELY RESOLVED** by unanimous reviewer agreement plus plan-text + pdf-lib
  semantics verification. HIGH-C2-1 — the cycle-2 broken `zeroTracePdf` — is the
  headline: the structural `context.delete(metaRef)` before `save()` is the correct
  fix, there is no length-altering byte edit, and Test D is a real negative control.
- **gemini's lone [HIGH] (DOCX binary-sweep heuristic) → downgraded to MEDIUM.**
  Real correctness bug for the LIVE Pandoc `.docx` path, but the CI-gated zero-trace
  test (the SC1 proof) is safe because the committed fixture has no vulnerable binary
  parts; 3/4 reviewers rated it LOW. It threatens a real user export, not the
  delivered/tested success criterion — MEDIUM, fix before the live Pandoc path ships.
- **The convergent `/Info`-literal-scan-under-object-streams finding (claude+codex)
  is the sharpest residual**, but it is a test-STRENGTH gap (the load-bearing XMP
  assertion is unaffected; structural removal is genuinely proven), so MEDIUM not
  HIGH.
- No reviewer found a 17th verb, live network in tests, a gate bypass without
  `--yolo`, a chokepoint violation, or an honest-framing non-negotiable regression.
  The non-negotiables hold.

### Per-Reviewer Raw (cycle 3)

#### codex (exit 0)

```
Prior HIGH status:

- HIGH-1: GENUINELY RESOLVED. 06-01 and 06-04 now cover `.pdf` and `.tex` offline: committed PDF fixture, structural PDF scrub test, and a real offline-produced `.tex` artifact scanned by TEST-10.
- HIGH-2: GENUINELY RESOLVED. 06-01 and 06-04 expand DOCX coverage to the full Dublin Core/cp/app field set, tolerate self-closing/attribute-bearing tags, and sweep all non-dir ZIP entries including `_rels/.rels`.
- HIGH-3: GENUINELY RESOLVED. 06-05 adds `readSectionUnsupported` pinned to `renderPass2Section`, distinguishes absent vs present-unparseable Pass-2 sections, fails safe with a synthetic UNSUPPORTED sentinel, and tests the non-`--yolo` on-disk gate path.
- HIGH-C2-1: GENUINELY RESOLVED. 06-04 specifies deleting the catalog `/Metadata` indirect object from `pdf.context` before `save()`, then deleting the catalog entry, with no post-save byte mutation; Test D checks both `pensmith` and `Trace Sentinel` absence plus `PDFDocument.load`.

Corrected `zeroTracePdf` verdict: technically sound. Given pdf-lib’s serializer walks `context.indirectObjects`, `pdf.context.delete(metaRef)` on the actual XMP stream ref before `save()` should prevent that object from being serialized. The plan also correctly removes the unsafe length-altering byte sweep and makes any residual string check read-only. Test D is now a real negative control because `Trace Sentinel` is planted outside the literal `pensmith` token and must disappear too.

Remaining concerns:

[MEDIUM] 06-04 Task 1: The PDF scan is raw-byte based after `pdf.save()`, but pdf-lib may serialize with object streams/compression by default. If a future residual metadata stream were compressed, a literal byte scan for `pensmith` / `Trace Sentinel` could miss it. Fix direction: save scrubbed PDFs with `useObjectStreams: false` in testable paths, or add a PDF-structure inspection after reload that confirms the catalog has no `/Metadata` and document-info values are empty.

[LOW] 06-04 Task 1: The optional residual assertion only names `pensmith`, while the negative-control token `Trace Sentinel` is equally load-bearing for proving structural removal. Fix direction: if adding a post-save read-only assertion, assert both `pensmith` and `Trace Sentinel` are absent.

[LOW] 06-05 Task 2: `readSectionUnsupported` skips unreadable `VERIFICATION.md` files as clean. That is probably acceptable for I/O robustness, but it creates a small silent-drop case if permissions or partial writes hide Pass-2 data. Fix direction: consider treating read errors on an existing `VERIFICATION.md` as the same synthetic UNSUPPORTED sentinel, while keeping missing files clean.

HIGH_COUNT: 0

```

#### gemini (exit 0)

```
### Assessment of Prior HIGH Concerns

- **HIGH-1 (PDF/.tex zero-trace tests):** GENUINELY RESOLVED. The plan explicitly introduces hand-authored, offline `.pdf` and `.docx` negative-control fixtures (06-01), implements an offline `.tex` writer, and rigorously scans all four formats offline without relying on Pandoc.
- **HIGH-2 (DOCX sweep scope & fixture):** GENUINELY RESOLVED. The DOCX negative-control fixture is independently constructed with varied tag structures and a `_rels/.rels` trap, and `zeroTracePatch` is correctly expanded to sweep the full Dublin-Core/app field set + non-XML entries.
- **HIGH-3 (Pass-2 → Gate feed untested & unsafe):** GENUINELY RESOLVED. `readSectionUnsupported` implements a strict fail-safe for unparseable tables, and the data feed is proven via unit parse tests, fail-safe tests, and a non-`--yolo` on-disk integration test.
- **HIGH-C2-1 (PDF scrub broken mechanism):** GENUINELY RESOLVED. The scrub correctly utilizes `pdf-lib`'s structural deletion capabilities rather than relying on flawed regex byte-replacements.

### Verdict on `zeroTracePdf` Mechanism

The corrected `zeroTracePdf` mechanism is **technically sound**.
- **Context Deletion:** Yes, calling `pdf.context.delete(metaRef)` removes the XMP stream object from the `pdf-lib` indirect object map entirely. Because `save()` serializes only what exists in this context map, the stream will not be written to the output bytes. Deleting the catalog entry simultaneously ensures no dangling references remain.
- **No Byte Edits:** Yes, the plan strictly forbids length-altering byte edits on the serialized PDF, opting instead for a safe, read-only post-save assertion.
- **Test D Asserts:** Yes, Test D explicitly asserts the absence of the literal `'pensmith'` and the `'Trace Sentinel'` token, proving structural removal, while also guaranteeing the output remains a valid, loadable PDF via `PDFDocument.load`.

---

### Review Concerns

- `[HIGH]` **Plan 06-04 Task 1: DOCX text-entry sweep risks binary corruption.** 
  - **Problem:** The instructions for the `zeroTracePatch` defense-in-depth sweep tell the executor to identify text entries by "attempting `.async('string')` and skipping entries that are clearly binary (e.g. `media/*`)". JSZip's `async('string')` does **not** throw an error on binary data; it blindly coerces the bytes into a UTF-8 string. If the routine reads embedded fonts, OLE objects, or `.bin` printer settings as a string, runs a replace, and writes them back, it will permanently corrupt the binary structure, making the resulting `.docx` unopenable. 
  - **Fix Direction:** Do not use `media/*` or `async('string')` exceptions as a heuristic. The sweep MUST use a strict allow-list of known text extensions (e.g., `.xml`, `.rels`, `.txt`) when performing string-based replacements.

- `[MEDIUM]` **Plan 06-02 Task 1: Typo in `extractDistinctivePhrases` citation stripping instruction.** 
  - **Problem:** The plan instructs the executor to strip "`[ @bin\lib\citekey.ts]` tokens" from candidate phrases. This is a planner hallucination (likely an auto-complete injection). If the executor follows this literally, they will search for that exact string instead of actual markdown citations, causing actual citekeys (e.g., `[@smith2020]`) to be included in DuckDuckGo plagiarism searches.
  - **Fix Direction:** Correct the instruction to explicitly strip standard markdown citation tokens (e.g., `\[@[^\]]+\]`).

HIGH_COUNT: 1

```

#### claude (exit 0)

```
I've reviewed all five revised plans against the codebase context (PROJECT.md, ROADMAP.md, 06-RESEARCH.md, 06-PATTERNS.md), the success criteria, and the prior-cycle HIGH history. Here is the cycle-3 review.

---

# Cross-AI Plan Review — Pensmith Phase 6 — CYCLE 3

## Status of the four prior HIGH concerns

- **HIGH-1 (cycle 1 — PDF/.tex zero-trace not delivered/tested): GENUINELY RESOLVED.** 06-04 now ships `zeroTracePdf` (pure-JS pdf-lib, no engine) as the mandatory last step of every `.pdf` export; 06-01 commits an independent PDF negative-control fixture; TEST-10 Test D scrubs+scans it offline, and Test F scans a REAL offline-produced `.tex` from the deterministic md→tex writer (not "clean by construction"). All four formats are CI-gated offline.

- **HIGH-2 (cycle 1 — docx field-set/sweep too narrow + fixture co-authored with patch): GENUINELY RESOLVED.** Full Dublin-Core+cp+app field set enumerated in both fixture (06-01) and scrub (06-04); sweep iterates ALL non-dir entries incl. `_rels/.rels`; regexes specified tolerant of self-closing + attribute-bearing tags; fixture hand-authored independently with literal-`pensmith` traps in `cp:category` AND `_rels/.rels`, plus an attribute-bearing `dc:subject` and self-closing `<Template/>`. Genuine negative control.

- **HIGH-3 (cycle 1 — Pass-2→gate feed untested + silent swallow + only `--yolo` test): GENUINELY RESOLVED.** `readSectionUnsupported` is pinned to the `renderPass2Section` contract and fails safe (present-but-unparseable → synthetic `<unparseable>` UNSUPPORTED sentinel; absent heading / `_(no citations to judge)_` → clean). 06-05 adds the three missing tests: unit parse over the committed fixture, fail-safe-on-malformed, and a NON-`--yolo` on-disk integration test asserting the gate fires (per-issue summary before approve, `exported:false`).

- **HIGH-C2-1 (cycle 2 — `zeroTracePdf` mechanism broken): GENUINELY RESOLVED.** The catalog-only delete + length-altering byte-sweep is gone; replaced with `context.delete(metaRef)` on the indirect XMP stream object before `save()`, catalog `/Metadata` entry removal, `/Info` cleared via setters, and a READ-ONLY post-save assertion. See mechanism verdict below.

## Verdict on the corrected `zeroTracePdf` mechanism: TECHNICALLY SOUND

Checking against pdf-lib internals:

1. **`catalog.get(PDFName.of('Metadata'))` returns the indirect ref, not the resolved stream.** `PDFDict.get()` does NOT follow references (only `.lookup()` does), so it returns the `PDFRef`. Per the PDF spec the catalog `/Metadata` entry MUST be indirect, and the fixture authors it as such. Correct — the plan explicitly uses `.get` (not `.lookup`), which is the load-bearing distinction.

2. **`pdf.context.delete(metaRef)` before `save()` prevents serialization.** `PDFContext.delete(ref)` removes the entry from `indirectObjects`; pdf-lib's writer serializes by enumerating exactly that map, so a deleted object is never emitted. The only reference to the XMP stream is the catalog entry, which is also deleted → no dangling ref → file stays valid; the rebuilt xref represents the gap correctly. Correct.

3. **No length-altering byte edit.** The byte-sweep is removed; the literal-`pensmith` check is an explicit READ-ONLY assertion (optionally throwing, never mutating). Correct.

4. **Test D is a genuine negative control.** It asserts BOTH `pensmith` AND the non-`pensmith` `Trace Sentinel` are absent AND `PDFDocument.load` still succeeds. The `Trace Sentinel`/XMP path is the meaningful one — since XMP is a *stream* object it can never be packed into a pdf-lib object stream, so a failed deletion would leave it **literally** in the bytes and Test D would catch it. This correctly proves structural removal, not literal masking.

One confirming detail the plan got right: `updateMetadata: false` on `load` suppresses pdf-lib's constructor-time `updateInfoDict()` (which would otherwise inject `Producer: pdf-lib …` + a `new Date()` ModDate). Even if omitted, the subsequent `setProducer('')` would overwrite it — so the design is resilient here.

## Remaining concerns

- `[MEDIUM]` **06-04 / 06-01 — Test D's `/Info` coverage can be defeated by pdf-lib's default `useObjectStreams: true`.** `pdf.save()` defaults to object streams (PDF 1.5 compressed xref), which Flate-compresses all NON-stream objects — including the `/Info` dictionary — into a binary object stream. A `bytes.toString('latin1')` literal scan therefore *cannot* see `/Info` contents, so a future regression that broke the `/Info` setters (but kept XMP deletion) would pass a literal-only Test D falsely. The `Trace Sentinel`/XMP assertion is unaffected (streams stay uncompressed), but the `/Info` path is not genuinely scanned. Fix direction: make Test D assertion (3) reload the scrubbed PDF via `PDFDocument.load` and inspect `getProducer()/getAuthor()/…` structurally (NOT a byte scan), **or** call `zeroTracePdf`'s `save({ useObjectStreams: false })` so `/Info` stays literally scannable. State which in the plan so the executor doesn't implement (3) as a latin1 scan and inherit the blind spot.

- `[LOW]` **06-04 — `context.delete(metaRef)` should be type/instance-guarded.** `PDFDict.get` is typed `PDFObject | undefined`, while `PDFContext.delete` expects a `PDFRef`. Guard with `if (metaRef instanceof PDFRef)` before deleting (and skip otherwise) so a fixture/real-PDF that stores `/Metadata` unexpectedly inline becomes a clean no-op rather than a type error or wrong delete. The plan already says "wrap in try/catch," but an explicit `instanceof PDFRef` guard is the precise contract.

- `[LOW]` **06-04 — docx defense-in-depth sweep's text-vs-binary heuristic is name-based only.** `.async('string')` never throws on binary (JSZip decodes bytes regardless), so the only real protection against corrupting a binary part is the `word/media/*` name skip. The committed fixture contains no binary parts, so the gated test is safe; but for live docx (embedded fonts under `word/fonts/`, `docProps/thumbnail.*`) a re-encode-on-rewrite could corrupt non-`media` binary parts. Tighten the skip list (or gate on a content-type/extension allowlist) before the live Pandoc path is exercised. Not a gating-test threat.

- `[LOW]` **06-01 — hand-authoring a byte-exact uncompressed PDF with a correct xref + indirect XMP `/Length` is fragile.** A wrong stream `/Length` or xref offset can make pdf-lib silently rebuild the xref or fail to expose `/Metadata` as a ref. This is an execution risk, not a contract gap — the generator's `PDFDocument.load` + `catalog.get(/Metadata) instanceof PDFRef` validation gate catches a botched fixture at creation. Recommend the generator additionally assert `pdf.catalog.get(PDFName.of('Metadata'))` is a `PDFRef` (not just that load succeeds), so the fixture provably exercises the structural-delete path.

- `[LOW]` **06-05 — `## Pass-2` empty-variant heading divergence is handled but worth pinning explicitly.** `renderPass2Section` emits two different headings (`advisory — LLM-judged` for non-empty vs. `advisory` + `_(no citations to judge)_` for empty). The plan correctly says match the `## Pass-2` prefix and recognize the empty marker before failing safe; ensure the pinned-contract constant covers BOTH heading variants so the empty-but-clean case is not misclassified as "present-but-unparseable" (which would spuriously trip the fail-safe sentinel on every clean section).

## Summary

The four prior HIGHs are all genuinely resolved, and the rewritten `zeroTracePdf` is technically correct against pdf-lib's serialization model — the structural `context.delete` before `save()` is the right fix, there is no length-altering byte edit, and Test D is a real negative control. The only sharp residual issue is a test-robustness gap (`/Info` invisible to a literal scan under pdf-lib's default object streams), which threatens test *strength* rather than the delivered zero-trace property, so it is MEDIUM, not HIGH.

HIGH_COUNT: 0

```

#### opencode (exit 0)

```
Here is my Cycle 3 adversarial review of the five revised Phase 6 plans.

## Prior HIGH — GENUINELY RESOLVED

1. **HIGH-1 (PDF/.tex zero-trace not delivered/tested)**: RESOLVED. Offline-compatible real PDF fixture (hand-authored, independent of pdf-lib), `zeroTracePdf` structural XMP-object delete, a deterministic offline `md→tex` writer, and TEST-10 scanning all 4 formats offline (no Pandoc, no engine). The .tex is a real scanned artifact, not "clean by construction."

2. **HIGH-2 (docx scrub field-set too narrow)**: RESOLVED. Full Dublin-Core + `cp:` + `app:` field set (includes `cp:category`, `Company`, `Manager`, `Template`, attribute-bearing `dc:subject`). Sweep covers ALL non-dir entries including `_rels/.rels`. Regexes handle self-closing and attribute-bearing forms. The fixture is independently authored with traps (`cp:category` + `_rels/.rels` both carry `'pensmith'`).

3. **HIGH-3 (Pass-2→gate feed untested/silently swallowed)**: RESOLVED. `readSectionUnsupported` fails safe: present-but-unparseable → synthetic `<unparseable>` UNSUPPORTED sentinel (never silent `[]`); genuinely absent → clean. Pinned to `renderPass2Section` contract via module-level constant. Tested end-to-end (unit parse + fail-safe + non-`--yolo` on-disk integration).

4. **HIGH-C2-1 (zeroTracePdf mechanism broken)**: RESOLVED. Corrected mechanism captures catalog `/Metadata` indirect ref and calls `pdf.context.delete(metaRef)` on the XMP stream **indirect object** BEFORE `save()` — the stream is removed from `indirectObjects` so the serializer never emits it. No length-altering byte edits (the `replace(/pensmith/gi, '')` removal is explicit). Test D asserts both `'pensmith'` AND `'Trace Sentinel'` absence AND still-loads — a genuine negative control.

## zeroTracePdf technical assessment

**Sound.** The chain is correct:
- `pdf-lib`'s `PDFContext.delete(ref)` removes the ref from `indirectObjects` → `save()` iterates `enumerateIndirectObjects` which reads from that map → the deleted stream object is never serialized.
- `/Info` is cleared via pdf-lib's public setters (`setTitle('')`, etc.), so `(Trace Sentinel)` in `/Author` becomes `()`.
- The byte-level scan (`toString('latin1')`) is read-only; no xref-offset-altering mutation.
- Test D's assertion on `'Trace Sentinel'` (the non-pensmith token) proves STRUCTURAL removal (XMP stream object gone from bytes) not mere literal masking. The "still loads via `PDFDocument.load`" assertion confirms no corruption.

One micro-implementation risk: `pdf.catalog.get(PDFName.of('Metadata'))` returns `PDFObject | undefined`, not `PDFRef | undefined`. At runtime the value IS a `PDFRef`, but TypeScript may require a cast before passing to `context.delete()`. This is a trivial line-level fix, not a design concern.

## NEW concerns

**[MEDIUM] The `collectGateIssues` function buckets Pass4 `orphanCount>0` results, but `Pass4Result` has an array of per-paragraph results. The plan uses `orphanCount>0` as the per-result gate flag, not aggregated across paragraphs.** If one paragraph has 0 orphans and another has 2, and the user passes `collectGateIssues` with the per-paragraph `Pass4Result[]`, the plan says to filter `orphanCount>0`. This works — any paragraph with orphans triggers the gate. But the plan should clarify it aggregates across all paragraphs (any `orphanCount>0` → `hasIssues = true`). Currently `collectGateIssues` takes `pass4Results: Pass4Result[]` — a `some()` check is correct. **Fix:** already implied by type; just ensure the test asserts multi-paragraph aggregation too.

**[LOW] The done pipeline writes `.paper/VERIFICATION.md` (whole-paper level) which could conceptually collide if section-level VERIFICATION.md files are later restructured.** Current paths are distinct (`.paper/VERIFICATION.md` vs `.paper/sections/N/VERIFICATION.md`). No actual risk.

**[LOW] The `--raw` flag name is unintuitive for "skip humanizer"** — users might expect it to mean "skip formatting" or "raw markdown." Consider renaming to `--no-humanize`. Not a HIGH; easily changed.

**[LOW] The `exportDraft` Pandoc-latex path says "defensively strip any `% pensmith`/`% Generated` line"** — this IS a byte edit on the .tex, but since .tex is plaintext with no xref offsets, a line-based strip is safe. And the CI-tested offline path produces a clean .tex by construction with no stripping needed.

## Verdict

All four prior HIGHs are genuinely resolved. The corrected `zeroTracePdf` mechanism is technically sound. No new HIGH concerns. The plans deliver the Phase 6 success criteria including the non-negotiable zero-trace gate.

HIGH_COUNT: 0

```

