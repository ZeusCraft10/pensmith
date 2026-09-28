// bin/lib/config.ts — the ONE reader and writer of `.paper/config.toml` (CONF-01, D-17-31).
//
// Chokepoint (scripts/chokepoints/config-toml.json): no other module imports
// smol-toml or touches config.toml. Every verb that needs a per-paper setting
// reads it through loadPaperConfig / readPaperConfigSync, and every writer goes
// through updatePaperConfig (atomic write under the per-file lock).
//
// Load pipeline (both sync and async readers share it):
//   1. read + TOML-parse (a parse error is a one-line ConfigError);
//   2. version gate: no `schema_version` is v0; a version newer than this
//      build is refused with an upgrade message;
//   3. migrate v0 → v1 (bin/lib/migrations/config/); the async loader writes
//      the migrated file back (writeBack defaults on);
//   4. refusals: `[verification] verify_quotes` (PRD §14: Pass 3 is blocking)
//      and `[runtime] endpoint` / `api_key_env` (S-18: they live only in the
//      global runtime.json);
//   5. unknown keys: one warning per key per process, then ignored — ignored
//      for validation only: a write-back (migration or updatePaperConfig)
//      keeps them in the file, so pensmith never deletes a key it does not
//      recognise (a newer pensmith's, or the user's own note);
//   6. zod validation (schemas/config.ts) → one-line ConfigError.
//
// The educator-mode [project] keys are an opaque fragment from tutorial.ts;
// this module never names them.

import { existsSync, readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { z } from 'zod';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { paperDir, pensmithDataDir, projectRoot } from './paths.js';
import { EXIT_ERROR, EXIT_USAGE, PensmithError, type ExitCode } from './exit-codes.js';
import { SLUGS, canonicalSlug } from './llm-models.js';
import {
  CONFIG_TABLES,
  CURRENT_CONFIG_VERSION,
  PaperConfigSchema,
  PaperSlugOverrideSchema,
  type PaperConfig,
} from './schemas/config.js';
import { PROJECT_CONFIG_FRAGMENT, PROJECT_CONFIG_FRAGMENT_DEFAULTS } from './tutorial.js';
import { migrate as v0ToV1 } from './migrations/config/v0_to_v1.js';
import { editTomlText } from './config-text.js';

export type { PaperConfig } from './schemas/config.js';
export { CURRENT_CONFIG_VERSION } from './schemas/config.js';

/** A config.toml problem: printed as one line by the dispatcher, exit EXIT_ERROR. */
export class ConfigError extends PensmithError {
  constructor(message: string, exitCode: ExitCode = EXIT_ERROR) {
    super(message, exitCode);
    this.name = 'ConfigError';
  }
}

const MIGRATIONS: Readonly<Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>> = Object.freeze({
  0: v0ToV1,
});

export const VERIFY_QUOTES_REFUSAL =
  'verify_quotes is not configurable: Pass 3 quote verification is a blocking pass (PRD §14) — ' +
  'turning it off would let a quote-NOT_FOUND citation reach the compiled paper. Remove it from [verification].';

export function paperConfigPath(root: string = projectRoot()): string {
  return path.join(paperDir(root), 'config.toml');
}

function globalRuntimePath(): string {
  return path.join(pensmithDataDir(), 'runtime.json');
}

function relName(root: string, file: string): string {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : file;
}

// ---------------------------------------------------------------------------
// Warnings (one per distinct line per process)
// ---------------------------------------------------------------------------

const warned = new Set<string>();

function warnOnce(line: string): void {
  if (warned.has(line)) return;
  warned.add(line);
  process.stderr.write(line + '\n');
}

/** Test-only: forget which config warnings already printed. */
export function _resetConfigWarningsForTest(): void {
  warned.clear();
}

// ---------------------------------------------------------------------------
// Parse + migrate + validate (pure over the file text)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** smol-toml returns TomlDate (a Date) for unquoted dates; the schema stores them as strings. */
function normalizeTomlValues(v: unknown): unknown {
  if (v instanceof Date) {
    const iso = v.toISOString();
    return /^\d{4}-\d{2}-\d{2}/.test(iso) && iso.length > 10 && iso.endsWith('T00:00:00.000Z')
      ? iso.slice(0, 10)
      : iso;
  }
  if (Array.isArray(v)) return v.map(normalizeTomlValues);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = normalizeTomlValues(val);
    return out;
  }
  return v;
}

