#!/usr/bin/env node
// scripts/plugin-session-check.mjs — live headless Claude Code sessions with
// the real plugin: the local evidence for PLUG-03, PLUG-04, PLUG-05 and
// PLUG-14 (D-23a-19). LOCAL ONLY, never CI: it needs a Claude login (the local
// `claude` login, CLAUDE_CODE_OAUTH_TOKEN, or ANTHROPIC_API_KEY for Claude
// Code itself — pensmith needs no key) and it spends a few cents of model
// usage. It prints `evidence` lines for 23a-VERIFICATION.md.
//
// Session safety (D-23a-19). Every session runs in a fresh `git clone --local`
// of the repository in a temp folder (never a checkout), with:
//   - an isolated CLAUDE_CONFIG_DIR and HOME (the login, when it is a
//     credentials file, is copied in; nothing is written to the real config);
//   - an allow-listed environment (PATH, locale, temp, proxy/CA, the Claude
//     auth variables) — never the parent session's messaging socket, session
//     id or remote-session variables, so a child session cannot reach the
//     session that started it;
//   - stdin closed, `--max-turns` ≤ 3, `--tools` limited to what the check
//     needs, an explicit `--allowedTools`, and `--disallowedTools` naming
//     SendUserFile and the other remote-session tools;
//   - never a permission-bypass flag.
//
// Checks:
//   PLUG-03  the init frame lists `pensmith:pensmith` and the 7 plumbing
//            skills and a connected `plugin:pensmith:pensmith` server with its
//            tools; the debug log says `Loaded 8 skills`; in a CLI-made paper
//            (`new`, then `outline` over a hand-written three-section
//            OUTLINE.md — no model call, no network) `/pensmith status` calls
//            pensmith_status, whose text equals the CLI's `status` stdout, and
//            the reply names its next step and every section line.
//   PLUG-04  in the clone's root, with project MCP servers approved, `claude
//            mcp list` shows the developer .mcp.json server connected with no
//            missing-variable warning and no build; with `--plugin-dir
//            ./plugin` a session registers exactly one pensmith server.
//   PLUG-05  `/pensmith:verify-section 1` reaches pensmith_verify.
//   PLUG-14  the PreCompact bundle writes HANDOFF v2 at the router's position
//            (phase sectioning, section 1, position plan); SessionStart runs
//            with exit 0 and its additionalContext reaches
//            the model (it quotes the resume step); a headless `/compact` of
//            the previous session writes HANDOFF.json through PreCompact; the
//            MCP server sees CLAUDE_CODE_SESSION_ID equal to the session id
//            the Stop hook gets on stdin (the D-17-37 owner match), checked
//            with a probe copy of the plugin.
//
// Usage: node scripts/plugin-session-check.mjs [--repo <dir>] [--cli <pensmith.js>]
//        [--model <id>] [--only <check,…>] [--keep]
//   --repo   the repository to clone (default: this checkout; a scratch plugin
//            assembly before a merge)
//   --cli    the pensmith CLI that makes the paper (default: this checkout's
//            dist/bin/pensmith.js — run `npm run build` first)
//   --only   a comma list of plug03,plug04,plug05,plug14,session-id
// Claude Code: CLAUDE_BIN, else `claude` on PATH. Exit 1 when a check fails.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_SKILLS,
  PLUGIN_SERVER,
  parseMcpList,
  resolveClaude,
  runClaude,
} from './plugin-smoke-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = (name) => `mcp__plugin_pensmith_pensmith__${name}`;
/** Tools a child session must never have (remote-session and file-sending tools). */
const DISALLOWED = [
  'SendUserFile', 'PushNotification', 'SendMessage', 'ListAgents', 'Artifact', 'ArtifactComments', 'ArtifactData',
  'RemoteTrigger', 'CronCreate', 'CronDelete', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent',
].join(',');
const CHECKS = ['plug03', 'plug04', 'plug05', 'plug14', 'session-id'];

