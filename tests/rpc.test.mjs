import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PaperService } from '../lib/service/paper-service.js'
import { AccountRepo } from '../lib/store/repo.js'
import { createPaperRpcHandler } from '../lib/service/rpc.js'
import { createPaperRoute } from '../lib/service/route.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'

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
    const preview = await call('order/preview', { symbol: '600519', side: 'buy', type: 'market', qty: 100 })
    assert.equal(preview.ok, true)
    assert.equal(preview.value.price, 10.01)

    const placed = await call('order/place', {
      draft: { symbol: '600519', side: 'buy', type: 'market', qty: 100 },
      requestId: 'rpc-1',
    })
    assert.equal(placed.ok, true)
    assert.equal(placed.value.status, 'filled')

    const unknown = await call('nope/get', {})
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error.code, 'INVALID_ARGUMENT')

    const account = await call('account/get', {})
    assert.equal(account.ok, true)
    assert.equal(account.value.positions.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
