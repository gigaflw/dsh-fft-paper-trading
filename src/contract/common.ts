/**
 * Cross-plane contract, common stock-domain shapes.
 * @module @dsh-ft/dsh-fft-paper-trading/contract/common
 */

/**
 * Cross-plane contract for the paper-trading plugin.
 *
 * Browser half and host half compile against these shapes; this module must stay
 * free of runtime dependencies so both sides can import it as types.
 * @module @dsh-ft/dsh-fft-paper-trading/contract
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
  // 100 万，A 股模拟盘的常规默认值：1 手贵州茅台（约 14.5 万）也能买，
  // 10 万会让新账户连一手高价股都下不了单。
  initialCashCents: 100_000_000,
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

export const DEFAULT_ACCOUNT_ID = 'default'
