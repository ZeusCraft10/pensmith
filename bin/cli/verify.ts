// bin/cli/verify.ts — `pensmith verify <n>`.
//
// A thin, deterministic orchestrator: it runs Pass 1 and Pass 3
// (bin/lib/verify/check-text.ts), aggregates the verdicts, and records them in
// the section's VERIFICATION.json, from which VERIFICATION.md is rendered
// (bin/lib/verify/verification-record.ts). It never loads a prompt: the
// blocking verdicts must not depend on a model. The hash-pinned
// `pass1-fuzzy-judge.md` and `pass3-quote-checker.md` prompts are not used
// here. tests/verify-advisory-isolation.test.ts checks that this file never
// names the prompt loader, comments included, hence the paraphrase.
//
// Pipeline:
//   1. Read DRAFT.md, CITATIONS.bib, PLAN.md and ACKNOWLEDGEMENTS.json once
//      each; the record's hashes and the verdicts are about those bytes, so
//      an edit made while the slow passes run is never recorded as verified.
//   2. Pass 1: each identifier resolved through its registries, the entry
//      compared with the record.
//   3. Pass 3: each quotation matched word for word in its open-access source.
//   4. Aggregate to a status (verified / unverifiable / failed). A draft that
//      is empty, or cites none of the sources its plan assigns, is not
//      verified: nothing in it was checked.
//   5. The advisory passes (freshness, Pass 2, Pass 4), which never change
//      the status.
//   6. Atomic-write VERIFICATION.json and VERIFICATION.md, then PLAN.md.

import { defineCommand } from 'citty';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { runFreshnessForDraft, renderFreshnessTable, parseBibForPass1, pass1CitedKeys } from '../lib/verify/pass1.js';
import { runPass2, renderPass2Section } from '../lib/verify/pass2.js';
import { runPass4, renderPass4Section } from '../lib/verify/pass4.js';
import { checkCitationsAndQuotes } from '../lib/verify/check-text.js';
import {
  bibEntryHashes,
  buildVerificationRecord,
  decideStatus,
  writeVerification,
} from '../lib/verify/verification-record.js';
import {
  sectionAcknowledgements,
  sectionDraft,
  sectionVerification,
  sectionVerificationRecord,
  sectionPlan,
  paperDir,
} from '../lib/paths.js';
import { citationWarnings, recordOnlyRetractionWarning, unattributedWarning } from '../lib/verify/verdict-rows.js';
import { readAcknowledgements } from '../lib/verify/acknowledgements.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { assignedSourcesFrom, updatePlanFrontmatter } from '../lib/plan-status.js';
import { resolveSectionSlug, sectionNumberArg } from '../lib/section-slug.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';
import { isPlaceholderText } from '../lib/placeholder.js';

/** The section's assigned sources from PLAN.md, read once; none when PLAN.md is absent or unreadable. */
function assignedSourcesOf(planPath: string): string[] {
  try {
    if (!existsSync(planPath)) return [];
    return assignedSourcesFrom(parseFrontmatter(readFileSync(planPath, 'utf8')).frontmatter);
  } catch {
    return [];
  }
}

