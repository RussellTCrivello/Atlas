// Exclusive ownership of a data directory: one Atlas server process at a time. SQLite would serialise two writers, but
// the application keeps per-process state (login throttling, queued audit events, sessions in flight), and two servers
// on one directory is always a configuration mistake. The lock file names the owner so the message can be specific.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type LockInfo, StoreLockedError } from './errors'

export const LOCK_FILE = 'atlas.lock'

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Take the lock, replacing a stale one (dead process, or a lock older than the last reboot). Returns the release function. */
export function acquireLock(dataDir: string): () => void {
  const file = path.join(dataDir, LOCK_FILE)
  const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const info: LockInfo = { pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), token }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify(info))
      fs.closeSync(fd)
      let released = false
      const release = () => {
        if (released) return
        released = true
        process.removeListener('exit', release)
        try {
          const current = JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo
          if (current.token === token) fs.unlinkSync(file)
        } catch {
          /* already gone */
        }
      }
      process.once('exit', release)
      return release
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let existing: LockInfo | null = null
      try {
        existing = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        /* unreadable lock: treat as stale */
      }
      const bootTime = Date.now() - os.uptime() * 1000
      const sameHost = !existing || existing.hostname === os.hostname()
      const stale =
        !existing ||
        !Number.isInteger(existing.pid) ||
        (sameHost && (existing.pid !== process.pid ? !processAlive(existing.pid) : false)) ||
        // The machine rebooted after the lock was written: whoever held it is gone (PIDs get reused).
        (sameHost && Date.parse(existing.startedAt) < bootTime - 120_000)
      if (!stale) {
        throw new StoreLockedError(
          `Another Atlas process (pid ${existing!.pid} on ${existing!.hostname}, started ${existing!.startedAt}) is already using ${dataDir}. ` +
            `Stop it first. If you are certain no Atlas process is running, delete ${file}.`,
          existing!
        )
      }
      try {
        fs.unlinkSync(file)
      } catch {
        /* lost a race; retry */
      }
    }
  }
  throw new StoreLockedError(`Could not acquire the lock file ${file}.`)
}
