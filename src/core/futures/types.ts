/**
 * Internal types of the futures account.
 *
 * The cross-plane shapes (views, drafts, settings) live in
 * `src/futures-contract.ts` and are frozen; this module only adds the ledger's
 * own state and event payloads. Amounts are integer cents, prices are yuan
 * quantized to the contract tick.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/types
 */

import type {
  FuturesOffset,
  FuturesOrderStatus,
  FuturesOrderType,
  FuturesPhase,
  FuturesSettings,
  FuturesSide,
} from '../../futures-contract.js'
import type { DaySessions } from './session.js'

/** Static contract terms the engine needs; a structural subset of the data port meta. */
export interface ContractTerms {
  symbol: string
  name?: string
  /** Product code, e.g. `rb`. */
  product: string
  exchange: 'SHFE' | 'INE' | 'DCE' | 'CZCE' | 'GFEX'
  multiplier: number
  tickSize: number
  marginRate?: number
  tradeHours?: string
  /** Last trading day, `YYYY-MM-DD`. */
  deListDate?: string
  volume?: number
}

export interface QuoteInput {
  last: number
  preSettlement?: number
  volume?: number
  openInterest?: number
  marketTs?: string
}

export interface LimitInput {
  upper: number
  lower: number
  /**
   * Daily margin ratio as a decimal (the adapter converts the exchange's
   * `10` into `0.1`). Missing means "fall back to settle / contract".
   */
  marginRate?: number
  /** `minutes` means the band came from the minute feed and may be off one tick. */
  source?: 'limit' | 'minutes'
}

export interface SettleInput {
  feePerLotCents?: number
  closeTodayFeePerLotCents?: number
  longMarginRate?: number
}

export type FeeSource = 'exchange' | 'default'

/**
 * One futures position line. Long and short are stored separately (D6) and
 * never netted. `marginCents` is initial margin fixed at the average open
 * price, so cash and replay never depend on marks; only the float does.
 */
export interface FuturesPosition {
  symbol: string
  name?: string
  product: string
  side: FuturesSide
  qty: number
  /** Lots opened on the current trade date (the close-today fee bucket). */
  todayQty: number
  avgPrice: number
  lastPrice?: number
  multiplier: number
  tickSize: number
  marginCents: number
  marginRate?: number
  deListDate?: string
  openedAt: string
  /** Fee rates captured at open so a settlement can still charge them. */
  feePerLotCents: number
  closeTodayFeePerLotCents: number
  feeSource: FeeSource
}

export interface FuturesPositionSnapshot {
  symbol: string
  name?: string
  product: string
  side: FuturesSide
  qty: number
  todayQty: number
  avgPrice: number
  lastPrice?: number
  multiplier: number
  marginCents: number
  marginRate?: number
  deListDate?: string
}

export interface FuturesOrder {
  id: string
  requestId: string
  symbol: string
  name?: string
  product: string
  side: FuturesSide
  offset: FuturesOffset
  type: FuturesOrderType
  qty: number
  limitPrice?: number
  /** Manual reference price fallback for a market close when no quote exists. */
  price?: number
  status: FuturesOrderStatus
  reason?: string
  /** Free-form ticket note, shown with the order history. */
  note?: string
  createdAt: string
  updatedAt: string
  filledAt?: string
  fillPrice?: number
  marginCents?: number
  feesCents?: number
  tradeDate: string
  /** Terms frozen at submit time, so matching never depends on late data. */
  multiplier: number
  tickSize: number
  marginRate?: number
  deListDate?: string
  feePerLotCents: number
  closeTodayFeePerLotCents: number
  feeSource: FeeSource
}

export interface FuturesFill {
  id: string
  orderId: string
  symbol: string
  name?: string
  product: string
  side: FuturesSide
  offset: FuturesOffset
  price: number
  qty: number
  multiplier: number
  tickSize: number
  amountCents: number
  feesCents: number
  /** Margin reserved on open / released on close. */
  marginCents: number
  realizedPnlCents: number
  /** Lots that belonged to the close-today bucket (close fills only). */
  closedTodayQty: number
  feeSource: FeeSource
  feePerLotCents: number
  closeTodayFeePerLotCents: number
  marginRate?: number
  deListDate?: string
  ts: string
  tradeDate: string
}

