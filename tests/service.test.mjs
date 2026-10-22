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
    assert.equal(buy.fillPrice, 10)

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
    assert.equal(sell.fillPrice, 10.2)

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

test('service: a weekend is closed for matching and market orders', async () => {
  const home = makeHome('weekend')
  const data = makeData()
  const now = new Date('2026-10-24T02:00:00.000Z') // Saturday 10:00 Asia/Shanghai
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => now })
  try {
    await service.account()
    setQuote(data, 10, now.toISOString())
    const status = await service.marketStatus()
    assert.equal(status.phase, 'closed')
    assert.equal(status.canMatch, false, 'a weekend must never match')
    await assert.rejects(
      () => service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 }),
      error => error.code === 'SESSION_CLOSED',
    )

    // A limit order queued for the next trading day must not fill over the weekend.
    const queued = await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 11 })
    assert.equal(queued.status, 'queued')
    setQuote(data, 10, now.toISOString())
    const tick = await service.tick()
    assert.equal(tick.filled.length, 0, 'weekend tick must not fill')
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

test('service: preview price, quote and fill price are the same last price', async () => {
  const home = makeHome('preview-price')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  try {
    await service.account()
    setQuote(data, 12.34, DAY1_ISO)
    const preview = await service.preview({ symbol: '600519', side: 'buy', type: 'market', qty: 100 })
    assert.equal(preview.price, 12.34)
    assert.equal(preview.quote.last, 12.34)

    const market = await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 }, 'preview-1')
    assert.equal(market.status, 'filled')
    assert.equal(market.fillPrice, 12.34)

    // A crossed limit also fills at last, not at its limit, and the preview
    // already shows that same last price.
    const limitPreview = await service.preview({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 12.5 })
    assert.equal(limitPreview.price, 12.34)
    assert.equal(limitPreview.quote.last, 12.34)
    const limit = await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 12.5 }, 'preview-2')
    assert.equal(limit.status, 'filled')
    assert.equal(limit.fillPrice, 12.34)

    // A limit that the last price has not reached cannot fill now: the preview
    // prices it at the limit (its worst case), says so, and the order rests.
    const restingPreview = await service.preview({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 11 })
    assert.equal(restingPreview.price, 11)
    assert.ok(restingPreview.warnings.some(warning => /挂单等待/.test(warning)), restingPreview.warnings.join('；'))
    const resting = await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 11 }, 'preview-3')
    assert.equal(resting.status, 'pending')

    // A limit order without a price is an unfinished draft: the preview must
    // say so instead of returning a 0.00 order.
    await assert.rejects(
      () => service.preview({ symbol: '600519', side: 'buy', type: 'limit', qty: 100 }),
      /限价单必须给出正的限价/,
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: concurrent ticks fill a resting order once', async () => {
  const home = makeHome('concurrent-tick')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  try {
    await service.account()
    setQuote(data, 10, DAY1_ISO)
    const placed = await service.place({ symbol: '600519', side: 'buy', type: 'limit', qty: 100, limitPrice: 9.5 }, 'rest-1')
    assert.equal(placed.status, 'pending')

    setQuote(data, 9.5, DAY1_ISO)
    await Promise.all([service.tick(), service.tick()])
    const trades = await service.trades()
    assert.equal(trades.length, 1, 'a resting order must fill exactly once')
    const [order] = await service.orders()
    assert.equal(order.status, 'filled')
    assert.equal(order.filledQty, 100)
    assert.equal(order.fillPrice, 9.5)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: a market order never rests, even when the last price is zero', async () => {
  const home = makeHome('market-never-rests')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  try {
    await service.account()
    setQuote(data, 0, DAY1_ISO)
    const rejected = await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 })
    assert.equal(rejected.status, 'rejected')
    assert.match(rejected.reason ?? '', /QUOTE_UNAVAILABLE/)

    // With a manual reference the order fills at that reference, still in one chunk.
    const manual = await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100, price: 10 }, 'manual-1')
    assert.equal(manual.status, 'filled')
    assert.equal(manual.fillPrice, 10)
    const orders = await service.orders()
    assert.ok(orders.every(order => order.status !== 'pending' && order.status !== 'queued'))
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

