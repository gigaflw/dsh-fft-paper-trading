import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../lib/contract.js'
import { computeFees } from '../lib/core/fees.js'
import { decideFill } from '../lib/core/matching.js'
import { checkOrder } from '../lib/core/risk.js'
import { closeDay, fillQty, openAccount, openDay, submit, tick } from '../lib/core/engine.js'
import { emptyState } from '../lib/core/ledger.js'
import { replay } from '../lib/core/replay.js'
import { previewOrder } from '../lib/core/views.js'

const DAY1 = '2026-10-19T02:00:00.000Z'
const DAY2 = '2026-10-20T02:00:00.000Z'

function quote(price, ts = DAY1) {
  return { symbol: '600519', name: '贵州茅台', last: price, marketTs: ts, fetchedAt: ts }
}

test('fees: minimum commission and sell-side stamp duty', () => {
  const buy = computeFees(1_000_000, 'buy', DEFAULT_SETTINGS)
  assert.equal(buy.commissionCents, 500)
  assert.equal(buy.stampCents, 0)
  assert.equal(buy.transferCents, 10)
  assert.equal(buy.totalCents, 510)
  const sell = computeFees(1_000_000, 'sell', DEFAULT_SETTINGS)
  assert.equal(sell.stampCents, 500)
  assert.equal(sell.totalCents, 1010)
})

test('matching: M2 fills at last with no slippage, volume cap or TTL', () => {
  const market = { id: 'o', requestId: 'r', symbol: '600519', side: 'buy', type: 'market', qty: 100, status: 'pending', createdAt: DAY1, updatedAt: DAY1, tradeDate: '2026-10-19' }
  const filled = decideFill(market, quote(10))
  assert.equal(filled.fill, true)
  assert.equal(filled.price, 10)

  // An old marketTs is still executable: M2 has no quote TTL gate.
  const stale = decideFill(market, quote(10, '2026-10-18T02:00:00.000Z'))
  assert.equal(stale.fill, true)
  assert.equal(stale.price, 10)

  // Only a missing/zero last price blocks a fill.
  assert.equal(decideFill(market, quote(0)).fill, false)
  assert.equal(decideFill(market, { ...quote(10), last: Number.NaN }).fill, false)

  // A buy limit rests until last <= limit, then fills at last (not at the limit).
  const limit = { ...market, type: 'limit', limitPrice: 9.98 }
  const resting = decideFill(limit, quote(10))
  assert.equal(resting.fill, false)
  assert.equal(resting.reason, 'NOT_CROSSED')
  const crossed = decideFill({ ...limit, limitPrice: 10.5 }, quote(10))
  assert.equal(crossed.fill, true)
  assert.equal(crossed.price, 10)

  // A sell limit rests until last >= limit, then fills at last.
  const sell = { ...market, side: 'sell', type: 'limit', limitPrice: 10.5 }
  assert.equal(decideFill(sell, quote(10)).fill, false)
  const sellCrossed = decideFill({ ...sell, limitPrice: 9.5 }, quote(10))
  assert.equal(sellCrossed.fill, true)
  assert.equal(sellCrossed.price, 10)
})

test('engine: fillQty takes the whole remaining quantity in one chunk', () => {
  assert.equal(fillQty({ remainingQty: 1_000 }), 1_000)
  assert.equal(fillQty({ remainingQty: 0 }), 0)
  assert.equal(fillQty({ remainingQty: Number.NaN }), 0)
})

test('risk: lot, cash and T+1 rejection codes', () => {
  let state = openAccount(emptyState('t'), DEFAULT_SETTINGS, '2026-10-19', DAY1, 't').state
  const odd = checkOrder(state, { symbol: '600519', side: 'buy', type: 'market', qty: 150 }, quote(10), DEFAULT_SETTINGS)
  assert.equal(odd.ok, false)
  assert.equal(odd.code, 'INVALID_LOT')

  const tooBig = checkOrder(state, { symbol: '600519', side: 'buy', type: 'market', qty: 1_000_000 }, quote(10), DEFAULT_SETTINGS)
  assert.equal(tooBig.ok, false)
  assert.equal(tooBig.code, 'INSUFFICIENT_CASH')

  const bought = submit(state, { symbol: '600519', side: 'buy', type: 'market', qty: 100 }, quote(10), 'r1', DAY1)
  state = bought.state
  const sell = checkOrder(state, { symbol: '600519', side: 'sell', type: 'market', qty: 100 }, quote(10), DEFAULT_SETTINGS)
  assert.equal(sell.ok, false)
  assert.equal(sell.code, 'T1_LOCKED')
})

