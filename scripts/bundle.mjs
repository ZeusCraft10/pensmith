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
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_DIRS, ASSET_FILES, BUNDLES, filesUnder } from './release-tree.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'plugin');

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
        // Checked per file as well as on the whole bundle: minifying prints a
        // zero-argument `new Buffer()` as `new Buffer`, which the bundle-wide
        // check below cannot see.
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
  banner: { js: ESM_SHIMS },
  plugins: [pdfParsePin, noBufferConstructor],
};

/** Every generated file: payload-relative path → contents. */
async function generate() {
  const files = new Map();
  for (const b of BUNDLES) {
    const result = await build({ ...common, entryPoints: [b.entry], outfile: path.join(pluginDir, b.out) });
    const [output] = result.outputFiles;
    if (output.text.includes('new Buffer(')) {
      throw new Error(`${b.out} calls new Buffer(), which prints DEP0005 for users; patch it in BUFFER_PATCHES`);
    }
    files.set(b.out, Buffer.from(output.contents));
  }
  for (const dir of ASSET_DIRS) {
    for (const rel of filesUnder(path.join(repoRoot, dir))) {
      files.set(path.posix.join(dir, rel), readFileSync(path.join(repoRoot, dir, rel)));
    }
  }
  for (const f of ASSET_FILES) files.set(f, readFileSync(path.join(repoRoot, f)));
  return files;
}

const files = await generate();

// Everything under these payload paths is generated. Clear them only once the
// build has succeeded, so files whose source is gone are dropped, then write
// the fresh set.
for (const top of ['dist', ...ASSET_DIRS, ...ASSET_FILES]) rmSync(path.join(pluginDir, top), { recursive: true, force: true });
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
