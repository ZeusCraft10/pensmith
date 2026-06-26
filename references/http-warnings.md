# HTTP Warning Strings (locked — D-24)

This file is the SINGLE source of truth for HTTP-client user-facing warning
prose. `bin/lib/http.ts` reads these strings at module load. Phase 2's
`/pensmith doctor` (DOCT-03) reuses the SAME strings verbatim. Drift between
the two is a lint failure.

## PENSMITH_CONTACT_EMAIL not set

> pensmith: PENSMITH_CONTACT_EMAIL is not set. Using no-contact User-Agent. Some APIs (Crossref polite pool, OpenAlex) may rate-limit more aggressively. Set PENSMITH_CONTACT_EMAIL to your email address in your shell profile. See https://github.com/ZeusCraft10/pensmith#configuration

(One blockquote line above is the literal string. The leading `> ` is markdown
syntax — `bin/lib/http.ts` strips it on read. Do NOT edit the wording without
also updating any tests that match against it.)
