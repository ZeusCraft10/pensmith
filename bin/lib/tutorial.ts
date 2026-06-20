// bin/lib/tutorial.ts — Phase 9 educator/tutorial-mode subscriber (ERGO-07).
//
// === Wave 0 (Plan 09-00) STUB ===
// This file currently ships only the TYPE surface + a CLASS SHELL. The real
// rendering — turning research.done / section.written events into a TUTORIAL.md
// of per-claim provenance — lands in Wave 1 (Plan 09-02). The Wave-0 RED suites
// (tests/tutorial-observer.test.ts, tests/tutorial-provenance.test.ts) are
// RED-by-skip on a SOURCE-GREP of this file, so they stay skipped until 09-02
// wires the body. The stub MUST compile under `tsc --noEmit`.
//
// DESIGN INVARIANT (load-bearing — H1 / zero-branch): the TutorialSubscriber is
// the SOLE goal-aware component. NO other file in bin/lib/** (router.ts in
// particular) reads `goal` / `learning` / `educator_mode`. The goal-aware CLI
// caller instantiates this subscriber ONLY for goal ∈ {learning, both}; the rest
// of Foundation stays goal-UNAWARE. tests/lint-tutorial-no-branch.test.ts scans
// every bin/lib/**/*.ts (EXCLUDING ONLY this file) + workflows/**/*.md for those
// tokens and asserts ZERO matches.
//
// Imports are deliberately minimal: node:events (subscriber base), node:path
// (TUTORIAL.md path join), ./atomic-write.js (the D-07 write chokepoint Wave 1
// flushes through). It does NOT import ./pii.js — the subscriber handles only
// post-redaction scholarly metadata (citekeys + claims), never raw PII.

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';

/**
 * The educator-mode goal. Only `learning` and `both` activate a subscriber;
 * `draft` (the default) never constructs one — that asymmetry is what keeps the
 * rest of Foundation goal-unaware.
 */
export type TutorialGoal = 'learning' | 'both';

/**
 * Lifecycle events the subscriber observes. `research.done` fires at the
 * research hard-stop (learning mode produces per-claim provenance HERE, before
 * any section is written); `section.written` fires per section (both mode adds
 * section-level provenance); the remaining kinds are observed for completeness.
 */
export type TutorialEventKind =
  | 'research.done'
  | 'outline.done'
  | 'section.written'
  | 'section.verified'
  | 'compile.done';

/**
 * A single observed event. `payload` is an opaque, ALREADY-REDACTED metadata
 * bag (citekeys, claims, section identifiers) — never raw user PII. Wave 1
 * narrows per-kind payload shapes.
 */
export interface TutorialEvent {
  kind: TutorialEventKind;
  payload: unknown;
}

export interface TutorialSubscriberOptions {
  /** Absolute path to the TUTORIAL.md this subscriber renders into. */
  tutorialPath: string;
  /** The activating goal — only set for learning/both (never draft). */
  goal: TutorialGoal;
}

/**
 * Observes lifecycle events and (in Wave 1) renders a TUTORIAL.md learning
 * artifact. STUB BODY: emit enqueues a no-op onto an internal chain; flush
 * awaits the resolved chain. Wave 1 (09-02) replaces the bodies with the real
 * per-claim provenance rendering through atomicWriteFile.
 */
export class TutorialSubscriber {
  readonly tutorialPath: string;
  readonly goal: TutorialGoal;

  // Internal never-throw write chain (mirrors session-log.ts enqueue pattern):
  // every emit() appends work as BOTH fulfil + reject handlers so a prior
  // rejection never breaks the chain. flush() awaits it.
  #chain: Promise<void> = Promise.resolve();
  #emitter = new EventEmitter();

  constructor(opts: TutorialSubscriberOptions) {
    this.tutorialPath = opts.tutorialPath;
    this.goal = opts.goal;
    // Wave 0: the emitter is wired but no listener renders yet. Wave 1 attaches
    // the per-kind render handlers here.
    this.#emitter.setMaxListeners(0);
  }

  /**
   * Record a lifecycle event. NEVER THROWS — a malformed payload is swallowed
   * onto the chain so the observer can never break the verb it observes.
   * STUB: enqueues a no-op. Wave 1 enqueues the real render.
   */
  emit(event: TutorialEvent): void {
    this.#chain = this.#chain.then(
      async () => {
        // Wave 0 no-op. The reference below keeps `event` + path import live so
        // the stub typechecks without an unused-binding error; it performs no
        // I/O and produces no TUTORIAL.md (the goal=draft zero-activation
        // contract is satisfied by NOT constructing this class at all).
        void event;
        void path;
        void atomicWriteFile;
      },
      () => {
        /* swallow — never-throw chain */
      },
    );
  }

  /**
   * Drain the internal write chain. STUB: awaits the resolved chain (resolves
   * immediately when nothing was enqueued). Wave 1 flushes the accumulated
   * TUTORIAL.md through atomicWriteFile here.
   */
  async flush(): Promise<void> {
    await this.#chain;
  }
}

export default TutorialSubscriber;
