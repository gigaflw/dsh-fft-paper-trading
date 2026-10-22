import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PaperService } from '../lib/service/paper-service.js'
import { AccountRepo } from '../lib/store/repo.js'
import { createPaperRpcHandler } from '../lib/service/rpc.js'
import { createPaperRoute } from '../lib/service/route.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'
import { WatchlistStore } from '../lib/store/watchlist.js'

const NOW = new Date('2026-10-19T02:00:00.000Z')

test('rpc: preview, place, unknown endpoint and envelope', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `rpc-${process.pid}-${Date.now()}`)
  const prices = new Map([['600519', { symbol: '600519', last: 10, marketTs: NOW.toISOString(), fetchedAt: NOW.toISOString() }]])
  const data = {
    async quotes(symbols) {
      const rows = symbols.map(symbol => prices.get(symbol)).filter(Boolean)
      return { state: rows.length > 0 ? 'ok' : 'failed', quotes: rows }
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
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), watchlist: new WatchlistStore(home), now: () => NOW })
  const handler = createPaperRpcHandler(service)
  const route = createPaperRoute(handler)
  try {
    const call = async (endpoint, payload) => {
      const response = await route.fetch(new Request('http://127.0.0.1/api/ft-paper-trading', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
      }))
      assert.equal(response.status, 200)
      return response.json()
    }
    const preview = await call('order/preview', { symbol: '600519', side: 'buy', type: 'market', qty: 100 })
    assert.equal(preview.ok, true)
    assert.equal(preview.value.price, 10)
    assert.equal(preview.value.quote.last, 10)

    const placed = await call('order/place', {
      draft: { symbol: '600519', side: 'buy', type: 'market', qty: 100 },
      requestId: 'rpc-1',
    })
    assert.equal(placed.ok, true)
    assert.equal(placed.value.status, 'filled')
    assert.equal(placed.value.fillPrice, 10)

    const unknown = await call('nope/get', {})
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error.code, 'INVALID_ARGUMENT')

    const account = await call('account/get', {})
    assert.equal(account.ok, true)
    assert.equal(account.value.positions.length, 1)

    const status = await call('market/status', {})
    assert.equal(status.ok, true)
    assert.equal(status.value.tradeDate, '2026-10-19')
    assert.equal(status.value.phase, 'continuous_am')

    const watch = await call('watchlist/set', { symbols: ['600519'] })
    assert.deepEqual(watch.value.symbols, ['600519'])
    const watched = await call('watchlist/get', {})
    assert.deepEqual(watched.value.symbols, ['600519'])

    const bars = await call('market/bars', { symbol: '600519', interval: 'minute' })
    assert.equal(bars.ok, true)
    const daily = await call('review/daily', {})
    assert.equal(daily.ok, true)
    const flow = await call('cash/flow', {})
    assert.equal(flow.ok, true)
    const trips = await call('review/roundtrips', {})
    assert.equal(trips.ok, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('rpc: basket preview and place payloads', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `rpc-basket-${process.pid}-${Date.now()}`)
  const prices = new Map([
    ['600519', { symbol: '600519', last: 10, marketTs: NOW.toISOString(), fetchedAt: NOW.toISOString() }],
    ['000001', { symbol: '000001', last: 20, marketTs: NOW.toISOString(), fetchedAt: NOW.toISOString() }],
  ])
  const data = {
    async quotes(symbols) {
      const rows = symbols.map(symbol => prices.get(symbol)).filter(Boolean)
      return { state: rows.length > 0 ? 'ok' : 'failed', quotes: rows }
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
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => NOW })
  const handler = createPaperRpcHandler(service)
  const route = createPaperRoute(handler)
  try {
    const call = async (endpoint, payload) => {
      const response = await route.fetch(new Request('http://127.0.0.1/api/ft-paper-trading', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
      }))
      assert.equal(response.status, 200)
      return response.json()
    }
    const rejects = async (endpoint, payload) => {
      const result = await call(endpoint, payload)
      assert.equal(result.ok, false, `${endpoint} should reject ${JSON.stringify(payload)}`)
      assert.equal(result.error.code, 'INVALID_ARGUMENT')
    }

    const preview = await call('basket/preview', { csv: '600519,50%\n000001,50%', budgetCents: 1_000_000 })
    assert.equal(preview.ok, true)
    assert.equal(preview.value.budgetCents, 1_000_000)
    assert.equal(preview.value.rows.length, 2)
    assert.equal(preview.value.session.tradeDate, '2026-10-19')

    const defaultBudget = await call('basket/preview', { csv: '600519,100%' })
    assert.equal(defaultBudget.ok, true)
    assert.equal(defaultBudget.value.budgetCents, 10_000_000, 'budget defaults to cash')

    await rejects('basket/preview', {})
    await rejects('basket/preview', { csv: '   ' })
    await rejects('basket/preview', { csv: `600519,100%\n# ${'x'.repeat(33 * 1024)}` })
    await rejects('basket/preview', { csv: '600519,100%', budgetCents: 0 })
    await rejects('basket/preview', { csv: '600519,100%', budgetCents: -1 })
    await rejects('basket/preview', { csv: '600519,100%', budgetCents: 1.5 })

    const placed = await call('basket/place', {
      batchId: 'rpc-batch-1',
      rows: [{ symbol: '600519', qty: 100 }, { symbol: '000001', qty: 100 }],
    })
    assert.equal(placed.ok, true)
    assert.equal(placed.value.batchId, 'rpc-batch-1')
    assert.equal(placed.value.rows.length, 2)
    assert.ok(placed.value.rows.every(row => row.order.status === 'filled'))
    assert.equal(typeof placed.value.cashAfterCents, 'number')

    const generated = await call('basket/place', { rows: [{ symbol: '600519', qty: 100 }] })
    assert.equal(generated.ok, true)
    assert.equal(typeof generated.value.batchId, 'string')
    assert.ok(generated.value.batchId.length > 0)
    assert.equal((await call('list/orders', {})).value.length, 3)
    assert.equal((await call('account/get', {})).value.positions.length, 2)

    await rejects('basket/place', {})
    await rejects('basket/place', { rows: [] })
    await rejects('basket/place', { rows: Array.from({ length: 21 }, (_, index) => ({ symbol: `60000${index}`, qty: 100 })) })
    await rejects('basket/place', { rows: [{ qty: 100 }] })
    await rejects('basket/place', { rows: [{ symbol: '600519', qty: 150 }] })
    await rejects('basket/place', { rows: [{ symbol: '600519', qty: 100 }], batchId: 'x'.repeat(101) })
    // Rejected payloads must not have written an order.
    assert.equal((await call('list/orders', {})).value.length, 3)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('route: wrong method, malformed body, oversize and bad endpoint are rejected', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `route-${process.pid}-${Date.now()}`)
  const data = {
    async quotes() { return { state: 'ok', quotes: [] } },
    async dailyBars() { return { state: 'ok', bars: [] } },
    async minuteBars() { return { state: 'ok', bars: [] } },
    async search() { return [] },
    async marketList() { return { state: 'ok', quotes: [], page: 1 } },
  }
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), watchlist: new WatchlistStore(home), now: () => NOW })
  const route = createPaperRoute(createPaperRpcHandler(service))
  const url = 'http://127.0.0.1/api/ft-paper-trading'
  try {
    const get = await route.fetch(new Request(url, { method: 'GET' }))
    assert.equal(get.status, 405)

    const malformed = await route.fetch(new Request(url, { method: 'POST', body: 'not json' }))
    assert.equal(malformed.status, 400)
    assert.equal((await malformed.json()).error.code, 'INVALID_ARGUMENT')

    const nullBody = await route.fetch(new Request(url, { method: 'POST', body: 'null' }))
    assert.equal(nullBody.status, 400)

    const noEndpoint = await route.fetch(new Request(url, { method: 'POST', body: '{}' }))
    assert.equal(noEndpoint.status, 400)
    assert.match((await noEndpoint.json()).error.message, /endpoint/)

    const huge = await route.fetch(new Request(url, {
      method: 'POST',
      headers: { 'content-length': String(256 * 1024 + 1) },
      body: '{}',
    }))
    assert.equal(huge.status, 413)

    const unknown = await route.fetch(new Request(url, {
      method: 'POST', body: JSON.stringify({ endpoint: 'nope/get', payload: {} }),
    }))
    assert.equal(unknown.status, 200)
    assert.equal((await unknown.json()).error.code, 'INVALID_ARGUMENT')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('rpc: an aborted request returns the cancellation envelope', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `abort-${process.pid}-${Date.now()}`)
  const data = {
    async quotes() { return { state: 'ok', quotes: [] } },
    async dailyBars() { return { state: 'ok', bars: [] } },
    async minuteBars() { return { state: 'ok', bars: [] } },
    async search() { return [] },
    async marketList() { return { state: 'ok', quotes: [], page: 1 } },
  }
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), watchlist: new WatchlistStore(home), now: () => NOW })
  const handler = createPaperRpcHandler(service)
  try {
    const controller = new AbortController()
    controller.abort()
    const result = await handler('account/get', {}, controller.signal)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_ARGUMENT')
    assert.match(result.error.message, /取消/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
