/**
 * Ledger-level operations shared by both account services.
 *
 * Export, snapshot listing, backup and restore are plane-independent: they only
 * touch the repository and marshal the result into a view. The stock and futures
 * services used to carry identical copies; the differences are the account's
 * blocked flag, the error class and the view shape, which each service passes in.
 * @module @dsh-ft/dsh-fft-paper-trading/service/ledger-admin
 */

import type { LedgerExport, LedgerSnapshotView, LedgerSnapshotsView } from '../contract.js'
import type { LedgerFile, LedgerSnapshot } from '../store/port.js'

/** The repository surface the admin needs; both planes satisfy it. */
export interface LedgerRepositoryPort<S> {
  readonly ledgerPath?: string
  readLedger(): Promise<LedgerFile>
  current(): Promise<S>
  snapshots(): Promise<LedgerSnapshot[]>
  restore(name: string): Promise<S>
  backup(label: string): Promise<boolean>
}

export interface LedgerStatusView {
  path: string
  exists: boolean
  blocked: boolean
  blockedReason?: string
}

export interface LedgerAdminDeps<S, V> {
  repo: LedgerRepositoryPort<S>
  /** Read the plane's frozen/blocked flag. */
  isBlocked: (state: S) => boolean
  blockedReason: (state: S) => string | undefined
  ledgerVersion: (state: S) => number | undefined
  viewOf: (state: S) => V
  /** Refuse recovery on a human-frozen account (recovery is a state change). */
  assertUnlocked: () => void
  ts: () => string
  /** Domain error factory: `PaperError` or `FuturesError`. */
  makeError: (code: string, message: string, status?: number) => Error
  /** Log prefix for the one warning this helper emits. */
  label: string
  logger?: { warn(message: string): void }
}

/** Ledger cents → the yuan the rest of the views use. */
function toSnapshotView(snapshot: LedgerSnapshot): LedgerSnapshotView {
  return {
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    bytes: snapshot.bytes,
    ledgerVersion: snapshot.ledgerVersion,
    lastSeq: snapshot.lastSeq,
    tradeDate: snapshot.tradeDate,
    cash: snapshot.cashCents / 100,
    valid: snapshot.valid,
    migratable: snapshot.migratable,
    ...(snapshot.problem === undefined ? {} : { problem: snapshot.problem }),
  }
}

export class LedgerAdmin<S, V> {
  constructor(private readonly deps: LedgerAdminDeps<S, V>) {}

  /** Read-only export of the raw ledger, for a frozen account's banner. */
  async exportLedger(): Promise<LedgerExport> {
    const ledger = await this.deps.repo.readLedger()
    if (ledger.content === null) return { path: ledger.path, exists: false, notice: '账本文件尚未创建' }
    return { path: ledger.path, exists: true, content: ledger.content }
  }

  /** Where the ledger is and why it is frozen — without the raw text. */
  async ledgerStatus(): Promise<LedgerStatusView> {
    const ledger = await this.deps.repo.readLedger()
    const state = await this.deps.repo.current().catch(error => {
      this.deps.logger?.warn(`${this.deps.label}: ledger status could not replay: ${String(error)}`)
      return undefined
    })
    return {
      path: ledger.path,
      exists: ledger.content !== null,
      blocked: state === undefined ? false : this.deps.isBlocked(state),
      ...(state === undefined || this.deps.blockedReason(state) === undefined
        ? {}
        : { blockedReason: this.deps.blockedReason(state) }),
    }
  }

  /** Snapshots that can be restored, newest first, plus the live ledger's state. */
  async ledgerSnapshots(): Promise<LedgerSnapshotsView> {
    const state = await this.deps.repo.current().catch(() => undefined)
    const snapshots = await this.deps.repo.snapshots()
    return {
      path: this.deps.repo.ledgerPath ?? '',
      blocked: state !== undefined && this.deps.isBlocked(state),
      ...(state === undefined ? {} : { ledgerVersion: this.deps.ledgerVersion(state) }),
      ...(state === undefined || this.deps.blockedReason(state) === undefined
        ? {}
        : { blockedReason: this.deps.blockedReason(state) }),
      snapshots: snapshots.map(toSnapshotView),
    }
  }

  /**
   * Replace the live ledger with one snapshot.
   *
   * Deliberately reachable while the ledger is blocked and without `sync()`:
   * recovery must not depend on the current ledger replaying, and the store
   * validates the target before touching the file.
   */
  async restoreLedger(name: string, confirm: boolean): Promise<V> {
    this.deps.assertUnlocked()
    if (confirm !== true) throw this.deps.makeError('INVALID_ARGUMENT', '恢复账本需要 confirm=true', 400)
    try {
      return this.deps.viewOf(await this.deps.repo.restore(name))
    } catch (error) {
      throw this.deps.makeError('LEDGER_RESTORE_FAILED', error instanceof Error ? error.message : String(error), 409)
    }
  }

  /** Take one manual snapshot (the automatic one runs at most daily). */
  async backupLedger(): Promise<boolean> {
    const stamp = this.deps.ts().replace(/[:.]/g, '-')
    return this.deps.repo.backup(`manual-${stamp}`)
  }

  /** Yuan from the UI → integer cents, rejecting non-positive or unsafe amounts. */
  cashAmountCents(amount: number): number {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw this.deps.makeError('INVALID_ARGUMENT', '金额必须是正数', 400)
    }
    const cents = Math.round(amount * 100)
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      throw this.deps.makeError('INVALID_ARGUMENT', '金额至少 0.01 元', 400)
    }
    return cents
  }
}
