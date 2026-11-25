#!/usr/bin/env node
// scripts/bundle.mjs — build the plugin payload: write plugin/dist/* and copy
// the runtime assets into plugin/.
//
// The plugin is installed by copying plugin/ as-is: Claude Code never runs
// npm install for it, so the CLI and the hook are esbuild bundles with every
// dependency inlined, and the runtime assets the CLI reads (prompt templates,
// CSL styles, presets, reference copy) are copied next to them. Everything
// written here is generated and gitignored: `npm run check` and CI rebuild it
// before the tests, and a release publishes it on the release branch (see
// scripts/release.mjs). Edit the sources, then re-run this script.

import { build } from 'esbuild';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'plugin');

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

// Node prints a DEP0005 warning for every `new Buffer()` called from outside
// node_modules, and in the bundle nothing is under node_modules any more. Each
// patch rewrites one bundled package's calls to the Buffer.from / Buffer.alloc
// call with the same result. Every edit must match exactly once, so a package
// that changes shape fails the bundle instead of silently warning again.
const BUFFER_PATCHES = [
  {
    // pdf.js copies typed arrays it posts to its in-process worker with
    // `new value.constructor(...)`. pdf-parse hands it a Buffer, so that is
    // `new Buffer(buffer)` on every PDF parse. Buffer.from(buffer) copies, like
    // the constructor did; Buffer.from(arrayBuffer, offset, length) shares the
    // memory, like the three-argument constructor did.
    file: /[\\/]pdf-parse[\\/]lib[\\/]pdf\.js[\\/]v1\.10\.100[\\/]build[\\/]pdf\.js$/,
    edits: [
      [
        'result = new value.constructor(buffer, value.byteOffset, value.byteLength);',
        'result = Buffer.isBuffer(value) ? Buffer.from(buffer, value.byteOffset, value.byteLength) : new value.constructor(buffer, value.byteOffset, value.byteLength);',
      ],
      ['result = new value.constructor(value);', 'result = Buffer.isBuffer(value) ? Buffer.from(value) : new value.constructor(value);'],
      // Node < 8 fallback; a Uint8Array copy either way.
      ['input = new Buffer(literals);', 'input = Buffer.from(literals);'],
    ],
  },
  {
    // Fallbacks for runtimes without Buffer.from / Buffer.alloc.
    file: /[\\/]jszip[\\/]lib[\\/]nodejsUtils\.js$/,
    edits: [
      ['return new Buffer(data, encoding);', 'return Buffer.from(data, encoding);'],
      ['var buf = new Buffer(size);', 'var buf = Buffer.alloc(size);'],
    ],
  },
  {
    // URL percent-encoding; every argument is a string or a byte array.
    file: /[\\/]whatwg-url[\\/]lib[\\/]url-state-machine\.js$/,
    edits: [
      ['const buf = new Buffer(c);', 'const buf = Buffer.from(c);'],
      ['const input = new Buffer(str);', 'const input = Buffer.from(str);'],
      ['return new Buffer(output).toString();', 'return Buffer.from(output).toString();'],
      ['const buffer = new Buffer(this.buffer);', 'const buffer = Buffer.from(this.buffer);'],
    ],
  },
];
const noBufferConstructor = {
  name: 'no-buffer-constructor',
  setup(b) {
    for (const patch of BUFFER_PATCHES) {
      b.onLoad({ filter: patch.file }, (args) => {
        let src = readFileSync(args.path, 'utf8');
        for (const [from, to] of patch.edits) {
          if (src.split(from).length !== 2) {
            throw new Error(`${args.path} changed shape; update BUFFER_PATCHES in scripts/bundle.mjs (${from})`);
          }
          src = src.replace(from, to);
        }
        if (src.includes('new Buffer(')) {
          throw new Error(`${args.path} still calls new Buffer(); add it to BUFFER_PATCHES in scripts/bundle.mjs`);
        }
        return { contents: src, loader: 'js' };
      });
    }
  },
};

const common = {
  absWorkingDir: repoRoot,
  bundle: true,
  // Every release commits the payload to the release branch, so keep it small.
  // keepNames keeps function and class names (and so stack traces) readable,
  // and legalComments below keeps the inlined packages' licence notices.
  minify: true,
  keepNames: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  charset: 'utf8',
  legalComments: 'eof',
  write: false,
  logLevel: 'warning',
  // Cassette recording loads nock lazily and only under the test runner.
  external: ['nock'],
  // Old whatwg-url/tr46 (under citation-js's fetch) require Node's deprecated
  // punycode core module, which prints DEP0040 on every run; bundle the
  // userland package of the same API instead.
  alias: { punycode: 'punycode/' },
  define: { __dirname: '__pensmithDirnameValue', __filename: '__pensmithFilename' },
  plugins: [pdfParsePin, noBufferConstructor],
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
    if (output.text.includes('new Buffer(')) {
      throw new Error(`${b.out} calls new Buffer(), which prints DEP0005 for users; patch it in BUFFER_PATCHES`);
    }
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

const files = await generate();

// Drop generated files whose source is gone, then write the fresh set.
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
