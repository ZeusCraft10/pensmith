// tests/pdf-worker.test.ts — SEC-02 (D-19-22): pdf-parse runs in a
// worker_threads worker that is hard-terminated on timeout (closes WR-05).
//
//   - the one-shot settle guard (runPdfWorkerJob) on a virtual clock: a result
//     that arrives 1 ms before the timeout is returned (not discarded) and the
//     worker is terminated; a timeout terminates the worker — the termination
//     is awaited before the call rejects — and a late message is ignored;
//     errors and early exits reject after the same termination;
//   - a real hanging worker is terminated, activePdfWorkers() returns to 0 and
//     a process that hit the timeout exits on its own;
//   - worker stdout/stderr (pdf.js warnings) never reach the user;
//   - the worker entry resolves from source (tsx, .ts), from dist/ (.js) and
//     inside the committed plugin bundle (.mjs, PLUG-02), whose worker bundle
//     extracts a PDF and is still terminated on timeout.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  runPdfWorkerJob,
  extractPdf,
  extractPdfText,
  activePdfWorkers,
  pdfWorkerEntry,
  workerExecArgv,
  PdfTimeoutError,
  __setPdfWorkerTestSeam,
  type PdfWorkerLike,
  type WorkerJobTimers,
} from '../bin/lib/pdf-text.js';
import type { WorkerResult } from '../bin/lib/pdf-worker.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'byo', 'attention-arxiv-layout.pdf');
const IMAGE_ONLY = path.join(REPO, 'tests', 'fixtures', 'byo', 'image-only.pdf');

// ---------------------------------------------------------------------------
// The settle guard on a virtual clock.
// ---------------------------------------------------------------------------

/** A deterministic clock: callbacks run in time order when run() is called. */
class VirtualClock implements WorkerJobTimers {
  private now = 0;
  private seq = 0;
  private readonly queue: Array<{ at: number; seq: number; fn: () => void; cancelled: boolean }> = [];
  setTimeout(fn: () => void, ms: number): unknown {
    const item = { at: this.now + ms, seq: this.seq++, fn, cancelled: false };
    this.queue.push(item);
    return item;
  }
  clearTimeout(handle: unknown): void {
    (handle as { cancelled: boolean }).cancelled = true;
  }
  at(ms: number, fn: () => void): void {
    this.queue.push({ at: ms, seq: this.seq++, fn, cancelled: false });
  }
  run(): void {
    for (;;) {
      const next = this.queue.filter((q) => !q.cancelled).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) return;
      next.cancelled = true;
      this.now = next.at;
      next.fn();
    }
  }
}

class FakeWorker extends EventEmitter implements PdfWorkerLike {
  terminateCalls = 0;
  terminated = false;
  override on(event: string, fn: (...args: never[]) => void): this {
    return super.on(event, fn as (...args: unknown[]) => void);
  }
  async terminate(): Promise<number> {
    this.terminateCalls++;
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.terminated = true;
    return 1;
  }
}

const RESULT: WorkerResult = { text: '\n\nhello', pages: ['hello'], numpages: 1, info: {}, xmp: null };

test('SEC-02: a result that arrives 1 ms before the timeout is returned, and the worker is terminated', async () => {
  const clock = new VirtualClock();
  const w = new FakeWorker();
  const before = activePdfWorkers();
  const job = runPdfWorkerJob(w, 1000, clock);
  assert.equal(activePdfWorkers(), before + 1);
  clock.at(999, () => w.emit('message', { ok: true, result: RESULT }));
  clock.run();
  assert.deepEqual(await job, RESULT);
  assert.equal(w.terminateCalls, 1, 'terminated once after the result');
  assert.equal(w.terminated, true, 'the termination finished before the call resolved');
  assert.equal(activePdfWorkers(), before);
});

test('SEC-02: on timeout the worker is terminated (awaited) before the call rejects; a late message is ignored', async () => {
  const clock = new VirtualClock();
  const w = new FakeWorker();
  const before = activePdfWorkers();
  const job = runPdfWorkerJob(w, 1000, clock);
  let terminatedWhenRejected: boolean | null = null;
  const settled = job.then(
    () => assert.fail('a timed-out parse must not resolve'),
    (e: unknown) => {
      terminatedWhenRejected = w.terminated;
      return e;
    },
  );
  clock.at(1000, () => w.emit('message', { ok: true, result: RESULT })); // same instant, queued after the timeout
  clock.run();
  const err = await settled;
  assert.ok(err instanceof PdfTimeoutError);
  assert.match((err as Error).message, /timed out after 1000ms/);
  assert.equal(terminatedWhenRejected, true, 'terminate() completed before the rejection');
  assert.equal(w.terminateCalls, 1, 'the late message does not settle or terminate again');
  assert.equal(activePdfWorkers(), before);
});

