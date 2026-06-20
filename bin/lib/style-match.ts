// bin/lib/style-match.ts — pure-stats style profiling + cross-paper reuse
// detection (STYL-01, STYL-02).
//
// =====================================================================
//   LOAD-BEARING NON-NEGOTIABLES (3 convergence cycles + 08-RESEARCH)
// =====================================================================
//
//   1. PURE-STATS, NO LLM AT PROFILE-BUILD. buildStyleProfile computes a
//      deterministic numeric profile (sentence-length quantiles, type-token
//      ratio, passive-voice + subordinating-clause heuristics, opening/closing
//      word frequency tables) directly from the sample text. No model call, no
//      network, no randomness — identical sample CONTENT yields an identical
//      profile + fingerprint. (08-RESEARCH Anti-Pattern: "no LLM at build".)
//
//   2. PER-PAPER STYLE.json ONLY — NO GLOBAL STYLE CACHE. writeStyleProfile
//      writes ONLY to <paperDir>/STYLE.json via atomicWriteFile. This module
//      does NOT import pensmithDataDir for its profile write target (Pitfall 1 /
//      T-08-02-01). Prose features live EXCLUSIVELY in the per-paper STYLE.json.
//
//   3. THE FINGERPRINT REGISTRY IS A PRIVACY-MINIMAL HASH→IDENTITY MAP.
//      checkAndRegisterFingerprint writes pensmithDataDir()/style-fingerprints.json
//      storing ONLY  { "<64-hex>": [ { paperId, paperName, addedAt } ] }.
//      It MUST NOT contain a "features" key (no prose-feature leak) NOR a
//      "folderPath"/absolute-path key (path-leak negative control). The 08-00
//      RED test asserts both absences. If a surfacing notice needs the other
//      paper's folder, the caller resolves it from the GLOBAL PAPER registry by
//      paperId — it is NOT stored here.
//
//   4. REUSE NOTICE IS THE CALLER'S RESPONSIBILITY AND IS UNCONDITIONAL.
//      checkAndRegisterFingerprint only DETECTS + RETURNS priorPapers (the
//      earlier papers that shared this fingerprint). It does NOT gate, prompt,
//      or print. The live caller is the intake style-match opt-in producer
//      (08-05), which surfaces the cross-paper-reuse notice UNCONDITIONALLY
//      (NOT --yolo-gated) per STYL-02 / Pitfall 2.
//
// Chokepoints used: atomicWriteFile (D-07) for both the STYLE.json write and the
// registry write; withLock (D-26) around the registry read-mutate-write so
// concurrent intakes can't clobber each other (T-08-02-04). JSZip reads .docx
// (mirrors bin/lib/exporter.ts). path.resolve(samplesDir) before any read is the
// path-traversal mitigation (T-08-02-03); only .md/.txt/.docx files are read.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { pensmithStyleFingerprintsPath } from './paths.js';
import {
  StyleProfileSchema,
  CURRENT_STYLE_VERSION,
  type StyleProfile,
} from './schemas/style.js';

// ---------------------------------------------------------------------------
// Fingerprint registry record shape (cross-paper-reuse DETECTION only).
//
// On disk: { "<64-hex-fingerprint>": PriorPaper[] }. Hashes + paper identity
// ONLY — NO "features" key, NO "folderPath"/path key (Pitfall 1).
// ---------------------------------------------------------------------------

export interface PriorPaper {
  paperId: string;
  paperName: string;
  addedAt: string;
}

type FingerprintRegistry = Record<string, PriorPaper[]>;

const SAMPLE_EXT_RE = /\.(md|txt|docx)$/i;

// Subordinating conjunctions for the subordinating-clause heuristic (08-RESEARCH
// Pattern 3). Small deliberate list — the rate is a coarse style signal, not a
// parser.
const SUBORDINATORS = [
  'because',
  'although',
  'though',
  'while',
  'since',
  'whereas',
  'if',
  'when',
  'unless',
  'until',
  'whenever',
  'wherever',
];
const SUBORDINATOR_RE = new RegExp(`\\b(${SUBORDINATORS.join('|')})\\b`, 'gi');

// Passive-voice heuristic: a "to be" auxiliary followed by a past participle
// (…ed). Coarse by design (08-RESEARCH Pattern 3) — the fixtures are passive-
// heavy ("was studied", "were asked", "was interpreted") so the rate is > 0.
const PASSIVE_RE = /\b(?:was|were|is|are|been|be|being)\s+\w+ed\b/gi;

const TOP_N = 10;

// ---------------------------------------------------------------------------
// Pure helpers (no I/O).
// ---------------------------------------------------------------------------

/**
 * Read one sample file's text. .docx is unzipped via JSZip and word/document.xml
 * is stripped of XML tags (mirrors exporter.ts JSZip usage); .md/.txt are read
 * as UTF-8. Returns the raw text body.
 */
async function readSampleText(absFile: string): Promise<string> {
  if (/\.docx$/i.test(absFile)) {
    const buf = await fs.promises.readFile(absFile);
    const zip = await JSZip.loadAsync(buf);
    const doc = zip.file('word/document.xml');
    if (!doc) return '';
    const xml = await doc.async('string');
    // Insert spaces at paragraph/break boundaries so adjacent runs don't fuse,
    // then strip all remaining tags.
    return xml
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<w:br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
  }
  return fs.promises.readFile(absFile, 'utf8');
}

