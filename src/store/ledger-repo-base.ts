/**
 * Shared single-writer ledger repository.
 *
 * The stock and futures ledgers have the same persistence contract — one
 * append-only JSONL file, one Promise queue, contiguous `seq`, atomic replace,
 * daily snapshots and in-process restore — and differed only in how an event is
 * folded into their state. That common half lives here once; each plane supplies
 * a {@link LedgerPlane} adapter (replay/verify/summary) plus its own markPrices.
 *
 * Loading is also shared: malformed tails are dropped, duplicate sequences are
 * repaired, an inconsistent replay records a violation (which freezes the
 * account) instead of throwing, and a known older version may migrate in place.
 * @module @dsh-ft/dsh-fft-paper-trading/store/ledger-repo-base
 */

import { resolve } from 'node:path'
import { EventStore, readEventsFile, type StoredLedgerEvent } from './event-store.js'
import type { LedgerFile, LedgerSnapshot } from './port.js'
import { backupsDir, eventsPath } from './paths.js'
import {
  ensureAutoSnapshot,
  listSnapshotFiles,
  snapshotPath,
  writeSnapshot,
  type SnapshotFile,
} from './snapshots.js'

/** The parts of a ledger that the base class needs to inspect. */
export interface LedgerSummary {
  lastSeq: number
  tradeDate: string
  cashCents: number
  blocked: boolean
  blockedReason?: string
}

/**
 * How one plane folds its event log.
 *
 * `prepare` drops malformed/duplicate entries and reports what it saw;
 * `replay` then rebuilds the state from the tolerant event list.
 */
export interface LedgerPlane<S, E extends StoredLedgerEvent> {
  /** Log prefix, e.g. `paper-trading` or `paper-trading: futures`. */
  label: string
  /** Events a reset writes; used to validate a replacement. */
  prepare: (events: E[]) => { events: E[]; issues: string[]; duplicates: number }
  replay: (events: E[], accountId: string) => { state: S; issues: string[] }
  applyEvent: (state: S, event: E) => S
  verify: (state: S) => string[]
  summary: (state: S) => LedgerSummary
  ledgerVersion: (events: readonly E[]) => number
  /**
   * When the account is blocked, drop planned writes (stock) or hand them back
   * (futures) — the latter only affects an internal caller and is kept for
   * behavior compatibility.
   */
  dropEventsWhenBlocked: boolean
}

/** One queued write: events to append plus the value the caller asked for. */
export interface LedgerTransaction<T, E> {
  events: E[]
  value: T
}

export interface LedgerTransactionOutcome<S, T, E> {
  state: S
  value: T
  /** Events that actually reached the file; empty when the store refused. */
  events: E[]
}

export interface LedgerRepoOptions {
  home: string
  accountId: string
  logger?: { warn(message: string): void }
}

export class LedgerRepoBase<S, E extends StoredLedgerEvent> {
  protected readonly store: EventStore<E>
  protected state: S | undefined
  protected loading: Promise<S> | undefined
  protected queue: Promise<unknown> = Promise.resolve()

  constructor(
    protected readonly plane: LedgerPlane<S, E>,
    protected readonly options: LedgerRepoOptions,
  ) {
    this.store = new EventStore<E>(eventsPath(options.home, options.accountId))
  }

  /** Absolute path of `events.jsonl`, surfaced so a locked account is fixable. */
  get ledgerPath(): string {
    return this.store.filePath
  }

  protected backups(): string {
    return backupsDir(this.options.home, this.options.accountId)
  }

  /** Serialise writes the same way the ledger does; a failed task cannot poison the queue. */
  protected enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  protected async ensureLoaded(): Promise<S> {
    if (this.state !== undefined) return this.state
    if (this.loading === undefined) this.loading = this.loadOnce()
    return this.loading
  }

