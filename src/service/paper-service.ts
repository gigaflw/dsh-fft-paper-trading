import { randomUUID } from 'node:crypto'
import type {
  AccountView,
  Bar,
  BasketOrderInput,
  BasketOrderResult,
  BasketOrderRowResult,
  BasketPreview,
  CashFlowEntry,
  DayReport,
  ErrorCode,
  FillView,
  LedgerExport,
  MarketStatus,
  OrderDraft,
  OrderView,
  PaperSettings,
  PreviewView,
  Quote,
  ReviewView,
  RoundTrip,
  TickView,
  SessionPhase,
} from '../contract.js'
import { DEFAULT_ACCOUNT_ID, DEFAULT_SETTINGS } from '../contract.js'
import { cancelOrder, closeDay, depositCash, equityCents, openAccount, openDay, preOpenDay, releaseQueued, submit, tick as engineTick, withdrawCash, type EngineResult } from '../core/engine.js'
import { todayTradeDate, tradeDateOf } from '../core/calendar.js'
import { canMatch, canSubmit, isoAtShanghai, sessionPhaseAt, shanghaiClock } from '../core/session.js'
import { normalizeSettings } from '../core/settings.js'
import { allocateBasket, parseBasketCsv } from '../core/basket.js'
import { requireStock, tryParseSymbol, type ListedSymbol } from '../core/symbol.js'
import { computeFees } from '../core/fees.js'
import { prevCloseFromBars } from '../core/price-limit.js'
import { roundPrice } from '../core/money.js'
import { checkOrder, estimatePrice } from '../core/risk.js'
import { toAccountView, toFillView, toOrderView, toReview, previewOrder } from '../core/views.js'
import type { AccountState, LedgerEvent, Order } from '../core/types.js'
import type { BarsResult, MarketDataPort, QuoteResult } from '../data/market-data-port.js'
import type { TradingCalendarPort } from '../data/trading-calendar-port.js'
import type { AccountStore } from '../store/port.js'
import type { ShortlistStore } from '../store/shortlist.js'
import { PaperError } from './errors.js'
import { QuoteRefreshGate } from './quote-gate.js'

export interface PaperServiceOptions {
  repo: AccountStore
  data: MarketDataPort
  calendar: TradingCalendarPort
  shortlist?: ShortlistStore
  settings?: PaperSettings
  accountId?: string
  now?: () => Date
  logger?: { warn(message: string): void }
}

