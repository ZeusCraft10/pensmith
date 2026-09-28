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
> MCP server build artifact presence — dist/mcp/server.js must exist and be non-empty.

### contact-email-presence (DOCT-03)
> PENSMITH_CONTACT_EMAIL environment variable presence — see references/http-warnings.md for the full WARN copy. (Canonical probe id per 02-05 line 45; 02-07 Case A reads `probes['contact-email-presence']`.)

### network-mode (RUN-02)
> Effective network mode and why — `network: live` by default (sources, verification, detector and plagiarism requests go to the real services), or `network: OFFLINE (<reason>)` where the reason is `PENSMITH_OFFLINE=1`, `--dry-run` or `test runner`. Offline means exact recorded fixtures or a fail-closed "unavailable (offline)"; `--dry-run` means synthetic, labelled sources and zero sockets. Informational: it reports the mode and never FAILs.

### sync-folder-detection (DOCT-04)
> .paper/ inside cloud sync folder (OneDrive / iCloud / Dropbox / Google Drive) detection — WARN if matched.

### runtime-config-presence (DOCT-07)
> Model runtime probe — names the resolved provider (`anthropic`, `openai`, `ollama`, `vllm` or `openai-compatible`), the model, and the key variable in use, and reports the optional keys OPENALEX_API_KEY, PENSMITH_S2_API_KEY, GPTZERO_API_KEY, PENSMITH_CONTACT_EMAIL and ZOTERO_API_KEY as present or absent — presence booleans only; a resolved value never leaves the runtime loader (T-01-07 / D-12). WARN with "Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local endpoint)" when no provider can run. For a local or OpenAI-compatible endpoint it probes `GET <endpoint>/models`: PASS when it answers, WARN when it is down, and WARN naming the key variable when the endpoint rejects the key (HTTP 401/403). A hosted endpoint is not probed while its key is absent. An unknown provider is a FAIL that lists the valid providers. Opt-in refusal fallbacks are disclosed when enabled. PENSMITH_NO_LLM is described as: replaces every LLM call with a deterministic stub (testing and dry-run).

### zotero-mcp-presence (DOCT-02 ecosystem)
> Zotero MCP server reachable via the user's ~/.claude/.mcp.json — WARN if not configured. Optional dependency surfaced for Phase 3+ intake.

### pandoc-presence (DOCT-02 ecosystem)
> Pandoc binary on PATH — WARN if not found: `pensmith done` then cannot export .docx or .pdf and falls back to Markdown.

### humanizer-skill-presence (DOCT-02 ecosystem)
> Humanizer skill at ~/.claude/skills/humanizer/ — WARN if missing: `pensmith done` then skips the humanize step.

### build-artifact-resolves (Phase 2 substitute for deferred DOCT-05)

> Compiled dist/ build-artifact resolution probe — confirms dist/bin/pensmith.js and dist/mcp/server.js exist and are non-empty. Phase 2 substitute for the originally deferred DOCT-05; remains active in Phase 3 alongside the real DOCT-05 wiring smoke (D-15).

### http-crossref-ping (D-03(d) cassette wiring)

> D-03(d) Crossref-adapter cassette-wiring probe — exercises the recorded fixture cassette to confirm the offline HTTP path is reachable. The test suite runs sources OFFLINE (exact recorded fixtures); this probe is the canary for cassette parse / schema drift. It runs only while offline replay is active (PENSMITH_OFFLINE=1 or the test runner): PASS in a source checkout, SKIP outside the repo, where cassettes are not shipped. In live mode and under --dry-run the fixtures are not used, so it is SKIP and never reads tests/ (RUN-05).

### intake-outline-verify-wiring (DOCT-05)

> Intake/outline/verify wiring smoke probe — confirms the 6 Phase-3 per-section verbs (new, research, outline, plan, write, verify) are wired end-to-end across the dispatcher (bin/pensmith.ts subCommands), workflow bodies (`workflows/{verb}.md` "## Body" section), and the drafter contract (bin/lib/drafter-input.ts assertDrafterInput export). FAIL lists every missing piece in `detail` so a single `pensmith doctor` invocation tells the operator exactly which wiring regressed. Probe is READ-ONLY per D-19 — no .paper/ side effects.

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
