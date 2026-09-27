// tests/helpers/local-servers/dial-recorder.mjs — socket-level egress recorder
// (RUN-01, RUN-04 socket proofs).
//
// Two ways to use it:
//
//   1. As a PRELOAD for a spawned CLI:
//        node --import <this file URL> dist/bin/pensmith.js …
//      with PENSMITH_DIAL_LOG=<file>. Every dns.lookup, net.connect /
//      net.createConnection / tls.connect and every read of a path under
//      tests/fixtures/cassettes is appended to that file as one JSON line. DNS
//      answers a TEST-NET-1 placeholder (192.0.2.1 — never a real query) and
//      every connect is REFUSED, so a live run shows exactly which hosts it
//      tried to reach (the TLS SNI host) without any byte leaving the machine.
//      With PENSMITH_DIAL_ALLOW_LOOPBACK=1, a dial to a loopback IP literal
//      (127.0.0.0/8, ::1) is still recorded but allowed through — so a run can
//      talk to a local mock LLM while every public dial stays refused.
//
//   2. In-process: installDialRecorder() → { events, restore() }.
//
// It patches the CommonJS builtins and calls module.syncBuiltinESMExports(), so
// ESM named imports of node:net / node:tls / node:dns / node:fs (and undici's
// require()s) see the spies. Nothing here touches the network.

import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const fs = require('node:fs');

const PLACEHOLDER_ADDRESS = '192.0.2.1';

/** A loopback IP literal (never a hostname: DNS answers stay placeholders). */
function isLoopbackLiteral(host) {
  if (typeof host !== 'string') return false;
  const h = host.replace(/^\[|\]$/g, '');
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === '::1';
}
const CASSETTE_SEGMENT = /tests[\\/]+fixtures[\\/]+cassettes/;

function refusal(host, port) {
  const err = new Error(`dial-recorder: connection to ${host}:${port} refused (test)`);
  err.code = 'ECONNREFUSED';
  return err;
}

/**
 * When the caller supplied its own `lookup` (bin/lib/http.ts pins every dial
 * that way), ask it which addresses this dial would go to. The pinned lookup
 * answers synchronously with the validated addresses; a normal socket has no
 * custom lookup and this returns undefined.
 */
function pinnedAddresses(options, host) {
  if (!options || typeof options !== 'object' || typeof options.lookup !== 'function' || !host) return undefined;
  let out;
  try {
    options.lookup(host, { all: true }, (err, addrs) => {
      if (!err) out = (Array.isArray(addrs) ? addrs : [{ address: addrs }]).map((x) => x.address);
    });
  } catch {
    return undefined;
  }
  return out;
}

function connectArgs(args) {
  // net.connect(options[, cb]) | net.connect(port[, host][, cb]) | net.connect(path[, cb])
  const a0 = args[0];
  if (a0 !== null && typeof a0 === 'object') {
    return { host: a0.host ?? a0.hostname ?? 'localhost', port: a0.port, servername: a0.servername, path: a0.path };
  }
  if (typeof a0 === 'number' || (typeof a0 === 'string' && /^\d+$/.test(a0))) {
    return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(a0) };
  }
  return { host: undefined, port: undefined, path: a0 };
}

/**
 * Install the spies. `onEvent` receives every event; `refuseConnects` (default
 * true) makes every TCP/TLS dial fail with ECONNREFUSED after it is recorded;
 * `allowLoopback` (default false) lets a dial to a loopback IP literal through
 * (still recorded) so a local mock LLM stays reachable.
 * Returns the recorded events and a restore() that puts the builtins back.
 */
