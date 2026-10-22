import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FtshareFuturesMarketData } from '../lib/data/futures-market-data.js'

// `$DSH_HOME` is re-pointed per test; the cache file lives under it.
const TMP_ROOT = join(import.meta.dirname, '..', 'tmp')
mkdirSync(TMP_ROOT, { recursive: true })
const homes = []

function freshHome() {
  const home = mkdtempSync(join(TMP_ROOT, 'futures-adapter-'))
  process.env.DSH_HOME = home
  homes.push(home)
  return home
}

test.after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

function fake(handler) {
  const calls = []
  return {
    calls,
    async listTools() {
      return []
    },
    async call(tool, args = {}) {
      calls.push({ tool, args })
      return handler(tool, args, calls)
    },
  }
}

function available(rows) {
  return { ok: true, state: rows.length > 0 ? 'available' : 'empty', rows }
}

function denied(message = '接口无权限') {
  return { ok: false, state: 'denied', rows: [], notice: { code: 'denied', message } }
}

function failed(message = '上游失败') {
  return { ok: false, state: 'failed', rows: [], notice: { code: 'failed', message } }
}

function baseRow(overrides = {}) {
  return {
    symbol: 'RB2611.SHF',
    exchange: 'SHFE',
    product: 'rb',
    multiplier: '10',
    min_put_price_info: '1元/吨',
    margin_info: '10%',
    trade_hours_info: '上午9:00-11:30,下午13:30-15:00',
    de_list_tdate: 20261115,
    symbol_cn_name: '螺纹钢2611',
    future_type: null,
    ...overrides,
  }
}

function stamp(iso) {
  return Date.parse(iso)
}

function shanghaiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

test('contracts: paginates 1..4, dedupes duplicate rows and normalises the three suffix sets', async () => {
  const home = freshHome()
  const service = fake((tool, args) => {
    assert.equal(tool, 'ft_v1_futures_futures_base_data')
    if (args.page === 1) {
      const rows = []
      for (let index = 0; index < 250; index += 1) {
        rows.push(baseRow({ future_type: null }))
        rows.push(baseRow({ future_type: 2 }))
      }
      return available(rows)
    }
    return available([
      baseRow({ symbol: 'CU2611.SHF', product: 'cu', multiplier: '5', min_put_price_info: '10元/吨', margin_info: '8%' }),
      baseRow({
        symbol: 'TA611.CZC',
        exchange: 'CZCE',
        product: 'ta',
        multiplier: 5,
        min_put_price_info: '2元/吨',
        margin_info: '7%',
        de_list_tdate: 20261215,
        symbol_cn_name: 'PTA611',
      }),
      baseRow({ symbol: 'IF2611.CFE', exchange: 'CFFEX' }),
      baseRow({ symbol: 'XX2611.NIB', exchange: 'NIB' }),
      baseRow({ symbol: 'NO2611.SHF', multiplier: '' }),
    ])
  })
  const data = new FtshareFuturesMarketData(service)
  const result = await data.contracts()

  assert.equal(result.state, 'ok')
  assert.equal(result.value.length, 3)
  assert.deepEqual(
    result.value.map(contract => contract.symbol),
    ['CU2611.SHFE', 'RB2611.SHFE', 'TA611.CZCE'],
  )
  // Two rows per contract collapse into one.
  assert.equal(result.value.filter(contract => contract.symbol === 'RB2611.SHFE').length, 1)
  // Exchange and table suffix variants all land on the market-data suffix.
  assert.equal(service.calls[0].args.page, 1)
  assert.equal(service.calls[0].args.page_size, 500)
  assert.equal(service.calls[1].args.page, 2)
  assert.equal(service.calls[1].args.page_size, 500)
  assert.equal(service.calls.length, 2)

  const rb = result.value.find(contract => contract.symbol === 'RB2611.SHFE')
  assert.equal(rb.exchange, 'SHFE')
  assert.equal(rb.multiplier, 10)
  assert.equal(rb.tickSize, 1)
  assert.equal(rb.marginRate, 0.1)
  assert.equal(rb.product, 'rb')
  assert.equal(rb.name, '螺纹钢2611')
  assert.equal(rb.deListDate, '2026-11-15')
  assert.equal(rb.tradeHours, '上午9:00-11:30,下午13:30-15:00')

  const ta = result.value.find(contract => contract.symbol === 'TA611.CZCE')
  assert.equal(ta.exchange, 'CZCE')
  assert.equal(ta.product, 'ta')
  assert.equal(ta.tickSize, 2)
  assert.equal(ta.marginRate, 0.07)
  assert.equal(ta.deListDate, '2026-12-15')

  // CFFEX / NIB / contracts without a multiplier are dropped.
  assert.equal(result.value.some(contract => contract.symbol.endsWith('.CFFEX')), false)
  assert.equal(result.value.some(contract => contract.symbol.includes('NIB')), false)
  assert.equal(result.value.some(contract => contract.symbol.startsWith('NO')), false)

  // The per-trade-date cache is persisted next to the futures ledger.
  const cachePath = join(home, 'paper-trading', 'futures', 'contracts.json')
  assert.equal(existsSync(cachePath), true)
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  assert.equal(cache.tradeDate, shanghaiToday())
  assert.equal(cache.contracts.length, 3)

  // Same trade date: memory cache answers without another upstream call.
  const before = service.calls.length
  const cached = await data.contracts()
  assert.equal(cached.state, 'ok')
  assert.equal(service.calls.length, before)

  // refresh bypasses the cache.
  const refreshed = await data.contracts(true)
  assert.equal(refreshed.state, 'ok')
  assert.equal(service.calls.length, before + 2)
})

