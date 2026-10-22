/**
 * Futures order engine: pure functions from (state, inputs) to events + state.
 *
 * One fill takes the whole order (no partial fills), T+0, no slippage:
 * - market: fill at the quantized last price (or the manual reference price
 *   for a degraded close);
 * - limit: fill at `min(limit, last)` for a buy / `max(limit, last)` for a
 *   sell when crossed, otherwise rest until a tick or the settlement expiry.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/engine
 */
import type { FuturesDraft, FuturesPhase } from '../../futures-contract.js';
import { type ContractTerms, type FuturesAccountState, type FuturesFill, type FuturesLedgerEvent, type FuturesOrder, type FuturesSettings, type LimitInput, type QuoteInput, type SettleInput } from './types.js';
export interface EngineResult {
    events: FuturesLedgerEvent[];
    state: FuturesAccountState;
    order?: FuturesOrder;
    warnings: string[];
}
export declare function openAccount(state: FuturesAccountState, settings: FuturesSettings, tradeDate: string, ts: string, accountId: string): EngineResult;
export declare function resetAccount(state: FuturesAccountState, settings: FuturesSettings, tradeDate: string, ts: string, reason: string): EngineResult;
export interface OrderInput {
    tradeDate: string;
    phase: FuturesPhase;
    contract?: ContractTerms;
    quote?: QuoteInput;
    limit?: LimitInput;
    settle?: SettleInput;
    /** Trading days left before the last trading day; undefined when unknown. */
    tradeDaysToDeList?: number;
}
/**
 * Submit one order.
 *
 * Everything is checked before any ledger event is built; a business failure
 * is written as `order.rejected` so the panel and the review keep the attempt.
 */
export declare function submit(state: FuturesAccountState, draft: FuturesDraft, input: OrderInput, requestId: string, ts: string): EngineResult;
/** Cancel a resting order. Non-resting orders are left untouched. */
export declare function cancelOrder(state: FuturesAccountState, orderId: string, ts: string, reason?: string): EngineResult;
export interface TickQuote {
    symbol: string;
    last: number;
    /** False when the contract's session is not in continuous trading. */
    tradable: boolean;
    marketTs?: string;
}
export interface TickResult extends EngineResult {
    filled: FuturesOrder[];
    notices: string[];
}
/**
 * Match resting limit orders against fresh quotes. Market orders never rest, so
 * only limit orders can fill here. Day expiry belongs to {@link closeDay}.
 */
export declare function tick(state: FuturesAccountState, quotes: readonly TickQuote[], ts: string): TickResult;
export interface DayCloseOptions {
    date: string;
    nextTradeDate: string;
    /** Settlement timestamp, 15:30 Asia/Shanghai. */
    ts: string;
    recordedAt: string;
    /** Close price per symbol; missing symbols keep their last known mark. */
    closes: Record<string, number>;
    closeSource: 'daily' | 'quote' | 'missing';
    warnings?: string[];
}
export interface DayCloseResult extends EngineResult {
    notices: string[];
    expired: FuturesOrder[];
    liquidated: FuturesFill[];
}
/**
 * Close one trade date (D15/D16):
 * 1. mark positions to the close price,
 * 2. force-close positions when risk ≥ liquidation line or the contract expired,
 * 3. expire resting orders,
 * 4. snapshot equity and advance the trade date to `nextTradeDate`.
 *
 * A missing close price leaves the position on its last mark and skips its
 * forced close instead of guessing a price.
 */
export declare function closeDay(state: FuturesAccountState, options: DayCloseOptions): DayCloseResult;
export interface DayOpenOptions {
    date: string;
    ts: string;
    recordedAt: string;
    /** Quote prices used as the opening marks; missing symbols keep the close. */
    opens: Record<string, number>;
}
/** Start a trade date: advance the date, mark the opens and clear today's bucket. */
export declare function openDay(state: FuturesAccountState, options: DayOpenOptions): EngineResult;
/** Convenience: a clean state for tests and the store's empty ledger. */
export declare function newState(accountId: string): FuturesAccountState;
//# sourceMappingURL=engine.d.ts.map