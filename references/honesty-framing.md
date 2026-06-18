# Honesty Framing Strings (locked — Phase 6 DONE-04)

This file is the SINGLE source of truth for GPTZero honesty-score user-facing
framing prose. `bin/lib/honesty.ts` reads these strings at module load and
renders them VERBATIM — it never embeds the copy inline. Drift between the code
and this file is a CI failure: the SHA-256 of this file is byte-pinned in
`tests/repo-files.test.ts`. See CONTRIBUTING.md for the lock rule.

The framing is TRANSPARENCY-ONLY. It states what the score means and what the
humanizer does. It NEVER claims to make output undetectable; the humanizer is
described only as a prose-readability improvement, never as a detection-avoidance
tool.

## Output format

> Pensmith honesty check (before humanize): reads as XX% AI-generated (GPTZero).
> Pensmith honesty check (after humanize):  reads as XX% AI-generated (GPTZero).

## Note

> Note: this score reflects prose patterns. The humanizer improves readability; it does not promise to make output undetectable.

(One blockquote line per line above is the literal string. The leading `> ` is
markdown syntax — `bin/lib/honesty.ts` strips it on read. Do NOT edit the wording
without also updating the SHA-256 pin in tests/repo-files.test.ts.)
