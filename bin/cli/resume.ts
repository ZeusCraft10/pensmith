// bin/cli/resume.ts — `pensmith resume` verb entrypoint (UX-02, HOOK-02 Tier-2).
//
// THIN ORCHESTRATOR + H4 LIFECYCLE: `resume` reads HANDOFF.json for the resume
// SUMMARY only, then runs ONE routed step through the SHARED runRouted helper
// of bin/pensmith.ts — the step a bare `pensmith` runs (GRND-18, D-18-28):
// resolveNextAction() (which IGNORES HANDOFF and NEVER returns 'resume') picks
// the work verb, a section's step is plan → write → verify, and every verb is
// dispatched with the global flags forwarded (≥ yolo so a resolved compile/done
// skips its OWN approval gate, C3-HIGH-2); under --dry-run it loops (D-18-30).
// It then CLEARS HANDOFF.json (best-effort rmSync) so a stale pointer cannot
// re-trigger resume. resume MUST NEVER dispatch to itself — no resume→resume
// loop (H4).
//
// stdout-only for the underlying verbs; the resume summary and the step
// summary go to STDERR (parity).
//
// `resume --replay <entryId>` (RUN-17, D-17-30) is a flag on this verb, not a
// new verb: it finds the kind:"llm" record `<entryId>` in .paper/SESSION.log,
// re-dispatches its verb — for plan/write/verify only the logged section — with
// the options that session logged, and — when sources are offline
// (PENSMITH_OFFLINE=1) — serves every logged model response matched by (slug,
// sha256 of the request body), so the artifact is reproduced exactly with no
// provider call. A replay never inherits the logged --yolo: only
// `resume --replay <id> --yolo` skips the replayed verb's approval gates. A log
// written with `[logging] session_bodies = "redacted"` is reported as not
// replayable.

import { defineCommand, runCommand } from 'citty';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir, projectRoot } from '../lib/paths.js';
import { HandoffSchema, type Handoff } from '../lib/schemas/handoff.js';
import { runRouted, REAL_VERB_LOADERS } from '../pensmith.js';
import { UX02_VERBS, type Ux02Verb } from '../lib/verbs.js';
import { isOfflineMode } from '../lib/http-mock.js';
import { getRuntimeOverride, runtimeFlagsFromArgv, setRuntimeOverride } from '../lib/runtime.js';
import {
  activateReplay,
  deactivateReplay,
  isReplayable,
  loggedArgv,
  readLlmRecords,
  ReplayError,
} from '../lib/replay.js';

/**
 * Global switches that never belong to a replayed verb's own argv. `--yolo` is
 * among them: a replay never inherits the logged run's approval-gate skip (a
 * SESSION.log sits in `.paper/`, which may be synced or cloned — S-18). Only
 * the replaying invocation's own `--yolo` reaches the verb, so every gate runs
 * through runGate exactly as in a live run (RUN-28).
 */
const REPLAY_DROPPED_FLAGS = new Set(['--estimate', '--show-prompts', '--dry-run', '--yolo', '--no-yolo']);
/**
 * Value-taking flags stripped WITH their value: the global --paper / --runtime
 * / --model (the dispatcher consumes them, a verb never sees them — --runtime
 * and --model are re-applied through setRuntimeOverride instead) and --replay.
 */
const REPLAY_DROPPED_VALUE_FLAGS = new Set(['--paper', '--runtime', '--model', '--replay']);

/** The logged argv minus the flags a replayed verb must not receive (see above). */
function verbTokens(logged: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < logged.length; i += 1) {
    const tok = logged[i] ?? '';
    if (tok === '--') {
      out.push(...logged.slice(i));
      break;
    }
    const name = tok.includes('=') ? tok.slice(0, tok.indexOf('=')) : tok;
    if (REPLAY_DROPPED_VALUE_FLAGS.has(name)) {
      if (!tok.includes('=')) i += 1;
      continue;
    }
    if (REPLAY_DROPPED_FLAGS.has(name)) continue;
    out.push(tok);
  }
  return out;
}

/** Verbs whose positional is a section number: a replay runs only the logged section. */
const SECTION_VERBS: ReadonlySet<string> = new Set(['plan', 'write', 'verify']);

/** Option name → whether it takes a value, for the verb's own flags (citty args). */
async function optionShape(cmd: { args?: unknown }): Promise<Map<string, boolean>> {
  const raw = typeof cmd.args === 'function' ? await (cmd.args as () => unknown)() : cmd.args;
  const defs = (raw ?? {}) as Record<string, { type?: string }>;
  const shape = new Map<string, boolean>();
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === 'positional') continue;
    const takesValue = def.type === 'string' || def.type === 'enum';
    shape.set(name, takesValue);
    shape.set(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), takesValue);
  }
  return shape;
}

/** The option tokens of `tokens` (each with its value), positionals dropped. */
function optionTokens(tokens: readonly string[], shape: ReadonlyMap<string, boolean>): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i] ?? '';
    if (tok === '--') break;
    if (!tok.startsWith('-')) continue;
    out.push(tok);
    const name = tok.replace(/^-+/, '').split('=')[0] ?? '';
    if (!tok.includes('=') && shape.get(name) === true && tokens[i + 1] !== undefined) {
      out.push(tokens[i + 1] as string);
      i += 1;
    }
  }
  return out;
}

/**
 * The argv to re-dispatch `verb` with. A per-section verb replays ONLY the
 * logged section (a record from a wave `write` re-drafts that one section, not
 * the wave) with the logged invocation's own options; any other verb gets the
 * logged tokens after the verb. A bare-router chain logged no verb-specific
 * options, so it replays the section alone. `--yolo` comes only from the
 * replaying invocation (see REPLAY_DROPPED_FLAGS).
 */
