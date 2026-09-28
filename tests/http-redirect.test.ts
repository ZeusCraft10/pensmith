// tests/http-redirect.test.ts — SRC-01 (D-19-06): http.ts follows redirects in
// its own loop, and every hop is a fresh request through the egress gate.
//
//   - 301 → 302 → 200 application/pdf returns the final bytes (finalUrl set);
//   - a redirect to 127.0.0.1 or to 169.254.169.254 is refused at the hop's
//     SSRF check — the target receives 0 requests;
//   - five redirects are followed, a sixth is `too many redirects`;
//   - Authorization / x-api-key / Zotero-API-Key / Cookie never reach another
//     origin (and still reach a same-origin hop);
//   - https → http, a loop and a missing Location are refused;
//   - 303 turns into a GET; a POST's 3xx is returned as-is; a model request's
//     3xx is an error;
//   - every hop gets its own --show-prompts line and kind:"http" record, and the
//     final answer is cached under the ORIGINAL URL.
//
// MockAgent (the V5 local-servers seam) answers every hop; no socket is opened.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMockAgent, type InstalledMockAgent } from './helpers/local-servers/mock-agent.js';
import {
  fetch as httpFetch,
  RedirectError,
  SsrfBlockedError,
  MAX_REDIRECTS,
  _resetHostStateForTest,
  _resetHttpLoggersForTest,
  _resetWarnedForTest,
} from '../bin/lib/http.js';
import { closeSessionLog, setMirrorPromptsToStderr } from '../bin/lib/session-log.js';
import { _resetContactEmailForTest } from '../bin/lib/contact-email.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from([0xff, 0x00, 0x80, 0xfe, 0x89, 0x0a]), Buffer.from('%%EOF\n')]);

interface Lane {
  readonly m: InstalledMockAgent;
  readonly cwd: string;
}

