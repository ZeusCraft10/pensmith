// tests/paper-title.test.ts — the paper's title when `[project] title` is
// unset (Phase 21 review round 3, EXP-05): the intake topic in title case,
// never the lowercase noun phrase the intake asks for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPaperBrief, titleFromTopic } from '../bin/lib/paper-brief.js';
import { intakeMd } from './helpers/pipeline-paper.js';

test('review r3: titleFromTopic — title case, small words lower case inside, capitals the user typed kept', () => {
  assert.equal(titleFromTopic('attention mechanisms in transformers'), 'Attention Mechanisms in Transformers');
  assert.equal(titleFromTopic('urban heat islands and street tree canopy cover'), 'Urban Heat Islands and Street Tree Canopy Cover');
  assert.equal(titleFromTopic('the treaty of Versailles: a reassessment of the war'), 'The Treaty of Versailles: A Reassessment of the War');
  assert.equal(titleFromTopic('COVID-19 vaccine uptake in long-term care'), 'COVID-19 Vaccine Uptake in Long-Term Care');
  assert.equal(titleFromTopic('iPhone use among teens'), 'iPhone Use Among Teens');
  assert.equal(titleFromTopic('what it is for'), 'What It Is For', 'a small word that closes the title is capitalised');
  assert.equal(titleFromTopic(''), '');
});

test('review r3: the brief\'s title is [project] title when set, else the topic in title case', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-title-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'INTAKE.md'), intakeMd({ discipline: 'computer-science', topic: 'attention mechanisms in transformers' }));
  assert.equal(readPaperBrief(root).title, 'Attention Mechanisms in Transformers');
  assert.equal(readPaperBrief(root).topic, 'attention mechanisms in transformers', 'the topic itself is unchanged');
  writeFileSync(join(root, '.paper', 'config.toml'), 'schema_version = 4\n[project]\ntitle = "Where Attention Goes"\n');
  assert.equal(readPaperBrief(root).title, 'Where Attention Goes');
});
