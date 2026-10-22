import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOrder } from '../lib/agent/format.js'

test('agent stock order summary includes the note', () => {
  const order = {
    id: 'o-1', requestId: 'r-1', symbol: '600519', side: 'buy', type: 'market',
    qty: 100, status: 'filled', note: '复盘备注',
  }
  assert.match(renderOrder(order), /备注 复盘备注/)
})
