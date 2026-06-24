# pensmith doctor

> Run ecosystem self-check — 11 probes across runtime, MCP wiring, and ecosystem presence. Exits 1 on FAIL.

<capability_check>
required:
  - (none required)

degrade_if_missing:
  - (no degradation needed — doctor is read-only and requires no MCP tools)
</capability_check>

## Overview

`pensmith doctor` calls `runDoctor()` (`bin/lib/doctor/probes.ts`) which runs 11 probes
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

1. **Run all 11 probes in parallel** via `runDoctor()` (`bin/lib/doctor/probes.ts`):
   - **DOCT-01 — runtime:** `node-version` (requires >=20.10.0), `mcp-sdk-presence` (dist/mcp/server.js non-empty)
   - **DOCT-02 — ecosystem:** `zotero-mcp-presence` (WARN if not in ~/.claude/.mcp.json), `pandoc-presence` (WARN if not on PATH), `humanizer-skill-presence` (WARN if missing at ~/.claude/skills/humanizer/)
   - **DOCT-03 — config:** `contact-email-presence` (WARN if PENSMITH_CONTACT_EMAIL unset)
   - **DOCT-04 — env:** `sync-folder-detection` (WARN if .paper/ inside OneDrive/iCloud/Dropbox/Google Drive)
   - **DOCT-05 — wiring:** `intake-outline-verify-wiring` (FAIL if any of the 6 Phase-3 verbs are unwired)
   - **DOCT-07 — runtime config:** `runtime-config-presence` (WARN if no provider API key set)
   - **D-03(d) — cassette:** `build-artifact-resolves` (dist/bin/pensmith.js + dist/mcp/server.js non-empty), `http-crossref-ping` (cassette-wiring smoke)

2. **Render output** based on the `--json` flag:
   - Default (TTY): `renderTty(results)` — human-first prose, severity emoji, probe summary + fix strings sourced from `references/doctor-output.md`.
   - `--json`: `renderJson(results)` — schema v1 JSON (D-18 shape: `{ schemaVersion:1, probes:{}, summary:{} }`). Tier-contract test (02-07 Case A) compares this output to the Tier-1 `paper://capabilities` resource.

3. **Exit**: 0 if no FAIL; `process.exit(1)` if any probe severity is FAIL (D-15). WARN and SKIP do not block exit 0.

4. Shell fallback (TIER-06): `pensmith doctor [--json]`.
