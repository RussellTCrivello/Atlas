import fs from 'node:fs'
import path from 'node:path'

export function fsyncDirectory(dir: string): void {
  // Directory fsync makes a rename durable on POSIX. Windows cannot open directories; ignore failures there.
  try {
    const fd = fs.openSync(dir, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    /* best effort */
  }
}

/**
 * Crash-safe replacement of a file: write a temp file in the same directory, fsync it, rename it over the target,
 * then fsync the directory. A reader (or a crash) can only ever observe the old complete file or the new one.
 */
export function atomicWriteFileSync(file: string, data: string | Buffer, mode = 0o600): void {
  const dir = path.dirname(file)
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}.tmp`)
  let fd: number | undefined
  try {
    fd = fs.openSync(tmp, 'wx', mode)
    fs.writeFileSync(fd, data)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmp, file)
    fsyncDirectory(dir)
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw error
  }
}

export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    /* not supported on this platform/filesystem */
  }
}
