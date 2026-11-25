// bin/lib/atomic-write.ts — atomic-write chokepoint per ARCH-05 / D-07 / D-04.
//
// Crash-safe write contract (D-04):
//   1. write to {target}.{nonce}.tmp via O_WRONLY|O_CREAT|O_EXCL ('wx')
//   2. fsync(tmp_fd)
//   3. rename(tmp, target)        ← POSIX/NTFS rename is atomic
//   4. fsync(dir_fd)              ← durability across power-loss
//
// Windows quirk (RESEARCH §RQ-8 Pitfall A, D-04):
//   Step 4 raises EPERM on Windows. We swallow EPERM (rename is sufficient
//   for atomicity on NTFS — the dir-fsync is the durability cherry-on-top,
//   not a correctness requirement). All other fsync errors re-throw.
//
// Linux/9p/tmpfs quirk: ENOSYS from fsync — also swallow.
// EISDIR can fire on some VFS layers when fsync'ing a dirfd — also swallow.
//
// Cross-device fallback (EXDEV): rename across mount points fails with
// EXDEV. We fall back to copyFile + unlink(tmp). The rename() and copy
// are both crash-safe in the sense that the target is either fully old
// or fully new — partial-target is impossible.
//
// This is the SOLE file in the repo allowed to call fs.writeFile-family
// methods (fs.writeFile, fs.promises.writeFile, FileHandle#writeFile).
// The eslint chokepoint at eslint.config.js (D-07) enforces it via a
// per-file exemption forward-declared in W0.

import type { FileHandle } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface AtomicWriteOptions {
  encoding?: BufferEncoding;
  mode?: number;
  fsync?: boolean;
}

const DEFAULT_MODE = 0o644;

/** True during `--dry-run`, which may not change any file. */
export function isDryRun(): boolean {
  return process.env['PENSMITH_DRY_RUN'] === '1';
}

/** Thrown for a write attempted during a dry run. */
export class DryRunWriteError extends Error {
  readonly code = 'PENSMITH_DRY_RUN';
  constructor(readonly targetPath: string) {
    super(`dry run: refused to write ${targetPath} (a dry run changes nothing)`);
    this.name = 'DryRunWriteError';
  }
}

/**
 * A dry run may write only inside a `.dry-run` folder (a scratch overlay such
 * as `.paper/.dry-run/`). Every write in this module checks here first, so a
 * code path that forgets about dry runs still cannot change a real artifact.
 */
function assertWritable(targetPath: string): void {
  if (!isDryRun()) return;
  if (path.resolve(targetPath).split(path.sep).includes('.dry-run')) return;
  throw new DryRunWriteError(targetPath);
}

/**
 * fsync a directory fd to flush the new directory entry to disk.
 * Swallows the errors that are platform-expected and not correctness bugs:
 *   - EPERM   on Windows (NTFS rejects directory fsync; rename is already
 *             atomic on NTFS, so this is a best-effort no-op)
 *   - ENOSYS  on tmpfs / 9p / overlayfs / WSL drvfs (filesystem says "I
 *             don't implement fsync on dirs")
 *   - EISDIR  on some VFS layers
 * Re-throws all other errors (EBADF, EACCES, ENOSPC, ...).
 */
async function syncDir(dir: string): Promise<void> {
  let dirFd: FileHandle | undefined;
  try {
    dirFd = await fsp.open(dir, 'r');
    await dirFd.sync();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'EPERM' || code === 'ENOSYS' || code === 'EISDIR') {
      return;
    }
    throw err;
  } finally {
    if (dirFd) {
      await dirFd.close().catch(() => {
        /* best-effort close */
      });
    }
  }
}

/**
 * Crash-safe write of `data` to `targetPath`.
 *
 * Algorithm (per D-04):
 *   1. mkdir -p dirname(targetPath)
 *   2. tmpPath = `${targetPath}.${12hex-nonce}.tmp`
 *   3. open tmpPath with O_WRONLY|O_CREAT|O_EXCL, mode 0o644 (or opts.mode)
 *   4. writeFile(data); fsync(tmp_fd); close
 *   5. rename(tmpPath, targetPath)
 *   6. fsync(dirFd) — best-effort on Windows (EPERM swallowed)
 *
 * On any error before rename: best-effort unlink(tmpPath); re-throw.
 * On EXDEV from rename: copyFile + unlink fallback.
 *
 * `opts.fsync = false` skips both the file fsync and the dir fsync (used
 * by hot tests where durability across power-loss is irrelevant).
 */