export const verifyCommand = defineCommand({
  meta: {
    name: 'verify',
    description: 'Run deterministic Pass-1 + Pass-3 verification on a section DRAFT.md.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based).',
      required: true,
      valueHint: '3',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to "placeholder").',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    const n = sectionNumberArg('verify', args.n);
    if (n === null) return { ok: false, status: 'invalid-input' };
    // The slug comes from OUTLINE.md for section n (an explicit --slug wins;
    // 'placeholder' only if no outline row exists).
    const slug = resolveSectionSlug(process.cwd(), n, args.slug);
    const draftPath = sectionDraft(n, slug);
    const verifPath = sectionVerification(n, slug);
    const recordPath = sectionVerificationRecord(n, slug);
    const planPath = sectionPlan(n, slug);
    const bibPath = path.join(paperDir(), 'CITATIONS.bib');
    const assignedSources = assignedSourcesOf(planPath);

    // Every refusal below records a status with its reason and no verdicts
    // (`checked: false`), which compile and done refuse, and records the same
    // status in PLAN.md with no draft hash: a "verified" mark from an earlier
    // run must not outlive a run that could not verify. A section not drafted
    // yet keeps its planned or writing status, so the router still sends it on
    // to be planned or written instead of back to verify.
    const refuse = async (
      status: 'failed' | 'unverifiable',
      reason: string,
      draftBytes: Buffer | null,
      { keepPreDraftStatus = false } = {},
    ): Promise<void> => {
      const record = buildVerificationRecord({ section: n, slug, status, checked: false, reason, draftBytes, assignedSources });
      await writeVerification(recordPath, verifPath, record);
      await updatePlanFrontmatter(planPath, (fm) => {
        if (!(keepPreDraftStatus && (fm.status === 'stub' || fm.status === 'planned' || fm.status === 'writing'))) fm.status = status;
        fm.verified_against_draft_hash = null;
      });
      process.exitCode = EXIT_REFUSED;
    };

    if (!existsSync(draftPath)) {
      await refuse('unverifiable', `DRAFT.md missing at ${draftPath}`, null, { keepPreDraftStatus: true });
      process.stdout.write(`pensmith verify: DRAFT.md missing — wrote unverifiable VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'unverifiable', path: verifPath };
    }
    // The only read of the draft: the verdicts and the hashes are about these bytes.
    const draftBytes = readFileSync(draftPath);
    const draftMd = draftBytes.toString('utf8');
    // Placeholder text (PENSMITH_NO_LLM) is not a draft: no verdict on it may
    // read as clean, so it fails before any pass runs.
    if (isPlaceholderText(draftMd)) {
      const reason =
        `DRAFT.md is placeholder text from PENSMITH_NO_LLM, not a draft — re-run ` +
        `\`pensmith write ${n}\` with a model configured.`;
      await refuse('failed', reason, draftBytes);
      process.stdout.write(`pensmith verify: section ${n} ${reason} Wrote failed VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'failed', path: verifPath };
    }
    if (draftMd.trim().length === 0) {
      const reason = `DRAFT.md is empty, so there is nothing to verify — re-run \`pensmith write ${n}\`.`;
      await refuse('failed', reason, draftBytes);
      process.stdout.write(`pensmith verify: section ${n} ${reason} Wrote failed VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'failed', path: verifPath };
    }
    if (!existsSync(bibPath)) {
      await refuse('unverifiable', '.paper/CITATIONS.bib missing — run `pensmith research` first.', draftBytes);
      process.stdout.write(`pensmith verify: CITATIONS.bib missing — wrote unverifiable VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'unverifiable', path: verifPath };
    }

    // An empty CITATIONS.bib (research found nothing yet) is an empty library:
    // Pass 1 still runs, and every key the draft cites is FABRICATED.
    const bibText = readFileSync(bibPath, 'utf8');
    const bibIsEmpty = bibText.trim().length === 0;
    const bib = await parseBibForPass1(bibText);
    // The section's acknowledged retractions (`pensmith ack`). An unreadable
    // file lifts nothing; say so, since the author thinks it does.
    const ackPath = sectionAcknowledgements(n, slug);
    const acks = readAcknowledgements(ackPath);
    if (acks.unreadable) {
      process.stderr.write(`pensmith verify: WARN — ${ackPath} could not be read, so no acknowledgement in it applies.\n`);
    }
    const { pass1, pass3 } = await checkCitationsAndQuotes(draftMd, {
      bib, acknowledgements: acks.acknowledgements, section: n,
    });
    const cited = pass1CitedKeys(draftMd);

    // The status, from the verdicts (decideStatus): a blocking verdict, or a
    // draft citing none of its assigned sources, fails the section.
    const { status, reason, sourceTextMissing, unattributed, nothingToCheck } = decideStatus({
      section: n, pass1, pass3, citedKeys: cited, assignedSources, bibIsEmpty,
    });

    // The advisory passes run after the status is set and never change it.
    // Pass 2 / Pass 4 load their own prompts inside their modules, so this
    // file stays deterministic at the prompt-loader chokepoint.
    const freshness = await runFreshnessForDraft(draftMd, bib.entries);
    const bibByCitekey = bib.entries as Map<string, { DOI?: string; title?: string | string[]; abstract?: string }>;
    const pass2 = await runPass2(draftMd, bibByCitekey, { n });
    const pass4 = await runPass4(draftMd, { n });
    const advisoryMarkdown = [renderFreshnessTable(freshness), '', renderPass2Section(pass2), '', renderPass4Section(pass4)].join('\n');

    const record = buildVerificationRecord({
      section: n,
      slug,
      status,
      checked: true,
      ...(reason ? { reason } : {}),
      draftBytes,
      assignedSources,
      bibEntries: bibEntryHashes(cited, bib),
      acknowledgementsSha256: acks.sha256,
      pass1,
      pass3,
      advisoryMarkdown,
    });
    await writeVerification(recordPath, verifPath, record);

    // The status and the draft hash go into PLAN.md too, so the router
    // advances the pipeline instead of looping on verify. A later re-write
    // changes the draft bytes, leaving the stored hash stale, which forces a
    // re-verify. An absent or unwritable PLAN.md warns, never throws.
    const persisted = await updatePlanFrontmatter(planPath, (fm) => {
      fm.status = status;
      fm.verified_against_draft_hash = record.draft_hash;
    });
    if (!persisted) {
      process.stderr.write(
        `pensmith verify: WARN — could not persist status:'${status}' to ${planPath} ` +
        `(PLAN.md absent/unwritable); the router may not advance this section.\n`,
      );
    }

    process.stdout.write(`pensmith verify: wrote ${status} VERIFICATION.md to ${verifPath}\n`);
    if (reason) process.stdout.write(`pensmith verify: section ${n} ${reason}.\n`);
    // A retracted work cited with an acknowledgement, or one under an
    // expression of concern, passes but must not look clean.
    for (const w of citationWarnings(record.citations, `section ${n}`)) {
      process.stderr.write(`pensmith verify: WARN — ${w}.\n`);
    }
    // A citation that passed on its registry record alone was not checked
    // against OpenAlex's retraction list; that must not look like a full check.
    const recordOnly = pass1.filter((r) => r.retractionRecordOnly).length;
    if (recordOnly > 0) {
      process.stderr.write(`pensmith verify: WARN — ${recordOnlyRetractionWarning(`section ${n}`, recordOnly)} (see ${verifPath}).\n`);
    }
    // What nobody could check does not block yet, but must not look clean.
    if (unattributed > 0) {
      process.stderr.write(`pensmith verify: WARN — ${unattributedWarning(`section ${n}`, unattributed)}; see ${verifPath}.\n`);
    }
    if (status === 'failed') {
      // A blocking verdict: compile and done will refuse this section.
      process.exitCode = EXIT_REFUSED;
    } else if (sourceTextMissing) {
      process.stderr.write(
        `pensmith verify: WARN — section ${n} has quote(s) that could not be checked against source text; see ${verifPath}.\n`,
      );
    } else if (nothingToCheck) {
      process.stderr.write(`pensmith verify: WARN — section ${n} cites nothing, and CITATIONS.bib is empty; see ${verifPath}.\n`);
    }
    return { ok: status !== 'failed', status, path: verifPath, pass1, pass3, freshness, pass2, pass4 };
  },
});

export default verifyCommand;
