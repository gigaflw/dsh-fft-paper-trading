import type { MarketListResult, SymbolHit } from '../contract.js';
import type { BarsResult, MarketDataPort, QuoteResult } from './market-data-port.js';
/** Structural slice of `ctx.ftshareData`; no runtime import across packages. */
export interface FtshareToolInfoLike {
    tool: string;
    title: string;
    description?: string;
    inputSchema?: unknown;
}
export interface FtshareDataLike {
    call(interfaceName: string, args?: Record<string, unknown>): Promise<{
        ok: boolean;
        state: 'available' | 'empty' | 'denied' | 'failed';
        rows: Record<string, unknown>[];
        notice?: {
            code: string;
            message: string;
        };
    }>;
    listTools(): Promise<readonly FtshareToolInfoLike[]>;
}
interface Mapping {
    quoteTools?: string[];
    klineTools?: string[];
}
/**
 * FTShare adapter.
 *
 * The gateway exposes one interface per dataset and their parameter schemas
 * differ; the adapter pins a small preference list, normalises symbols to the
 * `.SH` / `.SZ` form the interfaces expect and flattens grouped rows.
 */
export declare class FtshareMarketData implements MarketDataPort {
    private readonly service;
    private readonly quoteTools;
    private readonly klineTools;
    private known;
    private suspensionCache;
    constructor(service: FtshareDataLike, overrides?: Mapping);
    private available;
    private call;
    private quoteFor;
    private toQuote;
    /** List rows carry the exchange too; an unknown code is dropped, never guessed. */
    private toListQuote;
    quotes(symbols: string[]): Promise<QuoteResult>;
    private suspendedSymbols;
    dailyBars(symbol: string, limit: number): Promise<BarsResult>;
    minuteBars(symbol: string, date?: string): Promise<BarsResult>;
    search(query: string, limit: number): Promise<SymbolHit[]>;
    /**
     * Paged A-share quote list from the free-tier endpoint.
     *
     * The paid filter interface is not available without a key, so the board is
     * resolved from the canonical symbol instead: a code range (or exchange) goes
     * upstream as a `filter` expression and the board split is checked again
     * locally on the rows we keep. A page may still need a few upstream pages when
     * the local check drops rows, which is acceptable for a list the user opens
     * on demand.
     */
    marketList(input?: {
        board?: string;
        page?: number;
        pageSize?: number;
    }): Promise<MarketListResult>;
    private toBar;
}
export {};
//# sourceMappingURL=ftshare-market-data.d.ts.map