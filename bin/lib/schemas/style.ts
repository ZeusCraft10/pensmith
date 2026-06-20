// bin/lib/schemas/style.ts — the per-paper STYLE PROFILE schema (STYL-01).
//
// ⚠️ PURE-STATS, PER-PAPER-ONLY. This profile is computed deterministically from
// a folder of writing samples (NO LLM at profile-build time — see the 08-RESEARCH
// Anti-Pattern and bin/lib/style-match.ts header) and is written ONLY to the
// per-paper <paperRoot>/.paper/STYLE.json. It is NEVER cached globally. The
// SEPARATE cross-paper fingerprint registry (pensmithDataDir()/style-fingerprints.json,
// see paths.ts pensmithStyleFingerprintsPath) stores fingerprint hashes + paper
// identity ONLY — it deliberately does NOT contain any of these prose features.
//
// FLAT SHAPE (load-bearing): the numeric features live at the top level of the
// profile (medianSentenceLength, typeTokenRatio, ...), NOT under a nested
// `features` key. tests/style-match.test.ts is the authoritative contract — it
// asserts `profile.medianSentenceLength`, `profile.fingerprint`, etc. directly,
// and the PITFALL-1 negative-control asserts the registry never contains a
// "features" key NOR these feature names. Keeping the profile flat lets the
// registry stay a privacy-minimal hash→identity map with no structural overlap.
//
// Schema envelope mirrors bin/lib/schemas/library.ts (a $schemaVersion literal +
// validated fields). Any new feature field MUST come with a v(N)→v(N+1) migration
// if the schema version is bumped.

import { z } from 'zod';

export const CURRENT_STYLE_VERSION = 1;

/**
 * A deterministic pure-stats prose profile for one paper.
 *
 * Numeric features (FLAT — top-level, matching the authoritative
 * tests/style-match.test.ts StyleProfile contract):
 *   - medianSentenceLength / p25SentenceLength / p75SentenceLength — sentence
 *     length (in words) quantiles; p25 ≤ median ≤ p75 by construction.
 *   - typeTokenRatio        — uniqueWords / totalWords, bounded [0,1].
 *   - passiveVoiceRate      — passive-construction hits / sentences, bounded [0,1].
 *   - subordinatingClauseRate — subordinator hits / sentences, bounded [0,1].
 *   - avgParagraphLengthSentences — mean sentences per paragraph.
 *   - openingWordTopN / closingWordTopN — frequency tables of sentence
 *     opening / closing words (top-N).
 *
 * Provenance / identity:
 *   - $schemaVersion — version literal for forward migrations.
 *   - samplesDir     — resolved samples directory the profile was built from.
 *   - samplesAnalyzed — count of .md/.txt/.docx files analyzed (≥ 1).
 *   - fingerprint    — 64-hex SHA-256 of the sorted per-file content hashes;
 *                      stable for identical sample CONTENT (content-based, not
 *                      path+mtime). This is the value registered in the
 *                      cross-paper reuse registry.
 *   - generatedAt    — ISO timestamp of the build.
 */
export const StyleProfileSchema = z.object({
  $schemaVersion: z.literal(CURRENT_STYLE_VERSION),
  samplesDir: z.string().min(1),
  samplesAnalyzed: z.number().int().min(1),

  // Sentence-length quantiles (words).
  medianSentenceLength: z.number(),
  p25SentenceLength: z.number(),
  p75SentenceLength: z.number(),

  // Bounded ratios.
  typeTokenRatio: z.number().min(0).max(1),
  passiveVoiceRate: z.number().min(0).max(1),
  subordinatingClauseRate: z.number().min(0).max(1),

  // Paragraph shape + opening/closing word distributions.
  avgParagraphLengthSentences: z.number(),
  openingWordTopN: z.record(z.string(), z.number()),
  closingWordTopN: z.record(z.string(), z.number()),

  // Identity.
  fingerprint: z.string().length(64), // SHA-256 hex
  generatedAt: z.string().datetime(),
});

export type StyleProfile = z.infer<typeof StyleProfileSchema>;
