// tests/nl-triggers.test.ts — UX-05 / PLUG-05: natural-language triggers and
// inline corrections route to the EXISTING locked-16 verbs; nothing adds a
// 17th verb.
//
// Per Phase 4 (04-04) revise ships as `plan --revise` (a flag on `plan`), not a
// 17th verb. Since Phase 23a the ONE natural-language router is the pensmith
// skill (plugin/skills/pensmith/SKILL.md, D-23a-09): its "What the user says →
// verb" table maps every PRD §5.4 phrase and §5.6 correction onto a verb, and
// the 7 plumbing skills (/pensmith:<name>, user-invoked only) each forward one
// existing verb.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UX02_VERBS } from '../bin/lib/verbs.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(REPO, 'plugin', 'skills');
const SKILL_NAMES = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const VERB_SET = new Set<string>(UX02_VERBS as readonly string[]);

function skillText(name: string): string {
  return readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
}

/** The pensmith skill's "What the user says → verb" rows: phrase cell → verb cell. */
function routingRows(): Array<{ says: string; verb: string }> {
  const body = skillText('pensmith');
  const section = /## What the user says → verb\n([\s\S]*?)\n## /.exec(body)?.[1] ?? '';
  return section
    .split('\n')
    .filter((l) => l.startsWith('| "'))
    .map((l) => {
      const cells = l.split('|').map((c) => c.trim());
      return { says: cells[1] ?? '', verb: cells[2] ?? '' };
    });
}

// === UX-05 / T-07-02: the locked-16 bijection is exactly 16 (no 17th verb) ===
test('UX-05 / T-07-02: UX02_VERBS.length === 16 (no 17th verb introduced)', () => {
  assert.equal(UX02_VERBS.length, 16, 'T-07-02: the locked-16 bijection must stay at exactly 16 verbs');
});

// === UX-05: revise / swap-source / redo route to the EXISTING `plan` verb ===
test('UX-05: inline corrections (revise / swap-source / redo) map to the existing plan/write verbs (no new verb)', () => {
  const correctionTargets: Record<string, string> = {
    'revise': 'plan',        // `plan --revise`
    'swap source': 'plan',   // re-plan the section's source assignment
    'redo section': 'plan',  // re-plan, then re-write
    'rewrite section': 'write',
  };
  for (const [correction, verb] of Object.entries(correctionTargets)) {
    assert.ok(VERB_SET.has(verb), `UX-05: the "${correction}" correction must route to an EXISTING locked-16 verb, got "${verb}"`);
  }
  assert.ok(!VERB_SET.has('revise'), 'UX-05: "revise" must NOT be a 17th verb (it ships via plan --revise, per 04-04)');
});

// === UX-05 / PLUG-05: every phrase row routes to existing verbs ===
test('UX-05: every row of the pensmith skill\'s phrase table routes to a locked-16 verb', () => {
  const rows = routingRows();
  assert.ok(rows.length >= 15, `the phrase table has its rows (got ${rows.length})`);
  for (const { says, verb } of rows) {
    const targets = [...verb.matchAll(/`([a-z]+)(?:[ `])/g)].map((m) => m[1]!);
    const named = targets.length > 0 ? targets : /\bnext\b/.test(verb) ? ['next'] : [];
    assert.ok(named.length > 0, `${says} → ${verb}: names a verb`);
    for (const t of named) assert.ok(VERB_SET.has(t), `${says} → "${t}" must be one of the 16 verbs`);
  }
});

test('UX-05: the §5.6 corrections ride existing verbs by the routes that work today — never a new verb', () => {
  const byPhrase = new Map(routingRows().map((r) => [r.says.toLowerCase(), r.verb]));
  const find = (fragment: string): string => {
    for (const [says, verb] of byPhrase) if (says.includes(fragment)) return verb;
    return '';
  };
  // Review round 2: `plan N --revise` only repairs a verifier-flagged citation
  // (bin/lib/revise.ts); on a clean section it changes nothing. It is the
  // redo route only for a flagged section, and never the length or source
  // route. tests/correction-routes.test.ts runs each route through the CLI.
  const redo = find('re-do section 3');
  assert.match(redo, /flagged a citation[^|]*`plan 3 --revise`[^|]*then `write 3`; otherwise `plan 3`, then `write 3`/);
  const length = find('make it 1500 words');
  assert.match(length, /word target column of `\.paper\/OUTLINE\.md`[^|]*then `outline`[^|]*then `plan N` and `write N`/);
  assert.doesNotMatch(length, /--revise/);
  const source = find('use a different source');
  assert.match(source, /`add <DOI or id> --section 4`[^|]*`add --remap <citekey> --section 4`[^|]*then `plan 4` and `write 4`/);
  assert.doesNotMatch(source, /--revise/);
  const addSection = find('add a section about counterexamples');
  assert.match(addSection, /lettered number after the section it follows \(`3a` after §3\)[^|]*no existing number changes[^|]*Then `outline`/);
  assert.match(find('check the citations in section 3'), /`verify 3`/);
  const body = readFileSync(path.join(SKILLS_DIR, 'pensmith', 'SKILL.md'), 'utf8');
  assert.match(body, /`plan N --revise` only repairs a citation the verifier flagged; on a clean\nsection it changes nothing/);
  assert.match(body, /no single-claim source swap/);
  // The one file the skill may edit is the OUTLINE.md table the user asked to change.
  assert.match(body, /never writes files under `\.paper\/` itself — with one\nexception: the edit to the `\.paper\/OUTLINE\.md` table that the user asked for/);
});

// === UX-05: every verb a skill body names is a member of the 16 ===
test('UX-05: every `pensmith <verb>` a skill body names is a member of UX02_VERBS (no new verb names)', () => {
  const referenced = new Set<string>();
  for (const name of SKILL_NAMES) {
    const text = skillText(name);
    // `pensmith <verb>` / `/pensmith <verb>` command references (not the
    // `pensmith:<skill>` names, which are skills, not verbs).
    for (const m of text.matchAll(/`\/?pensmith ([a-z][a-z-]*)/g)) referenced.add(m[1]!);
  }
  assert.ok(referenced.size > 0, 'the skills name the verbs they run');
  for (const token of referenced) {
    if (token === 'verb') continue; // the `pensmith <verb> [args]` placeholder
    assert.ok(VERB_SET.has(token), `UX-05: skill-referenced verb "${token}" must be a member of UX02_VERBS (no 17th verb)`);
  }
  assert.equal(UX02_VERBS.length, 16, 'UX-05: the skills namespace must NOT change UX02_VERBS.length');
});

test('PLUG-05: the plumbing skill names are not verbs of their own — each forwards an existing verb', () => {
  for (const name of SKILL_NAMES.filter((n) => n !== 'pensmith')) {
    const verb = /Run the pensmith verb `([a-z]+) \$ARGUMENTS`/.exec(skillText(name))?.[1];
    assert.ok(verb && VERB_SET.has(verb), `/pensmith:${name} forwards a locked-16 verb (got ${String(verb)})`);
    if (name.endsWith('-section')) assert.ok(!VERB_SET.has(name), `${name} is not a verb`);
  }
});
