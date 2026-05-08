// tests/session-log.test.ts — round-trip + redaction + rotation + oversize
// spillover + stderr-mirror + child-binding coverage for bin/lib/session-log.ts.
//
// All tests use os.mkdtempSync per test + scope:'global' with env-var override
// of LOCALAPPDATA / XDG_DATA_HOME / HOME so pensmithDataDir() resolves into
// the per-test tmpdir on every host OS. This bypasses paperDir() entirely
// (no need to materialize a `.paper/` directory in the tmpdir).
//
// node:test runs tests within a single file serially by default — env-var
// mutation between tests is therefore safe. The mirror test resets the
// module-scope flag in `finally`. The chain is module-scope but each test
// awaits log.close() to drain it, so it's quiescent at test boundaries.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openSessionLog, setMirrorPromptsToStderr } from '../bin/lib/session-log.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-session-'));
}

function setEnvForTmp(tmp: string): void {
  // Force pensmithDataDir() to resolve into tmp regardless of platform.
  // paths.ts inspects:
  //   - LOCALAPPDATA on win32
  //   - HOME on darwin (-> HOME/Library/Application Support)
  //   - XDG_DATA_HOME (then HOME/.local/share) on POSIX
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
}

function readLines(file: string): Record<string, unknown>[] {
  const txt = fs.readFileSync(file, 'utf8');
  return txt
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function logFilePath(): Promise<string> {
  // Re-import paths.js fresh so it picks up the current env. Since paths.ts
  // reads process.env at CALL time (not module-load time), one import is
  // sufficient — but using await import keeps the test self-contained.
  const { pensmithDataDir } = await import('../bin/lib/paths.js');
  return path.join(pensmithDataDir(), 'session.log');
}

test('D-49 shape: every line has at/kind/run_id and spreads payload inline (no ctx/msg/ts/level)', async () => {
  const tmp = mkTmp();
  setEnvForTmp(tmp);
  const log = openSessionLog({ scope: 'global', cwd: tmp });
  log.event({ what: 'hello' });
  log.warn({ reason: 'careful', code: 7 });
  await log.close();

  const expected = await logFilePath();
  const lines = readLines(expected);
  assert.equal(lines.length, 2);
  for (const l of lines) {
    assert.match(String(l.at), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof l.kind, 'string');
    assert.equal(typeof l.run_id, 'string');
    assert.ok(String(l.run_id).length >= 16, 'run_id should be at least UUID-length');
    // Banned legacy field names — payload spreads inline per D-49.
    assert.equal(l.ts, undefined, 'no ts field — D-49 uses `at`');
    assert.equal(l.level, undefined, 'no level field — D-49 uses `kind`');
    assert.equal(l.msg, undefined, 'no msg field — payload spreads inline');
    assert.equal(l.ctx, undefined, 'no ctx wrapper — payload spreads inline');
  }
  const [first, second] = lines;
  assert.ok(first && second, 'expected exactly two lines');
  assert.equal(first.kind, 'event');
  assert.equal(first.what, 'hello');
  assert.equal(second.kind, 'warn');
  assert.equal(second.reason, 'careful');
  assert.equal(second.code, 7);
  // Same handle = same run_id across calls.
  assert.equal(first.run_id, second.run_id);
});

test('all 8 kind methods emit the matching wire-form discriminator', async () => {
  const tmp = mkTmp();
  setEnvForTmp(tmp);
  const log = openSessionLog({ scope: 'global', cwd: tmp });
  log.prompt({ p: 1 });
  log.response({ p: 2 });
  log.toolCall({ p: 3 });
  log.toolResult({ p: 4 });
  log.cost({ p: 5 });
  log.event({ p: 6 });
  log.warn({ p: 7 });
  log.error({ p: 8 });
  await log.close();

  const lines = readLines(await logFilePath());
  assert.equal(lines.length, 8);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ['prompt', 'response', 'tool_call', 'tool_result', 'cost', 'event', 'warn', 'error'],
  );
});

test('redaction integration: email PII-redacted in string fields; auth header key-redacted in nested objects', async () => {
  const tmp = mkTmp();
  setEnvForTmp(tmp);
  const log = openSessionLog({ scope: 'global', cwd: tmp });
  log.event({
    note: 'contact help@example.com',
    headers: { authorization: 'Bearer sk-leak' },
  });
  await log.close();

  const [line] = readLines(await logFilePath());
  assert.ok(line, 'expected at least one line');
  const note = String(line.note);
  assert.ok(!note.includes('help@example.com'), 'raw email must not survive');
  assert.ok(
    note.includes('[REDACTED:EMAIL]') || note.includes('[EMAIL]'),
    `expected redaction tag, got: ${note}`,
  );
  const headers = line.headers as Record<string, unknown>;
  assert.notEqual(headers.authorization, 'Bearer sk-leak', 'auth secret must not survive');
});