function parseArgs(argv) {
  const opts = { repo: REPO_ROOT, cli: path.join(REPO_ROOT, 'dist', 'bin', 'pensmith.js'), model: null, only: new Set(CHECKS), keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--repo') opts.repo = path.resolve(value());
    else if (a === '--cli') opts.cli = path.resolve(value());
    else if (a === '--model') opts.model = value();
    else if (a === '--only') opts.only = new Set(value().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--keep') opts.keep = true;
    else throw new Error(`unknown option ${a}`);
  }
  for (const c of opts.only) if (!CHECKS.includes(c)) throw new Error(`unknown check ${c} (${CHECKS.join(', ')})`);
  return opts;
}

let failures = 0;
function evidence(check, ok, line) {
  if (!ok) failures += 1;
  process.stdout.write(`evidence ${ok ? 'PASS' : 'FAIL'} [${check}] ${line}\n`);
}
function note(line) {
  process.stdout.write(`note     ${line}\n`);
}

// ---------------------------------------------------------------------------
// The child-session environment (allow-listed) and its isolated config.
// ---------------------------------------------------------------------------

const PASS_THROUGH = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|LANG|LC_ALL|LC_CTYPE|TERM|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|NO_PROXY|ALL_PROXY|ANTHROPIC_BASE_URL|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|AWS_[A-Z_]+|GOOGLE_[A-Z_]+|CLOUD_ML_REGION|ANTHROPIC_VERTEX_PROJECT_ID)$/i;

function sessionEnv(tmp) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && PASS_THROUGH.test(k)) env[k] = v;
  const config = path.join(tmp, 'claude-config');
  const home = path.join(tmp, 'home');
  const data = path.join(tmp, 'pensmith-data');
  for (const d of [config, home, data]) mkdirSync(d, { recursive: true });
  // The login: a credentials file in the user's config dir is copied in (never printed).
  const realConfig = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const creds = path.join(realConfig, '.credentials.json');
  if (existsSync(creds)) copyFileSync(creds, path.join(config, '.credentials.json'));
  const auth = env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY'
    : env.CLAUDE_CODE_OAUTH_TOKEN ? 'CLAUDE_CODE_OAUTH_TOKEN'
      : existsSync(creds) ? 'the local claude login (credentials file copied into the isolated config)'
        : env.ANTHROPIC_BASE_URL ? 'ANTHROPIC_BASE_URL (a host-managed gateway)'
          : 'none found — set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) if your login lives in the keychain';
  // Project MCP servers approved (PLUG-04: "with project MCP servers approved").
  writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ enableAllProjectMcpServers: true }, null, 2) + '\n');
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: config,
    HOME: home,
    USERPROFILE: home,
    XDG_DATA_HOME: data,
    LOCALAPPDATA: data,
    DISABLE_AUTOUPDATER: '1',
    PENSMITH_CONTACT_EMAIL: 'pensmith-dev@example.org',
  });
  return { env, auth };
}

// ---------------------------------------------------------------------------
// Headless sessions.
// ---------------------------------------------------------------------------

/** Parse a stream-json transcript into the frames the checks read. */
function readTranscript(stdout) {
  const t = { init: null, hooks: [], toolUses: [], toolResults: [], texts: [], result: null };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.type === 'system' && m.subtype === 'init') t.init = m;
    else if (m.type === 'system' && m.subtype === 'hook_response') t.hooks.push(m);
    else if (m.type === 'assistant') {
      for (const c of m.message?.content ?? []) {
        if (c.type === 'text') t.texts.push(c.text);
        if (c.type === 'tool_use') t.toolUses.push({ name: c.name, input: c.input });
      }
    } else if (m.type === 'user') {
      for (const c of m.message?.content ?? []) {
        if (c.type === 'tool_result') {
          const text = Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join('') : String(c.content ?? '');
          t.toolResults.push({ id: c.tool_use_id, text, isError: c.is_error === true });
        }
      }
    } else if (m.type === 'result') t.result = m;
  }
  return t;
}

function headless(ctx, name, { cwd, prompt, pluginDir, tools = '', allowed = [], maxTurns = 1, resume = null }) {
  if (maxTurns > 3) throw new Error('max-turns is capped at 3 (D-23a-19)');
  const debug = path.join(ctx.tmp, `${name}.debug.log`);
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    '--max-turns', String(maxTurns),
    '--tools', tools,
    '--disallowedTools', DISALLOWED,
    '--permission-mode', 'default',
    '--debug-file', debug,
  ];
  if (allowed.length > 0) args.push('--allowedTools', allowed.join(','));
  if (pluginDir) args.push('--plugin-dir', pluginDir);
  if (resume) args.push('--resume', resume);
  if (ctx.model) args.push('--model', ctx.model);
  const r = runClaude(ctx.claude, args, { cwd, env: { ...ctx.env, PWD: cwd }, timeoutMs: 300_000 });
  writeFileSync(path.join(ctx.tmp, `${name}.stream.jsonl`), r.stdout);
  const transcript = readTranscript(r.stdout);
  const log = existsSync(debug) ? readFileSync(debug, 'utf8') : '';
  if (transcript.result) ctx.cost += Number(transcript.result.total_cost_usd ?? 0);
  return { ...r, transcript, log, debug };
}