/** Sentence segmentation: split on sentence-final punctuation + space + capital. */
function segmentSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Tokenize to lowercase word tokens ([a-z0-9'] runs). */
function tokenize(text: string): string[] {
  const m = text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g);
  return m ?? [];
}

/** Linear-interpolation quantile of a sorted numeric array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] as number;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

/** Round to 4 decimals so the profile is stable / readable (still deterministic). */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Top-N frequency table from a list of words (insertion order is deterministic). */
function topN(words: string[], n: number): Record<string, number> {
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // count desc
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; // word asc (tie-break, deterministic)
  });
  const out: Record<string, number> = {};
  for (const [word, count] of sorted.slice(0, n)) out[word] = count;
  return out;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Build a deterministic PURE-STATS style profile from a folder of writing
 * samples (.md / .txt / .docx). NO LLM, NO network, NO randomness — identical
 * sample CONTENT yields an identical profile + fingerprint.
 *
 * Throws when the resolved directory contains zero matching files.
 *
 * The fingerprint is sha256 of the sorted per-file content hashes (content-based
 * so reordering / renaming files does not change it) — the value registered in
 * the cross-paper reuse registry.
 */
export async function buildStyleProfile(samplesDir: string): Promise<StyleProfile> {
  // Path-traversal mitigation (T-08-02-03): resolve before any read.
  const resolved = path.resolve(samplesDir);

  const files = (await fs.promises.readdir(resolved))
    .filter((f) => SAMPLE_EXT_RE.test(f))
    .sort(); // deterministic order

  if (files.length === 0) {
    throw new Error(
      `buildStyleProfile: no .md/.txt/.docx writing samples found in ${resolved}`,
    );
  }

  // Content-hash fingerprint: hash each file's bytes, sort the hashes, hash the
  // join. Content-based (not path+mtime) so the same content always fingerprints
  // identically across machines / orderings.
  const perFileHashes: string[] = [];
  const texts: string[] = [];
  for (const f of files) {
    const abs = path.join(resolved, f);
    const bytes = await fs.promises.readFile(abs);
    perFileHashes.push(createHash('sha256').update(bytes).digest('hex'));
    texts.push(await readSampleText(abs));
  }
  const fingerprint = createHash('sha256')
    .update([...perFileHashes].sort().join(''))
    .digest('hex');

  const combined = texts.join('\n\n');

  // Sentence-level features.
  const sentences = segmentSentences(combined);
  const sentenceLengths = sentences
    .map((s) => tokenize(s).length)
    .filter((n) => n > 0);
  const sortedLengths = [...sentenceLengths].sort((a, b) => a - b);

  const medianSentenceLength = round4(quantile(sortedLengths, 0.5));
  const p25SentenceLength = round4(quantile(sortedLengths, 0.25));
  const p75SentenceLength = round4(quantile(sortedLengths, 0.75));

  // Type-token ratio over all word tokens.
  const allWords = tokenize(combined);
  const totalWords = allWords.length;
  const uniqueWords = new Set(allWords).size;
  const typeTokenRatio = totalWords === 0 ? 0 : round4(uniqueWords / totalWords);

  // Passive-voice + subordinating-clause rates, normalized per sentence (clamped
  // to [0,1] — a sentence can match more than once, the schema bounds it).
  const sentenceCount = Math.max(1, sentences.length);
  const passiveHits = (combined.match(PASSIVE_RE) ?? []).length;
  const subordinatorHits = (combined.match(SUBORDINATOR_RE) ?? []).length;
  const passiveVoiceRate = round4(Math.min(1, passiveHits / sentenceCount));
  const subordinatingClauseRate = round4(
    Math.min(1, subordinatorHits / sentenceCount),
  );

  // Paragraph shape: blank-line-delimited paragraphs across the joined text.
  const paragraphs = combined
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const avgParagraphLengthSentences =
    paragraphs.length === 0
      ? 0
      : round4(
          paragraphs.reduce((acc, p) => acc + segmentSentences(p).length, 0) /
            paragraphs.length,
        );

  // Opening / closing word frequency tables.
  const openingWords = sentences
    .map((s) => tokenize(s)[0])
    .filter((w): w is string => typeof w === 'string');
  const closingWords = sentences
    .map((s) => {
      const t = tokenize(s);
      return t[t.length - 1];
    })
    .filter((w): w is string => typeof w === 'string');

  // Deterministic, non-wall-clock generatedAt: derived from the fingerprint so
  // the profile is byte-stable across builds of the same samples (the test
  // asserts deepEqual on two builds — a Date.now() here would break it).
  const generatedAt = deterministicTimestamp(fingerprint);

  return StyleProfileSchema.parse({
    $schemaVersion: CURRENT_STYLE_VERSION,
    samplesDir: resolved,
    samplesAnalyzed: files.length,
    medianSentenceLength,
    p25SentenceLength,
    p75SentenceLength,
    typeTokenRatio,
    passiveVoiceRate,
    subordinatingClauseRate,
    avgParagraphLengthSentences,
    openingWordTopN: topN(openingWords, TOP_N),
    closingWordTopN: topN(closingWords, TOP_N),
    fingerprint,
    generatedAt,
  });
}

