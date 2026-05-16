#!/usr/bin/env node
// scripts/validate-plugin-manifest.cjs (D-17)
// CI gate enforcing REPO-02 + REPO-03. Asserts:
//   - .claude-plugin/plugin.json shape (name, version, author, mcpServers)
//   - .claude-plugin/marketplace.json shape (name, owner.name, plugins[])
//   - .mcp.json shape (mcpServers.{name}.command required)
//   - If dist/ exists, dist/mcp/server.js MUST exist (Pitfall D + Open Q#3)
//
// Source shape: gsd-plugin's bin/validate-plugin.cjs at /tmp/refs/gsd-plugin
// (verified 2026-05-06), adapted for pensmith's BOTH-manifests requirement.

'use strict';
const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('  -', msg); process.exitCode = 1; }
function loadJson(p) {
  if (!fs.existsSync(p)) { fail(`Missing: ${p}`); return null; }
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (e) { fail(`Parse error in ${p}: ${e.message}`); return null; }
}

const root = path.resolve(__dirname, '..');
const plugin = loadJson(path.join(root, '.claude-plugin/plugin.json'));
const market = loadJson(path.join(root, '.claude-plugin/marketplace.json'));
const mcp    = loadJson(path.join(root, '.mcp.json'));

if (plugin) {
  if (typeof plugin.name !== 'string' || !plugin.name) fail('plugin.name required');
  if (plugin.name && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(plugin.name))
    fail(`plugin.name must be kebab-case: got "${plugin.name}"`);
  if (plugin.version && !/^\d+\.\d+\.\d+/.test(plugin.version))
    fail(`plugin.version must be semver: got "${plugin.version}"`);
  if (plugin.author && typeof plugin.author === 'object') {
    if (typeof plugin.author.name !== 'string' || !plugin.author.name)
      fail('plugin.author.name required when author is an object');
  }
  if (plugin.mcpServers && typeof plugin.mcpServers === 'object') {
    for (const [name, cfg] of Object.entries(plugin.mcpServers)) {
      if (!cfg || typeof cfg !== 'object') fail(`plugin.mcpServers.${name} must be object`);
      else if (!cfg.command) fail(`plugin.mcpServers.${name}.command required`);
    }
  }
}

if (market) {
  if (typeof market.name !== 'string' || !market.name) fail('marketplace.name required');
  if (!market.owner || typeof market.owner.name !== 'string')
    fail('marketplace.owner.name required');
  if (!Array.isArray(market.plugins)) fail('marketplace.plugins must be array');
  else for (const p of market.plugins) {
    if (!p || typeof p !== 'object') { fail('marketplace.plugins[] entry must be object'); continue; }
    if (!p.name) fail('marketplace.plugins[].name required');
    if (!p.source) fail(`marketplace.plugins[${p.name||'?'}].source required`);
  }
}

if (mcp) {
  if (!mcp.mcpServers || typeof mcp.mcpServers !== 'object')
    fail('.mcp.json mcpServers required');
  else for (const [name, cfg] of Object.entries(mcp.mcpServers)) {
    if (!cfg || typeof cfg !== 'object') fail(`.mcp.json mcpServers.${name} must be object`);
    else if (!cfg.command) fail(`.mcp.json mcpServers.${name}.command required`);
  }
}

// Pitfall D: if dist/ exists, dist/mcp/server.js MUST resolve.
// This catches CI flows where `npm run build` was meant to run before us.
const distDir = path.join(root, 'dist');
if (fs.existsSync(distDir)) {
  const built = path.join(distDir, 'mcp', 'server.js');
  if (!fs.existsSync(built)) fail(`dist/ exists but ${built} is missing — run \`npm run build\``);
}

// TIER-03 (Phase 2): 4 hooks + hooks.json manifest declares them.
// TIER-07 (Phase 2): plugin shell + hooks + workflows scaffolding present.
// ARCH-01: workflows are markdown shared by both tiers.
// ARCH-03: every workflow body contains a <capability_check> block.

