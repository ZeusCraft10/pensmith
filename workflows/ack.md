# pensmith ack

> Acknowledge ONE citation that `pensmith verify` found RETRACTED, in ONE
> section, with the author's reason, so it stops blocking compile and export.
>
> **NON-NEGOTIABLE (CLAUDE.md / PRD §14): the verifier blocks compile and
> export.** A RETRACTED citation passes only after the author says, in their
> own words, why the paper cites the retracted work. `--yolo` never
> acknowledges anything, and nothing else does either.

<capability_check>
required:
  - (none required)

degrade_if_missing:
  - nothing to degrade: the verb reads files and writes one, with no model, network or prompt
</capability_check>

## When

A citation is RETRACTED when Pass 1 finds the work retracted, withdrawn or
removed: Crossref lists a retraction notice for it, PubMed types it a
Retracted Publication, its title carries a "RETRACTED:" label, or OpenAlex
lists it as retracted. Usually the fix is another source (`pensmith plan <N>
--revise`). Some papers must cite the retracted work: one about the
retraction itself, or one explaining why the work was withdrawn. For those,
the author acknowledges it:

```
pensmith ack <N> <citekey> --reason "<why the paper cites it>"
```

## Steps

1. Refuse (exit 2) without a non-empty `--reason`, for a key that is not in
   `.paper/CITATIONS.bib`, before section N has been verified, or when
   section N's `VERIFICATION.md` has no RETRACTED row for the key.
2. Bind the acknowledgement to the key and to the work its bibliography
   entry names: the SHA-256 of `doi:<normalized DOI>` (or of its first other
   identifier, `pmid:`, `arxiv:` or `isbn:`, when it has no DOI). Refuse an
   entry with no identifier.
3. Record it in `.paper/sections/<NN>-<slug>/ACKNOWLEDGEMENTS.json`:
   `{ kind: "retracted", citekey, work, work_sha256, reason, acknowledged_at }`,
   replacing an earlier acknowledgement of the same key and work.
4. Tell the author to run `pensmith verify <N>`. Pass 1 then gives the
   citation RETRACTED_ACKNOWLEDGED, which does not block; verify, compile and
   done each warn about it.

The acknowledgement covers that section only, and only that work: pointing
the key at another work, or citing it in another section, needs another
acknowledgement.

## In Tier 1

Never run `pensmith ack` on your own. Show the user the RETRACTED verdict and
ask whether the paper must cite the retracted work. Only if they say so, run
it with their reason, in their words.
