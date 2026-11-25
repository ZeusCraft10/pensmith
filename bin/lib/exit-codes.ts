// bin/lib/exit-codes.ts — what the CLI's exit status means.
//
// Scripts, CI and Claude's Bash tool read only the exit status, so every
// refusal must be non-zero. A step that ran but only warned (an advisory pass,
// an unverifiable quote) still exits 0.

/** The command did what was asked. */
export const EXIT_OK = 0;
/** Something unexpected went wrong (a bug, an I/O failure). */
export const EXIT_ERROR = 1;
/** Blocked or refused: a verifier verdict, a gate, an unknown command, invalid input. */
export const EXIT_REFUSED = 2;
/** A person has to answer first (approval or questions) and no terminal was available to ask. */
export const EXIT_NEEDS_ANSWER = 3;
