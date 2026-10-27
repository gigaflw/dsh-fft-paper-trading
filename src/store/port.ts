import type { Quote } from '../contract.js'
import type { AccountState, LedgerEvent } from '../core/types.js'

/**
 * Persistence port owned by the service.
 *
 * The service never learns how state is stored: {@link AccountRepo} is the JSONL
 * adapter today, and a test fake or another backend only has to replay the same
 * events. `markPrices` is deliberately not a ledger event — quotes feed
 * mark-to-market views, but the auditable history is still the event log.
 */
export interface AccountStore {
  /** Absolute path of the event file when the store is file-backed. */
  readonly ledgerPath?: string
  /** Replay the log once and return the current state. */
  current(): Promise<AccountState>
  /**
   * Build events from the freshest state and append them atomically.
   *
   * This is the only safe way to write a clock advance: `build` runs inside the
   * store's write queue, so concurrent readers each see the state left by the
   * previous transaction and cannot generate the same sequence twice.
   */
  transact<T>(build: (state: AccountState) => Transaction<T> | Promise<Transaction<T>>): Promise<TransactionOutcome<T>>
  /** Append a batch built elsewhere; the store still enforces seq continuity. */
  append(events: readonly LedgerEvent[]): Promise<AccountState>
  /** Atomically replace the whole ledger (compaction, reset) and the state. */
  replace(events: readonly LedgerEvent[]): Promise<AccountState>
  /** Refresh the quote cache used by views; never writes the ledger. */
  markPrices(quotes: readonly Quote[]): Promise<AccountState>
  /** Copy the event file aside before a destructive operation. */
  backup(label: string): Promise<boolean>
  /** Raw ledger text plus its absolute path, for `account/export`. */
  readLedger(): Promise<LedgerFile>
  /**
   * Snapshots on disk, newest first, with enough replay metadata for a caller
   * (a human or an agent) to pick a restorable one without opening files.
   */
  snapshots(): Promise<LedgerSnapshot[]>
  /**
   * Replace the live ledger with one snapshot, atomically and in memory too.
   *
   * Works while blocked — recovery is the one write allowed on a locked
   * account. A snapshot that no longer replays cleanly is refused before the
   * live file is touched.
   */
  restore(name: string): Promise<AccountState>
}

export interface Transaction<T> {
  events: LedgerEvent[]
  value: T
}

export interface TransactionOutcome<T> {
  state: AccountState
  value: T
  /** Events that actually reached the file; empty when the store refused. */
  events: LedgerEvent[]
}

export interface LedgerFile {
  path: string
  /** `null` when the ledger does not exist yet. */
  content: string | null
}

/** One restorable ledger snapshot, as listed to a caller. */
export interface LedgerSnapshot {
  name: string
  /** File mtime in ISO form; the name's stamp is UTC and harder to read. */
  createdAt: string
  bytes: number
  /** Version stored in the snapshot, before any migration. */
  ledgerVersion: number
  lastSeq: number
  tradeDate: string
  cashCents: number
  /** Replays cleanly at the current version (after migration when needed). */
  valid: boolean
  /** Needs the loader's migration step before it can be restored. */
  migratable: boolean
  /** Why it cannot be restored; only meaningful when `valid` is false. */
  problem?: string
}
