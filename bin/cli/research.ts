// bin/cli/research.ts — `pensmith research` (PRD §7.2; SRC-07..SRC-10).
//
// What one run does (D-19-15, D-19-16, D-19-17):
//   0. Flags are validated (a bad --queries or an empty --scope is EXIT_USAGE)
//      and, per RUN-28, a run that can never answer the source-pruning question
//      (no terminal, no scripted numbered answers, no --yolo) refuses with
//      EXIT_APPROVAL before any model call, search or write. Both prompt slugs
//      are hash-checked, an LLM must be configured (RUN-07), and an existing
//      LIBRARY.json must load (RUN-12) — all before any work.
//   1. The paper's brief (.paper/INTAKE.md, bin/lib/intake-brief.ts) seeds the
//      run: its topic, discipline (overridden by `[project] discipline_preset`)
//      and assignment.
//   2. The topic-disambiguator model proposes 1–3 scopes of search queries
//      (the one prompt layout, bin/lib/prompt-request.ts). Each scope is clamped
//      to 5–10 queries (`--queries <n>` lowers the cap) and padded from the
//      deterministic expansion of the topic when short. Under PENSMITH_NO_LLM
//      the queries ARE that expansion, and the run says so on stdout and in
//      RESEARCH.md.
//   3. The research-scope question runs when the topic is ambiguous or more
//      than one scope came back: `--scope <n|text>` answers it, `--yolo` takes
//      scope 1 and says so, a terminal asks.
//   3b. The user's own sources come first (19-PLAN §7.2): new PDFs in
//      `[sources] byo_pdf_dir` (bin/lib/byo-ingest.ts: hashed, identified from
//      a title or identifier only, tagged bring-your-own) and — when Zotero is
//      configured and `[sources] zotero_collection` names a collection — that
//      collection's items (bin/lib/zotero-ingest.ts, tagged zotero; D-19-24).
//      They go through the one library writer as soon as they are read, are
//      the user's own choices (never judged by the evaluator, never pruned),
//      and appear as rows of the per-adapter table. Without a collection the
//      Zotero library is searched per query like every other adapter.
//      config.toml travels with a shared paper, so it can only NAME these
//      sources (bin/lib/own-source-approvals.ts): a folder outside the project
//      and any Zotero collection are read only once this user approved them
//      for this paper (`new --pdfs`, or the `byo-folder` / `zotero-collection`
//      gates, which --yolo never skips; without a terminal the source is
//      skipped with a WARN and the row says why).
//   4. The research pass (bin/lib/research-orchestrator.ts): the preset's
//      adapters, per-adapter outcomes, dedup, deterministic tiers, the
//      `[sources]` policy, the source evaluator, ranking.
//   5. The research-prune question lists the kept candidates (preselected) and
//      the evaluator's rejections (deselected, with the reason), each with its
//      tier, year and an abstract excerpt; --yolo keeps the kept ones.
//   6. D-15: crossCheckRetractions BEFORE the library write; then the ONE
//      library writer (bin/lib/library.ts upsertSources) merges the kept
//      sources — with their type, tier, relevance and why-relevant note — into
//      LIBRARY.json and renders CITATIONS.bib / CITATIONS.ris.
//   7. RESEARCH.md: the research log plus the sources block rendered from
//      LIBRARY.json; the notes below its end line are never touched.
//
// Exit codes (D-19-27): no source found, every candidate excluded by the
// policy, every candidate rejected by the evaluator ("no relevant sources"),
// or none kept at the prune question → 1, with RESEARCH.md written and
// LIBRARY.json untouched; a question that cannot be answered → 3; a bad
// --scope or --queries → 2.
//
// D-12 LOCKED prompt slugs: 'topic-disambiguator' + 'source-evaluator'.
// D-15 LOCKED ordering: crossCheckRetractions BEFORE upsertSources.
// D-19 LOCKED chokepoint: CITATIONS.bib / .ris are rendered by the library writer.

import { defineCommand } from 'citty';
import { loadPrompt } from '../lib/prompt-loader.js';
import { upsertSources, assertLibraryReadable, tryLoadLibrary, type LibraryCandidate } from '../lib/library.js';
import { projectRoot } from '../lib/paths.js';
import { crossCheckRetractions, isNoRetractionDataReason, retractionCheckReason, type RetractionLookup } from '../lib/sources/retraction-cross-check.js';
import type { SourceCandidate } from '../lib/schemas/source-candidate.js';
import { complete, assertLlmConfigured, isNoLlmMode, StructuredOutputError } from '../lib/anthropic.js';
import type { TopicDisambiguation } from '../lib/llm-contracts.js';
import { runGate, canPrompt } from '../lib/gates.js';
import { PensmithError, EXIT_ERROR, EXIT_USAGE } from '../lib/exit-codes.js';
import { readIntakeBrief } from '../lib/intake-brief.js';
import { readPaperConfigSync } from '../lib/config.js';
import { resolveDiscipline } from '../lib/disciplines.js';
import { buildPromptRequest, requestHints } from '../lib/prompt-request.js';
import { clampQueries, expandTopicQueries, topicKeywords, topicLabel, MAX_QUERIES, MIN_QUERIES, MAX_QUERY_WORDS } from '../lib/query-expansion.js';
import { sourcePolicyFrom } from '../lib/source-policy.js';
import { networkMode } from '../lib/http-mock.js';
import { formatReference, renderSourcesBlock } from '../lib/research-md.js';
import { ingestByoPdfs, listPdfsInDir, describeByoOutcome } from '../lib/byo-ingest.js';
import { pullZoteroIntoLibrary } from '../lib/zotero-ingest.js';
import { enrichOpenAccess, describeOpenAccess } from '../lib/open-access.js';
import {
  isByoFolderApproved,
  isByoFolderExplicitlyApproved,
  approveByoFolder,
  isZoteroCollectionApproved,
  approveZoteroCollection,
} from '../lib/own-source-approvals.js';
import { configuredZoteroCollection, ZoteroError } from '../lib/sources/zotero.js';
import { isOfflineEgressError, offlineLabel } from '../lib/http.js';
import { errorFailureReason } from '../lib/sources/search-failure.js';
import type { PaperConfig } from '../lib/schemas/config.js';
import { deterministicTier } from '../lib/source-tier.js';
import { identifySource } from './add.js';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import {
  researchRegistry,
  researchAdapterPlan,
  runResearchPass,
  renderAdapterTable,
  renderResearchLog,
  writeResearchLog,
  logExclusions,
  unconfirmedNote,
  evaluatorNotes,
  tierSummary,
  upsertCounts,
  type ResearchItem,
  type ResearchPassResult,
  type AdapterRegistry,
  type AdapterOutcome,
  type OwnEvaluation,
  ownProvenance,
  ownSourcesToEvaluate,
  type LogExclusion,
  type LogRetraction,
} from '../lib/research-orchestrator.js';
import type { AdapterPlan } from '../lib/adapter-plan.js';
import { out as writeOut } from '../lib/output-sink.js';