test('SEC-02: a worker error and an early exit reject once, after the same termination', async () => {
  const clock = new VirtualClock();
  const w1 = new FakeWorker();
  const j1 = runPdfWorkerJob(w1, 1000, clock);
  clock.at(5, () => w1.emit('error', new Error('boom')));
  clock.at(6, () => w1.emit('message', { ok: true, result: RESULT }));
  clock.run();
  await assert.rejects(j1, /boom/);
  assert.equal(w1.terminateCalls, 1);

  const w2 = new FakeWorker();
  const j2 = runPdfWorkerJob(w2, 1000, clock, () => 'Warning: last diagnostic line');
  w2.emit('exit', 1);
  await assert.rejects(j2, /the PDF worker exited \(code 1\) before answering: Warning: last diagnostic line/);
  assert.equal(w2.terminateCalls, 0, 'an exited worker is not terminated again');

  const w3 = new FakeWorker();
  const j3 = runPdfWorkerJob(w3, 1000, clock);
  w3.emit('message', { ok: false, error: 'Invalid PDF structure' });
  await assert.rejects(j3, /Invalid PDF structure/);
});

// ---------------------------------------------------------------------------
// Real workers.
// ---------------------------------------------------------------------------

test('SEC-02: a hanging parse is terminated on timeout and the live worker count returns to 0', async () => {
  __setPdfWorkerTestSeam({ testHang: true });
  try {
    const started = Date.now();
    await assert.rejects(extractPdf(fs.readFileSync(FIXTURE), { timeoutMs: 400 }), (e: unknown) => e instanceof PdfTimeoutError);
    assert.ok(Date.now() - started < 10_000, 'the timeout fired');
    assert.equal(activePdfWorkers(), 0, 'no worker is left running');
  } finally {
    __setPdfWorkerTestSeam(null);
  }
});

test('SEC-02: a slow-but-finishing parse inside the limit returns its result', async () => {
  __setPdfWorkerTestSeam({ testDelayMs: 150 });
  try {
    const out = await extractPdf(fs.readFileSync(FIXTURE), { timeoutMs: 20_000 });
    assert.match(out.text, /Attention Is All You Need/);
    assert.equal(activePdfWorkers(), 0);
  } finally {
    __setPdfWorkerTestSeam(null);
  }
});

const TSX = import.meta.resolve('tsx');

function runChild(script: string): { status: number | null; stdout: string; stderr: string; ms: number } {
  const started = Date.now();
  const r = spawnSync(process.execPath, ['--import', TSX, '--input-type=module', '-e', script], {
    cwd: REPO,
    env: { ...process.env, PENSMITH_TEST: '1' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: Date.now() - started };
}

test('SEC-02: a process whose parse timed out exits on its own (the spinning worker was killed)', () => {
  const mod = pathToFileURL(path.join(REPO, 'bin', 'lib', 'pdf-text.ts')).href;
  const r = runChild(
    `import * as fs from 'node:fs';\n` +
      `const m = await import(${JSON.stringify(mod)});\n` +
      `m.__setPdfWorkerTestSeam({ testHang: true });\n` +
      `try { await m.extractPdf(fs.readFileSync(${JSON.stringify(FIXTURE)}), { timeoutMs: 300 }); console.log('no-timeout'); }\n` +
      `catch (e) { console.log(e.name, m.activePdfWorkers()); }\n`,
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'PdfTimeoutError 0');
  assert.ok(r.ms < 30_000, `the process exited (took ${r.ms} ms)`);
});

test('SEC-02: the worker\'s stdout/stderr (pdf.js warnings) never reach the terminal', () => {
  const mod = pathToFileURL(path.join(REPO, 'bin', 'lib', 'pdf-text.ts')).href;
  const r = runChild(
    `import * as fs from 'node:fs';\n` +
      `const m = await import(${JSON.stringify(mod)});\n` +
      `m.__setPdfWorkerTestSeam({ testNoise: true });\n` +
      `const out = await m.extractPdf(fs.readFileSync(${JSON.stringify(FIXTURE)}));\n` +
      `console.log(out.engine, out.numpages);\n`,
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'pdf-parse 1');
  assert.doesNotMatch(r.stdout + r.stderr, /pensmith-worker-noise/);
});

test('SEC-02: the test seam is refused outside a test context', () => {
  const mod = pathToFileURL(path.join(REPO, 'bin', 'lib', 'pdf-text.ts')).href;
  const env = { ...process.env };
  delete env['PENSMITH_TEST'];
  delete env['NODE_TEST_CONTEXT'];
  // No test context: redirect every platform's data dir (HOME on macOS) so the
  // child can never resolve the real one (CI-09).
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-worker-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'XDG_DATA_HOME', 'LOCALAPPDATA']) env[k] = home;
  const r = spawnSync(
    process.execPath,
    ['--import', TSX, '--input-type=module', '-e', `const m = await import(${JSON.stringify(mod)}); try { m.__setPdfWorkerTestSeam({ testHang: true }); console.log('accepted'); } catch { console.log('refused'); }`],
    { cwd: REPO, env, encoding: 'utf8', timeout: 60_000 },
  );
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(r.stdout.trim(), 'refused', r.stderr);
});

