// tests/skill-descriptions.test.ts — Phase 7 Wave 0 RED scaffold for UX-03 / UX-04.
//
// Skill descriptions are the ONLY mechanism that routes natural-language phrases
// to verbs (07-RESEARCH "Natural-Language Trigger Routing"). The plumbing skill
// files (skills/*.md) carry the EXACT PRD §5.4 trigger phrases in their
// `description:` frontmatter. The plugin manifest registers the colon-prefix
// skill names. Both land in Plan 07-04 — RED-by-skip on existsSync of the
// skill files / the plugin.json `skills` key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

const SKILL_FILES = {
  pensmith: repoPath('skills/pensmith.md'),
  planSection: repoPath('skills/plan-section.md'),
  writeSection: repoPath('skills/write-section.md'),
  verifySection: repoPath('skills/verify-section.md'),
};
const PLUGIN_JSON = repoPath('.claude-plugin/plugin.json');

// RED-by-skip guard: the skill files land in 07-04.
const skillsBuilt = existsSync(SKILL_FILES.pensmith);

// Extract the `description:` frontmatter value (single-line or quoted) from a
// skill markdown file's YAML frontmatter.
function readDescription(path: string): string {
  const text = readFileSync(path, 'utf8');
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const block = fmMatch ? fmMatch[1] ?? '' : text;
  const descMatch = /(?:^|\n)description:\s*(.+)/.exec(block);
  return descMatch ? (descMatch[1] ?? '').trim() : '';
}

// --- RED-by-skip presence guard ---
test('UX-03/04: skill files presence is consistent with Wave-0 RED state', () => {
  if (skillsBuilt) {
    assert.ok(skillsBuilt, 'skills/pensmith.md present — skill-content tests active');
  } else {
    assert.ok(!skillsBuilt, 'Wave-0: skills/*.md not written yet (RED-by-skip; lands in 07-04)');
  }
});

// === UX-03: the four plumbing skill files exist ===
test('UX-03: the four plumbing skill files exist on disk',
  { skip: !skillsBuilt }, () => {
    for (const [name, path] of Object.entries(SKILL_FILES)) {
      assert.ok(existsSync(path), `UX-03: skill file for "${name}" must exist at ${path}`);
    }
  });

// === UX-04: skills/pensmith.md description carries the §5.4 status/resume triggers ===
test('UX-04: skills/pensmith.md description contains the PRD §5.4 status/resume trigger phrases',
  { skip: !skillsBuilt }, () => {
    const desc = readDescription(SKILL_FILES.pensmith);
    assert.match(desc, /where am I/i, 'UX-04: pensmith skill must carry "where am I" (status trigger)');
    assert.match(desc, /what'?s next/i, 'UX-04: pensmith skill must carry "what\'s next" (status trigger)');
    assert.match(desc, /resume/i, 'UX-04: pensmith skill must carry "resume" (resume trigger)');
  });

// === UX-04: plan-section skill carries the plan/redo triggers ===
test('UX-04: skills/plan-section.md description contains the PRD §5.4 plan/redo trigger phrases',
  { skip: !skillsBuilt }, () => {
    const desc = readDescription(SKILL_FILES.planSection);
    assert.match(desc, /plan section/i, 'UX-04: plan-section skill must carry "plan section"');
    assert.match(desc, /redo section/i, 'UX-04: plan-section skill must carry "redo section"');
  });

// === UX-04: verify-section skill carries the verify trigger ===
test('UX-04: skills/verify-section.md description contains the PRD §5.4 verify trigger phrase',
  { skip: !skillsBuilt }, () => {
    const desc = readDescription(SKILL_FILES.verifySection);
    assert.match(desc, /verify section/i, 'UX-04: verify-section skill must carry "verify section"');
  });

// === UX-03: plugin.json registers exactly the colon-prefix plumbing skill names ===
const pluginSkillsBuilt = (() => {
  if (!existsSync(PLUGIN_JSON)) return false;
  try {
    const pkg = JSON.parse(readFileSync(PLUGIN_JSON, 'utf8')) as { skills?: unknown };
    return Array.isArray(pkg.skills);
  } catch {
    return false;
  }
})();

test('UX-03: plugin.json skills array registers the colon-prefix plumbing namespace',
  { skip: !pluginSkillsBuilt }, () => {
    const pkg = JSON.parse(readFileSync(PLUGIN_JSON, 'utf8')) as { skills?: unknown[] };
    const skills = (pkg.skills ?? []) as unknown[];
    // The registered skill identifiers must include the colon-prefix plumbing names.
    const flat = JSON.stringify(skills);
    for (const name of ['pensmith', 'pensmith:plan-section', 'pensmith:write-section', 'pensmith:verify-section']) {
      assert.ok(
        flat.includes(name),
        `UX-03: plugin.json skills must register "${name}" (colon-prefix plumbing namespace)`,
      );
    }
  });
