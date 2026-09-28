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
   - **DOCT-02 — ecosystem:** `zotero-mcp-presence` — can pensmith read your Zotero library (SRC-16)? With `ZOTERO_API_KEY` it makes one authenticated request, `GET https://api.zotero.org/keys/current`: `Zotero: authenticated (…)` (PASS) only when that answers 200, `Zotero: key rejected` (WARN, with the key page https://www.zotero.org/settings/keys as the fix) on 403, `Zotero: not checked (…)` (WARN) on any other answer, and `Zotero: not checked (offline)` (SKIP) when sources are offline with no recorded answer — never "authenticated" from the key's presence. Without a key it checks the Zotero 7 local API (`PENSMITH_ZOTERO_LOCAL=1`, `http://127.0.0.1:23119`) or a public group (`ZOTERO_GROUP_ID`) with one keyless request. Otherwise it is a WARN: `Zotero: MCP server detected — not authenticated for the CLI` when a Zotero MCP server is configured for Claude Code (`.claude.json` in `$CLAUDE_CONFIG_DIR` or the home folder — user scope and this project's entry — the project's `.mcp.json`, or a legacy `mcp_servers.json`), else `Zotero: not detected`, with setup steps and a Zotero MCP server to install (https://github.com/54yyyu/zotero-mcp). The detail always has a `MCP server: detected …` / `MCP server: not detected` line and the files checked. Zotero is optional: research uses the scholarly sources either way. `pandoc-presence` (WARN if not on PATH), `humanizer-skill-presence` (WARN if missing at ~/.claude/skills/humanizer/)
   - **DOCT-03 — config:** `contact-email-presence` — PASS when a contact email will be sent to Crossref, OpenAlex and Unpaywall (the variable `[network] contact_email_env` names, else the global runtime.json's `contactEmailEnv`, default PENSMITH_CONTACT_EMAIL, holding something that looks like an email address); WARN when it is unset or not an address — the polite pools are then unavailable and Unpaywall is skipped
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
