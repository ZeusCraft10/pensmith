// tests/lib/built-plugin.test.ts
//
// plugin/dist is built by `npm run bundle` and never committed. A test that
// needs it must fail with that instruction when it is missing, not with a bare
// ENOENT, and must never skip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { builtPluginFile } from './built-plugin.js';

test('a missing bundle fails with the command that builds it', () => {
  const plugin = mkdtempSync(path.join(tmpdir(), 'pensmith-unbuilt-'));
  assert.throws(
    () => builtPluginFile(plugin, 'dist/pensmith.mjs'),
    (err: unknown) => {
      assert.ok(err instanceof assert.AssertionError, 'it is a test failure, not a crash');
      assert.match(err.message, /plugin\/dist\/pensmith\.mjs/);
      assert.match(err.message, /run `npm run bundle`/);
      return true;
    },
  );
});

test('a built bundle resolves to its path', () => {
  const plugin = mkdtempSync(path.join(tmpdir(), 'pensmith-built-'));
  mkdirSync(path.join(plugin, 'dist'));
  writeFileSync(path.join(plugin, 'dist', 'hook.mjs'), 'export {};\n');
  assert.equal(builtPluginFile(plugin, 'dist/hook.mjs'), path.join(plugin, 'dist', 'hook.mjs'));
});
