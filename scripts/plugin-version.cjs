#!/usr/bin/env node
// scripts/plugin-version.cjs — the plugin's content-stamped version (PLUG-01,
// PLUG-03, D-23a-05 as amended in review round 2).
//
// Claude Code versions an installed plugin by the `version` in its
// plugin.json, when that field is set: `claude plugin update` and background
// auto-update compare it with the recorded one and do nothing while it is
// unchanged, however many commits the marketplace gained
// (https://code.claude.com/docs/en/plugins/loading#versions-and-updates).
// A fixed `0.1.0-dev` therefore kept every git-marketplace user on their first
// cached copy. Leaving the field out would let Claude Code use the commit SHA,
// but `claude plugin validate --strict` (Phase 23 criterion 1, CI-05) fails on
// a missing version. So the version is `<package.json version>+<content>`,
// where <content> is the first 12 hex digits of a sha256 over every file in
// plugin/ (plugin.json itself without its `version`): any change to what an
// install copies changes the string, and nothing else does.
//
//   node scripts/plugin-version.cjs            print the version plugin/ should carry
//   node scripts/plugin-version.cjs --write    stamp it into plugin/.claude-plugin/plugin.json
//                                              (`npm run plugin:version`; `npm run bundle` does it too)
//   node scripts/plugin-version.cjs --check    exit 1 when the stamped version is stale
//
// scripts/validate-plugin-manifest.cjs enforces the stamp (`npm run
// validate:manifests`, CI), so a change under plugin/ that was not re-stamped
// fails the build instead of silently never reaching installed users.
//
// Deterministic across OSes: files are walked in sorted POSIX-path order, text
// files hash with LF line endings (a CRLF checkout hashes like an LF one), and
// OS litter (.DS_Store, Thumbs.db, desktop.ini) is skipped.

'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST_REL = '.claude-plugin/plugin.json';
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
/** `<package version>+<12 hex>`: the form every stamped version has. */
const STAMPED_VERSION_RE = /^(.+)\+([0-9a-f]{12})$/;

/** Every file under `dir`, as sorted POSIX paths relative to it. */
function listFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else out.push(childRel);
    }
  };
  walk(dir, '');
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The bytes one file contributes: plugin.json without `version`; text with LF endings. */
function hashedBytes(pluginDir, rel) {
  const bytes = fs.readFileSync(path.join(pluginDir, ...rel.split('/')));
  if (rel === MANIFEST_REL) {
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest !== null && typeof manifest === 'object') delete manifest.version;
    return Buffer.from(JSON.stringify(manifest), 'utf8');
  }
  if (bytes.includes(0)) return bytes; // binary: as is
  return Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

/** The 12-hex content digest of the plugin directory `pluginDir`. */
function pluginContentHash(pluginDir) {
  const h = crypto.createHash('sha256');
  for (const rel of listFiles(pluginDir)) {
    const digest = crypto.createHash('sha256').update(hashedBytes(pluginDir, rel)).digest('hex');
    h.update(`${rel}\0${digest}\n`);
  }
  return h.digest('hex').slice(0, 12);
}

/** The version plugin/ should carry: `<packageVersion>+<content digest>`. */
function expectedPluginVersion(packageVersion, pluginDir) {
  return `${packageVersion}+${pluginContentHash(pluginDir)}`;
}

/** Split a stamped version into its package version and digest, or null. */
function parseStampedVersion(version) {
  const m = typeof version === 'string' ? STAMPED_VERSION_RE.exec(version) : null;
  return m ? { packageVersion: m[1], digest: m[2] } : null;
}

/**
 * Write `version` into `pluginDir`'s plugin.json, keeping the file's layout
 * (only the value of the top-level "version" key changes). Returns true when
 * the file changed.
 */
function writePluginVersion(pluginDir, version) {
  const file = path.join(pluginDir, ...MANIFEST_REL.split('/'));
  const raw = fs.readFileSync(file, 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest.version === version) return false;
  let next;
  if (typeof manifest.version === 'string') {
    // The first "version" key at the top level: plugin.json's first-level keys
    // are indented by two spaces, nested ones deeper.
    next = raw.replace(/^( {2}"version"\s*:\s*)"(?:[^"\\]|\\.)*"/m, (_, head) => `${head}${JSON.stringify(version)}`);
  } else {
    next = raw.replace(/^( {2}"name"\s*:\s*"(?:[^"\\]|\\.)*",?)(\r?\n)/m, (_, line, nl) => {
      const withComma = line.endsWith(',') ? line : `${line},`;
      return `${withComma}${nl}  "version": ${JSON.stringify(version)},${nl}`;
    });
  }
  if (JSON.parse(next).version !== version) {
    throw new Error(`plugin-version: could not stamp ${file}; set "version": ${JSON.stringify(version)} by hand`);
  }
  fs.writeFileSync(file, next);
  return true;
}

/** Stamp plugin/'s version from package.json. Returns {version, changed}. */
function stampPluginVersion(repoRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const pluginDir = path.join(repoRoot, 'plugin');
  const version = expectedPluginVersion(pkg.version, pluginDir);
  return { version, changed: writePluginVersion(pluginDir, version) };
}

module.exports = {
  STAMPED_VERSION_RE,
  expectedPluginVersion,
  listFiles,
  parseStampedVersion,
  pluginContentHash,
  stampPluginVersion,
  writePluginVersion,
};

if (require.main === module) {
  const repoRoot = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const pluginDir = path.join(repoRoot, 'plugin');
  const expected = expectedPluginVersion(pkg.version, pluginDir);
  if (args.includes('--write')) {
    const { version, changed } = stampPluginVersion(repoRoot);
    process.stdout.write(`plugin-version: ${changed ? 'stamped' : 'already'} ${version}\n`);
  } else if (args.includes('--check')) {
    const current = JSON.parse(fs.readFileSync(path.join(pluginDir, ...MANIFEST_REL.split('/')), 'utf8')).version;
    if (current !== expected) {
      process.stderr.write(
        `plugin-version: plugin/.claude-plugin/plugin.json has version ${JSON.stringify(current)}, but plugin/'s content is ${JSON.stringify(expected)} — run \`npm run plugin:version\` and commit plugin/.claude-plugin/plugin.json\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(`plugin-version: ${expected} matches plugin/\n`);
    }
  } else if (args.length === 0) {
    process.stdout.write(`${expected}\n`);
  } else {
    process.stderr.write(`plugin-version: unknown argument ${args[0]} (usage: [--write | --check])\n`);
    process.exitCode = 2;
  }
}
