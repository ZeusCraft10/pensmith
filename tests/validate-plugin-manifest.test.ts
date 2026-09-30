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
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginVersion = createRequire(import.meta.url)('../scripts/plugin-version.cjs') as {
  expectedPluginVersion(packageVersion: string, pluginDir: string): string;
  gitTrackedFiles(dir: string): string[] | null;
  pluginContentHash(pluginDir: string): string;
  walkFiles(dir: string): string[];
  writePluginVersion(pluginDir: string, version: string): boolean;
};
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
    /PostToolUse matcher must be "\^mcp__\(\?:plugin_pensmith_\)\?pensmith__\.\*"/,
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
    /plugin\.json: version "0\.0\.1" is not "0\.1\.0-dev\+[0-9a-f]{12}" \(the package\.json version \+ the digest of plugin\/'s files\)/,
  ]);
});

// Review round 2: Claude Code updates a git-marketplace install only when the
// manifest version changes, so the version carries the digest of plugin/.
test('PLUG-03: a change under plugin/ that was not re-stamped fails, naming `npm run plugin:version`', () => {
  withBrokenCopy((root) => {
    const f = path.join(root, 'plugin', 'workflows', 'status.md');
    writeFileSync(f, `${readFileSync(f, 'utf8')}\nA line added after the version was stamped.\n`);
  }, [
    /plugin\.json: version "0\.1\.0-dev\+[0-9a-f]{12}" is not "0\.1\.0-dev\+[0-9a-f]{12}"/,
    /Claude Code updates a git-marketplace install only when this string changes; run `npm run plugin:version`/,
  ]);
});

test('PLUG-03: plugin.json without a version fails (`claude plugin validate --strict` refuses it too)', () => {
  withBrokenCopy((root) => {
    editJson(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), (v) => {
      delete v['version'];
    });
  }, /plugin\.json: version is required \(a string\)/);
});

