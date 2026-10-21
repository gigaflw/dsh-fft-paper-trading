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
    constructor(service: FtshareDataLike, overrides?: Mapping);
    private available;
    private call;
    private quoteFor;
    private toQuote;
    quotes(symbols: string[]): Promise<QuoteResult>;
    dailyBars(symbol: string, limit: number): Promise<BarsResult>;
    private toBar;
}
export {};
//# sourceMappingURL=ftshare-market-data.d.ts.map