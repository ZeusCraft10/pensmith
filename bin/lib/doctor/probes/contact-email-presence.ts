// bin/lib/doctor/probes/contact-email-presence.ts
//
// DOCT-03 / SRC-17 (D-19-09): is a polite-pool contact email configured?
// Asks bin/lib/contact-email.ts contactEmail() — the one resolver http.ts, the
// adapters and paper://capabilities use — so the probe reports exactly what
// the requests will send: the variable `[network] contact_email_env` names
// (default PENSMITH_CONTACT_EMAIL), and only a value that looks like an email.
// D-15 severity: PASS when an address will be sent; WARN otherwise.
// D-18: WARN copy matches references/http-warnings.md warning-text style.
// D-19 read-only: reads the paper config through contact-email.ts, writes nothing.
// The address itself never appears in the result (only the variable name).

import type { Probe, ProbeResult } from '../probes.js';
import { contactEmail } from '../../contact-email.js';

export const contactEmailPresenceProbe: Probe = {
  id: 'contact-email-presence',
  async run(): Promise<ProbeResult> {
    const { email, envName, source } = contactEmail();
    const named = source === 'config' ? ` (named by [network] contact_email_env)` : '';
    if (email !== null) {
      return {
        id: 'contact-email-presence',
        severity: 'PASS',
        summary: `${envName} set${named} — Crossref, OpenAlex and Unpaywall requests identify pensmith with it (User-Agent "(mailto:…)").`,
      };
    }
    return {
      id: 'contact-email-presence',
      severity: 'WARN',
      summary:
        `${envName} is not set (or is not an email address)${named} — Crossref and OpenAlex requests use their public pools ` +
        '(a fallback User-Agent with stricter rate limits), and Unpaywall, which requires an email, is skipped.',
      fix: `Set ${envName} to an address you read; it is sent only to Crossref, OpenAlex and Unpaywall (PRIVACY.md). See references/http-warnings.md.`,
    };
  },
};
