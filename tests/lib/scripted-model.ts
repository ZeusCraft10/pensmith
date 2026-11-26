// tests/lib/scripted-model.ts — a scripted model for tests that run the real
// CLI: what a step's request looks like, and how to answer it.
//
// A test loads a preload module (tests/lib/journey-generator.ts,
// tests/lib/redo-generator.ts) into the CLI process with `node --import`;
// it calls installScriptedModel, which puts a fake Generator in place of the
// provider (anthropic.ts _setGeneratorForTest). Every model call still goes
// through the real complete() (cost cap, ledger, structured-output checks).
// A request the script has no answer for throws, so the test fails on it.
//
// Each request is appended, in brief, to the file PENSMITH_JOURNEY_LOG names:
// the step, the citekeys of the works it was shown, and its last user turn.
//
// Not a test file (the runner collects only *.test.ts).

import { appendFileSync } from 'node:fs';
import { _setGeneratorForTest } from '../../bin/lib/anthropic.js';
import type { GenerateRequest, GenerateResult } from '../../bin/lib/generator.js';
import { fencedBlocks } from './fence.js';

export type Step =
  | 'intake' | 'research' | 'evaluate' | 'outline' | 'plan' | 'write' | 'revise'
  | 'claim-support' | 'orphan-label' | 'other';

/** The top-level property names of the request's JSON Schema, sorted. */
function propsOf(req: GenerateRequest): string[] {
  const p = (req.jsonSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return p ? Object.keys(p).sort() : [];
}

/** Which step sent `req`: from its JSON Schema, else its prompt. */
export function stepOf(req: GenerateRequest): Step {
  const props = propsOf(req).join(',');
  const text = `${req.system}\n${req.messages.map((m) => m.content).join('\n')}`;
  if (props === 'questions,topic') return 'intake';
  if (props === 'verdicts' && /candidate/i.test(text)) return 'evaluate';
  if (/disambiguate a research topic/i.test(req.system)) return 'research';
  if (props === 'draft,gaps') return 'write';
  if (props === 'action,flagged_citekey,patch,rationale,replacement_citekey') return 'revise';
  // The advisory verifier passes (Pass 2 and Pass 4) send their prompt as the user turn.
  if (/^# Claim-Support Judge/m.test(text)) return 'claim-support';
  if (/^# Orphan-Label Classifier/m.test(text)) return 'orphan-label';
  if (props === 'sections,thesis,title') return 'outline';
  if (props === 'assigned_sources,brief,claims,voice') return 'plan';
  return 'other';
}

/** The works the request shows as fenced JSON (the library, a section's sources): citekey → title. */
export function worksShown(req: GenerateRequest): Map<string, string> {
  const out = new Map<string, string>();
  const text = `${req.system}\n${req.messages.map((m) => m.content).join('\n')}`;
  for (const block of fencedBlocks(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const w of parsed as Array<Record<string, unknown>>) {
      if (typeof w['citekey'] === 'string' && typeof w['title'] === 'string') out.set(w['citekey'], w['title']);
    }
  }
  return out;
}

/** The answer every test gives the advisory passes: supported, and not an orphan claim. */
export function advisoryAnswer(step: Step): unknown {
  if (step === 'claim-support') return { verdict: 'SUPPORTED', rationale: 'The cited work states this.', evidence: '' };
  if (step === 'orphan-label') return { label: 'definition' };
  return undefined;
}

/** Answer every model call with `answer(req, step)`, logging each request. */
export function installScriptedModel(answer: (req: GenerateRequest, step: Step) => unknown): void {
  _setGeneratorForTest({
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const step = stepOf(req);
      const file = process.env['PENSMITH_JOURNEY_LOG'];
      if (file) appendFileSync(file, `${JSON.stringify({ step, shown: [...worksShown(req).keys()], user: req.messages.at(-1)?.content ?? '' })}\n`);
      const a = advisoryAnswer(step) ?? answer(req, step);
      if (a === undefined) throw new Error(`scripted model: no answer for a ${step} request`);
      return {
        text: typeof a === 'string' ? a : JSON.stringify(a),
        model: req.model,
        stop: 'complete',
        stopReason: 'end_turn',
        usage: [{ model: req.model, inputTokens: 1000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 }],
      };
    },
  });
}
