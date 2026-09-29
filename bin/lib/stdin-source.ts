// bin/lib/stdin-source.ts — may stdin carry the assignment? (GRND-01, D-18-08).
//
// One predicate shared by the active-paper resolver (paths.ts resolvePaperRoot:
// a bare run with an assignment piped on stdin starts a new paper here when no
// `open` pointer is set, RUN-14 step 5) and by the assignment reader
// (assignment.ts). It never reads stdin: it
// only fstat()s file descriptor 0, so the resolver stays side-effect free and a
// never-closing stdin (an agent harness, a CI runner) can never hang it.
//
// stdin is an assignment candidate only when ALL of these hold (D-18-08, the
// D-17-36 "never hang, never guess" rule):
//   - it is not a terminal (a terminal gets the interactive paste prompt);
//   - it is a pipe — a FIFO (`printf … | pensmith new`, a Windows named pipe)
//     or a socket (what Node's child_process and many harnesses give a child
//     for `stdio: 'pipe'`) — or a non-empty regular file (`pensmith new <
//     assignment.txt`); never /dev/null or NUL (a character device, what
//     `stdio: 'ignore'` and `< /dev/null` give) and never a terminal;
//     (the file type is read from st_mode's type bits, not Stats.isFIFO():
//     Node hard-wires isFIFO() / isSocket() to false on Windows, where libuv's
//     fstat reports every pipe — `type a.txt | pensmith`, child_process
//     `stdio: 'pipe'` — as _S_IFIFO, the POSIX S_IFIFO bits. With isFIFO() a
//     piped assignment was never read on Windows);
//   - PENSMITH_PROMPT_MODE is not `numbered` (then stdin carries scripted
//     answers, one line per question, RUN-12).
//
// Kept dependency-free (node:fs only) because paths.ts — imported by nearly
// every module, the MCP server included — imports it.

import * as fs from 'node:fs';

/** st_mode's file-type field and the types it may name (POSIX values; libuv uses them on Windows too). */
const S_IFMT = 0o170000;
const S_IFIFO = 0o010000;
const S_IFSOCK = 0o140000;
const S_IFREG = 0o100000;

/** Whether a descriptor with this fstat() result may carry a piped assignment: a pipe, a socket or a non-empty regular file. */
export function statMayCarryAssignment(st: Pick<fs.Stats, 'mode' | 'size'>): boolean {
  const type = st.mode & S_IFMT;
  if (type === S_IFIFO || type === S_IFSOCK) return true;
  return type === S_IFREG && st.size > 0;
}

/** True when stdin (fd 0) may carry a piped assignment. Never reads, never throws. */
export function stdinMayCarryAssignment(env: NodeJS.ProcessEnv = process.env, fd = 0): boolean {
  if (env['PENSMITH_PROMPT_MODE'] === 'numbered') return false;
  let st: fs.Stats;
  try {
    st = fs.fstatSync(fd);
  } catch {
    return false; // a closed or invalid descriptor carries nothing
  }
  return statMayCarryAssignment(st);
}
