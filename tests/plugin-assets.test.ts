// tests/plugin-assets.test.ts — PLUG-02 / D-23a-03: the one plugin asset
// resolver (bin/lib/paths.ts pluginRoot / pluginPath and its named helpers).
//
// plugin/ is the one home of every shipped asset for both tiers. The resolver
// walks up from its own module location: a folder holding
// .claude-plugin/plugin.json is the plugin root (the bundle in plugin/dist/…, a
// Claude Code plugin-cache copy); otherwise a folder holding
// plugin/.claude-plugin/plugin.json yields <folder>/plugin (the source tree,
// the tsc build in dist/, an npm install). Neither found is one PensmithError
// line. These tests cover the four layouts — source, bundle-like, npm-like and
// not-found — through the pure walk, and the real module location through
// copies of the compiled resolver (dist/ must be built: `npm run build`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cliPackageRoot,
  findPluginRoot,
  pluginLayout,
  pluginMcpServerBundle,
  pluginPath,
  pluginReferencePath,
  pluginRoot,
  pluginTemplatePath,
  pluginWorkflowPath,
  PLUGIN_DIR_NAME,
  PLUGIN_MCP_SERVER_LABEL,
} from '../bin/lib/paths.js';
import { EXIT_ERROR, PensmithError } from '../bin/lib/exit-codes.js';
import { EXPECTED_PROMPT_HASHES, loadPrompt } from '../bin/lib/prompt-loader.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join('.claude-plugin', 'plugin.json');

/**
 * A temp dir by its real path: Node loads an ES module under its real path, so
 * a module's import.meta.url — and so the resolver's walk — names /private/var
 * on macOS (where tmpdir() is /var/…) and long names on Windows.
 */
function tmp(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}

function writeManifest(pluginDir: string): void {
  mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(pluginDir, MANIFEST), '{"name":"pensmith"}\n');
}

// ---------------------------------------------------------------------------
// 1. Source layout: this very module graph (tsx over bin/lib).
// ---------------------------------------------------------------------------

test('PLUG-02 source layout: pluginRoot() is <repo>/plugin, found as the package\'s plugin/ folder', () => {
  assert.equal(pluginRoot(), path.join(REPO, PLUGIN_DIR_NAME));
  assert.equal(pluginLayout(), 'package');
  assert.equal(cliPackageRoot(), REPO);
  assert.ok(existsSync(path.join(pluginRoot(), MANIFEST)), 'the plugin manifest is under the root');
  assert.equal(pluginRoot(), pluginRoot(), 'cached: the same root every call');
});

test('PLUG-02 source layout: the named helpers land on the moved assets', () => {
  assert.equal(pluginPath('a', 'b'), path.join(REPO, 'plugin', 'a', 'b'));
  assert.equal(pluginTemplatePath('prompts', 'smoother.md'), path.join(REPO, 'plugin', 'templates', 'prompts', 'smoother.md'));
  assert.equal(pluginReferencePath('http-warnings.md'), path.join(REPO, 'plugin', 'references', 'http-warnings.md'));
  assert.equal(pluginWorkflowPath('new'), path.join(REPO, 'plugin', 'workflows', 'new.md'));
  assert.equal(pluginMcpServerBundle(), path.join(REPO, 'plugin', 'dist', 'mcp', 'server.mjs'));
  assert.equal(PLUGIN_MCP_SERVER_LABEL, 'plugin/dist/mcp/server.mjs');
  for (const p of [
    pluginTemplatePath('prompts', 'smoother.md'),
    pluginTemplatePath('citation-styles', 'apa.csl'),
    pluginTemplatePath('presets', 'disciplines.json'),
    pluginTemplatePath('stubs', 'text-stubs.json'),
    pluginTemplatePath('dry-run', 'corpus.json'),
    pluginReferencePath('honesty-framing.md'),
    pluginReferencePath('http-warnings.md'),
    pluginReferencePath('doctor-output.md'),
    pluginWorkflowPath('doctor'),
  ]) {
    assert.ok(existsSync(p), `${p} exists`);
  }
});

