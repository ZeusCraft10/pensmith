// bin/lib/paths.ts — cross-platform path-resolution chokepoint (D-40, D-41).
//
// Rule: this is the ONLY file in the repo allowed to call os.homedir() or
// read process.env.LOCALAPPDATA / APPDATA / XDG_DATA_HOME. The eslint
// chokepoint at eslint.config.js (D-41) enforces it. The forward-declared
// per-file exemption block in eslint.config.js permits these calls here.
//
// Platform layout (per D-40, D-43, RESEARCH §RQ-7):
//   Windows:  %LOCALAPPDATA%\pensmith\
//             (NOT %APPDATA% — APPDATA is roaming; locks roaming = corruption.
//              Pitfall 4 — see lint message on the APPDATA selector.)
//   macOS:    ~/Library/Application Support/pensmith/
//   Linux/POSIX: $XDG_DATA_HOME/pensmith/  (fallback ~/.local/share/pensmith/)
//
// Why outside the project tree (D-40):
//   Users develop in OneDrive/iCloud/Dropbox/Google Drive. Sync clients
//   eat lock files and SQLite DBs (file pinning, partial writes, conflict
//   copies). State must live in a platform-local data dir that the sync
//   clients don't touch. isInsideSyncFolder() is the Phase 2 doctor's
//   detector for warning a user that their `.paper/` is itself inside
//   one of these sync roots.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PensmithError, EXIT_ERROR, EXIT_USAGE } from './exit-codes.js';
import { stdinMayCarryAssignment } from './stdin-source.js';

// ---------------------------------------------------------------------------
// Bare-slug validation (Phase 3 Plan 03-03 Task 3.3 / T-3-12 mitigation).
//
// Two distinct conventions live in this codebase (slug-vs-directory-basename
// lock per CYCLE-3 Codex MEDIUM #11):
//   - "slug" (bare, e.g. 'attention-mechanism'): used in PlanFrontmatter.slug,
//     PlanFrontmatter.depends_on[], HANDOFF.current_section, --section CLI
//     args, logger messages naming a section.
//   - "directory basename" (NN-slug, e.g. '02-attention-mechanism'): computed
//     by sectionDir(n, slug) and never round-tripped — callers always have
//     the (n, slug) pair from PlanFrontmatter or HANDOFF.
//
// validateSlug is the single source of truth for "is this a bare slug?".
// /^[a-z0-9-]+$/ matches PlanFrontmatterSchema.slug (zod) and the runtime
// regex used by HandoffSchema.section_pointers[].slug.
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Throw if `slug` is not a bare lowercase kebab-case slug. This is the path-
 * traversal mitigation for any helper that joins a slug into a filesystem
 * path (T-3-12). Used by sectionPlan / sectionDraft / sectionVerification /
 * sectionResearch — NOT by the legacy sectionDir (which slugifies its input
 * for the free-form-section-name convenience case; test 120 in paths.test.ts
 * is the regression gate).
 */