interface Parsed {
  config: PaperConfig;
  /**
   * The raw migrated object, as it would be written back: every key the file
   * had (unknown keys included — they are warned about and ignored, never
   * deleted). Validation runs on a copy with the unknown keys stripped.
   */
  raw: Record<string, unknown>;
  migratedFrom: number | null;
  warnings: string[];
}

function parseAndValidate(text: string, fileLabel: string): Parsed {
  let raw: Record<string, unknown>;
  try {
    raw = normalizeTomlValues(parseToml(text)) as Record<string, unknown>;
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0] ?? String(e);
    throw new ConfigError(`${fileLabel} is not valid TOML: ${msg}`);
  }

  // 2. Version gate.
  const sv = raw['schema_version'];
  let version: number;
  if (sv === undefined) version = 0;
  else if (typeof sv === 'number' && Number.isInteger(sv) && sv >= 0) version = sv;
  else throw new ConfigError(`${fileLabel}: schema_version must be an integer (got ${JSON.stringify(sv)})`);
  if (version > CURRENT_CONFIG_VERSION) {
    throw new ConfigError(
      `${fileLabel} has schema_version ${version}, newer than this pensmith supports (${CURRENT_CONFIG_VERSION}); upgrade pensmith`,
    );
  }

  // 3. Migrate.
  let migratedFrom: number | null = null;
  let v = version;
  while (v < CURRENT_CONFIG_VERSION) {
    const mig = MIGRATIONS[v];
    if (!mig) throw new ConfigError(`${fileLabel}: no migration from config schema v${v}`);
    if (migratedFrom === null) migratedFrom = v;
    raw = mig(raw);
    v += 1;
  }

  // 4. Refusals (errors, never warnings).
  const verification = raw['verification'];
  if (isPlainObject(verification) && 'verify_quotes' in verification) {
    throw new ConfigError(`${fileLabel}: ${VERIFY_QUOTES_REFUSAL}`);
  }
  const runtime = raw['runtime'];
  if (isPlainObject(runtime)) {
    for (const k of ['endpoint', 'api_key_env']) {
      if (k in runtime) {
        throw new ConfigError(
          `${fileLabel}: [runtime] ${k} is not allowed in a paper's config — a paper's files cannot choose ` +
            `where prompts and keys are sent. Set it in the global runtime config ${globalRuntimePath()}`,
        );
      }
    }
  }

  // 5. Unknown keys → warn once, strip.
  const warnings: string[] = [];
  const cleaned: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(raw)) {
    if (k === 'schema_version') {
      cleaned[k] = val;
      continue;
    }
    const table = CONFIG_TABLES[k];
    if (!table) {
      warnings.push(`unknown key "${k}"`);
      continue;
    }
    if (!isPlainObject(val)) {
      cleaned[k] = val; // let zod report the type error
      continue;
    }
    const shape = table.shape as Record<string, unknown>;
    const inner: Record<string, unknown> = {};
    for (const [ik, iv] of Object.entries(val)) {
      if (!(ik in shape)) {
        warnings.push(`unknown key "${k}.${ik}"`);
        continue;
      }
      if (k === 'runtime' && ik === 'slugs' && isPlainObject(iv)) {
        const slugs: Record<string, unknown> = {};
        // A step alias (`pass2` → claim-support, RUN-26) names its prompt slug;
        // an explicit [runtime.slugs.<slug>] table wins over its alias.
        const entries = Object.entries(iv).sort(([a], [b]) => Number(a in SLUGS) - Number(b in SLUGS));
        for (const [name, ov] of entries) {
          const slug = canonicalSlug(name);
          if (slug === null) {
            warnings.push(`unknown prompt slug "runtime.slugs.${name}"`);
            continue;
          }
          if (slug !== name && Object.prototype.hasOwnProperty.call(iv, slug)) {
            warnings.push(`"runtime.slugs.${name}" and "runtime.slugs.${slug}" name the same step — using [runtime.slugs.${slug}]`);
            continue;
          }
          if (isPlainObject(ov)) {
            const slugShape = PaperSlugOverrideSchema.shape as Record<string, unknown>;
            const kept: Record<string, unknown> = {};
            for (const [sk, sv2] of Object.entries(ov)) {
              if (sk in slugShape) kept[sk] = sv2;
              else warnings.push(`unknown key "runtime.slugs.${name}.${sk}"`);
            }
            slugs[slug] = kept;
          } else {
            slugs[slug] = ov;
          }
        }
        inner[ik] = slugs;
        continue;
      }
      inner[ik] = iv;
    }
    cleaned[k] = inner;
  }

  // 6. Validate.
  const parsed = PaperConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigError(`${fileLabel}: ${formatIssues(parsed.error.issues)}`);
  }
  return { config: parsed.data, raw, migratedFrom, warnings };
}

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}

