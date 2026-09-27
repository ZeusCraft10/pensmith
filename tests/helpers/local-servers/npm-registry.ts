// tests/helpers/local-servers/npm-registry.ts — a loopback npm registry built
// from package-lock.json + the local npm cache (RUN-10 installed-package tests).
//
// Why: `npm install -g <tarball>` must resolve every dependency RANGE, so it
// needs registry metadata (packuments). `npm ci` caches tarballs by integrity
// but not packuments, so `npm install -g --offline` fails with ENOTCACHED on a
// fresh clone or CI runner — and `npm test` must never reach the internet.
// This server answers exactly what a real registry would for the versions the
// lockfile pins:
//   GET /<name>                  → a packument listing the lockfile versions
//                                  (dependencies, bin, engines, os/cpu, bundled
//                                  deps, dist.integrity) with dist.tarball
//                                  pointing back at this server;
//   GET /<name>/-/<file>.tgz     → the tarball bytes, read from the npm cache's
//                                  content-addressed store (cacache
//                                  content-v2/<algo>/<hex…>) by the lockfile
//                                  integrity — byte-identical to the registry's,
//                                  so npm's integrity check passes.
// It listens on 127.0.0.1:0 only. Lives under tests/helpers/local-servers/
// (D-17-03), the one tests/ location allowed to import node:http (V6).

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

interface LockEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  name?: string;
  inBundle?: boolean;
  link?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, unknown>;
  bundleDependencies?: string[] | boolean;
  bin?: Record<string, string> | string;
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  hasInstallScript?: boolean;
  deprecated?: string;
}

export interface LocalNpmRegistry {
  /** Base URL, e.g. http://127.0.0.1:43123/ (trailing slash). */
  url: string;
  /** Every request path served, in order (for assertions / diagnostics). */
  requests: string[];
  /** Tarballs requested but absent from the npm cache. */
  missing: string[];
  close(): Promise<void>;
}

/** cacache content path for one `<algo>-<base64>` integrity token. */
function cacachePath(cacheDir: string, token: string): string | null {
  const dash = token.indexOf('-');
  if (dash <= 0) return null;
  const algo = token.slice(0, dash);
  const hex = Buffer.from(token.slice(dash + 1), 'base64').toString('hex');
  if (hex.length < 8) return null;
  return path.join(cacheDir, '_cacache', 'content-v2', algo, hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = b.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/**
 * Start the registry. `lockfile` is a package-lock.json (v2/v3); `cacheDir` is
 * the npm cache root (`npm config get cache`, the directory holding _cacache).
 */
export async function startLockfileRegistry(opts: { lockfile: string; cacheDir: string }): Promise<LocalNpmRegistry> {
  const lock = JSON.parse(readFileSync(opts.lockfile, 'utf8')) as { packages?: Record<string, LockEntry> };
  const byName = new Map<string, Map<string, LockEntry>>();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key || entry.link || entry.inBundle || !entry.version || !entry.integrity) continue;
    const name = entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, new Map());
    byName.get(name)!.set(entry.version, entry);
  }

  const requests: string[] = [];
  const missing: string[] = [];
  const tarballs = new Map<string, string>(); // url path → integrity
  let base = '';

  const tarballPath = (name: string, version: string): string => {
    const bare = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
    return `/${name}/-/${bare}-${version}.tgz`;
  };

  const packument = (name: string): unknown => {
    const versions = byName.get(name)!;
    const out: Record<string, unknown> = {};
    for (const [version, e] of versions) {
      const tp = tarballPath(name, version);
      tarballs.set(tp, e.integrity!);
      const bin = typeof e.bin === 'string' ? { [name.split('/').pop()!]: e.bin } : e.bin;
      out[version] = {
        name,
        version,
        ...(e.dependencies ? { dependencies: e.dependencies } : {}),
        ...(e.optionalDependencies ? { optionalDependencies: e.optionalDependencies } : {}),
        ...(e.peerDependencies ? { peerDependencies: e.peerDependencies } : {}),
        ...(e.peerDependenciesMeta ? { peerDependenciesMeta: e.peerDependenciesMeta } : {}),
        ...(e.bundleDependencies ? { bundleDependencies: e.bundleDependencies } : {}),
        ...(bin ? { bin } : {}),
        ...(e.engines ? { engines: e.engines } : {}),
        ...(e.os ? { os: e.os } : {}),
        ...(e.cpu ? { cpu: e.cpu } : {}),
        ...(e.hasInstallScript ? { hasInstallScript: true } : {}),
        ...(e.deprecated ? { deprecated: e.deprecated } : {}),
        dist: { integrity: e.integrity, tarball: `${base}${tp.slice(1)}` },
      };
    }
    const latest = [...versions.keys()].sort(compareSemver).pop()!;
    return { name, 'dist-tags': { latest }, versions: out };
  };

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    requests.push(urlPath);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (urlPath.includes('/-/')) {
      let integrity = tarballs.get(urlPath);
      if (!integrity) {
        // A tarball requested before its packument (npm cached it): derive it.
        const m = /^\/(.+)\/-\/[^/]+-([^/]+)\.tgz$/.exec(urlPath);
        const e = m ? byName.get(m[1]!)?.get(m[2]!) : undefined;
        integrity = e?.integrity;
      }
      const file = (integrity ?? '')
        .split(/\s+/)
        .map((t) => cacachePath(opts.cacheDir, t))
        .find((p): p is string => p !== null && existsSync(p));
      if (!file) {
        missing.push(urlPath);
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `not in the npm cache: ${urlPath}` }));
        return;
      }
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    const name = urlPath.slice(1);
    if (!byName.has(name)) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const body = Buffer.from(JSON.stringify(packument(name)));
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('npm-registry: no address');
  base = `http://127.0.0.1:${addr.port}/`;

  return {
    url: base,
    requests,
    missing,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