/** An expected research failure: one line, exit 1 (D-19-27). */
export class ResearchError extends PensmithError {
  constructor(message: string) {
    super(message, EXIT_ERROR);
    this.name = 'ResearchError';
  }
}

/** One scope research can run: the model's (or the expansion's) queries after clamping. */
export interface ResearchScope {
  readonly label: string;
  readonly description: string;
  readonly queries: string[];
  /** Queries the scope proposed (normalised, distinct). */
  readonly proposed: number;
  readonly dropped: number;
  readonly padded: number;
}

/** Where the scopes came from. */
export type ScopeSource = 'model' | 'stub' | 'fallback';

const GUIDANCE = 'refine the topic (pensmith new), choose another scope (--scope), or add sources you know (pensmith add <doi>)';

/** Where a run's progress lines go (stdout / stderr unless a caller injects them). */
export interface ResearchIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const STD_IO: ResearchIo = {
  out: (line) => writeOut(`${line}\n`),
  err: (line) => void process.stderr.write(`${line}\n`),
};

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `--queries <n>`: an integer from MIN_QUERIES to MAX_QUERIES (EXIT_USAGE otherwise). */
export function parseQueriesCap(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return MAX_QUERIES;
  const s = String(raw).trim();
  const n = /^\d+$/.test(s) ? Number(s) : NaN;
  if (!Number.isInteger(n) || n < MIN_QUERIES || n > MAX_QUERIES) {
    throw new PensmithError(`--queries must be a whole number from ${MIN_QUERIES} to ${MAX_QUERIES} (got '${s}')`, EXIT_USAGE);
  }
  return n;
}

/** `--scope <n|text>` as given (EXIT_USAGE for an empty value), or undefined. */
export function parseScopeArg(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s.length === 0) throw new PensmithError('--scope needs a scope number (1, 2, 3) or words from a scope label or description', EXIT_USAGE);
  return s;
}

function listScopes(scopes: readonly ResearchScope[]): string {
  return scopes.map((s, i) => `${i + 1}) ${s.label} — ${oneLine(s.description)}`).join('; ');
}

/**
 * The scope `--scope` names: a 1-based index, an exact label, or the one scope
 * whose label or description contains the text (case-insensitive). EXIT_USAGE
 * (listing the scopes) when it names none, or more than one.
 */
export function resolveScopeArg(arg: string, scopes: readonly ResearchScope[]): number {
  if (/^\d+$/.test(arg)) {
    const i = Number(arg);
    if (i >= 1 && i <= scopes.length) return i - 1;
    throw new PensmithError(
      `--scope ${arg}: ${scopes.length === 1 ? 'only 1 scope was' : `${scopes.length} scopes were`} proposed — ${listScopes(scopes)}`,
      EXIT_USAGE,
    );
  }
  const needle = arg.toLowerCase();
  const exact = scopes.findIndex((s) => s.label.toLowerCase() === needle);
  if (exact >= 0) return exact;
  const hits = scopes
    .map((s, i) => ({ i, text: `${s.label} ${s.description}`.toLowerCase() }))
    .filter((x) => x.text.includes(needle));
  if (hits.length === 1) return (hits[0] as { i: number }).i;
  throw new PensmithError(
    `--scope "${arg}" ${hits.length === 0 ? 'matches none' : 'matches more than one'} of the proposed scopes — ${listScopes(scopes)}; pass its number`,
    EXIT_USAGE,
  );
}

interface Disambiguation {
  readonly ambiguous: boolean;
  readonly scopes: ResearchScope[];
  readonly source: ScopeSource;
  /** Why the deterministic expansion replaced the model's reply (fallback only). */
  readonly fallbackReason?: string;
}

function clampScope(s: { label: string; description: string; queries: readonly string[] }, topic: string, discipline: string, cap: number): ResearchScope {
  const c = clampQueries(s.queries, topic, discipline, cap);
  return { label: oneLine(s.label), description: oneLine(s.description), queries: c.queries, proposed: c.proposed, dropped: c.dropped, padded: c.padded };
}

