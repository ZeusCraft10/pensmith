# Migrations

Forward migrations for the versioned JSON files, run by `loader.ts` when a file
on disk is older than the code:

- `state/v1_to_v2.ts` — STATE.json v1 → v2.
- `library/v1_to_v2.ts` — LIBRARY.json v1 (research candidates) → v2 (CSL-JSON items).

`layout.ts` is not a schema migration: it moves the STATE.json and config.toml
that pensmith up to v0.2 kept in the project root into `.paper/`, the first
time pensmith runs in such a project (the dispatcher, and every state read).

Each exports `migrate(value) -> value`, keyed by the version it migrates from.
The loader refuses a file newer than the code (`ForwardIncompatError`).
