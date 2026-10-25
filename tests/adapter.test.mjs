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

test('ftshare adapter: a quote recovered from the daily series is tagged as such', async () => {
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
        // No paid-tier realtime interface without a key.
        return { ok: false, state: 'denied', rows: [], notice: { code: '401', message: 'API Key 缺失' } }
      }
      return {
        ok: true,
        state: 'available',
        rows: [{ close: '9.8', ts_millis: 1_760_000_000_000 }],
      }
    },
  }
  const data = new FtshareMarketData(service)
  const quote = await data.quotes(['600519'])
  assert.equal(quote.state, 'ok')
  assert.equal(quote.quotes[0].last, 9.8)
  assert.equal(quote.quotes[0].source, 'daily-bar', 'a daily close must not pass as a live tick')
  assert.ok(calls.some(call => call.tool === 'ft_v1_stock_candlesticks'))
})

test('ftshare adapter: the free quote list is filtered into boards locally', async () => {
  const calls = []
  const rows = [
    { symbol: '600000.SH', name: '浦发银行', close: '9.5', prev_close: '9.4', ts_millis: 1_760_000_000_000 },
    { symbol: '000001.SZ', name: '平安银行', close: '11.2', prev_close: '11.3', ts_millis: 1_760_000_000_000 },
    { symbol: '688001.SH', name: '华兴源创', close: '30.1', prev_close: '30.0', ts_millis: 1_760_000_000_000 },
    { symbol: '300750.SZ', name: '宁德时代', close: '250.5', prev_close: '249.0', ts_millis: 1_760_000_000_000 },
    { symbol: '920001.BJ', name: '北交样本', close: '8.8', prev_close: '8.7', ts_millis: 1_760_000_000_000 },
    { symbol: 'BADCODE', name: '无效', close: '1' },
  ]
  const service = {
    async listTools() { return [] },
    async call(tool, args) {
      calls.push({ tool, args })
      return { ok: true, state: 'available', rows }
    },
  }
  const data = new FtshareMarketData(service)

  const all = await data.marketList({ page: 1, pageSize: 50 })
  assert.equal(all.state, 'ok')
  assert.deepEqual(all.quotes.map(quote => quote.symbol), ['600000.SH', '000001.SZ', '688001.SH', '300750.SZ', '920001.BJ'])
  assert.equal(all.quotes[0].marketTs, new Date(1_760_000_000_000).toISOString(), 'the list timestamp reaches the panel')
  assert.equal(calls[0].tool, 'ft_v1_daec_stocks')
  assert.equal(calls[0].args.filter, undefined)

  calls.length = 0
  const star = await data.marketList({ board: 'star' })
  assert.deepEqual(star.quotes.map(quote => quote.symbol), ['688001.SH'])
  assert.match(calls[0].args.filter, /688000/)

  calls.length = 0
  const main = await data.marketList({ board: 'main' })
  assert.deepEqual(main.quotes.map(quote => quote.symbol), ['600000.SH', '000001.SZ'])
  assert.match(calls[0].args.filter, /600000/)

  calls.length = 0
  const bjse = await data.marketList({ board: 'bjse' })
  assert.deepEqual(bjse.quotes.map(quote => quote.symbol), ['920001.BJ'])
  assert.equal(calls[0].args.filter, 'market_id = "BJSE"')
})

test('ftshare adapter: a board beyond the scan cap says so instead of looking empty', async () => {
  const service = {
    async listTools() { return [] },
    async call() {
      // A full page of non-STAR rows, forever: the board never fills.
      return {
        ok: true,
        state: 'available',
        rows: Array.from({ length: 500 }, (_, index) => ({ symbol: `6000${String(index).padStart(2, '0')}.SH`, name: 'x', close: '1' })),
      }
    },
  }
  const data = new FtshareMarketData(service)
  const star = await data.marketList({ board: 'star', page: 1 })
  assert.equal(star.state, 'ok')
  assert.equal(star.quotes.length, 0)
  assert.match(star.notice ?? '', /免费档行情列表/)
})
