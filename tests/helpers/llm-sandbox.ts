// tests/helpers/llm-sandbox.ts — an isolated paper + data dir + mock LLM for
// the Phase 17 llm-stream tests (RUN-06..RUN-26, CONF-01).
//
// Every test that exercises the model runtime runs inside one of these:
//   - a fresh temp paper root (with `.paper/`) that becomes the cwd, so
//     projectRoot() / paperDir() resolve into it;
//   - XDG_DATA_HOME / LOCALAPPDATA / HOME pointed at a temp data dir, so the
//     GLOBAL runtime.json, locks and session logs never touch the real data dir
//     (on macOS the data dir derives from HOME);
//   - optionally the RUN-21 mock LLM, with the global runtime.json pointing the
//     chosen provider's `endpoint` at it;
//   - every module-level runtime state reset (session id, cost-cap approval,
//     flag overrides, warnings, replay store, p90 samples).
// restore() puts the cwd and the environment back and closes the mock.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockLlm, type MockLlm, type MockLlmOptions } from './local-servers/mock-llm.js';
import { _resetSessionForTest, closeSessionLog } from '../../bin/lib/session-log.js';
import { _resetCostCapForTest } from '../../bin/lib/budget.js';
import { setRuntimeOverride } from '../../bin/lib/runtime.js';
import { _resetConfigWarningsForTest } from '../../bin/lib/config.js';
import { _resetModelWarningsForTest } from '../../bin/lib/llm-models.js';
import { _resetPriceWarningsForTest } from '../../bin/lib/pricing.js';
import { _resetSamplesForTest } from '../../bin/lib/estimator.js';
import { deactivateReplay } from '../../bin/lib/replay.js';
import { _resetBucketsForTest } from '../../bin/lib/http.js';
import { pensmithDataDir } from '../../bin/lib/paths.js';

const ENV_KEYS = [
  'XDG_DATA_HOME',
  'LOCALAPPDATA',
  'HOME',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'PENSMITH_NO_LLM',
  'PENSMITH_COST_CAP_USD',
  'PENSMITH_PROMPT_MODE',
  'PENSMITH_CONTACT_EMAIL',
  'PENSMITH_OFFLINE',
  'PENSMITH_NETWORK_TESTS',
  'LLM_TEST_API_KEY',
] as const;

export interface LlmSandbox {
  root: string;
  paper: string;
  dataDir: string;
  /** pensmithDataDir() inside the sandbox (where the global runtime.json lives). */
  pensmithData: string;
  mock: MockLlm | null;
  /** Write the global runtime.json (object is serialized as-is). */
  writeGlobalRuntime(obj: Record<string, unknown>): void;
  /** Write .paper/config.toml verbatim. */
  writePaperConfig(toml: string): void;
  /** An env object for spawned CLIs (data dirs + keys of this sandbox). */
  spawnEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv;
  /** Run the CLI from source (tsx) with cwd = the sandbox paper root (blocks: no in-process mock). */
  runCli(args: readonly string[], opts?: { env?: Record<string, string | undefined>; input?: string }): CliResult;
  /**
   * Run a TypeScript file (or the CLI when `script` is null) under tsx WITHOUT
   * blocking the event loop, so the in-process mock LLM can answer the child.
   */
  runTsx(script: string | null, args: readonly string[], opts?: { env?: Record<string, string | undefined>; input?: string }): Promise<CliResult>;
  restore(): Promise<void>;
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const PENSMITH_TS = fileURLToPath(new URL('../../bin/pensmith.ts', import.meta.url));
// Absolute loader URL: a bare `--import tsx` would resolve against the child's
// temp cwd, which has no node_modules.
const TSX_LOADER = import.meta.resolve('tsx');

export interface SandboxOptions {
  /** Start the mock LLM and point this provider's endpoint at it. */
  mock?: 'anthropic' | 'openai' | 'ollama' | 'vllm' | 'openai-compatible' | false;
  mockOptions?: MockLlmOptions;
  /** Extra global runtime.json fields. */
  runtime?: Record<string, unknown>;
  /** Env overrides (undefined deletes). */
  env?: Record<string, string | undefined>;
  /** Create .paper/ (default true). */
  paper?: boolean;
}

export function resetLlmModuleState(): void {
  _resetSessionForTest();
  _resetCostCapForTest();
  setRuntimeOverride({});
  _resetConfigWarningsForTest();
  _resetModelWarningsForTest();
  _resetPriceWarningsForTest();
  _resetSamplesForTest();
  deactivateReplay();
  _resetBucketsForTest();
}

export async function openLlmSandbox(opts: SandboxOptions = {}): Promise<LlmSandbox> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-llm-'));
  const root = path.join(base, 'paper');
  const dataDir = path.join(base, 'data');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const paper = path.join(root, '.paper');
  if (opts.paper !== false) fs.mkdirSync(paper, { recursive: true });

  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  const prevCwd = process.cwd();

