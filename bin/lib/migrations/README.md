# Migrations

Forward migrations for the versioned JSON files, run by `loader.ts` when a file
on disk is older than the code:

- `state/v1_to_v2.ts` — STATE.json v1 → v2.
- `library/v1_to_v2.ts` — LIBRARY.json v1 (research candidates) → v2 (CSL-JSON items).

Each exports `migrate(value) -> value`, keyed by the version it migrates from.
The loader refuses a file newer than the code (`ForwardIncompatError`).
