import type {
  AccountView,
  EquityPoint,
  FillView,
  OrderDraft,
  OrderView,
  MarketStatus,
  PaperSettings,
  PreviewView,
  Quote,
  ReviewView,
} from '../contract.js'
import { amountCents, roundPrice } from './money.js'
import { computeFees } from './fees.js'
import { estimatePrice } from './risk.js'
import { equityCents } from './engine.js'
import { daysBetween } from './calendar.js'
import { priceLimitFor } from './price-limit.js'
import type { AccountState, FillRecord, Order, Position } from './types.js'

export function toPositionView(position: Position): AccountView['positions'][number] {
  const avgCost = position.qty > 0 ? position.costCents / position.qty / 100 : 0
  const marketValueCents = position.lastPrice === undefined ? position.costCents : amountCents(position.lastPrice, position.qty)
  const unrealized = marketValueCents - position.costCents
  return {
    symbol: position.symbol,
    name: position.name,
    qty: position.qty,
    available: position.available,
    avgCost: roundPrice(avgCost),
    lastPrice: position.lastPrice,
    marketValueCents,
    unrealizedPnlCents: unrealized,
    unrealizedPnlPct: position.costCents > 0 ? unrealized / position.costCents : 0,
  }
}

export function toOrderView(order: Order): OrderView {
  const fill = order.fees === undefined ? undefined : order.fees.totalCents
  return {
    id: order.id,
    requestId: order.requestId,
    symbol: order.symbol,
    name: order.name,
    side: order.side,
    type: order.type,
    qty: order.qty,
    limitPrice: order.limitPrice,
    status: order.status,
    reason: order.reason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    filledAt: order.filledAt,
    fillPrice: order.fillPrice,
    filledQty: order.filledQty,
    remainingQty: order.remainingQty,
    avgFillPrice: order.avgFillPrice,
    note: order.note,
    amountCents: order.avgFillPrice === undefined ? undefined : amountCents(order.avgFillPrice, order.filledQty),
    feesCents: fill,
  }
}

export function toFillView(fill: FillRecord): FillView {
  return {
    id: fill.id,
    orderId: fill.orderId,
    symbol: fill.symbol,
    name: fill.name,
    side: fill.side,
    price: fill.price,
    qty: fill.qty,
    amountCents: fill.amountCents,
    feesCents: fill.fees.totalCents,
    ts: fill.ts,
    tradeDate: fill.tradeDate,
  }
}

export function toAccountView(state: AccountState): AccountView {
  const positions = Object.values(state.positions)
    .map(toPositionView)
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
  const marketValueCents = positions.reduce((sum, item) => sum + (item.marketValueCents ?? 0), 0)
  const equity = state.cashCents + marketValueCents
  const lastPoint = state.dayEquity[state.dayEquity.length - 1]
  const baseline = lastPoint !== undefined && lastPoint.date < state.tradeDate ? lastPoint.equityCents : state.initialCashCents
  return {
    accountId: state.accountId,
    currency: 'CNY',
    initialCash: state.initialCashCents / 100,
    cash: state.cashCents / 100,
    marketValue: marketValueCents / 100,
    equity: equity / 100,
    pnl: (equity - state.initialCashCents) / 100,
    pnlPct: state.initialCashCents > 0 ? (equity - state.initialCashCents) / state.initialCashCents : 0,
    todayPnl: (equity - baseline) / 100,
    tradeDate: state.tradeDate,
    blocked: state.blocked,
    positions,
    settings: state.settings,
  }
}

export function previewOrder(
  state: AccountState,
  draft: OrderDraft,
  quote: Quote | null,
  settings: PaperSettings,
  session?: MarketStatus,
): PreviewView {
  const price = estimatePrice(draft, quote, settings) ?? 0
  const amount = amountCents(price, draft.qty)
  const fees = computeFees(amount, draft.side, settings)
  const priceLimit = priceLimitFor(draft.symbol, quote?.name, quote?.prevClose)
  const warnings: string[] = []
  if (quote === null && draft.type === 'market' && draft.price === undefined) {
    warnings.push('没有可用行情，请填写参考价或改用限价单')
  }
  if (priceLimit !== undefined && price > 0 && (price < priceLimit.lower || price > priceLimit.upper)) {
    warnings.push(`价格超出涨跌停范围 ${priceLimit.lower.toFixed(2)}–${priceLimit.upper.toFixed(2)}`)
  }
  if (session !== undefined && !session.canMatch) warnings.push('当前时段不能连续成交，委托将排队')
  if (draft.side === 'sell') {
    const available = state.positions[draft.symbol]?.available ?? 0
    if (available < draft.qty) warnings.push(`可卖不足：可卖 ${available} 股`)
  }
  const maxBuyQty = price > 0
    ? Math.floor(state.cashCents / (price * 100 * (1 + settings.commissionRate + settings.transferFeeRate)) / 100) * 100
    : 0
  return {
    symbol: draft.symbol,
    side: draft.side,
    type: draft.type,
    qty: draft.qty,
    price,
    amountCents: amount,
    commissionCents: fees.commissionCents,
    stampCents: fees.stampCents,
    transferCents: fees.transferCents,
    totalFeesCents: fees.totalCents,
    cashAfterCents: draft.side === 'buy' ? state.cashCents - amount - fees.totalCents : state.cashCents + amount - fees.totalCents,
    availableQty: state.positions[draft.symbol]?.available ?? 0,
    maxBuyQty: Math.max(0, maxBuyQty),
    quote: quote ?? undefined,
    priceLimit,
    session,
    warnings,
  }
}

function realizedPnl(state: AccountState): number {
  // Average-cost realized PnL for the sold quantity only.
  const lots = new Map<string, { qty: number; cost: number }>()
  let realized = 0
  for (const fill of state.fills) {
    const lot = lots.get(fill.symbol) ?? { qty: 0, cost: 0 }
    if (fill.side === 'buy') {
      lot.qty += fill.qty
      lot.cost += fill.amountCents + fill.fees.totalCents
    } else if (lot.qty > 0) {
      const avg = lot.cost / lot.qty
      const costSold = Math.round(avg * fill.qty)
      realized += fill.amountCents - fill.fees.totalCents - costSold
      lot.qty -= fill.qty
      lot.cost -= costSold
    }
    lots.set(fill.symbol, lot)
  }
  return realized
}

export function toReview(state: AccountState, period: '7d' | '30d' | 'all', nowDate: string): ReviewView {
  const points: EquityPoint[] = state.dayEquity.map(point => ({
    date: point.date,
    equity: point.equityCents / 100,
    cash: point.cashCents / 100,
  }))
  if (points.length === 0) {
    points.push({ date: state.tradeDate, equity: equityCents(state) / 100, cash: state.cashCents / 100 })
  }
  const filtered = period === 'all'
    ? points
    : points.filter(point => daysBetween(point.date, nowDate) <= (period === '7d' ? 7 : 30))
  let peak = 0
  let maxDrawdown = 0
  for (const point of filtered) {
    peak = Math.max(peak, point.equity)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak)
  }
  const buys = state.fills.filter(fill => fill.side === 'buy').length
  const sells = state.fills.length - buys
  return {
    equityCurve: filtered,
    maxDrawdownPct: maxDrawdown,
    tradeCount: state.fills.length,
    buyCount: buys,
    sellCount: sells,
    totalFees: state.fills.reduce((sum, fill) => sum + fill.fees.totalCents, 0) / 100,
    realizedPnl: realizedPnl(state) / 100,
    days: filtered.length,
  }
}
