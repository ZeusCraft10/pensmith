// tests/paths.test.ts — functional tests for bin/lib/paths.ts (D-40, D-41, D-43).
//
// Strategy: every export that depends on the live process env/platform
// accepts injection points (`platform`, `env`) so the tests don't depend
// on the host machine's environment. The "live env" composer functions
// (pensmithLockDir, pensmithHttpCacheDir, projectRoot, projectHash, paperDir)
// are exercised on whatever the local box happens to be — we only assert
// the suffix shape, not absolute equality.
//
// Coverage targets:
//   - 3 platform branches (win32 / darwin / linux-xdg / linux-fallback)
//   - win32 throws on missing LOCALAPPDATA (Pitfall 4)
//   - pensmithDataDir / pensmithLockDir / pensmithHttpCacheDir compose
//   - projectRoot resolves relative paths absolute
//   - projectHash returns deterministic 12-hex
//   - sectionDir formats {NN}-{slug} and slugifies free-form names
//   - sectionDir rejects out-of-range n
//   - paperDir composes root + .paper
//   - isInsideSyncFolder detects OneDrive (Win + macOS CloudStorage),
//     iCloud, Dropbox, Google Drive (Windows + macOS + Linux paths)
//   - isInsideSyncFolder returns false for non-sync paths
//   - slugify ASCII kebab + diacritic strip + 64-char cap
//   - slugify throws on empty result + path-traversal patterns

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  localDataDir,
  pensmithDataDir,
  pensmithLockDir,
  pensmithHttpCacheDir,
  projectRoot,
  projectHash,
  paperDir,
  sectionDir,
  isInsideSyncFolder,
  slugify,
} from '../bin/lib/paths.js';

// ---- localDataDir: per-platform branches ----

test('localDataDir win32 returns LOCALAPPDATA', () => {
  assert.equal(localDataDir('win32', { LOCALAPPDATA: 'C:\\X' }), 'C:\\X');
});

test('localDataDir win32 throws on missing LOCALAPPDATA', () => {
  assert.throws(() => localDataDir('win32', {}), /LOCALAPPDATA is unset/);
});

test('localDataDir darwin returns ~/Library/Application Support', () => {
  assert.equal(
    localDataDir('darwin', { HOME: '/Users/u' }),
    path.join('/Users/u', 'Library', 'Application Support'),
  );
});

test('localDataDir linux respects XDG_DATA_HOME', () => {
  assert.equal(localDataDir('linux', { XDG_DATA_HOME: '/xdg' }), '/xdg');
});

test('localDataDir linux falls back to ~/.local/share when XDG unset', () => {
  assert.equal(
    localDataDir('linux', { HOME: '/home/u' }),
    path.join('/home/u', '.local', 'share'),
  );
});

test('localDataDir treats unknown POSIX (aix) like Linux', () => {
  assert.equal(
    localDataDir('aix' as NodeJS.Platform, { HOME: '/home/u' }),
    path.join('/home/u', '.local', 'share'),
  );
});

// ---- pensmithDataDir / pensmithLockDir / pensmithHttpCacheDir ----

test('pensmithDataDir composes localDataDir + pensmith', () => {
  const got = pensmithDataDir('linux', { HOME: '/home/u' });
  assert.equal(got, path.join('/home/u', '.local', 'share', 'pensmith'));
});

test('pensmithLockDir / pensmithHttpCacheDir compose under pensmithDataDir', () => {
  // These read live env/platform; just verify the suffix is correct.
  const lock = pensmithLockDir();
  const cache = pensmithHttpCacheDir();
  assert.ok(lock.endsWith(path.join('pensmith', 'locks')), `lock: ${lock}`);
  assert.ok(cache.endsWith(path.join('pensmith', 'http-cache')), `cache: ${cache}`);
});

// ---- projectRoot / projectHash / paperDir / sectionDir ----

test('projectRoot resolves relative paths to absolute', () => {
  const r = projectRoot('./');
  assert.ok(path.isAbsolute(r), `expected absolute path, got: ${r}`);
});

test('projectHash returns 12-hex deterministically', () => {
  const h1 = projectHash('/tmp/foo');
  const h2 = projectHash('/tmp/foo');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{12}$/);
});

test('projectHash differs for different roots', () => {
  assert.notEqual(projectHash('/tmp/foo'), projectHash('/tmp/bar'));
});