test('PLUG-03: a re-stamped copy passes again, and the digest ignores CRLF line endings', () => {
  const { root, cleanup } = copyTree();
  try {
    const f = path.join(root, 'plugin', 'workflows', 'status.md');
    writeFileSync(f, `${readFileSync(f, 'utf8')}\nA new line.\n`);
    const pkgVersion = (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
    const stamped = pluginVersion.expectedPluginVersion(pkgVersion, path.join(root, 'plugin'));
    assert.equal(pluginVersion.writePluginVersion(path.join(root, 'plugin'), stamped), true);
    assert.equal(pluginVersion.writePluginVersion(path.join(root, 'plugin'), stamped), false, 'stamping again changes nothing');
    const r = validate(root);
    assert.equal(r.status, 0, r.out);
    // The same content with CRLF line endings (a Windows checkout without eol=lf) has the same digest.
    writeFileSync(f, readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
    assert.equal(pluginVersion.expectedPluginVersion(pkgVersion, path.join(root, 'plugin')), stamped);
    // Only the value changed: the manifest keeps its layout.
    const manifest = readFileSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8');
    assert.match(manifest, new RegExp(`^ {2}"version": "${stamped.replace(/[.+]/g, '\\$&')}",$`, 'm'));
    assert.match(manifest, /"keywords": \[/);
  } finally {
    cleanup();
  }
});

test('PLUG-03 (review round 3): in a git checkout the digest covers the tracked files only — untracked and ignored files never change it', () => {
  const { root, cleanup } = copyTree();
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=pensmith test', '-c', 'user.email=test@example.org', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const plugin = path.join(root, 'plugin');
    const onDisk = pluginVersion.pluginContentHash(plugin);
    assert.equal(pluginVersion.gitTrackedFiles(plugin), null, 'a folder git does not track is walked');
    git('init', '--quiet');
    writeFileSync(path.join(root, '.gitignore'), 'plugin/.claude/\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'the plugin');
    assert.deepEqual(pluginVersion.gitTrackedFiles(plugin), pluginVersion.walkFiles(plugin), 'a clean checkout: the tracked files are the files on disk');
    assert.equal(pluginVersion.pluginContentHash(plugin), onDisk, 'and hash the same');

    // Litter a working tree collects: ignored settings, an editor swap file, a dry-run workspace.
    mkdirSync(path.join(plugin, '.claude'), { recursive: true });
    writeFileSync(path.join(plugin, '.claude', 'settings.local.json'), '{}\n');
    writeFileSync(path.join(plugin, 'skills', 'pensmith', '.SKILL.md.swp'), 'swap\n');
    mkdirSync(path.join(plugin, '.paper-dry-run'), { recursive: true });
    writeFileSync(path.join(plugin, '.paper-dry-run', 'STATE.json'), '{}\n');
    assert.equal(pluginVersion.pluginContentHash(plugin), onDisk, 'untracked and ignored files do not change the stamp');
    assert.equal(validate(root).status, 0, 'so validation passes with the committed stamp');

    // An edit to a tracked file counts (the working tree is read), and a new
    // file counts once it is staged — as it will be in the commit.
    const f = path.join(plugin, 'workflows', 'status.md');
    const original = readFileSync(f, 'utf8');
    writeFileSync(f, `${original}\nAn edit.\n`);
    assert.notEqual(pluginVersion.pluginContentHash(plugin), onDisk);
    writeFileSync(f, original);
    writeFileSync(path.join(plugin, 'workflows', 'NEW.md'), 'new\n');
    assert.equal(pluginVersion.pluginContentHash(plugin), onDisk, 'not yet added: not in the stamp');
    git('add', path.join('plugin', 'workflows', 'NEW.md'));
    const staged = pluginVersion.pluginContentHash(plugin);
    assert.notEqual(staged, onDisk, 'staged: in the stamp');
    // A tracked file deleted from the working tree is gone from the stamp.
    rmSync(path.join(plugin, 'workflows', 'NEW.md'));
    assert.equal(pluginVersion.pluginContentHash(plugin), onDisk);
  } finally {
    cleanup();
  }
});

test('PLUG-01: the MCP server must be the committed bundle, not the tsc build', () => {
  withBrokenCopy((root) => {
    editJson(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), (v) => {
      (v['mcpServers'] as Record<string, { args: string[] }>)['pensmith']!.args = ['${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js'];
    });
  }, /mcpServers\.pensmith\.args must be \["\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/mcp\/server\.mjs"\]/);
});

test('review round 2: both server declarations carry the per-server tool-call timeout (a section verb outlasts a 60 s MCP_TOOL_TIMEOUT)', () => {
  withBrokenCopy((root) => {
    editJson(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), (v) => {
      delete (v['mcpServers'] as Record<string, Record<string, unknown>>)['pensmith']!['timeout'];
    });
    editJson(path.join(root, '.mcp.json'), (v) => {
      (v['mcpServers'] as Record<string, Record<string, unknown>>)['pensmith']!['timeout'] = 60000;
    });
  }, [
    /plugin\.json: mcpServers\.pensmith\.timeout must be 1800000 \(a section verb outlasts a 60 s MCP_TOOL_TIMEOUT\), got undefined/,
    /\.mcp\.json: mcpServers\.pensmith must be \{"type":"stdio","command":"node","args":\["\$\{PWD:-\.\}\/plugin\/dist\/mcp\/server\.mjs"\],"timeout":1800000\}/,
  ]);
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

test('PLUG-03: the marketplace entry must not set a version (plugin.json\'s stamped version is read first)', () => {
  withBrokenCopy((root) => {
    editJson(path.join(root, '.claude-plugin', 'marketplace.json'), (v) => {
      (v['plugins'] as Array<Record<string, unknown>>)[0]!['version'] = '0.1.0-dev';
    });
  }, /marketplace\.json: the pensmith entry must not set "version"/);
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