function emitWarnings(fileLabel: string, warnings: readonly string[]): void {
  for (const w of warnings) warnOnce(`pensmith: ${fileLabel}: ${w} (ignored)`);
}

/**
 * Parse, migrate and validate config.toml TEXT without touching disk (the PRD
 * §10 drift test runs the documented block through this exact path). Returns
 * the unknown-key warnings instead of printing them.
 */
export function parsePaperConfigText(
  text: string,
  fileLabel = 'config.toml',
): { config: PaperConfig; warnings: string[]; migratedFrom: number | null } {
  const parsed = parseAndValidate(text, fileLabel);
  return { config: parsed.config, warnings: [...parsed.warnings], migratedFrom: parsed.migratedFrom };
}

const EMPTY_CONFIG: PaperConfig = Object.freeze({ schema_version: CURRENT_CONFIG_VERSION }) as PaperConfig;

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export interface PaperConfigRead {
  config: PaperConfig;
  exists: boolean;
  path: string;
  /** The on-disk version a migration started from (null when the file was current or absent). */
  migratedFrom: number | null;
}

/**
 * Synchronous read (no write-back). Throws ConfigError on an invalid, newer or
 * refused file; an absent file yields the empty v1 config.
 */
export function readPaperConfigSync(root: string = projectRoot()): PaperConfigRead {
  const file = paperConfigPath(root);
  if (!existsSync(file)) return { config: EMPTY_CONFIG, exists: false, path: file, migratedFrom: null };
  const label = relName(root, file);
  const parsed = parseAndValidate(readFileSync(file, 'utf8'), label);
  emitWarnings(label, parsed.warnings);
  return { config: parsed.config, exists: true, path: file, migratedFrom: parsed.migratedFrom };
}

/** Never-throwing read for read-only callers (status, goal routing): null when absent or invalid. */
export function tryReadPaperConfigSync(root: string = projectRoot()): PaperConfig | null {
  try {
    const r = readPaperConfigSync(root);
    return r.exists ? r.config : null;
  } catch {
    return null;
  }
}

/**
 * Async read. An older file is migrated and, with writeBack (default true),
 * written back under the per-file lock with `schema_version = 1`.
 */
export async function loadPaperConfig(
  root: string = projectRoot(),
  opts: { writeBack?: boolean } = {},
): Promise<PaperConfig> {
  const file = paperConfigPath(root);
  if (!existsSync(file)) return EMPTY_CONFIG;
  const label = relName(root, file);
  const writeBack = opts.writeBack !== false;
  const run = async (): Promise<PaperConfig> => {
    const text = await fsp.readFile(file, 'utf8');
    const parsed = parseAndValidate(text, label);
    emitWarnings(label, parsed.warnings);
    if (parsed.migratedFrom !== null && writeBack) {
      await writeConfigText(file, text, parsed.raw);
      warnOnce(`pensmith: ${label}: migrated from schema v${parsed.migratedFrom} to v${CURRENT_CONFIG_VERSION}`);
    }
    return parsed.config;
  };
  return writeBack ? withLock(file, run) : run();
}

/**
 * Write an older config.toml back at the current schema version (CONF-01's
 * write-back). Called by a MUTATING session once it holds the paper's session
 * lock (the CLI dispatcher, the MCP mutating tools) — never by a read-only verb
 * (`status --config`, the router, doctor): those migrate in memory only.
 * A no-op for a current, absent or invalid file (the verb's own read reports
 * an invalid one).
 */
