/**
 * Market-data cache shared by every account in the host.
 *
 * Without it, N accounts each tick the same symbol and the adapter makes N
 * upstream calls for one number; the panel's auto-preview adds more. Two rules
 * make the cost independent of the account count:
 *
 * - **Per-symbol TTL** — quotes live for one scheduler tick, so every account
 *   sees the same price inside a tick (that is also the fairness property a
 *   comparison or a contest needs).
 * - **Coalescing** — concurrent misses for the same symbol share one upstream
 *   call, and misses that arrive in the same microtask batch are fetched in one
 *   request.
 *
 * Failures are cached too: once the quota is exhausted, every refresh would
 * otherwise keep hammering the gateway.
 * @module @dsh-ft/dsh-fft-paper-trading/data/cached-market-data
 */

import type { DataState, MarketListResult, Quote, SymbolHit } from '../contract.js'
import type { BarsResult, MarketDataPort, QuoteResult } from './market-data-port.js'

/** Default quote lifetime: one host scheduler beat. */
export const DEFAULT_QUOTE_TTL_MS = 5_000
/** Failure cache; long enough to stop a burning quota, short enough to recover. */
const FAILURE_TTL_MS = 60_000
/** Bars change once per trade date; a short TTL still collapses preview + order + close. */
const DAILY_TTL_MS = 60_000
const SEARCH_TTL_MS = 30_000

export interface CachedMarketDataOptions {
  /** Quote cache lifetime; the host passes the same value as its scheduler tick. */
  ttlMs?: number | (() => number)
  now?: () => number
  logger?: { warn(message: string): void }
}

interface QuoteEntry {
  at: number
  state: DataState
  quote?: Quote
  notice?: string
  noticeCode?: string
}

interface Deferred<T> {
  resolve: (value: T) => void
}

/** One request may cover many symbols; the batch resolves all waiters at once. */
export class CachedMarketData implements MarketDataPort {
  private readonly ttl: () => number
  private readonly now: () => number
  private readonly quotesBySymbol = new Map<string, QuoteEntry>()
  private waiters = new Map<string, Deferred<QuoteEntry>[]>()
  private flushing = false
  private readonly memo = new Map<string, { at: number; value: unknown }>()
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(private readonly inner: MarketDataPort, options: CachedMarketDataOptions = {}) {
    const configured = options.ttlMs ?? DEFAULT_QUOTE_TTL_MS
    this.ttl = typeof configured === 'function' ? configured : () => configured
    this.now = options.now ?? (() => Date.now())
  }

  /** Drop every cached value; used by tests and after a manual refresh. */
  clear(): void {
    this.quotesBySymbol.clear()
    this.memo.clear()
  }

  async quotes(symbols: string[]): Promise<QuoteResult> {
    const unique: string[] = []
    for (const symbol of symbols) if (!unique.includes(symbol)) unique.push(symbol)
    if (unique.length === 0) return { state: 'ok', quotes: [] }
    const entries = await Promise.all(unique.map(symbol => this.quoteEntry(symbol)))
    const quotes: Quote[] = []
    const notices: string[] = []
    let denied = false
    let noticeCode: string | undefined
    for (const entry of entries) {
      if (entry.quote !== undefined) quotes.push(entry.quote)
      if (entry.state === 'denied') denied = true
      if (entry.noticeCode !== undefined && noticeCode === undefined) noticeCode = entry.noticeCode
      if (entry.notice !== undefined && entry.quote === undefined) notices.push(entry.notice)
    }
    if (quotes.length === 0) {
      return {
        state: denied ? 'denied' : 'failed',
        quotes,
        notice: notices.join('；') || '行情不可用',
        ...(noticeCode === undefined ? {} : { noticeCode }),
      }
    }
    return { state: 'ok', quotes, notice: notices.length > 0 ? notices.join('；') : undefined }
  }

  async dailyBars(symbol: string, limit: number): Promise<BarsResult> {
    return this.remember(`bars|${symbol}|${limit}`, DAILY_TTL_MS, () => this.inner.dailyBars(symbol, limit))
  }

  async minuteBars(symbol: string, date?: string): Promise<BarsResult> {
    return this.remember(`min|${symbol}|${date ?? ''}`, DAILY_TTL_MS, () => this.inner.minuteBars(symbol, date))
  }

  async search(query: string, limit: number): Promise<SymbolHit[]> {
    return this.remember(`search|${query}|${limit}`, SEARCH_TTL_MS, () => this.inner.search(query, limit))
  }

  async marketList(input: { board?: string; page?: number; pageSize?: number }): Promise<MarketListResult> {
    return this.remember(`list|${input.board ?? ''}|${input.page ?? 1}|${input.pageSize ?? 0}`, SEARCH_TTL_MS, () => this.inner.marketList(input))
  }

  /** TTL cache + single-flight for the call shapes where one key is one request. */
  private remember<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(key)
    if (hit !== undefined && this.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T)
    const pending = this.inflight.get(key)
    if (pending !== undefined) return pending as Promise<T>
    const promise = load()
      .then(value => {
        this.memo.set(key, { at: this.now(), value })
        return value
      })
      .catch(error => {
        // Do not cache exceptions: the port contract is "states, never throws".
        throw error
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }

  private quoteEntry(symbol: string): Promise<QuoteEntry> {
    const cached = this.readQuote(symbol)
    if (cached !== undefined) return Promise.resolve(cached)
    const queued = this.waiters.get(symbol)
    if (queued !== undefined) {
      return new Promise<QuoteEntry>(resolve => queued.push({ resolve }))
    }
    const list: Deferred<QuoteEntry>[] = []
    this.waiters.set(symbol, list)
    const promise = new Promise<QuoteEntry>(resolve => list.push({ resolve }))
    this.scheduleFlush()
    return promise
  }

  private readQuote(symbol: string): QuoteEntry | undefined {
    const cached = this.quotesBySymbol.get(symbol)
    if (cached === undefined) return undefined
    const ttl = cached.quote === undefined ? Math.max(FAILURE_TTL_MS, this.ttl()) : this.ttl()
    return this.now() - cached.at < ttl ? cached : undefined
  }

  /** One microtask: collect every symbol requested so far into a single call. */
  private scheduleFlush(): void {
    if (this.flushing) return
    this.flushing = true
    queueMicrotask(() => {
      void this.flush()
    })
  }

  private async flush(): Promise<void> {
    // Swap the map instead of clearing it: `batch` must keep the waiters that
    // arrived before this flush. Clearing in place would drop them all.
    const batch = this.waiters
    this.waiters = new Map()
    this.flushing = false
    const symbols = [...batch.keys()]
    if (symbols.length === 0) return
    let result: QuoteResult
    try {
      result = await this.inner.quotes(symbols)
    } catch (error) {
      result = { state: 'failed', quotes: [], notice: error instanceof Error ? error.message : '行情不可用' }
    }
    const bySymbol = new Map(result.quotes.map(quote => [quote.symbol, quote]))
    for (const symbol of symbols) {
      const quote = bySymbol.get(symbol)
      const entry: QuoteEntry = {
        at: this.now(),
        state: quote !== undefined ? 'ok' : (result.state === 'ok' ? 'failed' : result.state),
        ...(quote === undefined ? {} : { quote }),
        ...(quote === undefined && result.notice !== undefined ? { notice: result.notice } : {}),
        ...(quote === undefined && result.noticeCode !== undefined ? { noticeCode: result.noticeCode } : {}),
      }
      this.quotesBySymbol.set(symbol, entry)
      for (const waiter of batch.get(symbol) ?? []) waiter.resolve(entry)
    }
  }
}

