# Doctor Output Strings (locked — D-18)

This file is the SINGLE source of truth for `/pensmith doctor` (DOCT-01..04, DOCT-07
+ DOCT-02 ecosystem probes) user-facing prose. `bin/cli/doctor.ts` reads these
strings at module load. The Tier-1 MCP `paper://capabilities` resource consumes
the same Record shape (severities only — no copy strings persisted across the wire).
Drift between the locked copy and the rendered output is a regression — pinned
by sha256 hash in `tests/repo-files.test.ts`.

The Phase-3 wiring-smoke probe (intake-outline-verify-wiring, DOCT-05) lands
in Plan 03-09 Task 9.1 — its locked copy is the `intake-outline-verify-wiring
(DOCT-05)` section below. The tier-equivalence assertion is the tier-contract
Case A in `tests/tier-contract.test.ts` (02-07), not a probe — not in this file.

## TTY render — header

> pensmith doctor — environment + capability probe

## TTY render — footer (PASS)

> All probes PASS or WARN. No FAIL. Exit 0.

## TTY render — footer (FAIL)

> One or more probes FAILed. Exit 1. See detail above.

## Probe summary copy (locked per-probe)

### node-version (DOCT-01)
> Node.js runtime version probe — pensmith requires >=20.10.0.

### mcp-sdk-presence (DOCT-01 wiring)
> MCP server build artifact presence — dist/mcp/server.js must exist and be non-empty.

### contact-email-presence (DOCT-03)
> PENSMITH_CONTACT_EMAIL environment variable presence — see references/http-warnings.md for the full WARN copy. (Canonical probe id per 02-05 line 45; 02-07 Case A reads `probes['contact-email-presence']`.)

### sync-folder-detection (DOCT-04)
> .paper/ inside cloud sync folder (OneDrive / iCloud / Dropbox / Google Drive) detection — WARN if matched.

### runtime-config-presence (DOCT-07)
> Runtime config provider API-key resolvability — WARN if no provider has its env-var set. Per-provider `{name, apiKeyEnv, present:boolean}` shape only — the resolved value never leaves loadRuntimeConfig (symmetric to T-01-07 / D-12).

### zotero-mcp-presence (DOCT-02 ecosystem)
> Zotero MCP server reachable via the user's ~/.claude/.mcp.json — WARN if not configured. Optional dependency surfaced for Phase 3+ intake.

### pandoc-presence (DOCT-02 ecosystem)
> Pandoc binary on PATH — WARN if not found. Required by Phase 10 export.

### humanizer-skill-presence (DOCT-02 ecosystem)
> Humanizer skill at ~/.claude/skills/humanizer/ — WARN if missing. Optional Phase 8 dependency.

### build-artifact-resolves (Phase 2 substitute for deferred DOCT-05)

> Compiled dist/ build-artifact resolution probe — confirms dist/bin/pensmith.js and dist/mcp/server.js exist and are non-empty. Phase 2 substitute for the originally deferred DOCT-05; remains active in Phase 3 alongside the real DOCT-05 wiring smoke (D-15).

### http-crossref-ping (D-03(d) cassette wiring)

> D-03(d) Crossref-adapter cassette-wiring probe — exercises the recorded fixture cassette to confirm the offline HTTP path is reachable. PR-time CI runs OFFLINE; this probe is the canary for cassette parse / schema drift. PASS in CI; SKIP outside the repo where cassettes are not shipped.

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