export async function migratePaperConfigFile(root: string = projectRoot()): Promise<void> {
  const file = paperConfigPath(root);
  if (!existsSync(file)) return;
  try {
    await loadPaperConfig(root, { writeBack: true });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
  }
}

/**
 * Persist `next` (a raw config object) over `original` (the file's current
 * text), preserving the user's comments and formatting: only the keys that
 * changed are edited, added or removed (config-text.ts). When a change cannot
 * be applied textually (a nested table, an array of tables), the file is
 * re-serialized — and the original is kept as config.toml.bak so no comment
 * is lost for good.
 */
async function writeConfigText(file: string, original: string | null, next: Record<string, unknown>): Promise<void> {
  if (original !== null) {
    const edited = editTomlText(original, normalizeTomlValues(parseToml(original)) as Record<string, unknown>, next, {
      reparse: (text) => normalizeTomlValues(parseToml(text)) as Record<string, unknown>,
      render: (key, value) => stringifyToml({ [key]: value }).trim(),
      leadingKey: 'schema_version',
    });
    if (edited !== null) {
      await atomicWriteFile(file, edited);
      return;
    }
    await atomicWriteFile(`${file}.bak`, original);
  }
  await atomicWriteFile(file, serialize(next));
}

function serialize(raw: Record<string, unknown>): string {
  // schema_version first, then the tables in their declared order.
  const ordered: Record<string, unknown> = { schema_version: CURRENT_CONFIG_VERSION };
  for (const [k, v] of Object.entries(raw)) if (k !== 'schema_version') ordered[k] = v;
  const text = stringifyToml(ordered);
  return text.endsWith('\n') ? text : text + '\n';
}

/**
 * The single config writer. Reads the current file (migrating it), lets the
 * caller mutate the raw object, re-validates, and writes atomically with
 * `schema_version = 1` — editing only the changed keys, so the user's comments
 * and formatting survive (writeConfigText). A malformed existing file is
 * refused (never silently replaced).
 */
export async function updatePaperConfig(
  root: string,
  mutate: (raw: Record<string, unknown>) => void,
): Promise<PaperConfig> {
  const file = paperConfigPath(root);
  const label = relName(root, file);
  return withLock(file, async () => {
    let raw: Record<string, unknown> = { schema_version: CURRENT_CONFIG_VERSION };
    let original: string | null = null;
    if (existsSync(file)) {
      original = await fsp.readFile(file, 'utf8');
      const parsed = parseAndValidate(original, label);
      emitWarnings(label, parsed.warnings);
      raw = parsed.raw;
    }
    mutate(raw);
    raw['schema_version'] = CURRENT_CONFIG_VERSION;
    const validated = parseAndValidate(serialize(raw), label);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await writeConfigText(file, original, raw);
    return validated.config;
  });
}

/** Get or create a [table] object on a raw config (for updatePaperConfig mutators). */
export function rawTable(raw: Record<string, unknown>, table: string): Record<string, unknown> {
  const cur = raw[table];
  if (isPlainObject(cur)) return cur;
  const fresh: Record<string, unknown> = {};
  raw[table] = fresh;
  return fresh;
}

/**
 * `PENSMITH_COST_CAP_USD`, validated like `[budget] cost_cap_usd` (a positive,
 * finite number of US dollars): null when unset or empty; a set-but-invalid
 * value ("0", "-1", "$1", "1 USD", "abc") is a one-line EXIT_USAGE ConfigError —
 * never a silent fall back to the $5 default for the one hard money guard.
 */
export function parseCostCapEnv(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const t = raw.trim();
  const n = /^\+?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    // A ConfigError, so an advisory step (Pass 2/4, the source evaluator)
    // never swallows it (anthropic.ts isFatalLlmError).
    throw new ConfigError(
      `PENSMITH_COST_CAP_USD must be a positive number of US dollars, e.g. PENSMITH_COST_CAP_USD=2.50 (got ${JSON.stringify(raw)}); ` +
        'unset it to use [budget] cost_cap_usd or the $5.00 default',
      EXIT_USAGE,
    );
  }
  return n;
}

// ---------------------------------------------------------------------------
// Effective values with their source (`pensmith status --config`)
// ---------------------------------------------------------------------------

export type ValueSource = 'default' | 'preset' | 'intake' | 'config' | 'env' | 'flag' | 'global';

