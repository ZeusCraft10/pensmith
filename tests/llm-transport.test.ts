// tests/llm-transport.test.ts
//
// Wave-0 RED-by-skip scaffold for Phase 11 (Tier-2 LLM transport).
//
// T-11-01: complete() returns deterministic offline mock under PENSMITH_NO_LLM=1.
// T-11-02: complete() calls assertBudget BEFORE any HTTP call (budget-gate).
// T-11-03: API key value NEVER appears in session-log files, stdout, stderr, or COSTS.jsonl.
// T-11-04: MissingApiKeyError from getProviderApiKey propagates out of complete().
// T-11-05: each of the six generative verbs exits non-zero + stderr banner when no key.
// T-11-06: each of the six generative verbs writes a NON-placeholder artifact under PENSMITH_NO_LLM=1.
// T-11-07: Anthropic provider → correct POST body + header shape to api.anthropic.com.
// T-11-08: OpenAI provider → correct POST body + header shape to api.openai.com.
//
// Skip strategy: every behavioral test guards on `transportReady()` — a
// feature-detect that tries a dynamic import of bin/lib/anthropic.js via URL.href
// and checks that the module exports `complete` and `isNoLlmMode` functions.
// While the module is absent (Waves 1-2 not yet landed), ALL tests skip cleanly
// with 0 failures. This mirrors the 08-00 / 10-00 RED-by-skip convention.
//
// Per-verb integration tests (T-11-05, T-11-06) are additionally guarded by a
// source-grep predicate that checks whether the verb's source file still contains
// its TIER2_* placeholder constant — if it does, the verb is not yet wired and
// the integration test skips.
//
// Analogs:
//   - tests/http-cache-no-header-leak.test.ts (withFreshState, disk-sweep loop)
//   - tests/runtime.test.ts (dynamic-import-after-env-reset)
//   - tests/budget.test.ts (withProjectRoot chdir + .paper mkdir)
//   - tests/http.test.ts (MockAgent intercept + request-body capture)

import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';

// ---------------------------------------------------------------------------
// Local TypeScript interface for the transport public surface.
// These resolve at compile time even while bin/lib/anthropic.ts is absent —
// the actual module is imported dynamically below so tsc --noEmit stays clean.
// ---------------------------------------------------------------------------
interface CompleteOptions {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  maxTokens?: number;
  scopeCapUsd?: number;
  scope?: 'paper' | 'section' | 'task';
  scopeId?: string;
}

interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

interface TransportModule {
  complete: (opts: CompleteOptions) => Promise<CompleteResult>;
  isNoLlmMode: () => boolean;
}

// ---------------------------------------------------------------------------
// transportReady(): feature-detect guard.
// Dynamic import of the transport via URL.href so tsc never sees a static import
// of an absent module. Returns false on any import error or missing export.
// ---------------------------------------------------------------------------
async function transportReady(): Promise<boolean> {
  try {
    // Use the established 08-00/10-00 URL.href dynamic-import pattern:
    const mod = await import(new URL('../bin/lib/anthropic.js', import.meta.url).href) as Record<string, unknown>;
    return typeof mod['complete'] === 'function' && typeof mod['isNoLlmMode'] === 'function';
  } catch {
    return false;
  }
}

async function loadTransport(): Promise<TransportModule> {
  const mod = await import(new URL('../bin/lib/anthropic.js', import.meta.url).href) as TransportModule;
  return mod;
}

