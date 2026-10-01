// tests/helpers/pipeline-paper.ts — Phase 21 (stream pipeline) scratch papers
// for the compile and done user-path tests.
//
// A real paper inside an LLM sandbox (tests/helpers/llm-sandbox.ts: isolated
// data dir and HOME, optionally the RUN-21 mock LLM named in the global
// runtime.json): STATE.json, OUTLINE.md (canonical 8-column table, a title),
// INTAKE.md when asked, CITATIONS.bib of RECORDED works (Crossref and
// Retraction Watch replay offline), and per section a PLAN.md (with a `##
// Claims` list) and a DRAFT.md. `verifyAll()` runs the BUILT CLI's `verify`
// on every section, so the records compile and done read are real. The CLI is
// spawned asynchronously, so the in-process mock LLM can answer it.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLlmSandbox, type LlmSandbox, type SandboxOptions } from './llm-sandbox.js';
import { RECORDED_BIB } from './gate-paper.js';
import { CURRENT_STATE_VERSION } from '../../bin/lib/schemas/state.js';
import { renderIntakeDocument, type IntakeBriefInput } from '../../bin/lib/intake-brief.js';

export const PIPELINE_KEY = 'sk-ant-test-pipeline-0001';
const CLI_BIN = fileURLToPath(new URL('../../dist/bin/pensmith.js', import.meta.url));

export interface PipelineSection {
  n: number;
  slug: string;
  title: string;
  assigned: string[];
  draft: string;
  /** PLAN.md `## Claims` lines (one claim each). */
  claims?: string[];
}

export interface PipelinePaper {
  readonly sb: LlmSandbox;
  readonly root: string;
  sectionDir(n: number, slug: string): string;
  /** Run the built CLI in the paper root (async: the in-process mock can answer). */
  cli(args: readonly string[], env?: Record<string, string | undefined>, input?: string): Promise<{ status: number | null; stdout: string; stderr: string }>;
  /** `pensmith verify N` for every section; throws naming the first that fails. */
  verifyAll(): Promise<void>;
}

export interface PipelinePaperOptions {
  sections: PipelineSection[];
  /** The OUTLINE.md H1 (default "Deep Learning and Measurement"). */
  title?: string;
  /** INTAKE.md brief fields (discipline, citation style); no INTAKE.md when omitted. */
  intake?: { discipline: string; citationStyle?: string; topic?: string };
  /** .paper/config.toml (verbatim). */
  config?: string;
  bib?: string;
  sandbox?: SandboxOptions;
}

export function sectionDirOf(root: string, n: number, slug: string): string {
  return join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
}

/** The INTAKE.md a `pensmith new` writes (intake-brief.ts renderIntakeDocument), with the brief fields given. */
export function intakeMd(o: { discipline: string; citationStyle?: string; topic?: string }): string {
  const topic = o.topic ?? 'deep learning and measurement';
  return renderIntakeDocument(
    {
      topic,
      discipline: o.discipline,
      paper_type: 'argumentative',
      ...(o.citationStyle !== undefined ? { citation_style: o.citationStyle as IntakeBriefInput['citation_style'] } : {}),
      length_target_words: 1500,
    },
    `Write a 1500-word paper on ${topic}.`,
    [],
  );
}

