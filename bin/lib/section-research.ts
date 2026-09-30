// bin/lib/section-research.ts — `plan N --research <query>` (and
// `revise N --research <query>`): a section-scoped research pass that adds real
// hits to section N only (GRND-17, D-19-18; PRD §7.5).
//
// One call:
//   1. Refuses up front (registry gate `plan-research`, EXIT_APPROVAL) when it
//      could never ask — no terminal, no scripted answers, no --yolo — before
//      any model call, search or write.
//   2. Reads section N's PLAN.md (stub or planned), the brief and the
//      `[sources]` policy. With PII redaction on (the brief's or config.toml's
//      `pii_redaction`), the query is redacted before any model or search
//      request (bin/lib/pii.ts).
//   3. Queries: the user's query, and the query joined to the section title.
//      The same research pass as `pensmith research` (bin/lib/research-
//      orchestrator.ts: the preset's adapters, dedup, tiers, policy, the source
//      evaluator with topic = the brief's topic and the section title, scope =
//      the query).
//   4. Zero hits → the per-adapter reasons, exit 1, nothing written.
//   5. The hits are shown for approval (`plan-research`; --yolo adds every hit
//      the evaluator kept): each with its tier and year, known works marked
//      "already in library as <key>".
//   6. The retraction cross-check (D-15), then the ONE library writer
//      (upsertSources, provenance `plan-research:§<id>` — revise.ts
//      planResearchProvenance, which the planner's allowed set reads); then ONLY section N's
//      PLAN.md `assigned_sources` gains the real (library) citekeys the
//      citation verifier can check (a retracted hit stays in LIBRARY.json,
//      logged "not assigned" — D-18-37), under the
//      PLAN.md lock — its status and verified_against_draft_hash are untouched;
//      then an entry is appended to sections/<NN>-<slug>/RESEARCH-LOG.md and the
//      RESEARCH.md sources block is refreshed from LIBRARY.json (the user's
//      notes and the research log are kept byte-for-byte).
// No other section's files are read for writing or touched (section-as-phase).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runGate, declineGate, canPrompt } from './gates.js';
import { PensmithError, EXIT_ERROR, EXIT_USAGE } from './exit-codes.js';
import { loadPrompt } from './prompt-loader.js';
import { assertLlmConfigured } from './anthropic.js';
import { upsertSources, assertLibraryReadable, tryLoadLibrary, sameWorkVersion, sameDoiVersionFamily, type LibraryCandidate } from './library.js';
import type { LibraryEntry } from './schemas/library.js';
import { sectionPlan } from './paths.js';
import { formatSectionId, loggedSectionId, sectionIdOf } from './section-id.js';
import { planResearchProvenance } from './revise.js';
import { withLock } from './lock.js';
import { atomicWriteFile } from './atomic-write.js';
import { loadFrontmatterDoc, migrateFrontmatterText, updateFrontmatter } from './frontmatter.js';
import { CURRENT_PLAN_FRONTMATTER_VERSION } from './schemas/plan-frontmatter.js';
import { readIntakeBrief } from './intake-brief.js';
import { readPaperConfigSync } from './config.js';
import { resolveDiscipline } from './disciplines.js';
import { redactPii } from './pii.js';
import { networkMode } from './http-mock.js';
import { sourcePolicyFrom } from './source-policy.js';
import { crossCheckRetractions, retractionCheckReason, type RetractionLookup } from './sources/retraction-cross-check.js';
import { enrichOpenAccess, describeOpenAccess } from './open-access.js';
import type { SourceCandidate } from './schemas/source-candidate.js';
import { refreshResearchSources, formatReference } from './research-md.js';
import { describeExcluded, excludedRemedy, verifierBlindSpot } from './source-context.js';
import {
  researchRegistry,
  researchAdapterPlan,
  runResearchPass,
  renderAdapterTable,
  evaluatorNotes,
  tierSummary,
  upsertCounts,
  type ResearchItem,
  type ResearchPassResult,
} from './research-orchestrator.js';

/** An expected section-research failure: one line, exit 1. */
export class SectionResearchError extends PensmithError {
  constructor(message: string) {
    super(message, EXIT_ERROR);
    this.name = 'SectionResearchError';
  }
}

