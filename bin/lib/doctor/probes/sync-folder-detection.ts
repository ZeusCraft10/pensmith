// bin/lib/doctor/probes/sync-folder-detection.ts
//
// DOCT-04: Cloud sync folder detection probe.
// D-15 severity: WARN when paperDir() is inside a cloud-sync folder; PASS otherwise.
// D-17: path-substring match against OneDrive / iCloud / Dropbox / Google Drive patterns.
// D-19 read-only: paperDir() + isInsideSyncFolder() are pure path functions, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { detectSyncFolder } from '../../ecosystem-presence.js';

export const syncFolderDetectionProbe: Probe = {
  id: 'sync-folder-detection',
  async run(): Promise<ProbeResult> {
    // CR-01: share the detection algorithm with bin/lib/capabilities.ts via
    // ecosystem-presence.ts so both tiers agree on `onedrive_detected`.
    // WR-05: env-var is PENSMITH_PAPER_ROOT (canonical, matches mcp/server.ts
    // and the tier-contract test). The transitional PENSMITH_PAPER_DIR
    // fallback has been dropped.
    const { detected, dir } = detectSyncFolder();
    if (detected) {
      return {
        id: 'sync-folder-detection',
        severity: 'WARN',
        summary: `paperDir() ${dir} is inside a cloud-sync folder — locks and SQLite WALs may corrupt.`,
        fix: 'Move the paper project outside OneDrive/Dropbox/Google Drive/iCloud, or set PENSMITH_PAPER_ROOT to an unsynced path.',
      };
    }
    return {
      id: 'sync-folder-detection',
      severity: 'PASS',
      summary: `paperDir() ${dir} is not inside a known sync folder.`,
    };
  },
};
