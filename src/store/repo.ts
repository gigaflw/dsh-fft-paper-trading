import { join, resolve } from 'node:path'
import type { Quote } from '../contract.js'
import { applyEvent, emptyState, verify } from '../core/ledger.js'
import { migrateLedger, ledgerVersionOf, MigrationUnavailable } from '../core/migrations.js'
import { prepareLedger, replay, type PreparedLedger } from '../core/replay.js'
import type { AccountState, LedgerEvent } from '../core/types.js'
import { EventStore, readEventsFile } from './event-store.js'
import type { AccountStore, LedgerFile, LedgerSnapshot, Transaction, TransactionOutcome } from './port.js'
import { backupsDir, eventsPath } from './paths.js'
import {
  ensureAutoSnapshot,
  listSnapshotFiles,
  snapshotPath,
  writeSnapshot,
  type SnapshotFile,
} from './snapshots.js'

export interface RepoOptions {
  home: string
  accountId: string
  logger?: { warn(message: string): void }
}

/**
 * Loads, replays and appends the single account ledger.
 *
 * Every write goes through one Promise queue and one sequence invariant, so a
 * concurrent read cannot duplicate a day-boundary event. Repairs and resets use
 * an atomic file replacement; a rejected write never touches the file.
 *
 * Recovery is a first-class path: a ledger from a known older version is
 * migrated in place (snapshot first), and any snapshot can be restored into the
 * running process without restarting the host.
 */
