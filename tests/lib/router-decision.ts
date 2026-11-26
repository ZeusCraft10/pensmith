// tests/lib/router-decision.ts — a router decision without its reason, for
// tests that compare the step itself.
//
// Not a test file (the runner collects only *.test.ts).

import assert from 'node:assert/strict';
import type { RouterDecision } from '../../bin/lib/router.js';

/** `decision` without `why`, after checking that it gives one. */
export function withoutWhy(decision: RouterDecision): Record<string, unknown> {
  const { why, ...rest } = decision as RouterDecision & { why?: unknown };
  assert.equal(typeof why, 'string', `every router decision carries a reason; got ${JSON.stringify(decision)}`);
  return rest;
}