function setAnyQuote(data, symbol, price, ts, extra = {}) {
  data.prices.set(symbol, { symbol, name: symbol, last: price, marketTs: ts, fetchedAt: ts, ...extra })
}

function basketHome(name) {
  return makeHome(`basket-${name}`)
}

test('service: basket preview splits the budget and clamps it to cash', async () => {
  const home = basketHome('preview')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  const csv = '600519,25%\n000001,25%\n300750,25%\n600000,25%'
  try {
    await service.account()
    setAnyQuote(data, '600519', 300, DAY1_ISO)
    setAnyQuote(data, '000001', 10, DAY1_ISO)
    setAnyQuote(data, '300750', 20, DAY1_ISO)
    setAnyQuote(data, '600000', 5, DAY1_ISO) // reset in case makeData has one

    const preview = await service.basketPreview(csv)
    assert.equal(preview.cashCents, 10_000_000)
    assert.equal(preview.budgetCents, 10_000_000, 'budget defaults to the available cash')
    assert.equal(preview.rows.length, 4)
    assert.equal(preview.rows.find(row => row.symbol === '600519').status, 'zero_lot')
    assert.ok(preview.rows.filter(row => row.status === 'ok').length === 3)
    assert.equal(preview.session.canMatch, true)
    assert.equal(preview.totalAmountCents, 7_400_000)
    assert.equal(preview.totalFeesCents, preview.rows.reduce((sum, row) => sum + row.feesCents, 0))
    assert.equal(preview.residualCents, 10_000_000 - preview.totalAmountCents - preview.totalFeesCents)
    assert.equal(preview.cashAfterCents, 10_000_000 - preview.totalAmountCents - preview.totalFeesCents)
    assert.ok(preview.warnings.some(warning => /1 只不足 1 手/.test(warning)), preview.warnings.join('；'))
    assert.ok(!preview.warnings.some(warning => /只能预览/.test(warning)))

    // An explicit budget is a cap: never more than the cash, and it is what
    // residual/cashAfter are measured against.
    const small = await service.basketPreview(csv, 5_000_000)
    assert.equal(small.budgetCents, 5_000_000)
    assert.ok(small.totalAmountCents + small.totalFeesCents <= 5_000_000)
    const clamped = await service.basketPreview(csv, 20_000_000)
    assert.equal(clamped.budgetCents, 10_000_000, 'a budget above the cash is clamped, not rejected')

    await assert.rejects(() => service.basketPreview(csv, 0), error => error.code === 'INVALID_ARGUMENT')
    await assert.rejects(() => service.basketPreview(csv, -1), error => error.code === 'INVALID_ARGUMENT')
    await assert.rejects(() => service.basketPreview(csv, 1.5), error => error.code === 'INVALID_ARGUMENT')

    // Parse problems ride back in `issues`; the valid rows are still planned.
    const broken = await service.basketPreview('600519,25%\n6005,75%')
    assert.equal(broken.issues.length, 1)
    assert.equal(broken.issues[0].line, 2)
    assert.equal(broken.rows.length, 1)
    assert.equal(broken.rows[0].symbol, '600519')

    // No quote at all is an empty plan, not an exception.
    const noQuote = await service.basketPreview('300001,100%')
    assert.equal(noQuote.rows[0].status, 'no_quote')
    assert.equal(noQuote.totalAmountCents, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: basket place fills every row in one transaction', async () => {
  const home = basketHome('place')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  try {
    await service.account()
    setAnyQuote(data, '600519', 10, DAY1_ISO)
    setAnyQuote(data, '000001', 20, DAY1_ISO)
    const preview = await service.basketPreview('600519,50%\n000001,50%')
    const rows = preview.rows.filter(row => row.qty > 0).map(row => ({ symbol: row.symbol, qty: row.qty }))
    assert.equal(rows.length, 2)
    assert.equal(preview.warnings.some(warning => /不足 1 手/.test(warning)), false)

    const result = await service.basketPlace(rows, 'batch-1')
    assert.equal(result.batchId, 'batch-1')
    assert.equal(result.rows.length, 2)
    assert.ok(result.rows.every(row => row.order?.status === 'filled'))
    assert.equal(result.rows[0].symbol, rows[0].symbol)

    const account = await service.account()
    assert.equal(result.cashAfterCents, Math.round(account.cash * 100))
    assert.ok(result.cashAfterCents >= 0)
    assert.equal(account.positions.length, 2)
    assert.equal((await service.orders()).length, 2)
    assert.equal((await service.trades()).length, 2)
    // The fill price is the quote the batch used, not a later one.
    assert.equal(result.rows[0].order.fillPrice, 10)
    assert.equal(result.rows[1].order.fillPrice, 20)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: same batchId retries without duplicating orders', async () => {
  const home = basketHome('idem')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  const rows = [{ symbol: '600519', qty: 100 }, { symbol: '000001', qty: 200 }]
  try {
    await service.account()
    setAnyQuote(data, '600519', 10, DAY1_ISO)
    setAnyQuote(data, '000001', 10, DAY1_ISO)
    const first = await service.basketPlace(rows, 'retry-1')
    const firstIds = first.rows.map(row => row.order.id)
    const second = await service.basketPlace(rows, 'retry-1')
    assert.deepEqual(second.rows.map(row => row.order.id), firstIds)
    assert.equal((await service.orders()).length, 2)
    assert.equal((await service.trades()).length, 2)
    assert.equal(second.cashAfterCents, first.cashAfterCents)
    // Retrying with a different quantity for the same batch is a mistake, not
    // a second order.
    await assert.rejects(
      () => service.basketPlace([{ symbol: '600519', qty: 200 }, rows[1]], 'retry-1'),
      error => error.code === 'INVALID_ARGUMENT',
    )
    assert.equal((await service.orders()).length, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: basket pre-check rejects the whole batch without writing', async () => {
  const home = basketHome('reject')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  const rows = [{ symbol: '600519', qty: 100 }, { symbol: '000001', qty: 100 }]
  try {
    await service.account()
    setAnyQuote(data, '600519', 10, DAY1_ISO)

    // One row without a quote refuses the batch before anything is written.
    await assert.rejects(
      () => service.basketPlace(rows, 'reject-1'),
      error => error.code === 'QUOTE_UNAVAILABLE' && /000001/.test(error.message),
    )
    assert.equal((await service.orders()).length, 0)

    // A suspended row refuses the batch too.
    setAnyQuote(data, '000001', 10, DAY1_ISO, { status: 'suspended' })
    await assert.rejects(
      () => service.basketPlace(rows, 'reject-2'),
      error => error.code === 'SUSPENDED' && /000001/.test(error.message),
    )
    assert.equal((await service.orders()).length, 0)

    // Rows that individually fit but together exceed the cash are refused
    // instead of being silently shrunk.
    setAnyQuote(data, '000001', 10, DAY1_ISO)
    const before = await service.account()
    const big = [{ symbol: '600519', qty: 5_000 }, { symbol: '000001', qty: 5_000 }]
    await assert.rejects(
      () => service.basketPlace(big, 'reject-3'),
      error => error.code === 'INSUFFICIENT_CASH',
    )
    assert.equal((await service.orders()).length, 0)
    assert.equal((await service.account()).cash, before.cash)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: basket shape validation runs before any quote fetch', async () => {
  const home = basketHome('shape')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  try {
    await service.account()
    await assert.rejects(() => service.basketPlace([]), error => error.code === 'INVALID_ARGUMENT')
    await assert.rejects(
      () => service.basketPlace([{ symbol: '600519', qty: 100 }, { symbol: '600519', qty: 100 }]),
      error => error.code === 'INVALID_ARGUMENT',
    )
    await assert.rejects(
      () => service.basketPlace([{ symbol: '600519', qty: 150 }]),
      error => error.code === 'INVALID_ARGUMENT',
    )
    await assert.rejects(
      () => service.basketPlace([{ symbol: '600519', qty: 0 }]),
      error => error.code === 'INVALID_ARGUMENT',
    )
    await assert.rejects(
      () => service.basketPlace(Array.from({ length: 21 }, (_, index) => ({ symbol: `60000${index}`, qty: 100 }))),
      error => error.code === 'INVALID_ARGUMENT',
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: basket preview warns outside continuous trading and place is refused', async () => {
  const home = basketHome('session')
  const data = makeData()
  let now = new Date('2026-10-19T04:00:00.000Z') // 12:00 Asia/Shanghai, lunch
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => now })
  try {
    await service.account()
    setAnyQuote(data, '600519', 10, now.toISOString())
    const preview = await service.basketPreview('600519,100%')
    assert.equal(preview.session.canMatch, false)
    assert.ok(preview.warnings.some(warning => /当前时段不能市价成交，只能预览/.test(warning)), preview.warnings.join('；'))
    await assert.rejects(
      () => service.basketPlace([{ symbol: '600519', qty: 100 }]),
      error => error.code === 'AUCTION_ONLY',
    )

    now = new Date('2026-10-19T08:00:00.000Z') // 16:00, closed
    await assert.rejects(
      () => service.basketPlace([{ symbol: '600519', qty: 100 }]),
      error => error.code === 'SESSION_CLOSED',
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: basket place refuses a locked account', async () => {
  const home = basketHome('blocked')
  const data = makeData()
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  try {
    await service.account()
    setAnyQuote(data, '600519', 10, DAY1_ISO)
    // Simulate the ledger invariant failure the loader would have recorded.
    const state = await repo.current()
    const seq = state.lastSeq + 1
    await repo.append([{
      seq,
      id: `evt-${seq}`,
      ts: DAY1_ISO,
      type: 'ledger.violation',
      payload: { check: 'test', expected: 'consistent', actual: 'injected violation' },
    }])
    await assert.rejects(
      () => service.basketPlace([{ symbol: '600519', qty: 100 }]),
      error => error.code === 'ACCOUNT_BLOCKED',
    )
    // Preview stays read-only and usable on a locked account; only placing is
    // refused, with the lock reason instead of a session error.
    const preview = await service.basketPreview('600519,100%')
    assert.deepEqual(preview.issues, [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: upstream adapter internals are not exposed in data notices', async () => {
  const home = makeHome('service-notice')
  const data = makeData()
  data.quotes = async () => ({ state: 'failed', quotes: [], notice: 'FTShare ft_v1_stock_candlesticks 调用失败：invalid symbol: missing market suffix' })
  data.dailyBars = async () => ({ state: 'failed', bars: [], notice: 'FTShare ft_v1_stock_candlesticks 调用失败：symbol: invalid symbol' })
  data.minuteBars = async () => ({ state: 'denied', bars: [], notice: 'FTShare route_not_allowed' })
  data.marketList = async () => ({ state: 'failed', quotes: [], page: 1, notice: 'FTShare ft_v1_stock_list request failed' })
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => DAY1 })
  try {
    assert.equal((await service.quote(['600519'])).notice, '行情暂不可用')
    assert.equal((await service.dailyBars('600519')).notice, 'K 线数据暂不可用')
    assert.equal((await service.minuteBars('600519')).notice, '行情接口无权限')
    assert.equal((await service.marketList()).notice, '行情暂不可用')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: stock order notes survive ledger replay', async () => {
  const home = makeHome('note-replay')
  const data = makeData()
  let now = DAY1
  const calendar = new WeekdayTradingCalendar()
  const service = new PaperService({ repo: new AccountRepo({ home, accountId: 'default' }), data, calendar, now: () => now })
  try {
    setQuote(data, 10, DAY1_ISO)
    await service.account()
    const placed = await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100, note: '股票备注' })
    assert.equal(placed.note, '股票备注')
    const reopened = new PaperService({ repo: new AccountRepo({ home, accountId: 'default' }), data, calendar, now: () => now })
    const orders = await reopened.orders()
    assert.equal(orders.find(order => order.id === placed.id).note, '股票备注')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
