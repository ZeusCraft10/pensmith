// Child-process driver for tests/quote-acceptance-cli.test.ts: verify one
// section of the paper in the cwd through verifySection — the production
// passes (the gate core's Pass 1 and Pass 3, offline replay) — with the
// interactive `quote-accept` gate (D-20-26) answered on stdin
// (PENSMITH_PROMPT_MODE=numbered). The test's paper cites a recorded Crossref
// work and runs with no contact email, so Pass 3 cannot ask Unpaywall for an
// open-access copy: each quote is UNVERIFIABLE-QUOTE, the one verdict a
// per-quote acceptance covers. Prints one JSON line.
//
// usage: verify-quote-prompt.ts <n> <slug> <interactive:true|false> <yolo:true|false> [accept-id ...]

import { verifySection } from '../../../bin/cli/verify.js';

const [n, slug, interactive, yolo, ...accept] = process.argv.slice(2);

async function main(): Promise<unknown> {
  if (n === undefined || slug === undefined) throw new Error(`bad args: ${process.argv.slice(2).join(' ')}`);
  const r = await verifySection(Number(n), slug, null, {
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