export interface SectionResearchOptions {
  /** The project root (the folder holding .paper/). */
  readonly root: string;
  readonly n: number;
  /** The section's letter (GRND-09: §1a); absent for a plain §N. */
  readonly suffix?: string | undefined;
  readonly slug: string;
  /** The user's `--research <query>`. */
  readonly query: string;
  readonly yolo: boolean;
  /** The verb for messages (`plan` or `revise`). */
  readonly verb?: 'plan' | 'revise';
  /** Where progress lines go (default: stdout / stderr). */
  /**
   * Where the pass's lines go (required: the CLI passes its stdout / stderr
   * sink; this module never writes to the process streams itself — it is
   * reachable from mcp/, PLUG-13).
   */
  readonly io: { readonly out: (line: string) => void; readonly err: (line: string) => void };
}

export interface SectionResearchResult {
  readonly ok: true;
  /** The section as the user types it (`2`, or `1a` for an inserted section). */
  readonly section: number | string;
  /** The query as sent (redacted when PII redaction is on). */
  readonly query: string;
  readonly queries: string[];
  /** Hits the research pass kept (before the approval question). */
  readonly hits: number;
  /** The library citekeys added to this section's assigned_sources (in order). */
  readonly added: string[];
  /** Of those, the ones that were new to LIBRARY.json. */
  readonly newToLibrary: string[];
  readonly plan: string;
  readonly log: string;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The queries of a section pass: the query and the query joined to the section title (distinct, case-insensitive). */
export function sectionQueries(query: string, title: string): string[] {
  const q = oneLine(query);
  const joined = oneLine(`${q} ${title}`);
  return q.toLowerCase() === joined.toLowerCase() || title.trim() === '' ? [q] : [q, joined];
}

/**
 * The library entry a research hit already is, if any — the same identity
 * rules the library writer applies (DOI and alternates, arXiv id, PMID,
 * PMCID, ISBN, Zotero item, then the preprint ↔ version-of-record rule). Used
 * only to label hits for the user; upsertSources remains the authority.
 */
export function knownEntryFor(entries: readonly LibraryEntry[], view: LibraryEntry): LibraryEntry | null {
  const mine = new Set([view.doi, ...view.alternate_dois].filter((x): x is string => x !== null));
  if (mine.size > 0) {
    const hit = entries.find((e) => [e.doi, ...e.alternate_dois].some((x) => x !== null && mine.has(x)));
    if (hit) return hit;
  }
  for (const k of ['arxiv', 'pmid', 'pmcid', 'isbn'] as const) {
    const v = view[k];
    if (v === null) continue;
    const hit = entries.find((e) => e[k] === v);
    if (hit) return hit;
  }
  if (view.zotero !== null) {
    const z = view.zotero;
    const hit = entries.find((e) => e.zotero !== null && e.zotero.library === z.library && e.zotero.key === z.key);
    if (hit) return hit;
  }
  return entries.find((e) => sameDoiVersionFamily(e, view) || sameWorkVersion(e, view)) ?? null;
}

function excerpt(text: string | null | undefined, max: number): string {
  const flat = oneLine(text ?? '');
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

function hitOption(item: ResearchItem, known: LibraryEntry | null, rejected: boolean): { value: string; label: string; hint: string } {
  const tier = item.tier ?? (item.decision === 'not-evaluated' ? 'not evaluated' : 'tier unknown');
  const why = rejected ? `rejected by the evaluator: ${item.reason ?? 'no reason given'}` : item.reason ?? (item.decision === 'not-evaluated' ? 'not evaluated' : 'kept by the evaluator');
  const knownNote = known !== null ? `already in library as ${known.citekey}; ` : '';
  const abstract = excerpt(item.candidate.abstract, 140);
  return {
    value: item.candidate.citekey,
    label: `[${tier}] ${excerpt(item.candidate.title, 90)} (${item.candidate.year ?? 'n.d.'})`,
    hint: `${knownNote}${why}${abstract ? ` — ${abstract}` : ''}`,
  };
}

/** The policy exclusions counted by rule. */
function exclusionCounts(items: readonly ResearchItem[]): string {
  const counts = new Map<string, number>();
  for (const x of items) counts.set(x.exclusion?.rule ?? 'policy', (counts.get(x.exclusion?.rule ?? 'policy') ?? 0) + 1);
  return [...counts.entries()].map(([r, c]) => `${r} ${c}`).join(', ');
}

function adapterReasons(pass: ResearchPassResult): string {
  return pass.adapters.map((a) => `${a.adapter} ${a.count} (${a.status})`).join(', ');
}

/** Add `keys` to section N's PLAN.md `assigned_sources` (under its lock); status and the draft hash are untouched. */
async function assignToSection(planPath: string, keys: readonly string[]): Promise<string[]> {
  let added: string[] = [];
  await withLock(planPath, async () => {
    const migrated = migrateFrontmatterText('plan', readFileSync(planPath, 'utf8'), planPath).text;
    const next = updateFrontmatter(migrated, (fm) => {
      const list: unknown = fm['assigned_sources'];
      const existing = Array.isArray(list) ? list.map(String) : [];
      added = keys.filter((k, i) => !existing.includes(k) && keys.indexOf(k) === i);
      fm['assigned_sources'] = [...existing, ...added];
      fm['schema_version'] = CURRENT_PLAN_FRONTMATTER_VERSION;
    });
    await atomicWriteFile(planPath, next);
  });
  return added;
}

/** Append one entry to the section's RESEARCH-LOG.md (under its lock). */
async function appendSectionLog(logPath: string, header: string, entry: string): Promise<void> {
  await withLock(logPath, async () => {
    const prior = existsSync(logPath) ? readFileSync(logPath, 'utf8') : `${header}\n`;
    const eol = prior.includes('\r\n') ? '\r\n' : '\n';
    const sep = prior.endsWith('\n') ? '' : eol;
    await atomicWriteFile(logPath, `${prior}${sep}${eol}${entry.replace(/\n/g, eol)}${eol}`);
  });
}

/** The section-scoped research pass (see the module header). */
export async function runSectionResearch(opts: SectionResearchOptions): Promise<SectionResearchResult> {
  // The section as the user types it (`2`, `1a`): messages, the log and the provenance tag (GRND-09).
  const id = formatSectionId(sectionIdOf(opts.n, opts.suffix));
  const verb = opts.verb ?? 'plan';
  const label = `pensmith ${verb} --research`;
  const { out, err } = opts.io;
  const rawQuery = oneLine(opts.query);
  if (rawQuery.length === 0) throw new PensmithError(`${label}: the query is empty`, EXIT_USAGE);

  // RUN-28 / GRND-17: refuse now if the approval question could never be answered.
  if (!opts.yolo && !canPrompt()) {
    await runGate('plan-research', { yolo: false, detail: `section ${id}: nothing was searched, sent or written` });
  }

  loadPrompt('source-evaluator');
  await assertLlmConfigured(verb);
  await assertLibraryReadable(opts.root);
  const config = readPaperConfigSync(opts.root).config;

  const planPath = sectionPlan(opts.n, opts.slug, opts.root);
  if (!existsSync(planPath)) {
    throw new SectionResearchError(
      `${label}: section ${id} has no PLAN.md yet (${path.relative(opts.root, planPath)}) — run pensmith outline, then add sources to it`,
    );
  }
  const plan = await loadFrontmatterDoc('plan', planPath);
  const title = typeof plan.frontmatter['title'] === 'string' && plan.frontmatter['title'].trim() ? oneLine(plan.frontmatter['title']) : opts.slug;

  const doc = readIntakeBrief(opts.root);
  const redact = doc?.brief.pii_redaction === true || config.project?.pii_redaction === true;
  const query = redact ? oneLine(redactPii(rawQuery)) : rawQuery;
  const discipline = resolveDiscipline({ discipline: { intake: doc?.brief.discipline, config: config.project?.discipline_preset } }).slug.value;
  const briefTopic = oneLine(doc?.brief.topic ?? '');
  const topic = briefTopic ? `${briefTopic} — ${title}` : title;
  const queries = sectionQueries(query, title);

  out(`${label}: section ${id} "${title}" — ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}${redact ? ' (PII-redacted)' : ''}`);
  queries.forEach((q, i) => out(`  ${i + 1}. ${q}`));

  const registry = researchRegistry();
  const adapterPlan = researchAdapterPlan({
    registry,
    byPreference: !networkMode().dryRun,
    discipline,
    configDiscipline: config.project?.discipline_preset,
    allowed: config.sources?.allowed_databases,
  });
  const pass = await runResearchPass({
    queries,
    plan: adapterPlan,
    registry,
    policy: sourcePolicyFrom(config.sources),
    topic,
    discipline,
    scope: query,
    // GRND-17: this pass never writes RESEARCH.md; its adapter table follows.
    context: { label, see: 'the adapter table below' },
  });
  out(`${label}: sources by adapter`);
  for (const line of renderAdapterTable(pass.adapters)) out(line);
  for (const n of evaluatorNotes(pass)) err(`${label}: WARN — ${n}`);

  // Zero hits: the per-adapter reasons, exit 1, nothing written.
  if (pass.kept.length === 0 && pass.rejected.length === 0) {
    const why = pass.distinct === 0
      ? adapterReasons(pass)
      : `all ${pass.excluded.length} candidate(s) were excluded by the [sources] policy (${exclusionCounts(pass.excluded)})`;
    throw new SectionResearchError(`${label}: no research hits for "${query}" — ${why}; nothing was changed`);
  }
  if (pass.kept.length === 0 && (opts.yolo || !canPrompt())) {
    throw new SectionResearchError(
      `${label}: no relevant hits for "${query}" — the evaluator rejected all ${pass.rejected.length} candidate(s); nothing was changed`,
    );
  }

  // The approval question (known works labelled).
  const entries = (await tryLoadLibrary(opts.root))?.entries ?? [];
  const known = new Map<string, LibraryEntry | null>();
  for (const i of [...pass.kept, ...pass.rejected]) known.set(i.candidate.citekey, knownEntryFor(entries, i.view));
  const outcome = await runGate('plan-research', {
    yolo: opts.yolo,
    detail: `${pass.kept.length} hit(s) for section ${id}`,
    question: {
      id: 'plan-research',
      kind: 'multiselect',
      label: `Add these research hits to section ${id} "${title}"? (${pass.kept.length + pass.rejected.length} found; the evaluator's picks are preselected)`,
      options: [
        ...pass.kept.map((k) => hitOption(k, known.get(k.candidate.citekey) ?? null, false)),
        ...pass.rejected.map((r) => hitOption(r, known.get(r.candidate.citekey) ?? null, true)),
      ],
      default: pass.kept.map((k) => k.candidate.citekey),
    },
  });
  const selected = outcome.kind === 'answered' && outcome.answer.kind === 'multiselect'
    ? new Set(outcome.answer.value)
    : new Set(pass.kept.map((k) => k.candidate.citekey));
  const final = [...pass.kept, ...pass.rejected].filter((i) => selected.has(i.candidate.citekey));
  if (final.length === 0) declineGate('plan-research', `${label}: no hit was selected for section ${id}; nothing was changed`);

  // D-15: the retraction cross-check before the library write.
  const candidates: SourceCandidate[] = final.map((i) => i.candidate);
  const injected = registry['retraction-watch'] as Partial<RetractionLookup> | undefined;
  const lookup = typeof injected?.fetchById === 'function' ? (injected as RetractionLookup) : undefined;
  if (!networkMode().dryRun) {
    await crossCheckRetractions(candidates, lookup);
    // GRND-14: the open-access PDF Pass 3 would check, as each entry's oa_url.
    const oa = describeOpenAccess(await enrichOpenAccess(candidates));
    if (oa !== null) out(`${label}: ${oa}`);
  }

  const toLibrary = (i: ResearchItem): LibraryCandidate => ({
    ...i.candidate,
    tier: i.tier,
    relevance: i.relevance,
    why_relevant: i.decision === 'rejected' ? `Kept at your choice; the evaluator said: ${i.reason ?? 'no reason given'}` : i.reason,
  });
  const upsert = await upsertSources(opts.root, final.map(toLibrary), { provenance: planResearchProvenance(sectionIdOf(opts.n, opts.suffix)) });
  const realKeys = final.map((i, index) => upsert.outcomes.find((o) => o.index === index)?.citekey ?? i.candidate.citekey);
  const counts = upsertCounts(upsert.outcomes);
  const newToLibrary = counts.added;

  // Only section N's PLAN.md gains the keys — and only the ones Pass 1 can
  // check (D-18-37, source-context.ts verifierBlindSpot): a retracted hit
  // always fails Pass 1, so it stays in LIBRARY.json and is logged as not
  // added, never handed to the planner or the drafter.
  const library = new Map(((await tryLoadLibrary(opts.root))?.entries ?? []).map((e) => [e.citekey, e]));
  const withheld = new Map<string, string>();
  for (const key of realKeys) {
    const entry = library.get(key);
    const why = entry !== undefined ? verifierBlindSpot(entry, networkMode().dryRun) : null;
    if (why !== null) withheld.set(key, why);
  }
  const assignable = realKeys.filter((k) => !withheld.has(k));
  const added = assignable.length > 0 ? await assignToSection(planPath, assignable) : [];

  // The section's research log.
  const logPath = path.join(path.dirname(planPath), 'RESEARCH-LOG.md');
  const now = new Date().toISOString();
  const notAdded = [
    ...final
      .map((i, index) => ({ i, key: realKeys[index] as string }))
      .filter(({ key }, index) => withheld.has(key) && realKeys.indexOf(key) === index)
      .map(({ i, key }) => `[@${key}] ${formatReference(i.view)} — not assigned: the citation verifier would not pass a citation of it (${withheld.get(key) as string})`),
    ...pass.kept.filter((k) => !selected.has(k.candidate.citekey)).map((k) => `[@${k.candidate.citekey}] ${formatReference(k.view)} — deselected`),
    ...pass.rejected.filter((r) => !selected.has(r.candidate.citekey)).map((r) => `[@${r.candidate.citekey}] ${formatReference(r.view)} — evaluator: ${oneLine(r.reason ?? 'rejected')}`),
    ...pass.excluded.map((x) => `[@${x.candidate.citekey}] ${formatReference(x.view)} — policy: ${x.exclusion?.reason ?? 'excluded'}`),
  ];
  const retracted = candidates.map((c, i) => ({ c, key: realKeys[i] as string })).filter(({ c }) => c.retracted === true || c.retraction_status === 'retracted');
  // SRC-04: a failed retraction lookup is `unknown`, reported — never "clear".
  const unknown = candidates
    .map((c, i) => ({ c, key: realKeys[i] as string }))
    .filter(({ c }) => c.retracted !== true && c.retraction_status === 'unknown')
    .map(({ c, key }) => ({ key, reason: retractionCheckReason(c) ?? c.retraction_details ?? null }));
  const entryLines = [
    `## ${now} — "${query}"`,
    '',
    `- Queries: ${queries.map((q) => `\`${q}\``).join('; ')}${redact ? ' (PII-redacted)' : ''}`,
    `- Adapters: ${pass.adapters.map((a) => `${a.adapter} ${a.count} (${a.status})`).join('; ')}`,
    `- Result: ${tierSummary(final)}; ${pass.excluded.length} excluded by [sources] policy; ${pass.rejected.length} rejected by the evaluator`,
    `- Added to this section's assigned_sources: ${added.length > 0 ? added.join(', ') : assignable.length > 0 ? '(none new — already assigned)' : '(none — see "Not added")'}`,
    `- New to LIBRARY.json: ${newToLibrary.length > 0 ? newToLibrary.join(', ') : '(none)'}`,
    ...(retracted.length > 0 ? [`- RETRACTED (kept in LIBRARY.json, not assigned — Pass 1 blocks a citation of it): ${retracted.map((r) => r.key).join(', ')}`] : []),
    ...(unknown.length > 0
      ? [`- Retraction status unknown (re-checked at verify time): ${unknown.map((u) => `${u.key}${u.reason ? ` — ${oneLine(u.reason)}` : ''}`).join('; ')}`]
      : []),
    ...(notAdded.length > 0 ? ['- Not added:', ...notAdded.map((x) => `  - ${x}`)] : []),
  ];
  await appendSectionLog(logPath, `# Research log — section ${id}: ${title}\n\nEach \`pensmith plan ${id} --research\` run appends an entry (newest last).`, entryLines.join('\n'));

