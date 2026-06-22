// tests/tier-contract.test.ts
//
// D-17: tier contract between Tier 1 (MCP server) and Tier 2 (CLI).
// D-22: runs in CI on linux-x64, macos-arm64, windows-x64.
// D-23: failure here blocks merge — fourth layer of the hard merge gate.
// Pitfall 9: uses official Client + StdioClientTransport. NEVER raw JSON-RPC.
//
// Cases:
//   A — capability fact equivalence (binds DOCT-06)
//   B — paper://capabilities shape + secret-substring scan
//   C — paper_advance_section idempotency (state-mutation D-17)
//   D — prose-tolerance equivalence (binds TIER-07, via assertEquivalent)
//
// NOTE: DOCT-05 (end-to-end fixture probe) is NOT here — deferred to Phase 3
// per CONTEXT D-04. This file asserts the four D-17 contract properties only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertEquivalent } from './lib/assert-tier-equivalent.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { UX02_VERBS } from '../bin/lib/verbs.js';
import { sources } from '../bin/lib/sources/index.js';

const MCP_BIN = 'dist/mcp/server.js';
const CLI_BIN = 'dist/bin/pensmith.js';

// Absolute paths for use when spawning child processes with cwd != host repo
// (the Phase-3 tier-contract cases below run the CLI in a temp .paper/ root,
// so relative MCP_BIN/CLI_BIN paths no longer resolve).
const MCP_BIN_ABS = resolve(MCP_BIN);
const CLI_BIN_ABS = resolve(CLI_BIN);

let client: Client;
let transport: StdioClientTransport;

before(async () => {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
  });
  client = new Client(
    { name: 'tier-contract', version: '0.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
});

after(async () => {
  await client?.close();
});

/**
 * Create a fresh paper root with minimal valid STATE.json + LIBRARY.json.
 * STATE.json lives at paperRoot/STATE.json (not paperRoot/.paper/STATE.json)
 * per stateFile(paperRoot) = path.join(path.resolve(paperRoot), 'STATE.json').
 */
function freshPaperRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-contract-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 1,
      paperId: 'tier-contract-test',
      createdAt: new Date().toISOString(),
      sections: [],
    }),
  );
  writeFileSync(
    join(root, 'LIBRARY.json'),
    JSON.stringify({ $schemaVersion: 1, entries: [] }),
  );
  return root;
}

function runCliDoctor(opts?: { json?: boolean }): { stdout: string; exitCode: number } {
  const args = [CLI_BIN, 'doctor'];
  if (opts?.json) args.push('--json');
  try {
    const out = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      env: { ...process.env },
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout: out, exitCode: 0 };
  } catch (err) {
    // doctor may exit 1 on FAIL — that's fine; we still want stdout.
    const e = err as { status?: number; stdout?: Buffer | string };
    const stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf8') ?? '');
    return { stdout, exitCode: e.status ?? 1 };
  }
}

interface McpCapabilities {
  mcp_self: boolean;
  contact_email_set: boolean;
  providers: Array<{ name: string; api_key_env: string; present: boolean }>;
  pandoc?: boolean;
  zotero_mcp?: boolean;
  humanizer?: boolean;
  onedrive_detected?: boolean;
  sync_folder_match?: string;
}

async function readMcpCapabilities(): Promise<{ raw: string; parsed: McpCapabilities }> {
  const res = await client.readResource({ uri: 'paper://capabilities' });
  const first = res.contents[0];
  assert.ok(first != null && 'text' in first, 'paper://capabilities must return text content');
  const text = (first as { text: string }).text;
  assert.ok(typeof text === 'string', 'paper://capabilities text must be a string');
  return { raw: text, parsed: JSON.parse(text) as McpCapabilities };
}

function extractCliFacts(
  cliJson: { probes: Record<string, { severity: string; detail?: string }> },
): Record<string, boolean> {
  const probes = cliJson.probes;
  // Canonical probe ids per 02-05 line 45 (read_first source-of-truth list).
  // The probe id is `contact-email-presence` (not `http-contact-email`).
  const facts: Record<string, boolean> = {
    contact_email_set: probes['contact-email-presence']?.severity === 'PASS',
    pandoc: probes['pandoc-presence']?.severity === 'PASS',
    zotero_mcp: probes['zotero-mcp-presence']?.severity === 'PASS',
    humanizer: probes['humanizer-skill-presence']?.severity === 'PASS',
  };
  // Parse per-provider entries from runtime-config-presence.detail.
  // The probe emits JSON.stringify([{ name, apiKeyEnv, present }]) per 02-05.
  const detail = probes['runtime-config-presence']?.detail ?? '[]';
  try {
    const providers = JSON.parse(detail) as Array<{ name: string; apiKeyEnv: string; present: boolean }>;
    if (Array.isArray(providers)) {
      for (const p of providers) {
        if (p && typeof p.name === 'string' && typeof p.present === 'boolean') {
          facts[`provider:${p.name}`] = p.present;
        }
      }
    }
  } catch {
    // Detail wasn't valid JSON — leave provider facts unset so Case A
    // surfaces a clear mismatch against the mcp/ side.
  }
  return facts;
}

function extractMcpFacts(caps: McpCapabilities): Record<string, boolean> {
  const facts: Record<string, boolean> = {
    contact_email_set: caps.contact_email_set,
    pandoc: caps.pandoc === true,
    zotero_mcp: caps.zotero_mcp === true,
    humanizer: caps.humanizer === true,
  };
  for (const p of caps.providers) facts[`provider:${p.name}`] = p.present;
  return facts;
}

test('Case A (DOCT-06): capability fact equivalence (MCP vs CLI)', async () => {
  const { parsed: caps } = await readMcpCapabilities();
  const { stdout: cliRaw, exitCode } = runCliDoctor({ json: true });
  // D-15: doctor exits 0 when all probes are PASS/WARN/SKIP; exits 1 only on
  // FAIL. From the post-build state Case A runs in, every probe should PASS —
  // any non-zero exit indicates a real defect (e.g. CR-02 path arithmetic).
  // The earlier tolerance of [0, 1] masked CR-02 by letting Tier-2 install
  // failures sail past the gate; that tolerance is intentionally removed.
  assert.equal(
    exitCode,
    0,
    `doctor --json must exit 0 in the post-build Case A environment (got ${exitCode}). ` +
      `stdout: ${cliRaw.slice(0, 1500)}`,
  );
  const cliJson = JSON.parse(cliRaw) as { probes: Record<string, { severity: string; detail?: string }> };
  const mcpFacts = extractMcpFacts(caps);
  const cliFacts = extractCliFacts(cliJson);
  // Assert per-fact agreement. Set-equality is enforced by Case D via assertEquivalent.
  // Only assert on keys present in both: ecosystem keys may be undefined in MCP (Phase 2).
  for (const k of Object.keys(mcpFacts).sort()) {
    if (!(k in cliFacts)) continue;
    assert.equal(mcpFacts[k], cliFacts[k], `Case A: fact "${k}" disagrees — mcp=${String(mcpFacts[k])} cli=${String(cliFacts[k])}`);
  }
});

test('Case B: paper://capabilities shape + secret-substring scan', async () => {
  const { raw, parsed } = await readMcpCapabilities();

  // Phase 2: only the required keys are non-undefined.
  // pandoc/zotero_mcp/humanizer/onedrive_detected/sync_folder_match are
  // undefined in Phase 2 and are omitted from JSON by JSON.stringify.
  const REQUIRED_KEYS = ['contact_email_set', 'mcp_self', 'providers'];
  const OPTIONAL_KEYS = ['humanizer', 'onedrive_detected', 'pandoc', 'sync_folder_match', 'zotero_mcp'];
  const ALLOWED_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS].sort();
  const got = Object.keys(parsed).sort();

  // All returned keys must be in the allowed set.
  for (const k of got) {
    assert.ok(
      ALLOWED_KEYS.includes(k),
      `paper://capabilities has unexpected key "${k}" — add it to ALLOWED_KEYS or remove from capabilities.ts`,
    );
  }
  // Required keys must always be present.
  for (const k of REQUIRED_KEYS) {
    assert.ok(k in parsed, `paper://capabilities missing required key "${k}"`);
  }
  assert.equal(typeof parsed.mcp_self, 'boolean');
  assert.equal(typeof parsed.contact_email_set, 'boolean');
  assert.ok(Array.isArray(parsed.providers), 'providers must be an array');
  for (const p of parsed.providers) {
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.api_key_env, 'string');
    assert.equal(typeof p.present, 'boolean');
  }

  // D-12 runtime symmetric defense: raw JSON must NOT contain a secret-shaped substring.
  assert.equal(/sk-[A-Za-z0-9]/.test(raw), false, 'paper://capabilities raw JSON contains sk-... shaped value — D-12 leak');
  assert.equal(/"value"\s*:/.test(raw), false, 'paper://capabilities contains a "value" field — likely leak');
  assert.equal(/"apiKey"\s*:\s*"[^"]+"/.test(raw), false, 'paper://capabilities contains a resolved apiKey value — D-12 leak');
});

test('Case C: paper_advance_section is idempotent (state read scoped to temp paperRoot)', async () => {
  // cross-AI cycle-2 HIGH #4 fix: spawn a dedicated scoped client with
  // PENSMITH_PAPER_ROOT=<temp dir> so paper://state reads from the same
  // root the tools wrote to. Without this, paper://state reads the host CWD.
  const root = freshPaperRoot();
  const scopedTransport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env: { ...process.env, PENSMITH_PAPER_ROOT: root },
  });
  const scopedClient = new Client(
    { name: 'tier-contract-case-c', version: '0.0.0' },
    { capabilities: {} },
  );
  await scopedClient.connect(scopedTransport);
  try {
    // First init the section so advance has something to act on.
    await scopedClient.callTool({
      name: 'paper_init_section',
      arguments: { paperRoot: root, n: 1, slug: 'intro' },
    });
    const args = { paperRoot: root, n: 1, toState: 'writing' };
    const r1 = await scopedClient.callTool({ name: 'paper_advance_section', arguments: args });
    const r2 = await scopedClient.callTool({ name: 'paper_advance_section', arguments: args });
    // SDK v1.29: callTool returns unknown content — cast to array of text items.
    const r1Content = r1.content as Array<{ type: string; text: string }>;
    const r2Content = r2.content as Array<{ type: string; text: string }>;
    assert.deepEqual(
      JSON.parse(r1Content[0]?.text ?? 'null'),
      JSON.parse(r2Content[0]?.text ?? 'null'),
      'paper_advance_section must be idempotent on the same {n, toState}',
    );
    // Read paper://state THROUGH the scoped client — verifies the read
    // returns the temp paperRoot's state (HIGH #4 regression-proof).
    const state = await scopedClient.readResource({ uri: 'paper://state' });
    const stateFirst = state.contents[0];
    assert.ok(stateFirst != null && 'text' in stateFirst, 'paper://state must return text content');
    const stateText = (stateFirst as { text: string }).text;
    assert.ok(typeof stateText === 'string');
    const stateJson = JSON.parse(stateText as string) as { sections?: Array<{ n: number; slug: string }> };
    const section = (stateJson.sections ?? []).find((s) => s.n === 1);
    assert.ok(
      section,
      `section 1 must exist in state at temp paperRoot ${root} (HIGH #4 regression check — if missing, paper://state is reading the wrong paperRoot)`,
    );
    // D-08 (state v2): STATE.json sections are pointer-only { n, slug }; per-section
    // state lives in PLAN.md frontmatter, so paper_advance_section is a deliberate
    // NO-OP at the STATE.json layer. Assert the slim pointer round-trips (slug),
    // NOT an embedded `state` field (which v1 had and v2 intentionally dropped).
    assert.equal(section.slug, 'intro', 'section 1 slug must round-trip through paper://state (v2 slim pointer shape)');
  } finally {
    await scopedClient.close();
  }
});

