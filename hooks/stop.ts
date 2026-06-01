#!/usr/bin/env node
// hooks/stop.ts
//
// Claude Code Stop hook. Fires when the agent halts. Phase 2 ships as
// a no-op exit-0 stub. Phase 3+ writes a final HANDOFF.json snapshot
// so the user can resume cleanly with `pensmith resume`.

process.exit(0);
