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
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertEquivalent } from './lib/assert-tier-equivalent.js';

const MCP_BIN = 'dist/mcp/server.js';
const CLI_BIN = 'dist/bin/pensmith.js';

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
    const stateJson = JSON.parse(stateText as string) as { sections?: Array<{ n: number; state: string }> };
    const section = (stateJson.sections ?? []).find((s) => s.n === 1);
    assert.ok(
      section,
      `section 1 must exist in state at temp paperRoot ${root} (HIGH #4 regression check — if missing, paper://state is reading the wrong paperRoot)`,
    );
    assert.equal(section.state, 'writing', 'section 1 state must be "writing" after advance');
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
// Phase 3 tier-contract cases (WN-1 LOCKED)
// ============================================================================
//
// These 6 cases are RED at Wave 0 — skip-guarded on each verb's bin/cli/*.ts
// existence. They turn GREEN as Plans 04 (research+adapters), 06 (workflow
// bodies), and 07 (verb entrypoints) land. Plan 09 Task 9.1 removes the skip
// guards (existence assertions graduate from todo→assert).
//
// D-02 LOCKED: per-section verbs MUST target the MIDDLE section.
// Section 1 is intro-only and too thin to exercise the full claim→source→verdict path.
// The known-good fixture seeds N=5 sections so middle = 3.
// If you change the fixture so N != 5, recompute as MIDDLE_SECTION = String(Math.ceil(N / 2))
// and NEVER let MIDDLE_SECTION === '1'.
const MIDDLE_SECTION = '3';  // D-02 LOCKED — derived from known-good-fixture N=5

const PHASE_3_CASES = [
  {
    name: 'intake',
    mcpTool: 'pensmith_new',
    cliArgs: ['new', '--from', 'tests/fixtures/assignment.txt', '--yolo'],
    verbFile: 'bin/cli/intake.ts',
    // CYCLE-2 M-1: canonical filename per Plan 07; `new` stays as dispatcher alias only
  },
  {
    name: 'research',
    mcpTool: 'pensmith_research',
    cliArgs: ['research', '--yolo'],
    verbFile: 'bin/cli/research.ts',
  },
  {
    name: 'outline',
    mcpTool: 'pensmith_outline',
    cliArgs: ['outline', '--yolo'],
    verbFile: 'bin/cli/outline.ts',
  },
  {
    name: 'plan-section',
    mcpTool: 'pensmith_plan',
    cliArgs: ['plan', MIDDLE_SECTION, '--yolo'],
    verbFile: 'bin/cli/plan.ts',
  },
  {
    name: 'write-section',
    mcpTool: 'pensmith_write',
    cliArgs: ['write', MIDDLE_SECTION, '--yolo'],
    verbFile: 'bin/cli/write.ts',
  },
  {
    name: 'verify-section',
    mcpTool: 'pensmith_verify',
    cliArgs: ['verify', MIDDLE_SECTION, '--yolo'],
    verbFile: 'bin/cli/verify.ts',
  },
];

for (const tc of PHASE_3_CASES) {
  const verbExists = existsSync(new URL(`../${tc.verbFile}`, import.meta.url));
  const skip = !verbExists;

  test(`tier-contract: ${tc.name} (TIER-06, WN-1 — RED until Plans 04/06/07 land)`, { skip }, async () => {
    // Setup: spawn temp .paper/ pre-seeded with prior-step outputs as needed.
    // Plan 09 Task 9.1 fills in the full setup and removes the skip guard.
    // @ts-expect-error — runMcpTool helper not yet exported from harness (Plan 07 ships it)
    const tier1 = await runMcpTool(tc.mcpTool, /* inputs */ {});
    // @ts-expect-error — runCli helper not yet exported from harness (Plan 07 ships it)
    const tier2 = await runCli(tc.cliArgs);
    // @ts-expect-error — assertTierEquivalent not yet exported (Plan 07 ships it)
    assertTierEquivalent(tier1, tier2);  // Phase 2 helper pattern, ±20% length
  });

  // RED-existence assertion (REVIEWS CONVERGENCE — Gemini LOW "Wave 0 intentionally-red
  // tests CI gating"): uses node:test's `todo` directive instead of a plain failing
  // assertion. node:test reports todos with `# todo` in TAP output, and the test
  // suite exits 0 (CI does NOT block on todo). Plan 09 Task 9.1 removes the todo
  // wrapper once the verb file exists, restoring the assertion to a real test that
  // either passes (file exists) or fails (file missing — a genuine regression).
  //
  // The wrapping is per-case so individual verbs can graduate from todo→assert as
  // each lands in Plans 04/06/07 — no flag day.
  if (verbExists) {
    test(`tier-contract: ${tc.name} — verb file exists (WN-1 graduated)`, () => {
      assert.ok(verbExists, `MISSING: ${tc.verbFile} — should not be reachable when verbExists=true`);
    });
  } else {
    // node:test `todo` directive — reported in TAP as `# todo`, does NOT block CI.
    // Plan 04/06/07 land the verb file → next CI run flips this to the assert branch above.
    test.todo(`tier-contract: ${tc.name} — verb file exists (WN-1 RED at Wave 0; Plan 07 lands ${tc.verbFile})`);
  }
}
