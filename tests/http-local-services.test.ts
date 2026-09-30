// tests/http-local-services.test.ts — the two configured local services the
// egress gate may reach on loopback (SRC-15, SRC-16; D-19-21, D-19-24).
//
//   - FetchOptions.localService 'zotero-local' reaches exactly
//     http://127.0.0.1:23119, and only with PENSMITH_ZOTERO_LOCAL=1;
//   - 'grobid' reaches exactly the loopback origin of PENSMITH_GROBID_URL;
//   - any other origin, a redirect off the origin, a name that resolves off
//     loopback, link-local / metadata addresses: refused;
//   - without localService, the same loopback URL is refused as always;
//   - nothing but the environment enables either (a paper's config cannot).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMockAgent, type InstalledMockAgent } from './helpers/local-servers/mock-agent.js';
import { startHttpServer } from './helpers/local-servers/transport.js';
import {
  fetch as httpFetch,
  SsrfBlockedError,
  ZOTERO_LOCAL_ORIGIN,
  grobidOrigin,
  localServiceOrigin,
  __setHttpTestSeams,
  _resetHostStateForTest,
  type ResolvedAddress,
} from '../bin/lib/http.js';
import { CURRENT_CONFIG_VERSION } from '../bin/lib/config.js';
import { atomicWriteFile } from '../bin/lib/atomic-write.js';

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const all: Record<string, string | undefined> = { PENSMITH_NETWORK_TESTS: '1', PENSMITH_OFFLINE: undefined, ...vars };
  const saved = new Map(Object.keys(all).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(all)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetHostStateForTest();
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function withMock<T>(fn: (m: InstalledMockAgent) => Promise<T>): Promise<T> {
  const m = installMockAgent();
  try {
    return await fn(m);
  } finally {
    await m.restore();
  }
}

const refusedBy = (re: RegExp) => (e: unknown): boolean => {
  assert.ok(e instanceof SsrfBlockedError, String(e));
  assert.match(e.message, re);
  return true;
};

test('D-19-24: the Zotero local API is reachable only with PENSMITH_ZOTERO_LOCAL=1, at exactly http://127.0.0.1:23119', async () => {
  assert.equal(ZOTERO_LOCAL_ORIGIN, 'http://127.0.0.1:23119');
  await withMock(async (m) => {
    let hits = 0;
    m.agent.get(ZOTERO_LOCAL_ORIGIN).intercept({ path: /^\/api\//, method: 'GET' }).reply(() => {
      hits += 1;
      return { statusCode: 200, data: '[]', responseOptions: { headers: { 'content-type': 'application/json' } } };
    }).persist();
    await withEnv({ PENSMITH_ZOTERO_LOCAL: undefined }, async () => {
      assert.equal(localServiceOrigin('zotero-local'), null);
      await assert.rejects(
        () => httpFetch(`${ZOTERO_LOCAL_ORIGIN}/api/users/0/items/top`, { source: 'zotero', localService: 'zotero-local', noCache: true }),
        refusedBy(/zotero-local is not enabled — the Zotero local API is enabled only by PENSMITH_ZOTERO_LOCAL=1/),
      );
    });
    await withEnv({ PENSMITH_ZOTERO_LOCAL: '1' }, async () => {
      const res = await httpFetch(`${ZOTERO_LOCAL_ORIGIN}/api/users/0/items/top`, { source: 'zotero', localService: 'zotero-local', noCache: true });
      assert.equal(res.status, 200);
      await assert.rejects(
        () => httpFetch('http://127.0.0.1:23120/api/users/0/items/top', { source: 'zotero', localService: 'zotero-local', noCache: true }),
        refusedBy(/origin http:\/\/127\.0\.0\.1:23120 is not the enabled origin http:\/\/127\.0\.0\.1:23119/),
      );
      await assert.rejects(
        () => httpFetch(`${ZOTERO_LOCAL_ORIGIN}/api/users/0/items/top`, { source: 'zotero', noCache: true }),
        refusedBy(/private\/reserved IP 127\.0\.0\.1/),
        'without localService the loopback URL is refused as always',
      );
    });
    assert.equal(hits, 1, 'only the enabled, exact-origin request reached it');
  });
});

test('D-19-24: a paper config cannot enable a local service (environment only)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pensmith-local-svc-'));
  mkdirSync(join(cwd, '.paper'), { recursive: true });
  // Neither key exists in the config schema, and nothing reads the config for them.
  await atomicWriteFile(join(cwd, '.paper', 'config.toml'), `schema_version = ${CURRENT_CONFIG_VERSION}\n[sources]\nzotero_collection = "Thesis"\n`);
  const savedCwd = process.cwd();
  process.chdir(cwd);
  try {
    await withEnv({ PENSMITH_ZOTERO_LOCAL: undefined, PENSMITH_GROBID_URL: undefined }, async () => {
      assert.equal(localServiceOrigin('zotero-local'), null);
      assert.equal(localServiceOrigin('grobid'), null);
    });
  } finally {
    process.chdir(savedCwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('D-19-21: grobidOrigin accepts only loopback hosts', () => {
  assert.equal(grobidOrigin('http://127.0.0.1:8070'), 'http://127.0.0.1:8070');
  assert.equal(grobidOrigin('http://localhost:8070/grobid/'), 'http://localhost:8070');
  assert.equal(grobidOrigin('http://[::1]:8070'), 'http://[::1]:8070');
  assert.equal(grobidOrigin('https://grobid.example.org'), null, 'a remote server would receive the PDFs');
  assert.equal(grobidOrigin('http://10.0.0.5:8070'), null);
  assert.equal(grobidOrigin('http://169.254.169.254'), null);
  assert.equal(grobidOrigin('file:///tmp/grobid'), null);
  assert.equal(grobidOrigin('not a url'), null);
  assert.equal(grobidOrigin(''), null);
});

test('D-19-21: the GROBID origin is reached on loopback; another port and a redirect off the origin are refused', async () => {
  const other = await startHttpServer((_req, res) => {
    res.writeHead(200);
    res.end('should never be reached');
  });
  const grobid = await startHttpServer((req, res) => {
    if (req.url === '/api/isalive') {
      res.writeHead(200);
      res.end('true');
      return;
    }
    res.writeHead(302, { location: `http://127.0.0.1:${other.port}/steal` });
    res.end();
  });
  try {
    await withEnv({ PENSMITH_GROBID_URL: `http://127.0.0.1:${grobid.port}` }, async () => {
      const alive = await httpFetch(`http://127.0.0.1:${grobid.port}/api/isalive`, { source: 'generic', localService: 'grobid', noCache: true });
      assert.equal(alive.body, 'true');
      await assert.rejects(
        () => httpFetch(`http://127.0.0.1:${grobid.port}/api/redirect`, { source: 'generic', localService: 'grobid', noCache: true }),
        refusedBy(/is not the enabled origin/),
      );
      await assert.rejects(
        () => httpFetch(`http://127.0.0.1:${other.port}/x`, { source: 'generic', localService: 'grobid', noCache: true }),
        refusedBy(/is not the enabled origin/),
      );
    });
    assert.equal(other.requests.length, 0, 'the other loopback port is never reached');
  } finally {
    await grobid.close();
    await other.close();
  }
});

test('D-19-21: a local-service host that resolves to link-local / metadata or a public address is refused', async () => {
  await withMock(async () => {
    await withEnv({ PENSMITH_GROBID_URL: 'http://localhost:8070' }, async () => {
      for (const address of ['169.254.169.254', '203.0.113.9']) {
        __setHttpTestSeams({ resolve: async (): Promise<ResolvedAddress[]> => [{ address, family: 4 }] });
        try {
          await assert.rejects(
            () => httpFetch('http://localhost:8070/api/isalive', { source: 'generic', localService: 'grobid', noCache: true }),
            refusedBy(new RegExp(`resolves to ${address.replace(/\./g, '\\.')}, which is not a loopback address`)),
          );
        } finally {
          __setHttpTestSeams(null);
        }
      }
    });
  });
});
