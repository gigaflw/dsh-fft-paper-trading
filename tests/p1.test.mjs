import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PaperService } from '../lib/service/paper-service.js'
import { AccountRepo } from '../lib/store/repo.js'
import { WatchlistStore } from '../lib/store/watchlist.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'

const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+08:00`)

function makeHome(name) {
  return join(process.cwd(), 'tmp', 'paper-trading-test', `${name}-${process.pid}-${Date.now()}`)
}

function makeData() {
  const prices = new Map()
  const quotes = [
    { symbol: '600519', name: '贵州茅台', last: 10, prevClose: 9.8, marketTs: '', fetchedAt: '' },
    { symbol: '300750', name: '宁德时代', last: 20, prevClose: 19.5, marketTs: '', fetchedAt: '' },
  ]
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
    async search(query) {
      return quotes.filter(item => item.symbol.includes(query) || item.name.includes(query)).map(item => ({ symbol: item.symbol, name: item.name }))
    },
    async marketList() {
      return { state: 'ok', quotes: [...quotes], page: 1 }
    },
    quotesFixture: quotes,
    setQuote(symbol, price, ts, extra = {}) {
      const existing = quotes.find(item => item.symbol === symbol)
      const quote = { ...(existing ?? { symbol, name: symbol }), last: price, marketTs: ts, fetchedAt: ts, ...extra }
      quotes[quotes.findIndex(item => item.symbol === symbol)] = quote
      prices.set(symbol, quote)
      return quote
    },
  }
}

test('p1: search, list, watchlist and status', async () => {
  const home = makeHome('p1-market')
  const data = makeData()
  data.setQuote('600519', 10, at('2026-10-21', '10:00').toISOString())
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({
    repo,
    data,
    calendar: new WeekdayTradingCalendar(),
    watchlist: new WatchlistStore(home),
    now: () => at('2026-10-21', '10:00'),
  })
  try {
    const status = await service.marketStatus()
    assert.equal(status.phase, 'continuous_am')
    assert.equal(status.canMatch, true)
    assert.equal(status.tradeDate, '2026-10-21')

    const hits = await service.search('茅台', 10)
    assert.equal(hits[0].symbol, '600519')
    const list = await service.marketList({ page: 1 })
    assert.equal(list.quotes.length, 2)

    assert.deepEqual(await service.watchlist(), [])
    assert.deepEqual(await service.setWatchlist(['600519', '600519', ' 300750 ']), ['600519', '300750'])
    assert.deepEqual(await service.watchlist(), ['600519', '300750'])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('p1: daily report, cash flow and round trips after a close', async () => {
  const home = makeHome('p1-report')
  const data = makeData()
  const now = { current: at('2026-10-21', '10:00') }
  data.setQuote('600519', 10, now.current.toISOString())
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({
    repo,
    data,
    calendar: new WeekdayTradingCalendar(),
    watchlist: new WatchlistStore(home),
    now: () => now.current,
  })
  try {
    await service.account()
    await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 })

    now.current = at('2026-10-21', '15:30')
    data.setQuote('600519', 10.5, now.current.toISOString(), { prevClose: 9.8 })
    const report = await service.dailyReport('2026-10-21')
    assert.equal(report.length, 1)
    assert.equal(report[0].date, '2026-10-21')
    assert.equal(report[0].closeSource, 'last')

    now.current = at('2026-10-22', '10:00')
    data.setQuote('600519', 11, now.current.toISOString(), { prevClose: 10.5 })
    await service.place({ symbol: '600519', side: 'sell', type: 'market', qty: 100 })

    const flow = await service.cashFlow()
    assert.equal(flow[0].type, 'open')
    assert.ok(flow.some(row => row.type === 'buy'))
    assert.ok(flow.some(row => row.type === 'sell'))

    const trips = await service.roundtrips()
    assert.equal(trips.length, 1)
    assert.equal(trips[0].symbol, '600519')
    assert.ok(trips[0].pnl > 0)

    const review = await service.review('all')
    assert.equal(review.tradeCount, 2)
    assert.equal(review.days, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