test('contracts: stale file cache is refetched and a failed refresh keeps the previous copy', async () => {
  const home = freshHome()
  const cachePath = join(home, 'paper-trading', 'futures', 'contracts.json')
  mkdirSync(join(home, 'paper-trading', 'futures'), { recursive: true })

  const oldContract = {
    symbol: 'RB2611.SHFE',
    name: '螺纹钢2611',
    product: 'rb',
    exchange: 'SHFE',
    multiplier: 10,
    tickSize: 1,
    marginRate: 0.1,
  }
  writeFileSync(cachePath, JSON.stringify({ tradeDate: '2000-01-01', contracts: [oldContract] }), 'utf8')

  let failing = true
  const calls = []
  const service = fake((tool, args) => {
    calls.push({ tool, args })
    if (failing) return failed('网络不可用')
    return available([baseRow({ symbol: 'CU2611.SHF', product: 'cu', multiplier: 5, min_put_price_info: '10' })])
  })
  const data = new FtshareFuturesMarketData(service)

  // Cross-day cache is stale: a fetch happens even though the file exists.
  const stale = await data.contracts()
  assert.equal(calls.length, 1)
  assert.equal(stale.state, 'stale')
  assert.equal(stale.value.length, 1)
  assert.equal(stale.value[0].symbol, 'RB2611.SHFE')
  assert.match(stale.notice, /2000-01-01/)

  // A later successful refresh replaces the old copy.
  failing = false
  const refreshed = await data.contracts(true)
  assert.equal(refreshed.state, 'ok')
  assert.deepEqual(refreshed.value.map(contract => contract.symbol), ['CU2611.SHFE'])
})

