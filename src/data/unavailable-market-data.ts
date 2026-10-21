import type { BarsResult, MarketDataPort, QuoteResult } from './market-data-port.js'
import type { MarketListResult, SymbolHit } from '../contract.js'

const NOT_READY = '行情服务未就绪'

/**
 * Stand-in used until `ftshareData` is available.
 *
 * The host entry must not gate the ledger, the RPC route or the tools on the
 * market-data service: an account with history stays readable while quotes and
 * ticks fail with the same four-state shape as the real adapter.
 */
export class UnavailableMarketData implements MarketDataPort {
  async quotes(): Promise<QuoteResult> {
    return { state: 'failed', quotes: [], notice: NOT_READY }
  }

  async dailyBars(): Promise<BarsResult> {
    return { state: 'failed', bars: [], notice: NOT_READY }
  }

  async minuteBars(): Promise<BarsResult> {
    return { state: 'failed', bars: [], notice: NOT_READY }
  }

  async search(): Promise<SymbolHit[]> {
    return []
  }

  async marketList(): Promise<MarketListResult> {
    return { state: 'failed', quotes: [], page: 1, notice: NOT_READY }
  }
}
