# Privacy

Pensmith is local-only software: it runs on your machine, and there is no Pensmith server. No telemetry, no cloud state, no remote logging. What leaves your machine is the requests listed below — to the model provider you configure and to the scholarly services a paper needs — and `--show-prompts` prints each one to stderr before it is sent.

## Where requests go

Every run is **live by default**: sources, DOI verification, retraction checks, the plagiarism check and the detector score use the real services. `--dry-run` sends nothing at all (no network, no model call), and `PENSMITH_OFFLINE=1` answers sources from recorded fixtures (a source checkout only). `pensmith doctor` shows which mode is in effect.

**The model provider you configure** (`[runtime] provider`, `--runtime`) receives the prompts of every model call — your assignment text, research context and section drafts:

- **Anthropic** (`api.anthropic.com`, the default) or **OpenAI** (`api.openai.com`), with your API key;
- or a **local or OpenAI-compatible endpoint** you name in the global `runtime.json` (Ollama, vLLM, or any compatible server). Only the configured endpoint's origin can be reached this way; a paper's own files cannot change where prompts or keys go.

Model requests carry a plain `pensmith/<version>` User-Agent — never your contact email.

**Scholarly services** (metadata only — search queries, DOIs and identifiers, not your draft):

- **OpenAlex** — paper metadata search
- **Crossref** — DOI resolution and citation verification (polite pool)
- **Crossref Labs / Retraction Watch** — retraction checks at research and verify time
- **Semantic Scholar** — paper metadata search
- **arXiv** — preprint metadata and full text
- **PubMed / NCBI** — biomedical paper metadata
- **Unpaywall** — open-access PDF discovery (quote verification downloads the open-access PDF it finds)
- **Zotero** — only if you configured a Zotero MCP server; it runs on your side

**Checks on the finished paper** (`pensmith done`):

- **DuckDuckGo** — the plagiarism check sends a handful of distinctive phrases from your paper as search queries (free, no account; PRD §11)
- **GPTZero** — the AI-likelihood score (only with a `GPTZERO_API_KEY`) sends the full paper text, and only after you consent: a disclosure is shown first, then the `detector-consent` question, which `--yolo` never skips; a run that cannot ask sends nothing. The score is shown for transparency; it is not a claim about AI-detector outcomes.

## `PENSMITH_CONTACT_EMAIL` (recommended)

Crossref, OpenAlex and Unpaywall ask callers to identify themselves (their "polite pool", with better rate limits). When `PENSMITH_CONTACT_EMAIL` is set, requests to those three services (including the Crossref retraction lookup) carry it in the `User-Agent`, and OpenAlex, Unpaywall and Crossref retraction requests also as their `mailto` / `email` query parameter. It is sent to those scholarly services only — never to a model provider, arXiv, PubMed, Semantic Scholar, DuckDuckGo, GPTZero, a URL you pass to `pensmith add`, or an open-access PDF host — and it is dropped from every log record, including the error text of a failed or refused request. When it is unset, pensmith still works (with a one-time warning), and `pensmith doctor` reports a WARN.

## What pensmith stores, and where

Everything lives on your filesystem. Paper files are in `.paper/` in the paper's folder (which may sit inside a synced folder such as OneDrive or Dropbox — `pensmith doctor` warns when it does). App state (locks, the HTTP cache, the paper registry) lives in your user data folder, outside the paper.

- **`.paper/SESSION.log`** records every model call **in full by default** (`[logging] session_bodies = "full"`): the step, provider, model, the prompt exactly as sent (so your assignment and your drafts), the response, token counts and cost. This is what lets you see what was sent and replay a step (`pensmith resume --replay <id>`). Set `[logging] session_bodies = "redacted"` in `.paper/config.toml` to keep only hashes, counts, cost and short previews instead (such steps can no longer be replayed). Every source request is recorded with its URL, status and cache use — secrets and the contact email removed. API keys, cookies and authorization headers are never stored. Calls made outside any paper are logged to `session.log` in the user data folder.
- **`.paper/COSTS.jsonl`** — the cost ledger (tokens and USD per call; no prompt text).
- **`.paper/INTAKE.md`** — the paper's brief: your assignment (redacted when you opted in to PII redaction) and your answers to the intake questions.

## PII redaction (opt-in)

Redaction is **off by default**: the assignment is used as you gave it. `pensmith new` asks "Redact personal information … before any model call?" first, before anything is sent; answer yes, or pass `--pii-redact` (`pii_redaction = true` in an `--answers` file), and:

- **What is redacted:** names — including middle initials ("Jane Q. Doe"), hyphenated names, particles ("van der Berg", "de la Cruz") and a surname after a title ("Prof. Smith") —, labelled identifiers ("Student ID: 2024-00173", "ID no. …", "SSN: …"), dates ("March 3, 2026", "3 March 2026", "Mar. 3", 2026-03-03, 03/03/2026), emails, phone numbers (US and +international), IP addresses and IBAN-like account numbers. Each span becomes a `[REDACTED:KIND]` tag, and each redaction is printed for you to review.
- **What is left alone:** entity phrases a paper is about ("French Revolution", "Treaty of Versailles", "Roman Empire", "Stanford University Press"), month fragments ("Due March"), the words of a labelled `Topic:` / `Title:` line in the assignment (so a paper about a person keeps that person's name), and identifiers — DOIs, ISBNs, arXiv ids, UUIDs, timestamps — which are never rewritten anywhere, the session log included.
- **Where it applies:** the only way your personal data enters the pipeline is intake — the assignment, the thesis seed, the class and the answers to the follow-up questions. All of them are redacted before the one intake model call and before `.paper/INTAKE.md` is written, and every later step (research, outline, plan, write, verify) reads the redacted brief, so no model request carries the raw text.
- **The raw copy:** the unredacted text is kept only in `.paper/INTAKE.raw.local` — gitignored through `.paper/.gitignore`, never sent to a model, never exported. Delete it if you do not want it.

Redaction is a pattern matcher, not a guarantee: it errs toward redacting, and a name written in an unusual form can slip through. Review the printed list, and keep personal details out of the assignment text when you can.

## Humanizer

The humanizer skill (`~/.claude/skills/humanizer/`) runs through your own Claude Code session; pensmith sends nothing extra for it.

## What is never collected

No usage analytics, no crash reports, and no content are sent to any Pensmith-controlled server — there is none.