test('quotes: normalises suffixes, dedupes, uses the last minute bar and maps the 4 states', async () => {
  freshHome()
  const service = fake((tool, args) => {
    assert.equal(tool, 'ft_v4_futures_minutes_realtime')
    assert.deepEqual(args.symbols, ['RB2611.SHFE', 'TA611.CZCE', 'CU2611.SHFE'])
    return available([
      // Deliberately unsorted: the latest bar must win, not the last array row.
      {
        symbol: 'RB2611.SHFE',
        close: 3210,
        timestamp: stamp('2026-10-22T10:00:00+08:00'),
        pre_settlement_price: 3117,
        open_interest: 123456,
        trade_date: 20261022,
      },
      {
        symbol: 'RB2611.SHFE',
        close: 3200,
        timestamp: stamp('2026-10-22T09:01:00+08:00'),
        trade_date: 20261022,
      },
      {
        symbol: 'TA611.CZCE',
        close: 5555,
        datetime: '2026-10-22 10:00:00',
        pre_settlement_price: 5500,
        trade_date: 20261022,
      },
      // Grouped rows are flattened too.
      { symbol: 'CU2611.SHFE', items: [{ close: 78900, datetime: '2026-10-22 10:00:00', trade_date: 20261022 }] },
    ])
  })
  const data = new FtshareFuturesMarketData(service)
  const result = await data.quotes(['rb2611.shf', 'TA611.CZC', 'ta611.zce', 'cu2611.SHFE'])

  assert.equal(result.state, 'ok')
  assert.equal(result.value.length, 3)
  const rb = result.value.find(quote => quote.symbol === 'RB2611.SHFE')
  assert.equal(rb.last, 3210)
  assert.equal(rb.preSettlement, 3117)
  assert.equal(rb.openInterest, 123456)
  assert.equal(rb.marketTs, '2026-10-22T02:00:00.000Z')
  assert.equal(rb.tradeDate, '2026-10-22')
  const ta = result.value.find(quote => quote.symbol === 'TA611.CZCE')
  assert.equal(ta.last, 5555)
  assert.equal(ta.marketTs, '2026-10-22T02:00:00.000Z')
  assert.equal(ta.tradeDate, '2026-10-22')
  const cu = result.value.find(quote => quote.symbol === 'CU2611.SHFE')
  assert.equal(cu.last, 78900)
})

test('quotes: batches at most 20 symbols and fails the whole call without a half result', async () => {
  freshHome()
  const symbols = Array.from({ length: 45 }, (_, index) => `A${index}2611.DCE`)
  const batches = []
  let calls = 0
  const service = fake((tool, args) => {
    calls += 1
    batches.push(args.symbols.length)
    if (calls === 2) return denied('分钟行情无权限')
    return available(args.symbols.map((symbol, index) => ({
      symbol,
      close: 100 + index,
      trade_date: 20261022,
      timestamp: stamp('2026-10-22T14:00:00+08:00'),
    })))
  })
  const data = new FtshareFuturesMarketData(service)
  const deniedResult = await data.quotes(symbols)
  assert.deepEqual(batches, [20, 20])
  assert.equal(deniedResult.state, 'denied')
  assert.equal(deniedResult.value, undefined)

  const okService = fake((tool, args) => available(args.symbols.map(symbol => ({
    symbol,
    close: 100,
    trade_date: 20261022,
    timestamp: stamp('2026-10-22T14:00:00+08:00'),
  }))))
  const okResult = await new FtshareFuturesMarketData(okService).quotes(symbols)
  assert.equal(okResult.state, 'ok')
  assert.equal(okResult.value.length, 45)
  assert.deepEqual(okService.calls.map(call => call.args.symbols.length), [20, 20, 5])
})

