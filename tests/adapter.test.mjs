import test from 'node:test'
import assert from 'node:assert/strict'
import { FtshareMarketData } from '../lib/data/ftshare-market-data.js'

function fakeService(calls) {
  return {
    async listTools() {
      return [
        { tool: 'ft_v4_stock_realtime_day_kline', title: '股票实时日K线' },
        { tool: 'ft_v1_stock_candlesticks', title: '股票K线' },
        { tool: 'ft_v1_search', title: '搜索' },
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
      if (tool === 'ft_v1_search') {
        return {
          ok: true,
          state: 'available',
          rows: [
            { symbol: '000001.SZ', name: '平安银行' },
            { symbol: '000001.SH', name: '上证指数' },
            { symbol: 'BADCODE', name: '无效' },
          ],
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
}

test('ftshare adapter: one canonical id per input, grouped rows flattened', async () => {
  const calls = []
  const data = new FtshareMarketData(fakeService(calls))

  const quote = await data.quotes(['600519'])
  assert.equal(quote.state, 'ok')
  assert.equal(quote.quotes[0].symbol, '600519.SH')
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

test('ftshare adapter: 000001 means 平安银行 unless the market is pinned', async () => {
  const calls = []
  const data = new FtshareMarketData(fakeService(calls))

  const quoteCalls = () => calls.filter(call => call.tool === 'ft_v4_stock_realtime_day_kline')
  const bare = await data.quotes(['000001'])
  assert.equal(bare.quotes[0].symbol, '000001.SZ')
  assert.equal(quoteCalls()[0].args.symbols[0], '000001.SZ')

  const index = await data.quotes(['000001.SH'])
  assert.equal(index.quotes[0].symbol, '000001.SH')
  assert.equal(quoteCalls()[1].args.symbols[0], '000001.SH')
})

test('ftshare adapter: search results are canonical and unknown codes are dropped', async () => {
  const calls = []
  const data = new FtshareMarketData(fakeService(calls))
  const hits = await data.search('000001', 5)
  assert.deepEqual(hits, [
    { symbol: '000001.SZ', name: '平安银行' },
    { symbol: '000001.SH', name: '上证指数' },
  ])
})

test('ftshare adapter: an unparseable code fails without calling the gateway', async () => {
  const calls = []
  const data = new FtshareMarketData(fakeService(calls))
  const quote = await data.quotes(['not-a-code'])
  assert.equal(quote.state, 'failed')
  assert.equal(quote.quotes.length, 0)
  assert.match(quote.notice, /代码格式/)
  assert.equal(calls.length, 0)
})