test('preview: T+1 locked holdings are reported as a lock, not a missing holding', () => {
  const open = openAccount(emptyState('t'), DEFAULT_SETTINGS, '2026-10-19', DAY1, 't')
  const bought = submit(open.state, { symbol: '600519', side: 'buy', type: 'market', qty: 100 }, quote(10), 'r1', DAY1)
  const locked = previewOrder(bought.state, { symbol: '600519', side: 'sell', type: 'market', qty: 100 }, quote(10), DEFAULT_SETTINGS)
  assert.equal(locked.availableQty, 0)
  assert.ok(locked.warnings.some(text => text.includes('T+1') && text.includes('下一交易日可卖')), JSON.stringify(locked.warnings))

  // Asking for more than the book holds keeps the generic shortfall wording.
  const oversell = previewOrder(bought.state, { symbol: '600519', side: 'sell', type: 'market', qty: 200 }, quote(10), DEFAULT_SETTINGS)
  assert.equal(oversell.warnings.some(text => text.includes('T+1')), false)
  assert.ok(oversell.warnings.some(text => text.includes('可卖不足')), JSON.stringify(oversell.warnings))
})

test('engine: buy fills, replay is deterministic, close/open moves the day', () => {
  const open = openAccount(emptyState('t'), DEFAULT_SETTINGS, '2026-10-19', DAY1, 't')
  const bought = submit(open.state, { symbol: '600519', side: 'buy', type: 'market', qty: 100 }, quote(10), 'r1', DAY1)
  assert.equal(bought.order.status, 'filled')
  assert.equal(bought.state.cashCents, 10_000_000 - 100_000 - 501)
  assert.equal(bought.state.positions['600519'].available, 0)

  const events = [...open.events, ...bought.events]
  const replayed = replay(events, 't')
  assert.deepEqual(replayed.issues, [])
  assert.equal(JSON.stringify(replayed.state.positions), JSON.stringify(bought.state.positions))
  assert.equal(replayed.state.cashCents, bought.state.cashCents)

  const closed = closeDay(bought.state, {
    date: '2026-10-19',
    nextTradeDate: '2026-10-20',
    ts: '2026-10-19T07:00:00.000Z',
    recordedAt: '2026-10-19T07:00:00.000Z',
    quotes: [quote(10.2, '2026-10-19T07:00:00.000Z')],
    closeSource: 'last',
  })
  assert.equal(closed.state.dayEquity.length, 1)
  assert.equal(closed.state.dayEquity[0].date, '2026-10-19')
  assert.equal(closed.state.positions['600519'].available, 0)
  assert.equal(closed.state.tradeDate, '2026-10-19')

  const opened = openDay(closed.state, {
    date: '2026-10-20',
    ts: '2026-10-20T01:30:00.000Z',
    recordedAt: '2026-10-20T01:30:00.000Z',
    quotes: [{ ...quote(10.3, '2026-10-19T07:00:00.000Z'), prevClose: 10.2 }],
  })
  assert.equal(opened.state.tradeDate, '2026-10-20')
  assert.equal(opened.state.positions['600519'].available, 100)
  assert.equal(opened.state.lastOpenedDate, '2026-10-20')
})

test('engine: limit order stays pending then fills in full on tick', () => {
  const open = openAccount(emptyState('t'), DEFAULT_SETTINGS, '2026-10-19', DAY1, 't')
  const placed = submit(open.state, { symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 9.5 }, quote(10), 'r1', DAY1)
  assert.equal(placed.order.status, 'pending')
  const ticked = tick(placed.state, [quote(9.5, DAY1)], DAY1)
  assert.equal(ticked.filled.length, 1)
  assert.equal(ticked.filled[0].status, 'filled')
  assert.equal(ticked.filled[0].filledQty, 100)
  assert.equal(ticked.filled[0].fillPrice, 9.5)
})

test('engine: an unfilled limit expires when the day closes', () => {
  const open = openAccount(emptyState('t'), DEFAULT_SETTINGS, '2026-10-19', DAY1, 't')
  const placed = submit(open.state, { symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 9.5 }, quote(10), 'r1', DAY1)
  assert.equal(placed.order.status, 'pending')
  const closed = closeDay(placed.state, {
    date: '2026-10-19',
    nextTradeDate: '2026-10-20',
    ts: '2026-10-19T07:00:00.000Z',
    recordedAt: '2026-10-19T07:00:00.000Z',
    quotes: [quote(10.2, '2026-10-19T07:00:00.000Z')],
    closeSource: 'last',
  })
  assert.equal(closed.state.orders[placed.order.id].status, 'expired')
})

test('ledger: replaying an old account.opened pins the M2 settings', () => {
  const old = {
    seq: 1,
    id: 'evt-1',
    ts: DAY1,
    type: 'account.opened',
    payload: {
      accountId: 't',
      settings: { ...DEFAULT_SETTINGS, slippageBps: 5, fillModel: 'volume-share' },
      initialCashCents: 1_000_000,
      tradeDate: '2026-10-19',
      ledgerVersion: 1,
    },
  }
  const { state, issues } = replay([old], 't')
  assert.deepEqual(issues, [])
  assert.equal(state.settings.slippageBps, 0)
  assert.equal(state.settings.fillModel, 'unlimited')
  assert.equal(state.ledgerVersion, 1)
})
