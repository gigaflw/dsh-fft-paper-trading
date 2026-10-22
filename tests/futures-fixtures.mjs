import { join } from 'node:path'

/** Shared fixtures for the futures service/RPC tests. */

export const SYMBOL = 'RB2611.SHFE'
export const DATE1 = '2026-10-19'
export const DATE2 = '2026-10-20'

export const CONTRACT = {
  symbol: SYMBOL,
  name: '螺纹钢2611',
  product: 'rb',
  exchange: 'SHFE',
  multiplier: 10,
  tickSize: 1,
  marginRate: 0.1,
  tradeHours: '上午9:00-11:30,下午13:30-15:00,下午21:00-23:00(夜盘)',
  deListDate: '2026-11-30',
  volume: 10_000,
}
export const QUOTE = { symbol: SYMBOL, last: 3200, preSettlement: 3150, openInterest: 100_000, volume: 5_000 }
export const LIMIT = { symbol: SYMBOL, upper: 3400, lower: 3000, marginRate: 0.1, source: 'limit' }
export const SETTLE = { symbol: SYMBOL, feePerLotCents: 300, closeTodayFeePerLotCents: 600, longMarginRate: 0.09 }

export function makeHome(name) {
  return join(process.cwd(), 'tmp', 'paper-trading-test', `${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

/** Shanghai wall-clock instant: `date` at `minutes` since midnight. */
export function clockAt(date, minutes) {
  return new Date(Date.parse(`${date}T00:00:00+08:00`) + minutes * 60_000)
}

export const OPEN = 9 * 60
export const AM = 9 * 60 + 30
export const LUNCH = 12 * 60
export const PM = 14 * 60
export const CLOSE = 15 * 60
export const SETTLEMENT = 15 * 60 + 30

/**
 * Fake futures market-data port. Mutable, so a test can change quotes/limits
 * between calls or flip every call to `failed` to exercise the degraded path.
 */
export function makeFakeData() {
  const data = {
    fail: false,
    contractsCalls: 0,
    closeCalls: 0,
    contractList: [{ ...CONTRACT }],
    quoteMap: new Map([[SYMBOL, { ...QUOTE }]]),
    limitMap: new Map([[SYMBOL, { ...LIMIT }]]),
    settleMap: new Map([[SYMBOL, { ...SETTLE }]]),
    /** Explicit close per symbol; defaults to the latest quote when absent. */
    closeMap: new Map(),
    setQuote(last, ts) {
      data.quoteMap.set(SYMBOL, { ...(data.quoteMap.get(SYMBOL) ?? QUOTE), last, marketTs: ts })
    },
    async contracts(refresh) {
      data.contractsCalls += 1
      if (data.fail) return { state: 'failed', notice: '行情不可用' }
      return { state: 'ok', value: data.contractList.map(contract => ({ ...contract })) }
    },
    async quotes(symbols) {
      if (data.fail) return { state: 'failed', notice: '行情不可用' }
      const rows = symbols.map(symbol => data.quoteMap.get(symbol)).filter(Boolean).map(quote => ({ ...quote }))
      return rows.length > 0 ? { state: 'ok', value: rows } : { state: 'failed', notice: '无行情' }
    },
    async limits(symbols) {
      if (data.fail) return { state: 'failed', notice: '行情不可用' }
      const rows = symbols.map(symbol => data.limitMap.get(symbol)).filter(Boolean).map(limit => ({ ...limit }))
      return { state: 'ok', value: rows }
    },
    async settle(symbols) {
      if (data.fail) return { state: 'failed', notice: '行情不可用' }
      const rows = symbols.map(symbol => data.settleMap.get(symbol)).filter(Boolean).map(settle => ({ ...settle }))
      return { state: 'ok', value: rows }
    },
    async closes(symbols, date) {
      data.closeCalls += 1
      if (data.fail) return { state: 'failed', notice: '行情不可用' }
      const rows = []
      for (const symbol of symbols) {
        const close = data.closeMap.get(symbol) ?? data.quoteMap.get(symbol)?.last
        if (close === undefined) continue
        rows.push({ symbol, close, tradeDate: date, source: 'daily' })
      }
      return rows.length > 0 ? { state: 'ok', value: rows } : { state: 'failed', notice: '无收盘价' }
    },
  }
  return data
}

export function draft(overrides = {}) {
  return { symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1, ...overrides }
}

/** Account money in cents, avoiding float noise in assertions. */
export function cents(value) {
  return Math.round(value * 100)
}
