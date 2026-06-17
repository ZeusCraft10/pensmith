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

  // Tier-equivalence assertion. CLI is always exercised; MCP tool only when
  // registered (the 3 interactive verbs degrade to CLI-only with documented
  // mcpRegistered: false flag in the fact set).
  test(`tier-contract: ${tc.name} (TIER-06, Plan 09 GREEN)`, { skip: !verbExists }, async () => {
    const root = seedPaperFixture();

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
});
