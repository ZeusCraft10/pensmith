// bin/cli/doctor.ts
//
// D-13: doctor verb — calls runDoctor() and dispatches to render fn based on --json.
// D-15: exits 0 unless any probe severity is FAIL (then exits 1).
// D-16: human-first prose render; --json emits ProbeReport (D-18 locked shape).
// D-19: read-only — no .paper/ writes, no lock acquisition, no atomicWriteFile calls.

import { defineCommand } from 'citty';
import { runDoctor } from '../lib/doctor/probes.js';
import { renderTty, renderJson } from '../lib/doctor/render.js';
import { EXIT_ERROR } from '../lib/exit-codes.js';

export const doctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Ecosystem self-check.' },
  args: {
    json: { type: 'boolean', description: 'Emit JSON instead of TTY output.' },
  },
  async run({ args }) {
    const results = await runDoctor();
    const output = args.json ? renderJson(results) : renderTty(results);
    process.stdout.write(output + '\n');
    const failed = Object.values(results).some((r) => r.severity === 'FAIL');
    // D-15 / RUN-09: any FAIL probe exits EXIT_ERROR (1) — through the
    // dispatcher's result mapping, so stdout is flushed before the process ends.
    return failed ? { ok: false, exitCode: EXIT_ERROR } : { ok: true };
  },
});