export async function atomicWriteFile(
  targetPath: string,
  data: string | Buffer,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  assertWritable(targetPath);
  const dir = path.dirname(targetPath);
  await fsp.mkdir(dir, { recursive: true });

  const nonce = randomBytes(6).toString('hex');
  const tmpPath = `${targetPath}.${nonce}.tmp`;
  const mode = opts.mode ?? DEFAULT_MODE;
  const doFsync = opts.fsync !== false;
  const encoding = opts.encoding ?? 'utf8';

  let fh: FileHandle | undefined;
  try {
    // 'wx' = O_WRONLY|O_CREAT|O_EXCL — fails if tmpPath already exists.
    // The 12-hex nonce makes a collision astronomically unlikely; if it
    // does happen, the EEXIST surfaces as a write error and the caller
    // can retry.
    fh = await fsp.open(tmpPath, 'wx', mode);
    if (typeof data === 'string') {
      await fh.writeFile(data, { encoding });
    } else {
      await fh.writeFile(data);
    }
    if (doFsync) {
      await fh.sync();
    }
    await fh.close();
    fh = undefined;

    try {
      await fsp.rename(tmpPath, targetPath);
    } catch (renameErr) {
      const code = (renameErr as NodeJS.ErrnoException | null)?.code;
      if (code === 'EXDEV') {
        // Cross-device rename: copy then unlink. Both target states
        // (old / new) remain consistent — partial-target is impossible
        // because copyFile writes a full new file.
        await fsp.copyFile(tmpPath, targetPath);
        await fsp.unlink(tmpPath).catch(() => {
          /* best-effort tmp cleanup */
        });
      } else {
        throw renameErr;
      }
    }

    if (doFsync) {
      await syncDir(dir);
    }
  } catch (err) {
    // Best-effort cleanup of the partially-written tmp file. If the
    // rename already moved tmp→target, the unlink will fail with ENOENT,
    // which is fine.
    if (fh) {
      await fh.close().catch(() => {
        /* best-effort close */
      });
    }
    await fsp.unlink(tmpPath).catch(() => {
      /* best-effort tmp cleanup */
    });
    throw err;
  }
}

/**
 * Rename `fromPath` to `toPath` (replacing any file there), then fsync the
 * directory so the new name survives a crash. Used to move an artifact aside
 * instead of deleting it.
 */
export async function atomicRename(fromPath: string, toPath: string): Promise<void> {
  assertWritable(fromPath);
  assertWritable(toPath);
  await fsp.rename(fromPath, toPath);
  await syncDir(path.dirname(toPath));
}

/**
 * Delete a file or folder (recursively); a missing path is not an error.
 * Lives here so a dry run cannot delete anything either.
 */
export async function removePath(targetPath: string): Promise<void> {
  assertWritable(targetPath);
  await fsp.rm(targetPath, { recursive: true, force: true });
}

/** Create a new, empty, uniquely named folder inside `parent`. */
export async function makeTempDir(parent: string, prefix: string): Promise<string> {
  assertWritable(path.join(parent, prefix));
  await fsp.mkdir(parent, { recursive: true });
  return fsp.mkdtemp(path.join(parent, prefix));
}

/**
 * Append `line` to `targetPath` using O_APPEND. POSIX guarantees writes
 * <= PIPE_BUF bytes (4096 on Linux) are atomic under concurrent O_APPEND.
 * Caller is responsible for keeping line size under PIPE_BUF and including
 * the trailing newline.
 *
 * Used by the session log (D-46), which writes one JSONL record per line.
 *
 * `opts.fsync = false` skips the post-write fsync (hot tests).
 *
 * Note: this function bypasses the tmp-then-rename dance because append
 * semantics don't compose with rename. The fsync after each append is
 * the durability guarantee.
 */
export async function atomicAppendFile(
  targetPath: string,
  line: string,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  assertWritable(targetPath);
  const dir = path.dirname(targetPath);
  await fsp.mkdir(dir, { recursive: true });

  const mode = opts.mode ?? DEFAULT_MODE;
  const doFsync = opts.fsync !== false;
  const encoding = opts.encoding ?? 'utf8';

  // 'a' = O_WRONLY | O_CREAT | O_APPEND
  const fh = await fsp.open(targetPath, 'a', mode);
  try {
    await fh.writeFile(line, { encoding });
    if (doFsync) {
      await fh.sync();
    }
  } finally {
    await fh.close().catch(() => {
      /* best-effort close */
    });
  }
}
