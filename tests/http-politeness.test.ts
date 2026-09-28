// tests/http-politeness.test.ts — SRC-17 (D-19-08, D-19-09): pensmith identifies
// itself in the form each service asks for.
//
//   - Crossref (incl. its retraction lookup), OpenAlex and Unpaywall get
//     `pensmith/<version> (mailto:<email>)`, with the address from
//     contact-email.ts contactEmail();
//   - a paper's `[network] contact_email_env` can name another variable (an
//     upper-case name containing EMAIL/MAILTO), and a name that could point at
//     a secret is ignored — the secret never leaves in a User-Agent;
//   - unset: `(no-contact)` and ONE banner that names the variable read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { fetch as httpFetch, isPolitePoolSource, _resetHostStateForTest, _resetWarnedForTest } from '../bin/lib/http.js';
import { _resetContactEmailForTest } from '../bin/lib/contact-email.js';
import { CURRENT_CONFIG_VERSION } from '../bin/lib/config.js';
import { atomicWriteFile } from '../bin/lib/atomic-write.js';

interface Seen {
  ua: string;
}

async function withPaper<T>(config: string | null, env: Record<string, string | undefined>, fn: (seen: Map<string, Seen>) => Promise<T>): Promise<{ result: T; err: string }> {
  const data = mkdtempSync(join(tmpdir(), 'pensmith-polite-data-'));
  const cwd = mkdtempSync(join(tmpdir(), 'pensmith-polite-paper-'));
  mkdirSync(join(cwd, '.paper'), { recursive: true });
  if (config !== null) await atomicWriteFile(join(cwd, '.paper', 'config.toml'), `schema_version = ${CURRENT_CONFIG_VERSION}\n${config}`);
  const vars: Record<string, string | undefined> = {
    PENSMITH_NETWORK_TESTS: '1',
    PENSMITH_OFFLINE: undefined,
    LOCALAPPDATA: data,
    XDG_DATA_HOME: data,
    HOME: data,
    PENSMITH_CONTACT_EMAIL: undefined,
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
  _resetWarnedForTest();
  _resetContactEmailForTest();
  const { agent, restore } = installMockAgent();
  const seen = new Map<string, Seen>();
  for (const origin of ['https://api.crossref.org', 'https://api.openalex.org', 'https://api.unpaywall.org', 'https://export.arxiv.org', 'https://eutils.ncbi.nlm.nih.gov']) {
    agent.get(origin).intercept({ path: /.*/, method: 'GET' }).reply((opts) => {
      const h = opts.headers as Record<string, string>;
      seen.set(`${origin}${opts.path}`, { ua: Object.entries(h).find(([k]) => k.toLowerCase() === 'user-agent')?.[1] ?? '' });
      return { statusCode: 200, data: '{}', responseOptions: { headers: { 'content-type': 'application/json' } } };
    }).persist();
  }
  const original = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = ((c: string | Uint8Array): boolean => {
    err += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await fn(seen);
    return { result, err };
  } finally {
    process.stderr.write = original;
    await restore();
    process.chdir(savedCwd);
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetContactEmailForTest();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
}

test('SRC-17: polite-pool sources are exactly Crossref, its retraction lookup, OpenAlex and Unpaywall', () => {
  for (const s of ['crossref', 'retraction-watch', 'openalex', 'unpaywall'] as const) assert.equal(isPolitePoolSource(s), true, s);
  for (const s of ['arxiv', 'pubmed', 'semanticscholar', 'books', 'zotero', 'generic'] as const) assert.equal(isPolitePoolSource(s), false, s);
});

test('SRC-17: a Crossref request\'s User-Agent is `pensmith/<v> (mailto:pensmith-dev@example.org)`; arXiv and PubMed get the plain form', async () => {
  const { err } = await withPaper(null, { PENSMITH_CONTACT_EMAIL: 'pensmith-dev@example.org' }, async (seen) => {
    await httpFetch('https://api.crossref.org/works/10.1038%2Fnature14539', { source: 'crossref', noCache: true });
    await httpFetch('https://api.crossref.org/works?filter=updates%3A10.1%2Fx', { source: 'retraction-watch', noCache: true });
    await httpFetch('https://export.arxiv.org/api/query?id_list=1706.03762', { source: 'arxiv', noCache: true });
    await httpFetch('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=1', { source: 'pubmed', noCache: true });
    const crossref = [...seen.entries()].filter(([k]) => k.startsWith('https://api.crossref.org'));
    assert.equal(crossref.length, 2);
    for (const [, v] of crossref) assert.match(v.ua, /^pensmith\/\d[^ ]* \(mailto:pensmith-dev@example\.org\)$/);
    for (const [k, v] of seen) {
      if (k.startsWith('https://export.arxiv.org') || k.startsWith('https://eutils')) assert.match(v.ua, /^pensmith\/\S+$/, k);
    }
  });
  assert.ok(!err.includes('not set'), 'no banner when the email is set');
});

test('D-19-09: `[network] contact_email_env = "MY_WORK_EMAIL"` is honoured for the User-Agent', async () => {
  await withPaper('[network]\ncontact_email_env = "MY_WORK_EMAIL"\n', { MY_WORK_EMAIL: 'lab-contact@example.org', PENSMITH_CONTACT_EMAIL: 'other@example.org' }, async (seen) => {
    await httpFetch('https://api.openalex.org/works/W1', { source: 'openalex', noCache: true });
    assert.match([...seen.values()][0]?.ua ?? '', /\(mailto:lab-contact@example\.org\)$/);
  });
});

test('D-19-09: a config that names a secret variable is ignored — the secret never rides in a User-Agent', async () => {
  const secret = 'sk-ant-SECRET-NEVER-SENT-123';
  const { err } = await withPaper('[network]\ncontact_email_env = "ANTHROPIC_API_KEY"\n', { ANTHROPIC_API_KEY: secret, PENSMITH_CONTACT_EMAIL: 'pensmith-dev@example.org' }, async (seen) => {
    await httpFetch('https://api.unpaywall.org/v2/10.1%2Fx', { source: 'unpaywall', noCache: true });
    const ua = [...seen.values()][0]?.ua ?? '';
    assert.ok(!ua.includes(secret));
    assert.match(ua, /\(mailto:pensmith-dev@example\.org\)$/, 'the default variable is read instead');
  });
  assert.match(err, /ignoring \[network\] contact_email_env = "ANTHROPIC_API_KEY"/);
  assert.ok(!err.includes(secret));
});

test('SRC-17: unset → `(no-contact)` and one banner naming the variable that was read', async () => {
  const { err } = await withPaper('[network]\ncontact_email_env = "MY_WORK_EMAIL"\n', {}, async (seen) => {
    await httpFetch('https://api.crossref.org/works/10.1%2Fa', { source: 'crossref', noCache: true });
    await httpFetch('https://api.crossref.org/works/10.1%2Fb', { source: 'crossref', noCache: true });
    for (const v of seen.values()) assert.match(v.ua, /^pensmith\/\S+ \(no-contact\)$/);
  });
  const banners = err.split('\n').filter((l) => l.includes('is not set. Using no-contact User-Agent'));
  assert.equal(banners.length, 1, err);
  assert.match(banners[0]!, /^pensmith: MY_WORK_EMAIL is not set\./, 'the banner names the configured variable');
});

test('D-19-09: a value that is not an email address is not sent', async () => {
  const { err } = await withPaper(null, { PENSMITH_CONTACT_EMAIL: 'not an email <x>' }, async (seen) => {
    await httpFetch('https://api.crossref.org/works/10.1%2Fc', { source: 'crossref', noCache: true });
    assert.match([...seen.values()][0]?.ua ?? '', /\(no-contact\)$/);
  });
  assert.match(err, /PENSMITH_CONTACT_EMAIL is set but is not an email address/);
});
