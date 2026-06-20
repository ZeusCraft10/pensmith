# pensmith open

> Switch the active paper by name — without a `cd`. Writes the active-paper
> pointer so subsequent verbs run against the selected paper from any directory.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct read of the global registry index + direct write of the active-paper pointer via the atomic-write chokepoint (the bin/cli/open.ts CLI path)
</capability_check>

## Overview

`pensmith open <name>` is the second library verb (list / **open** / sketch /
add). It looks the named paper up in the GLOBAL registry
(`pensmithDataDir()/library/index.json`, LIB-01), and — if the paper exists AND
its `folderPath` is still present on disk — writes the active-paper pointer at
`pensmithDataDir()/active.json` (LIB-03) so later verbs resolve `paperRoot`
from a different cwd.

The implementation lives in `bin/cli/open.ts` (`openCommand`) delegating to
`bin/lib/global-library.ts` (`loadGlobalLibrary`) + `bin/lib/paths.ts`
(`pensmithActivePointerPath`) + the D-07 `atomicWriteFile` chokepoint. Both
Tier 1 (plugin) and Tier 2 (CLI) run the SAME `bin/cli/open.ts` path; there is
no `pensmith_open` MCP tool (the Tier-1 surface is THIS workflow body delegating
to the same code — the compile/done asymmetry precedent, keeping the locked 16
verbs bijective with the 16 workflow bodies).

## Outputs

- `pensmithDataDir()/active.json` — the active-paper pointer
  `{ paperId, folderPath, openedAt }`, written via `atomicWriteFile` (D-07
  chokepoint, NEVER raw `fs.writeFile`). It lives in `pensmithDataDir()`, never
  inside a sync-folder-risk `.paper/` (LIB-03).
- stdout — `switched to "<name>" at <folderPath>` on success; a clear
  not-found / folder-missing message otherwise.

## Body

1. **Resolve by name** (LIB-03): call `loadGlobalLibrary()` and find the entry
   whose `name` exactly matches the `<name>` arg. The untrusted `<name>` is used
   ONLY for an exact-match registry lookup — it NEVER reaches `path.join`, so
   there is no path-traversal surface (T-08-01).

2. **Not-found guard**: if no entry matches, print
   `no paper named "<name>". Run \`pensmith list\` to see papers.` and return
   `{ ok: false }`. No pointer is written.

3. **Folder-present guard** (T-08-01-04): `fs.existsSync(entry.folderPath)`
   before switching — never switch to a missing/relocated folder. `existsSync`
   never throws (returns false on any error); a missing folder prints a clear
   message and returns `{ ok: false }` (the status.ts never-crash precedent).

4. **Write the active pointer** (T-08-01-03 / D-07): `mkdir -p` the
   `pensmithDataDir()` (it may not exist yet), then `atomicWriteFile` the
   `{ paperId, folderPath, openedAt }` pointer. The write routes through the
   atomic-write chokepoint — never a raw `fs.writeFile`.

5. **Shell fallback** (TIER-06 equivalence path): `pensmith open <name>`. The
   positional `<name>` is required; no other flags.
