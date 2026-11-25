// tests/nl-triggers.test.ts — Phase 7 Wave 0 RED scaffold for UX-05.
//
// Inline conversational corrections must map to the EXISTING locked-16 verbs and
// must NEVER introduce a 17th verb. Per Phase 4 (04-04): revise ships via
// `plan --revise` (a flag on the existing `plan` verb), NOT a 17th verb — the
// locked-16 bijection is preserved.
//
// The plugin's one skill (plugin/skills/pensmith/SKILL.md) may only send
// Claude to commands that exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UX02_VERBS } from '../bin/lib/verbs.js';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

const SKILL_FILES = [repoPath('plugin/skills/pensmith/SKILL.md')];

const VERB_SET = new Set<string>(UX02_VERBS as readonly string[]);

// === UX-05 / T-07-02: the verb list is exactly UX-02's 16 plus `ack` ===
// Un-skipped: this invariant survives implementation and is the standing guard
// that adding the skills/plumbing namespace did NOT introduce a 17th verb.
test('UX-05 / T-07-02: UX02_VERBS.length === 17 (UX-02\'s 16 plus ack; no other verb introduced)', () => {
  assert.equal(UX02_VERBS.length, 17, 'T-07-02: the verb list must stay at exactly 17 verbs (UX-02\'s 16 plus ack)');
  assert.ok((UX02_VERBS as readonly string[]).includes('ack'), 'the 17th verb is ack');
});

// === UX-05: revise / swap-source / redo route to the EXISTING `plan` verb ===
// Per 04-04 the revise correction is `plan --revise`, NOT a 17th verb. So the
// target verb for these corrections must be the existing `plan` (and `write`),
// both members of the locked 16.
test('UX-05: inline corrections (revise / swap-source / redo) map to the existing plan/write verbs (no new verb)', () => {
  // The correction → verb map the skill bodies implement (per 04-04 + PRD §5.4).
  const correctionTargets: Record<string, string> = {
    'revise': 'plan',        // `plan --revise`
    'swap source': 'plan',   // re-plan the section's source assignment
    'redo section': 'plan',  // re-plan, then re-write
    'rewrite section': 'write',
  };
  for (const [correction, verb] of Object.entries(correctionTargets)) {
    assert.ok(
      VERB_SET.has(verb),
      `UX-05: the "${correction}" correction must route to an EXISTING locked-16 verb, got "${verb}"`,
    );
  }
  // Specifically: "revise" must NOT introduce a `revise` verb — it rides `plan`.
  assert.ok(!VERB_SET.has('revise'), 'UX-05: "revise" must NOT be a 17th verb (it ships via plan --revise, per 04-04)');
});

// === UX-05: every verb a skill body targets is a SUBSET of UX02_VERBS ===
test('UX-05: the set of skill-mapped target verbs is a SUBSET of UX02_VERBS (no new verb names)',
  () => {
    // Collect every command the skill tells Claude to run (`pensmith <verb>`
    // inside backticks) and require each to be a real verb.
    const referenced = new Set<string>();
    for (const path of SKILL_FILES) {
      const text = readFileSync(path, 'utf8');
      const re = /`pensmith ([a-z][a-z-]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const token = m[1];
        if (token) referenced.add(token);
      }
    }
    assert.ok(referenced.size >= 8, `expected the skill to reference the pipeline verbs, found: ${[...referenced].join(', ')}`);
    for (const token of referenced) {
      assert.ok(
        VERB_SET.has(token),
        `UX-05: skill-referenced verb "${token}" must be a member of UX02_VERBS (no 17th verb)`,
      );
    }
    // The length invariant must still hold after the skills landed.
    assert.equal(UX02_VERBS.length, 17, 'UX-05: adding the skills namespace must NOT change UX02_VERBS.length');
  });
