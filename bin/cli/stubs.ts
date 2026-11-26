// bin/cli/stubs.ts
//
// The placeholder for a verb in bin/lib/verbs.ts that has no loader in
// bin/pensmith.ts REAL_VERB_LOADERS: it registers with citty like a real verb,
// prints "not implemented yet" and exits 0. Every verb has a loader today.

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