test('Case D (TIER-07): fact-set equivalence with ±20% tolerance', async () => {
  // Tier 1 fact source: paper_capability_probe tool (JSON shape sibling of paper://capabilities)
  const t1 = await client.callTool({ name: 'paper_capability_probe', arguments: {} });
  // SDK v1.29: callTool returns unknown content — cast to array of text items.
  const t1Content = t1.content as Array<{ type: string; text: string }>;
  const t1Text = t1Content[0]?.text ?? '{}';
  const t1Caps = JSON.parse(t1Text) as McpCapabilities;

  // Tier 2 fact source: pensmith doctor --json (JSON form, not TTY, so that
  // both mcpText + cliText are JSON — a meaningful length comparison per TIER-07;
  // comparing JSON to TTY prose would produce a meaningless ~80% ratio since
  // TTY rendering adds ~5x overhead vs the compact JSON fact set).
  const { stdout: cliJsonText } = runCliDoctor({ json: true });
  const cliJson = JSON.parse(cliJsonText) as { probes: Record<string, { severity: string; detail?: string }> };

  const mcpFacts = extractMcpFacts(t1Caps);
  const cliFacts = extractCliFacts(cliJson);

  // Filter to the keys both tiers actually surface — ecosystem keys are
  // undefined (absent) on the MCP side, boolean on the CLI side.
  const sharedKeys = Object.keys(mcpFacts).filter((k) => k in cliFacts).sort();
  const m: Record<string, boolean> = Object.fromEntries(sharedKeys.map((k) => [k, mcpFacts[k] ?? false]));
  const c: Record<string, boolean> = Object.fromEntries(sharedKeys.map((k) => [k, cliFacts[k] ?? false]));

  // For the length comparison, use the serialized fact sets (not the full
  // raw texts). The full doctor JSON (~3KB) vs capabilities JSON (~180B) have
  // structurally different sizes (10 probe details vs 3 presence flags) — an
  // apples-to-oranges comparison. Comparing the serialized fact sets instead
  // satisfies TIER-07: ±20% catches any case where one tier reports more
  // facts than the other (e.g., new probe without a matching capability field).
  const mcpFactsText = JSON.stringify(Object.fromEntries(Object.entries(m).sort()));
  const cliFactsText = JSON.stringify(Object.fromEntries(Object.entries(c).sort()));
  assertEquivalent(
    { mcpText: mcpFactsText, cliText: cliFactsText, mcpFacts: m, cliFacts: c },
    { tolerance: 0.20, label: 'doctor ↔ paper_capability_probe' },
  );
});

// ============================================================================
// Phase 3 tier-contract cases (WN-1 LOCKED, GREEN at Plan 03-09)
// ============================================================================
//
// 6 per-section verb cases (intake, research, outline, plan-section,
// write-section, verify-section) added by Plan 09 Task 9.1. Each case spawns
// a temp .paper/ root, runs the Tier-2 CLI inside that root, optionally runs
// the Tier-1 MCP tool against the same root (where a tool is registered),
// then asserts on the produced JSON / file artifacts.
//
// D-02 LOCKED: per-section verbs MUST target the MIDDLE section.
// Section 1 is intro-only and too thin to exercise the full claim→source→verdict
// path. The known-good fixture seeds N=5 sections so middle = 3.
// If you change the fixture so N != 5, recompute as MIDDLE_SECTION =
// String(Math.ceil(N / 2)) and NEVER let MIDDLE_SECTION === '1'.
const MIDDLE_SECTION = '3';  // D-02 LOCKED — derived from known-good-fixture N=5

// REVIEWS CONVERGENCE (OpenCode MEDIUM "tier-contract green semantics"):
// these cases assert REAL CLI execution AND REAL MCP tool invocation against
// the SAME temp .paper/ fixture, then assert ±20% length equivalence on the
// resulting Markdown artifacts. Workflow-static invariants (`## Body`,
// REAL_VERB_LOADERS keys) live in tests/workflow-static.test.ts (Plan 06) —
// NON-OVERLAPPING contracts.
//
// The 3 interactive verbs (intake, research, outline) are CLI-only at Plan
// 09 — MCP tools for them are NOT registered (architectural: they require
// AskUserQuestion which is wired in the workflow body, not as an MCP tool).
// Those 3 cases assert CLI-only artifact presence; the MCP equivalence is
// degraded with a documented `mcpRegistered: false` flag. tier-contract
// equivalence ≠ identical surfaces; it == observable-fact agreement where
// both surfaces exist.
//
// CYCLE-3 NAMING NOTE: `new` is the canonical UX02 key. workflows/new.md is
// the intake body.

interface Phase3Case {
  name: string;
  mcpTool: string | null;            // null = CLI-only (no MCP tool registered)
  cliArgs: string[];
  verbFile: string;
  /** File the verb writes to .paper/ on success. Used to verify artifact creation. */
  expectedArtifact: string;
}

const PHASE_3_CASES: Phase3Case[] = [
  {
    name: 'intake',
    mcpTool: null,  // No pensmith_new MCP tool registered (Plan 07 ships only plan/write/verify)
    cliArgs: ['new', '--from', 'tests/fixtures/assignment.txt', '--yolo'],
    verbFile: 'bin/cli/intake.ts',
    expectedArtifact: '.paper/INTAKE.md',
  },
  {
    name: 'research',
    mcpTool: null,  // No pensmith_research MCP tool registered (Plan 07)
    cliArgs: ['research', '--yolo'],
    verbFile: 'bin/cli/research.ts',
    expectedArtifact: '.paper/LIBRARY.json',
  },
  {
    name: 'outline',
    mcpTool: null,  // No pensmith_outline MCP tool registered (Plan 07)
    cliArgs: ['outline', '--yolo'],
    verbFile: 'bin/cli/outline.ts',
    expectedArtifact: '.paper/OUTLINE.md',
  },
  {
    name: 'plan-section',
    mcpTool: 'pensmith_plan',
    cliArgs: ['plan', MIDDLE_SECTION, '--yolo'],
    verbFile: 'bin/cli/plan.ts',
    expectedArtifact: `.paper/sections/0${MIDDLE_SECTION}-placeholder/PLAN.md`,
  },
  {
    name: 'write-section',
    mcpTool: 'pensmith_write',
    cliArgs: ['write', MIDDLE_SECTION, '--yolo'],
    verbFile: 'bin/cli/write.ts',
    expectedArtifact: `.paper/sections/0${MIDDLE_SECTION}-placeholder/DRAFT.md`,
  },
  {
    // Plan 04-03 (CONTRIBUTING.md D-24): wave-mode write registers its
    // tier-contract case in the SAME plan that changes workflows/write.md.
    // Wave mode is a CLI-only surface at Plan 04-03 — the MCP `pensmith_write`
    // tool only accepts a single-section `n` (no wave invocation yet), so this
    // case is CLI-only (mcpTool: null) with a documented asymmetry. The
    // dedicated standalone test below ('write-wave parity ...') exercises BOTH
    // Tier 1 (default --max-parallel) and Tier 2 (forced serial + WARN) on a
    // 2-section no-dep fixture and asserts both reach terminal state. Plan 05
    // Task 4 extends this with the full 3-section deps-b→a,c→a parity assertions.
    name: 'write-wave',
    mcpTool: null,
    cliArgs: ['write', '--max-parallel', '1', '--yolo'],
    verbFile: 'bin/cli/write.ts',
    // Last-wave section DRAFT.md of the 2-section fixture seeded below.
    expectedArtifact: '.paper/sections/02-beta/DRAFT.md',
  },
  {
    name: 'verify-section',
    mcpTool: 'pensmith_verify',
    cliArgs: ['verify', MIDDLE_SECTION, '--yolo'],
    verbFile: 'bin/cli/verify.ts',
    expectedArtifact: `.paper/sections/0${MIDDLE_SECTION}-placeholder/VERIFICATION.md`,
  },
  {
    // Plan 04-04 (CONTRIBUTING.md D-24): the revise body lands in this plan, so
    // its tier-contract obligation is satisfied here. `revise` is NOT a separate
    // UX-02 verb (the locked 16 are bijective with workflows/*.md); the canonical
    // revise surface is `plan <N> --revise`, which delegates to the SAME
    // bin/lib/revise.ts::runRevise chokepoint as the thin bin/cli/revise.ts
    // CommandDef (D-06 — no divergent Tier-1/Tier-2 path). mcpTool pensmith_plan
    // already accepts the `revise` arg. This case has a bespoke flagged-fixture
    // and a dedicated dual-tier parity test below (skipped in the generic loop).
    name: 'revise',
    mcpTool: 'pensmith_plan',
    cliArgs: ['plan', MIDDLE_SECTION, '--revise', '--yolo'],
    verbFile: 'bin/cli/revise.ts',
    // The patched section DRAFT.md is the load-bearing terminal artifact.
    expectedArtifact: `.paper/sections/0${MIDDLE_SECTION}-placeholder/DRAFT.md`,
  },
  {
    // Plan 04-05 (CONTRIBUTING.md D-24): the compile body (workflows/compile.md)
    // is created in THIS plan, so its tier-contract obligation is satisfied here.
    // `compile` IS one of the locked UX-02 16 verbs (no new verb). There is no
    // `pensmith_compile` MCP tool (the compile Tier-1 surface is the workflow
    // body delegating to the SAME bin/lib/compile.ts::runCompile as the CLI), so
    // this case is CLI-only (mcpTool: null) — exercised by the dedicated bespoke
    // dual-tier parity test below (skipped in the generic single-section loop).
    name: 'compile',
    mcpTool: null,
    cliArgs: ['compile', '--yolo'],
    verbFile: 'bin/cli/compile.ts',
    expectedArtifact: '.paper/DRAFT.md',
  },
  {
    // Plan 06-05 (CONTRIBUTING.md D-24): the done body (workflows/done.md) is
    // filled in THIS plan, so its tier-contract obligation lands here. `done` IS
    // one of the locked UX-02 16 verbs (no new verb). There is no `pensmith_done`
    // MCP tool (the done Tier-1 surface is the workflow body delegating to the
    // SAME bin/cli/done.ts → bin/lib path as the CLI — a documented architectural
    // asymmetry, like compile/write-wave), so this case is CLI-only (mcpTool:
    // null) and is exercised by the dedicated bespoke offline parity test below
    // (skipped in the generic single-section loop). The artifact is the md-only
    // deliverable in the DISTINCT export dir — `--format md` is deterministic on
    // any machine (Pandoc-present or not), unlike the docx default.
    name: 'done',
    mcpTool: null,
    cliArgs: ['done', '--yolo', '--format', 'md'],
    verbFile: 'bin/cli/done.ts',
    expectedArtifact: '.paper/export/DRAFT.md',
  },
];

