# Sources: what pensmith asks, how politely, and what each service receives

Pensmith finds, checks and re-checks sources through public scholarly services. This page lists each service, the rate pensmith holds itself to, how it identifies itself, which keys it can use, and exactly what each service receives. PRD §8 (the adapters), §11 (Zotero and the other local tools) and §12 (external dependencies) are the spec; this page is the operator's view of the same rules. [PRIVACY.md](../PRIVACY.md) covers the same ground from the privacy side.

Every request goes through one module, `bin/lib/http.ts`, so every rule below applies to every source. Nothing else in pensmith opens a network connection.

## Modes

- **Live** (the default): the real services are asked.
- **Sources offline** (`PENSMITH_OFFLINE=1`, or the test runner): each request is answered from a recorded fixture that matches it exactly, or refused (`offline: no recorded fixture for …`). A recorded redirect is followed hop by hop through the fixtures. A fixture answer never counts toward a host's rate limit or circuit breaker.
- **`--dry-run`**: nothing is sent. Sources come from a labelled synthetic provider.

`pensmith doctor` shows the mode in effect.

## The services

| Service | Host | Used for | Rate pensmith keeps | Identifies itself with | Key (optional) |
|---|---|---|---|---|---|
| Crossref | `api.crossref.org` | search, DOI metadata, retraction notices (`works?filter=updates:<doi>`) | 3 requests/s, lowered by Crossref's own `X-Rate-Limit-*` headers (1/s in the public pool) | `User-Agent: pensmith/<version> (mailto:<email>)`; the retraction lookup also sends `mailto=` | none |
| OpenAlex | `api.openalex.org` | search, work metadata | 10 requests/s within the key's daily budget | `(mailto:<email>)` User-Agent and `mailto=` | `OPENALEX_API_KEY` (free), sent as `api_key=` |
| Unpaywall | `api.unpaywall.org` | open-access PDF locations for quote checks | 10 requests/s | `(mailto:<email>)` User-Agent and `email=` (required: without a contact email Unpaywall is skipped, and pensmith says so) | none |
| arXiv | `export.arxiv.org` | preprint search and metadata | 1 request every 3 s (arXiv's API terms) | plain `pensmith/<version>` | none |
| PubMed (NCBI E-utilities) | `eutils.ncbi.nlm.nih.gov` | biomedical search and metadata | 3 requests/s (the keyless limit) | plain `pensmith/<version>` | none |
| Semantic Scholar | `api.semanticscholar.org` | search, metadata | 1 request/s (keyless requests share a public pool that is often rejected) | plain `pensmith/<version>` | `PENSMITH_S2_API_KEY`, sent as the `x-api-key` header |
| Open Library | `openlibrary.org` | books: title/author search, ISBN lookup | 1 request/s | plain `pensmith/<version>` | none |
| Google Books | `www.googleapis.com` | books: keyless ISBN fallback | 1 request/s | plain `pensmith/<version>` | none |
| Zotero Web API | `api.zotero.org` | the user's own Zotero library | 5 requests/s, and Zotero's `Backoff` header | plain `pensmith/<version>` | `ZOTERO_API_KEY`, sent only as the `Zotero-API-Key` header |
| Zotero 7 local API | `127.0.0.1:23119` (this computer) | the user's own Zotero library, offline | 5 requests/s | plain `pensmith/<version>` | none |
| GROBID | the loopback URL in `PENSMITH_GROBID_URL` (this computer) | reading a PDF's header (title, authors, DOI, arXiv id) before pensmith's own heuristic — bring-your-own folders, `add <file.pdf>`, a PDF `add` fetched | 5 requests/s | plain `pensmith/<version>` | none |
| any other host | a URL you pass to `add`, an open-access PDF host | fetching that document | 5 requests/s per host | plain `pensmith/<version>` | none |

JSTOR, APA PsycNET and PhilPapers have no free search API pensmith can use within their terms, so their content is reached through OpenAlex, Crossref and PubMed coverage (PRD §8). The checks on a finished paper, DuckDuckGo (plagiarism phrases) and GPTZero (the AI-likelihood score, only with `GPTZERO_API_KEY` and your consent), are described in [PRIVACY.md](../PRIVACY.md).

## What each service receives

- **Search queries.** Research sends the queries it generated from your topic (5 to 10 per scope; the model call that writes them is separate, see PRIVACY.md). `plan N --research "<query>"` sends your query and the query joined to the section title. Your draft is never sent to a source.
- **Identifiers.** DOIs, arXiv ids, PMIDs and ISBNs go to the registrar that can answer for them (Crossref, arXiv, PubMed, Open Library / Google Books, Unpaywall).
- **A bring-your-own PDF** (and a PDF you `add`). Only a title or an identifier found in it leaves the machine — an identifier to its registrar, or the title to Crossref and, when Crossref has no confident match, to OpenAlex (and to arXiv when OpenAlex's only match is a later re-post of the work, or OpenAlex could not answer). The PDF itself goes nowhere, except to a GROBID server on your own computer when you set `PENSMITH_GROBID_URL` (a non-loopback URL is ignored with a warning); its text goes to your model provider only if you set `[verification] send_byo_passages = true` (the advisory claim-support check then sends the passages nearest each claim).
- **Your contact email** goes only to Crossref, OpenAlex and Unpaywall (below).
- **Your Zotero library** is read, never written. The Web API receives your key (as a header) and the collection and item requests; the local API never leaves your computer.

## Identifying pensmith: the contact email

Crossref, OpenAlex and Unpaywall ask callers to say who they are; in return they answer from a "polite pool" with better limits. Pensmith sends `User-Agent: pensmith/<version> (mailto:<email>)` to those three services only, and never to a model provider, arXiv, PubMed, Semantic Scholar, the book services, Zotero, DuckDuckGo, GPTZero, a URL you gave `add`, or a PDF host. A redirect that leaves one of the three services' origins drops back to the plain User-Agent.

The address comes from `PENSMITH_CONTACT_EMAIL`, or from the variable the user's global runtime.json names in `contactEmailEnv` (a user-level setting in the pensmith data dir). A paper can name a different variable with `[network] contact_email_env` in `.paper/config.toml` (say, `PENSMITH_WORK_EMAIL`), but because a paper's config can travel with the paper, pensmith honours the name only when it is in pensmith's own namespace — an upper-case `PENSMITH_…` identifier that contains `EMAIL` or `MAILTO` and no secret word (`PASSWORD`, `SECRET`, `TOKEN`, `KEY`, `URL`, `URI`, `DSN`, `AUTH`, `CREDENTIAL`) — and sends the value only when it is a plain address (`name@domain.tld`, no `:` or `/`); otherwise it warns once and falls back to `PENSMITH_CONTACT_EMAIL`. A config file can therefore never point pensmith at a secret or at another personal variable such as `GIT_AUTHOR_EMAIL`. With no address set, the three services get `pensmith/<version> (no-contact)` and one warning; Unpaywall is skipped.

The address is never written to a log, a cache file or a recording.

## Rate limits, backoff and stopping

- **One bucket per host.** Crossref search, DOI lookups and retraction lookups all go to `api.crossref.org` and share one budget. A host reached under two labels (an arXiv PDF fetched as a plain URL) keeps the lower rate.
- **The service's own numbers.** `X-Rate-Limit-Limit` / `X-Rate-Limit-Interval` (Crossref sends `3` / `1s` to the polite list pool and `1` / `1s` to the public pool) lower that host's rate for the rest of the run; they never raise it above the table. Only the services in this table can lower pensmith's rate — any other host (a URL you `add`, an open-access PDF host) cannot — and a declared rate slower than one request per 30 s marks the host exhausted (below) rather than making pensmith wait. Waiting for a host's rate never outlasts the request's own timeout. Zotero's `Backoff: <seconds>` holds the host for that long.
- **Retries.** A 429 or 5xx is retried with full-jitter backoff, and a `Retry-After` of up to 30 s is honoured before the next attempt.
- **A long wait means stop.** A `Retry-After` (or `Backoff`) longer than 30 s marks the host exhausted until then. That request is not retried, pensmith prints one line (`pensmith: api.openalex.org: rate limit exhausted (retry after ~6 h) — no further requests go to it in this run`), and every later request to that host in the same run fails at once without opening a socket. Research reports the source as failed with that reason (for keyless OpenAlex: `keyless daily budget exhausted — set OPENALEX_API_KEY (free)` when OpenAlex says the budget is spent, otherwise `rate limited (retry after ~N s) — a free OPENALEX_API_KEY avoids this`).
- **A circuit breaker per host.** Three 429/5xx responses in a row from one host (retries count) open its breaker: pensmith prints one line (`pensmith: api.semanticscholar.org: skipped for the rest of this run after 3 consecutive HTTP 503 responses`) and skips the host for the rest of the run, so a failing service gets at most three requests however many queries a run makes. Any other answer resets the count. In a long-running process (the Claude Code MCP server), an open breaker lets one probe request through every 10 minutes and closes again when it succeeds.
- Model requests are outside the breaker and the exhausted marker; the provider's own errors are reported as they are.

## Redirects

Pensmith follows `301`, `302`, `303`, `307` and `308` for `GET` and `HEAD` requests itself, at most five in a row. Each hop is a new request: its URL scheme is checked (http and https only), its host is resolved and checked (private, loopback, link-local and cloud-metadata addresses are refused, with no exception for a "trusted" source), the connection is pinned to the checked address, and the hop gets its own `--show-prompts` line and its own `SESSION.log` record. A hop to another origin never carries credentials (`Authorization`, `Cookie`, `x-api-key`, `Zotero-API-Key`). `https` to `http`, a loop, a missing `Location` and a sixth redirect are refused with a one-line reason; `303` continues as a `GET`. A `POST`'s redirect is returned unfollowed, and a model request never follows one.

## Caching

Answers are cached in the user data folder (never inside `.paper/`): 7 days for metadata, 1 day for Unpaywall and retraction data, 1 hour for a `404`, and never for Zotero. Only a validated answer is cached: an error document served with HTTP 200 (such as Crossref Labs' `{"statusCode":"403","message-type":"not-polite"}`) or a body that fails the adapter's schema check is reported as a failure and not cached. Keys never shape the cache: secret query parameters (`api_key`, `apikey`, `key`, `token`, `access_token`), contact parameters and credential headers are left out of the cache key, so a keyed and a keyless request share one entry and no cache file names or contains a key.

## Keys

| Variable | Service | Sent as | Without it |
|---|---|---|---|
| `OPENALEX_API_KEY` (the name is `openalexApiKeyEnv` in the global `runtime.json`) | OpenAlex | `api_key=` query parameter | the small keyless daily budget, often exhausted |
| `PENSMITH_S2_API_KEY` | Semantic Scholar | `x-api-key` header | the shared keyless pool, often rejected (HTTP 429) |
| `ZOTERO_API_KEY` | Zotero Web API | `Zotero-API-Key` header | Zotero via the local API or a public group only |
| `GPTZERO_API_KEY` | GPTZero | `x-api-key` header | no AI-likelihood score |

Keys are read from the environment only. They are never printed (`--show-prompts` shows no headers and redacts key parameters), never written to `SESSION.log` (a key parameter appears as `api_key=REDACTED`), never part of an HTTP cache key or file, never recorded in a test fixture, and dropped on a redirect to another origin. `pensmith doctor` reports each as present or absent, never its value.

## Zotero

Pensmith reads your Zotero library in either tier, and only reads it:

- **Command line (Tier 2).** Set `ZOTERO_API_KEY` (create a read-only key at <https://www.zotero.org/settings/keys>), or enable Zotero 7's local API (Settings → Advanced → "Allow other applications on this computer to communicate with Zotero") and set `PENSMITH_ZOTERO_LOCAL=1`. `ZOTERO_GROUP_ID` reads a group library instead of your own (a public group needs no key). `[sources] zotero_collection = "Thesis"` limits the pull to that collection, found by name. Items are tagged `zotero` in LIBRARY.json and RESEARCH.md, and an item whose DOI is already in the library merges into that entry.
- **Claude Code (Tier 1).** Claude reads Zotero through your own Zotero MCP server (for example <https://github.com/54yyyu/zotero-mcp>) and hands the items to pensmith's `paper_ingest_zotero_items` tool, which validates each one (a malformed item rejects the call with the field at fault) and adds them the same way. Items of the collection a paper's `[sources] zotero_collection` names are refused until you approve that collection for the paper: Claude asks you first, as `pensmith research` does in a terminal.

`pensmith doctor` says `Zotero: authenticated` only after `GET https://api.zotero.org/keys/current` answers 200, `Zotero: key rejected` on 403, and otherwise whether the local API or a group answers, or whether a Zotero MCP server is configured for Claude Code (in `.claude.json`, user or project scope, or a project `.mcp.json`).

## For contributors

- Recorded fixtures live in `tests/fixtures/cassettes/`; they are real recordings made by `npm run cassettes:refresh` with `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`, scrubbed of contact and secret parameters and credential headers, and at most 51 200 bytes each. A redirect is recorded as one entry per hop (the `3xx` keeps its `location`), and a non-text body such as a PDF is stored as base64 with `"bodyEncoding": "base64"`. Hand-written fixtures belong under `tests/fixtures/cassettes/synthetic/` only.
- The default `npm test` never calls these services. `npm run live:sources` runs the live checks against the real services.
