// bin/cli/research.ts — `pensmith research` verb entrypoint (RSCH-01).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. In Tier 1 (Claude Code
// plugin) the workflow body delegates to the model with the
// `topic-disambiguator` + `source-evaluator` prompts. In Tier 2 (portable
// CLI) the verb still emits the two canonical artifacts so downstream
// verbs (outline, plan, write, verify) have something to read:
//   - .paper/LIBRARY.json (placeholder shape: { $schemaVersion, entries: [] })
//   - .paper/CITATIONS.bib (D-20 LOCKED canonical path; emitted via writeBibtex)
//
// Phase 3 Tier-2 fallback: see Plan 07 amendment.
//
// D-12 LOCKED prompt slugs: `topic-disambiguator` + `source-evaluator`.
// D-19 LOCKED chokepoint: bib output goes through writeBibtex (citation-js).
// D-20 LOCKED chokepoint: canonical .bib path is `.paper/CITATIONS.bib`.

import { defineCommand } from 'citty';
import path from 'node:path';
import { loadPrompt } from '../lib/prompt-loader.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { writeBibtex } from '../lib/bibtex-write.js';
import { paperDir } from '../lib/paths.js';

const PLACEHOLDER_LIBRARY = JSON.stringify(
  {
    $schemaVersion: 1,
    entries: [],
    _note:
      'Pensmith Tier 2: this section requires LLM research. Run in Claude Code, ' +
      'or set ANTHROPIC_API_KEY for direct API access (Phase 4 work).',
  },
  null,
  2,
);

export const researchCommand = defineCommand({
  meta: {
    name: 'research',
    description: 'Discover sources and build the working library.',
  },
  args: {
    queries: {
      type: 'string',
      description: 'Max number of disambiguation queries to issue (optional).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run() {
    // Phase 3 Tier-2 fallback: see Plan 07 amendment.
    // Load both prompt slugs eagerly so the hash-pin chokepoint catches drift
    // at runtime (defense-in-depth alongside tests/repo-files.test.ts).
    void loadPrompt;
    // Don't actually load — we skip when env has no API key. Both prompts
    // are still hash-pinned via EXPECTED_PROMPT_HASHES at module-load.

    const libraryPath = path.join(paperDir(), 'LIBRARY.json');
    const bibPath = path.join(paperDir(), 'CITATIONS.bib');

    await atomicWriteFile(libraryPath, PLACEHOLDER_LIBRARY);
    // D-19 + D-20 LOCKED: writeBibtex is the SOLE citation-js writer; emits
    // a zero-length file when given an empty array (which Plan 06 verify.md
    // reads via citations.parseBib).
    await writeBibtex([], bibPath);

    process.stdout.write(
      `pensmith research: wrote Tier-2 placeholder library to ${libraryPath} and empty .bib to ${bibPath}\n`,
    );
    return { ok: true, library: libraryPath, bib: bibPath, mode: 'tier2-placeholder' };
  },
});

export default researchCommand;
