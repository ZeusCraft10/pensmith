#!/usr/bin/env node
// scripts/git-http-host.mjs — a loopback git host for the plugin smoke
// (scripts/plugin-smoke.mjs step 7, review round 2).
//
//   node scripts/git-http-host.mjs <dir>
//
// Serves the bare repositories under <dir> over git's smart HTTP protocol on
// 127.0.0.1 (a random port) through `git http-backend` (serveGitHttpBackend in
// scripts/plugin-smoke-lib.mjs), prints its base URL as one line on stdout and
// runs until it is killed. A separate process, because the smoke drives Claude
// Code with synchronous calls that would starve an in-process server.

import path from 'node:path';
import { serveGitHttpBackend } from './plugin-smoke-lib.mjs';

const root = process.argv[2];
if (!root) {
  process.stderr.write('usage: node scripts/git-http-host.mjs <dir holding bare repositories>\n');
  process.exit(2);
}
const host = await serveGitHttpBackend({ projectRoot: path.resolve(root) });
process.stdout.write(`${host.url}\n`);
const stop = () => {
  void host.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