export function validateSlug(slug: string): void {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid slug ${JSON.stringify(slug)}: must match /^[a-z0-9-]+$/ ` +
        `(T-3-12 path traversal mitigation)`,
    );
  }
}

function pad2(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`section number must be integer in [0,99]; got ${n}`);
  }
  return String(n).padStart(2, '0');
}

/**
 * Returns the platform-appropriate user-local data directory (the parent
 * of the per-app `pensmith/` subdirectory).
 *
 * Injection points (`platform`, `env`) exist for testability — production
 * callers should use the no-arg form which reads `process.platform` and
 * `process.env`.
 *
 * Throws on win32 if LOCALAPPDATA is unset (per D-40 / Pitfall 4 — we never
 * silently fall back to APPDATA, since APPDATA is the roaming profile and
 * pensmith state must NOT roam).
 */
export function localDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // ---- The platform data dir (what a real user gets) ----------------------
  // win32: LOCALAPPDATA (never APPDATA — Pitfall 4). darwin: ~/Library/
  // Application Support. POSIX-like (linux, freebsd, openbsd, aix, sunos, …):
  // XDG_DATA_HOME if set, else ~/.local/share per the XDG Base Directory Spec.
  let platformDir: string | undefined;
  if (platform === 'win32') {
    platformDir = env.LOCALAPPDATA || undefined;
  } else if (platform === 'darwin') {
    platformDir = path.join(env.HOME ?? os.homedir(), 'Library', 'Application Support');
  } else {
    platformDir = env.XDG_DATA_HOME || path.join(env.HOME ?? os.homedir(), '.local', 'share');
  }

  // ---- CI-09 / D-17-40: tests never reach the real data dir ---------------
  // Under a test context (node:test sets NODE_TEST_CONTEXT in every test-file
  // process; scripts/run-tests.mjs sets PENSMITH_TEST=1) the platform dir is
  // honoured ONLY when it resolves inside os.tmpdir() — i.e. a test (or the
  // runner) redirected it to a temp dir. Anything else, including the real
  // data dir derived from HOME on macOS, is replaced by PENSMITH_TEST_DATA_DIR
  // (the runner's per-run dir), and failing that by a per-process temp dir
  // (a single test file run directly with `node --test`). The test context is
  // read from `env` itself, so callers that inject an env (tests/paths.test.ts)
  // see the plain platform logic.
  const testContext = Boolean(env.NODE_TEST_CONTEXT) || env.PENSMITH_TEST === '1';
  if (testContext) {
    const tmpRoots = (() => {
      const roots = new Set<string>();
      const t = path.resolve(os.tmpdir());
      roots.add(t);
      for (const real of [fs.realpathSync, fs.realpathSync.native]) {
        try {
          roots.add(real(t));
        } catch {
          /* tmpdir missing — keep the resolved form */
        }
      }
      return [...roots];
    })();
    const fold = (p: string): string => (platform === 'win32' ? p.toLowerCase() : p);
    const insideTmp = (candidate: string): boolean => {
      // Resolve the nearest existing ancestor too (macOS /var → /private/var,
      // Windows 8.3 short names such as RUNNER~1), so a temp dir given in
      // either spelling is recognised.
      const forms = new Set<string>([path.resolve(candidate), realpathNearest(candidate)]);
      return [...forms].some((f) =>
        tmpRoots.some((root) => {
          const rel = path.relative(fold(root), fold(f));
          return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
        }),
      );
    };
    if (platformDir && insideTmp(platformDir)) return platformDir;
    const runDir = env.PENSMITH_TEST_DATA_DIR;
    if (runDir) return runDir;
    const g = globalThis as { __pensmithTestDataDir?: string };
    if (!g.__pensmithTestDataDir) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-test-data-'));
      g.__pensmithTestDataDir = dir;
      // Spawned CLI children inherit the same private dir; the creating
      // process removes it when it exits.
      if (env === process.env) process.env.PENSMITH_TEST_DATA_DIR = dir;
      process.once('exit', () => {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best-effort temp cleanup */
        }
      });
    }
    return g.__pensmithTestDataDir;
  }

  if (!platformDir) {
    throw new Error(
      'LOCALAPPDATA is unset on Windows; set it explicitly or run from a logged-in user account',
    );
  }
  return platformDir;
}

/**
 * Returns the pensmith app data directory: `<localDataDir>/pensmith`.
 * This is the root for `locks/`, `http-cache/`, `library.json`,
 * checkpoints, session logs, etc.
 */
export function pensmithDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(localDataDir(platform, env), 'pensmith');
}

/**
 * Returns `<pensmithDataDir>/locks` — concurrent-run lock root (Plan 03,
 * proper-lockfile). Always uses the live process env/platform.
 */
export function pensmithLockDir(): string {
  return path.join(pensmithDataDir(), 'locks');
}

/**
 * Returns `<pensmithDataDir>/http-cache` — HTTP response cache root
 * (Plan 05, undici cache for OpenAlex/Crossref).
 */
export function pensmithHttpCacheDir(): string {
  return path.join(pensmithDataDir(), 'http-cache');
}

/**
 * Returns `<pensmithDataDir>/source-text` — Pass 3's extracted-text cache
 * (Phase 20, VRFY-19): the text of the open-access copies of cited works
 * (an open-access PDF, a Europe PMC full text, an arXiv PDF), one JSON file
 * per URL. Public text only — never a bring-your-own PDF's (byo-text/).
 */
export function pensmithSourceTextCacheDir(): string {
  return path.join(pensmithDataDir(), 'source-text');
}

/**
 * Returns `<pensmithDataDir>/library/index.json` — the GLOBAL PAPER registry
 * (LIB-01). One entry per paper across all projects. This is SEPARATE from the
 * per-paper `.paper/LIBRARY.json` (D-59 source/citation store) AND from the
 * path-free `style-fingerprints.json` registry. LIB-01: it lives in
 * pensmithDataDir(), NEVER inside a sync-folder-risk `.paper/`.
 */
export function pensmithGlobalLibraryIndexPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(pensmithDataDir(platform, env), 'library', 'index.json');
}

/**
 * Returns `<pensmithDataDir>/active.json` — the active-paper pointer (LIB-03).
 * Written by `open` to switch the active paper; read by callers that need the
 * active paperRoot from a different cwd. Lives in pensmithDataDir(), never
 * inside a `.paper/`.
 */
export function pensmithActivePointerPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(pensmithDataDir(platform, env), 'active.json');
}

/**
 * Returns `<pensmithDataDir>/style-fingerprints.json` — the cross-paper style
 * reuse-detection registry (STYL-02, wired in 08-02). It stores fingerprint →
 * paper-identity ONLY and is DELIBERATELY path-free (no folderPath / prose
 * features) — distinct from the PAPER registry above, which retains folderPath.
 */
export function pensmithStyleFingerprintsPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(pensmithDataDir(platform, env), 'style-fingerprints.json');
}

/**
 * The user's home folder (os.homedir()): the ONE place outside the data-dir
 * resolution that asks for it (D-41). Used for the user-level Claude Code
 * files the doctor and capability probes look at (~/.claude/…).
 */
export function userHomeDir(): string {
  return os.homedir();
}

/** True when `p` (as given, or its nearest real path) lies inside os.tmpdir() — the CI-09 test-context rule. */
function insideTmpdir(p: string): boolean {
  const fold = (x: string): string => (process.platform === 'win32' ? x.toLowerCase() : x);
  const roots = new Set<string>([path.resolve(os.tmpdir())]);
  try {
    roots.add(fs.realpathSync.native(os.tmpdir()));
  } catch {
    /* tmpdir missing — keep the resolved form */
  }
  const forms = new Set<string>([path.resolve(p), realpathNearest(p)]);
  return [...forms].some((f) =>
    [...roots].some((root) => {
      const rel = path.relative(fold(root), fold(f));
      return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
    }),
  );
}

/**
 * Claude Code's config folder for skills and plugins: `$CLAUDE_CONFIG_DIR`
 * when set, else `<home>/.claude`. Null under a test context when it lies
 * outside os.tmpdir() (CI-09: no test reads the developer's real one).
 */
function claudeSkillsRoot(env: NodeJS.ProcessEnv): string | null {
  const configured = env['CLAUDE_CONFIG_DIR']?.trim();
  const root = configured ? path.resolve(configured) : path.join(userHomeDir(), '.claude');
  const testContext = Boolean(env.NODE_TEST_CONTEXT) || env.PENSMITH_TEST === '1';
  if (testContext && !insideTmpdir(configured ? root : userHomeDir())) return null;
  return root;
}

/** The install folders `<root>/plugins/installed_plugins.json` lists (any version of its layout), in file order. Never throws. */
function installedPluginDirs(root: string, testContext: boolean): string[] {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(path.join(root, 'plugins', 'installed_plugins.json'), 'utf8'));
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || typeof v !== 'object' || v === null) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const rec = v as Record<string, unknown>;
    const at = rec['installPath'];
    if (typeof at === 'string' && path.isAbsolute(at) && (!testContext || insideTmpdir(at))) out.push(at);
    for (const x of Object.values(rec)) walk(x, depth + 1);
  };
  walk(data, 0);
  return [...new Set(out)];
}

/**
 * Every place the humanizer skill may be installed, in the order Claude Code
 * users install it (EXP-14; review round 3 — a skill Claude Code synced to the
 * account, or one a plugin ships, was never found): the user's own skill
 * (`<config>/skills/humanizer/SKILL.md`, `<config>` = `$CLAUDE_CONFIG_DIR`
 * else `~/.claude`), then the account-synced skills
 * (`<config>/skills/synced/<bucket>/humanizer/SKILL.md`), then each installed
 * plugin's (`<installPath>/skills/humanizer/SKILL.md`, from
 * `<config>/plugins/installed_plugins.json`). Empty under a test context whose
 * config folder lies outside os.tmpdir(). Never throws.
 */
export function humanizerSkillCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = claudeSkillsRoot(env);
  if (root === null) return [];
  const testContext = Boolean(env.NODE_TEST_CONTEXT) || env.PENSMITH_TEST === '1';
  const out = [path.join(root, 'skills', 'humanizer', 'SKILL.md')];
  try {
    const synced = path.join(root, 'skills', 'synced');
    for (const bucket of fs.readdirSync(synced).sort()) out.push(path.join(synced, bucket, 'humanizer', 'SKILL.md'));
  } catch {
    /* no synced skills */
  }
  for (const dir of installedPluginDirs(root, testContext)) out.push(path.join(dir, 'skills', 'humanizer', 'SKILL.md'));
  return out;
}

/**
 * The user's installed humanizer skill (EXP-14, D-21-18; the Tier-2 humanizer
 * reads its body as the system prompt): the first of humanizerSkillCandidates
 * that is a file — the one resolver done, the estimator, `status --config`,
 * doctor and the capabilities resource share. When none is, the first
 * candidate (`<config>/skills/humanizer/SKILL.md`, where to install it); null
 * under a test context whose home or `$CLAUDE_CONFIG_DIR` lies outside
 * os.tmpdir() (CI-09: a test points HOME — USERPROFILE on Windows — or
 * CLAUDE_CONFIG_DIR at a temp dir to install a fixture skill, and no test can
 * ever read the developer's real one). Never throws.
 */
export function humanizerSkillPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = humanizerSkillCandidates(env);
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* not here */
    }
  }
  return candidates[0] ?? null;
}

/** Where humanizerSkillPath looks, for the "not found" line: `~/.claude/skills/humanizer/SKILL.md, the synced skills or an installed plugin's skills`. */
export function humanizerSkillSearchDescription(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['CLAUDE_CONFIG_DIR']?.trim();
  const root = configured ? '$CLAUDE_CONFIG_DIR' : '~/.claude';
  return `${root}/skills/humanizer/SKILL.md, ${root}/skills/synced/*/humanizer/SKILL.md or an installed plugin's skills/humanizer/SKILL.md`;
}

/**
 * Returns `<pensmithDataDir>/own-source-approvals.json` — which of the user's
 * own sources (a bring-your-own folder outside the paper, a Zotero collection)
 * each paper may read (SRC-15, SRC-16; bin/lib/own-source-approvals.ts). It
 * lives in the data dir, never in `.paper/`: a paper's config.toml travels
 * with a shared or synced paper and so cannot approve anything itself.
 */
export function pensmithOwnSourceApprovalsPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(pensmithDataDir(platform, env), 'own-source-approvals.json');
}