// ---------------------------------------------------------------------------
// withFreshState: isolation helper (mirrors http-cache-no-header-leak.test.ts).
// Saves/restores env vars, sets up a tmpdir for pensmithDataDir resolution,
// creates .paper/ for budget.ts COSTS.jsonl, chdirs into it, and installs/tears
// down a MockAgent. All restores happen in finally so a failing test cannot
// contaminate the next one.
// ---------------------------------------------------------------------------
async function withFreshState<T>(
  fn: (tmpRoot: string, agent: MockAgent) => Promise<T>,
  extraEnv: Partial<Record<string, string | undefined>> = {},
): Promise<T> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-llm-transport-'));
  await fsp.mkdir(path.join(tmpRoot, '.paper'), { recursive: true });

  // Save env
  const savedLad = process.env['LOCALAPPDATA'];
  const savedXdg = process.env['XDG_DATA_HOME'];
  const savedHome = process.env['HOME'];
  const savedNoLlm = process.env['PENSMITH_NO_LLM'];
  const savedAnthropicKey = process.env['ANTHROPIC_API_KEY'];
  const savedOpenaiKey = process.env['OPENAI_API_KEY'];
  const savedEmail = process.env['PENSMITH_CONTACT_EMAIL'];

  // Save cwd and dispatcher
  const origCwd = process.cwd();
  const savedDispatcher: Dispatcher = getGlobalDispatcher();

  // Redirect data dirs so runtime.ts / paths.ts / budget.ts resolve into tmpRoot
  process.env['LOCALAPPDATA'] = tmpRoot;
  process.env['XDG_DATA_HOME'] = tmpRoot;
  process.env['HOME'] = tmpRoot;
  process.env['PENSMITH_CONTACT_EMAIL'] = 'test@example.org';

  // Apply extra env overrides (undefined = delete)
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  // Install a MockAgent with disableNetConnect so no real network call can escape
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);

  // chdir into the project root so budget.ts finds .paper/COSTS.jsonl
  process.chdir(tmpRoot);

  try {
    return await fn(tmpRoot, agent);
  } finally {
    // Restore cwd first (before rm so it isn't still inside the temp dir)
    process.chdir(origCwd);

    // Restore dispatcher
    setGlobalDispatcher(savedDispatcher);
    await agent.close().catch(() => {});

    // Restore env
    if (savedLad === undefined) delete process.env['LOCALAPPDATA'];
    else process.env['LOCALAPPDATA'] = savedLad;
    if (savedXdg === undefined) delete process.env['XDG_DATA_HOME'];
    else process.env['XDG_DATA_HOME'] = savedXdg;
    if (savedHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = savedHome;
    if (savedNoLlm === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = savedNoLlm;
    if (savedAnthropicKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = savedAnthropicKey;
    if (savedOpenaiKey === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = savedOpenaiKey;
    if (savedEmail === undefined) delete process.env['PENSMITH_CONTACT_EMAIL'];
    else process.env['PENSMITH_CONTACT_EMAIL'] = savedEmail;

    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// walkAndReadAll: recursively read every file under dir into (path, text) pairs.
// Used for the no-leak disk sweep (T-11-03).
// ---------------------------------------------------------------------------
async function walkAndReadAll(dir: string): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkAndReadAll(p)));
    } else if (e.isFile()) {
      try {
        out.push({ path: p, text: await fsp.readFile(p, 'utf8') });
      } catch {
        // Best-effort — unreadable file is not a leak.
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-verb source-grep predicates.
// A verb is "not yet wired" if its source file still contains the TIER2_*
// placeholder constant. This prevents the integration tests from running
// against a verb that hasn't had complete() wired yet — mirrors the 07-01
// source-grep skip-predicate pattern.
// ---------------------------------------------------------------------------
// Read a verb's .ts source via the repo root. Uses fileURLToPath so a repo path
// containing spaces (e.g. ".../OneDrive - Roanoke College/...") is %20-DECODED —
// the prior `.pathname`/regex-strip approach left %20 in the path, so readFileSync
// threw on spaced dev paths and every per-verb test silently skipped locally while
// running for the first time on CI (the exact local-vs-CI gap we're closing).
function verbSrc(verb: string): string {
  return readFileSync(path.join(repoRoot(), 'bin', 'cli', `${verb}.ts`), 'utf8');
}

const VERB_WIRED_PREDICATES: Record<string, () => boolean> = {
  intake: () => {
    try { const s = verbSrc('intake'); return !s.includes('tier2-placeholder') && !s.includes('TIER2_PLACEHOLDER'); } catch { return false; }
  },
  research: () => {
    try { const s = verbSrc('research'); return !s.includes('PLACEHOLDER_LIBRARY') && !s.includes('tier2-placeholder'); } catch { return false; }
  },
  outline: () => {
    try { const s = verbSrc('outline'); return !s.includes('TIER2_OUTLINE') && !s.includes('tier2-placeholder'); } catch { return false; }
  },
  plan: () => {
    try { const s = verbSrc('plan'); return !s.includes('TIER2_PLAN') && !s.includes('tier2-placeholder'); } catch { return false; }
  },
  write: () => {
    try { const s = verbSrc('write'); return !s.includes('TIER2_DRAFT') && !s.includes('tier2-placeholder'); } catch { return false; }
  },
  revise: () => {
    try { const s = verbSrc('revise'); return !s.includes('tier2ProposeSwap') && !s.includes('tier2-placeholder'); } catch { return false; }
  },
};

// Resolve the repo root from import.meta.url so we can locate the built CLI.
// fileURLToPath decodes %20 (and other escapes) and yields a native path on both
// Windows (file:///C:/...) and POSIX (file:///home/...).
function repoRoot(): string {
  const filePath = fileURLToPath(import.meta.url);
  // Go up one directory from tests/ to get the repo root
  return path.resolve(path.dirname(filePath), '..');
}

// The built CLI binary (spawned for integration tests T-11-05, T-11-06)
function cliBin(): string {
  return path.join(repoRoot(), 'dist', 'bin', 'pensmith.js');
}


// ---------------------------------------------------------------------------
// isNoLlmMode unit test (not skip-guarded — isNoLlmMode is a pure predicate and
// can be tested even before the full module is built by using the dynamic import
// pattern; we guard it with transportReady() for safety).
// ---------------------------------------------------------------------------
test('isNoLlmMode: returns true iff PENSMITH_NO_LLM===1', async (t) => {
  if (!(await transportReady())) {
    t.skip('anthropic.ts not yet built — skip isNoLlmMode unit test');
    return;
  }
  const { isNoLlmMode } = await loadTransport();

  const saved = process.env['PENSMITH_NO_LLM'];
  try {
    process.env['PENSMITH_NO_LLM'] = '1';
    assert.equal(isNoLlmMode(), true, 'isNoLlmMode() must be true when PENSMITH_NO_LLM=1');

    process.env['PENSMITH_NO_LLM'] = '0';
    assert.equal(isNoLlmMode(), false, 'isNoLlmMode() must be false when PENSMITH_NO_LLM=0');

    delete process.env['PENSMITH_NO_LLM'];
    assert.equal(isNoLlmMode(), false, 'isNoLlmMode() must be false when PENSMITH_NO_LLM is unset');
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = saved;
  }
});

// ---------------------------------------------------------------------------
// T-11-01: complete() returns deterministic offline mock under PENSMITH_NO_LLM=1.
// No HTTP request must be attempted (MockAgent.disableNetConnect enforces this).
// ---------------------------------------------------------------------------
test('T-11-01: complete() returns offline mock text under PENSMITH_NO_LLM=1 with no HTTP call', async (t) => {
  if (!(await transportReady())) {
    t.skip('anthropic.ts not yet built — skip T-11-01');
    return;
  }
  await withFreshState(async () => {
    process.env['PENSMITH_NO_LLM'] = '1';
    delete process.env['ANTHROPIC_API_KEY'];

    const { complete } = await loadTransport();
    const result = await complete({
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Write a short intro.' }],
      scope: 'task',
      scopeId: 'test-offline',
    });

    // Must return deterministic mock — NOT throw.
    assert.ok(typeof result.text === 'string', 'offline result.text must be a string');
    assert.ok(result.text.length > 0, 'offline result.text must be non-empty');
    assert.equal(result.inputTokens, 0, 'offline inputTokens must be 0');
    assert.equal(result.outputTokens, 0, 'offline outputTokens must be 0');
    // No HTTP call was allowed — MockAgent.disableNetConnect would have thrown
    // if any network request had been attempted.
  }, {
    PENSMITH_NO_LLM: '1',
  });
});

// ---------------------------------------------------------------------------
// T-11-02: complete() calls assertBudget BEFORE any HTTP call.
// Seed COSTS.jsonl over cap → BudgetExceededError must fire with no MockAgent
// interception triggered.
// ---------------------------------------------------------------------------
test('T-11-02: complete() raises BudgetExceededError BEFORE any HTTP call when budget exceeded', async (t) => {
  if (!(await transportReady())) {
    t.skip('anthropic.ts not yet built — skip T-11-02');
    return;
  }
  await withFreshState(async (tmpRoot) => {
    // Ensure PENSMITH_NO_LLM is NOT set so the transport would normally attempt a call
    delete process.env['PENSMITH_NO_LLM'];
    // Set a key so MissingApiKeyError is not the failure mode
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-budget-gate-key';

    // Seed .paper/COSTS.jsonl with spend already over the cap we'll pass.
    // We seed $1.00 of spend; we'll call complete with scopeCapUsd=0.01.
    const costsPath = path.join(tmpRoot, '.paper', 'COSTS.jsonl');
    const costRecord = JSON.stringify({
      ts: new Date().toISOString(),
      scope: 'task',
      scopeId: 'test-budget',
      provider: 'anthropic',
      model: 'claude-haiku-4',
      inputTokens: 100000,
      outputTokens: 10000,
      costUsd: 1.00,
    });
    await fsp.writeFile(costsPath, costRecord + '\n', 'utf8');

    const { complete } = await loadTransport();

    // Should throw BudgetExceededError because $1.00 spent > $0.01 cap.
    // The MockAgent's disableNetConnect means ANY HTTP call would throw a
    // different error — so if BudgetExceededError is not thrown, either no
    // error occurs (wrong) or we get a network error (also wrong).
    await assert.rejects(
      () => complete({
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Write a short intro.' }],
        scope: 'task',
        scopeId: 'test-budget',
        scopeCapUsd: 0.01, // $0.01 cap; $1.00 already spent → must reject
      }),
      (err: unknown) => {
        // Must be BudgetExceededError, not a network error from MockAgent
        assert.ok(err instanceof Error, 'must throw an Error');
        const name = (err as Error).name;
        assert.ok(
          name === 'BudgetExceededError' || (err as Error).message.includes('budget'),
          `expected BudgetExceededError, got ${name}: ${(err as Error).message}`,
        );
        return true;
      },
    );
  }, {
    ANTHROPIC_API_KEY: 'sk-ant-test-budget-gate-key',
  });
});

// ---------------------------------------------------------------------------
// T-11-03 (no-leak, mirrors T-01-07): API key sentinel NEVER appears in any
// session-log file, stdout/stderr capture, or .paper/COSTS.jsonl line.
// The sentinel MAY appear only in the recorded request headers.
// ---------------------------------------------------------------------------
test('T-11-03: API key value never leaks to disk files, stdout, or stderr (no-leak)', async (t) => {
  if (!(await transportReady())) {
    t.skip('anthropic.ts not yet built — skip T-11-03');
    return;
  }
  // A unique sentinel that would never appear in normal log content
  const KEY_SENTINEL = 'PENSMITH-TEST-SENTINEL-KEY-NOLEAK-A7F2B9C1';

  await withFreshState(async (tmpRoot, agent) => {
    delete process.env['PENSMITH_NO_LLM'];
    process.env['ANTHROPIC_API_KEY'] = KEY_SENTINEL;

    // Install an intercept on the Anthropic API endpoint that records the request.
    // The transport routes all HTTP through http.ts which uses undici — so the
    // MockAgent captures the request before it reaches the wire.
    // IN-01: undici v7 reply(fn) receives request headers as opts.headers,
    // so we can capture them and add a POSITIVE assertion that the key
    // appears in the x-api-key header (not just that it's absent from disk/stdout/stderr).
    let capturedRequestHeaders: Record<string, string | string[]> = {};
    const intercepted: boolean[] = [];

    const pool = agent.get('https://api.anthropic.com');
    pool
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(200, (_opts?: { headers?: Record<string, string | string[]>; body?: string }) => {
        capturedRequestHeaders = (_opts?.headers ?? {}) as Record<string, string | string[]>;
        intercepted.push(true);
        return JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Test response for no-leak assertion.' }],
          usage: { input_tokens: 10, output_tokens: 8 },
        });
      }, { headers: { 'content-type': 'application/json' } });

    // Also enable the pool so disableNetConnect doesn't block our mocked route
    // (undici MockAgent allows the registered intercepts even with disableNetConnect).

    const { complete } = await loadTransport();
    let stdout = '';
    let stderr = '';
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    // Capture stdout/stderr during the call
    (process.stdout as NodeJS.WriteStream & { write: typeof process.stdout.write }).write = (
      chunk: string | Uint8Array,
      ...rest: unknown[]
    ) => {
      if (typeof chunk === 'string') stdout += chunk;
      else stdout += Buffer.from(chunk).toString('utf8');
      return (origStdoutWrite as (chunk: string | Uint8Array, ...args: unknown[]) => boolean)(chunk, ...rest);
    };
    (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
      chunk: string | Uint8Array,
      ...rest: unknown[]
    ) => {
      if (typeof chunk === 'string') stderr += chunk;
      else stderr += Buffer.from(chunk).toString('utf8');
      return (origStderrWrite as (chunk: string | Uint8Array, ...args: unknown[]) => boolean)(chunk, ...rest);
    };

    try {
      await complete({
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello.' }],
        scope: 'task',
        scopeId: 'test-noleak',
        scopeCapUsd: 10.00, // generous cap so budget gate doesn't fire
      });
    } finally {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
    }

    // --- Assertions ---

    // 1. stdout must not contain the sentinel
    assert.equal(
      stdout.includes(KEY_SENTINEL),
      false,
      `T-11-03: KEY_SENTINEL found in stdout capture — key leaked to stdout`,
    );

    // 2. stderr must not contain the sentinel
    assert.equal(
      stderr.includes(KEY_SENTINEL),
      false,
      `T-11-03: KEY_SENTINEL found in stderr capture — key leaked to stderr`,
    );

    // 3. Walk all files under tmpRoot and assert sentinel is absent
    const files = await walkAndReadAll(tmpRoot);
    for (const f of files) {
      assert.equal(
        f.text.includes(KEY_SENTINEL),
        false,
        `T-11-03: KEY_SENTINEL found in file ${f.path} — key leaked to disk`,
      );
    }

    // 4. IN-01: POSITIVE assertion — the KEY_SENTINEL MUST appear in the
    // outgoing x-api-key request header. Without this, T-11-03 would pass
    // even if the transport made an unauthenticated POST with no x-api-key.
    // undici v7 reply(fn) delivers request headers in opts.headers.
    assert.ok(
      intercepted.length > 0,
      'T-11-03: MockAgent intercept was never triggered — complete() did not POST',
    );
    assert.ok(
      JSON.stringify(capturedRequestHeaders).includes(KEY_SENTINEL),
      'T-11-03: KEY_SENTINEL must appear in the outbound x-api-key request header',
    );
  }, {
    ANTHROPIC_API_KEY: KEY_SENTINEL,
  });
});

// ---------------------------------------------------------------------------
// T-11-04: MissingApiKeyError propagates out of complete() when no key set.
// ---------------------------------------------------------------------------
test('T-11-04: complete() rejects with MissingApiKeyError when no API key is configured', async (t) => {
  if (!(await transportReady())) {
    t.skip('anthropic.ts not yet built — skip T-11-04');
    return;
  }
  await withFreshState(async () => {
    delete process.env['PENSMITH_NO_LLM'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    const { complete } = await loadTransport();
    await assert.rejects(
      () => complete({
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello.' }],
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'must throw an Error');
        const name = (err as Error).name;
        // Accept either the exact class name or a code property on the error
        const errAsAny = err as unknown as Record<string, unknown>;
        const isMissingApiKey =
          name === 'MissingApiKeyError' ||
          errAsAny['code'] === 'MISSING_API_KEY';
        assert.ok(
          isMissingApiKey,
          `expected MissingApiKeyError (name='MissingApiKeyError' or code='MISSING_API_KEY'), got name='${name}' message='${(err as Error).message}'`,
        );
        return true;
      },
    );
  }, {
    ANTHROPIC_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    PENSMITH_NO_LLM: undefined,
  });
});

// ---------------------------------------------------------------------------
// T-11-07: Anthropic provider → POST to api.anthropic.com/v1/messages with
// correct request body shape and required headers.
// ---------------------------------------------------------------------------
test('T-11-07: Anthropic provider sends correct POST body and headers to api.anthropic.com', async (t) => {
  if (!(await transportReady())) {
    t.skip('anthropic.ts not yet built — skip T-11-07');
    return;
  }
  await withFreshState(async (_tmpRoot, agent) => {
    delete process.env['PENSMITH_NO_LLM'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-body-shape-key';

    // Capture the request body via a body-inspection intercept
    let capturedBody: string = '';
    let capturedHeaders: Record<string, string | string[]> = {};

    const pool = agent.get('https://api.anthropic.com');
    pool
      .intercept({
        path: '/v1/messages',
        method: 'POST',
      })
      .reply(200, (_opts?: { headers?: Record<string, string | string[]>; body?: string }) => {
        capturedHeaders = (_opts?.headers ?? {}) as Record<string, string | string[]>;
        capturedBody = typeof _opts?.body === 'string' ? _opts.body : '';
        return JSON.stringify({
          id: 'msg_shape_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Anthropic shape test response.' }],
          usage: { input_tokens: 12, output_tokens: 6 },
        });
      }, { headers: { 'content-type': 'application/json' } });

    const { complete } = await loadTransport();
    const result = await complete({
      system: 'You are an academic writing assistant.',
      messages: [{ role: 'user', content: 'Write a one-sentence intro.' }],
      model: 'claude-haiku-4',
      maxTokens: 256,
      scope: 'task',
      scopeId: 'anthropic-shape-test',
      scopeCapUsd: 10.00,
    });

    // The result must be valid
    assert.ok(typeof result.text === 'string' && result.text.length > 0, 'result.text must be non-empty');

    // Validate captured request body shape
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(capturedBody) as Record<string, unknown>;
    } catch {
      assert.fail(`T-11-07: Anthropic request body was not valid JSON: ${capturedBody}`);
    }

    assert.ok('model' in body, 'Anthropic body must include "model"');
    assert.ok('max_tokens' in body, 'Anthropic body must include "max_tokens"');
    assert.ok('system' in body, 'Anthropic body must include "system"');
    assert.ok(Array.isArray(body['messages']), 'Anthropic body must include "messages" array');

    // WR-02: Validate BOTH required headers must be present (AND, not OR).
    // 'anthropic-version' is always set unconditionally, so an OR would pass
    // even if the key-injection at line ~394 were removed. Using AND ensures
    // removing x-api-key injection would fail this test.
    const headerStr = JSON.stringify(capturedHeaders).toLowerCase();
    assert.ok(
      headerStr.includes('x-api-key') && headerStr.includes('anthropic-version'),
      `T-11-07: Anthropic request headers must include BOTH x-api-key and anthropic-version; got ${JSON.stringify(capturedHeaders)}`,
    );
    // Also assert the key value itself is present in the headers.
    assert.ok(
      JSON.stringify(capturedHeaders).includes('sk-ant-test-body-shape-key'),
      'T-11-07: x-api-key header must carry the configured API key value',
    );
  }, {
    ANTHROPIC_API_KEY: 'sk-ant-test-body-shape-key',
    PENSMITH_NO_LLM: undefined,
  });
});

// ---------------------------------------------------------------------------
// T-11-08: OpenAI provider → POST to api.openai.com/v1/chat/completions with
// correct request body shape and Authorization: Bearer header.
// ---------------------------------------------------------------------------
test('T-11-08: OpenAI provider sends correct POST body and Authorization header to api.openai.com', async (t) => {
  if (!(await transportReady())) {
    t.skip('anthropic.ts not yet built — skip T-11-08');
    return;
  }
  await withFreshState(async (tmpRoot, agent) => {
    delete process.env['PENSMITH_NO_LLM'];
    process.env['OPENAI_API_KEY'] = 'sk-openai-test-body-shape-key';
    delete process.env['ANTHROPIC_API_KEY'];

    // Write a runtime config that sets the default provider to openai
    const runtimeConfigDir = path.join(tmpRoot, 'pensmith');
    await fsp.mkdir(runtimeConfigDir, { recursive: true });
    const runtimeConfig = {
      $schemaVersion: 1,
      providers: {
        openai: {
          name: 'openai',
          apiKeyEnv: 'OPENAI_API_KEY',
          defaultModel: 'gpt-4o',
        },
      },
    };
    await fsp.writeFile(
      path.join(runtimeConfigDir, 'runtime.json'),
      JSON.stringify(runtimeConfig, null, 2),
      'utf8',
    );

    let capturedBody: string = '';
    let capturedHeaders: Record<string, string | string[]> = {};

    const pool = agent.get('https://api.openai.com');
    pool
      .intercept({
        path: '/v1/chat/completions',
        method: 'POST',
      })
      .reply(200, (_opts?: { headers?: Record<string, string | string[]>; body?: string }) => {
        capturedHeaders = (_opts?.headers ?? {}) as Record<string, string | string[]>;
        capturedBody = typeof _opts?.body === 'string' ? _opts.body : '';
        return JSON.stringify({
          id: 'chatcmpl-shape-test',
          object: 'chat.completion',
          choices: [{
            message: { role: 'assistant', content: 'OpenAI shape test response.' },
            finish_reason: 'stop',
            index: 0,
          }],
          usage: { prompt_tokens: 14, completion_tokens: 7 },
        });
      }, { headers: { 'content-type': 'application/json' } });

    const { complete } = await loadTransport();
    const result = await complete({
      system: 'You are an academic writing assistant.',
      messages: [{ role: 'user', content: 'Write a one-sentence intro.' }],
      model: 'gpt-4o',
      maxTokens: 256,
      scope: 'task',
      scopeId: 'openai-shape-test',
      scopeCapUsd: 10.00,
    });

    assert.ok(typeof result.text === 'string' && result.text.length > 0, 'result.text must be non-empty');

    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(capturedBody) as Record<string, unknown>;
    } catch {
      assert.fail(`T-11-08: OpenAI request body was not valid JSON: ${capturedBody}`);
    }

    assert.ok('model' in body, 'OpenAI body must include "model"');
    assert.ok('max_tokens' in body, 'OpenAI body must include "max_tokens"');
    assert.ok(Array.isArray(body['messages']), 'OpenAI body must include "messages" array');

    // OpenAI folds system into messages[0] with role:'system'
    const msgs = body['messages'] as Array<{ role: string; content: string }>;
    const systemMsg = msgs.find((m) => m.role === 'system');
    assert.ok(systemMsg != null, 'OpenAI body must include a system message in the messages array');

    // Validate Authorization: Bearer header
    const headerStr = JSON.stringify(capturedHeaders).toLowerCase();
    assert.ok(
      headerStr.includes('authorization') && headerStr.includes('bearer'),
      `T-11-08: OpenAI request headers must include Authorization: Bearer; got ${JSON.stringify(capturedHeaders)}`,
    );
  }, {
    OPENAI_API_KEY: 'sk-openai-test-body-shape-key',
    ANTHROPIC_API_KEY: undefined,
    PENSMITH_NO_LLM: undefined,
  });
});

