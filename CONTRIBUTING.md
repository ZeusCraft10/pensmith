# Contributing to Pensmith

Pensmith is in v0.1.0 development. The full CONTRIBUTING guide lands in Phase 2 alongside the tier-contract test gate.

## Architectural chokepoints (Phase 0+)

Two lint-enforced chokepoints exist from Phase 0 onward. Violating them fails CI:

1. **HTTP imports**: `fetch`, `http`, `https`, `node:http`, `node:https`, `undici` may only be imported from `bin/lib/http.ts`. Every other module routes through that file.
2. **DOI regex**: The literal regex `/^10\./` may only appear in `bin/lib/doi.ts`. DOI normalization is a single chokepoint per `.planning/research/PITFALLS.md` Pitfall 2.

See `eslint.config.js` for the rules and `tests/lint-chokepoint.test.ts` for the regression gate.

## Quick checklist before opening a PR

- `npm run check` is green locally
- CI matrix (linux-x64, macos-arm64, windows-x64 × Node 20.10) is green
- No new HTTP / DOI chokepoint violations
