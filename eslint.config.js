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

// bin/lib/http-mock.ts reads tests/fixtures. Production code must never import
// it; bin/lib/http.ts loads it lazily, and only under PENSMITH_TEST_CASSETTES=1.
const HTTP_MOCK_PATTERN = {
  group: ['**/http-mock', '**/http-mock.js', '**/http-mock.ts'],
  message: 'http-mock is test-only (cassette replay). Production code must not import it; http.ts loads it lazily in test runs.',
};

// Restricted import paths, shared by the base block and each per-file block
// that exempts one chokepoint module from its own entry.
const HTTP_PATHS = ['undici', 'http', 'node:http', 'https', 'node:https'].map((name) => ({
  name,
  message: 'Import HTTP only via bin/lib/http.ts',
}));
const PDF_PARSE_PATHS = [
  {
    name: 'pdf-parse',
    message: 'pdf-parse must only be imported from bin/lib/pdf-text.ts (D-06, T-3-11 chokepoint). All PDF text extraction routes through that single wrapper.',
  },
  {
    name: 'pdf-parse/lib/pdf-parse.js',
    message: 'Direct sub-path import is exempt only inside bin/lib/pdf-text.ts (D-06 ENOENT workaround). Other code MUST go through bin/lib/pdf-text.ts.',
  },
];
const CITATION_JS_PATH = {
  name: 'citation-js',
  message: 'citation-js must only be imported from bin/lib/citations.ts (D-19 chokepoint). All BibTeX parsing and APA rendering routes through that single wrapper.',
};

