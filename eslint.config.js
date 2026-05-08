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
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'undici',     message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'http',       message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:http',  message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'https',      message: 'Import HTTP only via bin/lib/http.ts' },
          { name: 'node:https', message: 'Import HTTP only via bin/lib/http.ts' },
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
    files: ['tests/http.test.ts', 'tests/http-cache.test.ts', 'tests/retry.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // === Red-team fixture exemption (D-08) ===
  // The fixture INTENTIONALLY violates both chokepoints. It is executed
  // by tests/lint-chokepoint.test.ts which runs ESLint programmatically
  // and asserts both errors are flagged. Project lint must NOT see it.
  {
    ignores: [
      'tests/fixtures/lint-chokepoint-fixture.ts',
      'tests/fixtures/lint-atomic-write-chokepoint-fixture.ts',
      'tests/fixtures/lint-paths-chokepoint-fixture.ts',
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