export class AccountRepo implements AccountStore {
  private readonly store: EventStore
  private state: AccountState | undefined
  private loading: Promise<AccountState> | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: RepoOptions) {
    this.store = new EventStore(eventsPath(options.home, options.accountId))
  }

  /** Absolute path of `events.jsonl`, surfaced so a locked account is fixable. */
  get ledgerPath(): string {
    return this.store.filePath
  }

  private backups(): string {
    return backupsDir(this.options.home, this.options.accountId)
  }

  private async ensureLoaded(): Promise<AccountState> {
    if (this.state !== undefined) return this.state
    if (this.loading === undefined) this.loading = this.loadOnce()
    return this.loading
  }

  private async loadOnce(): Promise<AccountState> {
    const { events, skipped } = await this.store.readAll()
    if (skipped > 0) this.options.logger?.warn(`paper-trading: dropped ${skipped} malformed ledger line(s)`)

    const prepared = prepareLedger(events)
    // Conflicting same-seq events are real corruption: replay the original file
    // untouched so the violation reports what is actually there.
    const source = prepared.issues.length > 0 ? events : prepared.events

    // A known older version is rewritten instead of locking: the account keeps
    // its history. `undefined` means "already current" or "no migration path";
    // only the latter locks, and replay below records the reason.
    const migrated = prepared.issues.length === 0 ? await this.tryMigrate(prepared.events) : undefined
    if (migrated !== undefined) {
      this.state = migrated
    } else {
      const result = replay(source, this.options.accountId)
      this.state = result.state
      const issues = [...prepared.issues, ...result.issues]
      if (issues.length > 0 && !result.state.blocked) {
        await this.recordViolation(issues)
      } else if (prepared.issues.length === 0 && prepared.duplicates > 0) {
        this.state = await this.compact(prepared, result.state)
      }
    }

    // A known-good copy from before this session is what recovery has to fall
    // back on; it is deliberately skipped for a blocked ledger (that file is the
    // evidence, not the backup).
    if (!this.state.blocked) {
      await ensureAutoSnapshot(this.store, this.backups(), { logger: this.options.logger })
    }
    return this.state
  }

  /**
   * Rewrite a ledger from a known older version into the current one.
   *
   * The snapshot is taken before the replacement; a failed validation keeps the
   * original file byte for byte, and returning `undefined` lets the normal
   * replay path lock the account with the version reason.
   */
  private async tryMigrate(events: LedgerEvent[]): Promise<AccountState | undefined> {
    let outcome
    try {
      outcome = migrateLedger(events)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.options.logger?.warn(`paper-trading: ledger migration refused: ${reason}`)
      return undefined
    }
    if (outcome === undefined) return undefined
    const marker = this.marker(outcome.from, outcome.to, events[events.length - 1]?.seq ?? 0)
    const next = [...outcome.events, marker]
    const result = replay(next, this.options.accountId)
    if (result.issues.length > 0 || result.state.blocked) {
      this.options.logger?.warn(`paper-trading: migrated ledger failed validation: ${[...result.issues, result.state.blockedReason ?? ''].join('; ')}`)
      return undefined
    }
    try {
      await writeSnapshot(this.store, this.backups(), 'pre-migrate')
      await this.store.replace(next)
    } catch (error) {
      this.options.logger?.warn(`paper-trading: ledger migration could not be written, keeping the old file: ${String(error)}`)
      return undefined
    }
    this.options.logger?.warn(`paper-trading: ledger migrated v${outcome.from} → v${outcome.to}`)
    return result.state
  }

  private marker(from: number, to: number, previousSeq: number): LedgerEvent {
    const seq = previousSeq + 1
    return {
      seq,
      id: `evt-${seq}`,
      ts: new Date().toISOString(),
      type: 'ledger.migrated',
      payload: { from, to },
    }
  }

  /**
   * Drop repeated events from the file and leave one `ledger.repaired` marker.
   *
   * Only reached when every duplicate was byte-equivalent apart from its
   * `recordedAt` stamp, so the account values themselves are untouched.
   */
  private async compact(prepared: PreparedLedger, state: AccountState): Promise<AccountState> {
    const seq = state.lastSeq + 1
    const event: LedgerEvent = {
      seq,
      id: `evt-${seq}`,
      ts: new Date().toISOString(),
      type: 'ledger.repaired',
      payload: { dropped: prepared.duplicates },
    }
    try {
      await writeSnapshot(this.store, this.backups(), 'repair')
      await this.store.replace([...prepared.events, event])
      applyEvent(state, event)
      this.options.logger?.warn(`paper-trading: dropped ${prepared.duplicates} duplicate ledger event(s)`)
    } catch (error) {
      this.options.logger?.warn(`paper-trading: ledger repair failed, kept in memory only: ${String(error)}`)
    }
    return state
  }

  private async recordViolation(issues: string[]): Promise<void> {
    const state = this.state
    // A blocked account never grows its ledger: a new violation per tick would
    // bury the original evidence under thousands of identical events.
    if (state === undefined || state.blocked) return
    const seq = state.lastSeq + 1
    const event: LedgerEvent = {
      seq,
      id: `evt-${seq}`,
      ts: new Date().toISOString(),
      type: 'ledger.violation',
      payload: { check: 'replay', expected: 'consistent', actual: issues.join('; ') },
    }
    await this.store.append([event])
    applyEvent(state, event)
    this.state = state
    this.options.logger?.warn(`paper-trading: ledger violation, account blocked: ${issues.join('; ')}`)
  }

  async current(): Promise<AccountState> {
    return this.ensureLoaded()
  }

  async transact<T>(build: (state: AccountState) => Transaction<T> | Promise<Transaction<T>>): Promise<TransactionOutcome<T>> {
    return this.enqueue(async () => {
      const state = await this.ensureLoaded()
      const built = await build(state)
      const events = built.events
      if (events.length === 0) return { state, value: built.value, events }
      if (state.blocked) {
        this.options.logger?.warn(`paper-trading: account blocked, dropped ${events.length} event(s)`)
        return { state, value: built.value, events: [] }
      }
      this.assertSequence(state, events)
      await this.store.append(events)
      for (const event of events) applyEvent(state, event)
      const issues = verify(state)
      this.state = state
      if (issues.length > 0) await this.recordViolation(issues)
      return { state: this.state ?? state, value: built.value, events }
    })
  }

  async append(events: readonly LedgerEvent[]): Promise<AccountState> {
    const outcome = await this.transact(() => ({ events: [...events], value: undefined }))
    return outcome.state
  }

  /**
   * Replace the file with a new ledger (reset, compaction).
   *
   * The replacement is validated and replayed before the atomic rename, so a
   * reset never leaves a ledger that would lock the account on the next start.
   */
  async replace(events: readonly LedgerEvent[]): Promise<AccountState> {
    return this.enqueue(async () => {
      this.assertSequence(emptyState(this.options.accountId), events)
      const result = replay([...events], this.options.accountId)
      if (result.issues.length > 0) {
        throw new Error(`paper-trading: refusing an inconsistent ledger: ${result.issues.join('; ')}`)
      }
      // Settle any in-flight load first: it may still repair or block the old file.
      await this.ensureLoaded()
      await this.store.replace(events)
      this.state = result.state
      this.loading = Promise.resolve(result.state)
      return this.state
    })
  }

  /** Refresh the in-memory mark-to-market cache; quote ticks are not ledger events. */
  async markPrices(quotes: readonly Quote[]): Promise<AccountState> {
    return this.enqueue(async () => {
      const state = await this.ensureLoaded()
      for (const quote of quotes) {
        const position = state.positions[quote.symbol]
        if (position !== undefined) {
          position.lastPrice = quote.last
          position.lastTs = quote.marketTs ?? undefined
        }
      }
      return state
    })
  }

  /** Copy the event file into `backups/`, named after the reset timestamp. */
  async backup(label: string): Promise<boolean> {
    return this.enqueue(async () => {
      const stamp = label.replace(/[:.]/g, '-')
      return this.store.backup(`${this.backups()}/events-${stamp}.jsonl`)
    })
  }

  /** Raw file text for `account/export`; `content: null` means "not created yet". */
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

  private async inspectSnapshot(file: SnapshotFile): Promise<LedgerSnapshot> {
    const base = {
      name: file.name,
      createdAt: new Date(file.mtimeMs).toISOString(),
      bytes: file.bytes,
    }
    try {
      const { events, skipped } = await readEventsFile<LedgerEvent>(file.path)
      const prepared = prepareLedger(events)
      const source = prepared.issues.length > 0 ? events : prepared.events
      const ledgerVersion = ledgerVersionOf(source)
      let next = source
      let migratable = false
      let problem: string | undefined
      if (prepared.issues.length === 0) {
        try {
          const outcome = migrateLedger(source)
          if (outcome !== undefined) {
            next = outcome.events
            migratable = true
          }
        } catch (error) {
          problem = error instanceof MigrationUnavailable ? error.message : String(error)
        }
      }
      const result = replay(next, this.options.accountId)
      const issues = [...prepared.issues, ...result.issues]
      if (skipped > 0) problem ??= `含 ${skipped} 行无法解析`
      const valid = issues.length === 0 && !result.state.blocked && problem === undefined
      return {
        ...base,
        ledgerVersion,
        lastSeq: result.state.lastSeq,
        tradeDate: result.state.tradeDate,
        cashCents: result.state.cashCents,
        valid,
        migratable,
        problem: issues[0] ?? problem,
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
   * Allowed while blocked: a locked account is exactly the case recovery exists
   * for. Validation happens before anything is written, and the current file is
   * snapshotted first so the recovery itself can be undone.
   */
  async restore(name: string): Promise<AccountState> {
    const file = snapshotPath(this.backups(), name)
    return this.enqueue(async () => {
      // Settle an in-flight load first: it may still repair/block the old file,
      // and its result must not overwrite the restored state afterwards.
      await this.ensureLoaded().catch(() => undefined)
      const { events, skipped } = await readEventsFile<LedgerEvent>(file)
      if (events.length === 0 && skipped === 0) throw new Error(`快照 ${name} 是空的`)
      if (skipped > 0) throw new Error(`快照 ${name} 含 ${skipped} 行无法解析，拒绝恢复`)
      const prepared = prepareLedger(events)
      if (prepared.issues.length > 0) throw new Error(`快照 ${name} 结构损坏：${prepared.issues.join('; ')}`)
      let outcome
      try {
        outcome = migrateLedger(prepared.events)
      } catch (error) {
        // A newer/unsupported version is a refusal, not a crash: surface the
        // migration's reason so the caller can pick another snapshot or upgrade.
        throw new Error(error instanceof Error ? error.message : String(error))
      }
      const next = outcome === undefined
        ? prepared.events
        : [...outcome.events, this.marker(outcome.from, outcome.to, prepared.events[prepared.events.length - 1]?.seq ?? 0)]
      const result = replay(next, this.options.accountId)
      if (result.issues.length > 0) throw new Error(`快照 ${name} 对账失败：${result.issues.join('; ')}`)
      if (result.state.blocked) throw new Error(`快照 ${name} 无法恢复：${result.state.blockedReason ?? '版本不兼容'}`)
      await writeSnapshot(this.store, this.backups(), 'pre-restore')
      await this.store.replace(next)
      this.state = result.state
      this.loading = Promise.resolve(result.state)
      return this.state
    })
  }

  private assertSequence(state: AccountState, events: readonly LedgerEvent[]): void {
    let expected = state.lastSeq + 1
    for (const event of events) {
      if (!Number.isInteger(event.seq) || event.seq !== expected) {
        throw new Error(`paper-trading: ledger seq mismatch: expected ${expected}, got ${String(event.seq)}`)
      }
      expected += 1
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }
}
