/**
 * Futures ledger repository: `$DSH_HOME/paper-trading/futures/events.jsonl`.
 *
 * Storage is the shared {@link LedgerRepoBase}: one write queue, contiguous
 * sequence numbers, fsync per append, atomic replacement for reset/repair, a
 * backup before any destructive operation, automatic `blocked` state when
 * replay finds an inconsistency, daily snapshots and in-process restore. This
 * file only supplies the futures fold (replay/verify/summary) and the futures
 * mark tick, which quantizes prices to the contract tick.
 * @module @dsh-ft/dsh-fft-paper-trading/store/futures-repo
 */

import { FUTURES_ACCOUNT_ID, FUTURES_LEDGER_VERSION } from '../futures-contract.js'
import { applyEvent, verify } from '../core/futures/ledger.js'
import { quantizePrice } from '../core/futures/money.js'
import { prepareFuturesLedger, replayFutures } from '../core/futures/replay.js'
import type { FuturesAccountState, FuturesLedgerEvent } from '../core/futures/types.js'
import { LedgerRepoBase, type LedgerPlane, type LedgerRepoOptions } from './ledger-repo-base.js'
import type { LedgerSnapshot } from './port.js'

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
  /** Snapshots on disk, newest first, with replay metadata. */
  snapshots(): Promise<LedgerSnapshot[]>
  /** Replace the live ledger with one snapshot; allowed while blocked. */
  restore(name: string): Promise<FuturesAccountState>
}

/** Version recorded by the genesis event of a futures ledger. */
function futuresLedgerVersionOf(events: readonly FuturesLedgerEvent[]): number {
  for (const event of events) {
    if (event.type === 'account.opened') return event.payload.ledgerVersion ?? 1
    if (event.type === 'account.reset') return FUTURES_LEDGER_VERSION
  }
  return FUTURES_LEDGER_VERSION
}

/** How the futures plane folds its event log; storage mechanics are shared. */
const FUTURES_PLANE: LedgerPlane<FuturesAccountState, FuturesLedgerEvent> = {
  label: 'paper-trading: futures',
  prepare: prepareFuturesLedger,
  replay: (events, accountId) => replayFutures(events, accountId),
  applyEvent,
  verify,
  summary: state => ({
    lastSeq: state.lastSeq,
    tradeDate: state.tradeDate,
    cashCents: state.cashCents,
    blocked: state.blocked,
    ...(state.blockedReason === undefined ? {} : { blockedReason: state.blockedReason }),
  }),
  ledgerVersion: futuresLedgerVersionOf,
  // Futures historically hands the planned events back on a blocked account;
  // the caller checks `outcome.events` rather than relying on the drop.
  dropEventsWhenBlocked: false,
}

/** Loads, replays and appends the single futures ledger. */
export class FuturesRepo extends LedgerRepoBase<FuturesAccountState, FuturesLedgerEvent> implements FuturesStore {
  constructor(options: FuturesRepoOptions) {
    const ledgerOptions: LedgerRepoOptions = {
      home: options.home,
      accountId: options.accountId ?? FUTURES_ACCOUNT_ID,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    }
    super(FUTURES_PLANE, ledgerOptions)
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
}
