import test from 'node:test'
import assert from 'node:assert/strict'
import { registerPaperTools } from '../lib/agent/tools.js'
import { registerFuturesTools } from '../lib/agent/futures-tools.js'

function collect(register, service) {
  const tools = []
  register({ register: tool => tools.push(tool) }, service)
  return Object.fromEntries(tools.map(tool => [tool.name, tool]))
}

const stockOrder = {
  id: 'o-1', requestId: 'r-1', symbol: '600519.SH', side: 'sell', type: 'market', qty: 100,
  status: 'filled', fillPrice: 11, createdAt: '2026-10-19T02:00:00.000Z', updatedAt: '2026-10-19T02:00:00.000Z',
}
const futuresOrder = {
  id: 'f-1', requestId: 'r-2', symbol: 'RB2611.SHFE', side: 'short', offset: 'close', type: 'limit',
  qty: 1, limitPrice: 3000, status: 'pending', createdAt: '2026-10-19T02:00:00.000Z', updatedAt: '2026-10-19T02:00:00.000Z',
  tradeDate: '2026-10-19',
}

test('paper_order rejects an unknown side/type instead of guessing a buy', async () => {
  let calls = 0
  const tools = collect(registerPaperTools, { place: async () => { calls += 1; return stockOrder }, preview: async () => { throw new Error('service preview must not be reached') } })
  const invalid = [
    { symbol: '600519.SH', side: 'hold', type: 'market', qty: 100 },
    { symbol: '600519.SH', type: 'market', qty: 100 },
    { symbol: '600519.SH', side: 'BUY', type: 'market', qty: 100 },
    { symbol: '600519.SH', side: 'sell', type: 'stop', qty: 100 },
  ]
  for (const args of invalid) {
    const result = await tools.paper_order.execute(args)
    assert.match(result.summary, /失败/, JSON.stringify(args))
  }
  assert.equal(calls, 0, 'an invalid draft must not reach the service')

  const preview = await tools.paper_preview.execute({ symbol: '600519.SH', side: 'hold', type: 'market', qty: 100 })
  assert.match(preview.summary, /失败/, 'preview shares the same validation')
  assert.match(preview.summary, /side/, 'preview reports the bad field')
  const placed = await tools.paper_order.execute({ symbol: '600519.SH', side: 'sell', type: 'market', qty: 100 })
  assert.equal(calls, 1)
  assert.match(placed.summary, /卖出/)
})

test('futures_order rejects an unknown side/offset/type instead of opening long', async () => {
  let calls = 0
  const tools = collect(registerFuturesTools, { place: async () => { calls += 1; return futuresOrder } })
  const invalid = [
    { symbol: 'RB2611.SHFE', side: 'sell', offset: 'open', type: 'market', qty: 1 },
    { symbol: 'RB2611.SHFE', side: 'long', offset: 'sell', type: 'market', qty: 1 },
    { symbol: 'RB2611.SHFE', side: 'long', offset: 'open', type: 'stop', qty: 1 },
    { symbol: 'RB2611.SHFE', offset: 'open', type: 'market', qty: 1 },
  ]
  for (const args of invalid) {
    const result = await tools.futures_order.execute(args)
    assert.match(result.summary, /失败/, JSON.stringify(args))
  }
  assert.equal(calls, 0, 'an invalid draft must not reach the service')

  const placed = await tools.futures_order.execute({
    symbol: 'RB2611.SHFE', side: 'short', offset: 'close', type: 'limit', qty: 1, limitPrice: 3000,
  })
  assert.equal(calls, 1)
  assert.match(placed.summary, /空/)
  assert.match(placed.summary, /RB2611/)
})

/** Mirror DSH's lossless-JSON boundary: no undefined, non-finite numbers or class instances. */
function losslessIssues(root) {
  const issues = []
  const walk = (value, path) => {
    if (value === null) return
    const type = typeof value
    if (type === 'string' || type === 'boolean') return
    if (type === 'number') {
      if (!Number.isFinite(value)) issues.push(`${path} = ${value}`)
      return
    }
    if (type !== 'object') { issues.push(`${path} = ${type}`); return }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) { issues.push(`${path} = ${value.constructor?.name ?? 'class'}`); return }
    for (const key of Object.keys(value)) walk(value[key], `${path}.${key}`)
  }
  walk(root, 'data')
  return issues
}

test('tool data survives the DSH lossless-JSON boundary', async () => {
  // Optional view fields are `undefined`; DSH rejects them and fails the whole call.
  const account = {
    accountId: undefined, currency: 'CNY', initialCash: 1_000_000, cash: 1_000_000,
    marketValue: 0, equity: 1_000_000, pnl: 0, pnlPct: 0, todayPnl: 0,
    tradeDate: '2026-10-19', blocked: false, blockedReason: undefined,
    positions: [{ symbol: '600519.SH', name: undefined, qty: 100, available: 0 }],
    settings: {},
  }
  const preview = {
    symbol: '600519.SH', side: 'sell', type: 'limit', qty: 100, price: 11, amountCents: 1100,
    commissionCents: 5, stampCents: 0, transferCents: 1, totalFeesCents: 6, cashAfterCents: 100,
    availableQty: 0, maxBuyQty: 0, quote: undefined, priceLimit: undefined, session: undefined,
    warnings: ['T+1：当日买入的 100 股下一交易日可卖（当前可卖 0 股）'],
  }
  const tools = collect(registerPaperTools, {
    account: async () => account,
    orders: async () => [],
    trades: async () => [],
    preview: async () => preview,
    quote: async () => ({ state: 'ok', quotes: [{ symbol: '600519.SH', name: undefined, last: 11 }] }),
  })
  const calls = [
    ['paper_status', {}],
    ['paper_preview', { symbol: '600519.SH', side: 'sell', type: 'limit', qty: 100, limitPrice: 11 }],
    ['paper_quote', { symbols: ['600519.SH'] }],
  ]
  for (const [name, args] of calls) {
    const result = await tools[name].execute(args)
    const issues = losslessIssues(result.data)
    assert.deepEqual(issues, [], `${name}: ${JSON.stringify(issues)}`)
  }
})
