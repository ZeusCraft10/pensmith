#!/usr/bin/env node
// scripts/validate-plugin-manifest.cjs — the pensmith plugin validator
// (D-17, rewritten for PLUG-01 / PLUG-02 / PLUG-04 / PLUG-05 per D-23a-08).
//
//   node scripts/validate-plugin-manifest.cjs [--root <dir>]
//
// <dir> (default: this checkout) is either a REPO ROOT — it holds the plugin as
// plugin/ plus the marketplace (.claude-plugin/marketplace.json), the
// developer .mcp.json and package.json — or a PLUGIN DIRECTORY (it holds
// .claude-plugin/plugin.json itself; only the plugin checks run). The checks
// enforce the current Claude Code plugin spec and pensmith's contract values
// (23a-PLAN §5), and reject the pre-v1 shapes that stopped the plugin from
// loading at all:
//
//   plugin.json   name/version/metadata; version = package.json version; no
//                 `skills` array of {name,file} objects (only path strings);
//                 no `hooks` key (hooks/hooks.json loads by default — declaring
//                 it again merges it twice); mcpServers.pensmith is exactly
//                 `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.mjs` (stdio); no
//                 unknown top-level key (Claude Code strips it with a warning).
//   plugin dir    no bin/ (claude.ai and Cowork refuse the plugin), no
//                 CLAUDE.md (never loaded; `claude plugin validate` warns), no
//                 node_modules/, no second server declaration in .mcp.json.
//   hooks.json    {description?, hooks:{<Event>:[{matcher?, hooks:[{type:
//                 'command', command, args, timeout}]}]}} with exactly
//                 SessionStart, PreCompact, PostToolUse and Stop, in exec form
//                 (`node` + args) with the contract matchers and timeouts; no
//                 schemaVersion, no top-level array, no `script`, no .ts target;
//                 every ${CLAUDE_PLUGIN_ROOT}/… file exists.
//   skills        exactly the 8 skills, each skills/<name>/SKILL.md with
//                 frontmatter `name` = its directory; no flat skills/*.md;
//                 description + when_to_use ≤ 1,536 characters; `pensmith` is
//                 the one model-invocable skill; the 7 plumbing skills carry
//                 disable-model-invocation: true and an argument-hint.
//   workflows     the 16 verb bodies (bin/lib/verbs.json) in workflows/, each
//                 with its <capability_check> block (ARCH-01 / ARCH-03).
//   marketplace   the pensmith entry's source is "./plugin" (never "./", which
//                 ships bin/ and CLAUDE.md); a `version` there equals package.json.
//   .mcp.json     the developer server `node ${PWD:-.}/plugin/dist/mcp/server.mjs`
//                 (no ${CLAUDE_PLUGIN_ROOT}, undefined outside a plugin), and the
//                 bundle it targets exists (D-23a-07).
//
// Every failure is printed as one line naming the file and the reason; the
// exit code is 1 on any failure. `claude plugin validate --strict` (CI-05,
// scripts/plugin-smoke.mjs) is the authoritative spec check; this script adds
// pensmith's own contract on top and runs without Claude Code installed.

'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const SELF_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// The contract values (23a-PLAN §5 — shared by the three 23a streams).
// ---------------------------------------------------------------------------
const PLUGIN_NAME = 'pensmith';
const MCP_SERVER_ARG = '${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.mjs';
const DEV_MCP_SERVER_ARG = '${PWD:-.}/plugin/dist/mcp/server.mjs';
const HOOKS = {
  SessionStart: { script: 'session-start', matcher: 'startup|resume|compact' },
  PreCompact: { script: 'pre-compact', matcher: null },
  PostToolUse: { script: 'post-tool-use', matcher: 'mcp__plugin_pensmith_pensmith__.*' },
  Stop: { script: 'stop', matcher: null },
};
const HOOK_TIMEOUT_MAX_S = 60;
const ROUTER_SKILL = 'pensmith';
const PLUMBING_SKILLS = ['plan-section', 'write-section', 'verify-section', 'research', 'outline', 'compile', 'done'];
const SKILL_LISTING_CAP = 1536;
const PLUGIN_JSON_KEYS = new Set([
  '$schema', 'name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository',
  'license', 'keywords', 'metadata', 'defaultEnabled', 'dependencies', 'settings', 'userConfig',
  'channels', 'skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers', 'outputStyles',
  'workflows', 'experimental',
]);
const SKILL_FRONTMATTER_KEYS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation',
  'user-invocable', 'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent',
  'background', 'hooks', 'paths', 'shell', 'metadata', 'license', 'compatibility',
]);
const INLINE_VERBS = [
  'doctor', 'new', 'next', 'status', 'research', 'outline', 'plan', 'write',
  'verify', 'compile', 'done', 'resume', 'list', 'open', 'sketch', 'add',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const failures = [];
function fail(msg) {
  failures.push(msg);
}

function parseArgs(argv) {
  let root = SELF_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') {
      const v = argv[i + 1];
      if (!v) {
        console.error('validate-plugin-manifest: --root needs a directory');
        process.exit(2);
      }
      root = path.resolve(v);
      i += 1;
    } else if (a.startsWith('--root=')) {
      root = path.resolve(a.slice('--root='.length));
    } else {
      console.error(`validate-plugin-manifest: unknown argument ${a} (usage: [--root <dir>])`);
      process.exit(2);
    }
  }
  return root;
}

