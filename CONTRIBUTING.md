# Contributing to Pensmith

Pensmith is in alpha (0.3.0-alpha.1) and in the middle of a planned rebuild;
the current phase plan lives in `docs/plans/`. You need Node.js 22.12 or
newer.

```bash
npm ci
npm run check    # prebuild · lint · typecheck · build · bundle · tests
```

## What CI runs

`.github/workflows/ci.yml` runs on Node 22 and 24, on Linux, macOS and
Windows. Every step must pass:

1. `npm run lint` and `npm run typecheck`.
2. `npm run build` (tsc with `tsconfig.build.json`, which leaves tests out).
3. `npm run bundle`: builds the plugin bundle the tests and the smoke run
   against. It is never committed (see [The plugin payload](#the-plugin-payload)).
4. `npm run test:coverage`: the test suite, with coverage thresholds from
   `.c8rc.json`, and stdin closed so nothing waits on a TTY.
5. `node scripts/plugin-smoke.mjs`, with the Claude Code CLI installed:
   `claude plugin validate plugin --strict`, `claude plugin validate . --strict`,
   a marketplace add + install into a throwaway `CLAUDE_CONFIG_DIR` that must
   list 1 skill, 1 hook and no MCP servers, a second install of the same tree
   through a git source with `core.autocrlf=true` that must keep every file
   byte for byte, and `pensmith --version` run installed, through a symlink
   and through `npm link`.
6. The working tree is still clean afterwards.

Run `npm run smoke:plugin` locally if you have `claude` on your `PATH`.

## The plugin payload

`plugin/` is the only thing a plugin install copies, and Claude Code runs no
build or `npm install` for it. So:

- `plugin/dist/pensmith.mjs` and `plugin/dist/hook.mjs` are minified esbuild
  bundles with every dependency inlined, and `plugin/templates/`,
  `plugin/references/` and `plugin/LICENSE` are copies. `npm run bundle`
  generates all of them. They are gitignored and never committed: a release
  publishes the built `plugin/` on the `release` branch, which is what users
  install. Tests that need the bundle fail with "run `npm run bundle`" when it
  is missing; `npm run check` builds it before the tests.
- The rest is written by hand: `.claude-plugin/plugin.json`, the one skill
  (`skills/pensmith/SKILL.md`), `hooks/hooks.json`, the `bin/` shims, and
  `README.md`. On the release branch `plugin/` is the whole repository, so its
  README is the one people (and the plugin directory) see there.
- Keep `plugin/` free of `package.json` and lockfiles.
- Code that locates `templates/` or `references/` must treat a directory with
  `.claude-plugin/plugin.json` as the package root, because the payload has no
  `package.json` (tests/plugin-package.test.ts checks this).

The SessionStart hook (`hooks/session-start.ts`) runs in every project where
the plugin is enabled. It must stay silent and write nothing unless the
session's directory has a `.paper/` folder.

## Releasing

Users install the plugin from the `release` branch: the entry in
`.claude-plugin/marketplace.json` points there. That branch holds only the
built `plugin/` payload, one commit per release, and its history is kept. To
cut a release:

1. Set the new version in `package.json` (`npm version --no-git-tag-version
   <version>` also updates the lockfile) and in
   `plugin/.claude-plugin/plugin.json`. The two must match. Run
   `npm run check`: it names any other file that still carries the old
   version, such as the README's status line. Commit the bump on `main`.
2. Tag that commit with `v` and the version, and push the tag:

   ```bash
   git tag v0.3.0-alpha.2
   git push origin v0.3.0-alpha.2
   ```

3. `.github/workflows/release.yml` runs on the tag. It fails unless the tag
   matches both versions, runs `npm ci`, `npm run check` and the plugin smoke,
   then `node scripts/release.mjs publish <tag>`: that commits the built
   `plugin/` as `release <tag>` on top of the previous release commit and
   pushes the `release` branch as a fast-forward, never forced. It refuses a
   version that is not newer than the last release, so a late or re-created
   tag cannot move installs back. Last, it creates a GitHub Release for the
   tag.

To rehearse the publish step without touching GitHub, run it in a scratch
clone whose `origin` is a scratch bare repository: `npm ci && npm run bundle`,
tag the checked-out commit, run `node scripts/release.mjs publish <tag>`, and
check out the bare repository's `release` branch.

## Architectural chokepoints (Phase 0+)

Lint-enforced chokepoints. Violating them fails CI; add rules rather than
disabling them.

1. **HTTP**: `fetch`, `http`, `https`, `node:http`, `node:https` and `undici`
   may only be imported from `bin/lib/http.ts`. Every request goes through it.
2. **DOI regex**: the literal regex `/^10\./` may only appear in
   `bin/lib/doi.ts`.
3. **State writes** go through `bin/lib/atomic-write.ts`.
4. **User data paths** (home directory, `LOCALAPPDATA`, `XDG_DATA_HOME`) go
   through `bin/lib/paths.ts`.

See `eslint.config.js` for the rules and `tests/lint-chokepoint.test.ts` for
the regression gate.

## Docs that are checked

- The README command table is generated from each command's own CLI
  definition. After changing a command's description or arguments, run
  `npm run docs:verbs`; `tests/docs.test.ts` fails when the table is stale.
- `PRIVACY.md` must name every host the shipped code sends requests to.
  Adding a source adapter or endpoint means adding a row to its table.

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

## Tier contract — do not skip

Pensmith runs in two places: as a Claude Code plugin (Tier 1) and as a
command-line tool (Tier 2). Both run the same CLI, so there is one
implementation of every step.

### What the tier contract guarantees

- The plugin's skill only sends Claude to commands the CLI registers
  (`tests/nl-triggers.test.ts`), and the plugin's `pensmith` is the bundled
  CLI built from the same sources (`npm run bundle`, before the tests).
- Each command produces its declared artifacts when run through the built CLI
  in a temporary paper folder (`tests/tier-contract.test.ts`).
- Comparing what Tier 1 does step by step against Tier 2 (action-trace
  equivalence) arrives with the planned action stream.

### The merge gates

1. **CI step:** every step listed under [What CI runs](#what-ci-runs), on all
   six OS and Node combinations.
2. **Branch protection:** in the GitHub repository settings, require those
   checks to pass before merging into `main`. If you fork pensmith, set up the
   same protection.
3. **Preflight:** `claude plugin validate` and the isolated install in
   `scripts/plugin-smoke.mjs`, which check what Claude Code itself accepts.
4. **Prose:** this section. `tests/repo-files.test.ts` keeps it in place.

### Discipline rule: fix the code, don't loosen the test

When a contract test or a lint chokepoint fails, the default fix is to change
the shipped code so it does the right thing. Not acceptable:

- a "normalizer" that reshapes output so a check passes;
- loosening an assertion, or skipping or todo-marking a test;
- an `// eslint-disable-next-line` to silence a chokepoint.

If a test pins behaviour that is genuinely wrong, fix the test in the same
change and say why in the commit message.

## Recorded HTTP cassettes

Tests run against recorded responses under `tests/fixtures/cassettes/`, so
CI makes no live requests. Two tests guard the recordings:

- `cassette-size`: every cassette file is at most 51200 bytes. Narrow a
  recording (drop irrelevant fields) rather than raising the cap.
- `cassette-no-leak`: no cassette may carry `Authorization`, `Cookie`,
  `Set-Cookie` or `X-Api-Key` headers.

`.github/workflows/cassette-refresh.yml` is meant to re-record them weekly,
but it does not re-record anything yet (it re-runs the tier-contract suite).
Until a real recorder lands, record new cassettes by hand and review the diff
for personal data before committing.
