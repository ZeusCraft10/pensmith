# Privacy

Pensmith is local-only. No telemetry, no cloud state, no remote logging.

## External API calls

Pensmith makes outbound HTTP requests only for academic-source lookup and citation verification. The following external services are contacted, all using a polite `User-Agent` header that includes your `PENSMITH_CONTACT_EMAIL` (required):

- **OpenAlex** — paper metadata lookup (open, no authentication required)
- **Crossref** — DOI resolution and citation verification (open, polite-pool with contact email)
- **arXiv** — preprint metadata and full-text retrieval (open)
- **PubMed / NCBI** — biomedical paper metadata (open)
- **Unpaywall** — open-access PDF discovery (open, email required for polite pool)
- **DuckDuckGo** — distinctive-phrase plagiarism check (free-tier, no account required; per PRD §11)
- **GPTZero** — AI-likelihood honesty score (requires explicit user consent gate HARD-05, shipped Phase 15; your text is sent to GPTZero's API only after you confirm)

## PII handling at intake

At intake (`pensmith new`), the assignment prompt, style samples, and any personal notes you provide are used only within your local paper session. No content is transmitted except as part of model API calls you have configured via `PENSMITH_CONTACT_EMAIL` and provider API keys.

## Humanizer and honesty-score data flows

The humanizer skill (`~/.claude/skills/humanizer/`) operates locally via Claude Code. The GPTZero honesty-score check sends your draft text to GPTZero's API; the consent gate (HARD-05) ensures this only happens after explicit confirmation. The honesty score is shown as a transparency metric — it is not a claim about AI-detector outcomes.

## `PENSMITH_CONTACT_EMAIL` requirement

All adapters that contact Crossref, Unpaywall, and OpenAlex include your `PENSMITH_CONTACT_EMAIL` in the request `User-Agent` as required by those services' polite-pool policies. This email is never stored, logged, or transmitted beyond the HTTP request header. If unset, `pensmith doctor` reports a WARN.

## What is never collected

No usage analytics, no crash reports, no session data, and no content are sent to any Pensmith-controlled server. There is no Pensmith server. All paper state lives in `.paper/` on your local filesystem.
