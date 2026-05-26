// tests/fixtures/synthetic-pdf-text.ts — Synthetic pdf-parse-output fixtures (D-06).
//
// Real PDFs are not committed to the repo (binary noise + licensing risk
// for academic test corpora). These string constants imitate what
// `pdf-parse` returns AFTER extracting text from typical academic PDFs.
// They drive offline determinism for:
//   - tests/known-bad-quotes.test.ts (Pass-3 quote verification)
//   - tests/sources/unpaywall.test.ts (full-text URL → bytes → text path)
//   - Future Pass-3 / Pass-1 fixture suites.
//
// Each fixture targets a specific normalize.ts code path: ligatures
// (U+FB01), soft hyphens (U+00AD), and the trivial accent-free case.
// SYNTHETIC_IMAGE_ONLY_FRAGMENT (REVIEWS amendment) drives the
// image-only WARN path in `bin/lib/pdf-text.ts → extractPdfText`.
//
// All four constants are plain `string` — they pretend to BE pdf-parse's
// `.text` output, not the binary input. Callers that want to round-trip
// through the chokepoint should treat these as the post-extraction
// reference string and stub pdf-parse for the byte → text step.

/** Excerpt from the Vaswani et al. 2017 abstract — accent-free, plain ASCII. */
export const SYNTHETIC_VASWANI_FRAGMENT = `
We propose a new simple network architecture, the Transformer,
based solely on attention mechanisms, dispensing with recurrence
and convolutions entirely.
`.trim();

/**
 * Includes U+FB01 ligature in 'final' to exercise the NFKC normalize step.
 * Without normalize, downstream substring search for the literal "final"
 * would miss this fragment.
 */
export const SYNTHETIC_LIGATURE_FRAGMENT = `
The ﬁnal layer applies a softmax over the vocabulary.
`.trim();

/**
 * Includes U+00AD soft hyphens at typical PDF line-break positions
 * ("trans" + SHY + "former" and "atten" + SHY + "tion"). The
 * normalize.ts step strips SHY before Pass-1 / Pass-3 substring search.
 */
export const SYNTHETIC_SOFTHYPHEN_FRAGMENT = `
The trans­former model uses self-atten­tion to process sequences.
`.trim();

/**
 * Image-only / scanned-PDF case (REVIEWS amendment, D-08-AMENDED).
 * `pdf-parse` returns empty / near-empty text for PDFs whose pages are
 * raster images with no embedded text layer (common with older corpora
 * pre-OCR). The extractor's image-only heuristic
 * (text.replace(/\s/g,'').length < 50) triggers on this fixture and the
 * caller's verify verb assigns UNVERIFIABLE rather than failed.
 */
export const SYNTHETIC_IMAGE_ONLY_FRAGMENT = '';
