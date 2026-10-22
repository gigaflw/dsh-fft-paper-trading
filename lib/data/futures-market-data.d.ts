import type { FtshareDataLike } from './ftshare-market-data.js';
import type { FuturesContractMeta, FuturesDataResult, FuturesMarketDataPort, FuturesRawClose, FuturesRawLimit, FuturesRawQuote, FuturesRawSettle } from './futures-market-data-port.js';
/**
 * FTShare adapter for the futures market-data port.
 *
 * The contract index is cached per trade date in memory and at
 * `$DSH_HOME/paper-trading/futures/contracts.json`, so a restarted panel does
 * not spend its four monthly calls on every open. Every method degrades to
 * `denied` / `failed` with a readable notice instead of throwing.
 */
export declare class FtshareFuturesMarketData implements FuturesMarketDataPort {
    private readonly service;
    private cache;
    /** Exchange tables are daily snapshots; one fetch per exchange per trade date. */
    private readonly tableCache;
    constructor(service: FtshareDataLike);
    contracts(refresh?: boolean): Promise<FuturesDataResult<FuturesContractMeta[]>>;
    quotes(symbols: readonly string[]): Promise<FuturesDataResult<FuturesRawQuote[]>>;
    limits(symbols: readonly string[]): Promise<FuturesDataResult<FuturesRawLimit[]>>;
    settle(symbols: readonly string[]): Promise<FuturesDataResult<FuturesRawSettle[]>>;
    closes(symbols: readonly string[], date?: string): Promise<FuturesDataResult<FuturesRawClose[]>>;
    private contractsFallback;
    private fetchContracts;
    private toContracts;
    private fetchMinuteRows;
    private groupMinuteRows;
    /** One-symbol `ft_limit` fallback for exchanges whose whole-table paging fails (SHFE). */
    private fetchLimitRowBySymbol;
    private quoteFromRows;
    private fetchExchangeTable;
    private klineArgs;
    private pickDailyClose;
    private call;
    private readCacheFile;
    private writeCacheFile;
    private cachePath;
}
//# sourceMappingURL=futures-market-data.d.ts.map