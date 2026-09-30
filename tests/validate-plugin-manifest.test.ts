// tests/validate-plugin-manifest.test.ts — PLUG-01 / D-23a-08: the plugin
// validator enforces the Claude Code plugin spec plus pensmith's contract
// values, and rejects the pre-v1 shapes that stopped the plugin from loading.
//
// Each case runs the real script (`node scripts/validate-plugin-manifest.cjs
// --root <dir>`) over the negative-control fixture tests/fixtures/plugin-legacy/
// or over a temp copy of the real tree with exactly one thing broken, and
// asserts the exit code and the named reason. The copy of the unbroken tree
// must pass — which needs the committed bundles in plugin/dist/ (`npm run
// bundle`); the broken copies name their own reason with or without them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR = path.join(REPO, 'scripts', 'validate-plugin-manifest.cjs');
const LEGACY = path.join(REPO, 'tests', 'fixtures', 'plugin-legacy');

interface Run {
  status: number | null;
  out: string;
}

function validate(root: string): Run {
  const r = spawnSync(process.execPath, [VALIDATOR, '--root', root], { cwd: REPO, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** A temp copy of the parts of the repo the validator reads, returned with a cleanup. */
function copyTree(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'pensmith-validate-'));
  cpSync(path.join(REPO, 'plugin'), path.join(root, 'plugin'), { recursive: true });
  mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  cpSync(path.join(REPO, '.claude-plugin', 'marketplace.json'), path.join(root, '.claude-plugin', 'marketplace.json'));
  cpSync(path.join(REPO, '.mcp.json'), path.join(root, '.mcp.json'));
  cpSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function editJson(file: string, edit: (v: Record<string, unknown>) => void): void {
  const v = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  edit(v);
  writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);
}

function withBrokenCopy(breakIt: (root: string) => void, expect: RegExp | RegExp[]): void {
  const { root, cleanup } = copyTree();
  try {
    breakIt(root);
    const r = validate(root);
    assert.equal(r.status, 1, `the validator must fail:\n${r.out}`);
    for (const re of Array.isArray(expect) ? expect : [expect]) assert.match(r.out, re);
    assert.match(r.out, /Manifest validation FAILED/);
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// The negative control
// ---------------------------------------------------------------------------

test('PLUG-01: the pre-v1 fixture fails with every old shape named', () => {
  assert.ok(existsSync(path.join(LEGACY, '.claude-plugin', 'plugin.json')), 'the negative-control fixture exists');
  const r = validate(LEGACY);
  assert.equal(r.status, 1, r.out);
  // plugin.json: the skills array of {name, file} objects.
  assert.match(r.out, /plugin\.json: "skills" must be a path string or an array of path strings — an array of \{name, file\} objects is the pre-v1 shape/);
  // hooks.json: the homemade shape.
  assert.match(r.out, /hooks\.json: "schemaVersion" is the pre-v1 homemade shape/);
  assert.match(r.out, /hooks\.json: "hooks" is an array of \{event, script\} entries/);
  // hooks.json: a .ts target.
  assert.match(r.out, /"session-start\.ts" is a TypeScript source/);
  // The flat skill file.
  assert.match(r.out, /skills\/pensmith\.md: a flat skill file loads nothing/);
});

test('PLUG-01: the fixture carries no personal data', () => {
  const text = readFileSync(path.join(LEGACY, '.claude-plugin', 'plugin.json'), 'utf8');
  const emails = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
  assert.ok(emails.length > 0);
  for (const e of emails) assert.ok(e.endsWith('@example.org'), `${e} is a placeholder address`);
  assert.match(text, /"Pensmith Maintainers"/);
});

// ---------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------

test('PLUG-01: a copy of the real tree passes (needs the committed plugin/dist bundles)', () => {
  const { root, cleanup } = copyTree();
  try {
    const r = validate(root);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /✓ plugin\/ \(plugin\.json, hooks\.json, 8 skills, 16 workflow bodies\) \+ marketplace\.json \+ \.mcp\.json valid/);
  } finally {
    cleanup();
  }
});

test('ARCH-03: a workflow body without its <capability_check> block fails', () => {
  withBrokenCopy((root) => {
    const f = path.join(root, 'plugin', 'workflows', 'compile.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/<capability_check>[\s\S]+?<\/capability_check>/, ''));
  }, /plugin\/workflows\/compile\.md: missing its <capability_check> block/);
});

test('PLUG-01: a missing workflow body fails', () => {
  withBrokenCopy((root) => rmSync(path.join(root, 'plugin', 'workflows', 'sketch.md')), /plugin\/workflows\/: must hold exactly/);
});

test('PLUG-02: a hooks.json command whose bundle is missing fails, naming the bundle', () => {
  withBrokenCopy(
    (root) => rmSync(path.join(root, 'plugin', 'dist', 'hooks', 'stop.mjs'), { force: true }),
    /hooks\.json: Stop hook runs \$\{CLAUDE_PLUGIN_ROOT\}\/dist\/hooks\/stop\.mjs, but dist\/hooks\/stop\.mjs is missing/,
  );
});

test('PLUG-02: a missing MCP server bundle fails for plugin.json and the developer .mcp.json', () => {
  const { root, cleanup } = copyTree();
  try {
    rmSync(path.join(root, 'plugin', 'dist', 'mcp', 'server.mjs'), { force: true });
    const r = validate(root);
    assert.equal(r.status, 1);
    assert.match(r.out, /plugin\.json: mcpServers\.pensmith runs \$\{CLAUDE_PLUGIN_ROOT\}\/dist\/mcp\/server\.mjs, but dist\/mcp\/server\.mjs is missing/);
    assert.match(r.out, /\.mcp\.json: targets plugin\/dist\/mcp\/server\.mjs, which is missing/);
  } finally {
    cleanup();
  }
});

test('PLUG-01: hooks.json must use the exec form with the contract matcher and a timeout', () => {
  withBrokenCopy((root) => {
    editJson(path.join(root, 'plugin', 'hooks', 'hooks.json'), (v) => {
      const hooks = v['hooks'] as Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
      hooks['PostToolUse']![0]!.matcher = 'Write|Edit';
      const h = hooks['SessionStart']![0]!.hooks[0]!;
      h['command'] = 'node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.mjs"';
      delete h['args'];
      delete hooks['Stop']![0]!.hooks[0]!['timeout'];
    });
  }, [
    /PostToolUse matcher must be "mcp__plugin_pensmith_pensmith__\.\*"/,
    /SessionStart hook must use exec form/,
    /Stop hook needs an explicit timeout/,
  ]);
});

test('PLUG-01: a hooks.json with a missing event fails', () => {
  withBrokenCopy((root) => {
    editJson(path.join(root, 'plugin', 'hooks', 'hooks.json'), (v) => {
      delete (v['hooks'] as Record<string, unknown>)['PreCompact'];
    });
  }, /hooks\.json: events must be exactly \["PostToolUse","PreCompact","SessionStart","Stop"\]/);
});

test('PLUG-01: plugin.json with a hooks key, an unknown key or a stale version fails', () => {
  withBrokenCopy((root) => {
    editJson(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), (v) => {
      v['hooks'] = './hooks/hooks.json';
      v['skillz'] = [];
      v['version'] = '0.0.1';
    });
  }, [
    /plugin\.json: no "hooks" key — hooks\/hooks\.json loads by default/,
    /plugin\.json: unknown top-level key "skillz"/,
    /plugin\.json: version "0\.0\.1" must equal package\.json version/,
  ]);
});

test('PLUG-01: the MCP server must be the committed bundle, not the tsc build', () => {
  withBrokenCopy((root) => {
    editJson(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), (v) => {
      (v['mcpServers'] as Record<string, { args: string[] }>)['pensmith']!.args = ['${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js'];
    });
  }, /mcpServers\.pensmith\.args must be \["\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/mcp\/server\.mjs"\]/);
});

test('PLUG-02: the plugin must not ship bin/, CLAUDE.md, node_modules/ or a second .mcp.json', () => {
  withBrokenCopy((root) => {
    mkdirSync(path.join(root, 'plugin', 'bin'));
    writeFileSync(path.join(root, 'plugin', 'CLAUDE.md'), '# no\n');
    mkdirSync(path.join(root, 'plugin', 'node_modules'));
    writeFileSync(path.join(root, 'plugin', '.mcp.json'), '{"mcpServers":{}}\n');
  }, [
    /plugin\/bin\/: a plugin must not ship a bin\/ directory/,
    /plugin\/CLAUDE\.md: never loaded as context/,
    /plugin\/node_modules\/: the plugin runs from self-contained bundles/,
    /plugin\/\.mcp\.json: a second declaration/,
  ]);
});

test('PLUG-01: a flat skill file, a colon name and a missing skill fail', () => {
  withBrokenCopy((root) => {
    writeFileSync(path.join(root, 'plugin', 'skills', 'extra.md'), '---\nname: extra\ndescription: x\n---\n');
    const f = path.join(root, 'plugin', 'skills', 'verify-section', 'SKILL.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('name: verify-section', 'name: pensmith:verify-section'));
    rmSync(path.join(root, 'plugin', 'skills', 'compile'), { recursive: true });
  }, [
    /skills\/extra\.md: a flat skill file loads nothing/,
    /plugin\/skills\/: must hold exactly the skills/,
    /verify-section\/SKILL\.md: frontmatter name must equal its directory "verify-section"/,
  ]);
});

test('PLUG-05: a plumbing skill must be user-invoked only and forward to the pensmith skill', () => {
  withBrokenCopy((root) => {
    const f = path.join(root, 'plugin', 'skills', 'outline', 'SKILL.md');
    writeFileSync(
      f,
      readFileSync(f, 'utf8')
        .replace('disable-model-invocation: true\n', 'when_to_use: "outline the paper"\n')
        .replace(/pensmith:pensmith/g, 'the router'),
    );
  }, [
    /outline\/SKILL\.md: a plumbing skill needs disable-model-invocation: true/,
    /outline\/SKILL\.md: a plumbing skill carries no natural-language triggers/,
    /outline\/SKILL\.md: the body must forward "<verb> \$ARGUMENTS" to the pensmith:pensmith skill/,
  ]);
});

test('PLUG-01: the router skill listing (description + when_to_use) stays within 1,536 characters', () => {
  withBrokenCopy((root) => {
    const f = path.join(root, 'plugin', 'skills', 'pensmith', 'SKILL.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('when_to_use: >-\n', `when_to_use: >-\n  ${'x'.repeat(1600)}\n`));
  }, /pensmith\/SKILL\.md: description \+ when_to_use is \d+ characters; Claude Code truncates the listing at 1536/);
});

test('PLUG-01: the marketplace entry must point at ./plugin', () => {
  withBrokenCopy((root) => {
    editJson(path.join(root, '.claude-plugin', 'marketplace.json'), (v) => {
      (v['plugins'] as Array<Record<string, unknown>>)[0]!['source'] = './';
    });
  }, /marketplace\.json: the pensmith entry's source must be "\.\/plugin", got "\.\/"/);
});

test('PLUG-04: the developer .mcp.json must not use ${CLAUDE_PLUGIN_ROOT}', () => {
  withBrokenCopy((root) => {
    writeFileSync(
      path.join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { pensmith: { type: 'stdio', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js'] } } }),
    );
  }, /\.mcp\.json: uses \$\{CLAUDE_PLUGIN_ROOT\}, which is undefined outside a plugin/);
});

test('PLUG-02: a repo whose plugin/ is missing fails with one clear line', () => {
  withBrokenCopy((root) => rmSync(path.join(root, 'plugin'), { recursive: true }), /plugin\/: missing — the plugin lives in plugin\//);
});

test('the validator refuses an unknown argument (usage, exit 2)', () => {
  const r = spawnSync(process.execPath, [VALIDATOR, '--bogus'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown argument --bogus/);
});
