# Stack Research — pensmith

**Domain:** Claude Code plugin (Tier 1) + portable Node CLI (Tier 2) for AI-assisted academic paper writing with citation verification
**Researched:** 2026-05-06
**Overall confidence:** HIGH for foundational layer (plugin schema, Node ecosystem, MCP SDK), MEDIUM for citation/source clients (sparse Node ecosystem; mostly raw fetch is the answer), MEDIUM-LOW for PDF parsing (active churn in space; recommendation is opinionated)

> One-line summary: **TypeScript + ESM, native `fetch`/`undici`, MCP via the official `@modelcontextprotocol/sdk`, citty for the CLI, `@clack/prompts` for stdin fallback, `pdf-parse` (pinned) for BYO PDFs with optional shell-out to `pymupdf`, `citation-js` for CSL/BibTeX, raw HTTP for source APIs, JSON file with file-lock for the library index, `node:test` (with c8 for coverage) plus `nock` for HTTP cassettes.**

---

## Recommended Stack

### Core technologies

| Technology | Version | Purpose | Why recommended |
|---|---|---|---|
| **Node.js** | `>=20.10` (LTS), targeting `>=22` features where useful | Runtime for both tiers | Node 20 is LTS through 2026; Node 22 ships native TypeScript stripping (`--experimental-strip-types`) and native `node:sqlite`. Node 18 is EOL April 2025 — do not target it. PRD §13 already implies Node-only. |
| **TypeScript** | `5.6+` | Source language | Even though PRD §13 lists `.js` extensions, every modern Claude Code plugin published in 2026 (including `gsd-plugin`) ships TS. Compile to `.js` for Node consumption; emit `.d.ts` for the MCP server consumers; preserves PRD §13 file layout. **Use `tsx` for local dev, `tsc --noEmit` for typecheck, no bundler for the runtime — Node loads emitted `.js` directly.** |
| **Module system** | ESM (`"type": "module"`) | Module format | All current MCP SDK examples and Claude Code plugin examples are ESM. Citty is ESM-only as of v0.2. CommonJS is legacy. The one exception is hook scripts and the MCP server entry, which can be `.cjs` for fastest startup if needed (gsd-plugin uses `.cjs` for hooks per their repo) — but TS-compiled ESM `.js` works fine for Node ≥20. |
| **`@modelcontextprotocol/sdk`** | `^1.29.0` | Tier 1 MCP server | Official TypeScript SDK from Anthropic / MCP authors. Implements full MCP spec (tools, resources, prompts, stdio + HTTP transports). Authoritative, current (last published April 2026), zero risk of protocol drift. **Hand-rolled JSON-RPC is rejected** — see "What NOT to Use." |
| **Claude Code plugin schema** | n/a (manifest format, not a dep) | Tier 1 packaging | `.claude-plugin/plugin.json` is the manifest; only `name` is required. `.claude-plugin/marketplace.json` describes a marketplace entry. Skills live in `skills/<name>/SKILL.md`, agents in `agents/*.md`, hooks in `hooks/hooks.json` (or inline), MCP in `.mcp.json` (or inline). Pensmith should put MCP config in standalone `.mcp.json` per PRD §13 layout. |

### CLI ergonomics (Tier 2)

| Library | Version | Purpose | When to use |
|---|---|---|---|
| **`citty`** | `^0.2.x` | CLI argument parser, subcommand router | UnJS framework. Zero deps as of v0.2, ~22.8 kB, ESM-only, TypeScript-first, native `node:util.parseArgs` under the hood, supports lazy-loaded subcommands (matters because pensmith has ~15 verbs and a hidden plumbing namespace). Citty's nested-subcommand model maps cleanly onto `pensmith <verb>` / `pensmith:plan-section <N>`. Confidence: HIGH. |
| **`@clack/prompts`** | `^0.7.x` | Interactive prompts (stdin fallback when AskUserQuestion unavailable) | ~4 kB gzipped. Beautiful out-of-box, no theming layer, no plugin registry, function-style API. Modern replacement for inquirer.js. Inquirer is mature but heavy and dated; `prompts` is fine but uglier; clack is the 2025/2026 default for new CLIs. PRD §7.1 needs select / text / confirm — clack covers all of them. |
| **`picocolors`** | `^1.1.x` | Terminal colors | 6.37 kB, fastest, zero deps, actively maintained. Chalk is fine but 7× larger and 13× slower load. Kleur is fast but stale (3+ years). Picocolors is the e18e-recommended chalk replacement. |
| **`yoctocolors`** | (alternative) | Terminal colors | Sindre Sorhus' picocolors equivalent, also fine. Pick one and stick. |

