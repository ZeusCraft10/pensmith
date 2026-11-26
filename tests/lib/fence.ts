// tests/lib/fence.ts — the untrusted-data fence as a prompt test reads it,
// shared by revise-swap-context, source-evaluator and write-source-feed.
//
// The markers are written out here, not imported from bin/lib/untrusted-fence.ts,
// so a test fails if the code's markers stop being the ones the prompts name.
//
// Not a test file (the runner collects only *.test.ts).

export const FENCE_OPEN = '<<<PENSMITH_UNTRUSTED_DATA_7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a>>>';
export const FENCE_CLOSE = '<<<END_PENSMITH_UNTRUSTED_DATA_7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a>>>';

/** The text inside each fence of `text` (a mention of the markers in prose included). */
export function fencedBlocks(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf(FENCE_OPEN, at);
    if (open < 0) return out;
    const close = text.indexOf(FENCE_CLOSE, open);
    out.push(text.slice(open + FENCE_OPEN.length, close < 0 ? undefined : close));
    at = close < 0 ? text.length : close + FENCE_CLOSE.length;
  }
}
