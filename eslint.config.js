// eslint.config.js — ESLint 9 flat config for pensmith
// Locks the two architectural chokepoints (D-06, D-07) per REPO-05.
//
// Why this shape (do not simplify):
//   - D-06: HTTP imports (fetch/http/https/node:http/node:https/undici) are
//     forbidden everywhere by default; bin/lib/http.ts is exempted by a
//     per-file override. The chokepoint exists BEFORE the module it
//     protects (Pitfall 7).
//   - D-07: The literal regex /^10\./ is forbidden by no-restricted-syntax
//     with an AST selector matching Literal[regex.pattern=/^\^10\\\\\\./].
//     bin/lib/doi.ts is exempted by a per-file override. The escape level
//     here is FOUR levels deep (regex literal -> string in selector ->
//     JSON-ish in config -> ESLint Selectors esquery syntax). One missed
//     backslash silently breaks the rule (Pitfall B). The red-team fixture
//     in tests/fixtures/lint-chokepoint-fixture.ts is the regression gate.
//
// The fixture is INTENTIONALLY ignored by the project config so that
// `npm run lint` over the project does not flag it. The chokepoint test
// (tests/lint-chokepoint.test.ts) runs ESLint programmatically against
// the fixture with overrideConfigFile:true and asserts both rules fire.
//
// Note: this config relies ONLY on built-in ESLint rules + typescript-eslint.
// No third-party import plugin is required at Phase 0 — the built-in
// no-restricted-imports rule plus a per-file override on bin/lib/http.ts
// is sufficient to encode D-06.

import tseslint from 'typescript-eslint';

