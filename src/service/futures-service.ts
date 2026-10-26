/**
 * Futures account service.
 *
 * Owns the clock advance (day open / settlement / trade-date roll), the data
 * port plumbing and the ledger transactions. Core stays pure; the service is
 * the only place that knows about FTShare, the trading calendar and the wall
 * clock, exactly like the stock-side `PaperService`.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/service/futures-service
 */

import { randomUUID } from 'node:crypto'
import type {
  FuturesContractQuery,
  FuturesContractView,
  FuturesContractsResult,
  FuturesCashFlowEntry,
  FuturesDraft,
  FuturesFillView,
  FuturesLedgerExport,
  FuturesMarketStatus,
  FuturesOrderView,
  FuturesPeriod,
  FuturesPositionView,
  FuturesPreviewView,
  FuturesQuotesResult,
  FuturesReviewView,
  FuturesSettings,
  FuturesTickView,
} from '../futures-contract.js'
import { DEFAULT_FUTURES_SETTINGS, FUTURES_ACCOUNT_ID } from '../futures-contract.js'
import type {
  FuturesContractMeta,
  FuturesDataResult,
  FuturesMarketDataPort,
} from '../data/futures-market-data-port.js'
import type { TradingCalendarPort } from '../data/trading-calendar-port.js'
import { todayTradeDate } from '../core/calendar.js'
import { emptyState, normalizeFuturesSettings } from '../core/futures/ledger.js'
import { cancelOrder, closeDay, depositCash, openAccount, openDay, resetAccount, submit, tick as engineTick, withdrawCash } from '../core/futures/engine.js'
import {
  daySessionsFor,
  isoAt,
  OPEN_MINUTES,
  parseDaySessions,
  phaseAt,
  SETTLEMENT_MINUTES,
  type DaySessions,
} from '../core/futures/session.js'
import {
  cashFlowViews,
  fillViews,
  marketStatusAt,
  orderViews,
  positionViews,
  previewOrder,
  quoteView,
  toAccountView,
  toOrderView,
  toReview,
} from '../core/futures/views.js'
import { QuoteRefreshGate } from './quote-gate.js'
import { classifyDataProblem, friendlyDataNotice } from './data-source.js'
import type { DataProblem } from '../contract.js'
import type {
  ContractTerms,
  FuturesAccountState,
  FuturesLedgerEvent,
  FuturesOrder,
  LimitInput,
  QuoteInput,
  SettleInput,
} from '../core/futures/types.js'
import type { FuturesStore } from '../store/futures-repo.js'

/** Data calls are chunked to the adapter's documented 20-symbol batch cap. */
const SYMBOL_BATCH = 20
const MAX_CONTRACTS = 500

/** Table/CTP suffix aliases agents may send; the host stores market suffixes. */
const SYMBOL_SUFFIX: Record<string, string> = {
  SHFE: 'SHFE', SHF: 'SHFE', INE: 'INE', DCE: 'DCE',
  CZCE: 'CZCE', CZC: 'CZCE', ZCE: 'CZCE',
  CFFEX: 'CFFEX', CFE: 'CFFEX', CFX: 'CFFEX',
  GFEX: 'GFEX', GFE: 'GFEX',
}

/** Accept any published suffix (and lower case); store the market-data form. */
export function normalizeFuturesSymbol(raw: string): string {
  const text = String(raw ?? '').trim().toUpperCase()
  const dot = text.lastIndexOf('.')
  if (dot <= 0 || dot === text.length - 1) return text
  const suffix = SYMBOL_SUFFIX[text.slice(dot + 1)]
  return suffix === undefined ? text : `${text.slice(0, dot)}.${suffix}`
}

export type FuturesServiceErrorCode =
  | 'INSUFFICIENT_MARGIN'
  | 'INSUFFICIENT_CASH'
  | 'INSUFFICIENT_POSITION'
  | 'CONTRACT_NOT_FOUND'
  | 'CONTRACT_EXPIRED'
  | 'NO_VOLUME'
  | 'LIMIT_UNAVAILABLE'
  | 'MARGIN_UNAVAILABLE'
  | 'ACCOUNT_BLOCKED'
  | 'INVALID_ARGUMENT'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_PENDING'
  | 'SESSION_CLOSED'
  | 'INTERNAL'

export class FuturesError extends Error {
  constructor(
    readonly code: FuturesServiceErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'FuturesError'
  }
}

export interface FuturesServiceOptions {
  repo: FuturesStore
  data: FuturesMarketDataPort
  calendar: TradingCalendarPort
  settings?: FuturesSettings
  accountId?: string
  now?: () => Date
  logger?: { warn(message: string): void }
}