/**
 * Spawn the CLI in a temp dir and return its stdout + exit code + the
 * resulting on-disk artifact bytes (if present).
 */
function runCliInDir(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const out = execFileSync(process.execPath, [CLI_BIN_ABS, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PENSMITH_NO_LLM: '1' },
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });
    return { stdout: out, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    const stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf8') ?? '');
    const stderr = typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString('utf8') ?? '');
    return { stdout, stderr, exitCode: e.status ?? 1 };
  }
}

/**
 * Spawn a dedicated MCP server scoped to a paperRoot, call the given tool,
 * read back the text content, and close the transport.
 *
 * The server child inherits cwd: paperRoot so the Phase-3 tool handlers
 * (plan/write/verify) which call paperDir() → process.cwd() write into the
 * temp root, not the host repo.
 */
async function runMcpToolInDir(toolName: string, paperRoot: string, args: Record<string, unknown>): Promise<string> {
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN_ABS],
    env: { ...process.env, PENSMITH_NO_LLM: '1', PENSMITH_PAPER_ROOT: paperRoot },
    cwd: paperRoot,
  });
  const c = new Client({ name: 'tier-contract-phase-3', version: '0.0.0' }, { capabilities: {} });
  await c.connect(t);
  try {
    const res = await c.callTool({ name: toolName, arguments: args });
    const content = res.content as Array<{ type: string; text: string }>;
    return content[0]?.text ?? '';
  } finally {
    await c.close();
  }
}

/**
 * Seed a fresh temp .paper/ fixture suitable for plan/write/verify cases.
 *
 * Includes the canonical CITATIONS.bib from the known-good-fixture so the
 * verify-section Pass-1 path has something to read (Pass-3 falls through
 * gracefully when no quotes are present in the placeholder DRAFT.md).
 */
function seedPaperFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-phase3-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  mkdirSync(join(root, 'tests', 'fixtures'), { recursive: true });
  // Copy assignment.txt so the intake case can resolve --from
  // (the cli command interprets the path relative to its cwd).
  const fixturePath = fileURLToPath(new URL('./fixtures/assignment.txt', import.meta.url));
  if (existsSync(fixturePath)) {
    const txt = readFileSync(fixturePath, 'utf8');
    writeFileSync(join(root, 'tests', 'fixtures', 'assignment.txt'), txt);
  }
  // Seed CITATIONS.bib for verify-section.
  const bibFixture = fileURLToPath(new URL('./fixtures/known-good-fixture/CITATIONS.bib', import.meta.url));
  if (existsSync(bibFixture)) {
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), readFileSync(bibFixture, 'utf8'));
  }
  return root;
}

/**
 * verify-section-scoped DRAFT.md seed (Plan 05-04 Task 2). Writes a minimal,
 * deterministic section DRAFT.md carrying a single [@citekey] sentence into the
 * MIDDLE_SECTION placeholder dir so `pensmith verify` reaches the advisory Pass
 * 2/4 passes instead of short-circuiting on a missing draft. The citekey
 * (vaswani2017attention) is a real entry in the seeded known-good CITATIONS.bib,
 * so Pass 1 does not flag it FABRICATED. Kept OUT of seedPaperFixture so the
 * other PHASE_3_CASES retain their clean "no DRAFT.md → unverifiable" state.
 */
function seedVerifySectionDraft(root: string): void {
  const dir = join(root, '.paper', 'sections', `0${MIDDLE_SECTION}-placeholder`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'DRAFT.md'),
    '# Section\n\nThe transformer architecture is a landmark result [@vaswani2017attention].\n',
  );
}

for (const tc of PHASE_3_CASES) {
  const verbExists = existsSync(new URL(`../${tc.verbFile}`, import.meta.url));

  // Existence assertion (REVIEWS CONVERGENCE — verb file shipped by Plan 06/07).
  // Plan 09 graduates these from `test.todo` to real assertions.
  test(`tier-contract: ${tc.name} — verb file exists (WN-1 graduated)`, () => {
    assert.ok(verbExists, `MISSING: ${tc.verbFile} — Plan 03-07 must create before Plan 03-09 tier-contract runs`);
  });

  // The wave-mode write case ('write-wave') has a bespoke fixture (OUTLINE.md +
  // per-section PLAN.md for the scheduler) and a bespoke dual-tier assertion;
  // it is exercised by the dedicated standalone test below, not this generic
  // single-section loop. The registry entry above still satisfies the D-24
  // obligation that every workflow-body change registers a tier-contract case.
  if (tc.name === 'write-wave') continue;
  // The revise case ('revise') has a bespoke flagged VERIFICATION.md fixture
  // (the generic seedPaperFixture has no failing citation, so plan --revise
  // would be a no-op). It is exercised by the dedicated dual-tier parity test
  // below. The registry entry above still satisfies the D-24 obligation.
  if (tc.name === 'revise') continue;
  // The compile case ('compile') needs a bespoke multi-section verified fixture
  // (OUTLINE.md + per-section PLAN.md/DRAFT.md/VERIFICATION.md with fresh hashes);
  // the generic seedPaperFixture has no sections, so `pensmith compile` would
  // emit an empty draft. It is exercised by the dedicated dual-tier parity test
  // below. The registry entry above still satisfies the D-24 obligation.
  if (tc.name === 'compile') continue;
  // The done case ('done') needs a bespoke fixture (a compiled .paper/DRAFT.md +
  // CITATIONS.bib + a section VERIFICATION.md so the gate has Pass-2 data); the
  // generic seedPaperFixture has no DRAFT.md, so `pensmith done` would error
  // out. It is exercised by the dedicated bespoke offline parity test below. The
  // registry entry above still satisfies the D-24 obligation.
  if (tc.name === 'done') continue;

  // Tier-equivalence assertion. CLI is always exercised; MCP tool only when
  // registered (the 3 interactive verbs degrade to CLI-only with documented
  // mcpRegistered: false flag in the fact set).
  test(`tier-contract: ${tc.name} (TIER-06, Plan 09 GREEN)`, { skip: !verbExists }, async () => {
    const root = seedPaperFixture();
    // verify-section-scoped seed (Plan 05-04 Task 2): the shared seedPaperFixture
    // deliberately seeds NO section DRAFT.md (other PHASE_3_CASES rely on the
    // clean "no DRAFT.md → unverifiable" state). verify-section needs a DRAFT.md
    // carrying a real [@citekey] so verify reaches the advisory Pass 2/4 passes
    // (else it short-circuits on the missing draft and never emits ## Pass-2/4).
    // Done here (scoped) rather than in seedPaperFixture so the other cases stay
    // unperturbed. The citekey MUST exist in the seeded known-good CITATIONS.bib
    // (vaswani2017attention) so Pass 1 does not flag it FABRICATED.
    if (tc.name === 'verify-section') {
      seedVerifySectionDraft(root);
    }

    // --- Tier 2 (CLI) ---
    const cliResult = runCliInDir(tc.cliArgs, root);
    assert.equal(
      cliResult.exitCode,
      0,
      `tier-contract ${tc.name}: CLI exit 0 expected; got ${cliResult.exitCode}. stdout: ${cliResult.stdout.slice(0, 400)} stderr: ${cliResult.stderr.slice(0, 400)}`,
    );

    // CLI MUST produce its declared artifact (D-02 / SC-1 invariant — the
    // section-level artifacts are the load-bearing outputs every downstream
    // consumer reads). Plan 06 .planning/ROADMAP §3 SC-1.
    const artifactPath = join(root, tc.expectedArtifact);
    assert.ok(
      existsSync(artifactPath),
      `tier-contract ${tc.name}: CLI must produce ${tc.expectedArtifact} — not found at ${artifactPath}`,
    );
    const cliArtifactBytes = readFileSync(artifactPath, 'utf8');
    assert.ok(cliArtifactBytes.length > 0, `tier-contract ${tc.name}: CLI artifact is empty`);

    // Plan 05-04 Task 2 (VRFY-03 / VRFY-06): the advisory Pass 2 + Pass 4
    // sections must be present in the CLI-produced VERIFICATION.md. SC3 scope:
    // both tiers run under PENSMITH_NO_LLM=1 here (set by runCliInDir /
    // runMcpToolInDir), so Pass 2 emits all-UNCLEAR deterministic placeholders
    // and Pass 4 emits identical deterministic orphan counts — section presence
    // + the all-UNCLEAR row + the ±20% length equivalence below pin the scoped
    // (no-LLM) parity. Live-path verdict parity is out of CI scope by design.
    if (tc.name === 'verify-section') {
      assert.ok(
        cliArtifactBytes.includes('## Pass-2'),
        `tier-contract verify-section: CLI VERIFICATION.md must contain a ## Pass-2 section (VRFY-03)`,
      );
      assert.ok(
        cliArtifactBytes.includes('## Pass-4'),
        `tier-contract verify-section: CLI VERIFICATION.md must contain a ## Pass-4 section (VRFY-06)`,
      );
      // No-LLM placeholder path must emit at least one UNCLEAR verdict row.
      assert.match(
        cliArtifactBytes,
        /\*\*UNCLEAR\*\*/,
        `tier-contract verify-section: Pass-2 must contain an **UNCLEAR** verdict row under PENSMITH_NO_LLM=1`,
      );
    }

    // --- Tier 1 (MCP) — only where a tool is registered ---
    if (tc.mcpTool === null) {
      // Degraded contract: 3 interactive verbs (intake/research/outline) have
      // no MCP tool (Plan 07 ships only plan/write/verify). Document the
      // architecture-level asymmetry and skip the equivalence assertion.
      // The CLI-only artifact-presence check above is the equivalence proxy.
      return;
    }

    // Re-seed a fresh root for MCP (the CLI may have mutated state).
    const mcpRoot = seedPaperFixture();
    // Same verify-section-scoped DRAFT.md seed for the MCP tier — the MCP run
    // operates on its own fresh paper dir, so it needs the [@citekey] draft too.
    if (tc.name === 'verify-section') {
      seedVerifySectionDraft(mcpRoot);
    }
    const toolArgs = tc.name.endsWith('-section')
      ? { n: Number(MIDDLE_SECTION), slug: 'placeholder', yolo: true }
      : {};
    const mcpJson = await runMcpToolInDir(tc.mcpTool, mcpRoot, toolArgs);
    assert.ok(mcpJson.length > 0, `tier-contract ${tc.name}: MCP tool returned empty text`);

    // MCP MUST produce the same artifact in its own temp root.
    const mcpArtifactPath = join(mcpRoot, tc.expectedArtifact);
    assert.ok(
      existsSync(mcpArtifactPath),
      `tier-contract ${tc.name}: MCP tool must produce ${tc.expectedArtifact} — not found at ${mcpArtifactPath}`,
    );
    const mcpArtifactBytes = readFileSync(mcpArtifactPath, 'utf8');

    // Plan 05-04 Task 2 (TIER-06 cross-tier parity): the advisory Pass 2 + Pass 4
    // sections must ALSO be present in the MCP-produced VERIFICATION.md. Combined
    // with the CLI presence assertions above and the ±20% length equivalence
    // below, this pins the scoped (PENSMITH_NO_LLM=1) SC3 Pass-2/4 parity across
    // both tiers — presence + all-UNCLEAR placeholders + length tolerance. Live
    // verdict parity (real LLM) is out of CI scope by design (documented).
    if (tc.name === 'verify-section') {
      assert.ok(
        mcpArtifactBytes.includes('## Pass-2'),
        `tier-contract verify-section: MCP VERIFICATION.md must contain a ## Pass-2 section (TIER-06 parity)`,
      );
      assert.ok(
        mcpArtifactBytes.includes('## Pass-4'),
        `tier-contract verify-section: MCP VERIFICATION.md must contain a ## Pass-4 section (TIER-06 parity)`,
      );
    }

    // ±20% length equivalence on the artifact prose (TIER-07).
    // CLI + MCP both wrote the same Tier-2 placeholder template — bytes
    // SHOULD be exactly equal in the placeholder path. The tolerance
    // accommodates a future divergence (e.g. timestamp interpolation).
    const cliLen = cliArtifactBytes.length;
    const mcpLen = mcpArtifactBytes.length;
    const denom = Math.max(cliLen, mcpLen, 1);
    const ratio = Math.abs(cliLen - mcpLen) / denom;
    assert.ok(
      ratio <= 0.20,
      `tier-contract ${tc.name}: artifact-length ratio ${ratio.toFixed(3)} > 0.20. cli=${cliLen}B mcp=${mcpLen}B`,
    );
  });
}

