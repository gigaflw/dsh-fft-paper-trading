import type { PaperSettings, Quote } from '../contract.js';
import type { AccountState, LedgerEvent, Order } from './types.js';
export interface EngineResult {
    events: LedgerEvent[];
    state: AccountState;
    order?: Order;
}
export declare function openAccount(state: AccountState, settings: PaperSettings, tradeDate: string, ts: string, accountId: string): EngineResult;
export declare function resetAccount(state: AccountState, settings: PaperSettings, tradeDate: string, ts: string, reason: string): EngineResult;
/**
 * Submit one order and, when it crosses immediately, fill it in the same batch.
 * Risk runs before any event is written; a rejection is still a ledger event.
 */
export declare function submit(state: AccountState, draft: {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    qty: number;
    limitPrice?: number;
    price?: number;
    name?: string;
}, quote: Quote | null, requestId: string, ts: string): EngineResult;
export declare function cancelOrder(state: AccountState, orderId: string, ts: string): EngineResult;
export interface TickResult extends EngineResult {
    filled: Order[];
    expired: Order[];
    notices: string[];
}
/**
 * Refresh prices and process pending orders. The service calls this on demand;
 * there is no background loop in the MVP.
 */
export declare function tick(state: AccountState, quotes: Quote[], ts: string): TickResult;
/** Mark-to-market equity in cents; falls back to cost basis when no price is known. */
export declare function equityCents(state: AccountState): number;
//# sourceMappingURL=engine.d.ts.map