import test from 'node:test'
import assert from 'node:assert/strict'
import { FtshareMarketData } from '../lib/data/ftshare-market-data.js'

test('ftshare adapter: normalizes symbols and flattens grouped rows', async () => {
  const calls = []
  const service = {
    async listTools() {
      return [
        { tool: 'ft_v4_stock_realtime_day_kline', title: '股票实时日K线' },
        { tool: 'ft_v1_stock_candlesticks', title: '股票K线' },
      ]
    },
    async call(tool, args) {
      calls.push({ tool, args })
      if (tool === 'ft_v4_stock_realtime_day_kline') {
        return {
          ok: true,
          state: 'available',
          rows: [{ symbol: args.symbols[0], items: [{ close: '10.5', ts_millis: 1_760_000_000_000 }] }],
        }
      }
      return {
        ok: true,
        state: 'available',
        rows: [
          { open: '10', high: '10.8', low: '9.9', close: '10.5', volume: '1000', ts_millis: 1_760_000_000_000 },
          { open: '10.5', high: '11', low: '10.4', close: '10.9', volume: '1200', ts_millis: 1_760_086_400_000 },
        ],
      }
    },
  }
  const data = new FtshareMarketData(service)
  const quote = await data.quotes(['600519'])
  assert.equal(quote.state, 'ok')
  assert.equal(quote.quotes[0].symbol, '600519')
  assert.equal(quote.quotes[0].last, 10.5)
  assert.equal(calls[0].args.symbols[0], '600519.SH')

  const bars = await data.dailyBars('000001', 60)
  assert.equal(bars.state, 'ok')
  assert.equal(bars.bars.length, 2)
  assert.equal(bars.bars[1].close, 10.9)
  assert.equal(calls.at(-1).tool, 'ft_v1_stock_candlesticks')
  assert.equal(calls.at(-1).args.symbol, '000001.SZ')
  assert.equal(calls.at(-1).args.interval_unit, 'day')
})