  private async loadOnce(): Promise<S> {
    const { events, skipped } = await this.store.readAll()
    if (skipped > 0) this.warn(`dropped ${skipped} malformed ledger line(s)`)

    const prepared = this.plane.prepare(events)
    // Conflicting same-seq events are real corruption: replay the original file
    // untouched so the violation reports what is actually there.
    const source = prepared.issues.length > 0 ? events : prepared.events
    const migrated = prepared.issues.length === 0 ? await this.tryMigrate(prepared.events) : undefined
    if (migrated !== undefined) {
      this.state = migrated
    } else {
      const result = this.plane.replay(source, this.options.accountId)
      this.state = result.state
      const issues = [...prepared.issues, ...result.issues]
      if (issues.length > 0 && !this.plane.summary(result.state).blocked) {
        await this.recordViolation(issues)
      } else if (prepared.issues.length === 0 && prepared.duplicates > 0) {
        this.state = await this.compact(prepared)
      }
    }
    // A known-good copy from before this session is what recovery falls back on;
    // it is deliberately skipped for a blocked ledger (that file is evidence).
    if (!this.plane.summary(this.state).blocked) {
      await ensureAutoSnapshot(this.store, this.backups(), { logger: this.options.logger })
    }
    return this.state
  }

  /** Planes with a migration chain override this; the default has none. */
  protected async tryMigrate(_events: E[]): Promise<S | undefined> {
    return undefined
  }

  private async compact(prepared: { events: E[]; duplicates: number }): Promise<S> {
    const state = this.state as S
    const seq = this.plane.summary(state).lastSeq + 1
    const event = {
      seq,
      id: `evt-${seq}`,
      ts: new Date().toISOString(),
      type: 'ledger.repaired',
      payload: { dropped: prepared.duplicates },
    } as unknown as E
    try {
      await writeSnapshot(this.store, this.backups(), 'repair')
      await this.store.replace([...prepared.events, event])
      this.plane.applyEvent(state, event)
      this.warn(`dropped ${prepared.duplicates} duplicate ledger event(s)`)
    } catch (error) {
      this.warn(`ledger repair failed, kept in memory only: ${String(error)}`)
    }
    return state
  }

  private async recordViolation(issues: string[]): Promise<void> {
    const state = this.state
    if (state === undefined || this.plane.summary(state).blocked) return
    const seq = this.plane.summary(state).lastSeq + 1
    const event = {
      seq,
      id: `evt-${seq}`,
      ts: new Date().toISOString(),
      type: 'ledger.violation',
      payload: { check: 'replay', expected: 'consistent', actual: issues.join('; ') },
    } as unknown as E
    await this.store.append([event])
    this.plane.applyEvent(state, event)
    this.state = state
    this.warn(`ledger violation, account blocked: ${issues.join('; ')}`)
  }

  private warn(message: string): void {
    this.options.logger?.warn(`${this.plane.label}: ${message}`)
  }

  async current(): Promise<S> {
    return this.ensureLoaded()
  }

  async transact<T>(build: (state: S) => LedgerTransaction<T, E> | Promise<LedgerTransaction<T, E>>): Promise<LedgerTransactionOutcome<S, T, E>> {
    return this.enqueue(async () => {
      const state = await this.ensureLoaded()
      const built = await build(state)
      const events = built.events
      if (events.length === 0) return { state, value: built.value, events }
      if (this.plane.summary(state).blocked) {
        this.warn(`account blocked, dropped ${events.length} event(s)`)
        return { state, value: built.value, events: this.plane.dropEventsWhenBlocked ? [] : events }
      }
      this.assertSequence(state, events)
      await this.store.append(events)
      for (const event of events) this.plane.applyEvent(state, event)
      const issues = this.plane.verify(state)
      this.state = state
      if (issues.length > 0) await this.recordViolation(issues)
      return { state: this.state ?? state, value: built.value, events }
    })
  }

  async append(events: readonly E[]): Promise<S> {
    const outcome = await this.transact(() => ({ events: [...events], value: undefined }))
    return outcome.state
  }

  /**
   * Replace the file with a new ledger (reset, compaction).
   *
   * The replacement is validated and replayed before the atomic rename, so a
   * reset never leaves a ledger that would lock the account on the next start.
   */
  async replace(events: readonly E[]): Promise<S> {
    return this.enqueue(async () => {
      this.assertSequence(undefined, events)
      const result = this.plane.replay([...events], this.options.accountId)
      if (result.issues.length > 0) {
        throw new Error(`${this.plane.label}: refusing an inconsistent ledger: ${result.issues.join('; ')}`)
      }
      // Settle any in-flight load first: it may still repair or block the old file.
      await this.ensureLoaded()
      await this.store.replace(events)
      this.state = result.state
      this.loading = Promise.resolve(result.state)
      return this.state
    })
  }

