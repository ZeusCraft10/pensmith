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

if (process.exitCode === 1) {
  console.error('Manifest validation FAILED');
  process.exit(1);
}
console.log('✓ plugin.json + marketplace.json + .mcp.json valid');
