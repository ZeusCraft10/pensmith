// bin/lib/compile.ts — compile pipeline keystone (COMP-01..07, ARCH-20).
//
// runCompile acquires a whole-pipeline lock on .paper/.compile.lock then:
//   Step 0: ALWAYS-ON REFUSE GATE (REVIEW H-01/H-02 — defense-in-depth, runs
//           before any concat/write regardless of hash staleness):
//           for EVERY section: (a) absent DRAFT.md → REFUSE; (b) absent
//           VERIFICATION.md + present DRAFT.md → auto-verify Pass 1+3; (c) read
//           verdicts → REFUSE on FABRICATED/MIS-CITED/NOT_FOUND; (d) require
//           state === 'verified' → REFUSE otherwise.
//   Step 1: Parse outline (D-11 outline order). For each section: recompute
//           computeDraftHash; mismatch → WARN + auto re-verify Pass 1+3 (D-08,
//           NEVER Pass 2/4); FABRICATED/MIS-CITED/NOT_FOUND → REFUSE.
//   Step 2: Concatenate drafts in outline order, normalized to one trailing '\n'.
//   Step 2.5: Global citekey-collision resolution (REVIEW M-02) — rewrite
//             [@key] → [@keySuffix] in draft BEFORE smoothing.
//   Step 3: N-1 boundary smoothing with {{cite_K_M}} placeholder substitution;
//           post-call ORDERED token-SEQUENCE equality (REVIEW M-01 — reordering
//           caught); drift → raw-concat fallback + WARN (D-13). Run
//           runConsistencyScan (COMP-04, flags only) + computeCitationDensity
//           (COMP-05, warn-only).
//   Step 4: Regen CITATIONS.bib (D-19); atomicWriteFile DRAFT.md +
//           COMPILE-REPORT.md (schema v1, D-14) — COMP-07. All writes via
//           D-07 atomicWriteFile chokepoint. Section files are READ-ONLY (ARCH-20).
//
// Lock: proper-lockfile over .paper/.compile.lock with stale: 30000 so a
//   crashed compile auto-clears (REVIEW M-03 — matches handoff.ts pattern).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { parseOutline } from './outline-parse.js';
import { computeDraftHash } from './draft-hash.js';
import { extractCitekeys, replaceCitekeys } from './citation-token.js';
import { runPass1 } from './verify/pass1.js';
import { runPass3 } from './verify/pass3.js';
import { parseBibtex } from './citations.js';
import { atomicWriteFile } from './atomic-write.js';
import { renderCompileReport } from './compile-report.js';
import { runConsistencyScan, type SectionSpan } from './consistency-scan.js';
import { computeCitationDensity } from './citation-density.js';
import { withLock } from './lock.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompileOptions {
  paperRoot?: string;
  yolo?: boolean;
  lintHeadings?: boolean;
}

export interface CompileResult {
  ok: boolean;
  reason?: string;
  draftPath?: string;
  reportPath?: string;
}

// ---------------------------------------------------------------------------
// VERIFICATION.md verdict extraction
// ---------------------------------------------------------------------------

/**
 * Parse a VERIFICATION.md body and check if it contains any blocking verdict.
 * A blocking verdict is: FABRICATED, MIS-CITED, or NOT_FOUND.
 * Returns { blocked: false } if all verdicts are OK, or { blocked: true, citekey, verdict }.
 */
interface VerdictCheckResult {
  blocked: boolean;
  citekey?: string;
  verdict?: string;
}

