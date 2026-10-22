import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, verify } from '../lib/core/futures/ledger.js'
import { openAccount, submit, tick, closeDay, openDay, cancelOrder } from '../lib/core/futures/engine.js'
import { replayFutures, prepareFuturesLedger } from '../lib/core/futures/replay.js'
import { quantizePrice } from '../lib/core/futures/money.js'
import { DEFAULT_DAY_WINDOWS, parseDaySessions, phaseAt } from '../lib/core/futures/session.js'
import { computeFuturesFees } from '../lib/core/futures/fees.js'
import { marginCentsFor, marginRateFor, maxOpenQty, riskRatioFor } from '../lib/core/futures/margin.js'
import { previewOrder, toAccountView, toReview } from '../lib/core/futures/views.js'
import { DEFAULT_FUTURES_SETTINGS } from '../lib/futures-contract.js'

const TS = '2026-10-19T01:30:00.000Z' // 09:30 Asia/Shanghai
const CLOSE_TS = '2026-10-19T07:30:00.000Z' // 15:30 Asia/Shanghai
const DATE = '2026-10-19'
const NEXT_DATE = '2026-10-20'
const SYMBOL = 'RB2611.SHFE'

const CONTRACT = {
  symbol: SYMBOL,
  name: '螺纹钢2611',
  product: 'rb',
  exchange: 'SHFE',
  multiplier: 10,
  tickSize: 1,
  marginRate: 0.1,
  tradeHours: '上午9:00-11:30,下午13:30-15:00,下午21:00-23:00(夜盘)',
  deListDate: '2026-11-30',
  volume: 10_000,
}
const QUOTE = { last: 3200, preSettlement: 3150, volume: 5000, marketTs: TS }
const LIMIT = { upper: 3400, lower: 3000, marginRate: 0.1, source: 'limit' }
const SETTLE = { feePerLotCents: 300, closeTodayFeePerLotCents: 600, longMarginRate: 0.09 }
const INPUT = { tradeDate: DATE, phase: 'trading', contract: CONTRACT, quote: QUOTE, limit: LIMIT, settle: SETTLE }
const SETTINGS = { ...DEFAULT_FUTURES_SETTINGS }

function freshState(settings = SETTINGS) {
  return openAccount(emptyState('futures'), settings, DATE, TS, 'futures').state
}

function run(state, draft, input = INPUT, requestId = 'req-1', ts = TS) {
  return submit(state, draft, input, requestId, ts)
}

function longOpen(qty = 1, price = 3200) {
  const genesis = openAccount(emptyState('futures'), SETTINGS, DATE, TS, 'futures')
  const draft = { symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty }
  const result = run(genesis.state, draft, { ...INPUT, quote: { ...QUOTE, last: price } })
  return { ...result, events: [...genesis.events, ...result.events] }
}

test('money: prices quantize to the contract tick without float drift', () => {
  assert.equal(quantizePrice(3200.4, 1), 3200)
  assert.equal(quantizePrice(3200.6, 1), 3201)
  assert.equal(quantizePrice(100.1, 0.2), 100.2)
  assert.equal(quantizePrice(3.457, 0.005), 3.455)
  assert.equal(quantizePrice(3999.6, 0.2), 3999.6)
  assert.equal(quantizePrice(3200, 2), 3200)
  assert.equal(quantizePrice(3201, 2), 3202)
})

test('session: parse day ranges, drop night, fall back on junk', () => {
  const parsed = parseDaySessions('上午9:00-11:30,下午13:30-15:00,下午21:00-23:00(夜盘)')
  assert.equal(parsed.source, 'trade-hours')
  assert.deepEqual(parsed.windows, DEFAULT_DAY_WINDOWS)
  assert.deepEqual(parseDaySessions(undefined).windows, DEFAULT_DAY_WINDOWS)
  assert.equal(parseDaySessions('全天').source, 'fallback')
  assert.equal(parseDaySessions('下午21:00-23:00').source, 'fallback')
  const split = parseDaySessions('9:00-10:15,10:30-11:30,13:30-15:00')
  assert.deepEqual(split.windows, DEFAULT_DAY_WINDOWS)
})

test('session: phases inside the day, around the breaks and the settlement', () => {
  const sessions = parseDaySessions(undefined)
  assert.equal(phaseAt('2026-10-19T01:30:00.000Z', DATE, sessions), 'trading') // 09:30
  assert.equal(phaseAt('2026-10-19T02:20:00.000Z', DATE, sessions), 'lunch') // 10:20
  assert.equal(phaseAt('2026-10-19T02:40:00.000Z', DATE, sessions), 'trading') // 10:40
  assert.equal(phaseAt('2026-10-19T04:00:00.000Z', DATE, sessions), 'lunch') // 12:00
  assert.equal(phaseAt('2026-10-19T05:30:00.000Z', DATE, sessions), 'trading') // 13:30
  assert.equal(phaseAt('2026-10-19T07:10:00.000Z', DATE, sessions), 'closed') // 15:10
  assert.equal(phaseAt('2026-10-19T01:00:00.000Z', NEXT_DATE, sessions), 'pre_open')
  assert.equal(phaseAt('2026-10-19T00:30:00.000Z', DATE, sessions), 'pre_open') // 08:30
})