interface ContractCache {
  tradeDate: string
  map: Map<string, ContractTerms>
  state: 'ok' | 'stale'
  notice?: string
}

interface AdvanceOutcome {
  state: FuturesAccountState
  notices: string[]
  expired: FuturesOrder[]
}

interface PlaceOutcome {
  orderId?: string
  duplicateId?: string
  blocked?: boolean
}

type CancelOutcome = { missing?: boolean; notPending?: boolean; blocked?: boolean }

interface SettleParams extends SettleInput {
  /** Ad-valorem fee, used only when the per-lot fee is missing or zero. */
  feeRate?: number
  /** Close-today ad-valorem fee in the same unit as `feeRate`. */
  closeTodayFeeRate?: number
}

interface SymbolData {
  contract?: ContractTerms
  quote?: QuoteInput
  limit?: LimitInput
  settle?: SettleInput
  sessions: DaySessions
  tradeDaysToDeList?: number
  warnings: string[]
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

function reasonText(reason: string | undefined, limit = 120): string {
  if (reason === undefined || reason === '') return ''
  const flat = reason.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`
}

function toTerms(meta: FuturesContractMeta): ContractTerms {
  return {
    symbol: meta.symbol,
    name: meta.name,
    product: meta.product,
    exchange: meta.exchange,
    multiplier: meta.multiplier,
    tickSize: meta.tickSize,
    marginRate: meta.marginRate,
    tradeHours: meta.tradeHours,
    deListDate: meta.deListDate,
    volume: meta.volume,
  }
}

function toContractView(terms: ContractTerms): FuturesContractView {
  return {
    symbol: terms.symbol,
    name: terms.name,
    product: terms.product,
    exchange: terms.exchange,
    multiplier: terms.multiplier,
    tickSize: terms.tickSize,
    marginRate: terms.marginRate,
    tradeHours: terms.tradeHours,
    deListDate: terms.deListDate,
  }
}

/** Orchestrates the futures ledger, the market-data port, the calendar and the clock. */
export class FuturesService {
  private readonly settings: FuturesSettings
  private readonly accountId: string
  private readonly now: () => Date
  private contractsCache: ContractCache | undefined
  private readonly quoteGate = new QuoteRefreshGate()
  private dataProblem: DataProblem | undefined

  constructor(private readonly options: FuturesServiceOptions) {
    this.settings = normalizeFuturesSettings(options.settings ?? DEFAULT_FUTURES_SETTINGS)
    this.accountId = options.accountId ?? FUTURES_ACCOUNT_ID
    this.now = options.now ?? (() => new Date())
  }

  private ts(): string {
    return this.now().toISOString()
  }

  private viewOf(state: FuturesAccountState): ReturnType<typeof toAccountView> {
    return toAccountView(state, this.options.repo.ledgerPath)
  }

  private blocked(state: FuturesAccountState): FuturesError {
    const reason = reasonText(state.blockedReason)
    return new FuturesError('ACCOUNT_BLOCKED', `账户已锁定，请重置后继续${reason === '' ? '' : `（${reason}）`}`, 409)
  }

  // ---------------------------------------------------------------- account --

  async account(): Promise<ReturnType<typeof toAccountView>> {
    return this.viewOf(await this.sync())
  }

  private async ensureAccount(): Promise<FuturesAccountState> {
    const outcome = await this.options.repo.transact(async state => {
      if (state.tradeDate !== '') return { events: [], value: undefined }
      const now = this.now()
      const tradeDate = await this.tradeDateForNow(now)
      const result = openAccount(state, this.settings, tradeDate, now.toISOString(), this.accountId)
      return { events: result.events, value: undefined }
    })
    return outcome.state
  }

  private async sync(): Promise<FuturesAccountState> {
    await this.ensureAccount()
    return (await this.advanceTo()).state
  }

  /** Trade date a fresh account starts on; after 15:30 it is already the next day. */
  private async tradeDateForNow(now: Date): Promise<string> {
    const today = todayTradeDate(now)
    const nowIso = now.toISOString()
    if (await this.options.calendar.isTradingDay(today)) {
      return nowIso >= isoAt(today, SETTLEMENT_MINUTES) ? this.options.calendar.nextTradingDay(today) : today
    }
    return this.options.calendar.nextTradingDay(today)
  }

  /**
   * Idempotent clock advance: settle every due trade date at 15:30 and open the
   * current one at 09:00. Runs inside one store transaction so concurrent reads
   * cannot duplicate a settlement event.
   */
  private async advanceTo(): Promise<AdvanceOutcome> {
    const outcome = await this.options.repo.transact(async state => {
      const events: FuturesLedgerEvent[] = []
      const notices: string[] = []
      const expired: FuturesOrder[] = []
      if (state.tradeDate === '' || state.blocked) {
        return { events, value: { notices, expired } }
      }
      const now = this.now()
      const nowIso = now.toISOString()
      const today = todayTradeDate(now)
      let current = state
      const apply = (result: {
        events: FuturesLedgerEvent[]
        state: FuturesAccountState
        notices?: string[]
        expired?: FuturesOrder[]
      }): void => {
        events.push(...result.events)
        current = result.state
        if (result.notices !== undefined) notices.push(...result.notices)
        if (result.expired !== undefined) expired.push(...result.expired)
      }
      for (let guard = 0; guard < 400; guard += 1) {
        const settlementAt = isoAt(current.tradeDate, SETTLEMENT_MINUTES)
        if (current.tradeDate < today || (current.tradeDate === today && nowIso >= settlementAt)) {
          const closes = await this.fetchCloses(current)
          const next = await this.options.calendar.nextTradingDay(current.tradeDate)
          apply(closeDay(current, {
            date: current.tradeDate,
            nextTradeDate: next,
            ts: settlementAt,
            recordedAt: nowIso,
            closes: closes.prices,
            closeSource: closes.source,
            warnings: closes.notice === undefined ? [] : [closes.notice],
          }))
          continue
        }
        if (current.tradeDate === today) {
          if (nowIso >= isoAt(today, OPEN_MINUTES) && current.lastOpenedDate !== today) {
            const opens = await this.fetchOpens(current)
            apply(openDay(current, {
              date: today,
              ts: isoAt(today, OPEN_MINUTES),
              recordedAt: nowIso,
              opens: opens.prices,
            }))
            if (opens.notice !== undefined) notices.push(opens.notice)
          }
          break
        }
        break
      }
      return { events, value: { notices, expired } }
    })
    return { state: outcome.state, notices: outcome.value.notices, expired: outcome.value.expired }
  }

  /** Symbols whose price the account cares about: open orders and held positions. */
  private symbolsInPlay(state: FuturesAccountState): string[] {
    const symbols = new Set<string>()
    for (const position of Object.values(state.positions)) symbols.add(position.symbol)
    for (const order of Object.values(state.orders)) {
      if (order.status === 'pending') symbols.add(order.symbol)
    }
    return [...symbols]
  }

  // ------------------------------------------------------------------- data --

  private async callBatched<T>(
    symbols: readonly string[],
    call: (batch: string[]) => Promise<FuturesDataResult<T[]>>,
  ): Promise<FuturesDataResult<T[]>> {
    const unique = [...new Set(symbols)]
    if (unique.length === 0) return { state: 'ok', value: [] }
    const values: T[] = []
    for (const batch of chunks(unique, SYMBOL_BATCH)) {
      try {
        const result = await call(batch)
        if (result.state !== 'ok') {
          return {
            state: result.state,
            notice: result.notice,
            ...(result.noticeCode === undefined ? {} : { noticeCode: result.noticeCode }),
          }
        }
        values.push(...(result.value ?? []))
      } catch (error) {
        this.options.logger?.warn(`paper-trading: futures market data failed: ${String(error)}`)
        return { state: 'failed', notice: error instanceof Error ? error.message : String(error) }
      }
    }
    return { state: 'ok', value: values }
  }

  /** Latest observed market-data failure; drives the panel banner. */
  problem(): DataProblem | undefined {
    return this.dataProblem
  }

  private noteDataProblem(result: { state: string; notice?: string; noticeCode?: string }): void {
    const problem = classifyDataProblem(result, this.ts())
    if (problem !== undefined) this.dataProblem = problem
    else if (result.state === 'ok') this.dataProblem = undefined
  }

  private async fetchQuoteMap(symbols: readonly string[]): Promise<{
    state: FuturesDataResult<QuoteInput[]>['state']
    quotes: Map<string, QuoteInput>
    notice?: string
    noticeCode?: string
  }> {
    const result = await this.callBatched(symbols, batch => this.options.data.quotes(batch))
    this.noteDataProblem(result)
    const quotes = new Map<string, QuoteInput>()
    for (const row of result.value ?? []) {
      if (row.symbol === undefined || !Number.isFinite(row.last) || row.last <= 0) continue
      quotes.set(row.symbol, {
        last: row.last,
        preSettlement: row.preSettlement,
        volume: row.volume,
        openInterest: row.openInterest,
        marketTs: row.marketTs,
      })
    }
    return { state: result.state, quotes, notice: result.notice, ...(result.noticeCode === undefined ? {} : { noticeCode: result.noticeCode }) }
  }

  private async fetchLimitMap(symbols: readonly string[]): Promise<{ state: string; limits: Map<string, LimitInput>; notice?: string; noticeCode?: string }> {
    const result = await this.callBatched(symbols, batch => this.options.data.limits(batch))
    const limits = new Map<string, LimitInput>()
    for (const row of result.value ?? []) {
      if (row.symbol === undefined || !Number.isFinite(row.upper) || !Number.isFinite(row.lower)) continue
      limits.set(row.symbol, { upper: row.upper, lower: row.lower, marginRate: row.marginRate, source: row.source })
    }
    return { state: result.state, limits, notice: result.notice, ...(result.noticeCode === undefined ? {} : { noticeCode: result.noticeCode }) }
  }

  private async fetchSettleMap(symbols: readonly string[]): Promise<{ state: string; settles: Map<string, SettleParams>; notice?: string; noticeCode?: string }> {
    const result = await this.callBatched(symbols, batch => this.options.data.settle(batch))
    const settles = new Map<string, SettleParams>()
    for (const row of result.value ?? []) {
      if (row.symbol === undefined) continue
      settles.set(row.symbol, {
        feePerLotCents: row.feePerLotCents,
        closeTodayFeePerLotCents: row.closeTodayFeePerLotCents,
        longMarginRate: row.longMarginRate,
        feeRate: row.feeRate,
        closeTodayFeeRate: row.closeTodayFeeRate,
      })
    }
    return { state: result.state, settles, notice: result.notice, ...(result.noticeCode === undefined ? {} : { noticeCode: result.noticeCode }) }
  }

  private async fetchCloses(state: FuturesAccountState): Promise<{ prices: Record<string, number>; source: 'daily' | 'quote' | 'missing'; notice?: string }> {
    const symbols = this.symbolsInPlay(state)
    if (symbols.length === 0) return { prices: {}, source: 'daily' }
    const result = await this.callBatched(symbols, batch => this.options.data.closes(batch, state.tradeDate))
    if (result.state !== 'ok') {
      const notice = friendlyDataNotice(result, '收盘价不可用，结算使用最近一次盯市价', this.ts())
      const quoteResult = await this.fetchQuoteMap(symbols)
      if (quoteResult.state === 'ok' && quoteResult.quotes.size > 0) {
        const prices = Object.fromEntries([...quoteResult.quotes].map(([symbol, quote]) => [symbol, quote.last]))
        return { prices, source: 'quote', notice }
      }
      return { prices: {}, source: 'missing', notice }
    }
    const prices: Record<string, number> = {}
    for (const row of result.value ?? []) {
      if (row.symbol === undefined || !Number.isFinite(row.close) || row.close <= 0) continue
      prices[row.symbol] = row.close
    }
    const missing = symbols.filter(symbol => prices[symbol] === undefined)
    if (missing.length === 0) return { prices, source: 'daily' }
    const quoteResult = await this.fetchQuoteMap(missing)
    if (quoteResult.state !== 'ok') {
      return { prices, source: 'missing', notice: friendlyDataNotice(quoteResult, '部分收盘价缺失，使用最近一次盯市价', this.ts()) }
    }
    for (const [symbol, quote] of quoteResult.quotes) prices[symbol] = quote.last
    return { prices, source: 'quote', notice: result.notice ?? '部分收盘价缺失，已用最新价替代' }
  }

  private async fetchOpens(state: FuturesAccountState): Promise<{ prices: Record<string, number>; notice?: string }> {
    const symbols = this.symbolsInPlay(state)
    if (symbols.length === 0) return { prices: {} }
    const quoteResult = await this.fetchQuoteMap(symbols)
    if (quoteResult.state !== 'ok') {
      return { prices: {}, notice: friendlyDataNotice(quoteResult, '开盘价不可用，沿用上一收盘价', this.ts()) }
    }
    return { prices: Object.fromEntries([...quoteResult.quotes].map(([symbol, quote]) => [symbol, quote.last])) }
  }

  private async ensureContracts(tradeDate: string, refresh = false): Promise<ContractCache> {
    const cached = this.contractsCache
    if (cached !== undefined && cached.tradeDate === tradeDate && !refresh) return cached
    let result: FuturesDataResult<FuturesContractMeta[]>
    try {
      result = await this.options.data.contracts(refresh)
    } catch (error) {
      this.options.logger?.warn(`paper-trading: futures contract index failed: ${String(error)}`)
      result = { state: 'failed', notice: error instanceof Error ? error.message : String(error) }
    }
    if (result.state === 'ok' && result.value !== undefined) {
      const map = new Map<string, ContractTerms>()
      for (const meta of result.value) {
        if (meta.symbol === undefined || !(meta.multiplier > 0) || !(meta.tickSize > 0)) continue
        map.set(meta.symbol, toTerms(meta))
      }
      this.contractsCache = { tradeDate, map, state: 'ok' }
      return this.contractsCache
    }
    if (cached !== undefined && cached.tradeDate === tradeDate) {
      // The adapter composes this cause with the raw upstream text, which carries
      // interface names and codes; keep the cache date, run the cause through the
      // shared filter so the tool summary stays readable.
      return { ...cached, state: 'stale', notice: `合约索引刷新失败，沿用 ${cached.tradeDate} 缓存（${friendlyDataNotice(result, '上游暂不可用', this.ts())}）` }
    }
    return { tradeDate, map: new Map(), state: 'stale', notice: `合约索引不可用：${friendlyDataNotice(result, '上游暂不可用', this.ts())}` }
  }

  private async symbolData(state: FuturesAccountState, symbol: string, nowIso: string): Promise<SymbolData> {
    const contracts = await this.ensureContracts(state.tradeDate)
    const contract = contracts.map.get(symbol)
    const sessions = daySessionsFor(contract)
    const warnings: string[] = []
    if (contracts.state === 'stale' && contracts.notice !== undefined) warnings.push(contracts.notice)
    const fetchSymbols = symbol === '' ? [] : [symbol]
    const [quoteResult, limitResult, settleResult] = await Promise.all([
      this.fetchQuoteMap(fetchSymbols),
      this.fetchLimitMap(fetchSymbols),
      this.fetchSettleMap(fetchSymbols),
    ])
    const sources = [
      { result: quoteResult, fallback: '行情暂不可用' },
      { result: limitResult, fallback: '涨跌停数据暂不可用' },
      { result: settleResult, fallback: '结算参数暂不可用' },
    ]
    for (const { result, fallback } of sources) {
      if (result.state !== 'ok') warnings.push(friendlyDataNotice(result, fallback, nowIso))
    }
    const tradeDaysToDeList = await this.tradeDaysToDeList(state.tradeDate, contract)
    const quote = quoteResult.quotes.get(symbol)
    let settle: SettleInput | undefined = settleResult.settles.get(symbol)
    // Some exchanges (e.g. RB on SHFE) publish `trading_fee = 0` plus an
    // ad-valorem `trading_fee_rate`. The per-lot fee is a snapshot, so convert
    // the rate with the current price; callers see a normal per-lot fee.
    const params = settleResult.settles.get(symbol)
    const toPerLot = (rate: number | undefined): number | undefined => {
      if (quote === undefined || contract === undefined) return undefined
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return undefined
      // The upstream rate unit differs by exchange: SHFE/INE publish per-mille
      // (RB 0.1 = 0.1‰), DCE/GFEX per-10,000 (iron ore 1 = 1‱). Treating DCE
      // as per-mille overcharged fees 10×. Values already in fraction form
      // (<= 0.01) are used as-is.
      const per = contract.exchange === 'SHFE' || contract.exchange === 'INE' ? 1000 : 10000
      const fraction = rate > 0.01 ? rate / per : rate
      // A real ad-valorem fee is well below 0.05% of notional (BC/LU publish
      // 10, which would be 1% if read as a rate; INE offset_today_fee can be
      // yuan/lot). Refuse implausible values instead of inventing a fee.
      if (fraction > 0.0005) return undefined
      return Math.max(1, Math.round(quote.last * contract.multiplier * 100 * fraction))
    }
    const rate = params?.feeRate
    if (settle !== undefined && (settle.feePerLotCents === undefined || settle.feePerLotCents === 0)) {
      const perLotCents = toPerLot(rate)
      if (perLotCents !== undefined) {
        const closePerLot = toPerLot(params?.closeTodayFeeRate)
        settle = {
          ...settle,
          feePerLotCents: perLotCents,
          ...(closePerLot === undefined ? {} : { closeTodayFeePerLotCents: closePerLot }),
        }
        warnings.push(closePerLot === undefined
          ? `该合约按成交额计费，按 ${(perLotCents / 100).toFixed(2)} 元/手估算`
          : `该合约按成交额计费，开仓约 ${(perLotCents / 100).toFixed(2)} 元/手、平今约 ${(closePerLot / 100).toFixed(2)} 元/手`)
      } else if (typeof rate === 'number' && rate > 0) {
        // The upstream value is not a usable rate (unit mismatch). Stay honest:
        // use the configured fallback (0 by default) and explain why.
        const fallback = state.settings.defaultFeePerLotCents
        settle = { ...settle, feePerLotCents: fallback }
        warnings.push(`该合约费率单位异常（上游 ${rate}），手续费${fallback > 0 ? `按 ${(fallback / 100).toFixed(2)} 元/手` : '暂按 0'}估算`)
      }
    }
    return {
      contract,
      quote,
      limit: limitResult.limits.get(symbol),
      settle,
      sessions,
      tradeDaysToDeList,
      warnings: [...new Set(warnings)],
    }
  }

  private async tradeDaysToDeList(tradeDate: string, contract: ContractTerms | undefined): Promise<number | undefined> {
    const deListDate = contract?.deListDate
    if (deListDate === undefined || deListDate === '') return undefined
    if (deListDate <= tradeDate) return 0
    try {
      const days = await this.options.calendar.tradingDays(tradeDate, deListDate)
      if (days.length === 0) return undefined
      // Inclusive list; the distance is the number of trading days after today.
      return Math.max(0, days.length - 1)
    } catch {
      return undefined
    }
  }

  // ---------------------------------------------------------------- reading --

  async contracts(query: FuturesContractQuery = {}): Promise<FuturesContractsResult> {
    const state = await this.sync()
    const cache = await this.ensureContracts(state.tradeDate, query.refresh === true)
    const text = query.query?.trim().toLowerCase() ?? ''
    const limit = Math.min(Math.max(1, Math.trunc(query.limit ?? 50)), MAX_CONTRACTS)
    const rows = [...cache.map.values()].filter(terms => {
      if (query.exchange !== undefined && terms.exchange !== query.exchange) return false
      if (text === '') return true
      return terms.symbol.toLowerCase().includes(text)
        || (terms.name ?? '').toLowerCase().includes(text)
        || terms.product.toLowerCase().includes(text)
    })
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol))
    return {
      state: cache.state,
      contracts: rows.slice(0, limit).map(toContractView),
      notice: cache.notice,
    }
  }

  async quote(symbols: readonly string[]): Promise<FuturesQuotesResult> {
    const cleaned = [...new Set(symbols.map(normalizeFuturesSymbol).filter(symbol => symbol !== ''))]
    const result = await this.fetchQuoteMap(cleaned)
    const cache = await this.ensureContracts(todayTradeDate(this.now()))
    const quotes = cleaned.flatMap(symbol => {
      const quote = result.quotes.get(symbol)
      if (quote === undefined) return []
      const terms = [...cache.map.values()].find(item => item.symbol === symbol)
      return [quoteView(symbol, quote, terms?.name)]
    })
    const notice = result.state === 'ok'
      ? result.notice
      : friendlyDataNotice(result, '行情暂不可用', this.ts())
    return { state: result.state, quotes, notice }
  }

  async status(): Promise<FuturesMarketStatus> {
    const state = await this.sync()
    return {
      ...marketStatusAt(state.tradeDate, parseDaySessions(undefined), this.ts()),
      calendar: this.options.calendar.status,
    }
  }

  async positions(): Promise<FuturesPositionView[]> {
    return positionViews(await this.sync())
  }

  async orders(): Promise<FuturesOrderView[]> {
    return orderViews(await this.sync())
  }

  async trades(): Promise<FuturesFillView[]> {
    return fillViews(await this.sync())
  }

  async review(period: FuturesPeriod = '30d'): Promise<FuturesReviewView> {
    const state = await this.sync()
    return toReview(state, period, todayTradeDate(this.now()))
  }

  async exportLedger(): Promise<FuturesLedgerExport> {
    const ledger = await this.options.repo.readLedger()
    if (ledger.content === null) return { path: ledger.path, exists: false, notice: '账本文件尚未创建' }
    return { path: ledger.path, exists: true, content: ledger.content }
  }

  // ---------------------------------------------------------------- writing --

  private assertLotQty(qty: number): void {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new FuturesError('INVALID_ARGUMENT', '手数必须是正整数', 400)
    }
  }

  async preview(input: FuturesDraft): Promise<FuturesPreviewView> {
    this.assertLotQty(input.qty)
    const draft = { ...input, symbol: normalizeFuturesSymbol(input.symbol) }
    const state = await this.sync()
    const symbol = draft.symbol
    const data = await this.symbolData(state, symbol, this.ts())
    return previewOrder({
      state,
      draft,
      contract: data.contract,
      quote: data.quote,
      limit: data.limit,
      settle: data.settle,
      sessions: data.sessions,
      nowIso: this.ts(),
      tradeDaysToDeList: data.tradeDaysToDeList,
      warnings: data.warnings,
    })
  }

  async place(input: FuturesDraft, requestId: string = randomUUID()): Promise<FuturesOrderView> {
    const state = await this.sync()
    if (state.blocked) throw this.blocked(state)
    // Reject a bad lot before it reaches the ledger: a rejected order with
    // qty <= 0 used to trip the replay invariant and lock the whole account.
    this.assertLotQty(input.qty)
    const draft = { ...input, symbol: normalizeFuturesSymbol(input.symbol) }
    const symbol = draft.symbol
    const data = await this.symbolData(state, symbol, this.ts())
    const nowIso = this.ts()
    const phase = phaseAt(nowIso, state.tradeDate, data.sessions)
    if (phase !== 'trading') {
      throw new FuturesError('SESSION_CLOSED', '当前非期货日盘连续交易时段，不接受委托', 409)
    }
    const outcome = await this.options.repo.transact<PlaceOutcome>(current => {
      const duplicate = Object.values(current.orders).find(order => order.requestId === requestId)
      if (duplicate !== undefined) return { events: [], value: { duplicateId: duplicate.id } }
      if (current.blocked) return { events: [], value: { blocked: true } }
      const result = submit(current, draft, {
        tradeDate: current.tradeDate,
        phase,
        contract: data.contract,
        quote: data.quote,
        limit: data.limit,
        settle: data.settle,
        tradeDaysToDeList: data.tradeDaysToDeList,
      }, requestId, nowIso)
      return { events: result.events, value: { orderId: result.order?.id } }
    })
    if (outcome.value.duplicateId !== undefined) {
      const duplicate = outcome.state.orders[outcome.value.duplicateId]
      if (duplicate === undefined) throw new FuturesError('ORDER_NOT_FOUND', '订单不存在', 404)
      const limitPrice = typeof draft.limitPrice === 'number' ? draft.limitPrice : undefined
      const price = typeof draft.price === 'number' ? draft.price : undefined
      if (duplicate.symbol !== draft.symbol || duplicate.side !== draft.side
        || duplicate.offset !== draft.offset || duplicate.type !== draft.type || duplicate.qty !== draft.qty
        || duplicate.limitPrice !== limitPrice || duplicate.price !== price) {
        throw new FuturesError('INVALID_ARGUMENT', 'requestId 已被另一笔不同的委托占用', 409)
      }
      return toOrderView(duplicate)
    }
    if (outcome.value.blocked === true || outcome.state.blocked) throw this.blocked(outcome.state)
    const order = outcome.value.orderId === undefined ? undefined : outcome.state.orders[outcome.value.orderId]
    if (order === undefined) throw new FuturesError('INTERNAL', '订单未写入账本', 500)
    return toOrderView(order)
  }

  async cancel(orderId: string): Promise<FuturesOrderView> {
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
    if (outcome.value.missing === true) throw new FuturesError('ORDER_NOT_FOUND', '订单不存在', 404)
    if (outcome.value.notPending === true) throw new FuturesError('ORDER_NOT_PENDING', '订单不是挂单状态', 409)
    const order = outcome.state.orders[orderId]
    if (order === undefined) throw new FuturesError('ORDER_NOT_FOUND', '订单不存在', 404)
    return toOrderView(order)
  }

  async tick(): Promise<FuturesTickView> {
    const advanced = await this.advanceTo()
    const state = advanced.state
    const notices = [...advanced.notices]
    const expired = advanced.expired.map(toOrderView)
    const nowIso = this.ts()
    const symbols = this.symbolsInPlay(state)
    if (state.blocked) {
      return { tradeDate: state.tradeDate, filled: [], expired, notices: [...notices, '账户已锁定，已跳过撮合'] }
    }
    const contracts = await this.ensureContracts(state.tradeDate)
    const tradable = symbols.filter(symbol => {
      const sessions = daySessionsFor(contracts.map.get(symbol))
      return phaseAt(nowIso, state.tradeDate, sessions) === 'trading'
    })
    // Outside the day session (including right after the 15:30 settlement)
    // keep the close marks; a stale minute tick must not overwrite them.
    if (tradable.length === 0) {
      return { tradeDate: state.tradeDate, filled: [], expired, notices }
    }
    // One refresh per gate beat: contract quotes are the expensive part of the
    // loop, and degraded/failed tries must not hammer the gateway every 5 s.
    const key = tradable.join(',')
    const nowMs = this.now().getTime()
    if (!this.quoteGate.allow(key, nowMs)) {
      return { tradeDate: state.tradeDate, filled: [], expired, notices }
    }
    const quoteResult = await this.fetchQuoteMap(tradable)
    this.quoteGate.record(key, nowMs, quoteResult.state === 'ok')
    if (quoteResult.state !== 'ok') {
      notices.push(friendlyDataNotice(quoteResult, '行情暂不可用', nowIso))
      return { tradeDate: state.tradeDate, filled: [], expired, notices }
    }
    await this.options.repo.markPrices([...quoteResult.quotes].map(([symbol, quote]) => ({ symbol, last: quote.last })))
    const ticks = [...quoteResult.quotes].map(([symbol, quote]) => ({ symbol, last: quote.last, tradable: true }))
    if (ticks.length === 0) {
      return { tradeDate: state.tradeDate, filled: [], expired, notices }
    }
    const outcome = await this.options.repo.transact<{ filled: FuturesOrder[]; notices: string[] }>(current => {
      if (current.blocked) return { events: [], value: { filled: [], notices: ['账户已锁定，已跳过撮合'] } }
      const result = engineTick(current, ticks, nowIso)
      return { events: result.events, value: { filled: result.filled, notices: result.notices } }
    })
    const marked = await this.options.repo.markPrices([...quoteResult.quotes].map(([symbol, quote]) => ({ symbol, last: quote.last })))
    return {
      tradeDate: marked.tradeDate,
      filled: outcome.value.filled.map(order => toOrderView(marked.orders[order.id] ?? order)),
      expired,
      notices: [...notices, ...outcome.value.notices],
    }
  }

  /** Wipe the account by replacing the ledger with one genesis event. */
  async reset(confirm: boolean): Promise<ReturnType<typeof toAccountView>> {
    if (confirm !== true) throw new FuturesError('INVALID_ARGUMENT', '重置需要 confirm=true', 400)
    const ts = this.ts()
    await this.options.repo.backup(ts)
    const previous = await this.options.repo.current().catch(error => {
      this.options.logger?.warn(`paper-trading: futures reset could not replay the old ledger: ${String(error)}`)
      return undefined
    })
    const settings = previous !== undefined && previous.tradeDate !== ''
      ? normalizeFuturesSettings(previous.settings)
      : this.settings
    // A reset restarts the glass on the current trade date: reusing a stale
    // trade date would force a chain of empty settlements after the reset.
    const tradeDate = await this.tradeDateForNow(this.now())
    const genesis = resetAccount(emptyState(this.accountId), settings, tradeDate, ts, 'user')
    return this.viewOf(await this.options.repo.replace(genesis.events))
  }

  /** Exposed for tests: current equity in cents after advancing the clock. */
  async equityCents(): Promise<number> {
    const state = await this.sync()
    const view = toAccountView(state)
    return Math.round(view.equity * 100)
  }

  /** Free cash in the ledger plus the cash effect of fills, oldest first. */
  async cashFlow(): Promise<FuturesCashFlowEntry[]> {
    return cashFlowViews(await this.sync())
  }

  /** Add free cash; the amount is yuan from the UI, stored as integer cents. */
  async deposit(amount: number): Promise<ReturnType<typeof toAccountView>> {
    return this.moveCash('deposit', amount)
  }

  /** Take free cash out; margin already reserved by positions cannot leave. */
  async withdraw(amount: number): Promise<ReturnType<typeof toAccountView>> {
    return this.moveCash('withdraw', amount)
  }

  private async moveCash(kind: 'deposit' | 'withdraw', amount: number): Promise<ReturnType<typeof toAccountView>> {
    const amountCents = this.cashAmountCents(amount)
    const state = await this.sync()
    if (state.blocked) throw this.blocked(state)
    const outcome = await this.options.repo.transact<{ blocked: boolean; insufficient: boolean }>(current => {
      if (current.blocked) return { events: [], value: { blocked: true, insufficient: false } }
      // Re-checked inside the transaction: a concurrent open may have reserved
      // free cash as margin between `sync()` and this write.
      if (kind === 'withdraw' && amountCents > current.cashCents) {
        return { events: [], value: { blocked: false, insufficient: true } }
      }
      const result = kind === 'deposit'
        ? depositCash(current, amountCents, this.ts())
        : withdrawCash(current, amountCents, this.ts())
      return { events: result.events, value: { blocked: false, insufficient: false } }
    })
    if (outcome.value.blocked === true) throw this.blocked(outcome.state)
    if (outcome.value.insufficient === true) throw new FuturesError('INSUFFICIENT_CASH', '可提现金不足', 409)
    return this.viewOf(outcome.state)
  }

  /** `amount` is yuan from the UI; the ledger stores integer cents. */
  private cashAmountCents(amount: number): number {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new FuturesError('INVALID_ARGUMENT', '金额必须是正数', 400)
    }
    const cents = Math.round(amount * 100)
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      throw new FuturesError('INVALID_ARGUMENT', '金额至少 0.01 元', 400)
    }
    return cents
  }
}
