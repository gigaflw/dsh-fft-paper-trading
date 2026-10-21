import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PaperService } from '../lib/service/paper-service.js'
import { AccountRepo } from '../lib/store/repo.js'
import { EventStore } from '../lib/store/event-store.js'
import { backupsDir, eventsPath } from '../lib/store/paths.js'
import { UnavailableMarketData } from '../lib/data/unavailable-market-data.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'
import { replay } from '../lib/core/replay.js'

const DAY1 = new Date('2026-10-19T02:00:00.000Z')
const DAY2 = new Date('2026-10-20T02:00:00.000Z')
const DAY1_ISO = DAY1.toISOString()
const DAY2_ISO = DAY2.toISOString()

function makeHome(name) {
  return join(process.cwd(), 'tmp', 'paper-trading-test', `${name}-${process.pid}-${Date.now()}`)
}

function makeData() {
  const prices = new Map()
  return {
    prices,
    async quotes(symbols) {
      const rows = symbols.map(symbol => prices.get(symbol)).filter(Boolean)
      return rows.length > 0 ? { state: 'ok', quotes: rows } : { state: 'failed', quotes: [], notice: 'no quote' }
    },
    async dailyBars() {
      return { state: 'ok', bars: [] }
    },
    async minuteBars() {
      return { state: 'ok', bars: [] }
    },
    async search() {
      return []
    },
    async marketList() {
      return { state: 'ok', quotes: [], page: 1 }
    },
  }
}

function setQuote(data, price, ts) {
  const quote = { symbol: '600519', name: '贵州茅台', last: price, marketTs: ts, fetchedAt: ts }
  data.prices.set('600519', quote)
}

test('service: buy, T+1 block, next-day sell, review and reset', async () => {
  const home = makeHome('service')
  const data = makeData()
  let now = DAY1
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => now })
  try {
    const account = await service.account()
    assert.equal(account.cash, 100_000)
    assert.equal(account.positions.length, 0)

    setQuote(data, 10, DAY1_ISO)
    const buy = await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 })
    assert.equal(buy.status, 'filled')
    assert.equal(buy.fillPrice, 10.01)

    const afterBuy = await service.account()
    assert.equal(afterBuy.positions[0].qty, 100)
    assert.equal(afterBuy.positions[0].available, 0)

    const blocked = await service.place({ symbol: '600519', side: 'sell', type: 'market', qty: 100 })
    assert.equal(blocked.status, 'rejected')
    assert.match(blocked.reason ?? '', /T1_LOCKED/)

    now = DAY2
    setQuote(data, 10.2, DAY2_ISO)
    await service.tick()
    const afterTick = await service.account()
    assert.equal(afterTick.positions[0].available, 100)
    assert.equal(afterTick.positions[0].lastPrice, 10.2)
    assert.equal(afterTick.tradeDate, '2026-10-20')

    const sell = await service.place({ symbol: '600519', side: 'sell', type: 'market', qty: 100 })
    assert.equal(sell.status, 'filled')
    assert.equal(sell.fillPrice, 10.19)

    const review = await service.review('all')
    assert.equal(review.tradeCount, 2)
    assert.equal(review.buyCount, 1)
    assert.equal(review.sellCount, 1)
    assert.equal(review.days, 1)

    const store = new EventStore(eventsPath(home, 'default'))
    const { events, skipped } = await store.readAll()
    assert.equal(skipped, 0)
    const replayed = replay(events, 'default')
    assert.deepEqual(replayed.issues, [])

    const reset = await service.reset(true)
    assert.equal(reset.cash, 100_000)
    assert.equal(reset.positions.length, 0)
    const backups = await readdir(backupsDir(home, 'default'))
    assert.equal(backups.length, 1, 'reset copies the pre-reset ledger aside')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: idempotent request returns the same order', async () => {
  const home = makeHome('idem')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  try {
    await service.account()
    setQuote(data, 10, DAY1_ISO)
    const first = await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 }, 'req-1')
    const second = await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 }, 'req-1')
    assert.equal(first.id, second.id)
    const orders = await service.orders()
    assert.equal(orders.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: account still opens and rejects orders when market data is unavailable', async () => {
  const home = makeHome('no-market')
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data: new UnavailableMarketData(), calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  try {
    const account = await service.account()
    assert.equal(account.cash, 100_000)

    const quote = await service.quote(['600519'])
    assert.equal(quote.state, 'failed')
    assert.match(quote.notice, /行情服务未就绪/)

    const order = await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 })
    assert.equal(order.status, 'rejected')
    assert.match(order.reason ?? '', /QUOTE_UNAVAILABLE/)

    // A pending order is what makes tick ask for quotes; the failure surfaces
    // as a notice instead of throwing the panel's polling loop.
    const pending = await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 9 })
    assert.equal(pending.status, 'pending')
    const tick = await service.tick()
    assert.equal(tick.filled.length, 0)
    assert.ok(tick.notices.some(notice => /行情服务未就绪/.test(notice)))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