export default [
  ...tseslint.configs.recommended,

  {
    files: ['bin/**/*.ts', 'hooks/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // === D-06: HTTP chokepoint — applies EVERYWHERE by default ===
      // === D-06/T-3-11 (Phase 3): pdf-parse chokepoint — applies EVERYWHERE by default ===
      // === D-19 (Phase 3): citation-js chokepoint — applies EVERYWHERE by default ===
      'no-restricted-imports': ['error', {
        paths: [...HTTP_PATHS, ...PDF_PARSE_PATHS, CITATION_JS_PATH],
      }],

      // === D-07 (Phase 0): DOI regex chokepoint ===
      // AST selector for a regex literal whose pattern starts with "^10."
      // The pattern /^10\./ contains no forward slash so the ESLint
      // Selectors esquery forward-slash workaround does not apply here.
      // DO NOT simplify the escapes — see Pitfall B.
      // === D-07 (Phase 1): atomic-write chokepoint — bans direct fs.writeFile / fs.promises.writeFile outside bin/lib/atomic-write.ts ===
      // === D-41 (Phase 1): paths chokepoint — bans os.homedir(), a bare homedir import/call, and process.env.{LOCALAPPDATA,APPDATA,XDG_DATA_HOME} outside bin/lib/paths.ts ===
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
        // A named `import { homedir } from 'node:os'` and its bare call slip past
        // the member selector above, so ban both forms too.
        {
          selector: "ImportSpecifier[imported.name='homedir']",
          message: 'homedir is a chokepoint (D-41) — import home-directory paths from bin/lib/paths.ts',
        },
        {
          selector: "CallExpression[callee.type='Identifier'][callee.name='homedir']",
          message: 'homedir() is a chokepoint (D-41) — use bin/lib/paths.ts',
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

  // === Test-fixture isolation for production code ===
  // Same restricted paths as above, plus the cassette module.
  {
    files: ['bin/**/*.ts', 'mcp/**/*.ts', 'hooks/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [...HTTP_PATHS, ...PDF_PARSE_PATHS, CITATION_JS_PATH],
        patterns: [HTTP_MOCK_PATTERN],
      }],
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
        // pdf-parse is ALLOWED in this file only (exempted by omission from the list).
        paths: [...HTTP_PATHS, CITATION_JS_PATH],
        patterns: [HTTP_MOCK_PATTERN],
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
        // citation-js is ALLOWED in this file only (exempted by omission from the list).
        paths: [...HTTP_PATHS, ...PDF_PARSE_PATHS],
        patterns: [HTTP_MOCK_PATTERN],
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
      // audit #29: must import undici MockAgent to reply with binary bytes and
      // assert http.ts exposes byte-faithful bodyBytes (no other way to test it).
      'tests/http-binary-body.test.ts',
      // Counts requests with a MockAgent to prove offline and cassette modes
      // never reach the network and live mode does.
      'tests/network-mode.test.ts',
      // Counts the Crossref requests `add <doi>` sends with a MockAgent, and
      // points the HTTP cache at a folder that cannot be written.
      'tests/add-doi-single-fetch.test.ts',
      // Must import undici MockAgent to prove the arXiv adapter only talks
      // https, and redirect the HTTP cache into a per-test tmpdir.
      'tests/sources/arxiv-https.test.ts',
      // Fails the first Unpaywall lookup or PDF fetch with a MockAgent to
      // prove Pass 3 asks again for the next quotation of the same source.
      'tests/pass3-source-lookup.test.ts',
      // Answers Pass 1's registry lookups with a MockAgent to check the live
      // request path: mailto, retries, doi.org redirects, Open Library gaps.
      'tests/sources/registry-lookups.test.ts',
      // Answers Crossref, DataCite and OpenAlex with a MockAgent to check which
      // registry answers make a citation RETRACTED on the live request path.
      'tests/sources/retraction-signals.test.ts',
      // The MockAgent harness the two files above share: installs the agent
      // and points the HTTP cache at a per-test tmpdir.
      'tests/lib/mock-registries.ts',
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
      // audit M3: overrides LOCALAPPDATA/XDG_DATA_HOME to isolate the global
      // registry into a per-test tmpdir while exercising the dead-entry GC.
      'tests/registry-gc.test.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // === Path chokepoint EXEMPTION for Phase 8 Wave-0 RED-by-skip env-override tests ===
  // tests/global-library.test.ts, tests/style-match.test.ts,
  // tests/intake-style-producer.test.ts, and tests/write-style-integration.test.ts
  // all override process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME to redirect
  // pensmithDataDir() (where the global library index + the style-fingerprint
  // registry live) into a per-test tmpdir — the IDENTICAL isolation pattern as
  // tests/library.test.ts / tests/state.test.ts above. Scoped to these four
  // files only. (tests/pymupdf-shellout.test.ts is NOT listed: it overrides only
  // PENSMITH_PYTHON, which is not a D-41 chokepoint env var.)
  {
    files: [
      'tests/global-library.test.ts',
      'tests/style-match.test.ts',
      'tests/intake-style-producer.test.ts',
      'tests/write-style-integration.test.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // === Path chokepoint EXEMPTION for Phase 9 educator/tutorial + PII tests ===
  // These four suites override process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME
  // to redirect pensmithDataDir() / paperDir() into a per-test tmpdir — the
  // IDENTICAL isolation pattern as the Phase-8 group above (and library/state).
  // intake-pii-{ordering,egress} drive the live intake verb (PII redaction +
  // config.toml persistence) in a tmp root; tutorial-provenance + goal-routing
  // seed a tmp paper. Scoped to these four files only.
  {
    files: [
      'tests/intake-pii-ordering.test.ts',
      'tests/intake-pii-egress.test.ts',
      'tests/tutorial-provenance.test.ts',
      'tests/tutorial-observer.test.ts',
      'tests/goal-routing.test.ts',
      'tests/goal-learning-endstate.test.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // === Path chokepoint EXEMPTION for Phase 12 live-research / intake-bootstrap / humanizer-task tests ===
  // These three suites override process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME to
  // redirect pensmithDataDir() / paperDir() into a per-test tmpdir — the IDENTICAL
  // isolation pattern as the Phase-8/9 groups above. research-discovery drives the
  // live adapter fan-out (cassette-backed) + intake STATE.json bootstrap + humanizer
  // Task seam in a tmp root. Scoped to these three files only.
  {
    files: [
      'tests/research-discovery.test.ts',
      'tests/intake-bootstrap.test.ts',
      'tests/humanizer-task.test.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
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

  // === Red-team fixture exemption ===
  // Each fixture INTENTIONALLY violates a chokepoint. Fixtures are executed
  // by their corresponding lint-*.test.ts files which run ESLint
  // programmatically and assert the errors are flagged. Project lint must
  // NOT see them.
  {
    ignores: [
      'tests/fixtures/lint-chokepoint-fixture.ts',
      'tests/fixtures/lint-atomic-write-chokepoint-fixture.ts',
      'tests/fixtures/lint-paths-chokepoint-fixture.ts',
      'dist/**',
      // Generated esbuild bundles (scripts/bundle.mjs); lint their sources instead.
      'plugin/dist/**',
      'node_modules/**',
    ],
  },

  // === HTTP/path chokepoint EXEMPTION for tests/llm-transport.test.ts (Phase 11) ===
  // tests/llm-transport.test.ts MUST import undici (MockAgent / setGlobalDispatcher)
  // to intercept LLM REST calls routed through bin/lib/http.ts (same as http.test.ts).
  // It also MUST use fsp.writeFile directly to seed COSTS.jsonl for the budget-gate
  // test (T-11-02) — this is test-only setup code, not production artifact I/O.
  // Scoped to this test file only.
  {
    files: ['tests/llm-transport.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
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
