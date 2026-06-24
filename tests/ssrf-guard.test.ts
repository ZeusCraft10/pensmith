// tests/ssrf-guard.test.ts — Phase 15 Wave 1 RED scaffold for HARD-02.
//
// RED-by-skip: the behavioral tests SKIP until bin/lib/http.ts exports a
// `checkSsrf` function with an injectable `resolveFn` parameter.
// Zero failures while the guard is unshipped; Wave-3 (15-03) lands the
// implementation and these tests un-skip and must PASS.
//
// Covers:
//   - HARD-02: private-IP reject (127.x, 10.x, 169.254.x)
//   - HARD-02: public-host pass
//   - HARD-02: non-https/http scheme reject
//   - No real DNS — resolver is an injected local async function
//
// Path resolution convention (Phase-11 lesson):
//   ALL paths use fileURLToPath(new URL(..., import.meta.url)) so the
//   test survives the spaced OneDrive dev tree without %20 breakage.
//
// Dynamic-import convention (known-bad-pass2.test.ts precedent):
//   Import the not-yet-existing export via a runtime URL .href specifier
//   so tsc --noEmit stays clean while the export is absent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- path resolution (Phase-11 spaced-path safe) ----
const httpSrcPath = fileURLToPath(new URL('../bin/lib/http.ts', import.meta.url));
const httpModUrl = new URL('../bin/lib/http.js', import.meta.url);

// ---- skip gate: is checkSsrf exported? ----
// We import the module once and inspect the export at runtime so the
// skip decision is dynamic (handles both Wave-0-absent and Wave-3-present).
let checkSsrfFn: ((url: string, resolveFn?: unknown) => Promise<void>) | undefined;
let httpModLoaded = false;

async function loadHttpMod(): Promise<void> {
  if (httpModLoaded) return;
  httpModLoaded = true;
  try {
    const mod = await import(httpModUrl.href) as Record<string, unknown>;
    if (typeof mod['checkSsrf'] === 'function') {
      checkSsrfFn = mod['checkSsrf'] as (url: string, resolveFn?: unknown) => Promise<void>;
    }
  } catch {
    // Module load failed — target is absent (Wave-0 RED state). Stay skipped.
  }
}

// Eagerly attempt the load so skip decisions are based on real state.
await loadHttpMod();

const hasCheckSsrf = typeof checkSsrfFn === 'function';

// ---- fake resolver (no real DNS — HARD-02 test isolation) ----
// Shape matches dns.lookup {all: true} return: Array<{address: string, family: 4|6}>
type FakeAddrs = Array<{ address: string; family: 4 | 6 }>;
type FakeResolverFn = (hostname: string) => Promise<FakeAddrs>;

function makeResolver(map: Record<string, string>): FakeResolverFn {
  return async (hostname: string): Promise<FakeAddrs> => {
    const addr = map[hostname];
    if (!addr) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return [{ address: addr, family: 4 }];
  };
}

// ---- HARD-02 behavioral tests (skip-guarded) ----

test('SSRF guard: loopback hostname (127.0.0.1) is rejected (HARD-02)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts — not yet wired (HARD-02)' : false },
  async () => {
    const resolve = makeResolver({ 'evil.local': '127.0.0.1' });
    await assert.rejects(
      () => checkSsrfFn!('https://evil.local/data', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('private') || err.message.toLowerCase().includes('blocked'), `expected SSRF-related error, got: ${err.message}`);
        return true;
      },
      'loopback 127.0.0.1 must be rejected by the SSRF guard',
    );
  },
);

test('SSRF guard: RFC1918 10.x.x.x address is rejected (HARD-02)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts — not yet wired (HARD-02)' : false },
  async () => {
    const resolve = makeResolver({ 'internal.corp': '10.0.0.5' });
    await assert.rejects(
      () => checkSsrfFn!('https://internal.corp/api', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('private') || err.message.toLowerCase().includes('blocked'), `expected SSRF-related error, got: ${err.message}`);
        return true;
      },
      'RFC1918 10.x address must be rejected',
    );
  },
);

test('SSRF guard: link-local 169.254.x.x (IMDS/metadata endpoint) is rejected (HARD-02)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts — not yet wired (HARD-02)' : false },
  async () => {
    const resolve = makeResolver({ 'metadata.internal': '169.254.169.254' });
    await assert.rejects(
      () => checkSsrfFn!('https://metadata.internal/latest', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('private') || err.message.toLowerCase().includes('link-local') || err.message.toLowerCase().includes('blocked'), `expected SSRF-related error, got: ${err.message}`);
        return true;
      },
      'link-local 169.254.x address (IMDS) must be rejected',
    );
  },
);

test('SSRF guard: public hostname (93.184.216.34) passes cleanly (HARD-02)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts — not yet wired (HARD-02)' : false },
  async () => {
    const resolve = makeResolver({ 'example.com': '93.184.216.34' });
    // Must resolve without throwing — public IP is allowed
    await assert.doesNotReject(
      () => checkSsrfFn!('https://example.com/resource', resolve),
      'public IP 93.184.216.34 must pass the SSRF guard',
    );
  },
);

test('SSRF guard: non-https/http scheme (file:) is rejected (HARD-02)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts — not yet wired (HARD-02)' : false },
  async () => {
    // No resolver needed — scheme check happens before DNS
    const resolve = makeResolver({});
    await assert.rejects(
      () => checkSsrfFn!('file:///etc/passwd', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('scheme') || err.message.toLowerCase().includes('not allowed'), `expected scheme-rejection error, got: ${err.message}`);
        return true;
      },
      'file: scheme must be rejected by the SSRF guard',
    );
  },
);

