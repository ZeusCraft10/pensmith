// tests/status.test.ts — RUN-19: `pensmith status` shows the paper, the
// position, per-section glyphs and a cost meter.
//
// With §1 verified, §2 writing and §3 planned: the title (and folder name),
// class, `current: §2 (write)`, ✓ / ⌛ / ⌽ lines (ASCII [x] / [~] / [ ] when
// the locale is not UTF-8), `cost: $X.XX this session / $Y.YY total (cap
// $5.00)` and `next: write §2`. Tier 1 shows `cost: n/a (Claude session)`.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { buildStatusView, glyphSetFor, renderStatusView } from '../bin/lib/status-view.js';
import { seedThreeSectionPaper } from './helpers/status-fixture.js';

async function seeded(sb: LlmSandbox): Promise<void> {
  await seedThreeSectionPaper(sb.root);
}

test('RUN-19: the view — title/name/class, current §2 (write), ✓ ⌛ ⌽, cost meter, next write §2', async () => {
  await withLlmSandbox({}, async (sb) => {
    await seeded(sb);
    const view = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    assert.equal(view.title, 'Tidal Power and Coastal Ecology');
    assert.equal(view.name, 'paper');
    assert.equal(view.class, 'ENGR 210');
    assert.deepEqual(view.current, { n: 2, slug: 'methods', step: 'write' });
    assert.equal(view.currentLine, 'current: §2 (write)');
    assert.deepEqual(view.sections.map((s) => [s.glyph, s.n, s.status]), [['✓', 1, 'verified'], ['⌛', 2, 'writing'], ['⌽', 3, 'planned']]);
    assert.equal(view.cost.line, 'cost: $0.00 this session / $1.23 total (cap $5.00)');
    assert.equal(view.nextLine, 'next: write §2');
    const text = renderStatusView(view);
    assert.match(text, /paper: Tidal Power and Coastal Ecology \(paper\) — class ENGR 210/);
    assert.match(text, /^ {4}✓ §1 intro: verified$/m);
    assert.match(text, /^ {4}⌛ §2 methods: writing$/m);
    assert.match(text, /^ {4}⌽ §3 results: planned$/m);
  });
});

test('RUN-19: Tier 1 (paper://state) shows cost n/a; the rest of the view is identical', async () => {
  await withLlmSandbox({}, async (sb) => {
    await seeded(sb);
    const cli = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    const mcp = await buildStatusView(sb.root, { tier: 'mcp', glyphs: 'unicode' });
    assert.equal(mcp.cost.line, 'cost: n/a (Claude session)');
    assert.equal(mcp.cost.sessionUsd, null);
    const strip = (v: typeof cli): unknown => ({ ...v, cost: null });
    assert.deepEqual(strip(mcp), strip(cli));
  });
});

test('RUN-19: glyph set follows the locale (LC_ALL > LC_CTYPE > LANG); no locale → ASCII on POSIX', () => {
  assert.equal(glyphSetFor({ LANG: 'en_US.UTF-8' }, 'linux'), 'unicode');
  assert.equal(glyphSetFor({ LANG: 'C' }, 'linux'), 'ascii');
  assert.equal(glyphSetFor({ LANG: 'en_US.UTF-8', LC_ALL: 'C' }, 'linux'), 'ascii');
  assert.equal(glyphSetFor({ LC_CTYPE: 'de_DE.utf8', LANG: 'C' }, 'darwin'), 'unicode');
  assert.equal(glyphSetFor({}, 'linux'), 'ascii');
  assert.equal(glyphSetFor({}, 'win32'), 'unicode');
});

test('RUN-19: `pensmith status` prints the view; LANG=C prints the ASCII glyphs', async () => {
  await withLlmSandbox({}, async (sb) => {
    await seeded(sb);
    const utf8 = sb.runCli(['status'], { env: { LANG: 'en_US.UTF-8', LC_ALL: undefined, LC_CTYPE: undefined } });
    assert.equal(utf8.status, 0, utf8.stderr);
    for (const line of ['current: §2 (write)', '✓ §1 intro: verified', '⌛ §2 methods: writing', '⌽ §3 results: planned', 'cost: $0.00 this session / $1.23 total (cap $5.00)', 'next: write §2']) {
      assert.ok(utf8.stdout.includes(line), `${line}\n${utf8.stdout}`);
    }
    const ascii = sb.runCli(['status'], { env: { LANG: 'C', LC_ALL: undefined, LC_CTYPE: undefined } });
    assert.equal(ascii.status, 0, ascii.stderr);
    for (const line of ['[x] §1 intro: verified', '[~] §2 methods: writing', '[ ] §3 results: planned']) {
      assert.ok(ascii.stdout.includes(line), `${line}\n${ascii.stdout}`);
    }
    assert.ok(!/[✓⌛⌽]/.test(ascii.stdout), 'no UTF-8 glyphs under LANG=C');
  });
});

test('RUN-19: no paper → a one-line hint; a corrupt STATE.json never crashes status', async () => {
  await withLlmSandbox({ paper: false }, async (sb) => {
    const none = await buildStatusView(sb.root, { tier: 'cli' });
    assert.equal(none.problem, 'no-paper');
    assert.equal(renderStatusView(none), 'pensmith status: no active paper — run `pensmith new` to start.');
    fs.mkdirSync(sb.paper, { recursive: true });
    // The one STATE.json location (RUN-13); a root-level non-pensmith STATE.json
    // is the user's own file, not a corrupt paper.
    fs.writeFileSync(path.join(sb.paper, 'STATE.json'), '{ not json');
    const corrupt = await buildStatusView(sb.root, { tier: 'cli' });
    assert.equal(corrupt.problem, 'corrupt-state');
    assert.match(renderStatusView(corrupt), /STATE\.json is unreadable\/corrupt/);
  });
});
