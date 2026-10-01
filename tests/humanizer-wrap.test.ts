// tests/humanizer-wrap.test.ts — the Tier-2 humanizer module (DONE-03; Phase
// 21 EXP-14, D-21-18), in process.
//
// Replaces the Phase-6 RED-by-skip scaffold around exporter.ts runHumanizer
// (the Task-transport seam, deleted in the Phase 21 integration pass): the
// humanizer is now bin/lib/humanizer.ts, which reads the user's skill through
// paths.ts humanizerSkillPath (under a test context only a home inside
// os.tmpdir() counts, so no test ever reads the developer's real skill),
// sends its body as the system prompt with the hash-pinned contract, the voice
// and the masked, fenced section text, rewrites the compiled draft one `##`
// section at a time (the title and headings never reach the model) and
// validates every reply through the rewrite guard. The model call is injected
// here; tests/humanizer-task.test.ts drives the real transport (mock LLM)
// through the built CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HUMANIZER_SLUG,
  humanizeDraft,
  humanizerContract,
  humanizerRequest,
  joinDraftSections,
  loadHumanizerSkill,
  splitDraftSections,
  type HumanizerRequest,
} from '../bin/lib/humanizer.js';
import { isHumanizerSkillPresent } from '../bin/lib/ecosystem-presence.js';
import { humanizerSkillPath } from '../bin/lib/paths.js';
import { slugSpec } from '../bin/lib/llm-models.js';
import { FENCE_OPEN, unfence } from '../bin/lib/untrusted-fence.js';

/** The masked section a humanizer request carries (its fenced `<text>` block). */
function maskedOf(content: string): string {
  const inner = /<text>\n([\s\S]*)\n<\/text>$/.exec(content)?.[1] ?? '';
  return unfence(inner) ?? '';
}

const FIXTURE = fileURLToPath(new URL('./fixtures/humanizer-skill/humanizer-skill.md', import.meta.url));
const CONTRACT_FILE = fileURLToPath(new URL('../plugin/references/humanizer-contract.md', import.meta.url));

