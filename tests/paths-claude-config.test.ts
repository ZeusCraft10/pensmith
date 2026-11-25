// tests/paths-claude-config.test.ts
//
// Where Claude Code keeps its config is home-directory path logic, so it lives
// in the bin/lib/paths.ts chokepoint with the rest of it: $CLAUDE_CONFIG_DIR
// when set, else ~/.claude for the config dir and ~/.claude.json for the user
// config file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { claudeConfigDir, claudeJsonPath } from '../bin/lib/paths.js';

test('CLAUDE_CONFIG_DIR, when set, holds both the config dir and .claude.json', () => {
  const cfg = path.join(path.sep, 'tmp', 'claude-cfg');
  assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: cfg }), cfg);
  assert.equal(claudeJsonPath({ CLAUDE_CONFIG_DIR: cfg }), path.join(cfg, '.claude.json'));
});

test('without CLAUDE_CONFIG_DIR they are ~/.claude and ~/.claude.json', () => {
  for (const env of [{}, { CLAUDE_CONFIG_DIR: '' }]) {
    const dir = claudeConfigDir(env);
    assert.equal(path.basename(dir), '.claude');
    assert.equal(claudeJsonPath(env), path.join(path.dirname(dir), '.claude.json'));
  }
});