test('limits: prefers ft_limit, falls back to minutes and tolerates the one-tick rounding gap', async () => {
  freshHome()
  const service = fake((tool, args) => {
    if (tool === 'ft_v1_futures_ft_limit') {
      assert.equal(typeof args.trade_date, 'number')
      assert.equal(args.page_size, 500)
      if (args.exchange === 'SHF') {
        return available([{
          ts_code: 'RB2611.SHF',
          up_limit: 3273,
          down_limit: 2961,
          m_ratio: 10,
        }])
      }
      if (args.exchange === 'ZCE') {
        return available([{ ts_code: 'TA611.ZCE', up_limit: 5600, down_limit: 5000, m_ratio: 7 }])
      }
      return available([])
    }
    if (tool === 'ft_v4_futures_minutes_realtime') {
      // Expressed with the same rounding the real minute interface uses.
      assert.deepEqual(args.symbols, ['CU2611.SHFE', 'M2611.DCE'])
      return available([
        { symbol: 'CU2611.SHFE', high_limit_price: 3272, low_limit_price: 2961, close: 3100, trade_date: 20261022 },
        { symbol: 'M2611.DCE', high_limit_price: 3300, low_limit_price: 3000, close: 3150, trade_date: 20261022 },
      ])
    }
    throw new Error(`unexpected tool ${tool}`)
  })
  const data = new FtshareFuturesMarketData(service)
  const result = await data.limits(['RB2611.SHFE', 'CU2611.SHFE', 'TA611.CZCE', 'M2611.DCE'])

  assert.equal(result.state, 'ok')
  assert.equal(result.value.length, 4)
  const rb = result.value.find(limit => limit.symbol === 'RB2611.SHFE')
  // Exchange table wins over the minute interface, whose value is one tick off.
  assert.equal(rb.upper, 3273)
  assert.equal(rb.lower, 2961)
  assert.equal(rb.source, 'limit')
  assert.equal(rb.marginRate, 0.1)
  assert.equal(Math.abs(rb.upper - 3272), 1)
  const ta = result.value.find(limit => limit.symbol === 'TA611.CZCE')
  assert.equal(ta.upper, 5600)
  assert.equal(ta.source, 'limit')
  assert.equal(ta.marginRate, 0.07)
  const cu = result.value.find(limit => limit.symbol === 'CU2611.SHFE')
  assert.equal(cu.upper, 3272)
  assert.equal(cu.source, 'minutes')
  const m = result.value.find(limit => limit.symbol === 'M2611.DCE')
  assert.equal(m.upper, 3300)
  assert.equal(m.source, 'minutes')

  const limitCalls = service.calls.filter(call => call.tool === 'ft_v1_futures_ft_limit')
  assert.deepEqual(limitCalls.map(call => call.args.exchange), ['SHF', 'ZCE', 'DCE'])
  const minuteCalls = service.calls.filter(call => call.tool === 'ft_v4_futures_minutes_realtime')
  assert.equal(minuteCalls.length, 1)

  // Exchange tables are daily snapshots: a second lookup reuses them.
  const again = await data.limits(['RB2611.SHFE', 'CU2611.SHFE', 'TA611.CZCE', 'M2611.DCE'])
  assert.equal(again.state, 'ok')
  assert.equal(again.value.length, 4)
  assert.equal(service.calls.filter(call => call.tool === 'ft_v1_futures_ft_limit').length, 3)
})

test('limits: an exchange outage falls back to minutes; a full outage degrades', async () => {
  freshHome()
  const fallbackService = fake((tool) => {
    if (tool === 'ft_v1_futures_ft_limit') return denied('涨跌停无权限')
    return available([{
      symbol: 'RB2611.SHFE',
      high_limit_price: 3272,
      low_limit_price: 2961,
      close: 3100,
      trade_date: 20261022,
    }])
  })
  const fallback = await new FtshareFuturesMarketData(fallbackService).limits(['RB2611.SHFE'])
  assert.equal(fallback.state, 'ok')
  assert.equal(fallback.value[0].source, 'minutes')
  assert.equal(fallback.value[0].upper, 3272)
  assert.match(fallback.notice, /SHFE 涨跌停不可用/)

  const outageService = fake((tool) => (tool === 'ft_v1_futures_ft_limit' ? failed('上游失败') : denied('分钟无权限')))
  const outage = await new FtshareFuturesMarketData(outageService).limits(['RB2611.SHFE'])
  assert.equal(outage.state, 'denied')
  assert.equal(outage.value, undefined)
})

test('settle: groups by exchange and converts yuan fees to cents', async () => {
  freshHome()
  const service = fake((tool, args) => {
    assert.equal(tool, 'ft_v1_futures_fut_settle')
    assert.equal(typeof args.trade_date, 'number')
    if (args.exchange === 'SHF') {
      return available([{
        ts_code: 'RB2611.SHF',
        settle: 3203,
        long_margin_rate: 0.07,
        trading_fee: 1.5,
        offset_today_fee: 0.05,
      }])
    }
    if (args.exchange === 'ZCE') {
      return available([{ ts_code: 'TA611.ZCE', trading_fee: 4.3, offset_today_fee: 0 }])
    }
    return available([])
  })
  const data = new FtshareFuturesMarketData(service)
  const result = await data.settle(['RB2611.SHFE', 'TA611.CZCE', 'M2611.DCE'])

  assert.equal(result.state, 'ok')
  assert.equal(result.value.length, 2)
  const rb = result.value.find(item => item.symbol === 'RB2611.SHFE')
  assert.equal(rb.settle, 3203)
  assert.equal(rb.longMarginRate, 0.07)
  assert.equal(rb.feePerLotCents, 150)
  assert.equal(rb.closeTodayFeePerLotCents, 5)
  const ta = result.value.find(item => item.symbol === 'TA611.CZCE')
  assert.equal(ta.feePerLotCents, 430)
  assert.equal(ta.closeTodayFeePerLotCents, 0)
  assert.match(result.notice, /M2611\.DCE/)

  assert.deepEqual(
    service.calls.map(call => call.args.exchange),
    ['SHF', 'ZCE', 'DCE'],
  )

  // The daily exchange table is reused on the next lookup.
  const again = await data.settle(['RB2611.SHFE', 'TA611.CZCE', 'M2611.DCE'])
  assert.equal(again.state, 'ok')
  assert.equal(again.value.length, 2)
  assert.equal(service.calls.length, 3)
})