/** Why the account is locked, flattened to one readable line. */
function reasonText(reason: string | undefined, limit = 120): string {
  if (reason === undefined || reason === '') return ''
  const flat = reason.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`
}

export interface LedgerStatus {
  path: string
  exists: boolean
  blocked: boolean
  blockedReason?: string
}

interface PlaceOutcome {
  orderId?: string
  duplicateId?: string
  blocked?: boolean
}

type CancelOutcome = { missing?: boolean; notPending?: boolean; blocked?: boolean }

interface BasketPlaceOutcome {
  rows: BasketOrderRowResult[]
  blocked?: boolean
}

/** Orchestrates the ledger, the data port, the calendar and the clock. No IO of its own. */
export class PaperService {
  private readonly settings: PaperSettings
  private readonly accountId: string
  private readonly now: () => Date
  private readonly quoteGate = new QuoteRefreshGate()
  private tickQuotes: { key: string; quotes: Quote[] } | undefined

  constructor(private readonly options: PaperServiceOptions) {
    this.settings = normalizeSettings(options.settings ?? DEFAULT_SETTINGS)
    this.accountId = options.accountId ?? DEFAULT_ACCOUNT_ID
    this.now = options.now ?? (() => new Date())
  }

  private ts(): string {
    return this.now().toISOString()
  }

  /** Attach the on-disk location so a locked account is repairable from a reply. */
  private viewOf(state: AccountState): AccountView {
    const view = toAccountView(state)
    const path = this.options.repo.ledgerPath
    return path === undefined ? view : { ...view, ledgerPath: path }
  }

  /** The single place that turns a blocked state into an error carrying its reason. */
  private blocked(state: AccountState): PaperError {
    const reason = reasonText(state.blockedReason)
    return new PaperError('ACCOUNT_BLOCKED', `账户已锁定，请重置后继续${reason === '' ? '' : `（${reason}）`}`, 409)
  }

  async account(): Promise<AccountView> {
    return this.viewOf(await this.sync())
  }

  /** Open the account on first use, through the store transaction. */
  private async ensureAccount(): Promise<AccountState> {
    const outcome = await this.options.repo.transact(async state => {
      if (state.tradeDate !== '') return { events: [], value: undefined }
      const now = this.now()
      const tradeDate = await this.tradeDateForNow()
      const result = openAccount(state, this.settings, tradeDate, now.toISOString(), this.accountId)
      return { events: result.events, value: undefined }
    })
    return outcome.state
  }

  /** Open if needed, then advance the clock; every public read uses this. */
  private async sync(): Promise<AccountState> {
    await this.ensureAccount()
    return this.advanceTo()
  }

  private async tradeDateForNow(): Promise<string> {
    const today = todayTradeDate(this.now())
    return (await this.options.calendar.isTradingDay(today)) ? today : this.options.calendar.nextTradingDay(today)
  }

  /** Parse a symbol that may be any instrument (quote, chart, search result). */
  private identify(symbol: string): ListedSymbol {
    const parsed = tryParseSymbol(symbol)
    if (!parsed.ok) throw new PaperError(parsed.code, parsed.message, 400)
    return parsed.symbol
  }

  /** Parse a symbol that must be an A-share stock; indices and funds cannot trade. */
  private identifyStock(symbol: string): ListedSymbol {
    const parsed = requireStock(symbol)
    if (!parsed.ok) throw new PaperError(parsed.code, parsed.message, 400)
    return parsed.symbol
  }

  /** Symbols whose price the account cares about: open orders and held positions. */
  private symbolsInPlay(state: AccountState): string[] {
    const symbols = new Set<string>()
    for (const order of Object.values(state.orders)) {
      if (order.status === 'pending' || order.status === 'queued' || order.status === 'partially_filled') symbols.add(order.symbol)
    }
    for (const position of Object.values(state.positions)) symbols.add(position.symbol)
    return [...symbols]
  }

  /**
   * Fetch quotes once and normalise failures into the port's four-state result,
   * so every caller (preview, place, tick, day boundaries) reports the same shape.
   */
  private async fetchQuotes(symbols: readonly string[]): Promise<QuoteResult> {
    if (symbols.length === 0) return { state: 'ok', quotes: [] }
    try {
      return await this.options.data.quotes([...symbols])
    } catch (error) {
      this.options.logger?.warn(`paper-trading: quote refresh failed: ${String(error)}`)
      return { state: 'failed', quotes: [], notice: String(error) }
    }
  }

  private async fetchBars(symbols: readonly string[], limit = 10): Promise<Map<string, Bar[]>> {
    const result = new Map<string, Bar[]>()
    for (const symbol of symbols) {
      try {
        const bars = await this.options.data.dailyBars(symbol, limit)
        if (bars.state === 'ok' && bars.bars.length > 0) result.set(symbol, bars.bars)
      } catch {
        // best effort: boundary snapshots fall back to the live quote
      }
    }
    return result
  }

  private async boundaryQuotes(
    state: AccountState,
    date: string,
    mode: 'open' | 'close',
    fallback: Quote[],
  ): Promise<{ quotes: Quote[]; source: 'daily' | 'last' | 'missing' }> {
    const symbols = this.symbolsInPlay(state)
    if (symbols.length === 0) return { quotes: [], source: 'daily' }
    const bars = await this.fetchBars(symbols, 12)
    const live = new Map(fallback.map(quote => [quote.symbol, quote]))
    let usedDaily = 0
    const quotes: Quote[] = []
    for (const symbol of symbols) {
      const list = bars.get(symbol) ?? []
      const bar = list.find(item => tradeDateOf(item.time) === date)
      const liveQuote = live.get(symbol)
      if (bar !== undefined) {
        const index = list.indexOf(bar)
        const previous = index > 0 ? list[index - 1] : undefined
        quotes.push({
          symbol,
          name: liveQuote?.name,
          last: mode === 'open' ? bar.open : bar.close,
          prevClose: previous?.close ?? liveQuote?.prevClose,
          marketTs: bar.time,
          fetchedAt: this.ts(),
          source: 'daily-bar',
        })
        usedDaily += 1
      } else if (liveQuote !== undefined) {
        quotes.push(liveQuote)
      }
    }
    const source = usedDaily === symbols.length ? 'daily' : quotes.length > 0 ? 'last' : 'missing'
    return { quotes, source }
  }

  private hasClosed(state: AccountState, date: string): boolean {
    return state.dayEquity.some(point => point.date === date)
  }

  /**
   * Build the close events for one trade date. Data is fetched here; the
   * enclosing store transaction owns the append, so a concurrent read cannot
   * build the same snapshot twice.
   */
  private async buildClose(state: AccountState, date: string, next: string, nowIso: string): Promise<EngineResult> {
    if (this.hasClosed(state, date)) return { events: [], state }
    const at = isoAtShanghai(date, 15 * 60)
    const live = await this.fetchQuotes(this.symbolsInPlay(state))
    const boundary = await this.boundaryQuotes(state, date, 'close', live.quotes)
    return closeDay(state, {
      date,
      nextTradeDate: next,
      ts: at,
      recordedAt: nowIso,
      quotes: boundary.quotes,
      closeSource: boundary.source,
    })
  }

  private buildPreOpen(state: AccountState, date: string): EngineResult {
    if (state.tradeDate === date) return { events: [], state }
    return preOpenDay(state, date, isoAtShanghai(date, 9 * 60 + 15))
  }

  private async buildOpen(state: AccountState, date: string, nowIso: string): Promise<EngineResult> {
    if (state.lastOpenedDate === date) return { events: [], state }
    const at = isoAtShanghai(date, 9 * 60 + 30)
    const live = await this.fetchQuotes(this.symbolsInPlay(state))
    const boundary = await this.boundaryQuotes(state, date, 'open', live.quotes)
    return openDay(state, { date, ts: at, recordedAt: nowIso, quotes: boundary.quotes })
  }

  /**
   * Idempotent clock advance: close every due trade date and open the next one.
   *
   * The whole advance runs as one store transaction. Concurrent readers queue
   * behind it, so the day-boundary events are generated exactly once and the
   * `seq` values stay contiguous. Missed sessions produce snapshots only, never
   * fills.
   */
  private async advanceTo(): Promise<AccountState> {
    const outcome = await this.options.repo.transact(async state => {
      if (state.tradeDate === '' || state.blocked) return { events: [], value: undefined }
      const now = this.now()
      const nowIso = now.toISOString()
      const today = todayTradeDate(now)
      let current = state
      const events: LedgerEvent[] = []
      const apply = (result: EngineResult): void => {
        events.push(...result.events)
        current = result.state
      }
      for (let guard = 0; guard < 400; guard += 1) {
        if (current.tradeDate < today) {
          const next = await this.options.calendar.nextTradingDay(current.tradeDate)
          if (nowIso >= isoAtShanghai(current.tradeDate, 15 * 60)) {
            if (!this.hasClosed(current, current.tradeDate)) apply(await this.buildClose(current, current.tradeDate, next, nowIso))
          }
          if (nowIso >= isoAtShanghai(next, 9 * 60 + 15)) apply(this.buildPreOpen(current, next))
          if (nowIso < isoAtShanghai(next, 9 * 60 + 30)) break
          apply(await this.buildOpen(current, next, nowIso))
          continue
        }
        if (current.tradeDate === today) {
          if (await this.options.calendar.isTradingDay(today)) {
            if (nowIso >= isoAtShanghai(today, 9 * 60 + 30) && current.lastOpenedDate !== today) {
              apply(await this.buildOpen(current, today, nowIso))
            }
            if (nowIso >= isoAtShanghai(today, 15 * 60) && !this.hasClosed(current, today)) {
              const next = await this.options.calendar.nextTradingDay(today)
              apply(await this.buildClose(current, today, next, nowIso))
            }
          }
        }
        break
      }
      return { events, value: undefined }
    })
    return outcome.state
  }

  /**
   * Quote for a draft, with `prevClose` recovered from the daily bars.
   *
   * FTShare's single-symbol quote has no `prevClose`, so without this the price
   * limit is unknown and an order far outside the band would pass risk.
   */
  private async quoteFor(draft: OrderDraft): Promise<Quote | null> {
    const result = await this.fetchQuotes([draft.symbol])
    const live = result.quotes[0]
    // A zero last price is unusable under M2; treat it as "no quote" so a market
    // order is rejected or falls back to the manual reference, never left resting.
    if (live !== undefined && Number.isFinite(live.last) && live.last > 0) return this.withPrevClose(live)
    if (draft.price !== undefined && draft.price > 0) {
      const fetchedAt = this.ts()
      return this.withPrevClose({
        symbol: draft.symbol,
        last: roundPrice(draft.price),
        marketTs: fetchedAt,
        fetchedAt,
        source: 'manual',
      })
    }
    return null
  }

  private async withPrevClose(quote: Quote): Promise<Quote> {
    if (quote.prevClose !== undefined && Number.isFinite(quote.prevClose) && quote.prevClose > 0) return quote
    const prevClose = await this.prevCloseFor(quote.symbol)
    return prevClose === undefined ? quote : { ...quote, prevClose }
  }

  private async prevCloseFor(symbol: string): Promise<number | undefined> {
    try {
      const bars = await this.options.data.dailyBars(symbol, 8)
      if (bars.state !== 'ok' || bars.bars.length === 0) return undefined
      return prevCloseFromBars(bars.bars, todayTradeDate(this.now()))
    } catch {
      return undefined
    }
  }

  /**
   * Session clock that also respects the calendar. `sessionPhaseAt` only knows
   * wall time, so a weekend/holiday would otherwise look like continuous
   * trading and match orders against Friday's prices.
   */
  private phaseFor(state: AccountState, nowIso: string): SessionPhase {
    const today = todayTradeDate(this.now())
    return today === state.tradeDate ? sessionPhaseAt(nowIso) : 'closed'
  }

  private async orderDateFor(state: AccountState, nowIso: string, phase = sessionPhaseAt(nowIso)): Promise<string> {
    const today = todayTradeDate(this.now())
    if (state.tradeDate > today) return state.tradeDate
    if (state.tradeDate < today) return this.options.calendar.nextTradingDay(state.tradeDate)
    // After the close, a new order is pre-planted for the next trade date.
    if (phase === 'closed' && nowIso >= isoAtShanghai(today, 15 * 60)) {
      return this.options.calendar.nextTradingDay(state.tradeDate)
    }
    return state.tradeDate
  }

  async preview(input: OrderDraft): Promise<PreviewView> {
    const draft = { ...input, symbol: this.identifyStock(input.symbol).id }
    const state = await this.sync()
    const quote = await this.quoteFor(draft)
    // A limit order without a usable price is an unfinished draft, not a
    // 0.00 order; the ticket shows the field it is still missing instead.
    // (A market order without any quote keeps its warning, so the tool and the
    // panel can still explain what the user must fill in.)
    if (draft.type === 'limit' && estimatePrice(draft, quote) === null) {
      throw new PaperError('INVALID_ARGUMENT', '限价单必须给出正的限价', 400)
    }
    return previewOrder(state, draft, quote, state.settings, await this.marketStatusAt(state, this.ts()))
  }

  async place(input: OrderDraft, requestId: string = randomUUID()): Promise<OrderView> {
    const draft = { ...input, symbol: this.identifyStock(input.symbol).id }
    const state = await this.sync()
    // A locked account must answer with the lock (and its reason) even when the
    // order would also fail the session gate; the repair path comes first.
    if (state.blocked) throw this.blocked(state)
    const now = this.ts()
    const phase = this.phaseFor(state, now)
    const matchable = canMatch(phase)
    if (!canSubmit(phase, draft.type)) {
      throw new PaperError(
        phase === 'closed' ? 'SESSION_CLOSED' : 'AUCTION_ONLY',
        phase === 'auction_close'
          ? '收盘竞价暂不支持模拟撮合'
          : draft.type === 'market' ? '当前时段不接受市价单，请改限价预埋' : '当前时段不接受委托',
        409,
      )
    }
    const quote = await this.quoteFor(draft)
    const tradeDate = await this.orderDateFor(state, now, phase)
    const outcome = await this.options.repo.transact<PlaceOutcome>(current => {
      const duplicate = Object.values(current.orders).find(order => order.requestId === requestId)
      if (duplicate !== undefined) return { events: [], value: { duplicateId: duplicate.id } }
      if (current.blocked) return { events: [], value: { blocked: true } }
      const result = submit(current, { ...draft, name: quote?.name, tradeDate }, quote, requestId, now, {
        matchable,
        phase,
      })
      return { events: result.events, value: { orderId: result.order?.id } }
    })
    if (outcome.value.duplicateId !== undefined) {
      const duplicate = outcome.state.orders[outcome.value.duplicateId]
      if (duplicate === undefined) throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404)
      return toOrderView(duplicate)
    }
    if (outcome.value.blocked === true || outcome.state.blocked) {
      throw this.blocked(outcome.state)
    }
    const order = outcome.value.orderId === undefined ? undefined : outcome.state.orders[outcome.value.orderId]
    if (order === undefined) throw new PaperError('INTERNAL', '订单未写入账本')
    return toOrderView(order)
  }

  /**
   * Read-only basket preview: parse the CSV, fetch every quote in one call and
   * split the budget into lots. Parse problems ride back in `issues`; only a
   * structurally invalid explicit budget throws.
   */
  async basketPreview(csv: string, budgetCents?: number): Promise<BasketPreview> {
    if (budgetCents !== undefined && (!Number.isSafeInteger(budgetCents) || budgetCents <= 0)) {
      throw new PaperError('INVALID_ARGUMENT', '预算必须是正整数（分）', 400)
    }
    const state = await this.sync()
    const parsed = parseBasketCsv(csv)
    const quotes = await this.fetchQuotes(parsed.rows.map(row => row.symbol))
    const cashCents = state.cashCents
    // The entered number is a cap, never a claim on cash the account lacks.
    const budget = budgetCents === undefined ? Math.max(0, cashCents) : Math.min(budgetCents, Math.max(0, cashCents))
    const allocation = allocateBasket({
      rows: parsed.rows,
      quotes: quotes.quotes,
      budgetCents: budget,
      cashCents,
      settings: state.settings,
    })
    const session = await this.marketStatusAt(state, this.ts())
    const warnings = [...parsed.warnings, ...allocation.warnings]
    // The plan is still readable after the close; the hint is why the client
    // must keep the confirm button disabled.
    if (!session.canMatch) warnings.push('当前时段不能市价成交，只能预览')
    return {
      budgetCents: budget,
      cashCents,
      rows: allocation.rows,
      issues: parsed.issues,
      warnings,
      totalAmountCents: allocation.totalAmountCents,
      totalFeesCents: allocation.totalFeesCents,
      residualCents: allocation.residualCents,
      cashAfterCents: allocation.cashAfterCents,
      session,
    }
  }

  /**
   * Place a confirmed basket.
   *
   * Everything that can reject the whole batch is checked before the store
   * transaction, so a failed pre-check writes nothing. Inside the transaction
   * rows are submitted in input order with `${batchId}:${symbol}` as the
   * request id: a retried batch reuses its orders, and a row that still fails
   * (e.g. a concurrent change) is written as `order.rejected` while the rest of
   * the batch continues.
   */
  async basketPlace(rows: readonly BasketOrderInput[], batchId?: string): Promise<BasketOrderResult> {
    const inputs = this.basketRows(rows)
    const batch = batchId === undefined || batchId.trim() === '' ? randomUUID() : batchId.trim()
    const state = await this.sync()
    if (state.blocked) throw this.blocked(state)
    const now = this.ts()
    const phase = this.phaseFor(state, now)
    if (!canSubmit(phase, 'market')) {
      throw new PaperError(
        phase === 'closed' ? 'SESSION_CLOSED' : 'AUCTION_ONLY',
        '当前时段不接受市价单，请改限价预埋或连续竞价时段重试',
        409,
      )
    }
    const matchable = canMatch(phase)

    // Orders of an earlier attempt of the same batch are reused and skipped in
    // the pre-checks: re-running the cash checks would reject the retry for the
    // cash that first attempt already spent.
    const byRequestId = new Map<string, Order>()
    for (const order of Object.values(state.orders)) byRequestId.set(order.requestId, order)
    const requestIds = new Map<string, string>()
    const reused = new Map<string, Order>()
    const pending: BasketOrderInput[] = []
    for (const row of inputs) {
      const requestId = `${batch}:${row.symbol}`
      requestIds.set(row.symbol, requestId)
      const existing = byRequestId.get(requestId)
      if (existing === undefined) {
        pending.push(row)
        continue
      }
      if (existing.qty !== row.qty) {
        throw new PaperError('INVALID_ARGUMENT', `${row.symbol} 与同批次已提交的数量不一致（原 ${existing.qty} 股）`, 400)
      }
      reused.set(row.symbol, existing)
    }
    if (pending.length === 0) {
      return {
        batchId: batch,
        rows: inputs.map(row => this.basketResultRow(row.symbol, reused.get(row.symbol))),
        cashAfterCents: state.cashCents,
      }
    }

    // One quotes call for the whole batch, then prevClose backfill so the price
    // limit check is the same one a single order gets.
    const fetched = await this.fetchQuotes(pending.map(row => row.symbol))
    const live = new Map(fetched.quotes.map(quote => [quote.symbol, quote]))
    const quotes = new Map<string, Quote>()
    await Promise.all(pending.map(async row => {
      const quote = live.get(row.symbol)
      if (quote !== undefined) quotes.set(row.symbol, await this.withPrevClose(quote))
    }))
    const tradeDate = await this.orderDateFor(state, now, phase)

    let totalCostCents = 0
    for (const row of pending) {
      const quote = quotes.get(row.symbol) ?? null
      const check = checkOrder(
        state,
        { symbol: row.symbol, side: 'buy', type: 'market', qty: row.qty },
        quote,
        state.settings,
        tradeDate,
      )
      if (!check.ok) throw this.basketRejection(row.symbol, check.code, check.message)
      totalCostCents += check.amountCents + computeFees(check.amountCents, 'buy', state.settings).totalCents
    }
    if (totalCostCents > state.cashCents) {
      throw new PaperError(
        'INSUFFICIENT_CASH',
        `整批需要 ${(totalCostCents / 100).toFixed(2)} 元，可用现金 ${(state.cashCents / 100).toFixed(2)} 元`,
        409,
      )
    }

    const outcome = await this.options.repo.transact<BasketPlaceOutcome>(current => {
      if (current.blocked) return { events: [], value: { rows: [], blocked: true } }
      const events: LedgerEvent[] = []
      const results: BasketOrderRowResult[] = []
      let working = current
      for (const row of inputs) {
        const requestId = requestIds.get(row.symbol) ?? `${batch}:${row.symbol}`
        const duplicate = Object.values(working.orders).find(order => order.requestId === requestId)
        if (duplicate !== undefined) {
          if (duplicate.qty !== row.qty) {
            throw new PaperError('INVALID_ARGUMENT', `${row.symbol} 与同批次已提交的数量不一致（原 ${duplicate.qty} 股）`, 400)
          }
          results.push(this.basketResultRow(row.symbol, duplicate))
          continue
        }
        const quote = quotes.get(row.symbol)
        // Pending rows passed the quote pre-check; a gap here is a logic error,
        // so refuse instead of submitting half a batch.
        if (quote === undefined) throw new PaperError('QUOTE_UNAVAILABLE', `${row.symbol} 没有可用行情`, 409)
        const result = submit(
          working,
          { symbol: row.symbol, side: 'buy', type: 'market', qty: row.qty, name: quote.name, tradeDate },
          quote,
          requestId,
          now,
          { matchable, phase },
        )
        events.push(...result.events)
        working = result.state
        results.push(this.basketResultRow(row.symbol, result.order))
      }
      return { events, value: { rows: results } }
    })
    if (outcome.value.blocked === true || outcome.state.blocked) throw this.blocked(outcome.state)
    return { batchId: batch, rows: outcome.value.rows, cashAfterCents: outcome.state.cashCents }
  }

  /** Shape-level basket checks that must run before any pre-check touches IO. */
  private basketRows(rows: readonly BasketOrderInput[]): BasketOrderInput[] {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 20) {
      throw new PaperError('INVALID_ARGUMENT', 'rows 需要 1 到 20 行', 400)
    }
    const seen = new Set<string>()
    const checked: BasketOrderInput[] = []
    for (const row of rows) {
      const raw = typeof row.symbol === 'string' ? row.symbol.trim() : ''
      if (raw === '') throw new PaperError('INVALID_ARGUMENT', '证券代码不能为空', 400)
      const symbol = this.identifyStock(raw).id
      if (seen.has(symbol)) throw new PaperError('INVALID_ARGUMENT', `证券代码重复：${symbol}`, 400)
      seen.add(symbol)
      if (!Number.isInteger(row.qty) || row.qty <= 0) {
        throw new PaperError('INVALID_ARGUMENT', `${symbol} 数量必须是正整数`, 400)
      }
      if (row.qty % 100 !== 0) throw new PaperError('INVALID_ARGUMENT', `${symbol} 数量必须是 100 股的整数倍`, 400)
      checked.push({ symbol, qty: row.qty })
    }
    return checked
  }

  private basketResultRow(symbol: string, order: Order | undefined): BasketOrderRowResult {
    if (order === undefined) return { symbol, error: '订单未写入账本' }
    return {
      symbol,
      order: toOrderView(order),
      error: order.status === 'rejected' ? order.reason : undefined,
    }
  }

  /** A row failed pre-check: the batch is refused with that row's code. */
  private basketRejection(symbol: string, code: ErrorCode, message: string): PaperError {
    const status = code.startsWith('INVALID') ? 400 : 409
    return new PaperError(code, `${symbol}: ${message}`, status)
  }

  async cancel(orderId: string): Promise<OrderView> {
    const state = await this.sync()
    if (state.blocked) throw this.blocked(state)
    const outcome = await this.options.repo.transact<CancelOutcome>(current => {
      if (current.blocked) return { events: [], value: { blocked: true } }
      if (current.orders[orderId] === undefined) return { events: [], value: { missing: true } }
      const result = cancelOrder(current, orderId, this.ts())
      if (result.events.length === 0) return { events: [], value: { notPending: true } }
      return { events: result.events, value: {} }
    })
    if (outcome.value.blocked === true) throw this.blocked(outcome.state)
    if (outcome.value.missing === true) throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404)
    if (outcome.value.notPending === true) throw new PaperError('ORDER_NOT_PENDING', '订单不是挂单状态', 409)
    const order = outcome.state.orders[orderId]
    if (order === undefined) throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404)
    return toOrderView(order)
  }

  async tick(): Promise<TickView> {
    const state = await this.sync()
    const now = this.ts()
    const phase = this.phaseFor(state, now)
    // Outside continuous trading nothing can fill and the display does not need
    // a fresh tick either, so the upstream quote call is skipped altogether:
    // a host scheduler beating every 5 s would otherwise drain the anonymous
    // free-tier budget through the night and the weekend.
    if (!canMatch(phase)) {
      return { tradeDate: state.tradeDate, filled: [], expired: [], quotes: [], notices: [] }
    }
    const symbols = this.symbolsInPlay(state)
    const key = symbols.join(',')
    const nowMs = this.now().getTime()
    // The panel and the host scheduler beat on the same service instance; the
    // gate keeps them on one cadence and backs off once quotes are degraded.
    if (symbols.length > 0 && !this.quoteGate.allow(key, nowMs)) {
      const cached = this.tickQuotes?.key === key ? this.tickQuotes.quotes : []
      return { tradeDate: state.tradeDate, filled: [], expired: [], quotes: cached, notices: [] }
    }
    const quotes = await this.fetchQuotes(symbols)
    if (symbols.length > 0) {
      const live = quotes.state === 'ok' && quotes.quotes.length === symbols.length
        && quotes.quotes.every(quote => quote.source !== 'daily-bar' && quote.source !== 'manual')
      this.quoteGate.record(key, nowMs, live)
      this.tickQuotes = { key, quotes: quotes.quotes }
    }
    const outcome = await this.options.repo.transact(current => {
      if (current.blocked) {
        const reason = reasonText(current.blockedReason)
        return { events: [], value: { filled: [] as Order[], expired: [] as Order[], notices: [`账户已锁定，已跳过撮合${reason === '' ? '' : `（${reason}）`}`] } }
      }
      const released = releaseQueued(current, now, current.tradeDate)
      const ticked = engineTick(released.state, quotes.quotes, now)
      return {
        events: [...released.events, ...ticked.events],
        value: { filled: ticked.filled, expired: ticked.expired, notices: ticked.notices },
      }
    })
    const marked = await this.options.repo.markPrices(quotes.quotes)
    return {
      tradeDate: marked.tradeDate,
      filled: outcome.value.filled.map(order => toOrderView(marked.orders[order.id] ?? order)),
      expired: outcome.value.expired.map(order => toOrderView(marked.orders[order.id] ?? order)),
      quotes: quotes.quotes,
      notices: [...outcome.value.notices, ...(quotes.state === 'ok' ? [] : [this.friendlyNotice(quotes.state, quotes.notice, '行情暂不可用')])],
    }
  }

  async orders(): Promise<OrderView[]> {
    const state = await this.sync()
    return Object.values(state.orders)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toOrderView)
  }

  async trades(): Promise<FillView[]> {
    const state = await this.sync()
    return [...state.fills].reverse().map(toFillView)
  }

  async review(period: '7d' | '30d' | 'all' = '30d'): Promise<ReviewView> {
    const state = await this.sync()
    return toReview(state, period, todayTradeDate(this.now()))
  }

  async quote(symbols: string[]): Promise<QuoteResult> {
    const ids = symbols.map(symbol => this.identify(symbol).id)
    return this.sanitiseDataNotice(await this.fetchQuotes(ids), '行情暂不可用') as QuoteResult
  }

  async dailyBars(symbol: string, limit = 60): Promise<BarsResult> {
    const id = this.identify(symbol).id
    try {
      const result = await this.options.data.dailyBars(id, Math.min(Math.max(1, limit), 250))
      return this.sanitiseDataNotice(result, 'K 线数据暂不可用') as BarsResult
    } catch (error) {
      this.options.logger?.warn(`paper-trading: bars failed: ${String(error)}`)
      return { state: 'failed', bars: [], notice: 'K 线数据暂不可用' }
    }
  }

  async minuteBars(symbol: string, date?: string): Promise<BarsResult> {
    const id = this.identify(symbol).id
    try {
      const result = await this.options.data.minuteBars(id, date ?? todayTradeDate(this.now()))
      return this.sanitiseDataNotice(result, 'K 线数据暂不可用') as BarsResult
    } catch (error) {
      this.options.logger?.warn(`paper-trading: minute bars failed: ${String(error)}`)
      return { state: 'failed', bars: [], notice: 'K 线数据暂不可用' }
    }
  }

  /**
   * Upstream adapters include FTShare function names and parameter errors in
   * their notices. Those are useful in logs, not in the panel (or to the model
   * reading a tool result), so the user-facing notice stays short.
   */
  private sanitiseDataNotice<T extends { state: string; notice?: string }>(result: T, fallback: string): T {
    if (result.state === 'ok') return result
    return { ...result, notice: this.friendlyNotice(result.state, result.notice, fallback) }
  }

  private friendlyNotice(state: string, notice: string | undefined, fallback: string): string {
    if (state === 'denied') {
      // Two different causes share this state: a missing/invalid key and a plan
      // that does not include the interface. The panel must not blur them.
      return notice !== undefined && /api\s*key|凭据|未配置|无效|未授权|401/i.test(notice)
        ? '行情需要 FTShare API Key（设置 → 非凸金融终端）'
        : '当前 FTShare 套餐未开通该行情接口'
    }
    if (notice !== undefined && /额度|配额|quota|500\s*次|rate.?limit|429/i.test(notice)) {
      return 'FTShare 免费额度已用尽（匿名 500 次/天），配置 API Key 或稍后重试'
    }
    if (notice === undefined || notice === '') return fallback
    // Keep short operational notices (e.g. "行情服务未就绪") but hide adapter
    // internals such as FTShare function names and parameter validation.
    return /FTShare|UPSTREAM|invalid symbol|symbols\[|调用失败|参数格式|request/i.test(notice) ? fallback : notice
  }

  async search(query: string, limit = 10): Promise<Awaited<ReturnType<MarketDataPort['search']>>> {
    return this.options.data.search(query, Math.min(Math.max(1, limit), 50))
  }

  async marketList(input: { board?: string; page?: number; pageSize?: number } = {}) {
    const result = await this.options.data.marketList(input)
    return this.sanitiseDataNotice(result, '行情暂不可用')
  }

  async shortlist(): Promise<string[]> {
    const stored = await this.options.shortlist?.read() ?? []
    // Stored preferences predate the canonical id: keep the entries that still
    // resolve, drop the rest, and never echo a bare code back to the panel.
    const ids: string[] = []
    for (const symbol of stored) {
      const parsed = tryParseSymbol(symbol)
      if (parsed.ok && !ids.includes(parsed.symbol.id)) ids.push(parsed.symbol.id)
    }
    return ids
  }

  async setShortlist(symbols: string[]): Promise<string[]> {
    if (this.options.shortlist === undefined) throw new PaperError('INVALID_ARGUMENT', '备选存储不可用', 503)
    const ids: string[] = []
    for (const symbol of symbols) {
      const id = this.identify(symbol).id
      if (!ids.includes(id)) ids.push(id)
    }
    return this.options.shortlist.write(ids)
  }

  async settingsView(): Promise<PaperSettings> {
    const state = await this.sync()
    return state.settings
  }

  private async marketStatusAt(state: AccountState, nowIso: string): Promise<MarketStatus> {
    const phase = this.phaseFor(state, nowIso)
    return {
      phase,
      tradeDate: state.tradeDate,
      canSubmit: canSubmit(phase, 'limit'),
      canMatch: canMatch(phase),
      nextBoundary: await this.nextBoundaryFor(nowIso, phase),
      calendar: this.options.calendar.status,
    }
  }

  /**
   * The next wall-clock session start. Closed covers both "before the open"
   * (today 09:15 is still ahead) and "after the close" (next trading day);
   * weekends and holidays are skipped through the calendar port.
   */
  private async nextBoundaryFor(nowIso: string, phase: SessionPhase): Promise<string> {
    const today = todayTradeDate(this.now())
    const at = (date: string, minutes: number) => isoAtShanghai(date, minutes)
    switch (phase) {
      case 'pre_open': return at(today, 9 * 60 + 30)
      case 'continuous_am': return at(today, 11 * 60 + 30)
      case 'lunch': return at(today, 13 * 60)
      case 'continuous_pm': return at(today, 14 * 60 + 57)
      case 'auction_close': return at(today, 15 * 60)
      default: {
        const open = 9 * 60 + 15
        const beforeOpen = shanghaiClock(nowIso).minutes < open
        const tradingToday = await this.options.calendar.isTradingDay(today)
        const date = beforeOpen && tradingToday ? today : await this.options.calendar.nextTradingDay(today)
        return at(date, open)
      }
    }
  }

  async marketStatus(): Promise<MarketStatus> {
    const state = await this.sync()
    return await this.marketStatusAt(state, this.ts())
  }

  async cashFlow(): Promise<CashFlowEntry[]> {
    const state = await this.sync()
    const moves: { ts: string; type: CashFlowEntry['type']; amountCents: number; ref?: string }[] = []
    for (const flow of state.cashFlows) {
      moves.push({
        ts: flow.ts,
        type: flow.type,
        amountCents: flow.type === 'deposit' ? flow.amountCents : -flow.amountCents,
      })
    }
    for (const fill of state.fills) {
      const gross = fill.side === 'buy' ? -(fill.amountCents + fill.fees.totalCents) : fill.amountCents - fill.fees.totalCents
      moves.push({ ts: fill.ts, type: fill.side === 'buy' ? 'buy' : 'sell', amountCents: gross, ref: fill.orderId })
    }
    // Fills and cash moves share the ledger clock; sort so the running balance
    // matches the order the events were actually applied.
    moves.sort((a, b) => a.ts.localeCompare(b.ts))
    let balance = state.initialCashCents
    const rows: CashFlowEntry[] = [
      { ts: state.createdAt, type: 'open', amount: state.initialCashCents / 100, balance: state.initialCashCents / 100 },
    ]
    for (const move of moves) {
      balance += move.amountCents
      rows.push({ ts: move.ts, type: move.type, amount: move.amountCents / 100, balance: balance / 100, ref: move.ref })
    }
    return rows
  }

  async dailyReport(date?: string): Promise<DayReport[]> {
    const state = await this.sync()
    const points = date === undefined ? state.dayEquity : state.dayEquity.filter(point => point.date === date)
    // A deposit or withdrawal is not a day's profit: subtract the net cash move
    // booked on that trade date from the equity change.
    const flowByDate = new Map<string, number>()
    for (const flow of state.cashFlows) {
      const signed = flow.type === 'deposit' ? flow.amountCents : -flow.amountCents
      flowByDate.set(flow.tradeDate, (flowByDate.get(flow.tradeDate) ?? 0) + signed)
    }
    let previous = state.initialCashCents
    const reports: DayReport[] = []
    for (const point of state.dayEquity) {
      if (!points.includes(point)) {
        previous = point.equityCents
        continue
      }
      reports.push({
        date: point.date,
        equity: point.equityCents / 100,
        cash: point.cashCents / 100,
        dayPnl: (point.equityCents - previous - (flowByDate.get(point.date) ?? 0)) / 100,
        fees: (point.feesCents ?? 0) / 100,
        available: point.positions?.reduce((sum, position) => sum + position.available, 0) ?? 0,
        positions: (point.positions ?? []).map(position => ({
          symbol: position.symbol,
          name: position.name,
          qty: position.qty,
          available: position.available,
          avgCost: position.qty > 0 ? position.costCents / position.qty / 100 : 0,
          lastPrice: position.lastPrice,
        })),
        gaps: point.gaps ?? {},
        closeSource: point.closeSource ?? 'missing',
      })
      previous = point.equityCents
    }
    return reports
  }

  async roundtrips(): Promise<RoundTrip[]> {
    const state = await this.sync()
    const lots = new Map<string, { qty: number; cost: number; openedAt?: string }>()
    const trips = new Map<string, RoundTrip>()
    for (const fill of state.fills) {
      const lot = lots.get(fill.symbol) ?? { qty: 0, cost: 0 }
      if (fill.side === 'buy') {
        lot.qty += fill.qty
        lot.cost += fill.amountCents + fill.fees.totalCents
        lot.openedAt ??= fill.ts
        lots.set(fill.symbol, lot)
        continue
      }
      const avg = lot.qty > 0 ? lot.cost / lot.qty : 0
      const cost = Math.round(avg * fill.qty)
      lot.qty -= fill.qty
      lot.cost -= cost
      lots.set(fill.symbol, lot)
      const trip = trips.get(fill.symbol) ?? {
        symbol: fill.symbol,
        name: fill.name,
        qty: 0,
        cost: 0,
        proceeds: 0,
        pnl: 0,
        holdingDays: 0,
      }
      trip.qty += fill.qty
      trip.cost += cost
      trip.proceeds += fill.amountCents - fill.fees.totalCents
      trip.pnl += fill.amountCents - fill.fees.totalCents - cost
      if (lot.openedAt !== undefined) {
        trip.holdingDays = Math.max(trip.holdingDays, Math.round((Date.parse(fill.ts) - Date.parse(lot.openedAt)) / 86_400_000))
      }
      trips.set(fill.symbol, trip)
    }
    return [...trips.values()].map(trip => ({
      ...trip,
      cost: trip.cost / 100,
      proceeds: trip.proceeds / 100,
      pnl: trip.pnl / 100,
    }))
  }

  /**
   * Wipe the account by replacing the ledger with one genesis event.
   *
   * The old file is copied aside first, *before* replay is trusted: a ledger
   * that currently blocks the account (duplicate seq, NaN fill) must still be
   * resettable/exportable. Settings come from the persisted account merged over
   * the current defaults, so a legacy account does not inherit its missing
   * fields. The write is an atomic temp-file rename.
   */
  async reset(confirm: boolean): Promise<AccountView> {
    if (confirm !== true) throw new PaperError('INVALID_ARGUMENT', '重置需要 confirm=true', 400)
    const ts = this.ts()
    await this.options.repo.backup(ts)
    const previous = await this.options.repo.current().catch(error => {
      this.options.logger?.warn(`paper-trading: reset could not replay the old ledger: ${String(error)}`)
      return undefined
    })
    const settings = normalizeSettings(previous !== undefined && previous.tradeDate !== '' ? previous.settings : this.settings)
    const tradeDate = previous !== undefined && previous.tradeDate !== '' ? previous.tradeDate : await this.tradeDateForNow()
    const genesis: LedgerEvent = {
      seq: 1,
      id: 'evt-1',
      ts,
      type: 'account.reset',
      payload: { settings, initialCashCents: settings.initialCashCents, tradeDate, reason: 'user' },
    }
    const next = await this.options.repo.replace([genesis])
    return this.viewOf(next)
  }

  /** Add cash to the account; the amount is yuan from the UI, stored as cents. */
  async deposit(amount: number): Promise<AccountView> {
    return this.moveCash('deposit', amount)
  }

  /** Take cash out, never more than the free cash at the moment of the write. */
  async withdraw(amount: number): Promise<AccountView> {
    return this.moveCash('withdraw', amount)
  }

  private async moveCash(kind: 'deposit' | 'withdraw', amount: number): Promise<AccountView> {
    const amountCents = this.cashAmountCents(amount)
    const state = await this.sync()
    if (state.blocked) throw this.blocked(state)
    const outcome = await this.options.repo.transact<{ blocked: boolean; insufficient: boolean }>(current => {
      if (current.blocked) return { events: [], value: { blocked: true, insufficient: false } }
      // Re-checked inside the transaction: a concurrent buy may have spent the
      // cash between `sync()` and this write.
      if (kind === 'withdraw' && amountCents > current.cashCents) {
        return { events: [], value: { blocked: false, insufficient: true } }
      }
      const result = kind === 'deposit' ? depositCash(current, amountCents, this.ts()) : withdrawCash(current, amountCents, this.ts())
      return { events: result.events, value: { blocked: false, insufficient: false } }
    })
    if (outcome.value.blocked === true) throw this.blocked(outcome.state)
    if (outcome.value.insufficient === true) throw new PaperError('INSUFFICIENT_CASH', '可提现金不足', 409)
    return this.viewOf(outcome.state)
  }

  /** `amount` is yuan from the UI; the ledger stores integer cents. */
  private cashAmountCents(amount: number): number {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new PaperError('INVALID_ARGUMENT', '金额必须是正数', 400)
    }
    const cents = Math.round(amount * 100)
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      throw new PaperError('INVALID_ARGUMENT', '金额至少 0.01 元', 400)
    }
    return cents
  }

  /** Read-only export of the raw ledger, for a locked account's banner. */
  async exportLedger(): Promise<LedgerExport> {
    const ledger = await this.options.repo.readLedger()
    if (ledger.content === null) return { path: ledger.path, exists: false, notice: '账本文件尚未创建' }
    return { path: ledger.path, exists: true, content: ledger.content }
  }

  /**
   * Where the ledger is and why it is locked — without the raw text.
   *
   * `exportLedger` exists for downloading; this is the answer a human or an
   * agent needs to locate the file and name the failing invariant.
   */
  async ledgerStatus(): Promise<LedgerStatus> {
    const ledger = await this.options.repo.readLedger()
    const state = await this.options.repo.current().catch(error => {
      this.options.logger?.warn(`paper-trading: ledger status could not replay: ${String(error)}`)
      return undefined
    })
    return {
      path: ledger.path,
      exists: ledger.content !== null,
      blocked: state?.blocked === true,
      blockedReason: state?.blockedReason,
    }
  }

  /** Exposed for tests/scenarios: current equity in cents after advancing the clock. */
  async equityCents(): Promise<number> {
    const state = await this.sync()
    return equityCents(state)
  }
}