/** The live test lane with a MockAgent, a fresh data dir and a paper cwd (for SESSION.log). */
async function lane<T>(fn: (l: Lane) => Promise<T>, env: Record<string, string | undefined> = {}): Promise<T> {
  const data = mkdtempSync(join(tmpdir(), 'pensmith-redirect-data-'));
  const cwd = mkdtempSync(join(tmpdir(), 'pensmith-redirect-cwd-'));
  mkdirSync(join(cwd, '.paper'), { recursive: true });
  const vars: Record<string, string | undefined> = {
    PENSMITH_NETWORK_TESTS: '1',
    PENSMITH_OFFLINE: undefined,
    LOCALAPPDATA: data,
    XDG_DATA_HOME: data,
    HOME: data,
    PENSMITH_CONTACT_EMAIL: 'pensmith-dev@example.org',
    ...env,
  };
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  const savedCwd = process.cwd();
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.chdir(cwd);
  _resetHostStateForTest();
  _resetHttpLoggersForTest();
  _resetWarnedForTest();
  _resetContactEmailForTest();
  const m = installMockAgent();
  try {
    return await fn({ m, cwd });
  } finally {
    await m.restore().catch(() => undefined);
    await closeSessionLog();
    _resetHttpLoggersForTest();
    process.chdir(savedCwd);
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(data, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

function header(opts: { headers?: unknown }, name: string): string | undefined {
  const h = (opts.headers ?? {}) as Record<string, string>;
  return Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
}

async function httpRecords(cwd: string): Promise<Array<{ url: string; status: number | null; cache: string; method: string }>> {
  await closeSessionLog();
  const file = join(cwd, '.paper', 'SESSION.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { kind: string; url: string; status: number | null; cache: string; method: string })
    .filter((r) => r.kind === 'http');
}

test('SRC-01: 301 → 302 → 200 application/pdf returns the final bytes, with one record per hop', async () => {
  await lane(async ({ m, cwd }) => {
    const a = m.agent.get('http://www.example-publisher.org');
    const b = m.agent.get('https://www.example-publisher.org');
    const c = m.agent.get('https://cdn.example-files.net');
    a.intercept({ path: '/paper.pdf', method: 'GET' }).reply(301, '', { headers: { location: 'https://www.example-publisher.org/paper.pdf' } });
    b.intercept({ path: '/paper.pdf', method: 'GET' }).reply(302, '', { headers: { location: 'https://cdn.example-files.net/files/paper.pdf?sig=abc' } });
    c.intercept({ path: '/files/paper.pdf?sig=abc', method: 'GET' }).reply(200, PDF, { headers: { 'content-type': 'application/pdf' } });

    const res = await httpFetch('http://www.example-publisher.org/paper.pdf', { source: 'generic', noCache: true, headers: { accept: 'application/pdf' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.ok(res.bodyBytes && res.bodyBytes.equals(PDF), 'the final bytes, byte-faithful');
    assert.equal(res.finalUrl, 'https://cdn.example-files.net/files/paper.pdf?sig=abc');
    assert.deepEqual(m.agent.pendingInterceptors(), []);

    const recs = await httpRecords(cwd);
    assert.deepEqual(
      recs.map((r) => [r.url, r.status, r.cache]),
      [
        ['http://www.example-publisher.org/paper.pdf', 301, 'miss'],
        ['https://www.example-publisher.org/paper.pdf', 302, 'miss'],
        ['https://cdn.example-files.net/files/paper.pdf?sig=abc', 200, 'miss'],
      ],
      'each hop has its own kind:"http" record',
    );
  });
});

test('SRC-01: a redirect to 127.0.0.1 is refused at the hop — the loopback target receives 0 requests', async () => {
  await lane(async ({ m }) => {
    let reached = 0;
    m.agent.get('https://api.example.org').intercept({ path: '/start', method: 'GET' }).reply(302, '', { headers: { location: 'https://127.0.0.1:8443/admin' } });
    m.agent.get('https://127.0.0.1:8443').intercept({ path: '/admin', method: 'GET' }).reply(() => {
      reached += 1;
      return { statusCode: 200, data: 'secret' };
    });
    await assert.rejects(
      () => httpFetch('https://api.example.org/start', { source: 'generic', noCache: true }),
      (e: unknown) => {
        assert.ok(e instanceof SsrfBlockedError, String(e));
        assert.match(e.message, /127\.0\.0\.1/);
        return true;
      },
    );
    assert.equal(reached, 0, 'the loopback target is never asked');
    assert.equal(m.agent.pendingInterceptors().length, 1, 'its interceptor is still pending');
  });
});

test('SRC-01: a redirect to the cloud metadata address 169.254.169.254 is refused — 0 requests reach it', async () => {
  await lane(async ({ m }) => {
    let reached = 0;
    m.agent.get('http://api.example.org').intercept({ path: '/start', method: 'GET' }).reply(307, '', { headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    m.agent.get('http://169.254.169.254').intercept({ path: '/latest/meta-data/', method: 'GET' }).reply(() => {
      reached += 1;
      return { statusCode: 200, data: 'iam' };
    });
    await assert.rejects(
      () => httpFetch('http://api.example.org/start', { source: 'generic', noCache: true }),
      (e: unknown) => {
        assert.ok(e instanceof SsrfBlockedError, String(e));
        assert.match(e.message, /169\.254\.169\.254/);
        return true;
      },
    );
    assert.equal(reached, 0);
  });
});

function chain(m: InstalledMockAgent, hops: number): void {
  const pool = m.agent.get('https://hops.example.org');
  for (let i = 0; i < hops; i += 1) {
    pool.intercept({ path: `/r${i}`, method: 'GET' }).reply(302, '', { headers: { location: `/r${i + 1}` } });
  }
  pool.intercept({ path: `/r${hops}`, method: 'GET' }).reply(200, { done: hops }, { headers: { 'content-type': 'application/json' } });
}

test(`SRC-01: ${MAX_REDIRECTS} redirects are followed (relative Location resolved against the hop)`, async () => {
  await lane(async ({ m }) => {
    chain(m, MAX_REDIRECTS);
    const res = await httpFetch('https://hops.example.org/r0', { source: 'generic', noCache: true });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { done: MAX_REDIRECTS });
    assert.equal(res.finalUrl, `https://hops.example.org/r${MAX_REDIRECTS}`);
  });
});

test('SRC-01: a 6-hop chain errors `too many redirects` and never reaches the end', async () => {
  await lane(async ({ m }) => {
    chain(m, MAX_REDIRECTS + 1);
    await assert.rejects(
      () => httpFetch('https://hops.example.org/r0', { source: 'generic', noCache: true }),
      (e: unknown) => {
        assert.ok(e instanceof RedirectError, String(e));
        assert.equal(e.kind, 'too-many');
        assert.match(e.message, /^too many redirects: /);
        return true;
      },
    );
    const pending = m.agent.pendingInterceptors().map((p) => p.path);
    assert.deepEqual(pending, [`/r${MAX_REDIRECTS + 1}`], 'the end of the chain is never requested');
  });
});

test('SRC-01: credentials never cross origins — Authorization, x-api-key, Zotero-API-Key and Cookie are dropped on the cross-origin hop', async () => {
  await lane(async ({ m }) => {
    const seen: Array<Record<string, string | undefined>> = [];
    const capture = (opts: { headers?: unknown }): void => {
      seen.push({
        authorization: header(opts, 'authorization'),
        'x-api-key': header(opts, 'x-api-key'),
        'zotero-api-key': header(opts, 'zotero-api-key'),
        cookie: header(opts, 'cookie'),
        accept: header(opts, 'accept'),
      });
    };
    m.agent.get('https://api.example.org').intercept({ path: '/a', method: 'GET' }).reply((opts) => {
      capture(opts);
      return { statusCode: 302, data: '', responseOptions: { headers: { location: '/b' } } };
    });
    m.agent.get('https://api.example.org').intercept({ path: '/b', method: 'GET' }).reply((opts) => {
      capture(opts);
      return { statusCode: 302, data: '', responseOptions: { headers: { location: 'https://elsewhere.example.net/c' } } };
    });
    m.agent.get('https://elsewhere.example.net').intercept({ path: '/c', method: 'GET' }).reply((opts) => {
      capture(opts);
      return { statusCode: 200, data: '{"ok":true}', responseOptions: { headers: { 'content-type': 'application/json' } } };
    });
    const res = await httpFetch('https://api.example.org/a', {
      source: 'generic',
      noCache: true,
      headers: { authorization: 'Bearer SECRET-TOKEN-1', 'x-api-key': 'SECRET-KEY-2', 'Zotero-API-Key': 'SECRET-ZOTERO-3', cookie: 'sid=SECRET-4' },
    });
    assert.equal(res.status, 200);
    assert.equal(seen.length, 3);
    assert.equal(seen[0]?.authorization, 'Bearer SECRET-TOKEN-1', 'the first hop carries the credentials');
    assert.equal(seen[1]?.['x-api-key'], 'SECRET-KEY-2', 'a same-origin hop keeps them');
    assert.deepEqual(
      { ...seen[2], accept: undefined },
      { authorization: undefined, 'x-api-key': undefined, 'zotero-api-key': undefined, cookie: undefined, accept: undefined },
      'the cross-origin hop carries none of them',
    );
    assert.equal(seen[2]?.accept, 'application/json', 'ordinary headers still go');
  });
});

test('SRC-01: the contact email stays with the polite service — a hop to another origin gets the plain User-Agent', async () => {
  await lane(async ({ m }) => {
    const uas: string[] = [];
    m.agent.get('https://api.unpaywall.org').intercept({ path: '/v2/10.1%2Fx', method: 'GET' }).reply((opts) => {
      uas.push(header(opts, 'user-agent') ?? '');
      return { statusCode: 301, data: '', responseOptions: { headers: { location: 'https://oa.example.net/x' } } };
    });
    m.agent.get('https://oa.example.net').intercept({ path: '/x', method: 'GET' }).reply((opts) => {
      uas.push(header(opts, 'user-agent') ?? '');
      return { statusCode: 200, data: '{}' };
    });
    await httpFetch('https://api.unpaywall.org/v2/10.1%2Fx', { source: 'unpaywall', noCache: true });
    assert.match(uas[0] ?? '', /^pensmith\/\S+ \(mailto:pensmith-dev@example\.org\)$/);
    assert.match(uas[1] ?? '', /^pensmith\/\S+$/, 'no contact email off the polite origin');
  });
});

test('SRC-01: https → http is refused (downgrade); http → https is followed', async () => {
  await lane(async ({ m }) => {
    m.agent.get('https://secure.example.org').intercept({ path: '/x', method: 'GET' }).reply(301, '', { headers: { location: 'http://secure.example.org/x' } });
    await assert.rejects(
      () => httpFetch('https://secure.example.org/x', { source: 'generic', noCache: true }),
      (e: unknown) => e instanceof RedirectError && e.kind === 'downgrade' && /redirect refused: .*https to http/.test(e.message),
    );
    m.agent.get('http://plain.example.org').intercept({ path: '/y', method: 'GET' }).reply(301, '', { headers: { location: 'https://plain.example.org/y' } });
    m.agent.get('https://plain.example.org').intercept({ path: '/y', method: 'GET' }).reply(200, 'ok');
    const res = await httpFetch('http://plain.example.org/y', { source: 'generic', noCache: true });
    assert.equal(res.status, 200);
    assert.equal(res.finalUrl, 'https://plain.example.org/y');
  });
});

test('SRC-01: a redirect loop is refused', async () => {
  await lane(async ({ m }) => {
    const pool = m.agent.get('https://loop.example.org');
    pool.intercept({ path: '/a', method: 'GET' }).reply(302, '', { headers: { location: '/b' } });
    pool.intercept({ path: '/b', method: 'GET' }).reply(302, '', { headers: { location: 'https://loop.example.org/a#frag' } });
    await assert.rejects(
      () => httpFetch('https://loop.example.org/a', { source: 'generic', noCache: true }),
      (e: unknown) => e instanceof RedirectError && e.kind === 'loop' && /redirect loop/.test(e.message),
    );
  });
});

test('SRC-01: a 3xx without a Location is refused (no-location)', async () => {
  await lane(async ({ m }) => {
    m.agent.get('https://api.example.org').intercept({ path: '/n', method: 'GET' }).reply(302, '');
    await assert.rejects(
      () => httpFetch('https://api.example.org/n', { source: 'generic', noCache: true }),
      (e: unknown) => e instanceof RedirectError && e.kind === 'no-location',
    );
  });
});

test('SRC-01: a redirect to a non-http(s) scheme is refused by the scheme allowlist', async () => {
  await lane(async ({ m }) => {
    m.agent.get('https://api.example.org').intercept({ path: '/f', method: 'GET' }).reply(302, '', { headers: { location: 'file:///etc/passwd' } });
    await assert.rejects(
      () => httpFetch('https://api.example.org/f', { source: 'generic', noCache: true }),
      (e: unknown) => e instanceof SsrfBlockedError && /scheme "file:" not allowed/.test(e.message),
    );
  });
});

test('SRC-01: 303 See Other continues as a GET; HEAD stays HEAD through 301', async () => {
  await lane(async ({ m }) => {
    const methods: string[] = [];
    const pool = m.agent.get('https://api.example.org');
    pool.intercept({ path: '/see', method: 'GET' }).reply(303, '', { headers: { location: '/other' } });
    pool.intercept({ path: '/other', method: 'GET' }).reply((opts) => {
      methods.push(opts.method);
      return { statusCode: 200, data: 'other' };
    });
    const res = await httpFetch('https://api.example.org/see', { source: 'generic', noCache: true });
    assert.equal(res.body, 'other');
    assert.deepEqual(methods, ['GET']);

    pool.intercept({ path: '/head', method: 'HEAD' }).reply(301, '', { headers: { location: '/head2' } });
    pool.intercept({ path: '/head2', method: 'HEAD' }).reply(200, '');
    const head = await httpFetch('https://api.example.org/head', { method: 'HEAD', source: 'generic', noCache: true });
    assert.equal(head.status, 200);
    assert.equal(head.finalUrl, 'https://api.example.org/head2');
  });
});

test('SRC-01: a POST is never redirected — its 3xx is returned as-is', async () => {
  await lane(async ({ m }) => {
    m.agent.get('https://api.example.org').intercept({ path: '/submit', method: 'POST' }).reply(302, '', { headers: { location: 'https://elsewhere.example.net/' } });
    const res = await httpFetch('https://api.example.org/submit', { method: 'POST', body: '{}', source: 'generic', noRetry: true });
    assert.equal(res.status, 302);
    assert.equal(res.finalUrl, undefined);
    assert.deepEqual(m.agent.pendingInterceptors(), []);
  });
});

test('SRC-01: a model request never follows a redirect — the 3xx is an error', async () => {
  await lane(async ({ m }) => {
    let reached = 0;
    m.agent.get('https://llm.example.org').intercept({ path: '/v1/messages', method: 'POST' }).reply(307, '', { headers: { location: 'https://evil.example.net/v1/messages' } });
    m.agent.get('https://evil.example.net').intercept({ path: '/v1/messages', method: 'POST' }).reply(() => {
      reached += 1;
      return { statusCode: 200, data: '{}' };
    });
    await assert.rejects(
      () => httpFetch('https://llm.example.org/v1/messages', { method: 'POST', body: '{}', noCache: true, noRetry: true, llm: { endpoint: 'https://llm.example.org' } }),
      (e: unknown) => e instanceof RedirectError && e.kind === 'not-followed',
    );
    assert.equal(reached, 0);
  });
});

test('SRC-01: the final answer is cached under the ORIGINAL URL — a repeat is a cache hit with no request', async () => {
  await lane(async ({ m }) => {
    const pool = m.agent.get('https://api.crossref.org');
    pool.intercept({ path: '/works/10.1%2Fmoved', method: 'GET' }).reply(301, '', { headers: { location: '/works/10.1%2Fhere' } });
    pool.intercept({ path: '/works/10.1%2Fhere', method: 'GET' }).reply(200, { status: 'ok', 'message-type': 'work', message: { DOI: '10.1/here' } }, { headers: { 'content-type': 'application/json' } });
    const first = await httpFetch('https://api.crossref.org/works/10.1%2Fmoved', { source: 'crossref' });
    assert.equal(first.status, 200);
    assert.equal(first.cached, false);
    const second = await httpFetch('https://api.crossref.org/works/10.1%2Fmoved', { source: 'crossref' });
    assert.equal(second.cached, true, 'served from the cache');
    assert.equal(JSON.parse(second.body).message.DOI, '10.1/here');
    assert.deepEqual(m.agent.pendingInterceptors(), [], 'no extra request was made');
  });
});

test('SRC-01: --show-prompts prints one line per hop, before each hop is sent', async () => {
  await lane(async ({ m }) => {
    m.agent.get('https://api.example.org').intercept({ path: '/one', method: 'GET' }).reply(302, '', { headers: { location: 'https://files.example.net/two' } });
    m.agent.get('https://files.example.net').intercept({ path: '/two', method: 'GET' }).reply(200, 'x');
    const original = process.stderr.write.bind(process.stderr);
    let err = '';
    process.stderr.write = ((c: string | Uint8Array): boolean => {
      err += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
      return true;
    }) as typeof process.stderr.write;
    setMirrorPromptsToStderr(true);
    try {
      await httpFetch('https://api.example.org/one', { source: 'generic', noCache: true });
    } finally {
      setMirrorPromptsToStderr(false);
      process.stderr.write = original;
    }
    const lines = err.split('\n').filter((l) => l.startsWith('[show-prompts] GET'));
    assert.deepEqual(lines, ['[show-prompts] GET https://api.example.org/one', '[show-prompts] GET https://files.example.net/two']);
  });
});
