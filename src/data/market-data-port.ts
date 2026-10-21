import type { Bar, DataState, MarketListResult, Quote, SymbolHit } from '../contract.js'

export interface QuoteResult {
  state: DataState
  quotes: Quote[]
  notice?: string
}

export interface BarsResult {
  state: DataState
  bars: Bar[]
  notice?: string
}

/** The only market-data dependency of the service; tests provide a fake. */
export interface MarketDataPort {
  quotes(symbols: string[]): Promise<QuoteResult>
  /** Daily bars; the last bar may be the current day after the close. */
  dailyBars(symbol: string, limit: number): Promise<BarsResult>
  /** 1-minute bars for one day; defaults to the current trade date. */
  minuteBars(symbol: string, date?: string): Promise<BarsResult>
  search(query: string, limit: number): Promise<SymbolHit[]>
  marketList(input: { board?: string; page?: number; pageSize?: number }): Promise<MarketListResult>
}