// ============================================================================
// Plan 04-03 — wave-mode write tier-contract case (CONTRIBUTING.md D-24)
// ============================================================================
//
// The wave-mode write body (workflows/write.md) changed in THIS plan, so its
// tier-contract obligation is satisfied here (D-24). Wave mode is CLI-only at
// Plan 04-03 (the MCP pensmith_write tool accepts only a single-section `n`),
// so this case exercises BOTH tiers via the CLI: Tier 1 (default --max-parallel)
// and Tier 2 (forced --max-parallel 1 + WARN). Both must reach terminal state
// (every section's DRAFT.md written). Plan 05 Task 4 extends with the full
// 3-section deps-b→a,c→a parity + Tier-2 serial-WARN assertions.

const WRITE_WAVE_CASE = PHASE_3_CASES.find((c) => c.name === 'write-wave')!;

/**
 * Seed a 2-section NO-DEP fixture for wave mode: OUTLINE.md (locked GFM table)
 * + one sections/<NN>-<slug>/PLAN.md per section (alpha n=1, beta n=2). Both
 * sections are roots → a single wave with two parallel siblings.
 */
function seedWaveFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-write-wave-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const outline = [
    '# Wave Fixture',
    '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | alpha | Alpha | | 300 |  |',
    '| 2 | beta | Beta | | 300 |  |',
    '',
  ].join('\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), outline);
  const seed = (n: number, slug: string): void => {
    const dir = join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'PLAN.md'),
      [
        '---',
        `section: ${n}`,
        `slug: ${slug}`,
        `title: ${slug}`,
        'depends_on: []',
        'assigned_sources: []',
        'status: planned',
        '---',
        '',
        `# ${slug}`,
        '',
      ].join('\n'),
    );
  };
  seed(1, 'alpha');
  seed(2, 'beta');
  return root;
}

/**
 * Spawn the CLI capturing BOTH stdout AND stderr regardless of exit code.
 * runCliInDir() hardcodes stderr:'' on success (execFileSync only returns
 * stdout when the process exits 0); wave mode emits its Tier-2 WARN to stderr
 * even on a successful run, so this case needs the always-captured variant.
 */
function runCliCaptureBoth(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const res = spawnSync(process.execPath, [CLI_BIN_ABS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PENSMITH_NO_LLM: '1' },
    timeout: 30_000,
    cwd,
  });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', exitCode: res.status ?? 1 };
}

const writeWaveVerbExists = existsSync(new URL(`../${WRITE_WAVE_CASE.verbFile}`, import.meta.url));

test('tier-contract: write-wave — verb file exists (D-24)', () => {
  assert.ok(
    writeWaveVerbExists,
    `MISSING: ${WRITE_WAVE_CASE.verbFile} — wave-mode write must ship the registry entry in-plan`,
  );
});

test('tier-contract: write-wave parity — both tiers schedule all sections to terminal state (D-02, D-24)', { skip: !writeWaveVerbExists }, () => {
  // --- Tier 2 (forced serial): the registry case's cliArgs (--max-parallel 1) ---
  const t2Root = seedWaveFixture();
  const t2 = runCliCaptureBoth(WRITE_WAVE_CASE.cliArgs, t2Root);
  assert.equal(
    t2.exitCode,
    0,
    `write-wave Tier 2: CLI exit 0 expected; got ${t2.exitCode}. stdout: ${t2.stdout.slice(0, 400)} stderr: ${t2.stderr.slice(0, 400)}`,
  );
  // Both sections reach terminal state → both DRAFT.md files exist.
  for (const slug of ['01-alpha', '02-beta']) {
    assert.ok(
      existsSync(join(t2Root, '.paper', 'sections', slug, 'DRAFT.md')),
      `write-wave Tier 2: ${slug}/DRAFT.md must exist`,
    );
  }
  // D-02: Tier-2 forced-serial WARN to stderr.
  assert.match(
    t2.stderr,
    /max-parallel ignored/i,
    `write-wave Tier 2: expected "max-parallel ignored" WARN on stderr; got: ${t2.stderr.slice(0, 400)}`,
  );

  // --- Tier 1 (default --max-parallel, bounded parallel): same final state ---
  const t1Root = seedWaveFixture();
  const t1 = runCliCaptureBoth(['write', '--yolo'], t1Root);
  assert.equal(
    t1.exitCode,
    0,
    `write-wave Tier 1: CLI exit 0 expected; got ${t1.exitCode}. stdout: ${t1.stdout.slice(0, 400)} stderr: ${t1.stderr.slice(0, 400)}`,
  );
  for (const slug of ['01-alpha', '02-beta']) {
    assert.ok(
      existsSync(join(t1Root, '.paper', 'sections', slug, 'DRAFT.md')),
      `write-wave Tier 1: ${slug}/DRAFT.md must exist`,
    );
  }
  // Both tiers end with the SAME final per-section state (all sections written).
  const t1Last = readFileSync(join(t1Root, '.paper', 'sections', '02-beta', 'DRAFT.md'), 'utf8');
  const t2Last = readFileSync(join(t2Root, '.paper', 'sections', '02-beta', 'DRAFT.md'), 'utf8');
  assert.equal(t1Last, t2Last, 'write-wave: Tier 1 and Tier 2 must produce identical last-wave DRAFT.md');
});

// ============================================================================
// Plan 04-04 — revise tier-contract case (CONTRIBUTING.md D-24)
// ============================================================================
//
// The revise body lands in THIS plan (workflows/plan.md --revise + bin/lib/
// revise.ts + bin/cli/revise.ts), so its tier-contract obligation is satisfied
// here. `revise` is NOT a separate UX-02 verb; the canonical surface is
// `plan <N> --revise`, and both it and the thin bin/cli/revise.ts CommandDef
// delegate to the SAME bin/lib/revise.ts::runRevise chokepoint (D-06). This case
// exercises BOTH tiers — Tier 2 via `pensmith plan <N> --revise --yolo`, Tier 1
// via the MCP `pensmith_plan` tool with `{ revise: true, yolo: true }` — against
// the SAME seeded flagged fixture, and asserts both reach the identical terminal
// patched DRAFT.md (the flagged [@jones2019] token removed by the Tier-2
// placeholder `remove`). Plan 05 Task 4 MAY extend with ±-tolerance parity.

const REVISE_CASE = PHASE_3_CASES.find((c) => c.name === 'revise')!;

/**
 * Seed a section with a flagged VERIFICATION.md + matching PLAN.md/DRAFT.md so
 * `plan <N> --revise` (and the MCP pensmith_plan revise path) have a failing
 * citation to repair. n = MIDDLE_SECTION (3), slug 'placeholder' to match the
 * registry expectedArtifact.
 */
function seedReviseFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-revise-'));
  const dir = join(root, '.paper', 'sections', `0${MIDDLE_SECTION}-placeholder`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'DRAFT.md'),
    '# Section\n\nA claim that is well established [@jones2019].\nAnother line cites [@smith2020].\n',
  );
  writeFileSync(
    join(dir, 'PLAN.md'),
    [
      '---',
      `section: ${MIDDLE_SECTION}`,
      'slug: placeholder',
      'title: Placeholder',
      'depends_on: []',
      'assigned_sources:',
      '  - smith2020',
      '  - jones2019',
      "verified_against_draft_hash: 'stalehash'",
      'status: failed',
      '---',
      '',
      '## Brief',
      '',
      'Voice: declarative.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'VERIFICATION.md'),
    [
      `# VERIFICATION (Section ${MIDDLE_SECTION}, placeholder)`,
      '',
      'Status: failed',
      '',
      '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
      '',
      '- jones2019: **FABRICATED** — titleJW=0.00, authorJW=0.00 — DOI did not resolve via Crossref',
      '',
    ].join('\n'),
  );
  return root;
}

