import type { Bar, DataState, Quote } from '../contract.js'

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

/** The only data dependency of the service; tests provide a fake. */
export interface MarketDataPort {
  quotes(symbols: string[]): Promise<QuoteResult>
  dailyBars(symbol: string, limit: number): Promise<BarsResult>
}