/**
 * `<data dir>/style-approvals.json` — the citation-style files (`.csl`) a
 * paper's config.toml names that the user approved for that paper, by real
 * path and sha256 (style-approvals.ts, EXP-03; never in `.paper/`, which
 * travels with a shared paper).
 */
export function pensmithStyleApprovalsPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(pensmithDataDir(platform, env), 'style-approvals.json');
}

/**
 * `<data dir>/detector-consent.json` — the user's answers to "send the paper
 * to the AI detector?", per paper and per detector (detector-consent.ts,
 * EXP-17; never in `.paper/`, which travels with a shared paper).
 */
export function pensmithDetectorConsentPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(pensmithDataDir(platform, env), 'detector-consent.json');
}

// ---------------------------------------------------------------------------
// The plugin asset root (PLUG-02, D-23a-03).
//
// `plugin/` is the one home of every shipped asset — workflow bodies,
// templates (prompts, citation styles, presets, stubs, the dry-run corpus),
// references, skills and agents — for both tiers. This is the ONE resolver:
// the `plugin-assets` chokepoint row lets only this file name the asset
// directories, and everything else calls the helpers below.
//
// Resolution is lazy and cached, and walks up from THIS module's own location
// (never an environment variable such as CLAUDE_PLUGIN_ROOT — an env var could
// point anywhere; the module's location is authoritative):
//   - a folder holding `.claude-plugin/plugin.json` IS the plugin root — the
//     bundle in `plugin/dist/…`, or a Claude Code plugin-cache copy (which holds
//     only the plugin directory);
//   - otherwise a folder holding `plugin/.claude-plugin/plugin.json` yields
//     `<folder>/plugin` — the source tree under tsx, the tsc build in `dist/`,
//     and an `npm pack` / `npm install -g` install (package.json `files` ships
//     `plugin/`).
// Neither found: one PensmithError line naming where it looked.
// ---------------------------------------------------------------------------

/** The plugin directory's name inside a source checkout or an npm install. */
export const PLUGIN_DIR_NAME = 'plugin';
/** The plugin manifest, relative to the plugin root. */
const PLUGIN_MANIFEST_REL = path.join('.claude-plugin', 'plugin.json');

/**
 * How the plugin root was found: `plugin` — this module runs inside the plugin
 * itself (a bundle, a plugin-cache copy); `package` — it runs from a package
 * that holds the plugin as `plugin/` (source, `dist/`, an npm install).
 */
export type PluginLayout = 'plugin' | 'package';

export interface PluginRootHit {
  /** The plugin root: the folder that holds `.claude-plugin/plugin.json`. */
  readonly root: string;
  readonly layout: PluginLayout;
  /** The package folder that holds `plugin/` (layout `package`); null inside the plugin itself. */
  readonly packageRoot: string | null;
}

function isRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Find the plugin root from `start` upward (the pure walk behind pluginRoot();
 * tests drive it over synthetic layouts). The nearest folder wins, and at each
 * folder the plugin itself is checked before a nested `plugin/`.
 *
 * @throws PensmithError (EXIT_ERROR) when no folder from `start` up to the
 *   filesystem root holds either manifest.
 */
