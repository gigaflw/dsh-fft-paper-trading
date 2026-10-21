import type { PaperSettings, Quote } from '../contract.js'
import type { AccountState, DayPoint, FillRecord, LedgerEvent, Order } from './types.js'
import { tradeDateOf } from './calendar.js'
import { amountCents } from './money.js'
import { computeFees } from './fees.js'
import { decideFill } from './matching.js'
import { checkOrder } from './risk.js'
import { applyEvent } from './ledger.js'

export interface EngineResult {
  events: LedgerEvent[]
  state: AccountState
  order?: Order
}

function clone(state: AccountState): AccountState {
  return structuredClone(state)
}

type EventSpec = { type: LedgerEvent['type']; payload: unknown }

/** Append one event with the next sequence number and fold it into `state`. */
function append(state: AccountState, events: LedgerEvent[], spec: EventSpec, ts: string): LedgerEvent {
  const seq = state.lastSeq + 1
  const event = { seq, id: `evt-${seq}`, ts, type: spec.type, payload: spec.payload } as LedgerEvent
  events.push(event)
  applyEvent(state, event)
  return event
}

export function openAccount(
  state: AccountState,
  settings: PaperSettings,
  tradeDate: string,
  ts: string,
  accountId: string,
): EngineResult {
  const working = clone(state)
  const events: LedgerEvent[] = []
  append(working, events, {
    type: 'account.opened',
    payload: { accountId, settings, initialCashCents: settings.initialCashCents, tradeDate },
  }, ts)
  return { events, state: working }
}

export function resetAccount(
  state: AccountState,
  settings: PaperSettings,
  tradeDate: string,
  ts: string,
  reason: string,
): EngineResult {
  const working = clone(state)
  const events: LedgerEvent[] = []
  append(working, events, {
    type: 'account.reset',
    payload: { settings, initialCashCents: settings.initialCashCents, tradeDate, reason },
  }, ts)
  return { events, state: working }
}

function makeFill(order: Order, price: number, ts: string, settings: PaperSettings): FillRecord {
  const amount = amountCents(price, order.qty)
  return {
    id: `fill-${order.id}`,
    orderId: order.id,
    symbol: order.symbol,
    name: order.name,
    side: order.side,
    price,
    qty: order.qty,
    amountCents: amount,
    fees: computeFees(amount, order.side, settings),
    ts,
    tradeDate: tradeDateOf(ts),
  }
}

/**
 * Submit one order and, when it crosses immediately, fill it in the same batch.
 * Risk runs before any event is written; a rejection is still a ledger event.
 */
export function submit(
  state: AccountState,
  draft: {
    symbol: string
    side: 'buy' | 'sell'
    type: 'market' | 'limit'
    qty: number
    limitPrice?: number
    price?: number
    name?: string
  },
  quote: Quote | null,
  requestId: string,
  ts: string,
): EngineResult {
  const working = clone(state)
  const events: LedgerEvent[] = []
  const tradeDate = tradeDateOf(ts)
  const order: Order = {
    id: `ord-${tradeDate}-${state.lastSeq + 1}`,
    requestId,
    symbol: draft.symbol.trim(),
    name: draft.name ?? quote?.name,
    side: draft.side,
    type: draft.type,
    qty: draft.qty,
    limitPrice: draft.limitPrice,
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
    tradeDate,
  }
  const risk = checkOrder(working, draft, quote, working.settings)
  if (!risk.ok) {
    const rejected: Order = { ...order, status: 'rejected', reason: `${risk.code}: ${risk.message}` }
    append(working, events, {
      type: 'order.rejected',
      payload: { order: rejected, reason: `${risk.code}: ${risk.message}` },
    }, ts)
    return { events, state: working, order: working.orders[rejected.id] }
  }

  append(working, events, { type: 'order.submitted', payload: { order, quote } }, ts)
  if (quote !== null) {
    const decision = decideFill(order, quote, working.settings, Date.parse(ts))
    if (decision.fill && decision.price !== undefined) {
      append(working, events, {
        type: 'order.filled',
        payload: { orderId: order.id, fill: makeFill(order, decision.price, ts, working.settings) },
      }, ts)
    }
  }
  return { events, state: working, order: working.orders[order.id] }
}

export function cancelOrder(state: AccountState, orderId: string, ts: string): EngineResult {
  const order = state.orders[orderId]
  if (order === undefined) return { events: [], state, order: undefined }
  if (order.status !== 'pending') return { events: [], state, order }
  const working = clone(state)
  const events: LedgerEvent[] = []
  append(working, events, { type: 'order.canceled', payload: { orderId, reason: 'user', at: ts } }, ts)
  return { events, state: working, order: working.orders[orderId] }
}

export interface TickResult extends EngineResult {
  filled: Order[]
  expired: Order[]
  notices: string[]
}

/**
 * Refresh prices and process pending orders. The service calls this on demand;
 * there is no background loop in the MVP.
 */
export function tick(state: AccountState, quotes: Quote[], ts: string): TickResult {
  const working = clone(state)
  const events: LedgerEvent[] = []
  const filled: Order[] = []
  const expired: Order[] = []
  const notices: string[] = []
  const tradeDate = tradeDateOf(ts)

  if (state.tradeDate !== '' && tradeDate > state.tradeDate) {
    const closed: DayPoint = { date: working.tradeDate, equityCents: equityCents(working), cashCents: working.cashCents, nextDate: tradeDate }
    append(working, events, { type: 'day.closed', payload: closed }, ts)
    for (const order of Object.values(working.orders)) {
      if (order.status !== 'pending') continue
      append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'expired', at: ts } }, ts)
      expired.push(working.orders[order.id])
    }
  }

  const quoteMap = new Map(quotes.map(quote => [quote.symbol, quote]))
  for (const quote of quotes) {
    const position = working.positions[quote.symbol]
    if (position !== undefined) {
      position.lastPrice = quote.last
      position.lastTs = quote.ts
    }
  }

  for (const order of Object.values(working.orders)) {
    if (order.status !== 'pending') continue
    const quote = quoteMap.get(order.symbol)
    if (quote === undefined) continue
    const decision = decideFill(order, quote, working.settings, Date.parse(ts))
    if (!decision.fill || decision.price === undefined) continue
    if (order.side === 'buy') {
      const amount = amountCents(decision.price, order.qty)
      const fees = computeFees(amount, 'buy', working.settings)
      if (working.cashCents < amount + fees.totalCents) {
        append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'insufficient_cash', at: ts } }, ts)
        notices.push(`${order.symbol} 挂单因资金不足取消`)
        continue
      }
    } else {
      const position = working.positions[order.symbol]
      if (position === undefined || position.available < order.qty) {
        append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'insufficient_position', at: ts } }, ts)
        notices.push(`${order.symbol} 挂单因可卖不足取消`)
        continue
      }
    }
    append(working, events, {
      type: 'order.filled',
      payload: { orderId: order.id, fill: makeFill(order, decision.price, ts, working.settings) },
    }, ts)
    filled.push(working.orders[order.id])
  }

  return { events, state: working, filled, expired, notices }
}

/** Mark-to-market equity in cents; falls back to cost basis when no price is known. */
export function equityCents(state: AccountState): number {
  let market = 0
  for (const position of Object.values(state.positions)) {
    market += position.lastPrice === undefined
      ? position.costCents
      : amountCents(position.lastPrice, position.qty)
  }
  return state.cashCents + market
}