test('SEC-02: the worker never inherits the parent\'s execArgv; a .ts entry gets exactly an absolute tsx loader', () => {
  assert.deepEqual(workerExecArgv(path.join('x', 'pdf-worker.js')), [], 'dist needs no option');
  const ts = workerExecArgv(path.join('x', 'pdf-worker.ts'));
  assert.equal(ts.length, 2);
  assert.equal(ts[0], '--import');
  assert.match(ts[1] ?? '', /^file:\/\/.*tsx/, 'resolved to an absolute URL, so a changed cwd cannot break it');
});

test('SEC-02: extraction works after the process changed directory (a bare `--import tsx` would not resolve)', async () => {
  const prev = process.cwd();
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-worker-cwd-')));
  try {
    const out = await extractPdf(fs.readFileSync(FIXTURE));
    assert.equal(out.engine, 'pdf-parse');
  } finally {
    process.chdir(prev);
  }
});

test('SEC-02: the worker entry resolves from source (tsx, .ts) and parses', async () => {
  assert.ok(pdfWorkerEntry().endsWith(path.join('bin', 'lib', 'pdf-worker.ts')), pdfWorkerEntry());
  const out = await extractPdf(fs.readFileSync(FIXTURE));
  assert.equal(out.engine, 'pdf-parse');
  assert.match(out.pages[0] ?? '', /Attention Is All You Need/);
  assert.match(out.text, /arXiv:1706\.03762v7/);
});

