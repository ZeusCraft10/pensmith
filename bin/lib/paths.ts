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
import os from 'node:os';
import path from 'node:path';

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
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error(
        'LOCALAPPDATA is unset on Windows; set it explicitly or run from a logged-in user account',
      );
    }
    return localAppData;
  }
  if (platform === 'darwin') {
    const home = env.HOME ?? os.homedir();
    return path.join(home, 'Library', 'Application Support');
  }
  // POSIX-like (linux, freebsd, openbsd, aix, sunos, etc.):
  // XDG_DATA_HOME if set, else ~/.local/share per XDG Base Directory Spec.
  const xdg = env.XDG_DATA_HOME;
  if (xdg) return xdg;
  const home = env.HOME ?? os.homedir();
  return path.join(home, '.local', 'share');
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
 * Resolves the project root to an absolute, normalized path. Defaults to
 * `process.cwd()`. Used as the input to `projectHash` and as the base of
 * `paperDir` / `sectionDir`.
 */
export function projectRoot(cwd: string = process.cwd()): string {
  return path.resolve(cwd);
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

/**
 * Returns `<root>/.paper` — the per-project pensmith working directory
 * inside the user's repo. NOTE: `.paper/` is the OnlyDocuments-style root
 * users see; pensmith app state (locks, caches) lives OUTSIDE this in
 * `pensmithDataDir` precisely because `.paper/` may be inside a sync folder.
 */
export function paperDir(root: string = projectRoot()): string {
  return path.join(root, '.paper');
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

/**
 * Returns the bare section directory `<root>/.paper/sections/NN-slug` using a
 * STRICTLY-validated bare slug (no slugify pass). Distinct from the legacy
 * `sectionDir` which slugifies its input. New code (post-plan, with slug
 * pulled from PlanFrontmatter) SHOULD call this helper.
 */
function strictSectionDir(
  n: number,
  slug: string,
  root: string = projectRoot(),
): string {
  validateSlug(slug);
  return path.join(paperDir(root), 'sections', `${pad2(n)}-${slug}`);
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
