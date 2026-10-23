import type { PaperSettings, Quote, SessionPhase } from '../contract.js';
import type { AccountState, LedgerEvent, Order } from './types.js';
export interface EngineResult {
    events: LedgerEvent[];
    state: AccountState;
    order?: Order;
}
export declare function openAccount(state: AccountState, settings: PaperSettings, tradeDate: string, ts: string, accountId: string): EngineResult;
export declare function resetAccount(state: AccountState, settings: PaperSettings, tradeDate: string, ts: string, reason: string): EngineResult;
/** One fill takes the whole remaining quantity: M2 never partially fills. */
export declare function fillQty(order: Order): number;
/**
 * Move cash in (`deposit`) or out (`withdraw`) without touching positions.
 *
 * The amount is validated here rather than only in the service: it lands in the
 * ledger, where a zero, negative or fractional cent value would break replay.
 * A withdrawal larger than the free cash is a caller bug (the service checks it
 * inside the same transaction), so it throws instead of booking a negative cash.
 */
export declare function depositCash(state: AccountState, amountCents: number, ts: string): EngineResult;
export declare function withdrawCash(state: AccountState, amountCents: number, ts: string): EngineResult;
export interface SubmitOptions {
    /** Whether the current phase allows continuous matching. */
    matchable: boolean;
    phase?: SessionPhase;
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
/** Match resting orders against a fresh quote. Day expiry is handled by closeDay. */
export declare function tick(state: AccountState, quotes: Quote[], ts: string): TickResult;
/** Promote queued orders once continuous matching is available again (e.g. 13:00). */
export declare function releaseQueued(state: AccountState, ts: string, tradeDate?: string): EngineResult;
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
/** Switch to the new trade date at 09:15 without unlocking T+1. */
export declare function preOpenDay(state: AccountState, date: string, ts: string): EngineResult;
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