  // The RESEARCH.md sources block (curated notes and the research log are kept).
  await refreshResearchSources(opts.root);

  out(`${label}: ${tierSummary(final)}; ${pass.excluded.length} excluded by [sources] policy; ${pass.rejected.length - final.filter((i) => i.decision === 'rejected').length} rejected by the evaluator`);
  if (retracted.length > 0) {
    err(`WARN: ${retracted.length} retracted source(s) found in LIBRARY.json: ${retracted.map((r) => r.key).join(', ')}. These will FAIL Pass-1 if cited.`);
  }
  if (withheld.size > 0) {
    err(
      `${label}: WARN — not added to section ${id}: ${describeExcluded([...withheld].map(([citekey, reason]) => ({ citekey, reason })))} ` +
        `— the citation verifier would not pass a citation of them (${excludedRemedy([...withheld].map(([citekey, reason]) => ({ citekey, reason })))})`,
    );
  }
  if (unknown.length > 0) {
    err(`WARN: retraction status unknown for ${unknown.length} source(s): ${unknown.map((u) => u.key).join(', ')} — the lookup failed; verify re-checks them.`);
  }
  out(
    `${label}: added ${added.length} source(s) to section ${id}'s assigned_sources` +
      ` (${newToLibrary.length} new to LIBRARY.json, ${counts.known.length} already in the library` +
      `${counts.duplicates > 0 ? `, ${counts.duplicates} duplicate(s) merged` : ''})` +
      `${added.length > 0 ? `: ${added.join(', ')}` : ''}; logged in ${path.relative(opts.root, logPath)}`,
  );
  return {
    ok: true,
    section: loggedSectionId(opts.n, opts.suffix),
    query,
    queries,
    hits: pass.kept.length,
    added,
    newToLibrary,
    plan: planPath,
    log: logPath,
  };
}
