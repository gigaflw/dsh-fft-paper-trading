import type { Bar, DataState, MarketListResult, Quote, SymbolHit } from '../contract.js'
import { todayTradeDate } from '../core/calendar.js'
import type { BarsResult, MarketDataPort, QuoteResult } from './market-data-port.js'

/** Structural slice of `ctx.ftshareData`; no runtime import across packages. */
export interface FtshareToolInfoLike {
  tool: string
  title: string
  description?: string
  inputSchema?: unknown
}

export interface FtshareDataLike {
  call(interfaceName: string, args?: Record<string, unknown>): Promise<{
    ok: boolean
    state: 'available' | 'empty' | 'denied' | 'failed'
    rows: Record<string, unknown>[]
    notice?: { code: string; message: string }
  }>
  listTools(): Promise<readonly FtshareToolInfoLike[]>
}

interface Mapping {
  quoteTools?: string[]
  klineTools?: string[]
}

/** Per-symbol realtime bars first, then the generic candlestick endpoint. */
const DEFAULT_QUOTE_TOOLS = ['ft_v4_stock_realtime_day_kline', 'ft_v1_stock_candlesticks']
const DEFAULT_KLINE_TOOLS = ['ft_v1_stock_candlesticks', 'ft_v2_stock_candlesticks_batch']
const INTERVAL_UNITS = ['day', 'Day']

function normalizeSymbol(symbol: string): string {
  const text = symbol.trim().toUpperCase()
  if (/\.(SH|SZ|BJ|XSHG|XSHE)$/.test(text)) return text
  if (/^\d{6}$/.test(text)) {
    if (text.startsWith('6')) return `${text}.SH`
    if (text.startsWith('0') || text.startsWith('3')) return `${text}.SZ`
    if (text.startsWith('8') || text.startsWith('4')) return `${text}.BJ`
  }
  return text
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, ''))
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
  }
  return undefined
}

function pickString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

function marketTimestampOf(row: Record<string, unknown>): string | undefined {
  const numeric = pickNumber(row, ['ts_millis', 'ts_ms', 'timestamp', 'ts'])
  if (numeric !== undefined) {
    const millis = numeric > 1e12 ? numeric : numeric * 1000
    return new Date(millis).toISOString()
  }
  const text = pickString(row, ['datetime', 'trade_date'])
  if (text !== undefined) {
    const parsed = Date.parse(text)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return undefined
}

function timestampOf(row: Record<string, unknown>): string {
  return marketTimestampOf(row) ?? new Date().toISOString()
}

/** Expand `{ symbol, items: [...] }` groups into flat rows. */
function flatten(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const visit = (value: unknown, parent?: Record<string, unknown>): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parent)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const row = value as Record<string, unknown>
    const merged = parent === undefined ? row : { ...parent, ...row }
    const items = row.items
    if (Array.isArray(items)) {
      for (const item of items) visit(item, merged)
      return
    }
    out.push(merged)
  }
  visit(rows)
  return out
}

/**
 * FTShare adapter.
 *
 * The gateway exposes one interface per dataset and their parameter schemas
 * differ; the adapter pins a small preference list, normalises symbols to the
 * `.SH` / `.SZ` form the interfaces expect and flattens grouped rows.
 */
export class FtshareMarketData implements MarketDataPort {
  private readonly quoteTools: string[]
  private readonly klineTools: string[]
  private known: Set<string> | undefined
  private suspensionCache: { date: string; symbols: Set<string> } | undefined

  constructor(private readonly service: FtshareDataLike, overrides: Mapping = {}) {
    this.quoteTools = overrides.quoteTools ?? DEFAULT_QUOTE_TOOLS
    this.klineTools = overrides.klineTools ?? DEFAULT_KLINE_TOOLS
  }

  private async available(): Promise<Set<string> | undefined> {
    if (this.known !== undefined) return this.known
    try {
      const tools = await this.service.listTools()
      this.known = new Set(tools.map(tool => tool.tool))
    } catch {
      this.known = undefined
    }
    return this.known
  }

  private async call(tool: string, args: Record<string, unknown>): Promise<{ rows: Record<string, unknown>[]; state: DataState; notice?: string }> {
    try {
      const result = await this.service.call(tool, args)
      if (result.state === 'denied') {
        return { rows: [], state: 'denied', notice: result.notice?.message ?? '接口无权限' }
      }
      if (result.state === 'failed') {
        return { rows: [], state: 'failed', notice: result.notice?.message ?? '接口调用失败' }
      }
      return { rows: flatten(result.rows), state: 'ok' }
    } catch (error) {
      return { rows: [], state: 'failed', notice: String(error) }
    }
  }

