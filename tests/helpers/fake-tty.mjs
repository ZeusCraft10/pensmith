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
//   - stdout/stderr report a fixed 120x40 window.
// The test answers each prompt only after its label appears on stdout, so no
// keypress is written before the prompt that reads it is listening.

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
