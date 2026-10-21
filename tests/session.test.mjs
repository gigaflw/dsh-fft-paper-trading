import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PaperService } from '../lib/service/paper-service.js'
import { AccountRepo } from '../lib/store/repo.js'
import { EventStore } from '../lib/store/event-store.js'
import { eventsPath } from '../lib/store/paths.js'
import { replay } from '../lib/core/replay.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'
import { canMatch, canSubmit, nextBoundary, sessionPhaseAt } from '../lib/core/session.js'
import { priceLimitFor } from '../lib/core/price-limit.js'

const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+08:00`)

function makeData() {
  const prices = new Map()
  const volumes = new Map()
  return {
    prices,
    volumes,
    async quotes(symbols) {
      const rows = symbols.map(symbol => prices.get(symbol)).filter(Boolean)
      return rows.length > 0 ? { state: 'ok', quotes: rows } : { state: 'failed', quotes: [], notice: 'no quote' }
    },
    async dailyBars() {
      return { state: 'ok', bars: [] }
    },
    async minuteBars(symbol) {
      const volume = volumes.get(symbol)
      if (volume === undefined) return { state: 'ok', bars: [] }
      return {
        state: 'ok',
        bars: [{ time: '2026-10-21T02:00:00.000Z', open: 10, high: 10, low: 10, close: 10, volume }],
      }
    },
    async search() {
      return []
    },
    async marketList() {
      return { state: 'ok', quotes: [], page: 1 }
    },
  }
}

function setQuote(data, price, ts, extra = {}) {
  const quote = { symbol: '600519', name: '贵州茅台', last: price, marketTs: ts, fetchedAt: ts, ...extra }
  data.prices.set('600519', quote)
  return quote
}

function makeService(home, data, now) {
  const repo = new AccountRepo({ home, accountId: 'default' })
  return new PaperService({
    repo,
    data,
    calendar: new WeekdayTradingCalendar(),
    now: () => now.current,
  })
}

test('session: phases, gates and boundaries', () => {
  assert.equal(sessionPhaseAt(at('2026-10-21', '08:00').toISOString()), 'closed')
  assert.equal(sessionPhaseAt(at('2026-10-21', '09:20').toISOString()), 'pre_open')
  assert.equal(sessionPhaseAt(at('2026-10-21', '09:30').toISOString()), 'continuous_am')
  assert.equal(sessionPhaseAt(at('2026-10-21', '11:30').toISOString()), 'lunch')
  assert.equal(sessionPhaseAt(at('2026-10-21', '13:00').toISOString()), 'continuous_pm')
  assert.equal(sessionPhaseAt(at('2026-10-21', '14:57').toISOString()), 'auction_close')
  assert.equal(sessionPhaseAt(at('2026-10-21', '15:00').toISOString()), 'closed')

  assert.equal(canMatch('continuous_am'), true)
  assert.equal(canMatch('lunch'), false)
  assert.equal(canSubmit('lunch', 'market'), false)
  assert.equal(canSubmit('lunch', 'limit'), true)
  assert.equal(canSubmit('pre_open', 'market'), false)

  const boundary = nextBoundary(at('2026-10-21', '09:20').toISOString())
  assert.equal(boundary.phase, 'continuous_am')
  assert.equal(new Date(boundary.at).toISOString(), at('2026-10-21', '09:30').toISOString())
})

test('price limit: board and ST ratios', () => {
  const main = priceLimitFor('600519', '贵州茅台', 10)
  assert.deepEqual({ upper: main?.upper, lower: main?.lower, ratio: main?.ratio }, { upper: 11, lower: 9, ratio: 0.1 })
  const star = priceLimitFor('688001', '华兴源创', 10)
  assert.equal(star?.ratio, 0.2)
  const st = priceLimitFor('600519', 'ST测试', 10)
  assert.equal(st?.ratio, 0.05)
  const bj = priceLimitFor('920001', '北交测试', 10)
  assert.equal(bj?.ratio, 0.3)
})

test('service: pre-open queues, opens at 09:30 and fills', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `session-${process.pid}-${Date.now()}`)
  const data = makeData()
  const now = { current: at('2026-10-21', '09:20') }
  const service = makeService(home, data, now)
  try {
    setQuote(data, 10, now.current.toISOString())
    await service.account()
    await assert.rejects(
      service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 }),
      /当前时段不接受市价单/,
    )
    const queued = await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 10.5 })
    assert.equal(queued.status, 'queued')

    now.current = at('2026-10-21', '09:31')
    setQuote(data, 10, now.current.toISOString())
    await service.tick()
    const orders = await service.orders()
    assert.equal(orders[0].status, 'filled')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: 15:00 close expires day orders, next 09:30 unlocks T+1', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `close-${process.pid}-${Date.now()}`)
  const data = makeData()
  const now = { current: at('2026-10-21', '10:00') }
  const service = makeService(home, data, now)
  try {
    setQuote(data, 10, now.current.toISOString())
    await service.account()
    await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 })
    await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 9 })
    const before = await service.orders()
    assert.ok(before.some(order => order.status === 'pending'))

    now.current = at('2026-10-21', '15:30')
    const closed = await service.account()
    assert.equal(closed.tradeDate, '2026-10-21')
    assert.equal(closed.positions[0].available, 0)
    const atClose = await service.orders()
    assert.ok(atClose.some(order => order.status === 'expired'))
    const replayed = await service.dailyReport('2026-10-21')
    assert.equal(replayed.length, 1)

    now.current = at('2026-10-22', '09:31')
    setQuote(data, 10.2, now.current.toISOString(), { prevClose: 10 })
    const opened = await service.account()
    assert.equal(opened.tradeDate, '2026-10-22')
    assert.equal(opened.positions[0].available, 100)

    const store = new EventStore(eventsPath(home, 'default'))
    const { events, skipped } = await store.readAll()
    assert.equal(skipped, 0)
    const replayedLedger = replay(events, 'default')
    assert.deepEqual(replayedLedger.issues, [])
    assert.equal(replayedLedger.state.lastOpenedDate, '2026-10-22')
    assert.equal(replayedLedger.state.dayEquity.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: offline days only backfill snapshots, never fills', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `offline-${process.pid}-${Date.now()}`)
  const data = makeData()
  const now = { current: at('2026-10-21', '10:00') }
  const service = makeService(home, data, now)
  try {
    setQuote(data, 10, now.current.toISOString())
    await service.account()
    await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 9 })
    const before = await service.orders()

    now.current = at('2026-10-23', '10:00')
    setQuote(data, 11.5, now.current.toISOString(), { prevClose: 10 })
    const after = await service.account()
    assert.equal(after.tradeDate, '2026-10-23')
    const fills = await service.trades()
    assert.equal(fills.length, 0)
    const reports = await service.dailyReport()
    assert.ok(reports.length >= 2)
    const orders = await service.orders()
    assert.equal(orders[0].status, 'expired')
    assert.equal(before[0].status, 'pending')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: partial fill is replayable and the remainder can fill later', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `partial-${process.pid}-${Date.now()}`)
  const data = makeData()
  const now = { current: at('2026-10-21', '10:00') }
  const service = makeService(home, data, now)
  try {
    setQuote(data, 10, now.current.toISOString())
    data.volumes.set('600519', 5_000)
    await service.account()
    const order = await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 1_000 })
    assert.equal(order.status, 'partially_filled')
    assert.equal(order.filledQty, 500)
    assert.equal(order.remainingQty, 500)

    await service.tick()
    const orders = await service.orders()
    assert.equal(orders[0].status, 'filled')
    assert.equal(orders[0].filledQty, 1_000)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: suspended and out-of-limit orders are rejected', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `limit-${process.pid}-${Date.now()}`)
  const data = makeData()
  const now = { current: at('2026-10-21', '10:00') }
  const service = makeService(home, data, now)
  try {
    setQuote(data, 10, now.current.toISOString(), { prevClose: 10 })
    await service.account()
    const outOfLimit = await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 12 })
    assert.equal(outOfLimit.status, 'rejected')
    assert.match(outOfLimit.reason ?? '', /PRICE_LIMIT/)

    setQuote(data, 10, now.current.toISOString(), { prevClose: 10, status: 'suspended' })
    const suspended = await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 10 })
    assert.equal(suspended.status, 'rejected')
    assert.match(suspended.reason ?? '', /SUSPENDED/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})


test('service: lunch queued limit is released at 13:00 and fills', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `lunch-${process.pid}-${Date.now()}`)
  const data = makeData()
  const now = { current: at('2026-10-21', '11:40') }
  const service = makeService(home, data, now)
  try {
    setQuote(data, 10, now.current.toISOString())
    await service.account()
    const queued = await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 10.5 })
    assert.equal(queued.status, 'queued')
    assert.equal((await service.tick()).filled.length, 0)

    now.current = at('2026-10-21', '13:01')
    setQuote(data, 10, now.current.toISOString())
    const ticked = await service.tick()
    assert.equal(ticked.filled.length, 1)
    assert.equal(ticked.filled[0].status, 'filled')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})


test('service: pre-open sell of yesterday T+1 shares is queued, not rejected', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `presell-${process.pid}-${Date.now()}`)
  const data = makeData()
  const now = { current: at('2026-10-21', '10:00') }
  const service = makeService(home, data, now)
  try {
    setQuote(data, 10, now.current.toISOString())
    await service.account()
    await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 })

    now.current = at('2026-10-22', '09:20')
    setQuote(data, 10.2, now.current.toISOString(), { prevClose: 10 })
    const queued = await service.place({ symbol: '600519', side: 'sell', type: 'limit', qty: 100, limitPrice: 10 })
    assert.equal(queued.status, 'queued')
    assert.equal((await service.marketStatus()).tradeDate, '2026-10-22')

    now.current = at('2026-10-22', '09:31')
    setQuote(data, 10.2, now.current.toISOString(), { prevClose: 10 })
    const ticked = await service.tick()
    assert.equal(ticked.filled.length, 1)
    assert.equal(ticked.filled[0].status, 'filled')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
