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
- **doi.org** — when Crossref has no record of a DOI you `add`, the DOI's prefix alone (such as `10.5281`, never the full DOI) to learn which agency registered it, so a DataCite DOI is reported as such instead of "not found"
- **Crossref / Retraction Watch** — retraction checks at research and verify time (the Retraction Watch data Crossref serves)
- **Semantic Scholar** — paper metadata search (with your `PENSMITH_S2_API_KEY` as `x-api-key` when you set one)
- **Open Library** and, as a fallback for an ISBN it does not know, **Google Books** — book search and ISBN lookups (a title, an author or an ISBN)
- **arXiv** — preprint metadata and full text (quote verification downloads the arXiv PDF of a cited preprint; identifying one of your PDFs may send its title as an arXiv title search, see below)
- **PubMed / NCBI** — biomedical paper metadata
- **Unpaywall** — open-access PDF discovery (quote verification downloads the open-access PDF it finds)
- **Zotero** — only if you set it up, and read-only. With `ZOTERO_API_KEY`, the Zotero Web API (`api.zotero.org`) receives your key (as the `Zotero-API-Key` header only) and the requests for your library, a collection (`[sources] zotero_collection`) or a quick-search query; with `PENSMITH_ZOTERO_LOCAL=1`, pensmith reads the Zotero 7 local API on your own computer (`127.0.0.1:23119`) and nothing leaves the machine. In Claude Code, Claude reads Zotero through your own Zotero MCP server and hands the items to pensmith as data (`paper_ingest_zotero_items`); pensmith itself contacts nothing for that. Zotero items are stored in `.paper/LIBRARY.json` like any other source, tagged `zotero`, each with its Zotero item key and the library it came from — `users/<your Zotero user id>`, `groups/<group id>` or `local` — which travel with the paper. A collection named by a paper's `[sources] zotero_collection` is read only after you approve it for that paper (see "Your own PDFs" below), in Claude Code too: Claude asks you first, and until you approve it pensmith adds nothing from your Zotero to that paper — whatever items Claude submits, from that collection or not. `pensmith doctor` checks a key with one request to `api.zotero.org/keys/current`, and reads your Claude Code MCP configuration (`.claude.json`, a project `.mcp.json`) only to see whether a Zotero server is configured.

**Checks on the finished paper** (`pensmith done`):

- **DuckDuckGo** — the plagiarism check sends a handful of distinctive phrases from your paper as search queries (free, no account; PRD §11)
- **GPTZero** — the AI-likelihood score (only with a `GPTZERO_API_KEY`) sends the full paper text, and only after you consent: a disclosure is shown first, then the `detector-consent` question, which `--yolo` never skips; a run that cannot ask sends nothing. The score is shown for transparency; it is not a claim about AI-detector outcomes.

## `PENSMITH_CONTACT_EMAIL` (recommended)

Crossref, OpenAlex and Unpaywall ask callers to identify themselves (their "polite pool", with better rate limits). When `PENSMITH_CONTACT_EMAIL` is set, requests to those three services (including the Crossref retraction lookup) carry it in the `User-Agent` as `pensmith/<version> (mailto:<address>)`, and OpenAlex, Unpaywall and Crossref retraction requests also as their `mailto` / `email` query parameter. It is sent to those scholarly services only — never to a model provider, arXiv, PubMed, Semantic Scholar, the book services, Zotero, DuckDuckGo, GPTZero, a URL you pass to `pensmith add`, or an open-access PDF host, and never across a redirect that leaves one of those three services — and it is dropped from every log record (including the error text of a failed or refused request), every HTTP cache file and every recorded test fixture. When it is unset, pensmith still works (with a one-time warning; Unpaywall, which requires an address, is skipped), and `pensmith doctor` reports a WARN.