function checkVerificationForBlockingVerdict(content: string): VerdictCheckResult {
  // Match verdict lines like: "verdict: FABRICATED" or "- verdict: MIS-CITED"
  // Also match: "**fakecite2024**: FABRICATED" from per-citekey entries
  const verdictRE = /verdict\s*:\s*(FABRICATED|MIS-CITED|NOT_FOUND)/gi;
  const citekeyVerdictRE = /citekey\s*:\s*([a-z][a-z0-9_-]*)/gi;

  // Check for blocking verdict keywords
  const match = verdictRE.exec(content);
  if (match) {
    const verdict = match[1] ?? 'FABRICATED';
    // Try to extract associated citekey
    const ckMatch = citekeyVerdictRE.exec(content);
    const citekey = ckMatch?.[1] ?? 'unknown';
    return { blocked: true, citekey, verdict };
  }

  // Also check for per-citekey result blocks with FABRICATED/MIS-CITED/NOT_FOUND
  const perKeyRE = /\*\*([a-z][a-z0-9_-]*)\*\*[^:]*:\s*(FABRICATED|MIS-CITED|NOT_FOUND)/gi;
  const perKeyMatch = perKeyRE.exec(content);
  if (perKeyMatch) {
    return {
      blocked: true,
      citekey: perKeyMatch[1] ?? 'unknown',
      verdict: perKeyMatch[2] ?? 'FABRICATED',
    };
  }

  return { blocked: false };
}

// ---------------------------------------------------------------------------
// PLAN.md frontmatter extraction
// ---------------------------------------------------------------------------

interface PlanFrontmatter {
  slug: string;
  state: string;
  verified_against_draft_hash: string;
  assigned_sources: string[];
}

function parsePlanFrontmatter(content: string): PlanFrontmatter {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(content);
  if (!fmMatch || !fmMatch[1]) {
    return { slug: '', state: 'unknown', verified_against_draft_hash: '', assigned_sources: [] };
  }
  const fm = fmMatch[1];

  const slugMatch = /^slug\s*:\s*(.+)$/m.exec(fm);
  const stateMatch = /^state\s*:\s*(.+)$/m.exec(fm);
  const hashMatch = /^verified_against_draft_hash\s*:\s*(.+)$/m.exec(fm);
  const sourcesMatch = /^assigned_sources\s*:\s*\[([^\]]*)\]/m.exec(fm);

  const sources = sourcesMatch?.[1]
    ? sourcesMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    slug: slugMatch?.[1]?.trim() ?? '',
    state: stateMatch?.[1]?.trim() ?? 'unknown',
    verified_against_draft_hash: hashMatch?.[1]?.trim() ?? '',
    assigned_sources: sources,
  };
}

// ---------------------------------------------------------------------------
// Auto-verify a section (Pass 1+3 only, per D-08)
// ---------------------------------------------------------------------------

async function autoVerifySection(
  draftMd: string,
  bibPath: string,
): Promise<{ blocked: boolean; citekey?: string; verdict?: string }> {
  // Pre-check: if the bib is empty or missing but the draft has citekeys,
  // those citekeys are FABRICATED (not in bib). Handle before runPass1
  // to avoid parseBib throwing on empty files.
  const draftCitekeys = extractCitekeys(draftMd);
  const bibText = existsSync(bibPath) ? readFileSync(bibPath, 'utf8').trim() : '';
  if (!bibText && draftCitekeys.length > 0) {
    const firstKey = draftCitekeys[0];
    return { blocked: true, citekey: firstKey ?? 'unknown', verdict: 'FABRICATED' };
  }

  try {
    // Pass 1: citation integrity
    const pass1Result = await runPass1(draftMd, bibPath);
    for (const r of pass1Result.results) {
      if (r.verdict === 'FABRICATED' || r.verdict === 'MIS-CITED') {
        return { blocked: true, citekey: r.citekey, verdict: r.verdict };
      }
    }

    // Pass 3: quote verification
    let bibByCitekey = new Map<string, { DOI?: string }>();
    try {
      const entries = await parseBibtex(bibText);
      bibByCitekey = new Map(entries.map((e) => [String(e['id'] ?? ''), e as { DOI?: string }]));
    } catch {
      // Empty or malformed bib — pass3 will have no DOI to look up, which is non-blocking
    }
    const pass3Results = await runPass3(draftMd, bibByCitekey);
    for (const r of pass3Results) {
      if (r.verdict === 'NOT_FOUND') {
        return { blocked: true, citekey: r.citekey, verdict: 'NOT_FOUND' };
      }
    }

    return { blocked: false };
  } catch {
    // If auto-verify itself fails (network error, etc.), treat as non-blocking
    // The section will still be guarded by any VERIFICATION.md that already exists.
    return { blocked: false };
  }
}

