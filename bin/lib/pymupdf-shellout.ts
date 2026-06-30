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
 * Candidate Python interpreters to try, in order. `PENSMITH_PYTHON` (when set)
 * is the SOLE candidate — tests point it at a nonexistent path to force the
 * ENOENT/null degradation path; operators on exotic setups use it to pin one.
 *
 * Without an override we try the common interpreter names (audit #37): on
 * Windows `python3` is usually absent and the real interpreter is `python` or
 * the `py` launcher, so Windows tries those FIRST. The previous hardcoded
 * `python3` meant the PyMuPDF fallback never ran on a standard Windows install.
 */
export function pythonCandidates(): string[] {
  const override = process.env.PENSMITH_PYTHON;
  if (typeof override === 'string' && override.length > 0) return [override];
  return process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
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
    // Try each candidate interpreter in order; the first that runs AND has
    // `fitz` wins (audit #37). An absent interpreter (ENOENT), one without fitz
    // (non-zero exit), or a timeout just advances to the next candidate. If none
    // succeed the loop falls through to null — graceful degradation, the caller
    // falls back to pdf-parse text.
    for (const bin of pythonCandidates()) {
      try {
        const { stdout } = await execFileAsync(bin, ['-c', script], {
          timeout: PYMUPDF_TIMEOUT_MS,
          maxBuffer: PYMUPDF_MAX_BUFFER,
        });
        if (typeof stdout === 'string' && stdout.length > 0) return stdout;
      } catch {
        // This interpreter is absent or lacks fitz — try the next candidate.
      }
    }
    return null;
  } catch {
    // A failure OUTSIDE the per-interpreter loop (e.g. the tmpfile write).
    return null;
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}
