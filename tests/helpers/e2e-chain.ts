// tests/helpers/e2e-chain.ts — the loop driver for the Phase 18 chain tests
// (GRND-18, GRND-19, D-18-28..31).
//
// openChainSandbox() gives a test one project folder, an isolated data dir and
// the RUN-21 mock LLM (tests/helpers/local-servers/mock-llm.ts) wired in as the
// model through the GLOBAL runtime.json of that data dir. Every run spawns the
// BUILT CLI (dist/bin/pensmith.js — run `npm run build` first) with:
//   - the project folder as its cwd, and XDG_DATA_HOME / LOCALAPPDATA / HOME
//     inside the sandbox (never the user's data dir; macOS derives it from HOME);
//   - the test context inherited, so sources are OFFLINE: every source request
//     replays an exact recorded fixture (tests/fixtures/cassettes/, including the
//     e2e corpus under cassettes/e2e/) or fails closed — no network;
//   - PENSMITH_NO_LLM removed, so every model call reaches the mock, which
//     answers with the contract stubs (or a scripted reply) and counts calls per
//     slug; a fake Anthropic key and a high cost cap (the --yolo pre-flight
//     prices real models even against the mock).
// The spawn is asynchronous: the mock lives in this test process and must keep
// answering while the child runs.
//
// The recorded e2e corpus (D-18-31) is loaded with loadE2eManifest() and
// applied with sandbox.applyCorpusScript(): the scripted replies of
// tests/fixtures/e2e-corpus/mock-script.json (intake-clarifier,
// topic-disambiguator, the source-evaluator keep-list); every other slug uses
// the contract stubs. The integration tests (tests/e2e-chain.test.ts,
// tests/dry-run-chain.test.ts) build on this module.

import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockLlm, type MockLlm, type MockLlmOptions, type MockReply } from './local-servers/mock-llm.js';
import { pensmithDataDir } from '../../bin/lib/paths.js';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const CLI_BIN = join(REPO, 'dist', 'bin', 'pensmith.js');
export const E2E_CORPUS_DIR = join(REPO, 'tests', 'fixtures', 'e2e-corpus');
export const E2E_MANIFEST_PATH = join(E2E_CORPUS_DIR, 'MANIFEST.json');

// ---------------------------------------------------------------------------
// The corpus manifest (tests/fixtures/e2e-corpus/MANIFEST.json)
// ---------------------------------------------------------------------------

export interface E2eKeptSource {
  readonly citekey: string;
  readonly doi: string;
  readonly title: string;
  readonly adapter: string;
}

export interface E2eExpectedMiss {
  readonly adapter: string;
  readonly query: string;
  readonly why: string;
}

export interface E2eManifest {
  readonly $schemaVersion: 1;
  readonly description: string;
  /** Repo-relative path of the assignment the chain starts from. */
  readonly assignment: string;
  readonly assignmentSha256: string;
  /** Repo-relative path of the scripted mock replies. */
  readonly mockScript: string;
  /** Repo-relative cassette root of the corpus (tests/fixtures/cassettes/e2e). */
  readonly cassetteRoot: string;
  readonly topic: string;
  readonly discipline: string;
  /** The research queries the scripted topic-disambiguator reply carries. */
  readonly queries: readonly string[];
  readonly adapters: {
    /** Adapters with at least one recorded cassette under cassetteRoot. */
    readonly recorded: readonly string[];
    /** (adapter, query) searches that miss offline, and why (e.g. over the 51200-byte cap, HTTP 429). */
    readonly expectedMiss: readonly E2eExpectedMiss[];
  };
  /** The evaluator keep-list: the sources the chain's library holds. */
  readonly keptSources: readonly E2eKeptSource[];
  readonly expectedSections: number;
  /** The most bare `pensmith --yolo` runs from the assignment to done: 5 + N. */
  readonly runBound: number;
  readonly recordedAt: string;
  readonly recorder: string;
  /** The cassette files the recorder wrote, repo-relative. */
  readonly cassettes: readonly string[];
}

/** One scripted reply per slug, consumed in order (MockReply shape). */
export type E2eMockScript = Readonly<Record<string, readonly MockReply[]>>;

export function loadE2eManifest(): E2eManifest {
  return JSON.parse(readFileSync(E2E_MANIFEST_PATH, 'utf8')) as E2eManifest;
}

export function loadE2eMockScript(manifest: E2eManifest = loadE2eManifest()): E2eMockScript {
  return JSON.parse(readFileSync(join(REPO, ...manifest.mockScript.split('/')), 'utf8')) as E2eMockScript;
}

// ---------------------------------------------------------------------------
// The sandbox
// ---------------------------------------------------------------------------