/**
 * The three sections of the hand-written outline makePaper applies. `pensmith
 * outline` without --force registers a hand-edited OUTLINE.md with no model
 * call (D-18-38), so the paper gets real section lines with no network and no
 * key.
 */
const PAPER_SECTIONS = [
  { slug: 'introduction', title: 'Introduction', role: 'intro', dependsOn: '', words: 400 },
  { slug: 'mechanisms', title: 'Attention Mechanisms', role: 'body', dependsOn: 'introduction', words: 700 },
  { slug: 'conclusion', title: 'Conclusion', role: 'conclusion', dependsOn: 'mechanisms', words: 400 },
];

/** A paper made by the built CLI: `new`, then `outline` over a hand-written OUTLINE.md. */
function makePaper(ctx, name) {
  const dir = path.join(ctx.tmp, name);
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'assignment.txt'), path.join(dir, 'assignment.txt'));
  const env = { ...ctx.env, PENSMITH_NO_LLM: '1' };
  const cli = (args) => spawnSync(process.execPath, [ctx.cli, ...args], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const made = cli(['new', '@assignment.txt', '--yolo']);
  if (made.status !== 0 || !existsSync(path.join(dir, '.paper'))) throw new Error(`pensmith new failed in ${dir}:\n${made.stderr}`);
  writeFileSync(path.join(dir, '.paper', 'OUTLINE.md'), [
    '# Outline',
    '',
    '| # | slug | title | role | depends_on | word target | assigned_sources | voice |',
    '|---|---|---|---|---|---|---|---|',
    ...PAPER_SECTIONS.map((sec, i) => `| ${i + 1} | ${sec.slug} | ${sec.title} | ${sec.role} | ${sec.dependsOn} | ${sec.words} | | |`),
    '',
  ].join('\n'));
  const outlined = cli(['outline', '--yolo']);
  if (outlined.status !== 0) throw new Error(`pensmith outline failed in ${dir}:\n${outlined.stderr}`);
  const status = cli(['status']);
  if (status.status !== 0) throw new Error(`pensmith status failed in ${dir}:\n${status.stderr}`);
  return { dir, status: status.stdout };
}

/** The `next:` step and the section lines of `pensmith status` output. */
function statusSummary(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const next = (lines.find((l) => l.startsWith('next:')) ?? '').replace(/^next:\s*/, '');
  const start = lines.indexOf('sections:');
  const sections = [];
  for (let i = start + 1; start >= 0 && i < lines.length; i += 1) {
    const m = /^\[.\]\s+#(\S+)\s+([^:]+):/.exec(lines[i] ?? '');
    if (!m) break;
    sections.push({ id: m[1], slug: m[2].trim() });
  }
  return { next, sections };
}

// ---------------------------------------------------------------------------
// The checks.
// ---------------------------------------------------------------------------