/** Run `fn` with HOME (and USERPROFILE) at a fresh temp home, the fixture skill installed when `install`. */
function withHome<T>(install: boolean, fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-home-'));
  if (install) {
    mkdirSync(join(home, '.claude', 'skills', 'humanizer'), { recursive: true });
    copyFileSync(FIXTURE, join(home, '.claude', 'skills', 'humanizer', 'SKILL.md'));
  }
  const saved = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] };
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;
  try {
    return fn(home);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const DRAFT = [
  '# Deep Learning and Measurement',
  '',
  '## Learning Representations',
  '',
  'Neural networks with many layers learn representations of raw data at several levels of abstraction [@lecun2015].',
  '',
  'These layered models now set the pace for speech and image recognition across the field [@lecun2015, p. 437].',
  '',
  '## Measurement in Physics',
  '',
  'As the authors put it, "measurement in quantum physics shapes what an observer is able to record" [@aspelmeyer2009].',
  '',
].join('\n');

test('EXP-14: the skill is found only under a temp home in a test context — never the developer\'s real one', () => {
  withHome(true, (home) => {
    assert.equal(humanizerSkillPath(), join(home, '.claude', 'skills', 'humanizer', 'SKILL.md'));
    assert.equal(isHumanizerSkillPresent(), true);
    const skill = loadHumanizerSkill();
    assert.ok(skill);
    assert.ok(skill.body.startsWith('# Humanizer (pensmith test fixture)'), 'the frontmatter is stripped');
    assert.doesNotMatch(skill.body, /^name: humanizer/m);
  });
  withHome(false, () => {
    assert.equal(loadHumanizerSkill(), null, 'no SKILL.md → null');
    assert.equal(isHumanizerSkillPresent(), false);
  });
  // A home outside os.tmpdir() (here the filesystem root) is refused under a
  // test context, so the developer's real ~/.claude is never read.
  const saved = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] };
  process.env['HOME'] = parse(tmpdir()).root;
  process.env['USERPROFILE'] = parse(tmpdir()).root;
  try {
    assert.equal(humanizerSkillPath(), null);
    assert.equal(loadHumanizerSkill(), null);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('EXP-14 (S-06): `humanizer` is a model slug of verb done with no prompt template', () => {
  const spec = slugSpec(HUMANIZER_SLUG);
  assert.equal(spec.verb, 'done');
  assert.equal(spec.tier, 'generation');
  assert.equal(spec.template, false);
});

test('EXP-14: the request — system = the skill body; user = the pinned contract verbatim, the voice, the masked section fenced', () => {
  withHome(true, () => {
    const skill = loadHumanizerSkill();
    assert.ok(skill);
    const req: HumanizerRequest = humanizerRequest(skill, 'Masked text {{cite_0_0}}.', 'academic');
    assert.equal(req.slug, 'humanizer');
    assert.equal(req.system, skill.body);
    assert.equal(req.messages.length, 1);
    const content = req.messages[0]!.content;
    const md = readFileSync(CONTRACT_FILE, 'utf8').replace(/\r\n/g, '\n');
    assert.ok(content.startsWith(md.slice(md.indexOf('## Contract\n') + '## Contract\n'.length).trim()), 'the contract, verbatim, first');
    assert.equal(humanizerContract(), md.slice(md.indexOf('## Contract\n') + '## Contract\n'.length).trim());
    assert.match(content, /<preserve_voice>\nacademic\n<\/preserve_voice>/);
    assert.ok(content.includes(`<text>\n${FENCE_OPEN}\n`), 'the section text is fenced (FEED-05)');
    assert.equal(maskedOf(content), 'Masked text {{cite_0_0}}.');
  });
});

test('EXP-14: split/join round-trips the compiled draft; the title and the headings are never sent', async () => {
  const { preamble, sections } = splitDraftSections(DRAFT);
  assert.equal(preamble, '# Deep Learning and Measurement\n');
  assert.deepEqual(sections.map((s) => s.heading), ['## Learning Representations', '## Measurement in Physics']);
  assert.equal(joinDraftSections(preamble, sections), DRAFT);
  const sent: string[] = [];
  const skill = { path: '/fixture/SKILL.md', body: 'Improve the prose.' };
  const r = await humanizeDraft({
    draft: DRAFT,
    skill,
    call: async (req) => {
      const text = req.messages[0]!.content;
      sent.push(text);
      return maskedOf(text).replace('learn representations', 'build up representations').replace('shapes what', 'shapes what');
    },
  });
  assert.equal(r.sectionsSent, 2);
  assert.deepEqual(r.rejected, []);
  for (const s of sent) {
    assert.doesNotMatch(s, /Deep Learning and Measurement|## Learning|## Measurement/, 'no title or heading reaches the model');
    assert.doesNotMatch(s, /@lecun2015|@aspelmeyer2009/, 'citations are placeholders');
    assert.doesNotMatch(s, /measurement in quantum physics shapes what an observer/, 'the quoted passage is a placeholder');
  }
  assert.match(r.text, /build up representations of raw data/);
  assert.ok(r.text.includes('[@lecun2015, p. 437]') && r.text.includes('"measurement in quantum physics shapes what an observer is able to record" [@aspelmeyer2009]'));
  assert.ok(r.text.startsWith('# Deep Learning and Measurement\n\n## Learning Representations\n'));
});

test('EXP-14: a reply that drops a placeholder, adds a citation or touches the structure is rejected with its reason', async () => {
  const skill = { path: '/fixture/SKILL.md', body: 'Improve the prose.' };
  const cases: Array<[string, (masked: string) => string, RegExp]> = [
    ['a dropped citation', (m) => m.replace(/\s*\{\{cite_0_0\}\}/, ''), /placeholder|citation set changed/],
    ['an added citation', (m) => `${m.trimEnd()} A later survey agrees [@fake2099, p. 3].`, /citation set changed|adds/],
    ['an empty reply', () => '', /empty/],
    // Review round 1: a reply that echoes its fenced input with a preamble, or
    // moves a citation between paragraphs, never reaches FINAL.md.
    ['an echoed fence with chatter', (m) => `Here is the improved text:\n\n${FENCE_OPEN}\n${m}\n<<<END_PENSMITH_UNTRUSTED_DATA_x>>>`, /paragraph structure changed|untrusted-data fence/],
    ['a citation moved to the other paragraph', (m) => m.replace(' {{cite_0_0}}', '').replace(/\.\s*$/, ' {{cite_0_0}}.'), /moved to another paragraph/],
  ];
  for (const [what, edit, reason] of cases) {
    const r = await humanizeDraft({ draft: DRAFT, skill, call: async (req, i) => (i === 0 ? edit(maskedOf(req.messages[0]!.content)) : maskedOf(req.messages[0]!.content)) });
    assert.equal(r.rejected.length, 1, `${what}: ${JSON.stringify(r.rejected)}`);
    assert.match(r.rejected[0]!, /^§1 \(Learning Representations\): /, what);
    assert.match(r.rejected[0]!, reason, what);
    assert.ok(r.text.includes('learn representations of raw data at several levels of abstraction [@lecun2015].'), `${what}: the rejected section is kept as compiled`);
  }
});

test('EXP-14: a model error propagates to the caller (done reports "humanizer failed: …" or the cost cap)', async () => {
  const skill = { path: '/fixture/SKILL.md', body: 'Improve the prose.' };
  await assert.rejects(
    humanizeDraft({ draft: DRAFT, skill, call: async () => { throw new Error('HTTP 500 from the provider'); } }),
    /HTTP 500/,
  );
});

test('review r1: a reply that swaps the citations of two claims is rejected; the compiled section is kept', async () => {
  const skill = { path: '/fixture/SKILL.md', body: 'Improve the prose.' };
  const draft = [
    '# Public Health',
    '',
    '## Findings',
    '',
    'Vaccination reduced hospitalisation in the cohort [@smith2020]. Rising temperatures had no measurable effect on transmission [@jones2019].',
    '',
  ].join('\n');
  const r = await humanizeDraft({
    draft,
    skill,
    call: async (req) => maskedOf(req.messages[0]!.content).replace('{{cite_0_0}}', '\u0001').replace('{{cite_0_1}}', '{{cite_0_0}}').replace('\u0001', '{{cite_0_1}}'),
  });
  assert.equal(r.rejected.length, 1, JSON.stringify(r.rejected));
  assert.match(r.rejected[0]!, /a citation moved to another claim/);
  assert.equal(r.text, draft, 'the section is kept as compiled');
});
