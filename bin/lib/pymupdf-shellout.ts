// bin/lib/pymupdf-shellout.ts — RSCH-05b graceful-absent PyMuPDF subprocess wrapper.
//
// =====================================================================
//   Graceful-absent is the DESIGNED path (not an error case)
// =====================================================================
// `pymupdfShellout` attempts to extract higher-fidelity PDF text by shelling
// out to a Python interpreter and using the `fitz` (PyMuPDF) module. It is the
// fallback that `bin/lib/pdf-text.ts` reaches for ONLY when `pdf-parse` returns
// near-empty text (the image-only / scanned-PDF heuristic).
//
// On THIS build machine `python3 -c "import fitz"` FAILS (the wheel is
// pip-installed at 1.27.2.3 but unimportable under Python 3.13 — a binary
// compatibility issue). So the absent-fitz path is the one CI exercises every
// run. The contract is therefore: on ANY subprocess failure — python3 absent
// (ENOENT), `fitz` unimportable (non-zero exit), or a 15s timeout — this
// function returns `null` and NEVER throws. The caller treats `null` as
// "PyMuPDF unavailable" and degrades to the near-empty pdf-parse text + a WARN;
// the PDF source stays usable (Pitfall 5).
//
// =====================================================================
//   No shell-injection surface (T-08-03-01)
// =====================================================================
// We use `execFile` with an ARGS ARRAY — NOT a shell string — so there is no
// shell to interpret metacharacters in the first place. The only path that
// reaches the interpreter is an INTERNALLY-generated tmpfile path (never user
// input), and it is embedded into the Python `-c` script via `JSON.stringify`,
// so it arrives as a properly-quoted Python string literal with no metacharacter
// injection surface. The untrusted PDF BYTES go to disk (the tmpfile), never to
// the command line.
//
// =====================================================================
//   Resource hygiene (T-08-03-02 / T-08-03-06)
// =====================================================================
// - timeout 15s + maxBuffer 10MB bound a runaway/hung interpreter; either ->
//   caught -> null.
// - The tmpfile lives in os.tmpdir() with a random suffix and is ALWAYS unlinked
//   in a `finally` (unlink errors ignored) so PDF bytes do not leak to disk.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';

const execFileAsync = promisify(execFile);

/** Hard ceiling on the PyMuPDF subprocess; a hung interpreter is caught -> null. */
const PYMUPDF_TIMEOUT_MS = 15_000;

/** Cap on captured stdout so an adversarial PDF cannot exhaust memory. */
const PYMUPDF_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Resolve the Python interpreter to shell out to. `PENSMITH_PYTHON` lets tests
 * (and operators on exotic setups) override the default `python3`. Tests point
 * it at a nonexistent path to force the ENOENT/null degradation path.
 */
function pythonBin(): string {
  const override = process.env.PENSMITH_PYTHON;
  return typeof override === 'string' && override.length > 0 ? override : 'python3';
}

/**
 * Attempt a higher-fidelity PDF text extraction via the Python `fitz` (PyMuPDF)
 * module, used as a fallback when `pdf-parse` yields near-empty text.
 *
 * Contract:
 *   - Writes `buf` to an internally-generated tmpfile (never a user-supplied
 *     path), shells out to `<python> -c "import fitz; ..."` via execFile with an
 *     ARGS ARRAY, and returns the extracted text.
 *   - Returns `null` (NEVER throws) on ANY failure: interpreter absent (ENOENT),
 *     `import fitz` failing (non-zero exit), timeout, or empty output.
 *   - The tmpfile is ALWAYS unlinked in a `finally` (errors ignored).
 */
export async function pymupdfShellout(buf: Buffer): Promise<string | null> {
  // Internal tmpfile path — NOT derived from any user input (T-08-03-01).
  const tmp = path.join(
    os.tmpdir(),
    `pensmith-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  try {
    // Write the untrusted PDF bytes through the D-07 atomic-write chokepoint
    // (direct fs.writeFile is banned outside bin/lib/atomic-write.ts). The
    // tmpfile lands fully-written or not at all; fsync is irrelevant for an
    // ephemeral scratch file, so it stays on (cheap) rather than special-casing.
    await atomicWriteFile(tmp, buf);
    // The tmpfile path is JSON.stringify-embedded into the Python source so it
    // arrives as a quoted Python string literal — no shell, no metacharacters.
    const script = [
      'import sys, fitz',
      `doc = fitz.open(${JSON.stringify(tmp.replace(/\\/g, '/'))})`,
      'text = "".join(page.get_text() for page in doc)',
      'sys.stdout.write(text)',
    ].join('; ');
    const { stdout } = await execFileAsync(pythonBin(), ['-c', script], {
      timeout: PYMUPDF_TIMEOUT_MS,
      maxBuffer: PYMUPDF_MAX_BUFFER,
    });
    return typeof stdout === 'string' && stdout.length > 0 ? stdout : null;
  } catch {
    // ENOENT (interpreter absent), non-zero exit (fitz unimportable), or
    // timeout. Graceful degradation — the caller falls back to pdf-parse text.
    return null;
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}