/**
 * Derive a stable ISO timestamp from the fingerprint so two builds of identical
 * samples produce byte-identical profiles (determinism > wall-clock accuracy
 * for a content-addressed artifact). Maps the first 8 hex chars of the
 * fingerprint into a fixed epoch window.
 */
function deterministicTimestamp(fingerprint: string): string {
  const seed = parseInt(fingerprint.slice(0, 8), 16);
  // Anchor at 2020-01-01 + (seed mod ~10 years in seconds), so it's a plausible
  // ISO datetime that is stable for a given fingerprint.
  const base = Date.UTC(2020, 0, 1) / 1000;
  const offset = seed % (10 * 365 * 24 * 60 * 60);
  return new Date((base + offset) * 1000).toISOString();
}

/**
 * Write the style profile to <paperDir>/STYLE.json — PER-PAPER ONLY.
 *
 * Uses atomicWriteFile (D-07). MUST NOT write under pensmithDataDir: prose
 * features never leave the paper (Pitfall 1 / T-08-02-01). path.resolve(paperDir)
 * so the target is unambiguous regardless of relative/absolute input.
 */
export async function writeStyleProfile(
  paperDir: string,
  profile: StyleProfile,
): Promise<void> {
  const target = path.join(path.resolve(paperDir), 'STYLE.json');
  await atomicWriteFile(target, JSON.stringify(profile, null, 2) + '\n');
}

/**
 * Detect cross-paper sample reuse and register this paper's fingerprint.
 *
 * Signature takes ONLY the fingerprint hash + paper identity (paperId,
 * paperName) — it does NOT accept or store a folderPath (Pitfall 1). The
 * registry on disk is a privacy-minimal hash→identity map.
 *
 * Returns `{ priorPapers }`: the earlier papers (DIFFERENT paperId) already
 * registered under this fingerprint, captured BEFORE appending the current one.
 * The CALLER (08-05 intake producer) surfaces the reuse notice UNCONDITIONALLY.
 *
 * Concurrency: the whole read-mutate-write runs inside withLock (T-08-02-04);
 * the registry is read tolerantly (ENOENT → empty), the current paper is
 * appended (never overwriting prior entries), and the result is atomicWriteFile'd.
 */
export async function checkAndRegisterFingerprint(
  fingerprint: string,
  paperId: string,
  paperName: string,
): Promise<{ priorPapers: PriorPaper[] }> {
  const registryPath = pensmithStyleFingerprintsPath();
  await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });

  let priorPapers: PriorPaper[] = [];

  await withLock(registryPath, async () => {
    const registry = await loadRegistry(registryPath);

    const existing = registry[fingerprint] ?? [];
    // Reuse = prior entries under this fingerprint for a DIFFERENT paperId.
    priorPapers = existing.filter((p) => p.paperId !== paperId);

    // Append the current paper unless it's already recorded (idempotent re-runs).
    if (!existing.some((p) => p.paperId === paperId)) {
      existing.push({
        paperId,
        paperName,
        addedAt: new Date().toISOString(),
      });
    }
    registry[fingerprint] = existing;

    await atomicWriteFile(registryPath, JSON.stringify(registry, null, 2) + '\n');
  });

  return { priorPapers };
}

/** Load the fingerprint registry, tolerant of an absent/corrupt file (→ {}). */
async function loadRegistry(registryPath: string): Promise<FingerprintRegistry> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(registryPath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') return {};
    throw e;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as FingerprintRegistry;
    }
    return {};
  } catch {
    // Corrupt JSON — start fresh rather than abort the whole intake.
    return {};
  }
}

/**
 * Render the profile into a natural-language voice hint for the drafter (STYL-03).
 * PURE — no I/O. This is the load-bearing signal the section drafter consumes;
 * the raw profile is supplementary. Wired into `write` in 08-05.
 */
export function styleMatchToVoiceHint(profile: StyleProfile): string {
  const median = Math.round(profile.medianSentenceLength);
  const ttr = profile.typeTokenRatio.toFixed(2);
  const passivePct = Math.round(profile.passiveVoiceRate * 100);
  const openers = Object.keys(profile.openingWordTopN).slice(0, 3);
  const subPct = Math.round(profile.subordinatingClauseRate * 100);

  const parts = [
    `Match this established voice: median sentence ~${median} words`,
    `(range ${Math.round(profile.p25SentenceLength)}-${Math.round(profile.p75SentenceLength)})`,
    `vocabulary density ${ttr}`,
    `roughly ${passivePct}% passive constructions`,
    `~${subPct}% subordinating clauses`,
    `~${Math.round(profile.avgParagraphLengthSentences)} sentences per paragraph`,
  ];
  let hint = parts.join(', ') + '.';
  if (openers.length > 0) {
    hint += ` Common sentence openers: ${openers.join(', ')}.`;
  }
  return hint;
}
