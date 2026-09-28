// bin/lib/contact-email.ts — the one resolver of the polite-pool contact email
// (Phase 19 seam S-B; SRC-03, SRC-04, SRC-17; PRD §10 [network], §12).
//
// SEAM FILE (Phase 19 plan, S-B). Every Phase 19 stream applies it
// byte-identically from .planning/phases/19-sources/seams/; no stream edits it
// during Phase 19.
//
// Crossref (and its retraction lookup), OpenAlex and Unpaywall ask callers to
// identify themselves with a contact email. Which environment variable holds it
// is, in order: `[network] contact_email_env` in .paper/config.toml; the
// user's global runtime.json `contactEmailEnv` (a user-level setting in the
// pensmith data dir, never in a paper); PENSMITH_CONTACT_EMAIL. Every consumer — http.ts's User-Agent, the adapters'
// `mailto` / `email` parameters, Unpaywall's "skipped: set …" notice and the
// doctor probe — asks this module, so the configured variable is honoured
// everywhere or nowhere.
//
// Safety: a paper's config.toml can travel with the paper (a shared or synced
// folder), so it must not be able to aim pensmith at an arbitrary secret and
// send it to a scholarly API in a User-Agent. The configured variable name is
// honoured only when it is an upper-case identifier that contains EMAIL or
// MAILTO (e.g. MY_WORK_EMAIL); anything else is ignored with a one-time
// warning and the default variable is used. The value is sent only when it
// looks like an email address (one @, no spaces or angle brackets, ≤ 254
// characters); otherwise it counts as unset, with a one-time warning.
//
// The value is personal data (PRIVACY.md): it is never logged here, and
// http.ts drops it from every log record.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { paperConfigPath, tryReadPaperConfigSync } from './config.js';
import { projectRoot } from './paths.js';
import { globalRuntimeConfigPath } from './runtime.js';

/** The variable read when no valid `[network] contact_email_env` is configured. */
export const DEFAULT_CONTACT_EMAIL_ENV = 'PENSMITH_CONTACT_EMAIL';

/** An environment-variable name a paper config may name for the contact email. */
const ALLOWED_ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const EMAIL_WORD = /(?:EMAIL|MAILTO)/;
/** A plausible email address (not full RFC 5322 — enough to refuse junk and secrets). */
const EMAIL_SHAPE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export interface ContactEmail {
  /** The address to send, or null when none is configured (or it is malformed). */
  readonly email: string | null;
  /** The environment variable that was read. */
  readonly envName: string;
  /** Where the variable name came from: the paper's config, the user's runtime.json, or the default. */
  readonly source: 'config' | 'runtime' | 'default';
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  process.stderr.write(`pensmith: ${message}\n`);
}

/** True for a variable name a paper config may point the contact email at. */
export function isAllowedContactEnvName(name: string): boolean {
  return ALLOWED_ENV_NAME.test(name) && EMAIL_WORD.test(name);
}

/** True for a value pensmith will send as a contact email. */
export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_SHAPE.test(value);
}

interface CachedName {
  readonly stamp: string;
  readonly envName: string;
  readonly source: ContactEmail['source'];
}
const nameCache = new Map<string, CachedName>();

function configStamp(file: string): string {
  if (!existsSync(file)) return 'absent';
  try {
    const st = statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'unreadable';
  }
}

/**
 * The user's own choice of variable: runtime.json `contactEmailEnv` (the
 * global, user-level config; v1 and v2 files alike), when it names an
 * upper-case variable other than the default. Null otherwise (absent,
 * unreadable, or not a variable name — warned once).
 */
function runtimeEnvName(): string | null {
  const file = globalRuntimeConfigPath();
  let raw: unknown;
  try {
    raw = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { contactEmailEnv?: unknown }).contactEmailEnv : undefined;
  } catch {
    return null;
  }
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name === '' || name === DEFAULT_CONTACT_EMAIL_ENV) return null;
  if (!ALLOWED_ENV_NAME.test(name)) {
    warnOnce(`runtime:${name}`, `ignoring runtime.json contactEmailEnv = "${name}": it must name an upper-case environment variable; reading ${DEFAULT_CONTACT_EMAIL_ENV} instead.`);
    return null;
  }
  return name;
}

/** The variable name for the paper at `root` (cached per config file stamps). */
function envNameFor(root: string): { envName: string; source: ContactEmail['source'] } {
  const file = paperConfigPath(root);
  const stamp = `${configStamp(file)}|${configStamp(globalRuntimeConfigPath())}`;
  const hit = nameCache.get(file);
  if (hit && hit.stamp === stamp) return hit;
  let envName = DEFAULT_CONTACT_EMAIL_ENV;
  let source: ContactEmail['source'] = 'default';
  const configured = tryReadPaperConfigSync(root)?.network?.contact_email_env?.trim();
  if (configured && isAllowedContactEnvName(configured)) {
    envName = configured;
    source = 'config';
  } else {
    if (configured) {
      warnOnce(
        `name:${configured}`,
        `ignoring [network] contact_email_env = "${configured}": it must name an upper-case variable ` +
          `containing EMAIL or MAILTO (e.g. MY_WORK_EMAIL); reading ${DEFAULT_CONTACT_EMAIL_ENV} instead.`,
      );
    }
    const user = runtimeEnvName();
    if (user !== null) {
      envName = user;
      source = 'runtime';
    }
  }
  const entry: CachedName = { stamp, envName, source };
  nameCache.set(file, entry);
  return entry;
}

/**
 * The contact email for requests made on behalf of the paper at `root`
 * (default: the current project root). Never throws.
 */
export function contactEmail(root: string = projectRoot()): ContactEmail {
  const { envName, source } = envNameFor(root);
  const raw = process.env[envName]?.trim() ?? '';
  if (raw.length === 0) return { email: null, envName, source };
  if (!isPlausibleEmail(raw)) {
    warnOnce(`value:${envName}`, `${envName} is set but is not an email address; no contact email is sent.`);
    return { email: null, envName, source };
  }
  return { email: raw, envName, source };
}

/** Test hook: forget cached variable names and one-time warnings. */
export function _resetContactEmailForTest(): void {
  nameCache.clear();
  warned.clear();
}
