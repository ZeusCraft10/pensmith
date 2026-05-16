// bin/cli/stubs.ts
//
// D-05: 15 of the 16 verbs are stubs in Phase 2. They register with citty
// exactly the same way as real verbs but print "not implemented yet" and
// exit 0. Phase 3+ replaces each one with a real implementation.

import { defineCommand } from 'citty';

export function makeStub(verb: string) {
  return defineCommand({
    meta: {
      name: verb,
      description: `(Phase 2 stub) ${verb} — not implemented yet`,
    },
    run() {
      process.stdout.write(`pensmith ${verb}: not implemented yet\n`);
      // exit 0 is the citty default when run() returns normally.
    },
  });
}