  private async quoteFor(symbol: string): Promise<QuoteResult> {
    const apiSymbol = normalizeSymbol(symbol)
    const known = await this.available()
    const notices: string[] = []
    for (const tool of this.quoteTools) {
      if (known !== undefined && !known.has(tool)) continue
      if (tool === 'ft_v1_stock_candlesticks' || tool === 'ft_v2_stock_candlesticks_batch') {
        for (const interval of INTERVAL_UNITS) {
          const result = await this.call(tool, {
            symbol: apiSymbol,
            interval_unit: interval,
            limit: 2,
            until_ts_millis: Date.now(),
          })
          if (result.rows.length > 0) {
            const quote = this.toQuote(symbol, result.rows[result.rows.length - 1], tool)
            if (quote !== undefined) return { state: 'ok', quotes: [quote] }
          }
          if (result.notice !== undefined) notices.push(result.notice)
        }
        continue
      }
      const result = await this.call(tool, { symbols: [apiSymbol] })
      if (result.rows.length > 0) {
        const quote = this.toQuote(symbol, result.rows[result.rows.length - 1], tool)
        if (quote !== undefined) return { state: 'ok', quotes: [quote] }
      }
      if (result.notice !== undefined) notices.push(result.notice)
    }
    const denied = notices.some(notice => /权限|denied|route_not_allowed/i.test(notice))
    return { state: denied ? 'denied' : 'failed', quotes: [], notice: notices.join('；') || `没有 ${symbol} 的行情` }
  }

  private toQuote(symbol: string, row: Record<string, unknown>, source: string): Quote | undefined {
    const last = pickNumber(row, ['close', 'last', 'latest', 'price', '收盘', '最新价'])
    if (last === undefined) return undefined
    const prevClose = pickNumber(row, ['prev_close', 'pre_close', 'preclose', '昨收'])
    const marketTs = marketTimestampOf(row) ?? null
    return {
      symbol,
      name: pickString(row, ['name', 'symbol_name', '名称', 'sec_name']),
      last,
      prevClose,
      marketTs,
      fetchedAt: new Date().toISOString(),
      board: pickString(row, ['board']),
      st: row.st === true,
      status: pickString(row, ['status']),
      source,
    }
  }

  private toListQuote(row: Record<string, unknown>): Quote | undefined {
    const last = pickNumber(row, ['close', 'last'])
    if (last === undefined) return undefined
    return {
      symbol: String(row.symbol ?? row.symbol_id ?? ''),
      name: pickString(row, ['name', 'symbol_name']),
      last,
      prevClose: pickNumber(row, ['prev_close', 'pre_close']),
      marketTs: null,
      fetchedAt: new Date().toISOString(),
      board: pickString(row, ['board']),
      st: row.st === true,
      status: pickString(row, ['status']),
      source: 'ft_v1_daec_stocks',
    }
  }

  async quotes(symbols: string[]): Promise<QuoteResult> {
    const unique = [...new Set(symbols.map(symbol => symbol.trim()).filter(Boolean))]
    if (unique.length === 0) return { state: 'ok', quotes: [] }
    const quotes: Quote[] = []
    const notices: string[] = []
    let denied = false
    for (const symbol of unique) {
      const result = await this.quoteFor(symbol)
      quotes.push(...result.quotes)
      if (result.state === 'denied') denied = true
      if (result.notice !== undefined && result.quotes.length === 0) notices.push(result.notice)
    }
    if (quotes.length === 0) {
      return { state: denied ? 'denied' : 'failed', quotes, notice: notices.join('；') || '行情不可用' }
    }
    const suspended = await this.suspendedSymbols()
    for (const quote of quotes) {
      if (suspended.has(quote.symbol)) quote.status = 'suspended'
    }
    return { state: 'ok', quotes, notice: notices.length > 0 ? notices.join('；') : undefined }
  }

  private async suspendedSymbols(): Promise<Set<string>> {
    const date = todayTradeDate()
    if (this.suspensionCache?.date === date) return this.suspensionCache.symbols
    const symbols = new Set<string>()
    try {
      const result = await this.call('ft_v1_suspension_list', { page: 1, page_size: 200 })
      for (const row of result.rows) {
        const symbol = String(row.symbol ?? '').toUpperCase()
        if (symbol !== '') symbols.add(symbol)
      }
    } catch {
      // The suspension list is best effort; an outage must not block quotes.
    }
    this.suspensionCache = { date, symbols }
    return symbols
  }