function seed(root: string, o: PipelinePaperOptions): void {
  const paper = join(root, '.paper');
  mkdirSync(paper, { recursive: true });
  writeFileSync(
    join(paper, 'STATE.json'),
    JSON.stringify({ $schemaVersion: CURRENT_STATE_VERSION, paperId: 'pipeline-test', createdAt: '2026-01-01T00:00:00.000Z', sections: o.sections.map((s) => ({ n: s.n, slug: s.slug })) }, null, 2) + '\n',
  );
  const rows = o.sections.map((s) => `| ${s.n} | ${s.slug} | ${s.title} | body |  | 300 | ${s.assigned.join(', ')} | |`);
  writeFileSync(
    join(paper, 'OUTLINE.md'),
    [`# ${o.title ?? 'Deep Learning and Measurement'}`, '', '| # | slug | title | role | depends_on | word target | assigned_sources | voice |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n'),
  );
  writeFileSync(join(paper, 'CITATIONS.bib'), o.bib ?? RECORDED_BIB);
  writeFileSync(join(paper, 'RESEARCH.md'), '# Research\n');
  if (o.intake !== undefined) writeFileSync(join(paper, 'INTAKE.md'), intakeMd(o.intake));
  if (o.config !== undefined) writeFileSync(join(paper, 'config.toml'), o.config);
  for (const s of o.sections) {
    const dir = sectionDirOf(root, s.n, s.slug);
    mkdirSync(dir, { recursive: true });
    const claims = s.claims ?? [];
    writeFileSync(
      join(dir, 'PLAN.md'),
      [
        '---',
        'schema_version: 2',
        `section: ${s.n}`,
        `slug: ${s.slug}`,
        `title: ${JSON.stringify(s.title)}`,
        'depends_on: []',
        `assigned_sources: [${s.assigned.map((k) => `'${k}'`).join(', ')}]`,
        'verified_against_draft_hash: null',
        'status: written',
        '---',
        '',
        '## Claims',
        '',
        ...claims.flatMap((c, i) => [`${i + 1}. ${c}`, `   - Sources: ${s.assigned.join(', ') || '(none)'}`, '   - Evidence: (none)', '   - Counterexamples: (none)']),
        '',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'DRAFT.md'), s.draft);
  }
}

/** Run `fn` with a seeded paper in an LLM sandbox (the mock LLM unless `sandbox.mock` is false). */
export async function withPipelinePaper<T>(o: PipelinePaperOptions, fn: (p: PipelinePaper) => Promise<T>): Promise<T> {
  const sbOpts: SandboxOptions = { mock: 'anthropic', env: { ANTHROPIC_API_KEY: PIPELINE_KEY }, ...(o.sandbox ?? {}) };
  return withLlmSandbox(sbOpts, async (sb) => {
    seed(sb.root, o);
    const cli: PipelinePaper['cli'] = (args, env = {}, input) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI_BIN, ...args], { cwd: sb.root, env: sb.spawnEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
        child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
        child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
        child.stdin.end(input ?? '');
      });
    const paper: PipelinePaper = {
      sb,
      root: sb.root,
      sectionDir: (n, slug) => sectionDirOf(sb.root, n, slug),
      cli,
      async verifyAll(): Promise<void> {
        for (const s of o.sections) {
          const r = await cli(['verify', String(s.n)]);
          if (r.status !== 0) throw new Error(`verify ${s.n} exited ${String(r.status)}:\n${r.stdout}\n${r.stderr}`);
        }
      },
    };
    return fn(paper);
  });
}

/** Three sections citing the three recorded works, two paragraphs each. */
export const THREE_SECTIONS: PipelineSection[] = [
  {
    n: 1,
    slug: 'learning',
    title: 'Learning Representations',
    assigned: ['lecun2015'],
    draft:
      'Neural networks with many layers learn representations of raw data at several levels of abstraction [@lecun2015].\n\n' +
      'These layered models now set the pace for speech and image recognition across the field [@lecun2015].\n',
    claims: ['Deep networks learn layered representations of raw data.'],
  },
  {
    n: 2,
    slug: 'measurement',
    title: 'Measurement in Physics',
    assigned: ['aspelmeyer2009'],
    draft:
      'Measurement in quantum physics shapes what an observer is able to record about a system [@aspelmeyer2009].\n\n' +
      'Careful experimental design keeps that influence small enough to report honestly [@aspelmeyer2009].\n',
    claims: ['Quantum measurement shapes what an observer records.'],
  },
  {
    n: 3,
    slug: 'outbreak',
    title: 'An Outbreak Case',
    assigned: ['zhu2020'],
    draft:
      'Genome sequencing identified a novel coronavirus in patients with pneumonia in Wuhan in late 2019 [@zhu2020].\n\n' +
      'The rapid sharing of that sequence let laboratories everywhere develop tests within weeks [@zhu2020].\n',
    claims: ['Sequencing identified a novel coronavirus in late 2019.'],
  },
];