export default [
  ...tseslint.configs.recommended,

  {
    files: ['bin/**/*.ts', 'mcp/**/*.ts', 'hooks/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // === D-06: HTTP chokepoint — applies EVERYWHERE by default ===
      // === D-06/T-3-11 (Phase 3): pdf-parse chokepoint — applies EVERYWHERE by default ===
      // === D-19 (Phase 3): citation-js chokepoint — applies EVERYWHERE by default ===
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'undici',     message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'http',       message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:http',  message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'https',      message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:https', message: 'Import HTTP only via bin/lib/http.ts' },
          {
            name: 'pdf-parse',
            message: 'pdf-parse must only be imported from bin/lib/pdf-text.ts (D-06, T-3-11 chokepoint). All PDF text extraction routes through that single wrapper.',
          },
          {
            name: 'pdf-parse/lib/pdf-parse.js',
            message: 'Direct sub-path import is exempt only inside bin/lib/pdf-text.ts (D-06 ENOENT workaround). Other code MUST go through bin/lib/pdf-text.ts.',
          },
          {
            name: 'citation-js',
            message: 'citation-js must only be imported from bin/lib/citations.ts (D-19 chokepoint). All BibTeX parsing and APA rendering routes through that single wrapper.',
          },
        ],
      }],

      // === D-07 (Phase 0): DOI regex chokepoint ===
      // AST selector for a regex literal whose pattern starts with "^10."
      // The pattern /^10\./ contains no forward slash so the ESLint
      // Selectors esquery forward-slash workaround does not apply here.
      // DO NOT simplify the escapes — see Pitfall B.
      // === D-07 (Phase 1): atomic-write chokepoint — bans direct fs.writeFile / fs.promises.writeFile outside bin/lib/atomic-write.ts ===
      // === D-41 (Phase 1): paths chokepoint — bans os.homedir() and process.env.{LOCALAPPDATA,APPDATA,XDG_DATA_HOME} outside bin/lib/paths.ts ===
      // NOTE (Pitfall B5): D-41 is enforced via no-restricted-syntax MemberExpression
      // selectors, NOT no-restricted-globals — the latter cannot ban member access
      // patterns like process.env.X (it only bans bare global identifiers).
      'no-restricted-syntax': ['error',
        {
          selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]',
          message: 'DOI regex /^10\\./ is a chokepoint — use bin/lib/doi.ts only',
        },
        {
          selector: "CallExpression[callee.property.name='writeFile']",
          message: 'Direct fs.writeFile is forbidden (ARCH-05 / D-07) — use bin/lib/atomic-write.ts',
        },
        {
          selector: "MemberExpression[object.name='os'][property.name='homedir']",
          message: 'os.homedir() is a chokepoint (D-41) — use bin/lib/paths.ts',
        },
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='LOCALAPPDATA']",
          message: 'process.env.LOCALAPPDATA is a chokepoint (D-41) — use bin/lib/paths.ts',
        },
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='APPDATA']",
          message: 'process.env.APPDATA is a chokepoint (D-41) — use bin/lib/paths.ts (use LOCALAPPDATA, not APPDATA — Pitfall 4)',
        },
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='XDG_DATA_HOME']",
          message: 'process.env.XDG_DATA_HOME is a chokepoint (D-41) — use bin/lib/paths.ts',
        },
      ],
    },
  },

  // === HTTP chokepoint EXEMPTION for bin/lib/http.ts (lands Phase 1) ===
  {
    files: ['bin/lib/http.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // === pdf-parse chokepoint EXEMPTION for bin/lib/pdf-text.ts (Phase 3, D-06/T-3-11) ===
  // bin/lib/pdf-text.ts is the ONLY file allowed to import pdf-parse.
  // It is still subject to: HTTP imports (undici/http/https/node:http/node:https),
  // citation-js chokepoint, and all other project-wide restrictions.
  {
    files: ['bin/lib/pdf-text.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'undici',     message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'http',       message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:http',  message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'https',      message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:https', message: 'Import HTTP only via bin/lib/http.ts' },
          {
            name: 'citation-js',
            message: 'citation-js must only be imported from bin/lib/citations.ts (D-19 chokepoint). All BibTeX parsing and APA rendering routes through that single wrapper.',
          },
          // pdf-parse is ALLOWED in this file only (exempted by omission from the list).
        ],
      }],
    },
  },

  // === citation-js chokepoint EXEMPTION for bin/lib/citations.ts (Phase 3, D-19) ===
  // bin/lib/citations.ts is the ONLY file allowed to import citation-js.
  // It is still subject to: HTTP imports, pdf-parse chokepoint, and all other
  // project-wide restrictions.
  {
    files: ['bin/lib/citations.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'undici',     message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'http',       message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:http',  message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'https',      message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:https', message: 'Import HTTP only via bin/lib/http.ts' },
          {
            name: 'pdf-parse',
            message: 'pdf-parse must only be imported from bin/lib/pdf-text.ts (D-06, T-3-11 chokepoint). All PDF text extraction routes through that single wrapper.',
          },
          {
            name: 'pdf-parse/lib/pdf-parse.js',
            message: 'Direct sub-path import is exempt only inside bin/lib/pdf-text.ts (D-06 ENOENT workaround). Other code MUST go through bin/lib/pdf-text.ts.',
          },
          // citation-js is ALLOWED in this file only (exempted by omission from the list).
        ],
      }],
    },
  },

  // === DOI chokepoint EXEMPTION for bin/lib/doi.ts (lands Phase 1) ===
  {
    files: ['bin/lib/doi.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // === atomic-write chokepoint EXEMPTION for bin/lib/atomic-write.ts (lands Phase 1, Wave 2) ===
  {
    files: ['bin/lib/atomic-write.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // === paths chokepoint EXEMPTION for bin/lib/paths.ts (lands Phase 1, Wave 1) ===
  {
    files: ['bin/lib/paths.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // === HTTP/path chokepoint EXEMPTIONS for HTTP test files (Wave 5) ===
  // tests/http.test.ts and tests/http-cache.test.ts MUST import undici
  // (MockAgent / setGlobalDispatcher) to install cassette interceptors —
  // there is no other way to test bin/lib/http.ts without live network.
  // They MUST also override process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME
  // to redirect pensmithHttpCacheDir() into a per-test tmpdir for isolation.
  // Both exemptions are scoped to these test files only.
  {
    files: [
      'tests/http.test.ts',
      'tests/http-cache.test.ts',
      'tests/http-cache-no-header-leak.test.ts',
      'tests/retry.test.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // === Path chokepoint EXEMPTION for tests/session-log.test.ts (Wave 9) +
  //     tests/state.test.ts (Wave 10) + tests/library.test.ts (Wave 10) +
  //     tests/checkpoint.test.ts (Wave 10) + tests/runtime.test.ts (Wave 11) ===
  // All five files MUST override process.env.LOCALAPPDATA / XDG_DATA_HOME /
  // HOME to redirect pensmithDataDir() into a per-test tmpdir for isolation —
  // same pattern as tests/http.test.ts and tests/http-cache.test.ts.
  // tests/state.test.ts, tests/library.test.ts, tests/checkpoint.test.ts, and
  // tests/runtime.test.ts all use the override so the session-log singleton
  // inside bin/lib/state.ts, bin/lib/library.ts, bin/lib/checkpoint.ts, and
  // bin/lib/runtime.ts (lazy-init at first .event() call) resolves into the
  // per-test tmpdir instead of the host's real pensmithDataDir.
  // tests/runtime.test.ts ALSO needs the override because runtime.ts persists
  // its global runtime.json under pensmithDataDir() — without redirecting
  // LOCALAPPDATA the test would clobber the user's real runtime.json (or
  // worse, fail with EACCES on a sealed sysdir).
  // Scoped to these five files only.
  {
    files: [
      'tests/session-log.test.ts',
      'tests/state.test.ts',
      'tests/library.test.ts',
      'tests/checkpoint.test.ts',
      'tests/runtime.test.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // === atomic-write + thin-shim EXEMPTION for tests/lint-thin-shim.test.ts (Phase 2, Wave 1) ===
  // tests/lint-thin-shim.test.ts (Test 2) MUST write a temporary copy of the
  // D-09 fixture under mcp/ so the file-scoped no-restricted-imports rule fires
  // (the rule targets mcp/**/*.ts; the original fixture lives under tests/fixtures/).
  // This write is a test-only helper action, NOT production code — it is cleaned up
  // in a try/finally block immediately after the ESLint run.
  // The D-07 writeFile chokepoint (CallExpression[callee.property.name='writeFile'])
  // correctly fires on this usage; this exemption acknowledges it is deliberate.
  {
    files: ['tests/lint-thin-shim.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // === D-09: MCP thin-shim chokepoint (Phase 2) ===
  // mcp/**/*.ts handlers MUST NOT import fs / fs/promises / node:fs /
  // node:fs/promises directly. Business logic must live in bin/lib/* so
  // the MCP layer stays a thin shim (D-09). HTTP imports (undici / http /
  // https / node:http / node:https) are already blocked project-wide by the
  // rule above; this block adds the fs ban scoped to mcp/** only.
  //
  // The handler-statement-count budget (≤30) is enforced by the AST walk
  // in tests/lint-thin-shim.test.ts (Test 3), not here, because
  // no-restricted-syntax cannot count statement-body length in a single
  // selector. The test file does that walk programmatically.
  {
    files: ['mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'fs',               message: 'D-09 thin-shim: mcp handlers must not touch fs directly — delegate to bin/lib/*' },
          { name: 'node:fs',          message: 'D-09 thin-shim: mcp handlers must not touch fs directly — delegate to bin/lib/*' },
          { name: 'fs/promises',      message: 'D-09 thin-shim: mcp handlers must not touch fs directly — delegate to bin/lib/*' },
          { name: 'node:fs/promises', message: 'D-09 thin-shim: mcp handlers must not touch fs directly — delegate to bin/lib/*' },
          // HTTP imports already blocked project-wide by the rule in the main block above.
        ],
      }],
    },
  },

  // === D-10: MCP no-network chokepoint (Phase 2) ===
  // mcp/**/*.ts MUST NOT start a server on any network transport.
  // Stdio is the only allowed transport (per D-10 lock). Future SSE/HTTP
  // is a separate phase decision with its own auth design.
  //
  // The HTTP-imports rule above (lines 40-48) already blocks the
  // `http`/`https`/`net` MODULE imports project-wide; this block extends
  // the ban to the CALL-SITE level inside mcp/** so a developer can't
  // sneak in a server via dynamic import or destructured re-export.
  //
  // ESLint 9 flat-config semantics: a file-scoped block OVERRIDES the
  // project-wide no-restricted-syntax rule for matched files. To avoid
  // silently losing the D-07 / D-41 selectors on mcp/**/*.ts files, all
  // project-wide selectors are re-listed here alongside the D-10 additions.
  {
    files: ['mcp/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        // project-wide selectors re-listed (D-07, D-41 — override-merge safety):
        { selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]', message: 'DOI regex /^10\\./ is a chokepoint — use bin/lib/doi.ts only' },
        { selector: "CallExpression[callee.property.name='writeFile']", message: 'Direct fs.writeFile is forbidden (ARCH-05 / D-07) — use bin/lib/atomic-write.ts' },
        { selector: "MemberExpression[object.name='os'][property.name='homedir']", message: 'os.homedir() is a chokepoint (D-41) — use bin/lib/paths.ts' },
        { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='LOCALAPPDATA']", message: 'process.env.LOCALAPPDATA is a chokepoint (D-41) — use bin/lib/paths.ts' },
        { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='APPDATA']", message: 'process.env.APPDATA is a chokepoint (D-41) — use bin/lib/paths.ts (use LOCALAPPDATA, not APPDATA — Pitfall 4)' },
        { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='XDG_DATA_HOME']", message: 'process.env.XDG_DATA_HOME is a chokepoint (D-41) — use bin/lib/paths.ts' },
        // D-10 stdio-only selectors:
        { selector: "CallExpression[callee.object.name='net'][callee.property.name='createServer']", message: 'D-10 stdio-only: net.createServer() is forbidden in mcp/ — only stdio transport is allowed' },
        { selector: "CallExpression[callee.object.name='http'][callee.property.name='createServer']", message: 'D-10 stdio-only: http.createServer() is forbidden in mcp/ — only stdio transport is allowed' },
        { selector: "CallExpression[callee.object.name='https'][callee.property.name='createServer']", message: 'D-10 stdio-only: https.createServer() is forbidden in mcp/ — only stdio transport is allowed' },
        { selector: "CallExpression[callee.object.name='tls'][callee.property.name='createServer']", message: 'D-10 stdio-only: tls.createServer() is forbidden in mcp/ — only stdio transport is allowed' },
        { selector: "NewExpression[callee.name='Server']", message: 'D-10 stdio-only: new Server() is forbidden in mcp/ — only stdio transport is allowed' },
      ],
    },
  },

  // === atomic-write + no-network EXEMPTION for tests/lint-mcp-no-network.test.ts (Phase 2, Wave 1) ===
  // tests/lint-mcp-no-network.test.ts (Test 2) MUST write a temporary copy of the
  // D-10 fixture under mcp/ so the file-scoped no-restricted-syntax D-10 rule fires
  // (the rule targets mcp/**/*.ts; the original fixture lives under tests/fixtures/).
  // This write is a test-only helper action, NOT production code — it is cleaned up
  // in a try/finally block immediately after the ESLint run.
  // The D-07 writeFile chokepoint (CallExpression[callee.property.name='writeFile'])
  // correctly fires on this usage; this exemption acknowledges it is deliberate.
  {
    files: ['tests/lint-mcp-no-network.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // === D-12: capabilities-no-leak chokepoint (file-scoped to mcp/**/*.ts) ===
  // D-12 forbids (a) computed process.env[…] reads and (b) inline calls to the
  // runtime.ts secret-resolution helpers (getProviderApiKey / getOpenAlexApiKey /
  // loadRuntimeConfig) inside mcp/**. The paper://capabilities handler MUST expose
  // only presence flags — never resolved key values.
  //
  // ESLint 9 flat-config semantics: this file-scoped block OVERRIDES the
  // previous mcp/**/*.ts block for no-restricted-syntax (last-match wins per
  // rule name). To avoid silently losing D-07 / D-41 / D-10 coverage, all
  // selectors from those prior blocks are re-listed here.
  {
    files: ['mcp/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        // project-wide selectors re-listed (D-07, D-41 — override-merge safety):
        { selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]', message: 'DOI regex /^10\\./ is a chokepoint — use bin/lib/doi.ts only' },
        { selector: "CallExpression[callee.property.name='writeFile']", message: 'Direct fs.writeFile is forbidden (ARCH-05 / D-07) — use bin/lib/atomic-write.ts' },
        { selector: "MemberExpression[object.name='os'][property.name='homedir']", message: 'os.homedir() is a chokepoint (D-41) — use bin/lib/paths.ts' },
        { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='LOCALAPPDATA']", message: 'process.env.LOCALAPPDATA is a chokepoint (D-41) — use bin/lib/paths.ts' },
        { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='APPDATA']", message: 'process.env.APPDATA is a chokepoint (D-41) — use bin/lib/paths.ts (use LOCALAPPDATA, not APPDATA — Pitfall 4)' },
        { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='XDG_DATA_HOME']", message: 'process.env.XDG_DATA_HOME is a chokepoint (D-41) — use bin/lib/paths.ts' },
        // D-10 stdio-only selectors re-listed (from 02-02, override-merge safety):
        { selector: "CallExpression[callee.object.name='net'][callee.property.name='createServer']", message: 'D-10 stdio-only: net.createServer() is forbidden in mcp/ — only stdio transport is allowed' },
        { selector: "CallExpression[callee.object.name='http'][callee.property.name='createServer']", message: 'D-10 stdio-only: http.createServer() is forbidden in mcp/ — only stdio transport is allowed' },
        { selector: "CallExpression[callee.object.name='https'][callee.property.name='createServer']", message: 'D-10 stdio-only: https.createServer() is forbidden in mcp/ — only stdio transport is allowed' },
        { selector: "CallExpression[callee.object.name='tls'][callee.property.name='createServer']", message: 'D-10 stdio-only: tls.createServer() is forbidden in mcp/ — only stdio transport is allowed' },
        { selector: "NewExpression[callee.name='Server']", message: 'D-10 stdio-only: new Server() is forbidden in mcp/ — only stdio transport is allowed' },
        // ---- D-12 (this plan) ----
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][computed=true]",
          message: 'D-12: computed process.env[…] read forbidden in mcp/**. Capabilities must surface only presence flags. Read secrets via bin/lib/runtime.ts in non-mcp code, then expose boolean to mcp via paper://state.',
        },
        {
          selector: "CallExpression[callee.name=/^(getProviderApiKey|getOpenAlexApiKey|loadRuntimeConfig)$/]",
          message: 'D-12: do not call runtime.ts secret-resolution helpers inside mcp/**. Those return the resolved value to the caller. Expose presence flags only via paper://capabilities.',
        },
      ],
    },
  },

  // === D-12 — doctor-probe scope extension (plan-checker iter 2, B5) ===
  // Forbids computed process.env access in ALL doctor probes except
  // runtime-config-presence.ts (which legitimately does the bound-plus-discard
  // pattern). The discard-discipline inside runtime-config-presence.ts is
  // enforced by 02-05's sentinel-value leak test (T-02-05-01).
  {
    files: ['bin/lib/doctor/probes/**/*.ts'],
    ignores: ['bin/lib/doctor/probes/runtime-config-presence.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][computed=true]",
          message: 'D-12 (doctor-probe scope): computed process.env[…] reads are forbidden in doctor probes other than runtime-config-presence.ts. Only the runtime-config-presence probe is permitted to bind process.env[provider.apiKeyEnv] (with immediate length-test discard, T-02-05-01 sentinel-tested).',
        },
      ],
    },
  },

  // === D-12 — runtime-config-presence no-leak backstop ===
  // The bound-plus-discard pattern in runtime-config-presence.ts is allowed by
  // the doctor-probe block above. This block adds a STATIC backstop: identifiers
  // named v/value/secret/token/apiKey/providerKey must NEVER be JSON.stringify'd
  // or interpolated into a template literal inside that probe. The 02-05 sentinel
  // test (T-02-05-01) is the dynamic backstop; this lint rule is the static one.
  {
    files: ['bin/lib/doctor/probes/runtime-config-presence.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.object.name='JSON'][callee.property.name='stringify'] Identifier[name=/^(v|value|secret|token|apiKey|providerKey)$/]",
          message: 'D-12: runtime-config-presence.ts must NEVER JSON.stringify a resolved-key identifier. Serialise only the {name, apiKeyEnv, present} shape.',
        },
        {
          selector: "TemplateLiteral > TemplateElement + Identifier[name=/^(v|value|secret|token|apiKey|providerKey)$/]",
          message: 'D-12: runtime-config-presence.ts must NEVER interpolate a resolved-key identifier into a result string. Use the boolean `present` flag only.',
        },
      ],
    },
  },

  // === atomic-write EXEMPTION for tests/lint-capabilities-noleak.test.ts (Phase 2, Wave 1) ===
  // tests/lint-capabilities-noleak.test.ts (PROJECT test) MUST copy the D-12 fixture
  // under mcp/ so the file-scoped no-restricted-syntax D-12 rule fires. The copy is
  // cleaned up in a try/finally block immediately after the ESLint run.
  // The D-07 writeFile chokepoint (CallExpression[callee.property.name='writeFile'])
  // correctly fires on this usage; this exemption acknowledges it is deliberate.
  {
    files: ['tests/lint-capabilities-noleak.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // === Red-team fixture exemption (D-08 + D-09 + D-10) ===
  // Each fixture INTENTIONALLY violates a chokepoint. Fixtures are executed
  // by their corresponding lint-*.test.ts files which run ESLint
  // programmatically and assert the errors are flagged. Project lint must
  // NOT see them.
  //
  // WR-04: mcp/__fixtures__/ is the dedicated subdir where lint-thin-shim,
  // lint-mcp-no-network, and lint-capabilities-noleak tests stage temp
  // copies of the originals so the file-scoped mcp/**/*.ts chokepoints
  // fire. Ignored from `npm run lint` so stale copies (after a crash) do
  // not turn into project-lint noise. The PROGRAMMATIC ESLint runs inside
  // those tests use overrideConfig + their own globs, so the rules still
  // fire there.
  {
    ignores: [
      'tests/fixtures/lint-capabilities-noleak-fixture.ts',
      'tests/fixtures/lint-chokepoint-fixture.ts',
      'tests/fixtures/lint-atomic-write-chokepoint-fixture.ts',
      'tests/fixtures/lint-mcp-no-network-fixture.ts',
      'tests/fixtures/lint-paths-chokepoint-fixture.ts',
      'tests/fixtures/lint-thin-shim-fixture.ts',
      'mcp/__fixtures__/**',
      'dist/**',
      'node_modules/**',
    ],
  },

  // === CommonJS validator script + test-helper exemption (D-17) ===
  // scripts/validate-plugin-manifest.cjs is intentionally CommonJS (uses require())
  // because package.json has "type":"module" — the .cjs extension is mandatory so
  // Node loads it as CJS. The @typescript-eslint/no-require-imports rule must be
  // disabled for this file only.
  //
  // tests/lock-conflict.cjs (W3, lock conflict spawn helper) is also intentionally
  // .cjs — it is spawned by node directly with no tsx loader and must `require()`
  // proper-lockfile (which is itself CJS-only). See tests/lock-conflict.cjs header.
  {
    files: ['scripts/**/*.cjs', 'tests/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
