#!/usr/bin/env node
// hooks/session-start.ts
//
// Claude Code SessionStart hook. Phase 2 ships as a no-op exit-0 stub.
// Phase 3+ wires session-load behavior (read .paper/STATE.json, emit a
// summary to the agent's first turn via stderr).
//
// CRITICAL: stdout is the hook-protocol channel (in Claude Code's hook
// contract). NEVER console.log here. Diagnostics go to stderr.

process.exit(0);
