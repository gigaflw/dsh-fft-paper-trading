import type { FuturesDataState, FuturesExchange } from '../futures-contract.js';
/** Static contract terms as returned by the index; no limits/settlement yet. */
export interface FuturesContractMeta {
    /** Market-data suffix form, e.g. `RB2611.SHFE`. */
    symbol: string;
    name?: string;
    /** Product code, e.g. `rb`. */
    product: string;
    exchange: FuturesExchange;
    multiplier: number;
    tickSize: number;
    marginRate?: number;
    tradeHours?: string;
    /** Last trading day, `YYYY-MM-DD`. */
    deListDate?: string;
    volume?: number;
    openInterest?: number;
}
export interface FuturesRawQuote {
    symbol: string;
    last: number;
    preSettlement?: number;
    volume?: number;
    openInterest?: number;
    /** Market time of the last minute bar. */
    marketTs?: string;
    /** Trade date the quote belongs to, `YYYY-MM-DD`. */
    tradeDate?: string;
}
export interface FuturesRawLimit {
    symbol: string;
    upper: number;
    lower: number;
    marginRate?: number;
    source: 'limit' | 'minutes';
}
export interface FuturesRawSettle {
    symbol: string;
    settle?: number;
    longMarginRate?: number;
    /** Exchange fee per lot, in cents. */
    feePerLotCents?: number;
    /** Close-today fee per lot, in cents. */
    closeTodayFeePerLotCents?: number;
}
export interface FuturesRawClose {
    symbol: string;
    close: number;
    tradeDate: string;
    source: 'daily' | 'minutes' | 'quote';
}
export interface FuturesDataResult<T> {
    state: FuturesDataState;
    value?: T;
    notice?: string;
}
/**
 * The only futures-market dependency of the service. Tests provide a fake, the
 * host injects the FTShare adapter, and everything degrades to `failed` when
 * the optional `ftshareData` service is absent.
 */
export interface FuturesMarketDataPort {
    /** Full contract index (NIB/CFFEX already excluded), cached per trade date. */
    contracts(refresh?: boolean): Promise<FuturesDataResult<FuturesContractMeta[]>>;
    /** Latest price and the attributes minutes carry (pre-settlement, OI). */
    quotes(symbols: readonly string[]): Promise<FuturesDataResult<FuturesRawQuote[]>>;
    /** Up/down limits and the daily margin ratio. */
    limits(symbols: readonly string[]): Promise<FuturesDataResult<FuturesRawLimit[]>>;
    /** Settlement parameters: margins and per-lot fees. */
    settle(symbols: readonly string[]): Promise<FuturesDataResult<FuturesRawSettle[]>>;
    /** Close price for the mark-to-market snapshot. */
    closes(symbols: readonly string[], date?: string): Promise<FuturesDataResult<FuturesRawClose[]>>;
}
//# sourceMappingURL=futures-market-data-port.d.ts.map