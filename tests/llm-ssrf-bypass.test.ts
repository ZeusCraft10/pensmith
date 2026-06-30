// tests/llm-ssrf-bypass.test.ts — audit #34 regression (source-grep convention).
//
// complete() POSTed to the provider with source:'generic', which made http.ts
// run the SSRF DNS pre-flight on EVERY live LLM completion. The provider URL is
// the configured endpoint from trusted runtime config — not data derived from an
// external/untrusted source — so the per-call lookup is redundant. complete() now
// passes untrusted:false (the IN-02 trusted-URL bypass, gated at http.ts).
//
// Source-grep (not behavioral): the SSRF semantics themselves are covered by
// ssrf-guard.test.ts; fetch() does not expose checkSsrf for injection, and the
// live POST cannot run offline. This pins the bypass to complete()'s provider
// fetch block (source:'generic' + noCache + untrusted:false together).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const anthropicSrc = readFileSync(
  fileURLToPath(new URL('../bin/lib/anthropic.ts', import.meta.url)),
  'utf8',
);

test("audit #34: complete()'s provider fetch passes untrusted:false to skip the redundant SSRF preflight", () => {
  // The three options must co-occur in the same fetch block: a generic-source,
  // never-cached POST that opts out of the SSRF DNS pre-flight for the trusted
  // provider endpoint.
  assert.match(
    anthropicSrc,
    /source:\s*'generic',[\s\S]{0,80}noCache:\s*true,[\s\S]{0,80}untrusted:\s*false/,
    "complete() must pass untrusted:false alongside source:'generic'/noCache to bypass the redundant SSRF preflight (#34)",
  );
});
