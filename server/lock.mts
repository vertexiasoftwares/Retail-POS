import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, basename, resolve } from 'node:path'

export interface LockMetadata {
  pid: number
  startedAt: string
  host: string
  port: number
}

export interface DatabaseLock {
  lockPath: string
  release: () => void
}

const activeProcessLocks = new Set<string>()

/**
 * Acquires a process lock on the database to ensure only one server instance
 * runs against the database file at any time.
 */
export function acquireDatabaseLock(databasePath: string, host = '0.0.0.0', port = 8080): DatabaseLock {
  if (databasePath === ':memory:') {
    return { lockPath: ':memory:', release: () => {} }
  }

  const normalizedDbPath = resolve(databasePath).toLowerCase()
  if (activeProcessLocks.has(normalizedDbPath)) {
    throw new Error(
      `Database is locked by another running Vertexia POS server instance in this process. ` +
      `Stop the existing server before starting a new one.`
    )
  }

  const dir = dirname(databasePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const lockFileName = `${basename(databasePath)}.server.lock`
  const lockPath = join(dir, lockFileName)

  if (existsSync(lockPath)) {
    try {
      const content = readFileSync(lockPath, 'utf8')
      const metadata = JSON.parse(content) as LockMetadata
      const pid = metadata.pid

      // Check if process is still running
      let isRunning = false
      try {
        process.kill(pid, 0)
        isRunning = true
      } catch (err: unknown) {
        const error = err as { code?: string }
        if (error.code === 'EPERM') {
          // Process exists but no permission to signal it
          isRunning = true
        } else {
          // ESRCH means process does not exist
          isRunning = false
        }
      }

      if (isRunning && pid !== process.pid) {
        throw new Error(
          `Database is locked by another running Vertexia POS server instance (PID: ${pid}, Port: ${metadata.port}, Started: ${metadata.startedAt}). ` +
          `Stop the existing server before starting a new one.`
        )
      }

      // If process is dead, remove stale lockfile
      try {
        unlinkSync(lockPath)
      } catch {}
    } catch (err: unknown) {
      const error = err as Error
      if (error.message.includes('Database is locked')) {
        throw error
      }
      // Stale or corrupted lock file, proceed to overwrite
    }
  }

  const metadata: LockMetadata = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host,
    port,
  }

  writeFileSync(lockPath, JSON.stringify(metadata, null, 2), { flag: 'w', encoding: 'utf8' })
  activeProcessLocks.add(normalizedDbPath)

  let released = false
  const release = () => {
    if (released) return
    released = true
    activeProcessLocks.delete(normalizedDbPath)
    try {
      if (existsSync(lockPath)) {
        const content = readFileSync(lockPath, 'utf8')
        const currentMeta = JSON.parse(content) as LockMetadata
        if (currentMeta.pid === process.pid) {
          unlinkSync(lockPath)
        }
      }
    } catch {}
  }

  return { lockPath, release }
}
