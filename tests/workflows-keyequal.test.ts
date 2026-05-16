import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const EXPECTED_16 = [
  'doctor', 'new', 'next', 'status', 'research', 'outline', 'plan', 'write',
  'verify', 'compile', 'done', 'resume', 'list', 'open', 'sketch', 'add',
].sort();

// W4: closed vocabulary for ARCH-03 `required:` tokens.
// Workflows that need nothing emit `(none required)`.
const ALLOWED_REQUIRED_TOKENS = [
  'Task',
  'AskUserQuestion',
  'Pandoc',
  'Zotero MCP',
  'humanizer skill',
  '(none required)',
  // MCP tools are matched by the prefix `MCP ` — see vocabulary check below.
];

test('ARCH-01 / UX-02: workflows/ contains exactly 16 markdown bodies', () => {
  assert.ok(existsSync('workflows'), 'workflows/ directory missing');
  const files = readdirSync('workflows').filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(
    files.map((f) => f.replace(/\.md$/, '')),
    EXPECTED_16,
    `workflows/ files must equal UX-02 canonical 16-verb list`,
  );
});

test('ARCH-03: every workflow body has a <capability_check> block with required + degrade lists', () => {
  for (const verb of EXPECTED_16) {
    const src = readFileSync(`workflows/${verb}.md`, 'utf8');
    assert.match(src, /<capability_check>[\s\S]+?<\/capability_check>/, `${verb}.md: missing <capability_check>`);
    assert.match(src, /required:\s*\n/, `${verb}.md: <capability_check> must have a required: list`);
    assert.match(src, /degrade_if_missing:\s*\n/, `${verb}.md: <capability_check> must have a degrade_if_missing: list`);
  }
});

test('ARCH-03 W4: every required: token is in the closed Phase 2 vocabulary', () => {
  for (const verb of EXPECTED_16) {
    const src = readFileSync(`workflows/${verb}.md`, 'utf8');
    const blockMatch = src.match(/<capability_check>([\s\S]+?)<\/capability_check>/);
    assert.ok(blockMatch, `${verb}.md: <capability_check> not found`);
    const blockInner = blockMatch[1] ?? '';
    const required = blockInner.match(/required:\s*\n([\s\S]*?)\n\s*degrade_if_missing:/);
    assert.ok(required, `${verb}.md: required: section not parseable`);
    const requiredSection = required[1] ?? '';
    const tokens = requiredSection
      .split('\n')
      .map((l) => l.replace(/^\s*-\s*/, '').trim())
      .filter((l) => l.length > 0);
    for (const tok of tokens) {
      const ok = ALLOWED_REQUIRED_TOKENS.includes(tok) || /^MCP\s+\S+/.test(tok);
      assert.ok(ok, `${verb}.md: required: token '${tok}' is not in the W4 closed vocabulary {Task, AskUserQuestion, MCP <name>, Pandoc, Zotero MCP, humanizer skill, (none required)}`);
    }
  }
});

test('ARCH-01: workflow filenames are bijective with dispatcher verbs', () => {
  const dispatcherSrc = readFileSync('bin/pensmith.ts', 'utf8');
  const fileVerbs = readdirSync('workflows').filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
  for (const v of fileVerbs) {
    const re = new RegExp(`['"]?${v.replace('-', '\\-')}['"]?:\\s*\\(\\)\\s*=>`);
    assert.ok(re.test(dispatcherSrc), `workflow ${v}.md has no matching subCommand`);
  }
});
