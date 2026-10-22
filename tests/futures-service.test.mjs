import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { FuturesService, FuturesError } from '../lib/service/futures-service.js'
import { FuturesRepo } from '../lib/store/futures-repo.js'
import { EventStore } from '../lib/store/event-store.js'
import { eventsPath } from '../lib/store/paths.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'
import { AccountRepo } from '../lib/store/repo.js'
import { PaperService } from '../lib/service/paper-service.js'
import { UnavailableMarketData } from '../lib/data/unavailable-market-data.js'
import { replayFutures } from '../lib/core/futures/replay.js'
import { SYMBOL, DATE1, DATE2, AM, LUNCH, PM, SETTLEMENT, clockAt, makeHome, makeFakeData, draft, cents } from './futures-fixtures.mjs'

function setup(name, at = clockAt(DATE1, AM)) {
  const home = makeHome(name)
  const data = makeFakeData()
  let now = at
  const repo = new FuturesRepo({ home })
  const service = new FuturesService({
    repo,
    data,
    calendar: new WeekdayTradingCalendar(),
    now: () => now,
  })
  return { home, data, repo, service, setNow: value => { now = value }, now: () => now }
}

async function close(run) {
  await rm(run.home, { recursive: true, force: true })
}

test('F1: preview of one open lot reports positive margin, fees and risk', async () => {
  const subject = setup('futures-f1')
  try {
    const preview = await subject.service.preview(draft())
    assert.equal(preview.symbol, SYMBOL)
    assert.equal(preview.price, 3200)
    assert.ok(preview.marginCents > 0)
    assert.ok(preview.feesCents > 0)
    assert.ok(preview.cashAfterCents > 0)
    assert.ok(preview.maxOpenQty > 0)
    assert.ok(preview.riskRatioAfter > 0)
    assert.equal(preview.session.phase, 'trading')
    assert.equal(preview.availableCloseQty, 0)
    assert.equal(preview.limit.upper, 3400)
  } finally {
    await close(subject)
  }
})

test('F2: day-session open long/short and close both sides, prices tick-quantized', async () => {
  const subject = setup('futures-f2')
  try {
    subject.data.setQuote(3200.4)
    const long = await subject.service.place(draft(), 'open-long')
    assert.equal(long.status, 'filled')
    assert.equal(long.fillPrice, 3200, 'fill price is quantized to the tick')
    const short = await subject.service.place(draft({ side: 'short' }), 'open-short')
    assert.equal(short.status, 'filled')

    const positions = await subject.service.positions()
    assert.equal(positions.length, 2, 'long and short are separate lines')
    assert.equal(positions.find(item => item.side === 'long').qty, 1)
    assert.equal(positions.find(item => item.side === 'short').qty, 1)
    assert.ok(positions.every(item => item.marginCents === 320_000))

    subject.data.setQuote(3210)
    const closeLong = await subject.service.place(draft({ offset: 'close' }), 'close-long')
    assert.equal(closeLong.status, 'filled')
    assert.equal(closeLong.fillPrice, 3210)
    subject.data.setQuote(3190)
    const closeShort = await subject.service.place(draft({ side: 'short', offset: 'close' }), 'close-short')
    assert.equal(closeShort.status, 'filled')

    const account = await subject.service.account()
    assert.equal(account.positions.length, 0)
    assert.equal(cents(account.cash), 100_018_200)
    const review = await subject.service.review('all')
    assert.equal(review.tradeCount, 4)
    assert.equal(review.openCount, 2)
    assert.equal(review.closeCount, 2)
    assert.equal(review.realizedPnl, 200)
    assert.equal(review.totalFees, 18)
    assert.equal(review.winCount, 2)
  } finally {
    await close(subject)
  }
})

test('F3: insufficient margin rejects and reports the shortfall', async () => {
  const subject = setup('futures-f3')
  try {
    const before = await subject.service.account()
    const order = await subject.service.place(draft({ qty: 320 }))
    assert.equal(order.status, 'rejected')
    assert.match(order.reason ?? '', /INSUFFICIENT_MARGIN/)
    assert.match(order.reason ?? '', /还差/)
    const after = await subject.service.account()
    assert.equal(cents(after.cash), cents(before.cash))
    assert.equal(after.positions.length, 0)
  } finally {
    await close(subject)
  }
})

