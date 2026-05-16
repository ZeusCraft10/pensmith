// bin/lib/doctor/probes/sync-folder-detection.ts
//
// DOCT-04: Cloud sync folder detection probe.
// D-15 severity: WARN when paperDir() is inside a cloud-sync folder; PASS otherwise.
// D-17: path-substring match against OneDrive / iCloud / Dropbox / Google Drive patterns.
// D-19 read-only: paperDir() + isInsideSyncFolder() are pure path functions, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { paperDir, isInsideSyncFolder } from '../../paths.js';

export const syncFolderDetectionProbe: Probe = {
  id: 'sync-folder-detection',
  async run(): Promise<ProbeResult> {
    // PENSMITH_PAPER_DIR env-var override for testability (D-17).
    // In production, paperDir() resolves from process.cwd().
    const dir = process.env.PENSMITH_PAPER_DIR ?? paperDir();
    if (isInsideSyncFolder(dir)) {
      return {
        id: 'sync-folder-detection',
        severity: 'WARN',
        summary: `paperDir() ${dir} is inside a cloud-sync folder — locks and SQLite WALs may corrupt.`,
        fix: 'Move the paper project outside OneDrive/Dropbox/Google Drive/iCloud, or set PENSMITH_PAPER_DIR to an unsynced path.',
      };
    }
    return {
      id: 'sync-folder-detection',
      severity: 'PASS',
      summary: `paperDir() ${dir} is not inside a known sync folder.`,
    };
  },
};