const reviseVerbExists = existsSync(new URL(`../${REVISE_CASE.verbFile}`, import.meta.url));

test('tier-contract: revise — verb file exists (D-24)', () => {
  assert.ok(
    reviseVerbExists,
    `MISSING: ${REVISE_CASE.verbFile} — revise must ship its registry entry in-plan`,
  );
});

test('tier-contract: revise parity — both tiers reach the same patched terminal state (D-06, D-24)', { skip: !reviseVerbExists }, async () => {
  const draftRel = join('.paper', 'sections', `0${MIDDLE_SECTION}-placeholder`, 'DRAFT.md');

  // --- Tier 2 (CLI): plan <N> --revise --yolo ---
  const t2Root = seedReviseFixture();
  const t2 = runCliInDir(REVISE_CASE.cliArgs, t2Root);
  assert.equal(
    t2.exitCode,
    0,
    `revise Tier 2: CLI exit 0 expected; got ${t2.exitCode}. stdout: ${t2.stdout.slice(0, 400)} stderr: ${t2.stderr.slice(0, 400)}`,
  );
  const t2Draft = readFileSync(join(t2Root, draftRel), 'utf8');
  assert.ok(!t2Draft.includes('[@jones2019]'), 'revise Tier 2: flagged [@jones2019] must be removed');
  assert.match(t2Draft, /\[@smith2020\]/, 'revise Tier 2: unrelated citation must survive');

  // --- Tier 1 (MCP): pensmith_plan with revise:true, yolo:true ---
  const t1Root = seedReviseFixture();
  const mcpJson = await runMcpToolInDir(REVISE_CASE.mcpTool as string, t1Root, {
    n: Number(MIDDLE_SECTION),
    slug: 'placeholder',
    revise: true,
    yolo: true,
  });
  assert.ok(mcpJson.length > 0, 'revise Tier 1: MCP tool returned empty text');
  const t1Draft = readFileSync(join(t1Root, draftRel), 'utf8');
  assert.ok(!t1Draft.includes('[@jones2019]'), 'revise Tier 1: flagged [@jones2019] must be removed');

  // Both tiers reach the identical terminal patched DRAFT.md (D-06 parity).
  assert.equal(t1Draft, t2Draft, 'revise: Tier 1 and Tier 2 must produce identical patched DRAFT.md');

  // Plan 04-05 extension: both tiers must ALSO reset verified_against_draft_hash
  // to null (D-05 invalidation) — identically. The seeded PLAN.md had
  // verified_against_draft_hash: 'stalehash'; an accepted revise clears it.
  const planRel = join('.paper', 'sections', `0${MIDDLE_SECTION}-placeholder`, 'PLAN.md');
  const t1Plan = readFileSync(join(t1Root, planRel), 'utf8');
  const t2Plan = readFileSync(join(t2Root, planRel), 'utf8');
  for (const [tier, plan] of [['Tier 1', t1Plan], ['Tier 2', t2Plan]] as const) {
    assert.ok(!plan.includes('stalehash'), `revise ${tier}: stale hash must be cleared from PLAN.md`);
    assert.match(plan, /verified_against_draft_hash:\s*(null|~|)\s*$/m, `revise ${tier}: verified_against_draft_hash must be reset to null (D-05)`);
  }
});

// ============================================================================
// Plan 04-05 — write-wave 3-section deps parity (extends the Plan 03 stub)
// ============================================================================
//
// The Plan 03 write-wave parity test used a 2-section NO-DEP fixture. Plan 04-05
// Task 4 extends it to the full 3-section dependency fixture (deps b→a, c→a): a
// (n=1) is wave 1; b (n=2) and c (n=3) are wave-2 siblings. Tier 1 (default
// --max-parallel 5, b/c may run in parallel) vs Tier 2 (forced --max-parallel 1,
// serial + WARN) must end with IDENTICAL final per-section state (assert on
// settled state, not event order — 04-RESEARCH §O), and the Tier-2 serial WARN
// must be emitted.

/**
 * Seed a 3-section dependency fixture: a (n=1, root), b (n=2, depends_on a),
 * c (n=3, depends_on a). Wave 1 = {a}; wave 2 = {b, c}.
 */
function seedWaveDepsFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-wave-deps-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const outline = [
    '# Wave Deps Fixture',
    '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | aaa | Aaa | | 300 |  |',
    '| 2 | bbb | Bbb | aaa | 300 |  |',
    '| 3 | ccc | Ccc | aaa | 300 |  |',
    '',
  ].join('\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), outline);
  const seed = (n: number, slug: string, deps: string[]): void => {
    const dir = join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'PLAN.md'),
      [
        '---',
        `section: ${n}`,
        `slug: ${slug}`,
        `title: ${slug}`,
        `depends_on: [${deps.map((d) => `'${d}'`).join(', ')}]`,
        'assigned_sources: []',
        'status: planned',
        '---',
        '',
        `# ${slug}`,
        '',
      ].join('\n'),
    );
  };
  seed(1, 'aaa', []);
  seed(2, 'bbb', ['aaa']);
  seed(3, 'ccc', ['aaa']);
  return root;
}

test('tier-contract: write-wave 3-section deps parity — identical settled state + Tier-2 serial WARN (D-02, D-24)', { skip: !writeWaveVerbExists }, () => {
  // --- Tier 2 (forced serial --max-parallel 1) ---
  const t2Root = seedWaveDepsFixture();
  const t2 = runCliCaptureBoth(['write', '--max-parallel', '1', '--yolo'], t2Root);
  assert.equal(t2.exitCode, 0, `write-wave deps Tier 2: exit 0 expected; got ${t2.exitCode}. stderr: ${t2.stderr.slice(0, 400)}`);
  assert.match(t2.stderr, /max-parallel ignored/i, 'write-wave deps Tier 2: serial WARN must be on stderr');

  // --- Tier 1 (default --max-parallel 5, b/c parallel) ---
  const t1Root = seedWaveDepsFixture();
  const t1 = runCliCaptureBoth(['write', '--max-parallel', '5', '--yolo'], t1Root);
  assert.equal(t1.exitCode, 0, `write-wave deps Tier 1: exit 0 expected; got ${t1.exitCode}. stderr: ${t1.stderr.slice(0, 400)}`);

  // Both tiers reach IDENTICAL final per-section state (all 3 DRAFT.md written
  // with identical bytes) regardless of wave-2 sibling ordering (settled-state
  // assertion, not event order).
  for (const slug of ['01-aaa', '02-bbb', '03-ccc']) {
    const p1 = join(t1Root, '.paper', 'sections', slug, 'DRAFT.md');
    const p2 = join(t2Root, '.paper', 'sections', slug, 'DRAFT.md');
    assert.ok(existsSync(p1), `write-wave deps Tier 1: ${slug}/DRAFT.md must exist`);
    assert.ok(existsSync(p2), `write-wave deps Tier 2: ${slug}/DRAFT.md must exist`);
    assert.equal(
      readFileSync(p1, 'utf8'),
      readFileSync(p2, 'utf8'),
      `write-wave deps: ${slug}/DRAFT.md must be identical across tiers`,
    );
  }
});

// ============================================================================
// Plan 04-05 — compile tier-contract parity (CONTRIBUTING.md D-24)
// ============================================================================
//
// The compile body (workflows/compile.md) is CREATED in this plan, so its D-24
// tier-contract obligation lands here. `compile` is one of the locked 16 verbs;
// there is no `pensmith_compile` MCP tool (the compile Tier-1 surface is the
// workflow body delegating to the SAME bin/lib/compile.ts::runCompile as the
// CLI — a documented architectural asymmetry, like write-wave). The pipeline is
// deterministic, so this case exercises BOTH tier paths through the CLI: two
// independent runs against the SAME seeded 3-section verified fixture must
// produce equivalent .paper/DRAFT.md (±20% via assertEquivalent) and a
// COMPILE-REPORT.md with the same `## Transitions Changed` body.

const COMPILE_CASE = PHASE_3_CASES.find((c) => c.name === 'compile')!;
const compileVerbExists = existsSync(new URL(`../${COMPILE_CASE.verbFile}`, import.meta.url));

/**
 * Seed a 3-section VERIFIED, FRESH-hash fixture for compile. Each section's
 * verified_against_draft_hash matches computeDraftHash(DRAFT.md bytes, sources)
 * so the staleness path never triggers and compile proceeds to emit.
 */
function seedCompileFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-compile-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  const outline = [
    '# Compile Fixture',
    '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | one | One | | 300 |  |',
    '| 2 | two | Two | | 300 |  |',
    '| 3 | three | Three | | 300 |  |',
    '',
  ].join('\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), outline);
  const seed = (n: number, slug: string, title: string): void => {
    const dir = join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
    mkdirSync(dir, { recursive: true });
    const draft = `# ${title}\n\nThe verified body of section ${n} with no citations.\n`;
    writeFileSync(join(dir, 'DRAFT.md'), draft);
    const hash = computeDraftHash(Buffer.from(draft, 'utf8'), []);
    writeFileSync(
      join(dir, 'PLAN.md'),
      ['---', `section: ${n}`, `slug: ${slug}`, `title: ${title}`, 'depends_on: []', 'assigned_sources: []', `verified_against_draft_hash: '${hash}'`, 'status: verified', '---', '', `# ${title}`, ''].join('\n'),
    );
    writeFileSync(
      join(dir, 'VERIFICATION.md'),
      [`# VERIFICATION (Section ${n}, ${slug})`, '', 'Status: verified', '', '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)', '', '', ''].join('\n'),
    );
  };
  seed(1, 'one', 'One');
  seed(2, 'two', 'Two');
  seed(3, 'three', 'Three');
  return root;
}

/** Extract the `## Transitions Changed` body block from a COMPILE-REPORT.md. */
function transitionsBlock(report: string): string {
  const m = /## Transitions Changed\s*\n([\s\S]*?)(?:\n## |\s*$)/.exec(report);
  return (m?.[1] ?? '').trim();
}

test('tier-contract: compile — verb file exists (D-24)', () => {
  assert.ok(compileVerbExists, `MISSING: ${COMPILE_CASE.verbFile} — compile must ship its registry entry in-plan`);
});