function rel(p, base) {
  return path.relative(base, p).split(path.sep).join('/') || '.';
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function loadJson(p, label) {
  if (!isFile(p)) {
    fail(`${label}: missing`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`${label}: not valid JSON (${e.message})`);
    return null;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The ${CLAUDE_PLUGIN_ROOT}/… files a string names, resolved under the plugin dir. */
function pluginRootRefs(s, pluginDir) {
  const out = [];
  const re = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"'`]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ ref: m[0], file: path.join(pluginDir, ...m[1].split('/')) });
  return out;
}

function readVerbs() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(SELF_ROOT, 'bin', 'lib', 'verbs.json'), 'utf8'));
    const arr = Array.isArray(parsed) ? parsed : parsed && parsed.verbs;
    if (Array.isArray(arr) && arr.length === 16) return arr;
    throw new Error(`expected 16 verbs, got ${arr && arr.length}`);
  } catch (e) {
    // bin/lib/verbs.json is written by `npm run prebuild` from bin/lib/verbs.ts
    // (WR-03); this mirror keeps the script usable on a fresh clone.
    console.error(`  - warn: bin/lib/verbs.json unreadable (${e.message}); using the inline 16-verb list`);
    return INLINE_VERBS;
  }
}

// ---------------------------------------------------------------------------
// plugin/.claude-plugin/plugin.json
// ---------------------------------------------------------------------------
function checkPluginJson(pluginDir, label, expectedVersion) {
  const manifest = loadJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'), `${label}/.claude-plugin/plugin.json`);
  if (!manifest) return;
  const where = `${label}/.claude-plugin/plugin.json`;
  if (!isPlainObject(manifest)) {
    fail(`${where}: must be a JSON object`);
    return;
  }
  for (const k of Object.keys(manifest)) {
    if (!PLUGIN_JSON_KEYS.has(k)) fail(`${where}: unknown top-level key "${k}" (Claude Code strips it; --strict fails)`);
  }
  if (manifest.name !== PLUGIN_NAME) fail(`${where}: name must be "${PLUGIN_NAME}", got ${JSON.stringify(manifest.name)}`);
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    fail(`${where}: version is required (a string)`);
  } else if (expectedVersion !== null && manifest.version !== expectedVersion) {
    fail(`${where}: version ${JSON.stringify(manifest.version)} must equal package.json version ${JSON.stringify(expectedVersion)}`);
  }
  for (const k of ['description', 'license', 'repository', 'homepage']) {
    if (typeof manifest[k] !== 'string' || manifest[k] === '') fail(`${where}: ${k} is required (a string)`);
  }
  if (typeof manifest.homepage === 'string') {
    try {
      new URL(manifest.homepage);
    } catch {
      fail(`${where}: homepage must parse as a URL (Claude Code refuses to load the plugin otherwise)`);
    }
  }
  if (!isPlainObject(manifest.author) || typeof manifest.author.name !== 'string' || manifest.author.name === '') {
    fail(`${where}: author must be an object with a name`);
  }

  if ('skills' in manifest) {
    const v = manifest.skills;
    const paths = typeof v === 'string' ? [v] : Array.isArray(v) ? v : null;
    if (paths === null || paths.some((p) => typeof p !== 'string')) {
      fail(
        `${where}: "skills" must be a path string or an array of path strings — an array of {name, file} objects is the pre-v1 shape ` +
          `Claude Code rejects ("skills: Invalid input"); drop the key and let the default skills/ scan load skills/<name>/SKILL.md`,
      );
    } else {
      for (const p of paths) {
        if (!(p === '.' || p.startsWith('./'))) fail(`${where}: skills path ${JSON.stringify(p)} must start with ./`);
        else if (!isDir(path.join(pluginDir, p))) fail(`${where}: skills path ${JSON.stringify(p)} is not a directory`);
      }
    }
  }
  if ('hooks' in manifest) {
    fail(`${where}: no "hooks" key — hooks/hooks.json loads by default, and declaring it again merges every hook twice (D-23a-05)`);
  }
  if (!isPlainObject(manifest.mcpServers)) {
    fail(`${where}: mcpServers must declare the pensmith server inline (D-23a-05)`);
    return;
  }
  const names = Object.keys(manifest.mcpServers);
  if (names.length !== 1 || names[0] !== PLUGIN_NAME) {
    fail(`${where}: mcpServers must hold exactly the "${PLUGIN_NAME}" server, got ${JSON.stringify(names)}`);
  }
  const srv = manifest.mcpServers[PLUGIN_NAME];
  if (!isPlainObject(srv)) return;
  if (srv.type !== 'stdio') fail(`${where}: mcpServers.${PLUGIN_NAME}.type must be "stdio"`);
  if (srv.command !== 'node') fail(`${where}: mcpServers.${PLUGIN_NAME}.command must be "node"`);
  if (!Array.isArray(srv.args) || srv.args.length !== 1 || srv.args[0] !== MCP_SERVER_ARG) {
    fail(`${where}: mcpServers.${PLUGIN_NAME}.args must be ["${MCP_SERVER_ARG}"] (the committed bundle), got ${JSON.stringify(srv.args)}`);
  }
  for (const s of Array.isArray(srv.args) ? srv.args : []) {
    if (typeof s !== 'string') continue;
    for (const { ref, file } of pluginRootRefs(s, pluginDir)) {
      if (!isFile(file)) fail(`${where}: mcpServers.${PLUGIN_NAME} runs ${ref}, but ${rel(file, pluginDir)} is missing from ${label}/ (run \`npm run bundle\`)`);
    }
  }
}

