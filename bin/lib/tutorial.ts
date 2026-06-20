// bin/lib/tutorial.ts — Phase 9 educator/tutorial-mode subscriber (ERGO-07).
//
// === Wave 1 (Plan 09-02) — full render ===
// The TutorialSubscriber observes lifecycle events and renders a TUTORIAL.md
// learning artifact: per-claim source provenance at BOTH the RESEARCH stage
// (goal=learning — the hard-stop end-state, before any section exists; closes
// the H2 contradiction) AND the SECTION stage (goal=both — per-section source
// provenance from the section's assigned_sources). The remaining lifecycle
// kinds (outline.done / section.verified / compile.done) append a thinner
// labeled block through the same path.
//
// DESIGN INVARIANT (load-bearing — H1 / zero-branch): the TutorialSubscriber is
// the SOLE goal-aware component. NO other file in bin/lib/** (router.ts in
// particular) reads `goal` / `learning` / `educator_mode`. The goal-aware CLI
// caller instantiates this subscriber ONLY for goal ∈ {learning, both}; the rest
// of Foundation stays goal-UNAWARE. tests/lint-tutorial-no-branch.test.ts scans
// every bin/lib/**/*.ts (EXCLUDING ONLY this file) + workflows/**/*.md for those
// tokens and asserts ZERO matches.
//
// IDEMPOTENCE (cycle-2 MEDIUM): the render is OVERWRITE, not blind append. Each
// emit() updates an ordered in-memory block map (keyed by a stable per-event
// identity) and rewrites the WHOLE TUTORIAL.md via atomicWriteFile. Re-emitting
// the same event overwrites its block rather than duplicating it, so re-running
// produces byte-stable TUTORIAL.md content. Distinct events still accumulate in
// emission order (the Map preserves insertion order).
//
// CONFINEMENT (Pitfall 2 / T-09-02-02): the subscriber writes ONLY to its
// tutorialPath. It NEVER touches .paper/sections/ or DRAFT.md, and its rendered
// markdown NEVER contains a `.paper/sections/` path string (provenance is
// rendered from citekeys + claims, not file paths).
//
// Imports are deliberately minimal: node:events (subscriber base), node:path
// (kept for the TUTORIAL.md path discipline), ./atomic-write.js (the D-07 write
// chokepoint — atomicWriteFile, never raw fs.writeFile). It does NOT import
// ./pii.js — the subscriber handles only post-redaction scholarly metadata
// (citekeys + claims), never raw PII.

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
 * bag (citekeys, claims, section identifiers) — never raw user PII.
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

// ---------------------------------------------------------------------------
// Payload shapes (narrowed defensively — every reader tolerates a malformed
// bag and renders nothing rather than throwing).
// ---------------------------------------------------------------------------

/** One curated source in a research.done payload. */
interface ResearchSource {
  citekey?: unknown;
  supportedClaim?: unknown;
  title?: unknown;
  year?: unknown;
}

/** A per-claim mapping entry (the fixture's separate `claims` array form). */
interface ClaimEntry {
  citekey?: unknown;
  claim?: unknown;
}

// ---------------------------------------------------------------------------
// Defensive coercion helpers — never throw on a malformed value.
// ---------------------------------------------------------------------------

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Collapse internal whitespace (claims span fixture lines) into one line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Observes lifecycle events and renders a TUTORIAL.md learning artifact.
 *
 * Render model: each observed event maps to ONE block keyed by a stable
 * identity. Blocks live in an insertion-ordered Map; every render rewrites the
 * full document via atomicWriteFile. This makes re-emission idempotent
 * (same key ⇒ overwrite) while preserving emission order across distinct events.
 */
export class TutorialSubscriber {
  readonly tutorialPath: string;
  readonly goal: TutorialGoal;

  // Ordered block store: key → rendered markdown block. Insertion order is the
  // emission order; re-emitting the same key overwrites in place (idempotence).
  #blocks = new Map<string, string>();

  // Internal never-throw write chain (mirrors session-log.ts enqueue pattern):
  // every emit() appends work as BOTH fulfil + reject handlers so a prior
  // rejection never breaks the chain. flush() awaits it.
  #chain: Promise<void> = Promise.resolve();
  #emitter = new EventEmitter();

