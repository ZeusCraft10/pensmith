# Doctor Output Strings (locked — D-18)

This file is the SINGLE source of truth for `/pensmith doctor` (DOCT-01..04, DOCT-07
+ DOCT-02 ecosystem probes) user-facing prose. The probe modules under
`bin/lib/doctor/probes/` and the renderer `bin/lib/doctor/render.ts` implement this
copy. The Tier-1 MCP `paper://capabilities` resource consumes the same facts
(presence booleans only — no copy strings persisted across the wire).
Drift between the locked copy and the rendered output is a regression — pinned
by sha256 hash in `tests/repo-files.test.ts`.

The Phase-3 wiring-smoke probe (intake-outline-verify-wiring, DOCT-05) is the
`intake-outline-verify-wiring (DOCT-05)` section below. The tier-equivalence
assertion is the tier-contract Case A in `tests/tier-contract.test.ts` (02-07),
not a probe — not in this file.

## TTY render — header

> Pensmith doctor:

## TTY render — probe line

> `<glyph> [<SEVERITY>] <probe-id>: <summary>` — glyph ✓ PASS, ! WARN, ✗ FAIL, — SKIP — followed by indented `detail` and `fix:` lines when present.

## TTY render — footer

> Doctor: <n> PASS, <n> WARN, <n> FAIL, <n> SKIP

The command exits 0 when no probe FAILs and 1 otherwise.

## Probe summary copy (locked per-probe)

### node-version (DOCT-01)
> Node.js runtime version probe — pensmith requires Node >= 22.12.0 (the Node 22 and 24 LTS lines; CI-06). PASS at or above the floor; FAIL below it, with the fix "Install Node 22.12.0 or newer (the Node 22 or 24 LTS line)".

### mcp-sdk-presence (DOCT-01 wiring)
> MCP server artifact presence — the Tier-1 server the plugin manifest launches, the committed self-contained bundle plugin/dist/mcp/server.mjs, must exist and be non-empty (found from the installed package, never the working directory). The fix names `npm run bundle` in a source checkout and a reinstall otherwise.

