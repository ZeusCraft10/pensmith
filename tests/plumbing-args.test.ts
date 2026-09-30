// tests/plumbing-args.test.ts — PLUG-05: the documented arguments of the seven
// plumbing commands match their verbs' real options (review round 2).
//
// Each /pensmith:<name> forwards `<verb> $ARGUMENTS` unchanged, so what a
// script may pass is exactly what the verb's citty `args` accept. This test
// derives the flags from each verb's CommandDef (bin/cli/<verb>.ts) and holds
// both places a script author reads — the skill's `argument-hint` and the
// docs/PLUMBING.md table — to them: every option a verb takes is documented
// (a boolean that defaults to on as `--no-<name>`, the section positional as
// `<N>`), and every documented flag is one the verb takes.
//
// Not listed per command: the global `--yolo` (pre-parsed for every verb;
// PLUMBING.md's gate paragraph and the README Flags section cover it), and
// `write --max-parallel`, which only tunes `write` with no section (the wave
// mode) — /pensmith:write-section always names one section.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Plumbing skill → the verb it forwards (and its bin/cli module). */
const PLUMBING: Record<string, string> = {
  research: 'research',
  outline: 'outline',
  'plan-section': 'plan',
  'write-section': 'write',
  'verify-section': 'verify',
  compile: 'compile',
  done: 'done',
};
const GLOBAL_FLAGS = new Set(['yolo']);
const NOT_FOR_ONE_SECTION: Record<string, readonly string[]> = { write: ['max-parallel'] };

interface ArgDef {
  type?: string;
  default?: unknown;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

async function verbArgs(verb: string): Promise<Record<string, ArgDef>> {
  const mod = (await import(`../bin/cli/${verb}.js`)) as { default: { args?: unknown } };
  const args = typeof mod.default.args === 'function' ? await (mod.default.args as () => Promise<unknown>)() : mod.default.args;
  return (args ?? {}) as Record<string, ArgDef>;
}

/** The documented spellings of each option: `<N>`, `--name` (or its kebab form), `--no-name`. */
function expectedTokens(verb: string, args: Record<string, ArgDef>): Array<{ name: string; spellings: string[] }> {
  const out: Array<{ name: string; spellings: string[] }> = [];
  for (const [name, def] of Object.entries(args)) {
    if (GLOBAL_FLAGS.has(name) || (NOT_FOR_ONE_SECTION[verb] ?? []).includes(name)) continue;
    if (def.type === 'positional') {
      out.push({ name, spellings: ['<N>'] });
      continue;
    }
    const names = [...new Set([name, kebab(name)])];
    out.push({ name, spellings: def.type === 'boolean' && def.default === true ? names.map((n) => `--no-${n}`) : names.map((n) => `--${n}`) });
  }
  return out;
}

/** The option a documented `--flag` names, or null when the verb has none by that name. */
function optionOf(flag: string, args: Record<string, ArgDef>): string | null {
  const bare = flag.replace(/^--/, '');
  for (const [name, def] of Object.entries(args)) {
    const names = new Set([name, kebab(name)]);
    if (names.has(bare) && !(def.type === 'boolean' && def.default === true)) return name;
    if (def.type === 'boolean' && def.default === true && bare.startsWith('no-') && names.has(bare.slice(3))) return name;
  }
  return null;
}

function argumentHint(skill: string): string {
  const text = readFileSync(path.join(REPO, 'plugin', 'skills', skill, 'SKILL.md'), 'utf8');
  const fm = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '') as Record<string, unknown>;
  return String(fm['argument-hint'] ?? '');
}

function plumbingRow(skill: string): string {
  const doc = readFileSync(path.join(REPO, 'docs', 'PLUMBING.md'), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith(`| \`/pensmith:${skill}\` |`));
  assert.ok(row, `docs/PLUMBING.md has a row for /pensmith:${skill}`);
  // The Arguments cell (the last one), with GFM's escaped pipes restored.
  const cells = row.replace(/\\\|/g, '\u0000').split('|').map((c) => c.trim().replace(/\u0000/g, '|'));
  return cells[cells.length - 2] ?? '';
}

for (const [skill, verb] of Object.entries(PLUMBING)) {
  test(`PLUG-05: /pensmith:${skill} documents exactly the options \`${verb}\` takes (argument-hint and docs/PLUMBING.md)`, async () => {
    const args = await verbArgs(verb);
    const hint = argumentHint(skill);
    const row = plumbingRow(skill);
    for (const [where, text] of [['argument-hint', hint], ['docs/PLUMBING.md', row]] as const) {
      for (const { name, spellings } of expectedTokens(verb, args)) {
        assert.ok(spellings.some((s) => text.includes(s)), `${skill} ${where} "${text}" must document ${verb}'s ${name} (${spellings.join(' or ')})`);
      }
      for (const m of text.matchAll(/--[A-Za-z][\w-]*/g)) {
        assert.ok(optionOf(m[0], args) !== null, `${skill} ${where} documents ${m[0]}, which \`pensmith ${verb}\` does not take`);
      }
      assert.doesNotMatch(text, /\bnone\b|no arguments/i, `${skill} ${where}: the verb takes options`);
    }
  });
}

test('PLUG-05: the documented choices of done --format are the ones done accepts', async () => {
  const src = readFileSync(path.join(REPO, 'bin', 'cli', 'done.ts'), 'utf8');
  const declared = /format:\s*\{[^}]*description:\s*'Export format: ([a-z |]+)\.'/.exec(src)?.[1]?.split('|').map((s) => s.trim());
  assert.deepEqual(declared, ['docx', 'pdf', 'latex', 'md']);
  for (const text of [argumentHint('done'), plumbingRow('done')]) assert.match(text, /--format docx\|pdf\|latex\|md/);
});
