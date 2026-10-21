import type { FillModel, PaperSettings, Quote, SessionPhase } from '../contract.js'

export interface FeeBreakdown {
  commissionCents: number
  stampCents: number
  transferCents: number
  totalCents: number
}

export interface FillRecord {
  id: string
  orderId: string
  symbol: string
  name?: string
  side: 'buy' | 'sell'
  price: number
  qty: number
  amountCents: number
  fees: FeeBreakdown
  ts: string
  tradeDate: string
  /** Minute bar close time that supplied the volume, when known. */
  barTs?: string
  fillModel?: FillModel
}

export interface Order {
  id: string
  requestId: string
  symbol: string
  name?: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  qty: number
  limitPrice?: number
  status: 'queued' | 'pending' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired'
  reason?: string
  note?: string
  phase?: SessionPhase
  createdAt: string
  updatedAt: string
  filledAt?: string
  fillPrice?: number
  filledQty: number
  remainingQty: number
  avgFillPrice?: number
  fees?: FeeBreakdown
  tradeDate: string
}

export interface Position {
  symbol: string
  name?: string
  qty: number
  /** Shares sellable today. */
  available: number
  /** Total cost basis in cents, fees included. */
  costCents: number
  lastPrice?: number
  lastTs?: string
}

export interface PositionSnapshot {
  symbol: string
  name?: string
  qty: number
  available: number
  costCents: number
  lastPrice?: number
}

export interface DayPoint {
  date: string
  equityCents: number
  cashCents: number
  /** Trade date that becomes current after this close. */
  nextDate?: string
  feesCents?: number
  closePrices?: Record<string, number>
  positions?: PositionSnapshot[]
  gaps?: Record<string, number>
  closeSource?: 'daily' | 'last' | 'missing'
  recordedAt?: string
}

export interface DayOpened {
  date: string
  openPrices: Record<string, number>
  prevClose: Record<string, number>
  gaps: Record<string, number>
  t1Unlocked: boolean
  recordedAt: string
}

export interface AccountState {
  accountId: string
  version: number
  ledgerVersion: number
  initialCashCents: number
  cashCents: number
  settings: PaperSettings
  positions: Record<string, Position>
  orders: Record<string, Order>
  fills: FillRecord[]
  tradeDate: string
  /** Last date whose day.opened event was applied. */
  lastOpenedDate: string
  blocked: boolean
  lastSeq: number
  createdAt: string
  dayEquity: DayPoint[]
  /** Gaps recorded at the latest open, carried into the close snapshot. */
  gaps: Record<string, number>
}

export type LedgerEvent =
  | {
      seq: number
      id: string
      ts: string
      type: 'account.opened'
      payload: { accountId: string; settings: PaperSettings; initialCashCents: number; tradeDate: string; ledgerVersion?: number }
    }
  | {
      seq: number
      id: string
      ts: string
      type: 'account.reset'
      payload: { settings: PaperSettings; initialCashCents: number; tradeDate: string; reason: string }
    }
  | { seq: number; id: string; ts: string; type: 'order.submitted'; payload: { order: Order; quote: Quote; phase?: SessionPhase } }
  | { seq: number; id: string; ts: string; type: 'order.partially_filled'; payload: { orderId: string; fill: FillRecord } }
  | { seq: number; id: string; ts: string; type: 'order.filled'; payload: { orderId: string; fill: FillRecord } }
  | { seq: number; id: string; ts: string; type: 'order.rejected'; payload: { order: Order; reason: string } }
  | { seq: number; id: string; ts: string; type: 'order.canceled'; payload: { orderId: string; reason: string; at: string } }
  | { seq: number; id: string; ts: string; type: 'order.released'; payload: { orderId: string; at: string } }
  | { seq: number; id: string; ts: string; type: 'day.pre_opened'; payload: { date: string; at: string } }
  | { seq: number; id: string; ts: string; type: 'day.opened'; payload: DayOpened }
  | { seq: number; id: string; ts: string; type: 'day.closed'; payload: DayPoint }
  | { seq: number; id: string; ts: string; type: 'ledger.violation'; payload: { check: string; expected: string; actual: string } }
