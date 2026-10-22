import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LedgerEvent } from '../core/types.js'

export interface ReadResult<T> {
  events: T[]
  /** Malformed tail lines that were dropped (a killed process can leave one). */
  skipped: number
}

/** The only fields the store needs; both the stock and futures ledgers satisfy it. */
export interface StoredLedgerEvent {
  seq: number
  type: string
}

/**
 * Append-only JSONL store. Every append is flushed with fsync.
 *
 * Generic over the event union so the stock and futures ledgers share the
 * atomic write/read/backup implementation without sharing an event schema.
 * The default parameter keeps every existing stock call site unchanged.
 */
export class EventStore<T extends StoredLedgerEvent = LedgerEvent> {
  constructor(private readonly file: string) {}

  /** Absolute path of the ledger file, for export and diagnostics. */
  get filePath(): string {
    return this.file
  }

  private async ensureDir(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
  }

  async append(events: readonly T[]): Promise<void> {
    if (events.length === 0) return
    await this.ensureDir()
    const payload = `${events.map(event => JSON.stringify(event)).join('\n')}\n`
    const handle = await open(this.file, 'a', 0o600)
    try {
      await handle.writeFile(payload, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async readAll(): Promise<ReadResult<T>> {
    let content: string
    try {
      content = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { events: [], skipped: 0 }
      throw error
    }
    const events: T[] = []
    let skipped = 0
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        const parsed = JSON.parse(trimmed) as T
        if (typeof parsed?.type === 'string' && typeof parsed?.seq === 'number') events.push(parsed)
        else skipped += 1
      } catch {
        skipped += 1
      }
    }
    return { events, skipped }
  }

  /**
   * Replace the whole file atomically: write a sibling temp file, fsync it and
   * rename over the target. A crash leaves either the old or the new ledger,
   * never a half-written one.
   */
  async replace(events: readonly T[]): Promise<void> {
    await this.ensureDir()
    const payload = events.length === 0 ? '' : `${events.map(event => JSON.stringify(event)).join('\n')}\n`
    const temp = `${this.file}.tmp-${process.pid}-${Date.now()}`
    try {
      const handle = await open(temp, 'w', 0o600)
      try {
        await handle.writeFile(payload, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temp, this.file)
    } catch (error) {
      await unlink(temp).catch(() => {})
      throw error
    }
  }

  /** Raw file text; `null` when the ledger has not been created yet. */
  async readText(): Promise<string | null> {
    try {
      return await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async backup(destination: string): Promise<boolean> {
    try {
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await copyFile(this.file, destination)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
}
