// bin/lib/doctor/render.ts
//
// D-18: TTY copy + JSON shape locked in references/doctor-output.md.
//       Render output MUST match that file. Tests assert the JSON shape.
// D-19: read-only — no .paper/ writes, no atomicWriteFile, no withLock calls.

import type { ProbeResult, Severity } from './probes.js';

const ICONS: Record<Severity, string> = {
  PASS: '✓',
  WARN: '!',
  FAIL: '✗',
  SKIP: '—',
};

export function renderTty(results: Record<string, ProbeResult>): string {
  const lines: string[] = ['Pensmith doctor:', ''];
  let pass = 0, warn = 0, fail = 0, skip = 0;
  for (const r of Object.values(results)) {
    const icon = ICONS[r.severity];
    lines.push(`  ${icon} [${r.severity}] ${r.id}: ${r.summary}`);
    if (r.detail) lines.push(`      ${r.detail}`);
    if (r.fix) lines.push(`      fix: ${r.fix}`);
    if (r.severity === 'PASS') pass += 1;
    else if (r.severity === 'WARN') warn += 1;
    else if (r.severity === 'FAIL') fail += 1;
    else skip += 1;
  }
  lines.push('');
  lines.push(`Doctor: ${pass} PASS, ${warn} WARN, ${fail} FAIL, ${skip} SKIP`);
  return lines.join('\n');
}

export function renderJson(results: Record<string, ProbeResult>): string {
  let pass = 0, warn = 0, fail = 0, skip = 0;
  for (const r of Object.values(results)) {
    if (r.severity === 'PASS') pass += 1;
    else if (r.severity === 'WARN') warn += 1;
    else if (r.severity === 'FAIL') fail += 1;
    else skip += 1;
  }
  const payload = {
    schemaVersion: 1,
    probes: results,
    summary: { pass, warn, fail, skip },
  };
  return JSON.stringify(payload, null, 2);
}