export function findPluginRoot(start: string): PluginRootHit {
  const from = path.resolve(start);
  let cur = from;
  for (;;) {
    if (isRegularFile(path.join(cur, PLUGIN_MANIFEST_REL))) {
      return { root: cur, layout: 'plugin', packageRoot: null };
    }
    const nested = path.join(cur, PLUGIN_DIR_NAME);
    if (isRegularFile(path.join(nested, PLUGIN_MANIFEST_REL))) {
      return { root: nested, layout: 'package', packageRoot: cur };
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  throw new PensmithError(
    `plugin assets not found: neither ${PLUGIN_MANIFEST_REL} nor ${path.join(PLUGIN_DIR_NAME, PLUGIN_MANIFEST_REL)} ` +
      `exists in ${from} or any folder above it; reinstall pensmith (or restore plugin/ in a source checkout)`,
    EXIT_ERROR,
  );
}

let pluginRootHitCache: PluginRootHit | null = null;

function pluginRootHit(): PluginRootHit {
  pluginRootHitCache ??= findPluginRoot(path.dirname(fileURLToPath(import.meta.url)));
  return pluginRootHitCache;
}

/** The plugin root (absolute): the folder holding `.claude-plugin/plugin.json`. */
export function pluginRoot(): string {
  return pluginRootHit().root;
}

/** How the plugin root was found (see PluginLayout). */
export function pluginLayout(): PluginLayout {
  return pluginRootHit().layout;
}

/**
 * The package folder holding `plugin/` — a source checkout or an npm install,
 * where the Tier-2 CLI build lives (`dist/bin/pensmith.js`). Null when this
 * module runs inside the plugin itself (a bundle or a plugin-cache copy),
 * which ships no CLI.
 */
export function cliPackageRoot(): string | null {
  return pluginRootHit().packageRoot;
}

/** `segments` joined under the plugin root. */
export function pluginPath(...segments: string[]): string {
  return path.join(pluginRoot(), ...segments);
}

/** A file under the plugin's `templates/` (prompts, citation styles, presets, stubs, the dry-run corpus). */
export function pluginTemplatePath(...segments: string[]): string {
  return pluginPath('templates', ...segments);
}

/** A file under the plugin's `references/` (locked copy the code renders verbatim). */
export function pluginReferencePath(file: string): string {
  return pluginPath('references', file);
}

/** The workflow body of `verb`: `workflows/<verb>.md` under the plugin root. */
export function pluginWorkflowPath(verb: string): string {
  return pluginPath('workflows', `${verb}.md`);
}

/** The Tier-1 MCP server bundle the plugin manifest launches (D-23a-04/05). */
export function pluginMcpServerBundle(): string {
  return pluginPath('dist', 'mcp', 'server.mjs');
}

/** The MCP server bundle's path as a user reads it in a source checkout or an install. */
export const PLUGIN_MCP_SERVER_LABEL = 'plugin/dist/mcp/server.mjs';

// ---------------------------------------------------------------------------
// The active paper root (RUN-13 / RUN-14, D-17-32 / D-17-33).
//
// "Paper root" means the PROJECT folder that contains `.paper/`, everywhere:
// the CLI, the MCP server and the hooks resolve it once (resolvePaperRoot) and
// record it here; every later `projectRoot()` call returns it. Code must never
// use the process working directory as a paper root directly — that is the
// `process-cwd-paper-root` chokepoint (scripts/chokepoints/).
// ---------------------------------------------------------------------------

let activeRoot: string | null = null;

/** Record the resolved paper root for this process (null clears it). */
export function setActivePaperRoot(root: string | null): void {
  activeRoot = root === null ? null : path.resolve(root);
}

/** The root recorded by setActivePaperRoot, or null when none was resolved. */
export function activePaperRoot(): string | null {
  return activeRoot;
}

/**
 * The folder the user ran pensmith in (absolute), read as a project folder: a
 * run from inside a paper's `.paper/` (or deeper) is a run in that paper's
 * project folder (asProjectRoot), so every reader and writer agrees on one
 * root and nothing is created under `.paper/.paper/` (RUN-13). Only the
 * resolver's callers need it — to offer "start a new paper here".
 */
export function workingDirectory(): string {
  return asProjectRoot(process.cwd());
}

/**
 * The folder the user typed the command in, as is (absolute; never folded
 * to a project root, never a paper root): the base of a relative path the
 * user typed on the command line (`done --style ./my.csl`; review round 1).
 */
export function invocationDirectory(): string {
  return path.resolve(process.cwd());
}

/**
 * Resolves the project root to an absolute, normalized path. With an explicit
 * argument it resolves that path; with none it returns the active paper root
 * (setActivePaperRoot), falling back to the process working directory when no
 * root was resolved (library callers and unit tests). Used as the input to
 * `projectHash` and as the base of `paperDir` / `sectionDir`.
 */
export function projectRoot(cwd?: string): string {
  if (cwd !== undefined) return path.resolve(cwd);
  return activeRoot ?? workingDirectory();
}

/**
 * Returns a 12-char lowercase hex slice of `sha256(absolute project root)`.
 * Used to disambiguate sibling pensmith projects in `pensmithDataDir`
 * (e.g. lock file names, library shards). Per D-09 / threat model
 * T-01-INFO-01, the slice is one-way and not used as a secret.
 */
export function projectHash(root: string = projectRoot()): string {
  return createHash('sha256').update(root).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// The dry-run workspace (GRND-19, D-18-29).
//
// A `--dry-run` never reads or writes the real `.paper/` after seeding: every
// paper file of a dry run lives in `<root>/.paper-dry-run/`, seeded from
// `.paper/` (bin/lib/dry-run-paper.ts). paperDir() is the one switch — every
// loader and writer goes through it, so they all follow the workspace. The
// mode is on when the CLI pre-parse saw `--dry-run` (setDryRunWorkspace) or
// when PENSMITH_DRY_RUN=1 — the channel the pre-parse sets for child processes
// and the same variable bin/lib/http-mock.ts networkMode() reads (D-17-04).
// ---------------------------------------------------------------------------

/** The folder a paper lives in, under its project root. */
export const PAPER_DIR_NAME = '.paper';
/** The dry-run workspace folder, beside `.paper/` (GRND-19). */
export const DRY_RUN_PAPER_DIR_NAME = '.paper-dry-run';

let dryRunWorkspaceOverride: boolean | null = null;

/**
 * Turn the dry-run workspace on or off for this process (the CLI pre-parse of
 * `--dry-run`); null returns to the PENSMITH_DRY_RUN=1 default.
 */
export function setDryRunWorkspace(on: boolean | null): void {
  dryRunWorkspaceOverride = on;
}

/** True when this process works in the dry-run workspace (see above). */
export function dryRunWorkspaceActive(): boolean {
  return dryRunWorkspaceOverride ?? process.env['PENSMITH_DRY_RUN'] === '1';
}

/** True for a folder name pensmith keeps a paper in (`.paper`, `.paper-dry-run`). */
export function isPaperDirName(name: string): boolean {
  return name === PAPER_DIR_NAME || name === DRY_RUN_PAPER_DIR_NAME;
}

/**
 * Returns the per-project pensmith working directory inside the user's repo:
 * `<root>/.paper`, or `<root>/.paper-dry-run` while the dry-run workspace is
 * active (GRND-19). NOTE: `.paper/` is the OnlyDocuments-style root users see;
 * pensmith app state (locks, caches) lives OUTSIDE this in `pensmithDataDir`
 * precisely because `.paper/` may be inside a sync folder.
 */
export function paperDir(root: string = projectRoot()): string {
  return path.join(root, dryRunWorkspaceActive() ? DRY_RUN_PAPER_DIR_NAME : PAPER_DIR_NAME);
}

/**
 * `<root>/.paper` whatever the mode — only the dry-run seeding (dry-run-paper.ts)
 * reads the real paper through it; nothing ever writes through it in a dry run.
 */
export function realPaperDir(root: string = projectRoot()): string {
  return path.join(root, PAPER_DIR_NAME);
}

/** `<root>/.paper-dry-run` whatever the mode (the dry-run workspace, GRND-19). */
export function dryRunPaperDir(root: string = projectRoot()): string {
  return path.join(root, DRY_RUN_PAPER_DIR_NAME);
}

/** `<root>/.paper/STATE.json` — the one STATE.json location (RUN-13, D-17-32). */
export function paperStateFile(root: string = projectRoot()): string {
  return path.join(paperDir(path.resolve(root)), 'STATE.json');
}

/**
 * Pre-v1 layout: STATE.json and config.toml at the project root. Only the
 * legacy-layout move (state.ts migrateLegacyLayout) and read-only probes of
 * papers written by an older pensmith use these.
 */
export function legacyStateFile(root: string): string {
  return path.join(path.resolve(root), 'STATE.json');
}

/** Pre-v1 root-level config.toml (see legacyStateFile). */
export function legacyConfigFile(root: string): string {
  return path.join(path.resolve(root), 'config.toml');
}

/** `<root>/.paper/config.toml` — the destination of the legacy-layout move. */
export function paperConfigFile(root: string = projectRoot()): string {
  return path.join(paperDir(path.resolve(root)), 'config.toml');
}

/** A pensmith STATE.json is tiny; anything larger is not one (never read it whole). */
const LEGACY_STATE_MAX_BYTES = 1_048_576;

/**
 * True when `root/STATE.json` is a pre-v1 PENSMITH state file — not merely a
 * file that happens to be called STATE.json (a web app's, a static site's).
 * It must be a JSON object carrying pensmith's envelope: an integer
 * `$schemaVersion` >= 1, a non-empty string `paperId` and an ISO `createdAt`.
 * Only then does the legacy-layout move touch it (or its config.toml), and only
 * then does the folder count as holding a paper. A `.paper` (or
 * `.paper-dry-run`) folder is never a project root, so it never has a legacy
 * state file. A dry run never moves or reads a pre-v1 layout (GRND-19: the
 * user's files are never written by a dry run) — its workspace starts empty.
 */
export function isLegacyPensmithState(root: string): boolean {
  const r = path.resolve(root);
  if (isPaperDirName(path.basename(r))) return false;
  if (dryRunWorkspaceActive()) return false;
  const file = legacyStateFile(r);
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > LEGACY_STATE_MAX_BYTES) return false;
    const v: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    const o = v as Record<string, unknown>;
    const sv = o['$schemaVersion'];
    return typeof sv === 'number' && Number.isInteger(sv) && sv >= 1
      && typeof o['paperId'] === 'string' && o['paperId'].length > 0
      && typeof o['createdAt'] === 'string' && !Number.isNaN(Date.parse(o['createdAt']));
  } catch {
    return false; // absent, unreadable or not JSON: not a pensmith state file
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * True when `root` holds a paper: a `.paper/` directory, or a legacy root-level
 * pensmith STATE.json (isLegacyPensmithState) that the legacy-layout move will
 * relocate into `.paper/`. Any other root-level STATE.json is the user's own.
 * Under a dry run (GRND-19) the folder holds a paper when it has a dry-run
 * workspace or a real `.paper/` to seed one from; a normal run never counts a
 * `.paper-dry-run/` as a paper.
 */
export function hasPaper(root: string): boolean {
  const r = path.resolve(root);
  // A `.paper` (or `.paper-dry-run`) folder is never itself a project root (its parent is).
  if (isPaperDirName(path.basename(r))) return false;
  if (isDirectory(paperDir(r))) return true;
  if (dryRunWorkspaceActive() && isDirectory(realPaperDir(r))) return true;
  return isLegacyPensmithState(r);
}

/**
 * True when `root` holds a paper in the current layout: a `.paper/` directory
 * and no pre-v1 root-level pensmith STATE.json still waiting for the
 * legacy-layout move. The Claude Code hooks address only such a paper
 * (bin/lib/hooks/entry.ts): the move renames the user's files, so it belongs
 * to the next CLI or MCP run, under the paper's session lock — never to a hook
 * that fires at session start or after a tool call. Under a dry run it is
 * false (hooks never run one).
 */
export function hasCurrentLayoutPaper(root: string): boolean {
  const r = path.resolve(root);
  if (isPaperDirName(path.basename(r)) || dryRunWorkspaceActive()) return false;
  return isDirectory(paperDir(r)) && !isLegacyPensmithState(r);
}

/** The assignment file names bare `pensmith` and `new` pick up (PRD §5.1 row 1). */
export const ASSIGNMENT_FILE_NAMES: readonly string[] = Object.freeze([
  'assignment.txt',
  'assignment.md',
  'assignment.pdf',
]);

/** The first `assignment.{txt,md,pdf}` file in `root`, or null. */
export function findAssignmentFile(root: string): string | null {
  for (const name of ASSIGNMENT_FILE_NAMES) {
    const p = path.join(path.resolve(root), name);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // absent — try the next name
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Active-paper resolver (RUN-14, S-21, D-17-33).
//
// Order: (1) `--paper <name|path>` or PENSMITH_PAPER_ROOT; (2) the cwd when it
// holds a paper; (3) a new paper in the cwd for `new`/`sketch`, or for a bare
// run with an assignment file; (3b) with NO pointer set, a new paper in the
// cwd for a bare run whose stdin is a pipe or a file (GRND-01 — a pipe never
// outranks the pointer); (4) the `pensmith open` pointer — served to
// read-only invocations with a banner, and only offered (never followed
// silently) to mutating ones; (5) the cwd — for read-only invocations and for
// bare/next/resume (which route to `new`) only: any other verb in a paper-less
// folder is EXIT_USAGE, so it never builds a partial paper there. The MCP
// server and the hooks never follow the pointer and never read `--paper`:
// PENSMITH_PAPER_ROOT or the cwd.
// ---------------------------------------------------------------------------

export type PaperRootMode = 'cli' | 'mcp' | 'hook';

export interface PaperPointer {
  /** Display name from the global registry (falls back to the folder name). */
  readonly name: string;
  /** The pointed-at project root. */
  readonly root: string;
}

export type PaperRootResolution =
  | {
      readonly kind: 'root';
      readonly root: string;
      readonly source: 'flag' | 'env' | 'cwd' | 'new' | 'fallback';
    }
  /** A read-only invocation served by the pointer (print the banner). */
  | { readonly kind: 'pointer'; readonly root: string; readonly pointer: PaperPointer }
  /** A mutating invocation in a paper-less cwd while a pointer is set: ask. */
  | { readonly kind: 'ask-pointer'; readonly cwd: string; readonly pointer: PaperPointer };

export interface ResolvePaperRootOptions {
  /** The first verb of the invocation, or null for a bare run. */
  readonly verb: string | null;
  /** The `--paper` value, when given. */
  readonly paperFlag?: string | undefined;
  readonly mode: PaperRootMode;
  /** status, list, doctor, open and `--estimate` may be served by the pointer. */
  readonly readOnly?: boolean;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Whether stdin may carry a piped assignment (GRND-01, D-18-08). Defaults to
   * the fstat test of stdin-source.ts (no read); tests pass it explicitly.
   */
  readonly stdinAssignment?: boolean;
}

/** Verbs that start a paper in the cwd and never follow the pointer. */
const NEW_PAPER_VERBS: ReadonlySet<string> = new Set(['new', 'sketch']);

/**
 * Verbs that may run in a paper-less cwd with no pointer (step 5): bare
 * `pensmith`, `next` and `resume` route to `new` there (the single-command UX),
 * and read-only invocations report "no active paper". Every other verb would
 * build a partial `.paper/` and spend money on a paper that does not exist, so
 * it is refused with EXIT_USAGE before anything is created (S-21).
 */
const PAPERLESS_CWD_VERBS: ReadonlySet<string> = new Set(['next', 'resume']);

/**
 * True when a MUTATING run of `verb` needs a paper to already exist (every verb
 * but bare/next/resume and the new-paper verbs). Read-only runs never do.
 */
export function mutatingVerbNeedsPaper(verb: string | null): boolean {
  return verb !== null && !PAPERLESS_CWD_VERBS.has(verb) && !NEW_PAPER_VERBS.has(verb);
}

/** The one-line refusal for a mutating verb in a folder with no paper. */
export function noPaperHereMessage(cwd: string): string {
  return `no paper in ${cwd} — run pensmith new to start one here, or pass --paper <name|path> ` +
    '(pensmith list shows your papers)';
}

/**
 * The CLI's refusal of a verb that needs a paper, for the MCP section tools
 * (pensmith_plan / pensmith_write / pensmith_verify, review round 2): the MCP
 * server resolves its root once (PENSMITH_PAPER_ROOT or the cwd, never the
 * pointer), so a folder with no paper would otherwise get a placeholder
 * section, a model bill and a stray `.paper/`. Throws the same EXIT_USAGE line
 * `pensmith plan|write|verify <N>` exits with there; nothing is created.
 */
export function assertPaperHere(root: string): void {
  if (!hasPaper(root)) throw new PensmithError(noPaperHereMessage(root), EXIT_USAGE);
}

/** `(active paper "<name>" at <path>)` — the read-only pointer banner. */
export function activePaperBanner(pointer: PaperPointer): string {
  return `(active paper "${pointer.name}" at ${pointer.root})`;
}

interface RegistryEntryLite {
  id?: unknown;
  name?: unknown;
  folderPath?: unknown;
}

/** Tolerant, read-only read of the global paper registry's entries. */
function readRegistryEntries(): RegistryEntryLite[] {
  try {
    const raw = JSON.parse(fs.readFileSync(pensmithGlobalLibraryIndexPath(), 'utf8')) as {
      entries?: unknown;
    };
    return Array.isArray(raw.entries) ? (raw.entries as RegistryEntryLite[]) : [];
  } catch {
    return [];
  }
}

/**
 * Read the `pensmith open` pointer. A pointer whose folder is gone (or holds no
 * paper any more) is cleared with a one-line warning and reads as null.
 */
export function readActivePaperPointer(): PaperPointer | null {
  const file = pensmithActivePointerPath();
  let parsed: { paperId?: unknown; folderPath?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof parsed;
  } catch {
    return null; // no pointer (or an unreadable one — treated as unset)
  }
  const folder = typeof parsed.folderPath === 'string' ? path.resolve(parsed.folderPath) : null;
  const entry = readRegistryEntries().find(
    (e) => (typeof parsed.paperId === 'string' && e.id === parsed.paperId)
      || (folder !== null && typeof e.folderPath === 'string' && path.resolve(e.folderPath) === folder),
  );
  const name = typeof entry?.name === 'string' && entry.name
    ? entry.name
    : folder !== null ? path.basename(folder) : 'unknown';
  if (folder === null || !hasPaper(folder)) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // best-effort: a pointer we cannot remove is still ignored below
    }
    process.stderr.write(
      `pensmith: cleared the active-paper pointer — "${name}"${folder ? ` at ${folder}` : ''} no longer holds a paper.\n`,
    );
    return null;
  }
  return { name, root: folder };
}

/**
 * Resolve `--paper <name|path>`: a paper name from `pensmith list`, or a folder
 * that contains `.paper/` (the `.paper` folder itself is accepted too). An
 * unknown value is a usage error (EXIT_USAGE).
 */
export function resolvePaperFlag(value: string, cwd: string = process.cwd()): string {
  const byName = readRegistryEntries().find((e) => e.name === value);
  if (byName && typeof byName.folderPath === 'string') {
    const root = path.resolve(byName.folderPath);
    if (hasPaper(root)) return root;
    throw new PensmithError(
      `--paper ${value}: the paper's folder ${root} no longer holds a paper (run pensmith list)`,
      EXIT_USAGE,
    );
  }
  const asPath = asProjectRoot(path.resolve(cwd, value));
  if (hasPaper(asPath)) return asPath;
  throw new PensmithError(
    `--paper ${value}: no paper by that name (run pensmith list) and no .paper/ folder at ${asPath}`,
    EXIT_USAGE,
  );
}

/**
 * The canonical spelling of `p` whether or not it exists yet: its realpath
 * (symlinks resolved — macOS /var → /private/var; Windows 8.3 short names such
 * as RUNNER~1 expanded), or, for a path not created yet, the realpath of its
 * nearest existing ancestor with the missing tail re-appended. A path therefore
 * canonicalizes the SAME before and after it is created — a lock keyed on
 * LIBRARY.json or STATE.json keeps one identity when the file first appears
 * (BRDTH-01: the old "ENOENT → the resolved path" fallback gave a Windows temp
 * paper two lock keys, RUNNER~1 before and runneradmin after, and two
 * processes upserted at once). Falls back to path.resolve(p) when not even the
 * filesystem root resolves.
 */
export function realpathNearest(p: string): string {
  const resolved = path.resolve(p);
  const tail: string[] = [];
  let probe = resolved;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(probe), ...tail);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return resolved;
      tail.unshift(path.basename(probe));
      probe = parent;
    }
  }
}