test('fees: open, close-today and close-yesterday per lot', () => {
  const open = computeFuturesFees({ offset: 'open', qty: 2, settle: SETTLE, settings: SETTINGS })
  assert.equal(open.feesCents, 600)
  assert.equal(open.source, 'exchange')
  const today = computeFuturesFees({ offset: 'close', qty: 2, todayQty: 1, settle: SETTLE, settings: SETTINGS })
  assert.equal(today.feesCents, 600 + 300)
  assert.equal(today.todayLots, 1)
  assert.equal(today.yesterdayLots, 1)
  const missing = computeFuturesFees({ offset: 'open', qty: 2, settings: SETTINGS })
  assert.equal(missing.feesCents, 0)
  assert.equal(missing.source, 'default')
  assert.ok(missing.warnings.length > 0)
})

test('margin: source priority, uplift, risk and max open quantity', () => {
  assert.equal(marginRateFor({ limit: LIMIT, settle: SETTLE, contract: CONTRACT, settings: SETTINGS }).rate, 0.1)
  assert.equal(marginRateFor({ settle: SETTLE, contract: CONTRACT, settings: SETTINGS }).rate, 0.09)
  assert.equal(marginRateFor({ contract: CONTRACT, settings: SETTINGS }).rate, 0.1)
  assert.equal(marginRateFor({ settings: { ...SETTINGS, marginUplift: 0.02 } }).rate, undefined)
  assert.equal(marginRateFor({ contract: CONTRACT, settings: { ...SETTINGS, marginUplift: 0.02 } }).rate, 0.12)
  assert.equal(marginCentsFor(3200, 10, 1, 0.1), 320_000)
  assert.equal(riskRatioFor(320_000, 99_999_700), 320_000 / 99_999_700)
  assert.equal(riskRatioFor(320_000, 0), Number.POSITIVE_INFINITY)
  const qty = maxOpenQty({ cashCents: 100_000_000, price: 3200, multiplier: 10, marginRate: 0.1, feePerLotCents: 300, settings: SETTINGS })
  assert.equal(qty, 312)
})

test('engine: open long/short and close long, with verifiable invariants', () => {
  const opened = longOpen(1)
  assert.equal(opened.order.status, 'filled')
  assert.equal(opened.order.fillPrice, 3200)
  assert.deepEqual(verify(opened.state), [])
  assert.equal(opened.state.cashCents, 100_000_000 - 320_000 - 300)
  const position = opened.state.positions[`${SYMBOL}|long`]
  assert.equal(position.qty, 1)
  assert.equal(position.todayQty, 1)
  assert.equal(position.avgPrice, 3200)
  assert.equal(position.marginCents, 320_000)

  const short = run(opened.state, { symbol: SYMBOL, side: 'short', offset: 'open', type: 'market', qty: 1 }, INPUT, 'req-2', TS)
  assert.equal(short.order.status, 'filled')
  assert.equal(short.state.positions[`${SYMBOL}|short`].qty, 1)
  assert.equal(short.state.positions[`${SYMBOL}|long`].qty, 1, 'long and short are separate lines (D6)')

  const closed = run(short.state, { symbol: SYMBOL, side: 'long', offset: 'close', type: 'market', qty: 1 }, { ...INPUT, quote: { ...QUOTE, last: 3210 } }, 'req-3', TS)
  assert.equal(closed.order.status, 'filled')
  assert.equal(closed.order.fillPrice, 3210)
  assert.equal(closed.state.positions[`${SYMBOL}|long`], undefined)
  assert.equal(closed.state.positions[`${SYMBOL}|short`].qty, 1)
  const fill = closed.state.fills.at(-1)
  assert.equal(fill.realizedPnlCents, 10_000)
  assert.equal(fill.marginCents, 320_000)
  assert.equal(fill.closedTodayQty, 1)
  // Two open fees, the short's reserved margin, the released long margin and
  // the close-today fee all move free cash.
  assert.equal(closed.state.cashCents, 100_000_000 - 300 - 300 - 320_000 - 320_000 + 320_000 + 10_000 - 600)
  assert.deepEqual(verify(closed.state), [])
})

