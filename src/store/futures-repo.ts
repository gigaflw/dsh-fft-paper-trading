/**
 * Futures ledger repository: `$DSH_HOME/paper-trading/futures/events.jsonl`.
 *
 * Same durability model as the stock account — one write queue, contiguous
 * sequence numbers, fsync per append, atomic replacement for reset/repair, a
 * backup before any destructive operation, and automatic `blocked` state when
 * replay finds an inconsistency.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/store/futures-repo
 */

import { resolve } from 'node:path'
import { FUTURES_ACCOUNT_ID } from '../futures-contract.js'
import { applyEvent, emptyState, verify } from '../core/futures/ledger.js'
import { quantizePrice } from '../core/futures/money.js'
import {
  prepareFuturesLedger,
  replayFutures,
  type PreparedFuturesLedger,
} from '../core/futures/replay.js'
import type { FuturesAccountState, FuturesLedgerEvent } from '../core/futures/types.js'
import { EventStore } from './event-store.js'
import { backupsDir, eventsPath } from './paths.js'

export interface FuturesRepoOptions {
  home: string
  accountId?: string
  logger?: { warn(message: string): void }
}

export interface FuturesTransaction<T> {
  events: FuturesLedgerEvent[]
  value: T
}

export interface FuturesTransactionOutcome<T> {
  state: FuturesAccountState
  value: T
  /** Events that actually reached the file; empty when the store refused. */
  events: FuturesLedgerEvent[]
}

export interface FuturesLedgerFile {
  path: string
  /** `null` when the ledger does not exist yet. */
  content: string | null
}

/** Persistence port the futures service depends on. */
export interface FuturesStore {
  /** Absolute path of the event file when the store is file-backed. */
  readonly ledgerPath?: string
  current(): Promise<FuturesAccountState>
  transact<T>(build: (state: FuturesAccountState) => FuturesTransaction<T> | Promise<FuturesTransaction<T>>): Promise<FuturesTransactionOutcome<T>>
  append(events: readonly FuturesLedgerEvent[]): Promise<FuturesAccountState>
  replace(events: readonly FuturesLedgerEvent[]): Promise<FuturesAccountState>
  /** Refresh the in-memory mark cache; quote ticks are not ledger events. */
  markPrices(marks: readonly { symbol: string; last: number }[]): Promise<FuturesAccountState>
  backup(label: string): Promise<boolean>
  readLedger(): Promise<FuturesLedgerFile>
}

/**
 * Loads, replays and appends the single futures ledger.
 *
 * Every write goes through one Promise queue and one sequence invariant, so a
 * concurrent read cannot duplicate a settlement event. Repairs and resets use
 * an atomic file replacement; a rejected write never touches the file.
 */