function plug03(ctx) {
  const empty = path.join(ctx.tmp, 'empty-project');
  mkdirSync(empty, { recursive: true });
  const s = headless(ctx, 'plug03-init', { cwd: empty, prompt: 'Reply with the word ready.', pluginDir: ctx.pluginDir });
  const init = s.transcript.init;
  const skills = (init?.skills ?? []).filter((k) => k.startsWith('pensmith:')).sort();
  const want = EXPECTED_SKILLS.map((k) => `pensmith:${k}`).sort();
  evidence('PLUG-03', JSON.stringify(skills) === JSON.stringify(want), `init frame skills: ${skills.join(', ') || '(none)'}`);
  const server = (init?.mcp_servers ?? []).find((m) => m.name === PLUGIN_SERVER);
  evidence('PLUG-03', server?.status === 'connected', `init frame MCP server ${PLUGIN_SERVER}: ${server ? `${server.status} (source ${server.source ?? '?'})` : 'absent'}`);
  const tools = (init?.tools ?? []).filter((t) => t.startsWith(TOOL(''))).map((t) => t.slice(TOOL('').length)).sort();
  evidence('PLUG-03', tools.includes('pensmith_status') && tools.includes('pensmith_verify'), `init frame tools of the server: ${tools.join(', ')}`);
  const loaded = /Loaded (\d+) skills from plugin pensmith/.exec(s.log);
  evidence('PLUG-03', loaded?.[1] === String(EXPECTED_SKILLS.length), `debug log: ${loaded ? loaded[0] : 'no "Loaded N skills from plugin pensmith" line'}`);
  if (init) note(`init frame messaging_socket_path: ${JSON.stringify(init.messaging_socket_path ?? null)} (the session's own; the parent's messaging variables are not passed)`);

  const paper = makePaper(ctx, 'paper-status');
  const st = headless(ctx, 'plug03-status', {
    cwd: paper.dir,
    prompt: '/pensmith status',
    pluginDir: ctx.pluginDir,
    allowed: [TOOL('pensmith_status')],
    maxTurns: 3,
  });
  const called = st.transcript.toolUses.some((u) => u.name === TOOL('pensmith_status'));
  evidence('PLUG-03', called, `/pensmith status → tool calls: ${st.transcript.toolUses.map((u) => u.name).join(', ') || '(none)'}`);
  const toolText = st.transcript.toolResults.map((r) => r.text).join('\n');
  const summary = statusSummary(paper.status);
  evidence('PLUG-03', toolText.trim() === paper.status.trim(),
    `pensmith_status text equals \`pensmith status\` stdout (${paper.status.trim().split('\n').length} lines; next: ${summary.next}; sections: ${summary.sections.map((x) => `#${x.id} ${x.slug}`).join(', ')})`);
  const reply = st.transcript.result?.result ?? st.transcript.texts.join('\n');
  const verb = summary.next.split(' ')[0] ?? '';
  const target = /#(\S+)/.exec(summary.next)?.[1] ?? null;
  const namesNext = verb !== '' && new RegExp(`\\b${verb}\\b`, 'i').test(reply) && (target === null || new RegExp(`(?:#|section\\s*|§\\s*)${target}\\b`, 'i').test(reply));
  evidence('PLUG-03', namesNext, `reply names the next step "${summary.next}": ${reply.replace(/\s+/g, ' ').slice(0, 240)}`);
  const missing = summary.sections.filter((x) => !reply.toLowerCase().includes(x.slug.toLowerCase()));
  evidence('PLUG-03', summary.sections.length === PAPER_SECTIONS.length && missing.length === 0,
    `reply lists the status section lines (${summary.sections.map((x) => x.slug).join(', ')})${missing.length > 0 ? `; missing ${missing.map((x) => x.slug).join(', ')}` : ''}`);
  return paper;
}

function plug04(ctx) {
  const root = ctx.clone;
  const list = runClaude(ctx.claude, ['mcp', 'list'], { cwd: root, env: { ...ctx.env, PWD: root } });
  const row = parseMcpList(list.stdout).find((r) => r.name === 'pensmith');
  const warned = /Missing environment variables/i.test(list.stdout + list.stderr);
  evidence('PLUG-04', row?.connected === true && !warned && !existsSync(path.join(root, 'node_modules')),
    `fresh clone, no build: claude mcp list → ${row ? `${row.name}: ${row.command} - ${row.statusText}` : 'no pensmith row'}${warned ? ' (Missing environment variables warning)' : ''}`);
  const s = headless(ctx, 'plug04-dedupe', { cwd: root, prompt: 'Reply with the word ready.', pluginDir: './plugin' });
  const servers = (s.transcript.init?.mcp_servers ?? []).filter((m) => /pensmith/.test(m.name));
  evidence('PLUG-04', servers.length === 1 && servers[0].status === 'connected',
    `--plugin-dir ./plugin at the repo root: pensmith servers ${JSON.stringify(servers)}`);
}

function plug05(ctx, paper) {
  const s = headless(ctx, 'plug05-verify-section', {
    cwd: paper.dir,
    prompt: '/pensmith:verify-section 1',
    pluginDir: ctx.pluginDir,
    tools: 'Skill',
    allowed: ['Skill', TOOL('pensmith_verify')],
    maxTurns: 3,
  });
  const calls = s.transcript.toolUses.map((u) => `${u.name}${u.name === 'Skill' ? `(${JSON.stringify(u.input)})` : ''}`);
  evidence('PLUG-05', s.transcript.toolUses.some((u) => u.name === TOOL('pensmith_verify')), `/pensmith:verify-section 1 → ${calls.join(' → ') || '(no tool call)'}`);
}

function plug14(ctx, paper) {
  // A HANDOFF.json written by the real PreCompact bundle in the CLI-made paper.
  rmSync(path.join(paper.dir, '.paper', 'HANDOFF.json'), { force: true });
  const hook = spawnSync(process.execPath, [path.join(ctx.pluginDir, 'dist', 'hooks', 'pre-compact.mjs')], {
    cwd: paper.dir,
    env: ctx.env,
    input: JSON.stringify({ session_id: 'session-check', cwd: paper.dir, hook_event_name: 'PreCompact', trigger: 'manual' }),
    encoding: 'utf8',
  });
  const handoff = existsSync(path.join(paper.dir, '.paper', 'HANDOFF.json')) ? JSON.parse(readFileSync(path.join(paper.dir, '.paper', 'HANDOFF.json'), 'utf8')) : null;
  // The router's step for the paper (`plan #1` for makePaper's outline) is the position the handoff records.
  const step = /^(plan|write|verify) #(\S+)/.exec(statusSummary(paper.status).next);
  const want = step ? { phase: 'sectioning', section: step[2], position: step[1] } : null;
  evidence('PLUG-14', hook.status === 0 && handoff?.schema_version === 2 && want !== null
    && handoff.phase === want.phase && handoff.section === want.section && handoff.position === want.position,
  `pre-compact.mjs wrote HANDOFF v2: phase ${handoff?.phase}, section ${handoff?.section}, position ${handoff?.position} (router: ${statusSummary(paper.status).next})`);

  const s = headless(ctx, 'plug14-sessionstart', {
    cwd: paper.dir,
    prompt: 'Quote verbatim the "Next step" line of the pensmith resume context you were given when this session started. If you were given none, reply NONE.',
    pluginDir: ctx.pluginDir,
  });
  const ran = s.transcript.hooks.find((h) => h.hook_event === 'SessionStart');
  evidence('PLUG-14', ran?.exit_code === 0 && /additionalContext/.test(ran?.stdout ?? ''), `SessionStart hook: exit ${ran?.exit_code}, ${ran?.outcome}; debug log: ${/Hook SessionStart \(node [^)]+\) provided additionalContext \(\d+ chars\)/.exec(s.log)?.[0] ?? 'no additionalContext line'}`);
  const reply = s.transcript.result?.result ?? '';
  const expected = handoff?.next_action?.split(':')[0] ?? 'Find and evaluate sources';
  evidence('PLUG-14', reply.includes(expected), `the model quotes the resume context: ${reply.replace(/\s+/g, ' ').slice(0, 240)}`);

  // Headless /compact of that session: PreCompact writes HANDOFF.json.
  rmSync(path.join(paper.dir, '.paper', 'HANDOFF.json'), { force: true });
  const sid = s.transcript.init?.session_id;
  if (!sid) {
    note('PLUG-14 live-lane: no session id to resume, headless /compact not attempted');
    return;
  }
  const c = headless(ctx, 'plug14-compact', { cwd: paper.dir, prompt: '/compact', pluginDir: ctx.pluginDir, resume: sid });
  const pre = c.transcript.hooks.find((h) => h.hook_event === 'PreCompact');
  const logged = /PreCompact:\w+ \[node [^\]]*pre-compact\.mjs\] completed with status (\d+)/.exec(c.log);
  const wrote = existsSync(path.join(paper.dir, '.paper', 'HANDOFF.json'));
  if (pre || logged || wrote) {
    const status = pre ? String(pre.exit_code) : logged?.[1];
    evidence('PLUG-14', wrote && status === '0', `headless \`claude -p --resume <id> "/compact"\`: ${logged ? logged[0] : `PreCompact exit ${status}`}; HANDOFF.json ${wrote ? 'written' : 'missing'}`);
  } else {
    note(`PLUG-14 live-lane: a headless \`claude -p --resume <id> "/compact"\` did not run PreCompact (${(c.transcript.result?.result ?? c.stderr).toString().replace(/\s+/g, ' ').slice(0, 160)}); /compact in an interactive session remains a live-lane item`);
  }
}