test('SEC-02: the worker entry resolves from dist/ (.js) and parses (run `npm run build` first)', () => {
  const dist = path.join(REPO, 'dist', 'bin', 'lib', 'pdf-text.js');
  assert.ok(fs.existsSync(dist), 'dist/ is missing — run `npm run build` before this test');
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import * as fs from 'node:fs';\n` +
        `const m = await import(${JSON.stringify(pathToFileURL(dist).href)});\n` +
        `const out = await m.extractPdf(fs.readFileSync(${JSON.stringify(FIXTURE)}));\n` +
        `console.log(JSON.stringify({ entry: m.pdfWorkerEntry(), title: /Attention Is All You Need/.test(out.text), workers: m.activePdfWorkers() }));\n`,
    ],
    { cwd: REPO, env: { ...process.env, PENSMITH_TEST: '1' }, encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim()) as { entry: string; title: boolean; workers: number };
  assert.equal(got.entry, path.join(REPO, 'dist', 'bin', 'lib', 'pdf-worker.js'));
  assert.equal(got.title, true);
  assert.equal(got.workers, 0);
});

// ---------------------------------------------------------------------------
// The plugin bundle layout (PLUG-02): pdf-text.ts is inlined into
// plugin/dist/mcp/server.mjs and starts plugin/dist/mcp/pdf-worker.mjs.
// ---------------------------------------------------------------------------

const BUNDLED_WORKER = path.join(REPO, 'plugin', 'dist', 'mcp', 'pdf-worker.mjs');

test('SEC-02 / PLUG-02: inside a bundle the worker entry is the pdf-worker.mjs beside it', () => {
  const server = path.join(REPO, 'plugin', 'dist', 'mcp', 'server.mjs');
  assert.equal(pdfWorkerEntry(server), BUNDLED_WORKER);
  assert.equal(pdfWorkerEntry(path.join('x', 'bin', 'lib', 'pdf-text.js')), path.join('x', 'bin', 'lib', 'pdf-worker.js'));
  assert.equal(pdfWorkerEntry(path.join('x', 'bin', 'lib', 'pdf-text.ts')), path.join('x', 'bin', 'lib', 'pdf-worker.ts'));
  assert.deepEqual(workerExecArgv(BUNDLED_WORKER), [], 'the bundle needs no loader');
});

/** Run the bundled worker through the same settle guard pdf-text.ts uses. */
function runBundledWorker(data: Record<string, unknown>, timeoutMs: number): { job: Promise<WorkerResult>; worker: Worker } {
  const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
  const worker = new Worker(BUNDLED_WORKER, { workerData: { bytes, ...data }, transferList: [bytes.buffer], stdout: true, stderr: true });
  worker.stdout.resume();
  worker.stderr.resume();
  const timers: WorkerJobTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };
  return { job: runPdfWorkerJob(worker, timeoutMs, timers), worker };
}

test('SEC-02 / PLUG-02: the bundled worker (plugin/dist/mcp/pdf-worker.mjs) extracts a fixture PDF', async () => {
  assert.ok(fs.existsSync(BUNDLED_WORKER), 'plugin/dist/mcp/pdf-worker.mjs is missing — run `npm run bundle`');
  const { job } = runBundledWorker({}, 30_000);
  const out = await job;
  assert.equal(out.numpages, 1);
  assert.match(out.pages[0] ?? '', /Attention Is All You Need/);
  assert.match(out.text, /arXiv:1706\.03762v7/);
  assert.equal(activePdfWorkers(), 0);
});

test('SEC-02 / PLUG-02: a hanging bundled worker is terminated on timeout', async () => {
  const { job, worker } = runBundledWorker({ testHang: true }, 400);
  let exitCode: number | null = null;
  worker.once('exit', (code) => {
    exitCode = code;
  });
  const started = Date.now();
  await assert.rejects(job, (e: unknown) => e instanceof PdfTimeoutError);
  assert.ok(Date.now() - started < 10_000, 'the timeout fired');
  assert.equal(activePdfWorkers(), 0, 'no worker is left running');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.notEqual(exitCode, null, 'the spinning worker thread exited (terminated)');
  assert.equal(worker.threadId, -1, 'the thread is gone');
});

// ---------------------------------------------------------------------------
// extractPdf / extractPdfText contracts.
// ---------------------------------------------------------------------------

test('SEC-02: .planning/SECURITY.md records row 9 (PDF OOM / hang) as PROVEN, the WR-05 residual closed', () => {
  const sec = fs.readFileSync(path.join(REPO, '.planning', 'SECURITY.md'), 'utf8');
  const row = sec.split('\n').find((l) => l.startsWith('| 9 |'));
  assert.ok(row, 'SECURITY.md has a row 9');
  assert.match(row, /\*\*PROVEN\*\* \(SEC-02, Phase 19\)/);
  assert.match(row, /worker\.terminate\(\)/);
  assert.doesNotMatch(row, /PROVEN-with-residual/);
});

test('SEC-02: extractPdf returns text, pages, numpages, info and xmp; an image-only PDF is imageOnly', async () => {
  const out = await extractPdf(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'byo', 'metadata-doi.pdf')));
  assert.equal(out.imageOnly, false);
  assert.equal(out.numpages, 1);
  assert.equal(out.info['Title'], 'Deep learning');
  assert.match(String(out.info['Subject']), /doi:10\.1038\/nature14539/);
  const scan = await extractPdf(fs.readFileSync(IMAGE_ONLY));
  assert.equal(scan.imageOnly, true);
  assert.equal(scan.text.trim(), '');
});

test('SEC-02: extractPdfText keeps its contract — bytes only, the WARN on an image-only PDF, a rejection for a broken one', async (t) => {
  await assert.rejects(extractPdfText('/etc/passwd' as unknown as Buffer), TypeError);
  const warn = t.mock.method(console, 'warn', () => undefined);
  const text = await extractPdfText(fs.readFileSync(IMAGE_ONLY));
  assert.equal(text.trim(), '');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /image-only or scanned/);
  const prev = process.env['PENSMITH_PYTHON'];
  process.env['PENSMITH_PYTHON'] = path.join(REPO, 'no-such-python');
  try {
    await assert.rejects(extractPdfText(Buffer.from('%PDF-1.4\nnot really a pdf\n')));
  } finally {
    if (prev === undefined) delete process.env['PENSMITH_PYTHON'];
    else process.env['PENSMITH_PYTHON'] = prev;
  }
});
