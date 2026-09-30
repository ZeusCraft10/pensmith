// tests/status.test.ts — RUN-19: `pensmith status` shows the paper, the
// position, per-section glyphs and a cost meter.
//
// With §1 verified, §2 writing and §3 planned: the title (and folder name),
// class, `current: §2 (write)`, ✓ / ⌛ / ⌽ lines (ASCII [x] / [~] / [ ] when
// the locale is not UTF-8, with `#N` for `§N` so the output is pure ASCII),
// `cost: $X.XX <session> / $Y.YY total (cap $5.00)` and `next: write §2`, where
// <session> is `this session` (this process spent), `running session` (the live
// session-lock holder) or `last session` (the last one in COSTS.jsonl) — a
// standalone status never meters its own always-empty process. Tier 1
// (paper://state) shows the same meter: the plugin's plan and write bill the
// configured provider in this release (review round 2).

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
    assert.deepEqual(view.current, { n: 2, id: '2', slug: 'methods', step: 'write' });
    assert.equal(view.attention, null);
    assert.equal(view.currentLine, 'current: §2 (write)');
    assert.deepEqual(view.sections.map((s) => [s.glyph, s.n, s.status]), [['✓', 1, 'verified'], ['⌛', 2, 'writing'], ['⌽', 3, 'planned']]);
    // The fixture's $1.23 was spent by an EARLIER session: that is what a
    // standalone status meters, never its own empty process.
    assert.equal(view.cost.line, 'cost: $1.23 last session / $1.23 total (cap $5.00)');
    assert.equal(view.cost.sessionLabel, 'last session');
    assert.equal(view.nextLine, 'next: write §2');
    const text = renderStatusView(view);
    assert.match(text, /paper: Tidal Power and Coastal Ecology \(paper\) — class ENGR 210/);
    assert.match(text, /^ {4}✓ §1 intro: verified$/m);
    assert.match(text, /^ {4}⌛ §2 methods: writing$/m);
    assert.match(text, /^ {4}⌽ §3 results: planned$/m);
  });
});

test('RUN-19: Tier 1 (paper://state) shows the same view, cost meter included — the plugin\'s plan and write bill the configured provider', async () => {
  await withLlmSandbox({}, async (sb) => {
    await seeded(sb);
    const cli = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    const mcp = await buildStatusView(sb.root, { tier: 'mcp', glyphs: 'unicode' });
    assert.equal(mcp.cost.line, 'cost: $1.23 last session / $1.23 total (cap $5.00)');
    assert.doesNotMatch(mcp.cost.line, /n\/a|Claude session/, 'never "n/a": pensmith_plan / pensmith_write spend real money');
    assert.deepEqual({ ...mcp, cost: { ...mcp.cost, tier: 'cli' } }, cli, 'only the recorded tier differs');
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
    for (const line of ['current: §2 (write)', '✓ §1 intro: verified', '⌛ §2 methods: writing', '⌽ §3 results: planned', 'cost: $1.23 last session / $1.23 total (cap $5.00)', 'next: write §2']) {
      assert.ok(utf8.stdout.includes(line), `${line}\n${utf8.stdout}`);
    }
    const ascii = sb.runCli(['status'], { env: { LANG: 'C', LC_ALL: undefined, LC_CTYPE: undefined } });
    assert.equal(ascii.status, 0, ascii.stderr);
    for (const line of ['current: #2 (write)', '[x] #1 intro: verified', '[~] #2 methods: writing', '[ ] #3 results: planned', 'next: write #2']) {
      assert.ok(ascii.stdout.includes(line), `${line}\n${ascii.stdout}`);
    }
    assert.ok(!/[✓⌛⌽]/.test(ascii.stdout), 'no UTF-8 glyphs under LANG=C');
    assert.match(ascii.stdout, /^[\x00-\x7f]*$/, 'the whole LANG=C status output is ASCII (no §, no em dash)');
  });
});

test('RUN-19: the cost meter shows the RUNNING session (live lock holder), else the last one; this process only when it spent', async () => {
  await withLlmSandbox({}, async (sb) => {
    await seeded(sb);
    const costs = path.join(sb.paper, 'COSTS.jsonl');
    const rec = (session: string, usd: number): string =>
      JSON.stringify({ ts: '2026-09-02T00:00:00Z', scope: 'task', scopeId: 'section-drafter', provider: 'anthropic', model: 'claude-opus-5', inputTokens: 1, outputTokens: 1, costUsd: usd, session }) + '\n';
    fs.appendFileSync(costs, rec('run-a', 0.5) + rec('run-b', 0.25) + rec('run-b', 0.25));
    const last = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    assert.equal(last.cost.line, 'cost: $0.50 last session / $2.23 total (cap $5.00)', 'the last session in COSTS.jsonl (run-b: 2 records)');

    // A live session (another process of this host holds the lock): its spend.
    const { sessionLockFile } = await import('../bin/lib/session-lock.js');
    fs.mkdirSync(path.dirname(sessionLockFile(sb.root)), { recursive: true });
    fs.writeFileSync(sessionLockFile(sb.root), JSON.stringify({
      hostname: 'another-host', pid: 424242, sessionId: 'run-a', kind: 'cli', verb: 'write',
      startedAt: new Date().toISOString(), claudeSessionId: null, root: sb.root,
    }));
    try {
      const running = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
      assert.equal(running.cost.line, 'cost: $0.50 running session / $2.23 total (cap $5.00)');
    } finally {
      fs.rmSync(sessionLockFile(sb.root), { force: true });
    }
  });
});

test('RUN-19: no paper → a one-line hint; a corrupt STATE.json never crashes status', async () => {
  await withLlmSandbox({ paper: false }, async (sb) => {
    const none = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    assert.equal(none.problem, 'no-paper');
    assert.equal(renderStatusView(none), 'pensmith status: no active paper — run `pensmith new` to start.');
    const noneAscii = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'ascii' });
    assert.equal(renderStatusView(noneAscii), 'pensmith status: no active paper - run `pensmith new` to start.');
    fs.mkdirSync(sb.paper, { recursive: true });
    // The one STATE.json location (RUN-13); a root-level non-pensmith STATE.json
    // is the user's own file, not a corrupt paper.
    fs.writeFileSync(path.join(sb.paper, 'STATE.json'), '{ not json');
    const corrupt = await buildStatusView(sb.root, { tier: 'cli' });
    assert.equal(corrupt.problem, 'corrupt-state');
    assert.match(renderStatusView(corrupt), /STATE\.json is unreadable\/corrupt/);
  });
});