const REQUIRED_HOOK_EVENTS = ['SessionStart', 'PreCompact', 'PostToolUse', 'Stop'];
// WR-03 (cross-AI review): the canonical 16-verb list lives in bin/lib/verbs.ts;
// scripts/prebuild.mjs writes the JSON sibling bin/lib/verbs.json so this
// CommonJS validator (which runs in `npm run check` before tsc) reads the
// same source of truth. Falls back to the historical inline literal if the
// JSON is missing (fresh clone, prebuild not yet run) so this script remains
// runnable standalone — but `npm run check` always invokes prebuild first.
const VERBS_JSON_PATH = path.join(root, 'bin/lib/verbs.json');
let EXPECTED_WORKFLOWS;
try {
  const verbsRaw = fs.readFileSync(VERBS_JSON_PATH, 'utf8');
  const verbsParsed = JSON.parse(verbsRaw);
  // scripts/prebuild.mjs writes { verbs: [...], generatedFrom: '...' }.
  // Accept both shapes (bare array OR wrapped) to keep this validator
  // resilient if the prebuild output format is tightened later.
  const arr = Array.isArray(verbsParsed) ? verbsParsed : verbsParsed && verbsParsed.verbs;
  if (!Array.isArray(arr) || arr.length !== 16) {
    throw new Error(`bin/lib/verbs.json must contain a 16-element verb array, got ${arr && arr.length}`);
  }
  EXPECTED_WORKFLOWS = arr;
} catch (e) {
  // Fallback: hand-maintained mirror used only when verbs.json absent.
  // If you edit this list, also edit bin/lib/verbs.ts (the real SoT).
  console.error(`  - warn: ${VERBS_JSON_PATH} unreadable (${e.message}); falling back to inline list`);
  EXPECTED_WORKFLOWS = [
    'doctor', 'new', 'next', 'status', 'research', 'outline', 'plan', 'write',
    'verify', 'compile', 'done', 'resume', 'list', 'open', 'sketch', 'add',
  ];
}

const hooksDir = path.join(root, 'hooks');
if (!fs.existsSync(hooksDir)) {
  fail('hooks/ directory missing (TIER-07)');
} else {
  const manifestPath = path.join(hooksDir, 'hooks.json');
  if (!fs.existsSync(manifestPath)) {
    fail('hooks/hooks.json missing (TIER-03)');
  } else {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      fail(`hooks/hooks.json: invalid JSON (${e.message}) (TIER-03)`);
    }
    if (manifest) {
      if (manifest.schemaVersion !== 1) {
        fail(`hooks/hooks.json: schemaVersion must be 1 (TIER-03)`);
      }
      const declaredEvents = (manifest.hooks ?? []).map((h) => h.event).sort();
      const wantedEvents = [...REQUIRED_HOOK_EVENTS].sort();
      if (JSON.stringify(declaredEvents) !== JSON.stringify(wantedEvents)) {
        fail(`hooks/hooks.json: events must equal ${JSON.stringify(wantedEvents)}, got ${JSON.stringify(declaredEvents)} (TIER-03)`);
      }
      for (const h of manifest.hooks ?? []) {
        const sp = path.join(hooksDir, h.script);
        if (!fs.existsSync(sp)) fail(`hooks.json declares ${h.event} → ${h.script} but hooks/${h.script} is missing (TIER-03)`);
      }
    }
  }
}

const workflowsDir = path.join(root, 'workflows');
if (!fs.existsSync(workflowsDir)) {
  fail('workflows/ directory missing (ARCH-01)');
} else {
  const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.md')).sort();
  const expected = [...EXPECTED_WORKFLOWS].map((v) => `${v}.md`).sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    fail(`workflows/ mismatch — expected ${JSON.stringify(expected)}, got ${JSON.stringify(files)}`);
  }
  for (const f of files) {
    const body = fs.readFileSync(path.join(workflowsDir, f), 'utf8');
    if (!/<capability_check>[\s\S]+?<\/capability_check>/.test(body)) {
      fail(`workflows/${f} missing <capability_check> block (ARCH-03)`);
    }
  }
}

if (process.exitCode === 1) {
  console.error('Manifest validation FAILED');
  process.exit(1);
}
console.log('✓ plugin.json + marketplace.json + .mcp.json valid');
