// tests/helpers/local-servers/mock-agent.ts — the one sanctioned undici MockAgent
// entry point for tests. Under RUN-29 the only undici / node:http / node:https
// import exemption under tests/ is tests/helpers/local-servers/**, so tests
// import MockAgent from here instead of from undici.
//
// Under the test runner, bin/lib/http.ts honours an installed global MockAgent
// (a documented test seam) but still applies the egress gate first: a test that
// intercepts a non-loopback host must set PENSMITH_NETWORK_TESTS=1 for its
// duration (the test-lane live seam, RUN-01/RUN-04).
//
// SEAM FILE (Phase 17 plan, verbatim V5). Every Phase 17 stream that needs it
// creates it byte-identically from .planning/phases/17-runtime/17-PLAN.md
// Appendix A. Do not edit it during Phase 17.

import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';

export { MockAgent };

export interface InstalledMockAgent {
  readonly agent: MockAgent;
  restore(): Promise<void>;
}

/** Install a MockAgent (net connect disabled) as the global dispatcher. */
export function installMockAgent(): InstalledMockAgent {
  const previous: Dispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return {
    agent,
    async restore(): Promise<void> {
      setGlobalDispatcher(previous);
      await agent.close();
    },
  };
}