  constructor(opts: TutorialSubscriberOptions) {
    this.tutorialPath = opts.tutorialPath;
    this.goal = opts.goal;
    this.#emitter.setMaxListeners(0);
    this.#wire();
  }

  /**
   * Attach the per-kind render handlers. Each handler computes a (key, block)
   * pair and enqueues a full-document rewrite. A handler that produces no block
   * (malformed payload, empty data) enqueues nothing — never throws.
   */
  #wire(): void {
    this.#emitter.on('research.done', (payload: unknown) =>
      this.#emitResearchProvenance(payload),
    );
    this.#emitter.on('section.written', (payload: unknown) =>
      this.#emitSectionProvenance(payload),
    );
    this.#emitter.on('outline.done', (payload: unknown) =>
      this.#emitLabeled('outline.done', '## Outline — Paper Structure', payload, (p) => {
        const n = asArray(asRecord(p).sections).length;
        return n > 0
          ? `The outline organizes the paper into ${n} section(s). Each section is planned and drafted independently.`
          : 'The outline organizes the paper into independently-planned sections.';
      }),
    );
    this.#emitter.on('section.verified', (payload: unknown) =>
      this.#emitLabeled('section.verified', '## Section Verification — Citation Walkthrough', payload, (p) => {
        const rec = asRecord(p);
        const n = rec.n;
        const verdict = asString(rec.verdict) || 'reviewed';
        return `Section ${typeof n === 'number' ? n : ''} citations were ${verdict} by the verifier (no fabricated or mis-cited sources escape a section).`;
      }),
    );
    this.#emitter.on('compile.done', (payload: unknown) =>
      this.#emitLabeled('compile.done', '## Compile — Transition', payload, () =>
        'All verified sections were compiled into the final draft.',
      ),
    );
  }

  /**
   * Record a lifecycle event. NEVER THROWS — the EventEmitter dispatch and the
   * enqueued render are both wrapped so a malformed payload (or a render error)
   * is swallowed and the observed verb is never disrupted.
   */
  emit(event: TutorialEvent): void {
    try {
      this.#emitter.emit(event?.kind, event?.payload);
    } catch {
      /* swallow — never-throw observer contract (mirror makeLogger.emit) */
    }
  }

  // -------------------------------------------------------------------------
  // RESEARCH-stage render (H2 fix) — the learning-mode END-STATE.
  //
  // payload may carry EITHER:
  //   - sources: Array<{ citekey, supportedClaim, title?, year? }>  (plan shape)
  //   - sources: SourceCandidate[] + claims: Array<{ citekey, claim }>
  //     (the fixture shape — claim text lives in a sibling `claims` array)
  // Both are merged: each source's supportedClaim is taken from its own field
  // OR from the matching `claims` entry by citekey. Renders ONE per-claim line
  // per source naming the citekey AND its supported claim. NO section needed.
  // -------------------------------------------------------------------------
  #emitResearchProvenance(payload: unknown): void {
    const rec = asRecord(payload);
    const sources = asArray(rec.sources) as ResearchSource[];
    const claims = asArray(rec.claims) as ClaimEntry[];

    // citekey → claim text, from the sibling `claims` array (fixture shape).
    const claimByKey = new Map<string, string>();
    for (const c of claims) {
      const key = asString(c?.citekey);
      const claim = oneLine(asString(c?.claim));
      if (key && claim) claimByKey.set(key, claim);
    }

    const lines: string[] = [];
    for (const s of sources) {
      const citekey = asString(s?.citekey);
      if (!citekey) continue;
      const claim = oneLine(asString(s?.supportedClaim)) || claimByKey.get(citekey) || '';
      const title = oneLine(asString(s?.title));
      const year = typeof s?.year === 'number' ? s.year : undefined;
      const titleSuffix = title
        ? ` (${title}${year ? `, ${year}` : ''})`
        : year
          ? ` (${year})`
          : '';
      if (claim) {
        lines.push(`- **${citekey}** supports ${claim}${titleSuffix}`);
      } else {
        lines.push(`- **${citekey}** was selected as a supporting source${titleSuffix}`);
      }
    }

    if (lines.length === 0) return; // malformed / empty — render nothing.

    const block = [
      '## Research Provenance — Why Each Source Was Selected',
      '',
      'Before drafting, each curated source is mapped to the specific claim it supports.',
      '',
      ...lines,
      '',
    ].join('\n');

    this.#enqueueRender('research.done', block);
  }

  // -------------------------------------------------------------------------
  // SECTION-stage render (goal=both) — per-section source provenance.
  //
  // payload: { n, slug, assignedSources: string[] }. Renders a
  // `## Section N — slug: Source Provenance` block with one teaching line per
  // assigned citekey. Renders from citekeys ONLY — never re-reads DRAFT.md and
  // never emits a `.paper/sections/` path.
  // -------------------------------------------------------------------------
  #emitSectionProvenance(payload: unknown): void {
    const rec = asRecord(payload);
    const n = typeof rec.n === 'number' ? rec.n : undefined;
    const slug = asString(rec.slug);
    const assigned = asArray(rec.assignedSources)
      .map((c) => asString(c))
      .filter((c) => c.length > 0);

    if (n === undefined && slug === '' && assigned.length === 0) return; // malformed.

    const header = `## Section ${n ?? ''}${slug ? ` — ${slug}` : ''}: Source Provenance`;
    const lines =
      assigned.length > 0
        ? assigned.map(
            (citekey) =>
              `- Why **${citekey}** was assigned here: it supplies evidence this section relies on.`,
          )
        : ['- No sources were assigned to this section.'];

    const block = [
      header,
      '',
      'These sources were assigned to this section during planning:',
      '',
      ...lines,
      '',
    ].join('\n');

    // Key per section so re-writing a section overwrites (idempotent), and
    // distinct sections accumulate in emission order.
    this.#enqueueRender(`section.written:${n ?? slug}`, block);
  }

  /**
   * Shared renderer for the thinner lifecycle kinds (outline/verified/compile).
   * `body(payload)` produces the prose line; an empty body skips the block.
   */
  #emitLabeled(
    key: string,
    header: string,
    payload: unknown,
    body: (payload: unknown) => string,
  ): void {
    let line = '';
    try {
      line = oneLine(body(payload));
    } catch {
      line = '';
    }
    if (!line) return;
    const blockKey = key === 'section.verified'
      ? `section.verified:${typeof asRecord(payload).n === 'number' ? asRecord(payload).n : ''}`
      : key;
    this.#enqueueRender(blockKey, [header, '', line, ''].join('\n'));
  }

  /**
   * Store/overwrite a block by key, then enqueue a FULL-document rewrite onto
   * the never-throw chain. The rewrite reads the current ordered block map at
   * flush time, so the on-disk TUTORIAL.md always reflects every block emitted
   * so far — overwrite, never append-duplicate (idempotence).
   */
  #enqueueRender(key: string, block: string): void {
    // Strip any accidental section-path leak before storing (defense in depth —
    // confinement contract: TUTORIAL.md never names a .paper/sections/ path).
    const safe = block.replace(/\.paper[\\/]sections[\\/]\S*/g, '[section]');
    this.#blocks.set(key, safe);
    this.#chain = this.#chain.then(
      () => this.#writeDocument(),
      () => this.#writeDocument(),
    );
  }

  /** Render the full ordered document and atomically overwrite TUTORIAL.md. */
  async #writeDocument(): Promise<void> {
    try {
      const body = ['# Tutorial — How This Paper Was Built', '', ...this.#blocks.values()].join('\n');
      // path import kept live + intentional: the caller supplies an absolute
      // tutorialPath; we never re-derive a section path here.
      void path;
      await atomicWriteFile(this.tutorialPath, body.endsWith('\n') ? body : body + '\n');
    } catch {
      /* swallow — observer must never break the verb it observes */
    }
  }

  /**
   * Drain the internal write chain — the CLI verb awaits this before exiting so
   * TUTORIAL.md is complete. Resolves immediately when nothing was enqueued.
   */
  async flush(): Promise<void> {
    await this.#chain;
  }
}

export default TutorialSubscriber;