You can name a different variable for the address in your global runtime.json (`contactEmailEnv`, in the pensmith data dir), and a paper can name one with `[network] contact_email_env` in `.paper/config.toml` (for example `PENSMITH_WORK_EMAIL`). Because a paper's config travels with the paper (a shared or synced folder), that name is honoured only when it is a variable in pensmith's own namespace — an upper-case `PENSMITH_…` name containing `EMAIL` or `MAILTO` and no word such as `PASSWORD`, `TOKEN`, `KEY` or `URL` — and its value is sent only when it is a plain address (`name@domain.tld`: no `:` or `/`, so a credential URL never passes); anything else is ignored with a one-time warning and `PENSMITH_CONTACT_EMAIL` is read instead. A paper file can therefore never make pensmith send one of your secrets, or another personal value in your environment (such as `GIT_AUTHOR_EMAIL`), to a scholarly service. `pensmith doctor` names the variable it read, never the address.

## What pensmith stores, and where

Everything lives on your filesystem. Paper files are in `.paper/` in the paper's folder (which may sit inside a synced folder such as OneDrive or Dropbox — `pensmith doctor` warns when it does). App state (locks, the HTTP cache, the paper registry) lives in your user data folder, outside the paper.

- **`.paper/SESSION.log`** records every model call **in full by default** (`[logging] session_bodies = "full"`): the step, provider, model, the prompt exactly as sent (so your assignment and your drafts), the response, token counts and cost. This is what lets you see what was sent and replay a step (`pensmith resume --replay <id>`). Set `[logging] session_bodies = "redacted"` in `.paper/config.toml` to keep only hashes, counts, cost and short previews instead (such steps can no longer be replayed). Every source request is recorded with its URL, status and cache use — secrets and the contact email removed. API keys, cookies and authorization headers are never stored. Calls made outside any paper are logged to `session.log` in the user data folder.
- **`.paper/COSTS.jsonl`** — the cost ledger (tokens and USD per call; no prompt text).
- **`.paper/INTAKE.md`** — the paper's brief: your assignment (redacted when you opted in to PII redaction) and your answers to the intake questions.

## Your own PDFs (bring-your-own)

`pensmith new --pdfs <folder>`, `pensmith add <folder>`, `pensmith add <file.pdf>` and `pensmith add <id> --pdf <file>` add PDFs you already have (SRC-15).

- **The PDF and its text stay on your machine.** The text is extracted locally (pdf-parse in a worker thread, or PyMuPDF when installed); it is never uploaded, and no PDF bytes are sent anywhere.
- **Only a title or an identifier leaves.** To find which published work a PDF is, pensmith looks up an identifier it finds in the PDF (a DOI at Crossref, an arXiv id at arXiv) — or, when there is none, sends the PDF's title as one search query to Crossref and, only if Crossref has no confident match, to OpenAlex (and, only if OpenAlex's one match is a later re-post of the work or OpenAlex could not answer, to arXiv). The author names, abstract and body text of the PDF are not sent. A PDF that no service matches confidently is kept with the metadata it carries itself and marked unhydrated; nothing more is sent for it.
- **What is stored.** A copy of each PDF in `.paper/sources/<citekey>.pdf` (inside the paper folder — which may be a synced folder), and in `.paper/LIBRARY.json` the sha256 of the PDF and of its extracted text. The extracted text itself is cached only in your user data folder (`byo-text/<sha256>.txt`), never in `.paper/`.
- **Text is used only after a re-hash.** Before a PDF's text is used (quote checks; the claim-support judge's passages, when you turned them on), pensmith re-hashes the PDF: a PDF edited after it was added, or a text file placed in `.paper/sources/`, is never trusted as the source's text — and a quote that was checkable against it stays blocked until you restore it. (Before `write` marks one of your PDFs as full text the drafter may quote, it re-hashes that PDF the same way; the drafter never receives the PDF's text.)
- **Your PDF's text is not sent to the model by default.** The advisory claim-support check (Pass 2) judges your own sources on their abstracts. Only if you set `[verification] send_byo_passages = true` in `.paper/config.toml` are the passages of your PDF nearest each claim (at most about 2,400 characters per claim) sent to your configured model provider with the claim-support prompt.
- **A PDF is attached to the right work only.** `add <id> --pdf <file>` checks that the PDF shows that work (its title and first author, or its own identifier); one that does not is attached only after you confirm it in a terminal (`--yolo` never does), and its text is then never used to verify quotes.
- `[sources] byo_pdf_dir` in `.paper/config.toml` records the folder you passed to `new --pdfs`, so research can pick up PDFs added there later: relative to the paper when the folder is inside it, else as an absolute path — which names your home folder and travels with the paper. Keep your PDFs in a folder inside the paper (e.g. `pdfs/`) if you share it.
- **A paper cannot make pensmith read your files.** `.paper/config.toml` travels with a paper (a shared or synced folder), so a `byo_pdf_dir` it names outside the paper folder — and any `[sources] zotero_collection` — is read only after YOU approved it for that paper: by passing the folder to `new --pdfs`, or by answering yes when `pensmith research` asks in a terminal (`--yolo` never answers; without a terminal the folder or collection is skipped with a warning). Your approvals are kept in your user data folder (`own-source-approvals.json`), never in the paper. A folder inside the paper needs no approval, but then only the PDFs that really are inside the paper are read: a link in it to a file elsewhere (a shared repository or archive can carry one) is skipped with a warning unless you approved that folder yourself (`new --pdfs`). A Zotero lookup that fails never writes your collection names or library id into the paper's RESEARCH.md.
- To remove your PDFs, delete `.paper/sources/` (and the `byo-text/` folder in your user data folder); the library entries remain as citations.