test('F4: outside the continuous session both market and limit are rejected', async () => {
  const subject = setup('futures-f4', clockAt(DATE1, LUNCH))
  try {
    for (const order of [draft(), draft({ type: 'limit', limitPrice: 3200 })]) {
      await assert.rejects(
        () => subject.service.place(order),
        error => error instanceof FuturesError && error.code === 'SESSION_CLOSED',
      )
    }
    const status = await subject.service.status()
    assert.equal(status.phase, 'lunch')
    assert.equal(status.canSubmit, false)
    assert.equal(status.canMatch, false)
  } finally {
    await close(subject)
  }
})

test('F5: a crossed limit fills at the last price; a resting one cancels without cash change and expires at the close', async () => {
  const subject = setup('futures-f5', clockAt(DATE1, PM))
  try {
    const crossed = await subject.service.place(draft({ offset: 'open', type: 'limit', limitPrice: 3210 }))
    assert.equal(crossed.status, 'filled')
    assert.equal(crossed.fillPrice, 3200)
    const afterCrossed = await subject.service.account()

    const resting = await subject.service.place(draft({ offset: 'open', type: 'limit', limitPrice: 3100, qty: 1 }), 'resting')
    assert.equal(resting.status, 'pending')
    const afterResting = await subject.service.account()
    assert.equal(cents(afterResting.cash), cents(afterCrossed.cash), 'a resting open does not reserve cash')

    const canceled = await subject.service.cancel(resting.id)
    assert.equal(canceled.status, 'canceled')
    const afterCancel = await subject.service.account()
    assert.equal(cents(afterCancel.cash), cents(afterCrossed.cash))

    const expiring = await subject.service.place(draft({ offset: 'open', type: 'limit', limitPrice: 3100, qty: 1 }), 'expiring')
    assert.equal(expiring.status, 'pending')
    subject.setNow(clockAt(DATE1, SETTLEMENT + 5))
    const tick = await subject.service.tick()
    assert.ok(tick.expired.some(order => order.id === expiring.id))
    const orders = await subject.service.orders()
    assert.equal(orders.find(order => order.id === expiring.id).status, 'expired')
  } finally {
    await close(subject)
  }
})

test('F6: close-today uses offset_today_fee, next-day close uses trading_fee', async () => {
  const today = setup('futures-f6-today')
  try {
    await today.service.place(draft(), 'open')
    const closed = await today.service.place(draft({ offset: 'close' }), 'close')
    assert.equal(closed.status, 'filled')
    const trades = await today.service.trades()
    assert.equal(trades[0].feesCents, 600, 'same-day close pays the close-today fee')
  } finally {
    await close(today)
  }

  const overnight = setup('futures-f6-overnight')
  try {
    await overnight.service.place(draft(), 'open')
    overnight.setNow(clockAt(DATE2, AM))
    const account = await overnight.service.account()
    assert.equal(account.tradeDate, DATE2)
    assert.equal(account.positions[0].todayQty, 0, 'settlement resets the close-today bucket')
    const closed = await overnight.service.place(draft({ offset: 'close' }), 'close')
    assert.equal(closed.status, 'filled')
    const trades = await overnight.service.trades()
    assert.equal(trades[0].feesCents, 300, 'yesterday lots pay the normal fee')
  } finally {
    await close(overnight)
  }
})

test('F7: the close snapshot marks to the close price and advances the trade date', async () => {
  const subject = setup('futures-f7')
  try {
    await subject.service.place(draft(), 'open')
    subject.data.closeMap.set(SYMBOL, 3300)
    subject.setNow(clockAt(DATE1, SETTLEMENT + 5))
    const account = await subject.service.account()
    assert.equal(account.tradeDate, DATE2)
    assert.equal(cents(account.cash), 99_679_700)
    assert.equal(cents(account.margin), 320_000)
    assert.equal(account.positions[0].lastPrice, 3300)
    assert.equal(account.positions[0].unrealizedPnlCents, 100_000)
    assert.equal(cents(account.equity), 100_099_700)
    const review = await subject.service.review('all')
    assert.equal(review.equityCurve.at(-1).date, DATE1)
    assert.equal(review.equityCurve.at(-1).equity, 1_000_997)
  } finally {
    await close(subject)
  }
})

