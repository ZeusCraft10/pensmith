// bin/lib/migrations/state/v2_to_v3.ts — v2 → v3 state migration (GRND-09,
// D-18-16, S-20).
//
// v3 lets a `sections[]` entry carry an optional `suffix` (one lowercase
// letter): a section a re-outline inserted after §N, while a kept section
// followed it, is §Na with the folder `sections/NNa-<slug>/`. Every v2 entry
// `{n, slug}` is already a valid v3 entry, so the migration is the identity on
// the data and only bumps the version envelope — the bump is what makes an
// older pensmith refuse a v3 STATE.json ("upgrade pensmith",
// migrations/loader.ts ForwardIncompatError) instead of choking on the unknown
// `suffix` key of its strict v2 entry schema.
//
// Contract (mirrors v1_to_v2.ts):
//   - input must be a non-null, non-array object;
//   - v3 input → a deep clone, unchanged (idempotent);
//   - v4+ input → refuse-forward Error;
//   - every top-level field and every section field is preserved.

const TARGET = 3;

function versionOf(obj: Record<string, unknown>): number {
  const camel = obj['$schemaVersion'];
  if (typeof camel === 'number' && Number.isInteger(camel) && camel >= 1) return camel;
  const snake = obj['schema_version'];
  if (typeof snake === 'number' && Number.isInteger(snake) && snake >= 1) return snake;
  return 1;
}

/** v2 → v3 shape transform (the identity plus the version bump). */
export function migrate(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('v2_to_v3: input must be a non-null, non-array object');
  }
  const obj = input as Record<string, unknown>;
  const version = versionOf(obj);
  if (version > TARGET) {
    throw new Error(
      `pensmith: refuse-forward — state $schemaVersion=${version} is newer than ` +
        `CURRENT_STATE_VERSION=${TARGET} (ARCH-07). Upgrade pensmith, or restore from a ` +
        `v${TARGET}-or-older snapshot.`,
    );
  }
  const out = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  if (version === TARGET) return out;
  out['$schemaVersion'] = TARGET;
  if ('schema_version' in out) out['schema_version'] = TARGET;
  return out;
}

/** Default export — the migrations registry signature `(input: unknown) => unknown`. */
export default function v2_to_v3(input: unknown): unknown {
  return migrate(input);
}
