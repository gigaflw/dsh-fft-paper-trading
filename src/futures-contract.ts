/**
 * Cross-plane contract for the futures account (MVP).
 *
 * Browser half and host half compile against these shapes. The module is
 * intentionally free of runtime dependencies (only a settings constant) and
 * does not import the stock contract, so the two ledgers can evolve apart.
 *
 * Symbols use the market-data (CTP) suffix set: `.SHFE .INE .DCE .CZCE .GFEX`.
 * @module @ft/dsh-fft-paper-trading/futures-contract
 */

/** Ledger schema version, independent from the stock ledger. */
export const FUTURES_LEDGER_VERSION = 1
/** Fixed account id; the futures account is single and separate. */
export const FUTURES_ACCOUNT_ID = 'futures'

export type FuturesExchange = 'SHFE' | 'INE' | 'DCE' | 'CZCE' | 'GFEX'
export type FuturesSide = 'long' | 'short'
export type FuturesOffset = 'open' | 'close'
export type FuturesOrderType = 'market' | 'limit'
export type FuturesOrderStatus = 'pending' | 'filled' | 'canceled' | 'rejected' | 'expired'
/** Commodity day session only (night session is out of scope for the MVP). */
export type FuturesPhase = 'pre_open' | 'trading' | 'lunch' | 'closed'
export type FuturesPeriod = '7d' | '30d' | 'all'
export type FuturesDataState = 'ok' | 'stale' | 'denied' | 'failed'

export interface FuturesSettings {
  /** Starting cash in cents. */
  initialCashCents: number
  /** Extra margin ratio on top of the exchange rate. */
  marginUplift: number
  /** Multiplier on the exchange fee. */
  feeMultiplier: number
  warnRiskRatio: number
  liquidateRiskRatio: number
  /** Opening is blocked when fewer trading days than this remain. */
  closeBeforeDeListDays: number
  /** Fallback when the exchange fee is unknown. */
  defaultFeePerLotCents: number
}

export const DEFAULT_FUTURES_SETTINGS: FuturesSettings = {
  initialCashCents: 100_000_000,
  marginUplift: 0,
  feeMultiplier: 1,
  warnRiskRatio: 0.8,
  liquidateRiskRatio: 1,
  closeBeforeDeListDays: 3,
  defaultFeePerLotCents: 0,
}

/** Static contract terms. `symbol` is the market-data suffix form. */
export interface FuturesContractView {
  symbol: string
  name?: string
  product: string
  exchange: FuturesExchange
  multiplier: number
  tickSize: number
  marginRate?: number
  tradeHours?: string
  /** Last trading day, `YYYY-MM-DD`. */
  deListDate?: string
}

export interface FuturesQuoteView {
  symbol: string
  name?: string
  last: number
  preSettlement?: number
  openInterest?: number
  volume?: number
  marketTs?: string
  /** Trade date the quote belongs to, `YYYY-MM-DD`. */
  tradeDate?: string
  source?: string
}

export interface FuturesLimitView {
  symbol: string
  upper: number
  lower: number
  ratio?: number
  source: string
}

export interface FuturesSettleView {
  symbol: string
  settle?: number
  longMarginRate?: number
  feePerLotCents?: number
  closeTodayFeePerLotCents?: number
}

export interface FuturesPositionView {
  symbol: string
  name?: string
  side: FuturesSide
  qty: number
  /** Lots opened on the current trade date (used for the close-today fee). */
  todayQty: number
  avgPrice: number
  lastPrice?: number
  multiplier: number
  marginCents: number
  marginRate?: number
  unrealizedPnlCents?: number
  unrealizedPnlPct?: number
  deListDate?: string
}

export interface FuturesOrderView {
  id: string
  requestId: string
  symbol: string
  name?: string
  side: FuturesSide
  offset: FuturesOffset
  type: FuturesOrderType
  qty: number
  limitPrice?: number
  status: FuturesOrderStatus
  reason?: string
  createdAt: string
  updatedAt: string
  filledAt?: string
  fillPrice?: number
  marginCents?: number
  feesCents?: number
}

export interface FuturesFillView {
  id: string
  orderId: string
  symbol: string
  name?: string
  side: FuturesSide
  offset: FuturesOffset
  price: number
  qty: number
  multiplier: number
  amountCents: number
  feesCents: number
  ts: string
  tradeDate: string
}

export interface FuturesAccountView {
  accountId: string
  currency: 'CNY'
  initialCash: number
  cash: number
  /** Margin occupied by open positions. */
  margin: number
  /** cash + margin + unrealized PnL at the latest marks. */
  equity: number
  pnl: number
  pnlPct: number
  todayPnl: number
  /** margin / equity; 0 when equity is not positive. */
  riskRatio: number
  tradeDate: string
  blocked: boolean
  blockedReason?: string
  ledgerPath?: string
  positions: FuturesPositionView[]
  settings: FuturesSettings
}

export interface FuturesMarketStatus {
  phase: FuturesPhase
  tradeDate: string
  canSubmit: boolean
  canMatch: boolean
  nextBoundary?: string
  reason?: string
}

export interface FuturesPreviewView {
  symbol: string
  side: FuturesSide
  offset: FuturesOffset
  type: FuturesOrderType
  qty: number
  price: number
  multiplier: number
  amountCents: number
  marginCents: number
  feesCents: number
  cashAfterCents: number
  equityAfter: number
  riskRatioAfter: number
  maxOpenQty: number
  availableCloseQty: number
  limit?: FuturesLimitView
  quote?: FuturesQuoteView
  session?: FuturesMarketStatus
  warnings: string[]
}

export interface FuturesTickView {
  tradeDate: string
  filled: FuturesOrderView[]
  expired: FuturesOrderView[]
  notices: string[]
}

export interface FuturesEquityPoint {
  date: string
  equity: number
  cash: number
  margin: number
}

export interface FuturesProductStat {
  product: string
  tradeCount: number
  realizedPnl: number
}

export interface FuturesReviewView {
  equityCurve: FuturesEquityPoint[]
  maxDrawdownPct: number
  tradeCount: number
  openCount: number
  closeCount: number
  winCount: number
  lossCount: number
  totalFees: number
  realizedPnl: number
  byProduct: FuturesProductStat[]
}

export interface FuturesContractsResult {
  state: FuturesDataState
  contracts: FuturesContractView[]
  notice?: string
}

export interface FuturesQuotesResult {
  state: FuturesDataState
  quotes: FuturesQuoteView[]
  notice?: string
}

export interface FuturesLedgerExport {
  path: string
  exists: boolean
  content?: string
  notice?: string
}

export interface FuturesDraft {
  symbol: string
  side: FuturesSide
  offset: FuturesOffset
  type: FuturesOrderType
  qty: number
  limitPrice?: number
  /** Manual fallback when no quote is available (market close orders only). */
  price?: number
  note?: string
}

export interface FuturesContractQuery {
  query?: string
  exchange?: FuturesExchange
  limit?: number
  refresh?: boolean
}

/** Error codes this feature adds on top of the stock contract's set. */
export type FuturesErrorCode =
  | 'INSUFFICIENT_MARGIN'
  | 'INSUFFICIENT_POSITION'
  | 'CONTRACT_NOT_FOUND'
  | 'CONTRACT_EXPIRED'
  | 'NO_VOLUME'
  | 'LIMIT_UNAVAILABLE'
  | 'MARGIN_UNAVAILABLE'
