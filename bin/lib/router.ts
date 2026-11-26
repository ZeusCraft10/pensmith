// bin/lib/router.ts — the bare `/pensmith` next-step resolver (UX-01).
//
// resolveNextAction only reads: STATE.json, the outline (outline-read.ts),
// each section's PLAN.md, DRAFT.md, VERIFICATION.json and
// ACKNOWLEDGEMENTS.json, and the paper's COMPILE-MANIFEST.json, DRAFT.md,
// CITATIONS.bib, FINAL.md and EXPORT.json. It IGNORES HANDOFF.json: a non-done
// HANDOFF must not trap bare /pensmith in a resume loop, so the resolver
// always returns a concrete next work verb (plan / write / verify / compile /
// done) or a status terminus, never { verb:'resume' }. The resume verb owns
// that member and dispatches into this function so it always advances.
//
// The decision table, first match wins:
//   - no STATE.json → new; no research run → research; no usable outline →
//     outline.
//   - each section in order: no PLAN.md or a stub → plan; planned / writing →
//     write; written / verifying → verify; failed, unverifiable or verified →
//     what its recorded verdicts (VERIFICATION.json) call for:
//       * no record, or one about another draft, assigned sources,
//         acknowledgements or verifier version → verify (a failed or
//         unverifiable section only; compile checks a verified one again);
//       * failed on a citation revise can repair (FABRICATED, MIS-CITED, quote
//         NOT_FOUND, RETRACTED) → plan N --revise, naming each, and for a
//         retraction `pensmith ack` too;
//       * failed on placeholder, empty or uncited text → write N --force;
//       * failed only because a registry did not answer (UNRESOLVED) → verify;
//       * failed on a citation typed as text or a broken bracket, or a
//         refusal verify recorded → attention, with what to do;
//       * unverifiable (a quotation nothing could check) → compiled, with a
//         warning: in this alpha it does not block.
//     verify is never sent an unchanged draft whose verdicts it would repeat.
//   - every section through: compile until .paper/DRAFT.md is what the last
//     compile wrote from the sections, outline and bibliography as they are
//     now (COMPILE-MANIFEST.json); a compiled draft edited by hand needs
//     attention, so compile does not overwrite the edit unasked; then done
//     until FINAL.md is the recorded export of that draft (EXPORT.json); then
//     status 'done'.
// Every decision carries `why`, the reason in plain words.
//
// NEVER-THROW INVARIANT (load-bearing): resolveNextAction is total over its
// input and never throws or returns undefined. Every read is guarded, and an
// outer try/catch backstops anything unforeseen as status/attention.
//
// readSectionState is the single guarded per-section PLAN.md read; status.ts
// reuses it, so nothing does a raw unguarded parse of a PLAN.md.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadState, StateNotFoundError } from './state.js';
import {
  paperDir,
  paperFinalFile,
  sectionAcknowledgements,
  sectionDraft,
  sectionPlan,
  sectionVerificationRecord,
} from './paths.js';
import { parseFrontmatter } from './frontmatter.js';
import { readOutline } from './outline-read.js';
import { assignedSourcesFrom } from './plan-status.js';
import { computeDraftHash } from './draft-hash.js';
import { readCompileManifest } from './compile-manifest.js';
import { readExportRecord } from './export-record.js';
import { isOfflineMode } from './network-mode.js';
import { isBlockingVerdict } from './verify/verdict-rows.js';
import { readVerificationRecord, sha256, UNCHECKED_QUOTE, type VerificationRecord } from './verify/verification-record.js';
import { VERSION } from './version.generated.js';
import type { Handoff } from './schemas/handoff.js';

type SectionRef = { n: number; slug: string };

