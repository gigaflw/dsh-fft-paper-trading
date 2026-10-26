import type { Bar, DataState, MarketListResult, Quote, SymbolHit } from '../contract.js'
import { todayTradeDate } from '../core/calendar.js'
import { boardOf, tryParseSymbol } from '../core/symbol.js'
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

/**
 * Source tag for a quote recovered from the daily candlestick series.
 *
 * The realtime interface is a paid-tier capability; without a key (or on any
 * realtime failure) the panel prices the ticket from the last daily close. That
 * is a different kind of number, so it must not be presented as a live tick.
 */
const DAILY_BAR_SOURCE = 'daily-bar'

/**
 * Quote-list boards. `ft_v2_stock_list_filter` (paid tier) has a `board`
 * parameter; the free A-share list does not, so the board is expressed as a
 * code-range filter and verified locally over the rows it returns.
 */
type ListBoard = 'all' | 'main' | 'star' | 'chi_next' | 'bjse' | 'xshg' | 'xshe'

/**
 * Board scope pushed upstream as a `filter` expression.
 *
 * `symbol_id` string ranges are the only way to name a board on this endpoint
 * (its `board` field is not filterable and the rows are code-sorted, so the
 * STAR range would sit a thousand rows deep in the SH page). Ranges follow the
 * exchange code plan in `core/symbol.ts`: SH main 600–605, SH STAR 688/689,
 * SZ main 000–003, SZ ChiNext 300–302.
 */
const LIST_BOARD_FILTER: Record<ListBoard, string | undefined> = {
  all: undefined,
  main: '(symbol_id >= "600000" AND symbol_id < "606000") OR (symbol_id >= "000000" AND symbol_id < "004000")',
  xshg: 'market_id = "XSHG"',
  xshe: 'market_id = "XSHE"',
  bjse: 'market_id = "BJSE"',
  star: 'symbol_id >= "688000" AND symbol_id < "690000"',
  chi_next: 'symbol_id >= "300000" AND symbol_id < "303000"',
}

/** Rows per upstream page and the scan cap that keeps a free-tier page cheap. */
const LIST_RAW_PAGE_SIZE = 500
const LIST_MAX_RAW_PAGES = 5

function listBoardOf(board: string | undefined): ListBoard {
  switch (board) {
    case 'main':
    case 'star':
    case 'chi_next':
    case 'bjse':
    case 'xshg':
    case 'xshe':
      return board
    default:
      return 'all'
  }
}

