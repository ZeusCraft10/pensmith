// tests/intake-pii-egress.test.ts — Phase 9 Wave 0 RED-by-skip PII-EGRESS gate
// (threat T-09-00-04 / H3, the SUFFICIENT half — egress BY CONTENT).
//
// The ordering gate (tests/intake-pii-ordering.test.ts) proves redaction is
// SOURCE-ORDERED before the prompt-load. That is NECESSARY but NOT SUFFICIENT: a
// verbatim implementer could redact early then still pass the RAW answers to
// interpolate(), and the ordering grep would still pass. THIS gate closes the
// gap: it captures the LIVE model-bound payload at the egress seam and asserts
// NO raw PII sentinel survives — proving the REDACTED text is what crosses the
// model boundary, not merely that redaction code runs first.
//
// MECHANISM (offline, no network — mirrors cassette-no-leak's committed-string
// scan philosophy, but against the LIVE interpolated payload): intake's only
// LLM-bound payload is interpolate(prompt, { seed }) (bin/lib/prompt-loader.ts).
// We SPY on `interpolate` via the ESM module namespace and record every return
// value it produces during an intake run, then scan those captured payloads.
//
// RED-by-skip via SOURCE-GREP: READY = intake.ts references `redactPii` (the
// redaction must be wired) AND feeds interpolate a REDACTED variable (we detect
// the 09-03 wiring by requiring BOTH `redactPii` and `interpolate(` in source,
// with redactPii appearing before the interpolate call). Until 09-03 wires
// redaction INTO the egress, every test SKIPS so the suite stays GREEN.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PII_EGRESS_SENTINELS } from './fixtures/pii-polish-corpus.js';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

function intakeSource(): string {
  return fs.readFileSync(repoPath('bin/cli/intake.ts'), 'utf8');
}

// READY: redaction wired AND it precedes the interpolate egress call. This is
// stronger than the ordering grep (which only checks loadPrompt) — it requires
// the REDACTION primitive specifically, ahead of the payload builder.
function piiEgressWired(): boolean {
  const src = intakeSource();
  const redactIdx = src.indexOf('redactPii');
  const interpIdx = src.indexOf('interpolate(');
  return redactIdx !== -1 && interpIdx !== -1 && redactIdx < interpIdx;
}

const READY = piiEgressWired();

function mkProjectRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-pii-egress-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

/**
 * Run intake with the model-bound `interpolate` spied. Returns every payload
 * string interpolate produced during the run. The spy wraps the REAL
 * interpolate so the verb's behavior is unchanged — we only RECORD what crossed
 * the egress seam.
 *
 * INTERCEPTION (runtime-portable): native ESM module namespaces are SEALED
 * under Node 20.18+/24 — `Object.defineProperty(promptLoader, 'interpolate', …)`
 * throws "Cannot redefine property" and an assignment is a spec no-op, so the
 * prompt-loader export cannot be monkeypatched from outside. intake therefore
 * routes its model-bound interpolate through an in-module seam
 * (`__setInterpolateForTest`) that wraps the REAL prompt-loader interpolate —
 * the only interception point that observes the EXACT payload intake hands the
 * model. This still captures the LIVE egress by content (H3), not merely the
 * source ordering (which intake-pii-ordering.test.ts covers).
 */
async function runIntakeCapturingEgress(
  cwd: string,
  args: Record<string, unknown>,
): Promise<string[]> {
  const captured: string[] = [];
  const promptLoader = await import('../bin/lib/prompt-loader.js');
  const realInterpolate = promptLoader.interpolate;
  const intake = await import('../bin/cli/intake.js');

  // Spy: record the interpolated payload AND the raw vars values (both are
  // candidate egress strings). Then delegate to the real implementation.
  const spy = (template: string, vars: Record<string, string>): string => {
    for (const v of Object.values(vars)) captured.push(v);
    const out = realInterpolate(template, vars);
    captured.push(out);
    return out;
  };
  const restore = intake.__setInterpolateForTest(spy);

  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    const run = (intake.intakeCommand as { run: (ctx: { args: Record<string, unknown> }) => Promise<unknown> }).run;
    await run({ args });
  } finally {
    process.chdir(prevCwd);
    restore();
  }
  return captured;
}

test('EGRESS-BY-CONTENT: no raw PII sentinel survives in the model-bound interpolate payload', { skip: !READY }, async () => {
  const root = mkProjectRoot();
  // Phase 11: intake now calls complete() via the real transport. Set
  // PENSMITH_NO_LLM=1 so complete() short-circuits to the offline mock BEFORE
  // any HTTP call (key is not needed for the offline path). The spy still
  // captures the _interpolate egress because _interpolate(prompt, {assignment:
  // egressSeed}) is called BEFORE complete() in intake.ts — offline mode does
  // NOT prevent the egress capture (the spy observes the REDACTED content).
  process.env.ANTHROPIC_API_KEY = 'sk-test-offline-egress';
  process.env.PENSMITH_NO_LLM = '1';
  process.env.PENSMITH_PII_REDACT = '1';

  const fromPath = path.join(root, 'assignment.txt');
  const seedBody = [
    `Contact: ${PII_EGRESS_SENTINELS.email}`,
    `SSN: ${PII_EGRESS_SENTINELS.ssn}`,
    `Name: ${PII_EGRESS_SENTINELS.name}`,
  ].join('\n');
  fs.writeFileSync(fromPath, seedBody);

  let captured: string[];
  try {
    captured = await runIntakeCapturingEgress(root, { from: fromPath, redactPii: true, yolo: true });
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PENSMITH_NO_LLM;
    delete process.env.PENSMITH_PII_REDACT;
  }

  const allPayloads = captured.join('\n---\n');

  // 1. NO raw sentinel value crossed the model boundary.
  for (const [kind, raw] of Object.entries(PII_EGRESS_SENTINELS)) {
    assert.ok(
      !allPayloads.includes(raw),
      `PII LEAK: raw ${kind} sentinel "${raw}" reached the model-bound payload — redaction is ordering-only, not by-content (H3). Captured:\n${allPayloads}`,
    );
  }

  // 2. The REDACTED tag IS present — proves it was the redacted text that flowed,
  //    not an empty/stripped payload that would vacuously pass check 1.
  assert.match(
    allPayloads,
    /\[REDACTED:(EMAIL|SSN|NAME)\]/,
    `expected a [REDACTED:KIND] tag in the model-bound payload (redacted content flowed, not empty); captured:\n${allPayloads}`,
  );
});