test('D-51 rotation: writing past maxBytes rotates current -> .1; depth capped at maxBackups', async () => {
  const tmp = mkTmp();
  setEnvForTmp(tmp);
  // Inject small thresholds so the test runs fast — production stays 50MB/3.
  const log = openSessionLog({ scope: 'global', cwd: tmp, maxBytes: 1024, maxBackups: 3 });
  const fillerPayload = 'y'.repeat(200);
  for (let i = 0; i < 80; i++) log.event({ filler: fillerPayload });
  await log.close();

  const base = await logFilePath();
  assert.ok(fs.existsSync(`${base}.1`), 'expected rotated backup .1');
  assert.ok(!fs.existsSync(`${base}.4`), 'depth must not exceed maxBackups=3');
  // After the final write, rotation may have JUST renamed current -> .1
  // and there's no subsequent write to re-create the current file. Accept
  // either: current absent (last op was a rotate) OR current size within the
  // expected one-window margin. Both states are correct.
  if (fs.existsSync(base)) {
    const currentSize = fs.statSync(base).size;
    assert.ok(
      currentSize <= 1024 + 512,
      `expected current <= ~1KB margin, got ${currentSize}`,
    );
  }
});

test('D-50 oversize: 100KB payload truncates to <=16KB line; full payload spills to sessions/${run_id}/${seq}.json', async () => {
  const tmp = mkTmp();
  setEnvForTmp(tmp);
  const log = openSessionLog({ scope: 'global', cwd: tmp });
  const huge = 'z'.repeat(100 * 1024);
  log.prompt({ messages: [{ role: 'user', content: huge }] });
  await log.close();

  const file = await logFilePath();
  const raw = fs.readFileSync(file, 'utf8').trim();
  assert.ok(
    Buffer.byteLength(raw, 'utf8') <= 16 * 1024 + 256,
    `logged line must be <=16KB (+ small framing); got ${Buffer.byteLength(raw, 'utf8')}`,
  );

  const [line] = readLines(file);
  assert.ok(line, 'expected one line');
  assert.equal(line.truncated, true);
  assert.equal(typeof line.head, 'string');
  assert.equal(typeof line.tail, 'string');
  assert.equal(typeof line.spilled_to, 'string');
  assert.match(String(line.spilled_to), /^sessions\/[^/]+\/\d+\.json$/);

  // Spillover file should exist and contain the full original payload.
  const { pensmithDataDir } = await import('../bin/lib/paths.js');
  const spillFull = path.join(pensmithDataDir(), String(line.spilled_to));
  assert.ok(fs.existsSync(spillFull), `spillover file should exist at ${spillFull}`);
  const spilled = JSON.parse(fs.readFileSync(spillFull, 'utf8')) as Record<string, unknown>;
  assert.equal(spilled.kind, 'prompt');
  assert.equal(spilled.run_id, line.run_id);
  assert.ok(
    JSON.stringify(spilled.messages).length > 100 * 1024,
    'spilled file must contain the full original payload',
  );
});

test('D-52 setMirrorPromptsToStderr(true): kind:prompt mirrors to stderr; other kinds do not', async () => {
  const tmp = mkTmp();
  setEnvForTmp(tmp);
  const captured: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  // Stub stderr.write — we use `as unknown as typeof process.stderr.write` to
  // sidestep the overloaded signature; only `chunk` is exercised.
  const stub = ((chunk: unknown): boolean => {
    captured.push(String(chunk));
    return true;
  }) as unknown as typeof process.stderr.write;
  process.stderr.write = stub;
  try {
    setMirrorPromptsToStderr(true);
    const log = openSessionLog({ scope: 'global', cwd: tmp });
    log.prompt({ p: 'gen 1' });
    log.event({ note: 'should not mirror' });
    await log.close();
  } finally {
    setMirrorPromptsToStderr(false);
    process.stderr.write = original;
  }
  const all = captured.join('');
  assert.ok(all.includes('[prompt'), 'expected stderr to receive prompt mirror header');
  assert.ok(!all.includes('should not mirror'), 'event records must NOT mirror to stderr');
});

test('child bindings carry into every line; child shares parent run_id; bindings themselves redacted', async () => {
  const tmp = mkTmp();
  setEnvForTmp(tmp);
  const log = openSessionLog({ scope: 'global', cwd: tmp });
  const child = log.child({ requestId: 'req-1', authorization: 'Bearer leak' });
  log.event({ from: 'parent' });
  child.event({ from: 'child' });
  await log.close();

  const lines = readLines(await logFilePath());
  assert.equal(lines.length, 2);
  const [parentLine, childLine] = lines;
  assert.ok(parentLine && childLine, 'expected exactly two lines');
  assert.equal(parentLine.run_id, childLine.run_id, 'child must inherit run_id');
  assert.equal(childLine.requestId, 'req-1');
  assert.notEqual(childLine.authorization, 'Bearer leak');
});

test('logger swallows fs errors (close never rejects)', async () => {
  const tmp = mkTmp();
  setEnvForTmp(tmp);
  const { pensmithDataDir } = await import('../bin/lib/paths.js');
  const dataDir = pensmithDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  // Collide: pre-create a directory at the would-be log file path so any
  // attempt to open/append to session.log as a regular file fails (EISDIR
  // on POSIX, EPERM on Windows). The logger must swallow it.
  fs.mkdirSync(path.join(dataDir, 'session.log'), { recursive: true });
  const log = openSessionLog({ scope: 'global', cwd: tmp });
  log.event({ p: 'would-fail' });
  await assert.doesNotReject(log.close());
});