/** Local board test over one list row; unparseable codes never match. */
function matchesListBoard(board: ListBoard, row: Record<string, unknown>): boolean {
  if (board === 'all') return true
  const parsed = tryParseSymbol(String(row.symbol ?? row.symbol_id ?? ''))
  if (!parsed.ok) return false
  switch (board) {
    case 'xshg':
      return parsed.symbol.exchange === 'SH'
    case 'xshe':
      return parsed.symbol.exchange === 'SZ'
    case 'bjse':
      return parsed.symbol.exchange === 'BJ'
    default:
      return boardOf(parsed.symbol) === board
  }
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

  private async call(tool: string, args: Record<string, unknown>): Promise<{
    rows: Record<string, unknown>[]
    state: DataState
    notice?: string
    /** Upstream classification code (401/route_not_allowed/UPSTREAM_UNAVAILABLE…). */
    code?: string
  }> {
    try {
      const result = await this.service.call(tool, args)
      if (result.state === 'denied') {
        return { rows: [], state: 'denied', notice: result.notice?.message ?? '接口无权限', code: result.notice?.code }
      }
      if (result.state === 'failed') {
        return { rows: [], state: 'failed', notice: result.notice?.message ?? '接口调用失败', code: result.notice?.code }
      }
      return { rows: flatten(result.rows), state: 'ok' }
    } catch (error) {
      return { rows: [], state: 'failed', notice: String(error) }
    }
  }

  private async quoteFor(symbol: string): Promise<QuoteResult> {
    const parsed = tryParseSymbol(symbol)
    if (!parsed.ok) return { state: 'failed', quotes: [], notice: parsed.message }
    const apiSymbol = parsed.symbol.id
    const known = await this.available()
    const notices: string[] = []
    const codes: string[] = []
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
            const quote = this.toQuote(parsed.symbol.id, result.rows[result.rows.length - 1], DAILY_BAR_SOURCE)
            if (quote !== undefined) return { state: 'ok', quotes: [quote] }
          }
          if (result.notice !== undefined) notices.push(result.notice)
          if (result.code !== undefined) codes.push(result.code)
        }
        continue
      }
      const result = await this.call(tool, { symbols: [apiSymbol] })
      if (result.rows.length > 0) {
        const quote = this.toQuote(parsed.symbol.id, result.rows[result.rows.length - 1], tool)
        if (quote !== undefined) return { state: 'ok', quotes: [quote] }
      }
      if (result.notice !== undefined) notices.push(result.notice)
      if (result.code !== undefined) codes.push(result.code)
    }
    const denied = notices.some(notice => /权限|denied|route_not_allowed/i.test(notice))
    return {
      state: denied ? 'denied' : 'failed',
      quotes: [],
      notice: notices.join('；') || `没有 ${symbol} 的行情`,
      ...(codes.length === 0 ? {} : { noticeCode: codes[0] }),
    }
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
      st: row.st === true,
      status: pickString(row, ['status']),
      source,
    }
  }

  /** List rows carry the exchange too; an unknown code is dropped, never guessed. */
  private toListQuote(row: Record<string, unknown>): Quote | undefined {
    const last = pickNumber(row, ['close', 'last'])
    if (last === undefined) return undefined
    const parsed = tryParseSymbol(String(row.symbol ?? row.symbol_id ?? ''))
    if (!parsed.ok) return undefined
    return {
      symbol: parsed.symbol.id,
      name: pickString(row, ['name', 'symbol_name']),
      last,
      prevClose: pickNumber(row, ['prev_close', 'pre_close']),
      marketTs: marketTimestampOf(row) ?? null,
      fetchedAt: new Date().toISOString(),
      st: row.st === true,
      status: pickString(row, ['status']),
      source: 'ft_v1_daec_stocks',
    }
  }

  async quotes(symbols: string[]): Promise<QuoteResult> {
    const unique: string[] = []
    for (const symbol of symbols) {
      const parsed = tryParseSymbol(symbol)
      if (!parsed.ok) return { state: 'failed', quotes: [], notice: parsed.message }
      if (!unique.includes(parsed.symbol.id)) unique.push(parsed.symbol.id)
    }
    if (unique.length === 0) return { state: 'ok', quotes: [] }
    const quotes: Quote[] = []
    const notices: string[] = []
    let denied = false
    let noticeCode: string | undefined
    for (const symbol of unique) {
      const result = await this.quoteFor(symbol)
      quotes.push(...result.quotes)
      if (result.state === 'denied') denied = true
      if (result.noticeCode !== undefined && noticeCode === undefined) noticeCode = result.noticeCode
      if (result.notice !== undefined && result.quotes.length === 0) notices.push(result.notice)
    }
    if (quotes.length === 0) {
      return {
        state: denied ? 'denied' : 'failed',
        quotes,
        notice: notices.join('；') || '行情不可用',
        ...(noticeCode === undefined ? {} : { noticeCode }),
      }
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
        const parsed = tryParseSymbol(String(row.symbol ?? ''))
        if (parsed.ok) symbols.add(parsed.symbol.id)
      }
    } catch {
      // The suspension list is best effort; an outage must not block quotes.
    }
    this.suspensionCache = { date, symbols }
    return symbols
  }

  async dailyBars(symbol: string, limit: number): Promise<BarsResult> {
    const parsed = tryParseSymbol(symbol)
    if (!parsed.ok) return { state: 'failed', bars: [], notice: parsed.message }
    const apiSymbol = parsed.symbol.id
    const known = await this.available()
    const notices: string[] = []
    const codes: string[] = []
    for (const tool of this.klineTools) {
      if (known !== undefined && !known.has(tool)) continue
      for (const interval of INTERVAL_UNITS) {
        const args = tool === 'ft_v2_stock_candlesticks_batch'
          ? { symbols: [apiSymbol], interval_unit: interval, limit, until_ts_millis: Date.now() }
          : { symbol: apiSymbol, interval_unit: interval, limit, until_ts_millis: Date.now() }
        const result = await this.call(tool, args)
        if (result.rows.length > 0) {
          const bars = result.rows.map(row => this.toBar(row)).filter((bar): bar is Bar => bar !== undefined)
          if (bars.length > 0) {
            bars.sort((a, b) => a.time.localeCompare(b.time))
            return { state: 'ok', bars: bars.slice(-limit) }
          }
        }
        if (result.notice !== undefined) notices.push(result.notice)
        if (result.code !== undefined) codes.push(result.code)
      }
    }
    return {
      state: 'failed',
      bars: [],
      notice: notices.join('；') || `没有 ${symbol} 的日 K 数据`,
      ...(codes.length === 0 ? {} : { noticeCode: codes[0] }),
    }
  }

  async minuteBars(symbol: string, date?: string): Promise<BarsResult> {
    const parsed = tryParseSymbol(symbol)
    if (!parsed.ok) return { state: 'failed', bars: [], notice: parsed.message }
    const apiSymbol = parsed.symbol.id
    const target = date ?? todayTradeDate()
    if (target === todayTradeDate()) {
      const result = await this.call('ft_v4_stock_realtime_minute_kline', { symbols: [apiSymbol] })
      if (result.rows.length > 0) {
        const bars = result.rows.map(row => this.toBar(row)).filter((bar): bar is Bar => bar !== undefined)
        bars.sort((a, b) => a.time.localeCompare(b.time))
        return { state: 'ok', bars }
      }
      if (result.notice !== undefined) {
        return { state: result.state, bars: [], notice: result.notice, ...(result.code === undefined ? {} : { noticeCode: result.code }) }
      }
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
    return {
      state: result.state,
      bars: [],
      notice: result.notice ?? `没有 ${symbol} 的分钟数据`,
      ...(result.code === undefined ? {} : { noticeCode: result.code }),
    }
  }

  async search(query: string, limit: number): Promise<SymbolHit[]> {
    const result = await this.call('ft_v1_search', { query, limit })
    const hits: SymbolHit[] = []
    for (const row of result.rows) {
      const parsed = tryParseSymbol(String(row.symbol ?? ''))
      if (!parsed.ok) continue
      const name = String(row.name ?? '')
      if (name === '') continue
      hits.push({ symbol: parsed.symbol.id, name })
    }
    return hits
  }

  /**
   * Paged A-share quote list from the free-tier endpoint.
   *
   * The paid filter interface is not available without a key, so the board is
   * resolved from the canonical symbol instead: a code range (or exchange) goes
   * upstream as a `filter` expression and the board split is checked again
   * locally on the rows we keep. A page may still need a few upstream pages when
   * the local check drops rows, which is acceptable for a list the user opens
   * on demand.
   */
  async marketList(input: { board?: string; page?: number; pageSize?: number } = {}): Promise<MarketListResult> {
    const page = Math.max(1, input.page ?? 1)
    const pageSize = Math.min(Math.max(1, input.pageSize ?? 50), 500)
    const board = listBoardOf(input.board)
    const filter = LIST_BOARD_FILTER[board]
    const wanted = page * pageSize
    const rows: Record<string, unknown>[] = []
    let state: DataState = 'ok'
    let notice: string | undefined
    let noticeCode: string | undefined
    let rawPage = 1
    while (rows.length < wanted && rawPage <= LIST_MAX_RAW_PAGES) {
      const result = await this.call('ft_v1_daec_stocks', {
        page: rawPage,
        page_size: LIST_RAW_PAGE_SIZE,
        ...(filter === undefined ? {} : { filter }),
      })
      if (result.state !== 'ok') {
        state = result.state
        notice = result.notice
        noticeCode = result.code
        break
      }
      for (const row of result.rows) {
        if (matchesListBoard(board, row)) rows.push(row)
      }
      if (result.rows.length < LIST_RAW_PAGE_SIZE) break
      rawPage += 1
    }
    if (state === 'ok' && rows.length < wanted && notice === undefined) {
      // Not a tier limit: this adapter stops scanning after LIST_MAX_RAW_PAGES,
      // so say what the reader can do rather than naming a plan they may not have.
      notice = '列表翻页有上限，可用搜索或换板块继续找'
    }
    return {
      state,
      quotes: rows.slice((page - 1) * pageSize, wanted)
        .map(row => this.toListQuote(row))
        .filter((quote): quote is Quote => quote !== undefined),
      page,
      notice,
      ...(noticeCode === undefined ? {} : { noticeCode }),
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
