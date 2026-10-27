import { readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { EventStore, StoredLedgerEvent } from './event-store.js'

/**
 * Ledger snapshots live next to the event file.
 *
 * There is deliberately no manifest: the file name carries the reason and the
 * timestamp, the mtime carries the age, and the content is the ledger itself.
 * A snapshot list is therefore always in sync with the directory, even when a
 * human (or an agent) copies a file in by hand.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/store/snapshots
 */

export interface SnapshotFile {
  name: string
  path: string
  bytes: number
  mtimeMs: number
}

/** `events-<reason>-<stamp>.jsonl`; the legacy names (`events-<stamp>.jsonl`) also match. */
const SNAPSHOT_NAME = /^events-[A-Za-z0-9._-]+\.jsonl$/
export const AUTO_SNAPSHOT_PREFIX = 'events-auto-'
export const PRE_MIGRATE_PREFIX = 'events-pre-migrate-'
export const PRE_RESTORE_PREFIX = 'events-pre-restore-'
export const MANUAL_PREFIX = 'events-manual-'

/** Keep only this many automatic snapshots; reset/repair/pre-* files are never pruned. */
const KEEP_AUTO = 10
/** One automatic snapshot per day is enough to lose at most one session. */
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000

/** File-name safe UTC stamp: `2026-10-27T08-00-00-000Z`. */
export function snapshotStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

export function isSnapshotName(name: string): boolean {
  return SNAPSHOT_NAME.test(name)
}

/**
 * Resolve a snapshot name inside `dir`.
 *
 * Only a bare file name is accepted: the restore endpoint is reachable from an
 * agent, so `../events.jsonl` or an absolute path must fail here and not depend
 * on the caller being careful.
 */
export function snapshotPath(dir: string, name: string): string {
  if (basename(name) !== name || !isSnapshotName(name)) {
    throw new Error(`不是合法的账本快照名：${name}`)
  }
  return join(dir, name)
}

/** Every `.jsonl` snapshot in the directory, newest first. */
export async function listSnapshotFiles(dir: string): Promise<SnapshotFile[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: SnapshotFile[] = []
  for (const name of names) {
    if (!isSnapshotName(name)) continue
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (!info.isFile()) continue
      files.push({ name, path, bytes: info.size, mtimeMs: info.mtimeMs })
    } catch {
      // A snapshot removed between readdir and stat is simply gone.
    }
  }
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs)
}

/**
 * Copy the current ledger into `dir` under a reasoned name.
 *
 * Returns the new file's name, or `undefined` when there is no ledger yet.
 * Errors propagate: a destructive caller (reset) must fail instead of
 * continuing without the backup.
 */
export async function writeSnapshot<T extends StoredLedgerEvent>(
  store: EventStore<T>,
  dir: string,
  reason: string,
  now = new Date(),
): Promise<string | undefined> {
  const name = `events-${reason}-${snapshotStamp(now)}.jsonl`
  const copied = await store.backup(join(dir, name))
  return copied ? name : undefined
}

/**
 * Snapshot the ledger at most once per interval.
 *
 * Called after a successful (unblocked) load, so the account always has a
 * recent known-good copy even when corruption is written mid-session by a bug.
 * Never throws: a failed snapshot must not stop the account from loading.
 */
export async function ensureAutoSnapshot<T extends StoredLedgerEvent>(
  store: EventStore<T>,
  dir: string,
  options: { now?: Date; logger?: { warn(message: string): void } } = {},
): Promise<string | undefined> {
  try {
    if (!(await store.exists())) return undefined
    const now = options.now ?? new Date()
    const auto = (await listSnapshotFiles(dir))
      .filter(file => file.name.startsWith(AUTO_SNAPSHOT_PREFIX))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
    if (auto[0] !== undefined && now.getTime() - auto[0].mtimeMs < AUTO_INTERVAL_MS) return undefined
    const name = await writeSnapshot(store, dir, 'auto', now)
    if (name === undefined) return undefined
    await pruneAutoSnapshots(dir, options.logger)
    return name
  } catch (error) {
    options.logger?.warn(`paper-trading: automatic ledger snapshot failed: ${String(error)}`)
    return undefined
  }
}

/** Delete old automatic snapshots; never touch any other reason. */
async function pruneAutoSnapshots(dir: string, logger?: { warn(message: string): void }): Promise<void> {
  const auto = (await listSnapshotFiles(dir))
    .filter(file => file.name.startsWith(AUTO_SNAPSHOT_PREFIX))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
  for (const file of auto.slice(KEEP_AUTO)) {
    try {
      await rm(file.path)
    } catch (error) {
      logger?.warn(`paper-trading: could not prune snapshot ${file.name}: ${String(error)}`)
    }
  }
}