export interface FuturesDayPoint {
  date: string
  /** Trade date that becomes current after this settlement. */
  nextDate: string
  equityCents: number
  cashCents: number
  marginCents: number
  feesCents: number
  closePrices: Record<string, number>
  positions: FuturesPositionSnapshot[]
  closeSource: 'daily' | 'quote' | 'missing'
  liquidations: number
  warnings: string[]
  recordedAt: string
}

export interface FuturesAccountState {
  accountId: string
  version: number
  ledgerVersion: number
  initialCashCents: number
  cashCents: number
  settings: FuturesSettings
  /** Keyed by `symbol|side`, so long and short never collide. */
  positions: Record<string, FuturesPosition>
  orders: Record<string, FuturesOrder>
  fills: FuturesFill[]
  tradeDate: string
  lastOpenedDate: string
  blocked: boolean
  /** Reason recorded by the last `ledger.violation`; survives replay. */
  blockedReason?: string
  lastSeq: number
  createdAt: string
  dayEquity: FuturesDayPoint[]
}

export type FuturesLedgerEvent =
  | {
      seq: number
      id: string
      ts: string
      type: 'account.opened'
      payload: { accountId: string; settings: FuturesSettings; initialCashCents: number; tradeDate: string; ledgerVersion?: number }
    }
  | {
      seq: number
      id: string
      ts: string
      type: 'account.reset'
      payload: { settings: FuturesSettings; initialCashCents: number; tradeDate: string; reason: string }
    }
  | { seq: number; id: string; ts: string; type: 'order.submitted'; payload: { order: FuturesOrder } }
  | { seq: number; id: string; ts: string; type: 'order.filled'; payload: { orderId: string; fill: FuturesFill } }
  | { seq: number; id: string; ts: string; type: 'order.rejected'; payload: { order: FuturesOrder; reason: string } }
  | { seq: number; id: string; ts: string; type: 'order.canceled'; payload: { orderId: string; reason: string; at: string } }
  | {
      seq: number
      id: string
      ts: string
      type: 'position.forced_liquidation'
      payload: { date: string; reason: 'risk' | 'expiry'; fills: FuturesFill[]; orders: FuturesOrder[] }
    }
  | { seq: number; id: string; ts: string; type: 'day.opened'; payload: { date: string; openPrices: Record<string, number>; recordedAt: string } }
  | { seq: number; id: string; ts: string; type: 'day.closed'; payload: FuturesDayPoint }
  | { seq: number; id: string; ts: string; type: 'ledger.violation'; payload: { check: string; expected: string; actual: string } }
  | { seq: number; id: string; ts: string; type: 'ledger.repaired'; payload: { dropped: number; issues?: string[] } }

/** Codes the futures risk layer reports; the first block is futures-specific. */
export type FuturesRiskCode =
  | 'INSUFFICIENT_MARGIN'
  | 'INSUFFICIENT_POSITION'
  | 'CONTRACT_NOT_FOUND'
  | 'CONTRACT_EXPIRED'
  | 'NO_VOLUME'
  | 'LIMIT_UNAVAILABLE'
  | 'MARGIN_UNAVAILABLE'
  | 'ACCOUNT_BLOCKED'
  | 'INVALID_SYMBOL'
  | 'INVALID_QTY'
  | 'INVALID_ARGUMENT'
  | 'SESSION_CLOSED'
  | 'QUOTE_UNAVAILABLE'
  | 'PRICE_LIMIT'

export type FuturesRiskResult =
  | { ok: true; price: number; marginCents: number; feesCents: number }
  | { ok: false; code: FuturesRiskCode; message: string }

export function positionKey(symbol: string, side: FuturesSide): string {
  return `${symbol}|${side}`
}

/** Market side of an order: open long buys, close long sells, and vice versa. */
export function tradeSideOf(offset: FuturesOffset, side: FuturesSide): 'buy' | 'sell' {
  return (offset === 'open') === (side === 'long') ? 'buy' : 'sell'
}

export type { DaySessions, FuturesPhase, FuturesSettings }
