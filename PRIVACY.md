# Privacy

Pensmith is local-only software: it runs on your machine, and there is no Pensmith server. No telemetry, no cloud state, no remote logging. What leaves your machine is the requests listed below — to the model provider you configure and to the scholarly services a paper needs — and `--show-prompts` prints each one to stderr before it is sent.

## Where requests go

Every run is **live by default**: sources, DOI verification, retraction checks, the plagiarism check and the detector score use the real services. `--dry-run` sends nothing at all (no network, no model call), and `PENSMITH_OFFLINE=1` answers sources from recorded fixtures (a source checkout only). `pensmith doctor` shows which mode is in effect.

**The model provider you configure** (`[runtime] provider`, `--runtime`) receives the prompts of every model call — your assignment text, research context and section drafts:

- **Anthropic** (`api.anthropic.com`, the default) or **OpenAI** (`api.openai.com`), with your API key;
- or a **local or OpenAI-compatible endpoint** you name in the global `runtime.json` (Ollama, vLLM, or any compatible server). Only the configured endpoint's origin can be reached this way; a paper's own files cannot change where prompts or keys go.

Model requests carry a plain `pensmith/<version>` User-Agent — never your contact email.

**Scholarly services** (metadata only — search queries, DOIs and identifiers, not your draft):

- **OpenAlex** — paper metadata search (with your `OPENALEX_API_KEY` as `api_key` when you set one)
- **Crossref** — DOI resolution and citation verification (polite pool)
- **Crossref / Retraction Watch** — retraction checks at research and verify time (the Retraction Watch data Crossref serves)
- **Semantic Scholar** — paper metadata search (with your `PENSMITH_S2_API_KEY` as `x-api-key` when you set one)
- **Open Library** and, as a fallback for an ISBN it does not know, **Google Books** — book search and ISBN lookups (a title, an author or an ISBN)
- **arXiv** — preprint metadata and full text
- **PubMed / NCBI** — biomedical paper metadata
- **Unpaywall** — open-access PDF discovery (quote verification downloads the open-access PDF it finds)
- **Zotero** — only if you set it up, and read-only. With `ZOTERO_API_KEY`, the Zotero Web API (`api.zotero.org`) receives your key (as the `Zotero-API-Key` header only) and the requests for your library, a collection (`[sources] zotero_collection`) or a quick-search query; with `PENSMITH_ZOTERO_LOCAL=1`, pensmith reads the Zotero 7 local API on your own computer (`127.0.0.1:23119`) and nothing leaves the machine. In Claude Code, Claude reads Zotero through your own Zotero MCP server and hands the items to pensmith as data (`paper_ingest_zotero_items`); pensmith itself contacts nothing for that. Zotero items are stored in `.paper/LIBRARY.json` like any other source, tagged `zotero`. `pensmith doctor` checks a key with one request to `api.zotero.org/keys/current`, and reads your Claude Code MCP configuration (`.claude.json`, a project `.mcp.json`) only to see whether a Zotero server is configured.

**Checks on the finished paper** (`pensmith done`):

- **DuckDuckGo** — the plagiarism check sends a handful of distinctive phrases from your paper as search queries (free, no account; PRD §11)
- **GPTZero** — the AI-likelihood score (only with a `GPTZERO_API_KEY`) sends the full paper text, and only after you consent: a disclosure is shown first, then the `detector-consent` question, which `--yolo` never skips; a run that cannot ask sends nothing. The score is shown for transparency; it is not a claim about AI-detector outcomes.

## `PENSMITH_CONTACT_EMAIL` (recommended)

Crossref, OpenAlex and Unpaywall ask callers to identify themselves (their "polite pool", with better rate limits). When `PENSMITH_CONTACT_EMAIL` is set, requests to those three services (including the Crossref retraction lookup) carry it in the `User-Agent` as `pensmith/<version> (mailto:<address>)`, and OpenAlex, Unpaywall and Crossref retraction requests also as their `mailto` / `email` query parameter. It is sent to those scholarly services only — never to a model provider, arXiv, PubMed, Semantic Scholar, the book services, Zotero, DuckDuckGo, GPTZero, a URL you pass to `pensmith add`, or an open-access PDF host, and never across a redirect that leaves one of those three services — and it is dropped from every log record (including the error text of a failed or refused request), every HTTP cache file and every recorded test fixture. When it is unset, pensmith still works (with a one-time warning; Unpaywall, which requires an address, is skipped), and `pensmith doctor` reports a WARN.

A paper can name a different variable for the address with `[network] contact_email_env` in `.paper/config.toml` (for example `MY_WORK_EMAIL`). Because a paper's config travels with the paper (a shared or synced folder), that name is honoured only when it is an upper-case variable name containing `EMAIL` or `MAILTO`, and its value is sent only when it looks like an email address; anything else is ignored with a one-time warning and `PENSMITH_CONTACT_EMAIL` is read instead. A paper file can therefore never make pensmith send one of your secrets (an API key in another variable) to a scholarly service. `pensmith doctor` names the variable it read, never the address.

## What pensmith stores, and where

Everything lives on your filesystem. Paper files are in `.paper/` in the paper's folder (which may sit inside a synced folder such as OneDrive or Dropbox — `pensmith doctor` warns when it does). App state (locks, the HTTP cache, the paper registry) lives in your user data folder, outside the paper.

- **`.paper/SESSION.log`** records every model call **in full by default** (`[logging] session_bodies = "full"`): the step, provider, model, the prompt exactly as sent (so your assignment and your drafts), the response, token counts and cost. This is what lets you see what was sent and replay a step (`pensmith resume --replay <id>`). Set `[logging] session_bodies = "redacted"` in `.paper/config.toml` to keep only hashes, counts, cost and short previews instead (such steps can no longer be replayed). Every source request is recorded with its URL, status and cache use — secrets and the contact email removed. API keys, cookies and authorization headers are never stored. Calls made outside any paper are logged to `session.log` in the user data folder.
- **`.paper/COSTS.jsonl`** — the cost ledger (tokens and USD per call; no prompt text).
- **`.paper/INTAKE.md`** — your assignment and the clarified brief.

## PII redaction (opt-in)

By default the assignment text is used as you gave it. With `pensmith new --pii-redact` (or `[project] pii_redaction = true`), emails, phone numbers, ID-like numbers and similar spans are redacted **before** anything reaches the model: the redacted text is what the model sees and what `INTAKE.md` keeps, each redaction is printed for review, and the raw text is kept only in `.paper/INTAKE.raw.local` (gitignored, never sent anywhere).

## Humanizer

The humanizer skill (`~/.claude/skills/humanizer/`) runs through your own Claude Code session; pensmith sends nothing extra for it.

## What is never collected

No usage analytics, no crash reports, and no content are sent to any Pensmith-controlled server — there is none.