test('F8: risk ≥100% at the close force-liquidates and leaves an auditable event', async () => {
  const subject = setup('futures-f8')
  try {
    const opened = await subject.service.place(draft({ qty: 300 }), 'open')
    assert.equal(opened.status, 'filled')
    subject.data.closeMap.set(SYMBOL, 3170)
    subject.setNow(clockAt(DATE1, SETTLEMENT + 5))
    const tick = await subject.service.tick()
    assert.ok(tick.notices.some(notice => notice.includes('强平')))
    const account = await subject.service.account()
    assert.equal(account.positions.length, 0)
    assert.equal(account.tradeDate, DATE2)
    assert.equal(cents(account.equity), 90_730_000)
    const orders = await subject.service.orders()
    const liquidation = orders.find(order => order.id.startsWith('liq-'))
    assert.ok(liquidation, 'a synthetic liquidation order is visible')
    assert.match(liquidation.reason ?? '', /强制平仓/)
    const ledger = await readFile(eventsPath(subject.home, 'futures'), 'utf8')
    assert.match(ledger, /position\.forced_liquidation/)
  } finally {
    await close(subject)
  }
})

test('F9: opening is blocked within three trading days of the last trading day', async () => {
  const subject = setup('futures-f9')
  try {
    subject.data.contractList[0].deListDate = '2026-10-22'
    const rejected = await subject.service.place(draft())
    assert.equal(rejected.status, 'rejected')
    assert.match(rejected.reason ?? '', /CONTRACT_EXPIRED/)
    assert.match(rejected.reason ?? '', /临近|交易日/)
  } finally {
    await close(subject)
  }
})

test('F10: restart replays the ledger back to the same account state', async () => {
  const subject = setup('futures-f10')
  try {
    await subject.service.place(draft(), 'open')
    subject.data.setQuote(3210)
    subject.setNow(clockAt(DATE1, SETTLEMENT + 5))
    const before = await subject.service.account()
    const ordersBefore = await subject.service.orders()
    const tradesBefore = await subject.service.trades()

    const repo = new FuturesRepo({ home: subject.home })
    const restarted = new FuturesService({
      repo,
      data: subject.data,
      calendar: new WeekdayTradingCalendar(),
      now: () => clockAt(DATE1, SETTLEMENT + 5),
    })
    const after = await restarted.account()
    assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)))
    assert.deepEqual(await restarted.orders(), ordersBefore)
    assert.deepEqual(await restarted.trades(), tradesBefore)

    const store = new EventStore(eventsPath(subject.home, 'futures'))
    const { events, skipped } = await store.readAll()
    assert.equal(skipped, 0)
    const replayed = replayFutures(events, 'futures')
    assert.deepEqual(replayed.issues, [])
  } finally {
    await close(subject)
  }
})

test('F11: with market data down the account stays readable and a manual-price close still works', async () => {
  const subject = setup('futures-f11')
  try {
    await subject.service.place(draft(), 'open')
    subject.data.fail = true
    subject.setNow(clockAt(DATE1, 13 * 60 + 40))
    const account = await subject.service.account()
    assert.equal(account.positions.length, 1)
    assert.equal(account.positions[0].lastPrice, 3200)

    const rejected = await subject.service.place(draft())
    assert.equal(rejected.status, 'rejected')
    assert.match(rejected.reason ?? '', /QUOTE_UNAVAILABLE/)

    const manual = await subject.service.place(draft({ offset: 'close', price: 3190 }))
    assert.equal(manual.status, 'filled')
    assert.equal(manual.fillPrice, 3190)
    const after = await subject.service.account()
    assert.equal(after.positions.length, 0)
    const quotes = await subject.service.quote([SYMBOL])
    assert.equal(quotes.state, 'failed')
    assert.match(quotes.notice ?? '', /行情不可用/)
  } finally {
    await close(subject)
  }
})

