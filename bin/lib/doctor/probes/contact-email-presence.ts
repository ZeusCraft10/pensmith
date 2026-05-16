// bin/lib/doctor/probes/contact-email-presence.ts
//
// DOCT-03: PENSMITH_CONTACT_EMAIL environment variable presence probe.
// D-15 severity: WARN when PENSMITH_CONTACT_EMAIL is unset; PASS when set.
// D-18: WARN copy matches references/http-warnings.md warning-text style.
// D-19 read-only: no filesystem I/O.

import type { Probe, ProbeResult } from '../probes.js';

export const contactEmailPresenceProbe: Probe = {
  id: 'contact-email-presence',
  async run(): Promise<ProbeResult> {
    const v = process.env.PENSMITH_CONTACT_EMAIL;
    if (v && v.length > 0) {
      return {
        id: 'contact-email-presence',
        severity: 'PASS',
        summary: 'PENSMITH_CONTACT_EMAIL set — HTTP User-Agent includes contact.',
      };
    }
    return {
      id: 'contact-email-presence',
      severity: 'WARN',
      summary: 'PENSMITH_CONTACT_EMAIL is not set — outbound HTTP will use a fallback User-Agent that may be rate-limited.',
      fix: 'Set PENSMITH_CONTACT_EMAIL to a contact email. See references/http-warnings.md.',
    };
  },
};
