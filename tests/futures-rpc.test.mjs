import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { FuturesService } from '../lib/service/futures-service.js'
import { FuturesRepo } from '../lib/store/futures-repo.js'
import { createFuturesRpcHandler } from '../lib/service/futures-rpc.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'
import { SYMBOL, DATE1, AM, LUNCH, clockAt, makeHome, makeFakeData, draft, cents } from './futures-fixtures.mjs'

function setupRpc(name, at = clockAt(DATE1, AM)) {
  const home = makeHome(name)
  const data = makeFakeData()
  let now = at
  const repo = new FuturesRepo({ home })
  const service = new FuturesService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => now })
  const handler = createFuturesRpcHandler(service)
  const call = (endpoint, payload, signal = new AbortController().signal) => handler(endpoint, payload, signal)
  return { home, data, service, call, setNow: value => { now = value } }
}

test('rpc: every futures/* endpoint answers with the shared envelope', async () => {
  const subject = setupRpc('futures-rpc')
  try {
    const account = await subject.call('futures/account/get')
    assert.equal(account.ok, true)
    assert.equal(cents(account.value.cash), 100_000_000)
    assert.match(account.value.ledgerPath, /futures[/\\]events\.jsonl$/)

    const contracts = await subject.call('futures/contracts', { query: '螺纹' })
    assert.equal(contracts.ok, true)
    assert.equal(contracts.value.contracts.length, 1)
    assert.equal(contracts.value.contracts[0].symbol, SYMBOL)

    const quotes = await subject.call('futures/quote', { symbols: [SYMBOL] })
    assert.equal(quotes.ok, true)
    assert.equal(quotes.value.quotes[0].last, 3200)

    const status = await subject.call('futures/status')
    assert.equal(status.ok, true)
    assert.equal(status.value.phase, 'trading')
    assert.equal(status.value.tradeDate, DATE1)

    const preview = await subject.call('futures/preview', draft())
    assert.equal(preview.ok, true)
    assert.equal(preview.value.marginCents, 320_000)
    assert.ok(preview.value.maxOpenQty > 0)

    const placed = await subject.call('futures/order', { draft: draft(), requestId: 'rpc-1' })
    assert.equal(placed.ok, true)
    assert.equal(placed.value.status, 'filled')
    assert.equal(placed.value.fillPrice, 3200)
    const duplicate = await subject.call('futures/order', { draft: draft(), requestId: 'rpc-1' })
    assert.equal(duplicate.value.id, placed.value.id)

    const positions = await subject.call('futures/positions')
    assert.equal(positions.value.length, 1)
    const orders = await subject.call('futures/orders')
    assert.equal(orders.value.length, 1)
    const trades = await subject.call('futures/trades')
    assert.equal(trades.value.length, 1)
    assert.equal(trades.value[0].feesCents, 300)

    const review = await subject.call('futures/review', { period: 'all' })
    assert.equal(review.ok, true)
    assert.equal(review.value.tradeCount, 1)

    subject.data.setQuote(3190)
    const resting = await subject.call('futures/order', { draft: draft({ offset: 'open', type: 'limit', limitPrice: 3100 }) })
    assert.equal(resting.value.status, 'pending')
    const canceled = await subject.call('futures/cancel', { orderId: resting.value.id })
    assert.equal(canceled.ok, true)
    assert.equal(canceled.value.status, 'canceled')

    const tick = await subject.call('futures/tick')
    assert.equal(tick.ok, true)
    assert.equal(tick.value.tradeDate, DATE1)

    const export_ = await subject.call('futures/account/export')
    assert.equal(export_.value.exists, true)
    assert.match(export_.value.content, /account\.opened/)

    const reset = await subject.call('futures/account/reset', { confirm: true })
    assert.equal(reset.ok, true)
    assert.equal(cents(reset.value.cash), 100_000_000)
    assert.equal(reset.value.positions.length, 0)
  } finally {
    await rm(subject.home, { recursive: true, force: true })
  }
})