test('paperDir composes root + .paper', () => {
  assert.equal(paperDir('/tmp/p'), path.join('/tmp/p', '.paper'));
});

test('sectionDir formats NN-slug', () => {
  assert.equal(
    sectionDir(3, 'methods', '/tmp/p'),
    path.join('/tmp/p', '.paper', 'sections', '03-methods'),
  );
});

test('sectionDir slugifies free-form section names', () => {
  assert.equal(
    sectionDir(12, 'Results & Discussion', '/tmp/p'),
    path.join('/tmp/p', '.paper', 'sections', '12-results-discussion'),
  );
});

test('sectionDir rejects out-of-range n', () => {
  assert.throws(() => sectionDir(-1, 'x', '/tmp/p'));
  assert.throws(() => sectionDir(100, 'x', '/tmp/p'));
  assert.throws(() => sectionDir(1.5, 'x', '/tmp/p'));
});

// ---- isInsideSyncFolder ----

test('isInsideSyncFolder detects OneDrive (Windows + macOS CloudStorage)', () => {
  assert.ok(isInsideSyncFolder('C:\\Users\\u\\OneDrive\\repo'));
  assert.ok(isInsideSyncFolder('C:\\Users\\u\\OneDrive - Acme\\repo'));
  assert.ok(isInsideSyncFolder('/Users/u/Library/CloudStorage/OneDrive-Personal/repo'));
});

test('isInsideSyncFolder detects iCloud Drive on macOS', () => {
  assert.ok(
    isInsideSyncFolder('/Users/u/Library/Mobile Documents/com~apple~CloudDocs/repo'),
  );
});

test('isInsideSyncFolder detects Dropbox + Google Drive on all platforms', () => {
  assert.ok(isInsideSyncFolder('C:\\Users\\u\\Dropbox\\repo'));
  assert.ok(isInsideSyncFolder('/Users/u/Dropbox/repo'));
  assert.ok(isInsideSyncFolder('C:\\Users\\u\\Google Drive\\repo'));
  assert.ok(isInsideSyncFolder('/Users/u/Google Drive/repo'));
});

test('isInsideSyncFolder returns false for non-sync paths', () => {
  assert.equal(isInsideSyncFolder('/Users/u/code/repo'), false);
  assert.equal(isInsideSyncFolder('C:\\Users\\u\\code\\repo'), false);
  assert.equal(isInsideSyncFolder('/home/u/work/repo'), false);
});

// ---- slugify ----

test('slugify ASCII kebab', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('  Methods & Results  '), 'methods-results');
});

test('slugify strips diacritics', () => {
  assert.equal(slugify('résumé'), 'resume');
  assert.equal(slugify('naïve'), 'naive');
});

test('slugify caps at 64 chars', () => {
  assert.equal(slugify('a'.repeat(100)).length, 64);
});

test('slugify is deterministic', () => {
  assert.equal(slugify('Methods & Results'), slugify('Methods & Results'));
});

test('slugify throws on empty result', () => {
  assert.throws(() => slugify(''));
  assert.throws(() => slugify('   '));
  assert.throws(() => slugify('!!!'));
});

test('slugify rejects path-traversal patterns', () => {
  // Per PLAN behavior spec + threat model T-01-09, slugify must EITHER throw
  // OR produce a string with no '..'. Period-only inputs ('..') collapse to
  // empty after the [^a-z0-9]+ → '-' regex and trim, which triggers the
  // empty-result throw. Mixed inputs like '../foo' collapse the '../' to a
  // single '-' which is then trimmed, leaving 'foo' — no traversal escapes
  // the boundary. Both outcomes are acceptable; what matters is that '..'
  // never appears in the returned slug.
  assert.throws(() => slugify('..'));
  assert.throws(() => slugify('.'));
  assert.throws(() => slugify('/'));

  // For mixed inputs, assert the property: output never contains '..'.
  for (const input of ['../foo', '../etc/passwd', 'foo/../bar', '..foo..']) {
    let out: string | undefined;
    let threw = false;
    try {
      out = slugify(input);
    } catch {
      threw = true;
    }
    if (!threw) {
      assert.ok(
        typeof out === 'string' && !out.includes('..'),
        `slugify(${JSON.stringify(input)}) returned ${JSON.stringify(out)} which contains '..'`,
      );
    }
  }
});
