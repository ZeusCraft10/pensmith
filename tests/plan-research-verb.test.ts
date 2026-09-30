// tests/plan-research-verb.test.ts — `pensmith plan N --research <query>`
// through the BUILT CLI (GRND-17, D-19-18): the real verb, the real adapters
// replaying the recorded source cassettes (the test runner is
// sources-offline, RUN-01), the stubbed evaluator (PENSMITH_NO_LLM=1).
//
// The query is the one the cassettes record ("attention mechanisms in neural
// networks"); the second query (joined to the section title) is an offline
// miss, reported per adapter. `revise N --research` runs the same function.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, utimesSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { sandbox, runCli, snapshot, changedPaths, CLI_BIN } from './helpers/paper-cli-harness.js';
import { EXIT_OK, EXIT_APPROVAL } from '../bin/lib/exit-codes.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { RESEARCH_LOG_END } from '../bin/lib/research-md.js';

const QUERY = 'attention mechanisms in neural networks';
const IGNORE_LOGS = /^\.paper[\\/](SESSION\.log|COSTS\.jsonl|sessions)/;

function seed(root: string): void {
  const p = join(root, '.paper');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'INTAKE.md'), '---\ntopic: attention mechanisms in neural networks\ndiscipline: computer-science\n---\n# Intake\n\n## Assignment\n\nWrite a review.\n');
  writeFileSync(join(p, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'plan-research-cli', createdAt: '2026-01-01T00:00:00.000Z', sections: [{ n: 1, slug: 'introduction' }, { n: 2, slug: 'background' }, { n: 3, slug: 'discussion' }] }) + '\n');
  writeFileSync(join(p, 'OUTLINE.md'), '# Outline\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | introduction | Introduction |  | 300 |  |\n| 2 | background | Background |  | 300 |  |\n| 3 | discussion | Discussion |  | 300 |  |\n');
  for (const [n, slug, title] of [[1, 'introduction', 'Introduction'], [2, 'background', 'Background'], [3, 'discussion', 'Discussion']] as const) {
    const dir = join(p, 'sections', `0${n}-${slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'PLAN.md'), `---\nschema_version: 2\nsection: ${n}\nslug: ${slug}\ntitle: ${title}\ndepends_on: []\nassigned_sources: []\nstatus: planned\nverified_against_draft_hash: null\n---\n\n## Brief\n\nSection ${n}.\n`);
    if (n !== 2) writeFileSync(join(dir, 'DRAFT.md'), `# ${title}\n\nText.\n`);
  }
  writeFileSync(join(p, 'RESEARCH.md'), `# Research log\n\nScope: earlier\n\n${RESEARCH_LOG_END}\n\n## Notes\n\n- a curated note\n`);
}

function sectionFiles(root: string, dir: string): Map<string, { text: string; mtimeMs: number }> {
  const out = new Map<string, { text: string; mtimeMs: number }>();
  const d = join(root, '.paper', 'sections', dir);
  for (const f of readdirSync(d)) out.set(f, { text: readFileSync(join(d, f), 'utf8'), mtimeMs: statSync(join(d, f)).mtimeMs });
  return out;
}

test('GRND-17 (built CLI, recorded sources): plan 2 --research --yolo adds real hits to §2 only; non-TTY without --yolo exits 3 first', () => {
  assert.ok(existsSync(CLI_BIN), 'run npm run build');
  const sb = sandbox('plan-research-cli');
  const root = sb.project('p');
  seed(root);
  const past = new Date(Date.now() - 120_000);
  for (const dir of ['01-introduction', '03-discussion']) {
    for (const f of readdirSync(join(root, '.paper', 'sections', dir))) utimesSync(join(root, '.paper', 'sections', dir, f), past, past);
  }
  const s1 = sectionFiles(root, '01-introduction');
  const s3 = sectionFiles(root, '03-discussion');

  const before = snapshot(root);
  const refused = runCli(sb, root, ['plan', '2', '--research', QUERY]);
  assert.equal(refused.status, EXIT_APPROVAL, `${refused.stdout}\n${refused.stderr}`);
  assert.match(refused.stderr, /^pensmith: Add these research hits to the section\? \(section 2: nothing was searched, sent or written\) needs an answer/m);
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'nothing changed');

  const r = runCli(sb, root, ['plan', '2', '--research', QUERY, '--yolo']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^pensmith plan --research: section 2 "Background" — 2 queries$/m);
  assert.match(r.stdout, /^ {2}crossref +[1-9]\d* {2}ok; no recorded fixture for 1 of 2 queries$/m, 'per-adapter outcome');
  const added = /added (\d+) source\(s\) to section 2's assigned_sources/.exec(r.stdout);
  assert.ok(added && Number(added[1]) > 0, r.stdout);

  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ citekey: string; doi: string | null; provenance: string[] }> };
  assert.ok(lib.entries.length > 0);
  const dois = lib.entries.map((e) => e.doi).filter((d) => d !== null);
  assert.equal(new Set(dois).size, dois.length, 'no duplicate DOI');
  assert.ok(lib.entries.every((e) => e.provenance.some((p) => p.startsWith('plan-research:§2'))));
  const fm = parseFrontmatter(readFileSync(join(root, '.paper', 'sections', '02-background', 'PLAN.md'), 'utf8')).frontmatter;
  assert.deepEqual([...(fm['assigned_sources'] as string[])].sort(), lib.entries.map((e) => e.citekey).sort(), '§2 assigned_sources gained exactly the hits');
  assert.equal(fm['status'], 'planned');
  assert.deepEqual(sectionFiles(root, '01-introduction'), s1, '§1 unchanged (content and mtime)');
  assert.deepEqual(sectionFiles(root, '03-discussion'), s3, '§3 unchanged (content and mtime)');
  assert.ok(existsSync(join(root, '.paper', 'sections', '02-background', 'RESEARCH-LOG.md')));
  const md = readFileSync(join(root, '.paper', 'RESEARCH.md'), 'utf8');
  assert.ok(md.startsWith('# Research log\n\nScope: earlier\n\n<!-- pensmith:sources:start'), 'the prior log is kept; the sources block is inserted above the end line');
  assert.ok(md.endsWith('## Notes\n\n- a curated note\n'));
});

test('GRND-17: revise N --research runs the same section research pass', () => {
  const sb = sandbox('revise-research');
  const root = sb.project('p');
  seed(root);
  const driver = join(sb.base, 'revise-driver.mts');
  writeFileSync(
    driver,
    [
      `import { reviseCommand } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL('../bin/cli/revise.ts', import.meta.url))).href)};`,
      "const r = await reviseCommand.run({ args: { _: [], n: '2', research: process.argv[2], yolo: true }, rawArgs: [], cmd: reviseCommand });",
      "process.stdout.write(JSON.stringify({ mode: r.mode, added: r.added }) + '\\n');",
    ].join('\n'),
  );
  const res = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), driver, QUERY], { cwd: root, env: sb.env(), encoding: 'utf8', timeout: 60_000 });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /^pensmith revise --research: section 2 "Background" — 2 queries$/m);
  const last = JSON.parse(res.stdout.trim().split('\n').at(-1)!) as { mode: string; added: string[] };
  assert.equal(last.mode, 'research');
  assert.ok(last.added.length > 0);
  const fm = parseFrontmatter(readFileSync(join(root, '.paper', 'sections', '02-background', 'PLAN.md'), 'utf8')).frontmatter;
  assert.deepEqual(fm['assigned_sources'], last.added);
});
