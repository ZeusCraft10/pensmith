// bin/lib/dry-run.ts — what a step would do, for `--dry-run`.
//
// A dry run never runs the verb. The dispatcher works out which step would run
// (the named command, or the router's next step), and this module says what that
// step reads, writes, and which model and network calls it makes. The write
// chokepoint (atomic-write.ts) also refuses every write during a dry run, so a
// path that slips past the dispatcher still cannot change a file.

import { join, relative, sep } from 'node:path';
import { paperDir, sectionAcknowledgements, sectionDraft, sectionPlan, sectionVerification, sectionVerificationRecord } from './paths.js';
import { parseSectionNumber, resolveSectionSlug } from './section-slug.js';
import type { Ux02Verb } from './verbs.js';

export interface DryRunStep {
  /** The command that would run, e.g. "pensmith write 1". */
  command: string;
  /** One line on what it does. */
  summary: string;
  reads: string[];
  writes: string[];
  model: string;
  network: string;
  /** A question the user would be asked, if any. */
  asks?: string;
}

export interface DryRunTarget {
  verb: Ux02Verb;
  /** Parsed arguments of the command (n, slug, revise, from, format, ...). */
  args: Record<string, unknown>;
}

/** The files of a section folder a step reads or writes, and where each lives. */
const SECTION_FILES = {
  'PLAN.md': sectionPlan,
  'DRAFT.md': sectionDraft,
  'VERIFICATION.md': sectionVerification,
  'VERIFICATION.json': sectionVerificationRecord,
  'ACKNOWLEDGEMENTS.json': sectionAcknowledgements,
} as const;

const NO_MODEL = 'none';
const NO_NETWORK = 'none';
const MODEL_PROVIDER = 'the model provider';