export function installDialRecorder(opts = {}) {
  const refuseAll = opts.refuseConnects !== false;
  const allowLoopback = opts.allowLoopback === true;
  const refuse = (host) => refuseAll && !(allowLoopback && isLoopbackLiteral(host));
  const events = [];
  const emit = (e) => {
    events.push(e);
    if (typeof opts.onEvent === 'function') opts.onEvent(e);
  };

  const orig = {
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    tlsConnect: tls.connect,
    dnsLookup: dns.lookup,
    dnsPromisesLookup: dns.promises.lookup,
    readFileSync: fs.readFileSync,
    readdirSync: fs.readdirSync,
    promisesReadFile: fs.promises.readFile,
  };

  const netSpy = function patchedNetConnect(...args) {
    const a = connectArgs(args);
    if (a.path !== undefined && a.host === undefined) return orig.netConnect.apply(this, args); // IPC pipe
    const pinned = pinnedAddresses(args[0], a.host);
    emit({ kind: 'connect', tls: false, host: a.host, port: a.port, ...(pinned ? { addresses: pinned } : {}) });
    if (refuse(a.host)) throw refusal(a.host, a.port);
    return orig.netConnect.apply(this, args);
  };
  const netCreateSpy = function patchedCreateConnection(...args) {
    const a = connectArgs(args);
    if (a.path !== undefined && a.host === undefined) return orig.netCreateConnection.apply(this, args);
    emit({ kind: 'connect', tls: false, host: a.host, port: a.port });
    if (refuse(a.host)) throw refusal(a.host, a.port);
    return orig.netCreateConnection.apply(this, args);
  };
  const tlsSpy = function patchedTlsConnect(...args) {
    const a = connectArgs(args);
    const pinned = pinnedAddresses(args[0], a.host);
    emit({
      kind: 'connect', tls: true, host: a.host, port: a.port, servername: a.servername ?? a.host,
      ...(pinned ? { addresses: pinned } : {}),
    });
    if (refuse(a.host)) throw refusal(a.servername ?? a.host, a.port);
    return orig.tlsConnect.apply(this, args);
  };
  const lookupSpy = function patchedLookup(host, options, cb) {
    const callback = typeof options === 'function' ? options : cb;
    const o = typeof options === 'object' && options !== null ? options : {};
    emit({ kind: 'dns', host });
    const answer = [{ address: PLACEHOLDER_ADDRESS, family: 4 }];
    process.nextTick(() => {
      if (o.all) callback(null, answer);
      else callback(null, PLACEHOLDER_ADDRESS, 4);
    });
  };
  const lookupPromisesSpy = async function patchedPromisesLookup(host, options) {
    emit({ kind: 'dns', host });
    const o = typeof options === 'object' && options !== null ? options : {};
    return o.all ? [{ address: PLACEHOLDER_ADDRESS, family: 4 }] : { address: PLACEHOLDER_ADDRESS, family: 4 };
  };
  const noteRead = (p) => {
    const s = typeof p === 'string' ? p : p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : '';
    if (CASSETTE_SEGMENT.test(s)) emit({ kind: 'read', path: s });
  };
  const readFileSyncSpy = function patchedReadFileSync(p, ...rest) {
    noteRead(p);
    return orig.readFileSync.call(this, p, ...rest);
  };
  const readdirSyncSpy = function patchedReaddirSync(p, ...rest) {
    noteRead(p);
    return orig.readdirSync.call(this, p, ...rest);
  };
  const promisesReadFileSpy = function patchedReadFile(p, ...rest) {
    noteRead(p);
    return orig.promisesReadFile.call(this, p, ...rest);
  };

  net.connect = netSpy;
  net.createConnection = netCreateSpy;
  tls.connect = tlsSpy;
  dns.lookup = lookupSpy;
  dns.promises.lookup = lookupPromisesSpy;
  fs.readFileSync = readFileSyncSpy;
  fs.readdirSync = readdirSyncSpy;
  fs.promises.readFile = promisesReadFileSpy;
  syncBuiltinESMExports();

  return {
    events,
    /** Dials (TCP or TLS connect attempts). */
    dials: () => events.filter((e) => e.kind === 'connect'),
    restore() {
      net.connect = orig.netConnect;
      net.createConnection = orig.netCreateConnection;
      tls.connect = orig.tlsConnect;
      dns.lookup = orig.dnsLookup;
      dns.promises.lookup = orig.dnsPromisesLookup;
      fs.readFileSync = orig.readFileSync;
      fs.readdirSync = orig.readdirSync;
      fs.promises.readFile = orig.promisesReadFile;
      syncBuiltinESMExports();
    },
  };
}

// Preload mode: record to the file named by PENSMITH_DIAL_LOG.
const LOG = process.env.PENSMITH_DIAL_LOG;
if (typeof LOG === 'string' && LOG.length > 0) {
  const append = orig_appendFileSync();
  installDialRecorder({
    allowLoopback: process.env.PENSMITH_DIAL_ALLOW_LOOPBACK === '1',
    onEvent: (e) => {
      try {
        append(LOG, JSON.stringify(e) + '\n');
      } catch {
        /* recording must never break the run */
      }
    },
  });
}

/** Captured before the spies go in, so logging never recurses through them. */
function orig_appendFileSync() {
  const fn = fs.appendFileSync;
  return (file, data) => fn.call(fs, file, data);
}

/** Read a dial log written in preload mode. */
export function readDialLog(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}