export type RouterDecision =
  | { verb: 'new'; why: string }
  | { verb: 'research'; why: string }
  | { verb: 'outline'; why: string }
  | { verb: 'plan'; n: number; slug: string; why: string; revise?: true }
  | { verb: 'write'; n: number; slug: string; why: string; force?: true }
  | { verb: 'verify'; n: number; slug: string; why: string }
  | { verb: 'compile'; why: string }
  | { verb: 'done'; why: string }
  //   reason:'done'      → the current compile is exported (nothing left to do)
  //   reason:'attention' → something only a person can sort out; `why` says what
  | { verb: 'status'; reason: 'done' | 'attention'; why: string; section?: SectionRef }
  // resolveNextAction never emits this member; it exists for the `resume`
  // verb's own return typing (bin/cli/resume.ts).
  | { verb: 'resume'; handoff: Handoff; why?: string };

/**
 * Normalized, never-throwing result of reading a per-section PLAN.md.
 */
export interface SectionStateRead {
  /** parsed `status` frontmatter, defaulted to 'stub' (not planned yet) when absent. */
  status: string;
  /** true if the file was PRESENT but readFileSync/parseFrontmatter threw. */
  corrupt: boolean;
  /** true if the file does not exist on disk (existsSync === false). */
  absent: boolean;
  /** The sources the PLAN.md assigns (assignedSourcesFrom); none when absent or corrupt. */
  assignedSources: string[];
}

/**
 * The single guarded per-section PLAN.md read. resolveNextAction's section
 * walk uses it, and bin/cli/status.ts reuses it.
 *
 * Never throws:
 *   - absent file                                   → { status:'stub', corrupt:false, absent:true }
 *   - present but unreadable or malformed YAML      → { status:'stub', corrupt:true,  absent:false }
 *                                                     + one-line stderr diagnostic
 *   - well-formed                                   → { status:<fm.status ?? 'stub'>, corrupt:false, absent:false }
 */
export function readSectionState(planPath: string): SectionStateRead {
  if (!existsSync(planPath)) {
    return { status: 'stub', corrupt: false, absent: true, assignedSources: [] };
  }
  try {
    const { frontmatter } = parseFrontmatter(readFileSync(planPath, 'utf8'));
    const status = (frontmatter as { status?: unknown }).status;
    return {
      status: typeof status === 'string' ? status : 'stub',
      corrupt: false,
      absent: false,
      assignedSources: assignedSourcesFrom(frontmatter),
    };
  } catch (e) {
    process.stderr.write(
      `[pensmith] PLAN.md at ${planPath} is unreadable/corrupt: ${(e as Error).message}\n`,
    );
    return { status: 'stub', corrupt: true, absent: false, assignedSources: [] };
  }
}

/**
 * The verb a section with PLAN.md `status` needs next, by status alone:
 * 'verified' when it is through, or null for a status pensmith does not know.
 * The estimator prices the rest of a section from it. 'failed' and
 * 'unverifiable' map to 'verify' here; the router decides them from the
 * recorded verdicts instead (routeRecorded).
 */
export function sectionVerb(status: string): 'plan' | 'write' | 'verify' | 'verified' | null {
  switch (status) {
    case 'verified':
      return 'verified';
    case 'stub':
      return 'plan';
    case 'planned':
    case 'writing': // a draft that did not finish
      return 'write';
    case 'written':
    case 'verifying':
    case 'failed':
    case 'unverifiable':
      return 'verify';
    default:
      return null;
  }
}

/**
 * Whether research has run for the paper whose `.paper/` folder is `pDir`:
 * the legacy RESEARCH.md exists, or LIBRARY.json records a research run.
 * `pensmith add` writes LIBRARY.json too, so the file being there is not
 * enough; a v1 library (or the older bare list) was written only by research.
 * Null when LIBRARY.json is there but cannot be read. Never throws.
 */
