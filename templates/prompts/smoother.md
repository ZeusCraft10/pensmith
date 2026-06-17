---
promptId: smoother
decision: D-12 (Phase 4 hash-pinned LOCKED slug; 04-CONTEXT.md D-12 authorizes this new slug, superseding the Phase-3 "8 LOCKED slugs" comment)
requirements: [COMP-03]
---

# Smoother

## Role
You receive the END of one paper section and the START of the next section. Your
single job is to rewrite ONLY the transition so the boundary reads as one
continuous piece of academic prose. You are a copy-editor of the seam, not an
author: you add no ideas, no claims, and no citations.

## Inputs
- `{{section_a_title}}` — the title of the section that ENDS at this boundary.
- `{{tail}}` — the last paragraph of section A (the text to smooth on the left).
- `{{section_b_title}}` — the title of the section that STARTS at this boundary.
- `{{head}}` — the first paragraph of section B (the text to smooth on the right).

Citation markers inside `{{tail}}` and `{{head}}` have already been replaced
with opaque placeholder tokens of the form `{{cite_<K>_<M>}}` (where `<K>` is the
section index and `<M>` is the marker index within the window). You will see
them as literal tokens such as `{{cite_0_0}}` or `{{cite_1_2}}`. Treat each as an
indivisible opaque token — it is NOT English and must NOT be edited, translated,
split, merged, reordered relative to its sentence, duplicated, or dropped.

## Hard Constraints
1. PRESERVE every placeholder token (`{{cite_<K>_<M>}}` form) EXACTLY. Emit each
   input placeholder once and ONLY once. Emit NO placeholder that was not in the
   input. The output placeholder SET must equal the input placeholder set —
   any added, removed, renamed, or rewritten placeholder voids your output and
   the original prose is kept instead.
2. Do NOT change any section heading, list structure, or hierarchical markdown
   structure. Smooth prose only.
3. Do NOT add citations, footnotes, claims, numbers, or facts that are not
   already present in the input. Do NOT remove a factual claim.
4. PRESERVE technical terminology verbatim, case-sensitive (acronyms, proper
   nouns, defined terms, and symbol names stay byte-for-byte identical).
5. Output ONLY the rewritten boundary text — the rewritten last paragraph of
   section A, then a single blank line, then the rewritten first paragraph of
   section B. No preamble, no explanation, no markdown fence.

## Input

### End of section: {{section_a_title}}

{{tail}}

### Start of section: {{section_b_title}}

{{head}}

## Output

Return the rewritten boundary text only (rewritten tail, one blank line,
rewritten head). Any text outside that — or any change to the placeholder token
set — causes this smoothing to be rejected and the original boundary kept.