/**
 * A path that names a project root. PENSMITH_PAPER_ROOT, `--paper` and the
 * working directory name the folder that CONTAINS `.paper/`; a path to the
 * `.paper` folder itself (the pre-v1 MCP convention) or to anything inside it
 * (`.paper/sections/01-intro`) is read as the project folder that holds it, so
 * nothing is ever written to `.paper/.paper/`. The dry-run workspace
 * `.paper-dry-run/` folds the same way (GRND-19).
 */
export function asProjectRoot(p: string): string {
  const r = path.resolve(p);
  // The innermost paper-folder ancestor-or-self; its parent is the project folder
  // (a `.paper` inside a `.paper` — a phantom an older pensmith made — folds on).
  let cur = r;
  for (;;) {
    if (isPaperDirName(path.basename(cur))) {
      let root = path.dirname(cur);
      while (isPaperDirName(path.basename(root))) root = path.dirname(root);
      return root;
    }
    const up = path.dirname(cur);
    if (up === cur) return r;
    cur = up;
  }
}

/**
 * The paper root for the MCP server or a hook: PENSMITH_PAPER_ROOT, else the
 * working directory — never `--paper`, never the `open` pointer (D-17-33).
 */
export function servicePaperRoot(env: NodeJS.ProcessEnv = process.env): string {
  const envRoot = env['PENSMITH_PAPER_ROOT'];
  return envRoot ? asProjectRoot(envRoot) : workingDirectory();
}

