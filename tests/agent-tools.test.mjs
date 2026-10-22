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
  id: 'o-1', requestId: 'r-1', symbol: '600519', side: 'sell', type: 'market', qty: 100,
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
    { symbol: '600519', side: 'hold', type: 'market', qty: 100 },
    { symbol: '600519', type: 'market', qty: 100 },
    { symbol: '600519', side: 'BUY', type: 'market', qty: 100 },
    { symbol: '600519', side: 'sell', type: 'stop', qty: 100 },
  ]
  for (const args of invalid) {
    const result = await tools.paper_order.execute(args)
    assert.match(result.summary, /失败/, JSON.stringify(args))
  }
  assert.equal(calls, 0, 'an invalid draft must not reach the service')

  const preview = await tools.paper_preview.execute({ symbol: '600519', side: 'hold', type: 'market', qty: 100 })
  assert.match(preview.summary, /失败/, 'preview shares the same validation')
  assert.match(preview.summary, /side/, 'preview reports the bad field')
  const placed = await tools.paper_order.execute({ symbol: '600519', side: 'sell', type: 'market', qty: 100 })
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
