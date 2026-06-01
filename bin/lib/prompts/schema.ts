// bin/lib/prompts/schema.ts — Zod schemas for TIER-05 prompt types.
//
// TIER-05: Tier 2 fallback for AskUserQuestion. This file is the single
// source of truth for the prompt wire schema — both the @clack/prompts TTY
// delegate (bin/lib/prompts/clack.ts) and the stdin numbered-prompt fallback
// (bin/lib/prompts/numbered.ts) converge on these types.
//
// Numbered-prompt wire protocol (by example):
//
//   Question sent to stderr:
//     [pensmith] Which discipline preset should I use? (select)
//       1) cs       — Computer science (APA + arXiv-heavy)
//       2) bio      — Biological sciences (CSE + PubMed-heavy)
//       3) history  — History (Chicago notes-bib)
//       4) other    — Pick a custom style
//     [default: 1]  Enter a number 1-4:
//
//   User types "2\n" on stdin → returns { id: 'discipline', kind: 'select', value: 'bio' }
//   For multiselect:  user types "1,3\n"  → returns { value: ['cs', 'history'] }
//   For text:         user types raw string (blank line keeps default)
//   For confirm:      user types y/Y/yes/n/N/no (blank line keeps default)
//
// Field names match gsd-plugin's --text JSON question schema (id, label,
// options, default) so an upstream CI fixture can feed identical JSON to
// either tier and get identical answers back.

import { z } from 'zod';

// ── Sub-schemas ───────────────────────────────────────────────────────────────

export const SelectQuestionSchema = z.object({
  id: z.string().min(1),           // stable identifier (used in answer log)
  kind: z.literal('select'),
  label: z.string().min(1),        // human-readable prompt text
  options: z.array(
    z.object({
      value: z.string().min(1),    // canonical machine value
      label: z.string().min(1),    // human-readable rendition
      hint: z.string().optional(),
    }),
  ).min(1),
  default: z.string().optional(),  // option.value of the default
});

export const MultiSelectQuestionSchema = SelectQuestionSchema.extend({
  kind: z.literal('multiselect'),
  default: z.array(z.string()).optional(),
});

export const TextQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('text'),
  label: z.string().min(1),
  default: z.string().optional(),
  placeholder: z.string().optional(),
});

export const ConfirmQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('confirm'),
  label: z.string().min(1),
  default: z.boolean().optional(),  // true → [Y/n]; false or absent → [y/N]
});

// ── Discriminated union ───────────────────────────────────────────────────────

export const PromptQuestionSchema = z.discriminatedUnion('kind', [
  SelectQuestionSchema,
  MultiSelectQuestionSchema,
  TextQuestionSchema,
  ConfirmQuestionSchema,
]);

export type PromptQuestion = z.infer<typeof PromptQuestionSchema>;

// ── Answer types ──────────────────────────────────────────────────────────────
//
// PromptAnswer is a hand-written discriminated union type (NOT zod-inferred).
// Answers are produced by trusted code paths inside this module, never parsed
// from untrusted JSON — the type system is sufficient for caller safety.
// The `id` field echoes the question id so callers can correlate answer to
// question without maintaining a lookup table.

export type PromptAnswer =
  | { id: string; kind: 'select';      value: string   }
  | { id: string; kind: 'multiselect'; value: string[] }
  | { id: string; kind: 'text';        value: string   }
  | { id: string; kind: 'confirm';     value: boolean  };
