# Contributing to Pensmith

Pensmith is in v0.1.0 development. The full CONTRIBUTING guide lands in Phase 2 alongside the tier-contract test gate.

## Architectural chokepoints (Phase 0+)

Two lint-enforced chokepoints exist from Phase 0 onward. Violating them fails CI:

1. **HTTP imports**: `fetch`, `http`, `https`, `node:http`, `node:https`, `undici` may only be imported from `bin/lib/http.ts`. Every other module routes through that file.
2. **DOI regex**: The literal regex `/^10\./` may only appear in `bin/lib/doi.ts`. DOI normalization is a single chokepoint per `.planning/research/PITFALLS.md` Pitfall 2.

See `eslint.config.js` for the rules and `tests/lint-chokepoint.test.ts` for the regression gate.

## Locked copy files (SHA-256 byte-pinned)

Some `references/*.md` files are the SINGLE source of truth for user-facing prose
that production code renders verbatim. Each is byte-pinned by SHA-256 in
`tests/repo-files.test.ts`. Editing one without re-pinning the hash fails CI.

### Honesty framing copy is LOCKED

`references/honesty-framing.md` is the single source of the GPTZero honest-framing
prose. `bin/lib/honesty.ts` reads and renders it VERBATIM — the copy is never
inlined in code. This file is byte-pinned in `tests/repo-files.test.ts`.

Any wording change is a deliberate PR that MUST also re-pin the SHA-256 in
`tests/repo-files.test.ts` (the test message prints the new hash to paste). The
framing MUST remain transparency-only: it states what the GPTZero score means and
that the humanizer "improves prose" — it NEVER claims to make output undetectable
and is NEVER framed as a detection-avoidance tool. This is the CLAUDE.md
non-negotiable ("improves prose, does not evade detection"); a PR that turns the
framing into an undetectability claim must not be merged.

The committed zero-trace negative-control fixtures
(`tests/fixtures/sample-zero-trace.docx` and `.pdf`) are likewise SHA-256
byte-pinned in `tests/repo-files.test.ts`. They are regenerated via
`node scripts/make-zero-trace-fixture.mjs` / `node scripts/make-zero-trace-pdf-fixture.mjs`;
re-pin the hash in the same PR if a regeneration is intentional. A silently
changed fixture could mask a real zero-trace regression, so drift is a CI failure.

## Quick checklist before opening a PR

- `npm run check` is green locally
- CI matrix (linux-x64, macos-arm64, windows-x64 × Node 20.10) is green
- No new HTTP / DOI chokepoint violations

## Tier contract — do not skip

Pensmith ships as a Claude Code plugin (Tier 1: MCP server `dist/mcp/server.js`) AND
as a portable Node CLI (Tier 2: `dist/bin/pensmith.js`). The two tiers MUST expose
the same observable behavior for the operations declared in `tests/tier-contract.test.ts`.
This is the load-bearing property of the project.

### What the tier contract guarantees

For the operations covered in Phase 2:
- `paper://capabilities` (MCP resource, Tier 1) and `pensmith doctor --json` (CLI, Tier 2)
  report the same boolean facts about the host environment (same env vars present,
  same sync-folder warnings).
- `paper://capabilities` content is presence-flag booleans only — NEVER a resolved
  key value. D-12 lint enforces this at build time; `tests/tier-contract.test.ts`
  Case B enforces it at runtime.
- `paper_advance_section` is idempotent: applying the same `{paperRoot, n, toState}`
  twice produces byte-identical tool output and the resulting `paper://state` is
  unchanged on the second call. Asserted by `tests/tier-contract.test.ts` Case C.
  (Per TIER-02 / D-13 the snake_case tool name is `paper_advance_section`; the
  Phase-2 tool surface ships 6 such granular tools — there is no generic
  `state.update`.)

### The four merge-gate layers

All four MUST be green on every PR. If any one is red, do not merge — fix the
underlying issue.

1. **CI step (layer 1):** `.github/workflows/ci.yml` runs `npm run test:tier-contract`
   on linux-x64, macos-arm64, windows-x64 (per D-22 — 3-OS matrix). Failure blocks
   merge.

2. **Branch protection (layer 2):** Configured in GitHub repo settings →
   Settings → Branches → main → "Require status checks to pass before merging".
   The required checks include the matrix's tier-contract step on all 3 OSes.
   This is a one-time setup; if you're forking pensmith, ask the maintainer
   to add the same protection on your fork.

3. **Preflight (layer 3):** `node scripts/validate-plugin-manifest.cjs` asserts
   presence of `hooks/`, `workflows/` (exactly 16 .md files with `<capability_check>`
   blocks — one per UX-02 canonical verb per CONTEXT D-05, matched by the 02-06
   hooks-workflows plan), `dist/mcp/server.js`, and the `.claude-plugin/*.json`
   shapes. Runs in CI after `npm test`.

4. **Prose (layer 4 — this section):** The "Tier contract — do not skip" section
   in `CONTRIBUTING.md`. The Phase 2 D-24 lock keeps this section intact.
   `tests/repo-files.test.ts` asserts its presence.

### Wave 1 lint chokepoints (the file you're not allowed to write)