  async dailyBars(symbol: string, limit: number): Promise<BarsResult> {
    const known = await this.available()
    const notices: string[] = []
    for (const tool of this.klineTools) {
      if (known !== undefined && !known.has(tool)) continue
      for (const interval of INTERVAL_UNITS) {
        const args = tool === 'ft_v2_stock_candlesticks_batch'
          ? { symbols: [normalizeSymbol(symbol)], interval_unit: interval, limit, until_ts_millis: Date.now() }
          : { symbol: normalizeSymbol(symbol), interval_unit: interval, limit, until_ts_millis: Date.now() }
        const result = await this.call(tool, args)
        if (result.rows.length > 0) {
          const bars = result.rows.map(row => this.toBar(row)).filter((bar): bar is Bar => bar !== undefined)
          if (bars.length > 0) {
            bars.sort((a, b) => a.time.localeCompare(b.time))
            return { state: 'ok', bars: bars.slice(-limit) }
          }
        }
        if (result.notice !== undefined) notices.push(result.notice)
      }
    }
    return { state: 'failed', bars: [], notice: notices.join('；') || `没有 ${symbol} 的日 K 数据` }
  }

  async minuteBars(symbol: string, date?: string): Promise<BarsResult> {
    const apiSymbol = normalizeSymbol(symbol)
    const target = date ?? todayTradeDate()
    if (target === todayTradeDate()) {
      const result = await this.call('ft_v4_stock_realtime_minute_kline', { symbols: [apiSymbol] })
      if (result.rows.length > 0) {
        const bars = result.rows.map(row => this.toBar(row)).filter((bar): bar is Bar => bar !== undefined)
        bars.sort((a, b) => a.time.localeCompare(b.time))
        return { state: 'ok', bars }
      }
      if (result.notice !== undefined) return { state: result.state, bars: [], notice: result.notice }
    }
    const start = Date.parse(`${target}T00:00:00+08:00`)
    const result = await this.call('ft_v2_stock_minutes', {
      symbol: apiSymbol,
      since_ts_millis: start,
      until_ts_millis: start + 86_400_000 - 1,
      interval_value: 1,
    })
    if (result.rows.length > 0) {
      const bars = result.rows.map(row => this.toBar(row)).filter((bar): bar is Bar => bar !== undefined)
      bars.sort((a, b) => a.time.localeCompare(b.time))
      return { state: 'ok', bars }
    }
    return { state: result.state, bars: [], notice: result.notice ?? `没有 ${symbol} 的分钟数据` }
  }

  async search(query: string, limit: number): Promise<SymbolHit[]> {
    const result = await this.call('ft_v1_search', { query, limit })
    return result.rows
      .map(row => ({
        symbol: String(row.symbol ?? ''),
        name: String(row.name ?? ''),
        board: pickString(row, ['board']),
      }))
      .filter(hit => hit.symbol !== '')
  }

  async marketList(input: { board?: string; page?: number; pageSize?: number } = {}): Promise<MarketListResult> {
    const page = Math.max(1, input.page ?? 1)
    if (input.board !== undefined) {
      const result = await this.call('ft_v2_stock_list_filter', {
        board: input.board,
        page,
        page_size: Math.min(Math.max(1, input.pageSize ?? 50), 500),
      })
      return {
        state: result.state,
        quotes: result.rows.map(row => this.toListQuote(row)).filter((quote): quote is Quote => quote !== undefined),
        page,
        notice: result.notice,
      }
    }
    const result = await this.call('ft_v1_daec_stocks', { page, page_size: Math.min(Math.max(1, input.pageSize ?? 50), 500) })
    return {
      state: result.state,
      quotes: result.rows.map(row => this.toListQuote(row)).filter((quote): quote is Quote => quote !== undefined),
      page,
      notice: result.notice,
    }
  }

  private toBar(row: Record<string, unknown>): Bar | undefined {
    const close = pickNumber(row, ['close', '收盘', 'close_price'])
    if (close === undefined) return undefined
    return {
      time: timestampOf(row),
      open: pickNumber(row, ['open', '开盘']) ?? close,
      high: pickNumber(row, ['high', '最高']) ?? close,
      low: pickNumber(row, ['low', '最低']) ?? close,
      close,
      volume: pickNumber(row, ['volume', 'vol', '成交量']),
    }
  }
}
