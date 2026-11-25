// tests/lib/net-harness.ts — shared helpers for the in-process tests that
// drive bin/lib/http.ts against local servers: http-deadline and http-proxy.
//
// Not a test file (the runner collects only *.test.ts).

import { fetch as httpFetch, _resetBucketsForTest } from '../../bin/lib/http.js';

/** Variables that pick the network route or mode; cleared around each in-process run. */
export const NETWORK_ENV_VARS = [
  'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy',
  'PENSMITH_OFFLINE', 'PENSMITH_TEST_CASSETTES',
] as const;

/**
 * Run `fn` with every NETWORK_ENV_VARS entry cleared, then `env` applied, and
 * fresh rate-limit buckets. The previous values come back afterwards.
 */
export async function withNetworkEnv<T>(
  env: Partial<Record<(typeof NETWORK_ENV_VARS)[number], string>>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const k of NETWORK_ENV_VARS) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  _resetBucketsForTest();
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export interface Settled<T> {
  outcome: 'ok' | 'error' | 'hung';
  value?: T;
  error?: unknown;
  ms: number;
}

/**
 * Wait for `p` to settle, or report 'hung' after `guardMs`. The guard only
 * keeps a regression from hanging the whole run; callers pick it far above the
 * timeoutMs their requests ask for.
 */
export async function settle<T>(p: Promise<T>, guardMs: number): Promise<Settled<T>> {
  const started = Date.now();
  let guard: NodeJS.Timeout | undefined;
  const hung = new Promise<'hung'>((resolve) => { guard = setTimeout(() => resolve('hung'), guardMs); });
  try {
    const r = await Promise.race([
      p.then((value) => ({ value }), (error: unknown) => ({ error })),
      hung,
    ]);
    const ms = Date.now() - started;
    if (r === 'hung') return { outcome: 'hung', ms };
    if ('error' in r) return { outcome: 'error', error: r.error, ms };
    return { outcome: 'ok', value: r.value, ms };
  } finally {
    clearTimeout(guard);
  }
}

/** The options bin/lib/anthropic.ts sends to the provider: a billed generation. */
export function providerPost(url: string, timeoutMs: number): ReturnType<typeof httpFetch> {
  return httpFetch(url, {
    method: 'POST',
    body: JSON.stringify({ prompt: 'draft section 3' }),
    source: 'generic',
    noCache: true,
    untrusted: false,
    timeoutMs,
  });
}