// ---------------------------------------------------------------------------
// T-11-05 + T-11-06: Per-verb integration tests.
// Each of the six generative verbs is tested for:
//   T-11-05: exits non-zero + writes a banner to stderr when no key configured
//            (PENSMITH_NO_LLM unset, ANTHROPIC_API_KEY/OPENAI_API_KEY unset)
//   T-11-06: writes a NON-placeholder artifact under PENSMITH_NO_LLM=1
//            (the offline mock text from complete() counts as "real" for CI)
//
// Guard: transportReady() AND per-verb source-grep predicate (verb not yet wired).
// CLI is spawned using the built dist/bin/pensmith.js binary. If the binary
// doesn't exist, the test skips (build is a precondition).
// ---------------------------------------------------------------------------

const VERBS_FOR_INTEGRATION = ['intake', 'research', 'outline', 'plan', 'write', 'revise'] as const;
type GenerativeVerb = typeof VERBS_FOR_INTEGRATION[number];

// Minimal args needed to make each verb not crash on missing args before reaching the key check
const VERB_REQUIRED_ARGS: Record<GenerativeVerb, string[]> = {
  intake: [],
  research: [],
  // outline has a default-on approval gate (CLAUDE.md non-negotiable) that exits 3
  // in a non-TTY spawn. PENSMITH_NO_LLM mocks the LLM, NOT the approval gate, so the
  // non-interactive integration spawn must pass --yolo to reach the artifact-write path.
  outline: ['--yolo'],
  plan: ['1'],
  write: ['1'],
  revise: ['1'],
};