export function researchDone(pDir: string): boolean | null {
  if (existsSync(join(pDir, 'RESEARCH.md'))) return true;
  const file = join(pDir, 'LIBRARY.json');
  if (!existsSync(file)) return false;
  try {
    const lib: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(lib)) return true;
    if (!lib || typeof lib !== 'object') return null;
    const { $schemaVersion: version, researched_at: at } = lib as { $schemaVersion?: unknown; researched_at?: unknown };
    if (typeof version !== 'number' || version < 2) return true;
    return typeof at === 'string';
  } catch {
    return null;
  }
}

/**
 * Behavior options for resolveNextAction. `stopAfterResearch` is a flag the
 * CLI caller sets; the router never reads any config and never knows why the
 * caller wants to stop.
 */
export interface ResolveOptions {
  /**
   * When true AND research has run, halt at the research stage and return
   * `{ verb:'status', reason:'done' }` instead of advancing to outline.
   */
  stopAfterResearch?: boolean;
}

/** The bytes at `path`, or null when it cannot be read. */
function bytesOrNull(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/** Verdicts revise repairs by swapping or removing the citation (bin/lib/revise.ts). */
const REPAIRABLE: ReadonlySet<string> = new Set(['FABRICATED', 'MIS-CITED', 'NOT_FOUND', 'RETRACTED']);

/** Each blocking verdict of `record` as `VERDICT [@key]` (or the text, for a citation typed as text). */
function blockingVerdicts(record: VerificationRecord): Array<{ verdict: string; key: string; label: string }> {
  const rows = [
    ...record.citations.map((c) => ({ verdict: c.verdict, key: c.citekey })),
    ...record.quotes.map((q) => ({ verdict: q.verdict, key: q.citekey })),
  ].filter((r) => isBlockingVerdict(r.verdict));
  return rows.map((r) => ({
    ...r,
    label: r.verdict === 'RAW_CITATION' || r.verdict === 'UNPARSEABLE' ? `${r.verdict} "${r.key}"` : `${r.verdict} [@${r.key}]`,
  }));
}

/** `items` without repeats, joined for a sentence. */
function listed(items: readonly string[]): string {
  return [...new Set(items)].join('; ');
}

/**
 * What a section whose PLAN.md says failed, unverifiable or verified needs,
 * from its recorded verdicts: a decision, or null when it is through (with
 * `warn` told what must not look clean).
 */
function routeRecorded(
  paperRoot: string,
  s: SectionRef,
  planStatus: string,
  assignedSources: readonly string[],
  warn: (w: string) => void,
): RouterDecision | null {
  const { n, slug } = s;
  const where = `section ${n} (${slug})`;
  const read = readVerificationRecord(sectionVerificationRecord(n, slug, paperRoot));
  if (!read.ok) {
    return {
      verb: 'verify', n, slug,
      why: read.problem === 'missing'
        ? `${where} has no recorded verdicts (no VERIFICATION.json)`
        : `${where}'s recorded verdicts cannot be read (${read.detail})`,
    };
  }
  const record = read.record;
  if (record.section !== n || record.slug !== slug) {
    return { verb: 'verify', n, slug, why: `${where}'s VERIFICATION.json is the record of section ${record.section} (${record.slug})` };
  }
  const draft = bytesOrNull(sectionDraft(n, slug, paperRoot));
  if (draft === null) {
    return { verb: 'write', n, slug, force: true, why: `${where} has no DRAFT.md to compile` };
  }
  if (record.draft_sha256 !== sha256(draft)) {
    return { verb: 'verify', n, slug, why: `${where}'s DRAFT.md changed since it was verified` };
  }

  // A verified record about this draft: compile re-checks it against the
  // sources, bibliography and acknowledgements as they are then.
  if (record.status === 'verified' && record.checked) return null;

  // A failed or unverifiable record whose inputs changed may now pass.
  if (record.checked && record.draft_hash !== computeDraftHash(draft, [...assignedSources])) {
    return { verb: 'verify', n, slug, why: `${where}'s assigned sources changed in PLAN.md since it was verified` };
  }
  const acks = bytesOrNull(sectionAcknowledgements(n, slug, paperRoot));
  if (record.checked && record.acknowledgements_sha256 !== (acks === null ? null : sha256(acks))) {
    return { verb: 'verify', n, slug, why: `${where}'s ACKNOWLEDGEMENTS.json changed since it was verified` };
  }
  if (record.verifier_version !== VERSION) {
    return { verb: 'verify', n, slug, why: `${where} was verified by pensmith ${record.verifier_version}, not by this verifier (${VERSION})` };
  }

  if (!record.checked) {
    // verify stopped before checking anything (placeholder or empty text, no
    // bibliography): its reason says what to do.
    const reason = record.reason ?? 'verify could not check it';
    if (record.status === 'failed') return { verb: 'write', n, slug, force: true, why: `${where} was not verified: ${reason}` };
    return { verb: 'status', reason: 'attention', section: s, why: `${where} could not be verified: ${reason}` };
  }

  if (record.status === 'unverifiable') {
    const unchecked = record.quotes.filter((q) => UNCHECKED_QUOTE.has(q.verdict)).length;
    const unattributed = record.quotes.filter((q) => q.verdict === 'UNATTRIBUTED').length;
    const parts = [
      ...(unchecked > 0 ? [`${unchecked} quotation(s) could not be checked against their source text`] : []),
      ...(unattributed > 0 ? [`${unattributed} quotation(s) cite nothing`] : []),
    ];
    warn(`${where} is unverifiable: ${parts.length > 0 ? parts.join(', ') : 'it cites nothing and the library is empty'}; in this alpha that does not block compile`);
    return null;
  }

  // Failed on its verdicts.
  const blocking = blockingVerdicts(record);
  if (blocking.length === 0) {
    const reason = record.reason ?? `verify failed it (PLAN.md says ${planStatus})`;
    // decideStatus's only failure without a blocking verdict: a draft that
    // cites none of its assigned sources, which a new draft fixes.
    return { verb: 'write', n, slug, force: true, why: `${where} failed verification: ${reason}` };
  }
  const repairable = blocking.filter((b) => REPAIRABLE.has(b.verdict));
  if (repairable.length > 0) {
    const retracted = [...new Set(repairable.filter((b) => b.verdict === 'RETRACTED').map((b) => b.key))];
    const ack = retracted.length === 0 ? '' :
      `; if the paper must cite a retracted work (it discusses the retraction), the user can instead run ${
        retracted.map((k) => `\`pensmith ack ${n} ${k} --reason "<why>"\``).join(' or ')} and verify again`;
    const others = blocking.filter((b) => !REPAIRABLE.has(b.verdict));
    return {
      verb: 'plan', n, slug, revise: true,
      why: `${where} failed verification: ${listed(repairable.map((b) => b.label))}${others.length > 0 ? ` (also ${listed(others.map((b) => b.label))})` : ''} — ` +
        `\`pensmith plan ${n} --revise\` proposes a repair for the user to approve${ack}`,
    };
  }
  if (blocking.every((b) => b.verdict === 'UNRESOLVED')) {
    const keys = listed(blocking.map((b) => b.label));
    if (isOfflineMode()) {
      return { verb: 'status', reason: 'attention', section: s, why: `${where}: ${keys}: no registry could be asked with the network off; run verify ${n} with network access` };
    }
    return {
      verb: 'verify', n, slug,
      why: `${where}: ${keys}: a registry did not answer, so verify ${n} runs again; if it keeps failing, the entry may need a DOI, arXiv ID, PMID or ISBN`,
    };
  }
  return {
    verb: 'status', reason: 'attention', section: s,
    why: `${where} failed verification: ${listed(blocking.map((b) => b.label))} — rewrite each as a [@key] citation of a work in the library ` +
      `in DRAFT.md (\`pensmith add\` it first if the library lacks it), or redraft with \`pensmith write ${n} --force\`, then run \`pensmith verify ${n}\``,
  };
}

