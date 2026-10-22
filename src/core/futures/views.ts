/**
 * Futures views: ledger state → the frozen cross-plane shapes.
 *
 * All money fields in the contract are cents; only `equity`, `pnl` etc. are
 * yuan, matching the stock-side convention.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/views
 */

import type {
  FuturesAccountView,
  FuturesDraft,
  FuturesEquityPoint,
  FuturesFillView,
  FuturesLimitView,
  FuturesMarketStatus,
  FuturesOrderView,
  FuturesPositionView,
  FuturesPreviewView,
  FuturesProductStat,
  FuturesQuoteView,
  FuturesReviewView,
  FuturesSide,
} from '../../futures-contract.js'
import { daysBetween } from '../calendar.js'
import { amountCents, quantizePrice } from './money.js'
import { computeFuturesFees } from './fees.js'
import {
  marginCentsFor,
  marginRateFor,
  markToMarket,
  maxOpenQty,
  realizedPnlCents,
  riskRatioView,
  unrealizedPnlCents,
} from './margin.js'
import { phaseAt, nextBoundaryAt, type DaySessions } from './session.js'
import {
  positionKey,
  tradeSideOf,
  type ContractTerms,
  type FuturesAccountState,
  type FuturesFill,
  type FuturesOrder,
  type FuturesPosition,
  type LimitInput,
  type QuoteInput,
  type SettleInput,
} from './types.js'

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function toPositionView(position: FuturesPosition): FuturesPositionView {
  const unrealized = unrealizedPnlCents(position)
  return {
    symbol: position.symbol,
    name: position.name,
    side: position.side,
    qty: position.qty,
    todayQty: position.todayQty,
    avgPrice: position.avgPrice,
    lastPrice: position.lastPrice,
    multiplier: position.multiplier,
    marginCents: position.marginCents,
    marginRate: position.marginRate,
    unrealizedPnlCents: unrealized,
    unrealizedPnlPct: position.marginCents > 0 ? unrealized / position.marginCents : 0,
    deListDate: position.deListDate,
  }
}

export function positionViews(state: FuturesAccountState): FuturesPositionView[] {
  return Object.values(state.positions)
    .map(toPositionView)
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.side === b.side ? 0 : a.side === 'long' ? -1 : 1))
}

export function toOrderView(order: FuturesOrder): FuturesOrderView {
  return {
    id: order.id,
    requestId: order.requestId,
    symbol: order.symbol,
    name: order.name,
    side: order.side,
    offset: order.offset,
    type: order.type,
    qty: order.qty,
    limitPrice: order.limitPrice,
    status: order.status,
    reason: order.reason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    filledAt: order.filledAt,
    fillPrice: order.fillPrice,
    marginCents: order.marginCents,
    feesCents: order.feesCents,
  }
}

export function orderViews(state: FuturesAccountState): FuturesOrderView[] {
  return Object.values(state.orders)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toOrderView)
}

export function toFillView(fill: FuturesFill): FuturesFillView {
  return {
    id: fill.id,
    orderId: fill.orderId,
    symbol: fill.symbol,
    name: fill.name,
    side: fill.side,
    offset: fill.offset,
    price: fill.price,
    qty: fill.qty,
    multiplier: fill.multiplier,
    amountCents: fill.amountCents,
    feesCents: fill.feesCents,
    ts: fill.ts,
    tradeDate: fill.tradeDate,
  }
}

export function fillViews(state: FuturesAccountState): FuturesFillView[] {
  return [...state.fills].reverse().map(toFillView)
}

export function toAccountView(state: FuturesAccountState, ledgerPath?: string): FuturesAccountView {
  const marks = markToMarket(state)
  const equity = marks.equityCents
  const lastPoint = state.dayEquity[state.dayEquity.length - 1]
  const baseline = lastPoint !== undefined && lastPoint.date < state.tradeDate ? lastPoint.equityCents : state.initialCashCents
  const view: FuturesAccountView = {
    accountId: state.accountId,
    currency: 'CNY',
    initialCash: state.initialCashCents / 100,
    cash: state.cashCents / 100,
    margin: marks.marginCents / 100,
    equity: equity / 100,
    pnl: (equity - state.initialCashCents) / 100,
    pnlPct: state.initialCashCents > 0 ? (equity - state.initialCashCents) / state.initialCashCents : 0,
    todayPnl: (equity - baseline) / 100,
    riskRatio: riskRatioView(marks.marginCents, equity),
    tradeDate: state.tradeDate,
    blocked: state.blocked,
    blockedReason: state.blockedReason,
    positions: positionViews(state),
    settings: state.settings,
  }
  return ledgerPath === undefined ? view : { ...view, ledgerPath }
}