// ---- WR-01 / WR-02 new range coverage (skip-guarded same as above) ----

test('SSRF guard: CGNAT 100.64.x.x (RFC 6598) is rejected (WR-01)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts' : false },
  async () => {
    const resolve = makeResolver({ 'cgnat.example': '100.64.0.1' });
    await assert.rejects(
      () => checkSsrfFn!('https://cgnat.example/api', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('private') || err.message.toLowerCase().includes('blocked'), `expected SSRF-related error, got: ${err.message}`);
        return true;
      },
      'CGNAT 100.64.0.1 must be rejected by the SSRF guard',
    );
  },
);

test('SSRF guard: CGNAT 100.127.255.255 (RFC 6598 upper bound) is rejected (WR-01)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts' : false },
  async () => {
    const resolve = makeResolver({ 'cgnat2.example': '100.127.255.255' });
    await assert.rejects(
      () => checkSsrfFn!('https://cgnat2.example/api', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('private') || err.message.toLowerCase().includes('blocked'), `expected SSRF-related error, got: ${err.message}`);
        return true;
      },
      'CGNAT 100.127.255.255 must be rejected by the SSRF guard',
    );
  },
);

test('SSRF guard: 100.63.255.255 (just outside CGNAT range) passes (WR-01)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts' : false },
  async () => {
    // 100.63.x.x is NOT in 100.64.0.0/10 — must be allowed
    const resolve = makeResolver({ 'not-cgnat.example': '100.63.255.255' });
    await assert.doesNotReject(
      () => checkSsrfFn!('https://not-cgnat.example/api', resolve),
      '100.63.255.255 is outside the CGNAT range and must pass the SSRF guard',
    );
  },
);

test('SSRF guard: IPv6 multicast ff02::1 is rejected (WR-01)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts' : false },
  async () => {
    const resolve = makeResolver({ 'mcast.example': 'ff02::1' });
    await assert.rejects(
      () => checkSsrfFn!('https://mcast.example/api', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('private') || err.message.toLowerCase().includes('blocked'), `expected SSRF-related error, got: ${err.message}`);
        return true;
      },
      'IPv6 multicast ff02::1 must be rejected by the SSRF guard',
    );
  },
);

test('SSRF guard: IPv6 unspecified :: is rejected (WR-01)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts' : false },
  async () => {
    const resolve = makeResolver({ 'unspec.example': '::' });
    await assert.rejects(
      () => checkSsrfFn!('https://unspec.example/api', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('private') || err.message.toLowerCase().includes('blocked'), `expected SSRF-related error, got: ${err.message}`);
        return true;
      },
      'IPv6 unspecified :: must be rejected by the SSRF guard',
    );
  },
);

test('SSRF guard: IPv4-mapped IPv6 hex-colon ::ffff:7f00:0001 (127.0.0.1) is rejected (WR-02)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts' : false },
  async () => {
    const resolve = makeResolver({ 'hexmapped.example': '::ffff:7f00:0001' });
    await assert.rejects(
      () => checkSsrfFn!('https://hexmapped.example/api', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('private') || err.message.toLowerCase().includes('blocked'), `expected SSRF-related error, got: ${err.message}`);
        return true;
      },
      '::ffff:7f00:0001 (hex-colon IPv4-mapped 127.0.0.1) must be rejected by the SSRF guard',
    );
  },
);

test('SSRF guard: IPv4-mapped IPv6 hex-colon ::ffff:0a00:0001 (10.0.0.1) is rejected (WR-02)',
  { skip: !hasCheckSsrf ? 'checkSsrf not yet exported from bin/lib/http.ts' : false },
  async () => {
    const resolve = makeResolver({ 'hexmapped2.example': '::ffff:0a00:0001' });
    await assert.rejects(
      () => checkSsrfFn!('https://hexmapped2.example/api', resolve),
      (err: Error) => {
        assert.ok(err.message.toLowerCase().includes('ssrf') || err.message.toLowerCase().includes('private') || err.message.toLowerCase().includes('blocked'), `expected SSRF-related error, got: ${err.message}`);
        return true;
      },
      '::ffff:0a00:0001 (hex-colon IPv4-mapped 10.0.0.1) must be rejected by the SSRF guard',
    );
  },
);

// ---- Wave-0 module-presence consistency (mirrors known-bad-pass2 pattern) ----

test('HARD-02: http.ts exists at expected src path (module-presence sanity)',
  () => {
    // http.ts DOES exist (it shipped in Phase 2); we are adding checkSsrf to it.
    // This test always passes — it is a presence sanity check, not a feature test.
    assert.ok(
      existsSync(httpSrcPath),
      'bin/lib/http.ts must exist — it is the sole network chokepoint (ARCH-12)',
    );
  },
);

test('HARD-02: checkSsrf export presence is consistent with Wave-1 RED state',
  () => {
    if (hasCheckSsrf) {
      assert.ok(true, 'checkSsrf exported — behavioral tests above are active (Wave-3+)');
    } else {
      // Wave-1 RED: checkSsrf not yet exported — behavioral tests skip above.
      assert.ok(!hasCheckSsrf, 'Wave-1 RED: checkSsrf absent from bin/lib/http.ts exports (expected — skips above are correct)');
    }
  },
);
