import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const TOOL_NAMES = [
  'paper_account', 'paper_cancel', 'paper_order', 'paper_preview',
  'paper_quote', 'paper_review', 'paper_status', 'paper_tick',
]

/**
 * The host entry must attach the route and the tools even when `ftshareData`
 * never shows up: market data is optional, the ledger is not. The fake context
 * deliberately never resolves the FTShare service.
 */
test('wiring: route and tools attach without the market-data service', async () => {
  const home = join(process.cwd(), 'tmp', 'paper-trading-test', `wiring-${process.pid}-${Date.now()}`)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home

  const tools = []
  const routes = []
  const ctx = {
    logger: () => ({ warn() {} }),
    inject(dependencies, callback) {
      if (dependencies.includes('connection')) {
        callback({
          get: () => ({ fetch: { register: route => { routes.push(route); return async () => {} } } }),
          effect: fn => { fn(); return () => {} },
        })
      } else if (dependencies.includes('tools')) {
        callback({ get: () => ({ register: tool => tools.push(tool) }) })
      }
      // `ftshareData` stays absent on purpose.
      return undefined
    },
  }

  try {
    apply(ctx)

    assert.deepEqual(tools.map(tool => tool.name).sort(), TOOL_NAMES)
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

    const account = await call('account/get')
    assert.equal(account.ok, true)
    assert.equal(account.value.cash, 100_000)

    const quote = await call('market/quote', { symbols: ['600519'] })
    assert.equal(quote.ok, true)
    assert.equal(quote.value.state, 'failed')
    assert.match(quote.value.notice, /行情服务未就绪/)

    const preview = await call('order/preview', { symbol: '600519', side: 'buy', type: 'market', qty: 100 })
    assert.equal(preview.ok, true)
    assert.equal(preview.value.quote, undefined)
    assert.ok(preview.value.warnings.length > 0)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