test('engine: rejections write an auditable order and keep cash untouched', () => {
  const state = freshState()
  const cases = [
    [{ symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 320 }, INPUT, /INSUFFICIENT_MARGIN/],
    [{ symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1 }, { ...INPUT, quote: { ...QUOTE, volume: 0 } }, /NO_VOLUME/],
    [{ symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1 }, { ...INPUT, limit: undefined }, /LIMIT_UNAVAILABLE/],
    [{ symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1 }, { ...INPUT, contract: undefined }, /CONTRACT_NOT_FOUND/],
    [{ symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1 }, { ...INPUT, tradeDaysToDeList: 2 }, /CONTRACT_EXPIRED/],
    [{ symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1 }, { ...INPUT, phase: 'lunch' }, /SESSION_CLOSED/],
    [{ symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1 }, { ...INPUT, limit: undefined, settle: undefined, contract: { ...CONTRACT, marginRate: undefined } }, /MARGIN_UNAVAILABLE/],
    [{ symbol: SYMBOL, side: 'long', offset: 'close', type: 'market', qty: 1 }, INPUT, /INSUFFICIENT_POSITION/],
    [{ symbol: SYMBOL, side: 'long', offset: 'open', type: 'limit', qty: 1, limitPrice: 3500 }, { ...INPUT, quote: { ...QUOTE, last: 3200 } }, /PRICE_LIMIT/],
  ]
  for (const [draft, input, pattern] of cases) {
    const result = run(state, draft, input)
    assert.equal(result.order.status, 'rejected')
    assert.match(result.order.reason ?? '', pattern)
    assert.equal(result.state.cashCents, state.cashCents)
    assert.deepEqual(result.state.positions, {})
    assert.deepEqual(verify(result.state), [])
  }
})

test('engine: t+0 limit rests, fills on a crossing tick, and cancels without cash change', () => {
  const state = freshState()
  const resting = run(state, { symbol: SYMBOL, side: 'long', offset: 'open', type: 'limit', qty: 1, limitPrice: 3190 })
  assert.equal(resting.order.status, 'pending')
  assert.equal(resting.state.cashCents, state.cashCents)

  const filled = tick(resting.state, [{ symbol: SYMBOL, last: 3180, tradable: true }], TS)
  assert.equal(filled.filled.length, 1)
  assert.equal(filled.filled[0].status, 'filled')
  assert.equal(filled.filled[0].fillPrice, 3180, 'buy limit fills at min(limit, last)')
  assert.equal(filled.state.positions[`${SYMBOL}|long`].avgPrice, 3180)
  assert.deepEqual(verify(filled.state), [])

  const crossed = run(state, { symbol: SYMBOL, side: 'long', offset: 'open', type: 'limit', qty: 1, limitPrice: 3210 })
  assert.equal(crossed.order.status, 'filled')
  assert.equal(crossed.order.fillPrice, 3200, 'a crossed buy limit fills at the last price')

  const canceled = cancelOrder(resting.state, resting.order.id, TS)
  assert.equal(canceled.order.status, 'canceled')
  assert.equal(canceled.state.cashCents, state.cashCents)
})

test('engine: settlement marks to close, expires day orders and advances the date', () => {
  const opened = longOpen(1)
  const resting = run(opened.state, { symbol: SYMBOL, side: 'long', offset: 'open', type: 'limit', qty: 1, limitPrice: 3100 }, INPUT, 'rest')
  assert.equal(resting.order.status, 'pending')

  const closed = closeDay(resting.state, {
    date: DATE,
    nextTradeDate: NEXT_DATE,
    ts: CLOSE_TS,
    recordedAt: CLOSE_TS,
    closes: { [SYMBOL]: 3250 },
    closeSource: 'daily',
  })
  assert.equal(closed.expired.length, 1)
  assert.equal(closed.expired[0].status, 'expired')
  assert.equal(closed.state.tradeDate, NEXT_DATE)
  assert.deepEqual(closed.state.positions[`${SYMBOL}|long`].lastPrice, 3250)
  assert.equal(closed.state.positions[`${SYMBOL}|long`].todayQty, 0)
  const point = closed.state.dayEquity[0]
  // Equity = free cash + margin + float at the close price.
  assert.equal(point.equityCents, 100_000_000 - 320_000 - 300 + 320_000 + 50 * 10 * 100)
  assert.equal(point.closeSource, 'daily')
  assert.equal(point.nextDate, NEXT_DATE)
  assert.deepEqual(verify(closed.state), [])

  const openedNext = openDay(closed.state, { date: NEXT_DATE, ts: '2026-10-20T01:30:00.000Z', recordedAt: '2026-10-20T01:30:00.000Z', opens: { [SYMBOL]: 3260 } })
  assert.equal(openedNext.state.tradeDate, NEXT_DATE)
  assert.equal(openedNext.state.lastOpenedDate, NEXT_DATE)
  assert.equal(openedNext.state.positions[`${SYMBOL}|long`].lastPrice, 3260)
})

