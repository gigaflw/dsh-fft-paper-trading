import type { FuturesContractMeta, FuturesDataResult, FuturesMarketDataPort, FuturesRawClose, FuturesRawLimit, FuturesRawQuote, FuturesRawSettle } from './futures-market-data-port.js';
/**
 * Degraded port: the panel and the ledger must stay usable without FTShare, so
 * every call reports `failed` with one readable reason instead of throwing.
 */
export declare class UnavailableFuturesMarketData implements FuturesMarketDataPort {
    private readonly notice;
    private fail;
    contracts(): Promise<FuturesDataResult<FuturesContractMeta[]>>;
    quotes(): Promise<FuturesDataResult<FuturesRawQuote[]>>;
    limits(): Promise<FuturesDataResult<FuturesRawLimit[]>>;
    settle(): Promise<FuturesDataResult<FuturesRawSettle[]>>;
    closes(): Promise<FuturesDataResult<FuturesRawClose[]>>;
}
//# sourceMappingURL=unavailable-futures-market-data.d.ts.map