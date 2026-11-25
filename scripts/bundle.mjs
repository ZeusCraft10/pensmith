#!/usr/bin/env node
// scripts/bundle.mjs — build the committed plugin payload.
//
//   node scripts/bundle.mjs           write plugin/dist/* and the copied assets
//   node scripts/bundle.mjs --check   rebuild in memory; exit 1 if anything
//                                     committed under plugin/ is stale
//
// The plugin is installed by copying plugin/ as-is: Claude Code never runs
// npm install for it, so the CLI and the hook are esbuild bundles with every
// dependency inlined, and the runtime assets the CLI reads (prompt templates,
// CSL styles, presets, reference copy) are copied next to them. Everything
// written here is generated; edit the sources, then re-run this script.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'plugin');
const checkOnly = process.argv.includes('--check');

// Asset trees copied verbatim into the payload (source dir → payload dir).
const ASSET_DIRS = ['templates', 'references'];
const ASSET_FILES = ['LICENSE'];

// ESM output has no require/__dirname/__filename. Bundled CommonJS packages
// still reference them, so give the bundle real ones under private names and
// point the free identifiers at them (esbuild `define` only rewrites unbound
// references, so modules that declare their own __dirname are unaffected).
const ESM_SHIMS = [
  "import { createRequire as __pensmithCreateRequire } from 'node:module';",
  "import { fileURLToPath as __pensmithFileURLToPath } from 'node:url';",
  "import { dirname as __pensmithDirname } from 'node:path';",
  'const require = __pensmithCreateRequire(import.meta.url);',
  'const __pensmithFilename = __pensmithFileURLToPath(import.meta.url);',
  'const __pensmithDirnameValue = __pensmithDirname(__pensmithFilename);',
].join('\n');

// npm link, global installs and PATH symlinks start the CLI through a symlink.
// Node resolves import.meta.url to the real file but leaves argv[1] as the
// link, so normalise argv[1] before the entry-point check compares the two.
const ARGV_REALPATH = [
  "import { realpathSync as __pensmithRealpathSync } from 'node:fs';",
  'try { if (process.argv[1]) process.argv[1] = __pensmithRealpathSync(process.argv[1]); } catch { /* keep argv as given */ }',
].join('\n');

// pdf-parse picks its pdf.js build with a template-literal require, which
// would make esbuild inline all four bundled pdf.js versions (about 11 MB).
// pensmith always uses the library default, so pin that one.
const PDF_JS_DEFAULT = 'v1.10.100';
const pdfParsePin = {
  name: 'pin-pdf-parse-pdfjs',
  setup(b) {
    b.onLoad({ filter: /[\\/]pdf-parse[\\/]lib[\\/]pdf-parse\.js$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      const dynamic = 'require(`./pdf.js/${options.version}/build/pdf.js`)';
      if (!src.includes(dynamic) || !src.includes(`version: '${PDF_JS_DEFAULT}'`)) {
        throw new Error(`pdf-parse changed shape; update the pdf.js pin in scripts/bundle.mjs (${args.path})`);
      }
      return { contents: src.replace(dynamic, `require('./pdf.js/${PDF_JS_DEFAULT}/build/pdf.js')`), loader: 'js' };
    });
  },
};

const common = {
  absWorkingDir: repoRoot,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  charset: 'utf8',
  legalComments: 'eof',
  write: false,
  logLevel: 'warning',
  // Cassette recording loads nock lazily and only under the test runner.
  external: ['nock'],
  define: { __dirname: '__pensmithDirnameValue', __filename: '__pensmithFilename' },
  plugins: [pdfParsePin],
};

const BUNDLES = [
  // Executable so `npm link` / package.json `bin` can run it directly.
  { entry: 'bin/pensmith.ts', out: 'dist/pensmith.mjs', banner: `${ESM_SHIMS}\n${ARGV_REALPATH}`, executable: true },
  { entry: 'hooks/session-start.ts', out: 'dist/hook.mjs', banner: ESM_SHIMS, executable: false },
];

/** Every generated file: payload-relative path → contents. */
async function generate() {
  const files = new Map();
  for (const b of BUNDLES) {
    const result = await build({
      ...common,
      entryPoints: [b.entry],
      outfile: path.join(pluginDir, b.out),
      banner: { js: b.banner },
    });
    const [output] = result.outputFiles;
    files.set(b.out, Buffer.from(output.contents));
  }
  for (const dir of ASSET_DIRS) {
    for (const rel of walk(path.join(repoRoot, dir))) {
      files.set(path.posix.join(dir, rel), readFileSync(path.join(repoRoot, dir, rel)));
    }
  }
  for (const f of ASSET_FILES) files.set(f, readFileSync(path.join(repoRoot, f)));
  return files;
}

/** Files under `dir`, as posix paths relative to it. */
function walk(dir, prefix = '') {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** Generated payload files currently on disk (hand-written payload files excluded). */
function existingGenerated() {
  const found = [];
  for (const top of ['dist', ...ASSET_DIRS]) {
    for (const rel of walk(path.join(pluginDir, top))) found.push(`${top}/${rel}`);
  }
  for (const f of ASSET_FILES) if (existsSync(path.join(pluginDir, f))) found.push(f);
  return found;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const files = await generate();

if (checkOnly) {
  const problems = [];
  for (const [rel, contents] of files) {
    const p = path.join(pluginDir, rel);
    if (!existsSync(p)) problems.push(`missing: plugin/${rel}`);
    else if (sha(readFileSync(p)) !== sha(contents)) problems.push(`stale:   plugin/${rel}`);
  }
  for (const rel of existingGenerated()) {
    if (!files.has(rel)) problems.push(`extra:   plugin/${rel}`);
  }
  if (problems.length > 0) {
    console.error('plugin payload is out of date with its sources:');
    for (const p of problems) console.error(`  ${p}`);
    console.error('Run `npm run bundle` and commit the result.');
    process.exit(1);
  }
  console.log(`plugin payload is up to date (${files.size} generated files)`);
} else {
  for (const rel of existingGenerated()) {
    if (!files.has(rel)) rmSync(path.join(pluginDir, rel));
  }
  for (const [rel, contents] of files) {
    const p = path.join(pluginDir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, contents);
  }
  for (const b of BUNDLES) {
    if (b.executable && process.platform !== 'win32') chmodSync(path.join(pluginDir, b.out), 0o755);
  }
  const sizes = BUNDLES.map((b) => `${b.out} ${(statSync(path.join(pluginDir, b.out)).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`bundled ${sizes.join(', ')}; copied ${files.size - BUNDLES.length} asset files`);
}
