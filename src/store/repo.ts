import type { Quote } from '../contract.js'
import { applyEvent, verify } from '../core/ledger.js'
import { migrateLedger, ledgerVersionOf, MigrationUnavailable } from '../core/migrations.js'
import { prepareLedger, replay } from '../core/replay.js'
import type { AccountState, LedgerEvent } from '../core/types.js'
import { readEventsFile } from './event-store.js'
import { LedgerRepoBase, type LedgerPlane, type LedgerRepoOptions } from './ledger-repo-base.js'
import type { AccountStore, LedgerSnapshot } from './port.js'
import { snapshotPath, writeSnapshot, type SnapshotFile } from './snapshots.js'

/** How the stock plane folds its event log; the storage mechanics are shared. */
const ACCOUNT_PLANE: LedgerPlane<AccountState, LedgerEvent> = {
  label: 'paper-trading',
  prepare: prepareLedger,
  replay: (events, accountId) => replay(events, accountId),
  applyEvent,
  verify,
  summary: state => ({
    lastSeq: state.lastSeq,
    tradeDate: state.tradeDate,
    cashCents: state.cashCents,
    blocked: state.blocked,
    ...(state.blockedReason === undefined ? {} : { blockedReason: state.blockedReason }),
  }),
  ledgerVersion: ledgerVersionOf,
  dropEventsWhenBlocked: true,
}

/**
 * The stock account ledger: shared JSONL persistence plus the stock fold.
 *
 * Recovery is a first-class path: a ledger from a known older version is
 * migrated in place (snapshot first), and any snapshot can be restored into the
 * running process without restarting the host. Only the migration chain and the
 * migration-aware snapshot inspection are stock-specific.
 */
export class AccountRepo extends LedgerRepoBase<AccountState, LedgerEvent> implements AccountStore {
  constructor(options: LedgerRepoOptions) {
    super(ACCOUNT_PLANE, options)
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

  /**
   * Rewrite a ledger from a known older version into the current one.
   *
   * The snapshot is taken before the replacement; a failed validation keeps the
   * original file byte for byte, and returning `undefined` lets the normal
   * replay path lock the account with the version reason.
   */
  protected override async tryMigrate(events: LedgerEvent[]): Promise<AccountState | undefined> {
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
   * Snapshot inspection for the stock plane: unlike futures, an older snapshot
   * may be migratable, and the reason must be reported before the restore.
   */
  protected override async inspectSnapshot(file: SnapshotFile): Promise<LedgerSnapshot> {
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
   * Replace the live ledger with one snapshot, migrating it first when needed.
   *
   * Allowed while blocked: a locked account is exactly the case recovery exists
   * for. Validation happens before anything is written, and the current file is
   * snapshotted first so the recovery itself can be undone.
   */
  override async restore(name: string): Promise<AccountState> {
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
}