export interface ChainRun {
  readonly args: readonly string[];
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ChainRunOptions {
  /** Env overrides for this run (undefined deletes). */
  readonly env?: Record<string, string | undefined>;
  /** stdin text (default: an empty, closed stdin — never a terminal). */
  readonly input?: string;
  readonly timeoutMs?: number;
  /** The run's cwd (default: the sandbox's project folder). */
  readonly cwd?: string;
}

export interface ChainSandbox {
  /** Parent temp dir (removed by close()). */
  readonly base: string;
  /** The project folder: cwd of every run. */
  readonly root: string;
  /** The isolated data dir (XDG_DATA_HOME / LOCALAPPDATA / HOME). */
  readonly data: string;
  readonly mock: MockLlm;
  /** The env every run gets (before per-run overrides). */
  env(extra?: Record<string, string | undefined>): Record<string, string>;
  /** Run the built CLI once. */
  run(args: readonly string[], opts?: ChainRunOptions): Promise<ChainRun>;
  /**
   * Run the built CLI with `args` repeatedly — a user typing bare `pensmith
   * --yolo` again and again — until `until(run)` holds, a run exits non-zero,
   * or `maxRuns` runs. Returns every run.
   */
  loop(args: readonly string[], opts: { maxRuns: number; until: (run: ChainRun) => boolean } & ChainRunOptions): Promise<ChainRun[]>;
  /** Model calls the mock received for `slug` (every slug when omitted). */
  calls(slug?: string): number;
  /** Per-slug model call counts so far. */
  callCounts(): Record<string, number>;
  /** Script the mock with the e2e corpus replies (mock-script.json). */
  applyCorpusScript(): void;
  close(): Promise<void>;
}

export interface ChainSandboxOptions {
  readonly prefix?: string;
  /** Copy tests/fixtures/assignment.txt (true) or write this text as ./assignment.txt. */
  readonly assignment?: boolean | string;
  readonly mock?: MockLlmOptions;
  /** Env overrides for every run. */
  readonly env?: Record<string, string | undefined>;
}

/**
 * Keys a test's own environment must never leak into a spawned CLI.
 * PENSMITH_CONTACT_EMAIL too: a chain runs as CI runs it, with no polite-pool
 * email (Pass 3 cannot ask Unpaywall without one), even when the developer
 * exported one for the live lanes (CONTRIBUTING); a case that needs one sets
 * it through its own env (main-branch merge review, round 1).
 */
const DROPPED_ENV = new Set([
  'PENSMITH_CONTACT_EMAIL',
  'PENSMITH_PAPER_ROOT',
  'PENSMITH_PROMPT_MODE',
  'PENSMITH_DEBUG',
  'PENSMITH_NO_LLM',
  'PENSMITH_DRY_RUN',
  'PENSMITH_OFFLINE',
  'PENSMITH_COST_CAP_USD',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GPTZERO_API_KEY',
  'ORIGINALITY_API_KEY',
  'SAPLING_API_KEY',
]);

export async function openChainSandbox(opts: ChainSandboxOptions = {}): Promise<ChainSandbox> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), `pensmith-${opts.prefix ?? 'chain'}-`)));
  const root = join(base, 'project');
  const data = join(base, 'data');
  mkdirSync(root, { recursive: true });
  mkdirSync(data, { recursive: true });
  if (opts.assignment === true) copyFileSync(join(REPO, 'tests', 'fixtures', 'assignment.txt'), join(root, 'assignment.txt'));
  else if (typeof opts.assignment === 'string') writeFileSync(join(root, 'assignment.txt'), opts.assignment);

  const env = (extra: Record<string, string | undefined> = {}): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined || DROPPED_ENV.has(k)) continue;
      out[k] = v;
    }
    out['XDG_DATA_HOME'] = data;
    out['LOCALAPPDATA'] = data;
    out['HOME'] = data;
    // Windows reads the home (the humanizer skill, EXP-14) from USERPROFILE.
    out['USERPROFILE'] = data;
    out['ANTHROPIC_API_KEY'] = 'sk-test-e2e-chain-0001';
    out['PENSMITH_COST_CAP_USD'] = '1000';
    for (const [k, v] of Object.entries({ ...(opts.env ?? {}), ...extra })) {
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    return out;
  };

  const mock = await startMockLlm(opts.mock ?? {});
  // The GLOBAL runtime.json of the sandbox's data dir: the one place an LLM
  // endpoint may be set (D-17-19). Resolved with the child's own env so the
  // platform layout (XDG / LOCALAPPDATA / macOS Application Support) matches.
  const runtimeDir = pensmithDataDir(process.platform, env());
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'runtime.json'),
    JSON.stringify({ $schemaVersion: 2, provider: 'anthropic', endpoint: mock.url }, null, 2) + '\n',
  );

  const run = (args: readonly string[], o: ChainRunOptions = {}): Promise<ChainRun> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI_BIN, ...args], {
        cwd: o.cwd ?? root,
        env: env(o.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 180_000);
      child.stdout.setEncoding('utf8').on('data', (d: string) => {
        stdout += d;
      });
      child.stderr.setEncoding('utf8').on('data', (d: string) => {
        stderr += d;
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ args: [...args], status, stdout, stderr });
      });
      child.stdin.end(o.input ?? '');
    });

  const callCounts = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of mock.requests) {
      if (r.shape === 'models' || r.slug === null) continue;
      out[r.slug] = (out[r.slug] ?? 0) + 1;
    }
    return out;
  };

  return {
    base,
    root,
    data,
    mock,
    env,
    run,
    async loop(args, o) {
      const runs: ChainRun[] = [];
      for (let i = 0; i < o.maxRuns; i += 1) {
        const r = await run(args, o);
        runs.push(r);
        if (r.status !== 0 || o.until(r)) break;
      }
      return runs;
    },
    calls: (slug) => mock.callCount(slug),
    callCounts,
    applyCorpusScript() {
      for (const [slug, replies] of Object.entries(loadE2eMockScript())) mock.script(slug, ...replies);
    },
    async close() {
      await mock.close();
      rmSync(base, { recursive: true, force: true });
    },
  };
}