// ---------------------------------------------------------------------------
// The plugin directory's contents
// ---------------------------------------------------------------------------
function checkPluginDirContents(pluginDir, label) {
  if (isDir(path.join(pluginDir, 'bin'))) {
    fail(`${label}/bin/: a plugin must not ship a bin/ directory (claude.ai and Cowork refuse to install it); the CLI stays at the repo root`);
  }
  if (fs.existsSync(path.join(pluginDir, 'CLAUDE.md'))) {
    fail(`${label}/CLAUDE.md: never loaded as context and \`claude plugin validate\` warns; keep it out of the plugin`);
  }
  if (fs.existsSync(path.join(pluginDir, 'node_modules'))) {
    fail(`${label}/node_modules/: the plugin runs from self-contained bundles in dist/ and must not ship node_modules`);
  }
  if (fs.existsSync(path.join(pluginDir, '.mcp.json'))) {
    fail(`${label}/.mcp.json: a second declaration of the MCP server — plugin.json declares it inline (D-23a-05)`);
  }
}

// ---------------------------------------------------------------------------
// plugin/hooks/hooks.json
// ---------------------------------------------------------------------------
function checkHooks(pluginDir, label) {
  const where = `${label}/hooks/hooks.json`;
  const manifest = loadJson(path.join(pluginDir, 'hooks', 'hooks.json'), where);
  if (manifest === null) return;
  if (Array.isArray(manifest)) {
    fail(`${where}: must be an object {"hooks": {<Event>: [...]}} — a top-level array is not the Claude Code hooks shape`);
    return;
  }
  if (!isPlainObject(manifest)) {
    fail(`${where}: must be a JSON object`);
    return;
  }
  if ('schemaVersion' in manifest) {
    fail(`${where}: "schemaVersion" is the pre-v1 homemade shape; Claude Code's hooks.json is {"hooks": {<Event>: [...]}}`);
  }
  for (const k of Object.keys(manifest)) {
    if (k !== 'hooks' && k !== 'description' && k !== 'schemaVersion') fail(`${where}: unknown top-level key "${k}"`);
  }
  if ('description' in manifest && typeof manifest.description !== 'string') fail(`${where}: description must be a string`);
  const hooks = manifest.hooks;
  if (Array.isArray(hooks)) {
    fail(
      `${where}: "hooks" is an array of {event, script} entries — the pre-v1 shape that stops the whole plugin from loading; ` +
        'use {"hooks": {"SessionStart": [{"matcher": …, "hooks": [{"type": "command", …}]}], …}}',
    );
    for (const h of hooks) {
      if (isPlainObject(h) && typeof h.script === 'string') {
        fail(`${where}: "script": ${JSON.stringify(h.script)} is not a hook field — a command hook names "command" (+ "args")`);
        if (/\.ts$/.test(h.script)) fail(`${where}: ${JSON.stringify(h.script)} is a TypeScript source; a hook runs a built .mjs bundle with node`);
      }
    }
    return;
  }
  if (!isPlainObject(hooks)) {
    fail(`${where}: "hooks" must be an object keyed by event name`);
    return;
  }
  const events = Object.keys(hooks).sort();
  const wanted = Object.keys(HOOKS).sort();
  if (JSON.stringify(events) !== JSON.stringify(wanted)) {
    fail(`${where}: events must be exactly ${JSON.stringify(wanted)}, got ${JSON.stringify(events)}`);
  }
  for (const [event, groups] of Object.entries(hooks)) {
    const spec = HOOKS[event];
    if (!Array.isArray(groups) || groups.length !== 1) {
      fail(`${where}: ${event} must be an array holding one matcher group`);
      continue;
    }
    const group = groups[0];
    if (!isPlainObject(group)) {
      fail(`${where}: ${event}[0] must be an object`);
      continue;
    }
    for (const k of Object.keys(group)) {
      if (k !== 'matcher' && k !== 'hooks') fail(`${where}: ${event}[0] has unknown key "${k}"`);
    }
    if (spec) {
      if (spec.matcher === null && 'matcher' in group) fail(`${where}: ${event} takes no matcher (it fires for every ${event})`);
      if (spec.matcher !== null && group.matcher !== spec.matcher) {
        fail(`${where}: ${event} matcher must be ${JSON.stringify(spec.matcher)}, got ${JSON.stringify(group.matcher)}`);
      }
    }
    if (!Array.isArray(group.hooks) || group.hooks.length !== 1) {
      fail(`${where}: ${event}[0].hooks must hold exactly one command hook`);
      continue;
    }
    const h = group.hooks[0];
    if (!isPlainObject(h)) {
      fail(`${where}: ${event}[0].hooks[0] must be an object`);
      continue;
    }
    for (const k of Object.keys(h)) {
      if (!['type', 'command', 'args', 'timeout', 'statusMessage'].includes(k)) {
        fail(`${where}: ${event} hook has unknown key "${k}"${k === 'script' ? ' ("script" is the pre-v1 shape; use "command" + "args")' : ''}`);
      }
    }
    if (h.type !== 'command') fail(`${where}: ${event} hook type must be "command"`);
    if (h.command !== 'node' || !Array.isArray(h.args)) {
      fail(`${where}: ${event} hook must use exec form — "command": "node" with "args" (no shell, safe on Windows; D-23a-06)`);
    }
    const target = spec ? `\${CLAUDE_PLUGIN_ROOT}/dist/hooks/${spec.script}.mjs` : null;
    if (target !== null && (!Array.isArray(h.args) || h.args.length !== 1 || h.args[0] !== target)) {
      fail(`${where}: ${event} hook args must be ["${target}"], got ${JSON.stringify(h.args)}`);
    }
    if (!Number.isInteger(h.timeout) || h.timeout < 1 || h.timeout > HOOK_TIMEOUT_MAX_S) {
      fail(`${where}: ${event} hook needs an explicit timeout in seconds (1–${HOOK_TIMEOUT_MAX_S}), got ${JSON.stringify(h.timeout)}`);
    }
    const strings = [h.command, ...(Array.isArray(h.args) ? h.args : [])].filter((s) => typeof s === 'string');
    for (const s of strings) {
      if (/\.ts(?:["'\s]|$)/.test(s)) fail(`${where}: ${event} hook runs ${JSON.stringify(s)}, a TypeScript source; hooks run the built .mjs bundles`);
      for (const { ref, file } of pluginRootRefs(s, pluginDir)) {
        if (!isFile(file)) fail(`${where}: ${event} hook runs ${ref}, but ${rel(file, pluginDir)} is missing from ${label}/ (run \`npm run bundle\`)`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// plugin/skills/<name>/SKILL.md
// ---------------------------------------------------------------------------
function readFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return { error: 'no YAML frontmatter (the file must start with ---)' };
  try {
    const fm = YAML.parse(m[1]);
    if (!isPlainObject(fm)) return { error: 'frontmatter is not a YAML mapping' };
    return { fm, body: text.slice(m[0].length) };
  } catch (e) {
    return { error: `frontmatter does not parse (${e.message.split('\n')[0]})` };
  }
}

function checkSkills(pluginDir, label) {
  const skillsDir = path.join(pluginDir, 'skills');
  if (!isDir(skillsDir)) {
    fail(`${label}/skills/: missing (the default skills/ scan loads <name>/SKILL.md)`);
    return;
  }
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) {
      fail(`${label}/skills/${e.name}: a flat skill file loads nothing — a skill is skills/<name>/SKILL.md`);
    }
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const wanted = [ROUTER_SKILL, ...PLUMBING_SKILLS].sort();
  if (JSON.stringify(dirs) !== JSON.stringify(wanted)) {
    fail(`${label}/skills/: must hold exactly the skills ${JSON.stringify(wanted)}, got ${JSON.stringify(dirs)}`);
  }
  for (const name of dirs) {
    const file = path.join(skillsDir, name, 'SKILL.md');
    const where = `${label}/skills/${name}/SKILL.md`;
    if (!isFile(file)) {
      fail(`${where}: missing`);
      continue;
    }
    const { fm, body, error } = readFrontmatter(file);
    if (error) {
      fail(`${where}: ${error}`);
      continue;
    }
    for (const k of Object.keys(fm)) {
      if (!SKILL_FRONTMATTER_KEYS.has(k)) fail(`${where}: unknown frontmatter field "${k}" (Claude Code ignores it silently)`);
    }
    if (fm.name !== name) {
      fail(`${where}: frontmatter name must equal its directory "${name}", got ${JSON.stringify(fm.name)} (the plugin namespace adds "pensmith:" itself)`);
    }
    if (typeof fm.description !== 'string' || fm.description.trim() === '') fail(`${where}: description is required`);
    const listing = [fm.description, fm.when_to_use].filter((s) => typeof s === 'string').join(' ');
    if (listing.length > SKILL_LISTING_CAP) {
      fail(`${where}: description + when_to_use is ${listing.length} characters; Claude Code truncates the listing at ${SKILL_LISTING_CAP}`);
    }
    if (typeof fm['argument-hint'] !== 'string' || fm['argument-hint'] === '') fail(`${where}: argument-hint is required`);
    if (name === ROUTER_SKILL) {
      if (fm['disable-model-invocation'] === true) fail(`${where}: the router skill must stay model-invocable (it is the one natural-language entry point)`);
      if (typeof fm.when_to_use !== 'string' || fm.when_to_use === '') fail(`${where}: when_to_use carries the PRD §5.4/§5.6 phrases and is required`);
    } else if (PLUMBING_SKILLS.includes(name)) {
      if (fm['disable-model-invocation'] !== true) {
        fail(`${where}: a plumbing skill needs disable-model-invocation: true (user-invoked only; it must not compete with the pensmith skill)`);
      }
      if ('when_to_use' in fm) fail(`${where}: a plumbing skill carries no natural-language triggers (when_to_use) — the pensmith skill routes`);
      if (!/\$ARGUMENTS/.test(body) || !/pensmith:pensmith/.test(body)) {
        fail(`${where}: the body must forward "<verb> $ARGUMENTS" to the pensmith:pensmith skill`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// plugin/workflows/<verb>.md
// ---------------------------------------------------------------------------
function checkWorkflows(pluginDir, label) {
  const dir = path.join(pluginDir, 'workflows');
  if (!isDir(dir)) {
    fail(`${label}/workflows/: missing (the 16 verb bodies, ARCH-01)`);
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const expected = readVerbs().map((v) => `${v}.md`).sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    fail(`${label}/workflows/: must hold exactly ${JSON.stringify(expected)}, got ${JSON.stringify(files)}`);
  }
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/<capability_check>[\s\S]+?<\/capability_check>/.test(text)) {
      fail(`${label}/workflows/${f}: missing its <capability_check> block (ARCH-03)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Repo root: marketplace, developer .mcp.json, no root-level plugin manifest
// ---------------------------------------------------------------------------
function checkMarketplace(root, expectedVersion) {
  const where = '.claude-plugin/marketplace.json';
  const market = loadJson(path.join(root, '.claude-plugin', 'marketplace.json'), where);
  if (!market) return;
  if (typeof market.name !== 'string' || market.name === '') fail(`${where}: name is required`);
  if (!isPlainObject(market.owner) || typeof market.owner.name !== 'string' || market.owner.name === '') fail(`${where}: owner.name is required`);
  if (!Array.isArray(market.plugins)) {
    fail(`${where}: plugins must be an array`);
    return;
  }
  const entry = market.plugins.find((p) => isPlainObject(p) && p.name === PLUGIN_NAME);
  if (!entry) {
    fail(`${where}: no "${PLUGIN_NAME}" plugin entry`);
    return;
  }
  if (entry.source !== './plugin') {
    fail(`${where}: the ${PLUGIN_NAME} entry's source must be "./plugin", got ${JSON.stringify(entry.source)} ("./" ships bin/ and CLAUDE.md)`);
  }
  if ('version' in entry && entry.version !== expectedVersion) {
    fail(`${where}: the ${PLUGIN_NAME} entry's version ${JSON.stringify(entry.version)} must equal package.json ${JSON.stringify(expectedVersion)} (or be dropped)`);
  }
}

function checkDevMcpJson(root) {
  const where = '.mcp.json';
  const p = path.join(root, '.mcp.json');
  if (!isFile(p)) {
    fail(`${where}: missing (the developer server, PLUG-04)`);
    return;
  }
  const raw = fs.readFileSync(p, 'utf8');
  if (raw.includes('${CLAUDE_PLUGIN_ROOT}')) {
    fail(`${where}: uses \${CLAUDE_PLUGIN_ROOT}, which is undefined outside a plugin — every developer session gets CONNECTION_CLOSED`);
  }
  let mcp;
  try {
    mcp = JSON.parse(raw);
  } catch (e) {
    fail(`${where}: not valid JSON (${e.message})`);
    return;
  }
  const srv = isPlainObject(mcp) && isPlainObject(mcp.mcpServers) ? mcp.mcpServers[PLUGIN_NAME] : null;
  if (!isPlainObject(srv)) {
    fail(`${where}: mcpServers.${PLUGIN_NAME} is required`);
    return;
  }
  if (srv.type !== 'stdio' || srv.command !== 'node' || !Array.isArray(srv.args) || srv.args.length !== 1 || srv.args[0] !== DEV_MCP_SERVER_ARG) {
    fail(`${where}: mcpServers.${PLUGIN_NAME} must be {"type":"stdio","command":"node","args":["${DEV_MCP_SERVER_ARG}"]} (D-23a-07), got ${JSON.stringify(srv)}`);
  }
  if (!isFile(path.join(root, 'plugin', 'dist', 'mcp', 'server.mjs'))) {
    fail(`${where}: targets plugin/dist/mcp/server.mjs, which is missing (run \`npm run bundle\`)`);
  }
}

function packageVersion(root) {
  const pkg = loadJson(path.join(root, 'package.json'), 'package.json');
  if (!pkg) return null;
  if (typeof pkg.version !== 'string') {
    fail('package.json: version is required');
    return null;
  }
  return pkg.version;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const root = parseArgs(process.argv.slice(2));
const pluginMode = isFile(path.join(root, '.claude-plugin', 'plugin.json'));
let summary;

if (pluginMode) {
  // A plugin directory on its own (or the pre-v1 repo-as-plugin layout).
  const label = rel(root, process.cwd());
  checkPluginJson(root, label, null);
  checkPluginDirContents(root, label);
  checkHooks(root, label);
  checkSkills(root, label);
  checkWorkflows(root, label);
  summary = `${label}: plugin.json, hooks.json, 8 skills and 16 workflow bodies valid`;
} else {
  const pluginDir = path.join(root, 'plugin');
  if (!isDir(pluginDir)) {
    fail(`plugin/: missing — the plugin lives in plugin/ (PLUG-02), with .claude-plugin/plugin.json inside it`);
  } else {
    const version = packageVersion(root);
    checkPluginJson(pluginDir, 'plugin', version);
    checkPluginDirContents(pluginDir, 'plugin');
    checkHooks(pluginDir, 'plugin');
    checkSkills(pluginDir, 'plugin');
    checkWorkflows(pluginDir, 'plugin');
    checkMarketplace(root, version);
    checkDevMcpJson(root);
  }
  summary = 'plugin/ (plugin.json, hooks.json, 8 skills, 16 workflow bodies) + marketplace.json + .mcp.json valid';
}

if (failures.length > 0) {
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`Manifest validation FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log(`✓ ${summary}`);