/** A copy of the plugin whose MCP server and an extra Stop hook record the session ids they see. */
function sessionIdProbe(ctx, paper) {
  const probe = path.join(ctx.tmp, 'probe-plugin');
  cpSync(ctx.pluginDir, probe, { recursive: true });
  const envOut = path.join(ctx.tmp, 'probe-mcp-env.json');
  const stopOut = path.join(ctx.tmp, 'probe-stop-stdin.json');
  writeFileSync(path.join(probe, 'dist', 'mcp', 'session-env-probe.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath, pathToFileURL } from 'node:url';",
    'const out = process.argv[2];',
    "writeFileSync(out, JSON.stringify({ CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID ?? null, names: Object.keys(process.env).filter((k) => /SESSION/i.test(k)).sort() }));",
    "const server = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');",
    'process.argv.splice(1, process.argv.length - 1, server);',
    'await import(pathToFileURL(server).href);',
    '',
  ].join('\n'));
  writeFileSync(path.join(probe, 'dist', 'hooks', 'stop-stdin-probe.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    'const chunks = [];',
    "process.stdin.on('data', (c) => chunks.push(c));",
    "process.stdin.on('end', () => { writeFileSync(process.argv[2], Buffer.concat(chunks).toString('utf8')); });",
    '',
  ].join('\n'));
  const manifestPath = path.join(probe, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.mcpServers.pensmith.args = ['${CLAUDE_PLUGIN_ROOT}/dist/mcp/session-env-probe.mjs', envOut];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const hooksPath = path.join(probe, 'hooks', 'hooks.json');
  const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));
  hooks.hooks.Stop.push({ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/hooks/stop-stdin-probe.mjs', stopOut], timeout: 10 }] });
  writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + '\n');

  const s = headless(ctx, 'session-id-probe', { cwd: paper.dir, prompt: 'Reply with the word ready.', pluginDir: probe });
  const sid = s.transcript.init?.session_id ?? null;
  const mcpEnv = existsSync(envOut) ? JSON.parse(readFileSync(envOut, 'utf8')) : null;
  const stop = existsSync(stopOut) ? JSON.parse(readFileSync(stopOut, 'utf8') || '{}') : null;
  const connected = (s.transcript.init?.mcp_servers ?? []).find((m) => m.name === PLUGIN_SERVER)?.status;
  note(`session-id probe: init session_id=${sid}; MCP server env CLAUDE_CODE_SESSION_ID=${mcpEnv?.CLAUDE_CODE_SESSION_ID ?? '(unset)'} (session-ish names: ${mcpEnv?.names?.join(', ') || 'none'}); Stop stdin session_id=${stop?.session_id ?? '(no Stop stdin)'}; probed server ${connected}`);
  evidence('session-id', mcpEnv?.CLAUDE_CODE_SESSION_ID != null && mcpEnv.CLAUDE_CODE_SESSION_ID === stop?.session_id && stop?.session_id === sid,
    'the MCP server sees CLAUDE_CODE_SESSION_ID equal to the Stop hook\'s stdin session_id (the lock owner match, D-17-37)');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.cli)) throw new Error(`the pensmith CLI ${opts.cli} is missing — run \`npm run build\` (or pass --cli)`);
  const claude = resolveClaude();
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pensmith-session-check-'));
  const clone = path.join(tmp, 'clone');
  execFileSync('git', ['clone', '--quiet', '--local', '--no-hardlinks', opts.repo, clone], { stdio: ['ignore', 'pipe', 'pipe'] });
  const { env, auth } = sessionEnv(tmp);
  const ctx = { claude, env, tmp, clone, pluginDir: path.join(clone, 'plugin'), cli: opts.cli, model: opts.model, cost: 0 };
  note(`claude ${runClaude(claude, ['--version'], { cwd: tmp, env }).stdout.trim()} at ${claude.path}; auth: ${auth}`);
  note(`fresh clone (no npm ci, no build): ${clone}`);
  let paper = null;
  try {
    if (opts.only.has('plug03')) paper = plug03(ctx);
    paper ??= makePaper(ctx, 'paper');
    if (opts.only.has('plug04')) plug04(ctx);
    if (opts.only.has('plug05')) plug05(ctx, paper);
    if (opts.only.has('plug14')) plug14(ctx, paper);
    if (opts.only.has('session-id')) sessionIdProbe(ctx, paper);
  } finally {
    note(`model usage: $${ctx.cost.toFixed(4)}; transcripts and debug logs in ${tmp}${opts.keep || failures > 0 ? '' : ' (removed)'}`);
    if (!opts.keep && failures === 0) rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write(failures === 0 ? 'session check: all evidence passed\n' : `session check: ${failures} check(s) failed\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  process.stderr.write(`session check: ${e?.stack ?? String(e)}\n`);
  process.exit(1);
});
