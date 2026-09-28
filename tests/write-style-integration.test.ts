// tests/write-style-integration.test.ts — STYL-03 (the drafter voice-hint
// blend) + Pitfall 7 (resolution priority), extended by Phase 18 FEED-02 /
// D-18-24.
//
// Contract pinned (Pitfall 7, D-18-24): the drafter's effective voice follows
// the priority: the section's own hint — its PLAN.md `voice` (the outline's),
// else its OUTLINE row `voice`, else a legacy explicit direction
// (`voice_hint:` / a `Voice:` line) — then the style-match render
// (styleMatchToVoiceHint over STYLE.json), then the discipline preset's tone,
// then a non-empty default. A section hint MUST WIN over a present STYLE.json —
// the user's explicit per-section direction is never overridden by the inferred
// style profile. `resolveVoiceHint` (drafter-input.ts, re-exported by write.ts)
// implements it; this test pins its behavior. The Phase 8 source-grep skip
// guard is gone: the wiring is permanent.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

const PAPER_A = repoPath('tests/fixtures/style-samples/paperA');

// Runtime URL.href specifiers so tsc stays clean while the symbols are pending:
//   - style-match.ts (08-02) is not built yet
//   - write.ts exists but resolveVoiceHint is added in 08-06
const SM_MOD = new URL('../bin/lib/style-match.js', import.meta.url);
const WRITE_MOD = new URL('../bin/cli/write.js', import.meta.url);

interface StyleProfile {
  fingerprint: string;
}
interface StyleMatchMod {
  buildStyleProfile: (samplesDir: string) => Promise<StyleProfile>;
  styleMatchToVoiceHint: (profile: StyleProfile) => string;
}
interface WriteMod {
  resolveVoiceHint: (input: { planMd: string; styleProfile?: StyleProfile; outlineVoice?: string; presetHint?: string }) => string;
}

function mkTmp(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-write-style-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

test('STYL-03 / Pitfall 7: a non-empty PLAN.md voice_hint WINS over a present STYLE.json', async () => {
  mkTmp();

  // Build a real STYLE.json from the committed paperA samples.
  const { buildStyleProfile } = (await import(SM_MOD.href)) as StyleMatchMod;
  const profile = await buildStyleProfile(PAPER_A);

  // The resolution chokepoint exposed by 08-06.
  const { resolveVoiceHint } = (await import(WRITE_MOD.href)) as WriteMod;

  // A stubbed PLAN.md with an EXPLICIT, non-empty voice_hint in its ## Brief.
  const planMd =
    `---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: planned\n---\n` +
    `## Brief\n\nVoice: terse and punchy, first-person plural.\n`;

  const resolved = resolveVoiceHint({ planMd, styleProfile: profile });
  assert.match(
    resolved,
    /terse and punchy/i,
    'PLAN.md voice_hint must take priority over the style-match render',
  );
});

test('STYL-03 / Pitfall 7: absent PLAN.md voice_hint falls back to the style-match render (then default)', async () => {
  mkTmp();
  const { buildStyleProfile, styleMatchToVoiceHint } = (await import(SM_MOD.href)) as StyleMatchMod;
  const profile = await buildStyleProfile(PAPER_A);
  const { resolveVoiceHint } = (await import(WRITE_MOD.href)) as WriteMod;

  // PLAN.md with NO Voice: line → the style-match render is used.
  const planMdNoVoice = `---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: planned\n---\n## Brief\n\n(no voice line)\n`;
  const withStyle = resolveVoiceHint({ planMd: planMdNoVoice, styleProfile: profile });
  assert.equal(
    withStyle,
    styleMatchToVoiceHint(profile),
    'absent PLAN.md voice_hint → style-match render',
  );

  // No PLAN.md voice AND no style profile → a non-empty default (never empty).
  const fallback = resolveVoiceHint({ planMd: planMdNoVoice });
  assert.ok(fallback.trim().length > 0, 'with neither source, a non-empty default voice hint is used');
});

test('FEED-02 / D-18-24: the outline voice (PLAN.md `voice`, else the OUTLINE row) wins over STYLE.json; the preset tone is the fallback', async () => {
  mkTmp();
  const { buildStyleProfile, styleMatchToVoiceHint } = (await import(SM_MOD.href)) as StyleMatchMod;
  const profile = await buildStyleProfile(PAPER_A);
  const { resolveVoiceHint } = (await import(WRITE_MOD.href)) as WriteMod;
  const withVoice = `---\nsection: 1\nslug: intro\ntitle: Intro\nvoice: plain, expository\nstatus: planned\n---\n## Claims\n\n1. A claim.\n`;
  assert.equal(resolveVoiceHint({ planMd: withVoice, styleProfile: profile }), 'plain, expository', 'PLAN.md voice beats STYLE.json');
  const noVoice = `---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: planned\n---\n## Claims\n\n1. A claim.\n\n## Voice\n\nMeasured.\n`;
  assert.equal(resolveVoiceHint({ planMd: noVoice, outlineVoice: 'wry and brisk', styleProfile: profile }), 'wry and brisk', 'the OUTLINE row voice beats STYLE.json');
  assert.equal(resolveVoiceHint({ planMd: noVoice, styleProfile: profile, presetHint: 'Write in a technical register.' }), styleMatchToVoiceHint(profile), 'STYLE.json beats the preset tone');
  assert.equal(resolveVoiceHint({ planMd: noVoice, presetHint: 'Write in a technical register.' }), 'Write in a technical register.', 'the preset tone is the fallback');
  assert.ok(resolveVoiceHint({ planMd: noVoice }).trim().length > 0, 'never empty');
});