  /** Copy the event file into `backups/`, named after the reset timestamp. */
  async backup(label: string): Promise<boolean> {
    return this.enqueue(async () => {
      const stamp = label.replace(/[:.]/g, '-')
      return this.store.backup(`${this.backups()}/events-${stamp}.jsonl`)
    })
  }

  /** Raw file text for the export endpoint; `content: null` means "not created yet". */
  async readLedger(): Promise<LedgerFile> {
    return { path: resolve(this.store.filePath), content: await this.store.readText() }
  }

  /** List snapshots with replay metadata, newest first. */
  async snapshots(): Promise<LedgerSnapshot[]> {
    const files = await listSnapshotFiles(this.backups())
    const snapshots: LedgerSnapshot[] = []
    for (const file of files) snapshots.push(await this.inspectSnapshot(file))
    return snapshots
  }

  protected async inspectSnapshot(file: SnapshotFile): Promise<LedgerSnapshot> {
    const base = {
      name: file.name,
      createdAt: new Date(file.mtimeMs).toISOString(),
      bytes: file.bytes,
    }
    try {
      const { events, skipped } = await readEventsFile<E>(file.path)
      const prepared = this.plane.prepare(events)
      const source = prepared.issues.length > 0 ? events : prepared.events
      const result = this.plane.replay(source, this.options.accountId)
      const issues = [...prepared.issues, ...result.issues]
      if (skipped > 0) issues.push(`含 ${skipped} 行无法解析`)
      const summary = this.plane.summary(result.state)
      return {
        ...base,
        ledgerVersion: this.plane.ledgerVersion(source),
        lastSeq: summary.lastSeq,
        tradeDate: summary.tradeDate,
        cashCents: summary.cashCents,
        valid: issues.length === 0 && !summary.blocked,
        migratable: false,
        problem: issues[0] ?? (summary.blocked ? summary.blockedReason : undefined),
      }
    } catch (error) {
      return {
        ...base,
        ledgerVersion: 0,
        lastSeq: 0,
        tradeDate: '',
        cashCents: 0,
        valid: false,
        migratable: false,
        problem: String(error),
      }
    }
  }

  /**
   * Replace the live ledger with one snapshot.
   *
   * Allowed while blocked; validated before the live file is touched, and the
   * current file is snapshotted first so the recovery can be undone.
   */
  async restore(name: string): Promise<S> {
    const file = snapshotPath(this.backups(), name)
    return this.enqueue(async () => {
      await this.ensureLoaded().catch(() => undefined)
      const { events, skipped } = await readEventsFile<E>(file)
      if (events.length === 0 && skipped === 0) throw new Error(`快照 ${name} 是空的`)
      if (skipped > 0) throw new Error(`快照 ${name} 含 ${skipped} 行无法解析，拒绝恢复`)
      const prepared = this.plane.prepare(events)
      if (prepared.issues.length > 0) throw new Error(`快照 ${name} 结构损坏：${prepared.issues.join('; ')}`)
      const result = this.plane.replay(prepared.events, this.options.accountId)
      if (result.issues.length > 0) throw new Error(`快照 ${name} 对账失败：${result.issues.join('; ')}`)
      const summary = this.plane.summary(result.state)
      if (summary.blocked) throw new Error(`快照 ${name} 无法恢复：${summary.blockedReason ?? '版本不兼容'}`)
      await writeSnapshot(this.store, this.backups(), 'pre-restore')
      await this.store.replace(prepared.events)
      this.state = result.state
      this.loading = Promise.resolve(result.state)
      return this.state
    })
  }

  protected assertSequence(state: S | undefined, events: readonly E[]): void {
    let expected = (state === undefined ? 0 : this.plane.summary(state).lastSeq) + 1
    for (const event of events) {
      if (!Number.isInteger(event.seq) || event.seq !== expected) {
        throw new Error(`${this.plane.label}: ledger seq mismatch: expected ${expected}, got ${String(event.seq)}`)
      }
      expected += 1
    }
  }
}