/** Why the compiled .paper/DRAFT.md is not what the last compile wrote from the paper as it is now, or null. */
function compileDue(paperRoot: string, sections: readonly SectionRef[]): RouterDecision | null {
  const pDir = paperDir(paperRoot);
  const draft = bytesOrNull(join(pDir, 'DRAFT.md'));
  if (draft === null) return { verb: 'compile', why: 'every section is through verification and nothing is compiled yet' };
  const read = readCompileManifest(paperRoot);
  if (!read.ok) return { verb: 'compile', why: `.paper/DRAFT.md was not produced by a gated compile (${read.why})` };
  const m = read.manifest;
  if (sha256(draft) !== m.draft_sha256) {
    return {
      verb: 'status', reason: 'attention',
      why: '.paper/DRAFT.md was edited after compile, and an edit to the compiled draft is never verified — make the change in its section and verify it; ' +
        '`pensmith compile` then writes DRAFT.md again from the sections, replacing the edit',
    };
  }
  const key = (xs: readonly SectionRef[]): string => xs.map((x) => `${x.n}-${x.slug}`).sort().join(',');
  if (key(sections) !== key(m.sections)) return { verb: 'compile', why: "the outline's sections are not the ones last compiled" };
  for (const s of m.sections) {
    const where = `section ${s.n} (${s.slug})`;
    const d = bytesOrNull(sectionDraft(s.n, s.slug, paperRoot));
    if (d === null || sha256(d) !== s.draft_sha256) return { verb: 'compile', why: `${where}'s DRAFT.md changed since compile` };
    const v = bytesOrNull(sectionVerificationRecord(s.n, s.slug, paperRoot));
    if (v === null || sha256(v) !== s.verification_sha256) return { verb: 'compile', why: `${where} was verified again since compile` };
  }
  if (m.bib_sha256 !== undefined) {
    const bib = bytesOrNull(join(pDir, 'CITATIONS.bib'));
    if ((bib === null ? null : sha256(bib.toString('utf8'))) !== m.bib_sha256) {
      return { verb: 'compile', why: '.paper/CITATIONS.bib changed since compile' };
    }
  }

  // Compiled from the paper as it is: exported yet?
  const exported = readExportRecord(paperRoot);
  const final = bytesOrNull(paperFinalFile(paperRoot));
  if (exported === null || final === null) return { verb: 'done', why: 'the compiled draft has not been exported yet' };
  if (exported.draft_sha256 !== m.draft_sha256 || sha256(final) !== exported.final_sha256) {
    return { verb: 'done', why: 'the last export was of an earlier compile' };
  }
  return { verb: 'status', reason: 'done', why: `the current compile was exported (${exported.format}, ${exported.exported_at})` };
}