export function marketStatusAt(tradeDate: string, sessions: DaySessions, nowIso: string): FuturesMarketStatus {
  const phase = phaseAt(nowIso, tradeDate, sessions)
  return {
    phase,
    tradeDate,
    canSubmit: phase === 'trading',
    canMatch: phase === 'trading',
    nextBoundary: nextBoundaryAt(nowIso, tradeDate, sessions),
  }
}

export function quoteView(symbol: string, quote: QuoteInput, name?: string): FuturesQuoteView {
  return {
    symbol,
    name,
    last: quote.last,
    preSettlement: quote.preSettlement,
    openInterest: quote.openInterest,
    volume: quote.volume,
    marketTs: quote.marketTs,
    source: 'ftshare',
  }
}

export function limitView(limit: LimitInput, symbol: string): FuturesLimitView {
  return {
    symbol,
    upper: limit.upper,
    lower: limit.lower,
    ratio: limit.marginRate,
    source: limit.source ?? 'limit',
  }
}

export interface PreviewInput {
  state: FuturesAccountState
  draft: FuturesDraft
  contract?: ContractTerms
  quote?: QuoteInput
  limit?: LimitInput
  settle?: SettleInput
  sessions: DaySessions
  nowIso: string
  tradeDaysToDeList?: number
  warnings?: string[]
}

/** Preview is never a write: it explains what would happen and what is missing. */
export function previewOrder(input: PreviewInput): FuturesPreviewView {
  const state = input.state
  const symbol = typeof input.draft.symbol === 'string' ? input.draft.symbol.trim() : ''
  const side: FuturesSide = input.draft.side === 'short' ? 'short' : 'long'
  const offset = input.draft.offset === 'close' ? 'close' : 'open'
  const type = input.draft.type === 'limit' ? 'limit' : 'market'
  const qty = Number.isFinite(input.draft.qty) ? Math.round(input.draft.qty) : 0
  const position = state.positions[positionKey(symbol, side)]
  const multiplier = input.contract?.multiplier ?? position?.multiplier ?? 0
  const tickSize = input.contract?.tickSize ?? position?.tickSize ?? 0.01
  const name = input.contract?.name ?? position?.name
  const last = isPositive(input.quote?.last) ? quantizePrice(input.quote.last, tickSize) : undefined
  const limitPrice = isPositive(input.draft.limitPrice) ? quantizePrice(input.draft.limitPrice, tickSize) : undefined
  const manual = isPositive(input.draft.price) ? quantizePrice(input.draft.price, tickSize) : undefined
  const buy = tradeSideOf(offset, side) === 'buy'
  const warnings = [...(input.warnings ?? [])]
  const session = marketStatusAt(state.tradeDate, input.sessions, input.nowIso)

  let price = 0
  if (type === 'market') {
    price = last ?? manual ?? 0
  } else if (limitPrice !== undefined) {
    price = last === undefined
      ? limitPrice
      : quantizePrice(buy ? Math.min(limitPrice, last) : Math.max(limitPrice, last), tickSize)
  }

  const feeSettle: SettleInput | undefined = input.settle ?? (position === undefined
    ? undefined
    : { feePerLotCents: position.feePerLotCents, closeTodayFeePerLotCents: position.closeTodayFeePerLotCents })
  const fees = computeFuturesFees({
    offset,
    qty,
    todayQty: position?.todayQty ?? 0,
    settle: feeSettle,
    settings: state.settings,
  })
  warnings.push(...fees.warnings)

  const rate = offset === 'open'
    ? marginRateFor({ limit: input.limit, settle: input.settle, contract: input.contract, settings: state.settings }).rate
    : position?.marginRate
  const marginCents = offset === 'open'
    ? (rate !== undefined && price > 0 && multiplier > 0 && qty > 0 ? marginCentsFor(price, multiplier, qty, rate) : 0)
    : (position !== undefined && position.qty > 0 ? Math.round((position.marginCents * Math.min(qty, position.qty)) / position.qty) : 0)
  const amount = price > 0 && multiplier > 0 && qty > 0 ? amountCents(price, multiplier, qty) : 0
  const marks = markToMarket(state)
  const closedQty = position === undefined ? 0 : Math.min(qty, position.qty)
  const closedFloat = position === undefined
    ? 0
    : unrealizedPnlCents({ ...position, qty: closedQty })
  const realized = offset === 'close' && position !== undefined
    ? realizedPnlCents(position.side, position.avgPrice, price, multiplier, closedQty)
    : 0
  const cashAfterCents = offset === 'open'
    ? state.cashCents - marginCents - fees.feesCents
    : state.cashCents + marginCents + realized - fees.feesCents
  const equityAfter = offset === 'open'
    ? marks.equityCents - fees.feesCents
    : marks.equityCents - closedFloat + realized - fees.feesCents
  const marginAfter = offset === 'open' ? marks.marginCents + marginCents : marks.marginCents - marginCents
  const maxQty = offset === 'open' && rate !== undefined && price > 0
    ? maxOpenQty({
        cashCents: state.cashCents,
        price,
        multiplier,
        marginRate: rate,
        feePerLotCents: input.settle?.feePerLotCents ?? position?.feePerLotCents ?? state.settings.defaultFeePerLotCents,
        settings: state.settings,
      })
    : 0

  const volume = input.quote?.volume ?? input.contract?.volume
  if (offset === 'open') {
    if (last === undefined) warnings.push('没有可用行情，暂不可开仓')
    if (input.limit === undefined) warnings.push('涨跌停数据不可用，暂不可开仓')
    else if (price > 0 && (price < input.limit.lower || price > input.limit.upper)) {
      warnings.push(`价格超出涨跌停区间 ${String(input.limit.lower)}–${String(input.limit.upper)}`)
    }
    if (rate === undefined) warnings.push('保证金率不可用，暂不可开仓')
    if (volume !== undefined && !(volume > 0)) warnings.push('当日无成交，暂不可开仓')
    if (input.tradeDaysToDeList !== undefined && input.tradeDaysToDeList <= state.settings.closeBeforeDeListDays) {
      warnings.push(`距最后交易日 ${input.tradeDaysToDeList} 个交易日，禁止开仓`)
    }
    if (cashAfterCents < 0) {
      warnings.push(`保证金不足，还差 ${((marginCents + fees.feesCents - state.cashCents) / 100).toFixed(2)} 元`)
    }
  } else {
    if (position === undefined) warnings.push('没有该方向持仓')
    else if (qty > position.qty) warnings.push(`平仓手数超过持仓（可平 ${position.qty} 手）`)
    if (last === undefined) {
      warnings.push(manual === undefined ? '没有可用行情，请填写参考价平仓' : `无可用行情，使用参考价 ${manual} 手填平仓`)
    }
    if (input.limit !== undefined && price > 0 && (price < input.limit.lower || price > input.limit.upper)) {
      warnings.push(`价格超出涨跌停区间 ${String(input.limit.lower)}–${String(input.limit.upper)}`)
    }
  }
  if (type === 'limit' && last !== undefined && limitPrice !== undefined) {
    const crossed = buy ? last <= limitPrice : last >= limitPrice
    if (!crossed) warnings.push(`现价 ${last} 未到限价 ${limitPrice}，委托将挂单等待`)
  }
  if (session.phase !== 'trading') warnings.push('当前非期货日盘连续交易时段，不能下单')

  return {
    symbol,
    side,
    offset,
    type,
    qty,
    price,
    multiplier,
    amountCents: amount,
    marginCents,
    feesCents: fees.feesCents,
    cashAfterCents,
    equityAfter,
    riskRatioAfter: riskRatioView(marginAfter, equityAfter),
    maxOpenQty: maxQty,
    availableCloseQty: position?.qty ?? 0,
    limit: input.limit === undefined ? undefined : limitView(input.limit, symbol),
    quote: input.quote === undefined ? undefined : quoteView(symbol, input.quote, name),
    session,
    warnings,
  }
}

