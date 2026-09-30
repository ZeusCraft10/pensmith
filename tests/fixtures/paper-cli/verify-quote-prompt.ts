// Child-process driver for tests/quote-acceptance-cli.test.ts: verify one
// section of the paper in the cwd through verifySection, with the interactive
// `quote-accept` gate (D-20-26) answered on stdin (PENSMITH_PROMPT_MODE=
// numbered) and the gate core's Pass-1 / Pass-3 seams standing in for the
// registrar (every cited key OK) and the quotes stream (UNVERIFIABLE-QUOTE for
// each of the given quotes the draft holds, ids in draft order) — the base
// Pass 3 still writes the legacy labels until the quotes stream lands (Phase
// 20 §7). Prints one JSON line.
//
// usage: verify-quote-prompt.ts <n> <slug> <interactive:true|false> <yolo:true|false> <quotes JSON array> [accept-id ...]

import { verifySection } from '../../../bin/cli/verify.js';
import { quoteTextSha256 } from '../../../bin/lib/verify/verdicts.js';
import { extractCitedKeysForVerification } from '../../../bin/lib/citation-token.js';
import type { Pass1Result } from '../../../bin/lib/verify/pass1.js';
import type { Pass3Result } from '../../../bin/lib/verify/pass3.js';

const [n, slug, interactive, yolo, quotesJson, ...accept] = process.argv.slice(2);

async function main(): Promise<unknown> {
  if (n === undefined || slug === undefined || quotesJson === undefined) throw new Error(`bad args: ${process.argv.slice(2).join(' ')}`);
  /** The quotes the stand-in Pass 3 cannot check (paywalled sources). */
  const QUOTES = JSON.parse(quotesJson) as string[];
  const gateDeps = {
    runPass1: async (text: string): Promise<Pass1Result[]> =>
      [...new Set(extractCitedKeysForVerification(text))].map((citekey) => ({ citekey, verdict: 'OK' as const, titleJW: 1, authorJW: 1, reason: 'stand-in registrar' })),
    runPass3: async (text: string): Promise<Pass3Result[]> =>
      QUOTES.filter((q) => text.includes(q))
        .sort((a, b) => text.indexOf(a) - text.indexOf(b))
        .map((q, i) => ({
          citekey: extractCitedKeysForVerification(text.slice(text.indexOf(q)))[0] ?? 'unknown',
          id: `q${i + 1}`,
          quoteSha256: quoteTextSha256(q),
          quoteSnippet: q.slice(0, 40),
          verdict: 'UNVERIFIABLE-QUOTE' as Pass3Result['verdict'],
          levRatio: 0,
          reason: 'no open-access copy (stand-in)',
        })),
  };
  const r = await verifySection(Number(n), slug, null, {
    gateDeps,
    interactive: interactive === 'true',
    yolo: yolo === 'true',
    ...(accept.length > 0 ? { acceptQuotes: accept } : {}),
  });
  return { status: r.status, blocked: r.blocked ?? false };
}

try {
  process.stdout.write(JSON.stringify({ ok: true, result: await main() }) + '\n');
} catch (e) {
  const err = e as Error & { exitCode?: number };
  process.stdout.write(JSON.stringify({ ok: false, name: err.name, message: err.message, exitCode: err.exitCode ?? null }) + '\n');
}