### HTTP + caching (both tiers)

| Library | Version | Purpose | When to use |
|---|---|---|---|
| **`undici`** | `^7.x` (bundled in Node 22; install explicit pinned version for Node 20) | HTTP/1.1 client | Node's official HTTP client (the engine behind `globalThis.fetch`). v7 introduced RFC-9111 compliant client-side caching with in-memory and SQLite stores. Backoff is not built-in but interceptor architecture makes it easy. **Use `undici` request directly for source-API calls** (Crossref/OpenAlex/arXiv/PubMed) where you want explicit cache control + interceptors. Use `globalThis.fetch` (which delegates to undici) for one-off calls where simplicity wins. |
| **Built-in `fetch`** | n/a (Node 18+) | One-off HTTP | Native, no dep cost. Backed by undici under the hood. Use for hot paths where you don't need cache interceptors. |
| **`p-retry`** | `^6.x` | Exponential backoff with jitter | Sindre Sorhus' canonical retry helper; works with any promise. PRD §10 specifies `http_max_retries`, `http_backoff_base_ms`, exponential w/ jitter — `p-retry` is the idiomatic wrapper. Alternative: hand-roll in `bin/lib/http.js` (also fine, ~30 lines). Confidence: HIGH for `p-retry`, MEDIUM for hand-roll (no dep but more code to test). |
| **disk cache** | hand-rolled `bin/lib/http-cache.js` over `fs/promises` | TTL-keyed response store | `cacache` (npm's content-addressable cache) is overkill — it's designed for tarballs and integrity hashing, not a 24h TTL on Crossref JSON. Hand-roll a tiny `cacheKey → JSON file` store keyed by `sha256(method + url + body)`, with a separate `meta.json` recording TTL. ~50 LOC, fully testable. Alternative: undici v7's built-in `CacheStore` with the SQLite store backend if you want HTTP-semantic caching (Vary, max-age, etc.) — recommended for the HTTP layer if you can take the dep. |

### Source API clients (no Node-native libraries; raw HTTP is idiomatic)

| Source | Recommended approach | Notes |
|---|---|---|
| **OpenAlex** | Raw `fetch` against `api.openalex.org` | No actively maintained Node client. Python (`pyalex`) and R clients exist; nothing comparable for Node. Polite pool requires `mailto=<PENSMITH_CONTACT_EMAIL>` query param — wire this through `bin/lib/http.js`. Free, no key. |
| **Crossref** | Raw `fetch` against `api.crossref.org` | Same story. Polite pool also expects `mailto`. Some `crossref-api`-named npm packages exist but are unmaintained one-person efforts. Raw fetch + a thin typed wrapper is the right call. |
| **arXiv** | Raw `fetch` against `export.arxiv.org/api`, parse Atom XML | Returns Atom XML, not JSON. Use `fast-xml-parser` (`^4.x`) for parsing — actively maintained, zero dep, fastest XML parser in Node. |
| **PubMed (NCBI E-utilities)** | Raw `fetch` against `eutils.ncbi.nlm.nih.gov` | Returns XML or JSON depending on endpoint. Same `fast-xml-parser` covers both. Polite User-Agent expected; rate limits 3 req/sec without API key, 10 req/sec with. |
| **Semantic Scholar** | Raw `fetch` against `api.semanticscholar.org` | JSON. No-key tier is heavily rate-limited (100 req/5min). Use sparingly. |
| **Unpaywall** | Raw `fetch` against `api.unpaywall.org` | Requires `email` query param (mandatory, not just polite). Free. |
| **Retraction Watch** | Raw `fetch` against `api.labs.crossref.org/retractions` | JSON. Used at recheck time only. |
| **DuckDuckGo HTML (plagiarism)** | Raw `fetch` against `html.duckduckgo.com/html/`, parse with `cheerio` | No formal API. Use `cheerio` (`^1.x`) for HTML parsing; it's the jQuery-compatible Node HTML parser. PRD §7.17 explicitly chose DDG. |
| **GPTZero** | Raw `fetch` against `api.gptzero.me` | Free tier; key may be required, check at runtime. |

**Verdict on dedicated source clients: skip them all.** Centralize in `bin/lib/sources.js` (PRD §13) with a thin per-source adapter pattern. Each adapter exports a typed function. This gives pensmith full control over caching, retry, polite UA, and DOI normalization — all of which PRD §14 says must go through `bin/lib/http.js`. Confidence: HIGH (this is what every Python/R researcher does too — there's no missing community wisdom here).

### PDF parsing (BYO assigned-readings ingestion)

| Library | Version | Purpose | When to use |
|---|---|---|---|
| **`pdf-parse`** | `^2.4.x` (pinned) | Primary text extraction | Pure JS wrapper around `pdfjs-dist`. Despite "abandoned?" rumors, repo is active in 2026 (v2.4.5 latest). Simple API: returns text + metadata + page count. Sufficient for the ~80% case (PDFs with embedded text). PRD §9 already names it. **Pin the version** — historically this package has had release-day bustups. |
| **shell-out to `pymupdf`** | system tool | Fallback for higher-fidelity layout | If user has `pymupdf` (Python) installed, shell out for a second pass when `pdf-parse` returns suspiciously little text or garbled output. PRD §9 calls this out explicitly. Detected via `bin/lib/ecosystem.js` (PRD §13). |
| **`unpdf`** | (alternative; not recommended for now) | UnJS modern PDF lib | Promising but newer; `pdf-parse` has the broader test surface for academic PDFs (which are messy). Revisit in v0.2. |
| **`pdfjs-dist`** | (used transitively via `pdf-parse`) | Mozilla's PDF.js core | Direct usage is overkill; `pdf-parse` already wraps it. Direct usage adds 9MB to the install. |

**Confidence: MEDIUM.** This is the single area of the stack with the most active churn in 2026. The `pdf-parse → pymupdf shellout` two-step is intentional defensive design.

### Citation formatting (BibTeX + CSL → APA/MLA/Chicago/IEEE/AMA/Vancouver)

| Library | Version | Purpose | When to use |
|---|---|---|---|
| **`citation-js`** | `^0.7.22` | CSL-based citation formatter | Primary tool. Converts BibTeX ↔ CSL-JSON and renders any of the 10,000+ CSL styles. PRD §7.9 needs APA, MLA, Chicago (NB + AD), IEEE, AMA, Vancouver — all standard CSL files. Hand-rolling six citation formatters is a multi-week project that gets the comma placement wrong. **Use citation-js + bundle the relevant CSL files in `templates/citation-styles/`.** |
| **`@citation-js/plugin-bibtex`** | `^0.7.x` | BibTeX in/out plugin | Companion plugin for BibTeX I/O. `.paper/CITATIONS.bib` reads/writes through this. |
| **Pandoc** (system tool) | n/a | `.docx`/`.pdf`/`.tex` export | PRD §11: detected at runtime, used for higher-fidelity export. Not a Node dep — shell out via `child_process` from `bin/lib/exporters.js`. Falls back to citation-js + markdown-to-docx if absent. |

### State persistence

| Choice | Use | Why |
|---|---|---|
| **JSON files + atomic write-then-rename** | `.paper/STATE.md`, `.paper/HANDOFF.json`, `.paper/sections/<N>/*.md`, `~/.pensmith/library/index.json` | PRD §14 mandates atomic writes and schema versioning. JSON files are: (a) git-friendly (paper folders may be committed), (b) trivially diffable, (c) zero-deps. Library index in JSON is fine for v0.1 (probably <1000 papers per user). |
| **`proper-lockfile`** | `^4.x` | Concurrent-run lock file | PRD §14 mandates a PID + timestamp lock with stale-clear. `proper-lockfile` (npm-published, used by npm itself) handles edge cases (stale detection via mtime, retry, race-free creation) that hand-rolled `fs.open(..., 'wx')` typically misses. |
| **`better-sqlite3`** | (deferred to v0.2 if library grows) | Optional library index upgrade path | Synchronous, fastest SQLite for Node, ideal for CLIs. Not needed for v0.1 — keep the library index in JSON, but design `bin/lib/library.js` so the persistence layer is swappable. **Do NOT ship native deps in v0.1** — `better-sqlite3` requires a C compiler at install time on platforms without prebuilt binaries; keeps Tier 2 install painless. |
| **Node 22 `node:sqlite`** | (alternative for future) | Built-in SQLite | Lands GA in Node 22. No native build step. Worth migrating to in v0.2 if SQLite is ever needed. |

### Auxiliary

| Library | Version | Purpose | When to use |
|---|---|---|---|
| **`zod`** | `^3.23.x` (or v4 if stable) | Runtime schema validation | Validate `.paper/config.toml`, `HANDOFF.json`, `state-v1.json` shapes at read time. PRD §14 mandates schema versioning — zod schemas double as the type definitions and the validators. |
| **`@iarna/toml`** or **`smol-toml`** | `^1.x` (smol-toml) | TOML parser | `.paper/config.toml` is TOML per PRD §10. `smol-toml` is the modern recommendation (zero dep, TOML 1.0 compliant). `@iarna/toml` works but is older. |
| **`fast-xml-parser`** | `^4.x` | Atom/XML for arXiv + PubMed | Already noted above. |
| **`cheerio`** | `^1.x` | HTML parsing for DDG plagiarism scraper | Already noted above. |
| **`fuse.js`** or **`fast-levenshtein`** | `^7.x` (fuse) | Fuzzy match for Pass-1 author/title verification | PRD §7.7 / §14: cited author/title must fuzzy-match canonical metadata. Fuse.js handles ranked fuzzy match with scoring; Levenshtein gives a raw distance. **Use Fuse.js** — score-based threshold is easier to tune and document. |
| **`tinyglobby`** | `^0.2.x` | Glob for finding section folders, BYO PDF dirs, style samples | Modern, fast, zero-dep. Replaces `glob` and `fast-glob`. e18e-recommended. |
| **`tar`** or **`tar-stream`** | (only if exporting `.zip` of paper bundle is added) | Archive | Not needed in v0.1 scope. |

### Runtime LLM clients (Tier 2)

| Library | Version | Purpose | When to use |
|---|---|---|---|
| **`openai`** | `^4.x` (TypeScript SDK) | OpenAI-compatible client (covers OpenAI, Ollama, vLLM, llama.cpp, OpenRouter, Together, etc.) | The OpenAI TS SDK supports `baseURL` override, which is the universal pattern for hitting any OpenAI-compatible endpoint. Tier 2 uses **one** client wrapper in `bin/lib/runtime.js` that defaults to OpenAI but flips `baseURL` based on `[runtime] provider` in config. Well-documented pattern. |
| **`@anthropic-ai/sdk`** | `^0.93.0` | Native Anthropic client when provider=anthropic | When a user runs Tier 2 against the Anthropic API directly, the native SDK gives best ergonomics (proper streaming events, tool-use schema). It also supports `baseURL` for hitting Ollama's Anthropic-compat endpoint (Ollama announced this in 2025). Wrap both behind `runtime.js` so the rest of pensmith's code is provider-agnostic. |
| **(Skip: Vercel `ai` / `ai-sdk`)** | — | (not recommended for v0.1) | Excellent SDK but adds a heavy abstraction layer + opinions about streaming UI. Pensmith's runtime layer is simpler than `ai`'s use case warrants. Revisit if multi-modal/tool-streaming gets messy. |

**Pattern:** `bin/lib/runtime.js` exports `chat({ messages, model, ... })` and internally branches on provider. PRD §10 lists `provider ∈ {anthropic, openai, ollama, vllm, openai-compatible}`. All except `anthropic` go through the OpenAI SDK with custom baseURL; `anthropic` uses `@anthropic-ai/sdk` directly (or also via OpenAI SDK against Anthropic's recently-shipped OpenAI-compat endpoint, but native SDK is more battle-tested for tool use).

### DOI / arXiv / PMID handling

| Library | Version | Purpose | When to use |
|---|---|---|---|
| **`doi-regex`** | `^0.1.17` | DOI matching regex | Maintained, MIT, ~12 LOC of regex packaged for reuse. Use for *extraction* from prose (Pass-1 verification). |
| **hand-rolled normalizer** | in `bin/lib/doi.js` | Canonicalization (`https://doi.org/X` → `X`, lower-case, strip `doi:` prefix) | No good library; PRD §13 already names this file. ~30 LOC. arXiv normalization (old `cs/0312001` vs new `2301.00001v2`) and PMID normalization also live here. |

### Detection / honesty

| Library | Version | Purpose | When to use |
|---|---|---|---|
| **GPTZero, Originality, Sapling** | n/a (HTTP only) | Detection backends per PRD §7.11 | All offer HTTP APIs. No SDK needed; raw fetch in `bin/lib/honesty.js`. PRD §10 makes the backend pluggable (`honesty_backend` config key). |

### PII redaction

| Library | Version | Purpose | When to use |
|---|---|---|---|
| **hand-rolled regex pass + Microsoft Presidio (optional Python shellout)** | — | Strip names, dates, IDs before LLM call | PRD §7.1 / §14: opt-in PII redaction. v0.1: regex-based redaction in `bin/lib/pii.js` (names via simple capitalized-word heuristic + dates via standard date regexes + `\b\d{3}-?\d{2}-?\d{4}\b` for SSN-shaped). Mark as `LOW` confidence intentionally — no Node-native PII library is actually good. Document this in PRIVACY.md. v0.2 path: shell out to Presidio if installed. |

---

## Tier-split: which deps belong to which tier

| Dependency | Tier 1 (plugin) | Tier 2 (CLI) | Notes |
|---|:-:|:-:|---|
| `@modelcontextprotocol/sdk` | YES | NO | MCP server is Tier 1 only (PRD §1, §13). |
| `@anthropic-ai/sdk` / `openai` | NO | YES | Tier 1 uses Claude Code's own LLM via Task tool / skill execution. |
| `citty` | NO | YES | Plugin slash commands route through Claude Code, not citty. |
| `@clack/prompts` | NO | YES | Plugin uses AskUserQuestion. Tier 2 fallback uses clack. |
| `picocolors` | NO | YES | Plugin output is rendered by Claude Code. |
| `pdf-parse`, `citation-js`, `fast-xml-parser`, `cheerio`, `proper-lockfile`, `zod`, `smol-toml`, `fuse.js`, `tinyglobby`, `doi-regex`, `undici`, `p-retry` | YES | YES | Shared via `bin/lib/*` — the source-of-truth (PRD §14). The MCP server in Tier 1 calls into the same `bin/lib/*` modules. |

**Single `package.json`.** All deps live in one root `package.json`. Tier 2 binary entry is `bin/pensmith-cli.js` (per PRD §13). Tier 1 plugin manifest just references the same files. No npm workspaces needed at v0.1.

---

## Installation

```bash
# Runtime deps (shared by both tiers)
npm install \
  @modelcontextprotocol/sdk \
  undici \
  p-retry \
  proper-lockfile \
  zod \
  smol-toml \
  citation-js @citation-js/plugin-bibtex \
  pdf-parse \
  fast-xml-parser \
  cheerio \
  fuse.js \
  tinyglobby \
  doi-regex

# Tier 2 CLI-only
npm install \
  citty \
  @clack/prompts \
  picocolors \
  openai \
  @anthropic-ai/sdk

# Dev dependencies
npm install -D \
  typescript@5.6 \
  tsx \
  @types/node \
  nock \
  c8
```

---

## Alternatives considered

| Recommended | Alternative | When to use alternative |
|---|---|---|
| `@modelcontextprotocol/sdk` | Hand-rolled JSON-RPC over stdio (gsd-plugin pattern with `mcp/server.cjs`) | Use only if SDK adds unacceptable bundle size or you need exotic transport. The gsd-plugin originally hand-rolled this; not worth the maintenance cost in 2026 with the SDK now stable. |
| `citty` | `commander` / `yargs` | Use commander if the team has strong familiarity; both are mature. Citty wins on size, ESM-native, TS-first; commander/yargs win on docs and longevity. |
| `citty` | Native `node:util.parseArgs` | Use only for trivial CLIs (1–2 commands). Pensmith has ~15 verbs + plumbing namespace — the routing logic alone justifies a framework. |
| `@clack/prompts` | `inquirer` / `prompts` / `enquirer` | Use inquirer if you need maximum prompt-type variety (multiline, autocomplete with custom rendering). Use `prompts` if you want zero opinions on style. Clack is the modern default. |
| `pdf-parse` | `unpdf` | Use `unpdf` in v0.2 if you need edge-runtime support (irrelevant for pensmith — it's a CLI). Use `pdfjs-dist` directly if you need fine control over rendering for image-only PDFs (out of scope). |
| `pdf-parse` (pure JS) | shell-out to `pymupdf` (Python) | Pensmith uses BOTH: `pdf-parse` first, `pymupdf` as fallback when output looks suspect. PRD §9 specifies this explicitly. |
| `citation-js` | Pandoc CSL files via shellout | Use Pandoc shellout *only* for the export step (to leverage Pandoc's mature `.docx` + `.pdf` rendering). Use `citation-js` for in-Node citation rendering during draft + verification. PRD §11 already detects Pandoc. Both coexist. |
| Raw `fetch` for source APIs | `crossref-api` / `openalex-api-typescript` etc. | None of the existing community Node packages for OpenAlex/Crossref/arXiv/PubMed are seriously maintained. Hand-rolled adapters in `bin/lib/sources.js` give pensmith control over the User-Agent, polite pool, cache, and DOI normalization that PRD §14 mandates anyway. |
| JSON file + `proper-lockfile` for library index | `better-sqlite3` | Use SQLite in v0.2 if the library index grows past ~10k papers OR if multi-user collaboration is added (out of scope per PRD §16). For a single-user CLI managing tens to low-hundreds of papers, JSON is faster, simpler, and git-friendly. |
| `node:test` + `c8` | `vitest` | Use Vitest if you want watch mode, snapshot diffing, or rich matchers. Use `node:test` to keep zero dev-dep churn. **Recommendation: `node:test` for v0.1** — pensmith is a Node CLI, not a Vite app; Vitest's strengths (Vite integration, browser tests) don't apply. |
| `nock` for HTTP cassettes | `msw` | Use MSW if you want concurrent tests and network-level interception. Use `nock` for the cassette recording workflow PRD §14 + §13 mandates (`tests/fixtures/http-cassettes/`). nock's `recorder` + `nockBack` is the cleanest cassette-based fixture system in Node. |
| `undici` cache interceptor | hand-rolled disk cache | Use `undici`'s built-in cache if you can take the dep and want HTTP-semantic caching (Vary, Cache-Control). Use hand-rolled (~50 LOC) if you want full control over the cache key (e.g., pensmith may want to cache-key on normalized DOI rather than URL). PRD §10 specifies per-source TTL — cleaner with hand-rolled. |

---

## What NOT to use

| Avoid | Why | Use instead |
|---|---|---|
| **Hand-rolled JSON-RPC for the MCP server** | The protocol is non-trivial (notifications, server capabilities, error envelopes, content schemas). The official SDK is stable, typed, and maintained by the protocol authors. Drift between hand-rolled and spec is a guaranteed maintenance burden. | `@modelcontextprotocol/sdk` |
| **`pdfjs-dist` directly** | 9 MB install, complicated worker model, overkill for text extraction. | `pdf-parse` (which wraps it) |
| **`chalk`** | 7× larger than picocolors, 13× slower load, no functional advantage for pensmith's output (which is mostly status messages + tables). e18e officially recommends replacement. | `picocolors` or `yoctocolors` |
| **`kleur`** | Stale (3+ years no update), only 8 colors. | `picocolors` |
| **`inquirer`** | Heavy, dated API (object-config style), slow startup. | `@clack/prompts` |
| **`request`, `got`, `axios`, `node-fetch`** | `request` deprecated. `node-fetch` superseded by built-in fetch (Node 18+). `axios` adds weight and its own quirks. `got` is fine but slower than undici. Native fetch / undici cover everything pensmith needs. | Native `fetch` + `undici` |
| **`nodemon` / `ts-node`** | Both superseded. | `tsx` (for dev), Node 22 native TS strip (for prod) |
| **`fs-extra`** | Most of its value is in `node:fs/promises` since Node 14. | `node:fs/promises` + `fs.cp` |
| **`yargs`** for the CLI | Mature but verbose, larger than citty, multi-file pattern fights pensmith's small-CLI shape. | `citty` |
| **`jest`** for tests | Overkill, slow startup, requires its own transformer pipeline. ESM support is still rough. | `node:test` (or Vitest if you want UX) |
| **`pdf-parse@1.x`** | Older versions had Buffer/Uint8Array incompatibilities and a notorious "imports from `node_modules/pdf-parse/test/data/...`" bug if not configured correctly. | `pdf-parse@^2.4.5` (pinned) |
| **Node 18** | EOL April 2025. | Node 20 LTS minimum (`engines: { node: ">=20.10" }`) |
| **CommonJS for new code** | All modern MCP / Claude Code / UnJS examples are ESM. CJS adds friction. | `"type": "module"` |
| **`paths.js` from `path` library** | Don't use community libs for cross-platform paths — Node's `os.homedir()` + `process.platform` + `process.env.APPDATA` / `XDG_DATA_HOME` is enough. | Hand-rolled `bin/lib/paths.js` (PRD §13) using `node:os` + `node:path` |
| **Bundlers (esbuild, rollup, tsup) in production** | Pensmith is a Node CLI, not a browser app or library. Compile TS to JS once at publish time; ship the JS. Bundling adds a debugging layer. | `tsc` + `tsx` for dev |

---

## Stack patterns by variant

**If pensmith ever needs to support Bun / Deno (out of scope for v0.1):**
- Avoid `better-sqlite3` (native bindings break Bun)
- Stick to ESM + standard fetch
- Citty already runs on Bun; clack does too

**If the library grows past a few hundred papers:**
- Migrate `~/.pensmith/library/index.json` to SQLite (`node:sqlite` if Node 22+, else `better-sqlite3`)
- Keep the JSON read path for migration

**If multi-user collaboration is added (PRD §16 says explicitly out of scope):**
- Then SQLite + WAL mode is the floor, plus a sync layer (out of scope; flagged for later)

**If a Tier-3 web UI is added later:**
- Reuse `bin/lib/*` as a published npm package
- Add a thin HTTP server (Hono or Fastify) over the same modules
- Workflow bodies stay the source of truth

---

## Version compatibility

| Package | Compatible with | Notes |
|---|---|---|
| `@modelcontextprotocol/sdk@^1.29` | Node `>=18`, prefers `>=20` | Uses native fetch + AbortSignal |
| `citty@^0.2` | Node `>=18`, ESM only | Drops CJS in v0.2 |
| `pdf-parse@^2.4.5` | Node `>=18`. Wraps `pdfjs-dist@^4.x`. | Pin exact `pdf-parse` version. Breaking changes have shipped on patch versions historically. |
| `citation-js@^0.7.22` | Node `>=14`. Plugins (BibTeX, CSL) version-locked to core. | Install `@citation-js/plugin-bibtex` at the same major. |
| `undici@^7` | Node `>=20.18.1` for full feature set; Node 22 ships v6 internally as `globalThis.fetch`. Install undici explicitly when you want v7's cache + interceptors. | If you target Node 20, install `undici` from npm. If Node 22+, you can rely on the bundled version for plain fetch. |
| `better-sqlite3` (if used in v0.2) | Native; needs prebuilds for Win/Mac/Linux x64+arm64. Match Node major. | Avoid in v0.1 to keep install painless. |
| `proper-lockfile@^4` | Node `>=12` | Stable, low churn. |
| `@anthropic-ai/sdk@^0.93` | Node `>=18` | Major version still pre-1.0; pin minor. |
| `openai@^4` | Node `>=18` | v5 may have shipped by build time — verify and update. |

---

## Sources

- [Claude Code Plugin reference docs](https://code.claude.com/docs/en/plugins-reference) — HIGH confidence — verified plugin.json schema, hooks/hooks.json format, MCP integration paths, skill structure (SKILL.md frontmatter), agent format, hook event matchers
- [Claude Code Skills docs](https://code.claude.com/docs/en/skills) — HIGH — SKILL.md frontmatter `name` + `description` required fields, `when_to_use` and `disable-model-invocation` optional fields
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — HIGH — current version 1.29.0
- [TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk) — HIGH — official, current
- [unjs/citty GitHub](https://github.com/unjs/citty) and [npm](https://www.npmjs.com/package/citty) — HIGH — zero-deps, ESM-only, native parseArgs as of v0.2
- [@clack/prompts npm](https://www.npmjs.com/package/@clack/prompts) — HIGH — modern interactive prompt library, ~4kB
- [picocolors GitHub](https://github.com/alexeyraspopov/picocolors) and [e18e replacements](https://e18e.dev/docs/replacements/chalk) — HIGH — recommended chalk replacement
- [undici on npm](https://www.npmjs.com/package/undici), [v7 caching announcement](https://blog.platformatic.dev/bringing-http-caching-to-nodejs) — HIGH — RFC-9111 caching, interceptor architecture
- [pdf-parse on npm](https://www.npmjs.com/package/pdf-parse) — MEDIUM — current version 2.4.5, recent activity confirmed
- [unpdf vs pdf-parse vs pdfjs-dist 2026 comparison](https://www.pkgpulse.com/blog/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-parsing-extraction-nodejs-2026) — MEDIUM
- [citation-js homepage](https://citation.js.org/) and [npm](https://www.npmjs.com/package/citation-js) — HIGH — current 0.7.22, CSL + BibTeX
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — HIGH — version 0.93.0 with baseURL support
- [Ollama OpenAI compatibility blog](https://ollama.com/blog/openai-compatibility), [Anthropic compatibility blog](https://ollama.com/blog/claude) — HIGH — confirms baseURL pattern works for Ollama against both SDKs
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) — HIGH — fastest sync SQLite for Node CLIs
- [node:test vs Vitest 2026](https://www.pkgpulse.com/blog/node-test-vs-vitest-vs-jest-native-test-runner-2026) — HIGH — node:test is sufficient for libraries/CLIs
- [nock GitHub](https://github.com/nock/nock) and [nock vs MSW comparison](https://www.bam.tech/en/article/nock-vs-msw-i-tested-both-and-here-is-what-i-learned) — HIGH — `nockBack` is the canonical cassette pattern
- [doi-regex on npm](https://www.npmjs.com/package/doi-regex) — MEDIUM — version 0.1.17, MIT, single-purpose
- [jnuyens/gsd-plugin GitHub](https://github.com/jnuyens/gsd-plugin) — HIGH for structure (uses `.cjs` for hooks, has `mcp/`, `bin/`, `hooks/`, `agents/`, `workflows/`, `schema/`, `migrations/` per PRD §13 layout); MEDIUM for specific dep versions (package.json contents not fully extracted)

---

*Stack research for: pensmith — Claude Code plugin + portable Node CLI for academic paper writing*
*Researched: 2026-05-06*
