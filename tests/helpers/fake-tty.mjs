// tests/helpers/fake-tty.mjs — a `node --import` preload that makes a spawned
// CLI's piped stdio look like a terminal, so tests drive the real @clack/prompts
// path (bin/lib/prompts/clack.ts) on every CI platform — a pseudo-terminal
// library is not a dependency and python's pty module does not exist on Windows.
//
// What it does, in the CHILD only:
//   - stdin, stdout and stderr report isTTY (resolveMode() then picks clack and
//     canPrompt() is true, exactly as in a terminal);
//   - stdin.setRawMode is a no-op (a pipe has no line discipline to change);
//     clack and readline still parse the bytes the test writes into keypresses
//     ("\r" is Enter, printable bytes are typed characters);
//   - stdout/stderr report a fixed 120x40 window;
//   - a tty.WriteStream opened on one of these piped descriptors works on every
//     platform. @clack/core opens `new tty.WriteStream(0)` as the sink of its
//     readline; libuv accepts a pipe for that on POSIX, but on Windows it opens
//     a tty only on a console handle and throws ERR_TTY_INIT_FAILED (EBADF) —
//     there the stream is a terminal-shaped Writable sink instead (clack
//     replaces its _write anyway). A real console still gets the real stream.
// The test answers each prompt only after its label appears on stdout, so no
// keypress is written before the prompt that reads it is listening.

import tty from 'node:tty';
import { Writable } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';

for (const stream of [process.stdin, process.stdout, process.stderr]) {
  stream.isTTY = true;
}
process.stdin.setRawMode = function setRawMode() {
  return this;
};
for (const stream of [process.stdout, process.stderr]) {
  stream.columns = 120;
  stream.rows = 40;
  stream.getWindowSize = () => [120, 40];
}

const RealWriteStream = tty.WriteStream;
/** tty.WriteStream, or — where the platform cannot open a tty on a pipe — a Writable standing in for it. */
function WriteStream(fd, ...rest) {
  try {
    return new RealWriteStream(fd, ...rest);
  } catch (err) {
    if (err?.code !== 'ERR_TTY_INIT_FAILED') throw err;
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    return Object.assign(sink, {
      fd,
      isTTY: true,
      columns: 120,
      rows: 40,
      getWindowSize: () => [120, 40],
      getColorDepth: () => 1,
      hasColors: () => false,
    });
  }
}
WriteStream.prototype = RealWriteStream.prototype;
tty.WriteStream = WriteStream;
// ESM named imports of node:tty (`import { WriteStream } from 'node:tty'`) see the patched export too.
syncBuiltinESMExports();