test('F12: stock and futures ledgers coexist and reset independently', async () => {
  const home = makeHome('futures-f12')
  const data = makeFakeData()
  let futuresNow = clockAt(DATE1, AM)
  const futuresRepo = new FuturesRepo({ home })
  const futures = new FuturesService({
    repo: futuresRepo,
    data,
    calendar: new WeekdayTradingCalendar(),
    now: () => futuresNow,
  })
  const stockRepo = new AccountRepo({ home, accountId: 'default' })
  const stock = new PaperService({
    repo: stockRepo,
    data: new UnavailableMarketData(),
    calendar: new WeekdayTradingCalendar(),
    now: () => clockAt(DATE1, AM),
  })
  try {
    await futures.place(draft(), 'open')
    const stockAccount = await stock.account()
    assert.equal(stockAccount.cash, 100_000)
    assert.equal(stockAccount.positions.length, 0)

    assert.match(futuresRepo.ledgerPath, /futures[/\\]events\.jsonl$/)
    assert.match(stockRepo.ledgerPath, /default[/\\]events\.jsonl$/)

    const reset = await futures.reset(true)
    assert.equal(cents(reset.cash), 100_000_000)
    assert.equal(reset.positions.length, 0)
    const stockAfter = await stock.account()
    assert.equal(stockAfter.cash, 100_000, 'stock ledger untouched by the futures reset')
    const stockReset = await stock.reset(true)
    assert.equal(stockReset.cash, 100_000)
    const futuresAfter = await futures.account()
    assert.equal(cents(futuresAfter.cash), 100_000_000, 'stock reset does not touch futures')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('service: contracts, quotes and status degrade without throwing', async () => {
  const subject = setup('futures-degraded')
  try {
    const contracts = await subject.service.contracts({ query: 'rb' })
    assert.equal(contracts.state, 'ok')
    assert.equal(contracts.contracts.length, 1)
    assert.equal(contracts.contracts[0].multiplier, 10)
    assert.equal(contracts.contracts[0].tickSize, 1)

    const quotes = await subject.service.quote([SYMBOL, 'AG2612.SHFE'])
    assert.equal(quotes.state, 'ok')
    assert.equal(quotes.quotes.length, 1)

    subject.data.fail = true
    const failedQuotes = await subject.service.quote([SYMBOL])
    assert.equal(failedQuotes.state, 'failed')
    const status = await subject.service.status()
    assert.equal(status.phase, 'trading')
    const account = await subject.service.account()
    assert.equal(account.tradeDate, DATE1)
    const export_ = await subject.service.exportLedger()
    assert.equal(export_.exists, true)
    assert.match(export_.content ?? '', /account\.opened/)
  } finally {
    await close(subject)
  }
})

test('service: no close price means no risk liquidation, but expiry still closes', async () => {
  const subject = setup('futures-missing-close')
  try {
    await subject.service.place(draft({ qty: 300 }), 'open')
    subject.data.setQuote(3170)
    await subject.service.tick()
    subject.data.fail = true
    subject.setNow(clockAt(DATE1, SETTLEMENT + 5))
    const tick = await subject.service.tick()
    assert.ok(tick.notices.some(notice => notice.includes('跳过收盘强平')))
    const account = await subject.service.account()
    assert.equal(account.tradeDate, DATE2)
    assert.equal(account.positions.length, 1, 'positions survive a settlement without close prices')
    assert.equal(account.positions[0].qty, 300)
  } finally {
    await close(subject)
  }
})

test('fee fallback: ad-valorem trading_fee_rate becomes a per-lot fee snapshot', async () => {
  const subject = setup('futures-fee-rate')
  try {
    subject.data.settleMap.set(SYMBOL, {
      symbol: SYMBOL,
      feePerLotCents: 0,
      closeTodayFeePerLotCents: 0,
      longMarginRate: 0.09,
      feeRate: 0.1,
    })
    const preview = await subject.service.preview(draft())
    // 3200 * 10 * 0.1‰ = 3.2 yuan = 320 cents.
    assert.equal(preview.feesCents, 320)
    assert.ok(preview.warnings.some(text => text.includes('按成交额计费')), JSON.stringify(preview.warnings))
    const order = await subject.service.place(draft(), 'rate-fee')
    assert.equal(order.feesCents, 320)
  } finally {
    await close(subject)
  }
})
