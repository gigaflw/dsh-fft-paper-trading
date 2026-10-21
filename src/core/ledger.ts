import type { PaperSettings } from '../contract.js'
import type { AccountState, FillRecord, LedgerEvent } from './types.js'

export function emptyState(accountId: string): AccountState {
  return {
    accountId,
    version: 1,
    initialCashCents: 0,
    cashCents: 0,
    settings: {
      initialCashCents: 0,
      commissionRate: 0,
      minCommissionCents: 0,
      stampDutyRate: 0,
      transferFeeRate: 0,
      slippageBps: 0,
      enableT1: true,
      quoteTtlSec: 30,
      maxOrderNotionalCents: 0,
    },
    positions: {},
    orders: {},
    fills: [],
    tradeDate: '',
    blocked: false,
    lastSeq: 0,
    createdAt: '',
    dayEquity: [],
  }
}

function openState(state: AccountState, settings: PaperSettings, initialCashCents: number, tradeDate: string): void {
  state.initialCashCents = initialCashCents
  state.cashCents = initialCashCents
  state.settings = settings
  state.positions = {}
  state.orders = {}
  state.fills = []
  state.dayEquity = []
  state.tradeDate = tradeDate
  state.blocked = false
}

function applyFill(state: AccountState, fill: FillRecord): void {
  const amount = fill.amountCents
  const fees = fill.fees.totalCents
  const position = state.positions[fill.symbol] ?? {
    symbol: fill.symbol,
    name: fill.name,
    qty: 0,
    available: 0,
    costCents: 0,
  }
  if (fill.side === 'buy') {
    state.cashCents -= amount + fees
    position.qty += fill.qty
    if (!state.settings.enableT1) position.available += fill.qty
    position.costCents += amount + fees
    if (fill.name && !position.name) position.name = fill.name
    position.lastPrice = fill.price
    position.lastTs = fill.ts
    state.positions[fill.symbol] = position
  } else {
    state.cashCents += amount - fees
    const oldQty = position.qty
    position.qty -= fill.qty
    position.available = Math.max(0, position.available - fill.qty)
    if (position.qty <= 0) {
      delete state.positions[fill.symbol]
    } else {
      position.costCents = oldQty > 0 ? Math.round((position.costCents * position.qty) / oldQty) : 0
      position.lastPrice = fill.price
      position.lastTs = fill.ts
      state.positions[fill.symbol] = position
    }
  }
  state.fills.push(fill)
}

/** Apply one ledger event in place. Callers own cloning. */
export function applyEvent(state: AccountState, event: LedgerEvent): AccountState {
  switch (event.type) {
    case 'account.opened': {
      const { settings, initialCashCents, tradeDate, accountId } = event.payload
      openState(state, settings, initialCashCents, tradeDate)
      state.accountId = accountId
      state.createdAt = event.ts
      break
    }
    case 'account.reset': {
      const { settings, initialCashCents, tradeDate } = event.payload
      openState(state, settings, initialCashCents, tradeDate)
      break
    }
    case 'order.submitted': {
      state.orders[event.payload.order.id] = { ...event.payload.order }
      break
    }
    case 'order.rejected': {
      state.orders[event.payload.order.id] = { ...event.payload.order, status: 'rejected', reason: event.payload.reason }
      break
    }
    case 'order.filled': {
      const order = state.orders[event.payload.orderId]
      const fill = event.payload.fill
      if (order !== undefined) {
        order.status = 'filled'
        order.filledAt = fill.ts
        order.fillPrice = fill.price
        order.fees = fill.fees
        order.updatedAt = fill.ts
      }
      applyFill(state, fill)
      break
    }
    case 'order.canceled': {
      const order = state.orders[event.payload.orderId]
      if (order !== undefined) {
        order.status = event.payload.reason === 'expired' ? 'expired' : 'canceled'
        order.reason = event.payload.reason
        order.updatedAt = event.payload.at
      }
      break
    }
    case 'day.closed': {
      const point = event.payload
      const index = state.dayEquity.findIndex(item => item.date === point.date)
      if (index >= 0) state.dayEquity[index] = point
      else state.dayEquity.push(point)
      state.dayEquity.sort((a, b) => a.date.localeCompare(b.date))
      state.tradeDate = point.nextDate ?? point.date
      if (state.settings.enableT1) {
        for (const position of Object.values(state.positions)) position.available = position.qty
      }
      break
    }
    case 'ledger.violation': {
      state.blocked = true
      break
    }
  }
  state.lastSeq = Math.max(state.lastSeq, event.seq)
  return state
}

/** Structural invariants checked after replay and before every write. */
export function verify(state: AccountState): string[] {
  const issues: string[] = []
  if (!Number.isFinite(state.cashCents) || state.cashCents < 0) {
    issues.push(`现金为负或非法: ${state.cashCents}`)
  }
  for (const position of Object.values(state.positions)) {
    if (position.qty < 0 || !Number.isInteger(position.qty)) issues.push(`${position.symbol} 数量非法: ${position.qty}`)
    if (position.available < 0 || position.available > position.qty) {
      issues.push(`${position.symbol} 可卖数量越界: ${position.available}/${position.qty}`)
    }
  }
  let expected = state.initialCashCents
  for (const fill of state.fills) {
    const fees = fill.fees.totalCents
    expected += fill.side === 'buy' ? -(fill.amountCents + fees) : fill.amountCents - fees
  }
  if (expected !== state.cashCents) {
    issues.push(`现金与成交不一致: 期望 ${expected}，实际 ${state.cashCents}`)
  }
  for (const order of Object.values(state.orders)) {
    if (order.status === 'filled') {
      const fill = state.fills.find(item => item.orderId === order.id)
      if (fill === undefined) issues.push(`订单 ${order.id} 已成交但无成交记录`)
    }
  }
  return issues
}
