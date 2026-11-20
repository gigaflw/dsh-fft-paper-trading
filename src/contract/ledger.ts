/**
 * Ledger recovery views (export, snapshots).
 * @module @dsh-ft/dsh-fft-paper-trading/contract/ledger
 */

/** `account/export`: the raw ledger file, so a locked account can be inspected. */
export interface LedgerExport {
  /** Absolute path of `events.jsonl`. */
  path: string
  /** False when no ledger file exists yet. */
  exists: boolean
  /** Raw JSONL text; omitted when `exists` is false. */
  content?: string
  notice?: string
}

/** One ledger snapshot as listed to the panel, an agent, or a human. */
export interface LedgerSnapshotView {
  name: string
  createdAt: string
  bytes: number
  /** Version stored in the snapshot, before any migration. */
  ledgerVersion: number
  lastSeq: number
  tradeDate: string
  /** Free cash at that point, in yuan. */
  cash: number
  /** Replays cleanly at the current ledger version (after migration). */
  valid: boolean
  /** Needs the loader's migration step before restoring. */
  migratable: boolean
  problem?: string
}

/** `ledger/list`: everything needed to choose a recovery point. */
export interface LedgerSnapshotsView {
  path: string
  blocked: boolean
  blockedReason?: string
  ledgerVersion?: number
  snapshots: LedgerSnapshotView[]
}