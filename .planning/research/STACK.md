# Stack Research

**Domain:** pensmith v0.3.0 "Truly End-to-End" — FEED (source-context prompt wiring), HARDEN (CI lanes for e2e/live/citation-integrity), SEC (DNS-rebind socket-pinning, PDF worker-abort)
**Researched:** 2026-07-06
**Confidence:** HIGH (all version claims checked against Context7 `/nodejs/undici` docs + `npm ls`/`npm view` on the actual installed tree; GitHub Actions mechanisms are documented platform behavior)

> **Scope note:** This file supersedes the project-inception `STACK.md` (2026-05-06, project-wide) for the purposes of the v0.3.0 milestone. It does not restate the foundational stack (Node/TypeScript/citty/citation-js/etc.) validated and shipped in v0.1.0/v0.2.0 — see `.planning/PROJECT.md` "Tech stack" and Key Decisions for that. This document answers one narrow question: **what, if anything, does v0.3.0 need to add to the stack?** The short answer is: almost nothing. All three workstreams are internal wiring on packages already in `package.json`.

## Recommended Stack

### Core Technologies

No new core technology is needed for v0.3.0. All three workstreams (FEED, HARDEN, SEC) build on the stack already validated in v0.1.0/v0.2.0: `undici@^7` (installed `7.25.0`), `fast-check@^3` (installed `3.23.2`), `pdf-parse@1.1.1` (pinned exact), Node's built-in `node:worker_threads`, and GitHub Actions' native secrets/environments primitives. The work is "use what's already a dependency, differently" — the table below documents *where in the existing stack* each new capability lives, not a new acquisition.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `undici` | `^7` (installed `7.25.0`; latest `7.28.0`) | HTTP client — already the sole network chokepoint (`bin/lib/http.ts`, D-06) | For WR-03 (DNS-rebind socket-pinning), undici's `connect` option — a function of shape `(opts, cb) => Socket`, built via the public `buildConnector()` helper — is the correct primitive. It lets the already-resolved (and already SSRF-classified) IP be handed directly to the TCP/TLS connect step, closing the TOCTOU window between `checkSsrf()`'s resolution (call A) and undici's own internal resolution (call B) — documented as residual 2a in `.planning/SECURITY.md`. Confirmed current via Context7 (`/nodejs/undici`, `docs/docs/api/Connector.md`, `docs/docs/api/Client.md`): `buildConnector`/custom `connect` function is stable, unchanged public API across the entire 7.x line. Zero new dependency — `http.ts` already imports `Agent` from `undici` (currently `void`-touched, staged for exactly this). |
| `node:worker_threads` | Node core (≥20.10, project's engine floor) | Isolate the `pdf-parse` call so it can be force-terminated on timeout | For WR-05, the current `Promise.race` in `bin/lib/pdf-text.ts` unblocks the *caller* on timeout but cannot stop `pdf-parse`'s CPU-bound work already in flight — `Promise.race` never cancels the losing promise, so pdf-parse keeps burning CPU in the background (documented residual, row 9 in SECURITY.md). Moving the parse into a `Worker` and calling `worker.terminate()` on timeout is the only way to actually reclaim that CPU. No package needed — `worker_threads` is a Node core module already implicitly available. |
| `fast-check` | `^3` (installed `3.23.2`) | Property-based testing | Already a devDependency and already used for exactly this class of test (`tests/doi.property.test.ts`, `tests/fuzzy.property.test.ts`, `tests/migration.property.test.ts`). The citation-integrity differential/property test HARDEN calls for is new *test code* using an existing tool, not a new tool. |

### Supporting Libraries

No supporting libraries are needed for FEED. It consumes `LIBRARY.json` (already written by `research`, schema already defined in `bin/lib/schemas/global-library.ts`) through the existing `bin/lib/prompt-loader.ts` chokepoint and existing Zod-validated schemas — this is prompt-string assembly plus a PLAN.md frontmatter field (`assigned_sources`), not new tooling.

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| — | — | — | No new supporting library is needed for FEED, HARDEN, or SEC. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| GitHub Actions `environments` | Gate the live-provider CI lane behind a secrets-scoped boundary (and optionally required reviewers) | Add a dedicated `environment: live-provider` (name TBD at plan time) on the new job. Environments scope secrets so they are exposed ONLY to jobs that declare that environment — the standard mechanism for "don't let an arbitrary job see `ANTHROPIC_API_KEY`." Combine with required-reviewer protection if you want a human gate before a live-cost run fires. |
| GitHub Actions trigger choice (`push`/`workflow_dispatch` vs `pull_request`/`pull_request_target`) | Prevent secret exfiltration via a forked PR | `secrets.*` are NOT populated for workflows triggered by `pull_request` from a fork (GitHub default protection) — today's CI is already safe on this axis. The risk appears only if the live lane is added on `pull_request_target` (runs with base-repo secrets against untrusted head-ref code) or a careless `workflow_run` re-trigger pattern. **Recommendation: put the live-provider lane on `push` (main-only) and/or `workflow_dispatch`, never on `pull_request`/`pull_request_target`.** This keeps the existing required 3-OS matrix job (cassette-only, no secrets, runs on every PR including forks) untouched, and isolates the costed/keyed lane to trusted, maintainer-triggered runs. |
| `c8` | Coverage gate | Already wired into `npm run test:coverage`; promoting `e2e-smoke.mjs` to a required job does not change this — it becomes a separate CI step/job (a script run, not a `node:test` file), not something c8 instruments. |
| `nock` | Cassette recording/replay — the non-secrets alternative/complement to the live lane | Already a devDependency (`^14`, installed `14.0.15`) and already used by `tests/tier-contract.test.ts` for offline cassette replay. Reuse the same nock-based fixture pattern to record one real pass2/pass4 LLM response plus one real Crossref/Retraction-Watch response, then replay it in ordinary (non-secret, fork-safe) CI. |

## Installation

```bash
# No new dependencies to install for v0.3.0's FEED, HARDEN, or SEC work.
# All three workstreams reuse packages already declared in package.json:
#   dependencies:    undici@^7
#   devDependencies: fast-check@^3, nock@^14, c8@^11
# and Node core modules: node:worker_threads, node:dns/promises (already used by checkSsrf).
```

If a version bump is taken (recommended hygiene, not required for the API to work):

```bash
npm install undici@^7.28.0
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Custom `connect` function via `buildConnector()` (undici) for WR-03 | undici's built-in `interceptors.dns()` composed onto an `Agent` (`import { interceptors } from 'undici'`) | The DNS interceptor is designed for lookup **caching**/round-robin/dual-stack selection, not as a security boundary — its `lookup` override performs its own independent resolution, so you'd still need to re-implement the private-range check (`isPrivateIp`) inside that callback, and you'd still pay for two separate resolutions (interceptor's + any pre-flight). A raw `connect` callback that receives the ALREADY-validated IP from the existing `checkSsrf()` and hands it straight to `buildConnector()`'s underlying `net.connect`/`tls.connect` is more surgical: one resolution, one classification, one connect — no second independent DNS round-trip re-opening the rebind window. Reach for the DNS interceptor instead only if the team later wants general-purpose DNS caching/dual-stack across all fetches as a *performance* feature, kept separate from the security fix. |
| Secrets-gated live-provider CI lane (`environment:` + `push`/`workflow_dispatch`-only trigger) | Recorded-live cassette only (a `nock` fixture captured from one real LLM + Crossref/Retraction-Watch session, replayed forever, no live lane at all) | Cassette-only is lower-risk (no live API cost, zero secret-exposure surface) but never re-verifies that the *actual* provider contract hasn't drifted (Anthropic changes a response field, Crossref changes its not-found semantics, Retraction Watch's feed shape shifts). **Recommendation: do both.** Keep the cassette lane as the default/required check on every PR (including forks), matching the existing `PENSMITH_NO_LLM` + `PENSMITH_NETWORK_TESTS` offline-by-default convention. Add the secrets-gated live lane as an additional, `main`-only or `workflow_dispatch`-only job that exercises the real pass2/pass4 LLM path + live Crossref/Retraction-Watch re-query + the SSRF preflight, and treat a failure there as "go re-record the cassette," not as a PR blocker. |
| `node:worker_threads` for the pdf-parse abort | `child_process.fork()` a dedicated subprocess for the parse | A subprocess gives stronger isolation (separate OS process, immune to any shared-heap issue) but the codebase already reserves the `execFile`-subprocess pattern (`bin/lib/pymupdf-shellout.ts`) for shelling out to an *external* Python interpreter, not for running project TypeScript. `worker_threads` is the idiomatic Node primitive for "isolate and hard-terminate a piece of our own JS/TS," has lower spawn overhead than forking a process, and `worker.terminate()` gives the same hard-stop guarantee this fix needs. Reach for `child_process.fork()` only if `pdf-parse`'s dependency chain is ever found unsafe to load twice in one process — not the case today (pdf-parse + its `pdfjs-dist`-derived internals are pure JS). |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| A new HTTP-level SSRF-guard npm package (e.g. `ssrf-req-filter`, `request-filtering-agent`) for WR-03 | The project already has a hand-audited, test-covered `checkSsrf()` (`tests/ssrf-guard.test.ts`, marked PROVEN in `.planning/SECURITY.md` row 1–2) with an injectable resolver for tests and full IPv4/IPv6/CGNAT/IPv4-mapped coverage. Swapping to a third-party filtering-agent package means re-auditing a new trust boundary and re-wrapping undici's dispatcher — no net safety gain, real audit cost, and it would NOT close the TOCTOU gap either (most of these packages have the same "validate then let the HTTP client re-resolve" limitation unless they also socket-pin). | Extend `checkSsrf()`'s existing resolution result into a `connect` callback (see Recommended Stack) instead of adopting a new guard library. |
| `execa` / `zx` / other subprocess-convenience wrappers for the PDF worker-abort fix | The fix is about JS-level cancellation of *in-process* CPU-bound work (`pdf-parse`), not about shelling out to an external process — those libraries solve a different, unrelated ergonomics problem, which `pymupdf-shellout.ts` already handles adequately with plain `node:child_process`. | `node:worker_threads` (built-in). |
| GitHub Actions `pull_request_target` for the live-provider lane | Runs workflow code with base-repo secrets while checking out the (possibly malicious) head ref from the fork — a well-known secret-exfiltration vector if any step in the job touches the PR's own files or re-executes its scripts. | `environment:`-scoped secrets on a `push` (main-only) or `workflow_dispatch` trigger; never react to arbitrary fork-PR content with secrets available. |
| A new mocking/snapshot library for the citation-integrity differential test | `fast-check` (property-based generation of citekey/source permutations) + `nock` (deterministic HTTP replay) together already provide the two building blocks a differential/property test needs. Reaching for e.g. a Jest-style snapshot tool would introduce a second, parallel test framework in a codebase that uses `node:test` + `c8` exclusively. | Compose `fast-check` arbitraries (citekey sets, assigned-source subsets, section/source mappings) with the existing Pass-1 verifier and the `tests/fixtures/known-bad-citations.json` pattern to assert, as a property (not a single example), "no citekey the drafter emits is outside its section's `assigned_sources` map." |

## Stack Patterns by Variant

**If FEED's assigned-source map needs a stable on-disk shape (PLAN.md `assigned_sources` frontmatter):**
- Extend the existing Zod schema in `bin/lib/schemas/plan-frontmatter.ts` with an `assigned_sources` field (an array of `{citekey, title, authors, abstract}`, or citekey-only with a LIBRARY.json lookup at prompt-build time — cheaper to keep in sync since LIBRARY.json is the existing source of truth).
- Because: the project's own constraint is "schema versioning from day one," and `plan-frontmatter.ts` is the existing chokepoint every downstream verb (write, verify, compile) already reads through — extending it is lower-risk than inventing a second manifest file or a new schema module.

**If the live-provider CI lane needs to exercise SSRF preflight against a real DNS response (not an injected resolver):**
- Keep this a `PENSMITH_NETWORK_TESTS=1`-gated manual/live-only check (as `.planning/SECURITY.md` row M-1 already documents), NOT a job that runs unattended on every push — live DNS behavior against attacker-influenced infrastructure isn't something to automate on shared CI runners.
- Because: this matches the project's existing "manual-only verification" pattern for live-network security assertions (SECURITY.md rows M-1/M-2) rather than inventing a new CI paradigm for one edge case.

**If `e2e-smoke.mjs` is promoted to a required, strict job:**
- Change its exit semantics so `[FINDING]` entries also fail the run (gate this behind a flag, e.g. `--strict`, so local `node scripts/e2e-smoke.mjs` can stay advisory for exploratory runs) — the harness already has the check vocabulary (`pass`/`fail`/`finding`/`info`) needed; the change is a small addition to the final exit-code calculation plus new STATE.json/PLAN.md transition assertions added as more `existsSync`/JSON-shape checks in the same file, not a rewrite or a new tool.
- Because: the harness already drives the real bare-`pensmith` router chain end-to-end offline (`PENSMITH_NO_LLM=1` + cassettes, isolated data dir) — the milestone context's ask ("promote into a strict required CI job with STATE.json/PLAN.md transition asserts") is additive to the existing file, not a new harness.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `undici@^7.25.0` (installed) | Node ≥20.10 (project's engine floor) | `buildConnector`/custom `connect` function and `interceptors.dns()` are both stable across the entire undici 7.x line (confirmed present 7.24.5 → 7.28.0 per Context7 docs and the npm registry version listing) — no minimum-version bump is required to use the `connect` callback for WR-03. A bump to `^7.28.0` (latest at research time) is reasonable hygiene alongside this work but not a hard requirement; the existing `^7` range in `package.json` already covers it. |
| `fast-check@^3.23.2` (installed) | `node:test` (project's runner, via `scripts/run-tests.mjs`) | Already proven compatible — `tests/doi.property.test.ts` and siblings run today under the same `node --test` harness a citation-integrity differential test would use. No version change needed. |
| `pdf-parse@1.1.1` (pinned exact — do not bump per existing supply-chain pin guard, `tests/repo-files.test.ts`) | `node:worker_threads` | `pdf-parse` (and its inner `pdf-parse/lib/pdf-parse.js` sub-path import, per the existing D-06 chokepoint comment) is pure JS with no native/WASM binding, so it loads cleanly inside a `Worker` with no additional bundling/transfer concerns. Pass the input `Buffer` via `workerData` or `postMessage`; for large PDFs (near the existing 50 MB `MAX_PDF_BYTES` cap) consider a `Transferable`/`SharedArrayBuffer` to avoid a structured-clone copy, though a plain copy is likely acceptable given the cap already bounds the worst case. |
| GitHub Actions `environment:` secrets | Existing 3-OS matrix (`ubuntu-latest`/`macos-latest`/`windows-latest`, Node `20.18`) | Adding a 4th job (the live-provider lane) does not require matrix changes — it runs as a single-OS job (`ubuntu-latest` is sufficient; the live lane tests provider/API behavior, not OS-specific code paths) scoped to its own `environment:`, independent of the existing `strategy.matrix` job. No conflict with the current `ci.yml` structure; it is a new top-level job in the same workflow file or a separate workflow file entirely (either is viable — a separate file makes the "requires secrets, may be skipped on forks" distinction more visible in the Actions UI). |

## Sources

- Context7 `/nodejs/undici` — queried "Agent connect option custom connector function socket pinning DNS lookup override" and "connect option as a function custom connector net.connect tls.connect socket callback signature"; confirmed `buildConnector()`, the `connect(opts, cb)` function-form accepted by `Client`/`Agent`, and the built-in `interceptors.dns()` composition pattern (`import { Agent, interceptors } from 'undici'`) are current, stable, documented API in the undici 7.x docs tree (`docs/docs/api/Connector.md`, `docs/docs/api/Client.md`, `docs/docs/api/Interceptors.md`). HIGH confidence.
- `npm view undici versions` (live registry query, this session) — confirmed version range 7.24.5 → 7.28.0 exists; `npm ls undici fast-check nock` confirmed the installed tree has `undici@7.25.0`, `fast-check@3.23.2`, `nock@14.0.15`. HIGH confidence.
- Direct repo inspection (this session): `bin/lib/http.ts` (SSRF guard implementation; unused `Agent`/`getGlobalDispatcher`/`setGlobalDispatcher` undici imports already staged with a comment anticipating exactly this wiring — "we may use it in Phase 2 when wiring connection pooling"), `bin/lib/pdf-text.ts` + `bin/lib/pymupdf-shellout.ts` (current `Promise.race` timeout that does not cancel in-flight work; existing subprocess-shellout precedent for external interpreters), `.planning/SECURITY.md` (rows 2a and 9 are the exact WR-03/WR-05 residuals, with the fix direction — "pass the pre-resolved IP to undici via a custom `connect` callback," "migrate parse to `worker_threads` and call `worker.terminate()`" — already specified by the prior security audit), `package.json` (current dependency/devDependency versions), `.github/workflows/ci.yml` (current job/matrix/step shape), `scripts/e2e-smoke.mjs` (existing `pass`/`fail`/`finding`/`info` check framework, already drives the real router chain offline), `bin/cli/plan.ts` (confirms the "placeholder" context referenced in PROJECT.md), `tests/doi.property.test.ts` + `tests/fuzzy.property.test.ts` + `tests/migration.property.test.ts` (confirm `fast-check` is already the project's in-use property-testing tool). HIGH confidence — these are direct reads of the current codebase, not inference.
- GitHub Actions environments/secrets/forked-PR behavior — documented platform behavior: secrets are not exposed to `pull_request`-triggered workflows originating from forks by default; `environment:` scoping (+ optional required reviewers) is the standard gate for a job holding a real, costed API key; `pull_request_target` is the known-risky trigger to avoid when secrets are present alongside untrusted checked-out code. MEDIUM confidence (stable, well-known platform behavior, but not re-verified against GitHub's own docs in this session — recommend a final check of GitHub's "Security hardening for GitHub Actions" page at plan/implementation time).

---
*Stack research for: pensmith v0.3.0 (FEED / HARDEN / SEC workstreams)*
*Researched: 2026-07-06*
