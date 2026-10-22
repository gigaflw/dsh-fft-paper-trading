/**
 * Cross-plane contract for the paper-trading plugin.
 *
 * Browser half and host half compile against these shapes; this module must stay
 * free of runtime dependencies so both sides can import it as types.
 * @module @ft/dsh-fft-paper-trading/contract
 */

/** Exact Fetch route used by the browser half. */
export const PAPER_ROUTE = '/api/ft-paper-trading' as const
/** Request body cap; the route rejects anything larger before parsing. */
export const PAPER_MAX_BODY_BYTES = 256 * 1024
/**
 * Ledger schema version. v2 added day.opened; v3 pins the M2 fill model
 * (slippage 0, unlimited fill at the last price) for every older ledger.
 */
export const PAPER_LEDGER_VERSION = 3

export type Side = 'buy' | 'sell'
export type OrderType = 'market' | 'limit'
export type OrderStatus = 'queued' | 'pending' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired'
export type DataState = 'ok' | 'stale' | 'denied' | 'failed'
export type Period = '7d' | '30d' | 'all'

/** Trading phase in Asia/Shanghai; the session table lives in core/session.ts. */
export type SessionPhase =
  | 'pre_open'
  | 'continuous_am'
  | 'lunch'
  | 'continuous_pm'
  | 'auction_close'
  | 'closed'

export type FillModel = 'volume-share' | 'unlimited'

export interface PaperSettings {
  /** Starting cash in cents. */
  initialCashCents: number
  commissionRate: number
  minCommissionCents: number
  stampDutyRate: number
  transferFeeRate: number
  /** Kept for ledger compatibility; M2 fills at `last` and never applies it. */
  slippageBps: number
  enableT1: boolean
  /** Kept for ledger compatibility; M2 has no quote TTL gate. */
  quoteTtlSec: number
  maxOrderNotionalCents: number
  /** Kept for ledger compatibility; M2 never caps a fill by bar volume. */
  maxParticipationRate: number
  /** Kept for ledger compatibility; M2 only ever fills in one unlimited chunk. */
  fillModel: FillModel
}

export const DEFAULT_SETTINGS: PaperSettings = {
  initialCashCents: 10_000_000,
  commissionRate: 0.00025,
  minCommissionCents: 500,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageBps: 0,
  enableT1: true,
  quoteTtlSec: 30,
  maxOrderNotionalCents: 0,
  maxParticipationRate: 0.10,
  fillModel: 'unlimited',
}

export interface Quote {
  symbol: string
  name?: string
  last: number
  /** FTShare does not publish bid/ask; keep optional and never rely on it. */
  bid?: number
  ask?: number
  prevClose?: number
  /** Market time of the quote/bar; null means it cannot fill. */
  marketTs?: string | null
  /** Fetch time, for latency display only. */
  fetchedAt?: string
  /** @deprecated v0.1 field; treated as marketTs when marketTs is absent. */
  ts?: string
  board?: string
  st?: boolean
  status?: string
  source?: string
}

export interface Bar {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface OrderDraft {
  symbol: string
  side: Side
  type: OrderType
  qty: number
  limitPrice?: number
  /** Manual fallback when no quote is available (market orders only). */
  price?: number
  /** Optional journal note shown in the review view. */
  note?: string
}

export interface OrderView {
  id: string
  requestId: string
  symbol: string
  name?: string
  side: Side
  type: OrderType
  qty: number
  limitPrice?: number
  status: OrderStatus
  reason?: string
  note?: string
  createdAt: string
  updatedAt: string
  filledAt?: string
  fillPrice?: number
  filledQty?: number
  remainingQty?: number
  avgFillPrice?: number
  amountCents?: number
  feesCents?: number
}

export interface FillView {
  id: string
  orderId: string
  symbol: string
  name?: string
  side: Side
  price: number
  qty: number
  amountCents: number
  feesCents: number
  ts: string
  tradeDate: string
}

export interface PositionView {
  symbol: string
  name?: string
  qty: number
  available: number
  avgCost: number
  lastPrice?: number
  marketValueCents?: number
  unrealizedPnlCents?: number
  unrealizedPnlPct?: number
}

export interface AccountView {
  accountId: string
  currency: 'CNY'
  initialCash: number
  cash: number
  marketValue: number
  equity: number
  pnl: number
  pnlPct: number
  todayPnl: number
  tradeDate: string
  blocked: boolean
  /** Why the account is locked, copied from the last `ledger.violation`. */
  blockedReason?: string
  /** Absolute path of `events.jsonl`, so a locked account can be repaired. */
  ledgerPath?: string
  positions: PositionView[]
  settings: PaperSettings
}

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

export interface MarketStatus {
  phase: SessionPhase
  tradeDate: string
  canSubmit: boolean
  canMatch: boolean
  /** ISO-8601 of the next phase boundary. */
  nextBoundary?: string
  reason?: string
}

export interface PriceLimit {
  upper: number
  lower: number
  ratio: number
  source: 'prev-close' | 'limit-list' | 'unknown'
}

export interface SymbolHit {
  symbol: string
  name: string
  board?: string
}

export interface MarketListResult {
  state: DataState
  quotes: Quote[]
  page: number
  total?: number
  notice?: string
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
  type: 'open' | 'reset' | 'buy' | 'sell' | 'fee'
  amount: number
  balance: number
  ref?: string
}

export interface WatchlistView {
  symbols: string[]
}

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

export interface RoundTrip {
  symbol: string
  name?: string
  qty: number
  cost: number
  proceeds: number
  pnl: number
  holdingDays: number
}

export interface RpcSuccess<T> { ok: true; value: T }
export interface RpcFailure { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }
export type RpcResult<T> = RpcSuccess<T> | RpcFailure

export interface RpcRequest { endpoint: string; payload?: unknown }

export const DEFAULT_ACCOUNT_ID = 'default'

export type ErrorCode =
  | 'ACCOUNT_BLOCKED'
  | 'INVALID_ARGUMENT'
  | 'INVALID_SYMBOL'
  | 'INVALID_QTY'
  | 'INVALID_LOT'
  | 'INSUFFICIENT_CASH'
  | 'INSUFFICIENT_POSITION'
  | 'T1_LOCKED'
  | 'MAX_NOTIONAL'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_PENDING'
  | 'QUOTE_UNAVAILABLE'
  | 'QUOTE_STALE'
  | 'SESSION_CLOSED'
  | 'AUCTION_ONLY'
  | 'PRICE_LIMIT'
  | 'SUSPENDED'
  | 'INSUFFICIENT_LIQUIDITY'