  process.env['XDG_DATA_HOME'] = dataDir;
  process.env['LOCALAPPDATA'] = dataDir;
  process.env['HOME'] = dataDir;
  process.env['PENSMITH_CONTACT_EMAIL'] = 'test@example.org';
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'PENSMITH_NO_LLM', 'PENSMITH_COST_CAP_USD', 'PENSMITH_PROMPT_MODE', 'PENSMITH_OFFLINE', 'LLM_TEST_API_KEY']) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.chdir(root);
  resetLlmModuleState();

  // Resolved through paths.ts after the env is sandboxed (platform-correct).
  const pensmithData = pensmithDataDir();
  fs.mkdirSync(pensmithData, { recursive: true });
  const writeGlobalRuntime = (obj: Record<string, unknown>): void => {
    fs.writeFileSync(path.join(pensmithData, 'runtime.json'), JSON.stringify(obj, null, 2) + '\n');
  };

  let mock: MockLlm | null = null;
  if (opts.mock) {
    mock = await startMockLlm(opts.mockOptions ?? {});
    const endpoint = opts.mock === 'anthropic' ? mock.url : `${mock.url}/v1`;
    writeGlobalRuntime({ $schemaVersion: 2, provider: opts.mock, endpoint, ...(opts.runtime ?? {}) });
  } else if (opts.runtime) {
    writeGlobalRuntime({ $schemaVersion: 2, ...opts.runtime });
  }

  return {
    root,
    paper,
    dataDir,
    pensmithData,
    mock,
    writeGlobalRuntime,
    writePaperConfig(toml: string): void {
      fs.mkdirSync(paper, { recursive: true });
      fs.writeFileSync(path.join(paper, 'config.toml'), toml);
    },
    spawnEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: dataDir, LOCALAPPDATA: dataDir, HOME: dataDir };
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
      return env;
    },
    runTsx(script: string | null, args: readonly string[], o: { env?: Record<string, string | undefined>; input?: string } = {}): Promise<CliResult> {
      const env = childEnv(dataDir, o.env);
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', TSX_LOADER, script ?? PENSMITH_TS, ...args], {
          cwd: root,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
        child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
        child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
        child.stdin.end(o.input ?? '');
      });
    },
    runCli(args: readonly string[], o: { env?: Record<string, string | undefined>; input?: string } = {}): CliResult {
      const env = childEnv(dataDir, o.env);
      const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
        cwd: root,
        env,
        encoding: 'utf8',
        input: o.input ?? '',
        timeout: 120_000,
      });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
    async restore(): Promise<void> {
      process.chdir(prevCwd);
      if (mock) await mock.close();
      // Session-log records are written fire-and-forget (the CLI drains the
      // queue before it exits). Drain it here too: a write still in flight —
      // its mkdir/open already on the libuv pool — recreated a file inside the
      // sandbox while it was being removed (ENOTEMPTY on macOS / Node 24).
      await closeSessionLog();
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      resetLlmModuleState();
      await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

function childEnv(dataDir: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: dataDir, LOCALAPPDATA: dataDir, HOME: dataDir };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** Run `fn` inside a sandbox and always restore it. */
export async function withLlmSandbox<T>(opts: SandboxOptions, fn: (sb: LlmSandbox) => Promise<T>): Promise<T> {
  const sb = await openLlmSandbox(opts);
  try {
    return await fn(sb);
  } finally {
    await sb.restore();
  }
}

/** Read every JSONL record of a file (missing → []). */
export function readJsonl(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
}
