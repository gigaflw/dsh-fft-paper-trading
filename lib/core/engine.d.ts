import type { PaperSettings, Quote, SessionPhase } from '../contract.js';
import type { AccountState, LedgerEvent, Order } from './types.js';
export interface EngineResult {
    events: LedgerEvent[];
    state: AccountState;
    order?: Order;
}
export declare function openAccount(state: AccountState, settings: PaperSettings, tradeDate: string, ts: string, accountId: string): EngineResult;
export declare function resetAccount(state: AccountState, settings: PaperSettings, tradeDate: string, ts: string, reason: string): EngineResult;
export interface SubmitOptions {
    /** Whether the current phase allows continuous matching. */
    matchable: boolean;
    phase?: SessionPhase;
    /** Minute-bar volume for a participation-capped fill. */
    barVolume?: number;
    barTs?: string;
}
/**
 * Submit one order. Risk runs before any event is written; a rejection is still
 * a ledger event. Orders accepted outside the matching phase are `queued` and
 * never fill until a later tick.
 */
export declare function submit(state: AccountState, draft: {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    qty: number;
    limitPrice?: number;
    price?: number;
    name?: string;
    note?: string;
    tradeDate?: string;
}, quote: Quote | null, requestId: string, ts: string, options?: SubmitOptions): EngineResult;
export declare function cancelOrder(state: AccountState, orderId: string, ts: string): EngineResult;
export interface TickResult extends EngineResult {
    filled: Order[];
    expired: Order[];
    notices: string[];
}
/** Match resting orders against a fresh quote/bar. Day expiry is handled by closeDay. */
export declare function tick(state: AccountState, quotes: Quote[], ts: string, barVolumes?: Record<string, number>): TickResult;
export interface DayCloseOptions {
    date: string;
    nextTradeDate: string;
    ts: string;
    recordedAt: string;
    quotes: Quote[];
    closeSource: 'daily' | 'last' | 'missing';
}
/** Close one trade date: snapshot, day-order expiry. T+1 stays for the next open. */
export declare function closeDay(state: AccountState, options: DayCloseOptions): EngineResult;
export interface DayOpenOptions {
    date: string;
    ts: string;
    recordedAt: string;
    quotes: Quote[];
}
/** Open a trade date: advance tradeDate, snapshot opens/gaps, unlock T+1. */
export declare function openDay(state: AccountState, options: DayOpenOptions): EngineResult;
/** Mark-to-market equity in cents; falls back to cost basis when no price is known. */
export declare function equityCents(state: AccountState): number;
//# sourceMappingURL=engine.d.ts.map