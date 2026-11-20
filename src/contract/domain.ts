/**
 * Stock trading views: ticket, orders, positions, review, market, symbols.
 * @module @dsh-ft/dsh-fft-paper-trading/contract/domain
 */

import type { DataState, OrderType, OrderView, PositionView, Quote, SessionPhase, Side } from './common.js'

export interface PreviewView {
  symbol: string
  side: Side
  type: OrderType
  qty: number
  price: number
  amountCents: number
  commissionCents: number
  stampCents: number
  transferCents: number
  totalFeesCents: number
  cashAfterCents: number
  availableQty: number
  maxBuyQty: number
  quote?: Quote
  priceLimit?: PriceLimit
  session?: MarketStatus
  warnings: string[]
}

/**
 * One-row outcome of a basket allocation.
 *
 * `ok` means the row can be bought with the computed `qty > 0`; every other
 * status explains why nothing was allocated, so the client can show the row
 * without inventing text of its own.
 */
export type BasketRowStatus = 'ok' | 'zero_lot' | 'no_quote' | 'suspended'

/** A CSV problem; `line` is 1-based, 0 means the whole file. */
export interface BasketIssue {
  line: number
  message: string
}

/** One allocated row of `basket/preview`; the client renders this verbatim. */
export interface BasketPlanRow {
  /** Canonical id, e.g. `000001.SZ`. */
  symbol: string
  name?: string
  /** Normalised weight, 0..1. */
  weight: number
  /** `floor(budgetCents * weight)`, before the fee buy-back. */
  targetCents: number
  price?: number
  qty: number
  amountCents: number
  feesCents: number
  /** `amountCents / budgetCents`; rows without allocation report 0. */
  actualWeight: number
  status: BasketRowStatus
  warning?: string
}

/** `basket/preview`: parse + allocation, read-only. */
export interface BasketPreview {
  /** Effective budget: min(user input, available cash). */
  budgetCents: number
  /** Available cash before the basket. */
  cashCents: number
  rows: BasketPlanRow[]
  issues: BasketIssue[]
  warnings: string[]
  totalAmountCents: number
  totalFeesCents: number
  /** `budgetCents - totalAmountCents - totalFeesCents`. */
  residualCents: number
  /** `cashCents - totalAmountCents - totalFeesCents`. */
  cashAfterCents: number
  session: MarketStatus
}

/** One confirmed row of a basket order; the caller sends back preview quantities. */
export interface BasketOrderInput {
  /** Canonical id, e.g. `000001.SZ`. */
  symbol: string
  /** 100-share multiple, > 0. */
  qty: number
}

export interface BasketOrderRowResult {
  symbol: string
  order?: OrderView
  /** Present when the row was rejected; the readable reason, not just a code. */
  error?: string
}

/** `basket/place`: per-row outcome plus the cash left after the whole batch. */
export interface BasketOrderResult {
  batchId: string
  rows: BasketOrderRowResult[]
  cashAfterCents: number
}

export interface EquityPoint {
  date: string
  equity: number
  cash: number
}

export interface ReviewView {
  equityCurve: EquityPoint[]
  maxDrawdownPct: number
  tradeCount: number
  buyCount: number
  sellCount: number
  totalFees: number
  realizedPnl: number
  days: number
}

export interface TickView {
  tradeDate: string
  filled: OrderView[]
  expired: OrderView[]
  quotes: Quote[]
  notices: string[]
}

/**
 * Which trading-day source answered, and why it degraded.
 *
 * `fallback` means Monday–Friday is being used instead of the exchange
 * calendar, so holidays are treated as trading days until the source recovers.
 */
export interface CalendarStatus {
  source: 'ftshare' | 'fallback'
  /** Why the fallback is in use; present only while degraded. */
  reason?: string
  /** ISO-8601 of the last check against the source. */
  checkedAt?: string
}

export interface MarketStatus {
  phase: SessionPhase
  tradeDate: string
  canSubmit: boolean
  canMatch: boolean
  /** ISO-8601 of the next phase boundary. */
  nextBoundary?: string
  reason?: string
  /** Trading-day source; `fallback` means the session table is a weekday estimate. */
  calendar?: CalendarStatus
}

export interface PriceLimit {
  upper: number
  lower: number
  ratio: number
  source: 'prev-close' | 'limit-list' | 'unknown'
}

export interface SymbolHit {
  /** Canonical id, e.g. `000001.SZ`. */
  symbol: string
  name: string
}

export interface MarketListResult {
  state: DataState
  quotes: Quote[]
  page: number
  total?: number
  notice?: string
  /** Upstream error code (e.g. `route_not_allowed`), for the banner reason. */
  noticeCode?: string
}

export interface DayReport {
  date: string
  equity: number
  cash: number
  dayPnl: number
  fees: number
  available: number
  positions: PositionView[]
  gaps: Record<string, number>
  closeSource: 'daily' | 'last' | 'missing'
}

export interface CashFlowEntry {
  ts: string
  type: 'open' | 'reset' | 'buy' | 'sell' | 'deposit' | 'withdraw'
  amount: number
  balance: number
  ref?: string
}

export interface ShortlistView {
  symbols: string[]
}

export interface RoundTrip {
  symbol: string
  name?: string
  qty: number
  cost: number
  proceeds: number
  pnl: number
  holdingDays: number
}

/**
 * Which data source the panel is pricing against.
 *
 * `configured` — an FTShare API key is configured and usable.
 * `free` — no key: the anonymous free tier (daily-close quotes, 500/day).
 * `none` — the FTShare data service is not installed.
 * `invalid` — a key exists but cannot be used (rejected or unreadable).
 */