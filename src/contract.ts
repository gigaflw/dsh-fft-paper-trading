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
 * Ledger schema version. v4 stores every security as its canonical
 * `code.exchange` id; older ledgers used the raw input and are incompatible.
 */
export const PAPER_LEDGER_VERSION = 4

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

export interface PaperSettings {
  /** Starting cash in cents. */
  initialCashCents: number
  commissionRate: number
  minCommissionCents: number
  stampDutyRate: number
  transferFeeRate: number
  enableT1: boolean
  maxOrderNotionalCents: number
}

export const DEFAULT_SETTINGS: PaperSettings = {
  initialCashCents: 10_000_000,
  commissionRate: 0.00025,
  minCommissionCents: 500,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  enableT1: true,
  maxOrderNotionalCents: 0,
}

export interface Quote {
  /** Canonical id, e.g. `000001.SZ`. */
  symbol: string
  name?: string
  last: number
  prevClose?: number
  /** Market time of the quote/bar; null means it cannot fill. */
  marketTs?: string | null
  /** Fetch time, for latency display only. */
  fetchedAt?: string
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
  /** Canonical id, e.g. `000001.SZ`. */
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
  /** Canonical id, e.g. `000001.SZ`. */
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
  /** Canonical id, e.g. `000001.SZ`. */
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
  /** Canonical id, e.g. `000001.SZ`. */
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
  /** Deposits minus withdrawals after the account opened, in yuan. */
  netCashFlow: number
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

/**
 * Which data source the panel is pricing against.
 *
 * `configured` — an FTShare API key is configured and usable.
 * `free` — no key: the anonymous free tier (daily-close quotes, 500/day).
 * `none` — the FTShare data service is not installed.
 * `invalid` — a key exists but cannot be used (rejected or unreadable).
 */
export type DataSourceState = 'configured' | 'free' | 'none' | 'invalid'

/** Read-only data-source state for the panel header; never carries the key itself. */
export interface DataSourceStatus {
  state: DataSourceState
  /** Short, user-facing cause for `invalid` or a degraded `configured`. */
  message?: string
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
  | 'SESSION_CLOSED'
  | 'AUCTION_ONLY'
  | 'PRICE_LIMIT'
  | 'SUSPENDED'
  | 'UNSUPPORTED_INSTRUMENT'
