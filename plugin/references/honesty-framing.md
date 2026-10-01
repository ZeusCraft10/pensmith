# Honesty Framing Strings (locked — Phase 6 DONE-04; Phase 21 EXP-16..18)

This file is the SINGLE source of truth for the honesty-score user-facing
framing prose. `bin/lib/honesty.ts` reads these strings at run time and
renders them VERBATIM — it never embeds the copy inline. Drift between the code
and this file is a CI failure: the SHA-256 of this file is byte-pinned in
`tests/repo-files.test.ts`. See CONTRIBUTING.md for the lock rule.

The framing is TRANSPARENCY-ONLY. It states what the score means and what the
humanizer does. It NEVER claims to make output undetectable; the humanizer is
described only as a prose-readability improvement, never as a detection-avoidance
tool.

## Output format

> Pensmith honesty check (before humanize): XX% AI-generated (<detector>, <ISO time>)
> Pensmith honesty check (after humanize):  XX% AI-generated (<detector>, <ISO time>)

(When no score was taken, the line gives the one reason instead — `skipped (…)`,
`unavailable (…)` or, after the humanizer, `N/A (…)` — and never a number.)

## Note

> Note: this score reflects prose patterns. The humanizer improves readability; it does not promise to make output undetectable.

(One blockquote line per line above is the literal string. The leading `> ` is
markdown syntax — `bin/lib/honesty.ts` strips it on read. Do NOT edit the wording
without also updating the SHA-256 pin in tests/repo-files.test.ts.)

## GPTZero Data Transmission Disclosure

> Disclosure: the honesty check sends your full paper text to GPTZero (api.gptzero.me), an external service, for AI-detection scoring. This is for your transparency only — it does NOT make your output undetectable. No data is sent without your consent.

## Originality.ai Data Transmission Disclosure

> Disclosure: the honesty check sends your full paper text to Originality.ai (api.originality.ai), an external service, for AI-detection scoring; pensmith asks it not to store the scan. This is for your transparency only — it does NOT make your output undetectable. No data is sent without your consent.

## Sapling Data Transmission Disclosure

> Disclosure: the honesty check sends your full paper text to Sapling (api.sapling.ai), an external service, for AI-detection scoring. This is for your transparency only — it does NOT make your output undetectable. No data is sent without your consent.

(Transparency-only. The disclosure of the configured detector is shown before any
text is sent to it, on every scoring run. It NEVER claims detection avoidance or
undetectability. `bin/lib/honesty.ts` reads these sections at run time and
prints the one for the configured backend to stdout before the consent question.
Your answer to that question is recorded in `.paper/config.toml`
(`[humanizer] honesty_consent`); `--yolo` never answers it. Do NOT weaken or
remove the transparency-only constraint. Do NOT edit without updating the
SHA-256 pin in tests/repo-files.test.ts.)
