# plugin-legacy — negative-control fixture (PLUG-01, CI-05)

A small plugin directory in the pre-v1 shapes that stopped the pensmith plugin
from loading at all:

- `.claude-plugin/plugin.json` registers skills as an array of `{name, file}`
  objects (Claude Code: `skills: Invalid input`);
- `hooks/hooks.json` is the homemade `{schemaVersion, hooks: [{event, script}]}`
  shape pointing at `.ts` sources;
- `skills/pensmith.md` is a flat skill file (a skill is `skills/<name>/SKILL.md`).

`tests/validate-plugin-manifest.test.ts` runs
`node scripts/validate-plugin-manifest.cjs --root tests/fixtures/plugin-legacy`
and expects exit 1 with each reason named; CI-05's smoke
(`scripts/plugin-smoke.mjs`) expects `claude plugin validate --strict` to fail on
it too. It carries no personal data. `tests/plugin-layout.test.ts` exempts this
folder from the "no skill outside plugin/" rule.