Three AST-walk ESLint rules scoped to `mcp/**/*.ts` catch the most common
"leaked-secret" / "broke-the-tier-contract" mistakes at build time. **A failing
chokepoint is the SIGNAL you tried to do something the architecture forbids.**
The fix is never to disable the rule. The fix is to write the code differently.

- **D-09 thin-shim** (`tests/lint-thin-shim.test.ts`): every MCP tool handler is
  ≤30 statements and cannot import `node:fs` / `node:http` / `node:https` /
  `node:net` / `node:tls` / `node:child_process`. All real work goes through
  `bin/lib/*` chokepoints. If you find yourself wanting fs in `mcp/`, you want
  a new `bin/lib/<thing>.ts` helper that the handler calls.

- **D-10 mcp-no-network** (`tests/lint-mcp-no-network.test.ts`): no
  `net.createServer`, `http.createServer`, `https.createServer`,
  `tls.createServer`, or raw `new Server({...})`. MCP runs over stdio only.
  Adding a network listener inside mcp/** is a category error — your code
  will never be reached because the only transport pensmith wires is
  `StdioServerTransport`.

- **D-12 capabilities-no-leak** (`tests/lint-capabilities-noleak.test.ts`): no
  computed `process.env[<expr>]` reads and no inline calls to
  `getProviderApiKey()` / `getOpenAlexApiKey()` / `loadRuntimeConfig()` inside
  `mcp/**`. The `paper://capabilities` resource emits only boolean presence
  flags. If you need to know whether a key is set in an MCP handler, expose
  the boolean through `paper://state` (which is loaded from
  non-mcp code that does have access to runtime.ts).

### Discipline rule: fix the tiers, don't write a normalizer

When a tier-contract test fails (or a lint chokepoint fires), **the default fix
is to make the two tiers agree by changing the shipped code in one of them**.

The fixes that are NOT acceptable:
- Adding a runtime "capabilitiesNormalizer" / "responseShaper" that strips
  offending fields before emit. This buries the bug in transformation
  layers and makes future divergence invisible.
- Loosening the assertion (e.g. changing `assert.deepEqual` to `assert.ok(... !== undefined)`).
- Skipping the test (`test.skip(...)`) or marking it `test.todo(...)`.
- Adding an `// eslint-disable-next-line` directive to silence a chokepoint.

The fixes that ARE acceptable, in order of preference:
1. Fix the SHIPPED code so the two tiers actually do the same thing.
2. Update the tier-contract test to reflect a deliberate, documented architectural
   change — this requires updating the corresponding D-decision in `.planning/phases/<N>/<N>-CONTEXT.md`
   and getting the change reviewed.
3. Mark the test as known-failing with a tracking issue and a deadline.
   Acceptable only with maintainer sign-off; not the right path 95% of the time.

## Cassette Refresh Workflow

PR-time CI (`.github/workflows/ci.yml`) is OFFLINE — it runs against recorded
HTTP cassettes under `tests/fixtures/cassettes/` for the Crossref, OpenAlex,
and Unpaywall adapters. This keeps PR builds fast (no live network) and
hermetic (no flaky external dependencies blocking contributor PRs).

A separate workflow (`.github/workflows/cassette-refresh.yml`) re-records
those cassettes against the live registrars on a weekly schedule and opens a
PR with the refreshed fixtures.

### When cassettes need a manual refresh

- A registrar shipped a schema change (new field, renamed field, format
  change) and the offline tests are failing locally with a parse error.
- A new fixture row was added to `known-good-fixture/CITATIONS.bib` and the
  adapter needs a recording for that DOI.
- The weekly cron PR has been sitting for > 14 days without merge.

### How to trigger a refresh

**Option A — manual workflow dispatch (preferred):**

1. Go to **Actions → Cassette Refresh → Run workflow** in the GitHub UI.
2. Pick the `main` branch.
3. The workflow re-records all cassettes and opens a PR. Review the diff,
   confirm no PII / API tokens leaked into recorded headers, then merge.

**Option B — local re-record (only if you have the registrar contact-email
secret and need to inspect the diff before pushing):**

```bash
export PENSMITH_NETWORK_TESTS=1
export PENSMITH_REFRESH_CASSETTES=1
export PENSMITH_CONTACT_EMAIL=you@example.com  # required by Crossref/OpenAlex polite-pool
npm run build
npm run test:cassettes -- --refresh
git diff tests/fixtures/cassettes/
```

### Permissions reminder

The cassette-refresh workflow declares **job-level** permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
```

This is REQUIRED — the repo-default `contents: read` would silently fail to
push the refresh branch and the `peter-evans/create-pull-request@v6` action
would 403 on PR open. If you fork this repo, replicate the same job-level
permissions block; do NOT promote them to repo-wide `contents: write`.

### Cassette byte-size cap (D-25)

Every recorded cassette file MUST be ≤ 51200 bytes. The `cassette-size`
test enforces this on every PR; the refresh PR will fail CI if a registrar
returned an unexpectedly large response. If that happens, narrow the
recording (drop irrelevant fields) rather than raising the cap.

### Sensitive-header scan (T-3-02 / T-01-07)

The `cassette-no-leak` test scans every committed cassette for
`Authorization`, `Cookie`, `Set-Cookie`, and `X-Api-Key` headers. The
refresh workflow must NEVER commit a cassette that carries one. If the
refresh PR diff shows any such header, abort the merge and fix the
recorder before re-running.
