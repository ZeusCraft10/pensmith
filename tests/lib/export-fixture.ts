// tests/lib/export-fixture.ts — a compiled, verified paper ready for `pensmith done`,
// and a runner for the real CLI with isolated global state.

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDraftHash } from '../../bin/lib/draft-hash.js';
import { fixtureBibHashes, writeCompileManifestFixture, writeVerificationFixture } from './verification-fixture.js';
import { parseBibForPass1 } from '../../bin/lib/verify/pass1.js';
import { readAcknowledgements, recordAcknowledgement, workBinding } from '../../bin/lib/verify/acknowledgements.js';

const PENSMITH_TS = fileURLToPath(new URL('../../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

export interface SectionSpec {
  slug: string;
  title: string;
  draft: string;
  sources?: string[];
  /** Keys of retracted works this section cites knowingly (`pensmith ack`). */
  acknowledge?: string[];
}

export interface PaperSpec {
  title?: string;
  sections: SectionSpec[];
  bib: string;
  /** The compiled .paper/DRAFT.md; defaults to the title plus the drafts. */
  compiled?: string;
  ris?: string;
  intake?: string;
  configToml?: string;
}

/**
 * A paper whose sections are verified against their current drafts and
 * compiled: each section's VERIFICATION.json records OK for every work it
 * cites, and COMPILE-MANIFEST.json binds the compiled draft to them. A
 * `compiled` manuscript other than the sections' is written after the
 * manifest, so done refuses it (exportDraft, called directly, does not check).
 */
export async function compiledPaper(spec: PaperSpec): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-export-'));
  const pdir = join(root, '.paper');
  mkdirSync(pdir, { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 2,
      paperId: 'export-fixture',
      createdAt: new Date().toISOString(),
      sections: spec.sections.map((s, i) => ({ n: i + 1, slug: s.slug })),
    }),
  );
  writeFileSync(join(pdir, 'LIBRARY.json'), '{"$schemaVersion":1,"entries":[]}\n');
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    [
      `# ${spec.title ?? 'Export Fixture'}`,
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      ...spec.sections.map((s, i) => `| ${i + 1} | ${s.slug} | ${s.title} | | 300 | ${(s.sources ?? []).join(', ')} |`),
      '',
    ].join('\n'),
  );
  writeFileSync(join(pdir, 'CITATIONS.bib'), spec.bib);
  if (spec.ris !== undefined) writeFileSync(join(pdir, 'CITATIONS.ris'), spec.ris);
  if (spec.intake !== undefined) writeFileSync(join(pdir, 'INTAKE.md'), spec.intake);
  if (spec.configToml !== undefined) writeFileSync(join(root, 'config.toml'), spec.configToml);
  spec.sections.forEach((s, i) => {
    const sdir = join(pdir, 'sections', `${String(i + 1).padStart(2, '0')}-${s.slug}`);
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, 'DRAFT.md'), s.draft);
    const sources = s.sources ?? [];
    writeFileSync(
      join(sdir, 'PLAN.md'),
      `---\nsection: ${i + 1}\nslug: ${s.slug}\ntitle: ${s.title}\nstatus: verified\nassigned_sources: [${sources.join(', ')}]\n` +
        `verified_against_draft_hash: ${computeDraftHash(Buffer.from(s.draft), sources)}\n---\n`,
    );
  });
  const bib = await parseBibForPass1(spec.bib);
  for (const [i, s] of spec.sections.entries()) {
    const sdir = join(pdir, 'sections', `${String(i + 1).padStart(2, '0')}-${s.slug}`);
    const ackPath = join(sdir, 'ACKNOWLEDGEMENTS.json');
    for (const citekey of s.acknowledge ?? []) {
      const binding = workBinding(bib.entries.get(citekey) ?? {}, bib.fields.get(citekey));
      if (!binding) throw new Error(`compiledPaper: [@${citekey}] has no identifier to acknowledge`);
      await recordAcknowledgement(ackPath, {
        kind: 'retracted', citekey, work: binding.work, work_sha256: binding.sha256,
        reason: 'The fixture cites the retracted work knowingly.', acknowledged_at: new Date().toISOString(),
      });
    }
    writeVerificationFixture(sdir, {
      n: i + 1, slug: s.slug, draft: s.draft, assignedSources: s.sources ?? [], bibEntries: await fixtureBibHashes(spec.bib, s.draft),
      acknowledgementsSha256: readAcknowledgements(ackPath).sha256,
    });
  }
  const fromSections =
    [`# ${spec.title ?? 'Export Fixture'}`, ...spec.sections.map((s) => `## ${s.title}\n\n${s.draft.trim()}`)].join('\n\n') + '\n';
  writeFileSync(join(pdir, 'DRAFT.md'), fromSections);
  await writeCompileManifestFixture(root, spec.sections.map((s, i) => ({ n: i + 1, slug: s.slug })));
  if (spec.compiled !== undefined) writeFileSync(join(pdir, 'DRAFT.md'), spec.compiled);
  return root;
}

export interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
  home: string;
}

/**
 * Run the real CLI in `cwd` with its own HOME and data folders, no model, on
 * the recorded registry answers (tests/fixtures/cassettes): done checks every
 * citation it exports against the registries, so a fixture's works are
 * recorded there. Pass PENSMITH_OFFLINE: '1' to run offline.
 */
export function runCli(args: string[], cwd: string, extraEnv: Record<string, string> = {}): CliRun {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-export-home-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['HOME', 'USERPROFILE', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA']) env[k] = home;
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GPTZERO_API_KEY']) delete env[k];
  env['PENSMITH_NO_LLM'] = '1';
  delete env['PENSMITH_OFFLINE'];
  env['PENSMITH_TEST_CASSETTES'] = '1';
  Object.assign(env, extraEnv);
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', home };
}

/** True when `cmd --version` runs. */
export function hasTool(cmd: string): boolean {
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 10_000 });
  return r.status === 0;
}

/**
 * Skip option for a test that needs an external tool (pandoc, pdflatex).
 * PENSMITH_REQUIRE_EXPORT_TOOLS=1, set by the CI export lane, turns a missing
 * tool into a failure, so those tests cannot pass by skipping.
 */
export function needsTool(cmd: string): { skip: string | false } {
  if (hasTool(cmd)) return { skip: false };
  if (process.env['PENSMITH_REQUIRE_EXPORT_TOOLS'] === '1') {
    throw new Error(`${cmd} is required (PENSMITH_REQUIRE_EXPORT_TOOLS=1) but is not installed`);
  }
  return { skip: `${cmd} is not installed` };
}

/**
 * A PATH holding only a fake `pandoc` (a POSIX shell script) and node. The
 * script answers `--version` and otherwise runs `body`.
 */
export function fakePandocPath(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-fake-pandoc-'));
  const script = join(dir, 'pandoc');
  writeFileSync(script, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pandoc 3.1.3"; exit 0; fi\n${body}\n`);
  chmodSync(script, 0o755);
  return [dir, dirname(process.execPath), '/bin', '/usr/bin'].join(delimiter);
}

/**
 * A PATH with no Pandoc and no TeX: one empty folder. The CLI runs from
 * process.execPath, so it needs nothing on PATH (and node may share a folder
 * with pandoc, so its own folder cannot be used).
 */
export function pathWithoutPandoc(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-no-pandoc-'));
}