test('settle: a denied exchange fails the whole call', async () => {
  freshHome()
  const service = fake(() => denied('结算无权限'))
  const result = await new FtshareFuturesMarketData(service).settle(['RB2611.SHFE'])
  assert.equal(result.state, 'denied')
  assert.equal(result.value, undefined)
})

test('closes: daily K close first, minute close fallback, date window passed through', async () => {
  freshHome()
  const service = fake((tool, args) => {
    if (tool === 'ft_v1_futures_kline') {
      assert.equal(args.interval, 'daily')
      if (args.symbol === 'TA611.CZCE') return available([])
      assert.equal(args.symbol, 'RB2611.SHFE')
      if (args.start !== undefined) {
        assert.equal(args.start, Date.parse('2026-10-21T00:00:00+08:00'))
        assert.equal(args.end, args.start + 86_400_000 - 1)
        return available([{ close: 3200, trade_date: 20261021 }])
      }
      return available([{ close: 3250, trade_date: 20261022 }])
    }
    assert.equal(tool, 'ft_v4_futures_minutes_realtime')
    return available([{ symbol: 'TA611.CZCE', close: 5555, trade_date: 20261022 }])
  })
  const data = new FtshareFuturesMarketData(service)
  const result = await data.closes(['RB2611.SHFE', 'TA611.CZCE'])

  assert.equal(result.state, 'ok')
  const rb = result.value.find(close => close.symbol === 'RB2611.SHFE')
  assert.equal(rb.close, 3250)
  assert.equal(rb.tradeDate, '2026-10-22')
  assert.equal(rb.source, 'daily')
  const ta = result.value.find(close => close.symbol === 'TA611.CZCE')
  assert.equal(ta.close, 5555)
  assert.equal(ta.tradeDate, '2026-10-22')
  assert.equal(ta.source, 'minutes')

  const dated = await data.closes(['RB2611.SHFE'], '2026-10-21')
  assert.equal(dated.state, 'ok')
  assert.equal(dated.value[0].close, 3200)
  assert.equal(dated.value[0].tradeDate, '2026-10-21')
})

test('empty upstream data maps to ok with an empty array', async () => {
  freshHome()
  const service = fake(tool => (tool === 'ft_v1_futures_kline' ? available([]) : available([])))
  const data = new FtshareFuturesMarketData(service)

  const contracts = await data.contracts()
  assert.equal(contracts.state, 'ok')
  assert.deepEqual(contracts.value, [])
  assert.match(contracts.notice, /为空/)

  const quotes = await data.quotes(['RB2611.SHFE'])
  assert.equal(quotes.state, 'ok')
  assert.deepEqual(quotes.value, [])
  assert.match(quotes.notice, /分钟行情/)

  const limits = await data.limits(['RB2611.SHFE'])
  assert.equal(limits.state, 'ok')
  assert.deepEqual(limits.value, [])

  const settle = await data.settle(['RB2611.SHFE'])
  assert.equal(settle.state, 'ok')
  assert.deepEqual(settle.value, [])

  const closes = await data.closes(['RB2611.SHFE'])
  assert.equal(closes.state, 'ok')
  assert.deepEqual(closes.value, [])
})