/** The deterministic scope: the topic's expansion (the stub's and the fallback's queries). */
function expansionScope(topic: string, discipline: string, cap: number): ResearchScope {
  const queries = expandTopicQueries(topic, discipline);
  return clampScope({ label: topicLabel(topic), description: `Deterministic expansion of the intake topic "${topic}"`, queries }, topic, discipline, cap);
}

/** Ask the topic-disambiguator (or its stub) for scopes; an unusable reply falls back to the expansion, disclosed. */
async function disambiguate(topic: string, discipline: string, assignment: string, cap: number): Promise<Disambiguation> {
  const req = buildPromptRequest('topic-disambiguator', { topic, discipline, assignment });
  try {
    const result = await complete<TopicDisambiguation>({
      slug: 'topic-disambiguator',
      system: req.system,
      messages: req.messages,
      stubHint: requestHints(req),
    });
    const data = result.data as TopicDisambiguation;
    return {
      ambiguous: data.ambiguous,
      scopes: data.scopes.map((s) => clampScope(s, topic, discipline, cap)),
      source: isNoLlmMode() ? 'stub' : 'model',
    };
  } catch (e) {
    // A reply that never matched the schema (after the corrective retry) is
    // replaced by the deterministic expansion — said out loud, never silently.
    // Provider, cost-cap and configuration errors propagate.
    if (!(e instanceof StructuredOutputError)) throw e;
    return { ambiguous: false, scopes: [expansionScope(topic, discipline, cap)], source: 'fallback', fallbackReason: e.message };
  }
}

/** The disclosure under the query list, or null. */
function queryNote(scope: ResearchScope, source: ScopeSource): string | null {
  const notes: string[] = [];
  if (source === 'stub') notes.push('deterministic expansion of the intake topic — LLM stubbed');
  if (source === 'fallback') notes.push("deterministic expansion of the intake topic — the topic disambiguator's reply was unusable");
  if (scope.dropped > 0) notes.push(`the scope proposed ${scope.proposed} queries; the first ${scope.queries.length} are used`);
  if (scope.padded > 0) {
    notes.push(`the scope proposed ${scope.proposed}; ${scope.padded} added from the deterministic expansion of the intake topic`);
  }
  if (scope.queries.length < MIN_QUERIES) notes.push(`only ${scope.queries.length} distinct queries could be formed from the topic`);
  return notes.length > 0 ? notes.join('; ') : null;
}

/** Pick the scope: --scope, the only one, --yolo's scope 1, or the research-scope question. */
async function chooseScope(d: Disambiguation, scopeArg: string | undefined, yolo: boolean, io: ResearchIo): Promise<number> {
  if (scopeArg !== undefined) return resolveScopeArg(scopeArg, d.scopes);
  if (!d.ambiguous && d.scopes.length === 1) return 0;
  const outcome = await runGate('research-scope', {
    yolo,
    detail: `${d.scopes.length} scope(s) proposed; nothing was searched or written`,
    question: {
      id: 'research-scope',
      kind: 'select',
      label: 'Which research scope should I use?',
      options: d.scopes.map((s, i) => ({
        value: String(i + 1),
        label: `${s.label} — ${s.description}`,
        hint: s.queries.slice(0, 3).join('; '),
      })),
      default: '1',
    },
  });
  if (outcome.kind === 'yolo') {
    const s = d.scopes[0] as ResearchScope;
    io.out(`pensmith research: --yolo: using scope 1 of ${d.scopes.length} — "${s.label}": ${s.description}`);
    return 0;
  }
  if (outcome.kind === 'answered' && outcome.answer.kind === 'select') {
    const i = Number(outcome.answer.value) - 1;
    if (Number.isInteger(i) && i >= 0 && i < d.scopes.length) return i;
  }
  return 0;
}

function excerpt(text: string | null | undefined, max: number): string {
  const flat = oneLine(text ?? '');
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** One prune-question option: tier, year and title; the hint carries the reason and an abstract excerpt. */
function pruneOption(item: ResearchItem, rejected: boolean): { value: string; label: string; hint: string } {
  const tier = item.tier ?? (item.decision === 'not-evaluated' ? 'not evaluated' : 'tier unknown');
  const title = excerpt(item.candidate.title, 90);
  const why = rejected
    ? `rejected by the evaluator: ${item.reason ?? 'no reason given'}`
    : item.decision === 'not-evaluated'
      ? 'not evaluated'
      : item.reason ?? 'kept by the evaluator';
  const abstract = excerpt(item.candidate.abstract, 160);
  return {
    value: item.candidate.citekey,
    label: `[${tier}] ${title} (${item.candidate.year ?? 'n.d.'})`,
    hint: `${why}${abstract ? ` — ${abstract}` : ''}`,
  };
}

/**
 * The sources typed at the prune question: separated by spaces, commas or
 * semicolons, a bare prefix joined to what follows it (`DOI: 10.1038/x`,
 * `PMID: 31978945`).
 */
export function sourceTokens(raw: string): string[] {
  const parts = raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i] as string;
    const next = parts[i + 1];
    if (/^(?:doi|arxiv|pmid|pmcid|isbn(?:-1[03])?):$/i.test(p) && next !== undefined) {
      out.push(`${p} ${next}`);
      i += 1;
    } else out.push(p);
  }
  return out;
}

/** What the research-prune question decided. */
interface PruneDecision {
  /** Citekeys of the candidates the library gets. */
  readonly selected: Set<string>;
  /** Sources the user added at the question (identified like `pensmith add`). */
  readonly added: SourceCandidate[];
}

