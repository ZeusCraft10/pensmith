# pensmith open

> Choose the active paper by name — without a `cd`. Writes the active-paper
> pointer: read-only verbs (`status`, `list`, `doctor`, `--estimate`) then show
> that paper from any folder; a command that would change a paper asks before
> following it, and outside a terminal refuses and names `--paper <name>`.

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
its `folderPath` still holds a paper — writes the active-paper pointer at
`pensmithDataDir()/active.json` (LIB-03).

What the pointer does (RUN-14, D-17-33, PRD §6):

- **Read-only verbs** (`status`, `list`, `doctor`, and any `--estimate`) run in
  a folder with no paper of its own follow the pointer and print
  `(active paper "<name>" at <path>)` first.
- **Mutating verbs** and a bare `pensmith` / `next` / `resume` in such a folder
  do NOT follow it silently: in a terminal they ask (continue the active paper,
  or start a new paper here); without a terminal they refuse with exit 2 and
  name `--paper <name>` and `pensmith new`. `--yolo` never follows the pointer.
  `--paper <name>` works from anywhere, non-interactively.
- A folder that holds its own `.paper/` always wins over the pointer.
- **The MCP server and the hooks never read the pointer** — in Tier 1 they use
  `PENSMITH_PAPER_ROOT` or the session's working directory — so in a Claude
  Code session `open` changes only what the CLI's read-only verbs show.
- A pointer whose folder no longer holds a paper is cleared with a warning.

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
- stdout — on success two lines:
  `pensmith open: switched to "<name>" at <folderPath>` and
  `pensmith open: status/list/doctor now show it from any folder; to change it from elsewhere, pass --paper "<name>".`
  Otherwise one not-found (`no paper named "<name>". Run \`pensmith list\` to
  see papers.`) or folder-missing (`folder not found for "<name>": <path>`)
  line, and no pointer is written.

## Body

1. **Resolve by name** (LIB-03): call `loadGlobalLibrary()` and find the entry
   whose `name` exactly matches the `<name>` arg. The untrusted `<name>` is used
   ONLY for an exact-match registry lookup — it NEVER reaches `path.join`, so
   there is no path-traversal surface (T-08-01).

2. **Not-found guard**: if no entry matches, print
   `no paper named "<name>". Run \`pensmith list\` to see papers.` and return
   `{ ok: false }`. No pointer is written.

3. **Folder-present guard** (T-08-01-04): the folder must exist and still
   hold a paper (`fs.existsSync(entry.folderPath)` and `hasPaper`) before
   switching — never switch to a missing/relocated folder. Neither check throws;
   a missing folder prints a clear message and returns `{ ok: false }` (the
   status.ts never-crash precedent).

4. **Write the active pointer** (T-08-01-03 / D-07): `mkdir -p` the
   `pensmithDataDir()` (it may not exist yet), then `atomicWriteFile` the
   `{ paperId, folderPath, openedAt }` pointer. The write routes through the
   atomic-write chokepoint — never a raw `fs.writeFile`. Then print the two
   stdout lines above.

5. **Shell fallback** (TIER-06 equivalence path): `pensmith open <name>`. The
   positional `<name>` is required; no other flags.
