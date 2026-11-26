// tests/llm-ssrf-bypass.test.ts — audit #34 regression (source-grep convention).
//
// Model calls used to run http.ts's SSRF DNS pre-flight on every request. The
// provider URL is the endpoint the user configured in runtime.json (a local
// model server on localhost is a valid one), not data from an external
// source, so the lookup is redundant and would refuse that local server. Both
// generators therefore opt out of it explicitly with untrusted:false.
//
// Source-grep (not behavioral): the SSRF semantics themselves are covered by
// ssrf-guard.test.ts, and tests/llm-generator.test.ts sends a model call to
// 127.0.0.1 through the real transport.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('audit #34: the Anthropic generator\'s fetch skips the SSRF preflight for the configured endpoint', () => {
  assert.match(
    src('../bin/lib/generators/anthropic.ts'),
    /chokepointFetch\(\{[^}]*source:\s*'generic'[^}]*untrusted:\s*false[^}]*\}\)/,
    'chokepointFetch must be built with untrusted:false',
  );
});

test('audit #34: the OpenAI-compatible generator\'s POST skips it too, and is never cached', () => {
  assert.match(
    src('../bin/lib/generators/openai.ts'),
    /source:\s*'generic',[\s\S]{0,80}noCache:\s*true,[\s\S]{0,80}untrusted:\s*false/,
    "the provider POST must pass untrusted:false alongside source:'generic'/noCache",
  );
});
