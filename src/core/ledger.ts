import type { PaperSettings } from '../contract.js'
import { PAPER_LEDGER_VERSION } from '../contract.js'
import type { AccountState, FillRecord, LedgerEvent, Order } from './types.js'
import { normalizeSettings } from './settings.js'

export function emptyState(accountId: string): AccountState {
  return {
    accountId,
    version: 1,
    ledgerVersion: PAPER_LEDGER_VERSION,
    initialCashCents: 0,
    cashCents: 0,
    settings: {
      initialCashCents: 0,
      commissionRate: 0,
      minCommissionCents: 0,
      stampDutyRate: 0,
      transferFeeRate: 0,
      enableT1: true,
      maxOrderNotionalCents: 0,
    },
    positions: {},
    orders: {},
    fills: [],
    cashFlows: [],
    tradeDate: '',
    lastOpenedDate: '',
    blocked: false,
    lastSeq: 0,
    createdAt: '',
    dayEquity: [],
    gaps: {},
  }
}

function openState(state: AccountState, settings: PaperSettings, initialCashCents: number, tradeDate: string): void {
  state.initialCashCents = initialCashCents
  state.cashCents = initialCashCents
  // Never install a partial settings object; `normalizeSettings` fills every
  // missing field so the next fill cannot multiply by `undefined`.
  state.settings = normalizeSettings(settings)
  state.positions = {}
  state.orders = {}
  state.fills = []
  state.cashFlows = []
  state.dayEquity = []
  state.gaps = {}
  state.tradeDate = tradeDate
  state.lastOpenedDate = ''
  state.blocked = false
  state.blockedReason = undefined
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

/** Fill legacy orders that predate the partial-fill fields. */
function orderOf(state: AccountState, order: Order): Order {
  order.filledQty ??= order.status === 'filled' ? order.qty : 0
  order.remainingQty ??= Math.max(0, order.qty - order.filledQty)
  return order
}

function applyFillToOrder(order: Order, fill: FillRecord, complete: boolean): void {
  const previousQty = order.filledQty
  const nextQty = previousQty + fill.qty
  const previousCost = (order.avgFillPrice ?? fill.price) * previousQty
  order.filledQty = nextQty
  order.remainingQty = Math.max(0, order.qty - nextQty)
  order.avgFillPrice = nextQty > 0 ? (previousCost + fill.price * fill.qty) / nextQty : fill.price
  order.fillPrice = fill.price
  order.fees = order.fees === undefined
    ? fill.fees
    : {
        commissionCents: order.fees.commissionCents + fill.fees.commissionCents,
        stampCents: order.fees.stampCents + fill.fees.stampCents,
        transferCents: order.fees.transferCents + fill.fees.transferCents,
        totalCents: order.fees.totalCents + fill.fees.totalCents,
      }
  order.status = complete || order.remainingQty === 0 ? 'filled' : 'partially_filled'
  if (order.status === 'filled') order.filledAt = fill.ts
  order.updatedAt = fill.ts
}

/** Apply one ledger event in place. Callers own cloning. */
export function applyEvent(state: AccountState, event: LedgerEvent): AccountState {
  switch (event.type) {
    case 'account.opened': {
      const { settings, initialCashCents, tradeDate, accountId, ledgerVersion } = event.payload
      const version = ledgerVersion ?? 1
      openState(state, settings, initialCashCents, tradeDate)
      state.accountId = accountId
      state.ledgerVersion = version
      state.createdAt = event.ts
      // v4 made `code.exchange` the ledger identity. An older file keyed
      // positions by the raw input (`000001` vs `000001.SZ` were two books), so
      // it cannot be replayed faithfully: lock the account and ask for a reset.
      if (version !== PAPER_LEDGER_VERSION) {
        state.blocked = true
        state.blockedReason = `账本版本 ${version} 与当前 ${PAPER_LEDGER_VERSION} 不兼容，请重置账户`
      }
      break
    }
    case 'account.reset': {
      const { settings, initialCashCents, tradeDate } = event.payload
      openState(state, settings, initialCashCents, tradeDate)
      state.ledgerVersion = PAPER_LEDGER_VERSION
      // A reset can be the genesis event of a compacted ledger; then it is the
      // only source of an account creation time.
      if (state.createdAt === '') state.createdAt = event.ts
      break
    }
    case 'order.submitted': {
      const order = orderOf(state, { ...event.payload.order })
      state.orders[order.id] = order
      break
    }
    case 'order.rejected': {
      const order = orderOf(state, { ...event.payload.order })
      order.status = 'rejected'
      order.reason = event.payload.reason
      state.orders[order.id] = order
      break
    }
    case 'order.partially_filled': {
      const order = state.orders[event.payload.orderId]
      const fill = event.payload.fill
      if (order !== undefined) applyFillToOrder(orderOf(state, order), fill, false)
      applyFill(state, fill)
      break
    }
    case 'order.filled': {
      const order = state.orders[event.payload.orderId]
      const fill = event.payload.fill
      if (order !== undefined) applyFillToOrder(orderOf(state, order), fill, true)
      applyFill(state, fill)
      break
    }
    case 'order.canceled': {
      const order = state.orders[event.payload.orderId]
      if (order !== undefined) {
        order.status = event.payload.reason === 'expired' ? 'expired' : 'canceled'
        order.reason = event.payload.reason
        order.updatedAt = event.payload.at
        order.remainingQty = Math.max(0, order.qty - (order.filledQty ?? 0))
      }
      break
    }
    case 'order.released': {
      const order = state.orders[event.payload.orderId]
      if (order !== undefined && order.status === 'queued') {
        order.status = 'pending'
        order.updatedAt = event.payload.at
      }
      break
    }
    case 'day.pre_opened': {
      // The new trade date starts with the opening auction; T+1 stays locked
      // until day.opened at 09:30.
      state.tradeDate = event.payload.date
      break
    }
    case 'day.opened': {
      const point = event.payload
      state.tradeDate = point.date
      state.lastOpenedDate = point.date
      state.gaps = point.gaps
      for (const position of Object.values(state.positions)) {
        if (state.settings.enableT1) position.available = position.qty
        const open = point.openPrices[position.symbol]
        if (open !== undefined) {
          position.lastPrice = open
          position.lastTs = event.ts
        }
      }
      break
    }
    case 'day.closed': {
      const point = event.payload
      const index = state.dayEquity.findIndex(item => item.date === point.date)
      if (index >= 0) state.dayEquity[index] = point
      else state.dayEquity.push(point)
      state.dayEquity.sort((a, b) => a.date.localeCompare(b.date))
      // v2 advances the trade date and unlocks T+1 at the next open.
      if (state.ledgerVersion < 2) {
        state.tradeDate = point.nextDate ?? point.date
        if (state.settings.enableT1) {
          for (const position of Object.values(state.positions)) position.available = position.qty
        }
      }
      break
    }
    case 'cash.deposit': {
      const { amountCents, tradeDate } = event.payload
      state.cashCents += amountCents
      state.cashFlows.push({ ts: event.ts, type: 'deposit', amountCents, tradeDate })
      break
    }
    case 'cash.withdraw': {
      const { amountCents, tradeDate } = event.payload
      state.cashCents -= amountCents
      state.cashFlows.push({ ts: event.ts, type: 'withdraw', amountCents, tradeDate })
      break
    }
    case 'ledger.violation': {
      state.blocked = true
      state.blockedReason = event.payload.actual === '' ? undefined : event.payload.actual
      break
    }
    case 'ledger.repaired': {
      // Load-time repair (duplicate seq dropped) is auditable but changes no
      // account value; `lastSeq` advances below like every other event.
      break
    }
  }
  state.lastSeq = Math.max(state.lastSeq, event.seq)
  return state
}

/** Structural invariants checked after replay and before every write. */
export function verify(state: AccountState): string[] {
  const issues: string[] = []
  if (!Number.isFinite(state.cashCents) || !Number.isInteger(state.cashCents) || state.cashCents < 0) {
    issues.push(`现金为负或非法: ${state.cashCents}`)
  }
  for (const position of Object.values(state.positions)) {
    if (position.qty < 0 || !Number.isInteger(position.qty)) issues.push(`${position.symbol} 数量非法: ${position.qty}`)
    if (position.available < 0 || position.available > position.qty) {
      issues.push(`${position.symbol} 可卖数量越界: ${position.available}/${position.qty}`)
    }
  }
  let expected = state.initialCashCents
  for (const flow of state.cashFlows) {
    if (!Number.isInteger(flow.amountCents) || flow.amountCents <= 0) {
      issues.push(`出入金金额非法: ${flow.amountCents}`)
    }
    expected += flow.type === 'deposit' ? flow.amountCents : -flow.amountCents
  }
  for (const fill of state.fills) {
    const fees = fill.fees.totalCents
    expected += fill.side === 'buy' ? -(fill.amountCents + fees) : fill.amountCents - fees
  }
  if (expected !== state.cashCents) {
    issues.push(`现金与成交不一致: 期望 ${expected}，实际 ${state.cashCents}`)
  }
  for (const fill of state.fills) {
    if (!Number.isInteger(fill.qty) || fill.qty <= 0) issues.push(`成交数量非法: ${String(fill.qty)}`)
    if (!Number.isFinite(fill.price) || fill.price <= 0) issues.push(`成交价格非法: ${String(fill.price)}`)
    if (!Number.isFinite(fill.amountCents)) issues.push(`成交金额非法: ${String(fill.amountCents)}`)
    if (fill.fees === undefined || !Number.isFinite(fill.fees.totalCents)) {
      issues.push(`成交费用非法: ${String(fill.fees?.totalCents)}`)
    }
  }
  for (const order of Object.values(state.orders)) {
    const filledQty = order.filledQty ?? 0
    if (filledQty > order.qty) issues.push(`订单 ${order.id} 成交数量超过委托`)
    if (order.status === 'filled' && !state.fills.some(item => item.orderId === order.id)) {
      issues.push(`订单 ${order.id} 已成交但无成交记录`)
    }
  }
  return issues
}
