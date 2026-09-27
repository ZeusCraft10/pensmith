// Child-process driver for tests/gates-registry.test.ts: run the real
// runRevise (bin/lib/revise.ts) with a deterministic proposeSwap and NO
// injected approver, so the `revise-swap` gate of the registry decides.
//
// usage: revise-gate.ts <root> <yolo:true|false>
// prints: {"ok":true,"accepted":bool} or {"ok":false,"name","message","exitCode"}

import { runRevise } from '../../../bin/lib/revise.js';

const [root, yoloArg] = process.argv.slice(2);
if (!root) throw new Error('usage: revise-gate.ts <root> <yolo>');

const proposal = JSON.stringify({
  action: 'swap',
  flagged_citekey: 'ghost2099',
  replacement_citekey: 'real2020',
  rationale: 'real2020 supports the claim',
  patch: { before_excerpt: 'nobody wrote [@ghost2099]', after_excerpt: 'nobody wrote [@real2020]' },
});

try {
  const r = await runRevise({
    paperRoot: root,
    n: 1,
    slug: 'intro',
    yolo: yoloArg === 'true',
    proposeSwap: async () => proposal,
  });
  process.stdout.write(JSON.stringify({ ok: true, accepted: r.accepted, message: r.message }) + '\n');
} catch (e) {
  const err = e as Error & { exitCode?: number; gateId?: string };
  process.stdout.write(
    JSON.stringify({ ok: false, name: err.name, message: err.message, exitCode: err.exitCode ?? null, gateId: err.gateId ?? null }) + '\n',
  );
}
