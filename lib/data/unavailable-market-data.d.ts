import type { BarsResult, MarketDataPort, QuoteResult } from './market-data-port.js';
import type { MarketListResult, SymbolHit } from '../contract.js';
/**
 * Stand-in used until `ftshareData` is available.
 *
 * The host entry must not gate the ledger, the RPC route or the tools on the
 * market-data service: an account with history stays readable while quotes and
 * ticks fail with the same four-state shape as the real adapter.
 */
export declare class UnavailableMarketData implements MarketDataPort {
    quotes(): Promise<QuoteResult>;
    dailyBars(): Promise<BarsResult>;
    minuteBars(): Promise<BarsResult>;
    search(): Promise<SymbolHit[]>;
    marketList(): Promise<MarketListResult>;
}
//# sourceMappingURL=unavailable-market-data.d.ts.map