// tests/helpers/local-servers/transport.ts — local servers for the http.ts
// transport tests (SEC-01 pinning / SNI, SEC-03 size cap, RUN-16 mirror order).
//
// Every server listens on 127.0.0.1:0 and closes every socket on close(). This
// directory is the ONLY place under tests/ allowed to import node:http /
// node:https / undici (V6 exemption, RUN-29 row tests-network-imports).
//
// To reach one of these servers through the egress gate, a test registers its
// hostname with the http.ts test seam (__setHttpTestSeams / withLocalHosts): the
// seam works only under a test context, and only the named hosts may resolve to
// loopback. The LLM endpoint policy needs no seam (a loopback LLM endpoint is
// allowed by design, D-17-09).

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { __setHttpTestSeams, type HttpTestSeams, type ResolvedAddress } from '../../../bin/lib/http.js';

const TLS_DIR = fileURLToPath(new URL('../../fixtures/tls/', import.meta.url));

/** The hostname the SEC-01 SNI server's certificate is issued for. */
export const SNI_HOST = 'sni.pensmith.test';

/** The test CA that signed the SNI server certificate (PEM). */
export function testCa(): string {
  return readFileSync(`${TLS_DIR}ca.crt`, 'utf8');
}

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** The TLS SNI servername the client sent (https servers only). */
  servername?: string;
  /** process.hrtime.bigint() when the server finished reading the request. */
  receivedAt: bigint;
}

export interface LocalServer {
  readonly port: number;
  /** http(s)://127.0.0.1:<port> */
  readonly origin: string;
  readonly requests: CapturedRequest[];
  close(): Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;

function track(server: Server): { sockets: Set<Socket> } {
  const sockets = new Set<Socket>();
  server.on('connection', (s: Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  server.on('secureConnection', (s: Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return { sockets };
}

async function listen(server: Server, scheme: 'http' | 'https', handlerRequests: CapturedRequest[]): Promise<LocalServer> {
  const { sockets } = track(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    origin: `${scheme}://127.0.0.1:${port}`,
    requests: handlerRequests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

function wrap(handler: Handler, requests: CapturedRequest[]) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const tlsSocket = req.socket as Socket & { servername?: string };
      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body,
        ...(typeof tlsSocket.servername === 'string' ? { servername: tlsSocket.servername } : {}),
        receivedAt: process.hrtime.bigint(),
      });
      handler(req, res, body);
    });
  };
}

/** A plain-http server on 127.0.0.1:0. */
export async function startHttpServer(handler: Handler): Promise<LocalServer> {
  const requests: CapturedRequest[] = [];
  return listen(createHttpServer(wrap(handler, requests)), 'http', requests);
}

/** An https server on 127.0.0.1:0 presenting the `sni.pensmith.test` certificate. */
export async function startSniServer(handler: Handler): Promise<LocalServer> {
  const requests: CapturedRequest[] = [];
  const server = createHttpsServer(
    {
      key: readFileSync(`${TLS_DIR}server.key`),
      cert: readFileSync(`${TLS_DIR}server.crt`),
    },
    wrap(handler, requests),
  );
  return listen(server as unknown as Server, 'https', requests);
}

/** A JSON responder. */
export function json(status: number, value: unknown): Handler {
  return (_req, res) => {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
}

/**
 * Stream `totalBytes` of filler in `chunkBytes` chunks WITHOUT a content-length
 * (chunked encoding), so the client cannot refuse up front and must count.
 * Records how many bytes were actually written before the client hung up.
 */
export function streamBytes(totalBytes: number, chunkBytes = 64 * 1024): Handler & { written(): number } {
  let written = 0;
  const fn = (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    const chunk = Buffer.alloc(chunkBytes, 0x61);
    const pump = (): void => {
      while (written < totalBytes) {
        const n = Math.min(chunkBytes, totalBytes - written);
        written += n;
        if (!res.write(n === chunkBytes ? chunk : chunk.subarray(0, n))) {
          res.once('drain', pump);
          return;
        }
      }
      res.end();
    };
    pump();
  };
  return Object.assign(fn, { written: () => written });
}

/**
 * Run `fn` with the http.ts test seams set: the named local hosts resolve to
 * 127.0.0.1 (and only they may be loopback), plus an optional extra CA.
 */
export async function withLocalHosts<T>(
  hosts: readonly string[],
  fn: () => Promise<T>,
  extra: Omit<HttpTestSeams, 'localHosts'> = {},
): Promise<T> {
  const resolve =
    extra.resolve ??
    (async (h: string): Promise<ResolvedAddress[]> => {
      if (hosts.includes(h)) return [{ address: '127.0.0.1', family: 4 }];
      throw new Error(`test resolver: no address for ${h}`);
    });
  __setHttpTestSeams({ ...extra, resolve, localHosts: hosts });
  try {
    return await fn();
  } finally {
    __setHttpTestSeams(null);
  }
}
