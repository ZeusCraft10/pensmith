// bin/lib/migrations/state/v1_to_v2.ts — sample no-op forward migration.
//
// Convention (D-37 / ARCH-07): each `migrations/<schema>/v<N>_to_v<N+1>.ts`
// exports a default function `(input: unknown) => unknown` that:
//   1. accepts the disk-shape at v<N>
//   2. returns the disk-shape at v<N+1>
//   3. MUST set `$schemaVersion: N+1` on the returned object
//
// This file is the registry-mechanism proof for the foundation slice — there
// is no real state v2 yet (Phase 2 will introduce one). The migration is
// a no-op pass-through that bumps the version field. The loader's "missing
// migration in chain throws" branch is exercised by writing a v1 file and
// asking for currentVersion:3 with no migration registered.
//
// Defensive shape check: throws on non-object input rather than spreading a
// primitive (which would silently produce `{ '0': 'a', '1': 'b', $schemaVersion: 2 }`
// for a string input). Hostile JSON should hit the loader's JSON.parse and
// schema.safeParse gates, but defense-in-depth is cheap.

export default function v1_to_v2(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) {
    throw new Error('v1_to_v2: input is not an object');
  }
  return { ...input, $schemaVersion: 2 };
}
