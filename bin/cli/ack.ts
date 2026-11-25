// bin/cli/ack.ts — `pensmith ack <n> <citekey> --reason "<text>"`.
//
// A RETRACTED citation blocks compile and export. When the paper has a reason
// to cite the retracted work anyway (it is about the retraction, or explains
// why the work was withdrawn), the author records that decision here. The
// acknowledgement goes into the section's ACKNOWLEDGEMENTS.json, bound to the
// citekey and to the work its CITATIONS.bib entry names (the hash of its DOI),
// with the author's reason. The next `pensmith verify <n>` then reports
// RETRACTED_ACKNOWLEDGED, which compile and done pass with a warning.
//
// It acknowledges one citation in one section, and only one verify found
// RETRACTED. --yolo never acknowledges anything; only this command does.

import { defineCommand } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBibForPass1 } from '../lib/verify/pass1.js';
import { paperDir, sectionAcknowledgements, sectionVerificationRecord } from '../lib/paths.js';
import { resolveSectionSlug, sectionNumberArg } from '../lib/section-slug.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';
import { readVerificationRecord } from '../lib/verify/verification-record.js';
import { recordAcknowledgement, workBinding } from '../lib/verify/acknowledgements.js';

/** Verdicts an acknowledgement of a retraction applies to (a second ack replaces the reason). */
const ACKNOWLEDGEABLE = new Set(['RETRACTED', 'RETRACTED_ACKNOWLEDGED']);

export const ackCommand = defineCommand({
  meta: {
    name: 'ack',
    description: 'Acknowledge a RETRACTED citation in section <n> that the paper must cite, with your reason, so it no longer blocks.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based).',
      required: true,
      valueHint: '3',
    },
    citekey: {
      type: 'positional',
      description: 'The key of the RETRACTED citation.',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Why the paper cites the retracted work; it is recorded with the acknowledgement.',
    },
    slug: {
      type: 'string',
      description: 'Section slug (defaults to the one in OUTLINE.md).',
    },
  },
  async run({ args }) {
    const refuse = (why: string): { ok: false; status: 'refused' } => {
      process.stderr.write(`pensmith ack: ${why}\n`);
      process.exitCode = EXIT_REFUSED;
      return { ok: false, status: 'refused' };
    };
    const n = sectionNumberArg('ack', args.n);
    if (n === null) return { ok: false, status: 'invalid-input' };
    const typed = typeof args.citekey === 'string' ? args.citekey.trim() : '';
    // `@key` as the draft writes it names the same key.
    const citekey = typed.startsWith('@') ? typed.slice(1) : typed;
    if (!citekey) return refuse('name the citation to acknowledge: pensmith ack <n> <citekey> --reason "<why>"');
    const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
    if (!reason) {
      return refuse(`say why the paper cites this retracted work: pensmith ack ${n} ${citekey} --reason "<why>". The reason is recorded with the acknowledgement.`);
    }

    const slug = resolveSectionSlug(process.cwd(), n, args.slug);
    const bibPath = path.join(paperDir(), 'CITATIONS.bib');
    // Read as Pass 1 reads it, so the acknowledgement binds the work Pass 1 checks.
    const bib = await parseBibForPass1(existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : '');
    const entry = bib.entries.get(citekey);
    if (!entry) return refuse(`[@${citekey}] is not in .paper/CITATIONS.bib, so there is no work to acknowledge.`);

    // Only a citation verify found RETRACTED in this section can be acknowledged,
    // as its recorded verdicts (VERIFICATION.json) say.
    const record = readVerificationRecord(sectionVerificationRecord(n, slug));
    if (!record.ok) {
      return refuse(
        record.problem === 'missing'
          ? `section ${n} has not been verified, so nothing is RETRACTED yet — run \`pensmith verify ${n}\` first.`
          : `section ${n}'s recorded verdicts could not be read (${record.detail}) — run \`pensmith verify ${n}\` first.`,
      );
    }
    const row = record.record.citations.find((r) => r.citekey === citekey);
    if (!row || !ACKNOWLEDGEABLE.has(row.verdict)) {
      return refuse(
        `section ${n}'s recorded verdicts have no RETRACTED verdict for [@${citekey}]` +
        `${row ? ` (it is ${row.verdict})` : ''}, so there is nothing to acknowledge — ` +
        `run \`pensmith verify ${n}\` if the bibliography changed since.`,
      );
    }

    const binding = workBinding(entry, bib.fields.get(citekey));
    if (!binding) {
      return refuse(`[@${citekey}] has no DOI, arXiv ID, PMID or ISBN to bind the acknowledgement to — add one to its CITATIONS.bib entry.`);
    }
    const ackPath = sectionAcknowledgements(n, slug);
    const recorded = await recordAcknowledgement(ackPath, {
      kind: 'retracted',
      citekey,
      work: binding.work,
      work_sha256: binding.sha256,
      reason,
      acknowledged_at: new Date().toISOString(),
    });
    if (!recorded) return refuse(`${ackPath} could not be read; fix or remove it before adding to it.`);
    process.stdout.write(
      `pensmith ack: recorded that section ${n} cites the retracted work [@${citekey}] (${binding.work}) knowingly, in ${ackPath}.\n` +
      `  Run \`pensmith verify ${n}\` to apply it; compile and done will still warn about it.\n`,
    );
    return { ok: true, status: 'acknowledged', path: ackPath };
  },
});

export default ackCommand;