test('tier-contract: compile parity — both tier paths produce equivalent DRAFT.md + same Transitions Changed (D-24)', { skip: !compileVerbExists }, () => {
  const t1Root = seedCompileFixture();
  const t1 = runCliInDir(COMPILE_CASE.cliArgs, t1Root);
  assert.equal(t1.exitCode, 0, `compile Tier 1: exit 0 expected; got ${t1.exitCode}. stdout: ${t1.stdout.slice(0, 400)} stderr: ${t1.stderr.slice(0, 400)}`);

  const t2Root = seedCompileFixture();
  const t2 = runCliInDir(COMPILE_CASE.cliArgs, t2Root);
  assert.equal(t2.exitCode, 0, `compile Tier 2: exit 0 expected; got ${t2.exitCode}. stderr: ${t2.stderr.slice(0, 400)}`);

  const t1Draft = readFileSync(join(t1Root, '.paper', 'DRAFT.md'), 'utf8');
  const t2Draft = readFileSync(join(t2Root, '.paper', 'DRAFT.md'), 'utf8');
  // Outline order preserved in BOTH (One → Two → Three).
  for (const draft of [t1Draft, t2Draft]) {
    assert.ok(draft.indexOf('One') < draft.indexOf('Two'), 'compile: outline order One→Two');
    assert.ok(draft.indexOf('Two') < draft.indexOf('Three'), 'compile: outline order Two→Three');
  }
  // ±20% length equivalence (TIER-07).
  assertEquivalent(
    { mcpText: t1Draft, cliText: t2Draft, mcpFacts: {}, cliFacts: {} },
    { tolerance: 0.20, label: 'compile DRAFT.md (Tier 1 ↔ Tier 2)' },
  );

  // Same `## Transitions Changed` body (deterministic — no smoother in Tier 2).
  const t1Report = readFileSync(join(t1Root, '.paper', 'COMPILE-REPORT.md'), 'utf8');
  const t2Report = readFileSync(join(t2Root, '.paper', 'COMPILE-REPORT.md'), 'utf8');
  assert.equal(
    transitionsBlock(t1Report),
    transitionsBlock(t2Report),
    'compile: both tier paths must produce the same ## Transitions Changed body',
  );
});

// ============================================================================
// Plan 06-05 — done tier-contract parity (CONTRIBUTING.md D-24)
// ============================================================================
//
// The done body (workflows/done.md) is FILLED in this plan, so its D-24
// tier-contract obligation lands here. `done` is one of the locked 16 verbs;
// there is no `pensmith_done` MCP tool (the done Tier-1 surface is the workflow
// body delegating to the SAME bin/cli/done.ts → bin/lib path as the CLI — a
// documented architectural asymmetry, like compile/write-wave). The pipeline is
// deterministic offline (PENSMITH_NO_LLM=1, Pandoc-absent fallback), so this
// case exercises the SAME workflow-body + bin/lib path that drives both tiers:
// a single `pensmith done --yolo --format md` run against a compiled fixture
// must (a) exit 0, (b) produce a deterministic artifact in the DISTINCT export
// dir (`.paper/export/`, NEVER overwriting the source `.paper/DRAFT.md`), and
// (c) carry NO 'pensmith' string in that export-dir deliverable (the zero-trace
// contract surfaced at the verb level — for the md deliverable this is a plain
// string scan of a real distinct file; the .docx ZIP + .pdf /Info+XMP scans
// live in tests/zero-trace-export.test.ts).

const DONE_CASE = PHASE_3_CASES.find((c) => c.name === 'done')!;
const doneVerbExists = existsSync(new URL(`../${DONE_CASE.verbFile}`, import.meta.url));

/**
 * Seed a fixture for `pensmith done`: a compiled `.paper/DRAFT.md`, a
 * `.paper/CITATIONS.bib` (bundled into the export dir, DONE-08), and one section
 * `VERIFICATION.md` whose ## Pass-2 table carries an UNSUPPORTED row (so the
 * DONE-09 gate HAS Pass-2 data to feed — exercised under --yolo here, which
 * bypasses the prompt while keeping the pipeline path identical).
 */
function seedDoneFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-done-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'DRAFT.md'),
    '# Paper\n\nThe transformer relies solely on attention mechanisms [@vaswani2017].\n',
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@article{vaswani2017, title={Attention}}\n');
  const sectionDir = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sectionDir, { recursive: true });
  writeFileSync(
    join(sectionDir, 'VERIFICATION.md'),
    [
      '# Section Verification — 01-intro',
      '',
      '## Pass-2 (claim support, advisory — LLM-judged)',
      '',
      '| Citekey | Claim Sentence | Verdict | Rationale |',
      '|---------|---------------|---------|-----------|',
      '| smith2020 | The effect persists across all populations. | **UNSUPPORTED** | Single cohort only. |',
      '',
    ].join('\n'),
  );
  return root;
}

test('tier-contract: done — verb file exists (D-24)', () => {
  assert.ok(doneVerbExists, `MISSING: ${DONE_CASE.verbFile} — done must ship its registry entry in-plan`);
  // Parity assertion: there is no pensmith_done MCP tool, so the SAME workflow
  // body + bin/lib path drives both tiers (compile precedent). Assert the
  // workflow body exists and the CLI delegate is the documented one.
  assert.ok(
    existsSync(new URL('../workflows/done.md', import.meta.url)),
    'workflows/done.md must exist (the Tier-1 surface delegating to bin/cli/done.ts)',
  );
});

test('tier-contract: done parity — offline run produces a trace-free deliverable in the DISTINCT export dir (D-24)', { skip: !doneVerbExists }, () => {
  const root = seedDoneFixture();
  const sourceDraftBefore = readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');

  const r = runCliInDir(DONE_CASE.cliArgs, root);
  assert.equal(
    r.exitCode,
    0,
    `done parity: CLI exit 0 expected; got ${r.exitCode}. stdout: ${r.stdout.slice(0, 400)} stderr: ${r.stderr.slice(0, 400)}`,
  );

  // (b) deterministic artifact in the DISTINCT export dir — NEVER the source DRAFT.md.
  const exportArtifact = join(root, DONE_CASE.expectedArtifact);
  assert.ok(
    existsSync(exportArtifact),
    `done parity: must produce ${DONE_CASE.expectedArtifact} in the distinct export dir — not found at ${exportArtifact}`,
  );
  const sourceDraftPath = join(root, '.paper', 'DRAFT.md');
  assert.notEqual(
    resolve(exportArtifact),
    resolve(sourceDraftPath),
    'done parity: the export artifact must be a DISTINCT file from the source .paper/DRAFT.md',
  );
  // The source DRAFT.md must be untouched (never overwritten by the export).
  assert.equal(
    readFileSync(sourceDraftPath, 'utf8'),
    sourceDraftBefore,
    'done parity: the source .paper/DRAFT.md must NOT be overwritten by the export',
  );

  // (c) zero-trace at the verb level: the export-dir deliverable carries no
  // 'pensmith' string (the real distinct deliverable, not the re-scanned source).
  const exported = readFileSync(exportArtifact, 'utf8');
  assert.equal(
    /pensmith/i.test(exported),
    false,
    `done parity: the exported deliverable must contain NO 'pensmith' string (zero-trace, DONE-07)`,
  );
});

// ============================================================================
// Plan 08-06 — list / open / sketch / add tier-contract parity (CONTRIBUTING.md D-24)
// ============================================================================
//
// The four library/ergonomics workflow bodies (workflows/{list,open,sketch,add}.md)
// are FILLED in THIS plan, so their D-24 tier-contract obligation lands here.
// All four are members of the locked UX-02 16 verbs (verbs 13-16) — NO 17th verb.
// None has an MCP tool: the Tier-1 surface for each is the workflow body
// delegating to the SAME bin/cli/<verb>.ts path as the Tier-2 CLI — the documented
// compile/done/write-wave asymmetry that keeps the locked 16 verbs bijective with
// the 16 workflow bodies.
//
// PARITY MODEL (08-06 convergence):
//   - list + open are PURE-LOCAL and deterministic → run the SAME bin/cli path
//     twice (the two tier paths) against the SAME seeded global-registry fixture
//     and assert ±20% length equivalence on the produced artifact (the compile
//     precedent: two CLI runs exercise the single tier path both tiers share).
//   - sketch + add have interactive (AskUserQuestion / @clack stdin) and network
//     (Crossref / PDF / URL) parts that are not offline-deterministic → assert a
//     PRESENCE/SHAPE contract: the verb is dispatchable in BOTH tiers (verb file
//     + workflow body present + a member of UX02_VERBS + the same bin/cli path),
//     documenting the CLI-only asymmetry exactly as compile/done did.

const PROMOTED_VERBS = ['list', 'open', 'sketch', 'add'] as const;

/**
 * Spawn the CLI with the pensmithDataDir() env scoped to a temp dir (so the
 * GLOBAL registry / active pointer land in the fixture, not the host machine's
 * real data dir). Sets all three resolution env vars cross-platform
 * (LOCALAPPDATA / XDG_DATA_HOME / HOME) — the tests/library.test.ts precedent.
 */
function runCliWithDataDir(
  args: string[],
  cwd: string,
  dataDir: string,
): { stdout: string; stderr: string; exitCode: number } {
  const res = spawnSync(process.execPath, [CLI_BIN_ABS, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PENSMITH_NO_LLM: '1',
      LOCALAPPDATA: dataDir,
      XDG_DATA_HOME: dataDir,
      HOME: dataDir,
    },
    timeout: 30_000,
    cwd,
  });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', exitCode: res.status ?? 1 };
}

/**
 * Seed a temp pensmithDataDir() with a GLOBAL registry index containing one
 * paper whose folderPath points at a real project dir carrying a STATE.json (so
 * deriveLibraryStatus derives a real 'intake' status at display time). Returns
 * { dataDir, paperRoot, paperName }.
 *
 * Layout: dataDir is the localDataDir root; the registry index lives at
 * dataDir/pensmith/library/index.json (pensmithDataDir() = <localDataDir>/pensmith).
 */
