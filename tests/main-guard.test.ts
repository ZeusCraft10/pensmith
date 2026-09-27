// tests/main-guard.test.ts — RUN-10 / D-17-41 unit coverage for
// bin/lib/main-guard.ts isMainModule(importMetaUrl, argv1).
//
// The end-to-end proof (npm i -g, a symlinked/junctioned root, the MCP server)
// is tests/installed-bin.test.ts; this suite pins each branch: symlink and
// junction launchers, relative and extensionless argv[1], a different entry,
// a missing argv[1], and a non-file module URL.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainModule } from '../bin/lib/main-guard.js';

function scratch(): { dir: string; entry: string; url: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-main-guard-'));
  const entry = path.join(dir, 'pkg', 'dist', 'bin', 'cli.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, '// entry\n');
  return { dir, entry, url: pathToFileURL(fs.realpathSync(entry)).href };
}

test('RUN-10: the entry run directly (absolute or relative argv[1]) is main', () => {
  const { entry, url } = scratch();
  assert.equal(isMainModule(url, entry), true);
  assert.equal(isMainModule(url, path.relative(process.cwd(), entry)), true, 'a relative argv[1] resolves against the cwd');
});

test('RUN-10: an extensionless argv[1] (node dist/bin/cli) resolves like Node does', () => {
  const { entry, url } = scratch();
  assert.equal(isMainModule(url, entry.replace(/\.js$/, '')), true);
});

test('RUN-10: a bin symlink (npm i -g / npm link / .bin shim) is main — the case the old guard missed', () => {
  const { dir, entry, url } = scratch();
  const bin = path.join(dir, 'prefix', 'bin', 'cli');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  if (process.platform === 'win32') {
    // Windows has no file symlinks without privileges; npm uses .cmd shims
    // there (installed-bin covers them) — exercise the directory junction.
    const junction = path.join(dir, 'linked-pkg');
    fs.symlinkSync(path.join(dir, 'pkg'), junction, 'junction');
    assert.equal(isMainModule(url, path.join(junction, 'dist', 'bin', 'cli.js')), true);
  } else {
    fs.symlinkSync(entry, bin);
    assert.notEqual(pathToFileURL(bin).href, url, 'the naive URL comparison would be false');
    assert.equal(isMainModule(url, bin), true);
  }
});

test('RUN-10: a symlinked or junctioned package root (a symlinked plugin root) is main', () => {
  const { dir, url } = scratch();
  const linked = path.join(dir, 'linked-root');
  fs.symlinkSync(path.join(dir, 'pkg'), linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(isMainModule(url, path.join(linked, 'dist', 'bin', 'cli.js')), true);
});

test('RUN-10: importing the module from elsewhere (tests, other entries) is NOT main', () => {
  const { dir, url } = scratch();
  const other = path.join(dir, 'other.js');
  fs.writeFileSync(other, '');
  assert.equal(isMainModule(url, other), false);
  assert.equal(isMainModule(url, path.join(dir, 'does-not-exist.js')), false);
  assert.equal(isMainModule(url, undefined), false, 'no argv[1] (node -e, a REPL)');
  assert.equal(isMainModule('data:text/javascript,1', other), false, 'a non-file module URL');
});

test('RUN-10: case differences are folded on Windows only', () => {
  const { entry, url } = scratch();
  const upper = entry.toUpperCase();
  if (process.platform === 'win32') {
    assert.equal(isMainModule(url, upper), true);
  } else {
    // POSIX compares realpaths as the filesystem reports them (a case-insensitive
    // macOS volume canonicalizes case in realpath; Linux does not match at all).
    assert.equal(isMainModule(url, upper), fs.existsSync(upper) && fs.realpathSync.native(upper) === fs.realpathSync.native(entry));
  }
});
