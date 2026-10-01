// tests/humanizer-stub.test.ts — the `humanizer` text stub (Phase 21 EXP-14,
// D-21-18): what PENSMITH_NO_LLM and the mock LLM answer a humanizer request
// with. It reads the masked section from the request's fenced `<text>` block
// and rewrites only the prose — every placeholder, heading and block quote
// kept, nothing cited, quoted or added — so the rewrite guard accepts it and
// the stubbed text always differs from the original.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textStub, hasTextStub, loadTextStubs } from '../bin/lib/llm-text-stubs.js';
import { humanizerRequest } from '../bin/lib/humanizer.js';
import { maskForRewrite, validateRewrite } from '../bin/lib/rewrite-guard.js';

const SKILL = { path: '/fixture/SKILL.md', body: 'Improve the prose.' };

function stubFor(section: string): { masked: string; reply: string } {
  const mask = maskForRewrite(section, { namespace: 0 });
  const req = humanizerRequest(SKILL, mask.masked, 'academic');
  return { masked: mask.masked, reply: textStub('humanizer', req.messages) };
}

test('EXP-14: the humanizer stub rewrites prose words from its table and keeps every placeholder', () => {
  assert.equal(hasTextStub('humanizer'), true);
  const section = 'The study demonstrates a clear effect [@lecun2015]. Moreover, it extends earlier work [@aspelmeyer2009, p. 4].\n\nA second paragraph supports the claim [@lecun2015].';
  const { masked, reply } = stubFor(section);
  assert.notEqual(reply, masked, 'the stubbed text differs');
  assert.match(reply, /\bshows\b/, '"demonstrates" → "shows" from the table');
  for (const ph of masked.match(/\{\{cite_\d+_\d+\}\}/g) ?? []) assert.ok(reply.includes(ph), `${ph} kept`);
  assert.equal((reply.match(/\{\{cite_\d+_\d+\}\}/g) ?? []).length, (masked.match(/\{\{cite_\d+_\d+\}\}/g) ?? []).length);
  assert.doesNotMatch(reply, /\[@|"/, 'no citation or quote is added');
  const mask = maskForRewrite(section, { namespace: 0 });
  const verdict = validateRewrite({ original: section, mask, rewritten: reply });
  assert.deepEqual(verdict.reasons, [], 'the rewrite guard accepts the stub');
});

test('EXP-14: a section with none of the table\'s words gets the fallback prefix on its first prose paragraph; block quotes and headings are kept', () => {
  // A long block quote is masked as a quote placeholder; a short one reaches the stub as text.
  const section = '### A subheading\n\nNeural networks learn layered representations [@lecun2015].\n\n> A block quote that is not a citation and stays as written in every respect here.\n\n> Short aside.';
  const { masked, reply } = stubFor(section);
  const prefix = loadTextStubs().humanizer.fallback_prefix;
  assert.ok(reply.includes(`${prefix} Neural networks learn layered representations`), reply);
  assert.ok(reply.includes('### A subheading'), 'the heading is kept');
  assert.match(masked, /\{\{quote_0_0\}\}/, 'the long block quote is masked');
  assert.ok(reply.includes('{{quote_0_0}}'), 'its placeholder is kept');
  assert.ok(reply.includes('> Short aside.'), 'a block quote the stub sees is kept as written');
  assert.equal(reply.split(/\n\s*\n/).length, masked.split(/\n\s*\n/).length, 'the paragraph structure is kept');
});