test('rpc: invalid payloads and closed sessions become error envelopes', async () => {
  const subject = setupRpc('futures-rpc-errors')
  try {
    const unknown = await subject.call('futures/nope', {})
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error.code, 'INVALID_ARGUMENT')

    const badSide = await subject.call('futures/preview', draft({ side: 'buy' }))
    assert.equal(badSide.ok, false)
    assert.equal(badSide.error.code, 'INVALID_ARGUMENT')

    const badOffset = await subject.call('futures/preview', draft({ offset: 'sell' }))
    assert.equal(badOffset.ok, false)

    const noSymbols = await subject.call('futures/quote', { symbols: [] })
    assert.equal(noSymbols.ok, false)

    const badExchange = await subject.call('futures/contracts', { exchange: 'CFFEX' })
    assert.equal(badExchange.ok, false)
    assert.match(badExchange.error.message, /SHFE/)

    const noOrderId = await subject.call('futures/cancel', {})
    assert.equal(noOrderId.ok, false)

    // A business rejection is still an ok envelope: the order is in the ledger.
    const rejected = await subject.call('futures/order', { draft: draft({ qty: 400 }) })
    assert.equal(rejected.ok, true)
    assert.equal(rejected.value.status, 'rejected')
    assert.match(rejected.value.reason, /INSUFFICIENT_MARGIN/)

    subject.setNow(clockAt(DATE1, LUNCH))
    const closed = await subject.call('futures/order', { draft: draft() })
    assert.equal(closed.ok, false)
    assert.equal(closed.error.code, 'SESSION_CLOSED')
  } finally {
    await rm(subject.home, { recursive: true, force: true })
  }
})

test('rpc: index routes futures/* to the futures handler and keeps the stock endpoints', async () => {
  const { apply } = await import('../lib/index.js')
  const home = makeHome('futures-rpc-wiring')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const { tools, routes } = { tools: [], routes: [] }
  const effects = []
  const ctx = {
    logger: () => ({ warn() {} }),
    effect(callback, label) {
      const dispose = callback()
      effects.push({ label, dispose })
      return dispose
    },
    inject(dependencies, callback) {
      if (dependencies.includes('connection')) {
        callback({
          get: () => ({ fetch: { register: route => { routes.push(route); return async () => {} } } }),
          effect: fn => { fn(); return () => {} },
        })
      } else if (dependencies.includes('tools')) {
        callback({ get: () => ({ register: tool => tools.push(tool) }) })
      }
      return undefined
    },
  }
  try {
    apply(ctx)
    assert.equal(routes.length, 1)
    const call = async (endpoint, payload) => {
      const response = await routes[0].fetch(new Request('http://127.0.0.1/api/ft-paper-trading', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
      }))
      assert.equal(response.status, 200)
      return response.json()
    }
    const futures = await call('futures/account/get', {})
    assert.equal(futures.ok, true)
    assert.equal(futures.value.initialCash, 1_000_000)
    const stock = await call('account/get', {})
    assert.equal(stock.ok, true)
    assert.equal(stock.value.cash, 100_000)
    const futuresStatus = await call('futures/status', {})
    assert.equal(futuresStatus.ok, true)
    assert.ok(['pre_open', 'lunch', 'closed', 'trading'].includes(futuresStatus.value.phase))
    const unknown = await call('futures/nope', {})
    assert.equal(unknown.ok, false)

    const names = tools.map(tool => tool.name)
    for (const name of ['futures_account', 'futures_contracts', 'futures_quote', 'futures_preview', 'futures_order', 'futures_cancel', 'futures_positions', 'futures_review']) {
      assert.ok(names.includes(name), `missing ${name}`)
    }
    const accountTool = tools.find(tool => tool.name === 'futures_account')
    const result = await accountTool.execute({})
    assert.match(result.summary, /期货账户/)
    assert.equal(result.data.initialCash, 1_000_000)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})

test('rpc: an aborted futures request returns the cancellation envelope', async () => {
  const subject = setupRpc('futures-rpc-abort')
  try {
    const controller = new AbortController()
    controller.abort()
    const result = await subject.call('futures/account/get', {}, controller.signal)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_ARGUMENT')
  } finally {
    await rm(subject.home, { recursive: true, force: true })
  }
})