`pensmith add <url>` downloads the page or PDF at the URL you give it (a request to that host, through the same SSRF guard as every request); a downloaded PDF is identified exactly as above.

## PII redaction (opt-in)

Redaction is **off by default**: the assignment is used as you gave it. `pensmith new` asks "Redact personal information … before any model call?" first, before anything is sent; answer yes, or pass `--pii-redact` (`pii_redaction = true` in an `--answers` file), and:

- **What is redacted:** names — including middle initials ("Jane Q. Doe"), hyphenated names, particles ("van der Berg", "de la Cruz") and a surname after a title ("Prof. Smith") —, labelled identifiers ("Student ID: 2024-00173", "ID no. …", "SSN: …"), dates ("March 3, 2026", "3 March 2026", "Mar. 3", 2026-03-03, 03/03/2026), emails, phone numbers (US and +international), IP addresses and IBAN-like account numbers. Each span becomes a `[REDACTED:KIND]` tag, and each redaction is printed for you to review.
- **What is left alone:** entity, place and topic phrases a paper is about ("French Revolution", "Treaty of Versailles", "Roman Empire", "Stanford University Press", "Southeast Asia", "Social Media", "World War One"), month fragments ("Due March"), the words of the assignment's topic — a labelled `Topic:` / `Research question:` line and the topic of the task sentence ("Write about Abraham Lincoln…"), so a paper about a person keeps that person's name — except on a line that names people (`Name:`, `Student:`, `Instructor:`, …) or after a title such as "Prof." or "Dr.", where a name is always redacted (a `Title:` or e-mail `Subject:` line is not a topic: it often carries a name), and identifiers — DOIs, ISBNs, arXiv ids, UUIDs, timestamps — which are never rewritten anywhere, the session log included.
- **Where it applies:** the only way your personal data enters the pipeline is intake — the assignment, the thesis seed, the class and the answers to the follow-up questions. All of them are redacted before the one intake model call and before `.paper/INTAKE.md` is written, and every later step (research, outline, plan, write, verify) reads the redacted brief, so no model request carries the raw text.
- **The raw copy:** the unredacted text is kept only in `.paper/INTAKE.raw.local` — gitignored through `.paper/.gitignore`, never sent to a model, never exported. Delete it if you do not want it.

Redaction is a pattern matcher, not a guarantee: it errs toward redacting, and a name written in an unusual form can slip through. Review the printed list, and keep personal details out of the assignment text when you can.

## Humanizer

The humanizer skill (`~/.claude/skills/humanizer/`) runs through your own Claude Code session; pensmith sends nothing extra for it.

## What is never collected

No usage analytics, no crash reports, and no content are sent to any Pensmith-controlled server — there is none.