/**
 * The research-prune question: which of the kept (and rejected) candidates the
 * library gets, then "add a source you know" — DOIs, arXiv ids, PMIDs, ISBNs or
 * URLs, each identified exactly as `pensmith add` identifies it (bin/cli/add.ts
 * identifySource: found / not-found / failed, a URL through the one transport,
 * a PDF answer identified or refused) before the library is written. --yolo
 * keeps the evaluator's picks and adds nothing.
 */
async function pruneSelection(pass: ResearchPassResult, yolo: boolean, io: ResearchIo): Promise<PruneDecision> {
  const kept = pass.kept.map((k) => k.candidate.citekey);
  const n = pass.kept.length + pass.rejected.length;
  const outcome = await runGate('research-prune', {
    yolo,
    detail: `${n} candidates found; no library was written`,
    question: {
      id: 'research-prune',
      kind: 'multiselect',
      label: `Select candidates to keep (${n} found): the evaluator's picks are preselected; its rejections are listed unselected with the reason`,
      options: [...pass.kept.map((k) => pruneOption(k, false)), ...pass.rejected.map((r) => pruneOption(r, true))],
      default: kept,
    },
  });
  if (outcome.kind !== 'answered' || outcome.answer.kind !== 'multiselect') return { selected: new Set(kept), added: [] };
  const selected = new Set(outcome.answer.value);

  const more = await runGate('research-prune', {
    yolo,
    question: {
      id: 'research-prune',
      kind: 'text',
      label: 'Add a source you know — a DOI, arXiv id, PMID:<id>, isbn:<ISBN> or URL (several separated by spaces; blank for none)',
      default: '',
      // A script that answers only the selection (one line) is not aborted here.
      optional: true,
    },
  });
  const raw = more.kind === 'answered' && more.answer.kind === 'text' ? more.answer.value : '';
  const added: SourceCandidate[] = [];
  for (const token of sourceTokens(raw)) {
    const c = await identifySource(token, { prefix: 'pensmith research', out: io.out, err: io.err });
    if (c !== null) {
      io.out(`pensmith research: ${token} → ${c.title}${c.year ? ` (${c.year})` : ''}`);
      added.push(c);
    }
  }
  return { selected, added };
}

/** The adapters that returned nothing, with their status, for a no-sources message. */
function adapterReasons(pass: ResearchPassResult): string {
  return pass.adapters.map((a) => `${a.adapter} ${a.count} (${a.status})`).join(', ');
}