/** Resolve the paper root for one invocation (see the section comment). */
export function resolvePaperRoot(opts: ResolvePaperRootOptions): PaperRootResolution {
  // A cwd inside a paper's `.paper/` is that paper's project folder (RUN-13):
  // every reader, writer and lock then addresses one root.
  const here = path.resolve(opts.cwd ?? process.cwd());
  const cwd = asProjectRoot(here);
  const env = opts.env ?? process.env;
  const envRoot = env['PENSMITH_PAPER_ROOT'];
  if (opts.mode !== 'cli') {
    return envRoot
      ? { kind: 'root', root: servicePaperRoot(env), source: 'env' }
      : { kind: 'root', root: cwd, source: 'cwd' };
  }
  if (opts.paperFlag !== undefined) {
    // A relative --paper is relative to where the user typed it.
    return { kind: 'root', root: resolvePaperFlag(opts.paperFlag, here), source: 'flag' };
  }
  if (envRoot) {
    // PENSMITH_PAPER_ROOT names the paper like `--paper` does: a verb that
    // needs a paper refuses a folder without one there too, rather than build
    // a placeholder section in it (review round 2 — the MCP tools refuse alike).
    const root = asProjectRoot(envRoot);
    if (opts.readOnly !== true && mutatingVerbNeedsPaper(opts.verb) && !hasPaper(root)) {
      throw new PensmithError(noPaperHereMessage(root), EXIT_USAGE);
    }
    return { kind: 'root', root, source: 'env' };
  }
  if (hasPaper(cwd)) return { kind: 'root', root: cwd, source: 'cwd' };
  // A bare run starts a new paper here when the folder holds an assignment
  // file (GRND-01, D-18-08).
  if (
    (opts.verb !== null && NEW_PAPER_VERBS.has(opts.verb))
    || (opts.verb === null && findAssignmentFile(cwd) !== null)
  ) {
    return { kind: 'root', root: cwd, source: 'new' };
  }
  const pointer = readActivePaperPointer();
  // A piped stdin starts a new paper on a bare run only when no `open` pointer
  // exists (the fstat test only — stdin is read later, by `new`). With a
  // pointer, RUN-14's ask/refuse comes first: harnesses, CI steps and
  // child_process give a child a pipe on stdin whether or not it holds an
  // assignment, and `printf 'y\n' | pensmith` is a confirmation, not a paper.
  // `pensmith new` (an explicit verb) still reads a piped assignment.
  if (!pointer && opts.verb === null && (opts.stdinAssignment ?? stdinMayCarryAssignment(env))) {
    return { kind: 'root', root: cwd, source: 'new' };
  }
  if (pointer) {
    return opts.readOnly === true
      ? { kind: 'pointer', root: pointer.root, pointer }
      : { kind: 'ask-pointer', cwd, pointer };
  }
  if (opts.readOnly !== true && mutatingVerbNeedsPaper(opts.verb)) {
    throw new PensmithError(noPaperHereMessage(cwd), EXIT_USAGE);
  }
  return { kind: 'root', root: cwd, source: 'fallback' };
}