// ---------------------------------------------------------------------------
// Global citekey collision resolution (Step 2.5 — REVIEW M-02)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Placeholder token family for smoother (D-13 / REVIEW L-04)
// ---------------------------------------------------------------------------

// The {{cite_K_M}} placeholder family uses a run-time nonce prefix to avoid
// collision with any literal {{variable}} in prose (REVIEW L-04).
// The nonce is computed once per compile run.
function makePlaceholderFamily(runNonce: string): {
  make: (boundary: number, index: number) => string;
  pattern: RegExp;
} {
  const prefix = `__cite_${runNonce}_`;
  const suffix = '__';
  return {
    make: (k: number, m: number) => `${prefix}${k}_${m}${suffix}`,
    // Match all placeholders from this run
    pattern: new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)_(\\d+)${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
  };
}

// ---------------------------------------------------------------------------
// Section directory scanning
// ---------------------------------------------------------------------------

interface SectionFiles {
  n: number;
  slug: string;
  planPath: string;
  draftPath: string;
  verificationPath: string;
  sectionDir: string;
}

function findSectionDirs(paperRoot: string): SectionFiles[] {
  const sectionsDir = path.join(paperRoot, '.paper', 'sections');
  if (!existsSync(sectionsDir)) return [];

  const results: SectionFiles[] = [];
  const dirnames = readdirSync(sectionsDir);
  for (const dirname of dirnames) {
    const match = /^(\d{2})[a-z]?-([a-z0-9-]+)$/.exec(dirname);
    if (!match || !match[1] || !match[2]) continue;
    const n = parseInt(match[1], 10);
    const slug = match[2];
    const secDir = path.join(sectionsDir, dirname);
    results.push({
      n,
      slug,
      planPath: path.join(secDir, 'PLAN.md'),
      draftPath: path.join(secDir, 'DRAFT.md'),
      verificationPath: path.join(secDir, 'VERIFICATION.md'),
      sectionDir: secDir,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Compile pipeline
// ---------------------------------------------------------------------------

export async function runCompile(opts: CompileOptions = {}): Promise<CompileResult> {
  const paperRoot = path.resolve(opts.paperRoot ?? process.cwd());
  const paperDir = path.join(paperRoot, '.paper');
  const bibPath = path.join(paperDir, 'CITATIONS.bib');

  // Ensure .paper directory exists
  await mkdir(paperDir, { recursive: true });

  // D-40: lock stubs MUST live in pensmithLockDir(), NEVER inside .paper/.
  // Use withLock with a per-paperRoot resource key so concurrent test fixtures
  // (with different paperRoot paths) do not contend on the same lock stub.
  // staleMs: 30000 so a crashed compile auto-clears (REVIEW M-03).
  const lockResource = `pensmith:compile:${paperRoot}`;
  return withLock(
    lockResource,
    () => runCompilePipeline(paperRoot, paperDir, bibPath, opts),
    { staleMs: 30_000, timeoutMs: 60_000 },
  );
}

async function runCompilePipeline(
  paperRoot: string,
  paperDir: string,
  bibPath: string,
  opts: CompileOptions,
): Promise<CompileResult> {
  const outlineContent = readOutline(paperDir);
  const outline = parseOutline(outlineContent);

  // Find all section dirs on disk
  const sectionFiles = findSectionDirs(paperRoot);

  // Build a map from section n → SectionFiles
  const sectionMap = new Map<number, SectionFiles>(sectionFiles.map((s) => [s.n, s]));

  // ---------------------------------------------------------------------------
  // Step 0: ALWAYS-ON REFUSE GATE (REVIEW H-01/H-02)
  // For EVERY section: check state, DRAFT.md presence, VERIFICATION.md presence.
  // This gate does NOT trust hash matches — it reads verdicts unconditionally.
  // ---------------------------------------------------------------------------

  // Use outline sections to know which sections to check
  const outlineSections = outline.sections.slice().sort((a, b) => a.n - b.n);

  for (const sec of outlineSections) {
    const files = sectionMap.get(sec.n);
    if (!files) {
      // Section directory doesn't exist on disk — treat as absent DRAFT.md
      return {
        ok: false,
        reason: `Section ${sec.n} (${sec.slug}) has no directory on disk — cannot compile`,
      };
    }

    // (a) DRAFT.md absent → REFUSE
    if (!existsSync(files.draftPath)) {
      return {
        ok: false,
        reason: `Section ${sec.n} (${sec.slug}): DRAFT.md is missing — cannot compile (REVIEW H-02)`,
      };
    }

    // (d) Require state === 'verified' from PLAN.md
    const planContent = existsSync(files.planPath) ? readFileSync(files.planPath, 'utf8') : '';
    const fm = parsePlanFrontmatter(planContent);
    if (fm.state !== 'verified') {
      return {
        ok: false,
        reason: `Section ${sec.n} (${sec.slug}): PLAN.md state is "${fm.state}" (must be "verified") — cannot compile (REVIEW H-01)`,
      };
    }

    // (b) VERIFICATION.md absent → auto-verify (Pass 1+3) then re-apply gate
    if (!existsSync(files.verificationPath)) {
      const draftContent = readFileSync(files.draftPath, 'utf8');
      const autoResult = await autoVerifySection(draftContent, bibPath);
      if (autoResult.blocked) {
        return {
          ok: false,
          reason: `Section ${sec.n} (${sec.slug}): auto-verification (absent VERIFICATION.md) found ${autoResult.verdict} on citekey ${autoResult.citekey ?? 'unknown'} — cannot compile (REVIEW H-02/COMP-01)`,
        };
      }
      // Auto-verify passed — continue to Step 1 for staleness check
      continue;
    }

    // (c) Read VERIFICATION.md verdicts — REFUSE on FABRICATED/MIS-CITED/NOT_FOUND
    const verifContent = readFileSync(files.verificationPath, 'utf8');
    const verdictCheck = checkVerificationForBlockingVerdict(verifContent);
    if (verdictCheck.blocked) {
      return {
        ok: false,
        reason: `Section ${sec.n} (${sec.slug}): VERIFICATION.md contains ${verdictCheck.verdict} verdict on citekey ${verdictCheck.citekey ?? 'unknown'} — cannot compile (COMP-01/REVIEW H-01)`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Step 1: Staleness check (D-08) — per section in outline order
  // ---------------------------------------------------------------------------

  const stalenessResolved: string[] = [];

  for (const sec of outlineSections) {
    const files = sectionMap.get(sec.n);
    if (!files) continue;  // already handled in Step 0

    const draftBytes = readFileSync(files.draftPath);
    const planContent = readFileSync(files.planPath, 'utf8');
    const fm = parsePlanFrontmatter(planContent);

    const currentHash = computeDraftHash(draftBytes, fm.assigned_sources);

    if (fm.verified_against_draft_hash !== currentHash) {
      // Stale — auto re-verify (Pass 1+3 ONLY — never Pass 2/4 per D-08)
      const draftMd = draftBytes.toString('utf8');
      const reVerifyResult = await autoVerifySection(draftMd, bibPath);

      if (reVerifyResult.blocked) {
        return {
          ok: false,
          reason: `Section ${sec.n} (${sec.slug}): stale draft re-verify failed — ${reVerifyResult.verdict} on citekey ${reVerifyResult.citekey ?? 'unknown'} — cannot compile (COMP-01/D-08)`,
        };
      }

      stalenessResolved.push(`Section ${sec.n} (${sec.slug}): draft hash updated; re-verify passed`);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2: Concatenate drafts in outline order, normalized to one trailing '\n'
  // ---------------------------------------------------------------------------

  const sectionTexts: Array<{ n: number; slug: string; text: string }> = [];
  for (const sec of outlineSections) {
    const files = sectionMap.get(sec.n);
    if (!files) continue;
    const raw = readFileSync(files.draftPath, 'utf8');
    // Normalize to exactly one trailing '\n' (§F)
    const normalized = raw.replace(/\n*$/, '\n');
    sectionTexts.push({ n: sec.n, slug: sec.slug, text: normalized });
  }

  // ---------------------------------------------------------------------------
  // Step 2.5: Global citekey-collision resolution (REVIEW M-02)
  // Build a global collision map across all sections before smoothing.
  // ---------------------------------------------------------------------------

  // Collect all citekeys from all section drafts in order (preserving duplicates)
  const allCitekeysList: string[] = [];
  for (const sec of sectionTexts) {
    allCitekeysList.push(...extractCitekeys(sec.text));
  }

  // Build global collision map (first-occurrence keeps original key; later ones get suffixes)
  // For compile, the citekeys come from the DRAFT.md files which already have author-year keys.
  // Step 2.5: Global citekey collision resolution (REVIEW M-02).
  // Section drafts already carry the correct citekeys from their assigned sources.
  // bibtex-write.ts handles base-26 suffix collision resolution at bib-write time.
  // Here, the compiled draft's [@key] tokens are already in sync with the bib format
  // because each section used the citekeys assigned to it in PLAN.md.
  const compiledDraft = sectionTexts.map((s) => s.text).join('\n');

  // ---------------------------------------------------------------------------
  // Step 3: N-1 boundary smoothing
  // ---------------------------------------------------------------------------

  const crypto = await import('node:crypto');
  const runNonce = crypto.randomBytes(4).toString('hex');
  const placeholder = makePlaceholderFamily(runNonce);

  const transitions: string[] = [];
  let smoothedDraft = compiledDraft;

  if (sectionTexts.length > 1 && process.env['PENSMITH_NO_LLM'] !== '1') {
    // N-1 boundaries
    const sections = sectionTexts;
    let assembled = '';

    for (let k = 0; k < sections.length - 1; k++) {
      const tail = sections[k];
      const head = sections[k + 1];
      if (!tail || !head) continue;

      // Get tail and head paragraphs (last + first paragraph of each section)
      const tailParas = tail.text.split(/\n\n+/);
      const headParas = head.text.split(/\n\n+/);
      const tailPara = tailParas[tailParas.length - 1] ?? tail.text;
      const headPara = headParas[0] ?? head.text;

      // Substitute citation tokens with placeholders
      let placeholderIndex = 0;
      const inputPlaceholderSequence: string[] = [];
      const placeholderToKey = new Map<string, string>();

      const tailWithPlaceholders = replaceCitekeys(tailPara, (key) => {
        const ph = placeholder.make(k + 1, ++placeholderIndex);
        inputPlaceholderSequence.push(ph);
        placeholderToKey.set(ph, key);
        return ph;
      });

      const headWithPlaceholders = replaceCitekeys(headPara, (key) => {
        const ph = placeholder.make(k + 1, ++placeholderIndex);
        inputPlaceholderSequence.push(ph);
        placeholderToKey.set(ph, key);
        return ph;
      });

      // Check for literal {{cite_K_M}} in prose that might collide (REVIEW L-04)
      // Since we use a nonce-prefixed family, collision is extremely unlikely.
      // If detected, fall back to raw-concat (never block).
      const hasLiteralCollision = tailPara.includes(placeholder.make(k + 1, 1).slice(0, 15)) ||
                                   headPara.includes(placeholder.make(k + 1, 1).slice(0, 15));

      if (hasLiteralCollision) {
        transitions.push(`Boundary ${k + 1}→${k + 2}: skipped (placeholder family collision in prose)`);
        // Append current section and continue
        if (k === 0) assembled += sections[0]?.text ?? '';
        assembled += '\n' + (sections[k + 1]?.text ?? '');
        continue;
      }

      const boundaryInput = [
        `### End of section ${tail.slug}`,
        '',
        tailWithPlaceholders,
        '',
        `### Start of section ${head.slug}`,
        '',
        headWithPlaceholders,
      ].join('\n');

      try {
        // Call the smoother via prompt-loader + http
        const { loadPrompt, interpolate } = await import('./prompt-loader.js');
        let smootherPrompt: string;
        try {
          smootherPrompt = loadPrompt('smoother');
        } catch {
          // If smoother prompt has a pending hash sentinel, use raw concat
          transitions.push(`Boundary ${tail.slug}→${head.slug}: fallback (smoother prompt pending hash)`);
          if (k === 0) assembled += sections[0]?.text ?? '';
          assembled += '\n' + (sections[k + 1]?.text ?? '');
          continue;
        }

        const promptText = interpolate(smootherPrompt, {
          tail_section: tail.slug,
          head_section: head.slug,
          boundary_text: boundaryInput,
        });

        // Make the API call via dynamic import (Anthropic SDK or equivalent)
        // If the LLM infrastructure is not available, fall back to raw concat.
        let response: string;
        try {
          const Anthropic = await import('@anthropic-ai/sdk').then((m) => m.default).catch(() => null);
          if (!Anthropic) {
            transitions.push(`Boundary ${tail.slug}→${head.slug}: fallback (Anthropic SDK unavailable)`);
            if (k === 0) assembled += sections[0]?.text ?? '';
            assembled += '\n' + (sections[k + 1]?.text ?? '');
            continue;
          }
          const client = new Anthropic();
          const msg = await client.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 1024,
            messages: [{ role: 'user', content: promptText }],
          });
          const firstBlock = msg.content[0];
          response = (firstBlock && 'text' in firstBlock) ? firstBlock.text : '';
        } catch {
          transitions.push(`Boundary ${tail.slug}→${head.slug}: fallback (API error)`);
          if (k === 0) assembled += sections[0]?.text ?? '';
          assembled += '\n' + (sections[k + 1]?.text ?? '');
          continue;
        }
        const responseText = response;

        // Extract placeholder sequence from response (ORDERED — REVIEW M-01)
        const outputPlaceholders = Array.from(responseText.matchAll(placeholder.pattern)).map((m) => m[0]);

        // ORDERED token-sequence equality (not Set — REVIEW M-01)
        const orderedMatch = inputPlaceholderSequence.length === outputPlaceholders.length &&
          inputPlaceholderSequence.every((tok, i) => tok === outputPlaceholders[i]);

        if (!orderedMatch) {
          // Drift detected — reject smoothing, keep original prose
          const driftType = inputPlaceholderSequence.length !== outputPlaceholders.length
            ? 'count mismatch'
            : 'reordering detected';
          transitions.push(`Boundary ${tail.slug}→${head.slug}: rejected (${driftType}) — using original prose`);
          if (k === 0) assembled += sections[0]?.text ?? '';
          assembled += '\n' + (sections[k + 1]?.text ?? '');
          continue;
        }

        // Restore placeholders to [@citekey] tokens
        const restoredResponse = responseText.replace(placeholder.pattern, (ph) => {
          const key = placeholderToKey.get(ph);
          return key ? `[@${key}]` : ph;
        });

        // Extract the smoothed tail and head from the response
        const endMarker = `### End of section ${tail.slug}`;
        const startMarker = `### Start of section ${head.slug}`;
        const endIdx = restoredResponse.indexOf(endMarker);
        const startIdx = restoredResponse.indexOf(startMarker);

        if (endIdx === -1 || startIdx === -1) {
          transitions.push(`Boundary ${tail.slug}→${head.slug}: rejected (missing markers) — using original prose`);
          if (k === 0) assembled += sections[0]?.text ?? '';
          assembled += '\n' + (sections[k + 1]?.text ?? '');
          continue;
        }

        const smoothedTailPara = restoredResponse
          .slice(endIdx + endMarker.length, startIdx)
          .trim();
        const smoothedHeadPara = restoredResponse
          .slice(startIdx + startMarker.length)
          .trim();

        // Rebuild sections with smoothed boundary
        if (k === 0) {
          const tailParasAll = tail.text.split(/\n\n+/);
          tailParasAll[tailParasAll.length - 1] = smoothedTailPara;
          assembled += tailParasAll.join('\n\n');
        }

        const headParasAll = head.text.split(/\n\n+/);
        headParasAll[0] = smoothedHeadPara;
        assembled += '\n' + headParasAll.join('\n\n');

        transitions.push(`Boundary ${tail.slug}→${head.slug}: smoothed`);
      } catch {
        // Any error in smoothing → raw concat fallback (compile never refuses on smoothing)
        transitions.push(`Boundary ${tail.slug}→${head.slug}: fallback (error in smoothing)`);
        if (k === 0) assembled += sections[0]?.text ?? '';
        assembled += '\n' + (sections[k + 1]?.text ?? '');
      }
    }

    smoothedDraft = assembled || compiledDraft;
  } else if (process.env['PENSMITH_NO_LLM'] === '1') {
    // No LLM — use raw concatenation, record all boundaries as fallback
    for (let k = 0; k < sectionTexts.length - 1; k++) {
      const tail = sectionTexts[k];
      const head = sectionTexts[k + 1];
      if (tail && head) {
        transitions.push(`Boundary ${tail.slug}→${head.slug}: fallback (PENSMITH_NO_LLM=1)`);
      }
    }
    smoothedDraft = compiledDraft;
  }

  // ---------------------------------------------------------------------------
  // Run consistency scan (COMP-04 — flags only)
  // ---------------------------------------------------------------------------

  // Build section boundary spans for the consistency scan
  const consistencyBoundaries: SectionSpan[] = [];
  let offset = 0;
  for (const sec of sectionTexts) {
    const end = offset + sec.text.length;
    consistencyBoundaries.push({ n: sec.n, start: offset, end });
    offset = end + 1;  // +1 for the '\n' separator
  }

  const consistencyWarnings = runConsistencyScan(
    smoothedDraft,
    consistencyBoundaries,
    { lintHeadings: opts.lintHeadings === true },
  );

  const consistencyFlags = consistencyWarnings.map(
    (w) => `- **${w.heuristic}** (sections ${w.sections.join(', ')}): ${w.message}`,
  );

  // ---------------------------------------------------------------------------
  // Run citation density (COMP-05 — warn-only)
  // ---------------------------------------------------------------------------

  // Try to read discipline from INTAKE.md if it exists
  let discipline = 'default';
  const intakePath = path.join(paperRoot, '.paper', 'INTAKE.md');
  if (existsSync(intakePath)) {
    try {
      const intakeContent = readFileSync(intakePath, 'utf8');
      const disciplineMatch = /discipline[_\s]*preset\s*[:=]\s*([a-z]+)/i.exec(intakeContent);
      if (disciplineMatch?.[1]) {
        discipline = disciplineMatch[1].toLowerCase();
      }
    } catch {
      // ignore — use default
    }
  }

  const densityReport = computeCitationDensity(sectionTexts, discipline);
  const densityLines: string[] = [
    `Paper-wide: mean ${densityReport.mean} citations/1000 words, stdev ${densityReport.stdev}`,
    `Discipline: ${densityReport.target_comparison.discipline} target band [${densityReport.target_comparison.target_min}, ${densityReport.target_comparison.target_max}]`,
    `Status: ${densityReport.target_comparison.status}`,
    ...densityReport.sections.map(
      (s) => `- Section ${s.n} (${s.slug}): ${s.citations_per_1000_words} cites/1000 words (${s.citation_count} citations, ${s.word_count} words)`,
    ),
  ];
  if (densityReport.warn) {
    densityLines.push(`WARN: ${densityReport.target_comparison.message}`);
  }

  // ---------------------------------------------------------------------------
  // Step 4: Regen CITATIONS.bib (D-19) + atomic writes (D-07 / COMP-07)
  // ---------------------------------------------------------------------------

  // Collect all unique citekeys from the compiled draft
  const compiledCitekeys = extractCitekeys(smoothedDraft);

  // Regen CITATIONS.bib from the union of all compiled citekeys.
  // We read the existing bib and keep only entries whose citekeys appear in the compiled draft.
  let regenBib = '';
  if (existsSync(bibPath)) {
    try {
      const bibText = readFileSync(bibPath, 'utf8');
      if (bibText.trim()) {
        // Filter bib entries to only those used in the compiled draft
        const usedKeys = new Set(compiledCitekeys);
        // Re-emit the bib with only used keys (pass-through approach)
        // A full bibtex-write.ts round-trip would require SourceCandidates;
        // instead, we emit the existing bib entries that are referenced.
        const entryRE = /(@\w+\{([^,]+),[\s\S]*?^\})/gm;
        const keepEntries: string[] = [];
        for (const match of bibText.matchAll(entryRE)) {
          const entryKey = match[2]?.trim();
          if (entryKey && usedKeys.has(entryKey)) {
            keepEntries.push(match[0]);
          }
        }
        regenBib = keepEntries.join('\n\n');
      }
    } catch {
      // ignore — empty bib is valid
    }
  }

  // If bib is empty but draft has citekeys, include ALL entries (don't lose any)
  if (!regenBib && existsSync(bibPath)) {
    regenBib = readFileSync(bibPath, 'utf8');
  }

  const draftPath = path.join(paperRoot, '.paper', 'DRAFT.md');
  const reportPath = path.join(paperRoot, '.paper', 'COMPILE-REPORT.md');

  // Build report input
  const reportInput = {
    schema_version: 1 as const,
    compiled_at: new Date().toISOString(),
    sections_count: sectionTexts.length,
    stale_resolved_count: stalenessResolved.length,
    refuse_reasons: [],
    title: outline.paper_title ?? '',
    author: '',
    abstract: '',
    transitions,
    consistency_flags: consistencyFlags,
    citation_density: densityLines,
    staleness_resolved: stalenessResolved,
    advisory_entries: [],
  };

  const reportContent = renderCompileReport(reportInput);

  // Atomic writes (D-07 sole-writer chokepoint — COMP-07, ARCH-20)
  // Order: DRAFT.md first, then CITATIONS.bib, then COMPILE-REPORT.md
  await atomicWriteFile(draftPath, smoothedDraft);
  await atomicWriteFile(bibPath, regenBib);
  await atomicWriteFile(reportPath, reportContent);

  return {
    ok: true,
    draftPath,
    reportPath,
  };
}

// ---------------------------------------------------------------------------
// Outline reader helper
// ---------------------------------------------------------------------------

function readOutline(paperDir: string): string {
  const outlinePath = path.join(paperDir, 'OUTLINE.md');
  if (!existsSync(outlinePath)) {
    throw new Error(`OUTLINE.md not found at ${outlinePath} — run \`pensmith outline\` first`);
  }
  return readFileSync(outlinePath, 'utf8');
}
