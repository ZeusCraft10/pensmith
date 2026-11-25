// bin/lib/dry-run.ts — what a step would do, for `--dry-run`.
//
// A dry run never runs the verb. The dispatcher works out which step would run
// (the named command, or the router's next step), and this module says what that
// step reads, writes, and which model and network calls it makes. The write
// chokepoint (atomic-write.ts) also refuses every write during a dry run, so a
// path that slips past the dispatcher still cannot change a file.

import { join, relative } from 'node:path';
import { paperDir, sectionDraft, sectionPlan, sectionVerification } from './paths.js';
import { resolveSectionSlug } from './section-slug.js';
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

const NO_MODEL = 'none';
const NO_NETWORK = 'none';
const MODEL_PROVIDER = 'the model provider';

function sectionNumber(args: Record<string, unknown>): number | null {
  const n = Number(args['n']);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Describe `target` as it would run in `paperRoot`. Reads files only. */
export function describeStep(target: DryRunTarget, paperRoot: string): DryRunStep {
  const rel = (p: string): string => relative(paperRoot, p) || p;
  const paper = (name: string): string => rel(join(paperDir(paperRoot), name));
  const { verb, args } = target;
  const n = sectionNumber(args);
  const slugArg = typeof args['slug'] === 'string' ? args['slug'] : undefined;
  const slug = n === null ? null : resolveSectionSlug(paperRoot, n, slugArg);
  const sec = (file: 'PLAN.md' | 'DRAFT.md' | 'VERIFICATION.md'): string => {
    if (n === null || slug === null) return `.paper/sections/<N>/${file}`;
    if (file === 'PLAN.md') return rel(sectionPlan(n, slug, paperRoot));
    if (file === 'DRAFT.md') return rel(sectionDraft(n, slug, paperRoot));
    return rel(sectionVerification(n, slug, paperRoot));
  };
  const command = ['pensmith', verb, ...(n === null ? [] : [String(n)])].join(' ');

  switch (verb) {
    case 'new':
      return {
        command,
        summary: 'Start a paper: read the assignment, ask clarifying questions, save the intake.',
        reads: [typeof args['from'] === 'string' ? args['from'] : 'the assignment (asked for)'],
        writes: ['STATE.json', paper('INTAKE.md'), paper('.gitignore'), 'the global list of papers'],
        model: '1 call (intake clarifier)',
        network: MODEL_PROVIDER,
      };
    case 'research':
      return {
        command,
        summary: 'Find sources for the topic and screen them into the library.',
        reads: [paper('INTAKE.md')],
        writes: [paper('LIBRARY.json'), paper('CITATIONS.bib'), paper('CITATIONS.ris')],
        model: 'topic scoping and source screening calls',
        network: `${MODEL_PROVIDER}; OpenAlex, Crossref, arXiv, PubMed and Semantic Scholar`,
        asks: 'approve the search scope and the candidate sources',
      };
    case 'outline':
      return {
        command,
        summary: 'Propose a section outline from the intake.',
        reads: [paper('INTAKE.md')],
        writes: [paper('OUTLINE.md'), 'STATE.json (sections)'],
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
        reads: [paper('OUTLINE.md'), paper('LIBRARY.json')],
        writes: [sec('PLAN.md')],
        model: '1 call (section planner)',
        network: MODEL_PROVIDER,
      };
    case 'write':
      if (n === null) {
        return {
          command,
          summary: 'Draft every planned section, wave by wave in dependency order.',
          reads: ['.paper/sections/*/PLAN.md'],
          writes: ['.paper/sections/*/DRAFT.md', '.paper/sections/*/PLAN.md (status)'],
          model: '1 call per section (section drafter)',
          network: MODEL_PROVIDER,
        };
      }
      return {
        command,
        summary: 'Draft this section from its plan (replacing any existing draft).',
        reads: [sec('PLAN.md')],
        writes: [sec('DRAFT.md'), `${sec('PLAN.md')} (status)`],
        model: '1 call (section drafter)',
        network: MODEL_PROVIDER,
      };
    case 'verify':
      return {
        command,
        summary: 'Check every citation and quote in this section against its source.',
        reads: [sec('DRAFT.md'), paper('CITATIONS.bib'), sec('PLAN.md')],
        writes: [sec('VERIFICATION.md'), `${sec('PLAN.md')} (status)`],
        model: 'claim-support and orphan-claim checks (advisory)',
        network: `${MODEL_PROVIDER}; Crossref and doi.org; open-access PDFs for quotes`,
      };
    case 'compile':
      return {
        command,
        summary: 'Assemble the verified sections into one draft (refused if any section is blocked).',
        reads: [paper('OUTLINE.md'), '.paper/sections/*/{PLAN,DRAFT,VERIFICATION}.md'],
        writes: [paper('DRAFT.md'), paper('COMPILE-REPORT.md'), paper('CITATIONS.bib')],
        model: NO_MODEL,
        network: 'registry re-checks for any section changed since it was verified',
      };
    case 'done':
      return {
        command,
        summary: 'Final audit and export of the compiled draft.',
        reads: [paper('DRAFT.md'), '.paper/sections/*/VERIFICATION.md'],
        writes: [`${paper('export')}/ (the exported paper)`, paper('VERIFICATION.md'), paper('FINAL.md')],
        model: 'whole-paper orphan-claim check (advisory)',
        network: `${MODEL_PROVIDER}; DuckDuckGo phrase search; GPTZero only with a key and your consent`,
        asks: 'confirm the export',
      };
    case 'add':
      return {
        command,
        summary: 'Add one source (DOI, PDF or URL) to the bibliography.',
        reads: [typeof args['source'] === 'string' ? args['source'] : 'the source'],
        writes: [paper('CITATIONS.bib'), 'section PLAN.md files, if remapped'],
        model: NO_MODEL,
        network: 'Crossref and the other registries',
        asks: 'remap sections to the new source',
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
        reads: ['STATE.json', '.paper/'],
        writes: [],
        model: NO_MODEL,
        network: verb === 'doctor' ? 'health probes' : NO_NETWORK,
      };
  }
}

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
  lines.push('Dry run: nothing was written and no network request was made.');
  return `${lines.join('\n')}\n`;
}
