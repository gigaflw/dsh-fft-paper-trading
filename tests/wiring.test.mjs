import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const TOOL_NAMES = [
  'paper_account', 'paper_cancel', 'paper_export', 'paper_ledger', 'paper_market', 'paper_order',
  'paper_preview', 'paper_quote', 'paper_review', 'paper_status', 'paper_tick',
  'futures_account', 'futures_cancel', 'futures_contracts', 'futures_order', 'futures_positions',
  'futures_preview', 'futures_quote', 'futures_review',
]

/** Scratch `$DSH_HOME` so both tests open their own ledger. */
async function withHome(name, body) {
  const home = join(process.cwd(), 'build', 'paper-trading-test', `${name}-${process.pid}-${Date.now()}`)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await body()
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
}

/**
 * Fake host context. `ftshareData` is attached only when given, so the same
 * helper serves the "no data service" and the "FTShare arrived" worlds.
 */
function createContext(options = {}) {
  const { ftshareData } = options
  const tools = []
  const routes = []
  const effects = []
  const ctx = {
    logger: () => ({ warn() {} }),
    effect(callback, label) {
      const dispose = callback()
      effects.push({ label, dispose })
      return dispose
    },
    inject(dependencies, callback) {
      if (dependencies.includes('connection')) {
        callback({
          get: () => ({ fetch: { register: route => { routes.push(route); return async () => {} } } }),
          effect: fn => { fn(); return () => {} },
        })
      } else if (dependencies.includes('tools')) {
        callback({ get: () => ({ register: tool => tools.push(tool) }) })
      } else if (dependencies.includes('ftshareData') && ftshareData !== undefined) {
        callback({ get: () => ftshareData, effect: fn => { fn(); return () => {} } })
      }
      // `ftshareSettings` stays absent on purpose in both worlds.
      return undefined
    },
  }
  const call = async (endpoint, payload) => {
    const response = await routes[0].fetch(new Request('http://127.0.0.1/api/ft-paper-trading', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload }),
    }))
    assert.equal(response.status, 200)
    return response.json()
  }
  return { ctx, tools, routes, effects, call }
}

/** Every calendar day between two `YYYYMMDD` integers, as the upstream shape. */
function isoDays(startDate, endDate) {
  const parse = value => new Date(Date.UTC(
    Math.floor(value / 10000),
    Math.floor(value / 100) % 100 - 1,
    value % 100,
  ))
  const days = []
  const cursor = parse(startDate)
  const end = parse(endDate)
  while (cursor <= end) {
    days.push(Number([
      cursor.getUTCFullYear(),
      String(cursor.getUTCMonth() + 1).padStart(2, '0'),
      String(cursor.getUTCDate()).padStart(2, '0'),
    ].join('')))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

/**
 * The host entry must attach the route and the tools even when `ftshareData`
 * never shows up: market data is optional, the ledger is not. The fake context
 * deliberately never resolves the FTShare service.
 */
test('wiring: route and tools attach without the market-data service', async () => {
  await withHome('wiring', async () => {
    const { ctx, tools, routes, effects, call } = createContext()
    apply(ctx)

    assert.deepEqual(tools.map(tool => tool.name).sort(), [...TOOL_NAMES].sort())
    assert.equal(routes.length, 1)
    assert.ok(effects.some(effect => effect.label === 'ft-paper-trading: matching scheduler'), 'host scheduler must start with the row')

    const account = await call('account/get')
    assert.equal(account.ok, true)
    assert.equal(account.value.cash, 100_000)
    assert.match(account.value.ledgerPath ?? '', /events\.jsonl$/, 'the account view names its ledger file')

    const export_ = await tools.find(tool => tool.name === 'paper_export').execute({})
    assert.match(export_.summary, /events\.jsonl/, 'paper_export prints the ledger path')
    assert.equal(export_.data.exists, true)
    assert.equal(export_.data.blocked, false)

    const quote = await call('market/quote', { symbols: ['600519.SH'] })
    assert.equal(quote.ok, true)
    assert.equal(quote.value.state, 'failed')
    assert.match(quote.value.notice, /行情服务未就绪/)

    const preview = await call('order/preview', { symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 })
    assert.equal(preview.ok, true)
    assert.equal(preview.value.quote, undefined)
    assert.ok(preview.value.warnings.length > 0)

    const futures = await call('futures/account/get')
    assert.equal(futures.ok, true)
    assert.equal(futures.value.initialCash, 1_000_000)
    assert.match(futures.value.ledgerPath ?? '', /futures[/\\]events\.jsonl$/, 'the futures account has its own ledger')
    assert.ok(effects.some(effect => effect.label === 'ft-paper-trading: futures scheduler'), 'futures settlement scheduler must start too')
  })
})

/**
 * Regression: the services take their calendar port before the lazy FTShare
 * injection runs, so handing them the current slot froze the stocks service on
 * the weekday fallback: the panel said 交易日历降级 forever and T+1, order
 * expiry, settlement and "next trading day" ignored exchange holidays.
 */
test('wiring: stocks and futures both follow the injected FTShare calendar', async () => {
  await withHome('wiring-calendar', async () => {
    const calendarCalls = []
    const source = { name: 'FTShare', fetchedAt: new Date().toISOString() }
    const ftshareData = {
      async call(tool, args) {
        if (tool === 'ft_v1_time_trading_calendar') {
          calendarCalls.push(args)
          return { ok: true, state: 'available', rows: [{ trade_dates: isoDays(args.start_date, args.end_date) }], source }
        }
        return { ok: true, state: 'empty', rows: [], source }
      },
    }
    const { ctx, call } = createContext({ ftshareData })
    apply(ctx)

    const status = await call('market/status')
    assert.equal(status.ok, true)
    assert.equal(status.value.calendar.source, 'ftshare', 'stocks must use the FTShare calendar, not the weekday stand-in')
    assert.equal(status.value.calendar.reason, undefined)
    assert.ok(calendarCalls.length > 0, 'opening the account must ask the real calendar')

    const futures = await call('futures/status')
    assert.equal(futures.ok, true)
    assert.equal(futures.value.calendar.source, 'ftshare', 'the shared port keeps the futures status honest too')
  })
})
