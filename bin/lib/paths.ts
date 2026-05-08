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

/**
 * Returns `<root>/.paper/sections/{NN-slug}` for a section index `n` in
 * `[0, 99]` and a free-form section name. The name is run through
 * `slugify`, which strips diacritics, lowercases, kebab-cases, truncates
 * to 64 chars, and rejects path-traversal patterns.
 *
 * Throws if `n` is not a non-negative integer ≤ 99.
 */
export function sectionDir(
  n: number,
  slug: string,
  root: string = projectRoot(),
): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`sectionDir: n must be an integer in [0,99]; got ${n}`);
  }
  const padded = String(n).padStart(2, '0');
  const safeSlug = slugify(slug);
  return path.join(paperDir(root), 'sections', `${padded}-${safeSlug}`);
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
