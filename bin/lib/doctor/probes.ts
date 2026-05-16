// bin/lib/doctor/probes.ts
//
// D-15: 10 probes in Phase 2 — build-artifact-resolves is the Phase-2 substitute
//       for the deferred DOCT-05 vertical slice (per CONTEXT D-04 + B4 user
//       decision iter 2). http-crossref-ping covers D-03(d) cassette wiring.
//       DOCT-06 tier-equivalence lands in 02-07.
// D-19: probes are READ-ONLY. No fs.writeFile, no atomicWriteFile, no withLock calls.
//       Tests assert no .paper/ files appear after runDoctor() runs against a clean tmp dir.
// D-20: returns Record<string, ProbeResult> keyed by probe.id (NOT an array).

export type Severity = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

export interface ProbeResult {
  id: string;
  severity: Severity;
  summary: string;
  detail?: string;
  fix?: string;
}

export interface Probe {
  id: string;
  run(): Promise<ProbeResult>;
}

import { nodeVersionProbe } from './probes/node-version.js';
import { mcpSdkPresenceProbe } from './probes/mcp-sdk-presence.js';
import { zoteroMcpPresenceProbe } from './probes/zotero-mcp-presence.js';
import { pandocPresenceProbe } from './probes/pandoc-presence.js';
import { humanizerSkillPresenceProbe } from './probes/humanizer-skill-presence.js';
import { contactEmailPresenceProbe } from './probes/contact-email-presence.js';
import { syncFolderDetectionProbe } from './probes/sync-folder-detection.js';
import { runtimeConfigPresenceProbe } from './probes/runtime-config-presence.js';
import { buildArtifactResolvesProbe } from './probes/build-artifact-resolves.js';
import { httpCrossrefPingProbe } from './probes/http-crossref-ping.js';

export function defaultProbes(): Probe[] {
  return [
    nodeVersionProbe,
    mcpSdkPresenceProbe,
    zoteroMcpPresenceProbe,
    pandocPresenceProbe,
    humanizerSkillPresenceProbe,
    contactEmailPresenceProbe,
    syncFolderDetectionProbe,
    runtimeConfigPresenceProbe,
    buildArtifactResolvesProbe,
    httpCrossrefPingProbe,
  ];
}

export async function runDoctor(probes: Probe[] = defaultProbes()): Promise<Record<string, ProbeResult>> {
  const settled = await Promise.allSettled(probes.map((p) => p.run()));
  const out: Record<string, ProbeResult> = {};
  for (let i = 0; i < probes.length; i += 1) {
    const probe = probes[i];
    const result = settled[i];
    if (!probe) continue;
    if (!result) continue;
    if (result.status === 'fulfilled') {
      out[probe.id] = result.value;
    } else {
      out[probe.id] = {
        id: probe.id,
        severity: 'FAIL',
        summary: `probe ${probe.id} crashed`,
        detail: String(result.reason),
      };
    }
  }
  return out;
}