export interface ConfigRow {
  key: string;
  value: unknown;
  source: ValueSource;
}

/** Defaults the code applies when a key is absent (keys without a default are shown only when set). */
const DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  'project.mode': 'draft',
  ...Object.fromEntries(Object.entries(PROJECT_CONFIG_FRAGMENT_DEFAULTS).map(([k, v]) => [`project.${k}`, v])),
  'project.citation_style': 'APA',
  'project.pii_redaction': false,
  'sources.require_doi': true,
  'verification.fetch_full_text': true,
  'verification.plagiarism_check': true,
  'humanizer.enabled': true,
  'humanizer.honesty_score': true,
  'humanizer.honesty_backend': 'gptzero',
  'style.match_past_writing': false,
  'budget.cost_cap_usd': 5,
  'network.contact_email_env': 'PENSMITH_CONTACT_EMAIL',
  'logging.session_bodies': 'full',
});

/** Keys `pensmith new` writes (the fragment's keys plus pii_redaction). */
const INTAKE_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(PROJECT_CONFIG_FRAGMENT).map((k) => `project.${k}`),
  'project.pii_redaction',
]);

const PRESET_STYLE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  apa: 'APA',
  mla: 'MLA',
  ieee: 'IEEE',
  ama: 'AMA',
  vancouver: 'Vancouver',
  harvard: 'Harvard',
  'chicago-author-date': 'Chicago (Author-Date)',
  'chicago-notes-bib': 'Chicago (Notes-Bibliography)',
});

function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(cur, 'package.json'))) return cur;
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return start;
}

function presetDefaults(preset: string | undefined): Record<string, unknown> {
  if (!preset) return {};
  try {
    const root = findPkgRoot(path.dirname(fileURLToPath(import.meta.url)));
    const all = JSON.parse(readFileSync(path.join(root, 'templates', 'presets', 'disciplines.json'), 'utf8')) as
      Record<string, { defaultCitationStyle?: string; counterargDefault?: string }>;
    const p = all[preset];
    if (!p) return {};
    const out: Record<string, unknown> = {};
    if (p.defaultCitationStyle) out['project.citation_style'] = PRESET_STYLE_NAMES[p.defaultCitationStyle] ?? p.defaultCitationStyle;
    if (p.counterargDefault) out['project.counterargument_required'] = p.counterargDefault === 'required';
    return out;
  } catch {
    return {};
  }
}

function flatten(prefix: string, v: unknown, out: Map<string, unknown>): void {
  if (isPlainObject(v)) {
    for (const [k, val] of Object.entries(v)) flatten(prefix ? `${prefix}.${k}` : k, val, out);
    return;
  }
  out.set(prefix, v);
}

/**
 * Every effective config.toml value with its source. `env` covers
 * PENSMITH_COST_CAP_USD; the [runtime] rows (flag / config / global / env /
 * default) come from runtime.ts and are merged in by the status view.
 */
export function effectiveConfigRows(
  root: string = projectRoot(),
  env: NodeJS.ProcessEnv = process.env,
): ConfigRow[] {
  const read = readPaperConfigSync(root);
  const set = new Map<string, unknown>();
  flatten('', read.config, set);
  const rows = new Map<string, ConfigRow>();
  for (const [key, value] of Object.entries(DEFAULTS)) rows.set(key, { key, value, source: 'default' });
  const presetKeys = presetDefaults(read.config.project?.discipline_preset);
  for (const [key, value] of Object.entries(presetKeys)) rows.set(key, { key, value, source: 'preset' });
  for (const [key, value] of set) {
    if (key.startsWith('runtime.')) continue; // runtime rows come from runtime resolution
    rows.set(key, { key, value, source: INTAKE_KEYS.has(key) ? 'intake' : 'config' });
  }
  const capNum = parseCostCapEnv(env['PENSMITH_COST_CAP_USD']);
  if (capNum !== null) {
    rows.set('budget.cost_cap_usd', { key: 'budget.cost_cap_usd', value: capNum, source: 'env' });
  }
  return [...rows.values()].sort((a, b) => (a.key === 'schema_version' ? -1 : b.key === 'schema_version' ? 1 : a.key.localeCompare(b.key)));
}
