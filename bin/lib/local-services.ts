// bin/lib/local-services.ts — which services on the user's own machine the
// egress gate may reach (SRC-15, SRC-16; D-19-21, D-19-24).
//
// bin/lib/http.ts refuses every loopback / private address, except a
// configured local model endpoint (D-17-09) and the two local services below.
// Whether a local service is enabled is read from the ENVIRONMENT here, and
// only here — never from a paper's config.toml, INTAKE.md or any other file
// that can travel with a paper — so a shared paper can never aim pensmith at a
// port on the reader's machine:
//
//   zotero-local — the Zotero 7 local API, exactly http://127.0.0.1:23119,
//                  when PENSMITH_ZOTERO_LOCAL=1;
//   grobid       — a GROBID server at the loopback origin PENSMITH_GROBID_URL
//                  names (127.0.0.1, ::1 or localhost; anything else leaves
//                  GROBID disabled, because it would receive the user's PDFs).
//
// http.ts enforces the rest (FetchOptions.localService): the request origin
// must equal the enabled origin, and every resolved address must be loopback.

/** A service on the user's own machine the egress gate may reach when enabled. */
export type LocalService = 'zotero-local' | 'grobid';

/** The one origin the Zotero 7 local API listens on. */
export const ZOTERO_LOCAL_ORIGIN = 'http://127.0.0.1:23119';

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]', '::1', 'localhost']);

/** True when PENSMITH_ZOTERO_LOCAL=1 enables the Zotero 7 local API. */
export function isZoteroLocalEnabled(): boolean {
  return process.env.PENSMITH_ZOTERO_LOCAL === '1';
}

/** The raw PENSMITH_GROBID_URL, trimmed (null when unset or empty). */
export function grobidUrlSetting(): string | null {
  const v = process.env.PENSMITH_GROBID_URL?.trim();
  return v ? v : null;
}

/**
 * The loopback origin of a GROBID URL (default: PENSMITH_GROBID_URL), or null
 * when it is unset, not a URL, not http(s), or not a loopback host.
 */
export function grobidOrigin(raw: string | null | undefined = grobidUrlSetting()): string | null {
  const v = raw?.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!LOOPBACK_HOSTNAMES.has(u.hostname.toLowerCase())) return null;
  return u.origin;
}

/** The environment's origin for an enabled local service, or null when it is not enabled. */
export function enabledLocalServiceOrigin(kind: LocalService): string | null {
  if (kind === 'zotero-local') return isZoteroLocalEnabled() ? ZOTERO_LOCAL_ORIGIN : null;
  return grobidOrigin();
}