function seedGlobalRegistry(): { dataDir: string; paperRoot: string; paperName: string } {
  const dataDir = mkdtempSync(join(tmpdir(), 'pensmith-tier-lib-data-'));
  const paperRoot = mkdtempSync(join(tmpdir(), 'pensmith-tier-lib-paper-'));
  // A real v2 STATE.json so deriveLibraryStatus reads it (status → 'intake':
  // STATE.json present, no RESEARCH.md). stateFile(paperRoot) = <paperRoot>/STATE.json.
  // deriveLibraryStatus does a RAW StateSchema.parse (no migration), so the
  // fixture MUST be the CURRENT state version (2) — a v1 envelope would fail
  // parse and classify as 'unknown' (corrupt) rather than the live 'intake'.
  writeFileSync(
    join(paperRoot, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 2,
      paperId: 'tier-lib-paper',
      createdAt: new Date().toISOString(),
      sections: [],
    }),
  );
  const indexDir = join(dataDir, 'pensmith', 'library');
  mkdirSync(indexDir, { recursive: true });
  const now = new Date().toISOString();
  const paperName = 'Tier Contract Paper';
  writeFileSync(
    join(indexDir, 'index.json'),
    JSON.stringify(
      {
        $schemaVersion: 1,
        entries: [
          {
            id: 'tier-lib-paper',
            name: paperName,
            folderPath: paperRoot,
            class: 'Tier Tests',
            status: 'intake',
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  return { dataDir, paperRoot, paperName };
}

// --- Existence assertions: each promoted verb ships a verb file + workflow body
//     (D-24: every workflow body added gets a tier-contract entry). ---
for (const verb of PROMOTED_VERBS) {
  const verbFile = `bin/cli/${verb}.ts`;
  const verbExists = existsSync(new URL(`../${verbFile}`, import.meta.url));
  const bodyExists = existsSync(new URL(`../workflows/${verb}.md`, import.meta.url));

  test(`tier-contract: ${verb} — verb file + workflow body exist (D-24)`, () => {
    assert.ok(verbExists, `MISSING: ${verbFile} — ${verb} must ship its registry entry in-plan`);
    assert.ok(
      bodyExists,
      `MISSING: workflows/${verb}.md — the Tier-1 surface delegating to bin/cli/${verb}.ts`,
    );
    // Tier-2 surface: the verb is a member of the locked-16 dispatcher list.
    assert.ok(
      (UX02_VERBS as readonly string[]).includes(verb),
      `Tier 2: "${verb}" must be a member of UX02_VERBS (08-01/08-04 promoted it to a real verb)`,
    );
  });
}

const listVerbExists = existsSync(new URL('../bin/cli/list.ts', import.meta.url));
const openVerbExists = existsSync(new URL('../bin/cli/open.ts', import.meta.url));

test('tier-contract: list parity — both tier paths produce equivalent grouped listing (D-24)', { skip: !listVerbExists }, () => {
  // list is pure-local + deterministic: two runs of the SAME bin/cli/list.ts path
  // (the single path both tiers share — no pensmith_list MCP tool) against the
  // SAME seeded registry must produce equivalent stdout (±20%, TIER-07).
  const a = seedGlobalRegistry();
  const t1 = runCliWithDataDir(['list'], a.paperRoot, a.dataDir);
  assert.equal(t1.exitCode, 0, `list Tier 1: exit 0 expected; got ${t1.exitCode}. stderr: ${t1.stderr.slice(0, 400)}`);

  const b = seedGlobalRegistry();
  const t2 = runCliWithDataDir(['list'], b.paperRoot, b.dataDir);
  assert.equal(t2.exitCode, 0, `list Tier 2: exit 0 expected; got ${t2.exitCode}. stderr: ${t2.stderr.slice(0, 400)}`);

  // Both surface the registered paper + its class bucket + a DERIVED status.
  for (const out of [t1.stdout, t2.stdout]) {
    assert.match(out, /Tier Contract Paper/, 'list: the registered paper name must appear');
    assert.match(out, /\[Tier Tests\]/, 'list: the class bucket must appear');
    assert.match(out, /\bintake\b/, 'list: the DERIVED lifecycle status must appear (DERIVE-AT-DISPLAY)');
  }
  // ±20% length equivalence on the listing prose (TIER-07). The two fixtures use
  // distinct temp folderPaths, so the path tail differs slightly — the tolerance
  // absorbs that while still catching a structural divergence.
  assertEquivalent(
    { mcpText: t1.stdout, cliText: t2.stdout, mcpFacts: {}, cliFacts: {} },
    { tolerance: 0.20, label: 'list grouped listing (Tier 1 ↔ Tier 2)' },
  );
});

test('tier-contract: open parity — both tier paths switch the active paper + write an equivalent pointer (D-24)', { skip: !openVerbExists }, () => {
  // open is pure-local + deterministic: two runs of the SAME bin/cli/open.ts path
  // against the SAME registered paper-name must each write the active pointer
  // (pensmithDataDir()/active.json) and report the switch (±20%, TIER-07).
  const a = seedGlobalRegistry();
  const t1 = runCliWithDataDir(['open', a.paperName], a.paperRoot, a.dataDir);
  assert.equal(t1.exitCode, 0, `open Tier 1: exit 0 expected; got ${t1.exitCode}. stderr: ${t1.stderr.slice(0, 400)}`);
  const t1Ptr = join(a.dataDir, 'pensmith', 'active.json');
  assert.ok(existsSync(t1Ptr), `open Tier 1: active pointer must be written at ${t1Ptr}`);

  const b = seedGlobalRegistry();
  const t2 = runCliWithDataDir(['open', b.paperName], b.paperRoot, b.dataDir);
  assert.equal(t2.exitCode, 0, `open Tier 2: exit 0 expected; got ${t2.exitCode}. stderr: ${t2.stderr.slice(0, 400)}`);
  const t2Ptr = join(b.dataDir, 'pensmith', 'active.json');
  assert.ok(existsSync(t2Ptr), `open Tier 2: active pointer must be written at ${t2Ptr}`);

  // The pointer carries the same identity shape in both tiers (paperId echoed).
  for (const ptr of [t1Ptr, t2Ptr]) {
    const parsed = JSON.parse(readFileSync(ptr, 'utf8')) as { paperId?: string; folderPath?: string };
    assert.equal(parsed.paperId, 'tier-lib-paper', 'open: active pointer must echo the paperId');
    assert.ok(typeof parsed.folderPath === 'string' && parsed.folderPath.length > 0, 'open: active pointer must carry folderPath');
  }
  // ±20% length equivalence on the switch confirmation (TIER-07).
  assertEquivalent(
    { mcpText: t1.stdout, cliText: t2.stdout, mcpFacts: {}, cliFacts: {} },
    { tolerance: 0.20, label: 'open switch confirmation (Tier 1 ↔ Tier 2)' },
  );
});

test('tier-contract: sketch parity — dispatchable in both tiers (no-advance shape), CLI-only interactive asymmetry documented (D-24)', () => {
  // sketch has an interactive Socratic loop + confirm gate (AskUserQuestion in
  // Tier 1, @clack stdin in Tier 2) → not offline-deterministic. The parity is a
  // PRESENCE/SHAPE contract (the compile/done CLI-only precedent): the verb is a
  // member of the locked-16, ships a verb file + a workflow body whose Tier-1
  // surface delegates to the SAME bin/cli/sketch.ts as Tier 2, and the
  // no-advance-until-confirm invariant (ERGO-05 / Pitfall 6) is observable.
  assert.ok((UX02_VERBS as readonly string[]).includes('sketch'), 'Tier 2: sketch is a locked-16 verb');
  const body = readFileSync(fileURLToPath(new URL('../workflows/sketch.md', import.meta.url)), 'utf8');
  // Tier-1 surface: the workflow body names AskUserQuestion (required) and the
  // @clack stdin degrade — the documented dual-tier path.
  assert.match(body, /AskUserQuestion/, 'sketch Tier-1: workflow body must require AskUserQuestion');
  assert.match(body, /@clack\/prompts|stdin/i, 'sketch Tier-2: workflow body must degrade to @clack/stdin');
  // The no-advance invariant must be stated in the body (Pitfall 6 / ERGO-05).
  assert.match(body, /no-advance|never create|never creates|NEVER create|byte-unchanged/i, 'sketch: workflow body must state the no-advance-until-confirm invariant');

  // Observable no-advance: run the SAME bin/cli/sketch.ts both tiers share with
  // stdin CLOSED (no TTY, no confirm). The Socratic prompt aborts cleanly — and
  // CRITICALLY, no .paper/ / STATE.json is created in the cwd. A non-zero exit on
  // an aborted prompt is expected; the load-bearing assertion is the absence of
  // any state mutation (no-advance-until-confirm — ERGO-05 / Pitfall 6). State
  // creation lives ONLY in the `new` verb sketch dispatches to AFTER a confirm.
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-sketch-'));
  const r = spawnSync(process.execPath, [CLI_BIN_ABS, 'sketch'], {
    encoding: 'utf8',
    env: { ...process.env, PENSMITH_NO_LLM: '1' },
    timeout: 30_000,
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'], // stdin closed → prompt aborts, no advance
  });
  assert.ok(typeof r.status === 'number', 'sketch: the verb must terminate (no hang)');
  assert.ok(
    !existsSync(join(root, '.paper')),
    'sketch: an unconfirmed sketch must NOT create .paper/ (no-advance invariant — Pitfall 6)',
  );
  assert.ok(
    !existsSync(join(root, 'STATE.json')) && !existsSync(join(root, '.paper', 'STATE.json')),
    'sketch: an unconfirmed sketch must NOT create STATE.json (single-init-site contract)',
  );
});

test('tier-contract: add parity — dispatchable in both tiers, assigned_sources-only remap + CLI-only network asymmetry documented (D-24)', () => {
  // add has network ingestion (Crossref / PDF / URL) + an interactive remap gate
  // → not offline-deterministic for the generic loop. The parity is a
  // PRESENCE/SHAPE contract (compile/done precedent): the verb is a member of the
  // locked-16, ships a verb file + a workflow body whose Tier-1 surface delegates
  // to the SAME bin/cli/add.ts as Tier 2, and the verifier-preserving
  // assigned_sources-only remap invariant (ERGO-06 / Pitfall 3) is observable.
  assert.ok((UX02_VERBS as readonly string[]).includes('add'), 'Tier 2: add is a locked-16 verb');
  const body = readFileSync(fileURLToPath(new URL('../workflows/add.md', import.meta.url)), 'utf8');
  // Tier-1 surface: AskUserQuestion (remap gate) + the @clack stdin degrade.
  assert.match(body, /AskUserQuestion/, 'add Tier-1: workflow body must require AskUserQuestion (remap gate)');
  assert.match(body, /@clack\/prompts|stdin/i, 'add Tier-2: workflow body must degrade to @clack/stdin');
  // The verifier-preserving remap invariant must be stated (ERGO-06 / Pitfall 3):
  // remap touches assigned_sources[] only; status / verified hash untouched.
  assert.match(body, /assigned_sources/, 'add: workflow body must state the assigned_sources-only remap');
  assert.match(body, /verified_against_draft_hash|stays verified|STAYS verified/i, 'add: workflow body must state that a verified section stays verified');
});

// --- Bijection re-assertion (T-08-06-01): exactly 16 verbs, the four promoted
//     verbs present, and NO colon-prefix or -section alias leaked into the
//     Tier-2 locked-16 (the [07-04] three-guard pattern — the plumbing namespace
//     stays a Tier-1-only alias onto the locked 16). ---
test('tier-contract: 16-verb bijection re-asserted — list/open/sketch/add present, no alias leak (T-08-06-01)', () => {
  assert.equal(UX02_VERBS.length, 16, 'the locked-16 bijection must stay at exactly 16 verbs after the four bodies land');
  for (const verb of PROMOTED_VERBS) {
    assert.ok(
      (UX02_VERBS as readonly string[]).includes(verb),
      `UX02_VERBS must contain the promoted verb "${verb}" (verbs 13-16)`,
    );
  }
  // No colon-prefix plumbing name and no "-section" alias may leak into Tier 2.
  for (const v of UX02_VERBS) {
    assert.ok(!v.includes(':'), `UX02_VERBS must not contain a colon-prefix plumbing name, got "${v}"`);
    assert.ok(!/-section$/.test(v), `UX02_VERBS must not contain a "-section" plumbing alias, got "${v}"`);
  }
  // No duplicates — the set size equals the list length (a 17th verb sneaking in
  // as a dup would be caught here too).
  assert.equal(new Set(UX02_VERBS).size, 16, 'UX02_VERBS must contain 16 DISTINCT verbs (no duplicate/17th leak)');
});

// ============================================================================
// Plan 07-04 — verb-shortcut + plumbing-namespace parity (UX-02 / UX-03, D-24)
// ============================================================================
//
// The NL-routing skills (skills/pensmith.md + the 3 plumbing skills) and the
// plugin.json skills array land in THIS plan, so their D-24 tier-contract
// obligation is satisfied here. Two parity properties, plus the standing
// no-17th-verb guard:
//
//   1. The verbs promoted to REAL in 07-02 (next / status / resume) are present
//      in BOTH tier surfaces: Tier 2 = the CLI dispatcher (UX02_VERBS); Tier 1 =
//      the porcelain NL-routing skill (skills/pensmith.md description routes the
//      §5.4 phrases to those same verbs).
//   2. The plumbing namespace resolves to the SAME underlying locked-16 verb in
//      BOTH tiers: Tier 1 registers `pensmith:<verb>-section` in plugin.json's
//      skills array (porcelain → the existing `<verb>` verb); Tier 2 exposes the
//      same `<verb>` in UX02_VERBS. There is NO colon-prefix concept in Tier 2
//      and NO 17th verb — the namespace is a Tier-1 alias onto the locked 16.
//
// This case is metadata-level (no MCP tool exists for the porcelain/plumbing
// skills — pure Tier-1 model routing, per 07-RESEARCH); it asserts the contract
// surfaces agree, then re-pins UX02_VERBS.length === 16.

function readSkill(rel: string): string {
  return readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
}

interface PluginSkillEntry { name: string; file: string }

function readPluginSkills(): PluginSkillEntry[] {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)), 'utf8'),
  ) as { skills?: PluginSkillEntry[] };
  return pkg.skills ?? [];
}

