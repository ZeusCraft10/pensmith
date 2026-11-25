// bin/lib/network-mode.ts — which network the process is allowed to use.
//
// Three modes, decided from the environment on every call (tests flip them):
//
//   offline   PENSMITH_OFFLINE=1 (set by --offline and --dry-run). http.ts refuses
//             every request with OfflineEgressError before touching the cache,
//             DNS or a socket. Callers report "skipped (offline)"; verification
//             reports UNRESOLVED, because "not checked" is neither OK nor
//             FABRICATED.
//   cassette  PENSMITH_TEST_CASSETTES=1, set only by the test runner. http.ts
//             answers from the committed cassettes matched by request; a request
//             with no recording fails instead of borrowing another record.
//   live      everything else. Real users always get the real registries.
//
// Offline wins over cassettes so the offline behaviour can be tested under the
// test runner exactly as a user would see it.

export type NetworkMode = 'live' | 'cassette' | 'offline';

export function networkMode(): NetworkMode {
  if (process.env['PENSMITH_OFFLINE'] === '1') return 'offline';
  if (process.env['PENSMITH_TEST_CASSETTES'] === '1') return 'cassette';
  return 'live';
}

/** True when every outbound request must be refused (--offline / --dry-run). */
export function isOfflineMode(): boolean {
  return networkMode() === 'offline';
}

/** True when requests are answered from committed test cassettes. */
export function isCassetteMode(): boolean {
  return networkMode() === 'cassette';
}

/** The wording every caller uses when it skipped work because it is offline. */
export const OFFLINE_SKIP_NOTE = 'skipped (offline)';

/**
 * Thrown by http.ts for any request made while offline. Callers that can carry
 * on (research, advisory checks) catch it and report OFFLINE_SKIP_NOTE.
 */
export class OfflineEgressError extends Error {
  readonly code = 'PENSMITH_OFFLINE';
  constructor(readonly url: string) {
    super(`network access is disabled (offline / --dry-run): refused request to ${safeOrigin(url)}`);
    this.name = 'OfflineEgressError';
  }
}

/** Origin only, so a refused URL never echoes query strings (which may hold keys). */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '(invalid URL)';
  }
}
