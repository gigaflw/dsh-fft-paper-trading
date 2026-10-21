import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../lib/contract.js'
import { computeFees } from '../lib/core/fees.js'
import { decideFill } from '../lib/core/matching.js'
import { checkOrder } from '../lib/core/risk.js'
import { openAccount, submit, tick } from '../lib/core/engine.js'
import { emptyState } from '../lib/core/ledger.js'
import { replay } from '../lib/core/replay.js'

const DAY1 = '2026-10-19T02:00:00.000Z'
const DAY2 = '2026-10-20T02:00:00.000Z'

function quote(price, ts = DAY1) {
  return { symbol: '600519', name: '贵州茅台', last: price, bid: price - 0.01, ask: price, ts }
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

test('matching: market pays ask plus slippage; limit is capped', () => {
  const market = { id: 'o', requestId: 'r', symbol: '600519', side: 'buy', type: 'market', qty: 100, status: 'pending', createdAt: DAY1, updatedAt: DAY1, tradeDate: '2026-10-19' }
  const filled = decideFill(market, quote(10), DEFAULT_SETTINGS, Date.parse(DAY1))
  assert.equal(filled.fill, true)
  assert.equal(filled.price, 10.01)

  const limit = { ...market, type: 'limit', limitPrice: 9.98 }
  const capped = decideFill(limit, quote(10), DEFAULT_SETTINGS, Date.parse(DAY1))
  assert.equal(capped.fill, false)

  const crossed = decideFill({ ...limit, limitPrice: 10 }, quote(10), DEFAULT_SETTINGS, Date.parse(DAY1))
  assert.equal(crossed.fill, true)
  assert.equal(crossed.price, 10)
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

test('engine: buy fills, replay is deterministic, next day unlocks', () => {
  const open = openAccount(emptyState('t'), DEFAULT_SETTINGS, '2026-10-19', DAY1, 't')
  const bought = submit(open.state, { symbol: '600519', side: 'buy', type: 'market', qty: 100 }, quote(10), 'r1', DAY1)
  assert.equal(bought.order.status, 'filled')
  assert.equal(bought.state.cashCents, 10_000_000 - 100_100 - 501)
  assert.equal(bought.state.positions['600519'].available, 0)

  const events = [...open.events, ...bought.events]
  const replayed = replay(events, 't')
  assert.deepEqual(replayed.issues, [])
  assert.equal(JSON.stringify(replayed.state.positions), JSON.stringify(bought.state.positions))
  assert.equal(replayed.state.cashCents, bought.state.cashCents)

  const ticked = tick(bought.state, [quote(10.2, DAY2)], DAY2)
  assert.equal(ticked.expired.length, 0)
  assert.equal(ticked.state.positions['600519'].available, 100)
  assert.equal(ticked.state.dayEquity.length, 1)
  assert.equal(ticked.state.dayEquity[0].date, '2026-10-19')
  assert.equal(ticked.state.tradeDate, '2026-10-20')
})

test('engine: limit order stays pending then fills on tick', () => {
  const open = openAccount(emptyState('t'), DEFAULT_SETTINGS, '2026-10-19', DAY1, 't')
  const placed = submit(open.state, { symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 9.5 }, quote(10), 'r1', DAY1)
  assert.equal(placed.order.status, 'pending')
  const ticked = tick(placed.state, [quote(9.4, DAY1)], DAY1)
  assert.equal(ticked.filled.length, 1)
  assert.equal(ticked.filled[0].status, 'filled')
})