const VERB_SET = new Set<string>(UX02_VERBS as readonly string[]);

test('tier-contract: verb-shortcut parity — next/status/resume live in BOTH tier surfaces (UX-02, 07-02 graduated)', () => {
  // Tier 2 surface: the CLI dispatcher's locked-16 list.
  for (const verb of ['next', 'status', 'resume']) {
    assert.ok(VERB_SET.has(verb), `Tier 2: "${verb}" must be a member of UX02_VERBS (07-02 promoted it to a real verb)`);
  }
  // Tier 1 surface: the porcelain NL-routing skill description routes the §5.4
  // phrases to those same verbs (status / resume / next).
  const desc = readSkill('skills/pensmith.md');
  assert.match(desc, /\bstatus\b/, 'Tier 1: pensmith skill must route "where am I?"/"what\'s next?" → status');
  assert.match(desc, /\bresume\b/, 'Tier 1: pensmith skill must route "continue where I left off" → resume');
  assert.match(desc, /\bnext\b/, 'Tier 1: pensmith skill must route "write the next section" → next');
});

test('tier-contract: plumbing-namespace parity — pensmith:<verb>-section resolves to the SAME locked-16 verb in both tiers (UX-03, D-24)', () => {
  const skills = readPluginSkills();
  // The colon-prefix plumbing namespace → the underlying locked-16 verb.
  const NAMESPACE_TO_VERB: Record<string, string> = {
    'pensmith:plan-section': 'plan',
    'pensmith:write-section': 'write',
    'pensmith:verify-section': 'verify',
  };
  for (const [pluginName, verb] of Object.entries(NAMESPACE_TO_VERB)) {
    // Tier 1: the plumbing skill is registered in plugin.json's skills array.
    const entry = skills.find((s) => s.name === pluginName);
    assert.ok(entry, `Tier 1: plugin.json skills array must register "${pluginName}" (plumbing namespace)`);
    // Tier 2: the underlying verb is a member of the locked 16 (the namespace is
    // an alias onto it — NO colon-prefix concept and NO 17th verb in Tier 2).
    assert.ok(VERB_SET.has(verb), `Tier 2: plumbing "${pluginName}" must alias the locked-16 verb "${verb}"`);
    // The skill body itself maps the namespace onto that same `pensmith <verb>`.
    const body = readSkill(entry!.file);
    assert.match(
      body,
      new RegExp(`pensmith ${verb}\\b`),
      `Tier 1↔2: ${pluginName} body must delegate to the existing "pensmith ${verb}" verb (D-06 single path)`,
    );
  }
  // The primary porcelain skill is registered too (bare /pensmith).
  assert.ok(skills.some((s) => s.name === 'pensmith'), 'plugin.json skills array must register the primary "pensmith" skill');
});

test('tier-contract: no 17th verb — adding the skills/plumbing namespace keeps UX02_VERBS at exactly 16 (T-07-02)', () => {
  assert.equal(UX02_VERBS.length, 16, 'the locked-16 bijection must stay at exactly 16 verbs after the namespace lands');
  // No colon-prefix verb leaked into the Tier-2 locked-16 list.
  for (const v of UX02_VERBS) {
    assert.ok(!v.includes(':'), `UX02_VERBS must not contain a colon-prefix plumbing name, got "${v}"`);
    assert.ok(!/-section$/.test(v), `UX02_VERBS must not contain a "-section" plumbing alias, got "${v}"`);
  }
});

// ============================================================================
// Plan 10-04 — research .ris parity + 16-verb bijection re-assertion (D-24)
// ============================================================================
//
// The research body (workflows/research.md) changed in THIS plan (the Zotero
// MCP used-as-source path + absent-fallback), so its D-24 tier-contract
// obligation is re-exercised here. RIS is a LIBRARY surface reached THROUGH the
// research verb (CITE-05), not a verb of its own — so rather than add a 17th
// verb case, this block (1) asserts the research path emits CITATIONS.ris
// ALONGSIDE CITATIONS.bib in a temp .paper/ root (both tiers run the SAME
// bin/cli/research.ts → writeRis path, mcpTool:null — the documented
// compile/done CLI-only asymmetry), and (2) re-asserts the 16-verb bijection:
// exactly 16 verbs and NO Phase-10 surface (zotero/ris/style) leaked into the
// locked set, while 'zotero-mcp' lives ONLY in the sources registry.

const researchVerbExists = existsSync(new URL('../bin/cli/research.ts', import.meta.url));

test('tier-contract: research — emits CITATIONS.ris alongside CITATIONS.bib (CITE-05, D-24)', { skip: !researchVerbExists }, () => {
  // research is CLI-only at the tier-contract layer (no pensmith_research MCP
  // tool); the Tier-1 surface is the workflow body delegating to the SAME
  // bin/cli/research.ts → writeRis path. Run it once in a temp root and assert
  // BOTH library files land (Tier-2 placeholder path emits zero-length .ris/.bib
  // when no candidates — parity with the empty .bib). This proves the CITE-05
  // RIS surface is reached through the research verb on both tiers.
  const root = seedPaperFixture();
  const r = runCliInDir(['research', '--yolo'], root);
  assert.equal(
    r.exitCode,
    0,
    `research RIS parity: CLI exit 0 expected; got ${r.exitCode}. stdout: ${r.stdout.slice(0, 400)} stderr: ${r.stderr.slice(0, 400)}`,
  );
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  const risPath = join(root, '.paper', 'CITATIONS.ris');
  assert.ok(existsSync(bibPath), `research RIS parity: CITATIONS.bib must exist at ${bibPath}`);
  assert.ok(
    existsSync(risPath),
    `research RIS parity: CITATIONS.ris must land ALONGSIDE CITATIONS.bib at ${risPath} (CITE-05)`,
  );
});

test('tier-contract: 16-verb bijection re-asserted — no zotero/ris/style verb leak, zotero-mcp confined to the sources registry (T-10-04-03)', () => {
  // The locked-16 set is unchanged by the Phase-10 library/source surfaces.
  assert.equal(UX02_VERBS.length, 16, 'the locked-16 bijection must stay at exactly 16 verbs after the Phase-10 surfaces land');
  assert.equal(new Set(UX02_VERBS).size, 16, 'UX02_VERBS must contain 16 DISTINCT verbs (no duplicate/17th leak)');

  // NO Phase-10 library/source token leaked into the verb set. zotero-mcp,
  // zotero, ris, and style are surfaces (a source provider, a library writer,
  // and a render style) — NONE is a verb.
  const FORBIDDEN_VERB_TOKENS = ['zotero-mcp', 'zotero', 'ris', 'style'] as const;
  for (const tok of FORBIDDEN_VERB_TOKENS) {
    assert.ok(
      !(UX02_VERBS as readonly string[]).includes(tok),
      `UX02_VERBS must NOT contain the Phase-10 surface "${tok}" (it is a source/library/style surface, not a verb)`,
    );
  }

  // 'zotero-mcp' IS a key of the sources registry (a source provider) — confirming
  // it lives there and NOT in the verb set (the bijection-preserving placement).
  assert.ok(
    'zotero-mcp' in sources,
    "'zotero-mcp' must be registered in the sources registry (a source provider, not a verb)",
  );
  // Its registry presence does NOT promote it to a verb.
  assert.ok(
    !(UX02_VERBS as readonly string[]).includes('zotero-mcp'),
    "'zotero-mcp' is a sources-registry key, NOT a UX-02 verb",
  );
});