### contact-email-presence (DOCT-03)
> Contact email for the polite pools (Crossref, OpenAlex, Unpaywall) — resolves the variable that holds it (the paper's `[network] contact_email_env`, honoured only for a `PENSMITH_…` name containing EMAIL or MAILTO and no secret word; else the global runtime.json `contactEmailEnv`; default PENSMITH_CONTACT_EMAIL) and names that variable, never the address. PASS when it holds a plain email address; WARN when it is unset or not an address — the polite pools are then unavailable and Unpaywall is skipped (see references/http-warnings.md for the full WARN copy). (Canonical probe id per 02-05 line 45; 02-07 Case A reads `probes['contact-email-presence']`.)

### network-mode (RUN-02)
> Effective network mode and why — `network: live` by default (sources, verification, detector and plagiarism requests go to the real services), or `network: OFFLINE (<reason>)` where the reason is `PENSMITH_OFFLINE=1`, `--dry-run` or `test runner`. Offline means exact recorded fixtures or a fail-closed "unavailable (offline)"; `--dry-run` means synthetic, labelled sources and zero sockets. Informational: it reports the mode and never FAILs.

### sync-folder-detection (DOCT-04)
> .paper/ inside cloud sync folder (OneDrive / iCloud / Dropbox / Google Drive) detection — WARN if matched.

### runtime-config-presence (DOCT-07)
> Model runtime probe — names the resolved provider (`anthropic`, `openai`, `ollama`, `vllm` or `openai-compatible`), the model, and the key variable in use, and reports the optional keys OPENALEX_API_KEY, PENSMITH_S2_API_KEY, GPTZERO_API_KEY, PENSMITH_CONTACT_EMAIL and ZOTERO_API_KEY as present or absent — presence booleans only; a resolved value never leaves the runtime loader (T-01-07 / D-12). WARN with "Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local endpoint)" when no provider can run. For a local or OpenAI-compatible endpoint it probes `GET <endpoint>/models`: PASS when it answers, WARN when it is down, and WARN naming the key variable when the endpoint rejects the key (HTTP 401/403). A hosted endpoint is not probed while its key is absent. An unknown provider is a FAIL that lists the valid providers. Opt-in refusal fallbacks are disclosed when enabled. PENSMITH_NO_LLM is described as: replaces every LLM call with a deterministic stub (testing and dry-run).

### zotero-mcp-presence (DOCT-02 ecosystem)
> Can pensmith read your Zotero library (SRC-16)? With ZOTERO_API_KEY: one authenticated request, `GET https://api.zotero.org/keys/current` — `Zotero: authenticated (…)` (PASS) only when it answers 200, `Zotero: key rejected` (WARN, fix: https://www.zotero.org/settings/keys) on 403, `Zotero: not checked (…)` (WARN) on any other answer, `Zotero: not checked (offline)` (SKIP) offline with no recorded answer — never "authenticated" from the key's presence alone. Without a key: the Zotero 7 local API (`PENSMITH_ZOTERO_LOCAL=1`) or a public group (`ZOTERO_GROUP_ID`), one keyless request. Otherwise WARN: `Zotero: MCP server detected — not authenticated for the CLI` when a Zotero MCP server is configured for Claude Code (`.claude.json` in `$CLAUDE_CONFIG_DIR` or the home folder, the project's `.mcp.json`, a legacy `mcp_servers.json`), else `Zotero: not detected`, with setup steps. The detail names the MCP detection and the files checked. Optional: research uses the scholarly sources either way.

### pandoc-presence (DOCT-02 ecosystem)
> Pandoc binary on PATH — WARN if not found: `pensmith done` then cannot export .docx or .pdf and falls back to Markdown.

### humanizer-skill-presence (DOCT-02 ecosystem)
> Humanizer skill at ~/.claude/skills/humanizer/ — WARN if missing: `pensmith done` then skips the humanize step.

### build-artifact-resolves (Phase 2 substitute for deferred DOCT-05)

> Build-artifact resolution probe — confirms the Tier-2 CLI build dist/bin/pensmith.js and the Tier-1 server bundle plugin/dist/mcp/server.mjs exist and are non-empty (both found from the installed package, never the working directory) and that `pensmith --version` exits 0. Phase 2 substitute for the originally deferred DOCT-05; remains active in Phase 3 alongside the real DOCT-05 wiring smoke (D-15).

### http-crossref-ping (D-03(d) cassette wiring)

> D-03(d) Crossref-adapter cassette-wiring probe — exercises the recorded fixture cassette to confirm the offline HTTP path is reachable. The test suite runs sources OFFLINE (exact recorded fixtures); this probe is the canary for cassette parse / schema drift. It runs only while offline replay is active (PENSMITH_OFFLINE=1 or the test runner): PASS in a source checkout, SKIP outside the repo, where cassettes are not shipped. In live mode and under --dry-run the fixtures are not used, so it is SKIP and never reads tests/ (RUN-05).

### intake-outline-verify-wiring (DOCT-05)

> Intake/outline/verify wiring smoke probe — confirms the 6 Phase-3 per-section verbs (new, research, outline, plan, write, verify) are wired end-to-end across the dispatcher (bin/pensmith.ts subCommands), workflow bodies (`plugin/workflows/{verb}.md` "## Body" section), and the drafter contract (bin/lib/drafter-input.ts assertDrafterInput export). FAIL lists every missing piece in `detail` so a single `pensmith doctor` invocation tells the operator exactly which wiring regressed. Probe is READ-ONLY per D-19 — no .paper/ side effects.

## JSON shape

`pensmith doctor --json` emits:

```json
{
  "schemaVersion": 1,
  "probes": {
    "node-version":             { "id": "...", "severity": "PASS|WARN|FAIL|SKIP", "summary": "...", "detail": "...", "fix": "..." },
    "mcp-sdk-presence":         { "..." : "..." },
    "contact-email-presence":   { "..." : "..." },
    "network-mode":             { "..." : "..." },
    "sync-folder-detection":    { "..." : "..." },
    "runtime-config-presence":  { "..." : "..." },
    "zotero-mcp-presence":      { "..." : "..." },
    "pandoc-presence":          { "..." : "..." },
    "humanizer-skill-presence": { "..." : "..." },
    "build-artifact-resolves":  { "..." : "..." },
    "http-crossref-ping":       { "..." : "..." },
    "intake-outline-verify-wiring": { "..." : "..." }
  },
  "summary": { "pass": 0, "warn": 0, "fail": 0, "skip": 0 }
}
```

Keys under `probes` = `probe.id` (per D-20 — Record keyed by id, NOT an Array).
The tier-contract test (02-07 Case A) compares Tier 1 `paper://capabilities`
and Tier 2 `doctor --json` for capability-fact equivalence — the **boolean
facts** must agree, even though the SHAPES differ by design.

(Do NOT edit the wording above without also updating the SHA-256 hash pin in
tests/repo-files.test.ts. The hash pin is the canonical drift sentinel.)