/** Review statistics: curve, drawdown, fill counts and realized PnL by product. */
export function toReview(state: FuturesAccountState, period: '7d' | '30d' | 'all', nowDate: string): FuturesReviewView {
  const points: FuturesEquityPoint[] = state.dayEquity.map(point => ({
    date: point.date,
    equity: point.equityCents / 100,
    cash: point.cashCents / 100,
    margin: point.marginCents / 100,
  }))
  if (points.length === 0) {
    const marks = markToMarket(state)
    points.push({ date: state.tradeDate, equity: marks.equityCents / 100, cash: state.cashCents / 100, margin: marks.marginCents / 100 })
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
  const openCount = state.fills.filter(fill => fill.offset === 'open').length
  const closeCount = state.fills.length - openCount
  let winCount = 0
  let lossCount = 0
  const byProduct = new Map<string, FuturesProductStat>()
  for (const fill of state.fills) {
    const stat = byProduct.get(fill.product) ?? { product: fill.product, tradeCount: 0, realizedPnl: 0 }
    stat.tradeCount += 1
    if (fill.offset === 'close') {
      const net = fill.realizedPnlCents - fill.feesCents
      if (net > 0) winCount += 1
      else if (net < 0) lossCount += 1
      stat.realizedPnl += fill.realizedPnlCents / 100
    }
    byProduct.set(fill.product, stat)
  }
  return {
    equityCurve: filtered,
    maxDrawdownPct: maxDrawdown,
    tradeCount: state.fills.length,
    openCount,
    closeCount,
    winCount,
    lossCount,
    totalFees: state.fills.reduce((sum, fill) => sum + fill.feesCents, 0) / 100,
    realizedPnl: state.fills.reduce((sum, fill) => sum + fill.realizedPnlCents, 0) / 100,
    byProduct: [...byProduct.values()].sort((a, b) => b.tradeCount - a.tradeCount || a.product.localeCompare(b.product)),
  }
}