export class FuturesRepo implements FuturesStore {
  private readonly store: EventStore<FuturesLedgerEvent>
  private readonly accountId: string
  private state: FuturesAccountState | undefined
  private loading: Promise<FuturesAccountState> | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: FuturesRepoOptions) {
    this.accountId = options.accountId ?? FUTURES_ACCOUNT_ID
    this.store = new EventStore<FuturesLedgerEvent>(eventsPath(options.home, this.accountId))
  }

  get ledgerPath(): string {
    return this.store.filePath
  }

  private async ensureLoaded(): Promise<FuturesAccountState> {
    if (this.state !== undefined) return this.state
    if (this.loading === undefined) this.loading = this.loadOnce()
    return this.loading
  }

  private async loadOnce(): Promise<FuturesAccountState> {
    const { events, skipped } = await this.store.readAll()
    if (skipped > 0) this.options.logger?.warn(`paper-trading: dropped ${skipped} malformed futures ledger line(s)`)

    const prepared = prepareFuturesLedger(events)
    const source = prepared.issues.length > 0 ? events : prepared.events
    const result = replayFutures(source, this.accountId)
    let state = result.state
    if (prepared.issues.length === 0 && prepared.duplicates > 0) {
      state = await this.compact(prepared, state)
    }
    this.state = state

    const issues = [...prepared.issues, ...result.issues]
    if (issues.length > 0 && !state.blocked) await this.recordViolation(issues)
    return this.state
  }

  private async compact(prepared: PreparedFuturesLedger, state: FuturesAccountState): Promise<FuturesAccountState> {
    const seq = state.lastSeq + 1
    const event: FuturesLedgerEvent = {
      seq,
      id: `evt-${seq}`,
      ts: new Date().toISOString(),
      type: 'ledger.repaired',
      payload: { dropped: prepared.duplicates },
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      await this.store.backup(`${backupsDir(this.options.home, this.accountId)}/events-repair-${stamp}.jsonl`)
      await this.store.replace([...prepared.events, event])
      applyEvent(state, event)
      this.options.logger?.warn(`paper-trading: dropped ${prepared.duplicates} duplicate futures ledger event(s)`)
    } catch (error) {
      this.options.logger?.warn(`paper-trading: futures ledger repair failed, kept in memory only: ${String(error)}`)
    }
    return state
  }

  private async recordViolation(issues: string[]): Promise<void> {
    const state = this.state
    if (state === undefined || state.blocked) return
    const seq = state.lastSeq + 1
    const event: FuturesLedgerEvent = {
      seq,
      id: `evt-${seq}`,
      ts: new Date().toISOString(),
      type: 'ledger.violation',
      payload: { check: 'replay', expected: 'consistent', actual: issues.join('; ') },
    }
    await this.store.append([event])
    applyEvent(state, event)
    this.state = state
    this.options.logger?.warn(`paper-trading: futures ledger violation, account blocked: ${issues.join('; ')}`)
  }

  async current(): Promise<FuturesAccountState> {
    return this.ensureLoaded()
  }

  async transact<T>(
    build: (state: FuturesAccountState) => FuturesTransaction<T> | Promise<FuturesTransaction<T>>,
  ): Promise<FuturesTransactionOutcome<T>> {
    return this.enqueue(async () => {
      const state = await this.ensureLoaded()
      const built = await build(state)
      const events = built.events
      if (events.length === 0) return { state, value: built.value, events }
      if (state.blocked) {
        this.options.logger?.warn(`paper-trading: futures account blocked, dropped ${events.length} event(s)`)
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

  async append(events: readonly FuturesLedgerEvent[]): Promise<FuturesAccountState> {
    const outcome = await this.transact(() => ({ events: [...events], value: undefined }))
    return outcome.state
  }

  /**
   * Replace the file with a new ledger (reset, compaction). Validated and
   * replayed before the atomic rename, so a reset never leaves a ledger that
   * would lock the account on the next start.
   */
  async replace(events: readonly FuturesLedgerEvent[]): Promise<FuturesAccountState> {
    return this.enqueue(async () => {
      this.assertSequence(emptyState(this.accountId), events)
      const result = replayFutures([...events], this.accountId)
      if (result.issues.length > 0) {
        throw new Error(`paper-trading: refusing an inconsistent futures ledger: ${result.issues.join('; ')}`)
      }
      await this.ensureLoaded()
      await this.store.replace(events)
      this.state = result.state
      this.loading = Promise.resolve(result.state)
      return this.state
    })
  }

  /** Refresh position marks for the views only; never writes the ledger. */
  async markPrices(marks: readonly { symbol: string; last: number }[]): Promise<FuturesAccountState> {
    return this.enqueue(async () => {
      const state = await this.ensureLoaded()
      for (const mark of marks) {
        for (const position of Object.values(state.positions)) {
          if (position.symbol !== mark.symbol) continue
          if (!Number.isFinite(mark.last) || mark.last <= 0) continue
          position.lastPrice = quantizePrice(mark.last, position.tickSize)
        }
      }
      return state
    })
  }

  async backup(label: string): Promise<boolean> {
    return this.enqueue(async () => {
      const stamp = label.replace(/[:.]/g, '-')
      return this.store.backup(`${backupsDir(this.options.home, this.accountId)}/events-${stamp}.jsonl`)
    })
  }

  async readLedger(): Promise<FuturesLedgerFile> {
    return { path: resolve(this.store.filePath), content: await this.store.readText() }
  }

  private assertSequence(state: FuturesAccountState, events: readonly FuturesLedgerEvent[]): void {
    let expected = state.lastSeq + 1
    for (const event of events) {
      if (!Number.isInteger(event.seq) || event.seq !== expected) {
        throw new Error(`paper-trading: futures ledger seq mismatch: expected ${expected}, got ${String(event.seq)}`)
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
