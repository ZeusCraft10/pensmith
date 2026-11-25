// tests/add-doi-single-fetch.test.ts — `pensmith add <doi>` reads the DOI's
// registry record once.
//
// fetchExactDoi reads GET api.crossref.org/works/<doi> and accepts the record
// only when its DOI is the one asked for. add used to send the same GET again
// through verifyDoi. With the HTTP cache unwritable (a full disk, a read-only
// data folder) that second request reached Crossref, and when it failed (a
// proxy 403, a flake) add printed "did not verify (added as unverified)" about a
// DOI it had just verified. Pass 1 re-checks every DOI at compile either way.
//
// Live mode against a MockAgent with net connect disabled: nothing here reaches
// the network. The agent is installed after http.ts has loaded, which http.ts
// uses as-is (dispatcherForRequest).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { addCommand } from '../bin/cli/add.js';
import { initState } from '../bin/lib/state.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';
import { withNetworkEnv } from './lib/net-harness.js';

interface AddRun {
  run: (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
}

const DOI = '10.1038/nphys1170';
const RECORD = {
  status: 'ok',
  message: {
    DOI,
    title: ['Measured measurement'],
    author: [{ family: 'Lvovsky', given: 'A. I.' }],
    issued: { 'date-parts': [[2009]] },
  },
};

/** Run `fn` with HOME, XDG_DATA_HOME and LOCALAPPDATA pointed at `dir`, restored afterwards. */
async function withDataHome<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const keys = ['HOME', 'XDG_DATA_HOME', 'LOCALAPPDATA'] as const;
  const saved = keys.map((k) => [k, process.env[k]] as const);
  for (const k of keys) process.env[k] = dir;
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('add <doi>: an exactly matched DOI is fetched once, with no false "did not verify" warning', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-add-once-'));
  await initState(root);

  await withDataHome(mkdtempSync(join(tmpdir(), 'pensmith-add-once-data-')), () =>
    withNetworkEnv({}, async () => {
      // The cache folder is a regular file, so every cache write fails and a
      // repeated GET goes to the registry instead of the cache.
      const cacheDir = pensmithHttpCacheDir();
      mkdirSync(dirname(cacheDir), { recursive: true });
      writeFileSync(cacheDir, 'not a folder');

      const agent = new MockAgent();
      agent.disableNetConnect();
      const gets: string[] = [];
      agent
        .get('https://api.crossref.org')
        .intercept({ path: (p: string) => p.startsWith('/works/'), method: 'GET' })
        .reply((opts) => {
          gets.push(opts.path);
          return gets.length === 1
            ? { statusCode: 200, data: JSON.stringify(RECORD), responseOptions: { headers: { 'content-type': 'application/json' } } }
            : { statusCode: 403, data: JSON.stringify({ status: 'error', message: 'forbidden' }) };
        })
        .persist();
      const prevDispatcher = getGlobalDispatcher();
      setGlobalDispatcher(agent);

      const out: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array): boolean => {
        out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as typeof process.stdout.write;
      const prevCwd = process.cwd();
      process.chdir(root);
      let result: unknown;
      let exitCode: typeof process.exitCode;
      try {
        result = await (addCommand as unknown as AddRun).run({ args: { source: DOI, yolo: true, remap: false } });
      } finally {
        process.chdir(prevCwd);
        process.stdout.write = origWrite;
        exitCode = process.exitCode;
        process.exitCode = undefined;
        setGlobalDispatcher(prevDispatcher);
        await agent.close();
      }

      const stdout = out.join('');
      assert.equal(gets.length, 1, `expected one Crossref GET, saw ${JSON.stringify(gets)}`);
      assert.doesNotMatch(stdout, /did not verify/, stdout);
      assert.deepEqual(result, { ok: true, citekey: 'lvovsky2009' }, stdout);
      assert.equal(exitCode ?? 0, 0, stdout);
      const bib = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
      assert.match(bib, /10\.1038\/nphys1170/i, 'the source is written to CITATIONS.bib');
    }),
  );
});
