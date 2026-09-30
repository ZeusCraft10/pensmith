// tests/helpers/status-fixture.ts — the RUN-19 status fixture shared by
// tests/status.test.ts and tests/tier-contract/status-fields.test.ts: a
// three-section paper with §1 verified (with its draft), §2 writing and §3 planned, a titled
// config, and $1.23 spent by an EARLIER session (paper total, not this session).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initSection, initState } from '../../bin/lib/state.js';
import { renderOutlineMd } from '../../bin/lib/outline-parse.js';

export async function seedThreeSectionPaper(root: string): Promise<void> {
  const paper = path.join(root, '.paper');
  fs.mkdirSync(paper, { recursive: true });
  await initState(root);
  fs.writeFileSync(path.join(paper, 'config.toml'), 'schema_version = 1\n[project]\ntitle = "Tidal Power and Coastal Ecology"\nclass = "ENGR 210"\n');
  fs.writeFileSync(path.join(paper, 'INTAKE.md'), 'Topic: tidal power\nDiscipline: other\n');
  fs.writeFileSync(path.join(paper, 'RESEARCH.md'), '# Research\n');
  fs.writeFileSync(path.join(paper, 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  const sections: Array<[number, string, string]> = [[1, 'intro', 'verified'], [2, 'methods', 'writing'], [3, 'results', 'planned']];
  fs.writeFileSync(path.join(paper, 'OUTLINE.md'), renderOutlineMd({
    thesis: '',
    sections: sections.map(([n, slug], i) => ({
      n, slug, title: slug[0]!.toUpperCase() + slug.slice(1), purpose: '', depends_on: i === 0 ? [] : [sections[i - 1]![1]],
      estimated_word_count: 500, assigned_sources: [], role: i === 0 ? 'intro' : 'body',
    })),
  }, 'Tidal Power and Coastal Ecology'));
  for (const [n, slug, status] of sections) {
    await initSection(root, n, slug);
    const dir = path.join(paper, 'sections', `0${n}-${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    const deps = n === 1 ? '[]' : `[${sections[n - 2]![1]}]`;
    fs.writeFileSync(path.join(dir, 'PLAN.md'), `---\nsection: ${n}\nslug: ${slug}\ntitle: ${slug}\ndepends_on: ${deps}\nassigned_sources: []\nstatus: ${status}\nverified_against_draft_hash: null\n---\n## Brief\n\nx\n`);
    // A verified section has its draft (VRFY-16: without it the router re-drafts it).
    if (status === 'verified') fs.writeFileSync(path.join(dir, 'DRAFT.md'), '# Intro\n\nTidal power is predictable.\n');
  }
  // An earlier session's spend: counts toward the paper total, not this session.
  fs.writeFileSync(path.join(paper, 'COSTS.jsonl'), JSON.stringify({ ts: '2026-09-01T00:00:00Z', scope: 'task', scopeId: 'outline-author', provider: 'anthropic', model: 'claude-opus-5', inputTokens: 1000, outputTokens: 1000, costUsd: 1.23, session: 'earlier-session' }) + '\n');
}