test('denied and failed upstream states propagate without throwing', async () => {
  freshHome()
  const deniedService = fake(() => denied('套餐无期货权限'))
  const deniedData = new FtshareFuturesMarketData(deniedService)
  assert.equal((await deniedData.contracts()).state, 'denied')
  assert.equal((await deniedData.quotes(['RB2611.SHFE'])).state, 'denied')
  assert.equal((await deniedData.closes(['RB2611.SHFE'])).state, 'denied')

  freshHome()
  const failedService = fake(() => failed('上游 500'))
  const failedData = new FtshareFuturesMarketData(failedService)
  const result = await failedData.contracts()
  assert.equal(result.state, 'failed')
  assert.match(result.notice, /上游 500/)
  const throwing = new FtshareFuturesMarketData({
    async listTools() {
      return []
    },
    async call() {
      throw new Error('连接中断')
    },
  })
  const thrown = await throwing.quotes(['RB2611.SHFE'])
  assert.equal(thrown.state, 'failed')
  assert.match(thrown.notice, /连接中断/)
})

test('quotes: bare code + exchange from the real minute feed maps back to the full symbol', async () => {
  const home = freshHome()
  const service = fake((tool) => {
    assert.equal(tool, 'ft_v4_futures_minutes_realtime')
    return available([
      {
        symbol: 'rb2611',
        exchange: 'SHFE',
        close: 3092,
        pre_settlement_price: 3117,
        high_limit_price: 3272,
        low_limit_price: 2961,
        updated_at: 1792652403103,
        trade_date: 20261022,
      },
    ])
  })
  process.env.DSH_HOME = home
  const result = await new FtshareFuturesMarketData(service).quotes(['RB2611.SHFE'])
  assert.equal(result.state, 'ok')
  assert.equal(result.value.length, 1)
  assert.equal(result.value[0].last, 3092)
  assert.equal(result.value[0].preSettlement, 3117)
})

test('limits: SHFE table failure falls back to the exact contract before minutes', async () => {
  const home = freshHome()
  const service = fake((tool, args) => {
    if (tool === 'ft_v1_futures_ft_limit') {
      if (typeof args.ts_code === 'string' && args.ts_code !== '') {
        return available([{ ts_code: 'RB2611.SHF', up_limit: 3273, down_limit: 2961, m_ratio: 10 }])
      }
      return failed('missing pre-settlement price')
    }
    return available([])
  })
  process.env.DSH_HOME = home
  const result = await new FtshareFuturesMarketData(service).limits(['RB2611.SHFE'])
  assert.equal(result.state, 'ok')
  assert.equal(result.value.length, 1)
  assert.equal(result.value[0].source, 'limit')
  assert.equal(result.value[0].upper, 3273)
  assert.equal(result.value[0].marginRate, 0.1)
  assert.ok(service.calls.some(call => call.tool === 'ft_v1_futures_ft_limit' && typeof call.args.ts_code === 'string'))
})

test('settle: an ad-valorem trading_fee_rate is surfaced for the service fallback', async () => {
  const home = freshHome()
  const service = fake(() => available([
    { ts_code: 'RB2611.SHF', settle: 3203, long_margin_rate: 0.07, trading_fee: '0', offset_today_fee: '0', trading_fee_rate: '0.1' },
  ]))
  process.env.DSH_HOME = home
  const result = await new FtshareFuturesMarketData(service).settle(['RB2611.SHFE'])
  assert.equal(result.state, 'ok')
  assert.equal(result.value[0].feeRate, 0.1)
})

test('closes: minute rows with a bare code still resolve for the minute fallback', async () => {
  const home = freshHome()
  const service = fake((tool) => {
    if (tool === 'ft_v1_futures_kline') return available([])
    if (tool === 'ft_v4_futures_minutes_realtime') {
      return available([{ symbol: 'rb2611', exchange: 'SHFE', close: 3100, trade_date: 20261022 }])
    }
    return available([])
  })
  process.env.DSH_HOME = home
  const result = await new FtshareFuturesMarketData(service).closes(['RB2611.SHFE'], '2026-10-22')
  assert.equal(result.state, 'ok')
  assert.equal(result.value.length, 1)
  assert.equal(result.value[0].close, 3100)
  assert.equal(result.value[0].source, 'minutes')
})