/** Describe `target` as it would run in `paperRoot`. Reads files only. */
export function describeStep(target: DryRunTarget, paperRoot: string): DryRunStep {
  // Paths are shown relative to the paper folder, with forward slashes on every OS.
  const rel = (p: string): string => (relative(paperRoot, p) || p).split(sep).join('/');
  const paper = (name: string): string => rel(join(paperDir(paperRoot), name));
  const { verb, args } = target;
  const n = parseSectionNumber(args['n']);
  const slugArg = typeof args['slug'] === 'string' ? args['slug'] : undefined;
  const slug = n === null ? null : resolveSectionSlug(paperRoot, n, slugArg);
  const sec = (file: keyof typeof SECTION_FILES): string =>
    n === null || slug === null ? `.paper/sections/<N>/${file}` : rel(SECTION_FILES[file](n, slug, paperRoot));
  const command = ['pensmith', verb, ...(n === null ? [] : [String(n)])].join(' ');

  switch (verb) {
    case 'new':
      return {
        command,
        summary: 'Start a paper: keep the assignment, ask the intake questions, save the answers.',
        reads: [typeof args['from'] === 'string' ? args['from'] : 'the assignment (assignment.* in this folder, or asked for)'],
        writes: [
          paper('PROJECT.md'), paper('INTAKE.json'), paper('INTAKE.md'), paper('STATE.json'),
          paper('config.toml'), paper('.gitignore'), 'the global list of papers',
        ],
        model: '1 call (intake clarifier), unless every answer is given',
        network: MODEL_PROVIDER,
        asks: 'the intake questions (topic, discipline, length, citation style, audience, counterargument)',
      };
    case 'research':
      return {
        command,
        summary: 'Find sources for the topic and screen them into the library.',
        reads: [paper('INTAKE.json'), paper('PROJECT.md'), paper('LIBRARY.json'), paper('CITATIONS.bib')],
        writes: [paper('LIBRARY.json'), paper('CITATIONS.bib'), paper('CITATIONS.ris')],
        model: 'topic scoping and source screening calls',
        network: `${MODEL_PROVIDER}; OpenAlex, Crossref, arXiv, PubMed and Semantic Scholar`,
        asks: 'approve the search scope and the candidate sources',
      };
    case 'outline':
      return {
        command,
        summary: 'Propose a section outline from the intake and the library, checked before it is shown.',
        reads: [paper('INTAKE.json'), paper('PROJECT.md'), paper('LIBRARY.json'), paper('OUTLINE.md')],
        writes: [paper('OUTLINE.json'), paper('OUTLINE.md'), `${paper('STATE.json')} (sections)`, '.paper/sections/<NN>-<slug>/PLAN.md (stubs)'],
        model: '1 call (outline author)',
        network: MODEL_PROVIDER,
        asks: 'approve the outline',
      };
    case 'plan':
      if (args['revise'] === true || typeof args['research'] === 'string') {
        return {
          command: `${command} --revise`,
          summary: 'Repair a citation the verifier flagged in this section.',
          reads: [sec('VERIFICATION.md'), sec('DRAFT.md'), sec('PLAN.md'), paper('CITATIONS.bib')],
          writes: [sec('DRAFT.md'), sec('PLAN.md'), sec('VERIFICATION.md')],
          model: 'up to 2 calls (citation swap)',
          network: MODEL_PROVIDER,
          asks: 'approve the proposed change',
        };
      }
      return {
        command,
        summary: 'Plan this section: its claims and the sources it may cite.',
        reads: [paper('OUTLINE.json'), paper('INTAKE.json'), paper('LIBRARY.json'), sec('PLAN.md')],
        writes: [sec('PLAN.md')],
        model: '1 call (section planner)',
        network: MODEL_PROVIDER,
      };
    case 'write':
      if (n === null) {
        return {
          command,
          summary: 'Draft every planned section, wave by wave in dependency order (with --force, drafted sections too).',
          reads: ['.paper/sections/*/PLAN.md', paper('OUTLINE.json'), paper('LIBRARY.json')],
          writes: ['.paper/sections/*/DRAFT.md', '.paper/sections/*/PLAN.md (status)'],
          model: '1 call per section (section drafter)',
          network: MODEL_PROVIDER,
        };
      }
      return {
        command,
        summary: 'Draft this section from its plan and the sources it assigns (a section already drafted needs --force).',
        reads: [sec('PLAN.md'), paper('OUTLINE.json'), paper('LIBRARY.json')],
        writes: [sec('DRAFT.md'), `${sec('PLAN.md')} (status)`],
        model: '1 call (section drafter)',
        network: MODEL_PROVIDER,
      };
    case 'verify':
      return {
        command,
        summary: 'Check every citation and quote in this section against its source.',
        reads: [sec('DRAFT.md'), paper('CITATIONS.bib'), sec('PLAN.md'), sec('ACKNOWLEDGEMENTS.json')],
        writes: [sec('VERIFICATION.json'), sec('VERIFICATION.md'), `${sec('PLAN.md')} (status)`],
        model: 'claim-support and orphan-claim checks (advisory)',
        network: `${MODEL_PROVIDER}; Crossref and doi.org; open-access PDFs for quotes`,
      };
    case 'compile':
      return {
        command,
        summary: 'Assemble the verified sections into one draft (refused if any section is blocked).',
        reads: [paper('OUTLINE.md'), '.paper/sections/*/{PLAN,DRAFT}.md', '.paper/sections/*/VERIFICATION.json', paper('CITATIONS.bib')],
        writes: [paper('DRAFT.md'), paper('COMPILE-REPORT.md'), paper('COMPILE-MANIFEST.json')],
        model: NO_MODEL,
        network: 'registry re-checks for any section changed since it was verified',
      };
    case 'done':
      return {
        command,
        summary: 'Final audit and export of the compiled draft.',
        reads: [paper('DRAFT.md'), paper('COMPILE-MANIFEST.json'), '.paper/sections/*/{DRAFT.md,VERIFICATION.json}', paper('CITATIONS.bib')],
        writes: [`${paper('export')}/ (the exported paper)`, paper('VERIFICATION.md'), paper('FINAL.md')],
        model: 'whole-paper orphan-claim check (advisory)',
        network: `Crossref and the other registries (every citation is checked again); open-access PDFs for quotes; ${MODEL_PROVIDER}; DuckDuckGo phrase search; GPTZero only with a key and your consent`,
        asks: 'confirm the export',
      };
    case 'add':
      return {
        command,
        summary: 'Add a source (DOI, arXiv ID, PDF, URL, .bib or CSL-JSON file) to the library.',
        reads: [typeof args['source'] === 'string' ? args['source'] : 'the source', paper('LIBRARY.json'), paper('CITATIONS.bib')],
        writes: [paper('LIBRARY.json'), paper('CITATIONS.bib'), paper('CITATIONS.ris'), `${paper('sources')}/ (a PDF's text)`, 'section PLAN.md files, if remapped'],
        model: NO_MODEL,
        network: 'Crossref and arXiv (for a PDF with no identifier of its own, a Crossref search for its title line)',
        asks: 'remap sections to the new source',
      };
    case 'ack':
      return {
        command: typeof args['citekey'] === 'string' ? `${command} ${args['citekey']}` : command,
        summary: 'Record that this section cites a RETRACTED work knowingly, with your reason.',
        reads: [paper('CITATIONS.bib'), sec('VERIFICATION.json'), sec('ACKNOWLEDGEMENTS.json')],
        writes: [sec('ACKNOWLEDGEMENTS.json')],
        model: NO_MODEL,
        network: NO_NETWORK,
      };
    case 'sketch':
      return {
        command,
        summary: 'Explore a thesis, then start a paper from it once you confirm.',
        reads: [],
        writes: ['the same files as `pensmith new`, after you confirm'],
        model: 'thesis sketch calls',
        network: MODEL_PROVIDER,
        asks: 'proceed to intake with the thesis',
      };
    case 'gate':
      return {
        command: [command, ...['action', 'ref', 'option'].flatMap((k) => (typeof args[k] === 'string' ? [args[k] as string] : []))].join(' '),
        summary: 'Record your answer to a decision a step is waiting for, then finish that step; or list the waiting decisions.',
        reads: [paper('gates')],
        writes: [`${paper('gates')}/ (the answer), and what the step that asked writes`],
        model: 'none to take the answer; the step that asked may make its own calls (research scope: the searches and screening)',
        network: 'what the step that asked uses',
      };
    case 'open':
      return {
        command: typeof args['name'] === 'string' ? `${command} ${args['name']}` : command,
        summary: 'Switch the active paper.',
        reads: ['the global list of papers'],
        writes: ['the active-paper pointer'],
        model: NO_MODEL,
        network: NO_NETWORK,
      };
    case 'status':
    case 'list':
    case 'doctor':
    case 'next':
    case 'resume':
      return {
        command,
        summary: 'Report state only.',
        reads: [paper('STATE.json'), '.paper/'],
        writes: [],
        model: NO_MODEL,
        network: verb === 'doctor' ? 'health probes' : NO_NETWORK,
      };
  }
}

/** The last line of every dry-run report. */
export const DRY_RUN_TRAILER = 'Dry run: nothing was written and no network request was made.';

/** The dry-run report. `lead` is the first line (what would run and why). */
export function renderDryRun(lead: string, step: DryRunStep): string {
  const list = (xs: string[]): string => (xs.length > 0 ? xs.join(', ') : 'nothing');
  const lines = [
    lead,
    `  ${step.summary}`,
    `  Reads:   ${list(step.reads)}`,
    `  Writes:  ${list(step.writes)}`,
    `  Model:   ${step.model}`,
    `  Network: ${step.network}`,
  ];
  if (step.asks) lines.push(`  Asks:    ${step.asks}`);
  lines.push(DRY_RUN_TRAILER);
  return `${lines.join('\n')}\n`;
}