for (const verb of VERBS_FOR_INTEGRATION) {
  test(`T-11-05: verb '${verb}' exits non-zero + stderr banner when no LLM key configured`, async (t) => {
    if (!(await transportReady())) {
      t.skip(`anthropic.ts not yet built — skip T-11-05 (${verb})`);
      return;
    }
    if (!VERB_WIRED_PREDICATES[verb]?.()) {
      t.skip(`verb '${verb}' still has TIER2_* placeholder (not yet wired) — skip T-11-05 (${verb})`);
      return;
    }
    const bin = cliBin();
    if (!existsSync(bin)) {
      t.skip(`dist/bin/pensmith.js not found — run npm run build first (T-11-05 ${verb})`);
      return;
    }

    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `pensmith-t1105-${verb}-`));
    await fsp.mkdir(path.join(tmpRoot, '.paper'), { recursive: true });

    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PENSMITH_NO_LLM: undefined,
        ANTHROPIC_API_KEY: undefined,
        OPENAI_API_KEY: undefined,
      };
      delete env['PENSMITH_NO_LLM'];
      delete env['ANTHROPIC_API_KEY'];
      delete env['OPENAI_API_KEY'];

      const result = spawnSync(
        process.execPath,
        [bin, verb, ...VERB_REQUIRED_ARGS[verb]],
        {
          cwd: tmpRoot,
          env,
          encoding: 'utf8',
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      // Must exit non-zero (GEN-06 fail-loud contract)
      assert.notEqual(
        result.status,
        0,
        `T-11-05 (${verb}): expected non-zero exit code, got 0. stderr: ${result.stderr}`,
      );

      // Must write a banner to stderr naming the missing key
      assert.ok(
        typeof result.stderr === 'string' && result.stderr.length > 0,
        `T-11-05 (${verb}): expected stderr banner, got empty stderr`,
      );

      // stdout must NOT contain 'ok:true' or 'tier2-placeholder'
      assert.equal(
        result.stdout?.includes('tier2-placeholder'),
        false,
        `T-11-05 (${verb}): stdout must not contain 'tier2-placeholder' — GEN-06 violation`,
      );
      assert.equal(
        result.stdout?.includes('"ok":true') || result.stdout?.includes("'ok':true"),
        false,
        `T-11-05 (${verb}): stdout must not contain ok:true on missing-key path`,
      );
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  test(`T-11-06: verb '${verb}' writes NON-placeholder artifact under PENSMITH_NO_LLM=1`, async (t) => {
    if (!(await transportReady())) {
      t.skip(`anthropic.ts not yet built — skip T-11-06 (${verb})`);
      return;
    }
    if (!VERB_WIRED_PREDICATES[verb]?.()) {
      t.skip(`verb '${verb}' still has TIER2_* placeholder (not yet wired) — skip T-11-06 (${verb})`);
      return;
    }
    const bin = cliBin();
    if (!existsSync(bin)) {
      t.skip(`dist/bin/pensmith.js not found — run npm run build first (T-11-06 ${verb})`);
      return;
    }

    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `pensmith-t1106-${verb}-`));
    await fsp.mkdir(path.join(tmpRoot, '.paper'), { recursive: true });

    try {
      const result = spawnSync(
        process.execPath,
        [bin, verb, ...VERB_REQUIRED_ARGS[verb]],
        {
          cwd: tmpRoot,
          env: {
            ...process.env,
            PENSMITH_NO_LLM: '1',
          },
          encoding: 'utf8',
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      // Under PENSMITH_NO_LLM=1 the offline mock should succeed
      assert.equal(
        result.status,
        0,
        `T-11-06 (${verb}): expected exit code 0 under PENSMITH_NO_LLM=1, got ${result.status}. stderr: ${result.stderr}`,
      );

      // Walk the .paper dir and assert no artifact contains 'tier2-placeholder' or 'mode: tier2-placeholder'
      const paperFiles = await walkAndReadAll(path.join(tmpRoot, '.paper'));
      const combined = paperFiles.map((f) => f.text).join('\n');
      assert.equal(
        combined.includes('tier2-placeholder'),
        false,
        `T-11-06 (${verb}): artifact under .paper/ contains 'tier2-placeholder' — verb not fully wired`,
      );

      // stdout must also not contain the placeholder marker
      if (typeof result.stdout === 'string') {
        assert.equal(
          result.stdout.includes('tier2-placeholder'),
          false,
          `T-11-06 (${verb}): stdout contains 'tier2-placeholder' — GEN-02 violation`,
        );
      }
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  });
}