test('engine: risk ≥100% at the close force-liquidates every position', () => {
  const opened = longOpen(300)
  assert.equal(opened.order.status, 'filled')
  const closed = closeDay(opened.state, {
    date: DATE,
    nextTradeDate: NEXT_DATE,
    ts: CLOSE_TS,
    recordedAt: CLOSE_TS,
    closes: { [SYMBOL]: 3170 },
    closeSource: 'daily',
  })
  assert.deepEqual(closed.state.positions, {})
  assert.equal(closed.liquidated.length, 1)
  assert.ok(closed.notices.some(notice => notice.includes('强平')))
  assert.equal(closed.state.dayEquity[0].liquidations, 1)
  assert.ok(closed.state.fills.some(fill => fill.orderId.startsWith('liq-')))
  assert.deepEqual(verify(closed.state), [])
  // 300 lots × 10 × (3200-3170) = 90,000 yuan loss, plus the close-today fee.
  assert.equal(closed.liquidated[0].realizedPnlCents, -9_000_000)
  assert.equal(closed.liquidated[0].feesCents, 600 * 300)
})

test('engine: a contract at its last trading day is force-closed at the close', () => {
  const opened = longOpen(1)
  const closed = closeDay(opened.state, {
    date: '2026-11-30',
    nextTradeDate: '2026-12-01',
    ts: '2026-11-30T07:30:00.000Z',
    recordedAt: '2026-11-30T07:30:00.000Z',
    closes: { [SYMBOL]: 3200 },
    closeSource: 'daily',
  })
  assert.deepEqual(closed.state.positions, {})
  assert.equal(closed.state.fills.at(-1).realizedPnlCents, 0)
  assert.match(closed.notices.join('\n'), /到期强平/)
})

test('replay: folding the event log reproduces the live state exactly', () => {
  const opened = longOpen(1)
  const ticked = tick(opened.state, [{ symbol: SYMBOL, last: 3210, tradable: true }], TS)
  const closed = closeDay(ticked.state, {
    date: DATE,
    nextTradeDate: NEXT_DATE,
    ts: CLOSE_TS,
    recordedAt: CLOSE_TS,
    closes: { [SYMBOL]: 3220 },
    closeSource: 'daily',
  })
  const allEvents = [...opened.events, ...ticked.events, ...closed.events]
  const replayed = replayFutures(allEvents, 'futures')
  assert.deepEqual(replayed.issues, [])
  assert.deepEqual(replayed.state, closed.state)
  assert.deepEqual(verify(replayed.state), [])

  const prepared = prepareFuturesLedger([...allEvents, { ...allEvents.at(-1), ts: '2026-10-19T08:00:00.000Z' }])
  assert.equal(prepared.duplicates, 1)
  assert.deepEqual(prepared.issues, [])
  const conflicting = prepareFuturesLedger([...allEvents, { ...allEvents.at(-1), payload: {} }])
  assert.ok(conflicting.issues.length > 0)
})

test('views: account, preview and review agree with the ledger', () => {
  const opened = longOpen(1)
  const account = toAccountView(opened.state)
  assert.equal(account.equity, 999_997)
  assert.equal(account.margin, 3200)
  assert.equal(account.cash, 996_797)
  assert.equal(account.pnl, -3)
  assert.equal(account.riskRatio, 320_000 / 99_999_700)
  assert.equal(account.positions.length, 1)
  assert.equal(account.positions[0].unrealizedPnlCents, 0)

  const preview = previewOrder({
    state: opened.state,
    draft: { symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1 },
    contract: CONTRACT,
    quote: QUOTE,
    limit: LIMIT,
    settle: SETTLE,
    sessions: parseDaySessions(CONTRACT.tradeHours),
    nowIso: TS,
  })
  assert.equal(preview.price, 3200)
  assert.equal(preview.marginCents, 320_000)
  assert.equal(preview.feesCents, 300)
  assert.equal(preview.cashAfterCents, 99_359_400)
  assert.ok(preview.maxOpenQty > 0)
  assert.ok(preview.riskRatioAfter > 0)
  assert.equal(preview.session.phase, 'trading')
  assert.deepEqual(preview.warnings, [])

  const closed = run(opened.state, { symbol: SYMBOL, side: 'long', offset: 'close', type: 'market', qty: 1 }, { ...INPUT, quote: { ...QUOTE, last: 3210 } }, 'close', TS)
  const review = toReview(closed.state, 'all', DATE)
  assert.equal(review.tradeCount, 2)
  assert.equal(review.openCount, 1)
  assert.equal(review.closeCount, 1)
  assert.equal(review.realizedPnl, 100)
  assert.equal(review.totalFees, 9)
  assert.equal(review.winCount, 1)
  assert.equal(review.byProduct[0].product, 'rb')
})