/**
 * Resolve the next work action for the active paper at `paperRoot`. Total and
 * never-throwing; never returns undefined or { verb:'resume' }. See the file
 * header for the decision table.
 */
export async function resolveNextAction(
  paperRoot: string,
  opts: ResolveOptions = {},
): Promise<RouterDecision> {
  try {
    // STATE.json says a paper was started: absent → new; present but corrupt,
    // schema-invalid or unreadable → attention, never re-thrown.
    try {
      await loadState(paperRoot);
    } catch (e) {
      if (e instanceof StateNotFoundError) return { verb: 'new', why: 'no paper has been started here' };
      process.stderr.write(
        `[pensmith] STATE.json at ${paperRoot} is unreadable/corrupt: ${(e as Error).message}\n`,
      );
      return { verb: 'status', reason: 'attention', why: `STATE.json is unreadable or corrupt: ${(e as Error).message}` };
    }

    const pDir = paperDir(paperRoot);
    const researched = researchDone(pDir);
    if (researched === null) {
      process.stderr.write(`[pensmith] LIBRARY.json at ${pDir} cannot be read; research cannot be told to have run.\n`);
      return { verb: 'status', reason: 'attention', why: '.paper/LIBRARY.json cannot be read, so whether research ran cannot be told' };
    }
    if (!researched) return { verb: 'research', why: 'no research has run for this paper yet' };

    // Once research is done, a caller that asked to stop there stops.
    if (opts.stopAfterResearch) {
      return { verb: 'status', reason: 'done', why: 'research is done, and this paper stops after research' };
    }

    // The outline is the one list of sections (outline-store.ts). With none
    // yet, a placeholder, or a hand edit to check, the next step is outline.
    const outline = readOutline(paperRoot);
    if (!outline.ok) {
      if (outline.problem !== 'invalid') return { verb: 'outline', why: outline.detail };
      process.stderr.write(`[pensmith] ${outline.detail}\n`);
      return { verb: 'status', reason: 'attention', why: outline.detail };
    }
    const sections = outline.outline.sections;
    if (sections.length === 0) return { verb: 'outline', why: 'the outline has no sections' };

    // Walk the sections in order; the first one not through decides.
    const warnings: string[] = [];
    for (const { n, slug } of [...sections].sort((a, b) => a.n - b.n)) {
      const where = `section ${n} (${slug})`;
      const r = readSectionState(sectionPlan(n, slug, paperRoot));
      if (r.absent) return { verb: 'plan', n, slug, why: `${where} has no PLAN.md yet` };
      if (r.corrupt) return { verb: 'status', reason: 'attention', section: { n, slug }, why: `${where}'s PLAN.md cannot be read` };
      switch (r.status) {
        case 'stub':
          return { verb: 'plan', n, slug, why: `${where} is not planned yet` };
        case 'planned':
          return { verb: 'write', n, slug, why: `${where} is planned and not drafted yet` };
        case 'writing':
          return { verb: 'write', n, slug, why: `${where}'s draft did not finish` };
        case 'written':
        case 'verifying':
          return { verb: 'verify', n, slug, why: `${where} is drafted and not verified yet` };
        case 'verified':
        case 'failed':
        case 'unverifiable': {
          const d = routeRecorded(paperRoot, { n, slug }, r.status, r.assignedSources, (w) => warnings.push(w));
          if (d) return d;
          continue;
        }
        default:
          return { verb: 'status', reason: 'attention', section: { n, slug }, why: `${where}'s PLAN.md has status '${r.status}', which pensmith does not know` };
      }
    }

    const next = compileDue(paperRoot, sections);
    const note = warnings.length > 0 ? ` (WARN: ${warnings.join('; ')})` : '';
    if (next) return { ...next, why: `${next.why}${note}` };
    return { verb: 'status', reason: 'attention', why: 'the compile could not be checked' };
  } catch (e) {
    // Backstop: anything that throws despite the per-read guards.
    process.stderr.write(
      `[pensmith] router resolveNextAction hit an unexpected error: ${(e as Error).message}\n`,
    );
    return { verb: 'status', reason: 'attention', why: `the router hit an unexpected error: ${(e as Error).message}` };
  }
}

/** The decision's arguments for the verb it names: section, slug, and --revise / --force. */
export function decisionArgs(decision: RouterDecision): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('n' in decision) out['n'] = decision.n;
  if ('slug' in decision) out['slug'] = decision.slug;
  if ('revise' in decision && decision.revise) out['revise'] = true;
  if ('force' in decision && decision.force) out['force'] = true;
  if (decision.verb === 'status') out['reason'] = decision.reason;
  return out;
}

/** The command the decision runs, as the user would type it (`pensmith plan 2 --revise`). */
export function decisionCommand(decision: RouterDecision): string {
  const parts = ['pensmith', decision.verb];
  if ('n' in decision) parts.push(String(decision.n));
  if ('revise' in decision && decision.revise) parts.push('--revise');
  if ('force' in decision && decision.force) parts.push('--force');
  return parts.join(' ');
}