/** The policy exclusions counted by rule: `min_year 5, require_doi 3`. */
function exclusionCounts(items: readonly ResearchItem[]): string {
  const counts = new Map<string, number>();
  for (const x of items) {
    const rule = x.exclusion?.rule ?? 'policy';
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return [...counts.entries()].map(([r, c]) => `${r} ${c}`).join(', ');
}

/** What the own-sources step did: the table rows, and the plan without an entry it replaced. */
interface OwnSources {
  readonly plan: AdapterPlan;
  readonly rows: AdapterOutcome[];
  /** Works these sources added to LIBRARY.json in this run. */
  readonly added: number;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Step 3b (see the module header): ingest the user's own sources before the
 * search — the `[sources] byo_pdf_dir` PDFs and the `[sources]
 * zotero_collection` items. Each writes through the one library writer as it
 * is read; failures are reported as the row's status, never thrown (an offline
 * miss included). Under --dry-run nothing of the user's is touched.
 */
/**
 * Ask (gate `byo-folder` / `zotero-collection`) whether the user approves an
 * own source their paper's config.toml names; an approval is recorded in the
 * data dir. --yolo never answers it; without a terminal it is not approved.
 */
async function approveOwnSource(
  gate: 'byo-folder' | 'zotero-collection',
  label: string,
  yolo: boolean,
): Promise<boolean> {
  const outcome = await runGate(gate, {
    yolo,
    question: { id: gate, kind: 'confirm', label, default: false },
  });
  return outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true;
}

async function ingestOwnSources(
  root: string,
  config: PaperConfig,
  plan: AdapterPlan,
  io: ResearchIo,
  yolo: boolean,
): Promise<OwnSources> {
  const rows: AdapterOutcome[] = [];
  let added = 0;
  let outPlan = plan;
  const P = 'pensmith research';

  const byoSetting = config.sources?.byo_pdf_dir?.trim();
  if (byoSetting) {
    const dir = path.resolve(root, byoSetting);
    let approved = false;
    if (networkMode().dryRun) {
      rows.push({ adapter: 'bring-your-own', count: 0, status: 'skipped (--dry-run)' });
    } else if (!existsSync(dir) || !isDirectory(dir)) {
      io.err(`${P}: WARN — [sources] byo_pdf_dir = "${byoSetting}" is not a folder; no bring-your-own PDFs were read`);
      rows.push({ adapter: 'bring-your-own', count: 0, status: `failed ([sources] byo_pdf_dir "${byoSetting}" is not a folder)` });
    } else if (
      !(approved = isByoFolderApproved(root, dir)) &&
      !(await approveOwnSource(
        'byo-folder',
        `This paper's config.toml names ${dir} as its bring-your-own folder. Read the PDFs in it (outside the paper folder), copy them into .paper/sources/ and look up their titles?`,
        yolo,
      ))
    ) {
      io.err(
        `${P}: WARN — [sources] byo_pdf_dir points outside the paper folder and you have not approved it for this paper; ` +
          'no PDFs were read. Approve it by running pensmith research in a terminal, pass it with pensmith new --pdfs, or move the folder into the paper.',
      );
      rows.push({ adapter: 'bring-your-own', count: 0, status: 'skipped ([sources] byo_pdf_dir is outside the paper folder and not approved)' });
    } else {
      if (!approved) await approveByoFolder(root, dir);
      // A folder inside the paper that the user never approved themselves is
      // read only as far as the paper reaches: a link in it to a file
      // elsewhere is not followed (a shared paper could ship one).
      const confined = !isByoFolderExplicitlyApproved(root, dir);
      let links = 0;
      const files = await listPdfsInDir(dir, {
        ...(confined ? { confineTo: root } : {}),
        onSkip: (file, why) => {
          links += 1;
          io.err(`${P}: WARN — bring-your-own: ${path.basename(file)} skipped: ${why} (approve the folder with pensmith new --pdfs ${byoSetting}, or copy the PDF into it)`);
        },
      });
      const outcomes = await ingestByoPdfs(root, files, { provenance: 'byo' });
      let inLibrary = 0;
      let fresh = 0;
      let skipped = 0;
      for (const o of outcomes) {
        // Already-ingested PDFs are quiet; new, merged and skipped ones are told.
        if (o.status !== 'already-ingested' || o.warning !== undefined) {
          const d = describeByoOutcome(o, P);
          (d.stream === 'stdout' ? io.out : io.err)(d.line);
        }
        if (o.status === 'refused' || o.status === 'skipped') skipped += 1;
        else {
          inLibrary += 1;
          if (o.status === 'added') fresh += 1;
        }
      }
      added += fresh;
      const parts = [`${fresh} new`, `${inLibrary - fresh} already in library`];
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (links > 0) parts.push(`${links} outside the paper not followed`);
      rows.push({ adapter: 'bring-your-own', count: inLibrary, status: `${outcomes.length === 0 ? 'no PDFs' : 'ok'} (${byoSetting}: ${parts.join(', ')})` });
    }
  }

  const collection = configuredZoteroCollection(root);
  if (collection !== null && plan.entries.some((e) => e.adapter === 'zotero')) {
    // The collection is the user's curated list: pull all of it once instead
    // of searching it per query (Tier 1 does the same through its Zotero MCP
    // server and paper_ingest_zotero_items).
    outPlan = { entries: plan.entries.filter((e) => e.adapter !== 'zotero'), skipped: plan.skipped };
    const approved =
      isZoteroCollectionApproved(root, collection) ||
      (await approveOwnSource(
        'zotero-collection',
        `This paper's config.toml names the Zotero collection "${collection}". Pull its items from your Zotero library into this paper's LIBRARY.json?`,
        yolo,
      ));
    if (!approved) {
      io.err(
        `${P}: WARN — [sources] zotero_collection "${collection}" has not been approved for this paper; Zotero was not read. ` +
          'Approve it by running pensmith research in a terminal.',
      );
      rows.push({ adapter: 'zotero', count: 0, status: 'skipped ([sources] zotero_collection not approved for this paper)' });
      return { plan: outPlan, rows, added };
    }
    await approveZoteroCollection(root, collection);
    try {
      const pulled = await pullZoteroIntoLibrary(root, { collection });
      added += pulled.added.length;
      const known = pulled.merged.length + pulled.unchanged.length;
      const extra = [
        ...(pulled.skipped.length > 0 ? [`${pulled.skipped.length} not a citable work`] : []),
        ...(pulled.invalid.length > 0 ? [`${pulled.invalid.length} malformed`] : []),
      ];
      rows.push({
        adapter: 'zotero',
        count: pulled.added.length + known,
        status: `ok (collection "${collection}": ${pulled.added.length} new, ${known} already in library${extra.length > 0 ? `, ${extra.join(', ')}` : ''})`,
      });
      io.out(`${P}: Zotero collection "${collection}" (${pulled.library}): ${pulled.added.length} new, ${known} already in library`);
      for (const bad of pulled.invalid.slice(0, 5)) io.err(`${P}: WARN — Zotero item skipped (malformed): ${bad}`);
    } catch (e) {
      // RESEARCH.md travels with the paper: its row never carries what a
      // failed lookup revealed about the user's library (collection names,
      // the library id); stderr, seen only by this user, has the whole reason.
      const status = isOfflineEgressError(e)
        ? `${offlineLabel(e)}: no recorded fixture`
        : `failed (${e instanceof ZoteroError ? e.publicReason : errorFailureReason(e)})`;
      const detail = isOfflineEgressError(e) ? status : `failed (${e instanceof ZoteroError ? e.message : errorFailureReason(e)})`;
      rows.push({ adapter: 'zotero', count: 0, status });
      io.err(`${P}: WARN — Zotero collection "${collection}" was not read: ${detail}`);
    }
  }
  return { plan: outPlan, rows, added };
}

export interface ResearchRunOptions {
  readonly root: string;
  readonly yolo: boolean;
  /** `--scope <n|text>`. */
  readonly scope?: string | undefined;
  /** `--queries <n>` (raw). */
  readonly queries?: string | undefined;
  /** Progress sink (default stdout / stderr). */
  readonly io?: ResearchIo;
}

export interface ResearchRunResult {
  readonly ok: true;
  readonly library: string;
  readonly bib: string;
  readonly ris: string;
  readonly research: string;
  readonly kept: number;
  readonly added: number;
  readonly scope: string;
  readonly queries: string[];
}

/** `pensmith research` (see the module header). */
export async function runResearch(opts: ResearchRunOptions): Promise<ResearchRunResult> {
  const root = opts.root;
  const { out, err } = opts.io ?? STD_IO;
  const cap = parseQueriesCap(opts.queries);
  const scopeArg = parseScopeArg(opts.scope);

  // RUN-28: the source-pruning question needs a terminal (or scripted
  // answers) or --yolo, whatever --scope answers. Known now — refuse before
  // any model call, search or write.
  if (!opts.yolo && !canPrompt()) {
    await runGate('research-prune', { yolo: false, detail: 'nothing was searched, sent or written' });
  }

  // D-12: both slugs hash-checked before any work.
  loadPrompt('topic-disambiguator');
  loadPrompt('source-evaluator');
  // RUN-07: an LLM must be configured.
  await assertLlmConfigured('research');
  // RUN-12: an unreadable LIBRARY.json is one line naming it, before any search.
  await assertLibraryReadable(root);
  const config = readPaperConfigSync(root).config;

  // 1. The brief (D-19-03: through the seam reader; a pre-Phase-18 INTAKE.md is migrated in memory).
  const doc = readIntakeBrief(root);
  if (doc === null) {
    throw new ResearchError('pensmith research: no .paper/INTAKE.md — research seeds its queries from the paper\'s brief; run pensmith new first');
  }
  const discipline = resolveDiscipline({ discipline: { intake: doc.brief.discipline, config: config.project?.discipline_preset } }).slug.value;
  const assignment = doc.assignment;
  const topic = oneLine(doc.brief.topic) || topicKeywords(assignment).slice(0, MAX_QUERY_WORDS).join(' ');
  if (!topic) {
    throw new ResearchError(`pensmith research: ${doc.file} has no topic and no assignment text to take one from — run pensmith new`);
  }

  // 2–3. Scopes and queries.
  const d = await disambiguate(topic, discipline, assignment, cap);
  if (d.source === 'fallback') {
    err(`pensmith research: WARN — ${d.fallbackReason ?? 'the topic disambiguator failed'}; using the deterministic expansion of the intake topic instead`);
  }
  const chosen = d.scopes[await chooseScope(d, scopeArg, opts.yolo, { out, err })] as ResearchScope;
  const note = queryNote(chosen, d.source);
  out(`pensmith research: scope "${chosen.label}" — ${chosen.queries.length} quer${chosen.queries.length === 1 ? 'y' : 'ies'}${note ? ` (${note})` : ''}`);
  chosen.queries.forEach((q, i) => out(`  ${i + 1}. ${q}`));

  // 4. The research pass.
  const registry: AdapterRegistry = researchRegistry();
  const plan = researchAdapterPlan({
    registry,
    byPreference: !networkMode().dryRun,
    discipline,
    configDiscipline: config.project?.discipline_preset,
    allowed: config.sources?.allowed_databases,
  });
  const scopeText = `${chosen.label} — ${chosen.description}`;
  const own = await ingestOwnSources(root, config, plan, { out, err }, opts.yolo);
  // The user's own entries the evaluator has not judged yet join its batch:
  // they get a tier, a relevance and a why-relevant note, never a removal.
  const ownToEvaluate = networkMode().dryRun ? [] : ownSourcesToEvaluate((await tryLoadLibrary(root))?.entries ?? []);
  const pass0 = await runResearchPass({
    own: ownToEvaluate,
    queries: chosen.queries,
    plan: own.plan,
    registry,
    policy: sourcePolicyFrom(config.sources),
    topic,
    discipline,
    scope: scopeText,
    warn: err,
  });
  // The own-source rows join the per-adapter table (stdout and RESEARCH.md).
  const pass: ResearchPassResult = own.rows.length > 0 ? { ...pass0, adapters: [...pass0.adapters, ...own.rows] } : pass0;
  out('pensmith research: sources by adapter');
  for (const line of renderAdapterTable(pass.adapters)) out(line);
  for (const n of evaluatorNotes(pass)) err(`pensmith research: WARN — ${n}`);
  // Main-branch merge review, round 2: a kept source whose DOI the registrar
  // records as another work is dropped (verify would block it as MIS-CITED).
  for (const u of pass.unconfirmed) err(`pensmith research: WARN — dropped [@${u.candidate.citekey}]: ${u.registrarMismatch ?? 'another work under its DOI'}`);

  const writeLog = async (args: {
    summary: string;
    excluded: LogExclusion[];
    retracted?: LogRetraction[];
    retractionUnknown?: LogRetraction[];
    sourcesBlock: string;
  }): Promise<string> =>
    writeResearchLog(root, renderResearchLog({
      scope: scopeText,
      topic,
      discipline,
      generated: new Date().toISOString(),
      queries: chosen.queries,
      queryNote: note,
      summary: args.summary,
      notes: evaluatorNotes(pass),
      adapters: pass.adapters,
      perQuery: pass.perQuery,
      excluded: args.excluded,
      retracted: args.retracted ?? [],
      retractionUnknown: args.retractionUnknown ?? [],
      sourcesBlock: args.sourcesBlock,
    }));
  const currentBlock = async (): Promise<string> => renderSourcesBlock((await tryLoadLibrary(root))?.entries ?? []);

  // Zero usable sources → exit 1 naming why (the log is still written).
  if (pass.distinct === 0) {
    await writeLog({ summary: 'no sources found', excluded: [], sourcesBlock: await currentBlock() });
    const ownKept = own.rows.filter((r) => r.count > 0).map((r) => `${r.adapter} ${r.count}`);
    throw new ResearchError(
      `pensmith research: no sources found — ${adapterReasons(pass0)}; ${GUIDANCE}; ` +
        `${ownKept.length > 0 ? `your own sources are in LIBRARY.json (${ownKept.join(', ')}); ` : ''}see .paper/RESEARCH.md`,
    );
  }
  if (pass.kept.length === 0 && pass.rejected.length === 0) {
    const dropped = pass.unconfirmed.length;
    const policy = `${pass.excluded.length} candidate(s) excluded by the [sources] policy`;
    await writeLog({
      summary: dropped === 0 ? `no usable sources: all ${policy}` : `no usable sources: ${policy}; ${unconfirmedNote(dropped)}`,
      excluded: logExclusions(pass.excluded, [], pass.unconfirmed),
      sourcesBlock: await currentBlock(),
    });
    throw new ResearchError(
      dropped === 0
        ? `pensmith research: no usable sources — all ${pass.excluded.length} candidate(s) were excluded by the [sources] policy ` +
            `(${exclusionCounts(pass.excluded)}); relax [sources] in .paper/config.toml or add sources you know (pensmith add <doi>); see .paper/RESEARCH.md`
        : `pensmith research: no usable sources — ${policy}${pass.excluded.length > 0 ? ` (${exclusionCounts(pass.excluded)})` : ''}; ${unconfirmedNote(dropped)}; ` +
            'add sources you know (pensmith add <doi>) or try other queries; see .paper/RESEARCH.md',
    );
  }

  // 5. The research-prune question (and the sources the user adds at it).
  const prune = await pruneSelection(pass, opts.yolo, { out, err });
  const selected = prune.selected;
  const userAdded = prune.added;
  const final = [...pass.kept, ...pass.rejected].filter((i) => selected.has(i.candidate.citekey));
  const deselected: LogExclusion[] = pass.kept
    .filter((k) => !selected.has(k.candidate.citekey))
    .map((k) => ({ citekey: k.candidate.citekey, reference: formatReference(k.view), why: 'deselected at the approval gate' }));
  const rejectedStill = pass.rejected.filter((r) => !selected.has(r.candidate.citekey));
  const excludedLog = [...logExclusions(pass.excluded, rejectedStill, pass.unconfirmed), ...deselected];
  if (final.length === 0 && userAdded.length === 0) {
    const relevantNone = pass.kept.length === 0;
    await writeLog({ summary: relevantNone ? 'no relevant sources' : 'no sources kept', excluded: excludedLog, sourcesBlock: await currentBlock() });
    throw new ResearchError(
      relevantNone
        ? `pensmith research: no relevant sources — the evaluator rejected all ${pass.rejected.length} candidate(s) for scope "${chosen.label}"; ${GUIDANCE}; LIBRARY.json is unchanged; see .paper/RESEARCH.md`
        : 'pensmith research: no sources kept — every candidate was deselected; LIBRARY.json is unchanged',
    );
  }

  // 6. D-15 LOCKED: the retraction cross-check BEFORE the library write.
  const candidates: SourceCandidate[] = final.map((i) => i.candidate);
  const injected = registry['retraction-watch'] as Partial<RetractionLookup> | undefined;
  const lookup = typeof injected?.fetchById === 'function' ? (injected as RetractionLookup) : undefined;
  if (!networkMode().dryRun) {
    // (--dry-run: synthetic sources have no retraction record to look up.)
    await crossCheckRetractions([...candidates, ...userAdded], lookup);
    // GRND-14: the open-access PDF Pass 3 would check, as each entry's oa_url.
    const oa = describeOpenAccess(await enrichOpenAccess([...candidates, ...userAdded]));
    if (oa !== null) out(`pensmith research: ${oa}`);
  }
  const toLibrary = (i: ResearchItem): LibraryCandidate => {
    const rescued = i.decision === 'rejected';
    return {
      ...i.candidate,
      tier: i.tier,
      relevance: i.relevance,
      why_relevant: rescued ? `Kept at your choice; the evaluator said: ${i.reason ?? 'no reason given'}` : i.reason,
    };
  };
  // The evaluator's notes on the user's own entries (bring-your-own, Zotero),
  // merged into those entries under their own provenance (the library writer
  // matches them by identifier; the latest evaluation wins).
  await annotateOwnSources(root, pass.own);

  // The user's additions first (provenance `add`, tagged "added"), then the
  // kept search results — so a work the user named that the search also found
  // keeps the user's tag too.
  const addedUpsert = userAdded.length > 0
    ? await upsertSources(
        root,
        userAdded.map((c): LibraryCandidate => ({ ...c, tier: deterministicTier({ ...c }), why_relevant: 'Added at the approval gate' })),
        { provenance: 'add' },
      )
    : null;
  const researchUpsert = final.length > 0 ? await upsertSources(root, final.map(toLibrary), { provenance: 'research' }) : null;
  const upsert = (researchUpsert ?? addedUpsert) as NonNullable<typeof researchUpsert>;
  const counts = upsertCounts([...(addedUpsert?.outcomes ?? []), ...(researchUpsert?.outcomes ?? [])]);
  const added = counts.added.length;
  const keyIn = (u: typeof researchUpsert, list: readonly SourceCandidate[], index: number): string =>
    u?.outcomes.find((o) => o.index === index)?.citekey ?? (list[index] as SourceCandidate).citekey;

  const retracted: LogRetraction[] = [];
  const unknown: LogRetraction[] = [];
  const noteRetraction = (c: SourceCandidate, citekey: string): void => {
    if (retracted.some((r) => r.citekey === citekey) || unknown.some((r) => r.citekey === citekey)) return;
    if (c.retracted === true || c.retraction_status === 'retracted') retracted.push({ citekey, detail: c.retraction_details ?? null });
    else if (c.retraction_status === 'unknown') unknown.push({ citekey, detail: retractionCheckReason(c) ?? c.retraction_details ?? null });
  };
  userAdded.forEach((c, index) => noteRetraction(c, keyIn(addedUpsert, userAdded, index)));
  candidates.forEach((c, index) => noteRetraction(c, keyIn(researchUpsert, candidates, index)));

  // 7. RESEARCH.md: the log plus the sources block of the library just written.
  const rescuedCount = final.filter((i) => i.decision === 'rejected').length;
  const summary =
    `${tierSummary(final)}; ${pass.excluded.length} excluded by [sources] policy; ${rejectedStill.length} rejected by the evaluator` +
    `${pass.unconfirmed.length > 0 ? `; ${unconfirmedNote(pass.unconfirmed.length)}` : ''}` +
    `${deselected.length > 0 ? `; ${deselected.length} deselected at the approval gate` : ''}` +
    `${rescuedCount > 0 ? `; ${rescuedCount} kept at your choice despite the evaluator` : ''}` +
    `${userAdded.length > 0 ? `; ${userAdded.length} added at the approval gate` : ''}` +
    `${pass.own.length > 0 ? `; ${pass.own.length} of your own source(s) evaluated` : ''}`;
  const researchPath = await writeLog({
    summary,
    excluded: excludedLog,
    retracted,
    retractionUnknown: unknown,
    sourcesBlock: renderSourcesBlock(upsert.library.entries),
  });

  out(`pensmith research: ${summary}`);
  if (retracted.length > 0) {
    err(`WARN: ${retracted.length} retracted source(s) found in LIBRARY.json: ${retracted.map((r) => r.citekey).join(', ')}. These will FAIL Pass-1 if cited.`);
  }
  if (unknown.length > 0) {
    // D-20-13: why each is unknown — a failed lookup, or a DOI another agency
    // registered (no retraction data for it) — is in RESEARCH.md; never "clear".
    const why = [...new Set(unknown.map((r) => r.detail).filter((d): d is string => typeof d === 'string' && d.length > 0))];
    // Review round 2: a failed lookup is asked again; an agency with no retraction data never answers.
    const failedLookups = unknown.filter((r) => !isNoRetractionDataReason(r.detail)).length;
    const next =
      failedLookups === 0
        ? 'their registration agencies publish no retraction data, so they stay unknown (reported, never shown as clear)'
        : failedLookups === unknown.length
          ? 'verify and done re-check them'
          : 'verify and done re-check the failed lookups; a DOI whose agency publishes no retraction data stays unknown';
    err(
      `WARN: retraction status unknown for ${unknown.length} source(s): ${unknown.map((r) => r.citekey).join(', ')} — ` +
        `${why.length === 1 ? why[0] : why.length > 1 ? `${why[0]} (and ${why.length - 1} other reason(s), see RESEARCH.md)` : 'the lookup failed'}; ${next}.`,
    );
  }
  out(
    `pensmith research: wrote LIBRARY.json (${upsert.library.entries.length} source(s); ${added} new` +
      `${counts.known.length > 0 ? `, ${counts.known.length} already in library` : ''}` +
      `${counts.duplicates > 0 ? `, ${counts.duplicates} duplicate(s) merged` : ''}), RESEARCH.md, CITATIONS.bib and CITATIONS.ris`,
  );
  return {
    ok: true,
    library: upsert.paths.library,
    bib: upsert.paths.bib,
    ris: upsert.paths.ris,
    research: researchPath,
    kept: final.length + userAdded.length,
    added,
    scope: chosen.label,
    queries: chosen.queries,
  };
}

/** Merge the evaluator's notes on the user's own entries into them (grouped by their own provenance). */
async function annotateOwnSources(root: string, evaluations: readonly OwnEvaluation[]): Promise<void> {
  const groups = new Map<string, LibraryCandidate[]>();
  for (const ev of evaluations) {
    const prov = ownProvenance(ev.entry);
    if (prov === null) continue;
    const e = ev.entry;
    const why = ev.decision === 'rejected'
      ? `Your own source; the evaluator judged it off-scope: ${ev.reason ?? 'no reason given'}`
      : ev.reason;
    const candidate: LibraryCandidate = {
      citekey: e.citekey,
      ...(prov.source !== null ? { source: prov.source } : {}),
      doi: e.doi,
      arxiv: e.arxiv,
      pmid: e.pmid,
      pmcid: e.pmcid,
      isbn: e.isbn,
      title: e.title,
      authors: [...e.authors],
      year: e.year,
      tier: ev.tier,
      relevance: ev.relevance,
      why_relevant: why,
    };
    const list = groups.get(prov.prefix) ?? [];
    list.push(candidate);
    groups.set(prov.prefix, list);
  }
  for (const [prefix, candidates] of groups) await upsertSources(root, candidates, { provenance: prefix });
}

export const researchCommand = defineCommand({
  meta: {
    name: 'research',
    description: 'Discover sources for the paper and build its library (LIBRARY.json, CITATIONS.bib, RESEARCH.md).',
  },
  args: {
    scope: {
      type: 'string',
      description: 'Choose the research scope without a prompt: its number (1-3) or words from its label or description.',
    },
    queries: {
      type: 'string',
      description: `Cap the queries of the chosen scope (${MIN_QUERIES}-${MAX_QUERIES}; default ${MAX_QUERIES}).`,
    },
    yolo: {
      type: 'boolean',
      description: 'Skip the scope and source-pruning questions (scope 1; keep the evaluator\'s picks).',
      default: false,
    },
  },
  async run({ args }) {
    return runResearch({
      root: projectRoot(),
      yolo: args.yolo === true,
      scope: typeof args.scope === 'string' ? args.scope : undefined,
      queries: typeof args.queries === 'string' ? args.queries : undefined,
    });
  },
});

export default researchCommand;
