# pensmith doctor

> Run ecosystem self-check — 12 probes across runtime, network mode, model runtime, MCP wiring, and ecosystem presence. Exits 1 on FAIL.

<capability_check>
required:
  - (none required)

degrade_if_missing:
  - (no degradation needed — doctor is read-only and requires no MCP tools)
</capability_check>

## Overview

`pensmith doctor` calls `runDoctor()` (`bin/lib/doctor/probes.ts`) which runs 12 probes
in parallel via `Promise.allSettled`. Results are rendered via `renderTty()` (human-first
prose, grouped by severity) or `renderJson()` (the `--json` flag, schema v1 per D-18).
Exits 0 if all probes are PASS/WARN/SKIP; exits 1 if any probe is FAIL (D-15).

Probe strings are sourced from `references/doctor-output.md` (locked — D-18). Any
wording change to that file must re-pin the SHA-256 hash in `tests/repo-files.test.ts`.
Probe is READ-ONLY (D-19): no `.paper/` writes, no locks, no atomicWriteFile.

## Outputs

- stdout: TTY prose table (default) or JSON `{ schemaVersion:1, probes:{...}, summary:{...} }` (--json)
- exit code 0 (all probes PASS/WARN/SKIP) or 1 (any probe FAIL)

## Body

1. **Run all 12 probes in parallel** via `runDoctor()` (`bin/lib/doctor/probes.ts`):
   - **DOCT-01 — runtime:** `node-version` (FAIL below the Node floor 22.12.0, the `engines.node` value), `mcp-sdk-presence` (dist/mcp/server.js non-empty)
   - **DOCT-02 — ecosystem:** `zotero-mcp-presence` (WARN if not in a Claude MCP config — research then does not search your Zotero library; the live scholarly sources are unaffected), `pandoc-presence` (WARN if not on PATH), `humanizer-skill-presence` (WARN if missing at ~/.claude/skills/humanizer/)
   - **DOCT-03 — config:** `contact-email-presence` (WARN if PENSMITH_CONTACT_EMAIL unset — the Crossref / OpenAlex polite pools)
   - **RUN-02 — network mode:** `network-mode` — `network: live` (PASS) by default; `network: OFFLINE (<reason>)` (WARN) under `PENSMITH_OFFLINE=1`, `--dry-run` or the test runner; FAIL when `PENSMITH_OFFLINE=1` is set in an installed package, which ships no recorded fixtures. It also says when model calls are stubbed (`PENSMITH_NO_LLM=1`).
   - **DOCT-04 — env:** `sync-folder-detection` (WARN if .paper/ inside OneDrive/iCloud/Dropbox/Google Drive)
   - **DOCT-05 — wiring:** `intake-outline-verify-wiring` (FAIL if any of the 6 Phase-3 verbs are unwired)
   - **DOCT-07 — model runtime:** `runtime-config-presence` — names the resolved provider, model and the key variable in use (presence only, never a value); WARN with "Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local endpoint)" when no provider can run; for a local or OpenAI-compatible endpoint it probes `GET <endpoint>/models` (PASS when it answers, WARN when it is down or rejects the key); an unknown provider is FAIL.
   - **D-03(d) — build + fixtures:** `build-artifact-resolves` (dist/bin/pensmith.js + dist/mcp/server.js non-empty), `http-crossref-ping` (the offline-replay fixture store: PASS with the fixture count in a source checkout, FAIL on a corrupt fixture, SKIP in an installed package — live mode is unaffected; it never dials)

2. **Render output** based on the `--json` flag:
   - Default (TTY): `renderTty(results)` — human-first prose, severity emoji, probe summary + fix strings sourced from `references/doctor-output.md`.
   - `--json`: `renderJson(results)` — schema v1 JSON (D-18 shape: `{ schemaVersion:1, probes:{}, summary:{} }`). Tier-contract test (02-07 Case A) compares this output to the Tier-1 `paper://capabilities` resource.

3. **Exit**: 0 if no FAIL; `process.exit(1)` if any probe severity is FAIL (D-15). WARN and SKIP do not block exit 0.

4. Shell fallback (TIER-06): `pensmith doctor [--json]`.
