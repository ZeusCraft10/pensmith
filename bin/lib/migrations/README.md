# Migrations

Day-one migrations directory per ARCH-07. Empty in v0.1.0.

Each migration is `<from>-to-<to>.ts` exporting `migrate(state) -> newState`. Loader refuses forward-incompatible state files. See `.planning/research/PITFALLS.md` Pitfall 5 and `.planning/REQUIREMENTS.md` ARCH-07.
