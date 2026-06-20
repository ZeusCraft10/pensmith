// tests/write-style-integration.test.ts — Phase 8 Wave 0 RED-by-skip scaffold
// for STYL-03 (the drafter voice-hint blend) + Pitfall 7 (resolution priority).
//
// RED-by-skip via SOURCE-GREP (mirrors [07-01]): READY = bin/cli/write.ts
// references `styleProfilePath` (the field 08-02/08-06 add to DrafterInput and
// wire into the writer). A bare existsSync is insufficient — write.ts already
// exists. Until 08-06 wires STYLE.json into the drafter, every test SKIPS so
// `npm test` stays GREEN.
//
// Contract pinned (Pitfall 7): the drafter's effective voice hint follows the
// priority PLAN.md `voice_hint` > style-match render (styleMatchToVoiceHint over
// STYLE.json) > default. A non-empty PLAN.md voice_hint MUST WIN over a present
// STYLE.json — the user's explicit per-section direction is never overridden by
// the inferred style profile. 08-06 exposes a `resolveVoiceHint` chokepoint that
// implements this precedence; this test pins its behavior.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

// SOURCE-GREP skip-predicate: write.ts must reference the STYLE.json wiring.
function writeStyleWired(): boolean {
  const writePath = repoPath('bin/cli/write.ts');
  if (!fs.existsSync(writePath)) return false;
  return /styleProfilePath/.test(fs.readFileSync(writePath, 'utf8'));
}

const READY = writeStyleWired();

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
  resolveVoiceHint: (input: { planMd: string; styleProfile?: StyleProfile }) => string;
}

function mkTmp(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-write-style-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

test('STYL-03 / Pitfall 7: a non-empty PLAN.md voice_hint WINS over a present STYLE.json', { skip: !READY }, async () => {
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

test('STYL-03 / Pitfall 7: absent PLAN.md voice_hint falls back to the style-match render (then default)', { skip: !READY }, async () => {
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