test('PLUG-02 source layout: every pinned prompt loads from plugin/templates/prompts with its hash verified', () => {
  for (const slug of Object.keys(EXPECTED_PROMPT_HASHES)) {
    const body = loadPrompt(slug);
    assert.ok(body.length > 0, `${slug} has a body`);
  }
});

// ---------------------------------------------------------------------------
// 2. The pure walk over synthetic layouts.
// ---------------------------------------------------------------------------

test('PLUG-02 bundle-like layout: a folder holding .claude-plugin/plugin.json is the plugin root', () => {
  const root = tmp('pensmith-plugin-bundle-');
  try {
    writeManifest(root);
    const from = path.join(root, 'dist', 'mcp');
    mkdirSync(from, { recursive: true });
    assert.deepEqual(findPluginRoot(from), { root, layout: 'plugin', packageRoot: null });
    // The plugin root itself resolves to itself.
    assert.deepEqual(findPluginRoot(root), { root, layout: 'plugin', packageRoot: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PLUG-02 npm-like layout: a folder holding plugin/.claude-plugin/plugin.json yields <folder>/plugin', () => {
  const pkg = tmp('pensmith-plugin-npm-');
  try {
    writeManifest(path.join(pkg, 'plugin'));
    writeFileSync(path.join(pkg, 'package.json'), '{"name":"pensmith","type":"module"}\n');
    const from = path.join(pkg, 'dist', 'bin', 'lib');
    mkdirSync(from, { recursive: true });
    assert.deepEqual(findPluginRoot(from), { root: path.join(pkg, 'plugin'), layout: 'package', packageRoot: pkg });
  } finally {
    rmSync(pkg, { recursive: true, force: true });
  }
});

test('PLUG-02: the nearest folder wins, the plugin itself before a nested plugin/', () => {
  const outer = tmp('pensmith-plugin-nearest-');
  try {
    // An outer package with plugin/, and inside it a plugin-cache-like copy.
    writeManifest(path.join(outer, 'plugin'));
    const inner = path.join(outer, 'cache', 'pensmith');
    writeManifest(inner);
    const from = path.join(inner, 'dist', 'hooks');
    mkdirSync(from, { recursive: true });
    assert.equal(findPluginRoot(from).root, inner);
    assert.equal(findPluginRoot(path.join(outer, 'cache')).root, path.join(outer, 'plugin'));
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test('PLUG-02: a .claude-plugin/plugin.json that is a folder, not a file, is not a manifest', () => {
  const root = tmp('pensmith-plugin-dirmanifest-');
  try {
    mkdirSync(path.join(root, '.claude-plugin', 'plugin.json'), { recursive: true });
    writeManifest(path.join(root, 'plugin'));
    assert.equal(findPluginRoot(root).root, path.join(root, 'plugin'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PLUG-02 not found: one PensmithError line naming where it looked', () => {
  const lonely = tmp('pensmith-plugin-none-');
  try {
    const from = path.join(lonely, 'a', 'b');
    mkdirSync(from, { recursive: true });
    assert.throws(
      () => findPluginRoot(from),
      (e: unknown) =>
        e instanceof PensmithError &&
        e.exitCode === EXIT_ERROR &&
        !e.message.includes('\n') &&
        e.message.includes(from) &&
        e.message.includes(MANIFEST) &&
        e.message.includes(path.join('plugin', MANIFEST)) &&
        /reinstall pensmith/.test(e.message),
    );
  } finally {
    rmSync(lonely, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. The real module location: copies of the compiled resolver (dist/).
// ---------------------------------------------------------------------------

const DIST_LIB = path.join(REPO, 'dist', 'bin', 'lib');
const RESOLVER_FILES = ['paths.js', 'exit-codes.js', 'stdin-source.js'];

function pathToImport(p: string): string {
  return pathToFileURL(p).href;
}

function resolveFrom(pathsJs: string, cwd: string, env: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } {
  const script =
    `import('${pathToImport(pathsJs)}').then((m) => { try { process.stdout.write(JSON.stringify({ root: m.pluginRoot(), layout: m.pluginLayout(), pkg: m.cliPackageRoot() })); } ` +
    `catch (e) { process.stderr.write(String(e.message)); process.exit(3); } });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd, env, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function copyResolver(toDir: string): string {
  mkdirSync(toDir, { recursive: true });
  for (const f of RESOLVER_FILES) copyFileSync(path.join(DIST_LIB, f), path.join(toDir, f));
  return path.join(toDir, 'paths.js');
}

test('PLUG-02 dist/ layout: the compiled resolver finds <repo>/plugin from any working directory', () => {
  assert.ok(existsSync(path.join(DIST_LIB, 'paths.js')), 'dist/ is built (run `npm run build`)');
  const cwd = tmp('pensmith-plugin-cwd-');
  try {
    const r = resolveFrom(path.join(DIST_LIB, 'paths.js'), cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { root: path.join(REPO, 'plugin'), layout: 'package', pkg: REPO });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('PLUG-02: CLAUDE_PLUGIN_ROOT is never consulted — the module location is authoritative', () => {
  const elsewhere = tmp('pensmith-plugin-env-');
  try {
    writeManifest(elsewhere);
    const r = resolveFrom(path.join(DIST_LIB, 'paths.js'), elsewhere, { ...process.env, CLAUDE_PLUGIN_ROOT: elsewhere });
    assert.equal(r.status, 0, r.stderr);
    assert.equal((JSON.parse(r.stdout) as { root: string }).root, path.join(REPO, 'plugin'));
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('PLUG-02 npm-like layout (real module): <pkg>/dist/bin/lib/paths.js resolves <pkg>/plugin', () => {
  const pkg = tmp('pensmith-plugin-npmreal-');
  try {
    writeFileSync(path.join(pkg, 'package.json'), '{"name":"pensmith","type":"module"}\n');
    writeManifest(path.join(pkg, 'plugin'));
    const pathsJs = copyResolver(path.join(pkg, 'dist', 'bin', 'lib'));
    const r = resolveFrom(pathsJs, tmpdir());
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { root: path.join(pkg, 'plugin'), layout: 'package', pkg });
  } finally {
    rmSync(pkg, { recursive: true, force: true });
  }
});

test('PLUG-02 bundle-like layout (real module): <plugin>/dist/mcp/… resolves <plugin>, not a nearer package.json', () => {
  const plugin = tmp('pensmith-plugin-bundlereal-');
  try {
    writeManifest(plugin);
    // A package.json nearer than the manifest (here only so the copied ESM
    // .js files load as modules) must not stop the walk: the plugin bundle
    // and the plugin cache hold no package.json at all.
    const pathsJs = copyResolver(path.join(plugin, 'dist', 'mcp'));
    writeFileSync(path.join(plugin, 'dist', 'package.json'), '{"type":"module"}\n');
    const r = resolveFrom(pathsJs, tmpdir());
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { root: plugin, layout: 'plugin', pkg: null });
  } finally {
    rmSync(plugin, { recursive: true, force: true });
  }
});

test('PLUG-02 not-found (real module): the compiled resolver throws its one line, lazily at first use', () => {
  const lonely = tmp('pensmith-plugin-nonereal-');
  try {
    writeFileSync(path.join(lonely, 'package.json'), '{"type":"module"}\n');
    const pathsJs = copyResolver(path.join(lonely, 'lib'));
    const r = resolveFrom(pathsJs, tmpdir());
    assert.equal(r.status, 3, `import succeeds and the first call throws: ${r.stderr}`);
    assert.match(r.stderr, /^plugin assets not found: /);
    assert.ok(!r.stderr.trim().includes('\n'), 'one line');
    assert.ok(r.stderr.includes(path.join(lonely, 'lib')), 'names where it looked');
  } finally {
    rmSync(lonely, { recursive: true, force: true });
  }
});

test('PLUG-02: package.json files ships plugin/ and none of the pre-move asset folders', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { files: string[] };
  assert.ok(pkg.files.includes('plugin/'), 'plugin/ is published');
  for (const gone of ['skills/', 'agents/', 'workflows/', 'templates/', 'references/', 'hooks/', '.claude-plugin/', '.mcp.json']) {
    assert.ok(!pkg.files.includes(gone), `${gone} is no longer a published root folder`);
  }
});