/** Options bag for sectionDir (ARCH-20 / D-15 letter-suffix reservation). */
export interface SectionDirOpts {
  /**
   * A single lowercase letter inserted between the zero-padded number and the
   * slug (e.g. `letterSuffix: 'b'` → `03b-slug`). Phase 4 does NOT emit
   * suffixed paths (D-15); this is the reserved insertion-path hook that
   * Phase 8's `/pensmith add` will use. When omitted, the legacy `NN-slug`
   * form is produced and existing callers are unchanged.
   */
  letterSuffix?: string;
}

/**
 * Returns `<root>/.paper/sections/{NN[letter]-slug}` for a section index `n` in
 * `[0, 99]` and a free-form section name. The name is run through `slugify`,
 * which strips diacritics, lowercases, kebab-cases, truncates to 64 chars, and
 * rejects path-traversal patterns.
 *
 * The 3rd argument is overloaded for backward compatibility:
 *   - `sectionDir(n, slug)`                       → uses projectRoot()
 *   - `sectionDir(n, slug, root)`                 → explicit root (legacy 3-arg)
 *   - `sectionDir(n, slug, { letterSuffix })`     → projectRoot() + suffix
 *   - `sectionDir(n, slug, root, { letterSuffix })` → explicit root + suffix
 *
 * When `letterSuffix` is provided it must be a single lowercase letter
 * (ARCH-20 / D-15). Existing 3-arg `(n, slug, root)` callers are unchanged.
 *
 * Throws if `n` is not a non-negative integer ≤ 99 or `letterSuffix` is invalid.
 */
export function sectionDir(
  n: number,
  slug: string,
  rootOrOpts?: string | SectionDirOpts,
  maybeOpts?: SectionDirOpts,
): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`sectionDir: n must be an integer in [0,99]; got ${n}`);
  }
  let root: string;
  let opts: SectionDirOpts | undefined;
  if (typeof rootOrOpts === 'string') {
    root = rootOrOpts;
    opts = maybeOpts;
  } else {
    root = projectRoot();
    opts = rootOrOpts;
  }
  const padded = String(n).padStart(2, '0');
  let suffix = '';
  if (opts?.letterSuffix !== undefined) {
    if (!/^[a-z]$/.test(opts.letterSuffix)) {
      throw new Error(
        `sectionDir: letterSuffix must be a single lowercase letter; got ${JSON.stringify(opts.letterSuffix)}`,
      );
    }
    suffix = opts.letterSuffix;
  }
  const safeSlug = slugify(slug);
  return path.join(paperDir(root), 'sections', `${padded}${suffix}-${safeSlug}`);
}

/**
 * Defensive parser for a section directory BASENAME (`NN[letter]-slug`).
 * Returns the parsed components, or `null` when the basename does not match
 * the canonical shape or contains a path-traversal / null-byte payload.
 *
 * ARCH-20 / D-15: Phase 4 path-walking code must TOLERATE letter-suffix
 * directories (`03b-...`) without error. This parser is the cheap insurance
 * the research recommended (Research §K) — it exists even though Phase 4 has
 * no caller yet, so the future `/pensmith add` command and any `fs.readdir`
 * over the sections directory inherit traversal-safe parsing.
 *
 * Rejection rules (V12 ASVS path-traversal mitigation, T-04-06):
 *   - contains a null byte
 *   - contains a path separator (`/` or `\`) — basenames only
 *   - is `.` or `..` or contains a `..` segment
 *   - looks like an absolute path (leading `/` or a Windows drive `C:`)
 *   - does not match `^(\d{2})([a-z])?-([a-z0-9-]+)$`
 */
export function parseSectionDirName(
  basename: string,
): { n: number; letterSuffix: string | undefined; slug: string } | null {
  if (typeof basename !== 'string' || basename.length === 0) return null;
  // Reject any path-ish / unsafe payload outright.
  if (basename.includes('\0')) return null;
  if (basename.includes('/') || basename.includes('\\')) return null;
  if (basename === '.' || basename === '..') return null;
  if (basename.includes('..')) return null;
  if (/^[a-zA-Z]:/.test(basename)) return null; // Windows drive prefix
  const m = /^(\d{2})([a-z])?-([a-z0-9-]+)$/.exec(basename);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  const slug = m[3] as string;
  // Slug must survive the bare-slug contract (no leading/trailing/double dash
  // would already be admitted by the regex, but validate to stay aligned).
  if (!SLUG_RE.test(slug)) return null;
  return { n, letterSuffix: m[2], slug };
}

// Sync-folder detection patterns, per D-43.
// Used by Phase 2 doctor to warn if a user is developing inside OneDrive /
// iCloud / Dropbox / Google Drive (which corrupts active lock files and
// SQLite DBs). NOT used to redirect anything — pensmith state already lives
// outside the project tree per `pensmithDataDir`.
const SYNC_FOLDER_PATTERNS: RegExp[] = [
  // Windows
  /\\OneDrive(\\| - )/i,
  /\\Dropbox\\/i,
  /\\Google Drive\\/i,
  // macOS
  /\/Library\/CloudStorage\/OneDrive-/i,
  /\/Library\/Mobile Documents\/com~apple~CloudDocs\//i,
  /\/Dropbox\//i,
  /\/Google Drive\//i,
  // Linux + generic POSIX-style
  /\/OneDrive\//i,
];

/**
 * Returns true if `absPath` is inside a known cloud-sync folder (OneDrive
 * variants, iCloud Drive, Dropbox, Google Drive). Phase 2 doctor uses this
 * to warn users; Phase 1 callers do not need to act on the result.
 */
export function isInsideSyncFolder(absPath: string): boolean {
  return SYNC_FOLDER_PATTERNS.some((re) => re.test(absPath));
}

/**
 * Deterministic ASCII kebab-case slug. Strips diacritics via NFKD, lowercases,
 * collapses non-`[a-z0-9]` runs to a single `-`, trims leading/trailing `-`,
 * truncates to 64 chars.
 *
 * Throws on:
 *  - empty input or input that produces an empty slug after normalization
 *    (e.g. all-whitespace, all-punctuation)
 *  - input that produces a `..` path-traversal candidate after normalization
 *    (defense-in-depth — the regex collapse should already drop `.` chars,
 *    but the explicit guard documents intent and survives future regex tweaks).
 *
 * Threat model T-01-09: this is the ONLY sanitization between user-supplied
 * section names and `path.join` in `sectionDir`. Tests exercise `..`,
 * `../foo`, `/etc/passwd`, empty, whitespace-only, all-punctuation.
 */
