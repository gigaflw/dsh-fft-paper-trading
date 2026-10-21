import type { BarsResult, MarketDataPort, QuoteResult } from './market-data-port.js';
/**
 * Stand-in used until `ftshareData` is available.
 *
 * The host entry must not gate the ledger, the RPC route or the tools on the
 * market-data service: an account with history stays readable while quotes and
 * ticks fail with the same four-state shape as the real adapter. Swapping in
 * {@link FtshareMarketData} is a single assignment in the entry.
 */
export declare class UnavailableMarketData implements MarketDataPort {
    quotes(): Promise<QuoteResult>;
    dailyBars(): Promise<BarsResult>;
}
//# sourceMappingURL=unavailable-market-data.d.ts.map