function replayArgs(
  verb: string,
  section: number | undefined,
  logged: string[] | null,
  shape: ReadonlyMap<string, boolean>,
  yolo: boolean,
): string[] {
  const argv = verbTokens(logged ?? []);
  const idx = argv.indexOf(verb);
  const hasSection = section !== undefined && section > 0;
  let out: string[];
  if (idx < 0) out = hasSection ? [String(section)] : [];
  else if (SECTION_VERBS.has(verb) && hasSection) out = [String(section), ...optionTokens(argv.slice(idx + 1), shape)];
  else out = argv.slice(idx + 1);
  if (yolo) out.push('--yolo');
  return out;
}

async function runReplay(paperRoot: string, entryId: string, yolo: boolean): Promise<unknown> {
  const records = readLlmRecords(paperRoot);
  const rec = records.find((r) => r.id === entryId);
  if (!rec) throw new ReplayError(`replay: no SESSION.log model-call record with id ${entryId} in ${join(paperDir(paperRoot), 'SESSION.log')}`);
  if (!isReplayable(rec)) {
    throw new ReplayError(
      `replay: ${entryId} is not replayable — its bodies were not stored ` +
        '([logging] session_bodies = "redacted" keeps only hashes, token counts, cost and previews)',
    );
  }
  const verb = rec.verb;
  if (!verb || !(UX02_VERBS as readonly string[]).includes(verb)) {
    throw new ReplayError(`replay: ${entryId} names no dispatchable verb (${verb ?? 'none'})`);
  }
  const loader = REAL_VERB_LOADERS[verb as Ux02Verb];
  if (!loader) throw new ReplayError(`replay: verb ${verb} has no implementation to re-dispatch`);
  const logged = loggedArgv(paperRoot, rec.run_id);
  const cmd = await loader();
  const rawArgs = replayArgs(verb, rec.section, logged, await optionShape(cmd), yolo);
  // The logged run's --runtime / --model chose the provider and model its
  // requests were built for; re-apply them so the replayed request is the same
  // request (same body hash) — otherwise every step run with --model would
  // "miss" as if its inputs had changed.
  const loggedRuntime = runtimeFlagsFromArgv(logged ?? []);
  if (loggedRuntime.provider !== undefined || loggedRuntime.model !== undefined) {
    setRuntimeOverride({ ...getRuntimeOverride(), ...loggedRuntime });
  }
  const offline = isOfflineMode();
  process.stderr.write(
    `pensmith resume: replaying ${entryId} → ${verb} ${rawArgs.join(' ')}`.trimEnd() +
      (offline ? ' (sources offline: serving the logged model responses)\n' : ' (online: calling the model again)\n'),
  );
  if (offline) activateReplay(records);
  try {
    return await runCommand(cmd, { rawArgs });
  } finally {
    deactivateReplay();
  }
}

function safeReadHandoff(paperRoot: string): Handoff | null {
  const handoffPath = join(paperDir(paperRoot), 'HANDOFF.json');
  if (!existsSync(handoffPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(handoffPath, 'utf8'));
    const r = HandoffSchema.safeParse(raw);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const resumeCommand = defineCommand({
  meta: {
    name: 'resume',
    description: 'Resume the active paper: summarize the last handoff and run the next work verb.',
  },
  args: {
    'dry-run': { type: 'boolean', description: 'Zero external API calls.', default: false },
    estimate: { type: 'boolean', description: 'Project cost; do not execute.', default: false },
    yolo: { type: 'boolean', description: 'Skip approval gates.', default: false },
    'show-prompts': { type: 'boolean', description: 'Echo every LLM prompt to stderr.', default: false },
    replay: {
      type: 'string',
      description: 'Re-run the step that logged this SESSION.log entry id (offline: serve the logged model responses).',
    },
  },
  async run({ args }) {
    const paperRoot = projectRoot();

    if (typeof args.replay === 'string' && args.replay.length > 0) {
      return runReplay(paperRoot, args.replay, args.yolo === true);
    }

    // SUMMARY only — reading HANDOFF does NOT route (H4). safeParse never throws.
    const handoff = safeReadHandoff(paperRoot);
    if (handoff && handoff.phase !== 'done') {
      process.stderr.write(
        `pensmith resume: last at phase='${handoff.phase}', section='${handoff.current_section ?? 'none'}'. ` +
          `Next: ${handoff.next_action}\n`,
      );
    }

    // ONE routed step through the HANDOFF-BLIND resolver — the same step a bare
    // `pensmith` runs (GRND-18, D-18-28): a section's plan → write → verify,
    // any other decision its one verb (plan/write/verify/compile/done or a
    // status terminus, NEVER 'resume'); under --dry-run the loop (D-18-30). The
    // learning hard-stop (goal-aware tier) is handled inside the step.
    try {
      return await runRouted({
        globalFlags: {
          yolo: args.yolo === true,
          dryRun: args['dry-run'] === true || process.env['PENSMITH_DRY_RUN'] === '1',
          estimate: args.estimate === true,
          showPrompts: args['show-prompts'] === true,
        },
        announce: (decision) => {
          process.stderr.write(`pensmith resume: → ${decision.verb}\n`);
        },
      });
    } finally {
      // CONSUME the HANDOFF: best-effort delete so a stale pointer can never
      // re-trigger resume on the next bare invocation (H4 lifecycle) — also
      // after a failed step: the next resume starts from the router again.
      try {
        rmSync(join(paperDir(paperRoot), 'HANDOFF.json'), { force: true });
      } catch {
        /* best-effort consume */
      }
    }
  },
});

export default resumeCommand;