export function slugify(s: string): string {
  // 1. NFKD normalize and strip combining diacritics (Unicode block
  //    U+0300..U+036F). This converts e.g. 'é' → 'e' + U+0301 → 'e'.
  const ascii = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  // 2. lowercase, replace non-[a-z0-9] runs with '-' (single hyphen).
  //    The `+` quantifier is greedy-linear; no quadratic regex risk.
  const kebab = ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // 3. trim leading/trailing '-'
  const trimmed = kebab.replace(/^-+|-+$/g, '');
  // 4. truncate to 64 chars; re-trim trailing '-' in case truncation
  //    landed mid-run.
  const truncated = trimmed.slice(0, 64).replace(/-+$/, '');
  // 5. defensive guards
  if (!truncated) {
    throw new Error(`slugify produced empty string for input: ${JSON.stringify(s)}`);
  }
  if (truncated.includes('..')) {
    throw new Error(
      `slugify produced path-traversal candidate '..' for input: ${JSON.stringify(s)}`,
    );
  }
  return truncated;
}

// ---------------------------------------------------------------------------
// Section file helpers (Phase 3 Plan 03-03 Task 3.3).
//
// Each helper accepts (n, slug, root?) where slug is a BARE slug (validated
// strictly by validateSlug — NO slugify pass; callers MUST already have a
// regex-clean slug from PlanFrontmatter or HANDOFF). The returned path is
// `<root>/.paper/sections/NN-slug/<FILE>.md`.
//
// These are the canonical accessors for a section's four artifacts:
//   - PLAN.md         (D-08 — section state source of truth)
//   - DRAFT.md
//   - VERIFICATION.md
//   - RESEARCH.md
//
// Why a separate strict-slug entry point (not reuse sectionDir):
//   sectionDir(n, name) is the legacy free-form-name convenience for the
//   doctor / outline-render path, slugifying e.g. 'Results & Discussion'
//   for human-typed names. The new section/* helpers are the post-plan
//   access path where slug is already kebab-case from PlanFrontmatter —
//   passing a free-form name here would silently bypass slug normalization
//   contract and create a second source of truth (T-3-12 hardening).
// ---------------------------------------------------------------------------

/** `<root>/.paper/sections` — every section folder lives directly under it. */
export function sectionsDir(root: string = projectRoot()): string {
  return path.join(paperDir(root), 'sections');
}

/** The folder under `.paper/sections/` that holds dropped sections (GRND-09). */
export const SECTION_ARCHIVE_DIRNAME = '_archive';

/**
 * `<root>/.paper/sections/_archive` — where a re-outline moves the folder of a
 * section it dropped (GRND-09, D-18-18). `_archive` never parses as a section
 * folder name (parseSectionDirName), so no section lookup ever finds it, and
 * the export gate and the PreCompact hook skip it.
 */
export function sectionArchiveDir(root: string = projectRoot()): string {
  return path.join(sectionsDir(root), SECTION_ARCHIVE_DIRNAME);
}

/**
 * The existing folder of the section whose slug is `slug`, or null (GRND-09,
 * D-18-16): the one `sections/NN[a]-<slug>/` directory. A section's folder is
 * found by its slug because its number is fixed at creation and may carry a
 * letter (`01a-background`) that callers holding only `(n, slug)` do not know.
 * When several folders carry the slug (a hand-made paper), the one whose
 * number is `n` wins, then the first in (n, letter) order.
 */
export function findSectionFolder(slug: string, root: string = projectRoot(), n?: number): string | null {
  validateSlug(slug);
  let names: string[];
  try {
    names = fs.readdirSync(sectionsDir(root));
  } catch {
    return null;
  }
  const hits: Array<{ name: string; n: number; letter: string }> = [];
  for (const name of names) {
    const parsed = parseSectionDirName(name);
    if (parsed === null || parsed.slug !== slug) continue;
    try {
      if (!fs.statSync(path.join(sectionsDir(root), name)).isDirectory()) continue;
    } catch {
      continue;
    }
    hits.push({ name, n: parsed.n, letter: parsed.letterSuffix ?? '' });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => (a.n !== b.n ? a.n - b.n : a.letter < b.letter ? -1 : a.letter > b.letter ? 1 : 0));
  const exact = n !== undefined ? hits.find((h) => h.n === n) : undefined;
  return path.join(sectionsDir(root), (exact ?? (hits[0] as { name: string })).name);
}

/**
 * The folder a NEW section gets: `sections/NN[a]-<slug>`, the letter given
 * explicitly (GRND-09 — a folder is created once, with its final name, and
 * never renamed or renumbered). Strict bare slug; number 0..99.
 */
export function newSectionFolder(n: number, slug: string, root: string = projectRoot(), suffix?: string): string {
  validateSlug(slug);
  if (suffix !== undefined && !/^[a-z]$/.test(suffix)) {
    throw new Error(`section letter must be one lowercase letter; got ${JSON.stringify(suffix)}`);
  }
  return path.join(sectionsDir(root), `${pad2(n)}${suffix ?? ''}-${slug}`);
}

/**
 * The section directory for `(n, slug)`: the existing `sections/NN[a]-<slug>`
 * folder found by slug (findSectionFolder), else `sections/NN-<slug>` for a
 * folder not created yet — so every `(n, slug)` caller keeps working for a
 * lettered section (D-18-16). STRICTLY-validated bare slug (no slugify pass),
 * distinct from the legacy `sectionDir` which slugifies its input. New code
 * (post-plan, with the slug pulled from PlanFrontmatter) SHOULD call the
 * helpers below.
 */
function strictSectionDir(
  n: number,
  slug: string,
  root: string = projectRoot(),
): string {
  validateSlug(slug);
  pad2(n);
  const found = findSectionFolder(slug, root, n);
  if (found !== null) return found;
  // A registered lettered section (§1a) whose folder does not exist yet (a
  // Tier-1 paper_init_section, a user-deleted folder) is created with its
  // letter — never as §1's `01-<slug>` (D-18-16).
  return path.join(sectionsDir(root), `${pad2(n)}${registeredSuffix(n, slug, root) ?? ''}-${slug}`);
}

/**
 * The letter STATE.json registers for section (n, slug), or null (no letter,
 * no STATE.json, an unreadable one, or no such section). A tolerant read —
 * never throws; the schema-checked reader is state.ts.
 */
function registeredSuffix(n: number, slug: string, root: string): string | null {
  try {
    const value = JSON.parse(fs.readFileSync(paperStateFile(root), 'utf8')) as { sections?: unknown };
    if (!Array.isArray(value.sections)) return null;
    for (const s of value.sections as Array<Record<string, unknown>>) {
      if (s['n'] === n && s['slug'] === slug && typeof s['suffix'] === 'string' && /^[a-z]$/.test(s['suffix'])) return s['suffix'];
    }
  } catch {
    /* absent or unreadable: no letter */
  }
  return null;
}

export function sectionPlan(
  n: number,
  slug: string,
  root: string = projectRoot(),
): string {
  return path.join(strictSectionDir(n, slug, root), 'PLAN.md');
}

export function sectionDraft(
  n: number,
  slug: string,
  root: string = projectRoot(),
): string {
  return path.join(strictSectionDir(n, slug, root), 'DRAFT.md');
}

export function sectionVerification(
  n: number,
  slug: string,
  root: string = projectRoot(),
): string {
  return path.join(strictSectionDir(n, slug, root), 'VERIFICATION.md');
}

export function sectionResearch(
  n: number,
  slug: string,
  root: string = projectRoot(),
): string {
  return path.join(strictSectionDir(n, slug, root), 'RESEARCH.md');
}
